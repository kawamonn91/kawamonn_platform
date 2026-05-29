import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from '../sync/sync.service';
import * as Minio from 'minio';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class FilesService {
    private minioClient: Minio.Client;
    private bucketName: string;

    constructor(
        private prisma: PrismaService,
        private syncService: SyncService,
    ) {
        this.minioClient = new Minio.Client({
            endPoint: process.env.MINIO_ENDPOINT || 'localhost',
            port: parseInt(process.env.MINIO_PORT || '9000'),
            useSSL: false,
            accessKey: process.env.MINIO_ACCESS_KEY || 'admin',
            secretKey: process.env.MINIO_SECRET_KEY || 'minio_password',
        });
        this.bucketName = process.env.MINIO_BUCKET || 'storage-bucket';
    }

    async uploadFile(userId: string, file: Express.Multer.File, parentId?: string) {
        // Multer parses non-ASCII filename headers as latin1 by default, causing garbling.
        // Convert it back to utf8.
        file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');

        // If parentId is provided, verify it exists and is a directory
        if (parentId) {
            const parent = await this.prisma.file.findFirst({
                where: { id: parentId, owner_id: userId, mime_type: 'directory' }
            });
            if (!parent) throw new NotFoundException('Parent folder not found');
        }

        // Check user quota
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        if (BigInt(user.used_bytes) + BigInt(file.size) > BigInt(user.quota_bytes)) {
            throw new InternalServerErrorException('Storage quota exceeded');
        }

        const fileId = uuidv4();
        const storageKey = `${userId}/${fileId}-${file.originalname}`;

        try {
            await this.minioClient.putObject(
                this.bucketName,
                storageKey,
                file.buffer,
                file.size,
                { 'Content-Type': file.mimetype }
            );
        } catch (e) {
            throw new InternalServerErrorException(`Failed to upload to MinIO: ${e.message}`);
        }

        const newFile = await this.prisma.file.create({
            data: {
                id: fileId,
                owner_id: userId,
                name: file.originalname,
                size: file.size,
                mime_type: file.mimetype,
                storage_key: storageKey,
                parent_id: parentId || null
            }
        });

        await this.prisma.user.update({
            where: { id: userId },
            data: { used_bytes: { increment: file.size } }
        });

        // MinIO→FS 同期: DB パスを解決してファイルを書き込む
        try {
            const dbUser = await this.prisma.user.findUnique({ where: { id: userId }, select: { account_name: true } });
            if (dbUser) {
                const relPath = await this.syncService.resolveDbFilePath(newFile.id);
                if (relPath) {
                    await this.syncService.writeFileToFs(dbUser.account_name, relPath, file.buffer);
                }
            }
        } catch (e) {
            // FS 同期失敗はエラーにしない（MinIO は成功しているため）
        }

        // Convert BigInt size to string for JSON serialization
        return { ...newFile, size: newFile.size.toString() };
    }

    async createFolder(userId: string, name: string, parentId?: string) {
        const folder = await this.prisma.file.create({
            data: {
                owner_id: userId,
                name: name,
                size: 0,
                mime_type: 'directory',
                parent_id: parentId || null
            }
        });

        // MinIO→FS 同期: ディレクトリを作成する
        try {
            const dbUser = await this.prisma.user.findUnique({ where: { id: userId }, select: { account_name: true } });
            if (dbUser) {
                const relPath = await this.syncService.resolveDbFilePath(folder.id);
                if (relPath) {
                    await this.syncService.createDirInFs(dbUser.account_name, relPath);
                }
            }
        } catch (e) { /* FS 同期失敗は無視 */ }

        return { ...folder, size: folder.size.toString() };
    }

    async deleteFile(userId: string, fileId: string) {
        const file = await this.prisma.file.findFirst({
            where: { id: fileId, owner_id: userId }
        });
        if (!file) throw new NotFoundException('File not found');

        // FS 同期用にパスを先に解決（DB 削除前に取得する必要がある）
        let fsRelPath: string | null = null;
        let fsUsername: string | null = null;
        try {
            fsRelPath = await this.syncService.resolveDbFilePath(fileId);
            const dbUser = await this.prisma.user.findUnique({ where: { id: userId }, select: { account_name: true } });
            fsUsername = dbUser?.account_name ?? null;
        } catch (e) { /* ignore */ }

        // Delete from MinIO if it has a storage key (not a directory)
        if (file.storage_key) {
            try {
                await this.minioClient.removeObject(this.bucketName, file.storage_key);
            } catch (e) {
                console.error('MinIO delete failed (continuing):', e.message);
            }
        }

        // Delete from DB (cascades to children via schema)
        await this.prisma.file.delete({ where: { id: fileId } });

        // Decrement used_bytes if it was a real file
        if (file.size > 0) {
            await this.prisma.user.update({
                where: { id: userId },
                data: { used_bytes: { decrement: file.size } }
            });
        }

        // MinIO→FS 同期: FS 側も削除
        try {
            if (fsUsername && fsRelPath) {
                await this.syncService.deleteFromFs(fsUsername, fsRelPath);
            }
        } catch (e) { /* ignore */ }

        return { success: true };
    }

    async createTextFile(userId: string, name: string, content: string, parentId?: string) {
        const buffer = Buffer.from(content || '', 'utf8');

        // Require valid name
        if (!name.trim()) throw new BadRequestException('Filename required');

        // Validate parent
        if (parentId) {
            const parent = await this.prisma.file.findFirst({
                where: { id: parentId, owner_id: userId, mime_type: 'directory' }
            });
            if (!parent) throw new NotFoundException('Parent folder not found');
        }

        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        if (BigInt(user.used_bytes) + BigInt(buffer.length) > BigInt(user.quota_bytes)) {
            throw new InternalServerErrorException('Storage quota exceeded');
        }

        const fileId = uuidv4();
        const storageKey = `${userId}/${fileId}-${name}`;

        try {
            await this.minioClient.putObject(
                this.bucketName,
                storageKey,
                buffer,
                buffer.length,
                { 'Content-Type': 'text/plain' }
            );
        } catch (e) {
            throw new InternalServerErrorException(`Failed to write to MinIO: ${e.message}`);
        }

        const newFile = await this.prisma.file.create({
            data: {
                id: fileId,
                owner_id: userId,
                name: name,
                size: buffer.length,
                mime_type: 'text/plain',
                storage_key: storageKey,
                parent_id: parentId || null
            }
        });

        await this.prisma.user.update({
            where: { id: userId },
            data: { used_bytes: { increment: buffer.length } }
        });

        // MinIO→FS
        try {
            const dbUser = await this.prisma.user.findUnique({ where: { id: userId }, select: { account_name: true } });
            if (dbUser) {
                const relPath = await this.syncService.resolveDbFilePath(newFile.id);
                if (relPath) {
                    await this.syncService.writeFileToFs(dbUser.account_name, relPath, buffer);
                }
            }
        } catch (e) { /* ignore */ }

        return { ...newFile, size: newFile.size.toString() };
    }

    async updateFileContent(userId: string, fileId: string, buffer: Buffer) {
        const file = await this.prisma.file.findFirst({
            where: { id: fileId, owner_id: userId }
        });
        if (!file || file.mime_type === 'directory' || !file.storage_key) {
            throw new NotFoundException('File not found or cannot be edited');
        }

        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        const sizeDiff = BigInt(buffer.length) - BigInt(file.size);
        if (sizeDiff > 0 && BigInt(user.used_bytes) + sizeDiff > BigInt(user.quota_bytes)) {
            throw new InternalServerErrorException('Storage quota exceeded');
        }

        try {
            await this.minioClient.putObject(
                this.bucketName,
                file.storage_key,
                buffer,
                buffer.length,
                { 'Content-Type': file.mime_type }
            );
        } catch (e) {
            throw new InternalServerErrorException(`Failed to upload to MinIO: ${e.message}`);
        }

        const updatedFile = await this.prisma.file.update({
            where: { id: fileId },
            data: { size: buffer.length }
        });

        if (sizeDiff !== 0n) {
            await this.prisma.user.update({
                where: { id: userId },
                data: { used_bytes: { increment: Number(sizeDiff) } } // increment accepts negative values in newer Prisma, or we use algebraic addition
            });
        }

        // MinIO→FS
        try {
            const dbUser = await this.prisma.user.findUnique({ where: { id: userId }, select: { account_name: true } });
            if (dbUser) {
                const relPath = await this.syncService.resolveDbFilePath(fileId);
                if (relPath) {
                    await this.syncService.writeFileToFs(dbUser.account_name, relPath, buffer);
                }
            }
        } catch (e) { /* ignore */ }

        return { ...updatedFile, size: updatedFile.size.toString() };
    }
    async getDownloadUrl(userId: string, fileId: string) {
        const file = await this.prisma.file.findFirst({
            where: { id: fileId, owner_id: userId }
        });
        if (!file) throw new NotFoundException('File not found');
        if (file.mime_type === 'directory') throw new BadRequestException('Cannot download directory');

        const reqParams = {
            'response-content-disposition': `attachment; filename="${encodeURIComponent(file.name)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`
        };
        return this.minioClient.presignedGetObject(this.bucketName, file.storage_key, 3600, reqParams);
    }

    async streamFile(userId: string, fileId: string) {
        const file = await this.prisma.file.findFirst({
            where: { id: fileId, owner_id: userId }
        });
        if (!file) throw new NotFoundException('File not found');
        if (file.mime_type === 'directory') throw new BadRequestException('Cannot stream a directory');

        const stream = await this.minioClient.getObject(this.bucketName, file.storage_key);
        return { stream, mime_type: file.mime_type, name: file.name, size: file.size };
    }

    async listFiles(userId: string, page = 1, perPage = 20, query?: string, parentId: string | null = null) {
        const skip = (page - 1) * perPage;
        const whereClause: any = { owner_id: userId };

        if (query) {
            whereClause.name = { contains: query, mode: 'insensitive' };
        } else {
            whereClause.parent_id = parentId;
        }

        const [items, total] = await Promise.all([
            this.prisma.file.findMany({
                where: whereClause,
                skip,
                take: perPage,
                orderBy: [
                    { mime_type: 'asc' }, // Folders first (directory starts with d)
                    { name: 'asc' }
                ]
            }),
            this.prisma.file.count({ where: whereClause })
        ]);


        // Convert BigInts to strings for JSON serialization
        return {
            items: items.map(i => ({ ...i, size: i.size.toString() })),
            total_count: total
        };
    }
}
