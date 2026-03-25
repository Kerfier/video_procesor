#!/bin/bash
set -e

pip install .
pip uninstall opencv-python -y 2>/dev/null || true
pip install opencv-contrib-python --force-reinstall -q

echo "Installation complete. Run: video-processor --help"
