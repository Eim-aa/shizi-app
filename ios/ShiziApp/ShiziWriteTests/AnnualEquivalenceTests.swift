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

// MARK: - 年报月段只建看得见的格子（ShiziLazyCells）

/// 年报的两种建法：只建可见框 ± overscan 的（产品）与全部建出来（materializeAll = 以前一次建完的做法，同一套配置代码）。
@MainActor
enum AnnualVirtual {
    static func make(all: Bool) -> AnnualScreen {
        let vc = AnnualScreen(screen: "annual", entryId: all ? "eq-all" : "eq-virtual", params: [:])
        vc.cells.materializeAll = all
        return vc
    }

    /// 回包（AnnualBench.view：n 格分 12 个月）；mixed 时每 5 格有一格没有墨迹（画衬底字）、每 7 格有一格模式不是 hand（有墨也画衬底字）。
    static func payload(_ n: Int, ink: Bool = true, mixed: Bool = true) -> [String: Any] {
        let p = AnnualBench.payload(n, ink: ink)
        guard mixed else { return p }
        return editCells(p) { k, c in
            if k % 5 == 2 { c["ink"] = NSNull(); c["mode"] = "under" }
            if k % 7 == 3 { c["mode"] = "under" }
        }
    }

    /// 每格都换了内容的另一份回包（字、有没有墨、墨的点列），段数与格数不变、格子序号与原来重叠。
    static func changed(_ p: [String: Any]) -> [String: Any] {
        let chars = LibraryBench.chars(97)
        return editCells(p) { k, c in
            c["ch"] = chars[(k * 7 + 3) % chars.count]
            switch k % 3 {
            case 0: c["ink"] = NSNull(); c["mode"] = "under"
            case 1: c["ink"] = EngineValue.any(AnnualBench.box(k + 1000)); c["mode"] = "hand"
            default: break
            }
        }
    }

    /// 回包里每一格（按月份、月里按格的顺序数第 k 格）改一下。
    static func editCells(_ p: [String: Any], _ edit: (Int, inout [String: Any]) -> Void) -> [String: Any] {
        guard var view = p["view"] as? [String: Any], var months = view["months"] as? [Any] else { return p }
        var k = 0
        for mi in months.indices {
            guard var mo = months[mi] as? [String: Any], let cells = mo["cells"] as? [Any] else { continue }
            var out: [Any] = []
            out.reserveCapacity(cells.count)
            for raw in cells {
                guard var c = raw as? [String: Any] else { out.append(raw); continue }
                edit(k, &c)
                k += 1
                out.append(c)
            }
            mo["cells"] = out
            months[mi] = mo
        }
        view["months"] = months
        var res = p
        res["view"] = view
        return res
    }

    /// 页面里的月段按钮（content 里按顺序加进去的，= 页面的 monthButtons）。
    static func buttons(_ vc: AnnualScreen) -> [ShiziRowButton] {
        vc.content.subviews.compactMap { $0 as? ShiziRowButton }
    }

    static func gridView(_ b: UIView) -> UIView? { b.viewWithTag(AnnualScreen.monthGridTag) }

    /// 一格的状态摘要：框、读屏、墨（看得见时：点列的位型、墨色、线宽、内边；是否自己 KVO）、衬底字（字、颜色、内边、框）。
    struct Digest: Equatable, CustomStringConvertible {
        var frame: CGRect
        var ax: Bool
        var inkHidden: Bool
        var inkFrame: CGRect
        var inkPoints: Int
        var inkHash: Int
        var inkColor: String
        var widthScale: UInt64
        var pad: UInt64
        var watches: Bool
        var glyphHidden: Bool
        var glyphFrame: CGRect
        var glyphChar: String
        var glyphColor: String
        var glyphPad: CGFloat

        var description: String {
            "frame=\(frame) ink=\(inkHidden)/\(inkPoints)/\(inkColor)/\(widthScale) glyph=\(glyphHidden)/\(glyphChar)/\(glyphColor)"
        }
    }

    static func digest(_ s: AnnualScreen.CellSlot, _ traits: UITraitCollection) -> Digest {
        let ink = s.ink, g = s.glyph
        var h = Hasher()
        var count = 0
        if !ink.isHidden {
            for st in ink.points {
                h.combine(st.count)
                for p in st {
                    h.combine(p.x.bitPattern)
                    h.combine(p.y.bitPattern)
                    h.combine(p.w?.bitPattern)
                    h.combine(p.t?.bitPattern)
                    h.combine(p.p?.bitPattern)
                    count += 1
                }
            }
        }
        let hash = ink.isHidden ? 0 : h.finalize()
        return Digest(frame: s.cell.frame, ax: s.cell.isAccessibilityElement, inkHidden: ink.isHidden, inkFrame: ink.frame,
                      inkPoints: count, inkHash: hash, inkColor: ink.isHidden ? "-" : libraryColorKey(ink.inkColor.resolvedColor(with: traits)),
                      widthScale: ink.widthScale.bitPattern, pad: Double(ink.pad).bitPattern, watches: ink.watchesScroll,
                      glyphHidden: g.isHidden, glyphFrame: g.frame, glyphChar: g.char,
                      glyphColor: libraryColorKey(g.color.resolvedColor(with: traits)), glyphPad: g.padRatio)
    }

    /// 视图树：每段的格网容器铺满按钮、它与格子都不吃点按（按钮本身是命中的视图），里面正好是这一段建出来的格子（按序号），没有多余的。
    static func hierarchyProblems(_ vc: AnnualScreen) -> [String] {
        let bs = buttons(vc)
        var want: [ObjectIdentifier: [UIView]] = [:]
        var out: [String] = []
        if bs.count != vc.grid.months.count { out.append("\(bs.count) month buttons, \(vc.grid.months.count) months") }
        for i in vc.cells.liveIndices {
            guard let s = vc.cells.slot(at: i), i < vc.grid.cellMonth.count, vc.grid.cellMonth[i] < bs.count,
                  let g = gridView(bs[vc.grid.cellMonth[i]]) else { out.append("\(i): no slot / month"); continue }
            want[ObjectIdentifier(g), default: []].append(s.cell)
        }
        for (mi, b) in bs.enumerated() {
            guard let g = gridView(b) else { out.append("month \(mi): no grid"); continue }
            let expected = want[ObjectIdentifier(g)] ?? []
            let have = g.subviews
            if have.count != expected.count || zip(have, expected).contains(where: { $0 !== $1 }) {
                out.append("month \(mi): \(have.count) cells in the grid, expected \(expected.count) in index order")
            }
            if g.frame != b.bounds { out.append("month \(mi): grid \(g.frame) != button bounds \(b.bounds)") }
            if g.isUserInteractionEnabled { out.append("month \(mi): grid takes touches (the button must be the hit view)") }
            for c in g.subviews where c.isUserInteractionEnabled { out.append("month \(mi): a cell takes touches"); break }
            let mid = CGPoint(x: b.bounds.midX, y: b.bounds.maxY - 40)
            if b.window != nil, !b.isHidden, b.hitTest(mid, with: nil) !== b { out.append("month \(mi): hit view in the grid is not the button") }
            if g.isAccessibilityElement { out.append("month \(mi): grid is an accessibility element") }
        }
        return out
    }

    /// 墨：建出来的格子里看得见的墨、今年首字与卷尾两格，在屏上的都已经「到了视口附近」（画了）；都不各自 KVO。
    static func inkProblems(_ vc: AnnualScreen, _ w: UIWindow) -> [String] {
        var out: [String] = []
        var inks: [(String, ShiziPointsInkView)] = []
        for i in vc.cells.liveIndices { if let s = vc.cells.slot(at: i) { inks.append(("\(i)", s.ink)) } }
        // 月段按钮以外的墨（今年首字、卷尾两格）
        func collect(_ v: UIView) {
            if let iv = v as? ShiziPointsInkView { inks.append((iv.superview?.accessibilityIdentifier ?? "ink", iv)) }
            for sub in v.subviews { collect(sub) }
        }
        for v in vc.content.subviews where !(v is ShiziRowButton) { collect(v) }
        for (name, ink) in inks {
            if ink.watchesScroll { out.append("\(name): watches contentOffset itself") }
            guard ink.window != nil, !ink.isHidden, ink.bounds.width > 0 else { continue }
            var hidden = false
            var cur: UIView? = ink
            while let c = cur { if c.isHidden { hidden = true }; cur = c.superview }
            if !hidden, ink.convert(ink.bounds, to: w).intersects(w.bounds), !ink.isNear { out.append("\(name): on screen but not drawn") }
        }
        return out
    }

    /// 滚到 y（夹在内容范围里），排版提交。
    static func scroll(_ vc: AnnualScreen, _ w: UIWindow, to y: CGFloat) {
        vc.scroll.contentOffset = CGPoint(x: 0, y: min(max(0, y), bottomOffset(vc)))
        LibraryBench.settle(w)
    }

    static func bottomOffset(_ vc: AnnualScreen) -> CGFloat { max(0, vc.scroll.contentSize.height - vc.scroll.bounds.height) }

    /// 页面里自己画的视图（墨、衬底字）。
    static func drawnViews(_ v: UIView) -> [UIView] {
        var out: [UIView] = []
        if v is ShiziPointsInkView || v is NativeGlyphView { out.append(v) }
        for s in v.subviews { out += drawnViews(s) }
        return out
    }
}

@MainActor
final class AnnualVirtualCellsTests: XCTestCase {
    /// 排版的框（grid）= 视图上的框：段按钮 / 月名 / 字数；全部建出来时每一格的框 = 以前逐格排的算法（列 × 格边、格网上沿 + 行 × 格边，
    /// 格网上沿 = 按钮高 − 下边距 28 − 行数 × 格边，独立地从视图量回来），content 坐标 = 框 + 按钮原点；只建一部分时，建出来的格子同样。
    func testFrameModelMatchesTheViews() throws {
        for n in [40, 300, 1200] {
            let payload = AnnualVirtual.payload(n)
            let all = AnnualVirtual.make(all: true), virt = AnnualVirtual.make(all: false)
            let wa = LibraryBench.host(all), wv = LibraryBench.host(virt)
            defer { LibraryBench.unhost(wa); LibraryBench.unhost(wv) }
            all.apply(payload: payload)
            virt.apply(payload: payload)
            LibraryBench.settle(wa)
            LibraryBench.settle(wv)
            let grid = all.grid
            XCTAssertEqual(grid.cells.count, n, "n=\(n)")
            let per = max(1, (n + 11) / 12) // AnnualBench.view：每月 per 格
            XCTAssertEqual(grid.months.count, (n + per - 1) / per, "n=\(n)")
            XCTAssertEqual(all.cells.liveIndices, Array(0..<n), "n=\(n): materialize-all builds every cell")
            XCTAssertEqual(virt.grid.cells, grid.cells, "n=\(n): same frame model on both pages")
            XCTAssertEqual(virt.grid.cellsInContent, grid.cellsInContent)
            if grid.cols == 8 { XCTAssertEqual(grid.cellSide, min(45, floor((LibraryBench.windowSize.width - 40) / 8)), "n=\(n)") }
            if n >= 1200 { XCTAssertLessThan(virt.cells.liveIndices.count, n, "n=\(n): only part of the months is built") }
            for vc in [all, virt] {
                let bs = AnnualVirtual.buttons(vc)
                XCTAssertEqual(bs.count, grid.months.count, "n=\(n)")
                for (mi, box) in grid.months.enumerated() where mi < bs.count {
                    XCTAssertEqual(bs[mi].frame, box.frame, "n=\(n) month \(mi)")
                    XCTAssertEqual(bs[mi].label.frame, box.nameFrame, "n=\(n) month \(mi) name")
                    XCTAssertEqual(bs[mi].valueLabel.frame, box.countFrame, "n=\(n) month \(mi) count")
                    XCTAssertEqual(bs[mi].label.frame.width, ceil(ShiziMineText.width(bs[mi].label.text ?? "", font: NativeType.song(size: vc.metrics.value("fs22"), weight: .medium))),
                                   "n=\(n) month \(mi): name width = the label's own text")
                }
                if let last = grid.months.last { XCTAssertEqual(grid.bottom, last.frame.maxY) }
                for i in vc.cells.liveIndices {
                    guard let s = vc.cells.slot(at: i) else { XCTFail("n=\(n) \(i): no slot"); continue }
                    let mi = grid.cellMonth[i], box = grid.months[mi], j = i - box.firstCell
                    XCTAssertTrue(j >= 0 && j < box.cellCount, "n=\(n) cell \(i) in month \(mi)")
                    let b = bs[mi]
                    let side = grid.cellSide, cols = grid.cols
                    let rows = Int(ceil(Double(box.cellCount) / Double(cols)))
                    let gridTop = b.bounds.height - 28 - CGFloat(rows) * side
                    let r = s.cell.frame
                    XCTAssertEqual(r, grid.cells[i], "n=\(n) cell \(i)")
                    XCTAssertEqual(r.minX, CGFloat(j % cols) * side, accuracy: 1e-9, "n=\(n) cell \(i) x")
                    XCTAssertEqual(r.minY, gridTop + CGFloat(j / cols) * side, accuracy: 1e-6, "n=\(n) cell \(i) y")
                    XCTAssertEqual(r.width, side)
                    XCTAssertEqual(r.height, side)
                    let inC = s.cell.convert(s.cell.bounds, to: vc.content)
                    XCTAssertEqual(inC.minY, grid.cellsInContent[i].minY, accuracy: 1e-6, "n=\(n) cell \(i) content y")
                    XCTAssertEqual(inC.minX, grid.cellsInContent[i].minX, accuracy: 1e-6, "n=\(n) cell \(i) content x")
                    XCTAssertEqual(s.ink.frame, s.cell.bounds)
                    XCTAssertEqual(s.glyph.frame, s.cell.bounds.insetBy(dx: side * 0.09, dy: side * 0.09))
                    XCTAssertEqual(s.glyph.char, grid.cellData[i].ch, "n=\(n) cell \(i): the char of this cell")
                }
                XCTAssertEqual(AnnualVirtual.hierarchyProblems(vc), [], "n=\(n)")
            }
        }
    }

    /// 打开时（滚动位置在顶）：可见框下沿往下 overscan 以内的格子都建出来了，更远的没建；overscan = max(2.5 屏, 8 行)。
    func testOverscanAtOpen() throws {
        let vc = AnnualVirtual.make(all: false)
        let w = LibraryBench.host(vc)
        defer { LibraryBench.unhost(w) }
        vc.apply(payload: AnnualVirtual.payload(1200))
        LibraryBench.settle(w)
        let h = vc.scroll.bounds.height
        XCTAssertEqual(vc.cells.overscan, max(h * AnnualScreen.overscanViewports, AnnualScreen.overscanRows * vc.grid.cellSide))
        let bottom = h + vc.cells.overscan
        let want = (0..<vc.grid.cells.count).filter { vc.grid.cellsInContent[$0].minY < bottom }
        XCTAssertEqual(vc.cells.liveIndices, want)
        XCTAssertGreaterThan(want.count, 0)
        XCTAssertLessThan(want.count, vc.grid.cells.count)
    }

    /// 整窗截图逐字节相同：只建一部分 vs 全部建出来，滚到顶 / 中间 / 底 / 一段的月名行被上沿切开的位置，浅 / 深。
    /// 两页同时开着（各一个窗口），每个位置各截一张就比（不攒截图）。
    func testVirtualizedPixelsMatchMaterializeAll() throws {
        for (n, ink) in [(1200, true), (300, false)] {
            let payload = AnnualVirtual.payload(n, ink: ink)
            let all = AnnualVirtual.make(all: true), virt = AnnualVirtual.make(all: false)
            let wa = LibraryBench.host(all), wv = LibraryBench.host(virt)
            defer { LibraryBench.unhost(wa); LibraryBench.unhost(wv) }
            for w in [wa, wv] { w.overrideUserInterfaceStyle = .light }
            all.apply(payload: payload)
            virt.apply(payload: payload)
            LibraryBench.settle(wa)
            LibraryBench.settle(wv)
            let bottom = AnnualVirtual.bottomOffset(virt)
            XCTAssertGreaterThan(bottom, virt.scroll.bounds.height * 3, "n=\(n): content is a few screens tall")
            let mid = virt.grid.months[virt.grid.months.count / 2]
            let offsets: [(String, CGFloat)] = [("top", 0), ("middle", (bottom / 2).rounded()), ("bottom", bottom), ("cut head", mid.frame.minY + 20)]
            for style in [UIUserInterfaceStyle.light, .dark] {
                for w in [wa, wv] {
                    w.overrideUserInterfaceStyle = style
                    LibraryBench.settle(w)
                }
                for (name, y) in offsets {
                    AnnualVirtual.scroll(all, wa, to: y)
                    AnnualVirtual.scroll(virt, wv, to: y)
                    XCTAssertEqual(all.scroll.contentOffset, virt.scroll.contentOffset)
                    let label = "annual n=\(n) \(ink ? "ink" : "glyph") \(style == .dark ? "dark" : "light") \(name)"
                    let a = try LibraryEq.stableSnapshot(wa, "\(label) all")
                    let b = try LibraryEq.stableSnapshot(wv, "\(label) virtual")
                    XCTAssertTrue(LibraryEq.same(a, b, label), label)
                    XCTAssertEqual(AnnualVirtual.hierarchyProblems(virt), [], label)
                    XCTAssertEqual(AnnualVirtual.inkProblems(virt, wv), [], label)
                    XCTAssertEqual(AnnualVirtual.inkProblems(all, wa), [], label)
                }
            }
        }
    }

    /// 墨与衬底字「没变不重画」：连收几份回包（同一份两次、每格都换了、再换回来）、再排一次版之后的截图 = 把墨与衬底字都强制重画后的截图
    /// = 新页面只收最后一份的截图；浅、深各一次（切外观后页面换新的颜色对象，墨与衬底字自己也标重画）。停在顶上与中间各比一次。
    func testNoStaleDrawingAfterReapplyAndStyleSwitch() throws {
        let p1 = AnnualVirtual.payload(600)
        let steps = [p1, p1, AnnualVirtual.changed(p1), p1]
        for at in [CGFloat(0), 0.5] {
            var shots: [LibraryEq.Shot] = []
            let styles: [UIUserInterfaceStyle] = [.light, .dark]
            do {
                let vc = AnnualVirtual.make(all: false)
                let w = LibraryBench.host(vc)
                defer { LibraryBench.unhost(w) }
                w.overrideUserInterfaceStyle = .light
                for p in steps {
                    vc.apply(payload: p)
                    LibraryBench.settle(w)
                    AnnualVirtual.scroll(vc, w, to: (AnnualVirtual.bottomOffset(vc) * at).rounded())
                }
                vc.view.setNeedsLayout()
                LibraryBench.settle(w)
                for style in styles {
                    w.overrideUserInterfaceStyle = style
                    LibraryBench.settle(w)
                    let seq = try LibraryEq.stableSnapshot(w, "annual \(at) \(style.rawValue) sequence")
                    for v in AnnualVirtual.drawnViews(vc.view) { v.setNeedsDisplay() }
                    LibraryBench.settle(w)
                    let forced = try LibraryEq.stableSnapshot(w, "annual \(at) \(style.rawValue) forced")
                    XCTAssertTrue(LibraryEq.same(seq, forced, "annual \(at) \(style.rawValue): sequence vs forced redraw"), "at \(at) \(style.rawValue): sequence vs forced redraw")
                    shots.append(seq)
                }
            }
            let vc2 = AnnualVirtual.make(all: false)
            let w2 = LibraryBench.host(vc2)
            defer { LibraryBench.unhost(w2) }
            w2.overrideUserInterfaceStyle = .light
            vc2.apply(payload: p1)
            LibraryBench.settle(w2)
            AnnualVirtual.scroll(vc2, w2, to: (AnnualVirtual.bottomOffset(vc2) * at).rounded())
            for (i, style) in styles.enumerated() {
                w2.overrideUserInterfaceStyle = style
                LibraryBench.settle(w2)
                let fresh = try LibraryEq.stableSnapshot(w2, "annual \(at) \(style.rawValue) fresh")
                let ok = i < shots.count && LibraryEq.same(shots[i], fresh, "annual \(at) \(style.rawValue): sequence vs fresh page")
                XCTAssertTrue(ok, "at \(at) \(style.rawValue): sequence vs fresh page")
            }
        }
    }

    /// 外观切换时池子里的格子：浅色下打开，(a) 格子全收进池子再切到深色（排版时从池子里拿回来重配）、
    /// (b) 滚远（顶上的格子进池子、别处复用）再切到深色、滚回顶。之后的截图 = 墨与衬底字都强制重画 = 新页面（同样先浅后深）；
    /// 每格的摘要 = 新配的；最后再全收进池子、一次 update 让每格正好回到原来的序号（内容不重配），画面仍 = 新页面。
    func testStyleSwitchWithPooledCells() throws {
        let payload = AnnualVirtual.payload(1200)
        let fresh = AnnualVirtual.make(all: false)
        let wf = LibraryBench.host(fresh)
        defer { LibraryBench.unhost(wf) }
        wf.overrideUserInterfaceStyle = .light
        fresh.apply(payload: payload)
        LibraryBench.settle(wf)
        wf.overrideUserInterfaceStyle = .dark
        LibraryBench.settle(wf)
        let ref = try LibraryEq.stableSnapshot(wf, "annual style fresh dark")
        for away in [false, true] {
            let vc = AnnualVirtual.make(all: false)
            let w = LibraryBench.host(vc)
            defer { LibraryBench.unhost(w) }
            w.overrideUserInterfaceStyle = .light
            vc.apply(payload: payload)
            LibraryBench.settle(w)
            let before = Dictionary(uniqueKeysWithValues: vc.cells.liveIndices.compactMap { i in vc.cells.slot(at: i).map { (i, ObjectIdentifier($0)) } })
            XCTAssertFalse(before.isEmpty)
            if away {
                AnnualVirtual.scroll(vc, w, to: vc.scroll.bounds.height * 6)
                XCTAssertFalse(vc.cells.liveIndices.contains(0), "the top cells went to the pool")
            } else {
                vc.cells.removeAll() // 格子全收进池子（离开窗口），切外观之后的排版按同一组序号拿回来
            }
            w.overrideUserInterfaceStyle = .dark
            LibraryBench.settle(w)
            if away { AnnualVirtual.scroll(vc, w, to: 0) }
            let what = away ? "scrolled away and back" : "all pooled"
            XCTAssertFalse(vc.cells.liveIndices.isEmpty, what)
            // 池子里的格子拿回来用了（同一个序号的另算出来打印：排版里先按未让出底栏的高建一次，序号不一定对得上）
            let pooled = Set(before.values)
            let reused = vc.cells.liveIndices.filter { i in vc.cells.slot(at: i).map { pooled.contains(ObjectIdentifier($0)) } ?? false }
            let sameIndex = reused.filter { i in vc.cells.slot(at: i).map { before[i] == ObjectIdentifier($0) } ?? false }
            print("[annual-style] \(what): live=\(vc.cells.liveIndices.count) reused=\(reused.count) sameIndex=\(sameIndex.count)")
            XCTAssertFalse(reused.isEmpty, "\(what): cells came back from the pool")
            let traits = vc.traitCollection
            XCTAssertEqual(traits.userInterfaceStyle, .dark)
            let problems = vc.cells.check(visible: vc.scroll.bounds) { AnnualVirtual.digest($0, traits) }
            XCTAssertEqual(Array(problems.prefix(5)), [], "\(what): \(problems.count) problem(s)")
            let seq = try LibraryEq.stableSnapshot(w, "annual style \(what)")
            for v in AnnualVirtual.drawnViews(vc.view) { v.setNeedsDisplay() }
            LibraryBench.settle(w)
            let forced = try LibraryEq.stableSnapshot(w, "annual style \(what) forced")
            XCTAssertTrue(LibraryEq.same(seq, forced, "annual style \(what): vs forced redraw"), "\(what): vs forced redraw")
            XCTAssertTrue(LibraryEq.same(seq, ref, "annual style \(what): vs fresh page"), "\(what): vs fresh page")
            // 再全收进池子、按此刻的滚动位置直接重建一次（一次 update：每格正好回到原来的序号，内容不重配）：画面不变
            let now = Dictionary(uniqueKeysWithValues: vc.cells.liveIndices.compactMap { i in vc.cells.slot(at: i).map { (i, ObjectIdentifier($0)) } })
            vc.cells.removeAll()
            vc.updateCells()
            LibraryBench.settle(w)
            let back = vc.cells.liveIndices.filter { i in vc.cells.slot(at: i).map { now[i] == ObjectIdentifier($0) } ?? false }
            XCTAssertEqual(back.count, now.count, "\(what): every cell came back from the pool at its own index")
            let again = try LibraryEq.stableSnapshot(w, "annual style \(what) pooled at the same index")
            XCTAssertTrue(LibraryEq.same(again, ref, "annual style \(what): pooled at the same index vs fresh page"), "\(what): pooled at the same index vs fresh page")
        }
    }

    /// 一步一步滚过整个年报（每步 0.37 屏往下，再每步 2.3 屏往上跳回顶）：每一步之后建出来的格子 = 逐个判断与可见框 ± overscan 相交的那些，
    /// 没有一个格子用在两处，每格的状态摘要 = 新建一格按同一序号配出来的；视图树按序号；屏上的墨都画了。
    /// 中途重收同一份回包（停在底部）、收一份小的回包（滚动位置不靠 UIScrollView 自己夹回，明确滚回顶）也一样。
    func testScrollStress() throws {
        for (n, ink) in [(1200, true), (300, false)] {
            let vc = AnnualVirtual.make(all: false)
            let w = LibraryBench.host(vc)
            defer { LibraryBench.unhost(w) }
            vc.apply(payload: AnnualVirtual.payload(n, ink: ink))
            LibraryBench.settle(w)
            let traits = vc.traitCollection
            func verify(_ what: String) {
                XCTAssertEqual(vc.cells.overscan, max(vc.scroll.bounds.height * AnnualScreen.overscanViewports, AnnualScreen.overscanRows * vc.grid.cellSide), what)
                let problems = vc.cells.check(visible: vc.scroll.bounds) { AnnualVirtual.digest($0, traits) }
                XCTAssertEqual(Array(problems.prefix(5)), [], "\(what): \(problems.count) problem(s)")
                XCTAssertEqual(AnnualVirtual.hierarchyProblems(vc), [], what)
                XCTAssertEqual(AnnualVirtual.inkProblems(vc, w), [], what)
            }
            verify("n=\(n) open")
            let h = vc.scroll.bounds.height, bottom = AnnualVirtual.bottomOffset(vc)
            var y: CGFloat = 0, steps = 0
            while y < bottom {
                y = min(bottom, y + h * 0.37)
                AnnualVirtual.scroll(vc, w, to: y)
                steps += 1
                verify("n=\(n) down y=\(y)")
            }
            XCTAssertGreaterThan(steps, 5)
            XCTAssertTrue(vc.cells.liveIndices.contains(n - 1), "n=\(n): the last cell is built at the bottom")
            if n >= 1200 { XCTAssertFalse(vc.cells.liveIndices.contains(0), "n=\(n): the first cells are gone at the bottom") }
            vc.apply(payload: AnnualVirtual.payload(n, ink: ink)) // 同一份再收一次（records / ink 变了的重拉），停在底部
            LibraryBench.settle(w)
            verify("n=\(n) reapply at bottom")
            while y > 0 {
                y = max(0, y - h * 2.3)
                AnnualVirtual.scroll(vc, w, to: y)
                verify("n=\(n) up y=\(y)")
            }
            XCTAssertTrue(vc.cells.liveIndices.contains(0))
            AnnualVirtual.scroll(vc, w, to: bottom)
            vc.apply(payload: AnnualVirtual.payload(40, ink: ink)) // 内容变短：格子按新的框重建
            LibraryBench.settle(w)
            verify("n=\(n) to 40, at whatever offset the scroll view kept")
            AnnualVirtual.scroll(vc, w, to: 0)
            verify("n=\(n) to 40")
            XCTAssertEqual(vc.cells.liveIndices, Array(0..<40))
            vc.apply(payload: AnnualVirtual.payload(n, ink: ink)) // 再变长（段数从 12 → 12，格子序号重叠）
            LibraryBench.settle(w)
            AnnualVirtual.scroll(vc, w, to: h * 3)
            verify("n=\(n) back to \(n)")
        }
    }

    /// 段数变了（按钮重建）：格子先收进池子，排版时放进新按钮的格网；之后照样每格的摘要 = 新配的。
    func testMonthCountChangeRebuildsIntoTheNewButtons() throws {
        let vc = AnnualVirtual.make(all: false)
        let w = LibraryBench.host(vc)
        defer { LibraryBench.unhost(w) }
        let traits = vc.traitCollection
        for n in [1200, 5, 700, 0, 300] {
            vc.apply(payload: AnnualVirtual.payload(n))
            LibraryBench.settle(w)
            AnnualVirtual.scroll(vc, w, to: 0)
            let problems = vc.cells.check(visible: vc.scroll.bounds) { AnnualVirtual.digest($0, traits) }
            XCTAssertEqual(Array(problems.prefix(5)), [], "n=\(n): \(problems.count) problem(s)")
            XCTAssertEqual(AnnualVirtual.hierarchyProblems(vc), [], "n=\(n)")
            XCTAssertEqual(vc.grid.cells.count, n)
        }
    }

    /// 渲染了一份新回包、还没排版时来了滚动（惯性滚动中重拉、底部时排版前的滚动位置变化）：建出来的格子不能留着旧的内容。
    /// 两条路：滚动回调（排版前不建格子）、直接 updateCells（用旧 grid 建的格子按旧 grid 记，排版后按新 grid 重配内容）。之后每格的摘要 = 新配的。
    func testScrollBetweenRenderAndLayoutKeepsNoStaleContent() throws {
        for direct in [false, true] {
            for ink in [true, false] {
                let vc = AnnualVirtual.make(all: false)
                let w = LibraryBench.host(vc)
                defer { LibraryBench.unhost(w) }
                let p1 = AnnualVirtual.payload(1200, ink: ink)
                vc.apply(payload: p1)
                LibraryBench.settle(w)
                let h = vc.scroll.bounds.height
                AnnualVirtual.scroll(vc, w, to: h * 2)
                vc.apply(payload: AnnualVirtual.changed(p1)) // 渲染了，排版还没来（apply 只标 setNeedsLayout）
                vc.scroll.contentOffset = CGPoint(x: 0, y: h * 6.3) // 滚过 overscan：新的格子要进来
                if direct { vc.updateCells() }
                LibraryBench.settle(w)
                let traits = vc.traitCollection
                let what = "\(direct ? "updateCells" : "scroll callback") \(ink ? "ink" : "glyph")"
                let problems = vc.cells.check(visible: vc.scroll.bounds) { AnnualVirtual.digest($0, traits) }
                XCTAssertEqual(Array(problems.prefix(5)), [], "\(what): \(problems.count) problem(s)")
                XCTAssertEqual(AnnualVirtual.hierarchyProblems(vc), [], what)
                XCTAssertEqual(AnnualVirtual.inkProblems(vc, w), [], what)
                // 再滚一段（排版之后的滚动照常建格子）
                AnnualVirtual.scroll(vc, w, to: h * 8.1)
                let after = vc.cells.check(visible: vc.scroll.bounds) { AnnualVirtual.digest($0, traits) }
                XCTAssertEqual(Array(after.prefix(5)), [], "\(what) then scroll: \(after.count) problem(s)")
            }
        }
    }
}

@MainActor
final class ShiziPointsInkRedrawTests: XCTestCase {
    private func pts(_ seed: Int) -> [[ShiziInkPoint]] {
        (0..<3).map { s in (0..<20).map { j in ShiziInkPoint(x: Double(j * 7 + s), y: Double(seed + j), w: j % 5 == 0 ? nil : 8.5, t: nil, p: nil) } }
    }

    /// 同一份点列（另一份按位相同的拷贝）、同一个颜色对象、按位相同的线宽 / 内边再设一次不标重画；
    /// 一个点、一个 w、±0、一个新的颜色对象（哪怕分量一样）、线宽 / 内边变了照旧标重画。
    func testSameValuesDoNotMarkForRedisplay() {
        let v = ShiziPointsInkView(frame: CGRect(x: 0, y: 0, width: 45, height: 45))
        let color = UIColor.red
        v.points = pts(1)
        v.inkColor = color
        v.widthScale = 1.5
        v.pad = 0.09
        XCTAssertTrue(v.layer.needsDisplay())
        v.layer.displayIfNeeded()
        XCTAssertFalse(v.layer.needsDisplay())
        v.points = pts(1)
        v.inkColor = color
        v.widthScale = 1.5
        v.pad = 0.09
        XCTAssertFalse(v.layer.needsDisplay(), "identical values: no redraw")
        func expectRedraw(_ what: String, _ change: () -> Void) {
            change()
            XCTAssertTrue(v.layer.needsDisplay(), what)
            v.layer.displayIfNeeded()
        }
        var moved = pts(1)
        moved[1][3] = ShiziInkPoint(x: moved[1][3].x, y: moved[1][3].y.nextUp, w: moved[1][3].w, t: nil, p: nil)
        expectRedraw("one y one ulp up") { v.points = moved }
        var noW = moved
        noW[2][7] = ShiziInkPoint(x: noW[2][7].x, y: noW[2][7].y, w: nil, t: nil, p: nil)
        expectRedraw("one w gone") { v.points = noW }
        var withT = noW
        withT[0][0] = ShiziInkPoint(x: withT[0][0].x, y: withT[0][0].y, w: withT[0][0].w, t: 3, p: nil)
        expectRedraw("one t added") { v.points = withT }
        var zero = withT
        zero[0][1] = ShiziInkPoint(x: 0, y: 0, w: nil, t: nil, p: nil)
        v.points = zero
        v.layer.displayIfNeeded()
        var negZero = zero
        negZero[0][1] = ShiziInkPoint(x: -0.0, y: 0, w: nil, t: nil, p: nil)
        expectRedraw("+0 → -0") { v.points = negZero }
        expectRedraw("one stroke fewer") { v.points = Array(negZero.dropLast()) }
        expectRedraw("same components, new color object") { v.inkColor = UIColor(red: 1, green: 0, blue: 0, alpha: 1) }
        expectRedraw("width scale") { v.widthScale = Double(1.5).nextUp }
        expectRedraw("pad") { v.pad = 0.12 }
        v.layer.displayIfNeeded()
        let nan = [[ShiziInkPoint(x: .nan, y: 1, w: nil, t: nil, p: nil)]]
        v.points = nan
        v.layer.displayIfNeeded()
        v.points = [[ShiziInkPoint(x: .nan, y: 1, w: nil, t: nil, p: nil)]]
        XCTAssertFalse(v.layer.needsDisplay(), "the same NaN bits: same drawing")
    }

    /// watchesScroll = false：不自己 KVO contentOffset，等页面调 refreshNear；resetNear 回到没画。缺省（true）照旧自己盯着。
    func testWatchesScrollOffLeavesItToThePage() {
        let host = UIViewController()
        let w = LibraryBench.host(host)
        defer { LibraryBench.unhost(w) }
        let sv = UIScrollView(frame: host.view.bounds)
        sv.contentSize = CGSize(width: sv.bounds.width, height: sv.bounds.height * 10)
        host.view.addSubview(sv)
        let far = CGRect(x: 10, y: sv.bounds.height * 5, width: 40, height: 40) // 离视口 4 屏多
        let watching = ShiziPointsInkView(frame: far)
        let driven = ShiziPointsInkView(frame: far)
        driven.watchesScroll = false
        sv.addSubview(watching)
        sv.addSubview(driven)
        XCTAssertFalse(watching.isNear)
        XCTAssertFalse(driven.isNear)
        sv.contentOffset = CGPoint(x: 0, y: far.minY - 100)
        XCTAssertTrue(watching.isNear, "KVO: drawn once it scrolls near")
        XCTAssertFalse(driven.isNear, "no KVO: left to the page")
        driven.refreshNear()
        XCTAssertTrue(driven.isNear)
        driven.layer.displayIfNeeded()
        driven.resetNear()
        XCTAssertFalse(driven.isNear)
        XCTAssertTrue(driven.layer.needsDisplay(), "reset clears what was drawn")
        sv.contentOffset = .zero
        driven.refreshNear()
        XCTAssertFalse(driven.isNear, "far away again: not drawn")
        driven.watchesScroll = true
        sv.contentOffset = CGPoint(x: 0, y: far.minY - 100)
        XCTAssertTrue(driven.isNear, "watching again")
    }
}
