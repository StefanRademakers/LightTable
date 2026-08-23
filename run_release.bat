@echo off
setlocal

cd /d "%~dp0"
title LightTable Desktop Production

where node >nul 2>nul
if errorlevel 1 (
  echo [LightTable] Node.js was not found in PATH.
  exit /b 1
)

set "LIGHTTABLE_PACKAGE_OUT=out-local-release"
set "LIGHTTABLE_RELEASE_EXE=%~dp0apps\desktop\out-local-release\LightTable-win32-x64\LightTable.exe"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\assert-packaged-app-idle.ps1" -ExecutablePath "%LIGHTTABLE_RELEASE_EXE%"
if errorlevel 1 exit /b 1

echo [LightTable] Building an optimized production package with the hybrid vector renderer...
call npm run package:desktop
if errorlevel 1 (
  echo.
  echo [LightTable] Production package failed.
  exit /b 1
)

if not exist "%LIGHTTABLE_RELEASE_EXE%" (
  echo [LightTable] Packaged executable was not found: %LIGHTTABLE_RELEASE_EXE%
  exit /b 1
)

echo [LightTable] Starting the optimized production build...
start "" "%LIGHTTABLE_RELEASE_EXE%"
exit /b 0
