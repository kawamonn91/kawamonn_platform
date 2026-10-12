# Kawamonn

[![CI](https://github.com/kawamonn91/kawamonn_platform/actions/workflows/ci.yml/badge.svg)](https://github.com/kawamonn91/kawamonn_platform/actions/workflows/ci.yml)
[![公開サービスの死活監視](https://github.com/kawamonn91/kawamonn_platform/actions/workflows/uptime.yml/badge.svg)](https://github.com/kawamonn91/kawamonn_platform/actions/workflows/uptime.yml)

会津大学の学生向けに、Raspberry Pi 5 で自宅運用しているオンラインストレージ + ブラウザ SSH 端末サービスです。
新規登録には `@u-aizu.ac.jp` のメールアドレスでのワンタイムコード認証が必要です。

公開 URL: https://storage.kawamonn.com

## 構成

| ディレクトリ | 内容 |
| --- | --- |
| `kawamonn-storage/kawamonn-storage-backend` | API サーバー(NestJS 11 / Prisma / BullMQ / MinIO / dockerode) |
| `kawamonn-storage/kawamonn-storage-frontend` | 画面(React 19 / Vite / Mantine / xterm.js、Capacitor で Android 版も作成) |
| `kawamonn-storage/infrastructure` | 本番用 Docker Compose(PostgreSQL / Redis / MinIO / Cloudflare Tunnel)、SSH 環境のイメージ |
| `kawamonn-storage/monitoring` | 5分ごとに動くヘルスチェック(異常時はアプリを再起動し、運営者にメール通知) |
| `.github/workflows` | CI と死活監視 |

本番では backend と frontend を PM2 で動かし、外部への公開は Cloudflare Tunnel だけで行っています(ポート開放なし)。
ブラウザの SSH 端末は、利用者ごとに作るリソース制限付きの Docker コンテナに `docker exec` で接続します。

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
  - backend: lint・ユニットテスト・e2e テスト(使い捨ての PostgreSQL / Redis / MinIO を起動)・ビルド
  - frontend: lint・テスト・ビルド
  - infra: シェルスクリプトの ShellCheck、Docker Compose ファイルの検証
- **死活監視**(`.github/workflows/uptime.yml`): 30分ごとに GitHub 側から Cloudflare API で
  トンネルの接続状態を確認し、停止していれば失敗としてメールで通知します。サーバー内のヘルスチェックが
  動けない障害(本体や回線の停止)を検知するためのものです。公開 URL を直接取得する方式は、
  Cloudflare のボット対策で GitHub からのアクセスが遮断されるため使っていません。
  使うには、リポジトリの Secrets に `CF_API_TOKEN`(Cloudflare Tunnel の読み取り権限だけを持つトークン)、
  `CF_ACCOUNT_ID`、`CF_TUNNEL_ID` を登録します(未登録の間は何もせずに終わります)。
  公開リポジトリでは 60 日間更新が無いとスケジュール実行が自動で止まるので、その場合は Actions の画面から再有効化してください。
