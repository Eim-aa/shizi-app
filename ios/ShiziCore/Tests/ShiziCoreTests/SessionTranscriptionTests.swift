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
    // test/ui/native-write.test.mjs — R9-B: exit to the char detail (改判弹层「看这个字 ›」, D66 ⑮) pushes the detail over the write entry — same openCharDetail as the web ViewCharLink
    func testNativeWrite09() throws { try run("R9-B: exit to the char detail (改判弹层「看这个字 ›」, D66 ⑮) pushes the detail over the write entry — same openCharDetail as the web ViewCharLink") }
    // test/ui/native-write.test.mjs — R9-B: open carries the type tokens the page injects (原生按网页字阶排字，不抄表)
    func testNativeWrite10() throws { try run("R9-B: open carries the type tokens the page injects (原生按网页字阶排字，不抄表)") }
    // test/ui/native-write.test.mjs — B3.1: open / resultLook carry the page theme (原生颜色取 ShiziKit 生成值、按页面主题选浅 / 深)；没注入 / 读不到时不给
    func testNativeWrite11() throws { try run("B3.1: open / resultLook carry the page theme (原生颜色取 ShiziKit 生成值、按页面主题选浅 / 深)；没注入 / 读不到时不给") }
    // test/ui/native-write.test.mjs — judge with no strokes is refused before any commit (D03)
    func testNativeWrite13() throws { try run("judge with no strokes is refused before any commit (D03)") }
    // test/ui/native-write.test.mjs — open: timing for the native surface comes from the same source as the web page (P227 pen arm, M1 judge keys)
    func testNativeWrite15() throws { try run("open: timing for the native surface comes from the same source as the web page (P227 pen arm, M1 judge keys)") }
    // test/ui/native-write.test.mjs — hint op: all hint strokes absorbed → hintRange null; undo brings them back (= web hint-fade commit)
    func testNativeWrite18() throws { try run("hint op: all hint strokes absorbed → hintRange null; undo brings them back (= web hint-fade commit)") }
    // test/ui/native-write.test.mjs — hint op: no stroke data → unavailable button + note; stale card refused; a failed write still gives the hint (P52) and the next write catches up
    func testNativeWrite19() throws { try run("hint op: no stroke data → unavailable button + note; stale card refused; a failed write still gives the hint (P52) and the next write catches up") }
    // test/ui/native-write.test.mjs — correct op: native copy keys for the sheet are all in the open payload (title, two cards, note, buttons, three-part failure)
    func testNativeWrite25() throws { try run("correct op: native copy keys for the sheet are all in the open payload (title, two cards, note, buttons, three-part failure)") }
    // test/ui/native-write.test.mjs — open: trace / skip-undo parameters come from the same policy as the web (stepPlay ≤ 1.6s, hook width, 5s undo)
    func testNativeWrite31() throws { try run("open: trace / skip-undo parameters come from the same policy as the web (stepPlay ≤ 1.6s, hook width, 5s undo)") }
    // test/ui/native-write.test.mjs — open: ink parameters are the web buildStroke table (policy.ink + INK_SPEC), D72 ②
    func testNativeWrite32() throws { try run("open: ink parameters are the web buildStroke table (policy.ink + INK_SPEC), D72 ②") }
    // test/ui/native-write.test.mjs — end: D07 — failure keeps the group (retry ends it once); stale after it ended; the first practice cannot be ended; snapshot says canEnd
    func testNativeWrite39() throws { try run("end: D07 — failure keeps the group (retry ends it once); stale after it ended; the first practice cannot be ended; snapshot says canEnd") }
    // test/ui/native-write.test.mjs — firstTip: snapshot says due exactly when the web useFirstTip would show it; the op = commitFirstTipSeen (once)
    func testNativeWrite40() throws { try run("firstTip: snapshot says due exactly when the web useFirstTip would show it; the op = commitFirstTipSeen (once)") }
    // test/ui/native-write.test.mjs — B2.7 ops: the result set is named; resultLook carries copy (incl. the result keys), timing and the result motion from config/motion
    func testNativeWrite42() throws { try run("B2.7 ops: the result set is named; resultLook carries copy (incl. the result keys), timing and the result motion from config/motion") }
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
