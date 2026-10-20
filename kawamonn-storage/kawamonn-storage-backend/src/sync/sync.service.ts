import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as Minio from 'minio';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { isValidAccountName } from '../common/account-name';
import {
  safeLstat,
  safeMkdir,
  safeReadFile,
  safeRemove,
  safeWriteFile,
  splitRelPath,
} from './safe-fs';

// FileBrowserService と同じく、テストでは一時フォルダに差し替える(src/jest-setup.ts)
const SSH_BASE = process.env.SSH_BASE || '/home/pi/hdd/ssh';
const MAX_SYNC_SIZE = 100 * 1024 * 1024; // 100MB

// SSH_BASE の直下にある、利用者のフォルダではないもの(管理者のフォルダは SSH_BASE の直下にあるので、
// ここに無い名前は監視する。管理者がこれらの名前にならないことは予約語で保証している)
const NON_USER_TOP_DIRS = new Set([
  'kawamonn-storage',
  'kawamonn-labs',
  'archives',
]);

/**
 * 同期の対象にする相対パスか。"." で始まる名前(.ssh、.bashrc、.venv など)と node_modules の中は、
 * どの階層にあっても対象外。パスとして安全でない名前を含むものも対象外。
 */
export function isSyncableRelPath(relPath: string): boolean {
  const parts = splitRelPath(relPath);
  if (!parts) return false;
  return parts.every((p) => !p.startsWith('.') && p !== 'node_modules');
}

@Injectable()
export class SyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncService.name);
  private minioClient: Minio.Client;
  private bucketName: string;
  /**
   * MinIO→FS の書き込みで生成されたファイルパスを管理するセット。
   * chokidar がこのパスの変更を検知しても MinIO への再アップロードを行わない。
   */
  private syncingPaths = new Set<string>();
  private watcher: any;

  constructor(private readonly prisma: PrismaService) {
    this.minioClient = new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT || '127.0.0.1',
      port: parseInt(process.env.MINIO_PORT || '9000'),
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY || 'admin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minio_password',
    });
    this.bucketName = process.env.MINIO_BUCKET || 'storage-bucket';
  }

  async onModuleInit() {
    // 初回起動時: MinIO→FS で全ユーザーを同期
    await this.syncAllUsersMinioToFs();
    // FS の変更を監視開始
    this.startFsWatcher();
  }

  async onModuleDestroy() {
    if (this.watcher) {
      await this.watcher.close();
    }
  }

  // =========================================================
  // Public API: MinIO → FS (FilesService から呼び出す)
  // =========================================================

  private async getUserHomePath(username: string): Promise<string> {
    // 利用者名はそのままパスになるので、"." や ".." などは通さない
    if (!isValidAccountName(username)) {
      throw new Error(`Invalid account name: ${JSON.stringify(username)}`);
    }
    const user = await this.prisma.user.findUnique({
      where: { account_name: username },
      select: { role: true },
    });
    const isMin = user && user.role === 'admin';
    return isMin
      ? path.join(SSH_BASE, username)
      : path.join(SSH_BASE, 'users', username);
  }

  /** MinIO にアップロードされたファイルを FS に書き込む */
  async writeFileToFs(
    username: string,
    relPath: string,
    buffer: Buffer,
  ): Promise<void> {
    try {
      const home = await this.ensureUserHome(username);
      this.markSyncing(path.join(home, relPath));
      safeWriteFile(home, relPath, buffer);
      this.logger.debug(`MinIO→FS write: ${username}/${relPath}`);
    } catch (e) {
      this.logger.warn(
        `writeFileToFs failed [${username}/${relPath}]: ${e.message}`,
      );
    }
  }

  /** MinIO でフォルダが作成されたとき FS にも作成する */
  async createDirInFs(username: string, relPath: string): Promise<void> {
    try {
      const home = await this.ensureUserHome(username);
      this.markSyncing(path.join(home, relPath));
      safeMkdir(home, relPath);
      this.logger.debug(`MinIO→FS mkdir: ${username}/${relPath}`);
    } catch (e) {
      this.logger.warn(
        `createDirInFs failed [${username}/${relPath}]: ${e.message}`,
      );
    }
  }

  /** MinIO からファイル/フォルダが削除されたとき FS からも削除する */
  async deleteFromFs(username: string, relPath: string): Promise<void> {
    try {
      const home = await this.getUserHomePath(username);
      if (!fs.existsSync(home)) return;
      this.markSyncing(path.join(home, relPath));
      safeRemove(home, relPath);
      this.logger.debug(`MinIO→FS delete: ${username}/${relPath}`);
    } catch (e) {
      this.logger.warn(
        `deleteFromFs failed [${username}/${relPath}]: ${e.message}`,
      );
    }
  }

  // =========================================================
  // Public API: FS → MinIO (FileBrowserService から呼び出す)
  // =========================================================

  /** FileBrowser でアップロードされたファイルを MinIO + DB に登録する */
  async uploadFsFileToMinio(
    userId: string,
    username: string,
    relPath: string,
  ): Promise<void> {
    try {
      if (!isSyncableRelPath(relPath)) return;
      const home = await this.getUserHomePath(username);
      const st = safeLstat(home, relPath);
      if (!st || st.type !== 'file') return;
      if (st.size > MAX_SYNC_SIZE) {
        this.logger.warn(
          `File too large to sync [${relPath}]: ${st.size} bytes`,
        );
        return;
      }
      const file = safeReadFile(home, relPath, MAX_SYNC_SIZE);
      if (!file) return;
      await this.internalUploadToMinioAndDb(
        userId,
        relPath,
        file.buffer,
        file.size,
      );
    } catch (e) {
      this.logger.error(
        `uploadFsFileToMinio failed [${relPath}]: ${e.message}`,
      );
    }
  }

  /** FileBrowser でフォルダ作成されたとき DB にも作成する */
  async createFolderInDb(userId: string, relPath: string): Promise<void> {
    await this.findOrCreateFolderChain(userId, relPath);
  }

  /** FileBrowser でファイル/フォルダを削除したとき MinIO + DB からも削除する */
  async deleteFsPathFromMinio(
    userId: string,
    username: string,
    relPath: string,
  ): Promise<void> {
    const filename = path.basename(relPath);
    const dirPath =
      path.dirname(relPath) === '.' ? null : path.dirname(relPath);
    try {
      const parentId = dirPath
        ? await this.findFolderByPath(userId, dirPath)
        : null;
      const file = await this.prisma.file.findFirst({
        where: {
          owner_id: userId,
          name: filename,
          parent_id: parentId || null,
        },
      });
      if (!file) return;

      if (file.storage_key) {
        await this.minioClient
          .removeObject(this.bucketName, file.storage_key)
          .catch(() => {});
      }
      await this.prisma.file.delete({ where: { id: file.id } });

      if (Number(file.size) > 0) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { used_bytes: { decrement: Number(file.size) } },
        });
      }
      this.logger.debug(`FS→MinIO delete: ${username}/${relPath}`);
    } catch (e) {
      this.logger.error(
        `deleteFsPathFromMinio failed [${relPath}]: ${e.message}`,
      );
    }
  }

  /**
   * DB に登録されたファイルの相対パスを親チェーンをたどって解決する。
   * FilesService が削除前にパスを取得するために使用する。
   */
  async resolveDbFilePath(fileId: string): Promise<string | null> {
    try {
      const file = await this.prisma.file.findUnique({
        where: { id: fileId },
        select: { name: true, parent_id: true },
      });
      if (!file) return null;
      return this.buildPathFromParent(file.name, file.parent_id);
    } catch {
      return null;
    }
  }

  // =========================================================
  // 初回同期: MinIO → FS (全ユーザー)
  // =========================================================

  async syncAllUsersMinioToFs(): Promise<void> {
    this.logger.log('Starting initial MinIO → FS sync for all users...');
    const users = await this.prisma.user.findMany({
      select: { id: true, account_name: true },
    });
    for (const user of users) {
      try {
        await this.syncUserMinioToFs(user.id, user.account_name);
      } catch (e) {
        this.logger.warn(
          `Initial sync failed for [${user.account_name}]: ${e.message}`,
        );
      }
    }
    this.logger.log('Initial MinIO → FS sync complete.');
  }

  async syncUserMinioToFs(userId: string, username: string): Promise<void> {
    const home = await this.ensureUserHome(username);
    // ディレクトリを先に作成
    const dirs = await this.prisma.file.findMany({
      where: { owner_id: userId, mime_type: 'directory' },
    });
    for (const dir of dirs) {
      try {
        const relPath = await this.buildPathFromParent(dir.name, dir.parent_id);
        if (!splitRelPath(relPath)) {
          this.logger.warn(
            `Skip unsafe path (dir): ${JSON.stringify(relPath)}`,
          );
          continue;
        }
        if (!safeLstat(home, relPath)) {
          this.markSyncing(path.join(home, relPath));
          safeMkdir(home, relPath);
          this.logger.log(`Synced MinIO→FS (dir): ${username}/${relPath}`);
        }
      } catch (e) {
        this.logger.warn(`Sync dir failed [${dir.name}]: ${e.message}`);
      }
    }

    // ファイルを同期
    const files = await this.prisma.file.findMany({
      where: {
        owner_id: userId,
        NOT: { mime_type: 'directory' },
        storage_key: { not: null },
      },
    });

    for (const file of files) {
      try {
        const relPath = await this.buildPathFromParent(
          file.name,
          file.parent_id,
        );
        if (!splitRelPath(relPath)) {
          this.logger.warn(
            `Skip unsafe path (file): ${JSON.stringify(relPath)}`,
          );
          continue;
        }
        if (safeLstat(home, relPath)) continue; // 既存(リンクなども含む)はスキップ

        const stream = await this.minioClient.getObject(
          this.bucketName,
          file.storage_key,
        );
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', resolve);
          stream.on('error', reject);
        });
        const buffer = Buffer.concat(chunks);

        this.markSyncing(path.join(home, relPath));
        safeWriteFile(home, relPath, buffer);

        this.logger.log(`Synced MinIO→FS: ${username}/${relPath}`);
      } catch (e) {
        this.logger.warn(`Sync failed for file [${file.name}]: ${e.message}`);
      }
    }
  }

  // =========================================================
  // FS Watcher (chokidar) — ターミナルの変更を検知して MinIO に同期
  // =========================================================

  private startFsWatcher(): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const chokidar = require('chokidar');

    this.watcher = chokidar.watch(SSH_BASE, {
      ignored: (p: string) => this.isIgnoredWatchPath(p),
      // 利用者が作ったシンボリックリンクをたどって、利用者フォルダの外を監視・アップロードしないようにする
      followSymlinks: false,
      persistent: true,
      ignoreInitial: true, // 起動時の既存ファイルでイベントを発火しない
      depth: 15,
      awaitWriteFinish: {
        stabilityThreshold: 1500, // 書き込み完了後 1.5 秒待つ
        pollInterval: 300,
      },
    });

    this.watcher
      .on('add', (p: string) => this.onFsAdd(p))
      .on('change', (p: string) => this.onFsChange(p))
      .on('unlink', (p: string) => this.onFsUnlink(p))
      .on('addDir', (p: string) => this.onFsAddDir(p))
      .on('unlinkDir', (p: string) => this.onFsUnlinkDir(p))
      .on('error', (err: Error) =>
        this.logger.error(`Watcher error: ${err.message}`),
      );

    this.logger.log(`FS watcher started on ${SSH_BASE}`);
  }

  private async onFsAdd(absPath: string): Promise<void> {
    if (this.syncingPaths.has(absPath)) return;
    const parsed = await this.parseFsPath(absPath);
    if (!parsed) return;
    await this.internalFsFileToMinio(
      parsed.userId,
      parsed.username,
      parsed.relPath,
    );
    this.logger.log(`FS→MinIO (add): ${parsed.username}/${parsed.relPath}`);
  }

  private async onFsChange(absPath: string): Promise<void> {
    if (this.syncingPaths.has(absPath)) return;
    const parsed = await this.parseFsPath(absPath);
    if (!parsed) return;
    await this.internalFsFileToMinio(
      parsed.userId,
      parsed.username,
      parsed.relPath,
    );
    this.logger.log(`FS→MinIO (change): ${parsed.username}/${parsed.relPath}`);
  }

  private async onFsUnlink(absPath: string): Promise<void> {
    if (this.syncingPaths.has(absPath)) return;
    const parsed = await this.parseFsPath(absPath);
    if (!parsed) return;
    await this.deleteFsPathFromMinio(
      parsed.userId,
      parsed.username,
      parsed.relPath,
    );
    this.logger.log(`FS→MinIO (unlink): ${parsed.username}/${parsed.relPath}`);
  }

  private async onFsAddDir(absPath: string): Promise<void> {
    if (this.syncingPaths.has(absPath)) return;
    if (absPath === SSH_BASE) return;
    const parsed = await this.parseFsPath(absPath);
    if (!parsed || !parsed.relPath) return;
    await this.findOrCreateFolderChain(parsed.userId, parsed.relPath);
    this.logger.log(`FS→MinIO (addDir): ${parsed.username}/${parsed.relPath}`);
  }

  private async onFsUnlinkDir(absPath: string): Promise<void> {
    if (this.syncingPaths.has(absPath)) return;
    const parsed = await this.parseFsPath(absPath);
    if (!parsed || !parsed.relPath) return;
    await this.deleteFsPathFromMinio(
      parsed.userId,
      parsed.username,
      parsed.relPath,
    );
    this.logger.log(
      `FS→MinIO (unlinkDir): ${parsed.username}/${parsed.relPath}`,
    );
  }

  // =========================================================
  // 内部ヘルパー
  // =========================================================

  /** FS→MinIO アップロードの共通処理 (chokidar & FileBrowserService から使用) */
  private async internalFsFileToMinio(
    userId: string,
    username: string,
    relPath: string,
  ): Promise<void> {
    try {
      const home = await this.getUserHomePath(username);
      // リンク・特殊なファイル・上限超えは読まない(null になる)
      const file = safeReadFile(home, relPath, MAX_SYNC_SIZE);
      if (!file) return;
      await this.internalUploadToMinioAndDb(
        userId,
        relPath,
        file.buffer,
        file.size,
      );
    } catch (e) {
      this.logger.error(
        `internalFsFileToMinio failed [${relPath}]: ${e.message}`,
      );
    }
  }

  /** ファイルを MinIO に保存し、DB に登録（既存なら更新）する */
  private async internalUploadToMinioAndDb(
    userId: string,
    relPath: string,
    buffer: Buffer,
    size: number,
  ): Promise<void> {
    const filename = path.basename(relPath);
    const dirPath =
      path.dirname(relPath) === '.' ? null : path.dirname(relPath);
    const mimeType = this.guessMime(filename);
    const parentId = dirPath
      ? await this.findOrCreateFolderChain(userId, dirPath)
      : null;

    const existing = await this.prisma.file.findFirst({
      where: { owner_id: userId, name: filename, parent_id: parentId || null },
    });

    if (existing && existing.storage_key) {
      // 既存ファイルを上書き
      await this.minioClient.putObject(
        this.bucketName,
        existing.storage_key,
        buffer,
        size,
        {
          'Content-Type': mimeType,
        },
      );
      const diff = size - Number(existing.size);
      await this.prisma.file.update({
        where: { id: existing.id },
        data: { size, mime_type: mimeType, updated_at: new Date() },
      });
      if (diff !== 0) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { used_bytes: { increment: diff } },
        });
      }
    } else if (!existing) {
      // クォータチェック
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) return;
      if (BigInt(user.used_bytes) + BigInt(size) > BigInt(user.quota_bytes)) {
        this.logger.warn(
          `Quota exceeded for user ${userId}, skip sync of ${relPath}`,
        );
        return;
      }
      const fileId = uuidv4();
      const storageKey = `${userId}/${fileId}-${filename}`;
      await this.minioClient.putObject(
        this.bucketName,
        storageKey,
        buffer,
        size,
        {
          'Content-Type': mimeType,
        },
      );
      await this.prisma.file.create({
        data: {
          id: fileId,
          owner_id: userId,
          name: filename,
          size,
          mime_type: mimeType,
          storage_key: storageKey,
          parent_id: parentId || null,
        },
      });
      await this.prisma.user.update({
        where: { id: userId },
        data: { used_bytes: { increment: size } },
      });
    }
    // existing && !storage_key の場合はディレクトリなのでスキップ
  }

  /**
   * 絶対パスからユーザー名・相対パス・userId を取り出す。
   * /home/pi/hdd/ssh/{username}/{relPath} または /home/pi/hdd/ssh/users/{username}/{relPath}
   */
  private async parseFsPath(
    absPath: string,
  ): Promise<{ userId: string; username: string; relPath: string } | null> {
    const rel = path.relative(SSH_BASE, absPath);
    const parts = rel.split(path.sep);
    if (parts.length < 2) return null;

    let username: string;
    let relPath: string;

    if (parts[0] === 'users') {
      if (parts.length < 3) return null;
      username = parts[1];
      relPath = parts.slice(2).join('/');
    } else {
      username = parts[0];
      relPath = parts.slice(1).join('/');
    }

    if (!relPath) return null;
    if (!isValidAccountName(username)) return null;
    if (!isSyncableRelPath(relPath)) return null;

    const user = await this.prisma.user.findFirst({
      where: { account_name: username },
      select: { id: true },
    });
    if (!user) return null;

    return { userId: user.id, username, relPath };
  }

  /**
   * 相対パスの全フォルダを DB で find-or-create して末端フォルダの ID を返す。
   * "ssh/test" → sshId → testId
   */
  async findOrCreateFolderChain(
    userId: string,
    relPath: string,
  ): Promise<string | null> {
    if (!relPath || relPath === '.' || relPath === '/') return null;
    const parts = relPath.split('/').filter((p) => p && p !== '.');
    if (parts.length === 0) return null;

    let parentId: string | null = null;
    for (const name of parts) {
      let folder = await this.prisma.file.findFirst({
        where: {
          owner_id: userId,
          name,
          parent_id: parentId,
          mime_type: 'directory',
        },
      });
      if (!folder) {
        folder = await this.prisma.file.create({
          data: {
            owner_id: userId,
            name,
            size: 0,
            mime_type: 'directory',
            parent_id: parentId,
          },
        });
      }
      parentId = folder.id;
    }
    return parentId;
  }

  /** 相対パスから末端フォルダの ID を検索（作成しない版） */
  private async findFolderByPath(
    userId: string,
    relPath: string,
  ): Promise<string | null> {
    if (!relPath || relPath === '.' || relPath === '/') return null;
    const parts = relPath.split('/').filter((p) => p && p !== '.');
    if (parts.length === 0) return null;

    let parentId: string | null = null;
    for (const name of parts) {
      const folder = await this.prisma.file.findFirst({
        where: {
          owner_id: userId,
          name,
          parent_id: parentId,
          mime_type: 'directory',
        },
      });
      if (!folder) return null;
      parentId = folder.id;
    }
    return parentId;
  }

  /** DB の parent_id チェーンをたどりファイルの完全な相対パスを構築する */
  private async buildPathFromParent(
    name: string,
    parentId: string | null,
  ): Promise<string> {
    const parts: string[] = [name];
    let cur = parentId;
    while (cur) {
      const parent = await this.prisma.file.findUnique({
        where: { id: cur },
        select: { name: true, parent_id: true },
      });
      if (!parent) break;
      parts.unshift(parent.name);
      cur = parent.parent_id;
    }
    return parts.join('/');
  }

  /** ファイル名から MIME タイプを推定する */
  private guessMime(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const map: Record<string, string> = {
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.ts': 'application/typescript',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.zip': 'application/zip',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
      '.py': 'text/x-python',
      '.c': 'text/x-csrc',
      '.cpp': 'text/x-c++src',
      '.java': 'text/x-java',
      '.sh': 'application/x-sh',
      '.csv': 'text/csv',
    };
    return map[ext] || 'application/octet-stream';
  }

  /** 利用者フォルダのパスを返す。無ければ作る(利用者名は getUserHomePath で検証済み) */
  private async ensureUserHome(username: string): Promise<string> {
    const home = await this.getUserHomePath(username);
    fs.mkdirSync(home, { recursive: true });
    return home;
  }

  /**
   * 監視から外すパスか。アプリのソースや別プロジェクトなど、利用者のものではない SSH_BASE 直下のフォルダと、
   * 同期の対象外の名前("." で始まる名前と node_modules)を含むパスを外す。
   */
  private isIgnoredWatchPath(p: string): boolean {
    const rel = path.relative(SSH_BASE, p);
    if (rel === '') return false;
    const parts = rel.split(path.sep);
    if (NON_USER_TOP_DIRS.has(parts[0])) return true;
    return parts.some((c) => c.startsWith('.') || c === 'node_modules');
  }

  /**
   * 指定パスを「同期中」としてマークし、3 秒後に自動解除する。
   * MinIO→FS 書き込み後に chokidar が再トリガーするのを防ぐ。
   */
  private markSyncing(absPath: string): void {
    this.syncingPaths.add(absPath);
    setTimeout(() => this.syncingPaths.delete(absPath), 5000);
  }
}
