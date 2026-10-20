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
