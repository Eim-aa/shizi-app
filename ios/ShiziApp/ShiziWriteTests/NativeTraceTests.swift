import UIKit
import XCTest
@testable import Shizi

// B2.4 / B2.6 原生写字页的纯逻辑（scheme ShiziWriteTests）：描一遍的快放节奏与描红分层、跳过撤销条的寿命计时、结束这组确认框的视图。
// 期望值由 node 跑 src/ui/canvas/glyph.js playbackPlan 与 src/ui/screens/write/answer.js traceSplit / skip.js createUndoLifetime 得出，逐值对照。

final class NativeTraceTests: XCTestCase {
    // MARK: 笔顺快放（glyph.js playbackPlan）

    private func medians(_ n: Int, _ len: Double) -> [[CGPoint]] {
        (0..<n).map { i in [CGPoint(x: 0, y: 0), CGPoint(x: len + Double(i) * 10, y: 0)] }
    }

    func testPlaybackPlanMatchesTheWebFormulas() {
        // node：playbackPlan({medians: n 笔，笔 i 的中线长 len + 10i}, {maxMs: 1600}) 与不限时（缺省 speed 1.6 / 间隔 180 / 淡化 220）
        let cases: [(Int, Double, NativeTrace.Plan, NativeTrace.Plan)] = [
            (1, 300, .init(speed: 1.6, delay: 0, fade: 100, estimatedMs: 288), .init(speed: 1.6, delay: 180, fade: 220, estimatedMs: 408)),
            (4, 400, .init(speed: 1.6, delay: 80, fade: 100, estimatedMs: 1186), .init(speed: 1.6, delay: 180, fade: 220, estimatedMs: 1606)),
            (8, 500, .init(speed: 2.665, delay: 34, fade: 100, estimatedMs: 1474), .init(speed: 1.6, delay: 180, fade: 220, estimatedMs: 3372)),
            (16, 700, .init(speed: 6.467, delay: 16, fade: 100, estimatedMs: 1474), .init(speed: 1.6, delay: 180, fade: 220, estimatedMs: 7503)),
            (30, 900, .init(speed: 14.415, delay: 8, fade: 100, estimatedMs: 1473), .init(speed: 1.6, delay: 180, fade: 220, estimatedMs: 15721)),
        ]
        for (n, len, capped, free) in cases {
            let m = medians(n, len)
            XCTAssertEqual(NativeTrace.plan(medians: m, strokeCount: n, maxMs: 1600, speed: 1.6, delay: 180, fade: 220), capped, "\(n) strokes, max 1600")
            XCTAssertEqual(NativeTrace.plan(medians: m, strokeCount: n, maxMs: 0, speed: 1.6, delay: 180, fade: 220), free, "\(n) strokes, uncapped")
            XCTAssertLessThanOrEqual(capped.estimatedMs, 1600, "the first look at a char never takes longer than 1.6s (D68 ②)")
        }
        // 没有中线数据：按笔数估一个平均长度
        XCTAssertEqual(NativeTrace.plan(medians: [], strokeCount: 3, maxMs: 1600, speed: 1.6, delay: 180, fade: 220), .init(speed: 1.6, delay: 120, fade: 100, estimatedMs: 902))
    }

    func testStrokeDurationsAddUpToThePlan() {
        let m = medians(8, 500)
        let plan = NativeTrace.plan(medians: m, strokeCount: 8, maxMs: 1600, speed: 1.6, delay: 180, fade: 220)
        let durs = NativeTrace.strokeDurations(medians: m, strokeCount: 8, speed: plan.speed)
        let total = durs.reduce(0, +) + plan.delay * 7 + plan.fade
        XCTAssertEqual(total, plan.estimatedMs, accuracy: 1.0, "animation timeline = the plan's estimate")
        XCTAssertLessThanOrEqual(total, 1600.5)
    }

    // MARK: 描红分层（answer.js traceSplit）

    func testTraceSplitFollowsTheWeb() {
        // node：traceSplit(5, 0) → solid [0] hook [1,2,3,4]；(5, 2) → [2] / [3,4]；(5, 4) → [4] / []；(5, 5) 与 (5, 9) → 空；(0, 0) → 空
        var r = NativeTrace.split(total: 5, written: 0)
        XCTAssertEqual(r.solid, [0]); XCTAssertEqual(r.hook, [1, 2, 3, 4])
        r = NativeTrace.split(total: 5, written: 2)
        XCTAssertEqual(r.solid, [2]); XCTAssertEqual(r.hook, [3, 4])
        r = NativeTrace.split(total: 5, written: 4)
        XCTAssertEqual(r.solid, [4]); XCTAssertEqual(r.hook, [])
        for w in [5, 9] {
            r = NativeTrace.split(total: 5, written: w)
            XCTAssertEqual(r.solid, []); XCTAssertEqual(r.hook, [])
        }
        r = NativeTrace.split(total: 0, written: 0)
        XCTAssertEqual(r.solid, []); XCTAssertEqual(r.hook, [])
    }

    func testTraceLayerDrawsCurrentStrokeSolidAndTheRestAsHooks() throws {
        let layer = NativeTraceLayerView(frame: CGRect(x: 0, y: 0, width: 300, height: 300))
        let glyph = try XCTUnwrap(Self.squareGlyph(strokes: 4))
        layer.setGlyph(glyph, char: "x")
        layer.render(visible: true)
        XCTAssertEqual(layer.solidStrokes, [0])
        XCTAssertEqual(layer.hookStrokes, [1, 2, 3])
        layer.setWritten(2) // 写了两笔：当前一笔是第 3 笔，已描过的被本人墨盖住不画
        XCTAssertEqual(layer.solidStrokes, [2])
        XCTAssertEqual(layer.hookStrokes, [3])
        layer.setWritten(1) // 撤销一笔：退回
        XCTAssertEqual(layer.solidStrokes, [1])
        XCTAssertEqual(layer.hookStrokes, [2, 3])
        layer.setWritten(4)
        XCTAssertEqual(layer.solidStrokes, [])
        XCTAssertEqual(layer.hookStrokes, [])
        layer.render(visible: false)
        layer.setWritten(0)
        XCTAssertEqual(layer.solidStrokes, [], "回忆阶段 / 凭记忆写不画描红")
        // 没有笔顺数据：浅色整字（10.13），不分笔顺
        let none = NativeTraceLayerView(frame: CGRect(x: 0, y: 0, width: 300, height: 300))
        none.setGlyph(nil, char: "永")
        none.render(visible: true)
        XCTAssertTrue(none.showsFallbackChar)
        XCTAssertEqual(none.solidStrokes, [])
    }

    func testStepPlayStartsOnceAndALandingSkipsIt() throws {
        let layer = NativeTraceLayerView(frame: CGRect(x: 0, y: 0, width: 300, height: 300))
        layer.layoutIfNeeded()
        let glyph = try XCTUnwrap(Self.squareGlyph(strokes: 3))
        layer.setGlyph(glyph, char: "x")
        layer.render(visible: true)
        let plan = NativeTrace.plan(medians: glyph.medians, strokeCount: 3, maxMs: 1600, speed: 1.6, delay: 180, fade: 220)
        var done = false
        XCTAssertTrue(layer.play(plan: plan) { done = true })
        XCTAssertTrue(layer.playing)
        XCTAssertFalse(layer.play(plan: plan), "already playing")
        layer.skipPlay() // 落笔：一帧到终态
        XCTAssertFalse(layer.playing)
        XCTAssertTrue(done)
        XCTAssertEqual(layer.solidStrokes, [0], "the tracing layer underneath is what remains")
    }

    static func squareGlyph(strokes n: Int) -> NativeGlyphData? {
        let paths = (0..<n).map { i -> CGPath in
            let p = CGMutablePath()
            p.addRect(CGRect(x: 100 + CGFloat(i) * 60, y: 100, width: 40, height: 600))
            return p
        }
        let medians = (0..<n).map { i in [CGPoint(x: 120 + CGFloat(i) * 60, y: 100), CGPoint(x: 120 + CGFloat(i) * 60, y: 700)] }
        return NativeGlyphData(strokes: paths, medians: medians)
    }

    // MARK: 撤销条的寿命（skip.js createUndoLifetime；假时钟 / 假定时器）

    private final class Clock {
        var t = 0.0
        var timers: [(id: Int, at: Double, fn: () -> Void)] = []
        var next = 0
        func now() -> Double { t }
        func schedule(_ d: Double, _ fn: @escaping () -> Void) -> () -> Void {
            next += 1
            let id = next
            timers.append((id, t + d, fn))
            return { [weak self] in self?.timers.removeAll { $0.id == id } }
        }
        func advance(_ ms: Double) {
            let target = t + ms
            while let due = timers.filter({ $0.at <= target }).min(by: { $0.at < $1.at }) {
                t = due.at
                timers.removeAll { $0.id == due.id }
                due.fn()
            }
            t = target
        }
    }

    private func life(_ c: Clock, ms: Double = 5000, held: Bool = true, keepOpen: Bool = true, assistive: @escaping () -> Bool = { false }, expire: @escaping () -> Void) -> NativeUndoLifetime {
        NativeUndoLifetime(ms: ms, pauseWhileHeld: held, keepOpenWithAssistiveTech: keepOpen, now: c.now, schedule: c.schedule, assistive: assistive, onExpire: expire)
    }

    func testUndoLifetimeExpiresAfterFiveSecondsOnce() {
        let c = Clock()
        var fired = 0
        let l = life(c) { fired += 1 }
        l.start()
        c.advance(4999)
        XCTAssertEqual(fired, 0)
        XCTAssertEqual(l.remainingMs, 1, accuracy: 0.001)
        c.advance(2)
        XCTAssertEqual(fired, 1)
        c.advance(60_000)
        XCTAssertEqual(fired, 1, "onExpire is called once")
    }

    func testHoldingAFingerPausesAndReleaseContinuesWithTheRemainingTime() {
        let c = Clock()
        var fired = 0
        let l = life(c) { fired += 1 }
        l.start()
        c.advance(3000)
        l.hold()
        c.advance(60_000)
        XCTAssertEqual(fired, 0, "paused while held")
        XCTAssertEqual(l.remainingMs, 2000, accuracy: 0.001)
        l.release()
        c.advance(1999)
        XCTAssertEqual(fired, 0, "the remaining 2s, not a fresh 5s")
        c.advance(2)
        XCTAssertEqual(fired, 1)
        // pauseWhileHeld 关：按住不暂停
        let c2 = Clock()
        var fired2 = 0
        let l2 = life(c2, held: false) { fired2 += 1 }
        l2.start()
        l2.hold()
        c2.advance(5001)
        XCTAssertEqual(fired2, 1)
    }

    func testAssistiveTechKeepsTheBarOpenUntilItIsTurnedOff() {
        let c = Clock()
        var fired = 0
        var voiceOver = true
        let l = life(c, assistive: { voiceOver }) { fired += 1 }
        l.start()
        c.advance(5001)
        XCTAssertEqual(fired, 0, "pinned while VoiceOver is running")
        XCTAssertEqual(l.remainingMs, 5000, "a pinned bar hands over a full window")
        c.advance(120_000)
        XCTAssertEqual(fired, 0)
        voiceOver = false
        l.assistiveChanged(false)
        c.advance(4999)
        XCTAssertEqual(fired, 0, "a full 5s after the reader is turned off")
        c.advance(2)
        XCTAssertEqual(fired, 1)
        // 钉住之前读屏关了 / 开着时 assistiveChanged(true) 不动
        let c2 = Clock()
        var fired2 = 0
        let l2 = life(c2, assistive: { false }) { fired2 += 1 }
        l2.start()
        l2.assistiveChanged(true)
        c2.advance(5001)
        XCTAssertEqual(fired2, 1)
    }

    func testStopCancelsAndLaterHoldReleaseDoNotRestart() {
        let c = Clock()
        var fired = 0
        let l = life(c) { fired += 1 }
        l.start()
        c.advance(1000)
        l.stop()
        l.hold()
        l.release()
        c.advance(60_000)
        XCTAssertEqual(fired, 0)
        XCTAssertEqual(l.remainingMs, 0)
    }

    // MARK: 撤销条 / 确认框视图

    func testUndoBarShowsTheSkipTextThenTheThreePartFailure() {
        let bar = NativeUndoBarView(background: .black, foreground: .white)
        bar.strings = .init(text: "T", undo: "U", failed: "F", cancel: "C", retry: "R")
        bar.frame = CGRect(x: 0, y: 0, width: 335, height: bar.height(for: 335))
        bar.layoutIfNeeded()
        XCTAssertEqual(bar.textForTesting, "T")
        XCTAssertFalse(bar.undoButtonForTesting.isHidden)
        XCTAssertTrue(bar.cancelButtonForTesting.isHidden)
        XCTAssertGreaterThanOrEqual(bar.frame.height, 48)
        var undone = 0, cancelled = 0
        bar.onUndo = { undone += 1 }
        bar.onCancelFail = { cancelled += 1 }
        bar.undoButtonForTesting.sendActions(for: .touchUpInside)
        bar.setFailed(true)
        XCTAssertEqual(bar.textForTesting, "F", "没保存上，不自动消失")
        XCTAssertTrue(bar.undoButtonForTesting.isHidden)
        bar.retryButtonForTesting.sendActions(for: .touchUpInside)
        bar.cancelButtonForTesting.sendActions(for: .touchUpInside)
        XCTAssertEqual(undone, 2)
        XCTAssertEqual(cancelled, 1)
    }

    func testEndDialogHasNoPreselectedButtonAndTheScrimMeansKeepWriting() {
        let d = NativeEndDialogView(frame: CGRect(x: 0, y: 0, width: 375, height: 800), strings: .init(body: "B", end: "E", cont: "K", failed: "F", cancel: "C", retry: "R"), palette: .init())
        d.layoutIfNeeded()
        XCTAssertEqual(d.bodyForTesting, "B")
        XCTAssertEqual(d.leftTitleForTesting, "E", "「结束这组」是普通按钮，在左")
        XCTAssertEqual(d.rightTitleForTesting, "K", "「接着写」是主按钮，在右")
        XCTAssertTrue(d.accessibilityViewIsModal)
        XCTAssertFalse(d.leftTitleForTesting.isEmpty)
        var log: [String] = []
        d.onEnd = { log.append("end") }
        d.onContinue = { log.append("continue") }
        d.onCancelFail = { log.append("cancel") }
        d.tapScrimForTesting()
        d.tapRightForTesting()
        d.tapLeftForTesting()
        XCTAssertEqual(log, ["continue", "continue", "end"])
        // 失败：三段式 [先不保存 | 再试一次]，正文换成没保存上
        d.setFailed(true)
        XCTAssertEqual(d.bodyForTesting, "F")
        XCTAssertEqual(d.leftTitleForTesting, "C")
        XCTAssertEqual(d.rightTitleForTesting, "R")
        log = []
        d.tapLeftForTesting()
        d.tapRightForTesting()
        d.tapScrimForTesting()
        XCTAssertEqual(log, ["cancel", "end", "continue"], "再试一次 = 再提交一次；遮罩在失败态同样是关框")
        let panelInside = d.subviews.contains { $0.accessibilityIdentifier == "native-write-end-dialog" }
        XCTAssertTrue(panelInside)
    }
}
