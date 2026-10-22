#!/usr/bin/env bash
# QA-H1：原生写字页界面检查，一条命令跑全部（pnpm run verify:native-ui）。
#
#   1. 新建专用模拟器（iPhone 17 / iOS 26.5，名字「QA-H1 <时间>」），结束时删除——不碰别人的模拟器；
#   2. 构建 DEBUG 包与 ShiziUITests（xcodebuild build-for-testing）；
#   3. 逐屏对比：原生版按「状态 × 浅 / 深 × L / XXXL」+「主要状态 × 浅 / 深 × AX3 / AX5」（B2.9b，config.mjs AX_STATES）取证（截图 + 元素清单），与仓库里的网页参考
#      （ios/ShiziApp/ShiziUITests/Reference/，文件名 = 状态_外观_字号）比，输出差异报告与并排图；
#   4. 流程用例：XCUITest（确认单 1–9 的路线 + 两份 AI 报告的已知问题，已知问题标「预期失败（待修）」）；
#   5. 汇总通过 / 失败清单与总耗时。
#
# 用法：
#   ios/ShiziApp/scripts/verify-native-ui.sh                 全部（对比 + 流程）
#   ios/ShiziApp/scripts/verify-native-ui.sh --parity-only   只做逐屏对比
#   ios/ShiziApp/scripts/verify-native-ui.sh --flows-only    只跑流程用例
#   ios/ShiziApp/scripts/verify-native-ui.sh --update-reference   重新生成网页参考图（改了网页写字页或固定条件之后），再对比
#   ios/ShiziApp/scripts/verify-native-ui.sh --states recall,judge   只对比这些状态
#   KEEP_SIM=1 …                                             结束时不删模拟器（调试用）
# 输出：ios/ShiziApp/build/native-ui/<时间>/（summary.md、parity/report.md、parity/side-by-side/*.png、flows.md、flows.xcresult）。
# 退出码：有回归（流程失败、具名检查回归）为 1；只有「预期失败（待修）」为 0。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
IOS="$ROOT/ios/ShiziApp"
TOOLS="$IOS/scripts/native-ui"
REF="$IOS/ShiziUITests/Reference"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$IOS/build/native-ui/$STAMP"
DD="$IOS/build/native-ui/DerivedData"
DEVICE_TYPE="com.apple.CoreSimulator.SimDeviceType.iPhone-17"
RUNTIME="com.apple.CoreSimulator.SimRuntime.iOS-26-5"

do_parity=1
do_flows=1
update_ref=0
states=""
while [ $# -gt 0 ]; do
  case "$1" in
    --parity-only) do_flows=0 ;;
    --flows-only) do_parity=0 ;;
    --update-reference) update_ref=1 ;;
    --states) states="$2"; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

mkdir -p "$OUT"
T0=$(date +%s)
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
elapsed() { local s=$(( $(date +%s) - T0 )); printf '%dm%02ds' $((s / 60)) $((s % 60)); }

# 1. 专用模拟器（只删自己建的这一台）
SIM_NAME="QA-H1 $STAMP"
UDID="$(xcrun simctl create "$SIM_NAME" "$DEVICE_TYPE" "$RUNTIME")" || { echo "cannot create simulator ($DEVICE_TYPE / $RUNTIME)" >&2; exit 2; }
cleanup() {
  if [ "${KEEP_SIM:-0}" != "1" ]; then
    xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
    xcrun simctl delete "$UDID" >/dev/null 2>&1 || true
    log "deleted simulator $SIM_NAME"
  else
    log "kept simulator $SIM_NAME ($UDID)"
  fi
}
trap cleanup EXIT
log "simulator $SIM_NAME ($UDID)"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || true

# 2. 构建
log "build (DEBUG app + ShiziUITests)"
if ! xcodebuild -project "$IOS/ShiziApp.xcodeproj" -scheme ShiziUITests -configuration Debug \
    -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO build-for-testing >"$OUT/build.log" 2>&1; then
  grep -E "error:" "$OUT/build.log" | head -20
  echo "BUILD FAILED (see $OUT/build.log)" >&2
  exit 1
fi
APP="$DD/Build/Products/Debug-iphonesimulator/Shizi.app"
xcrun simctl install "$UDID" "$APP"

status=0
parity_line="（未跑）"
flows_line="（未跑）"

# 3. 逐屏对比
if [ "$do_parity" = 1 ]; then
  state_args=()
  [ -n "$states" ] && state_args=(--states "$states")
  # B2.9b：AX3 / AX5 只取主要状态（--states 给了就取交集）
  ax_states="$(node -e "import('$TOOLS/config.mjs').then(c=>{const want='$states'.split(',').filter(Boolean);console.log(c.AX_STATES.filter(s=>!want.length||want.includes(s)).join(','))})")"
  if [ "$update_ref" = 1 ]; then
    log "capture web reference → $REF"
    mkdir -p "$REF"
    node "$TOOLS/capture.mjs" --udid "$UDID" --ui web --out "$REF" ${state_args[@]+"${state_args[@]}"} || status=1
    if [ -n "$ax_states" ]; then node "$TOOLS/capture.mjs" --udid "$UDID" --ui web --out "$REF" --states "$ax_states" --sizes AX3,AX5 || status=1; fi
  fi
  log "capture native"
  node "$TOOLS/capture.mjs" --udid "$UDID" --ui native --out "$OUT/native" ${state_args[@]+"${state_args[@]}"} >"$OUT/capture-native.log" 2>&1 || { status=1; tail -5 "$OUT/capture-native.log"; }
  if [ -n "$ax_states" ]; then
    log "capture native (AX3 / AX5: $ax_states)"
    node "$TOOLS/capture.mjs" --udid "$UDID" --ui native --out "$OUT/native" --states "$ax_states" --sizes AX3,AX5 >>"$OUT/capture-native.log" 2>&1 || { status=1; tail -5 "$OUT/capture-native.log"; }
  fi
  log "compare"
  if parity_line="$(node "$TOOLS/compare.mjs" --ref "$REF" --native "$OUT/native" --out "$OUT/parity" | head -1)"; then :; else status=1; fi
  echo "  $parity_line"
fi

# 4. 流程用例
if [ "$do_flows" = 1 ]; then
  log "XCUITest flows (ShiziUITests)"
  xcrun simctl ui "$UDID" appearance light
  xcrun simctl ui "$UDID" content_size large
  xcodebuild -project "$IOS/ShiziApp.xcodeproj" -scheme ShiziUITests -configuration Debug \
    -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO \
    -resultBundlePath "$OUT/flows.xcresult" test-without-building >"$OUT/flows.log" 2>&1 || true
  if flows_line="$(node "$TOOLS/flows-summary.mjs" "$OUT/flows.xcresult" "$OUT/flows.md")"; then :; else status=1; fi
  echo "$flows_line" | sed 's/^/  /'
fi

# 5. 汇总
{
  echo "# 原生写字页界面检查（QA-H1）· $STAMP"
  echo
  echo "- 提交：$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')"
  echo "- 模拟器：iPhone 17 / iOS 26.5（专用、已删除）"
  echo "- 逐屏对比：$parity_line"
  echo "- 流程用例：$(echo "$flows_line" | head -1)"
  echo "- 总耗时：$(elapsed)"
  echo
  echo "详情：parity/report.md（并排图 parity/side-by-side/）、flows.md（结果包 flows.xcresult）"
} >"$OUT/summary.md"
log "done in $(elapsed) — $OUT/summary.md"
cat "$OUT/summary.md"
exit $status
