# ShiziCore

拾字的规则与数据层的 Swift 版（原生化第④步，B4）。只依赖 Foundation。计划与验收见 [B3B4-原生化架构与计划.md](../../docs/engineering/v10/B3B4-原生化架构与计划.md) §4、§6.2。

**参考实现是 JS**（`src/` 的无 DOM 集）。Swift 版每一个可观察行为都要与 JS 逐字段相等，连 JS 的边角行为一起照搬（两位年怪癖、无效时间得 `"NaN-NaN-NaN"` 等）；发现不同时以 JS 为准，除非产品决定改规则（那就两边一起改，差分会拦住只改一边）。

## 结构

| 位置 | 内容 |
|---|---|
| `Sources/ShiziCore/JSON/` | `JSValue` / `JSObject`（JS 对象键序：数组下标形的键升序在前、其余按插入序；字符串按码点判等，不用 Swift 的规范等价）；`JSONParser` ≡ `JSON.parse`；`JSONWriter` ≡ `JSON.stringify`（数字按 ECMAScript Number::toString） |
| `Sources/ShiziCore/Dates/` | `JSDate`：JS Date 的本地时间语义（前推格里历、TimeClip、夏令时缺口按 V8 取跳变前偏移）；`Dates`：`src/core/dates.js` 的 1:1 移植（B4.0 示例域；落款汉字数字随 B4.1） |
| `Sources/ShiziCore/Engine/CoreEngine.swift` | op 表 + JSON 行协议 |
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
| ① 金标准 | `scripts/core-golden/golden.mjs`（`--check` 由 `test/core/core-diff.test.mjs` 守）→ `Tests/ShiziCoreTests/Fixtures/`；B4.0 有 `dates`（6 个时区 × 4 点分界 / 0 点 / 夏令时 / 非法键）与 `number-format`（JS 数字格式） |
| ② 单测转写 | 清单 [B4-单测转写清单.md](../../docs/engineering/v10/B4-单测转写清单.md)（`scripts/core-diff/transcription-list.mjs` 生成） |
| ③ 调度模拟器 | `scripts/sim/schedule-sim.mjs --engine js\|swift\|both`（swift / both 由 B4.2 接入，挂点 `scripts/sim/lib/engine-select.mjs`） |
| ④ 随机差分 | `scripts/core-diff/run.mjs`：种子化随机序列 → 两引擎逐步比（值 + 字节）→ 失败自动缩小（ddmin，1-最小）→ `scripts/core-diff/out/repro-<种子>.jsonl`，`--replay` 重放 |

### 加一个域（B4.1 起每张卡）

1. Swift：在 `Sources/ShiziCore/<域>/` 移植，在 `CoreEngine.ops` 登记 op（参数校验用 `required / string / finite / bounded / int`）。
2. JS：在 `js-engine.mjs` 的 `OPS` 登记同名 op，参数校验同一规则，规则直接调 `src/`。`test/core/core-diff.test.mjs` 核对两边 op 名一致。
3. 差分：`scripts/core-diff/domains/<域>.mjs` 写参数生成器（偏向边界值），加进 `lib/gen.mjs` 的 `DOMAINS`。生成器只用两边都有的 op（`hello` 取交集），所以 Swift 没移植完的 op 不会误报。
4. 金标准：`scripts/core-golden/domains/<域>.mjs`（`build({ withTZ, opCases })`），加进 `golden.mjs` 的 `DOMAINS`；Swift 测试里调 `runOpGolden("<域>")`。
5. 转写清单里该卡的用例逐条转 XCTest（用例名保留原名，注释写原文件路径）。
