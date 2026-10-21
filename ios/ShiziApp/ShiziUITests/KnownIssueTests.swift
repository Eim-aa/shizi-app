import XCTest

// QA-H1：两份 AI 测试报告里要真实点按才能查的条目（逐屏对比能查的 NP-* 在 scripts/native-ui/parity-checks.mjs）。
//   QAIssue.expectFail = 预期失败（待修）：现在失败不算回归；修好后 XCTest 报「意外通过」，修复卡把包装去掉转成普通断言。
// 报告：qa-flow/报告.md（NF-01…NF-05 + 已验证正常的路径 1–13）、qa-parity/报告.md（NP-01…NP-21）。
// 负责人决定 D70：NF-02 返回回首页（普通断言，EntryFlowTests.test106）；NF-05 凭记忆写的笔迹不存（R9-C 修好，普通断言）。
//
// 「已验证正常的路径」1–13 → 本 target 里的通过用例：
//   1 首练开始→判断→下一字→结果行      EntryFlowTests.test101 + WriteFlowTests.test502
//   2 判断页 ‹ / 左缘回到回忆、笔迹在      WriteFlowTests.test501
//   3 回忆左缘回首页、继续写字、进度数    EntryFlowTests.test101 / test102、WriteFlowTests.test203
//   4 提示一段段到整字                    WriteFlowTests.test301
//   5 看答案→描一遍→凭记忆写→下一个、阶段恢复  WriteFlowTests.test401 / test402
//   6 跳过 / 撤销、最后一字跳过→结果页撤销   WriteFlowTests.test601 / test602
//   7 结束这组（零判断回来源 / 有判断结果页） WriteFlowTests.test701 / test702 / test703
//   8 写字页改判弹层                      WriteFlowTests.test503
//   9 结果页出口回来源                    EntryFlowTests.test107
//   10 字库 / 区详情 / 字详情 / 查字入口推入与返回  EntryFlowTests.test103 / test104 / test105 / test109
//   11 中断恢复（杀进程重开）              WriteFlowTests.test901 / test902
//   12 首页 / 字库数字同步                 EntryFlowTests.test102 / test103
//   13 查字弹层练这个字                    EntryFlowTests.test109

@MainActor
final class KnownIssueTests: XCTestCase {
    override func setUp() async throws {
        continueAfterFailure = true
    }

    // MARK: NP（逐屏一致性报告）

    /// NP-01（高）：结果行「修改 ›」整个 44pt 热区（D19 / D46 ⑭）都能打开改判弹层。
    /// R9-B 修好（普通断言）：说明位改成可伸出边界接收点按的视图（NativeOverflowView），按钮盒照网页 44 高、上伸 4。
    func testNP01_changeLinkWholeHitArea() {
        let qa = QA(seed: "line")
        qa.launch()
        let button = qa.el("native-write-line-change")
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        let f = button.frame
        let origin = qa.app.coordinate(withNormalizedOffset: .zero)
        // 文字中心：现状能点开（对照）
        origin.withOffset(CGVector(dx: f.midX, dy: f.midY)).tap()
        XCTAssertTrue(qa.el("native-change-title").waitForExistence(timeout: 3), "text centre opens the sheet")
        qa.tapNative("native-change-cancel")
        Thread.sleep(forTimeInterval: 0.8)
        // 热区上沿往下 6pt（仍在 44pt 热区里）
        origin.withOffset(CGVector(dx: f.midX, dy: f.minY + 6)).tap()
        let opened = qa.el("native-change-title").waitForExistence(timeout: 3)
        XCTAssertTrue(opened, "tap at (\(f.midX), \(f.minY + 6)) inside the 44pt hit area opens the change sheet")
    }

    /// NP-06（高 · 报告未能验证）：判断保存失败 → 三段式：说明「没保存上，你写的字还在。」→「先不保存」→「再试一次」；重试成功只记一次（D07）。
    func testNP06_judgeSaveFailureThreeSteps() {
        let qa = QA(seed: "judge", failNext: 1)
        qa.launch()
        Thread.sleep(forTimeInterval: 0.6)
        qa.tapNative("native-write-wrong")
        XCTAssertTrue(qa.textContaining("没保存上").waitForExistence(timeout: 4), "save-failed note")
        XCTAssertTrue(qa.el("native-write-fail-cancel").exists, "先不保存")
        XCTAssertTrue(qa.el("native-write-fail-retry").exists, "再试一次")
        XCTAssertEqual(qa.records, 0, "nothing recorded")
        XCTAssertEqual(qa.session()["cursor"] as? Int, 0, "did not advance")
        qa.tapNative("native-write-fail-retry")
        qa.waitProbe("retry records once") { ($0["records"] as? Int) == 1 }
        XCTAssertEqual(qa.session()["cursor"] as? Int, 1)
    }

    // MARK: NF（流程报告）

    /// NF-01（高 · 已知 B2.8）：首页入口应是「纸展开 / 缩回」一个动作（D62），现状原生推入、网页纸展开叠播。
    func testNF01_homeEntryUsesThePaperTransition() {
        let qa = QA(seed: "home-mid")
        qa.launch()
        qa.tap(qa.buttonContaining("继续写字"), "继续写字")
        qa.waitNative(true)
        let t = qa.transitions
        XCTAssertTrue(t.contains { $0.hasPrefix("open via=home") }, "home entry: \(t)")
        qa.tapNative("native-write-back")
        qa.waitNative(false)
        let back = qa.transitions
        Thread.sleep(forTimeInterval: 1.0) // 已知问题的断言放在页面静止之后（失败时 XCTest 取界面快照，动画中会卡住）
        QAIssue.expectFail("NF-01", "首页入口仍是原生推入（present:slide），与网页纸展开叠播；返回先滑出再缩回；B2.8 做 D62 纸展开") {
            XCTAssertFalse(t.contains("present:slide"), "home entry must not slide in: \(t)")
            XCTAssertFalse(back.contains("dismiss:slide"), "home exit must fold back into the button, not slide out: \(back)")
        }
    }

    /// NF-03（低，R9-C 改文案、原生照 API 取）：「结束这组」确认框文案与确认单 §7 一致。普通断言。
    func testNF03_endDialogCopyMatchesTheChecklist() {
        let qa = QA(seed: "end-dialog")
        qa.launch()
        let body = qa.el("native-write-end-body")
        XCTAssertTrue(body.waitForExistence(timeout: 4))
        XCTAssertEqual(body.label, "还有 4 个字没写，结束后就不写了。判断过的 1 个字已经记下。")
    }

    /// NF-04（低）：结果页「重写错字」应是原生页（确认单 §9 沿用写字页）；现状仍是网页。
    func testNF04_redoPageIsNative() {
        let qa = QA(seed: "result-daily")
        qa.launch()
        qa.waitRouteTop("result")
        qa.tap(qa.buttonContaining("重写错字"), "重写错字")
        Thread.sleep(forTimeInterval: 1.2)
        let shown = qa.nativeShown
        QAIssue.expectFail("NF-04", "重写错字页仍是网页版（B2.9）") {
            XCTAssertTrue(shown, "redo page is native")
        }
    }

    /// NF-05（D70，R9-C 已修）：看答案后「凭记忆写」的笔迹不存（不进作品「看后写的」、不进字库缩略图），网页与原生都一样。普通断言。
    func testNF05_retraceInkIsNotSaved() {
        let qa = QA(seed: "recall")
        qa.launch()
        qa.tapNative("native-write-show-answer")
        qa.waitProbe("trace") { (($0["native"] as? [String: Any])?["phase"] as? String) == "trace" }
        Thread.sleep(forTimeInterval: 1.8)
        qa.tapNative("native-write-trace-done")
        qa.waitProbe("retrace") { (($0["native"] as? [String: Any])?["phase"] as? String) == "retrace" }
        qa.stroke()
        qa.tapNative("native-write-next")
        let p = qa.waitProbe("next card") { (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["cursor"] as? Int == 1 }
        let inked = p["answerSeenInk"] as? Int ?? -1
        XCTAssertEqual(inked, 0, "no ink stored for the answer-seen record")
    }
}
