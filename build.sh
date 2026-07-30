#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v node >/dev/null 2>&1; then
  echo "[LightTable] Node.js was not found in PATH."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[LightTable] npm was not found in PATH."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "[LightTable] Installing locked dependencies..."
  npm ci
fi

echo "[LightTable] Running boundary checks, typechecking, tests and builds..."
LIGHTTABLE_PACKAGE_OUT=out-verify npm run verify

desktop_arch="$(uname -m)"
case "$desktop_arch" in
  x86_64) desktop_arch="x64" ;;
  arm64|aarch64) desktop_arch="arm64" ;;
esac

echo
echo "[LightTable] Build completed successfully."
echo "[LightTable] Web: apps/web/dist"
echo "[LightTable] Desktop verification package: apps/desktop/out-verify/LightTable-darwin-${desktop_arch}"
