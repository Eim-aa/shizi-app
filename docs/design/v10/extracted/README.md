# 第十稿原型解包源码（只读参考）

来源：`docs/design/v10/shizi-v10-交接版.html`（sha1 `0ba5b243f3279599e4cc4324eeb1ffcf47d34caa`，与 [README](../README.md) 表一致）内嵌的 bundler manifest，按条目 gzip+base64 解包，未做任何修改。用于工程按屏对照规格；**不是产品代码，不可合并**（原型依赖 React、jsDelivr/unpkg、Google Fonts，且含场景面板、录制模式等原型工具）。

| 文件 | 原 manifest 条目 | 说明 |
|---|---|---|
| `拾字-可点原型-第十稿交接版.template.html` | template | 主模板：状态容器、路由、`?flow=` 入口、场景面板（解码自 JSON 转义字串） |
| `首页壳-v3-第十稿交接版.dc.html` | 83f2f17e… | 首页组件 |
| `字库墨墙屏-第十稿交接版.dc.html` | cee6ca3c… | 字库 tab：首页/有记录的字/清单/查字组件 |
| `ShiziWriteScreen-第十稿交接版.dc.html` | 1c6d798a… | 写字页组件 |
| `ShiziScreen-第十稿交接版.dc.html` | 2b03a433… | 单字详情、我的、练习记录、备份、结果页、年报、换库、设置、关于、图片弹层 |
| `录制模式-第十稿交接版.dc.html` | 9df10dc8… | 原型工具（真人笔迹录制），不进产品 |
| `ink-第十稿交接版.js` | 989b48fc… | 笔迹管线原型（以文字规格与决定表 D09/D10 为准） |
| `proto-model-第十稿交接版.js` | 36416a1c… | 演示数据与 `lists()`（写错过 / 快忘了）规则 |

未解包：dc-runtime、support.js（`<image-slot>` 设计工具残留）、React/ReactDOM UMD。逐屏解读见 [docs/engineering/v10/reference/](../../../engineering/v10/reference/README.md) 的 H/I/J/K 报告。
