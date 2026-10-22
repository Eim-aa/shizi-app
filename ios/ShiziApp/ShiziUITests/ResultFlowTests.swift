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

    /// §9 入口（B2.9a）：「重写错字」推入原生重写错字页；左缘右滑回到结果页，原生结果页重新淡入。
    func test816_redoEntersAndComesBack() {
        let qa = QA(seed: "result-daily")
        qa.launch()
        qa.waitResult(true)
        qa.tapNative("native-result-redo")
        qa.waitRouteTop("redo")
        qa.waitResult(false)
        qa.waitNative(true)
        XCTAssertEqual(qa.native["redo"] as? Bool, true)
        XCTAssertTrue(qa.transitions.contains { $0.hasPrefix("redo:open via=push") }, "\(qa.transitions)")
        qa.edgeBack()
        qa.waitRouteTop("result")
        qa.waitResult(true)
        XCTAssertFalse(qa.nativeShown)
        XCTAssertTrue(qa.transitions.contains { $0.hasPrefix("result:open via=return") }, "\(qa.transitions)")
    }

    /// 结果页数据摘要（只算练习：重写错字前后必须相同）。
    private func dataOf(_ qa: QA) -> String {
        let p = qa.probe
        let keys = ["records", "kinds", "judgedWrong", "judgedCorrect", "sched", "sessions", "answerSeenInk"]
        let pick = keys.reduce(into: [String: Any]()) { $0[$1] = p[$1] ?? NSNull() }
        var out = (try? JSONSerialization.data(withJSONObject: pick, options: [.sortedKeys])).flatMap { String(data: $0, encoding: .utf8) } ?? ""
        let r = qa.resultInfo
        out += " cells=\(r["cells"] ?? "") rows=\(r["rows"] ?? "") session=\(r["sessionId"] ?? "")"
        return out
    }

    /// §9（B2.9a）：原生结果页「重写错字」→ 原生重写错字页逐个写：落笔 →「写好了」→ 对照（没有判断键）→「下一个」，最后一个「完成」→ 回到原生结果页；
    /// 只算练习（D66 ③）：记录、调度、会话、结果页作品与各行都不变。
    func test819_redoWritesEveryWrongCharThenDone() {
        let qa = QA(seed: "result-daily")
        qa.launch()
        qa.waitResult(true)
        qa.waitProbe("sealed") { (($0["result"] as? [String: Any])?["sealed"] as? Bool) == true }
        let before = dataOf(qa)
        qa.tapNative("native-result-redo")
        qa.waitNative(true)
        let total = qa.native["redoTotal"] as? Int ?? 0
        XCTAssertGreaterThanOrEqual(total, 2, "result-daily has several wrong chars")
        for i in 0..<total {
            qa.waitProbe("redo char \(i)") { (($0["native"] as? [String: Any])?["redoIndex"] as? Int) == i && (($0["native"] as? [String: Any])?["phase"] as? String) == "recall" }
            XCTAssertEqual(qa.el("native-write-progress").label, "第 \(i + 1) 个字，共 \(total) 个")
            XCTAssertFalse(qa.el("native-redo-done").isEnabled, "写好了 needs a stroke")
            XCTAssertFalse(qa.el("native-write-skip").exists || qa.el("native-write-hint").exists, "no skip / hint on the redo page")
            qa.stroke()
            qa.tapNative("native-redo-done")
            qa.waitProbe("check \(i)") { (($0["native"] as? [String: Any])?["phase"] as? String) == "compare" }
            XCTAssertFalse(qa.el("native-write-wrong").exists || qa.el("native-write-correct").exists, "no judge keys")
            XCTAssertTrue(qa.el("native-redo-again").exists, "再写一次")
            let next = qa.el("native-redo-next")
            XCTAssertEqual(next.label, i == total - 1 ? "完成" : "下一个")
            qa.tap(next, "下一个 / 完成")
            Thread.sleep(forTimeInterval: 0.4)
        }
        qa.waitNative(false)
        qa.waitRouteTop("result")
        qa.waitResult(true)
        XCTAssertEqual(dataOf(qa), before, "practice only: nothing written (D66 ③)")
    }

    /// §9（B2.9a）：中途「‹」回结果页（写的阶段），再进来在对照阶段左缘右滑也回结果页（不是「接着写」）；「看答案」不写也能对照，「再写一次」回空格；数据不变。
    func test820_redoBackAndEdgeMidway() {
        let qa = QA(seed: "result-daily")
        qa.launch()
        qa.waitResult(true)
        qa.waitProbe("sealed") { (($0["result"] as? [String: Any])?["sealed"] as? Bool) == true }
        let before = dataOf(qa)
        qa.tapNative("native-result-redo")
        qa.waitNative(true)
        qa.stroke()
        qa.tapNative("native-write-back")
        qa.waitNative(false)
        qa.waitRouteTop("result")
        qa.waitResult(true)
        XCTAssertEqual(dataOf(qa), before)

        qa.tapNative("native-result-redo")
        qa.waitNative(true)
        qa.waitProbe("fresh redo page") { (($0["native"] as? [String: Any])?["redoIndex"] as? Int) == 0 && (($0["native"] as? [String: Any])?["strokes"] as? Int) == 0 }
        qa.tapNative("native-redo-show-answer")
        qa.waitProbe("check without ink") { (($0["native"] as? [String: Any])?["phase"] as? String) == "compare" }
        XCTAssertTrue(qa.el("native-write-noink").exists, "这次没写")
        qa.tapNative("native-redo-again")
        qa.waitProbe("back to an empty grid") { (($0["native"] as? [String: Any])?["phase"] as? String) == "recall" && (($0["native"] as? [String: Any])?["redoIndex"] as? Int) == 0 }
        qa.stroke()
        qa.tapNative("native-redo-done")
        qa.waitProbe("check") { (($0["native"] as? [String: Any])?["phase"] as? String) == "compare" }
        qa.edgeBack()
        qa.waitNative(false)
        qa.waitRouteTop("result")
        qa.waitResult(true)
        XCTAssertEqual(dataOf(qa), before)
    }

    /// 冷启动（B2.9a）：重写错字页只在内存里（网页 RESTORE_GUARDS.redo = false，同网页）——在重写错字页杀进程重开 → 回到首页，没有原生页，数据不变。
    func test821_redoColdStartLandsHomeLikeTheWeb() {
        let qa = QA(seed: "result-daily")
        qa.launch()
        qa.waitResult(true)
        qa.waitProbe("sealed") { (($0["result"] as? [String: Any])?["sealed"] as? Bool) == true }
        let records = qa.records
        qa.tapNative("native-result-redo")
        qa.waitNative(true)
        qa.stroke()
        Thread.sleep(forTimeInterval: 1.5) // 路由提示落盘
        qa.relaunchWithoutSeed()
        qa.waitRouteTop("home", timeout: 15)
        XCTAssertFalse(qa.nativeShown)
        XCTAssertFalse(qa.resultShown)
        XCTAssertEqual(qa.records, records)
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
