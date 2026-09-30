# A · index.html — 本地存储、备份/恢复、安全副本、迁移

> 范围：`/Users/orange/Documents/ChatGPT/astraworld/shizi-app/index.html` 的「本地存储」段（L1058–1309）、「数据备份 / 恢复」段（L2986–3079），以及全文件里所有读写 `localStorage` 的函数（会话快照 L1484–1540、稳定键 L1541–1543、自定义字/拍字照片 L2088–2119、盖章撤销快照 L2433–2449、存储压力 L2860–2861）。同时对照 `ios/ShiziApp/ShiziApp/WebViewController.swift` 的备份桥（L1275–1298、L1338–1412、L1548–1560）和 `scripts/verify_8105_app.js` 的存储回归。所有行号均指 index.html，除非另注。

## 1. 概览

拾字目前把 **localStorage 当作唯一持久层**，没有 IndexedDB、没有服务端。启动脚本在 L1058–L1137 声明 22 个 `shizi.*` 键，并用一套「逐键形状表 + 隔离坏值 + 规范化」的启动链（`bootLoad`/`bootNormalize`/`STORED_SHAPE`，L1079–L1111）把每个键读进模块级 `let` 变量；之后所有写入都走 `save(key, value)`（L1072）——每次整键 `JSON.stringify` 覆盖写，没有增量。数据模型以「稳定卡键」`base:<字>` / `custom:<字>` 为主键（L1541–L1543），memory、quality、deck、FSRS 日志、活动记录、会话快照都靠它互相引用。

容量控制全部是「按键内部裁剪」：memory 里的近期墨迹 `recentInk` 最多 96 份 / 420 KiB（L1144），拍字照片最多 30 张 / 420 KiB、单张 ≤64 KiB（L2090），FSRS 原始事件保留 120 天后折叠成月汇总（L1205），活动日记录保留 400 天后折叠成月汇总（L1265），漏斗保留 512 seen / 256 events / 180 rounds（L1239）。

备份是「白名单键的原始 JSON 字符串」再包一层 `{app:"shizi",version:1,date,data}`（L2988、L2998–L3001）；恢复前用同一张 `STORED_SHAPE` 整单校验并规范化，然后先写 `shizi.safety.v1` 安全副本再整体替换（L3031–L3055），替换后 `location.reload()`，启动时弹一次 10 秒的撤销条（L3010–L3011、L3078）。

与第十稿的关系：机制层（形状校验、隔离、安全副本、白名单）大体可保留；**数据语义层与 D17/D18/D21/D22/D23/D24 多处冲突**——今天「看答案」直接记成 `miss`（L2608）、加自选字会凭空制造一条 `miss` 记录（L2123–L2136）、撤销只活 10 秒且和页面无关（L3011）、补记结构遍布 activity/session/funnel。且 **写错那一次的墨迹根本不落盘**（L1831 只在 `!hard` 时 `persistRecentInk`），第十稿 K28/L05「写错过清单右侧显示那次笔迹小图」在现有数据模型下无法实现。

## 2. 组件/模块清单

| 名称 | 位置 | 职责 | 对外接口 | 依赖 | 复用判断 | 备注 |
|---|---|---|---|---|---|---|
| 存储键常量 | L1059–L1062 | 声明 22 个 `shizi.*` 键名 | `DECK_KEY`…`LIB_KEY`（见 §3 全表） | — | 可抽取改造 | `DECK_KEY="shizi.deck.v8105.context2"` 是唯一带内容版本号的键；其他都是 `.v1`，但内容已升到 v2/v3（session、fsrs、funnel、activity）而键名不变 |
| 存储故障上报层 | L1063–L1070；DOM L1026–L1028；L3079–L3080 | 读失败→模态 `storageGate`（阻断整个 App）；写失败→顶部 `storageNotice`（区分 QuotaExceeded 与其他）；运行时异常→同一 notice | `showStorageNotice(msg)`、`showStorageGate()`、`reportStorageReadFailure()`、`reportStorageWriteFailure(err)`、`reportRuntimeFailure()`；状态 `storageReadable/storageWriteFailed/storageRuntimeFailed`；`window.error/unhandledrejection` 监听 | DOM | 可直接复用（思路） | 写失败文案固定为「这次进度没有保存」，但 `saveMemory`/`saveWildState` 的降级重试会先触发一次失败上报再成功（见 §5） |
| 基础读写 | L1071–L1073 | `load/save/removeStored` 的 try/catch 包装 | `load(k,d)`、`save(k,v)→bool`、`removeStored(k)` | 上报层 | 可直接复用 | `load` 遇到坏 JSON 静默返回默认值，不隔离（隔离只在 `bootLoad`） |
| 启动隔离 | L1074–L1080；DOM L1026；L3079 | 坏值原文搬到 `shizi.corrupt.<key>`、删原键、记 `bootCorruptKeys`，启动后顶部提示 5 秒 | `quarantineStoredKey(k,raw)`、`readStoredRaw(k)`、`bootLoad(k,d,valid?)`、`bootNormalize(k,value,fallback,normalize)` | `storedShape` | 可直接复用 | `shizi.corrupt.*` 永不清理、不进备份（§5） |
| 形状表 | L1081–L1111 | 每键唯一一份合法形状判定；启动隔离与备份校验共用 | `STORED_SHAPE[key]`、`storedShape(key)`、`plainObject`、`nullOr`、`stringArray`、`objectValuesAre` | `storedSessionShape`（L1525，函数声明提升） | 可抽取改造 | 注释 L1083–L1085 说明「分开写过一次导致备份报成功而启动静默丢键」的教训，值得保留这个设计原则 |
| 启动加载序列 | L1112–L1137、L1200–L1201、L1219–L1221、L1238、L1253、L1273、L1275、L1316、L1322、L1324、L2088、L2101、L2117–L2119 | 依次把 22 键读入模块变量并立刻回写 | 全局 `let status/memory/quality/preference/tuning/libraryState/fontScaleLarge/fsrsReviewLog/fsrsReviewMonthly/opens/funnel/activity/backupMeta/reminder/sound/handCardPref/customWords/wildState/addedChars` | 上述全部 | 应重写 | 每次启动至少 12 次 `save`（含 `migrateStableCardIdentity` 固定回写 5 键，L2116）；顺序敏感（L1053–L1055 注释 TDZ） |
| 在学字库 | L1121–L1134 | 四库定义、旧六库 id 迁移、`userSelected` 保留 | `LIBRARIES`、`normalizeLibrary(raw)`、`setLibrary(id)`、`syncCalibrationLibrary()`、`currentLibrary()` | `preference` | 可直接复用（去掉 LEGACY 分支） | `defaultLibraryId()` 依赖 `preference==="challenge"`，第十稿若去掉偏好档要重定默认库 |
| 近期墨迹容量 | L1144、L1176–L1180、L1807–L1810 | 每字一份 120×120 WebP(q .68) + 压缩后的笔画（≤36 笔×24 点，归一化 0–1）；总量 96 份/420 KiB；写失败按最旧逐份删 | `RECENT_INK_MAX/RECENT_INK_BUDGET`、`isRecentInkDataURL(v)`（≤32 KiB UTF-16）、`recentInkRows()`、`trimRecentInk()`、`saveMemory()`、`persistRecentInk(m,strokes,at)` | canvas、`drawShareHandwriting` | 与 v10 决定冲突 | 仅在 `!hard`（写对）时持久化（L1831）；每次写对覆盖上一份；D14/决定表明言「不以旧 96 份/420KiB 当新政策」 |
| 墨迹/快照规范化 | L1145–L1175 | 笔画数组、提交快照、验证结论、盖章几何的严格类型清洗，供导入侧与渲染侧共用 | `normalizedInkStrokes`（≥2 点）、`normalizedSessionInkStrokes`（≥1 点，保留 t/p/w/v）、`safeSessionInkShape`、`normalizedSubmissionVerdict`、`normalizedSubmissionSnapshot`（compositeImage ≤2 MiB PNG）、`withoutPersistedHandwriting`、`normalizedStampGeometry` | `cloneObj`（L2405） | 可直接复用 | 两套最小点数规则（L1151–L1153 注释）是刻意区分，重写时别合并 |
| 日期工具 | L1183–L1188 | 本地时区日键、月键、校验 | `dayKey(d)`、`today()`、`shiftDay(key,n)`、`dayStartMs(key)`、`validDayKey`、`validMonthKey` | — | 可直接复用 | 全部本地时间；FSRS 事件另存 `timeZone` 字串 |
| 稳定卡键 | L1541–L1543、L1189、L1392–L1393、L1056 | `base:<字>` / `custom:<字>`；旧 `custom:<idx>:<字>` 收敛；从键反查索引 | `cardKey(i)`、`cardTargetFromKey(key)`、`canonicalCardKey(key)`、`storedCardKey(v)`（≤80 字符、白名单前缀 base/custom/legacy）、`indexForCardKey(key)`、`BASE_BY_CHAR` | `CARDS`、`customIndexOf` | 可直接复用 | 键只到「字」粒度，不区分同字不同词的卡；`legacy:<n>` 只出现在 activity（L1284） |
| 键迁移 | L1192–L1193、L2106–L2117 | 旧键合并：memory 取计数最大/最新 last；quality 按位或；deck 丢弃纯数字键并按 memory 推导 `indeck/rest`；同步改 FSRS 事件与 activity 引用 | `mergeQualityRows`、`migrateCustomKeyedRows`、`mergeStableRows`、`migrateStableCardIdentity()` | 全部记录变量 | 应重写（D15 下可整体删除） | 每次启动都跑并回写 5 键（L2116–L2117） |
| FSRS 日志 | L1196–L1235 | 事件规范化、120 天折叠到月汇总、序列化 ts-fsrs 卡、旧 `due`→`dueDay` 迁移、`firstSeenAt` 补齐 | `normalizeFSRSEvent/Monthly/Stored`、`compactFSRSReviews(now)`、`saveFSRSLog()`、`serializeFSRSCard/deserializeFSRSCard`、`normalizeLegacySchedule(m)`、`migrateFirstSeenAt()`、`applyFSRSReview(idx,rating,reason,attemptId,details)`、`fsrsEventId(attemptId)="<attemptId>:fsrs"`、`FSRS_CONFIG` | `window.FSRS`（fsrs6.min.js） | 可抽取改造 | 事件不保存「复习前的卡状态」，因此无法在事后（结果页）撤销任意一张卡的判断（D19，§4） |
| 打开日 | L1238、L1260–L1264 | 每日启动追加日期；旧 streak/累计天继承 | `opens`、`maybeRecordD2Return()`、`legacyStreakThrough()`、`legacyDaysBefore()` | funnel、activity | 应重写/删除 | 只服务旧口径继承与 d2 漏斗 |
| 本地漏斗 | L1239–L1259 | 幂等事件、分歧计数、整组时长；无设备标识 | `newFunnel()`、`normalizeFunnel()`、`saveFunnel(compact)`、`recordFunnelOnce/Comparison/Round`、`projectedFunnelEvent` | `roundId`、`activeMode` | 可抽取改造 | `FUNNEL_MODES` 含 `"makeup"`、`"calibrate"`（D24/D17 后失效） |
| 活动记录 | L1265–L1307 | 日/月两层：盖章数、尝试数、目标键、独立完成键、复习预算键、完成组 id、补记标记；400 天折叠 | `newActivity()`、`normalizeActivity/Day/Month`、`saveActivity()`、`compactActivity()`、`archiveActivityDay()`、`dailyActivity(key)`、`markPracticeStamp(idx,outcome)`、`markRoundComplete()`、`completedDayCount()`、`totalPracticeDays()`、`monthPracticeDays()`、`medianPracticeTime()` | `cardKey`、`roundId`、`activeMode`、`makeupTargetDay` | 与 v10 决定冲突 | `makeup/makeupAt/makeupDays`、`inheritedStreak/inheritedTotalDays`（来自 opens）与 D24「去掉补记」、D01「不做断签」冲突 |
| 备份元数据 | L1274–L1275、L2989–L2997 | 上次导出时间、结算页提示是否已显示；紧迫/普通提醒规则 | `normalizeBackupMeta`、`backupAgeDays()`、`backupRelativeText()`、`renderBackupUI()`、`renderSummaryBackupHint()`、`markBackupExported(ts)` | activity、memory、reminder | 与 v10 决定冲突 | 规则：`(totalPracticeDays≥14 && 从未) || age≥30` 紧迫；`(completedDayCount≥5 || memoryCount≥30) && age≥7` 提醒；D24 要求「只按现在的记录和上次导出时间算，没有记录不催导出」 |
| 提醒/声音/字卡偏好 | L1310–L1316、L1321–L1324、L1381 | 三个小设置对象的规范化与保存 | `normalizeReminder/Sound/HandCardPref`、`saveReminder()`、`saveSound()` | — | 可直接复用 | 纯设置键，无历史包袱 |
| 会话快照 v3 | L1484–L1540 | 把进行中的一组（队列、回合、当前墨迹、提交快照、上一章几何）以稳定键编码；启动解码并做语义校验；v1/v2 直接安全结束 | `sessionPayload()`、`saveSessionSnapshot()`、`clearSessionSnapshot()`、`decodeSessionV3(s)`、`storedSessionShape(v)`、`usableDecodedSession(d)`、`resumableSession()`、`restoreSession(s)`、`discardLegacySession(raw)`；辅助 `storedCardRef(s)/storedIndexedRow(s)/storedVisual/storedStampSnapshot/restored*` | `CARDS`、`indexForCardKey`、`normalizeBackupSession`（L3022） | 可抽取改造 | 每笔落笔/提示/撤销都整键重写（L2267、L2268、L2294 等 20 余处）；`resumableSession()` 在每次 `renderHome` 被调（L1863），可能触发写 |
| 盖章撤销快照 | L2433–L2449、L2636 | 判断前抓全量内存快照（memory 行、status、FSRS eventId、当日 activity、funnel 长度、roundStats…），撤销时逐项回滚并回写 | `takeStampSnapshot()`、`restoreStampSnapshot(snap)`、`lastStampSnapshot` | 全部记录变量 | 可抽取改造 | 只保留最近一步；进入下一题即失效（`commitUndoWindow` L2451）；持久化进 session 的 `lastStampSnapshot` |
| 自定义字 / 已加字 | L2088、L2102–L2105、L2118–L2136 | 词→自定义卡；`addWord` 同时为已有字记一次「现实里不会」 | `customWords`、`addedChars`、`pushWordCards`、`buildCustomCards()`、`addWord(s)`、`recordRealWorldMiss(i)`、`customIndexOf(ch)`、`indexesForChars` | memory、status | 与 v10 决定冲突 | 没有任何移除自定义字的函数（grep 无 removeWord/splice）；D21 要求可移除并撤销 |
| 拍字照片 / 心愿字 | L2089–L2101、L2137–L2140 | 现实拍字：字在库→加字并记捕获；不在库→心愿；照片 30 张/420 KiB/单张 64 KiB | `WILD_PHOTO_MAX/BUDGET/MAX_BYTES`、`normalizeWildEntry/State`、`wildPhotoRows()`、`trimWildPhotos()`、`saveWildState()`、`collectWildCharacter(ch,capture)`、`wildCaptureFor(ch)` | `addWord` | 可抽取改造 | 走 `addWord` → 同样凭空制造 miss 记录 |
| 题目质量反馈 | L1546–L1547、L1793–L1799 | easy/rare/badWord/hide 四标记 | `qualityFor(i)`、`qualityBlocked(i)`、`recordQuality(kind,idx)`、`saveQuality()`、`unblockQuality(i)` | status、session | 可直接复用 | R11「词语反馈及其撤销」是保留能力 |
| 难度调参 | L1182、L1745–L1761 | 校准结果、偏好漂移、组反馈历史（≤30） | `saveTuning()`（clamp offset −18..22、contextStrict 0..4） | preference | 应重写/删除 | D17 去掉校准流程后 `calibrated/calibration/rounds/easyStreak/hardStreak` 基本失去意义 |
| 主题记忆 | L1686–L1693、L2066–L2067 | 上次出题主题，避免连续同主题 | `TOPIC_KEY` 经 `load/save` | — | 可直接复用 | 在 reset 里 `removeStored`，在备份里恢复 |
| 存储压力 | L2860–L2861、L3080–L3081 | `navigator.storage.estimate()` ≥85% 或剩余 <5 MiB 时提示；申请 persist | `storagePressure(estimate)`、`checkStoragePressure()` | — | 可抽取改造 | 估的是整个 origin（含 sw.js Cache Storage），不是 localStorage 配额（§5） |
| 备份白名单与导出 | L2988、L2998–L3001、L3013–L3020 | 21 键白名单；导出时预写 `backup_exported` 漏斗事件与 `lastExportAt`；原生桥 / Web Share / 下载三路 | `BACKUP_KEYS`、`backupPayload(opts:{exportedAt,funnelExportAt,preserveMeta})`、`exportBackup()` | funnel、backupMeta、`window.webkit.messageHandlers.shiziNative` | 可抽取改造 | 白名单**包含** `SESSION_KEY`；刻意排除 `SAFETY_KEY` 与 `shizi.nativeSmoke.v1`（注释 L2987） |
| 备份校验与恢复 | L3002–L3005、L3021–L3062、L3070 | 三阶段：格式→逐键 JSON→在「备份自带的自定义字上下文」里逐键形状校验+规范化；替换=删全部白名单键再写入再逐键核对；失败回滚 | `parseStoredObject`、`payloadProgress`、`currentProgress`、`normalizeBackupMemory/Session/Value`、`withBackupCustomContext(words,fn)`、`validatedBackupData(payload)→{obj,keys,data}`、`replaceBackupData(data)`、`restoreBackupPayload(payload,{skipConfirm,reload,skipSafety})→{applied,keys}`、`importBackup(file)`、`requestBackupImport()` | `STORED_SHAPE`、`buildCustomCards`、`captureSafetySnapshot`、`window.confirm` | 可抽取改造 | 错误分类（format/empty/value/shape+backupKey/write）在 `importBackup` 处被压成一句通用 alert（L3056） |
| 安全副本与撤销 | L3006–L3012、DOM L1029、L3075、L3078 | 恢复/清空前把全量备份对象写进 `shizi.safety.v1`；启动或清空后弹一次 10 秒撤销条；撤销=用副本再恢复一次（skipSafety）并删副本、reload | `captureSafetySnapshot(reason)`、`safetySnapshot()`、`showSafetyUndo()`、`hideSafetyUndo()`、`undoSafetyRestore({reload})`、`safetyUndoTimer` | `backupPayload`、`restoreBackupPayload` | 与 v10 决定冲突 | 10 秒 + `offeredAt` 一次性 vs D24「在备份页一直有效，离开才失效，失效后留结论句」；`captureSafetySnapshot` 直接 `localStorage.setItem` 无 try/catch（§5） |
| 清空数据 | L3072–L3074 | 确认→安全副本→逐键写默认值（约 20 次 save）→ `removeStored(TOPIC_KEY)`、`clearSessionSnapshot()` → 首页 + 撤销条 | `resetAllData({skipConfirm})→bool` | 几乎所有变量 | 应重写 | 非原子；`opens=[today()]`；D24 要求无记录时清空不可用 |
| iOS 备份桥 | Swift L1275–L1298（shareBackup）、L1338（picker）、L1346–L1402（importBackup）、L1548–L1560（分发）、L1943–L1946（错误枚举） | 写临时文件→UIActivityViewController，完成后回调 `markBackupExported()`；导入侧 10 MB 上限、预校验 `app==="shizi"`、每键以 `shizi.` 开头且值为合法 JSON 字串，再 `restoreBackupPayload(payload,{reload:false})` 成功后 `location.reload()` | JS→native `{type:"shareBackup",name,payload}`、`{type:"pickBackup"}`；native→JS `markBackupExported()`、`restoreBackupPayload(...)`、事件 `shizi-native-back` | WKWebView | 可直接复用 | 原生错误文案两种：超 10 MB、无法识别；JS 侧 confirm 由原生接管 |
| 实验数据盒 | L2853–L2858、L1908 | `?dev=1` 才显示的内部统计 | `dataLink`、`dataBox` | funnel、activity、tuning | 应删除 | 非用户功能 |
| 存储回归测试 | `scripts/verify_8105_app.js` L483–L486、L808–L830、L2169–L2176、L2214、L2294–L2299、L2329–L2386、L2397–L2420、L2425–L2446、L2469–L2510、L2615–L2637、L2668–L2689 | 备份往返、稳定键迁移、v2 数字会话隔离、安全副本双向撤销、XSS 墨迹、逐键形状拒绝、原子回滚（注入 QuotaExceeded）、坏 v3 会话在导入时拒绝、存储通知 | Playwright 直接调用页面全局函数 | index.html 全局作用域 | 可抽取改造 | 大量直接依赖全局函数名，重构会整体失效；但用例语义值得保留为新测试的清单 |

## 3. 数据契约

### 3.1 键总表（22 个 `shizi.*` 持久键 + 2 类衍生键）

| 键 | 常量 | 顶层类型 | 形状校验（L1087–L1110） | 在备份白名单 | 规范化函数 |
|---|---|---|---|---|---|
| `shizi.deck.v8105.context2` | `DECK_KEY` | `{[cardKey]: string}` | 值全为 string | 是 | （无，迁移时推导） |
| `shizi.opens.v1` | `OPEN_KEY` | `string[]` 日键 | Array | 是 | — |
| `shizi.memory.v1` | `MEMORY_KEY` | `{[cardKey]: MemoryRow}` | 值全为 plainObject | 是 | `normalizeBackupMemory`（导入）、`normalizeLegacySchedule`、`migrateFirstSeenAt`（启动） |
| `shizi.quality.v1` | `QUALITY_KEY` | `{[cardKey]: QualityRow}` | 值全为 plainObject | 是 | — |
| `shizi.pref.v1` | `PREF_KEY` | `"balanced"\|"practical"\|"challenge"` | 枚举 | 是 | — |
| `shizi.tuning.v1` | `TUNING_KEY` | object | plainObject 且 rounds 若存在为 Array | 是 | `saveTuning` clamp |
| `shizi.activity.v1` | `ACTIVITY_KEY` | object v2 | nullOr(plainObject) | 是 | `normalizeActivity` |
| `shizi.session.v1` | `SESSION_KEY` | object v3（v1/v2 允许存在但启动即丢弃） | `storedSessionShape`（需真解得开） | **是** | `normalizeBackupSession` |
| `shizi.backupMeta.v1` | `BACKUP_META_KEY` | object | nullOr(plainObject) | 是 | `normalizeBackupMeta` |
| `shizi.reminder.v1` | `REMINDER_KEY` | object | nullOr(plainObject) | 是 | `normalizeReminder` |
| `shizi.safety.v1` | `SAFETY_KEY` | object v1 | nullOr(plainObject) | **否** | — |
| `shizi.fsrsReviewLog.v1` | `FSRS_LOG_KEY` | v1 `Event[]` 或 v2 `{version:2,events,monthly}` | Array 或 plainObject 含 events Array | 是 | `normalizeFSRSStored` |
| `shizi.traceTutorial.v1` | `TRACE_TUTORIAL_KEY` | boolean | boolean | 是 | — |
| `shizi.fontScale.v1` | `FONT_SCALE_KEY` | boolean | boolean | 是 | — |
| `shizi.funnel.v1` | `FUNNEL_KEY` | object v2 | nullOr(plainObject) | 是 | `normalizeFunnel` |
| `shizi.sound.v1` | `SOUND_KEY` | object | nullOr(plainObject) | 是 | `normalizeSound` |
| `shizi.topic.v1` | `TOPIC_KEY` | string | string | 是 | — |
| `shizi.custom.v1` | `CUSTOM_KEY` | `string[]` 词 | stringArray | 是 | — |
| `shizi.added.v1` | `ADDED_KEY` | `string[]` 字 或 null | nullOr(stringArray) | 是 | 缺失时由 customWords 推导（L2119） |
| `shizi.wild.v1` | `WILD_KEY` | object v1 | plainObject | 是 | `normalizeWildState` |
| `shizi.handCard.v1` | `HAND_CARD_KEY` | object | nullOr(plainObject) | 是 | `normalizeHandCardPref` |
| `shizi.library.v1` | `LIB_KEY` | `{id,userSelected}` 或旧 string | nullOr(string 或 plainObject) | 是 | `normalizeLibrary` |
| `shizi.corrupt.<原键>` | （模板，L1076、L1521） | 原始字符串（非 JSON 保证） | — | 否 | — |
| `shizi.nativeSmoke.v1` | （仅 Swift DEBUG，WebViewController.swift L434–L436） | ISO 时间字串 | — | 否（注释 L2987） | — |

### 3.2 稳定卡键（L1541–L1543、L1189）

- 生成：`cardKey(i) = (CARDS[i].custom ? "custom:" : "base:") + CARDS[i].target`。
- 反查：`cardTargetFromKey` 接受 `base:<字>`、`custom:<字>`、旧 `custom:<数字>:<字>`（L1542 正则 `^custom:(?:\d+:)?(.+)$`）。
- 归一：`canonicalCardKey` 若目标字在 `BASE_BY_CHAR` 则强制 `base:`，否则 `custom:`（同字若从自定义升入基础库会自动改键）。
- 存储侧白名单：`storedCardKey` 要求 ≤80 字符、无控制字符/`<>"'&`、前缀 `base|custom|legacy`（`legacy:<attempts>` 只由 L1284 无索引盖章产生）。
- 旧 deck 纯数字键（题库绝对索引）在 `migrateStableCardIdentity` 直接丢弃（L2111）。

### 3.3 MemoryRow（`shizi.memory.v1` 的值；默认 L1630）

```
{
  seen, fast, slow, hints, misses, streak : int      // 计数；seen>0 视为「有记录」(memoryCount L1714)
  ease : 0..100 (默认 50)                              // 旧启发式，+12/-6/-8/-16 (L1822–1825)
  firstSeenAt, last : ms                              // last = 最近一次记录时间
  lastOutcome : "fast"|"slow"|"hinted"|"miss"          // 唯一的「结果」枚举 (L1812–1825)
  lastHints : int, traced : bool, missedOn : dayKey
  lastSystemSuggestion : ""|"correct"|"wrong", lastSystemStatus : "ok"|"bad"|"none", lastSystemAgree : bool|null
  topic, band, word, target : string                  // 冗余卡片元数据
  due : ms, dueDay : dayKey|null, pendingLearning : bool, legacySchedule? : true
  fsrsCard : ts-fsrs Card (due/last_review 为 ISO 字串, L1211)
  schedulerVersion, parameterVersion, schedulerTimeZone : string
  lastEpisode : {firstOutcome, attempts, assistanceUsed, independentlyRecovered}
  queuedFront? : true, queuedFrontAt? : ms            // 加字插队 (L2134–2135)，记录后删除 (L1817)
  source? : "wild", wildDay? : dayKey                  // 拍字来源 (L2140)
  recentInk? : { version:2, day, at, dataURL (webp|png, UTF-16 ≤32 KiB), strokes?: [[{x,y,w?,v?}]] 归一化 0–1 }
}
```

### 3.4 QualityRow：`{easy:0|1, rare:0|1, badWord:0|1, hide:bool, last:ms, target, word, topic, band}`（L1793–L1795）。

### 3.5 deck 状态值：`"indeck"`（需再练/在组内）或 `"rest"`（L1822–L1825、L2112、L2125）。

### 3.6 tuning：`{calibrated, offset(-18..22), contextStrict(0..4), rounds:[{id,date,mode,kind,counts,score,offset,contextStrict}] ≤30, easyStreak, hardStreak, lastRoundId, lastRoundFeedback, calibration:{date,counts,consistentFast,sampleSize,score,offset,preference}, chromeFadeSeen, peekHintUsed, practiceHintExplained, strokeHintConsequenceShown}`（L1182、L1745–L1759、L2184、L2229、L2545、L2570）。

### 3.7 activity v2（L1266–L1272）

```
{ version:2, migrationDate:dayKey, inheritedStreak:int, inheritedTotalDays:int, practiceDays:[dayKey],
  daily: {[dayKey]: {stamps, attempts, targetKeys[], independentTargetKeys[], reviewTargetKeys[],
                     completedRoundIds[] (≤1000), completedGroups, makeup:bool, lastStampAt, firstCompletedAt, makeupAt}},
  monthly:{[YYYY-MM]: {days, completedDays, stamps, attempts, completedGroups, targetKeys[], independentTargetKeys[],
                       reviewTargetKeys[], makeupDays[], firstDay, firstTargetKey, lastStampAt}} }
```
键列表上限 10000（L1267）。`daily` 保留 400 天，之后 `archiveActivityDay` 折叠进 `monthly`（L1276–L1279）。

### 3.8 FSRS 日志 v2（L1196–L1199、L1210）

```
{ version:2,
  events:[{ eventId:"<attemptId>:fsrs", attemptId, cardKey, target(1 字), reviewedAt:ISO, localDay,
            rating:"Good"|"Again", reason:"independent"|"wrong"|"hinted"|"dontKnow", hintCount, traced, teaching,
            plannedDue:dayKey, actualIntervalDays:number|null, scheduledDays, schedulerVersion, parameterVersion,
            desiredRetention, maximumInterval, timeZone }],
  monthly:{[YYYY-MM]: {reviews, good, again, hinted, traced, firstAt, lastAt, lastReviewByDay:{[dayKey]:{cardKey,reviewedAt}}}} }
```
`attemptId = "<roundId>-a<n>-<idx>"`（L1480）。事件 ≥120 天前折叠（L1205–L1209）。`FSRS_CONFIG`：ts-fsrs 5.2.0 / FSRS-6.0，retention 0.90，maxInterval 365，fuzz on，short-term on，learning_steps 空（L1203–L1204）。

### 3.9 session v3（L1498–L1501）

```
{ version:3, startedDate, updatedAt, activeMode:"new"|"review"|"calibrate"|"focus"|"makeup", makeupTargetDay,
  baseTargetKeys[], baseCursor, currentCardKey, currentAttemptKind, currentAttemptId,
  manualQueue:[{cardKey,...}], reinforcementQueue:[{cardKey,eligibleAfter,order}], unresolvedKeys[],
  episodeRows:[{cardKey, firstOutcome, attempts:[{attemptId,seq,outcome,userCorrect,uncertain,hintUsed,hintCount,enteredTracing,teaching,eventId,at}],
                assistanceUsed, independentlyRecovered, excluded, teachingComplete}],
  attemptSeq, practicePhase,
  visual:{ practicePhase, currentCardKey, currentAttemptKind, currentAttemptId, hintEverUsed, enteredTracingThisAttempt, hintsUsedThisCard,
           shownStrokes, groupIdx, seenGroups[], inkStrokes:[[{x,y,t?,p?,w?,v?}]], tracedThisCard, submissionSnapshot?, revealed, stamped },
  missedThisRound:[字], roundStats:[{cardKey,target,word,outcome,uncertain,geometryStatus,geometryMode,traced,hintUsed,level,topic,dueDay,independentlyRecovered}] (handwriting 已剥离),
  focusKeys[], sessionDoneKeys[], sessionTarget, sessionFastStreak, sessionMissStreak, roundFeedbackGiven, roundId,
  calibrationFirstHoldUsed, calibrationComfortShown, calibrationTargetKeys[], lastStampSnapshot:{...见 3.10}, feedbackKind,
  roundElapsedMs, roundBudgetPrompted, roundStartMemoryCount }
```
`submissionSnapshot`（L2426–L2431 + L1162–L1169）：`{target, cardKey, attemptId, createdAt, canvasSize, hintStrokeIds[], hintCount, hintStrokes, inkStrokes, referenceStrokes, compositeGeometry(=hint+ink 重建), compositeImage: PNG dataURL ≤2 MiB|null, hintEverUsed, enteredTracing, practicePhase, lastVerdict:{status:"ok"|"bad", mode:"exact"|"holistic", failed:int[], u, t, missing}|null, userCorrect:bool|null, softConfirmHandled?}`。
保存时机：`saveSessionSnapshot` 在 `focus` 单字模式直接清除（L1502）；`visibilitychange→hidden` 时保存（L3086）。

### 3.10 lastStampSnapshot（L2433–L2437，进 session 时经 `storedStampSnapshot` L1493–L1496 改为键引用）

`{position, baseCursor, currentCardKey, currentAttemptKind, currentAttemptId, practicePhase, attemptSeq, cardKey, target, statusValue, memoryValue(整行), fsrsEventId, activityKey, activityValue(当日整行), activityHadPracticeDay, funnelSeenLength, funnelEventsLength, funnelCountsValue, funnelEventCountsValue, roundHandwritingValue, baseTargetKeys, manualQueueValue, queueValue, unresolvedKeys, episodeRows, sessionDoneKeys, roundStatsValue, missedValue, sessionTarget, sessionFastStreak, sessionMissStreak, calibrationFirstHoldUsed, calibrationComfortShown, revealState, outcome}`。

### 3.11 其他小键

- `backupMeta`：`{lastExportAt:ms, summaryPromptShown:bool}`（L1274）。
- `reminder`：`{enabled, promptDismissed, permission:"unknown"|"granted"|"denied", milestonesShown:int[], characterMilestonesShown:int[], characterMilestoneDay:dayKey|""}`（L1310–L1315）。
- `sound`：`{enabled(默认 true), tipShown, scene:"off"|"rain"|"fire"}`（L1321）。
- `handCard`：`{promptEnabled(默认 true), lastPromptDay}`（L1323）。
- `library`：`{id:"core3500"|"adv3000"|"rare"|"curriculum2500", userSelected}`；旧 string `primary|junior|senior` → `curriculum2500|core3500|adv3000`（L1128–L1130）。
- `funnel` v2：`{version:2, createdAt, events:[{name,at,day}]≤256, eventCounts:{[name]:int}, seen:string[]≤512, counts:{revealCompared,revealDisagree}, rounds:[{completedAt,day,mode,durationMs≤3600000,targetCount,attemptCount}]≤180, roundTotals:{count,durationMs,byMode:{[mode]:{count,durationMs}}}}`（L1239–L1254）。已知事件名：`welcome_shown`、`calib_card1_done`、`calib_completed`、`d2_return`、`reveal_disagree`、`backup_exported`。
- `wild` v1：`{version:1, captures:{[字]:{day,at,dataURL?}}, wishes:{[字]:{day,at,dataURL?}}}`；`dataURL` 为 `image/webp|jpeg`，解码后 ≤64 KiB（L2090–L2094）。
- `custom`：词数组；`added`：字数组（去重）。
- `opens`：日键数组，每天启动追加（L1238）。
- `safety` v1：`{version:1, createdAt, reason:"restore"|"reset", pendingUndo:true, offeredAt:ms(0=未展示), payload:<3.12 的备份对象, preserveMeta>}`（L3006）。`pendingUndo` 从不置 false；`offeredAt` 一旦非 0 不再弹条（L3010）。

### 3.12 备份文件格式（L2998–L3001）

```
{ "app":"shizi", "version":1, "date":"<ISO of exportedAt>",
  "data": { "<shizi.* key>": "<该键在 localStorage 里的原始 JSON 字符串>", ... } }
```
- `JSON.stringify(..., null, 1)`；文件名 `shizi-backup-YYYY-MM-DD.json`（L3013）。
- **值是二次编码的字符串**（外层 JSON 里的 string，其内容再是 JSON）。Swift 侧（L1366–L1374）与 `scripts/summarize_backups.py`（L51、L90）都依赖这一点。
- 导出时：若 `funnelExportAt` 给出，则 `data[FUNNEL_KEY]` 换成预投影的「已含 backup_exported」漏斗（L2999）；若非 `preserveMeta`，`data[BACKUP_META_KEY].lastExportAt` 写成 exportedAt（L3000）。本机 `markBackupExported` 只在分享/下载真正完成后调用（L3018、L3020；Swift L1290）。
- 只导出白名单里**当前存在**的键（`getItem!==null`）。

### 3.13 恢复校验顺序（L3031–L3044）

1. `obj.app==="shizi"` 且 `data` 为对象，否则 `Error("format")`；忽略 `version` 字段。
2. 只取 `BACKUP_KEYS` 内的键；一个都没有 → `Error("empty")`。
3. 每值须为 string → `Error("value")`；`JSON.parse` 失败 → `Error("shape")`，`error.backupKey=k`。
4. `CUSTOM_KEY` 必须是 stringArray，否则 shape 错误。
5. 在 `withBackupCustomContext(incomingCustom)`（临时把全局 `customWords`/`CARDS` 换成备份自带的自定义字，L3029–L3030）里逐键 `storedShape(k)(value)`，任一失败整单拒绝；通过的键经 `normalizeBackupValue` 再 `JSON.stringify`。
6. 返回 `{obj, keys, data}`；到此为止**没有触碰 localStorage**。

`restoreBackupPayload`（L3047–L3055）：确认框（显示当前/备份字数与日期）→ 抓 `rollbackPayload` → 若非 `skipSafety` 写安全副本 → `replaceBackupData`（删全部白名单键→写入→逐键核对，L3045–L3046）→ 失败则用 rollbackPayload 再替换一次（其失败挂到 `error.rollbackError`）→ 默认 `location.reload()`。

### 3.14 原生桥消息

- JS→iOS：`{type:"shareBackup", name, payload}`（L3015）、`{type:"pickBackup"}`（L3059）。
- iOS→JS：`markBackupExported()`（Swift L1290，分享完成后）；`restoreBackupPayload(payloadText,{reload:false})` 成功则 `location.reload()`（Swift L1385–L1392）；`window.dispatchEvent(new Event('shizi-native-back'))`（Swift L114）。
- iOS 预校验：文件 ≤10 MB；`app==="shizi"`；`data` 至少一个 `shizi.` 前缀键；所有键 `shizi.` 前缀且值为可解析 JSON 字串（允许 fragment）（Swift L1361–L1375）。

## 4. 与第十稿（v10）决定的关系

### 4.1 可保留的（机制层）
- 「唯一形状表 + 启动隔离 + 导入前整单校验 + 替换后逐键核对 + 失败回滚」这条设计线（L1083–L1085、L3033–L3035 注释）与 R12「恢复前明确覆盖」、O04「先保护后覆盖」、检查表 L29 一致，应保留原则（实现可重写）。
- 备份文件外壳 `{app,version,data}` 与「值为原始 JSON 字串」的约定被 iOS 桥与 `summarize_backups.py` 依赖；若 v10 重定义数据模型，建议 **version 升到 2** 并保留 v1 读取（D15：不凭空补造来源，保留已完成成果——一次性导入器即可，不必永久兼容）。
- 稳定键 `base:<字>` / `custom:<字>`：粒度够用（第十稿所有清单都以字为单位）。
- 墨迹/快照的严格清洗函数（L1145–L1175）可原样搬。
- 存储故障三分法（读失败阻断、写失败提示、运行异常提示）符合 D07「失败留现场」。

### 4.2 被 D17–D25 改变或作废的（语义层）

| 决定 | 现状（证据） | 冲突/需改 |
|---|---|---|
| **D18 看答案记为「看过答案」，不再判断** | 「看答案/不会」路径 `recordOutcome("miss",{teaching:true})`（L2608）→ memory `lastOutcome="miss"`、`misses++`、FSRS `Again/dontKnow`、status `indeck`、activity 盖章 | 结果枚举 `fast/slow/hinted/miss` 没有「看过答案」；D23 又要求它不算有效记录。需要新增 attempt 类型（如 `revealed`），**不进** lastOutcome/FSRS 判断，但要进「练过」事实（D07：帮助事实不删）。 |
| **D23 写错过 = 最近一次有效判断；跳过/看过答案不算** | `lastOutcome` 可表达「最近一次」，但今天 miss 混入了看答案；「跳过」完全没有持久化痕迹（全文件无 skip 相关写入） | 需在 memory/事件里区分 `judged:true/false`；「快忘了」清单依赖 `dueDay`（L1386），与「写错过」互斥要在查询层做。 |
| **D19/D06 更正同一记录、不增加次数；入口在结果页格子** | 只能撤销最近一步（`lastStampSnapshot` L2636，进入下一题即失效 L2451）；FSRS 事件不存「复习前的卡」（L1232–L1234） | 从结果页更正任意一张卡需要：每次判断保存 `previousFsrsCard`/memory 差量，或把「本组所有判断」的回滚快照全部留在 session。现有 `takeStampSnapshot` 的字段清单是很好的差量模板。 |
| **D21 加入自选必须明确点「加入」；可移除并撤销** | `addWord` 立即 `recordRealWorldMiss`：`seen++`、`misses++`、`lastOutcome="miss"`、`dueDay=today`、status `indeck`（L2123–L2131），`collectWildCharacter` 同路（L2140）；无任何移除函数 | 违反 D03「没有本人书写不制造有效判断」：加字后该字会出现在「写错过」。新模型里「自选的字」应是独立集合（`custom`/`added`）不写 memory；需要移除 + 撤销的数据路径。 |
| **D24 去掉补记** | `activeMode:"makeup"`、`makeupTargetDay`（session L1498、L1523）、`activity.daily.makeup/makeupAt`、`monthly.makeupDays`（L1268–L1269）、`markRoundComplete` 补记分支（L1289–L1294）、`FUNNEL_MODES` 含 makeup（L1239） | 全部删除；日历改为只看 `practiceDays`/当日有记录（K27）。 |
| **D24 撤销在备份页一直有效，离开才失效，失效后留结论句** | 撤销条是全局 toast，10 秒自动隐藏（L3011），`offeredAt` 只弹一次（L3010）；恢复后 `location.reload` 回首页再弹（L3078）；无「结论句」数据 | 需要：(a) 副本不随时间失效、随「离开备份页」失效；(b) 记录本次替换/清空的结论数据（备份日期、字数、种类）以生成「已换成 9 月 1 日备份里的记录，一共 23 个字。」（N48）；(c) 撤销失败文案（10.15/C206/C207）；(d) 保护副本存失败要**不替换**并给专用说明（10.14/C205）——现在 `captureSafetySnapshot` 抛错会被 `importBackup` 压成「无法恢复这份备份」。 |
| **D24 备份页状态句只按现在的记录和上次导出时间算；没有记录不催导出，导出/清空不可用** | 紧迫规则用 `totalPracticeDays()`（含 opens 继承的 `inheritedTotalDays`）和 `completedDayCount`（L2991–L2992）；结算页 3 完成日提示（L2993–L2995）；「从未备份」默认文案 | 规则要重写为 `memoryCount()>0 && (从未 或 age)`；`summaryPromptShown`、`inheritedTotalDays` 可删。 |
| **D17 首练 5 字、去介绍页** | `needsCalibration()=!tuning.calibrated && memoryCount()===0` 驱动 welcome（L1865）与 `calibrate` 模式；`tuning.calibration` 15 字统计；漏斗 `welcome_shown/calib_*` | `tuning` 的校准字段、`calibrate` 模式、`calibrationTargetKeys` 等可删；首次 5 字只需「memoryCount()===0」判断。 |
| **D20 写完直接进结果页** | `roundSummary` 依赖 `roundIsComplete()` 与 `markRoundComplete`（L1287–L1295） | 存储无直接影响；但 D22 需要「未完成也进结果页」。 |
| **D22 中途结束：已判断保留，没写的不算记录也不算跳过；零判断轻提示** | `completedRoundIds` 只在整组完成时写（L1288）；`recordFunnelRound` 只在完成时记 | 需定义「提前结束的组」在 activity/funnel 里怎么算；`clearSessionSnapshot` 即可丢掉未写部分（它们本来就没写进 memory）。 |
| **D14 不以旧 96 份/420 KiB 当新政策；新逐判断存储另案** | `RECENT_INK_MAX/BUDGET`（L1144）、只存写对那一次（L1831）、每次覆盖 | 第十稿 K28/L05（写错过清单显示那次笔迹小图）、10.12（有记录缺笔迹状态）、M02（字帖用本月第一次的笔迹）都要求**按判断保存墨迹**，现有模型只能给「最近一次写对」。这是 v10 接入前必须先定的政策（决定表「新逐判断存储」待定项）。 |
| **D15 兼容不再是硬约束** | 启动链约 40% 是迁移：`LEGACY_LIBRARY_IDS`、`migrateCustomKeyedRows`、`migrateStableCardIdentity`、session v1/v2 丢弃、FSRS v1 数组、`normalizeLegacySchedule`、`migrateFirstSeenAt`、`addedChars` 推导、`opens` 继承 | 可全部删除，换成「读到旧键或 v1 备份 → 一次性导入 → 写新键」；旧键保留不删以便回退。 |
| **D01/D02 不做断签、首页无零统计** | `inheritedStreak`、`legacyStreakThrough`（L1262） | 删除。 |

### 4.3 v10 交接文档里与存储直接相关的验收
- **K03 必测**（04-v10-handoff §五）：300 字状态导出→用 9 月 1 日备份替换→撤销，记录数必须相等。现有路径的风险点见 §5.1。
- **K04**（边开发边改 L63）：替换确认要写明会丢失的日期区间并建议先导出——需要 `payloadProgress`（L3003）之外再算「当前记录里晚于备份日期的天数/字数」。
- **10.14 / 10.15 / C205–C207 / N48 / X03 / V07**：见上表 D24 行。

## 5. 风险与坑

### 5.1 K03 可能失败的具体原因（安全副本与配额）
1. `captureSafetySnapshot` 直接 `localStorage.setItem`，**没有 try/catch**（L3006）。安全副本是整份备份的完整拷贝（含 memory 里最多 420 KiB 墨迹、wild 里最多 420 KiB 照片、session 里 ≤2 MiB 的 `compositeImage`），写入瞬间本地数据量接近翻倍。iOS WKWebView 的 localStorage 配额通常约 5 MB，300 字 + 照片场景很可能触发 QuotaExceeded。
2. 抛错发生在 `replaceBackupData` 之前，本机数据确实没动（符合 10.14 期望），但异常一路冒到 `importBackup` 的 `catch` 变成「无法恢复这份备份。请选择由「拾字」导出的备份文件。」（L3056）——错误归因完全错误；`resetAllData` 路径则变成未捕获异常 →「页面发生异常」（L1068）。
3. 撤销 = `restoreBackupPayload(row.payload,{skipSafety:true})` 再走一次校验与规范化（L3012）。`normalizeBackupMemory` 会丢掉键长 >120、含控制字符、值非对象的行并按 `last` 合并同键（L3021）；`normalizeFSRSStored` 会丢掉 `cardKey` 不合白名单的事件；若原始数据里有任何一行不合当前规则，撤销后的 `memoryCount` 就会与替换前不等。
4. 替换后 `location.reload()`，启动链再跑一遍 `migrateStableCardIdentity`+`saveMemory`（`trimRecentInk`）——若副本中 recentInk 超预算，重启后会被再裁一遍（不影响字数，但影响「墨迹是否还在」）。

### 5.2 写失败上报的误报
`saveMemory`（L1179–L1180）和 `saveWildState`（L2098）的降级策略是「先整存一次，失败再逐份删最旧墨迹/照片重试」。但 `save()` 每次失败都会调用 `reportStorageWriteFailure` 弹「这次进度没有保存」（L1067），即便随后重试成功。用户会看到与事实相反的提示，且墨迹/照片被静默删除。

### 5.3 替换不是原子操作
`replaceBackupData`（L3045）先 `removeItem` 全部 21 键再逐个 `setItem`。中途配额失败时回滚也要重新 `validatedBackupData(rollbackPayload)` 再替换一次；两次都失败就留下混合状态（`error.rollbackError`），用户只看到通用 alert。测试 L2370–L2375 只覆盖「第一次写失败、回滚成功」的分支。

### 5.4 会话键进备份带来的过度严格
`SESSION_KEY` 在白名单里（L2988），而 `storedShape(SESSION_KEY)` 要求 v3 会话在**备份自带的自定义字上下文**里完全解得开（L1525、L3040–L3042）。一份备份若会话引用了某张当时存在、现在不在库中的卡，整份备份（包含全部记忆）会被以 `shape:shizi.session.v1` 拒绝。CHANGELOG L327 曾说「恢复旧备份时忽略并清理会话快照」，与现状矛盾。新模型建议：导入时丢弃会话（或单独容错），不让「进行中的一组」绑架「全部记录」。

### 5.5 全键覆盖写与写放大
- 每一笔落笔、每次提示、每次撤销都 `save(SESSION_KEY, sessionPayload())`（L2267–L2268、L2294、L2533–L2540、L2572、L2598、L2605、L2644、L2655、L2657、L2671、L2678 等），payload 含全部墨迹点（含 t/p/w/v）和 ≤2 MiB 的 PNG `compositeImage`——高频 JSON 序列化 + 大字符串写盘，Apple Pencil 120 Hz 下是明显的主线程负担。
- `renderHome` 每次都 `resumableSession()`（L1863）→ 解析、规范化、可能回写（L1528）。
- 启动固定回写：`TRACE_TUTORIAL`（L1117）、`LIB`（L1131）、`memory/quality/fsrs`（L1221）、`opens`（L1238）、`funnel`（L1253）、`activity`（L1273）、`reminder`（L1316）、`sound`（L1322）、`handCard`（L1324）、`wild`（L2101）、`migrateStableCardIdentity` 5 键（L2116）、`added`（L2119）。配额已满的设备每次启动都会弹一串失败提示。

### 5.6 `shizi.corrupt.*` 永不回收
隔离键只写不删（L1076、L1521），不在白名单，不在 `resetAllData`。一个 400 KiB 的坏 memory 会永久占着配额。且 `quarantineStoredKey` 自身的 `setItem` 若因配额失败会被吞掉（`catch(e){}`），原键不删——下次启动重复同一提示。

### 5.7 `checkStoragePressure` 量错了对象
`navigator.storage.estimate()` 统计的是整个 origin（含 sw.js 的 Cache Storage：应用壳 + 最多 800 条笔顺缓存，sw.js L18），与 localStorage 的独立 ~5 MB 配额无关。85%/5 MiB 阈值几乎不会因 localStorage 接近满而触发。

### 5.8 墨迹的取舍决定了第十稿多处画不出来
- 只在写对时 `persistRecentInk`（L1831），写错/提示/看答案那次的笔迹只存在内存 `roundHandwriting`（L1804）里，reload 即丢。结果页/单字详情在恢复后回退到 `memory.recentInk`（L1806），因此第十稿「写错过清单右侧那次笔迹小图」（K28/L05）、「月图取月内最后判断」（D11）、「字帖用本月第一次」（M02）在现有数据下都无法准确实现。
- `persistRecentInk` 依赖 `canvas.toDataURL("image/webp")`；不支持 WebP 编码的 WKWebView 会返回 PNG，超过 32 KiB 即 `return false` 静默不存（L1808）。CHANGELOG L62 给照片做了 JPEG 回退，墨迹没有。

### 5.9 备份/恢复与运行态的分叉
`restoreBackupPayload(...,{reload:false})` 只改 localStorage，不更新内存变量；调用方必须自己 `reload`（Swift L1389–L1391 就是这样做）。任何未 reload 的路径（测试、未来页面内恢复）都会让内存与磁盘不一致，随后任意一次 `save` 会把旧内存覆盖回去。

### 5.10 `withBackupCustomContext` 会临时改写全局 `CARDS`
`buildCustomCards()` 做 `CARDS.length=BASE_N` 再重推（L2104）。校验是同步的，`finally` 会还原，但若在一组进行中导入备份且校验期间抛出的异常被 `window.error` 捕获，`reportRuntimeFailure` 会先弹「页面发生异常」。

### 5.11 时间与日期
- 所有日键为本地时间（L1183）；跨时区旅行会让同一 `reviewedAt` 落到不同 `localDay`。`validDayKey` 用 `new Date(y,m-1,d,12)` 往返校验（L1187），能拒绝 `2026-02-30`。
- `funnel.seen` 上限 512（L1254）会把 `reveal:<attemptId>`/`round:<roundId>` 去重键挤掉——旧的重复记录不再被拦（低危）。

### 5.12 iOS 桥的边界
- 导入前 Swift 只检查外壳和「值是合法 JSON 字串」（L1366–L1375），形状校验全在 JS；`evaluateJavaScript` 出错才弹原生 alert（L1394–L1397），JS 内部 `throw` 会被 Promise 吞进 `importBackup` 的 alert（L3056）。两个入口两套文案。
- `window.confirm` 在 WKWebView 由原生 `runJavaScriptConfirmPanel` 接管（Swift L1486 附近），第十稿 K04 需要自定义确认框，不能再用 `confirm`。
- 分享取消（`completed==false`）不记导出，符合「取消分享不误记」（CHANGELOG L199）。

### 5.13 测试对全局名的强耦合
`scripts/verify_8105_app.js` 直接调用 `backupPayload/restoreBackupPayload/undoSafetyRestore/resetAllData/migrateStableCardIdentity/storedSessionShape/...` 等全局函数（L483、L2329–L2386、L2397–L2420、L2469–L2510）。重构成模块后这些用例会整体失效，但它们的**断言语义**（逐键拒绝、原子回滚、双向撤销、XSS 墨迹、坏 v3 会话在导入时拒绝）应迁进新测试。

## 6. 未解问题

1. 目标设备（iOS 版本、自定义 scheme `LocalWebSchemeHandler` 下的 WKWebView）localStorage 实际配额是多少？K03 走查中那次失败是否就是 §5.1 的配额问题，代码里无法证实。
2. 第十稿要求的「按判断保存墨迹」政策（保留多少次、多久、多大）尚未决定（决定表「新逐判断存储」待定）。在此之前 D11/M02/K28/L05 的存储需求无法定型。
3. `shizi.deck.v8105.context2` 之前的 deck 键名（如 `shizi.deck.v1`）是否仍残留在老设备上？代码不清理任何非当前键，CHANGELOG 未记录键名演变。
4. `SESSION_KEY` 究竟应不应该进备份？CHANGELOG L327 与现状矛盾，决定表未提；第十稿 W10「刷新后回到离开时的阶段」只针对本机，不涉及跨设备。
5. 「跳过」目前是否有任何持久化？全文件未找到 skip 相关写入；若第十稿的「跳过那一行」是新增，需要定义它在 activity/事件里的表示（D23 说不算有效记录，「正式排除范围」在决定表仍待定）。
6. FSRS 参数（retention 0.90、365 天、fuzz）与 `ease` 启发式并存；第十稿「快忘了」清单以 `dueDay` 为准，是否继续用 ts-fsrs，还是回到更简单的间隔？决定表没有 D 项覆盖。
7. `shizi.nativeSmoke.v1` 只在 DEBUG 写入（Swift L166–L175），但发布包的 `verify-archive.sh` L62 仍检查相关标记——发布构建是否会残留该键，需构建侧确认。
8. `backupMeta.lastExportAt` 在导出文件里被写成导出时刻（L3000）：恢复一份旧备份后，「上次备份」显示的是那份备份的导出日，而不是本设备的上次导出——这是否是期望语义（K02「按上次导出」）需产品确认。
9. Web Share 路径在 iOS Safari PWA（非原生壳）下能否分享 `.json` 文件、下载回退是否可用，代码无法判断，需真机。
10. `quality` 的 `easy/rare/badWord/hide` 在第十稿（去掉偏好档、去掉主题选题）里哪些还有用户入口？决定表 R11 说保留「词语反馈及其撤销」，但 `easy`/`rare` 影响的是出题算法，需产品确认保留范围。
