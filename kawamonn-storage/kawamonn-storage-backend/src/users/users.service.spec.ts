import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import * as Docker from 'dockerode';
import * as child_process from 'child_process';

jest.mock('dockerode', () =>
  jest.fn().mockImplementation(() => ({
    getContainer: jest.fn().mockReturnValue({
      stop: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    }),
  })),
);

jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
}));

const mockPrisma = {
  user: { findUnique: jest.fn(), findByAccountName: jest.fn() },
  otpCode: { create: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
  sshContainer: { findMany: jest.fn(), deleteMany: jest.fn() },
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('deprovisionUser', () => {
    it('stops and removes every container found, then runs delete_user.sh with the account name', async () => {
      mockPrisma.sshContainer.findMany.mockResolvedValue([
        { container_id: 'container-1' },
        { container_id: 'container-2' },
      ]);

      await service.deprovisionUser('alice');

      const dockerInstance = (Docker as unknown as jest.Mock).mock.results[0].value;
      expect(dockerInstance.getContainer).toHaveBeenCalledWith('container-1');
      expect(dockerInstance.getContainer).toHaveBeenCalledWith('container-2');
      expect(dockerInstance.getContainer).toHaveBeenCalledTimes(2);

      expect(child_process.execFileSync).toHaveBeenCalledWith(
        'sudo',
        expect.arrayContaining(['alice', 'archive']),
      );
    });

    it('skips containers with no container_id', async () => {
      mockPrisma.sshContainer.findMany.mockResolvedValue([{ container_id: null }]);

      await service.deprovisionUser('alice');

      const dockerInstance = (Docker as unknown as jest.Mock).mock.results[0].value;
      expect(dockerInstance.getContainer).not.toHaveBeenCalled();
    });

    it('does not throw when the delete_user.sh script fails', async () => {
      mockPrisma.sshContainer.findMany.mockResolvedValue([]);
      (child_process.execFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('script failed');
      });

      await expect(service.deprovisionUser('alice')).resolves.toBeUndefined();
    });
  });
});
