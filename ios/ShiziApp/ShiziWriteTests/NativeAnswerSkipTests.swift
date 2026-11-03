import UIKit
import XCTest
@testable import Shizi

// B2.4 / B2.6 原生写字页的真 store 路径（scheme ShiziWriteTests：App 作测试宿主，环境 SHIZI_NATIVE_WRITE=1、SHIZI_TEST_HOST=1）：
// 首页开组 → 原生写字页盖上 → 走原生页面自己的按钮路径（看答案 / 凭记忆写 / 下一个 / 跳过 / 撤销 / 结束这组），读回 Swift 的 store（TestHost）。
// 这里证明原生页面、写字会话 API（SwiftEngine）、真 store 与 SQLite 这一整条通，并核对失败三段式（D07）。

@MainActor
final class NativeAnswerSkipTests: XCTestCase {
    private var host: TestHost!
    private var root: RootViewController { host.root }
    private var bridge: WriteSessionChannel!

    override func setUp() async throws {
        try await super.setUp()
        host = try TestHost()
        try await waitUntil("engine ready") { self.host.ready }
        host.reset()
        try await waitUntil("no native page") { self.root.nativeWriteTop == nil }
        bridge = WriteSessionChannel()
    }

    // MARK: 工具

    private func state() async throws -> [String: Any] { host.state() }

    private func waitUntil(_ what: String, timeout: TimeInterval = 15, _ cond: @escaping () async -> Bool) async throws {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if await cond() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("timed out waiting for \(what)")
        throw CancellationError()
    }

    private func startGroup() async throws -> NativeWriteViewController {
        _ = await host.startA()
        try await waitUntil("native write page") { self.root.nativeWriteTop != nil && self.root.presentedViewController?.isBeingPresented == false }
        return try XCTUnwrap(root.nativeWriteTop)
    }

    /// 这次选的字（B 槽，picked）：能「结束这组」（首次练习与今天的练习不同，D66 ⑥：first 不放）。
    private func startPickedGroup() async throws -> NativeWriteViewController {
        host.startPicked(["永", "和", "春", "日", "月", "山", "水", "火"])
        try await waitUntil("native write page (B)") { self.root.nativeWriteTop?.slot == "B" && self.root.presentedViewController?.isBeingPresented == false }
        return try XCTUnwrap(root.nativeWriteTop)
    }

    private func sessionB(_ st: [String: Any]) -> [String: Any]? {
        (st["sessions"] as? [String: Any])?["B"] as? [String: Any]
    }

    private static let stroke: [InkRawPoint] = (0..<10).map { i in InkRawPoint(x: 60 + Double(i) * 22, y: 170 + Double(i % 2), t: 1_000 + Double(i) * 16) }

    private func records(_ st: [String: Any]) -> [[String: Any]] {
        ((st["records"] as? [String: Any]) ?? [:]).values.flatMap { ($0 as? [[String: Any]]) ?? [] }
    }

    private func sessionA(_ st: [String: Any]) -> [String: Any]? {
        (st["sessions"] as? [String: Any])?["A"] as? [String: Any]
    }

    private func current(_ st: [String: Any]) -> [String: Any]? { sessionA(st)?["current"] as? [String: Any] }

    private func write(_ vc: NativeWriteViewController) throws {
        vc.nativeInkDidEndStroke(try XCTUnwrap(vc.inkViewForTesting), raw: Self.stroke)
    }

    private func tap(_ vc: NativeWriteViewController, _ name: String) { vc.perform(Selector((name))) }

    // MARK: 看答案 → 描一遍 → 凭记忆写 → 下一个（B2.4）

    func testShowAnswerGoesStraightIntoTraceThenRetraceThenNext() async throws {
        let vc = try await startGroup()
        let key = try XCTUnwrap(vc.cardKey)
        XCTAssertEqual(vc.phase, .recall)
        XCTAssertTrue(vc.endButtonHiddenForTesting, "no 结束这组 in the first practice (D66 ⑥)")
        XCTAssertFalse(vc.skipButtonHiddenForTesting)
        XCTAssertFalse(vc.traceLayerForTesting.isShown, "no answer in the recall phase (D16)")
        // 先在回忆阶段写一笔（看答案前的笔迹只是这一字的现场，不存）
        try write(vc)
        tap(vc, "tapShowAnswer")
        try await waitUntil("trace phase") { vc.phase == .trace }
        XCTAssertEqual(vc.cardKey, key, "the same char: no card change")
        XCTAssertTrue(vc.traceLayerForTesting.isShown, "the standard writing is shown right away, ready to trace (D64 ②)")
        XCTAssertTrue(vc.traceLayerForTesting.showsFallbackChar || vc.traceLayerForTesting.solidStrokes == [0], "current stroke solid")
        XCTAssertEqual(vc.strokes.count, 0, "tracing starts on an empty grid")
        var st = try await state()
        XCTAssertEqual(current(st)?["phase"] as? String, "trace")
        XCTAssertEqual(current(st)?["answerSeen"] as? Bool, true)
        let seen = records(st).filter { ($0["cardKey"] as? String) == key && ($0["kind"] as? String) == "answer-seen" }
        XCTAssertEqual(seen.count, 1)
        XCTAssertEqual((seen.first?["help"] as? [String: Any])?["traced"] as? Bool, true)
        // 描一笔：当前一笔往后移（写过的被墨盖住）
        try write(vc)
        XCTAssertEqual(vc.strokes.count, 1)
        if vc.traceLayerForTesting.glyph != nil { XCTAssertEqual(vc.traceLayerForTesting.solidStrokes, [1]) }
        // 凭记忆写：清空、只算练习
        tap(vc, "tapPrimary")
        try await waitUntil("retrace phase") { vc.phase == .retrace }
        XCTAssertEqual(vc.strokes.count, 0)
        XCTAssertFalse(vc.traceLayerForTesting.isShown, "no reference in 凭记忆写")
        try write(vc)
        try write(vc)
        // 下一个：推进到下一字，不进判断
        tap(vc, "tapPrimary")
        try await waitUntil("next card") { vc.cardKey != key || self.root.nativeWriteTop == nil }
        XCTAssertEqual(vc.phase, .recall)
        st = try await state()
        let recs = records(st).filter { ($0["cardKey"] as? String) == key }
        XCTAssertEqual(recs.filter { ($0["kind"] as? String) == "judged" }.count, 0, "no judgment for a seen answer")
        let seenId = try XCTUnwrap(seen.first?["id"] as? String)
        let hasInk = host.hasInk(recordId: seenId)
        XCTAssertEqual(hasInk, false, "D70 ②（R9-C）：凭记忆写的笔迹不存，看过答案记录没有墨迹")
        XCTAssertEqual(sessionA(st)?["cursor"] as? Int, 1)
        let line = vc.snapshot["line"] as? [String: Any]
        XCTAssertEqual(line?["state"] as? String, "saw")
    }

    func testFailedShowAnswerShowsTheThreePartFailureInPlaceAndRetryRecordsOnce() async throws {
        let vc = try await startGroup()
        let key = try XCTUnwrap(vc.cardKey)
        let before = records(try await state()).count
        root.qaFailNextWrite()
        tap(vc, "tapShowAnswer")
        try await waitUntil("failure shown") { vc.flowFail != nil }
        XCTAssertEqual(vc.flowFail, .showAnswer)
        XCTAssertEqual(vc.phase, .recall, "D07: stays on the recall page")
        var st = try await state()
        XCTAssertEqual(records(st).count, before, "nothing recorded")
        XCTAssertEqual(current(st)?["phase"] as? String ?? "recall", "recall")
        // 再试一次
        tap(vc, "tapPrimary")
        try await waitUntil("trace phase") { vc.phase == .trace }
        XCTAssertNil(vc.flowFail)
        st = try await state()
        XCTAssertEqual(records(st).filter { ($0["cardKey"] as? String) == key && ($0["kind"] as? String) == "answer-seen" }.count, 1, "recorded once")
        // 凭记忆写没保存上：留在描一遍，笔迹还在；「先不保存」回到平常
        try write(vc)
        root.qaFailNextWrite()
        tap(vc, "tapPrimary")
        try await waitUntil("failure on phase change") { vc.flowFail != nil }
        XCTAssertEqual(vc.phase, .trace)
        XCTAssertEqual(vc.strokes.count, 1, "what you wrote is still there")
        tap(vc, "tapFlowCancel")
        XCTAssertNil(vc.flowFail)
    }

    // MARK: 跳过与撤销（B2.6）

    func testSkipShowsTheUndoBarAndUndoPutsTheCharBack() async throws {
        let vc = try await startGroup()
        let key = try XCTUnwrap(vc.cardKey)
        XCTAssertFalse(vc.skipButtonHiddenForTesting)
        try write(vc) // 跳过时格子里的笔画随撤销一起放回
        tap(vc, "tapSkip")
        try await waitUntil("advanced") { vc.cardKey != key }
        XCTAssertNotNil(vc.undoBarForTesting, "已跳过「X」· 撤销")
        var st = try await state()
        let skipped = records(st).filter { ($0["cardKey"] as? String) == key }
        XCTAssertEqual(skipped.map { $0["kind"] as? String }, ["skipped"])
        XCTAssertEqual(sessionA(st)?["cursor"] as? Int, 1)
        // 撤销
        let bar = try XCTUnwrap(vc.undoBarForTesting)
        bar.undoButtonForTesting.sendActions(for: .touchUpInside)
        try await waitUntil("back to the skipped char") { vc.cardKey == key }
        XCTAssertNil(vc.undoBarForTesting)
        st = try await state()
        XCTAssertEqual(records(st).filter { ($0["cardKey"] as? String) == key }.count, 0, "the skipped record is gone")
        XCTAssertEqual(sessionA(st)?["cursor"] as? Int, 0)
        XCTAssertEqual(vc.strokes.count, 1, "the strokes that were in the grid come back")
    }

    func testTheNextCharsFirstActionEndsTheUndoChance() async throws {
        let vc = try await startGroup()
        let key = try XCTUnwrap(vc.cardKey)
        tap(vc, "tapSkip")
        try await waitUntil("advanced") { vc.cardKey != key && vc.undoBarForTesting != nil }
        vc.nativeInkDidBeginStroke(try XCTUnwrap(vc.inkViewForTesting), at: 0)
        XCTAssertNil(vc.undoBarForTesting, "first pen-down on the next char closes the bar (G3)")
        // 点看答案 / 开结束确认框同样收起
        tap(vc, "tapSkip")
        try await waitUntil("second skip bar") { vc.undoBarForTesting != nil }
        tap(vc, "tapShowAnswer")
        XCTAssertNil(vc.undoBarForTesting)
    }

    func testFailedSkipStaysAndRetryRecordsOnce() async throws {
        let vc = try await startGroup()
        let key = try XCTUnwrap(vc.cardKey)
        root.qaFailNextWrite()
        tap(vc, "tapSkip")
        try await waitUntil("failure shown") { vc.flowFail == .skip }
        XCTAssertEqual(vc.cardKey, key, "not advanced")
        XCTAssertNil(vc.undoBarForTesting)
        XCTAssertTrue(vc.skipButtonHiddenForTesting, "the skip button gives way to 再试一次 / 先不保存")
        tap(vc, "tapPrimary")
        try await waitUntil("advanced") { vc.cardKey != key }
        let st = try await state()
        XCTAssertEqual(records(st).filter { ($0["cardKey"] as? String) == key && ($0["kind"] as? String) == "skipped" }.count, 1)
    }

    func testSkippingTheLastCharHandsTheUndoChanceToTheWebResultPage() async throws {
        let vc = try await startGroup()
        var guardCount = 0
        while root.nativeWriteTop != nil, guardCount < 40 {
            guardCount += 1
            let key = vc.cardKey
            tap(vc, "tapSkip")
            try await waitUntil("next or result") { self.root.nativeWriteTop == nil || vc.cardKey != key }
        }
        try await waitUntil("result page") {
            self.host.top == "result"
        }
        // B2.7：结果页是原生的，撤销机会交给原生结果页的撤销条（S4）
        try await waitUntil("undo bar on the native result page") { self.root.nativeResultTop?.undoBarForTesting != nil }
    }

    // MARK: 结束这组（B2.6）

    func testEndAsksFirstAndKeepWritingLeavesEverythingAsIs() async throws {
        let vc = try await startPickedGroup()
        let key = try XCTUnwrap(vc.cardKey)
        XCTAssertFalse(vc.endButtonHiddenForTesting)
        tap(vc, "tapEnd")
        try await waitUntil("dialog") { vc.endDialogForTesting != nil }
        let d = try XCTUnwrap(vc.endDialogForTesting)
        let total = vc.snapshot["total"] as? Int ?? 0
        XCTAssertTrue(d.bodyForTesting.contains("\(total)"), "n = the chars not written yet: \(d.bodyForTesting)")
        d.tapRightForTesting() // 接着写
        XCTAssertNil(vc.endDialogForTesting)
        let st = try await state()
        XCTAssertNotNil(sessionB(st), "the group is still there")
        XCTAssertEqual(vc.cardKey, key)
        // 点遮罩 = 接着写
        tap(vc, "tapEnd")
        try await waitUntil("dialog again") { vc.endDialogForTesting != nil }
        try XCTUnwrap(vc.endDialogForTesting).tapScrimForTesting()
        XCTAssertNil(vc.endDialogForTesting)
    }

    func testEndWithJudgmentsGoesToTheResultPageAndWithNoneBackToTheSource() async throws {
        // 有判断：写一个字判断后结束 → 结果页
        var vc = try await startPickedGroup()
        let key = try XCTUnwrap(vc.cardKey)
        try write(vc)
        tap(vc, "tapDone")
        tap(vc, "tapCorrect")
        try await waitUntil("next card") { vc.cardKey != key && vc.phase == .recall }
        tap(vc, "tapEnd")
        try await waitUntil("dialog") { vc.endDialogForTesting != nil }
        XCTAssertTrue(try XCTUnwrap(vc.endDialogForTesting).bodyForTesting.contains("1"), "m = 1 judged")
        try XCTUnwrap(vc.endDialogForTesting).tapLeftForTesting() // 结束这组
        try await waitUntil("result page") {
            self.host.top == "result"
        }
        var st = try await state()
        XCTAssertNil(sessionB(st))
        XCTAssertEqual(((st["sessions"] as? [String: Any])?["lastEnded"] as? [String: Any])?["B"] != nil, true)
        try await waitUntil("native page gone") { self.root.nativeWriteTop == nil }
        // 零判断：直接结束 → 回来源（首页），没有结果页
        host.reset()
        vc = try await startPickedGroup()
        tap(vc, "tapEnd")
        try await waitUntil("dialog") { vc.endDialogForTesting != nil }
        try XCTUnwrap(vc.endDialogForTesting).tapLeftForTesting()
        try await waitUntil("native page gone") { self.root.nativeWriteTop == nil }
        try await waitUntil("source page") {
            self.host.top != "write"
        }
        let top = host.top
        XCTAssertNotEqual(top, "result", "none judged: back to where you came from, no result page")
        st = try await state()
        XCTAssertNil(sessionB(st))
    }

    func testFailedEndKeepsTheGroupAndTheDialogShowsTheFailure() async throws {
        let vc = try await startPickedGroup()
        tap(vc, "tapEnd")
        try await waitUntil("dialog") { vc.endDialogForTesting != nil }
        let d = try XCTUnwrap(vc.endDialogForTesting)
        root.qaFailNextWrite()
        d.tapLeftForTesting()
        try await waitUntil("failed state") { d.isFailed }
        let kept = try await state()
        XCTAssertNotNil(sessionB(kept), "D07: the group is not ended")
        d.tapRightForTesting() // 再试一次
        try await waitUntil("native page gone") { self.root.nativeWriteTop == nil }
        let ended = try await state()
        XCTAssertNil(sessionB(ended))
    }

    func testOpeningTheEndDialogEndsTheUndoChance() async throws {
        let vc = try await startPickedGroup()
        let key = try XCTUnwrap(vc.cardKey)
        tap(vc, "tapSkip")
        try await waitUntil("bar") { vc.cardKey != key && vc.undoBarForTesting != nil }
        tap(vc, "tapEnd")
        try await waitUntil("dialog") { vc.endDialogForTesting != nil }
        XCTAssertNil(vc.undoBarForTesting, "no stale undo behind the confirmation (G3)")
        try XCTUnwrap(vc.endDialogForTesting).tapRightForTesting()
    }



    private static func literal(_ s: String) -> String {
        let data = try! JSONSerialization.data(withJSONObject: [s])
        let arr = String(data: data, encoding: .utf8)!
        return String(arr.dropFirst().dropLast())
    }
}
