import { Injectable, UnauthorizedException, BadRequestException, ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyDto } from './dto/verify.dto';
import * as bcrypt from 'bcrypt';
import * as argon2 from 'argon2';
import * as nodemailer from 'nodemailer';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
    private transporter: nodemailer.Transporter;

    constructor(
        private usersService: UsersService,
        private jwtService: JwtService,
        private prisma: PrismaService
    ) {
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '465', 10),
            secure: true,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }

    async validateUser(account_name: string, pass: string): Promise<any> {
        const user = await this.usersService.findByAccountName(account_name);
        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        let isMatch = false;
        try {
            if (user.password_hash.startsWith('$argon2')) {
                isMatch = await argon2.verify(user.password_hash, pass);
            } else {
                isMatch = await bcrypt.compare(pass, user.password_hash);
            }
        } catch (e) {
            console.error('Error during password verification fallback', e);
        }

        if (user && isMatch) {
            const { password_hash, ...result } = user;
            return result;
        }
        throw new UnauthorizedException('Invalid credentials');
    }

    async login(loginDto: LoginDto) {
        const user = await this.validateUser(loginDto.account_name, loginDto.password);

        const payload = { account_name: user.account_name, sub: user.id, role: 'user' };
        return {
            token: this.jwtService.sign(payload),
            refresh_token: this.jwtService.sign(payload, { expiresIn: '30d' })
        };
    }

    async sendOtp(email: string) {
        if (!email.endsWith('@u-aizu.ac.jp')) {
            throw new BadRequestException('Only @u-aizu.ac.jp addresses are allowed to register.');
        }
        const existingEmail = await this.usersService.findByEmail(email);
        if (existingEmail) {
            throw new ConflictException('Email already in use.');
        }

        // Use CSPRNG for OTP generation (crypto.randomInt is cryptographically secure)
        const code = crypto.randomInt(100000, 1000000).toString();
        await this.usersService.createOtp(email, code);

        await this.transporter.sendMail({
            from: `"UoA Online" <${process.env.SMTP_USER}>`,
            to: email, // Routes over Postfix to local inbox or via relay
            subject: 'Your Registration OTP',
            text: `Your Kawamonn verification code is: ${code}`,
        });

        return { status: 'OTP Sent successfully' };
    }

    async register(registerDto: RegisterDto & { otp_code?: string }) {
        if (!registerDto.otp_code) {
            throw new BadRequestException('OTP code required');
        }

        const isValid = await this.usersService.verifyOtp(registerDto.email, registerDto.otp_code);
        if (!isValid) {
            throw new UnauthorizedException('Invalid or expired OTP code');
        }

        const account_name = (registerDto.display_name || '').trim() || registerDto.email.split('@')[0];

        const existingAccount = await this.usersService.findByAccountName(account_name);
        if (existingAccount) {
            throw new ConflictException('Account name already mapped to another user.');
        }

        const hashedPassword = await argon2.hash(registerDto.password);

        // Calculate expiry_at for @u-aizu.ac.jp accounts (4 years)
        // Migrated from: Flask register app (apps/register/app.py)
        let expiryAt: Date | undefined;
        if (registerDto.email.toLowerCase().endsWith('@u-aizu.ac.jp')) {
            expiryAt = new Date();
            expiryAt.setFullYear(expiryAt.getFullYear() + 4);
        }

        // Allocate fs_project_id for ext4 project quota
        // Migrated from: Flask register app (project_id = 10000 + user_id)
        const maxProjectId = await this.prisma.user.aggregate({
            _max: { fs_project_id: true },
        });
        const fsProjectId = (maxProjectId._max.fs_project_id ?? 9999) + 1;

        const newUser = await this.usersService.createUser({
            email: registerDto.email,
            account_name,
            password_hash: hashedPassword,
            role: 'user',
            expiry_at: expiryAt,
            fs_project_id: fsProjectId,
            password_last_set_at: new Date(),
        });

        // Sync to host for SSH access
        try {
            const { execFileSync } = require('child_process');
            // Create host user with gateway shell (use argument array to prevent command injection)
            execFileSync('sudo', ['useradd', '-m', '-s', '/usr/local/bin/ssh-gateway.sh', account_name]);
            execFileSync('sudo', ['usermod', '-aG', 'kawamonn-users', account_name]);
            execFileSync('sudo', ['usermod', '-aG', 'docker', account_name]);
            // Set initial password via stdin (never via shell interpolation)
            execFileSync('sudo', ['chpasswd'], {
                input: `${account_name}:${registerDto.password}\n`
            });

            // Create user directory and set ext4 project quota
            // Migrated from: Flask register app (subprocess.check_call(['sudo', script_path, ...]))
            execFileSync('sudo', [
                '/home/pi/hdd/ssh/kawamonn-storage/kawamonn-storage-backend/scripts/create_user_dir.sh',
                account_name,
                String(fsProjectId),
                String(newUser.quota_bytes),
            ]);
        } catch (e) {
            console.warn('Host user creation during registration failed (non-critical):', e.message);
        }

        return { user_id: newUser.id, status: 'Registered successfully. Proceed to login.' };
    }

    async adminLogin(loginDto: LoginDto) {
        const user = await this.validateUser(loginDto.account_name, loginDto.password);
        if (user.role !== 'admin') {
            throw new UnauthorizedException('Access denied. User is not an administrator.');
        }

        // Use CSPRNG for admin OTP (admin account requires stronger security)
        const code = crypto.randomInt(100000, 1000000).toString();
        await this.usersService.createOtp(user.email, code);

        await this.transporter.sendMail({
            from: `"Kawamonn Security" <${process.env.SMTP_USER}>`,
            to: 'kawamonn91@gmail.com', // User requested all admin OTPs sent to this specific address
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

        const payload = { account_name: user.account_name, sub: user.id, role: user.role };
        return {
            token: this.jwtService.sign(payload),
            refresh_token: this.jwtService.sign(payload, { expiresIn: '30d' })
        };
    }

    async forgotPassword(email: string, ip: string) {
        if (!email) {
            throw new BadRequestException('Email is required');
        }

        const normalizedEmail = email.trim().toLowerCase();

        // --- Rate Limiting Check ---
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentLogs = await this.prisma.auditLog.findMany({
            where: {
                action: 'forgot_password_req',
                created_at: { gte: oneHourAgo }
            }
        });
        
        const rateLimitCount = recentLogs.filter(log => {
            const meta = log.metadata as any;
            return meta?.email === normalizedEmail || meta?.ip === ip;
        }).length;

        if (rateLimitCount >= 10) {
            throw new HttpException('Too many password reset requests. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
        }

        await this.prisma.auditLog.create({
            data: {
                action: 'forgot_password_req',
                target_type: 'auth',
                metadata: { email: normalizedEmail, ip }
            }
        });

        const user = await this.usersService.findByEmail(normalizedEmail);
        if (!user) {
            // Prevent user enumeration by returning a generic success message
            return { status: 'If an account exists, a password reset link has been sent.' };
        }

        // Invalidate any existing unused reset tokens for this user before creating a new one
        await this.prisma.passwordResetToken.deleteMany({
            where: { user_id: user.id, used: false }
        });

        // Generate secure 64-char hex token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
        
        // Expiration: 1 hour
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1);

        await this.prisma.passwordResetToken.create({
            data: {
                user_id: user.id,
                token_hash: tokenHash,
                expires_at: expiresAt
            }
        });

        const resetLink = `https://storage.kawamonn.com/reset?token=${resetToken}`;

        try {
            await this.transporter.sendMail({
                from: `"UoA Online" <${process.env.SMTP_USER}>`,
                to: normalizedEmail,
                subject: 'Password Reset Request',
                text: `Please click the link below to securely reset your password. This link will expire in 1 hour.\n\n${resetLink}`,
                html: `<p>Please click the link below to securely reset your password. This link will expire in 1 hour.</p><p><a href="${resetLink}"><strong>Reset Password</strong></a></p>`,
            });
        } catch (error) {
            console.error('Failed to send password reset email:', error);
        }

        return { status: 'If an account exists, a password reset link has been sent.' };
    }

    async resetPassword(token: string, new_password: string, ip: string) {
        if (!token || !new_password || new_password.length < 8) {
            throw new BadRequestException('Invalid token or password does not meet requirements');
        }

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        const resetRecord = await this.prisma.passwordResetToken.findUnique({
            where: { token_hash: tokenHash },
            include: { user: true }
        });

        if (!resetRecord || resetRecord.used || resetRecord.expires_at < new Date()) {
            throw new BadRequestException('Invalid or expired reset token');
        }

        // Hash new password using Argon2 (consistent with registration)
        const hashedPassword = await argon2.hash(new_password);

        // Update user and mark token as used
        await this.prisma.$transaction([
            this.prisma.user.update({
                where: { id: resetRecord.user_id },
                data: { password_hash: hashedPassword }
            }),
            this.prisma.passwordResetToken.update({
                where: { id: resetRecord.id },
                data: { used: true }
            })
        ]);

        try {
            const { execFileSync } = require('child_process');
            // Use argument array to prevent command injection (never interpolate into shell strings)
            execFileSync('sudo', ['chpasswd'], {
                input: `${resetRecord.user.account_name}:${new_password}\n`
            });
        } catch (e) {
            console.warn('Host user password sync failed:', e.message);
        }

        await this.prisma.auditLog.create({
            data: {
                action: 'password_reset_success',
                target_type: 'auth',
                actor_id: resetRecord.user_id,
                metadata: { account_name: resetRecord.user.account_name, ip }
            }
        });

        await this.transporter.sendMail({
            from: `"UoA Online / Kawamonn Storage" <${process.env.SMTP_USER}>`,
            to: resetRecord.user.email,
            subject: 'Your Password Has Been Reset',
            text: `Your password was successfully reset just now.\n\nIf you did not perform this action, please contact support immediately.`,
        });

        return { status: 'Password reset successfully. You can now log in.' };
    }
}
