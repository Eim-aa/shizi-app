#!/bin/bash
# 笔锋模型 Swift 移植的金标准自检（P1-S2 原生书写面 spike）：在 macOS 上用 swiftc 编译 App 里的同一份
# InkModel.swift / InkModelCheck.swift，对 docs/engineering/v10/phase1/ink-model/vectors.json 跑 check.mjs 同口径断言，
# 并与 reference.mjs 的输出（out/reference-dump.json）逐值比较。全部通过退出码 0。
# 用法：ios/ShiziApp/scripts/ink-model-check.sh [--json out.json]
# 模拟器 / 真机上的同一自检：DEBUG 启动参数 -shizi-ink-selfcheck（结果写 App 的 Documents/shizi-ink-selfcheck.json）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IOS_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${IOS_ROOT}/../.." && pwd)"
MODEL_DIR="${REPO_ROOT}/docs/engineering/v10/phase1/ink-model"
WORK="${TMPDIR:-/tmp}/shizi-ink-model-check"
mkdir -p "${WORK}"
# 顶层语句只允许出现在名为 main.swift 的文件里：入口复制一份再编译。
cp "${SCRIPT_DIR}/ink-model-check-main.swift" "${WORK}/main.swift"

xcrun swiftc -O -D DEBUG \
  "${IOS_ROOT}/ShiziApp/InkModel.swift" \
  "${IOS_ROOT}/ShiziApp/InkModelCheck.swift" \
  "${WORK}/main.swift" \
  -o "${WORK}/ink-model-check"

"${WORK}/ink-model-check" "${MODEL_DIR}/vectors.json" "${MODEL_DIR}/out/reference-dump.json" "$@"
