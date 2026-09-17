import { Test, TestingModule } from '@nestjs/testing';
import { FilesService } from './files.service';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from '../sync/sync.service';
import * as Minio from 'minio';

jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => ({
    putObject: jest.fn(),
    removeObject: jest.fn(),
    getObject: jest.fn(),
    presignedGetObject: jest.fn(),
  })),
}));

const mockPrisma = {
  file: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), delete: jest.fn(), update: jest.fn(), count: jest.fn() },
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
      const file = { id: 'file-a', owner_id: 'user-1', mime_type: 'text/plain', size: BigInt(100), storage_key: 'key-a' };
      mockPrisma.file.findFirst.mockResolvedValue(file);

      await service.deleteFile('user-1', 'file-a');

      const minioInstance = (Minio.Client as jest.Mock).mock.results[0].value;
      expect(minioInstance.removeObject).toHaveBeenCalledWith(expect.any(String), 'key-a');
      expect(mockPrisma.file.delete).toHaveBeenCalledWith({ where: { id: 'file-a' } });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { used_bytes: { decrement: BigInt(100) } },
      });
      // A leaf file has no children, so the recursive descendant lookup never runs.
      expect(mockPrisma.file.findMany).not.toHaveBeenCalled();
    });

    it('deletes a folder recursively: removes every descendant MinIO object and decrements used_bytes by their combined size', async () => {
      const folder = { id: 'folder-1', owner_id: 'user-1', mime_type: 'directory', size: BigInt(0), storage_key: null };
      const fileA = { id: 'file-a', parent_id: 'folder-1', mime_type: 'text/plain', size: BigInt(100), storage_key: 'key-a' };
      const subfolder = { id: 'sub-1', parent_id: 'folder-1', mime_type: 'directory', size: BigInt(0), storage_key: null };
      const fileB = { id: 'file-b', parent_id: 'sub-1', mime_type: 'text/plain', size: BigInt(200), storage_key: 'key-b' };

      mockPrisma.file.findFirst.mockResolvedValue(folder);
      mockPrisma.file.findMany.mockImplementation(({ where }: any) => {
        if (where.parent_id === 'folder-1') return Promise.resolve([fileA, subfolder]);
        if (where.parent_id === 'sub-1') return Promise.resolve([fileB]);
        return Promise.resolve([]);
      });

      await service.deleteFile('user-1', 'folder-1');

      const minioInstance = (Minio.Client as jest.Mock).mock.results[0].value;
      // Only the two real files have storage_key values — the folders themselves don't.
      expect(minioInstance.removeObject).toHaveBeenCalledTimes(2);
      expect(minioInstance.removeObject).toHaveBeenCalledWith(expect.any(String), 'key-a');
      expect(minioInstance.removeObject).toHaveBeenCalledWith(expect.any(String), 'key-b');
      // used_bytes must decrease by the SUM of every descendant's size (100 + 200),
      // not just the folder's own (zero) size — this is the regression this test guards.
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { used_bytes: { decrement: BigInt(300) } },
      });
      expect(mockPrisma.file.delete).toHaveBeenCalledWith({ where: { id: 'folder-1' } });
    });
  });
});
