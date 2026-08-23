#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "[LightTable] run_release.sh currently targets macOS." >&2
  exit 1
fi

command -v node >/dev/null 2>&1 || {
  echo "[LightTable] Node.js was not found in PATH." >&2
  exit 1
}
command -v npm >/dev/null 2>&1 || {
  echo "[LightTable] npm was not found in PATH." >&2
  exit 1
}

case "$(uname -m)" in
  x86_64) desktop_arch="x64" ;;
  arm64|aarch64) desktop_arch="arm64" ;;
  *)
    echo "[LightTable] Unsupported macOS architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

echo "[LightTable] Building an optimized production package with the hybrid vector renderer..."
LIGHTTABLE_PACKAGE_OUT=out-local-release npm run package:desktop

app_path="apps/desktop/out-local-release/LightTable-darwin-${desktop_arch}/LightTable.app"
if [ ! -d "$app_path" ]; then
  echo "[LightTable] Packaged application was not found: $app_path" >&2
  exit 1
fi

echo "[LightTable] Starting the optimized production build..."
open "$app_path"
