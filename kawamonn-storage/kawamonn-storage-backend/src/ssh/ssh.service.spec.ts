import { Test, TestingModule } from '@nestjs/testing';
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
  sshContainer: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
};

describe('SshService', () => {
  let service: SshService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [SshService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<SshService>(SshService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  const notFound = () =>
    Object.assign(new Error('no such network'), { statusCode: 404 });

  it('provisionContainer はコンテナのポートを公開せず、backend の UID を渡す', async () => {
    // ホストの実ディレクトリを作らないよう、存在チェックを常に true にする
    const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    try {
      mockPrisma.user.findUnique.mockResolvedValue({ role: 'user' });
      mockPrisma.sshContainer.create.mockResolvedValue({ container_id: 'c' });
      const docker = (service as any).docker;
      docker.getNetwork.mockReturnValue({
        inspect: jest.fn().mockResolvedValue({}),
      });
      docker.createContainer.mockResolvedValue({
        start: jest.fn().mockResolvedValue(undefined),
      });

      await service.provisionContainer('alice');

      const opts = docker.createContainer.mock.calls[0][0];
      expect(opts.HostConfig.PortBindings).toBeUndefined();
      // コンテナの起動時に、backend の UID へホームの読み書きを許可させる(entrypoint.sh)
      expect(opts.Env).toContain(`BACKEND_UID=${process.getuid!()}`);
    } finally {
      existsSpy.mockRestore();
    }
  });

  describe('端末のコンテナ専用のネットワーク', () => {
    let docker: any;
    let existsSpy: jest.SpyInstance;

    beforeEach(() => {
      existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      docker = (service as any).docker;
      mockPrisma.user.findUnique.mockResolvedValue({ role: 'user' });
      mockPrisma.sshContainer.create.mockResolvedValue({ container_id: 'new' });
      docker.createContainer.mockResolvedValue({
        start: jest.fn().mockResolvedValue(undefined),
      });
    });
    afterEach(() => existsSpy.mockRestore());

    it('コンテナは専用のネットワークに入れ、公開の DNS を使う', async () => {
      docker.getNetwork.mockReturnValue({
        inspect: jest.fn().mockResolvedValue({}),
      });
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

    it('専用のネットワークに入っていない以前のコンテナは、消して作り直す', async () => {
      docker.getNetwork.mockReturnValue({
        inspect: jest.fn().mockResolvedValue({}),
      });
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

      await expect(service.ensureContainerRunning('alice')).resolves.toBe(
        'new',
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
  });
});
