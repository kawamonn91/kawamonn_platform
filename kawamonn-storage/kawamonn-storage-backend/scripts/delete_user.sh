#!/bin/bash
set -e

# Usage: ./delete_user.sh <username> <action>
# action: 'delete' or 'archive'
#
# 利用者フォルダ(/home/pi/hdd/ssh/users/<username>)を消す。archive なら先に
# /home/pi/hdd/ssh/archives/<username>_<日付>.tar.gz に保管する。
# 利用者のホストの OS アカウントは 2026-10 に廃止した(SSH 接続の入口をやめた)ので、ここでは扱わない。
USERNAME=$1
ACTION=$2
BASE_DIR="/home/pi/hdd/ssh/users"
USER_DIR="$BASE_DIR/$USERNAME"
ARCHIVE_DIR="/home/pi/hdd/ssh/archives"

if [ -z "$USERNAME" ] || [ -z "$ACTION" ]; then
    echo "Usage: $0 <username> <delete|archive>"
    exit 1
fi
# root で rm -rf するので、利用者名の規則(src/common/account-name.ts と同じ)に合わない名前は扱わない
if ! [[ "$USERNAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$ ]]; then
    echo "Invalid username: $USERNAME"
    exit 1
fi
if [ "$ACTION" != "archive" ] && [ "$ACTION" != "delete" ]; then
    echo "Invalid action: $ACTION"
    exit 1
fi

if [ ! -d "$USER_DIR" ]; then
    echo "User directory not found: $USER_DIR"
    exit 0
fi

if [ "$ACTION" == "archive" ]; then
    mkdir -p "$ARCHIVE_DIR"
    ARCHIVE_FILE="$ARCHIVE_DIR/${USERNAME}_$(date +%Y%m%d_%H%M%S).tar.gz"
    tar -czf "$ARCHIVE_FILE" -C "$BASE_DIR" "$USERNAME"
    echo "Archived to $ARCHIVE_FILE"
fi

# Delete
rm -rf "$USER_DIR"
echo "Deleted $USER_DIR"
