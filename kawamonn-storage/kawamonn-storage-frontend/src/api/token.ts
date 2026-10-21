/** ログインのトークン(JWT)に書いてある内容のうち、画面で使うもの */
export interface TokenPayload {
    sub: string;
    account_name: string;
    role: string;
    exp?: number;
}

/**
 * トークンの中身を読む(署名は確かめない。確かめるのは backend)。読めなければ null。
 * 中身は base64url の UTF-8 なので、atob の結果をそのまま JSON にせず、バイト列として UTF-8 で読む
 */
export function decodeToken(token: string): TokenPayload | null {
    try {
        const part = token.split('.')[1];
        const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
        const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
        const payload = JSON.parse(new TextDecoder().decode(bytes));
        if (typeof payload?.sub !== 'string' || typeof payload?.account_name !== 'string') return null;
        return payload as TokenPayload;
    } catch {
        return null;
    }
}
