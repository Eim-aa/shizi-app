import Foundation
import XCTest
@testable import ShiziCore

// 判字 / 看答案 / 撤销跳过 / 结束一组 / 结果页 / 写字页快照改用 RecordLookup（只看可能命中的记录：这个字 / 这一组 / 这个记录号，
// 旧月的索引记住不重建，判一次只重建当月）之后的等价性。
// 参照 = 改动之前的写法（照抄在下面的 JudgeRef 里：展开全部记录再筛、Budget.pruneInkOfCards 的逐月扫描、旧的 ResultModels.cells / model），
// 新旧两边从同一个状态出发，逐字节比：写出的状态（JSONWriter.stringify，键序也算）、返回的记录 / reused、抛出的错误、回包 JSON、磁盘上的每个键。
//   · 夹具：Fixtures 里出现的每一个 store 状态（records 是对象、有 sessions 键的对象），各槽的当前字都判一遍（对 / 错、写不写墨迹、几个时刻与时区）；
//   · 随机历史：多个月（乱序的月键、折叠月 kept、没有 folded 标记的 kept、坏月值）、几个字（含规范等价但字节不同的 cardKey）、纸上记录、跳过、
//     看过答案、重复 / 不合法的 id、相同的时刻、本组旧月里已有的判断（沿用分支）、月界上的「今天」、比记录早 / 晚的「今天」、不同时区，连续判几次；
//   · ScaleBenchmarkTests 的状态（只用它的静态生成器）：1x / 3x / 10x（未折叠）直接在草稿上比；3x-folded / 10x-folded 先像 App 一样折叠，再在两个 Store 上各走一串
//     judge（新 = WriteAPI.call，旧 = 参照的 commitJudgment + 同样拼回包）。3x / 10x（未折叠）与 10x-folded 只在 SHIZI_SCALE_BENCH=1 时跑。
// 写字页快照（WriteModels.line）里的 SessionWrites.find 两边都是新的；所以每一步之后另用新旧 find 比各槽 lastLine.recordId 与新写的记录号
// （checkFind），checkLookups 的 id 也总带上它们与每个月末尾几条（刚写进、索引刚重建的当月记录）。
// 另打印判字路径各步新旧的耗时（BENCH judge-path …；只打印，不断言耗时）。
final class JudgeScaleEquivalenceTests: XCTestCase {
    typealias B = StoreCommitBenchmarkTests
    typealias S = ScaleBenchmarkTests

    override func setUp() {
        super.setUp()
        JSMath.flavor = .v8
    }

    // MARK: 小工具

    static func text(_ v: JSValue?) -> String { v.map { JSONWriter.stringify($0) } ?? "<nil>" }
    static func texts(_ list: [JSValue]) -> String { JSONWriter.stringify(.array(list)) }

    /// 跑 body：成功给 "ok " + 结果，抛错给 "throw " + 错误。
    static func outcome(_ body: () throws -> String) -> String {
        do { return "ok " + (try body()) } catch { return "throw " + String(describing: error) }
    }

    /// 两串逐字节相同；不同时只报第一个不同的位置与前后一小段（状态可能有几 MB，不整串打印）。
    func same(_ a: String, _ b: String, _ label: String, file: StaticString = #filePath, line: UInt = #line) {
        if a.utf8.elementsEqual(b.utf8) { return }
        let x = Array(a.utf8), y = Array(b.utf8)
        var i = 0
        while i < x.count && i < y.count && x[i] == y[i] { i += 1 }
        func around(_ u: [UInt8]) -> String { String(decoding: u[max(0, min(u.count, i) - 120)..<min(u.count, i + 120)], as: UTF8.self) }
        XCTFail("\(label): differ at byte \(i) (lengths \(x.count) / \(y.count))\n old: …\(around(x))…\n new: …\(around(y))…", file: file, line: line)
    }

    static let zones: [Dates] = ["Asia/Shanghai", "America/Sao_Paulo", "Pacific/Kiritimati", "UTC"].map { Dates(timeZone: TimeZone(identifier: $0)!) }

    /// 判断的时刻：基准日（2026-10-21）、上海 10 月最后一毫秒 / 11 月第一毫秒、比所有记录都早、远在以后。
    static let moments: [Double] = [
        B.benchNow,
        localMs(2026, 11, 1, 0) - 1, localMs(2026, 11, 1, 0),
        localMs(2025, 1, 1, 0), localMs(2027, 1, 15, 12),
    ]

    // MARK: 单个状态上的比较

    /// 状态里的会话（A、B、lastEnded.A / B）与槽名。
    static func sessions(_ state: JSObject) -> [(slot: String, session: JSValue)] {
        var out: [(slot: String, session: JSValue)] = []
        for slot in ["A", "B"] {
            if let s = state["sessions"]?[slot], case .object = s { out.append((slot, s)) }
            if let s = state["sessions"]?["lastEnded"]?[slot], case .object = s { out.append((slot, s)) }
        }
        return out
    }

    /// 均匀取样并按文字去重，最多 limit 个。
    static func sample(_ values: [JSValue?], limit: Int) -> [JSValue?] {
        var seen = Set<String>(), out: [JSValue?] = []
        let step = max(1, values.count / max(1, limit))
        var i = 0
        while i < values.count && out.count < limit {
            if seen.insert(text(values[i])).inserted { out.append(values[i]) }
            i += step
        }
        return out
    }

    /// 各槽（含 lastEnded）的 lastLine.recordId：写字页快照（WriteModels.line）就是拿它 SessionWrites.find。
    static func lastLineIds(_ state: JSObject) -> [JSValue?] { sessions(state).map { $0.session["lastLine"]?["recordId"] } }

    /// 每个月列表（展开取的那份）末尾几条的 id：刚写进当月、当月索引刚重建过的记录，均匀取样常常取不到它们。
    static func newestIds(_ state: JSObject, perMonth: Int = 3) -> [JSValue?] {
        var out: [JSValue?] = []
        for (_, v) in state["records"]?.objectValue?.entries ?? [] {
            if let list = RecordLookup.flatList(v) { out += list.suffix(perMonth).map { $0["id"] } }
        }
        return out
    }

    /// 快照里那次 find（与新写的记录号）：新旧逐个比。
    func checkFind(_ state: JSObject, _ ids: [JSValue?], _ label: String) {
        for id in Self.lastLineIds(state) + ids {
            same(Self.text(JudgeRef.find(state, id)), Self.text(SessionWrites.find(state, id)), "\(label) find \(Self.text(id))")
        }
    }

    /// find / seen / judgedCount / pruneInkOfCards（mine 与整次回收）/ TodayPlan.summary / ResultModels.cells / model：新旧逐个比。limit：每类取样个数。
    func checkLookups(_ state: JSObject, _ label: String, limit: Int = 200, dates: Dates = shanghai) {
        let all = JudgeRef.all(state)
        let odd: [JSValue?] = [nil, .null, .number(1), .bool(true), .string(""), .string("r999999999"), .string("base:\u{00E9}"), .string("base:e\u{0301}"), .string("s1")]
        let ids = Self.sample(all.map { $0["id"] }, limit: limit) + odd + Self.lastLineIds(state) + Self.newestIds(state)
        let keys = Self.sample(all.map { $0["cardKey"] }, limit: limit) + odd
        let sids = Self.sample(all.map { $0["sessionId"] }, limit: limit) + odd
        for id in ids {
            same(Self.text(JudgeRef.find(state, id)), Self.text(SessionWrites.find(state, id)), "\(label) find \(Self.text(id))")
        }
        for id in sids {
            XCTAssertEqual(JudgeRef.judgedCount(state, id), SessionWrites.judgedCount(state, id), "\(label) judgedCount \(Self.text(id))")
        }
        let sessions = Self.sessions(state)
        for (_, s) in sessions {
            var ks = keys
            for q in s["queue"]?.arrayValue ?? [] { ks.append(q) }
            for k in ks {
                same(Self.text(JudgeRef.seen(state, s, k)), Self.text(SessionWrites.seen(state, s, k)), "\(label) seen \(Self.text(s["id"])) \(Self.text(k))")
            }
            XCTAssertEqual(TodayPlan.summary(s, records: all), TodayPlan.summary(s, records: RecordLookup.forSummary(state, s)), "\(label) summary \(Self.text(s["id"]))")
        }
        if let recs = state["records"] {
            for k in keys.prefix(min(60, limit)) {
                guard let key = k?.stringValue else { continue }
                same(Self.texts(JudgeRef.mine(recs, KeySet([key]))), Self.texts(RecordLookup.recordsOfCards(recs, KeySet([key]))), "\(label) mine \(key)")
                var dOld = state, dNew = state
                let droppedOld = Budget.pruneInkOfCards(&dOld, [key], dates: dates)
                let droppedNew = Budget.pruneInkOfCards(&dNew, [key], dates: dates) { r, w in RecordLookup.recordsOfCards(r, w) }
                same(Self.texts(droppedOld) + Self.text(.object(dOld)), Self.texts(droppedNew) + Self.text(.object(dNew)), "\(label) pruneInk \(key)")
            }
            let two = Array(keys.compactMap { $0?.stringValue }.prefix(3))
            same(Self.texts(JudgeRef.mine(recs, KeySet(two))), Self.texts(RecordLookup.recordsOfCards(recs, KeySet(two))), "\(label) mine \(two)")
        }
        var asks: [JSObject] = []
        for (slot, s) in sessions {
            asks.append(JSObject([("slot", .string(slot)), ("sessionId", s["id"] ?? .null)]))
            asks.append(JSObject([("sessionId", s["id"] ?? .null)]))
        }
        asks.append(JSObject([("slot", .string("B")), ("sessionId", .string("s404"))]))
        for a in asks {
            let tag = "\(label) result \(Self.text(.object(a)))"
            same(Self.outcome { Self.texts(try JudgeRef.cells(state, a)) }, Self.outcome { Self.texts(try ResultModels.cells(state, a)) }, tag + " cells")
            same(Self.outcome { Self.text(try JudgeRef.model(state, a, dates: dates)) }, Self.outcome { Self.text(try ResultModels.model(state, a, dates: dates)) }, tag + " model")
        }
    }

    /// 在 state 上判一次：新旧各从同一份草稿出发，比写出的草稿、返回的记录 / reused、错误。两边相同且成功时返回新的草稿。
    @discardableResult
    func checkJudge(_ state: JSObject, _ a: JSObject, at: Double, dates: Dates, _ label: String) -> JSObject? {
        let strokes = B.rawStrokes(3, seed: Int(at.truncatingRemainder(dividingBy: 97)))
        var dOld = state, dNew = state
        var nOld = 0, nNew = 0
        let old = Self.outcome {
            let r = try JudgeRef.judgeInDraft(&dOld, a, strokes: strokes, at: at, nextId: { nOld += 1; return "r9000\(nOld)" }, inkFormat: "raw", dates: dates)
            return Self.text(r.record) + " reused=\(r.reused) " + Self.text(.object(dOld))
        }
        let new = Self.outcome {
            let r = try SessionWrites.judgeInDraft(&dNew, a, strokes: strokes, at: at, nextId: { nNew += 1; return "r9000\(nNew)" }, inkFormat: "raw", dates: dates)
            return Self.text(r.record) + " reused=\(r.reused) " + Self.text(.object(dNew))
        }
        same(old, new, label)
        return old.utf8.elementsEqual(new.utf8) && old.hasPrefix("ok ") ? dNew : nil
    }

    /// 判断的参数：当前字（或故意不给）、对错、提示数、写不写墨迹（nil = 按 policy）。
    static func judgeArgs(_ slot: String, _ key: JSValue?, judgment: String, hints: Int, ink: Bool?) -> JSObject {
        var a = JSObject([("slot", .string(slot)), ("judgment", .string(judgment)), ("hints", .number(Double(hints)))])
        if let key { a["cardKey"] = key }
        if let ink { a["perRecordInk"] = .bool(ink) }
        return a
    }

    /// 各槽的当前字都判一遍（几种参数、时刻、时区），外加不是当前字 / 没给字 / 坏的对错。
    func checkJudgesOn(_ state: JSObject, _ label: String, wide: Bool) {
        for slot in ["A", "B"] {
            guard let s = SessionWrites.session(state, slot) else { continue }
            let key = SessionRules.currentCardKey(s)
            var n = 0
            for (mi, at) in Self.moments.enumerated() where wide || mi < 2 {
                for (zi, dates) in Self.zones.enumerated() where wide || zi == 0 {
                    for judgment in ["correct", "wrong"] {
                        n += 1
                        checkJudge(state, Self.judgeArgs(slot, key, judgment: judgment, hints: n % 3, ink: n % 2 == 0 ? true : nil), at: at, dates: dates, "\(label) judge \(slot) #\(n)")
                    }
                }
            }
            checkJudge(state, Self.judgeArgs(slot, .string("base:\u{4E00}"), judgment: "correct", hints: 0, ink: nil), at: B.benchNow, dates: shanghai, "\(label) judge \(slot) other-key")
            checkJudge(state, Self.judgeArgs(slot, nil, judgment: "correct", hints: 0, ink: nil), at: B.benchNow, dates: shanghai, "\(label) judge \(slot) no-key")
            checkJudge(state, Self.judgeArgs(slot, key, judgment: "maybe", hints: 0, ink: nil), at: B.benchNow, dates: shanghai, "\(label) judge \(slot) bad-judgment")
        }
    }

    /// 从 start 起在 A 槽连续判 count 次（每次新旧都比，接着用新的结果；会走到重考、组完）；lookups：每步之后也比查找类。
    func judgeSequence(_ start: JSObject, _ label: String, count: Int, rng: inout EqRNG, lookups: Bool = true) {
        var state = start
        for i in 0..<count {
            guard let s = SessionWrites.session(state, "A") else { return }
            let key = SessionRules.currentCardKey(s)
            let at = Self.moments[Int(rng.next() % UInt64(Self.moments.count))] + Double(i) * 1000
            let dates = Self.zones[Int(rng.next() % UInt64(Self.zones.count))]
            let a = Self.judgeArgs("A", key, judgment: rng.next() % 3 == 0 ? "wrong" : "correct", hints: Int(rng.next() % 4), ink: rng.next() % 2 == 0)
            guard let next = checkJudge(state, a, at: at, dates: dates, "\(label) seq \(i)") else { return }
            state = next
            // 新写的记录号是 r9000…（checkJudge 的 nextId），各槽 lastLine 指向它或沿用的那条
            let written: [JSValue?] = [JSValue.string("r90001"), JSValue.string("r90002")]
            checkFind(state, written + Self.newestIds(state, perMonth: 1), "\(label) seq \(i)")
            if lookups { checkLookups(state, "\(label) seq \(i)", limit: 40, dates: dates) }
        }
    }

    // MARK: 夹具

    static let fixtureNames = ["backup-roundtrip", "images-selection", "native-rows", "nav", "schema", "session-contract", "views-basic", "views-pages"]

    /// 夹具里所有像 store 状态的对象（records 是对象、且有 sessions 键），按文字去重。
    static func fixtureStates() throws -> [JSObject] {
        var out: [JSObject] = [], seen = Set<String>()
        func walk(_ v: JSValue) {
            switch v {
            case .object(let o):
                if case .object? = o["records"], o["sessions"] != nil, seen.insert(JSONWriter.stringify(v)).inserted { out.append(o) }
                for (_, w) in o.entries { walk(w) }
            case .array(let a):
                for w in a { walk(w) }
            default:
                break
            }
        }
        for name in fixtureNames { walk(.object(try loadFixture(name))) }
        return out
    }

    func testFixtureStatesMatchReference() throws {
        let states = try Self.fixtureStates()
        XCTAssertGreaterThan(states.count, 100, "fixtures must hold store states")
        var withCurrent = 0
        for (i, state) in states.enumerated() {
            checkLookups(state, "fixture \(i)")
            if let s = SessionWrites.session(state, "A"), SessionRules.currentCardKey(s)?.stringValue != nil { withCurrent += 1 }
            checkJudgesOn(state, "fixture \(i)", wide: i % 4 == 0)
        }
        XCTAssertGreaterThan(withCurrent, 20, "fixture states must have cards to judge")
        print("BENCH judge-eq-note fixtures states=\(states.count) withCurrent=\(withCurrent)")
    }

    // MARK: 随机历史

    static let chars = [cRen, cKou, cDa, cTian, cShui, "\u{00E9}"]
    /// 末两个：custom 卡；与 base:é 规范等价但字节不同的 cardKey（索引按规范等价分组，原条件按字节比——两者必须仍然不相等）。
    static let keys = chars.map { "base:" + $0 } + ["custom:" + cShan, "base:e\u{0301}"]
    static let sessionIds = ["s7", "s8", "s9", "s07"]
    static let monthPool = ["2024-12", "2025-01", "2025-06", "2025-12", "2026-01", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]

    static func pick<T>(_ list: [T], _ rng: inout EqRNG) -> T { list[Int(rng.next() % UInt64(list.count))] }
    static func chance(_ percent: UInt64, _ rng: inout EqRNG) -> Bool { rng.next() % 100 < percent }

    static func randomRecord(_ serial: inout Int, month: String, previous: JSValue?, usedIds: [String], rng: inout EqRNG) -> JSValue {
        if chance(4, &rng) { return chance(50, &rng) ? .null : .number(3) }
        serial += 1
        var o = JSObject()
        if chance(8, &rng), !usedIds.isEmpty {
            o["id"] = .string(pick(usedIds, &rng)) // 重复的 id
        } else if chance(4, &rng) {
            o["id"] = pick([JSValue.string("r0\(serial)"), .string("x\(serial)"), .number(Double(serial)), .string("r" + String(repeating: "9", count: 25))], &rng)
        } else {
            // id 总是有（缺 id 的记录会让 ResultModels.items 里原有的强制解包在新旧两边一样地崩，不在这里试）
            o["id"] = .string("r\(serial)")
        }
        let key = pick(keys, &rng)
        o["cardKey"] = chance(5, &rng) ? .null : .string(key)
        if let ch = SchedRecords.charOfCardKey(key) { o["char"] = .string(ch) }
        if !chance(4, &rng) { o["sessionId"] = .string(pick(sessionIds, &rng)) }
        let kind = pick(["judged", "judged", "judged", "answer-seen", "answer-seen", "skipped", "skipped", "other"], &rng)
        o["kind"] = .string(kind)
        let day = month + "-" + B.pad2(1 + Int(rng.next() % 28))
        if chance(15, &rng), let p = previous?["at"] {
            o["at"] = p // 与上一条同一时刻
        } else {
            o["at"] = .number(dayMs(day, Int(rng.next() % 24)) + Double(rng.next() % 3_600_000))
        }
        o["localDay"] = .string(day)
        o["help"] = .object(JSObject([("hints", .number(Double(rng.next() % 3))), ("answerSeen", .bool(kind == "answer-seen")), ("traced", .bool(chance(30, &rng)))]))
        if kind == "judged" { o["judgment"] = .string(chance(30, &rng) ? "wrong" : "correct") }
        if chance(15, &rng) { o["source"] = .string("paper") }
        return .object(o)
    }

    static func randomSession(_ id: String, slot: String, ids: [String], rng: inout EqRNG) -> JSValue {
        var queue: [String] = []
        for k in keys.shuffled(using: &rng) where queue.count < 4 { queue.append(k) }
        let cursor = Int(rng.next() % UInt64(queue.count + 1))
        var items: [JSValue] = []
        for (i, k) in queue.prefix(cursor).enumerated() {
            let kind = pick(["judged", "judged", "answer-seen", "skipped"], &rng)
            let rid = ids.isEmpty || chance(10, &rng) ? "r\(800 + i)" : pick(ids, &rng)
            items.append(.object(JSObject([("cardKey", .string(k)), ("recordId", .string(rid)), ("kind", .string(kind))])))
        }
        return .object(JSObject([
            ("id", .string(id)), ("slot", .string(slot)), ("kind", .string(pick(["daily", "picked"], &rng))), ("source", .object(JSObject([("view", .string("home"))]))),
            ("queue", .array(queue.map { .string($0) })), ("cursor", .number(Double(cursor))), ("items", .array(items)),
            ("current", .object(JSObject([("phase", .string("recall")), ("strokes", .array([])), ("hints", .number(Double(rng.next() % 3))), ("answerSeen", .bool(chance(20, &rng)))]))),
            ("lastLine", .null), ("startedAt", .number(B.benchNow - 600_000)), ("startedDay", .string("2026-10-21")), ("updatedAt", .number(B.benchNow - 60_000)),
        ]))
    }

    static func randomState(_ rng: inout EqRNG) throws -> JSObject {
        var months = monthPool.filter { _ in chance(55, &rng) }
        if months.isEmpty { months = ["2026-10"] }
        if chance(35, &rng) { months.shuffle(using: &rng) } // 月键插入序不按时间（展开顺序按键序，「最后一条」跟着它）
        var records = JSObject(), ink = JSObject(), serial = 0, ids: [String] = []
        var previous: JSValue? = nil
        for month in months {
            var list: [JSValue] = []
            for _ in 0..<Int(rng.next() % 13) {
                let r = randomRecord(&serial, month: month, previous: previous, usedIds: ids, rng: &rng)
                if let id = r["id"]?.stringValue { ids.append(id) }
                previous = r
                list.append(r)
            }
            let shape = rng.next() % 100
            if shape < 60 {
                records[month] = .array(list)
                for r in list where chance(30, &rng) {
                    guard let id = r["id"]?.stringValue else { continue }
                    var t = ink[month]?.objectValue ?? JSObject()
                    t[id] = inkEntry(4, 2)
                    ink[month] = .object(t)
                }
            } else if shape < 85 {
                records[month] = .object(JSObject([("folded", .bool(true)), ("month", .string(month)), ("byDay", .object(JSObject())), ("chars", .array([])), ("kept", .array(list))]))
            } else if shape < 92 {
                records[month] = .object(JSObject([("kept", .array(list))])) // 没有 folded：展开取 kept，回收（monthRecords）不取
            } else if shape < 96 {
                records[month] = .object(JSObject([("folded", .bool(true)), ("month", .string(month))]))
            } else {
                records[month] = .null
            }
        }
        let aId = pick(sessionIds, &rng)
        var A = randomSession(aId, slot: "A", ids: ids, rng: &rng)
        // 本组在某个（可能是旧的、折叠的）月里已有当前字的判断 → 沿用分支；有时两条在不同月（取展开顺序的最后一条）
        if chance(35, &rng), let key = SessionRules.currentCardKey(A), case .string(let k) = key {
            for _ in 0..<(chance(30, &rng) ? 2 : 1) {
                let month = pick(months, &rng)
                serial += 1
                let r = JSValue.object(JSObject([("id", .string("r\(serial)")), ("cardKey", key), ("char", .string(SchedRecords.charOfCardKey(k) ?? "")), ("sessionId", .string(aId)),
                                                 ("kind", .string("judged")), ("at", .number(dayMs(month + "-05"))), ("localDay", .string(month + "-05")),
                                                 ("help", .object(JSObject([("hints", .number(0)), ("answerSeen", .bool(false)), ("traced", .bool(false))]))), ("judgment", .string("correct"))]))
                if case .array(let l)? = records[month] {
                    records[month] = .array(l + [r])
                } else if case .object(var o)? = records[month], case .array(let l)? = o["kept"] {
                    o["kept"] = .array(l + [r])
                    records[month] = .object(o)
                }
            }
        }
        if chance(8, &rng), case .object(var o) = A { o["cursor"] = .number(1.5); A = .object(o) }
        var sched = JSObject()
        for (i, k) in keys.enumerated() {
            let p = rng.next() % 100
            if p < 45 {
                var e = try B.schedEntry(lastMs: B.benchNow - Double(1 + i) * ONE_DAY_MS, scheduledDays: 3 + i, reps: 2 + i % 3, stability: 4.5)
                if chance(25, &rng), case .object(var o) = e { o["seenAgainDay"] = .string(pick(["2026-10-21", "2026-11-01", "2026-10-31"], &rng)); e = .object(o) }
                sched[k] = e
            } else if p < 65 {
                sched[k] = .object(JSObject([("due", .string("2026-10-01")), ("lastJudgedAt", .number(B.benchNow - ONE_DAY_MS))])) // 没有 fsrs：判断时看「之前看过答案没有」
            }
        }
        var lastEnded = JSObject()
        if chance(30, &rng) { lastEnded["A"] = randomSession(pick(sessionIds, &rng), slot: "A", ids: ids, rng: &rng) }
        let B2: JSValue = chance(40, &rng) ? randomSession(pick(sessionIds, &rng), slot: "B", ids: ids, rng: &rng) : .null
        let sessions = JSObject([("A", A), ("B", B2), ("lastEnded", .object(lastEnded))])
        let monthList: [JSValue] = months.sorted().map { .string($0) }
        return JSObject([
            ("meta", .object(JSObject([("schema", .number(2)), ("serial", .number(Double(serial))), ("createdAt", .number(T0)), ("months", .array(monthList))]))),
            ("records", .object(records)), ("sched", .object(sched)), ("ink", .object(ink)),
            ("custom", .object(JSObject([("added", .array([]))]))), ("wordOff", .object(JSObject())),
            ("settings", .object(JSObject([("library", .string("common"))]))), ("photos", .null), ("legacy", .null), ("backupMeta", .null),
            ("sessions", .object(sessions)), ("funnel", .null), ("safety", .null),
        ])
    }

    func testRandomHistoriesMatchReference() throws {
        var rng = EqRNG(seed: 20261105)
        var reused = 0, fresh = 0
        for round in 0..<160 {
            let state = try Self.randomState(&rng)
            checkLookups(state, "random \(round)", limit: 80)
            checkJudgesOn(state, "random \(round)", wide: round % 8 == 0)
            if let s = SessionWrites.session(state, "A"), let key = SessionRules.currentCardKey(s), case .string = key {
                if JudgeRef.all(state).contains(where: { Records.isJudged($0) && $0["sessionId"] == s["id"] && $0["cardKey"] == key }) { reused += 1 } else { fresh += 1 }
            }
            judgeSequence(state, "random \(round)", count: 5, rng: &rng)
        }
        XCTAssertGreaterThan(reused, 10, "the reuse branch must be exercised")
        XCTAssertGreaterThan(fresh, 30, "the new-record branch must be exercised")
        print("BENCH judge-eq-note random reusedStates=\(reused) newStates=\(fresh)")
    }

    /// 索引只认「同一块存储」：同一个月键先后给内容不同的列表（同长、只换一条），查到的都是各自列表里的记录。
    func testIndexFollowsListIdentity() {
        let a = srec(1, cRen, day: "2026-10-02"), b = srec(2, cKou, day: "2026-10-02"), c = srec(3, cRen, day: "2026-10-03")
        let ren = JSValue.string("base:" + cRen), kou = JSValue.string("base:" + cKou)
        var state = JSObject([("records", .object(JSObject([("2026-10", .array([a, b]))])))])
        XCTAssertEqual(RecordLookup.records(state, .card, ren).map { $0["id"]! }, [.string("r1")])
        state["records"] = .object(JSObject([("2026-10", .array([c, b]))]))
        XCTAssertEqual(RecordLookup.records(state, .card, ren).map { $0["id"]! }, [.string("r3")])
        XCTAssertEqual(RecordLookup.records(state, .card, kou).map { $0["id"]! }, [.string("r2")])
        // 折叠月的 kept 也收；不是字串的值退回全部记录
        state["records"] = .object(JSObject([("2026-09", .object(JSObject([("folded", .bool(true)), ("kept", .array([a]))]))), ("2026-10", .array([b, c]))]))
        XCTAssertEqual(RecordLookup.records(state, .card, ren).map { $0["id"]! }, [.string("r1"), .string("r3")])
        XCTAssertEqual(RecordLookup.records(state, .card, nil).count, 3)
        XCTAssertEqual(RecordLookup.records(state, .session, .string("s1")).count, 3)
        XCTAssertEqual(RecordLookup.records(state, .id, .string("r2")).map { $0["id"]! }, [.string("r2")])
        // 规范等价但字节不同的 cardKey 进候选，但原条件（逐字节）不认
        state["records"] = .object(JSObject([("2026-10", .array([srec(4, "e\u{0301}", kind: "answer-seen", day: "2026-10-04")]))]))
        XCTAssertEqual(RecordLookup.records(state, .card, .string("base:\u{00E9}")).count, 1)
        XCTAssertNil(SessionWrites.seen(state, sessionJS(1), .string("base:\u{00E9}")))
        XCTAssertNotNil(SessionWrites.seen(state, sessionJS(1), .string("base:e\u{0301}")))
        // 重复的记录号：全部下标、按列表顺序（第一个记在 firstById，出现第二次起进 dupeIds）
        let dup = srec(2, cTian, day: "2026-10-05")
        state["records"] = .object(JSObject([("2026-10", .array([b, a, dup, c, dup]))]))
        XCTAssertEqual(RecordLookup.records(state, .id, .string("r2")).map { $0["char"]! }, [.string(cKou), .string(cTian), .string(cTian)])
        XCTAssertEqual(RecordLookup.records(state, .id, .string("r1")).map { $0["char"]! }, [.string(cRen)])
        // 月变成 null（旧索引清掉）再变回数组：照新列表查
        state["records"] = .object(JSObject([("2026-10", .null)]))
        XCTAssertEqual(RecordLookup.records(state, .id, .string("r2")).count, 0)
        state["records"] = .object(JSObject([("2026-10", .array([c]))]))
        XCTAssertEqual(RecordLookup.records(state, .id, .string("r3")).count, 1)
        XCTAssertEqual(RecordLookup.records(state, .id, .string("r2")).count, 0)
    }

    // MARK: ScaleBenchmarkTests 的状态

    /// 3x / 10x-folded：与 ScaleBenchmarkTests 相同——放大预算播种，再用 App 的原生预算做一次真提交，让回收折叠旧月份、淘汰墨迹。
    static func foldedState(_ scale: S.Scale) throws -> JSObject {
        let state = try B.heavyState(scale.shape)
        let clock = B.Clock(B.benchNow)
        let disk = FakeNativeDisk()
        func store(_ factor: Double) -> Store { Store(storage: StoreStorage(disk.open(), now: { clock.t }), now: { clock.t }, budgets: S.budgets(factor), dates: shanghai) }
        let seeding = store(scale.seedFactor)
        XCTAssertEqual(seeding.load()["available"], .bool(true))
        let seeded = seeding.seed(.object(state), label: "eq-seed")
        XCTAssertEqual(seeded["ok"], .bool(true), str(seeded))
        let folding = store(scale.factor)
        XCTAssertEqual(folding.load()["available"], .bool(true))
        clock.t += 1000
        let r = folding.commit("eq:fold-trigger") { d, c in
            var sessions = d["sessions"]!.objectValue!
            var A = sessions["A"]!.objectValue!
            A["updatedAt"] = .number(c.now)
            sessions["A"] = .object(A)
            d["sessions"] = .object(sessions)
        }
        XCTAssertEqual(r["ok"], .bool(true), str(r))
        let folded = (folding.state["records"]?.objectValue?.entries ?? []).filter { $0.value["folded"] == .bool(true) }.count
        XCTAssertGreaterThan(folded, 0, "real budgets must fold the aged months")
        return folding.state
    }

    /// 把一条「本组、当前字」的判断放进 month（数组或折叠月的 kept），让判断走沿用分支。
    static func withReuse(_ state: JSObject, month: String) -> JSObject {
        var out = state
        guard let s = SessionWrites.session(state, "A"), let key = SessionRules.currentCardKey(s), case .string(let k) = key,
              var records = state["records"]?.objectValue, let value = records[month] else { return out }
        let r = JSValue.object(JSObject([("id", .string("r8888888")), ("cardKey", key), ("char", .string(SchedRecords.charOfCardKey(k) ?? "")), ("sessionId", s["id"]!),
                                         ("kind", .string("judged")), ("at", .number(dayMs(month + "-03"))), ("localDay", .string(month + "-03")),
                                         ("help", .object(JSObject([("hints", .number(0)), ("answerSeen", .bool(false)), ("traced", .bool(false))]))), ("judgment", .string("wrong"))]))
        if case .array(let l) = value {
            records[month] = .array(l + [r])
        } else if case .object(var o) = value, case .array(let l)? = o["kept"] {
            o["kept"] = .array(l + [r])
            records[month] = .object(o)
        }
        out["records"] = .object(records)
        return out
    }

    /// 草稿上的比较（查找类取样、当前字判几种、连续判几次、旧月 / 折叠月里的沿用）+ 判字路径各步的新旧耗时。
    func checkScaleDraft(_ state: JSObject, _ name: String, light: Bool = false) {
        let t0 = DispatchTime.now().uptimeNanoseconds
        checkLookups(state, name, limit: light ? 6 : 12)
        checkJudgesOn(state, name, wide: false)
        var rng = EqRNG(seed: 7)
        judgeSequence(state, name, count: light ? 2 : 4, rng: &rng, lookups: false)
        let months = state["records"]?.objectValue?.keys ?? []
        // light（SHIZI_SCALE_BENCH 的 3x / 10x / 10x-folded）：沿用只在最早与最晚的月各比一次
        for month in (light ? [months.first, months.last] : [months.first, months.dropFirst(months.count / 2).first, months.last]).compactMap({ $0 }) {
            let r = Self.withReuse(state, month: month)
            guard let s = SessionWrites.session(r, "A") else { continue }
            let a = Self.judgeArgs("A", SessionRules.currentCardKey(s), judgment: "correct", hints: 0, ink: nil)
            if let d = checkJudge(r, a, at: B.benchNow, dates: shanghai, "\(name) reuse \(month)") {
                same(Self.text(r["records"]), Self.text(d["records"]), "\(name) reuse \(month): reusing writes no record")
            } else {
                XCTFail("\(name) reuse \(month): judge failed")
            }
        }
        print("BENCH judge-eq-note scale=\(name) checks=\(B.fmt(Double(DispatchTime.now().uptimeNanoseconds - t0) / 1_000_000))ms")
        timeSteps(state, name)
    }

    /// 判字路径上原来 O(全部记录) 的几步，新旧各量（只打印；新的先跑一次不计，即旧月索引已建好——App 里每次启动后第一次判断付一次）。
    func timeSteps(_ state: JSObject, _ name: String) {
        guard let s = SessionWrites.session(state, "A"), let key = SessionRules.currentCardKey(s), let recs = state["records"] else { return }
        let k = JS.string(key), reps = 5
        var sink = 0
        func med(_ body: () -> Void) -> Double { B.median((0..<reps).map { _ in B.time(body) }.sorted()) }
        func judgeOnce(_ old: Bool) {
            var d = state
            let a = Self.judgeArgs("A", key, judgment: "correct", hints: 0, ink: nil)
            if old {
                _ = try? JudgeRef.judgeInDraft(&d, a, strokes: B.rawStrokes(3, seed: 1), at: B.benchNow, nextId: { "r9999999" }, inkFormat: "raw", dates: shanghai)
            } else {
                _ = try? SessionWrites.judgeInDraft(&d, a, strokes: B.rawStrokes(3, seed: 1), at: B.benchNow, nextId: { "r9999999" }, inkFormat: "raw", dates: shanghai)
            }
            sink &+= d.count
        }
        let pairs: [(String, () -> Void, () -> Void)] = [
            ("reuse-lookup",
             { sink &+= JudgeRef.all(state).last(where: { Records.isJudged($0) && $0["sessionId"] == s["id"] && $0["cardKey"] == key }) == nil ? 0 : 1 },
             { sink &+= RecordLookup.records(state, .card, key).last(where: { Records.isJudged($0) && $0["sessionId"] == s["id"] && $0["cardKey"] == key }) == nil ? 0 : 1 }),
            ("fsrs-records", { sink &+= JudgeRef.all(state).count }, { sink &+= RecordLookup.records(state, .card, key).count }),
            ("prune-mine", { sink &+= JudgeRef.mine(recs, KeySet([k])).count }, { sink &+= RecordLookup.recordsOfCards(recs, KeySet([k])).count }),
            ("snapshot-find", { sink &+= JudgeRef.find(state, .string("r1")) == nil ? 0 : 1 }, { sink &+= SessionWrites.find(state, .string("r1")) == nil ? 0 : 1 }),
            ("judge-draft", { judgeOnce(true) }, { judgeOnce(false) }),
        ]
        let records = JudgeRef.all(state).count
        for (op, old, new) in pairs {
            let o = med(old)
            new()
            let n = med(new)
            print("BENCH judge-path scale=\(name) records=\(records) step=\(op) old=\(B.fmt(o))ms new=\(B.fmt(n))ms")
        }
        print("BENCH judge-eq-note sink=\(sink)")
    }

    /// 两个 Store 播同一份状态：新的走 WriteAPI judge，旧的走参照（改动前的 commitJudgment + 同样拼回包）；每一步比回包、状态、serial、磁盘上的每个键。
    func compareStores(_ state: JSObject, _ name: String, steps: Int) {
        let clock = B.Clock(B.benchNow + 5000)
        let dNew = FakeNativeDisk(), dOld = FakeNativeDisk()
        func store(_ disk: FakeNativeDisk) -> Store { Store(storage: StoreStorage(disk.open(), now: { clock.t }), now: { clock.t }, budgets: S.budgets(1), dates: shanghai) }
        let sNew = store(dNew), sOld = store(dOld)
        for (s, label) in [(sNew, "new"), (sOld, "old")] {
            XCTAssertEqual(s.load()["available"], .bool(true))
            let r = s.seed(.object(state), label: "eq-seed")
            XCTAssertEqual(r["ok"], .bool(true), "\(name) seed \(label): \(str(r))")
        }
        let openArgs = JSObject([("slot", .string("A"))])
        same(Self.text(WriteAPI.call("open", sOld, openArgs)), Self.text(WriteAPI.call("open", sNew, openArgs)), "\(name) open")
        for i in 0..<steps {
            clock.t += 1000
            let key = SessionWrites.session(sNew.state, "A").flatMap { SessionRules.currentCardKey($0) } ?? .null
            let args = JSObject([("slot", .string("A")), ("cardKey", key), ("strokes", B.wireStrokes(3 + i % 5, seed: 300 + i)), ("judgment", .string(i % 3 == 1 ? "wrong" : "correct"))])
            let rOld = JudgeRef.writeJudge(sOld, args), rNew = WriteAPI.call("judge", sNew, args)
            XCTAssertEqual(rNew["ok"], .bool(true), "\(name) step \(i): \(str(rNew))")
            same(Self.text(rOld), Self.text(rNew), "\(name) step \(i) reply")
            same(Self.text(.object(sOld.state)), Self.text(.object(sNew.state)), "\(name) step \(i) state")
            XCTAssertEqual(sOld.serial, sNew.serial, "\(name) step \(i) serial")
            // 回包快照里的 find 两边都是新的：这里拿新旧 find 对 lastLine.recordId 与这次写的记录号再比一遍
            let written: [JSValue?] = [rNew["recordId"], rOld["recordId"]]
            checkFind(sNew.state, written + Self.newestIds(sNew.state, perMonth: 1), "\(name) step \(i)")
            let a = dOld.snapshot(), b = dNew.snapshot()
            XCTAssertEqual(a.count, b.count, "\(name) step \(i) disk keys")
            for (x, y) in zip(a, b) where x.0 != y.0 || !x.1.utf8.elementsEqual(y.1.utf8) {
                XCTFail("\(name) step \(i): disk key \(x.0) / \(y.0) differs")
                break
            }
        }
        checkLookups(sNew.state, "\(name) after", limit: 12)
    }

    /// 3x / 10x（未折叠）与 10x-folded 只在 SHIZI_SCALE_BENCH=1 时跑（CI 手动的 Release 量测步骤；与 ScaleBenchmarkTests 同一个开关）；
    /// 1x 与 3x-folded（App 真实预算下折叠过的状态）每次都跑。这里只用 ScaleBenchmarkTests / StoreCommitBenchmarkTests 的静态生成器，不依赖它们的测试方法。
    static func requireScaleBench() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["SHIZI_SCALE_BENCH"] == "1", "3x / 10x equivalence runs only with SHIZI_SCALE_BENCH=1 (CI release-bench step)")
    }

    func testScale1xDraftMatchesReference() throws {
        checkScaleDraft(try B.heavyState(B.shape1x), "1x")
    }

    func testScale3xAnd10xDraftsMatchReference() throws {
        try Self.requireScaleBench()
        for (name, shape) in [("3x", S.shape3x()), ("10x", S.shape10x())] {
            checkScaleDraft(try B.heavyState(shape), name, light: true)
        }
    }

    func testScale3xFoldedMatchesReference() throws {
        let state = try Self.foldedState(S.scale3xFolded())
        checkScaleDraft(state, "3x-folded")
        compareStores(state, "3x-folded", steps: 8)
        // 沿用分支走一遍 Store：放进最早的未折叠月（折叠月的 kept 另由 checkScaleDraft 在草稿上比）
        let entries = state["records"]?.objectValue?.entries ?? []
        if let month = entries.first(where: { $0.value.arrayValue != nil })?.key {
            compareStores(Self.withReuse(state, month: month), "3x-folded-reuse", steps: 3)
        } else {
            XCTFail("3x-folded must keep unfolded months")
        }
    }

    func testScale10xFoldedMatchesReference() throws {
        try Self.requireScaleBench()
        let state = try Self.foldedState(S.scale10xFolded())
        checkScaleDraft(state, "10x-folded", light: true)
        compareStores(state, "10x-folded", steps: 3)
    }
}

struct EqRNG: RandomNumberGenerator {
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

// MARK: - 参照：改动之前的写法（照抄）

enum JudgeRef {
    typealias W = SessionWrites

    static func all(_ state: JSObject) -> [JSValue] { Query.flattenRecords(state["records"]) }
    static func find(_ state: JSObject, _ id: JSValue?) -> JSValue? { all(state).first { $0["id"] == id } }
    static func seen(_ state: JSObject, _ session: JSValue, _ key: JSValue?) -> JSValue? {
        all(state).last { $0["kind"] == .string("answer-seen") && $0["sessionId"] == session["id"] && $0["cardKey"] == key }
    }
    static func judgedCount(_ state: JSObject, _ id: JSValue?) -> Int { Set(all(state).filter { Records.isJudged($0) && $0["sessionId"] == id }.map { JS.string($0["cardKey"]) }).count }

    /// Budget.pruneInkOfCards 原来的 mine。
    static func mine(_ recs: JSValue, _ want: KeySet) -> [JSValue] {
        var mine: [JSValue] = []
        for (_, v) in recs.objectValue?.entries ?? [] {
            for rec in Budget.monthRecords(v) {
                if case .object = rec, let ck = Budget.cardKey(rec), want.contains(ck) { mine.append(rec) }
            }
        }
        return mine
    }

    // SessionWrites.judgeInDraft（改动前）
    static func judgeInDraft(_ d: inout JSObject, _ a: JSObject, strokes: [[InkPoint]], at: Double, nextId: () throws -> String,
                             inkFormat: String, dates: Dates) throws -> (record: JSValue, reused: Bool) {
        guard Records.judgments.contains(JS.string(a["judgment"])) else { throw CoreError.range("judge: judgment must be correct or wrong") }
        guard strokes.contains(where: { !$0.isEmpty }) else { throw CoreError.range("judge: no strokes of the learner") }
        let slot = JS.string(a["slot"]), key = a["cardKey"] ?? .null, k = JS.string(key)
        guard let s = W.session(d, slot), SessionRules.currentCardKey(s) == key else { throw CoreError.error("judge: not the current card") }
        let policy = ViewSupport.policy(a["policy"])
        if W.isRetry(s, key) {
            // D83 重考：不写记录、不动复习日期；错了且没到 3 次就再隔 3 个字
            W.set(&d, slot, try TodayPlan.retryAdvance(s, key: key, outcome: JS.string(a["judgment"]), at: .number(at), policy: policy))
            try TodayPlan.settle(&d, day: try dates.localDay(.number(at)), rules: ScheduleRules(dates: dates), policy: policy)
            return (.null, false)
        }
        if let r = all(d).last(where: { Records.isJudged($0) && $0["sessionId"] == s["id"] && $0["cardKey"] == key }) {
            W.set(&d, slot, try SessionRules.advance(s, cardKey: key, recordId: r["id"], kind: .string("judged"), fsrsBefore: nil, at: .number(at)))
            return (r, true)
        }
        let r = try Records.makeRecord(JSObject([("id", .string(try nextId())), ("cardKey", key), ("sessionId", s["id"]!), ("kind", .string("judged")), ("judgment", a["judgment"]!), ("at", .number(at)), ("help", JS.obj([("hints", .number(min(Schema.hintsShapeMax, max(0, W.hints(s, a["hints"]).rounded(.towardZero))))), ("answerSeen", .bool(false)), ("traced", .bool(false))]))]), dates: dates)
        try W.append(&d, r)
        if a["perRecordInk"]?.boolValue ?? (policy["features"]?["perRecordInk"] == .bool(true)) { _ = try Store.setInk(&d, r, InkMath.encodeStoredInk(strokes, policy: policy.objectValue, format: inkFormat), timeZone: dates.timeZone) }
        _ = Budget.pruneInkOfCards(&d, [k], dates: dates)
        let next = try ScheduleRules(dates: dates).applyJudgment(d["sched"]?[k], r, policy: policy, records: all(d))
        d["sched"] = W.patch(d["sched"], [(k, next.entry)])
        let advanced = try SessionRules.advance(s, cardKey: key, recordId: r["id"], kind: .string("judged"), fsrsBefore: next.fsrsBefore, at: .number(at))
        W.set(&d, slot, JS.isString(a["judgment"], "wrong") ? TodayPlan.afterFirstWrong(advanced, key: key, policy: policy) : advanced)
        try W.noteAndSettle(&d, s, key: key, kind: "judged", at: at, dates: dates, policy: policy)
        return (r, false)
    }

    // SessionWrites.commitJudgment（改动前）
    static func commitJudgment(_ store: Store, _ a: JSObject) -> JSValue {
        let strokes = W.raw(a); if !strokes.contains(where: { !$0.isEmpty }) { return W.failure("empty-strokes") }
        guard W.current(store, a) != nil else { return W.failure("stale") }
        var record: JSValue?, reused = false
        let result = store.commit("write:judge") { d,c in
            let out = try JudgeRef.judgeInDraft(&d, a, strokes: strokes, at: c.now, nextId: { try c.nextId("r") }, inkFormat: c.inkFormat, dates: store.dates)
            record = out.record; reused = out.reused
        }
        return result["ok"] == .bool(true) && record != nil ? W.patch(result, [("record", record!), ("reused", .bool(reused))]) : result
    }

    /// WriteAPI.call("judge", …) 的同样拼法，判断换成上面的 commitJudgment。
    static func writeJudge(_ store: Store, _ a: JSObject) -> JSValue {
        do {
            let slot = JS.string(a["slot"])
            func snapshot() throws -> JSValue { var value = try WriteModels.snapshot(store.state, slot: slot).objectValue!; value["slot"] = a["slot"]; return .object(value) }
            var args = a
            args["strokes"] = WriteWire.strokesJS(WriteModels.fromWire(a["strokes"]))
            let r = commitJudgment(store, args)
            if r["ok"] != .bool(true) { return W.patch(r["ok"] == .bool(true) ? JS.obj([("ok", .bool(true))]) : WriteAPI.plain(r), [("snapshot", try snapshot())]) }
            let f = WriteAPI.finish(store, slot: slot)
            return JS.obj([("ok", .bool(true)), ("recordId", r["record"]?["id"] ?? .null), ("reused", .bool(JS.truthy(r["reused"]))), ("finished", f), ("snapshot", try snapshot())])
        } catch let error as CoreError {
            return JS.obj([("ok", .bool(false)), ("error", JS.obj([("kind", .string("exception")), ("reason", .string(error.message))]))])
        } catch {
            return JS.obj([("ok", .bool(false)), ("error", JS.obj([("kind", .string("exception")), ("reason", .string(String(describing: error)))]))])
        }
    }

    // ResultModels.cells / model（改动前）
    static func cells(_ state: JSObject, _ a: JSObject) throws -> [JSValue] {
        let s = SessionResults.locate(state, a)?.session, records = Records.sortById(all(state).filter { $0["sessionId"] == a["sessionId"] })
        return try ResultModels.items(s, records: records).enumerated().map { i,it in
            let record = records.first { $0["id"] == it["recordId"] }, kind = record?["kind"] ?? it["kind"] ?? .null
            let judgment = kind == .string("judged") ? record?["judgment"] ?? .null : .null
            return JS.obj([("index", .number(Double(i))), ("cardKey", it["cardKey"] ?? .null), ("recordId", record?["id"] ?? it["recordId"] ?? .null), ("char", record?["char"] ?? Records.charOfCardKey(it["cardKey"]).map(JSValue.string) ?? .null), ("kind", kind), ("judgment", judgment), ("caption", try Copy.t(kind == .string("judged") ? (judgment == .string("wrong") ? "X-RESULT.cellWrong" : "X-RESULT.cellCorrect") : kind == .string("answer-seen") ? "R-R02.cellSaw" : "X-RESULT.cellSkipped")), ("canChange", .bool(kind == .string("judged") && record != nil && !JS.truthy(record?["legacy"]) && s != nil && SessionRules.canCorrect(s, record?["id"])))])
        }
    }

    static func model(_ state: JSObject, _ a: JSObject, dates: Dates, hasInk: InkPick.HasInk? = nil) throws -> JSValue {
        let found = SessionResults.locate(state, a), s = found?.session
        let records = Records.sortById(all(state).filter { $0["sessionId"] == a["sessionId"] })
        let cells = try JudgeRef.cells(state, a), variant = s.map { $0["kind"] == .string("picked") ? "picked" : $0["kind"] == .string("first") ? "first" : "daily" } ?? (a["slot"] == .string("B") ? "picked" : "daily")
        let early = JS.truthy(s?["endedEarly"])
        let unwritten = s.map { s in Double(Set(SessionRules.remainingKeys(s).compactMap { k in TodayPlan.attempts(s, k) == 0 ? k.stringValue : nil }).count) } ?? 0
        let source = JS.truthy(s?["source"]) ? s!["source"]! : JS.obj([("view", .string("home"))])
        var day: JSValue = .null
        if let s {
            let at = s["endedAt"]?.numberValue.flatMap { $0.isFinite ? $0 : nil } ?? s["updatedAt"]?.numberValue
            if let at, at.isFinite { day = .string(try dates.localDay(.number(at))) } else { day = JS.truthy(s["startedDay"]) ? s["startedDay"]! : .null }
        }
        let work: JSValue = cells.isEmpty ? .null : ImageSelection.buildWork(items: ResultModels.items(s, records: records), records: records, hasInk: hasInk ?? { record in
            let month = String((record["localDay"]?.stringValue ?? "").prefix(7)), id = JS.string(record["inkId"] ?? record["id"])
            return JS.truthy(state["ink"]?[month]?[id]) || (RecentInk.page.recalledInk(record["id"], policy: a["policy"] ?? Config.policy).arrayValue ?? []).contains { !($0.arrayValue ?? []).isEmpty }
        }, added: ImageSelection.addedOf(s))
        var sub: [JSValue] = []
        if variant != "first" && early && unwritten > 0 { sub.append(try Copy.t("R-R05.bodyEarly", JSObject([("n", .number(unwritten))]))) }
        let complete = s.map { SessionRules.isComplete($0) && !early } ?? false
        if variant != "first", complete, let s {
            let sum = TodayPlan.summary(s, records: all(state))
            sub.append(try Copy.t("X-TODAY.summary", JSObject([("correct", .number(Double(sum.correct))), ("passed", .number(Double(sum.passed))), ("again", .number(Double(sum.again))), ("fresh", .number(Double(sum.fresh)))])))
        }
        let doneTitle: JSValue = variant == "daily" && complete && TodayPlan.isPlan(s) ? try Copy.t("X-TODAY.doneTitle") : .null
        let value = JS.obj([("found", .bool(s != nil)), ("where", found.map { .string($0.ended ? "ended" : "slot") } ?? .null), ("session", s ?? .null), ("slot", a["slot"] ?? .null), ("sessionId", a["sessionId"] ?? .null), ("variant", .string(variant)), ("early", .bool(early)), ("header", try Copy.t(variant == "first" ? "X-RESULT.headerFirst" : variant == "picked" ? "R-R05.kicker" : "X-RESULT.headerDaily")), ("title", variant == "first" ? try Copy.t("X-FIRST.title") : doneTitle), ("sub", .array(sub)), ("cells", .array(cells)), ("count", .number(Double(Set(records.filter(Records.isJudged).map { JS.string($0["cardKey"]) }).count))), ("unwritten", .number(unwritten)), ("day", day), ("work", work), ("share", .bool(!(work["cells"]?.arrayValue ?? []).isEmpty)), ("leave", try ResultModels.leaveOf(source)), ("again", .bool(variant != "picked")), ("source", source)])
        var out = value.objectValue!;out["slot"] = a["slot"];out["sessionId"] = a["sessionId"];return .object(out)
    }
}
