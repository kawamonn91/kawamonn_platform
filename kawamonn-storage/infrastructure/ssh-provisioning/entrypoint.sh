#!/bin/bash

USERNAME=${USERNAME:-"kawamonn"}
PUBLIC_KEY=${PUBLIC_KEY:-""}

# ユーザーが存在しなければ作成（非rootユーザー）
if ! id -u "$USERNAME" > /dev/null 2>&1; then
    useradd -m -s /bin/bash "$USERNAME"
    # パスワード認証を無効化（SSHキー認証のみ許可）
    passwd -l "$USERNAME"
fi

# SSHキーの設定（PUBLIC_KEYが提供された場合）
if [ -n "$PUBLIC_KEY" ]; then
    SSH_DIR="/home/$USERNAME/.ssh"
    mkdir -p "$SSH_DIR"
    echo "$PUBLIC_KEY" >> "$SSH_DIR/authorized_keys"
    chmod 700 "$SSH_DIR"
    chmod 600 "$SSH_DIR/authorized_keys"
    chown -R "$USERNAME:$USERNAME" "$SSH_DIR"
fi

# ホームディレクトリの所有権を確保
chown -R "$USERNAME:$USERNAME" "/home/$USERNAME" 2>/dev/null || true

# SSHdの設定: rootログイン禁止・パスワード認証禁止
sed -i 's/#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config

# メインコマンドを実行 (例: sshd -D)
exec "$@"
