# 冻结的真实 v13 一代

`scripts/verify_pwa_upgrade.js` 回放的第二代旧 PWA（`LEGACY_GENERATIONS = [v10, v13]`），取自 main 的
`639f5921779fb28f8275e68efc84fd0c53b1ffce`（合并 PR #174 后的 main，也就是第十稿切出前线上 GitHub Pages 的版本）。

这里只冻结两份小文件，让"被回放的旧缓存策略"在代码评审里直接可读：

| 文件 | 作用 |
| --- | --- |
| `sw.js` | 真实 v13 worker。`VERSION = shizi-v13-<BUILD>`；HTML 网络优先（5xx/408/429/断网回落）；带指纹的 deck / core-strokes / 语境覆盖网络优先、任何非 ok 回落；笔顺缓存优先 + 后台刷新、上限 800、核心 600 不淘汰；`activate` 删除全部旧缓存并对所有窗口 `client.navigate()` 强刷。 |
| `core-strokes.js` | 真实 v13 的核心 600 字字表（`self.SHIZI_CORE_STROKES`），只给 worker 预缓存用。 |

## 这两份文件不是门禁的数据源

门禁运行时从 `LEGACY_COMMIT` 直接取 blob 到临时目录并按 SHA-256 校验，再断言取出的字节与这里冻结的副本完全一致：

- 冻结副本被改 → 门禁失败；
- 上游 commit 被改写 → SHA-256 校验失败；
- 两边一起改 → 仍需与脚本里钉死的摘要一致才能通过。

`index.html`（约 3100 行单文件 App）与 `deck-data.js`（约 2.1 MB）不在这里重复保存，只在脚本里钉死 SHA-256。旧一代的
`data/` 默认由当前工作区提供，但门禁会用 `git diff` 找出与旧 commit 不同的文件（例如 `data/context-overrides.js`）
并从旧 commit 逐字节回放，旧 App 不会读到新数据。

## v13 → v14 要守住什么

v13 页面不认 v14 的「有新版本」消息，v14 也不再强刷任何窗口（会打断正在写的字）。因此门禁断言：v14 激活后旧页面
不被导航、旧缓存保留到窗口刷新；用户刷新后页面整体变成 v14（HTML meta、`src/build-info.js`、就绪标记同一 BUILD），
旧缓存随即删除，只剩 `shizi-v14-<BUILD>`。
