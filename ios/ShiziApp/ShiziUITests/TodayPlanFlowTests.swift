import XCTest

// S2 调度规则 v2「一天的练习」（D83；docs/product/调度规则v2-一天的练习.md）的流程：真实触摸写字 → 判断，探针核对会话与今天的账。
// 夹具：today-plan（首练写过、每组 5 字、第二天早上；今天的练习还没开始）、today-picked（同上，另开了 2 个字的自选组并进了写字页）、
// mine-records（「我的」页，有记录）。
@MainActor
final class TodayPlanFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func waitHome(_ qa: QA, file: StaticString = #filePath, line: UInt = #line) {
        qa.waitProbe("native home shown", timeout: 25, file: file, line: line) { p in
            let r = (p["stage"] as? [String: Any])?["root"] as? [String: Any]
            return r?["screen"] as? String == "home" && r?["hidden"] as? Bool == false && (p["navRunning"] as? Int) == 0
                && ((p["route"] as? [String: Any])?["depth"] as? Int) == 0
        }
        Thread.sleep(forTimeInterval: 0.6) // 新状态 0.4s 防误点
    }

    /// 首页主按钮进写字页（第一下落在防误点窗口里时再点一次，同 HomeFlowTests）。
    private func start(_ qa: QA, file: StaticString = #filePath, line: UInt = #line) {
        qa.tapNative("native-home-start", file: file, line: line)
        for attempt in 0..<2 {
            let end = Date().addingTimeInterval(attempt == 0 ? 5 : 15)
            while Date() < end {
                if qa.nativeShown { return }
                Thread.sleep(forTimeInterval: 0.25)
            }
            Thread.sleep(forTimeInterval: 1.0)
            if qa.nativeShown { return }
            qa.tapNative("native-home-start", file: file, line: line)
        }
        qa.waitNative(true, timeout: 10, file: file, line: line)
    }

    private func queue(_ qa: QA, _ slot: String = "A") -> [String] { qa.session(slot)["queue"] as? [String] ?? [] }
    private func today(_ qa: QA) -> [String: Any] { qa.probe["today"] as? [String: Any] ?? [:] }

    /// 写一笔 →「写好了」→ 判断（写对 / 写错），等推进到下一字或结果页。
    private func write(_ qa: QA, _ judgment: String, slot: String = "A", file: StaticString = #filePath, line: UInt = #line) {
        let before = qa.session(slot)["cursor"] as? Int ?? -1
        qa.stroke(file: file, line: line)
        qa.tapNative("native-write-done", file: file, line: line)
        qa.waitProbe("judge page", file: file, line: line) { (($0["native"] as? [String: Any])?["phase"] as? String) == "compare" }
        Thread.sleep(forTimeInterval: 1.0) // 判断两键就绪
        qa.tapNative("native-write-\(judgment)", file: file, line: line)
        qa.waitProbe("judged \(judgment)", file: file, line: line) { p in
            ((p["sessions"] as? [String: Any])?[slot] as? [String: Any])?["cursor"] as? Int == before + 1 || ((p["result"] as? [String: Any])?["shown"] as? Bool) == true
        }
        Thread.sleep(forTimeInterval: 0.6)
    }

    /// 写错的字隔 3 个字回来；第 2 次又错再隔 3 个（后面不够放最后）；第 3 次还错 = 明天再来；重考不写记录、不动复习日期。
    func testRetryLoopComesBackThreeLaterAndTheThirdFailIsTomorrow() {
        let qa = QA(seed: "today-plan")
        qa.launch()
        waitHome(qa)
        XCTAssertEqual(qa.el("native-home-today").label, "今天的练习 0 / 5")
        start(qa)
        let q0 = queue(qa)
        XCTAssertEqual(q0.count, 5, "today's practice = one group of 5")
        let key = q0[0]
        write(qa, "wrong")
        XCTAssertEqual(queue(qa).count, 6)
        XCTAssertEqual(queue(qa)[4], key, "back after 3 chars")
        XCTAssertEqual(qa.el("native-write-progress").label, "第 2 个字，共 6 个")
        for _ in 0..<3 { write(qa, "correct") }
        XCTAssertEqual(qa.session("A")["attempt"] as? Int, 2, "the retry")
        write(qa, "wrong")
        XCTAssertEqual(queue(qa).count, 7)
        XCTAssertEqual(queue(qa).last, key, "fewer than 3 left → last")
        write(qa, "correct")
        XCTAssertEqual(qa.session("A")["attempt"] as? Int, 3, "the third attempt")
        write(qa, "wrong")
        qa.waitResult(true)
        XCTAssertEqual(qa.records, 3 + 5, "retries write no records")
        XCTAssertEqual(qa.probe["judgedWrong"] as? Int, 1, "the schedule follows the first attempt only")
        XCTAssertTrue(qa.text("今天完成了").waitForExistence(timeout: 4))
        XCTAssertTrue(qa.el("native-result-sub").label.contains("明天再来 1"), qa.el("native-result-sub").label)
        XCTAssertEqual(today(qa)["done"] as? Bool, true)
    }

    /// 写完今天的练习 → 结果页「今天完成了」+ 汇总；回首页「今天完成了 ✓」，主按钮「再来一组」开同样字数的额外一组，「今天完成了」不变。
    func testCompletionShowsTodayDoneThenAnotherGroup() {
        let qa = QA(seed: "today-plan")
        qa.launch()
        waitHome(qa)
        start(qa)
        for _ in 0..<5 { write(qa, "correct") }
        qa.waitResult(true)
        XCTAssertTrue(qa.text("今天完成了").waitForExistence(timeout: 4))
        XCTAssertEqual(qa.el("native-result-sub").label, "写对 5、重考过关 0、明天再来 0、新学 5 个字")
        XCTAssertEqual(qa.el("native-result-primary").label, "再来一组")
        qa.tapNative("native-result-close")
        qa.waitResult(false)
        waitHome(qa)
        XCTAssertEqual(qa.el("native-home-done").label, "今天完成了 ✓")
        XCTAssertTrue(qa.el("native-home-start").label.contains("再来一组"), qa.el("native-home-start").label)
        start(qa)
        XCTAssertEqual(qa.session("A")["extra"] as? Bool, true, "an extra group")
        XCTAssertEqual(queue(qa).count, 5, "same size")
        XCTAssertEqual(today(qa)["done"] as? Bool, true, "today stays done")
    }

    /// 「我的」新字比例：行右值 + 选择弹层，四个档位，选一项即写并关。
    func testTierSettingSheetSavesTheChoice() {
        let qa = QA(seed: "mine-records")
        qa.launch()
        qa.waitProbe("native mine") { (($0["stage"] as? [String: Any])?["root"] as? [String: Any])?["screen"] as? String == "mine" && ($0["navRunning"] as? Int) == 0 }
        Thread.sleep(forTimeInterval: 0.6)
        let row = qa.el("native-mine-mix-tier")
        XCTAssertTrue(row.waitForExistence(timeout: 6))
        if !row.isHittable {
            let s = qa.app.coordinate(withNormalizedOffset: CGVector(dx: 0.03, dy: 0.72)), e = qa.app.coordinate(withNormalizedOffset: CGVector(dx: 0.03, dy: 0.32))
            s.press(forDuration: 0.05, thenDragTo: e, withVelocity: 600, thenHoldForDuration: 0.05)
            Thread.sleep(forTimeInterval: 0.5)
        }
        XCTAssertEqual(row.value as? String, "均衡", "default tier")
        qa.tapNative("native-mine-mix-tier")
        XCTAssertTrue(qa.el("native-mine-mix-tier-sheet").waitForExistence(timeout: 6))
        let opts = qa.app.buttons.matching(identifier: "native-mine-mix-tier-sheet-option")
        XCTAssertEqual(opts.count, 4)
        Thread.sleep(forTimeInterval: 0.5)
        qa.tap(opts.element(boundBy: 2), "sheet › 巩固为主")
        qa.waitProbe("tier saved") { ($0["settings"] as? [String: Any])?["mixTier"] as? String == "review" }
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: qa.el("native-mine-mix-tier-sheet"))
        waitForExpectations(timeout: 6)
        XCTAssertEqual(qa.el("native-mine-mix-tier").value as? String, "巩固为主")
    }

    /// 自选里写过的字（只算第一次）计入今天的进度，今天的练习相应少排。
    func testPickedPracticeCountsTowardToday() {
        let qa = QA(seed: "today-picked")
        qa.launch()
        qa.waitNative(true, timeout: 15)
        write(qa, "correct", slot: "B")
        write(qa, "wrong", slot: "B")
        XCTAssertEqual(queue(qa, "B").count, 3, "the wrong char comes back (last)")
        write(qa, "correct", slot: "B")
        qa.waitResult(true)
        XCTAssertEqual(today(qa)["n"] as? Int, 2, "two first attempts in the picked group")
        XCTAssertTrue(qa.el("native-result-sub").label.contains("重考过关 1"), qa.el("native-result-sub").label)
        qa.tapNative("native-result-close")
        qa.waitResult(false)
        waitHome(qa)
        XCTAssertEqual(qa.el("native-home-today").label, "今天的练习 2 / 5")
        start(qa)
        XCTAssertEqual(queue(qa).count, 3, "today's practice shrinks by the picked chars")
        XCTAssertEqual(today(qa)["target"] as? Int, 5)
    }
}
