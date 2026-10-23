import { createHash, randomInt } from 'node:crypto';

export function generateOtpCode(): string {
  return randomInt(100000, 1000000).toString();
}

export function hashOtpCode(code: string): string {
  return createHash('sha256').update(code.trim()).digest('hex');
}

export const OTP_TTL_MINUTES = 10;
export const MAX_OTP_FAILED_ATTEMPTS = 5;
