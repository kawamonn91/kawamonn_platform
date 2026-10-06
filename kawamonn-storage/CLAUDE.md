# kawamonn-storage — Claude Code 作業メモ

このファイルは `kawamonn-storage/` 配下で作業するときに Claude Code が毎回自動で読む。
会話の中でここに書くべき新しい情報(方針の確定、構成の変化、ハマりどころ)が分かったら、
確認を取らずに更新してよい。更新したら返答の最後に「CLAUDE.md の◯◯を更新しました」と1行で伝える。

## 1. 概要

- **Kawamonn**: Raspberry Pi 5で自宅運用しているオンラインストレージ + ブラウザSSH端末サービス。
  会津大学の学生向け(`@u-aizu.ac.jp` メールでのOTP認証が新規登録の必須条件)。
- リポジトリのgit root(`/home/pi/hdd/ssh/`)は、本番の実データディレクトリ(`users/`, `kawamonn/` 等)
  とも**同じ場所**。プロジェクトのコードは `kawamonn-storage/` 配下にある。
- 同じPi上に**無関係な別プロジェクト**(`kawamonn-labs/`、`ttech-store` 等)も存在する。
  `git status` で見覚えのない変更が出た場合、自分が触っていないファイルの可能性が高い。
  必ず `git diff` で確認し、無関係なら `git add` に含めない。

## 2. 技術スタック(2026年10月時点で動作確認済み)

- **Backend**: NestJS 11(2026年9月にv10/v11混在を解消済み)、TypeScript、Prisma(PostgreSQL)、
  Redis/BullMQ、MinIO(S3互換)、dockerode、Passport/JWT、class-validator
- **Frontend**: React 19 + Vite 5、Mantine UI、xterm.js、socket.io-client、axios、Capacitor(Android)
- **Node.js**: `24.21.0`(2026年9月に `18.20.8` からアップグレード済み。18は既にEOLだった)
- **テスト**: Jest(backend: unit 20 suites/82 tests + e2e 4 suites/11 tests)、
  Vitest(frontend: 2 files/18 tests)
- **CI**: GitHub Actions(`/home/pi/hdd/ssh/.github/workflows/ci.yml` — git rootにあり、
  `kawamonn-storage/` 配下ではない)。push/PR毎にbackend/frontend各ジョブが走る。
  frontendのlintも実gate(`continue-on-error` なし、0件維持)
- **デプロイ**: PM2(`kawamonn-storage/ecosystem.config.js`)、Docker Compose(Postgres/Redis/MinIO/cloudflared)、
  Cloudflare Tunnel(ポート開放なし、自宅回線はSoftBank Air)

## 3. 確定済みの方針(蒸し返さない)

- **バックアップ**: 新しいHDDが手に入るまで対応しない(意図的な保留。ユーザーの明示的な決定)
- **localStorage→httpOnly cookie移行**: 認証フロー全体(ログイン・SSH端末のWebSocket認証・CORS/CSRF)
  に影響する大きな変更のため保留中。「テストが無いまま根幹を変えるのは危険」という判断で、
  先にテスト/CI基盤を整備した(完了済み)。移行自体にはまだ着手していない — 次にやる予定の作業として認識しておく
- **管理者ログインのOTP**は常に `kawamonn91@gmail.com` 固定(ユーザー自身の指示。per-admin送信ではない)
- **Nest v10/v11混在**は解消済み(v11系に統一、Node.js 24へのアップグレード込み)
- **フロントエンドの既存lint issue**(約45件)は解消済み。lintはCIの実gateとして機能中
- **バックエンドのESLint**はCIでまだ実gateにしていない(既存debtが残っている)

## 4. やり取りのルール

- 返答は日本語で書く
- git commitメッセージ・PR本文も日本語で書く(末尾に `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`)
- **本番(稼働中のPM2プロセス・Docker・Cloudflare設定)に影響する操作は、実行前に必ず確認を取る。**
  過去にCloudflareトンネルトークンの操作で無断で本番に影響を与えてしまった経緯があるため、特に注意する
- `kawamonn-storage/infrastructure/cloudflared/config.yml` はユーザー自身が直接編集することがある。
  `git status` で見覚えのない変更が出たら、自分のものでなければ除外してstageする
- `kawamonn-labs/` ディレクトリ(git root直下)は無関係な別プロジェクト。触れない
- Auto Mode配下では、`pm2 stop/restart`・`docker --privileged` 等の本番/権限系操作が
  安全機能でブロックされることがある。ブロックされたら回避策を探さず、ユーザーに実行してもらうか
  許可を求める

## 5. 既知の制約・過去にハマった点

- **`SSH_BASE`**(`src/filebrowser/filebrowser.service.ts`)は本番では `/home/pi/hdd/ssh` にハードコード
  (環境変数で上書き可能)。ユニットテストは `src/jest-setup.ts`(Jestの`setupFiles`)で一時ディレクトリに
  差し替えている。この仕組みを壊さないこと
- **`.gitignore`のユーザーデータ除外パターンは必ずリポジトリルート限定(先頭に`/`)にする。**
  過去に `users/` のような無アンカーのパターンが、`kawamonn-storage-backend/src/users/` モジュール一式と
  Androidの `MainActivity.java` を誤って巻き込み、**一度もgitにコミットされていなかった**という実害があった
- **GitHub Actionsの `$GITHUB_ENV` はシェルのクォート除去を行わない。** `.env.test` の値はダブルクォートで
  囲まない(`DATABASE_URL=postgresql://...` のように生の値のまま)
- **MinIOのDockerイメージ**は `minio/minio` ではなく `quay.io/minio/minio` を使う
  (Docker Hubの匿名pullが拒否されるようになったため、`docker-compose.test.yml` で変更済み)
- **ヘルスチェック**(`kawamonn-storage/monitoring/healthcheck.sh`、cron 5分毎)は、
  2026年10月の修正で「公開URLへの疎通確認(`site_ok`)だけが失敗した場合」も、アプリの再起動が
  必要な場合と同じ最大40秒のリトライ待機をしてから失敗確定するようになった。
  それ以前は再起動対象が無いケースだと待機が完全にスキップされ、一時的なCloudflare Tunnelの
  瞬断でも即座にアラートが飛んでいた
- **Express 5(Nest v11が内部で使用)はpath-to-regexpの構文が変わっている。** 旧来の
  `exclude: ['/api/(.*)']` のような無名正規表現グループは使えない。`app.module.ts` の
  `ServeStaticModule` は `'/api/{*splat}'` 構文に修正済み
- **既存の `プロジェクト説明資料.md` と `運用ガイド.md`(git root直下)は古く、不正確。**
  前者はTOTP二段階認証やファイル共有機能を「実装済み」と記載しているが、実際のコードには存在しない
  (スキーマだけ先行、あるいは依存パッケージのみ導入でコード未実装)。後者はNestJS移行前の
  Flask/Celeryベースの旧システム向けの手順(systemctl、Celery、Flower等)で、現在のPM2/BullMQ構成とは
  一致しない。**この2つは参照しないこと。** 代わりにこのファイルと、正確な技術解説として作成した
  Artifact(https://claude.ai/artifact/Sx4Bvy8ZU6qfyYBM3EAun3)を参照する

## 6. 本番環境の構成

- ホスト名: `raspi1`(Raspberry Pi 5、aarch64、自宅・単一台)
- PM2: `kawamonn-backend`(NestJS、:3000)、`kawamonn-frontend`(vite preview、:8080)
- Docker: `kawamonn_db`(Postgres 15、:5432)、`kawamonn_redis`(:6379)、
  `kawamonn_minio`(:9000/:9001)、`kawamonn_cloudflared`
- Cloudflare Tunnel: `storage.kawamonn.com` → `localhost:8080`、`ssh.kawamonn.com` → `ssh://localhost:22`
- モニタリング: `kawamonn-storage/monitoring/healthcheck.sh` が5分毎にcron実行。障害時はPM2再起動を
  試行し、最大1時間に1回まで `kawamonn91@gmail.com` にメール通知(`monitoring/mailer.js`)
- 未実装・既知のギャップ(ユーザーに正直に伝えること): ファイル共有機能(DBスキーマのみ先行)、
  TOTP二段階認証(依存パッケージのみ、未使用)、BullMQのファイル処理ジョブ(スタブのみ)
