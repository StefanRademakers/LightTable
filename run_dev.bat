@echo off
setlocal

cd /d "%~dp0"
title LightTable Desktop Dev

echo [LightTable] Starting desktop development with live reload...
echo [LightTable] Repository: %CD%
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
