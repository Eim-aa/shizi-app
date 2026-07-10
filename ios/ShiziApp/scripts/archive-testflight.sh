#!/bin/sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IOS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT="${IOS_ROOT}/ShiziApp.xcodeproj"
SCHEME="${SCHEME:-Shizi}"
CONFIGURATION="${CONFIGURATION:-Release}"
ARCHIVE_PATH="${ARCHIVE_PATH:-${IOS_ROOT}/build/Shizi.xcarchive}"
EXPORT_PATH="${EXPORT_PATH:-${IOS_ROOT}/build/TestFlight}"
EXPORT_OPTIONS_PLIST="${EXPORT_OPTIONS_PLIST:-${IOS_ROOT}/build/exportOptions.plist}"
EXPORT_METHOD="${EXPORT_METHOD:-app-store-connect}"
EXPORT_DESTINATION="${EXPORT_DESTINATION:-export}"
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

DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:-$(read_xcconfig_value DEVELOPMENT_TEAM "$SIGNING_XCCONFIG")}"
BUNDLE_ID="${BUNDLE_ID:-$(read_xcconfig_value PRODUCT_BUNDLE_IDENTIFIER "$SIGNING_XCCONFIG")}"

if [ -z "$DEVELOPMENT_TEAM" ]; then
  echo "Set DEVELOPMENT_TEAM to your Apple Developer Team ID." >&2
  echo "Example: DEVELOPMENT_TEAM=ABCDE12345 $0" >&2
  echo "Or pass SIGNING_XCCONFIG=ios/ShiziApp/Config/Signing.local.xcconfig." >&2
  exit 64
fi

if [ -n "${AUTHENTICATION_KEY_PATH:-}" ]; then
  if [ -z "${AUTHENTICATION_KEY_ID:-}" ] || [ -z "${AUTHENTICATION_KEY_ISSUER_ID:-}" ]; then
    echo "AUTHENTICATION_KEY_ID and AUTHENTICATION_KEY_ISSUER_ID are required with AUTHENTICATION_KEY_PATH." >&2
    exit 64
  fi
fi

run_xcodebuild() {
  if [ -n "${AUTHENTICATION_KEY_PATH:-}" ]; then
    if [ -n "$SIGNING_XCCONFIG" ]; then
      xcodebuild -xcconfig "$SIGNING_XCCONFIG" "$@" \
        -authenticationKeyPath "$AUTHENTICATION_KEY_PATH" \
        -authenticationKeyID "$AUTHENTICATION_KEY_ID" \
        -authenticationKeyIssuerID "$AUTHENTICATION_KEY_ISSUER_ID"
    else
      xcodebuild "$@" \
        -authenticationKeyPath "$AUTHENTICATION_KEY_PATH" \
        -authenticationKeyID "$AUTHENTICATION_KEY_ID" \
        -authenticationKeyIssuerID "$AUTHENTICATION_KEY_ISSUER_ID"
    fi
  else
    if [ -n "$SIGNING_XCCONFIG" ]; then
      xcodebuild -xcconfig "$SIGNING_XCCONFIG" "$@"
    else
      xcodebuild "$@"
    fi
  fi
}

mkdir -p "$(dirname "$ARCHIVE_PATH")" "$EXPORT_PATH" "$(dirname "$EXPORT_OPTIONS_PLIST")"

cat > "$EXPORT_OPTIONS_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>destination</key>
  <string>${EXPORT_DESTINATION}</string>
  <key>method</key>
  <string>${EXPORT_METHOD}</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>teamID</key>
  <string>${DEVELOPMENT_TEAM}</string>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
PLIST

echo "Archiving ${SCHEME} -> ${ARCHIVE_PATH}"
if [ -n "${BUNDLE_ID:-}" ]; then
  run_xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination 'generic/platform=iOS' \
    -archivePath "$ARCHIVE_PATH" \
    DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
    PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
    -allowProvisioningUpdates \
    archive
else
  run_xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination 'generic/platform=iOS' \
    -archivePath "$ARCHIVE_PATH" \
    DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
    -allowProvisioningUpdates \
    archive
fi

if [ -n "${BUNDLE_ID:-}" ]; then
  REQUIRE_SIGNING=1 \
  EXPECTED_TEAM="$DEVELOPMENT_TEAM" \
  EXPECTED_BUNDLE_ID="$BUNDLE_ID" \
  "${SCRIPT_DIR}/verify-archive.sh" "$ARCHIVE_PATH"
else
  REQUIRE_SIGNING=1 \
  EXPECTED_TEAM="$DEVELOPMENT_TEAM" \
  "${SCRIPT_DIR}/verify-archive.sh" "$ARCHIVE_PATH"
fi

if [ "$EXPORT_DESTINATION" = "upload" ]; then
  echo "Uploading archive to App Store Connect"
else
  echo "Exporting IPA -> ${EXPORT_PATH}"
fi

run_xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS_PLIST" \
  -allowProvisioningUpdates

if [ "$EXPORT_DESTINATION" = "upload" ]; then
  echo "Done. Upload requested by xcodebuild."
else
  echo "Done. IPA output:"
  find "$EXPORT_PATH" -maxdepth 1 -name '*.ipa' -print
fi
