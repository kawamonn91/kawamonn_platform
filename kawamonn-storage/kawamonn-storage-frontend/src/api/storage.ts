import api, { getErrorMessage } from './client';

/**
 * 利用者フォルダ(HDD)のファイルを扱う API(/api/v1/filebrowser)の呼び出し。
 * ストレージ画面と SSH 画面のファイルブラウザが同じフォルダを見る。
 * ファイルやフォルダはパス("/docs/a.txt" の形)で指す。利用者フォルダの一番上は "/"。
 */

/** API が返す1件分 */
export interface StorageEntry {
    name: string;
    path: string;
    isDir: boolean;
    size: number;
    mtime: string;
    mime: string;
}

/** ストレージ画面で使う形。id はパス、parent_id は親フォルダのパス(一番上は null) */
export interface FileItem {
    id: string;
    name: string;
    size: string;
    mime_type: string;
    created_at: string;
    parent_id: string | null;
}

/** フォルダ(null は一番上)の中の name のパス */
export function joinPath(dir: string | null, name: string): string {
    const base = !dir || dir === '/' ? '' : dir.replace(/\/+$/, '');
    return `${base}/${name}`;
}

/** パスの親フォルダ(一番上なら null) */
export function parentOf(path: string): string | null {
    const i = path.replace(/\/+$/, '').lastIndexOf('/');
    return i <= 0 ? null : path.slice(0, i);
}

/**
 * ファイル名・フォルダ名として使えるか(backend の検査と同じ規則)。
 * "/" "\" を含む名前、"." "..", 空の名前、255 バイトを超える名前は使えない。
 */
export function isValidName(name: string): boolean {
    if (!name || name === '.' || name === '..') return false;
    if (/[/\\\0]/.test(name)) return false;
    return new TextEncoder().encode(name).length <= 255;
}

export function toFileItem(e: StorageEntry): FileItem {
    return {
        id: e.path,
        name: e.name,
        size: String(e.size),
        mime_type: e.isDir ? 'directory' : e.mime || 'application/octet-stream',
        created_at: e.mtime,
        parent_id: parentOf(e.path),
    };
}

export const QUOTA_MESSAGE = 'ストレージの容量の上限を超えるため、保存できませんでした。';
export const TOO_LARGE_MESSAGE =
    'ファイルが大きすぎるため、保存できませんでした(アップロードは 100MB、エディタでの保存は 10MB まで)。';

function rejection(err: unknown): { status?: number; message?: string } {
    const res = (err as { response?: { status?: number; data?: { message?: string } } })?.response;
    return { status: res?.status, message: res?.data?.message };
}

/** 容量の上限(quota)を超えて断られたか。413 は大きすぎる本文でも返るので、メッセージで見分ける */
export function isQuotaExceeded(err: unknown): boolean {
    const { status, message } = rejection(err);
    return status === 413 && message === 'Storage quota exceeded';
}

/** 保存(アップロード・エディタ・新規作成)に失敗したときに画面に出す文 */
export function saveErrorMessage(err: unknown, fallback: string): string {
    if (isQuotaExceeded(err)) return QUOTA_MESSAGE;
    if (rejection(err).status === 413) return TOO_LARGE_MESSAGE;
    return getErrorMessage(err, fallback);
}

/** フォルダ(null は一番上)の中身を、API が返す形のまま */
export async function listEntries(dir: string | null): Promise<StorageEntry[]> {
    const res = await api.get('/api/v1/filebrowser/ls', { params: { path: dir ?? '/' } });
    return (res.data?.entries ?? []) as StorageEntry[];
}

/** フォルダ(null は一番上)の中身を、ストレージ画面の形で */
export async function listFolder(dir: string | null): Promise<FileItem[]> {
    return (await listEntries(dir)).map(toFileItem);
}

export async function readFileBytes(path: string): Promise<ArrayBuffer> {
    const res = await api.get('/api/v1/filebrowser/read', {
        params: { path },
        responseType: 'arraybuffer',
    });
    return res.data;
}

export async function readFileText(path: string): Promise<string> {
    const res = await api.get('/api/v1/filebrowser/read', {
        params: { path },
        responseType: 'text',
        transformResponse: [(data) => data],
    });
    return res.data;
}

/** テキストを書く(無ければ作り、あれば上書きする) */
export async function writeText(path: string, content: string): Promise<void> {
    await api.put('/api/v1/filebrowser/write-text', { path, content });
}

/** フォルダを作る(途中のフォルダも作る。すでにあれば失敗する) */
export async function makeFolder(path: string): Promise<void> {
    await api.post('/api/v1/filebrowser/mkdir', { path });
}

/** dir(null は一番上)にファイルを置く。同じ名前があれば上書きし、途中のフォルダは作る */
export async function uploadFile(dir: string | null, file: File): Promise<void> {
    const formData = new FormData();
    formData.append('file', file);
    await api.post('/api/v1/filebrowser/upload', formData, {
        params: { path: dir ?? '/' },
        headers: { 'Content-Type': 'multipart/form-data' },
    });
}

/** 名前を変える・移す(移し先がすでにあれば失敗する) */
export async function renameEntry(oldPath: string, newPath: string): Promise<void> {
    await api.patch('/api/v1/filebrowser/rename', { oldPath, newPath });
}

/** ファイルかフォルダ(中身ごと)を消す */
export async function deleteEntry(path: string): Promise<void> {
    await api.delete('/api/v1/filebrowser/delete', { params: { path } });
}
