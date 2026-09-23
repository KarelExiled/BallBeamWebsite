@echo off
setlocal
title Companion v7 Update
set "APP=C:\AI\Companion\app"

if not exist "%APP%\package.json" (
  echo ERROR: Companion was not found at %APP%
  echo.
  pause
  exit /b 1
)

cd /d "%APP%"
echo ==========================================
echo     Companion v7 cumulative update
echo ==========================================
echo.
echo Close Companion before continuing.
echo Updating the existing app in:
echo %APP%
echo.

node "%~dp0APPLY_COMPANION_V7.mjs"
if errorlevel 1 (
  echo.
  echo UPDATE FAILED. The updater restored changed files automatically.
  pause
  exit /b 1
)

echo.
echo Checking TypeScript...
call npm.cmd run typecheck
if errorlevel 1 (
  echo.
  echo TYPECHECK FAILED.
  echo Your backup folder is inside C:\AI\Companion\app and starts with _backup_before_v7_
  echo Run RESTORE_LAST_BACKUP.bat from this update package to undo v7.
  pause
  exit /b 1
)

echo.
echo ==========================================
echo Companion v7 installed successfully.
echo ==========================================
echo.
echo Start normally with:
echo C:\AI\Companion\app\START_COMPANION.bat
echo.
echo Phone details will be written to:
echo C:\AI\Companion\app\PHONE_ACCESS.txt
echo.
pause
