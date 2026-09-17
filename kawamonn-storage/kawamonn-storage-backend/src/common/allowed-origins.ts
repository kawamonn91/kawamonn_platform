/**
 * Single source of truth for CORS-allowed origins. Previously main.ts (HTTP) and
 * terminal.gateway.ts (WebSocket) each hardcoded their own list and had drifted
 * out of sync — e.g. only one of them allowed the local dev frontend port.
 */
export const ALLOWED_ORIGINS = [
    'https://storage.kawamonn.com',
    'https://account.kawamonn.com',
    'https://web.kawamonn.com',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://localhost:3000',
];
