import { Controller, Get, Put, Delete, Body, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth/jwt-auth.guard';
import { UpdateMeDto } from './dto/update-me.dto';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcrypt';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {

    constructor(private readonly usersService: UsersService) { }

    @Get('me')
    async getMe(@Request() req) {
        const user = await this.usersService.findOne({ id: req.user.id });
        if (!user) throw new BadRequestException('User not found');
        return {
            id: user.id,
            account_name: user.account_name,
            email: user.email,
            role: user.role,
            status: user.status,
            used_bytes: user.used_bytes.toString(),
            quota_bytes: user.quota_bytes.toString(),
            expiry_at: user.expiry_at?.toISOString() || null,
            created_at: user.created_at.toISOString(),
        };
    }

    @Put('me')
    async updateMe(
        @Request() req,
        @Body() body: UpdateMeDto
    ) {
        const user = await this.usersService.findOne({ id: req.user.id });
        if (!user) throw new BadRequestException('User not found');

        const updates: any = {};

        // account_name is intentionally immutable: it's used as the Linux OS
        // username, the SSH sandbox container mount path, and the on-disk
        // storage directory name. Renaming it in the DB without also renaming
        // all three would silently break file/SSH access for the account.

        // Update password
        if (body.new_password) {
            if (!body.current_password) throw new BadRequestException('現在のパスワードを入力してください');

            // Verify current password
            let isMatch = false;
            try {
                if (user.password_hash.startsWith('$argon2')) {
                    isMatch = await argon2.verify(user.password_hash, body.current_password);
                } else {
                    isMatch = await bcrypt.compare(body.current_password, user.password_hash);
                }
            } catch { /* ignore */ }

            if (!isMatch) throw new BadRequestException('現在のパスワードが正しくありません');
            if (body.new_password.length < 8) throw new BadRequestException('パスワードは8文字以上が必要です');
            updates.password_hash = await argon2.hash(body.new_password);
        }

        if (Object.keys(updates).length === 0) {
            return { status: '変更なし' };
        }

        await this.usersService.updateUser({ where: { id: req.user.id }, data: updates });
        return { status: '更新しました' };
    }

    @Delete('me')
    async deleteMe(@Request() req) {
        const user = await this.usersService.findOne({ id: req.user.id });
        if (!user) throw new BadRequestException('User not found');

        await this.usersService.deprovisionUser(user.account_name);
        await this.usersService.deleteUser({ id: req.user.id });
        return { status: 'アカウントを削除しました' };
    }
}
