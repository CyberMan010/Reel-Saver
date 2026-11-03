@echo off
setlocal
cd /d "%~dp0"

REM Keep all caches, binaries, and temp files strictly on this repo drive (0 bytes on C:)
set "DATA_DIR=%~dp0data"
set "BIN_DIR=%DATA_DIR%\bin"
set "UPLOADS_DIR=%~dp0uploads"
set "TEMP=%UPLOADS_DIR%\tmp"
set "TMP=%UPLOADS_DIR%\tmp"
set "npm_config_cache=%DATA_DIR%\npm-cache"

if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"
if not exist "%TEMP%" mkdir "%TEMP%"

set "CLOUDFLARED_EXE=%BIN_DIR%\cloudflared.exe"

if not exist "%CLOUDFLARED_EXE%" (
  echo [Tunnel] Downloading Cloudflare Quick Tunnel binary into "%CLOUDFLARED_EXE%" ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%CLOUDFLARED_EXE%'"
)

if not exist "%CLOUDFLARED_EXE%" (
  echo [Error] Could not download cloudflared.exe. Check your internet connection.
  pause
  exit /b 1
)

echo [Reel-Saver] Starting backend server in background window on port 4000...
start "Reel-Saver Backend" cmd /k "cd /d "%~dp0" && start-windows.bat"

timeout /t 4 /nobreak >nul

echo.
echo ============================================================================
echo   Opening FREE Public HTTPS URL (No Account, No Credit Card, 0 Bytes on C:)
echo   Look for the https://xxxx-xxxx.trycloudflare.com link printed below!
echo ============================================================================
echo.

"%CLOUDFLARED_EXE%" tunnel --no-autoupdate --url http://127.0.0.1:4000
pause
