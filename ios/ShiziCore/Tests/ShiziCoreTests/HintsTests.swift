import Foundation
import XCTest
@testable import ShiziCore

// test/core/hints.test.mjs 的转写（B4.2，10 条）。输入是 JS 形状的对象，缺省值只在键缺失时生效（与 JS 解构默认值同）。

/// 构造提示输入：{ ...base, used }。
private func inp(_ json: String, used: Double? = nil, file: StaticString = #filePath, line: UInt = #line) -> JSValue {
    var v = J(json, file: file, line: line)
    if let u = used { v = JS.with(v, [("used", .number(u))]) }
    return v
}

private func range(_ v: JSValue) -> [Double]? {
    guard case .object = v else { return nil }
    return [v["from"]?.numberValue ?? .nan, v["count"]?.numberValue ?? .nan, v["index"]?.numberValue ?? .nan]
}

private func label(_ c: JSValue) throws -> String {
    try Copy.text(try XCTUnwrap(c["key"]?.stringValue), c["vars"]?.objectValue)
}

private func assertThrowsMessage<T>(_ expr: @autoclosure () throws -> T, _ part: String, code: String? = nil, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertThrowsError(try expr(), file: file, line: line) { err in
        let e = err as? CoreError
        XCTAssertTrue((e?.message ?? "\(err)").contains(part), "\(err) should mention \(part)", file: file, line: line)
        if let c = code { XCTAssertEqual(e?.code, c, file: file, line: line) }
    }
}

final class HintsTests: XCTestCase {
    // test/core/hints.test.mjs: hints: each segment is max(1, round(N/4)) strokes
    func testHintsEachSegmentIsMax1RoundN4Strokes() throws {
        let cases: [(Double, Double)] = [(1, 1), (2, 1), (3, 1), (4, 1), (5, 1), (6, 2), (8, 2), (10, 3), (12, 3), (14, 4), (16, 4), (20, 5)]
        for (n, q) in cases { XCTAssertEqual(try Hints.quota(.number(n)), q, "N=\(Int(n))") }
        assertThrowsMessage(try Hints.quota(.number(0)), "totalStrokes", code: "range")
        assertThrowsMessage(try Hints.quota(.number(2.5)), "totalStrokes", code: "range")
    }

    // test/core/hints.test.mjs: hints (D64): 14-stroke char — every tap continues after the strokes already given, up to the whole char
    func testHintsD6414StrokeCharEveryTapContinuesAfterTheStrokesAlreadyGivenUpToTheWholeChar() throws {
        let base = #"{"totalStrokes":14,"hasStrokeData":true,"hasGroups":true}"#
        var got: [[Double]] = []
        var used = 0.0
        while true {
            guard let r = range(try Hints.nextRange(inp(base, used: used))) else { break }
            got.append([r[0], r[0] + r[1], r[2]])
            used += 1
        }
        XCTAssertEqual(got, [[0, 4, 1], [4, 8, 2], [8, 12, 3], [12, 14, 4]], "four segments, the last one is short, no repeated strokes")
        XCTAssertEqual(try Hints.nextRange(inp(base, used: 4)), .null)
        XCTAssertEqual(try Hints.nextRange(inp(base, used: 9)), .null)
    }

    // test/core/hints.test.mjs: hints (D64): the next segment does not depend on how many strokes the user wrote (the old second-tap bug)
    func testHintsD64TheNextSegmentDoesNotDependOnHowManyStrokesTheUserWroteTheOldSecondTapBug() throws {
        let want = J(#"{"from":3,"count":3,"index":2}"#)
        XCTAssertEqual(try Hints.nextRange(J(#"{"totalStrokes":12,"hasGroups":true,"used":1,"writtenStrokes":0}"#)), want)
        XCTAssertEqual(try Hints.nextRange(J(#"{"totalStrokes":12,"hasGroups":true,"used":1,"writtenStrokes":9}"#)), want)
    }

    // test/core/hints.test.mjs: hints (D64): 3-stroke char gives one stroke per tap, three taps
    func testHintsD643StrokeCharGivesOneStrokePerTapThreeTaps() throws {
        let base = #"{"totalStrokes":3,"hasGroups":true}"#
        let froms = try [0.0, 1, 2].map { try XCTUnwrap(range(try Hints.nextRange(inp(base, used: $0)))?[0]) }
        XCTAssertEqual(froms, [0, 1, 2])
        XCTAssertEqual(try Hints.nextRange(inp(base, used: 3)), .null)
    }

    // test/core/hints.test.mjs: hints (D64): chars without group data get one more stroke per tap
    func testHintsD64CharsWithoutGroupDataGetOneMoreStrokePerTap() throws {
        let base = #"{"totalStrokes":9,"hasGroups":false}"#
        XCTAssertEqual(Hints.mode(J(base)), "prefix")
        let got = try [0.0, 1, 2, 8].map { try Hints.nextRange(inp(base, used: $0)) }
        XCTAssertEqual(got, [J(#"{"from":0,"count":1,"index":1}"#), J(#"{"from":1,"count":1,"index":2}"#), J(#"{"from":2,"count":1,"index":3}"#), J(#"{"from":8,"count":1,"index":9}"#)])
        XCTAssertEqual(try Hints.nextRange(inp(base, used: 9)), .null)
        XCTAssertEqual(try Hints.segments(J(base)), 9)
        XCTAssertEqual(try Hints.segments(J(#"{"totalStrokes":14,"hasGroups":true}"#)), 4)
        XCTAssertEqual(try Hints.segments(J(#"{"totalStrokes":10,"hasGroups":true}"#)), 4, "10 strokes: 3 + 3 + 3 + 1")
    }

    // test/core/hints.test.mjs: hints (D64): given strokes, remaining segments and the whole-char state
    func testHintsD64GivenStrokesRemainingSegmentsAndTheWholeCharState() throws {
        let b = #"{"totalStrokes":14,"hasGroups":true}"#
        XCTAssertEqual(try [0.0, 1, 2, 3, 4, 7].map { try Hints.given(inp(b, used: $0)) }, [0, 4, 8, 12, 14, 14])
        XCTAssertEqual(try [0.0, 1, 2, 3, 4, 7].map { try Hints.remaining(inp(b, used: $0)) }, [4, 3, 2, 1, 0, 0])
        XCTAssertEqual(try [0.0, 3, 4].map { try Hints.allGiven(inp(b, used: $0)) }, [false, false, true])
        XCTAssertFalse(try Hints.allGiven(J(#"{"totalStrokes":0,"used":5}"#)), "stroke data not here yet: never counts as all given")
        XCTAssertFalse(try Hints.allGiven(J(#"{"totalStrokes":8,"hasStrokeData":false,"used":5}"#)))
    }

    // test/core/hints.test.mjs: hints: no stroke data → no stepped hints, button says 暂时没有提示 (R-W08)
    func testHintsNoStrokeDataNoSteppedHintsButtonSaysNoHintForNowRW08() throws {
        XCTAssertEqual(Hints.mode(J(#"{"hasStrokeData":false}"#)), "none")
        XCTAssertEqual(try Hints.nextRange(J(#"{"totalStrokes":8,"hasStrokeData":false,"used":0}"#)), .null)
        let btn = try Hints.buttonState(J(#"{"used":0,"hasStrokeData":false}"#))
        XCTAssertEqual(btn, J(#"{"state":"unavailable"}"#))
        XCTAssertEqual(try label(try Hints.buttonCopy(btn)), "\u{6682}\u{65F6}\u{6CA1}\u{6709}\u{63D0}\u{793A}")
        XCTAssertEqual(try Copy.text("R-W05.noHintNote"), "\u{8FD9}\u{4E2A}\u{5B57}\u{6682}\u{65F6}\u{6CA1}\u{6709}\u{63D0}\u{793A}\u{FF0C}\u{53EF}\u{4EE5}\u{76F4}\u{63A5}\u{770B}\u{7B54}\u{6848}\u{3002}")
    }

    // test/core/hints.test.mjs: hints (D64): screen-reader name counts the remaining segments, ends at 提示已用完
    func testHintsD64ScreenReaderNameCountsTheRemainingSegmentsEndsAtHintsUsedUp() throws {
        let b = #"{"totalStrokes":14,"hasGroups":true}"#
        let labels = try [0.0, 1, 2, 3, 4].map { try label(try Hints.buttonCopy(try Hints.buttonState(inp(b, used: $0)))) }
        XCTAssertEqual(labels, ["\u{63D0}\u{793A}\u{FF0C}\u{8FD8}\u{6709} 4 \u{6B21}", "\u{63D0}\u{793A}\u{FF0C}\u{8FD8}\u{6709} 3 \u{6B21}", "\u{63D0}\u{793A}\u{FF0C}\u{8FD8}\u{6709} 2 \u{6B21}", "\u{63D0}\u{793A}\u{FF0C}\u{8FD8}\u{6709} 1 \u{6B21}", "\u{63D0}\u{793A}\u{5DF2}\u{7528}\u{5B8C}"])
        let loading = try Hints.buttonCopy(try Hints.buttonState(J(#"{"used":0}"#)))
        XCTAssertEqual(try label(loading), "\u{63D0}\u{793A}", "stroke data not loaded yet: just \u{63D0}\u{793A}")
    }

    // test/core/hints.test.mjs: hints (D64): policy no longer carries a per-char cap or a start rule
    func testHintsD64PolicyNoLongerCarriesAPerCharCapOrAStartRule() {
        XCTAssertNil(Config.policy["hintMax"])
        XCTAssertNil(Config.policy["hintStartRule"])
        XCTAssertNil(Config.policyValue("hintMax"))
        XCTAssertNil(Config.policyValue("hintStartRule"))
    }

    // test/core/hints.test.mjs: hints: bad input fails loudly
    func testHintsBadInputFailsLoudly() {
        assertThrowsMessage(try Hints.nextRange(J(#"{"totalStrokes":0,"used":0}"#)), "totalStrokes")
        assertThrowsMessage(try Hints.buttonCopy(J(#"{"state":"weird"}"#)), "unknown")
    }
}
