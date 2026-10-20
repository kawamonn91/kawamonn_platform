import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  SafeFsError,
  safeLstat,
  safeMkdir,
  safeReadDir,
  safeReadFile,
  safeRemove,
  safeRename,
  safeUsage,
  safeWriteFile,
  splitRelPath,
} from './safe-fs';

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof SafeFsError
      ? e.reason
      : `other: ${(e as Error).message}`;
  }
  return undefined;
}

describe('safe-fs', () => {
  let tmp: string;
  let root: string; // 利用者フォルダ
  let outside: string; // 利用者フォルダの外(守るべき場所)

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-fs-'));
    root = path.join(tmp, 'home');
    outside = path.join(tmp, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('splitRelPath', () => {
    it('普通のパスを名前に分ける', () => {
      expect(splitRelPath('a/b/c.txt')).toEqual(['a', 'b', 'c.txt']);
      expect(splitRelPath('/a//b/')).toEqual(['a', 'b']);
    });

    it.each(['', '/', '..', 'a/../b', '../x', 'a/./b', 'a\\b', 'a\0b'])(
      '安全でないパス %j は null',
      (p) => {
        expect(splitRelPath(p)).toBeNull();
      },
    );
  });

  describe('通常の読み書き', () => {
    it('途中のフォルダを作って書き、読み戻せる', () => {
      safeWriteFile(root, 'a/b/c.txt', Buffer.from('hello'));
      expect(fs.readFileSync(path.join(root, 'a/b/c.txt'), 'utf8')).toBe(
        'hello',
      );
      expect(safeReadFile(root, 'a/b/c.txt', 100)?.buffer.toString()).toBe(
        'hello',
      );
      expect(safeLstat(root, 'a/b')?.type).toBe('dir');
      expect(safeLstat(root, 'a/b/c.txt')).toMatchObject({
        type: 'file',
        size: 5,
      });
    });

    it('既存のファイルはその場で書き換え、短くなった分も残さない', () => {
      fs.writeFileSync(path.join(root, 'f.txt'), 'long content');
      const inode = fs.statSync(path.join(root, 'f.txt')).ino;
      safeWriteFile(root, 'f.txt', Buffer.from('new'));
      expect(fs.readFileSync(path.join(root, 'f.txt'), 'utf8')).toBe('new');
      expect(fs.statSync(path.join(root, 'f.txt')).ino).toBe(inode);
    });

    it('無いものは null、上限を超えるファイル・フォルダは理由付きの例外', () => {
      expect(safeReadFile(root, 'nope.txt', 100)).toBeNull();
      expect(safeReadFile(root, 'no/such/dir.txt', 100)).toBeNull();
      expect(safeLstat(root, 'nope')).toBeNull();
      expect(safeReadDir(root, 'nope')).toBeNull();
      fs.writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(10));
      expect(reasonOf(() => safeReadFile(root, 'big.txt', 5))).toBe(
        'too-large',
      );
      fs.mkdirSync(path.join(root, 'd'));
      expect(reasonOf(() => safeReadFile(root, 'd', 100))).toBe('is-dir');
      expect(reasonOf(() => safeWriteFile(root, 'd', Buffer.from('x')))).toBe(
        'is-dir',
      );
      expect(reasonOf(() => safeReadDir(root, 'big.txt'))).toBe('not-dir');
    });

    it('フォルダの中身を一覧できる("" と "/" は root)', () => {
      safeWriteFile(root, 'a.txt', Buffer.from('aa'));
      safeMkdir(root, 'sub');
      const names = (safeReadDir(root, '/') ?? [])
        .map((e) => `${e.name}:${e.type}`)
        .sort();
      expect(names).toEqual(['a.txt:file', 'sub:dir']);
      expect(safeReadDir(root, '')?.length).toBe(2);
      expect(safeReadDir(root, 'sub')).toEqual([]);
    });

    it('フォルダを作り、中身ごと消せる', () => {
      safeMkdir(root, 'x/y');
      safeWriteFile(root, 'x/y/z.txt', Buffer.from('z'));
      safeRemove(root, 'x');
      expect(fs.existsSync(path.join(root, 'x'))).toBe(false);
      safeRemove(root, 'x'); // 無くてもエラーにならない
    });

    it('名前を変え、別のフォルダへ移せる。移し先があれば exists', () => {
      safeWriteFile(root, 'a.txt', Buffer.from('a'));
      safeMkdir(root, 'd');
      safeRename(root, 'a.txt', 'd/b.txt');
      expect(fs.readFileSync(path.join(root, 'd/b.txt'), 'utf8')).toBe('a');
      safeWriteFile(root, 'c.txt', Buffer.from('c'));
      expect(reasonOf(() => safeRename(root, 'c.txt', 'd/b.txt'))).toBe(
        'exists',
      );
      expect(fs.readFileSync(path.join(root, 'd/b.txt'), 'utf8')).toBe('a');
    });

    it('使用量は隠しファイルも含めた普通のファイルの合計', () => {
      safeWriteFile(root, 'a.txt', Buffer.from('12345'));
      safeWriteFile(root, '.venv/lib/x.py', Buffer.from('123'));
      safeWriteFile(root, 'd/e.txt', Buffer.from('12'));
      expect(safeUsage(root)).toBe(10);
      expect(safeUsage(root, 'd')).toBe(2);
      expect(safeUsage(root, 'a.txt')).toBe(5);
      expect(safeUsage(root, 'nope')).toBe(0);
    });

    it('安全でないパスは unsafe-path', () => {
      expect(
        reasonOf(() => safeWriteFile(root, '../escape.txt', Buffer.from('x'))),
      ).toBe('unsafe-path');
      expect(reasonOf(() => safeMkdir(root, 'a/../../escape'))).toBe(
        'unsafe-path',
      );
      expect(reasonOf(() => safeRemove(root, '..'))).toBe('unsafe-path');
      expect(reasonOf(() => safeReadDir(root, '../'))).toBe('unsafe-path');
      expect(reasonOf(() => safeRename(root, 'a', '../b'))).toBe('unsafe-path');
      expect(fs.existsSync(path.join(tmp, 'escape.txt'))).toBe(false);
    });
  });

  describe('シンボリックリンクをたどらない', () => {
    it('外のファイルを指すリンクは読まない', () => {
      fs.symlinkSync(
        path.join(outside, 'secret.txt'),
        path.join(root, 'link.txt'),
      );
      expect(reasonOf(() => safeReadFile(root, 'link.txt', 100))).toBe('link');
      expect(safeLstat(root, 'link.txt')?.type).toBe('link');
    });

    it('外のフォルダを指すリンクの中は読まない・一覧しない', () => {
      fs.symlinkSync(outside, path.join(root, 'linkdir'));
      expect(
        reasonOf(() => safeReadFile(root, 'linkdir/secret.txt', 100)),
      ).toBe('link');
      expect(reasonOf(() => safeLstat(root, 'linkdir/secret.txt'))).toBe(
        'link',
      );
      expect(reasonOf(() => safeReadDir(root, 'linkdir'))).toBe('link');
      expect(safeUsage(root)).toBe(0);
    });

    it('中を指すリンクもたどらない', () => {
      safeWriteFile(root, 'real/inside.txt', Buffer.from('fine'));
      fs.symlinkSync(path.join(root, 'real'), path.join(root, 'internal-link'));
      expect(reasonOf(() => safeReadDir(root, 'internal-link'))).toBe('link');
    });

    it('リンクのファイルへは書かず、リンク先を書き換えない', () => {
      fs.symlinkSync(
        path.join(outside, 'secret.txt'),
        path.join(root, 'link.txt'),
      );
      expect(
        reasonOf(() => safeWriteFile(root, 'link.txt', Buffer.from('PWNED'))),
      ).toBe('link');
      expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe(
        'SECRET',
      );
    });

    it('外のフォルダを指すリンクの中へは書かず、フォルダも作らない', () => {
      fs.symlinkSync(outside, path.join(root, 'linkdir'));
      expect(
        reasonOf(() =>
          safeWriteFile(root, 'linkdir/new.txt', Buffer.from('x')),
        ),
      ).toBe('link');
      expect(reasonOf(() => safeMkdir(root, 'linkdir/sub'))).toBe('link');
      expect(fs.readdirSync(outside)).toEqual(['secret.txt']);
    });

    it('リンクを消すときはリンク自体だけを消す', () => {
      fs.symlinkSync(outside, path.join(root, 'linkdir'));
      safeRemove(root, 'linkdir');
      expect(fs.existsSync(path.join(root, 'linkdir'))).toBe(false);
      expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe(
        'SECRET',
      );
    });

    it('リンクを経由した削除・移動はしない', () => {
      fs.symlinkSync(outside, path.join(root, 'linkdir'));
      expect(reasonOf(() => safeRemove(root, 'linkdir/secret.txt'))).toBe(
        'link',
      );
      expect(
        reasonOf(() => safeRename(root, 'linkdir/secret.txt', 'stolen.txt')),
      ).toBe('link');
      safeWriteFile(root, 'mine.txt', Buffer.from('m'));
      expect(
        reasonOf(() => safeRename(root, 'mine.txt', 'linkdir/planted.txt')),
      ).toBe('link');
      expect(fs.readdirSync(outside)).toEqual(['secret.txt']);
    });

    it('フォルダごと消すとき、中にある外へのリンクの先は消さない', () => {
      safeMkdir(root, 'd');
      fs.symlinkSync(outside, path.join(root, 'd/linkdir'));
      safeRemove(root, 'd');
      expect(fs.existsSync(path.join(root, 'd'))).toBe(false);
      expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe(
        'SECRET',
      );
    });
  });

  describe('特殊なファイル', () => {
    it('FIFO を読もうとしても止まらず、書き込みもしない', () => {
      const fifo = path.join(root, 'pipe.txt');
      expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
      expect(reasonOf(() => safeReadFile(root, 'pipe.txt', 100))).toBe(
        'not-file',
      );
      expect(
        reasonOf(() => safeWriteFile(root, 'pipe.txt', Buffer.from('x'))),
      ).toBe('not-file');
      expect(safeLstat(root, 'pipe.txt')?.type).toBe('other');
    });
  });
});
