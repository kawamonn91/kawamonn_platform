import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { setupApp } from '../src/app-setup';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { FileBrowserModule } from '../src/filebrowser/filebrowser.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * ストレージ(利用者フォルダ)の API を、本物の DB と本物のファイルシステムで確かめる。
 * ファイルは HDD の利用者フォルダだけに置く方式なので、MinIO は使わない。
 * 利用者フォルダの置き場所(SSH_BASE)は test/setup-e2e.ts が一時フォルダにしている。
 */
describe('Storage (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: string;
  let home: string;
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), 'storage-e2e-outside-'),
  );

  const api = () => request(app.getHttpServer());
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule, AuthModule, FileBrowserModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    setupApp(app);
    await app.init();

    prisma = moduleRef.get(PrismaService);
    const account_name = `storage${Date.now().toString(36)}`;
    const user = await prisma.user.create({
      data: {
        email: `${account_name}@u-aizu.ac.jp`,
        account_name,
        password_hash: 'irrelevant-for-this-suite',
        role: 'user',
        quota_bytes: BigInt(1024 * 1024),
      },
    });
    userId = user.id;
    home = path.join(process.env.SSH_BASE as string, 'users', account_name);
    token = moduleRef.get(JwtService).sign({
      sub: user.id,
      account_name,
      role: 'user',
    });
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET');
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    await app.close();
  });

  const usedBytes = async () =>
    Number(
      (await prisma.user.findUnique({ where: { id: userId } }))!.used_bytes,
    );

  it('アップロードしたファイルが HDD の利用者フォルダに置かれ、一覧と読み込みができ、使用量が増える', async () => {
    await auth(api().post('/api/v1/filebrowser/mkdir'))
      .send({ path: '/docs' })
      .expect(201);
    await auth(api().post('/api/v1/filebrowser/upload?path=/docs'))
      .attach('file', Buffer.from('hello world'), 'hello.txt')
      .expect(201);

    expect(fs.readFileSync(path.join(home, 'docs', 'hello.txt'), 'utf8')).toBe(
      'hello world',
    );

    const ls = await auth(
      api().get('/api/v1/filebrowser/ls?path=/docs'),
    ).expect(200);
    expect(ls.body.entries).toEqual([
      expect.objectContaining({
        name: 'hello.txt',
        path: '/docs/hello.txt',
        isDir: false,
        size: 11,
        mime: 'text/plain',
      }),
    ]);

    const read = await auth(
      api().get('/api/v1/filebrowser/read?path=/docs/hello.txt'),
    ).expect(200);
    expect(read.text).toBe('hello world');
    expect(await usedBytes()).toBe(11);
  });

  it('端末から置いたファイル(backend を通らないもの)も、そのまま一覧に出る', async () => {
    fs.writeFileSync(path.join(home, 'from-terminal.c'), 'int main(){}');
    const ls = await auth(api().get('/api/v1/filebrowser/ls?path=/')).expect(
      200,
    );
    expect(ls.body.entries.map((e: any) => e.name)).toContain(
      'from-terminal.c',
    );
  });

  it('テキストを書いて名前を変え、フォルダごと消すと使用量が減る', async () => {
    await auth(api().put('/api/v1/filebrowser/write-text'))
      .send({ path: '/notes/a.md', content: '# memo' })
      .expect(200);
    await auth(api().patch('/api/v1/filebrowser/rename'))
      .send({ oldPath: '/notes', newPath: '/memo' })
      .expect(200);
    expect(fs.existsSync(path.join(home, 'memo', 'a.md'))).toBe(true);

    const before = await usedBytes();
    await auth(api().delete('/api/v1/filebrowser/delete?path=/memo')).expect(
      200,
    );
    expect(fs.existsSync(path.join(home, 'memo'))).toBe(false);
    expect(await usedBytes()).toBe(before - '# memo'.length);
  });

  it('容量の上限を超える保存は 413 で断る', async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { quota_bytes: BigInt(20) },
    });
    try {
      const res = await auth(api().post('/api/v1/filebrowser/upload?path=/'))
        .attach('file', Buffer.alloc(64, 'x'), 'big.bin')
        .expect(413);
      // 画面はこのメッセージで「容量の上限」と「大きすぎる」を見分ける
      expect(res.body.message).toBe('Storage quota exceeded');
      expect(fs.existsSync(path.join(home, 'big.bin'))).toBe(false);
    } finally {
      await prisma.user.update({
        where: { id: userId },
        data: { quota_bytes: BigInt(1024 * 1024) },
      });
    }
  });

  it('エディタからは 100KB を超えるテキストも保存でき、10MB を超える本文は大きすぎるとして断る', async () => {
    // express の既定の上限(100KB)のままだと、少し長いファイルも保存できなかった
    const text = 'あいうえお\n'.repeat(20000); // 約 320KB
    await auth(api().put('/api/v1/filebrowser/write-text'))
      .send({ path: '/long.txt', content: text })
      .expect(200);
    expect(fs.readFileSync(path.join(home, 'long.txt'), 'utf8')).toBe(text);

    const res = await auth(api().put('/api/v1/filebrowser/write-text'))
      .send({ path: '/huge.txt', content: 'x'.repeat(11 * 1024 * 1024) })
      .expect(413);
    expect(res.body.message).not.toBe('Storage quota exceeded');
    expect(fs.existsSync(path.join(home, 'huge.txt'))).toBe(false);

    await auth(
      api().delete('/api/v1/filebrowser/delete?path=/long.txt'),
    ).expect(200);
  });

  it('利用者フォルダの外には出られない', async () => {
    await auth(
      api().get('/api/v1/filebrowser/read?path=/../../../etc/hostname'),
    ).expect(403);
    // アップロードのファイル名に付いたパスは受け取る側(busboy)が取り除き、名前だけが使われる
    await auth(api().post('/api/v1/filebrowser/upload?path=/'))
      .attach('file', Buffer.from('x'), '../../evil.txt')
      .expect(201);
    expect(fs.existsSync(path.join(home, 'evil.txt'))).toBe(true);
    expect(fs.existsSync(path.join(home, '..', '..', 'evil.txt'))).toBe(false);
    // 保存先のフォルダの指定に .. があれば断る
    await auth(api().post('/api/v1/filebrowser/upload?path=/../..'))
      .attach('file', Buffer.from('x'), 'evil2.txt')
      .expect(403);
    expect(fs.existsSync(path.join(home, '..', '..', 'evil2.txt'))).toBe(false);

    fs.symlinkSync(outside, path.join(home, 'link'));
    await auth(
      api().get('/api/v1/filebrowser/read?path=/link/secret.txt'),
    ).expect(403);
    await auth(api().put('/api/v1/filebrowser/write-text'))
      .send({ path: '/link/planted.txt', content: 'x' })
      .expect(403);
    expect(fs.readdirSync(outside)).toEqual(['secret.txt']);
  });

  it('トークンが無ければ 401', async () => {
    await api().get('/api/v1/filebrowser/ls?path=/').expect(401);
  });
});
