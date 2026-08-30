@echo off
setlocal

cd /d "%~dp0"
title LightTable UI Demo

echo [LightTable UI] Starting the component demo with live reload...
echo [LightTable UI] Open http://127.0.0.1:5178/
echo.

call npm run dev:ui
set "LIGHTTABLE_EXIT_CODE=%ERRORLEVEL%"

if not "%LIGHTTABLE_EXIT_CODE%"=="0" (
  echo.
  echo [LightTable UI] Demo stopped with exit code %LIGHTTABLE_EXIT_CODE%.
  echo [LightTable UI] Press any key to close this window.
  pause >nul
)

exit /b %LIGHTTABLE_EXIT_CODE%
