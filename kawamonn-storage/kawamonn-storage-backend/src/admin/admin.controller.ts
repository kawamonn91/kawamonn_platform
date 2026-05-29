import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth/jwt-auth.guard';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
    constructor(
        private readonly adminService: AdminService,
        private readonly authService: AuthService,
        private readonly usersService: UsersService
    ) { }

    @Get('users')
    async listUsers(
        @Request() req,
        @Query('search') search?: string,
        @Query('page') page: string = '1',
        @Query('per_page') perPage: string = '20',
    ) {
        if (req.user.role !== 'admin') {
            throw new ForbiddenException('Admin access required');
        }
        return this.adminService.listUsers(search, parseInt(page, 10), parseInt(perPage, 10));
    }

    @Get('users/:id')
    async getUserDetail(@Request() req, @Param('id') id: string) {
        if (req.user.role !== 'admin') {
            throw new ForbiddenException('Admin access required');
        }
        return this.adminService.getUserDetail(id);
    }

    @Post('users')
    async createUser(@Request() req, @Body() body: any) {
        if (req.user.role !== 'admin') {
            throw new ForbiddenException('Admin access required');
        }

        const email = body.email;
        const account_name = body.account_name || email.split('@')[0];
        const password = body.password || Math.random().toString(36).slice(-8);

        // Use bcrypt for manual creation to avoid argon2 issues on Pi
        const bcrypt = require('bcrypt');
        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await this.usersService.createUser({
            email,
            account_name,
            password_hash: hashedPassword,
            role: body.role || 'user',
            quota_bytes: body.quota ? BigInt(body.quota) : BigInt(21474836480), // Default 20GB
        });

        return {
            id: newUser.id,
            account_name: newUser.account_name,
            temporary_password: body.password ? undefined : password
        };
    }

    @Put('users/:id')
    async updateUser(@Request() req, @Param('id') id: string, @Body() body: { quota_bytes?: string; email?: string }) {
        if (req.user.role !== 'admin') {
            throw new ForbiddenException('Admin access required');
        }
        await this.adminService.updateUser(id, body);
        return { status: 'updated' };
    }

    @Delete('users/:id')
    async deleteUser(@Request() req, @Param('id') id: string) {
        if (req.user.role !== 'admin') {
            throw new ForbiddenException('Admin access required');
        }
        await this.adminService.deleteUser(id);
        return { status: 'deleted' };
    }

    @Post('users/:id/reset-password')
    async resetPassword(@Request() req, @Param('id') id: string) {
        if (req.user.role !== 'admin') {
            throw new ForbiddenException('Admin access required');
        }
        return this.adminService.resetPassword(id);
    }

    @Post('users/:id/quota')
    async updateQuota(
        @Request() req,
        @Param('id') id: string,
        @Body() body: { quota_gb: number },
    ) {
        if (req.user.role !== 'admin') {
            throw new ForbiddenException('Admin access required');
        }
        return this.adminService.updateQuota(id, body.quota_gb);
    }

    @Post('broadcast')
    async broadcastEmail(@Request() req, @Body() body: { subject: string; message: string }) {
        if (req.user.role !== 'admin') {
            throw new ForbiddenException('Admin access required');
        }
        if (!body.subject || !body.message) {
            throw new ForbiddenException('Subject and message are required');
        }
        return this.adminService.broadcastEmail(body.subject, body.message);
    }
}
