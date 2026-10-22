import Foundation

// src/core/ink-math.js 的 1:1 移植（B4.3）：笔迹管线（01 §6.2；D09 / D10）+ 存储编码 / 解码 / 抽点（01 §3.5）。
//   buildStroke（原始采样 → 带宽度的点列）、simplifyStroke / thinStroke（存储前抽点）、
//   Ink v3 打包编码 / 解码（encodeInk，P78）、旧 v2 读取、Ink v4 原始点编码 / 解码（encodeInkRaw，B2.3 / DQ2-C）、会话现场的原始笔画行。
// 与 App 里已有的 WebInk（书写面实时用）与 InkStoredInk（v4 解包）同一算法；ShiziCore 这份是规则层的字节级等价版（JS 为准）：
//   · Math.hypot / Math.exp 用 V8 的算法（JSMath），不是 libm；
//   · 输出点的键序照 JS 构造点对象的字面量序（`order`），所以序列化后与 JS JSON.stringify 逐字节相同；
//   · 参数读生成的 policy.json（policy.ink + 已定规格 INK_SPEC），源码里没有手感数值。

/// 一个笔点 {x, y, t?, p?, w?}（345 单位 / ms / 压力 0–1 / 绝对笔宽）。`order` = JS 对象的键序（只用于序列化）。
public struct InkPoint: Equatable {
    public var x: Double
    public var y: Double
    public var t: Double?
    public var p: Double?
    public var w: Double?
    public var order: [String]

    public static let orderXYTP = ["x", "y", "t", "p"]
    public static let orderXYTPW = ["x", "y", "t", "p", "w"]
    public static let orderXYWTP = ["x", "y", "w", "t", "p"]

    public init(x: Double, y: Double, t: Double? = nil, p: Double? = nil, w: Double? = nil, order: [String] = InkPoint.orderXYTPW) {
        self.x = x; self.y = y; self.t = t; self.p = p; self.w = w; self.order = order
    }

    /// 从 JSON 点解析（非数字字段当缺省；键序取输入的键序）。
    public init?(js v: JSValue) {
        guard case .object(let o) = v else { return nil }
        x = o["x"]?.numberValue ?? .nan
        y = o["y"]?.numberValue ?? .nan
        t = o["t"]?.numberValue
        p = o["p"]?.numberValue
        w = o["w"]?.numberValue
        order = o.keys
    }

    public var js: JSValue {
        var o = JSObject()
        for k in order {
            switch k {
            case "x": if !x.isNaN { o["x"] = .number(x) }
            case "y": if !y.isNaN { o["y"] = .number(y) }
            case "t": if let t = t { o["t"] = .number(t) }
            case "p": if let p = p { o["p"] = .number(p) }
            case "w": if let w = w { o["w"] = .number(w) }
            default: break
            }
        }
        return .object(o)
    }
}

/// buildStroke 的结果（点列 + JS 数组上的附属性 v30 / dot / single / endK / pressure，后者不进 JSON）。
public struct BuiltStroke {
    public var points: [InkPoint]
    public var v30: Double?
    public var dot: Bool
    public var single: Bool
    public var endK: Double
    public var pressure: Bool
}

/// 笔迹参数表（ink-math.js inkParams：policy.ink 的 14 个键 + 已定规格 INK_SPEC），键名与网页相同。
public struct InkParams: Equatable {
    public var base: Double, lo: Double, hi: Double
    public var pressureLo: Double, pressureGain: Double, pressureHi: Double
    public var step: Double, tapMax: Double, tapRatio: Double
    public var endMinSlow: Double, endMinFast: Double
    public var euroMinCutoff: Double, euroBeta: Double, euroDCutoff: Double
    public var speedCap: Double, tau: Double, window: Double, dotLen: Double, single: Double

    public static let tunableKeys = ["base", "lo", "hi", "pressureLo", "pressureGain", "pressureHi", "step",
                                     "tapMax", "tapRatio", "endMinSlow", "endMinFast", "euroMinCutoff", "euroBeta", "euroDCutoff"]
    /// 已定规格（交接备注八.1、D09）：不是待定项，不进 policy。
    public static let spec: [(String, Double)] = [("speedCap", 1.5), ("tau", 35), ("window", 30), ("dotLen", 24), ("single", 0.9)]

    /// 默认参数表（policy.ink + INK_SPEC）。
    public static let standard: InkParams = { do { return try InkParams(policy: nil) } catch { fatalError("ShiziCore policy.ink: \(error)") } }()

    init(values v: [String: Double]) {
        base = v["base"]!; lo = v["lo"]!; hi = v["hi"]!
        pressureLo = v["pressureLo"]!; pressureGain = v["pressureGain"]!; pressureHi = v["pressureHi"]!
        step = v["step"]!; tapMax = v["tapMax"]!; tapRatio = v["tapRatio"]!
        endMinSlow = v["endMinSlow"]!; endMinFast = v["endMinFast"]!
        euroMinCutoff = v["euroMinCutoff"]!; euroBeta = v["euroBeta"]!; euroDCutoff = v["euroDCutoff"]!
        speedCap = v["speedCap"]!; tau = v["tau"]!; window = v["window"]!; dotLen = v["dotLen"]!; single = v["single"]!
    }

    /// 取参数表：policy 缺省读生成的 policy；缺 ink 或某键不是有限数时抛 TypeError（不悄悄补值）。
    public init(policy: JSObject?) throws {
        let pol = policy ?? (Config.policy.objectValue ?? JSObject())
        guard let tunable = pol["ink"], JSX.truthy(tunable), case .object = tunable else { throw CoreError.type("policy.ink (P65) is missing") }
        var v: [String: Double] = [:]
        for k in Self.tunableKeys {
            guard case .number(let d)? = tunable[k], d.isFinite else { throw CoreError.type("policy.ink.\(k) (P65) is not a finite number") }
            v[k] = d
        }
        for (k, d) in Self.spec { v[k] = d }
        self.init(values: v)
    }

    subscript(key: String) -> Double? {
        switch key {
        case "base": return base
        case "lo": return lo
        case "hi": return hi
        case "pressureLo": return pressureLo
        case "pressureGain": return pressureGain
        case "pressureHi": return pressureHi
        case "step": return step
        case "tapMax": return tapMax
        case "tapRatio": return tapRatio
        case "endMinSlow": return endMinSlow
        case "endMinFast": return endMinFast
        case "euroMinCutoff": return euroMinCutoff
        case "euroBeta": return euroBeta
        case "euroDCutoff": return euroDCutoff
        default: return nil
        }
    }

    mutating func set(_ key: String, _ v: Double) {
        switch key {
        case "base": base = v
        case "lo": lo = v
        case "hi": hi = v
        case "pressureLo": pressureLo = v
        case "pressureGain": pressureGain = v
        case "pressureHi": pressureHi = v
        case "step": step = v
        case "tapMax": tapMax = v
        case "tapRatio": tapRatio = v
        case "endMinSlow": endMinSlow = v
        case "endMinFast": endMinFast = v
        case "euroMinCutoff": euroMinCutoff = v
        case "euroBeta": euroBeta = v
        case "euroDCutoff": euroDCutoff = v
        default: break
        }
    }
}

/// buildStroke / decodeInk 的选项（对应 JS 的 opts）：final、policy（注入整张 policy）、同名数值键覆盖单项。
public struct InkOptions {
    public var final = false
    public var policy: JSObject?
    public var overrides: [String: Double] = [:]
    public var base: Double?
    public init(final: Bool = false, policy: JSObject? = nil, overrides: [String: Double] = [:], base: Double? = nil) {
        self.final = final; self.policy = policy; self.overrides = overrides; self.base = base
    }

    /// 从协议参数构造：键 final / policy / base 以及 InkParams.tunableKeys 里的有限数。
    public init(js a: JSObject) {
        final = a["final"] == .bool(true)
        policy = a["policy"].flatMap { v -> JSObject? in if case .object(let o) = v { return o }; return nil }
        base = a["base"]?.numberValue.flatMap { $0.isFinite ? $0 : nil }
        for k in InkParams.tunableKeys { if case .number(let d)? = a[k], d.isFinite { overrides[k] = d } }
    }

    /// ink-math.js params(opts)：policy 注入 → 其 ink 表；同名有限数值且不等于表值的键覆盖。
    func params() throws -> InkParams {
        var table = policy != nil ? try InkParams(policy: policy) : InkParams.standard
        for k in InkParams.tunableKeys {
            if let v = overrides[k], v != table[k] { table.set(k, v) }
        }
        return table
    }
}

public enum InkMath {
    /// 书写格内部边长（01 §6.1）。
    public static let grid = 345.0
    /// v3 的 dt 量化档（ms，16 档，近似对数）。
    public static let dtLevels: [Double] = [0, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 512, 1024, 2048]
    static let replayFactor = 3.0
    static let varintMaxBytes = 5

    // MARK: 小工具

    @inline(__always) static func clamp(_ x: Double, _ lo: Double, _ hi: Double) -> Double { x < lo ? lo : x > hi ? hi : x }
    static func hasPressure(_ p: InkPoint) -> Bool { (p.p ?? 0) > 0 }
    @inline(__always) static func hypot(_ a: Double, _ b: Double) -> Double { JSMath.hypot(a, b) }

    /// `num(value, fallback)`：有限数取原值，否则取回退值。
    static func num(_ v: Double?, _ fallback: Double) -> Double { if let v = v, v.isFinite { return v }; return fallback }
    static func num(_ v: Double?) -> Double? { if let v = v, v.isFinite { return v }; return nil }

    static func policyNumber(_ policy: JSObject?, _ key: String) -> Double? {
        let pol = policy ?? (Config.policy.objectValue ?? JSObject())
        if case .number(let d)? = pol[key] { return d }
        return nil
    }

    // MARK: 因子

    /// 速度因子（本体宽 / BASE）：1.06 − 0.12·min(v, 1.5)。
    public static func speedFactor(_ v: Double, _ k: InkParams = .standard) -> Double {
        1.06 - 0.12 * JSMath.min(JSMath.max(0, v), k.speedCap)
    }

    /// 压力因子（本体宽 / BASE），仅 pen 且 p>0 时使用（D10：替代速度因子，不叠乘）。
    public static func pressureFactor(_ p: Double, _ k: InkParams = .standard) -> Double {
        clamp(k.pressureLo + clamp(p, 0, 1).squareRoot() * k.pressureGain, k.pressureLo, k.pressureHi)
    }

    // MARK: 1€ 滤波 / Catmull-Rom

    struct OneEuro {
        let minCutoff: Double, beta: Double, dCutoff: Double
        var xp: Double?
        var dxp = 0.0
        var tp = 0.0
        init(_ minCutoff: Double, _ beta: Double, _ dCutoff: Double) { self.minCutoff = minCutoff; self.beta = beta; self.dCutoff = dCutoff }
        static func alpha(_ fc: Double, _ dt: Double) -> Double { 1 / (1 + 1 / (2 * Double.pi * fc) / dt) }
        mutating func callAsFunction(_ x: Double, _ t: Double) -> Double {
            guard let prev = xp else { xp = x; tp = t; return x }
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

    /// Catmull-Rom（均匀，τ=.5），首尾点重复，每段 max(1, ceil(段长/step)) 个点；t / p / w（若有）在段内线性插值。
    public static func catmullRom(_ points: [InkPoint], step: Double = InkParams.standard.step) -> [InkPoint] {
        if points.count < 2 { return points }
        var out: [InkPoint] = []
        let P = [points[0]] + points + [points[points.count - 1]]
        @inline(__always) func lerp(_ a: Double, _ b: Double, _ u: Double) -> Double { a + (b - a) * u }
        for i in 1..<(P.count - 2) {
            let a = P[i - 1], b = P[i], c = P[i + 1], d = P[i + 2]
            let nd = JSMath.max(1, (hypot(c.x - b.x, c.y - b.y) / step).rounded(.up))
            let n = (nd.isFinite && nd < 1e8) ? Int(nd) : 0 // NaN：JS 的 j < NaN 一次也不进
            for j in 0..<n {
                let u = Double(j) / Double(n)
                let u2 = u * u
                let u3 = u2 * u
                let x = 0.5 * (2 * b.x + (-a.x + c.x) * u + (2 * a.x - 5 * b.x + 4 * c.x - d.x) * u2 + (-a.x + 3 * b.x - 3 * c.x + d.x) * u3)
                let y = 0.5 * (2 * b.y + (-a.y + c.y) * u + (2 * a.y - 5 * b.y + 4 * c.y - d.y) * u2 + (-a.y + 3 * b.y - 3 * c.y + d.y) * u3)
                let t = lerp(num(b.t, 0), num(c.t, 0), u)
                let hasP = hasPressure(b) || hasPressure(c)
                let hasW = b.w != nil && c.w != nil
                var q = InkPoint(x: x, y: y, t: t, order: InkPoint.orderXYTPW)
                if hasP { q.p = lerp(num(b.p, 0), num(c.p, 0), u) }
                if hasW { q.w = lerp(b.w!, c.w!, u) }
                out.append(q)
            }
        }
        out.append(points[points.count - 1])
        return out
    }

    // MARK: 采样整理

    /// 同一时间戳的采样合并（留最后的位置）；坏点丢弃。
    public static func mergeSameTime(_ raw: [InkPoint]) -> [InkPoint] {
        var out: [InkPoint] = []
        out.reserveCapacity(raw.count)
        for r in raw {
            guard r.x.isFinite, r.y.isFinite else { continue }
            var q = InkPoint(x: r.x, y: r.y, t: num(r.t, out.last?.t ?? 0), order: InkPoint.orderXYTP)
            if hasPressure(r) { q.p = clamp(r.p!, 0, 1) }
            if let last = out.last, q.t == last.t { out[out.count - 1] = q } else { out.append(q) }
        }
        return out
    }

    /// 抬笔前 window ms 的平均速度（pt/ms）；点数 < 2 返回 nil。
    public static func liftSpeed(_ merged: [InkPoint], window: Double = InkParams.standard.window) -> Double? {
        let n = merged.count
        if n < 2 { return nil }
        let tl = merged[n - 1].t ?? .nan
        let t0 = tl - window
        var i = n - 1
        var d = 0.0
        while i > 0, (merged[i - 1].t ?? .nan) >= t0 {
            d += hypot(merged[i].x - merged[i - 1].x, merged[i].y - merged[i - 1].y)
            i -= 1
        }
        var dt = tl - (merged[i].t ?? .nan)
        if i > 0 {
            let a = merged[i - 1], b = merged[i]
            let u = ((b.t ?? .nan) - t0) / ((b.t ?? .nan) - (a.t ?? .nan))
            d += hypot(b.x - a.x, b.y - a.y) * u
            dt = window
        }
        return dt > 0 ? d / dt : 0
    }

    // MARK: 主管线

    /// 原始采样 → 带宽度的点列（01 §6.2）。
    public static func buildStroke(_ raw: [InkPoint], options: InkOptions = InkOptions()) throws -> BuiltStroke {
        let k = try options.params()
        let base = k.base
        let final = options.final
        let m = mergeSameTime(raw)
        if m.isEmpty { return BuiltStroke(points: [], v30: nil, dot: false, single: false, endK: 0, pressure: false) }
        let pressure = m.contains(where: hasPressure)
        var fx = OneEuro(k.euroMinCutoff, k.euroBeta, k.euroDCutoff)
        var fy = OneEuro(k.euroMinCutoff, k.euroBeta, k.euroDCutoff)
        var f: [InkPoint] = m.map { r in
            var q = InkPoint(x: fx(r.x, r.t! / 1000), y: fy(r.y, r.t! / 1000), t: r.t, order: InkPoint.orderXYTP)
            if r.p != nil { q.p = r.p }
            return q
        }
        if final && m.count > 1 { f[f.count - 1] = m[m.count - 1] } // 抬笔锁尾到原始末点
        let p = catmullRom(f, step: k.step)
        let n = p.count
        var L = [Double](repeating: 0, count: n)
        if n > 1 { for i in 1..<n { L[i] = L[i - 1] + hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y) } }
        let len = L[n - 1]

        // 单点：直径 0.9 × 本体宽（D09）。有压力时本体宽按压力。
        if m.count == 1 || len == 0 {
            let last = p[n - 1]
            let body = hasPressure(last) ? base * pressureFactor(last.p!, k) : base
            var q = InkPoint(x: last.x, y: last.y, t: last.t, w: body * k.single, order: InkPoint.orderXYWTP)
            if hasPressure(last) { q.p = last.p }
            return BuiltStroke(points: [q], v30: nil, dot: true, single: true, endK: q.w! / base, pressure: pressure)
        }

        let dot = final && len < k.dotLen
        let v30 = final ? liftSpeed(m, window: k.window) : nil
        let vv = v30 ?? 0.5
        let kk = clamp((vv - k.lo) / JSMath.max(1e-6, k.hi - k.lo), 0, 1)
        let endMin = k.endMinSlow + (k.endMinFast - k.endMinSlow) * kk
        let tap = JSMath.min(k.tapMax, len * k.tapRatio)

        var w = hasPressure(p[0]) ? base * pressureFactor(p[0].p!, k) : base
        var out: [InkPoint] = []
        out.reserveCapacity(n)
        for i in 0..<n {
            if i > 0 {
                let dt = (p[i].t ?? .nan) - (p[i - 1].t ?? .nan)
                if dt > 0 {
                    let target = hasPressure(p[i])
                        ? base * pressureFactor(p[i].p!, k) // D10：压力替代速度，不叠乘
                        : base * speedFactor((L[i] - L[i - 1]) / dt, k)
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
            if hasPressure(p[i]) { q.p = p[i].p }
            out.append(q)
        }
        return BuiltStroke(points: out, v30: v30, dot: dot, single: false, endK: out[n - 1].w! / base, pressure: pressure)
    }

    /// 总弧长。
    public static func strokeLength(_ points: [InkPoint]) -> Double {
        var len = 0.0
        if points.count > 1 { for i in 1..<points.count { len += hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) } }
        return len
    }

    // MARK: 抽点（01 §3.5）

    /// 按弧长均匀抽点到 ≤ max 个：首末点必留；目标弧长位置取最近的原始点。
    public static func thinStroke(_ points: [InkPoint], max: Double? = nil) -> [InkPoint] {
        let n = points.count
        let m = max ?? Config.policyNumber("inkMaxPointsPerStroke") ?? 24
        let cap = JSMath.max(2, m.rounded(.down))
        if Double(n) <= cap { return points }
        let capI = Int(cap)
        var L = [0.0]
        for i in 1..<n { L.append(L[i - 1] + hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)) }
        let len = L[n - 1]
        if !(len > 0) {
            // 原地抖动（无位移）：按下标均匀取
            var idx = OSetInt()
            for j in 0..<capI { idx.insert(Int(JSMath.round((Double(j) * Double(n - 1)) / Double(capI - 1)))) }
            return idx.items.map { points[$0] }
        }
        var picked = [0]
        var i = 0
        if capI - 1 > 1 {
            for j in 1..<(capI - 1) {
                let target = (Double(j) * len) / Double(capI - 1)
                while i < n - 1 && L[i + 1] <= target { i += 1 }
                var best = i
                if i < n - 1 && abs(L[i + 1] - target) < abs(L[i] - target) { best = i + 1 }
                if best <= picked[picked.count - 1] { best = picked[picked.count - 1] + 1 }
                if best >= n - 1 { break }
                picked.append(best)
            }
        }
        picked.append(n - 1)
        return picked.map { points[$0] }
    }

    struct OSetInt {
        var seen = Set<Int>()
        var items: [Int] = []
        mutating func insert(_ v: Int) { if seen.insert(v).inserted { items.append(v) } }
    }

    /// 存储前的抽点容差（policy.inkStoreTolerance）；nil = 退回 thinStroke。
    public struct Tolerance {
        public var xy: Double?
        public var w: Double?
        public var t: Double?
        public init(xy: Double? = nil, w: Double? = nil, t: Double? = nil) { self.xy = xy; self.w = w; self.t = t }
        public init?(js v: JSValue?) {
            guard let v = v, JSX.truthy(v) else { return nil }
            xy = v["xy"]?.numberValue; w = v["w"]?.numberValue; t = v["t"]?.numberValue
        }
    }

    /// 三态：缺省（读 policy）/ 显式 null / 值。
    public enum ToleranceSetting {
        case policyDefault
        case none
        case value(Tolerance)
    }

    static func defaultTolerance(_ policy: JSObject?) -> Tolerance? {
        let pol = policy ?? (Config.policy.objectValue ?? JSObject())
        return Tolerance(js: pol["inkStoreTolerance"])
    }

    struct Seg {
        var a: Int
        var b: Int
        var at: Int
        var err: Double
        var rep: Double = 0
    }

    /// 存储前按误差自适应抽点（P121）：从首末两点起，反复在「回放误差最大」的位置插回一个原始点，直到每段误差都在容差内或点数到 max。
    public static func simplifyStroke(_ points: [InkPoint], max maxV: Double? = nil, tolerance: ToleranceSetting = .policyDefault, policy: JSObject? = nil) -> [InkPoint] {
        let maxN = num(maxV, policyNumber(policy, "inkMaxPointsPerStroke") ?? 24)
        let tol: Tolerance?
        switch tolerance {
        case .policyDefault: tol = defaultTolerance(policy)
        case .none: tol = nil
        case .value(let t): tol = t
        }
        guard let tolerance = tol else { return thinStroke(points, max: maxN) }
        let pts = points
        let n = pts.count
        let cap = JSMath.max(2, maxN.rounded(.down))
        if n <= 2 { return pts }
        let txy = num(tolerance.xy, 0.3) > 0 ? num(tolerance.xy, 0.3) : 0.3
        let tw = num(tolerance.w, 0.3) > 0 ? num(tolerance.w, 0.3) : 0.3
        let tt = num(tolerance.t, 24) > 0 ? num(tolerance.t, 24) : 24
        var L = [0.0]
        for i in 1..<n { L.append(L[i - 1] + hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)) }
        func worst(_ a: Int, _ b: Int) -> Seg {
            let A = pts[a], B = pts[b]
            let dx = B.x - A.x
            let dy = B.y - A.y
            let L2 = dx * dx + dy * dy
            let span = L[b] - L[a]
            let wa = num(A.w, 0)
            let wb = num(B.w, 0)
            let ta = num(A.t)
            let tb = num(B.t)
            var err = 0.0
            var at = -1
            var i = a + 1
            while i < b {
                let P = pts[i]
                let s = L2 > 0 ? clamp(((P.x - A.x) * dx + (P.y - A.y) * dy) / L2, 0, 1) : 0
                let u = span > 0 ? (L[i] - L[a]) / span : Double(i - a) / Double(b - a)
                var e = hypot(A.x + dx * s - P.x, A.y + dy * s - P.y) / txy
                e = JSMath.max(e, abs(wa + (wb - wa) * u - num(P.w, 0)) / tw)
                if let ta = ta, let tb = tb, let tp = num(P.t) { e = JSMath.max(e, abs(ta + (tb - ta) * u - tp) / tt) }
                if e > err {
                    err = e
                    at = i
                }
                i += 1
            }
            return Seg(a: a, b: b, at: at, err: err)
        }
        // 回放核对：均匀 Catmull-Rom 在相邻段长悬殊处会冲出去，连线误差看不到——按回放公式逐段取样，量到原始折线的距离。
        let replayLimit = txy * replayFactor
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
                let s = L2 > 0 ? clamp(((x - P.x) * dx + (y - P.y) * dy) / L2, 0, 1) : 0
                let d = hypot(P.x + dx * s - x, P.y + dy * s - y)
                if d < best { best = d }
                i += 1
            }
            return best
        }
        func replayErr(_ segs: [Seg], _ j: Int) -> Double {
            let g = segs[j]
            let A = pts[j > 0 ? segs[j - 1].a : g.a]
            let B = pts[g.a]
            let C = pts[g.b]
            let D = pts[j + 1 < segs.count ? segs[j + 1].b : g.b]
            let m = Int(JSMath.max(1, (hypot(C.x - B.x, C.y - B.y) / step).rounded(.up)))
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

    // MARK: base64

    static let b64Chars = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".utf8)
    static let b64Index: [Int16] = {
        var m = [Int16](repeating: -1, count: 128)
        for (i, c) in b64Chars.enumerated() { m[Int(c)] = Int16(i) }
        return m
    }()

    /// 字节数组 → 标准 base64（带 = 补位）。
    public static func bytesToBase64(_ bytes: [UInt8]) -> String {
        var out: [UInt8] = []
        out.reserveCapacity((bytes.count + 2) / 3 * 4)
        let n = bytes.count
        var i = 0
        while i < n {
            let a = Int(bytes[i])
            let b = i + 1 < n ? Int(bytes[i + 1]) : 0
            let c = i + 2 < n ? Int(bytes[i + 2]) : 0
            out.append(b64Chars[a >> 2])
            out.append(b64Chars[((a & 3) << 4) | (b >> 4)])
            out.append(i + 1 < n ? b64Chars[((b & 15) << 2) | (c >> 6)] : 0x3D)
            out.append(i + 2 < n ? b64Chars[c & 63] : 0x3D)
            i += 3
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// 是否是合法的标准 base64 串（长度 4 的倍数、补位正确；只认 ASCII）。
    public static func isBase64(_ s: String) -> Bool {
        let u = Array(s.utf16)
        guard u.count % 4 == 0 else { return false }
        func ok(_ c: UInt16) -> Bool { c < 128 && b64Index[Int(c)] >= 0 }
        var i = 0
        while i + 4 <= u.count {
            let last = i + 4 == u.count
            if u[i...(i + 3)].allSatisfy(ok) { i += 4; continue }
            guard last else { return false }
            // 末组：xx== 或 xxx=
            if ok(u[i]) && ok(u[i + 1]) && u[i + 2] == 0x3D && u[i + 3] == 0x3D { return true }
            if ok(u[i]) && ok(u[i + 1]) && ok(u[i + 2]) && u[i + 3] == 0x3D { return true }
            return false
        }
        return true
    }

    /// 标准 base64 → 字节；不合法返回 nil（JS 版逐位同序：补位处按 0 参与、尾部多余位丢掉）。
    public static func base64ToBytes(_ s: String) -> [UInt8]? {
        guard isBase64(s) else { return nil }
        let u = Array(s.utf16)
        let pad = s.hasSuffix("==") ? 2 : s.hasSuffix("=") ? 1 : 0
        let len = (u.count / 4) * 3 - pad
        var out = [UInt8](repeating: 0, count: len)
        var o = 0
        var i = 0
        while i < u.count {
            let a = Int(b64Index[Int(u[i])])
            let b = Int(b64Index[Int(u[i + 1])])
            let c = u[i + 2] == 0x3D ? 0 : Int(b64Index[Int(u[i + 2])])
            let d = u[i + 3] == 0x3D ? 0 : Int(b64Index[Int(u[i + 3])])
            let v = (a << 18) | (b << 12) | (c << 6) | d
            if o < len { out[o] = UInt8((v >> 16) & 255); o += 1 }
            if o < len { out[o] = UInt8((v >> 8) & 255); o += 1 }
            if o < len { out[o] = UInt8(v & 255); o += 1 }
            i += 4
        }
        return out
    }

    // MARK: Ink v3 打包编码（01 §3.5，P78）

    /// ms 差 → 0–15 档（对数距离最近；负数按 0）。
    public static func quantizeDt(_ ms: Double?) -> Int {
        let want = JSMath.max(0, num(ms, 0))
        let lw = log1p(want)
        var best = 0
        var bestD = Double.infinity
        for i in 0..<dtLevels.count {
            let d = abs(log1p(dtLevels[i]) - lw)
            if d < bestD {
                bestD = d
                best = i
            }
        }
        return best
    }

    /// encodeInk 的选项。
    public struct EncodeOptions {
        public var base: Double?
        public var maxPoints: Double?
        public var maxStrokes: Double?
        public var tolerance: ToleranceSetting = .policyDefault
        public var policy: JSObject?
        public init(base: Double? = nil, maxPoints: Double? = nil, maxStrokes: Double? = nil, tolerance: ToleranceSetting = .policyDefault, policy: JSObject? = nil) {
            self.base = base; self.maxPoints = maxPoints; self.maxStrokes = maxStrokes; self.tolerance = tolerance; self.policy = policy
        }
    }

    /// 管线输出（每笔 {x,y,w,t,p?}，345 空间）→ Ink v3 打包编码：{v:3, c:345, s:[…], p?:[…]}。
    public static func encodeInk(_ strokes: [[InkPoint]], options o: EncodeOptions = EncodeOptions()) throws -> JSValue {
        let policy = o.policy
        let base = num(o.base, o.policy != nil ? try InkParams(policy: policy).base : InkParams.standard.base)
        let maxPoints = num(o.maxPoints, policyNumber(policy, "inkMaxPointsPerStroke") ?? .nan)
        let maxStrokes = num(o.maxStrokes, policyNumber(policy, "inkMaxStrokes") ?? .nan)
        let keepCount = JSMath.max(0, maxStrokes.rounded(.down))
        let kept = Array(strokes.filter { !$0.isEmpty }.prefix(keepCount.isNaN ? 0 : (keepCount > Double(strokes.count) ? strokes.count : Int(keepCount))))
        var tolerance = o.tolerance
        if case .policyDefault = tolerance { tolerance = defaultTolerance(policy).map { .value($0) } ?? .none }
        let thinned = kept.map { simplifyStroke($0, max: maxPoints, tolerance: tolerance, policy: policy) }
        let withPressure = thinned.contains { $0.contains(where: hasPressure) }
        var s: [JSValue] = []
        var p: [JSValue] = []
        var t0: Double?
        var lastRel = 0.0
        for stroke in thinned {
            var bytes = [UInt8](repeating: 0, count: stroke.count * 4)
            var pbytes = [UInt8](repeating: 0, count: stroke.count)
            var strokeRel0 = 0.0
            var decWithin = 0.0
            for (j, pt) in stroke.enumerated() {
                let x = Int(clamp(JSMath.round((num(pt.x, 0) / grid) * 1000), 0, 1023))
                let y = Int(clamp(JSMath.round((num(pt.y, 0) / grid) * 1000), 0, 1023))
                let w = Int(clamp(JSMath.round((num(pt.w, base) / base) * 100), 0, 255))
                var rel = lastRel
                if let t = num(pt.t) {
                    if t0 == nil { t0 = t }
                    rel = JSMath.max(lastRel, JSMath.round(t - t0!))
                }
                let q: Int
                if j == 0 {
                    q = quantizeDt(rel - lastRel)
                    strokeRel0 = rel
                    decWithin = 0
                } else {
                    q = quantizeDt(rel - strokeRel0 - decWithin)
                    decWithin += dtLevels[q]
                }
                lastRel = rel
                let off = j * 4
                bytes[off] = UInt8(x >> 2)
                bytes[off + 1] = UInt8(((x & 3) << 6) | (y >> 4))
                bytes[off + 2] = UInt8(((y & 15) << 4) | (w >> 4))
                bytes[off + 3] = UInt8(((w & 15) << 4) | q)
                if withPressure { pbytes[j] = hasPressure(pt) ? UInt8(JSMath.max(1, JSMath.round(clamp(pt.p!, 0, 1) * 255))) : 0 }
            }
            s.append(.string(bytesToBase64(bytes)))
            if withPressure { p.append(.string(bytesToBase64(pbytes))) }
        }
        var ink = JSObject([("v", .number(3)), ("c", .number(grid)), ("s", .array(s))])
        if withPressure { ink["p"] = .array(p) }
        return .object(ink)
    }

    // MARK: 读取：形状判定与解码

    static func isIntegerValue(_ v: JSValue) -> Bool { if case .number(let d) = v { return d.isFinite && d.rounded(.towardZero) == d }; return false }

    static func intRow(_ v: JSValue?) -> [Double]? {
        guard case .array(let a)? = v, a.allSatisfy(isIntegerValue) else { return nil }
        return a.map { $0.numberValue! }
    }

    /// 旧 InkV2（JSON 数字编码）形状是否合法（与 core/schema.js 同口径，再加行长度一致）。
    public static func isInkV2(_ ink: JSValue?) -> Bool {
        guard let ink = ink, case .object = ink, case .number(let v)? = ink["v"], v == 2, case .number(let c)? = ink["c"], c.isFinite, c > 0 else { return false }
        guard case .array(let s)? = ink["s"] else { return false }
        var sRows: [[Double]] = []
        for r in s {
            guard let row = intRow(r), row.count % 3 == 0 else { return false }
            sRows.append(row)
        }
        for key in ["dt", "p"] {
            guard let v = ink[key] else { continue }
            guard case .array(let rows) = v, rows.count == s.count else { return false }
            for (i, r) in rows.enumerated() {
                guard let row = intRow(r), Double(row.count) == Double(sRows[i].count) / 3 else { return false }
            }
        }
        return true
    }

    /// Ink v3 形状是否合法：s / p 为 base64 串，s 每串字节数是 4 的倍数，p 与 s 逐笔点数一致。
    public static func isInkV3(_ ink: JSValue?) -> Bool {
        guard let ink = ink, case .object = ink, case .number(let v)? = ink["v"], v == 3, case .number(let c)? = ink["c"], c.isFinite, c > 0 else { return false }
        guard case .array(let s)? = ink["s"], ink["dt"] == nil else { return false }
        var counts: [Int] = []
        for str in s {
            guard case .string(let t) = str, let bytes = base64ToBytes(t), bytes.count % 4 == 0 else { return false }
            counts.append(bytes.count / 4)
        }
        if let pv = ink["p"] {
            guard case .array(let p) = pv, p.count == s.count else { return false }
            for i in 0..<p.count {
                guard case .string(let t) = p[i], let bytes = base64ToBytes(t), bytes.count == counts[i] else { return false }
            }
        }
        return true
    }

    /// 可读的墨迹（v4 原始点 / v3 / 旧 v2）。
    public static func isInk(_ ink: JSValue?) -> Bool { isInkV4(ink) || isInkV3(ink) || isInkV2(ink) }

    /// Ink（v4 / v3 / 旧 v2）→ 每笔 {x, y, w, t, p?}（345 空间，w 为绝对宽；t 从 0 起的累计 ms）。形状不合法返回 nil。
    /// v4 没有存宽度：按当前笔锋参数（opts 同 buildStroke）重算；v3 / v2 是烘焙好的宽度。
    public static func decodeInk(_ ink: JSValue?, options o: InkOptions = InkOptions()) throws -> [[InkPoint]]? {
        if isInkV4(ink) { return try decodeInkV4(ink!, o) }
        let base = num(o.base, o.policy != nil ? try InkParams(policy: o.policy).base : InkParams.standard.base)
        let scale = grid / 1000
        if isInkV3(ink), case .array(let s)? = ink?["s"] {
            var t = 0.0
            var strokes: [[InkPoint]] = []
            for (si, sv) in s.enumerated() {
                let bytes = base64ToBytes(sv.stringValue!)!
                var pbytes: [UInt8]?
                if case .array(let p)? = ink?["p"] { pbytes = base64ToBytes(p[si].stringValue!) }
                var pts: [InkPoint] = []
                var off = 0
                while off < bytes.count {
                    let x = (Int(bytes[off]) << 2) | (Int(bytes[off + 1]) >> 6)
                    let y = ((Int(bytes[off + 1]) & 63) << 4) | (Int(bytes[off + 2]) >> 4)
                    let w = ((Int(bytes[off + 2]) & 15) << 4) | (Int(bytes[off + 3]) >> 4)
                    t += dtLevels[Int(bytes[off + 3]) & 15]
                    var q = InkPoint(x: Double(x) * scale, y: Double(y) * scale, t: t, w: (Double(w) / 100) * base, order: InkPoint.orderXYWTP)
                    if let pb = pbytes, pb[off / 4] > 0 { q.p = Double(pb[off / 4]) / 255 }
                    pts.append(q)
                    off += 4
                }
                strokes.append(pts)
            }
            return strokes
        }
        guard isInkV2(ink), case .array(let s)? = ink?["s"] else { return nil }
        var t = 0.0
        var strokes: [[InkPoint]] = []
        let dt = ink?["dt"]?.arrayValue?.map { intRow($0)! }
        let pp = ink?["p"]?.arrayValue?.map { intRow($0)! }
        for (si, rv) in s.enumerated() {
            let row = intRow(rv)!
            var pts: [InkPoint] = []
            var j = 0
            while j < row.count {
                let idx = j / 3
                t += dt.map { $0[si][idx] } ?? 0
                var q = InkPoint(x: row[j] * scale, y: row[j + 1] * scale, t: t, w: (row[j + 2] / 100) * base, order: InkPoint.orderXYWTP)
                if let pp = pp { let pv = pp[si][idx]; if pv > 0 { q.p = pv / 100 } }
                pts.append(q)
                j += 3
            }
            strokes.append(pts)
        }
        return strokes
    }

    /// 解码后的每笔再过一次 Catmull-Rom（w / t / p 线性插值），得到可直接交给笔锋渲染的点列。
    public static func resampleForReplay(_ decoded: [[InkPoint]], step: Double = InkParams.standard.step) -> [[InkPoint]] {
        decoded.map { catmullRom($0, step: step) }
    }

    // MARK: 会话现场的原始笔画编码

    /// 原始采样（每笔 {x,y,t,p?}）→ 整数数组：[stride, x, y, dt, (p), …]（x / y ×10，dt 取整相邻差，p ×1000）。
    public static func encodeRawStrokes(_ rawStrokes: [[InkPoint]]) -> [[Double]] {
        rawStrokes.filter { !$0.isEmpty }.map { stroke in
            let pen = stroke.contains(where: hasPressure)
            var row: [Double] = [pen ? 4 : 3]
            let t0 = num(stroke[0].t, 0)
            var last = 0.0
            for pt in stroke {
                let rel = JSMath.max(last, JSMath.round(num(pt.t, t0) - t0))
                row.append(JSMath.round(pt.x * 10))
                row.append(JSMath.round(pt.y * 10))
                row.append(rel - last)
                if pen { row.append(hasPressure(pt) ? JSMath.round(clamp(pt.p!, 0, 1) * 1000) : 0) }
                last = rel
            }
            return row
        }
    }

    /// encodeRawStrokes 的逆；坏行跳过。t 从 0 起（每笔各自从 0 起）。
    public static func decodeRawStrokes(_ rows: [[Double]]) -> [[InkPoint]] {
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

    // MARK: Ink v4：原始点（B2.3，DQ2-C）

    static func zz(_ n: Double) -> Double { n >= 0 ? n * 2 : -n * 2 - 1 }
    static func unzz(_ u: Double) -> Double { u.truncatingRemainder(dividingBy: 2) == 0 ? u / 2 : -(u + 1) / 2 }

    static func pushVarint(_ out: inout [UInt8], _ u: Double) {
        var v = u
        while v >= 128 {
            out.append(UInt8(Int(v.truncatingRemainder(dividingBy: 128)) | 128))
            v = (v / 128).rounded(.down)
        }
        out.append(UInt8(Int(v)))
    }

    /// encodeRawStrokes 的一行是否合法（stride 3 / 4、整数、至少一个点）。
    public static func isRawStrokeRow(_ row: [Double]) -> Bool {
        guard row.count >= 4, row.allSatisfy({ $0.isFinite && $0.rounded(.towardZero) == $0 }) else { return false }
        let stride = Int(row[0])
        return (row[0] == 3 || row[0] == 4) && row.count >= 1 + stride && (row.count - 1) % stride == 0
    }

    /// encodeRawStrokes 的一行 → 打包串；行不合法返回 nil。
    public static func rawRowToPacked(_ row: [Double]) -> String? {
        guard isRawStrokeRow(row) else { return nil }
        let stride = Int(row[0])
        var bytes: [UInt8] = [UInt8(stride)]
        var px = 0.0, py = 0.0, pp = 0.0
        var j = 1
        while j < row.count {
            pushVarint(&bytes, zz(row[j] - px))
            pushVarint(&bytes, zz(row[j + 1] - py))
            pushVarint(&bytes, JSMath.max(0, row[j + 2]))
            px = row[j]
            py = row[j + 1]
            if stride == 4 {
                pushVarint(&bytes, zz(row[j + 3] - pp))
                pp = row[j + 3]
            }
            j += stride
        }
        return bytesToBase64(bytes)
    }

    /// 打包串 → encodeRawStrokes 的一行；坏串（base64 不对、变长整数截断 / 过长、没有点）返回 nil。
    public static func packedToRawRow(_ str: String) -> [Double]? {
        guard let bytes = base64ToBytes(str), bytes.count >= 4 else { return nil }
        let stride = Int(bytes[0])
        guard stride == 3 || stride == 4 else { return nil }
        var i = 1
        func next() -> Double? {
            var u = 0.0
            var mul = 1.0
            for _ in 0..<varintMaxBytes {
                if i >= bytes.count { return nil }
                let b = Int(bytes[i])
                i += 1
                u += Double(b & 127) * mul
                if b < 128 { return u }
                mul *= 128
            }
            return nil
        }
        var row: [Double] = [Double(stride)]
        var px = 0.0, py = 0.0, pp = 0.0
        while i < bytes.count {
            let dx = next()
            let dy = next()
            let dt = next()
            let dp: Double? = stride == 4 ? next() : 0
            guard let dxv = dx, let dyv = dy, let dtv = dt, let dpv = dp else { return nil }
            px += unzz(dxv)
            py += unzz(dyv)
            row.append(px); row.append(py); row.append(dtv)
            if stride == 4 {
                pp += unzz(dpv)
                row.append(pp)
            }
        }
        return row.count > 1 ? row : nil
    }

    /// 原始采样 → Ink v4：{v:4, c:345, r:[打包串…], g:[ms…]}。超过 inkMaxStrokes 笔只留前 inkMaxStrokes 笔（P05）。
    public static func encodeInkRaw(_ rawStrokes: [[InkPoint]], maxStrokes: Double? = nil, policy: JSObject? = nil) -> JSValue {
        let ms = num(maxStrokes, policyNumber(policy, "inkMaxStrokes") ?? .nan)
        let keepCount = JSMath.max(0, ms.rounded(.down))
        let nonEmpty = rawStrokes.filter { !$0.isEmpty }
        let kept = Array(nonEmpty.prefix(keepCount.isNaN ? 0 : (keepCount > Double(nonEmpty.count) ? nonEmpty.count : Int(keepCount))))
        let r: [JSValue] = encodeRawStrokes(kept).map { rawRowToPacked($0).map { JSValue.string($0) } ?? .null }
        var g: [JSValue] = []
        var lastEnd: Double?
        for stroke in kept {
            let t0 = num(stroke[0].t)
            if let le = lastEnd, let t0 = t0 { g.append(.number(JSMath.max(0, JSMath.round(t0 - le)))) } else { g.append(.number(0)) }
            var end = t0 // 本笔最后一点的时间（单调不减）
            for pt in stroke {
                if let t = num(pt.t, end ?? .nan) as Double?, !t.isNaN, end == nil || t > end! { end = t }
            }
            if let e = end { lastEnd = e }
        }
        return .object(JSObject([("v", .number(4)), ("c", .number(grid)), ("r", .array(r)), ("g", .array(g))]))
    }

    /// v4 → encodeRawStrokes 的行（每笔一行）；形状不对（含任一笔解不开）返回 nil。
    public static func inkRawRows(_ ink: JSValue?) -> [[Double]]? {
        guard let ink = ink, case .object = ink, case .number(let v)? = ink["v"], v == 4, case .number(let c)? = ink["c"], c.isFinite, c > 0 else { return nil }
        guard case .array(let r)? = ink["r"], case .array(let g)? = ink["g"], g.count == r.count else { return nil }
        for x in g { guard case .number(let d) = x, d.isFinite, d.rounded(.towardZero) == d, d >= 0 else { return nil } }
        var rows: [[Double]] = []
        for str in r {
            guard case .string(let s) = str, let row = packedToRawRow(s) else { return nil }
            rows.append(row)
        }
        return rows
    }

    /// Ink v4 是否合法（每笔都能解开、g 与 r 等长且为非负整数）。
    public static func isInkV4(_ ink: JSValue?) -> Bool { inkRawRows(ink) != nil }

    /// Ink v4 → 原始点（每笔 {x, y, t, p?}，t 为整份墨迹从 0 起的累计 ms，笔间停顿按 g 还原）。不是 v4 返回 nil。
    public static func decodeInkRaw(_ ink: JSValue?) -> [[InkPoint]]? {
        guard let rows = inkRawRows(ink), let ink = ink, let c = ink["c"]?.numberValue, case .array(let g)? = ink["g"] else { return nil }
        let scale = grid / c
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

    /// v4 解码成与 v3 相同的点列 {x, y, w, t, p?}：原始点 → buildStroke(final) 按当前笔锋参数算宽度。
    static func decodeInkV4(_ ink: JSValue, _ o: InkOptions) throws -> [[InkPoint]] {
        var opts = o
        opts.final = true
        return try (decodeInkRaw(ink) ?? []).map { s in
            try buildStroke(s, options: opts).points.map { q in
                var out = InkPoint(x: q.x, y: q.y, t: q.t, w: q.w, order: InkPoint.orderXYWTP)
                if let p = q.p { out.p = p }
                return out
            }
        }
    }

    /// 判断 / 看后自写存墨用的编码入口：format "raw"（缺省）→ Ink v4；"v3" → buildStroke(final) + encodeInk。
    public static func encodeStoredInk(_ rawStrokes: [[InkPoint]], policy: JSObject? = nil, format: String = "raw") throws -> JSValue {
        if format == "v3" {
            let built = try rawStrokes.filter { !$0.isEmpty }.map { try buildStroke($0, options: InkOptions(final: true)).points }
            return try encodeInk(built, options: EncodeOptions(policy: policy ?? (Config.policy.objectValue ?? JSObject())))
        }
        return encodeInkRaw(rawStrokes, policy: policy)
    }
}

// 存下的墨迹模型（B4.1 的 `Ink`，持有 base64 串 / 行）接上编解码：解包、形状判定、有没有笔画。
extension Ink {
    /// 每笔 {x, y, w, t, p?}（345 空间）；形状不合法返回 nil。v4 按当前笔锋参数重算宽度。
    public func decodedStrokes(options: InkOptions = InkOptions()) throws -> [[InkPoint]]? { try InkMath.decodeInk(js, options: options) }
    /// 形状是否合法（v4 每笔都解得开 / v3 / 旧 v2）。
    public var isReadable: Bool { InkMath.isInk(js) }
    /// 有没有非空的一笔（不解码）。
    public var hasStrokes: Bool { InkPick.inkHasStrokes(js) }
}
