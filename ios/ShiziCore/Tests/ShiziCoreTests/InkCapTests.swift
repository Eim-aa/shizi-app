import Foundation
import XCTest
@testable import ShiziCore

// 回放重采样的点数上限（InkMath.maxReplayPointsPerStroke / maxReplayPointsPerInk）：
//   · InkCapRefOld = 改动前的 catmullRom / buildStroke / resampleForReplay / decodeInkV4 / simplifyStroke 原样留作参照（只改了名字空间）；
//   · 合法输入（编码器产出的随机 v4 / v3 / v2、ink.json 夹具里的墨迹、长笔 / 快笔 / 格边 / 压力极端值）上新旧逐位相同；
//   · 手工做的放大（v4 的大变长整数 / 极小的 c、v2 的巨大整数坐标）：decodeInk 回 nil、resampleForReplay 每笔回空，且很快（先数后铺）；
//   · 真实笔迹离上限多远：编码器产出的 v3 一笔至多 23 段 × 167 + 1 = 3 842 点，36 笔至多 138 312 点；v4 的长笔见下面的用例。
// 常开用例几秒内；SHIZI_SCALE_BENCH=1 时放大，并跑到上限边上的整笔铺点。

/// 改动前的实现（逐字照抄）。
enum InkCapRefOld {
    static func catmullRom(_ points: [InkPoint], step: Double = InkParams.standard.step) -> [InkPoint] {
        if points.count < 2 { return points }
        var out: [InkPoint] = []
        let P = [points[0]] + points + [points[points.count - 1]]
        @inline(__always) func lerp(_ a: Double, _ b: Double, _ u: Double) -> Double { a + (b - a) * u }
        for i in 1..<(P.count - 2) {
            let a = P[i - 1], b = P[i], c = P[i + 1], d = P[i + 2]
            let nd = JSMath.max(1, (InkMath.hypot(c.x - b.x, c.y - b.y) / step).rounded(.up))
            let n = (nd.isFinite && nd < 1e8) ? Int(nd) : 0 // NaN：JS 的 j < NaN 一次也不进
            for j in 0..<n {
                let u = Double(j) / Double(n)
                let u2 = u * u
                let u3 = u2 * u
                let x = 0.5 * (2 * b.x + (-a.x + c.x) * u + (2 * a.x - 5 * b.x + 4 * c.x - d.x) * u2 + (-a.x + 3 * b.x - 3 * c.x + d.x) * u3)
                let y = 0.5 * (2 * b.y + (-a.y + c.y) * u + (2 * a.y - 5 * b.y + 4 * c.y - d.y) * u2 + (-a.y + 3 * b.y - 3 * c.y + d.y) * u3)
                let t = lerp(InkMath.num(b.t, 0), InkMath.num(c.t, 0), u)
                let hasP = InkMath.hasPressure(b) || InkMath.hasPressure(c)
                let hasW = b.w != nil && c.w != nil
                var q = InkPoint(x: x, y: y, t: t, order: InkPoint.orderXYTPW)
                if hasP { q.p = lerp(InkMath.num(b.p, 0), InkMath.num(c.p, 0), u) }
                if hasW { q.w = lerp(b.w!, c.w!, u) }
                out.append(q)
            }
        }
        out.append(points[points.count - 1])
        return out
    }

    static func buildStroke(_ raw: [InkPoint], options: InkOptions = InkOptions()) throws -> BuiltStroke {
        let k = try options.params()
        let base = k.base
        let final = options.final
        let m = InkMath.mergeSameTime(raw)
        if m.isEmpty { return BuiltStroke(points: [], v30: nil, dot: false, single: false, endK: 0, pressure: false) }
        let pressure = m.contains(where: InkMath.hasPressure)
        var fx = InkMath.OneEuro(k.euroMinCutoff, k.euroBeta, k.euroDCutoff)
        var fy = InkMath.OneEuro(k.euroMinCutoff, k.euroBeta, k.euroDCutoff)
        var f: [InkPoint] = m.map { r in
            var q = InkPoint(x: fx(r.x, r.t! / 1000), y: fy(r.y, r.t! / 1000), t: r.t, order: InkPoint.orderXYTP)
            if r.p != nil { q.p = r.p }
            return q
        }
        if final && m.count > 1 { f[f.count - 1] = m[m.count - 1] } // 抬笔锁尾到原始末点
        let p = catmullRom(f, step: k.step)
        let n = p.count
        var L = [Double](repeating: 0, count: n)
        if n > 1 { for i in 1..<n { L[i] = L[i - 1] + InkMath.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y) } }
        let len = L[n - 1]

        // 单点：直径 0.9 × 本体宽（D09）。有压力时本体宽按压力。
        if m.count == 1 || len == 0 {
            let last = p[n - 1]
            let body = InkMath.hasPressure(last) ? base * InkMath.pressureFactor(last.p!, k) : base
            var q = InkPoint(x: last.x, y: last.y, t: last.t, w: body * k.single, order: InkPoint.orderXYWTP)
            if InkMath.hasPressure(last) { q.p = last.p }
            return BuiltStroke(points: [q], v30: nil, dot: true, single: true, endK: q.w! / base, pressure: pressure)
        }

        let dot = final && len < k.dotLen
        let v30 = final ? InkMath.liftSpeed(m, window: k.window) : nil
        let vv = v30 ?? 0.5
        let kk = InkMath.clamp((vv - k.lo) / JSMath.max(1e-6, k.hi - k.lo), 0, 1)
        let endMin = k.endMinSlow + (k.endMinFast - k.endMinSlow) * kk
        let tap = JSMath.min(k.tapMax, len * k.tapRatio)

        var w = InkMath.hasPressure(p[0]) ? base * InkMath.pressureFactor(p[0].p!, k) : base
        var out: [InkPoint] = []
        out.reserveCapacity(n)
        for i in 0..<n {
            if i > 0 {
                let dt = (p[i].t ?? .nan) - (p[i - 1].t ?? .nan)
                if dt > 0 {
                    let target = InkMath.hasPressure(p[i])
                        ? base * InkMath.pressureFactor(p[i].p!, k) // D10：压力替代速度，不叠乘
                        : base * InkMath.speedFactor((L[i] - L[i - 1]) / dt, k)
                    w += (target - w) * (1 - JSMath.exp(-dt / k.tau))
                }
            }
            let s = L[i]
            var fct: Double
            if dot {
                let u = len != 0 ? s / len : 0
                fct = u < 0.5 ? 0.7 + (1.1 - 0.7) * (u / 0.5) : 1.1 + (0.9 - 1.1) * ((u - 0.5) / 0.5)
            } else {
                fct = s < 6 ? 0.85 + 0.23 * (s / 6) : s < 12 ? 1.08 - 0.08 * ((s - 6) / 6) : 1
                if final && kk > 0 && len - s < tap {
                    let u = (len - s) / tap
                    fct *= endMin + (1 - endMin) * u
                }
            }
            var q = InkPoint(x: p[i].x, y: p[i].y, t: p[i].t, w: w * fct, order: InkPoint.orderXYWTP)
            if InkMath.hasPressure(p[i]) { q.p = p[i].p }
            out.append(q)
        }
        return BuiltStroke(points: out, v30: v30, dot: dot, single: false, endK: out[n - 1].w! / base, pressure: pressure)
    }

    static func resampleForReplay(_ decoded: [[InkPoint]], step: Double = InkParams.standard.step) -> [[InkPoint]] {
        decoded.map { catmullRom($0, step: step) }
    }

    static func decodeInkV4(_ ink: JSValue, _ o: InkOptions) throws -> [[InkPoint]] {
        var opts = o
        opts.final = true
        return try (InkMath.decodeInkRaw(ink) ?? []).map { s in
            try buildStroke(s, options: opts).points.map { q in
                var out = InkPoint(x: q.x, y: q.y, t: q.t, w: q.w, order: InkPoint.orderXYWTP)
                if let p = q.p { out.p = p }
                return out
            }
        }
    }

    /// 改动前的 decodeInk：v4 走上面的 decodeInkV4；v3 / v2 的解码没改，直接用 InkMath.decodeInk。
    static func decodeInk(_ ink: JSValue?, options o: InkOptions = InkOptions()) throws -> [[InkPoint]]? {
        if InkMath.isInkV4(ink), let v4 = ink { return try decodeInkV4(v4, o) }
        if let v4 = ink, case .object(let obj) = v4, obj["v"] == .number(4) {
            return InkMath.decodeInkRaw(v4) == nil ? nil : try decodeInkV4(v4, o)
        }
        return try InkMath.decodeInk(ink, options: o)
    }

    static func simplifyStroke(_ points: [InkPoint], max maxV: Double? = nil, tolerance: InkMath.ToleranceSetting = .policyDefault, policy: JSObject? = nil) -> [InkPoint] {
        let maxN = InkMath.num(maxV, InkMath.policyNumber(policy, "inkMaxPointsPerStroke") ?? 24)
        let tol: InkMath.Tolerance?
        switch tolerance {
        case .policyDefault: tol = InkMath.defaultTolerance(policy)
        case .none: tol = nil
        case .value(let t): tol = t
        }
        guard let tolerance = tol else { return InkMath.thinStroke(points, max: maxN) }
        let pts = points
        let n = pts.count
        let cap = JSMath.max(2, maxN.rounded(.down))
        if n <= 2 { return pts }
        let txy = InkMath.num(tolerance.xy, 0.3) > 0 ? InkMath.num(tolerance.xy, 0.3) : 0.3
        let tw = InkMath.num(tolerance.w, 0.3) > 0 ? InkMath.num(tolerance.w, 0.3) : 0.3
        let tt = InkMath.num(tolerance.t, 24) > 0 ? InkMath.num(tolerance.t, 24) : 24
        var L = [0.0]
        for i in 1..<n { L.append(L[i - 1] + InkMath.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)) }
        func worst(_ a: Int, _ b: Int) -> InkMath.Seg {
            let A = pts[a], B = pts[b]
            let dx = B.x - A.x
            let dy = B.y - A.y
            let L2 = dx * dx + dy * dy
            let span = L[b] - L[a]
            let wa = InkMath.num(A.w, 0)
            let wb = InkMath.num(B.w, 0)
            let ta = InkMath.num(A.t)
            let tb = InkMath.num(B.t)
            var err = 0.0
            var at = -1
            var i = a + 1
            while i < b {
                let P = pts[i]
                let s = L2 > 0 ? InkMath.clamp(((P.x - A.x) * dx + (P.y - A.y) * dy) / L2, 0, 1) : 0
                let u = span > 0 ? (L[i] - L[a]) / span : Double(i - a) / Double(b - a)
                var e = InkMath.hypot(A.x + dx * s - P.x, A.y + dy * s - P.y) / txy
                e = JSMath.max(e, abs(wa + (wb - wa) * u - InkMath.num(P.w, 0)) / tw)
                if let ta = ta, let tb = tb, let tp = InkMath.num(P.t) { e = JSMath.max(e, abs(ta + (tb - ta) * u - tp) / tt) }
                if e > err {
                    err = e
                    at = i
                }
                i += 1
            }
            return InkMath.Seg(a: a, b: b, at: at, err: err)
        }
        // 回放核对：均匀 Catmull-Rom 在相邻段长悬殊处会冲出去，连线误差看不到——按回放公式逐段取样，量到原始折线的距离。
        let replayLimit = txy * InkMath.replayFactor
        let step = InkParams.standard.step
        func distToRange(_ x: Double, _ y: Double, _ a: Int, _ b: Int) -> Double {
            var best = Double.infinity
            var i = Swift.max(0, a - 1)
            let end = Swift.min(n - 1, b + 1)
            while i < end {
                let P = pts[i], Q = pts[i + 1]
                let dx = Q.x - P.x
                let dy = Q.y - P.y
                let L2 = dx * dx + dy * dy
                let s = L2 > 0 ? InkMath.clamp(((x - P.x) * dx + (y - P.y) * dy) / L2, 0, 1) : 0
                let d = InkMath.hypot(P.x + dx * s - x, P.y + dy * s - y)
                if d < best { best = d }
                i += 1
            }
            return best
        }
        func replayErr(_ segs: [InkMath.Seg], _ j: Int) -> Double {
            let g = segs[j]
            let A = pts[j > 0 ? segs[j - 1].a : g.a]
            let B = pts[g.a]
            let C = pts[g.b]
            let D = pts[j + 1 < segs.count ? segs[j + 1].b : g.b]
            let m = Int(JSMath.max(1, (InkMath.hypot(C.x - B.x, C.y - B.y) / step).rounded(.up)))
            var err = 0.0
            var k = 1
            while k < m {
                let u = Double(k) / Double(m)
                let u2 = u * u
                let u3 = u2 * u
                let x = 0.5 * (2 * B.x + (-A.x + C.x) * u + (2 * A.x - 5 * B.x + 4 * C.x - D.x) * u2 + (-A.x + 3 * B.x - 3 * C.x + D.x) * u3)
                let y = 0.5 * (2 * B.y + (-A.y + C.y) * u + (2 * A.y - 5 * B.y + 4 * C.y - D.y) * u2 + (-A.y + 3 * B.y - 3 * C.y + D.y) * u3)
                err = JSMath.max(err, distToRange(x, y, g.a, g.b) / replayLimit)
                k += 1
            }
            return err
        }
        func midIndex(_ a: Int, _ b: Int) -> Int {
            let half = (L[a] + L[b]) / 2
            var i = a + 1
            while i < b - 1 && L[i] < half { i += 1 }
            return i
        }
        var segs = [worst(0, n - 1)]
        segs[0].rep = replayErr(segs, 0)
        var count = 2.0
        while count < cap {
            var k = -1
            var score = 1.0
            for j in 0..<segs.count {
                let g = segs[j]
                if g.b - g.a < 2 { continue } // 没有内部点可插
                let e = JSMath.max(g.err, g.rep)
                if e > score {
                    score = e
                    k = j
                }
            }
            if k < 0 { break }
            let g = segs[k]
            let at = g.err > 1 && g.at > g.a ? g.at : midIndex(g.a, g.b)
            segs.replaceSubrange(k...k, with: [worst(g.a, at), worst(at, g.b)])
            var j = Swift.max(0, k - 1)
            while j <= Swift.min(segs.count - 1, k + 2) {
                segs[j].rep = replayErr(segs, j)
                j += 1
            }
            count += 1
        }
        var keep = [0]
        for g in segs { keep.append(g.b) } // segs 按位置有序
        return keep.map { pts[$0] }
    }
}

final class InkCapTests: XCTestCase {
    var bench: Bool { ProcessInfo.processInfo.environment["SHIZI_SCALE_BENCH"] == "1" }
    var scale: Int { bench ? 10 : 1 }

    func ri(_ r: inout InkRng, _ n: Int) -> Int { n <= 0 ? 0 : Swift.min(n - 1, Int(r.next() * Double(n))) }
    func pt(_ x: Double, _ y: Double, _ t: Double?, _ p: Double? = nil) -> InkPoint { InkPoint(x: x, y: y, t: t, p: p, order: InkPoint.orderXYTP) }

    /// 结果的逐位签名（抛错时是错误本身）。
    func outcome(_ f: () throws -> [[InkPoint]]?) -> String {
        do {
            guard let bits = inkBits(try f()) else { return "nil" }
            return "\(bits.count):" + bits.joined(separator: "|")
        } catch {
            return "throws \(error)"
        }
    }

    /// decodeInk 与改动前逐位相同；解得开时回放（resampleForReplay）也逐位相同，且没碰上限。
    func assertInkSame(_ ink: JSValue, _ label: String, options o: InkOptions = InkOptions(), file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(outcome { try InkMath.decodeInk(ink, options: o) }, outcome { try InkCapRefOld.decodeInk(ink, options: o) }, "\(label) decodeInk", file: file, line: line)
        guard let decoded = try? InkMath.decodeInk(ink, options: o) else { return }
        XCTAssertTrue(InkMath.replayFits(decoded, step: InkParams.standard.step), "\(label) fits", file: file, line: line)
        XCTAssertEqual(inkBits(InkMath.resampleForReplay(decoded)), inkBits(InkCapRefOld.resampleForReplay(decoded)), "\(label) resampleForReplay", file: file, line: line)
    }

    func assertBuiltSame(_ raw: [InkPoint], _ o: InkOptions, _ label: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let a = try InkMath.buildStroke(raw, options: o)
        let b = try InkCapRefOld.buildStroke(raw, options: o)
        XCTAssertEqual(inkBits([a.points]), inkBits([b.points]), "\(label) points", file: file, line: line)
        XCTAssertEqual(a.v30?.bitPattern, b.v30?.bitPattern, "\(label) v30", file: file, line: line)
        XCTAssertEqual(a.endK.bitPattern, b.endK.bitPattern, "\(label) endK", file: file, line: line)
        XCTAssertEqual([a.dot, a.single, a.pressure], [b.dot, b.single, b.pressure], "\(label) flags", file: file, line: line)
    }

    /// 旧 v2（0–1000 网格的整数坐标、宽 ×100、dt、可选 p ×100）。
    func randomV2(_ r: inout InkRng) -> JSValue {
        var s: [JSValue] = [], dt: [JSValue] = [], p: [JSValue] = []
        let pen = r.next() < 0.5
        for _ in 0..<(1 + ri(&r, 5)) {
            var row: [JSValue] = [], drow: [JSValue] = [], prow: [JSValue] = []
            for _ in 0..<(1 + ri(&r, 30)) {
                row.append(.number(Double(ri(&r, 1001))))
                row.append(.number(Double(ri(&r, 1001))))
                row.append(.number(Double(ri(&r, 256))))
                drow.append(.number(Double(ri(&r, 60))))
                prow.append(.number(Double(ri(&r, 101))))
            }
            s.append(.array(row))
            dt.append(.array(drow))
            p.append(.array(prow))
        }
        var o = JSObject([("v", .number(2)), ("c", .number(345)), ("s", .array(s)), ("dt", .array(dt))])
        if pen { o["p"] = .array(p) }
        return .object(o)
    }

    /// v4：每行是 encodeRawStrokes 的一行（x / y 以 0.1 单位），g 全 0。
    func v4Ink(_ rows: [[Double]], c: Double = 345) -> JSValue {
        let r: [JSValue] = rows.map { row in InkMath.rawRowToPacked(row).map { JSValue.string($0) } ?? JSValue.null }
        let g: [JSValue] = rows.map { _ in JSValue.number(0) }
        return .object(JSObject([("v", .number(4)), ("c", .number(c)), ("r", .array(r)), ("g", .array(g))]))
    }

    /// v2：每行是 [x, y, w, …]（0–1000 网格），没有 dt / p。
    func v2Ink(_ rows: [[Double]]) -> JSValue {
        let s: [JSValue] = rows.map { row in JSValue.array(row.map { JSValue.number($0) }) }
        return .object(JSObject([("v", .number(2)), ("c", .number(345)), ("s", .array(s))]))
    }

    /// body 跑完在 50 ms 内。
    func timed(_ label: String, file: StaticString = #filePath, line: UInt = #line, _ body: () -> Void) {
        let t0 = Date()
        body()
        let ms = Date().timeIntervalSince(t0) * 1000
        XCTAssertLessThan(ms, 50, "\(label) took \(ms) ms", file: file, line: line)
    }

    // MARK: 计数

    // replayPointCount 不铺点，但与 catmullRom 的点数逐个相等；上限边上正好卡住
    func testReplayPointCountIsExactlyTheCatmullRomCountAndStopsAtTheCap() {
        var r = InkRng(20261106)
        let steps: [Double] = [0.5, 1, 3, 5.5]
        for i in 0..<(200 * scale) {
            let s = randomStroke43(&r, pen: i % 3 == 0)
            for st in steps {
                XCTAssertEqual(InkMath.replayPointCount(s, step: st, limit: Int.max), InkMath.catmullRom(s, step: st).count, "#\(i) step \(st)")
            }
        }
        XCTAssertEqual(InkMath.replayPointCount([], step: 3, limit: 0), 0)
        XCTAssertEqual(InkMath.replayPointCount([pt(1, 2, 3)], step: 3, limit: 1), 1)
        XCTAssertNil(InkMath.replayPointCount([pt(1, 2, 3)], step: 3, limit: 0))
        XCTAssertNil(InkMath.replayPointCount([pt(1, 2, 3), pt(1, 2, 4)], step: 3, limit: 1))
        // 两点相距 3 × (N − 1)：正好铺 N 点（N − 1 段内点 + 末点）
        let cap = InkMath.maxReplayPointsPerStroke
        let atCap = [pt(0, 0, 0), pt(3 * Double(cap - 1), 0, 8)]
        let overCap = [pt(0, 0, 0), pt(3 * Double(cap - 1) + 1, 0, 8)]
        XCTAssertEqual(InkMath.replayPointCount(atCap, step: 3, limit: cap), cap)
        XCTAssertNil(InkMath.replayPointCount(overCap, step: 3, limit: cap))
        XCTAssertTrue(InkMath.replayFits([atCap], step: 3))
        XCTAssertFalse(InkMath.replayFits([overCap], step: 3))
        // 一份的合计：N + N + (上限 − 2N) 正好到顶，再多一点就超
        let rest = InkMath.maxReplayPointsPerInk - 2 * cap
        XCTAssertGreaterThan(rest, 1)
        let restStroke = [pt(0, 0, 0), pt(3 * Double(rest - 1), 0, 8)]
        XCTAssertEqual(InkMath.replayPointCount(restStroke, step: 3, limit: Int.max), rest)
        XCTAssertTrue(InkMath.replayFits([atCap, atCap, restStroke], step: 3))
        XCTAssertTrue(InkMath.replayFits([atCap, [], atCap, restStroke, []], step: 3))
        XCTAssertFalse(InkMath.replayFits([atCap, atCap, restStroke, [pt(1, 1, 1)]], step: 3))
        // 段长不是有限数（坐标溢出 / NaN）、step 不是正数：当铺不出
        XCTAssertNil(InkMath.replayPointCount([pt(0, 0, 0), pt(.infinity, 0, 1)], step: 3, limit: cap))
        XCTAssertNil(InkMath.replayPointCount([pt(-1.7e308, 0, 0), pt(1.7e308, 0, 1)], step: 3, limit: cap))
        XCTAssertNil(InkMath.replayPointCount([pt(0, 0, 0), pt(.nan, 0, 1)], step: 3, limit: cap))
        XCTAssertNil(InkMath.replayPointCount([pt(0, 0, 0), pt(1, 0, 1)], step: 0, limit: cap))
    }

    // MARK: 合法输入：新旧逐位相同

    // 编码器产出的随机 v4 / v3 / v2（手指 / Pencil、出格、偶尔大跳、长停顿；自定义笔锋参数），以及 buildStroke / simplifyStroke 本身
    func testRandomEncoderInkDecodesAndReplaysBitForBitLikeBefore() throws {
        var r = InkRng(20261107)
        let custom = InkOptions(overrides: ["step": 1, "base": 9])
        for i in 0..<(60 * scale) {
            var strokes: [[InkPoint]] = []
            var t0 = r.next() * 1e6
            for _ in 0..<(1 + ri(&r, 6)) {
                let s = randomStroke43(&r, pen: r.next() < 0.4, t0: t0)
                t0 = (s.last?.t ?? t0) + r.next() * 800
                strokes.append(s)
            }
            let v4 = InkMath.encodeInkRaw(strokes, maxStrokes: 1e6)
            assertInkSame(v4, "random v4 #\(i)")
            if i % 4 == 0 { assertInkSame(v4, "random v4 custom #\(i)", options: custom) }
            var built: [[InkPoint]] = []
            for (k, s) in strokes.enumerated() {
                try assertBuiltSame(s, InkOptions(final: true), "built #\(i).\(k)")
                if k == 0 { try assertBuiltSame(s, InkOptions(final: false), "live #\(i).\(k)") }
                built.append(try InkMath.buildStroke(s, options: InkOptions(final: true)).points)
            }
            for (k, b) in built.enumerated() {
                XCTAssertEqual(inkBits([InkMath.simplifyStroke(b)]), inkBits([InkCapRefOld.simplifyStroke(b)]), "simplify #\(i).\(k)")
            }
            assertInkSame(try InkMath.encodeInk(built), "random v3 #\(i)")
            assertInkSame(randomV2(&r), "random v2 #\(i)")
        }
    }

    // ink.json 金标准夹具里的输入（decodeInk 的墨迹、resampleForReplay 的点列、buildStroke 的原始点）
    func testInkFixtureInputsAreUnchanged() throws {
        let doc = try loadFixture("ink")
        var inks = 0, replays = 0, builds = 0
        for group in doc["groups"]?.arrayValue ?? [] {
            for c in group["cases"]?.arrayValue ?? [] {
                guard let op = c["op"]?.stringValue, let args = c["args"]?.objectValue else { continue }
                let label = "\(op) #\(inks + replays + builds)"
                if op == "ink.decodeInk" {
                    assertInkSame(args["ink"] ?? .null, label, options: InkOptions(js: args))
                    inks += 1
                } else if op == "ink.resampleForReplay" {
                    let decoded: [[InkPoint]] = (args["decoded"]?.arrayValue ?? []).map { s in (s.arrayValue ?? []).compactMap { InkPoint(js: $0) } }
                    let st = args["step"]?.numberValue ?? InkParams.standard.step
                    XCTAssertTrue(InkMath.replayFits(decoded, step: st), label)
                    XCTAssertEqual(inkBits(InkMath.resampleForReplay(decoded, step: st)), inkBits(InkCapRefOld.resampleForReplay(decoded, step: st)), label)
                    replays += 1
                } else if op == "ink.buildStroke" {
                    let raw: [InkPoint] = (args["raw"]?.arrayValue ?? []).compactMap { InkPoint(js: $0) }
                    let o = InkOptions(js: args)
                    XCTAssertEqual(outcome { try [InkMath.buildStroke(raw, options: o).points] }, outcome { try [InkCapRefOld.buildStroke(raw, options: o).points] }, label)
                    builds += 1
                }
            }
        }
        XCTAssertGreaterThan(inks, 20)
        XCTAssertGreaterThan(replays, 10)
    }

    // 极端但真实：Pencil 240 Hz 长时间满格乱划、超快来回、格边 / 出格、压力极端值；编码器产出的 v3 最坏情形（每段都是整格对角线）
    func testLongFastEdgeAndPressureExtremesAreUnchangedAndFarBelowTheCap() throws {
        // 长笔：240 Hz 连写 secs 秒，满格来回，速度到约 4 单位 / ms（笔锋的速度上限是 1.5）
        let secs = bench ? 60.0 : 20.0
        var long: [InkPoint] = []
        var t = 0.0
        while t < secs * 1000 {
            long.append(pt(172.5 + 172.5 * sin(t / 41), 172.5 + 160 * sin(t / 97 + 1), 1000 + t, 0.2 + 0.7 * abs(sin(t / 300))))
            t += 1000.0 / 240
        }
        let longInk = InkMath.encodeInkRaw([long], maxStrokes: 36)
        assertInkSame(longInk, "long stroke")
        try assertBuiltSame(long, InkOptions(final: false), "long stroke live")
        let longCount = try XCTUnwrap(try InkMath.decodeInk(longInk)).first?.count ?? 0
        XCTAssertGreaterThan(longCount, long.count)
        XCTAssertLessThan(longCount * 2, InkMath.maxReplayPointsPerStroke, "a \(secs) s full-grid scribble at 240 Hz: \(longCount) points")

        // 超快来回：每 4 ms 在格外两角之间跳（一段约 630 单位）
        var fast: [InkPoint] = []
        for k in 0..<300 {
            let c = k % 2 == 0 ? -50.0 : 395.0
            fast.append(pt(c, k % 4 < 2 ? c : 345 - c, Double(k) * 4))
        }
        let back: [InkPoint] = fast.reversed().map { q in pt(q.x, q.y, 2000 - (q.t ?? 0)) }
        assertInkSame(InkMath.encodeInkRaw([fast, back], maxStrokes: 36), "fast scribble")
        try assertBuiltSame(fast, InkOptions(final: true), "fast scribble built")

        // 格边、出格、单点、零长、压力极端值（1e-9、> 1、0）
        let edges: [[InkPoint]] = [
            [pt(0, 0, 0), pt(345, 0, 8), pt(345, 345, 16), pt(0, 345, 24), pt(0, 0, 32)],
            [pt(-345, -345, 40), pt(690, 690, 44)],
            [pt(100, 100, 50)],
            [pt(5, 5, 60), pt(5, 5, 70)],
            [pt(10, 10, 80, 1e-9), pt(20, 12, 88, 1), pt(30, 15, 96, 7), pt(40, 15, 104, 0), pt(345, 345, 112, 0.0005), pt(0, 345, 120, 0.9999)],
        ]
        assertInkSame(InkMath.encodeInkRaw(edges, maxStrokes: 36), "edges v4")
        var builtEdges: [[InkPoint]] = []
        for (k, s) in edges.enumerated() {
            try assertBuiltSame(s, InkOptions(final: true), "edges built \(k)")
            builtEdges.append(try InkMath.buildStroke(s, options: InkOptions(final: true)).points)
        }
        assertInkSame(try InkMath.encodeInk(builtEdges), "edges v3")

        // v3 最坏情形：36 笔 × 24 点，每段都是 (0,0) ↔ (1023,1023) 的整格对角线：一笔 23 × 167 + 1 = 3 842 点，一份 138 312 点
        var corners: [[InkPoint]] = []
        for s in 0..<36 {
            var st: [InkPoint] = []
            for k in 0..<24 {
                let c = k % 2 == 0 ? 0.0 : 400.0
                st.append(InkPoint(x: c, y: c, t: Double(s * 1000 + k * 16), w: 11.5, order: InkPoint.orderXYWTP))
            }
            corners.append(st)
        }
        let worstV3 = try InkMath.encodeInk(corners, options: InkMath.EncodeOptions(maxPoints: 24, maxStrokes: 36, tolerance: .none))
        let worst = try XCTUnwrap(try InkMath.decodeInk(worstV3))
        XCTAssertEqual(worst.count, 36)
        var total = 0
        for s in worst {
            let n = InkMath.replayPointCount(s, step: InkParams.standard.step, limit: Int.max)
            XCTAssertEqual(n, 23 * 167 + 1)
            total += n ?? 0
        }
        XCTAssertEqual(total, 138_312)
        XCTAssertLessThan(23 * 167 + 1, InkMath.maxReplayPointsPerStroke / 50)
        XCTAssertLessThan(total, InkMath.maxReplayPointsPerInk)
        assertInkSame(worstV3, "v3 worst case")
    }

    // MARK: 手工做的放大：很快回 nil / 空，不铺点

    func testCraftedAmplifyingInkIsRejectedQuickly() throws {
        // v4：大变长整数（Δx = 2e9 × 0.1 单位 = 2e8 单位，一段 6.7e7 点：在原先 1e8 的守卫之下，原先真会铺出来，几个 GB）
        let big = v4Ink([[3, 0, 0, 0, 2e9, 0, 8, 0, 2e9, 8]])
        XCTAssertTrue(InkMath.isInkV4(big), "shape is valid (backup import accepts it)")
        XCTAssertEqual(InkMath.decodeInkRaw(big)?.first?.count, 3, "raw points still decode (size follows the input)")
        timed("v4 big varint") { XCTAssertNil(try InkMath.decodeInk(big)) }
        // 只超一笔的上限一点点：同样 nil
        let justOver = v4Ink([[3, 0, 0, 0, 30 * Double(InkMath.maxReplayPointsPerStroke - 1) + 1, 0, 8]])
        XCTAssertTrue(InkMath.isInkV4(justOver))
        timed("v4 just over the stroke cap") { XCTAssertNil(try InkMath.decodeInk(justOver)) }
        // 前面的笔正常、后面一笔放大：整份 nil
        let lines = try XCTUnwrap(InkMath.encodeInkRaw([inkLine43(), inkLine43(y: 100)], maxStrokes: 36).objectValue)
        var mixed = lines
        mixed["r"] = .array((lines["r"]?.arrayValue ?? []) + (big["r"]?.arrayValue ?? []))
        mixed["g"] = .array((lines["g"]?.arrayValue ?? []) + [JSValue.number(0)])
        let mixedInk = JSValue.object(mixed)
        XCTAssertTrue(InkMath.isInkV4(mixedInk))
        timed("v4 one bad stroke") { XCTAssertNil(try InkMath.decodeInk(mixedInk)) }

        // v4：极小的 c（坐标 × 345 / c）
        let tinyCs: [Double] = [1e-2, 1e-4, 1e-8]
        for c in tinyCs {
            var o = lines
            o["c"] = .number(c)
            let ink = JSValue.object(o)
            XCTAssertTrue(InkMath.isInkV4(ink))
            timed("v4 c = \(c)") { XCTAssertNil(try InkMath.decodeInk(ink)) }
        }
        var overflow = lines
        overflow["c"] = .number(1e-300) // 坐标大到溢出：要么解不开，要么坏点被丢、没有点可铺
        let overflowInk = JSValue.object(overflow)
        timed("v4 c = 1e-300") {
            let got = try? InkMath.decodeInk(overflowInk)
            XCTAssertTrue((got ?? []).allSatisfy { $0.isEmpty })
        }

        // v2：巨大整数坐标（形状合法；解码本身随输入长度，回放才放大）。3e8 × 0.345 / 3 ≈ 3.5e7 点一段，也在原先的守卫之下
        let hugeCoords: [Double] = [3e8, 1e15, 1e300]
        for huge in hugeCoords {
            let v2 = v2Ink([[0, 0, 100, huge, 0, 100, 0, huge, 100]])
            XCTAssertTrue(InkMath.isInkV2(v2))
            let decoded = try XCTUnwrap(try InkMath.decodeInk(v2))
            XCTAssertEqual(decoded.map(\.count), [3])
            XCTAssertFalse(InkMath.replayFits(decoded, step: InkParams.standard.step))
            timed("v2 \(huge)") { XCTAssertEqual(InkMath.resampleForReplay(decoded).map(\.count), [0]) }
        }
        // v2：每笔都在一笔的上限内、合计超过一份的上限（只数不铺）
        let fat: [Double] = [0, 0, 100, 1_304_348, 0, 100] // 1 304 348 × 0.345 / 3 ≈ 150 000 点一笔
        let three = try XCTUnwrap(try InkMath.decodeInk(v2Ink([fat, fat, fat])))
        let four = try XCTUnwrap(try InkMath.decodeInk(v2Ink([fat, fat, fat, fat])))
        XCTAssertTrue(InkMath.replayFits(three, step: InkParams.standard.step))
        XCTAssertFalse(InkMath.replayFits(four, step: InkParams.standard.step))
        timed("v2 four fat strokes") { XCTAssertEqual(InkMath.resampleForReplay(four).map(\.count), [0, 0, 0, 0]) }

        // simplifyStroke（存储前抽点；旧数据迁移会喂进来）：巨大坐标原先 Int(_:) 会崩或空转上亿次，现在只是先拆那一段
        let wildXY: [(Double, Double)] = [(0, 0), (1e300, 0), (5, 5), (3e6, 1), (7, 7), (-1e300, 1e300), (1.7e308, -1.7e308), (9, 9)]
        var wild: [InkPoint] = []
        for (k, q) in wildXY.enumerated() { wild.append(InkPoint(x: q.0, y: q.1, t: Double(k), w: 10, order: InkPoint.orderXYWTP)) }
        timed("simplify wild") {
            let kept = InkMath.simplifyStroke(wild, max: 24, tolerance: .value(InkMath.Tolerance(xy: 0.3, w: 0.3, t: 24)))
            XCTAssertEqual(kept.first, wild.first)
            XCTAssertEqual(kept.last, wild.last)
            XCTAssertLessThanOrEqual(kept.count, wild.count)
        }
    }

    // MARK: 上限边上（要真铺出十几万到几十万点：只在 SHIZI_SCALE_BENCH=1 时跑）

    func testAtTheCapStillDecodesAndOneMoreIsRejected() throws {
        guard bench else { throw XCTSkip("set SHIZI_SCALE_BENCH=1") }
        let cap = InkMath.maxReplayPointsPerStroke
        // 回放正好 N 点
        let atCap = [pt(0, 0, 0), pt(3 * Double(cap - 1), 0, 8)]
        XCTAssertEqual(InkMath.resampleForReplay([atCap]).first?.count, cap)
        XCTAssertEqual(inkBits(InkMath.resampleForReplay([atCap])), inkBits(InkCapRefOld.resampleForReplay([atCap])))
        // v4 一笔：两点（抬笔锁尾到原始末点，Catmull-Rom 正好铺 ceil(段长 / 3) + 1 点）
        let atCapV4 = v4Ink([[3, 0, 0, 0, 30 * Double(cap - 1), 0, 8]])
        XCTAssertEqual(try InkMath.decodeInk(atCapV4)?.first?.count, cap)
        assertInkSame(atCapV4, "v4 at the stroke cap")
        // v4 一份：每笔 150 000 点，3 笔 = 450 000 解得开，4 笔超过 500 000 回 nil
        let row150k: [Double] = [3, 0, 0, 0, 4_499_970, 0, 8]
        let threeV4 = v4Ink([row150k, row150k, row150k])
        XCTAssertEqual(try InkMath.decodeInk(threeV4)?.map(\.count), [150_000, 150_000, 150_000])
        assertInkSame(threeV4, "v4 three fat strokes")
        XCTAssertNil(try InkMath.decodeInk(v4Ink([row150k, row150k, row150k, row150k])))
    }
}

// MARK: - 交给 App 按原始点回放的笔画（WriteModels.sheet / stored、QueryView.sheetStrokes、DetailView.cellInk）

/// 改动前的写法（逐字照抄；sheet 拆出了「已取出的墨迹」这一参数）。
enum InkSheetRefOld {
    static func sheetStrokes(_ state: JSValue?, _ record: JSValue?, dates: Dates) throws -> JSValue {
        let ink = QueryView.inkOf(state, record, dates: dates)
        let points = try InkMath.decodeInkRaw(ink) ?? InkMath.decodeInk(ink) ?? []
        return .array(points.map { .array($0.map { .array([.number($0.x), .number($0.y), .number($0.t ?? 0)] + ($0.p.map { [.number($0)] } ?? [])) }) })
    }

    static func cellInk(_ state: JSValue, _ r: JSValue, dates: Dates) throws -> (has: Bool, strokes: JSValue) {
        guard JS.truthy(r) else { return (false, JSValue.array([])) }
        let ink = QueryView.inkOf(state, r, dates: dates)
        guard let decoded = try InkMath.decodeInk(ink), !decoded.isEmpty else { return (false, JSValue.array([])) }
        let points = InkMath.decodeInkRaw(ink) ?? decoded
        return (true, JSValue.array(points.map { .array($0.map { .array([.number($0.x), .number($0.y), .number($0.t ?? 0)] + ($0.p.map { [.number($0)] } ?? [])) }) }))
    }

    static func sheet(ink: JSValue?, _ r: JSValue, policy: JSValue? = Config.policy) throws -> JSValue {
        if let ink {
            if let raw = InkMath.decodeInkRaw(ink) { return WriteModels.wire(raw) }
            if let decoded = try InkMath.decodeInk(ink) { return WriteModels.wire(decoded) }
        }
        return .array((RecentInk.page.recalledInk(r["id"], policy: policy).arrayValue ?? []).map { stroke in .array((stroke.arrayValue ?? []).map { p in
            .array([p["x"] ?? .null, p["y"] ?? .null, p["t"] ?? .null] + (p["p"]?.numberValue?.isFinite == true ? [p["p"]!] : []))
        }) })
    }

    static func stored(_ s: JSValue) -> [[InkPoint]] { InkMath.decodeRawStrokes((s["current"]?["strokes"]?.arrayValue ?? []).map { ($0.arrayValue ?? []).map { JS.number($0) } }) }
}

final class InkSheetCapTests: XCTestCase {
    let dates = Dates(timeZone: TimeZone(identifier: "Asia/Shanghai")!)
    let record = JSValue.object(JSObject([("id", .string("r1")), ("localDay", .string("2026-03-05"))]))

    func ri(_ r: inout InkRng, _ n: Int) -> Int { n <= 0 ? 0 : Swift.min(n - 1, Int(r.next() * Double(n))) }
    func pt(_ x: Double, _ y: Double, _ t: Double?, _ p: Double? = nil) -> InkPoint { InkPoint(x: x, y: y, t: t, p: p, order: InkPoint.orderXYTP) }

    func stateWith(_ ink: JSValue) -> JSValue {
        .object(JSObject([("ink", .object(JSObject([("2026-03", .object(JSObject([("r1", ink)])))])))]))
    }

    /// 会话现场：{current: {strokes: encodeRawStrokes 的行}}（WriteModels.stored 只读这一处）。
    func session(_ rows: [[Double]]) -> JSValue {
        let strokes: [JSValue] = rows.map { row in JSValue.array(row.map { JSValue.number($0) }) }
        return .object(JSObject([("current", .object(JSObject([("strokes", .array(strokes))])))]))
    }

    /// 三条墨迹路径与改动前逐字节相同。
    func assertSheetsSame(_ ink: JSValue, _ label: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let st = stateWith(ink)
        XCTAssertEqual(str(try QueryView.sheetStrokes(st, record, dates: dates)), str(try InkSheetRefOld.sheetStrokes(st, record, dates: dates)), "\(label) sheetStrokes", file: file, line: line)
        let a = try DetailView.cellInk(st, record, dates: dates)
        let b = try InkSheetRefOld.cellInk(st, record, dates: dates)
        XCTAssertEqual(a.has, b.has, "\(label) cellInk.has", file: file, line: line)
        XCTAssertEqual(str(a.strokes), str(b.strokes), "\(label) cellInk.strokes", file: file, line: line)
        XCTAssertEqual(str(try WriteModels.sheet(ink: ink, record)), str(try InkSheetRefOld.sheet(ink: ink, record)), "\(label) WriteModels.sheet", file: file, line: line)
    }

    /// 真实的笔（随机 + 240 Hz 满格长笔 + 快笔 + 格边 / 压力极端值）。
    func realisticStrokeSets(_ r: inout InkRng, count: Int) -> [[[InkPoint]]] {
        var sets: [[[InkPoint]]] = []
        for _ in 0..<count {
            var strokes: [[InkPoint]] = []
            var t0 = r.next() * 1e6
            for _ in 0..<(1 + ri(&r, 6)) {
                let s = randomStroke43(&r, pen: r.next() < 0.4, t0: t0)
                t0 = (s.last?.t ?? t0) + r.next() * 800
                strokes.append(s)
            }
            sets.append(strokes)
        }
        var long: [InkPoint] = []
        var lt = 0.0
        while lt < 20_000 {
            long.append(pt(172.5 + 172.5 * sin(lt / 41), 172.5 + 160 * sin(lt / 97 + 1), 1000 + lt, 0.2 + 0.7 * abs(sin(lt / 300))))
            lt += 1000.0 / 240
        }
        sets.append([long])
        var fast: [InkPoint] = []
        for k in 0..<300 {
            let c = k % 2 == 0 ? -50.0 : 395.0
            fast.append(pt(c, k % 4 < 2 ? c : 345 - c, Double(k) * 4))
        }
        sets.append([fast])
        sets.append([
            [pt(0, 0, 0), pt(345, 0, 8), pt(345, 345, 16), pt(0, 345, 24), pt(0, 0, 32)],
            [pt(-345, -345, 40), pt(690, 690, 44)],
            [pt(100, 100, 50)],
            [pt(5, 5, 60), pt(5, 5, 70)],
            [pt(10, 10, 80, 1e-9), pt(20, 12, 88, 1), pt(30, 15, 96, 7), pt(40, 15, 104, 0), pt(345, 345, 112, 0.0005), pt(0, 345, 120, 0.9999)],
        ])
        return sets
    }

    // replayBound 不小于回放实际铺出的点数（App 的 WebInk.buildStroke 与 InkMath.buildStroke 同一算法、同一参数表；滤波前后都核）
    func testReplayBoundIsAtLeastTheReplayCount() throws {
        var r = InkRng(20261108)
        var sets = realisticStrokeSets(&r, count: 150)
        // 再加大跳（偶尔一步 ±3000 单位）、同时刻、可带压力的笔
        for _ in 0..<40 {
            var s: [InkPoint] = []
            var x = 0.0, y = 0.0, t = 0.0
            for _ in 0..<(2 + ri(&r, 40)) {
                x += (r.next() - 0.5) * (r.next() < 0.2 ? 6000 : 20)
                y += (r.next() - 0.5) * (r.next() < 0.2 ? 6000 : 20)
                t += r.next() < 0.1 ? 0 : r.next() * 20
                let p: Double? = r.next() < 0.3 ? r.next() : nil
                s.append(pt(x, y, t, p))
            }
            sets.append([s])
        }
        let step = InkParams.standard.step
        for (i, strokes) in sets.enumerated() {
            // v4 解出来交给 App 的原始点也一样核
            var inputs = strokes
            if let raw = InkMath.decodeInkRaw(InkMath.encodeInkRaw(strokes, maxStrokes: 1e6)) { inputs += raw }
            for s in inputs {
                let bound = InkMath.replayBound(s, step: step)
                for final in [true, false] {
                    let n = try InkMath.buildStroke(s, options: InkOptions(final: final)).points.count
                    XCTAssertGreaterThanOrEqual(bound, Double(n), "set #\(i) final=\(final)")
                }
                XCTAssertGreaterThanOrEqual(bound, Double(InkMath.catmullRom(InkMath.mergeSameTime(s), step: step).count), "set #\(i) unfiltered")
            }
        }
        XCTAssertEqual(InkMath.replayBound([], step: 3), 0)
        XCTAssertEqual(InkMath.replayBound([pt(1, 1, 0)], step: 3), 2)
        XCTAssertEqual(InkMath.replayBound([pt(0, 0, 0), pt(.nan, 5, 1), pt(3, 4, 2)], step: 3), 4 + 7.0 / 3 * (1 + 1e-6))
        XCTAssertEqual(InkMath.replayBound([pt(0, 0, 0), pt(1, 0, 1)], step: 0), .infinity)
        XCTAssertFalse(InkMath.replayBoundFits([[pt(-1.7e308, 0, 0), pt(1.7e308, 0, 1)]]))
    }

    // 编码器产出的墨迹（v4 / v3 / 旧 v2）与会话现场：各路径与改动前逐字节相同，且都没碰上限
    func testRealisticInkThroughTheSheetPathsIsUnchanged() throws {
        var r = InkRng(20261109)
        let sets = realisticStrokeSets(&r, count: 60)
        for (i, strokes) in sets.enumerated() {
            let v4 = InkMath.encodeInkRaw(strokes, maxStrokes: 1e6)
            try assertSheetsSame(v4, "v4 #\(i)")
            var built: [[InkPoint]] = []
            for s in strokes { built.append(try InkMath.buildStroke(s, options: InkOptions(final: true)).points) }
            let v3 = try InkMath.encodeInk(built)
            try assertSheetsSame(v3, "v3 #\(i)")
            XCTAssertTrue(InkMath.replayBoundFits(try XCTUnwrap(InkMath.decodeInkRaw(v4))), "v4 #\(i) fits")
            XCTAssertTrue(InkMath.replayBoundFits(try XCTUnwrap(try InkMath.decodeInk(v3))), "v3 #\(i) fits")
            let s = session(InkMath.encodeRawStrokes(strokes))
            XCTAssertEqual(inkBits(WriteModels.stored(s)), inkBits(InkSheetRefOld.stored(s)), "session #\(i)")
        }
        // 旧 v2（0–1000 网格）
        for i in 0..<40 {
            var rows: [JSValue] = []
            for _ in 0..<(1 + ri(&r, 5)) {
                var row: [JSValue] = []
                for _ in 0..<(1 + ri(&r, 30)) {
                    row.append(.number(Double(ri(&r, 1001))))
                    row.append(.number(Double(ri(&r, 1001))))
                    row.append(.number(Double(ri(&r, 256))))
                }
                rows.append(.array(row))
            }
            try assertSheetsSame(.object(JSObject([("v", .number(2)), ("c", .number(345)), ("s", .array(rows))])), "v2 #\(i)")
        }
        // 没有墨迹 / 坏墨迹：同样逐字节相同
        try assertSheetsSame(.null, "null")
        try assertSheetsSame(.object(JSObject([("v", .number(4))])), "bad v4")
        // 编码器产出的 v3 最坏情形（36 笔 × 24 点，每段整格对角线）：bound 合计约 19.8 万，仍在一份的上限内
        var corners: [[InkPoint]] = []
        for s in 0..<36 {
            var st: [InkPoint] = []
            for k in 0..<24 {
                let c = k % 2 == 0 ? 0.0 : 400.0
                st.append(InkPoint(x: c, y: c, t: Double(s * 1000 + k * 16), w: 11.5, order: InkPoint.orderXYWTP))
            }
            corners.append(st)
        }
        let worstV3 = try InkMath.encodeInk(corners, options: InkMath.EncodeOptions(maxPoints: 24, maxStrokes: 36, tolerance: .none))
        let worst = try XCTUnwrap(try InkMath.decodeInk(worstV3))
        var total = 0.0
        for s in worst { total += InkMath.replayBound(s, step: InkParams.standard.step) }
        XCTAssertLessThan(total, Double(InkMath.maxReplayPointsPerInk))
        XCTAssertTrue(InkMath.replayBoundFits(worst))
        try assertSheetsSame(worstV3, "v3 worst case")
    }

    // 手工做的放大：各路径都很快给出空笔画（[]），不把巨大坐标交给 App
    func testCraftedInkGivesEmptySheetStrokesQuickly() throws {
        func v4Ink(_ rows: [[Double]], c: Double = 345) -> JSValue {
            let r: [JSValue] = rows.map { row in InkMath.rawRowToPacked(row).map { JSValue.string($0) } ?? JSValue.null }
            let g: [JSValue] = rows.map { _ in JSValue.number(0) }
            return .object(JSObject([("v", .number(4)), ("c", .number(c)), ("r", .array(r)), ("g", .array(g))]))
        }
        var tiny = try XCTUnwrap(InkMath.encodeInkRaw([inkLine43(), inkLine43(y: 100)], maxStrokes: 36).objectValue)
        tiny["c"] = .number(1e-4)
        let hugeRow: [JSValue] = [0, 0, 100, 1e15, 0, 100, 0, 1e15, 100].map { JSValue.number($0) }
        // 标签、墨迹、decodeInk 是否仍有结果（决定 cellInk.has：v4 解不开 → false；v2 解得开、只是回放放大 → true）
        let crafted: [(String, JSValue, Bool)] = [
            ("v4 big varint", v4Ink([[3, 0, 0, 0, 2e9, 0, 8, 0, 2e9, 8]]), false),
            ("v4 tiny c", JSValue.object(tiny), false),
            ("v2 huge coords", JSValue.object(JSObject([("v", .number(2)), ("c", .number(345)), ("s", .array([.array(hugeRow)]))])), true),
        ]
        for (label, ink, decodes) in crafted {
            let st = stateWith(ink)
            let t0 = Date()
            XCTAssertEqual(str(try QueryView.sheetStrokes(st, record, dates: dates)), "[]", label)
            XCTAssertEqual(str(try WriteModels.sheet(ink: ink, record)), "[]", label)
            let cell = try DetailView.cellInk(st, record, dates: dates)
            XCTAssertEqual(cell.has, decodes, label)
            XCTAssertEqual(str(cell.strokes), "[]", label)
            let ms = Date().timeIntervalSince(t0) * 1000
            XCTAssertLessThan(ms, 50, "\(label) took \(ms) ms")
        }
        // 会话现场：落盘的行只校验「每笔是数组」；一笔放大就整份当没有笔画
        let t1 = Date()
        let rows: [[Double]] = [[3, 10, 20, 0], [3, 0, 0, 0, 2e9, 0, 8, 0, 2e9, 8]]
        XCTAssertTrue(WriteModels.stored(session(rows)).isEmpty)
        XCTAssertEqual(WriteModels.stored(session([[3, 10, 20, 0]])).count, 1)
        let ms1 = Date().timeIntervalSince(t1) * 1000
        XCTAssertLessThan(ms1, 50, "session took \(ms1) ms")
    }
}
