import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, ConflictException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateQuotaDto } from './dto/update-quota.dto';
import { BroadcastDto } from './dto/broadcast.dto';
import * as bcrypt from 'bcrypt';
import { generateTempPassword } from '../common/random-password';
import { isReservedAccountName } from '../common/reserved-names';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
    constructor(
        private readonly adminService: AdminService,
        private readonly authService: AuthService,
        private readonly usersService: UsersService
    ) { }

    @Get('users')
    async listUsers(
        @Query('search') search?: string,
        @Query('page') page: string = '1',
        @Query('per_page') perPage: string = '20',
    ) {
        return this.adminService.listUsers(search, parseInt(page, 10), parseInt(perPage, 10));
    }

    @Get('users/:id')
    async getUserDetail(@Param('id') id: string) {
        return this.adminService.getUserDetail(id);
    }

    @Post('users')
    async createUser(@Body() body: CreateUserDto) {
        const account_name = body.account_name || body.email.split('@')[0];
        if (isReservedAccountName(account_name)) {
            throw new ConflictException('This account name is reserved and cannot be used.');
        }
        const password = body.password || generateTempPassword();

        // Use bcrypt for manual creation to avoid argon2 issues on Pi
        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await this.usersService.createUser({
            email: body.email,
            account_name,
            password_hash: hashedPassword,
            role: body.role || 'user',
            quota_bytes: body.quota_bytes ? BigInt(body.quota_bytes) : BigInt(21474836480), // Default 20GB
        });

        return {
            id: newUser.id,
            account_name: newUser.account_name,
            temporary_password: body.password ? undefined : password
        };
    }

    @Put('users/:id')
    async updateUser(@Param('id') id: string, @Body() body: UpdateUserDto) {
        await this.adminService.updateUser(id, body);
        return { status: 'updated' };
    }

    @Delete('users/:id')
    async deleteUser(@Param('id') id: string) {
        await this.adminService.deleteUser(id);
        return { status: 'deleted' };
    }

    @Post('users/:id/reset-password')
    async resetPassword(@Param('id') id: string) {
        return this.adminService.resetPassword(id);
    }

    @Post('users/:id/quota')
    async updateQuota(@Param('id') id: string, @Body() body: UpdateQuotaDto) {
        return this.adminService.updateQuota(id, body.quota_gb);
    }

    @Post('broadcast')
    async broadcastEmail(@Body() body: BroadcastDto) {
        return this.adminService.broadcastEmail(body.subject, body.message);
    }
}
