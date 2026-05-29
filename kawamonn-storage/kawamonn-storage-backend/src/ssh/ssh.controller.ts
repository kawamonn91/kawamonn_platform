import { Controller, Get, Param, Post, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { SshService } from './ssh.service';
import { JwtAuthGuard } from '../auth/jwt-auth/jwt-auth.guard';

@Controller('ssh')
@UseGuards(JwtAuthGuard)
export class SshController {
    constructor(private readonly sshService: SshService) { }

    @Post('provision/:username')
    provision(@Param('username') username: string, @Request() req) {
        if (req.user.role !== 'admin' && req.user.account_name !== username) {
            throw new ForbiddenException('Cannot provision containers for other users');
        }
        return this.sshService.provisionContainer(username);
    }

    @Get('status/:username')
    getStatus(@Param('username') username: string, @Request() req) {
        if (req.user.role !== 'admin' && req.user.account_name !== username) {
            throw new ForbiddenException('Cannot view containers for other users');
        }
        return this.sshService.getStatus(username);
    }
}
