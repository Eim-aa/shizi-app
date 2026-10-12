#!/usr/bin/env bash
# 把许可证要求公开的数据同步到公开数据仓库 shizi-open 的本地克隆（D59）。
#
# 用法：
#   scripts/sync-open-data.sh <shizi-open 本地克隆目录>
#
# 例：每次 App 发版前
#   git clone https://github.com/Eim-aa/shizi-open.git ../shizi-open   # 首次
#   scripts/sync-open-data.sh ../shizi-open
#   cd ../shizi-open && git add -A && git commit -m "data: sync for App <版本>"
#   git tag v<版本>-data && git push origin main --tags                  # 每个 App 版本一个标签
#
# 复制的内容（本仓库 → shizi-open）：
#   data/*.json                                          → data/          （全部笔顺 + etymology.json；目标里多出来的 .json 会删掉）
#   data/LICENSE.md                                      → data/LICENSE.md（改成 shizi-open 的路径说法，见下）
#   licenses/{ARPHICPL.TXT,LGPL-3.0.txt,GPL-3.0.txt,Apache-2.0.txt,LXGW-WenKai-GB-OFL.txt} → licenses/
#   audit/compliance-2026-10/arphic-modification-notices.json → notices/arphic-modification-notices.json
# 不复制 data/context-overrides.js（项目自有内容，不在公开义务范围内）、App 代码与 README（shizi-open 自己维护 README）。
#
# 只改工作区，不提交、不打标签、不推送；跑完看 git status / git diff 再提交。
set -euo pipefail

if [ "$#" -ne 1 ]; then
  sed -n '2,20p' "$0" >&2
  exit 2
fi

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$(cd "$1" && pwd)"

if [ ! -d "$DEST/.git" ]; then
  echo "error: $DEST is not a git clone" >&2
  exit 1
fi
remote="$(git -C "$DEST" remote get-url origin 2>/dev/null || true)"
case "$remote" in
  *Eim-aa/shizi-open*) ;;
  *) echo "error: $DEST origin is '$remote', expected github.com/Eim-aa/shizi-open" >&2; exit 1 ;;
esac
if [ "$DEST" = "$SRC" ]; then
  echo "error: destination is this repository" >&2
  exit 1
fi

mkdir -p "$DEST/data" "$DEST/licenses" "$DEST/notices"

# 1. data/*.json：先删目标里的旧 .json（处理移除的字），再整批复制。
find "$DEST/data" -maxdepth 1 -type f -name '*.json' -delete
find "$SRC/data" -maxdepth 1 -type f -name '*.json' -exec cp -p {} "$DEST/data/" \;

# 2. data/LICENSE.md：换成 shizi-open 里的路径说法。
python3 -I - "$SRC/data/LICENSE.md" "$DEST/data/LICENSE.md" <<'PY'
import sys
src, dest = sys.argv[1], sys.argv[2]
text = open(src, encoding="utf-8").read()

def swap(old, new):
    global text
    if old not in text:
        sys.exit(f"data/LICENSE.md changed; update sync-open-data.sh: missing {old!r}")
    text = text.replace(old, new)

swap('The files in this folder are **not** covered by the root `LICENSE` ("All\nrights reserved").',
     'The files in this folder are **not** covered by the Shizi app\'s own license\n("All rights reserved").')
swap("`audit/compliance-2026-10/arphic-modification-notices.json`",
     "`notices/arphic-modification-notices.json`")
swap("(decision D50; `audit/compliance-2026-10/`).", "(2026-10-04).")
head, sep, _ = text.partition("\n## Context-word overrides: `data/context-overrides.js`")
if not sep:
    sys.exit("data/LICENSE.md changed; update sync-open-data.sh: context-overrides section not found")
text = head.rstrip("\n") + "\n"
for leftover in ("audit/", "context-overrides", "root `LICENSE`"):
    if leftover in text:
        sys.exit(f"data/LICENSE.md still mentions {leftover!r} after adaptation")
open(dest, "w", encoding="utf-8").write(text)
PY

# 3. 许可全文。
for f in ARPHICPL.TXT LGPL-3.0.txt GPL-3.0.txt Apache-2.0.txt LXGW-WenKai-GB-OFL.txt; do
  cp -p "$SRC/licenses/$f" "$DEST/licenses/$f"
done

# 4. 修改说明清单。
cp -p "$SRC/audit/compliance-2026-10/arphic-modification-notices.json" "$DEST/notices/arphic-modification-notices.json"

# 5. 自检：字数、修改说明数一致，_notice 已指向 shizi-open。
python3 -I - "$DEST" <<'PY'
import json, pathlib, sys
dest = pathlib.Path(sys.argv[1])
chars = [p for p in (dest / "data").glob("*.json") if p.name != "etymology.json"]
notices = json.loads((dest / "notices/arphic-modification-notices.json").read_text(encoding="utf-8"))
annotated = 0
for row in notices["records"]:
    payload = json.loads((dest / row["data_path"]).read_text(encoding="utf-8"))
    if payload.get("_notice") != row["notice"]:
        sys.exit(f"notice mismatch: {row['data_path']}")
    if "Eim-aa/shizi-open" not in row["notice"] or "Eim-aa/shizi-app" in row["notice"]:
        sys.exit(f"notice does not point at shizi-open: {row['data_path']}")
    annotated += 1
print(f"synced {len(chars)} stroke files + etymology.json; {annotated} files carry _notice")
PY

git -C "$DEST" status --short | awk '{print $1}' | sort | uniq -c | sed 's/^/  changes: /'
echo "next: cd \"$DEST\" && git add -A && git commit && git tag v<App version>-data"
