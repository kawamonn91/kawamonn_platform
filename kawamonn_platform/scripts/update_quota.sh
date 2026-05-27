#!/bin/bash
set -e

# Usage: ./update_quota.sh <project_id> <new_quota_bytes>
PROJECT_ID=$1
QUOTA_BYTES=$2

if [ -z "$PROJECT_ID" ] || [ -z "$QUOTA_BYTES" ]; then
    echo "Usage: $0 <project_id> <new_quota_bytes>"
    exit 1
fi

BLOCK_LIMIT_KB=$((QUOTA_BYTES / 1024))

setquota -P "$PROJECT_ID" "$BLOCK_LIMIT_KB" "$BLOCK_LIMIT_KB" 0 0 /home/pi/hdd

echo "Quota updated for Project ID $PROJECT_ID: ${BLOCK_LIMIT_KB} KB"
