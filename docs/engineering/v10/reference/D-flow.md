# D · index.html 练习流程（render / submit / 判断 / 盖章 / 重盖 / 结果页 / 灶台模式）

范围：`/Users/orange/Documents/ChatGPT/astraworld/shizi-app/index.html` 的 `// ---- 流程 ----` 段（L2400–L2781），以及它直接依赖的会话/记账/画布/历史函数（L1463–L1540、L1768–L1778、L1812–L1846、L2172–L2300、L2238–L2261、L3080–L3092）。对照文件：`docs/handoff/decisions.md`（D01–D25）、`docs/product/04-v10-handoff.md`、`docs/design/v10/交接备注-第十稿交接版.md` §十、`docs/design/v10/第十稿-改动清单-第十稿交接版.md`、`docs/design/v10/shizi-v10-交接版.html`（内嵌 gzip 的 ShiziWriteScreen 组件已解压核对）。以下行号均指 index.html，除特别标注。

## 1. 概览

现有练习流程是一台以全局变量驱动的状态机：`practicePhase` 取 `recall | reinforcement | tracing | postTraceRecall | revealDecision | feedback | between`（L1464、L1479、L2597、L2600、L2604、L2639、L2680），入口是 `startRound()`（L2686）→ `beginAttempt()`（L1478）→ `render()`（L2485）；每张卡的出口是 `pickStamp()`（L2635）→ `recordOutcome()`（L1812）→ 1.8s 后 `advanceFeedback()`/`next()`（L2649、L2680）→ `advanceToNextTarget()`（L2677），组末进 `roundSummary()`（L2712）。它承载了第八稿之前的整套概念：四种结果印章（拾到/补拾/待补/再拾，L1719–L1724）、系统几何比对预选答案（`checkInk`，L2322；`suggest` 类，L2589）、“不太确定”第三选项（L2661）、软确认弹层（L2654–L2655）、点拨按部件分组逐笔播放并可长按“瞥一眼”（L2546–L2573）、不会写→描红→自己写两步教学（L2600–L2609）、20 次/6 分钟节奏提醒（L1468、L2668–L2676）、5 秒“重盖”条 + 1.8s 编辑窗（L2452–L2454、L2625）、校准组教学气泡（L2384–L2399）。第十稿（D17–D25、W01–W15、K21–K31）几乎把这一层 UI 全部换掉：提示改为“提示 · 还有 N 次”按四分之一笔画递进、笔迹变浅 35%（D25/W03/W04）；看答案直接记“看过答案”不判断（D18）；判断页只有左“写错了”右“写对了”+“接着写”（D20）；上一字结果行只在未落笔时显示、修改入口移到结果页格子（D19）；跳过为下划线文字、“结束这组”先确认（D22）；最后一个字直接进结果页（W13）；恢复到精确阶段含判断页（W10）。能留下的主要是持久化与原子性的“骨架思路”：会话快照 v3 的稳定键编码（cardKey 而非索引）、提交时冻结的 `submissionSnapshot`、`takeStampSnapshot/restoreStampSnapshot` 的多存储原子回滚、`attemptId` 幂等（`recordOutcome`/`applyFSRSReview` 去重）、以及“保存成功才推进/失败留现场”的 `exitCurrentRound` 分支。

## 2. 组件/模块清单

| 名称 | 位置 | 职责 | 对外接口（函数/事件/存储键） | 依赖 | 复用判断 | 备注 |
|---|---|---|---|---|---|---|
| `promptHTML(c)` | L2401 | 把卡片词语渲染成挖空题面：目标位 `<span class="blank">` 显拼音（无拼音显“？”），其余 `<span class="given">` | 返回 HTML 字串，写入 `#prompt`（L2497） | `CARDS[i].chars/ci/py` | 可直接复用（逻辑），文案/样式按 v10 W22 拼音加大 | D16 的“重复目标字全部遮住、其他用 □”不在此函数内处理（依赖题库预处理） |
| `practiceProgress()` / `updateProgressLabel()` | L2402–L2403 | 进度标签：`已练 done / total 个 · 另有 N 个字要再练`，单字组隐藏 | 写 `#posLabel`（L693） | `baseTargets`、`roundStats`、`unresolved` | 与 v10 决定冲突 | D17/W12/K26 要求右上角一律 “3 / 5”；“另有 N 个字要再练”这一整套强化队列口径被 v10 去掉 |
| `drawSnapshotStrokes` / `snapshotImage` / `failedUserStrokeIndexes` / `revealInkImage` / `renderStrokeSkeleton` | L2406–L2425 | 把提示笔画（hintStroke 色）+ 用户笔迹（毛笔渲染）合成 PNG dataURL；按 `lastVerdict.failed` 把失败笔画描红；把 medians 画成 SVG 骨架 | 内部函数；输出 `canvas.toDataURL()` / SVG 节点 | `normalizedSessionInkStrokes`（L1154）、`paintBrushStroke`（L2215）、`penBaseWidth`、`hintStroke`（L2163）、`cssVar` | 可抽取改造 | 失败笔画描红（L2419）依赖系统判定，D03“不叠字评分”下不应再展示红标；骨架 SVG 可用于 v10“参考字形”列 |
| `freezeSubmissionSnapshot()` / `captureRevealState()` | L2426–L2432 | “写好了/不会写”时冻结提交现场：hintStrokeIds、hintStrokes、inkStrokes、referenceStrokes、compositeGeometry、compositeImage、`checkInk` 判定、phase 等，`Object.freeze` | 设 `submissionSnapshot`、`lastVerdict`；返回快照 | `curMedians`、`mediansToCanvas`（L2308）、`checkInk`（L2322）、`inkEnd`（L2290） | 可抽取改造 | v10 仍需“判断页/恢复时笔迹与参考字形都在”（W10），冻结快照是正确思路；但 `lastVerdict`/`compositeImage`（可达 2MB 的 PNG，L1169 上限）应去掉 |
| `takeStampSnapshot()` / `restoreStampSnapshot()` | L2433–L2449 | 盖章前把 队列/游标/attempt/status/memory/FSRS 事件 id/activity 日行/funnel 长度/roundStats/roundHandwriting/校准标志/揭晓现场 全部拍照；回滚时逐项还原并 `save(DECK_KEY)`、`saveMemory`、`saveFSRSLog`、`saveFunnel`、`saveActivity`、`syncReminder`、`saveSessionSnapshot` | 读写 `shizi.deck.*`、`shizi.memory.v1`、`shizi.fsrsReviewLog.v1`、`shizi.funnel.v1`、`shizi.activity.v1`、`shizi.session.v1` | `fsrsEventId`（L1222）、`statusFor`、`activity`、`funnel` | 可抽取改造（原子回滚思路保留） | D06/D19 要求“更正同一记录、不增加次数”。现实现是“整体回滚再重盖”，等价但重；v10 修改入口在结果页格子，故要能对任意已判断字回滚，不止上一枚（见 §5） |
| 撤销条 `hideUndoBar` / `commitUndoWindow` / `renderUndoBar` + `#undoBar/#undoLast` | L2450–L2454、L696、L2665 | 下一张卡顶部显示“「X」已盖「拾到」· 重盖”5 秒；当前卡任何动作（落笔 L2249、点拨 L2558、重写 L2535、撤一笔 L2266、添加 L2887）调用 `commitUndoWindow` 关闭 | `lastStampSnapshot`、`undoFollowTimer` | GRADE_UI | 应重写 | D19：结果行文案“「部」记为写对 · 修改 ›”，只在当前字未落笔时显示，落笔/跳过/看答案后收起，无 5 秒时限；修改入口移到结果页格子。改动清单三“撤销 10 秒时间窗”“横幅一直留到提交”均作废 |
| `stampToastCopy(outcome,m)` | L2455–L2459 | 盖章后 toast 文案（“这次独立写对 · 下次复习：9月3日”等） | 返回 `{title,sub}` | `episodeFor`、`shortDueDay` | 应重写/删除 | v10 判断后直接翻下一字，无 toast 卡；“下次复习日期”对应 D7 待工程确认 |
| `createPracticeWriter()` / `rebuildHintLayer(count)` | L2460–L2478 | 用 HanziWriter 建提示层；`rebuildHintLayer` 用 `loadToken` 防止旧动画串卡，瞬时重放前 count 笔 | `writer`、`hzEl`、`animating`、`loadToken` | HanziWriter、`practiceCharData`、`charLoader`（L2271） | 可抽取改造 | 用 `loadToken` 令牌做异步取消的做法值得保留；D25 提示改成“细暖墨红按笔顺画在书写格里、下一笔时淡出”，不再永久堆叠 |
| `renderPhaseControls()` | L2479–L2484 | 按 `practicePhase` 切换：`#phaseTitle`（“第 1 步：描红/第 2 步：自己写”）、`#traceIntro`、`#actions`/`#traceActions`、`#tip`/`#peekInk`/`#show` 显隐、`#clear` 文案“重描/重写” | DOM | `traceTutorialShown`（`shizi.traceTutorial.v1`） | 应重写 | v10 阶段名：回忆/对照/看答案/描一遍/自己写一遍（原型 titles：“凭记忆写出这个字”“对照一下，写对了吗？”“这个字这样写”“描一遍”“自己写一遍”） |
| `render()` | L2485–L2512 | 换卡总入口：`fitBox`、`displayView("card")`、cardSwapIn 动画、`resetWritingChrome`、首卡 `playRoundOpening`、清计时器/标志、非恢复时清 hint 计数与快照、写题面/副提示（gloss/fallback/校准提示）、`clearInk`、重置提示分组、教学气泡、加载笔顺（2.5s 超时降级 `allowNoStrokeData`）、恢复时 `restoreSessionVisual` | 读 `pendingSessionVisual`；写全部卡片 DOM | HanziWriter、`GROUPS`（部件分组）、`buildPeekWriter`（L2234）、`teachActive`（L2384） | 应重写（保留“恢复标志区分首次渲染与恢复”“加载令牌+超时降级”两点） | 副提示文案（L2498）与 I04/10.13 冲突：v10 笔顺取不到时按钮直接“看答案”，说明句“这个字暂时没有提示，可以直接看答案。”（文案清单 C018） |
| `showTraceOutline()` | L2513–L2521 | 描红阶段用 `showOutline:true` 画轮廓；无数据时 `.traceFallback` 用楷体描边字 | `hzEl`、`writer` | HanziWriter | 可抽取改造 | 10.13/K22：无笔顺时描一遍用“浅色完整字形，不分笔顺”，与 fallback 一致 |
| `restoreSessionVisual()` | L2522–L2533 | 从 `pendingSessionVisual` 恢复：phase、attempt、hint 计数、`seenGroups`、笔迹、`submissionSnapshot`、`shownStrokes/groupIdx`，重建提示层/描红轮廓；若 `revealed` 则 `restoreRevealFromSnapshot`；若 `feedback` 阶段则重放盖章反馈并重新起 1.8s 自动翻页 | 读 visual（见 §3） | `normalizedSessionInkStrokes`、`normalizedSubmissionSnapshot`（L1162）、`redrawInk` | 可抽取改造 | W10 “恢复到离开时的阶段，包括判断页，笔迹和参考字形都在”——现有逻辑已做到（`state.revealed && submissionSnapshot`），是少数可直接映射的部分 |
| `rewriteCurrentCard()` / `undoInkStroke` | L2535–L2542、L2266–L2270 | 重写：清墨、`groupIdx/shownStrokes=0`、重建 0 笔提示层；撤一笔：`actionStack` 混合撤销“笔画/提示组” | `#clear`、`#undoStroke` | `actionStack` | 可抽取改造 | 边开发边改 W17：清空后要给一次撤销（现无）。v10 提示不再需要“撤销提示组”，`actionStack` 可简化为纯笔画栈 |
| 点拨 `#tip`：`armTipHold/releaseTipHold`、`$("tip").onclick`、`pressPeekControl/releasePeekControl`、`updateTip`、`hintVisualExhausted` | L2545–L2573、L2380、L2371 | 轻点：播下一“部件组”（`GROUPS[cur.target]`，无分组则一次给全部笔画 L2506），播放期间墨迹淡到 0.22；`hintsUsedThisCard` 只对首次看到的组 +1；长按 360ms 进入“瞥一眼”完整字形（`PEEK_INK_OPACITY=0.04`）；`#peekInk` 双指/按键同效 | `hintEverUsed`、`hintsUsedThisCard`、`seenGroups`、`actionStack.push({type:"hint"})`；`shizi.tuning.v1` 的 `practiceHintExplained/strokeHintConsequenceShown/peekHintUsed` | HanziWriter `animateStroke`、`enterPeekHint`（L2227） | 与 v10 决定冲突（应重写） | D25/W03/W04：提示按钮显“提示 · 还有 N 次”（原型上限 2 次：`left=2-s.hints`、`if(s.hints>=2) return`），每次接着已写笔数 n 往下给 `q=max(1,round(N/4))` 笔、`from=min(n,N-q)`；无部件分组的字给前 1/前 2 笔；点提示后本人笔迹 35%（原型 `opacity:.35`），下一笔落下提示 260ms 淡出、笔迹恢复。“瞥一眼完整字形”“无分组时一次给全部笔画”是完整答案却叫提示，违反 D04（“完整字不能叫部分提示”），应删除 |
| `showRevealState(snapshot)` | L2574–L2595 | 对照页：左“你写的”（快照 PNG + 失败笔画红标 + `mineEmpty` “这次没写”），右“范字”（骨架/楷体），叠起来对比、看笔顺；`askLine` 系统建议句（`verdictShort` L2365）；按 `verdict` 给 `#decisionCorrect/#decisionWrong` 加 `.suggest` 预选样式；`correctEffect/stampNote` 副文案随 hint/postTrace 变化；校准首卡显教学气泡 | `revealed=true`；DOM `#reveal` | `renderQuality`（L1791）、`verdictShort` | 与 v10 决定冲突 | D03：“不叠字评分、不预选答案”——`.suggest`、`askLine`、失败笔画描红、软确认全部违反；D20：“写错了”在左、“写对了”在右且一样醒目——现 HTML L750–L753 写对在左且是主按钮；“不太确定”第三项 v10 无；`qualityBox`（太简单/太生僻/词不自然/不想练，L767–L771）v10 判断页无 |
| `revealAnswer()` | L2596–L2599 | “写好了”：冷却检查 `actionCooldownUntil`、`freezeSubmissionSnapshot`、`practicePhase="revealDecision"`、`showRevealState`、`hapticFeedback("action")`、`saveSessionSnapshot` | `#done` onclick（L2613） | 上述 | 可抽取改造 | 流程正确：冻结→切阶段→保存。v10 中“写好了”仍是进对照/判断页（C023） |
| `beginTracingPhase` / `openTracingTeaching` / `finishTracing` / `declareDontKnow` | L2600–L2609 | “不会写”：先 `freezeSubmissionSnapshot`（保留本人未完成笔迹）→ `recordOutcome("miss",{teaching:true})` 立即记账 → 描红（轮廓）→“描好了，自己写”→ `postTraceRecall`（隐藏轮廓、清 hint 计数）→ 写好了 → 对照 → 写对记 `teachingComplete`、写错回描红 | `#show`、`#traceDone` | `recordOutcome`、`takeCalibrationComfort` | 与 v10 决定冲突 | D18/K25/W05/W06：v10 无“不会写”，改为“看答案”（先确认“接着想 / 看答案”）→ 立刻记“看过答案”（不算写对写错、不是有效记录、不进写错过/快忘了）→ 看答案页“自己写 / 下一个”→ 可“再描一遍”→ 自己写完按“下一个”直接翻页，不出判断页。现 `miss` 出局并入强化队列、写 FSRS Again 的行为全部作废 |
| `restoreRevealFromSnapshot(state)` | L2610–L2611 | 用快照重放对照页（重盖与恢复共用） | — | `showRevealState` | 可抽取改造 | 结果页“点格子看对照、修改”（D19）需要类似的“从记录重放对照”能力 |
| 对照页交互 `#overlayToggle` / `#replayBtn` | L2615–L2621 | 叠起来对比（在“你写的”上叠参考骨架）；看笔顺（HanziWriter 动画） | — | HanziWriter | 可抽取改造 | v10 对照统一“你的书写在左、参考字形在右”（L08）；叠合/看笔顺属附加功能，未在 v10 页面出现 |
| `reopenStampChoices()` + `#editStamp`/`#undoLast` | L2622–L2624、L2664–L2665 | 重盖：清计时器 → `restoreStampSnapshot` → `render()` → `restoreRevealFromSnapshot({...revealState,softConfirmHandled:false})` → `hapticFeedback("undo")` | — | 上述 | 可抽取改造（回滚部分） | v10 的“修改判断”是弹层“刚才记的是「写对」。改了只换掉这一次，不会多算一次。”（C035/C036）+ 保存失败“没改成，还是原来的判断。”（C034）；不重进写字页 |
| 常量 `STAMP_HOLD_MS=1800, CALIBRATION_FIRST_HOLD_MS=1800, EDIT_STAMP_WINDOW_MS=1800` | L2625 | 盖章后 1.8s 自动翻页；“重盖”按钮 1.8s 后禁用 | — | — | 应删除 | v10 判断后直接推进（W08 只要求 0.4s 防连点），无停留展示 |
| `showStampedFeedback` / `showTeachingCompleteFeedback` / `takeCalibrationComfort` | L2626–L2634 | 在“你写的”上盖章动画（`#stampOnMine` stampIn 关键帧 L58），隐藏判断行，显示 toast 卡（字、表情 blob、标题/副题），启用“重盖” | DOM | GRADE_UI、`episodeFor`（recovered 金环） | 应删除 | 印章体系（拾到/补拾/待补/再拾）在 v10 页面无对应；结果只有“写对/写错/看过答案/跳过”四态 |
| `pickStamp(outcome,options)` | L2635–L2645 | 盖章主流程：`stamped=true` → `takeStampSnapshot` → `recordOutcome` → `practicePhase="feedback"`、`feedbackKind` → 触觉 `stamp` + 音效 `stamp` + 首次音效提示 → 反馈 UI → `maybeOfferHandCard` → 1.8s 编辑窗 → `updateProgressLabel` → `saveSessionSnapshot` → 1.8s 自动 `advanceFeedback` | `#decisionUncertain` 直接 `pickStamp("hinted",{uncertain:true})` | 上述 | 可抽取改造（顺序骨架） | 骨架“先拍照→记账→保存会话→再推进”符合 D07；但 `recordOutcome` 内 `saveMemory()` 失败时并未阻止推进（见 §5） |
| `goNext` / `advanceFeedback` / `decideSubmission` + 判断按钮 + `#reveal` 捕获点击 | L2646–L2666 | `decideSubmission(correct)`：写错先自动叠合对比；postTrace 分支；`correct && 系统判 bad(exact) && 未用提示` → 软确认“这几笔和范字差得比较多，确定算写对？”；否则 `pickStamp(fast/hinted/slow)`。`advanceFeedback`：teachingComplete 直接 `next()`，`miss` 则 `openTracingTeaching`。`#reveal` 捕获阶段监听点击：feedback 阶段点任意处提前翻页 | `#decisionCorrect/#decisionWrong/#decisionUncertain/#compareAgain/#confirmCorrect` | `submissionSnapshot.hintEverUsed`、`lastVerdict` | 与 v10 决定冲突 | D03/D20：判断只有两键；软确认、系统建议、不太确定、点任意处翻页全部删除。判断结果映射：用户点“写对”但用过提示 → 现记 `hinted`（“稍后再练”，FSRS Again）——v10 中“写对了”就是写对，提示次数只是事实字段（原型 `onJudge({verdict,hints,saw})`） |
| 节奏提醒 `roundHasPendingWork` / `roundBudgetReached` / `openRoundBudgetSheet` / `closeRoundBudgetSheet` / `continueAfterBudget` / `pendingTomorrowIndexes` / `deferRoundToTomorrow` + `#roundBudgetSheet` | L2667–L2676、L2681–L2682、L978–L983、L1468 | 非校准组、`attemptSeq>=20` 或用时 ≥6 分钟且仍有待办 → 弹“已经练了 N 次。今天先到这里…”；“明天接着拾”把 manualQueue/强化队列/剩余 base 全部标 `memory[k].queuedFront=true, queuedFrontAt` 排到明天最前，并清会话、`markRoundComplete`、回首页 | `shizi.memory.v1` 的 `queuedFront/queuedFrontAt/pendingLearning/dueDay/due` | `currentRoundElapsed`（L1483，后台停表 L3084） | 应删除 | v10 无此提醒；D22 的“结束这组”是用户主动、先确认、只保留已判断的字（“没写的字不算记录、也不算跳过”）；`deferRoundToTomorrow` 把未写字写进 memory 违反“没写的不算记录” |
| `advanceToNextTarget` / `next` | L2677–L2680 | `nextQueuedTarget()`（manualQueue → 到期强化 → base → 剩余强化，L1473–L1477）取下一题；无则 `roundIsComplete()` → 清会话、`markRoundComplete`、`roundSummary(true)` | — | `beginAttempt`（L1478） | 应重写 | v10 一组是固定队列（首练 5 字），无强化重排；W13：最后一个字判断完直接进结果页 |
| 选字 `chooseFocusBatch` / `compareReviewPriority` / `chooseReviewBatch` / `startRound` | L2683–L2696 | 按模式（new/review/focus/makeup/calibrate）选 `baseTargets`（`BATCH=15`，makeup 5），`queuedFrontPool` 置前；重置全部组状态；`roundId`；`beginAttempt` 第一张；`saveSessionSnapshot`；`armPracticeHistory`；`render` | `shizi.session.v1`；`history.pushState({shiziView:"practice"})` | 选字函数（他人范围） | 应重写（`roundId`/首张 `beginAttempt`/先存后渲染的顺序可留） | D17：第一次练习 5 个字、无校准组/介绍页/首题说明卡（`activeMode==="calibrate"` 整条线作废） |
| 结果页渲染 `sumTile` / `motionReduced` / `REST_LINES` / `roundRestLine` / `renderRoundRestLine` / `renderSummaryMilestone` / `renderPracticePocket` | L2697–L2711 | 字块（旋转 `ROTS`、`tileIn` 动画逐块延迟 0.05s“落下”、右上角结果小点“补/待/再”、底部“独立写对/稍后再练/写错/没写出/已独立”）；题记三句按 `roundId+日期` 哈希；里程碑行；“N 个字第一次没写稳”口袋卡 + “再写一遍” | `#sumTiles`、`#pocketCard`、`#milestoneLine` | GRADE_UI、`OUTCOME_DOT/MARK`（L1725） | 应重写 | v10 结果页：格子可点→对照+修改判断（D19），说明“这次记录了 N 个字，跳过和看过答案的字不算在内。”，格子标题“「X」这次记为写对 / 写错”“「X」看过答案”“「X」跳过了”；无印章图例、无“再写一遍”口袋、无题记 |
| `roundSummary(fromPractice)` | L2712–L2742 | 组末：记 funnel 组时长、清会话、`markRoundComplete`、释放历史栈、里程碑、`displayView("summary")`、大章 `--seal-delay`（字块数×0.05+0.5s 后落章并触觉）、校准组走 `#calibCard`（T4 教学结果页）；否则 `#sumSheet`：标题“今日已拾 N 字/今日拾得/补帖已盖”、导语、口袋、`renderRoundTune`（难度反馈）、备份提示、“再写一组/继续复习（今日还可 N）” | `#summaryShare` 文案“存为字帖/存为里程碑字帖” | `celebrate*Milestone*`、`maybeFinishCalibration`、`renderRoundTune`（L1751） | 应重写 | 大章/字块落下/图例/题记均为第八稿视觉；D20 去掉中间页；D6（难度反馈是否影响选字）待工程确认、确认不了就删；“存为字帖”→ v10 叫“这次的图片”（文案清单零节） |
| `allDone()` | L2743–L2750 | 无可练字时的结果页变体（“今天的字都练完了”） | — | `memoryCount/stableCount/highRiskCount` | 应重写 | v10 对应 W12-f “现在没有要写的字 / 想接着写，可以自己选几个字。” |
| 结果页按钮 `#more/#stop/#calibDone/#calibAgain/#pocketBtn/#calibPocketBtn/#summaryShare/#calibShare` | L2751–L2759 | 再写一组 = `startRound`；回首页/补写回日历；口袋 = `startFocus`；分享 = `sharePracticeCard`（L2978：原生 `sharePracticeCard` 消息 → Web Share → 下载） | `{type:"sharePracticeCard",name,dataURL}` | `renderPracticeCardCanvas`（L2955） | 可抽取改造（分享三级降级） | 图片版式由 v10 A05/T06-C 另定；`renderPracticeCardCanvas` 画的是印章/图例版式，需重做 |
| `exitCurrentRound(fromHistory)` + `#exitPractice` + `shizi-native-back` + Escape | L2760–L2775 | 返回：先关弹层；`saveSessionSnapshot()` 失败 → 留在写字页、若来自 history 则 `history.forward()` 复原、toast“进度暂时无法保存”；成功 → 取消异步、释放历史栈（或标记）、单字 focus 组清会话回来源视图，否则回首页。原生返回事件先按弹层/面板优先级处理，最后落到退出练习 | `window` 事件 `shizi-native-back`；`focusReturnView` | `armPracticeHistory/releasePracticeHistory/popstate`（L1768–L1778） | 可直接复用（思路）/可抽取改造 | 完全符合 D07“保存成功才推进；失败留现场”与交接备注 §三“写字页没有离开确认；返回即保存”。边开发边改 W18 要求回首页轻提示“已保存，下次接着写” |
| 其余段内处理器 `#qualityBox/#sumTiles/#calibSumTiles/#roundTune/#memoryWall…` | L2778–L2781 | 质量反馈、结果字块点开单字详情、难度反馈 | `recordQuality`（L1794）、`openCharSheet`（L1989） | — | 结果字块→详情：可抽取；qualityBox：应删除 | v10 结果页格子点开的是“对照 + 修改判断”弹层，不是单字详情 |
| 支撑：`recordOutcome(outcome,options)` | L1812–L1846 | 唯一记账点：按 `attemptId` 幂等；更新 memory（seen/last/lastOutcome/lastHints/traced/ease/fast/slow/hints/misses/streak/lastSystem*）、status（rest/indeck）、FSRS（Good/Again）、episode.attempts、roundStats 首次行、missedThisRound、baseCursor/sessionDone/attemptSeq、强化队列进出、`recentInk`（仅非 hard）、`roundHandwriting`、`saveMemory`、`markPracticeStamp`（activity） | 见 §3 | `applyFSRSReview`（L1224）、`persistRecentInk`（L1807）、`markPracticeStamp`（L1284） | 应重写（保留幂等与 attemptId 思路） | 四态 outcome 与 v10 记录语义不符：v10 有效记录只有 写对/写错；看过答案、跳过是事件但不是有效记录（D23）；提示次数、是否描过是事实字段而非结果等级 |
| 支撑：`beginAttempt` / `nextQueuedTarget` / `roundIsComplete` / `capturePracticeVisual` | L1473–L1482 | attempt 生成 `${roundId}-a${attemptSeq+1}-${currentIndex}`；队列取题；组完成判定排除中间阶段 | — | — | `attemptId` 可直接复用；队列应重写 | — |
| 支撑：会话快照 `sessionPayload` / `saveSessionSnapshot` / `clearSessionSnapshot` / `restoreSession` / `decodeSessionV3` | L1483–L1538 | v3 载荷用 `cardKey` 编码所有索引（`storedCardRef`），解码失败即隔离（`quarantineStoredKey`）；单字 focus 组不存会话；恢复时若组已完成直接进结果页 | `shizi.session.v1` | `indexForCardKey`（L1390） | 可直接复用（编码/校验思路）；字段应按 v10 精简 | — |
| 支撑：灶台模式 `WRITING_CHROME_SELECTOR` / `setWritingChromeHidden` / `enterWritingChrome` / `exitWritingChrome` / `finishWritingChrome` / `resetWritingChrome` / `playRoundOpening` | L2177–L2187、CSS L188–L195、L627 | 落笔（`inkBegin` L2288）→ 若 `tuning.chromeFadeSeen` 则 `#card.writing`：题面/提示/按钮 opacity 0 + `inert` + `aria-hidden`；抬笔后 2s 恢复；首次完成一笔才设 `chromeFadeSeen`；换卡/揭晓/退出 `resetWritingChrome`；首卡 `paperReveal` 纸张揭开动画 0.36s（`roundOpeningPending` 由 `startMode/startFocus` 置 true） | `shizi.tuning.v1.chromeFadeSeen` | — | 可抽取改造 | v10 页面/交互表未提“书写时 chrome 退场”；W15/V02 要求按钮区必须在第一屏、书写格尺寸点提示前后不变。若保留需与 W08 0.4s 防连点、结果行“落笔即收起”协调；`inert` 在 iOS Safari 旧版本支持不全 |
| 支撑：画布指针 + 冷却 `lockGradeActions` / `armGradeActions` / `actionCooldownUntil` | L2248–L2257、L2259–L2261、L2224 | 落笔时 `lockGradeActions`（`actionCooldownUntil=∞`、`#actions.tlock`），抬笔后 300ms 解锁；双指进入瞥一眼；`getCoalescedEvents` 采样 | — | — | 可抽取改造 | v10 的防连点是另一方向：新状态出现后 0.4s 按钮不响应（W08，原型 `arm()`）、换字后 0.3s 书写格不接受落笔（V01，原型 `penArm()`，用事件 `timeStamp`）。现有“落笔锁按钮、抬笔 300ms”是防误触判断，可并存但需重写 |
| 支撑：触觉/音效 `hapticFeedback` / `soundFeedback` / `noteSoundTip` | L1378–L1381、L1339–L1341、L1375 | 触觉种类 `select/action/stamp/undo/milestone`，原生桥 `{type:"haptic",kind}`，否则仅 stamp/milestone `navigator.vibrate(10)`；音效 `stamp/paper`（描红落笔纸声），原生 `{type:"sound",kind}` 或 WebAudio | `shizi.sound.v1` | `reminderBridgeAvailable`（L1383） | 可直接复用（桥接层） | 调用点需随流程重排：`stamp` 触觉/音效在 `pickStamp`（L2639）；`action` 在 `revealAnswer`（L2598）与结果页落章（L2717）；`select` 在点拨/不会写（L2558、L2603）；`undo` 在重盖（L2624） |
| 支撑：历史栈 `armPracticeHistory` / `releasePracticeHistory` / `popstate` | L1768–L1778 | 进练习时 `replaceState({shiziView:"home"})` + `pushState({shiziView:"practice"})`；浏览器返回 → 先关弹层（并 `history.forward()` 复原栈），否则 `exitCurrentRound(true)`；退出/组末 `releasePracticeHistory` 回退一格并用 `restoringPracticeHistory` 吞掉自触发 popstate | `history.state.shiziView` | — | 可直接复用 | v10 要求页面切换用 iOS 原生方式含左边缘右滑返回（交接备注 §十/§九.1）——在 WKWebView 壳内由原生处理，此 Web 历史栈仅 PWA 兜底 |

## 3. 数据契约

### 3.1 会话快照 `shizi.session.v1`（v3，L1498–L1501）
```
{ version:3, startedDate:"YYYY-MM-DD", updatedAt:ms,
  activeMode:"new"|"review"|"calibrate"|"focus"|"makeup", makeupTargetDay:"",
  baseTargetKeys:[cardKey...], baseCursor:int, currentCardKey, currentAttemptKind:"base"|"manual"|"repeat"|"reinforcement", currentAttemptId,
  manualQueue:[{cardKey,kind}], reinforcementQueue:[{cardKey,eligibleAfter,order}], unresolvedKeys:[], episodeRows:[episode…], attemptSeq,
  practicePhase, visual:<visual>, missedThisRound:[target…], roundStats:[<roundStat> 去掉 handwriting], focusKeys, sessionDoneKeys,
  sessionTarget, sessionFastStreak, sessionMissStreak, roundFeedbackGiven, roundId, calibrationFirstHoldUsed, calibrationComfortShown, calibrationTargetKeys,
  lastStampSnapshot:<storedStampSnapshot>|null, feedbackKind:""|"fast"|"hinted"|"slow"|"miss"|"teachingComplete",
  roundElapsedMs, roundBudgetPrompted, roundStartMemoryCount }
```
- `cardKey = (custom?"custom:":"base:") + target`（L1541）；解码时任一引用解不开即整份隔离（L1527–L1530）。
- 保存时机（`saveSessionSnapshot` 调用点）：startRound（L2696）、每笔抬笔 `inkEnd`（L2292）、撤一笔/重写（L2268–L2269、L2539–L2540）、点拨完成（L2572）、写好了（L2598）、进描红/描完（L2602、L2605）、盖章后（L2644）、软确认（L2655）、teachingComplete（L2653）、continueAfterBudget（L2671）、advanceToNextTarget（L2678）、插题（L2156）、页面隐藏（L3085）、退出（L2765）。单字 focus 组不落盘（L1502）。
- 清除：组完成（L2679、L2712）、退出单字组（L2771）、明天接着拾（L2676）、startMode/startFocus（L1968、L1970）。

### 3.2 `visual`（`capturePracticeVisual` L1481–L1482；存储时 `currentIndex→currentCardKey` L1491）
```
{ practicePhase, currentIndex, currentAttemptKind, currentAttemptId, hintEverUsed, enteredTracingThisAttempt, hintsUsedThisCard,
  shownStrokes, groupIdx, seenGroups:[int], inkStrokes:[[{x,y,t?,p?,w?,v?}…]…], tracedThisCard, submissionSnapshot:<snapshot>|null, revealed, stamped }
```
笔迹点：`{x,y}` 画布像素坐标（画布尺寸 `S`），`t` 事件时间戳，`p` 仅 pen 压力，`w` 宽度倍数，`v` 速度（L2194、L2288–L2289、L1154–L1157）。

### 3.3 提交快照 `submissionSnapshot`（L2429–L2430，冻结）
```
{ target, idx, attemptId, createdAt, canvasSize:S, hintStrokeIds:[int], hintCount, hintStrokes:[[pt]], inkStrokes:[[pt]], referenceStrokes:[[pt]],
  compositeGeometry:[...hintStrokes,...inkStrokes], compositeImage:"data:image/png;base64,…"|null, hintEverUsed, enteredTracing, practicePhase,
  lastVerdict:{status:"ok"|"bad", mode:"exact"|"holistic", u, t, failed:[int], missing}|null, userCorrect:null|bool, softConfirmHandled? }
```
规范化 `normalizedSubmissionSnapshot`（L1162–L1169）：几何不合法则 `lastVerdict=null`、`compositeImage=null`（图片上限 2 MiB）。

### 3.4 盖章快照 `lastStampSnapshot`（`takeStampSnapshot` L2433–L2437；`storedStampSnapshot` L1492–L1495）
```
{ position, baseCursor, currentIndex, currentAttemptKind, currentAttemptId, practicePhase, attemptSeq, idx, key, target,
  statusValue, memoryValue:<memory row clone>, fsrsEventId:`${attemptId}:fsrs`, activityKey:"YYYY-MM-DD", activityValue:<daily row>, activityHadPracticeDay,
  funnelSeenLength, funnelEventsLength, funnelCountsValue, funnelEventCountsValue, roundHandwritingValue,
  baseTargetsValue, manualQueueValue, queueValue, unresolvedValue, episodesValue, sessionDoneValue, roundStatsValue, missedValue,
  sessionTarget, sessionFastStreak, sessionMissStreak, calibrationFirstHoldUsed, calibrationComfortShown, revealState:<submissionSnapshot>, outcome }
```

### 3.5 组内统计 `roundStats[]`（L1836）与 `episodes`（L1470、L1834）
```
roundStat: { idx, target, word, outcome:"fast"|"hinted"|"slow"|"miss", uncertain, geometryStatus, geometryMode, traced, hintUsed, level, topic, dueDay, independentlyRecovered }
episode:   { idx, firstOutcome, attempts:[{attemptId, seq, outcome, userCorrect, uncertain, hintUsed, hintCount, enteredTracing, teaching, eventId, at}], assistanceUsed, independentlyRecovered, excluded, teachingComplete }
```
`roundHandwriting[String(idx)]` = `shareInkFromSnapshot` 归一化到 0–1 的笔迹（≤48 笔×48 点，L1801–L1803），仅内存。

### 3.6 记忆行 `shizi.memory.v1[cardKey]`（`cardMemory` L1630 + `recordOutcome` L1815–L1846 + FSRS L1229–L1231）
`seen, firstSeenAt, streak, ease, fast, slow, hints, misses, due, dueDay, last, lastOutcome, lastHints, traced, lastSystemSuggestion:""|"correct"|"wrong", lastSystemStatus, lastSystemAgree, topic, band, word, target, missedOn, pendingLearning, queuedFront?, queuedFrontAt?, fsrsCard, schedulerVersion, parameterVersion, schedulerTimeZone, lastEpisode:{firstOutcome,attempts,assistanceUsed,independentlyRecovered,teachingComplete?}, recentInk:{version:2, day, at, dataURL(webp ≤32KiB), strokes}`。`recentInk` 总量受 `RECENT_INK_MAX=96 / RECENT_INK_BUDGET=420KiB` 裁剪（L1144、L1178）。状态 `shizi.deck.v8105.context2[cardKey] = "rest"|"indeck"`（L1143、L1826–L1829）。

### 3.7 FSRS 事件 `shizi.fsrsReviewLog.v1.events[]`（L1231–L1233）
`{ eventId:`${attemptId}:fsrs`, attemptId, cardKey, target, reviewedAt ISO, localDay, rating:"Good"|"Again", reason:"independent"|"hinted"|"wrong"|"dontKnow", hintCount, traced, teaching, plannedDue, actualIntervalDays, scheduledDays, schedulerVersion, parameterVersion, desiredRetention, maximumInterval, timeZone }`。重盖时按 `eventId` 过滤删除（L2442）。

### 3.8 活动 `shizi.activity.v1.daily[YYYY-MM-DD]`（L1281–L1287）
`{ stamps, attempts, targetKeys[], independentTargetKeys[], reviewTargetKeys[], completedRoundIds[], completedGroups, makeup, lastStampAt, firstCompletedAt }` + `activity.practiceDays[]`。首枚章 `syncReminder()`（L1285）。

### 3.9 漏斗 `shizi.funnel.v1`
`seen` 含 `reveal:${attemptId}`（L1257）、`round:${roundId}`（L1258）、`calib_card1_done`；`counts.revealCompared/revealDisagree`；`events[{name,at,day}]`；`rounds[{completedAt,day,mode,durationMs,targetCount,attemptCount}]`。

### 3.10 其他键与消息
- `shizi.tuning.v1`：`chromeFadeSeen`、`practiceHintExplained`、`strokeHintConsequenceShown`、`peekHintUsed`、`calibrated`（L2182、L2545、L2571、L2229）。
- `shizi.traceTutorial.v1`：bool（L1115、L2291）。`shizi.handCard.v1.lastPromptDay/promptEnabled`（L2953）。`shizi.sound.v1.enabled/scene/tipShown`。
- `history.state = {shiziView:"home"|"practice"}`（L1769）。
- 原生桥 `window.webkit.messageHandlers.shiziNative.postMessage`：`{type:"haptic",kind}`、`{type:"sound",kind}`、`{type:"soundscape",kind}`、`{type:"sharePracticeCard",name,dataURL}`；回调 `window.shiziCardSaved(result)`（L2954）；原生返回 `window` 事件 `shizi-native-back`（L2774）。
- `actionStack[]`：`{type:"stroke"}` | `{type:"hint",group,n,start}`（L2291、L2570）。
- `GROUPS[target]`：部件分组笔画数数组，需与 `totalStrokes` 之和相等才启用（L2506）。

### 3.11 v10 原型给出的（供对照的）接口形状（`shizi-v10-交接版.html` 内嵌 ShiziWriteScreen）
- `onJudge({i, c, verdict:"right"|"wrong", strokes, hints, saw})` 返回 `{id}` 或失败；失败 → `phase:"saveFail"`, `pend:{t:"judge",v}`，按钮“再试一次”。
- `onSaw({i, c, hints})` 在确认看答案的那一刻调用一次（K25）；之后 `next(null,true)` 只翻页。
- `onSkip` → `next(null)`，不产生记录；`onCorrect(last, newVerdict)` 修改判断；`onEnd(snap, confirmed)` 结束这组；`onStateChange(snap)` 每次状态变化保存（W10）。
- 组件 state：`{ci, phase:"recall"|"compare"|"answer"|"trace"|"retrace"|"done"|"saveFail", hints(≤2), used, saw, strokes, hr:{from,to}, dim, hout, line:"record"|"changed"|"saw"|null, last:{ci,c,verdict}, cnt}`。

## 4. 与第十稿（v10）决定的关系

### 4.1 保留（思路可用，代码需按新状态机重接）
- **保存成功才推进 / 失败留现场**（D07）：`exitCurrentRound` 的 `saveSessionSnapshot()` 失败分支（L2764–L2767）；`pickStamp` 先 `takeStampSnapshot` 再记账再存会话（L2636–L2644）。v10 补充：判断/结束保存失败时按钮“再试一次”、说明“没保存上，你写的字还在。”（文案清单零节、C017），结束这组保存失败留在写字页、重试成功后再结束（10.10）。
- **恢复到精确阶段**（W10）：`restoreSessionVisual` 已能恢复 `revealed`（判断页）与笔迹/参考字形（L2528–L2531）；会话 v3 的 `cardKey` 编码与解码校验（L1484–L1530）可沿用。
- **更正同一记录、不增加次数**（D06 保留部分/D19）：`attemptId` 幂等（L1813、L1225）与 `restoreStampSnapshot` 的多存储回滚（memory/status/FSRS/activity/funnel/roundStats）是可抽取的原子性基础。
- **异步取消令牌** `loadToken`（L2467–L2478、L2485）：v10 提示动画/换字仍需要。
- **原生桥**：触觉/音效/分享/返回事件（L1339、L1378、L2978、L2774）。
- **历史栈兜底**（L1768–L1778）：PWA 场景保留；壳内以原生左滑返回为准。

### 4.2 改变（v10 明确改写）
| 现有行为 | v10 决定 |
|---|---|
| 进度“已练 3 / 15 个 · 另有 2 个字要再练”（L2403） | 右上角一律 “3 / 5”（D17/W12/K26） |
| 首次进校准组 15 字 + 首卡教学气泡（`teachActive` L2384、L2500）+ 校准结果页 T4（L2732） | 第一次练习 5 个字；去掉介绍页和首题说明卡（D17）；首页“开始写字”直接进写字页 |
| 点拨按部件组逐笔播放、长按“瞥一眼”完整字形、无分组一次给全部（L2558–L2573、L2506） | 提示按钮“提示 · 还有 N 次”（上限 2），每次接着已写笔数给约 N/4 笔（≥1），无分组给前 1/前 2 笔；点提示后本人笔迹 35%，提示细暖墨红按笔顺画在书写格里，写下一笔时提示淡出、笔迹恢复（D25/W03/W04；方案②不做） |
| “不会写”→ 记 miss（FSRS Again）→ 描红 → 自己写 → 判断（L2606–L2609、L2650–L2653） | “看答案”先确认（“接着想 / 看答案”）→ 直接记“看过答案”，不判断写对写错、不是有效记录；之后描一遍/自己写只是练习，按“下一个”翻页（D18/K25/W05/W06/X01） |
| 判断页：写对（左、主）/写错（右、ghost）+ 不太确定 + 系统建议预选 `.suggest` + 软确认 + 质量反馈（L750–L771、L2589–L2594、L2654） | 只有“写错了”在左、“写对了”在右且一样醒目；左上“接着写”回书写格、未判断不算记录（D20/K31/W09）；不预选（D03） |
| 盖章 1.8s 停留 + toast 卡 + “重盖” 1.8s 窗 + 下一卡 5 秒撤销条（L2625–L2645、L2452） | 判断后直接下一字；上一字结果行“「部」记为写对 · 修改 ›”只在当前字未落笔时显示，落笔/跳过/看答案后收起；修改入口移到结果页格子（D19/W11/W14/X01/X02） |
| 重盖 = 回滚并重进对照页（L2622–L2624） | 结果页点格子 → 对照 + “修改判断”弹层，“刚才记的是「写对」。改了只换掉这一次，不会多算一次。”（C035/C036） |
| 20 次/6 分钟节奏提醒、“明天接着拾”把未写字写入 memory（L2668–L2676） | 去掉；改为“结束这组”（跳过右边，仅“这次选的字”组有）先确认“还有 N 个字没写，结束后就不写了。判断过的 M 个字已经记下。”→ 已判断保留、没写的不算记录也不算跳过；零判断回来源并轻提示“这组结束了，没有记下字。”（D22/10.10） |
| 组末 `roundSummary` 印章/字块落下/图例/大章/题记/口袋/难度反馈（L2712–L2742） | 最后一个字判断完直接进结果页（W13）；结果页格子按“写对/写错/看过答案/跳过”四态，说明“跳过和看过答案的字不算在内。”；D6 难度反馈待确认、确认不了就删 |
| 落笔锁按钮、抬笔 300ms 解锁（L2249、L2257、L2260） | 新页面/新状态出现后 0.4s 按钮不响应；换字后 0.3s 书写格不接受落笔；按事件 `timeStamp` 判断（W08/V01） |
| 无笔顺数据：副提示“这个字暂未收录笔顺，仍可点「写好了」自行判断”（L2275、L2503） | “这个字暂时没有提示，可以直接看答案。”；看答案显完整楷体、照实记看过答案；描一遍用浅色完整字形不分笔顺（I04/10.13/K22/C018–C020） |
| “存为字帖”（L2725–L2726） | “这次的图片”（文案清单零节；版式按 A05/T06-C） |

### 4.3 删除（v10 明确移除的行为，逐条）
1. 四枚印章 拾到/补拾/待补/再拾 及 `GRADE_UI/OUTCOME_DOT/OUTCOME_MARK`（L1719–L1725）——结果只剩写对/写错/看过答案/跳过。
2. 系统几何比对结果参与 UI：`askLine` 建议句、`.suggest` 预选、失败笔画描红、软确认“这几笔和范字差得比较多，确定算写对？”（L2589–L2594、L2419、L2654–L2655、L755–L757）——D03。
3. “不太确定”第三选项（L754、L2661）。
4. 质量反馈 `#qualityBox`（太简单/太生僻/词不自然/不想练，L767–L771、L2778）从判断页移除（“换掉这个词语”在 v10 属单字详情 C046）。
5. 盖章停留 1.8s、toast 卡、点任意处翻页（L2625、L2666）。
6. “重盖”按钮 1.8s 窗与 5 秒撤销条（L2450–L2454、L2622–L2624、L2664–L2665、L696、L765）——改动清单三“撤销 10 秒时间窗”“横幅一直留到提交”作废。
7. 长按“瞥一眼”完整字形、双指瞥一眼、`#peekInk`（L2546–L2557、L2227–L2233、L708）——完整字形只能叫“看答案”（D04）。
8. “不会写”按钮及其 miss 记账/描红教学两步（L715、L2606–L2609、L2600–L2605）；描红 `paper` 音效随之无调用点。
9. 强化队列 `reinforcementQueue/unresolved/eligibleAfter+2`、`manualQueue` 重排、`adaptNextCard` 组内动态换题（L1471–L1477、L1671–L1678）——v10 组是固定队列。
10. 20 次/6 分钟节奏弹层与“明天接着拾”（L978–L983、L2667–L2676）。
11. 校准模式全部：`activeMode==="calibrate"`、`teachStage`、`#teachBubble/#teachBubbleGrade`、`CALIBRATION_FIRST_HOLD_MS`、`takeCalibrationComfort`、`#calibCard`（L2384–L2399、L703、L747、L2634、L778–L811）。
12. 结果页字块落下 `tileIn`、大章 `bigSeal/inkBloom`、题记 `REST_LINES`、口袋卡“再写一遍”、里程碑行、难度反馈 `roundTune`（若 D6 不成立）、备份提示、“今日已拾 N 字”标题（L2697–L2742、CSS L62、L281–L285）。
13. 副提示中的说明性文案：“先写一组，之后会按你的情况调整难度”“用了提示，这个字本组稍后还会再写”“轻点看下一笔，按住瞥一眼完整字形”（L2498、L2571–L2572、L2545）。
14. `hinted` 语义（用过提示即“稍后再练”、FSRS Again）：v10 用户判断写对就是写对，提示次数只是事实字段。
15. “这一组写完了”中间页与“查看这次练习”——现代码本就没有中间页，但 `roundSummary` 承担的过渡角色按 W13 直接进结果页。

## 5. 风险与坑

1. **记账不受保存失败阻断**：`recordOutcome` 里 `saveMemory()`（L1846）、`applyFSRSReview` 的 `saveFSRSLog()/saveMemory()`（L1233）、`markPracticeStamp` 的 `saveActivity()` 返回值都被忽略；`pickStamp` 无论保存成败都进 `feedback` 并 1.8s 后翻页（L2639–L2645）。只有 `exitCurrentRound` 检查了 `saveSessionSnapshot()`。D07/v10 2.6 要求判断“等保存成功再推进”，需要把“多键写入”收敛成一次事务（或至少先写后推进、失败留在判断页并可重试）。
2. **多键非原子写入**：一次盖章顺序写 memory → fsrsReviewLog → memory → activity → deck(status) → funnel → session，共 5–7 个 localStorage 键；中途配额满（`QuotaExceededError`，L1067）会留下半成品。`restoreStampSnapshot` 只能回滚“上一枚”，且依赖内存中的 `lastStampSnapshot`（刷新后 `restoreSession` 置 `lastStampSnapshot=null` L1536，虽然会话里存了 `storedStampSnapshot`，但并未还原成可重盖状态）。
3. **重盖回滚的漏项**：`restoreStampSnapshot` 不回滚 `memory[k].recentInk`（包含在 `memoryValue` 整行克隆里，实际会回滚，但 `trimRecentInk` 可能在此期间淘汰了别的字的 recentInk，无法还原）；不回滚 `handCardPref.lastPromptDay`（L2953）；不回滚 `syncReminder` 可能已发给原生的提醒计划（只是重算）；不回滚 `tuning.*` 的首次提示标志。
4. **同一 attempt 幂等但重试不安全**：`recordOutcome` 以 `ep.attempts.some(a.attemptId===currentAttemptId)` 早退（L1813），但早退前 `attemptSeq`、`baseCursor` 已在首次成功时推进；若首次“部分写入失败”后用户重试，第二次会被当作已记录直接返回，无法补写缺失的键。
5. **`restoreSession` 直接进结果页**（L1537）：组已完成但会话未清时，恢复会 `markRoundComplete()` + `roundSummary()`，`roundSummary` 又 `recordFunnelRound`（有 `round:${roundId}` 去重）——安全，但 v10 结果页需要 roundStats 的“看过答案/跳过”行，现 roundStats 只在 `recordOutcome` 首次记账时 push（L1836），跳过/看过答案没有行。
6. **`compositeImage` 体积**：每次提交在会话与盖章快照里各存一份 PNG dataURL（≤2 MiB，L1169），加 `revealState` 又一份；`saveSessionSnapshot` 每笔抬笔都全量 JSON 序列化（L2292），大字号画布（S 可达 ~345+）下有明显主线程开销与配额风险。v10 只需几何（W10），应删图。
7. **`checkInk` 仍在提交时运行**（L2428）：纯 CPU 几何，笔数多时 O(u·t·N)；虽只作建议，v10 不展示，可整段去掉（保留为离线分析也需要移出主线程）。
8. **HanziWriter 异步动画竞态**：点拨 `for…await animateStroke`（L2565）依赖 `token!==loadToken||revealed` 中断；`rebuildHintLayer` 在 `revealed` 时也会放弃（L2473）。换卡时若旧动画未中断会把笔画画到新卡（代码注释 L2564 已说明）。v10 提示改为一次画 q 笔并在下一笔淡出，仍需令牌。
9. **`inert` 与 `aria-hidden` 的灶台模式**（L2179–L2181）：iOS Safari 15.5 之前不支持 `inert`；`focused.blur()` 会在 VoiceOver 下丢焦点。2 秒后自动恢复，与 W08“新状态出现 0.4s 内按钮不响应”叠加时可能出现“按钮已可见但不可点”的窗口。
10. **冷却语义冲突**：现有 `actionCooldownUntil` 在落笔时设为 ∞、抬笔 300ms 后清零（L2224、L2259–L2261）；`declareDontKnow/revealAnswer/openTracingTeaching` 都检查它（L2597、L2603、L2606）。v10 的 0.4s/0.3s 用事件 `timeStamp` 计（原型 `arm()/penArm()`），且“换字后 0.3s 不接受落笔”是新增而现代码没有。
11. **`practicePhase="between"` 期间的保存**：`next()` 先置 `between`（L2680）再 `advanceToNextTarget` → `beginAttempt` 置回 `recall`；若在 `between` 时触发 `visibilitychange` 保存（L3085），会话 phase 为 `between`，`restoreSession` 用 `practicePhase||"recall"`（L1533）能接住，但 `roundIsComplete` 把 `between` 视为可完成（L1480）。
12. **单字 focus 组不落盘**（L1502）：从字库/详情“练这个字”进来的单字组刷新即丢；v10 “这次选的字”组（B 组）要求可暂停续练（D05），需要会话支持第二槽位。
13. **`deferRoundToTomorrow` 写脏 memory**（L2675）：未写的字被标 `pendingLearning=true, dueDay=null, queuedFront=true`，等于“制造了记录”（`seen` 虽未加，但 `cardMemory()` 会创建行，`memoryCount()` 只数 `seen`，字库“有记录”口径若改用行存在会算错）。v10 删除该功能时要迁移/清理这些字段。
14. **`#reveal` 捕获阶段点击拦截**（L2666）：在 feedback 阶段 `stopPropagation` 会吞掉 `#editStamp` 以外所有点击（含 `#qualityBox`）。
15. **`hapticFeedback` 在 PWA 下只对 stamp/milestone 震动**（L1380），且 `navigator.vibrate` 在 iOS Safari 不存在；v10 触觉点位需重定（判断、看答案、结束这组）。
16. **`playRoundOpening` 依赖 `roundOpeningPending`**（L2186–L2187），只由 `startMode/startFocus` 置 true（L1968、L1970），恢复会话不播——符合“恢复不重播动画”，但 `render()` 的 `restoring` 分支还会 `area.classList.remove("opening")`，两处逻辑重复。
17. **`GROUPS` 部件分组只覆盖演示字**（决定表待定项“部件分组来源、覆盖…”）；现代码 `groups=[totalStrokes]` 兜底会一次给全字（L2506），v10 明确“没有部件分组的字按前 1/前 2 笔”。
18. **`insertIntoCurrentBatch` 在盖章反馈期间的暂停/续播**（L2887–L2890 `feedbackPausedForAdd`，200ms 后续播）与 `lastStampSnapshot=null` 直接清空撤销能力——v10 无此交互，但“添加自选的字”改为字库组件（D21），写字页内不再有 addSheet。

## 6. 未解问题

1. v10 的“有效记录”（写对/写错）之外，“看过答案”“跳过”事件要不要进 FSRS/调度？决定表待定项“跳过的正式排除范围与何时再次出现”（#162/#170）未定；现 `recordOutcome` 无对应分支。
2. 结果页格子“修改判断”要能改本组任意一个已判断字：需要每字保留可回滚快照（现只有 `lastStampSnapshot` 一枚），还是改成“按 attemptId 就地改写 memory/FSRS 事件”？后者需要 FSRS 重算（`fsrsCard` 是链式状态，改中间一次评级需从该字更早状态重放）。
3. W04“正式版怎么判断已经写对了哪几笔”待工程评估（04-v10-handoff §四）；现 `checkInk` 的 exact 模式给出 `failed` 笔序，是否用它决定提示起点？做不到时退回“按已写笔数”。
4. 提示上限：原型硬编码 2 次（`left=2-s.hints`），文案“提示 · 还有 2 次”。产品文档只写“提示按钮写剩几次”，未明说总次数——按 2 实现还是按笔画数换算？
5. D25 提示“细暖墨红”具体颜色/宽度令牌、35% 是否受深色主题影响（边开发边改 W23 深色提亮），主画布令牌表在设计项目里，本仓库没有。
6. 灶台模式（书写时 chrome 退场）在 v10 页面/交互表里没有出现，是删除还是保留为现有实现细节？若保留，与 W15“按钮区必须在第一屏”不冲突，但要定 0.4s 防连点与 2s 恢复的关系。
7. 现有 `hinted` 记录（用过提示但用户判对）迁移到 v10 的“写对 + hints=n”后，历史 `memory.hints/lastOutcome="hinted"` 与 FSRS Again 事件如何解释；D15 允许必要数据调整，但需明确规则。
8. `activeMode` 五种模式（new/review/calibrate/focus/makeup）在 v10 里只剩“今天的练习（A）/这次选的字（B）”两槽（D05）；review 的每日预算 30（`DAILY_REVIEW_BUDGET` L1462）、makeup 补写（D24 去掉补记）是否整段删除，需产品确认与 D05 的组隔离规则一起排。
9. W10 恢复到判断页时，`restoreSessionVisual` 若原 `feedback` 阶段（盖章后 1.8s 内退出）会重放盖章并再起计时器（L2531）；v10 无此阶段，但需定义“判断已保存但还没切到下一字”这一瞬间的恢复目标（直接进下一字即可？）。
10. 触觉/音效在 v10 的触发点（判断、看答案、跳过、结束这组、结果页出现）未在交接文档中列出；现有种类 `select/action/stamp/undo/milestone` 与原生桥的映射是否沿用。
