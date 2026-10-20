# kawamonn-storage — Claude Code 作業メモ

このファイルは `kawamonn-storage/` 配下で作業するときに Claude Code が毎回自動で読む。
会話の中でここに書くべき新しい情報(方針の確定、構成の変化、ハマりどころ)が分かったら、
確認を取らずに更新してよい。更新したら返答の最後に「CLAUDE.md の◯◯を更新しました」と1行で伝える。

**このリポジトリは公開されている。** IP アドレス、トンネルなどの ID、認証情報、未対策の弱点、
NAS やディスク構成などの内部情報はここに書かない。そうした Pi 固有の運用情報は、
リポジトリの外の `/home/pi/.claude/CLAUDE.md`(Pi 上のどの作業でも読まれる)に書く。

## 1. 概要

- **Kawamonn**: Raspberry Pi 5で自宅運用しているオンラインストレージ + ブラウザSSH端末サービス。
  会津大学の学生向け(`@u-aizu.ac.jp` メールでのOTP認証が新規登録の必須条件)。
- リポジトリのgit root(`/home/pi/hdd/ssh/`)は、本番の実データディレクトリ(`users/`, `kawamonn/` 等)
  とも**同じ場所**。プロジェクトのコードは `kawamonn-storage/` 配下にある。
- 同じPi上に**無関係な別プロジェクト**(`kawamonn-labs/`)や、ほかのサービスもある。
  `git status` で見覚えのない変更が出た場合、自分が触っていないファイルの可能性が高い。
  必ず `git diff` で確認し、無関係なら `git add` に含めない。

## 2. 技術スタック(2026年10月時点で動作確認済み)

- **Backend**: NestJS 11(2026年9月にv10/v11混在を解消済み)、TypeScript、Prisma(PostgreSQL)、
  Redis/BullMQ、dockerode、Passport/JWT、class-validator(MinIO は 2026-10 から利用者のファイルには使っていない。下記)
- **Frontend**: React 19 + Vite 5、Mantine UI、xterm.js、socket.io-client、axios、Capacitor(Android)
- **Node.js**: `24.21.0`(2026年9月に `18.20.8` からアップグレード済み。18は既にEOLだった)
- **テスト**: Jest(backend: unit 22 suites/139 tests + e2e 4 suites/14 tests)、
  Vitest(frontend: 3 files/23 tests)
- **CI**: GitHub Actions(`.github/workflows/ci.yml` — git root(`/home/pi/hdd/ssh/`)にあり、
  `kawamonn-storage/` 配下ではない)。`kawamonn-storage/` 以下が変わる push/PR 毎に backend・frontend・infra の
  3ジョブが走る。lint は backend・frontend とも実gate(0件維持)で、backend は `npm run lint:check`(自動修正なし)で判定する。
  infra ジョブはシェルスクリプトの ShellCheck(`-S warning`)と Docker Compose ファイルの検証。
  依存は `npm ci` で入れるので、`package.json` を変えたら `package-lock.json` も必ず一緒にコミットする
- **死活監視**: Pi 本体や回線の停止は、Cloudflare の通知機能(トンネルの状態の変化をメールで通知)で検知する。
  **GitHub Actions から公開 URL を取得する方式は使えない**(Cloudflare のボット対策がデータセンターの IP を 403 で
  遮断し、Pi まで届かない。2026-10-12 に確認)。そのため一度作った uptime.yml は削除した
- **デプロイ**: PM2(`kawamonn-storage/ecosystem.config.js`)、Docker Compose(Postgres/Redis/MinIO/cloudflared)、
  Cloudflare Tunnel(ポート開放なし)

## 3. 確定済みの方針(蒸し返さない)

- **バックアップ**: 新しいHDDが手に入るまで対応しない(意図的な保留。ユーザーの明示的な決定)
- **localStorage→httpOnly cookie移行**: 認証フロー全体(ログイン・SSH端末のWebSocket認証・CORS/CSRF)
  に影響する大きな変更のため保留中。「テストが無いまま根幹を変えるのは危険」という判断で、
  先にテスト/CI基盤を整備した(完了済み)。移行自体にはまだ着手していない — 次にやる予定の作業として認識しておく
- **管理者ログインのOTP**は常に運営者のメールアドレス固定(ユーザー自身の指示。per-admin送信ではない)
- **Nest v10/v11混在**は解消済み(v11系に統一、Node.js 24へのアップグレード込み)
- **フロントエンドの既存lint issue**(約45件)は解消済み。lintはCIの実gateとして機能中
- **バックエンドのESLint**は 2026-10-12 に既存debt(約3,000件。ほぼ Prettier の整形で、残りは未使用の変数や import)を
  解消し、CIの実gateにした

## 4. やり取りのルール

- 返答は日本語で書く
- git commitメッセージ・PR本文も日本語で書く(末尾の Co-Authored-By は Claude Code が付けるものをそのまま使い、
  モデル名を固定で書かない)
- **本番(稼働中のPM2プロセス・Docker・Cloudflare設定)に影響する操作は、実行前に必ず確認を取る。**
  過去にCloudflareトンネルトークンの操作で無断で本番に影響を与えてしまった経緯があるため、特に注意する
- `kawamonn-storage/infrastructure/cloudflared/config.yml` はユーザー自身が直接編集することがある。
  `git status` で見覚えのない変更が出たら、自分のものでなければ除外してstageする
- `kawamonn-labs/` ディレクトリ(git root直下)は無関係な別プロジェクト。触れない
- Auto Mode配下では、`pm2 stop/restart`・`docker --privileged` 等の本番/権限系操作が
  安全機能でブロックされることがある。ブロックされたら回避策を探さず、ユーザーに実行してもらうか
  許可を求める

## 5. 既知の制約・過去にハマった点

- **`SSH_BASE`**(`src/common/user-home.ts` の `sshBase()`)は本番では `/home/pi/hdd/ssh`
  (環境変数 `SSH_BASE` で上書き可能)。ユニットテストは `src/jest-setup.ts`(Jestの`setupFiles`)、e2e は
  `test/setup-e2e.ts` で一時ディレクトリに差し替えている。この仕組みを壊さないこと(差し替えないと、Pi 上で
  テストを実行したときに本番の利用者フォルダを読み書きしてしまう)
- **利用者フォルダの中のファイル操作は、必ず `src/common/safe-fs.ts` の関数を使う。** パスの文字列をそのまま
  `fs` に渡さない。利用者は端末から自由にシンボリックリンクを作れるので、文字列のパスで読み書きすると、
  リンクをたどって利用者フォルダの外(backend の `.env` など)を読み書きしてしまう。`safe-fs` はフォルダを
  1段ずつ `O_NOFOLLOW` で開き、開いた fd を起点に次の名前だけを解決する(Linux 専用)。
  リンクは利用者フォルダの中を指していてもたどらず、Web の一覧にも出さない。失敗の理由は `SafeFsError` の `reason`
- **ファイル名・フォルダ名と利用者名は、どちらもパスになる。** ファイル名は `src/common/file-name.ts`
  (`/` `\` NUL・`.` `..`・255 バイト超を拒否)、利用者名は `src/common/account-name.ts`(先頭は英数字、
  2文字目以降は英数字と `_ . -`、32 文字まで)で検査する。名前を受け取る入口を増やしたら、必ずこれを通す
- **`.gitignore`のユーザーデータ除外パターンは必ずリポジトリルート限定(先頭に`/`)にする。**
  過去に `users/` のような無アンカーのパターンが、`kawamonn-storage-backend/src/users/` モジュール一式と
  Androidの `MainActivity.java` を誤って巻き込み、**一度もgitにコミットされていなかった**という実害があった
- **GitHub Actionsの `$GITHUB_ENV` はシェルのクォート除去を行わない。** `.env.test` の値はダブルクォートで
  囲まない(`DATABASE_URL=postgresql://...` のように生の値のまま)
- **MinIO 公式のビルド済みイメージは配布が終わった。** `minio/minio`(Docker Hub)も `quay.io/minio/minio` も
  新しく取得できない(2026-10-12 に CI の e2e が取得失敗で落ちて判明)。本番の `docker-compose.yml` も
  テスト用の `docker-compose.test.yml` も、Chainguard が MinIO のソースからビルドしている `cgr.dev/chainguard/minio:latest` を使う
  (エントリポイントは `/usr/bin/minio`)。**root ではなく UID 65532 で動くので、`minio_data` の所有者は 65532 にしておく**
  (所有者が違うと起動に失敗する)。初期化用の `minio-init` は、シェルのある `cgr.dev/chainguard/minio-client:latest-dev` を使う。
  `docker compose up` で既存イメージを使うときは `--pull never` を付けると、取り直しで失敗しない
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
- **PM2 は `ecosystem.config.js` を書き換えただけでは反映されない。** 設定を変えたら
  `pm2 delete <name> && pm2 start ecosystem.config.js --only <name> && pm2 save` で起動し直す
  (2026-10 まで、frontend が古い設定のまま Vite の開発サーバーで動き続けていた)
- **Docker を止めると backend は DB に繋がらず(Prisma P1001)PM2 が再起動する。** 起動し直せば自然に戻る。
  Docker の停止を伴う作業のあとは、`pm2 ls` と公開URLで復旧を確認する
- backend は DB に `localhost` で接続していて、実際には IPv6 の `::1` を使う。DB などのポートを
  ループバックに絞るときは `127.0.0.1` と `[::1]` の両方で公開する(片方だけだと繋がらなくなる)
- **本番の backend のビルド結果は `dist/src/main.js` に出る**(`start:prod` もこのパス)。本番のフォルダには git で管理していない
  `create-admin.ts`・`prisma.config.ts`・`test-email.ts` がルートにあり、それに合わせて出力先が1段深くなっている。
  これらが無い場所(git worktree や CI)でビルドすると `dist/main.js` に出るので、手元で起動するときは注意する
- **backend の `package.json` と `package-lock.json` は CRLF 改行。** node や npm で書き換えると LF になり、
  ファイル全体が差分になる。書き換えたら CRLF に戻してからコミットする(`src/` の .ts は LF)
- **typescript-eslint v8 で `no-var-requires` は `no-require-imports` に置き換わった。** 意図的な遅延 `require()` を
  lint から外すときは `// eslint-disable-next-line @typescript-eslint/no-require-imports` と書く
  (古いルール名のままだと無効化が効かない)
- **`dotenv` は本番の起動(`node -r dotenv/config dist/src/main`)に必要なので `dependencies` に置く。**
  アプリ自体は `.env` を読まないので、`devDependencies` に戻すと本番向けのインストールで起動しなくなる

## 6. 本番環境の構成

- ホスト名: `raspi1`(Raspberry Pi 5、aarch64、自宅・単一台)
- PM2: `kawamonn-backend`(NestJS、`npm run start:prod`、:3000)、
  `kawamonn-frontend`(ビルド済みの dist を `vite preview` で配信、:8080。`/api` と `/socket.io` は
  vite.config の proxy で backend へ転送)。frontend を更新したら `npm run build` してから起動し直す
- Docker: `kawamonn_db`(Postgres 15)、`kawamonn_redis`、`kawamonn_minio` は **ループバック
  (`127.0.0.1` と `::1`)だけで公開**し、LAN からは届かない。ほかに `kawamonn_cloudflared`、
  ユーザーごとの SSH コンテナ(`kawamonn-ssh-<user>`)
- **利用者のファイルは HDD の利用者フォルダ(一般の利用者は `/home/pi/hdd/ssh/users/<名前>`、管理者は
  `/home/pi/hdd/ssh/<名前>`)だけに置く**(2026-10-21 に一本化)。Web のストレージ画面も SSH 画面のファイルブラウザも
  `/api/v1/filebrowser`(パス指定)で同じフォルダを直接読み書きし、端末(SSH コンテナ)はそのフォルダをマウントしている。
  以前は MinIO + Postgres にも同じファイルを持って同期していたが(`SyncService`、`/files` API)、同じ HDD の上の二重持ちで
  食い違いの原因になっていたので廃止した。DB の `File` テーブルは使っていない(残してあるだけ)
- 容量の上限: `StorageUsageService` が利用者フォルダの実際の中身(隠しファイルを含む)を起動時と10分ごとに測って
  `User.used_bytes` に保存し、Web からの保存で上限(`quota_bytes`)を超えるなら 413 で断る。端末からの書き込みは制限しない
  (ext4 のプロジェクトクォータは HDD で有効になっていない)
- SSH コンテナの 22 番はループバック(`127.0.0.1`)にだけ公開する(`ssh.service.ts`)。ブラウザ端末も
  SSH ゲートウェイも `docker exec` で接続するので、LAN に公開する必要はない。この設定は新しく作るコンテナから効く
- **SSH コンテナのイメージ `kawamonn-ssh-base:latest` は `infrastructure/ssh-provisioning/` の Dockerfile と
  `entrypoint.sh` で作る。** 同じ目的の古い `infrastructure/docker/ssh-env/` は使われておらず、2026-10-12 に削除した
  (`ssh-provisioning/provision.sh` も podman を使っていた頃の古い手順で、今は使っていない)
- コンテナ内のユーザーは **UID/GID 70000**(`entrypoint.sh` の `USER_UID`)。ホームはホストのフォルダをそのまま
  つなぐので、この番号がホスト上のファイルの所有者になる。ホストの一般ユーザー(1000〜60000)、systemd の動的ユーザー
  (61184〜65519)、サブ UID(100000〜)と重ならない番号にしてある。以前は UID を指定せずに作っていたため 1001 になり、
  ホスト上では同じ UID を持つ別の利用者のアカウントの所有に見えていた。起動のたびにホームの所有者を付け直すので、
  古いホームも次に使ったときに 70000 になる。backend(pi)は各ホームの ACL(`user:pi:rwx`)でアクセスするので所有者に依存しない
- イメージは texlive-full などを含み約 6.5GB あって、作り直すと回線への負荷が大きい。`entrypoint.sh` だけを変えたときは、
  既存のイメージの上に差し替えの層を重ねて作り直す:
  `cd infrastructure/ssh-provisioning && printf 'FROM kawamonn-ssh-base:latest\nCOPY entrypoint.sh /usr/local/bin/entrypoint.sh\nRUN chmod +x /usr/local/bin/entrypoint.sh\n' | docker build -t kawamonn-ssh-base:latest -f - .`
  (変わるのは新しく作るコンテナから。既存のコンテナを作り直すと、ホーム以外の場所に入れたものは消える)
- 期限切れで削除(`status=deleted`)になったユーザーは、行が DB に残っていても、ログイン(`validateUser`。パスワード照合後に
  照合失敗と同じエラーで拒否)・HTTP の認証(`JwtStrategy`)・ブラウザ端末(`terminal.gateway.ts`)のすべてで拒否する
- MinIO(`kawamonn_minio`)は compose に残っていて動いているが、利用者のファイルには使っていない(2026-10-21 以降)。
  バケットには匿名アクセスを許可しない(compose の `minio-init` で `mc anonymous set none`)
- Cloudflare Tunnel: `kawamonn_cloudflared` はトークン方式で動いていて、ルートは Cloudflare ダッシュボードで
  管理している(`storage.kawamonn.com` → frontend、`ssh.kawamonn.com` → SSH)。リポジトリの
  `infrastructure/cloudflared/config.yml` は稼働中のトンネルでは読まれていない
- モニタリング: `kawamonn-storage/monitoring/healthcheck.sh` が5分毎にcron実行。障害時はPM2再起動を
  試行し、最大1時間に1回まで運営者にメール通知(`monitoring/mailer.js`)。Pi 本体や回線が
  止まった場合は、Cloudflare の通知機能(トンネルの状態)でメールが届く
- 未実装・既知のギャップ(ユーザーに正直に伝えること): ファイル共有機能(DBスキーマのみ先行)、
  TOTP二段階認証(依存パッケージのみ、未使用)、BullMQのファイル処理ジョブ(スタブのみ)
