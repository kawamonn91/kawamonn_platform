import * as fs from 'fs';
import * as path from 'path';
import { StorageUsageService } from './storage-usage.service';

const SSH_BASE = process.env.SSH_BASE as string;

describe('StorageUsageService', () => {
  const prisma = {
    user: { findMany: jest.fn(), update: jest.fn() },
  };
  let service: StorageUsageService;
  const user = `usage${process.pid}`;
  const home = path.join(SSH_BASE, 'users', user);

  beforeEach(() => {
    jest.clearAllMocks();
    fs.rmSync(home, { recursive: true, force: true });
    service = new StorageUsageService(prisma as any);
  });

  afterAll(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('利用者フォルダの実際の中身(隠しファイルを含む)を測って保存する', async () => {
    fs.mkdirSync(path.join(home, '.venv'), { recursive: true });
    fs.writeFileSync(path.join(home, 'a.txt'), '12345');
    fs.writeFileSync(path.join(home, '.venv', 'x'), '123');
    const bytes = await service.recalculate({
      id: 'u1',
      account_name: user,
      role: 'user',
    });
    expect(bytes).toBe(8);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { used_bytes: 8n },
    });
  });

  it('利用者フォルダが無ければ 0', async () => {
    await expect(
      service.recalculate({ id: 'u1', account_name: user, role: 'user' }),
    ).resolves.toBe(0);
  });

  it('全員分を測り直し、1人が失敗しても続ける。削除済みの利用者は対象外', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'bad', account_name: '..', role: 'user' },
      { id: 'u1', account_name: user, role: 'user' },
    ]);
    await service.recalculateAll();
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { not: 'deleted' } } }),
    );
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' } }),
    );
  });

  it('増減分を足す。0 なら DB に触れない', async () => {
    await service.adjust('u1', 0);
    expect(prisma.user.update).not.toHaveBeenCalled();
    await service.adjust('u1', -5);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { used_bytes: { increment: -5n } },
    });
  });
});
