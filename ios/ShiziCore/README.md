# ShiziCore

拾字的规则与数据层的 Swift 版（原生化第④步，B4）。只依赖 Foundation。计划与验收见 [B3B4-原生化架构与计划.md](../../docs/engineering/v10/B3B4-原生化架构与计划.md) §4、§6.2。

**参考实现是 JS**（`src/` 的无 DOM 集）。Swift 版每一个可观察行为都要与 JS 逐字段相等，连 JS 的边角行为一起照搬（两位年怪癖、无效时间得 `"NaN-NaN-NaN"` 等）；发现不同时以 JS 为准，除非产品决定改规则（那就两边一起改，差分会拦住只改一边）。

## 结构

| 位置 | 内容 |
|---|---|
| `Sources/ShiziCore/JSON/` | `JSValue` / `JSObject`（JS 对象键序：数组下标形的键升序在前、其余按插入序；字符串按码点判等，不用 Swift 的规范等价）；`JSONParser` ≡ `JSON.parse`；`JSONWriter` ≡ `JSON.stringify`（数字按 ECMAScript Number::toString） |
| `Sources/ShiziCore/Dates/` | `JSDate`：JS Date 的本地时间语义（前推格里历、TimeClip、夏令时缺口按 V8 取跳变前偏移）；`Dates`：`src/core/dates.js` 的 1:1 移植（B4.0 示例域）；`Signature.swift`：落款汉字数字 cnDigits / cnNumber / cnCount / signature*（汉字读生成的 signature.json） |
| `Sources/ShiziCore/Config/` | 生成配置的读取：`Config`（policy / motion / credits / char-order / epigraphs / copy 的 JSValue 与 `policyValue("a.b")`）、`CharOrder`、`Epigraphs`、`Copy`（占位符填充与取用，≡ `config/copy/index.js`）、`PolicyCoverage`（P 编号登记检查） |
| `Sources/ShiziCore/Resources/*.json` | **生成物**（`node scripts/build_core_config.mjs`；`--check` 守与 `src/` 同步）：policy / policy-meta / motion / char-order / epigraphs / credits / deck-meta / signature / copy / deck，B4.2 加 fsrs-config（`FSRS_CONFIG`）与 deck-libraries（全部卡键、四个字库的成员与缺省字库，`data/deck.js` 现算）。Swift 源码里没有规则数值与汉字字面量，全部读这里 |
| `Sources/ShiziCore/Deck/` | `DeckData`：deck.json（SEED / GROUPS / CONTEXT_OVERRIDES）的原始数据，懒加载 |
| `Sources/ShiziCore/Schema/` | `Schema`：`src/core/schema.js` 的 1:1 移植（键表、形状校验、备份外壳），返回的「路径: 原因」字串与 JS 逐字相同 |
| `Sources/ShiziCore/Models/` | 全部域的模型（记录 / 折叠月 / sched / 墨 v2 v3 v4 / 设置 / 会话 / 保护副本 / 事务日志 …）。**不是 Foundation 的 Codable**（JSONEncoder 没有 JS 的键序与数字格式），而是 `JSCodable`（`init(js:)` / `js`）：解码记下键序，编码先按记下的键序写、新建的按 JS 写入处的规范键序；三态字段（缺省 / null / 值）用 `Field<T>`；数字一律 Double |
| `Sources/ShiziCore/Records/` | `Records`（`core/records.js`：构造 / 校验 / 更正、最近一次 / 写错过 / 快忘了、按月索引、纸上记录谓词）、`WorkMembers`（作品成员规则）、`InkPick`（D42 取段内留有墨迹的那一次）、`FirstResult`（复现预告 / N 天后再见 / 提醒邀请规则）、`Reminder`（`platform/reminder.js` 的题目选取）、`JSX`（JS 隐式规则：真值、按码元比较、稳定排序、`Number()`、按插入序的 Map / Set）。记录 / 卡片 / 墨迹一律是 `JSValue`（透传原对象，逐字节不变） |
| `Sources/ShiziCore/Query/` `Cards/` `Structure/` | `Query`（查字 / 拼音 / 输入过滤，汉字判定读 `unicode-scripts.json`）、`Cards`（`buildCards` / 语境覆盖 / 题面模型，题面字串与四库名读 `card-rules.json`）+ `DeckCards`（题库索引、可练、换掉词语）、`Structure`（左右 / 上下结构） |
| `Sources/ShiziCore/Ink/` | `InkMath`（`core/ink-math.js`：buildStroke、抽点、Ink v3 编码、v2 / v3 / v4 解码、v4 原始点编码、会话现场的原始笔画行）与 `JSMath`（V8 的 `Math.hypot` / `Math.exp` 逐位复刻，见下）。`InkPoint` 带 JS 点对象的键序（`order`），序列化后与 JS 逐字节相同 |
| `Sources/ShiziCore/Schedule/` | B4.2 出题与复习调度（全部 1:1 移植，输入输出是 JS 形状的 JSValue，键序与 JS 相同）：`FSRS6`（ts-fsrs 5.2.0 / FSRS-6 的 Swift 版，含 Alea fuzz 种子）、`FSRS`（`ScheduleRules` 上的 fsrs.js：评级、reviewCard、看答案、判断、重放、到期）、`Mix`（配比）、`Sessions`（`SessionRules` 会话与 `ScheduleRules.selectDaily` 选字）、`SessionStart`（开组的提交包装、`MemoryScheduleStore`、题库适配器 `ScheduleDeck` / `DeckIndex`、spread.js 摊开）、`NewOrder`（新字顺序、特别组 `Special`、每组字数 `GroupSize`）、`Hints`（提示量 + correct.js 改判重算）、`SchedMath`（JSMath 扩展：V8 的 Math.log、FSRS 的 exp 口径、toFixed、ToInt32）、`JSDateISO`（toISOString / Date.parse）、`SchedSupport`（JS 取值语义、按码点的集合、稳定排序、调度用到的记录查询） |
| `Sources/ShiziCore/Store/` | B4.4 存储层（`src/store/*` + `core/backup.js` 的 1:1 移植）：`Store`（store.js：commit 事务语义——按域草稿 → mutate → 脏键 → 形状校验 → 写前估算回收 → 一个事务 → 撞配额旁路回收 + 重试一次 → 写成功才发布；seed / replaceWithBackup / 订阅 / status / ink schema 1 → 2 迁移；实现 B4.2 的 `ScheduleStore`）、`StoreStorage`（storage.js：txn 日志 + 固定写入顺序 + 逐键读回 + 逆序回滚 + 回滚失败隔离与阻断；事务后端 = 一个原生事务；writeOne / writeRoute / repair / probe / 故障注入）、`Budget`（budget.js：UTF-16 估算、墨迹层级 D27 / Q1、折叠、pruneInkOfCards）、`Backup`（backup.js：导出 / 解析报告 / 签名 / 状态句 / 保护副本编排；`BackupText` = 备份页文案小工具）、`Migrate`（migrate.js：v1 → v2 转换、设备迁移、P53 回退窗口、v1 备份导入）、`Backends`（`KVBackend` 接口、原生镜像后端 `NativeMirrorBackend`、测试 / 差分用的 `MemoryDisk` / `FakeNativeDisk` = test/store 的两种后端替身、校验和）、`SQLiteKVStore`（App 的 NativeStore.swift 的同一份表结构与代码，`SQLiteTransport` 接到镜像后端；App 里已写下的库原样能读）。与 JS 唯一的机制差别（引用身份 → 结构全同）见 Store.swift 文件头 |
| `Sources/ShiziCore/Engine/` | `CoreEngine`（op 表 + JSON 行协议）；`ConfigOps` / `SchemaOps`（B4.1 的 op）；`SchedOps`（B4.2 的 op） |
| `Sources/shizi-core-cli/` | 协议的命令行外壳（macOS），供 node 差分与调度模拟器用 |
| `Tests/ShiziCoreTests/` | 金标准（`Fixtures/*.json`，node 生成）+ 协议测试 |

**本包没有链进 App 的 Xcode 工程**（避免与并行卡冲突 `project.pbxproj`）；App 接入（`SwiftEngine: ShiziEngine`）在 B4.5。

## JSON 行协议（版本 1）

stdin 一行一个请求，stdout 一行一个回包；只有 `\n` 是行尾（U+2028 / U+2029 不是——node 侧不用 `readline`）。时区：命令行 `--tz <IANA>`，缺省取环境变量 `TZ`，再缺省系统时区（node 侧与之对齐）。

```text
请求  {"id"?: any, "op": string, "args"?: object, "state"?: false}
回包  {"id"?: any, "ok": true,  "reply": any, "state": {...}}
      {"id"?: any, "ok": false, "error": {"code": string, "message": string}, "state": {...}}
```

- `state` 是引擎全部可观察状态的快照（B4.0：`{clock, kv}`；B4.4 起是 store 的各域）。请求里 `"state": false` 时回包不带快照。
- op 先校验后改状态：失败的 op 不改状态。
- 错误码：`bad-json`（整行不是 JSON）、`bad-request`（不是对象 / `op` 不是字符串 / `args` 不是对象）、`unknown-op`、`bad-args`（参数形状不对，两个引擎同一套校验）、`range`（JS `RangeError`）、`type`（JS `TypeError`）。差分只比 `code`，不比 `message`。
- 回包文字 = JS `JSON.stringify` 的输出：成功时两边**逐字节**相同。
- 协议约定不传孤立代理项（`"\ud800"`；Swift String 无法表示，会回 `bad-json`）。

B4.1 的 op：`config.get {name}`（policy / policy-meta / motion / char-order / epigraphs / credits / deck-meta / signature / copy）、`deck.meta / seed / override / groups`、`epigraphs.index / for / author`、`copy.has / t / format / inkKey / tRef`、`dates.cnDigits / cnNumber / cnCount / signatureDateParts / signatureMonthParts`、`schema.keys / keyInfo / keyFacts / valueFacts / makeKey / keyForDomain / inkOf / validateValue / parseAndValidate / parseBackupV2 / validateRecord / validateRecordsMonth / validateInk / validateSession`、`models.roundtrip {key, value}`（形状表通过的值经模型解码再编码，必须逐字节不变；JS 一侧是恒等）。JS 一侧：`scripts/core-diff/lib/js-ops-b41.mjs`。

B4.3 的 op（`Engine/B43Ops.swift`、`B43Ops2.swift`；JS 一侧 `scripts/core-diff/lib/js-ops-b43.mjs`）：`records.*`（序号 / 校验 / 构造 / 谓词 / 最近一次 / 写错过 / 快忘了 / 更正 / 按月索引 …）、`query.*`、`cards.*` / `deck.*`、`structure.*`、`workMembers.*`、`inkPick.*`、`firstResult.*`（含 `inviteShown` / `inviteAnswer` 的写入规则）、`reminder.*`（题目选取）、`ink.*`（管线、抽点、v3 / v4 编解码）、`jsmath.hypot / exp`。注入函数用数据描述：`hasInk` = `{ids: [记录 id…], throwIds?: […]}`。

B4.2 的 op（约定：可选 `policy` = 对生成 policy 的浅覆盖；可选 `deck` = 假题库 `{newCandidates, warmupCandidates?, practicable?, currentLibraryId?}` 或 `"real"`，缺省真题库；`state` 可传 `"mirror"` 用镜像）：
`fsrs.ratingFor / emptyCard / isCompactCard / reviewCard / answerSeenAgainApplies / applyAnswerSeen / applyJudgment / replay / overdueDays / isDue / retrievability`、
`mix.practiceStats / scaledCount / pressureOf / newTargetOf / planGroup / arrangeGroup / dueReviewsDoneOn / newUserCapOf / warmupAllowed`、
`sessions.createSession / currentCardKey / remaining / withCurrent / advance / markLineChanged / clearLine / undoSkip / fsrsBeforeOf / canCorrect / startInSlot / endSlot / clearLastEnded / resumeLines / s02Prompt / endAndStartPicked / expireDaily / recoverSession / nextAKind / selectFirst / wrongReserveOf / skipDeferredNewKeys / selectDaily / specialPlan`、
`newOrder.orderNewKeys / warmupKeys / facts / capital / isCapitalQueue`、`special.capitalProgress / capitalAfterKeysFor / isDeferred`、`groupSize.of / valid / dailyReviewCapOf / listDefaultSelectOf`、
`spread.spreadDue / returnSpreadPerDay / returnSpreadPlan`、`hints.quota / facts / button`、`correct.findFsrsBefore / schedAfterCorrection`、
`start.recordsOf / aStartInfo / planDaily / planSpecial / s02Data / resumableSession`、`schedDeck.facts / practicable`，
提交类 `start.expireStale / resumeSlot / startFirst / startDaily / startNextA / startPicked / endOldAndStartPicked / deferSpecial`（`{state, now, serial}` → 在内存 store 上跑，回包 `{result, commits:[{label, set, schedPatch?, serial}], serial}`），
以及 `tz.set {zone}`（换时区，模拟器的换时区场景用）、`mirror.patch {set?, drop?, records?, sched?}` / `mirror.get`（**镜像**：调度模拟器按引用增量同步 store 状态，避免每步传整份记录；不进状态快照）。JS 一侧：`scripts/core-diff/lib/js-ops-b42.mjs`。
命令行另有 `--math v8|darwin`（`JSMath.flavor`：Math.exp / log 跟 V8 还是 Darwin libm = iOS 上的 JavaScriptCore；缺省 v8）。

B4.4 的 op（`Engine/StoreOps.swift`；JS 一侧 `scripts/core-diff/lib/js-ops-b44.mjs`）：**store 会话**（引擎里至多一个；存在时状态快照多一个 `store` 段 = {backend, disk, state, serial, status, notices, diag?}）`store.open {backend: local|native, disk?, quota?, budgets?, inkFormat?, clock?, fail?}` / `reboot {resume?}` / `close` / `commit {label, ops, reclaim?, replace?}`（mutate 用数据描述：set / delete / month / append / setInk / deleteInk / judgeInk / nextId / patch / prune / endSessions / throw）/ `seed` / `replaceWithBackup` / `fault {failNextWrite?, interruptAfterWrite?, clearFaults?}`（storage 级注入）/ `disk {fail?: 规则表, quota?, quotaRel?, interrupt?, failReads?, failOp?, resume?}`（磁盘级注入）/ `ackCorruptNotice` / `getInk` / `refreshUsage` / `writeRoute` / `writeOne` / `writeAll` / `repair` / `removeKeys`；`budget.*`（entryBytes / bucketOfKey / estimateUsage / storagePressureOf / inkBudgetOf / needsRecovery / recover / pruneInkOfCards / inkTiers / deriveSerial）、`backup.*`（纯函数 + 会话上的 restore / clearAll / undo / dropSafety / markExported / export）、`migrate.*`（readV1 / canonicalCardKey / spreadPerDayOf / convertV1 / legacyBackupToV2 / boot / release）、`native.checksum / digestRows`。B4.2 的提交类 `start.*` 另收 `store: "core"`（只配 `state: "mirror"`）：在 ShiziCore 的真 `Store` 上跑（调度模拟器 `--swift-store core`）。

B4.0 的 op：`hello`（`{protocol, engine, ops}`）、`state`、`reset {state?}`、`echo {value}`、`kv.set/get/delete/keys`、`clock.set {t}`、`clock.advance {ms}`，以及 `dates.*`（`localDay {t?, dayStartHour?}`、`calendarDay`、`periodOf`、`isValidDay`、`isValidMonth`、`daysInMonth`、`parseDay`、`dayStartMs`、`addDays`、`diffDays`、`monthOf`、`addMonths`、`dayOfYear`、`periodOfHour`、`monthDayParts`；不带 `t` 时取引擎时钟）。JS 一侧：`scripts/core-diff/lib/js-engine.mjs`（同名同校验，只做适配、直接调 `src/`）。

```sh
swift build -c release --package-path ios/ShiziCore
echo '{"op":"dates.localDay","args":{"t":1772395199999}}' | TZ=Asia/Shanghai ios/ShiziCore/.build/release/shizi-core-cli
# {"ok":true,"reply":"2026-03-01","state":{"clock":0,"kv":{}}}
```

## 等价性门禁

```sh
pnpm run verify:core-diff            # 编译、swift test、金标准同步、驱动自检、随机差分（4 个时区）、转写清单同步
pnpm run verify:core-diff --nightly  # 夜间 / 合并前：Shanghai 5000 种子、其余各 500
```

| 层（计划 §4.3） | 位置 |
|---|---|
| ① 金标准 | `scripts/core-golden/golden.mjs`（`--check` 由 `test/core/core-diff.test.mjs` 守）→ `Tests/ShiziCoreTests/Fixtures/`；有 `dates`（6 个时区 × 4 点分界 / 0 点 / 夏令时 / 非法键）、`number-format`（JS 数字格式）、`schema`（形状表正反例 + 模型往返 + 基线状态）、`signature`（落款汉字数字 / 题记）、`copy`（文案取用）、`fsrs`（B4.2：四档评分 × 稳定度 × 难度 × 间隔 × fuzz 种子、时钟回拨、看答案、重放，三个时区）、`schedule`（B4.2：随机状态的选字 / 开组 / 过期 / 配比 / 摊开）。配置 / 数据资源另由 `node scripts/build_core_config.mjs --check`（`test/core/core-config.test.mjs`、`pnpm run verify:core-config`）守 |
| ② 单测转写 | 清单 [B4-单测转写清单.md](../../docs/engineering/v10/B4-单测转写清单.md)（`scripts/core-diff/transcription-list.mjs` 生成） |
| ③ 调度模拟器 | `scripts/sim/schedule-sim.mjs --engine js\|swift\|both`：规则适配层 `scripts/sim/lib/rules.mjs`（选字 / 开组 / 过期 / 判断 / 跳过 / 撤销 / 看答案 / 改判里的规则经命令行，记录与存储仍走 JS 的真实 store）、同步调用 `scripts/sim/lib/sync-engine.mjs`（命名管道）；both = 主 store 走 JS、影子 store 走 Swift，逐步比回包与状态，有差异退出码 1 |
| ④ 随机差分 | `scripts/core-diff/run.mjs`：种子化随机序列 → 两引擎逐步比（值 + 字节）→ 失败自动缩小（ddmin，1-最小）→ `scripts/core-diff/out/repro-<种子>.jsonl`，`--replay` 重放；`--only store` 只跑 B4.4 的 store 域（写失败 / 撞配额 / 中断 / 原生结果未知注入）。备份双向往返另有 `scripts/core-diff/backup-roundtrip.mjs` 与金标准 `backup-roundtrip` / `native-rows` |

### 与 V8 逐位对齐的数学函数（B4.3）

墨宽（`decodeInk` v4 → `buildStroke`）对 `Math.exp` / `Math.hypot` 的每一位都敏感，落盘与差分都按字节比，所以 `JSMath` 复刻 V8 的实现而不用 libm：`Math.hypot` = 先按最大值缩放再 Kahan 求和（`builtins/math.tq`）；`Math.exp` = fdlibm（`base/ieee754.cc`，含 exp(1) = E 的特例）。**arm64 的 clang 会把 C++ 里的 `a*b+c` 合成 fma，所以参考值依赖平台**：这里的 `exp` 在会被合成的位置用 `addingProduct`，与 arm64 Mac 上的 Node 逐位一致（`scripts/core-diff` 的 `jsmath.exp` 随机差分是证据）；x86-64 的 Node 没有这个合成，金标准要在 arm64 上生成与核对（CI 同 dev 机）。

### 加一个域（B4.1 起每张卡）

1. Swift：在 `Sources/ShiziCore/<域>/` 移植，在 `CoreEngine.ops` 登记 op（参数校验用 `required / string / finite / bounded / int`）。
2. JS：在 `js-engine.mjs` 的 `OPS` 登记同名 op，参数校验同一规则，规则直接调 `src/`。`test/core/core-diff.test.mjs` 核对两边 op 名一致。
3. 差分：`scripts/core-diff/domains/<域>.mjs` 写参数生成器（偏向边界值），加进 `lib/gen.mjs` 的 `DOMAINS`。生成器只用两边都有的 op（`hello` 取交集），所以 Swift 没移植完的 op 不会误报。
4. 金标准：`scripts/core-golden/domains/<域>.mjs`（`build({ withTZ, opCases })`），加进 `golden.mjs` 的 `DOMAINS`；Swift 测试里调 `runOpGolden("<域>")`。
5. 转写清单里该卡的用例逐条转 XCTest（用例名保留原名，注释写原文件路径）。

### 配置与数据怎么进 Swift（B4.1）

规则数据（policy / motion / char-order / epigraphs / credits / 文案 / 题库 / 落款汉字数字）**不手抄进 Swift**：`scripts/build_core_config.mjs` 从 `src/` 导出 JSON 到 `Sources/ShiziCore/Resources/`（SwiftPM 资源，`Bundle.module`），Swift 一侧只读。改了 `src/config/*`、`src/core/dates.js` 的汉字数字表、`deck-data.js`、`data/context-overrides.js` 就要重跑它；漏了 `test/core/core-config.test.mjs`（verify:unit）、`pnpm run verify:core-config`、`verify:core-diff` 都会红。Xcode 工程接入（B4.5）时把它加成构建阶段（`--check` 模式）。

### B4.5b views 基础批（尚未完成整卡）

`Views/` 已加入 about、block、kuan、library-switch、lines、session、settings 的 Swift 规则；`Engine/ViewOps.swift` 的 32 个纯模型 / 辅助 op 对应 `scripts/core-diff/lib/js-ops-b45v.mjs`。提醒提交辅助函数直接复用 Swift `Store`，未接 App。`views` 域每个种子的前 32 步逐个覆盖这些 op，其后随机抽样；`--only views --seeds 200 --steps 32` 可单独核验。`views-basic.json` 是 10 个固定状态 × 32 个 op × 2 个时区（640 条），纳入既有 golden `--check`。

未完成：annual、detail、home、library、library-all、library-list、mine、mine-page、mine-sub、query（10 文件），相应 op / 夹具 / 转写测试，以及提醒提交辅助函数的 core op 适配。不能把基础批门禁通过解释为 B4.5b 全部视图已等价。
