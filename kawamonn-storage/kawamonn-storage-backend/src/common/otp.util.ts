import { createHmac, randomInt } from 'node:crypto';
import { getJwtSecret } from './jwt-secret';

export function generateOtpCode(): string {
  return randomInt(100000, 1000000).toString();
}

/**
 * 確認コードを DB に保存するときの形。6 桁の数字は 90 万通りしかないので、塩なしのハッシュだと
 * DB の値から元のコードをすぐに割り出せる。サーバーの秘密鍵(JWT_SECRET)を鍵にした HMAC にする
 * (先頭に用途の文字列を付け、JWT の署名とは別の値にする)
 */
export function hashOtpCode(code: string): string {
  return createHmac('sha256', getJwtSecret())
    .update(`otp:${code.trim()}`)
    .digest('hex');
}

export const OTP_TTL_MINUTES = 10;
export const MAX_OTP_FAILED_ATTEMPTS = 5;
