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

require_value() {
  local name="$1"
  [ -n "${!name:-}" ] || fail "macOS notarization requires $name."
}

signature_details() {
  codesign --display --verbose=4 "$1" 2>&1
}

signature_field() {
  local details="$1"
  local field="$2"
  printf '%s\n' "$details" | sed -n "s/^${field}=//p" | head -n 1
}

validate_signature_target() {
  local target="$1"
  local expected_kind="$2"
  local expected_team="$3"
  local details signature team

  details="$(signature_details "$target")" || fail "Could not inspect the signature for: $target"
  signature="$(signature_field "$details" "Signature")"
  team="$(signature_field "$details" "TeamIdentifier")"

  [ -n "$team" ] || fail "No TeamIdentifier was reported for: $target"

  if [ "$expected_kind" = "adhoc" ]; then
    [ "$signature" = "adhoc" ] || fail "Mixed macOS signing: expected an ad-hoc signature for $target, found '$signature'."
    [ "$team" = "not set" ] || fail "Mixed macOS signing: expected TeamIdentifier=not set for $target, found '$team'."
  else
    [ "$signature" != "adhoc" ] \
      || fail "Mixed macOS signing: expected a Developer ID signature for $target, found ad-hoc."
    [ "$team" = "$expected_team" ] || fail "Mixed macOS signing: expected TeamIdentifier=$expected_team for $target, found '$team'."
  fi
}

validate_macos_app() {
  local app_path="$1"
  local expected_kind="$2"
  local expected_team="${3:-}"
  local frameworks_path="$app_path/Contents/Frameworks"
  local electron_framework="$frameworks_path/Electron Framework.framework/Versions/A/Electron Framework"
  local target

  [ -d "$app_path" ] || fail "Expected packaged macOS app was not found: $app_path"
  [ -f "$electron_framework" ] || fail "Electron Framework executable was not found: $electron_framework"

  echo "[LightTable] Validating macOS code signing: $app_path"
  codesign --verify --deep --strict --verbose=2 "$app_path" \
    || fail "macOS code-signing verification failed for: $app_path"

  # Validate the main bundle and the framework binary explicitly. The latter
  # is the dyld-loaded image that exposed mixed Team IDs in private test ZIPs.
  validate_signature_target "$app_path" "$expected_kind" "$expected_team"
  validate_signature_target "$electron_framework" "$expected_kind" "$expected_team"

  # A deep validity check alone permits consistently valid but differently
  # identified nested code. Check every helper/framework/dylib as well so a
  # mixed Team ID can never reach the release ZIP.
  while IFS= read -r -d '' target; do
    validate_signature_target "$target" "$expected_kind" "$expected_team"
  done < <(find "$frameworks_path" \
    \( -type d \( -name '*.app' -o -name '*.framework' -o -name '*.xpc' \) \
       -o -type f -name '*.dylib' \) \
    -print0)
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
