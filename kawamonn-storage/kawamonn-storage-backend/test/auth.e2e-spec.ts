import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { setupApp } from '../src/app-setup';
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
  execFile: jest.fn(),
  execFileSync: jest.fn(),
  execSync: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcess = require('child_process');

// AuthService.sendOtp() genuinely awaits transporter.sendMail() with no
// try/catch — against a real SMTP server this is desired end-to-end behavior,
// but .env.test's SMTP_HOST points at a throwaway address nothing listens on,
// so this must be mocked or every send-otp call would fail with ECONNREFUSED.
// (jest.mock は import より先に実行されるので、mockSendMail は呼ばれた時点で参照する)
const mockSendMail = jest.fn().mockResolvedValue(undefined);
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: (...args: unknown[]) => mockSendMail(...args),
  }),
}));

/**
 * 送ったメールの本文から確認コード(6 桁)を取り出す。DB にはコードの HMAC しか残らないので、
 * 利用者と同じくメールで受け取ったコードを使う
 */
function lastMailedOtp(to: string): string {
  const mail = [...mockSendMail.mock.calls]
    .map(([m]) => m as { to?: string; text?: string })
    .reverse()
    .find((m) => m.to === to);
  const code = mail?.text?.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`${to} 宛ての確認コードのメールが無い`);
  return code;
}

/**
 * Deliberately composes a SMALL test module (Auth + Prisma only) instead of
 * importing the full AppModule, which also wires up the terminal (Docker),
 * the scheduler and other modules unrelated to what auth endpoints need.
 * Scoping the module keeps this suite fast and self-contained.
 */
describe('Auth (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule, AuthModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    setupApp(app);
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
      // DB にはコードそのものを残さない
      const code = lastMailedOtp(email);
      expect(otp!.code_hash).not.toContain(code);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'a valid password!',
          display_name: `e2euser${Date.now()}`,
          otp_code: code,
        })
        .expect(201);

      expect(res.body.status).toMatch(/Registered successfully/);

      const created = await prisma.user.findUnique({ where: { email } });
      expect(created).not.toBeNull();
      // ホストの OS アカウントの作成やスクリプトの実行(sudo)をしない
      expect(childProcess.execFile).not.toHaveBeenCalled();
      expect(childProcess.execFileSync).not.toHaveBeenCalled();
      expect(childProcess.execSync).not.toHaveBeenCalled();
    });

    it('rejects a reserved account name through the real HTTP + DTO + service stack', async () => {
      const email = `e2e-reserved-${Date.now()}@u-aizu.ac.jp`;
      await request(app.getHttpServer())
        .post('/api/v1/auth/send-otp')
        .send({ email })
        .expect(200);
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'a valid password!',
          display_name: 'admin',
          otp_code: lastMailedOtp(email),
        });

      expect(res.status).toBe(409);
    });
  });

  describe('POST /auth/forgot-password', () => {
    beforeEach(async () => {
      await prisma.auditLog.deleteMany({
        where: { action: 'forgot_password_req' },
      });
    });

    const ask = (email: string, ip: string) =>
      request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .set('CF-Connecting-IP', ip)
        .send({ email });

    it('接続元は Cloudflare の CF-Connecting-IP で数え、ほかの人の申請で止まらない', async () => {
      // 以前は全員の接続元が Pi の中(::1)に見え、サイト全体で1時間10回までになっていた
      for (let i = 0; i < 10; i++) {
        await ask(`nobody${i}@example.com`, `203.0.113.${i}`).expect(200);
      }
      await ask('someone-else@example.com', '198.51.100.7').expect(200);

      const logged = await prisma.auditLog.findMany({
        where: { action: 'forgot_password_req' },
      });
      expect(logged.map((l) => (l.metadata as { ip: string }).ip)).toContain(
        '198.51.100.7',
      );
    });

    it('同じ接続元からは、1時間に10回まで', async () => {
      for (let i = 0; i < 10; i++) {
        await ask(`nobody${i}@example.com`, '203.0.113.50').expect(200);
      }
      await ask('another@example.com', '203.0.113.50').expect(429);
    });

    it('同じメールアドレスへは、接続元を変えても1時間に10回まで', async () => {
      for (let i = 0; i < 10; i++) {
        await ask('target@example.com', `203.0.113.${100 + i}`).expect(200);
      }
      await ask('target@example.com', '198.51.100.99').expect(429);
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
