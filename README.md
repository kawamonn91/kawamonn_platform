# Kawamonn

[![CI](https://github.com/kawamonn91/kawamonn_platform/actions/workflows/ci.yml/badge.svg)](https://github.com/kawamonn91/kawamonn_platform/actions/workflows/ci.yml)

会津大学の学生向けに、Raspberry Pi 5 で自宅運用しているオンラインストレージ + ブラウザ SSH 端末サービスです。
新規登録には `@u-aizu.ac.jp` のメールアドレスでのワンタイムコード認証が必要です。

公開 URL: https://storage.kawamonn.com

## 構成

| ディレクトリ | 内容 |
| --- | --- |
| `kawamonn-storage/kawamonn-storage-backend` | API サーバー(NestJS 11 / Prisma / dockerode) |
| `kawamonn-storage/kawamonn-storage-frontend` | 画面(React 19 / Vite / Mantine / xterm.js、Capacitor で Android 版も作成) |
| `kawamonn-storage/infrastructure` | 本番用 Docker Compose(PostgreSQL / Redis / MinIO / Cloudflare Tunnel)、SSH 環境のイメージ |
| `kawamonn-storage/monitoring` | 5分ごとに動くヘルスチェック(異常時はアプリを再起動し、運営者にメール通知) |
| `.github/workflows` | CI |

本番では backend と frontend を PM2 で動かし、外部への公開は Cloudflare Tunnel だけで行っています(ポート開放なし)。
ブラウザの SSH 端末は、利用者ごとに作るリソース制限付きの Docker コンテナに `docker exec` で接続します。

利用者のファイルは、サーバーの HDD 上の利用者ごとのフォルダだけに置きます。Web のストレージ画面も、
端末(コンテナにそのフォルダをマウント)も、同じフォルダを直接読み書きするので、どちらから見ても同じ内容になります。

## 開発

Node.js は本番と同じ `24.21.0` を使います。

```bash
# backend
cd kawamonn-storage/kawamonn-storage-backend
npm ci
npm run lint:check   # ESLint + Prettier(自動修正なし)
npm test             # ユニットテスト
npm run test:e2e     # e2e テスト(先に docker-compose.test.yml で使い捨ての DB 等を起動する)
npm run build

# frontend
cd kawamonn-storage/kawamonn-storage-frontend
npm ci
npm run lint
npm test
npm run build
```

e2e テストの手順と注意点は [backend の README](kawamonn-storage/kawamonn-storage-backend/README.md) を参照してください。

## CI / 監視

- **CI**(`.github/workflows/ci.yml`): `kawamonn-storage/` 以下が変わる push / PR ごとに実行します。
  - backend: lint・ユニットテスト・e2e テスト(使い捨ての PostgreSQL / Redis を起動)・ビルド
  - frontend: lint・テスト・ビルド
  - infra: シェルスクリプトの ShellCheck、Docker Compose ファイルの検証
- **死活監視**: サーバー内のヘルスチェック(5分ごと)が、アプリの異常を検知して再起動とメール通知を行います。
  Pi 本体や回線が止まった場合は、Cloudflare の通知機能(トンネルの状態の変化をメールで知らせる)で検知します。
  GitHub Actions から公開 URL を確認する方式は、Cloudflare のボット対策で遮断されるため使っていません。
