import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import { SANDBOX_NETWORK, SshService } from './ssh.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('dockerode', () =>
  jest.fn().mockImplementation(() => ({
    getContainer: jest.fn(),
    createContainer: jest.fn(),
    getNetwork: jest.fn(),
    createNetwork: jest.fn(),
  })),
);

const mockPrisma = {
  user: { findUnique: jest.fn() },
  sshContainer: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const notFound = () =>
  Object.assign(new Error('no such object'), { statusCode: 404 });

describe('SshService', () => {
  let service: SshService;
  let docker: any;
  let existsSpy: jest.SpyInstance;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [SshService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<SshService>(SshService);
    docker = (service as any).docker;
    // ホストの実ディレクトリを作らないよう、存在チェックを常に true にする
    existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    mockPrisma.user.findUnique.mockResolvedValue({ role: 'user' });
    mockPrisma.sshContainer.findMany.mockResolvedValue([]);
    mockPrisma.sshContainer.create.mockResolvedValue({});
    docker.getNetwork.mockReturnValue({
      inspect: jest.fn().mockResolvedValue({}),
    });
    docker.createContainer.mockResolvedValue({
      start: jest.fn().mockResolvedValue(undefined),
    });
  });
  afterEach(() => existsSpy.mockRestore());

  describe('provisionContainer', () => {
    it('ポートを公開せず、backend の UID と UTF-8 の locale を渡し、sshd ではなく待機だけさせる', async () => {
      const name = await service.provisionContainer('alice');

      expect(name).toMatch(/^kawamonn-ssh-alice-[0-9a-f]{6}$/);
      const opts = docker.createContainer.mock.calls[0][0];
      expect(opts.HostConfig.PortBindings).toBeUndefined();
      // コンテナの起動時に、backend の UID へホームの読み書きを許可させる(entrypoint.sh)
      expect(opts.Env).toContain(`BACKEND_UID=${process.getuid!()}`);
      expect(opts.Env).toContain('LANG=C.UTF-8');
      expect(opts.Env.some((e: string) => e.startsWith('PUBLIC_KEY'))).toBe(
        false,
      );
      expect(opts.Cmd).toEqual(['sleep', 'infinity']);
      expect(opts.HostConfig.Init).toBe(true);
      expect(opts.HostConfig.Binds).toEqual([
        expect.stringMatching(/\/users\/alice:\/home\/alice:rw$/),
      ]);
      expect(mockPrisma.sshContainer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          username: 'alice',
          container_id: name,
          cpu_limit: '0.5',
          memory_limit: '512m',
        }),
      });
    });

    it('以前のコンテナと記録を消してから作る', async () => {
      const old = { remove: jest.fn().mockResolvedValue(undefined) };
      docker.getContainer.mockReturnValue(old);
      mockPrisma.sshContainer.findMany.mockResolvedValue([
        { id: 'r1', container_id: 'old-1' },
        { id: 'r2', container_id: 'old-2' },
      ]);

      await service.provisionContainer('alice');

      expect(old.remove).toHaveBeenCalledTimes(2);
      expect(mockPrisma.sshContainer.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['r1', 'r2'] } },
      });
      expect(docker.createContainer).toHaveBeenCalledTimes(1);
    });

    it('DB にいない利用者には作らない', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.provisionContainer('ghost')).rejects.toThrow(
        'Account not found',
      );
      expect(docker.createContainer).not.toHaveBeenCalled();
    });

    it.each(['..', '.', '-rf', 'a/b'])(
      'パスにならない利用者名は通さない: %j',
      async (name) => {
        await expect(service.provisionContainer(name)).rejects.toThrow();
        expect(docker.createContainer).not.toHaveBeenCalled();
      },
    );
  });

  describe('removeUserContainers', () => {
    it('Docker から消えていたコンテナの記録も消し、消せなかったものの記録は残す', async () => {
      docker.getContainer.mockImplementation((id: string) => ({
        remove: jest
          .fn()
          .mockImplementation(() =>
            id === 'gone'
              ? Promise.reject(notFound())
              : id === 'stuck'
                ? Promise.reject(new Error('device busy'))
                : Promise.resolve(),
          ),
      }));
      mockPrisma.sshContainer.findMany.mockResolvedValue([
        { id: 'r1', container_id: 'ok' },
        { id: 'r2', container_id: 'gone' },
        { id: 'r3', container_id: 'stuck' },
        { id: 'r4', container_id: null },
      ]);

      await service.removeUserContainers('alice');

      expect(mockPrisma.sshContainer.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['r1', 'r2', 'r4'] } },
      });
    });
  });

  describe('端末のコンテナ専用のネットワーク', () => {
    it('コンテナは専用のネットワークに入れ、公開の DNS を使う', async () => {
      await service.provisionContainer('alice');
      const opts = docker.createContainer.mock.calls[0][0];
      expect(opts.HostConfig.NetworkMode).toBe(SANDBOX_NETWORK);
      expect(opts.HostConfig.Dns).toEqual(['1.1.1.1', '1.0.0.1']);
      expect(docker.createNetwork).not.toHaveBeenCalled();
    });

    it('ネットワークが無ければ、決まった名前・範囲で、コンテナ同士の通信を止めて作る', async () => {
      docker.getNetwork.mockReturnValue({
        inspect: jest.fn().mockRejectedValue(notFound()),
      });
      await service.provisionContainer('alice');
      expect(docker.createNetwork).toHaveBeenCalledWith(
        expect.objectContaining({
          Name: SANDBOX_NETWORK,
          IPAM: { Config: [{ Subnet: '172.30.0.0/24' }] },
          Options: {
            'com.docker.network.bridge.name': 'kw-sandbox',
            'com.docker.network.bridge.enable_icc': 'false',
          },
        }),
      );
    });
  });

  describe('ensureContainerRunning', () => {
    it('専用のネットワークに入っていない以前のコンテナは、消して作り直す', async () => {
      const old = {
        inspect: jest.fn().mockResolvedValue({
          State: { Status: 'running' },
          NetworkSettings: { Networks: { bridge: {} } },
        }),
        remove: jest.fn().mockResolvedValue(undefined),
        start: jest.fn(),
      };
      docker.getContainer.mockReturnValue(old);
      mockPrisma.sshContainer.findFirst.mockResolvedValue({
        id: '1',
        container_id: 'old',
      });
      mockPrisma.sshContainer.findMany.mockResolvedValue([
        { id: '1', container_id: 'old' },
      ]);

      await expect(service.ensureContainerRunning('alice')).resolves.toMatch(
        /^kawamonn-ssh-alice-/,
      );
      expect(old.remove).toHaveBeenCalledWith({ force: true });
      expect(docker.createContainer).toHaveBeenCalledTimes(1);
    });

    it('専用のネットワークに入っている停止中のコンテナは、そのまま起動する', async () => {
      const existing = {
        inspect: jest.fn().mockResolvedValue({
          State: { Status: 'exited' },
          NetworkSettings: { Networks: { [SANDBOX_NETWORK]: {} } },
        }),
        remove: jest.fn(),
        start: jest.fn().mockResolvedValue(undefined),
      };
      docker.getContainer.mockReturnValue(existing);
      mockPrisma.sshContainer.findFirst.mockResolvedValue({
        id: '1',
        container_id: 'kept',
      });

      await expect(service.ensureContainerRunning('alice')).resolves.toBe(
        'kept',
      );
      expect(existing.start).toHaveBeenCalled();
      expect(existing.remove).not.toHaveBeenCalled();
      expect(docker.createContainer).not.toHaveBeenCalled();
    });

    it('同じ利用者について同時に呼ばれても、コンテナは1つだけ作る', async () => {
      mockPrisma.sshContainer.findFirst.mockResolvedValue(null);

      const [a, b] = await Promise.all([
        service.ensureContainerRunning('alice'),
        service.ensureContainerRunning('alice'),
      ]);

      expect(a).toBe(b);
      expect(docker.createContainer).toHaveBeenCalledTimes(1);
      // 終わったあとは、次の呼び出しで改めて確かめる
      await service.ensureContainerRunning('alice');
      expect(mockPrisma.sshContainer.findFirst).toHaveBeenCalledTimes(2);
    });
  });
});
