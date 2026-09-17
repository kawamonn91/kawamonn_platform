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

# Revoke OS-level access first and unconditionally, regardless of whether the
# storage directory below still exists. Without this, a deleted/expired user
# keeps their SSH login and group memberships indefinitely.
if id "$USERNAME" &>/dev/null; then
    pkill -u "$USERNAME" 2>/dev/null || true
    userdel -r "$USERNAME" 2>/dev/null || userdel "$USERNAME" 2>/dev/null || true
fi
for grp in docker kawamonn-users; do
    gpasswd -d "$USERNAME" "$grp" 2>/dev/null || true
done

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
