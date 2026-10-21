import UIKit
import XCTest
@testable import Shizi

// B2.1 原生书写面（NativeInkView / InkModel）的 XCTest（scheme ShiziWriteTests，App 作宿主）：
//   1. 金标准：笔锋模型规格的 20 条向量 + I1–I10 不变量（InkModelCheck，与 check.mjs 同口径）全部通过，且与 JS 参考实现逐值一致；
//   2. 点处理：触点采样 → 原始点（345 单位、ms、p 只在 Pencil、倾角）、时间戳夹成单调、换算书写面；
//   3. 几何：金标准向量的点经书写面（任意边长的格）走一遍，得到与直接喂给 InkModel 相同的原始点与三角形；
//   4. 输入：Pencil 与手指同时出现时的取舍、掌托、换字门限的「持住、到点补画」、判断回包前的笔、双击映射、悬停预览点尺寸。
// 不依赖页面：只用书写面本身（Metal 在模拟器上可用）。

private final class Recorder: NativeInkViewDelegate {
    var events: [String] = []
    var strokes: [[InkRawPoint]] = []
    var actions: [NativeInkPencilAction] = []
    func nativeInkDidBeginStroke(_ view: NativeInkView, at timestamp: TimeInterval) { events.append("begin") }
    func nativeInkDidEndStroke(_ view: NativeInkView, raw: [InkRawPoint]) {
        events.append("end")
        strokes.append(raw)
    }
    func nativeInkDidCancelStroke(_ view: NativeInkView, reason: String) { events.append("cancel:\(reason)") }
    func nativeInk(_ view: NativeInkView, didRequest action: NativeInkPencilAction) { actions.append(action) }
}

@MainActor
final class InkSurfaceTests: XCTestCase {
    private typealias Sample = NativeInkView.Sample

    // MARK: 工具

    private func bundled(_ name: String) throws -> Data {
        let dir = try XCTUnwrap(Bundle.main.url(forResource: "InkModel", withExtension: nil), "Debug builds copy InkModel/ into the app (sync-web-assets.sh)")
        return try Data(contentsOf: dir.appendingPathComponent(name))
    }

    private func vectors() throws -> [[String: Any]] {
        let doc = try XCTUnwrap(try JSONSerialization.jsonObject(with: bundled("vectors.json")) as? [String: Any])
        return try XCTUnwrap(doc["vectors"] as? [[String: Any]])
    }

    private func points(_ v: [String: Any]) -> [InkRawPoint] {
        ((v["points"] as? [[String: Any]]) ?? []).map { o in
            var q = InkRawPoint(x: (o["x"] as? NSNumber)?.doubleValue ?? 0, y: (o["y"] as? NSNumber)?.doubleValue ?? 0, t: (o["t"] as? NSNumber)?.doubleValue ?? 0)
            if let p = (o["p"] as? NSNumber)?.doubleValue, p > 0 { q.p = p }
            if let a = (o["alt"] as? NSNumber)?.doubleValue { q.alt = a }
            return q
        }
    }

    private func surface(side: CGFloat = 300) throws -> (NativeInkView, Recorder) {
        let renderer = try XCTUnwrap(NativeInkRenderer(), "Metal")
        let v = try XCTUnwrap(NativeInkView(frame: CGRect(x: 20, y: 100, width: side, height: side), renderer: renderer))
        let r = Recorder()
        v.delegate = r
        v.inputPolicy = NativeInkInputPolicy() // 测试不受本机「只用 Apple Pencil 绘图」设置影响
        return (v, r)
    }

    private let ids = (0..<8).map { _ in NSObject() }
    private func id(_ i: Int) -> ObjectIdentifier { ObjectIdentifier(ids[i]) }

    /// 345 单位点 → 某边长书写面上的采样（Pencil 时 force = p × 最大力）。
    private func sample(_ q: InkRawPoint, side: CGFloat, kind: NativeInkInputPolicy.Kind = .finger, radius: CGFloat = 8) -> Sample {
        let loc = CGPoint(x: q.x * Double(side) / 345, y: q.y * Double(side) / 345)
        let pencil = kind == .pencil
        return Sample(location: loc, timestamp: q.t / 1000, kind: kind, majorRadius: radius, force: pencil ? CGFloat(q.p ?? 0) * 4 : 0.5,
                      maximumPossibleForce: pencil ? 4 : 6.67, altitude: pencil ? CGFloat((q.alt ?? 90) * Double.pi / 180) : 0)
    }

    /// 一整笔走书写面（落笔 → 逐点合并点 → 抬笔）。
    private func write(_ pts: [InkRawPoint], on v: NativeInkView, side: CGFloat, kind: NativeInkInputPolicy.Kind = .finger, touch: Int = 0) {
        guard let first = pts.first, let last = pts.last else { return }
        v.inputBegan(sample(first, side: side, kind: kind), id: id(touch))
        for q in pts.dropFirst().dropLast() {
            v.inputMoved([sample(q, side: side, kind: kind)], predicted: [], last: sample(q, side: side, kind: kind), id: id(touch))
        }
        v.inputEnded([], last: sample(last, side: side, kind: kind), id: id(touch))
    }

    // MARK: 1. 金标准

    func testGoldenVectorsAndReferenceImplementation() throws {
        let report = InkModelCheck.run(vectorsData: try bundled("vectors.json"), referenceData: try bundled("reference-dump.json"))
        XCTAssertEqual(report.fail, 0, report.fails.prefix(10).joined(separator: "\n"))
        XCTAssertGreaterThanOrEqual(report.pass, 314, report.summary)
        XCTAssertEqual(report.refCompared, 40, "final + live path of every vector")
        XCTAssertEqual(report.refMismatches, [], report.summary)
        XCTAssertLessThan(report.refWorstW, 1e-6, report.summary)
        XCTAssertTrue(report.ok)
    }

    // MARK: 2. 点处理

    func testRawPointUnitsPressureAndTilt() {
        let size = CGSize(width: 300, height: 300)
        let finger = NativeInkView.rawPoint(location: CGPoint(x: 150, y: 75), size: size, timestamp: 12.5, pencil: false, force: 2, maximumPossibleForce: 6.67, altitude: 0)
        XCTAssertEqual(finger.x, 172.5, accuracy: 1e-9)
        XCTAssertEqual(finger.y, 86.25, accuracy: 1e-9)
        XCTAssertEqual(finger.t, 12_500, accuracy: 1e-9)
        XCTAssertNil(finger.p, "fingers never write p (spec §1)")
        XCTAssertNil(finger.alt)

        let pencil = NativeInkView.rawPoint(location: .zero, size: size, timestamp: 1, pencil: true, force: 1, maximumPossibleForce: 4, altitude: .pi / 3)
        XCTAssertEqual(pencil.p ?? -1, 0.25, accuracy: 1e-9)
        XCTAssertEqual(pencil.alt ?? -1, 60, accuracy: 1e-9)
        let hard = NativeInkView.rawPoint(location: .zero, size: size, timestamp: 1, pencil: true, force: 9, maximumPossibleForce: 4, altitude: .pi / 2)
        XCTAssertEqual(hard.p, 1, "p clamps to 1")
        let none = NativeInkView.rawPoint(location: .zero, size: size, timestamp: 1, pencil: true, force: 0, maximumPossibleForce: 4, altitude: .pi / 2)
        XCTAssertNil(none.p, "p ≤ 0 is not written")
    }

    func testTimestampsAreClampedMonotonic() {
        var raw: [InkRawPoint] = []
        NativeInkView.append(InkRawPoint(x: 0, y: 0, t: 100), to: &raw)
        NativeInkView.append(InkRawPoint(x: 1, y: 0, t: 90), to: &raw)
        NativeInkView.append(InkRawPoint(x: 2, y: 0, t: .nan), to: &raw)
        NativeInkView.append(InkRawPoint(x: 3, y: 0, t: 120), to: &raw)
        XCTAssertEqual(raw.map(\.t), [100, 100, 100, 120])
    }

    func testRemapKeepsScreenPosition() {
        let a = CGRect(x: 40, y: 100, width: 234, height: 234), b = CGRect(x: 20, y: 100, width: 345, height: 345)
        let q = NativeInkView.remap(InkRawPoint(x: 172.5, y: 0, t: 1, p: 0.5), from: a, to: b)
        // 屏幕位置：40 + 117 = 157 → 新格里 (157 − 20) = 137 单位（边长 345pt 时 1 单位 = 1pt）
        XCTAssertEqual(q.x, 137, accuracy: 1e-9)
        XCTAssertEqual(q.y, 0, accuracy: 1e-9)
        XCTAssertEqual(q.p, 0.5)
        XCTAssertEqual(q.t, 1)
    }

    // MARK: 3. 几何：金标准向量经书写面 = 直接喂给 InkModel

    func testGoldenVectorsThroughTheSurfaceGiveTheSameGeometry() throws {
        for side in [CGFloat(258), 345, 400] {
            for v in try vectors() {
                let pts = points(v)
                guard pts.count >= 2 else { continue }
                let pencil = pts.contains { ($0.p ?? 0) > 0 }
                let (ink, rec) = try surface(side: side)
                write(pts, on: ink, side: side, kind: pencil ? .pencil : .finger)
                let name = "\(v["id"] ?? "?") @\(side)"
                XCTAssertEqual(rec.events, ["begin", "end"], name)
                let got = try XCTUnwrap(rec.strokes.first, name)
                // 原始点：位置往返误差 < 1e-9 单位，时间 / 压力原样；抬笔点与上一点同位置且同一时刻时不再追加，
                // 同位置但更晚（抬笔前的停顿，例如 V09 单点）照样追加（B2.3：保留停顿时长）
                var expect = Array(pts.dropLast())
                if let l = expect.last, let e = pts.last, e.x != l.x || e.y != l.y || e.t > l.t { expect.append(e) }
                if expect.count == pts.count { XCTAssertEqual(expect.map(\.t), pts.map(\.t), name) }
                XCTAssertEqual(got.count, expect.count, name)
                for (g, e) in zip(got, expect) {
                    XCTAssertEqual(g.x, e.x, accuracy: 1e-9, name)
                    XCTAssertEqual(g.y, e.y, accuracy: 1e-9, name)
                    XCTAssertEqual(g.t, e.t, accuracy: 1e-6, name)
                    if let p = e.p { XCTAssertEqual(g.p ?? -1, p, accuracy: 1e-6, name) } else { XCTAssertNil(g.p, name) }
                }
                // 几何：书写面的终态三角形 = InkModel 对金标准原始点的结果
                let viaSurface = NativeInkStrokeMesh.build(raw: got, params: .default)
                let direct = NativeInkStrokeMesh.build(raw: expect, params: .default)
                XCTAssertEqual(viaSurface.vertexCount, direct.vertexCount, name)
                XCTAssertGreaterThan(direct.vertexCount, 0, name)
                let worst = zip(viaSurface.vertices, direct.vertices).map { abs($0 - $1) }.max() ?? 0
                XCTAssertLessThan(worst, 1e-3, name)
                let a1 = InkModel.unionArea(InkModel.geometry(InkModel.analyze(got)), h: 0.25)
                let a2 = InkModel.unionArea(InkModel.geometry(InkModel.analyze(expect)), h: 0.25)
                XCTAssertEqual(a1, a2, accuracy: max(1e-6, a2 * 1e-6), name)
            }
        }
    }

    // MARK: 4. 输入

    func testPencilPreemptsFingerAndFingersRestWhilePencilIsInUse() throws {
        let (ink, rec) = try surface()
        let t0 = CACurrentMediaTime()
        // 手指先写（多半是掌托）→ Pencil 落下：手指那笔取消，改写 Pencil 这笔
        XCTAssertTrue(ink.inputBegan(Sample(location: CGPoint(x: 10, y: 10), timestamp: t0, kind: .finger, majorRadius: 8), id: id(0)))
        XCTAssertTrue(ink.inputBegan(Sample(location: CGPoint(x: 100, y: 100), timestamp: t0 + 0.05, kind: .pencil, force: 1, maximumPossibleForce: 4), id: id(1)))
        XCTAssertEqual(rec.events, ["begin", "cancel:palm", "begin"])
        // Pencil 写着时第二根手指：不落墨
        XCTAssertFalse(ink.inputBegan(Sample(location: CGPoint(x: 20, y: 20), timestamp: t0 + 0.1, kind: .finger, majorRadius: 8), id: id(2)))
        ink.inputEnded([], last: Sample(location: CGPoint(x: 150, y: 120), timestamp: t0 + 0.2, kind: .pencil, force: 1, maximumPossibleForce: 4), id: id(1))
        XCTAssertEqual(rec.events.last, "end")
        // Pencil 刚抬起（1.5s 内）：手指不落墨；之后手指照常写（没开「只用 Apple Pencil 绘图」）
        XCTAssertFalse(ink.inputBegan(Sample(location: CGPoint(x: 20, y: 20), timestamp: t0 + 1.0, kind: .finger, majorRadius: 8), id: id(3)))
        XCTAssertTrue(ink.inputBegan(Sample(location: CGPoint(x: 20, y: 20), timestamp: t0 + 1.8, kind: .finger, majorRadius: 8), id: id(4)))
        XCTAssertTrue(ink.isWriting)
    }

    func testPencilOnlyDrawingKeepsFingersOffOncePencilWasUsed() {
        var p = NativeInkInputPolicy()
        p.pencilOnly = true
        XCTAssertEqual(p.begin(kind: .finger, majorRadius: 8, at: 10, active: nil), .accept, "no Pencil yet (e.g. iPhone): fingers write")
        p.notePencil(at: 11)
        XCTAssertEqual(p.begin(kind: .finger, majorRadius: 8, at: 100, active: nil), .reject("pencil-only"))
        XCTAssertEqual(p.begin(kind: .pencil, majorRadius: 0, at: 100, active: nil), .accept)
        XCTAssertEqual(p.begin(kind: .pencil, majorRadius: 0, at: 100, active: .pencil), .reject("busy"))
    }

    func testPalmIsRejectedOrCancelled() throws {
        let (ink, rec) = try surface()
        let t0 = CACurrentMediaTime()
        // 接触面积大：直接不落墨
        XCTAssertFalse(ink.inputBegan(Sample(location: CGPoint(x: 50, y: 50), timestamp: t0, kind: .finger, majorRadius: 34), id: id(0)))
        // 面积偏大且 120ms 内几乎没动：判为手掌，这一笔取消
        XCTAssertTrue(ink.inputBegan(Sample(location: CGPoint(x: 50, y: 50), timestamp: t0, kind: .finger, majorRadius: 22), id: id(1)))
        let still = Sample(location: CGPoint(x: 50.5, y: 50.5), timestamp: t0 + 0.13, kind: .finger, majorRadius: 22)
        ink.inputMoved([still], predicted: [], last: still, id: id(1))
        XCTAssertFalse(ink.isWriting)
        XCTAssertEqual(rec.events, ["begin", "cancel:palm"])
        // 同样大小但在写（动了）：照常
        XCTAssertTrue(ink.inputBegan(Sample(location: CGPoint(x: 50, y: 50), timestamp: t0 + 1, kind: .finger, majorRadius: 22), id: id(2)))
        let moving = Sample(location: CGPoint(x: 80, y: 52), timestamp: t0 + 1.13, kind: .finger, majorRadius: 22)
        ink.inputMoved([moving], predicted: [], last: moving, id: id(2))
        XCTAssertTrue(ink.isWriting)
        // 写着写着接触面积涨到手掌大小：取消
        let rolled = Sample(location: CGPoint(x: 90, y: 52), timestamp: t0 + 1.2, kind: .finger, majorRadius: 31)
        ink.inputMoved([rolled], predicted: [], last: rolled, id: id(2))
        XCTAssertFalse(ink.isWriting)
        XCTAssertEqual(rec.events.suffix(2), ["begin", "cancel:palm"])
        // 普通手指的点（不动、半径小）不是手掌
        XCTAssertFalse(NativeInkInputPolicy().isPalm(kind: .finger, maxRadius: 9, moved: 0, elapsed: 0.5))
        XCTAssertFalse(NativeInkInputPolicy().isPalm(kind: .pencil, maxRadius: 40, moved: 0, elapsed: 0.5))
    }

    func testStrokesBeforeTheArmTimeAreHeldThenDrawnNotLost() throws {
        let (ink, rec) = try surface()
        let now = CACurrentMediaTime()
        ink.acceptFrom = now + 0.25 // 换字后 250ms（P227）
        // 门限内落笔：先持住（不通知、不画），到点补开始、接着实时画
        XCTAssertTrue(ink.inputBegan(Sample(location: CGPoint(x: 30, y: 30), timestamp: now, kind: .finger, majorRadius: 8), id: id(0)))
        XCTAssertEqual(rec.events, [])
        XCTAssertTrue(ink.hasHeldInput)
        ink.releaseHeldIfDue(now + 0.1)
        XCTAssertEqual(rec.events, [])
        ink.releaseHeldIfDue(now + 0.26)
        XCTAssertEqual(rec.events, ["begin"])
        ink.inputEnded([], last: Sample(location: CGPoint(x: 120, y: 40), timestamp: now + 0.3, kind: .finger, majorRadius: 8), id: id(0))
        XCTAssertEqual(rec.events, ["begin", "end"])
        XCTAssertEqual(rec.strokes.first?.count, 2)
    }

    func testStrokeLiftedWhileWaitingForTheNextCardIsKeptAndRemapped() throws {
        let (ink, rec) = try surface(side: 234)
        let now = CACurrentMediaTime()
        ink.acceptFrom = .infinity // 判断已提交、回包未到：等下一个字
        ink.inputBegan(Sample(location: CGPoint(x: 117, y: 10), timestamp: now, kind: .finger, majorRadius: 8), id: id(0))
        ink.inputEnded([], last: Sample(location: CGPoint(x: 117, y: 60), timestamp: now + 0.05, kind: .finger, majorRadius: 8), id: id(0))
        XCTAssertEqual(rec.events, [], "held until the next card")
        XCTAssertTrue(ink.hasHeldInput)
        // 回包推进：书写格从判断页上格（234）回到书写格（345，同一顶边、同一中线）；笔按屏幕位置换算
        let old = ink.frame
        ink.frame = CGRect(x: old.midX - 172.5, y: old.minY, width: 345, height: 345)
        ink.acceptFrom = CACurrentMediaTime() - 0.001
        ink.releaseHeldIfDue(CACurrentMediaTime())
        XCTAssertEqual(rec.events, ["begin", "end"])
        let s = try XCTUnwrap(rec.strokes.first)
        XCTAssertEqual(s[0].x, 172.5, accuracy: 1e-6, "centre line stays the centre line")
        XCTAssertEqual(s[0].y, 10, accuracy: 1e-6, "same top edge, 1pt = 1 unit at 345pt")
    }

    func testHeldInputIsDroppedWhenTheJudgmentDidNotSave() throws {
        let (ink, rec) = try surface()
        ink.acceptFrom = .infinity
        ink.inputBegan(Sample(location: CGPoint(x: 30, y: 30), timestamp: CACurrentMediaTime(), kind: .finger, majorRadius: 8), id: id(0))
        ink.dropHeld()
        ink.acceptFrom = 0
        ink.releaseHeldIfDue(CACurrentMediaTime())
        XCTAssertFalse(ink.isWriting)
        XCTAssertFalse(ink.hasHeldInput)
        XCTAssertEqual(rec.events, [], "the page never heard of that stroke")
    }

    func testNotDrawableDropsEverything() throws {
        let (ink, rec) = try surface()
        ink.inputBegan(Sample(location: CGPoint(x: 30, y: 30), timestamp: CACurrentMediaTime(), kind: .finger, majorRadius: 8), id: id(0))
        ink.drawable = false
        XCTAssertFalse(ink.isWriting)
        XCTAssertEqual(rec.events, ["begin", "cancel:reset"])
        XCTAssertFalse(ink.inputBegan(Sample(location: CGPoint(x: 30, y: 30), timestamp: CACurrentMediaTime(), kind: .finger, majorRadius: 8), id: id(1)))
    }

    func testPencilDoubleTapFollowsTheSystemPreference() {
        XCTAssertEqual(NativeInkPencilAction.forTap(.switchEraser), .clear)
        XCTAssertEqual(NativeInkPencilAction.forTap(.switchPrevious), .undo)
        XCTAssertNil(NativeInkPencilAction.forTap(.ignore))
        XCTAssertNil(NativeInkPencilAction.forTap(.showColorPalette))
    }

    func testHoverDotSize() {
        // 规格 §2.1：直径 = 0.9 × B × F_p(0.35)；B = 13，F_p(0.35) = 0.42 + √0.35 × 0.92
        let expected = 0.9 * 13 * (0.42 + 0.35.squareRoot() * 0.92)
        XCTAssertEqual(NativeInkStrokeMesh.hoverDotDiameter(.default), expected, accuracy: 1e-9)
        let disc = NativeInkStrokeMesh.disc(x: 100, y: 100, radius: 5, segments: 32)
        XCTAssertEqual(disc.count, 32 * 6)
        let far = stride(from: 0, to: disc.count, by: 2).map { hypot(Double(disc[$0]) - 100, Double(disc[$0 + 1]) - 100) }.max() ?? 0
        XCTAssertEqual(far, 5, accuracy: 1e-4)
    }

    // MARK: B2.3 存下的墨迹（Ink v4 原始点）回放

    /// 夹具 ink-v4-fixture.json（gen-ink-v4-fixture.mjs 由 JS 生成，node test/core/ink-v4.test.mjs 核它与代码同步）：
    /// Swift 解出的原始点 = JS decodeInkRaw；InkModel 对它的几何 = 参考实现（reference.mjs）——原生回放与 JS 逐值一致。
    func testStoredInkV4DecodesLikeJSAndReplaysLikeTheReference() throws {
        let doc = try XCTUnwrap(try JSONSerialization.jsonObject(with: bundled("ink-v4-fixture.json")) as? [String: Any])
        let cases = try XCTUnwrap(doc["cases"] as? [[String: Any]])
        XCTAssertGreaterThanOrEqual(cases.count, 21)
        var worstArea = 0.0
        for c in cases {
            let id = c["id"] as? String ?? "?"
            let ink = try XCTUnwrap(c["ink"] as? [String: Any], id)
            let packed = try XCTUnwrap(ink["r"] as? [String], id)
            let rows = try XCTUnwrap(c["rows"] as? [[NSNumber]], id)
            XCTAssertEqual(packed.map { InkStoredInk.rawRow(packed: $0) ?? [] }, rows.map { $0.map(\.intValue) }, "\(id) rows")
            let got = try XCTUnwrap(InkStoredInk.decode(ink), id)
            let want = try XCTUnwrap(c["raw"] as? [[[NSNumber]]], id)
            XCTAssertEqual(got.count, want.count, id)
            for (s, (g, w)) in zip(got, want).enumerated() {
                XCTAssertEqual(g.count, w.count, "\(id) stroke \(s)")
                for (q, e) in zip(g, w) {
                    XCTAssertEqual(q.x, e[0].doubleValue, accuracy: 1e-9, id)
                    XCTAssertEqual(q.y, e[1].doubleValue, accuracy: 1e-9, id)
                    XCTAssertEqual(q.t, e[2].doubleValue, id)
                    if e.count > 3 { XCTAssertEqual(q.p ?? -1, e[3].doubleValue, accuracy: 1e-9, id) } else { XCTAssertNil(q.p, id) }
                }
            }
            let refs = try XCTUnwrap(c["ref"] as? [[String: Any]], id)
            for (s, (pts, ref)) in zip(got, refs).enumerated() {
                let pr = InkModel.analyze(pts)
                let area = InkModel.unionArea(InkModel.geometry(pr), h: 0.1)
                let wantArea = (ref["area"] as? NSNumber)?.doubleValue ?? 0
                let rel = wantArea > 0 ? abs(area - wantArea) / wantArea : abs(area)
                worstArea = max(worstArea, rel)
                XCTAssertLessThanOrEqual(rel, 1e-6, "\(id) stroke \(s) area \(area) vs reference \(wantArea)")
                XCTAssertEqual(pr.len, (ref["len"] as? NSNumber)?.doubleValue ?? -1, accuracy: 1e-6, "\(id) stroke \(s) len")
                XCTAssertEqual(pr.samples.count, (ref["n"] as? NSNumber)?.intValue, "\(id) stroke \(s) samples")
                XCTAssertEqual(pr.capEnd, ref["capEnd"] as? String, "\(id) stroke \(s) end cap")
                XCTAssertEqual(pr.blooms.count, (ref["blooms"] as? NSNumber)?.intValue, "\(id) stroke \(s) blooms")
            }
        }
        print(String(format: "[shizi] ink v4 replay: %d cases, worst area vs reference %.2e", cases.count, worstArea))
        // 坏的墨迹：解不开就是没有（调用方按「没有笔迹」画）
        XCTAssertNil(InkStoredInk.decode(["v": 4, "c": 345, "r": ["AAA="], "g": [0]]))
        XCTAssertNil(InkStoredInk.decode(["v": 3, "c": 345, "s": ["AAAA"]]))
        XCTAssertNil(InkStoredInk.decode(json: "{"))
    }

    /// B2.3 决定：抬笔前的停顿时长保留——同位置、更晚的抬笔点照样进原始点（存进 Ink v4，原生回放的停顿洇墨 / 慢收靠它）。
    func testPauseBeforeLiftKeepsItsTime() throws {
        let (ink, rec) = try surface(side: 345)
        let pts = [InkRawPoint(x: 40, y: 100, t: 1000), InkRawPoint(x: 120, y: 100, t: 1080), InkRawPoint(x: 200, y: 100, t: 1160)]
        ink.inputBegan(sample(pts[0], side: 345), id: id(0))
        ink.inputMoved([sample(pts[1], side: 345)], predicted: [], last: sample(pts[1], side: 345), id: id(0))
        ink.inputMoved([sample(pts[2], side: 345)], predicted: [], last: sample(pts[2], side: 345), id: id(0))
        // 停 300ms 再抬笔，位置不变
        ink.inputEnded([], last: sample(InkRawPoint(x: 200, y: 100, t: 1460), side: 345), id: id(0))
        let got = try XCTUnwrap(rec.strokes.first)
        XCTAssertEqual(got.map(\.t), [1000, 1080, 1160, 1460], "lift sample kept with its time")
        XCTAssertEqual(InkModel.analyze(got).v30 ?? -1, 0, accuracy: 1e-9, "lift speed sees the pause (slow lift)")
        XCTAssertGreaterThan(InkModel.analyze(got).blooms.count, InkModel.analyze(Array(got.dropLast())).blooms.count, "pause bloom at the end (spec §5.3)")
    }

    func testReleaseBuildCarriesTheSurfaceUnderAStableName() {
        XCTAssertEqual(NSStringFromClass(NativeInkView.self), "ShiziNativeInkView", "verify-archive.sh looks for this name in Release")
    }
}
