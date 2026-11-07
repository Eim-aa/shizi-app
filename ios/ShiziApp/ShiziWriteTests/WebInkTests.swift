import UIKit
import XCTest
@testable import Shizi

// R11-A（D72 ②）：原生书写面的墨与网页同一算法。
// 金标准 Fixtures/web-ink-golden.json 当年由网页 src/core/ink-math.js buildStroke 生成（D84 起冻结，生成脚本已删、不再重生成）。这里 Swift WebInk.buildStroke 逐点比：
//   点数相同；x / y / w 误差 ≤ 1e-3 单位（345 单位格），t ≤ 1e-3 ms，p ≤ 1e-6；v30 / endK ≤ 1e-4；dot / single / pressure 相同。
// （金标准数值保留 6 位小数；实测最大误差见测试输出 [shizi] web-ink golden。）

enum WebInkFixture {
    static let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/web-ink-golden.json")

    static func doc() throws -> [String: Any] {
        try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    /// 金标准里的参数表（= 页面 open 下发的 ink 表：policy.ink + INK_SPEC）。
    static func params() throws -> WebInkParams {
        try XCTUnwrap(WebInkParams(try doc()["params"]), "params in web-ink-golden.json")
    }

    static func raw(_ rows: [[NSNumber]]) -> [InkRawPoint] {
        rows.map { r in
            var q = InkRawPoint(x: r[0].doubleValue, y: r[1].doubleValue, t: r[2].doubleValue)
            if r.count > 3 { q.p = r[3].doubleValue }
            return q
        }
    }
}

final class WebInkTests: XCTestCase {
    func testBuildStrokeMatchesTheWebPointByPoint() throws {
        let doc = try WebInkFixture.doc()
        let k = try WebInkFixture.params()
        let cases = try XCTUnwrap(doc["cases"] as? [[String: Any]])
        XCTAssertGreaterThanOrEqual(cases.count, 30)
        var worst = (xy: 0.0, w: 0.0, t: 0.0)
        for c in cases {
            let id = c["id"] as? String ?? "?"
            let final = c["final"] as? Bool ?? false
            let raw = WebInkFixture.raw(try XCTUnwrap(c["raw"] as? [[NSNumber]], id))
            let want = try XCTUnwrap(c["out"] as? [[NSNumber]], id)
            let got = WebInk.buildStroke(raw, final: final, params: k)
            XCTAssertEqual(got.points.count, want.count, "\(id) point count")
            for (i, (g, e)) in zip(got.points, want).enumerated() {
                let dxy = max(abs(g.x - e[0].doubleValue), abs(g.y - e[1].doubleValue))
                let dw = abs(g.w - e[2].doubleValue), dt = abs(g.t - e[3].doubleValue)
                worst = (max(worst.xy, dxy), max(worst.w, dw), max(worst.t, dt))
                XCTAssertLessThanOrEqual(dxy, 1e-3, "\(id) #\(i) position")
                XCTAssertLessThanOrEqual(dw, 1e-3, "\(id) #\(i) width")
                XCTAssertLessThanOrEqual(dt, 1e-3, "\(id) #\(i) time")
                if e.count > 4 { XCTAssertEqual(g.p ?? -1, e[4].doubleValue, accuracy: 1e-6, "\(id) #\(i) pressure") } else { XCTAssertNil(g.p, "\(id) #\(i) pressure") }
            }
            if let v = c["v30"] as? NSNumber { XCTAssertEqual(got.v30 ?? -1, v.doubleValue, accuracy: 1e-4, "\(id) v30") } else { XCTAssertNil(got.v30, "\(id) v30") }
            XCTAssertEqual(got.dot, c["dot"] as? Bool, "\(id) dot")
            XCTAssertEqual(got.single, c["single"] as? Bool, "\(id) single")
            XCTAssertEqual(got.pressure, c["pressure"] as? Bool, "\(id) pressure")
            XCTAssertEqual(got.endK, (c["endK"] as? NSNumber)?.doubleValue ?? -1, accuracy: 1e-4, "\(id) endK")
        }
        print(String(format: "[shizi] web-ink golden: %d cases, worst position %.2e, width %.2e, time %.2e", cases.count, worst.xy, worst.w, worst.t))
    }

    func testParamsComeOnlyFromThePage() throws {
        let doc = try WebInkFixture.doc()
        var table = try XCTUnwrap(doc["params"] as? [String: Any])
        XCTAssertNotNil(WebInkParams(table))
        XCTAssertEqual(Set(table.keys), Set(WebInkParams.keys), "same keys as ink-math.js inkParams")
        table.removeValue(forKey: "tau")
        XCTAssertNil(WebInkParams(table), "a missing key is refused, not filled in")
        XCTAssertNil(WebInkParams(nil))
        // 页面还没下发参数：没有几何（书写面只在 open 之后存在）
        XCTAssertEqual(NativeInkStrokeMesh.build(raw: [InkRawPoint(x: 1, y: 1, t: 0), InkRawPoint(x: 50, y: 50, t: 50)], params: nil).vertexCount, 0)
    }

    /// 几何照 brush.js paintBrushStroke：起点圆 + 每段色带 + 末端圆，半宽 max(0.5, w/2)。
    func testTrianglesFollowTheWebBrush() throws {
        let k = try WebInkFixture.params()
        // 单点：一个圆，直径 single × base
        var dot: [Float] = []
        let single = WebInk.buildStroke([InkRawPoint(x: 100, y: 120, t: 0)], final: true, params: k)
        WebInk.triangles(single.points, into: &dot)
        let r = stride(from: 0, to: dot.count, by: 2).map { hypot(Double(dot[$0]) - 100, Double(dot[$0 + 1]) - 120) }.max() ?? 0
        XCTAssertEqual(r, k.single * k.base / 2, accuracy: 1e-4)
        // 一横（y 不变，1€ 滤波后仍在 150）：墨区半高 = 最宽点的 w / 2，起点圆头
        let raw = (0..<14).map { InkRawPoint(x: 70 + 15 * Double($0), y: 150, t: 1000 + Double($0) * 16) }
        let s = WebInk.buildStroke(raw, final: true, params: k)
        var v: [Float] = []
        WebInk.triangles(s.points, into: &v)
        XCTAssertEqual(v.count % 6, 0)
        let ys = stride(from: 1, to: v.count, by: 2).map { Double(v[$0]) }
        let maxHalf = (s.points.map(\.w).max() ?? 0) / 2
        XCTAssertEqual((ys.max() ?? 0) - 150, maxHalf, accuracy: maxHalf * 0.02, "ink reaches half the widest point's w")
        let xs = stride(from: 0, to: v.count, by: 2).map { Double(v[$0]) }
        XCTAssertEqual(xs.min() ?? 0, s.points[0].x - s.points[0].w / 2, accuracy: 1e-3, "round start cap")
    }

    /// 书写中：预测点只做临时尾巴（时间夹成单调），抬笔后的终态不含预测点。
    func testPredictedPointsAreOnlyALiveTail() throws {
        let k = try WebInkFixture.params()
        let raw = (0..<8).map { InkRawPoint(x: 60 + 10 * Double($0), y: 100, t: 1000 + Double($0) * 8) }
        var pred = [InkRawPoint(x: 140, y: 100, t: 1064, predicted: true), InkRawPoint(x: 150, y: 100, t: 1060, predicted: true)]
        var withTail: [Float] = []
        NativeInkStrokeMesh.live(raw: raw, predicted: pred, params: k, into: &withTail)
        let reach = { (v: [Float]) in stride(from: 0, to: v.count, by: 2).map { Double(v[$0]) }.max() ?? 0 }
        pred.removeAll()
        var plain: [Float] = []
        NativeInkStrokeMesh.live(raw: raw, predicted: pred, params: k, into: &plain)
        // 书写中不锁尾（1€ 滤波后的末点略落后于触点，网页同样）：预测尾巴让墨更接近笔尖
        XCTAssertGreaterThan(reach(withTail), reach(plain) + 5, "tail drawn this frame")
        // 第二个预测点时间早于前一个：夹成同一时刻、按零时间差合并（留最后的位置），不倒退
        var clamped: [Float] = []
        NativeInkStrokeMesh.live(raw: raw, predicted: [InkRawPoint(x: 140, y: 100, t: 1064), InkRawPoint(x: 150, y: 100, t: 1064)], params: k, into: &clamped)
        XCTAssertEqual(withTail, clamped)
        // live 几何 = buildStroke(final: false) 的画法
        var direct: [Float] = []
        WebInk.triangles(WebInk.buildStroke(raw, final: false, params: k).points, into: &direct)
        XCTAssertEqual(plain, direct)
    }

    /// 产品书写面不用 ink-model-1.0（T2 盲测候选只在 DEBUG spike 里经 inkModel 打开）。
    @MainActor
    func testTheWritingSurfaceDrawsWithTheWebAlgorithm() throws {
        let k = try WebInkFixture.params()
        WebInkParams.current = k
        defer { WebInkParams.current = nil }
        let renderer = try XCTUnwrap(NativeInkRenderer())
        let v = try XCTUnwrap(NativeInkView(frame: CGRect(x: 0, y: 0, width: 345, height: 345), renderer: renderer))
        XCTAssertEqual(v.params, k, "a new surface takes the page's table")
        XCTAssertNil(v.inkModel)
        let raw = (0..<14).map { InkRawPoint(x: 70 + 15 * Double($0), y: 150 + Double($0), t: 1000 + Double($0) * 16) }
        v.syncPageStrokes([raw])
        var want: [Float] = []
        WebInk.triangles(WebInk.buildStroke(raw, final: true, params: k).points, into: &want)
        XCTAssertEqual(v.pageStrokes.first?.vertices, want)
        // 页面重新同步下发新表：已画的笔按新参数重算
        var thicker = k
        thicker.base *= 1.5
        v.params = thicker
        var want2: [Float] = []
        WebInk.triangles(WebInk.buildStroke(raw, final: true, params: thicker).points, into: &want2)
        XCTAssertEqual(v.pageStrokes.first?.vertices, want2)
    }
}

// MARK: - 书写中一笔的每帧几何：量测（BENCH）

/// 书写中一笔逐帧长大时，每帧重建墨迹几何的耗时（CI 日志里 grep BENCH）。只打印、不断言时间。
///   BENCH ink live n=<原始点数> median=…ms max=…ms floats=<这一帧的顶点 Float 数>
/// 模拟：Pencil 120Hz（8.33ms 一个合并点）、螺旋一笔 400 点（约 2.5 单位 / 点，带压力），每帧另带 2 个预测点；
/// 每帧调一次产品书写面用的同一入口，取 n 附近 10 帧（n − 9 … n）的中位数 / 最大值。
enum WebInkBench {
    /// 螺旋一笔（345 单位格，中心起笔向外绕两圈），第 i 个点。
    static func spiral(_ i: Int, of count: Int) -> InkRawPoint {
        let u = Double(i) / Double(count - 1)
        let a = u * 4 * Double.pi, r = 20 + 120 * u
        var q = InkRawPoint(x: 172 + r * cos(a), y: 172 + r * sin(a), t: 1000 + Double(i) * 1000 / 120)
        q.p = 0.35 + 0.2 * sin(u * 9)
        return q
    }

    static func stroke(_ count: Int = 400) -> [InkRawPoint] { (0..<count).map { spiral($0, of: count) } }

    /// 第 i 帧（已有 i 个原始点）的预测点：沿同一条曲线往前 1、2 个点。
    static func predicted(after i: Int, of count: Int) -> [InkRawPoint] {
        (i..<(i + 2)).map { j in
            var q = spiral(j, of: count)
            q.predicted = true
            return q
        }
    }

    static func ms(_ from: UInt64, _ to: UInt64) -> Double { Double(to - from) / 1e6 }

    static func report(_ name: String, _ frames: [Double], floats: [Int], at ns: [Int]) {
        for n in ns where n <= frames.count {
            let w = frames[max(0, n - 10)..<n].sorted()
            print(String(format: "BENCH \(name) n=%ld median=%.3fms max=%.3fms floats=%ld", n, w[w.count / 2], w.last ?? 0, floats[n - 1]))
        }
    }
}

final class WebInkLiveBenchTests: XCTestCase {
    /// 产品书写面每帧的入口（增量 WebInk.LiveStroke）→ BENCH ink live；整笔重算的参照（NativeInkStrokeMesh.live）→ BENCH ink live-full。
    func testLiveMeshCostPerFrameAsTheStrokeGrows() throws {
        let k = try WebInkFixture.params()
        let count = 400
        let all = WebInkBench.stroke(count)
        var raw: [InkRawPoint] = []
        var frames: [Double] = [], floats: [Int] = []
        var fullFrames: [Double] = [], fullFloats: [Int] = []
        var live = WebInk.LiveStroke()
        for i in 1...count {
            raw.append(all[i - 1])
            let pre = WebInkBench.predicted(after: i, of: count)
            let t0 = DispatchTime.now().uptimeNanoseconds
            live.update(raw: raw, predicted: pre, params: k)
            let t1 = DispatchTime.now().uptimeNanoseconds
            frames.append(WebInkBench.ms(t0, t1))
            floats.append(live.stableUsed + live.tailVertices.count)
            var v: [Float] = []
            let t2 = DispatchTime.now().uptimeNanoseconds
            NativeInkStrokeMesh.live(raw: raw, predicted: pre, params: k, into: &v)
            let t3 = DispatchTime.now().uptimeNanoseconds
            fullFrames.append(WebInkBench.ms(t2, t3))
            fullFloats.append(v.count)
        }
        WebInkBench.report("ink live", frames, floats: floats, at: [50, 100, 200, 300, 400])
        WebInkBench.report("ink live-full", fullFrames, floats: fullFloats, at: [50, 100, 200, 300, 400])
        XCTAssertEqual(floats, fullFloats)
    }
}

// MARK: - 书写中一笔的增量几何 = 整笔重算（逐位）

/// 可复现的随机数（测试用，固定种子）。
struct WebInkTestRNG: RandomNumberGenerator {
    var state: UInt64
    mutating func next() -> UInt64 {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        var z = state
        z = (z ^ (z >> 30)) &* 0xbf58476d1ce4e5b9
        z = (z ^ (z >> 27)) &* 0x94d049bb133111eb
        return z ^ (z >> 31)
    }
}

@MainActor
final class WebInkLiveStrokeTests: XCTestCase {
    /// 整笔重算：raw + 预测点（时间夹成单调，同 NativeInkView.append）→ buildStroke → triangles。
    private func full(_ raw: [InkRawPoint], _ predicted: [InkRawPoint], final: Bool, _ k: WebInkParams) -> [Float] {
        var pts = raw
        for q in predicted { NativeInkView.append(q, to: &pts) }
        var v: [Float] = []
        WebInk.triangles(WebInk.buildStroke(pts, final: final, params: k).points, into: &v)
        return v
    }

    private func bits(_ v: [Float]) -> [UInt32] { v.map(\.bitPattern) }

    /// 录下来的笔（金标准的原始点）+ 随机笔（采样间隔有 0 / 抖动 / 倒退，压力有无 / 0 混杂，偶有坏点）。
    private func strokes() throws -> [(String, [InkRawPoint])] {
        let doc = try WebInkFixture.doc()
        var out: [(String, [InkRawPoint])] = []
        for c in try XCTUnwrap(doc["cases"] as? [[String: Any]]) where (c["final"] as? Bool) == true {
            out.append((c["id"] as? String ?? "?", WebInkFixture.raw(try XCTUnwrap(c["raw"] as? [[NSNumber]]))))
        }
        out.append(("spiral-400", WebInkBench.stroke(400)))
        var rng = WebInkTestRNG(state: 20261104)
        for n in 0..<40 {
            let count = Int.random(in: 1...160, using: &rng)
            let pencil = Bool.random(using: &rng)
            var x = Double.random(in: 40...300, using: &rng), y = Double.random(in: 40...300, using: &rng), t = 1000.0
            var s: [InkRawPoint] = []
            for _ in 0..<count {
                let dts: [Double] = [0, 0, 1000.0 / 240, 1000.0 / 120, 1000.0 / 60, Double.random(in: 0...30, using: &rng), -3]
                t += dts[Int.random(in: 0..<dts.count, using: &rng)]
                if Double.random(in: 0..<1, using: &rng) < 0.9 {
                    x += Double.random(in: -6...6, using: &rng)
                    y += Double.random(in: -6...6, using: &rng)
                }
                var q = InkRawPoint(x: x, y: y, t: t)
                if pencil {
                    let r = Int.random(in: 0..<3, using: &rng)
                    q.p = r == 0 ? nil : r == 1 ? 0 : Double.random(in: 0...1, using: &rng)
                }
                if n % 10 == 3, Int.random(in: 0..<25, using: &rng) == 0 { q.x = .nan } // 坏点：合并时丢弃
                if n % 10 == 7, Int.random(in: 0..<25, using: &rng) == 0 { q.t = .nan } // 坏时间：用上一点的时间
                NativeInkView.append(q, to: &s)
            }
            out.append(("random-\(n)", s))
        }
        return out
    }

    /// 每个前缀长度、有无预测点、书写中与抬笔（final）：增量的顶点与整笔重算逐个 Float 位相同。
    func testIncrementalLiveMeshIsBitIdenticalToTheFullRebuild() throws {
        let k = try WebInkFixture.params()
        var frames = 0, finals = 0
        for (id, stroke) in try strokes() {
            for withPredicted in [false, true] {
                var live = WebInk.LiveStroke()
                var raw: [InkRawPoint] = []
                for (i, q) in stroke.enumerated() {
                    raw.append(q)
                    var pre: [InkRawPoint] = []
                    if withPredicted, let l = raw.last {
                        // 两个预测点：第二个时间早于第一个（夹成同一时刻、按零时间差合并）
                        pre = [InkRawPoint(x: l.x + 3, y: l.y + 1, t: l.t + 8, p: l.p, predicted: true),
                               InkRawPoint(x: l.x + 6, y: l.y + 2, t: l.t + 5, p: l.p, predicted: true)]
                    }
                    live.update(raw: raw, predicted: pre, params: k)
                    XCTAssertEqual(bits(live.vertices), bits(full(raw, pre, final: false, k)), "\(id) n=\(i + 1) predicted=\(withPredicted) live")
                    XCTAssertEqual(live.vertexCount * 2, live.vertices.count)
                    frames += 1
                    if !withPredicted {
                        // 抬笔（在这一刻的副本上接着算 final），之后原来的那份照样接着写
                        var lifted = live
                        lifted.update(raw: raw, predicted: [], params: k, final: true)
                        XCTAssertEqual(bits(lifted.vertices), bits(full(raw, [], final: true, k)), "\(id) n=\(i + 1) final")
                        lifted.update(raw: raw, predicted: pre, params: k)
                        XCTAssertEqual(bits(lifted.vertices), bits(full(raw, pre, final: false, k)), "\(id) n=\(i + 1) live after final")
                        finals += 1
                    }
                }
            }
        }
        print("[shizi] live-stroke equivalence: \(frames) live frames, \(finals) lifts, all bit-identical")
    }

    /// 同一个增量状态换一笔 / 换参数 / 原始点整笔换了（换算书写面）：从头来，结果仍与整笔重算相同。
    func testIncrementalLiveMeshStartsOverWhenTheStrokeIsNotAnAppend() throws {
        let k = try WebInkFixture.params()
        var live = WebInk.LiveStroke()
        let a = WebInkBench.stroke(120)
        live.update(raw: Array(a.prefix(80)), predicted: [], params: k)
        let g0 = live.generation
        // 换一笔（首点不同）
        let b = a.map { q in var r = q; r.x += 7; return r }
        live.update(raw: Array(b.prefix(50)), predicted: [], params: k)
        XCTAssertEqual(bits(live.vertices), bits(full(Array(b.prefix(50)), [], final: false, k)))
        XCTAssertNotEqual(live.generation, g0)
        // 点数变少
        live.update(raw: Array(b.prefix(20)), predicted: [], params: k)
        XCTAssertEqual(bits(live.vertices), bits(full(Array(b.prefix(20)), [], final: false, k)))
        // 换参数
        var thicker = k
        thicker.base *= 1.5
        live.update(raw: Array(b.prefix(60)), predicted: [], params: thicker)
        XCTAssertEqual(bits(live.vertices), bits(full(Array(b.prefix(60)), [], final: false, thicker)))
        // 上次的末点被改（不是在后面追加）
        var c = Array(b.prefix(60))
        c[59].y += 3
        c.append(b[60])
        live.update(raw: c, predicted: [], params: thicker)
        XCTAssertEqual(bits(live.vertices), bits(full(c, [], final: false, thicker)))
        // clear 之后
        live.clear()
        live.update(raw: Array(a.prefix(3)), predicted: [], params: k)
        XCTAssertEqual(bits(live.vertices), bits(full(Array(a.prefix(3)), [], final: false, k)))
    }

    /// 几何的写法改了（不再每段建临时数组、Catmull-Rom 不再拷首尾重复的数组）：与原先的写法逐位相同。
    func testTrianglesAndCatmullRomMatchTheFormerCode() throws {
        let k = try WebInkFixture.params()
        for (id, stroke) in try strokes() {
            for final in [false, true] {
                let pts = WebInk.buildStroke(stroke, final: final, params: k).points
                var v: [Float] = []
                WebInk.triangles(pts, into: &v)
                XCTAssertEqual(bits(v), bits(Self.formerTriangles(pts)), "\(id) final=\(final)")
            }
            let m = WebInk.mergeSameTime(stroke)
            XCTAssertEqual(WebInk.catmullRom(m, step: k.step), Self.formerCatmullRom(m, step: k.step), id)
        }
    }

    /// 原先的 triangles（逐字保留作对照）。
    static func formerTriangles(_ points: [WebInkPoint]) -> [Float] {
        var out: [Float] = []
        guard let first = points.first, points.allSatisfy({ $0.x.isFinite && $0.y.isFinite }) else { return out }
        func half(_ q: WebInkPoint) -> Double { max(0.5, (q.w.isFinite && q.w > 0 ? q.w : 0) / 2) }
        WebInk.appendDisc(x: first.x, y: first.y, r: half(first), into: &out)
        guard points.count > 1 else { return out }
        for i in 1..<points.count {
            let a = points[i - 1], b = points[i]
            let dx = b.x - a.x, dy = b.y - a.y
            let length = hypot(dx, dy)
            if length == 0 { continue }
            let ra = half(a), rb = half(b)
            let nx = -dy / length, ny = dx / length
            let q = [a.x + nx * ra, a.y + ny * ra, b.x + nx * rb, b.y + ny * rb, b.x - nx * rb, b.y - ny * rb, a.x - nx * ra, a.y - ny * ra].map(Float.init)
            out += [q[0], q[1], q[2], q[3], q[4], q[5], q[0], q[1], q[4], q[5], q[6], q[7]]
            WebInk.appendDisc(x: b.x, y: b.y, r: rb, into: &out)
        }
        return out
    }

    /// 原先的 catmullRom（逐字保留作对照）。
    static func formerCatmullRom(_ points: [WebInk.Sample], step: Double) -> [WebInk.Sample] {
        guard points.count >= 2 else { return points }
        var out: [WebInk.Sample] = []
        // swiftlint:disable:next force_unwrapping
        let P = [points.first!] + points + [points.last!]
        @inline(__always) func lerp(_ a: Double, _ b: Double, _ u: Double) -> Double { a + (b - a) * u }
        for i in 1..<(P.count - 2) {
            let a = P[i - 1], b = P[i], c = P[i + 1], d = P[i + 2]
            let n = max(1, Int((hypot(c.x - b.x, c.y - b.y) / step).rounded(.up)))
            let hasP = WebInk.hasPressure(b.p) || WebInk.hasPressure(c.p)
            for j in 0..<n {
                let u = Double(j) / Double(n)
                let u2 = u * u, u3 = u2 * u
                let x = 0.5 * (2 * b.x + (-a.x + c.x) * u + (2 * a.x - 5 * b.x + 4 * c.x - d.x) * u2 + (-a.x + 3 * b.x - 3 * c.x + d.x) * u3)
                let y = 0.5 * (2 * b.y + (-a.y + c.y) * u + (2 * a.y - 5 * b.y + 4 * c.y - d.y) * u2 + (-a.y + 3 * b.y - 3 * c.y + d.y) * u3)
                var q = WebInk.Sample(x: x, y: y, t: lerp(b.t, c.t, u))
                if hasP { q.p = lerp(b.p ?? 0, c.p ?? 0, u) }
                out.append(q)
            }
        }
        // swiftlint:disable:next force_unwrapping
        out.append(points.last!)
        return out
    }
}
