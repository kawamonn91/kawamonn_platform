import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, Prisma } from '@prisma/client';
import * as Docker from 'dockerode';

@Injectable()
export class UsersService {
    private readonly logger = new Logger(UsersService.name);
    private docker = new Docker({ socketPath: '/var/run/docker.sock' });

    constructor(private prisma: PrismaService) { }

    /**
     * Fully revokes a user's OS-level footprint: stops/removes their SSH sandbox
     * container(s), then runs delete_user.sh (userdel, group removal, storage
     * archive+delete). Must be called BEFORE the User row is deleted, since
     * SshContainer rows cascade-delete with it and this needs them to find the
     * container IDs to tear down.
     */
    async deprovisionUser(account_name: string): Promise<void> {
        const containers = await this.prisma.sshContainer.findMany({ where: { username: account_name } });
        for (const c of containers) {
            if (!c.container_id) continue;
            try {
                const container = this.docker.getContainer(c.container_id);
                await container.stop().catch(() => { });
                await container.remove({ force: true }).catch(() => { });
            } catch (e) {
                this.logger.warn(`Failed to remove container ${c.container_id} for ${account_name}: ${e.message}`);
            }
        }

        try {
            const { execFileSync } = require('child_process');
            execFileSync('sudo', [
                '/home/pi/hdd/ssh/kawamonn-storage/kawamonn-storage-backend/scripts/delete_user.sh',
                account_name,
                'archive',
            ]);
        } catch (e) {
            this.logger.error(`OS deprovisioning failed for ${account_name}: ${e.message}`);
        }
    }

    async findOne(userWhereUniqueInput: Prisma.UserWhereUniqueInput): Promise<User | null> {
        return this.prisma.user.findUnique({
            where: userWhereUniqueInput,
        });
    }

    async findByEmail(email: string): Promise<User | null> {
        return this.prisma.user.findUnique({
            where: { email },
        });
    }

    async findByAccountName(account_name: string): Promise<User | null> {
        return this.prisma.user.findUnique({
            where: { account_name },
        });
    }

    async createUser(data: Prisma.UserCreateInput): Promise<User> {
        return this.prisma.user.create({
            data,
        });
    }

    async updateUser(params: {
        where: Prisma.UserWhereUniqueInput;
        data: Prisma.UserUpdateInput;
    }): Promise<User> {
        const { where, data } = params;
        return this.prisma.user.update({
            data,
            where,
        });
    }

    async deleteUser(where: Prisma.UserWhereUniqueInput): Promise<User> {
        return this.prisma.user.delete({
            where,
        });
    }

    async createOtp(email: string, code: string): Promise<void> {
        const expires_at = new Date();
        expires_at.setMinutes(expires_at.getMinutes() + 10);
        await this.prisma.otpCode.create({
            data: { email, code, expires_at }
        });
    }

    async verifyOtp(email: string, code: string): Promise<boolean> {
        const otp = await this.prisma.otpCode.findFirst({
            where: {
                email,
                code,
                expires_at: { gt: new Date() }
            },
            orderBy: { created_at: 'desc' }
        });

        if (otp) {
            await this.prisma.otpCode.delete({ where: { id: otp.id } });
            return true;
        }
        return false;
    }
}
