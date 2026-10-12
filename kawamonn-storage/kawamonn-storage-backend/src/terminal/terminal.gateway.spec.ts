import { Logger } from '@nestjs/common';
import { TerminalGateway } from './terminal.gateway';

const mockJwt = { verify: jest.fn() };
const mockPrisma = { user: { findUnique: jest.fn() } };

function makeClient(token?: string) {
  return {
    id: 'client-1',
    handshake: { auth: token ? { token } : {}, query: {} },
    data: {} as Record<string, unknown>,
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
}

describe('TerminalGateway.handleConnection', () => {
  let gateway: TerminalGateway;

  beforeAll(() => {
    // 接続拒否時の warn ログでテスト出力を汚さない
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new TerminalGateway(mockJwt as any, {} as any, mockPrisma as any);
  });

  it('トークンが無ければ切断する', async () => {
    const client = makeClient();
    await gateway.handleConnection(client as any);
    expect(client.disconnect).toHaveBeenCalled();
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('署名が不正なトークンなら切断する', async () => {
    mockJwt.verify.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    const client = makeClient('bad');
    await gateway.handleConnection(client as any);
    expect(client.disconnect).toHaveBeenCalled();
    expect(client.data.username).toBeUndefined();
  });

  it('有効なトークンでも、ユーザーが DB に存在しなければ切断する', async () => {
    mockJwt.verify.mockReturnValue({ sub: 'u1', account_name: 'alice' });
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const client = makeClient('ok');
    await gateway.handleConnection(client as any);
    expect(client.disconnect).toHaveBeenCalled();
    expect(client.data.username).toBeUndefined();
  });

  it('期限切れで失効(status=deleted)したユーザーは切断する', async () => {
    mockJwt.verify.mockReturnValue({ sub: 'u1', account_name: 'alice' });
    mockPrisma.user.findUnique.mockResolvedValue({
      account_name: 'alice',
      role: 'user',
      status: 'deleted',
    });
    const client = makeClient('ok');
    await gateway.handleConnection(client as any);
    expect(client.disconnect).toHaveBeenCalled();
    expect(client.data.username).toBeUndefined();
  });

  it('有効なユーザーなら、トークンではなく DB の値で username/role を設定する', async () => {
    mockJwt.verify.mockReturnValue({
      sub: 'u1',
      account_name: 'stale-name',
      role: 'admin',
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      account_name: 'alice',
      role: 'user',
      status: 'active',
    });
    const client = makeClient('ok');
    await gateway.handleConnection(client as any);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' } }),
    );
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.data.username).toBe('alice');
    expect(client.data.role).toBe('user');
  });
});
