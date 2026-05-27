#!/bin/bash
set -e

# Create virtual environment
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo "Virtual environment created."
fi

# Install dependencies
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

echo "Development environment setup complete. To activate: source venv/bin/activate"
