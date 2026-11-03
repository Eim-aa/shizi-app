# D84：最后一次 JS ↔ Swift 差分（verify:core-diff --nightly）

> 日期 2026-11-03，基线提交 29a42e82（清理 A 已合）。在删除 `scripts/core-diff/`、`scripts/core-golden/` 等之前跑的最后一次差分。命令：`pnpm run verify:core-diff -- --nightly`（Shanghai 5000 种子 × 300 步，其余时区 500，store 域 2000 / 300，nav 域 2000 / 300 / 300，备份往返 400）。总耗时约 2 小时（与一次整机模拟器取证并行，所以比平时慢）。

## 已被 D83 退役的域（不再对照，失败属预期）

调度规则 v2（D83）改了行为，JS 不再是参考：`sched` / `session` 两个随机差分域、会话补全逐行差分、会话随机差分、调度模拟器 js ↔ swift 已在本次运行中跳过；其余域里受影响的 op（首页 / 「我的」/ 字库今日练习的视图、开组与选字、FSRS 的 applyJudgment / replay / applyAnswerSeen）由 `lib/gen.mjs D83_RETIRED_OPS` 排除。金标准里同一批 op 由 `GoldenTests.d83RetiredGoldenOps` 跳过，会话契约里改了的 31 组场景由 `SessionContractTests` 跳过。

## 结果

| 步骤 | 结果 |
|---|---|
| swift build -c release | 通过 |
| 笔顺 pack 生成 | 通过 |
| swift test | 通过 |
| 金标准同步 / 会话契约夹具同步 | 通过 |
| 会话分支覆盖 / 视图分支形状覆盖（200 种子） | 通过 |
| 差分驱动自检 | 通过 |
| 随机差分 Asia/Shanghai（5000 × 300，不含 sched / session） | **失败**（种子 3652，见下） |
| 随机差分 America/New_York（500 × 300） | 通过，0 差异，150000 步 |
| 随机差分 Australia/Lord_Howe（500 × 300） | 通过，0 差异，150000 步 |
| 随机差分 America/Santiago（500 × 300） | 通过，0 差异，150000 步 |
| store 域 Shanghai（2000 × 300） | 通过，0 差异，600000 步 |
| store 域 New_York（300 × 300） | 通过，0 差异，90000 步 |
| nav 域 Shanghai（2000 × 100）/ New_York（300）/ Lord_Howe（300） | 通过，0 差异（200000 / 30000 / 30000 步） |
| 备份双向往返（400 种子） | 通过，364 份状态，0 差异 |
| 转写清单同步 / 转写核对 | 通过（1026 个用例；转写 543 行，找到 543，缺失 0） |

## 唯一的差异（非退役域）

Shanghai 随机差分在种子 3652、第 209 步出现不同，缩小到 2 步：

1. `clock.set {t: -8640000000000001}`（比 JS `Date` 的最小值还小 1 毫秒）；
2. `backup.importLegacy`，输入是一份 `date: "not a date"` 的 v1 备份。

两边都返回 `{ok:false, reason:"v1-failed"}`，区别只在诊断字段：JS 的 `detail` 是 `"invalid day key: NaN-NaN-NaN"`，Swift 没有 `detail`。属于**备份旧版导入失败路径的错误说明文字**，且需要时钟在 JS 日期范围之外才会触发；`reason` 与状态两边一致。该域（backup / migrate）没有被 D83 退役。

差分在第一次出现不同时停止，所以 Shanghai 的种子 3653–4999 没有跑到；其余时区与专项域全部跑满、0 差异。

按卡片约定：非退役域的失败要先报告，由负责人 / 主控定夺（接受为已知差异，或先补 Swift 的 `detail`），再删除 JS 对照。
