@echo off
REM ============================================================================
REM Reel-Saver Windows Native Launcher (NO Docker Required!)
REM Keeps ALL caches, Whisper models, temp files, and local DB on THIS drive
REM (e.g. E:\GitHub-Repoz\Reel-Saver\backend\data) so C:\ disk space is untouched.
REM ============================================================================

cd /d "%~dp0"

set "REPO_CACHE_ROOT=%~dp0data\.cache"
if not exist "%REPO_CACHE_ROOT%\tmp" mkdir "%REPO_CACHE_ROOT%\tmp"
if not exist "%~dp0data\whisper-models" mkdir "%~dp0data\whisper-models"

set "npm_config_cache=%REPO_CACHE_ROOT%\npm"
set "PIP_CACHE_DIR=%REPO_CACHE_ROOT%\pip"
set "WHISPER_CACHE_DIR=%~dp0data\whisper-models"
set "HF_HOME=%~dp0data\whisper-models"
set "TORCH_HOME=%~dp0data\whisper-models"
set "TEMP=%REPO_CACHE_ROOT%\tmp"
set "TMP=%REPO_CACHE_ROOT%\tmp"

echo [Reel-Saver] Caches and Whisper models pinned to: %~dp0data
if not exist "node_modules" (
  echo [Reel-Saver] Installing Node packages onto %~d0 ...
  call npm install --no-audit --no-fund
)

echo [Reel-Saver] Starting Backend + Web Companion on http://localhost:4000 ...
call npm run dev
