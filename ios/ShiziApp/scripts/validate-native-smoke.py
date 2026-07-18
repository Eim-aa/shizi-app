#!/usr/bin/env python3

import json
import sys


def fail(message: str, data: dict) -> None:
    print(message, file=sys.stderr)
    print(json.dumps(data, ensure_ascii=False, indent=2), file=sys.stderr)
    raise SystemExit(65)


if len(sys.argv) not in (3, 4, 5):
    print(
        "Usage: validate-native-smoke.py /path/to/result.json <0|1 dev mode> "
        "[0|1 require persisted] [0|1 require software keyboard]",
        file=sys.stderr,
    )
    raise SystemExit(64)

if any(value not in ("0", "1") for value in sys.argv[2:]):
    print("Dev mode, persisted, and keyboard flags must be 0 or 1.", file=sys.stderr)
    raise SystemExit(64)

path = sys.argv[1]
dev_mode = sys.argv[2] == "1"
require_persisted = len(sys.argv) == 4 and sys.argv[3] == "1"
if len(sys.argv) == 5:
    require_persisted = sys.argv[3] == "1"
require_keyboard = len(sys.argv) == 5 and sys.argv[4] == "1"

with open(path, "r", encoding="utf-8") as file:
    data = json.load(file)

expected_dev_display = "block" if dev_mode else "none"
layout = data.get("layoutFlow") or {}
handwriting = data.get("handwritingFlow") or {}
data_flow = data.get("dataFlow") or {}
navigation = data.get("navigationFlow") or {}
practice = data.get("practiceFlow") or {}
exit_flow = data.get("exitFlow") or {}
checks = {
    "seed": data.get("seed") == 6854,
    "cards": int(data.get("cards") or 0) >= 6854
    and int(data.get("cards") or 0) >= int(data.get("seed") or 0),
    "groups": data.get("groups") == 6854,
    "devQuery": data.get("devQuery") is dev_mode,
    "devToolsDisplay": data.get("devToolsDisplay") == expected_dev_display,
    "localStorageWritable": data.get("localStorageWritable") is True,
    "localStoragePersisted": not require_persisted
    or data.get("localStoragePersistedFromPreviousLaunch") is True,
    "fetchOk": data.get("fetchOk") is True,
    "strokeCount": int(data.get("strokeCount") or 0) > 0,
    "safeAreaViewport": layout.get("viewportFitCover") is True
    and layout.get("viewportZoomAllowed") is True,
    "keyboardInset": layout.get("keyboardInsetVar") is True
    and layout.get("visualViewportAvailable") is True,
    "sheetKeyboardLayout": layout.get("sheetScrollable") is True
    and layout.get("sheetBottomPadding") is True
    and layout.get("addInputFocused") is True
    and layout.get("keyboardInsetMatchesViewport") is True
    and layout.get("inputVisibleAboveKeyboard") is True
    and layout.get("addConfirmReachableAboveKeyboard") is True,
    "softwareKeyboard": not require_keyboard
    or (
        layout.get("keyboardInsetActive") is True
        and float(layout.get("keyboardInsetPixels") or 0) > 0
    ),
    "practiceLayout": layout.get("practiceFixed") is True
    and layout.get("practiceActionsInViewport") is True
    and layout.get("toastAriaLive") is True,
    "accessibilityLayout": layout.get("largeTypeScaled") is True
    and layout.get("criticalTargets44") is True
    and layout.get("readableOutcomeLegend") is True
    and layout.get("outcomeMarksRedundant") is True,
    "handwritingPointerEvents": handwriting.get("pointerEventsSupported") is True
    and handwriting.get("touchActionNone") is True,
    "handwritingPreventsScroll": handwriting.get("pointerDownPrevented") is True
    and handwriting.get("pointerMovePrevented") is True
    and handwriting.get("touchMovePrevented") is True
    and handwriting.get("pageScrollStable") is True,
    "handwritingRecordsInk": handwriting.get("strokeRecorded") is True
    and int(handwriting.get("strokePointCount") or 0) >= 4
    and handwriting.get("inkPixelsChanged") is True
    and handwriting.get("undoStrokeWorked") is True
    and handwriting.get("clearWorked") is True
    and handwriting.get("actionCooldownActive") is True,
    "handwritingPeek": handwriting.get("peekEntered") is True
    and handwriting.get("peekCancelledPartialStroke") is True
    and handwriting.get("peekActionsUnlocked") is True
    and handwriting.get("peekBlockedInk") is True
    and handwriting.get("peekRestored") is True
    and handwriting.get("peekControlVisible") is True
    and handwriting.get("peekControlEntered") is True
    and handwriting.get("peekControlGlyphVisible") is True
    and handwriting.get("peekControlUncounted") is True,
    "addSheet": data_flow.get("addSheetOpened") is True
    and data_flow.get("addPreviewRendered") is True
    and data_flow.get("addConfirmEnabled") is True
    and data_flow.get("addSheetClosed") is True,
    "addStored": data_flow.get("addedCharStored") is True
    and data_flow.get("customWordStored") is True
    and data_flow.get("customCardIndexed") is True
    and data_flow.get("memoryHasAddedChar") is True,
    "backupPayload": data_flow.get("backupParses") is True
    and data_flow.get("backupHasAppMarker") is True
    and data_flow.get("backupHasAdded") is True
    and data_flow.get("backupHasCustom") is True
    and data_flow.get("backupHasMemory") is True
    and data_flow.get("backupHasReminder") is True
    and data_flow.get("backupHasSessionV2") is True
    and data_flow.get("backupHasFSRSLog") is True
    and data_flow.get("backupHasTraceTutorial") is True
    and data_flow.get("backupExcludesSmokeKey") is True
    and data_flow.get("backupExcludesSafetyKey") is True
    and data_flow.get("backupHasMeta") is True,
    "backupRestore": data_flow.get("backupRestoreApplied") is True
    and int(data_flow.get("backupRestoreKeyCount") or 0) > 0
    and data_flow.get("backupRestoreAdded") is True
    and data_flow.get("backupRestoreCustom") is True
    and data_flow.get("backupRestoreMemory") is True
    and data_flow.get("backupRestorePreservesSessionV2") is True
    and data_flow.get("backupRestorePreservesSmokeKey") is True
    and data_flow.get("backupSafetyCreated") is True
    and data_flow.get("backupRestoreRejectsInvalid") is True,
    "nativeBridge": data_flow.get("nativeBridgeAvailable") is True,
    "nativeImport": data_flow.get("nativeImportAvailable") is True,
    "nativeConfirm": data_flow.get("nativeConfirmAvailable") is True,
    "reminderState": data_flow.get("reminderStateAvailable") is True
    and data_flow.get("reminderSettingsRowVisible") is True,
    "calibrationReturn": data_flow.get("calibrationReturnInviteVisible") is True
    and data_flow.get("calibrationReturnPermissionRequested") is True,
    "navPractice": navigation.get("practiceEntryVisible") is True
    and navigation.get("practiceTabActive") is True,
    "navBook": navigation.get("bookVisible") is True
    and navigation.get("bookTabActive") is True
    and navigation.get("footVisibleOnBook") is True
    and navigation.get("bookAchievementVisible") is True
    and navigation.get("stampGuideAvailable") is True,
    "navMe": navigation.get("meVisible") is True
    and navigation.get("meTabActive") is True
    and navigation.get("footVisibleOnMe") is True
    and navigation.get("meActionsDisclosed") is True
    and navigation.get("metricLanguageConsistent") is True,
    "navProfile": navigation.get("profileVisible") is True
    and navigation.get("profileFootHidden") is True
    and navigation.get("profileReturnedToMe") is True
    and navigation.get("profileHasNoDuplicateChars") is True,
    "homeCapture": navigation.get("homeCaptureVisible") is True,
    "navAudit": navigation.get("auditVisible") is dev_mode
    and navigation.get("auditReturnedToMe") is dev_mode,
    "practiceStarted": practice.get("started") is True,
    "practiceBatch": int(practice.get("batchSize") or 0) >= 2,
    "practiceCardVisible": practice.get("cardVisible") is True,
    "practiceActionsEnabled": practice.get("showEnabled") is True
    and practice.get("doneEnabled") is True,
    "practiceReveal": practice.get("revealVisible") is True
    and practice.get("decisionVisible") is True
    and practice.get("functionalDecisionLabels") is True
    and practice.get("selfAssessmentControls") is True
    and practice.get("submissionSnapshotComplete") is True
    and practice.get("comparisonGridComplete") is True
    and practice.get("comparisonSkeletonVisible") is True
    and practice.get("comparisonCoordinatesAligned") is True,
    "practiceStamp": practice.get("outcome") == "hinted"
    and practice.get("immediateAdvanced") is True
    and practice.get("noNextButton") is True
    and practice.get("feedbackHeld") is True
    and practice.get("fsrsAgainOnly") is True,
    "practiceUndo": practice.get("undoBarFollowed") is True
    and practice.get("undoRollback") is True
    and practice.get("undoActivityRollback") is True
    and practice.get("nextCardUntouched") is True,
    "practiceTrace": practice.get("traceModeVisible") is True
    and practice.get("traceTutorialVisible") is True
    and practice.get("traceOutlineVisible") is True
    and practice.get("traceRequiresInk") is True
    and practice.get("traceReadyAfterInk") is True
    and practice.get("postTraceRecall") is True
    and practice.get("hapticTraceNoReview") is True,
    "practicePersistence": practice.get("activityRecorded") is True
    and practice.get("sessionSnapshotStored") is True
    and practice.get("resumeHomeState") is True
    and practice.get("resumeRestored") is True
    and practice.get("historyGuardArmed") is True,
    "reminderSync": practice.get("reminderSyncAfterStamp") is True,
    "haptics": practice.get("hapticSelectTipRecorded") is True
    and practice.get("hapticActionRevealRecorded") is True
    and practice.get("hapticStampRecorded") is True
    and practice.get("hapticUndoRecorded") is True
    and practice.get("hapticSelectTracingRecorded") is True,
    "hapticSequences": practice.get("hapticHintedSequence")
    == ["select", "action", "stamp"]
    and practice.get("hapticUndoSequence") == ["undo"]
    and practice.get("hapticDontKnowSequence") == ["select"]
    and practice.get("hapticTraceCompletionSequence") == []
    and practice.get("hapticMilestoneSequence") == ["milestone"]
    and practice.get("hapticOrdinaryCompletionSequence") == ["action"],
    "practiceNext": practice.get("posLabelAfter") != practice.get("posLabelBefore"),
    "exitSheetRemoved": exit_flow.get("noExitSheet") is True,
    "exitHome": exit_flow.get("returnedHome") is True
    and exit_flow.get("practiceHidden") is True
    and exit_flow.get("footVisible") is True,
    "exitUnrecordedCard": exit_flow.get("roundStatsUnchanged") is True
    and int(exit_flow.get("positionBeforeExit") or -1) >= 2,
    "historySwipeState": int(exit_flow.get("historyInitialLength") or 0) >= 2
    and int(exit_flow.get("directReturnCount") or 0) == 3
    and exit_flow.get("nativeEdgeBackEvent") is True
    and exit_flow.get("backForwardSnapshotsDisabled") is True
    and exit_flow.get("nativeEdgeGestureInstalled") is True
    and exit_flow.get("historyLengthStable") is True
    and exit_flow.get("directReturnStatePreserved") is True
    and exit_flow.get("directReturnSaved") is True
    and exit_flow.get("homeBackNoop") is True,
    "noError": not data.get("error"),
}

failed = [key for key, passed in checks.items() if not passed]
if failed:
    fail("Native WKWebView smoke failed: " + ", ".join(failed), data)

print("Native WKWebView smoke:")
print(json.dumps(data, ensure_ascii=False, indent=2))
