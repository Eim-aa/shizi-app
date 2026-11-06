# 原生写字页流程测试（XCUITest · ShiziUITests）

- 用例 188：通过 185、预期失败（待修）0、意外通过 0、失败 3；待办（骨架，页面卡填）6

| 用例 | 结果 | 秒 | 说明 |
|---|---|---|---|
| AccessibilityAuditTests.testPerformAccessibilityAuditPushedPages | 通过 | 284 |  |
| AccessibilityAuditTests.testPerformAccessibilityAuditPushedPagesAX5 | 通过 | 254 |  |
| AccessibilityAuditTests.testPerformAccessibilityAuditRootTabs | 通过 | 43 |  |
| AccessibilityAuditTests.testPerformAccessibilityAuditRootTabsAX5 | 通过 | 42 |  |
| AccessibilityFlowTests.test1001_spokenOrderMatchesTheWebOnTheWritePage | 通过 | 101 |  |
| AccessibilityFlowTests.test1002_spokenOrderMatchesTheWebOnTheJudgeResultAndOverlays | 通过 | 67 |  |
| AccessibilityFlowTests.test1003_announcementsFollowTheWeb | 通过 | 59 |  |
| AccessibilityFlowTests.test1004_saveFailureIsAnnounced | 通过 | 24 |  |
| AccessibilityFlowTests.test1005_ax5AccessibilityAudit | 通过 | 154 |  |
| BackupFlowTests.testClearThenUndo | 通过 | 31 |  |
| BackupFlowTests.testExportShowsShareSheet | 通过 | 23 |  |
| BackupFlowTests.testImportPrecheckRejectsThreeKinds | 通过 | 61 |  |
| BackupFlowTests.testRestoreConfirmUndoBarUndo | 通过 | 31 |  |
| BackupFlowTests.testUndoBarSurvivesKill | 通过 | 38 |  |
| BlockTests.testBlockedBlockWithExport | 通过 | 17 |  |
| BlockTests.testExportBackupFromBlock | 通过 | 16 |  |
| BlockTests.testMigrationBlock | 通过 | 14 |  |
| BlockTests.testRetry | 通过 | 19 |  |
| BlockTests.testUnavailableBlock | 通过 | 13 |  |
| DetailFlowTests.testCustomAddFailureThreeStageThenRetry | 通过 | 20 |  |
| DetailFlowTests.testCustomAddRemoveUndo | 通过 | 29 |  |
| DetailFlowTests.testEnterFromResultAndComeBack | 通过 | 36 |  |
| DetailFlowTests.testLegacyPhotoPage | 通过 | 28 |  |
| DetailFlowTests.testPracticeThisChar | 通过 | 29 |  |
| DetailFlowTests.testRecordCellZoomCorrectJudgment | 通过 | 47 |  |
| DetailFlowTests.testReopenZoomRightAfterClosing | 通过 | 30 |  |
| DetailFlowTests.testWordOffAndUndo | 通过 | 25 |  |
| DetailFlowTests.testYieldToWebAndComeBack | 通过 | 29 |  |
| DetailFlowTests.testZoomCorrectionFailureAndRetry | 通过 | 29 |  |
| DetailFlowTests.testZoomEdgeClosesOnlyTheSheet | 通过 | 28 |  |
| EntryFlowTests.test101_homeStartFirstPractice | 通过 | 41 |  |
| EntryFlowTests.test101b_strokeThenImmediateBackUnderSlowBridge | 通过 | 31 |  |
| EntryFlowTests.test101c_strokeThenImmediateEdgeBackUnderSlowBridge | 通过 | 34 |  |
| EntryFlowTests.test102_homeContinueAndProgressSync | 通过 | 42 |  |
| EntryFlowTests.test103_libraryTodayPushesAndReturns | 通过 | 52 |  |
| EntryFlowTests.test104_libraryTierPracticeAndEdgeBack | 通过 | 37 |  |
| EntryFlowTests.test105_detailPracticeThisChar | 通过 | 43 |  |
| EntryFlowTests.test106_resultAgainThenBackGoesHome | 通过 | 28 |  |
| EntryFlowTests.test107_resultExitReturnsToSource | 通过 | 21 |  |
| EntryFlowTests.test108_resultRedoWrongCharsRecordsNothing | 通过 | 46 |  |
| EntryFlowTests.test109_queryPracticeThisChar | 通过 | 40 |  |
| EntryFlowTests.test110_homeEntryEdgeBackFoldsTheSamePaper | 通过 | 28 |  |
| EntryFlowTests.test111_libraryEntryPushesAndEdgeSlidesBack | 通过 | 38 |  |
| EntryFlowTests.test112_reduceMotionFadesEveryEntry | 通过 | 41 |  |
| EntryFlowTests.test113_entryWithoutSourceIsQuiet | 通过 | 21 |  |
| EntryFlowTests.test114_resultFromAHomeEntryFoldsBackIntoTheButton | 通过 | 79 |  |
| HomeFlowTests.testColdStartRestoresHome | 通过 | 20 |  |
| HomeFlowTests.testFirstBrandMomentTapFreezes | 通过 | 13 |  |
| HomeFlowTests.testLeaveUndoBarHandoff | 通过 | 32 |  |
| HomeFlowTests.testPaperTransitionFirstFrameIsSourceRect | 通过 | 31 |  |
| HomeFlowTests.testPickCharsEntry | 通过 | 26 |  |
| HomeFlowTests.testSixStatesMainButtonDestinations | 通过 | 150 |  |
| HomeFlowTests.testSpecialGroupDeferral | 通过 | 22 |  |
| HomeFlowTests.testStartFailureRetriesInPlace | 通过 | 24 |  |
| ImageFlowTests.testAlsoPutIn | 通过 | 22 |  |
| ImageFlowTests.testFailureToast | 通过 | 4 |  |
| ImageFlowTests.testPagedOver80Chars | 通过 | 37 |  |
| ImageFlowTests.testRatioSwitch | 通过 | 48 |  |
| ImageFlowTests.testSaveToPhotos | 通过 | 19 |  |
| KnownIssueTests.testNF01_homeEntryUsesThePaperTransition | 通过 | 29 |  |
| KnownIssueTests.testNF03_endDialogCopyMatchesTheChecklist | 通过 | 13 |  |
| KnownIssueTests.testNF04_redoPageIsNative | 通过 | 21 |  |
| KnownIssueTests.testNF05_retraceInkIsNotSaved | 通过 | 35 |  |
| KnownIssueTests.testNP01_changeLinkWholeHitArea | 通过 | 21 |  |
| KnownIssueTests.testNP06_judgeSaveFailureThreeSteps | 通过 | 27 |  |
| LibraryFlowTests.testAllButtonOpensAllPage | 通过 | 22 |  |
| LibraryFlowTests.testCategoryRowOpensZoneList | 通过 | 23 |  |
| LibraryFlowTests.testLeaveUndoBarFollowsToLibrary | 通过 | 27 |  |
| LibraryFlowTests.testSearchOpensQuery | 通过 | 21 |  |
| LibraryFlowTests.testTodayPracticeFailureShowsThreeStage | 通过 | 26 |  |
| LibraryFlowTests.testTodayPracticeRowPushesWritePage | 通过 | 28 |  |
| LibrarySubFlowTests.testAllCharsBigLibraryScrollsToTheEnd | **失败** | 149 | LibrarySubFlowTests.swift:160: XCTAssertTrue failed - 滑到了底：最后一格在屏上且不再动（(336.75, 2737.75, 45.25, 63.25)） |
| LibrarySubFlowTests.testAllCharsCellTapOpensDetail | 通过 | 17 |  |
| LibrarySubFlowTests.testAllCharsMonthOpensAndFolds | 通过 | 20 |  |
| LibrarySubFlowTests.testAllCharsParamsColdRestore | 通过 | 24 |  |
| LibrarySubFlowTests.testAllCharsSortFilterFind | 通过 | 47 |  |
| LibrarySubFlowTests.testBigListRowsStayTappableAndKeepSelection | **失败** | 150 | LibrarySubFlowTests.swift:211: XCTAssertTrue failed - 滑到了底：最后一行在屏上且不再动 |
| LibrarySubFlowTests.testSwitchLibraryFailureThreeStage | 通过 | 25 |  |
| LibrarySubFlowTests.testSwitchLibrarySuccessReturnsAtOnce | 通过 | 29 |  |
| LibrarySubFlowTests.testTierToListToPickedSession | 通过 | 29 |  |
| MineFlowTests.testAppearanceSegmentsApplyAtOnce | 通过 | 37 |  |
| MineFlowTests.testAx5AppearanceSheetOpenSelectClose | 通过 | 43 |  |
| MineFlowTests.testAx5ChoiceFailureAnnouncesOnlyAfterFailure | 通过 | 41 |  |
| MineFlowTests.testAx5ChoiceSheet | 通过 | 32 |  |
| MineFlowTests.testAx5ChoiceSheetEdgeClosesOnlySheet | 通过 | 33 |  |
| MineFlowTests.testEachRowOpensItsPageAndComesBack | **失败** | 71 | MineFlowTests.swift:36: failed - row native-mine-menu-annual: the control is gone |
| MineFlowTests.testGroupSizeSyncsHomeAndLibrary | 通过 | 116 |  |
| MineFlowTests.testRemindSwitchTimeDenied | 待办（骨架） | 0 | Test skipped - 待 B3.10：提醒开关 / 时间 / 被拒跳设置 |
| MineFlowTests.testYieldToWebAndBack | 通过 | 60 |  |
| MineSubFlowTests.testAnnualMonthOpensCopybookAndBack | 通过 | 39 |  |
| MineSubFlowTests.testAnnualMonthSectionsTakeARealTap | 通过 | 62 |  |
| MineSubFlowTests.testAnnualPastYear | 通过 | 34 |  |
| MineSubFlowTests.testAnnualSaveOpensImagePreview | 通过 | 49 |  |
| MineSubFlowTests.testAnnualSwitchYear | 通过 | 44 |  |
| MineSubFlowTests.testAnnualTwiceAtTheEnd | 通过 | 37 |  |
| MineSubFlowTests.testMonthCopybookOpensDetail | 通过 | 46 |  |
| MineSubFlowTests.testMonthImageButtonsOpenPreview | 通过 | 56 |  |
| MineSubFlowTests.testRecordsDayCellIntoDetailAndBack | 通过 | 43 |  |
| MineSubFlowTests.testRecordsExpandAndCollapseDay | 通过 | 53 |  |
| MineSubFlowTests.testRecordsMonthSwitch | 通过 | 69 |  |
| MineSubFlowTests.testRecordsSaveOpensImagePreview | 通过 | 45 |  |
| MineSubFlowTests.testRecordsSheetOpensMonthAndEdgeBack | 通过 | 66 |  |
| NativeStageFlowTests.test900_webNativeNativeWebPushAndBack | 通过 | 54 |  |
| NativeStageFlowTests.test901_edgeDragCancelKeepsThePage | 通过 | 37 |  |
| NativeStageFlowTests.test902_backTwiceReturnsToTheWebPage | 通过 | 37 |  |
| NativeStageFlowTests.test903_tapToFirstFrameP95 | 通过 | 243 |  |
| NavigationTests.testColdStartRestoresTheTab | 通过 | 66 |  |
| NavigationTests.testEdgeSwipeEqualsTapBackOnEveryL1L2 | 待办（骨架） | 0 | Test skipped - 待 B3.2 / B3.5d：每个 L1 / L2 画面：左缘右滑结果 == 点左上（IC-03 遍历原生版） |
| NavigationTests.testN7PageDoesNotPan | 待办（骨架） | 0 | Test skipped - 待 B3.2 / B3.5d：N7 整页不平移（内容容器外拖动页头不动） |
| NavigationTests.testPushFromEachRootHidesTheBarAndEdgeBackReturns | 通过 | 99 |  |
| NavigationTests.testSheetOpenEdgeOnlyClosesSheet | 待办（骨架） | 0 | Test skipped - 待 B3.2 / B3.5d：弹层开着时左缘只关弹层 |
| NavigationTests.testTabReTapScrollsToTop | 通过 | 40 |  |
| NavigationTests.testTabRootHasNoEdgeBack | 通过 | 21 |  |
| NavigationTests.testTabsSwitchBetweenThreeRoots | 通过 | 78 |  |
| NavigationTests.testTabSwitchKeepsEachTabState | 通过 | 38 |  |
| NavigationTests.testTwoFingerZ | 待办（骨架） | 0 | Test skipped - 待 B3.2 / B3.5d：两指 Z 形 |
| NoneFlowTests.test910_nonePageIsNative | 通过 | 16 |  |
| NoneFlowTests.test911_nonePickOpensTheNativeSheet | 通过 | 24 |  |
| NoneFlowTests.test912_noneExhaustedHasLibSwitchAndWrong | 通过 | 12 |  |
| QueryFlowTests.testAddFailureRetry | 通过 | 25 |  |
| QueryFlowTests.testAddFailureThreeStage | 通过 | 28 |  |
| QueryFlowTests.testAddSuccessTurnsButtonIntoAlreadyAdded | 通过 | 24 |  |
| QueryFlowTests.testImeComposingDoesNotQueryEarly | 通过 | 17 |  |
| QueryFlowTests.testKeyboardUpFourExitsStartAtOnce | 通过 | 73 |  |
| QueryFlowTests.testLookupAndPickModes | 通过 | 64 |  |
| QueryFlowTests.testPickPracticeClosesTheSheetFirst | 通过 | 30 |  |
| QueryFlowTests.testPickSelectsChar | 通过 | 21 |  |
| QueryFlowTests.testPracticeFromCardReturnsToTheCard | 通过 | 38 |  |
| QueryFlowTests.testS02FailureStaysInTheBox | 通过 | 23 |  |
| QueryFlowTests.testS02ThreeButtons | 通过 | 21 |  |
| QueryFlowTests.testSheetHidesTheRootFromVoiceOver | 通过 | 23 |  |
| RemindFlowTests.testDeniedShowsNoteWithoutTimeRow | 通过 | 13 |  |
| RemindFlowTests.testSwitchTurnsTimeRowOnAndOff | 通过 | 16 |  |
| RemindFlowTests.testTimePickerConfirmsAndWrites | 通过 | 18 |  |
| RemindFlowTests.testTimeWriteFailureShowsThreeSteps | 通过 | 18 |  |
| RemindFlowTests.testWriteFailureCancelKeepsSwitchOff | 通过 | 16 |  |
| RemindFlowTests.testWriteFailureRetryWritesAgain | 通过 | 16 |  |
| RestoreAndDeepLinkTests.testAcross4amNotRestored | 通过 | 21 |  |
| RestoreAndDeepLinkTests.testBadRouteHintGoesHome | 通过 | 27 |  |
| RestoreAndDeepLinkTests.testBlockPriority | 通过 | 19 |  |
| RestoreAndDeepLinkTests.testBootFrameFollowsSavedTab | 通过 | 56 |  |
| RestoreAndDeepLinkTests.testCorruptNoticePriority | 待办（骨架） | 0 | Test skipped - 待 B3.F：坏值优先：planColdStart 的 node 单测覆盖；App 内无启动时隔离坏值的测试入口 |
| RestoreAndDeepLinkTests.testDeepLinkWithUnfinishedBGroupShowsS02 | 通过 | 19 |  |
| RestoreAndDeepLinkTests.testKillRestoresEachPage | 通过 | 138 |  |
| RestoreAndDeepLinkTests.testReminderDeepLinkBeatsRestore | 通过 | 19 |  |
| RestoreAndDeepLinkTests.testStaleNotRestored | 通过 | 19 |  |
| RestoreAndDeepLinkTests.testWarmDeepLinkWithUnfinishedBGroupShowsS02 | 通过 | 14 |  |
| RestoreAndDeepLinkTests.testWarmReminderDeepLinkOpensTheWritePage | 通过 | 14 |  |
| ResultFlowTests.test811_lastJudgeFadesIntoTheNativeResult | 通过 | 29 |  |
| ResultFlowTests.test812_closeAndEdgeBackReturnToTheSource | 通过 | 44 |  |
| ResultFlowTests.test813_againThenBackGoesHome | 通过 | 35 |  |
| ResultFlowTests.test814_changeFlipsOnlyThisOnce | 通过 | 31 |  |
| ResultFlowTests.test815_skipUndoIsHandedOverAndStillUndoes | 通过 | 23 |  |
| ResultFlowTests.test816_redoEntersAndComesBack | 通过 | 41 |  |
| ResultFlowTests.test817_coldRestoreShowsTheSameResult | 通过 | 31 |  |
| ResultFlowTests.test818_firstPracticeInviteThenDone | 通过 | 29 |  |
| ResultFlowTests.test819_redoWritesEveryWrongCharThenDone | 通过 | 66 |  |
| ResultFlowTests.test820_redoBackAndEdgeMidway | 通过 | 77 |  |
| ResultFlowTests.test821_redoColdStartLandsHomeLikeTheWeb | 通过 | 46 |  |
| ResultFlowTests.test822_sealSoundAndHapticOnceAtTheLanding | 通过 | 28 |  |
| ResultFlowTests.test823_coldRestoreDoesNotSealAgain | 通过 | 29 |  |
| TodayPlanFlowTests.testCompletionShowsTodayDoneThenAnotherGroup | 通过 | 132 |  |
| TodayPlanFlowTests.testPickedPracticeCountsTowardToday | 通过 | 88 |  |
| TodayPlanFlowTests.testRetryLoopComesBackThreeLaterAndTheThirdFailIsTomorrow | 通过 | 165 |  |
| TodayPlanFlowTests.testTierSettingSheetSavesTheChoice | 通过 | 33 |  |
| WriteFlowTests.test200_ax5OverflowScrollKeepsInkAndFooter | 通过 | 34 |  |
| WriteFlowTests.test201_recallLayoutUndoClear | 通过 | 42 |  |
| WriteFlowTests.test202_recallBackKeepsTheSceneAndReturnsToSource | 通过 | 23 |  |
| WriteFlowTests.test203_recallEdgeSwipeLeaves | 通过 | 21 |  |
| WriteFlowTests.test204_everyStrokeInTheGridIsKept | 通过 | 167 |  |
| WriteFlowTests.test205_rapidStrokesThenDoneKeepEveryStroke | 通过 | 38 |  |
| WriteFlowTests.test206_strokeStartedOutsideTheGridBeginsAtTheEdge | 通过 | 24 |  |
| WriteFlowTests.test207_strokeStartedOnAButtonStaysTheButton | 通过 | 21 |  |
| WriteFlowTests.test208_strokeStartedAtTheLeftEdgeIsStillBack | 通过 | 19 |  |
| WriteFlowTests.test209_backFromAHalfWrittenCardShowsNoToast | 通过 | 20 |  |
| WriteFlowTests.test210_firstPracticeTipGoesAfterTheFirstStrokeAndStaysGone | 通过 | 24 |  |
| WriteFlowTests.test211_judgeSoundsRotateAndTheSealSoundsOnceOnTheResult | 通过 | 134 |  |
| WriteFlowTests.test212_traceStrokesAreSilent | 通过 | 37 |  |
| WriteFlowTests.test213_oneJudgeHapticPerCharacter | 通过 | 127 |  |
| WriteFlowTests.test301_hintStepsUpToTheWholeChar | 通过 | 39 |  |
| WriteFlowTests.test401_showAnswerTraceRetraceNext | 通过 | 43 |  |
| WriteFlowTests.test402_traceRestoresAfterRelaunch | 通过 | 25 |  |
| WriteFlowTests.test501_judgeBackAndEdgeKeepInk | 通过 | 38 |  |
| WriteFlowTests.test502_judgeAdvancesAndShowsTheLine | 通过 | 21 |  |
| WriteFlowTests.test503_changeSheetFlipsOnlyThisOnce | 通过 | 21 |  |
| WriteFlowTests.test504_changeSheetViewCharOpensTheDetailAndComesBack | 通过 | 37 |  |
| WriteFlowTests.test601_skipAndUndo | 通过 | 20 |  |
| WriteFlowTests.test602_skipTheLastCharGoesToResultWithUndo | 通过 | 20 |  |
| WriteFlowTests.test701_endWithZeroJudgedReturnsToSource | 通过 | 25 |  |
| WriteFlowTests.test702_endWithJudgedGoesToResult | 通过 | 20 |  |
| WriteFlowTests.test703_endDialogContinueStays | 通过 | 18 |  |
| WriteFlowTests.test801_lastJudgeGoesStraightToResult | 通过 | 24 |  |
| WriteFlowTests.test901_killAndRelaunchRestoresCardAndInk | 通过 | 26 |  |
| WriteFlowTests.test902_killInJudgeRestoresJudge | 通过 | 24 |  |

## flaky retries（测试工具自动重试，最多一次；产品问题不会被吞）

- 重试 3 次

- ShiziUITests.LibrarySubFlowTests testAllCharsSortFilterFind :: QA-RETRY tap-no-effect scale=1.6 sort by age probe=["route": {
- ShiziUITests.LibrarySubFlowTests testAllCharsSortFilterFind :: QA-NOEFFECT tap sort by age still shows no change after one retry; probe = ["records": 178, "kinds": {
- ShiziUITests.MineSubFlowTests testRecordsMonthSwitch :: QA-RETRY tap-no-effect scale=1.4 native-records-prev probe=["stage": {
- ShiziUITests.MineSubFlowTests testRecordsMonthSwitch :: QA-NOEFFECT tap native-records-prev still shows no change after one retry; probe = ["stage": {
- ShiziUITests.MineSubFlowTests testRecordsMonthSwitch :: QA-RETRY tap-no-effect scale=1.4 native-records-next probe=["stage": {
