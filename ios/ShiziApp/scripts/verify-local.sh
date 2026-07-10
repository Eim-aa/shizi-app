#!/bin/sh
set -eu

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
  "${IOS_ROOT}/ShiziApp/PrivacyInfo.xcprivacy"
for script in "${SCRIPT_DIR}"/*.sh; do
  sh -n "$script"
done
PYTHONPYCACHEPREFIX="${IOS_ROOT}/build/verify/pycache" \
  python3 -m py_compile "${SCRIPT_DIR}/validate-native-smoke.py"

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
  OUT_DIR="${IOS_ROOT}/build/verify/smoke" "${SCRIPT_DIR}/smoke-simulator.sh"
fi

if [ "${RUN_DEV_SMOKE:-0}" = "1" ]; then
  echo "== Run simulator dev smoke test =="
  DEV_MODE=1 OUT_DIR="${IOS_ROOT}/build/verify/smoke" "${SCRIPT_DIR}/smoke-simulator.sh"
fi

echo "Local iOS verification OK"
