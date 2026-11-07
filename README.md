# 拾字

> 接手请先读[团队接手说明](docs/handoff/README.md)（产品依据、决定表、设计交付）。第十稿的工程规划、待产品决定与各里程碑验收记录在 [`docs/engineering/v10/`](docs/engineering/v10/00-README.md)。

这是一个 iOS 上的汉字书写恢复工具：帮已经学过汉字的人，在想写时轻松开始，安静地回忆几个字，想停就停。默认练习为主，自己选字为补充；用户对照后自己判断，不做书法评分，不加每日任务压力。

App 是**纯原生**的：UIKit + Swift 包 `ios/ShiziCore`（规则、调度、存储、视图回包），App 里没有 JS、没有 WKWebView。早先的网页版（PWA）和仓库里的 JS 引擎已在 D84（2026-11）删除，需要时看 Git 历史（D84 清扫前的提交）。

三个 tab「习字 / 字库 / 我的」：

- **习字**：首页、写字页（提示、看答案 / 描一遍、跳过、判断与更正、结束这组）、结果页；第一次练习 5 个字，以后按记忆曲线出题，也可以「自己选字」。
- **字库**：墨墙、写错过 / 快忘了清单、有记录的字、单字详情（含旧照片只读）、查字、换库（四个在学字库）。
- **我的**：这一周与练习记录、年度报告、设置（提醒、按键音、更大字体）、备份与恢复（替换 / 清空前留保护副本，可撤销）、图片、关于（隐私、开源资料 · 致谢）。

存储不可用时出现阻断页；旧版（v1）数据首次启动时自动迁移。逐页需求以 [04 需求清单](docs/engineering/v10/04-需求清单-第十稿.md) 为准，变化记录见 [CHANGELOG.md](CHANGELOG.md)。

## 目录结构

```
ios/ShiziApp/           iOS 原生 App 工程、脚本与测试（XCUITest 流程、native-ui 逐屏基线）
ios/ShiziCore/          Swift 包：规则 / 调度 / 存储 / 视图回包；Bundled/*.json 是手改的唯一真相源（题库、文案、policy、字表 …）
fonts/                  ShiziKai / ShiziSerifSC 子集 WOFF2、fonts.css、coverage-manifest.json（构建工具在 scripts/fonts/）
licenses/               随包许可全文
data/                   单字笔顺 JSON（7294 字）、字源 etymology.json、data/LICENSE.md
assets/                 图标源 SVG（branding）、音效源
generated/、sources/、audit/   题库生成结果、原始字表与词典、笔顺补充数据与合规审计证据
scripts/                数据管线与门禁（Node / Python）、字体工具（scripts/fonts/）、笔顺 pack（stroke-pack/）、冻结夹具（fixtures/）
test/                   node:test：原生工具与数据门禁的单测（native-ui-*、ios-*、core/ 下的合规与配置核对）
docs/                   handoff/（接手）、product/、design/v10/（设计交付快照）、engineering/v10/（工程规划与验收）、adr/
```

## 生成物与生成器

生成物与生成器同一提交，不手改（标注「手改」的 JSON 除外）。重复运行内容不变时 `git diff` 为空；带 `--check` 的只核对不写。

| 生成物 | 生成器 | 何时重跑 |
|---|---|---|
| `scripts/app-bundle-manifest.txt`（iOS 包 `Web/` 里的 data / fonts / licenses 清单） | `pnpm run build:manifest`（`scripts/build_shell_manifest.mjs`，`--check` 只核对） | **新增、删除或修改 `fonts/`、`data/`、`licenses/` 里的文件后**；否则 `verify:unit` 报清单过期 |
| `ios/ShiziCore/.../Bundled/deck.json`、`generated/*.json` | `python3 scripts/build_8105_chars.py` | 题库或字表变化 |
| `Bundled/credits.json`（关于页「开源资料 · 致谢」） | `pnpm run build:credits`（读 `THIRD_PARTY_NOTICES.md` 与许可全文） | 改了 NOTICES 或许可文件 |
| `Bundled/char-order.json`（新字顺序） | `pnpm run build:order`（`verify:order` 为 `--check`） | 易忘度字表 / 剔除表变化 |
| `fonts/*.woff2`、`fonts/coverage-manifest.json` | `scripts/fonts/`（步骤见 [scripts/fonts/README.md](scripts/fonts/README.md)） | 文案或题库新增了字体外的字符 |
| `data/etymology.json` | `python3 scripts/build_etymology.py` | 字源数据变化 |
| `docs/engineering/v10/copy-source.json` | 由 04 需求清单抽取，`pnpm run verify:copy` 核对 | 文案变化 |
| `ShiziKit/Generated/ShiziKitTokens.json`、`ShiziKitCopy.json`、`Bundled/*.json`（其余） | **手改**（唯一真相源）；`verify:copy`、`verify:tokens` 与 `test/ios-shizikit.test.mjs` 核对 | 设计令牌 / 文案变化 |

## 门禁

Node 依赖由 `package.json` 与 `pnpm-lock.yaml` 固定（只有 `playwright`：逐屏对比解码 PNG、440 字渲染、图标生成用）。首次运行：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

`pnpm test` 依次运行下面五组：

| 命令 | 内容 |
|---|---|
| `pnpm run verify:data` | `verify:governance`（字库治理）+ `verify:vector440`（440 字补充笔顺）+ `verify:content`（题面语料）+ `verify:assets`（许可 / 字源夹具 / 审计回放包 / Swift 无中文 alert 等静态资产）+ `verify:order`。其中 governance 与 content 要 `swift build` 出 `shizi-core-cli`（`cards-dump`），所以需要 Swift 工具链 |
| `pnpm run verify:unit` | `node --test "test/**/*.test.mjs"` |
| `pnpm run verify:copy` | 文案门禁：`Bundled/copy.json` 与 `ShiziKitCopy.json` 逐字相同、与 `copy-source.json` 一致、P 编号覆盖等（`--scope=all\|M<n>\|R-H,R-W\|screen:home`） |
| `pnpm run verify:tokens` | `tokens.json` 的动效时长 / 曲线与 `ShiziKitTokens.json` 逐值一致 |
| `pnpm run verify:core` | `swift build -c release` + `swift test`（`ios/ShiziCore`） |

CI（`.github/workflows/verify.yml`）四个 job：ubuntu 上的 `data`（语法检查 + `verify:vector440` / `verify:assets` / `verify:order`）与 `unit-copy`（`verify:unit` + `verify:copy` + `verify:tokens`）；macOS 上的 `swift-core`（`verify:core` + `verify:governance` + `verify:content` + 只在 macOS 跑的单测）与 `ios-app`（App 模拟器构建、包内资源核对、`ShiziStoreTests` / `ShiziWriteTests`）。逐屏对比与 XCUITest 流程（`verify:native-ui`，约 1 小时）、Release archive 与签名只在本机跑。

iOS 的模拟器检查：`pnpm run verify:native-ui`（XCUITest 流程 + 逐屏对比原生基线，见 [ios/ShiziApp/README.md](ios/ShiziApp/README.md)）。工程 / 构建 / 包内资源：`bash ios/ShiziApp/scripts/verify-local.sh`。

## iOS App

工程在 `ios/ShiziApp/ShiziApp.xcodeproj`（scheme `Shizi` / `Shizi Dev`，iOS 15.0 起，iPhone-only）。Xcode 的「Sync Web Assets」阶段按 `scripts/app-bundle-manifest.txt` 用 `rsync --files-from=` 把原生仍在读的 `data/`、`fonts/`、`licenses/` 同步进 App 包的 `Web/`（不含 JS），所以**改了这些文件先跑 `pnpm run build:manifest`**。

| 脚本（`ios/ShiziApp/scripts/`） | 用途 |
|---|---|
| `verify-local.sh` | plist / 数据门禁 / 工程 / 模拟器 Debug 构建 / 无签名 Release archive / 包内资源 |
| `verify-native-ui.sh` | XCUITest 流程 + 逐屏对比原生基线（`--shards N` 并行，里程碑用） |
| `signing-preflight.sh`、`run-device.sh` | 真机签名预检、安装启动 |
| `verify-bundle-assets.sh`、`verify-archive.sh` | 按清单核对 App 包 / archive 资源；包里不得有网页壳 |
| `archive-testflight.sh` | TestFlight archive / 导出 / 上传 |
| `sync-web-assets.sh` | Xcode Run Script（按清单同步资源） |

构建、真机与 TestFlight 步骤见 [ios/ShiziApp/README.md](ios/ShiziApp/README.md)；真机人工检查清单见 [ios/ShiziApp/DEVICE_QA.md](ios/ShiziApp/DEVICE_QA.md)。

## 重新生成题库

第一次运行前安装依赖：

```bash
python3 -m pip install -r requirements.txt
```

重新生成 `Bundled/deck.json`、`generated/selected_8105_candidates.json`、`generated/hanzi_writer_coverage.json` 和 `generated/library-governance.json`：

```bash
python3 scripts/build_8105_chars.py
```

注意：现有 `deck.json` 是在未安装 `jieba`/`wordfreq` 的环境下生成的（只需 `pypinyin`）；装了这两个可选依赖会让 `common`/`d`/`band` 整体漂移并触发数据门禁。数据未变时重跑应 `git diff` 为空。之后运行 `pnpm run verify:data`。

## 参与开发

分支命名、固定依赖、完整验证、Conventional Commits、PR 审查和合并后分支清理规则见 `CONTRIBUTING.md`。发布 tag 只在真机与法律门槛都明确后由负责人创建，不把测试中间点冒充可发布版本。

## 许可与第三方资料

- 项目自有代码与内容**尚未选定根 `LICENSE`**，这是发布前外部门槛（见 `LEGAL_RELEASE_CHECKLIST.md`）。
- 第三方库、字体与数据的版本、来源与许可见 `THIRD_PARTY_NOTICES.md`，许可全文在 `licenses/` 与 `sources/LICENSE-*`；App 内「我的 → 关于 → 开源资料 · 致谢」由 `pnpm run build:credits` 从同两处生成。
- 笔顺数据：6854 字来自 Hanzi Writer Data 2.0.1（Arphic Public License），440 字为项目补充（来源与审计见 `audit/vector-data-460-manifest.json`）；补充数据的再分发与商业化授权仍是 `LEGAL_RELEASE_CHECKLIST.md` 里的开放项，技术与人工验收不等于版权许可。
