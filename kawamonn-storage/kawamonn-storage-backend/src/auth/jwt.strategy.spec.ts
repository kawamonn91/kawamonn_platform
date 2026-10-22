import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

const mockPrisma = { user: { findUnique: jest.fn() } };

describe('JwtStrategy.validate', () => {
  let strategy: JwtStrategy;
  const originalSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = 'unit-test-secret-at-least-16-chars';
  });

  afterAll(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(mockPrisma as any);
  });

  it('有効なユーザーなら、DB の値でユーザー情報を返す', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      account_name: 'alice',
      email: 'alice@u-aizu.ac.jp',
      role: 'user',
      status: 'active',
    });

    await expect(strategy.validate({ sub: 'u1' })).resolves.toEqual({
      id: 'u1',
      account_name: 'alice',
      email: 'alice@u-aizu.ac.jp',
      role: 'user',
    });
  });

  it('管理者でも、通常のログインのトークン(role: user)なら一般の利用者として扱う', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'a1',
      account_name: 'boss',
      email: 'boss@example.com',
      role: 'admin',
      status: 'active',
    });
    await expect(
      strategy.validate({ sub: 'a1', role: 'user' }),
    ).resolves.toMatchObject({ role: 'user' });
  });

  it('確認コードを通したトークン(role: admin)で、DB でも管理者なら管理者として扱う', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'a1',
      account_name: 'boss',
      email: 'boss@example.com',
      role: 'admin',
      status: 'active',
    });
    await expect(
      strategy.validate({ sub: 'a1', role: 'admin' }),
    ).resolves.toMatchObject({ role: 'admin' });
  });

  it('トークンに role: admin とあっても、DB で管理者でなくなっていれば一般の利用者として扱う', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      account_name: 'alice',
      email: 'alice@u-aizu.ac.jp',
      role: 'user',
      status: 'active',
    });
    await expect(
      strategy.validate({ sub: 'u1', role: 'admin' }),
    ).resolves.toMatchObject({ role: 'user' });
  });

  it('ユーザーが DB に存在しなければ拒否する', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(strategy.validate({ sub: 'u1' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('期限切れで削除(status=deleted)になったユーザーは、トークンが有効でも拒否する', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      account_name: 'alice',
      email: 'alice@u-aizu.ac.jp',
      role: 'user',
      status: 'deleted',
    });
    await expect(strategy.validate({ sub: 'u1' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('パスワード変更より前に発行されたトークン(iat < password_last_set_at)は拒否する', async () => {
    const passwordSetAt = new Date('2026-10-22T00:00:10.500Z');
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      account_name: 'alice',
      email: 'alice@u-aizu.ac.jp',
      role: 'user',
      status: 'active',
      password_last_set_at: passwordSetAt,
    });
    const issuedBeforeSec = Math.floor(passwordSetAt.getTime() / 1000) - 1;
    await expect(
      strategy.validate({ sub: 'u1', iat: issuedBeforeSec }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('パスワード設定と同じ秒(または後)に発行されたトークンは受け付ける', async () => {
    const passwordSetAt = new Date('2026-10-22T00:00:10.850Z');
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      account_name: 'alice',
      email: 'alice@u-aizu.ac.jp',
      role: 'user',
      status: 'active',
      password_last_set_at: passwordSetAt,
    });
    const sameSecondSec = Math.floor(passwordSetAt.getTime() / 1000);
    await expect(
      strategy.validate({ sub: 'u1', iat: sameSecondSec }),
    ).resolves.toMatchObject({ id: 'u1', account_name: 'alice' });
  });
});
