import * as fs from 'fs';
import * as path from 'path';
import { isSyncableRelPath, SyncService } from './sync.service';

jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => ({
    putObject: jest.fn().mockResolvedValue(undefined),
    removeObject: jest.fn().mockResolvedValue(undefined),
    getObject: jest.fn(),
  })),
}));

// src/jest-setup.ts が一時フォルダに差し替えている
const SSH_BASE = process.env.SSH_BASE as string;

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  file: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

describe('SyncService(利用者フォルダの外に出ない)', () => {
  let service: SyncService;
  let minio: { putObject: jest.Mock };
  let home: string;
  let outside: string;
  let user: string;
  let n = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    user = `alice${++n}`;
    home = path.join(SSH_BASE, 'users', user);
    outside = path.join(SSH_BASE, 'outside');
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET');

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      role: 'user',
      used_bytes: 0n,
      quota_bytes: 1_000_000n,
    });
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'u1' });
    mockPrisma.file.findFirst.mockResolvedValue(null);
    mockPrisma.file.create.mockResolvedValue({ id: 'f1' });

    service = new SyncService(mockPrisma as any);
    minio = (service as any).minioClient;
  });

  afterEach(() => {
    fs.rmSync(path.join(SSH_BASE, 'users'), { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(path.join(SSH_BASE, 'escaped.txt'), { force: true });
  });

  it('利用者フォルダの中には普通に書ける', async () => {
    await service.writeFileToFs(user, 'docs/a.txt', Buffer.from('hello'));
    expect(fs.readFileSync(path.join(home, 'docs/a.txt'), 'utf8')).toBe(
      'hello',
    );
  });

  it('".." を含むパスでは書かない', async () => {
    await service.writeFileToFs(user, '../../escaped.txt', Buffer.from('x'));
    expect(fs.existsSync(path.join(SSH_BASE, 'escaped.txt'))).toBe(false);
    await service.createDirInFs(user, '../../escaped-dir');
    expect(fs.existsSync(path.join(SSH_BASE, 'escaped-dir'))).toBe(false);
  });

  it('利用者名が ".." でも、そのフォルダ(SSH_BASE)に書かない', async () => {
    await service.writeFileToFs('..', 'escaped.txt', Buffer.from('x'));
    expect(fs.existsSync(path.join(SSH_BASE, 'escaped.txt'))).toBe(false);
  });

  it('外を指すリンクの中へは書かない', async () => {
    fs.symlinkSync(outside, path.join(home, 'link'));
    await service.writeFileToFs(user, 'link/pwned.txt', Buffer.from('x'));
    await service.createDirInFs(user, 'link/sub');
    expect(fs.readdirSync(outside)).toEqual(['secret.txt']);
  });

  it('外を指すリンクを経由して消さない', async () => {
    fs.symlinkSync(outside, path.join(home, 'link'));
    await service.deleteFromFs(user, 'link/secret.txt');
    await service.deleteFromFs(user, 'link');
    expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8')).toBe(
      'SECRET',
    );
    expect(fs.existsSync(path.join(home, 'link'))).toBe(false); // リンク自体だけが消える
  });

  it('外のファイルを指すリンクは MinIO に上げない', async () => {
    fs.symlinkSync(
      path.join(outside, 'secret.txt'),
      path.join(home, 'secret-link.txt'),
    );
    await service.uploadFsFileToMinio('u1', user, 'secret-link.txt');
    await (service as any).internalFsFileToMinio('u1', user, 'secret-link.txt');
    expect(minio.putObject).not.toHaveBeenCalled();
    expect(mockPrisma.file.create).not.toHaveBeenCalled();
  });

  it('普通のファイルは MinIO に上げる', async () => {
    fs.writeFileSync(path.join(home, 'note.txt'), 'note');
    await service.uploadFsFileToMinio('u1', user, 'note.txt');
    expect(minio.putObject).toHaveBeenCalledTimes(1);
    expect(minio.putObject.mock.calls[0][2]).toEqual(Buffer.from('note'));
    expect(mockPrisma.file.create).toHaveBeenCalledTimes(1);
  });

  it('監視のイベントでも、リンク経由のパスや対象外の名前は利用者のものとして扱わない', async () => {
    const parse = (p: string) => (service as any).parseFsPath(p);
    expect(await parse(path.join(home, 'ok.txt'))).toMatchObject({
      username: user,
      relPath: 'ok.txt',
    });
    expect(await parse(path.join(home, '.ssh/id_ed25519'))).toBeNull();
    expect(await parse(path.join(home, 'proj/node_modules/x.js'))).toBeNull();
    expect(await parse(path.join(SSH_BASE, 'users', '..', 'x.txt'))).toBeNull();
  });

  it('アプリのソースや別プロジェクトは監視しないが、似た名前の利用者のフォルダは監視する', () => {
    const ignored = (p: string) => (service as any).isIgnoredWatchPath(p);
    expect(ignored(path.join(SSH_BASE, 'kawamonn-storage', 'x.ts'))).toBe(true);
    expect(ignored(path.join(SSH_BASE, 'kawamonn-labs'))).toBe(true);
    expect(ignored(path.join(SSH_BASE, '.git', 'HEAD'))).toBe(true);
    expect(ignored(path.join(home, 'kawamonn-storage-notes', 'a.txt'))).toBe(
      false,
    );
    expect(ignored(path.join(home, '.venv', 'bin'))).toBe(true);
    expect(ignored(SSH_BASE)).toBe(false);
  });
});

describe('isSyncableRelPath', () => {
  it.each(['a.txt', 'dir/a.txt', 'a..b/c'])('%j は対象', (p) => {
    expect(isSyncableRelPath(p)).toBe(true);
  });

  it.each([
    '.bashrc',
    'dir/.git/HEAD',
    'p/node_modules/x',
    '../x',
    'a/../b',
    '',
  ])('%j は対象外', (p) => {
    expect(isSyncableRelPath(p)).toBe(false);
  });
});
