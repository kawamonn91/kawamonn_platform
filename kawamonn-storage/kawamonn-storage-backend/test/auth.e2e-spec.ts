import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 登録はホストの OS アカウントを作らない(2026-10 に SSH 接続の入口を廃止した)。
 * 万一 OS のコマンドを呼ぶ処理が戻っても本物のアカウントを作らないよう child_process は偽物に差し替え、
 * 登録のテストで「一度も呼ばれない」ことを確かめる。
 */
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execFileSync: jest.fn(),
  execSync: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcess = require('child_process');

// AuthService.sendOtp() genuinely awaits transporter.sendMail() with no
// try/catch — against a real SMTP server this is desired end-to-end behavior,
// but .env.test's SMTP_HOST points at a throwaway address nothing listens on,
// so this must be mocked or every send-otp call would fail with ECONNREFUSED.
jest.mock('nodemailer', () => ({
  createTransport: jest
    .fn()
    .mockReturnValue({ sendMail: jest.fn().mockResolvedValue(undefined) }),
}));

/**
 * Deliberately composes a SMALL test module (Auth + Prisma only) instead of
 * importing the full AppModule, which also wires up the terminal (Docker),
 * the scheduler and other modules unrelated to what auth endpoints need.
 * Scoping the module keeps this suite fast and self-contained.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule, AuthModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({});
    await prisma.otpCode.deleteMany({});
  });

  describe('POST /auth/send-otp -> register flow', () => {
    it('rejects a non @u-aizu.ac.jp email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/send-otp')
        .send({ email: 'someone@gmail.com' });
      expect(res.status).toBe(400);
    });

    it('completes registration end-to-end with a real OTP round trip', async () => {
      const email = `e2e-${Date.now()}@u-aizu.ac.jp`;

      await request(app.getHttpServer())
        .post('/api/v1/auth/send-otp')
        .send({ email })
        .expect(200);

      const otp = await prisma.otpCode.findFirst({
        where: { email },
        orderBy: { created_at: 'desc' },
      });
      expect(otp).not.toBeNull();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'a valid password!',
          display_name: `e2euser${Date.now()}`,
          otp_code: otp!.code,
        })
        .expect(201);

      expect(res.body.status).toMatch(/Registered successfully/);

      const created = await prisma.user.findUnique({ where: { email } });
      expect(created).not.toBeNull();
      // ホストの OS アカウントの作成やスクリプトの実行(sudo)をしない
      expect(childProcess.execFileSync).not.toHaveBeenCalled();
      expect(childProcess.execSync).not.toHaveBeenCalled();
    });

    it('rejects a reserved account name through the real HTTP + DTO + service stack', async () => {
      const email = `e2e-reserved-${Date.now()}@u-aizu.ac.jp`;
      await request(app.getHttpServer())
        .post('/api/v1/auth/send-otp')
        .send({ email })
        .expect(200);
      const otp = await prisma.otpCode.findFirst({
        where: { email },
        orderBy: { created_at: 'desc' },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'a valid password!',
          display_name: 'admin',
          otp_code: otp!.code,
        });

      expect(res.status).toBe(409);
    });
  });

  describe('POST /auth/login', () => {
    it('returns 401 for a nonexistent account', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ account_name: 'nonexistent', password: 'whatever' })
        .expect(401);
    });
  });
});
