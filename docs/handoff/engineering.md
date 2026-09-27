# 工程运行与接入说明

## 工程构成与代码入口

现有应用为静态 HTML/JavaScript 与 Canvas2D，iOS 使用 WKWebView 包装。生产入口是根目录 `index.html`；题库接线/语境与笔画资源在 `deck-data.js`、`data/context-overrides.js`、`core-strokes.js` 和 `data/`；PWA 在 `sw.js`。先按具体分支核对，不重新生成题库来覆盖批准修订。

入口与规则见 [现有工程 README](../../README.md)、[贡献约定](../../CONTRIBUTING.md)、[iOS 工程说明](../../ios/ShiziApp/README.md)。它们描述现有工程；新体验按[产品决定](decisions.md)实施。现有四库可练量为 3500/2976/818/2500，最后一库与第一库重叠，总唯一可练字 7294；以实际数据门禁为准。

## 安全获取指定成果

下面只获取和切换分支，不合并或推送。若已有 checkout 存在未提交修改，先单独保存，或在新目录克隆，勿直接覆盖。

```sh
git clone https://github.com/Eim-aa/shizi-app.git
cd shizi-app
git fetch origin
git switch --track origin/codex/content-quality-fixes
git rev-parse HEAD
```

以上用于验证 #175，应与接手首页记录的 `fe85323…` 对应。文档分支为 `codex/product-baseline-r8`，底层分支为 `codex/r8-foundation-handoff`。本轮没有交付把三者全部合在一起的产品候选；接手工程另建集成分支时需要审查实际差异并重新验收。

旧 PR #151/#164/#165/#171/#172 等仍是独立工作，不因开放就自动成为本次待合并集合。先核对它们针对的旧需求、主干已包含内容和最新决定，尤其 #169/#173 中已被覆盖的笔迹、更正规则。

## Web 运行与测试

建议采用与仓库 CI 一致的 Node 22，Python 3；项目固定 `pnpm@11.16.0` 和 Playwright 版本。若环境未提供 Corepack，先配置该工具；不悄悄改用另一包管理器或重新生成锁文件。

```sh
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm start
```

打开 `http://127.0.0.1:8000/`。服务器持续运行，在第二个终端、同一 checkout 下执行：

```sh
pnpm test
git status --short
```

`pnpm test` 包含数据治理、浏览器端到端、布局和 PWA 升级/资源失败回退。在 Linux CI 中还需安装 Chromium 系统依赖，仓库工作流使用 `pnpm exec playwright install --with-deps chromium`。测试使用独立测试数据与浏览器上下文；不要拿个人实际备份做破坏性场景。

这些命令来自现有脚本及已完成验收，本轮仅整理说明，未重新执行整套应用测试。[原验证证据](evidence.md)记录了实际执行版本。

## iOS

需要 macOS、Xcode 及相应 SDK。在对应源码分支执行：

```sh
bash ios/ShiziApp/scripts/verify-local.sh
```

脚本构建 Simulator Debug 和不签名的 iPhoneOS Archive，并检查资源与归档元数据；结果默认位于 `ios/ShiziApp/build/verify/`。它不是已安装真机的体验测试。签名、开发者团队、TestFlight 权限与设备支持清单由项目所有者另外安排，不放进仓库文档或伪称已移交。

原生 Build 会同步 Web 资源。新字体或模块接入时，须同时验证 Web 路径、SW 缓存与 App 资源同步，不能只在桌面浏览器成功。

## 第八稿独立底层

切到 #180 对应分支后阅读 `handoff/r8-foundation/README.md` 和 `docs/api.md`。固定版本可在线查看[底层入口](https://github.com/Eim-aa/shizi-app/tree/7d663395f7fa32b0afcc68e50718d8cfa14c01b6/handoff/r8-foundation)。在仓库根运行：

```sh
node handoff/r8-foundation/tests/verify.mjs
node handoff/r8-foundation/tests/r2-contract.mjs
node handoff/r8-foundation/tests/fonts.mjs
python3 handoff/r8-foundation/tests/package.py
```

这些只验独立模块及包装。Canvas/FontFaceSet 使用观察桩；不代表浏览器像素、worker 或真机通过。字体重建按该分支 fonts/README 的固定来源和依赖执行，使用新输出目录；既有离线实测已成功，下载分支没有因此被验证。

### 接入时不可遗漏

- 字体只选一个运行配置：WOFF2 Web 或 TTF native。运行清单不是存档清单，不能把 upstream、虚拟环境或全部报告复制进 App。三份 WOFF2 共 2,143,060 B；包内默认 Web 配置 2,280,766 B，替代 TTF 配置 4,878,817 B，均含许可。
- 字体为旧 c7 语料冻结产物；#175 新词、拼音、文案需重新核对覆盖。宋体当前只按固定文案与三条题记做子集，句库新增后重跑。GPOS `mark` 是源注音字形未入子集后删除的空规则，不是已有拉丁拼音锚点被错误丢弃；ê̌/m̌ 定位限制仍在。
- 静态 `legacy-brush.mjs` 不是 r8 新笔迹管线。实时滤波、插值、起收笔、压力替代规则未实施；按真机阈值门槛继续等待。
- 导出必须由适配器提供可靠记录身份和对应笔迹：本次沿原成员/顺序、同字末次判断；本月限定月内末次判断。缺该次墨迹不借较早墨迹冒充，使用浅参考且真实标示来源。零字和超过 80 字均按接口状态处理。
- 布局尺寸 1080×1440 或 1080×1080，四周 72px；5–10 列取满足 `ceil(n/c)×(936/c)+118 ≤ 内区高` 的最小值，具体规则以已签收模块为准。
- 历史 t/p 缺失不能补造。静态轨迹可用与完整回放可用是两回事；当前记录不能承诺每次判断都存有笔迹。
- 首页墨迹只交数据方案，页面尚未接；N≤8 显示 N 项，N>8 最近判断 8 项而数字仍为 N，N 定义沿现有实现。

## 发布边界

普通文档或代码 PR 不等于允许发布。仓库 README 登记 GitHub Pages 使用 main；接手时核实实际 Pages 设置，不能假设推 main 仅是存档。按贡献约定、检查、产品/设计验收和项目所有者决定处理合并。失败时回退方案必须针对实际集成版本，不能拿旧构建签收单替代。
