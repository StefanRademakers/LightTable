#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "[LightTable UI] Pulling the latest changes..."
git pull --ff-only

echo "[LightTable UI] Starting the component demo with live reload..."
echo "[LightTable UI] Open http://127.0.0.1:5178/"

exec npm run dev:ui
