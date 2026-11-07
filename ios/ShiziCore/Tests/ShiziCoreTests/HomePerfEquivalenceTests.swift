import Foundation
import XCTest
@testable import ShiziCore

// 首页构建提速（按 id 排序先算序号、序号解析不建数组、选字里 overdueDays 按 due 记住）的等价性：
// 与改动之前的写法（照抄在下面当参照）逐个比结果。整页的结果另由 ViewParityTests（views-* 夹具）与 schedule 夹具守着。
final class HomePerfEquivalenceTests: XCTestCase {
    // MARK: 参照（改动前的写法）

    private static func refSerial(_ id: JSValue?, prefix: UInt8) -> Double {
        guard case .string(let s)? = id else { return .nan }
        let u = Array(s.utf8)
        guard u.count >= 2, u[0] == prefix, u[1] >= 0x31, u[1] <= 0x39 else { return .nan }
        for c in u.dropFirst() where c < 0x30 || c > 0x39 { return .nan }
        return Double(String(decoding: u.dropFirst(), as: UTF8.self)) ?? .nan
    }

    private static func refCompare(_ a: JSValue?, _ b: JSValue?) -> Double {
        let sa = refSerial(a, prefix: 0x72), sb = refSerial(b, prefix: 0x72)
        return (sa.isNaN ? -1 : sa) - (sb.isNaN ? -1 : sb)
    }

    private static func sameDouble(_ a: Double, _ b: Double) -> Bool { (a.isNaN && b.isNaN) || a.bitPattern == b.bitPattern }

    /// 各种 id：合法的、前导 0、r0、别的前缀、非数字、空、长到 18 / 19 / 25 位、非 ASCII 数字、非字串。
    private static let idSamples: [JSValue?] = {
        var out: [JSValue?] = [nil, .null, .number(12), .bool(true), .string(""), .string("r"), .string("r0"), .string("r01"), .string("s12"), .string("x3"),
                               .string("r12a"), .string("R12"), .string("r\u{0661}2"), .string("r1\u{FF12}"), .string("r 1"), .string("rr1"), .array([]), .object(JSObject())]
        for n in [1, 2, 9, 10, 99, 100, 1234, 65_535, 9_007_199_254_740_991, 9_007_199_254_740_993] { out.append(.string("r\(n)")) }
        for len in [15, 16, 17, 18, 19, 20, 25, 40, 400] {
            out.append(.string("r" + String(repeating: "9", count: len)))
            out.append(.string("r1" + String(repeating: "0", count: len - 1)))
            var mixed = "r"
            for i in 0..<len { mixed += String(i == 0 ? 3 : (i * 7 + 3) % 10) }
            out.append(.string(mixed))
        }
        out.append(.string("r123456789012345678")) // 18 位
        out.append(.string("r1234567890123456789")) // 19 位
        out.append(.string("r9007199254740993123"))
        return out
    }()

    func testRecordSerialMatchesReference() {
        for id in Self.idSamples {
            XCTAssert(Self.sameDouble(SchedRecords.recordSerial(id), Self.refSerial(id, prefix: 0x72)), "SchedRecords.recordSerial \(String(describing: id))")
            XCTAssert(Self.sameDouble(SchedRecords.sessionSerial(id), Self.refSerial(id, prefix: 0x73)), "SchedRecords.sessionSerial \(String(describing: id))")
            XCTAssert(Self.sameDouble(Records.recordSerial(id), Self.refSerial(id, prefix: 0x72)), "Records.recordSerial \(String(describing: id))")
            XCTAssert(Self.sameDouble(Records.sessionSerial(id), Self.refSerial(id, prefix: 0x73)), "Records.sessionSerial \(String(describing: id))")
            if case .string(let s)? = id {
                let s2 = "s" + s.dropFirst()
                XCTAssert(Self.sameDouble(SchedRecords.sessionSerial(.string(s2)), Self.refSerial(.string(s2), prefix: 0x73)), s2)
                XCTAssert(Self.sameDouble(Records.sessionSerial(.string(s2)), Self.refSerial(.string(s2), prefix: 0x73)), s2)
            }
        }
        // 逐个序号（1 … 3000）
        for n in 1...3000 {
            let id = JSValue.string("r\(n)")
            XCTAssertEqual(SchedRecords.recordSerial(id), Double(n))
            XCTAssertEqual(Records.recordSerial(id), Double(n))
        }
    }

    /// 打乱的记录（重复 id、不合法 id、缺 id、超长序号），每条带唯一的 "i"：排出的顺序（含相等时的先后）必须与参照逐条相同。
    func testSortByIdMatchesReference() {
        var rng = HomePerfRNG(seed: 20261104)
        for round in 0..<40 {
            let n = [0, 1, 2, 3, 7, 50, 333, 2000][round % 8]
            var recs: [JSValue] = []
            for i in 0..<n {
                var o = JSObject([("i", .number(Double(i)))])
                let pick = rng.next() % 10
                if pick < 6 {
                    o["id"] = .string("r\(1 + rng.next() % UInt64(max(1, n / 2 + 1)))") // 多有重复
                } else if pick < 9 {
                    let sample = Self.idSamples[Int(rng.next() % UInt64(Self.idSamples.count))]
                    if let sample { o["id"] = sample }
                }
                recs.append(.object(o))
            }
            let refSched = recs.jsSorted { Self.refCompare($0["id"], $1["id"]) }
            let refRecords = JSX.stableSort(recs) { Self.refCompare($0["id"], $1["id"]) }
            XCTAssertEqual(SchedRecords.sortById(recs).map { $0["i"]! }, refSched.map { $0["i"]! }, "round \(round)")
            XCTAssertEqual(Records.sortById(recs).map { $0["i"]! }, refRecords.map { $0["i"]! }, "round \(round)")
        }
        // 非对象的元素（取 id 为 nil）也一样
        let odd: [JSValue] = [.string("r1"), .number(3), .object(JSObject([("id", .string("r2"))])), .null, .object(JSObject([("id", .string("r1"))]))]
        XCTAssertEqual(SchedRecords.sortById(odd), odd.jsSorted { Self.refCompare($0["id"], $1["id"]) })
        XCTAssertEqual(Records.sortById(odd), JSX.stableSort(odd) { Self.refCompare($0["id"], $1["id"]) })
    }

    /// OverdueMemo 与逐个调用 overdueDays 结果相同（含 nil、重复的 due、不合法的 due、非字串的 due、夏令时 / 跳日的时区）。
    func testOverdueMemoMatchesDirect() throws {
        let dues: [JSValue?] = [nil, .null, .number(3), .bool(true), .string(""), .string("2026-10-02"), .string("2026-10-01"), .string("2026-10-03"),
                                .string("2026-02-29"), .string("2028-02-29"), .string("2026-02-30"), .string("2026-13-01"), .string("2026-00-10"),
                                .string("2026-1-01"), .string("2026-10-02 "), .string("1900-01-01"), .string("0099-12-31"), .string("2011-12-30"),
                                .string("2011-12-31"), .string("2017-10-15"), .string("2018-11-04"), .string("2026-10-0\u{0661}")]
        var entries: [JSValue?] = [nil, .null, .bool(false), .number(0), .string("x"), .array([])]
        for d in dues {
            var o = JSObject([("fsrs", .object(JSObject([("s", .number(3))])))])
            if let d { o["due"] = d }
            entries.append(.object(o))
            entries.append(.object(o)) // 重复：第二次走记忆
        }
        for tzName in ["Asia/Shanghai", "America/Sao_Paulo", "Pacific/Apia", "America/New_York", "UTC"] {
            let rules = ScheduleRules(dates: Dates(timeZone: TimeZone(identifier: tzName)!))
            for today in ["2026-10-02", "2011-12-31", "2017-10-15", "2028-02-29"] {
                var memo = ScheduleRules.OverdueMemo(today: today)
                for pass in 0..<2 {
                    for e in entries {
                        let direct = try rules.overdueDays(e, today), viaMemo = try memo.days(e, rules)
                        XCTAssertEqual(direct.map { $0.bitPattern }, viaMemo.map { $0.bitPattern }, "\(tzName) \(today) pass \(pass) \(String(describing: e))")
                    }
                }
            }
            // today 不合法：两边都抛（due 合法时）或都给 nil（due 不合法时）
            var memo = ScheduleRules.OverdueMemo(today: "2026-13-40")
            for e in entries {
                let direct = Result { try rules.overdueDays(e, "2026-13-40") }, viaMemo = Result { try memo.days(e, rules) }
                switch (direct, viaMemo) {
                case (.success(let a), .success(let b)): XCTAssertEqual(a, b)
                case (.failure(let a), .failure(let b)): XCTAssertEqual(a as? CoreError, b as? CoreError)
                default: XCTFail("throw mismatch \(tzName) \(String(describing: e))")
                }
            }
        }
    }

    /// 一个有数据的状态：planDaily / planSpecial 的到期计数与逐个调用 overdueDays 数出来的相同；首页两次构建结果相同。
    func testPopulatedPlanBacklogMatchesDirectCount() throws {
        let keys = DeckIndex.shared.keys.filter { $0.hasPrefix("base:") }
        guard keys.count >= 100 else { return }
        var records = JSObject(), sched = JSObject(), months: [JSValue] = []
        var serial = 0
        for m in 7...9 {
            let month = String(format: "2026-%02d", m)
            var list: [JSValue] = []
            for j in 0..<120 {
                serial += 1
                let key = keys[(serial - 1) % 200], ch = String(key.dropFirst(5))
                let kind = serial % 11 == 0 ? "answer-seen" : serial % 13 == 0 ? "skipped" : "judged"
                list.append(srec(serial, ch, kind: kind, judgment: serial % 5 == 0 ? "wrong" : "correct", day: month + String(format: "-%02d", 1 + j % 28), session: 1 + serial / 15))
                var e = JSObject([("fsrs", .object(JSObject([("s", .number(Double(1 + serial % 30))), ("d", .number(5))]))),
                                  ("due", .string(String(format: "2026-%02d-%02d", serial % 3 == 0 ? 9 : 10, 1 + serial % 28))), ("lastJudgedAt", .number(T0 + Double(serial) * 1000))])
                if serial % 17 == 0 { e["stoppedAt"] = .number(T0) }
                if serial % 19 == 0 { e["due"] = .string("2026-02-30") }
                sched[key] = .object(e)
            }
            records[month] = .array(list)
            months.append(.string(month))
        }
        let state = JSValue.object(JSObject([
            ("meta", .object(JSObject([("schema", .number(2)), ("serial", .number(Double(serial))), ("createdAt", .number(T0)), ("months", .array(months))]))),
            ("records", .object(records)), ("sched", .object(sched)),
            ("settings", .object(JSObject([("library", .string(DeckIndex.shared.defaultLibraryId))]))),
        ]))
        let rules = ScheduleRules(dates: shanghai), today = try shanghai.localDay(.number(STORE_NOW))
        let recs = ScheduleRules.recordsOf(state)
        var excluded = SchedRecords.judgedCardKeysOn(recs, today)
        for k in SchedRecords.answerSeenCardKeysOn(recs, today) { excluded.insert(k) }
        for k in SchedRecords.skippedCardKeysOn(recs, today) { excluded.insert(k) }
        var direct = 0
        for (key, e) in sched.entries where !excluded.contains(key) && ScheduleDeck.real.practicable(key) && JS.truthy(e) && e["stoppedAt"] == nil {
            if let od = try rules.overdueDays(e, today), od >= 0 { direct += 1 }
        }
        XCTAssertGreaterThan(direct, 0)
        let plan = try rules.planDaily(state, today: today, deck: .real)
        XCTAssertEqual(plan["backlog"], .number(Double(direct)))
        let a = try HomeView.homeView(state, now: STORE_NOW, policy: Config.policy, deck: .real, ui: nil, dates: shanghai)
        let b = try HomeView.homeView(state, now: STORE_NOW, policy: Config.policy, deck: .real, ui: nil, dates: shanghai)
        XCTAssertEqual(JSONWriter.stringify(a), JSONWriter.stringify(b))

        // 一次首页构建内共用一次 practiceStats（PracticeStatsMemo）：带 memo 的 planDaily / planSpecial / progress / noCharsLeft 与不带的结果逐字相同，
        // 共用的 memo 里存的就是不带 memo 直接算的 practiceStats。
        let memo = PracticeStatsMemo()
        let planM = try rules.planDaily(state, today: today, deck: .real, statsMemo: memo)
        XCTAssertEqual(JSONWriter.stringify(planM), JSONWriter.stringify(plan))
        XCTAssertEqual(memo.value, try rules.practiceStats(recs, today, isWarm: NewOrder.isWarmupKey))
        XCTAssertEqual(JSONWriter.stringify(try rules.planSpecial(state, today: today, deck: .real, statsMemo: memo)),
                       JSONWriter.stringify(try rules.planSpecial(state, today: today, deck: .real)))
        XCTAssertEqual(try TodayPlan.progress(state, day: today, rules: rules, deck: .real, statsMemo: memo),
                       try TodayPlan.progress(state, day: today, rules: rules, deck: .real))
        XCTAssertEqual(try HomeView.noCharsLeft(state, today: today, deck: .real, policy: Config.policy, dates: shanghai, statsMemo: memo),
                       try HomeView.noCharsLeft(state, today: today, deck: .real, policy: Config.policy, dates: shanghai))
    }
}

/// 可复现的伪随机数（SplitMix64）。
private struct HomePerfRNG {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}
