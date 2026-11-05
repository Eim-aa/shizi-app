import Foundation
import XCTest
@testable import ShiziCore

// 字库页（全部字 / 清单）回包里的墨迹（LibrarySubAPI）：App 把回包经 JSONSerialization 往返解码，
// 非有限数（NaN / ±∞）在 Apple 平台上抛 Objective-C 异常、Swift 接不住，所以回包里只能有有限数。
// 本文件的用例只检查 JSValue，不走 JSONSerialization，所以即使复现了坏数据也不会让测试进程崩。

final class LibraryInkPayloadTests: XCTestCase {
    /// 存下的 v4 原始点没有 w（{x, y, t, p?}），但 decodeInk 走 buildStroke 重算宽度：解码 + 回放重采样后每点都有有限的 w。
    /// 即「w 缺省 → 回包写 NaN」那条路对合法墨迹走不到。
    func testRawV4InkWithoutWidthDecodesWithFiniteWidthEverywhere() throws {
        var raw: [[InkPoint]] = []
        for i in 0..<3 {
            raw.append((0..<12).map { j in InkPoint(x: Double(60 + i * 40 + j * 9), y: Double(80 + j * 14), t: Double(i * 400 + j * 16), order: InkPoint.orderXYTP) })
        }
        XCTAssertTrue(raw.allSatisfy { $0.allSatisfy { $0.w == nil } })
        let ink = InkMath.encodeInkRaw(raw)
        XCTAssertTrue(InkMath.isInkV4(ink))
        XCTAssertNil(Schema.validateInk(ink))
        let decoded = try XCTUnwrap(try InkMath.decodeInk(ink))
        let replay = InkMath.resampleForReplay(decoded)
        XCTAssertFalse(replay.isEmpty)
        for s in replay {
            for q in s {
                let w = try XCTUnwrap(q.w, "every replayed point carries a width")
                XCTAssertTrue(w.isFinite && q.x.isFinite && q.y.isFinite)
            }
        }
    }

    /// 能过存储校验（intRow 只要求整数）的 v2 墨迹：坐标取到接近 Double 上限，Catmull-Rom 的 5·b.x / 4·c.x 溢出成 ∞，∞ − ∞ = NaN。
    static func overflowingV2Ink() -> JSValue {
        let big = 1.7e308
        let row: [JSValue] = [.number(big), .number(big), .number(100), .number(big), .number(big), .number(100)]
        return .object(JSObject([("v", .number(2)), ("c", .number(345)), ("s", .array([.array(row)]))]))
    }

    func testOverflowingV2InkPassesValidationButReplaysToNonFinite() throws {
        let ink = Self.overflowingV2Ink()
        XCTAssertTrue(InkMath.isInkV2(ink))
        XCTAssertNil(Schema.validateInk(ink), "backup import / seed accept it")
        let replay = InkMath.resampleForReplay(try XCTUnwrap(try InkMath.decodeInk(ink)))
        XCTAssertTrue(replay.flatMap { $0 }.contains { !$0.x.isFinite || !$0.y.isFinite }, "the replay itself overflows (root cause)")
    }

    /// view.library-all / view.library-list 的 ink 回包：坏墨迹里的非有限点被丢掉，合法墨迹逐值不变（x / y / w 都在）。
    func testLibraryInkPayloadOnlyCarriesFiniteNumbers() throws {
        var state = storeBaseline()
        let good = inkEntry()
        state["ink"] = .object(JSObject([("2026-09", .object(JSObject([("r2", good), ("r3", Self.overflowingV2Ink())])))]))
        let env = freshStore(.local)
        let seededResult = env.store.seed(.object(state))
        XCTAssertEqual(seededResult["ok"], .bool(true), str(seededResult))

        for op in ["view.library-all", "view.library-list"] {
            let r = PageAPI.call(op, store: env.store)
            XCTAssertEqual(r["ok"], .bool(true), "\(op): \(str(r))")
            guard case .object(let ink)? = r["ink"] else { return XCTFail("\(op): no ink map") }
            var numbers = 0
            func walk(_ v: JSValue) {
                switch v {
                case .number(let d): numbers += 1; XCTAssertTrue(d.isFinite, "\(op): non-finite number in ink payload")
                case .array(let a): a.forEach(walk)
                case .object(let o): o.entries.forEach { walk($0.1) }
                default: break
                }
            }
            walk(.object(ink))
            if op == "view.library-all" {
                // 合法墨迹：与直接解码 + 重采样逐值一致；每点都有 w → 每笔平铺成 [3, x0, y0, w0, x1, …]（LibraryInkWire）
                let expected = InkMath.resampleForReplay(try XCTUnwrap(try InkMath.decodeInk(good)))
                guard case .array(let got)? = ink["r2"] else { return XCTFail("r2 ink missing: \(str(.object(ink)))") }
                XCTAssertEqual(got.count, expected.count)
                for (gs, es) in zip(got, expected) {
                    let flat = gs.arrayValue ?? []
                    XCTAssertEqual(flat.first, .number(3))
                    XCTAssertEqual(flat.count, 1 + 3 * es.count)
                    for (k, e) in es.enumerated() where 3 + 3 * k < flat.count {
                        XCTAssertEqual(flat[1 + 3 * k], .number(e.x)); XCTAssertEqual(flat[2 + 3 * k], .number(e.y)); XCTAssertEqual(flat[3 + 3 * k], .number(e.w!))
                    }
                }
                XCTAssertGreaterThan(numbers, 0)
            }
        }
    }

    // MARK: 平铺形状（LibraryInkWire）与旧形状逐位相同

    /// 平铺的一笔展开成旧形状（App 端 LibraryInkView.expandFlat 的 JSValue 版）：[步长, x, y, (w), …] → [{x, y, (w)}, …]；别的原样。
    static func expand(_ stroke: JSValue) -> JSValue {
        guard case .array(let a) = stroke, let head = a.first?.numberValue, head == 2 || head == 3 else { return stroke }
        let k = head == 3 ? 3 : 2
        guard (a.count - 1) % k == 0 else { return stroke }
        return .array(Swift.stride(from: 1, to: a.count, by: k).map { i -> JSValue in
            var o = JSObject([("x", a[i]), ("y", a[i + 1])])
            if k == 3 { o["w"] = a[i + 2] }
            return .object(o)
        })
    }

    /// 逐位相同：数比位型（−0 与 0 不同），对象比键序与值，数组逐个比。
    static func same(_ a: JSValue, _ b: JSValue) -> Bool {
        switch (a, b) {
        case (.number(let x), .number(let y)): return x.bitPattern == y.bitPattern
        case (.array(let x), .array(let y)): return x.count == y.count && zip(x, y).allSatisfy { same($0, $1) }
        case (.object(let x), .object(let y)): return x.keys == y.keys && x.keys.allSatisfy { k in same(x[k] ?? .null, y[k] ?? .null) }
        default: return a == b
        }
    }

    /// 一笔的形状：empty（[]）/ xyw（步长 3）/ xy（步长 2）/ points（旧形状）。
    static func kind(_ stroke: JSValue) -> String {
        guard let a = stroke.arrayValue, let first = a.first else { return "empty" }
        if case .number(let h) = first { return h == 3 ? "xyw" : h == 2 ? "xy" : "?" }
        return "points"
    }

    /// 随机与边界的点列：w 全有 / 全无 / 混着、空笔、一个点、x / y / w 里夹 NaN / ±∞、±0、极大极小的有限数、随机位型。
    /// 平铺的一笔展开 = 旧形状的一笔（逐位）；形状按 w 的有无选对；混着的一笔就是旧形状本身。
    func testFlatStrokeExpandsToTheLegacyStrokeBitForBit() {
        var rng = SplitMix(20261105)
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
        var kinds: [String: Int] = [:]
        func check(_ pts: [InkPoint], _ what: String) {
            let flat = LibraryInkWire.stroke(pts), legacy = LibraryInkWire.legacyStroke(pts)
            XCTAssertTrue(Self.same(Self.expand(flat), legacy), "\(what): \(str(flat)) vs \(str(legacy))")
            let kept = pts.filter { $0.x.isFinite && $0.y.isFinite }, widths = kept.filter { $0.w?.isFinite == true }.count
            let want = kept.isEmpty ? "empty" : widths == kept.count ? "xyw" : widths == 0 ? "xy" : "points"
            XCTAssertEqual(Self.kind(flat), want, what)
            if want == "points" { XCTAssertTrue(Self.same(flat, legacy), "\(what): a mixed stroke keeps the legacy shape") }
            kinds[want, default: 0] += 1
        }
        check([], "empty stroke")
        check([InkPoint(x: 1, y: 2, w: 3)], "one point with w")
        check([InkPoint(x: 1, y: 2)], "one point without w")
        check([InkPoint(x: -0.0, y: -0.0, w: -0.0), InkPoint(x: 0, y: 0, w: 0)], "signed zeros with w")
        check([InkPoint(x: -0.0, y: 0), InkPoint(x: 0, y: -0.0)], "signed zeros without w")
        check([InkPoint(x: 1, y: 2, w: 3), InkPoint(x: 4, y: 5)], "mixed")
        check([InkPoint(x: 1, y: 2, w: .nan), InkPoint(x: 4, y: 5, w: 6)], "a NaN w makes it mixed")
        check([InkPoint(x: 1, y: 2, w: .infinity), InkPoint(x: 4, y: 5, w: .nan)], "no finite w")
        check([InkPoint(x: .nan, y: 2, w: 3), InkPoint(x: 4, y: 5, w: 6)], "a dropped point, the rest has w")
        check([InkPoint(x: .nan, y: 2, w: 3), InkPoint(x: 4, y: .infinity)], "every point dropped")
        check([InkPoint(x: .nan, y: 2), InkPoint(x: 4, y: 5, w: 6)], "the point without w is dropped")
        check(specials.map { InkPoint(x: $0, y: -$0, w: $0) }, "specials with w")
        check(specials.map { InkPoint(x: $0, y: -$0) }, "specials without w")
        for round in 0..<3000 {
            let n = Int(rng.next() % 40), mode = rng.next() % 5, badRate: UInt64 = round % 3 == 0 ? 0 : 1 + rng.next() % 30
            let pts: [InkPoint] = (0..<n).map { _ in
                let w: Double?
                switch mode {
                case 0: w = value(badRate) // 全有（夹坏数时就是混着）
                case 1: w = nil
                case 2: w = rng.next() % 2 == 0 ? value(badRate) : nil
                case 3: w = rng.next() % 50 == 0 ? nil : value(badRate) // 偶尔缺一个
                default: w = rng.next() % 50 == 0 ? value(0) : nil // 偶尔有一个
                }
                return InkPoint(x: value(badRate), y: value(badRate), w: w)
            }
            check(pts, "random #\(round)")
        }
        for k in ["empty", "xyw", "xy", "points"] { XCTAssertGreaterThan(kinds[k] ?? 0, 10, "covered \(k): \(kinds)") }
    }

    /// 有很多墨迹的库（v4 原始点，外加 v3、v2、溢出的 v2）：两页回包里每条墨迹展开后 = 同一份重采样点按旧形状拼的，逐位相同；键与键序也相同。
    func testLibraryPayloadExpandsToTheLegacyPayloadOverAPopulatedStore() throws {
        var state = try LibraryInkBenchTests.inkedState(120)
        guard case .object(var april)? = state["ink"]?["2026-04"] else { return XCTFail("no April ink table") }
        april["r1"] = Self.overflowingV2Ink()
        april["r2"] = inkEntry(12, 4)
        april["r3"] = inkEntryV2(10, 2)
        var ink = state["ink"]?.objectValue ?? JSObject()
        ink["2026-04"] = .object(april)
        state["ink"] = .object(ink)
        let env = freshStore(.native, budgets: Budgets.native.js)
        let seeded = env.store.seed(.object(state))
        XCTAssertEqual(seeded["ok"], .bool(true), str(seeded))
        var kinds: [String: Int] = [:]
        for op in ["view.library-all", "view.library-list"] {
            let args: JSObject = op == "view.library-all" ? JSObject([("sort", .string("age"))]) : JSObject()
            let r = PageAPI.call(op, store: env.store, args: args)
            XCTAssertEqual(r["ok"], .bool(true), "\(op): \(str(r))")
            guard case .object(let got)? = r["ink"], let view = r["view"] else { return XCTFail("\(op): no ink map") }
            var want = JSObject()
            for rec in LibraryInkBenchTests.inkRecords(op, view) {
                guard let raw = env.store.getInk(rec), let decoded = try? InkMath.decodeInk(raw),
                      let legacy = LibraryInkWire.record(InkMath.resampleForReplay(decoded), legacy: true) else { continue }
                want[JS.string(rec["id"])] = legacy
            }
            XCTAssertEqual(got.keys, want.keys, op)
            XCTAssertGreaterThanOrEqual(got.count, 119, op)
            for id in got.keys {
                let strokes = got[id]?.arrayValue ?? []
                strokes.forEach { kinds[Self.kind($0), default: 0] += 1 }
                XCTAssertTrue(Self.same(.array(strokes.map(Self.expand)), want[id] ?? .null), "\(op) \(id)")
            }
        }
        XCTAssertGreaterThan(kinds["xyw"] ?? 0, 0, "\(kinds)")
        print("[shizi] library ink payload stroke shapes: \(kinds.sorted { $0.key < $1.key })")
    }
}
