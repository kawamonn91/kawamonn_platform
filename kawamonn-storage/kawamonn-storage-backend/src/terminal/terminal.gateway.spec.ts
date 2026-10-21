import { Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
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

  it('有効なユーザーなら、トークンではなく DB の値で username を設定する', async () => {
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
    // 役割は端末では使わない(管理者かどうかは HTTP 側の JwtStrategy だけが決める)
    expect(client.data.role).toBeUndefined();
  });
});

describe('TerminalGateway の端末セッション', () => {
  let gateway: TerminalGateway;
  let ssh: { ensureContainerRunning: jest.Mock; createExecSession: jest.Mock };
  let stream: EventEmitter & { write: jest.Mock; destroy: jest.Mock };
  let exec: { resize: jest.Mock };

  function connectedClient() {
    return {
      id: 'client-1',
      connected: true,
      data: { username: 'alice' } as Record<string, unknown>,
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
  }
  const outputs = (client: ReturnType<typeof connectedClient>) =>
    client.emit.mock.calls
      .filter(([event]) => event === 'output')
      .map(([, text]) => text as string);

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    stream = Object.assign(new EventEmitter(), {
      write: jest.fn(),
      destroy: jest.fn(),
    });
    exec = { resize: jest.fn().mockResolvedValue(undefined) };
    ssh = {
      ensureContainerRunning: jest.fn().mockResolvedValue('container-1'),
      createExecSession: jest.fn().mockResolvedValue({ exec, stream }),
    };
    gateway = new TerminalGateway({} as any, ssh as any, {} as any);
  });

  it('UTF-8 の文字が途中で区切られて届いても、文字化けさせずに送る', async () => {
    const client = connectedClient();
    await gateway.handleStart(client as any, { cols: 100, rows: 30 });

    const bytes = Buffer.from('こんにちは\n');
    stream.emit('data', bytes.subarray(0, 4)); // 「こ」の3バイト + 「ん」の1バイト目
    stream.emit('data', bytes.subarray(4));

    expect(outputs(client).join('')).toContain('こんにちは\n');
    expect(outputs(client).join('')).not.toContain('�');
    expect(ssh.createExecSession).toHaveBeenCalledWith(
      'container-1',
      'alice',
      100,
      30,
    );
  });

  it('「開始」が続けて届いても、セッションは1つだけ作る', async () => {
    const client = connectedClient();
    await Promise.all([
      gateway.handleStart(client as any, {}),
      gateway.handleStart(client as any, {}),
    ]);
    expect(ssh.createExecSession).toHaveBeenCalledTimes(1);
  });

  it('用意している間に画面が閉じられたら、作ったセッションを閉じる', async () => {
    const client = connectedClient();
    ssh.ensureContainerRunning.mockImplementation(async () => {
      client.connected = false;
      return 'container-1';
    });
    await gateway.handleStart(client as any, {});
    expect(stream.destroy).toHaveBeenCalled();
    expect(client.emit).not.toHaveBeenCalledWith('ready');
  });

  it('文字列でない入力は書き込まず、おかしな大きさは既定値にそろえる', async () => {
    const client = connectedClient();
    await gateway.handleStart(client as any, { cols: -5, rows: 1e9 });
    expect(ssh.createExecSession).toHaveBeenCalledWith(
      'container-1',
      'alice',
      80,
      1000,
    );

    gateway.handleInput(client as any, { input: { evil: true } } as any);
    expect(stream.write).not.toHaveBeenCalled();
    gateway.handleInput(client as any, { input: 'ls\r' });
    expect(stream.write).toHaveBeenCalledWith('ls\r');

    await gateway.handleResize(client as any, { cols: 120.7, rows: 0 });
    expect(exec.resize).toHaveBeenCalledWith({ w: 120, h: 24 });
  });

  it('切断したら、セッションを閉じる', async () => {
    const client = connectedClient();
    await gateway.handleStart(client as any, {});
    gateway.handleDisconnect(client as any);
    expect(stream.destroy).toHaveBeenCalled();
    gateway.handleInput(client as any, { input: 'x' });
    expect(stream.write).not.toHaveBeenCalled();
  });
});
