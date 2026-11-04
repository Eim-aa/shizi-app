import Foundation
import XCTest
@testable import ShiziCore

// test/core/mix.test.mjs 的转写（S2 / D83 起只留仍然成立的 8 条：热身字门控、练习状态、组内顺序）。规则 D 的配比、积压阀、
// 每日复习上限、新用户封顶与 simulate-mix 对照随调度规则 v2 退役（D82：JS 不再是参考）；v2 的配比测试见 TodayPlanTests。
// 辅助函数都放在类里（避免与别的测试文件的同名全局函数冲突）。

final class MixTests: XCTestCase {
    // MARK: 助手（test/core/helpers.mjs 与本文件头部的等价物）

    let tz = TimeZone(identifier: "Asia/Shanghai")!
    lazy var rules = ScheduleRules(timeZone: tz)
    let TODAY = "2026-09-24"
    let policy = Config.policy

    var mix: JSValue? { policy["groupMix"] }
    /// 这些场景历史很长（累计组数 ≥ 10）：关掉 D40 特别组（另有 special.test.mjs），只看日常配比。
    var NO_CAPITAL: JSValue { JS.with(policy, [("capitalNumerals", JS.with(policy["capitalNumerals"], [("enabled", .bool(false))]))]) }

    func isWarmKey(_ k: String) -> Bool { NewOrder.isWarmupKey(k) }

    func at(_ day: String, _ hour: Int = 12, _ minute: Int = 0) -> Double {
        let p = day.split(separator: "-").map { Int($0)! }
        return JSDate.makeLocal(p[0], p[1] - 1, p[2], hours: hour, tz)! + Double(minute) * 60000
    }

    func addDays(_ day: String, _ n: Int) -> String { try! rules.dates.addDays(day, Double(n)) }

    func rec(_ serial: Int, _ ch: String, _ kind: String, _ judgment: String?, _ day: String, at atMs: Double? = nil, sessionId: String = "s1") -> JSValue {
        var o = JSObject([
            ("id", .string("r\(serial)")), ("cardKey", .string("base:" + ch)), ("char", .string(ch)), ("sessionId", .string(sessionId)), ("kind", .string(kind)),
            ("at", .number(atMs ?? at(day, 12, serial % 60))), ("localDay", .string(day)),
            ("help", JS.obj([("hints", .number(0)), ("answerSeen", .bool(kind == "answer-seen")), ("traced", .bool(false))])),
        ])
        if kind == "judged", let j = judgment { o["judgment"] = .string(j) }
        return .object(o)
    }

    func sched(_ due: String, _ stability: Double = 5) -> JSValue {
        JS.obj([("fsrs", JS.obj([("stability", .number(stability))])), ("due", .string(due)), ("lastJudgedAt", .number(0))])
    }

    @nonobjc func K(_ keys: [String]) -> [String] { keys.map { "base:" + $0 } }
    @nonobjc func K(_ s: String) -> [String] { K(scalars(s)) }
    func scalars(_ s: String) -> [String] { s.unicodeScalars.map { String($0) } }
    func strip(_ key: String) -> String { String(key.dropFirst(5)) }

    /// 造字：从 CJK 区间取不含热身字 / 保留字的字，按 from 偏移取 n 个。
    func chars(_ n: Int, _ from: Int) -> [String] {
        var out: [String] = []
        var cp = 0x4e00 + from
        while out.count < n {
            let c = String(Unicode.Scalar(cp)!)
            if !NewOrder.isWarmupChar(c) && !NewOrder.isReservedChar(c) { out.append(c) }
            cp += 1
        }
        return out
    }
    func plainChars(_ n: Int, _ from: Int) -> [String] { chars(n, from) }

    func warmupList(_ from: Int, _ to: Int) -> [String] {
        let all = (Config.charOrderData["warmup"]?.arrayValue ?? []).map { JS.string($0) }
        return Array(all[from..<to])
    }

    func merged(_ base: JSValue, _ extra: JSObject) -> JSValue { JS.with(base, extra.entries.map { ($0.key, Optional($0.value)) }) }

    /// 一个场景：sched 表、records、新字候选。
    struct Scenario {
        var sched: JSValue
        var records: [JSValue]
        var candidates: [String]
    }

    /// 一个场景（全部来自 records / sched）：
    ///   due 个到期字；G = 前 7 天每天几组；accuracy = high | low（最近 10 个新字首判断全对 / 全错）；
    ///   lastHadNew = 最近一组有没有新字；away = 最近一次练习是 10 天前（整段历史后移）；early = 可提前复习的字数。
    func scenario(due: Int = 0, G: Int = 1, accuracy: String? = "high", lastHadNew: Bool = true, away: Bool = false, early: Int = 0, newCands: [String]? = nil) -> Scenario {
        let shift = away ? 9 : 0
        var records: [JSValue] = []
        var schedTable = JSObject()
        var id = 100
        for (i, c) in chars(due, 0).enumerated() {
            records.append(rec(id, c, "judged", "correct", addDays(TODAY, -40), sessionId: "s0")); id += 1
            schedTable["base:" + c] = sched(addDays(TODAY, -1 - (i % 3)), Double(3 + i))
        }
        let revPool = chars(60, 200)
        for c in revPool { records.append(rec(id, c, "judged", "correct", addDays(TODAY, -45), sessionId: "s00")); id += 1 }
        var k = 0
        let lastGroupId = "s-last"
        for d in 1...7 {
            for g in 0..<G {
                if d == 1 && g == G - 1 { continue } // 最近一组放到最后（id 最大）
                records.append(rec(id, revPool[k % revPool.count], "judged", "correct", addDays(TODAY, -d - shift), sessionId: "s-\(d)-\(g)")); id += 1
                k += 1
            }
        }
        if let acc = accuracy {
            for c in chars(10, 400) {
                records.append(rec(id, c, "judged", acc == "high" ? "correct" : "wrong", addDays(TODAY, -2 - shift), sessionId: "s-2-0")); id += 1
            }
        }
        records.append(lastHadNew
            ? rec(9000, chars(1, 450)[0], "judged", "correct", addDays(TODAY, -1 - shift), sessionId: lastGroupId)
            : rec(9000, revPool[59], "judged", "correct", addDays(TODAY, -1 - shift), sessionId: lastGroupId))
        for (i, c) in chars(early, 600).enumerated() { schedTable["base:" + c] = sched(addDays(TODAY, 2 + i), 5) }
        return Scenario(sched: .object(schedTable), records: records, candidates: newCands ?? K(chars(30, 800)))
    }

    /// selectDaily 的 JS 包装：缺省按 5 字一组选字（本文件的用例都是按 5 字一组写的 D41 规则）。
    func selectDaily(sched: JSValue? = nil, records: [JSValue] = [], today: String? = nil, newCandidates: [String], warmupCandidates: [String] = [],
                     policy: JSValue? = nil, groupSize: JSValue = .number(5)) throws -> ScheduleRules.DailyPlan {
        try rules.selectDaily(sched: sched, records: records, today: today ?? TODAY, newCandidates: newCandidates, warmupCandidates: warmupCandidates,
                              policy: policy ?? Config.policy, isWarm: { NewOrder.isWarmupKey($0) }, groupSize: groupSize)
    }

    func run(_ w: Scenario, policy: JSValue? = nil) throws -> ScheduleRules.DailyPlan {
        try selectDaily(sched: w.sched, records: w.records, newCandidates: w.candidates, policy: policy ?? NO_CAPITAL)
    }

    func stats(_ records: [JSValue]) throws -> PracticeStats {
        try rules.practiceStats(records, TODAY, policy: policy, isWarm: { NewOrder.isWarmupKey($0) })
    }

    func statsOf(dayIndex: Double, allAccuracy: Double = 1) -> PracticeStats {
        PracticeStats(groupsTotal: 0, groupsPerDay: 1, newAccuracy: 0.5, allAccuracy: allAccuracy, lastHadNew: true, firstBack: false,
                      dayIndex: dayIndex, hadToday: false, lastDay: nil, firstDay: nil)
    }

    // MARK: 热身字门控

    // warm-up gate (P126): only within 7 days of the first practice or when recent accuracy < 0.6; at most 1, at the head
    func testWarmUpGateP126OnlyWithin7DaysOfTheFirstPracticeOrWhenRecentAccuracyBelow06() throws {
        let warmList = K(warmupList(0, 4))
        let cands = K(plainChars(20, 300))
        let old = addDays(TODAY, -20)
        func history(_ okEach: Bool) -> [JSValue] {
            (0..<10).map { i in rec(200 + i, plainChars(1, 500 + i)[0], "judged", okEach ? "correct" : "wrong", addDays(TODAY, -1), sessionId: "s4") }
        }
        func base(_ records: [JSValue], policy: JSValue? = nil) throws -> ScheduleRules.DailyPlan {
            try selectDaily(sched: .object(JSObject()), records: records, newCandidates: cands, warmupCandidates: warmList, policy: policy)
        }
        func first(_ day: String) -> JSValue { rec(1, plainChars(1, 10)[0], "judged", "correct", day, sessionId: "s1") }
        // 第 3 天（首练后 7 天内）：放 1 个，在组首
        let early = try base([first(addDays(TODAY, -2))] + history(true))
        XCTAssertEqual(early.warmKeys.count, 1)
        XCTAssertEqual(early.queue[0], warmList[0], "at the head of the group")
        XCTAssertEqual(early.queue.filter { isWarmKey($0) }.count, 1, "at most one warm-up char")
        // 第 21 天、最近全对：不放
        let calm = try base([first(old)] + history(true))
        XCTAssertEqual(calm.warmKeys, [])
        XCTAssertFalse(calm.queue.contains { isWarmKey($0) })
        // 第 21 天、最近 10 次全错（写对率 < 0.6）：放
        let struggling = try base([first(old)] + history(false))
        XCTAssertEqual(struggling.warmKeys.count, 1)
        XCTAssertEqual(struggling.queue[0], warmList[0])
        // 第 7 天还放、第 8 天不放（首练当天算第 1 天）
        let day7 = try base([first(addDays(TODAY, -6))] + history(true))
        let day8 = try base([first(addDays(TODAY, -7))] + history(true))
        XCTAssertEqual(day7.warmKeys.count, 1, "day 7 of practice")
        XCTAssertEqual(day8.warmKeys.count, 0, "day 8 of practice")
        // 门控值来自 policy.warmup（换一个 policy 就变）
        let wide = try base([first(old)] + history(true), policy: JS.with(policy, [("warmup", JS.with(policy["warmup"], [("firstDays", .number(30))]))]))
        XCTAssertEqual(wide.warmKeys.count, 1)
        XCTAssertThrowsError(try Mix.warmupAllowed(statsOf(dayIndex: 1, allAccuracy: 1), warm: JS.with(policy["warmup"], [("mode", .string("always"))]))) { error in
            XCTAssertTrue((error as? CoreError)?.message.contains("warmup.mode") ?? false, "\(error)")
        }
    }

    // warm-up chars also sit in the frequency-ordered new-char tail (real deck): the warm-up slot still works and the char is never in the group twice
    func testWarmUpCharsAlsoSitInTheFrequencyOrderedNewCharTailTheWarmUpSlotStillWorks() throws {
        let warmList = K(warmupList(0, 3))
        let cands = K(chars(6, 800)) + warmList + K(chars(10, 900)) // 热身字夹在候选里（字频尾部）
        let records = [rec(1, chars(1, 10)[0], "judged", "correct", addDays(TODAY, -1), sessionId: "s1")]
        let r = try selectDaily(sched: .object(JSObject()), records: records, newCandidates: cands, warmupCandidates: warmList,
                                policy: NO_CAPITAL)
        XCTAssertEqual(r.warmKeys, [warmList[0]])
        XCTAssertEqual(r.queue[0], warmList[0], "warm-up char first")
        XCTAssertEqual(Set(r.queue).count, r.queue.count, "no duplicates")
        XCTAssertEqual(r.queue.count, 5)
        // 热身字门控关着（第 21 天、写得好）时，候选尾部的热身字不会提前出来
        let old = [rec(1, chars(1, 10)[0], "judged", "correct", addDays(TODAY, -20), sessionId: "s1")]
        let calm = try selectDaily(sched: .object(JSObject()), records: old, newCandidates: cands, warmupCandidates: warmList, policy: NO_CAPITAL)
        XCTAssertEqual(calm.warmKeys, [])
        XCTAssertFalse(calm.queue.contains { warmList.contains($0) }, "the warm-up chars stay at the tail of the order")
    }

    // warm-up: a due warm-up review replaces the new warm-up char (one warm-up char per group) and goes first; at most one warm-up review per group
    func testWarmUpADueWarmUpReviewReplacesTheNewWarmUpCharAndGoesFirst() throws {
        let warmDue = K(warmupList(0, 3))
        var schedTable = JSObject()
        for (i, k) in warmDue.enumerated() { schedTable[k] = sched(addDays(TODAY, -1 - i)) }
        var records = [rec(1, plainChars(1, 10)[0], "judged", "correct", addDays(TODAY, -2), sessionId: "s1")]
        for (i, k) in warmDue.enumerated() { records.append(rec(2 + i, strip(k), "judged", "correct", addDays(TODAY, -5), sessionId: "s1")) }
        let r = try selectDaily(sched: .object(schedTable), records: records, newCandidates: K(plainChars(10, 300)), warmupCandidates: K(warmupList(10, 14)))
        XCTAssertEqual(r.queue.filter { isWarmKey($0) }.count, 1)
        XCTAssertEqual(r.queue[0], warmDue[2], "the most overdue warm-up review, at the head")
        XCTAssertEqual(r.warmKeys, [], "no NEW warm-up char when a warm-up review is in the group")
    }

    // MARK: 输入都从 records 推出

    // practiceStats: groups per day over the 7 days before today (today excluded, min 1), group total counts sessions
    func testPracticeStatsGroupsPerDayOverThe7DaysBeforeToday() throws {
        var rs: [JSValue] = []
        var n = 1
        func add(_ day: String, _ sid: String) {
            let serial = n
            n += 1
            rs.append(rec(serial, "\u{5B57}\(n)", "judged", "correct", day, sessionId: sid))
        }
        // 昨天 3 组、3 天前 2 组、10 天前 5 组（窗口外）、今天 1 组（不算进 G）
        for sid in ["s1", "s2", "s3"] { add(addDays(TODAY, -1), sid) }
        for sid in ["s4", "s5"] { add(addDays(TODAY, -3), sid) }
        for sid in ["s6", "s7", "s8", "s9", "s10"] { add(addDays(TODAY, -10), sid) }
        add(TODAY, "s11")
        add(TODAY, "s11") // 同一组的第二个字
        let st = try stats(rs)
        XCTAssertEqual(st.groupsTotal, 11)
        XCTAssertEqual(st.groupsPerDay, Swift.max(1, 5.0 / 7.0), "at least one group a day")
        var heavy: [JSValue] = []
        for d in 1...7 {
            for sid in ["a", "b", "c", "d"] {
                heavy.append(rec(heavy.count + 1, "\u{5B57}\(heavy.count)", "judged", "correct", addDays(TODAY, -d), sessionId: "s\(d)\(sid)"))
            }
        }
        XCTAssertEqual(try stats(heavy).groupsPerDay, 4)
        XCTAssertEqual(st.dayIndex, 11, "first practice 10 days ago -> today is day 11")
        XCTAssertTrue(st.hadToday)
    }

    // practiceStats: legacy records (no session) count as one group per day; recent-new accuracy uses first judgments of non-warm chars only
    func testPracticeStatsLegacyRecordsCountAsOneGroupPerDayRecentNewAccuracyUsesFirstJudgmentsOfNonWarmCharsOnly() throws {
        func legacy(_ serial: Int, _ ch: String, _ judgment: String, _ day: String) -> JSValue {
            JS.with(rec(serial, ch, "judged", judgment, day), [("sessionId", nil), ("legacy", .bool(true))])
        }
        let legacyRecords = [legacy(1, "\u{7532}", "correct", addDays(TODAY, -2)), legacy(2, "\u{4E59}", "correct", addDays(TODAY, -2)), legacy(3, "\u{4E19}", "wrong", addDays(TODAY, -1))]
        XCTAssertEqual(try stats(legacyRecords).groupsTotal, 2)
        let rs = [
            rec(1, "\u{4EA6}", "judged", "wrong", addDays(TODAY, -9), sessionId: "s1"), // 第一次判断：写错
            rec(2, "\u{4EA6}", "judged", "correct", addDays(TODAY, -5), sessionId: "s2"), // 第二次：不算新字
            rec(3, "\u{6625}", "judged", "correct", addDays(TODAY, -5), sessionId: "s2"), // 热身字：不算
            rec(4, "\u{6162}", "judged", "correct", addDays(TODAY, -5), sessionId: "s2"), // 热身字：不算
        ]
        let st = try stats(rs)
        XCTAssertEqual(st.newAccuracy, (0 + 0.5 * 2) / (1 + 2), "one first-judgment (wrong) smoothed with prior 0.5 x weight 2")
        XCTAssertEqual(st.allAccuracy, (3 + 0.7 * 2) / (4 + 2))
        // 窗口只取最近 10 个
        let many = (0..<14).map { i in rec(i + 1, "\u{5B57}\(i)", "judged", i < 4 ? "wrong" : "correct", addDays(TODAY, -2), sessionId: "s1") }
        XCTAssertEqual(try stats(many).newAccuracy, (10.0 + 1) / 12, "the 4 old wrong ones fell out of the 10-window")
    }

    // practiceStats: lastHadNew looks at the most recent group; ≥ 7 days away flips it to false for the first group back
    func testPracticeStatsLastHadNewLooksAtTheMostRecentGroup7DaysAwayFlipsItToFalse() throws {
        let rs = [
            rec(1, "\u{7532}", "judged", "correct", addDays(TODAY, -2), sessionId: "s1"),
            rec(2, "\u{7532}", "judged", "correct", addDays(TODAY, -1), sessionId: "s2"), // 最近一组 s2：只有复习
        ]
        XCTAssertFalse(try stats(rs).lastHadNew)
        let rs2 = rs + [rec(3, "\u{4E59}", "judged", "correct", addDays(TODAY, -1), sessionId: "s2")]
        XCTAssertTrue(try stats(rs2).lastHadNew, "s2 now has a first judgment")
        let away = [rec(1, "\u{7532}", "judged", "correct", addDays(TODAY, -9), sessionId: "s1"), rec(2, "\u{4E59}", "judged", "correct", addDays(TODAY, -9), sessionId: "s1")]
        let st = try stats(away)
        XCTAssertTrue(st.firstBack)
        XCTAssertFalse(st.lastHadNew, "last group had new chars but 9 days away -> treated as no")
        let six = try stats([rec(1, "\u{7532}", "judged", "correct", addDays(TODAY, -6), sessionId: "s1")])
        XCTAssertFalse(six.firstBack)
        XCTAssertTrue(six.lastHadNew)
        XCTAssertTrue(try stats([]).lastHadNew, "no records: nothing to avoid")
    }

    // MARK: 组内顺序

    // group order: warm-up first, then review/new interleaved, early reviews last; a new char is never last when a review can take its place
    func testGroupOrderWarmUpFirstThenReviewNewInterleavedEarlyReviewsLast() throws {
        func isW(_ k: String) -> Bool { k == "W" || k == "w1" }
        XCTAssertEqual(Mix.arrangeGroup(warmNew: "W", revKeys: ["r1", "r2"], earlyKeys: [], newKeys: ["n1", "n2"], isWarm: isW), ["W", "r1", "n1", "n2", "r2"],
                       "interleaved r1 n1 r2 n2 would end on a new char -> r2 moves to the end")
        XCTAssertEqual(Mix.arrangeGroup(warmNew: nil, revKeys: ["r1", "r2", "r3"], earlyKeys: [], newKeys: ["n1", "n2"], isWarm: isW), ["r1", "n1", "r2", "n2", "r3"],
                       "review new review new review")
        // 3 新 2 复：交错后末位是新字 → 把最后一个复习字挪到末位
        XCTAssertEqual(Mix.arrangeGroup(warmNew: nil, revKeys: ["r1", "r2"], earlyKeys: [], newKeys: ["n1", "n2", "n3"], isWarm: isW), ["r1", "n1", "n2", "n3", "r2"])
        // 提前复习放最后
        XCTAssertEqual(Mix.arrangeGroup(warmNew: nil, revKeys: ["r1"], earlyKeys: ["e1", "e2"], newKeys: ["n1", "n2"], isWarm: isW), ["r1", "n1", "n2", "e1", "e2"])
        // 热身字复习在组首
        XCTAssertEqual(Mix.arrangeGroup(warmNew: nil, revKeys: ["r1", "w1", "r2"], earlyKeys: [], newKeys: ["n1"], isWarm: isW), ["w1", "r1", "n1", "r2"])
        // 全新字：没有复习可换，保持原序；单个字
        XCTAssertEqual(Mix.arrangeGroup(warmNew: "W", revKeys: [], earlyKeys: [], newKeys: ["n1", "n2"], isWarm: isW), ["W", "n1", "n2"])
        XCTAssertEqual(Mix.arrangeGroup(warmNew: nil, revKeys: ["r1"], earlyKeys: [], newKeys: [], isWarm: isW), ["r1"])
        // 通过 selectDaily：末位是复习字
        let r = try run(scenario(due: 7, G: 4, accuracy: "high"))
        XCTAssertTrue(r.dueKeys.contains(r.queue[r.queue.count - 1]), "the group ends on a review char")
    }

    // selectDaily keeps working with the legacy call shape (no warm-up list, no isWarm): reviews and new chars fill the group
    func testSelectDailyKeepsWorkingWithTheLegacyCallShape() throws {
        // 不传 warmupCandidates、不传 isWarm（用默认值）
        let r = try rules.selectDaily(sched: JS.obj([("base:\u{4EA6}", sched("2026-09-20"))]), records: [], today: TODAY, newCandidates: K("\u{9C9C}\u{5883}\u{989D}\u{6162}"),
                                      policy: policy, groupSize: .number(5))
        XCTAssertEqual(r.queue.count, 5)
        XCTAssertTrue(r.dueKeys.contains("base:\u{4EA6}"))
        XCTAssertNil(r.special)
        XCTAssertEqual(policy["groupSize"], .number(15), "D83: the default per-group size is 15 (callers pass the user's choice)")
    }

}
