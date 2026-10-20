import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { SshModule } from './ssh/ssh.module';
import { TerminalModule } from './terminal/terminal.module';
import { FileBrowserModule } from './filebrowser/filebrowser.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 1分
        limit: 60, // 1分あたり60リクエスト
      },
      {
        name: 'auth',
        ttl: 60000, // 1分
        limit: 10, // 認証系は厳しく: 1分あたり10リクエスト
      },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    AdminModule,
    SshModule,
    TerminalModule,
    FileBrowserModule,
    ScheduleModule.forRoot(),
    SchedulerModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
