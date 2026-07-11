#!/bin/sh
set -eu

if [ $# -ne 1 ]; then
  echo "Usage: $0 /path/to/Shizi.xcarchive" >&2
  exit 64
fi

ARCHIVE="$1"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP="${ARCHIVE}/Products/Applications/Shizi.app"
ARCHIVE_INFO="${ARCHIVE}/Info.plist"
APP_INFO="${APP}/Info.plist"
REQUIRE_SIGNING="${REQUIRE_SIGNING:-0}"

case "$ARCHIVE" in
  *.xcarchive)
    ;;
  *)
    echo "Expected a .xcarchive: ${ARCHIVE}" >&2
    exit 64
    ;;
esac

test -f "$ARCHIVE_INFO" || { echo "Missing archive Info.plist: ${ARCHIVE_INFO}" >&2; exit 66; }
test -f "$APP_INFO" || { echo "Missing archived app Info.plist: ${APP_INFO}" >&2; exit 66; }

"${SCRIPT_DIR}/verify-bundle-assets.sh" "$ARCHIVE"

read_plist() {
  /usr/libexec/PlistBuddy -c "Print :$1" "$2" 2>/dev/null || true
}

archive_version="$(read_plist ArchiveVersion "$ARCHIVE_INFO")"
application_path="$(read_plist ApplicationProperties:ApplicationPath "$ARCHIVE_INFO")"
archive_bundle_id="$(read_plist ApplicationProperties:CFBundleIdentifier "$ARCHIVE_INFO")"
archive_short_version="$(read_plist ApplicationProperties:CFBundleShortVersionString "$ARCHIVE_INFO")"
archive_build_version="$(read_plist ApplicationProperties:CFBundleVersion "$ARCHIVE_INFO")"
archive_arch="$(read_plist ApplicationProperties:Architectures:0 "$ARCHIVE_INFO")"
archive_signing_identity="$(read_plist ApplicationProperties:SigningIdentity "$ARCHIVE_INFO")"
archive_team="$(read_plist ApplicationProperties:Team "$ARCHIVE_INFO")"

app_bundle_id="$(read_plist CFBundleIdentifier "$APP_INFO")"
app_short_version="$(read_plist CFBundleShortVersionString "$APP_INFO")"
app_build_version="$(read_plist CFBundleVersion "$APP_INFO")"
app_platform="$(read_plist CFBundleSupportedPlatforms:0 "$APP_INFO")"
app_device_family="$(read_plist UIDeviceFamily:0 "$APP_INFO")"
app_minimum_os="$(read_plist MinimumOSVersion "$APP_INFO")"
app_executable="$(read_plist CFBundleExecutable "$APP_INFO")"

test "$archive_version" = "2" || { echo "Expected ArchiveVersion=2, got ${archive_version}" >&2; exit 65; }
test "$application_path" = "Applications/Shizi.app" || { echo "Unexpected ApplicationPath: ${application_path}" >&2; exit 65; }
test "$archive_bundle_id" = "$app_bundle_id" || { echo "Archive/app bundle ID mismatch: ${archive_bundle_id} vs ${app_bundle_id}" >&2; exit 65; }
test "$archive_short_version" = "$app_short_version" || { echo "Archive/app marketing version mismatch" >&2; exit 65; }
test "$archive_build_version" = "$app_build_version" || { echo "Archive/app build version mismatch" >&2; exit 65; }
test "$archive_arch" = "arm64" || { echo "Expected archived arm64 app, got ${archive_arch}" >&2; exit 65; }
test "$app_platform" = "iPhoneOS" || { echo "Expected iPhoneOS platform, got ${app_platform}" >&2; exit 65; }
test "$app_device_family" = "1" || { echo "Expected iPhone-only UIDeviceFamily=1, got ${app_device_family}" >&2; exit 65; }
test -n "$app_minimum_os" || { echo "Missing MinimumOSVersion" >&2; exit 65; }
test -n "$app_executable" && test -f "${APP}/${app_executable}" || { echo "Archived executable is missing" >&2; exit 65; }

if [ -n "${EXPECTED_BUNDLE_ID:-}" ] && [ "$app_bundle_id" != "$EXPECTED_BUNDLE_ID" ]; then
  echo "Expected bundle ID ${EXPECTED_BUNDLE_ID}, got ${app_bundle_id}" >&2
  exit 65
fi

if [ -n "${EXPECTED_MARKETING_VERSION:-}" ] && [ "$app_short_version" != "$EXPECTED_MARKETING_VERSION" ]; then
  echo "Expected marketing version ${EXPECTED_MARKETING_VERSION}, got ${app_short_version}" >&2
  exit 65
fi

if [ -n "${EXPECTED_BUILD_VERSION:-}" ] && [ "$app_build_version" != "$EXPECTED_BUILD_VERSION" ]; then
  echo "Expected build version ${EXPECTED_BUILD_VERSION}, got ${app_build_version}" >&2
  exit 65
fi

if [ "$REQUIRE_SIGNING" = "1" ]; then
  test -n "$archive_signing_identity" || { echo "Archive has no signing identity" >&2; exit 65; }
  test -n "$archive_team" || { echo "Archive has no signing team" >&2; exit 65; }
  test -f "${APP}/embedded.mobileprovision" || { echo "Signed archive is missing embedded.mobileprovision" >&2; exit 65; }
  codesign --verify --deep --strict "$APP"

  if [ -n "${EXPECTED_TEAM:-}" ] && [ "$archive_team" != "$EXPECTED_TEAM" ]; then
    echo "Expected signing team ${EXPECTED_TEAM}, got ${archive_team}" >&2
    exit 65
  fi
fi

echo "Archive metadata OK: ${app_bundle_id} ${app_short_version} (${app_build_version}), ${archive_arch}, iOS ${app_minimum_os}+"
if [ "$REQUIRE_SIGNING" = "1" ]; then
  echo "Archive signing OK: ${archive_signing_identity}, team ${archive_team}"
else
  echo "Archive signing check skipped (REQUIRE_SIGNING=0)"
fi
