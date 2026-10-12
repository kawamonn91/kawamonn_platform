#!/bin/bash

USERNAME=${USERNAME:-"kawamonn"}
PUBLIC_KEY=${PUBLIC_KEY:-""}

# コンテナ内のユーザーの UID/GID。ホームはホストのフォルダをそのままつないでいるので、
# この番号がホスト上のファイルの所有者になる。ホストのどのアカウントとも重ならない番号にする
#   ホストの一般ユーザー: 1000〜60000 / systemd の動的ユーザー: 61184〜65519 / サブ UID: 100000〜
# (以前は UID を指定せずに作っていたため、イメージに元からいる ubuntu(1000)の次の 1001 になり、
#  ホスト上では同じ UID を持つ別の利用者のアカウントの所有に見えていた)
USER_UID=${USER_UID:-70000}

if ! getent group "$USER_UID" > /dev/null; then
    groupadd -g "$USER_UID" kawamonn-user
fi

if id -u "$USERNAME" > /dev/null 2>&1; then
    # イメージに元からいるユーザー(mail、backup など)と同じ名前でも、システムの UID のまま使わせない
    if [ "$(id -u "$USERNAME")" != "$USER_UID" ]; then
        usermod -u "$USER_UID" -g "$USER_UID" -s /bin/bash -d "/home/$USERNAME" "$USERNAME"
        passwd -l "$USERNAME"
    fi
else
    useradd -m -u "$USER_UID" -g "$USER_UID" -s /bin/bash "$USERNAME"
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
    chown -R "$USER_UID:$USER_UID" "$SSH_DIR"
fi

# ホームディレクトリの所有権を確保
chown -R "$USER_UID:$USER_UID" "/home/$USERNAME" 2>/dev/null || true

# SSHdの設定: rootログイン禁止・パスワード認証禁止
sed -i 's/#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config

# メインコマンドを実行 (例: sshd -D)
exec "$@"
