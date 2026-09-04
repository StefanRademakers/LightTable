@echo off
setlocal
pushd "%~dp0"

set "LIGHTTABLE_BUILD_KIND=release"
set "LIGHTTABLE_BUILD_OUT=out-release"
set "LIGHTTABLE_WEB_OUT_DIR=dist-release"
if /I "%~1"=="debug" (
  set "LIGHTTABLE_BUILD_KIND=debug"
  set "LIGHTTABLE_BUILD_OUT=out-debug"
  set "LIGHTTABLE_WEB_OUT_DIR=dist-debug"
)

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

echo [LightTable] Running boundary checks, typechecking, tests and hybrid-renderer builds...
set "LIGHTTABLE_PACKAGE_OUT=out-verify"
call npm run verify
if errorlevel 1 goto :failed

if /I "%LIGHTTABLE_BUILD_KIND%"=="debug" (
  echo [LightTable] Creating an unminified debug package with source maps and diagnostics...
  set "LIGHTTABLE_PACKAGE_OUT=out-debug"
  call npm run package:desktop:debug
  if errorlevel 1 goto :failed
  call node scripts\verify-ui-devtools-boundary.mjs --desktop --present
  if errorlevel 1 goto :failed
) else (
  echo [LightTable] Creating an optimized package with the temporary UI Style Guide...
  set "LIGHTTABLE_PACKAGE_OUT=out-release"
  call npm run package:desktop
  if errorlevel 1 goto :failed
  call node scripts\verify-ui-devtools-boundary.mjs --desktop --present
  if errorlevel 1 goto :failed
)

echo [LightTable] Creating Windows installer from the verified desktop package...
call npm run make --workspace @lighttable/desktop -- --skip-package
if errorlevel 1 goto :failed

if not exist "apps\desktop\%LIGHTTABLE_BUILD_OUT%\make\squirrel.windows\x64\*Setup.exe" (
  echo [LightTable] Installer build completed without producing Setup.exe.
  goto :failed
)

echo.
echo [LightTable] Build completed successfully.
echo [LightTable] Profile: %LIGHTTABLE_BUILD_KIND%
echo [LightTable] Web: apps\web\%LIGHTTABLE_WEB_OUT_DIR%
echo [LightTable] Desktop package: apps\desktop\%LIGHTTABLE_BUILD_OUT%\LightTable-win32-x64
for %%I in ("apps\desktop\%LIGHTTABLE_BUILD_OUT%\make\squirrel.windows\x64\*Setup.exe") do (
  echo [LightTable] Windows installer: %%~fI
  start "" explorer.exe /select,"%%~fI"
)
popd
exit /b 0

:failed
echo.
echo [LightTable] Build failed.
popd
exit /b 1
