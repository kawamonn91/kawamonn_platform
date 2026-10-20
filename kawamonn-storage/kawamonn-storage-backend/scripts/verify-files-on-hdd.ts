/**
 * 保存先を HDD の利用者フォルダだけにする切り替え(2026-10)の前に、DB(File テーブル)に記録されている
 * Web 側のファイルが、すべて HDD の利用者フォルダにもあるかを確かめる。
 *
 *   npx ts-node scripts/verify-files-on-hdd.ts            確かめるだけ(何も書かない)
 *   npx ts-node scripts/verify-files-on-hdd.ts --export   HDD に無いものを MinIO から書き出す
 *
 * 接続先は .env(DATABASE_URL、MINIO_*)。書き出しは common/safe-fs を使い、利用者フォルダの外には書かない。
 * 大きさが違うもの(端末側で後から編集されたなど)は HDD のほうを正とし、--export のときは
 * Web 側の版を「<名前> (Web版)<拡張子>」として隣に書き出して残す(上書きはしない)。
 * 終了コード: 0 = すべて HDD にある(または書き出して揃った)、1 = 揃っていない、2 = 実行時のエラー
 */
import { PrismaClient } from '@prisma/client';
import * as Minio from 'minio';
import * as fs from 'fs';
import * as path from 'path';
import {
  safeLstat,
  safeMkdir,
  safeWriteFile,
  splitRelPath,
} from '../src/common/safe-fs';
import { userHomePath } from '../src/common/user-home';

const exportMissing = process.argv.includes('--export');

async function readObject(
  minio: Minio.Client,
  bucket: string,
  key: string,
): Promise<Buffer> {
  const stream = await minio.getObject(bucket, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** 「a/b.txt」→「a/b (Web版).txt」。同じ名前があれば番号を付ける */
function webVersionPath(home: string, relPath: string): string {
  const ext = path.posix.extname(relPath);
  const base = relPath.slice(0, relPath.length - ext.length);
  for (let i = 1; ; i++) {
    const candidate = `${base} (Web版${i > 1 ? i : ''})${ext}`;
    if (!safeLstat(home, candidate)) return candidate;
  }
}

async function main() {
  const prisma = new PrismaClient();
  const minio = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || '127.0.0.1',
    port: parseInt(process.env.MINIO_PORT || '9000'),
    useSSL: false,
    accessKey: process.env.MINIO_ACCESS_KEY || '',
    secretKey: process.env.MINIO_SECRET_KEY || '',
  });
  const bucket = process.env.MINIO_BUCKET || 'storage-bucket';
  const counts = {
    ok: 0,
    exported: 0,
    webCopy: 0,
    missing: 0,
    mismatch: 0,
    unsafe: 0,
    dirs: 0,
  };

  try {
    const users = await prisma.user.findMany({
      select: { id: true, account_name: true, role: true },
    });
    for (const user of users) {
      const rows = await prisma.file.findMany({ where: { owner_id: user.id } });
      if (rows.length === 0) continue;
      const byId = new Map(rows.map((r) => [r.id, r]));
      const pathOf = (id: string): string | null => {
        const names: string[] = [];
        let cur = byId.get(id);
        for (let guard = 0; cur && guard < 100; guard++) {
          names.unshift(cur.name);
          cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
        }
        const rel = names.join('/');
        return splitRelPath(rel) ? rel : null;
      };

      let home: string;
      try {
        home = userHomePath(user.account_name, user.role === 'admin');
      } catch {
        console.log(
          `NG  ${user.account_name}: 利用者名がパスとして安全でないので確認できない(${rows.length} 件)`,
        );
        counts.unsafe += rows.length;
        continue;
      }
      if (exportMissing) fs.mkdirSync(home, { recursive: true });

      for (const row of rows) {
        const rel = pathOf(row.id);
        const label = `${user.account_name}/${rel ?? row.name}`;
        if (!rel) {
          console.log(`NG  ${label}: 名前がパスとして安全でない`);
          counts.unsafe++;
          continue;
        }
        const st = fs.existsSync(home) ? safeLstat(home, rel) : null;

        if (row.mime_type === 'directory') {
          counts.dirs++;
          // 中身が無いフォルダも残す(中にファイルがあれば、書き出すときにも作られる)
          if (!st && exportMissing) safeMkdir(home, rel);
          continue;
        }
        if (!row.storage_key) continue;

        if (st?.type === 'file' && BigInt(st.size) === BigInt(row.size)) {
          counts.ok++;
          continue;
        }
        if (st && st.type !== 'file') {
          console.log(
            `NG  ${label}: HDD では普通のファイルではない(${st.type})`,
          );
          counts.mismatch++;
          continue;
        }
        if (!st) {
          if (exportMissing) {
            safeWriteFile(
              home,
              rel,
              await readObject(minio, bucket, row.storage_key),
            );
            console.log(`書き出し  ${label}`);
            counts.exported++;
          } else {
            console.log(`無い  ${label}(${row.size} バイト)`);
            counts.missing++;
          }
          continue;
        }
        // 大きさが違う: HDD のほうを正とし、Web 側の版は別名で残す
        if (exportMissing) {
          const copy = webVersionPath(home, rel);
          safeWriteFile(
            home,
            copy,
            await readObject(minio, bucket, row.storage_key),
          );
          console.log(
            `別名で書き出し  ${user.account_name}/${copy}(HDD ${st.size} / Web ${row.size} バイト)`,
          );
          counts.webCopy++;
        } else {
          console.log(
            `大きさが違う  ${label}(HDD ${st.size} / Web ${row.size} バイト)`,
          );
          counts.mismatch++;
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(
    `\n結果: 一致 ${counts.ok} 件、書き出し ${counts.exported} 件、Web版を別名で書き出し ${counts.webCopy} 件、` +
      `HDD に無い ${counts.missing} 件、大きさが違う ${counts.mismatch} 件、名前が安全でない ${counts.unsafe} 件` +
      `(フォルダ ${counts.dirs} 件)`,
  );
  process.exit(counts.missing + counts.mismatch + counts.unsafe === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`エラー: ${e.message}`);
  process.exit(2);
});
