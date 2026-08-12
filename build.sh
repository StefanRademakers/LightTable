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
  *)
    echo "[LightTable] Unsupported macOS architecture: $desktop_arch"
    exit 1
    ;;
esac

if [ "$(uname -s)" = "Darwin" ]; then
  echo "[LightTable] Creating macOS test release ZIP (${desktop_arch})..."
  LIGHTTABLE_PACKAGE_OUT=out-verify npm run make -w @lighttable/desktop -- \
    --skip-package --platform darwin --arch "$desktop_arch" --targets zip
fi

echo
echo "[LightTable] Build completed successfully."
echo "[LightTable] Web: apps/web/dist"
if [ "$(uname -s)" = "Darwin" ]; then
  echo "[LightTable] Desktop verification package: apps/desktop/out-verify/LightTable-darwin-${desktop_arch}"
  mac_zip="$(find apps/desktop/out-verify/make/zip/darwin/${desktop_arch} -maxdepth 1 -name 'LightTable-*.zip' -print -quit 2>/dev/null || true)"
  if [ -z "$mac_zip" ]; then
    echo "[LightTable] Expected macOS ZIP was not created."
    exit 1
  fi
  echo "[LightTable] macOS test release: $mac_zip"
  if [ -z "${LIGHTTABLE_MAC_SIGN_IDENTITY:-}" ]; then
    echo "[LightTable] Signing: ad-hoc test signature (not notarized)"
    echo "[LightTable] Testers must approve the app once in System Settings > Privacy & Security."
  fi
fi
