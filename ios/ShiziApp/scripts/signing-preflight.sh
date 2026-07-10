#!/bin/sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IOS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT="${IOS_ROOT}/ShiziApp.xcodeproj"
SCHEME="${SCHEME:-Shizi}"
CONFIGURATION="${CONFIGURATION:-Release}"
SIGNING_XCCONFIG="${SIGNING_XCCONFIG:-}"
PREFLIGHT_MODE="${PREFLIGHT_MODE:-device}"
DEFAULT_BUNDLE_ID="com.eimaa.shizi"
PROFILE_DIR="${HOME}/Library/MobileDevice/Provisioning Profiles"

failures=0
warnings=0

ok() {
  printf 'OK: %s\n' "$*"
}

warn() {
  warnings=$((warnings + 1))
  printf 'WARN: %s\n' "$*" >&2
}

fail() {
  failures=$((failures + 1))
  printf 'FAIL: %s\n' "$*" >&2
}

read_xcconfig_value() {
  key="$1"
  file="$2"
  if [ -z "$file" ] || [ ! -f "$file" ]; then
    return 0
  fi
  awk -F= -v key="$key" '
    $1 ~ "^[[:space:]]*" key "[[:space:]]*$" {
      value=$2
      sub(/[[:space:]]*\/\/.*/, "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      print value
      exit
    }
  ' "$file"
}

run_xcodebuild() {
  if [ -n "$SIGNING_XCCONFIG" ]; then
    xcodebuild -xcconfig "$SIGNING_XCCONFIG" "$@"
  else
    xcodebuild "$@"
  fi
}

bundle_matches_profile() {
  app_identifier="$1"
  case "$app_identifier" in
    "${DEVELOPMENT_TEAM}.${BUNDLE_ID}")
      return 0
      ;;
    "${DEVELOPMENT_TEAM}."*)
      suffix="${app_identifier#${DEVELOPMENT_TEAM}.}"
      ;;
    *)
      return 1
      ;;
  esac

  if [ "$suffix" = "*" ]; then
    return 0
  fi

  case "$suffix" in
    *'*')
      prefix="${suffix%\*}"
      case "$BUNDLE_ID" in
        "$prefix"*) return 0 ;;
      esac
      ;;
  esac

  return 1
}

case "$PREFLIGHT_MODE" in
  device|testflight|signing)
    ;;
  *)
    fail "PREFLIGHT_MODE must be device, testflight, or signing."
    ;;
esac

if [ -n "$SIGNING_XCCONFIG" ] && [ ! -f "$SIGNING_XCCONFIG" ]; then
  fail "SIGNING_XCCONFIG does not exist: ${SIGNING_XCCONFIG}"
fi

DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:-$(read_xcconfig_value DEVELOPMENT_TEAM "$SIGNING_XCCONFIG")}"
BUNDLE_ID="${BUNDLE_ID:-$(read_xcconfig_value PRODUCT_BUNDLE_IDENTIFIER "$SIGNING_XCCONFIG")}"
BUNDLE_ID="${BUNDLE_ID:-$DEFAULT_BUNDLE_ID}"

if [ -z "$DEVELOPMENT_TEAM" ]; then
  fail "Set DEVELOPMENT_TEAM or provide SIGNING_XCCONFIG with DEVELOPMENT_TEAM."
else
  ok "Development team set to ${DEVELOPMENT_TEAM}"
fi

ok "Bundle identifier set to ${BUNDLE_ID}"

if [ ! -d "$PROJECT" ]; then
  fail "Xcode project not found: ${PROJECT}"
else
  ok "Xcode project found"
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  fail "xcodebuild is not available. Install Xcode and select it with xcode-select."
else
  ok "$(xcodebuild -version | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
fi

if ! command -v security >/dev/null 2>&1; then
  fail "security command is not available."
fi

if [ -n "${AUTHENTICATION_KEY_PATH:-}" ] || [ -n "${AUTHENTICATION_KEY_ID:-}" ] || [ -n "${AUTHENTICATION_KEY_ISSUER_ID:-}" ]; then
  if [ -z "${AUTHENTICATION_KEY_PATH:-}" ] || [ -z "${AUTHENTICATION_KEY_ID:-}" ] || [ -z "${AUTHENTICATION_KEY_ISSUER_ID:-}" ]; then
    fail "AUTHENTICATION_KEY_PATH, AUTHENTICATION_KEY_ID, and AUTHENTICATION_KEY_ISSUER_ID must be provided together."
  elif [ ! -f "$AUTHENTICATION_KEY_PATH" ]; then
    fail "AUTHENTICATION_KEY_PATH does not exist: ${AUTHENTICATION_KEY_PATH}"
  else
    ok "App Store Connect API key inputs are complete"
  fi
elif [ "$PREFLIGHT_MODE" = "testflight" ]; then
  warn "No App Store Connect API key provided; upload/export will rely on an Xcode account already signed in on this Mac."
fi

if [ -n "${DEVELOPMENT_TEAM:-}" ] && command -v security >/dev/null 2>&1; then
  identities="$(security find-identity -v -p codesigning 2>/dev/null || true)"
  if printf '%s\n' "$identities" | grep -F "Apple Development:" | grep -F "(${DEVELOPMENT_TEAM})" >/dev/null 2>&1; then
    ok "Apple Development signing identity found for ${DEVELOPMENT_TEAM}"
  elif [ "$PREFLIGHT_MODE" = "device" ]; then
    fail "No Apple Development signing identity found for ${DEVELOPMENT_TEAM}."
  else
    warn "No Apple Development signing identity found for ${DEVELOPMENT_TEAM}."
  fi

  if printf '%s\n' "$identities" | grep -F "Apple Distribution:" | grep -F "(${DEVELOPMENT_TEAM})" >/dev/null 2>&1; then
    ok "Apple Distribution signing identity found for ${DEVELOPMENT_TEAM}"
  elif [ "$PREFLIGHT_MODE" = "testflight" ]; then
    warn "No Apple Distribution signing identity found for ${DEVELOPMENT_TEAM}; Xcode may create or fetch signing assets if the account has permission."
  fi
fi

profile_count=0
matching_profiles=0
device_profiles=0
app_store_profiles=0

if [ -d "$PROFILE_DIR" ]; then
  profile_count="$(find "$PROFILE_DIR" -maxdepth 1 -name '*.mobileprovision' -type f | wc -l | tr -d '[:space:]')"
  if [ "$profile_count" != "0" ] && [ -n "${DEVELOPMENT_TEAM:-}" ]; then
    for profile in "$PROFILE_DIR"/*.mobileprovision; do
      [ -f "$profile" ] || continue
      decoded="$(mktemp "${TMPDIR:-/tmp}/shizi-profile.XXXXXX")"
      if security cms -D -i "$profile" >"$decoded" 2>/dev/null; then
        team_id="$(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' "$decoded" 2>/dev/null || true)"
        app_identifier="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$decoded" 2>/dev/null || true)"
        if [ "$team_id" = "$DEVELOPMENT_TEAM" ] && bundle_matches_profile "$app_identifier"; then
          matching_profiles=$((matching_profiles + 1))
          if /usr/libexec/PlistBuddy -c 'Print :ProvisionedDevices:0' "$decoded" >/dev/null 2>&1; then
            device_profiles=$((device_profiles + 1))
          else
            app_store_profiles=$((app_store_profiles + 1))
          fi
        fi
      fi
      rm -f "$decoded"
    done
  fi
fi

if [ "$profile_count" = "0" ]; then
  if [ "$PREFLIGHT_MODE" = "device" ]; then
    fail "No local provisioning profiles found. Open Xcode with the selected team or allow automatic provisioning to create one."
  else
    warn "No local provisioning profiles found. Xcode can fetch/create them only if the account or API key has permission."
  fi
else
  ok "Found ${profile_count} local provisioning profile(s)"
  if [ "$matching_profiles" = "0" ]; then
    if [ "$PREFLIGHT_MODE" = "device" ]; then
      fail "No local provisioning profile matches team ${DEVELOPMENT_TEAM} and bundle ${BUNDLE_ID}."
    else
      warn "No local provisioning profile matches team ${DEVELOPMENT_TEAM} and bundle ${BUNDLE_ID}."
    fi
  else
    ok "Found ${matching_profiles} matching profile(s) for ${BUNDLE_ID}"
  fi

  if [ "$PREFLIGHT_MODE" = "device" ] && [ "$device_profiles" = "0" ]; then
    fail "No matching development/ad-hoc profile with provisioned devices was found."
  elif [ "$PREFLIGHT_MODE" = "testflight" ] && [ "$app_store_profiles" = "0" ]; then
    warn "No matching App Store profile found locally; archive export may need Xcode automatic provisioning."
  fi
fi

if [ "$PREFLIGHT_MODE" = "device" ]; then
  if [ -z "${DEVICE_ID:-}" ]; then
    fail "Set DEVICE_ID to a paired iPhone name, UUID, UDID, or serial number."
    xcrun devicectl list devices >&2 || true
  else
    devices="$(xcrun devicectl list devices 2>/dev/null || true)"
    device_line="$(printf '%s\n' "$devices" | grep -F "$DEVICE_ID" | head -1 || true)"
    if [ -z "$device_line" ]; then
      fail "DEVICE_ID was not found by devicectl: ${DEVICE_ID}"
    elif printf '%s\n' "$device_line" | grep -qi 'unavailable'; then
      fail "Device is listed but unavailable: ${device_line}"
    else
      ok "Device is available: ${device_line}"
    fi
  fi
fi

if [ -n "${DEVELOPMENT_TEAM:-}" ] && command -v xcodebuild >/dev/null 2>&1 && [ -d "$PROJECT" ]; then
  build_settings_log="$(mktemp "${TMPDIR:-/tmp}/shizi-build-settings.XXXXXX")"
  if run_xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination 'generic/platform=iOS' \
    DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
    PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
    -showBuildSettings >"$build_settings_log" 2>&1; then
    ok "Xcode build settings resolve for ${SCHEME} ${CONFIGURATION}"
  else
    fail "Xcode build settings did not resolve; last lines:"
    tail -40 "$build_settings_log" >&2 || true
  fi
  rm -f "$build_settings_log"
fi

if [ "$failures" -gt 0 ]; then
  printf 'Preflight failed: %s failure(s), %s warning(s).\n' "$failures" "$warnings" >&2
  exit 65
fi

printf 'Preflight OK: %s warning(s).\n' "$warnings"
