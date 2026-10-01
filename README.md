# 拾字

> 接手请先读[团队接手说明](docs/handoff/README.md)（产品依据、决定表、设计交付）。第十稿的工程规划、待产品决定与各里程碑验收记录在 [`docs/engineering/v10/`](docs/engineering/v10/00-README.md)。

这是一个本地运行、可安装到手机主屏幕的汉字书写恢复工具：帮已经学过汉字的人，在想写时轻松开始，安静地回忆几个字，想停就停。默认练习为主，自己选字为补充；用户对照后自己判断，不做书法评分，不加每日任务压力。同一套静态文件既是 PWA，也由 `ios/ShiziApp/` 的 WKWebView 壳打包成 iOS App。

当前代码是**第十稿重建**（`v10/integration` 分支；ADR [0002](docs/adr/0002-v10-rebuild-es-modules.md)）：原生 ES 模块、无打包器、Preact + htm，数据模型 v2。界面按第十稿交接版实现，三个 tab「习字 / 字库 / 我的」：

- **习字**：首页、写字页（提示、看答案 / 描一遍、跳过、判断与更正、结束这组）、结果页；第一次练习 5 个字，以后按记忆曲线出题，也可以「自己选字」。
- **字库**：墨墙、写错过 / 快忘了清单、有记录的字、单字详情（含旧照片只读）、查字、换库（四个在学字库）。
- **我的**：这一周与练习记录、年度报告、设置（提醒、按键音、更大字体）、备份与恢复（替换 / 清空前留保护副本，可撤销）、图片、关于（隐私、开源资料 · 致谢）。

存储不可用时出现阻断页；旧版（v1）数据首次启动时自动迁移。逐页需求以 [04 需求清单](docs/engineering/v10/04-需求清单-第十稿.md) 为准，变化记录见 [CHANGELOG.md](CHANGELOG.md)。

## 目录结构

```
index.html              精简壳：meta / CSP、manifest、根容器、经典脚本（deck / vendor，defer）、<script type="module" src="src/app.js">；无内联脚本
src/                    第十稿 ES 模块源码（相对路径 import）
  app.js                启动入口；build-info.js（BUILD，生成物）
  config/               policy.js（全部过渡默认值，带 P 编号）、tokens.css / base.css、copy/（按屏分文件的界面文案单一来源）、
                        deck-meta.js（生成物）、credits.js（生成物）、epigraphs.js
  core/                 纯逻辑：记录、会话、调度（fsrs.js）、选字、提示、笔迹数学、备份、图片（images/）
  data/                 题库、笔顺、字体加载
  store/                storage.js（唯一的 localStorage 出入口）、store.js（事务）、migrate.js（v1 → v2）、budget.js
  platform/             原生桥、Service Worker 注册、提醒、触觉、按键音、外观、测试钩子
  ui/                   root.js、router.js、components/、canvas/、screens/（每屏自注册）、dev/（?dev=1 调试页）
vendor/                 固定版本第三方运行时：preact.module.js、preact-hooks.module.js、htm.module.js（三个 npm 官方 ESM 文件，
                        scripts/vendor_preact.mjs 取出并校验）、ui.js（本仓库聚合出口）、hanzi-writer.min.js、fsrs6.min.js（ts-fsrs 5.2.0）
fonts/                  ShiziKai / ShiziSerifSC 子集 WOFF2、fonts.css、coverage-manifest.json（构建工具在 scripts/fonts/）
licenses/               随包许可全文：Preact、htm、两份 OFL、字体改名说明
data/                   单字笔顺 JSON（7294 字）、语境覆盖 context-overrides.js、字源 etymology.json
deck-data.js            内置题库（SEED + GROUPS，约 2.1MB，生成物）
core-strokes.js         核心 600 字字表 + 首练 5 字内嵌笔顺（生成物）
sw.js / sw-manifest.js  Service Worker（缓存 shizi-v14-<BUILD>）与其清单（生成物）
manifest.webmanifest、icon-*.png、assets/   PWA 清单、图标、图形资源
scripts/                生成器、门禁、e2e（scripts/e2e/）、字体工具（scripts/fonts/）、fixtures；scripts/legacy/ 为旧版门禁，不再运行
test/                   node:test 单测（core / store / platform / ui）
ios/ShiziApp/           iOS WKWebView 壳工程与脚本
generated/、sources/、audit/   题库生成结果、原始字表与词典、笔顺补充数据的审计证据
docs/                   handoff/（接手）、product/、design/v10/（设计交付快照）、engineering/v10/（工程规划与验收）、adr/
```

## 生成物与生成器

生成物与生成器同一提交，不手改。重复运行内容不变时 `git diff` 为空；带 `--check` 的只核对不写。

| 生成物 | 生成器 | 何时重跑 |
|---|---|---|
| `scripts/shell-manifest.txt`、`sw-manifest.js`、`src/build-info.js`、`index.html` 的 BUILD meta 与 `?v=`、`core-strokes.js` 的首练内嵌笔顺 | `pnpm run build:manifest`（`scripts/build_shell_manifest.mjs`，`--check` 只核对） | **新增、删除或修改任何壳文件后**（`src/`、`vendor/`、`fonts/`、`data/` 等）。否则 iOS 不进包、SW 预缓存过期，`verify:unit` 会报清单过期 |
| `deck-data.js`、`core-strokes.js`（字表）、`src/config/deck-meta.js`、`generated/*.json` | `python3 scripts/build_8105_chars.py`（末尾会链式调用壳清单生成器） | 题库或字表变化 |
| `src/config/credits.js`（关于页「开源资料 · 致谢」） | `pnpm run build:credits`（读 `THIRD_PARTY_NOTICES.md` 与许可全文） | 改了 NOTICES 或许可文件 |
| `vendor/preact*.module.js`、`vendor/htm.module.js` | `node scripts/vendor_preact.mjs`（`--check` 不联网核 SHA-256） | 升级 Preact / htm |
| `fonts/*.woff2`、`fonts/coverage-manifest.json` | `scripts/fonts/`（步骤见 [scripts/fonts/README.md](scripts/fonts/README.md)） | 文案或题库新增了字体外的字符 |
| `data/etymology.json` | `python3 scripts/build_etymology.py` | 字源数据变化 |
| `docs/engineering/v10/copy-source.json` | 由 04 需求清单抽取，`pnpm run verify:copy` 核对 | 文案变化 |

## 门禁

Node 依赖由 `package.json` 与 `pnpm-lock.yaml` 固定。首次运行：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

`pnpm test` 依次运行下面四组（CI `.github/workflows/verify.yml` 分 data / unit-copy / web 三个 job 并行，另对 `scripts/**/*.{js,mjs,cjs}` 做 `node --check`，排除 `scripts/legacy/`）：

| 命令 | 内容 |
|---|---|
| `pnpm run verify:data` | `verify:governance`（字库治理）+ `verify:vector440`（440 字补充笔顺）+ `verify:content`（题面语料）+ `verify:assets`（静态资产、SW v14 硬断言）+ `verify:sw-unit`（SW 单测）+ `verify:api`（API 下限，iOS ≥ 15 WKWebView） |
| `pnpm run verify:unit` | `node --test "test/**/*.test.mjs"` |
| `pnpm run verify:copy` | 文案门禁：`src/config/copy/` 与 `copy-source.json` 逐字一致、硬编码中文扫描、P 编号覆盖等（`--scope=all\|M<n>\|R-H,R-W\|screen:home`） |
| `pnpm run verify:web` | e2e（`scripts/e2e/run.mjs`）+ `verify:pwa`（`scripts/verify_pwa_upgrade.js`：真实 v10 / v13 两代回放升级到 v14、BUILD A→B、503 回落；需要能取到两个旧提交，取不到即失败） |

另有 `pnpm run verify:native-smoke -- <json> <stage>`：复核 iOS 原生冒烟 JSON（见 `ios/ShiziApp/README.md`）。

### e2e 运行器

`scripts/e2e/run.mjs` 自己在 127.0.0.1 随机端口起 `python3 -m http.server`，用 Playwright 库（不是 `@playwright/test`）按文件名顺序跑 `scripts/e2e/*.spec.js`；每个 spec 一个新 context（393×852），收集 console.error / pageerror 并断言为零，逐条打印断言，有失败退出码 1。

```bash
node scripts/e2e/run.mjs              # 全部 spec
node scripts/e2e/run.mjs 53-block     # 只跑文件名包含该串的 spec
SHIZI_E2E_HEADED=1 node scripts/e2e/run.mjs 10-write          # 有界面
SHIZI_E2E_CHROMIUM=/path/to/chrome node scripts/e2e/run.mjs   # 本机 Playwright 浏览器版本不匹配时指定 Chromium
```

测试钩子 `window.__shiziTest` 只在 `?test=1` 且宿主为 localhost / 127.0.0.1（或 iOS DEBUG 冒烟注入 `__shiziNativeDev`）时挂载，GitHub Pages 与 Release 壳上不存在（`src/platform/test-hooks.js`）；helpers 在 `scripts/e2e/helpers.mjs`（含 `installNativeStub` 假原生桥）。

## 本地预览

```bash
pnpm start            # python3 -m http.server 8000 --bind 127.0.0.1
```

打开 <http://127.0.0.1:8000/>；`?dev=1` 打开色板 / 指针统计调试页；`?test=1` 挂测试钩子。

## 线上版本

- 地址：<https://eim-aa.github.io/shizi-app/>
- 发布方式：GitHub Pages 从 `main` 分支根目录发布——合入 `main` 就是发布。第十稿切换步骤与回退见 [M7 切换方案](docs/engineering/v10/acceptance/M7-切换方案.md)。
- 手机安装：iPhone 上用 Safari 打开 → 分享 → 「添加到主屏幕」，之后从主屏幕图标进入即全屏、可离线。
- 新版本由 Service Worker 发现：非写字页刷新一次，写字页等离开后再刷新（01 §8.3）。

## iOS App

工程在 `ios/ShiziApp/ShiziApp.xcodeproj`（scheme `Shizi` / `Shizi Dev`，iOS 15.0 起，iPhone-only）。Xcode 的「Sync Web Assets」阶段按 `scripts/shell-manifest.txt` 用 `rsync --files-from=` 把 Web 文件逐个同步进 App 包的 `Web/`，所以**改了壳文件先跑 `pnpm run build:manifest`**。

| 脚本（`ios/ShiziApp/scripts/`） | 用途 |
|---|---|
| `verify-local.sh` | plist / 工程 / 模拟器 Debug 构建 / 无签名 Release archive / 包内资源；`RUN_SMOKE=1` 追加 Simulator 冒烟 |
| `smoke-simulator.sh` / `smoke-device.sh` | DEBUG 原生冒烟三阶段（main / relaunch / deeplink），结果由 `validate-native-smoke.py` 核对 |
| `signing-preflight.sh`、`run-device.sh` | 真机签名预检、安装启动 |
| `verify-bundle-assets.sh`、`verify-archive.sh` | 按清单核对 App 包 / archive 资源；Release 不含冒烟替身 |
| `archive-testflight.sh` | TestFlight archive / 导出 / 上传 |
| `sync-web-assets.sh` | Xcode Run Script（按清单同步 Web 资源） |

构建、冒烟、真机与 TestFlight 步骤见 [ios/ShiziApp/README.md](ios/ShiziApp/README.md)；真机人工检查清单见 [ios/ShiziApp/DEVICE_QA.md](ios/ShiziApp/DEVICE_QA.md)。

## 重新生成题库

第一次运行前安装依赖：

```bash
python3 -m pip install -r requirements.txt
```

重新生成 `src/config/deck-meta.js`（`DECK_KEY` 与 deck 指纹）、`deck-data.js`、`core-strokes.js`、`generated/selected_8105_candidates.json`、`generated/hanzi_writer_coverage.json` 和 `generated/library-governance.json`：

```bash
python3 scripts/build_8105_chars.py
```

注意：现有 `deck-data.js` 是在未安装 `jieba`/`wordfreq` 的环境下生成的（只需 `pypinyin`）；装了这两个可选依赖会让 `common`/`d`/`band` 整体漂移并触发数据门禁。数据未变时重跑应 `git diff` 为空。之后运行 `pnpm run verify:data`。

## 参与开发

分支命名、固定依赖、完整验证、Conventional Commits、PR 审查和合并后分支清理规则见 `CONTRIBUTING.md`。第十稿的约定（CSP 只 `'self'`、组件样式经 CSSOM 注入而不用 `<style>` 或 style 属性、文案只进 `src/config/copy/`、过渡默认值只进 `policy.js` 并在 03 登记）见 [01 架构设计](docs/engineering/v10/01-架构设计.md)。发布 tag 只在真机与法律门槛都明确后由负责人创建，不把测试中间点冒充可发布版本。

## 许可与第三方资料

- 项目自有代码与内容**尚未选定根 `LICENSE`**，这是发布前外部门槛（见 `LEGAL_RELEASE_CHECKLIST.md`）。
- 第三方库、字体与数据的版本、来源与许可见 `THIRD_PARTY_NOTICES.md`，许可全文在 `licenses/` 与 `sources/LICENSE-*`；App 内「我的 → 关于 → 开源资料 · 致谢」由 `pnpm run build:credits` 从同两处生成。
- 笔顺数据：6854 字来自 Hanzi Writer Data 2.0.1（Arphic Public License），440 字为项目补充（来源与审计见 `audit/vector-data-460-manifest.json`）；补充数据的再分发与商业化授权仍是 `LEGAL_RELEASE_CHECKLIST.md` 里的开放项，技术与人工验收不等于版权许可。
