#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

fail() {
  echo "[LightTable] $*" >&2
  exit 1
}

# shellcheck source=scripts/macos-signing-validation.sh
source "scripts/macos-signing-validation.sh"

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

app_path="apps/desktop/out-local-release/LightTable-darwin-${desktop_arch}/LightTable.app"
app_executable="$(pwd)/${app_path}/Contents/MacOS/LightTable"
if [ -x "$app_executable" ] && pgrep -f "^${app_executable}([[:space:]]|$)" >/dev/null 2>&1; then
  echo "[LightTable] The production package is still running from $app_path." >&2
  echo "[LightTable] Close that LightTable window before rebuilding; macOS may lock or retain the package." >&2
  echo "[LightTable] The build did not start, so no generated package was changed." >&2
  exit 1
fi

echo "[LightTable] Building an optimized production package with the hybrid vector renderer..."
LIGHTTABLE_PACKAGE_OUT=out-local-release npm run package:desktop

if [ ! -d "$app_path" ]; then
  echo "[LightTable] Packaged application was not found: $app_path" >&2
  exit 1
fi

command -v codesign >/dev/null 2>&1 || fail "codesign was not found."
if [ -n "${LIGHTTABLE_MAC_SIGN_IDENTITY:-}" ]; then
  app_details="$(signature_details "$app_path")" || fail "Could not inspect the packaged app signature."
  signing_team="$(signature_field "$app_details" "TeamIdentifier")"
  [ -n "$signing_team" ] && [ "$signing_team" != "not set" ] \
    || fail "Developer ID build has no TeamIdentifier."
  validate_macos_app "$app_path" "developer-id" "$signing_team"
else
  validate_macos_app "$app_path" "adhoc" ""
fi

echo "[LightTable] Starting the optimized production build..."
open "$app_path"
