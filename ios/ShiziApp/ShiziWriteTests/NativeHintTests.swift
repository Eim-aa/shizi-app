import UIKit
import XCTest
@testable import Shizi

// B2.2 原生写字页的纯逻辑（scheme ShiziWriteTests）：提示视图状态机与「写过哪笔收哪笔」的匹配、版式公式、桥上的数据格式，
// 逐值对照网页同一组函数的输出（期望值由 node 跑 src/ui/screens/write/hint-layer.js 与 layout.js 得出，见各用例注释）。

final class NativeHintTests: XCTestCase {
    // MARK: 提示视图（hint-layer.js initialHintView / reduceHintView）

    func testHintViewFollowsTheWebReducer() {
        // initialHintView('k', {hints:2, hintRange:{0,4}}, written 2) → absorbed 0,1；restored
        var v = NativeHintView(used: 2, range: 0..<4, written: 2)
        XCTAssertEqual(v.absorbed, [.init(user: 0, hint: 0), .init(user: 1, hint: 1)])
        XCTAssertTrue(v.restored)
        XCTAssertEqual(v.remaining, [2, 3])
        // absorb(user 2 → hint 3)；hint {4,6} written 5 → 并入 {0,6}、新一段里已写的第 4 笔直接收掉、正在淡出的保留
        XCTAssertTrue(v.absorb(user: 2, hint: 3))
        v.give(segment: 4..<6, merged: 0..<6, used: 3, written: 5)
        XCTAssertEqual(v.range, 0..<6)
        XCTAssertEqual(v.used, 3)
        XCTAssertEqual(v.absorbed, [.init(user: 0, hint: 0), .init(user: 1, hint: 1), .init(user: 2, hint: 3), .init(user: 4, hint: 4)])
        XCTAssertEqual(v.fading, [3])
        XCTAssertEqual(v.remaining, [2, 5])
        XCTAssertEqual(v.run, 1)
        XCTAssertFalse(v.restored)
        // restore(fromUser 2)：第 2 笔起收掉的回来
        XCTAssertTrue(v.restore(fromUser: 2))
        XCTAssertEqual(v.absorbed, [.init(user: 0, hint: 0), .init(user: 1, hint: 1)])
        XCTAssertEqual(v.fading, [])
        XCTAssertEqual(v.remaining, [2, 3, 4, 5])
        XCTAssertEqual(v.run, 2)
        XCTAssertFalse(v.restore(fromUser: 2), "nothing more to bring back")
        // 不紧接着现有范围的一段：重来（已收掉的不保留）
        var w = NativeHintView(used: 1, range: 2..<3, written: 0)
        w.give(segment: 0..<1, merged: 0..<1, used: 2, written: 0)
        XCTAssertEqual(w.absorbed, [])
        XCTAssertEqual(w.remaining, [0])
        XCTAssertFalse(w.absorb(user: 0, hint: 2), "not in the current range")
    }

    func testHintMatchFollowsTheWeb() {
        // matchHintStroke：序号在剩余里就是它；否则几何最近且平均距离 ≤ 40（node：match 1，平均距离 3；剩余 [0, 2] → null）
        let medians: [[CGPoint]] = [[CGPoint(x: 10, y: 10), CGPoint(x: 100, y: 10)], [CGPoint(x: 10, y: 200), CGPoint(x: 300, y: 200)], [CGPoint(x: 50, y: 50)]]
        let pts = (0..<30).map { InkRawPoint(x: 12 + Double($0) * 9, y: 196 + Double($0 % 3), t: Double($0)) }
        XCTAssertEqual(NativeHintMatch.match(remaining: [0, 1, 2], index: 5, points: pts, medians: medians, maxDist: 40), 1)
        XCTAssertEqual(NativeHintMatch.meanDistance(pts, medians[1]), 3, accuracy: 1e-9)
        XCTAssertNil(NativeHintMatch.match(remaining: [0, 2], index: 5, points: pts, medians: medians, maxDist: 40))
        XCTAssertEqual(NativeHintMatch.match(remaining: [0, 2], index: 2, points: nil, medians: nil, maxDist: 40), 2, "order first")
        XCTAssertNil(NativeHintMatch.match(remaining: [], index: 0, points: pts, medians: medians, maxDist: 40))
    }

    // MARK: 版式（layout.js writeLayout / judgePairSize；node 输出逐值）

    func testLayoutMatchesTheWebFormulas() {
        let k = NativeWriteLayoutConstants()
        // (宽, 高, 上安全区, 主按钮底线, 题面高) → (名义主区高, g, 组顶, 书写格顶, 判断格 S)
        let cases: [(CGFloat, CGFloat, CGFloat, CGFloat, CGFloat, CGFloat, CGFloat, CGFloat, CGFloat, CGFloat)] = [
            (402, 874, 62, 34, 80, 600, 362, 22, 118, 233),
            (402, 874, 62, 34, 101, 600, 362, 13, 130, 227),
            (375, 667, 20, 24, 80, 445, 245, 12, 108, 160),
            (375, 667, 20, 24, 101, 445, 245, 0, 117, 156),
            (440, 956, 62, 34, 80, 682, 400, 39, 135, 265),
            (440, 956, 62, 34, 101, 682, 400, 31, 148, 259),
            (320, 568, 20, 24, 80, 346, 180, 0, 96, 120),
            (320, 568, 20, 24, 101, 346, 180, 0, 117, 120),
        ]
        for c in cases {
            let nominal = NativeWriteLayout.nominalMainHeight(pageHeight: c.1, safeTop: c.2, footBottom: c.3, k)
            XCTAssertEqual(nominal, c.5, "\(c)")
            let r = NativeWriteLayout.write(width: c.0, nominalHeight: nominal, promptHeight: c.4, headExtra: 0, k)
            XCTAssertEqual(r.g, c.6, "g \(c)")
            XCTAssertEqual(r.top, c.7, "top \(c)")
            XCTAssertEqual(r.gridTop, c.8, "gridTop \(c)")
            XCTAssertEqual(NativeWriteLayout.judgePair(width: c.0, mainHeight: nominal, gridTop: r.gridTop, k), c.9, "S \(c)")
        }
        // 页头比名义高（大字号）：组顶减去多出的部分，书写格在页面上的 y 不变
        let a = NativeWriteLayout.write(width: 402, nominalHeight: 600, promptHeight: 80, headExtra: 0, k)
        let b = NativeWriteLayout.write(width: 402, nominalHeight: 600, promptHeight: 80, headExtra: 10, k)
        XCTAssertEqual(a.gridTop, b.gridTop + 10)
    }

    func testLayoutConstantsComeFromThePage() {
        let k = NativeWriteLayoutConstants(["min": 250, "toolRowHeight": 50, "noteHeight": 30, "hintMatchMaxDist": 33])
        XCTAssertEqual(k.min, 250)
        XCTAssertEqual(k.toolsHeight, 80)
        XCTAssertEqual(k.hintMatchMaxDist, 33)
        XCTAssertEqual(k.max, 400, "missing keys keep the fallback")
    }

    // MARK: 桥上的格式（Release 工具 NativeInkWire）

    func testWireRoundTripAndColors() {
        let strokes = [[InkRawPoint(x: 1, y: 2, t: 3), InkRawPoint(x: 4, y: 5, t: 6, p: 0.5)]]
        let wire = NativeInkWire.wire(strokes)
        XCTAssertEqual(wire, [[[1, 2, 3], [4, 5, 6, 0.5]]])
        let back = NativeInkWire.rawStrokes(wire.map { $0.map { $0.map { NSNumber(value: $0) } } })
        XCTAssertEqual(back, strokes)
        XCTAssertEqual(NativeInkWire.parseColor("#C06D57"), SIMD4<Float>(Float(0xC0) / 255, Float(0x6D) / 255, Float(0x57) / 255, 1))
        XCTAssertEqual(NativeInkWire.parseColor("rgb(255, 0, 0)"), SIMD4<Float>(1, 0, 0, 1))
        XCTAssertNil(NativeInkWire.parseColor(""))
    }
}
