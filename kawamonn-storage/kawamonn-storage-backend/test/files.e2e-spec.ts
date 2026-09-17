import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, Global, Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BullModule } from '@nestjs/bullmq';
import * as request from 'supertest';
import { FilesModule } from '../src/files/files.module';
import { AuthModule } from '../src/auth/auth.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SyncService } from '../src/sync/sync.service';

/**
 * Real MinIO round trip against the isolated test-minio container (see
 * docker-compose.test.yml) — this is the one place in the suite that talks
 * to real object storage instead of mocking it, since the whole point is
 * proving upload -> list -> delete -> quota actually works together.
 *
 * SyncService is still mocked: its real implementation also touches the
 * production filesystem (/home/pi/hdd/ssh), which is unrelated to what this
 * spec verifies (the MinIO + Postgres side of file management).
 */
const mockSyncService = {
    resolveDbFilePath: jest.fn().mockResolvedValue(null),
    writeFileToFs: jest.fn().mockResolvedValue(undefined),
    createDirInFs: jest.fn().mockResolvedValue(undefined),
    deleteFromFs: jest.fn().mockResolvedValue(undefined),
};

// The real SyncModule is @Global(), so FilesModule (which injects SyncService
// without importing SyncModule directly) resolves it through Nest's global
// provider scope. A plain provider in the root test module's own `providers`
// array is NOT visible there — Nest module encapsulation only exposes it to
// code instantiated at the root — so this fake module must be @Global() too.
@Global()
@Module({
    providers: [{ provide: SyncService, useValue: mockSyncService }],
    exports: [SyncService],
})
class MockSyncModule { }

describe('Files (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let token: string;
    let userId: string;

    beforeAll(async () => {
        const moduleRef: TestingModule = await Test.createTestingModule({
            imports: [
                PrismaModule,
                AuthModule,
                MockSyncModule,
                BullModule.forRoot({
                    connection: {
                        host: process.env.REDIS_HOST,
                        port: Number(process.env.REDIS_PORT),
                        enableOfflineQueue: false,
                        maxRetriesPerRequest: null,
                        connectTimeout: 5000,
                        lazyConnect: false,
                        retryStrategy: (times: number) => Math.min(times * 100, 3000),
                    },
                }),
                FilesModule,
            ],
        }).compile();

        app = moduleRef.createNestApplication();
        app.setGlobalPrefix('api/v1');
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
        await app.init();

        prisma = moduleRef.get(PrismaService);
        const jwtService = moduleRef.get(JwtService);

        const user = await prisma.user.create({
            data: {
                email: `files-e2e-${Date.now()}@u-aizu.ac.jp`,
                account_name: `filese2e${Date.now()}`,
                password_hash: 'irrelevant-for-this-suite',
                role: 'user',
                quota_bytes: BigInt(1024 * 1024 * 1024),
            },
        });
        userId = user.id;
        token = jwtService.sign({ sub: user.id, account_name: user.account_name, role: 'user' });
    });

    afterAll(async () => {
        await prisma.file.deleteMany({ where: { owner_id: userId } });
        await prisma.user.delete({ where: { id: userId } });
        await app.close();
    });

    it('uploads a file, lists it, and increments used_bytes', async () => {
        const uploadRes = await request(app.getHttpServer())
            .post('/api/v1/files')
            .set('Authorization', `Bearer ${token}`)
            .attach('file', Buffer.from('hello world'), 'hello.txt')
            .expect(201);

        expect(uploadRes.body.name).toBe('hello.txt');
        const fileId = uploadRes.body.id;

        const listRes = await request(app.getHttpServer())
            .get('/api/v1/files')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
        expect(listRes.body.items.some((f: any) => f.id === fileId)).toBe(true);

        const user = await prisma.user.findUnique({ where: { id: userId } });
        expect(Number(user!.used_bytes)).toBe(Buffer.from('hello world').length);
    });

    it('deletes a file and decrements used_bytes back down', async () => {
        const uploadRes = await request(app.getHttpServer())
            .post('/api/v1/files')
            .set('Authorization', `Bearer ${token}`)
            .attach('file', Buffer.from('to be deleted'), 'bye.txt')
            .expect(201);

        await request(app.getHttpServer())
            .delete(`/api/v1/files/${uploadRes.body.id}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        const stillThere = await prisma.file.findUnique({ where: { id: uploadRes.body.id } });
        expect(stillThere).toBeNull();
    });

    it('rejects requests with no auth token', async () => {
        await request(app.getHttpServer()).get('/api/v1/files').expect(401);
    });
});
