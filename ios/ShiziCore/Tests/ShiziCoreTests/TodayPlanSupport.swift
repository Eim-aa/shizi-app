import Foundation
import XCTest
@testable import ShiziCore

// S2 调度规则 v2（D83）测试的公用台子：真 Store（内存后端）+ 可拨的钟 + 真题库，所有写入都走 App 用的同一条路（ScheduleRules 开组、WriteAPI 写字）。

final class TestClock {
    var t: Double
    init(_ t: Double) { self.t = t }
}

struct PlanHarness {
    let clock: TestClock
    let store: Store
    let rules: ScheduleRules
    let deck: ScheduleDeck

    static func make(start: Double = STORE_NOW, deck: ScheduleDeck = .real, settings: [(String, JSValue)] = []) -> PlanHarness {
        let clock = TestClock(start)
        let disk = MemoryDisk()
        let storage = StoreStorage(disk.open(), now: { clock.t })
        let store = Store(storage: storage, now: { clock.t }, dates: shanghai)
        store.load()
        let h = PlanHarness(clock: clock, store: store, rules: ScheduleRules(dates: shanghai), deck: deck)
        if !settings.isEmpty {
            _ = store.commit("test:settings") { d, _ in
                var s = d["settings"]?.objectValue ?? JSObject()
                for (k, v) in settings { s[k] = v }
                d["settings"] = .object(s)
            }
        }
        return h
    }

    var state: JSValue { .object(store.state) }
    var day: String { try! shanghai.localDay(.number(clock.t)) }
    var today: TodayPlan.Today { TodayPlan.today(state, day: day) }
    var records: [JSValue] { Query.flattenRecords(store.state["records"]) }
    func tick(_ ms: Double = 30_000) { clock.t += ms }
    /// 第二天同一时刻（早上 4 点以后）。
    func nextDay(_ n: Double = 1) { clock.t += ONE_DAY_MS * n }

    func session(_ slot: String = "A") -> JSValue? { store.state["sessions"]?[slot].flatMap { $0.isNull ? nil : $0 } }
    func current(_ slot: String = "A") -> String? { SessionRules.currentCardKey(session(slot))?.stringValue }
    func sched(_ key: String) -> JSValue? { store.state["sched"]?[key].flatMap { $0.isNull ? nil : $0 } }

    @discardableResult
    func startA(file: StaticString = #filePath, line: UInt = #line) throws -> JSValue {
        tick()
        let r = try rules.startNextA(store, now: clock.t, deck: deck)
        XCTAssertEqual(r["ok"], .bool(true), str(r), file: file, line: line)
        return r
    }

    @discardableResult
    func startPicked(_ chars: [String], file: StaticString = #filePath, line: UInt = #line) throws -> JSValue {
        tick()
        let r = try rules.startPicked(store, keys: chars.map { .string($0) }, deck: deck)
        XCTAssertEqual(r["ok"], .bool(true), str(r), file: file, line: line)
        return r
    }

    static let stroke: JSValue = .array([.array([.array([.number(10), .number(10), .number(0)]), .array([.number(60), .number(70), .number(16)])])])

    @discardableResult
    func judge(_ judgment: String, slot: String = "A", hints: Int = 0, file: StaticString = #filePath, line: UInt = #line) -> JSValue {
        tick()
        guard let key = current(slot) else { XCTFail("no current card", file: file, line: line); return .null }
        let r = WriteAPI.call("judge", store, JSObject([("slot", .string(slot)), ("cardKey", .string(key)), ("judgment", .string(judgment)), ("hints", .number(Double(hints))), ("strokes", PlanHarness.stroke)]))
        XCTAssertEqual(r["ok"], .bool(true), str(r), file: file, line: line)
        return r
    }

    /// 看答案 → 描一遍 → 下一个（看了答案 = 写错）。
    func seeAnswer(slot: String = "A", file: StaticString = #filePath, line: UInt = #line) {
        tick()
        guard let key = current(slot) else { XCTFail("no current card", file: file, line: line); return }
        let a = WriteAPI.call("showAnswer", store, JSObject([("slot", .string(slot)), ("cardKey", .string(key))]))
        XCTAssertEqual(a["ok"], .bool(true), str(a), file: file, line: line)
        tick()
        let n = WriteAPI.call("answerNext", store, JSObject([("slot", .string(slot)), ("cardKey", .string(key)), ("strokes", PlanHarness.stroke)]))
        XCTAssertEqual(n["ok"], .bool(true), str(n), file: file, line: line)
    }

    @discardableResult
    func skip(slot: String = "A", file: StaticString = #filePath, line: UInt = #line) -> JSValue {
        tick()
        guard let key = current(slot) else { XCTFail("no current card", file: file, line: line); return .null }
        let r = WriteAPI.call("skip", store, JSObject([("slot", .string(slot)), ("cardKey", .string(key))]))
        XCTAssertEqual(r["ok"], .bool(true), str(r), file: file, line: line)
        return r
    }

    /// 写完首练（尴 赢 拾，全对），这样第二天起是今天的练习。
    func finishFirst() throws {
        let r = try startA()
        XCTAssertEqual(r["kind"], .string("first"))
        while current() != nil { judge("correct") }
    }

    /// 首页的视图模型（真题库）。
    func home() throws -> JSValue { try HomeView.homeModel(state, now: clock.t, policy: Config.policy, deck: deck, dates: shanghai) }
    func progress() throws -> TodayPlan.Progress { try TodayPlan.progress(state, day: day, rules: rules, deck: deck) }
}

/// 自选用的字：默认字库新字顺序里靠后的几个（今天的练习排不到）。
func pickChars(_ n: Int, from: Int = 600) -> [String] {
    let order = DeckIndex.shared.newOrder(.string(DeckIndex.shared.defaultLibraryId))
    return order[from..<(from + n)].map { String($0.dropFirst(5)) }
}

/// 一张真的 FSRS 调度项：某天第一次判断（correct / wrong），due 改成 dueDay。
func realEntry(_ key: String, judgedOn day: String, judgment: String = "correct", due dueDay: String, rules: ScheduleRules = ScheduleRules(dates: shanghai)) throws -> JSValue {
    let p = day.split(separator: "-").map { Int($0)! }
    let at = JSDate.makeLocal(p[0], p[1] - 1, p[2], hours: 12, shanghaiTZ)!
    let rec = JS.obj([("id", .string("r9")), ("cardKey", .string(key)), ("char", .string(String(key.dropFirst(5)))), ("sessionId", .string("s9")), ("kind", .string("judged")),
                      ("at", .number(at)), ("localDay", .string(day)), ("judgment", .string(judgment)),
                      ("help", JS.obj([("hints", .number(0)), ("answerSeen", .bool(false)), ("traced", .bool(false))]))])
    let e = try rules.applyJudgment(nil, rec).entry
    return JS.with(e, [("due", .string(dueDay))])
}
