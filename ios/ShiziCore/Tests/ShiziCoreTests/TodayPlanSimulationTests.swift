import Foundation
import XCTest
@testable import ShiziCore

// S2 调度规则 v2（D83）带种子的多日模拟：真 Store + 真题库 + App 的同一条写入路径，随机写对 / 写错 / 看答案 / 跳过、
// 中途结束、自选、再来一组，逐日核对不变量：
//   ① 这一份的字数（≤ 每组字数；题库够时 = 每组字数）
//   ② 比例（新字 / 复习按档位配，与 TodayPlan.compose 一致；热身字复习只会让新字更多）
//   ③ 至少 1 个新字（有新字可排、不是「只复习」时）
//   ④ 一个字一组里最多考 3 次
//   ⑤ 复习日期只看当天第一次（每天每个字 FSRS 至多前进一步；第一次错或看答案 → 明天到期）
//   ⑥ 完成条件（今天的练习写完、重考都结束才算完成；还有重考时不算）
//   ⑦ 到期字跨天不丢（当天没写到的到期字，调度项原样留着，第二天照样到期）

private struct SeededRandom {
    var state: UInt64
    init(_ seed: UInt64) { state = seed &* 6364136223846793005 &+ 1442695040888963407 }
    mutating func next() -> Double {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return Double(state >> 11) / Double(1 << 53)
    }
    mutating func int(_ n: Int) -> Int { min(n - 1, Int(next() * Double(n))) }
}

final class TodayPlanSimulationTests: XCTestCase {
    func testSeededDaysKeepTheInvariants() throws {
        let configs: [(seed: UInt64, size: Double, tier: String, days: Int)] = [
            (1, 15, "balanced", 30), (2, 10, "more", 24), (3, 5, "review", 30), (4, 20, "only", 18), (5, 15, "balanced", 40),
        ]
        var checked = 0
        for c in configs { checked += try simulate(seed: c.seed, size: c.size, tier: c.tier, days: c.days) }
        XCTAssertGreaterThan(checked, 500, "enough first attempts were checked")
    }

    /// 返回核对过的「第一次」个数。
    func simulate(seed: UInt64, size sizeD: Double, tier: String, days: Int) throws -> Int {
        var rnd = SeededRandom(seed)
        let h = PlanHarness.make(settings: [("groupSize", .number(sizeD)), ("mixTier", .string(tier))])
        let size = Int(sizeD), ratio = TodayPlan.ratio(tier), maxAttempts = TodayPlan.maxAttempts()
        let label = "seed \(seed) size \(size) \(tier)"
        try h.finishFirst()
        let library = DeckIndex.shared.newOrder(.string(DeckIndex.shared.defaultLibraryId))
        var checked = 0

        for d in 0..<days {
            h.nextDay()
            let day = h.day
            let tomorrow = try shanghai.addDays(day, 1)
            let schedAtStart = h.store.state["sched"]?.objectValue ?? JSObject()
            let dueAtStart = Set(schedAtStart.entries.compactMap { e -> String? in
                guard e.value["stoppedAt"] == nil, let od = try? h.rules.overdueDays(e.value, day), od >= 0 else { return nil }
                return e.key
            })
            var firstOutcome: [String: String] = [:] // 今天每个字的第一次：correct / wrong / skipped

            func act(_ slot: String) {
                guard let key = h.current(slot), let s = h.session(slot) else { return }
                let first = TodayPlan.attempts(s, .string(key)) == 0 && firstOutcome[key] == nil
                let roll = rnd.next()
                if roll < 0.65 {
                    h.judge("correct", slot: slot); if first { firstOutcome[key] = "correct" }
                } else if roll < 0.85 {
                    h.judge("wrong", slot: slot); if first { firstOutcome[key] = "wrong" }
                } else if roll < 0.93 {
                    h.seeAnswer(slot: slot); if first { firstOutcome[key] = "wrong" }
                } else {
                    h.skip(slot: slot); if first { firstOutcome[key] = "skipped" }
                }
            }
            func runPicked(_ n: Int) throws {
                let start = 900 + rnd.int(400)
                let keys = library[start..<(start + n)].map { String($0.dropFirst(5)) }
                try h.startPicked(keys)
                while h.current("B") != nil { act("B") }
            }
            func checkPlan(_ r: JSValue, handledBefore: Int) throws {
                guard r["started"] == .bool(true), r["extra"] != .bool(true), r["kind"] == .string("daily") else { return }
                if JS.truthy(r["plan"]?["special"]) { return } // 大写数字特别组整组出（D40），不按比例
                let q = (h.session()!["queue"]!.arrayValue ?? []).compactMap { $0.stringValue }
                XCTAssertEqual(Set(q).count, q.count, "\(label) \(day): no repeats at creation")
                let newCount = q.filter { schedAtStart[$0].map { !JS.truthy($0) } ?? true }.count
                let revCount = q.count - newCount
                let target = try XCTUnwrap(h.today.target, "\(label) \(day)")
                // ① 字数
                XCTAssertLessThanOrEqual(target, size, "\(label) \(day): plan size")
                XCTAssertLessThanOrEqual(q.count, target - handledBefore, "\(label) \(day): the rest of the plan")
                if ratio.num > 0 { XCTAssertEqual(q.count, target - handledBefore, "\(label) \(day): plenty of new chars → the whole rest") }
                // ② 比例（复习字都是今天到期、今天还没写过的字）
                let dueNow = dueAtStart.subtracting(firstOutcome.keys).count
                XCTAssertTrue(q.filter { schedAtStart[$0].map { JS.truthy($0) } ?? false }.allSatisfy { dueAtStart.contains($0) }, "\(label) \(day): reviews are due chars")
                let want = TodayPlan.shrink(TodayPlan.compose(size: size, due: dueNow, pool: 10_000, ratio: ratio), to: target - handledBefore)
                if handledBefore == 0 { XCTAssertEqual(target, want.total, "\(label) \(day): plenty of new chars → the full mix") }
                XCTAssertEqual(revCount + newCount, want.total, "\(label) \(day): total")
                XCTAssertLessThanOrEqual(revCount, want.rev, "\(label) \(day): reviews ≤ share")
                XCTAssertGreaterThanOrEqual(newCount, want.new, "\(label) \(day): new ≥ share")
                // ③ 至少 1 个新字
                if ratio.num > 0 && handledBefore == 0 { XCTAssertGreaterThanOrEqual(newCount, 1, "\(label) \(day): at least one new char") }
                if ratio.num == 0 { XCTAssertEqual(newCount, 0, "\(label) \(day): review only") }
            }

            if rnd.next() < 0.2 { try runPicked(1 + rnd.int(size)) }
            var handled = h.today.handled.count
            if !h.today.done || h.today.target == nil {
                let r = try h.startA()
                try checkPlan(r, handledBefore: handled)
            }
            var restarts = 0
            while let s = h.session(), TodayPlan.isPlan(s), h.current() != nil {
                // ⑥ 还有字没写 / 重考没结束：不算完成
                XCTAssertFalse(h.today.done, "\(label) \(day): not done while the plan has items left")
                act("A")
                if rnd.next() < 0.04 && restarts < 2, let s = h.session(), !SessionRules.isComplete(s) {
                    restarts += 1
                    _ = WriteAPI.call("end", h.store, JSObject([("slot", .string("A")), ("sessionId", s["id"]!)]))
                    if rnd.next() < 0.5 { try runPicked(1 + rnd.int(3)) }
                    handled = h.today.handled.count
                    if !h.today.done {
                        let r = try h.startA()
                        try checkPlan(r, handledBefore: handled)
                    }
                } else if rnd.next() < 0.05, let s = h.session(), !SessionRules.isComplete(s) {
                    try runPicked(1 + rnd.int(2)) // 写到一半去自选：今天的练习少排
                }
            }
            // ⑥ 写完 = 完成
            XCTAssertTrue(try h.progress().done, "\(label) \(day): done once the plan is written and the retries are over")
            if h.today.target != nil { XCTAssertEqual(h.today.done, true, "\(label) \(day): the day's account says done") }
            // ④ 重考 ≤ 3
            for s in [h.session("A"), h.session("B"), h.store.state["sessions"]?["lastEnded"]?["A"], h.store.state["sessions"]?["lastEnded"]?["B"]].compactMap({ $0 }) where JS.truthy(s) {
                for k in Set((s["queue"]?.arrayValue ?? []).compactMap { $0.stringValue }) {
                    XCTAssertLessThanOrEqual(TodayPlan.attempts(s, .string(k)), maxAttempts, "\(label) \(day): retries")
                }
            }
            // 再来一组
            if rnd.next() < 0.15 {
                let r = try h.startA()
                if r["started"] == .bool(true) {
                    XCTAssertEqual(r["extra"], .bool(true), "\(label) \(day): after done it is an extra group")
                    XCTAssertLessThanOrEqual(h.session()!["queue"]!.arrayValue!.count, size)
                    while h.current() != nil { act("A") }
                    XCTAssertTrue(try h.progress().done)
                }
            }
            // ⑤ 复习日期只看第一次
            for (key, outcome) in firstOutcome where outcome != "skipped" {
                let after = try XCTUnwrap(h.sched(key), "\(label) \(day): \(key) has a schedule")
                let before = schedAtStart[key]
                let repsBefore = JS.numberOr0(before?["fsrs"]?["reps"]), repsAfter = JS.numberOr0(after["fsrs"]?["reps"])
                XCTAssertLessThanOrEqual(repsAfter - repsBefore, 1, "\(label) \(day): \(key) one FSRS step a day")
                if outcome == "wrong" {
                    // 第一次错 / 看答案 = 明天再来（新字、复习字都是）；复习字照记一次 Again（遗忘数 +1）
                    XCTAssertEqual(after["due"], .string(tomorrow), "\(label) \(day): \(key) first attempt wrong → due day + 1")
                    if repsBefore > 0 {
                        XCTAssertEqual(JS.numberOr0(after["fsrs"]?["lapses"]), JS.numberOr0(before?["fsrs"]?["lapses"]) + 1, "\(label) \(day): \(key) first attempt wrong → Again")
                    }
                }
                if outcome == "correct" { XCTAssertNotEqual(after["due"], .string(day), "\(label) \(day): \(key) first attempt correct → later") }
                checked += 1
            }
            // ⑦ 到期字不丢
            for key in dueAtStart where firstOutcome[key] == nil {
                XCTAssertEqual(h.sched(key), schedAtStart[key], "\(label) \(day): an unwritten due char keeps its schedule")
                XCTAssertGreaterThanOrEqual(try h.rules.overdueDays(h.sched(key), tomorrow) ?? -1, 0, "\(label) \(day): still due tomorrow")
            }
            _ = d
        }
        return checked
    }
}
