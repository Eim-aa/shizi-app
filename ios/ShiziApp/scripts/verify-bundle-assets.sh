#!/bin/sh
set -eu

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
EXPECTED_COUNT="$(find "${REPO_ROOT}/data" -name '*.json' | wc -l | tr -d ' ')"

test -d "$APP" || { echo "App bundle not found: $APP" >&2; exit 66; }
test -f "${WEB}/index.html" || { echo "Missing Web/index.html" >&2; exit 65; }
test -f "${WEB}/deck-data.js" || { echo "Missing Web/deck-data.js" >&2; exit 65; }
test -f "${WEB}/core-strokes.js" || { echo "Missing Web/core-strokes.js" >&2; exit 65; }
test -f "${WEB}/hanzi-writer.min.js" || { echo "Missing Web/hanzi-writer.min.js" >&2; exit 65; }
test -f "${WEB}/fsrs6.min.js" || { echo "Missing Web/fsrs6.min.js" >&2; exit 65; }
test -f "${WEB}/manifest.webmanifest" || { echo "Missing Web/manifest.webmanifest" >&2; exit 65; }
test -d "${WEB}/data" || { echo "Missing Web/data" >&2; exit 65; }
test -f "${APP}/PrivacyInfo.xcprivacy" || { echo "Missing PrivacyInfo.xcprivacy" >&2; exit 65; }
plutil -lint "${APP}/PrivacyInfo.xcprivacy" >/dev/null

ACTUAL_COUNT="$(find "${WEB}/data" -name '*.json' | wc -l | tr -d ' ')"
if [ "$ACTUAL_COUNT" != "$EXPECTED_COUNT" ]; then
  echo "data/*.json count mismatch: expected ${EXPECTED_COUNT}, got ${ACTUAL_COUNT}" >&2
  exit 65
fi

echo "OK: ${APP}"
echo "Web assets present; data JSON count = ${ACTUAL_COUNT}"
