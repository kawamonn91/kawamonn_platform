import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { FilesModule } from './files/files.module';
import { AdminModule } from './admin/admin.module';
import { SshModule } from './ssh/ssh.module';
import { TerminalModule } from './terminal/terminal.module';
import { FileBrowserModule } from './filebrowser/filebrowser.module';
import { SyncModule } from './sync/sync.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'kawamonn-storage-frontend', 'dist'),
      exclude: ['/api/(.*)'],
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,  // 1分
        limit: 60,   // 1分あたり60リクエスト
      },
      {
        name: 'auth',
        ttl: 60000,  // 1分
        limit: 10,   // 認証系は厳しく: 1分あたり10リクエスト
      },
    ]),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        enableOfflineQueue: false,
        maxRetriesPerRequest: null,
        connectTimeout: 5000,
        lazyConnect: false,
        retryStrategy: (times) => Math.min(times * 100, 3000),
      },
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    FilesModule,
    AdminModule,
    SshModule,
    TerminalModule,
    FileBrowserModule,
    SyncModule,
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
export class AppModule { }
