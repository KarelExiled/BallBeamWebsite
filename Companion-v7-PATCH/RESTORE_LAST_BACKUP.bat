@echo off
setlocal enabledelayedexpansion
title Restore Companion backup
set "APP=C:\AI\Companion\app"
set "LATEST="
for /f "delims=" %%D in ('dir /b /ad /o-d "%APP%\_backup_before_v7_*" 2^>nul') do (
  if not defined LATEST set "LATEST=%%D"
)
if not defined LATEST (
  echo No v7 backup folder was found.
  pause
  exit /b 1
)
echo Restoring %LATEST% ...
xcopy "%APP%\%LATEST%\*" "%APP%\" /E /I /Y >nul
del /q "%APP%\src\main\phoneServer.ts" 2>nul
del /q "%APP%\src\renderer\src\v7Overlay.ts" 2>nul
echo.
echo Restore completed. If src\renderer\index.html still contains v7Overlay.ts, use the backed-up copy in %LATEST%.
echo.
pause
