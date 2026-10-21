import * as bcrypt from 'bcrypt';
import { hashPassword, needsRehash, verifyPassword } from './password';

describe('password', () => {
  it('argon2 で作り、照合できる', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash.startsWith('$argon2')).toBe(true);
    expect(needsRehash(hash)).toBe(false);
    await expect(verifyPassword(hash, 'correct horse')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong')).resolves.toBe(false);
  });

  it('古い bcrypt のハッシュも照合でき、作り直しの対象になる', async () => {
    const hash = await bcrypt.hash('legacy pass', 4);
    expect(needsRehash(hash)).toBe(true);
    await expect(verifyPassword(hash, 'legacy pass')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'nope')).resolves.toBe(false);
  });

  it('壊れたハッシュは false(例外にしない)', async () => {
    await expect(verifyPassword('$argon2id$broken', 'x')).resolves.toBe(false);
    await expect(verifyPassword('not-a-hash', 'x')).resolves.toBe(false);
  });
});
