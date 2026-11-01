#!/bin/bash
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 /path/to/Shizi.app|/path/to/Shizi.xcarchive" >&2
  exit 64
fi

INPUT=$1
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

case "$INPUT" in
  *.xcarchive)
    APP="${INPUT}/Products/Applications/Shizi.app"
    ;;
  *.app)
    APP="$INPUT"
    ;;
  *)
    echo "Expected a .app bundle or .xcarchive: $INPUT" >&2
    exit 64
    ;;
esac

WEB="${APP}/Web"
MANIFEST="${REPO_ROOT}/scripts/shell-manifest.txt"
EXPECTED_COUNT="$(find "${REPO_ROOT}/data" -name '*.json' | wc -l | tr -d ' ')"

test -d "$APP" || { echo "App bundle not found: $APP" >&2; exit 66; }
test -f "$MANIFEST" || { echo "Missing ${MANIFEST}; run: pnpm run build:manifest" >&2; exit 65; }
test -f "${WEB}/index.html" || { echo "Missing Web/index.html" >&2; exit 65; }
test -f "${WEB}/deck-data.js" || { echo "Missing Web/deck-data.js" >&2; exit 65; }
test -f "${WEB}/core-strokes.js" || { echo "Missing Web/core-strokes.js" >&2; exit 65; }
test -f "${WEB}/vendor/hanzi-writer.min.js" || { echo "Missing Web/vendor/hanzi-writer.min.js" >&2; exit 65; }
test -f "${WEB}/vendor/fsrs6.min.js" || { echo "Missing Web/vendor/fsrs6.min.js" >&2; exit 65; }
test -f "${WEB}/src/app.js" || { echo "Missing Web/src/app.js" >&2; exit 65; }
test -f "${WEB}/manifest.webmanifest" || { echo "Missing Web/manifest.webmanifest" >&2; exit 65; }
test -d "${WEB}/data" || { echo "Missing Web/data" >&2; exit 65; }

# 壳清单逐行核对：清单里的每个文件都必须在包内。
MANIFEST_COUNT=0
MISSING_COUNT=0
while IFS= read -r rel || [ -n "$rel" ]; do
  case "$rel" in ''|'#'*) continue ;; esac
  MANIFEST_COUNT=$((MANIFEST_COUNT + 1))
  if [ ! -f "${WEB}/${rel}" ]; then
    MISSING_COUNT=$((MISSING_COUNT + 1))
    [ "$MISSING_COUNT" -le 20 ] && echo "Missing Web/${rel} (listed in shell-manifest.txt)" >&2
  fi
done < "$MANIFEST"
if [ "$MISSING_COUNT" != 0 ]; then
  echo "${MISSING_COUNT} shell-manifest file(s) missing from bundle" >&2
  exit 65
fi
"${SCRIPT_DIR}/verify-core-bundles.sh" "$APP" >/dev/null || exit 65 # B4.9c：ShiziCore 资源包齐全
test -f "${APP}/PrivacyInfo.xcprivacy" || { echo "Missing PrivacyInfo.xcprivacy" >&2; exit 65; }
plutil -lint "${APP}/PrivacyInfo.xcprivacy" >/dev/null

# A6（G18）中文本地化：包内必须有 zh-Hans.lproj/InfoPlist.strings，Info.plist 声明 zh-Hans 为开发区域与唯一本地化，
# 系统组件（分享面板、存到文件、时间选择器、文本菜单）才会用中文。
test -f "${APP}/zh-Hans.lproj/InfoPlist.strings" || { echo "Missing zh-Hans.lproj/InfoPlist.strings" >&2; exit 65; }
plutil -lint "${APP}/zh-Hans.lproj/InfoPlist.strings" >/dev/null
test "$(plutil -extract CFBundleDevelopmentRegion raw -o - "${APP}/Info.plist")" = "zh-Hans" \
  || { echo "Info.plist CFBundleDevelopmentRegion is not zh-Hans" >&2; exit 65; }
test "$(plutil -extract CFBundleLocalizations.0 raw -o - "${APP}/Info.plist")" = "zh-Hans" \
  || { echo "Info.plist CFBundleLocalizations does not start with zh-Hans" >&2; exit 65; }
if plutil -extract CFBundleLocalizations.1 raw -o - "${APP}/Info.plist" >/dev/null 2>&1; then
  echo "Info.plist CFBundleLocalizations has more than zh-Hans" >&2
  exit 65
fi

# A7（G19）启动底色：UILaunchScreen.UIColorName = Paper，且 Paper 颜色集已编进 Assets.car，并与 tokens.css 的 --p 同源。
test "$(plutil -extract UILaunchScreen.UIColorName raw -o - "${APP}/Info.plist")" = "Paper" \
  || { echo "Info.plist UILaunchScreen.UIColorName is not Paper" >&2; exit 65; }
test -f "${APP}/Assets.car" || { echo "Missing Assets.car" >&2; exit 65; }
if command -v xcrun >/dev/null 2>&1 && xcrun --find assetutil >/dev/null 2>&1; then
  xcrun assetutil --info "${APP}/Assets.car" 2>/dev/null | grep -q '"Name" : "Paper"' \
    || { echo "Assets.car has no Paper color" >&2; exit 65; }
fi
node "${SCRIPT_DIR}/generate-paper-colorset.mjs" --check

ACTUAL_COUNT="$(find "${WEB}/data" -name '*.json' | wc -l | tr -d ' ')"
if [ "$ACTUAL_COUNT" != "$EXPECTED_COUNT" ]; then
  echo "data/*.json count mismatch: expected ${EXPECTED_COUNT}, got ${ACTUAL_COUNT}" >&2
  exit 65
fi

echo "OK: ${APP}"
echo "Web assets present; shell-manifest files = ${MANIFEST_COUNT}; data JSON count = ${ACTUAL_COUNT}"
