#!/usr/bin/env bash
# QA-H1：原生写字页界面检查，一条命令跑全部（pnpm run verify:native-ui）。
#
#   1. 新建专用模拟器（iPhone 17 / iOS 26.5，名字「QA-H1 <时间>」，多台时加 s<序号>），结束时（含失败、Ctrl-C）删除——不碰别人的模拟器；
#   2. 构建 DEBUG 包与 ShiziUITests（xcodebuild build-for-testing，只构建一次）；
#   3. 逐屏对比：状态 = ShiziUITests/States/<状态>.json 夹具（B3.3 数据驱动：路由 / 造数据 / 钉时钟 / 点按都在夹具里，网页参考、原生取证、XCUITest 同一份）。
#      原生版按「状态 × 浅 / 深 × 字号」取证（截图 + 元素清单；字号档由夹具决定：默认 L / XXXL，ax: true 再加 AX3 / AX5，sizes 可直接指定），
#      与仓库里的网页参考（ios/ShiziApp/ShiziUITests/Reference/，文件名 = 状态_外观_字号）比，输出差异报告与并排图。只比夹具 native: true 的状态，
#      其余状态只有网页参考（reference-only，页面卡原生化合并时把夹具改成 native: true）；
#   4. 流程用例：XCUITest（确认单 1–9 的路线 + 两份 AI 报告的已知问题，已知问题标「预期失败（待修）」）；
#   5. 汇总通过 / 失败清单与总耗时。
#
# 用法：
#   ios/ShiziApp/scripts/verify-native-ui.sh                 全部（对比 + 流程），默认 3 台模拟器并行
#   ios/ShiziApp/scripts/verify-native-ui.sh --parity-only   只做逐屏对比
#   ios/ShiziApp/scripts/verify-native-ui.sh --flows-only    只跑流程用例
#   ios/ShiziApp/scripts/verify-native-ui.sh --update-reference   重新生成网页参考图（改了网页页面或固定条件之后），再对比
#   ios/ShiziApp/scripts/verify-native-ui.sh --reference-only --states home-fresh,library-empty   只取这些状态的网页参考图（新增夹具时用；不跑原生对比与流程用例）
#   ios/ShiziApp/scripts/verify-native-ui.sh --states recall,judge   只对比这些状态
#   ios/ShiziApp/scripts/verify-native-ui.sh --shards N      QA-SHARD：开 N 台专用模拟器并行（默认 3；1 = 原来的串行，2.5–3.5 小时 → 3 台约 1 小时）。
#       构建只一次；每台模拟器一条流水线：先取证、再跑流程。逐屏取证按「外观 × 字号」屏数均衡分成 N 组并行，全部取完合并后对比只跑一次（报告与汇总格式不变）；
#       流程用例按历史耗时（native-ui/flow-durations.json，缺了按 40 秒）把测试类均衡分到 N 台，结果包合并成同一份 flows.md 与汇总行。
#       计时敏感的测试类（PERF_CLASSES，缺省 NativeStageFlowTests，含 test903 tap-to-first-frame P95）不进并行组：并行阶段与对比结束、其余模拟器关掉之后，
#       单独在空闲机器上跑，阈值不放宽。任务少于 N 组时只开用得上的台数。
#   FLOW_CLASSES=A,B …                                       只跑这几个测试类（与 --shards 可同用）
#   KEEP_SIM=1 …                                             结束时不删模拟器（调试用）
#   ENGINE=shadow|swift|web …                                B4.7：App 带 -shizi-engine <值> 启动（取证与流程用例都带）。shadow = 影子比对：
#       每台模拟器上 App 写的 Documents/shadow/*.json 收进 shadow/，汇总成 shadow.md；**有任何 mismatch 本次判失败**（退出码 1）。
# 输出：ios/ShiziApp/build/native-ui/<时间>/（summary.md、parity/report.md、parity/side-by-side/*.png、flows.md、flows*.xcresult；分片时每台各有 flows-s<序号>.xcresult / 日志）。
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
shards=3
while [ $# -gt 0 ]; do
  case "$1" in
    --parity-only) do_flows=0 ;;
    --flows-only) do_parity=0 ;;
    --update-reference) update_ref=1 ;;
    --reference-only) update_ref=1; ref_only=1; do_flows=0 ;;
    --states) states="$2"; shift ;;
    --shards) shards="$2"; shift ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
case "$shards" in ''|*[!0-9]*|0) echo "--shards needs a positive integer" >&2; exit 2 ;; esac
ENGINE="${ENGINE:-}"
case "$ENGINE" in ''|web|swift|shadow) ;; *) echo "ENGINE must be web, swift or shadow" >&2; exit 2 ;; esac
export ENGINE

mkdir -p "$OUT"
T0=$(date +%s)
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
elapsed() { local s=$(( $(date +%s) - T0 )); printf '%dm%02ds' $((s / 60)) $((s % 60)); }
state_args=()
[ -n "$states" ] && state_args=(--states "$states")
# 字号档：每一档只取夹具要这一档的状态（capture.mjs 按夹具的 sizes / ax 过滤）
SIZES_ALL="L,XXXL,AX3,AX5"

# 0. 分组：取证按状态、流程按测试类，各分成 ≤ shards 组；真正要开的模拟器数 = 各项分组数的最大值
cap_groups=()
ref_groups=()
flow_groups=()
perf_classes=""
if [ "$shards" = 1 ]; then
  # 串行 = 原来的行为：一台模拟器，不分组，全部测试类一次跑完
  cap_groups=("$states"); ref_groups=("$states"); flow_groups=("${FLOW_CLASSES:-}")
else
  if [ "$do_parity" = 1 ]; then
    while IFS= read -r line; do [ -n "$line" ] && cap_groups+=("$line"); done < <(node "$TOOLS/shard-plan.mjs" states "$shards" ${state_args[@]+"${state_args[@]}"})
    if [ "$update_ref" = 1 ]; then
      while IFS= read -r line; do [ -n "$line" ] && ref_groups+=("$line"); done < <(node "$TOOLS/shard-plan.mjs" refstates "$shards" ${state_args[@]+"${state_args[@]}"})
    fi
  fi
  if [ "$do_flows" = 1 ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      case "$line" in perf:*) perf_classes="${line#perf:}" ;; *) flow_groups+=("$line") ;; esac
    done < <(node "$TOOLS/shard-plan.mjs" classes "$shards" --only "${FLOW_CLASSES:-}")
  fi
fi
nsim=1
[ "${#cap_groups[@]}" -gt "$nsim" ] && nsim=${#cap_groups[@]}
[ "${#ref_groups[@]}" -gt "$nsim" ] && nsim=${#ref_groups[@]}
[ "${#flow_groups[@]}" -gt "$nsim" ] && nsim=${#flow_groups[@]}
[ "$nsim" -gt "$shards" ] && nsim=$shards
log "shards: $nsim simulator(s); capture groups ${#cap_groups[@]}, flow groups ${#flow_groups[@]}${perf_classes:+, timing-sensitive alone: $perf_classes}"

# 1. 专用模拟器（只删自己建的；失败 / Ctrl-C 也删）
UDIDS=()
cleanup() {
  trap - EXIT INT TERM
  # 还在跑的并行任务先停掉
  local pids; pids="$(jobs -p)"
  if [ -n "$pids" ]; then kill $pids >/dev/null 2>&1 || true; sleep 1; fi
  local u
  for u in ${UDIDS[@]+"${UDIDS[@]}"}; do
    if [ "${KEEP_SIM:-0}" != "1" ]; then
      xcrun simctl shutdown "$u" >/dev/null 2>&1 || true
      xcrun simctl delete "$u" >/dev/null 2>&1 || true
    else
      log "kept simulator $u"
    fi
  done
  if [ "${#UDIDS[@]}" -gt 0 ] && [ "${KEEP_SIM:-0}" != "1" ]; then log "deleted ${#UDIDS[@]} simulator(s) created by this run"; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM
for ((i = 0; i < nsim; i++)); do
  if [ "$nsim" = 1 ]; then SIM_NAME="QA-H1 $STAMP"; else SIM_NAME="QA-H1 $STAMP s$((i + 1))"; fi
  u="$(xcrun simctl create "$SIM_NAME" "$DEVICE_TYPE" "$RUNTIME")" || { echo "cannot create simulator ($DEVICE_TYPE / $RUNTIME)" >&2; exit 2; }
  UDIDS+=("$u")
  log "simulator $SIM_NAME ($u)"
done
# R14：键盘钉成 en_US（网页参考与原生取证同一台、同一个键盘）。新模拟器跟随本机语言（zh-Hans）默认拼音键盘 336pt，英文 335pt——
# 不钉住时键盘高度随新模拟器挑哪个键盘变，带键盘的状态（查字等）逐屏对比跟着变。在任何 App 启动前写好。
KB="en_US@sw=QWERTY;hw=Automatic"
boot_one() {
  local u="$1"
  xcrun simctl boot "$u"
  xcrun simctl bootstatus "$u" -b >/dev/null 2>&1 || true
  xcrun simctl spawn "$u" defaults write .GlobalPreferences AppleKeyboards -array "$KB"
  xcrun simctl spawn "$u" defaults write .GlobalPreferences AppleKeyboardsExpanded -int 1
  xcrun simctl spawn "$u" defaults write com.apple.Preferences KeyboardsCurrentAndNext -array "$KB"
}
for u in "${UDIDS[@]}"; do boot_one "$u" & done
wait

# 2. 构建（只一次；各模拟器共用同一份产物）
log "build (DEBUG app + ShiziUITests)"
if ! xcodebuild -project "$IOS/ShiziApp.xcodeproj" -scheme ShiziUITests -configuration Debug \
    -destination "platform=iOS Simulator,id=${UDIDS[0]}" -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO build-for-testing >"$OUT/build.log" 2>&1; then
  grep -E "error:" "$OUT/build.log" | head -20
  echo "BUILD FAILED (see $OUT/build.log)" >&2
  exit 1
fi
APP="$DD/Build/Products/Debug-iphonesimulator/Shizi.app"
for u in "${UDIDS[@]}"; do xcrun simctl install "$u" "$APP"; done

status=0
parity_line="（未跑）"
flows_line="（未跑）"
sfx() { if [ "$nsim" = 1 ]; then echo ""; else echo "-s$1"; fi; }   # 文件名后缀：只有多台时才带分片号

run_flows() {   # run_flows <udid> <类列表（逗号分隔，空 = 全部）> <结果包> <日志>
  local u="$1" classes="$2" bundle="$3" flog="$4" only=() cls c
  xcrun simctl ui "$u" appearance light
  xcrun simctl ui "$u" content_size large
  # FLOW_CLASSES=QueryFlowTests,BackupFlowTests：只跑这几个测试类（页面卡的局部门禁）；缺省全跑
  if [ -n "$classes" ]; then IFS=, read -ra cls <<<"$classes"; for c in "${cls[@]}"; do only+=("-only-testing:ShiziUITests/$c"); done; fi
  TEST_RUNNER_QA_ENGINE="$ENGINE" xcodebuild -project "$IOS/ShiziApp.xcodeproj" -scheme ShiziUITests -configuration Debug \
    -destination "platform=iOS Simulator,id=$u" -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO ${only[@]+"${only[@]}"} \
    -resultBundlePath "$bundle" test-without-building >"$flog" 2>&1 || true
}

# B4.7：收影子比对的结果（App 写在数据容器 Documents/shadow/<启动>.json）。模拟器要开着（get_app_container 只认启动着的）。
collect_shadow() {   # collect_shadow <序号，从 0 起>
  [ "$ENGINE" = shadow ] || return 0
  local u="${UDIDS[$1]}" c
  c="$(xcrun simctl get_app_container "$u" com.eimaa.shizi data 2>/dev/null)" || return 0
  mkdir -p "$OUT/shadow/s$(( $1 + 1 ))"
  [ -d "$c/Documents/shadow" ] && cp "$c/Documents/shadow/"*.json "$OUT/shadow/s$(( $1 + 1 ))/" 2>/dev/null
  return 0
}

# 3+4. 每台模拟器一条流水线：先取证（它那一组状态），再跑流程（它那一组测试类）。结果写 $OUT/shard-<序号>.rc（0 = 成功）
pipeline() {   # pipeline <序号，从 0 起>
  local i="$1" u="${UDIDS[$1]}" s rc=0 g a
  s="$(sfx "$((i + 1))")"
  if [ "$do_parity" = 1 ]; then
    if [ "$update_ref" = 1 ] && [ -n "${ref_groups[$i]+x}" ]; then
      g="${ref_groups[$i]}"; a=(); [ -n "$g" ] && a=(--states "$g")
      log "capture web reference$s → $REF"
      mkdir -p "$REF"
      if [ "$nsim" = 1 ]; then
        node "$TOOLS/capture.mjs" --udid "$u" --ui web --out "$REF" --sizes "$SIZES_ALL" ${a[@]+"${a[@]}"} || rc=1
      else
        node "$TOOLS/capture.mjs" --udid "$u" --ui web --out "$REF" --sizes "$SIZES_ALL" ${a[@]+"${a[@]}"} >"$OUT/capture-web$s.log" 2>&1 || { rc=1; tail -5 "$OUT/capture-web$s.log"; }
      fi
    fi
    if [ "$ref_only" != 1 ] && [ -n "${cap_groups[$i]+x}" ]; then
      g="${cap_groups[$i]}"; a=(); [ -n "$g" ] && a=(--states "$g")
      log "capture native$s"
      node "$TOOLS/capture.mjs" --udid "$u" --ui native --out "$OUT/native$s" --sizes "$SIZES_ALL" ${a[@]+"${a[@]}"} >"$OUT/capture-native$s.log" 2>&1 || { rc=1; tail -5 "$OUT/capture-native$s.log"; }
    fi
  fi
  if [ "$do_flows" = 1 ] && [ -n "${flow_groups[$i]+x}" ]; then
    log "XCUITest flows$s (ShiziUITests)"
    run_flows "$u" "${flow_groups[$i]}" "$OUT/flows$s.xcresult" "$OUT/flows$s.log"
  fi
  collect_shadow "$i"
  echo "$rc" >"$OUT/shard-$i.rc"
}
for ((i = 0; i < nsim; i++)); do
  if [ "$nsim" = 1 ]; then pipeline 0; else pipeline "$i" & fi
done
wait
for ((i = 0; i < nsim; i++)); do [ "$(cat "$OUT/shard-$i.rc" 2>/dev/null || echo 1)" = 0 ] || status=1; done

# 3b. 对比（各台取证合并后只跑一次；文件名 = 状态_外观_字号，各组互不重名）
if [ "$do_parity" = 1 ]; then
  if [ "$ref_only" = 1 ]; then
    parity_line="（只取网页参考）"
  else
    if [ "$nsim" -gt 1 ]; then
      mkdir -p "$OUT/native"
      for ((i = 1; i <= nsim; i++)); do [ -d "$OUT/native-s$i" ] && cp -R "$OUT/native-s$i/." "$OUT/native/"; done
      cat "$OUT"/capture-native-s*.log >"$OUT/capture-native.log" 2>/dev/null
    fi
    log "compare"
    if parity_line="$(node "$TOOLS/compare.mjs" --ref "$REF" --native "$OUT/native" --out "$OUT/parity" ${state_args[@]+"${state_args[@]}"} | head -1)"; then :; else status=1; fi
    echo "  $parity_line"
  fi
fi

# 4b. 计时敏感用例（分片时）：并行阶段与对比已结束；其余模拟器先关掉，机器空闲后在第 1 台上单独跑，阈值不放宽
if [ "$do_flows" = 1 ] && [ -n "$perf_classes" ]; then
  for ((i = 1; i < nsim; i++)); do xcrun simctl shutdown "${UDIDS[$i]}" >/dev/null 2>&1 || true; done
  log "XCUITest flows (timing-sensitive, alone on an idle machine: $perf_classes)"
  run_flows "${UDIDS[0]}" "$perf_classes" "$OUT/flows-perf.xcresult" "$OUT/flows-perf.log"
  collect_shadow 0
fi

# 4d. 影子比对汇总（ENGINE=shadow）：有 mismatch → 失败
shadow_line=""
if [ "$ENGINE" = shadow ]; then
  if shadow_line="$(node "$TOOLS/shadow-summary.mjs" "$OUT/shadow" "$OUT/shadow.md")"; then :; else status=1; fi
  echo "  $shadow_line"
fi

# 4c. 合并流程结果与日志
if [ "$do_flows" = 1 ]; then
  bundles=()
  logs=()
  if [ "$nsim" = 1 ]; then
    [ -d "$OUT/flows.xcresult" ] && bundles+=("$OUT/flows.xcresult")
    logs=("$OUT/flows.log")
  else
    for b in "$OUT"/flows-s*.xcresult "$OUT/flows-perf.xcresult"; do [ -d "$b" ] && bundles+=("$b"); done
    for l in "$OUT"/flows-s*.log "$OUT/flows-perf.log"; do [ -f "$l" ] && logs+=("$l"); done
    cat "${logs[@]}" >"$OUT/flows.log" 2>/dev/null
  fi
  if [ "${#bundles[@]}" = 0 ]; then
    echo "FAIL: no flow result bundle" >&2
    flows_line="flows: 0 cases (no result bundle)"
    status=1
  elif flows_line="$(node "$TOOLS/flows-summary.mjs" "${bundles[@]}" "$OUT/flows.md")"; then :; else status=1; fi
  # R13：测试工具的重试（点按没效果 / 合成触摸被取消）收进 flows.md 的「flaky retries」，保持可见；按「Test Case … started」归属到用例
  # （多台时每个日志各自归属，避免上一个日志的最后一个用例串到下一个日志）
  retries=""
  for l in ${logs[@]+"${logs[@]}"}; do
    retries+="$(awk '/^Test Case .* started\./ { n=$0; sub(/^Test Case .-\[/, "", n); sub(/\]. started.*/, "", n); cur=n } /QA-(RETRY|NOEFFECT)/ { print cur " :: " $0 }' "$l")"$'\n'
  done
  retries="$(printf '%s' "$retries" | sed '/^$/d')"
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
  echo "- 模拟器：iPhone 17 / iOS 26.5（专用、已删除）× $nsim"
  echo "- 逐屏对比：$parity_line"
  echo "- 流程用例：$(echo "$flows_line" | head -1)"
  [ -n "$shadow_line" ] && echo "- 影子比对（ENGINE=shadow）：$shadow_line（shadow.md）"
  [ -n "$ENGINE" ] && echo "- 引擎：-shizi-engine $ENGINE"
  echo "- 总耗时：$(elapsed)"
  echo
  echo "详情：parity/report.md（并排图 parity/side-by-side/）、flows.md（结果包 flows*.xcresult）"
} >"$OUT/summary.md"
log "done in $(elapsed) — $OUT/summary.md"
cat "$OUT/summary.md"
exit $status
