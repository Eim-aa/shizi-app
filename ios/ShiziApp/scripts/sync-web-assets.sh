#!/bin/bash
# Xcode Run Script「Sync Web Assets」：把原生仍在读的资源同步进 App 包的 Web/。
# B4.9：App 里已没有 JS / WKWebView。包里 Web/ 只剩 data/（笔顺 / 字源 JSON，原生直读 Web/data/<字>.json）、fonts/（NativeType / ShiziScreen /
# ImageRenderer 读 Web/fonts/*.woff2）与 licenses/；清单 scripts/app-bundle-manifest.txt 由 `pnpm run build:manifest`
# （scripts/build_shell_manifest.mjs APP_BUNDLE_ROOTS）生成。网页壳（src/、vendor/、index.html …）冻结在仓库里，不进包。
# 关于页的版本行写成 Web/build-info.json（原生读 JSON；D84 起不读 src/build-info.js）：
#   version = MARKETING_VERSION（Xcode 构建设置，来自 Config/Shared.xcconfig；不在 Xcode 里跑时直接读 Shared.xcconfig）
#   build   = <HEAD 提交日 yyyymmdd>-<HEAD 的 12 位短 hash>：仍是「<yyyymmdd>-<12 hex>」的形状，关于页「版本 1.0.0（yyyymmdd）」与
#             点按看到的完整构建号格式都不变。
set -euo pipefail

REPO_ROOT="$(cd "${SRCROOT}/../.." && pwd)"
DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/Web"
MANIFEST="${REPO_ROOT}/scripts/app-bundle-manifest.txt"
XCCONFIG="${REPO_ROOT}/ios/ShiziApp/Config/Shared.xcconfig"

test -f "${MANIFEST}" || { echo "error: missing ${MANIFEST}; run: pnpm run build:manifest" >&2; exit 65; }

rm -rf "${DEST}"
mkdir -p "${DEST}"

rsync -a --files-from="${MANIFEST}" "${REPO_ROOT}/" "${DEST}/"

VERSION="${MARKETING_VERSION:-}"
if [ -z "${VERSION}" ]; then
  VERSION="$(sed -n 's/^[[:space:]]*MARKETING_VERSION[[:space:]]*=[[:space:]]*\([0-9][^[:space:]]*\).*$/\1/p' "${XCCONFIG}" | head -n 1)"
fi
BUILD_DAY="$(git -C "${REPO_ROOT}" log -1 --format=%cd --date=format:%Y%m%d 2>/dev/null || true)"
BUILD_HASH="$(git -C "${REPO_ROOT}" rev-parse --short=12 HEAD 2>/dev/null || true)"
BUILD="${BUILD_DAY}-${BUILD_HASH}"
[[ "${VERSION}" =~ ^[0-9][0-9A-Za-z.+-]*$ ]] || { echo "error: cannot read MARKETING_VERSION (build setting or ${XCCONFIG})" >&2; exit 65; }
[[ "${BUILD}" =~ ^[0-9]{8}-[0-9a-f]{12}$ ]] || { echo "error: cannot derive BUILD from git HEAD of ${REPO_ROOT} (got '${BUILD}')" >&2; exit 65; }
printf '{"version":"%s","build":"%s"}\n' "${VERSION}" "${BUILD}" > "${DEST}/build-info.json"

test -d "${DEST}/data"
test -d "${DEST}/fonts"
test -d "${DEST}/licenses"
# 网页壳不得进包
for gone in src vendor assets index.html deck-data.js core-strokes.js sw.js sw-manifest.js manifest.webmanifest; do
  test ! -e "${DEST}/${gone}" || { echo "error: Web/${gone} must not be in the app bundle (B4.9)" >&2; exit 65; }
done

# P1-S2 原生书写面 spike（只在 Debug）：笔锋模型金标准向量与参考实现摘要进包，供 -shizi-ink-selfcheck 在模拟器 / 真机上自检。
INK_DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/InkModel"
rm -rf "${INK_DEST}"
# B3.3 QA-H1 夹具（只在 Debug）：ShiziUITests/States 的 JSON 进包的 QAStates/，NativeQAHarness / QAFixtures 按状态名读（Release 不含）。
# B4.9：op 由 Swift 执行（QAOps.swift）；_ops/*.js、_runtime/*.js 只是网页参考的开发工具（scripts/native-ui/fixture-dev.mjs）用，不进包。
QA_DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/QAStates"
rm -rf "${QA_DEST}"
if [ "${CONFIGURATION:-}" = "Debug" ]; then
  mkdir -p "${QA_DEST}"
  rsync -a --exclude '*.js' "${SRCROOT}/ShiziUITests/States/" "${QA_DEST}/"
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
