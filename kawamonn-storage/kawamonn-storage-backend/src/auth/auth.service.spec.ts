import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcrypt';
import * as nodemailer from 'nodemailer';

// AuthService's constructor calls nodemailer.createTransport() unconditionally —
// mock the module so no real SMTP transport (or env var read) happens in tests.
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({ sendMail: jest.fn().mockResolvedValue(undefined) }),
}));

jest.mock('argon2');
jest.mock('bcrypt');

const mockUsersService = {
  findByAccountName: jest.fn(),
  findByEmail: jest.fn(),
  createOtp: jest.fn(),
  verifyOtp: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('signed.jwt.token'),
};

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn(), aggregate: jest.fn(), create: jest.fn() },
  auditLog: { findMany: jest.fn(), create: jest.fn() },
  passwordResetToken: { deleteMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendOtp', () => {
    it('rejects emails outside the @u-aizu.ac.jp domain', async () => {
      await expect(service.sendOtp('someone@gmail.com')).rejects.toThrow(BadRequestException);
      expect(mockUsersService.createOtp).not.toHaveBeenCalled();
    });

    it('rejects an email that is already registered', async () => {
      mockUsersService.findByEmail.mockResolvedValue({ id: 'existing-user' });
      await expect(service.sendOtp('s1234567@u-aizu.ac.jp')).rejects.toThrow(ConflictException);
    });

    it('generates an OTP and emails it on success', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);
      const result = await service.sendOtp('s1234567@u-aizu.ac.jp');
      expect(mockUsersService.createOtp).toHaveBeenCalledWith(
        's1234567@u-aizu.ac.jp',
        expect.stringMatching(/^\d{6}$/),
      );
      const transporter = (nodemailer.createTransport as jest.Mock).mock.results[0].value;
      expect(transporter.sendMail).toHaveBeenCalled();
      expect(result).toEqual({ status: 'OTP Sent successfully' });
    });
  });

  describe('register', () => {
    it('rejects a registration attempt with no OTP code', async () => {
      await expect(service.register({ email: 'a@u-aizu.ac.jp', password: 'x', display_name: 'a' } as any))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid or expired OTP code', async () => {
      mockUsersService.verifyOtp.mockResolvedValue(false);
      await expect(
        service.register({ email: 'a@u-aizu.ac.jp', password: 'x', display_name: 'a', otp_code: '000000' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a reserved account name even with a valid OTP', async () => {
      mockUsersService.verifyOtp.mockResolvedValue(true);
      await expect(
        service.register({
          email: 'a@u-aizu.ac.jp',
          password: 'validpassword1',
          display_name: 'admin',
          otp_code: '123456',
        } as any),
      ).rejects.toThrow(ConflictException);
      // Must fail before ever touching the DB transaction.
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('validateUser', () => {
    it('throws for a nonexistent account', async () => {
      mockUsersService.findByAccountName.mockResolvedValue(null);
      await expect(service.validateUser('ghost', 'x')).rejects.toThrow(UnauthorizedException);
    });

    it('verifies via argon2 when the stored hash uses the argon2 prefix', async () => {
      mockUsersService.findByAccountName.mockResolvedValue({
        id: 'u1', account_name: 'alice', password_hash: '$argon2id$v=19$...',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('alice', 'correct-password');

      expect(argon2.verify).toHaveBeenCalledWith('$argon2id$v=19$...', 'correct-password');
      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(result.password_hash).toBeUndefined(); // stripped from the returned user
    });

    it('falls back to bcrypt for a legacy (non-argon2) hash', async () => {
      mockUsersService.findByAccountName.mockResolvedValue({
        id: 'u1', account_name: 'alice', password_hash: '$2b$10$legacyhash',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.validateUser('alice', 'correct-password');

      expect(bcrypt.compare).toHaveBeenCalledWith('correct-password', '$2b$10$legacyhash');
      expect(argon2.verify).not.toHaveBeenCalled();
    });

    it('throws on a wrong password without revealing which check failed', async () => {
      mockUsersService.findByAccountName.mockResolvedValue({
        id: 'u1', account_name: 'alice', password_hash: '$argon2id$v=19$...',
      });
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(service.validateUser('alice', 'wrong-password')).rejects.toThrow(UnauthorizedException);
    });
  });
});
