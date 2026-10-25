import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';

jest.mock('../common/password', () => ({
  hashPassword: jest.fn().mockResolvedValue('$argon2id$hashed'),
}));

const mockPrisma = {
  user: {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  auditLog: { create: jest.fn(), findMany: jest.fn() },
};
const mockUsersService = { deprovisionUser: jest.fn() };
const mockMail = { send: jest.fn() };

const me = {
  id: 'admin-1',
  account_name: 'boss',
  email: 'boss@example.com',
  role: 'admin',
};
const GIB = BigInt(1024) ** BigInt(3);

describe('AdminService', () => {
  let service: AdminService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: UsersService, useValue: mockUsersService },
        { provide: MailService, useValue: mockMail },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      account_name: 'alice',
      email: 'alice@u-aizu.ac.jp',
      role: 'user',
      quota_bytes: BigInt(20) * GIB,
    });
  });

  describe('createUser', () => {
    it.each(['..', '.', '-rf'])(
      'フォルダの外を指したりオプションに見えたりする名前 %j では作らない',
      async (account_name) => {
        await expect(
          service.createUser({ email: 'x@u-aizu.ac.jp', account_name }, me),
        ).rejects.toThrow(BadRequestException);
        expect(mockPrisma.user.create).not.toHaveBeenCalled();
      },
    );

    it('名前を省くとメールアドレスの @ の前を使うが、その場合も検査する', async () => {
      await expect(
        service.createUser({ email: '.hidden@example.com' }, me),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('argon2 でハッシュを作り、容量は GiB で数え、だれが作ったかを記録する', async () => {
      mockPrisma.user.create.mockResolvedValue({
        id: 'new',
        account_name: 'carol',
        role: 'user',
      });

      const res = await service.createUser(
        { email: 'carol@example.com', quota_gb: 30 },
        me,
      );

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          account_name: 'carol',
          password_hash: '$argon2id$hashed',
          quota_bytes: BigInt(30) * GIB,
        }),
      });
      expect(res.temporary_password).toMatch(/^.{12}$/);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'admin_create_user',
          actor_id: 'admin-1',
          target_id: 'new',
        }),
      });
    });

    it('予約された名前は作らない', async () => {
      await expect(
        service.createUser(
          { email: 'x@example.com', account_name: 'users' },
          me,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  it('自分自身は削除できない', async () => {
    await expect(service.deleteUser('admin-1', me)).rejects.toThrow(
      BadRequestException,
    );
    expect(mockUsersService.deprovisionUser).not.toHaveBeenCalled();
  });

  it('利用者の削除は、片付け → 行の削除 → 記録の順', async () => {
    const order: string[] = [];
    mockUsersService.deprovisionUser.mockImplementation(async () => {
      order.push('deprovision');
    });
    mockPrisma.user.delete.mockImplementation(async () => {
      order.push('delete');
    });
    mockPrisma.auditLog.create.mockImplementation(async () => {
      order.push('audit');
    });

    await service.deleteUser('u1', me);

    expect(order).toEqual(['deprovision', 'delete', 'audit']);
    expect(mockUsersService.deprovisionUser).toHaveBeenCalledWith(
      'alice',
      'user',
    );
  });

  it('容量は GiB で設定する(画面の 20 = DB の既定の 21474836480)', async () => {
    const res = await service.updateQuota('u1', 20, me);
    expect(res.quota_bytes).toBe('21474836480');
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { quota_bytes: BigInt('21474836480') },
    });
  });

  it('仮パスワードは argon2 で保存し、パスワードを設定した日時も更新する', async () => {
    const res = await service.resetPassword('u1', me);
    expect(res.temporary_password).toHaveLength(12);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        password_hash: '$argon2id$hashed',
        password_last_set_at: expect.any(Date),
      },
    });
  });

  it('一斉送信は有効な利用者だけに送り、記録する', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { email: 'a@example.com' },
      { email: 'b@example.com' },
    ]);

    const res = await service.broadcastEmail('件名', '本文', me);

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: { status: 'active' },
      select: { email: true },
    });
    expect(mockMail.send).toHaveBeenCalledWith(
      expect.objectContaining({ bcc: ['a@example.com', 'b@example.com'] }),
    );
    expect(res.recipientCount).toBe(2);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'admin_broadcast',
        actor_id: 'admin-1',
      }),
    });
  });

  it('一覧は常に items と件数で返し、1ページの件数は 200 までにする', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.user.count.mockResolvedValue(0);

    const res = await service.listUsers(undefined, 1, 100000);

    expect(res).toEqual({ items: [], total_count: 0, page: 1, per_page: 200 });
  });
});
