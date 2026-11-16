// ログインのあとに戻る先。このサイトの中のパスだけを受け付ける（//example.com のような外へのリンクは無視）
export function safeNext(value: string | null): string {
    if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
    return value;
}
