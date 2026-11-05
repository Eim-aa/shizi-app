import Foundation
import XCTest
@testable import ShiziCore

// 年报的墨迹按需取（view.annual 带 lazyInk + view.annual.ink）：
//   · 每个墨迹键（「月|id」= state.ink[月][id]）取回的 ink.points = view.annual 里那条记录那一格的 ink.points（AnnualInkWire.built），逐位相同；
//   · 入参校验：keys 不是字串数组 / 多于 AnnualInkWire.maxBatch 个 → invalid；认不得的键 → null；重复的键只回一次。
//   · 合起来：带 lazyInk 的回包（月段的格 ink = null、有墨迹的格带 inkKey）把每格的 ink 换成 {points: 按 inkKey 取回的}、去掉 inkKey
//     = 不带 lazyInk 的回包，JSON 文字逐字节相同（含键序）；抛错时两边抛同一个错。状态：views-pages / images-selection 夹具、
//     随机多月历史（ViewScaleEquivalenceTests.randomState，同 AnnualScaleEquivalenceTests）、小号的混合 heavyState（经 Store + PageAPI，真折叠过），
//     1x 与 3x-folded 只在 SHIZI_SCALE_BENCH=1 时跑。
//   · 量测（BENCH annual-lazy）：view.annual 整份 vs 带 lazyInk，外加打开时取一屏多的墨迹、全部墨迹分批取完的耗时；1x 常跑，3x / 10x 只在 SHIZI_SCALE_BENCH=1。
final class AnnualLazyInkTests: XCTestCase {
    typealias P = LibraryInkPayloadTests
    typealias B = StoreCommitBenchmarkTests
    typealias VS = ViewScaleEquivalenceTests

    fileprivate static var benchOn: Bool { ProcessInfo.processInfo.environment["SHIZI_SCALE_BENCH"] == "1" }
    fileprivate var compared = 0

    static func store(_ state: JSObject) -> Store {
        let env = freshStore(.native, budgets: Budgets.native.js)
        let r = env.store.seed(.object(state), label: "lazy-ink-seed")
        XCTAssertEqual(r["ok"], .bool(true), str(r))
        return env.store
    }

    static func keysArg(_ keys: [String]) -> JSObject { JSObject([("keys", .array(keys.map(JSValue.string)))]) }

    static func fetch(_ store: Store, _ keys: [String]) -> JSValue { PageAPI.call("view.annual.ink", store: store, args: keysArg(keys)) }

    // MARK: 入参

    func testInkOpValidatesItsInput() throws {
        let store = Self.store(try AnnualInkBenchTests.annualState(12))
        func kind(_ r: JSValue) -> String? { r["error"]?["kind"]?.stringValue }
        XCTAssertEqual(kind(PageAPI.call("view.annual.ink", store: store, args: JSObject())), "invalid", "no keys")
        XCTAssertEqual(kind(PageAPI.call("view.annual.ink", store: store, args: JSObject([("keys", .string("2026-01|r1"))]))), "invalid", "keys is not an array")
        XCTAssertEqual(kind(PageAPI.call("view.annual.ink", store: store, args: JSObject([("keys", .array([.string("2026-01|r1"), .number(3)]))]))), "invalid", "a key is not a string")
        XCTAssertEqual(kind(PageAPI.call("view.annual.ink", store: store, args: JSObject([("keys", .array([.null]))]))), "invalid", "a null key")
        let tooMany = (0...AnnualInkWire.maxBatch).map { "2026-01|r\($0)" }
        XCTAssertEqual(kind(Self.fetch(store, tooMany)), "invalid", "more than maxBatch keys")
        let atLimit = Self.fetch(store, Array(tooMany.dropLast()))
        XCTAssertEqual(atLimit["ok"], .bool(true), "exactly maxBatch keys: \(str(atLimit["error"] ?? .null))")
        XCTAssertEqual(atLimit["ink"]?.objectValue?.count, AnnualInkWire.maxBatch)
        let empty = Self.fetch(store, [])
        XCTAssertEqual(empty["ok"], .bool(true))
        XCTAssertEqual(empty["ink"], .object(JSObject()))
        // 认不得的键 → null（不是错）；重复的只回一次
        let unknown = ["", "|", "2026-01|", "|r1", "2026-01", "2026-01|r999999", "2031-01|r1", "2026-01|r1|x", "NaN-NaN|r1", "__proto__", "0"]
        let r = Self.fetch(store, unknown + ["2026-01|r1", "2026-01|r1"])
        XCTAssertEqual(r["ok"], .bool(true), str(r))
        let ink = try XCTUnwrap(r["ink"]?.objectValue)
        XCTAssertEqual(ink.count, unknown.count + 1, "duplicates collapse: \(ink.keys)")
        for k in unknown { XCTAssertEqual(ink[k], .null, "unknown key \(k) → null") }
        XCTAssertNotEqual(ink["2026-01|r1"], .null, "a real key has ink")
        XCTAssertNotNil(ink["2026-01|r1"]?.arrayValue)
    }

    /// 墨迹键的拆法：月里、id 里都没有「|」；拆回去 = Schema.inkMonthOf / inkIdOf。
    func testKeyRoundTrips() throws {
        let tz = shanghaiTZ
        let recs: [JSValue] = [
            srec(5, "永", day: "2026-03-04"),
            srec(6, "永", day: "2026-03-04", extra: [("inkId", .string("r2"))]),
            .object(JSObject([("id", .string("r7")), ("at", .number(T0))])),
        ]
        for r in recs {
            let key = try XCTUnwrap(AnnualInkWire.key(r, timeZone: tz), str(r))
            let month = try XCTUnwrap(Schema.inkMonthOf(r, timeZone: tz)), id = try XCTUnwrap(Schema.inkIdOf(r))
            XCTAssertEqual(key, month + "|" + id)
            XCTAssertFalse(month.contains("|"))
            XCTAssertFalse(id.contains("|"))
        }
        XCTAssertNil(AnnualInkWire.key(.object(JSObject([("id", .string("x"))])), timeZone: tz), "no valid id")
        XCTAssertNil(AnnualInkWire.key(.object(JSObject([("id", .string("r1"))])), timeZone: tz), "no day, no time")
        XCTAssertNil(AnnualInkWire.key(.string("r1"), timeZone: tz), "not an object")
        XCTAssertNil(AnnualInkWire.key(nil, timeZone: tz))
    }

    // MARK: 取回的 = 整份回包里的

    /// 每条记录：view.annual.ink 取它的键 = AnnualInkWire.built(state, record:)（view.annual 每格墨迹就是它）；
    /// 整份 view.annual 里每个有墨迹的格的 ink.points = 按那一格的记录的键取回的（干净的数据：一个 id 一条记录）。
    func testFetchedInkIsTheFullReplysInk() throws {
        var state = try AnnualInkBenchTests.annualState(90)
        guard case .object(var jan)? = state["ink"]?["2026-01"] else { return XCTFail("no January ink table") }
        jan["r2"] = P.overflowingV2Ink()
        jan["r3"] = inkEntry(12, 4)
        jan["r4"] = inkEntryV2(10, 2)
        jan["r5"] = nil
        var inkTable = state["ink"]?.objectValue ?? JSObject()
        inkTable["2026-01"] = .object(jan)
        state["ink"] = .object(inkTable)
        let store = Self.store(state)
        let st = JSValue.object(store.state), tz = store.dates.timeZone
        let records = Query.flattenRecords(st["records"])
        var byId: [String: JSValue] = [:]
        for r in records { byId[JS.string(r["id"])] = r }
        let keys = records.compactMap { AnnualInkWire.key($0, timeZone: tz) }
        XCTAssertEqual(keys.count, records.count)
        var fetched = JSObject()
        for start in stride(from: 0, to: keys.count, by: AnnualInkWire.maxBatch) {
            let r = Self.fetch(store, Array(keys[start..<min(keys.count, start + AnnualInkWire.maxBatch)]))
            XCTAssertEqual(r["ok"], .bool(true), str(r))
            for (k, v) in r["ink"]?.objectValue?.entries ?? [] { fetched[k] = v }
        }
        for r in records {
            let key = try XCTUnwrap(AnnualInkWire.key(r, timeZone: tz))
            let want = try AnnualInkWire.built(st, record: r, dates: store.dates) ?? .null
            XCTAssertTrue(P.same(fetched[key] ?? .null, want), "\(key): fetched = built(record)")
        }
        XCTAssertEqual(fetched["2026-01|r5"], .null, "a record without ink → null")
        let full = PageAPI.call("view.annual", store: store, args: JSObject([("year", .number(2026))]))
        XCTAssertEqual(full["ok"], .bool(true))
        var inked = 0
        for m in full["view"]?["months"]?.arrayValue ?? [] {
            for c in m["cells"]?.arrayValue ?? [] {
                let r = byId[JS.string(c["recordId"])]
                let key = AnnualInkWire.key(r, timeZone: tz)
                if let box = c["ink"], JS.truthy(box) {
                    inked += 1
                    XCTAssertTrue(P.same(box["points"] ?? .null, key.flatMap { fetched[$0] } ?? .missing), "cell \(JS.string(c["recordId"]))")
                } else {
                    XCTAssertEqual(key.flatMap { fetched[$0] } ?? .null, .null, "a glyph cell fetches nothing")
                }
            }
        }
        XCTAssertGreaterThan(inked, 80)
    }
}

// MARK: - 带 lazyInk 的回包 + 取回的墨迹 = 整份回包

extension AnnualLazyInkTests {
    /// 带 lazyInk 的 view 里月段格的墨迹键（按格的顺序，含重复）。
    static func inkKeys(_ view: JSValue) -> [String] {
        var out: [String] = []
        for m in view["months"]?.arrayValue ?? [] {
            for c in m["cells"]?.arrayValue ?? [] {
                if let k = c["inkKey"]?.stringValue { out.append(k) }
            }
        }
        return out
    }

    /// 把带 lazyInk 的 view 合成整份：每个带 inkKey 的格 ink = {points: 取回的}（null → null）、去掉 inkKey；别的原样。
    static func merge(_ lite: JSValue, _ fetched: JSObject) -> JSValue {
        guard var root = lite.objectValue, let months = root["months"]?.arrayValue else { return lite }
        root["months"] = .array(months.map { (m: JSValue) -> JSValue in
            guard var mo = m.objectValue, let cells = mo["cells"]?.arrayValue else { return m }
            mo["cells"] = .array(cells.map { (c: JSValue) -> JSValue in
                guard var o = c.objectValue, let key = o["inkKey"]?.stringValue else { return c }
                let pts: JSValue = fetched[key] ?? .missing
                o["ink"] = pts == .null ? .null : .object(JSObject([("points", pts)]))
                o["inkKey"] = nil
                return .object(o)
            })
            return .object(mo)
        })
        return .object(root)
    }

    /// 墨迹键分批（每批 ≤ maxBatch）交给 fetch，合成一个 {键: ink.points | null}；有一批失败 → nil。
    static func fetchAll(_ keys: [String], _ fetch: ([String]) -> JSValue) -> JSObject? {
        var out = JSObject()
        var start = 0
        while start < keys.count {
            let r = fetch(Array(keys[start..<min(keys.count, start + AnnualInkWire.maxBatch)]))
            guard r["ok"] == .bool(true), let ink = r["ink"]?.objectValue else { return nil }
            for (k, v) in ink.entries { out[k] = v }
            start += AnnualInkWire.maxBatch
        }
        return out
    }

    fileprivate static func firstDiff(_ a: String, _ b: String) -> String {
        let x = Array(a.utf8), y = Array(b.utf8)
        var i = 0
        while i < x.count, i < y.count, x[i] == y[i] { i += 1 }
        let lo = max(0, i - 120)
        func slice(_ u: [UInt8]) -> String { String(decoding: u[min(lo, u.count)..<min(u.count, i + 200)], as: UTF8.self) }
        return "at byte \(i) (merged \(x.count) / full \(y.count))\n  merged: …\(slice(x))\n  full: …\(slice(y))"
    }

    /// 一份带 lazyInk 的 view 与整份 view：形状（月段的格不带墨迹、有墨迹的格带键，首字 / 卷尾照旧）+ 合起来逐字节相同。
    fileprivate func checkPair(_ label: String, lite: Result<JSValue, Error>, full: Result<JSValue, Error>, fetch: ([String]) -> JSValue, file: StaticString = #filePath, line: UInt = #line) {
        compared += 1
        switch (lite, full) {
        case (.success(let l), .success(let f)):
            let keys = Self.inkKeys(l)
            for m in l["months"]?.arrayValue ?? [] {
                for c in m["cells"]?.arrayValue ?? [] where c["inkKey"] != nil {
                    XCTAssertEqual(c["ink"], .null, "\(label): a lazy cell carries no ink", file: file, line: line)
                    XCTAssertEqual(c["mode"], .string("hand"), "\(label): only cells with ink get a key", file: file, line: line)
                }
            }
            XCTAssertEqual(str(l["first"] ?? .null), str(f["first"] ?? .null), "\(label): the first char keeps its ink", file: file, line: line)
            XCTAssertEqual(str(l["twice"] ?? .null), str(f["twice"] ?? .null), "\(label): both twice halves keep their ink", file: file, line: line)
            guard let fetched = Self.fetchAll(keys, fetch) else { return XCTFail("\(label): view.annual.ink failed", file: file, line: line) }
            for k in keys { XCTAssertNotEqual(fetched[k] ?? .null, .null, "\(label): \(k) has ink (the cell is hand)", file: file, line: line) }
            let merged = str(Self.merge(l, fetched)), want = str(f)
            if merged != want { XCTFail("\(label): merged lazy reply differs " + Self.firstDiff(merged, want), file: file, line: line) }
        case (.failure(let e1), .failure(let e2)):
            XCTAssertEqual(String(describing: e1), String(describing: e2), "\(label) (both throw)", file: file, line: line)
        case (.success, .failure(let e)):
            XCTFail("\(label): lazy succeeds, full throws \(e)", file: file, line: line)
        case (.failure(let e), .success):
            XCTFail("\(label): lazy throws \(e), full succeeds", file: file, line: line)
        }
    }

    /// 纯视图（不经 Store）：每个年份参数各比一次。取墨迹走 view.annual.ink 的同一个函数（PageAPI.annualInk）。
    fileprivate func compareState(_ state: JSValue, today: String, dates: Dates, label: String) {
        let years = AnnualView.annualYears(state, dates: dates)
        var args: [JSValue?] = [nil]
        for y in years { args.append(.number(Double(y))) }
        if let f = years.first { args.append(.number(Double(f - 1))) }
        args.append(.number(2025.5))
        let policy = Config.policy
        for year in args {
            let yl = year.map { str($0) } ?? "-"
            let lite = Result<JSValue, Error> { try MineSubView.annualView(state, today: today, year: year, policy: policy, inkWire: true, lazyInk: true, dates: dates) }
            let full = Result<JSValue, Error> { try MineSubView.annualView(state, today: today, year: year, policy: policy, inkWire: true, dates: dates) }
            checkPair("\(label) today=\(today) year=\(yl)", lite: lite, full: full, fetch: { (keys: [String]) -> JSValue in PageAPI.annualInk(state, Self.keysArg(keys)) })
            // lazyInk 只与 inkWire 一起有效：不平铺的那份（view.annual-page）不受它影响
            let legacyLazy = Result<JSValue, Error> { try MineSubView.annualView(state, today: today, year: year, policy: policy, inkWire: false, lazyInk: true, dates: dates) }
            let legacy = Result<JSValue, Error> { try MineSubView.annualView(state, today: today, year: year, policy: policy, dates: dates) }
            if case .success(let a) = legacyLazy, case .success(let b) = legacy { XCTAssertEqual(str(a), str(b), "\(label) year=\(yl): lazyInk without inkWire changes nothing") }
        }
    }

    /// 经 Store + PageAPI：view.annual 带 / 不带 lazyInk（各个年份参数），墨迹经 PageAPI.call("view.annual.ink") 分批取。
    fileprivate func compareStore(_ store: Store, label: String) {
        let state = JSValue.object(store.state)
        var annualArgs: [JSObject] = [JSObject(), JSObject([("year", .number(1999))]), JSObject([("year", .string("2025"))])]
        for y in AnnualView.annualYears(state, dates: store.dates) { annualArgs.append(JSObject([("year", .number(Double(y)))])) }
        for a in annualArgs {
            var la = a
            la["lazyInk"] = .bool(true)
            let full = PageAPI.call("view.annual", store: store, args: a)
            let lite = PageAPI.call("view.annual", store: store, args: la)
            XCTAssertEqual(full["ok"], .bool(true), "\(label): " + String(str(full).prefix(300)))
            XCTAssertEqual(lite["ok"], .bool(true), "\(label): " + String(str(lite).prefix(300)))
            checkPair("\(label) api \(str(.object(a)))", lite: .success(lite["view"] ?? .null), full: .success(full["view"] ?? .null), fetch: { (keys: [String]) -> JSValue in Self.fetch(store, keys) })
            // lazyInk 只认 true
            var other = a
            other["lazyInk"] = .string("true")
            XCTAssertEqual(str(PageAPI.call("view.annual", store: store, args: other)), str(full), "\(label): lazyInk must be exactly true")
        }
        print("ANNUAL-LAZY \(label) compared=\(compared)")
    }

    fileprivate static func fixtureCases(_ name: String) throws -> [(tz: String, c: JSValue)] {
        guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures") else { throw XCTSkip("missing fixture " + name) }
        let doc = try JSONParser.parse(try String(contentsOf: url, encoding: .utf8))
        if let list = doc.arrayValue { return list.map { (tz: "Asia/Shanghai", c: $0) } }
        var out: [(tz: String, c: JSValue)] = []
        for g in doc["groups"]?.arrayValue ?? [] {
            for c in g["cases"]?.arrayValue ?? [] { out.append((tz: g["tz"]?.stringValue ?? "Asia/Shanghai", c: c)) }
        }
        return out
    }

    /// 同 AnnualScaleEquivalenceTests.sane：视图里有几处按「记录都有 char / cardKey / kind」强制解包，专测别的函数的怪状态不拿来跑整页。
    fileprivate static func sane(_ state: JSValue) -> Bool {
        guard state.objectValue != nil, let recs = state["records"]?.objectValue, !recs.isEmpty else { return false }
        for (k, v) in recs.entries {
            guard v.arrayValue != nil || v.objectValue != nil, k.utf8.count == 7 else { return false }
        }
        return Query.flattenRecords(state["records"]).allSatisfy { r in
            r.objectValue != nil && r["char"]?.stringValue != nil && r["cardKey"]?.stringValue != nil && r["kind"]?.stringValue != nil && r["localDay"]?.stringValue != nil
        }
    }

    func testLazyReplyPlusFetchedInkIsTheFullReplyOnFixtures() throws {
        var seen = Set<String>(), states = 0
        for name in ["views-pages", "images-selection"] {
            for (tzName, c) in try Self.fixtureCases(name) {
                guard let state = c["args"]?["state"], Self.sane(state), let tz = TimeZone(identifier: tzName) else { continue }
                let dates = Dates(timeZone: tz)
                var today = "2026-10-21"
                if let t = c["args"]?["today"]?.stringValue, dates.isValidDay(.string(t)) { today = t }
                guard states < 80, seen.insert(tzName + "\u{0}" + str(state) + "\u{0}" + today).inserted else { continue }
                states += 1
                compareState(state, today: today, dates: dates, label: "\(name)#\(states) \(tzName)")
            }
        }
        XCTAssertGreaterThan(states, 3, "fixtures must contribute states")
        print("ANNUAL-LAZY fixtures states=\(states) compared=\(compared)")
    }

    func testLazyReplyPlusFetchedInkIsTheFullReplyOnRandomHistories() throws {
        var rng = VS.RNG(s: 77_2026_11)
        let zones = [Dates(timeZone: TimeZone(identifier: "Asia/Shanghai")!), Dates(timeZone: TimeZone(identifier: "America/New_York")!)]
        let rounds = Self.benchOn ? 120 : 30
        for round in 0..<rounds {
            let dates = zones[round % 2]
            let (state, todays) = try VS.randomState(&rng, round: round, dates: dates)
            for (ti, today) in todays.enumerated() where ti == 0 || ti == 3 || (Self.benchOn && ti != 1) {
                compareState(state, today: today, dates: dates, label: "random#\(round) tz=\(dates.timeZone.identifier) t\(ti)")
            }
        }
        print("ANNUAL-LAZY random rounds=\(rounds) compared=\(compared)")
    }

    /// 一年 90 条墨迹 + 坏的 / 旧版 / 溢出的 / 没有的（同 testFetchedInkIsTheFullReplysInk）：经 Store + PageAPI。
    func testLazyReplyPlusFetchedInkIsTheFullReplyOverAPopulatedYear() throws {
        var state = try AnnualInkBenchTests.annualState(90)
        guard case .object(var jan)? = state["ink"]?["2026-01"] else { return XCTFail("no January ink table") }
        jan["r2"] = P.overflowingV2Ink()
        jan["r3"] = inkEntry(12, 4)
        jan["r4"] = inkEntryV2(10, 2)
        jan["r5"] = nil
        var inkTable = state["ink"]?.objectValue ?? JSObject()
        inkTable["2026-01"] = .object(jan)
        state["ink"] = .object(inkTable)
        let store = Self.store(state)
        compareStore(store, label: "populated")
        let lite = PageAPI.call("view.annual", store: store, args: JSObject([("year", .number(2026)), ("lazyInk", .bool(true))]))
        let keys = Self.inkKeys(lite["view"] ?? .null)
        XCTAssertGreaterThan(keys.count, 80)
        XCTAssertFalse(keys.contains("2026-01|r5"), "the record without ink gets no key")
    }

    fileprivate func makeStore(_ shape: B.Shape, seedFactor: Double, factor: Double) throws -> Store {
        JSMath.flavor = .v8
        let clock = B.Clock(B.benchNow), disk = FakeNativeDisk()
        func store(_ f: Double) -> Store { Store(storage: StoreStorage(disk.open(), now: { clock.t }), now: { clock.t }, budgets: ScaleBenchmarkTests.budgets(f), dates: shanghai) }
        let seeding = store(seedFactor)
        XCTAssertEqual(seeding.load()["available"], .bool(true))
        let r = seeding.seed(.object(try VS.mixedHeavyState(shape)), label: "annual-lazy-seed")
        XCTAssertEqual(r["ok"], .bool(true), String(str(r).prefix(400)))
        if seedFactor != factor {
            let folding = store(factor)
            XCTAssertEqual(folding.load()["available"], .bool(true))
            clock.t += 1000
            let c = folding.commit("annual-lazy:fold-trigger") { d, c in
                var sessions = d["sessions"]!.objectValue!
                var A = sessions["A"]!.objectValue!
                A["updatedAt"] = .number(c.now)
                sessions["A"] = .object(A)
                d["sessions"] = .object(sessions)
            }
            XCTAssertEqual(c["ok"], .bool(true), String(str(c).prefix(400)))
        }
        let s = store(factor)
        XCTAssertEqual(s.load()["available"], .bool(true))
        return s
    }

    /// 小号的混合历史（同 AnnualScaleEquivalenceTests.testSmallFoldedStoreMatchesReference）：2025-03…2026-10，真折叠过。
    func testLazyReplyOnASmallFoldedStore() throws {
        let shape = B.Shape(months: ScaleBenchmarkTests.monthsEndingOct2026(20), recordsPerMonth: 40, studied: ScaleBenchmarkTests.studied(300), inkRecords: 30)
        let store = try makeStore(shape, seedFactor: 3, factor: 1)
        compareStore(store, label: "small-folded")
        compareState(.object(store.state), today: "2026-10-21", dates: store.dates, label: "small-folded direct")
    }

    func testLazyReplyAtScale1x() throws {
        try XCTSkipUnless(Self.benchOn, "1x lazy annual equivalence runs only with SHIZI_SCALE_BENCH=1")
        compareStore(try makeStore(B.shape1x, seedFactor: 1, factor: 1), label: "1x")
    }

    func testLazyReplyAtScale3xFolded() throws {
        try XCTSkipUnless(Self.benchOn, "3x-folded lazy annual equivalence runs only with SHIZI_SCALE_BENCH=1")
        compareStore(try makeStore(ScaleBenchmarkTests.shape3x(), seedFactor: 3, factor: 1), label: "3x-folded")
    }
}

// MARK: - 量测

/// BENCH annual-lazy scale=<1x|3x|10x> cells=<月段格数> keys=<带墨迹键的格> full=…ms lite=…ms open=…ms(<键数> keys, <批数> batches) all=…ms(<批数> batches)
///   fullBytes=… liteBytes=… openBytes=…
///   full = PageAPI.call("view.annual")（以前 App 走的那份：每格都带墨迹）；lite = 带 lazyInk（月段的格只带键）；
///   open = 打开时年报页取的那些：头 openKeys 个键（≈ 可见框 + 2.5 屏 overscan 里的格：393 × 852 的屏、45pt 的格约 400 格），按 maxBatch 分批；
///   all = 把全部键分批取完（一路滚到底才会这样）；Bytes = 回包 JSON 的 UTF-8 字节。lite + open ≈ 现在打开年报的引擎侧耗时（以前 = full）。
/// 每个量至多 3 次（不预热，同 ScaleBenchmarkTests.api：页面打开本来就是冷的一次；第一次超过 1 s 只量这一次），取中位数。
extension AnnualLazyInkTests {
    static let openKeys = 400

    fileprivate static func timed(_ body: () -> Void) -> Double {
        let t0 = DispatchTime.now().uptimeNanoseconds
        body()
        return Double(DispatchTime.now().uptimeNanoseconds - t0) / 1_000_000
    }

    fileprivate static func sampleUnlessSlow(_ body: () -> Void) -> Double {
        var out: [Double] = []
        for _ in 0..<3 {
            out.append(timed(body))
            if out.count == 1 && out[0] > 1000 { break }
        }
        return B.median(out.sorted())
    }

    fileprivate func bench(_ name: String, shape: B.Shape, factor: Double) throws {
        JSMath.flavor = .v8
        let clock = B.Clock(B.benchNow), disk = FakeNativeDisk()
        let seeding = Store(storage: StoreStorage(disk.open(), now: { clock.t }), now: { clock.t }, budgets: ScaleBenchmarkTests.budgets(factor), dates: shanghai)
        XCTAssertEqual(seeding.load()["available"], .bool(true))
        let seeded = seeding.seed(.object(try B.heavyState(shape)), label: "annual-lazy-bench")
        XCTAssertEqual(seeded["ok"], .bool(true), String(str(seeded).prefix(300)))
        let store = Store(storage: StoreStorage(disk.open(), now: { clock.t }), now: { clock.t }, budgets: ScaleBenchmarkTests.budgets(factor), dates: shanghai)
        XCTAssertEqual(store.load()["available"], .bool(true))
        var full: JSValue = .null
        var lite: JSValue = .null
        let tFull = Self.sampleUnlessSlow { full = PageAPI.call("view.annual", store: store) }
        let tLite = Self.sampleUnlessSlow { lite = PageAPI.call("view.annual", store: store, args: JSObject([("lazyInk", .bool(true))])) }
        XCTAssertEqual(full["ok"], .bool(true), String(str(full).prefix(300)))
        XCTAssertEqual(lite["ok"], .bool(true), String(str(lite).prefix(300)))
        let liteView = lite["view"] ?? .null
        let keys = Self.inkKeys(liteView)
        let openSet = Array(keys.prefix(Self.openKeys))
        var opened: JSObject?
        var all: JSObject?
        let tOpen = Self.sampleUnlessSlow { opened = Self.fetchAll(openSet, { (k: [String]) -> JSValue in Self.fetch(store, k) }) }
        let tAll = Self.sampleUnlessSlow { all = Self.fetchAll(keys, { (k: [String]) -> JSValue in Self.fetch(store, k) }) }
        XCTAssertNotNil(opened)
        let merged = all.map { (ink: JSObject) -> String in str(Self.merge(liteView, ink)) }
        XCTAssertEqual(merged, str(full["view"] ?? .null), "\(name): merged = full")
        let cells = (liteView["months"]?.arrayValue ?? []).reduce(0) { (n: Int, m: JSValue) -> Int in n + (m["cells"]?.arrayValue?.count ?? 0) }
        func batches(_ n: Int) -> Int { (n + AnnualInkWire.maxBatch - 1) / AnnualInkWire.maxBatch }
        let openBytes = str(.object(opened ?? JSObject())).utf8.count
        print("BENCH annual-lazy scale=\(name) cells=\(cells) keys=\(keys.count) full=\(B.fmt(tFull))ms lite=\(B.fmt(tLite))ms open=\(B.fmt(tOpen))ms(\(openSet.count) keys, \(batches(openSet.count)) batches) all=\(B.fmt(tAll))ms(\(batches(keys.count)) batches) fullBytes=\(str(full).utf8.count) liteBytes=\(str(lite).utf8.count) openBytes=\(openBytes)")
    }

    func testBenchLazyAnnual1x() throws {
        try bench("1x", shape: B.shape1x, factor: 1)
    }

    func testBenchLazyAnnual3xAnd10x() throws {
        try XCTSkipUnless(Self.benchOn, "3x / 10x lazy annual benches run only with SHIZI_SCALE_BENCH=1 (CI release-bench step)")
        try bench("3x", shape: ScaleBenchmarkTests.shape3x(), factor: 3)
        try bench("10x", shape: ScaleBenchmarkTests.shape10x(), factor: 10)
    }
}

private extension JSValue {
    /// 测试里「取不到」的占位（不会与任何 ink.points 相同）。
    static var missing: JSValue { .string("\u{0}missing") }
}
