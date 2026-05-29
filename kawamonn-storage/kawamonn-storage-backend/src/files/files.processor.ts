import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';

@Processor('file-processing')
export class FilesProcessor extends WorkerHost {
    private readonly logger = new Logger(FilesProcessor.name);

    async process(job: Job<any, any, string>): Promise<any> {
        this.logger.debug(`Processing job ${job.id} of type ${job.name}`);
        switch (job.name) {
            case 'thumbnail-generation':
                this.logger.debug(`Generating thumbnail for file: ${job.data.fileId}`);
                break;
            case 'virus-scan':
                this.logger.debug(`Scanning file: ${job.data.fileId}`);
                break;
            default:
                this.logger.warn(`Unknown job type: ${job.name}`);
        }
        return {};
    }
}
