import Foundation

// 原生书写面的墨：与网页同一算法（R11-A，D72 ②）。
//
// 逐函数移植：mergeSameTime → 1€ 滤波（oneEuro）→ 抬笔锁尾 → catmullRom（step 重采样，插值 t / p）
//   → buildStroke（速度因子 / 压力因子、τ 时间平滑、起笔 6 / 12 单位倍数、点画、收笔 liftSpeed + 收尖段）；
// 几何照 paintBrushStroke：起点圆 + 每段「两点间四边形色带 + 末端圆」（半宽 max(0.5, w/2)），
//   同色不混合写入 = 并集（Metal 端见 NativeInkRenderer）。
// 参数一律由页面随 open 下发（writeInk = inkParams(policy)：policy.ink + INK_SPEC），本文件不写数值；
// 金标准：ShiziWriteTests/Fixtures/web-ink-golden.json（当年用网页版生成，D84 起冻结、不再重生成），WebInkTests 逐点比。
// 不移植：网页的飞白 / 洇墨细节（detail：α ≤ .2 的虚线擦、α .11 的外晕），属笔锋细节、不改墨区与粗细，见 B2 架构文档 §12 R11-A。
//
// ink-model-1.0（InkModel.swift，速度 / 方向宽度剖面）保留作 T2 盲测候选，不在产品路径上（只有 DEBUG 的 NativeInkSpike 还用它）。

/// buildStroke 的参数表（inkParams：INK_TUNABLE_KEYS + INK_SPEC），键名与网页相同。
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

    /// 同一时间戳的采样合并（留最后的位置）；坏点丢弃。
    static func mergeSameTime(_ raw: [InkRawPoint]) -> [Sample] {
        var out: [Sample] = []
        out.reserveCapacity(raw.count)
        for r in raw { mergeStep(r, into: &out) }
        return out
    }

    /// mergeSameTime 的一步（逐点、只看 out 的最后一个）：书写中的增量几何（LiveStroke）与整笔重算走同一段代码。
    @inline(__always) static func mergeStep(_ r: InkRawPoint, into out: inout [Sample]) {
        guard r.x.isFinite, r.y.isFinite else { return }
        let t = r.t.isFinite ? r.t : (out.last?.t ?? 0)
        var q = Sample(x: r.x, y: r.y, t: t)
        if hasPressure(r.p), let p = r.p { q.p = clamp(p, 0, 1) }
        if let last = out.last, q.t == last.t { out[out.count - 1] = q } else { out.append(q) }
    }

    /// 抬笔前 window ms 的平均速度（单位 / ms）；点数 < 2 返回 nil。
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

    /// 1€ 滤波（t 为秒）。
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

    /// Catmull-Rom（均匀，τ = .5），首尾点重复，每段 max(1, ceil(段长 / step)) 个点；t / p 在段内线性插值。
    /// 首尾重复用下标夹住表示（[first] + points + [last] 的第 j + 1 段 = 段 j：f[max(0, j−1)]、f[j]、f[j+1]、f[min(末, j+2)]），不再拷一份数组。
    static func catmullRom(_ points: [Sample], step: Double) -> [Sample] {
        guard points.count >= 2 else { return points }
        var out: [Sample] = []
        let last = points.count - 1
        for j in 0..<last {
            catmullSegment(points[max(0, j - 1)], points[j], points[j + 1], points[min(last, j + 2)], step: step, into: &out)
        }
        out.append(points[last])
        return out
    }

    /// Catmull-Rom 的一段（b → c，a / d 为前后邻点）：max(1, ceil(段长 / step)) 个点，不含 c。
    @inline(__always) static func catmullSegment(_ a: Sample, _ b: Sample, _ c: Sample, _ d: Sample, step: Double, into out: inout [Sample]) {
        @inline(__always) func lerp(_ a: Double, _ b: Double, _ u: Double) -> Double { a + (b - a) * u }
        let nd = (hypot(c.x - b.x, c.y - b.y) / step).rounded(.up)
        guard nd.isFinite else { return } // 段长溢出成 ∞ / NaN：不铺这一段（原先 Int(_:) 会崩；同 ShiziCore catmullRom 对 ∞ / NaN 一点不铺）
        let n = max(1, Int(nd))
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

    // MARK: 主管线

    /// 原始采样 → 带宽度的点列（buildStroke，逐步同序）。final：已抬笔（锁尾、收笔、点画判定）。
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

    // MARK: 几何（paintBrushStroke，不含飞白 / 洇墨细节）

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
        appendDisc(x: first.x, y: first.y, r: halfWidth(first), into: &out)
        guard points.count > 1 else { return }
        for i in 1..<points.count { appendJoint(from: points[i - 1], to: points[i], into: &out) }
    }

    /// 半宽 max(0.5, w/2)（w 不是正的有限数时按 0）。
    @inline(__always) static func halfWidth(_ q: WebInkPoint) -> Double { max(0.5, (q.w.isFinite && q.w > 0 ? q.w : 0) / 2) }

    /// 点 b 的几何（前一点 a）：a → b 的四边形色带（两个三角形）+ b 处的圆；两点重合时什么都不画（不画圆）。逐值照原先的写法，只是不再每段建临时数组。
    @inline(__always) static func appendJoint(from a: WebInkPoint, to b: WebInkPoint, into out: inout [Float]) {
        let dx = b.x - a.x, dy = b.y - a.y
        let length = hypot(dx, dy)
        if length == 0 { return }
        let ra = halfWidth(a), rb = halfWidth(b)
        let nx = -dy / length, ny = dx / length
        let q0 = Float(a.x + nx * ra), q1 = Float(a.y + ny * ra), q2 = Float(b.x + nx * rb), q3 = Float(b.y + ny * rb)
        let q4 = Float(b.x - nx * rb), q5 = Float(b.y - ny * rb), q6 = Float(a.x - nx * ra), q7 = Float(a.y - ny * ra)
        out.append(q0); out.append(q1); out.append(q2); out.append(q3); out.append(q4); out.append(q5)
        out.append(q0); out.append(q1); out.append(q4); out.append(q5); out.append(q6); out.append(q7)
        appendDisc(x: b.x, y: b.y, r: rb, into: &out)
    }

    /// 第 i 个点的几何：i = 0（prev 为 nil）是起点圆，之后是 appendJoint。triangles(points) = 各点依次拼接（且所有点 x / y 有限）。
    @inline(__always) static func appendPointGeometry(_ prev: WebInkPoint?, _ cur: WebInkPoint, into out: inout [Float]) {
        if let prev { appendJoint(from: prev, to: cur, into: &out) } else { appendDisc(x: cur.x, y: cur.y, r: halfWidth(cur), into: &out) }
    }
}

// MARK: - 书写中一笔的增量几何

extension WebInk {
    /// 书写中的一笔：每帧的三角形与整笔重算 triangles(buildStroke(raw + 预测点, final:).points) 逐位相同，但只重算新点影响得到的尾巴。
    ///
    /// 为什么逐位相同（每一级都是因果的，缓存的是「之后再来的点改不了」的前缀，尾巴用同一段代码、同样的运算顺序接着算）：
    /// - 合并（mergeStep）：一个新点只会替换 out 的最后一个或追加 → merged[0 ..< 末] 定了；末一个与预测点每帧从它接着合并。
    /// - 1€ 滤波：f[i] 只依赖 m[0 ... i] 与按序推进的滤波状态 → 对已定的 m 推进一次、存下状态；尾巴从状态的拷贝接着滤。
    ///   抬笔锁尾（final）只改 f 的最后一个，它总在尾巴里。
    /// - Catmull-Rom：段 j 只用 f[max(0, j−1)]、f[j]、f[j+1]、f[min(末, j+2)]；j + 2 ≤ 已定 f 的末下标时四个点都已定、且不碰「末点重复」→ 段定了。
    /// - 弧长 L、τ 时间平滑的 w：逐点前向递推（初值看第 0 个重采样点）→ 已定点的 L / w 与递推状态存下，尾巴从状态的拷贝接着推。
    /// - 起笔倍数（s < 6 / < 12）只看本点的 L；书写中（final: false）没有收尖、没有点画 → 已定点的输出点与几何都定了。
    /// - 几何：点 i 的三角形只用点 i−1 与点 i（起点圆只用点 0）→ 已定点的顶点只追加（stableVertices，同一代里不改）。
    /// - 整笔的特殊情形每帧照原式判：没有点、单点（merged 只有 1 个或总弧长 0）只画末点的圆；有点的 x / y 不是有限数时什么都不画。
    /// - final: true：收笔 liftSpeed 每帧在整段 m 上算（只在抬笔那一次）；收尖段（len − s < tap）是 L 单调的后缀，
    ///   从后往前找到它的起点，从那里起重算输出点与几何（之前的点 len − s ≥ tap，与书写中同值）；点画（len < dotLen）整笔照原式重算。
    /// 原始点必须是在上一帧的后面追加（书写面的 raw 就是这样长的）；参数变了、点数变少、首点或上次的末点变了都从头来（generation + 1）。
    struct LiveStroke {
        /// 每次从头来加一；同一代里 stableVertices 只追加、不改（GPU 缓冲据此只写新增的部分）。
        private(set) var generation = 0
        /// 已定点的几何（书写中的画法）。
        private(set) var stableVertices: [Float] = []
        /// 这一帧用到 stableVertices 的前多少个 Float；之后接 tailVertices。
        private(set) var stableUsed = 0
        /// 这一帧的尾巴几何。
        private(set) var tailVertices: [Float] = []

        private var params: WebInkParams?
        private var rawCount = 0
        private var rawFirst: InkRawPoint?
        private var rawLast: InkRawPoint?
        private var merged: [Sample] = [] // mergeSameTime(raw)：只有最后一个还会被后来的同时间戳点替换
        private var fx = OneEuro(0, 0, 0)
        private var fy = OneEuro(0, 0, 0)
        private var filtered: [Sample] = [] // f[0 ..< merged.count − 1]（已定）
        private var segments = 0 // 已定的 Catmull-Rom 段数
        private var acc = Acc() // 已定重采样点之后的弧长 / 宽度递推状态
        private var out: [WebInkPoint] = [] // 已定点的输出点（书写中的画法）
        private var arc: [Double] = [] // 已定点的 L
        private var widths: [Double] = [] // 已定点的 w（乘起笔倍数之前）
        private var vertexStart: [Int] = [] // 已定点 i 的几何在 stableVertices 里的起点
        private var finite = true // 已定点的 x / y 都是有限数

        init() {}

        /// 弧长 L 与 τ 时间平滑的 w 的逐点递推（buildStroke 的两个循环，同式同序）。
        struct Acc {
            var count = 0
            var L = 0.0
            var w = 0.0
            var prev = Sample(x: 0, y: 0, t: 0)

            @inline(__always) mutating func push(_ q: Sample, _ k: WebInkParams) {
                let base = k.base
                if count == 0 {
                    L = 0
                    w = WebInk.hasPressure(q.p) ? base * WebInk.pressureFactor(q.p ?? 0, k) : base
                } else {
                    let l0 = L
                    L = l0 + hypot(q.x - prev.x, q.y - prev.y)
                    let dt = q.t - prev.t
                    if dt > 0 {
                        let target = WebInk.hasPressure(q.p)
                            ? base * WebInk.pressureFactor(q.p ?? 0, k)
                            : base * WebInk.speedFactor((L - l0) / dt, k)
                        w += (target - w) * (1 - exp(-dt / k.tau))
                    }
                }
                prev = q
                count += 1
            }
        }

        /// 收笔段的参数（final 且非点画时）；书写中为 nil。
        struct Ending {
            var kk: Double
            var len: Double
            var tap: Double
            var endMin: Double
        }

        /// 输出点（buildStroke 非点画分支的 fct，同式）。
        @inline(__always) static func strokePoint(_ p: Sample, w: Double, s: Double, ending e: Ending?) -> WebInkPoint {
            var fct = s < 6 ? 0.85 + 0.23 * (s / 6) : s < 12 ? 1.08 - 0.08 * ((s - 6) / 6) : 1
            if let e, e.kk > 0, e.len - s < e.tap {
                let u = (e.len - s) / e.tap
                fct *= e.endMin + (1 - e.endMin) * u
            }
            return WebInkPoint(x: p.x, y: p.y, w: w * fct, t: p.t, p: WebInk.hasPressure(p.p) ? p.p : nil)
        }

        /// 这一帧的全部顶点（= stableVertices 前 stableUsed 个 + tailVertices）。
        var vertices: [Float] {
            var v = [Float]()
            v.reserveCapacity(stableUsed + tailVertices.count)
            v.append(contentsOf: stableVertices[0..<stableUsed])
            v.append(contentsOf: tailVertices)
            return v
        }

        /// 这一帧的顶点数（Float 数 / 2）。
        var vertexCount: Int { (stableUsed + tailVertices.count) / 2 }

        /// 丢掉这一笔（保留数组容量）；下一次 update 从头来。
        mutating func clear() {
            generation += 1
            params = nil
            rawCount = 0
            rawFirst = nil
            rawLast = nil
            merged.removeAll(keepingCapacity: true)
            filtered.removeAll(keepingCapacity: true)
            segments = 0
            acc = Acc()
            out.removeAll(keepingCapacity: true)
            arc.removeAll(keepingCapacity: true)
            widths.removeAll(keepingCapacity: true)
            vertexStart.removeAll(keepingCapacity: true)
            stableVertices.removeAll(keepingCapacity: true)
            tailVertices.removeAll(keepingCapacity: true)
            stableUsed = 0
            finite = true
        }

        private mutating func reset(_ k: WebInkParams) {
            clear()
            params = k
            fx = OneEuro(k.euroMinCutoff, k.euroBeta, k.euroDCutoff)
            fy = OneEuro(k.euroMinCutoff, k.euroBeta, k.euroDCutoff)
        }

        /// 已定一个重采样点：推进递推、记下输出点，并追加它的几何。
        private mutating func settle(_ q: Sample, _ k: WebInkParams) {
            acc.push(q, k)
            let o = Self.strokePoint(q, w: acc.w, s: acc.L, ending: nil)
            vertexStart.append(stableVertices.count)
            if finite {
                if o.x.isFinite, o.y.isFinite { WebInk.appendPointGeometry(out.last, o, into: &stableVertices) } else { finite = false }
            }
            out.append(o)
            arc.append(acc.L)
            widths.append(acc.w)
        }

        /// raw：这一笔到目前的原始点（在上一帧的后面追加）；predicted：这一帧的预测点（时间夹成单调，同 NativeInkView.append）。
        mutating func update(raw: [InkRawPoint], predicted: [InkRawPoint], params k: WebInkParams, final: Bool = false) {
            if params != k || raw.count < rawCount || (rawCount > 0 && (raw[0] != rawFirst || raw[rawCount - 1] != rawLast)) { reset(k) }
            // 1. 新的原始点进合并；已定的部分过 1€ 滤波、Catmull-Rom、递推与几何
            for i in rawCount..<raw.count { WebInk.mergeStep(raw[i], into: &merged) }
            rawCount = raw.count
            rawFirst = raw.first
            rawLast = raw.last
            let s = max(0, merged.count - 1)
            while filtered.count < s {
                let r = merged[filtered.count]
                let x = fx(r.x, r.t / 1000), y = fy(r.y, r.t / 1000)
                filtered.append(Sample(x: x, y: y, t: r.t, p: r.p))
            }
            var seg: [Sample] = []
            while segments + 2 < s {
                let j = segments
                seg.removeAll(keepingCapacity: true)
                WebInk.catmullSegment(filtered[max(0, j - 1)], filtered[j], filtered[j + 1], filtered[j + 2], step: k.step, into: &seg)
                for q in seg { settle(q, k) }
                segments += 1
            }

            // 2. 尾巴：merged 的末一个 + 预测点 → 合并、滤波（状态的拷贝）、锁尾
            stableUsed = 0
            tailVertices.removeAll(keepingCapacity: true)
            var mt: [Sample] = []
            if let last = merged.last { mt.append(last) }
            var lastT = raw.last?.t
            for p in predicted {
                var q = p
                if let l = lastT, !(q.t >= l) { q.t = l }
                lastT = q.t
                WebInk.mergeStep(q, into: &mt)
            }
            let mCount = s + mt.count
            if mCount == 0 { return }
            var gx = fx, gy = fy
            var ft = mt.map { r in Sample(x: gx(r.x, r.t / 1000), y: gy(r.y, r.t / 1000), t: r.t, p: r.p) }
            if final, mCount > 1 { ft[ft.count - 1] = mt[mt.count - 1] }

            // 3. 尾巴的 Catmull-Rom：段 segments ..< nf − 1，再加末点
            let nf = s + ft.count
            var pt: [Sample] = []
            if nf < 2 {
                pt = ft
            } else {
                let fs = filtered
                func fAt(_ i: Int) -> Sample { i < s ? fs[i] : ft[i - s] }
                for j in segments..<(nf - 1) {
                    WebInk.catmullSegment(fAt(max(0, j - 1)), fAt(j), fAt(j + 1), fAt(min(nf - 1, j + 2)), step: k.step, into: &pt)
                }
                pt.append(fAt(nf - 1))
            }

            // 4. 尾巴的弧长 / 宽度递推
            var ta = acc
            var tl: [Double] = [], tw: [Double] = []
            tl.reserveCapacity(pt.count)
            tw.reserveCapacity(pt.count)
            for q in pt {
                ta.push(q, k)
                tl.append(ta.L)
                tw.append(ta.w)
            }
            let ps = out.count
            let n = ps + pt.count
            let len = ta.L

            // 单点：直径 single × 本体宽（整笔只画末点的圆）
            if mCount == 1 || len == 0 {
                guard let last = pt.last else { return }
                let lp = WebInk.hasPressure(last.p) ? last.p : nil
                let body = lp.map { k.base * WebInk.pressureFactor($0, k) } ?? k.base
                WebInk.triangles([WebInkPoint(x: last.x, y: last.y, w: body * k.single, t: last.t, p: lp)], into: &tailVertices)
                return
            }
            var ending: Ending?
            if final {
                // 点画：fct 看整笔长度，整笔照原式重算（只在抬笔那一次、且笔很短）
                if len < k.dotLen {
                    var pts = raw
                    for p in predicted {
                        var q = p
                        if let l = pts.last, !(q.t >= l.t) { q.t = l.t }
                        pts.append(q)
                    }
                    WebInk.triangles(WebInk.buildStroke(pts, final: true, params: k).points, into: &tailVertices)
                    return
                }
                let v30 = WebInk.liftSpeed(Array(merged[0..<s]) + mt, window: k.window)
                let vv = v30 ?? 0.5
                let kk = WebInk.clamp((vv - k.lo) / max(1e-6, k.hi - k.lo), 0, 1)
                let endMin = k.endMinSlow + (k.endMinFast - k.endMinSlow) * kk
                let tap = min(k.tapMax, len * k.tapRatio)
                ending = Ending(kk: kk, len: len, tap: tap, endMin: endMin)
            }
            // 收尖段的起点 ramp（L 单调不减 → len − L 单调不增，满足 len − s < tap 的是一段后缀）；书写中 ramp = n
            var ramp = n
            if let e = ending, e.kk > 0 {
                while ramp > 0, len - (ramp - 1 < ps ? arc[ramp - 1] : tl[ramp - 1 - ps]) < e.tap { ramp -= 1 }
            }
            guard finite else { return }
            let start = min(ramp, ps)
            var prev: WebInkPoint? = start > 0 ? out[start - 1] : nil
            for i in start..<n {
                let o: WebInkPoint
                if i < ps {
                    let b = out[i]
                    o = Self.strokePoint(Sample(x: b.x, y: b.y, t: b.t, p: b.p), w: widths[i], s: arc[i], ending: ending)
                } else {
                    o = Self.strokePoint(pt[i - ps], w: tw[i - ps], s: tl[i - ps], ending: ending)
                }
                guard o.x.isFinite, o.y.isFinite else {
                    tailVertices.removeAll(keepingCapacity: true)
                    return
                }
                WebInk.appendPointGeometry(prev, o, into: &tailVertices)
                prev = o
            }
            stableUsed = start < ps ? vertexStart[start] : stableVertices.count
        }
    }
}
