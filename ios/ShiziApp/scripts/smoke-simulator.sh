#!/bin/sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IOS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT="${IOS_ROOT}/ShiziApp.xcodeproj"
SCHEME="${SCHEME:-Shizi}"
CONFIGURATION="${CONFIGURATION:-Debug}"
DEVICE="${DEVICE:-booted}"
APP_ID="${APP_ID:-com.eimaa.shizi}"
OUT_DIR="${OUT_DIR:-${IOS_ROOT}/build/smoke}"
DEV_MODE="${DEV_MODE:-0}"
MODE_NAME="normal"
if [ "$DEV_MODE" = "1" ]; then
  MODE_NAME="dev"
fi

launch_app() {
  if [ "$DEV_MODE" = "1" ]; then
    xcrun simctl launch "$DEVICE" "$APP_ID" "$@" -shizi-dev >/dev/null
  else
    xcrun simctl launch "$DEVICE" "$APP_ID" "$@" >/dev/null
  fi
}

wait_for_local_storage_db() {
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    db_path="$(find "${DATA_CONTAINER}/Library/WebKit" -path '*LocalStorage/localstorage.sqlite3' -type f 2>/dev/null | head -1 || true)"
    if [ -n "$db_path" ]; then
      key_count="$(sqlite3 "$db_path" "select count(*) from ItemTable where key like 'shizi.%';" 2>/dev/null || printf '0')"
      case "$key_count" in
        ''|*[!0-9]*) key_count=0 ;;
      esac
      if [ "$key_count" -gt 0 ]; then
        printf '%s\n' "$db_path"
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

mkdir -p "$OUT_DIR"

echo "Building ${SCHEME} for iOS Simulator"
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build

APP="$(find "${HOME}/Library/Developer/Xcode/DerivedData" -path "*/Build/Products/${CONFIGURATION}-iphonesimulator/Shizi.app" -type d | tail -1)"
test -d "$APP" || { echo "Simulator app not found" >&2; exit 66; }

"${SCRIPT_DIR}/verify-bundle-assets.sh" "$APP"

echo "Installing ${APP_ID} on ${DEVICE}"
xcrun simctl install "$DEVICE" "$APP"
DATA_CONTAINER="$(xcrun simctl get_app_container "$DEVICE" "$APP_ID" data)"
NATIVE_SMOKE_JSON="${DATA_CONTAINER}/Documents/shizi-native-smoke.json"
rm -f "$NATIVE_SMOKE_JSON"
xcrun simctl terminate "$DEVICE" "$APP_ID" >/dev/null 2>&1 || true
launch_app -shizi-smoke

SCREENSHOT="${OUT_DIR}/shizi-simulator-${MODE_NAME}.png"
xcrun simctl io "$DEVICE" screenshot "$SCREENSHOT" >/dev/null
echo "Screenshot: ${SCREENSHOT}"

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [ -f "$NATIVE_SMOKE_JSON" ]; then
    break
  fi
  sleep 1
done

if [ ! -f "$NATIVE_SMOKE_JSON" ]; then
  echo "Native WKWebView smoke result was not written" >&2
  exit 65
fi

python3 "${SCRIPT_DIR}/validate-native-smoke.py" "$NATIVE_SMOKE_JSON" "$DEV_MODE" 0

if ! DB="$(wait_for_local_storage_db)"; then
  echo "WKWebView LocalStorage database was not created" >&2
  exit 65
fi

KEYS="$(sqlite3 "$DB" "select key from ItemTable where key like 'shizi.%' order by key;")"
if ! printf '%s\n' "$KEYS" | grep -q '^shizi.opens.v1$'; then
  echo "Expected shizi.opens.v1 in WKWebView LocalStorage, got:" >&2
  printf '%s\n' "$KEYS" >&2
  exit 65
fi

echo "WKWebView LocalStorage keys:"
printf '%s\n' "$KEYS"

echo "Restarting app to verify WKWebView LocalStorage persists"
xcrun simctl terminate "$DEVICE" "$APP_ID" >/dev/null 2>&1 || true
launch_app
if ! DB_AFTER_RESTART="$(wait_for_local_storage_db)"; then
  echo "WKWebView LocalStorage database disappeared after app restart" >&2
  exit 65
fi

PERSISTED_SMOKE_COUNT="$(sqlite3 "$DB_AFTER_RESTART" "select count(*) from ItemTable where key = 'shizi.nativeSmoke.v1';")"
if [ "$PERSISTED_SMOKE_COUNT" != "1" ]; then
  echo "Expected shizi.nativeSmoke.v1 to persist after app restart, got count ${PERSISTED_SMOKE_COUNT}" >&2
  exit 65
fi

echo "WKWebView LocalStorage persisted across app restart"
echo "Smoke test OK"
