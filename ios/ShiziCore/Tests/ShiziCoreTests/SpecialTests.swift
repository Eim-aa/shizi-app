import Foundation
import XCTest
@testable import ShiziCore

// D40「写写大写数字」特别组的转写（B4.2）：test/core/special.test.mjs（9）。
// 汉字一律用 \u{…} 转义。

private let tz = TimeZone(identifier: "Asia/Shanghai")!
private let rules = ScheduleRules(timeZone: tz)
private let TODAY = "2026-09-24"
private let policy = Config.policy

private func at(_ day: String, _ hour: Int = 12, _ minute: Int = 0) -> Double {
    let p = day.split(separator: "-").map { Int($0)! }
    return JSDate.makeLocal(p[0], p[1] - 1, p[2], hours: hour, tz)! + Double(minute) * 60_000
}

private func rec(_ serial: Int, _ char: String, _ kind: String, _ judgment: String?, _ day: String, sessionId: String = "s1") -> JSValue {
    var pairs: [(String, JSValue)] = [
        ("id", .string("r\(serial)")), ("cardKey", .string("base:" + char)), ("char", .string(char)), ("sessionId", .string(sessionId)),
        ("kind", .string(kind)), ("at", .number(at(day, 12, serial % 60))), ("localDay", .string(day)),
        ("help", JS.obj([("hints", .number(0)), ("answerSeen", .bool(kind == "answer-seen")), ("traced", .bool(false))])),
    ]
    if kind == "judged" { pairs.append(("judgment", judgment.map { .string($0) } ?? .null)) }
    return JS.obj(pairs)
}

private func K(_ s: String) -> [String] { s.unicodeScalars.map { "base:" + String($0) } }
private func S(_ s: String) -> JSValue { .string(s) }
private func addDays(_ day: String, _ n: Double) throws -> String { try rules.dates.addDays(day, n) }

private func sched(_ due: String, _ stability: Double = 5) -> JSValue {
    JS.obj([("fsrs", JS.obj([("stability", .number(stability))])), ("due", .string(due)), ("lastJudgedAt", .number(0))])
}

private let warmSet = KeySet(CharOrder.shared.warmup)
private func isWarm(_ key: String) -> Bool { warmSet.contains(String(key.unicodeScalars.dropFirst(5))) }
private func inChars(_ chars: String, _ key: String) -> Bool { chars.unicodeScalars.contains { String($0) == String(key.unicodeScalars.dropFirst(5)) } }

/// n 组历史（每组一个字，第 1 组是首练 尴 赢 拾 三字），到今天之前。
private func history(_ groups: Int, first: Bool = true) throws -> [JSValue] {
    var out: [JSValue] = []
    var id = 1
    if first {
        for c in K("\u{5C34}\u{8D62}\u{62FE}") {
            out.append(rec(id, String(c.unicodeScalars.dropFirst(5)), "judged", "correct", try addDays(TODAY, Double(-groups - 1)), sessionId: "s1"))
            id += 1
        }
    }
    if groups >= 2 {
        for g in 2...groups {
            out.append(rec(id, String(UnicodeScalar(0x6000 + g)!), "judged", "correct", try addDays(TODAY, Double(-(groups - g) - 1)), sessionId: "s\(g)"))
            id += 1
        }
    }
    return out
}

/// special.test.mjs 的 selectDaily 包装：5 字一组（policy 缺省 = 真实 policy）。
private func selectDaily(sched: JSValue = .object(JSObject()), records: [JSValue], today: String = TODAY, newCandidates: [String] = K("\u{4EA6}\u{9C9C}\u{5883}\u{989D}\u{6162}"),
                         policy: JSValue = Config.policy, practicable: ((String) -> Bool)? = nil) throws -> ScheduleRules.DailyPlan {
    if let p = practicable {
        return try rules.selectDaily(sched: sched, records: records, today: today, newCandidates: newCandidates, practicable: p, policy: policy, isWarm: isWarm, groupSize: .number(5))
    }
    return try rules.selectDaily(sched: sched, records: records, today: today, newCandidates: newCandidates, policy: policy, isWarm: isWarm, groupSize: .number(5))
}

private func runSp(_ records: [JSValue], sched: JSValue = .object(JSObject()), policy: JSValue = Config.policy, practicable: ((String) -> Bool)? = nil) throws -> ScheduleRules.DailyPlan {
    try selectDaily(sched: sched, records: records, newCandidates: K("\u{4EA6}\u{9C9C}\u{5883}\u{989D}"), policy: policy, practicable: practicable)
}

private func capitalPolicy(_ overrides: [(String, JSValue)]) -> JSValue {
    JS.with(policy, [("capitalNumerals", JS.with(policy["capitalNumerals"], overrides.map { ($0.0, Optional($0.1)) }))])
}

final class SpecialTests: XCTestCase {
    // test/core/special.test.mjs: special group: not before 10 groups; from the 10th group on (and p < 1.5) the daily group becomes 壹贰叁肆伍
    func testSpecialGroupNotBefore10GroupsFromThe10thGroupOnAndPLessThan1Point5TheDailyGroupBecomes() throws {
        XCTAssertNil(try runSp(try history(9)).special)
        XCTAssertFalse(try runSp(try history(9)).queue.contains { inChars("\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}", $0) })
        let r = try runSp(try history(10))
        XCTAssertEqual(r.special?.kind, "capital1")
        XCTAssertEqual(r.queue, K("\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}"))
        XCTAssertEqual(r.special?.keys, K("\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}"))
        XCTAssertEqual(r.queue.count, 5)
        XCTAssertEqual(try rules.specialPlan(sched: .object(JSObject()), records: try history(10), today: TODAY)?.kind, "capital1")
        XCTAssertNil(try rules.specialPlan(sched: .object(JSObject()), records: try history(9), today: TODAY))
    }

    // test/core/special.test.mjs: special group is a full group of 5 even as the first group after ≥ 7 days away (D48 ⑧ shortens only ordinary groups, P184)
    func testSpecialGroupIsAFullGroupOf5EvenAsTheFirstGroupAfter7DaysAwayD48N8ShortensOnlyOrdinaryGroupsP184() throws {
        let away = try history(10).map { r in JS.with(r, [("localDay", S(try addDays(r["localDay"]?.stringValue ?? "", -10)))]) }
        let r = try runSp(away)
        XCTAssertEqual(r.special?.kind, "capital1")
        XCTAssertEqual(r.queue, K("\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}"), "the capital-numeral set is never cut to 3")
    }

    // test/core/special.test.mjs: special group: only when p < 1.5; a heavy backlog postpones it
    func testSpecialGroupOnlyWhenPLessThan1Point5AHeavyBacklogPostponesIt() throws {
        let records = try history(10)
        // 6 个到期字 → p = 6 / 4 = 1.5：不触发；5 个 → 1.25：触发
        let dueChars = K("\u{5B50}\u{4E11}\u{5BC5}\u{536F}\u{8FB0}\u{5DF3}")
        let due = try addDays(TODAY, -2)
        func table(_ keys: [String]) -> JSValue { JS.obj(keys.map { ($0, sched(due)) }) }
        XCTAssertNil(try runSp(records, sched: table(dueChars)).special, "p = 1.5 \u{2192} not yet")
        let five = Array(dueChars.dropLast()) // delete schedTable['base:巳']
        XCTAssertEqual(try runSp(records, sched: table(five)).special?.kind, "capital1", "p = 1.25 \u{2192} now")
        XCTAssertEqual(try rules.specialPlan(sched: table(five), records: records, today: TODAY)?.kind, "capital1")
    }

    // test/core/special.test.mjs: special group: group 2 (陆柒捌玖拾) follows once group 1 has appeared; both appear once only; 拾 does not count as a marker
    func testSpecialGroupGroup2FollowsOnceGroup1HasAppearedBothAppearOnceOnlyShiDoesNotCountAsAMarker() throws {
        let g1 = try history(10)
        // 第 1 组写完（壹贰叁肆伍有了记录）
        var after1 = g1
        for (i, c) in "\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}".unicodeScalars.enumerated() { after1.append(rec(100 + i, String(c), "judged", "correct", TODAY, sessionId: "s11")) }
        let next = try selectDaily(records: after1, today: try addDays(TODAY, 1), newCandidates: K("\u{4EA6}\u{9C9C}\u{5883}\u{989D}"))
        XCTAssertEqual(next.special?.kind, "capital2")
        XCTAssertEqual(next.queue, K("\u{9646}\u{67D2}\u{634C}\u{7396}\u{62FE}"))
        // 第 2 组也写完：特别组不再出现
        var after2 = after1
        for (i, c) in "\u{9646}\u{67D2}\u{634C}\u{7396}\u{62FE}".unicodeScalars.enumerated() { after2.append(rec(200 + i, String(c), "judged", "wrong", try addDays(TODAY, 1), sessionId: "s12")) }
        let done = try selectDaily(records: after2, today: try addDays(TODAY, 2), newCandidates: K("\u{4EA6}\u{9C9C}\u{5883}\u{989D}"))
        XCTAssertNil(done.special)
        XCTAssertNil(try rules.specialPlan(sched: .object(JSObject()), records: after2, today: try addDays(TODAY, 2)))
        // 拾 在首练里写过（history 里就有），不能把「第 2 组」算成已出现
        XCTAssertEqual(Special.capitalProgress(g1, policy: policy).map { $0.done }, [false, false])
        XCTAssertEqual(Special.capitalProgress(after1, policy: policy).map { $0.done }, [true, false])
        XCTAssertEqual(Special.capitalProgress(after2, policy: policy).map { $0.done }, [true, true])
        // 任何一种记录都算「出现过」（看过答案 / 跳过也不再重来）
        let skipped = g1 + [rec(300, "\u{9646}", "skipped", nil, TODAY, sessionId: "s11")]
        XCTAssertEqual(Special.capitalProgress(skipped, policy: policy).map { $0.done }, [false, true])
    }

    // test/core/special.test.mjs: special group: chars written today are left out; a group with nothing left falls through to the next / the daily mix
    func testSpecialGroupCharsWrittenTodayAreLeftOutAGroupWithNothingLeftFallsThroughToTheNextTheDailyMix() throws {
        let g1 = try history(10)
        let partial = try runSp(g1 + [rec(400, "\u{58F9}", "judged", "correct", TODAY, sessionId: "s11")])
        XCTAssertEqual(partial.special?.kind, "capital2", "group 1 already appeared (\u{58F9} has a record, even if the rest were never written) \u{2192} never again; group 2 is next")
        XCTAssertFalse(partial.queue.contains("base:\u{58F9}"))
        let noDeck = try runSp(g1, practicable: { !inChars("\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}", $0) && $0.hasPrefix("base:") })
        XCTAssertEqual(noDeck.special?.kind, "capital2", "group 1 not practicable \u{2192} group 2")
        let none = try runSp(g1, practicable: { !inChars("\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}\u{9646}\u{67D2}\u{634C}\u{7396}\u{62FE}", $0) && $0.hasPrefix("base:") })
        XCTAssertNil(none.special)
        XCTAssertTrue(none.queue.count > 0)
    }

    // test/core/special.test.mjs: special group can be switched off (policy.capitalNumerals.enabled) and its thresholds come from policy (P128)
    func testSpecialGroupCanBeSwitchedOffPolicyCapitalNumeralsEnabledAndItsThresholdsComeFromPolicyP128() throws {
        let off = capitalPolicy([("enabled", .bool(false))])
        XCTAssertNil(try runSp(try history(12), policy: off).special)
        XCTAssertNil(try rules.specialPlan(sched: .object(JSObject()), records: try history(12), today: TODAY, policy: off))
        let later = capitalPolicy([("afterGroups", .number(20))])
        XCTAssertNil(try runSp(try history(12), policy: later).special)
        XCTAssertEqual(try runSp(try history(20), policy: later).special?.kind, "capital1")
        let strictP = capitalPolicy([("belowDays", .number(0.1))])
        XCTAssertNil(try runSp(try history(12), sched: JS.obj([("base:\u{5B50}", sched(try addDays(TODAY, -1)))]), policy: strictP).special)
    }

    // test/core/special.test.mjs: 佰 仟 are not in the two groups: after both groups appeared they lead the ordinary new-char queue, once
    func testBaiQianAreNotInTheTwoGroupsAfterBothGroupsAppearedTheyLeadTheOrdinaryNewCharQueueOnce() throws {
        let g1 = try history(10)
        XCTAssertEqual(Special.capitalAfterKeysFor(g1, policy: policy), [], "before the groups: nothing")
        var both = g1
        for (i, c) in "\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}".unicodeScalars.enumerated() { both.append(rec(100 + i, String(c), "judged", "correct", TODAY, sessionId: "s11")) }
        for (i, c) in "\u{9646}\u{67D2}\u{634C}\u{7396}\u{62FE}".unicodeScalars.enumerated() { both.append(rec(200 + i, String(c), "judged", "correct", TODAY, sessionId: "s12")) }
        XCTAssertEqual(Special.capitalAfterKeysFor(both, policy: policy), K("\u{4F70}\u{4EDF}"))
        let day = try addDays(TODAY, 1)
        let r = try selectDaily(records: both, today: day, newCandidates: K("\u{4EA6}\u{9C9C}\u{5883}\u{989D}\u{6162}"))
        XCTAssertEqual(Array(r.newKeys.prefix(2)), K("\u{4F70}\u{4EDF}"), "then the usual order")
        XCTAssertNil(r.special)
        // 写过之后（进了调度）就不再排前面
        let later = try addDays(day, 5)
        let r2 = try selectDaily(sched: JS.obj([("base:\u{4F70}", sched(later)), ("base:\u{4EDF}", sched(later))]), records: both, today: day, newCandidates: K("\u{4EA6}\u{9C9C}\u{5883}\u{989D}\u{6162}"))
        XCTAssertFalse(r2.newKeys.contains("base:\u{4F70}") || r2.newKeys.contains("base:\u{4EDF}"))
        XCTAssertNil(Special.capitalSpecial(records: both, groupsTotal: 99, pressure: 0, practicable: { _ in true }, excluded: KeySet(), policy: policy))
    }

    // test/core/special.test.mjs: planDaily / planSpecial expose the special group to the session start and the home page
    func testPlanDailyPlanSpecialExposeTheSpecialGroupToTheSessionStartAndTheHomePage() throws {
        let state = JS.obj([
            ("records", JS.obj([("2026-09", .array(try history(10)))])), ("sched", .object(JSObject())),
            ("sessions", JS.obj([("A", .null), ("B", .null), ("lastEnded", .object(JSObject()))])), ("settings", .object(JSObject())),
        ])
        func deck(practicable: @escaping (String) -> Bool = { $0.hasPrefix("base:") }) -> ScheduleDeck {
            ScheduleDeck(newCandidates: { _ in K("\u{4EA6}\u{9C9C}\u{5883}\u{989D}") }, practicable: practicable, currentLibraryId: { _ in S("core3500") })
        }
        let plan = try rules.planDaily(state, today: TODAY, deck: deck())
        XCTAssertEqual(plan["special"]?["kind"], S("capital1"))
        XCTAssertEqual(plan["queue"], .array(K("\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}").map { S($0) }))
        XCTAssertEqual(try rules.planSpecial(state, today: TODAY, deck: deck())["kind"], S("capital1"))
        XCTAssertEqual(try rules.planSpecial(JS.with(state, [("records", .object(JSObject()))]), today: TODAY, deck: deck()), .null, "no records yet \u{2192} first practice, never special")
        // 题库里没有这些字（不可练）→ 没有特别组
        XCTAssertEqual(try rules.planSpecial(state, today: TODAY, deck: deck(practicable: { $0.hasPrefix("base:") && !inChars("\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}\u{9646}\u{67D2}\u{634C}\u{7396}\u{62FE}", $0) })), .null)
    }

    // test/core/special.test.mjs: policy D40: capitalNumerals (P128) = 10 groups, p < 1.5, switchable
    func testPolicyD40CapitalNumeralsP128Is10GroupsPLessThan1Point5Switchable() throws {
        // JS 里还断言 Object.isFrozen（Swift 的 JSValue 是值类型，没有冻结的概念）；这里只核对值（字面量是 JS 测试自己钉的）。
        XCTAssertEqual(policy["capitalNumerals"], J(#"{"enabled":true,"afterGroups":10,"belowDays":1.5}"#))
    }
}
