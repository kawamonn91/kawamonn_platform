import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { User, Prisma } from '@prisma/client';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { SshService } from '../ssh/ssh.service';
import { hashPassword, verifyPassword } from '../common/password';

const execFileAsync = promisify(execFile);

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
    private jwtService: JwtService,
  ) {}

  /**
   * 利用者の端末のコンテナを消し、利用者フォルダを保管してから消す(DELETE_USER_SCRIPT)。
   * コンテナの記録(SshContainer)をたどって消すので、User を消す前に呼ぶこと。
   */
  async deprovisionUser(
    account_name: string,
    role: string = 'user',
  ): Promise<void> {
    try {
      await this.sshService.removeUserContainers(account_name);
    } catch (e) {
      this.logger.warn(
        `Failed to remove containers for ${account_name}: ${(e as Error).message}`,
      );
    }

    try {
      await execFileAsync('sudo', [
        DELETE_USER_SCRIPT,
        account_name,
        'archive',
        role,
      ]);
    } catch (e) {
      this.logger.error(
        `User storage cleanup failed for ${account_name}: ${(e as Error).message}`,
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

  /** 今のパスワードを確かめてから、新しいパスワードにする。失効を防ぐため新しいトークンを発行して返す */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    role: string = 'user',
  ): Promise<{ token: string }> {
    const user = await this.findOne({ id: userId });
    if (!user) throw new BadRequestException('User not found');
    if (!(await verifyPassword(user.password_hash, currentPassword))) {
      throw new BadRequestException('現在のパスワードが正しくありません');
    }
    const now = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        password_hash: await hashPassword(newPassword),
        password_last_set_at: now,
      },
    });

    const payload = {
      account_name: user.account_name,
      sub: user.id,
      role: role === 'admin' ? 'admin' : 'user',
    };
    return { token: this.jwtService.sign(payload) };
  }

  /** 利用者が自分のアカウントを消す(端末のコンテナ、利用者フォルダは保管してから消し、最後に DB の行) */
  async deleteAccount(userId: string): Promise<void> {
    const user = await this.findOne({ id: userId });
    if (!user) throw new BadRequestException('User not found');
    await this.deprovisionUser(user.account_name, user.role);
    await this.prisma.user.delete({ where: { id: userId } });
  }

  /** 確認コードを作る(10分有効)。同じメールアドレスの前のコードは無効にする */
  async createOtp(email: string, code: string): Promise<void> {
    const expires_at = new Date();
    expires_at.setMinutes(expires_at.getMinutes() + 10);
    await this.prisma.otpCode.deleteMany({ where: { email } });
    await this.prisma.otpCode.create({
      data: { email, code, expires_at },
    });
  }

  async verifyOtp(email: string, code: string): Promise<boolean> {
    const now = new Date();
    await this.prisma.otpCode.deleteMany({
      where: { email, expires_at: { lte: now } },
    });
    const otp = await this.prisma.otpCode.findFirst({
      where: {
        email,
        code,
        expires_at: { gt: now },
      },
      orderBy: { created_at: 'desc' },
    });

    if (!otp) return false;
    const deleted = await this.prisma.otpCode.deleteMany({
      where: { id: otp.id },
    });
    return deleted.count === 1;
  }
}
