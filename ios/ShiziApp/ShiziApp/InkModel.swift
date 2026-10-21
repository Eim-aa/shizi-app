import Foundation

// 拾字 笔锋模型 · Swift 移植（P1-S2 起；B2.1 随原生书写面转正进 Release；规格 docs/engineering/v10/phase1/笔锋模型规格.md，ink-model-1.0）。
//
// 逐函数对照 docs/engineering/v10/phase1/ink-model/reference.mjs（JS 参考实现，阶段 2 的契约）：
//   prepare → oneEuro → resample → analyze → geometry → unionArea，参数表 InkParams 与 PARAMS 一一对应。
// 纯函数、只依赖 Foundation：App 内（NativeInkView 每帧调用）与 macOS 命令行（swiftc 直接编译，见 InkModelCheck.swift）同一份源码。
// 金标准自检 InkModelCheck.swift 只在 DEBUG（XCTest ShiziWriteTests 与 -shizi-ink-selfcheck 用）。

enum InkModel {
    static let version = "ink-model-1.0"
    static let deg = Double.pi / 180
}

/// 原始点：345 单位格、ms、p ∈ [0, 1] 仅 Pencil（手指为 nil）。alt 为倾角（度），存储里没有（规格 §3.5）。
struct InkRawPoint: Equatable {
    var x: Double
    var y: Double
    var t: Double
    var p: Double? = nil
    var alt: Double? = nil
    var predicted = false

    var hasP: Bool { @_optimize(speed) get { (p ?? 0) > 0 } }
}

/// 默认参数（规格 §3 参数表；与 reference.mjs PARAMS 同名同值）。
struct InkParams {
    var base = 13.0
    var step = 1.0
    var tau = 35.0
    var vMin = 0.62
    var vK = 0.55
    var speedCap = 1.5
    var pressureLo = 0.42
    var pressureGain = 0.92
    var pressureHi = 1.38
    var dirPencil = 1.0
    var tiltGain = 0.0
    var tiltAlt0 = 60.0
    var dirAngle = -25.0
    var dirH = 0.72
    var dirV = 1.12
    var dirMin = 0.5
    var dirWin = 6.0
    var entryMs = 40.0
    var entryLenMin = 5.0
    var entryLenMax = 12.0
    var entryStart = 1.12
    var entryPeak = 1.35
    var entryPeakAt = 0.35
    var entryFastDamp = 0.4
    var cutAngle = 45.0
    var cutMinRel = 30.0
    var cutDirLen = 6.0
    var window = 30.0
    var lo = 0.25
    var hi = 0.9
    var stopLen = 7.0
    var stopPeak = 1.2
    var stopShift = 0.22
    var tapLenMin = 20.0
    var tapLenMax = 34.0
    var tapRatio = 0.4
    var endFast = 0.12
    var tapGamma = 0.6
    var dotLen = 24.0
    var dotProfile = (0.7, 1.1, 0.9)
    var single = 0.9
    var cornerAngle = 65.0
    var cornerWin = 6.0
    var cornerBoost = 0.25
    var miterLimit = 1.8
    var hookAngle = 100.0
    var hookMinLen = 4.0
    var hookMaxLen = 45.0
    var hookSpeedRatio = 1.6
    var hookPeakMs = 60.0
    var hookPress = 0.2
    var hookPressShift = 0.12
    var hookHold = 2.0
    var hookEnd = 0.1
    var hookGamma = 0.7
    var wMinRel = 0.04
    var wMaxRel = 2.4
    var euroMinCutoff = 6.0
    var euroBeta = 0.15
    var euroDCutoff = 10.0
    var liftBlend = 0.5
    var liftEaseMs = 70.0
    var predictWidth = 0.9
    var provisionalMin = 56.0
    var feibaiV0 = 0.7
    var feibaiV1 = 1.4
    var feibaiMax = 0.45
    var bloomRadius = 1.2
    var bloomMinMs = 60.0
    var bloomFullMs = 300.0
    var bloomSpread = 0.6
    var bloomAlpha = 0.14
    var sizeRef = 258.0
    var sizeGamma = 0.3
    var sizeCompMax = 1.5
    var hairlinePx = 0.75

    /// 方向因子两点解 a、b（reference.mjs params()）。
    var dirB: Double {
        let sh = abs(sin((0 - dirAngle) * InkModel.deg))
        let sv = abs(sin((90 - dirAngle) * InkModel.deg))
        return (dirV - dirH) / (sv - sh)
    }

    var dirA: Double {
        dirH - dirB * abs(sin((0 - dirAngle) * InkModel.deg))
    }

    static let `default` = InkParams()
}

struct InkSample {
    var s: Double
    var x: Double
    var y: Double
    var t: Double
    var v: Double
    var theta: Double
    var fBody: Double
    var fDir: Double
    var body: Double
    var fPhase: Double
    var w: Double
    var hwL: Double
    var hwR: Double
    var dry: Double
    var p: Double?
    var predicted: Bool
}

struct InkCorner {
    var i: Int
    var s: Double
    var turn: Double // 度
    var x: Double
    var y: Double
    var hookRejectedRatio: Double?
}

struct InkHook {
    var corner: InkCorner
    var len: Double
    var speedRatio: Double
    var meanBefore: Double
    var peak: Double
}

struct InkBloom {
    var s: Double
    var x: Double
    var y: Double
    var strength: Double
    var dwell: Double
    var slowEnd: Bool
}

struct InkProfile {
    var final: Bool
    var base: Double
    var single = false
    var dot = false
    var hook: InkHook?
    var corners: [InkCorner] = []
    var blooms: [InkBloom] = []
    var pressure = false
    var samples: [InkSample] = []
    var len = 0.0
    var v30: Double?
    var vIn: Double?
    var kk = 0.0
    // 起笔（规格 §4.3）
    var entryLe = 0.0
    var entryPeak = 0.0
    var theta0 = 0.0 // 弧度
    var cutRel = 90.0 // 度
    var capStart = "disc"
    var capEnd = "disc"
    var exitType = "disc"
    var exitLt = 0.0
    var endRel = 0.0
    var params: InkParams
}

struct InkGeometry {
    var polys: [[SIMD2<Double>]]
    var bbox: (Double, Double, Double, Double)
}

// MARK: - 小工具

@inline(__always) @_optimize(speed) private func clamp(_ x: Double, _ lo: Double, _ hi: Double) -> Double { x < lo ? lo : (x > hi ? hi : x) }
@inline(__always) @_optimize(speed) private func lerp(_ a: Double, _ b: Double, _ u: Double) -> Double { a + (b - a) * u }
@inline(__always) @_optimize(speed) private func smooth(_ u: Double) -> Double {
    let x = clamp(u, 0, 1)
    return x * x * (3 - 2 * x)
}
@inline(__always) @_optimize(speed) private func hyp(_ dx: Double, _ dy: Double) -> Double { (dx * dx + dy * dy).squareRoot() }
@inline(__always) @_optimize(speed) private func angleOf(_ ax: Double, _ ay: Double, _ bx: Double, _ by: Double) -> Double { atan2(by - ay, bx - ax) }
@inline(__always) @_optimize(speed) private func wrap(_ a: Double) -> Double {
    var x = a
    while x > Double.pi { x -= 2 * Double.pi }
    while x < -Double.pi { x += 2 * Double.pi }
    return x
}

/// 中线样本（重采样后）：位置、时间、可选压力 / 倾角、是否来自预测点。
struct InkMid {
    var x: Double
    var y: Double
    var t: Double
    var s: Double
    var p: Double?
    var alt: Double?
    var predicted: Bool
    var hasP: Bool { @_optimize(speed) get { (p ?? 0) > 0 } }
}

extension InkModel {
    // MARK: 因子（规格 §3）

    @_optimize(speed) static func speedFactor(_ v: Double, _ k: InkParams) -> Double {
        let vv = clamp(v, 0, k.speedCap)
        return 1 - (1 - k.vMin) * (1 - exp(-vv / k.vK))
    }

    @_optimize(speed) static func pressureFactor(_ p: Double, _ k: InkParams) -> Double {
        clamp(k.pressureLo + clamp(p, 0, 1).squareRoot() * k.pressureGain, k.pressureLo, k.pressureHi)
    }

    @_optimize(speed) static func tiltFactor(_ alt: Double?, _ k: InkParams) -> Double {
        guard k.tiltGain > 0, let alt else { return 1 }
        return 1 + k.tiltGain * clamp((k.tiltAlt0 - alt) / k.tiltAlt0, 0, 1)
    }

    @_optimize(speed) static func dirFactor(_ theta: Double, _ k: InkParams) -> Double {
        max(k.dirMin, k.dirA + k.dirB * abs(sin(theta - k.dirAngle * deg)))
    }

    @_optimize(speed) static func sizeComp(_ S: Double, _ k: InkParams = .default) -> Double {
        if S >= k.sizeRef { return 1 }
        return min(k.sizeCompMax, pow(S / k.sizeRef, -k.sizeGamma))
    }

    // MARK: 输入预处理（规格 §2）

    /// 零时间差合并（留最后位置，D09）；坏点丢弃；时间不单调时夹到前一点（再按零差合并）。
    @_optimize(speed) static func prepare(_ raw: [InkRawPoint]) -> [InkRawPoint] {
        var out: [InkRawPoint] = []
        out.reserveCapacity(raw.count)
        for r in raw {
            guard r.x.isFinite, r.y.isFinite else { continue }
            let prevT = out.last?.t ?? 0
            var t = r.t.isFinite ? r.t : prevT
            if !out.isEmpty, t < prevT { t = prevT }
            var q = InkRawPoint(x: r.x, y: r.y, t: t)
            if r.hasP { q.p = clamp(r.p!, 0, 1) }
            q.alt = r.alt
            q.predicted = r.predicted
            if !out.isEmpty, t == prevT { out[out.count - 1] = q } else { out.append(q) }
        }
        return out
    }

    /// 向量 1€（指数 α = 1 − e^(−2π·fc·Δt)，速度取模长，两轴共用截止频率）。
    @_optimize(speed) static func oneEuro(_ points: [InkRawPoint], _ k: InkParams) -> [InkRawPoint] {
        var out: [InkRawPoint] = []
        out.reserveCapacity(points.count)
        var xh = 0.0, yh = 0.0, dh = 0.0, tp = 0.0
        for (i, q) in points.enumerated() {
            if i == 0 {
                xh = q.x; yh = q.y; tp = q.t
                out.append(q)
                continue
            }
            let dt = (q.t - tp) / 1000
            if !(dt > 0) {
                var o = q; o.x = xh; o.y = yh
                out.append(o)
                continue
            }
            let sp = hyp(q.x - xh, q.y - yh) / dt
            let ad = 1 - exp(-2 * Double.pi * k.euroDCutoff * dt)
            dh = ad * sp + (1 - ad) * dh
            let fc = k.euroMinCutoff + k.euroBeta * dh
            let a = 1 - exp(-2 * Double.pi * fc * dt)
            xh = a * q.x + (1 - a) * xh
            yh = a * q.y + (1 - a) * yh
            tp = q.t
            var o = q; o.x = xh; o.y = yh
            out.append(o)
        }
        return out
    }

    /// 抬笔前 window ms 均速（D09：不足 window 用整段时长）。点少于 2 个返回 nil。
    @_optimize(speed) static func liftSpeed(_ m: [(x: Double, y: Double, t: Double)], _ windowMs: Double) -> Double? {
        let n = m.count
        if n < 2 { return nil }
        let tl = m[n - 1].t
        let t0 = tl - windowMs
        var i = n - 1
        var d = 0.0
        while i > 0, m[i - 1].t >= t0 {
            d += hyp(m[i].x - m[i - 1].x, m[i].y - m[i - 1].y)
            i -= 1
        }
        var dt = tl - m[i].t
        if i > 0 {
            let a = m[i - 1], b = m[i]
            let u = (b.t - t0) / (b.t - a.t)
            d += hyp(b.x - a.x, b.y - a.y) * u
            dt = windowMs
        }
        return dt > 0 ? d / dt : 0
    }

    @_optimize(speed) static func liftSpeed(_ m: [InkRawPoint], _ windowMs: Double) -> Double? {
        liftSpeed(m.map { (x: $0.x, y: $0.y, t: $0.t) }, windowMs)
    }

    /// 落笔后 window ms 均速（liftSpeed 的镜像）。
    @_optimize(speed) static func startSpeed(_ m: [InkRawPoint], _ windowMs: Double) -> Double? {
        liftSpeed(m.reversed().map { (x: $0.x, y: $0.y, t: -$0.t) }, windowMs)
    }

    // MARK: 重采样（规格 §2.4）

    /// 向心 Catmull-Rom 稠密化（端点镜像补控制点），段内 t / p 按弧长线性；再按等弧长 Δs 重采样。
    @_optimize(speed) static func resample(_ P: [InkRawPoint], _ k: InkParams) -> [InkMid] {
        let n = P.count
        if n == 1 { return [InkMid(x: P[0].x, y: P[0].y, t: P[0].t, s: 0, p: P[0].p, alt: P[0].alt, predicted: P[0].predicted)] }
        // 稠密点用平铺数组（-Onone 的 DEBUG 构建里局部结构体与嵌套函数不被优化，平铺后每帧快约 2 倍；算术顺序与 reference.mjs 逐式相同）
        var dX: [Double] = [], dY: [Double] = [], dT: [Double] = [], dP: [Double] = [], dAlt: [Double] = []
        var dHasP: [Bool] = [], dHasAlt: [Bool] = [], dPred: [Bool] = []
        let cap = n * 8
        dX.reserveCapacity(cap); dY.reserveCapacity(cap); dT.reserveCapacity(cap); dP.reserveCapacity(cap); dAlt.reserveCapacity(cap)
        dHasP.reserveCapacity(cap); dHasAlt.reserveCapacity(cap); dPred.reserveCapacity(cap)
        var px: [Double] = [], py: [Double] = [], lens: [Double] = []
        for i in 0..<(n - 1) {
            let p1 = P[i], p2 = P[i + 1]
            let p0x = i == 0 ? 2 * P[0].x - P[1].x : P[i - 1].x
            let p0y = i == 0 ? 2 * P[0].y - P[1].y : P[i - 1].y
            let p3x = i + 2 < n ? P[i + 2].x : 2 * P[n - 1].x - P[n - 2].x
            let p3y = i + 2 < n ? P[i + 2].y : 2 * P[n - 1].y - P[n - 2].y
            let segChord = hyp(p2.x - p1.x, p2.y - p1.y)
            let M = max(4, Int((segChord / 0.25).rounded(.up)))
            let t0 = 0.0
            let t1 = t0 + max(1e-4, hyp(p1.x - p0x, p1.y - p0y).squareRoot())
            let t2 = t1 + max(1e-4, hyp(p2.x - p1.x, p2.y - p1.y).squareRoot())
            let t3 = t2 + max(1e-4, hyp(p3x - p2.x, p3y - p2.y).squareRoot())
            px.removeAll(keepingCapacity: true)
            py.removeAll(keepingCapacity: true)
            for j in 0...M {
                if j == M, i < n - 2 { break } // 段尾留给下一段
                if segChord < 1e-9 {
                    px.append(p1.x); py.append(p1.y)
                    continue
                }
                let tt = t1 + ((t2 - t1) * Double(j)) / Double(M)
                // Barry–Goldman：L(pa, pb, ta, tb) = pa + (pb − pa)·(tt − ta)/(tb − ta)
                var u = (tt - t0) / (t1 - t0)
                let a1x = p0x + (p1.x - p0x) * u, a1y = p0y + (p1.y - p0y) * u
                u = (tt - t1) / (t2 - t1)
                let a2x = p1.x + (p2.x - p1.x) * u, a2y = p1.y + (p2.y - p1.y) * u
                u = (tt - t2) / (t3 - t2)
                let a3x = p2.x + (p3x - p2.x) * u, a3y = p2.y + (p3y - p2.y) * u
                u = (tt - t0) / (t2 - t0)
                let b1x = a1x + (a2x - a1x) * u, b1y = a1y + (a2y - a1y) * u
                u = (tt - t1) / (t3 - t1)
                let b2x = a2x + (a3x - a2x) * u, b2y = a2y + (a3y - a2y) * u
                u = (tt - t1) / (t2 - t1)
                px.append(b1x + (b2x - b1x) * u)
                py.append(b1y + (b2y - b1y) * u)
            }
            // 段内弧长 → 时间 / 压力线性
            var acc = 0.0
            lens.removeAll(keepingCapacity: true)
            lens.append(0)
            let cnt = px.count
            if cnt > 1 {
                for j in 1..<cnt {
                    acc += hyp(px[j] - px[j - 1], py[j] - py[j - 1])
                    lens.append(acc)
                }
            }
            let segLen = i < n - 2 ? acc + hyp(p2.x - px[cnt - 1], p2.y - py[cnt - 1]) : acc
            let withP = p1.hasP || p2.hasP
            let withAlt = p1.alt != nil && p2.alt != nil
            for j in 0..<cnt {
                let u = segLen > 1e-9 ? lens[j] / segLen : Double(j) / Double(max(1, cnt - 1))
                dX.append(px[j]); dY.append(py[j]); dT.append(lerp(p1.t, p2.t, u))
                dHasP.append(withP); dP.append(withP ? lerp(p1.p ?? 0, p2.p ?? 0, u) : 0)
                dHasAlt.append(withAlt); dAlt.append(withAlt ? lerp(p1.alt!, p2.alt!, u) : 0)
                dPred.append(p2.predicted)
            }
        }
        // 等弧长
        let dn = dX.count
        var S = [Double](repeating: 0, count: dn)
        for j in 1..<dn { S[j] = S[j - 1] + hyp(dX[j] - dX[j - 1], dY[j] - dY[j - 1]) }
        let len = S[dn - 1]
        var out: [InkMid] = []
        let count = max(1, Int((len / k.step - 1e-9).rounded(.up)))
        out.reserveCapacity(count + 1)
        var j = 0
        for m in 0...count {
            let s = m == count ? len : Double(m) * k.step
            while j < dn - 2, S[j + 1] < s { j += 1 }
            var a = j
            var b = min(j + 1, dn - 1)
            if m == count {
                a = dn - 1
                b = a
            }
            let span = S[b] - S[a]
            let u = span > 1e-12 ? clamp((s - S[a]) / span, 0, 1) : 0
            var q = InkMid(x: lerp(dX[a], dX[b], u), y: lerp(dY[a], dY[b], u), t: lerp(dT[a], dT[b], u), s: s, p: nil, alt: nil, predicted: false)
            if dHasP[a] || dHasP[b] { q.p = lerp(dP[a], dP[b], u) }
            if dHasAlt[a], dHasAlt[b] { q.alt = lerp(dAlt[a], dAlt[b], u) }
            if dPred[b], u > 0 { q.predicted = true }
            out.append(q)
        }
        return out
    }

    /// 弧长 s 处的位置与时间（线性插值）；s 越界取端样本。
    @_optimize(speed) static func posAt(_ S: [InkMid], _ s: Double) -> (x: Double, y: Double, t: Double) {
        let n = S.count
        if s <= 0 { return (S[0].x, S[0].y, S[0].t) }
        if s >= S[n - 1].s { return (S[n - 1].x, S[n - 1].y, S[n - 1].t) }
        var lo = 0, hi = n - 1
        while hi - lo > 1 {
            let mid = (lo + hi) >> 1
            if S[mid].s <= s { lo = mid } else { hi = mid }
        }
        let A = S[lo], B = S[hi]
        let u = (s - A.s) / max(1e-12, B.s - A.s)
        return (lerp(A.x, B.x, u), lerp(A.y, B.y, u), lerp(A.t, B.t, u))
    }

    @_optimize(speed) static func posAt(_ S: [InkSample], _ s: Double) -> (x: Double, y: Double) {
        let n = S.count
        if s <= 0 { return (S[0].x, S[0].y) }
        if s >= S[n - 1].s { return (S[n - 1].x, S[n - 1].y) }
        var lo = 0, hi = n - 1
        while hi - lo > 1 {
            let mid = (lo + hi) >> 1
            if S[mid].s <= s { lo = mid } else { hi = mid }
        }
        let A = S[lo], B = S[hi]
        let u = (s - A.s) / max(1e-12, B.s - A.s)
        return (lerp(A.x, B.x, u), lerp(A.y, B.y, u))
    }

    /// 弧长 s 处的宽度（线性插值）。
    @_optimize(speed) static func posAtW(_ S: [InkSample], _ s: Double) -> Double {
        let n = S.count
        if s <= 0 { return S[0].w }
        if s >= S[n - 1].s { return S[n - 1].w }
        var lo = 0, hi = n - 1
        while hi - lo > 1 {
            let mid = (lo + hi) >> 1
            if S[mid].s <= s { lo = mid } else { hi = mid }
        }
        let u = (s - S[lo].s) / max(1e-12, S[hi].s - S[lo].s)
        return lerp(S[lo].w, S[hi].w, u)
    }

    // MARK: 分析（规格 §3）

    /// 原始点 → 宽度剖面（reference.mjs analyze）。
    @_optimize(speed) static func analyze(_ raw: [InkRawPoint], final: Bool = true, predicted: [InkRawPoint] = [], reduceMotion: Bool = false, params k: InkParams = .default) -> InkProfile {
        let m = prepare(raw)
        let B = k.base
        var res = InkProfile(final: final, base: B, params: k)
        res.pressure = m.contains { $0.hasP }
        if m.isEmpty { return res }

        // 单点（D09）：合并后只有一个点或总位移为 0
        var totalMove = 0.0
        for i in 1..<max(1, m.count) { totalMove += hyp(m[i].x - m[i - 1].x, m[i].y - m[i - 1].y) }
        if m.count == 1 || totalMove < 1e-6 {
            let last = m[m.count - 1]
            let fb = last.hasP ? pressureFactor(last.p!, k) : 1
            let w = B * fb * tiltFactor(last.alt, k) * k.single
            res.single = true
            res.samples = [InkSample(s: 0, x: last.x, y: last.y, t: last.t, v: 0, theta: 0, fBody: fb, fDir: 1, body: B * fb, fPhase: k.single, w: w, hwL: w / 2, hwR: w / 2, dry: 0, p: last.p, predicted: false)]
            res.capStart = "disc"
            res.capEnd = "disc"
            res.exitType = "disc"
            res.len = 0
            let dwell = last.t - m[0].t
            if dwell >= k.bloomMinMs, !reduceMotion {
                res.blooms.append(InkBloom(s: 0, x: last.x, y: last.y, strength: min(1, dwell / k.bloomFullMs), dwell: dwell, slowEnd: false))
            }
            return res
        }

        var f = oneEuro(m, k)
        if final { f[f.count - 1] = m[m.count - 1] } // 抬笔锁尾到原始末点
        if !final, !predicted.isEmpty {
            let pr = prepare([f[f.count - 1]] + predicted).dropFirst().map { q -> InkRawPoint in
                var o = q; o.predicted = true; return o
            }
            f.append(contentsOf: pr)
        }
        let S = resample(f, k)
        let n = S.count
        let len = S[n - 1].s
        res.len = len

        // 速度（段内按弧长线性，故采样率无关）
        var v = [Double](repeating: 0, count: n)
        if n > 1 {
            for i in 1..<n {
                let dt = S[i].t - S[i - 1].t
                v[i] = dt > 0 ? (S[i].s - S[i - 1].s) / dt : v[i - 1]
            }
        }
        v[0] = n > 1 ? v[1] : 0

        // 方向
        var theta = [Double](repeating: 0, count: n)
        for i in 0..<n {
            let a = posAt(S, S[i].s - k.dirWin)
            let b = posAt(S, S[i].s + k.dirWin)
            theta[i] = angleOf(a.x, a.y, b.x, b.y)
        }

        // 本体因子 + 时间平滑（τ）
        var fBody = [Double](repeating: 0, count: n)
        var vsArr = [Double](repeating: 0, count: n)
        var wb = 0.0, vs = 0.0
        for i in 0..<n {
            let target = (S[i].hasP ? pressureFactor(S[i].p!, k) : speedFactor(v[i], k)) * tiltFactor(S[i].alt, k)
            if i == 0 {
                wb = target
                vs = v[i]
            } else {
                let dt = S[i].t - S[i - 1].t
                if dt > 0 {
                    let a = 1 - exp(-dt / k.tau)
                    wb += (target - wb) * a
                    vs += (v[i] - vs) * a
                }
            }
            fBody[i] = wb
            vsArr[i] = vs
        }

        let dot = final && len < k.dotLen
        res.dot = dot
        let v30 = liftSpeed(m, k.window)
        let vIn = startSpeed(m, k.entryMs)
        res.v30 = v30
        res.vIn = vIn
        let kk = clamp(((v30 ?? 0) - k.lo) / max(1e-6, k.hi - k.lo), 0, 1)
        res.kk = kk

        // 折：转角检测（弧长窗 ±cornerWin）
        var turn = [Double](repeating: 0, count: n)
        for i in 0..<n {
            let q = S[i]
            if q.s < k.cornerWin * 0.5 || q.s > len - k.cornerWin * 0.5 { continue }
            let a = posAt(S, q.s - k.cornerWin)
            let b = posAt(S, q.s + k.cornerWin)
            turn[i] = wrap(angleOf(q.x, q.y, b.x, b.y) - angleOf(a.x, a.y, q.x, q.y))
        }
        var corners: [InkCorner] = []
        if !dot {
            var i = 0
            let lim = k.cornerAngle * deg
            while i < n {
                if abs(turn[i]) >= lim {
                    var j = i
                    var best = i
                    while j < n, abs(turn[j]) >= lim {
                        if abs(turn[j]) > abs(turn[best]) { best = j }
                        j += 1
                    }
                    corners.append(InkCorner(i: best, s: S[best].s, turn: turn[best] / deg, x: S[best].x, y: S[best].y))
                    i = j
                } else {
                    i += 1
                }
            }
        }

        // 钩
        var hook: InkHook?
        if !dot, let c = corners.last {
            let tail = len - c.s
            if abs(c.turn) >= k.hookAngle, tail >= k.hookMinLen, tail <= k.hookMaxLen {
                let tc = S[c.i].t
                let meanBefore = c.s / max(1e-6, tc - S[0].t)
                let dep = min(n - 1, c.i + 1)
                let tDep = S[dep].t
                var peak = 0.0
                var i = dep
                while i < n {
                    if S[i].t - tDep > k.hookPeakMs { break }
                    peak = max(peak, v[i])
                    i += 1
                }
                let ratio = peak / max(1e-6, meanBefore)
                if ratio >= k.hookSpeedRatio {
                    hook = InkHook(corner: c, len: tail, speedRatio: ratio, meanBefore: meanBefore, peak: peak)
                } else {
                    corners[corners.count - 1].hookRejectedRatio = ratio
                }
            }
        }
        res.hook = hook
        res.corners = corners

        // 起笔
        let vInV = vIn ?? 0
        let kIn = clamp((vInV - k.lo) / max(1e-6, k.hi - k.lo), 0, 1)
        let Le = clamp(vInV * k.entryMs, k.entryLenMin, k.entryLenMax)
        let peakE = 1 + (k.entryPeak - 1) * (1 - k.entryFastDamp * kIn)
        @_optimize(speed) func fEntry(_ s: Double) -> Double {
            if s >= Le { return 1 }
            let u = s / Le
            if u < k.entryPeakAt { return lerp(k.entryStart, peakE, smooth(u / k.entryPeakAt)) }
            return lerp(peakE, 1, smooth((u - k.entryPeakAt) / (1 - k.entryPeakAt)))
        }

        // 收笔
        let Ls = k.stopLen
        let Lt = min(k.tapRatio * len, lerp(k.tapLenMin, k.tapLenMax, kk))
        @_optimize(speed) func fSlow(_ s: Double) -> Double { len - s < Ls ? 1 + (k.stopPeak - 1) * smooth(1 - (len - s) / Ls) : 1 }
        @_optimize(speed) func fFast(_ s: Double) -> Double { len - s < Lt ? k.endFast + (1 - k.endFast) * pow((len - s) / Lt, k.tapGamma) : 1 }
        let blend = final ? 1 : k.liftBlend
        @_optimize(speed) func fExit(_ s: Double) -> Double { lerp(1, lerp(fSlow(s), fFast(s), kk), blend) }
        let hookStart = hook.map { $0.corner.s + k.hookHold } ?? Double.infinity
        @_optimize(speed) func fHook(_ s: Double) -> Double {
            if s <= hookStart { return 1 }
            let u = clamp((len - s) / max(1e-6, len - hookStart), 0, 1)
            return lerp(1, k.hookEnd + (1 - k.hookEnd) * pow(u, k.hookGamma), blend)
        }

        var samples: [InkSample] = []
        samples.reserveCapacity(n)
        let (d0, d1, d2) = k.dotProfile
        let dirA = k.dirA, dirB = k.dirB, dirOff = k.dirAngle * deg
        for i in 0..<n {
            let s = S[i].s
            let fDir0 = max(k.dirMin, dirA + dirB * abs(sin(theta[i] - dirOff))) // = dirFactor(theta, k)，系数提到循环外
            let fDir = S[i].hasP ? 1 + (fDir0 - 1) * k.dirPencil : fDir0
            let body = B * fBody[i] * fDir
            let fPhase: Double
            if dot {
                let u = len > 0 ? s / len : 0
                fPhase = u < 0.5 ? lerp(d0, d1, u / 0.5) : lerp(d1, d2, (u - 0.5) / 0.5)
            } else {
                fPhase = fEntry(s) * (hook != nil ? fHook(s) : fExit(s))
            }
            var w = clamp(body * fPhase, k.wMinRel * B, k.wMaxRel * B)
            let dry = reduceMotion ? 0 : k.feibaiMax * smooth((vsArr[i] - k.feibaiV0) / (k.feibaiV1 - k.feibaiV0))
            var hw = w / 2
            if S[i].predicted {
                w *= k.predictWidth
                hw = hw * k.predictWidth
            }
            samples.append(InkSample(s: s, x: S[i].x, y: S[i].y, t: S[i].t, v: v[i], theta: theta[i], fBody: fBody[i], fDir: fDir, body: body, fPhase: fPhase, w: w, hwL: hw, hwR: hw, dry: dry, p: S[i].p, predicted: S[i].predicted))
        }
        res.samples = samples

        // 起笔斜切参数（规格 §4.3）
        let p0 = samples[0]
        let pd = posAt(S, min(k.cutDirLen, len))
        let th0 = angleOf(p0.x, p0.y, pd.x, pd.y)
        let rel = abs(wrap(2 * (k.cutAngle * deg - th0)) / 2)
        let cutRel = rel / deg
        res.entryLe = Le
        res.entryPeak = peakE
        res.theta0 = th0
        res.cutRel = cutRel
        let pointy = cutRel < k.cutMinRel + 5
        res.capStart = pointy ? "point" : "cut"

        // 收笔描述
        let last = samples[n - 1]
        let endRel = last.w / max(1e-6, last.body)
        let exitType: String
        if dot { exitType = "dot" } else if hook != nil { exitType = "hook" } else { exitType = endRel >= 0.5 ? "round" : "taper" }
        res.exitType = exitType
        res.exitLt = Lt
        res.endRel = endRel
        res.capEnd = exitType

        // 洇墨：停顿（原始点在 bloomRadius 内停留 ≥ bloomMinMs）+ 慢收
        if !reduceMotion {
            var i = 0
            while i < m.count {
                var j = i + 1
                while j < m.count, hyp(m[j].x - m[i].x, m[j].y - m[i].y) <= k.bloomRadius { j += 1 }
                let dwell = m[j - 1].t - m[i].t
                if dwell >= k.bloomMinMs {
                    var cx = 0.0, cy = 0.0
                    for q in i..<j { cx += m[q].x; cy += m[q].y }
                    cx /= Double(j - i)
                    cy /= Double(j - i)
                    var best = 0
                    var bd = Double.infinity
                    for (qi, q) in samples.enumerated() {
                        let d = hyp(q.x - cx, q.y - cy)
                        if d < bd { bd = d; best = qi }
                    }
                    res.blooms.append(InkBloom(s: samples[best].s, x: samples[best].x, y: samples[best].y, strength: min(1, dwell / k.bloomFullMs), dwell: dwell, slowEnd: false))
                    i = j
                } else {
                    i += 1
                }
            }
            if final, hook == nil, !dot, kk < 0.2, !res.blooms.contains(where: { len - $0.s < 3 }) {
                res.blooms.append(InkBloom(s: len, x: last.x, y: last.y, strength: 0.35 * (1 - kk / 0.2), dwell: 0, slowEnd: true))
            }
        }
        return res
    }

    /// 前缀冻结区：距笔尖弧长 ≥ Z 的样本不再变化（规格 §7.2）。
    @_optimize(speed) static func provisionalZone(_ rawPrefix: [InkRawPoint], _ k: InkParams = .default) -> Double {
        let m = prepare(rawPrefix)
        let n = m.count
        var tail2 = 0.0
        if n > 1 {
            for i in max(1, n - 2)..<n { tail2 += hyp(m[i].x - m[i - 1].x, m[i].y - m[i - 1].y) }
        }
        return max(k.provisionalMin, tail2 + 6)
    }

    /// 宽度剖面在弧长 s 处的值（线性插值）。
    @_optimize(speed) static func widthAt(_ profile: InkProfile, _ s: Double) -> Double {
        let S = profile.samples
        if S.isEmpty { return 0 }
        if S.count == 1 { return S[0].w }
        let n = S.count
        if s <= 0 { return S[0].w }
        if s >= S[n - 1].s { return S[n - 1].w }
        var i = 0
        while i < n - 2, S[i + 1].s < s { i += 1 }
        let u = (s - S[i].s) / max(1e-12, S[i + 1].s - S[i].s)
        return lerp(S[i].w, S[i + 1].w, u)
    }

    // MARK: 几何（规格 §4）

    @_optimize(speed) private static func orient(_ poly: [SIMD2<Double>]) -> [SIMD2<Double>] {
        var a = 0.0
        for i in 0..<poly.count {
            let p = poly[i], q = poly[(i + 1) % poly.count]
            a += p.x * q.y - q.x * p.y
        }
        return a < 0 ? poly.reversed() : poly
    }

    /// 多边形被半平面 {X : dot(X − O, nrm) ≥ 0} 裁剪（Sutherland–Hodgman）。
    @_optimize(speed) private static func clipHalf(_ poly: [SIMD2<Double>], _ O: SIMD2<Double>, _ nrm: SIMD2<Double>) -> [SIMD2<Double>] {
        var out: [SIMD2<Double>] = []
        @_optimize(speed) @inline(__always) func f(_ P: SIMD2<Double>) -> Double { (P.x - O.x) * nrm.x + (P.y - O.y) * nrm.y }
        for i in 0..<poly.count {
            let A = poly[i], Bp = poly[(i + 1) % poly.count]
            let fa = f(A), fb = f(Bp)
            if fa >= 0 { out.append(A) }
            if (fa >= 0) != (fb >= 0) {
                let u = fa / (fa - fb)
                out.append(SIMD2(A.x + (Bp.x - A.x) * u, A.y + (Bp.y - A.y) * u))
            }
        }
        return out
    }

    /// 宽度剖面 → 几何：多边形列表（每个都是逆时针，按非零规则取并集；reference.mjs geometry）。
    @_optimize(speed) static func geometry(_ profile: InkProfile, capSegments seg: Int = 16) -> InkGeometry {
        let k = profile.params
        let S = profile.samples
        var polys: [[SIMD2<Double>]] = []
        if S.isEmpty { return InkGeometry(polys: [], bbox: (0, 0, 0, 0)) }
        @_optimize(speed) func disc(_ cx: Double, _ cy: Double, _ r: Double) -> [SIMD2<Double>] {
            var d: [SIMD2<Double>] = []
            d.reserveCapacity(seg * 2)
            for i in 0..<(seg * 2) {
                let a = (Double(i) / Double(seg * 2)) * Double.pi * 2
                d.append(SIMD2(cx + cos(a) * r, cy + sin(a) * r))
            }
            return orient(d)
        }
        if profile.single || S.count == 1 {
            let q = S[0]
            polys.append(disc(q.x, q.y, q.w / 2))
            return finish(polys)
        }
        let n = S.count
        var T = [SIMD2<Double>](repeating: .zero, count: n)
        for i in 0..<n {
            let a = S[max(0, i - 1)], b = S[min(n - 1, i + 1)]
            var L = hyp(b.x - a.x, b.y - a.y)
            if L == 0 { L = 1 }
            T[i] = SIMD2((b.x - a.x) / L, (b.y - a.y) / L)
        }
        let N = T.map { SIMD2(-$0.y, $0.x) }
        var Lp = [SIMD2<Double>](repeating: .zero, count: n)
        var Rp = [SIMD2<Double>](repeating: .zero, count: n)
        for i in 0..<n {
            Lp[i] = SIMD2(S[i].x + N[i].x * S[i].hwL, S[i].y + N[i].y * S[i].hwL)
            Rp[i] = SIMD2(S[i].x - N[i].x * S[i].hwR, S[i].y - N[i].y * S[i].hwR)
        }

        // 起笔：沿起笔方向向后延伸 e，再用斜切线裁掉切线后方（规格 §4.3）
        let p0 = S[0]
        let th0 = profile.theta0
        let t0 = SIMD2(cos(th0), sin(th0))
        let relDeg = profile.cutRel
        let relEff = max(k.cutMinRel, relDeg) * deg
        var cut = k.cutAngle * deg
        if relDeg < k.cutMinRel {
            let d = wrap(2 * (cut - th0)) / 2
            cut = th0 + (d >= 0 ? 1 : -1) * k.cutMinRel * deg
        }
        let c = SIMD2(cos(cut), sin(cut))
        let hw0 = max(p0.hwL, p0.hwR)
        let e = hw0 / tan(relEff) + 0.5
        let back = SIMD2(p0.x - t0.x * e, p0.y - t0.y * e)
        let nb = SIMD2(-t0.y, t0.x)
        let bL = SIMD2(back.x + nb.x * p0.hwL, back.y + nb.y * p0.hwL)
        let bR = SIMD2(back.x - nb.x * p0.hwR, back.y - nb.y * p0.hwR)
        let ext = [bL, bR, Rp[0], Lp[0]]
        var cn = SIMD2(-c.y, c.x)
        if cn.x * t0.x + cn.y * t0.y < 0 { cn = -cn }
        let O = SIMD2(p0.x, p0.y)
        let clipS = 2 * e + 2
        let extC = clipHalf(ext, O, cn)
        if extC.count >= 3 { polys.append(orient(extC)) }
        for i in 0..<(n - 1) {
            let t1 = [Lp[i], Rp[i], Rp[i + 1]]
            let t2 = [Lp[i], Rp[i + 1], Lp[i + 1]]
            if S[i].s <= clipS {
                let c1 = clipHalf(t1, O, cn)
                if c1.count >= 3 { polys.append(orient(c1)) }
                let c2 = clipHalf(t2, O, cn)
                if c2.count >= 3 { polys.append(orient(c2)) }
            } else {
                polys.append(orient(t1))
                polys.append(orient(t2))
            }
        }

        // 末端圆帽
        let qe = S[n - 1]
        let te = T[n - 1]
        let ne = N[n - 1]
        let re = (qe.hwL + qe.hwR) / 2
        var cap: [SIMD2<Double>] = [SIMD2(qe.x, qe.y)]
        for i in 0...seg {
            let a = (Double(i) / Double(seg)) * Double.pi
            let ca = cos(a), sa = sin(a)
            cap.append(SIMD2(qe.x + (ne.x * ca + te.x * sa) * re, qe.y + (ne.y * ca + te.y * sa) * re))
        }
        polys.append(orient(cap))

        let cd = SIMD2(cos(k.cutAngle * deg), sin(k.cutAngle * deg))
        // 慢收顿笔：末端圆向 ↘ 偏出（规格 §3.7）
        if profile.exitType == "round", profile.kk < 1 {
            let sh = k.stopShift * qe.w * (1 - profile.kk)
            if sh > 0.05 { polys.append(disc(qe.x + cd.x * sh, qe.y + cd.y * sh, re * 0.92)) }
        }

        // 折角外侧「耳」；钩的转角改为圆顿（规格 §4.4）
        for cr in profile.corners {
            let q = S[cr.i]
            if let hook = profile.hook, hook.corner.s == cr.s {
                let r = q.w / 2 * (1 + k.hookPress / 2)
                let sh = k.hookPressShift * q.w
                polys.append(disc(q.x + cd.x * sh, q.y + cd.y * sh, r))
                continue
            }
            let a = posAt(S, q.s - k.cornerWin)
            let b = posAt(S, q.s + k.cornerWin)
            var din = SIMD2(q.x - a.x, q.y - a.y)
            var dout = SIMD2(b.x - q.x, b.y - q.y)
            var li = hyp(din.x, din.y); if li == 0 { li = 1 }
            var lo = hyp(dout.x, dout.y); if lo == 0 { lo = 1 }
            din /= li
            dout /= lo
            let sgn: Double = cr.turn > 0 ? -1 : 1
            let hwIn = posAtW(S, q.s - k.cornerWin) / 2
            let hwOut = posAtW(S, q.s + k.cornerWin) / 2
            let nIn = SIMD2(-din.y * sgn, din.x * sgn)
            let nOut = SIMD2(-dout.y * sgn, dout.x * sgn)
            let A = SIMD2(q.x + nIn.x * hwIn, q.y + nIn.y * hwIn)
            let C = SIMD2(q.x + nOut.x * hwOut, q.y + nOut.y * hwOut)
            let den = din.x * dout.y - din.y * dout.x
            var M: SIMD2<Double>
            if abs(den) < 1e-6 {
                M = (A + C) / 2
            } else {
                let u = ((C.x - A.x) * dout.y - (C.y - A.y) * dout.x) / den
                M = SIMD2(A.x + din.x * u, A.y + din.y * u)
            }
            var bx = M.x - q.x, by = M.y - q.y
            var bl = hyp(bx, by); if bl == 0 { bl = 1 }
            bx /= bl
            by /= bl
            let hwMax = max(hwIn, hwOut)
            let reach = min(bl + k.cornerBoost * hwOut, k.miterLimit * hwMax)
            M = SIMD2(q.x + bx * reach, q.y + by * reach)
            polys.append(orient([SIMD2(q.x, q.y), A, M, C]))
        }
        return finish(polys)
    }

    @_optimize(speed) private static func finish(_ polys: [[SIMD2<Double>]]) -> InkGeometry {
        var x0 = Double.infinity, y0 = Double.infinity, x1 = -Double.infinity, y1 = -Double.infinity
        for p in polys {
            for v in p {
                if v.x < x0 { x0 = v.x }
                if v.y < y0 { y0 = v.y }
                if v.x > x1 { x1 = v.x }
                if v.y > y1 { y1 = v.y }
            }
        }
        return InkGeometry(polys: polys, bbox: (x0, y0, x1, y1))
    }

    /// 非零规则并集面积（扫描线，行距 h 单位）。
    @_optimize(speed) static func unionArea(_ geom: InkGeometry, h: Double = 0.1) -> Double {
        let (_, y0, _, y1) = geom.bbox
        if !(y1 > y0) { return 0 }
        let rows = Int(((y1 - y0) / h).rounded(.up))
        var cross = [[(Double, Int)]](repeating: [], count: rows)
        for poly in geom.polys {
            for i in 0..<poly.count {
                let A = poly[i], Bp = poly[(i + 1) % poly.count]
                if A.y == Bp.y { continue }
                let dir = Bp.y > A.y ? 1 : -1
                let ya = min(A.y, Bp.y), yb = max(A.y, Bp.y)
                let r0 = max(0, Int(((ya - y0) / h - 0.5).rounded(.up)))
                let r1 = min(rows - 1, Int(((yb - y0) / h - 0.5).rounded(.down)))
                if r0 > r1 { continue }
                for r in r0...r1 {
                    let y = y0 + (Double(r) + 0.5) * h
                    if y < ya || y >= yb { continue }
                    let u = (y - A.y) / (Bp.y - A.y)
                    cross[r].append((A.x + (Bp.x - A.x) * u, dir))
                }
            }
        }
        var area = 0.0
        for var row in cross where !row.isEmpty {
            row.sort { $0.0 < $1.0 }
            var wnd = 0
            var start = 0.0
            for (x, d) in row {
                let was = wnd != 0
                wnd += d
                if !was, wnd != 0 { start = x } else if was, wnd == 0 { area += x - start }
            }
        }
        return area * h
    }
}
