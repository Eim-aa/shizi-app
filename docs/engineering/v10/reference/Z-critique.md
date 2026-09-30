# Z · 理解阶段完整性评审（14 份报告 A–O，缺 M）

> 评审对象：`docs/engineering/v10/reference/` 下 A、B、C、D、E、F、G、H、I、J、K、L、N、O 共 14 份（scratchpad 同名副本中 C/H/I/J/K/L/N 仅路径改写不同，内容一致；以 reference 版为准）。
> 核对基线：`main` 639f592 的 `index.html`（3102 行）、`sw.js`、`ios/ShiziApp/ShiziApp/*.swift`、`deck-data.js`、`data/`；决定依据 `docs/handoff/decisions.md`（下称“决定表”）、`docs/product/04-v10-handoff.md`（下称“交接”）、`docs/design/v10/交接备注-第十稿交接版.md`（下称“备注”）、`docs/product/foundation/03-需求范围与验收标准.md`（下称“需求全文”）、`docs/product/03-interaction-handoff-checklist.md`（下称“检查表”）。
> 本文只读未改任何仓库文件。所有“已核”的数字都用 node / grep 在当前工作区实测。

---

## 1. 覆盖缺口

### 1.1 index.html 的 23 个 `// ----` 段落

`grep -n "^\s*// ----" index.html` 得 23 段，逐段对照：

| 段（行） | 主报告 | 覆盖情况 |
|---|---|---|
| 词表→卡片 1038 | B、O | 完整 |
| 本地存储 1058 | A | 完整 |
| 练习提醒 1309 | F（B 管候选） | 完整 |
| 声音 1319 | F | 完整 |
| 触觉 1376 | F | 完整 |
| 里程碑 1442 | F | **只一行**：`milestoneDaysThrough` 的“继承跳档静默补记”（1442 注释）与 D24 的关系只有 K §4.3 抽查提到，无人核对它写哪些键 |
| 出题池与双层会话 1461 | B、D | 完整；但 1553–1618（`DAILY_MOTTOS`/今日一字）、1719–1800（`GRADE_UI`、视图切换、`recordQuality`）夹在这一大段里，E/B 各摘一部分，**没有人单独列出 `recordQuality` 四标记在 v10 的去留**（只有 A Q10、B §5.17 提问） |
| 印历与补帖 1911 / 月帖 1934 / 年报 1963 / 单字详情 1971 / 字盒 2006 | E | 完整；`#auditPanel` 题库质检（2078–2086）E 只标“开发工具可直接复用”，未读 |
| 自定义加字 2087 | B、E | 完整 |
| 画布 2159 / 比对 2284 / 教学 2382 | C | 完整 |
| 流程 2400 | D | 完整 |
| 三 tab 2792 / 加字面板 2863 / 字帖分享 2915 / 字卡 2923 | E | 完整；2853–2858 `?dev=1` 实验数据盒只 A 一句“应删除” |
| 备份 2986 | A、F | 完整 |
| 启动接线 3075–3097（段后无标题） | A（启动加载）、F（3080–3087） | **无人按顺序列启动序列**：`showSafetyUndo`→`checkStoragePressure`→`persist`→`syncReminder`/`queryReminderStatus`→`visibilitychange`→`fitBox`/`resize`/`online`/`matchMedia` 的先后与副作用只散落在 A §5.5、C §3.11、F §2.1。新架构的 boot 顺序没有旧行为清单可对照 |

### 1.2 目录与文件

对 `ls /` 、`docs`、`scripts`、`audit`、`assets` 的逐项结果：

| 对象 | 覆盖 | 说明 |
|---|---|---|
| `assets/branding/`（6 个 SVG + README）、`icon-*.png`、`scripts/generate_app_icons.{js,sh}`、`ios/.../Assets.xcassets`（dark/tinted 图标） | **无报告** | PR #174 刚合入（git log 639f592）。README 写明纸色 `#F4F0E7`、墨 `#2B2622`、暖墨红 `#A6533F`、深色 `#221E1A/#DCCFB8/#D47A5D`（`assets/branding/README.md`）——这正是第十稿令牌；图标还在 `sw.js:13` SHELL（`icon-512-maskable.png`）和 `sync-web-assets.sh` 白名单里。N §5.3-18 只提到 #175 分支会误删它们 |
| `audit/vector-data-381-accepted-source-replay.json.gz`、`audit/vector-data-381-source-replay.md`、`scripts/build_vector_source_replay_bundle.py` | **无报告** | `verify_vector_data_440.js:14,297–298,461` 读它做 381 条字节回放（另 59 条直绑）；G 只写“440 字证据链”，没点名这个 gz 必须随门禁保留、且在 CI 里被读取。数据门禁清单漏项 |
| `requirements.txt`、`CONTRIBUTING.md`、`docs/product/01/02`、`docs/handoff/{engineering,evidence,designer-delivery}.md` | 零散引用 | 无实质缺口 |
| `ios/ShiziApp/scripts/{archive-testflight,signing-preflight,run-device,verify-archive,verify-local}.sh`、`Config/Shared.xcconfig`、`DEVICE_QA.md` | F 只点名 sync/verify-bundle/smoke | **发布链（签名、归档、TestFlight）无人读**；v10 新增 `src/ vendor/ fonts/` 后 `verify-archive.sh` 是否也按白名单检查未知（A Q7 只提到它查 nativeSmoke 标记） |
| `docs/design/v10/第十稿-改动清单 / 文案修改清单 / 边开发边改清单` | **仅 M 报告**（scratchpad 有 `M-design-docs.md`，未复制进 reference/，README 表也无 M） | M 的内容已并入 `04-需求清单-第十稿.md`，但 reference/README 的“A–O”与 `00-README.md:32`“reference/ 13 份”都与实际 14 份不符（见 §2 第 20 条） |
| `docs/design/v10/extracted/` | H、I、J、K、L | dc-runtime、support.js、React UMD **未解包**（extracted/README.md 末行）；H §2.1 以 `78904995…js:行号` 引 dc-runtime，这些引用在仓库里不可复核 |
| `docs/product/foundation/03-需求范围与验收标准.md`、`03-interaction-handoff-checklist.md` | F 引 L81，A 引检查表 L29 | **没有报告核对这两份与 D17–D25 的冲突**，详见 §2 第 18、19 条 |

### 1.3 主题性缺口（跨报告无人负责）

1. **启动 / 生命周期**：见 1.1 末行。
2. **可访问性**：E §5.1/5.15、I、K 各列若干坑，但无统一清单（焦点迁移、`aria-current`、弹层焦点陷阱、读屏顺序、键盘）。交接 §五明确“正式版一律用按钮，读屏和键盘都要能用”。
3. **日期 / 时区 / 日界**：A §5.11、E §5.12、K Q9、J §5.1、L §5.11 各提一句，无结论；原型全用无年份 `'m-d'`，生产要带年份与时区——没有报告给出旧数据 `dayKey`（本地日）如何映射。
4. **性能基线**：O 测了 deck 解析 21 ms，C 提 15 笔后掉帧、E 提我的页每次重绘 1080×1440 大图，但无统一预算。
5. **`recordQuality`（太简单/太生僻/词不自然/不想练）去留**：v10 只保留“换掉这个词语”（文案 C046、H `wordOff[]`），`easy/rare` 影响旧出题算法——无人裁定映射（A Q10、B §5.17 只提问）。

---

## 2. 报告间矛盾（含裁定）

| # | 事实 | 报告说法 | 裁定与证据 |
|---|---|---|---|
| 1 | `shizi.custom.v1` 形状 | A/B/E：`string[]`（词）；G §3.1：`[{word…}]` | **`string[]`**。`index.html:2088` `bootLoad(CUSTOM_KEY,[])`，`:2109` `customWords.forEach(pushWordCards)`，`pushWordCards(s)` 对字符串 `Array.from(s)`（:2102）。G 错 |
| 2 | 持久键数 / 备份白名单 | A/E/F/N：22 键、白名单 21 键 | **一致且正确**。`:1059–1062` 声明 22 个 `*_KEY`；`:2988` `BACKUP_KEYS` 21 项（排除 `SAFETY_KEY`，另有仅 Swift DEBUG 写的 `shizi.nativeSmoke.v1`，注释 :2987） |
| 3 | JS→原生消息种数 | F §1.3“10 个消费型 type（+1 DEBUG）”；F §3.1 表列 11 个 | **11 个 + 1 个 DEBUG**。`WebViewController.swift:1547–1578` switch：shareBackup、sharePracticeCard、savePracticeCard、pickBackup、haptic、sound、soundscape、syncReminder、requestReminderPermission、queryReminderStatus、recognizeChars，外加 `nativeSmokeResult`。原生→JS 6 个全局函数 + 1 个事件（F 正确） |
| 4 | `shizi-asset-build` meta 行号 | F：`index.html:9`；O：`:11`；G §3.4 值写作 `8105-3ac0637e30ec` | **`:11`，值 `8105-3ac0637e30ec-icon-red-hand-20260928`**（与 `sw.js:11` BUILD 相同）。`:9` 是深色 `theme-color`。F 行号错，G 值截断 |
| 5 | `BACKUP_KEYS` 行号 | A/N：2988；F：2987 | **2988**（2987 是注释） |
| 6 | 写对才存墨的调用行 | A/C：1831；N：1830 | **1831** `if(!hard) persistRecentInk(m,handwriting,now)` |
| 7 | `markRoundComplete` 补记分支 | A：1287–1295 / 1289–1294；F：1289；B §2、§4：1299–1306 | **1289–1294**。1299 起是 `completedDayCount`/`medianPracticeTime`。B 行号错 |
| 8 | `storedCardKey` 位置 | A：L1189；B：≈1183 | **1189** |
| 9 | `currentAttemptKind` 取值 | B：`base|manual|reinforcement`；D §3.1：含 `repeat` | **B 正确**。`:1473` manualQueue 项 `kind==="base"?"base":"manual"`；`repeat` 只是 manualQueue 项的 kind（:2152），不会进 `currentAttemptKind` |
| 10 | 生产 `GROUPS` 覆盖 | C/G/O：7294/7294；D §5.17：“只覆盖演示字” | **全覆盖**。node 实测 `deck-data.js` SEED 7294、GROUPS 7294；`verify_8105_app.js:604` 也断言。决定表:53“演示 groups 不是全库资源”指原型 `proto-model` 的 `SAMPLES.groups`（L §2），不是生产 GROUPS。O 的保留意见成立：6854 字为算法生成、无人审（O §3.2） |
| 11 | `data/context-overrides.js` 条数 | O §1/§2：“105 字”；N：main 56 条；G：fixture 1 词/45 释义/10 boost | **56 键**（node：w 1、gloss 45、boost 14，其中 10 条纯 boost）。O 把构建期字典产出的 `ctx:"override"` 105 行（`build_8105_chars.py:73–180`）与运行期覆盖表混为一谈 |
| 12 | `data/` 文件数 | C §1：“7296 个文件”作为笔顺 JSON；F/O：7294 笔顺 + etymology.json + context-overrides.js | **7296 = 7294 + 2**（`ls data | wc -l`） |
| 13 | 第四库可练字数 | J/K/备注:89：2482；B/G/O/需求全文 §3.1：2500 | **数据是 2500**（SEED `edu==="表一"` 2500，`verify_pwa_upgrade.js:37–42`、`verify_library_governance.py`、需求全文 §3.1“3500／2976／818／2500”）。2482 是原型写死数（备注 §四已列为“仍写死”），实现从数据算 |
| 14 | “缺笔顺的字暂不进入练习”（`LIBRARIES[1].desc`，:1123） | B §2：代码里无按笔顺过滤 | **O 正确**：过滤发生在构建期，SEED 只含有笔顺 JSON 的 7294 字（二级不可练 24 字，`generated/library-governance.json` `unavailable_by_norm_level`）。描述属实 |
| 15 | 换库确认文案 | E §2.4：“…都会保留”；J §2.3.24：“…都不变” | **“都不变”**。文案清单 C099（第 124 行）“改成”列为“以后的新字从这个字库里来。<br>已有的记录、自选的字和写错过的字都不变。”；E 引的是“原文”列 |
| 16 | 月份图片叫法 | F §4.2：“月帖→月份图片”；E：“{M} 月字帖” | **“{月}字帖”**（文案零节“图片：这次的图片 / {月}字帖 / 手写字图片”，C140）。F 错 |
| 17 | 首页时段字 | 备注 §八.5（:134）：晨/午/暮/夜；E/K：早上/中午/傍晚/晚上 | **早上/中午/傍晚/晚上**（C005–C008；备注:56“两者冲突时以文案零节为准”）。时段边界 5–10/10–15/15–19/19–5 两处一致 |
| 18 | 需求全文与 D17–D25 | 无报告指出 | 需求全文仍写：R02“保留既有首次 15 字安排”、§3.1“首次既有 15 字安排保留”（↔D17）；R03“写对了，继续／写错了，继续”（↔D20 两键文案）；R04“‘不会写’通往帮助”（↔D18）；R06“更正入口保留到当前字提交”（↔D19）；R11“需要再练”（↔D23）；§4“手动主题开关…没有授权便不新增”（↔v10 设置“外观：跟随系统/浅色/深色”，J §2.3.17、文案零节“外观（原深色）”）。决定表:3 规定“当前用户明确决定优先于旧附件”，前五条按 D 项执行；**外观一条没有 D 项覆盖，需产品确认（见 §4 P-13）** |
| 19 | 检查表与 D18/D24 | 检查表头注只声明两条被覆盖 | 另有两条已失效未标：L21“提示→看答案→描写或自己再试→**判断**”（↔D18 看答案后不再判断）；L35“补记练习的字归实际书写日”（↔D24 去补记）。验收时不要照这两条测 |
| 20 | 报告份数 | reference/README 表 14 份（A–O 无 M）；`00-README.md:32`“reference/ 13 份” | **14 份**；M 的内容并入 `04-需求清单-第十稿.md`（其前言与 M 前言逐字相同）。建议 reference/README 注明 M 去向 |
| 21 | ShiziScreen 预设数 | J §1.1“30 个预设屏”；J §1.2“31 个（24+7）” | **31**。`ShiziScreen…dc.html:280` `MAIN` 24 项 + `OVER` 7 项。J 逻辑段行号整体偏小 5–12 行（如 `derive` 实为 :268、`UNDER` :282、`imgMonth` :332、`can=[]` :419），引用时以函数名为准 |
| 22 | D25 提示画法参数是否可在仓库核实 | C Q1：“原型源文件不在仓库，无法核实” | **可核实**：I §2 读 `extracted/ShiziWriteScreen…dc.html` 给出 `strokeWidth 18`（1024 单位）、墨迹 `.35`、提示 `.92`、淡出 `.25s`/恢复 `.2s`/260 ms 清空、逐笔时长公式、`prefers-reduced-motion` 静态画出（I L505–510、L395–397） |
| 23 | 原型防连点覆盖面 | H §4：“已实现一半（仅结果页 0.4s）” | **I 更完整**：写字组件自身有 0.4 s `arm()` 与 0.3 s `penArm()`（I L347–352、L522–525）；首页壳/字库墨墙屏未见。H 结论过窄 |
| 24 | `wCorrect`（写字页内改判）是否还有入口 | H Q1 待查 | **有**：结果行未收起时“· 修改 ›”打开修改判断弹层（I L614、L634–640）；落笔后才只剩结果页格子（D19） |
| 25 | 旧照片 `shizi.wild.v1` 去留 | E §4.3：“OCR/拍字链整体移除，WILD_KEY 下线或留兼容读”；F §4.3：删采集/OCR，保留只读查看；`03-待产品决定` P10：“只读查看页不做” | **按文档应保留只读查看**：备注:104“旧照片记录…默认不算，只在单字详情里查看”；需求全文 §4“保留真实照片查看能力”、R11“保留照片查看”；J §2.3.15 `photo` 预设在第十稿里。删的是采集与 OCR。P10 的默认值与三份文档都不符（见 §4 P-12） |
| 26 | 练字背景音 | F §4.3/Q1：仓库无 #166 记录，V03 与 IA 树保留；`03-待产品决定` P07 默认按 #166 删除 | **仓库证据倾向保留**：第十稿设置页仍有“练字背景音 关/雨声/炉火”与“背景音只在写字的时候响。”（J §2.3.17），边改 V03（:66）要求“占满一行”，需求全文 R11 列“背景音”。#166 不在仓库；删除需产品负责人写进决定表 |
| 27 | 备份是否含进行中会话 | A §5.4：CHANGELOG 与现状矛盾 | **代码现状：含**（`:2988` 含 `SESSION_KEY`）。`CHANGELOG.md` 2026-07-12 条写“不再导出进行中的练习会话…恢复旧备份时也会忽略并清理会话快照”，已过时。v10 去留见 §4 P-11 |
| 28 | 生产代码的“跳过” | 备注 §一（:64）：“生产代码的 skip 改为只在当前会话里排除”；A/B：全文件无 skip | **生产代码没有跳过功能**：`grep -c skip index.html`=4，全是 `skipConfirm/skipSafety`；无“跳过”字样。备注前提不成立，“跳过”是 v10 新增能力，其排除范围仍待定（决定表:55） |
| 29 | 快忘了、首次 5 字 | K/L：`QUEUES.first='部主性体次'`、快忘了 90 天/12；`03-待产品决定` P09 默认 `尴嚏狩晤飓` | 两者都不是决定：D17 只定数量。P09 取的是旧校准组前 5 字（`core-strokes.js` 前 15 字 `尴嚏狩晤飓痿俾跻徵瞰裘娩邃暧煲`，按目标难度 48→98 递增，B §2），“熟悉但易卡”的描述对 狩晤飓 不准确 |
| 30 | SAMPLES 规模 | K：30+7；L：37（PYX 实 279 取 270）；H：“SAMPLES+PYX 共 300” | **L 实测为准**：SAMPLES 37、PYX 279、300 字演示 = 30 基础 + `extra300` 270（L §2、§3.2） |

---

## 3. 代码与决定冲突汇总（去重）

按决定归并；“位置”为 `index.html` 行号（另注除外），“报告”列出提出者。

### 3.1 D17–D25

| 决定 | 现有代码冲突点（去重） | 报告 |
|---|---|---|
| **D17** 首练 5 字、无介绍页/首题说明卡、进度“3 / 5” | 首启页 `#welcome` 661–674 与“先练 15 个字”(667)；`needsCalibration` 1843 → `calibrate` 模式 1968；15 字校准组 1705–1712、`BATCH=15` 1462；教学气泡/`teachStage` 2382–2398、703；校准结果卡 778、2727–2733；进度“已练 n / 15 个 · 另有 k 个字要再练” 2403；首页“今天拾十五个字” 678/1880；`core-strokes.js` 以 15 校准字打头（O）；漏斗 `welcome_shown/calib_*`；`verify_8105_app.js:324,1173–1271` | B C D E F G O |
| **D18** 看答案＝看过答案、不判断 | “不会写”`declareDontKnow`→`recordOutcome("miss",{teaching:true})` 2606–2609（FSRS Again、misses+1、status indeck、进再练队列）；描后 `postTraceRecall` 再进判断 2650–2655；**隐藏完整答案**：双指/长按/`#peekInk` 瞥一眼 2227–2237、2545–2557 不留记录（亦违交接 §五“完整答案不依赖隐藏手势”）；无笔顺时仍允许“写好了”自判、“不会写”记 miss 2503/2275；`OUTCOME_STORY` 无“看过答案” 1973；无分组时一次给全部笔画仍叫提示（D04）2506 | A B C D E G O |
| **D19** 结果行只在未落笔时显示；修改入口在结果页格子 | 5 秒撤销条 2450–2454、1.8 s“重盖”窗 2622–2625；`reopenStampChoices` 只能改最后一印；结果页格子只开单字详情 2780；FSRS 事件不存复习前卡状态，无法事后更正任意字 1224–1235 | A B D G |
| **D20** 两键左错右对等醒目；末字直进结果页 | 写对在左且主按钮 750–753；第三键“不太确定” 754/2661；软确认 2654–2657；（兼 D03）`.suggest` 预选与 `askLine` 2587–2594、失败笔画描红 2419；盖章 1.8 s 停留 + toast 2625–2645；`roundIsComplete` 要求再练队列清空 1480 | B C D G |
| **D21** 查字/加自选/首页选字合一；明确点“加入”；可移除可撤销 | `addWord`→`recordRealWorldMiss` 伪造 miss、dueDay=今天、status indeck、`queuedFront` 2122–2136（兼违 D03“无本人书写不制造有效判断”、D23）；拍字 `collectWildCharacter` 同路 2137–2140；`insertIntoCurrentBatch` 练习中插队 2142–2155；无移除函数；收字面板与查字框分离 959–970/2035–2041 | A B E G |
| **D22** 结束这组：先确认；已判断保留、没写的不算记录；零判断轻提示 | 无“结束这组”；20 次/6 分钟节奏弹层 `roundBudget*` 978–983、2666–2676，`deferRoundToTomorrow` 把未写字写进 memory（`pendingLearning/queuedFront`）2675 | B D G |
| **D23** 写错过＝最近一次有效判断；快忘了写一遍离开；跳过/看答案不算 | “写得不稳”= 任意历史 `misses>0` 2043–2066、1904–1907；`isHighRisk` 1715；“需要再练” `OUTCOME_STORY.hinted` 1973、`GRADE_UI` 1721；看答案混入 `lastOutcome="miss"`；提醒候选 `lastOutcome==="miss"` 优先 1384–1391 | A B E F G |
| **D24** 去补记；撤销在备份页常驻、离开失效留结论句；状态句只按记录与上次导出 | 补记全套 1289–1294、1522–1523、1926–1933（且 `newScore` 未定义，1930 必抛 ReferenceError）、`#makeupSheet` 986–990、印历 `.makeable/补` 章；安全副本撤销条 10 s 自隐（`setTimeout(hideSafetyUndo,10000)` :3011）、`offeredAt` 只弹一次、reload 后弹于首页；`captureSafetySnapshot` 无 try/catch 3006（保护副本失败被归因为“无法恢复这份备份”）；紧迫提醒用含继承天数的 `totalPracticeDays`/`completedDayCount` 2989–2995 | A B E F G |
| **D25** 方案①：墨迹淡到约 35%，细暖墨红按笔顺画，下一笔淡出 | “点拨”按 `GROUPS` 部件逐组播放 2557–2573；墨迹只在播放中 .22、播完立即 1；提示层留到重写/换卡；颜色 `#d08b78`（非令牌 `#A6533F/#D47A5D`）；无次数/四分之一规则；提示笔画并入比对几何 2426–2431；提示 toast“本组稍后还会再写” 2570 | C D G O |

### 3.2 D01–D16 中被报告提到的冲突（去重，简表）

| 决定 | 冲突 | 报告 |
|---|---|---|
| D01 不以断签/闯关推动 | 里程碑庆祝 1443–1459；备份红“!”催导出；`inheritedStreak` | A E F K |
| D02 首页唯一主入口、无快捷入口 | “今日一字” 1884–1893；首页“收字”684；50 块今日字 | E K |
| D03 不预选、不叠字评分 | `.suggest`、`askLine`、软确认、失败笔画描红（见 D20 行） | C D |
| D05 A/B 会话隔离 | 单一 `SESSION_KEY`；`startFocus` 无条件清快照 1970；单字 focus 组不落盘 1502；提醒点开插进当前组 1395–1397 | B D F |
| D07 保存成功才推进 | `recordOutcome` 不看 `saveMemory/saveFSRSLog/saveActivity` 返回值 1841/1233；`pickStamp` 无论成败推进；多键非原子；`saveMemory`/`saveWildState` 降级重试先报失败 | A B D F |
| D11 / M02 | 月帖取 `recentInk`（最后一次写对）1947，缺墨印楷体 | E N |
| D12 N≤8 / 超 80 pending | 首页最多 50 块；月帖 `slice(0,80)` 截字 1947–1951 | E N |
| D13 字体 | 画布写死系统宋/楷；只有 4.2 KiB 品牌子集 | E N |
| D14 不以旧 96 份/420 KiB 当新政策 | `RECENT_INK_MAX=96, BUDGET=420 KiB` 1144；写错墨迹不落盘 1831 | A C E G N |

### 3.3 原型自身与 D 项的残留冲突（接入时不能照抄）

- `hint-mode='box'`（方案②）与面板开关：违 D25（H §4、I §4）。
- ShiziWriteScreen `done` 中间页“这一组写完了 / 查看这次练习”：违 D20（I §4）。
- ShiziScreen `onboard` 介绍页预设：违 D17（H、J）；日历 `canBack/back` 补记视觉字段：违 D24（J）。
- 模板 `addStart/addTile:/addSheet` 与旧 `pick` 弹层：违 D21（H、K）。
- 首页 `hState='first'` 按记录数判定（清空后又说“第一次来”，K06）：与 D17“首练”语义错位（K §5.5）。

---

## 4. 需产品负责人决定

排序按阻塞面。每项标出提出报告与文档依据；“规划默认”指 `03-待产品决定.md` 的过渡值，供对照。

| # | 事项 | 为何只能产品定（依据） | 报告 | 规划默认 / 评注 |
|---|---|---|---|---|
| P-1 | **逐判断墨迹存储是否立项、保留/淘汰政策** | 决定表 D14:22“新逐判断笔迹存储另案暂停，待保留策略和真人容量；**不借‘没有正式用户’启动它**”；待定表:59“工程提供真人容量证据，产品决定”。K28/L05“那次笔迹小图”、10.12、M02、A05、单字详情历次格子、`resolveGlyphs` 的 `coverage:'complete'` 全依赖它 | A C E G N | P05 默认 `inkBudgetBytes=600KiB`，`01-架构设计.md:13,145,263` 按“D14 只禁止补造历史”设计了 `ink[recordId]` 表——**这是对 D14 的误读，等于用代码默认值启动暂停方案**，须先得产品授权或改成“只存会话内/最近一次”的降级方案 |
| P-2 | **月字帖取墨：本月第一次（M02）还是月内最后判断（D11）** | 交接:50 vs 决定表:19，两份权威文档相反 | E F J N（M） | P02 默认 `first`；需回写 D11 |
| P-3 | **本次/月图缺墨：用浅参考（D11）还是不画进图（10.12）** | 决定表:19“末次缺墨用浅参考”、需求全文 §3.1“月/次可用浅色参考” vs 改动清单:27“本次 / 本月图片只画有笔迹的字，落款字数随之减少”、J `imgData` 过滤 `ink==='none'` 并提示“不在图里” | E（列为两条需求未指出互斥）、J | **无报告点破，规划未登记**；`01-架构设计.md:272` 取“缺墨用浅参考”，与冻结设计相反 |
| P-4 | 跳过的正式排除范围与再次出现时间 | 决定表:55（#162/#170）、需求全文 O02；备注:64 的“改生产 skip”前提不成立（§2 第 28 条） | A B D I | P06 默认会话内排除 |
| P-5 | 调度映射：带提示写对评 Good 还是 Again；看过答案/跳过是否改 due；第二次起每组几字；每日到期上限 30 是否保留；“刚写过的字当天不再出”是否成立 | 决定表:61“提醒/调度映射 产品＋工程，对照 O03–O08”；需求全文 O06；M §5.2-5 指出“当天不再出”不在决定表 | B D | P03 默认 5 字/30 上限；P04 快忘了 A |
| P-6 | 快忘了正式口径（记忆曲线阈值、最多 12、墨色四档 7/30/90 天） | D23 只定进出；备注:92、103 标“原型模拟”；决定表:72“未决项不能被代码默认值悄悄裁决” | B H K L | P04 |
| P-7 | 首练 5 字具体是哪 5 个；清空全部记录后是否重回首练、首页用哪句（K06） | D17 只定数量；边改 K06；K §5.5 | K L | P09 默认取旧校准前 5 字（见 §2 第 29 条的保留意见） |
| P-8 | 练字背景音是否删除（#166） | 仓库无 #166；V03、R11、原型设置页保留（§2 第 26 条） | F | P07 默认删除，**与冻结设计相反**，须产品写入决定表 |
| P-9 | 旧照片记录只读查看是否进 v1 | 备注:104 默认“只在单字详情里查看”、需求全文 §4/R11 保留（§2 第 25 条） | E F J | P10 默认“不做”，与三份文档相反 |
| P-10 | 里程碑庆祝删除 | 第十稿无此物；D01 精神反对但无明文 | F | P08 删除（合理，但需登记） |
| P-11 | 备份范围与撤销寿命：会话是否进备份；替换/清空是否清掉进行中的 A/B；恢复后“上次备份”显示备份日还是本机导出日；保护副本离开备份页后是否删除 | 决定表:61“备份范围/撤销寿命 产品＋工程”、需求全文 O04 | A H L | 规划未单列 |
| P-12 | 外观“浅色/深色/跟随系统”手动开关 | 需求全文 §4“手动主题开关…没有授权便不新增” vs 第十稿设置页与文案零节“外观（原深色）”（§2 第 18 条） | （无报告，本评审发现） | 规划 02 已排实现；需产品确认冻结设计即授权，并回写 |
| P-13 | 通知点开进哪种会话（A 插队 / 新 B / 单字） | D05 隔离规则未覆盖；F Q4 | B F | 未登记 |
| P-14 | 提醒时间：用户选（M05）还是沿旧中位数 | 需求全文 O06 | F | P18 用户选 |
| P-15 | K28“卡片预览”是否含查字卡片“你的书写” | 交接:42 措辞不清；原型画真实写错笔迹 | K | P19 沿原型 |
| P-16 | 有未完成组时首页是否仍显示“今天记录了 N 个字”；紧凑版墨迹行只 4 个是否算 D12 | D12 只定 N≤8/N>8 | K | P16 隐藏 |
| P-17 | 超 80 字取字与落款；边改 M06“挑字”、L13“选用哪一次笔迹”是否允许（触碰 D11） | 决定表:54；M §5.2-2 | E N（M） | P25 pending |
| P-18 | “这次选的字”结束结果页标题“先写到这里 / 结束了”、结果词是否加「」、“这次没写/这次没有书写” | 文案清单与改动清单层叠冲突（M §5.1） | J（M） | P14/P15 已给默认，按 C066/零节 |
| P-19 | 关于页三子页内容、“给我们写信”方式与地址、隐私文案 | 备注 §十.7，原型未做 | E J | P21 |
| P-20 | 许可门：hanzi-writer-data（Arphic）随 App 分发、根 LICENSE、440 补充笔顺 BLOCKED | 备注 §八.4、`LEGAL_RELEASE_CHECKLIST.md:8–19` | N O | 发布前外部条件 |
| P-21 | 部件分组在提示中的角色（设计＋工程，产品验收） | 决定表:53；备注 §一“没有部件分组的字按前 1/前 2 笔（已定）”与原型从不读 `groups`（I §2）并存：生产 GROUPS 全覆盖时“无分组回退”永不触发 | I O | P29 默认不用分组；建议连同“提示上限 2 次”（P17）一起请设计确认 |

---

## 5. 架构师可自决

以下有文档依据或属实现细节，不改产品可见规则；自决后在 ADR / 01 架构设计中写明依据即可。

| # | 事项 | 依据 | 报告 |
|---|---|---|---|
| A-1 | 持久层仍用 localStorage 还是 IndexedDB、键命名空间 `shizi.v2.*`、单一事务写入与逐键核对 | D07、D15；ADR 0002 §4。约束：iOS `importBackup` 钉死 `{app:"shizi",data:{"shizi.*": JSON 字串}}`（Swift :1361–1379），换 IndexedDB 必须同步改 Swift | A F |
| A-2 | 模块扩展名 `.js`（免改 MIME）或 `.mjs`（须补 `LocalWebSchemeHandler` MIME，:105–122，且有 `nosniff`）；`sync-web-assets.sh` 改清单驱动；`verify-bundle-assets.sh`/`verify-archive.sh` 同步扩展 | F §5.1–5.3；ADR 0002 §6 | F |
| A-3 | 跳过、确认看答案、看过答案后“下一个”也等保存成功再推进 | D07 泛指“保存成功才推进”，更严格不违背任何决定（I Q1） | D I |
| A-4 | D19 更正实现：每次判断存“判断前 FSRS 卡 + memory 差量”，更正只改 `judgment`、不改 `at/sequence/localDay`；更正范围限本次结果页的字 | D06/D19；D Q2、B Q9、N Q3 | B D N |
| A-5 | 防连点用事件 `timeStamp`；0.4 s/0.3 s 覆盖所有新页面/新状态（原型只在写字组件与结果页） | 备注 §十.3 | C D I |
| A-6 | 会话快照存归一化坐标；删 `compositeImage`（≤2 MiB PNG）与 `checkInk` 运行时比对 | W10 只要几何；D03 | A C D |
| A-7 | 提示层自绘（medians→细线），删瞥一眼、第二/三个 HanziWriter 实例；“看答案”完整字与描一遍可继续用 hanzi-writer 或自绘 | D25、D18、交接 §五 | C D |
| A-8 | 提示起点按“已写笔数”（W04 做不到时的已定退路）；`checkExact` 改造为评估器留作后续增强 | 交接 §四“工程评估” | C D I |
| A-9 | D6/D7/D10 三块的去留 | 交接 §四、备注 §十.9 明确“工程确认，做不到就删” | H J |
| A-10 | 字库字数、首页日期、落款等一律从数据算（2500 而非 2482） | 备注 §十.1 | B J K O |
| A-11 | 题记按“日期序号 mod 3”轮换三条原型题记 | 备注 §八.6（:135）；K 已列三条原文 | E K |
| A-12 | 单字图 3:4 与 1:1 两种比例都做；3:4 字帖顶对齐（改 #180 `layout.mjs:11` 并更新 r1 夹具） | 备注 §九.4–5 | E N |
| A-13 | 记录日期带年份与时区（ISO 或 epoch day），日界取本地 0 点；旧 `dayKey` 按本地日导入 | 原型无年份属原型限制（J、K、L） | A E J K L |
| A-14 | 旧数据一次性导入（FSRS 状态、判断事件、最近墨迹、自选、设置），旧键保留不删 | D15“允许必要调整但关联必须正确、保留已完成成果” | A B |
| A-15 | 删除：校准、补记（含已坏的 `newScore` 路径）、再练队列、节奏预算、软确认/第三键/预选、瞥一眼、四枚印章、拍字采集与 OCR 桥（及 `NSCameraUsageDescription`、相机 `<input>` 须同删）、灶台模式与吉祥物行（第十稿无对应）、`?dev=1` 实验数据盒 | 均有 D 项或冻结设计缺席为据 | A–G |
| A-16 | `quality` 四标记：保留 `badWord/hide` 映射“换掉这个词语”（C046），`easy/rare` 随旧出题算法删除 | v10 无对应控件；出题改按记忆曲线（备注 §十.5） | A B |
| A-17 | 测试重组：先把 `verify_8105_app.js:90–158、185–248、2394–2723` 的数据/资产门禁抽成独立脚本，再重写 UI e2e；`verify_ui_copy.py` 改为读第十稿文案清单；把 `audit/vector-data-381-*` 列入必保数据门禁 | G §5.1–5.2；本评审 §1.2 | G |
| A-18 | SW 升 `shizi-v14-*`，指纹与 SHELL 由脚本生成；决定 `verify_pwa_upgrade.js` 回放基线改为 v13 | ADR 0002 §5；G Q5 | F G O |
| A-19 | 原生 DEBUG smoke：先移除或改为调用公开测试钩子 | F Q10、G §5.11 | F G |
| A-20 | 返回手势实现层（单 WebView 内跟手动画 vs 原生多页） | 交接 §五只规定“iOS 原生方式”，实现层属架构 | E F |
| A-21 | 单字拼音取 SEED `py`（与题面一致），并在已知变调字上加校验 | O §5.8；P20 | O |
| A-22 | `isCJK` 扩到 Ext-A/B（SEED 含 㧐 𠙶 𬇕 𬜯 㬎） | O §5.7 | O |
| A-23 | `core-strokes.js` 600 核心字按新首练与字频重算 | O Q4 | O |
| A-24 | 看过答案在结果页格子上不提供“改为写对/写错” | K25；J `csNote` A 分支“看过答案的字不判断对错，没算在内”、无翻转按钮 | I J |
| A-25 | 移植 #175 内容修订（按 N §5.3-24 的逐 hunk 步骤），把卡片展开抽成纯模块供 `content-corpus.cjs` import | D16；N、G | G N |

---

## 6. 建议补读

1. **`docs/product/foundation/03-需求范围与验收标准.md` 全文与 `03-interaction-handoff-checklist.md`**：逐条标注被 D17–D25 覆盖的条款（§2 第 18、19 条），并把“外观手动开关”送产品确认。
2. **`docs/design/v10/第十稿-改动清单` 10.12 段（:27、:44）与 `extracted/ShiziScreen…dc.html` 的 `imgData`（约 :320–330）**：确认“缺墨不入图”的完整规则，送 P-3。
3. **`assets/branding/README.md` + `scripts/generate_app_icons.*` + `ios/.../Assets.xcassets`**：图标令牌与第十稿令牌是否同源、v10 壳清单是否要带 maskable/dark/tinted 图标。
4. **`audit/vector-data-381-source-replay.md` 与 `scripts/build_vector_source_replay_bundle.py`**：把 381 条字节回放写进数据门禁清单（G 漏）。
5. **`ios/ShiziApp/scripts/{verify-archive,archive-testflight,signing-preflight,verify-local}.sh`**：新目录与字体进包后的归档校验、`PrivacyInfo` 与相机用途串删除的发布影响。
6. **`index.html:3075–3097` 启动接线、`:1442–1459` 里程碑写键、`:1791–1800` `recordQuality`、`:2078–2086` 题库质检**：补一张“旧启动序列与副作用”表，供新 boot 对照。
7. **scratchpad `M-design-docs.md` §5.1–5.3、§6.2**：其中 17 条清单间冲突与 15 条“文档判断不了”已部分进入 `04-需求清单`，但 reference/README 未收录 M，建议补一行说明或把 M 放入 reference/。
8. **（复核用）`docs/engineering/v10/01-架构设计.md:13,145,263,272,300` 与 `03-待产品决定.md` P05/P07/P09/P10**：它们分别与 D14 原文、10.12、V03/R11、备注:104 不一致（§4 P-1、P-3、P-8、P-9），建议在进入评审前修正或显式标为“需产品授权”。
