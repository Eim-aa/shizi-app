#!/bin/sh
set -eu

REPO_ROOT="$(cd "${SRCROOT}/../.." && pwd)"
DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/Web"

rm -rf "${DEST}"
mkdir -p "${DEST}"

rsync -a --delete \
  "${REPO_ROOT}/index.html" \
  "${REPO_ROOT}/deck-data.js" \
  "${REPO_ROOT}/core-strokes.js" \
  "${REPO_ROOT}/hanzi-writer.min.js" \
  "${REPO_ROOT}/fsrs6.min.js" \
  "${REPO_ROOT}/sw.js" \
  "${REPO_ROOT}/manifest.webmanifest" \
  "${REPO_ROOT}/icon-180.png" \
  "${REPO_ROOT}/icon-192.png" \
  "${REPO_ROOT}/icon-512.png" \
  "${DEST}/"

rsync -a --delete "${REPO_ROOT}/data/" "${DEST}/data/"

test -f "${DEST}/index.html"
test -f "${DEST}/deck-data.js"
test -f "${DEST}/core-strokes.js"
test -f "${DEST}/hanzi-writer.min.js"
test -f "${DEST}/fsrs6.min.js"
test -d "${DEST}/data"
