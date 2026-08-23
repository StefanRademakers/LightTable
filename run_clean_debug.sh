#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "[LightTable] Removing generated desktop and Vite caches..."
if ! ./scripts/clean-dev.sh; then
  echo
  echo "[LightTable] Clean failed. Close any running LightTable dev window and try again."
  exit 1
fi

echo
echo "[LightTable] Starting clean debug development..."
echo "[LightTable] UI devtools, detailed vector profiling, Vite HMR and React development checks are enabled."
echo

npm run dev:desktop:debug
