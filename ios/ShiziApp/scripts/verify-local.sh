#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IOS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${IOS_ROOT}/../.." && pwd)"
PROJECT="${IOS_ROOT}/ShiziApp.xcodeproj"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-${IOS_ROOT}/build/verify/DerivedData}"
ARCHIVE_PATH="${ARCHIVE_PATH:-${IOS_ROOT}/build/verify/Shizi.xcarchive}"
LOG_DIR="${IOS_ROOT}/build/verify/logs"
QUIET="${QUIET:-1}"

mkdir -p "$LOG_DIR"

run_logged() {
  label="$1"
  log="$2"
  shift 2
  echo "== ${label} =="
  if [ "$QUIET" = "1" ]; then
    if "$@" >"$log" 2>&1; then
      echo "OK (${log})"
    else
      status=$?
      echo "FAILED (${log})" >&2
      tail -120 "$log" >&2 || true
      exit "$status"
    fi
  else
    "$@"
  fi
}

echo "== Lint plist and shell scripts =="
plutil -lint \
  "${IOS_ROOT}/ShiziApp/Info.plist" \
  "${IOS_ROOT}/ShiziApp/PrivacyInfo.xcprivacy" \
  "${IOS_ROOT}/ShiziApp/zh-Hans.lproj/InfoPlist.strings"
# A7：Paper 颜色集必须与 src/config/tokens.css 的 --p 一致（启动屏 / WebView 底色同源）
node "${SCRIPT_DIR}/generate-paper-colorset.mjs" --check
for script in "${SCRIPT_DIR}"/*.sh; do
  # 按 shebang 选解释器检查语法（#!/bin/bash 的脚本可用进程替换等 bash 写法）
  if head -1 "$script" | grep -q bash; then bash -n "$script"; else sh -n "$script"; fi
done
PYTHONPYCACHEPREFIX="${IOS_ROOT}/build/verify/pycache" \
  python3 -m py_compile "${REPO_ROOT}/scripts/verify_library_governance.py"
python3 "${REPO_ROOT}/scripts/verify_library_governance.py"
run_logged "Verify 440 vector-data approvals" "${LOG_DIR}/verify-vector-data-440.log" \
  node "${REPO_ROOT}/scripts/verify_vector_data_440.js"
run_logged "Verify content corpus" "${LOG_DIR}/verify-content-corpus.log" \
  node "${REPO_ROOT}/scripts/verify_content_corpus.cjs"
run_logged "Verify static assets" "${LOG_DIR}/verify-assets.log" \
  node "${REPO_ROOT}/scripts/verify_assets.mjs"
run_logged "Verify service worker unit" "${LOG_DIR}/verify-sw-unit.log" \
  node "${REPO_ROOT}/scripts/verify_sw_unit.mjs"
# D84（卡 B）：网页 PWA 升级门禁（scripts/verify_pwa_upgrade.js）不再跑——网页版已决定删除，语境覆盖移出 data/ 后网页壳不再完整。

if git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$REPO_ROOT" diff --check
fi

run_logged "Check Xcode project" "${LOG_DIR}/xcode-list.log" \
  xcodebuild -list -project "$PROJECT"

run_logged "Build Debug simulator" "${LOG_DIR}/build-debug-simulator.log" \
  xcodebuild \
  -project "$PROJECT" \
  -scheme Shizi \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  CODE_SIGNING_ALLOWED=NO \
  build

SIM_APP="${DERIVED_DATA_PATH}/Build/Products/Debug-iphonesimulator/Shizi.app"
"${SCRIPT_DIR}/verify-bundle-assets.sh" "$SIM_APP"

rm -rf "$ARCHIVE_PATH"
run_logged "Archive Release iPhoneOS without signing" "${LOG_DIR}/archive-release-iphoneos.log" \
  xcodebuild \
  -project "$PROJECT" \
  -scheme Shizi \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  -archivePath "$ARCHIVE_PATH" \
  CODE_SIGNING_ALLOWED=NO \
  archive

"${SCRIPT_DIR}/verify-archive.sh" "$ARCHIVE_PATH"

if [ "${RUN_SMOKE:-0}" = "1" ] || [ "${RUN_DEV_SMOKE:-0}" = "1" ]; then
  # B4.9：网页冒烟（smoke-simulator.sh / NativeSmoke.swift）随 WKWebView 退役；模拟器上的检查是 verify-native-ui.sh（XCUITest 流程 + 逐屏对比）。
  echo "RUN_SMOKE is retired (B4.9); run ios/ShiziApp/scripts/verify-native-ui.sh instead" >&2
  exit 64
fi

echo "Local iOS verification OK"
