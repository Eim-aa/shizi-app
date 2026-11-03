# F · 平台层：index.html 原生桥 / iOS 壳 / sw.js

范围：`index.html` 的练习提醒、纸墨声音与练字背景音、触觉反馈、里程碑、存储故障处理、SW 注册、历史/返回处理、`?dev=1`；`ios/ShiziApp/ShiziApp/*`（WebViewController、AppDelegate、LocalWebSchemeHandler、Info.plist、PrivacyInfo.xcprivacy）；`ios/ShiziApp/scripts/sync-web-assets.sh`、`verify-bundle-assets.sh`；`sw.js`。所有路径相对仓库根 `/Users/orange/Documents/ChatGPT/astraworld/shizi-app/`。

## 1. 概览

1. 整个 Web 端是一个 3102 行的单文件 `index.html`，业务 JS 全部在一个内联 `<script>`（`index.html:1037–3097`）里，另加一个 3 行的 SW 注册脚本（`index.html:3098–3100`）；ADR 0001（`docs/adr/0001-local-first-runtime.md`）明确“现阶段不引入构建与模块化”。
2. iOS 壳是单个 `WKWebView`，通过自定义 scheme `shizi-resource://app/index.html` 加载随包同步的同一套 Web 文件（`WebViewController.swift:117–133`，`LocalWebSchemeHandler.swift`）；`sw.js` 虽被同步进包但在原生里不注册、不依赖（`ios/ShiziApp/README.md` “资源打包方式”段）。
3. JS→原生只有一条通道 `window.webkit.messageHandlers.shiziNative.postMessage({type,...})`，共 10 个消费型 type（+1 个 DEBUG 专用）；原生→JS 通过 `evaluateJavaScript` 调 6 个全局函数和 1 个自定义 DOM 事件 `shizi-native-back`。原生被设计成“无状态执行器”：提醒开关、时间、题目、已练状态全部由 Web 下发（`WebViewController.swift:1811` 注释）。
4. 原生侧实现了：本地通知提醒（7 天窗口）、5 档触觉、程序合成 WAV 的两种纸墨声、背景音只做 AVAudioSession 类别设置、备份分享/挑选、图片分享/存相册、Vision OCR、左缘返回手势、外链跳系统、`confirm/alert/prompt` 桥接、WebContent 进程崩溃自动重载。
5. `sw.js` 只服务 PWA：`VERSION = shizi-v13-${BUILD}`，HTML 网络优先（5xx/408/429/断网回落），指纹化关键资源网络优先任何非 ok 回落，笔顺 `data/*.json` 缓存优先+后台刷新、上限 800、核心 600 字永不淘汰，其余同源静态缓存优先。
6. 与第十稿的关系：触觉、提醒、图片分享/存相册、备份挑选/分享、存储门禁、`?dev=1` 应保留（部分要改契约）；拍字 OCR、里程碑庆祝、补记、字卡每日提示、欢迎页等应删或存疑；“背景音按 #166 删除”在仓库里找不到 #166 的任何记录，且第十稿边开发边改清单 V03 仍提到背景音选项——需产品确认。
7. 最大的平台风险：`LocalWebSchemeHandler` 的 MIME 表没有 `.mjs`/字体/`.wasm`/`.webp`，且响应带 `X-Content-Type-Options: nosniff`；`sync-web-assets.sh` 是白名单复制，任何新目录（`src/`、`fonts/`、`css/`）不加进脚本就不会进包。原生 DEBUG smoke 脚本（Swift 内嵌约 1070 行 JS）依赖上百个 Web 内部全局名和 70 多个元素 id，v10 重写后必然整体失效。

## 2. 组件/模块清单

复用判断口径：**可直接复用**＝契约与 v10 决定不冲突，可原样保留；**可抽取改造**＝逻辑可保留但需改接口/文案/存储；**应重写**＝与新架构或 v10 不相容；**与 v10 决定冲突**＝存在明确相反决定。

### 2.1 Web 端（index.html）

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
|---|---|---|---|---|---|---|
| CSP meta | `index.html:5` | 内容安全策略 | 无 | — | 可直接复用（须与原生 header 同步改） | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' data:; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'`。与 `LocalWebSchemeHandler.swift:33` 的 header 逐字相同。`'unsafe-inline'` 只因业务是内联脚本；若 v10 全外置 JS 可去掉，但两处必须同时改 |
| 资源指纹 meta 与脚本标签 | `index.html:9, 1033–1036` | 声明构建号；加载四个外置脚本 | `<meta name="shizi-asset-build" content="8105-3ac0637e30ec-icon-red-hand-20260928">`；`hanzi-writer.min.js`、`fsrs6.min.js`、`deck-data.js?v=3ac0637e30ec`、`data/context-overrides.js?v=11516601699b` | `scripts/verify_pwa_upgrade.js:47–97` 校验它们与 `sw.js` 的 BUILD/SHELL 一致 | 可抽取改造 | 无 `type="module"`，无 CDN，无外链样式；唯一字体是 data: URI 的 “Shizi Brand” 子集（`index.html:20`） |
| 存储读写与故障上报 | `index.html:1063–1080`（`showStorageNotice`、`showStorageGate`、`reportStorageReadFailure`、`reportStorageWriteFailure`、`reportRuntimeFailure`、`load`、`save`、`removeStored`、`quarantineStoredKey`、`readStoredRaw`、`bootLoad`、`bootNormalize`）；标记 `index.html:1027–1028`；样式 `618–620`；启动接线 `3080–3081`；配额估算 `2860–2861` | localStorage 唯一持久层的安全读写；读失败→全屏门禁；写失败→顶部告警；任何未捕获错误→告警；启动期坏数据隔离到 `shizi.corrupt.<key>` | 全局函数 `load/save/removeStored/bootLoad/bootNormalize`；全局标志 `storageReadable`、`storageWriteFailed`、`storageRuntimeFailed`；元素 `#storageNotice`、`#storageGate`、`#storageReload` | `STORED_SHAPE`（`index.html:1085+`） | 可抽取改造 | `save()` 返回布尔，但只有少数调用方检查（如 `exitCurrentRound` `index.html:2765`），与 D07 “保存成功才推进”一致的地方要靠调用方自觉。`window.error/unhandledrejection` 一律弹“页面发生异常，请先导出备份”（`1069–1070`），新架构里任何未捕获 Promise 拒绝都会触发。门禁文案（`1028`）是旧稿，第十稿原型有“存储阻断/怎么解决”一组文案（`docs/design/v10/交接备注-第十稿交接版.md:47`） |
| 存储压力检查 | `index.html:2860–2861, 3080–3081` | `navigator.storage.estimate()`，使用≥85% 或剩余<5MiB 时提示导出备份；启动后 `navigator.storage.persist()` | `checkStoragePressure()`、`storagePressure(estimate)` | — | 可直接复用 | WKWebView 自定义 scheme 下 `navigator.storage` 很可能不可用，函数已按 `{supported:false}` 处理 |
| 练习提醒（Web 侧） | `index.html:1303–1317`（`normalizeReminder`、`medianPracticeTime`、`reminder` 状态）、`1382–1441`（`reminderBridgeAvailable`、`reminderQuestion`、`reminderCandidates`、`reminderQuestions`、`indexForCardKey`、`shiziOpenReminderTarget`、`syncReminder`、`requestReminderPermission`、`queryReminderStatus`、`shiziReminderStatus`、`reminderStatusText`、`renderReminderUI`、`toggleReminder`、`acceptReminderInvite`、`dismissReminderInvite`、`renderCalibrationReturnHook`）；标记 `889–892, 797`；触发点 `1286`（当日第一次盖章）、`3082`（启动）、`3073`（清空） | 产出未来 8 天的题目并把“开关+时间+今天已练+题目”整包下发原生；接收原生权限状态；被通知点开时直接进该字 | postMessage `syncReminder`/`requestReminderPermission`/`queryReminderStatus`；全局 `shiziOpenReminderTarget(cardKey)`、`shiziReminderStatus({permission})`；存储键 `shizi.reminder.v1` | `memory`、`CARDS`、`cardKey`、`canonicalCardKey`、`qualityBlocked`、`highRiskIndexes`、`resumableSession`/`restoreSession`/`insertIntoCurrentBatch`/`startFocus`、`dailyActivity` | 可抽取改造 | 时间由最近 14 个练习日盖章时刻中位数推算并钳制 07:00–22:00、样本<3 默认 20:00（`1310–1315`）；第十稿 M05 要求“开提醒时选时间、开了给反馈”（`docs/design/v10/第十稿-边开发边改清单-第十稿交接版.md:55`），需在存储里加 hour/minute。候选规则用 `lastOutcome==="miss"` 优先（`1387`），D23 “写错过只看最近一次有效记录、跳过/看过答案不算”会改变这一集合。`reminderSection` 仅在桥存在时显示（`1418–1420`），浏览器/PWA 全部 no-op |
| 纸墨声音 | `index.html:1319–1341, 1369–1375`（`normalizeSound`、`sound` 状态、`createWebAudioContext`、`playWebPaperSound`、`soundFeedback`、`renderSoundUI`、`toggleSound`、`noteSoundTip`）；标记 `881`；调用点 `2639`（盖章 stamp）、`2288`（描红落笔 paper） | 盖章/描红落笔两种极短合成音；原生里走桥，否则 WebAudio 就地合成同一算法 | postMessage `sound {kind:"stamp"|"paper"}`；存储键 `shizi.sound.v1`（`enabled/tipShown/scene`） | `reminderBridgeAvailable()` | 可抽取改造 | `paper` 有 100ms 节流（`1339`）；首次盖章弹一次“可在设置关闭”的提示（`1375`）。第十稿文案清单 C079 把设置行改叫“按键音”（`docs/design/v10/第十稿-文案修改清单-第十稿交接版.md:104`），含义是否仍为“盖章/落笔音”需确认 |
| 练字背景音（声景） | `index.html:1320, 1342–1368, 1374`（`SOUNDSCAPE_SCENES`、`ambient*` 状态、`createAmbientAudioContext`、`ambientNoiseBuffer`、`stopAmbientSource`、`flushAmbientStopTasks`、`stopAmbient`、`practiceSoundscapeActive`、`startAmbient`、`syncAmbientForView`、`setSoundscape`）；`displayView` 接线 `1781`；`visibilitychange` `3083–3087`；标记 `882–886` | 只在写字页循环播放程序合成的雨声/炉火，切页/切后台淡出 | postMessage `soundscape {kind:"rain"|"fire"}`（原生只用来设 AVAudioSession 类别）；`sound.scene` 字段 | WebAudio | 与 v10 决定冲突（待确认） | 任务书称 #166 已决定删除；仓库内（docs/、CHANGELOG、git log）没有任何 “#166” 记录，`CHANGELOG.md:76` 记录了它的引入；第十稿边开发边改清单 V03 仍说“背景音选项占满一行”（`…边开发边改清单…md:66`），IA 树也列“音效、背景音”（`docs/product/foundation/04-用户旅程与信息架构.md:36`）。见第 6 节 |
| 触觉反馈 | `index.html:1377–1380`（`hapticDebug`、`hapticFeedback`）；调用点 `2546`（长按瞥一眼 select）、`2558`（提示 select）、`2598`（看答案 action）、`2603`（进入描红 select）、`2624`（重盖 undo）、`2639`（盖章 stamp）、`2717`（结果页大章 milestone/action，按动画延时） | 五档触觉；浏览器下 stamp/milestone 退化为 `navigator.vibrate(10)` | postMessage `haptic {kind:"stamp"|"undo"|"action"|"select"|"milestone"}` | — | 可直接复用 | 与视觉、声音在同一记账帧触发（`2639`）。v10 无触觉规格；`milestone` 档若删里程碑则失去唯一调用点 |
| 里程碑 | `index.html:1443–1459`（`MILESTONE_DAYS`、`MILESTONE_COPY`、`milestoneDaysThrough`、`milestoneCopy`、`celebrateMilestoneIfAny`、`CHARACTER_MILESTONES`、`celebrateCharacterMilestoneIfAny`、`milestoneBadge`、`milestoneText`）；结果页 `2707`（`renderSummaryMilestone`）、`2712–2718`（`roundSummary`）；字帖图读取 `2959`；备份提示互斥 `2993, 2985` | 累计练习日 1/7/14/30/每 100 与不同字数 100/300 的一次性庆祝：结果页横条、印章字、“存为里程碑字帖”、milestone 触觉 | 状态存在 `shizi.reminder.v1` 的 `milestonesShown[]`、`characterMilestonesShown[]`、`characterMilestoneDay` | `totalPracticeDays()`（含 `activity.inheritedTotalDays`）、`memoryCount()` | 与 v10 决定冲突（疑） | D01 “不以每日必须完成、闯关、排名、断签惩罚推动使用”；第十稿设计文档（`docs/design/v10/*.md`）grep “里程碑”无任一命中；D20 结果页直接进、去掉中间页。建议默认删除，若保留需产品补决定。`characterMilestoneDay` 还被用来当天压制备份提醒（`2985, 2993`） |
| 练习历史/返回 | `index.html:1768–1778`（`practiceHistoryArmed`、`restoringPracticeHistory`、`armPracticeHistory`、`releasePracticeHistory`、`popstate`）；`2760–2772`（`exitCurrentRound`）；`2774`（`shizi-native-back` 监听）；`2775`（Escape）；调用点 `1538`（恢复会话）、`2696`（开组）、`2712`（结果页释放） | 进入写字页时 `replaceState({shiziView:"home"})`+`pushState({shiziView:"practice"})`，浏览器后退＝退出当前组并保存现场；原生手势走独立事件 | `history.state.shiziView`；DOM 事件 `shizi-native-back`；`exitCurrentRound(fromHistory)` | `saveSessionSnapshot`（`1502`） | 可抽取改造 | 原生监听器按优先级关：字卡弹层→换库弹层→单字详情→设置/年度报告→写得不稳→题库质检→退出当前组；结果页、字库、我的根视图上无动作。第十稿要求“页面切换一律用 iOS 原生方式，包括从左边缘右滑返回”（`docs/design/v10/交接备注-第十稿交接版.md:38, 143`），当前实现是阈值触发的离散事件，无跟手动画 |
| 图片导出：单字字卡/本次字帖/月帖 | `index.html:2947–2954`（`exportHandCard`、`window.shiziCardSaved`）、`2978–2984`（`sharePracticeCard`）、`1958–1961`（`shareMonthlyPost`） | 画布→PNG dataURL→原生分享或存相册；浏览器走 `navigator.share`/下载 | postMessage `sharePracticeCard {kind?,name,dataURL}`、`savePracticeCard {kind:"character",name,dataURL}`；全局 `window.shiziCardSaved({success})` | 各 `render*Canvas` | 可抽取改造 | 原生忽略 `kind`；名字 `shizi-<字>-portrait|square-<日期>.png`、`shizi-card-<日期>.png`、`shizi-month-<YYYY-MM>.png`。第十稿要求单字手写图片按 A05 版式重做、“工程导出模块还没有这一版”（`交接备注…md:55`），文案 C102/C141/C214 定了“分享/没能存进相册/已保存到相册”（`…文案修改清单…md:127,166,239`）；年度报告“不能保存成图片”（C074，`…md:99`） |
| 字卡每日提示 | `index.html:1323–1325`（`normalizeHandCardPref`、`handCardPref`）、`2952–2953`（`hideHandCardPrompt`、`maybeOfferHandCard`）、`1370–1371`（`renderHandCardPref`、`toggleHandCardPrompt`）；标记 `887`、`1026` | 独立写对后每天最多一次“做成字卡？”浮条 | 存储键 `shizi.handCard.v1`（`promptEnabled/lastPromptDay`） | — | 与 v10 决定冲突（待定 D10） | 第十稿 D10 “写完提示做成图片这个开关到底做什么，定不下来就删掉”（`交接备注…md:170`；`04-v10-handoff.md` 第四节） |
| 备份导出/导入桥 | `index.html:2985–2061`：`BACKUP_KEYS`（`2987`）、`markBackupExported`（`2996`）、`backupPayload`（`2998`）、`captureSafetySnapshot`/`safetySnapshot`/`showSafetyUndo`/`undoSafetyRestore`（`3005–3012`）、`exportBackup`（`3013–3021`）、`validatedBackupData`/`replaceBackupData`/`restoreBackupPayload`（`3034–3055`）、`importBackup`（`3056`）、`requestBackupImport`（`3057–3061`）；启动 `showSafetyUndo()`（`3078`） | 导出整包 `shizi.*` 键；导入前整单校验、先存保护副本、写入后校验、失败回滚；撤销 | postMessage `shareBackup {name,payload}`、`pickBackup`；全局 `markBackupExported(ts?)`、`restoreBackupPayload(payload,{skipConfirm,reload,skipSafety})→{applied,keys}`；存储键 `shizi.backupMeta.v1`、`shizi.safety.v1` | `STORED_SHAPE`、各 `normalize*` | 可抽取改造 | 原生分支不自己记 `lastExportAt`，全靠原生 `completed` 回调（`WebViewController.swift:1287–1291`）。撤销浮条 10 秒自动隐藏（`3010`）而 D24 要求“撤销在备份与恢复页一直有效，离开这一页才失效，失效后留结论句”；K02 状态句“只按现在的记录和上次导出时间算”；K03 必测 300 字导出→替换→撤销记录数不变（`04-v10-handoff.md` 第五节） |
| 拍字（照片+OCR）桥 | `index.html:2090`（`WILD_PHOTO_MAX=30`、`WILD_PHOTO_BUDGET=420KiB`、`WILD_PHOTO_MAX_BYTES=64KiB`）、`2863–2895`（`openWildPhoto`、`nativeOCRBridge`、`cropWildPhoto`、`showWildCandidates`、`window.shiziOCRResult`、`handleWildPhoto`、`clearWildDraft`）；标记 `964–968, 1031, 1013–1016`；接线 `2910–2911` | 拍/选照片→中心裁 256→WebP/JPEG ≤64KiB→原生 Vision 识别候选→用户点选 | postMessage `recognizeChars {requestId,dataURL}`；全局 `window.shiziOCRResult({requestId,candidates})`；存储键 `shizi.wild.v1` | `<input type=file accept=image/*>` | 与 v10 决定冲突 | 需求范围表：“新增相机 OCR、识字服务｜不在本轮范围；保留真实照片查看能力”（`docs/product/foundation/03-需求范围与验收标准.md:81`）；第十稿 C068/C069 只保留“旧记录的照片”查看页（`…文案修改清单…md:93–94`），“旧照片记录默认不算有记录”（`交接备注…md:104`）。即：删采集与 OCR，保留 `shizi.wild.v1` 只读迁移与查看 |
| 开发工具开关 | `index.html:1141`（`DEV_TOOLS`）、`1908`（`renderSettings` 显隐 `#devTools`/`#dataBox`）、标记 `907, 927–945`（题库质检面板） | `?dev=1` 时“我的→设置”出现开发工具、题库质检、实验数据 | URL 参数 `dev=1` | — | 可直接复用 | 原生 `Shizi Dev` scheme 通过 `-shizi-dev` 等价拼上 `?dev=1`（`WebViewController.swift:117–131, 160–163`） |
| SW 注册 | `index.html:3098–3100` | `load` 后 `navigator.serviceWorker.register('sw.js')`，失败吞掉 | — | — | 可直接复用 | 没有 `updatefound`/`controllerchange`/“有新版本”UI；更新落地全靠 SW 自己 `skipWaiting`+`clients.claim`+`client.navigate` 强刷（见 sw.js） |
| 退到后台/回前台 | `index.html:3083–3087` | hidden：停背景音、暂停组计时、写字页则存会话快照；visible：恢复计时、写字页重启背景音 | — | — | 可抽取改造 | 删背景音后只剩计时与快照 |

### 2.2 iOS 壳（Swift / plist / 脚本）

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
|---|---|---|---|---|---|---|
| `LocalWebSchemeHandler` | `ios/ShiziApp/ShiziApp/LocalWebSchemeHandler.swift:1–134` | 把 `shizi-resource://app/<path>` 映射到包内 `Web/<path>`，整块读入并一次性响应 | scheme `shizi-resource`、host `app`（`:4–7`）；响应头 `Content-Type; charset=utf-8`、`Content-Length`、`Cache-Control: no-cache`、`Content-Security-Policy`（同 Web meta）、`X-Content-Type-Options: nosniff`（`:26–37`） | `Bundle.main.url(forResource:"Web")`（`WebViewController.swift:43`） | 可抽取改造 | MIME 表只有 html/js/json+webmanifest/png/css/svg，其余 `application/octet-stream`（`:105–122`）。**没有 `mjs`、`woff2/woff/ttf/otf`、`webp/jpg`、`wasm`、`map`、`txt/md`**。路径处理：空/`/`→`/index.html`，拒绝 `..` 段，标准化后前缀校验，忽略 query（所以 `?v=` 指纹无害）（`:53–79`）。不支持 Range/流式，单次 `didReceive(data)` |
| `WebViewController.init/loadView/viewDidLoad` | `WebViewController.swift:41–103` | 建 `WKWebViewConfiguration`：`websiteDataStore=.default()`、`allowsInlineMediaPlayback`、注册 scheme handler、`shiziNative` message handler（经 `WeakScriptMessageHandler` 防环）、`allowsContentJavaScript`；WebView 不透明关、纸色背景（明/暗）、禁 bounce、`contentInsetAdjustmentBehavior=.never`；安装左缘手势 | — | — | 可直接复用 | `allowsBackForwardNavigationGestures=false`（`:76`），所以 WebKit 自己的前后滑动被禁，Web 端 `popstate` 路径在原生里不会由手势触发 |
| `loadApp`/`devModeEnabled` | `:117–133, 160–163` | 组 URL `shizi-resource://app/index.html[?dev=1]` 并加载 | 启动参数 `-shizi-dev` 或环境 `SHIZI_DEV=1` | — | 可直接复用 | `pageReady=false` 后再 `didFinish` 置真 |
| 返回手势 | `:89–92, 109–115` | `UIScreenEdgePanGestureRecognizer(.left, maxTouches=1)`；`.ended` 时位移 > 24% 宽或速度 > 650pt/s → `window.dispatchEvent(new Event('shizi-native-back'))` | DOM 事件 `shizi-native-back` | Web 端监听（`index.html:2774`） | 可抽取改造 | 非交互式；不满足第十稿“iOS 原生方式的左缘右滑返回”。识别器挂在 webView 上，`cancelsTouchesInView` 默认 true，理论上会取消从屏幕最左缘起笔的触摸（书写格居中，实际很少触及） |
| 提醒目标派发 | `:136–158`（`openReminderTarget`、`dispatchPendingReminderTargetIfReady`） | 通知点开→缓存 cardKey→页面就绪后 `typeof shiziOpenReminderTarget === 'function' && shiziOpenReminderTarget(<json>)`，JS 出错则放回待办 | 调 Web 全局 `shiziOpenReminderTarget(cardKey)` | `AppDelegate.didReceive` | 可直接复用 | 只在 `didFinish` 时重试，页面已就绪时若 JS 出错会一直挂到下一次加载 |
| WKNavigationDelegate | `:1426–1461` | 仅允许 `shizi-resource://app` 内导航；其他主帧导航→`openExternally`（http/https/mailto，其余弹“无法打开这个链接”）并 cancel；`didFinish`→`pageReady`、派发待办提醒、DEBUG smoke；`webViewWebContentProcessDidTerminate`→`loadApp()` 整页重载 | — | — | 可直接复用 | 崩溃重载后靠 Web 端 `SESSION_KEY` 恢复现场（v10 W10）。第十稿“关于页/给我们写信”的 mailto 可走 `openExternally` |
| WKUIDelegate | `:1463–1534` | `alert/confirm/prompt`→`UIAlertController`（标题“拾字”，按钮“知道了/取消/确定”）；`createWebViewWith`（`target=_blank`）→本 webView 加载后走 decidePolicy | — | — | 可直接复用 | 三个处理器都 `guard presentedViewController == nil`，否则立即回 `()/false/nil`——有任何系统面板在场时 `confirm()` 会静默返回 false（见第 5 节） |
| 消息分发 `userContentController` | `:1536–1586` | 校验 `name=="shiziNative"`、主帧、body 是字典且有 `type`；switch 到各处理器；未知 type 忽略 | 见第 3.1 节完整表 | — | 可直接复用 | DEBUG 才有 `nativeSmokeResult` |
| `shareBackup` | `:1275–1298` + `:1258–1273`（`cleanupTemporaryShareFiles`、`temporaryShareURL`） | payload 写到 `tmp/shizi-share-<UUID>-<safeName>`→`UIActivityViewController`；`completed==true` 时 `markBackupExported()`；结束后删临时文件；启动时清理残留 | 调 Web 全局 `markBackupExported()` | — | 可直接复用 | `guard presentedViewController == nil else { return }` 静默丢弃 |
| `sharePracticeCard` | `:1300–1336` | 校验 `data:image/png;base64,` 前缀、≤12MiB、PNG 魔数→写临时 PNG→分享面板 | — | — | 可直接复用 | 文件名补 `.png`，替换 `/ : \` |
| `presentBackupPicker`/`importBackup`/`UIDocumentPickerDelegate` | `:1338–1404, 1934–1941` | `UIDocumentPickerViewController([.json], asCopy:true)`；导入：security scope、≤10MiB（先 `fileSize` 再 `data.count`）、JSON 对象 `app=="shizi"`、`data` 为字典、至少一个 `shizi.` 键、每个键以 `shizi.` 开头且值是可解析 JSON 的字符串；通过后 `restoreBackupPayload(payload,{reload:false})`，`applied` 则 `setTimeout(location.reload,0)`；错误分别弹“超过 10 MB”“无法识别这份文件” | 调 Web 全局 `restoreBackupPayload` | — | 可抽取改造 | 原生**不传** `skipConfirm`，Web 端会再 `confirm()`；结合 WKUIDelegate 的 `presentedViewController` 守卫，存在“选完文件立刻 confirm 被判 false→恢复静默取消”的时序疑点（第 5 节）。校验把备份格式钉死为 “localStorage 键→JSON 字符串” |
| `savePracticeCard`/`sendPracticeCardSaveResult` | `:1588–1629` | PNG 校验→`PHPhotoLibrary.requestAuthorization(.addOnly)`→`creationRequestForAsset`→`window.shiziCardSaved({success})` | 调 Web 全局 `window.shiziCardSaved` | `NSPhotoLibraryAddUsageDescription` | 可直接复用 | v10 文案 C141/C214 决定了成功/失败提示句 |
| `recognizeChars`/`sendRecognizedChars` | `:1631–1696` | `data:image/*` ≤64KiB→`VNRecognizeTextRequest`（accurate、zh-Hans、语言纠正）→每个观察取 top3→`window.shiziOCRResult({requestId,candidates})` | 调 Web 全局 `window.shiziOCRResult` | Vision | 与 v10 决定冲突 | 随拍字 OCR 一并删除；保留会让 `NSCameraUsageDescription` 继续必要 |
| 纸墨声音（原生） | `:1698–1784`（`configureAmbientAudioSession`、`makePaperSoundPlayer`、`playPaperSound`、`paperSoundData`、`appendLittleEndian`）+ lazy `stampSoundPlayer/paperSoundPlayer`（`:39–40`） | 22.05kHz 单声道 16bit WAV 程序合成（stamp 0.22s、paper 0.11s，与 Web `playWebPaperSound` 同一算法）；`AVAudioSession .ambient + .mixWithOthers`（随静音键静默） | 处理 postMessage `sound`、`soundscape` | AVFoundation | 可直接复用（`soundscape` case 可留作 no-op） | `soundscape` 在原生只是设置音频会话类别（`:1704–1706`），声音本体由 Web Audio 产生 |
| 触觉（原生） | `:1786–1809` + lazy 生成器 `:35–38` | stamp=Impact medium、undo/action=Impact light、select=Selection、milestone=Notification success；每次后 `prepare()` | 处理 postMessage `haptic` | UIKit | 可直接复用 | 未知 kind 忽略 |
| 提醒（原生） | `:1811–1932`（`ReminderQuestion`、`syncReminder`、`scheduleReminderWindow`、`requestReminderPermission`、`sendReminderStatus`、`dispatchReminderStatus`） | 每次同步：世代号防交错→删除所有 `shizi.reminder.*` 待发→若 `enabled && questions 非空 && 本机已授权(authorized/provisional)`→从今天起最多 7 条 `UNCalendarNotificationTrigger`（不重复），今天已练或时刻已过则跳过今天；`userInfo.targetCardKey`；权限请求 `.alert,.sound,.badge` | 调 Web 全局 `shiziReminderStatus({permission:'granted'|'denied'|'unknown'})` | UserNotifications、`AppDelegate` | 可直接复用 | 已接受 `hour/minute`，v10 M05 的“选时间”不需要改 Swift。`questions` 按 `day` 去重取首个（`:1878`）；循环 `0...7` 但最多排 7 条（`:1880–1881`） |
| `AppDelegate` | `ios/ShiziApp/ShiziApp/AppDelegate.swift:1–46` | 无 Storyboard/Scene，`UIWindow(rootViewController: WebViewController())`；`UNUserNotificationCenterDelegate`：前台 `willPresent`→`[]`（不弹横幅）；点开→`openReminderTarget(cardKey:)` | — | — | 可直接复用 | — |
| `Info.plist` | `ios/ShiziApp/ShiziApp/Info.plist` | 名称“拾字”、仅竖屏、`UIRequiresFullScreen=false`、`ITSAppUsesNonExemptEncryption=false`、`UILaunchScreen` 空字典、`NSCameraUsageDescription`（拍字）、`NSPhotoLibraryAddUsageDescription`（字卡存相册） | — | `Config/Shared.xcconfig`：`PRODUCT_BUNDLE_IDENTIFIER=com.eimaa.shizi`、`MARKETING_VERSION=0.1.0`、`CURRENT_PROJECT_VERSION=1`；`IPHONEOS_DEPLOYMENT_TARGET=15.0`（pbxproj:242 等） | 可抽取改造 | 删拍字后应删相机用途串；若删存相册功能才删相册串 |
| `PrivacyInfo.xcprivacy` | `ios/ShiziApp/ShiziApp/PrivacyInfo.xcprivacy` | 四项全空/false | — | `verify-bundle-assets.sh` 会 `plutil -lint` | 可直接复用 | 新代码若用 `UserDefaults`、文件时间戳 API、磁盘空间 API 需补 required-reason |
| `sync-web-assets.sh` | `ios/ShiziApp/scripts/sync-web-assets.sh` | Xcode Run Script “Sync Web Assets”（pbxproj:158–173，`alwaysOutOfDate=1`，每次构建必跑）：`rm -rf Web/` 后 rsync 白名单 | 同步清单：`index.html`、`deck-data.js`、`core-strokes.js`、`hanzi-writer.min.js`、`fsrs6.min.js`、`sw.js`、`manifest.webmanifest`、`icon-180/192/512/512-maskable.png`、整个 `data/`（7296 文件，含 `context-overrides.js`、`etymology.json`） | `${SRCROOT}/../..` 为仓库根 | 应重写（改为清单驱动或整目录） | **白名单**：v10 新增的任何目录/文件（模块、CSS、字体、许可文本）不改脚本就不进包 |
| `verify-bundle-assets.sh` | `ios/ShiziApp/scripts/verify-bundle-assets.sh` | 对 `.app`/`.xcarchive` 检查上述文件存在、`data/*.json` 数量与仓库一致、`PrivacyInfo.xcprivacy` 存在且合法 | — | — | 可抽取改造 | 需与新同步清单同步扩展 |
| DEBUG 原生 smoke | `WebViewController.swift:165–1256`（`#if DEBUG`）、`:1486–1489`、`:1562–1565` | `-shizi-smoke`/`SHIZI_SMOKE=1` 时在 `didFinish` 后注入约 1070 行 JS 跑全链路断言，结果 postMessage `nativeSmokeResult` 写到 `Documents/shizi-native-smoke.json`；`window.confirm('__shizi_native_smoke_confirm__')` 被自动放行 | 依赖 Web 内部全局（约 100 个函数：`indexesForChars`、`cardKey`、`persistRecentInk`、`renderHandCardCanvas`、`exportHandCard`、`startFocus`、`exitCurrentRound`、`restoreBackupPayload`、`resumableSession`、`decideSubmission`、`revealAnswer`、`declareDontKnow`、`finishTracing`、`completeChallengeCalibration`、`reminderQuestions`、`normalizeReminder`… ）、约 70 个元素 id（`#startBtn`、`#decisionCorrect/Wrong/Uncertain`、`#traceIntro`、`#pocketBtn`、`#memoryWall`…）、常量 `ADDED_KEY/CUSTOM_KEY/MEMORY_KEY/SESSION_KEY/…`、`practiceHistoryArmed`、`history.state.shiziView` | 应重写 | Release 不含。配套 `scripts/smoke-simulator.sh`、`smoke-device.sh`、`validate-native-smoke.py`、CI 的 `py_compile`/`bash -n`（`.github/workflows/verify.yml:37–38`）。用词全是旧稿（点拨、收字、月帖） |

### 2.3 sw.js

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
|---|---|---|---|---|---|---|
| 版本与壳清单 | `sw.js:9–17` | `importScripts('./core-strokes.js?v=13f7db4fa836')`；`BUILD='8105-3ac0637e30ec-icon-red-hand-20260928'`；`VERSION=\`shizi-v13-${BUILD}\``；`SHELL` 13 项；`CORE_STROKE_PATHS` 来自 `self.SHIZI_CORE_STROKES`（600 字）；`INSTALL_BATCH_SIZE=40`；`STROKE_CACHE_LIMIT=800` | 缓存名 `shizi-v13-<BUILD>` | `core-strokes.js`（由 `scripts/build_8105_chars.py` 生成，注释 `core-strokes.js:1`） | 可抽取改造 | BUILD 命名 = `<字库编号>-<deck-data 内容指纹 12 hex>-<可读标签>-<yyyymmdd>`，必须与 `index.html:9` 的 meta、`SHELL` 里的 `deck-data.js?v=` 完全一致（`scripts/verify_pwa_upgrade.js:47–97` 强校验） |
| 笔顺缓存治理 | `sw.js:19–33`（`isStrokeRequest`、`trimStrokeCache`） | 同源 `/data/<x>.json`（排除 `etymology.json`）；超 800 时按 `cache.keys()` 顺序删非核心项 | — | `CORE_STROKE_URLS` | 可直接复用 | 近似 FIFO 而非 LRU；每次写入后触发裁剪 |
| 写缓存容错 | `sw.js:35–55`（`putCachedResponse`、`cacheResponseBestEffort`、`updateCacheFromNetwork`、`cachedFromVersion`、`cacheIfOk`） | 配额满/隐私模式下写失败不影响响应；只认当前 VERSION 缓存 | — | — | 可直接复用 | — |
| `networkThenCache` | `sw.js:57–67` | `fetch(new Request(req,{cache:'reload'}))`；ok 则返回并缓存；否则交给 fallback，再退回原错误响应或 `Response.error()` | — | — | 可直接复用 | 注释解释了 503 不能当脚本执行的教训 |
| 安装 | `sw.js:69–88`（`cacheCoreStrokes`、`cacheFreshShell`、`install`） | `cache.addAll(SHELL)` 原子写入→核心 600 字按 40 一批 `allSettled` 尽力缓存→`skipWaiting()` | — | — | 可直接复用 | 壳任何一项失败＝安装失败（旧 worker 继续） |
| 激活 | `sw.js:90–103` | 删除所有 `shizi-` 前缀且≠VERSION 的缓存→`clients.claim()`→若删过旧缓存则对所有窗口 `client.navigate(client.url)` 强制刷新 | — | — | 可抽取改造 | 强刷不看用户是否在写字（第 5 节） |
| fetch 路由 | `sw.js:105–144` | 非 GET/跨源放行；HTML（navigate 或 accept 含 text/html）网络优先，4xx 不用缓存冒充，5xx/408/429/断网回落同 URL 或 `index.html`；关键指纹资源（pathname 以 `/deck-data.js`、`/core-strokes.js`、`/data/context-overrides.js` 结尾）网络优先任何非 ok 回落；笔顺缓存优先+`waitUntil` 后台刷新；其余缓存优先缺则取并存 | — | — | 可直接复用 | 头注释“跨源（jsdelivr 兜底）”已过时：`charLoader`（`index.html:2270–2273`）只取本地，且 CSP `connect-src 'self'` 会拦 CDN |

## 3. 数据契约

### 3.1 JS → 原生（`window.webkit.messageHandlers.shiziNative.postMessage(body)`，body 必须是含 `type` 的对象且来自主帧）

| type | 字段 | 发送方 | 原生处理 |
|---|---|---|---|
| `shareBackup` | `name:string`（默认 `shizi-backup.json`）、`payload:string`（备份 JSON 文本） | `exportBackup` `index.html:3014–3016` | 写临时文件→分享面板→完成回调 `markBackupExported()` |
| `pickBackup` | 无 | `requestBackupImport` `index.html:3058–3060` | 文档选择器→校验→`restoreBackupPayload(payload,{reload:false})` |
| `sharePracticeCard` | `name:string`（默认 `shizi-card.png`）、`dataURL:"data:image/png;base64,..."`、`kind?: "character"|"monthly"`（原生忽略） | `exportHandCard`（share）`index.html:2948`、`sharePracticeCard` `2980`、`shareMonthlyPost` `1959` | 校验 PNG ≤12MiB→分享面板 |
| `savePracticeCard` | `dataURL`、`kind:"character"`、`name`（原生只用 dataURL） | `exportHandCard`（save）`index.html:2948` | 存相册→`window.shiziCardSaved({success})` |
| `haptic` | `kind: "stamp"|"undo"|"action"|"select"|"milestone"` | `hapticFeedback` `index.html:1379` | 触觉 |
| `sound` | `kind: "stamp"|"paper"` | `soundFeedback` `index.html:1341` | 播放合成 WAV |
| `soundscape` | `kind: "rain"|"fire"` | `startAmbient` `index.html:1366` | 只设 AVAudioSession ambient+mixWithOthers |
| `syncReminder` | `enabled:bool`、`hour:int`、`minute:int`、`practicedToday:bool`、`questions:[{day:"YYYY-MM-DD",title,body,targetCardKey}]`（≤8 条，target 去重）、以及被原生忽略的旧字段 `title/body/targetCardKey`（首题） | `syncReminder` `index.html:1399–1404` | 清空并重排最多 7 天通知 |
| `requestReminderPermission` | 无 | `index.html:1405` | `requestAuthorization`→`shiziReminderStatus({permission:'granted'|'denied'})` |
| `queryReminderStatus` | 无 | `index.html:1406` | `getNotificationSettings`→`shiziReminderStatus({permission:'granted'|'denied'|'unknown'})`（authorized/provisional/ephemeral→granted） |
| `recognizeChars` | `requestId:int`、`dataURL:"data:image/(webp|jpeg);base64,..."`（≤64KiB） | `handleWildPhoto` `index.html:2877` | Vision→`window.shiziOCRResult({requestId,candidates:[string]})` |
| `nativeSmokeResult`（DEBUG） | `payload:string` | smoke 脚本 | 写 `Documents/shizi-native-smoke.json` |

### 3.2 原生 → JS（`evaluateJavaScript`）

| 调用 | 形式 | 何时 | Web 端定义 |
|---|---|---|---|
| `shiziOpenReminderTarget(cardKey)` | `typeof shiziOpenReminderTarget === 'function' && shiziOpenReminderTarget("<json string>")` | 通知点开且 `pageReady` | `index.html:1395–1397`：`indexForCardKey`→有可续会话则恢复并把该字插到下一题（toast），否则 `startFocus([idx])`；返回 bool |
| `markBackupExported()` | `if (typeof markBackupExported === 'function') markBackupExported(); void 0;` | 分享面板 `completed` | `index.html:2996`：写 `backupMeta.lastExportAt=Date.now()`，记漏斗 `backup_exported`，刷新备份 UI |
| `window.shiziCardSaved({success})` | `if (typeof window.shiziCardSaved === 'function') ...` | 存相册完成 | `index.html:2954`：toast “字卡已存到相册 / 没能保存到相册…” |
| `window.shiziOCRResult({requestId,candidates})` | `if (typeof window.shiziOCRResult === 'function') ...` | Vision 完成 | `index.html:2874`：`requestId` 不匹配当前 `wildOCRRequest` 则丢弃 |
| `restoreBackupPayload(payload,{reload:false})` | 未加 typeof 守卫；返回 `{applied,keys}`；applied 时原生 `setTimeout(location.reload,0)` | 文档选择完成并通过原生校验 | `index.html:3047–3055` |
| `shiziReminderStatus({permission})` | `if (typeof shiziReminderStatus === 'function') ...` | 权限请求/查询回调 | `index.html:1408–1411`：写 `reminder.permission`，若 `reminderPendingEnable` 且 granted 则 `enabled=true`，随后 `syncReminder()`+`renderReminderUI()` |
| `window.dispatchEvent(new Event('shizi-native-back'))` | 左缘手势达阈值 | — | `index.html:2774` |

### 3.3 存储键（本范围涉及）

- `shizi.reminder.v1`（`normalizeReminder` `index.html:1304–1309`）：`{enabled:bool, promptDismissed:bool, permission:"granted"|"denied"|"unknown", milestonesShown:int[], characterMilestonesShown:int[], characterMilestoneDay:"YYYY-MM-DD"|""}`。注意提醒开关与里程碑状态混存一键。
- `shizi.sound.v1`（`normalizeSound` `1321`）：`{enabled:bool(默认 true), tipShown:bool, scene:"off"|"rain"|"fire"}`。
- `shizi.handCard.v1`（`normalizeHandCardPref` `1323`）：`{promptEnabled:bool(默认 true), lastPromptDay:"YYYY-MM-DD"|""}`。
- `shizi.backupMeta.v1`：`{lastExportAt:number, summaryPromptShown:bool,...}`（`2996, 2994`）。
- `shizi.safety.v1`（`captureSafetySnapshot` `3005`）：`{version:1, createdAt, reason:"restore"|"reset", pendingUndo:true, offeredAt:number, payload:<备份对象>}`；刻意不进备份（`2986` 注释）。
- `shizi.wild.v1`：`{version:1, captures:{}, wishes:{}}`（smoke 写入形状 `WebViewController.swift` smoke 行 605 附近）；照片为 ≤64KiB 的 webp/jpeg dataURL，总预算 420KiB、最多 30 张（`index.html:2090`）。
- `shizi.nativeSmoke.v1`：smoke 专用 ISO 时间串，刻意排除在备份外。
- `shizi.corrupt.<原键>`：启动期形状不合法的原文隔离（`1076`）。
- `history.state`：`{shiziView:"home"|"practice"}`（`1769`）。
- 备份文件：`{app:"shizi", version:1, date:ISO, data:{"<shizi.*>": "<JSON 字符串>"}}`（`backupPayload` `2998–3001`）；`BACKUP_KEYS` 21 个键（`2987`）。原生导入校验规则见 2.2 `importBackup`。
- 通知：identifier `shizi.reminder.<yyyy-MM-dd>`（en_US_POSIX 公历），`userInfo.targetCardKey`（`WebViewController.swift:1838, 1893–1897`）。
- 临时分享文件：`tmp/shizi-share-<UUID>-<safeName>`；启动时清理前缀 `shizi-share-`（`:26, 1258–1273`）。
- 启动参数/环境：`-shizi-dev`/`SHIZI_DEV=1`（→`?dev=1`）；`-shizi-smoke`/`SHIZI_SMOKE=1`（DEBUG）。脚本用法见 `smoke-simulator.sh:33–35,81`、`run-device.sh:100–104`。

### 3.4 SW/资源指纹契约

- `index.html:9` `shizi-asset-build` 必须 == `sw.js:11` `BUILD`；`sw.js:13` `SHELL` 必须含与 `index.html:1035` 完全相同的 `deck-data.js?v=<sha12>`；`index.html:1036` 的 `data/context-overrides.js?v=<sha12>` 与 `sw.js:9` 的 `core-strokes.js?v=<sha12>` 都要是对应文件内容指纹（`scripts/verify_pwa_upgrade.js:91–97`；`scripts/build_8105_chars.py:839` 注释“数据更新后必须同步 index.html/sw.js 的内容指纹与 BUILD”）。
- 缓存名前缀 `shizi-`；激活时删除其他前缀相同者。
- `manifest.webmanifest`：`start_url:"./?source=pwa"`（代码里没有任何地方读 `source=pwa`）、`scope:"./"`、`display:standalone`、`orientation:portrait`。

## 4. 与第十稿（v10）决定的关系

### 4.1 保留（原生能力可原样或小改沿用）

- **触觉**：`haptic` 五档；v10 未给规格。`milestone` 档若删里程碑将无调用点。D19/D20 改了判断页与结果行，`stamp/undo/action/select` 的触发点会挪到新的“写对了/写错了”按钮和“修改”入口，但 kind 集合可不变。
- **提醒**：保留原生无状态执行器与 `shizi.reminder.*` 契约。需改：(a) v10 M05 “开提醒时选时间、开了给反馈”→存储加用户时间，替代 `medianPracticeTime`；(b) 文案 C080/C084/C085（`…文案修改清单…md:105,109,110`）；(c) 候选集合改按 D23 “写错过＝最近一次有效记录为写错；跳过/看过答案不算”；(d) `shiziOpenReminderTarget` 的“插到当前组下一题 / 开专项组”行为要按 D05（普通 A 与临时 B 隔离、不自动进 A）重新定义。
- **图片分享/存相册**：`sharePracticeCard`/`savePracticeCard` 与回调 `shiziCardSaved` 保留；内容层面 v10 要求单字图片按 A05 版式、竖版排法按 T06-C（`交接备注…md:53–55`），文案 C102/C141/C214；年度报告不导出（C074）。D11 “月图取月内最后判断”与 v10 M02 “字帖格子用这个月第一次写这个字的笔迹”在本文档范围外互相矛盾，需其他读者/产品核对。
- **备份挑选/分享**：`pickBackup`/`shareBackup`/`markBackupExported`/`restoreBackupPayload` 契约保留；D24 要求撤销在备份页常驻直到离开并留结论句（现 10 秒浮条 `index.html:3010` 需改）；K02 状态句只按记录与上次导出算、无记录不催导出（现 `renderBackupUI` `2990–2992` 有 14 天/30 天“紧急”逻辑要按 v10 重写）；K03 必测。
- **返回手势**：`shizi-native-back` 事件可保留为兜底，但第十稿“页面切换一律 iOS 原生方式，包括左缘右滑返回”（`交接备注…md:38,143`）意味着要么原生多 WebView/导航栈，要么 Web 内做跟手的交互式返回。当前阈值触发方案不满足。
- **存储门禁**：概念保留（R14 “失败不伪装成功”），文案按第十稿“存储阻断”一组重写。
- **`?dev=1` / `Shizi Dev` scheme**：产品工具，v10 未涉及，可保留。
- **崩溃重载 + 会话恢复**：`webViewWebContentProcessDidTerminate→loadApp` 与 v10 W10 “离开或刷新后回到离开时的阶段，含判断页、笔迹与参考字形”一致，要求新存储在每个阶段都落快照。

### 4.2 改变

- **欢迎页**：D17 去掉介绍页与首题说明卡→`VIEW_IDS.welcome`、`#welcomeRestore` 备份入口、`welcome_shown` 漏斗、`renderCalibrationReturnHook`（校准结果页的“开启提醒”钩子 `index.html:1436–1441`）都要重定位。
- **结果页**：D20 写完最后一字直接进结果页、去掉中间页→`roundSummary` 的印章延时触觉、里程碑横条、“存为字帖/里程碑字帖”按钮文案要按 v10 结果页重画。
- **补记**：D24 去掉补记→`activeMode==="makeup"`、`makeupTargetDay`、`#makeupSheet`（`index.html:989–993`）、`markRoundComplete` 的补记分支（`1289`）及其触觉/提醒路径删除。
- **术语**：D04/文案第零节：点拨→提示、收字→添加、月帖→月份图片、需要再练→写错过；原生 README、DEVICE_QA、smoke 脚本内的用词全部是旧稿。

### 4.3 删除或存疑

- **拍字 OCR**：删（`03-需求范围与验收标准.md:81`）。删 `recognizeChars`/`shiziOCRResult`/相机 `<input>`/`NSCameraUsageDescription`；保留 `shizi.wild.v1` 只读查看（C068/C069）。
- **里程碑庆祝**：v10 设计文档无此物，D01 不以断签/闯关推动→建议删除 `MILESTONE_*`、`characterMilestone*`、`milestoneLine`、`milestone` 触觉；若保留需产品新决定。
- **字卡每日提示**：D10 待定，“定不下来就删掉”。
- **练字背景音**：见第 6 节 Q1——仓库证据不支持“#166 已删”，反而 V03 与 IA 树仍保留“背景音”。工程上删除代价低（Web `1342–1368`、`1374`、`3084/3087`、`sound.scene` 字段、`#soundscapeRow`；原生 `case "soundscape"` 可留 no-op）。
- **纸墨声音**：v10 C079 把设置行叫“按键音”，与现有“只在盖章与描红落笔时响”的语义可能不同，需确认是重命名还是换行为。
- **年度报告导出**：C074 明示不做，现有 `annualPanel` 没有导出，无需处理。

## 5. 风险与坑

1. **`.mjs`/字体/其他 MIME 在原生里会被 nosniff 拦掉**：`LocalWebSchemeHandler.mimeType` 无 `mjs` 分支→`application/octet-stream`+`X-Content-Type-Options: nosniff`（`LocalWebSchemeHandler.swift:37,105–122`）。`<script type="module" src="x.mjs">` 会以 MIME 错误失败；用 `.js` 扩展名则 `text/javascript; charset=utf-8` 合法。D13 要随包分发 ShiziKai/Noto Serif SC WOFF2（`docs/handoff/engineering.md:71–75`）——`woff2` 同样落到 octet-stream；WebKit 一般不按 MIME 拒绝字体，但应补表。`webp/jpg/wasm/map/txt` 同理。**结论：原生壳可以加载 ES 模块，前提是扩展名 `.js` 或补 `.mjs` MIME。**
2. **模块脚本不需要 CORS 头**：文档与模块同源（`shizi-resource://app`），module 请求为 same-origin CORS 模式，无需 `Access-Control-Allow-Origin`；`connect-src/script-src 'self'` 也覆盖。但 `window.isSecureContext` 在自定义 scheme 下的取值仓库中无证据，任何依赖安全上下文的 API（`crypto.subtle`、`navigator.share`、`getUserMedia`、SW）都不能假设可用。Web Worker（`worker-src 'self'`）在自定义 scheme 下也未验证。
3. **同步脚本是白名单**：`sync-web-assets.sh` 只复制固定文件+`data/`；模块拆分（`src/`）、样式、字体、许可文本都要显式加入，`verify-bundle-assets.sh` 也要同步扩展；否则真机白屏而桌面浏览器正常（`engineering.md:58` 已警示）。
4. **原生 DEBUG smoke 与 Web 内部深度耦合**：约 1070 行内嵌 JS 直接调用 100+ 个内部函数、70+ 个元素 id、若干存储常量（见 2.2）。v10 重写后必然全红；CI 只做 `py_compile`/`bash -n`，不会提前暴露。要么随新架构重写为公开测试 API，要么先移除以免误导。
5. **`confirm()` 与系统面板的时序**：`importBackup` 在 `documentPicker(didPickDocumentsAt:)` 回调里立刻 `evaluateJavaScript(restoreBackupPayload(...))`（`WebViewController.swift:1387–1400`），未传 `skipConfirm`，Web 会 `confirm()`；WKUIDelegate 的 confirm 在 `presentedViewController != nil` 时直接返回 false（`:1492–1495`）。若选择器尚未完全 dismiss，恢复会被静默取消且无任何提示；`presentError` 同样被守卫吞掉（`:1407`）。smoke 用 `skipConfirm:true` 绕过了这条路径（smoke 行 608 附近），未被覆盖。接入 D24/K03 前必须真机验证。
6. **原生分享/挑选静默失败**：`shareBackup`/`sharePracticeCard`/`presentBackupPicker` 都 `guard presentedViewController == nil else { return }`，Web 端收不到任何回调；D24 状态句依赖 `lastExportAt`，只在 `completed==true` 时写入。取消分享不算导出——正确，但“面板根本没弹出”与“取消”对 Web 不可区分。
7. **SW 激活强刷**：`activate` 删旧缓存后对所有窗口 `client.navigate(client.url)`（`sw.js:96–101`），且 install 即 `skipWaiting`。PWA 用户正在写字时发布新版会被强制刷新；现场只靠 `SESSION_KEY` 快照（每笔/每步 `saveSessionSnapshot`），未落盘的一笔会丢。与 D07“失败留现场”相抵触的边界：若刷新前一次 `save()` 因配额失败，状态会回退到上一个成功快照。
8. **指纹三处同步**：改 `deck-data.js`、`data/context-overrides.js`、`core-strokes.js` 或 `index.html` 任一，都要同时改 `index.html:9,1035,1036`、`sw.js:9,11,13`；漏一处 `verify:pwa` 失败，漏检则老用户拿到 503 时缓存回落失效。
9. **笔顺缓存裁剪是 FIFO**：`trimStrokeCache` 按 `cache.keys()` 顺序删（`sw.js:23–30`），常用非核心字可能被先淘汰。
10. **提醒只在打开 App 时刷新**：原生每次同步最多排 7 天；用户 7 天不打开就再无通知——这是设计（无状态），但 v10 若要“每天提醒”语义需说明。`willPresent` 返回 `[]`，前台永不弹横幅。
11. **原生权限与备份漂移**：换机恢复后 `reminder.enabled=true` 而本机 `permission` 未知，Web 靠 `queryReminderStatus`（启动 `index.html:3082`）和“需要重新授权通知，点此开启”文案处理（`1413`）；新存储若不保留 `permission` 字段要重做这段。
12. **`shizi.reminder.v1` 混装里程碑**：删里程碑时不能简单丢键，`normalizeReminder` 会补默认；备份 `normalizeBackupValue` 也调它（`3030`）。
13. **`reportRuntimeFailure` 过敏**：任何 `window.error`/`unhandledrejection` 都弹“页面发生异常，请先导出备份”（`index.html:1068–1070`）。模块化后需要更细的错误边界，否则第三方脚本的良性错误也会吓到用户。
14. **左缘手势与书写**：`UIScreenEdgePanGestureRecognizer` 加在 webView 上（`WebViewController.swift:89–92`），v10 W15 把书写格放大到约 258pt/360 宽，格子左缘距屏幕约 51pt，仍不在边缘识别区；但若改成全宽格或横屏（Info.plist 仅竖屏）需重估。手势只在 `.ended` 判定，不会给 Web 中间态。
15. **`webViewWebContentProcessDidTerminate` 重载丢内存态**：一切未落 localStorage 的状态（当前笔、未确认的判断）丢失；v10 W10 要求含判断页都可恢复，快照粒度要覆盖。
16. **`UILaunchScreen` 为空字典**：启动到 WebView 首帧之间可能出现系统默认白/黑闪屏，与 `webView.backgroundColor` 纸色不一致。
17. **`Info.plist` 用途串**：只要页面上还有 `<input type=file accept="image/*">`，WKWebView 弹相机选项就需要 `NSCameraUsageDescription`，否则崩溃；删拍字必须同时删 `<input>`。
18. **`PrivacyInfo.xcprivacy` 全空**：现有代码只用 `fileSizeKey`（不在 required-reason 列表）。新代码若引入 `UserDefaults`、`.contentModificationDateKey`、磁盘空间查询，须补 NSPrivacyAccessedAPITypes，否则上传 TestFlight 被拒。
19. **CSP 双写**：`index.html:5` 与 `LocalWebSchemeHandler.swift:33` 必须逐字同步；若 v10 把所有 JS 外置并去掉 `'unsafe-inline'`，任何内联 `onclick=`/`<style>` 也会一起失效（`style-src` 也有 `'unsafe-inline'`，可分别处理）。
20. **`sw.js` 在原生里是死资源**：注册永不成功（自定义 scheme 无 SW），同步进包只增 7.5KB；但若未来改用 `WKAppBoundDomains`+https 本地服务器方案，SW 的强刷逻辑会突然生效于原生，需重新评估。
21. **PWA `start_url=./?source=pwa`** 无人消费；`DEV_TOOLS` 读 `dev` 参数（`index.html:1141`），二者并存无冲突，但新路由方案若改 query 处理要保留 `dev=1`。

## 6. 未解问题

- **Q1 背景音是否删除**：任务书引用 issue #166，仓库内（docs/、CHANGELOG.md、README.md、`git log --grep=166`）无任何记录；第十稿边开发边改清单 V03（`…边开发边改清单…md:66`）与 IA 树（`04-用户旅程与信息架构.md:36`）仍把“背景音”列为设置项。需要产品负责人确认 #166 的结论并写进 `decisions.md`。
- **Q2 里程碑**：v10 设计文档无里程碑；D01 精神上反对；但没有明文“删除”决定。默认删除是否成立？`characterMilestoneDay` 对备份提醒的压制逻辑一起删？
- **Q3 纸墨声音在 v10 里的语义**：C079 “操作音效→按键音”是改名还是改成通用按键点击音？是否仍只在“写对了/写错了”确认与描红落笔响？
- **Q4 通知点开的目标行为**：`shiziOpenReminderTarget` 现在会把字插进正在进行的组或开单字专项组；按 D05（A/B 隔离、B 结束回来源、不自动进 A）应算哪种会话？
- **Q5 返回手势的实现层**：第十稿要求“iOS 原生方式的左缘右滑返回”。是接受“单 WebView + Web 内跟手动画”还是要原生导航栈（多 WebView）？后者会改变 localStorage 共享、状态传递与 SW 假设。
- **Q6 `isSecureContext`/Worker 在 `shizi-resource://` 下的可用性**：仓库无证据；若新笔迹管线用 OffscreenCanvas/Worker 或 `crypto.subtle`，需先在真机验证。
- **Q7 提醒时间**：M05 要“选时间”，但 O06（`03-需求范围与验收标准.md:99`）说提醒规则的真实映射待工程列现状、产品裁决。新存储是保留自动中位时间作默认值还是完全手选？
- **Q8 备份格式是否仍为“localStorage 键→JSON 字符串”**：原生 `importBackup` 校验钉死了这一形状（`WebViewController.swift:1366–1379`）。若 v10 新存储改 IndexedDB 或分层键，Swift 校验必须同步改，否则所有新备份被“无法识别这份文件”拒绝。
- **Q9 D11 与 v10 M02 对月份图片取墨口径相反**（最后判断 vs 月内第一次）——超出本范围，需在图片模块读者处核对。
- **Q10 DEBUG smoke 的去留**：重写成与新架构解耦的公开测试钩子，还是先删除并把 `smoke-*.sh`/`validate-native-smoke.py`/CI 语法检查一并处理？
