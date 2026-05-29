# Kawamonn 拡張機能: SSH/VS Code Server 実装プラン

## 🎯 提案される新機能

### 1. SSH 接続でのファイル編集・実行
### 2. VS Code Server の自動クリーンアップ
### 3. 既存の有効期限管理との連携

---

## ✅ 実装可能性判定

| 機能 | 実装難度 | 必要期間 | 備考 |
|------|--------|--------|------|
| SSH サーバー統合 | ⭐☆☆ 簡単 | 1-2週間 | 既存インフラで対応可 |
| VS Code Server 自動デプロイ | ⭐⭐☆ 中程度 | 2-3週間 | スクリプト化で自動化 |
| 非アクティブ検知 + 自動削除 | ⭐⭐⭐ やや複雑 | 3-4週間 | 既存タスク（Celery）で実装 |
| 有効期限警告の統合 | ⭐☆☆ 簡単 | 1週間 | 既存システムの延長 |
| **全体** | ⭐⭐☆ 中程度 | **4-6週間** | モジュール化で段階実装可 |

---

## 🏗️ 実装アーキテクチャ

### 現状（ファイルストレージのみ）

```
User Browser
    ↓
    ├─ Kawamonn Web UI (React)
    │  └─ ファイル管理・アップロード
    │
    └─ MinIO ストレージ
       └─ ファイル保存
```

### 拡張後（SSH + VS Code Server）

```
User's Local Machine
    ↓
    ├─ Browser
    │  └─ Kawamonn Web UI (既存)
    │
    ├─ VS Code Desktop
    │  └─ Remote SSH Extension
    │     └─ ~/.ssh/config
    │        {
    │          Host kawamonn
    │          HostName raspi5.local
    │          User username
    │          Port 22
    │        }
    │
    └─ Terminal (SSH/SCP)
       └─ ssh username@raspi5.local

              ↓ SSH認証

Raspi 5 (Kawamonn Server)
    ├─ OpenSSH Server (既存)
    ├─ User's Home Dir
    │  ├─ /home/pi/hdd/ssh/users/{username}/
    │  ├─ .vscode-server/ (VS Code Server)
    │  └─ .local/bin/ (User Scripts)
    │
    ├─ Celery Worker (監視)
    │  ├─ last_ssh_activity 監視
    │  ├─ 非アクティブ検知 (30日)
    │  └─ VS Code Server 削除
    │
    └─ PostgreSQL (アクティビティ記録)
       └─ last_ssh_login_at
           last_activity_at
```

---

## 📋 詳細実装計画

### Phase 1: SSH サーバー基盤 (1-2週間)

#### 1.1 OpenSSH 設定の最適化

```bash
# /etc/ssh/sshd_config に追加

# ユーザー認証
PasswordAuthentication yes
PubkeyAuthentication yes
MaxAuthTries 3

# Session 管理
ClientAliveInterval 60        # 60秒ごとにキープアライブ
ClientAliveCountMax 10        # 10回失敗で切断
MaxSessions 5                 # ユーザーあたり最大5セッション

# パフォーマンス
Compression yes               # ネットワーク圧縮
TCPKeepAlive yes             # TCP キープアライブ

# ログイン試行ログ
SyslogFacility AUTH
LogLevel VERBOSE
```

#### 1.2 ユーザー管理スクリプト改訂

```bash
# scripts/create_user_dir.sh に以下を追加

# SSH 用ディレクトリ作成
mkdir -p /home/pi/hdd/ssh/users/{username}/.ssh
mkdir -p /home/pi/hdd/ssh/users/{username}/.local/bin
mkdir -p /home/pi/hdd/ssh/users/{username}/.config

# 権限設定
chmod 700 /home/pi/hdd/ssh/users/{username}/.ssh
chmod 755 /home/pi/hdd/ssh/users/{username}/.local/bin

# authorized_keys テンプレート
echo "# Add your SSH public key here" > \
  /home/pi/hdd/ssh/users/{username}/.ssh/authorized_keys
chmod 600 /home/pi/hdd/ssh/users/{username}/.ssh/authorized_keys
```

#### 1.3 DB スキーマ追加（Prisma）

```prisma
model User {
  // ... 既存フィールド ...
  
  // SSH/アクティビティ追跡
  last_ssh_login_at    DateTime?
  last_activity_at     DateTime?  // 最後のファイル操作時刻
  ssh_public_key       String?    // 公開鍵
  vscode_server_status String @default("not_installed")
    // "not_installed" | "installed" | "running" | "disabled"
}

model SshActivity {
  id              String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  user_id         String   @db.Uuid
  activity_type   String   // "login" | "file_edit" | "command_exec"
  command         String?  // 実行コマンド（ログ用）
  ip_address      String?
  created_at      DateTime @default(now())
  
  user            User     @relation(fields: [user_id], references: [id], onDelete: Cascade)
  
  @@index([user_id, created_at])
}
```

---

### Phase 2: VS Code Server 統合 (2-3週間)

#### 2.1 自動インストール機能

```typescript
// kawamonn-storage-backend/src/ssh/ssh.service.ts

@Injectable()
export class SshService {
  private readonly logger = new Logger('SshService');

  constructor(
    private prisma: PrismaService,
    private bullService: BullService // ジョブキュー
  ) {}

  /**
   * ユーザーのために VS Code Server をインストール
   */
  async installVscodeServer(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // ジョブキューに登録（バックグラウンド処理）
    await this.bullService.add('install-vscode-server', {
      userId,
      accountName: user.account_name,
      homePath: `/home/pi/hdd/ssh/users/${user.account_name}`,
    });

    return { status: 'Installation queued', userId };
  }

  /**
   * VS Code Server インストール処理（Celery Worker で実行）
   */
  async executeVscodeServerInstallation(
    userId: string,
    accountName: string,
    homePath: string
  ) {
    try {
      // Step 1: VS Code Server ダウンロード
      const version = 'latest'; // または固定バージョン
      const vsCodeUrl =
        `https://update.code.visualstudio.com/commit:latest/server-linux-x64/stable`;

      const installPath = `${homePath}/.vscode-server`;
      await execAsync(`mkdir -p ${installPath}`);

      // Step 2: ダウンロード
      await execAsync(
        `cd ${installPath} && ` +
        `curl -L ${vsCodeUrl} | tar xz`
      );

      // Step 3: シンボリックリンク作成（$PATH に追加）
      await execAsync(
        `ln -sf ${installPath}/bin/code-server ` +
        `${homePath}/.local/bin/code-server`
      );

      // Step 4: 権限設定
      await execAsync(`chown -R ${accountName}:${accountName} ${installPath}`);

      // Step 5: DB 更新
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          vscode_server_status: 'installed',
          updated_at: new Date(),
        },
      });

      // Step 6: 監査ログ
      await this.logSshActivity(userId, 'vscode_install', null);

      this.logger.log(`VS Code Server installed for user ${accountName}`);
    } catch (error) {
      this.logger.error(
        `Failed to install VS Code Server for user ${accountName}:`,
        error
      );
      throw error;
    }
  }
}
```

#### 2.2 VS Code Server 起動スクリプト

```bash
# /home/pi/hdd/ssh/users/{username}/.local/bin/start-vscode.sh

#!/bin/bash

VSCODE_SERVER_HOME="${HOME}/.vscode-server"
VSCODE_PORT=8443  # 各ユーザーで異なるポート（例: 8443+UID）

# 既に起動していないか確認
if pgrep -f "node.*code-server" > /dev/null; then
  echo "VS Code Server is already running"
  exit 0
fi

# VS Code Server 起動
${VSCODE_SERVER_HOME}/bin/code-server \
  --host 0.0.0.0 \
  --port ${VSCODE_PORT} \
  --user-data-dir ${VSCODE_SERVER_HOME}/user-data \
  --extensions-dir ${VSCODE_SERVER_HOME}/extensions \
  ${HOME} &

# ポート情報をログ
echo "VS Code Server started on port ${VSCODE_PORT}"
echo "Access URL: https://localhost:${VSCODE_PORT}"

# アクティビティログ更新
curl -X POST http://localhost:3000/api/v1/ssh/activity \
  -H "Authorization: Bearer $SSH_TOKEN" \
  -d '{"activity_type":"vscode_start","data":{}}'
```

#### 2.3 ポートマッピング管理

```yaml
# docker-compose.yml に追加

services:
  vscode-proxy:
    image: nginx:alpine
    ports:
      - "8000-8100:8000-8100"  # VS Code Server ポートをバインド
    volumes:
      - ./nginx-vscode.conf:/etc/nginx/nginx.conf
    depends_on:
      - kawamonn-storage-backend
```

---

### Phase 3: 非アクティブ検知 + 自動クリーンアップ (3-4週間)

#### 3.1 アクティビティトラッキング

```typescript
// kawamonn-storage-backend/src/ssh/ssh.activity.interceptor.ts

@Injectable()
export class SshActivityInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // JWT から取得

    // API 実行後、ユーザーのアクティビティ更新
    return next.handle().pipe(
      tap(async () => {
        if (user && user.id) {
          await this.prisma.user.update({
            where: { id: user.id },
            data: { last_activity_at: new Date() },
          });
        }
      })
    );
  }
}
```

#### 3.2 Celery タスク: 非アクティブユーザー検知

```python
# worker/tasks.py に追加

@celery_app.task
def cleanup_inactive_vscode_servers():
    """
    30日以上非アクティブなユーザーの VS Code Server を削除
    """
    with app.app_context():
        now = datetime.utcnow()
        inactive_threshold = now - timedelta(days=30)

        # 30日以上アクティビティがなく、VS Code Server がインストールされているユーザー
        inactive_users = User.query.filter(
            User.last_activity_at < inactive_threshold,
            User.vscode_server_status == 'installed'
        ).all()

        for user in inactive_users:
            try:
                # VS Code Server ディレクトリを削除
                vscode_path = f"/home/pi/hdd/ssh/users/{user.username}/.vscode-server"
                if os.path.exists(vscode_path):
                    shutil.rmtree(vscode_path)
                    
                    # DB 更新
                    user.vscode_server_status = 'deleted'
                    db.session.commit()

                    # 監査ログ
                    log = AuditLog(
                        user_id=user.id,
                        action='VSCODE_SERVER_AUTO_CLEANUP',
                        details=f'Cleaned up after {(now - user.last_activity_at).days} days of inactivity',
                        performer_id=None  # System action
                    )
                    db.session.add(log)
                    db.session.commit()

                    print(f"Cleaned up VS Code Server for {user.username}")
            except Exception as e:
                print(f"Error cleaning up VS Code for {user.username}: {e}")


@celery_app.task
def check_vscode_disk_usage():
    """
    VS Code Server の総ディスク使用量をチェック
    もし合計が一定値を超えたら、最も古いものから削除
    """
    with app.app_context():
        users_base = "/home/pi/hdd/ssh/users"
        total_vscode_size = 0
        vscode_dirs = []

        # 全ユーザーの VS Code Server サイズを計算
        for username in os.listdir(users_base):
            vscode_path = os.path.join(
                users_base, username, ".vscode-server"
            )
            if os.path.exists(vscode_path):
                size = sum(
                    os.path.getsize(os.path.join(dirpath, filename))
                    for dirpath, dirnames, filenames in os.walk(vscode_path)
                    for filename in filenames
                )
                total_vscode_size += size
                vscode_dirs.append({
                    'path': vscode_path,
                    'username': username,
                    'size': size
                })

        # 上限チェック (例: 50GB)
        vscode_size_limit = 50 * 1024 * 1024 * 1024
        if total_vscode_size > vscode_size_limit:
            print(f"VS Code Server total size {total_vscode_size / 1024**3:.2f}GB exceeds limit")
            
            # 最も古いものから削除
            vscode_dirs.sort(
                key=lambda x: os.path.getmtime(x['path'])
            )
            
            for vscode_dir in vscode_dirs:
                if total_vscode_size <= vscode_size_limit * 0.8:  # 80%まで削除
                    break
                
                try:
                    shutil.rmtree(vscode_dir['path'])
                    total_vscode_size -= vscode_dir['size']
                    print(f"Deleted {vscode_dir['username']}'s VS Code Server")
                except Exception as e:
                    print(f"Error deleting {vscode_dir['path']}: {e}")
```

#### 3.3 SSH ログイン時のアクティビティ記録

```bash
# /etc/ssh/sshrc または ~/.ssh/rc に追加
# 実行ファイル: /home/pi/hdd/ssh/scripts/ssh_login_hook.py

#!/usr/bin/env python3

import os
import sys
import json
from datetime import datetime
from urllib.request import urlopen, Request
from urllib.parse import urlencode

def log_ssh_activity(username, activity_type, command=''):
    """SSH アクティビティを API に送信"""
    try:
        # API エンドポイント
        api_url = "http://localhost:3000/api/v1/ssh/activity"
        
        data = json.dumps({
            "username": username,
            "activity_type": activity_type,
            "command": command,
            "ip_address": os.environ.get('SSH_CLIENT', '').split()[0],
            "timestamp": datetime.utcnow().isoformat()
        }).encode('utf-8')

        req = Request(
            api_url,
            data=data,
            headers={
                'Content-Type': 'application/json',
                'X-SSH-Activity': 'true'
            }
        )
        
        urlopen(req, timeout=5)
    except Exception as e:
        print(f"Failed to log SSH activity: {e}", file=sys.stderr)

# SSH ログイン時に実行
if __name__ == "__main__":
    username = os.environ.get('USER', 'unknown')
    log_ssh_activity(username, 'ssh_login')
```

---

### Phase 4: 有効期限警告の統合と最終削除 (1-2週間)

#### 4.1 拡張有効期限フロー

```python
# worker/tasks.py の check_reminders() を拡張

@celery_app.task
def check_reminders():
    """
    既存メール通知 + SSH/VS Code Server のクリーンアップ
    """
    with app.app_context():
        now = datetime.utcnow()
        users = User.query.filter(
            User.expiry_at != None,
            User.status == UserStatus.ACTIVE
        ).all()
        
        for user in users:
            days_left = (user.expiry_at - now).days
            
            # 既存論理: メール送信
            # ... 既存コード ...
            
            # 追加: SSH/VS Code Server 削除スケジュール
            if days_left == 3:  # 3日前
                # SSH アクセス禁止準備
                user.vscode_server_status = 'disabled'
                user.ssh_access_enabled = False
                db.session.commit()
                
                # SSH ホームディレクトリをバックアップ
                backup_dir = f"/backup/users/{user.username}-{now.strftime('%Y%m%d')}"
                os.makedirs(backup_dir, exist_ok=True)
                shutil.copytree(
                    f"/home/pi/hdd/ssh/users/{user.username}",
                    backup_dir
                )
            
            if days_left == 0:  # 有効期限到達
                # 最終削除
                finalize_user_deletion(user.id)


def finalize_user_deletion(user_id):
    """
    ユーザーデータの最終削除処理
    """
    user = User.query.get(user_id)
    if not user or not user.email.endswith('@u-aizu.ac.jp'):
        return  # @u-aizu.ac.jp のみ削除

    try:
        # Step 1: SSH ホームディレクトリ削除
        user_home = f"/home/pi/hdd/ssh/users/{user.username}"
        if os.path.exists(user_home):
            shutil.rmtree(user_home)

        # Step 2: MinIO からファイル削除
        # ... MinIO 削除処理 ...

        # Step 3: DB から削除
        user.status = UserStatus.DELETED
        db.session.commit()
        
        # Step 4: 監査ログ
        log = AuditLog(
            user_id=user.id,
            action='ACCOUNT_AUTO_DELETED',
            performer_id=None
        )
        db.session.add(log)
        db.session.commit()

        print(f"User {user.username} data permanently deleted")
    except Exception as e:
        print(f"Error finalizing user deletion: {e}")
```

---

## 🔧 技術スタック追加

| コンポーネント | 役割 | 既存 | 新規 |
|--------------|------|------|------|
| OpenSSH | SSH サーバー | ✅ | - |
| VS Code Server | ブラウザ/SSH エディタ | - | ✅ 新規 |
| Celery Worker | アクティビティ監視 | ✅ 既存 | ✨ 拡張 |
| PostgreSQL | アクティビティ記録 | ✅ 既存 | ✨ スキーマ追加 |
| BullMQ | バックグラウンドジョブ | ✅ 既存 | ✨ 活用拡大 |
| Nginx/Proxy | ポート管理 | ✅ 既存 | ✨ VS Code 設定 |

---

## 📊 リソース消費予測

### VS Code Server のディスク使用量

```
インスタンス単位: ~500MB - 1GB
  - バイナリ: ~300MB
  - Extensions cache: ~100-200MB
  - User settings: ~50-100MB

100ユーザー × 0.75GB = 75GB... 🤔

対策:
1️⃣ 30日非アクティブで自動削除 → 年間で最大 ~40-50GB 削減
2️⃣ 共有 VS Code Server インスタンス (複数ユーザー共用)
   → ディスク消費を 50% 削減
3️⃣ マルチユーザーコンテナ化
   → 全ユーザー共有で ~1-2GB で OK
```

### メモリ消費

```
VS Code Server (プロセス): ~150-300MB/実行中インスタンス
→ 同時実行は控えめ（1-3ユーザー程度）
→ idle 状態では自動キル

対策: systemd-timer で定期的に idle プロセス削除
```

### CPU 負荷

```
ファイルシステム監視: 軽微
SSH ログイン/ログアウト: 軽微  
非アクティブスキャン (Celery): 中程度 (1-2分/日)

対策: スキャンをオフピーク時間に実行
      (毎日 2:00 AM など)
```

---

## 🎯 フェーズ別ロードマップ

```
Month 1: Phase 1 - SSH 基盤
├─ Week 1-2: OpenSSH 設定、ユーザーディレクトリ準備
├─ Week 3: DB スキーマ設計・実装
└─ Week 4: テスト・デバッグ

Month 2: Phase 2 - VS Code Server 統合
├─ Week 1-2: 自動インストール機能
├─ Week 3: ポート管理・プロキシ設定
└─ Week 4: ブラウザ/SSH クライアント対応

Month 3: Phase 3 - アクティビティ監視
├─ Week 1: トラッキング機構
├─ Week 2-3: 非アクティブ検知・クリーンアップ
└─ Week 4: ディスク管理ロジック

Month 4: Phase 4 - 有効期限統合 + 本番
├─ Week 1-2: 削除ロジック統合
├─ Week 3: セキュリティ監査
└─ Week 4: 本番環境デプロイ・運用開始

立ち上げリスク: ⭐⭐☆ (中程度)
テスト重視ポイント: ディスク管理、削除ロジック
```

---

## ⚠️ 実装時の注意点

### セキュリティ考慮

```
1️⃣ SSH キー認証
   ✅ 実装時点で公開鍵認証の強制
   ✅ パスワード認証は管理者のみ許可

2️⃣ VS Code Server ポート
   ✅ 内部ネットワークのみ (Nginx リバプロ)
   ✅ JWT トークン検証

3️⃣ アクティビティログ
   ✅ 実行コマンドは記録しない (個人情報保護)
   ✅ 操作時刻とファイルパスのみ記録
```

### パフォーマンス考慮

```
1️⃣ Celery スケジューリング
   ✅ アクティビティスキャンはオフピーク実行
   ✅ ディスク使用量チェック (日1回)

2️⃣ VS Code Server 起動
   ✅ Lazy start (初回接続時にのみ起動)
   ✅ Idle timeout (30分以上操作がない場合自動停止)

3️⃣ データベース
   ✅ last_activity_at にインデックス作成
   ✅ SshActivity テーブルをパーティション化
```

### エラーハンドリング

```
1️⃣ インストール失敗時の再試行
   ✅ 指数バックオフ (5分 → 30分 → 12時間)

2️⃣ ディスク満杯時の処理
   ✅ 即座に非アクティブユーザー削除優先
   ✅ アラート送信

3️⃣ 削除失敗時のロールバック
   ✅ トランザクション管理
   ✅ バックアップから復旧可能に
```

---

## 📖 ドキュメント更新項目

既存資料に追加すべき内容：

1. **プロジェクト説明資料.md**
   - 新機能: "SSH & VS Code Server サポート" セクション追加
   - ユースケース: プログラミング実習、リモート開発

2. **ビジュアル説明資料.md**
   - SSH ログインフロー図
   - VS Code Server インストール・実行フロー
   - アクティビティ監視フロー

3. **運用ガイド.md**
   - SSH ユーザー作成・管理コマンド
   - VS Code Server トラブルシューティング
   - ディスク使用量監視コマンド

4. **新規作成: SSH & VS Code Server セットアップガイド.md**
   - ユーザー向けの接続手順
   - VS Code Remote SSH 設定例
   - 制限事項・FAQ

---

## 💰 結論

**✅ すべて実装可能です。** 

- 既存インフラ (Raspi5, Celery, PostgreSQL) で対応可
- 新規技術は VS Code Server インストール程度で、難易度は中程度
- 段階実装で4ヶ月かけてできる内容
- フェーズごとに価値を提供できる設計

**推奨順序:**
1. SSH 基盤整備 (最小1週間で動作可)
2. VS Code Server (2週間追加)
3. 非アクティブ削除 (3週間追加)
4. 有効期限統合 (1週間追加)

さあ、実装開始しますか？🚀
