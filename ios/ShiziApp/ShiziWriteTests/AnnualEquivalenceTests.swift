import ShiziCore
import UIKit
import XCTest
@testable import Shizi

// MARK: - 年报回包 view → AnnualScreen.View：新路（平铺 + decodeView）= 原路（旧形状 + ShiziDecode.value），逐位

/// 原路 = 改动前 render 里那一行（ShiziDecode.value(raw, as: View.self)），保留在这里只作参照。
/// 比的是页面用到的全部：非墨迹字段（字、模式、日期、文案引用、年份……）与每格墨迹每点 x / y / w 的位型；
/// 画出来的三角形顶点（ShiziPointsInkView.vertices，draw 里用的就是它）逐位相同。
/// 引擎不再发 t / p（画墨用不到）：新路解出的 t / p 是 nil；而「新路 = 把它展开成旧形状后原路解」连 t / p 一起逐位相同。
@MainActor
enum AnnualEq {
    typealias View = AnnualScreen.View

    /// 原路（改动前 render 里的那一行）。
    static func old(_ raw: Any) -> View? { try? ShiziDecode.value(raw, as: View.self) }

    /// 页面用到的东西的可比形式：字串（非墨迹字段 + 墨迹位型）与文案引用（Equatable，参数是字典，不进字串）。
    struct Print: Equatable {
        var lines: [String] = []
        var refs: [ShiziCopyRef] = []
    }

    static func fingerprint(_ m: View?, tp: Bool = true) -> Print? {
        guard let m else { return nil }
        var p = Print()
        func hex(_ d: Double?) -> String { d.map { String($0.bitPattern, radix: 16) } ?? "nil" }
        func ink(_ b: ShiziInkBox?) -> String {
            guard let b else { return "-" }
            return b.points.map { s -> String in
                s.map { q -> String in
                    var f = [hex(q.x), hex(q.y), hex(q.w)]
                    if tp { f += [hex(q.t), hex(q.p)] }
                    return f.joined(separator: ",")
                }.joined(separator: ";")
            }.joined(separator: "|")
        }
        p.lines.append("\(m.today) \(m.year) \(m.years) \(String(describing: m.prevYear)) \(String(describing: m.nextYear)) \(m.empty) \(m.count) \(m.days) \(m.coverYear)")
        p.lines.append("lines \(String(describing: m.lines?.head)) \(String(describing: m.lines?.firstDate))")
        p.refs += [m.coverLine, m.emptyTitle, m.emptyBody, m.emptyGlyph, m.adjust, m.adjustAria, m.save]
        if let f = m.first {
            p.lines.append("first \(f.char) \(f.day) \(f.recordId) \(ink(f.ink))")
            p.refs += [f.label, f.date]
        } else {
            p.lines.append("first -")
        }
        for sec in m.months {
            p.lines.append("month \(sec.month) \(sec.monthNum) \(sec.n) \(sec.cells.count)")
            p.refs += [sec.name, sec.count, sec.aria]
            for c in sec.cells {
                p.lines.append("cell \(c.ch) \(c.mode) \(c.tag) \(c.day) \(c.recordId) \(ink(c.ink))")
                p.refs.append(c.label)
            }
        }
        if let t = m.twice {
            p.lines.append("twice \(t.char)")
            p.refs.append(t.title)
            for s in [t.first, t.last] {
                p.lines.append("side \(s.recordId) \(s.day) \(ink(s.ink))")
                p.refs += [s.label, s.date]
            }
        } else {
            p.lines.append("twice -")
        }
        return p
    }

    /// 视图里的墨迹格（今年首字、每格、卷尾两格）。
    static func boxes(_ m: View) -> [ShiziInkBox?] {
        var out: [ShiziInkBox?] = [m.first?.ink]
        for sec in m.months { out += sec.cells.map(\.ink) }
        out += [m.twice?.first.ink, m.twice?.last.ink]
        return out
    }

    /// 画出来的顶点（两种 widthScale）的位型。
    static func vertexBits(_ m: View) -> [[UInt32]] {
        boxes(m).flatMap { b -> [[UInt32]] in
            let pts = b?.points ?? []
            return [1, ShiziInkScale.scale(45, 1 - 2 * 0.09)].map { ShiziPointsInkView.vertices(pts, widthScale: $0).map(\.bitPattern) }
        }
    }

    /// 一份 view（JSValue，过边界之前）：今年首字、卷尾两格、cells 分两个月；各格的 ink 由参数给（nil = 没有墨迹）。
    static func view(first: JSValue?, twice: (JSValue?, JSValue?)?, cells: [JSValue?]) -> JSValue {
        func ref(_ key: String, _ params: [(String, JSValue)] = []) -> JSValue { AnnualBench.ref(key, params) }
        let half = (cells.count + 1) / 2
        var months: [JSValue] = []
        for (k, range) in [0..<half, half..<cells.count].enumerated() where !range.isEmpty {
            let mn = Double(k + 1), n = JSValue.number(Double(range.count))
            let cs: [JSValue] = range.map { i in
                .object(JSObject([
                    ("ch", .string("字\(i)")), ("ink", cells[i] ?? .null), ("mode", .string(cells[i] == nil ? "under" : "hand")), ("tag", .string(i % 5 == 0 ? "3" : "")),
                    ("day", .string("")), ("recordId", .string("r\(i)")), ("recordDay", .string("2026-0\(k + 1)-02")),
                    ("label", ref("X-MINE.cellLabel", [("char", .string("字\(i)")), ("date", .string(""))])),
                ]))
            }
            months.append(.object(JSObject([
                ("month", .string("2026-0\(k + 1)")), ("monthNum", .number(mn)), ("n", n), ("name", ref("X-WORK.annualMonthName", [("month", .number(mn))])),
                ("count", ref("X-WORK.annualMonthCount", [("n", n)])), ("aria", ref("X-WORK.annualMonthAria", [("month", .number(mn)), ("n", n)])), ("cells", .array(cs)),
            ])))
        }
        func side(_ id: String, _ ink: JSValue?) -> JSValue {
            .object(JSObject([("recordId", .string(id)), ("day", .string("2026-02-03")), ("ink", ink ?? .null), ("label", ref("X-WORK.annualFirstCellAria", [("char", .string("永"))])),
                              ("date", ref("R-H02.dateFormat", [("month", .number(2)), ("day", .number(3))]))]))
        }
        let firstV = JSValue.object(JSObject([
            ("char", .string("永")), ("day", .string("2026-01-01")), ("recordId", .string("r-first")), ("ink", first ?? .null),
            ("label", ref(first == nil ? "X-ANNUAL.firstNoInk" : "X-ANNUAL.firstInk", [("char", .string("永"))])), ("date", ref("R-H02.dateFormat", [("month", .number(1)), ("day", .number(1))])),
        ]))
        var twiceV: JSValue = .null
        if let t = twice {
            twiceV = .object(JSObject([("char", .string("永")), ("title", ref("X-WORK.annualTwiceTitle")), ("first", side("r-a", t.0)), ("last", side("r-b", t.1))]))
        }
        return .object(JSObject([
            ("today", .string("2026-09-01")), ("year", .number(2026)), ("years", .array([.number(2026)])), ("prevYear", .null), ("nextYear", .null),
            ("empty", .bool(false)), ("count", .number(Double(cells.count))), ("days", .number(12)), ("coverYear", .string("二〇二六")),
            ("coverLine", ref("X-WORK.annualCoverLine", [("n", .string("\(cells.count)"))])), ("first", firstV), ("months", .array(months)), ("twice", twiceV),
            ("emptyTitle", ref("R-M06.emptyTitle")), ("emptyBody", ref("R-M06.emptyBody")), ("emptyGlyph", ref("X-ANNUAL.emptyGlyph")),
            ("adjust", ref("X-WORK.adjustImage")), ("adjustAria", ref("X-WORK.adjustAria")), ("save", ref("R-M01.saveImage")),
            ("lines", .object(JSObject([("head", .array([.number(0), .number(7)])), ("firstDate", .null)]))),
        ]))
    }

    /// 一条记录的回放点 → 引擎发的那格 ink（同 AnnualInkWire.built：没有非空的笔 → 没有墨迹）。
    static func box(_ r: [[InkPoint]], legacy: Bool) -> JSValue? {
        r.contains { !$0.isEmpty } ? JSValue.object(JSObject([("points", AnnualInkWire.points(r, legacy: legacy))])) : nil
    }
}

@MainActor
final class AnnualInkDecodeTests: XCTestCase {
    typealias Eq = AnnualEq

    /// 引擎拼的一份：新路解平铺 = 原路解旧形状（不看 t / p），画出的顶点逐位相同；新路 = 展开后原路解（连 t / p）。
    private func checkEngine(_ records: [[[InkPoint]]], _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        func payload(_ legacy: Bool) -> Any {
            let boxes = records.map { Eq.box($0, legacy: legacy) }
            let first = boxes.first ?? nil
            let twice: (JSValue?, JSValue?)? = boxes.count >= 3 ? (boxes[1], boxes[2]) : nil
            return EngineValue.any(Eq.view(first: first, twice: twice, cells: Array(boxes.dropFirst(min(3, boxes.count)))))
        }
        let flat = payload(false), legacy = payload(true)
        let ref = Eq.old(legacy)
        let got = try? AnnualScreen.decodeView(flat)
        XCTAssertEqual(got == nil, ref == nil, "\(what): decodes iff the legacy payload did", file: file, line: line)
        XCTAssertEqual(Eq.fingerprint(got, tp: false), Eq.fingerprint(ref, tp: false), "\(what): same view, x / y / w bit for bit", file: file, line: line)
        if let got, let ref {
            XCTAssertEqual(Eq.vertexBits(got), Eq.vertexBits(ref), "\(what): same triangles", file: file, line: line)
        }
        XCTAssertEqual(Eq.fingerprint(got), Eq.fingerprint(Eq.old(AnnualScreen.expandInk(flat))), "\(what): = the expansion decoded the original way, t / p included", file: file, line: line)
        let faithful = records.allSatisfy { $0.allSatisfy { $0.allSatisfy(AnnualInkWire.faithful) } }
        if faithful { XCTAssertNotNil(AnnualScreen.decodeViewDirect(flat), "\(what): direct path", file: file, line: line) }
        if ref == nil { XCTAssertNil(AnnualScreen.decodeViewDirect(flat), "\(what): an undecodable payload never goes direct", file: file, line: line) }
    }

    /// 随机与边界的点列（同 ShiziCore AnnualInkPayloadTests）：w 全有 / 全无 / 混着、t / p 有或没有、orderXYTP、空笔、一个点、大笔、
    /// x / y / t / p / w 里夹 NaN / ±∞（引擎整格照旧发：新旧两路都解不了）、±0（EngineValue.any 两种形状都成整数 0）、极大极小的有限数、2^53 / 9e15 附近、随机位型。
    func testEnginePayloadsDecodeLikeTheLegacyPayload() {
        var rng = WebInkTestRNG(state: 20261108)
        let specials: [Double] = [0, -0.0, 1, -1, 0.5, 0.1, 1.0 / 3, 345, -345, .greatestFiniteMagnitude, -.greatestFiniteMagnitude, .leastNonzeroMagnitude,
                                  -.leastNonzeroMagnitude, .leastNormalMagnitude, 9e15, -9e15, 8999999999999999, 9007199254740992, -9007199254740992, 9007199254740994, 1e-300]
        let bad: [Double] = [.nan, .infinity, -.infinity]
        func finite() -> Double {
            switch rng.next() % 4 {
            case 0: return specials[Int(rng.next() % UInt64(specials.count))]
            case 1: return Double.random(in: 0...345, using: &rng)
            case 2: return (Double.random(in: 0...3450, using: &rng)).rounded() / 10
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
        func pt(_ x: Double, _ y: Double, _ w: Double? = nil, t: Double? = 0) -> InkPoint { InkPoint(x: x, y: y, t: t, w: w) }
        checkEngine([], "no ink anywhere")
        checkEngine([[], [], [], [[]], [[], []]], "records whose strokes are all empty (no ink, as the engine sends)")
        checkEngine([[[pt(1, 2, 3)]], [[pt(1, 2)]], [[], [pt(3, 4, 5)]], [[pt(1, 2, 3), pt(4, 5)]]], "single points, an empty stroke, mixed w")
        checkEngine([[[pt(-0.0, 0, -0.0), pt(0, -0.0, 0)], [pt(-0.0, -0.0)]], [[pt(1, 2, 3)]], [[pt(1, 2, 3)]]], "signed zeros")
        checkEngine([[[InkPoint(x: 1, y: 2, t: 0, p: 0.5, w: 3), InkPoint(x: 4, y: 5, t: 8, p: 0.25, w: 6)]]], "pressure")
        checkEngine([[[pt(.nan, 2, 3), pt(4, 5, 6)]], [[pt(1, 2, 3)]], [[pt(1, 2, 3)]]], "NaN x: undecodable as before")
        checkEngine([[[pt(1, 2, 3)]], [[pt(1, .infinity, 3)]], [[pt(1, 2, 3)]]], "infinite y in twice: undecodable as before")
        checkEngine([[[pt(1, 2, 3)]], [[pt(1, 2, 3)]], [[pt(1, 2, 3)]], [[pt(1, 2, .nan)]]], "NaN w in a cell: undecodable as before")
        checkEngine([[[pt(1, 2, 3, t: .infinity)]]], "infinite t: undecodable as before")
        checkEngine([[[InkPoint(x: 1, y: 2, t: 0, w: 3, order: InkPoint.orderXYTP)]], [[pt(1, 2, 3)]], [[pt(1, 2, 3)]]], "w the legacy shape does not write")
        checkEngine([[specials.map { pt($0, -$0, $0) }, specials.map { pt(-$0, $0) }], [[pt(1, 2, 3)]], [[pt(1, 2, 3)]]], "specials")
        checkEngine([[(0..<6000).map { pt(Double($0) / 7, Double($0 % 345), 9 + Double($0 % 5), t: Double($0) * 8) }], [[pt(1, 2, 3)]], [[pt(1, 2, 3)]]], "a huge stroke")
        for round in 0..<150 {
            let badRate: UInt64 = round % 3 == 0 ? 0 : 1 + rng.next() % 400
            let records: [[[InkPoint]]] = (0..<Int(rng.next() % 9)).map { _ in (0..<Int(rng.next() % 4)).map { _ in stroke(badRate) } }
            checkEngine(records, "random #\(round)")
        }
    }

    /// 量测的合成回包（每格 8 笔 × 62 点，点都有 w 与 t）：新路解平铺 = 原路解旧形状，且走直接读。
    func testBenchPayloadsMatch() throws {
        for n in [0, 1, 37] {
            let flat = try XCTUnwrap(AnnualBench.payload(n, ink: n > 0)["view"])
            let legacy = try XCTUnwrap(AnnualBench.payload(n, ink: n > 0, legacy: true)["view"])
            let got = try AnnualScreen.decodeView(flat), ref = try XCTUnwrap(Eq.old(legacy))
            XCTAssertEqual(Eq.fingerprint(got, tp: false), Eq.fingerprint(ref, tp: false), "n=\(n)")
            XCTAssertEqual(Eq.vertexBits(got), Eq.vertexBits(ref), "n=\(n)")
            XCTAssertNotNil(AnnualScreen.decodeViewDirect(flat), "n=\(n): direct path")
            XCTAssertEqual(AnnualBench.points(got), (n + 3) * 8 * 62)
        }
    }

    /// 不是引擎拼的形状：新路解 = 展开成旧形状后原路解（连 t / p）；解不了的两路都解不了。direct = 是否走直接读。
    func testHandMadeShapesDecodeLikeTheirExpansion() throws {
        let base = try XCTUnwrap(EngineValue.any(Eq.view(first: nil, twice: nil, cells: [nil, nil, nil])) as? [String: Any])
        /// months[0].cells[0] 的 ink 换成 ink（nil = 去掉这个键）。
        func withInk(_ ink: Any?) -> [String: Any] {
            var root = base
            var months = root["months"] as? [Any] ?? []
            var m0 = months.first as? [String: Any] ?? [:]
            var cells = m0["cells"] as? [Any] ?? []
            var c0 = cells.first as? [String: Any] ?? [:]
            c0["ink"] = ink
            cells[0] = c0
            m0["cells"] = cells
            months[0] = m0
            root["months"] = months
            return root
        }
        func check(_ what: String, _ raw: [String: Any], direct: Bool, decodes: Bool = true, file: StaticString = #filePath, line: UInt = #line) {
            let got = try? AnnualScreen.decodeView(raw)
            XCTAssertEqual(Eq.fingerprint(got), Eq.fingerprint(Eq.old(AnnualScreen.expandInk(raw))), what, file: file, line: line)
            XCTAssertEqual(AnnualScreen.decodeViewDirect(raw) != nil, direct, "\(what): direct path taken", file: file, line: line)
            XCTAssertEqual(got != nil, decodes, "\(what): decodes", file: file, line: line)
        }
        func box(_ points: Any) -> [String: Any] { ["points": points] }
        let negZero = NSNumber(value: -0.0), float = NSNumber(value: Float(0.1)), big = NSNumber(value: Int64(1) << 53), past = NSNumber(value: (Int64(1) << 53) + 1)
        check("no ink", base, direct: true)
        check("ink key missing", withInk(nil), direct: true)
        check("xyw", withInk(box([[3, 1.5, 2, 3.25, 4, 5, 6] as [Any]])), direct: true)
        check("xy", withInk(box([[2, 1.5, 2, 4, 5] as [Any]])), direct: true)
        check("header only, empty stroke", withInk(box([[3] as [Any], [Any](), [2] as [Any]])), direct: true)
        check("no strokes", withInk(box([Any]())), direct: true)
        check("legacy points x / y / w", withInk(box([[["x": 1, "y": 2, "w": 3] as [String: Any], ["x": 4, "y": 5, "w": NSNull()] as [String: Any], ["x": 6, "y": 7] as [String: Any]] as [Any]])), direct: true)
        check("flat and legacy strokes in one cell", withInk(box([[2, 1, 2] as [Any], [["x": 3, "y": 4, "w": 5] as [String: Any]] as [Any]])), direct: true)
        check("Int64 / Int32 / Int16 numbers", withInk(box([[NSNumber(value: Int64(3)), NSNumber(value: Int32(7)), big, NSNumber(value: Int16(-2))] as [Any]])), direct: true)
        check("legacy points with t / p", withInk(box([[["x": 1, "y": 2, "w": 3, "t": 0, "p": 0.5] as [String: Any]] as [Any]])), direct: false)
        check("legacy point with another key", withInk(box([[["x": 1, "y": 2, "z": "?"] as [String: Any]] as [Any]])), direct: false)
        check("legacy point with a bad t", withInk(box([[["x": 1, "y": 2, "t": "soon"] as [String: Any]] as [Any]])), direct: false, decodes: false)
        check("box with another key", withInk(["points": [[2, 1, 2] as [Any]], "strokes": NSNull()] as [String: Any]), direct: false)
        check("negative zero x", withInk(box([[3, negZero, 2, 3] as [Any]])), direct: false)
        check("float w", withInk(box([[3, 1, 2, float] as [Any]])), direct: false)
        check("2^53 + 1", withInk(box([[2, past, 2] as [Any]])), direct: false)
        check("null w in a flat stroke (expands to w: null = no w)", withInk(box([[3, 1, 2, NSNull()] as [Any]])), direct: false)
        check("bool x", withInk(box([[2, true, 2] as [Any]])), direct: false, decodes: false)
        check("header 4", withInk(box([[4, 1, 2, 3, 4] as [Any]])), direct: false, decodes: false)
        check("header 3, count not a multiple", withInk(box([[3, 1, 2] as [Any]])), direct: false, decodes: false)
        check("string inside", withInk(box([[2, "1", 2] as [Any]])), direct: false, decodes: false)
        check("points null", withInk(box(NSNull())), direct: false, decodes: false)
        check("ink is a string", withInk("ink"), direct: false, decodes: false)
        check("NaN x", withInk(box([[2, NSNumber(value: Double.nan), 2] as [Any]])), direct: false, decodes: false)
        var broken = base
        broken["months"] = ["not a month"] as [Any]
        check("a month that is not an object", broken, direct: false, decodes: false)
        var noTwice = withInk(box([[2, 1, 2] as [Any]]))
        noTwice["twice"] = NSNull()
        noTwice["first"] = NSNull()
        check("no first, no twice", noTwice, direct: true)
    }

    /// 页面真用 decodeView：同一份墨迹的平铺回包与旧形状回包，排出来每格的墨迹点、模式相同。
    func testScreenRendersTheSameModel() throws {
        let records: [[[InkPoint]]] = (0..<12).map { AnnualBench.inkPoints($0) }
        func payload(_ legacy: Bool) -> [String: Any] {
            let boxes = records.map { Eq.box($0, legacy: legacy) }
            return ["ok": true, "view": EngineValue.any(Eq.view(first: boxes[0], twice: (boxes[1], boxes[2]), cells: Array(boxes.dropFirst(3)) + [nil]))]
        }
        var prints: [AnnualEq.Print?] = []
        for legacy in [false, true] {
            let vc = AnnualScreen(screen: "annual", entryId: "eq", params: [:])
            let w = LibraryBench.host(vc)
            vc.apply(payload: payload(legacy))
            LibraryBench.settle(w)
            let raw = try XCTUnwrap(vc.lastView)
            prints.append(Eq.fingerprint(try AnnualScreen.decodeView(raw), tp: false))
            LibraryBench.unhost(w)
        }
        XCTAssertEqual(prints[0], prints[1])
        XCTAssertNotNil(prints[0])
    }
}
