# B · 出题池 / 双层学习会话 / FSRS / 再练队列 / 校准 / 字库 / 自定义字

> 范围：`/Users/orange/Documents/ChatGPT/astraworld/shizi-app/index.html` 的「出题池与双层学习会话」段（1461–1911）、「自定义加字」段（2087–2159）、CARDS 构建（1038–1057）、FSRS 封装（1196–1237）、字库（1121–1134）、以及这些段落被调用的入口（startRound 2686、recordOutcome 1812、reveal/judge 2596–2662、add sheet 2887–2900）。只读不改。所有行号均指 index.html，除非另注。
> 对照依据：`docs/handoff/decisions.md`（D01–D25）与 `docs/product/04-v10-handoff.md`，另参考 `docs/design/v10/交接备注-第十稿交接版.md` 第 64、92、103、160–170 行。

## 1. 概览

1. 题库来自 `deck-data.js` 的 `SEED`（7294 行）——我用 node 实测：7294 行全部带整数 `ci`，生成 7294 张 `CARDS`，且 7294 个 target 字互不重复，因此「一张卡 = 一个字」，`base:<字>` 键与 CARDS 下标一一对应（1048–1056）。四库按 `norm`/`edu` 字段划分：一级 3500 / 二级 2976 / 三级 818 / 义教表一 2500（1121–1126）。
2. 调度是**两层**：跨天层用 ts-fsrs 5.2.0（FSRS-6，`fsrs6.min.js`）只打 Again/Good 两档，写进 `memory[key].fsrsCard` 与事件日志 `shizi.fsrsReviewLog.v1`（1203–1235）；组内层是 15 字一组的 `baseTargets` + `manualQueue`（手动插字）+ `reinforcementQueue`（没写稳的字隔 2 题再练）+ `unresolved`/`episodes`（1462–1480）。
3. 每天到期复习上限 30 字（`DAILY_REVIEW_BUDGET`），用 `activity.daily[今天].reviewTargetKeys` 记账（1637–1642，2691）；组的构成由主题/难度带/个人难度分数（`chooseBatch`/`chooseTopic`/`adaptNextCard`，1655–1703）决定，首次用户先走 15 字「校准组」（`尴`、`嚏` 打头，1705–1712），组末算出 `tuning.offset`/`preference` 并可能换默认字库（1739–1749）。
4. 事件到评分的映射：用户自判「写对」且没用提示 → `fast` → Good；用了提示写对 / 「不太确定」→ `hinted` → Again；自判写错 → `slow` → Again；点「不会写」→ `miss` → Again 并进入描红教学（1812–1841，2606–2609，2650–2659）。**不存在「跳过」**（全文件 grep `skip` 只有备份的 `skipConfirm/skipSafety`），也不存在不计分的「看答案」。
5. 「自定义加字」把不在题库的字追加成 `custom:` 卡（2105–2109），但**任何**加字（含库内字）都会立刻伪造一次 miss 记录并置 `queuedFront`，下一组优先出（2122–2136，2156–2157，2690）。
6. 会话快照 `shizi.session.v1`（version 3）以 cardKey 编码全部队列与视觉状态，解码失败整份隔离到 `shizi.corrupt.*`（1484–1538）。只有一份快照：开「专练」会清掉进行中的普通组（1969–1970）。
7. 与第十稿的关系：可保留的是 FSRS 封装、到期选字、字库成员判定、卡片身份与快照编码骨架；组构成/难度自适应/校准/再练队列/补记/节奏预算/伪造 miss 的加字，全部被 D17–D25 替换或直接冲突。

## 2. 组件/模块清单

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
|---|---|---|---|---|---|---|
| SEED→CARDS 构建 | 1038–1051 | 每行 SEED 生成一张卡；`applyContextOverride` 用 `data/context-overrides.js` 改语境词/释义/`common` 权重 | 全局 `CARDS[]`；卡字段 `word, chars, ci, target, py, hint, rank, strokes, parts, topic, d, band, edu, common, norm, std, ctx` | `deck-data.js` `SEED`、`CONTEXT_OVERRIDES` | 可直接复用 | 无 `ci` 的行会拆成每字一卡（1051），实测目前没有这类行 |
| 基础卡索引 | 1055–1056 | `BASE_N`、`BASE_BY_CHAR[字]=首个下标` | 供 `cardKey/canonicalCardKey/indexForCardKey` 用 | CARDS | 可直接复用 | 注释说明必须先于自定义段建好，避免 TDZ（1053–1054） |
| 卡片身份 | 1541 `cardKey`，1542 `cardTargetFromKey`，1543 `canonicalCardKey`，≈1183 `storedCardKey`，1392–1394 `indexForCardKey`，1935 `cardIndexForStoredKey` | 稳定键 `base:<字>` / `custom:<字>`；旧键 `custom:<n>:<字>` 归一；存储键白名单（≤80 字符、无控制/HTML 字符、前缀 base/custom/legacy） | 所有存储层按键寻址 | BASE_BY_CHAR、customIndexOf | 可直接复用 | `cardIndexForStoredKey` 是 O(n) 线扫（1935），月报/年报里循环调用 |
| 身份迁移 | 1200 `migrateCustomKeyedRows`，2110–2117 `migrateStableCardIdentity`，1214–1221 `normalizeLegacySchedule`/`migrateFirstSeenAt` | 每次启动把 memory/quality/status/fsrs 日志/activity 的键归一并**无条件保存 5 个键**（2117、1221） | — | memory、quality、status、fsrsReviewLog、activity | 可抽取改造 | 启动写放大；D15 允许必要数据调整，可在 v10 换成一次性迁移+版本号 |
| 存储键与形状表 | 1059–1062 常量；≈1087–1111 `STORED_SHAPE`；1071–1080 `load/save/bootLoad/bootNormalize` | 单份形状定义同时用于启动隔离与备份导入拒绝 | `save()` 返回 bool，失败弹 storageNotice（1072、1066） | localStorage | 可直接复用 | 调度相关键：DECK/MEMORY/QUALITY/PREF/TUNING/SESSION/FSRS_LOG/TOPIC/CUSTOM/ADDED/LIB |
| FSRS 配置与引擎 | 1203 `FSRS_CONFIG`，1204 `fsrsEngine` | `generatorParameters({request_retention:0.90, maximum_interval:365, enable_fuzz:true, enable_short_term:true, learning_steps:[], relearning_steps:[]})` | `FSRS.fsrs / generatorParameters / createEmptyCard / Rating` | `fsrs6.min.js`（UMD 全局 `FSRS`，版本串含 5.2.0；测试断言 `FSRSVersion` 含 FSRS-6.0、21 个权重，scripts/verify_8105_app.js:592–606） | 可直接复用 | `parameterVersion:"fsrs6-fuzz-365-v2"`；时区 `Intl…timeZone` 记进每条事件 |
| FSRS 卡序列化 | 1211–1213 | `due/last_review` ↔ ISO 字符串；缺失时 `createEmptyCard(now)` | `serializeFSRSCard / deserializeFSRSCard` | window.FSRS | 可直接复用 | — |
| `applyFSRSReview` | 1224–1235 | 幂等（eventId=`${attemptId}:fsrs`，1222–1225）；`fsrsEngine.next(prev, now, Again\|Good)`；Good 且 `graduate` → `dueDay=max(明天, plannedDue)`、`pendingLearning=false`；否则 `pendingLearning=true, dueDay=null, due=0`；追加事件到日志并保存 memory+日志 | 返回 event；被 `recordOutcome`（1827）调用 | cardMemory、dayKey/shiftDay、saveFSRSLog、saveMemory | 可抽取改造 | 忽略 `result.log`，自建事件；Again 时**抛弃 FSRS 自己算的 due**，进入「pendingLearning 悬置」——见 §5 |
| FSRS 事件日志 | 1196–1199 归一；1205–1210 压缩与保存；1114、1201–1202 启动装载 | 保存 `{version:2, events[], monthly{}}`；120 天前的事件折叠进月聚合（`FSRS_RAW_RETENTION_DAYS=120`） | `saveFSRSLog()`、`reviewEventById()`（1223，线扫） | — | 可抽取改造 | 折叠后单卡历史不可回放；D14「历史缺 t/p 如实报告」相关 |
| 记忆行 `memory` | 1630 `cardMemory`，1631 `hasMemory`，1170 前后 `saveMemory`（含 recentInk 裁剪 1144–1172） | 每字一行的启发式计数 + FSRS 卡 + 最近墨迹 | 键 `shizi.memory.v1` | — | 可抽取改造 | 字段见 §3；`ease/streak/fast/slow/hints/misses` 是与 FSRS 并行的旧启发式层 |
| 到期判定 | 1632 `isDue`，1633 `reviewDue`，1634 `reviewReady`，1635 `baseAvailable`，1636 `reviewPool`，1679 `overdueDays` | 未见过→`isDue` 真；`pendingLearning`→假；`dueDay<=今天`→到期；`indeck` 状态走 `isDue`，其它走 `reviewDue` | `reviewPool(respectSession)` | memory、status、sessionDone、quality | 可直接复用（去掉 status 分支） | `status==="known"` 从未被写入（全文件仅 1635 读取），是死分支 |
| 每日复习预算 | 1462 `DAILY_REVIEW_BUDGET=30`，1637–1642，2686、2691 | 预算记在 `activity.daily[今天].reviewTargetKeys`；开组即预留（`reserveReviewTargets`）；用尽 → `startRound` 弹「今天的复习已完成，可以练新字」 | `reviewBudgetRemaining/reviewBudgetPool/reviewTodayCount` | activity | 可抽取改造 | 开组即扣预算，弃组不退（§5）；v10 未提每日上限——见 §6 |
| 复习排序 | 1680–1681 `reviewPriority`，2684 `compareReviewPriority`，2685 `chooseReviewBatch` | 上次结果权重(miss 42/hinted 30/slow 28/fast −8) + 难次数×18 + (100−ease)×0.7 + 逾期天×9 + 个人难度×0.25 − streak×6；再按 dueDay、个人难度 | — | memory、personalDifficulty | 可抽取改造 | v10 只需「按记忆曲线」：建议改为 dueDay 升序 + FSRS retrievability |
| 新字池与字库闸门 | 1643 `newPool`，1619–1620 `strictNewEligible`，1653 `practiceEligible` | 新字 = 未见过、非 indeck、非 custom、质量可用、**在当前字库内** | — | LIBRARIES、quality、memory | 可直接复用（去 quality/preference） | 注释 1619：选库只管新字范围，复习跨库保留——与 v10 C099 一致 |
| 四库定义与迁移 | 1121–1126 `LIBRARIES`，1127 `defaultLibraryId`，1129–1130 `LEGACY_LIBRARY_IDS`/`normalizeLibrary`，1131–1134 state/`currentLibrary/setLibrary/syncCalibrationLibrary`，2018–2022 `libraryCounts`，2027 `renderLibCard`，2777 换库点击 | `core3500`(norm 一级)/`adv3000`(二级)/`rare`(三级)/`curriculum2500`(edu 表一)；旧 `primary/junior/senior`→`curriculum2500/core3500/adv3000`；`{id,userSelected}` | 键 `shizi.library.v1` | preference（默认库随 challenge 偏好） | 可直接复用（去掉 preference/校准联动） | `libraryCounts` 已能给 v10 L10 需要的「可以练 N · 有记录 M」；`adv3000` 描述称「缺笔顺的字暂不进入练习」但代码里没有按笔顺可用性过滤 |
| 难度/主题选组 | 1544 `PREFS`，1621–1629 `qualityWeight`，1650–1658 难度/带/主题，1655 `targetDifficulty`，1656 `personalDifficulty`，1682–1684 `candidateDistance/addNearest/addBand`，1685–1693 `chooseTopic`，1694–1703 `chooseBatch` | 选主题（写 `shizi.topic.v1` 副作用）→ 4 到期 + 1 基础 + 4 进阶 + 7 较难 + 3 挑战 → 补齐 15 → 按带、难度排序 | `chooseBatch(pool)` | tuning、preference、quality | 应重写 | v10 出题「按记忆曲线」，不再按主题/难度带 |
| 组内自适应 | 1659–1678 `resetAdaptiveSession/adjustSessionTarget/adaptiveScore/adaptNextCard` | 每次首判后改写 `batch[pos+1]`（尊重 queuedFront）；连错 2 次挑最易 | — | newPool、sessionTarget | 应重写（删除） | 会让「本组是哪 15 个字」在中途变化，与 v10 固定 `n / 5`、S02 列出未写字冲突 |
| 校准组 | 1704 `calibrationScore`，1705–1712 `chooseCalibrationBatch`，1644 `calibrationPool`，1738–1749 `calibrationRoundStats/maybeFinishCalibration`，1843 `needsCalibration`，2383–2397、2504 teach 泡泡，2634 `takeCalibrationComfort`，2624 `CALIBRATION_FIRST_HOLD_MS`，HTML 661–673 首启页、703 `teachBubble`、778 `calibCard` | 首次：钩子 `尴/嚏` + 目标难度序列 `[48,56,…,98]` 取 15 字；组末按成绩定 `tuning.offset`、`preference`，并可能改默认库 | `startMode("new")` 在 `needsCalibration()` 时改 `activeMode="calibrate"`（1968） | tuning、preference、funnel | 与 v10 决定冲突（D17） | 首启按钮文案「先练 15 个字」（667） |
| 双层会话状态 | 1462–1468 变量；1469–1480 `currentCardIndex/episodeFor/enqueueReinforcement/graduateReinforcement/nextQueuedTarget/beginAttempt/roundIsComplete` | 取题顺序：manualQueue → 已到 `eligibleAfter`(=入队时 attemptSeq+2) 的 reinforcement → baseTargets[baseCursor] → 剩余 reinforcement；`attemptId=${roundId}-a${seq}-${idx}` | `advanceToNextTarget`（2677）、`next`（2680） | — | 与 v10 决定冲突（D18/D20） | v10 无组内再练；「看过答案后的描/写只是练习」 |
| 结果记录 `recordOutcome` | 1812–1841 | 按 attemptId 去重；更新计数/ease/streak/status；`reason` = independent/hinted/wrong/dontKnow；调 `applyFSRSReview(hard?Again:Good, graduate:!hard)`；首判写 `roundStats`、`missedThisRound`、`adaptNextCard`；base 题推进 `baseCursor`、`sessionDone`；hard 且未 hide → `enqueueReinforcement`；保存 memory；`markPracticeStamp` | 被 `pickStamp`（2639）、`declareDontKnow`（2608）调用 | 全部 | 可抽取改造 | 只保留「幂等 + 一次判断一条记录」骨架；outcome 集合要换成 v10 的 写对/写错/看过答案/跳过 |
| 判断与揭晓 | 2596–2599 `revealAnswer`（「写好了」）、2650–2659 `decideSubmission`、2635–2645 `pickStamp`、2660–2662 按钮、HTML 750–765 | 写对且无提示→fast；写对有提示→hinted；写错→slow；「不太确定」→hinted(uncertain)；几何判定 bad+exact 时先弹「再对比一下」软确认（2656–2657） | — | submissionSnapshot、lastVerdict | 与 v10 决定冲突（D20、D03） | v10 只有两键「写错了/写对了」且一样醒目；软确认属系统预判 |
| 「不会写」= 描红教学 | 2606–2609 `declareDontKnow`，2600–2605 `beginTracingPhase/finishTracing`，2646–2648 `goNext`(miss→描红)，2652–2655 描后自写完成只标 `teachingComplete` | 记 `miss`(Again) 后进入 tracing → postTraceRecall；描后写对不产生新记录 | 按钮 `#show`（715） | recordOutcome | 与 v10 决定冲突（D18） | v10：看答案直接记「看过答案」，不打 Again |
| 最后一印撤销/重盖 | 2427–2432 `takeStampSnapshot`，2433–2445 `restoreStampSnapshot`，2446–2451 undoBar（5 s）、`commitUndoWindow`，2621–2623 `reopenStampChoices`，`EDIT_STAMP_WINDOW_MS=1800`（2624） | 回滚 memory 行、status、FSRS 事件(按 eventId 删)、activity 当日行、funnel、roundStats | `#editStamp`（765）、`#undoLast`（696） | — | 可抽取改造 | 「更正同一记录、不增加次数」的原语正确，但仅限最后一印、5 s 超时；D19 要的是结果页格子改任意字 |
| 节奏预算 | 1468 `ROUND_ATTEMPT_BUDGET=20`/6 分钟，2666–2676 `roundBudgetReached/openRoundBudgetSheet/deferRoundToTomorrow/pendingTomorrowIndexes`，HTML 978 | 20 次或 6 分钟弹「今天先到这里」，未写字全部 `pendingLearning=true + queuedFront` 排到明天最前 | — | queuedFront | 与 v10 决定冲突（D22） | v10 用「结束这组」：没写的不算记录也不算跳过 |
| 补记（makeup） | 1930 `makeupCandidates`，1931–1932 `startMakeupDay`，1299–1306 `markRoundComplete` 补记分支，1522–1523 会话可用性检查 | 最近 7 天空白日补写 5 字 | — | reviewPool、highRisk、newPool | 与 v10 决定冲突（D24）且**已损坏**：`newScore` 在全仓库无定义（grep 仅 1930 一处使用），`newPool(false)` ≥2 项时 `.sort` 抛 ReferenceError | 删除即可 |
| 会话 v3 快照 | 1481–1503 编码与保存，1504–1538 解码与恢复，1521 旧版丢弃，1525–1530 形状/可恢复判定 | 见 §3；保存点：startRound(2695)、advance(2678)、提示(2574)、reveal(2598)、pickStamp(2644)、recordQuality(1800)、insertIntoCurrentBatch(2155)、exit(2766) | 键 `shizi.session.v1` | cardKey、CARDS | 可抽取改造 | 单字专练不落盘（1502）；`sessionPayload` 每次保存都 `load(SESSION_KEY)` 读回 `startedDate`（1498） |
| 模式入口 | 1967–1968 `startMode`，1969–1970 `startFocus`，2686–2696 `startRound`，2793 首页按钮（有到期→review 否则 new），2797 首启按钮，2754–2757、2784、2794、2822、2836 各处 `startFocus` | `activeMode ∈ new/review/calibrate/focus/makeup`；`startRound` 决定 `baseTargets`：focus/makeup 取 `chooseFocusBatch`（按个人难度降序，≤15/5）、review 取 `chooseReviewBatch` 再截到剩余预算、calibrate 取校准组、否则 `chooseBatch`；`queuedFront` 字前置（非校准） | — | 全部 | 应重写 | `startFocus` 无条件 `clearSessionSnapshot()`（1970）→ 与 D05 冲突 |
| 组末结果 | 2712–2742 `roundSummary`，2743–2750 `allDone`，1751–1761 `renderRoundTune/recordRoundFeedback`，HTML 828 | 校准专用卡 T4；「这组感觉」四键改 `tuning.offset/preference`，记 `tuning.rounds`（≤30） | — | tuning | 与 v10 决定冲突（D6 待定/D20） | 交接备注 168–170：D6 不影响选字就删掉；v10 出题不用难度 → 应删 |
| 「写得不稳的字」 | 2043–2066：`hardCount/missCount/profileSampleReady/weaknessScore/profileIndexes/structureLabel/profileGroups/profileAdvice/renderProfile`；1904–1907 `renderMe` 前 3 字；1715–1717 `isHighRisk/highRiskIndexes`；2007–2010 `isStable/memoryInkLevel` | 「不稳」= `misses>0`（任何历史 miss），按 miss 次数、weaknessScore 排序，取 15 个专练；`isHighRisk` = 质量可用 且 (indeck ‖ misses ‖ slow ‖ hints≥2) 且 streak<2 | `startFocus(profilePracticeIndexes)` | memory | 与 v10 决定冲突（D23） | 需换成「写错过（最近一次有效判断）」+「快忘了（FSRS 到期）」两张互斥清单 |
| 自定义加字 | 2088 `customWords`，2105–2109 `pushWordCards/buildCustomCards`，2118–2120 `addedChars/customIndexOf`，2121 `unblockQuality`，2122–2125 `recordRealWorldMiss`，2126–2136 `addWord`，2141 `indexesForChars`，2142–2155 `insertIntoCurrentBatch`，2156–2157 `queuedFrontPool`，2887–2900 加字面板 | 库外字→`custom:` 卡（py 空、hint「你刚才卡壳的字」、d 76、band 较难、norm 自定义）；**所有**加的字：清质量标记、`recordRealWorldMiss`（seen+1、misses+1、lastOutcome miss、ease−16、dueDay=今天、status indeck）、`queuedFront/queuedFrontAt`；练习中则 splice 进当前组 | 键 `shizi.custom.v1`（词数组）、`shizi.added.v1`（字数组） | memory、CARDS 可变长度 | 与 v10 决定冲突（D03/D21/D23） | `addedChars` 没有移除函数；`customWords` 按词存，移除单字需拆词 |
| 拾于生活（照片）加字 | 2137–2140 `collectWildCharacter` | 走 `addWord` 同路径，附 `m.source="wild"` | 键 `shizi.wild.v1` | addWord | 与 v10 决定冲突（同上） | 非本段核心，仅说明它复用了伪造 miss 路径 |
| 提醒候选 | 1384–1391 `reminderCandidates/reminderQuestions`，1395–1397 `shiziOpenReminderTarget`，1399–1404 `syncReminder` | 到期字（dueDay≤日）优先 miss、再 dueDay、再个人难度；无到期取 highRisk；通知点开→插入当前组或 `startFocus` | iOS bridge `syncReminder` payload | memory.dueDay/lastOutcome | 可抽取改造 | 任何 memory 字段改名都要同步这里 |

## 3. 数据契约

### 3.1 CARDS 卡（内存，不落盘）
`{word, chars:[…], ci, target, py, hint, rank, strokes, parts, topic, d(难度 0–115 内的数), band(入门/基础/进阶/较难/挑战), edu(表一/表二/null), common, norm(一级/二级/三级/自定义), std, ctx(dict/override/gloss/fallback/custom), custom?:true}`（1048–1051，2106）。实测分布：norm 一级 3500 / 二级 2976 / 三级 818；edu 表一 2500、表二 1000、null 3794；ctx dict 6235 / override 105 / fallback 954。`GROUPS`（提示分组）7294 键。

### 3.2 卡键
`base:<单字>` | `custom:<单字>`；旧 `custom:<n>:<单字>` 归一（1541–1543）；`storedCardKey` 允许 `legacy:` 前缀（activity 里 `legacy:${attempts}` 占位，1296）。

### 3.3 `shizi.deck.v8105.context2`（status）
`{ [cardKey]: "indeck" | "rest" | "known" }`（1112、1142–1143）。`indeck` = 写错/提示/不会写后待巩固；`rest` = 独立写对或标「太简单」；`known` 只读不写。

### 3.4 `shizi.memory.v1`
`{ [cardKey]: 行 }`，行字段（1630 初始化，1812–1841、1224–1231、2122–2125、2135 写入）：
- 计数：`seen, fast, slow, hints, misses, streak, ease(0–100, 初 50)`
- 时间：`firstSeenAt(ms), last(ms), missedOn(day)`
- 调度：`due(ms, 旧), dueDay("YYYY-MM-DD"|null), pendingLearning(bool), legacySchedule?`
- FSRS：`fsrsCard{due(ISO), last_review(ISO|null), stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, learning_steps?}`、`schedulerVersion, parameterVersion, schedulerTimeZone`
- 上次结果：`lastOutcome(fast|slow|hinted|miss), lastHints, traced, lastSystemSuggestion(""|correct|wrong), lastSystemStatus, lastSystemAgree(bool|null), lastEpisode{firstOutcome, attempts, assistanceUsed, independentlyRecovered, teachingComplete}`
- 冗余卡信息：`topic, band, word, target`
- 自选：`queuedFront(bool), queuedFrontAt(ms, 严格递增)`；拾于生活：`source:"wild", wildDay`
- 墨迹：`recentInk{version:2, day, at, dataURL(≤32KiB webp/png), strokes}`，总量 ≤96 份/420KiB（1144–1172）
备份导入时按 `last` 取新、同键合并（3027）。

### 3.5 `shizi.quality.v1`
`{ [cardKey]: {easy:0|1, rare:0|1, badWord:0|1, hide:bool, last, target, word, topic, band} }`（1794–1800）。`hide/badWord` 阻断；`easy` 排除；`rare` 非挑战偏好排除（1546–1548）。

### 3.6 `shizi.pref.v1` / `shizi.tuning.v1` / `shizi.topic.v1`
- pref：`"balanced"|"practical"|"challenge"`（1119）。
- tuning：`{calibrated, offset(−18…22), contextStrict(0…4), rounds:[≤30 {id,date,mode,kind,counts,score,offset,contextStrict}], calibration?{date,counts,consistentFast,sampleSize,score,offset,preference}, lastRoundId, lastRoundFeedback, easyStreak, hardStreak, chromeFadeSeen, strokeHintConsequenceShown, peekHintUsed}`（1120、1173、1745、1754–1761、2182、2571）。
- topic：上次主题字符串（1693）。

### 3.7 `shizi.library.v1`
`{id:"core3500"|"adv3000"|"rare"|"curriculum2500", userSelected:bool}`；旧值可为字符串 id 或 `primary/junior/senior`（1129–1131）。

### 3.8 `shizi.custom.v1` / `shizi.added.v1`
- custom：`string[]`（词），每词拆字追加 `custom:` 卡（2105–2109）。
- added：`string[]`（字，含库内字），缺失时由 custom 推导（2118–2119）。

### 3.9 `shizi.fsrsReviewLog.v1`
`{version:2, events:[…], monthly:{ "YYYY-MM": {reviews, good, again, hinted, traced, firstAt, lastAt, lastReviewByDay:{day:{cardKey, reviewedAt}}} }}`（1199、1206–1210）。
事件（1196–1197、1232–1234）：`{eventId, attemptId, cardKey, target, reviewedAt(ISO), localDay, rating:"Again"|"Good", reason:"independent"|"hinted"|"wrong"|"dontKnow", hintCount, traced, teaching, plannedDue(day), actualIntervalDays|null, scheduledDays, schedulerVersion, parameterVersion, desiredRetention, maximumInterval, timeZone}`。旧数组格式也接受。

### 3.10 `shizi.session.v1`（version 3，1498–1501）
`{version:3, startedDate, updatedAt, activeMode(new|review|calibrate|focus|makeup), makeupTargetDay, baseTargetKeys[], baseCursor, currentCardKey, currentAttemptKind(base|manual|reinforcement), currentAttemptId, manualQueue[{cardKey, kind:base|repeat}], reinforcementQueue[{cardKey, eligibleAfter, order}], unresolvedKeys[], episodeRows[{cardKey, firstOutcome, attempts[{attemptId, seq, outcome, userCorrect, uncertain, hintUsed, hintCount, enteredTracing, teaching, eventId, at}], assistanceUsed, independentlyRecovered, excluded, teachingComplete}], attemptSeq, practicePhase(recall|reinforcement|tracing|postTraceRecall|revealDecision|feedback|between), visual{practicePhase, currentCardKey, currentAttemptKind, currentAttemptId, hintEverUsed, enteredTracingThisAttempt, hintsUsedThisCard, shownStrokes, groupIdx, seenGroups[], inkStrokes[[{x,y,t?,p?,w?,v?}]], tracedThisCard, submissionSnapshot, revealed, stamped}, missedThisRound[], roundStats[{cardKey, target, word, outcome, uncertain, geometryStatus, geometryMode, traced, hintUsed, level, topic, dueDay, independentlyRecovered}], focusKeys[], sessionDoneKeys[], sessionTarget, sessionFastStreak, sessionMissStreak, roundFeedbackGiven, roundId, calibrationFirstHoldUsed, calibrationComfortShown, calibrationTargetKeys[], lastStampSnapshot, feedbackKind, roundElapsedMs, roundBudgetPrompted, roundStartMemoryCount}`。
解码规则：任一 cardKey 解析失败或 target 不符 → 整份 null → 隔离（1518–1530）；v1/v2 → 直接丢弃并置 `legacySessionDiscarded`（1521、1527）。

### 3.11 `shizi.activity.v1` 中与调度相关的字段
`daily[day].reviewTargetKeys[]`（每日复习预算账本，1637–1642）、`targetKeys/independentTargetKeys`（月报、盖章）、`completedRoundIds`（完成组）。

### 3.12 iOS 提醒 payload（1399–1404）
`{type:"syncReminder", enabled, hour, minute, practicedToday, title, body, targetCardKey, questions:[{day, title, body, targetCardKey}]}`。

## 4. 与第十稿（v10）决定的关系

| 决定 | 现有代码 | 判定 |
|---|---|---|
| **D17** 第一次 5 字、无介绍页/首题说明卡、进度写「3 / 5」 | 首启页 661–673（「先练 15 个字」）；`needsCalibration`→`calibrate` 模式 1843/1968；15 字校准组 1705–1712；teachBubble 703 与 teachStage 2383–2397；校准专用结果卡 778/2727–2733；`BATCH=15` 1462；首页标题「今天拾十五个字」1880；进度文案「已练 n / 15 个 · 另有 k 个字要再练」2403 | **冲突**。校准/首启/教学泡泡/校准结果卡整块删除；组大小改为 5（首次）；进度改「n / N」 |
| **D18** 看答案 → 记「看过答案」，不判对错，之后描/写只是练习 | 「不会写」→`recordOutcome("miss")`→Again、misses+1、status indeck、进再练队列（2606–2609、1825–1837）；描后自写完成只标 `teachingComplete`（2652–2655） | **冲突**。需要新的不打分记录类型；不能走 `applyFSRSReview` |
| **D19** 上一字结果行「「X」记为写对 · 修改 ›」仅在未落笔时显示；修改入口移到结果页格子 | undoBar 5 s 超时（2448–2451）、`editStamp` 1.8 s（2624、2643）；`reopenStampChoices` 仅能改**最后一印**（2621–2623）；结果页格子点击只开单字详情（2780） | **冲突**（入口与时限）；`restoreStampSnapshot` 的「回滚同一 eventId、不增次数」原语可保留并扩展为任意字 |
| **D20** 判断页两键左错右对、一样醒目；最后一字直接进结果页 | `decisionUncertain`「不太确定」第三键（754、2662）；几何 bad+exact 的软确认（755、2656–2657）；组末条件含 `unresolved.size===0`（1480），即再练队列清空才算完 | **冲突**。去掉第三键与软确认（亦触 D03「不预选答案」）；去掉再练队列后 `roundIsComplete` 简化为 `baseCursor>=N` |
| **D21** 查字/加字/自选合并；「加入」明确点选；可移除并撤销 | `addWord` 伪造一次 miss 记录并置 due 今天（2122–2136）；`insertIntoCurrentBatch` 直接插进当前组（2142–2155）；`addedChars` 只增不删 | **冲突**（并触 D03「没有本人书写不制造有效判断」、D23）。保留 `pushWordCards/customIndexOf/indexesForChars`；`queuedFront` 改为纯「自选优先」标记；新增移除+撤销 |
| **D22** 中途「结束这组」先确认；已判断保留，没写的不算记录也不算跳过；零判断回来源并轻提示 | `exitCurrentRound` 只是暂停（保存快照回首页，2761–2772）；节奏预算「今天先到这里」把未写字设 `pendingLearning+queuedFront`（2674–2676） | **冲突**。删预算面板；新增「结束这组」= 清快照、保留已记录、未写字不动 |
| **D23** 「写错过」= 最近一次有效判断为写错；「快忘了」写一遍就离开；两表不重叠；跳过/看过答案不算有效记录 | 「写得不稳」= 历史 `misses>0`（2060）；`isHighRisk` 混合 status/计数/streak（1715）；`lastOutcome` 把「不会写（=看答案）」记为 miss（1825） | **冲突**。建议 memory 行新增 `lastJudgement:"correct"|"wrong"`+`lastJudgedAt`；写错过 = `lastJudgement==="wrong"`；快忘了 = `reviewDue(i) && lastJudgement==="correct"`（FSRS 到期），二者天然互斥 |
| **D24** 去掉补记 | `makeup` 模式全套（1930–1932、1299–1306、1522–1523、`FUNNEL_MODES` 1239） | **删除**；且 `newScore` 未定义（1930）说明该路径已无人走通 |
| **D25** 提示画法 | 提示计数按 `GROUPS` 分组（2558–2575）；提示后 toast「用了提示，这个字本组稍后还会再写」（2571） | 画法属另一范围；该 toast 文案依赖再练队列，随 D18/D20 一并删 |
| **D05** 普通会话 A 与自选会话 B 隔离；开 C 不覆盖 B | 单一 `SESSION_KEY`；`startFocus` 无条件 `clearSessionSnapshot()`（1970）；首页只显示一份续练（1872–1875） | **冲突**。快照需扩成两槽（或两键），首页两行（S01） |
| **D06/D07** 更正同一记录；保存成功才推进 | `restoreStampSnapshot` 满足「同一记录」；`recordOutcome` 不检查 `saveMemory()`/`save()` 返回值（1841、1235），保存失败仍推进；只有退出时检查（2766） | **部分冲突**（D07）。v10 必须在 `recordOutcome` 后按返回值决定是否推进 |
| **D03** 由用户自判、不叠字评分 | 软确认（2656–2657）与 `lastSystemSuggestion/lastSystemAgree`（1819–1821）是系统对错预判 | 软确认应删；`lastSystem*` 仅作漏斗统计可留但不得影响判断 |
| 交接备注 §5「以后按记忆曲线出题，刚写过的字当天不再出」 | Good → `dueDay=max(明天, planned)`（1230）满足；Again → `pendingLearning` 不再到期但会在组内再练；`queuedFrontPool` 忽略会话（2156）并前置到任何非校准组（2690）→ 当天可能再出；focus 模式完全不看到期 | **基本可复用**，需去掉 pendingLearning 悬置、约束 queuedFront |
| 交接备注 §5「“这次选的字”优先，今天的练习保留」 | `queuedFront/queuedFrontAt` 排序（2135、2156–2157） | 概念可复用，但要脱离伪造 miss；「这次选的字」在 v10 是独立会话 B，不是插进 A |
| D7 单字详情「大约 X 月 X 日再练到」 | Good 后 `dueDay` 存在，已用于 `stampToastCopy`（2453）；Again 后 `dueDay=null` | **可算**，条件是 v10 让「写错」也拿到 FSRS 的 due（不再 null） |
| D6 「这组字难不难」是否影响选字 | 影响：`recordRoundFeedback` 改 `tuning.offset/preference`→`targetDifficulty`（1754–1761、1655） | v10 出题不按难度 → 按交接备注 168 删掉整块 |
| 换库列表「可以练 N 个字 · 有记录 M 个」（L10） | `libraryCounts` 返回 `total/got`（2018–2022） | **可直接复用** |
| 每日 30 到期上限、15 字复习组、首页「有到期先复习」 | 1462、1637–1642、2686–2691、2793 | v10 未提；D01「不以每日必须完成推动」与上限不矛盾，见 §6 |

## 5. 风险与坑

1. **pendingLearning 悬置会把字「弄丢」**：Again 后 `dueDay=null, pendingLearning=true`（1231、1471），只有组内后续 Good 才毕业。若组被丢弃（v1/v2 会话被 `discardLegacySession`、v3 解码失败被隔离、或被 `startFocus` 清掉），该字既不到期（`isDue/reviewDue` 为假）也不是新字（`hasMemory` 真），只能靠 `highRiskIndexes`（提醒兜底 1389）或「写得不稳」（需 misses>0）间接浮出；只有 `slow` 且无 miss 的字会永久消失。v10 应让每次判断都产出具体 due。
2. **`newScore` 未定义**（1930）：`startMakeupDay` 在 `newPool(false)` ≥2 项时抛 ReferenceError，被 `window.onerror` 捕获后显示「页面发生异常。请先导出备份」（1067–1069）。当前补记不可用；D24 删除即可，但说明 verify 脚本未覆盖该路径。
3. **开组即扣复习预算**：`reserveReviewTargets` 在 `startRound` 就写入 `reviewTargetKeys`（2691），弃组不退款；两次开组即触发「今天的复习已完成」（2686）。测试 verify_8105_app.js:832–854 只覆盖顺利路径。
4. **组内替换题目**：`adaptNextCard` 每次首判后改写 `batch[pos+1]`（1678），`baseTargets`（同一数组引用，`batch=baseTargets` 2692）随之变化；快照 `baseTargetKeys` 也随之变。v10 需要固定字集来写「上一组还有「鲜」「境」没写」。
5. **启动写放大**：`migrateStableCardIdentity()` 每次启动无条件保存 memory/quality/deck/fsrs/activity 五键（2117），1221 又保存 memory 与日志。memory 单键含全部 recentInk（≤420KiB）；iOS Safari localStorage 约 5MiB，`save()` 失败只提示不回滚（1072、1066）。
6. **FSRS 事件 120 天折叠**（1205–1209）：折叠后无法按卡回放；「一共写错 N 次」（v10 C168）须来自 memory 计数（`slow/misses`）而非日志；D19「修改任意字判断」若靠删事件重算，只能在 120 天内成立，且需保存事件前的 `fsrsCard` 才能无损回滚（目前只有最后一印的快照有 `memoryValue`，2429）。
7. **fuzz 不确定性**：`enable_fuzz:true`（1204）→ 同输入 due 可不同；测试与验收不能断言精确日期，只能断言 ≥ 明天与 ≤ 365 天。
8. **dueDay 为本地日字符串**：`dayKey` 用设备本地时区（1175），事件记录 `timeZone`（1203）但比较不用它；跨时区旅行可能提前/推后一天。`normalizeLegacySchedule` 用 `due(ms)` 反推 `dueDay`（1215）。
9. **同一 attemptId 幂等依赖 roundId**：`attemptId=${roundId}-a${seq}-${idx}`（1479）；`restoreSession` 缺 roundId 时用 `Date.now()+"-resume"`（1534），恢复后的新 attemptId 与快照里旧 attemptId 不同一序列，重复记录保护仍靠 `ep.attempts` 与 eventId 线扫（1813、1223）。
10. **定时器竞态**：`autoNextTimer`(1.8 s)、`editStampTimer`(1.8 s)、`undoFollowTimer`(5 s)、`teachTimer`(3 s) 并存（2624、2643–2645、2451、2395）；`openAddSheet` 在反馈期打开会暂停自动推进并**丢弃** `lastStampSnapshot`（2887）→ 加字后不能再重盖。v10 只要求 0.4 s 按钮/0.3 s 书写格锁（`armGradeActions` 300 ms 已有，2260）。
11. **`status` 层与 FSRS 并行**：`indeck/rest` 由结果决定（1822–1825），`reviewReady` 因 status 走不同函数（1634）；`known` 死分支（1635）。两套真相源，v10 建议只留 FSRS + `lastJudgement`。
12. **`chooseTopic` 有副作用**：选组时写 `shizi.topic.v1`（1693）；审计面板用临时偏好包裹再恢复（2082–2083）。
13. **CARDS 可变长度**：`buildCustomCards` 会 `CARDS.length=BASE_N` 再重建（2108）；备份校验期间 `withBackupCustomContext` 临时替换 customWords 重建 CARDS（3033–3034），任何持有的 custom 下标此刻失效。会话进行中不应导入备份（当前从设置页进入，卡页不可见，风险可控）。
14. **自定义卡无拼音/语境**：`py:""`、`hint:"你刚才卡壳的字"`（2106），题面 `promptHTML` 用 `c.py||"？"`（2401）；提醒候选要求 `word/py` 非空所以自定义字永不进提醒（1384）。
15. **iOS 提醒消费 memory 字段**：`reminderCandidates` 读 `dueDay/pendingLearning/lastOutcome`（1384–1388），`shiziOpenReminderTarget` 会 `insertIntoCurrentBatch` 或 `startFocus`（1395–1397）；改字段名/删 focus 都要同步 iOS 侧 payload。
16. **现有 e2e 断言固化了旧产品**：scripts/verify_8105_app.js 断言首启「先练15个字」（324）、校准组顺序 `尴嚏狩晤飓痿俾跻徵瞰裘娩邃暧煲`（675–679，且 `core-strokes.js` 前 15 字即校准组）、30 字预算（852–854）、再练队列与节奏预算（886–956）、加字置 queuedFront（1016–1161）。v10 落地时这些用例要整批改写，`core-strokes.js` 预打包集合的取舍依据也变了。
17. **`quality` 四键**（太简单/太生僻/词不自然/不想练，767、1794–1800）影响出题池；v10 页面里没看到对应控件，保留与否需决定，否则 `qualityAvailable` 里的 `preference` 分支（1548）失去意义。

## 6. 未解问题

1. v10 只写了「第一次练习 5 个字」；第二次及以后每组多少字（仍 5？15？按到期数？）文档未定，`BATCH=15` 是否保留需产品确认。
2. 每日到期上限 30、复习/新字的开组顺序（先复习后新字，2793）在 v10 是否保留；D01 不反对上限，但交接备注只说「按记忆曲线出题」。
3. 「写对了」但用过提示，在 v10 应打 Good 还是 Again？现在 `hinted→Again`（1815、1827）。D06/D07 只说提示是「帮助事实」要保留，未说是否影响间隔。
4. 「看过答案」是否要触碰 FSRS（例如把 due 设为明天而不评分），还是完全不改调度只记事实？D18 只规定统计口径。
5. 「跳过」在 v10 的正式排除范围（交接备注 64 行「只在当前会话里排除」仍标待定，decisions 表也列为待定）；现有代码无 skip，实现时不能借旧 `sessionDone` 默认裁决。
6. 「快忘了」正式口径「按记忆曲线」的具体阈值：是 `dueDay<=今天` 即算，还是按 retrievability 低于某值，最多 12 个是否保留（交接备注 92、103 行为原型模拟值）。
7. v10 字库字数写死为 3500 / 2976 / 818 / 2482（交接备注 88 行）；实测 `edu==="表一"` 为 2500，2482 的差额来源（缺笔顺？）无法从代码确认，`LIBRARIES[1].desc` 说的「缺笔顺不进练习」也没有对应过滤代码。
8. 单一 `SESSION_KEY` 改为 A/B 两槽后，备份 `BACKUP_KEYS`（2988）、`STORED_SHAPE`、`normalizeBackupSession`（3028–3031）如何兼容旧 v3 快照（丢弃还是迁移），D15 允许调整但需明确。
9. D19 修改任意字判断的实现路径：删事件重算 FSRS 需事件里带修改前 `fsrsCard`，还是限定只能改「本次练习」内的字（结果页语境暗示后者）。
10. `quality` 反馈（太简单/太生僻/词不自然/不想练）与 `preference` 三档在 v10 是否还存在，未在第十稿页面中找到。

## 附：值得保留的「最小调度核」与替换清单

**保留（改造后复用）**
- CARDS/SEED 构建、`BASE_BY_CHAR`、`cardKey/canonicalCardKey/storedCardKey/indexForCardKey`（1038–1056、1541–1543、≈1183、1392–1394）。
- 存储原语与形状表 `load/save/bootLoad/bootNormalize/STORED_SHAPE`（1071–1111）。
- FSRS：`FSRS_CONFIG`、`fsrsEngine`、序列化、`normalizeLegacySchedule`、幂等 `applyFSRSReview`、事件日志与压缩、`normalizeFSRS*`（1196–1235）——去掉 Again 的 pendingLearning 悬置，改为直接采用 FSRS 的 due（至少明天）；新增不评分记录类型（看过答案/跳过）不进此函数。
- 到期选字：`isDue/reviewDue/reviewPool`（1632–1636）+ 简化排序（dueDay 升序、再 retrievability）；`DAILY_REVIEW_BUDGET` 账本可选保留（改为练完再记账）。
- 字库：`LIBRARIES/normalizeLibrary/currentLibrary/setLibrary/strictNewEligible/libraryCounts`（1121–1134、1619–1620、2018–2022），默认库固定 `core3500`，删 `defaultLibraryId` 的 preference 依赖与 `syncCalibrationLibrary`。
- 新字池 `newPool` 去 quality/preference 后 + 简单排序（rank/common）。
- 自定义卡：`pushWordCards/buildCustomCards/customIndexOf/indexesForChars`（2105–2109、2120、2141）；`addedChars` 作为「自选的字」列表，新增移除+撤销；删 `recordRealWorldMiss`、`unblockQuality` 的自动清标；`queuedFront` 改为纯优先标记。
- 会话快照的 cardKey 编码/解码/隔离骨架（1484–1530），payload 改版为两槽（D05），阶段枚举改为 v10 的 写/判断/看过答案/结果。
- 最后一印回滚原语 `takeStampSnapshot/restoreStampSnapshot` 的「按 eventId 删事件 + 回放 memory 行」思路（2427–2445），扩展为结果页任意字修改。
- 提醒候选 `reminderCandidates`（1384–1391）随字段改名同步。

**替换/删除**
- `chooseBatch/chooseTopic/addBand/addNearest/candidateDistance/BAND_*/targetDifficulty/personalDifficulty/adaptiveScore/adaptNextCard/adjustSessionTarget/PREFS/preference/qualityWeight`（1544–1703）。
- 校准全套：`chooseCalibrationBatch/calibrationScore/maybeFinishCalibration/needsCalibration/calibrationTargets/takeCalibrationComfort/teach*`、首启页、calibCard、`CALIBRATION_FIRST_HOLD_MS`、漏斗事件 `welcome_shown/calib_*`。
- 组内双层：`manualQueue/reinforcementQueue/unresolved/episodes/nextQueuedTarget/enqueueReinforcement/graduateReinforcement/insertIntoCurrentBatch`，`practicePhase` 中 `reinforcement/tracing/postTraceRecall` 作为记录语义（描红可留为纯练习 UI）。
- 节奏预算 `ROUND_ATTEMPT_BUDGET/ROUND_TIME_BUDGET_MS/deferRoundToTomorrow/pendingTomorrowIndexes/roundBudgetSheet` → D22「结束这组」。
- `makeup` 模式与 `canMakeupDay/makeupCandidates/startMakeupDay`（D24）。
- `roundTune/recordRoundFeedback/tuning.offset/contextStrict/rounds`（D6 → 删）。
- `status`（DECK_KEY）三态与 `isHighRisk/weaknessScore/profile*/meWeakChars`「写得不稳」→ D23 的写错过/快忘了。
- `GRADE_UI` 四印（拾到/补拾/待补/再拾）→ v10 四态 写对/写错/看过答案/跳过；`decisionUncertain` 与 `softConfirm`（D20/D03）。
