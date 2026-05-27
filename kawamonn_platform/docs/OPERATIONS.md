# 運用マニュアル

## バックアップ手順
### データベース
SQLite データベースは `/home/pi/hdd/ssh/kawamonn_platform/users.db` にあります。
毎日バックアップを取得してください:
```bash
cp /home/pi/hdd/ssh/kawamonn_platform/users.db /path/to/backup/users_$(date +%F).db
```

### ユーザーデータ
ユーザーファイルは `/home/pi/hdd/ssh/users/` にあります。
`rsync` または `tar` を使用してバックアップします:
```bash
tar -czf /path/to/backup/users_data_$(date +%F).tar.gz /home/pi/hdd/ssh/users/
```

## ログ確認
### アプリケーションログ
Systemd ログを確認します:
```bash
journalctl -u kawamonn-register -f
journalctl -u kawamonn-admin -f
journalctl -u kawamonn-worker -f
```

### 監査ログ (Audit Logs)
**管理者ダッシュボード** (`https://admin.kawamonn.com`) でユーザーの操作履歴を確認できます。
データベーステーブル: `audit_logs`

### メールログ
**管理者ダッシュボード** またはデータベーステーブル `mail_send_logs` で送信履歴を確認できます。

## アップデート手順
1. 最新コードをプルします。
2. 依存関係を更新します: `./scripts/setup_dev_env.sh` (内部で pip install を実行)。
3. サービスを再起動します:
   ```bash
   sudo systemctl restart kawamonn-*
   ```

## クォータ管理 (容量制限)
- **使用量確認**: 管理者ダッシュボード または `repquota -P /home/pi/hdd` コマンド。
- **クォータ変更**: 管理者ダッシュボードを使用（推奨）、またはコマンド `sudo ./scripts/update_quota.sh <project_id> <bytes>` を実行。

## 緊急時のユーザー削除
Web インターフェースが使用できない場合:
```bash
sudo ./scripts/delete_user.sh <username> archive
```
その後、手動で DB のステータスを 'deleted' に更新してください。
