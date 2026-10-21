import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { SshService } from '../ssh/ssh.service';
import * as child_process from 'child_process';

jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
}));

const mockPrisma = {
  user: { findUnique: jest.fn() },
  otpCode: { create: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
};
const mockSsh = { removeUserContainers: jest.fn() };

describe('UsersService', () => {
  let service: UsersService;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SshService, useValue: mockSsh },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('deprovisionUser', () => {
    it('端末のコンテナを消してから、delete_user.sh で利用者フォルダを保管して消す', async () => {
      await service.deprovisionUser('alice');

      expect(mockSsh.removeUserContainers).toHaveBeenCalledWith('alice');
      expect(child_process.execFileSync).toHaveBeenCalledWith(
        'sudo',
        expect.arrayContaining(['alice', 'archive']),
      );
    });

    it('コンテナを消せなくても、利用者フォルダの片付けは続ける', async () => {
      mockSsh.removeUserContainers.mockRejectedValue(new Error('docker down'));

      await service.deprovisionUser('alice');

      expect(child_process.execFileSync).toHaveBeenCalled();
    });

    it('delete_user.sh が失敗しても例外にしない', async () => {
      (child_process.execFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('script failed');
      });

      await expect(service.deprovisionUser('alice')).resolves.toBeUndefined();
    });
  });
});
