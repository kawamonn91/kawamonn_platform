import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from '../sync/sync.service';
import * as fs from 'fs';
import * as path from 'path';

const SSH_BASE = '/home/pi/hdd/ssh';
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export interface FileEntry {
    name: string;
    path: string;
    isDir: boolean;
    size: number;
    mtime: Date;
    readonly: boolean;
}

@Injectable()
export class FileBrowserService {
    constructor(private readonly syncService: SyncService, private readonly prisma: PrismaService) {}
    /**
     * ユーザーのルートパス (/home/pi/hdd/ssh/{username} または /home/pi/hdd/ssh/users/{username}) を返す。
     * ホームディレクトリが存在しない場合は作成する。
     */
    private async userRoot(username: string): Promise<string> {
        const user = await this.prisma.user.findUnique({
            where: { account_name: username },
            select: { role: true },
        });
        const isMin = user && user.role === 'admin';
        const root = isMin ? path.join(SSH_BASE, username) : path.join(SSH_BASE, 'users', username);
        if (!fs.existsSync(root)) {
            fs.mkdirSync(root, { recursive: true });
        }
        return root;
    }

    /**
     * パストラバーサル攻撃を防止しつつ、絶対パスを解決する。
     * ユーザーのルートディレクトリ外へのアクセスは ForbiddenException を投げる。
     */
    private async resolveSafe(username: string, relPath: string): Promise<string> {
        const root = await this.userRoot(username);
        // relPath が空または '/' の場合はルートを返す
        const normalized = relPath ? relPath.replace(/\\/g, '/') : '/';
        const absolute = path.resolve(root, normalized.startsWith('/') ? normalized.slice(1) : normalized);

        if (!absolute.startsWith(root + path.sep) && absolute !== root) {
            throw new ForbiddenException('Access outside home directory is not allowed');
        }
        return absolute;
    }

    /** ディレクトリ内容を一覧取得 */
    async listDir(username: string, relPath: string = '/'): Promise<FileEntry[]> {
        const dirPath = await this.resolveSafe(username, relPath);

        if (!fs.existsSync(dirPath)) {
            throw new NotFoundException(`Directory not found: ${relPath}`);
        }

        const stat = fs.statSync(dirPath);
        if (!stat.isDirectory()) {
            throw new BadRequestException(`Path is not a directory: ${relPath}`);
        }

        const names = fs.readdirSync(dirPath);
        const entries: FileEntry[] = [];

        for (const name of names) {
            // 隠しファイル(.ssh, .localなど)はスキップ
            if (name.startsWith('.')) continue;

            try {
                const fullPath = path.join(dirPath, name);
                const s = fs.statSync(fullPath);
                const rel = path.join(relPath === '/' ? '' : relPath, name).replace(/\\/g, '/');
                entries.push({
                    name,
                    path: rel.startsWith('/') ? rel : '/' + rel,
                    isDir: s.isDirectory(),
                    size: s.size,
                    mtime: s.mtime,
                    readonly: false,
                });
            } catch {
                // パーミッションエラーなどは無視
            }
        }

        // ディレクトリ先頭、次いで名前順
        entries.sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        return entries;
    }

    /** ファイル内容を Buffer として返す */
    async readFile(username: string, relPath: string): Promise<{ buffer: Buffer; mime: string; name: string }> {
        const filePath = await this.resolveSafe(username, relPath);

        if (!fs.existsSync(filePath)) {
            throw new NotFoundException(`File not found: ${relPath}`);
        }

        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            throw new BadRequestException('Cannot download a directory');
        }
        if (stat.size > MAX_FILE_SIZE) {
            throw new BadRequestException('File is too large to download (max 100MB)');
        }

        const buffer = fs.readFileSync(filePath);
        const name = path.basename(filePath);
        // 簡易 MIME 推定
        const ext = path.extname(name).toLowerCase();
        const mimeMap: Record<string, string> = {
            '.txt': 'text/plain', '.md': 'text/markdown',
            '.html': 'text/html', '.css': 'text/css',
            '.js': 'application/javascript', '.ts': 'application/typescript',
            '.json': 'application/json', '.xml': 'application/xml',
            '.pdf': 'application/pdf',
            '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
            '.zip': 'application/zip', '.tar': 'application/x-tar',
            '.gz': 'application/gzip',
            '.py': 'text/x-python', '.c': 'text/x-csrc', '.cpp': 'text/x-c++src',
            '.java': 'text/x-java', '.sh': 'application/x-sh',
            '.csv': 'text/csv',
        };
        const mime = mimeMap[ext] || 'application/octet-stream';

        return { buffer, mime, name };
    }

    /** ファイルをアップロード（上書き） */
    async writeFile(username: string, relPath: string, buffer: Buffer): Promise<void> {
        const filePath = await this.resolveSafe(username, relPath);
        const dir = path.dirname(filePath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, buffer);

        // FS→MinIO 同期
        const user = await this.prisma.user.findFirst({ where: { account_name: username }, select: { id: true } });
        if (user) {
            await this.syncService.uploadFsFileToMinio(user.id, username, relPath).catch(() => {});
        }
    }

    /** ディレクトリ作成 */
    async mkdir(username: string, relPath: string): Promise<void> {
        const dirPath = await this.resolveSafe(username, relPath);

        if (fs.existsSync(dirPath)) {
            throw new BadRequestException('Directory already exists');
        }

        fs.mkdirSync(dirPath, { recursive: true });

        // FS→MinIO 同期: DB にフォルダを作成
        const user = await this.prisma.user.findFirst({ where: { account_name: username }, select: { id: true } });
        if (user) {
            await this.syncService.createFolderInDb(user.id, relPath).catch(() => {});
        }
    }

    /** ファイルまたはディレクトリを削除 */
    async deleteItem(username: string, relPath: string): Promise<void> {
        const itemPath = await this.resolveSafe(username, relPath);

        if (!fs.existsSync(itemPath)) {
            throw new NotFoundException(`Not found: ${relPath}`);
        }

        const stat = fs.statSync(itemPath);
        if (stat.isDirectory()) {
            fs.rmSync(itemPath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(itemPath);
        }

        // FS→MinIO 同期: MinIO + DB からも削除
        const user = await this.prisma.user.findFirst({ where: { account_name: username }, select: { id: true } });
        if (user) {
            await this.syncService.deleteFsPathFromMinio(user.id, username, relPath).catch(() => {});
        }
    }

    /** ファイルまたはディレクトリの名前変更/移動 */
    async rename(username: string, oldPath: string, newPath: string): Promise<void> {
        const src = await this.resolveSafe(username, oldPath);
        const dst = await this.resolveSafe(username, newPath);

        if (!fs.existsSync(src)) {
            throw new NotFoundException(`Not found: ${oldPath}`);
        }
        if (fs.existsSync(dst)) {
            throw new BadRequestException('Destination already exists');
        }

        fs.renameSync(src, dst);
    }
}
