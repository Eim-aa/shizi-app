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
                // 几何：书写面的终态三角形 = 直接对金标准原始点的结果（产品画法 WebInk，R11-A；InkModel 的面积另核，ink-model-1.0 仍是 T2 候选）
                let k = try WebInkFixture.params()
                let viaSurface = NativeInkStrokeMesh.build(raw: got, params: k)
                let direct = NativeInkStrokeMesh.build(raw: expect, params: k)
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

    func testThumbWithoutPencilIsNeverPalm() throws {
        // D71 ②：没用过 Pencil（iPhone）时，大接触半径的手指（大拇指）照常写，不判手掌
        let (ink, rec) = try surface()
        let t0 = CACurrentMediaTime()
        XCTAssertTrue(ink.inputBegan(Sample(location: CGPoint(x: 50, y: 50), timestamp: t0, kind: .finger, majorRadius: 38), id: id(0)))
        let still = Sample(location: CGPoint(x: 50.5, y: 50.5), timestamp: t0 + 0.13, kind: .finger, majorRadius: 42)
        ink.inputMoved([still], predicted: [], last: still, id: id(0))
        XCTAssertTrue(ink.isWriting)
        let moving = Sample(location: CGPoint(x: 90, y: 52), timestamp: t0 + 0.2, kind: .finger, majorRadius: 45)
        ink.inputMoved([moving], predicted: [], last: moving, id: id(0))
        XCTAssertTrue(ink.isWriting)
        XCTAssertFalse(rec.events.contains("cancel:palm"))
        XCTAssertFalse(NativeInkInputPolicy().isPalm(kind: .finger, maxRadius: 45, moved: 0, elapsed: 0.5))
        XCTAssertEqual(NativeInkInputPolicy().begin(kind: .finger, majorRadius: 45, at: 100, active: nil), .accept)
    }

    func testPalmIsRejectedOrCancelled() throws {
        let (ink, rec) = try surface()
        let t0 = CACurrentMediaTime()
        // 手掌规则只在用过 Pencil 之后生效（D71 ②）；Pencil 接触早于 pencilGrace，手指可写
        ink.inputPolicy.notePencil(at: t0 - 10)
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
        var seen = NativeInkInputPolicy()
        seen.notePencil(at: 0)
        XCTAssertFalse(seen.isPalm(kind: .finger, maxRadius: 9, moved: 0, elapsed: 0.5))
        XCTAssertFalse(seen.isPalm(kind: .pencil, maxRadius: 40, moved: 0, elapsed: 0.5))
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

    /// R12：页面离开时，门限内已抬笔、持住的笔不等门限立刻整笔交出（不丢）；还在写的一笔不算写完、不交。
    func testFlushHeldDeliversLiftedHeldStrokesNow() throws {
        let (ink, rec) = try surface()
        let now = CACurrentMediaTime()
        ink.acceptFrom = now + 0.25
        ink.inputBegan(Sample(location: CGPoint(x: 30, y: 30), timestamp: now, kind: .finger, majorRadius: 8), id: id(0))
        ink.inputEnded([], last: Sample(location: CGPoint(x: 120, y: 40), timestamp: now + 0.05, kind: .finger, majorRadius: 8), id: id(0))
        ink.inputBegan(Sample(location: CGPoint(x: 30, y: 90), timestamp: now + 0.1, kind: .finger, majorRadius: 8), id: id(1)) // 第二笔还没抬
        XCTAssertEqual(rec.events, [])
        XCTAssertEqual(ink.flushHeld(), 1)
        XCTAssertEqual(rec.events, ["begin", "end"], "the lifted stroke is handed over without waiting for the arm time")
        XCTAssertEqual(rec.strokes.first?.count, 2)
        XCTAssertTrue(ink.isWriting, "the stroke still being written is not finished, not flushed")
        XCTAssertEqual(ink.flushHeld(), 0, "nothing twice")
        ink.releaseHeldIfDue(now + 1)
        XCTAssertEqual(rec.events, ["begin", "end", "begin"], "no duplicate end when the arm time comes")
    }

    /// R12：门限 .infinity（提交中，持住的笔属于下一个字）——离开时不交给当前字（D07）。
    func testFlushHeldKeepsStrokesWaitingForTheNextCard() throws {
        let (ink, rec) = try surface()
        let now = CACurrentMediaTime()
        ink.acceptFrom = .infinity
        ink.inputBegan(Sample(location: CGPoint(x: 30, y: 30), timestamp: now, kind: .finger, majorRadius: 8), id: id(0))
        ink.inputEnded([], last: Sample(location: CGPoint(x: 120, y: 40), timestamp: now + 0.05, kind: .finger, majorRadius: 8), id: id(0))
        XCTAssertEqual(ink.flushHeld(), 0)
        XCTAssertEqual(rec.events, [])
        XCTAssertTrue(ink.hasHeldInput)
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

    func testHoverDotSize() throws {
        // R11-A：直径 = 网页单点口径 single × base × 压力因子(0.35)（参数随 open 下发，同 policy.ink）
        let k = try WebInkFixture.params()
        let expected = k.single * k.base * min(k.pressureHi, max(k.pressureLo, k.pressureLo + 0.35.squareRoot() * k.pressureGain))
        XCTAssertEqual(NativeInkStrokeMesh.hoverDotDiameter(k), expected, accuracy: 1e-9)
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

// R10-A（D71 ②）：书写格里起手的触摸归书写，左缘返回只在格外（页边）生效。
// 根因：UIScreenEdgePanGestureRecognizer 的起手区（UIKit _UISEGestureFeatureSettings._edgeRegionSize = 40.2pt，真机按手指接触半径还会放宽）
// 伸进书写格（x = 21 起）左侧约 20pt：那里起笔向右写，识别器开始 → 这一笔被取消、交互式返回回弹 → 「写完的笔画突然消失」。
@MainActor
final class EdgeBackVsInkTests: XCTestCase {
    /// iPhone 13 / 17（宽 390）：书写格 x = 20、格线 1 → 书写面从 21 起。
    private func inkFrame(width: CGFloat) -> CGRect {
        let k = NativeWriteLayoutConstants()
        let g = min(k.max, NativeWriteLayout.contentWidth(width, k))
        return CGRect(x: (width - g) / 2, y: 225, width: g, height: g).insetBy(dx: 1, dy: 1)
    }

    func testGridTouchesNeverGoToTheEdgeBackRecognizer() {
        for width in [CGFloat(375), 390, 393, 430] {
            let f = inkFrame(width: width)
            XCTAssertLessThan(f.minX, 40.2, "the system edge region reaches into the grid at width \(width) (why this rule exists)")
            for x in stride(from: f.minX, through: f.maxX - 0.5, by: 0.5) {
                for y in [f.minY, f.midY, f.maxY - 0.5] {
                    XCTAssertFalse(NativeWriteViewController.edgeBackReceives(touchAt: CGPoint(x: x, y: y), inkFrame: f, inkDrawable: true),
                                   "touch at (\(x), \(y)) inside the grid belongs to writing (width \(width))")
                }
            }
        }
    }

    func testEdgeBackStillWorksFromTheMarginAndWhenTheGridCannotBeWritten() {
        let f = inkFrame(width: 390)
        for x in stride(from: CGFloat(0), to: f.minX, by: 0.5) {
            XCTAssertTrue(NativeWriteViewController.edgeBackReceives(touchAt: CGPoint(x: x, y: f.midY), inkFrame: f, inkDrawable: true), "margin x=\(x)")
        }
        XCTAssertTrue(NativeWriteViewController.edgeBackReceives(touchAt: CGPoint(x: 10, y: f.minY - 30), inkFrame: f, inkDrawable: true), "above the grid")
        XCTAssertTrue(NativeWriteViewController.edgeBackReceives(touchAt: CGPoint(x: 25, y: f.maxY + 30), inkFrame: f, inkDrawable: true), "below the grid")
        // 判断页（书写面不可写）：上格不收笔，左缘照常
        XCTAssertTrue(NativeWriteViewController.edgeBackReceives(touchAt: CGPoint(x: 25, y: f.midY), inkFrame: f, inkDrawable: false))
    }
}

// D72 ②（取代 D71 ① 的 ink-model-1.0 参数）：书写面的墨与网页同一算法，见 WebInkTests.swift。

// R11-B（D72 ③）：格外（页面空白处）起手、滑进书写格——在进入点（轨迹与格边的交点，时间插值）开始这一笔，格外那段不画；
// 起手在按钮上 / 左缘返回起手区里的不当格外起笔；进入点照常走落笔规则（一次一笔、Pencil 优先、手掌、换字持住）。
@MainActor
final class EnterFromOutsideTests: XCTestCase {
    private typealias Sample = NativeInkView.Sample
    private let ids = (0..<4).map { _ in NSObject() }
    private func id(_ i: Int) -> ObjectIdentifier { ObjectIdentifier(ids[i]) }
    private let yes: (CGPoint) -> Bool = { _ in true }

    private func surface() throws -> (NativeInkView, Recorder) {
        let renderer = try XCTUnwrap(NativeInkRenderer(), "Metal")
        let v = try XCTUnwrap(NativeInkView(frame: CGRect(x: 21, y: 200, width: 345, height: 345), renderer: renderer))
        let r = Recorder()
        v.delegate = r
        v.inputPolicy = NativeInkInputPolicy()
        return (v, r)
    }

    private func s(_ x: CGFloat, _ y: CGFloat, _ t: TimeInterval, kind: NativeInkInputPolicy.Kind = .finger, r: CGFloat = 8) -> Sample {
        Sample(location: CGPoint(x: x, y: y), timestamp: t, kind: kind, majorRadius: r)
    }

    private func pen(_ x: CGFloat, _ y: CGFloat, _ t: TimeInterval) -> Sample {
        Sample(location: CGPoint(x: x, y: y), timestamp: t, kind: .pencil, force: 1, maximumPossibleForce: 4)
    }

    // MARK: 进入点插值（纯函数）

    func testEntryPointOnEachEdgeWithInterpolatedTime() throws {
        let rect = CGRect(x: 0, y: 0, width: 345, height: 345)
        // 从上方：(100, -20) → (120, 20)，过 y = 0 在一半处
        var e = try XCTUnwrap(NativeInkView.entryPoint(from: s(100, -20, 1.0), to: s(120, 20, 1.02), in: rect))
        XCTAssertEqual(e.location.y, 0)
        XCTAssertEqual(e.location.x, 110, accuracy: 1e-9)
        XCTAssertEqual(e.timestamp, 1.01, accuracy: 1e-12)
        // 从右侧：(360, 50) → (340, 60)，过 x = 345 在 3/4 处
        e = try XCTUnwrap(NativeInkView.entryPoint(from: s(360, 50, 2.0), to: s(340, 60, 2.04), in: rect))
        XCTAssertEqual(e.location.x, 345)
        XCTAssertEqual(e.location.y, 57.5, accuracy: 1e-9)
        XCTAssertEqual(e.timestamp, 2.03, accuracy: 1e-12)
        // 从下方：(200, 400) → (200, 300)，过 y = 345 在 55% 处
        e = try XCTUnwrap(NativeInkView.entryPoint(from: s(200, 400, 3.0), to: s(200, 300, 3.1), in: rect))
        XCTAssertEqual(e.location.y, 345)
        XCTAssertEqual(e.location.x, 200)
        XCTAssertEqual(e.timestamp, 3.055, accuracy: 1e-12)
        // 从左侧
        e = try XCTUnwrap(NativeInkView.entryPoint(from: s(-10, 100, 4.0), to: s(30, 100, 4.04), in: rect))
        XCTAssertEqual(e.location.x, 0)
        XCTAssertEqual(e.timestamp, 4.01, accuracy: 1e-12)
    }

    func testEntryPointThroughACornerTakesTheLaterEdge() throws {
        let rect = CGRect(x: 0, y: 0, width: 345, height: 345)
        // (-10, -40) → (10, 20)：先过 x = 0（u = 0.5，那时 y = -10 仍在格外），再过 y = 0（u = 2/3）——进入点在上边
        let e = try XCTUnwrap(NativeInkView.entryPoint(from: s(-10, -40, 0), to: s(10, 20, 0.06), in: rect))
        XCTAssertEqual(e.location.y, 0)
        XCTAssertEqual(e.location.x, -10 + 20.0 * 2 / 3, accuracy: 1e-9)
        XCTAssertEqual(e.timestamp, 0.04, accuracy: 1e-12)
        XCTAssertGreaterThanOrEqual(e.location.x, 0, "entry lies on the grid edge")
    }

    func testEntryPointInterpolatesPencilFields() throws {
        let rect = CGRect(x: 0, y: 0, width: 345, height: 345)
        let a = Sample(location: CGPoint(x: 100, y: -10), timestamp: 0, kind: .pencil, force: 1, maximumPossibleForce: 4, altitude: 1.0)
        let b = Sample(location: CGPoint(x: 100, y: 10), timestamp: 0.02, kind: .pencil, force: 3, maximumPossibleForce: 4, altitude: 1.2)
        let e = try XCTUnwrap(NativeInkView.entryPoint(from: a, to: b, in: rect))
        XCTAssertEqual(e.kind, .pencil)
        XCTAssertEqual(e.force, 2, accuracy: 1e-9)
        XCTAssertEqual(e.altitude, 1.1, accuracy: 1e-9)
        XCTAssertEqual(e.timestamp, 0.01, accuracy: 1e-12)
    }

    func testNoEntryUnlessOutsideToInside() {
        let rect = CGRect(x: 0, y: 0, width: 345, height: 345)
        XCTAssertNil(NativeInkView.entryPoint(from: s(10, 10, 0), to: s(20, 20, 0.01), in: rect), "inside → inside")
        XCTAssertNil(NativeInkView.entryPoint(from: s(-10, 10, 0), to: s(-5, 20, 0.01), in: rect), "outside → outside")
        XCTAssertNil(NativeInkView.entryPoint(from: s(10, 10, 0), to: s(-5, 20, 0.01), in: rect), "inside → outside")
    }

    // MARK: 书写面上走一遍

    func testSlidingInStartsTheStrokeAtTheEdgeAndDropsTheOutsidePart() throws {
        let (ink, rec) = try surface()
        // 书写面坐标：格上方 30pt 起手，往下滑进格
        ink.approachBegan(s(150, -30, 10.00), id: id(0))
        ink.approachMoved([s(150, -15, 10.01)], predicted: [], last: s(150, -15, 10.01), id: id(0), enters: yes)
        XCTAssertFalse(ink.isWriting, "outside part is not ink")
        ink.approachMoved([s(150, 5, 10.02), s(152, 25, 10.03)], predicted: [], last: s(152, 25, 10.03), id: id(0), enters: yes)
        XCTAssertTrue(ink.isWriting)
        XCTAssertEqual(rec.events, ["begin"])
        ink.inputEnded([], last: s(155, 80, 10.06), id: id(0))
        let st = try XCTUnwrap(rec.strokes.first)
        XCTAssertEqual(st[0].y, 0, accuracy: 1e-9, "starts on the top edge")
        XCTAssertEqual(st[0].x, 150, accuracy: 1e-9)
        XCTAssertEqual(st[0].t, 10_017.5, accuracy: 1e-6, "time interpolated between the two samples")
        XCTAssertEqual(st.count, 4, "entry + two inside samples + lift")
        XCTAssertTrue(st.allSatisfy { $0.y >= 0 }, "nothing from outside the grid")
    }

    func testEnteringOnTheLastEventStillCounts() throws {
        let (ink, rec) = try surface()
        ink.approachBegan(s(400, 100, 1.0), id: id(0))
        ink.approachMoved([s(360, 100, 1.01)], predicted: [], last: s(360, 100, 1.01), id: id(0), enters: yes)
        ink.approachMoved([s(330, 100, 1.02)], predicted: [], last: s(330, 100, 1.02), id: id(0), enters: yes)
        ink.inputEnded([], last: s(300, 100, 1.03), id: id(0))
        XCTAssertEqual(rec.events, ["begin", "end"])
        XCTAssertEqual(try XCTUnwrap(rec.strokes.first?.first).x, 345, accuracy: 1e-9, "right edge")
    }

    func testCoveredOrNotDrawableGridDoesNotStart() throws {
        let (ink, rec) = try surface()
        ink.approachBegan(s(150, -30, 1.0), id: id(0))
        ink.approachMoved([s(150, 10, 1.02)], predicted: [], last: s(150, 10, 1.02), id: id(0), enters: { _ in false }) // 弹层盖着
        XCTAssertFalse(ink.isWriting)
        ink.drawable = false // 判断页
        ink.approachBegan(s(150, -30, 2.0), id: id(1))
        ink.approachMoved([s(150, 10, 2.02)], predicted: [], last: s(150, 10, 2.02), id: id(1), enters: yes)
        XCTAssertFalse(ink.isWriting)
        XCTAssertEqual(rec.events, [])
    }

    func testOneStrokeAtATimeAndPencilFirstApplyAtTheEntry() throws {
        let (ink, rec) = try surface()
        // 格内已在写一笔手指：另一根手指从格外滑进来不开第二笔
        XCTAssertTrue(ink.inputBegan(s(100, 100, 5.0), id: id(0)))
        ink.approachBegan(s(150, -30, 5.0), id: id(1))
        ink.approachMoved([s(150, 10, 5.02)], predicted: [], last: s(150, 10, 5.02), id: id(1), enters: yes)
        XCTAssertEqual(rec.events, ["begin"], "busy: one stroke at a time")
        // Pencil 从格外滑进来：取消手指那笔（掌托 / 握笔的手指），改写 Pencil
        ink.approachBegan(pen(200, -20, 5.03), id: id(2))
        ink.approachMoved([pen(200, 20, 5.05)], predicted: [], last: pen(200, 20, 5.05), id: id(2), enters: yes)
        XCTAssertEqual(rec.events, ["begin", "cancel:palm", "begin"])
        // Pencil 刚用过：手指从格外滑进来不落墨
        ink.inputEnded([], last: pen(200, 60, 5.08), id: id(2))
        ink.approachBegan(s(150, -30, 5.2), id: id(3))
        ink.approachMoved([s(150, 10, 5.22)], predicted: [], last: s(150, 10, 5.22), id: id(3), enters: yes)
        XCTAssertFalse(ink.isWriting, "pencil-recent")
    }

    func testPalmAfterPencilIsRejectedAtTheEntry() throws {
        let (ink, rec) = try surface()
        ink.inputPolicy.notePencil(at: 0)
        ink.approachBegan(s(150, -30, 10.0, r: 34), id: id(0))
        ink.approachMoved([s(150, 10, 10.02, r: 34)], predicted: [], last: s(150, 10, 10.02, r: 34), id: id(0), enters: yes)
        XCTAssertFalse(ink.isWriting)
        XCTAssertEqual(rec.events, [])
    }

    func testEntryBeforeTheArmTimeIsHeldThenDrawn() throws {
        let (ink, rec) = try surface()
        let now = CACurrentMediaTime()
        ink.acceptFrom = now + 0.25 // 换字后 250ms（P227）
        ink.approachBegan(s(150, -30, now), id: id(0))
        ink.approachMoved([s(150, 10, now + 0.02)], predicted: [], last: s(150, 10, now + 0.02), id: id(0), enters: yes)
        XCTAssertTrue(ink.isWriting)
        XCTAssertTrue(ink.hasHeldInput, "held like any stroke begun inside the 250ms window")
        XCTAssertEqual(rec.events, [])
        ink.releaseHeldIfDue(now + 0.3)
        XCTAssertEqual(rec.events, ["begin"])
    }

    // MARK: 写字页：哪些起手可以当格外起笔

    func testPageStartsOnlyFromBlankSpaceOutsideTheEdgeZone() {
        let root = UIView(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        let ink = CGRect(x: 21, y: 200, width: 348, height: 348)
        let panel = UIView(frame: CGRect(x: 0, y: 560, width: 390, height: 60))
        root.addSubview(panel)
        let button = UIButton(type: .system)
        button.frame = CGRect(x: 20, y: 0, width: 80, height: 44)
        panel.addSubview(button)
        let label = UILabel()
        button.addSubview(label)
        XCTAssertTrue(NativeWritePageView.approachStarts(at: CGPoint(x: 200, y: 150), hitView: root, root: root, inkFrame: ink), "blank above")
        XCTAssertTrue(NativeWritePageView.approachStarts(at: CGPoint(x: 200, y: 580), hitView: panel, root: root, inkFrame: ink), "blank part of a panel")
        XCTAssertFalse(NativeWritePageView.approachStarts(at: CGPoint(x: 60, y: 580), hitView: button, root: root, inkFrame: ink), "on a button")
        XCTAssertFalse(NativeWritePageView.approachStarts(at: CGPoint(x: 60, y: 580), hitView: label, root: root, inkFrame: ink), "inside a button")
        XCTAssertFalse(NativeWritePageView.approachStarts(at: CGPoint(x: 10, y: 150), hitView: root, root: root, inkFrame: ink), "left edge back zone")
        XCTAssertFalse(NativeWritePageView.approachStarts(at: CGPoint(x: 40, y: 150), hitView: root, root: root, inkFrame: ink), "still inside the 40.2pt zone")
        XCTAssertFalse(NativeWritePageView.approachStarts(at: CGPoint(x: 200, y: 300), hitView: root, root: root, inkFrame: ink), "inside the grid belongs to the grid")
    }
}
