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

# P1-S2 原生书写面 spike（只在 Debug）：笔锋模型金标准向量与参考实现摘要进包，供 -shizi-ink-selfcheck 在模拟器 / 真机上自检。
INK_DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/InkModel"
rm -rf "${INK_DEST}"
if [ "${CONFIGURATION:-}" = "Debug" ]; then
  INK_SRC="${REPO_ROOT}/docs/engineering/v10/phase1/ink-model"
  mkdir -p "${INK_DEST}"
  cp "${INK_SRC}/vectors.json" "${INK_SRC}/out/reference-dump.json" "${INK_SRC}/ink-v4-fixture.json" "${INK_DEST}/"
  # ProMotion 120Hz：CADisplayLink 要超过 60Hz 需要 CADisableMinimumFrameDurationOnPhone。只在显式要求时（xcodebuild … SHIZI_NATIVE_INK_120HZ=YES，
  # run-device.sh NATIVE_INK=1 会带上）写进 Debug 包的 Info.plist，平常的 Debug / Release 构建不变。
  PLIST="${TARGET_BUILD_DIR}/${INFOPLIST_PATH}"
  if [ -f "${PLIST}" ]; then
    # 先删：上一次带开关的增量构建留下的键不会因 Info.plist 未变而被 Xcode 重写
    /usr/libexec/PlistBuddy -c "Delete :CADisableMinimumFrameDurationOnPhone" "${PLIST}" >/dev/null 2>&1 || true
    if [ "${SHIZI_NATIVE_INK_120HZ:-NO}" = "YES" ]; then
      /usr/libexec/PlistBuddy -c "Add :CADisableMinimumFrameDurationOnPhone bool true" "${PLIST}"
    fi
  fi
fi
