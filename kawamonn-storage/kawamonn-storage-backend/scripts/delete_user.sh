#!/bin/bash
set -e

# Usage: ./delete_user.sh <username> <action> [role]
# action: 'delete' or 'archive'
# role: 'user' (default) or 'admin'
#
# 利用者フォルダ(/home/pi/hdd/ssh/users/<username> または管理者の場合は /home/pi/hdd/ssh/<username>)を消す。
# archive なら先に /home/pi/hdd/ssh/archives/ に保管する。
USERNAME=$1
ACTION=$2
ROLE=${3:-user}

RESERVED_NAMES="kawamonn-storage kawamonn-labs users archives admin administrator root ssh"

if [ -z "$USERNAME" ] || [ -z "$ACTION" ]; then
    echo "Usage: $0 <username> <delete|archive> [user|admin]"
    exit 1
fi
# root で rm -rf するので、利用者名の規則(src/common/account-name.ts と同じ)に合わない名前は扱わない
if ! [[ "$USERNAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$ ]]; then
    echo "Invalid username: $USERNAME"
    exit 1
fi

# システム・重要ディレクトリ名への誤操作を防止
for r in $RESERVED_NAMES; do
    if [ "$USERNAME" = "$r" ]; then
        echo "Refusing to operate on reserved system directory: $USERNAME"
        exit 1
    fi
done

if [ "$ACTION" != "archive" ] && [ "$ACTION" != "delete" ]; then
    echo "Invalid action: $ACTION"
    exit 1
fi

if [ "$ROLE" = "admin" ]; then
    BASE_DIR="/home/pi/hdd/ssh"
    USER_DIR="$BASE_DIR/$USERNAME"
    ARCHIVE_PREFIX="admin_"
else
    BASE_DIR="/home/pi/hdd/ssh/users"
    USER_DIR="$BASE_DIR/$USERNAME"
    ARCHIVE_PREFIX=""
fi
ARCHIVE_DIR="/home/pi/hdd/ssh/archives"

if [ ! -d "$USER_DIR" ]; then
    echo "User directory not found: $USER_DIR"
    exit 0
fi

if [ "$ACTION" == "archive" ]; then
    mkdir -p "$ARCHIVE_DIR"
    ARCHIVE_FILE="$ARCHIVE_DIR/${ARCHIVE_PREFIX}${USERNAME}_$(date +%Y%m%d_%H%M%S).tar.gz"
    tar -czf "$ARCHIVE_FILE" -C "$BASE_DIR" "$USERNAME"
    echo "Archived to $ARCHIVE_FILE"
fi

# Delete
rm -rf "$USER_DIR"
echo "Deleted $USER_DIR"
