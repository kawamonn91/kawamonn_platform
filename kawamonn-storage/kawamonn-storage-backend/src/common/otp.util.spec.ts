import { createHash } from 'node:crypto';
import {
  generateOtpCode,
  hashOtpCode,
  OTP_TTL_MINUTES,
  MAX_OTP_FAILED_ATTEMPTS,
} from './otp.util';

describe('otp.util', () => {
  it('generates a 6-digit numeric string', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
      const num = parseInt(code, 10);
      expect(num).toBeGreaterThanOrEqual(100000);
      expect(num).toBeLessThan(1000000);
    }
  });

  it('hashes OTP code deterministically using HMAC-SHA256', () => {
    const hash1 = hashOtpCode('123456');
    const hash2 = hashOtpCode('123456');
    const hash3 = hashOtpCode('654321');
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(64); // SHA-256 hex is 64 chars
  });

  it('塩なしの SHA-256 ではなく、サーバーの秘密鍵で変わる(DB の値からコードを割り出せない)', () => {
    const plain = createHash('sha256').update('123456').digest('hex');
    expect(hashOtpCode('123456')).not.toBe(plain);
    const original = process.env.JWT_SECRET;
    try {
      const before = hashOtpCode('123456');
      process.env.JWT_SECRET = 'another-secret-for-this-test-0000';
      expect(hashOtpCode('123456')).not.toBe(before);
    } finally {
      process.env.JWT_SECRET = original;
    }
  });

  it('trims whitespace when hashing', () => {
    expect(hashOtpCode('  123456  ')).toBe(hashOtpCode('123456'));
  });

  it('defines valid constants', () => {
    expect(OTP_TTL_MINUTES).toBe(10);
    expect(MAX_OTP_FAILED_ATTEMPTS).toBe(5);
  });
});
