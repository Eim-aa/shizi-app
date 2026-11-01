#!/bin/bash
# DEBUG 原生冒烟（02 M5-3）：Simulator 上构建 → 全新安装 → 三次启动，每次读 Documents/shizi-native-smoke.json 交给
# validate-native-smoke.py 按阶段核对。冒烟脚本在 ShiziApp/NativeSmoke.swift（只在 Debug 编译）。
#   1. main      -shizi-smoke                                 模块/fetch、localStorage、写一字判断、刷新恢复、边缘返回、
#                                                             备份导出/导入/撤销不 reload、R-B06、syncReminder、图片保存
#   2. relaunch  -shizi-smoke -shizi-smoke-stage relaunch     两次启动之间 localStorage 与记录都在
#   3. deeplink  （先结束进程 = 冷启动）-shizi-smoke -shizi-smoke-stage deeplink -shizi-reminder-target base:春
#                                                             pageReady 后派发、页面返回 true 才清 key、以 B 组打开这个字
# 另外核对 WKWebView 的 LocalStorage 数据库在进程重启后仍有 shizi.nativeSmoke.v1。
# 引擎（B4.9c）：冒烟脚本经页面测试钩子与网页界面（.sz-app / data-testid）驱动，量的是 WKWebView 页面这条路（WebEngine 是写入者），
# 所以显式带 -shizi-engine web（ENGINE 可改）。**已知失效**：2026-11-01 实测 web 与 swift 两种引擎下 main 阶段都卡在「app boot」——
# 它等网页根节点 .sz-app，而 B3.F 起 App 是引擎模式、不挂网页界面（与 B4.9b 的缺省引擎无关，早于本卡）。缺省 swift 模式由 XCUITest 流程
# （verify-native-ui.sh ENGINE=swift）与 ShiziWriteTests（含零 WKWebView 调用检查）覆盖；这条冒烟待 B4.9 随网页退役或改写成原生冒烟。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IOS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT="${IOS_ROOT}/ShiziApp.xcodeproj"
SCHEME="${SCHEME:-Shizi}"
CONFIGURATION="${CONFIGURATION:-Debug}"
DEVICE="${DEVICE:-booted}"
APP_ID="${APP_ID:-com.eimaa.shizi}"
OUT_DIR="${OUT_DIR:-${IOS_ROOT}/build/smoke}"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-${OUT_DIR}/DerivedData}"
RESULT_TIMEOUT="${RESULT_TIMEOUT:-120}"
REMINDER_TARGET="${REMINDER_TARGET:-base:春}"
SKIP_BUILD="${SKIP_BUILD:-0}"
ENGINE="${ENGINE:-web}"
case "$ENGINE" in web|swift|shadow) ;; *) echo "ENGINE must be web, swift or shadow" >&2; exit 64 ;; esac

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
if [ "${DEV_MODE:-0}" = "1" ]; then
  echo "DEV_MODE is no longer supported: -shizi-dev opens the palette page, which does not run the smoke." >&2
  exit 64
fi

mkdir -p "$OUT_DIR"
APP="${DERIVED_DATA_PATH}/Build/Products/${CONFIGURATION}-iphonesimulator/Shizi.app"

if [ "$SKIP_BUILD" != "1" ]; then
  echo "Building ${SCHEME} (${CONFIGURATION}) for iOS Simulator"
  xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    CODE_SIGNING_ALLOWED=NO \
    build
fi
test -d "$APP" || { echo "Simulator app not found: ${APP}" >&2; exit 66; }

"${SCRIPT_DIR}/verify-bundle-assets.sh" "$APP"

echo "Reinstalling ${APP_ID} on ${DEVICE} (fresh data container)"
xcrun simctl terminate "$DEVICE" "$APP_ID" >/dev/null 2>&1 || true
xcrun simctl uninstall "$DEVICE" "$APP_ID" >/dev/null 2>&1 || true
xcrun simctl install "$DEVICE" "$APP"
# 图片保存走真实的相册写入（addOnly）；Simulator 上先授权，免得系统弹窗挡住冒烟。
xcrun simctl privacy "$DEVICE" grant photos-add "$APP_ID" >/dev/null 2>&1 || echo "warning: could not pre-grant photos-add" >&2
DATA_CONTAINER="$(xcrun simctl get_app_container "$DEVICE" "$APP_ID" data)"
NATIVE_SMOKE_JSON="${DATA_CONTAINER}/Documents/shizi-native-smoke.json"

run_stage() {
  stage="$1"
  shift
  result="${OUT_DIR}/shizi-native-smoke-${stage}.json"
  rm -f "$NATIVE_SMOKE_JSON" "$result"
  xcrun simctl terminate "$DEVICE" "$APP_ID" >/dev/null 2>&1 || true
  echo "== Smoke stage: ${stage} =="
  xcrun simctl launch "$DEVICE" "$APP_ID" -shizi-engine "$ENGINE" -shizi-smoke -shizi-smoke-stage "$stage" "$@" >/dev/null
  attempt=0
  while [ "$attempt" -lt "$RESULT_TIMEOUT" ]; do
    attempt=$((attempt + 1))
    [ -s "$NATIVE_SMOKE_JSON" ] && break
    sleep 1
  done
  if [ ! -s "$NATIVE_SMOKE_JSON" ]; then
    xcrun simctl io "$DEVICE" screenshot "${OUT_DIR}/shizi-simulator-${stage}-timeout.png" >/dev/null 2>&1 || true
    echo "Native WKWebView smoke (${stage}) wrote no result after ${RESULT_TIMEOUT}s" >&2
    exit 65
  fi
  cp "$NATIVE_SMOKE_JSON" "$result"
  xcrun simctl io "$DEVICE" screenshot "${OUT_DIR}/shizi-simulator-${stage}.png" >/dev/null 2>&1 || true
  python3 "${SCRIPT_DIR}/validate-native-smoke.py" "$result" "$stage"
  echo "Result: ${result}"
}

local_storage_db() {
  find "${DATA_CONTAINER}/Library/WebKit" -path '*LocalStorage/localstorage.sqlite3' -type f 2>/dev/null | head -1 || true
}

run_stage main
run_stage relaunch

# 进程重启后 WKWebView 的 LocalStorage 落盘库里仍有冒烟键（与 relaunch 阶段页面内读到的互证）。
xcrun simctl terminate "$DEVICE" "$APP_ID" >/dev/null 2>&1 || true
DB="$(local_storage_db)"
if [ -z "$DB" ]; then
  echo "WKWebView LocalStorage database was not found under ${DATA_CONTAINER}/Library/WebKit" >&2
  exit 65
fi
PERSISTED="$(sqlite3 "$DB" "select count(*) from ItemTable where key = 'shizi.nativeSmoke.v1';" 2>/dev/null || printf '0')"
if [ "$PERSISTED" != "1" ]; then
  echo "Expected shizi.nativeSmoke.v1 in ${DB}, got count ${PERSISTED}" >&2
  exit 65
fi
echo "WKWebView LocalStorage keys:"
sqlite3 "$DB" "select key from ItemTable where key like 'shizi.%' order by key;"

run_stage deeplink -shizi-reminder-target "$REMINDER_TARGET"

xcrun simctl terminate "$DEVICE" "$APP_ID" >/dev/null 2>&1 || true
echo "Smoke test OK"
