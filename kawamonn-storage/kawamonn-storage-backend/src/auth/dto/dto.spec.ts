import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EmailDto } from './email.dto';
import { LoginDto } from './login.dto';
import { RegisterDto } from './register.dto';
import { ResetPasswordDto } from './reset-password.dto';
import { VerifyDto } from './verify.dto';
import { AdminVerifyDto } from './admin-verify.dto';

describe('EmailDto', () => {
    it('accepts a valid email', async () => {
        const errors = await validate(plainToInstance(EmailDto, { email: 'a@example.com' }));
        expect(errors).toHaveLength(0);
    });

    it('rejects a malformed email', async () => {
        const errors = await validate(plainToInstance(EmailDto, { email: 'not-an-email' }));
        expect(errors.length).toBeGreaterThan(0);
    });
});

describe('LoginDto', () => {
    it('accepts a valid payload', async () => {
        const errors = await validate(plainToInstance(LoginDto, { account_name: 'alice', password: 'hunter2' }));
        expect(errors).toHaveLength(0);
    });

    it('rejects a missing password', async () => {
        const errors = await validate(plainToInstance(LoginDto, { account_name: 'alice' }));
        expect(errors.some((e) => e.property === 'password')).toBe(true);
    });

    it('rejects an empty account_name', async () => {
        const errors = await validate(plainToInstance(LoginDto, { account_name: '', password: 'x' }));
        expect(errors.some((e) => e.property === 'account_name')).toBe(true);
    });
});

describe('RegisterDto', () => {
    const valid = { email: 's1234567@u-aizu.ac.jp', password: 'a valid password!', display_name: 'toya' };

    it('accepts a valid payload, including passwords with symbols/spaces', async () => {
        const errors = await validate(plainToInstance(RegisterDto, valid));
        expect(errors).toHaveLength(0);
    });

    it('rejects a password shorter than 8 characters', async () => {
        const errors = await validate(plainToInstance(RegisterDto, { ...valid, password: 'short' }));
        expect(errors.some((e) => e.property === 'password')).toBe(true);
    });

    it('rejects a display_name with disallowed characters', async () => {
        const errors = await validate(plainToInstance(RegisterDto, { ...valid, display_name: 'not valid!' }));
        expect(errors.some((e) => e.property === 'display_name')).toBe(true);
    });

    it('rejects a malformed email', async () => {
        const errors = await validate(plainToInstance(RegisterDto, { ...valid, email: 'nope' }));
        expect(errors.some((e) => e.property === 'email')).toBe(true);
    });
});

describe('ResetPasswordDto', () => {
    it('accepts a valid payload', async () => {
        const errors = await validate(plainToInstance(ResetPasswordDto, { token: 'abc123', new_password: 'newpassword1' }));
        expect(errors).toHaveLength(0);
    });

    it('rejects a new_password shorter than 8 characters', async () => {
        const errors = await validate(plainToInstance(ResetPasswordDto, { token: 'abc123', new_password: 'short' }));
        expect(errors.some((e) => e.property === 'new_password')).toBe(true);
    });

    it('rejects a missing token', async () => {
        const errors = await validate(plainToInstance(ResetPasswordDto, { new_password: 'newpassword1' }));
        expect(errors.some((e) => e.property === 'token')).toBe(true);
    });
});

describe('VerifyDto', () => {
    it('accepts a valid payload', async () => {
        const errors = await validate(plainToInstance(VerifyDto, { email: 'a@example.com', code: '123456' }));
        expect(errors).toHaveLength(0);
    });

    it('rejects a missing code', async () => {
        const errors = await validate(plainToInstance(VerifyDto, { email: 'a@example.com' }));
        expect(errors.some((e) => e.property === 'code')).toBe(true);
    });
});

describe('AdminVerifyDto', () => {
    it('accepts a valid payload', async () => {
        const errors = await validate(plainToInstance(AdminVerifyDto, { account_name: 'kawamonn', otp_code: '654321' }));
        expect(errors).toHaveLength(0);
    });

    it('rejects an empty otp_code', async () => {
        const errors = await validate(plainToInstance(AdminVerifyDto, { account_name: 'kawamonn', otp_code: '' }));
        expect(errors.some((e) => e.property === 'otp_code')).toBe(true);
    });
});
