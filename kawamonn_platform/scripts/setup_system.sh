#!/bin/bash
set -e

# Install quota tools
apt-get update
apt-get install -y quota

# Create webapp user if it doesn't exist
if ! id "webapp" &>/dev/null; then
    useradd -r -s /bin/false -d /home/pi/hdd/ssh/kawamonn_platform webapp
    echo "User 'webapp' created."
else
    echo "User 'webapp' already exists."
fi

# Enable project quota on /dev/sda1
# WARNING: This might fail if mounted and kernel doesn't support online feature setting.
# Steps:
# 1. Check features
if ! dumpe2fs -h /dev/sda1 | grep -q "project"; then
    echo "Enabling project feature on /dev/sda1..."
    tune2fs -O project,quota /dev/sda1
    echo "Feature enabled. Remount might be required."
else
    echo "Project feature already enabled."
fi

# Ensure quota is on in mount options (remount if needed)
# Check /etc/fstab or current mount
# We assume the user manages fstab, but we can try to remount locally
mount -o remount,usrquota,grpquota,prjquota /home/pi/hdd

echo "System setup complete."
