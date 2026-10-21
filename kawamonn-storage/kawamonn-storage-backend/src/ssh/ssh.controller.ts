import {
  Controller,
  Get,
  Param,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { SshService } from './ssh.service';
import { JwtAuthGuard } from '../auth/jwt-auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';

// 端末のコンテナは、ブラウザの端末(terminal.gateway.ts)を開いたときに SshService が用意する。
// 以前あった「コンテナを作る」API(POST /ssh/provision/:username)は、呼ぶたびに新しいコンテナを作り、
// 古いものも動いたまま残ったので廃止した(画面からは使っていなかった)
@Controller('ssh')
@UseGuards(JwtAuthGuard)
export class SshController {
  constructor(private readonly sshService: SshService) {}

  @Get('status/:username')
  getStatus(@Param('username') username: string, @CurrentUser() me: AuthUser) {
    if (me.role !== 'admin' && me.account_name !== username) {
      throw new ForbiddenException('Cannot view containers for other users');
    }
    return this.sshService.getStatus(username);
  }
}
