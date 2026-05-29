import { Module } from '@nestjs/common';
import { SshController } from './ssh.controller';
import { SshService } from './ssh.service';

@Module({
  controllers: [SshController],
  providers: [SshService],
  exports: [SshService],
})
export class SshModule {}
