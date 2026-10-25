import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { safeUsage } from '../common/safe-fs';
import { userHomePath } from '../common/user-home';

/**
 * 利用者ごとの使用量(User.used_bytes)を、利用者フォルダの実際の中身から測る。
 *
 * ファイルは HDD の利用者フォルダだけに置き、Web からも端末からも同じフォルダを使う。
 * 端末からの書き込みは backend を通らないので、使用量は定期的に測り直す。
 * Web からの保存は、測った使用量に今回の増加分を足して上限(quota_bytes)を超えるなら断る。
 * 隠しファイル(.venv など)も、ディスクを使っている分として数える。
 */
@Injectable()
export class StorageUsageService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StorageUsageService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    // 起動を待たせないよう、測り直しは裏で行う
    void this.recalculateAll();
  }

  /** 利用者1人分を測り直して保存し、バイト数を返す */
  async recalculate(user: {
    id: string;
    account_name: string;
    role: string;
  }): Promise<number> {
    const home = userHomePath(user.account_name, user.role === 'admin');
    const bytes = fs.existsSync(home) ? safeUsage(home) : 0;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { used_bytes: BigInt(bytes) },
    });
    return bytes;
  }

  /** 全員分を測り直す(10分ごと)。前回が終わっていなければ何もしない */
  @Cron('*/10 * * * *')
  async recalculateAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const start = Date.now();
    try {
      const users = await this.prisma.user.findMany({
        where: { status: { not: 'deleted' } },
        select: { id: true, account_name: true, role: true },
      });
      for (const user of users) {
        try {
          await this.recalculate(user);
        } catch (e) {
          this.logger.warn(
            `Usage recalculation failed for ${user.account_name}: ${e.message}`,
          );
        }
      }
      const elapsed = Date.now() - start;
      this.logger.log(
        `Recalculated usage for ${users.length} users in ${elapsed}ms`,
      );
    } catch (e) {
      this.logger.warn(`Usage recalculation failed: ${e.message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Web からの操作で増減した分を足す(次の測り直しで実際の値に戻る)。0 を下回らないよう GREATEST で防ぐ。
   * Prisma は文字列の値を text として渡すので、uuid の列と比べるには ::uuid が要る
   * (無いと「operator does not exist: uuid = text」で失敗し、アップロード・削除が 500 になる)
   */
  async adjust(userId: string, deltaBytes: number): Promise<void> {
    if (deltaBytes === 0) return;
    await this.prisma
      .$executeRaw`UPDATE "User" SET used_bytes = GREATEST(used_bytes + ${BigInt(deltaBytes)}, 0) WHERE id = ${userId}::uuid`;
  }
}
