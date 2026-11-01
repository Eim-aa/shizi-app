#!/bin/bash
# B4.9c：ShiziCore 包的资源包是否完整进了 App。
# Package.swift 里每个库 target 的 `.copy("<目录>")` 都必须以 <目录名>/ 出现在 Shizi.app/ShiziCore_<target>.bundle 里，
# 且文件清单与源目录一致。增量构建（共用的 DerivedData）在 Package.swift 新加资源目录后可能不重新生成资源包——
# 2026-11-01 B4.9c：native-ui/DerivedData 的 ShiziCore_ShiziCore.bundle 一直没有 SessionBundled/（B4.6 之后加的），
# SwiftEngine 第一次读 session-ui.json 就崩，XCUITest 流程 180 例全挂。
# 用法：verify-core-bundles.sh /path/to/Shizi.app|/path/to/Shizi.xcarchive   退出码 0 = 齐全，65 = 缺 / 不一致。
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 /path/to/Shizi.app|/path/to/Shizi.xcarchive" >&2
  exit 64
fi
case "$1" in
  *.xcarchive) APP="$1/Products/Applications/Shizi.app" ;;
  *) APP="$1" ;;
esac
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG="$(cd "${SCRIPT_DIR}/../../ShiziCore" && pwd)"
test -d "$APP" || { echo "App bundle not found: $APP" >&2; exit 66; }

missing=0
checked=0
# 只看 .target(...)（不看 testTarget）：name、path（缺省 Sources/<name>）、resources 里的 .copy("…")
while IFS='|' read -r name path copies; do
  [ -n "$name" ] || continue
  [ -n "$path" ] || path="Sources/$name"
  bundle="$APP/ShiziCore_${name}.bundle"
  for rel in $copies; do
    checked=$((checked + 1))
    src="$PKG/$path/$rel"
    dst="$bundle/$(basename "$rel")"
    if [ ! -d "$dst" ]; then
      echo "Missing ShiziCore_${name}.bundle/$(basename "$rel")/ (Package.swift .copy(\"$rel\"))" >&2
      missing=$((missing + 1))
      continue
    fi
    if ! diff -q <(cd "$src" && find . -type f ! -name '.DS_Store' | LC_ALL=C sort) <(cd "$dst" && find . -type f ! -name '.DS_Store' | LC_ALL=C sort) >/dev/null; then
      echo "ShiziCore_${name}.bundle/$(basename "$rel")/ file list differs from $path/$rel" >&2
      missing=$((missing + 1))
    fi
  done
done < <(node -e '
const src = require("fs").readFileSync(process.argv[1], "utf8");
for (const m of src.matchAll(/\.target\(\s*name:\s*"([^"]+)"([^\n]*)/g)) {
  const rest = m[2];
  const path = (rest.match(/path:\s*"([^"]+)"/) || [])[1] || "";
  const copies = [...rest.matchAll(/\.copy\("([^"]+)"\)/g)].map(c => c[1]);
  if (copies.length) console.log([m[1], path, copies.join(" ")].join("|"));
}' "$PKG/Package.swift")

[ "$checked" -gt 0 ] || { echo "verify-core-bundles: no .copy resources parsed from Package.swift" >&2; exit 65; }
if [ "$missing" != 0 ]; then
  echo "${missing} ShiziCore resource folder(s) missing or stale in $APP" >&2
  exit 65
fi
echo "OK: ShiziCore resource bundles (${checked} folder(s))"
