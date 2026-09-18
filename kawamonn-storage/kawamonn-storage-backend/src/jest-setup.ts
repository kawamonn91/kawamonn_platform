import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// FileBrowserService reads SSH_BASE at module-load time, so it must be pointed
// at a disposable directory before any spec file's own imports run — a Jest
// setupFile is the only hook that runs early enough to do that (see
// filebrowser.service.spec.ts for why that suite needs a real filesystem
// instead of a mocked one). Harmless no-op for every other spec.
process.env.SSH_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'kawamonn-ssh-base-'));
