import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { isSafeFileName } from '../common/file-name';

/**
 * 利用者フォルダ(root)の中だけを、シンボリックリンクをたどらずに読み書きするための関数群。
 *
 * 利用者は自分のフォルダの中に自由にシンボリックリンクを作れる(端末から ln -s できる)。
 * backend はホスト上で pi として動くので、パスの文字列をそのまま fs に渡すと、
 * 途中や末尾のリンクをたどって利用者フォルダの外(backend の .env や pi のホームなど)を
 * 読み書きしてしまう。事前にリンクかどうかを調べるだけでは、調べた直後に差し替えられる。
 *
 * そこで、root からフォルダを1段ずつ O_NOFOLLOW で開き、開いたフォルダの fd を
 * /proc/self/fd/<fd>/<名前> の形で使って次の名前だけを解決する。こうすると、
 * 途中のフォルダは開いた実体に固定され、最後の名前もリンクならたどらずに失敗する。
 * フォルダごとの削除は、この方式で安全に中をたどる GNU rm に、開いた fd を渡して任せる。
 * (Linux 専用。本番は Raspberry Pi OS、CI は ubuntu)
 */

const { constants } = fs;
const DIR_FLAGS =
  constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

export class UnsafePathError extends Error {
  constructor(relPath: string) {
    super(`Unsafe path: ${JSON.stringify(relPath)}`);
    this.name = 'UnsafePathError';
  }
}

/**
 * root からの相対パスを名前の配列に分ける。"/" で区切り、空の部分(先頭・末尾・連続した "/")は無視する。
 * "." ".." "\" などを含むなど、1つでも安全でない名前があれば null。
 */
export function splitRelPath(relPath: string): string[] | null {
  if (typeof relPath !== 'string') return null;
  const parts = relPath.split('/').filter((p) => p !== '');
  if (parts.length === 0) return null;
  return parts.every((p) => isSafeFileName(p)) ? parts : null;
}

function fdPath(fd: number, name?: string): string {
  return name === undefined
    ? `/proc/self/fd/${fd}`
    : `/proc/self/fd/${fd}/${name}`;
}

function isMissing(e: NodeJS.ErrnoException): boolean {
  // ENOENT: 無い / ENOTDIR・ELOOP: 途中がフォルダでない、またはリンク
  return e.code === 'ENOENT' || e.code === 'ENOTDIR' || e.code === 'ELOOP';
}

/** root から dirs を順に開き(create なら無いフォルダを作り)、最後のフォルダの fd で fn を呼ぶ */
function withDir<T>(
  root: string,
  dirs: string[],
  create: boolean,
  fn: (dirFd: number) => T,
): T {
  let fd = fs.openSync(root, DIR_FLAGS);
  try {
    for (const name of dirs) {
      if (create) {
        try {
          fs.mkdirSync(fdPath(fd, name));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        }
      }
      // リンクなら ELOOP、ファイルなら ENOTDIR で失敗する
      const next = fs.openSync(fdPath(fd, name), DIR_FLAGS);
      fs.closeSync(fd);
      fd = next;
    }
    return fn(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function parse(relPath: string): { dirs: string[]; name: string } {
  const parts = splitRelPath(relPath);
  if (!parts) throw new UnsafePathError(relPath);
  return { dirs: parts.slice(0, -1), name: parts[parts.length - 1] };
}

export type EntryType = 'file' | 'dir' | 'other';

/** 種類を返す(リンクはたどらず 'other')。無ければ null */
export function safeLstat(
  root: string,
  relPath: string,
): { type: EntryType; size: number; mtimeMs: number } | null {
  const { dirs, name } = parse(relPath);
  try {
    return withDir(root, dirs, false, (dirFd) => {
      const st = fs.lstatSync(fdPath(dirFd, name));
      const type: EntryType = st.isFile()
        ? 'file'
        : st.isDirectory()
          ? 'dir'
          : 'other';
      return { type, size: st.size, mtimeMs: st.mtimeMs };
    });
  } catch (e) {
    if (isMissing(e as NodeJS.ErrnoException)) return null;
    throw e;
  }
}

/**
 * 普通のファイルなら中身を返す。無い・リンク・フォルダ・FIFO などの特殊なファイル・maxSize 超えなら null。
 * FIFO を開いて処理が止まらないよう O_NONBLOCK で開き、開いたあとで普通のファイルか確かめる。
 */
export function safeReadFile(
  root: string,
  relPath: string,
  maxSize: number,
): { buffer: Buffer; size: number } | null {
  const { dirs, name } = parse(relPath);
  try {
    return withDir(root, dirs, false, (dirFd) => {
      const fd = fs.openSync(
        fdPath(dirFd, name),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const st = fs.fstatSync(fd);
        if (!st.isFile() || st.size > maxSize) return null;
        const buffer = Buffer.alloc(st.size);
        let offset = 0;
        while (offset < st.size) {
          const n = fs.readSync(fd, buffer, offset, st.size - offset, offset);
          if (n === 0) break; // 読んでいる間に短くなった
          offset += n;
        }
        return { buffer: buffer.subarray(0, offset), size: offset };
      } finally {
        fs.closeSync(fd);
      }
    });
  } catch (e) {
    if (isMissing(e as NodeJS.ErrnoException)) return null;
    throw e;
  }
}

/**
 * ファイルを書く(途中のフォルダは作る)。既存の普通のファイルはその場で書き換え、所有者と権限を保つ。
 * 書き込み先や途中がリンク・特殊なファイルなら書かずに例外を投げる。
 */
export function safeWriteFile(
  root: string,
  relPath: string,
  data: Buffer,
): void {
  const { dirs, name } = parse(relPath);
  withDir(root, dirs, true, (dirFd) => {
    const target = fdPath(dirFd, name);
    let fd: number;
    try {
      // 既存のファイル。FIFO なら読み手がいないと ENXIO で失敗し、止まらない
      fd = fs.openSync(
        target,
        constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      // 新規作成。O_EXCL なので、同じ名前のリンクや別のファイルが割り込んだら失敗する。
      // 権限はこれまでの writeFileSync と同じ 0o666(親フォルダの既定の ACL・umask で絞られる)
      fd = fs.openSync(
        target,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o666,
      );
    }
    try {
      if (!fs.fstatSync(fd).isFile()) {
        throw new Error(`Not a regular file: ${JSON.stringify(relPath)}`);
      }
      fs.ftruncateSync(fd, 0);
      let offset = 0;
      while (offset < data.length) {
        offset += fs.writeSync(fd, data, offset, data.length - offset, offset);
      }
    } finally {
      fs.closeSync(fd);
    }
  });
}

/** フォルダを作る(途中のフォルダも作る)。途中にリンクやファイルがあれば例外を投げる */
export function safeMkdir(root: string, relPath: string): void {
  const parts = splitRelPath(relPath);
  if (!parts) throw new UnsafePathError(relPath);
  withDir(root, parts, true, () => undefined);
}

/**
 * ファイルかフォルダ(中身ごと)を消す。無ければ何もしない。
 * リンクはリンク自体だけを消し、リンク先には触れない。
 */
export function safeRemove(root: string, relPath: string): void {
  const { dirs, name } = parse(relPath);
  try {
    withDir(root, dirs, false, (dirFd) => {
      const target = fdPath(dirFd, name);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(target);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw e;
      }
      if (!st.isDirectory()) {
        fs.unlinkSync(target); // リンクならリンク自体を消す
        return;
      }
      // 開いたフォルダの fd を子プロセスの fd 3 として渡し、そこからの名前だけを rm に解決させる。
      // GNU rm は中のフォルダを openat でたどり、途中でリンクに差し替えられてもたどらない
      const r = spawnSync(
        'rm',
        ['-rf', '--one-file-system', '--', `/proc/self/fd/3/${name}`],
        {
          stdio: ['ignore', 'ignore', 'pipe', dirFd],
        },
      );
      if (r.error) throw r.error;
      if (r.status !== 0) {
        throw new Error(
          `rm failed (${r.status}): ${r.stderr?.toString().trim()}`,
        );
      }
    });
  } catch (e) {
    if (isMissing(e as NodeJS.ErrnoException)) return;
    throw e;
  }
}
