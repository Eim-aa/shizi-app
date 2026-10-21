import XCTest

// QA-H1：写字流程确认单（docs/engineering/v10/B2-写字流程确认单.md）2–7 段与恢复，原生写字页上的真实触摸路线。
// 数据：「这次选的字」5 字组（永 和 春 日 月，B 槽，有「跳过」「结束这组」），由 -shizi-qa-seed 注入到指定状态。
// 每步断言：页面（探针 native.shown / route.top）、文案（原生元素名称）、按钮状态（isEnabled）、store（记录条数与种类、会话 cursor / 阶段 / 笔数）。
// 对应 AI 流程报告「已验证正常的路径」1–8、11（KnownIssueTests 里的 VerifiedPathIndex 有编号对照）。

@MainActor
final class WriteFlowTests: XCTestCase {
    override func setUp() async throws {
        continueAfterFailure = false
    }

    // MARK: §2 回忆阶段

    /// §2：页头 ‹ / 进度 / 结束这组 / 跳过；撤销 / 清空；提示 / 看答案；写好了（没写不能点）。落笔、撤销、清空（清空后可撤销一次）。
    func test201_recallLayoutUndoClear() {
        let qa = QA(seed: "recall")
        qa.launch()
        XCTAssertTrue(qa.nativeShown)
        XCTAssertEqual(qa.el("native-write-progress").label, "第 1 个字，共 5 个")
        for id in ["native-write-back", "native-write-end", "native-write-skip", "native-write-undo", "native-write-clear", "native-write-hint", "native-write-show-answer", "native-write-done"] {
            XCTAssertTrue(qa.el(id).exists, "\(id) shown")
        }
        XCTAssertEqual(qa.el("native-write-end").label, "结束这组")
        XCTAssertEqual(qa.el("native-write-skip").label, "跳过")
        XCTAssertEqual(qa.el("native-write-done").label, "写好了")
        XCTAssertFalse(qa.el("native-write-done").isEnabled, "写好了 disabled before any stroke")
        qa.stroke()
        XCTAssertTrue(qa.el("native-write-done").isEnabled, "写好了 enabled after a stroke")
        qa.waitProbe("stroke written back (P52)") { (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["strokes"] as? Int == 1 }
        qa.stroke(from: CGVector(dx: 0.5, dy: 0.2), to: CGVector(dx: 0.5, dy: 0.8))
        qa.tapNative("native-write-undo")
        XCTAssertEqual(qa.native["strokes"] as? Int, 1, "undo removes one stroke")
        qa.tapNative("native-write-clear")
        qa.waitProbe("cleared") { (($0["native"] as? [String: Any])?["strokes"] as? Int) == 0 }
        XCTAssertFalse(qa.el("native-write-done").isEnabled)
        qa.tapNative("native-write-undo")
        qa.waitProbe("undo after clear restores once") { (($0["native"] as? [String: Any])?["strokes"] as? Int) == 1 }
        XCTAssertEqual(qa.records, 0, "writing records nothing")
    }

    /// §2：左上「‹」= 离开，回到来源（首页），现场在（再进回到同一字、同一笔迹）。
    func test202_recallBackKeepsTheSceneAndReturnsToSource() {
        let qa = QA(seed: "recall-ink")
        qa.launch()
        XCTAssertEqual(qa.native["strokes"] as? Int, 2)
        qa.tapNative("native-write-back")
        qa.waitNative(false)
        qa.waitRouteTop("home")
        XCTAssertEqual(qa.session()["strokes"] as? Int, 2, "strokes kept in the session (P52)")
        XCTAssertEqual(qa.session()["cursor"] as? Int, 0)
        XCTAssertEqual(qa.records, 0)
    }

    /// §2 / N3：左缘右滑 = 左上「‹」（回忆阶段 = 离开）。
    func test203_recallEdgeSwipeLeaves() {
        let qa = QA(seed: "recall-ink")
        qa.launch()
        qa.edgeBack()
        qa.waitNative(false)
        qa.waitRouteTop("home")
        XCTAssertTrue(qa.transitions.contains { $0.hasPrefix("dismiss:slide") }, "interactive slide back: \(qa.transitions)")
        XCTAssertEqual(qa.session()["strokes"] as? Int, 2)
    }

    // MARK: §3 提示

    /// §3（D64 ①）：每点一次多给一段，可点到整字；整字给完按钮变灰、记看过答案。
    func test301_hintStepsUpToTheWholeChar() {
        let qa = QA(seed: "recall")
        qa.launch()
        let hint = qa.el("native-write-hint")
        qa.tap(hint, "提示")
        qa.waitProbe("1 hint") { (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["hints"] as? Int == 1 }
        var taps = 1
        while !hint.label.contains("用完") && taps < 10 {
            qa.tap(hint, "提示")
            taps += 1
        }
        XCTAssertTrue(hint.label.contains("用完"), "hint button greyed (提示已用完) after the whole char: \(hint.label)")
        qa.waitProbe("whole char = answer seen") { ($0["kinds"] as? [String: Int])?["answer-seen"] == 1 }
        XCTAssertGreaterThanOrEqual(qa.session()["hints"] as? Int ?? 0, 2)
    }

    // MARK: §4 看答案

    /// §4（D64 ②）：看答案 → 描一遍（记为看过答案。主按钮凭记忆写、另有下一个）→ 凭记忆写（再描一遍 / 下一个）→ 下一个。
    func test401_showAnswerTraceRetraceNext() {
        let qa = QA(seed: "recall")
        qa.launch()
        qa.tapNative("native-write-show-answer")
        qa.waitProbe("trace") { (($0["native"] as? [String: Any])?["phase"] as? String) == "trace" }
        XCTAssertEqual(qa.kinds["answer-seen"], 1)
        XCTAssertTrue(qa.el("native-write-progress").label.contains("描一遍"), qa.el("native-write-progress").label)
        XCTAssertTrue(qa.textContaining("记为看过答案").exists)
        XCTAssertEqual(qa.el("native-write-trace-done").label, "凭记忆写")
        XCTAssertTrue(qa.el("native-write-answer-next").exists, "下一个 in the help row")
        Thread.sleep(forTimeInterval: 1.8) // 笔顺快放 ≤ 1.6s
        qa.stroke()
        qa.tapNative("native-write-trace-done")
        qa.waitProbe("retrace") { (($0["native"] as? [String: Any])?["phase"] as? String) == "retrace" }
        XCTAssertEqual(qa.native["strokes"] as? Int, 0, "凭记忆写 starts on an empty grid")
        XCTAssertEqual(qa.el("native-write-retrace").label, "再描一遍")
        XCTAssertEqual(qa.el("native-write-next").label, "下一个")
        qa.stroke()
        qa.tapNative("native-write-next")
        qa.waitProbe("next card") { (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["cursor"] as? Int == 1 }
        XCTAssertEqual(qa.kinds["judged"] ?? 0, 0, "看答案 does not judge")
        XCTAssertEqual(qa.el("native-write-progress").label, "第 2 个字，共 5 个")
    }

    /// §4：描一遍阶段杀进程重开，恢复到描一遍（AI 流程报告已验证路径 5）。
    func test402_traceRestoresAfterRelaunch() {
        let qa = QA(seed: "trace")
        qa.launch()
        XCTAssertEqual(qa.native["phase"] as? String, "trace")
        qa.relaunchWithoutSeed()
        qa.waitNative(true, timeout: 15)
        XCTAssertEqual(qa.native["phase"] as? String, "trace", "back in 描一遍 after relaunch")
    }

    // MARK: §5 判断页

    /// §5：写好了 → 判断页（写对了吗？两键）；「‹ 接着写」回到书写格、笔迹原样；左缘滑回同样。
    func test501_judgeBackAndEdgeKeepInk() {
        let qa = QA(seed: "recall-ink")
        qa.launch()
        qa.tapNative("native-write-done")
        qa.waitProbe("compare") { (($0["native"] as? [String: Any])?["phase"] as? String) == "compare" }
        XCTAssertTrue(qa.el("native-write-progress").label.contains("写对了吗"), "title: \(qa.el("native-write-progress").label)")
        XCTAssertEqual(qa.el("native-write-wrong").label, "写错了")
        XCTAssertEqual(qa.el("native-write-correct").label, "写对了")
        qa.tapNative("native-write-back")
        qa.waitProbe("recall again") { (($0["native"] as? [String: Any])?["phase"] as? String) == "recall" }
        XCTAssertEqual(qa.native["strokes"] as? Int, 2, "ink kept")
        qa.tapNative("native-write-done")
        qa.waitProbe("compare 2") { (($0["native"] as? [String: Any])?["phase"] as? String) == "compare" }
        qa.edgeBack()
        qa.waitProbe("recall via edge") { (($0["native"] as? [String: Any])?["phase"] as? String) == "recall" }
        XCTAssertTrue(qa.nativeShown, "edge in the judge phase = 接着写, not leave")
        XCTAssertEqual(qa.native["strokes"] as? Int, 2)
        XCTAssertEqual(qa.records, 0)
    }

    /// §5：判断后直接下一字；格下「「永」记为写错 · 修改 ›」；记录一条、FSRS 写入。
    func test502_judgeAdvancesAndShowsTheLine() {
        let qa = QA(seed: "judge")
        qa.launch()
        qa.tapNative("native-write-wrong")
        qa.waitProbe("advanced") { (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["cursor"] as? Int == 1 }
        XCTAssertEqual(qa.probe["judgedWrong"] as? Int, 1)
        XCTAssertEqual(qa.probe["sched"] as? Int, 1)
        XCTAssertEqual(qa.el("native-write-progress").label, "第 2 个字，共 5 个")
        XCTAssertTrue(qa.el("native-write-line").label.contains("记为写错"), "line: \(qa.el("native-write-line").label)")
        XCTAssertTrue(qa.el("native-write-line-change").exists, "修改 › shown")
        XCTAssertEqual(qa.native["phase"] as? String, "recall")
    }

    /// §5（D19）：「修改 ›」改判弹层 → 改为写对：只改这一次，记录条数不变。
    func test503_changeSheetFlipsOnlyThisOnce() {
        let qa = QA(seed: "line")
        qa.launch()
        let change = qa.el("native-write-line-change")
        XCTAssertTrue(change.waitForExistence(timeout: 5))
        change.tap() // 按钮本身（热区）——文字中心那一点见 KnownIssueTests NP-01
        XCTAssertTrue(qa.el("native-change-title").waitForExistence(timeout: 5), "change sheet shown")
        XCTAssertTrue(qa.el("native-change-title").label.contains("永"))
        qa.tapNative("native-change-flip")
        qa.waitProbe("flipped") { ($0["judgedCorrect"] as? Int) == 1 && ($0["judgedWrong"] as? Int) == 0 }
        XCTAssertEqual(qa.records, 1, "no extra record")
        XCTAssertFalse(qa.el("native-change-title").exists, "sheet closed")
        XCTAssertTrue(qa.el("native-write-line").label.contains("写对"), "line: \(qa.el("native-write-line").label)")
    }

    // MARK: §6 跳过

    /// §6：跳过直接生效；「已跳过「永」· 撤销」；撤销回到被跳过的字。
    func test601_skipAndUndo() {
        let qa = QA(seed: "recall")
        qa.launch()
        // 撤销窗口只有 5 秒：跳过后立刻读撤销条、点撤销，store 断言放在后面
        qa.el("native-write-skip").tap()
        let text = qa.el("native-write-undo-text")
        XCTAssertTrue(text.waitForExistence(timeout: 3), "undo bar shown")
        XCTAssertTrue(text.label.contains("已跳过「永」"), text.label)
        qa.tapUndoBar()
        qa.waitProbe("undone") { ($0["kinds"] as? [String: Int])?["skipped"] == nil && (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["cursor"] as? Int == 0 }
        XCTAssertEqual(qa.el("native-write-progress").label, "第 1 个字，共 5 个")
        // 再跳过一次、不撤销：记一条 skipped、推进到第 2 字
        Thread.sleep(forTimeInterval: 0.6)
        qa.tapNative("native-write-skip")
        qa.waitProbe("skipped") { ($0["kinds"] as? [String: Int])?["skipped"] == 1 && (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["cursor"] as? Int == 1 }
    }

    /// §6 / §8：最后一字跳过 → 直接结果页（无中间页），撤销条跟到结果页，5 秒内撤销回到写字页同一字。
    func test602_skipTheLastCharGoesToResultWithUndo() {
        let qa = QA(seed: "last")
        qa.launch()
        XCTAssertEqual(qa.el("native-write-progress").label, "第 5 个字，共 5 个")
        qa.tapNative("native-write-skip")
        qa.waitNative(false)
        qa.waitRouteTop("result")
        let undo = qa.button("撤销")
        XCTAssertTrue(undo.waitForExistence(timeout: 3), "skip undo handed to the result page (S4)")
        undo.tap()
        qa.waitNative(true)
        qa.waitProbe("back on the last char") { (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["cursor"] as? Int == 4 }
        XCTAssertEqual(qa.kinds["skipped"] ?? 0, 0)
    }

    // MARK: §7 结束这组

    /// §7：零判断 → 结束 → 回到来源页（首页），不进结果页。
    func test701_endWithZeroJudgedReturnsToSource() {
        let qa = QA(seed: "recall")
        qa.launch()
        qa.tapNative("native-write-end")
        XCTAssertTrue(qa.el("native-write-end-body").waitForExistence(timeout: 3), "confirm dialog")
        XCTAssertEqual(qa.el("native-write-end-confirm").label, "结束这组")
        XCTAssertEqual(qa.el("native-write-end-continue").label, "接着写")
        qa.tapNative("native-write-end-confirm")
        qa.waitNative(false)
        qa.waitRouteTop("home")
        XCTAssertEqual(qa.session()["ended"] as? Bool ?? true, true)
    }

    /// §7：有判断 → 结束 → 结果页。
    func test702_endWithJudgedGoesToResult() {
        let qa = QA(seed: "end-dialog")
        qa.launch()
        XCTAssertTrue(qa.el("native-write-end-body").waitForExistence(timeout: 3))
        qa.tapNative("native-write-end-confirm")
        qa.waitNative(false)
        qa.waitRouteTop("result")
        XCTAssertEqual(qa.probe["judgedWrong"] as? Int, 1)
    }

    /// §7：「接着写」关掉确认框，留在原字。
    func test703_endDialogContinueStays() {
        let qa = QA(seed: "end-dialog")
        qa.launch()
        qa.tapNative("native-write-end-continue")
        XCTAssertFalse(qa.el("native-write-end-body").exists)
        XCTAssertTrue(qa.nativeShown)
        XCTAssertEqual(qa.session()["cursor"] as? Int, 1)
    }

    // MARK: §8 写完 → 结果页

    /// §8：最后一字判断后直接换成结果页（淡出，无中间页）；记录 5 条。
    func test801_lastJudgeGoesStraightToResult() {
        let qa = QA(seed: "last-judge")
        qa.launch()
        qa.tapNative("native-write-correct")
        qa.waitNative(false)
        qa.waitRouteTop("result")
        XCTAssertEqual(qa.probe["judgedWrong"] as? Int ?? 0 + (qa.probe["judgedCorrect"] as? Int ?? 0), qa.probe["judgedWrong"] as? Int ?? 0)
        XCTAssertEqual((qa.probe["judgedWrong"] as? Int ?? 0) + (qa.probe["judgedCorrect"] as? Int ?? 0), 5)
        XCTAssertTrue(qa.transitions.contains("dismiss:fade"), "fade to the result page: \(qa.transitions)")
    }

    // MARK: 恢复

    /// 杀进程重开：回到原来那个字、原来的笔迹（确认单 §1「写到一半离开」/ Q32）。
    func test901_killAndRelaunchRestoresCardAndInk() {
        let qa = QA(seed: "recall-ink")
        qa.launch()
        let key = qa.native["cardKey"] as? String
        qa.relaunchWithoutSeed()
        qa.waitNative(true, timeout: 15)
        XCTAssertEqual(qa.native["cardKey"] as? String, key)
        XCTAssertEqual(qa.native["strokes"] as? Int, 2)
        XCTAssertTrue(qa.transitions.contains { $0.contains("animate=false") }, "cold restore without animation: \(qa.transitions)")
    }

    /// 判断页杀进程重开：回到判断页（W10）。
    func test902_killInJudgeRestoresJudge() {
        let qa = QA(seed: "judge")
        qa.launch()
        qa.relaunchWithoutSeed()
        qa.waitNative(true, timeout: 15)
        XCTAssertEqual(qa.native["phase"] as? String, "compare")
        XCTAssertEqual(qa.native["strokes"] as? Int, 2)
    }
}
