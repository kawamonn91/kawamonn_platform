// 学習のサイト（labs.kawamonn.com）の画面に埋め込む端末（/embed/terminal）と、埋め込んだ側との
// やり取り（window.postMessage）。埋め込めるサイトは nginx の frame-ancestors でも絞っている。

// 埋め込んでよいサイト。手元で試すときは VITE_TERMINAL_EMBED_PARENTS に、カンマ区切りで足す
export function embedParentOrigins(value: string | undefined = import.meta.env.VITE_TERMINAL_EMBED_PARENTS): string[] {
    const list = (value ?? 'https://labs.kawamonn.com')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return list.length ? list : ['https://labs.kawamonn.com'];
}

export type EmbedState = 'login-required' | 'idle' | 'starting' | 'connected' | 'disconnecting' | 'error';

// 埋め込んだ側から届く指示
export type HostMessage =
    | { source: 'ttech-terminal-host'; type: 'paste'; text: string }
    | { source: 'ttech-terminal-host'; type: 'connect' }
    | { source: 'ttech-terminal-host'; type: 'focus' };

export function parseHostMessage(data: unknown): HostMessage | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    if (d.source !== 'ttech-terminal-host') return null;
    if (d.type === 'paste' && typeof d.text === 'string') return { source: d.source, type: 'paste', text: d.text };
    if (d.type === 'connect' || d.type === 'focus') return { source: d.source, type: d.type };
    return null;
}

export const MAX_PASTE_LENGTH = 20000;

// 貼る文字から、端末を操作できてしまう制御文字（ESC など）を取り除く。改行とタブは残す。
// 末尾の改行は落とす（貼っただけで実行されないように）
export function sanitizePaste(text: string): string {
    return text
        .slice(0, MAX_PASTE_LENGTH)
        .replace(/\r\n?/g, '\n')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
        .replace(/\s+$/, '');
}

// 埋め込んだ側へ状態を知らせる（許したサイトにだけ届く）
export function postStateToParent(state: EmbedState, origins: string[] = embedParentOrigins()) {
    if (typeof window === 'undefined' || window.parent === window) return;
    for (const origin of origins) {
        window.parent.postMessage({ source: 'ttech-terminal', type: 'state', state }, origin);
    }
}
