# 数据层：deck-data 题库结构、GROUPS 部件分组、笔顺 JSON、字源、治理清单、生成脚本

> 阅读范围：`deck-data.js`、`data/`（7294 个单字笔顺 JSON + `etymology.json` + `context-overrides.js`）、`core-strokes.js`、`generated/*.json`、`sources/`、`audit/`、`scripts/build_8105_chars.py`、`scripts/build_etymology.py`、`scripts/verify_library_governance.py`、`sw.js` / `index.html` 中的数据接线。所有路径相对仓库根 `/Users/orange/Documents/ChatGPT/astraworld/shizi-app`。数字均为本次用 node/python 实测。

## 1. 概览

拾字的题库是一份**生成产物**：`scripts/build_8105_chars.py` 以《通用规范汉字表（2013）》8105 字为母集，按"本地有笔顺 JSON"为可练条件筛出 7294 字，每字恰好生成**一张卡**（`SEED` 7294 行，target 唯一），并给每字一组**笔画分段** `GROUPS`（7294/7294 全覆盖），一起写进单文件 `deck-data.js`（2,122,072 B，第 3 行 SEED 2.02 MB，第 5 行 GROUPS 104 KB；node vm 解析+求值约 21 ms）。四个字库不是四份数据，而是 SEED 行上的两个字段：`norm ∈ {一级 3500, 二级 2976, 三级 818}` 和 `edu ∈ {表一 2500, 表二 1000, null}`，运行时用 `c.norm==="一级"` 等谓词过滤（`index.html:1121-1126`）。笔顺数据是 hanzi-writer 格式的 per-char JSON（`{strokes, medians, radStrokes?}`，平均 3.15 KB，合计 22.99 MB），6854 字来自 Hanzi Writer Data 2.0.1 基线，440 字来自经人工验收的项目补充（`audit/`）。字源 `etymology.json`（1035 行，三字段）与语境覆盖 `context-overrides.js`（105 字，#105 人工批准）是两份独立小文件。资源版本用"文件 sha256 前 12 位"作 `?v=` 指纹，手工同步到 `index.html` `<meta shizi-asset-build>`、`sw.js` `BUILD/SHELL`，由 `verify_pwa_upgrade.js` 门禁校验。持久化身份是 `base:<字>` / `custom:<字>`，不再依赖 SEED 索引；但 SEED **顺序**（按字频排序）被治理门禁的 sha256 钉死，分片时需一并处理。

## 2. 组件/模块清单

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
|---|---|---|---|---|---|---|
| `SEED` 题库 | `deck-data.js:1-3`（第 3 行单行 2,017,399 字符） | 7294 张字词卡：拼音/语境词/难度/主题/规范等级/课标成员 | 全局 `const SEED`（16 个字段，见 §3.1） | 由 `build_8105_chars.py:835-903 patch_index` 生成 | **可直接复用（数据）**；加载方式可改造 | 首行"勿手改"；`index.html:1039` 注释仍写 1.9MB，实际 2.12MB |
| `GROUPS` 部件分组 | `deck-data.js:4-5` | 每字连续笔画段长度数组，1–5 段，sum==strokes | 全局 `const GROUPS = {字: int[]}` | 6854 字算法生成（Make Me a Hanzi `matches`），440 字取 `audit/vector-data-460-hint-groups.json` | **与 v10 决定冲突（待定项）**：决定表写"部件分组来源、覆盖、审核…待定；演示 groups 不是全库资源" | 6854 字的分组无人审记录；仅"段长度"，无部件名/笔画类别 |
| 卡片构建 `CARDS` | `index.html:1040-1054` | `SEED.forEach(applyContextOverride)` → `CARDS`；`BASE_N`、`BASE_BY_CHAR` | `CARDS[i]`、`BASE_BY_CHAR[字]→i`、`BASE_N` | `SEED`、`CONTEXT_OVERRIDES` | 可抽取改造 | 走 `Number.isInteger(w.ci)` 分支，每行一卡；逐字拆分的 else 分支为遗留死路径 |
| 语境覆盖（运行时） | `data/context-overrides.js`（3,141 B），`index.html:1041-1047` | #105 首批人工批准：boost / 换词 w+ci / 白话释义 gloss | 全局 `CONTEXT_OVERRIDES = {字:{boost?,w?,ci?,gloss?}}`；运行时产出 `ctx:"override"|"gloss"` | 核对 fixture `scripts/fixtures/context-overrides-approved.json` | 可直接复用 | 与生成脚本内同名字典（`build_8105_chars.py:73-180`）是**两层不同的覆盖**，后者产出 `ctx:"override"` 105 行 |
| 字库定义 `LIBRARIES` | `index.html:1121-1126` | 四库谓词 + officialTotal | `{id, name, desc, officialTotal, test(c)}`；`LIB_KEY="shizi.library.v1"` 存 `{id,userSelected}` | `c.norm`、`c.edu` | 可直接复用（v10 L10 换库列表"可以练 N · 有记录 M"需从数据算） | `LEGACY_LIBRARY_IDS` 迁移旧小学/初中/高中（1129-1130） |
| 卡片身份键 | `index.html:1541-1543`、`1393-1394`、`2109-2118` | `cardKey(i)=(custom?"custom:":"base:")+target`；`canonicalCardKey` 幂等迁移旧 `custom:<index>:<字>`；`indexForCardKey` | memory/quality/status/fsrsLog/activity 一律以 key 为主键 | `BASE_BY_CHAR`、`customIndexOf` | 可直接复用 | 会话快照 v3 也存 key（`sessionPayload` 1498 `storedCardRefs`），v1/v2 索引式快照直接丢弃（1527） |
| 笔顺 JSON | `data/<字>.json` ×7294 | hanzi-writer 字形数据 | `fetch('data/'+encodeURIComponent(ch)+'.json')`（`index.html:2272-2274 charLoader`，`2278 warmStrokeCache`） | hanzi-writer.min.js `charDataLoader` | 可直接复用 | 无 CDN 回落（CHANGELOG 2026-08-08："去掉远程笔顺回落"）；`sw.js:7` 头注释"跨源 CDN 兜底"已过时 |
| 核心 600 字清单 | `core-strokes.js`（3,768 B） | SW 安装时预缓存且永不淘汰的字 | `self.SHIZI_CORE_STROKES: string[]`，仅 `sw.js:9,15` 使用 | `build_8105_chars.py:35,882-883`：15 个校准字 + 按 rank 补满 600 | 可直接复用；v10 首练改 5 字后校准字含义待核 | `index.html` 不引用它 |
| 字源 | `data/etymology.json`（106,411 B，1035 行） | 单字详情一行"字源" | `fetch("data/etymology.json")`→`Map(char→row)`（`index.html:1981-1986`） | `build_etymology.py`，需外部 clone `shuowenjiezi/shuowen@6553a35` | 可直接复用 | 在 `sw.js:14 SHELL` 但**无指纹**，只随 VERSION 整体换新 |
| 生成脚本 | `scripts/build_8105_chars.py`（45,744 B） | 选字、分组、选语境、算难度/主题，写 `deck-data.js`/`core-strokes.js`/三份 generated，patch `index.html` DECK_KEY | 无 CLI 参数；`python3 scripts/build_8105_chars.py` | pypinyin 必需；jieba/wordfreq 可选（`:57-63`）；所有 sources/audit 文件 | 可抽取改造（若要分片输出） | **不更新指纹/BUILD**（docstring `:838-843` 要求手工同步） |
| 字源生成脚本 | `scripts/build_etymology.py` | 从说文/MMAH 生成 ≤20 字白话字源 + 覆盖报告 | `--shuowen-dir`、`--check` | deck top-1000 rank + hanzi_db 部首；三份 fixtures | 可直接复用 | 目标集依赖 SEED 的 `rank` 字段（`:143-148, 415-425`） |
| 治理清单 | `generated/library-governance.json`（6,436 B） | 8105 字逐字"可练/不可练"及来源哈希 | 见 §3.6 | `library_governance_report` `:912-975` | 可直接复用 | `license_review: OUT_OF_SCOPE_PENDING_SEPARATE_REVIEW` |
| 覆盖报告 | `generated/hanzi_writer_coverage.json`（94 KB） | 三级各多少字有笔顺 | `{total 8105, available 7294, missing 811, by_level, missing_chars[]}` | `coverage_report` `:477-501` | 可直接复用 | |
| 候选全量 | `generated/selected_8105_candidates.json`（6.39 MB） | 26 字段/字的中间产物 + skipped | `{selected:[…], skipped:{no_hanzi_writer:[811], no_make_me_hanzi:[], stroke_mismatch:[]}}` | 同上 | 不进运行时；供审计/门禁 | 含 `decomposition`、`radical`、`group_source`、`context_word_freq/tag` 等运行时未带的字段 |
| 治理门禁 | `scripts/verify_library_governance.py`（`pnpm verify:data`） | 钉死 sources 哈希、7294 成员与**顺序**、四库计数、GROUPS 与 440 审定分组一致 | `EXPECTED_SELECTED_ORDER_SHA256`（`:25`）等常量 | 解析 `deck-data.js` 的 `const SEED = ` / `const GROUPS=` 前缀（`:58-71`） | 分片时**必须改** | 还断言 `index.html` 文案（`:150-153`） |
| 矢量补充审计 | `audit/vector-data-460-*.json`、`audit/vector-data-460-evidence/` | 440 字补充笔顺的来源/哈希/人工验收链 | `scripts/verify_vector_data_440.js` | — | 可直接复用（只读证据） | hint-groups 的 `source_bindings` 指向仓库**不存在**的 `sources/chaifen-0.4.0/*`、`tmp/vector-mve/*.py` |

## 3. 数据契约

### 3.1 `SEED` 行（`deck-data.js:3`；生成于 `build_8105_chars.py:860-878`）

7294 行，16 个字段全部非缺省。实测值域：

| 字段 | 类型 | 含义 / 推导 | 值域（实测） |
|---|---|---|---|
| `target` | string | 目标字（单码位；含 Ext-A/B：㧐 𠙶 𬇕 𬜯 㬎 五字不在 U+4E00–9FFF） | 7294 唯一 → **一字一卡** |
| `ans` | string | 语境词（`choose_context` `:738-782`：build-time CONTEXT_OVERRIDES → jieba/wordfreq 词表打分 → 兜底 `f"{字}字"`） | 长度 2/3/4 = 6155/565/574；全部含 target；**113 行 target 出现 ≥2 次**（W24 "越来越"类） |
| `ci` | int | target 在 `ans` 中的下标 | 0–3；`ans[ci]===target` 7294/7294 |
| `py` | string | **语境词中该字的读音**（`pypinyin(word, TONE, heteronym=False)[idx]`，`:747,764`） | 无空格；注意变调已烘进：一→`yí`（一个）、不→`bú`（不是）、的→`dì`（目的） |
| `hint` | string | 模板 `"{norm} · 书写{band} · 常用语境 · {strokes}画 · {parts}个部件 · 字频#{rank\|未收录}"`（`:862`） | 21 种模式；合计 552,557 B（占文件 26%）；运行时仅在 custom/gloss 卡读 `cur.hint`（`index.html:2498`），基础卡的 hint 实际是死数据 |
| `rank` | int | `hanzi_db.frequency_rank`，缺失则 `999999+standard_order`（`:713`） | 1–1,008,100；≥999999 者 440 行（hint 显示"未收录"）；非连续（index 2130 处 2130→2132） |
| `strokes` | int | 补充 440 字 = sum(groups)；其余 = `hanzi_db.stroke_count` 或 `len(matches)`（`:707-712`）；并与 `data/<字>.json` 的 `strokes.length` 核对（`validate_and_fetch :811-828`） | 1–36 |
| `parts` | int | `len(groups)` | 1–5：43/2288/2465/1508/990 |
| `topic` | string | `infer_topic` `:229-251`（TOPIC_RULES 字符/英文释义关键词打分） | 23 值：学习 1057、综合 994、自然 907、动作 451、身体 443、… 文化 61 |
| `d` | int | `calc_difficulty` `:254-268`（字频 log 28 分 + 笔画 40 + 部件 18 + 紧凑复杂度 + 语境罚分 + 生僻加成 − 初级减 18） | 2–100 |
| `band` | string | `difficulty_band` `:271-280` | 入门(d<35) 283 / 基础(<52) 969 / 进阶(<68) 2276 / 较难(<84) 2044 / 挑战 1722；实测 d 区间与阈值严格一致 |
| `edu` | string\|null | `"表一"` 若在 `curriculum-common-2500.txt`；`"表二"` 若一级但不在表一；否则 null（`:719`） | 表一 2500 / 表二 1000 / null 3794；表一、表二均 ⊂ 一级 |
| `common` | number | 语境词常用度 `round(commonness,2)`（`:875`） | **实测只有整数 {0,2,3,4,5,6,7}**：dict 行 = `1+len(str(jieba_freq))`（`:765` 的无 wordfreq 分支），override/fallback 行 = 0 → **本份 deck 是在没有 wordfreq 的环境生成的**，`common` 是位数代理而非 zipf |
| `norm` | string | 规范等级 | 一级 3500 / 二级 2976 / 三级 818 |
| `std` | int | 《通用规范汉字表》累计序号 `standard_order`（`read_standard_table :296-312`） | 1–8105，7294 唯一 |
| `ctx` | string | 语境来源 | dict 6235 / override 105 / fallback 954；运行时另加 `gloss`（覆盖表）与 `custom` |

**排序**：`choose_candidates :733` 按 `(frequency_rank, norm_level_index, standard_order)`，实测 SEED 严格满足。**三库在数组中交错**：一级索引 0–6854、二级 1173–6965、三级 2024–7293；表一 0–4108。按库分片的字节量：一级 967,596 B、二级 820,252 B、三级 229,539 B（表一 689,789 B 为一级子集）；GROUPS 104,374 B。

运行时 `CARDS[i]` 在 SEED 各字段之上补默认值（`index.html:1049`），自定义卡追加在 `BASE_N` 之后并带 `custom:true, norm:"自定义", ctx:"custom", strokes:0, parts:1`（`:2103`）。

### 3.2 `GROUPS`（`deck-data.js:5`）

`{ "<字>": [n1, n2, …] }`，每项为**按标准笔顺连续的一段笔画数**，1 ≤ 段数 ≤ 5，`sum === strokes`（7294/7294 实测成立；运行时也校验，不等则退化为 `[totalStrokes]`，`index.html:2508`）。键集合 == SEED target 集合（无多无少）。

来源两路：
- 6854 字：`build_group_resolver :597-650`——用 Make Me a Hanzi 每笔的 IDS 路径 `matches`，在深度 0 上把相同路径前缀的连续笔画归一段（`match_runs :583-594`）；段 ≥5 笔时尝试用深度 +1 再切；段 ≥6 且对应一个独立收录的部件字时递归借用该部件的分组；超过 5 段时合并相邻最小两段；`OVERRIDES={"邋":[3,5,7,3]}`（`:69-71`）。**无人工审核记录**。
- 440 字：`audit/vector-data-460-hint-groups.json`（Chaifen 0.4.0 G-tagged 部件图 + tygf.txt 五类笔顺；`read_vector_data_hint_groups :436-475` 校验 sha 绑定、段数、sum）。该文件每条 record 还有 `group_details[{stroke_start_1based, stroke_end_1based, stroke_classes, top_components, component_paths}]`，比运行时 GROUPS 丰富（运行时只保留段长度）。

运行时用法（`index.html:2558-2566`）：每按一次"点拨"播放**下一段**（`groups[groupIdx]` 笔），`groupIdx>=groups.length` 时禁用（`:2371,2380`）。

### 3.3 笔顺 JSON（`data/<字>.json`）

- 文件名即字本身（7294 个，均单码位，用 `encodeURIComponent` 取 URL）。总 22,991,424 B，平均 3,152 B，最小 361 B（`一`），最大 32,603 B；`du -sh data` = 33 MB（含块开销与 etymology/overrides）。
- 形状：`{"strokes": string[], "medians": [[x,y],…][], "radStrokes"?: int[]}`。`strokes` 为 SVG path（hanzi-writer 1024 单位坐标系，`M … Q … Z`），`medians` 每笔中线点列；`strokes.length === medians.length` 7294/7294。`radStrokes`（部首笔画下标）6492 个文件有，802 个没有——其中 440 补充字按门禁**必须恰好** `{strokes, medians}` 两键（`build_8105_chars.py:374-383`，`audit` manifest `gates.exact_strokes_and_medians_keys`）。
- 例：`data/一.json` 1 笔；`data/的.json` 8 笔，`radStrokes:[0,1,2,3,4]`（白）。

### 3.4 `data/etymology.json`

JSON 数组，1035 行，每行恰好 `{"char","gloss","source"}`，`gloss` ≤ 20 字，`source ∈ {"《说文解字》"(956), "Make Me a Hanzi"(79)}`。目标集 = SEED `rank ≤ 1000` 的字 ∪ `hanzi_db` 中 SEED 字的部首（`build_etymology.py:415-425`），共 1132，覆盖 1035（top-1000 覆盖 906，部首 207/212）。覆盖详情 `generated/etymology-coverage.json`（schemaVersion 2，含 `detail[char]{source,sourceId,sourceHeadword,matchKind,original}` 与 `omissions`）。

### 3.5 `data/context-overrides.js`

```
const CONTEXT_OVERRIDES = { "<字>": {boost?:true, w?:string, ci?:int, gloss?:string} }
```
（`:1-4` 头注释）。运行时（`index.html:1042-1047`）：`boost` → `common=max(common,1.2)`；`w`+`ci`（且 `w[ci]===target`）→ 替换 `ans/ci`，`ctx="override"`；`gloss` → `ans=target, ci=0, ctx="gloss", hint=gloss, common=max(common,1)`。"目标字、读音和 base:<字> 记忆键保持不变"。fixture `scripts/fixtures/context-overrides-approved.json` 列 approvedWords/approvedGlosses/boostOnly/rejectedPromptWords。

### 3.6 `generated/library-governance.json`（schema_version 1）

`normative_source{title,url,files[{path,level,count,sha256}],total:8105}`；`curriculum_source{title,url,document_sha256,table_one{path,count:2500,sha256,members_sha256},table_two{derived_from,count:1000},total:3500}`；`vector_data_inventory{official_baseline{package,version:"2.0.1",flat_manifest_url,standard_character_count:6854,members_sha256}, reviewed_project_supplement{manifest_path,manifest_sha256,character_count:440,members_sha256,audit_state:"TECHNICAL_AND_HUMAN_REVIEW_PASS_440",human_accepted_character_count:440,human_review_pending_character_count:0,evidence_index_path,evidence_index_sha256,license_review:"OUT_OF_SCOPE_PENDING_SEPARATE_REVIEW",hint_groups{path,sha256,character_count:440,maximum_groups_per_character:5,source}}, combined_standard_character_count:7294}`；`practice_availability{available:7294,unavailable:811,available_by_norm_level{一级:3500,二级:2976,三级:818},unavailable_by_norm_level{一级:0,二级:24,三级:787},unavailable_by_reason{no_hanzi_writer{count:811,characters:"…"},no_make_me_hanzi{0},stroke_mismatch{0}}}`；`invariants{…,difficulty_is_not_an_education_stage:true}`。

### 3.7 `generated/selected_8105_candidates.json`

`selected[7294]` 每项 26 字段：`character, pinyin, definition, frequency_rank, standard_order, norm_level, norm_level_index, norm_level_order, curriculum_table, stroke_count, groups, group_source("make_me_a_hanzi"6854|"vector_data_supplement"440), vector_data_review_status(null|"HUMAN_ACCEPTED"), decomposition(IDS), radical, score, context_word, context_index, context_pinyin, context_word_freq, context_word_tag, context_commonness, context_source, topic, difficulty, difficulty_band`；`skipped{no_hanzi_writer:[{character,norm_level,norm_level_index,norm_level_order,standard_order}]×811, …}`。

### 3.8 源数据格式（`sources/`）

- `level-1/2/3.txt`：每行一字（3500/3000/1605），sha256 钉在治理 JSON 与门禁。
- `curriculum-common-2500.txt`：课标字表一，文件与成员哈希双重钉死；README 明确"修改成员必须重新对照官方扫描件并显式更新审定哈希"。
- `make-me-a-hanzi-dict.txt`（2.57 MB JSONL）：`{character, definition?, pinyin[], decomposition(IDS), etymology?{type,hint,…}, radical, matches:[path|null per stroke]}`，LGPL-3.0。
- `hanzi_db.json`（2.10 MB JSONL）：`{frequency_rank, character, pinyin, definition, radical, radical_code, stroke_count, hsk_level, general_standard_num}`（字段均为字符串）。
- `jieba_dict.txt`（5.07 MB）：`词 频次 词性`。
- `opencc-st/ts-characters.txt`：字源用简繁映射。

### 3.9 版本/指纹与缓存契约

- `?v=<sha256 前 12 位>`：实测 `deck-data.js`→`3ac0637e30ec…`、`data/context-overrides.js`→`11516601699b…`、`core-strokes.js`→`13f7db4fa836…`，与 `index.html:1035-1036`、`sw.js:9,13-14` 一致。
- `index.html:11` `<meta name="shizi-asset-build" content="8105-3ac0637e30ec-icon-red-hand-20260928">` == `sw.js:11 BUILD`；`sw.js:12 VERSION = shizi-v13-${BUILD}` 即 Cache Storage 键。BUILD 约定形态 `8105-<deck 指纹>-<标签>-<日期>`。
- 门禁 `scripts/verify_pwa_upgrade.js:47-98`：meta==BUILD、SHELL 含同一 deckSrc、三处指纹与文件 sha256 前缀匹配；并回放 503 场景要求缓存副本 sha256 与生产字节相等（`:525-577`）。
- `sw.js` 策略：HTML 网络优先；`/deck-data.js`、`/core-strokes.js`、`/data/context-overrides.js` 网络优先、非 ok 回落同版本缓存（`:143-147`）；`data/*.json`（除 etymology）缓存优先+后台刷新（`:149-155`），运行时最多 800 项（`:18`），淘汰时**不淘汰核心 600**，受害者取 `cache.keys()` 前 N 个而非 LRU（`:27-35`）；安装时 `SHELL` 用 `cache.addAll` 原子写入，核心笔顺 40 个一批 `allSettled`（`:83-102`）。
- `DECK_KEY="shizi.deck.v8105.context2"`（`build_8105_chars.py:29` → patch 进 `index.html:1057`）是 localStorage 中 status 表的键；`migrateStableCardIdentity` 已把纯数字键丢弃（`index.html:2112`）。

## 4. 与第十稿（v10）决定的关系

| 决定/待定 | 数据层现状 | 保留 / 改动 / 移除 |
|---|---|---|
| D17 首练 5 字 | `core-strokes.js` 以 15 个"首日校准字"优先（`build_8105_chars.py:35`），对应旧 15 字校准流程 | **改动**：校准字清单与 600 核心字的组成需按新首练规则重定；`CORE_STROKE_COUNT` 可保留 |
| D18 / I04（10.13）看答案记"看过答案"；笔画数据取不到 → 无分步提示、完整楷体字形 | 全部 7294 字本地有笔顺；"取不到"只会是网络/缓存失败。现有 `allowNoStrokeData` 文案"仍可点「写好了」自行判断"（`index.html:2506, 2275`） | **改动**：文案/语义与 D18 冲突（不能再自判）；数据契约本身不变 |
| D25 / W04 提示画法：细暖墨红按笔顺画、每次约总笔画 1/4、至少 1 笔、"提示 · 还有 N 次"；"没有部件分组的字按前 1 / 前 2 笔（已定）" | 现有"点拨"按 `GROUPS` 一段一段揭示（1–5 段），无固定次数/比例 | **与 v10 决定冲突**：提示量口径不同。决定表明确"部件分组来源、覆盖、审核和缺组回退"待定，"演示 groups 不是全库资源"——生产 `GROUPS` 虽 100% 覆盖，但 6854 字是未审算法结果；是否作为 v10 部件提示的来源须产品/设计决定，不能由代码默认值裁决 |
| D16 / #105 重复目标字全遮、仅拼音题（954 张） | `ctx:"fallback"` 954 行 `ans="X字"`；113 行语境词含重复目标字；`common` 实为位数代理 | **保留数据**，题面处理归 UI；W24 把"同音歧义补释义、冷僻词换常用词、重复挖空"交给字库内容整理 → 会触发重生成或扩大 `context-overrides.js` |
| D21 查字/加自选合并；D23 写错过/快忘了 | 只读 SEED 字段（`py`、`ans`、`norm`）与 `base:<字>` 键 | **保留**；注意 `py` 是语境词读音（含变调），单字卡片显示拼音时需确认口径 |
| L10 换库列表"可以练 N 个字 · 有记录 M 个" | `LIBRARIES.officialTotal` 与 `test` 谓词已可算 N；M 需从记录算 | **保留**；交接备注第四节说原型写死 "3500/2976/818/2482"（2482 与数据 2500 不一致，应从数据算） |
| D15 无正式用户、历史兼容非硬约束 | 索引→稳定键迁移已完成（CHANGELOG 2026-08-08） | 允许在分片/重排时放弃旧索引兼容，但 `base:<字>` 键必须保持 |
| D13 字体/D08 视觉 | 与数据层无关 | — |

## 5. 风险与坑

1. **`common` 字段不是 zipf**：值域仅整数 {0,2,…,7}，与 `build_8105_chars.py:765` 的 `1+len(str(freq))` 无 wordfreq 分支吻合；override/fallback 行为 0。运行时 `dailyCharacterCandidates` 的 `common<1.5` 过滤（`index.html:1612`）、`qualityWeight`（`:1621`）、覆盖表 `boost→1.2` 都在这个粗粒度上工作；`calc_difficulty` 的 `context_penalty` 也受影响。重跑脚本若装了 wordfreq，`common`/`d`/`band` 会整体漂移并触发门禁。
2. **指纹同步全手工**：生成脚本只写 `deck-data.js`/`core-strokes.js`/DECK_KEY；`?v=`、`BUILD`、`<meta>` 要手改三处，`verify_pwa_upgrade.js` 会拦但不会修。`etymology.json` 在 SHELL 中无指纹，内容更新只随 VERSION 换代。
3. **门禁把成员与顺序钉死**：`verify_library_governance.py:25-27` 三个 order sha256、`:58-71` 用字符串前缀 `const SEED = ` / `const GROUPS=` 解析 `deck-data.js`；`verify_8105_app.js:33` 用正则 `const SEED = (\[.*\]);`（greedy，依赖 GROUPS 用 `{`），`:604` 断言页面全局 `SEED.length===7294 && Object.keys(GROUPS).length===7294`；`verify_pwa_upgrade.js` 校验缓存里 deck 的 sha256。任何分片/懒加载都要同步改这四处与 `build_8105_chars.py:patch_index`。
4. **分片可行性评估**（issue #125 方向，不重生成内容）：
   - SEED 顺序 = 字频序，运行时只在 `CARDS` 内部用索引（`BASE_BY_CHAR`、`allIndexes()`、批次数组），持久化一律用 `base:<字>`（memory/quality/status/fsrsLog/activity/session v3/backup 均经 `canonicalCardKey`）。**索引不是持久身份**，可以按库拆分后再合并，只要 `BASE_BY_CHAR` 在所有分片加载后重建；但 `rank` 排序仍须保留（`build_etymology.py`、每日一字、`rarest` 排序都读 `rank`）。
   - 三库交错（一级 0–6854、二级 1173–6965、三级 2024–7293），按 `norm` 拆成 3 份约 968/820/230 KB，表一 ⊂ 一级不必单独分片；GROUPS 104 KB 可随每片带或独立。
   - `hint` 字段 552 KB 对基础卡是死数据（仅 `cur.custom`/`ctx==="gloss"` 读），去掉或改为运行时拼接可减 26%，但这是格式变更而非内容变更，会改指纹与门禁常量。
   - 懒加载须与 `sw.js` 关键资源列表（`:143`）、SHELL、以及 `SEED is not defined` 类 503 回退（CHANGELOG 首条）一起设计；页面启动时 `migrateStableCardIdentity` 读 `BASE_BY_CHAR`（`index.html:1052-1053` 注释警告 TDZ），分片后需保证迁移在全部基础卡就位后运行。
5. **GROUPS 语义与审核**：只有段长度，没有"这是哪个部件"；6854 字来源为算法启发式（含 ≥5 笔再切、借部件、合并到 ≤5），无人审；440 字的审定分组绑定的 `sources/chaifen-0.4.0/*`、`tmp/vector-mve/build_candidate_hint_groups.py` 不在仓库，**不可复现**，只能靠 sha 校验现有 JSON。
6. **笔顺资源不可"顺手扩充"**：`read_hanzi_writer_available_chars :326-433` 要求 `data/` 中规范字集合 == 6854 基线 ∪ 440 补充（成员 sha 钉死），多一个 JSON 就报错；但 `fetch_char_data :785-808` 在文件缺失时会从 jsdelivr 下载并**写入 `data/`**——两者相斥，脚本在不完整 checkout 下会先下载再在门禁失败。
7. **CJK 判定不一致**：`index.html:2088 isCJK=/[一-鿿]/` 只认 U+4E00–9FFF，而 SEED 含 5 个 Ext-A/B 字（㧐 𠙶 𬇕 𬜯 㬎，均有 `data/*.json`）；自选/查字路径会拒绝这些字。
8. **`py` 含变调与词内读音**（一→yí、不→bú、的→dì），作为单字拼音展示会与"标准读音"预期不符；`selected_8105_candidates.json` 另有 `pinyin`（MMAH 首读音）可作替代来源但未进运行时。
9. **954 张 fallback 卡** `ans="X字"`（`ctx:"fallback"`，题面文案 `index.html:2498`）与 113 张重复目标字词：#105/D16 已说明"不能说全库语义已认证"；三级 818 字中 265 张 hint 为"字频#未收录"。
10. **配额**：7294 个笔顺 JSON 若全缓存 ≈ 23 MB；SW 限 800 项（核心 600 + 200 运行时），淘汰非 LRU。localStorage 侧 `shizi.deck.v8105.context2` 等键与备份共享 5 MB 级配额（`index.html` 的 QuotaExceeded 处理 `:1067`）。
11. **文档漂移**：`index.html:1039`、README 写"1.9MB"，实际 2.12 MB；`sw.js:7` 仍写"跨源 CDN 兜底字"，CDN 回落已删；交接备注写死 "2482" 与 `edu==="表一"` 2500 不符。
12. **许可**：Hanzi Writer Data / AnimCJK 补充为 Arphic 派生、MMAH 元数据 LGPL-3.0（`LEGAL_RELEASE_CHECKLIST.md:10-15`），治理 JSON 标 `license_review` 待另行评审；分发形态改变（分片/打包进 iOS）不改变义务但需重新登记。
13. **两层同名 `CONTEXT_OVERRIDES`**：构建期字典（`build_8105_chars.py:73-180`，产出 `ctx:"override"` 105 行）与运行期 `data/context-overrides.js`（105 字，含 gloss）互不知晓；运行期覆盖会把 `hint` 换成释义，`ctx` 变 `gloss`，与 `verify_8105_app.js:655` 的 fixture 校验绑定。

## 6. 未解问题

1. 本份 `deck-data.js` 生成时是否确实未安装 wordfreq（`common` 为位数代理）？若重装后重跑，`d/band` 漂移是否可接受、门禁常量是否重钉？需生成者确认。
2. v10 部件提示（D25/W04）到底以什么作"部件分组"来源：沿用生产 `GROUPS`（未审 6854）、只用 440 审定分组 + "前 1/前 2 笔"回退、还是重做 Chaifen 全库分组？决定表标为待定，本报告不能替代。
3. "约总笔画四分之一、至少 1 笔"与"提示 · 还有 N 次"的 N 如何由 `strokes`/`GROUPS` 推出（固定 3 次？ceil(strokes/段)?），交接备注只说"原型按已写笔数近似"。
4. 首练 5 字（D17）后，`CALIBRATION_CORE_CHARS` 15 字与 600 核心字清单是否还有产品含义，或改为"首练 5 字 + 高频"。
5. 单字详情/查字卡片显示的拼音应取 SEED `py`（语境读音）还是 MMAH `pinyin`（未进运行时），v10 未写明。
6. 440 字审定分组与补充笔顺的上游（Chaifen 0.4.0、tmp/vector-mve）不在仓库，是否有离线归档可复现；若无，任何分组格式升级只能在现有 JSON 上做转换。
7. `data/etymology.json` 是否要进 v10 单字详情（交接备注称原型"字源只有 静、亦 有原句"）；若要，其 1035 字覆盖是否够。
8. 分片/懒加载是否在 v10 范围内（#125 在仓库 docs 中未被引用，`grep '#125'` 无结果），还是留到性能阶段。
9. iOS WKWebView 打包时 `data/` 22.99 MB 是随包还是按需下载，`docs/handoff/engineering.md` 只说"原生 Build 会同步 Web 资源"。
10. `selected_8105_candidates.json` 中的 `decomposition`/`radical`/`context_word_tag` 是否有 v10 用途（如查字卡片部首），决定是否把它们带进运行时格式。
