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
