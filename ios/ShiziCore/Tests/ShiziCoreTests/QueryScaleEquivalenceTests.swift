import Foundation
import XCTest
@testable import ShiziCore

// 查询页（QueryView.sheetModel / querySheetModel，PageAPI 的 view.query）不再「每个字把全部记录扫两遍」之后的等价性。
// 参照 = 改动之前的写法（照抄在下面的 QueryRef 里：先展开全部记录，每个字 judgedCountOfCard + latestJudged 各扫一遍，拼音时 writtenChars 再扫一遍；
// isCustom 每个字重建一次 custom 列表；filterNotes 的重复字逐个在 chars 里线性找；行的 selected 在 chosen 里线性找）。
// 新旧从同一个状态、同一组参数出发，逐字节比整份回答（JSONWriter.stringify，键序也算；抛错比错误文字）：
//   · 夹具：Fixtures 里出现的每一个 store 状态（JudgeScaleEquivalenceTests.fixtureStates）；
//   · 随机历史（每次 60 份，SHIZI_SCALE_BENCH=1 时另跑 200 份）：JudgeScaleEquivalenceTests.randomState（乱序月键、折叠月 kept、没有 folded 的 kept、坏月值、纸上记录、跳过、看过答案、
//     重复 / 不合法 id、同一时刻、规范等价但字节不同的 cardKey），再加上兼容表意字 U+F900 与它规范等价的 U+8C48（都是汉字，两个不同的查询字）、
//     custom.added 里的怪值、sched 里的怪 due；
//   · ScaleBenchmarkTests 的状态：1x（100 字粘贴）与 3x-folded 每次跑（草稿 + 播进 Store 走 PageAPI.call）；3x / 10x（未折叠）、10x-folded 与 1000 / 3000 字的粘贴只在 SHIZI_SCALE_BENCH=1 时跑。
// 输入：空、空白、只有非汉字、单字、多字、重复字、汉字夹杂别的、兼容字、粘贴的长文、拼音（完全相同 / 前缀 / 带声调 / 撇号 / 空格 / 没有命中）；
// lookup / pick、cur（空 / 第一个 / 第二个 / 不在输入里）、selected（在 / 不在输入里）、policy 的 queryInputMax（缺省 null / 1 / 3 / 0）与 queryCardInk。
// 另打印几种查询新旧的耗时（BENCH query-path …；只打印，不断言耗时）。
final class QueryScaleEquivalenceTests: XCTestCase {
    typealias B = StoreCommitBenchmarkTests
    typealias S = ScaleBenchmarkTests
    typealias J = JudgeScaleEquivalenceTests

    override func setUp() {
        super.setUp()
        JSMath.flavor = .v8
    }

    // MARK: 小工具

    static func text(_ v: JSValue?) -> String { v.map { JSONWriter.stringify($0) } ?? "<nil>" }

    static func outcome(_ body: () throws -> String) -> String {
        do { return "ok " + (try body()) } catch { return "throw " + String(describing: error) }
    }

    func same(_ a: String, _ b: String, _ label: String, file: StaticString = #filePath, line: UInt = #line) {
        if a.utf8.elementsEqual(b.utf8) { return }
        let x = Array(a.utf8), y = Array(b.utf8)
        var i = 0
        while i < x.count && i < y.count && x[i] == y[i] { i += 1 }
        func around(_ u: [UInt8]) -> String { String(decoding: u[max(0, min(u.count, i) - 120)..<min(u.count, i + 120)], as: UTF8.self) }
        XCTFail("\(label): differ at byte \(i) (lengths \(x.count) / \(y.count))\n old: …\(around(x))…\n new: …\(around(y))…", file: file, line: line)
    }

    /// 兼容表意字「豈」U+F900 与它规范分解成的统一表意字 U+8C48：Swift String 认为相等，查询（逐码点）是两个字。
    static let compat = ["\u{F900}", "\u{8C48}"]
    static let pinyinAll = ["shi", "s", "ren", "Rén", "r'en", "kou", "da", "tian", "shui", "sh i", " shi ", "zzz", "lv", "nü", "x", "a"]
    static let pinyinFew = ["ren", "s"]
    static let others = ["", "   ", "abc", "a!b", "123", "\u{3000}", "é"]
    static let deck = B.practicableChars(4000)

    /// 状态的记录里出现的汉字（cardKey 是 base:<一个汉字>），按首次出现、逐码点去重，最多 limit 个。
    static func recordChars(_ state: JSObject, limit: Int) -> [String] {
        var out = OSet()
        for r in Query.flattenRecords(state["records"]) where out.count < limit {
            guard case .string(let k)? = r["cardKey"], k.utf8.starts(with: "base:".utf8) else { continue }
            let c = String(decoding: Array(k.utf8).dropFirst(5), as: UTF8.self)
            if Query.isHan(.string(c)) { out.insert(c) }
        }
        return out.items
    }

    /// 粘贴的长文：题库里 n 个不同的字，每 7 个重复一次前面的字，每 5 个夹一个非汉字。
    static func pasted(_ n: Int) -> String {
        var s = ""
        for (i, c) in deck.prefix(n).enumerated() {
            s += c
            if i % 7 == 6 { s += deck[i / 2] }
            if i % 5 == 4 { s += i % 2 == 0 ? "a" : "，" }
        }
        return s
    }

    /// 一个状态要试的输入：几种拼音、非汉字、单字 / 多字 / 重复 / 夹杂 / 兼容字 / 没有记录的字 / 粘贴。
    static func texts(_ cs: [String], pinyin: [String], pastedChars: Int) -> [String] {
        var out = others + pinyin
        let c = cs + deck.prefix(3)
        for x in c.prefix(4) { out.append(x) }
        out.append(c.prefix(10).joined())
        out.append(c[0] + c[1] + c[0] + c[0] + c[2] + c[1])
        out.append("x" + c[0] + "1 " + c[1] + "é" + deck[5] + "\n" + c[2])
        out.append(compat.joined() + compat[0])
        out += compat
        out.append(compat[1] + c[0] + compat[0])
        out.append(deck.dropFirst(100).prefix(10).joined())
        if pastedChars > 0 { out.append(pasted(pastedChars)) }
        return out
    }

    static func args(_ state: JSObject, text: String, mode: String, cur: String, selected: [String], policy: JSValue) -> JSObject {
        JSObject([("mode", .string(mode)), ("text", .string(text)), ("cur", .string(cur)), ("selected", .array(selected.map { .string($0) })), ("state", .object(state)), ("policy", policy)])
    }

    static let policies: [JSValue] = [
        .object(JSObject([("queryInputMax", .number(3))])),
        .object(JSObject([("queryInputMax", .number(1))])),
        .object(JSObject([("queryInputMax", .number(0))])),
        .object(JSObject([("queryCardInk", .string("none"))])),
    ]

    /// 一组参数：新旧 querySheetModel（整份回答）逐字节比；sheet = true 时另比 sheetModel（含每个字的 summary 与 latest 整条记录）。
    func check(_ a: JSObject, dates: Dates, sheet: Bool, _ label: String) {
        same(Self.outcome { Self.text(try QueryRef.querySheetModel(a, dates: dates)) }, Self.outcome { Self.text(try QueryView.querySheetModel(a, dates: dates)) }, label)
        if sheet { same(Self.text(QueryRef.sheetModel(a)), Self.text(QueryView.sheetModel(a)), label + " sheet") }
    }

    /// 一个状态上的全部输入。wide：每个输入都试 pick、几个 cur 与 policy；否则 lookup 两个 cur + pick 一次（拼音输入总是后者：每次都要扫一遍题库的读音表，调试版慢）。
    func checkState(_ state: JSObject, _ label: String, pinyin: [String], pastedChars: Int = 0, wide: Bool, dates: Dates = shanghai) {
        let cs = Self.recordChars(state, limit: 12)
        let policy = Config.policy
        for t in Self.texts(cs, pinyin: pinyin, pastedChars: pastedChars) {
            let probe = QueryRef.sheetModel(Self.args(state, text: t, mode: "lookup", cur: "", selected: [], policy: policy))
            let chars = (probe["filtered"]?["chars"]?.arrayValue ?? []).compactMap(\.stringValue)
            let wideHere = wide && !pinyin.contains(t)
            var curs = ["", chars.first ?? "", chars.dropFirst().first ?? "", "\u{4E00}"]
            if !wideHere { curs = Array(curs.prefix(2)) }
            let tag = "\(label) text=\(t.prefix(24))…(\(t.unicodeScalars.count))"
            for (n, cur) in curs.enumerated() where n == 0 || !cur.isEmpty {
                check(Self.args(state, text: t, mode: "lookup", cur: cur, selected: [], policy: policy), dates: dates, sheet: n == 0, "\(tag) lookup cur=\(cur)")
            }
            let selected = Array(chars.prefix(3)) + (chars.last.map { [$0] } ?? []) + ["\u{4E00}", Self.compat[0], ""]
            check(Self.args(state, text: t, mode: "pick", cur: "", selected: selected, policy: policy), dates: dates, sheet: true, "\(tag) pick")
            if wideHere {
                check(Self.args(state, text: t, mode: "pick", cur: chars.first ?? "", selected: Array(selected.prefix(1)), policy: policy), dates: dates, sheet: false, "\(tag) pick cur")
                for (i, p) in Self.policies.enumerated() {
                    check(Self.args(state, text: t, mode: i % 2 == 0 ? "lookup" : "pick", cur: "", selected: selected, policy: p), dates: dates, sheet: true, "\(tag) policy \(i)")
                }
            }
        }
    }

    /// 单个函数：charSummary（全部记录上）、pinyinMatches（带 / 不带 written）、filterNotes。
    func checkParts(_ state: JSObject, _ label: String, pinyin: Bool) {
        let records = Query.flattenRecords(state["records"])
        for c in Self.recordChars(state, limit: 12) + Self.compat + ["\u{4E00}"] {
            same(Self.text(QueryRef.charSummary(c, records: records, sched: state["sched"], custom: state["custom"], practicable: true)),
                 Self.text(Query.charSummary(c, records: records, sched: state["sched"], custom: state["custom"], practicable: true)), "\(label) charSummary \(c)")
        }
        let entries = QueryView.pinyinEntries
        let written = QueryRef.writtenChars(records)
        XCTAssertEqual(QueryRef.writtenChars(records), Query.writtenChars(records), "\(label) writtenChars")
        for q in pinyin ? ["shi", "s", "ren", "kou", "zzz"] : [] {
            XCTAssertEqual(QueryRef.pinyinMatches(q, entries, written: written), Query.pinyinMatches(q, entries, written: written), "\(label) pinyin \(q)")
            XCTAssertEqual(QueryRef.pinyinMatches(q, entries, written: written, max: .number(5)), Query.pinyinMatches(q, entries, written: written, max: .number(5)), "\(label) pinyin max \(q)")
            XCTAssertEqual(QueryRef.pinyinMatches(q, entries, written: nil, max: .null), Query.pinyinMatches(q, entries, written: nil, max: .null), "\(label) pinyin nomax \(q)")
        }
        for t in Self.texts(Self.recordChars(state, limit: 12), pinyin: [], pastedChars: 60) {
            for m: JSValue in [.null, .number(2)] {
                let f = Query.filterInput(.string(t), max: m)
                for v in ["rows", "card", "hint"] {
                    same(Self.text(.array(QueryRef.filterNotes(f, view: v))), Self.text(.array(Query.filterNotes(f, view: v))), "\(label) filterNotes \(t.prefix(12)) \(v)")
                }
            }
        }
    }

    // MARK: 夹具

    func testFixtureStatesMatchReference() throws {
        let states = try J.fixtureStates()
        XCTAssertGreaterThan(states.count, 100, "fixtures must hold store states")
        for (i, state) in states.enumerated() {
            let wide = i % 8 == 0
            checkState(state, "fixture \(i)", pinyin: wide ? ["ren", "zzz"] : (i % 4 == 0 ? ["shi"] : []), wide: wide)
        }
    }

    // MARK: 随机历史

    static func rec(_ id: JSValue, _ key: JSValue, kind: String, day: String, at: Double? = nil, paper: Bool = false, judgment: String = "correct") -> JSValue {
        var o = JSObject([("id", id), ("cardKey", key)])
        if case .string(let k) = key, let ch = SchedRecords.charOfCardKey(k) { o["char"] = .string(ch) }
        o["sessionId"] = .string("s7")
        o["kind"] = .string(kind)
        o["at"] = .number(at ?? dayMs(day, 10))
        o["localDay"] = .string(day)
        o["help"] = .object(JSObject([("hints", .number(0)), ("answerSeen", .bool(kind == "answer-seen")), ("traced", .bool(false))]))
        if kind == "judged" { o["judgment"] = .string(judgment) }
        if paper { o["source"] = .string("paper") }
        return .object(o)
    }

    /// randomState 再加：兼容字 / 统一字两种 cardKey 的判断、看过答案、纸上、跳过（同一个 id、同一时刻、比别的都小 / 不合法的 id），
    /// 一个月放折叠月的 kept；custom.added 里的怪值；sched 里两种 cardKey 与怪 due；有时放一条人字的墨迹到新月。
    static func augmented(_ state: JSObject, _ rng: inout EqRNG) -> JSObject {
        var s = state
        var records = s["records"]?.objectValue ?? JSObject()
        let kF = JSValue.string("base:" + compat[0]), kU = JSValue.string("base:" + compat[1]), kRen = JSValue.string("base:" + cRen)
        let t = dayMs("2026-08-09", 8)
        var aug: [JSValue] = []
        if J.chance(70, &rng) { aug.append(rec(.string("r700"), kF, kind: "judged", day: "2026-08-09", at: t, judgment: "wrong")) }
        if J.chance(70, &rng) { aug.append(rec(.string("r700"), kU, kind: "judged", day: "2026-08-09", at: t)) }
        if J.chance(50, &rng) { aug.append(rec(.string("r701"), kU, kind: "answer-seen", day: "2026-08-10")) }
        if J.chance(50, &rng) { aug.append(rec(.string("r3"), kU, kind: "judged", day: "2026-08-11", paper: true)) }
        if J.chance(50, &rng) { aug.append(rec(.string("x9"), kF, kind: "judged", day: "2026-08-12")) }
        if J.chance(40, &rng) { aug.append(rec(.string("r702"), kRen, kind: "judged", day: "2026-08-12", paper: J.chance(50, &rng), judgment: "wrong")) }
        if J.chance(40, &rng) { aug.append(rec(.string("r702"), kRen, kind: "judged", day: "2026-08-12")) }
        if J.chance(30, &rng) { aug.append(rec(.string("r703"), kRen, kind: "skipped", day: "2026-08-13")) }
        if J.chance(20, &rng) { aug.append(.null) }
        if !aug.isEmpty { records["2026-08"] = .array(aug) }
        if J.chance(40, &rng) {
            let kept: [JSValue] = [rec(.string("r650"), kF, kind: "judged", day: "2024-06-02"), rec(.string("r651"), kRen, kind: "judged", day: "2024-06-03"), rec(.string("r652"), kU, kind: "answer-seen", day: "2024-06-04")]
            records["2024-06"] = .object(JSObject([("folded", .bool(true)), ("month", .string("2024-06")), ("byDay", .object(JSObject())), ("chars", .array([])), ("kept", .array(kept))]))
        }
        s["records"] = .object(records)
        if J.chance(40, &rng), let id = aug.first(where: { $0["cardKey"] == kRen })?["id"]?.stringValue {
            var ink = s["ink"]?.objectValue ?? JSObject()
            ink["2026-08"] = .object(JSObject([(id, inkEntry(5, 2))]))
            s["ink"] = .object(ink)
        }
        var added: [JSValue] = []
        for v: JSValue in [.object(JSObject([("char", .string(cRen)), ("at", .number(1))])), .object(JSObject([("char", .string(compat[0]))])), .null,
                           .object(JSObject([("char", .number(3))])), .object(JSObject([("char", .string(""))])), .string(cKou), .object(JSObject([("char", .string(cKou))]))] {
            if J.chance(45, &rng) { added.append(v) }
        }
        s["custom"] = J.chance(10, &rng) ? .null : .object(JSObject([("added", .array(added))]))
        var sched = s["sched"]?.objectValue ?? JSObject()
        if J.chance(50, &rng) { sched["base:" + compat[1]] = .object(JSObject([("due", .string("2026-11-01"))])) }
        if J.chance(30, &rng) { sched["base:" + cKou] = .object(JSObject([("due", .number(3))])) }
        if J.chance(20, &rng) { sched["base:" + cDa] = .null }
        s["sched"] = .object(sched)
        return s
    }

    /// 每次跑 60 份；另 200 份（另一个种子）只在 SHIZI_SCALE_BENCH=1 时跑（调试版里参照是 O(字数 × 全部记录)）。
    func testRandomHistoriesMatchReference() throws {
        try randomHistories(seed: 20261106, rounds: 60)
    }

    func testMoreRandomHistoriesMatchReference() throws {
        try Self.requireScaleBench()
        try randomHistories(seed: 20261107, rounds: 200)
    }

    func randomHistories(seed: UInt64, rounds: Int) throws {
        var rng = EqRNG(seed: seed)
        for round in 0..<rounds {
            let base = try J.randomState(&rng)
            let state = Self.augmented(base, &rng)
            let wide = round % 8 == 0
            checkParts(state, "random \(round)", pinyin: wide)
            let pinyin = round % 32 == 0 ? Self.pinyinAll : round % 4 == 0 ? Self.pinyinFew : []
            checkState(state, "random \(round)", pinyin: pinyin, pastedChars: wide ? 100 : 0, wide: wide, dates: J.zones[round % J.zones.count])
        }
    }

    /// 同一个状态先后改一个月（同长、只换一条；折叠一个月）再查：每次的回答与参照相同（按月记住的下标表跟着列表的存储走）。
    func testRepeatedQueriesFollowStateChanges() throws {
        var state = try B.heavyState(B.Shape(months: ["2026-09", "2026-10"], recordsPerMonth: 40, studied: 30, inkRecords: 10))
        let text = Self.deck.prefix(12).joined()
        func both(_ label: String) {
            for t in [text, "shi", Self.deck[3]] {
                check(Self.args(state, text: t, mode: "lookup", cur: "", selected: [], policy: Config.policy), dates: shanghai, sheet: true, "\(label) \(t)")
            }
        }
        both("start")
        both("again")
        var records = state["records"]!.objectValue!
        var list = records["2026-10"]!.arrayValue!
        list[5] = Self.rec(.string("r99999"), .string("base:" + Self.deck[3]), kind: "judged", day: "2026-10-19", judgment: "wrong")
        records["2026-10"] = .array(list)
        state["records"] = .object(records)
        both("replaced")
        records["2026-09"] = .object(JSObject([("folded", .bool(true)), ("month", .string("2026-09")), ("kept", .array(Array(records["2026-09"]!.arrayValue!.prefix(3))))]))
        state["records"] = .object(records)
        both("folded")
        records["2026-09"] = nil
        state["records"] = .object(records)
        both("removed")
    }

    // MARK: ScaleBenchmarkTests 的状态

    /// 状态播进 Store，走 PageAPI.call("view.query") 与参照的回答（QueryAPI 的拼法照抄，无 hooks）逐字节比。
    func checkStore(_ state: JSObject, _ name: String, texts: [String]) {
        let clock = B.Clock(B.benchNow + 5000)
        let store = Store(storage: StoreStorage(FakeNativeDisk().open(), now: { clock.t }), now: { clock.t }, budgets: S.budgets(1), dates: shanghai)
        XCTAssertEqual(store.load()["available"], .bool(true))
        let r = store.seed(.object(state), label: "eq-seed")
        XCTAssertEqual(r["ok"], .bool(true), "\(name) seed: \(str(r))")
        for t in texts {
            for (mode, cur, sel) in [("lookup", "", [String]()), ("pick", "", Array(Self.deck.prefix(3))), ("lookup", Self.deck[0], [])] {
                let a = JSObject([("mode", .string(mode)), ("text", .string(t)), ("cur", .string(cur)), ("selected", .array(sel.map { .string($0) }))])
                same(Self.text(QueryRef.reply(store, a)), Self.text(PageAPI.call("view.query", store: store, args: a)), "\(name) store \(mode) \(t.prefix(16))")
            }
        }
    }

    /// 草稿上的比较 + Store 上的比较 + 新旧耗时。
    func checkScale(_ state: JSObject, _ name: String, pastedChars: Int) {
        let t0 = DispatchTime.now().uptimeNanoseconds
        let pool = Self.recordChars(state, limit: 40)
        let han10 = pool.prefix(10).joined()
        checkState(state, name, pinyin: ["shi", "s", "ren", "zzz"], pastedChars: pastedChars, wide: false)
        for t in [han10, pool.suffix(10).joined(), String(pool.last ?? "")] {
            check(Self.args(state, text: t, mode: "lookup", cur: "", selected: [], policy: Config.policy), dates: shanghai, sheet: true, "\(name) pool")
        }
        checkStore(state, name, texts: [han10, "shi", "s", pool.first ?? "", Self.pasted(80)])
        print("BENCH query-eq-note scale=\(name) records=\(Query.flattenRecords(state["records"]).count) checks=\(B.fmt(Double(DispatchTime.now().uptimeNanoseconds - t0) / 1_000_000))ms")
        timeQueries(state, name, han10: han10, pastedChars: pastedChars)
    }

    /// 几种查询新旧各量（median；新的先跑一次不计 = 各月下标表已建好，App 里状态不变时连续打字就是这种）。
    func timeQueries(_ state: JSObject, _ name: String, han10: String, pastedChars: Int) {
        let reps = 3
        var sink = 0
        func med(_ body: () throws -> Void) -> Double { B.median((0..<reps).map { _ in B.time { try? body() } }.sorted()) }
        var cases = [("han10", han10), ("pinyin.shi", "shi"), ("pinyin.s", "s")]
        if pastedChars > 0 { cases.append(("pasted\(pastedChars)", Self.pasted(pastedChars))) }
        for (label, t) in cases {
            let a = Self.args(state, text: t, mode: "lookup", cur: "", selected: [], policy: Config.policy)
            _ = try? QueryView.querySheetModel(a, dates: shanghai)
            let old = med { sink &+= JSONWriter.stringify(try QueryRef.querySheetModel(a, dates: shanghai)).utf8.count }
            let new = med { sink &+= JSONWriter.stringify(try QueryView.querySheetModel(a, dates: shanghai)).utf8.count }
            print("BENCH query-path scale=\(name) query=\(label) old=\(B.fmt(old))ms new=\(B.fmt(new))ms")
        }
        print("BENCH query-eq-note sink=\(sink)")
    }

    static func requireScaleBench() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["SHIZI_SCALE_BENCH"] == "1", "3x / 10x query equivalence runs only with SHIZI_SCALE_BENCH=1 (CI release-bench step)")
    }

    func testScale1xMatchesReference() throws {
        checkScale(try B.heavyState(B.shape1x), "1x", pastedChars: 100)
    }

    func testScale3xFoldedMatchesReference() throws {
        checkScale(try J.foldedState(S.scale3xFolded()), "3x-folded", pastedChars: 0)
    }

    func testScaleHeavyMatchesReference() throws {
        try Self.requireScaleBench()
        checkScale(try B.heavyState(B.shape1x), "1x-pasted", pastedChars: 3000)
        for (name, shape) in [("3x", S.shape3x()), ("10x", S.shape10x())] {
            checkScale(try B.heavyState(shape), name, pastedChars: 1000)
        }
        checkScale(try J.foldedState(S.scale10xFolded()), "10x-folded", pastedChars: 1000)
    }
}

// MARK: - 参照：改动之前的写法（照抄）

enum QueryRef {
    static func writtenChars(_ records: [JSValue]) -> [String] {
        var out = OSet()
        for r in records {
            if Records.isJudged(r), case .string(let k)? = r["cardKey"], k.utf8.starts(with: "base:".utf8) {
                out.insert(String(decoding: Array(k.utf8).dropFirst(5), as: UTF8.self))
            }
        }
        return out.items
    }

    static func pinyinMatches(_ query: String, _ entries: [JSValue], written: [String]? = nil, max: JSValue? = nil) -> [String] {
        if query.isEmpty { return [] }
        let list = entries.filter { e in JSX.truthy(e) && JSX.truthy(e["char"]) && JSX.truthy(e["key"]) }
        func key(_ e: JSValue) -> String { Copy.jsString(e["key"]!) }
        var hits = list.filter { JSX.eq(key($0), query) }
        if hits.isEmpty { hits = list.filter { key($0).utf8.starts(with: query.utf8) } }
        var seen = OSet()
        let uniq = hits.filter { e in seen.insert(Copy.jsString(e["char"]!)) }
        var w = OSet()
        for c in written ?? [] { w.insert(c) }
        let chars = uniq.map { Copy.jsString($0["char"]!) }
        let out = chars.filter { w.contains($0) } + chars.filter { !w.contains($0) }
        let cap: Double
        if let m = max { if case .number(let d) = m { cap = d } else { cap = -1 } } else { cap = Double(Query.pinyinMax) }
        if cap.isFinite, cap.rounded(.towardZero) == cap, cap > 0 { return Array(out.prefix(cap > Double(out.count) ? out.count : Int(cap))) }
        return out
    }

    static func filterNotes(_ filtered: Query.Filtered?, view: String?) -> [JSValue] {
        var notes: [JSValue] = []
        guard let f = filtered else { return notes }
        if f.removed > 0 && f.chars.isEmpty {
            notes.append(.object(JSObject([("key", .string("R-Q03.onlyHanzi"))])))
        } else if f.removed > 0 {
            notes.append(.object(JSObject([("key", .string("R-Q03.removed")), ("vars", .object(JSObject([("n", .number(Double(f.removed)))])))])))
        }
        if !f.duplicates.isEmpty, let v = view, JSX.eq(v, "rows") {
            let listed = f.duplicates.filter { ch in f.chars.contains { JSX.eq($0, ch) } }
            if listed.count == 1 {
                notes.append(.object(JSObject([("key", .string("R-Q03.duplicate")), ("vars", .object(JSObject([("char", .string(listed[0]))])))])))
            } else if listed.count > 1 {
                let joined = listed.map { Query.openQuote + $0 + Query.closeQuote }.joined()
                notes.append(.object(JSObject([("key", .string("X-QUERY.duplicateMany")), ("vars", .object(JSObject([("chars", .string(joined))])))])))
            }
        }
        return notes
    }

    static func customChars(_ custom: JSValue?) -> [String] {
        guard case .array(let added)? = custom?["added"] else { return [] }
        var out: [String] = []
        for e in added {
            guard JSX.truthy(e), let c = e["char"], JSX.truthy(c) else { continue }
            out.append(Copy.jsString(c))
        }
        return out
    }

    static func isCustom(_ custom: JSValue?, _ char: String) -> Bool { customChars(custom).contains { JSX.eq($0, char) } }

    static func charSummary(_ char: String, records: [JSValue] = [], sched: JSValue? = nil, custom: JSValue? = nil, practicable: Bool = false) -> JSValue {
        let cardKey = Query.baseKey(char)
        let count = records.filter { Records.isJudged($0) && JSX.eq($0["cardKey"], cardKey) }.count
        let latest = count > 0 ? Records.latestJudgedByCard(records.filter { JSX.eq($0["cardKey"], cardKey) })[cardKey] : nil
        var due: JSValue = .null
        if let s = sched, case .object = s, let entry = s[cardKey], JSX.truthy(entry), case .string(let d)? = entry["due"] { due = .string(d) }
        var latestDay: JSValue = .null
        if let l = latest, let d = l["localDay"], JSX.truthy(d) { latestDay = d }
        return .object(JSObject([
            ("char", .string(char)),
            ("cardKey", .string(cardKey)),
            ("practicable", .bool(practicable)),
            ("custom", .bool(isCustom(custom, char))),
            ("count", .number(Double(count))),
            ("latest", (latest.map { Records.isJudged($0) ? $0 : .null }) ?? .null),
            ("latestDay", latestDay),
            ("due", due),
        ]))
    }

    static func sheetModel(_ a: JSObject, predicates: QueryView.Predicates? = nil) -> JSValue {
        let pred = predicates ?? QueryView.deckPredicates(a["state"]?["settings"])
        func practicable(_ c: String) -> Bool { Query.isPracticable(.string(c), inDeck: pred.inDeck, inLibrary: pred.inLibrary) }
        let state = a["state"], policy = ViewSupport.policy(a["policy"])
        let records = Query.flattenRecords(state?["records"])
        var filtered = Query.filterInput(a["text"], max: policy["queryInputMax"])
        let py = filtered.hanCount == 0 ? Query.parsePinyinInput(a["text"]) : nil
        var pinyin: JSValue? = nil
        if let py {
            let chars = pinyinMatches(JS.string(py["query"]), pred.pinyinEntries(), written: writtenChars(records))
            pinyin = ViewSupport.obj([("raw", py["raw"]!), ("count", .number(Double(chars.count)))])
            filtered = Query.Filtered(chars: chars, removed: 0, duplicates: [], hanCount: 0, overLimit: 0, total: filtered.total)
        }
        let v = Query.queryView(chars: filtered.chars, cur: a["cur"]?.stringValue ?? "", practicable: practicable)
        let summaries = filtered.chars.map { charSummary($0, records: records, sched: state?["sched"], custom: state?["custom"], practicable: practicable($0)) }
        let chosen = a["mode"] == .string("pick") ? Query.selectedChars(filtered.chars, (a["selected"]?.arrayValue ?? []).compactMap(\.stringValue), practicable: practicable) : []
        let notes: [JSValue]
        if let pinyin { notes = JS.number(pinyin["count"]) > 0 ? [] : [QueryView.entry("X-QUERY.pinyinNone", ViewSupport.obj([("char", pinyin["raw"]!)]))] }
        else { notes = filterNotes(filtered, view: v.view) }
        return ViewSupport.obj([("filtered", filtered.js), ("view", .string(v.view)), ("cur", .string(v.cur)), ("notes", .array(notes)), ("pinyin", .bool(pinyin != nil)), ("summaries", .array(summaries)), ("summary", v.cur.isEmpty ? .null : summaries.first { $0["char"] == .string(v.cur) } ?? .null), ("multi", .bool(filtered.chars.count > 1)), ("chosen", .array(chosen.map(JSValue.string))), ("bar", a["mode"] == .string("pick") && ["hint", "rows"].contains(v.view) ? Query.pickBar(.number(Double(chosen.count))) : .null)])
    }

    static func querySheetModel(_ a: JSObject, predicates: QueryView.Predicates? = nil, dates: Dates) throws -> JSValue {
        let pred = predicates ?? QueryView.deckPredicates(a["state"]?["settings"])
        let m = sheetModel(a, predicates: pred), mode = a["mode"] ?? .null, view = JS.string(m["view"]), cur = m["cur"]!
        var rows: [JSValue] = [], card: JSValue = .null, bad: JSValue = .null
        if view == "rows" {
            rows = (m["summaries"]?.arrayValue ?? []).map { s in
                let c = pred.card(JS.string(s["char"]))
                return ViewSupport.obj([("char", s["char"]!), ("pinyin", c?["py"] ?? .string("")), ("word", c?["word"] ?? .string("")), ("status", QueryView.normalized(Query.rowStatus(s))), ("selectable", .bool(mode == .string("pick") && JS.truthy(s["practicable"]))), ("selected", .bool(m["chosen"]!.arrayValue!.contains(s["char"]!))), ("practicable", .bool(JS.truthy(s["practicable"]))), ("custom", .bool(JS.truthy(s["custom"]))), ("count", s["count"]!)])
            }
        }
        if ["card", "bad"].contains(view), let s = m["summary"], JS.truthy(s) {
            let c = pred.card(JS.string(cur))
            var common = JSObject([("char", cur), ("pinyin", c?["py"] ?? .string("")), ("word", c?["word"] ?? .string("")), ("strokes", c?["strokes"] ?? .number(0)), ("custom", .bool(JS.truthy(s["custom"]))), ("count", s["count"]!)])
            if view == "card" {
                let ink = try QueryView.inkPointsOf(s, state: a["state"], dates: dates)
                common["meta"] = QueryView.cardMetaRef(common["pinyin"], common["strokes"]); common["stat"] = QueryView.cardStatRef(s); common["ink"] = ink
                common["inkStrokes"] = JS.truthy(ink) ? try QueryView.sheetStrokes(a["state"], s["latest"], dates: dates) : .array([])
                card = .object(common)
            } else {
                common["title"] = QueryView.entry("R-Q05.unavailableTitle", ViewSupport.obj([("char", cur)])); common["reason"] = QueryView.entry("R-Q05.unavailableReason"); common["source"] = QueryView.entry("R-Q05.unavailableSource"); bad = .object(common)
            }
        }
        var bar = m["bar"] ?? .null
        if JS.truthy(bar) { var b = QueryView.normalized(bar).objectValue!; b["disabled"] = .bool(JS.truthy(bar["disabled"])); bar = .object(b) }
        return ViewSupport.obj([("mode", mode), ("title", QueryView.entry(mode == .string("pick") ? "R-Q01.titlePick" : "R-Q01.titleLookup")), ("placeholder", QueryView.entry("R-Q01.placeholder")), ("view", .string(view)), ("cur", cur), ("multi", m["multi"]!), ("notes", .array(m["notes"]!.arrayValue!.map(QueryView.normalized))), ("hint", view == "hint" ? QueryView.entry("R-Q02.pickNote") : view == "rows" ? QueryView.entry("R-Q02.lookupNote") : .null), ("rows", .array(rows)), ("card", card), ("bad", bad), ("back", JS.truthy(m["multi"]) && ["card", "bad"].contains(view) ? QueryView.entry("R-Q05.backToList", ViewSupport.obj([("n", .number(Double(m["filtered"]!["chars"]!.arrayValue!.count)))])) : .null), ("bar", bar), ("chosen", m["chosen"]!), ("ink", !(card["inkStrokes"]?.arrayValue ?? []).isEmpty ? try ViewSupport.inkParams(ViewSupport.policy(a["policy"])) : .null)])
    }

    /// PageAPI.call("view.query")（QueryAPI 的拼法，无 hooks：不加 addLines / detailLines），参照的模型。
    static func reply(_ store: Store, _ a: JSObject) -> JSValue {
        var args = JSObject([("mode", .string(a["mode"] == .string("pick") ? "pick" : "lookup")), ("text", .string(a["text"]?.stringValue ?? "")), ("cur", .string(a["cur"]?.stringValue ?? "")), ("selected", .array(a["selected"]?.arrayValue ?? [])), ("state", .object(store.state))])
        args["policy"] = Config.policy
        do {
            let view = try querySheetModel(args, dates: store.dates)
            return JS.obj([("ok", .bool(true)), ("view", view)])
        } catch let error as CoreError {
            return JS.obj([("ok", .bool(false)), ("error", JS.obj([("kind", .string("exception")), ("reason", .string(error.message))]))])
        } catch {
            return JS.obj([("ok", .bool(false)), ("error", JS.obj([("kind", .string("exception")), ("reason", .string(String(describing: error)))]))])
        }
    }
}
