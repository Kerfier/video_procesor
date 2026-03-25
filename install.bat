@echo off
setlocal

set VENV_DIR=.venv

if not exist "%VENV_DIR%" (
    python -m venv "%VENV_DIR%"
    if errorlevel 1 exit /b 1
)

"%VENV_DIR%\Scripts\python" -m pip install --upgrade pip
if errorlevel 1 exit /b 1

"%VENV_DIR%\Scripts\pip" install .
if errorlevel 1 exit /b 1

"%VENV_DIR%\Scripts\pip" uninstall opencv-python -y 2>nul
"%VENV_DIR%\Scripts\pip" install opencv-contrib-python --force-reinstall -q
if errorlevel 1 exit /b 1

echo.
echo Installation complete. Activate the virtual environment first:
echo   .venv\Scripts\activate
echo Then run: video-processor --help
