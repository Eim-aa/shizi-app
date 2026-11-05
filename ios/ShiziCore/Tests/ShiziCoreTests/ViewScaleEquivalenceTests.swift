import Foundation
import XCTest
@testable import ShiziCore

// 我的 / 记录 / 月报（及它们共用的 ImageSelection.monthMembers / imagePlan）提速的等价性：
// 改动前的写法原样抄在 ViewRef 里当参照，新旧两边的完整回答序列化成 JSON 文字逐字节比（含键序、相等时的先后）。
// 状态来源：views-pages / images-selection 夹具里的 state；随机多月历史（看后自写、纸上、跳过、重复 / 不合法 id、同一时间戳、
// 月初月末、跨年、折叠月：新版折叠与没有 work 的旧版折叠）；1x 数据量（经 Store + PageAPI，与 App 同一入口）。
// 3x-folded（真实预算折叠后的状态）与 1x 的逐日选中只在 SHIZI_SCALE_BENCH=1 时跑（Debug 下太慢）。
final class ViewScaleEquivalenceTests: XCTestCase {
    typealias V = ViewSupport
    typealias B = StoreCommitBenchmarkTests

    private var compared = 0

    // MARK: 比较

    private static func firstDiff(_ a: String, _ b: String) -> String {
        let x = Array(a.utf8), y = Array(b.utf8)
        var i = 0
        while i < x.count, i < y.count, x[i] == y[i] { i += 1 }
        let lo = max(0, i - 120)
        func slice(_ u: [UInt8]) -> String { String(decoding: u[min(lo, u.count)..<min(u.count, i + 200)], as: UTF8.self) }
        return "at byte \(i) (new \(x.count) / ref \(y.count))\n  new: …\(slice(x))\n  ref: …\(slice(y))"
    }

    private func same(_ label: @autoclosure () -> String, _ new: () throws -> JSValue, _ ref: () throws -> JSValue, file: StaticString = #filePath, line: UInt = #line) {
        compared += 1
        let a = Result { try new() }, b = Result { try ref() }
        switch (a, b) {
        case (.success(let x), .success(let y)):
            let sx = JSONWriter.stringify(x), sy = JSONWriter.stringify(y)
            if sx != sy { XCTFail(label() + " differs " + Self.firstDiff(sx, sy), file: file, line: line) }
        case (.failure(let e1), .failure(let e2)):
            XCTAssertEqual(String(describing: e1), String(describing: e2), label() + " (both throw)", file: file, line: line)
        case (.success, .failure(let e)):
            XCTFail(label() + " new succeeds, ref throws \(e)", file: file, line: line)
        case (.failure(let e), .success):
            XCTFail(label() + " new throws \(e), ref succeeds", file: file, line: line)
        }
    }

    private static let build = JSValue.object(JSObject([("version", .string("")), ("build", .string(""))]))

    /// 要看的月份：有记录的月（含折叠月、today 之后的月）、today 所在月与上一月、最早的月；跨度不大时补齐中间的每个月。
    private static func monthsToCheck(_ state: JSValue, today: String, dates: Dates) throws -> [String] {
        let index = ViewRef.recordIndex(state, dates: dates), current = String(today.prefix(7))
        var set = KeySet([current, try dates.addMonths(.string(current), -1)])
        for d in index.days.items { set.insert(String(d.prefix(7))) }
        for k in state["records"]?.objectValue?.keys ?? [] where dates.isValidMonth(.string(k)) { set.insert(k) }
        if let first = V.firstRecordMonth(index), first < current {
            var m = first, n = 0
            while m < current && n < 30 { set.insert(m); m = try dates.addMonths(.string(m), 1); n += 1 }
        }
        return set.items.sorted()
    }

    /// 一个状态在某个 today 下的全部比较。fullDays：记录页每个有记录的日子都选中一遍（否则只选首尾两天）。
    private func compareAll(_ state: JSValue, today: String, dates: Dates, label: String, fullDays: Bool = true) throws {
        let policy = Config.policy
        // 我的
        for (w, ax, sp) in [(402.0, 0.0, JSValue?.none), (320.0, 2.0, JSValue?.some(.string("near"))), (402.0, 0.0, JSValue?.some(.number(0.2)))] {
            var a = JSObject([("width", .number(w)), ("ax", .number(ax)), ("build", Self.build)])
            if let sp { a["storagePressure"] = sp }
            same("\(label) today=\(today) mineView w=\(w) ax=\(ax)", { try MinePageView.mineView(state, today: today, a, dates: dates) }, { try ViewRef.mineView(state, today: today, a, dates: dates) })
        }
        same("\(label) today=\(today) mineModel", { try V.mineModel(state, today: today, policy: policy, storagePressure: nil, dates: dates) },
             { try ViewRef.mineModel(state, today: today, policy: policy, storagePressure: nil, dates: dates) })
        let newIndex = V.recordIndex(state, dates: dates), refIndex = ViewRef.recordIndex(state, dates: dates)
        same("\(label) overview", { try V.overviewModel(state, today: today, index: newIndex) }, { try ViewRef.overviewModel(state, today: today, index: refIndex) })
        for sp in [JSValue?.none, .some(.bool(false))] {
            same("\(label) backupHint", { try V.backupHint(state, today: today, index: newIndex, storagePressure: sp) }, { try ViewRef.backupHint(state, today: today, index: refIndex, storagePressure: sp) })
        }
        same("\(label) index", { newIndex.js }, { refIndex.js })
        same("\(label) works", { .array(newIndex.works) }, { .array(ViewRef.works(refIndex)) })
        // 我的页「年报」链接的缺省年份：共用索引的推法 vs 年报自己的 annualDefaultYear（今天、跨年前后、记录之前很早 / 之后很晚、不合法的 today）
        let y = Int(today.prefix(4)) ?? 2026
        for t in [today, "\(y)-01-01", "\(y - 1)-12-31", "\(y + 1)-01-01", "\(y + 3)-06-15", "2000-01-01", "2026-02-30", "x"] {
            same("\(label) annualDefaultYear \(t)", { V.annualDefaultYear(state, today: t, index: newIndex) }, { AnnualView.annualDefaultYear(state, today: t, dates: dates) })
        }
        for d in refIndex.days.items + [today, "2026-13-01"] {
            same("\(label) dayItems \(d)", { .array(V.dayItems(newIndex, day: d)) }, { .array(ViewRef.dayItems(refIndex, day: d)) })
        }
        let inkHas: InkPick.HasInk = { DetailView.recordHasInk(state, record: $0, dates: dates) }
        let months = try Self.monthsToCheck(state, today: today, dates: dates)
        for m in months {
            // 月报（页）与记录页里的月报块
            same("\(label) monthView \(m)", { try MineSubView.monthView(state, month: m, policy: policy, dates: dates) }, { try ViewRef.monthView(state, month: m, policy: policy, dates: dates) })
            same("\(label) monthSheetOf \(m)", { try MineSubView.monthSheetOf(state, month: m, policy: policy, dates: dates) }, { try ViewRef.monthSheetOf(state, month: m, policy: policy, dates: dates) })
            same("\(label) monthSheetCells \(m)", { try MinePageView.monthSheetCells(state, month: m, policy: policy, dates: dates) }, { try ViewRef.monthSheetCells(state, month: m, policy: policy, dates: dates) })
            for pick in ["first", "last"] {
                let p = V.policy(.object(JSObject([("monthSheetPick", .string(pick))])))
                same("\(label) monthSheet \(m) \(pick)", { V.monthSheet(newIndex, month: m, policy: p) }, { ViewRef.monthSheet(refIndex, month: m, policy: p) })
            }
            // 记录页：不选日、选每一天（或首尾两天）、选不合法 / 没记录 / 别的月的日子
            let recordDays = refIndex.days.items.filter { $0.hasPrefix(m + "-") }.sorted()
            let chosen: [String] = fullDays ? recordDays : [recordDays.first, recordDays.last].compactMap { $0 }
            let picks: [String?] = [nil, m + "-15", m + "-32", "2026-13-01", today] + chosen.map { Optional($0) }
            for day in picks {
                var a = JSObject([("month", .string(m))])
                if let day { a["day"] = .string(day) }
                same("\(label) today=\(today) recordsView \(m) \(day ?? "-")", { try MineSubView.recordsView(state, today: today, a, dates: dates) }, { try ViewRef.recordsView(state, today: today, a, dates: dates) })
                same("\(label) today=\(today) recordsModel \(m) \(day ?? "-")", { try V.recordsModel(state, today: today, month: .string(m), day: day.map(JSValue.string), policy: policy, dates: dates) },
                     { try ViewRef.recordsModel(state, today: today, month: .string(m), day: day.map(JSValue.string), policy: policy, dates: dates) })
            }
        }
        // 记录页：缺省月 / 不合法的月
        for mv in [JSValue?.none, .some(.string("1999-01")), .some(.string("2099-12")), .some(.string("2026-13"))] {
            var a = JSObject(); if let s = mv?.stringValue { a["month"] = .string(s) }
            same("\(label) recordsView month=\(mv?.stringValue ?? "-")", { try MineSubView.recordsView(state, today: today, a, dates: dates) }, { try ViewRef.recordsView(state, today: today, a, dates: dates) })
        }
        try compareSelection(state, months: months + ["2026-13"], dates: dates, label: label, hasInk: inkHas)
    }

    /// ImageSelection.monthMembers / imagePlan（月报、我的、年报每月、导出图都经它们）：每月 × pick × hasInk 有无 × added。
    private func compareSelection(_ state: JSValue, months: [String], dates: Dates, label: String, hasInk: InkPick.HasInk) throws {
        let wrongIds = Query.flattenRecords(state["records"]).filter { $0["judgment"] == .string("wrong") }.compactMap { $0["id"]?.stringValue }
        let added: [[String]?] = [nil, [], Array(wrongIds.prefix(7)), wrongIds.enumerated().filter { $0.offset % 2 == 0 }.map(\.element)]
        let inkOf: ImageSelection.InkOf = { try DetailView.builtInk(state, record: $0, dates: dates) }
        let never: InkPick.HasInk = { _ in false }
        for m in months {
            for pick in ["first", "last", "other"] {
                for (hn, h) in [("nil", InkPick.HasInk?.none), ("ink", .some(hasInk)), ("never", .some(never))] {
                    for (ai, ad) in added.enumerated() where ai == 0 || hn != "never" {
                        same("\(label) monthMembers \(m) \(pick) \(hn) added#\(ai)", { try ImageSelection.monthMembers(state, month: m, pick: pick, hasInk: h, added: ad, dates: dates) },
                             { try ViewRef.monthMembers(state, month: m, pick: pick, hasInk: h, added: ad, dates: dates) })
                    }
                    let scope = JSValue.object(JSObject([("kind", .string("month")), ("month", .string(m))]))
                    for maxChars in [80, 7] {
                        same("\(label) imagePlan month \(m) \(pick) \(hn) max=\(maxChars)", { try ImageSelection.imagePlan(state, scope: scope, inkOf: inkOf, hasInk: h, maxChars: maxChars, monthPick: pick, dates: dates) },
                             { try ViewRef.imagePlan(state, scope: scope, inkOf: inkOf, hasInk: h, maxChars: maxChars, monthPick: pick, dates: dates) })
                    }
                }
            }
        }
        // 别的 kind（day / glyph / session）走参照的同一份 imagePlan，守住整个函数没被改坏
        let recs = Query.flattenRecords(state["records"])
        var scopes: [JSValue] = []
        for d in Array(Set(recs.compactMap { $0["localDay"]?.stringValue })).sorted().prefix(6) { scopes.append(.object(JSObject([("kind", .string("day")), ("day", .string(d))]))) }
        for c in Array(Set(recs.compactMap { $0["char"]?.stringValue })).sorted().prefix(4) { scopes.append(.object(JSObject([("kind", .string("glyph")), ("char", .string(c))]))) }
        for s in Array(Set(recs.compactMap { $0["sessionId"]?.stringValue })).sorted().prefix(3) { scopes.append(.object(JSObject([("kind", .string("session")), ("sessionId", .string(s))]))) }
        scopes.append(.object(JSObject([("kind", .string("nope"))])))
        for scope in scopes {
            same("\(label) imagePlan \(JSONWriter.stringify(scope))", { try ImageSelection.imagePlan(state, scope: scope, inkOf: inkOf, dates: dates) }, { try ViewRef.imagePlan(state, scope: scope, inkOf: inkOf, dates: dates) })
        }
    }

    // MARK: 夹具

    private static func fixtureCases(_ name: String) throws -> [(tz: String, c: JSValue)] {
        guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures") else { throw XCTSkip("missing fixture " + name) }
        let doc = try JSONParser.parse(try String(contentsOf: url, encoding: .utf8))
        if let list = doc.arrayValue { return list.map { ("Asia/Shanghai", $0) } }
        var out: [(tz: String, c: JSValue)] = []
        for g in doc["groups"]?.arrayValue ?? [] { for c in g["cases"]?.arrayValue ?? [] { out.append((tz: g["tz"]?.stringValue ?? "Asia/Shanghai", c: c)) } }
        return out
    }

    /// 视图里有几处按「记录都有 char / cardKey / kind」强制解包（旧写法同样会崩），夹具里专测别的函数的怪状态不拿来跑整页。
    private static func sane(_ state: JSValue) -> Bool {
        guard state.objectValue != nil, let recs = state["records"]?.objectValue, !recs.isEmpty else { return false }
        for (k, v) in recs.entries {
            guard v.arrayValue != nil || v.objectValue != nil, k.utf8.count == 7 else { return false }
        }
        return Query.flattenRecords(state["records"]).allSatisfy { r in
            r.objectValue != nil && r["char"]?.stringValue != nil && r["cardKey"]?.stringValue != nil && r["kind"]?.stringValue != nil && r["localDay"]?.stringValue != nil
        }
    }

    func testFixtureStatesMatchReference() throws {
        var seen = Set<String>(), perState: [String: Int] = [:], states = 0
        for name in ["views-pages", "images-selection"] {
            for (tzName, c) in try Self.fixtureCases(name) {
                guard let state = c["args"]?["state"], Self.sane(state), let tz = TimeZone(identifier: tzName) else { continue }
                let dates = Dates(timeZone: tz)
                var todays: [String] = []
                if let t = c["args"]?["today"]?.stringValue, dates.isValidDay(.string(t)) { todays.append(t) }
                let lastDay = Query.flattenRecords(state["records"]).compactMap { $0["localDay"]?.stringValue }.filter { dates.isValidDay(.string($0)) }.max()
                if let lastDay { todays.append(lastDay) }
                if todays.isEmpty { todays.append("2026-10-21") }
                let stateKey = tzName + "\u{0}" + JSONWriter.stringify(state)
                for today in todays {
                    guard states < 160, perState[stateKey, default: 0] < 2, seen.insert(stateKey + "\u{0}" + today).inserted else { continue }
                    perState[stateKey, default: 0] += 1
                    states += 1
                    try compareAll(state, today: today, dates: dates, label: "\(name)#\(states) \(tzName)")
                }
            }
        }
        XCTAssertGreaterThan(states, 3, "fixtures must contribute states")
        print("VIEWEQ fixtures states=\(states) compared=\(compared)")
    }

    // MARK: 随机多月历史

    struct RNG {
        var s: UInt64
        mutating func next() -> UInt64 {
            s &+= 0x9E37_79B9_7F4A_7C15
            var z = s
            z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
            z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
            return z ^ (z >> 31)
        }
        mutating func int(_ n: Int) -> Int { Int(next() % UInt64(max(1, n))) }
        mutating func chance(_ percent: Int) -> Bool { int(100) < percent }
        mutating func pick<T>(_ a: [T]) -> T { a[int(a.count)] }
    }

    private static let inkEntry: JSValue = try! InkMath.encodeStoredInk(B.rawStrokes(3, seed: 5), policy: Config.policy.objectValue, format: "raw")
    private static let inkEntry2: JSValue = try! InkMath.encodeStoredInk(B.rawStrokes(5, seed: 11), policy: Config.policy.objectValue, format: "raw")

    /// 一段随机历史：连续（偶有空月）的几个月、跨年；每月若干条记录（判断对 / 错、看后自写、只看答案、跳过、纸上），
    /// 一部分带墨迹；id 大多递增，但有重复、不合法、缺 id、月内乱序、比前面的月还小的；时间戳常有相同的；
    /// 较早的月按 Budget.foldMonth 折叠（一部分改成没有 work 的旧版折叠）。
    static func randomState(_ rng: inout RNG, round: Int, dates: Dates) throws -> (state: JSValue, todays: [String]) {
        let starts = [(2024, 11), (2025, 12), (2026, 1), (2025, 6), (2023, 12)]
        let (y0, m0) = starts[round % starts.count]
        let count = 1 + rng.int(7)
        var months: [String] = []
        var k = 0
        while months.count < count {
            let t = y0 * 12 + (m0 - 1) + k
            if !(months.count > 0 && rng.chance(12)) { months.append(String(t / 12) + "-" + B.pad2(t % 12 + 1)) }
            k += 1
        }
        var pool = ["永", "人", "一", "字", "月", "山", "水", "火", "木", "金", "日", "大"]
        if round % 4 == 1 { pool += ["\u{00E9}", "e\u{0301}"] } // 规范等价、码点不同：Swift 的 == 与逐码点的 == 分得开
        let pool2 = Array(pool.prefix(3 + rng.int(pool.count - 2)))
        var serial = 0
        var lists: [(String, [JSValue])] = []
        var ink = JSObject()
        var allIds: [String] = []
        var lastAt = 0.0
        for month in months {
            let (y, m) = (Int(month.prefix(4))!, Int(month.suffix(2))!)
            let dim = Int(dates.daysInMonth(y, m))
            let n = rng.chance(10) ? 0 : 3 + rng.int(28)
            var list: [JSValue] = []
            for _ in 0..<n {
                serial += 1
                var id: String? = "r\(serial)"
                let roll = rng.int(100)
                if roll < 4, !allIds.isEmpty { id = rng.pick(allIds) } // 重复 id
                else if roll < 6 { id = "x\(serial)" } // 不合法 id（序号按 -1）
                else if roll < 7 { id = nil } // 缺 id
                else if roll < 12, serial > 3 { id = "r\(1 + rng.int(serial - 1))" } // 比前面的小（可能与前面重复）
                let dayN = rng.chance(30) ? rng.pick([1, dim]) : 1 + rng.int(dim)
                let day = month + "-" + B.pad2(dayN)
                let ch = rng.pick(pool2)
                let dayStart = try dates.dayStartMs(.string(day))
                let at = rng.chance(20) && lastAt > 0 ? lastAt : dayStart + Double(rng.int(86_000)) * 1000
                lastAt = at
                var o = JSObject([("cardKey", .string("base:" + ch)), ("char", .string(ch)), ("sessionId", .string("s\(1 + serial / 8)"))])
                if let id { o["id"] = .string(id) }
                let kr = rng.int(100)
                let kind: String
                if kr < 55 { kind = "judged"; o["judgment"] = .string(rng.chance(25) ? "wrong" : "correct") }
                else if kr < 70 { kind = "answer-seen" }
                else if kr < 80 { kind = "skipped" }
                else { kind = "judged"; o["judgment"] = .string(rng.chance(30) ? "wrong" : "correct"); o["source"] = .string("paper") }
                o["kind"] = .string(kind); o["at"] = .number(at); o["localDay"] = .string(day)
                o["help"] = .object(JSObject([("hints", .number(Double(rng.int(3)))), ("answerSeen", .bool(kind == "answer-seen")), ("traced", .bool(false))]))
                let rec = JSValue.object(o)
                if let id, id.hasPrefix("r"), kind != "skipped", o["source"] == nil, rng.chance(kind == "answer-seen" ? 60 : 50) {
                    var table = ink[month]?.objectValue ?? JSObject()
                    table[id] = rng.chance(85) ? (rng.chance(50) ? inkEntry : inkEntry2) : .object(JSObject([("v", .number(4)), ("c", .number(345)), ("r", .array([.string("")])), ("g", .array([.number(0)]))]))
                    ink[month] = .object(table)
                }
                if let id { allIds.append(id) }
                list.append(rec)
            }
            if rng.chance(10) { list.shuffle(using: &rng) }
            lists.append((month, list))
        }
        let inkState = JSValue.object(JSObject([("ink", .object(ink))]))
        var records = JSObject()
        for (i, (month, list)) in lists.enumerated() {
            if i < lists.count - 1, rng.chance(40) {
                var keep = Set<JSKey>()
                for r in list where rng.chance(40) { if let id = r["id"]?.stringValue { keep.insert(JSKey(s: id)) } }
                var f = Budget.foldMonth(month, list, keep, hasInk: { InkPick.storedInkPresent(inkState, $0, timeZone: dates.timeZone) })
                if rng.chance(35) { f["work"] = nil; f["workJudged"] = nil } // 旧版折叠
                records[month] = .object(f)
                // 折叠时墨迹只留 kept 的
                if var table = ink[month]?.objectValue, rng.chance(70) {
                    for id in table.keys where !keep.contains(JSKey(s: id)) { table[id] = nil }
                    ink[month] = .object(table)
                }
            } else {
                records[month] = .array(list)
            }
        }
        let last = months.last!
        let (ly, lm) = (Int(last.prefix(4))!, Int(last.suffix(2))!)
        let lastDim = Int(dates.daysInMonth(ly, lm))
        var todays = [last + "-" + B.pad2(1 + rng.int(lastDim)), last + "-" + B.pad2(lastDim)]
        todays.append(try dates.addMonths(.string(last), 1) + "-05") // 当月没有记录
        todays.append(String(ly + 1) + "-01-0" + String(1 + rng.int(9))) // 跨年：今年还没写
        todays.append(months[0] + "-01") // 记录在 today 之后
        var sched = JSObject()
        for (i, ch) in pool2.enumerated() where rng.chance(70) {
            let near = try dates.addDays(.string(todays[0]), Double(rng.int(20)) - 10)
            let due: JSValue = rng.chance(85) ? .string(near) : .string("2026-02-30")
            var e = JSObject([("due", due), ("fsrs", .object(JSObject([("stability", .number(Double(rng.int(60)))), ("reps", .number(Double(rng.int(8)))), ("lapses", .number(Double(rng.int(3))))])))])
            if i % 5 == 4 { e["stoppedAt"] = .number(1) }
            sched["base:" + ch] = .object(e)
        }
        var state = JSObject([("records", .object(records)), ("ink", .object(ink)), ("sched", .object(sched)), ("settings", .object(JSObject([("library", .string(rng.pick(["common", "rare", "all"])))])))])
        if rng.chance(20) { state["legacy"] = .object(JSObject([("days", .array([.string(months[0] + "-02"), .string("2020-01-01"), .string("2099-01-01")]))])) }
        let sig = Backup.recordsSignature(.object(records))
        let lastExport = try dates.dayStartMs(.string(todays[0])) - Double(rng.pick([3, 10, 40, 400])) * 86_400_000
        switch rng.int(5) {
        case 0: break
        case 1: state["backupMeta"] = .object(JSObject([("lastExportAt", .number(lastExport)), ("lastExportSig", .string(sig))]))
        case 2: state["backupMeta"] = .object(JSObject([("lastExportAt", .number(lastExport)), ("lastExportSig", .string("x"))]))
        case 3: // 条数相同、散列不同
            state["backupMeta"] = .object(JSObject([("lastExportAt", .number(lastExport)), ("lastExportSig", .string(String(sig.prefix { $0 != ":" }) + ":00000000"))]))
        default: state["backupMeta"] = .object(JSObject([("lastExportAt", .number(0)), ("lastExportSig", .string(sig))]))
        }
        return (.object(state), todays)
    }

    func testRandomHistoriesMatchReference() throws {
        var rng = RNG(s: 20_261_105)
        let zones = [Dates(timeZone: TimeZone(identifier: "Asia/Shanghai")!), Dates(timeZone: TimeZone(identifier: "America/New_York")!)]
        let rounds = ProcessInfo.processInfo.environment["SHIZI_SCALE_BENCH"] == "1" ? 160 : 36
        for round in 0..<rounds {
            let dates = zones[round % 2]
            let (state, todays) = try Self.randomState(&rng, round: round, dates: dates)
            for (ti, today) in todays.enumerated() where ti < 2 || round % 3 == 0 {
                try compareAll(state, today: today, dates: dates, label: "random#\(round) tz=\(dates.timeZone.identifier)", fullDays: round % 3 == 0)
            }
        }
        print("VIEWEQ random rounds=\(rounds) compared=\(compared)")
    }

    // MARK: 数据量档（经 Store + PageAPI）

    /// heavyState 不造看后自写 / 纸上 / 跳过：这里按 id 序号轮流改一部分（纸上只改不带墨迹的，与 schema 相符）。
    static func mixedHeavyState(_ shape: B.Shape) throws -> JSObject {
        var state = try B.heavyState(shape)
        var records = state["records"]!.objectValue!
        let total = shape.records
        var i = 0
        for month in records.keys {
            var list = records[month]!.arrayValue!
            for j in list.indices {
                var o = list[j].objectValue!
                if i % 23 == 7 { o["kind"] = .string("answer-seen"); o["judgment"] = nil; o["help"] = .object(JSObject([("hints", .number(0)), ("answerSeen", .bool(true)), ("traced", .bool(false))])) }
                else if i % 41 == 3 && i < total - shape.inkRecords { o["kind"] = .string("skipped"); o["judgment"] = nil }
                else if i % 31 == 5 && i < total - shape.inkRecords { o["source"] = .string("paper") }
                list[j] = .object(o)
                i += 1
            }
            records[month] = .array(list)
        }
        state["records"] = .object(records)
        return state
    }

    private func makeScaleStore(_ shape: B.Shape, seedFactor: Double, factor: Double) throws -> Store {
        JSMath.flavor = .v8
        let clock = B.Clock(B.benchNow), disk = FakeNativeDisk()
        func store(_ f: Double) -> Store { Store(storage: StoreStorage(disk.open(), now: { clock.t }), now: { clock.t }, budgets: ScaleBenchmarkTests.budgets(f), dates: shanghai) }
        let seeding = store(seedFactor)
        XCTAssertEqual(seeding.load()["available"], .bool(true))
        let r = seeding.seed(.object(try Self.mixedHeavyState(shape)), label: "viewseq-seed")
        XCTAssertEqual(r["ok"], .bool(true), String(JSONWriter.stringify(r).prefix(400)))
        if seedFactor != factor {
            let folding = store(factor)
            XCTAssertEqual(folding.load()["available"], .bool(true))
            clock.t += 1000
            let c = folding.commit("viewseq:fold-trigger") { d, c in
                var sessions = d["sessions"]!.objectValue!
                var A = sessions["A"]!.objectValue!
                A["updatedAt"] = .number(c.now)
                sessions["A"] = .object(A)
                d["sessions"] = .object(sessions)
            }
            XCTAssertEqual(c["ok"], .bool(true), String(JSONWriter.stringify(c).prefix(400)))
        }
        let s = store(factor)
        XCTAssertEqual(s.load()["available"], .bool(true))
        return s
    }

    /// PageAPI.call 的回答 vs 参照（MineAPI / MineSubAPI 的外壳照抄，里面换成参照的视图）。
    private func compareStore(_ store: Store, label: String, fullDays: Bool) throws {
        let state = JSValue.object(store.state), dates = store.dates
        let today = try dates.localDay(.number(store.now()))
        for a in [JSObject([("width", .number(402))]), JSObject([("width", .number(375)), ("ax", .number(1)), ("today", .string("2027-01-03"))])] {
            let got = PageAPI.call("view.mine", store: store, args: a)
            XCTAssertEqual(got["ok"], .bool(true), label + " mine: " + String(JSONWriter.stringify(got).prefix(300)))
            same("\(label) api view.mine \(JSONWriter.stringify(.object(a)))", { got }, { try ViewRef.mineReply(store, a) })
        }
        let index = ViewRef.recordIndex(state, dates: dates)
        let months = try Self.monthsToCheck(state, today: today, dates: dates)
        for m in months {
            let gotMonth = PageAPI.call("view.month", store: store, args: JSObject([("month", .string(m))]))
            same("\(label) api view.month \(m)", { gotMonth }, { JS.obj([("ok", .bool(true)), ("view", try ViewRef.monthView(state, month: m, policy: Config.policy, dates: dates))]) })
            let days = index.days.items.filter { $0.hasPrefix(m + "-") }.sorted()
            let chosen: [String] = fullDays ? days : [days.first, days.last, "2026-10-20"].compactMap { $0 }
            let picks: [String?] = [nil] + chosen.map { Optional($0) }
            for day in picks {
                var a = JSObject([("month", .string(m))]); if let day { a["day"] = .string(day) }
                let got = PageAPI.call("view.records", store: store, args: a)
                same("\(label) api view.records \(m) \(day ?? "-")", { got }, { JS.obj([("ok", .bool(true)), ("view", try ViewRef.recordsView(state, today: today, a, dates: dates))]) })
            }
            let inkOf: ImageSelection.InkOf = { try DetailView.builtInk(state, record: $0, dates: dates) }
            for pick in ["first", "last"] {
                same("\(label) monthMembers \(m) \(pick)", { try ImageSelection.monthMembers(state, month: m, pick: pick, dates: dates) }, { try ViewRef.monthMembers(state, month: m, pick: pick, dates: dates) })
                let scope = JSValue.object(JSObject([("kind", .string("month")), ("month", .string(m))]))
                same("\(label) imagePlan \(m) \(pick)", { try ImageSelection.imagePlan(state, scope: scope, inkOf: inkOf, monthPick: pick, dates: dates) }, { try ViewRef.imagePlan(state, scope: scope, inkOf: inkOf, monthPick: pick, dates: dates) })
            }
        }
        same("\(label) works", { .array(V.recordIndex(state, dates: dates).works) }, { .array(ViewRef.works(index)) })
        for t in [today, "2026-01-01", "2025-12-31", "2027-01-03", "2020-05-05"] {
            same("\(label) annualDefaultYear \(t)", { V.annualDefaultYear(state, today: t, index: V.recordIndex(state, dates: dates)) }, { AnnualView.annualDefaultYear(state, today: t, dates: dates) })
        }
        print("VIEWEQ \(label) months=\(months.count) compared=\(compared)")
    }

    func testScale1xMatchesReference() throws {
        let store = try makeScaleStore(B.shape1x, seedFactor: 1, factor: 1)
        try compareStore(store, label: "1x", fullDays: ProcessInfo.processInfo.environment["SHIZI_SCALE_BENCH"] == "1")
    }

    func testScale3xFoldedMatchesReference() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["SHIZI_SCALE_BENCH"] == "1", "3x-folded equivalence runs only with SHIZI_SCALE_BENCH=1")
        let store = try makeScaleStore(ScaleBenchmarkTests.shape3x(), seedFactor: 3, factor: 1)
        let folded = store.state["records"]?.objectValue?.entries.filter { $0.value["folded"] == .bool(true) }.count ?? 0
        XCTAssertGreaterThan(folded, 0, "3x-folded must have folded months")
        try compareStore(store, label: "3x-folded", fullDays: true)
    }
}

extension ViewScaleEquivalenceTests.RNG: RandomNumberGenerator {}

// MARK: - 参照：改动前的写法（照抄；只把 index.works 换成 ViewRef.works(index)、把同文件的调用补上类型前缀）

enum ViewRef {
    typealias V = ViewSupport

    // ---- Views/Mine.swift ----

    static func works(_ index: V.RecordIndex) -> [JSValue] {
        let all = index.afterSeen.isEmpty ? index.judged : Records.sortById(index.judged + index.afterSeen)
        return all.filter { WorkMembers.isWorkMember($0, hasInk: { InkPick.storedInkPresent(.object(JSObject([("ink", index.ink)])), $0, timeZone: index.dates.timeZone) }) }
    }
    static func recordIndex(_ state: JSValue, dates: Dates) -> V.RecordIndex {
        let records = Query.flattenRecords(state["records"]), judged = Records.sortById(records.filter(Records.isJudged))
        var folded = JSObject(), days = KeySet()
        for (month, value) in state["records"]?.objectValue?.entries ?? [] where value["folded"] == .bool(true) {
            var byDay = JSObject()
            for (day, chars) in value["byDay"]?.objectValue?.entries ?? [] where dates.isValidDay(.string(day)) && !(chars.arrayValue ?? []).isEmpty { byDay[day] = chars; days.insert(day) }
            var f = JSObject([("byDay", .object(byDay)), ("chars", .array(value["chars"]?.arrayValue ?? []))])
            for key in ["paperOnly", "work", "workJudged"] { if let v = value[key], v.objectValue != nil || v.arrayValue != nil { f[key] = v } }
            if let kept = value["kept"]?.arrayValue { f["kept"] = .array(kept) }; folded[month] = .object(f)
        }
        for r in judged where dates.isValidDay(r["localDay"] ?? .null) { days.insert(JS.string(r["localDay"])) }
        let ink = state["ink"]?.objectValue != nil ? state["ink"]! : .null
        let seen = Records.sortById(records.filter { $0["kind"] == .string("answer-seen") && Records.isAfterSeenWork($0, { InkPick.storedInkPresent(state, $0, timeZone: dates.timeZone) }) })
        return V.RecordIndex(judged: judged, folded: folded, days: days, ink: ink, afterSeen: seen, dates: dates)
    }
    static func monthSheet(_ index: V.RecordIndex, month: String, policy: JSValue, hasInk: InkPick.HasInk? = nil) -> JSValue {
        let pick = policy["monthSheetPick"] == .string("last") ? "last" : "first", days = V.recordDaysInMonth(index, month: month).count, fold = index.folded[month]
        let has: InkPick.HasInk = hasInk ?? { InkPick.storedInkPresent(V.obj([("ink", index.ink)]), $0, timeZone: index.dates.timeZone) }
        let records = works(index).filter { JS.string($0["localDay"]).hasPrefix(month+"-") }
        var raw: [JSValue] = []
        if let fold {
            let work = Records.foldWorkByDay(fold); var firstDay = JSObject()
            for day in work.keys.sorted() { for c in work[day]?.arrayValue ?? [] where firstDay[JS.string(c)] == nil { firstDay[JS.string(c)] = .string(day) } }
            raw = firstDay.entries.map { c, day in
                let m = WorkMembers.workMembers(records.filter { $0["char"] == .string(c) }, prefer: .string(pick), hasInk: has).first
                return V.obj([("char", .string(c)), ("day", day), ("record", m?.record ?? .null), ("dot", .bool(m?.dot ?? false))])
            }
        } else { raw = WorkMembers.workMembers(records, prefer: .string(pick), order: .string("first"), hasInk: has).map { m in V.obj([("char", .string(m.char)), ("day", m.firstDay), ("record", m.record), ("dot", .bool(m.dot))]) } }
        let cells = V.retagRecordCells(raw)
        return V.obj([("month", .string(month)), ("cells", .array(cells)), ("days", .number(Double(days))), ("chars", .number(Double(cells.count))), ("folded", .bool(fold != nil)), ("pick", .string(pick))])
    }
    static func dayItems(_ index: V.RecordIndex, day: String, hasInk: InkPick.HasInk? = nil) -> [JSValue] {
        guard index.dates.isValidDay(.string(day)) else { return [] }
        let records = works(index).filter { $0["localDay"] == .string(day) }, has: InkPick.HasInk = hasInk ?? { InkPick.storedInkPresent(V.obj([("ink", index.ink)]), $0, timeZone: index.dates.timeZone) }
        if let fold = index.folded[String(day.prefix(7))] {
            return (Records.foldWorkByDay(fold, order: "last")[day]?.arrayValue ?? []).map { c in
                let m = WorkMembers.workMembers(records.filter { $0["char"] == c }, prefer: .string("last"), hasInk: has).first
                return V.obj([("char", c), ("record", m?.record ?? .null), ("dot", .bool(m?.dot ?? false))])
            }
        }
        return WorkMembers.workMembers(records, prefer: .string("last"), order: .string("last"), hasInk: has).map { V.obj([("char", .string($0.char)), ("record", $0.record), ("dot", .bool($0.dot))]) }
    }
    static func overviewModel(_ state: JSValue, today: String, index: V.RecordIndex) throws -> JSValue {
        let days = KeySet(V.practiceDaySet(state, index: index).items.filter { $0 <= today })
        return try V.obj([("streak", .number(Double(V.streakDays(days, today: today, dates: index.dates)))), ("total", .number(Double(days.count))), ("chars", V.memoryZones(state, today: today, dates: index.dates)["recorded"]!)])
    }
    static func backupHint(_ state: JSValue, today: String, index: V.RecordIndex, storagePressure: JSValue?) throws -> JSValue {
        guard !index.days.items.isEmpty else { return .null }; if V.storagePressureNear(storagePressure ?? state["storagePressure"]) { return V.obj([("kind", .string("pressure"))]) }
        let meta = state["backupMeta"], last = try V.lastBackupDay(meta, dates: index.dates)
        if JS.truthy(last), meta?["lastExportSig"]?.stringValue == Backup.recordsSignature(state["records"]) { return .null }
        let since = JS.truthy(last) ? last.stringValue : index.days.items.min()
        guard let since, index.dates.isValidDay(.string(today)) else { return .null }; let days = try index.dates.diffDays(.string(since), .string(today))
        return days >= 30 ? V.obj([("kind", .string("stale")), ("days", .number(days))]) : .null
    }
    static func mineModel(_ state: JSValue, today: String, policy: JSValue, hasInk: InkPick.HasInk? = nil, storagePressure: JSValue?, dates: Dates) throws -> JSValue {
        let index = recordIndex(state, dates: dates), empty = index.days.count == 0, month = String(today.prefix(7)), sheet = monthSheet(index, month: month, policy: policy, hasInk: hasInk)
        return try V.obj([("today", .string(today)), ("empty", .bool(empty)), ("overview", overviewModel(state, today: today, index: index)), ("month", .string(month)), ("sheet", sheet), ("preview", V.sheetPreview(sheet)), ("sheetOn", .bool(!empty && !(sheet["cells"]?.arrayValue ?? []).isEmpty)), ("lastBackup", V.lastBackupDay(state["backupMeta"], dates: dates)), ("backupHint", backupHint(state, today: today, index: index, storagePressure: storagePressure)), ("year", .number(Double(Int(today.prefix(4))!)))])
    }
    static func recordsModel(_ state: JSValue, today: String, month: JSValue?, day: JSValue?, policy: JSValue, hasInk: InkPick.HasInk? = nil, dates: Dates) throws -> JSValue {
        let index = recordIndex(state, dates: dates), current = String(today.prefix(7)), m = V.clampMonth(month, index: index, today: today), first = V.firstRecordMonth(index), days = V.recordDaysInMonth(index, month: m)
        var selected: JSValue = .null
        if let day = day?.stringValue, dates.isValidDay(.string(day)), day.hasPrefix(m+"-"), index.days.contains(day) { selected = V.obj([("day", .string(day)), ("items", .array(dayItems(index, day: day, hasInk: hasInk)))]) }
        let todayItems = index.days.contains(today) ? dayItems(index, day: today, hasInk: hasInk) : []
        return try V.obj([("today", .string(today)), ("month", .string(m)), ("year", .number(Double(Int(m.prefix(4))!))), ("monthNum", .number(Double(Int(m.suffix(2))!))), ("current", .bool(m == current)), ("prev", first != nil && m > first! ? .string(dates.addMonths(.string(m), -1)) : .null), ("next", m < current ? .string(dates.addMonths(.string(m), 1)) : .null), ("calendar", .array(V.calendarModel(index, month: m, today: today))), ("recordDays", .number(Double(days.count))), ("dayList", .array(days.map { d in V.obj([("day", .string(d)), ("n", .number(Double(dayItems(index, day: d, hasInk: hasInk).count))), ("today", .bool(d == today))]) })), ("sheet", monthSheet(index, month: m, policy: policy, hasInk: hasInk)), ("selected", selected), ("todayRow", m == current && !todayItems.isEmpty ? V.obj([("day", .string(today)), ("n", .number(Double(todayItems.count))), ("items", .array(todayItems))]) : .null), ("empty", .bool(index.days.count == 0))])
    }

    // ---- Views/MinePage.swift ----

    static func monthSheetCells(_ state: JSValue, month: String, policy: JSValue, dates: Dates) throws -> JSValue {
        let r = try imagePlan(state, scope: V.obj([("kind", .string("month")), ("month", .string(month))]), inkOf: { try DetailView.builtInk(state, record: $0, dates: dates) }, hasInk: { DetailView.recordHasInk(state, record: $0, dates: dates) }, maxChars: Int(JS.number(policy["imageMaxChars"])), monthPick: policy["monthSheetPick"]?.stringValue ?? "first", dates: dates)
        let cells = try (r["cells"]?.arrayValue ?? []).enumerated().map { i,c -> JSValue in
            V.obj([("key", .string(JS.string(c["ch"])+"-"+String(i))), ("ch", c["ch"]!), ("mode", c["mode"]!), ("tag", c["tag"]!), ("day", JS.truthy(c["day"]) ? c["day"]! : .string("")), ("record", c["record"]?["id"] ?? .string("")), ("rec", c["record"] ?? .null), ("label", try MinePageView.cellLabelRef(c, dates: dates))])
        }
        return V.obj([("month", .string(month)), ("monthNum", .number(Double(month.suffix(2))!)), ("cells", .array(cells)), ("n", .number(Double(cells.count))), ("days", r["days"] ?? .number(0)), ("under", .bool(cells.contains { $0["mode"] == .string("under") })), ("kuan", cells.isEmpty ? .null : try KuanView.kuanRef(JSObject([("month", .string(month)), ("n", .number(Double(cells.count)))]), now: 0, dates: dates))])
    }
    static func mineSheetView(_ state: JSValue, model: JSValue, policy: JSValue, width: Double, ax: Double, dates: Dates) throws -> JSValue {
        let month = JS.string(model["month"]), mv = try monthSheetCells(state, month: month, policy: policy, dates: dates), rows = MinePageView.mineSheetRows(Int(JS.number(mv["n"])), ax: ax), cols = Int(JS.number(rows["cols"])), trimmed = MinePageView.trimSheetCells(mv["cells"]!.arrayValue!, max: max(1, Int(JS.number(rows["max"])))), shown = trimmed["cells"]!.arrayValue!, n = mv["n"]!
        var out = JSObject([("month", .string(month)), ("monthNum", mv["monthNum"]!), ("title", V.ref("R-P02.sheetTitle", V.obj([("month", mv["monthNum"]!)]))), ("aria", V.ref("X-WORK.monthTitle", V.obj([("month", mv["monthNum"]!)]))), ("total", n), ("shown", .number(Double(shown.count))), ("truncated", trimmed["truncated"]!), ("days", model["sheet"]!["days"]!), ("all", JS.truthy(n) ? V.ref("R-M05.sheetAll", V.obj([("n", n)])) : .null), ("empty", shown.isEmpty ? V.ref("X-MINE.sheetEmpty") : .null), ("note", !shown.isEmpty && JS.truthy(mv["under"]) ? V.ref("X-WORK.monthUnderNote") : .null), ("paper", .null)])
        guard !shown.isEmpty else { return .object(out) }
        let g = try ImageLayout.sheetGrid(shown.count, width: width-40, cols: JS.truthy(trimmed["truncated"]) || ax > 0 ? cols : 0), tags = ImageLayout.sheetTags(shown), sign = !JS.truthy(trimmed["truncated"])
        var paper = JSObject()
        for k in ["cols", "rows", "c", "W", "H", "lastW", "full", "outline", "inner"] { paper[k] = g[k] }
        paper["pad"] = .number(0.12); paper["widthScale"] = .number(ImageLayout.inkWidthScale(JS.number(g["c"]))); paper["sign"] = .bool(sign); paper["kuan"] = sign ? mv["kuan"]! : .null
        paper["seal"] = V.obj([("size", .number(24)), ("below", g["full"]!), ("x", .number(JS.number(g["lastW"])+8)), ("y", .number(JS.number(g["H"])-24))]); paper["sealPath"] = try CoreResources.load("view-seal")
        paper["cells"] = .array(try shown.enumerated().map { i,c -> JSValue in
            let hand = c["mode"] == .string("hand") && JS.truthy(c["rec"]), point = g["cells"]!.arrayValue![i]
            return V.obj([("ch", c["ch"]!), ("mode", c["mode"]!), ("tag", tags[i]), ("day", c["day"]!), ("record", c["record"]!), ("label", c["label"]!), ("x", point["x"]!), ("y", point["y"]!), ("ink", hand ? V.obj([("points", try DetailView.builtInk(state, record: c["rec"], dates: dates) ?? .array([]))]) : .null), ("strokes", hand ? try QueryView.sheetStrokes(state, c["rec"], dates: dates) : .array([]))])
        }); out["paper"] = .object(paper); return .object(out)
    }
    static func mineView(_ state: JSValue, today: String, _ a: JSObject, dates: Dates) throws -> JSValue {
        let policy = V.policy(a["policy"]), m = try mineModel(state, today: today, policy: policy, hasInk: { DetailView.recordHasInk(state, record: $0, dates: dates) }, storagePressure: a["storagePressure"], dates: dates), view = SettingsView.settingsView(state["settings"]), year = AnnualView.annualDefaultYear(state, today: today, dates: dates)
        func stat(_ id: String, _ key: String, _ label: String, _ unit: String) -> JSValue { V.obj([("id", .string(id)), ("n", m["overview"]![key]!), ("label", V.ref(label)), ("unit", V.ref(unit))]) }
        var out = JSObject()
        out["title"] = V.ref("X-TABS.mine"); out["today"] = .string(today); out["month"] = m["month"]; out["empty"] = m["empty"]
        out["overview"] = .array([stat("streak","streak","X-MINE.ovStreak","X-MINE.ovDay"),stat("total","total","X-MINE.ovTotal","X-MINE.ovDay"),stat("chars","chars","X-MINE.ovChars","X-MINE.ovChar")])
        out["emptyBlock"] = JS.truthy(m["empty"]) ? V.obj([("title", V.ref("R-M04.emptyTitle")), ("body", V.ref("R-M04.emptyBody"))]) : .null
        out["sheet"] = JS.truthy(m["empty"]) ? .null : try mineSheetView(state, model: m, policy: policy, width: a["width"]?.numberValue ?? 402, ax: a["ax"]?.numberValue ?? 0, dates: dates)
        out["remind"] = V.obj([("label", V.ref("R-M03.remind")), ("on", view["on"]!), ("time", JS.truthy(view["on"]) ? .string(SettingsView.timeText(view["remind"]?["hour"], view["remind"]?["minute"])) : .null), ("off", V.ref("R-M03.remindOff")), ("to", .string("remind"))])
        out["library"] = V.obj([("label", V.ref("R-S01.library")), ("value", view["libraryName"]!), ("id", view["library"]!), ("to", .string("library-switch"))]); out["appearanceOn"] = view["appearanceSwitch"]; out["choices"] = MinePageView.mineChoices(view, policy: policy, settings: state["settings"])
        out["choiceFail"] = V.obj([("note", V.ref("X-SETTINGS.saveFailed")), ("cancel", V.ref("X-SETTINGS.cancel")), ("retry", V.ref("X-SETTINGS.retry"))]); out["done"] = V.ref("X-COMMON.done")
        out["backup"] = V.obj([("label", V.ref("R-M03.backup")), ("value", try MinePageView.backupValueRef(m, dates: dates)), ("last", JS.truthy(m["lastBackup"]) ? m["lastBackup"]! : .string("")), ("hint", m["backupHint"]?["kind"] ?? .string("")), ("to", .string("backup"))])
        out["annual"] = V.obj([("label", V.ref("X-MINE.annual")), ("year", .string(JS.string(year))), ("to", .string("annual")), ("params", year == m["year"] ? V.obj([]) : V.obj([("year", year)]))])
        out["about"] = V.obj([("label", V.ref("X-MINE.about")), ("to", .string("about"))]); out["records"] = V.obj([("to", .string("records")), ("params", V.obj([("month", m["month"]!)]))]); out["detail"] = V.obj([("to", .string("detail"))]); out["version"] = AboutView.versionRefs(a["build"]?["version"], a["build"]?["build"])["line"]
        return .object(out)
    }

    /// Session/API/MineAPI.swift 的 view.mine 外壳（hooks 为 nil）。
    static func mineReply(_ store: Store, _ a: JSObject) throws -> JSValue {
        let width = a["width"]?.numberValue.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? 402
        let ax = SessionWrites.integer(a["ax"]) && JS.number(a["ax"]) > 0 ? min(5, JS.number(a["ax"])) : 0
        let candidate = a["today"]?.stringValue ?? "", today = candidate.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil ? candidate : try store.dates.localDay(.number(store.now()))
        var args = a; args["width"] = .number(width); args["ax"] = .number(ax); args["storagePressure"] = Budget.storagePressureOf(store.status["usage"]); args["build"] = JS.obj([("version", .string("")), ("build", .string(""))])
        let view = try mineView(.object(store.state), today: today, args, dates: store.dates)
        return JS.obj([("ok", .bool(true)), ("view", SessionWrites.patch(view, [("env", JS.obj([("width", .number(width)), ("ax", .number(ax))]))]))])
    }

    // ---- Views/MineSub.swift ----

    static func monthCells(_ state: JSValue, month: String, policy: JSValue, dates: Dates) throws -> JSValue {
        try imagePlan(state, scope: V.obj([("kind", .string("month")), ("month", .string(month))]), inkOf: { try DetailView.builtInk(state, record: $0, dates: dates) }, maxChars: Int(JS.number(policy["imageMaxChars"])), monthPick: policy["monthSheetPick"]?.stringValue ?? "first", dates: dates)
    }
    static func displayMonth(_ state: JSValue, month: String, policy: JSValue, block: Bool, dates: Dates) throws -> JSValue {
        let r = try monthCells(state, month: month, policy: policy, dates: dates), raw = r["cells"]?.arrayValue ?? []
        if block && raw.isEmpty { return .null }
        var cells = try raw.enumerated().map { i, c -> JSValue in
            var out = try MineSubView.cellModel(c["ch"]!, record: c["record"], mode: c["mode"]!, day: c["day"], tag: c["tag"], dates: dates)
            out["key"] = .string(JS.string(c["ch"])+"-"+String(i)); out["ink"] = JS.truthy(c["ink"]) ? V.obj([("points", c["ink"]!)]) : .null; return .object(out)
        }
        let tags = ImageLayout.sheetTags(cells)
        cells = cells.enumerated().map { i, c in var o = c.objectValue!; o["tag"] = tags[i]; return .object(o) }
        let n = cells.count, mn = Double(month.suffix(2))!
        var out = JSObject([("month", .string(month)), ("monthNum", .number(mn)), ("cells", .array(cells)), ("n", .number(Double(n))), ("days", r["days"] ?? .number(0)), ("under", .bool(cells.contains { $0["mode"] == .string("under") }))])
        out["kuan"] = n > 0 ? try Copy.tRef(KuanView.kuanRef(JSObject([("month", .string(month)), ("n", .number(Double(n)))]), now: 0, dates: dates)) : .string("")
        out["cols"] = .number(Double(ImageLayout.sheetColumns(n)))
        if block { out["folded"] = .bool(recordIndex(state, dates: dates).folded[month] != nil); out["title"] = V.ref("R-P02.sheetTitle", V.obj([("month", .number(mn))])) }
        out["seal"] = try CoreResources.load("view-seal")
        if !block { out["lines"] = V.obj([("sub", ViewLineStarts.starts("month-sub", V.ref("X-MINE.sheetOrder")))]) }; return .object(out)
    }
    static func monthView(_ state: JSValue, month: String, policy: JSValue, dates: Dates) throws -> JSValue { try displayMonth(state, month: month, policy: policy, block: false, dates: dates) }
    static func monthSheetOf(_ state: JSValue, month: String, policy: JSValue, dates: Dates) throws -> JSValue { try displayMonth(state, month: month, policy: policy, block: true, dates: dates) }
    static func recordsView(_ state: JSValue, today: String, _ a: JSObject, dates: Dates) throws -> JSValue {
        let policy = V.policy(a["policy"]), m = try recordsModel(state, today: today, month: a["month"], day: a["day"], policy: policy, dates: dates)
        let calendar = m["calendar"]!.arrayValue!.map { c -> JSValue in
            let b = JS.truthy(c["blank"])
            return V.obj([("key", c["key"]!), ("blank", .bool(b)), ("day", b ? .string("") : c["day"]!), ("n", b ? .number(0) : c["n"]!), ("has", .bool(!b && JS.truthy(c["has"]))), ("today", .bool(!b && JS.truthy(c["today"]))), ("future", .bool(!b && JS.truthy(c["future"])))])
        }
        var selected: JSValue = .null
        if let s = m["selected"], JS.truthy(s) {
            let cells = try s["items"]!.arrayValue!.map { it -> JSValue in
                let pts = try DetailView.builtInk(state, record: it["record"], dates: dates)
                var c = try MineSubView.cellModel(it["char"]!, record: it["record"], mode: .string(pts != nil ? "hand" : "under"), day: s["day"], tag: .string(""), dates: dates)
                c["key"] = .string("d-"+JS.string(it["char"])); c["ink"] = pts.map { V.obj([("points", $0)]) } ?? .null
                var label = c; label["record"] = it["record"]; c["label"] = try MineSubView.dayCellLabelRef(.object(label), dates: dates); return .object(c)
            }
            selected = V.obj([("day", s["day"]!), ("title", V.ref("R-P03.todayChars", V.obj([("date", try MineSubView.dayTextRef(s["day"]!, dates: dates))]))), ("paper", .bool(cells.isEmpty)), ("paperNote", V.ref("X-MINE.paperDayNote")), ("cells", .array(cells))])
        }
        let has = JS.truthy(m["recordDays"]), title = V.ref(has ? "R-P01.monthDays" : "X-MINE.monthNone", V.obj(has ? [("month", m["monthNum"]!), ("n", m["recordDays"]!)] : [("month", m["monthNum"]!)])), legend = V.ref(has ? "R-P01.legend" : "R-P04.empty")
        let dayList = try m["dayList"]!.arrayValue!.map { r -> JSValue in V.obj([("day", r["day"]!), ("n", r["n"]!), ("today", r["today"]!), ("label", V.ref(JS.truthy(r["n"]) ? "X-MINE.axDayRow" : "X-MINE.axDayRowPaper", V.obj(JS.truthy(r["n"]) ? [("date", try MineSubView.dayTextRef(r["day"]!, dates: dates)), ("n", r["n"]!)] : [("date", try MineSubView.dayTextRef(r["day"]!, dates: dates))])))]) }
        let sheet = try monthSheetOf(state, month: JS.string(m["month"]), policy: policy, dates: dates)
        var out = JSObject()
        for k in ["today", "month", "year", "monthNum", "current", "prev", "next"] { out[k] = m[k] }
        out["monthHead"] = MineSubView.monthHeadRef(m["monthNum"]!); out["yearText"] = .string(JS.string(m["year"])); out["title"] = title; out["legend"] = legend; out["weekdays"] = V.ref("X-MINE.weekdays"); out["calendar"] = .array(calendar); out["recordDays"] = m["recordDays"]; out["dayList"] = .array(dayList); out["selected"] = selected; out["sheet"] = sheet
        if let r = m["todayRow"], JS.truthy(r) { out["todayRow"] = V.obj([("day", r["day"]!), ("n", r["n"]!), ("title", V.ref("R-P03.todayChars", V.obj([("date", try MineSubView.dayTextRef(r["day"]!, dates: dates))]))), ("note", V.ref("R-P03.todayImage"))]) } else { out["todayRow"] = .null }
        out["seal"] = try CoreResources.load("view-seal"); out["lines"] = V.obj([("title", ViewLineStarts.starts("records-title", title)), ("legend", ViewLineStarts.starts("records-legend", legend)), ("dayRows", .array(dayList.map { ViewLineStarts.starts("records-axrow", $0["label"]!) })), ("paperday", JS.truthy(selected) ? ViewLineStarts.starts("records-paperday", selected["paperNote"]!) : .null), ("daylistTitle", JS.truthy(selected) ? ViewLineStarts.starts("records-daylist-title", selected["title"]!) : .null), ("sheetNote", JS.number(sheet["n"]) > 0 && JS.truthy(sheet["under"]) ? ViewLineStarts.starts("records-sheet-note", V.ref("X-WORK.monthUnderNote")) : .null)])
        return .object(out)
    }

    // ---- Images/ImageSelection.swift ----

    typealias S = ImageSelection

    static func monthMembers(
        _ state: JSValue, month: String, pick: String = "first", hasInk: InkPick.HasInk? = nil,
        added: [String]? = nil, dates: Dates
    ) throws -> JSValue {
        guard dates.isValidMonth(.string(month)) else { throw CoreError.badArgs("INVALID_MONTH") }
        let has: InkPick.HasInk =
            hasInk ?? { InkPick.storedInkPresent(state, $0, timeZone: dates.timeZone) }
        let records = WorkMembers.workMemberRecords(
            S.flattenRecords(state["records"]), hasInk: has, added: .init(added)
        ).filter { S.str($0["localDay"]).hasPrefix(month + "-") }
        let picker: WorkMembers.PickInk = hasInk.map { .test($0) } ?? .none
        let prefer: JSValue = .string(pick == "first" ? "first" : "last")
        var days: [String] = []
        var members: [JSValue] = []
        if let fold = S.folded(state, month) {
            let byDay = Records.foldWorkByDay(fold)
            days = byDay.keys.filter { $0.hasPrefix(month + "-") }.sorted()
            var seen: [JSValue] = []
            for d in days {
                for ch in byDay[d]?.arrayValue ?? [] {
                    if seen.contains(ch) { continue }
                    seen.append(ch)
                    let list = records.filter { S.char($0) == S.str(ch) }
                    let m = WorkMembers.workMembers(
                        list, prefer: prefer, hasInk: has, pickInk: picker, added: .init(added)
                    ).first
                    members.append(
                        S.obj([
                            ("char", ch), ("cardKey", m?.record["cardKey"] ?? .string("base:" + S.str(ch))),
                            ("record", m?.record ?? .null), ("firstDay", .string(d)),
                            ("dot", .bool(m?.dot ?? false)),
                        ]))
                }
            }
        } else {
            for r in records {
                let d = S.str(r["localDay"])
                if !days.contains(d) { days.append(d) }
            }
            days.sort()
            members = WorkMembers.workMembers(
                records, prefer: prefer, order: .string("first"), hasInk: has, pickInk: picker,
                added: .init(added)
            ).map(\.js)
        }
        return S.obj([
            ("members", .array(members)), ("days", .number(Double(days.count))),
            ("dayList", .array(days.map(JSValue.string))), ("month", .string(month)),
            ("pick", .string(pick)),
        ])
    }

    static func imagePlan(
        _ state: JSValue, scope: JSValue, inkOf: @escaping ImageSelection.InkOf, hasInk: InkPick.HasInk? = nil,
        maxChars: Int = 80, monthPick: String = "first", dates: Dates
    ) throws -> JSValue {
        let kind = S.str(scope["kind"])
        guard ["session", "day", "month", "glyph"].contains(kind) else {
            throw CoreError.badArgs("INVALID_KIND")
        }
        let has: InkPick.HasInk = hasInk ?? { S.points($0, inkOf) != nil }
        var members: [JSValue] = []
        var cells: [JSValue] = []
        var missing: [JSValue] = []
        var day: JSValue = .null
        var month: JSValue = .null
        var days: JSValue = .null
        var work: JSValue = .null
        var key: JSValue = .null
        if kind == "session" {
            key = scope["sessionId"] ?? .null
            let all = S.flattenRecords(state["records"]).filter { $0["sessionId"] == key }
            let s = S.findSession(state, slot: scope["slot"]?.stringValue, sessionId: key)
            let items =
                s?["items"]?.arrayValue
                ?? all.filter { JSX.eq($0["kind"], "judged") }.map {
                    S.obj([
                        ("cardKey", $0["cardKey"] ?? .null), ("recordId", $0["id"] ?? .null),
                        ("kind", $0["kind"] ?? .null),
                    ])
                }
            work = S.buildWork(items: items, records: all, hasInk: has, added: S.addedOf(s))
            day = try S.sessionDay(s, records: all, dates: dates)
            members = work["cells"]?.arrayValue ?? []
            cells = members.map { m in
                S.obj([
                    ("ch", m["char"] ?? .null), ("ink", S.points(m["record"], inkOf) ?? .null),
                    ("mode", .string("hand")), ("dot", m["dot"] ?? .bool(false)), ("tag", .string("")),
                    ("day", day), ("record", m["record"] ?? .null),
                ])
            }
            missing = (work["entries"]?.arrayValue ?? []).filter {
                !["in", "added", "addable"].contains(S.str($0["state"]))
            }.map { $0["char"] ?? .null }
        } else if kind == "day" {
            day = scope["day"] ?? .null
            key = day
            members =
                try S.dayMembers(state, day: S.str(day), hasInk: has, dates: dates)["members"]?.arrayValue ?? []
            for m in members {
                if let c = S.cellOfMember(m, inkOf: inkOf) {
                    cells.append(c)
                } else {
                    missing.append(m["char"] ?? .null)
                }
            }
        } else if kind == "month" {
            month = scope["month"] ?? .null
            key = month
            let r = try monthMembers(state, month: S.str(month), pick: monthPick, hasInk: has, dates: dates)
            days = r["days"] ?? .null
            members = r["members"]?.arrayValue ?? []
            cells = ImageLayout.withDayTags(
                members.compactMap { S.cellOfMember($0, inkOf: inkOf, under: true) })
        } else {
            key = scope["char"] ?? .null
            let m = S.glyphMember(state, char: S.str(key))
            members = m.isNull ? [] : [m]
            day = m["record"]?["localDay"] ?? .null
            if !m.isNull {
                if let c = S.cellOfMember(m, inkOf: inkOf) {
                    cells = [c]
                } else {
                    missing = [m["char"] ?? .null]
                }
            }
        }
        let drawn = cells.filter { JSX.eq($0["mode"], "hand") }.map {
            S.obj([
                ("char", $0["ch"] ?? .null), ("record", $0["record"] ?? .null),
                ("points", $0["ink"] ?? .null), ("tag", $0["tag"] ?? .null),
            ])
        }
        let status =
            kind == "glyph" ? (drawn.isEmpty ? "noInk" : "ready") : (cells.isEmpty ? "empty" : "ready")
        var pages =
            kind == "glyph" ? (cells.isEmpty ? [] : [cells]) : ImageLayout.paginate(cells, max: maxChars)
        if kind == "month" { pages = pages.map(ImageLayout.withDayTags) }
        return S.obj([
            ("kind", .string(kind)), ("key", key), ("status", .string(status)), ("day", day),
            ("month", month), ("days", days), ("maxChars", .number(Double(maxChars))),
            ("members", .array(members)), ("cells", .array(cells)), ("drawn", .array(drawn)),
            ("missing", .array(missing)), ("n", .number(Double(cells.count))),
            ("pages", .array(pages.map(JSValue.array))), ("work", work),
            ("recordIds", .array(cells.compactMap { $0["record"]?["id"] })),
        ])
    }
}
