# 现有代码与交付物核对报告（2026-09-30 快照）

对象：`main` 639f592 的 `index.html`、`sw.js`、iOS 壳、测试脚本、数据层；第十稿单文件原型（解包源码见 `docs/design/v10/extracted/`）；PR #175 与 #180。每份报告按同一结构：概览 / 组件清单（含复用判断）/ 数据契约 / 与第十稿决定的关系 / 风险 / 未解问题。行号指报告日期时的文件；后续代码变动后以 git blame 追溯。

| 报告 | 范围 |
|---|---|
| [A-storage](A-storage.md) | localStorage 22 键、备份/恢复、安全副本、迁移 |
| [B-scheduling](B-scheduling.md) | 出题池、双层会话、FSRS、再练队列、校准、字库、自定义字 |
| [C-ink](C-ink.md) | 画布、笔锋渲染器、Hanzi Writer、点拨/描红、自动比对；与原型 ink.js 对照 |
| [D-flow](D-flow.md) | 练习流程状态机、盖章/重盖、结果页、灶台模式 |
| [E-shell](E-shell.md) | 三 tab、首页、字库墙、我的、印历、月帖、年报、单字详情、收字、分享、CSS 令牌 |
| [F-platform](F-platform.md) | 原生桥契约、iOS 壳、sw.js、提醒、声音、触觉 |
| [G-tests](G-tests.md) | 三层门禁现状、可保留的数据门禁、需重写的 UI 断言 |
| [H-proto-shell](H-proto-shell.md) | 原型主模板：页面编排、导航图、状态、原型专用工具 |
| [I-proto-write](I-proto-write.md) | 原型写字页组件：全部状态、几何、文案 |
| [J-proto-screen](J-proto-screen.md) | 原型 ShiziScreen：单字详情、我的、练习记录、备份、结果页、年报、换库、设置、关于、图片弹层 |
| [K-proto-home-lib](K-proto-home-lib.md) | 原型首页壳与字库墨墙屏（含查字组件、清单） |
| [L-proto-model-ink](L-proto-model-ink.md) | 原型演示数据模型（记录/会话/写错过·快忘了规则）与笔迹管线 ink.js 逐行规格 |
| [N-reusable](N-reusable.md) | PR #180 模块与字体、PR #175 内容修订、fsrs6 / hanzi-writer 供应 |
| [O-data](O-data.md) | deck-data 结构、GROUPS、笔顺 JSON、字源、治理清单、生成脚本、分片可行性 |
| [Z-critique](Z-critique.md) | 完整性批评：覆盖缺口、报告间 30 条矛盾的裁定、代码与决定冲突汇总、需产品/架构决定清单 |

设计三份清单的整理报告（M）已并入 [04-需求清单](../04-需求清单-第十稿.md)。报告之间的事实矛盾以 Z 的裁定为准。
