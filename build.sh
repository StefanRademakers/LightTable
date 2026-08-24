#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

build_kind="release"
build_out="out-release"
case "${1:-}" in
  "") ;;
  debug)
    build_kind="debug"
    build_out="out-debug"
    ;;
  *)
    echo "Usage: ./build.sh [debug]" >&2
    exit 2
    ;;
esac

fail() {
  echo "[LightTable] $*" >&2
  exit 1
}

# shellcheck source=scripts/macos-signing-validation.sh
source "scripts/macos-signing-validation.sh"

require_value() {
  local name="$1"
  [ -n "${!name:-}" ] || fail "macOS notarization requires $name."
}

command -v node >/dev/null 2>&1 || fail "Node.js was not found in PATH."

command -v npm >/dev/null 2>&1 || fail "npm was not found in PATH."

if [ "$(uname -s)" = "Darwin" ] && [ "${LIGHTTABLE_MAC_NOTARIZE:-false}" = "true" ]; then
  require_value LIGHTTABLE_MAC_SIGN_IDENTITY
  require_value APPLE_ID
  require_value APPLE_APP_PASSWORD
  require_value APPLE_TEAM_ID
fi

if [ ! -d "node_modules" ]; then
  echo "[LightTable] Installing locked dependencies..."
  npm ci
fi

echo "[LightTable] Running boundary checks, typechecking, tests and hybrid-renderer builds..."
LIGHTTABLE_PACKAGE_OUT=out-verify npm run verify

if [ "$build_kind" = "debug" ]; then
  echo "[LightTable] Creating an unminified debug package with source maps and diagnostics..."
  LIGHTTABLE_PACKAGE_OUT="$build_out" npm run package:desktop:debug
  node scripts/verify-ui-devtools-boundary.mjs --desktop --present
else
  echo "[LightTable] Creating a clean optimized package without runtime diagnostics..."
  LIGHTTABLE_PACKAGE_OUT="$build_out" npm run package:desktop
  node scripts/verify-ui-devtools-boundary.mjs --desktop --absent
fi

if [ "$(uname -s)" = "Darwin" ]; then
  command -v codesign >/dev/null 2>&1 || fail "codesign was not found."
  command -v ditto >/dev/null 2>&1 || fail "ditto was not found."

  desktop_arch="$(uname -m)"
  case "$desktop_arch" in
    x86_64) desktop_arch="x64" ;;
    arm64|aarch64) desktop_arch="arm64" ;;
    *) fail "Unsupported macOS architecture: $desktop_arch" ;;
  esac

  app_path="apps/desktop/${build_out}/LightTable-darwin-${desktop_arch}/LightTable.app"
  release_version="$(node -p "require('./apps/desktop/package.json').version")"
  maker_zip_dir="apps/desktop/${build_out}/make/zip/darwin/${desktop_arch}"
  mac_zip="$maker_zip_dir/LightTable-darwin-${desktop_arch}-${release_version}.zip"

  if [ -n "${LIGHTTABLE_MAC_SIGN_IDENTITY:-}" ]; then
    signing_kind="developer-id"
    app_details="$(signature_details "$app_path")" || fail "Could not inspect the packaged app signature."
    signing_team="$(signature_field "$app_details" "TeamIdentifier")"
    [ -n "$signing_team" ] && [ "$signing_team" != "not set" ] \
      || fail "Developer ID build has no TeamIdentifier."
    if [ -n "${APPLE_TEAM_ID:-}" ] && [ "$signing_team" != "$APPLE_TEAM_ID" ]; then
      fail "Packaged app TeamIdentifier '$signing_team' does not match APPLE_TEAM_ID '$APPLE_TEAM_ID'."
    fi
  else
    signing_kind="adhoc"
    signing_team=""
  fi

  validate_macos_app "$app_path" "$signing_kind" "$signing_team"

  echo "[LightTable] Creating macOS ZIP from the verified desktop package..."
  LIGHTTABLE_PACKAGE_OUT="$build_out" npm run make --workspace @lighttable/desktop -- --skip-package
  [ -f "$mac_zip" ] || fail "macOS maker completed without producing: $mac_zip"

  extract_dir="$(mktemp -d "${TMPDIR:-/tmp}/lighttable-verify.XXXXXX")"
  cleanup_release_temp() {
    case "$(basename "$extract_dir")" in
      lighttable-verify.*)
        [ -d "$extract_dir" ] && rm -rf -- "$extract_dir"
        ;;
      *)
        echo "[LightTable] Refusing to remove unexpected temporary path: $extract_dir" >&2
        ;;
    esac
  }
  trap cleanup_release_temp EXIT

  ditto -x -k "$mac_zip" "$extract_dir" \
    || fail "Could not extract the macOS release ZIP for verification."
  validate_macos_app "$extract_dir/LightTable.app" "$signing_kind" "$signing_team"

  if [ "$signing_kind" = "adhoc" ]; then
    signing_summary="ad-hoc private test build (not notarized)"
  elif [ "${LIGHTTABLE_MAC_NOTARIZE:-false}" = "true" ]; then
    signing_summary="Developer ID signed and notarized"
  else
    signing_summary="Developer ID signed (not notarized)"
  fi
fi

echo
echo "[LightTable] Build completed successfully."
echo "[LightTable] Profile: $build_kind"
echo "[LightTable] Web: apps/web/dist"
if [ "$(uname -s)" = "Darwin" ]; then
  echo "[LightTable] Desktop verification package: apps/desktop/${build_out}/LightTable-darwin-${desktop_arch}"
  echo "[LightTable] Signing: $signing_summary"
  echo "[LightTable] macOS test release: $mac_zip"
fi
