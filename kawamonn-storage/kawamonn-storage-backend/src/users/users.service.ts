import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User, Prisma } from '@prisma/client';
import { execFileSync } from 'child_process';
import { SshService } from '../ssh/ssh.service';

/**
 * 利用者フォルダを保管して消すスクリプト。root で実行するので sudo の許可が要る(本番の pi は全権を持つ)。
 * sudo には絶対パスで渡す
 */
export const DELETE_USER_SCRIPT =
  '/home/pi/hdd/ssh/kawamonn-storage/kawamonn-storage-backend/scripts/delete_user.sh';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private sshService: SshService,
  ) {}

  /**
   * 利用者の端末のコンテナを消し、利用者フォルダを保管してから消す(DELETE_USER_SCRIPT)。
   * コンテナの記録(SshContainer)をたどって消すので、User を消す前に呼ぶこと。
   */
  async deprovisionUser(account_name: string): Promise<void> {
    try {
      await this.sshService.removeUserContainers(account_name);
    } catch (e) {
      this.logger.warn(
        `Failed to remove containers for ${account_name}: ${(e as Error).message}`,
      );
    }

    try {
      execFileSync('sudo', [DELETE_USER_SCRIPT, account_name, 'archive']);
    } catch (e) {
      this.logger.error(
        `User storage cleanup failed for ${account_name}: ${e.message}`,
      );
    }
  }

  async findOne(
    userWhereUniqueInput: Prisma.UserWhereUniqueInput,
  ): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: userWhereUniqueInput,
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findByAccountName(account_name: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { account_name },
    });
  }

  async createUser(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({
      data,
    });
  }

  async updateUser(params: {
    where: Prisma.UserWhereUniqueInput;
    data: Prisma.UserUpdateInput;
  }): Promise<User> {
    const { where, data } = params;
    return this.prisma.user.update({
      data,
      where,
    });
  }

  async deleteUser(where: Prisma.UserWhereUniqueInput): Promise<User> {
    return this.prisma.user.delete({
      where,
    });
  }

  async createOtp(email: string, code: string): Promise<void> {
    const expires_at = new Date();
    expires_at.setMinutes(expires_at.getMinutes() + 10);
    await this.prisma.otpCode.create({
      data: { email, code, expires_at },
    });
  }

  async verifyOtp(email: string, code: string): Promise<boolean> {
    const otp = await this.prisma.otpCode.findFirst({
      where: {
        email,
        code,
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: 'desc' },
    });

    if (otp) {
      await this.prisma.otpCode.delete({ where: { id: otp.id } });
      return true;
    }
    return false;
  }
}
