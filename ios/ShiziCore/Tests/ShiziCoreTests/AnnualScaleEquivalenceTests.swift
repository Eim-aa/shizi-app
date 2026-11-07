import Foundation
import XCTest
@testable import ShiziCore

// 年报 / 月报 / 记录 / 我的（及 ImageSelection 的月 / 日 / 年报导出图）提速的等价性：
// 改动前的写法原样抄在 AnnualRef 里当参照，新旧两边的完整回答序列化成 JSON 文字逐字节比（含键序、相等时的先后）；抛错时比错误文字。
// 状态来源：views-pages / images-selection 夹具里的 state；随机多月历史（ViewScaleEquivalenceTests.randomState：看后自写、纸上、跳过、
// 重复 / 不合法 id、同一时间戳、跨年、空月 / 空年、折叠月）；小号的混合 heavyState（经 Store + PageAPI，旧月份真折叠过、跨 2025 / 2026）。
// 1x 与 3x-folded（ScaleBenchmarkTests 同一份数据）只在 SHIZI_SCALE_BENCH=1 时跑（Debug 下参照一侧每格墨迹要解三遍，太慢）。
final class AnnualScaleEquivalenceTests: XCTestCase {
    typealias V = ViewSupport
    typealias B = StoreCommitBenchmarkTests
    typealias VS = ViewScaleEquivalenceTests

    private var compared = 0
    private static var benchOn: Bool { ProcessInfo.processInfo.environment["SHIZI_SCALE_BENCH"] == "1" }

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
        let a: Result<JSValue, Error> = Result { try new() }
        let b: Result<JSValue, Error> = Result { try ref() }
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

    /// 墨迹平铺的回答 vs 参照（旧形状）：AnnualInkPayloadTests.diff——墨迹格按 sameInk 比，其余逐值比（数比位型）。
    private func sameWire(_ label: @autoclosure () -> String, _ wire: JSValue, _ ref: () throws -> JSValue, file: StaticString = #filePath, line: UInt = #line) {
        compared += 1
        let legacy: JSValue
        do { legacy = try ref() } catch {
            XCTFail(label() + " new succeeds, ref throws \(error)", file: file, line: line)
            return
        }
        var out: [String] = [], slots: [String: Int] = [:]
        AnnualInkPayloadTests.diff(wire, legacy, "reply", &out, &slots)
        if !out.isEmpty { XCTFail(label() + " differs: \(out.prefix(5))", file: file, line: line) }
    }

    private static func numbers(_ years: [Int]) -> JSValue { .array(years.map { (y: Int) -> JSValue in .number(Double(y)) }) }

    /// 年报要看的年份参数：缺省、每个有记录的年、前后各一个空年、很早的空年、不是整数的。
    private static func yearArgs(_ state: JSValue, dates: Dates) -> [JSValue?] {
        let years = AnnualRef.annualYears(state, dates: dates)
        var out: [JSValue?] = [nil]
        for y in years { out.append(.number(Double(y))) }
        if let f = years.first { out.append(.number(Double(f - 1))) }
        if let l = years.last { out.append(.number(Double(l + 1))) }
        out.append(.number(1999))
        out.append(.number(2025.5))
        return out
    }

    /// 要看的月份：records 里的每个月键（含折叠月、today 之后的月）、有记录的日子所在的月、today 所在月与上一月。
    private static func monthsToCheck(_ state: JSValue, today: String, dates: Dates) throws -> [String] {
        let index = V.recordIndex(state, dates: dates), current = String(today.prefix(7))
        var set = KeySet([current])
        if dates.isValidMonth(.string(current)) { set.insert(try dates.addMonths(.string(current), -1)) }
        for d in index.days.items { set.insert(String(d.prefix(7))) }
        for k in state["records"]?.objectValue?.keys ?? [] where dates.isValidMonth(.string(k)) { set.insert(k) }
        return set.items.filter { dates.isValidMonth(.string($0)) }.sorted()
    }

    /// 年报（模型 / 页 / 导出图）、年份列表、缺省年份。
    private func compareAnnual(_ state: JSValue, today: String, dates: Dates, label: String, plans: Bool = true) {
        let policy = Config.policy
        same("\(label) annualYears", { Self.numbers(AnnualView.annualYears(state, dates: dates)) }, { Self.numbers(AnnualRef.annualYears(state, dates: dates)) })
        let y = Int(today.prefix(4)) ?? 2026
        for t in [today, "\(y)-01-01", "\(y - 1)-12-31", "2000-01-01", "2026-02-30", "x"] {
            same("\(label) annualDefaultYear \(t)", { AnnualView.annualDefaultYear(state, today: t, dates: dates) }, { AnnualRef.annualDefaultYear(state, today: t, dates: dates) })
            same("\(label) mine annualDefaultYear \(t)", { V.annualDefaultYear(state, today: t, index: V.recordIndex(state, dates: dates)) }, { AnnualRef.mineAnnualDefaultYear(state, today: t, index: V.recordIndex(state, dates: dates)) })
        }
        for year in Self.yearArgs(state, dates: dates) {
            let yl = year.map { JSONWriter.stringify($0) } ?? "-"
            same("\(label) today=\(today) annualModel \(yl)", { try AnnualView.annualModel(state, today: today, year: year, policy: policy, dates: dates) },
                 { try AnnualRef.annualModel(state, today: today, year: year, policy: policy, dates: dates) })
            same("\(label) today=\(today) annualView \(yl)", { try MineSubView.annualView(state, today: today, year: year, policy: policy, dates: dates) },
                 { try AnnualRef.annualView(state, today: today, year: year, policy: policy, dates: dates) })
            if plans {
                same("\(label) today=\(today) annualPlan \(yl)", { try AnnualView.annualPlan(state, today: today, year: year, policy: policy, dates: dates) },
                     { try AnnualRef.annualPlan(state, today: today, year: year, policy: policy, dates: dates) })
            }
        }
        // 年报每月的块（view.annual.months 等引擎入口）
        for yv in AnnualRef.annualYears(state, dates: dates) {
            same("\(label) yearSlice \(yv)", { AnnualView.yearSlice(state, year: yv, dates: dates).js }, { AnnualRef.yearSlice(state, year: yv, dates: dates).js })
            same("\(label) yearMonths \(yv)", { .array(try AnnualView.yearMonths(state, AnnualView.yearSlice(state, year: yv, dates: dates), policy: policy, dates: dates)) },
                 { .array(try AnnualRef.yearMonths(state, AnnualRef.yearSlice(state, year: yv, dates: dates), policy: policy, dates: dates)) })
        }
    }

    /// 月报 / 记录 / 我的（页）与月 / 日导出图。days：记录页选中的日子——"all" 每个有记录的日子，"ends" 首尾两天。
    private func compareMonths(_ state: JSValue, today: String, dates: Dates, label: String, allDays: Bool, plans: Bool = true) throws {
        let policy = Config.policy
        for (w, ax, sp) in [(402.0, 0.0, JSValue?.none), (320.0, 2.0, JSValue?.some(.string("near")))] {
            var a = JSObject([("width", .number(w)), ("ax", .number(ax)), ("build", .object(JSObject([("version", .string("")), ("build", .string(""))])))])
            if let sp { a["storagePressure"] = sp }
            same("\(label) today=\(today) mineView w=\(w)", { try MinePageView.mineView(state, today: today, a, dates: dates) }, { try AnnualRef.mineView(state, today: today, a, dates: dates) })
        }
        let index = V.recordIndex(state, dates: dates)
        let months = try Self.monthsToCheck(state, today: today, dates: dates)
        let inkOf: ImageSelection.InkOf = { try DetailView.builtInk(state, record: $0, dates: dates) }
        let recordHas: InkPick.HasInk = { DetailView.recordHasInk(state, record: $0, dates: dates) }
        for m in months {
            same("\(label) monthView \(m)", { try MineSubView.monthView(state, month: m, policy: policy, dates: dates) }, { try AnnualRef.monthView(state, month: m, policy: policy, dates: dates) })
            same("\(label) monthSheetOf \(m)", { try MineSubView.monthSheetOf(state, month: m, policy: policy, dates: dates) }, { try AnnualRef.monthSheetOf(state, month: m, policy: policy, dates: dates) })
            same("\(label) monthSheetCells \(m)", { try MinePageView.monthSheetCells(state, month: m, policy: policy, dates: dates) }, { try AnnualRef.monthSheetCells(state, month: m, policy: policy, dates: dates) })
            let recordDays = index.days.items.filter { $0.hasPrefix(m + "-") }.sorted()
            let chosen: [String] = allDays ? recordDays : [recordDays.first, recordDays.last].compactMap { $0 }
            var picks: [String?] = [nil, m + "-32"]
            for d in chosen { picks.append(d) }
            for day in picks {
                var a = JSObject([("month", .string(m))])
                if let day { a["day"] = .string(day) }
                same("\(label) today=\(today) recordsView \(m) \(day ?? "-")", { try MineSubView.recordsView(state, today: today, a, dates: dates) }, { try AnnualRef.recordsView(state, today: today, a, dates: dates) })
            }
            guard plans else { continue }
            for pick in ["first", "last"] {
                for (hn, h) in [("nil", InkPick.HasInk?.none), ("record", InkPick.HasInk?.some(recordHas))] {
                    same("\(label) monthMembers \(m) \(pick) \(hn)", { try ImageSelection.monthMembers(state, month: m, pick: pick, hasInk: h, dates: dates) },
                         { try AnnualRef.monthMembers(state, month: m, pick: pick, hasInk: h, dates: dates) })
                    let scope = JSValue.object(JSObject([("kind", .string("month")), ("month", .string(m))]))
                    same("\(label) imagePlan month \(m) \(pick) \(hn)", { try ImageSelection.imagePlan(state, scope: scope, inkOf: inkOf, hasInk: h, maxChars: 7, monthPick: pick, dates: dates) },
                         { try AnnualRef.imagePlan(state, scope: scope, inkOf: inkOf, hasInk: h, maxChars: 7, monthPick: pick, dates: dates) })
                }
            }
            for d in chosen + [m + "-01"] {
                let scope = JSValue.object(JSObject([("kind", .string("day")), ("day", .string(d))]))
                for (hn, h) in [("nil", InkPick.HasInk?.none), ("record", InkPick.HasInk?.some(recordHas))] {
                    same("\(label) dayMembers \(d) \(hn)", { try ImageSelection.dayMembers(state, day: d, hasInk: h, dates: dates) }, { try AnnualRef.dayMembers(state, day: d, hasInk: h, dates: dates) })
                    same("\(label) imagePlan day \(d) \(hn)", { try ImageSelection.imagePlan(state, scope: scope, inkOf: inkOf, hasInk: h, dates: dates) },
                         { try AnnualRef.imagePlan(state, scope: scope, inkOf: inkOf, hasInk: h, dates: dates) })
                }
            }
        }
        if plans {
            var scopes: [JSValue] = [.object(JSObject([("kind", .string("day")), ("day", .string("2026-13-01"))])), .object(JSObject([("kind", .string("month")), ("month", .string("2026-13"))])), .object(JSObject([("kind", .string("nope"))]))]
            let recs = Query.flattenRecords(state["records"])
            for c in Array(Set(recs.compactMap { $0["char"]?.stringValue })).sorted().prefix(2) { scopes.append(.object(JSObject([("kind", .string("glyph")), ("char", .string(c))]))) }
            for s in Array(Set(recs.compactMap { $0["sessionId"]?.stringValue })).sorted().prefix(2) { scopes.append(.object(JSObject([("kind", .string("session")), ("sessionId", .string(s))]))) }
            for scope in scopes {
                same("\(label) imagePlan \(JSONWriter.stringify(scope))", { try ImageSelection.imagePlan(state, scope: scope, inkOf: inkOf, dates: dates) }, { try AnnualRef.imagePlan(state, scope: scope, inkOf: inkOf, dates: dates) })
            }
        }
    }

    // MARK: 夹具

    private static func fixtureCases(_ name: String) throws -> [(tz: String, c: JSValue)] {
        guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures") else { throw XCTSkip("missing fixture " + name) }
        let doc = try JSONParser.parse(try String(contentsOf: url, encoding: .utf8))
        if let list = doc.arrayValue { return list.map { (tz: "Asia/Shanghai", c: $0) } }
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
        var seen = Set<String>(), states = 0
        for name in ["views-pages", "images-selection"] {
            for (tzName, c) in try Self.fixtureCases(name) {
                guard let state = c["args"]?["state"], Self.sane(state), let tz = TimeZone(identifier: tzName) else { continue }
                let dates = Dates(timeZone: tz)
                var today = "2026-10-21"
                if let t = c["args"]?["today"]?.stringValue, dates.isValidDay(.string(t)) { today = t }
                guard states < 80, seen.insert(tzName + "\u{0}" + JSONWriter.stringify(state) + "\u{0}" + today).inserted else { continue }
                states += 1
                let label = "\(name)#\(states) \(tzName)"
                compareAnnual(state, today: today, dates: dates, label: label)
                try compareMonths(state, today: today, dates: dates, label: label, allDays: true)
            }
        }
        XCTAssertGreaterThan(states, 3, "fixtures must contribute states")
        print("ANNUALEQ fixtures states=\(states) compared=\(compared)")
    }

    // MARK: 随机多月历史

    func testRandomHistoriesMatchReference() throws {
        var rng = VS.RNG(s: 77_2026_11)
        let zones = [Dates(timeZone: TimeZone(identifier: "Asia/Shanghai")!), Dates(timeZone: TimeZone(identifier: "America/New_York")!)]
        let rounds = Self.benchOn ? 120 : 20
        for round in 0..<rounds {
            let dates = zones[round % 2]
            let (state, todays) = try VS.randomState(&rng, round: round, dates: dates)
            let label = "random#\(round) tz=\(dates.timeZone.identifier)"
            // todays：[最后一月某天, 最后一月末天, 下个月（当月没有记录）, 第二年年初（跨年）, 最早的月初（记录在 today 之后）]
            for (ti, today) in todays.enumerated() where ti == 0 || ti == 3 || (Self.benchOn && ti != 1) {
                compareAnnual(state, today: today, dates: dates, label: label, plans: ti == 0)
            }
            try compareMonths(state, today: todays[0], dates: dates, label: label, allDays: round % 4 == 0)
            if round % 5 == 0 { try compareMonths(state, today: todays[3], dates: dates, label: label + " nextYear", allDays: false, plans: false) }
        }
        print("ANNUALEQ random rounds=\(rounds) compared=\(compared)")
    }

    // MARK: 数据量档（经 Store + PageAPI）

    private func makeStore(_ shape: B.Shape, seedFactor: Double, factor: Double) throws -> Store {
        JSMath.flavor = .v8
        let clock = B.Clock(B.benchNow), disk = FakeNativeDisk()
        func store(_ f: Double) -> Store { Store(storage: StoreStorage(disk.open(), now: { clock.t }), now: { clock.t }, budgets: ScaleBenchmarkTests.budgets(f), dates: shanghai) }
        let seeding = store(seedFactor)
        XCTAssertEqual(seeding.load()["available"], .bool(true))
        let r = seeding.seed(.object(try VS.mixedHeavyState(shape)), label: "annualeq-seed")
        XCTAssertEqual(r["ok"], .bool(true), String(JSONWriter.stringify(r).prefix(400)))
        if seedFactor != factor {
            let folding = store(factor)
            XCTAssertEqual(folding.load()["available"], .bool(true))
            clock.t += 1000
            let c = folding.commit("annualeq:fold-trigger") { d, c in
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
    private func compareStore(_ store: Store, label: String, allDays: Bool) throws {
        let state = JSValue.object(store.state), dates = store.dates
        let today = try dates.localDay(.number(store.now()))
        for a in [JSObject([("width", .number(402))]), JSObject([("width", .number(375)), ("ax", .number(1)), ("today", .string("2027-01-03"))])] {
            let got = PageAPI.call("view.mine", store: store, args: a)
            XCTAssertEqual(got["ok"], .bool(true), label + " mine: " + String(JSONWriter.stringify(got).prefix(300)))
            same("\(label) api view.mine \(JSONWriter.stringify(.object(a)))", { got }, { try AnnualRef.mineReply(store, a) })
        }
        var annualArgs: [JSObject] = [JSObject(), JSObject([("year", .number(1999))]), JSObject([("year", .number(2025.5))]), JSObject([("year", .string("2025"))])]
        for y in AnnualRef.annualYears(state, dates: dates) { annualArgs.append(JSObject([("year", .number(Double(y)))])) }
        for a in annualArgs {
            let got = PageAPI.call("view.annual", store: store, args: a)
            XCTAssertEqual(got["ok"], .bool(true), label + " annual: " + String(JSONWriter.stringify(got).prefix(300)))
            // view.annual 发墨迹平铺的那份（annualView(inkWire: true)）；参照是改动前的写法（每点一个 InkPoint.js）：
            // 墨迹格按 AnnualInkPayloadTests.sameInk（平铺展开 = 旧形状去掉 t / p，或整格就是旧形状），其余逐值相同。
            // 不平铺的那份（inkWire: false，view.annual-page）上面 compareAnnual 里与参照逐字节比。
            sameWire("\(label) api view.annual \(JSONWriter.stringify(.object(a)))", got, { try AnnualRef.mineSubReply("view.annual", store, a) })
        }
        let index = V.recordIndex(state, dates: dates)
        let months = try Self.monthsToCheck(state, today: today, dates: dates)
        var monthArgs: [JSObject] = [JSObject(), JSObject([("month", .string("2026-1"))])]
        for m in months { monthArgs.append(JSObject([("month", .string(m))])) }
        for a in monthArgs {
            let got = PageAPI.call("view.month", store: store, args: a)
            same("\(label) api view.month \(JSONWriter.stringify(.object(a)))", { got }, { try AnnualRef.mineSubReply("view.month", store, a) })
        }
        for m in months {
            let days = index.days.items.filter { $0.hasPrefix(m + "-") }.sorted()
            let chosen: [String] = allDays ? days : [days.first, days.last].compactMap { $0 }
            var picks: [String?] = [nil]
            for d in chosen { picks.append(d) }
            for day in picks {
                var a = JSObject([("month", .string(m))]); if let day { a["day"] = .string(day) }
                let got = PageAPI.call("view.records", store: store, args: a)
                same("\(label) api view.records \(m) \(day ?? "-")", { got }, { try AnnualRef.mineSubReply("view.records", store, a) })
            }
        }
        print("ANNUALEQ \(label) months=\(months.count) compared=\(compared)")
    }

    /// 小号的混合历史：2025-03…2026-10（跨年），每月 40 条、300 个字、最近 30 条带墨迹；先放大预算播种，再用原生预算真折叠 400 天前的月份。
    func testSmallFoldedStoreMatchesReference() throws {
        let shape = B.Shape(months: ScaleBenchmarkTests.monthsEndingOct2026(20), recordsPerMonth: 40, studied: ScaleBenchmarkTests.studied(300), inkRecords: 30)
        let store = try makeStore(shape, seedFactor: 3, factor: 1)
        let folded = store.state["records"]?.objectValue?.entries.filter { $0.value["folded"] == .bool(true) }.count ?? 0
        XCTAssertGreaterThan(folded, 0, "native budgets must fold the aged months")
        try compareStore(store, label: "small-folded", allDays: false)
        let state = JSValue.object(store.state)
        compareAnnual(state, today: "2026-10-21", dates: store.dates, label: "small-folded direct", plans: true)
    }

    func testScale1xMatchesReference() throws {
        try XCTSkipUnless(Self.benchOn, "1x annual equivalence runs only with SHIZI_SCALE_BENCH=1")
        let store = try makeStore(B.shape1x, seedFactor: 1, factor: 1)
        try compareStore(store, label: "1x", allDays: false)
    }

    func testScale3xFoldedMatchesReference() throws {
        try XCTSkipUnless(Self.benchOn, "3x-folded annual equivalence runs only with SHIZI_SCALE_BENCH=1")
        let store = try makeStore(ScaleBenchmarkTests.shape3x(), seedFactor: 3, factor: 1)
        let folded = store.state["records"]?.objectValue?.entries.filter { $0.value["folded"] == .bool(true) }.count ?? 0
        XCTAssertGreaterThan(folded, 0, "3x-folded must have folded months")
        try compareStore(store, label: "3x-folded", allDays: false)
    }
}

// MARK: - 参照：改动前的写法（照抄；同文件的调用补上类型前缀、改调参照里的同名函数，其余照旧调产品代码里没改的函数）

enum AnnualRef {
    typealias V = ViewSupport
    typealias S = ImageSelection

    // ---- Views/Annual.swift ----

    static func yearSlice(_ state: JSValue, year: Int, dates: Dates) -> AnnualView.Slice {
        let index = V.recordIndex(state, dates: dates), prefix = String(year) + "-"
        let judged = index.judged.filter { WorkMembers.isWorkMember($0) && JS.string($0["localDay"]).hasPrefix(prefix) && dates.isValidDay($0["localDay"] ?? .null) }
        let works = index.works.filter { JS.string($0["localDay"]).hasPrefix(prefix) && dates.isValidDay($0["localDay"] ?? .null) }
        var folded = JSObject(), days = KeySet(works.map { JS.string($0["localDay"]) })
        for (month, f) in index.folded.entries where month.hasPrefix(prefix) {
            var fold = f.objectValue!; let raw = state["records"]?[month] ?? .null
            fold["byDay"] = .object(Records.foldWorkByDay(raw)); fold["judgedByDay"] = .object(Records.foldWorkByDay(raw, judgedOnly: true)); folded[month] = .object(fold)
        }
        var events: [(String, String, Int)] = []
        for (_, f) in folded.entries {
            let byDay = f["byDay"]?.objectValue ?? JSObject()
            for day in byDay.keys.sorted() { days.insert(day); for c in byDay[day]?.arrayValue ?? [] { events.append((day, JS.string(c), events.count)) } }
        }
        for r in works { events.append((JS.string(r["localDay"]), JS.string(r["char"]), events.count)) }
        events.sort { $0.0 == $1.0 ? $0.2 < $1.2 : $0.0 < $1.0 }
        var firstSeen = JSObject()
        for (day, char, _) in events where firstSeen[char] == nil { firstSeen[char] = .string(day) }
        return AnnualView.Slice(year: year, judged: judged, works: works, days: days.items.sorted(), chars: firstSeen.keys, folded: folded, firstSeen: firstSeen, state: state)
    }
    static func annualYears(_ state: JSValue, dates: Dates) -> [Int] {
        let index = V.recordIndex(state, dates: dates)
        var years = Set<Int>()
        for r in index.judged + index.works { if let y = AnnualView.yearOfDay(JS.string(r["localDay"]), dates: dates) { years.insert(y) } }
        for m in index.folded.keys { if let y = Int(m.prefix(4)) { years.insert(y) } }
        return years.filter { let s = yearSlice(state, year: $0, dates: dates); return !s.days.isEmpty || !s.chars.isEmpty }.sorted()
    }
    static func annualDefaultYear(_ state: JSValue, today: String, dates: Dates) -> JSValue {
        guard let cur = AnnualView.yearOfDay(today, dates: dates) else { return annualYears(state, dates: dates).first.map { .number(Double($0)) } ?? .null }
        let years = annualYears(state, dates: dates)
        return .number(Double(years.isEmpty || years.contains(cur) ? cur : years.filter { $0 <= cur }.last ?? years[0]))
    }
    static func yearMonths(_ state: JSValue, _ s: AnnualView.Slice, policy: JSValue, dates: Dates) throws -> [JSValue] {
        let months = Set(s.works.map { String(JS.string($0["localDay"]).prefix(7)) } + s.folded.keys)
        return try months.sorted().compactMap { m in
            let n = try monthMembers(state, month: m, pick: policy["monthSheetPick"]?.stringValue ?? "first", dates: dates)["members"]!.arrayValue!.count
            return n > 0 ? V.obj([("month", .string(m)), ("monthNum", .number(Double(Int(m.suffix(2))!))), ("n", .number(Double(n)))]) : nil
        }
    }
    static func annualModel(_ state: JSValue, today: String, year: JSValue? = nil, policy: JSValue = Config.policy, hasInk: InkPick.HasInk? = nil, dates: Dates) throws -> JSValue {
        let wanted = year?.numberValue.flatMap { $0.isFinite && $0.rounded(.towardZero) == $0 ? Int($0) : nil } ?? AnnualView.yearOfDay(today, dates: dates)
        let y = wanted ?? 0
        let years = annualYears(state, dates: dates), at = years.firstIndex(of: y), s = yearSlice(state, year: y, dates: dates), empty = s.days.isEmpty && s.chars.isEmpty
        return V.obj([("today", .string(today)), ("year", wanted.map { .number(Double($0)) } ?? .null), ("years", .array(years.map { .number(Double($0)) })), ("prevYear", at != nil && at! > 0 ? .number(Double(years[at!-1])) : .null), ("nextYear", at != nil && at! < years.count-1 ? .number(Double(years[at!+1])) : .null), ("empty", .bool(empty)), ("count", .number(Double(s.chars.count))), ("chars", .array(s.chars.map(JSValue.string))), ("days", .number(Double(s.days.count))), ("first", empty ? .null : AnnualView.firstOfYear(s, hasInk: hasInk, dates: dates)), ("months", .array(empty ? [] : try yearMonths(state, s, policy: policy, dates: dates))), ("twice", empty ? .null : try AnnualView.twiceOfYear(s, hasInk: hasInk, dates: dates))])
    }
    static func annualPlan(_ state: JSValue, today: String, year: JSValue?, policy: JSValue, dates: Dates) throws -> JSValue {
        let model = try annualModel(state, today: today, year: year, policy: policy, dates: dates)
        if JS.truthy(model["empty"]) || !JS.truthy(model["first"]) { return V.obj([("status", .string("empty")), ("model", model), ("cover", .null), ("months", .array([])), ("tail", .null), ("pages", .array([]))]) }
        func cell(_ c: JSValue, _ r: JSValue?) throws -> JSValue {
            let ink = try QueryView.inkPointsOf(V.obj([("latest", r ?? .null)]), state: state, dates: dates)
            return V.obj([("ch", c), ("ink", ink), ("mode", .string(JS.truthy(ink) ? "hand" : "under")), ("dot", .bool(false)), ("tag", .string("")), ("record", r ?? .null)])
        }
        var months: [JSValue] = [], pages = [V.obj([("type", .string("cover"))])]
        for m in model["months"]!.arrayValue! {
            let month = JS.string(m["month"])
            let plan = try imagePlan(state, scope: V.obj([("kind", .string("month")), ("month", .string(month))]), inkOf: { r in try QueryView.inkPointsOf(V.obj([("latest", r)]), state: state, dates: dates) }, maxChars: Int(JS.number(policy["imageMaxChars"])), monthPick: policy["monthSheetPick"]?.stringValue ?? "first", dates: dates)
            let cells = plan["cells"]?.arrayValue ?? []
            let parts = ImageLayout.paginate(cells, max: Int(JS.number(policy["imageMaxChars"]))).map(ImageLayout.withDayTags)
            months.append(V.obj([("month", .string(month)), ("monthNum", m["monthNum"]!), ("cells", .array(cells)), ("pages", .array(parts.map(JSValue.array)))]))
            for (i, p) in parts.enumerated() { pages.append(V.obj([("type", .string("month")), ("month", .string(month)), ("cells", .array(p)), ("part", .number(Double(i+1))), ("of", .number(Double(parts.count)))])) }
        }
        var tail: JSValue = .null
        if let t = model["twice"], JS.truthy(t) { tail = try V.obj([("first", cell(t["char"]!, t["first"]?["record"])), ("last", cell(t["char"]!, t["last"]?["record"])), ("firstDay", t["first"]!["day"]!), ("lastDay", t["last"]!["day"]!)]); pages.append(V.obj([("type", .string("tail"))])) }
        return try V.obj([("status", .string("ready")), ("model", model), ("first", cell(model["first"]!["char"]!, model["first"]?["record"])), ("months", .array(months)), ("tail", tail), ("pages", .array(pages))])
    }

    // ---- Views/Mine.swift（我的页「年报」链接的缺省年份）----

    static func mineAnnualDefaultYear(_ state: JSValue, today: String, index: V.RecordIndex) -> JSValue {
        let dates = index.dates
        var candidates = Set<Int>()
        for r in index.judged { if let y = AnnualView.yearOfDay(JS.string(r["localDay"]), dates: dates) { candidates.insert(y) } }
        for r in index.works { if let y = AnnualView.yearOfDay(JS.string(r["localDay"]), dates: dates) { candidates.insert(y) } }
        for m in index.folded.keys { if let y = Int(m.prefix(4)) { candidates.insert(y) } }
        var workYears = Set<String>()
        for r in index.works where dates.isValidDay(r["localDay"] ?? .null) { workYears.insert(String(JS.string(r["localDay"]).prefix(4))) }
        let foldedWithWork = index.folded.keys.filter { !Records.foldWorkByDay(state["records"]?[$0] ?? .null).isEmpty }
        let years = candidates.filter { y in
            let s = String(y)
            return workYears.contains(s) || foldedWithWork.contains { $0.hasPrefix(s + "-") }
        }.sorted()
        guard let cur = AnnualView.yearOfDay(today, dates: dates) else { return years.first.map { .number(Double($0)) } ?? .null }
        return .number(Double(years.isEmpty || years.contains(cur) ? cur : years.filter { $0 <= cur }.last ?? years[0]))
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
        if block { out["folded"] = .bool(state["records"]?[month]?["folded"] == .bool(true)); out["title"] = V.ref("R-P02.sheetTitle", V.obj([("month", .number(mn))])) }
        out["seal"] = try CoreResources.load("view-seal")
        if !block { out["lines"] = V.obj([("sub", ViewLineStarts.starts("month-sub", V.ref("X-MINE.sheetOrder")))]) }; return .object(out)
    }
    static func monthView(_ state: JSValue, month: String, policy: JSValue, dates: Dates) throws -> JSValue { try displayMonth(state, month: month, policy: policy, block: false, dates: dates) }
    static func monthSheetOf(_ state: JSValue, month: String, policy: JSValue, dates: Dates) throws -> JSValue { try displayMonth(state, month: month, policy: policy, block: true, dates: dates) }
    static func recordsView(_ state: JSValue, today: String, _ a: JSObject, dates: Dates) throws -> JSValue {
        let policy = V.policy(a["policy"]), m = try V.recordsModel(state, today: today, month: a["month"], day: a["day"], policy: policy, dates: dates)
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
    static func annualView(_ state: JSValue, today: String, year: JSValue?, policy: JSValue, dates: Dates) throws -> JSValue {
        let m = try annualModel(state, today: today, year: year, policy: policy, dates: dates)
        func points(_ r: JSValue?) throws -> JSValue { try DetailView.builtInk(state, record: r, dates: dates).map { V.obj([("points", $0)]) } ?? .null }
        func cell(_ ch: JSValue, _ r: JSValue?) throws -> JSValue { let p = try points(r); var c = try MineSubView.cellModel(ch, record: r, mode: .string(JS.truthy(p) ? "hand" : "under"), day: .string(""), tag: .string(""), dates: dates); c["ink"] = p; return .object(c) }
        var first: JSValue = .null
        if let f = m["first"], JS.truthy(f) {
            let p = try points(f["record"]), ch = f["char"]!, date = try MineSubView.dayTextRef(f["day"]!, dates: dates)
            first = V.obj([("char", ch), ("day", f["day"]!), ("recordId", f["record"]?["id"] ?? .string("")), ("ink", p), ("label", V.ref(JS.truthy(p) ? "X-ANNUAL.firstInk" : "X-ANNUAL.firstNoInk", V.obj([("char", ch)]))), ("date", JS.truthy(p) ? V.ref("R-M06.inkDate", V.obj([("date", date)])) : date)])
        }
        let months = try m["months"]!.arrayValue!.map { month -> JSValue in
            let r = try monthCells(state, month: JS.string(month["month"]), policy: policy, dates: dates), raw = r["cells"]?.arrayValue ?? [], n = JSValue.number(Double(raw.count)), mn = month["monthNum"]!
            return V.obj([("month", month["month"]!), ("monthNum", mn), ("n", n), ("name", V.ref("X-WORK.annualMonthName", V.obj([("month", mn)]))), ("count", V.ref("X-WORK.annualMonthCount", V.obj([("n", n)]))), ("aria", V.ref("X-WORK.annualMonthAria", V.obj([("month", mn), ("n", n)]))), ("cells", .array(try raw.map { try cell($0["ch"]!, $0["record"]) }))])
        }
        var twice: JSValue = .null
        if let t = m["twice"], JS.truthy(t) {
            func half(_ k: String, _ label: String) throws -> JSValue { let r = t[k]!; return try V.obj([("recordId", r["record"]!["id"]!), ("day", r["day"]!), ("ink", points(r["record"])), ("label", V.ref(label, V.obj([("char", t["char"]!)]))), ("date", MineSubView.dayTextRef(r["day"]!, dates: dates))]) }
            twice = try V.obj([("char", t["char"]!), ("title", V.ref("X-WORK.annualTwiceTitle")), ("first", half("first", "X-WORK.annualFirstCellAria")), ("last", half("last", "X-WORK.annualLastCellAria"))])
        }
        var out = JSObject()
        for k in ["today", "year", "years", "prevYear", "nextYear", "empty", "count", "days"] { out[k] = m[k] }
        out["coverYear"] = .string(try KuanView.annualYearText(JS.number(m["year"]))); out["coverLine"] = try KuanView.annualCoverLineRef(JS.number(m["count"])); out["first"] = first; out["months"] = .array(months); out["twice"] = twice
        for (k,key) in [("emptyTitle","R-M06.emptyTitle"),("emptyBody","R-M06.emptyBody"),("emptyGlyph","X-ANNUAL.emptyGlyph"),("adjust","X-WORK.adjustImage"),("adjustAria","X-WORK.adjustAria"),("save","R-M01.saveImage")] { out[k] = V.ref(key) }
        out["seal"] = try CoreResources.load("view-seal"); out["lines"] = V.obj([("head", ViewLineStarts.starts("annual-head", out["coverLine"]!)), ("firstDate", JS.truthy(first) ? ViewLineStarts.starts("annual-first-date", first["date"]!) : .null)]); return .object(out)
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
        let policy = V.policy(a["policy"]), index = V.recordIndex(state, dates: dates), m = try V.mineModel(state, today: today, policy: policy, hasInk: { DetailView.recordHasInk(state, record: $0, dates: dates) }, storagePressure: a["storagePressure"], dates: dates, index: index), view = SettingsView.settingsView(state["settings"]), year = mineAnnualDefaultYear(state, today: today, index: index)
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

    // ---- Session/API：MineAPI 的 view.mine 外壳（hooks 为 nil）与 MineSubAPI ----

    static func mineReply(_ store: Store, _ a: JSObject) throws -> JSValue {
        let width = a["width"]?.numberValue.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? 402
        let ax = SessionWrites.integer(a["ax"]) && JS.number(a["ax"]) > 0 ? min(5, JS.number(a["ax"])) : 0
        let candidate = a["today"]?.stringValue ?? "", today = candidate.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil ? candidate : try store.dates.localDay(.number(store.now()))
        var args = a; args["width"] = .number(width); args["ax"] = .number(ax); args["storagePressure"] = Budget.storagePressureOf(store.status["usage"]); args["build"] = JS.obj([("version", .string("")), ("build", .string(""))])
        let view = try mineView(.object(store.state), today: today, args, dates: store.dates)
        return JS.obj([("ok", .bool(true)), ("view", SessionWrites.patch(view, [("env", JS.obj([("width", .number(width)), ("ax", .number(ax))]))]))])
    }
    static func mineSubReply(_ op: String, _ store: Store, _ a: JSObject) throws -> JSValue {
        let today = try store.dates.localDay(.number(store.now())), state = JSValue.object(store.state)
        let view: JSValue
        if op == "view.records" {
            var args = JSObject(); for key in ["month", "day"] { if let v = a[key]?.stringValue, !v.isEmpty { args[key] = .string(v) } }
            view = try recordsView(state, today: today, args, dates: store.dates)
        } else if op == "view.month" {
            let candidate = a["month"]?.stringValue ?? "", month = candidate.range(of: #"^\d{4}-\d{2}$"#, options: .regularExpression) != nil ? candidate : String(today.prefix(7))
            view = try monthView(state, month: month, policy: Config.policy, dates: store.dates)
        } else {
            let year = SessionWrites.integer(a["year"]) ? a["year"] : annualDefaultYear(state, today: today, dates: store.dates)
            view = try annualView(state, today: today, year: year, policy: Config.policy, dates: store.dates)
        }; return JS.obj([("ok", .bool(true)), ("view", view)])
    }

    // ---- Images/ImageSelection.swift ----

    static func dayMembers(
        _ state: JSValue, day: String, hasInk: InkPick.HasInk? = nil, added: [String]? = nil,
        dates: Dates
    ) throws -> JSValue {
        guard dates.isValidDay(.string(day)) else { throw CoreError.badArgs("INVALID_DAY") }
        let has: InkPick.HasInk =
            hasInk ?? { InkPick.storedInkPresent(state, $0, timeZone: dates.timeZone) }
        let inDay = WorkMembers.workMemberRecords(
            S.flattenRecords(state["records"]), hasInk: has, added: .init(added)
        ).filter { S.str($0["localDay"]) == day }
        let pick: WorkMembers.PickInk = hasInk.map { .test($0) } ?? .none
        var members: [JSValue]
        if let fold = S.folded(state, String(day.prefix(7))) {
            members = (Records.foldWorkByDay(fold)[day]?.arrayValue ?? []).map { ch in
                let list = inDay.filter { S.char($0) == S.str(ch) }
                if let m = WorkMembers.workMembers(
                    list, prefer: .string("last"), hasInk: has, pickInk: pick, added: .init(added)
                ).first {
                    var o = m.js.objectValue!
                    o["firstDay"] = .string(day)
                    return .object(o)
                }
                return S.obj([
                    ("char", ch), ("cardKey", .string("base:" + S.str(ch))), ("record", .null),
                    ("firstDay", .string(day)), ("dot", .bool(false)),
                ])
            }
        } else {
            members = WorkMembers.workMembers(
                inDay, prefer: .string("last"), order: .string("first"), hasInk: has, pickInk: pick,
                added: .init(added)
            ).map(\.js)
        }
        return S.obj([("members", .array(members)), ("day", .string(day))])
    }
    static func monthMembers(
        _ state: JSValue, month: String, pick: String = "first", hasInk: InkPick.HasInk? = nil,
        added: [String]? = nil, dates: Dates
    ) throws -> JSValue {
        guard dates.isValidMonth(.string(month)) else { throw CoreError.badArgs("INVALID_MONTH") }
        let has: InkPick.HasInk =
            hasInk ?? { InkPick.storedInkPresent(state, $0, timeZone: dates.timeZone) }
        let prefix = month + "-", ids = WorkMembers.Added(added)
        let rows = (state["records"]?.objectValue?.keys ?? []).flatMap { key -> [JSValue] in
            let v = state["records"]?[key]
            return v?.arrayValue ?? v?["kept"]?.arrayValue ?? []
        }
        let records = Records.sortById(
            rows.filter {
                $0["id"]?.stringValue != nil && S.str($0["localDay"]).hasPrefix(prefix)
                    && WorkMembers.isWorkMember($0, hasInk: has, added: ids)
            })
        let picker: WorkMembers.PickInk = hasInk.map { .test($0) } ?? .none
        let prefer: JSValue = .string(pick == "first" ? "first" : "last")
        var days: [String] = []
        var members: [JSValue] = []
        if let fold = S.folded(state, month) {
            let byDay = Records.foldWorkByDay(fold)
            days = byDay.keys.filter { $0.hasPrefix(month + "-") }.sorted()
            var byChar: [String: [JSValue]] = [:]
            for r in records { byChar[S.char(r), default: []].append(r) }
            var seenStrings = Set<JSKey>()
            var seenOther: [JSValue] = []
            for d in days {
                for ch in byDay[d]?.arrayValue ?? [] {
                    if case .string(let s) = ch {
                        if !seenStrings.insert(JSKey(s: s)).inserted { continue }
                    } else {
                        if seenOther.contains(ch) { continue }
                        seenOther.append(ch)
                    }
                    let list = byChar[S.str(ch)] ?? []
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
            var seenDays = Set<String>()
            for r in records {
                let d = S.str(r["localDay"])
                if seenDays.insert(d).inserted { days.append(d) }
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
                try dayMembers(state, day: S.str(day), hasInk: has, dates: dates)["members"]?.arrayValue ?? []
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
