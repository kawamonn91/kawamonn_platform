import { getPublicUrl } from './site-config';

/**
 * CORS で許す画面の置き場所(HTTP の setupApp と端末の WebSocket で共通)。
 * PUBLIC_URL の設定があればそこから読み、localhost/127.0.0.1 の開発用アドレスも含める。
 */
export const ALLOWED_ORIGINS = Array.from(
  new Set([
    getPublicUrl(),
    'https://storage.kawamonn.com',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:8080',
  ]),
);
