#!/bin/bash
# Usage: ./provision.sh <username> <ssh_port> <cpu_limit> <mem_limit>

USERNAME=$1
SSH_PORT=$2
CPU_LIMIT=$3
MEM_LIMIT=$4

if [ -z "$USERNAME" ] || [ -z "$SSH_PORT" ]; then
    echo "Usage: $0 <username> <ssh_port> [cpu_limit] [mem_limit]"
    exit 1
fi

CPU_LIMIT=${CPU_LIMIT:-"1.0"}
MEM_LIMIT=${MEM_LIMIT:-"512m"}
IMAGE_NAME="kawamonn-ssh-base:latest"
CONTAINER_NAME="kawamonn-ssh-${USERNAME}"
STORAGE_PATH="/home/pi/hdd/ssh/${USERNAME}"

echo "Creating storage directory if not exists: $STORAGE_PATH"
mkdir -p "$STORAGE_PATH"
# We assume the external user has Pi's UID (e.g. 1000) mapped correctly for rootless podman.

echo "Provisioning SSH container for user: $USERNAME"

# 20GB disk quota enforcement: For rootless Podman, we use --storage-opt size=20G for the container's scratch space,
# though host-mounted volumes (`$STORAGE_PATH`) require host-level quota (e.g. xfs_quota) which should be enabled
# separately on the Pi's host filesystem mounting /home/pi/hdd/ssh.

podman run -d \
    --name "$CONTAINER_NAME" \
    --cpus="$CPU_LIMIT" \
    --memory="$MEM_LIMIT" \
    --storage-opt size=20G \
    -p "$SSH_PORT:22" \
    -e SSH_USER="$USERNAME" \
    -v "$STORAGE_PATH:/home/$USERNAME/workspace:Z" \
    "$IMAGE_NAME"

echo "Container $CONTAINER_NAME started on port $SSH_PORT."
