@echo off
setlocal

python -m pip install --upgrade pip
python -m pip install .
python -m pip uninstall opencv-python -y 2>nul
python -m pip install opencv-contrib-python --force-reinstall -q

echo Installation complete. Run: video-processor --help
