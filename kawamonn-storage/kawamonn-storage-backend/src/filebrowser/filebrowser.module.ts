import { Module } from '@nestjs/common';
import { FileBrowserController } from './filebrowser.controller';
import { FileBrowserService } from './filebrowser.service';
import { JwtModule } from '@nestjs/jwt';

@Module({
    imports: [
        JwtModule.register({
            secret: process.env.JWT_SECRET || 'kawamonn-super-secret-jwt-key',
            signOptions: { expiresIn: '7d' },
        }),
    ],
    controllers: [FileBrowserController],
    providers: [FileBrowserService],
    exports: [FileBrowserService],
})
export class FileBrowserModule {}

