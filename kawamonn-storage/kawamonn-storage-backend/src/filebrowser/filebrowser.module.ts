import { Module } from '@nestjs/common';
import { FileBrowserController } from './filebrowser.controller';
import { FileBrowserService } from './filebrowser.service';
import { StorageUsageService } from './storage-usage.service';

// ログインの確認は JwtAuthGuard(AuthModule が登録する JwtStrategy)で行うので、ここで JWT の設定は持たない
@Module({
  controllers: [FileBrowserController],
  providers: [FileBrowserService, StorageUsageService],
  exports: [FileBrowserService, StorageUsageService],
})
export class FileBrowserModule {}
