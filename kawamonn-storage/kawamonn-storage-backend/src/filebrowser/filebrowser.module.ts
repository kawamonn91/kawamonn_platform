import { Module } from '@nestjs/common';
import { FileBrowserController } from './filebrowser.controller';
import { FileBrowserService } from './filebrowser.service';
import { JwtModule } from '@nestjs/jwt';
import { getJwtSecret } from '../common/jwt-secret';

@Module({
    imports: [
        JwtModule.register({
            secret: getJwtSecret(),
            signOptions: { expiresIn: '7d' },
        }),
    ],
    controllers: [FileBrowserController],
    providers: [FileBrowserService],
    exports: [FileBrowserService],
})
export class FileBrowserModule {}

