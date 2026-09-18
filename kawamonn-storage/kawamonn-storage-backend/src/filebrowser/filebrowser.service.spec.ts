import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { FileBrowserService } from './filebrowser.service';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from '../sync/sync.service';

/**
 * FileBrowserService resolves paths under SSH_BASE/{username}, so these tests
 * exercise the REAL filesystem under a disposable, uniquely-named test account
 * rather than mocking `fs` — the whole point of this suite is verifying real
 * symlink semantics, which a mocked filesystem cannot faithfully reproduce.
 * jest-setup.ts points SSH_BASE at a throwaway temp directory (instead of the
 * hardcoded production path FileBrowserService falls back to) before this
 * file's own imports run, so this works unchanged on any machine, including CI.
 * The test directory is removed in afterAll.
 */
const SSH_BASE = process.env.SSH_BASE as string;
const TEST_USERNAME = `__filebrowser_spec_${process.pid}_${Date.now()}__`;
const testRoot = path.join(SSH_BASE, TEST_USERNAME);
const OUTSIDE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-outside-'));

const mockPrisma = {
    user: {
        // role: 'admin' -> root is SSH_BASE/{username} directly, simplest to set up
        findUnique: jest.fn().mockResolvedValue({ role: 'admin' }),
        findFirst: jest.fn().mockResolvedValue(null), // skip MinIO-sync side effects
    },
};

const mockSyncService = {
    uploadFsFileToMinio: jest.fn(),
    createFolderInDb: jest.fn(),
    deleteFsPathFromMinio: jest.fn(),
};

describe('FileBrowserService (path traversal / symlink containment)', () => {
    let service: FileBrowserService;

    beforeAll(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                FileBrowserService,
                { provide: PrismaService, useValue: mockPrisma },
                { provide: SyncService, useValue: mockSyncService },
            ],
        }).compile();
        service = module.get<FileBrowserService>(FileBrowserService);
    });

    afterAll(() => {
        fs.rmSync(testRoot, { recursive: true, force: true });
        fs.rmSync(OUTSIDE_DIR, { recursive: true, force: true });
    });

    it('creates and lists a normal file inside the root', async () => {
        await service.writeFile(TEST_USERNAME, '/hello.txt', Buffer.from('hi'));
        const entries = await service.listDir(TEST_USERNAME, '/');
        expect(entries.some((e) => e.name === 'hello.txt')).toBe(true);
    });

    it('rejects textual ../ traversal outside the root', async () => {
        await expect(service.readFile(TEST_USERNAME, '/../../outside')).rejects.toThrow(ForbiddenException);
    });

    it('rejects a symlink created inside the root that points outside it', async () => {
        const outsideSecret = path.join(OUTSIDE_DIR, 'secret.txt');
        fs.writeFileSync(outsideSecret, 'top secret');
        fs.symlinkSync(OUTSIDE_DIR, path.join(testRoot, 'escape-link'));

        await expect(service.readFile(TEST_USERNAME, '/escape-link/secret.txt')).rejects.toThrow(ForbiddenException);
        await expect(service.listDir(TEST_USERNAME, '/escape-link')).rejects.toThrow(ForbiddenException);
    });

    it('rejects creating a new file whose parent is a symlink pointing outside the root', async () => {
        await expect(
            service.writeFile(TEST_USERNAME, '/escape-link/newfile.txt', Buffer.from('x')),
        ).rejects.toThrow(ForbiddenException);
        expect(fs.existsSync(path.join(OUTSIDE_DIR, 'newfile.txt'))).toBe(false);
    });

    it('allows a symlink created inside the root that points to another location inside the root', async () => {
        fs.mkdirSync(path.join(testRoot, 'realdir'), { recursive: true });
        fs.writeFileSync(path.join(testRoot, 'realdir', 'inside.txt'), 'fine');
        fs.symlinkSync(path.join(testRoot, 'realdir'), path.join(testRoot, 'internal-link'));

        const entries = await service.listDir(TEST_USERNAME, '/internal-link');
        expect(entries.some((e) => e.name === 'inside.txt')).toBe(true);
    });
});
