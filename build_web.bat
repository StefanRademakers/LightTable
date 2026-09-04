@echo off
setlocal
pushd "%~dp0"
set "LIGHTTABLE_WEB_OUT_DIR=dist-static"

where node >nul 2>nul
if errorlevel 1 (
  echo [LightTable Web] Node.js was not found in PATH.
  goto :failed
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [LightTable Web] npm was not found in PATH.
  goto :failed
)

if not exist "node_modules\" (
  echo [LightTable Web] Installing locked dependencies...
  call npm ci
  if errorlevel 1 goto :failed
)

echo [LightTable Web] Building the static production web app...
call npm run build:web:static
if errorlevel 1 goto :failed

if not exist "apps\web\%LIGHTTABLE_WEB_OUT_DIR%\index.html" (
  echo [LightTable Web] Build completed without producing apps\web\%LIGHTTABLE_WEB_OUT_DIR%\index.html.
  goto :failed
)

echo.
echo [LightTable Web] Build completed successfully.
echo [LightTable Web] Output: %~dp0apps\web\%LIGHTTABLE_WEB_OUT_DIR%
start "" explorer.exe "%~dp0apps\web\%LIGHTTABLE_WEB_OUT_DIR%"

popd
exit /b 0

:failed
echo.
echo [LightTable Web] Build failed. The output folder was not opened.
popd
exit /b 1
