#!/bin/bash
set -e

# Usage: ./delete_user.sh <username> <action>
# action: 'delete' or 'archive'
USERNAME=$1
ACTION=$2
BASE_DIR="/home/pi/hdd/ssh/users"
USER_DIR="$BASE_DIR/$USERNAME"
ARCHIVE_DIR="/home/pi/hdd/ssh/archives"

if [ -z "$USERNAME" ] || [ -z "$ACTION" ]; then
    echo "Usage: $0 <username> <delete|archive>"
    exit 1
fi

if [ ! -d "$USER_DIR" ]; then
    echo "User directory not found: $USER_DIR"
    exit 0
fi

if [ "$ACTION" == "archive" ]; then
    mkdir -p "$ARCHIVE_DIR"
    tar -czf "$ARCHIVE_DIR/${USERNAME}_$(date +%F).tar.gz" -C "$BASE_DIR" "$USERNAME"
    echo "Archived to $ARCHIVE_DIR/${USERNAME}_*.tar.gz"
fi

# Delete
rm -rf "$USER_DIR"
echo "Deleted $USER_DIR"
