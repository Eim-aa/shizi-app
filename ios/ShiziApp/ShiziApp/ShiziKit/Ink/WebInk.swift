import Foundation

// 原生书写面的墨：与网页同一算法（R11-A，D72 ②）。
//
// 逐函数移植 src/core/ink-math.js：mergeSameTime → 1€ 滤波（oneEuro）→ 抬笔锁尾 → catmullRom（step 重采样，插值 t / p）
//   → buildStroke（速度因子 / 压力因子、τ 时间平滑、起笔 6 / 12 单位倍数、点画、收笔 liftSpeed + 收尖段）；
// 几何照 src/ui/canvas/brush.js paintBrushStroke：起点圆 + 每段「两点间四边形色带 + 末端圆」（半宽 max(0.5, w/2)），
//   同色不混合写入 = 并集（Metal 端见 NativeInkRenderer）。
// 参数一律由页面随 open 下发（write-api.js writeInk() = inkParams(policy)：policy.ink + INK_SPEC），本文件不写数值；
// 金标准：ShiziWriteTests/Fixtures/web-ink-golden.json（当年用网页 ink-math.js 生成，D84 起冻结、不再重生成），WebInkTests 逐点比。
// 不移植：网页的飞白 / 洇墨细节（brush.js detail：α ≤ .2 的虚线擦、α .11 的外晕），属笔锋细节、不改墨区与粗细，见 B2 架构文档 §12 R11-A。
//
// ink-model-1.0（InkModel.swift，速度 / 方向宽度剖面）保留作 T2 盲测候选，不在产品路径上（只有 DEBUG 的 NativeInkSpike 还用它）。

/// buildStroke 的参数表（ink-math.js inkParams：INK_TUNABLE_KEYS + INK_SPEC），键名与网页相同。
struct WebInkParams: Equatable {
    var base: Double
    var lo: Double
    var hi: Double
    var pressureLo: Double
    var pressureGain: Double
    var pressureHi: Double
    var step: Double
    var tapMax: Double
    var tapRatio: Double
    var endMinSlow: Double
    var endMinFast: Double
    var euroMinCutoff: Double
    var euroBeta: Double
    var euroDCutoff: Double
    var speedCap: Double
    var tau: Double
    var window: Double
    var dotLen: Double
    var single: Double

    static let keys = ["base", "lo", "hi", "pressureLo", "pressureGain", "pressureHi", "step", "tapMax", "tapRatio", "endMinSlow", "endMinFast",
                       "euroMinCutoff", "euroBeta", "euroDCutoff", "speedCap", "tau", "window", "dotLen", "single"]

    /// 从页面下发的 ink 表解析（open 回包 payload.ink）；缺键或不是有限数时 nil（与 inkParams 缺键报错同口径，不悄悄补值）。
    init?(_ raw: Any?) {
        guard let d = raw as? [String: Any] else { return nil }
        var v: [String: Double] = [:]
        for k in Self.keys {
            // 布尔不算数（JSON 的 1 / 0 在 Swift 里 `is Bool` 也成立，所以看 CF 类型）
            guard let n = d[k] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { return nil }
            v[k] = n.doubleValue
        }
        // swiftlint:disable force_unwrapping
        base = v["base"]!; lo = v["lo"]!; hi = v["hi"]!
        pressureLo = v["pressureLo"]!; pressureGain = v["pressureGain"]!; pressureHi = v["pressureHi"]!
        step = v["step"]!; tapMax = v["tapMax"]!; tapRatio = v["tapRatio"]!
        endMinSlow = v["endMinSlow"]!; endMinFast = v["endMinFast"]!
        euroMinCutoff = v["euroMinCutoff"]!; euroBeta = v["euroBeta"]!; euroDCutoff = v["euroDCutoff"]!
        speedCap = v["speedCap"]!; tau = v["tau"]!; window = v["window"]!; dotLen = v["dotLen"]!; single = v["single"]!
        // swiftlint:enable force_unwrapping
    }

    /// 页面最近一次下发的表（写字页 open / 重新同步时设）。判断弹层、落定叠层等另建的书写面也读它——同一页面、同一组参数。
    static var current: WebInkParams?
}

/// buildStroke 的一个输出点（345 单位、绝对笔宽 w、ms；p 仅有压力时）。
struct WebInkPoint: Equatable {
    var x: Double
    var y: Double
    var w: Double
    var t: Double
    var p: Double?
}

/// buildStroke 的结果（点列 + 网页数组上的附属性 v30 / dot / single / endK / pressure）。
struct WebInkStroke {
    var points: [WebInkPoint]
    var v30: Double?
    var dot: Bool
    var single: Bool
    var endK: Double
    var pressure: Bool
}

enum WebInk {
    // MARK: 因子

    @inline(__always) static func clamp(_ x: Double, _ lo: Double, _ hi: Double) -> Double { x < lo ? lo : x > hi ? hi : x }

    /// 速度因子（本体宽 / BASE）：1.06 − 0.12·min(v, speedCap)。
    static func speedFactor(_ v: Double, _ k: WebInkParams) -> Double { 1.06 - 0.12 * min(max(0, v), k.speedCap) }

    /// 压力因子（本体宽 / BASE）：pressureLo + √p·gain，夹在 [pressureLo, pressureHi]（D10：替代速度因子，不叠乘）。
    static func pressureFactor(_ p: Double, _ k: WebInkParams) -> Double {
        clamp(k.pressureLo + clamp(p, 0, 1).squareRoot() * k.pressureGain, k.pressureLo, k.pressureHi)
    }

    @inline(__always) static func hasPressure(_ p: Double?) -> Bool { (p ?? 0) > 0 }

    // MARK: 采样整理

    struct Sample: Equatable {
        var x: Double
        var y: Double
        var t: Double
        var p: Double?
    }

    /// 同一时间戳的采样合并（留最后的位置）；坏点丢弃。ink-math.js mergeSameTime。
    static func mergeSameTime(_ raw: [InkRawPoint]) -> [Sample] {
        var out: [Sample] = []
        out.reserveCapacity(raw.count)
        for r in raw {
            guard r.x.isFinite, r.y.isFinite else { continue }
            let t = r.t.isFinite ? r.t : (out.last?.t ?? 0)
            var q = Sample(x: r.x, y: r.y, t: t)
            if hasPressure(r.p), let p = r.p { q.p = clamp(p, 0, 1) }
            if let last = out.last, q.t == last.t { out[out.count - 1] = q } else { out.append(q) }
        }
        return out
    }

    /// 抬笔前 window ms 的平均速度（单位 / ms）；点数 < 2 返回 nil。ink-math.js liftSpeed。
    static func liftSpeed(_ m: [Sample], window: Double) -> Double? {
        let n = m.count
        guard n >= 2 else { return nil }
        let tl = m[n - 1].t
        let t0 = tl - window
        var i = n - 1
        var d = 0.0
        while i > 0, m[i - 1].t >= t0 {
            d += hypot(m[i].x - m[i - 1].x, m[i].y - m[i - 1].y)
            i -= 1
        }
        var dt = tl - m[i].t
        if i > 0 {
            let a = m[i - 1], b = m[i]
            let u = (b.t - t0) / (b.t - a.t)
            d += hypot(b.x - a.x, b.y - a.y) * u
            dt = window
        }
        return dt > 0 ? d / dt : 0
    }

    // MARK: 1€ 滤波 / Catmull-Rom

    /// 1€ 滤波（t 为秒）。ink-math.js oneEuro。
    struct OneEuro {
        let minCutoff: Double, beta: Double, dCutoff: Double
        var xp: Double?
        var dxp = 0.0
        var tp = 0.0

        init(_ minCutoff: Double, _ beta: Double, _ dCutoff: Double) {
            self.minCutoff = minCutoff
            self.beta = beta
            self.dCutoff = dCutoff
        }

        private static func alpha(_ fc: Double, _ dt: Double) -> Double { 1 / (1 + 1 / (2 * Double.pi * fc) / dt) }

        mutating func callAsFunction(_ x: Double, _ t: Double) -> Double {
            guard let prev = xp else {
                xp = x
                tp = t
                return x
            }
            let dt = t - tp
            if !(dt > 0) { return prev }
            let dx = (x - prev) / dt
            let ad = Self.alpha(dCutoff, dt)
            let dxh = ad * dx + (1 - ad) * dxp
            let a = Self.alpha(minCutoff + beta * abs(dxh), dt)
            let xh = a * x + (1 - a) * prev
            xp = xh
            dxp = dxh
            tp = t
            return xh
        }
    }

    /// Catmull-Rom（均匀，τ = .5），首尾点重复，每段 max(1, ceil(段长 / step)) 个点；t / p 在段内线性插值。ink-math.js catmullRom。
    static func catmullRom(_ points: [Sample], step: Double) -> [Sample] {
        guard points.count >= 2 else { return points }
        var out: [Sample] = []
        // swiftlint:disable:next force_unwrapping
        let P = [points.first!] + points + [points.last!]
        @inline(__always) func lerp(_ a: Double, _ b: Double, _ u: Double) -> Double { a + (b - a) * u }
        for i in 1..<(P.count - 2) {
            let a = P[i - 1], b = P[i], c = P[i + 1], d = P[i + 2]
            let n = max(1, Int((hypot(c.x - b.x, c.y - b.y) / step).rounded(.up)))
            let hasP = hasPressure(b.p) || hasPressure(c.p)
            for j in 0..<n {
                let u = Double(j) / Double(n)
                let u2 = u * u, u3 = u2 * u
                let x = 0.5 * (2 * b.x + (-a.x + c.x) * u + (2 * a.x - 5 * b.x + 4 * c.x - d.x) * u2 + (-a.x + 3 * b.x - 3 * c.x + d.x) * u3)
                let y = 0.5 * (2 * b.y + (-a.y + c.y) * u + (2 * a.y - 5 * b.y + 4 * c.y - d.y) * u2 + (-a.y + 3 * b.y - 3 * c.y + d.y) * u3)
                var q = Sample(x: x, y: y, t: lerp(b.t, c.t, u))
                if hasP { q.p = lerp(b.p ?? 0, c.p ?? 0, u) }
                out.append(q)
            }
        }
        // swiftlint:disable:next force_unwrapping
        out.append(points.last!)
        return out
    }

    // MARK: 主管线

    /// 原始采样 → 带宽度的点列（ink-math.js buildStroke，逐步同序）。final：已抬笔（锁尾、收笔、点画判定）。
    static func buildStroke(_ raw: [InkRawPoint], final: Bool, params k: WebInkParams) -> WebInkStroke {
        let base = k.base
        let m = mergeSameTime(raw)
        if m.isEmpty { return WebInkStroke(points: [], v30: nil, dot: false, single: false, endK: 0, pressure: false) }
        let pressure = m.contains { hasPressure($0.p) }
        var fx = OneEuro(k.euroMinCutoff, k.euroBeta, k.euroDCutoff)
        var fy = OneEuro(k.euroMinCutoff, k.euroBeta, k.euroDCutoff)
        var f = m.map { r in Sample(x: fx(r.x, r.t / 1000), y: fy(r.y, r.t / 1000), t: r.t, p: r.p) }
        if final, m.count > 1 { f[f.count - 1] = m[m.count - 1] } // 抬笔锁尾到原始末点
        let p = catmullRom(f, step: k.step)
        let n = p.count
        var L = [Double](repeating: 0, count: n)
        for i in 1..<max(1, n) { L[i] = L[i - 1] + hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y) }
        let len = L[n - 1]

        // 单点：直径 single × 本体宽；有压力时本体宽按压力
        if m.count == 1 || len == 0 {
            let last = p[n - 1]
            let lp = hasPressure(last.p) ? last.p : nil
            let body = lp.map { base * pressureFactor($0, k) } ?? base
            let q = WebInkPoint(x: last.x, y: last.y, w: body * k.single, t: last.t, p: lp)
            return WebInkStroke(points: [q], v30: nil, dot: true, single: true, endK: q.w / base, pressure: pressure)
        }

        let dot = final && len < k.dotLen
        let v30 = final ? liftSpeed(m, window: k.window) : nil
        let vv = v30 ?? 0.5
        let kk = clamp((vv - k.lo) / max(1e-6, k.hi - k.lo), 0, 1)
        let endMin = k.endMinSlow + (k.endMinFast - k.endMinSlow) * kk
        let tap = min(k.tapMax, len * k.tapRatio)

        var w = hasPressure(p[0].p) ? base * pressureFactor(p[0].p ?? 0, k) : base
        var out: [WebInkPoint] = []
        out.reserveCapacity(n)
        for i in 0..<n {
            if i > 0 {
                let dt = p[i].t - p[i - 1].t
                if dt > 0 {
                    let target = hasPressure(p[i].p)
                        ? base * pressureFactor(p[i].p ?? 0, k) // D10：压力替代速度，不叠乘
                        : base * speedFactor((L[i] - L[i - 1]) / dt, k)
                    w += (target - w) * (1 - exp(-dt / k.tau))
                }
            }
            let s = L[i]
            var fct: Double
            if dot {
                let u = len != 0 ? s / len : 0
                fct = u < 0.5 ? 0.7 + (1.1 - 0.7) * (u / 0.5) : 1.1 + (0.9 - 1.1) * ((u - 0.5) / 0.5)
            } else {
                fct = s < 6 ? 0.85 + 0.23 * (s / 6) : s < 12 ? 1.08 - 0.08 * ((s - 6) / 6) : 1
                if final, kk > 0, len - s < tap {
                    let u = (len - s) / tap
                    fct *= endMin + (1 - endMin) * u
                }
            }
            out.append(WebInkPoint(x: p[i].x, y: p[i].y, w: w * fct, t: p[i].t, p: hasPressure(p[i].p) ? p[i].p : nil))
        }
        // swiftlint:disable:next force_unwrapping
        return WebInkStroke(points: out, v30: v30, dot: dot, single: false, endK: out.last!.w / base, pressure: pressure)
    }

    // MARK: 几何（brush.js paintBrushStroke，不含飞白 / 洇墨细节）

    /// 圆的分段数：按半径（345 单位）取，屏幕上弦高误差 < 约 0.3pt（书写格 ≤ 约 400pt 时）。
    static func discSegments(_ r: Double) -> Int { r < 2 ? 12 : r < 5 ? 18 : 24 }

    static func appendDisc(x: Double, y: Double, r: Double, into out: inout [Float]) {
        let n = discSegments(r)
        var px = x + r, py = y
        for i in 1...n {
            let a = Double(i) / Double(n) * 2 * Double.pi
            let nx = x + r * cos(a), ny = y + r * sin(a)
            out.append(Float(x)); out.append(Float(y))
            out.append(Float(px)); out.append(Float(py))
            out.append(Float(nx)); out.append(Float(ny))
            px = nx
            py = ny
        }
    }

    /// 点列 → 三角形（345 单位，每 2 个 Float 一个顶点）：起点圆（半宽 r0），再每段四边形色带 + 末端圆；半宽 max(0.5, w/2)。
    static func triangles(_ points: [WebInkPoint], into out: inout [Float]) {
        guard let first = points.first, points.allSatisfy({ $0.x.isFinite && $0.y.isFinite }) else { return }
        func half(_ q: WebInkPoint) -> Double { max(0.5, (q.w.isFinite && q.w > 0 ? q.w : 0) / 2) }
        appendDisc(x: first.x, y: first.y, r: half(first), into: &out)
        guard points.count > 1 else { return }
        for i in 1..<points.count {
            let a = points[i - 1], b = points[i]
            let dx = b.x - a.x, dy = b.y - a.y
            let length = hypot(dx, dy)
            if length == 0 { continue }
            let ra = half(a), rb = half(b)
            let nx = -dy / length, ny = dx / length
            let q = [a.x + nx * ra, a.y + ny * ra, b.x + nx * rb, b.y + ny * rb, b.x - nx * rb, b.y - ny * rb, a.x - nx * ra, a.y - ny * ra].map(Float.init)
            out += [q[0], q[1], q[2], q[3], q[4], q[5], q[0], q[1], q[4], q[5], q[6], q[7]]
            appendDisc(x: b.x, y: b.y, r: rb, into: &out)
        }
    }
}
