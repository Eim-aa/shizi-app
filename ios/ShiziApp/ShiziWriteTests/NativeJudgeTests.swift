import UIKit
import WebKit
import XCTest
@testable import Shizi

// B2.5 判断页完整版与改判的宿主测试（scheme ShiziWriteTests：App 作测试宿主，真 store、原生 SQLite、写字会话 API）。
// 版式 / 时刻 / 三段式 / 倒放 / 落定 / 改判弹层都经原生页面自己的路径（tapDone、tapWrong、tapChange …）走到真 store 再读回。
// 与网页路径逐字段一致由 test/ui/native-write.test.mjs 证明（同一批提交函数）。

@MainActor
final class NativeJudgeTests: XCTestCase {
    private var web: WebViewController!
    private var bridge: NativeWriteBridge!

    override func setUp() async throws {
        try await super.setUp()
        let root = UIApplication.shared.delegate?.window??.rootViewController
        web = try XCTUnwrap(root as? WebViewController, "root is the web shell")
        try await waitUntil("page ready") { self.web.pageReady }
        try await waitUntil("test hooks") { (try? await self.js("return !!window.__shiziTest && typeof window.shiziNativeWrite === 'function';")) as? Bool == true }
        if let top = web.nativeWriteTop {
            top.exitHandled = true
            top.dismiss(animated: false)
        }
        _ = try await js("(await import('/src/ui/router.js')).nav.switchTab('home'); return window.__shiziTest.reset();")
        try await waitUntil("no native page") { self.web.nativeWriteTop == nil }
        bridge = NativeWriteBridge(webView: web.webView)
    }

    // MARK: 工具

    @discardableResult
    private func js(_ body: String) async throws -> Any? {
        try await web.webView.callAsyncJavaScript(body, arguments: [:], in: nil, contentWorld: .page)
    }

    private func state() async throws -> [String: Any] {
        let value = try await js("return window.__shiziTest.getState();")
        return try XCTUnwrap(value as? [String: Any])
    }

    private func recs() async throws -> [[String: Any]] { records(try await state()) }

    private func call(_ op: String, _ args: [String: Any]) async -> NativeWriteReply {
        await withCheckedContinuation { cont in bridge.call(op, args) { cont.resume(returning: $0) } }
    }

    private func waitUntil(_ what: String, timeout: TimeInterval = 15, _ cond: @escaping () async -> Bool) async throws {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if await cond() { return }
            try await Task.sleep(nanoseconds: 30_000_000)
        }
        XCTFail("timed out waiting for \(what)")
        throw CancellationError()
    }

    private func startGroup() async throws -> NativeWriteViewController {
        _ = try await js("const m = await import('/src/ui/screens/session/index.js'); return m.startA({}).ok;")
        try await waitUntil("native write page") { self.web.nativeWriteTop != nil && self.web.presentedViewController?.isBeingPresented == false }
        return try XCTUnwrap(web.nativeWriteTop)
    }

    private static let stroke: [InkRawPoint] = (0..<10).map { i in InkRawPoint(x: 60 + Double(i) * 22, y: 170 + Double(i % 2), t: 1_000 + Double(i) * 16) }

    private func records(_ st: [String: Any]) -> [[String: Any]] {
        ((st["records"] as? [String: Any]) ?? [:]).values.flatMap { ($0 as? [[String: Any]]) ?? [] }
    }

    private func sessionA(_ st: [String: Any]) -> [String: Any]? {
        (st["sessions"] as? [String: Any])?["A"] as? [String: Any]
    }

    private func copyOf(_ keys: [String]) async -> [String: String] {
        let r = await call("copy", ["keys": keys])
        return (r.body["copy"] as? [String: String]) ?? [:]
    }

    /// 写一笔 →「写好了」→ 判断页。
    private func enterCompare(_ vc: NativeWriteViewController) throws {
        vc.nativeInkDidEndStroke(try XCTUnwrap(vc.inkViewForTesting), raw: Self.stroke)
        vc.perform(Selector(("tapDone")))
        XCTAssertEqual(vc.phase, .compare)
    }

    private func waitForKeys(_ vc: NativeWriteViewController) async throws {
        try await waitUntil("judge keys ready") { vc.judgeKeysReadyForTesting }
    }

    // MARK: B2.9b 读屏：两指 Z 形 = 左上（N3）与播报（网页 sr-live.js 同一组句子）

    /// 两指 Z 形（accessibilityPerformEscape）在每个阶段都等于点左上：判断阶段 = 接着写（T-phase 倒放）、确认框开着 = 关框接着写、回忆阶段 = 离开；
    /// 一路上的读屏通知：每笔「已写 n 笔」、撤销到空、进判断页 / 回到回忆 screenChanged（焦点在页标题）。
    func testB29b_escapeIsTheTopLeftActionAndAnnouncementsFollowTheWeb() async throws {
        let vc = try await startGroup()
        let copy = await copyOf(["X-WRITE.liveStroke", "X-WRITE.liveUndoEmpty", "R-W03.titleCompare"])
        var mark = NativeA11y.total
        func since() -> [String] { Array(NativeA11y.events.suffix(max(0, NativeA11y.total - mark))) }
        vc.nativeInkDidEndStroke(try XCTUnwrap(vc.inkViewForTesting), raw: Self.stroke)
        XCTAssertEqual(since(), ["announce:" + (copy["X-WRITE.liveStroke"] ?? "").replacingOccurrences(of: "{n}", with: "1")])
        mark = NativeA11y.total
        vc.perform(Selector(("tapUndo")))
        XCTAssertEqual(since(), ["announce:" + (copy["X-WRITE.liveUndoEmpty"] ?? "")])
        try enterCompare(vc)
        XCTAssertEqual(NativeA11y.events.last, "screen:" + (copy["R-W03.titleCompare"] ?? ""))
        // 判断阶段：Z 形 = 接着写
        XCTAssertTrue(vc.accessibilityPerformEscape())
        try await waitUntil("recall again") { vc.phase == .recall && !vc.reversingForTesting }
        XCTAssertTrue(NativeA11y.events.last?.hasPrefix("screen:") == true)
        XCTAssertNotNil(web.nativeWriteTop, "还在写字页")
        // 确认框开着：Z 形 = 接着写（关框，不离开）
        if !vc.endButtonHiddenForTesting {
            vc.perform(Selector(("tapEnd")))
            try await waitUntil("end dialog") { vc.endDialogForTesting != nil }
            XCTAssertTrue(vc.accessibilityPerformEscape())
            try await waitUntil("end dialog closed") { vc.endDialogForTesting == nil }
            XCTAssertNotNil(web.nativeWriteTop, "关框后还在写字页")
        }
        // 回忆阶段：Z 形 = 离开（与「‹」同一个动作）
        XCTAssertTrue(vc.accessibilityPerformEscape())
        try await waitUntil("left the write page") { self.web.nativeWriteTop == nil }
    }

    // MARK: 判断页完整版

    func testCompareIsTheTwoCellPageWithHeaderTimingAndSameStyleKeys() async throws {
        let vc = try await startGroup()
        let copy = await copyOf(["R-W03.titleCompare", "R-W01.progress", "R-W09.btnWrong", "R-W09.btnCorrect", "R-W09.continueWriting"])
        let open = await call("open", ["slot": "A"])
        let timing = try XCTUnwrap(open.body["timing"] as? [String: Any])
        let appear = (timing["judgeAppearMs"] as? NSNumber)?.doubleValue ?? 0
        let ready = (timing["judgeReadyMs"] as? NSNumber)?.doubleValue ?? 0
        XCTAssertEqual(appear, 320)
        XCTAssertEqual(ready, 440)
        try enterCompare(vc)
        let t0 = CACurrentMediaTime()
        // 页头：标题居中（页标题，读屏焦点所在）、右侧计数、左上「‹」读屏名「接着写」
        XCTAssertEqual(vc.titleTextForTesting, copy["R-W03.titleCompare"])
        XCTAssertEqual(vc.progressTextForTesting, copy["R-W01.progress"]?.replacingOccurrences(of: "{n}", with: "1").replacingOccurrences(of: "{total}", with: "\(vc.snapshot["total"] as? Int ?? 0)"))
        // 两键：时刻编排——320ms 前不显示，之后 60% 且不可点，440ms 变实可点
        let keys = vc.judgeKeysForTesting
        XCTAssertEqual(keys.wrong.alpha, 0, accuracy: 0.01, "0–judgeAppear 不显示")
        XCTAssertFalse(vc.judgeKeysReadyForTesting)
        XCTAssertFalse(keys.wrong.isEnabled)
        try await waitUntil("keys appear at 60%") { keys.wrong.alpha > 0.5 }
        XCTAssertGreaterThanOrEqual(CACurrentMediaTime() - t0, appear / 1000 - 0.05)
        XCTAssertFalse(vc.judgeKeysReadyForTesting, "60% 时仍不可点")
        try await waitForKeys(vc)
        let readyAt = CACurrentMediaTime() - t0
        XCTAssertGreaterThanOrEqual(readyAt, ready / 1000 - 0.05)
        XCTAssertLessThan(readyAt, ready / 1000 + 0.35)
        XCTAssertEqual(keys.wrong.alpha, 1, accuracy: 0.01)
        XCTAssertTrue(keys.wrong.isEnabled && keys.correct.isEnabled)
        // 同组件同样式、无预选、无着色（D03）
        XCTAssertEqual(keys.wrong.frame.size, keys.correct.frame.size)
        XCTAssertEqual(keys.wrong.title(for: .normal), copy["R-W09.btnWrong"])
        XCTAssertEqual(keys.correct.title(for: .normal), copy["R-W09.btnCorrect"])
        XCTAssertEqual(keys.wrong.layer.borderWidth, keys.correct.layer.borderWidth)
        XCTAssertEqual(keys.wrong.layer.cornerRadius, keys.correct.layer.cornerRadius)
        XCTAssertEqual(keys.wrong.titleColor(for: .normal), keys.correct.titleColor(for: .normal))
        XCTAssertEqual(keys.wrong.titleLabel?.font, keys.correct.titleLabel?.font)
        XCTAssertFalse(keys.wrong.isSelected || keys.correct.isSelected)
        XCTAssertEqual(keys.wrong.backgroundColor ?? .clear, .clear)
        XCTAssertEqual(keys.correct.backgroundColor ?? .clear, .clear)
        // 主按钮位置：两键与写字页「写好了」同一行
        let done = try XCTUnwrap(findButton(vc.view, id: "native-write-done"))
        let kf = keys.wrong.convert(keys.wrong.bounds, to: vc.view)
        let df = done.convert(done.bounds, to: vc.view)
        XCTAssertEqual(kf.minY, df.minY, accuracy: 0.5)
        XCTAssertEqual(kf.height, df.height, accuracy: 0.5)
        // 上下两格：同一顶边、同一中线，共用 1pt 格线
        let g = vc.gridFramesForTesting
        XCTAssertEqual(g.mine.width, g.ref.width, accuracy: 0.01)
        XCTAssertEqual(g.mine.midX, g.ref.midX, accuracy: 0.01)
        XCTAssertEqual(g.mine.midX, vc.view.bounds.midX, accuracy: 0.51)
        XCTAssertEqual(g.ref.minY, g.mine.maxY - 1, accuracy: 0.01, "共用一条 1pt 格线")
        XCTAssertEqual(vc.gridFrameLineWidthForTesting, 1, "格框线宽 = tokens frame-w（1pt）")
        // 没有本人笔画才出现「这次没写」；这里有笔画
        XCTAssertFalse(vc.noInkShownForTesting)
        // 题面里目标格不显示答案（空格 + 拼音，D16）
        let answer = vc.cardKey.map { String($0.dropFirst(5)) } ?? ""
        XCTAssertFalse(answer.isEmpty)
        XCTAssertFalse(vc.promptTextsForTesting.contains(answer), "题面不含答案字")
    }

    func testNoStrokeShowsNothingWrittenInTheTopCell() async throws {
        let vc = try await startGroup()
        let copy = await copyOf(["R-W17.noInk"])
        try enterCompare(vc)
        XCTAssertFalse(vc.noInkShownForTesting)
        vc.forceCompareWithoutInkForTesting()
        XCTAssertTrue(vc.noInkShownForTesting)
        XCTAssertEqual(vc.noInkTextForTesting, copy["R-W17.noInk"])
    }

    // MARK: 回包前落笔持住（复核 B2.1 / B2.2）

    func testStrokeDuringJudgeIsHeldToTheNextCard() async throws {
        let vc = try await startGroup()
        let key = try XCTUnwrap(vc.cardKey)
        try enterCompare(vc)
        try await waitForKeys(vc)
        vc.perform(Selector(("tapCorrect")))
        // 回包之前落下的笔先持住（drawable 打开、acceptFrom = ∞），推进后接着画
        XCTAssertEqual(vc.inkViewForTesting?.acceptFrom, .infinity)
        try await waitUntil("advanced") { vc.cardKey != key && vc.phase == .recall }
        XCTAssertNotEqual(vc.inkViewForTesting?.acceptFrom, .infinity, "next card re-arms the pen (250ms)")
    }

    // MARK: 判断落定（M23）

    func testSettlePlaysAfterASuccessfulJudgmentAndNotAfterAFailedOne() async throws {
        let vc = try await startGroup()
        let key = try XCTUnwrap(vc.cardKey)
        try enterCompare(vc)
        try await waitForKeys(vc)
        _ = try await js("return window.__shiziTest.failNextWrite(1, {kind:'generic'});")
        vc.perform(Selector(("tapWrong")))
        try await waitUntil("failed") { vc.failShownForTesting }
        XCTAssertEqual(vc.settlePlayedForTesting, 0, "失败不落定、不发触觉（F1）")
        vc.perform(Selector(("tapRetry")))
        try await waitUntil("advanced") { vc.cardKey != key && vc.phase == .recall }
        XCTAssertEqual(vc.settlePlayedForTesting, 1, "成功后本人笔迹离纸收进计数")
        XCTAssertEqual(vc.inkViewForTesting?.isHidden, false, "新字的书写面可见")
    }

    // MARK: 三段式（D07）

    func testSaveFailureIsTheThreePartBlockAndRetryRecordsOnce() async throws {
        let vc = try await startGroup()
        let key = try XCTUnwrap(vc.cardKey)
        let copy = await copyOf(["R-W16.saveFailed", "R-W16.retry", "R-W16.cancel"])
        try enterCompare(vc)
        try await waitForKeys(vc)
        let before = try await recs().count
        _ = try await js("return window.__shiziTest.failNextWrite(1, {kind:'generic'});")
        vc.perform(Selector(("tapWrong")))
        try await waitUntil("failed") { vc.failShownForTesting }
        // 说明 → 先不保存（求助行）→ 再试一次（主按钮，满宽）；两键收起
        let keys = vc.judgeKeysForTesting
        XCTAssertTrue(keys.wrong.isHidden && keys.correct.isHidden)
        XCTAssertEqual(vc.failRetryForTesting.title(for: .normal), copy["R-W16.retry"])
        XCTAssertEqual(vc.failCancelForTesting.title(for: .normal), copy["R-W16.cancel"])
        XCTAssertEqual(vc.failNoteTextForTesting, copy["R-W16.saveFailed"])
        vc.view.layoutIfNeeded()
        let retry = vc.failRetryForTesting.convert(vc.failRetryForTesting.bounds, to: vc.view)
        let cancel = vc.failCancelForTesting.convert(vc.failCancelForTesting.bounds, to: vc.view)
        XCTAssertEqual(retry.width, vc.view.bounds.width - 40, accuracy: 0.5, "再试一次是满宽主按钮")
        XCTAssertEqual(cancel.maxY + 20, retry.minY, accuracy: 0.5, "先不保存在主按钮正上方 20")
        XCTAssertLessThan(vc.failNoteFrameForTesting.maxY, cancel.minY)
        let recCount = try await recs().count
        XCTAssertEqual(recCount, before, "D07：没记")
        XCTAssertEqual(vc.cardKey, key)
        XCTAssertEqual(vc.phase, .compare, "留在判断页，笔迹还在")
        XCTAssertEqual(vc.strokes.count, 1)
        // 先不保存 → 回到两键
        vc.perform(Selector(("tapFailCancel")))
        XCTAssertFalse(vc.failShownForTesting)
        XCTAssertFalse(keys.wrong.isHidden)
        // 再失败再重试 → 成功只记一次
        _ = try await js("return window.__shiziTest.failNextWrite(1, {kind:'generic'});")
        try await waitForKeys(vc)
        vc.perform(Selector(("tapCorrect")))
        try await waitUntil("failed again") { vc.failShownForTesting }
        vc.perform(Selector(("tapRetry")))
        try await waitUntil("advanced") { vc.cardKey != key && vc.phase == .recall }
        let recCount2 = try await recs().count
        XCTAssertEqual(recCount2, before + 1, "重试不重复计数")
        let allRecs = try await recs()
        let rec = try XCTUnwrap(allRecs.first { ($0["cardKey"] as? String) == key })
        XCTAssertEqual(rec["judgment"] as? String, "correct")
    }

    // MARK: 「‹ 接着写」与左缘滑回（T-phase 倒放）

    func testBackReplaysThePhaseAndTheInkComesBackAsWritten() async throws {
        let vc = try await startGroup()
        let key = try XCTUnwrap(vc.cardKey)
        try enterCompare(vc)
        try await Task.sleep(nanoseconds: 300_000_000)
        let compareGrid = vc.gridFramesForTesting.mine
        vc.perform(Selector(("tapBack")))
        XCTAssertTrue(vc.reversingForTesting, "倒放开始")
        XCTAssertEqual(vc.phase, .compare, "倒放期间仍是判断阶段")
        try await waitUntil("recall again") { vc.phase == .recall && !vc.reversingForTesting }
        let recallGrid = vc.gridFramesForTesting.mine
        XCTAssertGreaterThan(recallGrid.width, compareGrid.width - 0.5)
        XCTAssertEqual(recallGrid.minY, compareGrid.minY, accuracy: 0.01, "书写格顶边不动")
        XCTAssertEqual(vc.cardKey, key)
        XCTAssertEqual(vc.strokes.count, 1, "笔迹原样")
        XCTAssertEqual(vc.strokes.first?.count, Self.stroke.count)
        XCTAssertEqual(vc.inkViewForTesting?.frame.width ?? 0, recallGrid.width - 2, accuracy: 0.01)
        try await waitUntil("phase persisted") {
            ((self.sessionA((try? await self.state()) ?? [:])?["current"] as? [String: Any])?["phase"] as? String) == "recall"
        }
        let st = try await state()
        XCTAssertEqual(((self.sessionA(st)?["current"] as? [String: Any])?["strokes"] as? [Any])?.count, 1, "现场里的笔迹还在")
        XCTAssertEqual(records(st).count, 0, "没有判断就没有记录")
    }

    func testEdgeSwipeFollowsTheHandAndOnlyCompletesPastTheThreshold() async throws {
        let vc = try await startGroup()
        try enterCompare(vc)
        try await Task.sleep(nanoseconds: 300_000_000)
        let start = vc.gridFramesForTesting.mine
        // 没过阈值：松手回弹，仍在判断页
        vc.edgeReverseBegan()
        XCTAssertTrue(vc.reversingForTesting)
        vc.edgeReverseChanged(progress: 0.5)
        let mid = vc.gridFramesForTesting.mine
        XCTAssertGreaterThan(mid.width, start.width, "上格跟着手长回书写格")
        vc.edgeReverseEnded(commit: false)
        try await waitUntil("snapped back") { !vc.reversingForTesting }
        XCTAssertEqual(vc.phase, .compare)
        XCTAssertEqual(vc.gridFramesForTesting.mine.width, start.width, accuracy: 0.5)
        XCTAssertEqual(vc.strokes.count, 1)
        // 过阈值：完成，回到书写格、笔迹原样
        vc.edgeReverseBegan()
        vc.edgeReverseChanged(progress: 0.4)
        vc.edgeReverseEnded(commit: true)
        try await waitUntil("recall") { vc.phase == .recall && !vc.reversingForTesting }
        XCTAssertEqual(vc.strokes.count, 1)
    }

    func testPenDownDuringTheReplaySettlesItInOneFrame() async throws {
        let vc = try await startGroup()
        try enterCompare(vc)
        try await Task.sleep(nanoseconds: 300_000_000)
        vc.perform(Selector(("tapBack")))
        XCTAssertTrue(vc.reversingForTesting)
        // T0 规则 3：倒放中落笔，动画一帧到终态，这一笔照常生效
        vc.nativeInkDidBeginStroke(try XCTUnwrap(vc.inkViewForTesting), at: CACurrentMediaTime())
        XCTAssertEqual(vc.phase, .recall)
        XCTAssertFalse(vc.reversingForTesting)
    }

    // MARK: 结果行「修改 ›」与改判弹层

    private func judgeFirstCard(_ vc: NativeWriteViewController, _ which: String) async throws {
        let key = try XCTUnwrap(vc.cardKey)
        try enterCompare(vc)
        try await waitForKeys(vc)
        vc.perform(Selector(which == "wrong" ? ("tapWrong") : ("tapCorrect")))
        try await waitUntil("advanced") { vc.cardKey != key && vc.phase == .recall }
    }

    func testChangeLinkOpensTheSheetAndFlipsTheOneRecordOnce() async throws {
        let vc = try await startGroup()
        let copy = await copyOf(["X-JUDGE.changeTitle", "X-JUDGE.changeToWrong", "X-JUDGE.changeToCorrect", "R-W10.changeBodyCorrect", "R-W10.changeBodyWrong", "R-W10.lineChangedWrong"])
        let first = try XCTUnwrap(vc.cardKey)
        let char = String(first.dropFirst(5))
        XCTAssertFalse(vc.changeShownForTesting, "第一字没有上一个字的结果行")
        try await judgeFirstCard(vc, "correct")
        // 结果行：上一个字、可改；落笔后收起（D19）
        XCTAssertTrue(vc.lineShownForTesting)
        XCTAssertTrue(vc.changeShownForTesting, "「修改 ›」可见（可改的记录）")
        vc.perform(Selector(("tapChange")))
        try await waitUntil("sheet") { vc.changeSheetForTesting != nil && vc.presentedViewController?.isBeingPresented == false }
        let sheet = try XCTUnwrap(vc.changeSheetForTesting)
        XCTAssertEqual(sheet.model.char, char)
        XCTAssertEqual(sheet.model.judgment, "correct")
        XCTAssertEqual(sheet.titleTextForTesting, copy["X-JUDGE.changeTitle"]?.replacingOccurrences(of: "{char}", with: char))
        XCTAssertEqual(sheet.flipTitleForTesting, copy["X-JUDGE.changeToWrong"])
        XCTAssertEqual(sheet.noteTextForTesting, copy["R-W10.changeBodyCorrect"])
        XCTAssertTrue(sheet.hasInkForTesting, "「你的书写」是存下的笔迹（原始点）")
        XCTAssertEqual(sheet.model.strokes.count, 1)
        XCTAssertEqual(sheet.model.strokes.first?.count, Self.stroke.count)
        // 失败：就地换三段式，记录与 FSRS 不变
        _ = try await js("return window.__shiziTest.failNextWrite(1, {kind:'generic'});")
        sheet.apply()
        try await waitUntil("sheet failed") { sheet.failedForTesting }
        let failedCopy = await copyOf(["R-W10.changeFailed"])
        XCTAssertEqual(sheet.noteTextForTesting, failedCopy["R-W10.changeFailed"])
        let allRecs = try await recs()
        var rec = try XCTUnwrap(allRecs.first)
        XCTAssertEqual(rec["judgment"] as? String, "correct")
        // 再试一次：成功，弹层关闭，结果行换成「已改为写错」，只改这一次
        sheet.apply()
        try await waitUntil("sheet closed") { vc.changeSheetForTesting == nil && vc.presentedViewController == nil }
        let st = try await state()
        XCTAssertEqual(records(st).count, 1, "不多算一次")
        rec = try XCTUnwrap(records(st).first)
        XCTAssertEqual(rec["judgment"] as? String, "wrong")
        XCTAssertEqual((rec["corrections"] as? [Any])?.count, 1)
        XCTAssertEqual(sessionA(st)?["cursor"] as? Int, 1, "当前字不动")
        XCTAssertEqual(vc.lineTextForTesting, copy["R-W10.lineChangedWrong"]?.components(separatedBy: " \u{00B7} ").first?.replacingOccurrences(of: "{char}", with: char))
        XCTAssertTrue(vc.changeShownForTesting, "改过的行仍可再改")
        // 落笔后结果行与「修改 ›」收起（D19）
        vc.nativeInkDidEndStroke(try XCTUnwrap(vc.inkViewForTesting), raw: Self.stroke)
        XCTAssertFalse(vc.changeShownForTesting)
        XCTAssertFalse(vc.lineShownForTesting)
    }

    func testChangeIsClosedForARecordThatIsNoLongerTheLine() async throws {
        let vc = try await startGroup()
        try await judgeFirstCard(vc, "wrong")
        let allRecs = try await recs()
        let rid = try XCTUnwrap(allRecs.first?["id"] as? String)
        // 第二个字也判断了：第一条不再是结果行，op 回 stale，「修改 ›」不开放
        try await judgeFirstCard(vc, "correct")
        let r = await call("correct", ["slot": "A", "recordId": rid, "to": "correct", "action": "apply"])
        XCTAssertFalse(r.ok)
        XCTAssertEqual(r.errorKind, "stale")
        let st = try await state()
        let rec = try XCTUnwrap(records(st).first { ($0["id"] as? String) == rid })
        XCTAssertEqual(rec["judgment"] as? String, "wrong", "没动")
    }

    // MARK: 工具

    private func findButton(_ root: UIView, id: String) -> UIButton? {
        if let b = root as? UIButton, b.accessibilityIdentifier == id { return b }
        for s in root.subviews { if let b = findButton(s, id: id) { return b } }
        return nil
    }
}
