#!/bin/bash
set -euo pipefail

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

# M5-3：DEBUG 冒烟与测试宿主注入（NativeSmoke.swift、?test=1 + __shiziNativeDev）不得进 Release 可执行文件。
# B3.1：原生写字流程（写字 / 判断 / 结果 / 重写错字页与 ShiziKit）转正进 Release，开关 -shizi-native-write / __shiziNativeWrite（默认关，到 B3.F）随之进包，
#   从本表移出；仍只在 DEBUG 的：纵切量测（NativeWriteMetrics、shizi-native-write-metrics.json）、QA-H1 测试宿主（-shizi-qa*、qa-probe、QATrace、QAProbe、
#   NativeQAHarness）——原生页面只经 ShiziProbe 留钩子，Release 里是空操作。
# B4.7：引擎选择（-shizi-engine）与影子比对（ShadowEngine、ShadowJournal、影子包装的 __shiziShadowOp）只在 DEBUG。
for marker in "ShadowEngine" "ShadowJournal" "__shiziShadowOp" "SHIZI-SHADOW" "__shiziNativeDev" "nativeSmokeResult" "nativeSmokeControl" "shizi-native-smoke.json" "-shizi-smoke" "__shiziSmokeEvents" "restorecheck" "rafWriteDrawing" "deviceInfo" "shizi-smoke-probe.js" "-shizi-probe-arg" "__shiziNativeInk" "-shizi-native-ink" "shizi-native-ink-latency.json" "shizi-ink-selfcheck" "touchToTargetMs" "shizi-native-write-metrics.json" "NativeWriteMetrics" "SHIZI_NW_AUTO" "-shizi-qa" "qa-probe" "NativeQAHarness" "QATrace" "QAProbe" "QAFixture" "QAStates"; do
  if LC_ALL=C grep -aFq -e "$marker" "${APP}/${app_executable}"; then
    echo "Release executable contains Debug native-smoke marker: ${marker}" >&2
    exit 65
  fi
done

# B3.1：Release 含原生写字流程与 ShiziKit（页面类、转场对象）与构建期生成的令牌 / 文案资源。
for marker in "NativeWriteViewController" "NativeResultViewController" "NativeWriteTransitions" "NativeChangeSheetViewController"; do
  LC_ALL=C grep -aFq -e "$marker" "${APP}/${app_executable}" || { echo "Release executable is missing the native write flow (${marker})" >&2; exit 65; }
done
for resource in "ShiziKitTokens.json" "ShiziKitCopy.json"; do
  test -s "${APP}/${resource}" || { echo "Release app is missing the ShiziKit resource ${resource}" >&2; exit 65; }
done

# B2.1：原生书写面转正——Release 可执行文件必须含书写面：NativeInkView（ObjC 名 ShiziNativeInkView）与 Metal 渲染器的着色器（ink_vs；
# 笔锋模型由书写面每帧调用，随之保留）。spike 叠层（NativeInkSpike）、金标准自检、T1 量测仍只在 Debug（上面的标记表）。
for marker in "ShiziNativeInkView" "ink_vs"; do
  LC_ALL=C grep -aFq -e "$marker" "${APP}/${app_executable}" || { echo "Release executable is missing the native ink surface (${marker})" >&2; exit 65; }
done

# P1-S2：原生书写面 spike 的笔锋模型金标准文件只在 Debug 构建复制进包（sync-web-assets.sh）。
test ! -e "${APP}/InkModel" || { echo "Release app contains Debug-only InkModel/ self-check files" >&2; exit 65; }
# B3.3：QA-H1 状态夹具（ShiziUITests/States → QAStates/，sync-web-assets.sh 只在 Debug 复制）
test ! -e "${APP}/QAStates" || { echo "Release app contains Debug-only QAStates/ fixtures" >&2; exit 65; }

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
