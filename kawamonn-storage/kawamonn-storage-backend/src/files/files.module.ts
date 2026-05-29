import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { BullModule } from '@nestjs/bullmq';
import { FilesProcessor } from './files.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'file-processing',
    }),
  ],
  controllers: [FilesController],
  providers: [FilesService, FilesProcessor]
})
export class FilesModule { }
