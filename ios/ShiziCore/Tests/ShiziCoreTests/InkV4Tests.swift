import Foundation
import XCTest
@testable import ShiziCore

// test/core/ink-v4.test.mjs 的转写（6 个用例，用例名保留原名）。B2.3 Ink v4（原始点）：与会话现场的 encodeRawStrokes 逐整数互逆；坏串解不开；
// 解码 = 书写时同一管线；回放一致性夹具 ink-v4-fixture.json（与 ShiziWriteTests 的 InkSurfaceTests 共用）里的每条墨迹，ShiziCore 解出的行 / 原始点与夹具逐点相同。

/// 与 JS 测试同一个线性同余伪随机（`s = s * 1664525 + 1013904223 >>> 0`）。
struct InkRng {
    var s: UInt32
    init(_ seed: UInt32) { s = seed }
    mutating func next() -> Double {
        s = s &* 1664525 &+ 1013904223
        return Double(s) / 4294967296
    }
}

func randomStroke43(_ r: inout InkRng, pen: Bool = false, n nOpt: Int? = nil, t0: Double = 0) -> [InkPoint] {
    let n = nOpt ?? (2 + Int((r.next() * 120).rounded(.down)))
    var pts: [InkPoint] = []
    var x = r.next() * 345
    var y = r.next() * 345
    var t = t0
    for _ in 0..<n {
        let a = r.next() - 0.5
        let b = r.next() < 0.05 ? 400.0 : 12.0
        x += a * b // 偶尔大跳（多字节变长整数）、可出格（负数）
        y += (r.next() - 0.5) * 12
        t += r.next() < 0.03 ? 300 + r.next() * 5000 : r.next() * 17 // 偶尔长停顿
        var q = InkPoint(x: x, y: y, t: t, order: InkPoint.orderXYTP)
        if pen { q.p = r.next() < 0.1 ? 0 : r.next() }
        pts.append(q)
    }
    return pts
}

final class InkV4Tests: XCTestCase {
    // test/core/ink-v4.test.mjs: Ink v4 packing is the exact inverse of encodeRawStrokes rows (random strokes, finger + pen, out-of-grid, long pauses)
    func testInkV4PackingIsTheExactInverseOfEncodeRawStrokesRowsRandomStrokesFingerPenOutOfGridLongPauses() {
        var r = InkRng(20261021)
        for i in 0..<400 {
            let row = InkMath.encodeRawStrokes([randomStroke43(&r, pen: i % 3 == 0)])[0].map { $0 == 0 ? 0 : $0 } // -0 -> 0
            guard let packed = InkMath.rawRowToPacked(row) else { return XCTFail("case \(i): not packable") }
            XCTAssertEqual(InkMath.packedToRawRow(packed), row, "case \(i)")
        }
        XCTAssertNil(InkMath.rawRowToPacked([3, 1, 2]), "bad row")
    }

    // test/core/ink-v4.test.mjs: Ink v4: corrupted packed strings never decode (truncated varint, bad stride, too short, not base64)
    func testInkV4CorruptedPackedStringsNeverDecodeTruncatedVarintBadStrideTooShortNotBase64() {
        let good = InkMath.rawRowToPacked(InkMath.encodeRawStrokes([[InkPoint(x: 10, y: 20, t: 0, order: InkPoint.orderXYTP), InkPoint(x: 40, y: 20, t: 8, order: InkPoint.orderXYTP)]])[0])!
        let bytes = InkMath.base64ToBytes(good)!
        func b64(_ a: [UInt8]) -> String { InkMath.bytesToBase64(a) }
        XCTAssertNil(InkMath.packedToRawRow(b64(Array(bytes.dropLast()) + [0x80])), "truncated varint")
        XCTAssertNil(InkMath.packedToRawRow(b64([5] + Array(bytes.dropFirst()))), "stride 5")
        XCTAssertNil(InkMath.packedToRawRow(b64([3, 1, 2])), "shorter than one point")
        XCTAssertNil(InkMath.packedToRawRow(b64([3, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01, 0, 0])), "varint longer than 5 bytes")
        XCTAssertNil(InkMath.packedToRawRow("not base64!"))
        XCTAssertFalse(InkMath.isInkV4(obj43([("v", n43(4)), ("c", n43(345)), ("r", arrayOf43([good, "AAA="])), ("g", jsArray43([n43(0), n43(0)]))])), "one bad stroke = whole ink invalid")
        XCTAssertNil(InkMath.decodeInkRaw(obj43([("v", n43(4)), ("c", n43(345)), ("r", arrayOf43([good])), ("g", jsArray43([n43(0), n43(1)]))])), "g length must match")
        XCTAssertNil(InkMath.decodeInkRaw(obj43([("v", n43(4)), ("c", n43(345)), ("r", arrayOf43([good])), ("g", jsArray43([n43(-1)]))])))
        XCTAssertNil(try InkMath.decodeInk(obj43([("v", n43(4)), ("c", n43(345)), ("r", arrayOf43([good])), ("g", jsArray43([n43(0), n43(1)]))])), "g length must match (decodeInk)")
    }

    // test/core/ink-v4.test.mjs: Ink v4: encode keeps strokes ≤ inkMaxStrokes, gaps between strokes, empty strokes dropped; schema and inkHasStrokes agree
    func testInkV4EncodeKeepsStrokesAtMostInkMaxStrokesGapsBetweenStrokesEmptyStrokesDroppedSchemaAndInkHasStrokesAgree() throws {
        var r = InkRng(7)
        var strokes: [[InkPoint]] = []
        var t = 1000.0
        for i in 0..<40 {
            let st = randomStroke43(&r, n: 5, t0: t)
            strokes.append(st)
            strokes.append([])
            t = st.last!.t! + 100 + Double(i)
        }
        let ink = InkMath.encodeInkRaw(strokes)
        let rs = ink["r"]!.arrayValue!, g = ink["g"]!.arrayValue!
        XCTAssertEqual(rs.count, 36, "P05: first 36 strokes")
        XCTAssertEqual(g[0], n43(0))
        let kept = strokes.filter { !$0.isEmpty }
        let want = [1, 2, 3].map { i in n43(JSMath.round(kept[i][0].t! - kept[i - 1].last!.t!)) }
        XCTAssertEqual(Array(g[1..<4]), want, "gaps (ms) between strokes")
        XCTAssertTrue(g.dropFirst().allSatisfy { ($0.numberValue ?? 0) >= 100 }, "every gap >= the 100ms pause")
        XCTAssertTrue(InkMath.isInkV4(ink) && InkMath.isInk(ink))
        XCTAssertNil(Schema.validateValue(key: "shizi.v2.ink.2026-10.r1", value: ink))
        XCTAssertTrue(InkPick.inkHasStrokes(ink))
        XCTAssertFalse(InkPick.inkHasStrokes(InkMath.encodeInkRaw([])))
        XCTAssertSameJSON(InkMath.encodeInkRaw([]), J("{\"v\":4,\"c\":345,\"r\":[],\"g\":[]}"))
    }

    // test/core/ink-v4.test.mjs: Ink v4 on the web: decodeInk = buildStroke(final) over the decoded raw points (same pipeline as when written); cached per ink object
    func testInkV4OnTheWebDecodeInkBuildStrokeFinalOverTheDecodedRawPointsSamePipelineAsWhenWrittenCachedPerInkObject() throws {
        // 缓存（WeakMap，按墨迹对象）是网页的优化，Swift 版不移植；这里核对「解码 = 对解出的原始点逐笔 buildStroke(final)」，且自定义参数起作用
        var r = InkRng(11)
        let strokes = [randomStroke43(&r, n: 30), randomStroke43(&r, pen: true, n: 20, t0: 5000)]
        let ink = InkMath.encodeInkRaw(strokes)
        let raw = InkMath.decodeInkRaw(ink)!
        let want: [[InkPoint]] = try raw.map { s in
            try InkMath.buildStroke(s, options: InkOptions(final: true)).points.map { q in
                var o = InkPoint(x: q.x, y: q.y, t: q.t, w: q.w, order: InkPoint.orderXYWTP)
                if let p = q.p { o.p = p }
                return o
            }
        }
        let got = try InkMath.decodeInk(ink)!
        XCTAssertEqual(got, want)
        XCTAssertNotEqual(try InkMath.decodeInk(ink, options: InkOptions(overrides: ["base": 15], base: 15))!, got, "custom params change the widths")
    }

    // test/core/ink-v4.test.mjs: encodeStoredInk: raw (native) → Ink v4; v3 (web localStorage) → the old pipeline
    func testEncodeStoredInkRawNativeInkV4V3WebLocalStorageTheOldPipeline() throws {
        let strokes = [[InkPoint(x: 60, y: 170, t: 0, order: InkPoint.orderXYTP), InkPoint(x: 170, y: 171, t: 60, order: InkPoint.orderXYTP), InkPoint(x: 280, y: 172, t: 120, order: InkPoint.orderXYTP)]]
        XCTAssertTrue(InkMath.isInkV4(try InkMath.encodeStoredInk(strokes)), "default raw")
        XCTAssertTrue(InkMath.isInkV4(try InkMath.encodeStoredInk(strokes, format: "raw")))
        XCTAssertTrue(InkMath.isInkV3(try InkMath.encodeStoredInk(strokes, format: "v3")))
    }

    // test/core/ink-v4.test.mjs: replay fixture (ink-v4-fixture.json, shared with the native XCTest) is up to date; replay ≈ written (area within 1%)
    func testReplayFixtureInkV4FixtureJsonSharedWithTheNativeXCTestIsUpToDateReplayWrittenAreaWithin1() throws {
        // 夹具与代码同步由 node 测试守（--check），「回放面积与书写时 ≤ 1%」用的是 ink-model 参考实现，留在 node；
        // ShiziCore 这一半：夹具里每条墨迹，Swift 解出的行（rows）与原始点（raw）与 JS 逐点相同。
        let text = try readRepoFile("docs/engineering/v10/phase1/ink-model/ink-v4-fixture.json")
        let doc = try JSONParser.parse(text)
        let cases = doc["cases"]?.arrayValue ?? []
        XCTAssertGreaterThanOrEqual(cases.count, 21)
        for c in cases {
            let id = c.str("id") ?? "?"
            let ink = c["ink"]!
            let rows = InkMath.inkRawRows(ink)!
            XCTAssertEqual(rows, (c["rows"]?.arrayValue ?? []).map { $0.arrayValue!.map { $0.numberValue! } }, id + " rows")
            let raw = InkMath.decodeInkRaw(ink)!
            let wantRaw = c["raw"]?.arrayValue ?? []
            XCTAssertEqual(raw.count, wantRaw.count, id)
            for (si, stroke) in raw.enumerated() {
                let want = wantRaw[si].arrayValue!
                XCTAssertEqual(stroke.count, want.count, id)
                for (pi, pt) in stroke.enumerated() {
                    let w = want[pi].arrayValue!.map { $0.numberValue! }
                    // 夹具里 x / y 取 12 位有效数字（r9）
                    close43(pt.x, w[0], 1e-9 * max(1, abs(w[0])), "\(id) s\(si) p\(pi) x")
                    close43(pt.y, w[1], 1e-9 * max(1, abs(w[1])), "\(id) s\(si) p\(pi) y")
                    XCTAssertEqual(pt.t, w[2], "\(id) s\(si) p\(pi) t")
                    if w.count > 3 { close43(pt.p ?? .nan, w[3], 1e-9, "\(id) s\(si) p\(pi) p") } else { XCTAssertNil(pt.p, "\(id) s\(si) p\(pi) has no p") }
                }
            }
        }
    }

    // （B4.3 新增，非转写）B4.1 的 Ink 模型接上编解码：解包 / 形状 / 有没有笔画
    func testInkModelDecodesThroughInkMath() throws {
        var r = InkRng(5)
        let ink = try Ink(js: InkMath.encodeInkRaw([randomStroke43(&r, n: 12)]))
        XCTAssertTrue(ink.isReadable)
        XCTAssertTrue(ink.hasStrokes)
        XCTAssertEqual(try ink.decodedStrokes()?.count, 1)
        let empty = try Ink(js: InkMath.encodeInkRaw([]))
        XCTAssertFalse(empty.hasStrokes)
        XCTAssertEqual(try empty.decodedStrokes()?.count, 0)
    }
}
