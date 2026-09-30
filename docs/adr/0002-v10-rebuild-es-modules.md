# ADR 0002：第十稿按新代码基重建，采用无构建的原生 ES 模块

- 状态：提议 v2（经五视角评审修订，待项目所有者确认后改为已接受）
- 日期：2026-09-30
- 关联：ADR 0001（保持无构建的本地优先运行时）、[第十稿交接状态](../product/04-v10-handoff.md)、[决定表](../handoff/decisions.md) D15/D17–D25、Issue #125

## 背景

现有产品是一个 3102 行的单文件 `index.html`：约 2060 行内联 JS 在同一个作用域里，479 个函数，DOM 用字符串 id 查找，测试直接读写页面全局变量。第十稿设计（2026-09-30 冻结）把练习流程、记录语义、字库、我的、备份几乎全部重定义（D17–D25）。对 `index.html` 各子系统逐段核对的结果（见 `docs/engineering/v10/reference/`）是：

- 与第十稿决定**直接冲突**的行为遍布流程、调度、存储语义、壳层文案：校准 15 字、盖章四态、不会写记 miss、加字伪造 miss、补记、10 秒撤销、点拨按部件、汉字数字、收字/拍字 OCR 等。
- **可以保留**的是机制层：FSRS 封装、卡片身份键 `base:<字>`、形状校验 + 启动隔离 + 备份整单校验、Service Worker 缓存策略、原生桥消息契约、图片分发三级回退、笔锋渲染的飞白/洇墨基元。
- 现有 Playwright 套件 245 条断言几乎全部固化旧产品行为，且白盒耦合全局名；第十稿一落地它在第一条浏览器断言就会红。

ADR 0001 明确写了复议触发条件之一是「模块边界改造进入正式排期」。D15 又明确「当前无正式用户，历史测试记录兼容不再是硬约束」。

## 决策

1. **重建而非改造。** 新代码基放在 `src/`（ES 模块）+ 精简的 `index.html` 壳；旧 `index.html` 在切换时退役（保留在 git 历史）。机制层按模块**抽取移植**，不整段复制。
2. **原生 ES 模块，不引入打包器作为运行前提。** 浏览器直接加载 `<script type="module" src="src/app.js">`；第三方库固定版本 vendored 到 `vendor/`（Preact、preact/hooks、htm 三个官方 ESM 单文件——hooks 内的 `from"preact"` 改写为相对路径、ts-fsrs UMD、hanzi-writer UMD），页面不访问 CDN，CSP 维持 `default-src 'self'`。这延续 ADR 0001 的「无供应链、可审计、PWA 与 iOS 共享同一套文件」原则，只放弃「单文件单作用域」。
3. **UI 用 Preact 10.29.x + htm 3.1.1（无 JSX 构建）**，经 `vendor/ui.js` 聚合导出。原型本身是 React 组件结构，按屏移植成本最低；三个文件都是相对路径 import，不需要 import map，兼容 iOS 15 的 WKWebView。不用 htm 自带的 preact standalone：它内嵌的 Preact 版本无法确认（2022 年打包）、且缺 `Fragment`/`options`，无法满足许可登记的可审计要求。
4. **数据模型重定义为「记录 + 会话 + 调度状态」**，持久层仍是 localStorage（键前缀 `shizi.v2.`），所有写入经唯一的事务入口「写入并逐键核对成功后才发布状态」，满足 D07。备份文件外壳沿用 `{app:"shizi", version, data:{键: JSON 字串}}`，version 升到 2；iOS 壳的导入桥改为只交付文件文本（校验、页内确认、保护副本与撤销全部在 JS，原生不再 reload），见架构 §8.1。
5. **Service Worker 壳清单与资源指纹由脚本生成**（`scripts/build_shell_manifest.mjs` → `scripts/shell-manifest.txt`（M0 起，供 iOS 同步脚本 `rsync --files-from`）与 `sw-manifest.js`、`src/build-info.js`（M5）），不再手改三处；缓存名升到 `shizi-v14-*`；HTML 与模块同版本（导航 stale-while-revalidate + 激活通知后强制刷新），见架构 §8.3。
6. **iOS 壳改动**：`LocalWebSchemeHandler` 补 MIME（`.mjs`、`.woff2`、`.webp`、`.txt`、`.md`），`sync-web-assets.sh` 改为清单驱动并纳入 `src/ vendor/ fonts/ assets/ licenses/`，移除拍字 OCR 桥与相机用途串（旧照片保留只读查看与备份），导入桥只交付文本、`pageReady` 由页面发出、边缘手势识别器带进度事件与 `backGestureEnabled` 门控，DEBUG 冒烟随公开测试钩子重写（`?test=1` + `WKUserScript` 注入，Release 不编译）。
7. **打包器保留为可选优化**：若首屏或 iOS 老机型出现可复现的性能问题，再加 esbuild 产出单文件 `app.js`，不改源码结构。这不是本轮范围。

## 后果

- 优点：模块边界让子系统可单独测试（node:test 单测 + Playwright 端到端 + 数据门禁三层）；第十稿的每一条决定可以映射到明确的模块和测试；旧数据通过一次性导入器转换，旧键保留至回退窗口结束（大键导入后即删）。
- 代价：切换期间两套代码并存（旧 `main` 继续发布，新代码在集成分支）；现有 e2e 与原生 DEBUG 冒烟整体重写；`deck-data.js` 仍是 2.1MB 同步脚本（本轮不分片，接口已按异步设计，分片是后续独立任务）。
- 未变：GitHub Pages 从 `main` 根目录发布；数据治理、440 字矢量证据链、PWA 升级回放三条数据门禁的断言意图保留（治理脚本末尾断言重锚到 `src/`，PWA 回放脚本按新 SW 协议重写）；第三方许可门槛（根 LICENSE、补充笔顺数据）仍是发布前外部条件，不在本 ADR 范围。
- 复议触发：若 Preact/htm 在 WKWebView 真机上出现不可绕过的问题（如输入法焦点、滚动冲突），退回原生 DOM 实现，模块边界与数据模型不变。
