#!/bin/bash
set -e

# USERNAME and PUBLIC_KEY will be passed as environment variables during docker run
if [ -z "$USERNAME" ]; then
    echo "ERROR: USERNAME environment variable is not set."
    exit 1
fi

# Create user if it doesn't exist
if ! id -u "$USERNAME" > /dev/null 2>&1; then
    # We create the user with no password and specify bash
    useradd -m -s /bin/bash "$USERNAME"
    # Provide passwordless sudo access restricted to harmless commands if necessary, 
    # but initially give full sudo for a true VPS-like experience (optional based on security model)
    echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$USERNAME
fi

# Set up SSH directory
SSH_DIR="/home/$USERNAME/.ssh"
mkdir -p "$SSH_DIR"

# Write public key
if [ ! -z "$PUBLIC_KEY" ]; then
    echo "$PUBLIC_KEY" > "$SSH_DIR/authorized_keys"
    chmod 600 "$SSH_DIR/authorized_keys"
fi

# Ensure correct permissions for the home directory (important if mounted from host)
chown -R "$USERNAME:$USERNAME" "/home/$USERNAME"
chmod 700 "$SSH_DIR"

exec /usr/sbin/sshd -D
