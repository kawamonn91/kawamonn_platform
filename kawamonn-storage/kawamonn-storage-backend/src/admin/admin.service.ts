import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as nodemailer from 'nodemailer';

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

    async listUsers() {
        const users = await this.prisma.user.findMany({
            select: {
                id: true,
                account_name: true,
                email: true,
                role: true,
                quota_bytes: true,
                used_bytes: true,
                created_at: true,
            },
            orderBy: { created_at: 'asc' }
        });
        // Convert BigInt fields to strings for JSON serialization
        return users.map(u => ({
            ...u,
            quota_bytes: u.quota_bytes.toString(),
            used_bytes: u.used_bytes.toString(),
            created_at: u.created_at.toISOString(),
        }));
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

    async broadcastEmail(subject: string, message: string) {
        try {
            const users = await this.prisma.user.findMany({ select: { email: true } });
            const emails = users.map(u => u.email).filter(e => e); // ensure no nulls

            if (emails.length === 0) return { status: 'No users to email' };

            await this.transporter.sendMail({
                from: `"Kawamonn Platform Admin" <${process.env.SMTP_USER}>`,
                bcc: emails, // Use BCC to hide addresses from other recipients
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
