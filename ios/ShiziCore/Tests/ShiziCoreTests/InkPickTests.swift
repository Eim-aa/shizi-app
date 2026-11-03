import Foundation
import XCTest
@testable import ShiziCore

// test/core/ink-pick.test.mjs 的转写（6 个用例，用例名保留原名）。另有 members.json 金标准与随机差分核对。

final class InkPickTests: XCTestCase {
    let inkEntry = obj43([("s", arrayOf43(["AAAAAAAA"]))])
    /// 「静」：8月首次、9-1、9-8、9-22（D27 回收了中间两次的墨迹）。
    var JING: [JSValue] {
        [rec43(1, jing43, "judged", "correct", "2026-08-05"), rec43(2, jing43, "judged", "correct", "2026-09-01"),
         rec43(3, jing43, "judged", "correct", "2026-09-08"), rec43(4, jing43, "judged", "wrong", "2026-09-22")]
    }
    var state: JSValue { obj43([("ink", obj43([("2026-08", obj43([("r1", inkEntry)])), ("2026-09", obj43([("r4", inkEntry)]))]))]) }
    func inMonth(_ month: String) -> [JSValue] { JING.filter { ($0["localDay"]?.stringValue ?? "").hasPrefix(month + "-") } }
    func hasInkOf(_ st: JSValue) -> InkPick.HasInk { { InkPick.storedInkPresent(st, $0, timeZone: sixTimeZone) } }

    // test/core/ink-pick.test.mjs: pickInkRecord: preference direction — first scans early to late, last scans late to early; skips records without ink
    func testPickInkRecordPreferenceDirectionFirstScansEarlyToLateLastScansLateToEarlySkipsRecordsWithoutInk() {
        let hasInk = inkIn43(["r2", "r3"])
        XCTAssertEqual(InkPick.pickInkRecord(JING, prefer: s43("first"), hasInk: hasInk)?["id"], s43("r2"))
        XCTAssertEqual(InkPick.pickInkRecord(JING, prefer: s43("last"), hasInk: hasInk)?["id"], s43("r3"), "last: r4 has none, so r3")
        XCTAssertEqual(InkPick.pickInkRecord(JING, hasInk: hasInk)?["id"], s43("r3"), "default prefer = last")
        XCTAssertEqual(InkPick.normalizePrefer(s43("whatever")), "last")
        // 偏好方向上的那条有墨就直接取它
        XCTAssertEqual(InkPick.pickInkRecord(JING, prefer: s43("first"), hasInk: { _ in true })?["id"], s43("r1"))
        XCTAssertEqual(InkPick.pickInkRecord(JING, prefer: s43("last"), hasInk: { _ in true })?["id"], s43("r4"))
    }

    // test/core/ink-pick.test.mjs: pickInkRecord: nothing with ink in the period gives null; empty / bad input gives null; a throwing hasInk counts as no ink
    func testPickInkRecordNothingWithInkInThePeriodGivesNullEmptyBadInputGivesNullAThrowingHasInkCountsAsNoInk() {
        XCTAssertNil(InkPick.pickInkRecord(JING, prefer: s43("first"), hasInk: { _ in false }))
        XCTAssertNil(InkPick.pickInkRecord([], hasInk: { _ in true }))
        XCTAssertNil(InkPick.pickInkRecord(JING, hasInk: nil), "no hasInk: nothing can be said to have ink")
        struct Boom: Error {}
        let bomb: InkPick.HasInk = { r in
            if r["id"] == s43("r4") { throw Boom() }
            return r["id"] == s43("r3")
        }
        XCTAssertEqual(InkPick.pickInkRecord(JING, prefer: s43("last"), hasInk: bomb)?["id"], s43("r3"))
    }

    // test/core/ink-pick.test.mjs: pickRecordInPeriod: no ink anywhere in the period gives the preferred-direction record with inked=false (shown honestly as no ink)
    func testPickRecordInPeriodNoInkAnywhereInThePeriodGivesThePreferredDirectionRecordWithInkedFalse() {
        func check(_ r: (record: JSValue?, inked: Bool), _ record: JSValue?, _ inked: Bool, line: UInt = #line) {
            XCTAssertEqual(r.record, record, line: line)
            XCTAssertEqual(r.inked, inked, line: line)
        }
        check(InkPick.pickRecordInPeriod(JING, prefer: s43("first"), hasInk: { _ in false }), JING[0], false)
        check(InkPick.pickRecordInPeriod(JING, prefer: s43("last"), hasInk: { _ in false }), JING[3], false)
        check(InkPick.pickRecordInPeriod(JING, prefer: s43("first"), hasInk: { $0["id"] == s43("r3") }), JING[2], true)
        check(InkPick.pickRecordInPeriod([], prefer: s43("first"), hasInk: { _ in true }), nil, false)
    }

    // test/core/ink-pick.test.mjs: D42 example: jing, September (first) = 9-22; August = its own August one; ink outside the period never stands in
    func testD42ExampleJingSeptemberFirstIs922AugustIsItsOwnAugustOneInkOutsideThePeriodNeverStandsIn() {
        let hasInk = hasInkOf(state)
        XCTAssertEqual(InkPick.pickRecordInPeriod(inMonth("2026-09"), prefer: s43("first"), hasInk: hasInk).record?["id"], s43("r4"), "9-01 recycled, so 9-22")
        XCTAssertEqual(InkPick.pickRecordInPeriod(inMonth("2026-08"), prefer: s43("first"), hasInk: hasInk).record?["id"], s43("r1"))
        // 9月里一份墨迹都没有（只剩 8月那份）：如实没有，不拿 8月的冒充
        let aug = obj43([("ink", obj43([("2026-08", obj43([("r1", inkEntry)]))]))])
        let r = InkPick.pickRecordInPeriod(inMonth("2026-09"), prefer: s43("first"), hasInk: hasInkOf(aug))
        XCTAssertEqual(r.record, JING[1])
        XCTAssertFalse(r.inked)
        XCTAssertNil(InkPick.pickInkRecord(inMonth("2026-09"), prefer: s43("first"), hasInk: hasInkOf(aug)))
    }

    // test/core/ink-pick.test.mjs: storedInkPresent: looks the record up in the per-month table (inkId first), never decodes; empty strokes or missing table give false
    func testStoredInkPresentLooksTheRecordUpInThePerMonthTableInkIdFirstNeverDecodesEmptyStrokesOrMissingTableGiveFalse() {
        func present(_ st: JSValue?, _ r: JSValue?) -> Bool { InkPick.storedInkPresent(st, r, timeZone: sixTimeZone) }
        XCTAssertTrue(present(state, JING[0]))
        XCTAssertFalse(present(state, JING[1]))
        XCTAssertTrue(present(state, setting(setting(JING[1], "inkId", s43("r4")), "localDay", s43("2026-09-22"))), "inkId wins over id")
        XCTAssertFalse(present(J("{\"ink\":{\"2026-09\":{\"r4\":{\"s\":[]}}}}"), JING[3]), "no strokes")
        XCTAssertFalse(present(J("{\"ink\":{\"2026-09\":{\"r4\":{\"s\":[\"\"]}}}}"), JING[3]), "only empty strokes")
        XCTAssertFalse(present(J("{\"ink\":{\"2026-09\":{\"r4\":null}}}"), JING[3]))
        XCTAssertFalse(present(J("{}"), JING[3]))
        XCTAssertFalse(present(.null, JING[3]))
        XCTAssertFalse(present(state, .null))
        XCTAssertTrue(InkPick.inkHasStrokes(J("{\"s\":[[1,2,3]]}")))
    }

    // test/core/ink-pick.test.mjs: performance: 3000 chars x 4 records pick with one table lookup per candidate and no decoding
    func testPerformance3000CharsX4RecordsPickWithOneTableLookupPerCandidateAndNoDecoding() {
        var records: [JSValue] = []
        var inkMonth = JSObject()
        for i in 0..<3000 {
            for k in 0..<4 { records.append(rec43(i * 4 + k + 1, "\u{5B57}\(i)", "judged", "correct", "2026-09-0\(k + 1)")) }
            inkMonth["r\(i * 4 + 4)"] = inkEntry // 每字只有最近一次留有墨迹
        }
        let st = obj43([("ink", obj43([("2026-09", .object(inkMonth))]))])
        var byChar = OMap<[JSValue]>()
        for r in records { let c = r["char"]!.stringValue!; byChar[c] = (byChar[c] ?? []) + [r] }
        let t0 = Date()
        var hit = 0
        for list in byChar.values where InkPick.pickRecordInPeriod(list, prefer: s43("first"), hasInk: hasInkOf(st)).inked { hit += 1 }
        XCTAssertEqual(hit, 3000)
        XCTAssertLessThan(Date().timeIntervalSince(t0), 1, "cheap")
    }
}
