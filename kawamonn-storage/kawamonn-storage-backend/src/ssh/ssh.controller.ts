import {
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { SshService } from './ssh.service';
import { JwtAuthGuard } from '../auth/jwt-auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';

@Controller('ssh')
@UseGuards(JwtAuthGuard)
export class SshController {
  constructor(private readonly sshService: SshService) {}

  @Post('provision/:username')
  provision(@Param('username') username: string, @CurrentUser() me: AuthUser) {
    if (me.role !== 'admin' && me.account_name !== username) {
      throw new ForbiddenException(
        'Cannot provision containers for other users',
      );
    }
    return this.sshService.provisionContainer(username);
  }

  @Get('status/:username')
  getStatus(@Param('username') username: string, @CurrentUser() me: AuthUser) {
    if (me.role !== 'admin' && me.account_name !== username) {
      throw new ForbiddenException('Cannot view containers for other users');
    }
    return this.sshService.getStatus(username);
  }
}
