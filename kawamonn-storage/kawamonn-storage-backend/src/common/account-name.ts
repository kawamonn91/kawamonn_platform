import { BadRequestException, ConflictException } from '@nestjs/common';
import { isReservedAccountName } from './reserved-names';

/**
 * account_name は、そのままホスト上の利用者フォルダの名前
 * (/home/pi/hdd/ssh/users/{account_name}、管理者は /home/pi/hdd/ssh/{account_name})と、
 * SSH コンテナの名前・root 権限で動くスクリプトの引数に使われる。
 *
 * そのため、パスの区切りや特別な意味を持つ名前を通してはいけない。
 *   - "." や ".." はフォルダの外を指す(".." なら /home/pi/hdd/ssh 全体になる)
 *   - "." で始まる名前は隠しフォルダになり、同期の対象から外れる
 *   - "-" で始まる名前は、スクリプトに渡したときにオプションとして解釈されうる
 * 先頭は英数字、2文字目以降は英数字と _ . - だけ、全体で 32 文字までにする。
 */
export const ACCOUNT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,31}$/;

export const ACCOUNT_NAME_RULE_MESSAGE =
  'Username must start with a letter or number, contain only letters, numbers, _ . -, and be at most 32 characters';

export function isValidAccountName(name: unknown): name is string {
  return typeof name === 'string' && ACCOUNT_NAME_PATTERN.test(name);
}

/** 新規作成・登録時に利用者名として割り当て可能か検査する(規則外は 400、予約語は 409) */
export function assertAssignableAccountName(name: string): void {
  if (!isValidAccountName(name)) {
    throw new BadRequestException(ACCOUNT_NAME_RULE_MESSAGE);
  }
  if (isReservedAccountName(name)) {
    throw new ConflictException(
      'This account name is reserved and cannot be used.',
    );
  }
}

/** メールアドレスの正規化(前後の空白除去と小文字化) */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
