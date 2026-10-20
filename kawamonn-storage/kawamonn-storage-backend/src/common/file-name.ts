/**
 * Web から作るファイル・フォルダの名前として安全かどうか。
 *
 * 名前は DB に保存され、親フォルダの名前とつないで利用者フォルダの中のパスになる。
 * パスの区切り("/" や "\")や "." ".." を含む名前を通すと、利用者フォルダの外を指してしまう。
 * ext4 の名前の上限(255 バイト)も超えないようにする。
 */
export function isSafeFileName(name: unknown): name is string {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (name === '.' || name === '..') return false;
  if (/[/\\\0]/.test(name)) return false;
  if (Buffer.byteLength(name, 'utf8') > 255) return false;
  return true;
}
