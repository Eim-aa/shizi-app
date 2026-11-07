import XCTest
@testable import ShiziCore
@testable import ShiziCoreEngine

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
    // ops: the named set; unknown op is rejected without throwing
    func testNativeWrite01() throws {
        let names = ["open","strokes","phase","judge","exit","copy","hint","correct","showAnswer","answerPhase","answerNext","skip","undoSkip","end","firstTip","redoOpen","redoNext","redoExit","refLabel"]
        XCTAssertEqual(SessionResources.ui["writeOps"],.array(names.map(JSValue.string)))
        for name in names { XCTAssertNotNil(CoreEngine.ops["write."+name]) }
        try run("ops: the named set; unknown op is rejected without throwing") }
    // switch: off unless the iOS shell injected __shiziNativeWrite
    func testNativeWrite02() throws { try run("switch: off unless the iOS shell injected __shiziNativeWrite") }
    // wire format: strokes round-trip, pressure kept only when present, junk points dropped
    func testNativeWrite03() throws { try run("wire format: strokes round-trip, pressure kept only when present, junk points dropped") }
    // copy: native strings come from src/config/copy (same values as t())
    func testNativeWrite04() throws { try run("copy: native strings come from src/config/copy (same values as t())") }
    // snapshot: current card, progress, prompt cells; the answer char is not in any spoken label (D16)
    func testNativeWrite05() throws { try run("snapshot: current card, progress, prompt cells; the answer char is not in any spoken label (D16)") }
    // strokes op = commitStrokes (same session.current), and snapshot restores them
    func testNativeWrite06() throws { try run("strokes op = commitStrokes (same session.current), and snapshot restores them") }
    // R9-B: exit to the char detail (改判弹层「看这个字 ›」, D66 ⑮) pushes the detail over the write entry — same openCharDetail as the web ViewCharLink
    func testNativeWrite09() throws { try run("R9-B: exit to the char detail (改判弹层「看这个字 ›」, D66 ⑮) pushes the detail over the write entry — same openCharDetail as the web ViewCharLink") }
    // R9-B: open carries the type tokens the page injects (原生按网页字阶排字，不抄表)
    func testNativeWrite10() throws { try run("R9-B: open carries the type tokens the page injects (原生按网页字阶排字，不抄表)") }
    // B3.1: open / resultLook carry the page theme (原生颜色取 ShiziKit 生成值、按页面主题选浅 / 深)；没注入 / 读不到时不给
    func testNativeWrite11() throws { try run("B3.1: open / resultLook carry the page theme (原生颜色取 ShiziKit 生成值、按页面主题选浅 / 深)；没注入 / 读不到时不给") }
    // judge with no strokes is refused before any commit (D03)
    func testNativeWrite13() throws { try run("judge with no strokes is refused before any commit (D03)") }
    // open: timing for the native surface comes from the same source as the web page (P227 pen arm, M1 judge keys)
    func testNativeWrite15() throws { try run("open: timing for the native surface comes from the same source as the web page (P227 pen arm, M1 judge keys)") }
    // hint op: all hint strokes absorbed → hintRange null; undo brings them back (= web hint-fade commit)
    func testNativeWrite18() throws { try run("hint op: all hint strokes absorbed → hintRange null; undo brings them back (= web hint-fade commit)") }
    // hint op: no stroke data → unavailable button + note; stale card refused; a failed write still gives the hint (P52) and the next write catches up
    func testNativeWrite19() throws { try run("hint op: no stroke data → unavailable button + note; stale card refused; a failed write still gives the hint (P52) and the next write catches up") }
    // correct op: native copy keys for the sheet are all in the open payload (title, two cards, note, buttons, three-part failure)
    func testNativeWrite25() throws { try run("correct op: native copy keys for the sheet are all in the open payload (title, two cards, note, buttons, three-part failure)") }
    // open: trace / skip-undo parameters come from the same policy as the web (stepPlay ≤ 1.6s, hook width, 5s undo)
    func testNativeWrite31() throws { try run("open: trace / skip-undo parameters come from the same policy as the web (stepPlay ≤ 1.6s, hook width, 5s undo)") }
    // open: ink parameters are the web buildStroke table (policy.ink + INK_SPEC), D72 ②
    func testNativeWrite32() throws { try run("open: ink parameters are the web buildStroke table (policy.ink + INK_SPEC), D72 ②") }
    // end: D07 — failure keeps the group (retry ends it once); stale after it ended; the first practice cannot be ended; snapshot says canEnd
    func testNativeWrite39() throws { try run("end: D07 — failure keeps the group (retry ends it once); stale after it ended; the first practice cannot be ended; snapshot says canEnd") }
    // firstTip: snapshot says due exactly when the web useFirstTip would show it; the op = commitFirstTipSeen (once)
    func testNativeWrite40() throws { try run("firstTip: snapshot says due exactly when the web useFirstTip would show it; the op = commitFirstTipSeen (once)") }
    // B2.7 ops: the result set is named; resultLook carries copy (incl. the result keys), timing and the result motion from config/motion
    func testNativeWrite42() throws { try run("B2.7 ops: the result set is named; resultLook carries copy (incl. the result keys), timing and the result motion from config/motion") }
    // B2.7 resultInvite: shown / no / yes (denied, failed) / time = the web useReminderInvite commits
    func testNativeWrite51() throws { try run("B2.7 resultInvite: shown / no / yes (denied, failed) / time = the web useReminderInvite commits") }
    // B2.9a redo: redoOpen / redoNext walk the same chars and prompts as the web redo page; the last one is done (= web next() → one nav.back)
    func testNativeWrite52() throws { try run("B2.9a redo: redoOpen / redoNext walk the same chars and prompts as the web redo page; the last one is done (= web next() → one nav.back)") }
    // B2.9a redo: practice only — open / next / exit never commit and leave the store exactly as it was (no record, schedule, session, ink)
    func testNativeWrite53() throws { try run("B2.9a redo: practice only — open / next / exit never commit and leave the store exactly as it was (no record, schedule, session, ink)") }
    // B2.9a redo: nothing practicable → invalid (the web page backs out too); a bad index is refused; no redoBack wired → refused
    func testNativeWrite54() throws { try run("B2.9a redo: nothing practicable → invalid (the web page backs out too); a bad index is refused; no redoBack wired → refused") }
    // B2.9b refLabel: the page-side labeler (web refCardLabel) answers through the API; read-only; default reads the char only
    func testNativeWrite55() throws { try run("B2.9b refLabel: the page-side labeler (web refCardLabel) answers through the API; read-only; default reads the char only") }
}
