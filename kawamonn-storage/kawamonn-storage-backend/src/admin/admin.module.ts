import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [AuthModule, UsersModule, MailModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
