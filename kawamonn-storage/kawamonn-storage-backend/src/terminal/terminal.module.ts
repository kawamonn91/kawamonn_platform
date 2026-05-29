import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TerminalGateway } from './terminal.gateway';
import { SshModule } from '../ssh/ssh.module';

@Module({
    imports: [
        SshModule,
        JwtModule.register({
            secret: process.env.JWT_SECRET || 'kawamonn-super-secret-jwt-key',
            signOptions: { expiresIn: '7d' },
        }),
    ],
    providers: [TerminalGateway],
})
export class TerminalModule {}
