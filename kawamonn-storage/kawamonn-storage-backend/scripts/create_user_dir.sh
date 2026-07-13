#!/bin/bash
set -e

# Usage: ./create_user_dir.sh <username> <project_id> <quota_bytes>
USERNAME=$1
PROJECT_ID=$2
QUOTA_BYTES=$3

if [ -z "$USERNAME" ] || [ -z "$PROJECT_ID" ]; then
    echo "Usage: $0 <username> <project_id> [quota_bytes]"
    exit 1
fi

if [ -z "$QUOTA_BYTES" ]; then
    QUOTA_BYTES=21474836480 # 20GB
fi

BASE_DIR="/home/pi/hdd/ssh/users"
USER_DIR="$BASE_DIR/$USERNAME"

# Create directory
if [ ! -d "$USER_DIR" ]; then
    mkdir -p "$USER_DIR"
    chown webapp:webapp "$USER_DIR"
    chmod 770 "$USER_DIR" # Only webapp and group (if used)
    echo "Directory created: $USER_DIR"
else
    echo "Directory already exists: $USER_DIR"
fi

# Set Project ID
# We assume 'project' feature is enabled on the filesystem.
chattr +P "$USER_DIR"
# For ext4 with project quota enabled:
chattr -p "$PROJECT_ID" "$USER_DIR"
# Verify
lsattr -p "$USER_DIR"

# Set Quota Limits
# bytes to KB:
BLOCK_LIMIT_KB=$((QUOTA_BYTES / 1024))

setquota -P "$PROJECT_ID" "$BLOCK_LIMIT_KB" "$BLOCK_LIMIT_KB" 0 0 /home/pi/hdd

echo "Quota set for Project ID $PROJECT_ID: ${BLOCK_LIMIT_KB} KB"
