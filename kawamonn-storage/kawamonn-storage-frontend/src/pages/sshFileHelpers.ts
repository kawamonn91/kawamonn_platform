// Pure helpers extracted out of SshDashboard.tsx so they can be unit-tested
// without pulling in xterm.js/socket.io-client/pdfjs-dist and their
// browser-only side effects (canvas, workers, etc.), none of which this
// logic depends on.

export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

interface RetryableError {
    response?: { status: number };
}

export const fetchWithRetry = async <T,>(fn: () => Promise<T>, retries = 3, delayMs = 1500): Promise<T> => {
    try {
        return await fn();
    } catch (e) {
        const err = e as RetryableError;
        // 400系エラー(404など)はリトライしない
        if (retries <= 0 || (err.response && err.response.status >= 400 && err.response.status < 500 && err.response.status !== 429)) {
            throw e;
        }
        await new Promise(r => setTimeout(r, delayMs));
        return fetchWithRetry(fn, retries - 1, delayMs * 1.5);
    }
};

// テキストファイルとして編集可能な拡張子
export const EDITABLE_EXTS = new Set(['.txt', '.md', '.sh', '.py', '.js', '.ts', '.json', '.yaml', '.yml',
    '.toml', '.ini', '.conf', '.cfg', '.env', '.csv', '.xml', '.html', '.css', '.c', '.cpp',
    '.java', '.go', '.rs', '.rb', '.pl', '.sql', '.tf', '']);

export const isEditable = (name: string) => {
    const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
    return EDITABLE_EXTS.has(ext);
};
