import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  UnsafePathError,
  safeLstat,
  safeMkdir,
  safeReadFile,
  safeRemove,
  safeWriteFile,
  splitRelPath,
} from './safe-fs';

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

    it('無いファイルは null、上限を超えるファイルも null', () => {
      expect(safeReadFile(root, 'nope.txt', 100)).toBeNull();
      expect(safeReadFile(root, 'no/such/dir.txt', 100)).toBeNull();
      fs.writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(10));
      expect(safeReadFile(root, 'big.txt', 5)).toBeNull();
      expect(safeLstat(root, 'nope')).toBeNull();
    });

    it('フォルダを作り、中身ごと消せる', () => {
      safeMkdir(root, 'x/y');
      safeWriteFile(root, 'x/y/z.txt', Buffer.from('z'));
      safeRemove(root, 'x');
      expect(fs.existsSync(path.join(root, 'x'))).toBe(false);
      safeRemove(root, 'x'); // 無くてもエラーにならない
    });

    it('安全でないパスは例外にする', () => {
      expect(() =>
        safeWriteFile(root, '../escape.txt', Buffer.from('x')),
      ).toThrow(UnsafePathError);
      expect(() => safeMkdir(root, 'a/../../escape')).toThrow(UnsafePathError);
      expect(() => safeRemove(root, '..')).toThrow(UnsafePathError);
      expect(fs.existsSync(path.join(tmp, 'escape.txt'))).toBe(false);
    });
  });

  describe('シンボリックリンクをたどらない', () => {
    it('外のファイルを指すリンクは読まない', () => {
      fs.symlinkSync(
        path.join(outside, 'secret.txt'),
        path.join(root, 'link.txt'),
      );
      expect(safeReadFile(root, 'link.txt', 100)).toBeNull();
      expect(safeLstat(root, 'link.txt')?.type).toBe('other');
    });

    it('外のフォルダを指すリンクの中は読まない', () => {
      fs.symlinkSync(outside, path.join(root, 'linkdir'));
      expect(safeReadFile(root, 'linkdir/secret.txt', 100)).toBeNull();
      expect(safeLstat(root, 'linkdir/secret.txt')).toBeNull();
    });

    it('リンクのファイルへは書かず、リンク先を書き換えない', () => {
      fs.symlinkSync(
        path.join(outside, 'secret.txt'),
        path.join(root, 'link.txt'),
      );
      expect(() =>
        safeWriteFile(root, 'link.txt', Buffer.from('PWNED')),
      ).toThrow();
      expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe(
        'SECRET',
      );
    });

    it('外のフォルダを指すリンクの中へは書かず、フォルダも作らない', () => {
      fs.symlinkSync(outside, path.join(root, 'linkdir'));
      expect(() =>
        safeWriteFile(root, 'linkdir/new.txt', Buffer.from('x')),
      ).toThrow();
      expect(() => safeMkdir(root, 'linkdir/sub')).toThrow();
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

    it('リンクを経由した削除はしない', () => {
      fs.symlinkSync(outside, path.join(root, 'linkdir'));
      safeRemove(root, 'linkdir/secret.txt');
      expect(fs.existsSync(path.join(outside, 'secret.txt'))).toBe(true);
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
    it('FIFO を読もうとしても止まらずに null を返し、書き込みもしない', () => {
      const fifo = path.join(root, 'pipe.txt');
      const r = spawnSync('mkfifo', [fifo]);
      expect(r.status).toBe(0);
      expect(safeReadFile(root, 'pipe.txt', 100)).toBeNull();
      expect(() => safeWriteFile(root, 'pipe.txt', Buffer.from('x'))).toThrow();
      expect(safeLstat(root, 'pipe.txt')?.type).toBe('other');
    });
  });
});
