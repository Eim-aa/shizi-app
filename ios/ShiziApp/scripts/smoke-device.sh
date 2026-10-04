#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IOS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SIGNING_XCCONFIG="${SIGNING_XCCONFIG:-}"
OUT_DIR="${OUT_DIR:-${IOS_ROOT}/build/device-smoke}"
RESULT_TIMEOUT="${RESULT_TIMEOUT:-180}"
REMINDER_TARGET="${REMINDER_TARGET:-base:春}"
REMOTE_RESULT="Documents/shizi-native-smoke.json"
# 阶段顺序（validate-native-smoke.py STAGES）。restore 之后脚本用 SIGKILL 结束进程，再以 restorecheck 冷启动核对（Q32）；
# measure 是 T1 的非触控测量（只记录数字，不判优劣）。只跑一部分：SMOKE_STAGES="restore measure"。
SMOKE_STAGES="${SMOKE_STAGES:-main relaunch deeplink restore measure}"
sentinel_sequence=0

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

if [ -z "${DEVICE_ID:-}" ]; then
  echo "Set DEVICE_ID to a paired and available iPhone." >&2
  xcrun devicectl list devices >&2 || true
  exit 64
fi

case "$RESULT_TIMEOUT" in
  ''|*[!0-9]*)
    echo "RESULT_TIMEOUT must be a positive integer." >&2
    exit 64
    ;;
esac
if [ "$RESULT_TIMEOUT" -le 0 ]; then
  echo "RESULT_TIMEOUT must be greater than zero." >&2
  exit 64
fi

BUNDLE_ID="${BUNDLE_ID:-$(read_xcconfig_value PRODUCT_BUNDLE_IDENTIFIER "$SIGNING_XCCONFIG")}"
APP_ID="${APP_ID:-${BUNDLE_ID:-com.eimaa.shizi}}"
if [ "${DEV_MODE:-0}" = "1" ]; then
  echo "DEV_MODE is no longer supported: -shizi-dev opens the palette page, which does not run the smoke." >&2
  exit 64
fi

mkdir -p "$OUT_DIR"
SENTINEL="${OUT_DIR}/pending.json"

prepare_remote_result() {
  sentinel_sequence=$((sentinel_sequence + 1))
  printf '{"pending":true,"sequence":%s}\n' "$sentinel_sequence" >"$SENTINEL"
  xcrun devicectl device copy to \
    --device "$DEVICE_ID" \
    --source "$SENTINEL" \
    --destination "$REMOTE_RESULT" \
    --domain-type appDataContainer \
    --domain-identifier "$APP_ID" \
    --quiet
}

launch_smoke() {
  xcrun devicectl device process launch \
    --device "$DEVICE_ID" \
    --terminate-existing \
    "$APP_ID" \
    -- \
    -shizi-smoke "$@"
}

collect_result() {
  destination="$1"
  attempt=0
  while [ "$attempt" -lt "$RESULT_TIMEOUT" ]; do
    attempt=$((attempt + 1))
    rm -f "$destination"
    if xcrun devicectl device copy from \
      --device "$DEVICE_ID" \
      --source "$REMOTE_RESULT" \
      --destination "$destination" \
      --domain-type appDataContainer \
      --domain-identifier "$APP_ID" \
      --quiet >/dev/null 2>&1; then
      if [ -s "$destination" ] && ! grep -q '"pending"[[:space:]]*:[[:space:]]*true' "$destination"; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

# 结束 App 进程，等同上滑杀掉（SIGKILL：不跑 pagehide / visibilitychange）。
kill_app() {
  procs="${OUT_DIR}/processes.json"
  rm -f "$procs"
  xcrun devicectl device info processes --device "$DEVICE_ID" --quiet --json-output "$procs" >/dev/null
  pids="$(python3 -c 'import json, sys
for p in json.load(open(sys.argv[1]))["result"]["runningProcesses"]:
    if p.get("executable", "").rstrip("/").endswith("/Shizi.app/Shizi"):
        print(p["processIdentifier"])' "$procs")"
  for pid in $pids; do
    echo "  SIGKILL ${APP_ID} pid ${pid}"
    xcrun devicectl device process signal --device "$DEVICE_ID" --pid "$pid" --signal SIGKILL --quiet
  done
  sleep 2
}

if [ "${SKIP_BUILD:-0}" = "1" ]; then
  echo "SKIP_BUILD=1: using the ${APP_ID} already installed on ${DEVICE_ID}"
else
  echo "Building and installing ${APP_ID} on ${DEVICE_ID}"
  SKIP_LAUNCH=1 "${SCRIPT_DIR}/run-device.sh"
fi

# 与 smoke-simulator.sh 同样三个阶段（02 M5-3）。真机上相册权限由系统弹窗决定：拒绝时 imageSave 允许「保存失败」分支。
run_stage() {
  stage="$1"
  shift
  result="${OUT_DIR}/shizi-device-${stage}.json"
  echo "Running native smoke stage: ${stage}"
  prepare_remote_result
  launch_smoke -shizi-smoke-stage "$stage" "$@"
  if ! collect_result "$result"; then
    echo "Timed out waiting for device smoke result (${stage}) after ${RESULT_TIMEOUT}s." >&2
    exit 65
  fi
  python3 "${SCRIPT_DIR}/validate-native-smoke.py" "$result" "$stage" --allow-photos-denied
  echo "  ${result}"
}

for stage in $SMOKE_STAGES; do
  case "$stage" in
    deeplink) run_stage deeplink -shizi-reminder-target "$REMINDER_TARGET" ;;
    restore)
      run_stage restore
      kill_app
      run_stage restorecheck
      ;;
    *) run_stage "$stage" ;;
  esac
done

echo "Real-device native smoke OK"
echo "Complete the handwriting, keyboard, rotation, and offline checks in DEVICE_QA.md on the iPhone."
