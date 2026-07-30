@echo off
setlocal

cd /d "%~dp0"
title LightTable Desktop Clean Dev

echo [LightTable] Removing generated desktop and Vite caches...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\clean-dev.ps1"
if errorlevel 1 (
  echo.
  echo [LightTable] Clean failed. Close any running LightTable dev window and try again.
  echo [LightTable] Press any key to close this window.
  pause >nul
  exit /b 1
)

echo.
echo [LightTable] Starting a fresh desktop development build...
echo.

call npm run dev:desktop
set "LIGHTTABLE_EXIT_CODE=%ERRORLEVEL%"

if not "%LIGHTTABLE_EXIT_CODE%"=="0" (
  echo.
  echo [LightTable] Desktop development stopped with exit code %LIGHTTABLE_EXIT_CODE%.
  echo [LightTable] Press any key to close this window.
  pause >nul
)

exit /b %LIGHTTABLE_EXIT_CODE%
