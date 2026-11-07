import Foundation
import XCTest
@testable import ShiziCore

// test/core/records.test.mjs 的转写（18 个用例，用例名保留原名）。另有 records.json 金标准逐条核对。

final class RecordsTests: XCTestCase {
    let today = "2026-09-24"

    func sched(_ due: String, _ stability: Double = 5) -> JSValue {
        obj43([("fsrs", obj43([("stability", n43(stability))])), ("due", s43(due)), ("lastJudgedAt", n43(0))])
    }

    func make(_ pairs: [(String, JSValue)]) throws -> JSValue {
        try Records.makeRecord(JSObject(pairs), dates: shanghai43)
    }

    // records: makeRecord builds a §3.2 record with localDay from at
    func testRecordsMakeRecordBuildsA32RecordWithLocalDayFromAt() throws {
        let t = at43(today, 23, 59)
        let r = try make([("id", s43("r3")), ("cardKey", s43("base:" + jing43)), ("sessionId", s43("s1")), ("kind", s43("judged")), ("judgment", s43("correct")), ("at", n43(t)),
                          ("help", obj43([("hints", n43(1))]))])
        let want = obj43([("id", s43("r3")), ("cardKey", s43("base:" + jing43)), ("char", s43(jing43)), ("sessionId", s43("s1")), ("kind", s43("judged")), ("judgment", s43("correct")),
                        ("at", n43(t)), ("localDay", s43(today)), ("help", obj43([("hints", n43(1)), ("answerSeen", .bool(false)), ("traced", .bool(false))]))])
        XCTAssertEqual(r, want)
        // 键序：id, cardKey, char, sessionId, kind, at, localDay, help, judgment（makeRecord 的写入序，落盘逐字节依赖它）
        XCTAssertEqual(r.objectValue?.keys, ["id", "cardKey", "char", "sessionId", "kind", "at", "localDay", "help", "judgment"])
        let seen = try make([("id", s43("r4")), ("cardKey", s43("base:" + jing43)), ("sessionId", s43("s1")), ("kind", s43("answer-seen")), ("at", n43(at43(today)))])
        XCTAssertEqual(seen["help"]?["answerSeen"], .bool(true))
        XCTAssertNil(seen["judgment"])
    }

    // records: makeRecord rejects malformed records
    func testRecordsMakeRecordRejectsMalformedRecords() {
        let base: [(String, JSValue)] = [("id", s43("r1")), ("cardKey", s43("base:" + jing43)), ("sessionId", s43("s1")), ("at", n43(at43(today)))]
        func with(_ extra: [(String, JSValue)]) -> [(String, JSValue)] {
            var o = JSObject(base)
            for (k, v) in extra { o[k] = v }
            return o.entries.map { ($0.key, $0.value) }
        }
        XCTAssertThrowsCore("range", containing: "judgment") { _ = try make(with([("kind", s43("judged"))])) }
        XCTAssertThrowsCore("range", containing: "only judged") { _ = try make(with([("kind", s43("skipped")), ("judgment", s43("wrong"))])) }
        XCTAssertThrowsCore("range", containing: "judgment") { _ = try make(with([("kind", s43("judged")), ("judgment", s43("maybe"))])) }
        XCTAssertThrowsCore("range", containing: "cardKey") { _ = try make(with([("cardKey", s43("base:" + jingYi43)), ("kind", s43("skipped"))])) }
        XCTAssertThrowsCore("range", containing: "id") { _ = try make(with([("id", s43("x1")), ("kind", s43("skipped"))])) }
        XCTAssertThrowsCore("range", containing: "sessionId") { _ = try make(with([("sessionId", s43("nope")), ("kind", s43("skipped"))])) }
        XCTAssertThrowsCore("range", containing: "kind") { _ = try make(with([("kind", s43("uncertain"))])) }
    }

    // records: validateRecord reports char/cardKey mismatch and bad help
    func testRecordsValidateRecordReportsCharCardKeyMismatchAndBadHelp() {
        let r = rec43(1, jing43, "judged", "correct", today)
        func v(_ x: JSValue) -> [String] { Records.validateRecord(x, dates: shanghai43) }
        XCTAssertEqual(v(r), [])
        XCTAssertTrue(v(setting(r, "char", s43(yi43))).contains { $0.contains("char") })
        XCTAssertTrue(v(setting(r, "help", obj43([("hints", n43(65)), ("answerSeen", .bool(false)), ("traced", .bool(false))]))).contains { $0.contains("hints") })
        XCTAssertTrue(v(setting(r, "localDay", s43("2026-9-24"))).contains { $0.contains("localDay") })
        var skipped = setting(r, "kind", s43("skipped"))
        skipped = removing(skipped, "judgment")
        skipped = setting(skipped, "corrections", .array([]))
        XCTAssertTrue(v(skipped).contains { $0.contains("corrected") })
        XCTAssertEqual(Records.validateRecord(.null, dates: shanghai43), ["record must be an object"])
    }

    // records: ids, serials and card keys
    func testRecordsIdsSerialsAndCardKeys() {
        XCTAssertEqual(Records.recordSerial(s43("r12")), 12)
        XCTAssertTrue(Records.recordSerial(s43("r0")).isNaN)
        XCTAssertTrue(Records.recordSerial(s43("s3")).isNaN)
        XCTAssertEqual(Records.sessionSerial(s43("s7")), 7)
        XCTAssertLessThan(Records.compareRecordIds(s43("r9"), s43("r10")), 0, "numeric, not lexicographic")
        XCTAssertEqual(Records.charOfCardKey(s43("base:" + jing43)), jing43)
        XCTAssertEqual(Records.charOfCardKey(s43("custom:\u{2000B}")), "\u{2000B}")
        XCTAssertNil(Records.charOfCardKey(s43("base:" + jingYi43)))
        XCTAssertNil(Records.charOfCardKey(s43("legacy:3")))
    }

    // records: nextSerial = max(records, sessions, meta.serial) + 1, holes allowed
    func testRecordsNextSerialMaxRecordsSessionsMetaSerialPlus1HolesAllowed() {
        let records = [rec43(3, jing43, "judged", "correct", today), rec43(9, yi43, "skipped", nil, today)]
        XCTAssertEqual(Records.nextSerial(records: records), 10)
        XCTAssertEqual(Records.nextSerial(records: records, metaSerial: 40), 41)
        let sessions = J("{\"A\":{\"id\":\"s12\",\"items\":[{\"recordId\":\"r15\"}]},\"B\":null,\"lastEnded\":{\"B\":{\"id\":\"s20\",\"items\":[]}}}")
        XCTAssertEqual(Records.nextSerial(records: records, sessions: sessions), 21)
        XCTAssertEqual(Records.nextSerial(records: records, sessions: J("{\"A\":{\"id\":\"s2\",\"items\":[{\"recordId\":\"r30\"}]},\"B\":null,\"lastEnded\":{}}")), 31)
        XCTAssertEqual(Records.nextSerial(), 1)
    }

    // records: latest judged is decided by id serial, not by clock (setClock-safe)
    func testRecordsLatestJudgedIsDecidedByIdSerialNotByClockSetClockSafe() {
        let records = [
            rec43(5, jing43, "judged", "wrong", today, at: at43(today, 20)),
            rec43(6, jing43, "judged", "correct", "2026-09-23", at: at43("2026-09-23", 8)), // 时钟被调回
        ]
        XCTAssertEqual(Records.latestJudged(records, "base:" + jing43)?["id"], s43("r6"))
        XCTAssertFalse(Records.isInWrongList(records, "base:" + jing43))
    }

    // records: answer-seen and skipped are not valid records (D23)
    func testRecordsAnswerSeenAndSkippedAreNotValidRecordsD23() {
        let records = [rec43(1, jing43, "judged", "wrong", "2026-09-20"), rec43(2, jing43, "answer-seen", nil, today), rec43(3, jing43, "skipped", nil, today)]
        XCTAssertEqual(Records.latestJudgedByCard(records)["base:" + jing43]?["id"], s43("r1"))
        XCTAssertEqual(chars43(Records.wrongList(records)), [jing43])
        XCTAssertFalse(Records.hasAnyJudged([rec43(1, jing43, "answer-seen", nil, today)]))
        XCTAssertEqual(Records.writtenCardKeys(records), ["base:" + jing43])
    }

    // records: wrong list = latest judged wrong, newest first; writing it right removes it
    func testRecordsWrongListLatestJudgedWrongNewestFirstWritingItRightRemovesIt() {
        let records = [
            rec43(1, jing43, "judged", "wrong", "2026-09-20"), rec43(2, yi43, "judged", "wrong", "2026-09-21"), rec43(3, man43, "judged", "correct", "2026-09-21"),
            rec43(4, jing43, "judged", "correct", "2026-09-22"), rec43(5, e143, "judged", "wrong", "2026-09-23"),
        ]
        XCTAssertEqual(chars43(Records.wrongList(records)), [e143, yi43])
    }

    // records: correcting to correct leaves the wrong list without adding a record (I02/D19)
    func testRecordsCorrectingToCorrectLeavesTheWrongListWithoutAddingARecordI02D19() throws {
        let r1 = rec43(1, jing43, "judged", "wrong", today)
        let before = [r1]
        XCTAssertTrue(Records.isInWrongList(before, "base:" + jing43))
        let fixed = try Records.correctRecord(r1, s43("correct"), at: n43(at43(today, 21)))
        let after = try Records.replaceRecord(before, fixed)
        XCTAssertEqual(after.count, 1)
        XCTAssertFalse(Records.isInWrongList(after, "base:" + jing43))
        XCTAssertEqual(Records.wrongList(after).count, 0)
        XCTAssertEqual(Records.judgedCountOfCard(after, "base:" + jing43), 1)
        XCTAssertEqual(Records.wrongCountOfCard(after, "base:" + jing43), 0)
    }

    // records: correctRecord changes only judgment and appends corrections
    func testRecordsCorrectRecordChangesOnlyJudgmentAndAppendsCorrections() throws {
        let r1 = rec43(7, jing43, "judged", "correct", today, hints: 2)
        let c1 = try Records.correctRecord(r1, s43("wrong"), at: n43(111))
        XCTAssertEqual(c1["judgment"], s43("wrong"))
        XCTAssertEqual(c1["corrections"], J("[{\"from\":\"correct\",\"at\":111}]"))
        for k in ["id", "at", "localDay", "cardKey", "sessionId"] { XCTAssertEqual(c1[k], r1[k], k) }
        XCTAssertEqual(c1["help"], r1["help"], "help facts never removed")
        let c2 = try Records.correctRecord(c1, s43("correct"), at: n43(222))
        XCTAssertEqual(c2["corrections"], J("[{\"from\":\"correct\",\"at\":111},{\"from\":\"wrong\",\"at\":222}]"))
        XCTAssertSameJSON(try Records.correctRecord(c2, s43("correct"), at: n43(333)), c2, "same judgment is a no-op")
        XCTAssertEqual(Records.validateRecord(c2, dates: shanghai43), [])
        XCTAssertThrowsCore("range", containing: "judged") { _ = try Records.correctRecord(rec43(8, jing43, "answer-seen", nil, today), s43("correct"), at: n43(1)) }
        XCTAssertThrowsCore("range", containing: "legacy") { _ = try Records.correctRecord(setting(r1, "legacy", .bool(true)), s43("wrong"), at: n43(1)) }
    }

    // records: forget list = latest judged correct and FSRS due (P04)
    func testRecordsForgetListLatestJudgedCorrectAndFSRSDueP04() throws {
        let records = [rec43(1, jing43, "judged", "correct", "2026-06-01"), rec43(2, yi43, "judged", "correct", "2026-09-20"), rec43(3, man43, "judged", "wrong", "2026-06-01")]
        let s0 = obj43([("base:" + jing43, sched("2026-09-10")), ("base:" + yi43, sched("2026-10-01")), ("base:" + man43, sched("2026-09-01"))])
        let r = try Records.forgetList(records: records, sched: s0, today: s43(today), dates: shanghai43)
        XCTAssertEqual(r.items.map { $0.record["char"]?.stringValue }, [jing43])
        XCTAssertEqual(r.items[0].overdue, 14)
        XCTAssertEqual(r.total, 1)
    }

    // records: wrong list and forget list never overlap (K16)
    func testRecordsWrongListAndForgetListNeverOverlapK16() throws {
        // 伪随机序列：多字、多次判断、到期状态混合，断言两单交集为空且并集只含有 judged 的字。
        var seed = 7.0
        func rand() -> Double { seed = (seed * 1103515245 + 12345).truncatingRemainder(dividingBy: 2147483648); return seed / 2147483648 }
        func addDay(_ n: Int) -> String {
            let d = JSDate.civilFromDays(JSDate.daysFromCivil(2026, 9, 24) + n)
            return String(format: "%04d-%02d-%02d", d.year, d.month, d.day)
        }
        let chs = ["\u{9759}", "\u{4EA6}", "\u{6162}", "\u{989D}", "\u{9C9C}", "\u{5883}", "\u{8B66}", "\u{90E8}", "\u{4E3B}", "\u{6027}", "\u{4F53}", "\u{6B21}"]
        for round in 0..<50 {
            var records: [JSValue] = []
            var sch = JSObject()
            var serial = 1
            for ch in chs {
                let k = Int((rand() * 4).rounded(.down))
                for _ in 0..<k {
                    let kind = rand() < 0.75 ? "judged" : (rand() < 0.5 ? "skipped" : "answer-seen")
                    records.append(rec43(serial, ch, kind, rand() < 0.5 ? "correct" : "wrong", addDay(-Int((rand() * 90).rounded(.down)))))
                    serial += 1
                }
                if records.contains(where: { $0["char"] == s43(ch) && $0["kind"] == s43("judged") }) { sch["base:" + ch] = sched(addDay(Int((rand() * 20).rounded(.down)) - 10)) }
            }
            let wrong = Set(Records.wrongList(records).compactMap { $0["cardKey"]?.stringValue })
            let forget = try Records.forgetList(records: records, sched: .object(sch), today: s43(today), dates: shanghai43).items.map { $0.cardKey }
            for k in forget { XCTAssertFalse(wrong.contains(k), "round \(round): \(k) in both lists") }
        }
    }

    // records: forget list orders by overdue desc then stability, caps at forgetCap
    func testRecordsForgetListOrdersByOverdueDescThenStabilityCapsAtForgetCap() throws {
        var records: [JSValue] = []
        var sch = JSObject()
        let chs = ["\u{4E00}", "\u{4E8C}", "\u{4E09}", "\u{56DB}", "\u{4E94}", "\u{516D}", "\u{4E03}", "\u{516B}", "\u{4E5D}", "\u{5341}", "\u{767E}", "\u{5343}", "\u{4E07}", "\u{4EBF}"]
        for (i, ch) in chs.enumerated() {
            records.append(rec43(i + 1, ch, "judged", "correct", "2026-06-01"))
            sch["base:" + ch] = sched(i < 2 ? "2026-09-01" : "2026-09-20", i == 1 ? 1 : 9)
        }
        let r = try Records.forgetList(records: records, sched: .object(sch), today: s43(today), dates: shanghai43)
        XCTAssertEqual(r.total, 14)
        XCTAssertEqual(r.items.count, 12)
        XCTAssertEqual(r.items.prefix(2).map { $0.record["char"]?.stringValue }, ["\u{4E8C}", "\u{4E00}"], "same overdue -> lower stability first")
        func policyWith(_ k: String, _ v: JSValue) -> JSObject { Reminder.policyObject(JSObject([(k, v)])) }
        let small = try Records.forgetList(records: records, sched: .object(sch), today: s43(today), dates: shanghai43, policy: policyWith("forgetCap", n43(3)))
        XCTAssertEqual(small.items.count, 3)
        XCTAssertThrowsCore("range", containing: "forgetRule") {
            _ = try Records.forgetList(records: records, sched: .object(sch), today: s43(today), dates: shanghai43, policy: policyWith("forgetRule", s43("retrievability")))
        }
    }

    // records: stopped cards never enter the forget list
    func testRecordsStoppedCardsNeverEnterTheForgetList() throws {
        let records = [rec43(1, jing43, "judged", "correct", "2026-06-01")]
        let s0 = obj43([("base:" + jing43, setting(sched("2026-09-01"), "stoppedAt", n43(1)))])
        XCTAssertEqual(try Records.forgetList(records: records, sched: s0, today: s43(today), dates: shanghai43).total, 0)
    }

    // records: today N counts distinct chars judged today only
    func testRecordsTodayNCountsDistinctCharsJudgedTodayOnly() {
        let records = [
            rec43(1, jing43, "judged", "wrong", today), rec43(2, jing43, "judged", "correct", today), rec43(3, yi43, "answer-seen", nil, today),
            rec43(4, man43, "skipped", nil, today), rec43(5, e143, "judged", "correct", "2026-09-23"), rec43(6, xian43, "judged", "correct", today),
        ]
        XCTAssertEqual(Records.todayCount(records, today), 2)
        XCTAssertEqual(Records.todayCount(records, "2026-09-23"), 1)
        XCTAssertEqual(Records.todayCount([], today), 0)
    }

    // records: counts, first record and monthly index
    func testRecordsCountsFirstRecordAndMonthlyIndex() throws {
        let r1 = rec43(1, jing43, "judged", "wrong", "2026-08-30")
        let records = [rec43(4, jing43, "judged", "correct", "2026-09-02"), r1, rec43(3, jing43, "answer-seen", nil, "2026-09-01"), rec43(5, yi43, "judged", "wrong", "2026-09-02")]
        XCTAssertEqual(Records.judgedCountOfCard(records, "base:" + jing43), 2)
        XCTAssertEqual(Records.wrongCountOfCard(records, "base:" + jing43), 1)
        XCTAssertSameJSON(Records.firstJudgedOfCard(records, "base:" + jing43)!, r1)
        let byMonth = try Records.recordsByMonth(records, dates: shanghai43)
        XCTAssertEqual(byMonth.keys.sorted(), ["2026-08", "2026-09"])
        XCTAssertEqual(ids43(byMonth["2026-09"]?.arrayValue ?? []), ["r3", "r4", "r5"])
        XCTAssertEqual(Records.judgedDaysInMonth(records, "2026-09"), ["2026-09-02"])
    }

    // records: replaceRecord / removeRecord keep order and reject unknown ids
    func testRecordsReplaceRecordRemoveRecordKeepOrderAndRejectUnknownIds() throws {
        let records = [rec43(1, jing43, "judged", "wrong", today), rec43(2, yi43, "skipped", nil, today)]
        XCTAssertEqual(ids43(try Records.removeRecord(records, s43("r2"))), ["r1"])
        XCTAssertThrowsCore("range", containing: "not found") { _ = try Records.removeRecord(records, s43("r9")) }
        XCTAssertThrowsCore("range", containing: "not found") { _ = try Records.replaceRecord(records, obj43([("id", s43("r9"))])) }
    }

    // records: reviewsDoneOn counts only cards first judged before that day
    func testRecordsReviewsDoneOnCountsOnlyCardsFirstJudgedBeforeThatDay() {
        let records = [
            rec43(1, jing43, "judged", "correct", "2026-09-20"), rec43(2, jing43, "judged", "correct", today),
            rec43(3, yi43, "judged", "correct", today), // 今天第一次写：新字
            rec43(4, man43, "answer-seen", nil, "2026-09-20"), rec43(5, man43, "judged", "wrong", today), // 以前只看过答案：仍算新字
        ]
        XCTAssertEqual(Records.reviewsDoneOn(records, today), 1)
    }
}
