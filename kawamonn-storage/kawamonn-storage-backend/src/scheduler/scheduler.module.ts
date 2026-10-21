import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [PrismaModule, UsersModule, MailModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
