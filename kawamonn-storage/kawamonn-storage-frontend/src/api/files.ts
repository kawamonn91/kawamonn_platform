/**
 * ファイルの扱いで、ストレージ画面と SSH 画面のファイルブラウザが共通に使うもの
 */

export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

interface RetryableError {
    response?: { status: number };
}

/** 失敗したら少し待ってやり直す(4xx は 429 を除いてやり直さない) */
export const fetchWithRetry = async <T,>(fn: () => Promise<T>, retries = 3, delayMs = 1500): Promise<T> => {
    try {
        return await fn();
    } catch (e) {
        const err = e as RetryableError;
        if (retries <= 0 || (err.response && err.response.status >= 400 && err.response.status < 500 && err.response.status !== 429)) {
            throw e;
        }
        await new Promise(r => setTimeout(r, delayMs));
        return fetchWithRetry(fn, retries - 1, delayMs * 1.5);
    }
};

// テキストとして編集できる拡張子(拡張子なしの Makefile などを含む)
const EDITABLE_EXTS = new Set(['.txt', '.md', '.sh', '.py', '.js', '.ts', '.tsx', '.jsx', '.json', '.yaml', '.yml',
    '.toml', '.ini', '.conf', '.cfg', '.env', '.csv', '.xml', '.html', '.css', '.c', '.h', '.cpp', '.hpp',
    '.java', '.cs', '.go', '.rs', '.rb', '.pl', '.sql', '.tf', '.tex', '.bib', '.log', '']);
const EDITABLE_MIMES = new Set(['application/json', 'application/javascript', 'application/typescript',
    'application/xml', 'application/x-sh']);

/** エディタで開けるファイルか(拡張子か MIME タイプで決める) */
export function isEditableFile(name: string, mime = ''): boolean {
    if (mime.startsWith('text/') || EDITABLE_MIMES.has(mime)) return true;
    const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
    return EDITABLE_EXTS.has(ext);
}

/** 画面の中で見られるファイルか(画像と PDF) */
export function isPreviewable(mime: string): boolean {
    return mime.startsWith('image/') || mime === 'application/pdf';
}

/** 読み込んだ中身をファイルとして保存させる */
export function saveBytesAs(name: string, data: ArrayBuffer, mime = 'application/octet-stream'): void {
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // すぐに無効にすると、ブラウザによっては保存が始まる前に消えてしまう
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
