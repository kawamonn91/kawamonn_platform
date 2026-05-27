# Kawamonn プラットフォーム デプロイ手順書

## 前提条件
- Raspberry Pi OS (64-bit 推奨) (現在は 32-bit の可能性あり、その場合は venv で対応)
- HDD が `/home/pi/hdd` にマウントされていること (ext4 フォーマット)
- Python 3.9+
- Redis Server
- Cloudflared

## 1. システムセットアップ
依存関係のインストールとプロジェクトクォータの設定を行うセットアップスクリプトを実行します。
```bash
sudo ./scripts/setup_system.sh
```
**注意:** このスクリプトは `/dev/sda1` で `project` クォータ機能の有効化を試みます。ドライブがマウントされているために失敗する場合は、オフラインで手動有効化を行うか、`tune2fs` 設定後に再起動が必要になる場合があります。

## 2. 設定 (Configuration)
`.env.example` を `.env` にコピーし、詳細を入力します:
```bash
cp .env.example .env
nano .env
```
`MAILGUN_API_KEY` と `CLOUDFLARE_API_TOKEN` が設定されていることを確認してください。

## 3. データベース初期化
SQLite データベースを初期化します:
```bash
python3 scripts/init_db.py
```
(venv 環境下で実行してください: `venv/bin/python3 scripts/init_db.py`)

## 4. アプリケーション依存関係のインストール
提供されているスクリプトを使用して仮想環境をセットアップし、依存関係をインストールします:
```bash
./scripts/setup_dev_env.sh
```
これにより、システムの Python 環境に影響を与えることなく、すべてのパッケージが正しくインストールされます。

## 5. 管理者ユーザーの作成 (2FA 用)
管理者サイト (`admin.kawamonn.com`) にアクセスするための管理者ユーザー (`kawamonn`) を作成します。
```bash
./venv/bin/python3 scripts/create_admin.py
```
これにより、初期パスワード (`monnmo91`) と 2FA 用メール (`kawamonn91@gmail.com`) が設定されます。

## 6. クォータスクリプトの権限設定
webapp ユーザーが特定のスクリプトを実行できるように sudo アクセス権が必要です。
```bash
sudo cp scripts/sudoers_webapp /etc/sudoers.d/webapp
sudo chmod 0440 /etc/sudoers.d/webapp
```
(注: `scripts/sudoers_webapp` ファイルはリポジトリに含まれていない場合は作成してください: `webapp ALL=(root) NOPASSWD: /path/to/script`)

## 6. Systemd サービス
サービスファイルを `/etc/systemd/system/` にコピーします:
```bash
sudo cp deployment/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kawamonn-register kawamonn-account kawamonn-admin kawamonn-filemanager kawamonn-worker kawamonn-beat kawamonn-home
```

## 7. Cloudflare Tunnel
提供された設定で `cloudflared` を設定します:
```bash
sudo cp deployment/cloudflared/config.yml /etc/cloudflared/config.yml
sudo systemctl restart cloudflared
```
Cloudflare 上の DNS レコードがこの Tunnel を指していることを確認してください (`home`, `register`, `account`, `admin`, `web` サブドメイン)。

## 8. 動作確認
- `https://register.kawamonn.com` にアクセスしてテストアカウントを作成します。
- `admin.kawamonn.com` で新しいユーザーが表示されるか確認します。
