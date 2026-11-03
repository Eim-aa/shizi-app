#!/usr/bin/env bash
# QA-H1：原生写字页界面检查，一条命令跑全部（pnpm run verify:native-ui）。
#
#   1. 新建专用模拟器（iPhone 17 / iOS 26.5，名字「QA-H1 <时间>」，多台时加 s<序号>），结束时（含失败、Ctrl-C）删除——不碰别人的模拟器；
#   2. 构建 DEBUG 包与 ShiziUITests（xcodebuild build-for-testing，只构建一次）；
#   3. 逐屏对比（D84：对冻结的原生基线）：状态 = ShiziUITests/States/<状态>.json 夹具（路由 / 造数据 / 钉时钟 / 点按都在夹具里，原生取证与 XCUITest 同一份）。
#      原生版按「状态 × 浅 / 深 × 字号」取证（截图 + 元素清单；字号档由夹具决定：默认 L / XXXL，ax: true 再加 AX3 / AX5，sizes 可直接指定），
#      与仓库里的原生基线（ios/ShiziApp/ShiziUITests/Baseline/，文件名 = 状态_外观_字号）比，输出差异报告与并排图（左基线、右这次）。只比夹具 native: true 的状态。
#      基线是回归守卫：原生一变就报；有意改了界面就确认后用 --update-baseline 重录（见 ios/ShiziApp/README.md「逐屏基线」）；
#   4. 流程用例：XCUITest（确认单 1–9 的路线 + 两份 AI 报告的已知问题，已知问题标「预期失败（待修）」）；
#   5. 汇总通过 / 失败清单与总耗时。
#
# 用法：
#   ios/ShiziApp/scripts/verify-native-ui.sh                 全部（对比 + 流程），默认 3 台模拟器并行
#   ios/ShiziApp/scripts/verify-native-ui.sh --parity-only   只做逐屏对比
#   ios/ShiziApp/scripts/verify-native-ui.sh --flows-only    只跑流程用例
#   ios/ShiziApp/scripts/verify-native-ui.sh --update-baseline   取证后把这一次的原生取证存成新基线（再对它比一次，应当 0 差异）。
#       只有取证全部成功时才写；全量覆盖 Baseline/，加 --states a,b 只替换这几个状态。有意改了界面、人看过新截图之后才用，提交时基线图单独一个提交。
#       可与 --parity-only 同用（不跑流程）；与 --flows-only 不能同用。
#   ios/ShiziApp/scripts/verify-native-ui.sh --states recall,judge   只对比这些状态
#   ios/ShiziApp/scripts/verify-native-ui.sh --shards N      QA-SHARD：开 N 台专用模拟器并行（默认 3；1 = 原来的串行，2.5–3.5 小时 → 3 台约 1 小时）。
#       构建只一次；每台模拟器一条流水线：先取证、再跑流程。逐屏取证按「外观 × 字号」屏数均衡分成 N 组并行，全部取完合并后对比只跑一次（报告与汇总格式不变）；
#       流程用例按历史耗时（native-ui/flow-durations.json，缺了按 40 秒）把测试类均衡分到 N 台，结果包合并成同一份 flows.md 与汇总行。
#       计时敏感的测试类（PERF_CLASSES，缺省 NativeStageFlowTests，含 test903 tap-to-first-frame P95）不进并行组：并行阶段与对比结束、其余模拟器关掉之后，
#       单独在空闲机器上跑，阈值不放宽。任务少于 N 组时只开用得上的台数。
#   FLOW_CLASSES=A,B …                                       只跑这几个测试类（与 --shards 可同用）
#   KEEP_SIM=1 …                                             结束时不删模拟器（调试用）
#   （B4.9：ENGINE= 已删除——App 里只有 SwiftEngine，没有 WebEngine / 影子比对）
# 输出：ios/ShiziApp/build/native-ui/<时间>/（summary.md、parity/report.md、parity/side-by-side/*.png、flows.md、flows*.xcresult；分片时每台各有 flows-s<序号>.xcresult / 日志）。
# 退出码：有回归（流程失败、具名检查回归、逐屏对基线有任何差异或缺基线 / 缺取证）为 1；只有「预期失败（待修）」为 0。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
IOS="$ROOT/ios/ShiziApp"
TOOLS="$IOS/scripts/native-ui"
REF="$IOS/ShiziUITests/Baseline"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$IOS/build/native-ui/$STAMP"
DD="$IOS/build/native-ui/DerivedData"
DEVICE_TYPE="com.apple.CoreSimulator.SimDeviceType.iPhone-17"
RUNTIME="com.apple.CoreSimulator.SimRuntime.iOS-26-5"

do_parity=1
do_flows=1
update_baseline=0
states=""
shards=3
while [ $# -gt 0 ]; do
  case "$1" in
    --parity-only) do_flows=0 ;;
    --flows-only) do_parity=0 ;;
    --update-baseline) update_baseline=1 ;;
    --states) states="$2"; shift ;;
    --shards) shards="$2"; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
case "$shards" in ''|*[!0-9]*|0) echo "--shards needs a positive integer" >&2; exit 2 ;; esac
if [ -n "${ENGINE:-}" ]; then echo "ENGINE= is gone (B4.9: the app has only SwiftEngine)" >&2; exit 2; fi
case " $* " in *" --update-reference "*|*" --reference-only "*) echo "--update-reference / --reference-only are retired (D84: the web reference is gone; use --update-baseline)" >&2; exit 2 ;; esac
if [ "$update_baseline" = 1 ] && [ "$do_parity" = 0 ]; then echo "--update-baseline needs the per-screen capture (drop --flows-only)" >&2; exit 2; fi
if [ "$do_parity" = 1 ] && [ "$update_baseline" = 0 ] && ! ls "$REF"/*.json >/dev/null 2>&1; then echo "no native baseline in $REF — record one with --update-baseline" >&2; exit 2; fi

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
flow_groups=()
perf_classes=""
if [ "$shards" = 1 ]; then
  # 串行 = 原来的行为：一台模拟器，不分组，全部测试类一次跑完
  cap_groups=("$states"); flow_groups=("${FLOW_CLASSES:-}")
else
  if [ "$do_parity" = 1 ]; then
    while IFS= read -r line; do [ -n "$line" ] && cap_groups+=("$line"); done < <(node "$TOOLS/shard-plan.mjs" states "$shards" ${state_args[@]+"${state_args[@]}"})
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
# R14：键盘钉成 en_US（基线与这一次的取证同一个键盘）。新模拟器跟随本机语言（zh-Hans）默认拼音键盘 336pt，英文 335pt——
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
# B4.9c：共用的 DerivedData 增量构建可能漏掉 ShiziCore 新加的资源目录（SessionBundled 缺 → SwiftEngine 读资源即崩，流程全挂）。
# 缺就删掉构建产物与中间文件（留下 SourcePackages / ModuleCache）重建一次；仍缺 = 失败。
if ! "$IOS/scripts/verify-core-bundles.sh" "$APP" >>"$OUT/build.log" 2>&1; then
  log "ShiziCore resource bundle incomplete in DerivedData; rebuilding $DD/Build once"
  rm -rf "$DD/Build"
  if ! xcodebuild -project "$IOS/ShiziApp.xcodeproj" -scheme ShiziUITests -configuration Debug \
      -destination "platform=iOS Simulator,id=${UDIDS[0]}" -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO build-for-testing >>"$OUT/build.log" 2>&1 \
      || ! "$IOS/scripts/verify-core-bundles.sh" "$APP" >>"$OUT/build.log" 2>&1; then
    tail -5 "$OUT/build.log"
    echo "BUILD FAILED or ShiziCore resources still missing (see $OUT/build.log)" >&2
    exit 1
  fi
fi
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
  xcodebuild -project "$IOS/ShiziApp.xcodeproj" -scheme ShiziUITests -configuration Debug \
    -destination "platform=iOS Simulator,id=$u" -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO ${only[@]+"${only[@]}"} \
    -resultBundlePath "$bundle" test-without-building >"$flog" 2>&1 || true
}

# 3+4. 每台模拟器一条流水线：先取证（它那一组状态），再跑流程（它那一组测试类）。结果写 $OUT/shard-<序号>.rc（0 = 成功）
pipeline() {   # pipeline <序号，从 0 起>
  local i="$1" u="${UDIDS[$1]}" s rc=0 g a
  s="$(sfx "$((i + 1))")"
  if [ "$do_parity" = 1 ]; then
    if [ -n "${cap_groups[$i]+x}" ]; then
      g="${cap_groups[$i]}"; a=(); [ -n "$g" ] && a=(--states "$g")
      log "capture native$s"
      node "$TOOLS/capture.mjs" --udid "$u" --out "$OUT/native$s" --sizes "$SIZES_ALL" ${a[@]+"${a[@]}"} >"$OUT/capture-native$s.log" 2>&1 || { rc=1; tail -5 "$OUT/capture-native$s.log"; }
    fi
  fi
  if [ "$do_flows" = 1 ] && [ -n "${flow_groups[$i]+x}" ]; then
    log "XCUITest flows$s (ShiziUITests)"
    run_flows "$u" "${flow_groups[$i]}" "$OUT/flows$s.xcresult" "$OUT/flows$s.log"
  fi
  echo "$rc" >"$OUT/shard-$i.rc"
}
for ((i = 0; i < nsim; i++)); do
  if [ "$nsim" = 1 ]; then pipeline 0; else pipeline "$i" & fi
done
wait
for ((i = 0; i < nsim; i++)); do [ "$(cat "$OUT/shard-$i.rc" 2>/dev/null || echo 1)" = 0 ] || status=1; done

# 3b. 对比（各台取证合并后只跑一次；文件名 = 状态_外观_字号，各组互不重名）
if [ "$do_parity" = 1 ]; then
  if [ "$nsim" -gt 1 ]; then
    mkdir -p "$OUT/native"
    for ((i = 1; i <= nsim; i++)); do [ -d "$OUT/native-s$i" ] && cp -R "$OUT/native-s$i/." "$OUT/native/"; done
    cat "$OUT"/capture-native-s*.log >"$OUT/capture-native.log" 2>/dev/null
  fi
  if [ "$update_baseline" = 1 ]; then
    if [ "$status" != 0 ]; then
      echo "capture failed on at least one simulator — baseline NOT updated" >&2
    else
      log "update baseline → $REF"
      if node "$TOOLS/baseline-update.mjs" --from "$OUT/native" --to "$REF" ${state_args[@]+"${state_args[@]}"}; then :; else status=1; fi
    fi
  fi
  log "compare"
  if parity_line="$(node "$TOOLS/compare.mjs" --ref "$REF" --native "$OUT/native" --out "$OUT/parity" ${state_args[@]+"${state_args[@]}"} | head -1)"; then :; else status=1; fi
  echo "  $parity_line"
fi

# 4b. 计时敏感用例（分片时）：并行阶段与对比已结束；其余模拟器先关掉，机器空闲后在第 1 台上单独跑，阈值不放宽
if [ "$do_flows" = 1 ] && [ -n "$perf_classes" ]; then
  for ((i = 1; i < nsim; i++)); do xcrun simctl shutdown "${UDIDS[$i]}" >/dev/null 2>&1 || true; done
  log "XCUITest flows (timing-sensitive, alone on an idle machine: $perf_classes)"
  run_flows "${UDIDS[0]}" "$perf_classes" "$OUT/flows-perf.xcresult" "$OUT/flows-perf.log"
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
  echo "- 总耗时：$(elapsed)"
  echo
  echo "详情：parity/report.md（并排图 parity/side-by-side/）、flows.md（结果包 flows*.xcresult）"
} >"$OUT/summary.md"
log "done in $(elapsed) — $OUT/summary.md"
cat "$OUT/summary.md"
exit $status
