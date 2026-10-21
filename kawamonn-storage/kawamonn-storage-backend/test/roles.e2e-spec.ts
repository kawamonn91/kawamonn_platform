import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { setupApp } from '../src/app-setup';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

jest.mock('nodemailer', () => ({
  createTransport: jest
    .fn()
    .mockReturnValue({ sendMail: jest.fn().mockResolvedValue(undefined) }),
}));

describe('Admin RolesGuard (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let regularUserId: string;
  let adminUserId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule, AdminModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    setupApp(app);
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
    await prisma.auditLog.deleteMany({
      where: { target_id: { in: [regularUserId, adminUserId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [regularUserId, adminUserId] } },
    });
    await app.close();
  });

  it('rejects a non-admin user from an admin-only route with 403', async () => {
    const token = jwtService.sign({
      sub: regularUserId,
      account_name: 'irrelevant',
      role: 'user',
    });

    await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('allows an admin user through the same route', async () => {
    const token = jwtService.sign({
      sub: adminUserId,
      account_name: 'irrelevant',
      role: 'admin',
    });

    await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('管理者でも、通常のログインのトークン(role: user、確認コードなし)では 403 にする', async () => {
    const token = jwtService.sign({
      sub: adminUserId,
      account_name: 'irrelevant',
      role: 'user',
    });

    await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  describe('管理者の操作', () => {
    const adminToken = () =>
      jwtService.sign({
        sub: adminUserId,
        account_name: 'irrelevant',
        role: 'admin',
      });
    const asAdmin = (r: request.Test) =>
      r.set('Authorization', `Bearer ${adminToken()}`);

    it('一覧は items と件数で返す', async () => {
      const res = await asAdmin(
        request(app.getHttpServer()).get('/api/v1/admin/users'),
      ).expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.total_count).toBeGreaterThanOrEqual(2);
    });

    it('容量は GiB で設定し、詳細に操作の記録が出る', async () => {
      await asAdmin(
        request(app.getHttpServer()).post(
          `/api/v1/admin/users/${regularUserId}/quota`,
        ),
      )
        .send({ quota_gb: 20 })
        .expect(201);
      const detail = await asAdmin(
        request(app.getHttpServer()).get(
          `/api/v1/admin/users/${regularUserId}`,
        ),
      ).expect(200);
      expect(detail.body.quota_bytes).toBe('21474836480');
      expect(detail.body.audit_logs[0]).toMatchObject({
        action: 'admin_update_quota',
        actor_id: adminUserId,
        target_id: regularUserId,
      });
    });

    it('自分自身は削除できず、おかしな ID は 400', async () => {
      await asAdmin(
        request(app.getHttpServer()).delete(
          `/api/v1/admin/users/${adminUserId}`,
        ),
      ).expect(400);
      await asAdmin(
        request(app.getHttpServer()).get('/api/v1/admin/users/not-a-uuid'),
      ).expect(400);
    });
  });

  it('rejects an unauthenticated request before the RolesGuard is even reached', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/users').expect(401);
  });
});
