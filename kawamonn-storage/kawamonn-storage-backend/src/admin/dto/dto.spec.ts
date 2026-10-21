import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BroadcastDto } from './broadcast.dto';
import { CreateUserDto } from './create-user.dto';
import { UpdateQuotaDto } from './update-quota.dto';
import { UpdateUserDto } from './update-user.dto';

describe('BroadcastDto', () => {
  it('accepts a valid payload', async () => {
    const errors = await validate(
      plainToInstance(BroadcastDto, {
        subject: 'Notice',
        message: 'Hello everyone',
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects an empty subject', async () => {
    const errors = await validate(
      plainToInstance(BroadcastDto, { subject: '', message: 'Hello' }),
    );
    expect(errors.some((e) => e.property === 'subject')).toBe(true);
  });

  it('rejects a subject over 200 characters', async () => {
    const errors = await validate(
      plainToInstance(BroadcastDto, {
        subject: 'x'.repeat(201),
        message: 'Hello',
      }),
    );
    expect(errors.some((e) => e.property === 'subject')).toBe(true);
  });

  it('rejects a missing message', async () => {
    const errors = await validate(
      plainToInstance(BroadcastDto, { subject: 'Notice' }),
    );
    expect(errors.some((e) => e.property === 'message')).toBe(true);
  });
});

describe('CreateUserDto', () => {
  it('accepts a minimal valid payload (only email required)', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, { email: 'a@example.com' }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects a malformed email', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, { email: 'nope' }),
    );
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejects a password shorter than 8 characters when provided', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, {
        email: 'a@example.com',
        password: 'short',
      }),
    );
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('容量は GiB の整数で受け取る', async () => {
    const ok = await validate(
      plainToInstance(CreateUserDto, { email: 'a@example.com', quota_gb: 30 }),
    );
    expect(ok).toHaveLength(0);
    const bad = await validate(
      plainToInstance(CreateUserDto, { email: 'a@example.com', quota_gb: 1.5 }),
    );
    expect(bad.some((e) => e.property === 'quota_gb')).toBe(true);
  });

  it('パスにならない利用者名は受け付けない', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, {
        email: 'a@example.com',
        account_name: '..',
      }),
    );
    expect(errors.some((e) => e.property === 'account_name')).toBe(true);
  });

  it('rejects a role outside user/admin', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, {
        email: 'a@example.com',
        role: 'superuser',
      }),
    );
    expect(errors.some((e) => e.property === 'role')).toBe(true);
  });
});

describe('UpdateQuotaDto', () => {
  it('accepts a positive integer', async () => {
    const errors = await validate(
      plainToInstance(UpdateQuotaDto, { quota_gb: 20 }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects zero or negative values', async () => {
    const errors = await validate(
      plainToInstance(UpdateQuotaDto, { quota_gb: 0 }),
    );
    expect(errors.some((e) => e.property === 'quota_gb')).toBe(true);
  });

  it('大きすぎる値は受け付けない', async () => {
    const errors = await validate(
      plainToInstance(UpdateQuotaDto, { quota_gb: 1e9 }),
    );
    expect(errors.some((e) => e.property === 'quota_gb')).toBe(true);
  });

  it('rejects a non-integer', async () => {
    const errors = await validate(
      plainToInstance(UpdateQuotaDto, { quota_gb: 1.5 }),
    );
    expect(errors.some((e) => e.property === 'quota_gb')).toBe(true);
  });
});

describe('UpdateUserDto', () => {
  it('メールアドレスは必須(容量は POST /admin/users/:id/quota で変える)', async () => {
    const errors = await validate(plainToInstance(UpdateUserDto, {}));
    expect(errors.some((e) => e.property === 'email')).toBe(true);
    const ok = await validate(
      plainToInstance(UpdateUserDto, { email: 'a@example.com' }),
    );
    expect(ok).toHaveLength(0);
  });

  it('rejects a malformed email when provided', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserDto, { email: 'nope' }),
    );
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });
});
