import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { AuthUser } from '../auth/current-user.decorator';
import { generateTempPassword } from '../common/random-password';
import { hashPassword } from '../common/password';
import {
  assertAssignableAccountName,
  normalizeEmail,
} from '../common/account-name';
import {
  USER_LIST_FIELDS,
  serializeUserSummary,
} from '../common/user-serializer';
import { CreateUserDto } from './dto/create-user.dto';

/** 容量の単位。画面の「GB」も 1024^3 バイトで数える(DB の既定の 20GiB = 21474836480 と同じ) */
const GIB = BigInt(1024) ** BigInt(3);

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

/**
 * 管理画面の操作。利用者を変える操作は、だれが(actor)行ったかを AuditLog に残す。
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
    private mail: MailService,
  ) {}

  private audit(
    actor: AuthUser,
    action: string,
    targetId: string,
    metadata: Prisma.InputJsonObject,
  ) {
    return this.prisma.auditLog.create({
      data: {
        action,
        target_type: 'user',
        target_id: targetId,
        actor_id: actor.id,
        metadata: { by: actor.account_name, ...metadata },
      },
    });
  }

  private async findUserOrThrow(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** 利用者の一覧(名前かメールアドレスの一部で絞り込める) */
  async listUsers(search: string | undefined, page = 1, perPage = 50) {
    const take = Math.min(Math.max(perPage || 50, 1), 200);
    const current = Math.max(page || 1, 1);
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { account_name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_LIST_FIELDS,
        orderBy: { created_at: 'asc' },
        skip: (current - 1) * take,
        take,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: users.map(serializeUserSummary),
      total_count: total,
      page: current,
      per_page: take,
    };
  }

  /** 利用者の詳細と、その人が行った操作・その人に対して行われた操作の記録(新しい順に50件) */
  async getUserDetail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...USER_LIST_FIELDS,
        last_reminder_sent: true,
        password_last_set_at: true,
        updated_at: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const auditLogs = await this.prisma.auditLog.findMany({
      where: { OR: [{ actor_id: id }, { target_id: id }] },
      orderBy: { created_at: 'desc' },
      take: 50,
    });

    return {
      ...serializeUserSummary(user),
      updated_at: user.updated_at.toISOString(),
      last_reminder_sent: user.last_reminder_sent?.toISOString() ?? null,
      password_last_set_at: user.password_last_set_at?.toISOString() ?? null,
      audit_logs: auditLogs.map((log) => ({
        ...log,
        created_at: log.created_at.toISOString(),
      })),
    };
  }

  /** 利用者を作る。パスワードを省くと仮パスワードを作って返す(一度だけ表示する) */
  async createUser(dto: CreateUserDto, actor: AuthUser) {
    const email = normalizeEmail(dto.email);
    const account_name = dto.account_name || email.split('@')[0];
    assertAssignableAccountName(account_name);
    const password = dto.password || generateTempPassword();

    let created;
    try {
      created = await this.prisma.user.create({
        data: {
          email,
          account_name,
          password_hash: await hashPassword(password),
          role: dto.role || 'user',
          password_last_set_at: new Date(),
          ...(dto.quota_gb ? { quota_bytes: BigInt(dto.quota_gb) * GIB } : {}),
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException('Account name or email already in use.');
      }
      throw e;
    }
    await this.audit(actor, 'admin_create_user', created.id, {
      account_name,
      role: created.role,
    });

    return {
      id: created.id,
      account_name: created.account_name,
      temporary_password: dto.password ? undefined : password,
    };
  }

  /** メールアドレスを変える */
  async updateEmail(id: string, rawEmail: string, actor: AuthUser) {
    const email = normalizeEmail(rawEmail);
    const user = await this.findUserOrThrow(id);
    try {
      await this.prisma.user.update({ where: { id }, data: { email } });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException('Email already in use.');
      }
      throw e;
    }
    await this.audit(actor, 'admin_update_email', id, {
      account_name: user.account_name,
      old_email: user.email,
      new_email: email,
    });
    return { status: 'updated' };
  }

  /** 利用者を消す(端末のコンテナ、利用者フォルダは保管してから消し、最後に DB の行)。自分自身は消せない */
  async deleteUser(id: string, actor: AuthUser) {
    if (id === actor.id) {
      throw new BadRequestException('You cannot delete your own account.');
    }
    const user = await this.findUserOrThrow(id);

    // DB の行より先に、端末のコンテナと利用者フォルダを片付ける(コンテナの記録をたどるため)
    await this.usersService.deprovisionUser(
      user.account_name,
      user.role ?? 'user',
    );
    await this.prisma.user.delete({ where: { id } });
    await this.audit(actor, 'admin_delete_user', id, {
      account_name: user.account_name,
      email: user.email,
    });
    return { status: 'deleted' };
  }

  /** 仮パスワードを作って設定し、返す(画面で一度だけ表示する) */
  async resetPassword(id: string, actor: AuthUser) {
    const user = await this.findUserOrThrow(id);
    const tempPassword = generateTempPassword();

    await this.prisma.user.update({
      where: { id },
      data: {
        password_hash: await hashPassword(tempPassword),
        password_last_set_at: new Date(),
      },
    });
    await this.audit(actor, 'admin_reset_password', id, {
      account_name: user.account_name,
    });

    return {
      temporary_password: tempPassword,
      account_name: user.account_name,
    };
  }

  /** 容量の上限を変える(GiB) */
  async updateQuota(id: string, quotaGb: number, actor: AuthUser) {
    const user = await this.findUserOrThrow(id);
    const quotaBytes = BigInt(quotaGb) * GIB;

    await this.prisma.user.update({
      where: { id },
      data: { quota_bytes: quotaBytes },
    });
    await this.audit(actor, 'admin_update_quota', id, {
      account_name: user.account_name,
      old_quota: user.quota_bytes.toString(),
      new_quota: quotaBytes.toString(),
    });

    return { status: 'updated', quota_bytes: quotaBytes.toString() };
  }

  /** 有効な利用者全員に、BCC で同じメールを送る(期限切れで削除済みの人には送らない) */
  async broadcastEmail(subject: string, message: string, actor: AuthUser) {
    const users = await this.prisma.user.findMany({
      where: { status: 'active' },
      select: { email: true },
    });
    const emails = users.map((u) => u.email).filter((e) => e);
    if (emails.length === 0) return { status: 'No users to email' };

    try {
      await this.mail.send({
        fromName: 'Kawamonn Platform Admin',
        bcc: emails,
        subject,
        text: message,
      });
    } catch (e) {
      this.logger.error('Failed to broadcast email', e);
      throw new InternalServerErrorException('Failed to send broadcast email');
    }
    await this.prisma.auditLog.create({
      data: {
        action: 'admin_broadcast',
        target_type: 'all_users',
        actor_id: actor.id,
        metadata: {
          by: actor.account_name,
          subject,
          recipients: emails.length,
        },
      },
    });

    return {
      status: 'Broadcast sent successfully',
      recipientCount: emails.length,
    };
  }
}
