import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TerminalGateway } from './terminal.gateway';
import { SshModule } from '../ssh/ssh.module';
import { getJwtSecret } from '../common/jwt-secret';

@Module({
    imports: [
        SshModule,
        JwtModule.register({
            secret: getJwtSecret(),
            signOptions: { expiresIn: '7d' },
        }),
    ],
    providers: [TerminalGateway],
})
export class TerminalModule {}
