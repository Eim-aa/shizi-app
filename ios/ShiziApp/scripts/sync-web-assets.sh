#!/bin/bash
# Xcode Run Script「Sync Web Assets」：按壳清单把 Web 资源同步进 App 包的 Web/。
# 清单 scripts/shell-manifest.txt 由 `pnpm run build:manifest`（scripts/build_shell_manifest.mjs）生成，
# 逐行一个相对仓库根的文件路径；新增的 src/、vendor/、fonts/ 等文件只要重新生成清单就会进包。
set -euo pipefail

REPO_ROOT="$(cd "${SRCROOT}/../.." && pwd)"
DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/Web"
MANIFEST="${REPO_ROOT}/scripts/shell-manifest.txt"

test -f "${MANIFEST}" || { echo "error: missing ${MANIFEST}; run: pnpm run build:manifest" >&2; exit 65; }

rm -rf "${DEST}"
mkdir -p "${DEST}"

rsync -a --files-from="${MANIFEST}" "${REPO_ROOT}/" "${DEST}/"

test -f "${DEST}/index.html"
test -f "${DEST}/deck-data.js"
test -f "${DEST}/core-strokes.js"
test -f "${DEST}/vendor/hanzi-writer.min.js"
test -f "${DEST}/vendor/fsrs6.min.js"
test -f "${DEST}/src/app.js"
test -f "${DEST}/manifest.webmanifest"
test -d "${DEST}/data"
