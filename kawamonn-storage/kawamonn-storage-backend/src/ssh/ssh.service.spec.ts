import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import { SshService } from './ssh.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('dockerode', () =>
  jest.fn().mockImplementation(() => ({
    getContainer: jest.fn(),
    createContainer: jest.fn(),
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

  it('provisionContainer はコンテナの 22 番をループバック(127.0.0.1)にだけ公開する', async () => {
    // ホストの実ディレクトリを作らないよう、存在チェックを常に true にする
    const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    try {
      mockPrisma.user.findUnique.mockResolvedValue({ role: 'user' });
      mockPrisma.sshContainer.create.mockResolvedValue({ container_id: 'c' });
      const docker = (service as any).docker;
      docker.createContainer.mockResolvedValue({
        start: jest.fn().mockResolvedValue(undefined),
      });

      await service.provisionContainer('alice');

      const opts = docker.createContainer.mock.calls[0][0];
      expect(opts.HostConfig.PortBindings['22/tcp']).toEqual([
        { HostIp: '127.0.0.1', HostPort: '0' },
      ]);
    } finally {
      existsSpy.mockRestore();
    }
  });
});
