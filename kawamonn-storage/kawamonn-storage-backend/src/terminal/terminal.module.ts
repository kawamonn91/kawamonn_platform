import { Module } from '@nestjs/common';
import { TerminalGateway } from './terminal.gateway';
import { SshModule } from '../ssh/ssh.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  // JwtService(トークンの検証)は AuthModule の設定をそのまま使う
  imports: [SshModule, AuthModule],
  providers: [TerminalGateway],
})
export class TerminalModule {}
