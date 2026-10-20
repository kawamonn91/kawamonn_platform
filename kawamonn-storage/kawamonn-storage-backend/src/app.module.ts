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
import { ThrottlerModule } from '@nestjs/throttler';
import { ClientIpThrottlerGuard } from './common/client-ip-throttler.guard';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    // 回数制限は接続元ごと(ClientIpThrottlerGuard。本番は Cloudflare の CF-Connecting-IP)に、1分あたり 300 回まで。
    // ストレージ画面はサムネイル1枚ごとに1回読み込むので、1人が画像の多いフォルダを開いても足りる量にする。
    // ログイン・登録・確認コードなどの認証の API は、各ルートの @Throttle({ default: ... }) でずっと厳しくしている。
    // (以前は「認証用 1分10回」の名前付きの制限が全ルートにかかり、しかも全員が 127.0.0.1 に見えていたので、
    //  サイト全体で1分10回しか API を呼べなかった)
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 300 }]),
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
      useClass: ClientIpThrottlerGuard,
    },
  ],
})
export class AppModule {}
