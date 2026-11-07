#if DEBUG
import Foundation

// 笔锋模型 Swift 移植的金标准自检（P1-S2；规格 §8.4「原生端读同一份 vectors.json，按 §8.1 / §8.3 同一口径断言」）。
//
// 两部分：
//   A. check.mjs 的逐条断言与全局不变量 I1–I10，原样移植（数值层区间不变；前缀稳定按规格 §8.4 放宽到 1e-4）。
//   B. 与参考实现逐值比较：docs/engineering/v10/phase1/ink-model/out/reference-dump.json（dump-reference.mjs 生成）
//      final 与 live（前 60% 点、final=false）两条路径：弧长、样本数、u=0…1 每 0.01 的宽度、面积、端帽、钩、折角、v30、洇墨、多边形数。
// 入口：
//   XCTest：ShiziWriteTests InkSurfaceTests（App 作宿主，读 Debug 包内的 InkModel/vectors.json 与 reference-dump.json）；
//   macOS：swiftc -D DEBUG InkModel.swift InkModelCheck.swift <main> 直接跑（见 ios/ShiziApp/scripts/ink-model-check.sh）。

struct InkModelCheckReport {
    var pass = 0
    var fail = 0
    var fails: [String] = []
    var rows: [String] = []
    var refCompared = 0
    var refWorstW = 0.0 // 参考实现与原生宽度的最大绝对差（345 单位）
    var refWorstArea = 0.0 // 面积最大相对差
    var refWorstLen = 0.0 // 弧长最大绝对差
    var refMismatches: [String] = []
    var millis = 0.0

    var ok: Bool { fail == 0 && refMismatches.isEmpty }

    var summary: String {
        String(format: "%d assertions passed · %d failed · reference compare %d paths, worst |Δw| %.2e, worst area %.2e, worst |Δlen| %.2e, %d mismatches (%.0f ms)",
               pass, fail, refCompared, refWorstW, refWorstArea, refWorstLen, refMismatches.count, millis)
    }

    var json: [String: Any] {
        [
            "model": InkModel.version,
            "ok": ok,
            "pass": pass,
            "fail": fail,
            "fails": fails,
            "rows": rows,
            "reference": [
                "compared": refCompared,
                "worstAbsWidth": refWorstW,
                "worstRelArea": refWorstArea,
                "worstAbsLen": refWorstLen,
                "mismatches": refMismatches,
            ] as [String: Any],
            "millis": millis,
            "summary": summary,
        ]
    }
}

enum InkModelCheck {
    typealias J = [String: Any]

    static func points(_ v: J) -> [InkRawPoint] {
        ((v["points"] as? [J]) ?? []).map { q in
            InkRawPoint(
                x: (q["x"] as? NSNumber)?.doubleValue ?? .nan,
                y: (q["y"] as? NSNumber)?.doubleValue ?? .nan,
                t: (q["t"] as? NSNumber)?.doubleValue ?? .nan,
                p: (q["p"] as? NSNumber)?.doubleValue
            )
        }
    }

    static func range(_ a: Any?) -> (Double, Double)? {
        guard let arr = a as? [NSNumber], arr.count == 2 else { return nil }
        return (arr[0].doubleValue, arr[1].doubleValue)
    }

    static func num(_ a: Any?) -> Double? { (a as? NSNumber)?.doubleValue }

    static func fx(_ x: Double?) -> String { x.map { String(format: "%.3f", $0) } ?? "nil" }

    // swiftlint:disable:next function_body_length cyclomatic_complexity
    static func run(vectorsData: Data, referenceData: Data?) -> InkModelCheckReport {
        let started = Date()
        var rep = InkModelCheckReport()
        guard let doc = (try? JSONSerialization.jsonObject(with: vectorsData)) as? J, let vectors = doc["vectors"] as? [J] else {
            rep.fail = 1
            rep.fails = ["vectors.json unreadable"]
            return rep
        }
        let K = InkParams.default
        let B = K.base
        func ok(_ cond: Bool, _ what: String, _ detail: @autoclosure () -> String = "") {
            if cond { rep.pass += 1 } else {
                rep.fail += 1
                let d = detail()
                rep.fails.append(d.isEmpty ? what : "\(what) — \(d)")
            }
        }
        func inR(_ x: Double, _ r: (Double, Double), _ eps: Double = 1e-9) -> Bool { x >= r.0 - eps && x <= r.1 + eps }

        struct Run { let profile: InkProfile; let geom: InkGeometry; let area: Double }
        var cache: [String: Run] = [:]
        func vec(_ id: String) -> J? { vectors.first { ($0["id"] as? String) == id } }
        func run(_ v: J) -> Run {
            let id = v["id"] as? String ?? ""
            if let r = cache[id] { return r }
            let pr = InkModel.analyze(points(v))
            let g = InkModel.geometry(pr)
            let r = Run(profile: pr, geom: g, area: InkModel.unionArea(g, h: 0.1))
            cache[id] = r
            return r
        }

        // ------------------------------------------------------------ 逐条向量
        for v in vectors {
            let id = v["id"] as? String ?? "?"
            let e = v["expect"] as? J ?? [:]
            let r = run(v)
            let pr = r.profile
            let area = r.area
            func wRelAt(_ u: Double) -> Double { InkModel.widthAt(pr, u * pr.len) / B }
            if let x = e["single"] as? Bool { ok(pr.single == x, "\(id) single", "\(pr.single)") }
            if let x = e["dot"] as? Bool { ok(pr.dot == x, "\(id) dot", "\(pr.dot)") }
            if let x = e["hook"] as? Bool { ok((pr.hook != nil) == x, "\(id) hook", "\(pr.hook != nil)") }
            if let c = range(e["corners"]) { ok(inR(Double(pr.corners.count), c), "\(id) corners", "\(pr.corners.count)") }
            if let x = e["pressure"] as? Bool { ok(pr.pressure == x, "\(id) pressure") }
            if let caps = e["caps"] as? J {
                if let s = caps["start"] as? String { ok(pr.capStart == s, "\(id) caps.start", "\(pr.capStart) ≠ \(s)") }
                if let s = caps["end"] as? String { ok(pr.capEnd == s, "\(id) caps.end", "\(pr.capEnd) ≠ \(s)") }
            }
            for w in (e["widths"] as? [J]) ?? [] {
                let u = num(w["u"]) ?? 0
                let got = wRelAt(u)
                ok(range(w["wRel"]).map { inR(got, $0) } ?? false, "\(id) w/B @u=\(u)", "\(fx(got))")
            }
            for q in (e["ratios"] as? [J]) ?? [] {
                let got = wRelAt(num(q["num"]) ?? 0) / wRelAt(num(q["den"]) ?? 1)
                ok(range(q["range"]).map { inR(got, $0) } ?? false, "\(id) ratio", "\(fx(got))")
            }
            let last = pr.samples[pr.samples.count - 1]
            if let t = range(e["tipRel"]) { ok(inR(last.w / B, t), "\(id) tipRel", fx(last.w / B)) }
            if let t = range(e["endRel"]) { ok(inR(last.w / last.body, t), "\(id) endRel", fx(last.w / last.body)) }
            if let t = range(e["area"]) { ok(inR(area, t), "\(id) area", fx(area)) }
            if let t = range(e["v30"]) { ok(pr.v30 != nil && inR(pr.v30!, t), "\(id) v30", fx(pr.v30)) }
            if let fb = e["feibai"] as? Bool {
                let dry = pr.samples.map(\.dry).max() ?? 0
                ok((dry > 0.05) == fb, "\(id) feibai", "max dry \(fx(dry))")
            }
            if let t = range(e["blooms"]) { ok(inR(Double(pr.blooms.count), t), "\(id) blooms", "\(pr.blooms.count)") }
            if let t = range(e["hookLen"]) { ok(pr.hook != nil && inR(pr.hook!.len, t), "\(id) hookLen", fx(pr.hook?.len)) }
            if let t = range(e["cornerAt"]) {
                let c = pr.corners.last
                ok(c != nil && inR(c!.s / pr.len, t), "\(id) cornerAt", fx(c.map { $0.s / pr.len }))
            }
            for d in (e["dotPhase"] as? [J]) ?? [] {
                let u = num(d["u"]) ?? 0
                let want0 = num(d["f"]) ?? 0
                let s = u * pr.len
                var q = pr.samples[0]
                for c in pr.samples where abs(c.s - s) < abs(q.s - s) { q = c }
                let tol = (0.8 / pr.len) * K.step + 1e-9
                let uq = q.s / pr.len
                let want = uq < 0.5 ? 0.7 + (1.1 - 0.7) * (uq / 0.5) : 1.1 + (0.9 - 1.1) * ((uq - 0.5) / 0.5)
                ok(abs(q.fPhase - want) < 1e-9 && abs(q.fPhase - want0) <= tol * 2 + 0.03, "\(id) dotPhase @u=\(u)", "\(fx(q.fPhase)) vs \(want0)")
                ok(abs(q.w - q.body * q.fPhase) < 1e-9, "\(id) dot w = body × phase @u=\(u)")
            }
            if let t = range(e["singleDiameterRel"]) { ok(inR(pr.samples[0].w / B, t), "\(id) single diameter", fx(pr.samples[0].w / B)) }
            if (e["v30WholeDuration"] as? Bool) == true {
                let m = InkModel.prepare(points(v))
                var d = 0.0
                for i in 1..<m.count { d += hypot(m[i].x - m[i - 1].x, m[i].y - m[i - 1].y) }
                let dur = m[m.count - 1].t - m[0].t
                ok(dur < K.window && abs((pr.v30 ?? -1) - d / dur) < 1e-9, "\(id) D09 v30 用整段时长", "\(fx(pr.v30)) vs \(fx(d / dur))")
            }
            if let refId = e["sameAs"] as? String, let rv = vec(refId) {
                let r2 = run(rv)
                let p2 = r2.profile
                var worst = 0.0
                var u = 0.05
                while u <= 0.951 {
                    let a = InkModel.widthAt(pr, u * pr.len)
                    let b = InkModel.widthAt(p2, u * p2.len)
                    worst = max(worst, abs(a - b) / max(0.05 * max(a, b), 0.04 * B))
                    u += 0.05
                }
                ok(worst <= 1, "\(id) ≈ \(refId) 宽度", "最差 \(fx(worst))")
                ok(abs(area - r2.area) / r2.area <= 0.03, "\(id) ≈ \(refId) 面积", "\(fx(area)) vs \(fx(r2.area))")
                ok(pr.capStart == p2.capStart && pr.capEnd == p2.capEnd, "\(id) ≈ \(refId) 端帽")
                ok(abs(pr.len - p2.len) / p2.len <= 0.01, "\(id) ≈ \(refId) 弧长", "\(fx(pr.len)) vs \(fx(p2.len))")
            }
            let ws = [0.25, 0.5, 0.75].map { String(format: "%.2f", wRelAt($0)) }.joined(separator: "/")
            rep.rows.append("\(id) pts \((v["points"] as? [Any])?.count ?? 0) len \(fx(pr.len)) w/B \(ws) caps \(pr.capStart)/\(pr.capEnd) hook \(pr.hook != nil ? "Y" : "-") corners \(pr.corners.count) area \(String(format: "%.0f", area))")
        }

        // ------------------------------------------------------------ 全局不变量
        // I1 D09 零时间差合并
        if let v = vec("V01-heng-slow") {
            let pts = points(v)
            var dedup: [InkRawPoint] = []
            for q in pts {
                if let l = dedup.last, l.t == q.t { dedup[dedup.count - 1] = q } else { dedup.append(q) }
            }
            ok(dedup.count < pts.count, "I1 V01 确含零时间差重复点")
            let a = InkModel.analyze(pts), b = InkModel.analyze(dedup)
            ok(a.samples.count == b.samples.count && zip(a.samples, b.samples).allSatisfy { $0.w == $1.w && $0.x == $1.x }, "I1 D09 零时间差合并：结果与去重输入逐样本相同")
        }
        // I2 D10 压力替代速度
        if let va = vec("V13-pencil-shu"), let vb = vec("V14-pencil-shu-fast") {
            let a = run(va).profile, b = run(vb).profile
            var worst = 0.0
            var u = 0.3
            while u <= 0.701 {
                let wa = InkModel.widthAt(a, u * a.len), wb = InkModel.widthAt(b, u * b.len)
                worst = max(worst, abs(wa - wb) / wa)
                u += 0.05
            }
            ok(worst <= 0.04, "I2 D10 压力替代速度：速度 ×2 中段宽差 ≤ 4%", fx(worst))
            let mid = a.samples[a.samples.count / 2]
            let fp = InkModel.pressureFactor(mid.p ?? 0, K)
            ok(abs(mid.fBody - fp) < 0.03, "I2 D10 中段 fBody ≈ F_p(p)", "\(fx(mid.fBody)) vs \(fx(fp))")
        }
        // I3 60 vs 240Hz
        if let va = vec("V15-rate-60hz"), let vb = vec("V17-rate-240hz") {
            let a = run(va), b = run(vb)
            ok(abs(a.area - b.area) / b.area <= 0.03, "I3 60Hz vs 240Hz 面积差 ≤ 3%", "\(fx(a.area)) vs \(fx(b.area))")
        }
        // I4 前缀稳定（规格 §8.4：原生放宽到 1e-4）
        for id in ["V04-shu-fast-chufeng", "V07-na-fast", "V10-hengzhe", "V11-shugou", "V15-rate-60hz", "V13-pencil-shu"] {
            guard let v = vec(id) else { ok(false, "I4 \(id) missing"); continue }
            let pts = points(v)
            let fin = InkModel.analyze(pts)
            var checked = 0
            var worst = 0.0
            for frac in [0.4, 0.6, 0.8, 0.95] {
                let cut = max(3, Int((Double(pts.count) * frac).rounded(.down)))
                let prefix = Array(pts.prefix(cut))
                let live = InkModel.analyze(prefix, final: false)
                let Z = InkModel.provisionalZone(prefix)
                for q in live.samples {
                    if q.s > live.len - Z { break }
                    let idx = Int((q.s / K.step).rounded())
                    guard idx < fin.samples.count else { continue }
                    let f = fin.samples[idx]
                    if abs(f.s - q.s) > 1e-9 { continue }
                    worst = max(worst, abs(f.w - q.w), hypot(f.x - q.x, f.y - q.y))
                    checked += 1
                }
            }
            ok(checked > 20 && worst <= 1e-4, "I4 前缀稳定 \(id)", "checked \(checked), worst \(worst)")
        }
        // I5 1€ 滞后上限
        for vv in [0.05, 0.1, 0.2, 0.3, 0.6, 1.2, 1.5] {
            var pts: [InkRawPoint] = []
            for i in 0...60 { pts.append(InkRawPoint(x: 20 + vv * Double(i) * (1000.0 / 120), y: 100, t: Double(i) * (1000.0 / 120))) }
            let f = InkModel.oneEuro(pts, K)
            var lag = 0.0
            for i in 0..<pts.count where pts[i].t >= 80 { lag = max(lag, hypot(pts[i].x - f[i].x, pts[i].y - f[i].y)) }
            let bound = max(0.75, vv * 8.33)
            ok(lag <= bound, "I5 1€ 滞后 v=\(vv)", "\(fx(lag)) > \(fx(bound))")
        }
        // I6 平移 / 时间原点无关
        if let v = vec("V11-shugou") {
            let pts = points(v)
            let a = InkModel.analyze(pts)
            let b = InkModel.analyze(pts.map { InkRawPoint(x: $0.x + 5.5, y: $0.y - 3.25, t: $0.t + 123456.789, p: $0.p) })
            let worst = zip(a.samples, b.samples).map { abs($0.w - $1.w) }.max() ?? 1
            ok(a.samples.count == b.samples.count && worst < 1e-6 && (a.hook != nil) == (b.hook != nil), "I6 平移 + 时间原点无关", "\(worst)")
        }
        // I7 减少动态效果
        for id in ["V02-heng-fast", "V10-hengzhe"] {
            guard let v = vec(id) else { continue }
            let pts = points(v)
            let a = InkModel.analyze(pts), b = InkModel.analyze(pts, reduceMotion: true)
            ok(b.samples.allSatisfy { $0.dry == 0 } && b.blooms.isEmpty, "I7 \(id) 减少动态效果：无飞白 / 洇墨")
            ok(zip(a.samples, b.samples).allSatisfy { $0.w == $1.w }, "I7 \(id) 减少动态效果：宽度不变")
            ok(abs(InkModel.unionArea(InkModel.geometry(a)) - InkModel.unionArea(InkModel.geometry(b))) < 1e-9, "I7 \(id) 减少动态效果：几何不变")
        }
        // I8 尺寸补偿
        ok(InkModel.sizeComp(345) == 1 && InkModel.sizeComp(400) == 1 && InkModel.sizeComp(258) == 1, "I8 书写格 258–400 不补偿")
        ok(abs(InkModel.sizeComp(166.5) - 1.141) < 0.01, "I8 对照卡 166.5pt 补偿 ≈1.14", fx(InkModel.sizeComp(166.5)))
        ok(InkModel.sizeComp(64) == K.sizeCompMax && InkModel.sizeComp(20) == K.sizeCompMax, "I8 小于 ~96pt 封顶 1.5")
        var mono = true
        for S in 20..<400 where InkModel.sizeComp(Double(S + 1)) > InkModel.sizeComp(Double(S)) + 1e-12 { mono = false }
        ok(mono, "I8 补偿随尺寸单调不增")
        // I9 几何健全
        for v in vectors {
            let id = v["id"] as? String ?? "?"
            let r = run(v)
            var sum = 0.0
            for p in r.geom.polys {
                var a = 0.0
                for i in 0..<p.count { a += p[i].x * p[(i + 1) % p.count].y - p[(i + 1) % p.count].x * p[i].y }
                sum += a / 2
                if a < -1e-9 { ok(false, "I9 \(id) 多边形须逆时针") }
            }
            ok(r.area > 0 && r.area <= sum * 1.005 + 0.5, "I9 \(id) 并集面积 ≤ 分片面积和", "\(fx(r.area)) vs \(fx(sum))")
            let wMax = r.profile.samples.map(\.w).max() ?? 0
            let xs = r.profile.samples.map(\.x), ys = r.profile.samples.map(\.y)
            let pad = wMax * 1.8 + 1
            let (x0, y0, x1, y1) = r.geom.bbox
            ok(x0 >= xs.min()! - pad && x1 <= xs.max()! + pad && y0 >= ys.min()! - pad && y1 <= ys.max()! + pad, "I9 \(id) 轮廓在包络内")
        }
        // I10 横细竖粗
        if let va = vec("V01-heng-slow"), let vb = vec("V03-shu-slow") {
            let a = run(va).profile, b = run(vb).profile
            let ratio = InkModel.widthAt(b, 0.5 * b.len) / InkModel.widthAt(a, 0.5 * a.len)
            ok(ratio >= 1.45 && ratio <= 1.75, "I10 慢竖 / 慢横 中段宽比 ∈ [1.45, 1.75]", fx(ratio))
        }

        // ------------------------------------------------------------ B. 与参考实现逐值比较
        if let referenceData, let ref = (try? JSONSerialization.jsonObject(with: referenceData)) as? J, let rvs = ref["vectors"] as? [J] {
            for rv in rvs {
                guard let id = rv["id"] as? String, let v = vec(id) else { continue }
                let pts = points(v)
                let cut = (rv["liveCut"] as? NSNumber)?.intValue ?? pts.count
                for (label, prof) in [("final", InkModel.analyze(pts)), ("live", InkModel.analyze(Array(pts.prefix(cut)), final: false))] {
                    guard let want = rv[label] as? J else { continue }
                    rep.refCompared += 1
                    let g = InkModel.geometry(prof)
                    let area = InkModel.unionArea(g, h: 0.1)
                    func mismatch(_ what: String) { rep.refMismatches.append("\(id) \(label) \(what)") }
                    let len = num(want["len"]) ?? 0
                    rep.refWorstLen = max(rep.refWorstLen, abs(prof.len - len))
                    if abs(prof.len - len) > 1e-6 { mismatch("len \(prof.len) vs \(len)") }
                    if (want["n"] as? NSNumber)?.intValue != prof.samples.count { mismatch("n \(prof.samples.count) vs \(want["n"] ?? "?")") }
                    let ws = (want["w"] as? [NSNumber])?.map(\.doubleValue) ?? []
                    var worstW = 0.0
                    for (i, w) in ws.enumerated() {
                        worstW = max(worstW, abs(InkModel.widthAt(prof, Double(i) / 100 * prof.len) - w))
                    }
                    rep.refWorstW = max(rep.refWorstW, worstW)
                    if worstW > 1e-6 { mismatch(String(format: "width worst %.3e", worstW)) }
                    let wantArea = num(want["area"]) ?? 0
                    let relA = wantArea > 0 ? abs(area - wantArea) / wantArea : abs(area)
                    rep.refWorstArea = max(rep.refWorstArea, relA)
                    if relA > 1e-6 { mismatch(String(format: "area %.4f vs %.4f", area, wantArea)) }
                    if (want["polys"] as? NSNumber)?.intValue != g.polys.count { mismatch("polys \(g.polys.count) vs \(want["polys"] ?? "?")") }
                    if want["capStart"] as? String != prof.capStart { mismatch("capStart \(prof.capStart)") }
                    if want["capEnd"] as? String != prof.capEnd { mismatch("capEnd \(prof.capEnd)") }
                    if want["hook"] as? Bool != (prof.hook != nil) { mismatch("hook") }
                    if (want["corners"] as? NSNumber)?.intValue != prof.corners.count { mismatch("corners \(prof.corners.count)") }
                    if (want["blooms"] as? NSNumber)?.intValue != prof.blooms.count { mismatch("blooms \(prof.blooms.count)") }
                    if let wv = num(want["v30"]), abs((prof.v30 ?? .nan) - wv) > 1e-9 { mismatch("v30 \(fx(prof.v30))") }
                }
            }
        } else if referenceData != nil {
            rep.refMismatches.append("reference-dump.json unreadable")
        }
        rep.millis = Date().timeIntervalSince(started) * 1000
        return rep
    }
}
#endif
