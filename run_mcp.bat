@echo off
setlocal

cd /d "%~dp0"
title LightTable MCP Development Launcher

set "MCP_TESTER=%~dp0..\LightTableMCPTester\Start-LightTable-MCP-Tester.bat"
if not exist "%MCP_TESTER%" (
  echo [LightTable] MCP tester launcher was not found: %MCP_TESTER%
  exit /b 1
)
if /I "%~1"=="--check" (
  call "%MCP_TESTER%" --check
  exit /b %ERRORLEVEL%
)
set "LIGHTTABLE_MCP_DESKTOP_ONLY=0"
if /I "%~1"=="--desktop-only" set "LIGHTTABLE_MCP_DESKTOP_ONLY=1"

echo [LightTable] Stopping the old dev session and clearing generated caches...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\clean-dev.ps1"
if errorlevel 1 (
  echo [LightTable] Clean failed. Close locked LightTable development processes and retry.
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\assert-local-mcp-ports-free.ps1"
if errorlevel 1 (
  echo [LightTable] Port 8787 or 8788 is already in use.
  echo [LightTable] Close another packaged LightTable/MCP instance and run this launcher again.
  exit /b 1
)

echo [LightTable] Starting a fresh MCP-enabled desktop development build...
start "LightTable MCP Desktop" cmd.exe /d /k "cd /d ""%~dp0"" && set LIGHTTABLE_AUTO_START_LOCAL_MCP=1&& npm run dev:desktop"

echo [LightTable] Waiting for the embedded MCP endpoint...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wait-local-mcp.ps1" -TimeoutSeconds 90
if errorlevel 1 (
  echo [LightTable] MCP startup failed. Inspect the LightTable MCP Desktop terminal.
  exit /b 1
)

if "%LIGHTTABLE_MCP_DESKTOP_ONLY%"=="1" (
  echo [LightTable] MCP desktop is ready. Tester launch was skipped.
  exit /b 0
)

echo [LightTable] Opening the pre-approved LightTable MCP Tester session...
call "%MCP_TESTER%"
exit /b %ERRORLEVEL%
