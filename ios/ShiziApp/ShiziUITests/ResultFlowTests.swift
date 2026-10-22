import XCTest

// B2.7：原生结果页的流程（写字流程确认单 §8；D19 / D20 / D66 ③ ④ / D70；S4 跳过撤销交接）。
// 数据经探针（qa-probe）：result = 原生结果页（shown / variant / cells / rows / undoBar / sheet / invite / sealed），其余同 QAApp.swift。

@MainActor
final class ResultFlowTests: XCTestCase {
    override func setUp() async throws {
        continueAfterFailure = false
    }

    /// §8：写完最后一字（判断）→ 写字页淡成原生结果页（无中间页，不再淡出到网页结果页）；记录 5 条、印落下（sealedAt）。
    func test811_lastJudgeFadesIntoTheNativeResult() {
        let qa = QA(seed: "last-judge")
        qa.launch()
        qa.tapNative("native-write-correct")
        qa.waitResult(true)
        XCTAssertFalse(qa.nativeShown, "the native write page is gone")
        qa.waitRouteTop("result")
        XCTAssertTrue(qa.transitions.contains("dismiss:fade"), "\(qa.transitions)")
        XCTAssertTrue(qa.transitions.contains { $0.hasPrefix("result:open via=write") }, "\(qa.transitions)")
        XCTAssertEqual(qa.records, 5)
        XCTAssertEqual(qa.resultInfo["variant"] as? String, "picked")
        XCTAssertTrue(qa.el("native-result-work").waitForExistence(timeout: 3))
        qa.waitProbe("sealed") { (($0["result"] as? [String: Any])?["sealed"] as? Bool) == true }
    }

    /// §8：左上「×」回来源（首页），lastEnded 清掉；左缘右滑同一个动作。
    func test812_closeAndEdgeBackReturnToTheSource() {
        let qa = QA(seed: "result")
        qa.launch()
        qa.waitResult(true)
        XCTAssertEqual(qa.el("native-result-close").label, "关闭")
        qa.tapNative("native-result-close")
        qa.waitResult(false)
        qa.waitRouteTop("home")
        XCTAssertEqual(qa.records, 5)

        let qa2 = QA(seed: "result")
        qa2.launch()
        qa2.waitResult(true)
        qa2.edgeBack()
        qa2.waitResult(false)
        qa2.waitRouteTop("home")
        XCTAssertTrue(qa2.transitions.contains { $0.hasPrefix("dismiss:slide") }, "slides out to the right: \(qa2.transitions)")
    }

    /// §8 / D70：「再写一组」→ 新写字页（原生）→ 返回回首页。
    func test813_againThenBackGoesHome() {
        let qa = QA(seed: "result-daily")
        qa.launch()
        qa.waitResult(true)
        XCTAssertEqual(qa.el("native-result-primary").label, "再写一组")
        qa.tapNative("native-result-primary")
        qa.waitNative(true)
        XCTAssertFalse(qa.resultShown)
        XCTAssertEqual(qa.session("A")["cursor"] as? Int, 0, "a new group")
        qa.tapNative("native-write-back")
        qa.waitNative(false)
        qa.waitRouteTop("home") // D70
    }

    /// D19 / D66 ④：写错那一行「修改 ›」→ 对照与改判弹层 →「改为写对」：只改这一次（记录条数不变、写错数 −1）。
    func test814_changeFlipsOnlyThisOnce() {
        let qa = QA(seed: "result-daily")
        qa.launch()
        qa.waitResult(true)
        let before = qa.records
        let wrong = qa.probe["judgedWrong"] as? Int ?? 0
        XCTAssertGreaterThan(wrong, 0)
        qa.tapNative("native-result-row-change")
        XCTAssertTrue(qa.el("native-change-flip").waitForExistence(timeout: 4), "the change sheet")
        XCTAssertEqual(qa.el("native-change-flip").label, "改为写对")
        qa.tapNative("native-change-flip")
        qa.waitProbe("flipped") { ($0["judgedWrong"] as? Int) == wrong - 1 }
        XCTAssertEqual(qa.records, before, "D19: no extra record")
        qa.waitProbe("sheet closed") { (($0["result"] as? [String: Any])?["sheet"] as? Bool) == false }
        XCTAssertTrue(qa.resultShown)
    }

    /// §6 / S4：最后一字跳过 → 原生结果页带着写字页交过来的撤销条；撤销 → 回到写字页那个字。
    func test815_skipUndoIsHandedOverAndStillUndoes() {
        let qa = QA(seed: "last")
        qa.launch()
        qa.tapNative("native-write-skip")
        qa.waitResult(true)
        qa.waitProbe("undo bar on the result page") { (($0["result"] as? [String: Any])?["undoBar"] as? Bool) == true }
        qa.tapUndoBar()
        qa.waitNative(true)
        qa.waitProbe("back on the last char") { (($0["sessions"] as? [String: Any])?["B"] as? [String: Any])?["cursor"] as? Int == 4 }
        XCTAssertEqual(qa.kinds["skipped"] ?? 0, 0)
        XCTAssertFalse(qa.resultShown)
    }

    /// §9 入口：「重写错字」推入（网页重写错字页，B2.9 换原生）；返回时原生结果页重新盖上。
    func test816_redoEntersAndComesBack() {
        let qa = QA(seed: "result-daily")
        qa.launch()
        qa.waitResult(true)
        qa.tapNative("native-result-redo")
        qa.waitRouteTop("redo")
        qa.waitResult(false)
        qa.edgeBack()
        qa.waitRouteTop("result")
        qa.waitResult(true)
        XCTAssertTrue(qa.transitions.contains { $0.hasPrefix("result:open via=return") }, "\(qa.transitions)")
    }

    /// 冷启动恢复：停在结果页杀进程重开 → 原生结果页直接盖上（不带转场），同一组。
    func test817_coldRestoreShowsTheSameResult() {
        let qa = QA(seed: "result")
        qa.launch()
        qa.waitResult(true)
        let sid = qa.resultInfo["sessionId"] as? String
        qa.relaunchWithoutSeed()
        qa.waitResult(true, timeout: 15)
        XCTAssertEqual(qa.resultInfo["sessionId"] as? String, sid)
        XCTAssertTrue(qa.transitions.contains { $0.hasPrefix("result:open via=restore animate=false") }, "\(qa.transitions)")
    }

    /// 首练结果页：标题、提醒邀请（落印后淡入）、「完成」离开。
    func test818_firstPracticeInviteThenDone() {
        let qa = QA(seed: "result-first")
        qa.launch()
        qa.waitResult(true)
        XCTAssertEqual(qa.resultInfo["variant"] as? String, "first")
        qa.waitProbe("invite shown") { (($0["result"] as? [String: Any])?["invite"] as? String) == "invite" }
        XCTAssertTrue(qa.el("native-result-invite-yes").exists)
        qa.tapNative("native-result-invite-no")
        qa.waitProbe("invite gone") { (($0["result"] as? [String: Any])?["invite"] as? String) == "gone" }
        XCTAssertEqual(qa.el("native-result-primary").label, "完成")
        qa.tapNative("native-result-primary")
        qa.waitResult(false)
        qa.waitRouteTop("home")
    }
}
