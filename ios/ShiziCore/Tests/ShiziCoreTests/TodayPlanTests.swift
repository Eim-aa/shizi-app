import Foundation
import XCTest
@testable import ShiziCore

// S2 调度规则 v2「一天的练习」（D83；docs/product/调度规则v2-一天的练习.md）的逐条规则测试。D82 起这些规则不再与 JS 对照，
// 这里与 TodayPlanSimulationTests（带种子的多日模拟 + 不变量）就是它们的参考。

final class TodayPlanTests: XCTestCase {
    let rules = ScheduleRules(dates: shanghai)
    let policy = Config.policy
    func ratio(_ tier: String) -> (num: Int, den: Int) { TodayPlan.ratio(tier) }

    // MARK: 一、配比（规则文档一「怎么配」与档位表）

    func testNewShareIsRoundedWithHalvesGoingToReviews() {
        XCTAssertEqual(TodayPlan.newShare(size: 15, ratio: ratio("balanced")), 7, "15 × 1/2 ≈ 7 新、8 复习")
        XCTAssertEqual(TodayPlan.newShare(size: 15, ratio: ratio("more")), 10)
        XCTAssertEqual(TodayPlan.newShare(size: 15, ratio: ratio("review")), 5)
        XCTAssertEqual(TodayPlan.newShare(size: 15, ratio: ratio("only")), 0)
        XCTAssertEqual(TodayPlan.newShare(size: 5, ratio: ratio("balanced")), 2)
        XCTAssertEqual(TodayPlan.newShare(size: 10, ratio: ratio("more")), 7, "6.67 → 7")
        XCTAssertEqual(TodayPlan.newShare(size: 20, ratio: ratio("review")), 7, "6.67 → 7")
        XCTAssertEqual(TodayPlan.newShare(size: 30, ratio: ratio("balanced")), 15)
        XCTAssertEqual(TodayPlan.tierOf(nil), "balanced", "负责人：默认均衡")
        XCTAssertEqual(TodayPlan.tierIds(), ["more", "balanced", "review", "only"])
    }

    func testComposeFollowsTheFourStepsOfTheSpecTable() {
        let big = 1000
        func mix(_ due: Int, pool: Int = big, size: Int = 15, tier: String = "balanced") -> [Int] {
            let m = TodayPlan.compose(size: size, due: due, pool: pool, ratio: ratio(tier))
            return [m.rev, m.new]
        }
        XCTAssertEqual(mix(8), [8, 7], "① 定份额")
        XCTAssertEqual(mix(12), [8, 7], "到期 12 个，比 8 多：先取 8 个（规则文档五的例子）")
        XCTAssertEqual(mix(3), [3, 12], "② 复习字不够：新字补满")
        XCTAssertEqual(mix(0), [0, 15], "没有到期字：全是新字")
        XCTAssertEqual(mix(40), [14, 1], "③ 复习字太多：新字让位，但至少留 1 个")
        XCTAssertEqual(mix(15), [14, 1], "到期 ≥ 每组字数就算太多")
        XCTAssertEqual(mix(5, pool: 0), [5, 0], "④ 字库学完、到期 5 个 → 今天 5 个字")
        XCTAssertEqual(mix(10, pool: 2), [10, 2], "④ 新字不够：复习补")
        XCTAssertEqual(mix(0, pool: 4), [0, 4], "都不够：今天的练习就少几个字")
        XCTAssertEqual(mix(8, tier: "more"), [5, 10], "多学新字 10 新 + 5 复习")
        XCTAssertEqual(mix(20, tier: "review"), [14, 1], "巩固为主也让位到 1 个")
        XCTAssertEqual(mix(12, tier: "review"), [10, 5], "巩固为主 5 新 + 10 复习")
        XCTAssertEqual(mix(40, tier: "only"), [15, 0], "只复习：全是复习")
        XCTAssertEqual(mix(3, tier: "only"), [3, 0], "只复习、到期不够：不补新字")
        // 少排（自选写过的字）：先少排新字，再少排复习字
        let m = TodayPlan.compose(size: 15, due: 12, pool: big, ratio: ratio("balanced"))
        XCTAssertEqual(TodayPlan.shrink(m, to: 10), TodayPlan.Mix(rev: 8, new: 2))
        XCTAssertEqual(TodayPlan.shrink(m, to: 6), TodayPlan.Mix(rev: 6, new: 0))
        XCTAssertEqual(TodayPlan.shrink(m, to: 0), TodayPlan.Mix(rev: 0, new: 0))
        XCTAssertEqual(TodayPlan.shrink(m, to: 20), m)
    }

    // MARK: 一、挑哪些字

    func testReviewsLastWrongFirstThenLowestRetrievabilityNewCharsCustomFirstThenLibraryOrder() throws {
        let today = "2026-10-02"
        let a = "base:\u{51FD}", b = "base:\u{6D85}", c = "base:\u{7FB9}", d = "base:\u{9B31}" // 函 涅 羹 鬱
        // a：很久以前学的、早就到期（回忆概率最低）；b：前几天学的、今天到期；c：上次写错；d：还没到期
        let sched = JS.obj([
            (a, try realEntry(a, judgedOn: "2026-07-01", due: "2026-07-05")),
            (b, try realEntry(b, judgedOn: "2026-09-29", due: today)),
            (c, try realEntry(c, judgedOn: "2026-09-30", judgment: "wrong", due: "2026-10-01")),
            (d, try realEntry(d, judgedOn: "2026-09-30", due: "2026-10-20")),
        ])
        func rec(_ id: Int, _ key: String, _ day: String, _ j: String) -> JSValue {
            JS.obj([("id", .string("r\(id)")), ("cardKey", .string(key)), ("sessionId", .string("s1")), ("kind", .string("judged")), ("judgment", .string(j)), ("at", .number(0)), ("localDay", .string(day))])
        }
        let records = [rec(1, a, "2026-07-01", "correct"), rec(2, b, "2026-09-29", "correct"), rec(3, c, "2026-09-30", "wrong"), rec(4, d, "2026-09-30", "correct")]
        let custom = JS.obj([("added", .array([JS.obj([("char", .string("\u{8695}")), ("at", .number(0))])]))]) // 蚕
        let lib = ["base:\u{4E2A}", "base:\u{4EEC}", "base:\u{6211}", "base:\u{4ED6}"]
        let r = try rules.selectDaily(sched: sched, records: records, today: today, newCandidates: lib, custom: custom, groupSize: .number(5))
        XCTAssertEqual(r.dueKeys, [c, a, b], "上次写错的最前，其余回忆概率从低到高；没到期的不排")
        XCTAssertEqual(r.newKeys.first, "base:\u{8695}", "自己加的字作新字优先")
        XCTAssertEqual(r.queue.count, 5)
        XCTAssertEqual(r.queue.first, c, "第一个字是复习字")
        XCTAssertTrue(r.dueKeys.contains(r.queue.last!), "最后一个字不是新字")
        // 今天已经写过的（handled）不再排；cap 让这一份少排
        let capped = try rules.selectDaily(sched: sched, records: records, today: today, newCandidates: lib, custom: custom, groupSize: .number(5), cap: 3, handled: [c])
        XCTAssertFalse(capped.queue.contains(c))
        XCTAssertEqual(capped.queue.count, 3)
        XCTAssertEqual(capped.dueKeys, [a, b], "先少排新字")
    }

    // MARK: 一、今天的练习 = 一组，第一次开始时定下

    func testTodaysPracticeIsOneGroupSizedByTheSettingAndFixedForTheDay() throws {
        let h = PlanHarness.make()
        try h.finishFirst()
        XCTAssertTrue(h.today.done, "首练那一组就是第一天的练习")
        h.nextDay()
        XCTAssertEqual(try h.progress(), TodayPlan.Progress(n: 0, total: 15, done: false, active: false), "首页：今天的练习 0 / 15")
        let r = try h.startA()
        XCTAssertEqual(r["extra"], .bool(false))
        let q = h.session()!["queue"]!.arrayValue!
        XCTAssertEqual(q.count, 15, "缺省每组 15 个字")
        XCTAssertEqual(h.today.target, 15, "这一份几个字第一次开始时定下")
        for _ in 0..<5 { h.judge("correct") }
        XCTAssertEqual(try h.progress().n, 5)
        // 中途改每组字数：今天这一份不变
        _ = h.store.commit("test:size") { d, _ in d["settings"] = SessionWrites.patch(d["settings"], [("groupSize", .number(30))]) }
        let end = WriteAPI.call("end", h.store, JSObject([("slot", .string("A")), ("sessionId", h.session()!["id"]!)]))
        XCTAssertEqual(end["ok"], .bool(true))
        XCTAssertEqual(try h.progress(), TodayPlan.Progress(n: 5, total: 15, done: false, active: false), "结束这组：今天还没完成")
        try h.startA()
        XCTAssertEqual(h.session()!["queue"]!.arrayValue!.count, 10, "再开：只排这一份剩下的 10 个")
        XCTAssertEqual(h.today.target, 15)
    }

    func testAnUnfinishedPlanIsReplacedAfterFourAmAndItsReviewsStayDue() throws {
        let h = PlanHarness.make()
        try h.finishFirst()
        h.nextDay(4) // 首练的三个字（Easy）还没到期
        try h.startA()
        let queue = h.session()!["queue"]!.arrayValue!.compactMap { $0.stringValue }
        h.judge("correct")
        let untouched = queue.dropFirst().filter { h.sched($0) != nil }
        let before = Dictionary(uniqueKeysWithValues: untouched.map { ($0, h.sched($0)!) })
        h.nextDay()
        XCTAssertEqual(try h.progress().n, 0, "新的一天：进度从 0 开始，没有惩罚")
        try h.startA()
        XCTAssertNotEqual(h.session()!["startedDay"], .string("2026-10-06"), "昨天没写完的那份直接换掉")
        for (k, e) in before { XCTAssertEqual(h.sched(k), e, "没写的复习字不动，照样到期") }
    }

    // MARK: 二、写错当天重考

    func testAWrongCharComesBackThreeCharsLaterAndAfterTheThirdFailItIsTomorrow() throws {
        let h = PlanHarness.make()
        try h.finishFirst()
        h.nextDay(5)
        try h.startA()
        let key = h.current()!
        let recordsBefore = h.records.count
        h.judge("wrong")
        var q = h.session()!["queue"]!.arrayValue!
        XCTAssertEqual(q.count, 16, "插回一次")
        XCTAssertEqual(q[4], .string(key), "隔 3 个字（第 2、3、4 个之后）再出现")
        let afterFirst = h.sched(key)
        XCTAssertEqual(h.records.count, recordsBefore + 1, "第一次写一条记录")
        for _ in 0..<3 { h.judge("correct") }
        XCTAssertEqual(h.current(), key)
        h.judge("wrong") // 第 2 次
        q = h.session()!["queue"]!.arrayValue!
        XCTAssertEqual(q[8], .string(key), "又隔 3 个字")
        for _ in 0..<3 { h.judge("correct") }
        XCTAssertEqual(h.current(), key)
        h.seeAnswer() // 第 3 次：看了答案 = 还错
        let s = h.session()!
        XCTAssertEqual(TodayPlan.attempts(s, .string(key)), 3)
        XCTAssertEqual(s["queue"]!.arrayValue!.filter { $0 == .string(key) }.count, 3, "最多考 3 次，不再插回")
        XCTAssertEqual(h.sched(key), afterFirst, "重考不动复习日期")
        XCTAssertEqual(h.records.filter { $0["cardKey"] == .string(key) && $0["localDay"] == .string(h.day) }.count, 1, "重考不写记录")
        XCTAssertEqual(afterFirst?["due"], .string(try shanghai.addDays(h.day, 1)), "第一次写错：明天再来")
        while h.current() != nil { h.judge("correct") }
        let sum = TodayPlan.summary(h.store.state["sessions"]?["lastEnded"]?["A"] ?? h.session(), records: h.records)
        XCTAssertEqual(sum.again, 1, "第 3 次还错：明天再来")
        XCTAssertEqual(sum.correct, 14)
        XCTAssertEqual(sum.passed, 0)
    }

    func testARetryNearTheEndGoesLastAndARetryPassedOnceIsRetakenPassed() throws {
        let h = PlanHarness.make(settings: [("groupSize", .number(5))])
        try h.finishFirst()
        h.nextDay(5)
        try h.startA()
        for _ in 0..<3 { h.judge("correct") }
        let key = h.current()! // 第 4 个字，后面只剩 1 个
        h.judge("wrong")
        let q = h.session()!["queue"]!.arrayValue!
        XCTAssertEqual(q.last, .string(key), "后面不够 3 个字：放到最后")
        XCTAssertEqual(q.count, 6)
        h.judge("correct")
        XCTAssertEqual(h.current(), key)
        XCTAssertFalse(h.today.done, "重考还没结束：没完成")
        h.judge("correct")
        XCTAssertNil(h.current())
        XCTAssertTrue(h.today.done, "每个字都写过第一次、重考都结束：完成")
        let sum = TodayPlan.summary(h.session() ?? h.store.state["sessions"]?["lastEnded"]?["A"], records: h.records)
        XCTAssertEqual([sum.correct, sum.passed, sum.again], [4, 1, 0])
        XCTAssertEqual(h.sched(key)?["due"], .string(try shanghai.addDays(h.day, 1)), "重考写对不改变复习日期（仍按第一次的错）")
    }

    func testOnlyTheFirstAttemptOfTheDayRatesEvenAcrossGroups() throws {
        let h = PlanHarness.make()
        try h.finishFirst()
        h.nextDay(5)
        try h.startA()
        let key = h.current()!
        h.judge("wrong")
        let entry = h.sched(key)
        // 同一天在自选里再写这个字（对）：复习日期不变
        let end = WriteAPI.call("end", h.store, JSObject([("slot", .string("A")), ("sessionId", h.session()!["id"]!)]))
        XCTAssertEqual(end["ok"], .bool(true))
        try h.startPicked([String(key.dropFirst(5))])
        h.judge("correct", slot: "B")
        XCTAssertEqual(h.sched(key)?["fsrs"], entry?["fsrs"])
        XCTAssertEqual(h.sched(key)?["due"], entry?["due"])
    }

    /// 规则文档三：写错 / 看了答案 → 明天再来。复习字照记 Again（稳定度、难度、遗忘数照 FSRS），到期日夹到第二天、不错开。
    func testAWrongOrSeenReviewCharComesBackTomorrow() throws {
        let day = "2026-10-02", tomorrow = "2026-10-03"
        let key = "base:\u{51FD}"
        // 一个成熟的复习字：间隔几个月
        var entry = try realEntry(key, judgedOn: "2026-05-01", due: day)
        for d in ["2026-05-05", "2026-05-20", "2026-07-01"] {
            let p = d.split(separator: "-").map { Int($0)! }
            let r = JS.obj([("id", .string("r1")), ("cardKey", .string(key)), ("sessionId", .string("s1")), ("kind", .string("judged")), ("judgment", .string("correct")),
                            ("at", .number(JSDate.makeLocal(p[0], p[1] - 1, p[2], hours: 12, shanghaiTZ)!)), ("localDay", .string(d)),
                            ("help", JS.obj([("hints", .number(0)), ("answerSeen", .bool(false)), ("traced", .bool(false))]))])
            entry = try rules.applyJudgment(entry, r).entry
        }
        entry = JS.with(entry, [("due", .string(day))])
        let at = JSDate.makeLocal(2026, 9, 2, hours: 20, shanghaiTZ)!
        func rec(_ kind: String, _ judgment: String?) -> JSValue {
            var o = JSObject([("id", .string("r9")), ("cardKey", .string(key)), ("sessionId", .string("s2")), ("kind", .string(kind)), ("at", .number(at)), ("localDay", .string(day)),
                              ("help", JS.obj([("hints", .number(0)), ("answerSeen", .bool(kind == "answer-seen")), ("traced", .bool(false))]))])
            if let j = judgment { o["judgment"] = .string(j) }
            return .object(o)
        }
        let wrong = try rules.applyJudgment(entry, rec("judged", "wrong")).entry
        XCTAssertEqual(wrong["due"], .string(tomorrow), "写错：明天再来")
        XCTAssertEqual(JS.numberOr0(wrong["fsrs"]?["lapses"]), JS.numberOr0(entry["fsrs"]?["lapses"]) + 1, "照记一次 Again")
        let seen = try XCTUnwrap(rules.applyAnswerSeen(entry, rec("answer-seen", nil)).entry)
        XCTAssertEqual(seen["due"], .string(tomorrow), "看了答案：明天再来")
        XCTAssertEqual(seen["fsrs"], wrong["fsrs"], "与写错同一步 FSRS")
        let ok = try rules.applyJudgment(entry, rec("judged", "correct")).entry
        XCTAssertGreaterThan(try shanghai.diffDays(.string(day), ok["due"]!), 7, "写对照 FSRS 拉长")
        // 改判重放同一规则
        let (_, before) = try rules.applyJudgment(entry, rec("judged", "wrong"))
        XCTAssertEqual(try rules.replay(before, [rec("judged", "wrong")])?["due"], .string(tomorrow))
    }

    func testSkipsAreNotRetriedNewCharsComeBackIn7DaysReviewsTomorrow() throws {
        let h = PlanHarness.make(settings: [("groupSize", .number(5))])
        try h.finishFirst()
        h.nextDay(5)
        try h.startA()
        let newKey = h.current()!
        XCTAssertNil(h.sched(newKey))
        let r = h.skip()
        XCTAssertNotEqual(r["undo"], .null, "第一次跳过可以撤销")
        XCTAssertFalse(h.session()!["queue"]!.arrayValue!.dropFirst().contains(.string(newKey)), "跳过的字不重考")
        XCTAssertTrue(h.today.handled.contains(newKey), "跳过也算处理完")
        let deferred = try rules.skipDeferredNewKeys(h.records, try shanghai.addDays(h.day, 6))
        XCTAssertTrue(deferred.contains(newKey), "新字 7 天后再排")
        XCTAssertFalse(try rules.skipDeferredNewKeys(h.records, try shanghai.addDays(h.day, 7)).contains(newKey))
        // 重考时跳过：不写记录、没有撤销、不再重考
        let wrongKey = h.current()!
        h.judge("wrong")
        while h.current() != wrongKey { h.judge("correct") }
        let n = h.records.count
        let s = h.skip()
        XCTAssertEqual(s["undo"], .null)
        XCTAssertEqual(h.records.count, n)
        while h.current() != nil { h.judge("correct") }
        XCTAssertTrue(h.today.done)
    }

    func testUndoingTheLastSkipTakesTheDoneBack() throws {
        let h = PlanHarness.make(settings: [("groupSize", .number(5))])
        try h.finishFirst()
        h.nextDay(5)
        try h.startA()
        for _ in 0..<4 { h.judge("correct") }
        let r = h.skip()
        XCTAssertTrue(h.today.done, "跳过也算处理完：完成")
        let undo = try XCTUnwrap(r["undo"]?.objectValue)
        let back = SessionResults.undoSkip(h.store, JSObject([("slot", .string("A")), ("sessionId", undo["sessionId"]!), ("recordId", undo["recordId"]!)]))
        XCTAssertEqual(back["ok"], .bool(true), str(back))
        XCTAssertFalse(h.today.done, "撤销跳过：今天的练习又没写完")
        XCTAssertEqual(h.today.handled.count, 4)
        XCTAssertNotNil(h.current())
        h.judge("correct")
        XCTAssertTrue(h.today.done)
    }

    // MARK: 四、终点：今天完成了 / 再来一组

    func testDoneShowsTodayCompleteAndAnotherGroupIsExtraWithTheSameSizeAllNewWhenNothingIsDue() throws {
        let h = PlanHarness.make(settings: [("groupSize", .number(10))])
        try h.finishFirst()
        h.nextDay(5)
        try h.startA()
        h.judge("wrong")
        while h.current() != nil { h.judge("correct") }
        XCTAssertTrue(h.today.done)
        let m = try h.home()
        XCTAssertEqual(m["view"], .string("today"))
        XCTAssertEqual(HomeView.homeCtaKey(m), "X-RESULT.again")
        XCTAssertEqual(HomeView.homeNoteOf(m)["key"], .string("X-TODAY.done"))
        XCTAssertEqual(try Copy.text("X-RESULT.again"), "再来一组")
        // 结果页：今天完成了 + 汇总句
        let sid = h.store.state["sessions"]?["lastEnded"]?["A"]?["id"] ?? h.session()!["id"]!
        let model = try ResultModels.model(h.store.state, JSObject([("slot", .string("A")), ("sessionId", sid)]), dates: shanghai)
        XCTAssertEqual(model["title"], .string("今天完成了"))
        let fresh = TodayPlan.summary(SessionResults.locate(h.store.state, JSObject([("slot", .string("A")), ("sessionId", sid)]))?.session, records: h.records)
        XCTAssertEqual(fresh.fresh, 10, "10 个都是新学的字")
        XCTAssertEqual(model["sub"], .array([.string("写对 9、重考过关 1、明天再来 0、新学 10 个字")]))
        // 再来一组
        let r = try h.startA()
        XCTAssertEqual(r["extra"], .bool(true))
        XCTAssertEqual(h.session()!["extra"], .bool(true))
        XCTAssertEqual(h.session()!["queue"]!.arrayValue!.count, 10, "同样的字数")
        XCTAssertTrue(h.session()!["queue"]!.arrayValue!.allSatisfy { h.sched($0.stringValue!) == nil }, "没有到期字时全是新字")
        h.judge("correct")
        XCTAssertTrue(h.today.done, "再来一组不改变「今天完成了」")
        let mid = try h.home()
        XCTAssertEqual(mid["view"], .string("progress"))
        XCTAssertEqual(HomeView.homeNoteOf(mid)["key"], .string("X-TODAY.done"))
        XCTAssertEqual(mid["primary"]?["done"], .number(1), "额外组的进度按这一组算")
        XCTAssertEqual(mid["primary"]?["total"], .number(10))
    }

    // MARK: 自选计入今天的进度

    func testPickedPracticeCountsTowardTodayAndThePlanShrinksNewFirst() throws {
        let h = PlanHarness.make(settings: [("groupSize", .number(10))])
        try h.finishFirst()
        h.nextDay(5)
        // 开始今天的练习之前先自选写 3 个字
        try h.startPicked(pickChars(3))
        h.judge("correct", slot: "B"); h.judge("wrong", slot: "B"); h.seeAnswer(slot: "B")
        XCTAssertEqual(h.today.handled.count, 3, "自选里写过 / 看过答案的字（只算第一次）")
        XCTAssertEqual(try h.progress(), TodayPlan.Progress(n: 3, total: 10, done: false, active: false), "今天的练习 3 / 10")
        while h.current("B") != nil { h.judge("correct", slot: "B") }
        try h.startA()
        XCTAssertEqual(Set(h.session()!["queue"]!.arrayValue!.compactMap { $0.stringValue }).count, 7, "今天的练习相应少排")
        XCTAssertEqual(h.today.target, 10)
        // 今天的练习写到一半，又去自选写 2 个字：今天的练习少排 2 个（先少排新字）
        h.judge("correct")
        let pending = Set(h.session()!["queue"]!.arrayValue!.dropFirst(1).compactMap { $0.stringValue })
        try h.startPicked(pickChars(2, from: 700))
        h.judge("correct", slot: "B"); h.judge("correct", slot: "B")
        let after = Set(h.session()!["queue"]!.arrayValue!.dropFirst(1).compactMap { $0.stringValue })
        XCTAssertEqual(pending.count - after.count, 2)
        XCTAssertEqual(try h.progress().total, 10)
        while h.current() != nil { h.judge("correct") }
        XCTAssertTrue(h.today.done)
        XCTAssertEqual(h.today.handled.count, 10)
    }

    func testAFullGroupOfPickedPracticeCompletesToday() throws {
        let h = PlanHarness.make(settings: [("groupSize", .number(5))])
        try h.finishFirst()
        h.nextDay(5)
        try h.startPicked(pickChars(5))
        for _ in 0..<4 { h.judge("correct", slot: "B") }
        XCTAssertFalse(try h.progress().done)
        h.judge("correct", slot: "B")
        XCTAssertTrue(try h.progress().done, "自选写满一组，今天的练习也就完成了")
        XCTAssertEqual(try h.home()["view"], .string("today"))
        let r = try h.startA()
        XCTAssertEqual(r["extra"], .bool(true), "之后再开的是再来一组")
    }

    // MARK: 改判（写字页「修改 ›」）

    func testCorrectingAWrongJudgmentToCorrectDropsThePendingRetry() throws {
        let h = PlanHarness.make()
        try h.finishFirst()
        h.nextDay(5)
        try h.startA()
        let key = h.current()!
        let judged = h.judge("wrong")
        XCTAssertEqual(h.session()!["queue"]!.arrayValue!.filter { $0 == .string(key) }.count, 2)
        let fix = WriteAPI.call("correct", h.store, JSObject([("slot", .string("A")), ("recordId", judged["recordId"]!), ("to", .string("correct"))]))
        XCTAssertEqual(fix["ok"], .bool(true), str(fix))
        XCTAssertEqual(h.session()!["queue"]!.arrayValue!.filter { $0 == .string(key) }.count, 1, "改成写对：不再重考")
        // 对 → 错：再插回去
        let second = h.session()!["lastLine"]
        XCTAssertEqual(second?["kind"], .string("changed"))
    }

    // MARK: 设置：新字比例档位

    func testTheTierSettingIsValidatedStoredAndChangesTheMix() throws {
        let h = PlanHarness.make()
        let bad = PageAPI.call("mine.mixTier", store: h.store, args: JSObject([("value", .string("lots"))]))
        XCTAssertEqual(bad["ok"], .bool(false))
        let ok = PageAPI.call("mine.mixTier", store: h.store, args: JSObject([("value", .string("more"))]))
        XCTAssertEqual(ok["ok"], .bool(true), str(ok))
        XCTAssertEqual(h.store.state["settings"]?["mixTier"], .string("more"))
        let key = try XCTUnwrap(Schema.keyNamed("settings"))
        XCTAssertNil(Schema.validateValue(key: key, value: JS.obj([("mixTier", .string("only"))])))
        XCTAssertNotNil(Schema.validateValue(key: key, value: JS.obj([("mixTier", .string("half"))])))
        let choices = MinePageView.mineChoices(SettingsView.settingsView(h.store.state["settings"]), policy: policy, settings: h.store.state["settings"])
        XCTAssertEqual(choices["mixTier"]?["value"], .string("more"))
        XCTAssertEqual(choices["mixTier"]?["options"]?.arrayValue?.count, 4)
        XCTAssertEqual(try Copy.text("X-SETTINGS.mixTier.review"), "巩固为主")
        try h.finishFirst()
        h.nextDay(5)
        let plan = try h.rules.planDaily(h.state, today: h.day, deck: h.deck)
        XCTAssertEqual(plan["tier"], .string("more"))
        XCTAssertEqual(plan["newKeys"]?.arrayValue?.count, 15, "首练的字还没到期：全是新字")
        XCTAssertEqual(plan["newShare"], .number(10))
    }

    // MARK: 首页

    func testHomeShowsTodaysProgressBeforeStarting() throws {
        let h = PlanHarness.make()
        try h.finishFirst()
        XCTAssertEqual(try h.home()["view"], .string("today"))
        h.nextDay()
        let m = try h.home()
        XCTAssertEqual(m["view"], .string("fresh"))
        XCTAssertEqual(HomeView.homeNoteOf(m), JS.obj([("key", .string("X-TODAY.progress")), ("vars", JS.obj([("n", .number(0)), ("total", .number(15))]))]))
        XCTAssertEqual(HomeView.homeCtaKey(m), "X-HOME.start")
        try h.startA()
        h.judge("correct")
        let mid = try h.home()
        XCTAssertEqual(mid["view"], .string("progress"))
        XCTAssertEqual(mid["primary"]?["done"], .number(1))
        XCTAssertEqual(mid["primary"]?["total"], .number(15))
        XCTAssertEqual(HomeView.homeNoteOf(mid), .null, "进度在按钮上，不重复")
    }

    // MARK: 不显示「下次见」

    func testNoNextTimeLine() throws {
        XCTAssertEqual(policy["features"]?["nextReviewLine"], .bool(false))
        let cells: [JSValue] = [JS.obj([("kind", .string("judged")), ("char", .string("\u{5C34}")), ("judgment", .string("correct"))])]
        let sched = JS.obj([("base:\u{5C34}", JS.obj([("due", .string("2026-10-09"))]))])
        let extras = try ResultModels.firstExtras(JSObject([("cells", .array(cells)), ("sched", sched), ("today", .string("2026-10-02")), ("work", .null), ("variant", .string("first"))]), dates: shanghai)
        XCTAssertEqual(extras["preview"], .string(""), "首练结果页不写「N 天后再见」")
    }
}
