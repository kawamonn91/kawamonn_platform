#!/bin/bash
set -e

# Usage: ./delete_user.sh <username> <action>
# action: 'delete' or 'archive'
USERNAME=$1
ACTION=$2
BASE_DIR="/home/pi/hdd/ssh/users"
USER_DIR="$BASE_DIR/$USERNAME"
ARCHIVE_DIR="/home/pi/hdd/ssh/archives" # Or specific archive location

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

# Note: Quota limits for the project ID remain in quota file until cleared, 
# but simply removing the files frees the space.
# We could technically reset quota to 0 for that project ID to be clean
# But since project IDs might be reused or not, we'll leave it or reset?
# Better to reset to 0 to avoid confusion if ID reused (though models should handle unique IDs)
# We need the project ID to reset quota. But we only passed username.
# The caller (python) should handle ID reuse or we accept dangling quota entries (harmless if ID not reused).
