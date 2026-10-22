import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileBrowserService } from './filebrowser.service';

/**
 * FileBrowserService は SSH_BASE/{username}(管理者)や SSH_BASE/users/{username} の実ファイルを扱うので、
 * fs をモックせず、jest-setup.ts が差し替えた一時フォルダの上で、本物のシンボリックリンクの挙動を確かめる。
 */
const SSH_BASE = process.env.SSH_BASE as string;
// 利用者名の規則(先頭は英数字、32 文字まで)に合う名前にする
const TEST_USERNAME = `fbspec${process.pid}x${Date.now().toString(36)}`;
const testRoot = path.join(SSH_BASE, TEST_USERNAME); // role: 'admin' なので SSH_BASE 直下
const OUTSIDE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-outside-'));

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
};
const mockUsage = { adjust: jest.fn() };

describe('FileBrowserService', () => {
  let service: FileBrowserService;

  beforeEach(() => {
    jest.clearAllMocks();
    let currentUsedBytes = 0n;
    mockPrisma.user.findUnique.mockImplementation(async () => ({
      id: 'u1',
      role: 'admin',
      used_bytes: currentUsedBytes,
      quota_bytes: 1_000_000n,
    }));
    mockUsage.adjust.mockImplementation(async (_id: string, delta: number) => {
      currentUsedBytes += BigInt(delta);
    });
    fs.rmSync(testRoot, { recursive: true, force: true });
    fs.mkdirSync(testRoot, { recursive: true });
    fs.writeFileSync(path.join(OUTSIDE_DIR, 'secret.txt'), 'top secret');
    service = new FileBrowserService(mockPrisma as any, mockUsage as any);
  });

  afterAll(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
    fs.rmSync(OUTSIDE_DIR, { recursive: true, force: true });
  });

  describe('通常の操作', () => {
    it('ファイルを書き、一覧に出し、読み戻せる。使用量を増やす', async () => {
      await service.writeFile(
        TEST_USERNAME,
        '/docs/hello.txt',
        Buffer.from('hi'),
      );
      const root = await service.listDir(TEST_USERNAME, '/');
      expect(root).toEqual([
        expect.objectContaining({
          name: 'docs',
          path: '/docs',
          isDir: true,
          mime: 'directory',
        }),
      ]);
      const docs = await service.listDir(TEST_USERNAME, '/docs');
      expect(docs).toEqual([
        expect.objectContaining({
          name: 'hello.txt',
          path: '/docs/hello.txt',
          isDir: false,
          size: 2,
          mime: 'text/plain',
        }),
      ]);
      const file = await service.readFile(TEST_USERNAME, '/docs/hello.txt');
      expect(file.buffer.toString()).toBe('hi');
      expect(mockUsage.adjust).toHaveBeenCalledWith('u1', 2);
    });

    it('上書きは増えた分だけ使用量に足す', async () => {
      await service.writeFile(TEST_USERNAME, '/a.txt', Buffer.from('12345'));
      await service.writeFile(TEST_USERNAME, '/a.txt', Buffer.from('12'));
      expect(mockUsage.adjust).toHaveBeenLastCalledWith('u1', -3);
    });

    it('隠しファイルは一覧に出さない', async () => {
      fs.writeFileSync(path.join(testRoot, '.bashrc'), 'x');
      fs.writeFileSync(path.join(testRoot, 'visible.txt'), 'x');
      const names = (await service.listDir(TEST_USERNAME, '/')).map(
        (e) => e.name,
      );
      expect(names).toEqual(['visible.txt']);
    });

    it('フォルダを作り、名前を変え、中身ごと消すと使用量を減らす', async () => {
      await service.mkdir(TEST_USERNAME, '/proj');
      await expect(service.mkdir(TEST_USERNAME, '/proj')).rejects.toThrow(
        BadRequestException,
      );
      await service.writeFile(TEST_USERNAME, '/proj/a.c', Buffer.from('1234'));
      await service.rename(TEST_USERNAME, '/proj', '/project');
      expect(fs.existsSync(path.join(testRoot, 'project', 'a.c'))).toBe(true);
      await service.deleteItem(TEST_USERNAME, '/project');
      expect(fs.existsSync(path.join(testRoot, 'project'))).toBe(false);
      expect(mockUsage.adjust).toHaveBeenLastCalledWith('u1', -4);
    });

    it('無いものは 404、フォルダを読もうとすると 400', async () => {
      await expect(
        service.readFile(TEST_USERNAME, '/nope.txt'),
      ).rejects.toThrow(NotFoundException);
      await expect(service.listDir(TEST_USERNAME, '/nope')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.deleteItem(TEST_USERNAME, '/nope')).rejects.toThrow(
        NotFoundException,
      );
      await service.mkdir(TEST_USERNAME, '/d');
      await expect(service.readFile(TEST_USERNAME, '/d')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('容量の上限', () => {
    it('上限を超える保存は 413 で断り、書かない', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        role: 'admin',
        used_bytes: 8n,
        quota_bytes: 10n,
      });
      await expect(
        service.writeFile(TEST_USERNAME, '/big.txt', Buffer.from('12345')),
      ).rejects.toThrow(PayloadTooLargeException);
      expect(fs.existsSync(path.join(testRoot, 'big.txt'))).toBe(false);
      expect(mockUsage.adjust).not.toHaveBeenCalled();
    });

    it('上限を超えていても、小さくする上書きはできる', async () => {
      fs.writeFileSync(path.join(testRoot, 'f.txt'), '1234567890');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        role: 'admin',
        used_bytes: 20n,
        quota_bytes: 10n,
      });
      await service.writeFile(TEST_USERNAME, '/f.txt', Buffer.from('12'));
      expect(fs.readFileSync(path.join(testRoot, 'f.txt'), 'utf8')).toBe('12');
    });

    it('端末で作られたファイルを削除しても used_bytes が負にならないよう減少分を抑える', async () => {
      fs.writeFileSync(path.join(testRoot, 'term.txt'), '12345');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        role: 'admin',
        used_bytes: 2n,
        quota_bytes: 100n,
      });
      await service.deleteItem(TEST_USERNAME, '/term.txt');
      expect(mockUsage.adjust).toHaveBeenCalledWith('u1', -2);
    });
  });

  describe('利用者フォルダの外に出ない', () => {
    it('../ を含むパスは 403', async () => {
      await expect(
        service.readFile(TEST_USERNAME, '/../../outside'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.writeFile(TEST_USERNAME, '/../escape.txt', Buffer.from('x')),
      ).rejects.toThrow(ForbiddenException);
      await expect(service.listDir(TEST_USERNAME, '/..')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.deleteItem(TEST_USERNAME, '/')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('外を指すリンクは読めず、一覧もできず、その中へ書けない', async () => {
      fs.symlinkSync(OUTSIDE_DIR, path.join(testRoot, 'escape-link'));
      await expect(
        service.readFile(TEST_USERNAME, '/escape-link/secret.txt'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.listDir(TEST_USERNAME, '/escape-link'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.writeFile(
          TEST_USERNAME,
          '/escape-link/new.txt',
          Buffer.from('x'),
        ),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.rename(TEST_USERNAME, '/escape-link/secret.txt', '/stolen.txt'),
      ).rejects.toThrow(ForbiddenException);
      expect(fs.readdirSync(OUTSIDE_DIR)).toEqual(['secret.txt']);
    });

    it('リンクは一覧に出さず、中を指していてもたどらない', async () => {
      fs.mkdirSync(path.join(testRoot, 'realdir'));
      fs.writeFileSync(path.join(testRoot, 'realdir', 'inside.txt'), 'fine');
      fs.symlinkSync(
        path.join(testRoot, 'realdir'),
        path.join(testRoot, 'internal-link'),
      );
      const names = (await service.listDir(TEST_USERNAME, '/')).map(
        (e) => e.name,
      );
      expect(names).toEqual(['realdir']);
      await expect(
        service.listDir(TEST_USERNAME, '/internal-link'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('リンクを消すと、リンク自体だけが消える', async () => {
      fs.symlinkSync(OUTSIDE_DIR, path.join(testRoot, 'escape-link'));
      await service.deleteItem(TEST_USERNAME, '/escape-link');
      expect(fs.existsSync(path.join(testRoot, 'escape-link'))).toBe(false);
      expect(
        fs.readFileSync(path.join(OUTSIDE_DIR, 'secret.txt'), 'utf8'),
      ).toBe('top secret');
    });

    it('"." や ".." の利用者名では何もしない', async () => {
      await expect(service.listDir('..', '/')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });
  });
});
