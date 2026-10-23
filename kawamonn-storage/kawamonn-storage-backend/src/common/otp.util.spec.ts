import { generateOtpCode, hashOtpCode, OTP_TTL_MINUTES, MAX_OTP_FAILED_ATTEMPTS } from './otp.util';

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

  it('hashes OTP code deterministically using SHA-256', () => {
    const hash1 = hashOtpCode('123456');
    const hash2 = hashOtpCode('123456');
    const hash3 = hashOtpCode('654321');
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(64); // SHA-256 hex is 64 chars
  });

  it('trims whitespace when hashing', () => {
    expect(hashOtpCode('  123456  ')).toBe(hashOtpCode('123456'));
  });

  it('defines valid constants', () => {
    expect(OTP_TTL_MINUTES).toBe(10);
    expect(MAX_OTP_FAILED_ATTEMPTS).toBe(5);
  });
});
