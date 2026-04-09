@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "COMPOSE_FILE=%SCRIPT_DIR%docker-compose.yml"

echo =^> Building images...
docker compose -f "%COMPOSE_FILE%" build
if errorlevel 1 (
    echo ERROR: Build failed.
    exit /b 1
)

echo =^> Starting services...
docker compose -f "%COMPOSE_FILE%" up -d
if errorlevel 1 (
    echo ERROR: Failed to start services.
    exit /b 1
)

echo.
echo On first run the processor downloads YOLO models (~30 MB). This may take 1-2 minutes.
echo.
echo Waiting for server to become ready...

:wait_loop
docker compose -f "%COMPOSE_FILE%" exec -T server wget -qO- http://localhost:3000/health >nul 2>&1
if errorlevel 1 (
    timeout /t 3 /nobreak >nul
    goto wait_loop
)

echo.
echo =^> Ready! Open http://localhost:3000 in your browser.
echo.
echo Useful commands:
echo   docker compose logs -f             -- stream logs from all services
echo   docker compose logs -f processor   -- processor logs only
echo   docker compose down                -- stop (volumes preserved)
echo   docker compose down -v             -- stop and delete volumes
echo   docker compose build               -- rebuild images after code changes
