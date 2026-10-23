/**
 * サイトの公開URL。未設定時は本番URL(https://storage.kawamonn.com)をデフォルトとする。
 */
export function getPublicUrl(): string {
  return (process.env.PUBLIC_URL || 'https://storage.kawamonn.com').replace(/\/+$/, '');
}
