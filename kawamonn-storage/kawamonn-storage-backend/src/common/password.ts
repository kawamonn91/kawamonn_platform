import * as argon2 from 'argon2';
import * as bcrypt from 'bcrypt';

/**
 * パスワードのハッシュの作成と照合。作るのは argon2id だけにする
 * (以前は管理者がアカウントを作る・仮パスワードを出すときだけ bcrypt を使っていた)。
 * 古いアカウントの bcrypt のハッシュも照合でき、ログインに成功したら argon2 で作り直す(needsRehash)。
 */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain);
}

/** 保存してあるハッシュと照合する。ハッシュの形式が壊れているときも false */
export async function verifyPassword(
  hash: string,
  plain: string,
): Promise<boolean> {
  try {
    return hash.startsWith('$argon2')
      ? await argon2.verify(hash, plain)
      : await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/** argon2 で作り直したほうがよいハッシュか(bcrypt などの古い形式) */
export function needsRehash(hash: string): boolean {
  return !hash.startsWith('$argon2');
}
