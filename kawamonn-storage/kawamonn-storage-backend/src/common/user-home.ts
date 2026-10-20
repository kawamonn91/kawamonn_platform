import * as path from 'path';
import { isValidAccountName } from './account-name';

/**
 * 利用者フォルダの置き場所。本番は /home/pi/hdd/ssh。
 * テストでは環境変数 SSH_BASE で一時フォルダに差し替える(src/jest-setup.ts、test/setup-e2e.ts)。
 */
export function sshBase(): string {
  return process.env.SSH_BASE || '/home/pi/hdd/ssh';
}

/**
 * 利用者フォルダのパス。一般の利用者は {SSH_BASE}/users/{名前}、管理者は {SSH_BASE}/{名前}。
 * 利用者名はそのままパスになるので、"." や ".." などの名前は例外にする。
 */
export function userHomePath(username: string, isAdmin: boolean): string {
  if (!isValidAccountName(username)) {
    throw new Error(`Invalid account name: ${JSON.stringify(username)}`);
  }
  return isAdmin
    ? path.join(sshBase(), username)
    : path.join(sshBase(), 'users', username);
}
