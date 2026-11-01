#!/bin/bash
# B4.9 移除脚本（预备）：从 scripts/b49/inventory.mjs 的盘点出发，删除 §4.5 第 3 条点名的仓库文件。
#
# 默认 dry-run：只打印「将要删除 / 将要修改」，不落一笔、不改任何文件。
# 真删除需要显式 --apply；即便 --apply 也只动白名单里的文件——src/ 永不删（§4.5 第 5 条：
# 冻结保留为参考实现与测试先知），ios/、data/、fonts/、licenses/、assets/ 永不删。
#
# 网页版（GitHub Pages / PWA）的去留是 D59 ④ 未决事项。--apply 只删包内不再需要的仓库文件时，
# 必须先由负责人拍板网页版不保留，再额外加 --web-retired；没有它，index.html / sw.js /
# deck-data.js / vendor/ 等网页构建输入一律保留（删了它们网页版就没了）。
#
# Swift / 构建脚本的修改（WebEngine、窗口根、断言收窄等）不是机械删除，见
# docs/engineering/v10/B4.9-移除清单.md 的操作顺序一节，本脚本只打印清单。
#
# 用法：
#   bash scripts/b49/remove.sh                      dry-run（缺省）
#   bash scripts/b49/remove.sh --json               dry-run，机器可读
#   bash scripts/b49/remove.sh --apply              真删除（仅白名单文件；要求工作区干净）
#   bash scripts/b49/remove.sh --apply --web-retired
#                                                   在 --apply 基础上连网页构建输入一起删（D59 ④ 已定不保留网页版）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

APPLY=0
WEB_RETIRED=0
JSON_OUT=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --web-retired) WEB_RETIRED=1 ;;
    --json) JSON_OUT=1 ;;
    *) echo "unknown arg: $arg (supported: --apply --web-retired --json)" >&2; exit 64 ;;
  esac
done

# 白名单：允许 --apply 删除的路径（相对仓库根）。全部来自 §4.5 第 3 条的点名清单。
# src/ 不在名单里——它在仓库冻结保留；ios/、data/、fonts/、licenses/、assets/ 不在名单里。
WEB_INPUTS=(
  index.html
  deck-data.js
  core-strokes.js
  sw.js
  sw-manifest.js
  manifest.webmanifest
  icon-180.png
  icon-192.png
  icon-512.png
  icon-512-maskable.png
)
# vendor/ 单独处理（整个目录）。

deleted=()
skipped=()

for f in "${WEB_INPUTS[@]}"; do
  if [ -f "$f" ]; then
    if [ "$WEB_RETIRED" = 1 ]; then deleted+=("$f"); else skipped+=("$f"); fi
  fi
done
if [ -d vendor ]; then
  if [ "$WEB_RETIRED" = 1 ]; then deleted+=("vendor/"); else skipped+=("vendor/"); fi
fi

src_files=0
if [ -d src ]; then
  src_files=$(find src -type f | wc -l | tr -d ' ')
fi

if [ "$JSON_OUT" = 1 ]; then
  node scripts/b49/inventory.mjs --json
  exit 0
fi

echo "B4.9 移除脚本 —— $( [ "$APPLY" = 1 ] && echo 'APPLY（真删除）' || echo 'DRY-RUN（不删任何东西）' )"
echo "仓库：$(pwd)"
echo

echo "== 将删除（§4.5 第 3 条点名、包内不再需要）=="
if [ "${#deleted[@]}" -gt 0 ]; then
  for f in "${deleted[@]}"; do echo "  rm $f"; done
else
  echo "  （无）"
fi
if [ "$WEB_RETIRED" != 1 ] && [ "${#skipped[@]}" -gt 0 ]; then
  echo
  echo "== 暂不删除（网页构建输入；D59 ④ 未决。要删需 --apply --web-retired）=="
  for f in "${skipped[@]}"; do echo "  keep $f"; done
fi
echo
echo "== 永不删除 =="
echo "  src/（$src_files 个文件——冻结保留为参考实现与测试先知，§4.5 第 5 条）"
echo "  ios/、data/、fonts/、licenses/、assets/（原生仍在读包内 Web/fonts 与 Web/assets/sound）"
echo

echo "== 将修改（非机械修改，B4.9 卡内逐项做；本脚本不代改）=="
node scripts/b49/inventory.mjs | sed -n '/^(b) Swift/,/^(e) 必须保留/p' | grep -E '^\s+\[(delete|simplify|rewrite|收窄|改断言|摘除|改|重新生成|随|保留)\]' || true
echo

if [ "$APPLY" != 1 ]; then
  echo "DRY-RUN：以上只是清单，没有删除、没有修改任何文件。"
  exit 0
fi

if [ "$WEB_RETIRED" != 1 ] && [ "${#deleted[@]}" = 0 ]; then
  echo "APPLY：没有可删文件（--web-retired 未加，网页构建输入保留）。只打印了修改清单。"
  exit 0
fi

# --apply 安全阀：要求已跟踪文件无未提交改动（B4.9 在干净分支上跑）。
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "error: 工作区有未提交改动；--apply 只能在干净分支上运行（先提交或 stash）。" >&2
  exit 65
fi

for f in "${deleted[@]}"; do
  if [ "$f" = "vendor/" ]; then
    git rm -r -q vendor
  else
    git rm -q "$f"
  fi
  echo "deleted: $f"
done
echo
echo "APPLY 完成：删除了 ${#deleted[@]} 项。后续（非机械）步骤见 docs/engineering/v10/B4.9-移除清单.md："
echo "  1) Swift 侧删 WebEngine / NativeWriteBridge / LocalWebSchemeHandler(+NativeStoreBridge)，窗口根换原生；"
echo "     声音播放（Web/assets/sound）与提醒深链派发先搬到新根"
echo "  2) build_shell_manifest.mjs 收根（data/fonts/licenses/assets）→ pnpm run build:manifest"
echo "  3) sync-web-assets.sh / verify-bundle-assets.sh 改断言（不含 Web/src、含 deck.json）"
echo "  4) package.json 摘 verify:pwa / verify:web / verify:sw-unit / verify:webkit-ax"
echo "  5) e2e 停跑：scripts/e2e/batch.mjs 加 retired.json"
