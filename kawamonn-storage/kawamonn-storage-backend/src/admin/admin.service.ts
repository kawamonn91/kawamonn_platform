import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as nodemailer from 'nodemailer';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class AdminService {
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

    async listUsers(search?: string, page: number = 1, perPage: number = 20) {
        const skip = (page - 1) * perPage;
        const whereClause: any = {};

        if (search) {
            whereClause.OR = [
                { account_name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
            ];
        }

        const [users, total] = await Promise.all([
            this.prisma.user.findMany({
                where: whereClause,
                select: {
                    id: true,
                    account_name: true,
                    email: true,
                    role: true,
                    status: true,
                    quota_bytes: true,
                    used_bytes: true,
                    expiry_at: true,
                    created_at: true,
                },
                orderBy: { created_at: 'asc' },
                skip,
                take: perPage,
            }),
            this.prisma.user.count({ where: whereClause }),
        ]);

        const mapped = users.map(u => ({
            ...u,
            quota_bytes: u.quota_bytes.toString(),
            used_bytes: u.used_bytes.toString(),
            created_at: u.created_at.toISOString(),
            expiry_at: u.expiry_at?.toISOString() || null,
        }));

        // Backward compatibility: return plain array when no search/pagination params
        // (existing frontend expects Array.isArray(res.data) === true)
        if (!search && page === 1 && perPage === 20) {
            return mapped;
        }

        return {
            items: mapped,
            total_count: total,
            page,
            per_page: perPage,
        };
    }

    /**
     * Get user detail with their last 50 audit logs
     * Migrated from: Flask admin app user_detail() route
     */
    async getUserDetail(id: string) {
        const user = await this.prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                account_name: true,
                email: true,
                role: true,
                status: true,
                quota_bytes: true,
                used_bytes: true,
                fs_project_id: true,
                expiry_at: true,
                last_reminder_sent: true,
                password_last_set_at: true,
                created_at: true,
                updated_at: true,
            },
        });

        if (!user) throw new NotFoundException('User not found');

        const auditLogs = await this.prisma.auditLog.findMany({
            where: { actor_id: id },
            orderBy: { created_at: 'desc' },
            take: 50,
        });

        return {
            ...user,
            quota_bytes: user.quota_bytes.toString(),
            used_bytes: user.used_bytes.toString(),
            created_at: user.created_at.toISOString(),
            updated_at: user.updated_at.toISOString(),
            expiry_at: user.expiry_at?.toISOString() || null,
            last_reminder_sent: user.last_reminder_sent?.toISOString() || null,
            password_last_set_at: user.password_last_set_at?.toISOString() || null,
            audit_logs: auditLogs.map(log => ({
                ...log,
                created_at: log.created_at.toISOString(),
            })),
        };
    }

    async updateUser(id: string, data: { quota_bytes?: string; email?: string }) {
        const updateData: any = {};
        if (data.quota_bytes) updateData.quota_bytes = BigInt(data.quota_bytes);
        if (data.email !== undefined) updateData.email = data.email;

        return this.prisma.user.update({
            where: { id },
            data: updateData
        });
    }

    async deleteUser(id: string) {
        return this.prisma.user.delete({
            where: { id },
        });
    }

    /**
     * Generate a temporary password for a user (admin action)
     * Migrated from: Flask admin app reset_password() route
     */
    async resetPassword(id: string) {
        const user = await this.prisma.user.findUnique({ where: { id } });
        if (!user) throw new NotFoundException('User not found');

        // Generate 12-char random password
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
        let tempPassword = '';
        for (let i = 0; i < 12; i++) {
            tempPassword += chars.charAt(crypto.randomInt(chars.length));
        }

        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        await this.prisma.user.update({
            where: { id },
            data: {
                password_hash: hashedPassword,
                password_last_set_at: new Date(),
            },
        });

        // Sync password to host OS
        try {
            const { execFileSync } = require('child_process');
            execFileSync('sudo', ['chpasswd'], {
                input: `${user.account_name}:${tempPassword}\n`,
            });
        } catch (e) {
            console.warn('Host user password sync failed:', e.message);
        }

        // Audit log
        await this.prisma.auditLog.create({
            data: {
                action: 'admin_reset_password',
                target_type: 'user',
                target_id: id,
                metadata: { account_name: user.account_name },
            },
        });

        return {
            temporary_password: tempPassword,
            account_name: user.account_name,
        };
    }

    /**
     * Update user quota in DB and OS-level ext4 project quota
     * Migrated from: Flask admin app update_quota() route
     */
    async updateQuota(id: string, quotaGb: number) {
        const user = await this.prisma.user.findUnique({ where: { id } });
        if (!user) throw new NotFoundException('User not found');

        const quotaBytes = BigInt(quotaGb) * BigInt(1024 * 1024 * 1024);

        await this.prisma.user.update({
            where: { id },
            data: { quota_bytes: quotaBytes },
        });

        // Update OS-level ext4 project quota if fs_project_id exists
        if (user.fs_project_id) {
            try {
                const { execFileSync } = require('child_process');
                execFileSync('sudo', [
                    '/home/pi/hdd/ssh/kawamonn-storage/kawamonn-storage-backend/scripts/update_quota.sh',
                    String(user.fs_project_id),
                    String(quotaBytes),
                ]);
            } catch (e) {
                console.warn('OS quota update failed (non-critical):', e.message);
            }
        }

        // Audit log
        await this.prisma.auditLog.create({
            data: {
                action: 'admin_update_quota',
                target_type: 'user',
                target_id: id,
                metadata: {
                    account_name: user.account_name,
                    old_quota: user.quota_bytes.toString(),
                    new_quota: quotaBytes.toString(),
                },
            },
        });

        return {
            status: 'updated',
            quota_bytes: quotaBytes.toString(),
        };
    }

    async broadcastEmail(subject: string, message: string) {
        try {
            const users = await this.prisma.user.findMany({ select: { email: true } });
            const emails = users.map(u => u.email).filter(e => e);

            if (emails.length === 0) return { status: 'No users to email' };

            await this.transporter.sendMail({
                from: `"Kawamonn Platform Admin" <${process.env.SMTP_USER}>`,
                bcc: emails,
                subject: subject,
                text: message,
            });

            return { status: 'Broadcast sent successfully', recipientCount: emails.length };
        } catch (e) {
            console.error('Failed to broadcast email:', e);
            throw new InternalServerErrorException('Failed to send broadcast email');
        }
    }
}
