import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth/jwt-auth.guard';
import { UpdateMeDto } from './dto/update-me.dto';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { Throttle } from '@nestjs/throttler';
import { serializeUserSummary } from '../common/user-serializer';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser() me: AuthUser) {
    const user = await this.usersService.findOne({ id: me.id });
    if (!user) throw new BadRequestException('User not found');
    return serializeUserSummary(user);
  }

  @Put('me')
  // パスワードの変更(今のパスワードの確認)を含むので厳しくする
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async updateMe(@CurrentUser() me: AuthUser, @Body() body: UpdateMeDto) {
    // 利用者名(account_name)は変えられない。利用者フォルダの名前と、端末のコンテナのマウント先に使っているため
    if (!body.new_password) return { status: '変更なし' };
    if (!body.current_password) {
      throw new BadRequestException('現在のパスワードを入力してください');
    }
    await this.usersService.changePassword(
      me.id,
      body.current_password,
      body.new_password,
    );
    return { status: '更新しました' };
  }

  @Delete('me')
  async deleteMe(@CurrentUser() me: AuthUser) {
    await this.usersService.deleteAccount(me.id);
    return { status: 'アカウントを削除しました' };
  }
}
