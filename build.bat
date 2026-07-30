@echo off
setlocal
pushd "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [LightTable] Node.js was not found in PATH.
  popd
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [LightTable] npm was not found in PATH.
  popd
  exit /b 1
)

if not exist "node_modules\" (
  echo [LightTable] Installing locked dependencies...
  call npm ci
  if errorlevel 1 goto :failed
)

echo [LightTable] Running boundary checks, typechecking, tests and builds...
set "LIGHTTABLE_PACKAGE_OUT=out-verify"
call npm run verify
if errorlevel 1 goto :failed

echo.
echo [LightTable] Build completed successfully.
echo [LightTable] Web: apps\web\dist
echo [LightTable] Desktop verification package: apps\desktop\out-verify\LightTable-win32-x64
popd
exit /b 0

:failed
echo.
echo [LightTable] Build failed.
popd
exit /b 1
