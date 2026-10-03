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
  sh -n "$script"
done
PYTHONPYCACHEPREFIX="${IOS_ROOT}/build/verify/pycache" \
  python3 -m py_compile "${SCRIPT_DIR}/validate-native-smoke.py" "${REPO_ROOT}/scripts/verify_library_governance.py"
python3 "${REPO_ROOT}/scripts/verify_library_governance.py"
run_logged "Verify 440 vector-data approvals" "${LOG_DIR}/verify-vector-data-440.log" \
  node "${REPO_ROOT}/scripts/verify_vector_data_440.js"
run_logged "Verify content corpus" "${LOG_DIR}/verify-content-corpus.log" \
  node "${REPO_ROOT}/scripts/verify_content_corpus.cjs"
run_logged "Verify static assets" "${LOG_DIR}/verify-assets.log" \
  node "${REPO_ROOT}/scripts/verify_assets.mjs"
run_logged "Verify service worker unit" "${LOG_DIR}/verify-sw-unit.log" \
  node "${REPO_ROOT}/scripts/verify_sw_unit.mjs"
# M5-1: v10 / v13 replayed to the v14 worker, BUILD A→B, 503 fallback (same gate as verify:web / CI).
run_logged "Verify PWA upgrade" "${LOG_DIR}/verify-pwa-upgrade.log" \
  node "${REPO_ROOT}/scripts/verify_pwa_upgrade.js"

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

if [ "${RUN_SMOKE:-0}" = "1" ]; then
  echo "== Run simulator smoke test =="
  OUT_DIR="${IOS_ROOT}/build/verify/smoke" DERIVED_DATA_PATH="$DERIVED_DATA_PATH" SKIP_BUILD=1 "${SCRIPT_DIR}/smoke-simulator.sh"
fi

if [ "${RUN_DEV_SMOKE:-0}" = "1" ]; then
  # M5-3：-shizi-dev 打开的是色板页，不发 pageReady、不跑冒烟；dev 冒烟已并入 RUN_SMOKE 的三个阶段。
  echo "RUN_DEV_SMOKE is no longer supported; use RUN_SMOKE=1" >&2
  exit 64
fi

echo "Local iOS verification OK"
