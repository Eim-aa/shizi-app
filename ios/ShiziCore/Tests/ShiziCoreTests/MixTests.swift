import Foundation
import XCTest
@testable import ShiziCore

// test/core/mix.test.mjs 的逐条转写（24 条）：每组复习与新字的配比（阶段 1 P1-E4：D41 规则 D、D28 热身字门控）。
// 前 3 条在 JS 里对照 docs/engineering/v10/phase1/tools/simulate-mix.mjs（研究用参考实现，只有 JS）；Swift 对照它导出的夹具 mix-sim.json
// （scripts/core-golden/domains/mix-sim.mjs：同一个网格 + 同一批 3000 个随机状态 + 参考实现的输出）。
// 辅助函数都放在类里（避免与别的测试文件的同名全局函数冲突）。

final class MixTests: XCTestCase {
    // MARK: 助手（test/core/helpers.mjs 与本文件头部的等价物）

    let tz = TimeZone(identifier: "Asia/Shanghai")!
    lazy var rules = ScheduleRules(timeZone: tz)
    let TODAY = "2026-09-24"
    let policy = Config.policy

    var mix: JSValue? { policy["groupMix"] }
    /// 与参考实现（D41 规则 D）对照时用旧阀（valveReleaseDays null）；D65 的回滞阀另有用例。
    var mixD41: JSValue { JS.with(policy["groupMix"], [("valveReleaseDays", .null)]) }
    /// 这些场景历史很长（累计组数 ≥ 10）：关掉 D40 特别组（另有 special.test.mjs），只看日常配比。
    var NO_CAPITAL: JSValue { JS.with(policy, [("capitalNumerals", JS.with(policy["capitalNumerals"], [("enabled", .bool(false))]))]) }

    func isWarmChar(_ c: String) -> Bool { NewOrder.isWarmupChar(c) }
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

    func counts(_ r: ScheduleRules.DailyPlan) -> [Int] { [Int(r.newTarget), r.dueKeys.count, r.newKeys.count, r.earlyKeys.count] }

    func stats(_ records: [JSValue]) throws -> PracticeStats {
        try rules.practiceStats(records, TODAY, policy: policy, isWarm: { NewOrder.isWarmupKey($0) })
    }

    func statsOf(dayIndex: Double, allAccuracy: Double = 1) -> PracticeStats {
        PracticeStats(groupsTotal: 0, groupsPerDay: 1, newAccuracy: 0.5, allAccuracy: allAccuracy, lastHadNew: true, firstBack: false,
                      dayIndex: dayIndex, hadToday: false, lastDay: nil, firstDay: nil)
    }

    func targetOf(_ backlog: Double, _ lastHadNew: Bool, size: Double? = nil) -> Double {
        Mix.newTargetOf(MixState(backlog: backlog, groupsPerDay: 1, newAccuracy: 1, lastHadNew: .bool(lastHadNew)), mix: mix, size: size)
    }

    // MARK: 与 simulate-mix.mjs 对照

    // test/core/mix.test.mjs: mix vs simulate-mix: the sim and the app use the same warm-up list, group size and cap
    func testMixVsSimulateMixTheSimAndTheAppUseTheSameWarmUpListGroupSizeAndCap() throws {
        let meta = try XCTUnwrap(try loadFixture("mix-sim")["cases"]?.arrayValue?.first)
        XCTAssertEqual(meta["kind"], .string("meta"))
        XCTAssertEqual(meta["tableWarmupOrder"], Config.charOrderData["warmup"])
        // typeof sim.planGroup / sim.RULES.D.newTarget === 'function'（参考实现只有 JS：夹具生成时已核对）
        XCTAssertEqual(meta["simPlanGroupIsFunction"], .bool(true))
        XCTAssertEqual(meta["simRuleDNewTargetIsFunction"], .bool(true))
    }

    // test/core/mix.test.mjs: mix vs simulate-mix: newTarget of rule D agrees on a grid across every threshold (0.5 / 1.5 / 4, accuracy 0.6, lastHadNew)
    func testMixVsSimulateMixNewTargetOfRuleDAgreesOnAGridAcrossEveryThreshold() throws {
        var n = 0
        for c in try XCTUnwrap(try loadFixture("mix-sim")["cases"]?.arrayValue) where c["kind"] == .string("grid") {
            let backlog = try XCTUnwrap(c["backlog"]?.numberValue), g = try XCTUnwrap(c["G"]?.numberValue), acc = try XCTUnwrap(c["newAcc"]?.numberValue)
            let last = try XCTUnwrap(c["lastHadNew"]?.boolValue)
            let a = try XCTUnwrap(c["expected"]?.numberValue)
            let b = Mix.newTargetOf(MixState(backlog: backlog, groupsPerDay: g, newAccuracy: acc, lastHadNew: .bool(last)), mix: mixD41)
            XCTAssertEqual(b, a, "backlog \(backlog) G \(g) acc \(acc) lastHadNew \(last)")
            n += 1
        }
        XCTAssertEqual(n, 14 * 6 * 6 * 2)
    }

    // test/core/mix.test.mjs: mix vs simulate-mix: planGroup (3000 random states) gives the same new / review / early counts and the same characters
    func testMixVsSimulateMixPlanGroup3000RandomStatesGivesTheSameCountsAndTheSameCharacters() throws {
        let size = 5.0 // 参考实现按 5 字一组
        var withWarmNew = 0, withEarly = 0, allReview = 0, threeNew = 0, shortGroups = 0, trials = 0
        for c in try XCTUnwrap(try loadFixture("mix-sim")["cases"]?.arrayValue) where c["kind"] == .string("plan") {
            trials += 1
            let state = try XCTUnwrap(c["state"])
            let dueKeys = scalars(JS.string(c["due"])), earlyKeys = scalars(JS.string(c["early"]))
            let budget = try XCTUnwrap(c["budget"]?.numberValue)
            let warmPeek = c["warmPeek"]?.stringValue
            let ex = try XCTUnwrap(c["expected"])
            let warmOk = try Mix.warmupAllowed(statsOf(dayIndex: JS.number(state["day"]), allAccuracy: JS.number(state["allAcc"])), warm: policy["warmup"])
            let b = Mix.planGroup(size: size, budget: budget, due: dueKeys, early: earlyKeys, isWarm: { NewOrder.isWarmupChar($0) }, warmNext: warmPeek, warmOk: warmOk,
                                  state: MixState(backlog: JS.number(state["backlog"]), groupsPerDay: JS.number(state["groupsPerDayEma"]), newAccuracy: JS.number(state["newAcc"]),
                                                  lastHadNew: state["lastHadNew"]),
                                  mix: mixD41)
            let ctx = "trial \(c["trial"] ?? .null) state \(state) budget \(budget) nDue \(dueKeys.count) early \(earlyKeys.count) warmPeek \(warmPeek ?? "null")"
            XCTAssertEqual(b.newTarget, JS.number(ex["newTarget"]), "newTarget " + ctx)
            XCTAssertEqual(b.revKeys, scalars(JS.string(ex["revKeys"])), "revKeys " + ctx)
            XCTAssertEqual(b.earlyKeys, scalars(JS.string(ex["earlyKeys"])), "earlyKeys " + ctx)
            XCTAssertEqual(b.newSlots, JS.number(ex["newSlots"]), "newSlots " + ctx)
            XCTAssertEqual(b.warmNew, ex["warmNew"]?.stringValue, "warmNew " + ctx)
            XCTAssertEqual(Double(b.warmRev), JS.number(ex["warmRev"]), "warmRev " + ctx)
            XCTAssertEqual(Double(b.revKeys.count + b.earlyKeys.count) + b.newSlots, size, "group is full when new chars are unlimited")
            if b.warmNew != nil { withWarmNew += 1 }
            if !b.earlyKeys.isEmpty { withEarly += 1 }
            if b.newSlots - (b.warmNew != nil ? 1 : 0) == 0 && Double(b.revKeys.count + b.earlyKeys.count) == size { allReview += 1 }
            if b.newSlots == 3 { threeNew += 1 }
            if Double(b.revKeys.count) < Swift.min(size - b.newTarget, budget) { shortGroups += 1 }
        }
        XCTAssertEqual(trials, 3000)
        // 抽样确实覆盖了各个分支（不是空转）
        XCTAssertTrue(withWarmNew > 100 && withEarly > 100 && allReview >= 3 && threeNew > 100 && shortGroups > 100,
                      "\(withWarmNew) \(withEarly) \(allReview) \(threeNew) \(shortGroups)")
    }

    // MARK: 规则 D 各分支（经 selectDaily 的真实输入）

    // test/core/mix.test.mjs: rule D: p < 0.5 and recent new-char accuracy ≥ 0.6 → up to 3 new (reviews capped at 2); accuracy < 0.6 → only 2 new (reviews capped at 3)
    func testRuleDPBelow05AndRecentNewCharAccuracyAtLeast06UpTo3New() throws {
        // 每天 4 组（G = 4）、7 个到期：p = 7 / 16 = 0.4375
        let high = try run(scenario(due: 7, G: 4, accuracy: "high"))
        XCTAssertTrue(high.pressure < 0.5 && high.pressure > 0.4, String(high.pressure))
        XCTAssertEqual(counts(high), [3, 2, 3, 0], "newTarget 3 -> 2 reviews + 3 new")
        let low = try run(scenario(due: 7, G: 4, accuracy: "low"))
        XCTAssertEqual(counts(low), [2, 3, 2, 0], "accuracy < 0.6 -> newTarget 2 -> 3 reviews + 2 new")
        // 一个新字历史都没有：先验 0.5 < 0.6 → 也是 2 新档（不会因为「没数据」就给第 3 个新字）
        let none = try stats([])
        XCTAssertEqual(none.newAccuracy, 0.5)
        XCTAssertEqual(Mix.newTargetOf(MixState(backlog: 7, groupsPerDay: 4, newAccuracy: none.newAccuracy, lastHadNew: .bool(true)), mix: mix), 2)
    }

    // test/core/mix.test.mjs: rule D: 0.5 ≤ p < 1.5 → 2 new; 1.5 ≤ p < 4 → 1 new
    func testRuleD05ToPBelow15Gives2NewAnd15ToPBelow4Gives1New() throws {
        // G = 1 → p = due / 4
        XCTAssertEqual(counts(try run(scenario(due: 4))), [2, 3, 2, 0], "p 1.0")
        XCTAssertEqual(counts(try run(scenario(due: 5))), [2, 3, 2, 0], "p 1.25")
        XCTAssertEqual(counts(try run(scenario(due: 6))), [1, 4, 1, 0], "p 1.5 -> 1 new tier")
        XCTAssertEqual(counts(try run(scenario(due: 15))), [1, 4, 1, 0], "p 3.75")
    }

    // test/core/mix.test.mjs: valve (p ≥ 4, D65 #2): new chars drop to 0 whether or not the last group had new chars; the D41 alternating valve stays available for comparison
    func testValvePAtLeast4NewCharsDropTo0WhetherOrNotTheLastGroupHadNewChars() throws {
        let full = try run(scenario(due: 16, lastHadNew: true))
        XCTAssertEqual(full.pressure, 4)
        XCTAssertEqual(counts(full), [0, 5, 0, 0], "a whole group of reviews")
        XCTAssertEqual(counts(try run(scenario(due: 16, lastHadNew: false))), [0, 5, 0, 0], "still closed")
        XCTAssertEqual(counts(try run(scenario(due: 40, lastHadNew: false))), [0, 5, 0, 0])
        // D41 旧阀：上一组全复习 → 1 新
        XCTAssertEqual(Mix.newTargetOf(MixState(backlog: 16, groupsPerDay: 1, newAccuracy: 1, lastHadNew: .bool(false)), mix: mixD41), 1)
        XCTAssertEqual(Mix.newTargetOf(MixState(backlog: 16, groupsPerDay: 1, newAccuracy: 1, lastHadNew: .bool(true)), mix: mixD41), 0)
    }

    // test/core/mix.test.mjs: valve hysteresis (D65 #2): once closed it stays closed until p < valveReleaseDays (2), then the usual tiers come back
    func testValveHysteresisOnceClosedItStaysClosedUntilPBelowValveReleaseDays() throws {
        XCTAssertEqual(mix?["valveReleaseDays"], .number(2))
        // 5 字一组：每组按 4 个复习折算；p = 积压 / 4
        XCTAssertEqual(targetOf(12, false, size: 5), 0, "p 3 and the valve is closed -> stays closed")
        XCTAssertEqual(targetOf(8, false, size: 5), 0, "p 2 -> still closed")
        XCTAssertEqual(targetOf(7, false, size: 5), 1, "p 1.75 < 2 -> open again (1.5 <= p -> 1 new)")
        XCTAssertEqual(targetOf(12, true, size: 5), 1, "p 3 while open -> the usual 1 new")
        XCTAssertEqual(targetOf(4, false, size: 5), 2, "p 1 -> 2 new")
        // 20 字一组：同样的天数门槛，按字数是 4 倍（16 个复习 / 组）
        XCTAssertEqual(targetOf(64, true, size: 20), 0, "p 4 at 20 per group = 64 due")
        XCTAssertEqual(targetOf(63, true, size: 20), 4, "p < 4 -> 1 share = 4 new")
        XCTAssertEqual(targetOf(32, false, size: 20), 0, "closed, p 2")
        XCTAssertEqual(targetOf(31, false, size: 20), 4)
        XCTAssertEqual(targetOf(0, true, size: 20), 12, "p 0 -> 3 shares = 12 new")
        XCTAssertEqual(targetOf(10, true, size: 20), 8, "p 0.625 -> 2 shares = 8 new")
        // 离开很久回来的第一组：阀关着也给 1 份
        XCTAssertEqual(Mix.newTargetOf(MixState(backlog: 40, groupsPerDay: 1, newAccuracy: 1, lastHadNew: .bool(false), firstBack: .bool(true)), mix: mix, size: 5), 1)
    }

    // test/core/mix.test.mjs: D41 alternating valve (valveReleaseDays null) never makes two full-review groups in a row: a 30-due backlog alternates until it shrinks
    func testD41AlternatingValveNeverMakesTwoFullReviewGroupsInARow() throws {
        let w = scenario(due: 30, lastHadNew: true)
        var records = w.records
        var sch = try XCTUnwrap(w.sched.objectValue)
        var newsPerGroup: [Int] = []
        var serial = 20000
        for g in 0..<8 {
            let r = try selectDaily(sched: .object(sch), records: records, newCandidates: w.candidates, policy: JS.with(NO_CAPITAL, [("groupMix", mixD41)]))
            XCTAssertFalse(r.queue.isEmpty)
            newsPerGroup.append(r.newKeys.count)
            // 写完这一组：新 session，今天判断；复习字推到下个月，新字进调度（id 递增 → 它就是「最近一组」）
            for key in r.queue {
                records.append(rec(serial, strip(key), "judged", "correct", TODAY, sessionId: "s-today-\(g)")); serial += 1
                sch[key] = sched(addDays(TODAY, 30))
            }
        }
        for i in 1..<newsPerGroup.count {
            XCTAssertTrue(newsPerGroup[i] > 0 || newsPerGroup[i - 1] > 0, "groups \(i - 1) and \(i) are both all-review: \(newsPerGroup)")
        }
        XCTAssertEqual(newsPerGroup[0], 0, "p 7.5 and the last group had new chars -> all review")
        XCTAssertTrue(newsPerGroup[1] >= 1, "then at least one new char: \(newsPerGroup)")
        XCTAssertTrue(newsPerGroup.contains(0), "the valve did close at least once: \(newsPerGroup)")
    }

    // test/core/mix.test.mjs: rule D: coming back after ≥ 7 days the first group still has 1 new char even though the last group had new chars
    func testRuleDComingBackAfter7DaysTheFirstGroupStillHas1NewChar() throws {
        let stayed = try run(scenario(due: 16, lastHadNew: true))
        XCTAssertEqual(counts(stayed), [0, 5, 0, 0], "practiced yesterday -> valve closes new chars")
        let away = scenario(due: 16, lastHadNew: true, away: true)
        let st = try stats(away.records)
        XCTAssertTrue(st.firstBack)
        XCTAssertEqual(st.lastDay, addDays(TODAY, -10))
        // Q2-15（D48 ⑧，P184）：离开 ≥ 7 天回来的第一组缩短为 3 字——配比规则不变（仍 1 新字），只是组小了：1 新 + 2 复习。
        let backGroup = try run(away)
        XCTAssertEqual(counts(backGroup), [1, 2, 1, 0], "away 10 days -> 1 new as usual, in a group of 3")
        XCTAssertEqual(backGroup.queue.count, 3, "the first group back is 3 chars (D48 ⑧)")
        // 回来的第二组（今天已经有判断）不再享受「照常 1 新」
        let secondRecords = away.records + [rec(9500, chars(1, 460)[0], "judged", "correct", TODAY, sessionId: "s-back-1")]
        XCTAssertFalse(try stats(secondRecords).firstBack)
        // 6 天不算离开
        let sixDays = scenario(due: 16, lastHadNew: true)
        let shifted = shiftBack(sixDays.records)
        XCTAssertFalse(try stats(shifted).firstBack, "6 days away is not \"away\"")
    }

    /// 非今天的记录整体往前挪 5 天（最近一次练习 6 天前）。
    func shiftBack(_ records: [JSValue]) -> [JSValue] {
        records.map { r in
            JS.isString(r["localDay"], TODAY) ? r
                : JS.with(r, [("localDay", .string(addDays(JS.string(r["localDay"]), -5))), ("at", .number(JS.number(r["at"]) - 5 * 86400000))])
        }
    }

    // test/core/mix.test.mjs: D48 ⑧ (P184): the first group after ≥ 7 days away is 3 chars; the next group the same day, 6 days away and the special group are not shortened
    func testD48P184TheFirstGroupAfter7DaysAwayIs3CharsTheNextGroupTheSameDayIsNotShortened() throws {
        XCTAssertEqual(mix?["returnGroupSize"], .number(3))
        let away = scenario(due: 16, lastHadNew: true, away: true)
        XCTAssertEqual(try run(away).queue.count, 3, "away 10 days -> 3 chars")
        // 「第一组」= 今天还没有判断：写完一个字（今天已有判断）之后，下一组回到 5 字
        var second = away
        second.records.append(rec(9500, chars(1, 460)[0], "judged", "correct", TODAY, sessionId: "s-back-1"))
        XCTAssertEqual(try run(second).queue.count, 5, "a judgment today -> the next group is a full group of 5")
        // 正好 6 天不算离开
        var sixDays = scenario(due: 16, lastHadNew: true)
        sixDays.records = shiftBack(sixDays.records)
        XCTAssertEqual(try run(sixDays).queue.count, 5, "6 days away is not \"away\"")
        // 没有那么多字可出时按实际数量（不为凑 3 个而硬补）
        let few = try run(Scenario(sched: .object(JSObject()), records: away.records.filter { JS.string($0["localDay"]) <= addDays(TODAY, -9) }, candidates: K("\u{9171}")))
        XCTAssertTrue(few.queue.count <= 3, "never more than 3 on the first group back")
    }

    // test/core/mix.test.mjs: new chars: at most 3 while the due + early pool can fill the group; the 4th / 5th new only appear when nothing else can fill
    func testNewCharsAtMost3WhileTheDueAndEarlyPoolCanFillTheGroup() throws {
        // 2 个到期（p = 0.5，2 新档）→ 2 复习 + 3 新（新字最多 3）= 满 5，没有提前复习
        XCTAssertEqual(counts(try run(scenario(due: 2, early: 6))), [2, 2, 3, 0])
        // 1 个到期、新字最多 3 → 4 个，差 1：用最快到期的字提前复习补位，而不是第 4 个新字
        let r2 = try run(scenario(due: 1, early: 6))
        XCTAssertEqual(counts(r2), [3, 1, 3, 1])
        XCTAssertEqual(r2.earlyKeys, K(chars(1, 600)), "the soonest-due char")
        // 没有到期、提前复习候选 6 个：3 新 + 2 提前复习
        XCTAssertEqual(Array(counts(try run(scenario(due: 0, early: 6))).dropFirst()), [0, 3, 2])
        // 什么都补不上（没有到期、没有可提前复习的字，例如首练后的第一组）：才补到 5 个新字——新用户前 3 天除外（D66 ⑫：至多 2 份，组可以不满）
        let firstDay = Scenario(sched: .object(JSObject()), records: [rec(1, chars(1, 0)[0], "judged", "correct", TODAY, sessionId: "s1")], candidates: K(chars(30, 800)))
        let empty = try run(firstDay, policy: JS.with(NO_CAPITAL, [("newUserRamp", .null)]))
        XCTAssertEqual(empty.newKeys.count, 5)
        XCTAssertEqual(try run(firstDay).newKeys.count, 2, "D66 ⑫: day 1–3 of a new user -> at most 2 new per 5-char group")
        // 提前复习候选不够（只有 1 个）：补满靠新字
        let short = try run(scenario(due: 0, early: 1))
        XCTAssertEqual(Array(counts(short).dropFirst()), [0, 4, 1])
        // 新字也不够：组就短一点，不凑数
        let tiny = try run(scenario(due: 0, early: 1, newCands: K(chars(1, 900))))
        XCTAssertEqual(tiny.queue.count, 2)
    }

    // test/core/mix.test.mjs: library exhausted: no early reviews to fill a group (D66 ⑩) — nothing due → empty queue; some due → just those
    func testLibraryExhaustedNoEarlyReviewsToFillAGroup() throws {
        var only = JSObject()
        only["base:\u{4EA6}"] = sched(addDays(TODAY, 3))
        only["base:\u{9C9C}"] = sched(addDays(TODAY, 5))
        let none = try selectDaily(sched: .object(only), records: [], newCandidates: [], policy: NO_CAPITAL)
        XCTAssertEqual(none.queue, [])
        // 有一个到期字：D66 ⑩ 起不再用提前复习凑满——有多少到期出多少（修前：到期字 + 提前复习补位 = 3 个）
        let withDue = merged(.object(only), JSObject([("base:\u{989D}", sched(addDays(TODAY, -1)))]))
        let oneDue = try selectDaily(sched: withDue, records: [], newCandidates: [], policy: NO_CAPITAL)
        XCTAssertEqual(oneDue.dueKeys, ["base:\u{989D}"])
        XCTAssertEqual(oneDue.queue, ["base:\u{989D}"], "only the due char (policy.groupMix.earlyFillWhenExhausted = false, P324)")
        XCTAssertEqual(mix?["earlyFillWhenExhausted"], .bool(false))
        let old = try selectDaily(sched: withDue, records: [], newCandidates: [],
                                  policy: JS.with(NO_CAPITAL, [("groupMix", JS.with(mix, [("earlyFillWhenExhausted", .bool(true))]))]))
        XCTAssertEqual(old.queue.count, 3, "the old rule (for comparison): the due char plus the two early fillers")
        // 还有新字可出时照常用提前复习补位
        let withNew = try selectDaily(sched: .object(only), records: [], newCandidates: K("\u{9171}"), policy: NO_CAPITAL)
        XCTAssertEqual(withNew.queue.count, 3)
        XCTAssertEqual(withNew.earlyKeys.count, 2)
    }

    // test/core/mix.test.mjs: early reviews: soonest due first then least stable; not warm-up chars; not chars written today; stopped cards are skipped
    func testEarlyReviewsSoonestDueFirstThenLeastStableNotWarmUpCharsNotCharsWrittenTodayStoppedCardsAreSkipped() throws {
        let far = chars(8, 600)
        var extra = JSObject()
        extra["base:" + far[0]] = sched(addDays(TODAY, 5), 9)
        extra["base:" + far[1]] = sched(addDays(TODAY, 2), 9)
        extra["base:" + far[2]] = sched(addDays(TODAY, 2), 4) // 同日到期，稳定度低 → 排在 far[1] 前
        extra["base:" + far[3]] = JS.with(sched(addDays(TODAY, 1), 1), [("stoppedAt", .number(1))])
        extra["base:\u{6625}"] = sched(addDays(TODAY, 1), 1) // 热身字：不提前复习
        extra["base:" + far[4]] = sched(addDays(TODAY, 1), 1) // 今天写过
        let w = scenario(due: 0)
        let r = try run(Scenario(sched: merged(w.sched, extra), records: w.records + [rec(9600, far[4], "judged", "correct", TODAY, sessionId: "s5")], candidates: K("\u{4EA6}")))
        XCTAssertEqual(r.earlyKeys, K([far[2], far[1], far[0]]))
        XCTAssertFalse(r.earlyKeys.contains("base:\u{6625}"))
        XCTAssertEqual(r.queue.count, 4, "3 early + 1 new")
    }

    // MARK: 每日复习上限：提前复习不计入

    // test/core/mix.test.mjs: dailyReviewCap: an early review done today is not counted, an on-time one is (P125 earlyCountsTowardCap=false)
    func testDailyReviewCapAnEarlyReviewDoneTodayIsNotCountedAnOnTimeOneIs() throws {
        let day0 = "2026-09-01"
        // 亦：第一次写（Easy，约 8 天后到期）；今天（第 3 天）提前复习
        let r1 = rec(1, "\u{4EA6}", "judged", "correct", day0, at: at(day0, 20), sessionId: "s1")
        let e1 = try rules.applyJudgment(nil, r1).entry
        let earlyDay = addDays(day0, 3)
        XCTAssertTrue(JS.less(.string(earlyDay), e1["due"]), str(e1["due"] ?? .null))
        let r2 = rec(2, "\u{4EA6}", "judged", "correct", earlyDay, at: at(earlyDay, 20), sessionId: "s2")
        let e2 = try rules.applyJudgment(e1, r2).entry
        func schedOf(_ e: JSValue) -> JSValue { JS.obj([("base:\u{4EA6}", e)]) }
        XCTAssertEqual(rules.dueReviewsDoneOn([r1, r2], earlyDay, sched: schedOf(e2), policy: policy), 0, "early review: not counted")
        // 同一个字，到期当天才写：计入
        let due1 = JS.string(e1["due"])
        let r3 = rec(3, "\u{4EA6}", "judged", "correct", due1, at: at(due1, 20), sessionId: "s3")
        let e3 = try rules.applyJudgment(e1, r3).entry
        XCTAssertEqual(rules.dueReviewsDoneOn([r1, r3], due1, sched: schedOf(e3), policy: policy), 1, "on-time review: counted")
        // 重放对不上现在的调度（例如旧数据迁移来的 sched）→ 保守地计入
        XCTAssertEqual(rules.dueReviewsDoneOn([r1, r2], earlyDay, sched: schedOf(JS.with(e2, [("due", .string("2030-01-01"))])), policy: policy), 1)
        // 新字今天第一次写不是复习
        XCTAssertEqual(rules.dueReviewsDoneOn([r1], day0, sched: schedOf(e1), policy: policy), 0)
        // earlyCountsTowardCap=true 时按原口径
        let strict = JS.with(policy, [("groupMix", JS.with(mix, [("earlyCountsTowardCap", .bool(true))]))])
        XCTAssertEqual(rules.dueReviewsDoneOn([r1, r2], earlyDay, sched: schedOf(e2), policy: strict), 1)
    }

    // test/core/mix.test.mjs: dailyReviewCap through selectDaily: 30 early reviews written today leave the whole budget for due chars
    func testDailyReviewCapThroughSelectDaily30EarlyReviewsWrittenTodayLeaveTheWholeBudgetForDueChars() throws {
        let day0 = addDays(TODAY, -3)
        var records: [JSValue] = []
        var schedTable = JSObject()
        var serial = 1
        for c in chars(30, 1000) {
            let first = rec(serial, c, "judged", "correct", day0, at: at(day0, 20), sessionId: "s1"); serial += 1
            let entry = try rules.applyJudgment(nil, first).entry
            let again = rec(serial, c, "judged", "correct", TODAY, at: at(TODAY, 8), sessionId: "s2"); serial += 1
            records.append(first)
            records.append(again)
            schedTable["base:" + c] = try rules.applyJudgment(entry, again).entry
        }
        // 另有 8 个到期字
        for c in chars(8, 1100) {
            records.append(rec(serial, c, "judged", "correct", day0, at: at(day0, 20), sessionId: "s1")); serial += 1
            schedTable["base:" + c] = sched(addDays(TODAY, -1))
        }
        let r = try selectDaily(sched: .object(schedTable), records: records, newCandidates: K("\u{4EA6}"))
        XCTAssertEqual(r.reviewBudgetLeft, 30, "all 30 of today's reviews were early -> cap untouched")
        let counted = try selectDaily(sched: .object(schedTable), records: records, newCandidates: K("\u{4EA6}"),
                                      policy: JS.with(policy, [("groupMix", JS.with(mix, [("earlyCountsTowardCap", .bool(true))]))]))
        XCTAssertEqual(counted.reviewBudgetLeft, 0, "with the switch on they would exhaust the cap")
    }

    // MARK: 热身字门控

    // test/core/mix.test.mjs: warm-up gate (P126): only within 7 days of the first practice or when recent accuracy < 0.6; at most 1, at the head
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

    // test/core/mix.test.mjs: warm-up chars also sit in the frequency-ordered new-char tail (real deck): the warm-up slot still works and the char is never in the group twice
    func testWarmUpCharsAlsoSitInTheFrequencyOrderedNewCharTailTheWarmUpSlotStillWorks() throws {
        let warmList = K(warmupList(0, 3))
        let cands = K(chars(6, 800)) + warmList + K(chars(10, 900)) // 热身字夹在候选里（字频尾部）
        let records = [rec(1, chars(1, 10)[0], "judged", "correct", addDays(TODAY, -1), sessionId: "s1")]
        let r = try selectDaily(sched: .object(JSObject()), records: records, newCandidates: cands, warmupCandidates: warmList,
                                policy: JS.with(NO_CAPITAL, [("newUserRamp", .null)]))
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

    // test/core/mix.test.mjs: warm-up: a due warm-up review replaces the new warm-up char (one warm-up char per group) and goes first; at most one warm-up review per group
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

    // test/core/mix.test.mjs: practiceStats: groups per day over the 7 days before today (today excluded, min 1), group total counts sessions
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

    // test/core/mix.test.mjs: practiceStats: legacy records (no session) count as one group per day; recent-new accuracy uses first judgments of non-warm chars only
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

    // test/core/mix.test.mjs: practiceStats: lastHadNew looks at the most recent group; ≥ 7 days away flips it to false for the first group back
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

    // test/core/mix.test.mjs: group order: warm-up first, then review/new interleaved, early reviews last; a new char is never last when a review can take its place
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
        // 通过 selectDaily：3 新 + 2 复习，末位是复习字
        let r = try run(scenario(due: 7, G: 4, accuracy: "high"))
        XCTAssertEqual(r.newKeys.count, 3)
        XCTAssertTrue(r.dueKeys.contains(r.queue[r.queue.count - 1]), "the group ends on a review char")
    }

    // test/core/mix.test.mjs: selectDaily keeps working with the legacy call shape (no warm-up list, no isWarm): reviews and new chars fill the group
    func testSelectDailyKeepsWorkingWithTheLegacyCallShape() throws {
        // 不传 warmupCandidates、不传 isWarm（用默认值）
        let r = try rules.selectDaily(sched: JS.obj([("base:\u{4EA6}", sched("2026-09-20"))]), records: [], today: TODAY, newCandidates: K("\u{9C9C}\u{5883}\u{989D}\u{6162}"),
                                      policy: JS.with(policy, [("newUserRamp", .null)]), groupSize: .number(5))
        XCTAssertEqual(r.queue.count, 5)
        XCTAssertTrue(r.dueKeys.contains("base:\u{4EA6}"))
        XCTAssertNil(r.special)
        XCTAssertEqual(policy["groupSize"], .number(20), "D65 #2: the default per-group size is 20 (callers pass the user's choice)")
    }

    // test/core/mix.test.mjs: D66 ⑫ (policy.newUserRamp P325): days 1–3 after the first practice → at most 2 parts of new chars per group (20-char group: 8), no filling with new chars; day 4 back to normal
    func testD66NewUserRampDays1To3AfterTheFirstPracticeAtMost2PartsOfNewCharsPerGroup() throws {
        XCTAssertEqual(policy["newUserRamp"], J(#"{"days":3,"newMax":2}"#))
        let cands = K(chars(40, 800))
        func daily(_ firstDayOffset: Int) throws -> ScheduleRules.DailyPlan {
            let first = [rec(1, chars(1, 0)[0], "judged", "correct", addDays(TODAY, firstDayOffset), sessionId: "s1")]
            return try selectDaily(sched: .object(JSObject()), records: first, newCandidates: cands, policy: NO_CAPITAL, groupSize: .number(20))
        }
        let day2 = try daily(-1) // 首练是昨天：今天第 2 天
        XCTAssertEqual(day2.newKeys.count, 8, "day 2: 8 new (was 20 — nothing else to fill)")
        XCTAssertEqual(day2.queue.count, 8, "the group is not padded with more new chars")
        let day3 = try daily(-2)
        XCTAssertEqual(day3.newKeys.count, 8, "day 3 still capped")
        let day4 = try daily(-3)
        XCTAssertEqual(day4.newKeys.count, 20, "day 4: the usual rule (fills with new chars when nothing else can)")
        XCTAssertEqual(Mix.newUserCapOf(statsOf(dayIndex: 3), ramp: policy["newUserRamp"], size: 30, mix: mix), 12)
        XCTAssertEqual(Mix.newUserCapOf(statsOf(dayIndex: 4), ramp: policy["newUserRamp"], size: 30, mix: mix), .infinity)
        XCTAssertEqual(Mix.newUserCapOf(statsOf(dayIndex: 1), ramp: .null, size: 20, mix: mix), .infinity)
    }
}
