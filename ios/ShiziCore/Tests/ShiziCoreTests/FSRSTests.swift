import Foundation
import XCTest
@testable import ShiziCore

// test/core/fsrs.test.mjs 的转写（B4.2，19 条，一条 JS test 对应一个 XCTest 方法）。
// 汉字一律用 \u{…} 转义：静 = U+9759，亦 = U+4EA6，春 = U+6625。
// JS 里「库从 globalThis 读 / 跨 realm 注入」的机制在 Swift 里没有对应物，对应用例改成同一含义（见各条注释）。

private let jing = "\u{9759}"
private let yi = "\u{4EA6}"
private let chun = "\u{6625}"
private let TODAY = "2026-09-24"
private let tz = TimeZone(identifier: "Asia/Shanghai")!
private let rules = ScheduleRules(timeZone: tz)

/// test/core/helpers.mjs at()：本地时间 ms。
private func at(_ day: String, _ hour: Int = 12, _ minute: Int = 0) -> Double {
    let p = day.split(separator: "-").map { Int($0)! }
    return JSDate.makeLocal(p[0], p[1] - 1, p[2], hours: hour, tz)! + Double(minute) * 60_000
}

/// test/core/helpers.mjs rec()。
private func rec(_ serial: Int, _ char: String, _ kind: String, _ judgment: String?, _ day: String, at atMs: Double? = nil, hints: Double = 0,
                 sessionId: String = "s1") -> JSValue {
    var o = JSObject([
        ("id", .string("r\(serial)")), ("cardKey", .string("base:" + char)), ("char", .string(char)), ("sessionId", .string(sessionId)), ("kind", .string(kind)),
        ("at", .number(atMs ?? at(day, 12, serial % 60))), ("localDay", .string(day)),
        ("help", .object(JSObject([("hints", .number(hints)), ("answerSeen", .bool(kind == "answer-seen")), ("traced", .bool(false))]))),
    ])
    if kind == "judged", let j = judgment { o["judgment"] = .string(j) }
    return .object(o)
}

/// 一次评分输入 {judgment, at, help?, cardKey?}。
private func review(_ judgment: String, _ atMs: Double, hints: Double? = nil, cardKey: String? = nil) -> JSValue {
    var o = JSObject([("judgment", .string(judgment)), ("at", .number(atMs))])
    if let h = hints { o["help"] = .object(JSObject([("hints", .number(h))])) }
    if let k = cardKey { o["cardKey"] = .string(k) }
    return .object(o)
}

/// src/core/records.js correctRecord（B4.3 才移植记录模块；这里只要 judged 记录的更正）。
private func correctRecord(_ record: JSValue, _ judgment: String, _ atMs: Double) -> JSValue {
    if record["judgment"] == .string(judgment) { return record }
    var corrections = record["corrections"]?.arrayValue ?? []
    corrections.append(JS.obj([("from", record["judgment"] ?? .null), ("at", .number(atMs))]))
    return JS.with(record, [("judgment", .string(judgment)), ("corrections", .array(corrections))])
}

private func policyWith(_ overrides: [(String, JSValue)]) -> JSValue { JS.with(Config.policy, overrides.map { ($0.0, Optional($0.1)) }) }

private func addDays(_ day: String, _ n: Double) -> String { try! rules.dates.addDays(day, n) }
private func diffDays(_ a: String, _ b: String) -> Double { try! rules.dates.diffDays(.string(a), .string(b)) }
private func localDay(_ ms: Double) -> String { try! rules.dates.localDay(.number(ms)) }
private func due(_ v: JSValue?) -> String { v?["due"]?.stringValue ?? "<no due>" }
private func num(_ v: JSValue?) -> Double { v?.numberValue ?? .nan }

private func assertThrowsMessage<T>(_ expr: @autoclosure () throws -> T, _ part: String, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertThrowsError(try expr(), file: file, line: line) { err in
        XCTAssertTrue(((err as? CoreError)?.message ?? "\(err)").contains(part), "\(err) should mention \(part)", file: file, line: line)
    }
}

private func applied(_ entry: JSValue?, _ record: JSValue, policy: JSValue = Config.policy) throws -> (entry: JSValue?, applied: Bool) {
    try rules.applyAnswerSeen(entry, record, policy: policy)
}

final class FSRSTests: XCTestCase {
    // test/core/fsrs.test.mjs: fsrs: vendored library is ts-fsrs 5.2.0 / FSRS-6 and is read from globalThis
    // （「从 globalThis 读 / 无库时抛 FSRS library unavailable」是 JS 加载机制；Swift 里库是编进去的 FSRS6，参数读生成的 fsrs-config.json）
    func testFsrsVendoredLibraryIsTsFsrs520Fsrs6AndIsReadFromGlobalThis() {
        let version = Config.fsrsConfig["schedulerVersion"]?.stringValue ?? ""
        XCTAssertTrue(version.contains("5.2.0"), version)
        XCTAssertTrue(version.contains("FSRS-6"), version)
        XCTAssertEqual(Config.fsrsConfig["requestRetention"], .number(0.9))
        XCTAssertEqual(Config.fsrsConfig["maximumInterval"], .number(365))
        XCTAssertEqual(ScheduleRules.fsrsLibrary.requestRetention, 0.9)
        XCTAssertEqual(ScheduleRules.fsrsLibrary.maximumInterval, 365)
    }

    // test/core/fsrs.test.mjs: fsrs: rating mapping — correct → Good, wrong → Again, hinted correct reads policy (P34)
    func testFsrsRatingMappingCorrectGoodWrongAgainHintedCorrectReadsPolicyP34() throws {
        func rating(_ j: String, _ hints: Double, policy: JSValue = Config.policy, first: Bool = false) throws -> String {
            try ScheduleRules.ratingFor(.string(j), JS.obj([("hints", .number(hints))]), policy: policy, first: first)
        }
        XCTAssertEqual(try rating("correct", 0), "Good")
        XCTAssertEqual(try rating("wrong", 2), "Again")
        // D66 ②：复习 1 次提示 Hard、2 次起 Again；新字第一次 1 次 Good、2 次 Hard、3 次起 Again
        XCTAssertEqual(try rating("correct", 1), "Hard", "review with 1 hint -> Hard")
        XCTAssertEqual(try rating("correct", 2), "Again", "review with 2 hints (over half the strokes) -> Again")
        XCTAssertEqual(try rating("correct", 3), "Again")
        XCTAssertEqual(try rating("correct", 9), "Again", "beyond the table -> last entry")
        XCTAssertEqual(try rating("correct", 1, first: true), "Good")
        XCTAssertEqual(try rating("correct", 2, first: true), "Hard")
        XCTAssertEqual(try rating("correct", 4, first: true), "Again")
        XCTAssertEqual(try rating("correct", 1, policy: policyWith([("ratingWithHint", .string("Hard"))])), "Hard")
        XCTAssertEqual(try rating("correct", 2, policy: policyWith([("ratingWithHint", .string("Again"))])), "Again")
        XCTAssertEqual(try rating("correct", 0, policy: policyWith([("ratingWithHint", .string("Again"))])), "Good", "no hint -> policy not consulted")
        assertThrowsMessage(try rating("correct", 1, policy: J(#"{"ratingWithHint":"Easy"}"#)), "ratingWithHint")
        assertThrowsMessage(try ScheduleRules.ratingFor(.string("unsure"), J("{}")), "judgment")
    }

    // test/core/fsrs.test.mjs: fsrs: Good and Again on a new card are both due tomorrow or later
    func testFsrsGoodAndAgainOnANewCardAreBothDueTomorrowOrLater() throws {
        for judgment in ["correct", "wrong"] {
            for hour in [0, 9, 23] {
                let ms = at(TODAY, hour, 30)
                let r = try rules.reviewCard(nil, review(judgment, ms, hints: 0))
                // D66 ⑦：0:30 属于前一天（一天从 4 点起），「至少次日」按判断所在的那一天算
                XCTAssertTrue(r.due >= addDays(localDay(ms), 1), "\(judgment)@\(hour) -> \(r.due)")
                XCTAssertTrue(rules.isCompactCard(r.card))
            }
        }
        XCTAssertEqual(try rules.reviewCard(nil, review("wrong", at(TODAY, 20))).due, addDays(TODAY, 1), "Again -> next day, no pendingLearning limbo")
    }

    // test/core/fsrs.test.mjs: fsrs: due stays within [tomorrow, today + 365] over long random histories
    func testFsrsDueStaysWithinTomorrowTodayPlus365OverLongRandomHistories() throws {
        // 与 JS 同一个线性同余发生器：JS 用 Number（双精度）运算，这里也用 Double，位级相同
        var seed = 11.0
        func rand() -> Double {
            seed = (seed * 1103515245 + 12345).truncatingRemainder(dividingBy: 2147483648)
            return seed / 2147483648
        }
        let maxInterval = try XCTUnwrap(Config.fsrsConfig["maximumInterval"]?.numberValue)
        for _ in 0..<20 {
            var card: JSValue? = nil
            var day = TODAY
            for _ in 0..<12 {
                let judgment = rand() < 0.7 ? "correct" : "wrong"
                let hour = 8 + Int((rand() * 12).rounded(.down))
                let hints: Double = rand() < 0.2 ? 1 : 0
                let step = try rules.reviewCard(card, review(judgment, at(day, hour), hints: hints))
                XCTAssertTrue(step.due >= addDays(day, 1), "due >= tomorrow")
                XCTAssertTrue(diffDays(day, step.due) <= maxInterval + 1, "within max interval")
                card = step.card
                day = rand() < 0.5 ? step.due : addDays(step.due, (rand() * 10).rounded(.down))
            }
        }
    }

    // test/core/fsrs.test.mjs: fsrs: replay is deterministic — same records → same card and due
    func testFsrsReplayIsDeterministicSameRecordsSameCardAndDue() throws {
        let records = [
            rec(1, jing, "judged", "correct", "2026-09-01", at: at("2026-09-01", 20)),
            rec(2, jing, "judged", "wrong", "2026-09-05", at: at("2026-09-05", 7)),
            rec(3, jing, "judged", "correct", "2026-09-06", at: at("2026-09-06", 21)),
            rec(4, jing, "judged", "correct", "2026-09-20", at: at("2026-09-20", 9)),
        ]
        let a = try rules.replay(nil, records)
        let b = try rules.replay(nil, records)
        XCTAssertNotNil(a)
        XCTAssertEqual(a, b)
        // 逐条 applyJudgment 与一次 replay 结果相同
        var entry: JSValue? = nil
        for r in records { entry = try rules.applyJudgment(entry, r).entry }
        XCTAssertEqual(entry, a)
        XCTAssertEqual(entry?["lastJudgedAt"], records[3]["at"])
    }

    // test/core/fsrs.test.mjs: fsrs: correction replays from fsrsBefore, adds no record and gives a deterministic due (D19)
    func testFsrsCorrectionReplaysFromFsrsBeforeAddsNoRecordAndGivesADeterministicDueD19() throws {
        let prior = rec(1, jing, "judged", "correct", "2026-09-10", at: at("2026-09-10", 20))
        let afterPrior = try rules.applyJudgment(nil, prior).entry
        let judged = rec(2, jing, "judged", "wrong", TODAY, at: at(TODAY, 20, 5), sessionId: "s2")
        let (afterWrong, fsrsBefore) = try rules.applyJudgment(afterPrior, judged)
        XCTAssertEqual(fsrsBefore, afterPrior["fsrs"], "fsrsBefore = card before this judgment")
        let corrected = correctRecord(judged, "correct", at(TODAY, 20, 9))
        let fixed1 = try rules.replay(fsrsBefore, [corrected])
        let fixed2 = try rules.replay(fsrsBefore, [corrected])
        XCTAssertEqual(fixed1, fixed2, "deterministic")
        let direct = try rules.applyJudgment(afterPrior, JS.with(judged, [("judgment", .string("correct"))])).entry
        XCTAssertEqual(fixed1, direct, "same as if it had been judged correct at the original time")
        XCTAssertNotEqual(fixed1?["due"], afterWrong["due"])
        XCTAssertEqual(fixed1?["lastJudgedAt"], judged["at"], "review time = the record at, not the correction time")
        // 改回写错：回到原来的调度
        XCTAssertEqual(try rules.replay(fsrsBefore, [correctRecord(corrected, "wrong", 1)]), afterWrong)
    }

    // test/core/fsrs.test.mjs: fsrs: ratingWithHint changes scheduling while help facts stay on the record
    func testFsrsRatingWithHintChangesSchedulingWhileHelpFactsStayOnTheRecord() throws {
        let r = rec(1, jing, "judged", "correct", TODAY, at: at(TODAY, 20), hints: 1)
        let prior = try rules.applyJudgment(nil, rec(1, jing, "judged", "correct", "2026-09-01", at: at("2026-09-01", 20))).entry
        let good = try rules.applyJudgment(prior, r).entry
        let again = try rules.applyJudgment(prior, r, policy: policyWith([("ratingWithHint", .string("Again"))])).entry
        XCTAssertTrue(due(good) > due(again), "\(due(good)) vs \(due(again))")
        XCTAssertEqual(r["help"]?["hints"], .number(1))
    }

    // test/core/fsrs.test.mjs: fsrs: applyJudgment keeps stoppedAt and rejects non-judged records
    func testFsrsApplyJudgmentKeepsStoppedAtAndRejectsNonJudgedRecords() throws {
        let prior = JS.with(try rules.applyJudgment(nil, rec(1, jing, "judged", "correct", "2026-09-01")).entry, [("stoppedAt", .number(5))])
        let (entry, fsrsBefore) = try rules.applyJudgment(prior, rec(2, jing, "judged", "correct", TODAY))
        XCTAssertEqual(entry["stoppedAt"], .number(5))
        XCTAssertEqual(fsrsBefore, prior["fsrs"])
        assertThrowsMessage(try rules.applyJudgment(prior, rec(3, jing, "answer-seen", nil, TODAY)), "judged")
        let fresh = try rules.applyJudgment(nil, rec(4, yi, "judged", "wrong", TODAY, at: at(TODAY, 20)))
        XCTAssertEqual(fresh.fsrsBefore, try rules.emptyCard(.number(at(TODAY, 20))), "new char: fsrsBefore = empty card at judgment time")
        let r4 = rec(4, yi, "judged", "wrong", TODAY, at: at(TODAY, 20))
        XCTAssertEqual(try rules.replay(fresh.fsrsBefore, [r4]), fresh.entry)
        XCTAssertEqual(try rules.replay(nil, [r4]), fresh.entry, "null == empty card")
        XCTAssertNil(try rules.replay(prior["fsrs"], [rec(5, jing, "skipped", nil, TODAY)]), "nothing to replay -> null")
    }

    // test/core/fsrs.test.mjs: fsrs: serialized cards are plain JSON and round-trip through the library
    func testFsrsSerializedCardsArePlainJSONAndRoundTripThroughTheLibrary() throws {
        let card = try rules.emptyCard(.number(at(TODAY)))
        XCTAssertTrue(rules.isCompactCard(card))
        XCTAssertEqual(J(str(card)), card)
        XCTAssertEqual(card["last_review"], .null)
        let step = try rules.reviewCard(card, review("correct", at(TODAY, 20)))
        // serializeCard(step.card)：step.card 已是 CompactCard；Swift 里 serializeCard 的入参是库的卡，这里经 toLibraryCard 往返
        XCTAssertEqual(try rules.serializeCard(try rules.toLibraryCard(step.card)), step.card)
        XCTAssertFalse(rules.isCompactCard(JS.with(card, [("stability", .string("x"))])))
        XCTAssertFalse(rules.isCompactCard(JS.with(card, [("due", .string("nope"))])))
    }

    // test/core/fsrs.test.mjs: fsrs: a library injected from another realm gives identical results
    // （跨 realm 注入是 JS 机制。Swift 里对应的含义：与具体实例无关——两个独立的 ScheduleRules 实例（各自的 TimeZone 对象）结果完全相同；
    //   库是进程内唯一的静态 FSRS6，用同一组参数另建一个 FSRS6 实例逐步算出的卡与 reviewCard 的卡相同。）
    func testFsrsALibraryInjectedFromAnotherRealmGivesIdenticalResults() throws {
        let other = ScheduleRules(timeZone: TimeZone(identifier: "Asia/Shanghai")!)
        let records = [rec(1, jing, "judged", "correct", "2026-09-01"), rec(2, jing, "judged", "wrong", "2026-09-03")]
        let local = try rules.replay(nil, records)
        XCTAssertNotNil(local)
        XCTAssertEqual(try other.replay(nil, records), local)
        XCTAssertEqual(try other.replay(nil, records, policy: Config.policy), local, "per-call policy passed explicitly")
        let c = Config.fsrsConfig
        let fresh = try FSRS6(requestRetention: try XCTUnwrap(c["requestRetention"]?.numberValue), maximumInterval: try XCTUnwrap(c["maximumInterval"]?.numberValue),
                              enableFuzz: c["enableFuzz"] == .bool(true))
        let start = try rules.toLibraryCard(try rules.emptyCard(.number(at("2026-09-01", 12, 1))))
        let viaFresh = try fresh.next(start, now: at("2026-09-01", 12, 1), grade: .easy)
        let viaShared = try ScheduleRules.fsrsLibrary.next(start, now: at("2026-09-01", 12, 1), grade: .easy)
        XCTAssertEqual(viaFresh, viaShared)
    }

    // test/core/fsrs.test.mjs: fsrs: overdueDays / isDue / retrievability
    func testFsrsOverdueDaysIsDueRetrievability() throws {
        XCTAssertEqual(try rules.overdueDays(J(#"{"due":"2026-09-20"}"#), TODAY), 4)
        XCTAssertEqual(try rules.overdueDays(J(#"{"due":"2026-09-30"}"#), TODAY), -6)
        XCTAssertNil(try rules.overdueDays(nil, TODAY))
        XCTAssertNil(try rules.overdueDays(.null, TODAY))
        XCTAssertTrue(try rules.isDue(J(#"{"due":"2026-09-24"}"#), .string(TODAY)))
        XCTAssertFalse(try rules.isDue(J(#"{"due":"2026-09-25"}"#), .string(TODAY)))
        XCTAssertFalse(try rules.isDue(J(#"{"due":"2026-09-01","stoppedAt":1}"#), .string(TODAY)))
        let entry = try rules.applyJudgment(nil, rec(1, jing, "judged", "correct", "2026-09-01", at: at("2026-09-01", 20))).entry
        let r = try XCTUnwrap(try rules.retrievability(entry, now: .number(at(TODAY))))
        XCTAssertTrue(r > 0 && r < 1, String(r))
    }

    // MARK: 阶段 1 P1-E4：D41 首见写对 / 热身字写对记 Easy（P126 / P127），带提示仍按 P34

    // test/core/fsrs.test.mjs: fsrs D41: a new char judged correct on its first judgment is rated Easy; hinted correct still follows P34
    func testFsrsD41ANewCharJudgedCorrectOnItsFirstJudgmentIsRatedEasyHintedCorrectStillFollowsP34() throws {
        let key = "base:" + yi
        let first = try rules.reviewCard(nil, review("correct", at(TODAY, 20), cardKey: key))
        XCTAssertEqual(first.rating, "Easy", "P127: first judgment, no hint -> Easy")
        let hinted = try rules.reviewCard(nil, review("correct", at(TODAY, 20), hints: 1, cardKey: key))
        XCTAssertEqual(hinted.rating, "Good", "P34 wins when a hint was used")
        let hintedHard = try rules.reviewCard(nil, review("correct", at(TODAY, 20), hints: 2, cardKey: key), policy: policyWith([("ratingWithHint", .string("Hard"))]))
        XCTAssertEqual(hintedHard.rating, "Hard")
        XCTAssertEqual(try rules.reviewCard(nil, review("wrong", at(TODAY, 20), cardKey: key)).rating, "Again")
        // 第二次判断不再是「第一次」：写对记 Good
        let second = try rules.reviewCard(first.card, review("correct", at(addDays(TODAY, 8), 20), cardKey: key))
        XCTAssertEqual(second.rating, "Good")
        // Easy 的初始稳定度远大于 Good：首次写对的 due 更晚
        let asGood = try rules.reviewCard(nil, review("correct", at(TODAY, 20)), policy: policyWith([("ratingFirstCorrect", .string("Good"))]))
        XCTAssertEqual(asGood.rating, "Good")
        XCTAssertTrue(num(first.card["stability"]) > num(asGood.card["stability"]) * 2, "\(num(first.card["stability"])) vs \(num(asGood.card["stability"]))")
        XCTAssertTrue(first.due > asGood.due, "\(first.due) vs \(asGood.due)")
        let bad = J(#"{"ratingWithHint":"Good","ratingFirstCorrect":"Hard","warmup":{"easyOnCorrect":true}}"#)
        assertThrowsMessage(try ScheduleRules.ratingFor(.string("correct"), J(#"{"hints":0}"#), policy: bad, first: true), "ratingFirstCorrect")
    }

    // test/core/fsrs.test.mjs: fsrs D41: first-time-wrong then later correct is Good (the first judgment was the wrong one); a correction replays the Easy rule
    func testFsrsD41FirstTimeWrongThenLaterCorrectIsGoodACorrectionReplaysTheEasyRule() throws {
        let r1 = rec(1, yi, "judged", "wrong", "2026-09-01", at: at("2026-09-01", 20))
        let r2 = rec(2, yi, "judged", "correct", "2026-09-03", at: at("2026-09-03", 20))
        let e1 = try rules.applyJudgment(nil, r1)
        XCTAssertEqual(try rules.reviewCard(e1.entry["fsrs"], r2).rating, "Good")
        // 结果页「改为写对」：重放从 fsrsBefore（空卡）起，第一条判断现在是写对 -> Easy，且与「一开始就判写对」同一结果
        let corrected = correctRecord(r1, "correct", at("2026-09-01", 21))
        let replayed = try rules.replay(e1.fsrsBefore, [corrected])
        let direct = try rules.applyJudgment(nil, JS.with(r1, [("judgment", .string("correct"))])).entry
        XCTAssertEqual(replayed, direct)
        XCTAssertEqual(try rules.reviewCard(e1.fsrsBefore, corrected).rating, "Easy")
    }

    // test/core/fsrs.test.mjs: fsrs D41: warm-up characters are rated Easy when correct without a hint (P126), on first and later reviews; hints fall back to P34
    func testFsrsD41WarmUpCharactersAreRatedEasyWhenCorrectWithoutAHintP126OnFirstAndLaterReviewsHintsFallBackToP34() throws {
        // 春：热身字（char-order warmup）；亦：普通字
        let warmFirst = try rules.applyJudgment(nil, rec(1, chun, "judged", "correct", "2026-09-01", at: at("2026-09-01", 20)))
        let warmSecond = try rules.reviewCard(warmFirst.entry["fsrs"], rec(2, chun, "judged", "correct", "2026-09-20", at: at("2026-09-20", 20)))
        XCTAssertEqual(warmSecond.rating, "Easy", "later correct reviews of a warm-up char are Easy too")
        let plainFirst = try rules.applyJudgment(nil, rec(3, yi, "judged", "correct", "2026-09-01", at: at("2026-09-01", 20)))
        let plainSecond = try rules.reviewCard(plainFirst.entry["fsrs"], rec(4, yi, "judged", "correct", "2026-09-20", at: at("2026-09-20", 20)))
        XCTAssertEqual(plainSecond.rating, "Good")
        let warmHinted = try rules.reviewCard(warmFirst.entry["fsrs"], rec(5, chun, "judged", "correct", "2026-09-20", at: at("2026-09-20", 20), hints: 1))
        XCTAssertEqual(warmHinted.rating, "Hard", "a hint means it was not easy (D65 #4: review with a hint -> Hard)")
        let warmWrong = try rules.reviewCard(warmFirst.entry["fsrs"], rec(6, chun, "judged", "wrong", "2026-09-20", at: at("2026-09-20", 20)))
        XCTAssertEqual(warmWrong.rating, "Again")
        XCTAssertEqual(try rules.reviewCard(warmFirst.entry["fsrs"], review("correct", at("2026-09-20", 20), cardKey: "base:" + chun), warmup: false).rating, "Good",
                       "opts.warmup overrides")
    }

    // MARK: D66 ① ②：看过答案 = 当天没写出来；提示 2 次起 Again

    /// 单字实验（产品体验评审 P2-01 / P2-02 同一套）：第 0 天 Easy、第 10 天 Good，第 56 天前后到期。
    private func matureCard() throws -> (d0: String, entry: JSValue) {
        let d0 = "2026-01-01"
        let e0 = try rules.applyJudgment(nil, rec(1, jing, "judged", "correct", d0, at: at(d0, 20))).entry
        let d10 = addDays(d0, 10)
        return (d0, try rules.applyJudgment(e0, rec(2, jing, "judged", "correct", d10, at: at(d10, 20))).entry)
    }

    // test/core/fsrs.test.mjs: fsrs D66 ①: a review char whose answer was seen gets one Again that day (not a judged record); a new char gets no schedule
    func testFsrsD66OneAReviewCharWhoseAnswerWasSeenGetsOneAgainThatDayANewCharGetsNoSchedule() throws {
        let (_, entry) = try matureCard()
        let day = due(entry)
        let seen = rec(3, jing, "answer-seen", nil, day, at: at(day, 20))
        let out = try applied(entry, seen)
        XCTAssertTrue(out.applied)
        let wrong = try rules.applyJudgment(entry, rec(3, jing, "judged", "wrong", day, at: at(day, 20))).entry
        XCTAssertEqual(out.entry?["fsrs"], wrong["fsrs"], "same FSRS step as writing it wrong (Again)")
        XCTAssertEqual(out.entry?["due"], wrong["due"])
        XCTAssertTrue(diffDays(day, due(out.entry)) <= 5, "back within days: \(diffDays(day, due(out.entry)))")
        XCTAssertEqual(out.entry?["seenAgainDay"], .string(day))
        XCTAssertEqual(out.entry?["lastJudgedAt"], entry["lastJudgedAt"], "not a judgment: lastJudgedAt unchanged")
        XCTAssertEqual(num(out.entry?["fsrs"]?["lapses"]), num(entry["fsrs"]?["lapses"]) + 1, "counted as a lapse")
        // 同一天第二次看答案：不再记
        XCTAssertFalse(try applied(out.entry, rec(4, jing, "answer-seen", nil, day, at: at(day, 21))).applied, "once a day")
        // 当天已经判断过：不再记
        let judgedToday = try rules.applyJudgment(entry, rec(5, jing, "judged", "correct", day, at: at(day, 19))).entry
        XCTAssertFalse(try applied(judgedToday, rec(6, jing, "answer-seen", nil, day, at: at(day, 20))).applied, "already judged today")
        // D83：新字第一次就看答案 = 没记住，记 Again（明天再来）
        let fresh = try applied(nil, rec(7, yi, "answer-seen", nil, day))
        XCTAssertTrue(fresh.applied)
        XCTAssertEqual(fresh.entry?["due"], .string(addDays(day, 1)), "a new char seen first comes back tomorrow")
        XCTAssertEqual(fresh.entry?["seenAgainDay"], .string(day))
        // 开关关（对照）
        XCTAssertFalse(try applied(entry, seen, policy: policyWith([("answerSeenRating", .string("none"))])).applied)
    }

    // test/core/fsrs.test.mjs: fsrs D66 ① (P2-01 experiment): due day seen the answer, next day correct → back in days, not 7 months
    func testFsrsD66OneP201ExperimentDueDaySeenTheAnswerNextDayCorrectBackInDaysNot7Months() throws {
        let (_, entry) = try matureCard()
        let day = due(entry)
        let next = addDays(day, 1)
        // 修前：到期当天看答案不改调度，第二天写对按 Good -> 约 178 天
        let before = try rules.applyJudgment(entry, rec(4, jing, "judged", "correct", next, at: at(next, 20))).entry
        XCTAssertTrue(diffDays(next, due(before)) > 100, "old path: \(diffDays(next, due(before))) days")
        // D66 ①：看答案那天记 Again，第二天写对
        let seen = try XCTUnwrap(try applied(entry, rec(3, jing, "answer-seen", nil, day, at: at(day, 20))).entry)
        let after = try rules.applyJudgment(seen, rec(4, jing, "judged", "correct", next, at: at(next, 20))).entry
        XCTAssertTrue(diffDays(next, due(after)) <= 14, "seen -> Again -> correct next day: \(diffDays(next, due(after))) days")
        let wrongEntry = try rules.applyJudgment(entry, rec(3, jing, "judged", "wrong", day, at: at(day, 20))).entry
        let wrongPath = try rules.applyJudgment(wrongEntry, rec(4, jing, "judged", "correct", next, at: at(next, 20))).entry
        XCTAssertEqual(after["fsrs"], wrongPath["fsrs"], "same as writing it wrong that day")
        XCTAssertNil(after["seenAgainDay"], "the mark is cleared by the next real judgment")
    }

    // test/core/fsrs.test.mjs: fsrs D66 ①: a judgment written the same day after the answer was seen is not rated again (no second Again); corrections replay it
    func testFsrsD66OneAJudgmentWrittenTheSameDayAfterTheAnswerWasSeenIsNotRatedAgainNoSecondAgainCorrectionsReplayIt() throws {
        let (_, entry) = try matureCard()
        let day = due(entry)
        let seen = try XCTUnwrap(try applied(entry, rec(3, jing, "answer-seen", nil, day, at: at(day, 20))).entry)
        for judgment in ["wrong", "correct"] {
            let r = rec(4, jing, "judged", judgment, day, at: at(day, 20, 30), hints: 4)
            let (held, fsrsBefore) = try rules.applyJudgment(seen, r)
            XCTAssertEqual(held["fsrs"], seen["fsrs"], "\(judgment): FSRS card unchanged")
            XCTAssertEqual(held["due"], seen["due"])
            XCTAssertEqual(held["lastJudgedAt"], r["at"])
            XCTAssertEqual(fsrsBefore["seenAgainDay"], .string(day), "fsrsBefore carries the mark for replay")
            // 本会话更正：改过去、改回来都按同一规则重放
            XCTAssertEqual(try rules.replay(fsrsBefore, [r]), held)
            XCTAssertEqual(try rules.replay(fsrsBefore, [correctRecord(r, judgment == "wrong" ? "correct" : "wrong", at(day, 21))]), held, "corrected: still held")
        }
        // 从头重放这个字的全部记录（judged + answer-seen）= 实际的调度项
        let r4 = rec(4, jing, "judged", "correct", day, at: at(day, 20, 30))
        let live = try rules.applyJudgment(seen, r4).entry
        let d10 = addDays("2026-01-01", 10)
        let all = [rec(1, jing, "judged", "correct", "2026-01-01", at: at("2026-01-01", 20)), rec(2, jing, "judged", "correct", d10, at: at(d10, 20)),
                   rec(3, jing, "answer-seen", nil, day, at: at(day, 20)), r4]
        XCTAssertEqual(try rules.replay(nil, all), live, "full replay incl. answer-seen")
        // 第二天的判断照常评级
        let next = addDays(day, 1)
        let tomorrow = try rules.applyJudgment(live, rec(5, jing, "judged", "correct", next, at: at(next, 20))).entry
        XCTAssertNotEqual(tomorrow["fsrs"], live["fsrs"])
    }

    // test/core/fsrs.test.mjs: fsrs D66 ①: a new char whose answer was seen before its first judgment is not rated Easy (review mapping)
    func testFsrsD66OneANewCharWhoseAnswerWasSeenBeforeItsFirstJudgmentIsNotRatedEasyReviewMapping() throws {
        let day = TODAY
        let next = addDays(day, 1)
        let seen = rec(1, yi, "answer-seen", nil, day, at: at(day, 20))
        let judged = rec(2, yi, "judged", "correct", next, at: at(next, 20))
        let clean = try rules.applyJudgment(nil, judged)
        let after = try rules.applyJudgment(nil, judged, records: [seen, judged])
        XCTAssertTrue(diffDays(next, due(clean.entry)) >= 5, "never seen: Easy \(diffDays(next, due(clean.entry))) days")
        XCTAssertTrue(diffDays(next, due(after.entry)) <= 3, "seen before: Good \(diffDays(next, due(after.entry))) days")
        XCTAssertEqual(after.fsrsBefore["seenBefore"], .bool(true))
        XCTAssertEqual(try rules.replay(after.fsrsBefore, [judged]), after.entry, "correction replay keeps the rule")
        // D83：新字先看答案已记 Again（建了调度项），全量重放从那张卡接着走
        let seenEntry = try rules.applyAnswerSeen(nil, seen).entry
        XCTAssertEqual(try rules.replay(nil, [seen, judged]), try rules.applyJudgment(seenEntry, judged).entry, "full replay = Again for the seen answer, then the judgment")
        // 带提示：按复习一档（1 次 Hard，2 次起 Again）
        let hinted = rec(2, yi, "judged", "correct", next, at: at(next, 20), hints: 2)
        let h = try rules.applyJudgment(nil, hinted, records: [seen, hinted])
        XCTAssertEqual(h.entry["due"], .string(addDays(next, 1)), "seen before + 2 hints -> Again")
        // 看答案在判断之后（id 更大）不算
        let later = rec(3, yi, "answer-seen", nil, next, at: at(next, 21))
        XCTAssertEqual(try rules.applyJudgment(nil, judged, records: [judged, later]).entry, clean.entry)
    }

    // test/core/fsrs.test.mjs: fsrs D66 ② (P2-02 experiment): on a mature char, 2 hints now give the same short interval as a wrong answer
    func testFsrsD66TwoP202ExperimentOnAMatureChar2HintsNowGiveTheSameShortIntervalAsAWrongAnswer() throws {
        let (_, entry) = try matureCard()
        let day = due(entry)
        let one = try rules.applyJudgment(entry, rec(3, jing, "judged", "correct", day, at: at(day, 20), hints: 1)).entry
        let two = try rules.applyJudgment(entry, rec(3, jing, "judged", "correct", day, at: at(day, 20), hints: 2)).entry
        let wrong = try rules.applyJudgment(entry, rec(3, jing, "judged", "wrong", day, at: at(day, 20))).entry
        XCTAssertTrue(diffDays(day, due(one)) > 30, "1 hint -> Hard: \(diffDays(day, due(one)))")
        XCTAssertEqual(two["due"], wrong["due"], "2 hints -> Again = wrong")
    }
}
