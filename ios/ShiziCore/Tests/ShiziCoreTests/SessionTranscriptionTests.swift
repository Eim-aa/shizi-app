import XCTest
@testable import ShiziCore

final class SessionTranscriptionTests: XCTestCase {
    func run(_ name: String) throws {
        JSMath.flavor = .v8
        let fixture = try loadFixture("session-contract")
        let groups = fixture["groups"]!.arrayValue!.filter { $0["name"] == .string(name) }
        XCTAssertEqual(groups.count,4,name)
        for group in groups {
            let engine = CoreEngine(timeZone:TimeZone(identifier:JS.string(group["tz"]))!)
            for (i,step) in group["steps"]!.arrayValue!.enumerated() {
                let result = engine.handle(step["request"]!), label = name + " step " + String(i)
                XCTAssertEqual(result["ok"],.bool(true),label)
                XCTAssertEqual(result["reply"],step["reply"],label)
                XCTAssertEqual(result["state"],step["state"],label)
            }
        }
    }
    // test/ui/native-write.test.mjs — ops: the named set; unknown op is rejected without throwing
    func testNativeWrite01() throws {
        let names = ["open","strokes","phase","judge","exit","copy","hint","correct","showAnswer","answerPhase","answerNext","skip","undoSkip","end","firstTip","redoOpen","redoNext","redoExit","refLabel"]
        XCTAssertEqual(SessionResources.ui["writeOps"],.array(names.map(JSValue.string)))
        for name in names { XCTAssertNotNil(CoreEngine.ops["write."+name]) }
        try run("ops: the named set; unknown op is rejected without throwing") }
    // test/ui/native-write.test.mjs — switch: off unless the iOS shell injected __shiziNativeWrite
    func testNativeWrite02() throws { try run("switch: off unless the iOS shell injected __shiziNativeWrite") }
    // test/ui/native-write.test.mjs — wire format: strokes round-trip, pressure kept only when present, junk points dropped
    func testNativeWrite03() throws { try run("wire format: strokes round-trip, pressure kept only when present, junk points dropped") }
    // test/ui/native-write.test.mjs — copy: native strings come from src/config/copy (same values as t())
    func testNativeWrite04() throws { try run("copy: native strings come from src/config/copy (same values as t())") }
    // test/ui/native-write.test.mjs — snapshot: current card, progress, prompt cells; the answer char is not in any spoken label (D16)
    func testNativeWrite05() throws { try run("snapshot: current card, progress, prompt cells; the answer char is not in any spoken label (D16)") }
    // test/ui/native-write.test.mjs — strokes op = commitStrokes (same session.current), and snapshot restores them
    func testNativeWrite06() throws { try run("strokes op = commitStrokes (same session.current), and snapshot restores them") }
    // test/ui/native-write.test.mjs — judge through the API = the web judgment path, field by field (records, sched/FSRS, ink, session, lastEnded)
    func testNativeWrite07() throws { try run("judge through the API = the web judgment path, field by field (records, sched/FSRS, ink, session, lastEnded)") }
    // test/ui/native-write.test.mjs — judge reply on the last card says finished; exit navigates to the result page
    func testNativeWrite08() throws { try run("judge reply on the last card says finished; exit navigates to the result page") }
    // test/ui/native-write.test.mjs — R9-B: exit to the char detail (改判弹层「看这个字 ›」, D66 ⑮) pushes the detail over the write entry — same openCharDetail as the web ViewCharLink
    func testNativeWrite09() throws { try run("R9-B: exit to the char detail (改判弹层「看这个字 ›」, D66 ⑮) pushes the detail over the write entry — same openCharDetail as the web ViewCharLink") }
    // test/ui/native-write.test.mjs — R9-B: open carries the type tokens the page injects (原生按网页字阶排字，不抄表)
    func testNativeWrite10() throws { try run("R9-B: open carries the type tokens the page injects (原生按网页字阶排字，不抄表)") }
    // test/ui/native-write.test.mjs — B3.1: open / resultLook carry the page theme (原生颜色取 ShiziKit 生成值、按页面主题选浅 / 深)；没注入 / 读不到时不给
    func testNativeWrite11() throws { try run("B3.1: open / resultLook carry the page theme (原生颜色取 ShiziKit 生成值、按页面主题选浅 / 深)；没注入 / 读不到时不给") }
    // test/ui/native-write.test.mjs — D07: a failed judgment changes nothing and does not advance; the retry records once
    func testNativeWrite12() throws { try run("D07: a failed judgment changes nothing and does not advance; the retry records once") }
    // test/ui/native-write.test.mjs — judge with no strokes is refused before any commit (D03)
    func testNativeWrite13() throws { try run("judge with no strokes is refused before any commit (D03)") }
    // test/ui/native-write.test.mjs — open: recovery is idempotent (a judged-but-not-advanced card is advanced once), snapshot + copy in one reply
    func testNativeWrite14() throws { try run("open: recovery is idempotent (a judged-but-not-advanced card is advanced once), snapshot + copy in one reply") }
    // test/ui/native-write.test.mjs — open: timing for the native surface comes from the same source as the web page (P227 pen arm, M1 judge keys)
    func testNativeWrite15() throws { try run("open: timing for the native surface comes from the same source as the web page (P227 pen arm, M1 judge keys)") }
    // test/ui/native-write.test.mjs — hint op: every tap = the web hint path field by field, up to the whole char (= answer seen, D64 ①)
    func testNativeWrite16() throws { try run("hint op: every tap = the web hint path field by field, up to the whole char (= answer seen, D64 ①)") }
    // test/ui/native-write.test.mjs — hint op: no group data → one stroke per tap; a segment already written is skipped (same skip as the web)
    func testNativeWrite17() throws { try run("hint op: no group data → one stroke per tap; a segment already written is skipped (same skip as the web)") }
    // test/ui/native-write.test.mjs — hint op: all hint strokes absorbed → hintRange null; undo brings them back (= web hint-fade commit)
    func testNativeWrite18() throws { try run("hint op: all hint strokes absorbed → hintRange null; undo brings them back (= web hint-fade commit)") }
    // test/ui/native-write.test.mjs — hint op: no stroke data → unavailable button + note; stale card refused; a failed write still gives the hint (P52) and the next write catches up
    func testNativeWrite19() throws { try run("hint op: no stroke data → unavailable button + note; stale card refused; a failed write still gives the hint (P52) and the next write catches up") }
    // test/ui/native-write.test.mjs — hints feed the judgment the same way on both paths (D66 ②: review with 2+ hints)
    func testNativeWrite20() throws { try run("hints feed the judgment the same way on both paths (D66 ②: review with 2+ hints)") }
    // test/ui/native-write.test.mjs — snapshot: hint range, answer seen and the previous card line (text; the 修改 › action text comes with it)
    func testNativeWrite21() throws { try run("snapshot: hint range, answer seen and the previous card line (text; the 修改 › action text comes with it)") }
    // test/ui/native-write.test.mjs — correct op: 改判 = the web commitCorrection field by field, flips once and never counts twice (D19 / D07)
    func testNativeWrite22() throws { try run("correct op: 改判 = the web commitCorrection field by field, flips once and never counts twice (D19 / D07)") }
    // test/ui/native-write.test.mjs — correct op: only the line record of this session can be changed (sessions.canCorrect); a later card closes the door
    func testNativeWrite23() throws { try run("correct op: only the line record of this session can be changed (sessions.canCorrect); a later card closes the door") }
    // test/ui/native-write.test.mjs — correct op state: sheet data = the record (char, judgment, own strokes from the stored ink); a failed write changes nothing and the retry applies once
    func testNativeWrite24() throws { try run("correct op state: sheet data = the record (char, judgment, own strokes from the stored ink); a failed write changes nothing and the retry applies once") }
    // test/ui/native-write.test.mjs — correct op: native copy keys for the sheet are all in the open payload (title, two cards, note, buttons, three-part failure)
    func testNativeWrite25() throws { try run("correct op: native copy keys for the sheet are all in the open payload (title, two cards, note, buttons, three-part failure)") }
    // test/ui/native-write.test.mjs — showAnswer = commitAnswerSeen: answer-seen record + straight into the trace phase (D64 ②), a review char gets one Again (D66 ①)
    func testNativeWrite26() throws { try run("showAnswer = commitAnswerSeen: answer-seen record + straight into the trace phase (D64 ②), a review char gets one Again (D66 ①)") }
    // test/ui/native-write.test.mjs — answer flow: trace → 凭记忆写 (retrace) → 下一个, strokes included — web path and API path agree on every commit (D70 ② no self ink, D66 ① Again)
    func testNativeWrite27() throws { try run("answer flow: trace → 凭记忆写 (retrace) → 下一个, strokes included — web path and API path agree on every commit (D70 ② no self ink, D66 ① Again)") }
    // test/ui/native-write.test.mjs — answer flow: 再描一遍 (retrace → trace) and the recall-after-answer-seen path (hint gave the whole char) behave like the web
    func testNativeWrite28() throws { try run("answer flow: 再描一遍 (retrace → trace) and the recall-after-answer-seen path (hint gave the whole char) behave like the web") }
    // test/ui/native-write.test.mjs — answer ops: a failed write changes nothing (D07), the retry succeeds once; a stale card is refused with the advanced snapshot; bad phase refused
    func testNativeWrite29() throws { try run("answer ops: a failed write changes nothing (D07), the retry succeeds once; a stale card is refused with the advanced snapshot; bad phase refused") }
    // test/ui/native-write.test.mjs — answer flow: 下一个 on the last char finishes the group in the same call (same order as the web page)
    func testNativeWrite30() throws { try run("answer flow: 下一个 on the last char finishes the group in the same call (same order as the web page)") }
    // test/ui/native-write.test.mjs — open: trace / skip-undo parameters come from the same policy as the web (stepPlay ≤ 1.6s, hook width, 5s undo)
    func testNativeWrite31() throws { try run("open: trace / skip-undo parameters come from the same policy as the web (stepPlay ≤ 1.6s, hook width, 5s undo)") }
    // test/ui/native-write.test.mjs — open: ink parameters are the web buildStroke table (policy.ink + INK_SPEC), D72 ②
    func testNativeWrite32() throws { try run("open: ink parameters are the web buildStroke table (policy.ink + INK_SPEC), D72 ②") }
    // test/ui/native-write.test.mjs — skip + undoSkip = commitSkip + commitUndoSkip: record, session, hints and the strokes written back, field by field
    func testNativeWrite33() throws { try run("skip + undoSkip = commitSkip + commitUndoSkip: record, session, hints and the strokes written back, field by field") }
    // test/ui/native-write.test.mjs — skip: writes the same skipped record as the web (no judgment, not re-implemented)
    func testNativeWrite34() throws { try run("skip: writes the same skipped record as the web (no judgment, not re-implemented)") }
    // test/ui/native-write.test.mjs — skip: D07 — a failed skip changes nothing; the retry records once; a second skip of the same card is stale
    func testNativeWrite35() throws { try run("skip: D07 — a failed skip changes nothing; the retry records once; a second skip of the same card is stale") }
    // test/ui/native-write.test.mjs — undoSkip: only the last skipped record can be undone (stale otherwise); a failed undo changes nothing and retries
    func testNativeWrite36() throws { try run("undoSkip: only the last skipped record can be undone (stale otherwise); a failed undo changes nothing and retries") }
    // test/ui/native-write.test.mjs — skip of the last char finishes the group; exit hands the undo chance (remaining ms + strokes) to the result page / source page
    func testNativeWrite37() throws { try run("skip of the last char finishes the group; exit hands the undo chance (remaining ms + strokes) to the result page / source page") }
    // test/ui/native-write.test.mjs — end: counts and commit = endConfirmCounts + commitEndGroup (web path); judged > 0 → result page, none judged → back to the source
    func testNativeWrite38() throws { try run("end: counts and commit = endConfirmCounts + commitEndGroup (web path); judged > 0 → result page, none judged → back to the source") }
    // test/ui/native-write.test.mjs — end: D07 — failure keeps the group (retry ends it once); stale after it ended; the first practice cannot be ended; snapshot says canEnd
    func testNativeWrite39() throws { try run("end: D07 — failure keeps the group (retry ends it once); stale after it ended; the first practice cannot be ended; snapshot says canEnd") }
    // test/ui/native-write.test.mjs — firstTip: snapshot says due exactly when the web useFirstTip would show it; the op = commitFirstTipSeen (once)
    func testNativeWrite40() throws { try run("firstTip: snapshot says due exactly when the web useFirstTip would show it; the op = commitFirstTipSeen (once)") }
    // test/ui/native-write.test.mjs — prompt fill: the blank cell carries the answer only in the trace phase (web REVEAL_PHASES), never in recall / retrace (D16)
    func testNativeWrite41() throws { try run("prompt fill: the blank cell carries the answer only in the trace phase (web REVEAL_PHASES), never in recall / retrace (D16)") }
    // test/ui/native-write.test.mjs — B2.7 ops: the result set is named; resultLook carries copy (incl. the result keys), timing and the result motion from config/motion
    func testNativeWrite42() throws { try run("B2.7 ops: the result set is named; resultLook carries copy (incl. the result keys), timing and the result motion from config/motion") }
    // test/ui/native-write.test.mjs — B2.7 result op = the web result page mount (commitFinish, idempotent) + the view of the same resultModel
    func testNativeWrite43() throws { try run("B2.7 result op = the web result page mount (commitFinish, idempotent) + the view of the same resultModel") }
    // test/ui/native-write.test.mjs — B2.7 result view (page side): work cells / rows / kuan / reveal come from the web result page functions
    func testNativeWrite44() throws { try run("B2.7 result view (page side): work cells / rows / kuan / reveal come from the web result page functions") }
    // test/ui/native-write.test.mjs — B2.7 resultCell: the sheet model is the web ResultCellSheet (title / note / top label / flip); skipped and answer-seen only look
    func testNativeWrite45() throws { try run("B2.7 resultCell: the sheet model is the web ResultCellSheet (title / note / top label / flip); skipped and answer-seen only look") }
    // test/ui/native-write.test.mjs — B2.7 resultCorrect = commitResultCorrection field by field (D19: same record, corrections appended, sched replayed); once only; failure changes nothing
    func testNativeWrite46() throws { try run("B2.7 resultCorrect = commitResultCorrection field by field (D19: same record, corrections appended, sched replayed); once only; failure changes nothing") }
    // test/ui/native-write.test.mjs — B2.7 resultAdd / resultSealed = commitAdded / commitSealed (web path), the seal sound is asked for once per group
    func testNativeWrite47() throws { try run("B2.7 resultAdd / resultSealed = commitAdded / commitSealed (web path), the seal sound is asked for once per group") }
    // test/ui/native-write.test.mjs — B2.7 resultUndoSkip = commitResultSkipUndo (session back in the slot, record removed, strokes written back), then the page goes back to the write page
    func testNativeWrite48() throws { try run("B2.7 resultUndoSkip = commitResultSkipUndo (session back in the slot, record removed, strokes written back), then the page goes back to the write page") }
    // test/ui/native-write.test.mjs — B2.7 resultAgain = the web 再写一组 (startNextA with the group source), then the page replaces the result with the write page (D70)
    func testNativeWrite49() throws { try run("B2.7 resultAgain = the web 再写一组 (startNextA with the group source), then the page replaces the result with the write page (D70)") }
    // test/ui/native-write.test.mjs — B2.7 resultExit: leave → the web leaveTo(model.leave); redo → the wrong chars of this group; detail / share pass through; nothing is written
    func testNativeWrite50() throws { try run("B2.7 resultExit: leave → the web leaveTo(model.leave); redo → the wrong chars of this group; detail / share pass through; nothing is written") }
    // test/ui/native-write.test.mjs — B2.7 resultInvite: shown / no / yes (denied, failed) / time = the web useReminderInvite commits
    func testNativeWrite51() throws { try run("B2.7 resultInvite: shown / no / yes (denied, failed) / time = the web useReminderInvite commits") }
    // test/ui/native-write.test.mjs — B2.9a redo: redoOpen / redoNext walk the same chars and prompts as the web redo page; the last one is done (= web next() → one nav.back)
    func testNativeWrite52() throws { try run("B2.9a redo: redoOpen / redoNext walk the same chars and prompts as the web redo page; the last one is done (= web next() → one nav.back)") }
    // test/ui/native-write.test.mjs — B2.9a redo: practice only — open / next / exit never commit and leave the store exactly as it was (no record, schedule, session, ink)
    func testNativeWrite53() throws { try run("B2.9a redo: practice only — open / next / exit never commit and leave the store exactly as it was (no record, schedule, session, ink)") }
    // test/ui/native-write.test.mjs — B2.9a redo: nothing practicable → invalid (the web page backs out too); a bad index is refused; no redoBack wired → refused
    func testNativeWrite54() throws { try run("B2.9a redo: nothing practicable → invalid (the web page backs out too); a bad index is refused; no redoBack wired → refused") }
    // test/ui/native-write.test.mjs — B2.9b refLabel: the page-side labeler (web refCardLabel) answers through the API; read-only; default reads the char only
    func testNativeWrite55() throws { try run("B2.9b refLabel: the page-side labeler (web refCardLabel) answers through the API; read-only; default reads the char only") }
}
