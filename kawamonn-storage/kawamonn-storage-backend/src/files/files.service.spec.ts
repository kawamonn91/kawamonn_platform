import { Test, TestingModule } from '@nestjs/testing';
import { FilesService } from './files.service';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from '../sync/sync.service';
import * as Minio from 'minio';
import { BadRequestException, NotFoundException } from '@nestjs/common';

jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => ({
    putObject: jest.fn(),
    removeObject: jest.fn(),
    getObject: jest.fn(),
    presignedGetObject: jest.fn(),
  })),
}));

const mockPrisma = {
  file: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  user: { findUnique: jest.fn(), update: jest.fn() },
};

const mockSyncService = {
  resolveDbFilePath: jest.fn(),
  writeFileToFs: jest.fn(),
  createDirInFs: jest.fn(),
  deleteFromFs: jest.fn(),
};

describe('FilesService', () => {
  let service: FilesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SyncService, useValue: mockSyncService },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('deleteFile', () => {
    beforeEach(() => {
      mockSyncService.resolveDbFilePath.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({ account_name: 'alice' });
    });

    it('deletes a single leaf file: removes its MinIO object and decrements used_bytes by its own size', async () => {
      const file = {
        id: 'file-a',
        owner_id: 'user-1',
        mime_type: 'text/plain',
        size: BigInt(100),
        storage_key: 'key-a',
      };
      mockPrisma.file.findFirst.mockResolvedValue(file);

      await service.deleteFile('user-1', 'file-a');

      const minioInstance = (Minio.Client as jest.Mock).mock.results[0].value;
      expect(minioInstance.removeObject).toHaveBeenCalledWith(
        expect.any(String),
        'key-a',
      );
      expect(mockPrisma.file.delete).toHaveBeenCalledWith({
        where: { id: 'file-a' },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { used_bytes: { decrement: BigInt(100) } },
      });
      // A leaf file has no children, so the recursive descendant lookup never runs.
      expect(mockPrisma.file.findMany).not.toHaveBeenCalled();
    });

    it('deletes a folder recursively: removes every descendant MinIO object and decrements used_bytes by their combined size', async () => {
      const folder = {
        id: 'folder-1',
        owner_id: 'user-1',
        mime_type: 'directory',
        size: BigInt(0),
        storage_key: null,
      };
      const fileA = {
        id: 'file-a',
        parent_id: 'folder-1',
        mime_type: 'text/plain',
        size: BigInt(100),
        storage_key: 'key-a',
      };
      const subfolder = {
        id: 'sub-1',
        parent_id: 'folder-1',
        mime_type: 'directory',
        size: BigInt(0),
        storage_key: null,
      };
      const fileB = {
        id: 'file-b',
        parent_id: 'sub-1',
        mime_type: 'text/plain',
        size: BigInt(200),
        storage_key: 'key-b',
      };

      mockPrisma.file.findFirst.mockResolvedValue(folder);
      mockPrisma.file.findMany.mockImplementation(({ where }: any) => {
        if (where.parent_id === 'folder-1')
          return Promise.resolve([fileA, subfolder]);
        if (where.parent_id === 'sub-1') return Promise.resolve([fileB]);
        return Promise.resolve([]);
      });

      await service.deleteFile('user-1', 'folder-1');

      const minioInstance = (Minio.Client as jest.Mock).mock.results[0].value;
      // Only the two real files have storage_key values — the folders themselves don't.
      expect(minioInstance.removeObject).toHaveBeenCalledTimes(2);
      expect(minioInstance.removeObject).toHaveBeenCalledWith(
        expect.any(String),
        'key-a',
      );
      expect(minioInstance.removeObject).toHaveBeenCalledWith(
        expect.any(String),
        'key-b',
      );
      // used_bytes must decrease by the SUM of every descendant's size (100 + 200),
      // not just the folder's own (zero) size — this is the regression this test guards.
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { used_bytes: { decrement: BigInt(300) } },
      });
      expect(mockPrisma.file.delete).toHaveBeenCalledWith({
        where: { id: 'folder-1' },
      });
    });
  });

  describe('名前の検査(利用者フォルダの外を指す名前は受け付けない)', () => {
    it.each(['..', '../x', 'a/b', 'a\\b', ''])(
      'createFolder は %j を拒否し、DB にも FS にも触れない',
      async (name) => {
        await expect(service.createFolder('u1', name)).rejects.toThrow(
          BadRequestException,
        );
        expect(mockPrisma.file.create).not.toHaveBeenCalled();
        expect(mockSyncService.createDirInFs).not.toHaveBeenCalled();
      },
    );

    it('createFolder は他人のフォルダの中には作らない', async () => {
      mockPrisma.file.findFirst.mockResolvedValue(null);
      await expect(
        service.createFolder('u1', 'ok', 'someone-elses-folder'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.file.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'someone-elses-folder',
          owner_id: 'u1',
          mime_type: 'directory',
        },
      });
      expect(mockPrisma.file.create).not.toHaveBeenCalled();
    });

    it('createTextFile は "/" を含む名前を拒否する', async () => {
      await expect(
        service.createTextFile('u1', '../../.ssh/authorized_keys', 'x'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.file.create).not.toHaveBeenCalled();
    });

    it('uploadFile は ".." を含むファイル名を拒否する', async () => {
      const file = {
        originalname: '../../evil.txt',
        buffer: Buffer.from('x'),
        size: 1,
        mimetype: 'text/plain',
      } as Express.Multer.File;
      await expect(service.uploadFile('u1', file)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.file.create).not.toHaveBeenCalled();
    });
  });
});
