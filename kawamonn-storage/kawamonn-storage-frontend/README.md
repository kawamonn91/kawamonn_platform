# kawamonn-storage-frontend

Kawamonn の画面です(React 19 / Vite / Mantine / xterm.js / socket.io-client)。
Capacitor で Android 版も作成しています。リポジトリ全体の説明は [ルートの README](../../README.md) を参照してください。

## 主なコマンド

| コマンド | 内容 |
| --- | --- |
| `npm ci` | 依存パッケージを `package-lock.json` どおりに入れる |
| `npm run dev` | 開発サーバー |
| `npm run build` | `dist/` にビルド |
| `npm run preview` | ビルド済みの `dist/` を配信(本番は PM2 から実行) |
| `npm run lint` | ESLint |
| `npm test` | テスト(Vitest) |

本番では `/api` と `/socket.io` を、`vite.config.ts` のプロキシ設定で backend に転送しています。
frontend を変更したら `npm run build` してから、PM2 のプロセスを起動し直してください。
