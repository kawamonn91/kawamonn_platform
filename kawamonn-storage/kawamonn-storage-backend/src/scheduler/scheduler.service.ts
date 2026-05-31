import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import * as nodemailer from 'nodemailer';

/**
 * SchedulerService — Replaces Flask Celery Beat tasks
 *
 * Migrated from: kawamonn_platform/worker/tasks.py
 * - check_reminders() → checkReminders() : Daily 09:00 JST
 * - check_cleanup()   → checkCleanup()   : Daily 10:00 JST
 */
@Injectable()
export class SchedulerService {
    private readonly logger = new Logger(SchedulerService.name);
    private transporter: nodemailer.Transporter;

    constructor(private prisma: PrismaService) {
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '465', 10),
            secure: true,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }

    /**
     * Daily at 09:00 JST — Check and send expiry reminder emails
     * Migrated from: Celery task check_reminders() in tasks.py
     */
    @Cron('0 9 * * *', { timeZone: 'Asia/Tokyo' })
    async checkReminders() {
        this.logger.log('Running daily expiry reminder check...');

        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10);

        const users = await this.prisma.user.findMany({
            where: {
                status: 'active',
                expiry_at: { not: null },
            },
        });

        for (const user of users) {
            // Skip if already sent today
            if (
                user.last_reminder_sent &&
                user.last_reminder_sent.toISOString().slice(0, 10) === todayStr
            ) {
                continue;
            }

            const daysLeft = Math.floor(
                (user.expiry_at!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
            );

            let shouldSend = false;
            let template: 'standard' | 'final' = 'standard';

            // Monthly milestones: 180, 150, 120, 90, 60 days
            if ([180, 150, 120, 90, 60].includes(daysLeft)) {
                shouldSend = true;
            }

            // Final notice at 30 days
            if (daysLeft === 30) {
                shouldSend = true;
                template = 'final';
            }

            // Daily for last 7 days
            if (daysLeft > 0 && daysLeft <= 7) {
                shouldSend = true;
                if (daysLeft <= 3) {
                    template = 'final';
                }
            }

            if (shouldSend) {
                await this.sendReminderEmail(user, template, daysLeft);
            }
        }

        this.logger.log(`Reminder check complete. Processed ${users.length} users.`);
    }

    /**
     * Send a reminder email to a user about their upcoming account expiry
     * Migrated from: Celery task send_reminder_email() in tasks.py
     */
    private async sendReminderEmail(
        user: { id: string; account_name: string; email: string; expiry_at: Date | null },
        template: 'standard' | 'final',
        daysLeft: number,
    ) {
        const expiryDate = user.expiry_at
            ? user.expiry_at.toISOString().slice(0, 10)
            : 'unknown';

        let subject: string;
        let text: string;

        if (template === 'final') {
            subject = 'FINAL NOTICE: Account Deletion Imminent';
            text = `Hello ${user.account_name},\n\nThis is your FINAL NOTICE.\nYour account will expire and be DELETED in ${daysLeft} days on ${expiryDate}.\n\nPlease backup your data immediately.\n\nManagement Console: https://storage.kawamonn.com`;
        } else {
            subject = `Kawamonn Account Expiry Reminder: ${daysLeft} days left`;
            text = `Hello ${user.account_name},\n\nThis is a reminder that your account (@u-aizu.ac.jp) will expire on ${expiryDate}.\nYou have ${daysLeft} days remaining.\n\nPlease download your files before expiry.\nAfter expiry, your account and data will be deleted.\n\nManagement Console: https://storage.kawamonn.com`;
        }

        let status = 'sent';
        let responseBody = '';

        try {
            const info = await this.transporter.sendMail({
                from: `"UoA Online" <${process.env.SMTP_USER}>`,
                to: user.email,
                subject,
                text,
            });
            responseBody = JSON.stringify(info);
            this.logger.log(`Reminder sent to ${user.email} (${daysLeft} days left, ${template})`);
        } catch (error) {
            status = 'failed';
            responseBody = String(error);
            this.logger.error(`Failed to send reminder to ${user.email}: ${error}`);
        }

        // Log email delivery
        await this.prisma.mailSendLog.create({
            data: {
                user_id: user.id,
                template_name: template,
                status,
                response_body: responseBody,
            },
        });

        // Update last_reminder_sent
        if (status === 'sent') {
            await this.prisma.user.update({
                where: { id: user.id },
                data: { last_reminder_sent: new Date() },
            });
        }
    }

    /**
     * Daily at 10:00 JST — Cleanup expired user accounts
     * Migrated from: Celery task check_cleanup() in tasks.py
     */
    @Cron('0 10 * * *', { timeZone: 'Asia/Tokyo' })
    async checkCleanup() {
        this.logger.log('Running daily expired user cleanup...');

        const now = new Date();
        const expiredUsers = await this.prisma.user.findMany({
            where: {
                expiry_at: { lt: now },
                status: { not: 'deleted' },
            },
        });

        for (const user of expiredUsers) {
            try {
                // Archive user data via shell script (same as Flask version)
                const { execFileSync } = require('child_process');
                execFileSync('sudo', [
                    '/home/pi/hdd/ssh/kawamonn-storage/kawamonn-storage-backend/scripts/delete_user.sh',
                    user.account_name,
                    'archive',
                ]);

                // Update user status to deleted
                await this.prisma.user.update({
                    where: { id: user.id },
                    data: { status: 'deleted' },
                });

                // Log the action
                await this.prisma.auditLog.create({
                    data: {
                        action: 'auto_cleanup',
                        target_type: 'user',
                        target_id: user.id,
                        metadata: {
                            account_name: user.account_name,
                            reason: 'account_expired',
                            expiry_at: user.expiry_at?.toISOString(),
                        },
                    },
                });

                this.logger.log(`User ${user.account_name} expired and archived/deleted.`);
            } catch (error) {
                this.logger.error(`Failed to cleanup user ${user.account_name}: ${error}`);
            }
        }

        this.logger.log(`Cleanup complete. Processed ${expiredUsers.length} expired users.`);
    }
}
