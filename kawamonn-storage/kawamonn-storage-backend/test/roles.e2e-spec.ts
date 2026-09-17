import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

jest.mock('nodemailer', () => ({
    createTransport: jest.fn().mockReturnValue({ sendMail: jest.fn().mockResolvedValue(undefined) }),
}));

describe('Admin RolesGuard (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let jwtService: JwtService;
    let regularUserId: string;
    let adminUserId: string;

    beforeAll(async () => {
        const moduleRef: TestingModule = await Test.createTestingModule({
            imports: [PrismaModule, AdminModule],
        }).compile();

        app = moduleRef.createNestApplication();
        app.setGlobalPrefix('api/v1');
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
        await app.init();

        prisma = moduleRef.get(PrismaService);
        jwtService = moduleRef.get(JwtService);

        const regularUser = await prisma.user.create({
            data: {
                email: `roles-e2e-user-${Date.now()}@u-aizu.ac.jp`,
                account_name: `rolesuser${Date.now()}`,
                password_hash: 'irrelevant',
                role: 'user',
            },
        });
        regularUserId = regularUser.id;

        const adminUser = await prisma.user.create({
            data: {
                email: `roles-e2e-admin-${Date.now()}@example.com`,
                account_name: `rolesadmin${Date.now()}`,
                password_hash: 'irrelevant',
                role: 'admin',
            },
        });
        adminUserId = adminUser.id;
    });

    afterAll(async () => {
        await prisma.user.deleteMany({ where: { id: { in: [regularUserId, adminUserId] } } });
        await app.close();
    });

    it('rejects a non-admin user from an admin-only route with 403', async () => {
        const token = jwtService.sign({ sub: regularUserId, account_name: 'irrelevant', role: 'user' });

        await request(app.getHttpServer())
            .get('/api/v1/admin/users')
            .set('Authorization', `Bearer ${token}`)
            .expect(403);
    });

    it('allows an admin user through the same route', async () => {
        const token = jwtService.sign({ sub: adminUserId, account_name: 'irrelevant', role: 'admin' });

        await request(app.getHttpServer())
            .get('/api/v1/admin/users')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);
    });

    it('rejects an unauthenticated request before the RolesGuard is even reached', async () => {
        await request(app.getHttpServer()).get('/api/v1/admin/users').expect(401);
    });
});
