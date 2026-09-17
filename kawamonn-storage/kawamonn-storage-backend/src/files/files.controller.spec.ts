import { Test, TestingModule } from '@nestjs/testing';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { PrismaService } from '../prisma/prisma.service';

const mockFilesService = {
  uploadFile: jest.fn(),
  createFolder: jest.fn(),
  createTextFile: jest.fn(),
  updateFileContent: jest.fn(),
  listFiles: jest.fn(),
  getDownloadUrl: jest.fn(),
  deleteFile: jest.fn(),
  streamFile: jest.fn(),
};

const mockPrisma = {
  user: { findUnique: jest.fn() },
};

describe('FilesController', () => {
  let controller: FilesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [
        { provide: FilesService, useValue: mockFilesService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    controller = module.get<FilesController>(FilesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
