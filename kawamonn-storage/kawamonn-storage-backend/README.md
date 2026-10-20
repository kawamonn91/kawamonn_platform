# kawamonn-storage-backend

Kawamonn の API サーバーです(NestJS 11 / TypeScript / Prisma / dockerode)。利用者のファイルは HDD の利用者フォルダに直接置きます。
リポジトリ全体の説明は [ルートの README](../../README.md) を参照してください。

## セットアップ

```bash
npm ci
```

設定は `.env` に書きます(git には入れません)。本番の起動コマンド `npm run start:prod` は
`node -r dotenv/config dist/src/main` で、起動時に `.env` を読み込みます。
`JWT_SECRET` が未設定または16文字未満だと起動しません。

## 主なコマンド

| コマンド | 内容 |
| --- | --- |
| `npm run start:dev` | 開発用(変更を監視して再起動) |
| `npm run build` | `dist/` にビルド |
| `npm run start:prod` | ビルド済みの `dist/` を起動(本番は PM2 から実行) |
| `npm run lint` | ESLint + Prettier(自動修正あり) |
| `npm run lint:check` | ESLint + Prettier(自動修正なし。CI はこちらで判定) |
| `npm test` | ユニットテスト |
| `npm run test:e2e` | e2e テスト |

## e2e テスト

e2e テストは本物の PostgreSQL と、一時フォルダ上の利用者フォルダを使います。`docker-compose.test.yml` で
本番とは別ポートの使い捨てコンテナを起動してから実行してください。

```bash
docker compose -f docker-compose.test.yml up -d
npx prisma db push --skip-generate   # .env.test の DATABASE_URL に対して実行
npm run test:e2e
docker compose -f docker-compose.test.yml down
```

`.env.test` は CI とローカルの使い捨て環境専用の値です。e2e テストはテーブルを空にするため、
`DATABASE_URL` がテスト用 DB(`kawamonn_test`、ポート 5433)を指していないと実行を拒否します。
