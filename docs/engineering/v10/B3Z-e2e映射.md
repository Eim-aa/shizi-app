# B3.Z · e2e 映射表与停跑清单（2026-10-29，基线 e787bc88）

B3B4 §5.3 的逐文件落实：`scripts/e2e/` 的 130 个 Playwright spec，每个归一类、写明原生替代，并列出缺口。**本卡不删除也不停用任何 spec**（网页构建还在，D59 ④ 未定）；本文只是对照表 + 建议停跑清单。

## 1. 分类口径

| 类 | 含义 | 去处 |
|---|---|---|
| R 规则 / 数据 | 借界面驱动、断言 store / 规则 | 照跑；B4 改为 node 单测 / 差分序列，Swift 由 ShiziCore 与 ShiziStoreTests 覆盖。原生已有的杀进程重开等用例列在替代列 |
| P 页面行为 | 一页的入口、点按、返回、失败三段式、撤销 | 对应的 XCUITest（下表替代列，逐项已核对存在） |
| L 交互 / 版式门禁 | 交互规范 IC-*、版式、字号、读屏 | `NavigationTests` + `AccessibilityAuditTests` + `AccessibilityFlowTests` + QA-H1 逐屏对比（浅 / 深 × L / XXXL / AX3 / AX5，692 屏，含 AX-01 等具名检查）。QA-H1 把网页参考图当标准答案，所以版式类 spec 的断言已被「网页 vs 原生逐屏零差异」吸收 |
| W 网页基础设施 | 离线、字体加载、Chromium 帧率、假桥、CSS 外壳、网页兜底手势 | 属于 L 类里「只对网页有意义」的一小部分，单列：随网页退役，无需原生替代（原生有对应能力的在替代列注明） |

说明：替代列写 `类.testNNN` 时是**前缀**，指向该类中名字以此开头的用例（已由脚本逐条核对存在）。`QA-H1` 指逐屏对比与具名检查，不是单个 XCUITest。

## 2. 汇总

| 类 | spec 数 |
|---|---|
| R 规则 / 数据 | 18 |
| P 页面行为 | 44 |
| L 交互 / 版式门禁 | 60 |
| W 网页基础设施 | 8 |
| 合计 | 130 |

缺口（真实产品行为、原生无自动用例）：见 §4。本卡补了 4 条（§4.1），剩 5 个 spec 涉及的 2 类行为（§4.2）。

## 3. 逐文件映射

| spec | 类 | 原生替代 | 备注 |
|---|---|---|---|
| `00-shell` | L | NavigationTests.testTabsSwitchBetweenThreeRoots; NavigationTests.testPushFromEachRootHidesTheBarAndEdgeBackReturns; NavigationTests.testTabRootHasNoEdgeBack | tab 条键盘漫游 / 假原生桥 backGestureEnabled 记录是网页壳专属，随网页退役 |
| `10-write` | P | WriteFlowTests.test200; WriteFlowTests.test204; WriteFlowTests.test205; WriteFlowTests.test206; WriteFlowTests.test207 | 书写格骨架与手势门控 |
| `100-w2-a7` | P | WriteFlowTests.test401; WriteFlowTests.test301; AccessibilityFlowTests.test1005 | 求助行版式由 QA-H1 write 状态逐屏比（含 AX5） |
| `101-w2-b1` | P | EntryFlowTests.test101; EntryFlowTests.test110; EntryFlowTests.test113; EntryFlowTests.test114; HomeFlowTests.testPaperTransitionFirstFrameIsSourceRect; KnownIssueTests.testNF01; NativeStageFlowTests.test903 | 「按钮长成这张纸」B1 与无来源时的安静淡入 B3 |
| `102-interaction-compliance-feedback` | L | ImageFlowTests.testFailureToast; WriteFlowTests.test209 | IC-12 提示条只在失败 / 撤销时出现；IC-14 动画清单（CSS 动画注册表）是网页专属，随网页退役；原生动效时长取自生成的 motion 令牌（--check 门禁） |
| `102-interaction-compliance-overlays` | L | NavigationTests.testSheetOpenEdgeOnlyClosesSheet; MineFlowTests.testAx5ChoiceSheetEdgeClosesOnlySheet; DetailFlowTests.testZoomEdgeClosesOnlyTheSheet; QueryFlowTests.testSheetHidesTheRootFromVoiceOver | IC-07/16 弹层出口、N4 根页上的弹层可划走 |
| `102-interaction-compliance-pages2` | L | QA-H1 AX5 档（AX-01 不溢出 / 不截断）; AccessibilityAuditTests.testPerformAccessibilityAuditPushedPagesAX5 | IC-21 |
| `102-interaction-compliance-write` | L | WriteFlowTests.test401; WriteFlowTests.test601; WriteFlowTests.test701; EntryFlowTests.test101b; EntryFlowTests.test101c; WriteFlowTests.test205 | IC-11/19 日常操作一点即达；IC-17 转场中落笔 / 边缘划返回 |
| `102-interaction-compliance` | L | NavigationTests.testTwoFingerZ; NavigationTests.testEdgeSwipeEqualsTapBackOnEveryL1L2 | IC-08 逃逸 = 点「‹」；IC-00 注册表是网页专属（原生屏名由 NSClassFromString 约定 + node 核对） |
| `103-i2-write-phases` | L | WriteFlowTests.test301; WriteFlowTests.test401; WriteFlowTests.test501; WriteFlowTests.test502; NavigationTests.testEdgeSwipeEqualsTapBackOnEveryL1L2 | 写字页各阶段的返回 / 划回弹 |
| `103-i3-buttons` | P | WriteFlowTests.test601; WriteFlowTests.test701; WriteFlowTests.test702; ResultFlowTests.test813 | 按钮层级（结束这组 / 跳过 / 结果页脚）；版式 QA-H1 write / result 状态 |
| `104-i2-screens-a` | L | NavigationTests.testEdgeSwipeEqualsTapBackOnEveryL1L2; NavigationTests.testPushFromEachRootHidesTheBarAndEdgeBackReturns | 注册子页返回 / 手势（偶数位） |
| `104-i2-screens-b` | L | NavigationTests.testEdgeSwipeEqualsTapBackOnEveryL1L2; NavigationTests.testPushFromEachRootHidesTheBarAndEdgeBackReturns | 注册子页返回 / 手势（奇数位） |
| `105-i2-overlay-exit` | L | NavigationTests.testSheetOpenEdgeOnlyClosesSheet; NavigationTests.testTabReTapScrollsToTop; NavigationTests.testTwoFingerZ; ResultFlowTests.test813; HomeFlowTests.testLeaveUndoBarHandoff; LibraryFlowTests.testLeaveUndoBarFollowsToLibrary | 确认框逃逸、结果页「再写一组」一次转场、撤销跟人走、Tab 再点滚顶 |
| `106-j1-page-pan` | L | NavigationTests.testN7PageDoesNotPan | IC-22 |
| `107-j1-write-entries` | L | EntryFlowTests.test113; EntryFlowTests.test102; EntryFlowTests.test103; RestoreAndDeepLinkTests.testWarmReminderDeepLinkOpensTheWritePage; NativeStageFlowTests.test903 | IC-23 写字页进入方式（有无来源元素 / 通知深链） |
| `108-j1-sheet-exit` | L | NavigationTests.testSheetOpenEdgeOnlyClosesSheet | IC-24 的「帧率无长任务」是 Chromium 量测，随网页退役；原生手感归真机 QA（DEVICE_QA） |
| `109-r7-l1-library` | P | LibraryFlowTests.testCategoryRowOpensZoneList; LibraryFlowTests.testAllButtonOpensAllPage; LibraryFlowTests.testTodayPracticeRowPushesWritePage; LibraryFlowTests.testSearchOpensQuery; LibraryFlowTests.testTodayPracticeFailureShowsThreeStage | 三区互斥且合计 = N、计数随 FSRS：视图模型差分（B4.5b views 200 种子 × 84 op）+ QA-H1 library-* 状态 |
| `11-judge-correct` | R | —（B3 期间照跑；B4：ShiziCore 判断 / 记录测试 + 差分序列） |  |
| `110-r7-m1-mine` | P | MineFlowTests.testEachRowOpensItsPageAndComesBack; MineFlowTests.testAppearanceSegmentsApplyAtOnce | 连续天数等规则：视图模型差分；顺序与版式 QA-H1 mine-* 状态 |
| `111-r7-s2-group-size` | P | MineFlowTests.testGroupSizeSyncsHomeAndLibrary | 「改成 30 时当前组不变」属规则，归 21-session-start / ShiziCore 排课测试 |
| `112-r8-b-flow` | P | WriteFlowTests.test702; WriteFlowTests.test703; ResultFlowTests.test814; ResultFlowTests.test819; DetailFlowTests.testRecordCellZoomCorrectJudgment; EntryFlowTests.test108 | D66 ③④⑥⑧⑮⑯ |
| `12-glyph` | R | WriteFlowTests.test204; ShiziWriteTests（NativeHintTests / NativeTraceTests / InkSurfaceTests） | 字形加载失败 / 超时重试属网页取数；原生字形来自随包数据 |
| `13-hint` | P | WriteFlowTests.test301 |  |
| `14-answer` | P | WriteFlowTests.test401; WriteFlowTests.test402 |  |
| `15-recover` | R | WriteFlowTests.test901; WriteFlowTests.test902; RestoreAndDeepLinkTests.testKillRestoresEachPage | 会话现场恢复（规则仍在 JS，B4 进 ShiziCore）；原生已有杀进程重开用例 |
| `16-compact` | L | QA-H1 write 状态（小屏 / 大字）; WriteFlowTests.test200 | 紧凑版写字页 |
| `16-grid` | L | QA-H1 write 状态 + checks/write.mjs（书写格方形）; WriteFlowTests.test204 | 格边长与字号脱钩 |
| `17-skip-undo` | P | WriteFlowTests.test601; WriteFlowTests.test602; ResultFlowTests.test815 | 撤销底栏寿命 |
| `20-query` | P | QueryFlowTests.testLookupAndPickModes; QueryFlowTests.testPickSelectsChar; QueryFlowTests.testAddSuccessTurnsButtonIntoAlreadyAdded; QueryFlowTests.testAddFailureThreeStage; QueryFlowTests.testAddFailureRetry |  |
| `21-session-start` | R | —（B3 期间照跑；B4：ShiziCore 排课 + 20 场景模拟器差分） |  |
| `22-home-cta` | L | QA-H1 home 状态 × L/XXXL/AX3/AX5; HomeFlowTests.testSixStatesMainButtonDestinations | 主按钮尺寸 / 不随字号缩小 |
| `22-home` | P | HomeFlowTests.testSixStatesMainButtonDestinations; HomeFlowTests.testStartFailureRetriesInPlace; HomeFlowTests.testPickCharsEntry; HomeFlowTests.testSpecialGroupDeferral; HomeFlowTests.testColdStartRestoresHome | 日期 / 时段文案：ShiziCore Dates 测试 + QA-H1 home-* 状态 |
| `23-result` | P | ResultFlowTests.test811; ResultFlowTests.test812; ResultFlowTests.test813; ResultFlowTests.test814; WriteFlowTests.test702; WriteFlowTests.test801 |  |
| `24-scenario-sessions` | R | EntryFlowTests.test102 | A / B 两组互不覆盖（会话槽规则）；B4：ShiziCore |
| `31-lists` | P | LibrarySubFlowTests.testTierToListToPickedSession; EntryFlowTests.test104; EntryFlowTests.test105 | 写错过 / 快忘了两张清单行、点行进详情；行内容 QA-H1 list-* 状态 |
| `32-switch` | P | LibrarySubFlowTests.testSwitchLibrarySuccessReturnsAtOnce; LibrarySubFlowTests.testSwitchLibraryFailureThreeStage |  |
| `33-detail` | P | DetailFlowTests.testPracticeThisChar; DetailFlowTests.testWordOffAndUndo; DetailFlowTests.testCustomAddRemoveUndo; DetailFlowTests.testCustomAddFailureThreeStageThenRetry; DetailFlowTests.testRecordCellZoomCorrectJudgment; DetailFlowTests.testLegacyPhotoPage | 「加入自选失败三段式」本卡补（B3.Z） |
| `34-library-query` | P | LibraryFlowTests.testSearchOpensQuery; QueryFlowTests.testLookupAndPickModes; QueryFlowTests.testPracticeFromCardReturnsToTheCard |  |
| `35-all` | P | LibrarySubFlowTests.testAllCharsSortFilterFind; LibrarySubFlowTests.testAllCharsParamsColdRestore; LibrarySubFlowTests.testAllCharsMonthOpensAndFolds | 「按月折叠 / 展开」本卡补（B3.Z） |
| `40-mine` | P | MineFlowTests.testEachRowOpensItsPageAndComesBack; MineSubFlowTests.testRecordsMonthSwitch; MineSubFlowTests.testRecordsExpandAndCollapseDay; MineSubFlowTests.testRecordsDayCellIntoDetailAndBack; MineSubFlowTests.testRecordsSheetOpensMonthAndEdgeBack |  |
| `41-prefs` | P | RemindFlowTests.testSwitchTurnsTimeRowOnAndOff; RemindFlowTests.testDeniedShowsNoteWithoutTimeRow; RemindFlowTests.testWriteFailureCancelKeepsSwitchOff; RemindFlowTests.testWriteFailureRetryWritesAgain; MineFlowTests.testAppearanceSegmentsApplyAtOnce |  |
| `42-backup` | P | BackupFlowTests.testExportShowsShareSheet; BackupFlowTests.testImportPrecheckRejectsThreeKinds; BackupFlowTests.testRestoreConfirmUndoBarUndo; BackupFlowTests.testUndoBarSurvivesKill; BackupFlowTests.testClearThenUndo | 「替换到一半失败整笔回滚」是存储规则：ShiziStoreTests（NativeStoreTests 第二项校验和不符整笔回滚） |
| `43-images` | P | ImageFlowTests.testRatioSwitch; ImageFlowTests.testAlsoPutIn; ImageFlowTests.testPagedOver80Chars; ImageFlowTests.testSaveToPhotos; ImageFlowTests.testFailureToast | 出图字节：图片对照 46/46（B4.6 原生绘制 vs 网页） |
| `44-scenario-ink-states` | R | —（B3 期间照跑；B4：差分序列） |  |
| `45-about` | P | MineFlowTests.testEachRowOpensItsPageAndComesBack; NativeStageFlowTests.test900 | 关于及子页内容：QA-H1 about* / credits* / privacy 状态 |
| `46-annual` | P | MineSubFlowTests.testAnnualSwitchYear; MineSubFlowTests.testAnnualPastYear; MineSubFlowTests.testAnnualMonthOpensCopybookAndBack; MineSubFlowTests.testAnnualTwiceAtTheEnd; MineSubFlowTests.testAnnualSaveOpensImagePreview; RestoreAndDeepLinkTests.testKillRestoresEachPage |  |
| `47-ink-promises` | R | —（B3 期间照跑；B4：差分序列） | 笔迹承诺策略 |
| `48-query-keyboard` | P | QueryFlowTests.testKeyboardUpFourExitsStartAtOnce; QueryFlowTests.testLookupAndPickModes | 键盘遮挡版式：QA-H1 query-keyboard 状态 |
| `49-query-ime` | P | QueryFlowTests.testImeComposingDoesNotQueryEarly | WebKit / Chromium 事件顺序是网页专属，随网页退役 |
| `50-offline` | W | — | 离线 / 请求失败（网页取数）；原生数据随包，随网页退役 |
| `51-fonts` | W | —（字体注册由 verify-bundle-assets / verify:assets 与 ShiziKitTests 守） | WOFF2 加载时机，随网页退役 |
| `52-migrate` | R | —（B3 期间照跑；B4.4：ShiziStoreTests 迁移用例） |  |
| `53-block` | P | BlockTests.testUnavailableBlock; BlockTests.testBlockedBlockWithExport; BlockTests.testMigrationBlock; BlockTests.testExportBackupFromBlock; BlockTests.testRetry |  |
| `54-native-bridge` | W | —（引擎模式仍用桥：B4.9 删桥时一并退役；之前继续跑） | 假 window.webkit 桥的时序 |
| `55-reminder` | P | RemindFlowTests.testTimePickerConfirmsAndWrites; RemindFlowTests.testTimeWriteFailureShowsThreeSteps; RestoreAndDeepLinkTests.testReminderDeepLinkBeatsRestore; RestoreAndDeepLinkTests.testWarmReminderDeepLinkOpensTheWritePage; RestoreAndDeepLinkTests.testDeepLinkWithUnfinishedBGroupShowsS02; RestoreAndDeepLinkTests.testWarmDeepLinkWithUnfinishedBGroupShowsS02 | 提醒内容（reminder.plan 的 P48 题目）属规则，B3 期间照跑；触觉 / 按键音见缺口 |
| `60-a11y` | L | AccessibilityFlowTests.test1001; AccessibilityFlowTests.test1002; AccessibilityFlowTests.test1003; AccessibilityFlowTests.test1004; AccessibilityFlowTests.test1005; AccessibilityAuditTests.testPerformAccessibilityAuditRootTabs; AccessibilityAuditTests.testPerformAccessibilityAuditPushedPages |  |
| `60-matrix` | L | QA-H1 显示矩阵（L/XXXL/AX3/AX5 × 浅深 × 长文本夹具） |  |
| `61-perf` | W | NativeStageFlowTests.test903 | Chromium trace 帧率；原生性能门禁 = 点按到转场 p95 ≤ 50ms + 判断往返 + 冷启动首帧量测 |
| `62-gesture` | L | NativeStageFlowTests.test901; NativeStageFlowTests.test902; NavigationTests.testEdgeSwipeEqualsTapBackOnEveryL1L2 | 跟手返回的速度阈值（甩一下过半 / 拉回）无原生用例，见缺口 |
| `63-scenarios` | R | —（B3 期间照跑；B4：差分序列） | 连续场景回归 |
| `64-cold-start` | P | RestoreAndDeepLinkTests.testKillRestoresEachPage; RestoreAndDeepLinkTests.testStaleNotRestored; RestoreAndDeepLinkTests.testAcross4amNotRestored; RestoreAndDeepLinkTests.testBadRouteHintGoesHome; RestoreAndDeepLinkTests.testBootFrameFollowsSavedTab; BackupFlowTests.testUndoBarSurvivesKill; WriteFlowTests.test901 |  |
| `65-p0a-shell` | W | — | data-pressed / 弹层把手等 CSS 外壳；原生按压反馈归真机 QA |
| `66-ink-retention` | R | —（B3 期间照跑；B4：差分序列） |  |
| `66-text-size` | L | QA-H1 L/XXXL/AX3/AX5 + AX-01; AccessibilityFlowTests.test1005 | 系统字号跟随 |
| `67-period-ink` | R | —（B3 期间照跑；B4：差分序列） |  |
| `67-text-size-inject` | W | QA-H1 AX 档（原生直接读系统字号） | 页面开始加载前注入字号类别，网页专属 |
| `68-q3-boot` | W | RestoreAndDeepLinkTests.testBootFrameFollowsSavedTab | Chromium 冷启动口径；原生首帧量测在 BootFrameProbe（B3.F） |
| `70-p1e4-mix` | R | —（B3 期间照跑；B4：ShiziCore 排课） |  |
| `71-p1e1a-tokens` | L | QA-H1 逐屏（令牌生成物 --check 门禁） | 设计令牌在浏览器生效 |
| `72-p1e1b-layout` | L | QA-H1 逐屏 | 页面结构 / 页边 20 |
| `72-p1e5-home-first` | P | HomeFlowTests.testFirstBrandMomentTapFreezes; ResultFlowTests.test818; HomeFlowTests.testSixStatesMainButtonDestinations | 首练三字 / 提醒邀请只在点「好」后请求权限：ResultFlowTests.test818 |
| `73-p1e7-works` | R | ImageFlowTests（作品成员）; QA-H1 result-* 状态 | 作品成员 / 落款规则在 JS 视图模型；B4.5b 差分覆盖 |
| `74-p1e78-paper-works` | R | —（B3 期间照跑；B4：差分序列） | 纸上记录不进作品 |
| `75-p1e2-glyph` | R | —（字形单一来源是数据 / 渲染口径；QA-H1 逐屏覆盖原生渲染） |  |
| `76-q1-after-seen` | R | KnownIssueTests.testNF05_retraceInkIsNotSaved | 看答案后的凭记忆写不存为作品墨 |
| `76-q2-01-first-tip` | P | WriteFlowTests.test210 | 本卡补（B3.Z） |
| `76-q2-03-preview-center` | L | QA-H1 preview-* 状态; ImageFlowTests.testRatioSwitch |  |
| `76-q2-09-query-ax` | L | QA-H1 query-* 状态 × AX3; QueryFlowTests.testKeyboardUpFourExitsStartAtOnce |  |
| `76-q2-10-seal-fixed` | L | QA-H1 home-first × AX 档 |  |
| `76-q2-11-tabbar` | L | NavigationTests.testTabsSwitchBetweenThreeRoots; AccessibilityAuditTests.testPerformAccessibilityAuditRootTabsAX5 | Tab 栏现为系统样式（D77，TAB-01 豁免）；大字号下不出屏由系统保证并经 AX5 审计 |
| `76-q2-13-hit-44` | L | AccessibilityAuditTests.testPerformAccessibilityAuditPushedPages; AccessibilityAuditTests.testPerformAccessibilityAuditPushedPagesAX5; AccessibilityFlowTests.test1005 | 触控热区 ≥ 44（hitRegion） |
| `77-e9b-write-judge` | L | QA-H1 write / judge 状态 + checks/write.mjs |  |
| `77-e9c-result` | L | QA-H1 result-* 状态; ResultFlowTests.test811 | 作品格宽表 |
| `79-e9c-settings-range` | P | LibrarySubFlowTests.testSwitchLibrarySuccessReturnsAtOnce; MineFlowTests.testEachRowOpensItsPageAndComesBack | 练习范围入口 |
| `80-c1-removed-chars` | R | —（数据；B3 期间照跑；verify:unit 题库校验） |  |
| `80-s1-sound` | P | WriteFlowTests.test211_judgeSoundsRotateAndTheSealSoundsOnceOnTheResult; WriteFlowTests.test212_traceStrokesAreSilent | B3.Z-f 起有 DEBUG 探针（feedback）。落款 s1 恰好一次、书写 / 判断页 / 描红无声已断言；**判断声 j1 轮换**在原生写字页根本没放（产品缺口 B3Zf-1，用 `QAIssue.expectFail` 标待修，修好转「意外通过」） |
| `81-h1-dates` | L | QA-H1 home / detail / records 状态（文案严格比） | 日期写法；格式化规则在 ShiziCore Dates |
| `81-h1-detail` | P | DetailFlowTests（10 + 1 条）; QA-H1 detail-* 状态 + checks/detail.mjs |  |
| `81-h1-edges` | L | QA-H1 逐屏（页边 20） |  |
| `81-h1-first-frame` | P | HomeFlowTests.testFirstBrandMomentTapFreezes | 主按钮第一帧起可见可点 |
| `81-h1-library-menu` | P | LibrarySubFlowTests.testAllCharsSortFilterFind |  |
| `81-h1-paper` | L | QA-H1 逐屏; 图片对照 46/46（平涂笺色） |  |
| `81-h1-text-buttons` | L | QA-H1 逐屏（文字按钮规格） |  |
| `81-h1-toast` | P | WriteFlowTests.test209 | 本卡补（B3.Z） |
| `81-r1-reveal` | P | ResultFlowTests.test811; ResultFlowTests.test817; ResultFlowTests.test822_sealSoundAndHapticOnceAtTheLanding | 声音半：s1 与 seal 触觉同发（序号相邻）一次、判断触觉在先、无 action；重绘不再响（B3.Z-f）。逐格显现的时序本来就在 QA-H1 / 手感里 |
| `82-x1-write-ax-se` | L | QA-H1 write × AX3/AX5（SE 档）; WriteFlowTests.test200 |  |
| `83-x1-write-ax-390` | L | QA-H1 write × AX3/AX5 |  |
| `84-x1-write-ax-430` | L | QA-H1 write × AX3/AX5 |  |
| `85-x1-transitions` | L | EntryFlowTests.test112; NativeStageFlowTests.test903 | 写字页内阶段淡入过渡是网页最小过渡；原生转场对象 ShiziTransitions 由转场记录探针断言（EntryFlowTests） |
| `86-x1-tools-paper` | L | QA-H1 write 状态 |  |
| `87-x1-haptic-once` | P | WriteFlowTests.test213_oneJudgeHapticPerCharacter | 每字「写好了」一次 light + 判断恰好一次 judge、最后一字不叠 finish 触觉（B3.Z-f，探针 feedback） |
| `88-a1-sheet-done` | L | AccessibilityFlowTests.test1002; AccessibilityAuditTests.testPerformAccessibilityAuditPushedPagesAX5 | 所有底部弹层有「完成」，读屏可达 |
| `89-a1-grid-sr` | L | AccessibilityFlowTests.test1001; AccessibilityFlowTests.test1003 | 书写格读屏名称与播报 |
| `90-a1-ref-label` | L | AccessibilityFlowTests.test1001; AccessibilityFlowTests.test1002 |  |
| `91-a1-secondary-ax` | L | QA-H1 mine / month / records × AX3/AX5 |  |
| `92-a1-small-type-frame` | L | QA-H1 逐屏（xS/S 档在 QA 夹具 sizes） |  |
| `93-c3r-seal` | P | ResultFlowTests.test811; ResultFlowTests.test822_sealSoundAndHapticOnceAtTheLanding; ResultFlowTests.test823_coldRestoreDoesNotSealAgain | 落印：s1 与 seal 触觉同发一次；冷启动恢复不重演。「同一帧 ±1 帧」的逐帧对齐探针做不到，归真机 QA（DEVICE_QA §13e / §13m） |
| `93-k1-grid-square` | L | QA-H1 write checks（书写格方形）; WriteFlowTests.test200 |  |
| `94-c3r-work-caption` | L | QA-H1 result-* 状态 |  |
| `94-k1-note-slot` | L | QA-H1 write × AX 档 |  |
| `95-c3r-preview` | L | QA-H1 preview-* 状态 |  |
| `95-k1-cjk-wrap` | L | QA-H1 逐屏（AX-01 折行 / 截断） |  |
| `96-c3h-brand` | L | QA-H1 about / home-first 状态 |  |
| `96-c3r-specs` | L | QA-H1 mine 状态 |  |
| `96-k1-aux-type` | L | QA-H1 write × AX 档（辅助字分层） |  |
| `97-c3h-first-voice` | P | ResultFlowTests.test818 | 首练结果页口吻：QA-H1 result-first 文案严格比 |
| `97-c3r-n2` | L | QA-H1 annual-* 状态 |  |
| `97-k1-sheets-ax` | L | QA-H1 query-* × AX5; AccessibilityAuditTests.testPerformAccessibilityAuditPushedPagesAX5 |  |
| `98-c3w-ax-short` | L | QA-H1 write × AX5（SE） |  |
| `98-c3w-back-x` | L | QA-H1 write / judge 状态（返回键 x 位置） |  |
| `98-c3w-flip` | L | WriteFlowTests.test401; EntryFlowTests.test112 | 阶段切换里本人墨保持一个（网页 canvas 动画细节）；原生墨层是同一个 InkSurface，ShiziWriteTests.InkSurfaceTests 覆盖 |
| `98-c3w-grid-top` | L | QA-H1 write 各阶段状态（格顶 y 同） |  |
| `98-c3w-grid-walk` | L | QA-H1 write 各阶段状态; WriteFlowTests.test401 |  |
| `99-f1-foot-stages` | P | WriteFlowTests.test401; WriteFlowTests.test601 |  |
| `99-g1-edge-swipe` | W | NavigationTests.testEdgeSwipeEqualsTapBackOnEveryL1L2 | 网页兜底手势（浏览器 / PWA） |
| `99-h2-home-e-ax` | L | QA-H1 home-* × AX3/AX5 |  |
| `99-h2-home-e` | P | HomeFlowTests.testSixStatesMainButtonDestinations | QA-H1 home-* 六态逐屏 |
| `m1-prompt-mask` | R | AccessibilityFlowTests.test1001 | 题面遮字无泄漏：原生一侧是读屏名称序列对冻结参考（答案字不出现在回忆阶段） |
| `m1-sheet-c1` | L | QA-H1 mine / month 状态 |  |

## 4. 缺口

### 4.1 本卡补上的（B3.Z 新增 XCUITest）

| 缺口 | spec | 新增用例 |
|---|---|---|
| 写到一半返回首页不出提示条 | 81-h1-toast | `WriteFlowTests.test209_backFromAHalfWrittenCardShowsNoToast` |
| 首练第 1 字格下的一次性说明：落笔后收起、撤销到 0 笔不再回来 | 76-q2-01-first-tip | `WriteFlowTests.test210_firstPracticeTipGoesAfterTheFirstStrokeAndStaysGone` |
| 字详情「加入自选」失败的就地三段式与重试 | 33-detail | `DetailFlowTests.testCustomAddFailureThreeStageThenRetry` |
| 全部字页按月折叠 / 展开 | 35-all | `LibrarySubFlowTests.testAllCharsMonthOpensAndFolds` |
| 判断声 / 落款声：书写、判断页、描红无声；s1 一次（B3.Z-f，DEBUG 探针 `feedback`） | 80-s1-sound | `WriteFlowTests.test211…` / `test212…` |
| 每字一次触觉（light + judge） | 87-x1-haptic-once | `WriteFlowTests.test213_oneJudgeHapticPerCharacter` |
| 落印声 + 触觉一次、判断触觉在先、重绘与冷启动恢复不重演 | 93-c3r-seal、81-r1-reveal（后半） | `ResultFlowTests.test822…` / `test823…` |

### 4.2 仍无原生自动用例（建议后续卡）

| 行为 | spec | 为什么没补 | 建议 |
|---|---|---|---|
| 「落印」声与触觉**逐帧同一帧**（±1 帧）、判断声 j1 的真机听感 | 93-c3r-seal（帧对齐部分） | 探针只有事件顺序、没有帧时间；声音 / 触觉本身 B3.Z-f 已补探针与用例（§4.1） | 归真机 QA（DEVICE_QA §13e、§13m） |
| 跟手返回的速度阈值（甩一下过半即返回、慢拉过半后拉回则取消） | 62-gesture | 合成手势的速度在模拟器上不稳定，容易误报；已有用例只覆盖「拖一半松手取消」（`NativeStageFlowTests.test901`）与「划过去返回」 | 归真机 QA（DEVICE_QA §4）；若要自动化需先有稳定的合成速度手势 |

### 4.3 纯网页版式门禁（随网页退役）

W 类 8 个：`50-offline`、`51-fonts`、`54-native-bridge`（引擎模式仍在用桥，B4.9 删桥时退役）、`61-perf`、`65-p0a-shell`、`67-text-size-inject`、`68-q3-boot`、`99-g1-edge-swipe`。另有几个 spec 里的**一部分**断言同属此类：`00-shell`（tab 条键盘漫游、假桥记录）、`102-interaction-compliance`（IC-00 注册表）、`102-interaction-compliance-feedback`（IC-14 动画清单）、`49-query-ime`（WebKit / Chromium 事件顺序）。

## 5. 建议停跑清单（提案，未执行）

前提：D59 ④ 决定网页构建的去留；在那之前全部继续跑（`JOBS=2 node scripts/e2e/batch.mjs`，130 spec 0 bad 是门禁的一部分）。

1. **第一批（网页构建一冻结就可停）**：W 类全部（`50` `51` `61` `65` `67-text-size-inject` `68` `99-g1`），原因：只验网页自身的加载 / 帧率 / 外壳，原生没有对应物，不会再改。`54-native-bridge` 等 B4.9 删桥时一起停。
2. **第二批（网页版界面不再随 App 发布后）**：P 类 44 个 + L 类 60 个。它们的行为已由 XCUITest 与 QA-H1 守；网页参考图（`ios/ShiziApp/ShiziUITests/Reference/`，692 屏）是 QA-H1 的标准答案，**停跑 spec 不等于可以删网页**——删网页前要先确认参考图不再重取（`--update-reference` 依赖网页构建）。
3. **不停（R 类 18 个）**：规则 / 数据借界面驱动，B4 改成 node 单测或差分序列之前继续跑；B4 完成且网页引擎去留确定后再单独处理。
4. 停跑的做法建议：给 `scripts/e2e/batch.mjs` 加一份 `retired.json`（spec 名 → 原因 + 原生替代），batch 跳过并在汇总里列出「已停跑 N 个」，而不是删文件；这样映射表就是 retired.json 的人读版。

## 6. 无障碍审计（AccessibilityAuditTests）的发现

见 `docs/engineering/v10/B3B4-原生化架构与计划.md` §10.x B3.Z；B3.Z-f 已修（致谢网址行有名字）与改按名豁免（查字弹层键盘联想条）见 §10.x B3.Z-f。

