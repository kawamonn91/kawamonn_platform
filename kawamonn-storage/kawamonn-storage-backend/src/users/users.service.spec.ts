import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { SshService } from '../ssh/ssh.service';
import * as child_process from 'child_process';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

const mockPrisma = {
  user: { findUnique: jest.fn() },
  otpCode: {
    create: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
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
    (child_process.execFile as unknown as jest.Mock).mockImplementation(
      (_cmd, _args, cb) => cb?.(null, '', ''),
    );
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
      expect(child_process.execFile).toHaveBeenCalledWith(
        'sudo',
        expect.arrayContaining(['alice', 'archive']),
        expect.any(Function),
      );
    });

    it('コンテナを消せなくても、利用者フォルダの片付けは続ける', async () => {
      mockSsh.removeUserContainers.mockRejectedValue(new Error('docker down'));

      await service.deprovisionUser('alice');

      expect(child_process.execFile).toHaveBeenCalled();
    });

    it('delete_user.sh が失敗しても例外にしない', async () => {
      (child_process.execFile as unknown as jest.Mock).mockImplementationOnce(
        (_cmd, _args, cb) => {
          cb?.(new Error('script failed'));
        },
      );

      await expect(service.deprovisionUser('alice')).resolves.toBeUndefined();
    });
  });

  describe('verifyOtp', () => {
    it('有効な確認コードを1回だけ消費し、競合した2回目は false にする', async () => {
      mockPrisma.otpCode.deleteMany
        .mockResolvedValueOnce({ count: 0 }) // 期限切れ掃除
        .mockResolvedValueOnce({ count: 1 }); // 対象コードの原子的削除
      mockPrisma.otpCode.findFirst.mockResolvedValue({
        id: 'otp-1',
        email: 'alice@u-aizu.ac.jp',
        code: '123456',
      });

      await expect(
        service.verifyOtp('alice@u-aizu.ac.jp', '123456'),
      ).resolves.toBe(true);
      expect(mockPrisma.otpCode.deleteMany).toHaveBeenLastCalledWith({
        where: { id: 'otp-1' },
      });

      // 同時に届いた別のリクエストで既に消されていた場合(count === 0)
      mockPrisma.otpCode.deleteMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 0 });
      await expect(
        service.verifyOtp('alice@u-aizu.ac.jp', '123456'),
      ).resolves.toBe(false);
    });
  });
});
