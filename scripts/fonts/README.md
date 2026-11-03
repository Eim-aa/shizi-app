# 拾字字体：子集语料与重建（v10 M5-2，决定-D13）

随 App 分发的只有 `fonts/` 下五个文件（三份 WOFF2、`fonts.css`、`coverage-manifest.json`）和 `licenses/` 下两份原 OFL 与 `Shizi-fonts-COPYRIGHT-NOTICES.md`。本目录是构建工具与证据，**不进包**（不在 `scripts/shell-manifest.txt` 的根列表里；#180 README：「不要把整个交接目录放进 App」）。

来源：#180 `origin/pr-180:handoff/r8-foundation/fonts/`（F8 r2）。

| 路径 | 内容 | 与 #180 的关系 |
|---|---|---|
| `requirements.txt` | 固定 Python 依赖（fonttools 4.66.0 等） | 逐字节沿用 |
| `provenance/download-lock.json` | 上游字体与 OFL 的官方 URL、字节数、SHA-256 | 逐字节沿用 |
| `scripts/build-fonts.py`、`font_options.py`、`diagnose-gpos.py` | 子集、静态化、改名、GPOS 归因 | 逐字节沿用（单测核 SHA） |
| `scripts/reproduce.py` | 在新目录下载 / 核验上游、构建、与随包字体比 SHA；`--install` 装进 `fonts/` | 改造：`--corpus v10\|f8`、`--install`、runtime manifest 路径改成 `fonts/` 相对 |
| `corpus/f8/*.txt` | #180 冻结语料（Kai 7669、Serif 925 码点） | 逐字节沿用 |
| `corpus/*.txt` | 第十稿语料 = F8 ∪ 界面实际文字（`build_corpus.mjs` 生成） | 新增 |
| `reports/*.json` | 第十稿构建报告（每份 TTF / WOFF2 的字节数、SHA、字形数、cmap 数、GSUB/GPOS 特性、名称表） | 由 `--install` 写出 |
| `reports/f8/` | #180 的 build-manifest / coverage / GPOS 归因说明（`--corpus f8` 比对用） | 逐字节沿用 |

## 语料范围（03 P22）

`build_corpus.mjs` 按 `FACE_SOURCES` 收集（NFC，去空白与控制字符）：

- **ShiziKai 400**：ShiziKitCopy.json / Bundled/copy.json 全部值、题记、四库名、题面固定字串、题库卡片 word / py / hint / promptHint、字源 gloss / source。
- **ShiziSerifSC 400 / 500**：ShiziKitCopy.json / Bundled/copy.json 全部值、题记、四库名、题库拼音 py。

`test/core/font-loader.test.mjs` 读 `fonts/coverage-manifest.json` 按同一张表逐项断言缺字为 0，并跑 `build_corpus.mjs --check`。文案或题库新增了字形外的字符时这两处会红：按下面步骤重建。

## 重建

需要 Python 3.12+（本机用 `/opt/homebrew/bin/python3.12`）：

```sh
python3.12 -m venv /tmp/shizi-fonts-venv
/tmp/shizi-fonts-venv/bin/pip install -r scripts/fonts/requirements.txt

node scripts/fonts/build_corpus.mjs                      # 更新 corpus/*.txt
/tmp/shizi-fonts-venv/bin/python scripts/fonts/scripts/reproduce.py \
  --corpus v10 --install --output /tmp/shizi-fonts-build  # 下载并核验上游（约 50MB），构建，装进 fonts/
pnpm run build:manifest                                  # 字体字节变了，App 包清单随之变
pnpm run verify:unit && bash ios/ShiziApp/scripts/verify-local.sh
```

- `--source-cache <目录>`：用已下载的上游（目录下按锁文件的 `path` 摆放，如上一次输出目录）离线重建，仍逐个核 SHA。
- 不带 `--install`：只比对，重建字节与 `fonts/` 不同则退出码非 0，不动随包文件。
- `--corpus f8`：用 #180 冻结语料重建，与 #180 交付的六份 TTF / WOFF2 SHA 比对（证明工具链可复现）。
- `--diagnose`：附带重跑 #180 的 GPOS 归因（只对冻结 Serif 语料有意义）。

## 本次记录（2026-10-01，M5-2）

- 环境：macOS，Python 3.12.13，`requirements.txt` 全部固定版本；上游经官方 URL 下载并核验 SHA。
- `reproduce.py --corpus f8`：六份 TTF / WOFF2 与 #180 交付 SHA **全部一致**（原版 `reproduce.py` 与改造版各跑一次，退出码 0）。
- `reproduce.py --corpus v10 --install`：Kai 7672 码点（F8 + `”` `‹` `□`），Serif 956 码点（F8 + 第十稿文案 31 字符）；Serif 仍缺 U+0302 / U+0308（上游源字体本身没有，第十稿文字不用）。重复构建与已装字节一致（退出码 0）。
- 字节：ShiziKai-Regular.woff2 1,781,748；ShiziSerifSC-Regular.woff2 185,024；ShiziSerifSC-Medium.woff2 186,324（SHA 见 `reports/build-manifest.json`）。
- 未覆盖：Safari / WKWebView 与真机的字体渲染、拼音组合调号（ê̌ / m̌）视觉——列入 M7 真机清单（#180 GPOS 归因结论不变）。
