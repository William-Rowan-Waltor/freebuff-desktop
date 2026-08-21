@echo off
REM Freebuff Desktop launcher (Windows) - double-click to start.
setlocal
cd /d "%~dp0"

where docker >nul 2>nul
if errorlevel 1 (
    echo.
    echo [Freebuff] Docker was not found. Install Docker Desktop first:
    echo           https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)

REM Make sure .env exists (secrets live in .env.local which is git-ignored).
if not exist .env (
    if exist .env.local (
        copy /y .env.local .env >nul
        echo [Freebuff] Created .env from .env.local
    ) else (
        echo.
        echo [Freebuff] Missing .env - copy .env.example to .env and fill in
        echo           your Supabase URL and anon key, then run this again.
        echo.
        pause
        exit /b 1
    )
)

echo [Freebuff] Building and starting the app (first run takes a few minutes)...
docker compose up -d --build
if errorlevel 1 (
    echo.
    echo [Freebuff] Build or start failed - see the error above.
    echo.
    pause
    exit /b 1
)

echo [Freebuff] Opening http://localhost:3000 ...
start "" http://localhost:3000
echo.
echo [Freebuff] Running at http://localhost:3000
echo           Stop it later with:  docker compose down
echo.
pause
endlocal
