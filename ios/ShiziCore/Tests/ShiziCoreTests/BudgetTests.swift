import Foundation
import XCTest
@testable import ShiziCore

// test/store/budget.test.mjs 的转写（B4.4，17 条）：占用估算与预警阈值、墨迹淘汰层级（01 §9 / D27 / Q1）、记录折叠、每组字数的墨迹预算。
// 原用例里「月表保持同一个引用」（copy-on-write 的身份断言）在值类型里转写为「没动的月表与之前相等」。

private let MiB = 1024.0 * 1024.0
private let NOW = localMs(2026, 10, 2, 10) // 本地 2026-10-02

private func recs(_ pairs: [(String, [JSValue])]) -> JSObject { JSObject(pairs.map { ($0.0, JSValue.array($0.1)) }) }

// 「人」：r1(07 首) r2(07 中) r3(07 末) r4(10 中) r5(10 最近)；「口」：r6(08 唯一)；r7 10 月跳过；r99 孤儿
private func tierFixture() -> JSObject {
    let records = recs([
        ("2026-07", [srec(1, cRen, day: "2026-07-01"), srec(2, cRen, day: "2026-07-02"), srec(3, cRen, day: "2026-07-03")]),
        ("2026-08", [srec(6, cKou, day: "2026-08-01")]),
        ("2026-10", [srec(4, cRen, day: "2026-10-01"), srec(5, cRen, day: "2026-10-02"), srec(7, cRen, kind: "skipped", day: "2026-10-02")]),
    ])
    let monthOf: [(String, String)] = [("r1", "2026-07"), ("r2", "2026-07"), ("r3", "2026-07"), ("r4", "2026-10"), ("r5", "2026-10"), ("r6", "2026-08"), ("r7", "2026-10"), ("r99", "2026-10")]
    var ink = JSObject()
    for (id, m) in monthOf {
        var t = ink[m]?.objectValue ?? JSObject()
        t[id] = inkEntry(20, 4)
        ink[m] = .object(t)
    }
    return JSObject([("records", .object(records)), ("ink", .object(ink))])
}

private func tiersIndex(_ records: JSObject, sessions: JSValue? = nil, now: Double? = nil, keepDays: Double? = nil) -> Budget.RecordIndex {
    if let k = keepDays { return Budget.indexRecords(records, sessions: sessions, now: now, keepDays: k) }
    return Budget.indexRecords(records, sessions: sessions, now: now)
}

private func evictedIds(_ actions: [JSValue]) -> [String] { actions.filter { $0["type"] == .string("evictInk") }.map { $0["id"]!.stringValue! } }

private func keysSorted(_ o: JSObject) -> [String] { UTF16Order.sorted(o.keys) }

final class BudgetTests: XCTestCase {
    private func budgets(_ pairs: [(String, Double)]) -> Budgets { Budgets.resolve(JSObject(pairs.map { ($0.0, JSValue.number($0.1)) })) }

    // test/store/budget.test.mjs: entryBytes is UTF-16: (key + value) × 2
    func testEntryBytesIsUTF16KeyPlusValueTimes2() {
        XCTAssertEqual(Budget.entryBytes("ab", "cde"), 10)
        XCTAssertEqual(Budget.entryBytes("k", nil), 0)
        XCTAssertEqual(Budget.entryBytes("k", "\u{5B57}"), 4)
    }

    // test/store/budget.test.mjs: estimateUsage buckets and warn threshold (> 80% of assumed quota)
    func testEstimateUsageBucketsAndWarnThreshold() {
        let b = budgets([("quotaBytes", 1000)])
        func mk(_ total: Int) -> [(String, String)] { [("x", String(repeating: "y", count: total / 2 - 1))] }
        XCTAssertEqual(Budget.estimateUsage(mk(800), b)["level"], .string("ok"), "exactly 80% is not yet a warning")
        XCTAssertEqual(Budget.estimateUsage(mk(802), b)["level"], .string("warn"))
        XCTAssertEqual(Budget.estimateUsage(mk(1000), b)["level"], .string("full"))
        let pairs: [(String, String)] = [(SK("meta"), "{}"), (Schema.recordsKey("2026-09"), "[]"), ("shizi.corrupt.shizi.v2.sched", "x"), ("shizi.memory.v1", "{}"), ("other", "1")]
        let usage = Budget.estimateUsage(pairs)
        XCTAssertEqual(keysSorted(usage["byBucket"]!.objectValue!), ["corrupt", "foreign", "legacy-v1", "meta", "records"])
        XCTAssertEqual(usage["total"], .number(pairs.reduce(0) { $0 + Budget.entryBytes($1.0, $1.1) }))
        XCTAssertEqual(Budgets.defaults.warnRatio, 0.8)
        XCTAssertEqual(Budgets.defaults.quotaBytes, 5 * MiB)
        XCTAssertEqual(Budgets.defaults.recordsBudgetBytes, 1.5 * MiB)
        XCTAssertEqual(Budgets.defaults.inkBudgetBytes, 1.5 * MiB)
        // P57：预警阈值与假定配额来自 policy（生成的 policy.json），且仍可注入
        XCTAssertEqual(Budgets.defaults.warnRatio, Config.policyNumber("storageWarnRatio"))
        XCTAssertEqual(Budgets.defaults.quotaBytes, Config.policyNumber("assumedQuotaBytes"))
        XCTAssertEqual(Budgets.defaults.inkBudgetBytes, Config.policyNumber("inkBudgetBytes"))
        XCTAssertEqual(Budgets.defaults.recordsBudgetBytes, Config.policyNumber("recordsBudgetBytes"))
        XCTAssertEqual(Budget.estimateUsage(mk(900), budgets([("quotaBytes", 1000), ("warnRatio", 0.95)]))["level"], .string("ok"), "warnRatio is injectable")
        XCTAssertEqual(Budget.bucketOfKey(Schema.inkKey("2026-09")), "ink", "ink month keys count in the ink bucket")
        XCTAssertEqual(Budget.bucketOfKey("shizi.v2.ink"), "legacy-v1", "the old single ink key is no longer a v2 key")
        XCTAssertEqual(Budget.bucketOfKey(SK("txn")), "txn")
    }

    // test/store/budget.test.mjs: ink tiers follow 01 §9 as amended by D27: orphan < other-month rest < this-month rest < monthly first/last < first + latest per char (never)
    func testInkTiersFollow01Section9AsAmendedByD27() {
        let index = tiersIndex(tierFixture()["records"]!.objectValue!)
        func tier(_ id: String) -> Double { Budget.inkTier(id, index, "2026-10") }
        XCTAssertEqual(tier("r99"), 0, "orphan")
        XCTAssertEqual(tier("r2"), 1, "other month, not first/last")
        XCTAssertEqual(tier("r7"), 2, "this month, non-judged rest")
        XCTAssertEqual(tier("r3"), 3, "monthly last in July")
        XCTAssertEqual(tier("r4"), 3, "monthly first in October")
        XCTAssertEqual(tier("r1"), .infinity, "first judged (D27: never recycled)")
        XCTAssertEqual(tier("r5"), .infinity, "latest judged")
        XCTAssertEqual(tier("r6"), .infinity, "latest (and only) judged")
    }

    // test/store/budget.test.mjs: recover (ink over budget): evicts lowest tier first, oldest first within a tier, stops once under budget
    func testRecoverInkOverBudgetEvictsLowestTierFirstOldestFirstWithinATierStopsOnceUnderBudget() {
        var draft = tierFixture()
        let one = Budget.entryBytes(Schema.inkRecordKey("2026-10", "r1"), str(inkEntry(20, 4)))
        let total = Budget.inkBytes(draft["ink"])
        var manual = 0.0
        for (m, t) in draft["ink"]!.objectValue!.entries { for (id, e) in t.objectValue!.entries { manual += Budget.entryBytes(Schema.inkRecordKey(m, id), str(e)) } }
        XCTAssertEqual(total, manual, "ink bytes = sum over one-record keys")
        let before = draft["ink"]!
        let r = Budget.recover(&draft, now: NOW, budgets: budgets([("inkBudgetBytes", total - one * 2.5)]), dates: shanghai)
        XCTAssertEqual(evictedIds(r.actions), ["r99", "r2", "r7"], "tier order across month keys")
        XCTAssertEqual(r.actions.filter { $0["type"] == .string("evictInk") }.map { $0["month"]!.stringValue! }, ["2026-10", "2026-07", "2026-10"])
        let ink = flatInk(draft["ink"])
        XCTAssertTrue(ink["r5"] != nil && ink["r6"] != nil && ink["r1"] != nil)
        XCTAssertEqual(str(draft["ink"]!["2026-08"]!), str(before["2026-08"]!), "untouched month table not rewritten")
        XCTAssertNotEqual(str(draft["ink"]!), str(before), "ink domain replaced")
        XCTAssertEqual(draft["records"]!["2026-07"]!.arrayValue!.count, 3, "records untouched when under records budget")
    }

    // test/store/budget.test.mjs: recover (force, quota): evicts down to but never including first / latest per char (D27)
    func testRecoverForceQuotaEvictsDownToButNeverIncludingFirstLatestPerChar() {
        var draft = tierFixture()
        let r = Budget.recover(&draft, now: NOW, budgets: .defaults, force: true, needBytes: 10 * MiB, limit: Budget.Limit(inkMonths: ["2026-07", "2026-08", "2026-10"], months: []), dates: shanghai)
        XCTAssertEqual(keysSorted(flatInk(draft["ink"])), ["r1", "r5", "r6"], "D27: r1 (first) now survives too")
        XCTAssertEqual(draft["ink"]!["2026-07"]!.objectValue!.keys, ["r1"], "July keeps only the first judgment")
        var emptied = JSObject([
            ("records", .object(recs([("2026-07", [srec(1, cRen, day: "2026-07-01"), srec(2, cRen, day: "2026-07-02")]), ("2026-10", [srec(5, cRen, day: "2026-10-02")])]))),
            ("ink", .object(JSObject([("2026-07", .object(JSObject([("r2", inkEntry(20, 4))]))), ("2026-10", .object(JSObject([("r5", inkEntry(20, 4))])))]))),
        ])
        Budget.recover(&emptied, now: NOW, budgets: .defaults, force: true, needBytes: 10 * MiB, limit: Budget.Limit(inkMonths: ["2026-07", "2026-10"], months: []), dates: shanghai)
        XCTAssertEqual(emptied["ink"]!["2026-07"], .object(JSObject()), "emptied month table (store drops the key)")
        XCTAssertTrue(r.actions.allSatisfy { $0["type"] == .string("evictInk") }, "limit keeps records untouched")
        var onlyJuly = tierFixture()
        Budget.recover(&onlyJuly, now: NOW, budgets: .defaults, force: true, needBytes: 10 * MiB, limit: Budget.Limit(inkMonths: ["2026-07"], months: []), dates: shanghai)
        XCTAssertEqual(keysSorted(flatInk(onlyJuly["ink"])), ["r1", "r4", "r5", "r6", "r7", "r99"], "limit.inkMonths restricts eviction")
    }

    // test/store/budget.test.mjs: recover (records over budget): folds oldest month first, keeps first + latest per char (D27), drops folded ink; current month never folded
    func testRecoverRecordsOverBudgetFoldsOldestMonthFirstKeepsFirstAndLatestPerCharDropsFoldedInk() {
        var draft = tierFixture()
        let r = Budget.recover(&draft, now: NOW, budgets: budgets([("recordsBudgetBytes", 10)]), dates: shanghai)
        XCTAssertEqual(r.actions.filter { $0["type"] == .string("fold") }.map { $0["month"]!.stringValue! }, ["2026-07", "2026-08"], "oldest first, current month skipped")
        let july = draft["records"]!["2026-07"]!
        XCTAssertEqual(july["folded"], .bool(true))
        XCTAssertEqual(july["byDay"], J(#"{"2026-07-01":["人"],"2026-07-02":["人"],"2026-07-03":["人"]}"#))
        XCTAssertEqual(july["kept"]!.arrayValue!.map { $0["id"]!.stringValue! }, ["r1"], "D27 keeps the first-ever judgment")
        XCTAssertEqual(draft["records"]!["2026-08"]!["kept"]!.arrayValue!.map { $0["id"]!.stringValue! }, ["r6"])
        let ink = flatInk(draft["ink"])
        XCTAssertTrue(ink["r2"] == nil && ink["r3"] == nil, "ink of folded-away records dropped")
        XCTAssertNotNil(ink["r1"], "D27: ink of the kept first judgment stays")
        XCTAssertNotNil(ink["r6"])
        XCTAssertTrue(ink["r4"] != nil && ink["r5"] != nil, "current-month ink untouched by folding")
        XCTAssertNotNil(draft["records"]!["2026-10"]!.arrayValue)
    }

    // test/store/budget.test.mjs: needsRecovery: aged months (> 400 days) trigger even under budget
    func testNeedsRecoveryAgedMonthsTriggerEvenUnderBudget() {
        let state = JSObject([("records", .object(recs([("2025-06", [srec(1, cRen, day: "2025-06-01")]), ("2026-10", [srec(2, cKou, day: "2026-10-01")])]))), ("ink", .object(JSObject()))])
        let n = Budget.needsRecovery(state, now: NOW, budgets: .defaults, dates: shanghai)
        XCTAssertEqual(n["aged"], .bool(true))
        XCTAssertEqual(n["any"], .bool(true))
        let fresh = Budget.needsRecovery(JSObject([("records", .object(recs([("2025-09", [srec(1, cRen, day: "2025-09-01")])]))), ("ink", .object(JSObject()))]), now: NOW, budgets: .defaults, dates: shanghai)
        XCTAssertEqual(fresh["aged"], .bool(false), "2025-09 ends 366 days before 2026-10-02")
        XCTAssertEqual(fresh["any"], .bool(false))
    }

    // test/store/budget.test.mjs: D27 retention: pruneInkOfCards keeps first + latest judged ink of each card, recycles the middle ones
    func testD27RetentionPruneInkOfCardsKeepsFirstAndLatestJudgedInkOfEachCard() {
        var draft = tierFixture()
        let before = draft["ink"]!
        let dropped = Budget.pruneInkOfCards(&draft, ["base:" + cRen], dates: shanghai)
        XCTAssertEqual(UTF16Order.sorted(dropped.map { $0["id"]!.stringValue! }), ["r2", "r3", "r4", "r7"], "middle judged + non-judged ink recycled")
        let ink = flatInk(draft["ink"])
        XCTAssertNotNil(ink["r1"], "first judged ink kept")
        XCTAssertNotNil(ink["r5"], "latest judged ink kept")
        XCTAssertNotNil(ink["r6"], "other cards untouched")
        XCTAssertNotNil(ink["r99"], "orphans are left to budget recovery")
        XCTAssertEqual(str(draft["ink"]!["2026-08"]!), str(before["2026-08"]!), "untouched month table")
        XCTAssertNotEqual(str(draft["ink"]!), str(before))
        XCTAssertEqual(Budget.pruneInkOfCards(&draft, ["base:" + cRen], dates: shanghai), [], "idempotent")
    }

    // test/store/budget.test.mjs: D27 retention: first === latest (only one judgment) keeps one copy; history without first ink stays without (no borrowing)
    func testD27RetentionFirstEqualsLatestKeepsOneCopyHistoryWithoutFirstInkStaysWithout() {
        var one = JSObject([("records", .object(recs([("2026-08", [srec(6, cKou, day: "2026-08-01")])]))), ("ink", .object(JSObject([("2026-08", .object(JSObject([("r6", inkEntry(8, 2))])))])))])
        XCTAssertEqual(Budget.pruneInkOfCards(&one, ["base:" + cKou], dates: shanghai), [])
        XCTAssertEqual(flatInk(one["ink"]).keys, ["r6"])
        var hist = JSObject([
            ("records", .object(recs([("2026-07", [srec(1, cRen, day: "2026-07-01"), srec(2, cRen, day: "2026-07-02")]), ("2026-10", [srec(3, cRen, day: "2026-10-01")])]))),
            ("ink", .object(JSObject([("2026-07", .object(JSObject([("r2", inkEntry(8, 2))]))), ("2026-10", .object(JSObject([("r3", inkEntry(8, 2))])))]))),
        ])
        XCTAssertEqual(Budget.pruneInkOfCards(&hist, ["base:" + cRen], dates: shanghai).map { $0["id"]!.stringValue! }, ["r2"])
        XCTAssertEqual(flatInk(hist["ink"]).keys, ["r3"], "first (r1) stays inkless; nothing is moved onto it")
    }

    // test/store/budget.test.mjs: D27 retention: answer-seen / skipped are not judgments — they never become first or latest
    func testD27RetentionAnswerSeenSkippedAreNotJudgments() {
        var draft = JSObject([
            ("records", .object(recs([("2026-10", [srec(1, cYong, kind: "answer-seen", day: "2026-10-01"), srec(2, cYong, day: "2026-10-01"), srec(3, cYong, day: "2026-10-02"), srec(4, cYong, kind: "skipped", day: "2026-10-02")])]))),
            ("ink", .object(JSObject([("2026-10", .object(JSObject([("r2", inkEntry(8, 2)), ("r3", inkEntry(8, 2))])))]))),
        ])
        XCTAssertEqual(Budget.pruneInkOfCards(&draft, ["base:" + cYong], dates: shanghai), [], "r2 first, r3 latest: both kept")
        XCTAssertEqual(keysSorted(flatInk(draft["ink"])), ["r2", "r3"])
    }

    // test/store/budget.test.mjs: D27 retention: under quota pressure, middle ink goes first; first and latest of each card are never recycled
    func testD27RetentionUnderQuotaPressureMiddleInkGoesFirstFirstAndLatestNeverRecycled() {
        let index = tiersIndex(tierFixture()["records"]!.objectValue!)
        XCTAssertEqual(Budget.inkTier("r1", index, "2026-10"), .infinity)
        XCTAssertEqual(Budget.inkTier("r5", index, "2026-10"), .infinity)
        var draft = tierFixture()
        Budget.recover(&draft, now: NOW, budgets: .defaults, force: true, needBytes: 10 * MiB, limit: Budget.Limit(inkMonths: ["2026-07", "2026-08", "2026-10"], months: []), dates: shanghai)
        XCTAssertEqual(keysSorted(flatInk(draft["ink"])), ["r1", "r5", "r6"])
        var order = tierFixture()
        let one = Budget.entryBytes("r1", str(inkEntry(20, 4))) + 8
        let r = Budget.recover(&order, now: NOW, budgets: budgets([("inkBudgetBytes", Budget.inkBytes(order["ink"]) - one * 4.5)]), dates: shanghai)
        XCTAssertEqual(evictedIds(r.actions), ["r99", "r2", "r7", "r3", "r4"])
        XCTAssertTrue(flatInk(order["ink"])["r1"] != nil && flatInk(order["ink"])["r5"] != nil)
    }

    // test/store/budget.test.mjs: D27 retention: folding an old month keeps the first-ever judgment too (with its ink), not only the latest
    func testD27RetentionFoldingAnOldMonthKeepsTheFirstEverJudgmentToo() {
        var draft = tierFixture()
        Budget.recover(&draft, now: NOW, budgets: budgets([("recordsBudgetBytes", 10)]), dates: shanghai)
        XCTAssertEqual(draft["records"]!["2026-07"]!["kept"]!.arrayValue!.map { $0["id"]!.stringValue! }, ["r1"])
        let ink = flatInk(draft["ink"])
        XCTAssertNotNil(ink["r1"], "its ink survives the fold")
        XCTAssertTrue(ink["r2"] == nil && ink["r3"] == nil)
    }

    // 「人」r1 首 r2 中 r3 最近；r4 看后自写（新于最近判断，1 天前）；「口」r6；r8 看后自写（组开着）；「大」r9 看后自写（93 天前）；「中」r10 看后自写 → r11 判断
    private func afterSeenFixture() -> JSObject {
        let records = recs([
            ("2026-07", [srec(1, cRen, day: "2026-07-01"), srec(2, cRen, day: "2026-07-02"), srec(9, cDa, kind: "answer-seen", day: "2026-07-01", session: 9, at: NOW - 93 * ONE_DAY_MS)]),
            ("2026-08", [srec(6, cKou, day: "2026-08-01")]),
            ("2026-10", [srec(3, cRen, day: "2026-10-01"), srec(4, cRen, kind: "answer-seen", day: "2026-10-02", session: 4, at: NOW - ONE_DAY_MS),
                         srec(8, cKou, kind: "answer-seen", day: "2026-10-02", session: 8, at: NOW - ONE_DAY_MS),
                         srec(10, cZhong, kind: "answer-seen", day: "2026-10-01", session: 10, at: NOW - ONE_DAY_MS), srec(11, cZhong, day: "2026-10-02", session: 11, at: NOW - ONE_DAY_MS / 2)]),
        ])
        let monthOf: [(String, String)] = [("r1", "2026-07"), ("r2", "2026-07"), ("r9", "2026-07"), ("r6", "2026-08"), ("r3", "2026-10"), ("r4", "2026-10"), ("r8", "2026-10"), ("r10", "2026-10"), ("r11", "2026-10")]
        var ink = JSObject()
        for (id, m) in monthOf {
            var t = ink[m]?.objectValue ?? JSObject()
            t[id] = inkEntry(20, 4)
            ink[m] = .object(t)
        }
        let sessions = J(#"{"A":null,"B":null,"lastEnded":{"A":{"id":"s8","items":[]}}}"#)
        return JSObject([("records", .object(records)), ("ink", .object(ink)), ("sessions", sessions)])
    }

    // test/store/budget.test.mjs: Q1 tiers: after-seen ink is never recycled while its group is open; otherwise it ranks after every judged tier (expired 4, fresh 5)
    func testQ1TiersAfterSeenInkNeverRecycledWhileItsGroupIsOpenOtherwiseRanksAfterEveryJudgedTier() {
        let f = afterSeenFixture()
        let index = tiersIndex(f["records"]!.objectValue!, sessions: f["sessions"], now: NOW, keepDays: 30)
        func tier(_ id: String) -> Double { Budget.inkTier(id, index, "2026-10") }
        XCTAssertEqual(tier("r8"), .infinity, "open group")
        XCTAssertEqual(tier("r4"), 5, "newer than the latest judgment, 1 day old")
        XCTAssertEqual(tier("r9"), 4, "older than keepDays")
        XCTAssertEqual(tier("r10"), 4, "a later judgment exists")
        XCTAssertEqual(tier("r2"), 3)
        XCTAssertEqual(tier("r1"), .infinity)
        XCTAssertEqual(tier("r11"), .infinity)
        XCTAssertNotNil(Config.policyNumber("afterSeenInkKeepDays"))
        let byPolicy = tiersIndex(f["records"]!.objectValue!, sessions: f["sessions"], now: NOW)
        XCTAssertEqual(Budget.inkTier("r9", byPolicy, "2026-10"), 93 > Config.policyNumber("afterSeenInkKeepDays")! ? 4 : 5)
    }

    // test/store/budget.test.mjs: Q1 recover: judged middle ink goes first, then expired after-seen, then fresh after-seen; open-group after-seen and D27 first / latest never
    func testQ1RecoverJudgedMiddleInkGoesFirstThenExpiredAfterSeenThenFreshAfterSeen() {
        var draft = afterSeenFixture()
        let r = Budget.recover(&draft, now: NOW, budgets: .defaults, force: true, needBytes: 10 * MiB, limit: Budget.Limit(inkMonths: ["2026-07", "2026-08", "2026-10"], months: []), dates: shanghai)
        let order = r.actions.filter { $0["type"] == .string("evictInk") }.map { $0["id"]!.stringValue! + ":" + JSNumber.toString($0["tier"]!.numberValue!) }
        XCTAssertEqual(order, ["r2:3", "r9:4", "r10:4", "r4:5"])
        XCTAssertEqual(keysSorted(flatInk(draft["ink"])), ["r1", "r11", "r3", "r6", "r8"])
    }

    // test/store/budget.test.mjs: Q1 pruneInkOfCards: keeps after-seen ink newer than the latest judgment (only the latest one per card); drops it once a judgment follows, unless its group is open
    func testQ1PruneInkOfCardsKeepsAfterSeenInkNewerThanTheLatestJudgment() {
        var draft = afterSeenFixture()
        let dropped = UTF16Order.sorted(Budget.pruneInkOfCards(&draft, ["base:" + cRen, "base:" + cKou, "base:" + cZhong, "base:" + cDa], dates: shanghai).map { $0["id"]!.stringValue! })
        XCTAssertEqual(dropped, ["r10", "r2"])
        let ink = flatInk(draft["ink"])
        XCTAssertNotNil(ink["r4"])
        XCTAssertNotNil(ink["r8"])
        XCTAssertNotNil(ink["r9"])
        var two = JSObject([
            ("records", .object(recs([("2026-10", [srec(20, cYong, kind: "answer-seen", day: "2026-10-01", session: 20), srec(21, cYong, kind: "answer-seen", day: "2026-10-02", session: 21)])]))),
            ("ink", .object(JSObject([("2026-10", .object(JSObject([("r20", inkEntry(8, 2)), ("r21", inkEntry(8, 2))])))]))),
            ("sessions", J(#"{"A":null,"B":null,"lastEnded":{}}"#)),
        ])
        var open = two
        XCTAssertEqual(Budget.pruneInkOfCards(&two, ["base:" + cYong], dates: shanghai).map { $0["id"]!.stringValue! }, ["r20"])
        open["sessions"] = J(#"{"A":null,"B":null,"lastEnded":{"B":{"id":"s20","items":[]}}}"#)
        XCTAssertEqual(Budget.pruneInkOfCards(&open, ["base:" + cYong], dates: shanghai), [])
    }

    // test/store/budget.test.mjs: Q1 fold: an old month keeps after-seen records of an open group (with ink); other after-seen records fold away with their ink
    func testQ1FoldAnOldMonthKeepsAfterSeenRecordsOfAnOpenGroup() {
        var draft = afterSeenFixture()
        draft["sessions"] = J(#"{"A":null,"B":null,"lastEnded":{"A":{"id":"s9","items":[]}}}"#)
        Budget.recover(&draft, now: NOW, budgets: budgets([("recordsBudgetBytes", 10)]), dates: shanghai)
        XCTAssertEqual(draft["records"]!["2026-07"]!["kept"]!.arrayValue!.map { $0["id"]!.stringValue! }, ["r1", "r9"])
        XCTAssertNotNil(flatInk(draft["ink"])["r9"])
        var closed = afterSeenFixture()
        Budget.recover(&closed, now: NOW, budgets: budgets([("recordsBudgetBytes", 10)]), dates: shanghai)
        XCTAssertEqual(closed["records"]!["2026-07"]!["kept"]!.arrayValue!.map { $0["id"]!.stringValue! }, ["r1"])
        XCTAssertNil(flatInk(closed["ink"])["r9"])
    }

    // test/store/budget.test.mjs: D66 ⑭ (P326): the ink budget follows 每组字数; storagePressureOf only speaks near the limit
    func testD66InkBudgetFollowsGroupSizeStoragePressureOfOnlySpeaksNearTheLimit() {
        XCTAssertEqual(Budget.inkBudgetOf(.null), 2 * MiB, "never chosen → 20 → 2MiB")
        XCTAssertEqual(Budget.inkBudgetOf(J(#"{"groupSize":5}"#)), 1.5 * MiB)
        XCTAssertEqual(Budget.inkBudgetOf(J(#"{"groupSize":30}"#)), 2.5 * MiB)
        let big = JSObject([("ink", .object(JSObject([("2026-09", .object(JSObject([("r1", .string(String(repeating: "x", count: Int(0.9 * MiB))))])))]))), ("records", .object(JSObject()))])
        let now = localMs(2026, 9, 24, 12)
        var s20 = big
        s20["settings"] = J(#"{"groupSize":20}"#)
        var s5 = big
        s5["settings"] = J(#"{"groupSize":5}"#)
        XCTAssertEqual(Budget.needsRecovery(s20, now: now, budgets: .defaults, dates: shanghai)["ink"], .bool(false))
        XCTAssertEqual(Budget.needsRecovery(s5, now: now, budgets: .defaults, dates: shanghai)["ink"], .bool(true))
        XCTAssertEqual(Budget.storagePressureOf(.null), .null)
        XCTAssertEqual(Budget.storagePressureOf(J(#"{"level":"ok","ratio":0.5}"#)), .null)
        XCTAssertEqual(Budget.storagePressureOf(J(#"{"level":"warn","ratio":0.8123}"#)), J(#"{"level":"warn","ratio":0.812}"#))
        XCTAssertEqual(Budget.storagePressureOf(J(#"{"level":"full","ratio":1.01}"#)), J(#"{"level":"full","ratio":1.01}"#))
        XCTAssertEqual(Config.policyNumber("storageWarnRatio"), 0.8)
    }
}
