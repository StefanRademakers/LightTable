#!/usr/bin/env bash

# Shared by build.sh and run_release.sh. The caller must define fail().

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
  local details signature team flags

  details="$(signature_details "$target")" || fail "Could not inspect the signature for: $target"
  signature="$(signature_field "$details" "Signature")"
  team="$(signature_field "$details" "TeamIdentifier")"
  flags="$(printf '%s\n' "$details" | sed -n 's/^CodeDirectory.*flags=[^()]*(\([^)]*\)).*/\1/p' | head -n 1)"

  [ -n "$team" ] || fail "No TeamIdentifier was reported for: $target"

  if [ "$expected_kind" = "adhoc" ]; then
    [ "$signature" = "adhoc" ] || fail "Mixed macOS signing: expected an ad-hoc signature for $target, found '$signature'."
    [ "$team" = "not set" ] || fail "Mixed macOS signing: expected TeamIdentifier=not set for $target, found '$team'."
    case ",$flags," in
      *,runtime,*) fail "Unsafe local macOS signing: ad-hoc target has Hardened Runtime enabled: $target" ;;
    esac
  else
    [ "$signature" != "adhoc" ] \
      || fail "Mixed macOS signing: expected a Developer ID signature for $target, found ad-hoc."
    [ "$team" = "$expected_team" ] || fail "Mixed macOS signing: expected TeamIdentifier=$expected_team for $target, found '$team'."
    case ",$flags," in
      *,runtime,*) ;;
      *) fail "Developer ID target is missing the Hardened Runtime flag: $target" ;;
    esac
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

  validate_signature_target "$app_path" "$expected_kind" "$expected_team"
  validate_signature_target "$electron_framework" "$expected_kind" "$expected_team"

  while IFS= read -r -d '' target; do
    validate_signature_target "$target" "$expected_kind" "$expected_team"
  done < <(find "$frameworks_path" \
    \( -type d \( -name '*.app' -o -name '*.framework' -o -name '*.xpc' \) \
       -o -type f -name '*.dylib' \) \
    -print0)
}
