@echo off
setlocal

python -m pip install --upgrade pip
if errorlevel 1 exit /b 1

python -m pip install .
if errorlevel 1 exit /b 1

python -m pip uninstall opencv-python -y 2>nul
python -m pip install opencv-contrib-python --force-reinstall -q
if errorlevel 1 exit /b 1

echo Installation complete. Run: video-processor --help
