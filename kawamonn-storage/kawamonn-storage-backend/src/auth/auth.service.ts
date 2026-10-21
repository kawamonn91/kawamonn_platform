import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { Prisma, User } from '@prisma/client';
import { isReservedAccountName } from '../common/reserved-names';
import {
  ACCOUNT_NAME_RULE_MESSAGE,
  isValidAccountName,
} from '../common/account-name';
import { hashPassword, needsRehash, verifyPassword } from '../common/password';

/** 管理者ログインの確認コードの送り先。どの管理者のログインでも運営者に送る(運営者の決定) */
const ADMIN_OTP_TO = 'kawamonn91@gmail.com';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  async validateUser(account_name: string, pass: string) {
    const user = await this.usersService.findByAccountName(account_name);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await verifyPassword(user.password_hash, pass);

    // 期限切れで削除(status=deleted)になったアカウントは、パスワードが合っていても拒否する。
    // パスワードの照合後に、照合失敗と同じエラーで返し、アカウントの状態を推測させない。
    if (!isMatch || user.status === 'deleted') {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 古い形式(bcrypt)のハッシュは、正しいパスワードが分かったこの機会に argon2 で作り直す
    if (needsRehash(user.password_hash)) {
      try {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { password_hash: await hashPassword(pass) },
        });
      } catch (e) {
        this.logger.warn(`Rehash failed for ${user.account_name}: ${e}`);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash, ...result } = user;
    return result;
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(
      loginDto.account_name,
      loginDto.password,
    );

    const payload = {
      account_name: user.account_name,
      sub: user.id,
      role: 'user',
    };
    return {
      token: this.jwtService.sign(payload),
    };
  }

  async sendOtp(email: string) {
    if (!email.endsWith('@u-aizu.ac.jp')) {
      throw new BadRequestException(
        'Only @u-aizu.ac.jp addresses are allowed to register.',
      );
    }
    const existingEmail = await this.usersService.findByEmail(email);
    if (existingEmail) {
      throw new ConflictException('Email already in use.');
    }

    // Use CSPRNG for OTP generation (crypto.randomInt is cryptographically secure)
    const code = crypto.randomInt(100000, 1000000).toString();
    await this.usersService.createOtp(email, code);

    await this.mail.send({
      fromName: 'UoA Online',
      to: email,
      subject: 'Your Registration OTP',
      text: `Your Kawamonn verification code is: ${code}`,
    });

    return { status: 'OTP Sent successfully' };
  }

  async register(registerDto: RegisterDto) {
    if (!registerDto.otp_code) {
      throw new BadRequestException('OTP code required');
    }

    const isValid = await this.usersService.verifyOtp(
      registerDto.email,
      registerDto.otp_code,
    );
    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired OTP code');
    }

    const account_name =
      (registerDto.display_name || '').trim() ||
      registerDto.email.split('@')[0];

    if (!isValidAccountName(account_name)) {
      throw new BadRequestException(ACCOUNT_NAME_RULE_MESSAGE);
    }
    if (isReservedAccountName(account_name)) {
      throw new ConflictException(
        'This account name is reserved and cannot be used.',
      );
    }

    // Hash password BEFORE the transaction (argon2 is CPU-intensive ~200ms)
    // to minimize time spent holding the SERIALIZABLE lock.
    const hashedPassword = await hashPassword(registerDto.password);

    // Calculate expiry_at for @u-aizu.ac.jp accounts (4 years)
    // Migrated from: Flask register app (apps/register/app.py)
    let expiryAt: Date | undefined;
    if (registerDto.email.toLowerCase().endsWith('@u-aizu.ac.jp')) {
      expiryAt = new Date();
      expiryAt.setFullYear(expiryAt.getFullYear() + 4);
    }

    // === SERIALIZABLE Transaction ===
    // All DB reads and writes are atomic to prevent race conditions on:
    //   - account_name uniqueness
    //   - email uniqueness
    let newUser: User;
    try {
      newUser = await this.prisma.$transaction(
        async (tx) => {
          // Check email uniqueness inside transaction
          const existingEmail = await tx.user.findUnique({
            where: { email: registerDto.email },
          });
          if (existingEmail) {
            throw new ConflictException('Email already registered.');
          }

          // Check account_name uniqueness inside transaction
          const existingAccount = await tx.user.findUnique({
            where: { account_name },
          });
          if (existingAccount) {
            throw new ConflictException(
              'Account name already mapped to another user.',
            );
          }

          // Create user atomically
          return tx.user.create({
            data: {
              email: registerDto.email,
              account_name,
              password_hash: hashedPassword,
              role: 'user',
              expiry_at: expiryAt,
              password_last_set_at: new Date(),
            },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10000, // 10s timeout for the transaction
        },
      );
    } catch (error) {
      // Re-throw ConflictException as-is (from our own checks)
      if (error instanceof ConflictException) {
        throw error;
      }
      // Handle Prisma unique constraint violation (P2002)
      // This catches race conditions that slip past our checks
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = (error.meta?.target as string[]) || [];
        if (target.includes('email')) {
          throw new ConflictException('Email already registered.');
        }
        if (target.includes('account_name')) {
          throw new ConflictException('Account name already in use.');
        }
        throw new ConflictException('Registration conflict. Please try again.');
      }
      // Any other unexpected error
      this.logger.error('Registration transaction failed', error);
      throw error;
    }

    // ホストの OS アカウントは作らない(2026-10 に SSH 接続の入口を廃止し、端末はブラウザからだけにした)。
    // 利用者フォルダは、ファイルブラウザか端末を初めて使うときに作られる。容量の上限は
    // StorageUsageService が使用量を測って守る(ディスクの容量制限の機能は使わない)
    return {
      user_id: newUser.id,
      status: 'Registered successfully. Proceed to login.',
    };
  }

  async adminLogin(loginDto: LoginDto) {
    const user = await this.validateUser(
      loginDto.account_name,
      loginDto.password,
    );
    if (user.role !== 'admin') {
      throw new UnauthorizedException(
        'Access denied. User is not an administrator.',
      );
    }

    // Use CSPRNG for admin OTP (admin account requires stronger security)
    const code = crypto.randomInt(100000, 1000000).toString();
    await this.usersService.createOtp(user.email, code);

    await this.mail.send({
      fromName: 'Kawamonn Security',
      to: ADMIN_OTP_TO,
      subject: 'Admin Login OTP',
      text: `An admin login attempt to ${user.account_name}. Verification code is: ${code}`,
    });

    return { status: 'OTP Sent to admin email' };
  }

  async adminVerify(account_name: string, otp_code: string) {
    const user = await this.usersService.findByAccountName(account_name);
    if (!user || user.role !== 'admin') {
      throw new UnauthorizedException('Access denied');
    }

    const isValid = await this.usersService.verifyOtp(user.email, otp_code);
    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired OTP code');
    }

    const payload = {
      account_name: user.account_name,
      sub: user.id,
      role: user.role,
    };
    return {
      token: this.jwtService.sign(payload),
    };
  }

  async forgotPassword(email: string, ip: string) {
    if (!email) {
      throw new BadRequestException('Email is required');
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 同じメールアドレス、または同じ接続元からの申請は、1時間に10回まで
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const rateLimitCount = await this.prisma.auditLog.count({
      where: {
        action: 'forgot_password_req',
        created_at: { gte: oneHourAgo },
        OR: [
          { metadata: { path: ['email'], equals: normalizedEmail } },
          { metadata: { path: ['ip'], equals: ip } },
        ],
      },
    });

    if (rateLimitCount >= 10) {
      throw new HttpException(
        'Too many password reset requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.prisma.auditLog.create({
      data: {
        action: 'forgot_password_req',
        target_type: 'auth',
        metadata: { email: normalizedEmail, ip },
      },
    });

    const user = await this.usersService.findByEmail(normalizedEmail);
    if (!user) {
      // Prevent user enumeration by returning a generic success message
      return {
        status: 'If an account exists, a password reset link has been sent.',
      };
    }

    // Invalidate any existing unused reset tokens for this user before creating a new one
    await this.prisma.passwordResetToken.deleteMany({
      where: { user_id: user.id, used: false },
    });

    // Generate secure 64-char hex token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    // Expiration: 1 hour
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    await this.prisma.passwordResetToken.create({
      data: {
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
      },
    });

    const resetLink = `https://storage.kawamonn.com/reset?token=${resetToken}`;

    try {
      await this.mail.send({
        fromName: 'UoA Online',
        to: normalizedEmail,
        subject: 'Password Reset Request',
        text: `Please click the link below to securely reset your password. This link will expire in 1 hour.\n\n${resetLink}`,
        html: `<p>Please click the link below to securely reset your password. This link will expire in 1 hour.</p><p><a href="${resetLink}"><strong>Reset Password</strong></a></p>`,
      });
    } catch (error) {
      this.logger.error('Failed to send password reset email', error);
    }

    return {
      status: 'If an account exists, a password reset link has been sent.',
    };
  }

  async resetPassword(token: string, new_password: string, ip: string) {
    if (!token || !new_password || new_password.length < 8) {
      throw new BadRequestException(
        'Invalid token or password does not meet requirements',
      );
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const resetRecord = await this.prisma.passwordResetToken.findUnique({
      where: { token_hash: tokenHash },
      include: { user: true },
    });

    if (
      !resetRecord ||
      resetRecord.used ||
      resetRecord.expires_at < new Date()
    ) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const hashedPassword = await hashPassword(new_password);

    // Update user and mark token as used
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetRecord.user_id },
        data: {
          password_hash: hashedPassword,
          password_last_set_at: new Date(),
        },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { used: true },
      }),
    ]);

    await this.prisma.auditLog.create({
      data: {
        action: 'password_reset_success',
        target_type: 'auth',
        actor_id: resetRecord.user_id,
        metadata: { account_name: resetRecord.user.account_name, ip },
      },
    });

    await this.mail.send({
      fromName: 'UoA Online / Kawamonn Storage',
      to: resetRecord.user.email,
      subject: 'Your Password Has Been Reset',
      text: `Your password was successfully reset just now.\n\nIf you did not perform this action, please contact support immediately.`,
    });

    return { status: 'Password reset successfully. You can now log in.' };
  }
}
