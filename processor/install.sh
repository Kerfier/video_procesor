#!/bin/bash
set -e

VENV_DIR=".venv"

if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install .
"$VENV_DIR/bin/pip" uninstall opencv-python opencv-python-headless opencv-contrib-python -y 2>/dev/null || true
"$VENV_DIR/bin/pip" install opencv-contrib-python==4.13.0.92

echo ""
echo "Installation complete. Activate the virtual environment first:"
echo "  source .venv/bin/activate"
echo "Then run: video-processor --help"
