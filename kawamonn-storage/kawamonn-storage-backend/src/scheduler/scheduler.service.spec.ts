import { Logger } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';

describe('SchedulerService.purgeExpiredCodes', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('期限の切れた確認コードと、使い終わった・期限の切れた再設定用トークンを消す', async () => {
    const prisma = {
      otpCode: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
      passwordResetToken: {
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const service = new SchedulerService(prisma as any, {} as any, {} as any);

    await service.purgeExpiredCodes();

    expect(prisma.otpCode.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { expires_at: { lt: expect.any(Date) } },
          { consumed_at: { not: null } },
        ],
      },
    });
    expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ used: true }, { expires_at: { lt: expect.any(Date) } }] },
    });
  });
});
