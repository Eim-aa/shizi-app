import Foundation
import XCTest
@testable import ShiziCore

// 坏墨迹不崩（解码只回 nil / 跳过坏行）：
//   · InkRefOld = 改动前的 decodeRawStrokes / isRawStrokeRow / rawRowToPacked / decodeInkRaw 原样留作参照（只在参照本身不会崩的输入上跑）；
//   · 合法输入（编码器产出：随机笔画、空笔、单点、超长笔、极端坐标 / 时间）上新旧逐位相同；
//   · 变异（截断、翻位、插字节、长变长整数、坏 base64、巨大计数 / 坐标、长度不配）的 v2 / v3 / v4 在进程里解码一遍：不崩，且 v4 结果与参照逐位相同。
// 常开规模几秒内；SHIZI_SCALE_BENCH=1 时放大 10 倍。

/// 改动前的实现（逐字照抄，只改了名字空间）。首项 ≥ 2^63 / 相邻差溢出时会崩——调用方先确认输入在安全范围内。
enum InkRefOld {
    static func decodeRawStrokes(_ rows: [[Double]]) -> [[InkPoint]] {
        var out: [[InkPoint]] = []
        for row in rows {
            guard row.allSatisfy({ $0.isFinite && $0.rounded(.towardZero) == $0 }), let first = row.first else { continue }
            let stride = Int(first)
            if (first != 3 && first != 4) || (row.count - 1) % stride != 0 || row.count < 1 + stride { continue }
            var pts: [InkPoint] = []
            var t = 0.0
            var j = 1
            while j < row.count {
                t += row[j + 2]
                var q = InkPoint(x: row[j] / 10, y: row[j + 1] / 10, t: t, order: InkPoint.orderXYTP)
                if stride == 4 && row[j + 3] > 0 { q.p = row[j + 3] / 1000 }
                pts.append(q)
                j += stride
            }
            out.append(pts)
        }
        return out
    }

    static func isRawStrokeRow(_ row: [Double]) -> Bool {
        guard row.count >= 4, row.allSatisfy({ $0.isFinite && $0.rounded(.towardZero) == $0 }) else { return false }
        let stride = Int(row[0])
        return (row[0] == 3 || row[0] == 4) && row.count >= 1 + stride && (row.count - 1) % stride == 0
    }

    static func rawRowToPacked(_ row: [Double]) -> String? {
        guard isRawStrokeRow(row) else { return nil }
        let stride = Int(row[0])
        var bytes: [UInt8] = [UInt8(stride)]
        var px = 0.0, py = 0.0, pp = 0.0
        var j = 1
        while j < row.count {
            InkMath.pushVarint(&bytes, InkMath.zz(row[j] - px))
            InkMath.pushVarint(&bytes, InkMath.zz(row[j + 1] - py))
            InkMath.pushVarint(&bytes, JSMath.max(0, row[j + 2]))
            px = row[j]
            py = row[j + 1]
            if stride == 4 {
                InkMath.pushVarint(&bytes, InkMath.zz(row[j + 3] - pp))
                pp = row[j + 3]
            }
            j += stride
        }
        return InkMath.bytesToBase64(bytes)
    }

    static func decodeInkRaw(_ ink: JSValue?) -> [[InkPoint]]? {
        guard let rows = InkMath.inkRawRows(ink), let ink = ink, let c = ink["c"]?.numberValue, case .array(let g)? = ink["g"] else { return nil }
        let scale = InkMath.grid / c
        var offset = 0.0
        var out: [[InkPoint]] = []
        for (i, pts) in decodeRawStrokes(rows).enumerated() {
            offset += g[i].numberValue!
            let mapped: [InkPoint] = pts.map { q in
                var o = InkPoint(x: q.x * scale, y: q.y * scale, t: q.t! + offset, order: InkPoint.orderXYTP)
                if let p = q.p { o.p = p }
                return o
            }
            if let last = mapped.last { offset = last.t! }
            out.append(mapped)
        }
        return out
    }

    /// 改动前的 decodeInkV4（经参照 decodeInkRaw）。
    static func decodeInkV4(_ ink: JSValue) throws -> [[InkPoint]] {
        var opts = InkOptions()
        opts.final = true
        return try (decodeInkRaw(ink) ?? []).map { s in
            try InkMath.buildStroke(s, options: opts).points.map { q in
                var out = InkPoint(x: q.x, y: q.y, t: q.t, w: q.w, order: InkPoint.orderXYWTP)
                if let p = q.p { out.p = p }
                return out
            }
        }
    }

    /// 参照 isRawStrokeRow / rawRowToPacked 在这一行上不会崩：形状不合（守卫先返回）或首项在 Int 范围内且相邻差不溢出。
    static func packSafe(_ row: [Double]) -> Bool {
        guard row.count >= 4, row.allSatisfy({ $0.isFinite && $0.rounded(.towardZero) == $0 }) else { return true }
        return abs(row[0]) < 9.0e18 && row.allSatisfy { abs($0) < 4.0e307 }
    }

    /// 参照 decodeRawStrokes 在这一行上不会崩。
    static func decodeSafe(_ row: [Double]) -> Bool {
        guard row.allSatisfy({ $0.isFinite && $0.rounded(.towardZero) == $0 }), let first = row.first else { return true }
        return abs(first) < 9.0e18
    }
}

/// 点列的逐位签名（x / y / t / p / w 的位模式 + 键序）。
func inkBits(_ s: [[InkPoint]]?) -> [String]? {
    func b(_ d: Double?) -> String { d.map { String($0.bitPattern, radix: 16) } ?? "-" }
    return s.map { strokes in
        strokes.map { st in st.map { p in "\(b(p.x)) \(b(p.y)) \(b(p.t)) \(b(p.p)) \(b(p.w)) \(p.order.joined(separator: ","))" }.joined(separator: ";") }
    }
}

final class InkDecodeFuzzTests: XCTestCase {
    var scale: Int { ProcessInfo.processInfo.environment["SHIZI_SCALE_BENCH"] == "1" ? 10 : 1 }

    func ri(_ r: inout InkRng, _ n: Int) -> Int { n <= 0 ? 0 : Swift.min(n - 1, Int(r.next() * Double(n))) }
    func pick<T>(_ r: inout InkRng, _ a: [T]) -> T { a[ri(&r, a.count)] }

    /// 新旧在一组原始笔画上的全部比较（编码器产出 = 合法输入）。
    func assertSameAsReference(_ strokes: [[InkPoint]], _ label: String, build: Bool, file: StaticString = #filePath, line: UInt = #line) throws {
        let rows = InkMath.encodeRawStrokes(strokes)
        XCTAssertEqual(inkBits(InkMath.decodeRawStrokes(rows)), inkBits(InkRefOld.decodeRawStrokes(rows)), "\(label) decodeRawStrokes", file: file, line: line)
        for row in rows {
            XCTAssertEqual(InkMath.isRawStrokeRow(row), InkRefOld.isRawStrokeRow(row), "\(label) isRawStrokeRow", file: file, line: line)
            XCTAssertEqual(InkMath.rawRowToPacked(row), InkRefOld.rawRowToPacked(row), "\(label) rawRowToPacked", file: file, line: line)
        }
        let ink = InkMath.encodeInkRaw(strokes, maxStrokes: 1e6)
        XCTAssertEqual(inkBits(InkMath.decodeInkRaw(ink)), inkBits(InkRefOld.decodeInkRaw(ink)), "\(label) decodeInkRaw", file: file, line: line)
        if build {
            let got = try InkMath.decodeInk(ink)
            let want: [[InkPoint]]? = try InkMath.isInkV4(ink) ? InkRefOld.decodeInkV4(ink) : nil
            XCTAssertEqual(inkBits(got), inkBits(want), "\(label) decodeInk v4", file: file, line: line)
        }
    }

    // 合法输入：随机笔画（手指 / Pencil、出格、长停顿）与边界尺寸 / 极端值上，新旧逐位相同
    func testValidEncoderOutputDecodesBitForBitLikeTheOldDecoder() throws {
        var r = InkRng(20261105)
        for i in 0..<(150 * scale) {
            let n = 1 + ri(&r, 6)
            var strokes: [[InkPoint]] = []
            var t0 = r.next() * 1e6
            for _ in 0..<n {
                let s = randomStroke43(&r, pen: r.next() < 0.4, t0: t0)
                t0 = (s.last?.t ?? t0) + r.next() * 800
                strokes.append(s)
            }
            try assertSameAsReference(strokes, "random #\(i)", build: true)
        }
        let o = InkPoint.orderXYTP
        func pt(_ x: Double, _ y: Double, _ t: Double?, _ p: Double? = nil) -> InkPoint { InkPoint(x: x, y: y, t: t, p: p, order: o) }
        var long: [InkPoint] = []
        for k in 0..<5000 { long.append(pt(100 + 80 * sin(Double(k) / 40), 170 + 60 * cos(Double(k) / 55), Double(k) * 8.33, k % 7 == 0 ? 0 : Double(k % 100) / 100)) }
        let edges: [(String, [[InkPoint]], Bool)] = [
            ("no strokes", [], true),
            ("empty strokes only", [[], []], true),
            ("single point", [[pt(10, 20, 5)]], true),
            ("single pen point", [[pt(10, 20, 5, 0.5)]], true),
            ("single point no t", [[pt(10, 20, nil)]], true),
            ("empty between", [[pt(1, 2, 3), pt(4, 5, 6)], [], [pt(7, 8, 9)]], true),
            ("very long stroke", [long], true),
            ("negative / out of grid", [[pt(-500, -1, 0), pt(9000, 4000, 16), pt(-0.04, 0.04, 17)]], true),
            ("decreasing t", [[pt(1, 1, 100), pt(2, 2, 50), pt(3, 3, -1e9)]], true),
            ("huge t", [[pt(1, 1, 1e15), pt(2, 2, 1e15 + 8)], [pt(3, 3, 9e15)]], true),
            ("p extremes", [[pt(1, 1, 0, 1e-9), pt(2, 2, 1, 1), pt(3, 3, 2, 7), pt(4, 4, 3, -1)]], true),
            ("coords 1e6", [[pt(1e6, -1e6, 0), pt(-1e6, 1e6, 10)]], false),
            ("coords 1e12", [[pt(1e12, 3, 0), pt(-1e12, 3, 10)]], false),
            ("coords 1e300", [[pt(1e300, -1e300, 0), pt(-1e300, 1e300, 10)]], false),
            ("non-finite coords", [[pt(.nan, 1, 0), pt(.infinity, 2, 1)], [pt(1, 2, 3)]], true),
            ("coords overflow to inf", [[pt(1.7e308, -1.7e308, 0)]], false),
        ]
        for (label, strokes, build) in edges { try assertSameAsReference(strokes, label, build: build) }
    }

    // 原先会崩、现在回 nil / 跳过的输入（参照不能跑）
    func testFormerTrapInputsNowReturnNilOrSkip() {
        // 首项 ≥ 2^63：Int(first) 曾崩
        XCTAssertEqual(InkMath.decodeRawStrokes([[1e19, 1, 2, 3], [-1e300], [9.3e18, 0, 0, 0, 0], [3, 10, 20, 7]]).count, 1)
        XCTAssertEqual(inkBits(InkMath.decodeRawStrokes([[1e19, 1, 2, 3], [3, 10, 20, 7]])), inkBits(InkRefOld.decodeRawStrokes([[3, 10, 20, 7]])))
        XCTAssertFalse(InkMath.isRawStrokeRow([1e19, 1, 2, 3]))
        XCTAssertFalse(InkMath.isRawStrokeRow([-1e300, 1, 2, 3]))
        XCTAssertNil(InkMath.rawRowToPacked([1e19, 1, 2, 3]))
        // 相邻差溢出成 ±∞：pushVarint 曾 Int(NaN) 崩
        XCTAssertNil(InkMath.rawRowToPacked([3, 1e308, 0, 0, -1e308, 0, 0]))
        XCTAssertNil(InkMath.rawRowToPacked([3, 0, 1e308, 0, 0, -1e308, 0]))
        XCTAssertNil(InkMath.rawRowToPacked([4, 0, 0, 0, 1e308, 0, 0, 0, -1e308]))
        let ink = InkMath.encodeInkRaw([[InkPoint(x: 1e307, y: 0, t: 0, order: InkPoint.orderXYTP), InkPoint(x: -1e307, y: 0, t: 1, order: InkPoint.orderXYTP)]], maxStrokes: 36)
        XCTAssertEqual(ink["r"], JSValue.array([JSValue.null]))
        XCTAssertNil(InkMath.decodeInkRaw(ink))
        XCTAssertNil(try InkMath.decodeInk(ink))
    }

    // 会话现场 current.strokes 落盘只校验「每笔是数组」：首项过大的坏行过得了校验，打开书写页（快照）时曾在 decodeRawStrokes 崩
    func testCorruptPersistedSessionStrokesPassSchemaAndNoLongerTrapTheSnapshot() throws {
        let dates = Dates(timeZone: TimeZone(identifier: "Asia/Shanghai")!)
        let s = try SessionRules.createSession(id: .string("s1"), kind: .string("daily"), source: nil, queue: .array([.string("base:人")]), at: .number(1_790_000_000_000), dates: dates)
        let bad: JSValue = .array([
            .array([.number(1e19), .number(0), .number(0), .number(0)]),
            .array([.string("1e+30"), .number(1), .number(1), .number(1)]),
            .array([.number(3), .number(10), .number(20), .number(0)]),
        ])
        let poisoned = try SessionRules.withCurrent(s, JS.obj([("phase", .string("compare")), ("strokes", bad)]), at: nil)
        XCTAssertNil(Schema.validateSession(poisoned, slot: "A"), "schema accepts the corrupt rows (shape only)")
        let got = WriteModels.stored(poisoned)
        XCTAssertEqual(got.count, 1)
        XCTAssertEqual(got.first?.first?.x, 1)
        XCTAssertEqual(got.first?.first?.y, 2)
    }

    // MARK: 变异

    func mutateBytes(_ s: String, _ r: inout InkRng) -> String {
        var bytes = InkMath.base64ToBytes(s) ?? []
        switch ri(&r, 11) {
        case 0: if !bytes.isEmpty { bytes[ri(&r, bytes.count)] ^= UInt8(1 << ri(&r, 8)) }
        case 1: if !bytes.isEmpty { bytes[ri(&r, bytes.count)] = UInt8(ri(&r, 256)) }
        case 2: bytes = Array(bytes.prefix(ri(&r, bytes.count + 1)))
        case 3: bytes.insert(contentsOf: (0..<(1 + ri(&r, 8))).map { _ in UInt8(ri(&r, 256)) }, at: ri(&r, bytes.count + 1))
        case 4: bytes.insert(contentsOf: [UInt8](repeating: 0xFF, count: 1 + ri(&r, 12)), at: ri(&r, bytes.count + 1))
        case 5: if !bytes.isEmpty { bytes.remove(at: ri(&r, bytes.count)) }
        case 6: bytes += [UInt8](repeating: 0x80, count: 1 + ri(&r, 6))
        case 7: bytes += bytes
        case 8:
            var cs = Array(s)
            if !cs.isEmpty { cs.removeLast(1 + ri(&r, Swift.min(3, cs.count))) }
            return String(cs)
        case 9:
            var cs = Array(s)
            let junk: [Character] = ["=", "-", "_", "é", " ", "\u{0}", "*", "\u{301}", "😀"]
            if cs.isEmpty { cs = [pick(&r, junk)] } else { cs[ri(&r, cs.count)] = pick(&r, junk) }
            return String(cs)
        default: if !bytes.isEmpty { bytes[0] = UInt8(ri(&r, 8)) } // stride / 首字节
        }
        return InkMath.bytesToBase64(bytes)
    }

    static let wildNumbers: [Double] = [1e300, -1e300, 1e308, -1, 1.5, .nan, .infinity, -.infinity, 9.3e18, -0.0, 0, 1e-300, 4096, 2_147_483_648]

    func mutateStringArray(_ v: JSValue?, _ r: inout InkRng) -> JSValue {
        var a = v?.arrayValue ?? []
        switch ri(&r, 8) {
        case 0: if !a.isEmpty { a.remove(at: ri(&r, a.count)) }
        case 1:
            let extra: [JSValue] = [.string(""), .null, .number(1), .string("AAAA"), .string("AwAAAA=="), .array([])]
            a.insert(pick(&r, extra), at: ri(&r, a.count + 1))
        default: if !a.isEmpty { let i = ri(&r, a.count); a[i] = .string(mutateBytes(a[i].stringValue ?? "", &r)) }
        }
        return .array(a)
    }

    func mutateShared(_ o: inout JSObject, _ r: inout InkRng) -> Bool {
        switch ri(&r, 6) {
        case 0:
            let cs: [Double] = [1e-300, 0, -345, 1e300, .nan, .infinity, 3.45, 34.5, 1000]
            o["c"] = .number(pick(&r, cs))
        case 1:
            let versions: [JSValue] = [.number(2), .number(3), .number(4), .string("4"), .null, .number(4.0000001)]
            o["v"] = pick(&r, versions)
        default: return false
        }
        return true
    }

    func mutateV4(_ ink: JSValue, _ r: inout InkRng) -> JSValue {
        var o = ink.objectValue!
        for _ in 0..<(r.next() < 0.2 ? 3 : 1) {
            if mutateShared(&o, &r) { continue }
            switch ri(&r, 6) {
            case 0:
                var g = o["g"]?.arrayValue ?? []
                if r.next() < 0.3, !g.isEmpty { g.removeLast() } else if !g.isEmpty { g[ri(&r, g.count)] = .number(pick(&r, Self.wildNumbers)) }
                o["g"] = .array(g)
            default: o["r"] = mutateStringArray(o["r"], &r)
            }
        }
        return .object(o)
    }

    func mutateV3(_ ink: JSValue, _ r: inout InkRng) -> JSValue {
        var o = ink.objectValue!
        for _ in 0..<(r.next() < 0.2 ? 3 : 1) {
            if mutateShared(&o, &r) { continue }
            switch ri(&r, 7) {
            case 0: o["dt"] = .array([])
            case 1: o["p"] = r.next() < 0.5 ? JSValue.null : mutateStringArray(o["p"] ?? .array(o["s"]?.arrayValue ?? []), &r)
            case 2: // p 与 s 等长、逐笔字节数相同但内容任意（形状合法）
                o["p"] = JSValue.array((o["s"]?.arrayValue ?? []).map { s -> JSValue in
                    JSValue.string(InkMath.bytesToBase64((0..<((InkMath.base64ToBytes(s.stringValue ?? "")?.count ?? 0) / 4)).map { _ in UInt8(ri(&r, 256)) }))
                })
            default: o["s"] = mutateStringArray(o["s"], &r)
            }
        }
        return .object(o)
    }

    func mutateRows(_ v: JSValue?, _ r: inout InkRng) -> JSValue? {
        guard var rows = v?.arrayValue else { return r.next() < 0.5 ? nil : JSValue.array([.array([.number(1)])]) }
        if rows.isEmpty { return JSValue.array([.array([.number(1), .number(2), .number(3)])]) }
        let i = ri(&r, rows.count)
        var row = rows[i].arrayValue ?? []
        switch ri(&r, 6) {
        case 0: if !row.isEmpty { row.removeLast(1 + ri(&r, Swift.min(2, row.count))) }
        case 1: row.append(.number(Double(ri(&r, 1024))))
        case 2:
            let junk: [JSValue] = [.string("x"), .null, .number(3), .object(JSObject())]
            rows[i] = pick(&r, junk)
            return .array(rows)
        case 3: rows.remove(at: i); return .array(rows)
        default: if !row.isEmpty { row[ri(&r, row.count)] = .number(pick(&r, Self.wildNumbers)) }
        }
        rows[i] = .array(row)
        return .array(rows)
    }

    func mutateV2(_ ink: JSValue, _ r: inout InkRng) -> JSValue {
        var o = ink.objectValue!
        for _ in 0..<(r.next() < 0.2 ? 3 : 1) {
            if mutateShared(&o, &r) { continue }
            let key = pick(&r, ["s", "s", "dt", "p"])
            o[key] = mutateRows(o[key], &r)
        }
        return .object(o)
    }

    /// v4 经 buildStroke 的点数大致上限（坐标太大 / c 太小时 Catmull-Rom 会铺出上百万点；那是「慢 / 占内存」不是崩，这里不跑）。
    func v4BuildIsCheap(_ ink: JSValue) -> Bool {
        guard let rows = InkMath.inkRawRows(ink), let c = ink["c"]?.numberValue else { return true }
        // 估算 Catmull-Rom 铺出的点数：每段 ≈ 段长 / step(3) + 1（段长用 |Δx| + |Δy| 放大估）
        let s = InkMath.grid / c / 10
        var est = 0.0
        for row in rows {
            let k = Int(row[0])
            var j = 1
            while j + k < row.count {
                est += (abs(row[j + k] - row[j]) + abs(row[j + k + 1] - row[j + 1])) * s / 3 + 1
                j += k
            }
            est += 1
        }
        return est <= 200_000
    }

    func checkDecoded(_ ink: JSValue, _ label: String) throws {
        let v = ink["v"]
        let raw = InkMath.decodeInkRaw(ink)
        XCTAssertEqual(inkBits(raw), inkBits(InkRefOld.decodeInkRaw(ink)), "\(label) decodeInkRaw vs reference")
        XCTAssertEqual(raw != nil, InkMath.isInkV4(ink), "\(label) decodeInkRaw nil iff not v4")
        _ = InkMath.isInk(ink)
        _ = InkPick.inkHasStrokes(ink)
        if v == .number(4) {
            guard v4BuildIsCheap(ink) else { return }
            let got = try InkMath.decodeInk(ink)
            XCTAssertEqual(got == nil, raw == nil, "\(label) v4 decodeInk nil iff decodeInkRaw nil")
            if raw != nil {
                let want = try InkRefOld.decodeInkV4(ink)
                XCTAssertEqual(inkBits(got), inkBits(want), "\(label) decodeInk v4 vs reference")
            }
            return
        }
        if InkMath.isInkV4(ink) { return } // v 不是 4 的数（如 "4"）时 isInkV4 也不认；到不了这里
        let got = try InkMath.decodeInk(ink)
        if v == .number(3) {
            XCTAssertEqual(got != nil, InkMath.isInkV3(ink), "\(label) v3 decodeInk nil iff shape invalid")
            if let got = got {
                let counts = (ink["s"]?.arrayValue ?? []).map { (InkMath.base64ToBytes($0.stringValue ?? "")?.count ?? -4) / 4 }
                XCTAssertEqual(got.map(\.count), counts, "\(label) v3 point counts")
                XCTAssertTrue(got.allSatisfy { $0.allSatisfy { $0.x.isFinite && $0.y.isFinite && ($0.w?.isFinite ?? false) && ($0.t?.isFinite ?? false) } }, "\(label) v3 finite")
                _ = InkMath.resampleForReplay(got)
            }
        } else if v == .number(2) {
            XCTAssertEqual(got != nil, InkMath.isInkV2(ink), "\(label) v2 decodeInk nil iff shape invalid")
            if let got = got { XCTAssertEqual(got.map(\.count), (ink["s"]?.arrayValue ?? []).map { ($0.arrayValue?.count ?? -3) / 3 }, "\(label) v2 point counts") }
        } else {
            XCTAssertNil(got, "\(label) unknown version")
        }
    }

    func randomStrokes(_ r: inout InkRng) -> [[InkPoint]] {
        var strokes: [[InkPoint]] = []
        var t0 = r.next() * 1e5
        for _ in 0..<(1 + ri(&r, 5)) {
            let s = randomStroke43(&r, pen: r.next() < 0.4, n: 1 + ri(&r, 60), t0: t0)
            t0 = (s.last?.t ?? t0) + r.next() * 500
            strokes.append(s)
        }
        return strokes
    }

    // 变异过的 v4 / v3 / v2：一律不崩；v4 与参照逐位相同；v3 / v2 只在形状合法时有结果且点数对得上
    func testMutatedInkNeverTrapsAndMatchesTheReferenceWhereDefined() throws {
        var r = InkRng(77_20261105)
        let bases = 40 * scale, perBase = 25
        var decodedV4 = 0, decodedV3 = 0, decodedV2 = 0, total = 0
        for b in 0..<bases {
            let strokes = randomStrokes(&r)
            let v4 = InkMath.encodeInkRaw(strokes, maxStrokes: 36)
            var built: [[InkPoint]] = []
            for s in strokes { built.append(try InkMath.buildStroke(s, options: InkOptions(final: true)).points) }
            let v3 = try InkMath.encodeInk(built, options: InkMath.EncodeOptions(maxPoints: 24, maxStrokes: 36))
            var s2: [JSValue] = [], dt2: [JSValue] = [], p2: [JSValue] = []
            for _ in 0..<(1 + ri(&r, 4)) {
                let n = 1 + ri(&r, 20)
                s2.append(.array((0..<n).flatMap { _ in [JSValue.number(Double(ri(&r, 1024))), .number(Double(ri(&r, 1024))), .number(Double(ri(&r, 256)))] }))
                dt2.append(.array((0..<n).map { _ in .number(Double(ri(&r, 300))) }))
                p2.append(.array((0..<n).map { _ in .number(Double(ri(&r, 101))) }))
            }
            var o2 = JSObject([("v", .number(2)), ("c", .number(345)), ("s", .array(s2))])
            if r.next() < 0.7 { o2["dt"] = .array(dt2) }
            if r.next() < 0.5 { o2["p"] = .array(p2) }
            let v2 = JSValue.object(o2)
            for base in [v4, v3, v2] { try checkDecoded(base, "base #\(b)") }
            XCTAssertNotNil(try InkMath.decodeInk(v4)); XCTAssertNotNil(try InkMath.decodeInk(v3)); XCTAssertNotNil(try InkMath.decodeInk(v2))
            for m in 0..<perBase {
                let a = mutateV4(v4, &r), c = mutateV3(v3, &r), e = mutateV2(v2, &r)
                try checkDecoded(a, "v4 #\(b).\(m)")
                try checkDecoded(c, "v3 #\(b).\(m)")
                try checkDecoded(e, "v2 #\(b).\(m)")
                if InkMath.isInkV4(a) { decodedV4 += 1 }
                if InkMath.isInkV3(c) { decodedV3 += 1 }
                if InkMath.isInkV2(e) { decodedV2 += 1 }
                total += 3
            }
        }
        // 变异既有解得开的也有解不开的（不是全被形状判定挡掉）
        XCTAssertGreaterThan(decodedV4, 0); XCTAssertGreaterThan(decodedV3, 0); XCTAssertGreaterThan(decodedV2, 0)
        XCTAssertLessThan(decodedV4 + decodedV3 + decodedV2, total)
    }

    // 原始行变异：decodeRawStrokes / isRawStrokeRow / rawRowToPacked 不崩；参照能跑的地方逐位相同
    func testMutatedRawRowsNeverTrapAndMatchTheReferenceWhereItRuns() {
        var r = InkRng(31_20261105)
        for i in 0..<(1500 * scale) {
            var row = InkMath.encodeRawStrokes([randomStroke43(&r, pen: r.next() < 0.5, n: 1 + ri(&r, 12))]).first ?? [3, 0, 0, 0]
            for _ in 0..<(1 + ri(&r, 3)) {
                switch ri(&r, 6) {
                case 0:
                    let firsts: [Double] = [0, -3, 5, 1e15, 1e19, -1e19, 1e300, 3.5, .nan, 3, 4]
                    if !row.isEmpty { row[0] = pick(&r, firsts) }
                case 1: if !row.isEmpty { row[ri(&r, row.count)] = pick(&r, Self.wildNumbers) }
                case 2: if !row.isEmpty { row.removeLast(ri(&r, row.count + 1)) }
                case 3: row.append(Double(ri(&r, 2000)) - 1000)
                case 4:
                    let huge: [Double] = [1e308, -1e308, 4e307]
                    if row.count > 2 { row[1 + ri(&r, row.count - 1)] = pick(&r, huge) }
                default: row = []
                }
            }
            let got = InkMath.decodeRawStrokes([row])
            if InkRefOld.decodeSafe(row) { XCTAssertEqual(inkBits(got), inkBits(InkRefOld.decodeRawStrokes([row])), "row #\(i) \(row)") }
            let ok = InkMath.isRawStrokeRow(row), packed = InkMath.rawRowToPacked(row)
            if InkRefOld.packSafe(row) {
                XCTAssertEqual(ok, InkRefOld.isRawStrokeRow(row), "row #\(i) \(row)")
                XCTAssertEqual(packed, InkRefOld.rawRowToPacked(row), "row #\(i) \(row)")
            } else {
                XCTAssertTrue(packed == nil || ok, "row #\(i)")
            }
            if let p = packed, let back = InkMath.packedToRawRow(p) {
                // 打包时 dt 取 max(0, dt)；其余逐整数还原
                var want = row
                let k = Int(row[0])
                var j = 1
                while j + 2 < want.count { want[j + 2] = Swift.max(0, want[j + 2]); j += k }
                XCTAssertEqual(back, want, "row #\(i) round trip")
            }
        }
    }
}
