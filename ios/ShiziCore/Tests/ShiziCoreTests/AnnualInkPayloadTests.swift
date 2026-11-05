import Foundation
import XCTest
@testable import ShiziCore

// 年报回包（view.annual）里的墨迹：AnnualInkWire 平铺的 ink.points 与改动前（DetailView.builtInk，每点一个 InkPoint.js）逐位相同。
//   · 每格的点都 faithful（数都有限、键序里有 x / y / w）：平铺展开（LibraryInkPayloadTests.expand）= 旧形状去掉 t / p 两个键（App 不读），
//     x / y / w 比位型、键与键序也相同。
//   · 不然（有一个数不是有限数等）：整格就是旧形状本身。
//   · 整份视图：annualView(inkWire: true) 与 annualView(inkWire: false) 除墨迹格以外逐值相同（每条墨迹只解一次的缓存不改任何结果），
//     view.annual 发的就是 inkWire: true 的那份。
// 本文件的用例只检查 JSValue，不走 JSONSerialization（坏数据复现了也不会让测试进程崩）。

final class AnnualInkPayloadTests: XCTestCase {
    typealias P = LibraryInkPayloadTests

    /// 旧形状去掉 t / p（每点 {x, y, w?}，键序照旧）。
    static func withoutTP(_ v: JSValue) -> JSValue {
        guard case .array(let strokes) = v else { return v }
        return .array(strokes.map { s -> JSValue in
            guard case .array(let pts) = s else { return s }
            return .array(pts.map { p -> JSValue in
                guard case .object(let o) = p else { return p }
                var out = JSObject()
                for k in o.keys where k != "t" && k != "p" { out[k] = o[k] ?? .null }
                return .object(out)
            })
        })
    }

    /// 旧形状的一格里每个点都有 x / y、所有数都是有限数（AnnualInkWire 平铺的格一定是这种）。
    static func cleanLegacy(_ v: JSValue) -> Bool {
        (v.arrayValue ?? []).allSatisfy { s -> Bool in
            (s.arrayValue ?? []).allSatisfy { p -> Bool in
                guard case .object(let o) = p, o["x"] != nil, o["y"] != nil else { return false }
                return o.keys.allSatisfy { k -> Bool in
                    if case .number(let d)? = o[k] { return d.isFinite }
                    return true
                }
            }
        }
    }

    /// 一格的 ink.points 与旧形状相同：就是旧形状本身（verbatim），或旧形状每个数都有限、平铺展开后 = 旧形状去掉 t / p（逐位）。
    static func sameInk(_ wire: JSValue, _ legacy: JSValue) -> Bool {
        P.same(wire, legacy) || cleanLegacy(legacy) && P.same(.array((wire.arrayValue ?? []).map(P.expand)), withoutTP(legacy))
    }

    /// 两份视图逐值比（数比位型）；ink = {points} 的格按 sameInk 比。不同之处记进 out，墨迹格按 flat / verbatim 计数。
    static func diff(_ wire: JSValue, _ legacy: JSValue, _ path: String, _ out: inout [String], _ slots: inout [String: Int]) {
        switch (wire, legacy) {
        case (.object(let x), .object(let y)):
            guard x.keys == y.keys else {
                out.append("\(path): keys \(x.keys) vs \(y.keys)")
                return
            }
            for k in x.keys {
                let a = x[k] ?? .null, b = y[k] ?? .null
                if k == "ink", case .object(let ia) = a, case .object(let ib) = b, ia.keys == ["points"], ib.keys == ["points"] {
                    let wp = ia["points"] ?? .null, lp = ib["points"] ?? .null
                    if !sameInk(wp, lp) { out.append("\(path).ink: \(str(wp)) vs \(str(lp))") }
                    slots[P.same(wp, lp) ? "verbatim" : "flat", default: 0] += 1
                    for s in wp.arrayValue ?? [] { slots["stroke-" + P.kind(s), default: 0] += 1 }
                } else {
                    diff(a, b, path + "." + k, &out, &slots)
                }
            }
        case (.array(let x), .array(let y)):
            guard x.count == y.count else {
                out.append("\(path): \(x.count) vs \(y.count) items")
                return
            }
            for i in x.indices { diff(x[i], y[i], "\(path)[\(i)]", &out, &slots) }
        default:
            if !P.same(wire, legacy) { out.append("\(path): \(str(wire)) vs \(str(legacy))") }
        }
    }

    /// 随机与边界的回放点：w 全有 / 全无 / 混着、t / p 有或没有、三种键序（orderXYTP 里没有 w：有 w 的点旧形状不写 w）、空笔、一个点、
    /// x / y / t / p / w 里夹 NaN / ±∞、±0、极大极小的有限数、随机位型。
    func testWireExpandsToTheLegacyPointsBitForBit() {
        var rng = SplitMix(20261107)
        let specials: [Double] = [0, -0.0, 1, -1, 0.1, 1.0 / 3, 345, .greatestFiniteMagnitude, -.greatestFiniteMagnitude,
                                  .leastNonzeroMagnitude, -.leastNonzeroMagnitude, .leastNormalMagnitude, 9e15, -9e15, 9007199254740994, 1e-300]
        let bad: [Double] = [.nan, .infinity, -.infinity]
        func finite() -> Double {
            switch rng.next() % 4 {
            case 0: return specials[Int(rng.next() % UInt64(specials.count))]
            case 1: return Double(rng.next() % 3450) / 10
            case 2: return Double(rng.next() % 2_000_001) / 1000 - 1000
            default:
                while true {
                    let d = Double(bitPattern: rng.next())
                    if d.isFinite { return d }
                }
            }
        }
        func value(_ badRate: UInt64) -> Double { badRate > 0 && rng.next() % badRate == 0 ? bad[Int(rng.next() % 3)] : finite() }
        func stroke(_ badRate: UInt64) -> [InkPoint] {
            let n = Int(rng.next() % 30), mode = rng.next() % 5
            let order = rng.next() % 8 == 0 ? InkPoint.orderXYTP : rng.next() % 2 == 0 ? InkPoint.orderXYTPW : InkPoint.orderXYWTP
            return (0..<n).map { _ in
                var w: Double?
                switch mode {
                case 0: w = value(badRate)
                case 1: w = nil
                case 2: w = rng.next() % 2 == 0 ? value(badRate) : nil
                case 3: w = rng.next() % 40 == 0 ? nil : value(badRate)
                default: w = rng.next() % 40 == 0 ? value(0) : nil
                }
                var q = InkPoint(x: value(badRate), y: value(badRate), t: rng.next() % 8 == 0 ? nil : value(badRate), w: w, order: order)
                if rng.next() % 3 == 0 { q.p = value(badRate) }
                return q
            }
        }
        var kinds: [String: Int] = [:]
        func check(_ r: [[InkPoint]], _ what: String) {
            let wire = AnnualInkWire.points(r), legacy = AnnualInkWire.points(r, legacy: true)
            // 旧形状就是改动前 DetailView.builtInk 发的
            XCTAssertTrue(P.same(legacy, .array(r.map { .array($0.map(\.js)) })), what)
            let clean = r.allSatisfy { $0.allSatisfy(AnnualInkWire.faithful) }
            if clean {
                XCTAssertTrue(P.same(.array((wire.arrayValue ?? []).map(P.expand)), Self.withoutTP(legacy)), "\(what): \(str(wire)) vs \(str(legacy))")
                for s in wire.arrayValue ?? [] { kinds[P.kind(s), default: 0] += 1 }
            } else {
                XCTAssertTrue(P.same(wire, legacy), "\(what): a cell with a non-finite number keeps the legacy shape verbatim")
                kinds["verbatim", default: 0] += 1
            }
            if clean { XCTAssertTrue(Self.cleanLegacy(legacy), "\(what): a flat cell's legacy shape has only finite numbers") }
            XCTAssertTrue(Self.sameInk(wire, legacy), what)
        }
        check([], "no strokes")
        check([[]], "one empty stroke")
        check([[], [InkPoint(x: 1, y: 2, t: 0, w: 3)], []], "empty strokes around a point")
        check([[InkPoint(x: 1, y: 2, t: 0, w: 3)]], "one point with w")
        check([[InkPoint(x: 1, y: 2, t: 0)]], "one point without w")
        check([[InkPoint(x: 1, y: 2, t: 0, p: 0.5, w: 3), InkPoint(x: 4, y: 5, t: 8, p: 0.25, w: 6)]], "pressure")
        check([[InkPoint(x: -0.0, y: -0.0, t: -0.0, w: -0.0), InkPoint(x: 0, y: 0, t: 0, w: 0)]], "signed zeros")
        check([[InkPoint(x: 1, y: 2, t: 0, w: 3), InkPoint(x: 4, y: 5, t: 8)]], "mixed w")
        check([[InkPoint(x: .nan, y: 2, t: 0, w: 3), InkPoint(x: 4, y: 5, t: 8, w: 6)]], "NaN x")
        check([[InkPoint(x: 1, y: .infinity, t: 0, w: 3)]], "infinite y")
        check([[InkPoint(x: 1, y: 2, t: 0, w: .nan)]], "NaN w")
        check([[InkPoint(x: 1, y: 2, t: .infinity, w: 3)]], "infinite t")
        check([[InkPoint(x: 1, y: 2, t: 0, p: .nan, w: 3)]], "NaN p")
        check([[InkPoint(x: 1, y: 2, t: 0, w: 3)], [InkPoint(x: 1, y: 2, t: 0, w: -.infinity)]], "one bad stroke keeps the whole cell verbatim")
        check([[InkPoint(x: 1, y: 2, t: 0, w: 3, order: InkPoint.orderXYTP)]], "w the legacy shape does not write")
        check([[InkPoint(x: 1, y: 2, t: 0, order: InkPoint.orderXYTP), InkPoint(x: 3, y: 4, t: 8, order: InkPoint.orderXYTP)]], "orderXYTP without w")
        check([[InkPoint(x: 1, y: 2, t: 0, w: 3, order: ["y", "w"])]], "x the legacy shape does not write")
        let specialsA: [InkPoint] = specials.map { (v: Double) -> InkPoint in InkPoint(x: v, y: -v, t: v, w: v) }
        let specialsB: [InkPoint] = specials.map { (v: Double) -> InkPoint in InkPoint(x: -v, y: v, t: 1) }
        check([specialsA, specialsB], "specials")
        let huge: [InkPoint] = (0..<5000).map { (i: Int) -> InkPoint in
            let d = Double(i)
            let y = Double(i % 345)
            let w: Double = 9 + Double(i % 5)
            return InkPoint(x: d / 7, y: y, t: d * 8, w: w)
        }
        check([huge], "a huge stroke")
        for round in 0..<2000 {
            let badRate: UInt64 = round % 3 == 0 ? 0 : 1 + rng.next() % 200
            let r: [[InkPoint]] = (0..<Int(rng.next() % 5)).map { _ in stroke(badRate) }
            check(r, "random #\(round)")
        }
        for k in ["empty", "xyw", "xy", "points", "verbatim"] { XCTAssertGreaterThan(kinds[k] ?? 0, 10, "covered \(k): \(kinds)") }
    }

    /// 有很多墨迹的一年（v4 原始点，外加 v3、v2、溢出的 v2、没有墨迹的一条）：
    /// annualView(inkWire: true) 与 annualView(inkWire: false) 除墨迹格外逐值相同，墨迹格按 sameInk 相同；view.annual 发的就是前者。
    func testAnnualViewMatchesTheLegacyViewOverAPopulatedYear() throws {
        var state = try AnnualInkBenchTests.annualState(90)
        guard case .object(var jan)? = state["ink"]?["2026-01"] else { return XCTFail("no January ink table") }
        jan["r2"] = LibraryInkPayloadTests.overflowingV2Ink()
        jan["r3"] = inkEntry(12, 4)
        jan["r4"] = inkEntryV2(10, 2)
        jan["r5"] = nil
        var ink = state["ink"]?.objectValue ?? JSObject()
        ink["2026-01"] = .object(jan)
        state["ink"] = .object(ink)
        let env = freshStore(.native, budgets: Budgets.native.js)
        let seeded = env.store.seed(.object(state))
        XCTAssertEqual(seeded["ok"], .bool(true), str(seeded))
        let st = JSValue.object(env.store.state), today = try env.store.dates.localDay(.number(env.store.now()))
        let wire = try MineSubView.annualView(st, today: today, year: .number(2026), policy: Config.policy, inkWire: true, dates: env.store.dates)
        let legacy = try MineSubView.annualView(st, today: today, year: .number(2026), policy: Config.policy, inkWire: false, dates: env.store.dates)
        var out: [String] = [], slots: [String: Int] = [:]
        Self.diff(wire, legacy, "view", &out, &slots)
        XCTAssertEqual(out, [], "\(out.prefix(5))")
        XCTAssertGreaterThanOrEqual(slots["flat"] ?? 0, 85, "\(slots)")
        XCTAssertGreaterThanOrEqual(slots["verbatim"] ?? 0, 1, "the overflowing v2 cell: \(slots)")
        XCTAssertGreaterThan(slots["stroke-xyw"] ?? 0, 0, "\(slots)")
        let cells = (legacy["months"]?.arrayValue ?? []).flatMap { $0["cells"]?.arrayValue ?? [] }
        XCTAssertTrue(cells.contains { $0["mode"] == .string("under") && $0["recordId"] == .string("r5") }, "the record without ink stays a reference glyph")
        XCTAssertTrue(JS.truthy(wire["twice"] ?? .null) && JS.truthy(wire["first"]?["ink"] ?? .null), "first and twice carry ink")
        let reply = PageAPI.call("view.annual", store: env.store, args: JSObject([("year", .number(2026))]))
        XCTAssertEqual(reply["ok"], .bool(true), str(reply))
        XCTAssertTrue(P.same(reply["view"] ?? .null, wire), "view.annual sends annualView(inkWire: true)")
        print("[shizi] annual ink payload slots: \(slots.sorted { $0.key < $1.key })")
    }
}
