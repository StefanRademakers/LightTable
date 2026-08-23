#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "[LightTable] Starting desktop development with the hybrid vector renderer and live reload..."
echo "[LightTable] Repository: $(pwd)"
echo

npm run dev:desktop
