#!/usr/bin/env bash
# QA-H1：原生写字页界面检查，一条命令跑全部（pnpm run verify:native-ui）。
#
#   1. 新建专用模拟器（iPhone 17 / iOS 26.5，名字「QA-H1 <时间>」），结束时删除——不碰别人的模拟器；
#   2. 构建 DEBUG 包与 ShiziUITests（xcodebuild build-for-testing）；
#   3. 逐屏对比：状态 = ShiziUITests/States/<状态>.json 夹具（B3.3 数据驱动：路由 / 造数据 / 钉时钟 / 点按都在夹具里，网页参考、原生取证、XCUITest 同一份）。
#      原生版按「状态 × 浅 / 深 × 字号」取证（截图 + 元素清单；字号档由夹具决定：默认 L / XXXL，ax: true 再加 AX3 / AX5，sizes 可直接指定），
#      与仓库里的网页参考（ios/ShiziApp/ShiziUITests/Reference/，文件名 = 状态_外观_字号）比，输出差异报告与并排图。只比夹具 native: true 的状态，
#      其余状态只有网页参考（reference-only，页面卡原生化合并时把夹具改成 native: true）；
#   4. 流程用例：XCUITest（确认单 1–9 的路线 + 两份 AI 报告的已知问题，已知问题标「预期失败（待修）」）；
#   5. 汇总通过 / 失败清单与总耗时。
#
# 用法：
#   ios/ShiziApp/scripts/verify-native-ui.sh                 全部（对比 + 流程）
#   ios/ShiziApp/scripts/verify-native-ui.sh --parity-only   只做逐屏对比
#   ios/ShiziApp/scripts/verify-native-ui.sh --flows-only    只跑流程用例
#   ios/ShiziApp/scripts/verify-native-ui.sh --update-reference   重新生成网页参考图（改了网页页面或固定条件之后），再对比
#   ios/ShiziApp/scripts/verify-native-ui.sh --reference-only --states home-fresh,library-empty   只取这些状态的网页参考图（新增夹具时用；不跑原生对比与流程用例）
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
ref_only=0
states=""
while [ $# -gt 0 ]; do
  case "$1" in
    --parity-only) do_flows=0 ;;
    --flows-only) do_parity=0 ;;
    --update-reference) update_ref=1 ;;
    --reference-only) update_ref=1; ref_only=1; do_flows=0 ;;
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
# R14：键盘钉成 en_US（网页参考与原生取证同一台、同一个键盘）。新模拟器跟随本机语言（zh-Hans）默认拼音键盘 336pt，英文 335pt——
# 不钉住时键盘高度随新模拟器挑哪个键盘变，带键盘的状态（查字等）逐屏对比跟着变。在任何 App 启动前写好。
KB="en_US@sw=QWERTY;hw=Automatic"
xcrun simctl spawn "$UDID" defaults write .GlobalPreferences AppleKeyboards -array "$KB"
xcrun simctl spawn "$UDID" defaults write .GlobalPreferences AppleKeyboardsExpanded -int 1
xcrun simctl spawn "$UDID" defaults write com.apple.Preferences KeyboardsCurrentAndNext -array "$KB"

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
  # 字号档：每一档只取夹具要这一档的状态（capture.mjs 按夹具的 sizes / ax 过滤）
  SIZES_ALL="L,XXXL,AX3,AX5"
  if [ "$update_ref" = 1 ]; then
    log "capture web reference → $REF"
    mkdir -p "$REF"
    node "$TOOLS/capture.mjs" --udid "$UDID" --ui web --out "$REF" --sizes "$SIZES_ALL" ${state_args[@]+"${state_args[@]}"} || status=1
  fi
  if [ "$ref_only" = 1 ]; then
    parity_line="（只取网页参考）"
  else
    log "capture native"
    node "$TOOLS/capture.mjs" --udid "$UDID" --ui native --out "$OUT/native" --sizes "$SIZES_ALL" ${state_args[@]+"${state_args[@]}"} >"$OUT/capture-native.log" 2>&1 || { status=1; tail -5 "$OUT/capture-native.log"; }
    log "compare"
    if parity_line="$(node "$TOOLS/compare.mjs" --ref "$REF" --native "$OUT/native" --out "$OUT/parity" ${state_args[@]+"${state_args[@]}"} | head -1)"; then :; else status=1; fi
    echo "  $parity_line"
  fi
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
  # R13：测试工具的重试（点按没效果 / 合成触摸被取消）收进 flows.md 的「flaky retries」，保持可见；按「Test Case … started」归属到用例
  retries="$(awk '/^Test Case .* started\./ { n=$0; sub(/^Test Case .-\[/, "", n); sub(/\]. started.*/, "", n); cur=n } /QA-(RETRY|NOEFFECT)/ { print cur " :: " $0 }' "$OUT/flows.log")"
  retry_n="$(printf '%s' "$retries" | grep -c 'QA-RETRY' || true)"
  {
    echo
    echo "## flaky retries（测试工具自动重试，最多一次；产品问题不会被吞）"
    echo
    echo "- 重试 ${retry_n:-0} 次"
    if [ -n "$retries" ]; then echo; printf '%s\n' "$retries" | cut -c1-400 | sed 's/^/- /'; fi
  } >>"$OUT/flows.md"
  flows_line="$flows_line"$'\n'"flaky retries: ${retry_n:-0} (see flows.md)"
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
