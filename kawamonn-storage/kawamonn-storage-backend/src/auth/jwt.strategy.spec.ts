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
});
