import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { isSafeFileName } from './file-name';

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
 * リンクは、利用者フォルダの中を指していてもたどらない。
 * (Linux 専用。本番は Raspberry Pi OS、CI は ubuntu)
 */

const { constants } = fs;
const DIR_FLAGS =
  constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

/**
 * 失敗の理由。
 * - unsafe-path: "/" や ".." などを含む、パスとして安全でない名前
 * - link: 途中や対象がシンボリックリンク、または途中にフォルダでないものがある
 * - is-dir / not-dir: フォルダでないことを期待したのにフォルダ / その逆
 * - not-file: FIFO などの特殊なファイル
 * - too-large: 上限を超える大きさ
 * - exists: 作ろうとした名前がすでにある
 */
export type SafeFsReason =
  | 'unsafe-path'
  | 'link'
  | 'is-dir'
  | 'not-dir'
  | 'not-file'
  | 'too-large'
  | 'exists';

export class SafeFsError extends Error {
  constructor(
    readonly reason: SafeFsReason,
    relPath: string,
  ) {
    super(`${reason}: ${JSON.stringify(relPath)}`);
    this.name = 'SafeFsError';
  }
}

/**
 * root からの相対パスを名前の配列に分ける。"/" で区切り、空の部分(先頭・末尾・連続した "/")は無視する。
 * "." ".." "\" などを含むなど、1つでも安全でない名前があれば null。root 自体("" や "/")も null。
 */
export function splitRelPath(relPath: string): string[] | null {
  if (typeof relPath !== 'string') return null;
  const parts = relPath.split('/').filter((p) => p !== '');
  if (parts.length === 0) return null;
  return parts.every((p) => isSafeFileName(p)) ? parts : null;
}

/** root 自体("" や "/")なら []、安全でなければ例外 */
function splitDirPath(relPath: string): string[] {
  if (
    typeof relPath === 'string' &&
    relPath.split('/').every((p) => p === '')
  ) {
    return [];
  }
  const parts = splitRelPath(relPath);
  if (!parts) throw new SafeFsError('unsafe-path', relPath);
  return parts;
}

function fdPath(fd: number, name?: string): string {
  return name === undefined
    ? `/proc/self/fd/${fd}`
    : `/proc/self/fd/${fd}/${name}`;
}

function errno(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException)?.code;
}

/**
 * root から dirs を順に開き(create なら無いフォルダを作り)、最後のフォルダの fd で fn を呼ぶ。
 * 途中に無いフォルダがあれば ENOENT の例外、リンクやファイルがあれば SafeFsError('link')。
 */
function withDir<T>(
  root: string,
  dirs: string[],
  create: boolean,
  relPath: string,
  fn: (dirFd: number) => T,
): T {
  let fd = fs.openSync(root, DIR_FLAGS);
  try {
    for (const name of dirs) {
      if (create) {
        try {
          fs.mkdirSync(fdPath(fd, name));
        } catch (e) {
          if (errno(e) !== 'EEXIST') throw e;
        }
      }
      let next: number;
      try {
        next = fs.openSync(fdPath(fd, name), DIR_FLAGS);
      } catch (e) {
        // リンクなら ELOOP、ファイルなら ENOTDIR
        if (errno(e) === 'ELOOP' || errno(e) === 'ENOTDIR') {
          throw new SafeFsError('link', relPath);
        }
        throw e;
      }
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
  if (!parts) throw new SafeFsError('unsafe-path', relPath);
  return { dirs: parts.slice(0, -1), name: parts[parts.length - 1] };
}

export type EntryType = 'file' | 'dir' | 'link' | 'other';

export interface SafeStat {
  type: EntryType;
  size: number;
  mtimeMs: number;
}

function toStat(st: fs.Stats): SafeStat {
  const type: EntryType = st.isFile()
    ? 'file'
    : st.isDirectory()
      ? 'dir'
      : st.isSymbolicLink()
        ? 'link'
        : 'other';
  return { type, size: st.size, mtimeMs: st.mtimeMs };
}

/** 種類と大きさを返す(リンクはたどらず 'link')。無ければ null。途中がリンクなら SafeFsError('link') */
export function safeLstat(root: string, relPath: string): SafeStat | null {
  const { dirs, name } = parse(relPath);
  try {
    return withDir(root, dirs, false, relPath, (dirFd) =>
      toStat(fs.lstatSync(fdPath(dirFd, name))),
    );
  } catch (e) {
    if (errno(e) === 'ENOENT') return null;
    throw e;
  }
}

export interface SafeDirEntry extends SafeStat {
  name: string;
}

/**
 * フォルダの中身を返す(リンクはたどらず 'link' として返す)。relPath が "" か "/" なら root。
 * 無ければ null。フォルダでなければ SafeFsError('not-dir')。
 */
export function safeReadDir(
  root: string,
  relPath: string,
): SafeDirEntry[] | null {
  const dirs = splitDirPath(relPath);
  try {
    return withDir(root, dirs, false, relPath, (dirFd) => {
      const entries: SafeDirEntry[] = [];
      for (const name of fs.readdirSync(fdPath(dirFd))) {
        try {
          entries.push({ name, ...toStat(fs.lstatSync(fdPath(dirFd, name))) });
        } catch {
          // 読んでいる間に消えたものなどは飛ばす
        }
      }
      return entries;
    });
  } catch (e) {
    if (errno(e) === 'ENOENT') return null;
    if (e instanceof SafeFsError && e.reason === 'link' && dirs.length > 0) {
      // 最後の名前がファイルだったのか、途中がリンクだったのかを分ける
      const st = safeLstat(root, relPath);
      if (st?.type === 'file') throw new SafeFsError('not-dir', relPath);
    }
    throw e;
  }
}

/**
 * 普通のファイルの中身を返す。無ければ null。
 * リンクなら SafeFsError('link')、フォルダなら 'is-dir'、FIFO などなら 'not-file'、maxSize 超えなら 'too-large'。
 * FIFO を開いて処理が止まらないよう O_NONBLOCK で開き、開いたあとで普通のファイルか確かめる。
 */
export function safeReadFile(
  root: string,
  relPath: string,
  maxSize: number,
): { buffer: Buffer; size: number } | null {
  const { dirs, name } = parse(relPath);
  try {
    return withDir(root, dirs, false, relPath, (dirFd) => {
      let fd: number;
      try {
        fd = fs.openSync(
          fdPath(dirFd, name),
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
      } catch (e) {
        if (errno(e) === 'ELOOP') throw new SafeFsError('link', relPath);
        throw e;
      }
      try {
        const st = fs.fstatSync(fd);
        if (st.isDirectory()) throw new SafeFsError('is-dir', relPath);
        if (!st.isFile()) throw new SafeFsError('not-file', relPath);
        if (st.size > maxSize) throw new SafeFsError('too-large', relPath);
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
    if (errno(e) === 'ENOENT') return null;
    throw e;
  }
}

/**
 * ファイルを書く(途中のフォルダは作る)。既存の普通のファイルはその場で書き換え、所有者と権限を保つ。
 * 書き込み先や途中がリンクなら SafeFsError('link')、フォルダなら 'is-dir'、特殊なファイルなら 'not-file'。
 */
export function safeWriteFile(
  root: string,
  relPath: string,
  data: Buffer,
): void {
  const { dirs, name } = parse(relPath);
  withDir(root, dirs, true, relPath, (dirFd) => {
    const target = fdPath(dirFd, name);
    let fd: number;
    try {
      // 既存のファイル。FIFO なら読み手がいないと ENXIO で失敗し、止まらない
      fd = fs.openSync(
        target,
        constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (e) {
      const code = errno(e);
      if (code === 'ELOOP') throw new SafeFsError('link', relPath);
      if (code === 'EISDIR') throw new SafeFsError('is-dir', relPath);
      if (code === 'ENXIO') throw new SafeFsError('not-file', relPath);
      if (code !== 'ENOENT') throw e;
      // 新規作成。O_EXCL なので、同じ名前のリンクや別のファイルが割り込んだら失敗する。
      // 権限はこれまでの writeFileSync と同じ 0o666(親フォルダの既定の ACL・umask で絞られる)
      try {
        fd = fs.openSync(
          target,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o666,
        );
      } catch (e2) {
        if (errno(e2) === 'EEXIST') throw new SafeFsError('exists', relPath);
        throw e2;
      }
    }
    try {
      if (!fs.fstatSync(fd).isFile()) {
        throw new SafeFsError('not-file', relPath);
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

/** フォルダを作る(途中のフォルダも作る。すでにあってもよい)。途中にリンクやファイルがあれば SafeFsError('link') */
export function safeMkdir(root: string, relPath: string): void {
  const parts = splitRelPath(relPath);
  if (!parts) throw new SafeFsError('unsafe-path', relPath);
  withDir(root, parts, true, relPath, () => undefined);
}

/**
 * ファイルかフォルダ(中身ごと)を消す。無ければ何もしない。
 * リンクはリンク自体だけを消し、リンク先には触れない。途中がリンクなら SafeFsError('link')。
 */
export function safeRemove(root: string, relPath: string): void {
  const { dirs, name } = parse(relPath);
  try {
    withDir(root, dirs, false, relPath, (dirFd) => {
      const target = fdPath(dirFd, name);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(target);
      } catch (e) {
        if (errno(e) === 'ENOENT') return;
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
        { stdio: ['ignore', 'ignore', 'pipe', dirFd] },
      );
      if (r.error) throw r.error;
      if (r.status !== 0) {
        throw new Error(
          `rm failed (${r.status}): ${r.stderr?.toString().trim()}`,
        );
      }
    });
  } catch (e) {
    if (errno(e) === 'ENOENT') return;
    throw e;
  }
}

/**
 * 名前を変える・移す(どちらも root の中)。移し先がすでにあれば SafeFsError('exists')、
 * 元が無ければ ENOENT の例外。途中がリンクなら SafeFsError('link')。移し先の途中のフォルダは作らない。
 */
export function safeRename(root: string, fromRel: string, toRel: string): void {
  const from = parse(fromRel);
  const to = parse(toRel);
  withDir(root, from.dirs, false, fromRel, (fromFd) =>
    withDir(root, to.dirs, false, toRel, (toFd) => {
      fs.lstatSync(fdPath(fromFd, from.name)); // 無ければ ENOENT
      try {
        fs.lstatSync(fdPath(toFd, to.name));
        throw new SafeFsError('exists', toRel);
      } catch (e) {
        if (errno(e) !== 'ENOENT') throw e;
      }
      // どちらの名前も、開いたフォルダからの1段だけが解決される。リンクは名前ごと移り、たどられない
      fs.renameSync(fdPath(fromFd, from.name), fdPath(toFd, to.name));
    }),
  );
}

/**
 * relPath(省略時は root 全体)の中の普通のファイルの大きさの合計(バイト)。隠しファイルも含める。
 * リンクはたどらず、読めないフォルダは飛ばす。対象が無ければ 0、ファイルならその大きさ。
 */
export function safeUsage(root: string, relPath = ''): number {
  const walk = (dirFd: number): number => {
    let total = 0;
    let names: string[];
    try {
      names = fs.readdirSync(fdPath(dirFd));
    } catch {
      return 0;
    }
    for (const name of names) {
      let st: fs.Stats;
      try {
        st = fs.lstatSync(fdPath(dirFd, name));
      } catch {
        continue;
      }
      if (st.isFile()) {
        total += st.size;
      } else if (st.isDirectory()) {
        let fd: number;
        try {
          fd = fs.openSync(fdPath(dirFd, name), DIR_FLAGS);
        } catch {
          continue;
        }
        try {
          total += walk(fd);
        } finally {
          fs.closeSync(fd);
        }
      }
    }
    return total;
  };

  const dirs = splitDirPath(relPath);
  if (dirs.length > 0) {
    const st = safeLstat(root, relPath);
    if (!st) return 0;
    if (st.type === 'file') return st.size;
    if (st.type !== 'dir') return 0;
  }
  try {
    return withDir(root, dirs, false, relPath, walk);
  } catch (e) {
    if (errno(e) === 'ENOENT') return 0;
    throw e;
  }
}
