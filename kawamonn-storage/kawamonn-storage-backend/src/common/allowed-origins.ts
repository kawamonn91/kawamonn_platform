/**
 * CORS で許す画面の置き場所(HTTP の setupApp と端末の WebSocket で共通)。
 * 本番の画面は storage.kawamonn.com で、API は同じ場所(vite preview の転送)から呼ぶ。
 * localhost は手元で動かすとき(vite の開発サーバー 5173・preview 8080)。
 * (以前あった account.kawamonn.com・web.kawamonn.com は、もう使っていないので外した)
 */
export const ALLOWED_ORIGINS = [
  'https://storage.kawamonn.com',
  'http://localhost:5173',
  'http://localhost:8080',
];
