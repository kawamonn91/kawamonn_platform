import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { isValidAccountName } from '../common/account-name';
import { guessMime } from '../common/mime';
import { userHomePath } from '../common/user-home';
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
} from '../common/safe-fs';
import { StorageUsageService } from './storage-usage.service';

/** Web から読み書きできるファイルの大きさの上限(ダウンロードもアップロードも) */
export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: Date;
  mime: string;
}

/**
 * 利用者フォルダ(HDD)のファイルを、Web のストレージ画面と SSH 画面のファイルブラウザに提供する。
 * ファイルの置き場所はここだけで、MinIO などへの複製はしない。
 *
 * パスは利用者フォルダからの相対パス("/a/b.txt" の形)。操作はすべて common/safe-fs を通し、
 * シンボリックリンクはたどらず、利用者フォルダの外には出ない。
 */
@Injectable()
export class FileBrowserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: StorageUsageService,
  ) {}

  /** 利用者の情報と、利用者フォルダのパス(無ければ作る) */
  private async owner(username: string) {
    // 利用者名はそのままパスになるので、"." や ".." などは通さない
    if (!isValidAccountName(username)) {
      throw new ForbiddenException('Invalid account name');
    }
    const user = await this.prisma.user.findUnique({
      where: { account_name: username },
      select: { id: true, role: true, used_bytes: true, quota_bytes: true },
    });
    if (!user) throw new ForbiddenException('Account not found');
    const home = userHomePath(username, user.role === 'admin');
    fs.mkdirSync(home, { recursive: true });
    return { user, home };
  }

  /** safe-fs の失敗を、画面に返す HTTP のエラーに変える */
  private run<T>(relPath: string, fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof SafeFsError) {
        switch (e.reason) {
          case 'unsafe-path':
            throw new ForbiddenException(
              'Access outside home directory is not allowed',
            );
          case 'link':
            throw new ForbiddenException(
              'Symbolic links cannot be opened from the web',
            );
          case 'is-dir':
            throw new BadRequestException(`Path is a directory: ${relPath}`);
          case 'not-dir':
            throw new BadRequestException(
              `Path is not a directory: ${relPath}`,
            );
          case 'not-file':
            throw new BadRequestException(`Not a regular file: ${relPath}`);
          case 'too-large':
            throw new BadRequestException(
              'File is too large to download (max 100MB)',
            );
          case 'exists':
            throw new BadRequestException('Destination already exists');
        }
      }
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new NotFoundException(`Not found: ${relPath}`);
      }
      throw e;
    }
  }

  /** 利用者フォルダの中のパスとして安全か(安全でなければ 403) */
  private assertSafePath(relPath: string): void {
    if (!splitRelPath(relPath)) {
      throw new ForbiddenException(
        'Access outside home directory is not allowed',
      );
    }
  }

  /** フォルダの中身。隠しファイルと、リンク・特殊なファイルは出さない */
  async listDir(username: string, relPath: string = '/'): Promise<FileEntry[]> {
    const { home } = await this.owner(username);
    const items = this.run(relPath, () => safeReadDir(home, relPath));
    if (!items) throw new NotFoundException(`Directory not found: ${relPath}`);

    const base = (splitRelPath(relPath) ?? []).join('/');
    const entries: FileEntry[] = items
      .filter((i) => !i.name.startsWith('.'))
      .filter((i) => i.type === 'file' || i.type === 'dir')
      .map((i) => ({
        name: i.name,
        path: `/${base ? base + '/' : ''}${i.name}`,
        isDir: i.type === 'dir',
        size: i.size,
        mtime: new Date(i.mtimeMs),
        mime: i.type === 'dir' ? 'directory' : guessMime(i.name),
      }));

    // フォルダが先、次に名前順
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  }

  /** ファイルの中身 */
  async readFile(
    username: string,
    relPath: string,
  ): Promise<{ buffer: Buffer; mime: string; name: string }> {
    const { home } = await this.owner(username);
    this.assertSafePath(relPath);
    const file = this.run(relPath, () =>
      safeReadFile(home, relPath, MAX_FILE_SIZE),
    );
    if (!file) throw new NotFoundException(`File not found: ${relPath}`);
    const parts = splitRelPath(relPath) as string[];
    const name = parts[parts.length - 1];
    return { buffer: file.buffer, mime: guessMime(name), name };
  }

  /** ファイルを書く(新規作成・上書き)。容量の上限を超えるなら断る */
  async writeFile(
    username: string,
    relPath: string,
    buffer: Buffer,
  ): Promise<void> {
    const { user, home } = await this.owner(username);
    this.assertSafePath(relPath);

    const current = this.run(relPath, () => safeLstat(home, relPath));
    if (current?.type === 'dir') {
      throw new BadRequestException(`Path is a directory: ${relPath}`);
    }
    const delta = buffer.length - (current?.type === 'file' ? current.size : 0);
    if (
      delta > 0 &&
      BigInt(user.used_bytes) + BigInt(delta) > BigInt(user.quota_bytes)
    ) {
      throw new PayloadTooLargeException('Storage quota exceeded');
    }

    this.run(relPath, () => safeWriteFile(home, relPath, buffer));
    const clampedDelta =
      delta < 0
        ? -Math.min(-delta, Math.max(0, Number(user.used_bytes)))
        : delta;
    await this.usage.adjust(user.id, clampedDelta);
  }

  /** フォルダを作る(途中のフォルダも作る) */
  async mkdir(username: string, relPath: string): Promise<void> {
    const { home } = await this.owner(username);
    this.assertSafePath(relPath);
    if (this.run(relPath, () => safeLstat(home, relPath))) {
      throw new BadRequestException('Directory already exists');
    }
    this.run(relPath, () => safeMkdir(home, relPath));
  }

  /** ファイルかフォルダ(中身ごと)を消す */
  async deleteItem(username: string, relPath: string): Promise<void> {
    const { user, home } = await this.owner(username);
    this.assertSafePath(relPath);
    const current = this.run(relPath, () => safeLstat(home, relPath));
    if (!current) throw new NotFoundException(`Not found: ${relPath}`);

    const freed =
      current.type === 'dir'
        ? this.run(relPath, () => safeUsage(home, relPath))
        : current.type === 'file'
          ? current.size
          : 0;
    this.run(relPath, () => safeRemove(home, relPath));
    // 端末から作られたファイルを定期計測の前に削除した場合でも、used_bytes が負にならないように下限 0 で抑える
    const available = Math.max(0, Number(user.used_bytes));
    const decrement = Math.min(freed, available);
    await this.usage.adjust(user.id, -decrement);
  }

  /** 名前を変える・移す(どちらも利用者フォルダの中) */
  async rename(
    username: string,
    oldPath: string,
    newPath: string,
  ): Promise<void> {
    const { home } = await this.owner(username);
    this.assertSafePath(oldPath);
    this.assertSafePath(newPath);
    if (!this.run(oldPath, () => safeLstat(home, oldPath))) {
      throw new NotFoundException(`Not found: ${oldPath}`);
    }
    this.run(newPath, () => safeRename(home, oldPath, newPath));
  }
}
