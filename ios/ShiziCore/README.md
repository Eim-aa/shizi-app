# ShiziCore

拾字的规则与数据层的 Swift 版（原生化第④步，B4）。只依赖 Foundation。计划与验收见 [B3B4-原生化架构与计划.md](../../docs/engineering/v10/B3B4-原生化架构与计划.md) §4、§6.2。

**参考实现是 JS**（`src/` 的无 DOM 集）。Swift 版每一个可观察行为都要与 JS 逐字段相等，连 JS 的边角行为一起照搬（两位年怪癖、无效时间得 `"NaN-NaN-NaN"` 等）；发现不同时以 JS 为准，除非产品决定改规则（那就两边一起改，差分会拦住只改一边）。

## 结构

| 位置 | 内容 |
|---|---|
| `Sources/ShiziCore/JSON/` | `JSValue` / `JSObject`（JS 对象键序：数组下标形的键升序在前、其余按插入序；字符串按码点判等，不用 Swift 的规范等价）；`JSONParser` ≡ `JSON.parse`；`JSONWriter` ≡ `JSON.stringify`（数字按 ECMAScript Number::toString） |
| `Sources/ShiziCore/Dates/` | `JSDate`：JS Date 的本地时间语义（前推格里历、TimeClip、夏令时缺口按 V8 取跳变前偏移）；`Dates`：`src/core/dates.js` 的 1:1 移植（B4.0 示例域）；`Signature.swift`：落款汉字数字 cnDigits / cnNumber / cnCount / signature*（汉字读生成的 signature.json） |
| `Sources/ShiziCore/Config/` | 生成配置的读取：`Config`（policy / motion / credits / char-order / epigraphs / copy 的 JSValue 与 `policyValue("a.b")`）、`CharOrder`、`Epigraphs`、`Copy`（占位符填充与取用，≡ `config/copy/index.js`）、`PolicyCoverage`（P 编号登记检查） |
| `Sources/ShiziCore/Resources/*.json` | **生成物**（`node scripts/build_core_config.mjs`；`--check` 守与 `src/` 同步）：policy / policy-meta / motion / char-order / epigraphs / credits / deck-meta / signature / copy / deck。Swift 源码里没有规则数值与汉字字面量，全部读这里 |
| `Sources/ShiziCore/Deck/` | `DeckData`：deck.json（SEED / GROUPS / CONTEXT_OVERRIDES）的原始数据，懒加载 |
| `Sources/ShiziCore/Schema/` | `Schema`：`src/core/schema.js` 的 1:1 移植（键表、形状校验、备份外壳），返回的「路径: 原因」字串与 JS 逐字相同 |
| `Sources/ShiziCore/Models/` | 全部域的模型（记录 / 折叠月 / sched / 墨 v2 v3 v4 / 设置 / 会话 / 保护副本 / 事务日志 …）。**不是 Foundation 的 Codable**（JSONEncoder 没有 JS 的键序与数字格式），而是 `JSCodable`（`init(js:)` / `js`）：解码记下键序，编码先按记下的键序写、新建的按 JS 写入处的规范键序；三态字段（缺省 / null / 值）用 `Field<T>`；数字一律 Double |
| `Sources/ShiziCore/Engine/` | `CoreEngine`（op 表 + JSON 行协议）；`ConfigOps` / `SchemaOps`（B4.1 的 op） |
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
| ① 金标准 | `scripts/core-golden/golden.mjs`（`--check` 由 `test/core/core-diff.test.mjs` 守）→ `Tests/ShiziCoreTests/Fixtures/`；有 `dates`（6 个时区 × 4 点分界 / 0 点 / 夏令时 / 非法键）、`number-format`（JS 数字格式）、`schema`（形状表正反例 + 模型往返 + 基线状态）、`signature`（落款汉字数字 / 题记）、`copy`（文案取用）。配置 / 数据资源另由 `node scripts/build_core_config.mjs --check`（`test/core/core-config.test.mjs`、`pnpm run verify:core-config`）守 |
| ② 单测转写 | 清单 [B4-单测转写清单.md](../../docs/engineering/v10/B4-单测转写清单.md)（`scripts/core-diff/transcription-list.mjs` 生成） |
| ③ 调度模拟器 | `scripts/sim/schedule-sim.mjs --engine js\|swift\|both`（swift / both 由 B4.2 接入，挂点 `scripts/sim/lib/engine-select.mjs`） |
| ④ 随机差分 | `scripts/core-diff/run.mjs`：种子化随机序列 → 两引擎逐步比（值 + 字节）→ 失败自动缩小（ddmin，1-最小）→ `scripts/core-diff/out/repro-<种子>.jsonl`，`--replay` 重放 |

### 加一个域（B4.1 起每张卡）

1. Swift：在 `Sources/ShiziCore/<域>/` 移植，在 `CoreEngine.ops` 登记 op（参数校验用 `required / string / finite / bounded / int`）。
2. JS：在 `js-engine.mjs` 的 `OPS` 登记同名 op，参数校验同一规则，规则直接调 `src/`。`test/core/core-diff.test.mjs` 核对两边 op 名一致。
3. 差分：`scripts/core-diff/domains/<域>.mjs` 写参数生成器（偏向边界值），加进 `lib/gen.mjs` 的 `DOMAINS`。生成器只用两边都有的 op（`hello` 取交集），所以 Swift 没移植完的 op 不会误报。
4. 金标准：`scripts/core-golden/domains/<域>.mjs`（`build({ withTZ, opCases })`），加进 `golden.mjs` 的 `DOMAINS`；Swift 测试里调 `runOpGolden("<域>")`。
5. 转写清单里该卡的用例逐条转 XCTest（用例名保留原名，注释写原文件路径）。

### 配置与数据怎么进 Swift（B4.1）

规则数据（policy / motion / char-order / epigraphs / credits / 文案 / 题库 / 落款汉字数字）**不手抄进 Swift**：`scripts/build_core_config.mjs` 从 `src/` 导出 JSON 到 `Sources/ShiziCore/Resources/`（SwiftPM 资源，`Bundle.module`），Swift 一侧只读。改了 `src/config/*`、`src/core/dates.js` 的汉字数字表、`deck-data.js`、`data/context-overrides.js` 就要重跑它；漏了 `test/core/core-config.test.mjs`（verify:unit）、`pnpm run verify:core-config`、`verify:core-diff` 都会红。Xcode 工程接入（B4.5）时把它加成构建阶段（`--check` 模式）。
