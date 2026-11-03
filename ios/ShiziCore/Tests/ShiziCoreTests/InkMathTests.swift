import Foundation
import XCTest
@testable import ShiziCore

// test/core/ink-math.test.mjs 的转写（25 个用例，用例名保留原名）。笔锋管线 / 抽点 / v3 打包 / v2 读取 / 原始点行 / 参数注入逐条对照；
// 容量实测（P78 / D27 / Q1 / B2.3）用同一批题库真字（data/<字>.json 中线）与同一估算口径（budget.inkBytes：键 + JSON 的 UTF-16 长度 × 2，每条一个键）。
// 逐位等价另由 ink.json 金标准与随机差分（含 Math.exp / Math.hypot 的 V8 复刻）核对。

let hz120x43 = 1000.0 / 120

/// 匀速直线：从 (x0,y) 起向右 len 单位，速度 v（单位/ms），每 step ms 一个采样；可带固定压力 p。
func inkLine43(x0: Double = 20, y: Double = 170, len: Double = 200, v: Double = 0.3, step: Double = hz120x43, p: Double? = nil, t0: Double = 1000) -> [InkPoint] {
    let T = len / v
    var raw: [InkPoint] = []
    var t = 0.0
    while t < T {
        raw.append(InkPoint(x: x0 + v * t, y: y, t: t0 + t, p: p, order: InkPoint.orderXYTP))
        t += step
    }
    raw.append(InkPoint(x: x0 + len, y: y, t: t0 + T, p: p, order: InkPoint.orderXYTP))
    return raw
}

func buildPts43(_ raw: [InkPoint], final: Bool = true, _ o: InkOptions? = nil) throws -> BuiltStroke {
    var opts = o ?? InkOptions()
    opts.final = final
    return try InkMath.buildStroke(raw, options: opts)
}

/// 取弧长在 [a, b] 区间内点的平均宽。
func meanWidthBetween43(_ pts: [InkPoint], _ a: Double, _ b: Double, line l: UInt = #line) -> Double {
    var s = 0.0, sum = 0.0, n = 0.0
    for i in 0..<pts.count {
        if i > 0 { s += JSMath.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) }
        if s >= a && s <= b { sum += pts[i].w!; n += 1 }
    }
    XCTAssertGreaterThan(n, 0, "no points between \(a) and \(b)", line: l)
    return sum / n
}

func close43(_ a: Double, _ b: Double, _ eps: Double, _ msg: String = "", file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertLessThanOrEqual(abs(a - b), eps, "\(msg): \(a) vs \(b) (+-\(eps))", file: file, line: line)
}

/// budget.js inkBytes：{month: {id: Ink}} 每条一个键 shizi.v2.ink.<月>.<id> 的 (键 + JSON) UTF-16 长度 × 2 之和。
func inkBytes43(_ table: [String: [String: JSValue]]) -> Int {
    var total = 0
    for (month, entries) in table { for (id, ink) in entries { total += (Schema.inkRecordKey(month, id).utf16.count + JSONWriter.stringify(ink).utf16.count) * 2 } }
    return total
}

func pointsOfV343(_ str: JSValue) -> Int { (InkMath.base64ToBytes(str.stringValue!)?.count ?? 0) / 4 }

final class InkMathTests: XCTestCase {
    let B = InkParams.standard.base
    let K = InkParams.standard
    let grid = InkMath.grid

    func pol(_ k: String) -> Double { Config.policyNumber(k)! }

    // test/core/ink-math.test.mjs: ink-math: body width = BASE × (1.06 − 0.12·min(v,1.5)); slow is wider than fast
    func testInkMathBodyWidthBASE106012MinV15SlowIsWiderThanFast() throws {
        close43(InkMath.speedFactor(0), 1.06, 1e-12, "v=0")
        close43(InkMath.speedFactor(1.5), 0.88, 1e-12, "v=1.5")
        close43(InkMath.speedFactor(9), 0.88, 1e-12, "v capped at 1.5")
        let slow = try buildPts43(inkLine43(v: 0.1)).points
        let fast = try buildPts43(inkLine43(v: 1.2)).points
        let wSlow = meanWidthBetween43(slow, 80, 140)
        let wFast = meanWidthBetween43(fast, 80, 140)
        XCTAssertGreaterThan(wSlow, wFast, "slow \(wSlow) > fast \(wFast)")
        close43(wSlow, B * InkMath.speedFactor(0.1), 0.15, "slow mid-stroke settles on the body width")
        close43(wFast, B * InkMath.speedFactor(1.2), 0.15, "fast mid-stroke settles on the body width")
    }

    // test/core/ink-math.test.mjs: ink-math: width smoothing is by time (α = 1 − e^(−Δt/35ms)), so 60Hz and 120Hz settle the same
    func testInkMathWidthSmoothingIsByTime60HzAnd120HzSettleTheSame() throws {
        let at120 = try buildPts43(inkLine43(v: 1.0, step: hz120x43)).points
        let at60 = try buildPts43(inkLine43(v: 1.0, step: 1000.0 / 60)).points
        close43(meanWidthBetween43(at120, 80, 140), meanWidthBetween43(at60, 80, 140), 0.08, "mid width independent of sample rate")
    }

    // test/core/ink-math.test.mjs: ink-math: pen pressure replaces the speed factor (D10, not multiplied)
    func testInkMathPenPressureReplacesTheSpeedFactorD10NotMultiplied() throws {
        close43(InkMath.pressureFactor(1), 1.52, 1e-12, "p=1")
        close43(InkMath.pressureFactor(0.25), 0.58 + 0.5 * 0.94, 1e-12, "p=.25")
        close43(InkMath.pressureFactor(0), 0.58, 1e-12, "p=0 floor")
        let slowPen = try buildPts43(inkLine43(v: 0.1, p: 0.25))
        let fastPen = try buildPts43(inkLine43(v: 1.2, p: 0.25))
        let a = meanWidthBetween43(slowPen.points, 80, 140)
        let b = meanWidthBetween43(fastPen.points, 80, 140)
        close43(a, b, 0.05, "same pressure -> same width regardless of speed")
        close43(a, B * InkMath.pressureFactor(0.25), 0.05, "pressure width = BASE x pressure factor (no speed factor multiplied in)")
        let heavy = try buildPts43(inkLine43(v: 1.2, p: 1))
        XCTAssertGreaterThan(meanWidthBetween43(heavy.points, 80, 140), a, "more pressure -> wider")
        XCTAssertTrue(slowPen.pressure)
        XCTAssertTrue(slowPen.points.allSatisfy { $0.p == 0.25 }, "pressure survives Catmull-Rom resampling")
    }

    // test/core/ink-math.test.mjs: ink-math: start of stroke 0.85× → 1.08× → 1.0× over 0–6–12 units
    func testInkMathStartOfStroke085108510Over0612Units() throws {
        let pts = try buildPts43(inkLine43(v: 0.3)).points
        close43(pts[0].w! / B, 0.85, 1e-9, "first point 0.85 x body")
        var s = 0.0, peak = 0.0
        for (i, pt) in pts.enumerated() {
            if i > 0 { s += JSMath.hypot(pt.x - pts[i - 1].x, pt.y - pts[i - 1].y) }
            if s <= 12 { peak = max(peak, pt.w!) }
        }
        let after = meanWidthBetween43(pts, 14, 30)
        XCTAssertGreaterThan(peak, after, "bulge within the first 12 units (\(peak)) > later body (\(after))")
        XCTAssertTrue(peak / after > 1.04 && peak / after < 1.09, "bulge ~ 1.08x (\(peak / after))")
    }

    // test/core/ink-math.test.mjs: ink-math: lift taper follows the 30ms average speed (0.25 / 0.9 thresholds)
    func testInkMathLiftTaperFollowsThe30msAverageSpeed025And09Thresholds() throws {
        let slow = try buildPts43(inkLine43(v: 0.2))
        let fast = try buildPts43(inkLine43(v: 1.2))
        close43(slow.v30!, 0.2, 1e-6, "v30 slow")
        close43(fast.v30!, 1.2, 1e-6, "v30 fast")
        XCTAssertGreaterThan(slow.endK, 1, "v30 <= lo: no taper (endK \(slow.endK))")
        XCTAssertLessThan(fast.endK, 0.15, "v30 >= hi: tapers to ~0.12 (endK \(fast.endK))")
        let live = try buildPts43(inkLine43(v: 1.2), final: false)
        XCTAssertNil(live.v30, "no lift speed while writing")
        XCTAssertGreaterThan(live.endK, fast.endK, "taper only after lift (final=true)")
    }

    // test/core/ink-math.test.mjs: ink-math: 30ms window is interpolated to exactly 30ms (frame-rate independent)
    func testInkMath30msWindowIsInterpolatedToExactly30msFrameRateIndependent() {
        // 1 单位/ms 到 t=100，然后 0.2 单位/ms 走 20ms；采样每 20ms。窗口 [90,120]：20ms×0.2 + 10ms×1 = 14 → 14/30。
        var raw = [0.0, 20, 40, 60, 80, 100].map { InkPoint(x: $0, y: 0, t: $0, order: InkPoint.orderXYTP) }
        raw.append(InkPoint(x: 104, y: 0, t: 120, order: InkPoint.orderXYTP))
        close43(InkMath.liftSpeed(InkMath.mergeSameTime(raw))!, 14.0 / 30, 1e-12, "interpolated window")
        // 同样的运动按 5ms 采样，结果一样
        var dense: [InkPoint] = []
        var t = 0.0
        while t <= 100 { dense.append(InkPoint(x: t, y: 0, t: t, order: InkPoint.orderXYTP)); t += 5 }
        t = 105
        while t <= 120 { dense.append(InkPoint(x: 100 + (t - 100) * 0.2, y: 0, t: t, order: InkPoint.orderXYTP)); t += 5 }
        close43(InkMath.liftSpeed(InkMath.mergeSameTime(dense))!, 14.0 / 30, 1e-12, "same motion at a different sample rate")
        // 整笔短于 30ms：用整段时长
        close43(InkMath.liftSpeed([InkPoint(x: 0, y: 0, t: 0, order: InkPoint.orderXYTP), InkPoint(x: 10, y: 0, t: 10, order: InkPoint.orderXYTP)])!, 1, 1e-12, "shorter than 30ms uses the whole duration")
    }

    // test/core/ink-math.test.mjs: ink-math: zero-dt samples merge (last position wins) and do not enter speed
    func testInkMathZeroDtSamplesMergeLastPositionWinsAndDoNotEnterSpeed() throws {
        func p(_ x: Double, _ y: Double, _ t: Double) -> InkPoint { InkPoint(x: x, y: y, t: t, order: InkPoint.orderXYTP) }
        let raw = [p(10, 10, 0), p(20, 10, 10), p(21, 10, 10), p(30, 10, 20)]
        let m = InkMath.mergeSameTime(raw)
        XCTAssertEqual(m, [p(10, 10, 0), p(21, 10, 10), p(30, 10, 20)])
        let withDup = try buildPts43(raw).points
        let without = try buildPts43([raw[0], raw[2], raw[3]]).points
        XCTAssertEqual(withDup.map { [$0.x, $0.y, $0.w!] }, without.map { [$0.x, $0.y, $0.w!] }, "identical output")
        // 全部同一时刻 -> 单点
        let same = try buildPts43([p(1, 1, 5), p(2, 2, 5)])
        XCTAssertTrue(same.single)
        XCTAssertEqual([same.points[0].x, same.points[0].y], [2, 2], "keeps the last position")
    }

    // test/core/ink-math.test.mjs: ink-math: single point = 0.9 × body width; dot (<24 units, after lift) 0.7 → 1.1 → 0.9
    func testInkMathSinglePoint09BodyWidthDotLessThan24UnitsAfterLift07119() throws {
        let one = try buildPts43([InkPoint(x: 100, y: 100, t: 0, order: InkPoint.orderXYTP)])
        XCTAssertEqual(one.points.count, 1)
        XCTAssertTrue(one.single)
        close43(one.points[0].w!, 0.9 * B, 1e-12, "single point diameter")
        let shortRaw = inkLine43(len: 12, v: 0.2)
        let dot = try buildPts43(shortRaw)
        XCTAssertTrue(dot.dot)
        let bodyW = B * InkMath.speedFactor(0.2) // 短划里本体宽由 BASE 平滑地趋近 BASE × speedFactor(.2)
        close43(dot.points[0].w! / B, 0.7, 1e-9, "dot starts at 0.7 x body (first body width = BASE)")
        let maxRatio = dot.points.map { $0.w! }.max()! / bodyW
        XCTAssertTrue(maxRatio > 1.05 && maxRatio < 1.15, "dot peaks near 1.1 x body (\(maxRatio))")
        close43(dot.points.last!.w! / bodyW, 0.9, 0.05, "dot ends near 0.9 x body")
        let live = try buildPts43(shortRaw, final: false)
        XCTAssertFalse(live.dot, "dot is decided only after lift")
        XCTAssertFalse(try buildPts43(inkLine43(len: 40)).dot, ">= 24 units is not a dot")
    }

    // test/core/ink-math.test.mjs: ink-math: Catmull-Rom resamples about every 3 units and keeps the end point
    func testInkMathCatmullRomResamplesAboutEvery3UnitsAndKeepsTheEndPoint() throws {
        func p(_ x: Double, _ t: Double) -> InkPoint { InkPoint(x: x, y: 0, t: t, order: InkPoint.orderXYTP) }
        let pts = InkMath.catmullRom([p(0, 0), p(30, 30), p(60, 60)])
        XCTAssertGreaterThanOrEqual(pts.count, 21, "~3 units per point (\(pts.count))")
        XCTAssertEqual(pts.last, p(60, 60))
        for i in 1..<pts.count { XCTAssertGreaterThanOrEqual(pts[i].t!, pts[i - 1].t!, "t is monotone") }
        XCTAssertEqual(try buildPts43([]).points.count, 0, "empty input -> no points")
    }

    // test/core/ink-math.test.mjs: ink-math: thinning keeps ≤ inkMaxPointsPerStroke points by arc length, first and last kept
    func testInkMathThinningKeepsAtMostInkMaxPointsPerStrokePointsByArcLengthFirstAndLastKept() throws {
        XCTAssertEqual(pol("inkMaxPointsPerStroke"), 24, "P05 / P78: 24 points per stroke")
        XCTAssertEqual(pol("inkMaxStrokes"), 36)
        let pts = try buildPts43(inkLine43(len: 300, v: 0.05)).points
        XCTAssertGreaterThan(pts.count, 24, "fixture is long (\(pts.count))")
        let thin = InkMath.thinStroke(pts)
        XCTAssertTrue(thin.count <= 24 && thin.count >= 22, "<= 24 points (\(thin.count))")
        XCTAssertEqual(thin[0], pts[0])
        XCTAssertEqual(thin.last, pts.last)
        close43(InkMath.strokeLength(thin), InkMath.strokeLength(pts), 0.5, "straight line keeps its length")
        XCTAssertEqual(InkMath.thinStroke(Array(pts.prefix(5))).count, 5, "short strokes untouched")
        XCTAssertEqual(InkMath.thinStroke(pts, max: 8).count, 8, "custom cap")
    }

    // test/core/ink-math.test.mjs: ink-math: base64 helpers round-trip bytes; dt quantizes to 16 log-spaced levels
    func testInkMathBase64HelpersRoundTripBytesDtQuantizesTo16LogSpacedLevels() {
        for n in [0, 1, 2, 3, 4, 5, 96] {
            let bytes = (0..<n).map { UInt8(($0 * 37 + 11) & 255) }
            let str = InkMath.bytesToBase64(bytes)
            XCTAssertEqual(str.count % 4, 0)
            XCTAssertEqual(str, Data(bytes).base64EncodedString(), "matches standard base64 (\(n) B)")
            XCTAssertEqual(InkMath.base64ToBytes(str)!, bytes)
        }
        XCTAssertNil(InkMath.base64ToBytes("abc"), "length not a multiple of 4 -> nil")
        XCTAssertNil(InkMath.base64ToBytes("ab=c"), "bad padding -> nil")
        XCTAssertEqual(InkMath.dtLevels.count, 16, "4 bits")
        for i in 1..<16 { XCTAssertGreaterThan(InkMath.dtLevels[i], InkMath.dtLevels[i - 1], "levels ascend") }
        for (i, ms) in InkMath.dtLevels.enumerated() { XCTAssertEqual(InkMath.quantizeDt(ms), i, "level \(ms) is a fixed point") }
        XCTAssertEqual(InkMath.quantizeDt(-5), 0)
        XCTAssertEqual(InkMath.quantizeDt(9), 2, "9 ms -> 8")
        XCTAssertEqual(InkMath.quantizeDt(60000), 15, "long pauses saturate at the top level")
    }

    // test/core/ink-math.test.mjs: ink-math: encodeInk → Ink v3 → decodeInk round trip (4 bytes per point, schema-valid)
    func testInkMathEncodeInkInkV3DecodeInkRoundTrip4BytesPerPointSchemaValid() throws {
        let strokes: [[InkPoint]] = [
            try buildPts43(inkLine43(x0: 30, y: 60, len: 120, v: 0.4)).points,
            try buildPts43(inkLine43(x0: 60, y: 200, len: 80, v: 0.9, t0: 3000)).points,
            try buildPts43([InkPoint(x: 172.5, y: 300, t: 5000, order: InkPoint.orderXYTP)]).points,
        ]
        let ink = try InkMath.encodeInk(strokes)
        XCTAssertEqual(ink["v"], n43(3))
        XCTAssertEqual(ink["c"], n43(grid))
        XCTAssertEqual(ink["s"]?.arrayValue?.count, 3)
        XCTAssertNil(ink["dt"], "dt packed into each point")
        XCTAssertNil(ink["p"], "no p row without pen pressure")
        XCTAssertTrue(ink["s"]!.arrayValue!.allSatisfy { $0.stringValue != nil }, "one base64 string per stroke")
        XCTAssertTrue(InkMath.isInkV3(ink) && InkMath.isInk(ink) && !InkMath.isInkV2(ink))
        XCTAssertNil(Schema.validateValue(key: "shizi.v2.ink.2026-09", value: obj43([("r12", ink)])), "passes core/schema.js ink shape")
        let back = try InkMath.decodeInk(ink)!
        XCTAssertEqual(back.count, 3)
        XCTAssertEqual(back[0][0].t, 0, "first point t = 0")
        let gap = back[1][0].t! - back[0].last!.t!
        XCTAssertGreaterThanOrEqual(gap, 1024, "second stroke starts after the (quantized) pause since the first stroke ended (\(gap) ms)")
        for si in 0..<3 {
            let thin = InkMath.simplifyStroke(strokes[si]) // 存储时实际留下的点（P121 自适应抽点）
            XCTAssertEqual(back[si].count, thin.count)
            XCTAssertEqual(pointsOfV343(ink["s"]!.arrayValue![si]), thin.count)
            for (i, pt) in back[si].enumerated() {
                close43(pt.x, thin[i].x, (grid / 1000) / 2 + 1e-9, "x s\(si)p\(i)")
                close43(pt.y, thin[i].y, (grid / 1000) / 2 + 1e-9, "y s\(si)p\(i)")
                close43(pt.w!, thin[i].w!, B * 0.005 + 1e-9, "w s\(si)p\(i)")
                XCTAssertTrue(i == 0 || pt.t! >= back[si][i - 1].t!, "t is monotone")
            }
            // 回放只需大致速度：笔内时长误差补偿后与原始时长相近
            let dur = back[si].last!.t! - back[si][0].t!
            let want = thin.last!.t! - thin[0].t!
            XCTAssertLessThanOrEqual(abs(dur - want), max(16, want * 0.2), "stroke \(si) duration ~ original (\(dur) vs \(Int(want.rounded())) ms)")
        }
        // 再编码稳定（量化网格上的不动点）
        XCTAssertSameJSON(try InkMath.encodeInk(back), ink)
        // 回放：再走一次 Catmull-Rom，端点不变
        let replay = InkMath.resampleForReplay(back)
        XCTAssertEqual([replay[0][0].x, replay[0][0].y], [back[0][0].x, back[0][0].y])
        XCTAssertTrue(replay[0].allSatisfy { $0.w!.isFinite }, "w interpolated for replay")
        XCTAssertNil(try InkMath.decodeInk(J("{\"v\":1,\"c\":345,\"s\":[]}")), "wrong version -> nil")
        XCTAssertNil(try InkMath.decodeInk(J("{\"v\":3,\"c\":345,\"s\":[\"AAA=\"]}")), "3 bytes is not a whole point -> nil")
        XCTAssertNil(try InkMath.decodeInk(J("{\"v\":3,\"c\":345,\"s\":[\"AAAAAA==\"],\"dt\":[[0]]}")), "v3 has no dt field")
        XCTAssertNil(try InkMath.decodeInk(J("{\"v\":3,\"c\":345,\"s\":[\"AAAAAA==\"],\"p\":[\"AAA=\"]}")), "p byte count must match points")
    }

    // test/core/ink-math.test.mjs: ink-math: packing clamps x / y to 10 bits and w to 8 bits
    func testInkMathPackingClampsXYTo10BitsAndWTo8Bits() throws {
        func p(_ x: Double, _ y: Double, _ w: Double, _ t: Double) -> InkPoint { InkPoint(x: x, y: y, t: t, w: w, order: InkPoint.orderXYWTP) }
        let ink = try InkMath.encodeInk([[p(-20, 400, B * 3, 0), p(353, 10, 0, 10)]])
        let back = try InkMath.decodeInk(ink)!
        close43(back[0][0].x, 0, 1e-9, "x < 0 clamps to 0")
        close43(back[0][0].y, 1023 * grid / 1000, 1e-9, "y beyond 1023 clamps to 1023")
        close43(back[0][0].w!, 2.55 * B, 1e-9, "w multiple clamps to 2.55")
        close43(back[0][1].x, 1023 * grid / 1000, 1e-9, "x just outside the grid still fits 10 bits (1023)")
        XCTAssertEqual(back[0][1].w, 0)
    }

    // test/core/ink-math.test.mjs: ink-math: decodeInk still reads legacy InkV2 (P78 read compatibility)
    func testInkMathDecodeInkStillReadsLegacyInkV2P78ReadCompatibility() throws {
        let v2 = J("{\"v\":2,\"c\":345,\"s\":[[100,200,100,110,210,90]],\"dt\":[[0,16]],\"p\":[[0,50]]}")
        XCTAssertTrue(InkMath.isInkV2(v2) && InkMath.isInk(v2))
        XCTAssertNil(Schema.validateValue(key: "shizi.v2.ink.2026-09", value: obj43([("r1", v2)])), "schema still accepts v2")
        let back = try InkMath.decodeInk(v2)!
        XCTAssertEqual(back[0].count, 2)
        close43(back[0][0].x, 34.5, 1e-9)
        close43(back[0][1].w!, 0.9 * B, 1e-9)
        XCTAssertEqual(back[0][1].t, 16)
        XCTAssertEqual(back[0][1].p, 0.5)
        XCTAssertNil(back[0][0].p)
        XCTAssertNil(try InkMath.decodeInk(J("{\"v\":2,\"c\":345,\"s\":[[1,2]]}")), "row not a multiple of 3 -> nil")
    }

    // test/core/ink-math.test.mjs: ink-math: pen pressure survives encoding (p = 1 byte per point, only when present)
    func testInkMathPenPressureSurvivesEncodingP1BytePerPointOnlyWhenPresent() throws {
        let pen = try buildPts43(inkLine43(len: 100, v: 0.5, p: 0.42)).points
        let ink = try InkMath.encodeInk([pen])
        XCTAssertEqual(ink["p"]?.arrayValue?.count, 1)
        let pb = InkMath.base64ToBytes(ink["p"]!.arrayValue![0].stringValue!)!
        XCTAssertEqual(pb.count, pointsOfV343(ink["s"]!.arrayValue![0]), "one pressure byte per point")
        XCTAssertTrue(pb.allSatisfy { Double($0) == (0.42 * 255).rounded() })
        XCTAssertNil(Schema.validateValue(key: "shizi.v2.ink.2026-09", value: obj43([("r3", ink)])))
        let back = try InkMath.decodeInk(ink)!
        XCTAssertTrue(back[0].allSatisfy { abs($0.p! - 0.42) <= 0.5 / 255 + 1e-9 })
    }

    // test/core/ink-math.test.mjs: ink-math: encodeInk caps strokes at inkMaxStrokes and points at inkMaxPointsPerStroke
    func testInkMathEncodeInkCapsStrokesAtInkMaxStrokesAndPointsAtInkMaxPointsPerStroke() throws {
        var many: [[InkPoint]] = []
        for i in 0..<50 { many.append(try buildPts43(inkLine43(y: 5 + Double(i) * 6, len: 250, v: 0.05, t0: Double(i) * 10000)).points) }
        let ink = try InkMath.encodeInk(many)
        XCTAssertEqual(Double(ink["s"]!.arrayValue!.count), pol("inkMaxStrokes"), "<= 36 strokes (first 36 kept)")
        XCTAssertTrue(ink["s"]!.arrayValue!.allSatisfy { Double(pointsOfV343($0)) <= pol("inkMaxPointsPerStroke") }, "<= 24 points per stroke")
        close43(try InkMath.decodeInk(ink)![0][0].y, (5 / grid * 1000).rounded() * grid / 1000, 1e-9, "first stroke kept first")
        let custom = try InkMath.encodeInk(many, options: InkMath.EncodeOptions(maxPoints: 10, maxStrokes: 4))
        XCTAssertEqual(custom["s"]?.arrayValue?.count, 4)
        XCTAssertTrue(custom["s"]!.arrayValue!.allSatisfy { pointsOfV343($0) <= 10 })
        let bytes = JSONWriter.stringify(ink).utf16.count * 2
        XCTAssertLessThan(bytes, 12 * 1024, "36x24 ink stays compact (\(bytes) B)")
    }

    /// 14 笔、每笔抽到 24 点的「大字」。
    func bigChar(_ seed: Int = 0, p: Double? = nil) throws -> [[InkPoint]] {
        var strokes: [[InkPoint]] = []
        var t0 = 1000.0
        for i in 0..<14 {
            let x0 = 20 + Double((i * 53 + seed * 7) % 200)
            let y = 20 + Double((i * 37 + seed * 11) % 300)
            let raw = inkLine43(x0: x0, y: y, len: 60 + Double((i * 29 + seed) % 90), v: 0.3 + Double(i % 4) * 0.15, p: p, t0: t0)
            strokes.append(try buildPts43(raw).points)
            t0 = raw.last!.t! + 380 + Double((i * 17) % 120)
        }
        return strokes
    }

    // test/core/ink-math.test.mjs: ink-math: P78 capacity — 14 strokes × 24 points ≤ 4KB per record; 300 records ≤ 1.2MiB
    func testInkMathP78Capacity14Strokes24PointsAtMost4KBPerRecord300RecordsAtMost12MiB() throws {
        let uniform = InkMath.EncodeOptions(tolerance: .none)
        let strokes = try bigChar()
        XCTAssertTrue(strokes.allSatisfy { Double($0.count) > pol("inkMaxPointsPerStroke") }, "every stroke is long enough to be thinned to the cap")
        let ink = try InkMath.encodeInk(strokes, options: uniform)
        XCTAssertEqual(ink["s"]?.arrayValue?.count, 14)
        XCTAssertTrue(ink["s"]!.arrayValue!.allSatisfy { pointsOfV343($0) == 24 }, "14 x 24 points")
        let one = JSONWriter.stringify(obj43([("r12345", ink)])).utf16.count * 2
        XCTAssertLessThanOrEqual(one, 4 * 1024, "one record's ink (JSON x 2) = \(one) B <= 4096 B")
        // 300 字只存最近一次：按月分键合计（budget.inkBytes 同一估算口径）
        var table: [String: [String: JSValue]] = [:]
        for i in 0..<300 {
            let month = "2026-" + String(format: "%02d", 1 + (i % 10))
            table[month, default: [:]]["r\(10000 + i)"] = try InkMath.encodeInk(try bigChar(i), options: uniform)
        }
        let total = inkBytes43(table)
        XCTAssertLessThanOrEqual(Double(total), 1.2 * 1024 * 1024, "300 records' ink = \(total) B")
        XCTAssertLessThanOrEqual(Double(total), pol("inkBudgetBytes"), "fits the P05 ink budget")
        // v2 对照（旧编码的同一份笔迹）：打包后应当至少小 3 倍
        var v2s: [JSValue] = [], v2dt: [JSValue] = []
        for st in strokes {
            let th = InkMath.thinStroke(st, max: 32)
            v2s.append(.array(th.flatMap { pt in [n43(((pt.x / grid * 1000)).rounded()), n43((pt.y / grid * 1000).rounded()), n43((pt.w! / B * 100).rounded())] }))
            v2dt.append(.array(th.enumerated().map { i, pt in n43(i > 0 ? (pt.t! - th[i - 1].t!).rounded() : 0) }))
        }
        let v2 = obj43([("v", n43(2)), ("c", n43(345)), ("s", .array(v2s)), ("dt", .array(v2dt))])
        let v2Bytes = JSONWriter.stringify(obj43([("r12345", v2)])).utf16.count * 2
        XCTAssertGreaterThan(v2Bytes, one * 3, "v2 (32 pts) \(v2Bytes) B vs v3 \(one) B")
        // 同一个「大字」按 P121 自适应抽点：每笔 ≤ 24 点，整条更小
        let adaptive = try InkMath.encodeInk(strokes)
        XCTAssertTrue(adaptive["s"]!.arrayValue!.allSatisfy { pointsOfV343($0) <= 24 } && JSONWriter.stringify(obj43([("r12345", adaptive)])).utf16.count * 2 < one, "adaptive <= uniform")
    }

    // ---------------------------------------------------------------- D27 容量（阶段 1 P1-E3）：题库真字按笔顺中线模拟书写

    static let deckChars: [(ch: String, strokes: Double)] = {
        var out: [(String, Double)] = []
        var seen = OSet()
        for card in DeckData.shared.seed {
            guard let ch = card["target"]?.stringValue, !ch.isEmpty, seen.insert(ch) else { continue }
            guard FileManager.default.fileExists(atPath: repoRoot.appendingPathComponent("data/\(ch).json").path) else { continue }
            out.append((ch, card["strokes"]?.numberValue ?? 0))
        }
        return out
    }()

    /// 按笔顺中线模拟一个字的书写（每笔起收慢、中段快 0.15–0.7 单位/ms，±0.4 单位手抖，笔间 350ms）→ 原始点（hz）。
    func writeCharRaw(_ ch: String, hz: Double = 120) throws -> [[InkPoint]] {
        let STEP = 1000 / hz
        let data = try JSONParser.parse(try readRepoFile("data/\(ch).json"))
        var out: [[InkPoint]] = []
        var t = 1000.0
        for median in data["medians"]?.arrayValue ?? [] {
            let pts: [(x: Double, y: Double)] = median.arrayValue!.map { p in (p.arrayValue![0].numberValue! / 1024 * grid, (900 - p.arrayValue![1].numberValue!) / 1024 * grid) }
            var cum = [0.0]
            for i in 1..<pts.count { cum.append(cum[i - 1] + JSMath.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)) }
            let L = cum.last!
            var raw: [InkPoint] = []
            var s = 0.0
            var k = 0.0
            while s < L {
                var i = 1
                while i < cum.count - 1 && cum[i] < s { i += 1 }
                let f = cum[i] > cum[i - 1] ? (s - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0
                raw.append(InkPoint(x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f + sin(k * 1.7) * 0.4, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f + cos(k * 2.3) * 0.4, t: t + k * STEP, order: InkPoint.orderXYTP))
                s += (0.15 + 0.55 * sin(Double.pi * min(1, (s / L) * 1.1))) * STEP
                k += 1
            }
            let end = pts.last!
            raw.append(InkPoint(x: end.x, y: end.y, t: t + k * STEP, order: InkPoint.orderXYTP))
            t += k * STEP + 350
            out.append(raw)
        }
        return out
    }

    func writeChar(_ ch: String) throws -> [[InkPoint]] { try writeCharRaw(ch).map { try buildPts43($0).points } }

    func twoCopies(_ chars: [String]) throws -> (bytes: Int, avgStrokes: Double) {
        var table: [String: [String: JSValue]] = [:]
        var strokes = 0
        for (i, ch) in chars.enumerated() {
            let built = try writeChar(ch)
            strokes += built.count
            let first = "2026-" + String(format: "%02d", 1 + (i % 6))
            let latest = "2026-" + String(format: "%02d", 7 + (i % 4))
            table[first, default: [:]]["r\(10000 + i * 2)"] = try InkMath.encodeInk(built)
            table[latest, default: [:]]["r\(10001 + i * 2)"] = try InkMath.encodeInk(try writeChar(ch).map { st in st.map { var q = $0; q.x += 1.3; return q } })
        }
        return (inkBytes43(table), Double(strokes) / Double(chars.count))
    }

    func withAfterSeen(_ chars: [String], _ share: Double) throws -> (bytes: Int, extra: Int) {
        let base = try twoCopies(chars)
        var table: [String: [String: JSValue]] = [:]
        let count = Int((Double(chars.count) * share).rounded())
        for (i, ch) in chars.prefix(count).enumerated() {
            let month = "2026-" + String(format: "%02d", 7 + (i % 4))
            table[month, default: [:]]["r\(20000 + i)"] = try InkMath.encodeInk(try writeChar(ch).map { st in st.map { var q = $0; q.y += 1.1; return q } })
        }
        return (base.bytes + inkBytes43(table), inkBytes43(table))
    }

    var common300: [String] { Self.deckChars.prefix(300).map { $0.ch } }
    var heavy300: [String] { Self.deckChars.filter { $0.strokes >= 12 }.prefix(300).map { $0.ch } }

    // test/core/ink-math.test.mjs: ink-math (Q1 / P176): after-seen ink on top of D27 two copies — measured against the 1.2MiB target and the P05 budget
    func testInkMathQ1P176AfterSeenInkOnTopOfD27TwoCopiesMeasuredAgainstThe12MiBTargetAndTheP05Budget() throws {
        let MiB = 1024.0 * 1024
        let common = common300, heavy = heavy300
        let cMax = try withAfterSeen(common, 1)
        let hMax = try withAfterSeen(heavy, 1)
        let cTyp = try withAfterSeen(common, 0.2)
        let hTyp = try withAfterSeen(heavy, 0.2)
        // 常用 300 字：即使每字都有一份看后自写，仍在 1.2MiB 目标内
        XCTAssertLessThanOrEqual(Double(cMax.bytes), 1.2 * MiB, "common 300 x 3 = \(cMax.bytes) B <= 1.2MiB")
        // 偏难的上限（12 画以上、每字都有）略超 P05 的 1.5MiB（每条一个键的键名开销），在缺省每组字数的预算（P326）内
        XCTAssertLessThanOrEqual(Double(hMax.bytes), pol("inkBudgetBytes") * 1.01, ">=12-stroke 300 x 3 = \(hMax.bytes) B ~ P05 inkBudgetBytes (+1% at most)")
        let defaultBudget = Config.policyValue("inkBudgetByGroupSize")?[String(Int(pol("groupSize")))]?.numberValue ?? pol("inkBudgetBytes")
        XCTAssertLessThanOrEqual(Double(hMax.bytes), defaultBudget, ">=12-stroke 300 x 3 = \(hMax.bytes) B <= default P326 ink budget")
        // 实际的比例（看过答案且自己写了、之后还没再判断的字）远低于全部：20% 时两组都在 1.2MiB 内
        XCTAssertTrue(Double(cTyp.bytes) <= 1.2 * MiB && Double(hTyp.bytes) <= 1.2 * MiB, "20% share stays within 1.2MiB")
    }

    // test/core/ink-math.test.mjs: ink-math (P121): simplifyStroke keeps corners, width changes and pauses; straight steady strokes need few points; cap holds
    func testInkMathP121SimplifyStrokeKeepsCornersWidthChangesAndPausesStraightSteadyStrokesNeedFewPointsCapHolds() throws {
        let straight = try buildPts43(inkLine43(len: 240, v: 0.4)).points
        let s1 = InkMath.simplifyStroke(straight)
        XCTAssertTrue(s1.count < 12 && s1.count >= 2, "steady straight stroke -> few points (\(s1.count))")
        XCTAssertEqual([s1[0], s1.last!], [straight[0], straight.last!], "first and last kept as-is")
        // 折笔：横到 (200,100) 再竖下 —— 拐角点要在
        var raw: [InkPoint] = []
        for k in 0...40 { raw.append(InkPoint(x: 40 + Double(k) * 4, y: 100, t: 1000 + Double(k) * hz120x43, order: InkPoint.orderXYTP)) }
        for k in 1...30 { raw.append(InkPoint(x: 200, y: 100 + Double(k) * 4, t: 1000 + Double(40 + k) * hz120x43, order: InkPoint.orderXYTP)) }
        let corner = InkMath.simplifyStroke(try buildPts43(raw).points)
        XCTAssertTrue(corner.contains { JSMath.hypot($0.x - 200, $0.y - 100) < 6 }, "the corner survives")
        // 停顿：中途停 200ms（同一位置），时间误差逼出停顿点
        var pause: [InkPoint] = []
        for k in 0...30 { pause.append(InkPoint(x: 40 + Double(k) * 4, y: 200, t: 1000 + Double(k) * hz120x43 + (k > 15 ? 200 : 0), order: InkPoint.orderXYTP)) }
        let built = try buildPts43(pause).points
        let sp = InkMath.simplifyStroke(built)
        func lerpT(_ pts: [InkPoint], _ x: Double) -> Double {
            for i in 1..<pts.count where pts[i].x >= x {
                return pts[i - 1].t! + (pts[i].t! - pts[i - 1].t!) * ((x - pts[i - 1].x) / (pts[i].x - pts[i - 1].x == 0 ? 1 : pts[i].x - pts[i - 1].x))
            }
            return pts.last!.t!
        }
        for p in built { XCTAssertLessThanOrEqual(abs(lerpT(sp, p.x) - p.t!), 24 * 1.5 + 1, "timing kept around the pause (x=\(p.x))") }
        // 上限与回退
        var wiggle: [InkPoint] = []
        for k in 0...200 { wiggle.append(InkPoint(x: 20 + Double(k) * 1.5, y: 170 + sin(Double(k) / 2) * 30, t: 1000 + Double(k) * hz120x43, order: InkPoint.orderXYTP)) }
        let w = try buildPts43(wiggle).points
        XCTAssertEqual(Double(InkMath.simplifyStroke(w).count), pol("inkMaxPointsPerStroke"), "a very wiggly stroke is capped at inkMaxPointsPerStroke")
        XCTAssertEqual(InkMath.simplifyStroke(w, max: 10).count, 10)
        XCTAssertEqual(InkMath.simplifyStroke(w, tolerance: .none), InkMath.thinStroke(w), "tolerance:null -> uniform thinning (P78)")
    }

    func twoCopiesRaw(_ chars: [String], _ hz: Double) throws -> (bytes: Int, perRecord: Double, avgPoints: Double) {
        var table: [String: [String: JSValue]] = [:]
        var points = 0, strokes = 0
        for (i, ch) in chars.enumerated() {
            let raw = try writeCharRaw(ch, hz: hz)
            strokes += raw.count
            for st in raw { points += st.count }
            let first = "2026-" + String(format: "%02d", 1 + (i % 6))
            let latest = "2026-" + String(format: "%02d", 7 + (i % 4))
            table[first, default: [:]]["r\(10000 + i * 2)"] = InkMath.encodeInkRaw(raw)
            table[latest, default: [:]]["r\(10001 + i * 2)"] = InkMath.encodeInkRaw(raw.map { st in st.map { var q = $0; q.x += 1.3; return q } })
        }
        let bytes = inkBytes43(table)
        return (bytes, Double(bytes) / Double(chars.count * 2), Double(points) / Double(strokes))
    }

    // test/core/ink-math.test.mjs: ink-math (B2.3 ink v4 raw points): 300 real characters × 2 copies — measured against the web (P05 / P326) and native ink budgets
    func testInkMathB23InkV4RawPoints300RealCharacters2CopiesMeasuredAgainstTheWebP05P326AndNativeInkBudgets() throws {
        let common = common300, heavy = heavy300
        var rows: [(hz: Double, a: (bytes: Int, perRecord: Double, avgPoints: Double), b: (bytes: Int, perRecord: Double, avgPoints: Double))] = []
        for hz in [60.0, 120, 240] { rows.append((hz, try twoCopiesRaw(common, hz), try twoCopiesRaw(heavy, hz))) }
        let at120 = rows.first { $0.hz == 120 }!
        let v3 = try twoCopies(common).bytes
        // 原生（policy.nativeStorage.inkFormat 'raw'）：120Hz 常用字每份 ≤ 4KiB；原生墨迹预算容得下 3500 字 × 2 份（120Hz）
        XCTAssertEqual(Config.policyString("nativeStorage.inkFormat"), "raw")
        let nativeBudget = Config.policyNumber("nativeStorage.inkBudgetBytes")!
        XCTAssertLessThanOrEqual(at120.a.perRecord, 4 * 1024, "120Hz common: \(at120.a.perRecord / 1024) KiB/record <= 4 KiB")
        XCTAssertLessThanOrEqual(at120.a.perRecord * 2 * 3500, nativeBudget, "3500 chars x 2 copies @120Hz fit the native ink budget")
        // 最重的情形（Pencil 240Hz、12 画以上）：预算仍容约 2000 字 × 2 份
        let worst = rows.first { $0.hz == 240 }!.b.perRecord
        XCTAssertLessThanOrEqual(worst * 2 * 1900, nativeBudget, "240Hz >=12-stroke \(worst / 1024) KiB/record: >= 1900 chars x 2")
        // 网页仍存 v3（policy.inkFormat，P05）：原始点约为 v3 的 2.9 倍
        XCTAssertEqual(Config.policyString("inkFormat"), "v3")
        XCTAssertGreaterThan(at120.a.bytes, v3 * 2, "raw points are several times v3 — why the web keeps v3")
    }

    // test/core/ink-math.test.mjs: ink-math (D27 / P1-E3): 300 real characters × 2 copies (first + latest) ≤ 1.2MiB with ink v3
    func testInkMathD27P1E3300RealCharacters2CopiesFirstLatestAtMost12MiBWithInkV3() throws {
        let common = common300, heavy = heavy300
        XCTAssertEqual(common.count, 300)
        XCTAssertEqual(heavy.count, 300)
        let a = try twoCopies(common)
        let b = try twoCopies(heavy)
        let MiB = 1024.0 * 1024
        XCTAssertLessThanOrEqual(Double(a.bytes), 1.2 * MiB, "common 300 x 2 = \(a.bytes) B <= 1.2MiB")
        XCTAssertLessThanOrEqual(Double(b.bytes), 1.2 * MiB, ">=12-stroke 300 x 2 = \(b.bytes) B <= 1.2MiB")
        XCTAssertLessThanOrEqual(Double(b.bytes), pol("inkBudgetBytes"), "fits the P05 ink budget (so routine commits never need to recycle first / latest)")
    }

    // test/core/ink-math.test.mjs: ink-math (P121): store-time simplification keeps the shape — replay stays within 2 units / width within 0.75 units of the written stroke
    func testInkMathP121StoreTimeSimplificationKeepsTheShapeReplayStaysWithin2UnitsWidthWithin075UnitsOfTheWrittenStroke() throws {
        func segDist(_ p: InkPoint, _ a: InkPoint, _ b: InkPoint) -> (d: Double, w: Double) {
            let dx = b.x - a.x, dy = b.y - a.y
            let L2 = dx * dx + dy * dy
            let s = L2 > 0 ? max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0
            return (JSMath.hypot(a.x + dx * s - p.x, a.y + dy * s - p.y), abs(a.w! + (b.w! - a.w!) * s - p.w!))
        }
        func deviation(_ A: [InkPoint], _ Bs: [InkPoint]) -> (xy: Double, w: Double) {
            var xy = 0.0, w = 0.0
            for p in A {
                var best: (d: Double, w: Double) = (.infinity, 0)
                for i in 1..<Bs.count { let r = segDist(p, Bs[i - 1], Bs[i]); if r.d < best.d { best = r } }
                xy = max(xy, best.d)
                w = max(w, best.w)
            }
            return (xy, w)
        }
        let chars = Self.deckChars.filter { $0.strokes >= 12 }.prefix(300).enumerated().filter { $0.offset % 15 == 0 }.map { $0.element.ch }
        var worst = (xy: 0.0, w: 0.0), worstUniform = (xy: 0.0, w: 0.0)
        for ch in chars {
            let built = try writeChar(ch)
            let truth = built.map { InkMath.catmullRom($0) }
            let replay = InkMath.resampleForReplay(try InkMath.decodeInk(try InkMath.encodeInk(built))!)
            let uniform = InkMath.resampleForReplay(try InkMath.decodeInk(try InkMath.encodeInk(built, options: InkMath.EncodeOptions(tolerance: .none)))!)
            for (k, st) in truth.enumerated() {
                for (A, Bs) in [(st, replay[k]), (replay[k], st)] {
                    let d = deviation(A, Bs)
                    worst = (max(worst.xy, d.xy), max(worst.w, d.w))
                }
                let u = deviation(st, uniform[k])
                worstUniform = (max(worstUniform.xy, u.xy), max(worstUniform.w, u.w))
            }
        }
        XCTAssertLessThanOrEqual(worst.xy, 2, "max position deviation \(worst.xy) <= 2 units")
        XCTAssertLessThanOrEqual(worst.w, 0.75, "max width deviation \(worst.w) <= 0.75 units")
        XCTAssertTrue(worst.xy <= worstUniform.xy && worst.w <= worstUniform.w, "no worse than the old uniform 24-point thinning")
    }

    // test/core/ink-math.test.mjs: ink-math: raw session strokes encode losslessly enough to rebuild the same ink
    func testInkMathRawSessionStrokesEncodeLosslesslyEnoughToRebuildTheSameInk() throws {
        let raws = [inkLine43(len: 90, v: 0.35), inkLine43(len: 50, v: 0.6, p: 0.3, t0: 4000)]
        let rows = InkMath.encodeRawStrokes(raws)
        XCTAssertEqual(rows[0][0], 3)
        XCTAssertEqual(rows[1][0], 4)
        XCTAssertTrue(rows.allSatisfy { $0.allSatisfy { $0.rounded(.towardZero) == $0 } })
        let back = InkMath.decodeRawStrokes(rows)
        XCTAssertEqual(back.count, 2)
        for (i, s) in back.enumerated() {
            XCTAssertEqual(s.count, raws[i].count)
            for (j, pt) in s.enumerated() {
                close43(pt.x, raws[i][j].x, 0.05 + 1e-9, "x")
                close43(pt.t!, raws[i][j].t! - raws[i][0].t!, 0.5 + 1e-9, "t")
            }
        }
        XCTAssertTrue(back[1].allSatisfy { abs($0.p! - 0.3) < 1e-9 })
        let a = try buildPts43(raws[0]).points
        let b = try buildPts43(back[0]).points
        close43(a.last!.w!, b.last!.w!, 0.05, "rebuilt end width matches")
        close43(meanWidthBetween43(a, 30, 60), meanWidthBetween43(b, 30, 60), 0.05, "rebuilt body width matches")
        XCTAssertEqual(InkMath.decodeRawStrokes([[5, 1, 2, 3], [.nan], [3, 1, 2]]).count, 0, "bad rows skipped")
    }

    // test/core/ink-math.test.mjs: ink-math: hand-feel constants come from policy.ink (P65); decided spec stays in INK_SPEC
    func testInkMathHandFeelConstantsComeFromPolicyInkP65DecidedSpecStaysInINKSPEC() {
        let ink = Config.policyValue("ink")!
        XCTAssertEqual([ink["base"], ink["lo"], ink["hi"], ink["pressureLo"], ink["pressureGain"], ink["pressureHi"]], [n43(11.5), n43(0.25), n43(0.9), n43(0.58), n43(0.94), n43(1.52)], "P65 transitional values")
        for key in InkParams.tunableKeys { XCTAssertEqual(K[key], ink[key]?.numberValue, "INK.\(key) reads policy.ink.\(key)") }
        XCTAssertEqual(ink.objectValue!.keys.sorted(), InkParams.tunableKeys.sorted(), "policy.ink holds exactly the tunable keys")
        XCTAssertEqual(InkParams.spec.map { "\($0.0)=\($0.1)" }, ["speedCap=1.5", "tau=35.0", "window=30.0", "dotLen=24.0", "single=0.9"])
        for (key, _) in InkParams.spec { XCTAssertNil(ink[key], "\(key) is decided spec, not a policy key") }
        XCTAssertEqual(InkMath.pressureFactor(1), 1.52)
        XCTAssertEqual(InkMath.pressureFactor(0), 0.58)
    }

    // test/core/ink-math.test.mjs: ink-math: policy.ink can be injected (opts.policy) and single keys overridden (opts.base / lo / hi …)
    func testInkMathPolicyInkCanBeInjectedOptsPolicyAndSingleKeysOverriddenOptsBaseLoHi() throws {
        let raw = inkLine43(v: 0.3)
        let def = try buildPts43(raw).points
        var wide = Config.policy.objectValue!
        var inkTable = wide["ink"]!.objectValue!
        inkTable["base"] = n43(23)
        wide["ink"] = .object(inkTable)
        let injected = try buildPts43(raw, InkOptions(policy: wide)).points
        let overridden = try buildPts43(raw, InkOptions(overrides: ["base": 23])).points
        func mid(_ pts: [InkPoint]) -> Double { pts[pts.count / 2].w! }
        XCTAssertLessThan(abs(mid(injected) / mid(def) - 2), 0.01, "injected base 23 doubles the body width")
        XCTAssertLessThan(abs(mid(overridden) - mid(injected)), 1e-9, "opts.base overrides the same way")
        let sparse = inkLine43(v: 0.3, step: 50) // 采样相距 15 单位：step 3 -> 每段 5 点，step 9 -> 每段 2 点
        let fine = try buildPts43(sparse).points
        let coarse = try buildPts43(sparse, InkOptions(overrides: ["step": 9])).points
        XCTAssertLessThan(Double(coarse.count), Double(fine.count) * 0.6, "opts.step (P65) coarsens the resampling (\(coarse.count) vs \(fine.count))")
        let slowTaper = try buildPts43(inkLine43(v: 0.6), InkOptions(overrides: ["hi": 5])).points
        let fastTaper = try buildPts43(inkLine43(v: 0.6)).points
        XCTAssertGreaterThan(slowTaper.last!.w!, fastTaper.last!.w!, "opts.hi changes the lift taper")
        XCTAssertEqual(try InkParams(policy: wide).base, 23)
        var noLo = inkTable
        noLo["lo"] = nil
        var p2 = Config.policy.objectValue!
        p2["ink"] = .object(noLo)
        XCTAssertThrowsCore("type", containing: "policy.ink.lo") { _ = try InkParams(policy: p2) }
        XCTAssertThrowsCore("type", containing: "policy.ink") { _ = try InkParams(policy: JSObject()) }
        let ink = try InkMath.encodeInk([def], options: InkMath.EncodeOptions(policy: wide))
        close43(try InkMath.decodeInk(ink, options: InkOptions(policy: wide))![0][0].w!, def[0].w!, 0.2, "encode / decode use the injected base for w")
    }
}
