#!/bin/sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IOS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT="${IOS_ROOT}/ShiziApp.xcodeproj"
SCHEME="${SCHEME:-Shizi}"
CONFIGURATION="${CONFIGURATION:-Debug}"
BUILD_DIR="${BUILD_DIR:-${IOS_ROOT}/build/device}"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-${BUILD_DIR}/DerivedData}"
DESTINATION="${DESTINATION:-generic/platform=iOS}"
SIGNING_XCCONFIG="${SIGNING_XCCONFIG:-}"

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

DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:-$(read_xcconfig_value DEVELOPMENT_TEAM "$SIGNING_XCCONFIG")}"
BUNDLE_ID="${BUNDLE_ID:-$(read_xcconfig_value PRODUCT_BUNDLE_IDENTIFIER "$SIGNING_XCCONFIG")}"
APP_ID="${APP_ID:-${BUNDLE_ID:-com.eimaa.shizi}}"

if [ -z "$DEVELOPMENT_TEAM" ]; then
  echo "Set DEVELOPMENT_TEAM to your Apple Developer Team ID." >&2
  echo "Example: DEVELOPMENT_TEAM=ABCDE12345 DEVICE_ID='<device uuid or name>' $0" >&2
  echo "Or pass SIGNING_XCCONFIG=ios/ShiziApp/Config/Signing.local.xcconfig." >&2
  exit 64
fi

if [ -z "${DEVICE_ID:-}" ]; then
  echo "Set DEVICE_ID to a paired device UUID, UDID, serial number, or name." >&2
  echo "Available devices:" >&2
  xcrun devicectl list devices >&2 || true
  exit 64
fi

mkdir -p "$BUILD_DIR"

echo "Building ${SCHEME} for device (${DESTINATION})"
if [ -n "${BUNDLE_ID:-}" ]; then
  run_xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination "$DESTINATION" \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
    PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
    -allowProvisioningUpdates \
    -allowProvisioningDeviceRegistration \
    build
else
  run_xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination "$DESTINATION" \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
    -allowProvisioningUpdates \
    -allowProvisioningDeviceRegistration \
    build
fi

APP="$(find "$DERIVED_DATA_PATH/Build/Products/${CONFIGURATION}-iphoneos" -maxdepth 1 -name 'Shizi.app' -type d | head -1)"
test -d "$APP" || { echo "Device app not found under DerivedData" >&2; exit 66; }

"${SCRIPT_DIR}/verify-bundle-assets.sh" "$APP"

echo "Installing ${APP_ID} on ${DEVICE_ID}"
xcrun devicectl device install app --device "$DEVICE_ID" "$APP"

if [ "${SKIP_LAUNCH:-0}" = "1" ]; then
  echo "Installed ${APP_ID}; launch skipped by SKIP_LAUNCH=1."
  exit 0
fi

echo "Launching ${APP_ID}"
if [ "${DEV_MODE:-0}" = "1" ] && [ "${SMOKE_MODE:-0}" = "1" ]; then
  xcrun devicectl device process launch --device "$DEVICE_ID" --terminate-existing "$APP_ID" -shizi-dev -shizi-smoke
elif [ "${DEV_MODE:-0}" = "1" ]; then
  xcrun devicectl device process launch --device "$DEVICE_ID" --terminate-existing "$APP_ID" -shizi-dev
elif [ "${SMOKE_MODE:-0}" = "1" ]; then
  xcrun devicectl device process launch --device "$DEVICE_ID" --terminate-existing "$APP_ID" -shizi-smoke
else
  xcrun devicectl device process launch --device "$DEVICE_ID" --terminate-existing "$APP_ID"
fi

echo "Done. Continue manual iPhone handwriting and keyboard/safe-area checks on the device."
