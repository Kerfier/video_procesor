@echo off
setlocal

pip install .
pip uninstall opencv-python -y 2>nul
pip install opencv-contrib-python --force-reinstall -q

echo Installation complete. Run: video-processor --help
