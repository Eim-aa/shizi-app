# ShiziCore

拾字的规则与数据层的 Swift 版（原生化第④步，B4）。只依赖 Foundation。计划与验收见 [B3B4-原生化架构与计划.md](../../docs/engineering/v10/B3B4-原生化架构与计划.md) §4、§6.2。

**D84（2026-11-03）起 Swift 是唯一实现**：网页版和仓库里的 JS 引擎已删除。ShiziCore 当年是 JS（`src/` 的无 DOM 集）的逐字段移植，连 JS 的边角行为一起照搬（两位年怪癖、无效时间得 `"NaN-NaN-NaN"` 等）——这些行为现在由 `Tests/ShiziCoreTests/` 的转写用例和冻结夹具钉住；下文提到的 `src/...js`、`scripts/core-diff`、`golden.mjs` 都是移植时的历史说明（要找回看版本历史，D84 清扫前的提交）。产品决定改规则时，直接改 Swift、测试与夹具里受影响的条目，并在提交说明里写清是哪条决定。

## 结构

| 位置 | 内容 |
|---|---|
| `Sources/ShiziCore/JSON/` | `JSValue` / `JSObject`（JS 对象键序：数组下标形的键升序在前、其余按插入序；字符串按码点判等，不用 Swift 的规范等价）；`JSONParser` ≡ `JSON.parse`；`JSONWriter` ≡ `JSON.stringify`（数字按 ECMAScript Number::toString） |
| `Sources/ShiziCore/Dates/` | `JSDate`：JS Date 的本地时间语义（前推格里历、TimeClip、夏令时缺口按 V8 取跳变前偏移）；`Dates`：`src/core/dates.js` 的 1:1 移植（B4.0 示例域）；`Signature.swift`：落款汉字数字 cnDigits / cnNumber / cnCount / signature*（汉字读生成的 signature.json） |
| `Sources/ShiziCore/Config/` | 生成配置的读取：`Config`（policy / motion / credits / char-order / epigraphs / copy 的 JSValue 与 `policyValue("a.b")`）、`CharOrder`、`Epigraphs`、`Copy`（占位符填充与取用，≡ `config/copy/index.js`）、`PolicyCoverage`（P 编号登记检查） |
| `Sources/ShiziCore/Resources/*.json` | **手改的唯一真相源**（D84，见 `Bundled/README.md`；deck.json 由 `scripts/build_8105_chars.py` 写，char-order / credits 由各自脚本写入）：policy / policy-meta / motion / char-order / epigraphs / credits / deck-meta / signature / copy / deck，B4.2 加 fsrs-config（`FSRS_CONFIG`）与 deck-libraries（全部卡键、四个字库的成员与缺省字库，`data/deck.js` 现算）。Swift 源码里没有规则数值与汉字字面量，全部读这里 |
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

**App 接入（B4.5c）**：App target 链 `ShiziCore` 与 `ShiziImageRendering` 两个产品；`SwiftEngine: ShiziEngine`（`ios/ShiziApp/ShiziApp/SwiftEngine*.swift`）把 `SessionRuntime` 挂到 B3 的引擎协议上，宿主函数（导航、平台、排版量测）在 App 的 `EngineHost`。缺省仍是 WebEngine；DEBUG `-shizi-engine swift|shadow` 见计划 §10.x B4.5c+B4.7。

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

## 核心门禁（D84）

```sh
pnpm run verify:core    # = swift build -c release --package-path ios/ShiziCore && swift test --package-path ios/ShiziCore
```

B4 期间 ShiziCore 对 JS 参考引擎做过四层等价性核对（金标准夹具、单测转写、调度模拟器、随机差分，`verify:core-diff`）。**D84（2026-11-03）删除网页版与仓库 JS，这套对照退役**：最后一次 `verify:core-diff --nightly`（Shanghai 5000 × 300 等）的结果存档在 [D84-最后一次JS差分.md](../../docs/engineering/v10/D84-最后一次JS差分.md)，之后的参考只剩 Swift 自己的测试：

- `Tests/ShiziCoreTests/` 的转写用例（702 项以上）；
- `Tests/ShiziCoreTests/Fixtures/*.json`：**冻结的 Swift 回归夹具**，不再重生成（见该目录 README；D83 调度规则 v2 改了行为的条目已从夹具删掉）；
- 配置 / 数据资源 `Bundled/*.json` 是手改的唯一真相源，由 `ConfigDataTests` 等读 JSON 守；
- `shizi-core-cli`（下面各 op 说明里的 JS 一侧路径都是历史说明，对应脚本已删，要找回看 Git 历史）。

### 与 V8 逐位对齐的数学函数（B4.3）

墨宽（`decodeInk` v4 → `buildStroke`）对 `Math.exp` / `Math.hypot` 的每一位都敏感，落盘与差分都按字节比，所以 `JSMath` 复刻 V8 的实现而不用 libm：`Math.hypot` = 先按最大值缩放再 Kahan 求和（`builtins/math.tq`）；`Math.exp` = fdlibm（`base/ieee754.cc`，含 exp(1) = E 的特例）。**arm64 的 clang 会把 C++ 里的 `a*b+c` 合成 fma，所以参考值依赖平台**：这里的 `exp` 在会被合成的位置用 `addingProduct`，与 arm64 Mac 上的 Node 逐位一致（当年 `scripts/core-diff` 的 `jsmath.exp` 随机差分是证据）；x86-64 的 Node 没有这个合成，金标准要在 arm64 上生成与核对（CI 同 dev 机）。

### 加一个域

1. Swift：在 `Sources/ShiziCore/<域>/` 实现，在 `CoreEngine.ops` 登记 op（参数校验用 `required / string / finite / bounded / int`）。
2. XCTest：在 `Tests/ShiziCoreTests/` 写规则断言；需要钉死大量数值输出时，手写（或用 `shizi-core-cli` 跑出来、人看过之后存下）一份 JSON 夹具放进 `Fixtures/`，并在测试里读它。夹具生成是一次性的，之后冻结（`Fixtures/README.md`）。

### 配置与数据怎么进 Swift（B4.1）

规则数据（policy / motion / char-order / epigraphs / credits / 文案 / 题库 / 落款汉字数字）**不手抄进 Swift**：放在 `Sources/ShiziCore/Bundled/*.json`（SwiftPM 资源，`Bundle.module`），Swift 一侧只读。D84 起这些 JSON 是手改的唯一真相源（见 `Bundled/README.md`）；只有 `deck.json`（`scripts/build_core_config.mjs`）、`char-order.json`、`credits.json`（各自脚本）仍有生成脚本。

### B4.5b views

`Views/` 已覆盖 `src/session/views/*.js` 全部 17 个文件；共享 JSValue / copy 引用构造在 ViewSupport，84 个纯模型 / 辅助 / 提交适配 op 在 ViewOps，JS 镜像调用真实函数。query 文件名为 QueryView.swift，避免与核心 Query.swift 的 SwiftPM 同名编译冲突。记录索引与月份计算在 Mine.swift；记忆分区 / 墙规则在 Library.swift，供其他视图复用。

当年 `views` 域每个种子的前 84 步逐项覆盖全部 op，`core-diff` 比较值和 JSON 字节（D84 起该差分已退役，下面的夹具与 ViewParityTests / ViewRuleTests 是现存的回归）。

`views-basic.json` 保留 640 条；第二套 `views-pages.json` 为 10 个状态 × 52 个新增 op × 2 时区 = 1,040 条。两套夹具已冻结（不再重生成），ViewParityTests / ViewRuleTests 核对夹具并转写规则断言。提醒提交与 query.add 适配器走真实内存 Store，比较失败 / 重试 / no-op 的每次回包和完整状态。

折行保留 JS 的 provider 注入契约：`breaks` 参数按 kind 提供测量数组，非法返回 / 抛错 / 无 provider 都是 null。实际 DOM / 字体测量属于渲染器边界；不会在 Swift 规则里猜测断行。没有接 App、改变产品规则或运行 iOS 模拟器。

### B4.5a session

`SessionRuntime` 是 Store-backed 的 session/page API 入口，未接 App。缺省数学口径 `.darwin`（设备 JSC），CLI/XCTest 用 `.v8`（Node）。写入复用 Store.commit、已有规则与 B4.5b views；CLI 的 `api.call {op,args}` 与纯 `view.*` 差分 op 分开。

本卡 12/12 行已完成：完整结果模型/页面视图、write/result 宿主注入、邀请权限等待、近期墨迹 cache、提示 helper/provider、真实图片和首页/字库动作、query/S02 异步回调、数据/环境/折行 provider、changed feed 与提醒 controller。宿主通过 `WriteDependencies`、`SessionActionHooks` 注入平台函数；异步操作使用 `SessionRuntime.callAsync`。`PageRegisteredActions.install` 登记真实 S02 结束旧组/开新组回调，导航事件交给宿主（`s02-close` 是关框控制事件）。image.render/save 继续由 B4.6 的 native renderer 提供。

当年 `verify:core-diff` 强制执行 25-family 成功/失败门禁（2,014 次全回复/状态比较），另跑 session 200×300、四时区差分及 store 专项（D84 起退役）。契约金标准 220 场景/1,196 步，两时区×两后端，夹具冻结。write 的非确定性能采样 ms 是唯一去掉的字段。

B4.5a 当时的最终门禁：Swift 640/640；unit 1680 pass / 0 fail / 1 既有 todo；core-diff、copy/data、所有 fixture --check 全过（历史记录）。详细范围、边界、JS 原行为及逐行提交见 [B4.5a-core-移植状态.md](../../docs/engineering/v10/B4.5a-core-移植状态.md)。App 接线与删除 JS 按后续卡的验收执行。

### B4.5c / B4.7 宿主注入口

App 的影子比对（WebEngine ⇄ SwiftEngine，同一前态逐值比）抓到几处 Swift 把「JS 由界面层注入的值」写死了，已改成走宿主注入、没注入保持原值（命令行 / 差分不变；`EngineInjectionTests`）：结果页 `lines`、图片预览 `noteStarts` / `failStarts` / 选字条 `thumb`（`ImageRegisteredActions.thumb`）、换库页 `sourceStarts`、`SessionRuntime` 的 `write.*` 路径也装宿主量测；`SessionActionHooks.now` = createAppApi 的 `ctx.now`（字详情的「今天」、阻断页导出备份的时刻——JS 原样：App 里是墙上时钟，不带测试宿主钉住的偏移）。
