# C · index.html 画布、笔锋渲染器、Hanzi Writer 接入、点拨/描红、自动比对

> 范围：`/Users/orange/Documents/ChatGPT/astraworld/shizi-app/index.html` 的「画布 / 笔顺」（2159–2282）、「写后自动比对」（2284–2369）、「教学」（2382–2398），以及流程段里直接驱动画布的函数（2405–2621）、写字区 CSS（125–213）与 HTML（698–720）。对照物：`docs/design/v10/交接备注-第十稿交接版.md` 八.1–2、`docs/handoff/decisions.md` D09/D10/D17/D18/D25、`docs/product/04-v10-handoff.md`，以及原型笔迹管线 `docs/design/v10/extracted/ink-第十稿交接版.js`（下称 **SZInk**）。所有行号均指当前 `main`（639f592）。

## 1. 概览

写字区是一个 `div.box`，里面从下到上叠四层：`canvas.gridc`（米字格）、`div.hz`（Hanzi Writer 的 SVG，点拨/描红层）、`div.peekHz`（第二个 Hanzi Writer，按住瞥用）、`canvas.inkc`（用户墨迹）（`index.html:2238-2246`、CSS `141-148`）。四层边长同为 `S`（190–330 CSS px，`idealBoxSize` 2165–2169），两张 canvas 按 DPR 放大。指针输入只挂在 `inkCanvas` 上（2249–2258），走 PointerEvent + `getCoalescedEvents`，双指按下进入「瞥一眼」而不是 palm rejection。笔锋渲染器是一套纯函数（`brushWidthFor`/`brushStrokeGeometry`/`paintBrushStroke` 等，2196–2222）：速度→宽度、Pencil 压感优先、首尾锥形、飞白（`destination-out` 虚线擦）、洇墨（径向渐变），每笔先画到独立透明层再合成。笔顺数据是同源 `data/<字>.json`（hanzi-writer-data 2.0.1 格式，7296 个文件），由 `charLoader`（2271–2274）经 `fetch` 取，离线靠 `sw.js` 缓存优先策略兜底，页面侧没有重试，只有 2.5 s 的「加载较慢」放行（2510）。点拨用 `writer.animateStroke(i)` 按 `GROUPS`（`deck-data.js:5`，7294 字部件分组）一组一组播放，播放时墨迹淡到 0.22、播完恢复 1（2557–2572）；提示笔画留在 `hzEl` 里直到重写/换卡。描红用 `showOutline:true` 的第三个 writer 或 `-webkit-text-stroke` 楷体兜底（2513–2521）。自动比对 `checkInk`（2322–2356）把 medians 映射到画布坐标、整字包围盒对齐后，笔画数相同走逐笔配对（匈牙利式贪心 + 长度校验），不同走双向覆盖度；结果只用于揭晓页「建议」预圈和文案。**与 v10 最大的三处冲突**：点拨画法/淡出/量（D25、W04）完全没有；「不会写→描红→再写→判断」与「按住瞥完整字」违背 D18（看过答案只记为看过答案、不再判断）；揭晓页按几何结果给按钮加 `.suggest` 预圈违背 D03「不预选答案」。笔锋渲染器本身与 v10 八.1 的公式全部不同（平滑、宽度映射、起收笔、点画、零时间差合并均缺），但飞白/洇墨/减少动态效果按 D10 是「沿现有处理」，可以保留。

## 2. 组件/模块清单

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 尺寸/主题工具 `cssVar` `isDark` `hintStroke` `idealBoxSize` | `index.html:2161-2170` | 读 CSS 变量；深浅色判断；提示笔画颜色（浅 `#d08b78` / 深 `rgba(226,138,110,.75)`）；按视口算格边长 `S`（clamp 到 190/220–330） | `S`（全局 let）、`hintStroke()` | `--safe-top/--safe-bottom`、`html.largeText`、`clamp`（1649） | **与 v10 决定冲突**（尺寸）；`hintStroke` 应重写 | v10 要求书写格 258–345pt、360 宽紧凑版固定 258pt、点提示前后不变（W15/V02/X08）；现有上限 330、下限 190 不满足。颜色应改用 v10 暖墨红令牌（浅 `#A6533F`、深 `#D47A5D`，见 `shizi-v10-交接版.html` 令牌表）。 |
| 全局状态 | `2171-2176`、`2287`、`2542` | `gridCanvas/inkCanvas/inkCtx/hzEl/peekEl/writer/peekWriter/practiceCharData/loadToken/shownStrokes/totalStrokes/groups/groupIdx/strokeDataOffline`；`drawing/last/cur/actionCooldownUntil/activePointers/peeking/peekReleasePending/actionStack/seenGroups`；`inkStrokes/curInkStroke/curMedians/lastVerdict/tracing/traceStrokeStartCount/tracedThisCard`；`animating/revealed` | 全部是模块级 `let`，被 `scripts/verify_8105_app.js` 直接读写 | — | 应重写（封装成模块状态） | 40 多个自由变量，`loadToken` 是唯一的异步取消机制（每次 render/rebuild/trace 递增，`token!==loadToken` 则丢弃）。 |
| 书写时收起周边 UI（writing chrome） | `2177-2185`，CSS `199-205` | 落笔后给 `#card` 加 `.writing`，把标题/题面/按钮 opacity→0 并 `inert`；抬笔 2 s 后恢复；首次完成一笔才开启（`tuning.chromeFadeSeen`） | `enterWritingChrome/exitWritingChrome/finishWritingChrome/resetWritingChrome` | `tuning`、`saveTuning`、`#card` DOM | 可抽取改造 | v10 没有这条交互（写字页不提收起），需产品确认是否保留；`WRITING_CHROME_SELECTOR` 硬编码 9 个选择器。 |
| 换卡开场动画 `playRoundOpening` | `2186-2187`，CSS `206` | `#practiceArea.opening` 0.42 s，`motionReduced()` 时跳过 | `roundOpeningPending` | `motionReduced`（2699） | 可直接复用 | — |
| 米字格 `drawGridOn` | `2189-2194`；重画钩子 `3096` | 画纸底、红外框（α .6）、虚线十字+对角线（α .24） | `drawGridOn(ctx)` | `--card/--muted/--accent` | 可直接复用 | 颜色在绘制时取，深浅色切换靠 `matchMedia('change')` 重画；v10 八.3 要真机看「淡十字线要不要加重」。 |
| 采样 `P(e)` | `2195` | PointerEvent→`{x,y,t,p}`：坐标按 `getBoundingClientRect` 换算到 `S` 空间，`t=e.timeStamp`，`p` 仅 `pointerType==="pen"` 时取 `e.pressure`（clamp 0–1），触摸恒 0 | — | `inkCanvas` | 可直接复用 | 触摸设备的 `pressure` 常量 0.5 被有意忽略，符合 D10「有真实压力时」的前提。 |
| 笔宽实时映射 `penBaseWidth` `brushDetailEnabled` `brushWidthFor` | `2196-2200` | 本体宽 `max(5, S*.045)`（S=330 → 14.85px）；`detail` 需非减少动态 && 核数>2 && 内存>2GB；宽度：有压 `base*(.58+√p*.94)` clamp[.58,1.52]，无压 `base*(1.34-min(1,v/1.8)*.74)` clamp[.6,1.34]，EMA α=.38（按采样点，不按时间）；写回 `point.w=ema/base`、`point.v` | `brushWidthFor(point,prev,state,base)` 有副作用（写 `point.w/v`） | `motionReduced`、`navigator.hardwareConcurrency/deviceMemory` | **与 v10 决定冲突**（D09/八.1） | v10 规格：`base=BASE×(1.06−0.12·min(v,1.5))`、时间平滑 `α=1−e^(−Δt/35ms)`、BASE 11.5pt/345；现有公式、常数、平滑方式全不同。压感「替代速度、不叠乘」这一点已满足 D10。 |
| 笔画几何 `brushStrokeGeometry` | `2201-2205` | 逐点宽度：有 `w` 用 `clamp(w,.35,1.7)*base`，否则有 `t` 时重算，否则等宽；起笔 `head=min(16%len, 2base)` 内 `.62+.38·(s/head)^.7`；收笔 `tail=min(30%len, 3.8base)` 内 `max(.16,(r/tail)^.72)`；宽度下限 1px | 返回 `{lengths,widths,total}` | — | **与 v10 决定冲突** | v10：起笔 0.85→1.08→1.0（0–6–12pt）；收笔看抬笔前 30ms 均速（0.25/0.9 pt/ms 两阈值）决定要不要收尖；点画 <24pt 走 0.7→1.1→0.9；单点直径 0.9×本体宽（D09）。现有实现无条件收尖、无点画分支、无 30ms 窗口。 |
| 基元 `paintBrushRibbon` `paintInkBloom` | `2206-2210` | 两点间四边形色带 + 末端圆；洇墨为径向渐变、扩散 0.8–2px、α .11 | — | — | 可直接复用 | D10：飞白/洇墨沿现有处理。 |
| 分层 `brushStrokeLayer` `compositeBrushLayer` | `2211-2214` | 每个目标 canvas 用 WeakMap 缓存一张同尺寸离屏层；画一笔前清层、同步 transform，画完 `drawImage` 合成 | — | `ctx.getTransform` | 可直接复用 | 目的：`destination-out` 飞白不擦到已有墨/提示/米字格（CHANGELOG `84`）。代价：每笔一次全幅 clear+drawImage。 |
| 整笔渲染 `paintBrushStroke` | `2215-2222` | 输入校验（坏点返回 false）；单点画圆；逐段色带；`detail` 时起笔洇墨、停顿（dt>52ms）洇墨、快笔（v>1.05 且段长>.35base）用 `destination-out` 虚线擦出飞白（α ≤.2） | `paintBrushStroke(ctx,points,base,{color,detail,capabilities})→bool` | 上面全部 | 可抽取改造 | 是唯一的「渲染 sink」，分享图、字卡、揭晓快照都走它（`2406`、`2919`）。抽成独立模块时保留签名即可。 |
| 实时描线 `strokeTo` | `2223` | pointermove 时直接在 `inkCtx` 上画一段色带（无分层、无飞白/洇墨），抬笔后 `redrawInk` 用 `paintBrushStroke` 整笔重画 | — | `last`、`brushLiveState` | 应重写 | 实时与最终外观不一致（抬笔「跳变」）；且 v10 八.2 要求「已完成笔画固化缓存，只重画当前一笔」，现在是每次抬笔全部重画。 |
| 指针事件 `initBox` 内 | `2249-2258` | `pointerdown`：`preventDefault`，加入 `activePointers`；≥2 指→`enterPeekHint`；非 primary 或 peeking 忽略；否则 `commitUndoWindow`、`lockGradeActions`、初始化 `p.w=1.1`、`inkBegin`、`setPointerCapture`。`pointermove`：取 `getCoalescedEvents()` 逐点 `strokeTo`+`inkMove`。`pointerup/cancel/leave`：处理 peek 退出，否则 `inkEnd→redrawInk→armGradeActions`。`touch*` 全部 `preventDefault({passive:false})` | DOM 事件 | CSS `.inkc{touch-action:none}`（148），`.card{overflow:hidden;overscroll-behavior:none}`（127） | 可抽取改造 | 没有 palm rejection：Pencil 书写时手掌触到画布 = 第二个指针 → 进入瞥一眼并 **取消当前笔**（`cancelCurrentStroke(false)` 2228）。没有 V01 的「换字后 0.3 s 不接受落笔」（`cardStartedAt` 2491 只被记录未被使用）。没有预测墨头（八.2 第三项，原型也没做）。 |
| 按钮冷却 `lockGradeActions/armGradeActions/unlockGradeActions` | `2224`、`2259-2261` | 落笔期间 `actionCooldownUntil=∞` 并给 `#actions/#traceActions` 加 `.tlock`；抬笔后 300 ms 解锁 | `actionCooldownUntil` 被 `revealAnswer`(2597)/`declareDontKnow`(2606)/`openTracingTeaching`(2603) 读 | — | 可抽取改造 | 用 `Date.now()`；v10 十.3 要求「判断时间用事件自己的时间戳」、新状态出现后 0.4 s 按钮不响应（W08）。 |
| 瞥一眼 `enterPeekHint/exitPeekHint/resetPeekHint/buildPeekWriter` + 控件 | `2227-2237`、`2545-2557`、CSS `144-146` | 双指按住画布、或按住「点拨」360 ms、或按住隐藏按钮 `#peekInk`：墨迹 opacity→0.04，`hzEl.peekHint`（saturate/contrast 提亮）、`peekEl.active`（opacity .48，完整字 `showCharacter:true`）；松手恢复。不计入 `hintsUsedThisCard`，只记 `tuning.peekHintUsed` | `#peekInk`（`aria-hidden`、`tabindex=-1`，708）、`#tip` 长按 | 第二个 HanziWriter 实例 | **与 v10 决定冲突**（D18） | 这是一条隐藏手势看到完整答案且不留记录，与 D18「看答案后直接记为看过答案」和 04-v10 五「完整答案不依赖仅有的隐藏手势」相悖；v10 把「提示」和「看答案」做成两个固定按钮。建议整块删除。 |
| 画布装配 `initBox` `fitBox` | `2238-2248`、`3090-3091` | 建四层、按 DPR 缩放、挂事件、清空墨迹；`fitBox` 在 `|new−S|≥24` 时销毁重建（只在卡片隐藏或 `render()` 前） | `$("boxwrap")` | — | 可抽取改造 | 重建即丢墨迹（注释 2247 也承认）；v10 X08 要求点提示前后大小不变——现有满足，因为提示不改 S。 |
| 墨迹操作 `redrawInk` `updateInkControls` `clearInk` `undoInkStroke` | `2262-2270` | 全量重画；撤一笔/重写按钮可用性；清空（含 `actionStack` 里 `stroke` 项、描红状态）；撤销栈按 `stroke`/`hint` 类型回退（撤 hint 会 `rebuildHintLayer(start)`） | `#undoStroke` `#clear` `actionStack=[{type:"stroke"}|{type:"hint",group,n,start}]` | `saveSessionSnapshot`、`commitUndoWindow` | 可抽取改造 | 边开发边改 W17：「清空后给一次撤销」——现在 `clearInk` 不可撤销。 |
| 笔顺数据加载 `charLoader` `strokeDataFailureCopy` `warmStrokeCache` `warmUpcomingStrokeCache` | `2271-2282`；`render()` 里 `2506-2511`；`online` 钩子 `3092-3095` | `fetch('data/'+encodeURIComponent(char)+'.json')`，非 ok 抛错；`render()` 里 2.5 s 没回来即 `allowNoStrokeData("slow")` 放开「写好了/不会写」；失败 `allowNoStrokeData("error")` 并 `strokeDataOffline=navigator.onLine===false`；联网后若还没写字则重新 `render()`；组开始时预热本组（`2693`），另有预热下一组 | `practiceCharData`（原始 JSON）、`curMedians`、`totalStrokes`、`groups` | `sw.js`（笔顺 cache-first + 后台刷新、核心 600 字预缓存、上限 800 项）、`core-strokes.js` | 可直接复用（fetch 部分）；失败分支**与 v10 决定冲突** | 无重试、无超时（靠 SW）。v10 I04/10.13：取不到笔顺时「没有分步提示，看答案是完整楷体并照实记为看过答案，描一遍用浅色完整字形」；现有放行后仍允许「写好了」进入对错判断、「不会写」进描红并记 miss。 |
| Hanzi Writer 工厂 `createPracticeWriter` | `2460-2466` | `HanziWriter.create(container, cur.target, {width:S,height:S,padding:round(S*.06),showCharacter:false,showOutline,outlineColor/strokeColor:hintStroke(),strokeAnimationSpeed: instant?1000:5, delayBetweenStrokes: instant?0:60, charDataLoader})`；`onLoadCharDataSuccess/Error` 用 `token` 守卫 | 返回 writer | `hanzi-writer.min.js` v3.7.3（SVG renderer；库自带 loader 指向 jsDelivr 但从未被用到，全部走本地 `charLoader` 或内存 `data`） | 可直接复用 | 未使用 `quiz()`/`highlightStroke()`；未设 `renderer:'canvas'`。 |
| 提示层重建 `rebuildHintLayer(count)` | `2467-2478` | 在脱离 DOM 的 holder 里建 writer，`animateStroke(0..count-1)` 以速度 1000 瞬时画出，再 `hzEl.replaceChildren(...)`，`writer=nextWriter` | 撤销 hint、恢复会话、重写时调用 | `practiceCharData` | 可抽取改造 | 用「极快动画」模拟静态绘制是取巧；hanzi-writer 有 `showStroke`/`hideCharacter` 等更直接的 API 可用。 |
| 点拨按钮 `$("tip").onclick` + 长按 | `2557-2573`、`2545-2550` | 一次播一组（`groups[groupIdx]` 笔）：`hintEverUsed=true`，首次看到该组 `hintsUsedThisCard++`；播放前 `inkCanvas.opacity=.22`，逐笔 `await writer.animateStroke(start+i)`（速度 5、间隔 60 ms），播完 opacity=1、压 `{type:"hint"}` 进撤销栈、首次弹「用了提示，这个字本组稍后还会再写」 | `#tip`（文案恒「点拨」，2380） | `GROUPS`、`seenGroups`、`saveSessionSnapshot` | **与 v10 决定冲突**（D25、W03/W04） | 见第 4 节 D25 差距清单。 |
| 提示量来源 `GROUPS` | `deck-data.js:5`；使用 `2508` | `{字:[每组笔数…]}`，7294 字；总和≠`strokes.length` 时退回 `[totalStrokes]`（整字一组） | — | Chaifen 0.4.0 部件图（`audit/vector-data-460-hint-groups.json`） | 可抽取改造 | v10 W04：每次给约总笔画 1/4、至少 1 笔、接着已写的笔往下给；`decisions.md` 待定表也写明「部件提示接入前，演示 groups 不是全库资源」。现有 GROUPS 覆盖全库但语义是「部件」不是「1/4」。 |
| 描红 `showTraceOutline` `beginTracingPhase` `finishTracing` `renderPhaseControls` | `2513-2521`、`2600-2605`、`2479-2484`、CSS `147` | 第三个 writer `showOutline:true`（轮廓色 `hintStroke()`），加载失败退到 `.traceFallback`（楷体 `-webkit-text-stroke` 1.2px、opacity .45）；描过至少一笔（`tracedThisCard`）才能「描好了，自己写」；进入 `postTraceRecall` 后清空墨迹、隐藏轮廓、`hintsUsedThisCard=0` | `practicePhase∈{recall,reinforcement,tracing,postTraceRecall,revealDecision,feedback}`、`#traceDone` `#traceIntro` `#phaseTitle` | `TRACE_TUTORIAL_KEY`、`soundFeedback("paper")`（2288） | **与 v10 决定冲突**（D18） | v10：看答案→记「看过答案」→描一遍/自己写一遍只是练习、不再判断；现有 `declareDontKnow` 先 `recordOutcome("miss")`（2608），`postTraceRecall` 之后还走揭晓判断。边开发边改 W19：描一遍开始先播一遍笔顺（可跳过）。 |
| 会话快照几何 `freezeSubmissionSnapshot` `snapshotImage` `revealInkImage` `renderStrokeSkeleton` `drawSnapshotStrokes` | `2405-2431` | 冻结 `{hintStrokes(前 shownStrokes 条 medians→canvas), inkStrokes, referenceStrokes, compositeGeometry=hint+ink, compositeImage(PNG dataURL), lastVerdict=checkInk(composite, reference)}`；揭晓页把判错的用户笔用 `--accent` 加粗重描 | `submissionSnapshot`（`Object.freeze`） | `checkInk`、`paintBrushStroke` | 可抽取改造 | 提示笔画被当作「已写」并入比对（`compositeGeometry`）——D25 提示会淡出，这条语义需要重新决定。 |
| 笔迹持久化 `shareInkFromSnapshot` `persistRecentInk` `compactHandCardStrokes` `setRoundHandwriting` | `1801-1811`；调用 `1831-1834` | 判断落地时把 `inkStrokes` 按 `canvasSize` 归一化到 0–1，≤48 笔×48 点；`recentInk` 再压到 ≤36 笔×24 点 + 120px webp 缩略图 | `memory[key].recentInk`、`roundHandwriting[idx]` | `normalizedInkStrokes`（1148） | 可直接复用（格式） | 丢 `t`、`p`，只留 `w/v`——与 D14「历史缺 t/p 如实报告」一致；新逐判断存储按 decisions 仍暂停。 |
| 自动比对 `pathLen` `resamplePts` `bboxOf` `mediansToCanvas` `alignInk` `strokePairCost` `checkInk` `checkExact` `checkHolistic` `addDirs` `nnStat` `autoCheckInk` | `2295-2360` | 见第 3 节「verdict」与第 5 节；`mediansToCanvas` 与 hanzi-writer Positioner 完全一致（已核对：`pad+(900−y)·k`，`k=(S−2pad)/1024`） | `checkInk(userStrokes, medCanvas)→verdict` | `S`（阈值全部按 `S` 比例） | 可抽取改造 | 作为「预圈建议」用途与 D03 冲突；但 `checkExact` 的逐笔配对可改造为 W04「已经写对了哪几笔」的评估器。`autoCheckInk`（2357）现已无人调用（死代码）。 |
| 揭晓文案/预圈 `suggestedOutcomeForVerdict` `verdictShort` `showRevealState` 中 `.suggest` | `2363-2369`、`2587-2588` | 精判 ok→`decisionCorrect.suggest`，精判 bad→`decisionWrong.suggest`；`askLine` 写「看起来写对了…」 | `#decisionCorrect/#decisionWrong` | — | **与 v10 决定冲突**（D03） | D03「不叠字评分、不预选答案」。 |
| 点拨状态文案 `hintVisualExhausted` `updateActionLabels` `updateTip` `EXHAUSTED_HINT_COPY` | `2370-2381` | 按钮可用性；「不会写/再描一遍」「写好了」 | `#tip #peekInk #done #show` | — | 应重写 | v10 文案：「提示 · 还有 N 次」「提示已用完」「暂时没有提示」、按钮「看答案」；进度「3 / 5」。 |
| 教学 `teachStage` `teachActive` `updateTeachUI` `armTeachIdle` `onTeachStrokeStart/End` | `2382-2398`，DOM `703`、`713` | 校准组第一张卡：`#teachBubble`「格子里缺的字，直接用手指写」，3 s 无动作切到「helpers」阶段并锁「重写/写好了」（`.tlock`）；`#mascotLine` 按阶段换句 | `teachStage∈{intro,writing,helpers,done}` | `activeMode==="calibrate" && pos===0` | **与 v10 决定冲突**（D17） | D17 去掉首题说明卡；X11 第一次引导句统一为「看拼音和提示，把这个字写在格子里。」；`onTeachStrokeEnd` 是空函数。 |
| 写字区 HTML | `698-720` | `#practiceArea > #prompt/#hint/#traceIntro/#teachBubble/.practiceCanvas(#boxwrap+#inkTools)/.mascotRow/#actions(#show,#done)/#traceActions(#traceDone)` | id 列表 | — | 应重写 | v10 布局：提示 · 写好了一行，看答案 · 跳过 · 结束这组一行（V02），撤销/清空在书写格上方（紧凑版），右上角「n / N」。 |
| 现有测试 | `scripts/verify_8105_app.js:174, 342-410, 1095-1120, 1511-1534, 1557-1580, 1646, 1793-1833` | 源码字符串断言（含 `pointer==="pen"`、`destination-out`）；渲染器单测（慢/快/压感宽度、锥形、飞白 α、分层不擦交叉、分享图像素一致、90 次 <16.7 ms、坏点不抛）；PointerEvent 合成测 chrome 收起、双指瞥取消当前笔、`#peekInk` 不计提示次数、tip token 取消、描红流程 | Playwright 1.62 | 可抽取改造 | 改渲染器公式必然要改 342–410 的断言；测试直接 poke 全局变量，模块化后要提供测试钩子。 |

## 3. 数据契约

### 3.1 采样点与墨迹（内存 / 会话）
- **实时点** `P(e)`（2195）：`{x:number, y:number, t:number, p:number}`；`x,y` 为 `S` 空间 CSS px（0–S，不归一化），`t=e.timeStamp||performance.now()`（ms），`p` 仅 pen 有效（0–1），touch/mouse 恒 0。
- **存入 `curInkStroke` 的点**（2288–2289）：`{x,y,t,w,v}`。**`p` 不落盘**。`w` 是「相对本体宽的倍数」（`ema/base`，渲染时 clamp .35–1.7），起笔固定 `1.1`；`v` 为 px/ms（S 空间）。
- **`inkStrokes: Point[][]`**：一笔 ≥2 点才入栈（2292）；会话恢复时允许 1 点（`normalizedSessionInkStrokes` 1154–1157 保留 `t,p,w,v`）。
- **`actionStack`**：`[{type:"stroke"} | {type:"hint", group:number, n:number, start:number}]`（2293、2568）。

### 3.2 笔顺数据 `data/<字>.json`
- 形状：`{strokes: string[] (SVG path d，1024 单位、y 向上), medians: [number,number][][] , radStrokes?: number[]}`（例 `data/我.json`：7 strokes / 7 medians / `radStrokes:[1,4,5,6]`）。坐标范围 x 0–1024、y −124–900（注释 2307；与 `hanzi-writer.min.js` Positioner 常量 `{x:0,y:-124}→{x:1024,y:900}` 一致）。
- `curMedians` 只在 `medians.length===strokes.length` 时接受（2508），否则为 `null` → 无比对。
- URL：`data/`+`encodeURIComponent(char)`+`.json`（同源）。SW 判定 `/\/data\/[^/]+\.json$/` 且非 `etymology.json` 为笔顺请求（`sw.js:22-25`）。

### 3.3 `GROUPS`（`deck-data.js:5`）
- `{ [字]: number[] }`，每项为一组的笔数，例 `"我":[1,1,2,3]`。总和≠总笔数时退回 `[totalStrokes]`。

### 3.4 `mediansToCanvas` 输出
- `Point[][]`，`{x,y}` in S 空间：`pad=round(S*.06)`，`k=(S−2pad)/1024`，`x'=pad+x·k`，`y'=pad+(900−y)·k`。

### 3.5 比对结果 `verdict`（2338、2355）
- `{status:"ok"|"bad", mode:"exact"|"holistic", u:number, t:number, failed:number[], missing:number}`；`failed` 是 **compositeGeometry** 的下标（提示笔在前），揭晓页用 `failedUserStrokeIndexes` 减去 `hintCount` 还原（2412–2415）。`normalizedSubmissionVerdict`（1160）只接受上述枚举。

### 3.6 `submissionSnapshot`（2426–2431；规范化 1162–1170）
```
{ target, idx, attemptId, createdAt, canvasSize:S,
  hintStrokeIds:number[], hintCount, hintStrokes:Point[][], inkStrokes:Point[][],
  referenceStrokes:Point[][], compositeGeometry:Point[][],
  compositeImage: "data:image/png;base64,…" | null  (≤2 MiB 才保留),
  hintEverUsed, enteredTracing, practicePhase, lastVerdict, userCorrect:null }
```
恢复时 `compositeGeometry` 必须等于 `hint+ink` 重建结果，否则 `lastVerdict/compositeImage` 置空。

### 3.7 会话 `shizi.session.v1`（`sessionPayload` 1498–1501，`visual` 来自 `capturePracticeVisual` 1481–1482）
- `visual = {practicePhase, currentCardKey, currentAttemptKind, currentAttemptId, hintEverUsed, enteredTracingThisAttempt, hintsUsedThisCard, shownStrokes, groupIdx, seenGroups:number[], inkStrokes, tracedThisCard, submissionSnapshot, revealed, stamped}`。**注意 `inkStrokes` 是 S 空间原始像素坐标**，换设备/改字号后 `S` 不同则恢复的笔迹会错位。

### 3.8 `memory[cardKey].recentInk`（`shizi.memory.v1`，1807–1810；恢复侧 3022）
- `{version:2, day:"YYYY-MM-DD", at:ms, dataURL:"data:image/webp|png;base64,…"(length*2 ≤ 32 KiB), strokes?: [{x,y∈[0,1] 3 位小数, w∈[.35,1.7] 2 位, v∈[0,6] 2 位}][] (≤36 笔×24 点)}`；总量 `RECENT_INK_MAX=96` 条、`RECENT_INK_BUDGET=420 KiB`（1144）。

### 3.9 `roundHandwriting[idx]`（`shareInkFromSnapshot` 1801–1803）
- `[{x,y∈[0,1] 3 位, w?, v?}][]`，≤48 笔×48 点；写入 `roundStats` 时 `handwriting` 字段被剥掉（1497）。

### 3.10 tuning 标记（`shizi.tuning.v1`）
- `chromeFadeSeen`、`peekHintUsed`、`practiceHintExplained`、`strokeHintConsequenceShown`（2184、2229、2545、2570）。另 `shizi.traceTutorial.v1` 布尔（2293）。

### 3.11 DOM/CSS 契约
- `.box > canvas.gridc | div.hz | div.peekHz | canvas.inkc`（141–148）；状态类 `.hz.peekHint` `.hz.traceFallback` `.peekHz.active` `#card.writing` `#card.chromeDirect` `#card.undoActive` `#practiceArea.opening` `#actions.tlock`。
- `inkCanvas.style.opacity` 取值：`1` / `0.22`（点拨播放中）/ `0.04`（瞥）；`hzEl.style.opacity` 恒 `1`。
- 事件：`inkCanvas` 上 `pointerdown/move/up/cancel/leave` + `touchstart/move/end/cancel(preventDefault)`；`window` `online`（3092）、`blur`→退出瞥（2556）、`resize`→仅卡片隐藏时 `fitBox`（3091）；`matchMedia(dark).change`→重画米字格（3096）。

### 3.12 SZInk 原型契约（对照用，`docs/design/v10/extracted/ink-第十稿交接版.js`）
- 输入 `raw:[{x,y,t}]`（345×345 pt、ms），`build(raw, final, base=11.5, {lo:.25,hi:.9})` 输出 `[{x,y,w}]`，`w` 为**绝对宽度 pt**（非倍数），附 `out.v30/dot/single/endK`。流水：同 `t` 合并（留后者）→ 1€ 滤波（minCutoff 1、β .02、dCutoff 1，t 用秒）→ Catmull-Rom 3pt 重采样（t 线性插值）→ 宽度 `base·(1.06−.12·min(v,1.5))`、`α=1−e^(−dt/35)` → 起笔 `.85+.23·s/6`（<6pt）、`1.08−.08·(s−6)/6`（6–12）→ 收笔按 v30 线性到 `endMin=.9→.12`、`tap=min(28, .3·len)` → 点画（final 且 len<24）`.7→1.1→.9`；单点 `w=.9·base`。`p` 被忽略（不符合 D10，D10 以文字为准）。`synth`/`resample(HZ120)`/`atSpeed` 用于演示；`outline(pts,floor)` 输出 SVG path；录制格式 `{char, writer, pass, kind?:'wrong'|'trace', strokes:[[{x,y,t,p?}]] | {end:'cancel', points}}`；`play(rec,{down,move,up,cancel,end})` 按原时间回放。

## 4. 与第十稿（v10）决定的关系

### 4.1 保留（可直接沿用或只改参数）
- 四层叠放结构、DPR 处理、`touch-action:none` + `preventDefault` 的滚动抑制、`getCoalescedEvents`、`setPointerCapture`、`loadToken` 取消机制、`mediansToCanvas`（与 hanzi-writer 坐标完全一致）、SW 笔顺缓存策略、`recentInk`/`roundHandwriting` 归一化格式、Pencil 压感「替代速度不叠乘」（D10）、飞白/洇墨/减少动态效果关闭细节（D10「沿现有处理」）、每笔独立层合成。

### 4.2 需改（v10 已有明确规格）
- **笔宽/起收笔/点画/平滑**（八.1、D09）：公式全部替换为 SZInk 规格；增加同时刻采样合并、1€+Catmull-Rom、30 ms 抬笔窗口、点画分支、单点 0.9× 直径；BASE 与两阈值等真机（decisions「新笔迹管线」待定）。存储 `w` 的语义要定：现有是倍数（.35–1.7），SZInk 是绝对宽。
- **渲染分层**（八.2）：已完成笔画固化到一张缓存 canvas，只重画当前一笔；抬笔时不再全量 `redrawInk`；实时 `strokeTo` 与最终 `paintBrushStroke` 统一用同一条管线（含增量飞白/洇墨或抬笔前只画本体、抬笔时补细节）。预测墨头留待真机。
- **提示画法（D25 / K24 方案①）**——现有完全没有，需新增：
  1. 点提示后**本人墨迹持久淡到约 35%**，直到写下一笔（现有：仅播放期间 0.22，播完立刻 1）。
  2. 提示用**细的暖墨红**沿 medians 按笔顺**逐笔画在书写格里**（现有：hanzi-writer 填充的完整笔画轮廓，颜色 `#d08b78`/`rgba(226,138,110,.75)`，不是细线；颜色应改 v10 令牌 `#A6533F`/`#D47A5D`）。可复用 `mediansToCanvas` + 一层新的 `hintCanvas`/SVG polyline，不必再依赖第二/三个 HanziWriter 实例。
  3. **写下一笔时提示淡出、墨迹恢复**（现有：提示留在 `hzEl` 直到重写/换卡）。淡出时长/曲线原型未给，需与「减少动态效果」分支一起定。
  4. **提示量**（W03/W04）：每次接着「已写的笔画」往下给约 1/4 总笔数、至少 1 笔；「已写对哪几笔」正式版待工程评估，做不到退回按已写笔数。现有按 `GROUPS` 部件分组。`checkExact` 的贪心配对可改造成这个评估器。
  5. **按钮**：固定位置「提示 · 还有 N 次 / 提示已用完 / 暂时没有提示」（文案清单 C021/C022/N04），与「看答案」分开；去掉角落浮层 `#tip`「点拨」和长按语义。
  6. 提示笔画**不再并入比对几何**——`compositeGeometry`/`hintStrokeIds` 的用途要重新决定（D25 下提示已淡出，不是「写在格子里」的一部分）。
- **连点保护**（V01/W08、十.3）：换字后 0.3 s 内画布不接受落笔、新状态 0.4 s 内按钮不响应，均按事件时间戳。现有只有抬笔后 300 ms 按钮锁（`Date.now()`）。
- **书写格尺寸**（W15/V02/X08）：≥258pt，紧凑版固定 258pt，点提示不变；现有 190/220–330。
- **深色可读性**（边开发边改 W23）：提示笔画、描一遍轮廓各提亮一档，等真机。
- **描一遍**（W19）：开始时先播一遍笔顺、可跳过；无笔顺数据时用浅色完整字形不分笔顺（K22，现有 `.traceFallback` 可沿用为 K22 的兜底）。
- **清空可撤销**（W17）。
- **恢复**（W10）：离开/刷新回到离开时阶段，笔迹与参考字形都在——现有 `restoreSessionVisual` 已做，但 `inkStrokes` 存的是 S 空间像素，换 S 会错位；建议改存归一化坐标或随存 `canvasSize` 缩放。

### 4.3 删除（被 D17/D18/D03 覆盖）
- **瞥一眼**整套（双指、长按点拨、`#peekInk`、`peekEl`、`PEEK_INK_OPACITY`、`tuning.peekHintUsed`）：隐藏手势看完整字且不记录，违背 D18 与「完整答案不依赖隐藏手势」。
- **「不会写」→描红→再写→判断**（`declareDontKnow`、`postTraceRecall` 揭晓判断、`recordOutcome("miss",{teaching:true})`、`showTeachingCompleteFeedback`）：D18 改为「看答案」→记「看过答案」→描一遍/自己写只是练习，不判断、不算有效记录（K25）。描红渲染本身可保留为「描一遍」的实现。
- **揭晓页 `.suggest` 预圈与 `verdictShort` 建议文案**（2363–2369、2587–2588）：违背 D03「不预选答案」。`checkInk` 若保留，只能用于 W04 内部评估，不得影响判断页。
- **教学段**（2382–2398、`#teachBubble` 703、`.tbubble` CSS 134–137）：D17 去掉首题说明卡；`MASCOT_LINES`/`.mascotRow` 是否保留需产品确认（v10 页面无吉祥物行）。
- **`hintVisualExhausted`/`EXHAUSTED_HINT_COPY`「点拨看完了——…点『不会写』先描后写」**：文案与流程均作废。
- **「用了提示，这个字本组稍后还会再写」**（2570）：v10 无此规则（hinted 结果如何入队属调度范围，本报告不裁决）。

## 5. 风险与坑

1. **Pencil + 手掌 = 取消当前笔**：`pointerdown` 时 `activePointers.size>=2` 直接 `enterPeekHint()`，它先 `cancelCurrentStroke(false)`（2228），正在写的一笔被丢弃且不进撤销栈。删除瞥一眼后仍要决定第二指针的策略（忽略非 primary 即可，`e.isPrimary===false` 分支已有）。
2. **实时与最终外观不一致**：`strokeTo` 只画色带（2223），抬笔 `redrawInk` 全量重画带飞白/洇墨（2262）→ 每笔抬笔有一次「跳变」，且 O(笔数) 全幅 clear+drawImage（`brushStrokeLayer` 每笔清一次全层）。15 画以上的字在 3× DPR（990×990）上会明显掉帧——正是八.3 要真机测的「第 15 笔以后会不会变卡」。
3. **`brushWidthFor` 有副作用**：写 `point.w/v` 到传入对象；`brushStrokeGeometry` 用 `{...point}` 拷贝规避，但 `strokeTo` 直接改 `last`。抽模块时要改成纯函数。
4. **EMA 不按时间**：α=.38 固定按采样点，120 Hz 与 60 Hz 设备手感不同（v10 明确要求 α 随 Δt）。`dt` 下限 1 ms 隐藏了零时间差点（D09 要求合并且不参与速度）。
5. **`compositeImage` 进 localStorage**：`submissionSnapshot.compositeImage` 是 PNG dataURL（允许 ≤2 MiB，1170），随 `visual.submissionSnapshot` 写进 `shizi.session.v1`（1491–1492 `storedSubmission` 不剥掉它）。在揭晓/反馈阶段刷新即写一张全幅 PNG，是配额与 `save()` 失败的重要来源。
6. **会话墨迹用像素坐标**：`visual.inkStrokes` 是 S 空间 px；开更大字体（`S` 变）或换设备恢复时笔迹相对格子错位，`fitBox` 又只在卡片隐藏时重建。`recentInk`/`roundHandwriting` 已归一化，两套坐标系并存。
7. **`loadToken` 的隐式递增**：`render()` 的 `onSuccess` 里 `loadToken++`（2508）使 writer 自己的 `onLoadCharDataError` 永不再触发；`allowNoStrokeData` 也 `loadToken++`。任何新加的异步都必须在 `await` 后重新比对 token，否则会把上一张卡的笔画画到下一张（注释 2565 记录过这个事故）。
8. **2.5 s「较慢」放行的竞态**：`setTimeout` 2500 后若 `$("show").disabled` 仍为 true 就放行；但 `render()` 一开始就 `$("show").disabled=false`（2500），随后 `createPracticeWriter` 异步完成也设 false——实际上这个 `if` 只有在中途被别的代码 disable 时才成立，「较慢」文案很可能从未出现。需要实测。
9. **离线判定靠 `navigator.onLine`**：`strokeDataOffline=navigator.onLine===false`（2506）；WKWebView 弱网（有网但超时）会被当成「暂未收录」而不是「较慢」，与 #146 记录的资源失败分支覆盖题意问题同源。
10. **`hintStroke()` 颜色被 canvas 烘进快照**：`snapshotImage`/`revealInkImage`/`persistRecentInk` 在绘制时取色；深浅色切换后历史图片颜色不变；`recentInk` 缩略图更是写死 `#fdfbf4`/`#29241d`（1808、2921）。
11. **hanzi-writer 三实例**：`writer`、`peekWriter`、描红 writer 各建一份 SVG（每字 N 条 path×2 层），加上 `rebuildHintLayer` 用「速度 1000 的动画」做静态绘制——时序依赖 rAF，减少动态效果下没有分支。改用自绘 hint 层可去掉两份实例。
12. **`alignInk` 的对齐会掩盖大小/位置错误**：允许 0.8–1.25× 各向拉伸并平移到标准字包围盒；单笔画字（一、丨）`u.w` 或 `u.h` 可能为 1 → `sx/sy` 被 clamp 到 3。用于 W04「哪几笔写对」时要重新标定阈值（现在全按 `S` 比例：`OK_D=.115S`、`OK_END=.24S`、`R=.08S`）。
13. **`autoCheckInk` 是死代码**（2357–2360，无调用）；`suggestedOutcomeForVerdict`/`wrapIdForOutcome` 仅被测试或旧路径使用。
14. **减少动态效果的覆盖不完整**：`brushDetailEnabled` 关掉飞白/洇墨；但点拨逐笔动画（速度 5、间隔 60 ms）、`inkCanvas.style.transition='opacity .2s'`（2246）、hint 层淡出都没有减少动态分支；CSS 全局把 `transition-duration` 压到 .15 s（647）会连带影响新加的 35% 淡化。
15. **触摸 `pressure`**：iOS Safari 手指 `pointerType="touch"` 的 `pressure` 常为 0 或 1（部分版本 Force Touch 报 0–1），代码只信 pen，正确；但 Android Chrome 上部分数位笔上报 `pointerType="pen"` 且 `pressure=.5` 常量，会永远走压感分支。
16. **测试耦合**：`verify_8105_app.js:342-410` 对现有公式做了数值断言（慢>快、pressureHigh>pressureLow、`legacyWidth===20`、锥形关系、飞白 α 更少、90 次 <16.7 ms）；换公式必须同步改；其他用例直接给 `inkStrokes=mediansToCanvas(...)` 再 `revealAnswer()`，依赖全局变量可写。

## 6. 未解问题

1. D25「约 35%」与「细」暖墨红的具体值（笔宽 pt、淡出时长与曲线、减少动态效果时是否直接切换）原型源文件（ShiziWriteScreen-第十稿交接版.dc.html）不在仓库，`shizi-v10-交接版.html` 只含 `hint-mode="fade|box"` 属性与场景面板说明，无法从代码核实。
2. W04「已经写对了哪几笔」是否要做：若做，`checkExact` 的阈值需重新标定并定义「写对」；若不做，提示只按已写笔数（含写错的笔）继续。
3. 提示淡出后，提示笔画是否还算「写在格子里」——`compositeGeometry`/揭晓页的「浅色提示笔画」是否保留（现有揭晓图把 hint 画成浅红底层，2417）。
4. 存储 `w` 的语义（倍数 vs 绝对 pt）和是否恢复存 `t`/`p`：D14 说新逐判断笔迹存储另案暂停，但 W10「恢复到离开时的阶段」需要会话内保留全精度点。
5. `writing chrome` 收起、`.mascotRow`/`MASCOT_LINES`、纸声 `soundFeedback("paper")`（描红落笔）在 v10 页面里都没有对应物，保留还是删除需产品确认。
6. hanzi-writer 是否继续用于「看答案」的完整字形播放与描一遍轮廓（v10 K22/W19 都要播笔顺），还是全部改自绘——影响是否还需要 SVG 层。
7. BASE、两阈值、十字线粗细、深色提示色等真机项（交接备注 一、八.3）都未定，模块应把它们做成可调参数。
8. `GROUPS` 在 W04 模式下是否还有用途（例如「1/4」按部件边界取整），还是彻底弃用。
9. V01「书写格 0.3 s 不接受落笔」在描一遍/自己写阶段切换时是否也适用（换阶段不换字）。
10. 「hinted 的字本组稍后再写」这条旧规则在 v10 是否还存在，属调度范围，本报告未裁决。
