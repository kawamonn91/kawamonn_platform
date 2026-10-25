import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// FileBrowserService reads SSH_BASE at module-load time, so it must be pointed
// at a disposable directory before any spec file's own imports run — a Jest
// setupFile is the only hook that runs early enough to do that (see
// filebrowser.service.spec.ts for why that suite needs a real filesystem
// instead of a mocked one). Harmless no-op for every other spec.
process.env.SSH_BASE = fs.mkdtempSync(
  path.join(os.tmpdir(), 'kawamonn-ssh-base-'),
);

// 確認コードの HMAC などが JWT_SECRET を使う。ユニットテストでは使い捨ての値を入れておく
process.env.JWT_SECRET ??= 'unit-test-only-throwaway-secret-0000';
