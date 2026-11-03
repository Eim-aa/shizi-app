# Fixtures（冻结的 Swift 回归夹具）

这个目录里的 JSON 是 ShiziCore 的**冻结回归夹具**（D84，2026-11-03）。

- 它们原本由 `scripts/core-golden/golden.mjs` 用 JS 参考引擎生成，在 Swift 与 JS 逐字节对照时是「金标准」。网页版和仓库里的 JS 已随 D84 退役，**JS 对照工具（`scripts/core-diff/` 等）已删，夹具不再重生成**（`scripts/core-golden/` 里的生成脚本已在 D84 清扫卡 D 删除）。要找回对照工具看 Git 历史（D84 清扫前的提交）。
- 以后它们只做一件事：钉住 ShiziCore **现在的行为**，让回归测试（`GoldenTests`、`ScheduleGoldenTests`、`ContractTests`、`SessionContractTests`、`ViewParityTests`、`ImageParityTests`、`BackupRoundTripTests` 等）在行为意外改变时报错。
- 规则**有意改了**（产品决定改规则，如 D83 调度规则 v2）：直接改夹具 JSON 里受影响的条目，或把受影响的 op 加进测试里的退役跳过表，**并在提交说明里写清是哪条决定**。不要想着重新生成整份。
- 现有的退役跳过表保留，不要删：
  - `GoldenTests.swift` 的 `d83RetiredGoldenOps`（D83 调度规则 v2 改了行为的 op，夹具里还是 v2 之前的 JS 结果，由 Swift 一侧跳过）；
  - `SessionContractTests.swift` 里跳过的会话场景（同上）；
  - `schedule.json` 在 b0912758（S2）里已手改过。
  这些规则的参考是 `TodayPlanTests.swift`、`TodayPlanSimulationTests.swift` 等 Swift 自己的测试。
- 「纯算法数值」夹具（`ink.json`、`images-geometry.json`、`images-selection.json`，以及 `ShiziWriteTests/Fixtures/web-ink-golden.json`）没有产品规则风险，冻结即可。
- 夹具文件头或测试注释里还提到 `golden.mjs`、`verify:core-diff` 的，都是历史说明；现在的整套核心门禁是 `pnpm run verify:core`（`swift build -c release` + `swift test`）。最后一次 JS 差分的结果见 `docs/engineering/v10/D84-最后一次JS差分.md`。
