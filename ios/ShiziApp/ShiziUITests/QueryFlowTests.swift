import XCTest

// B3.6 查字弹层与 S02 的流程测试（B3B4 §5.2 · QueryFlowTests）。
// 起点用夹具（ShiziUITests/States/）：QA(seed: "<状态>") 一键到起点——夹具的 setup 已经把弹层打开（原生查字弹层 / 原生 S02）。
// 断言：原生元素经 accessibilityIdentifier（native-query-* / native-s02-*）找；数据经探针（qa-probe 的 value 是 store 摘要）。
@MainActor
final class QueryFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// 弹层（或确认框）在屏上。
    private func waitSheet(_ qa: QA, _ id: String = "native-query-sheet", timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(qa.el(id).waitForExistence(timeout: timeout * QALoad.scale), "\(id) exists", file: file, line: line)
    }

    /// 弹层不在屏上（关掉了）。
    private func waitSheetGone(_ qa: QA, _ id: String = "native-query-sheet", file: StaticString = #filePath, line: UInt = #line) {
        let end = Date().addingTimeInterval(8 * QALoad.scale)
        while Date() < end {
            if !qa.el(id).exists { return }
            Thread.sleep(forTimeInterval: 0.2)
        }
        XCTFail("\(id) is still on screen", file: file, line: line)
    }

    /// 弹层标题（查字 / 自己选字）：原生用 copy 键渲染（X-QUERY / R-Q01），文案与网页一字不差。
    private func titleOf(_ qa: QA, file: StaticString = #filePath, line: UInt = #line) -> String {
        let el = qa.el("native-query-title")
        XCTAssertTrue(el.exists, "the sheet title", file: file, line: line)
        return el.label
    }

    /// lookup / pick 两种模式：标题、输入框、底栏按钮与禁用态；lookup 里输入一个字会出字卡。
    func testLookupAndPickModes() {
        let lookup = QA(seed: "query-empty")
        lookup.launch()
        waitSheet(lookup)
        XCTAssertEqual(titleOf(lookup), "\u{67E5}\u{5B57}")
        XCTAssertTrue(lookup.el("native-query-input").exists, "the query field")
        XCTAssertFalse(lookup.el("native-query-bar").exists, "no pick bar in lookup mode")

        // 输入一个字：出字卡（原生重拉 view.query，模型与网页同一份）
        let input = lookup.el("native-query-input")
        input.tap()
        input.typeText("\u{6C38}")
        XCTAssertTrue(lookup.el("native-query-card").waitForExistence(timeout: 8 * QALoad.scale), "the card of the typed char")
        XCTAssertEqual(lookup.el("native-query-card-word").label, "\u{6C38}\u{8FDC}", "the card shows the word")

        let pick0 = QA(seed: "query-pick-0")
        pick0.launch()
        waitSheet(pick0)
        XCTAssertEqual(titleOf(pick0), "\u{81EA}\u{5DF1}\u{9009}\u{5B57}")
        XCTAssertTrue(pick0.el("native-query-bar").exists, "the pick bar")
        XCTAssertTrue(pick0.el("native-query-go").exists, "the pick button")
        XCTAssertEqual(pick0.el("native-query-go").label, "\u{5148}\u{9009}\u{5B57}", "nothing picked: the button says so")
        XCTAssertFalse(pick0.el("native-query-go").isEnabled, "nothing picked: the button is disabled")

        let pick1 = QA(seed: "query-pick-1")
        pick1.launch()
        waitSheet(pick1)
        XCTAssertEqual(pick1.el("native-query-go").label, "\u{7EC3}\u{8FD9}\u{4E2A}\u{5B57}", "one picked")
        XCTAssertTrue(pick1.el("native-query-go").isEnabled)

        let pickN = QA(seed: "query-pick-n")
        pickN.launch()
        waitSheet(pickN)
        XCTAssertEqual(pickN.el("native-query-go").label, "\u{7EC3}\u{8FD9} 3 \u{4E2A}\u{5B57}", "three picked")
    }

    /// 自己选字：点行首的勾选圈 → 底栏从「先选字」变成「练这个字」（原生重拉 view.query，selected 一起带上）。
    func testPickSelectsChar() {
        let qa = QA(seed: "query-pick-0")
        qa.launch()
        waitSheet(qa)
        XCTAssertEqual(qa.el("native-query-go").label, "\u{5148}\u{9009}\u{5B57}")
        qa.tap(qa.el("native-query-row-select"), "the first row's checkbox")
        XCTAssertTrue(qa.el("native-query-go").waitForExistence(timeout: 8 * QALoad.scale))
        XCTAssertEqual(qa.el("native-query-go").label, "\u{7EC3}\u{8FD9}\u{4E2A}\u{5B57}", "one char picked")
        XCTAssertTrue(qa.el("native-query-go").isEnabled, "one char picked: the button is live")
    }

    /// 加入自选：一次 commit；成功不弹提示，按钮自己变成禁用的「已自选」（网页同一份 commitAdd）。
    func testAddSuccessTurnsButtonIntoAlreadyAdded() {
        let qa = QA(seed: "query-card")
        qa.launch()
        waitSheet(qa)
        let add = qa.el("native-query-card-add")
        XCTAssertTrue(add.waitForExistence(timeout: 8 * QALoad.scale), "the add button")
        XCTAssertEqual(add.label, "\u{52A0}\u{5165}\u{81EA}\u{9009}")
        qa.tap(add, "\u{52A0}\u{5165}\u{81EA}\u{9009}")
        XCTAssertTrue(qa.el("native-query-card-add").waitForExistence(timeout: 8 * QALoad.scale))
        XCTAssertEqual(qa.el("native-query-card-add").label, "\u{5DF2}\u{81EA}\u{9009}", "already in the list")
        XCTAssertFalse(qa.el("native-query-card-add").isEnabled, "the button is greyed out")
        XCTAssertFalse(qa.el("native-query-card-add-fail-note").exists, "no failure block on success")
    }

    /// R16（主控决定）：弹层下面的内容读屏摸不到——透明的查字弹层开着时，字库根页的行与网页 Tab 栏都不在无障碍树里；关掉弹层后回来。
    func testSheetHidesTheRootFromVoiceOver() {
        let qa = QA(seed: "query-empty")
        qa.launch()
        waitSheet(qa)
        XCTAssertTrue(qa.el("native-query-input").exists, "the sheet itself stays reachable")
        for id in ["native-library-title", "native-library-all-open", "native-library-query-open", "native-library-range"] {
            XCTAssertFalse(qa.el(id).exists, "\(id) under the sheet is out of the accessibility tree")
        }
        XCTAssertFalse(qa.app.webViews.firstMatch.exists, "the web content under the sheet is out of the accessibility tree")
        XCTAssertFalse(qa.app.tabBars.buttons["字库"].exists, "B3.5d: the native tab bar under the sheet is out of the accessibility tree")
        qa.tap(qa.el("native-query-done"), "done")
        waitSheetGone(qa)
        XCTAssertTrue(qa.el("native-library-all-open").waitForExistence(timeout: 8 * QALoad.scale), "the root is back in the accessibility tree once the sheet is gone")
        XCTAssertTrue(qa.app.tabBars.buttons["字库"].waitForExistence(timeout: 4), "B3.5d: the native tab bar is back too")
        XCTAssertFalse(qa.app.webViews.firstMatch.exists, "B3.5d: the web under the native root (only the root host) stays hidden from VoiceOver")
    }

    /// 键盘抬起时四个出口（完成 / 遮罩 / 下滑 / 左缘）都能关掉弹层。
    func testKeyboardUpFourExitsStartAtOnce() {
        // 1.「完成」
        let done = QA(seed: "query-empty")
        done.launch()
        waitSheet(done)
        XCTAssertTrue(done.el("native-query-done").exists, "the done button")
        done.tap(done.el("native-query-done"), "done")
        waitSheetGone(done)

        // 2. 点遮罩（弹层之上、页面之下）
        let scrim = QA(seed: "query-empty")
        scrim.launch()
        waitSheet(scrim)
        scrim.app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 200, dy: 90)).tap()
        waitSheetGone(scrim)

        // 3. 下滑（跟手；松手过阈值就关）
        let drag = QA(seed: "query-empty")
        drag.launch()
        waitSheet(drag)
        let w = drag.app.windows.firstMatch.frame.width
        let start = drag.app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: w / 2, dy: 220))
        let end = drag.app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: w / 2, dy: 620))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: 900, thenHoldForDuration: 0)
        Thread.sleep(forTimeInterval: 1.2)
        waitSheetGone(drag)

        // 4. 左缘右滑（N3：= 点左上）
        let edge = QA(seed: "query-empty")
        edge.launch()
        waitSheet(edge)
        edge.edgeBack()
        waitSheetGone(edge)
    }

    /// 中文输入法组字中不提前查：框里是拼音，弹层还停在「没输入」那一态（没有逐字行）。
    func testImeComposingDoesNotQueryEarly() {
        let qa = QA(seed: "query-ime")
        qa.launch()
        waitSheet(qa)
        XCTAssertTrue(qa.el("native-query-input").exists, "the query field")
        let rows = qa.el("native-query-rows")
        XCTAssertFalse(rows.exists, "composing pinyin is not searched yet")
        XCTAssertTrue(qa.el("native-query-hint").exists, "still the hint state")
    }

    /// 加入失败三段式：说明 + [先不加 | 再试一次]；输入与卡片留着。「先不加」回到卡片按钮；再点「加入自选」这次写进去。
    func testAddFailureThreeStage() {
        let qa = QA(seed: "query-add-fail")
        qa.launch()
        waitSheet(qa)
        XCTAssertTrue(qa.el("native-query-card").exists, "the card is still there")
        XCTAssertTrue(qa.el("native-query-card-add-fail-note").exists, "the note")
        XCTAssertEqual(qa.el("native-query-card-add-fail-note").label, "\u{6CA1}\u{52A0}\u{8FDB}\u{81EA}\u{9009}\u{FF0C}\u{8F93}\u{5165}\u{7684}\u{5B57}\u{8FD8}\u{5728}\u{3002}")
        XCTAssertTrue(qa.el("native-query-card-add-fail-cancel").exists, "\u{5148}\u{4E0D}\u{52A0}")
        XCTAssertTrue(qa.el("native-query-card-add-fail-retry").exists, "\u{518D}\u{8BD5}\u{4E00}\u{6B21}")
        XCTAssertTrue(qa.el("native-query-input").exists, "the input is still there")
        XCTAssertFalse(qa.el("native-query-card-add").exists, "the add button gives its place to the failure block")
        // 「先不加」：三段式收起，卡片按钮回来，什么都没写
        qa.tapNative("native-query-card-add-fail-cancel")
        XCTAssertTrue(qa.el("native-query-card-add").waitForExistence(timeout: 5 * QALoad.scale), "the add button is back")
        XCTAssertFalse(qa.el("native-query-card-add-fail-note").exists, "the failure block is gone")
        XCTAssertEqual(qa.el("native-query-card-add").label, "\u{52A0}\u{5165}\u{81EA}\u{9009}")
        // 再点「加入自选」：这次写进去（夹具只让第一次失败），按钮变成禁用的「已自选」
        qa.tapNative("native-query-card-add")
        let end = Date().addingTimeInterval(8 * QALoad.scale)
        while Date() < end && qa.el("native-query-card-add").label != "\u{5DF2}\u{81EA}\u{9009}" { Thread.sleep(forTimeInterval: 0.2) }
        XCTAssertEqual(qa.el("native-query-card-add").label, "\u{5DF2}\u{81EA}\u{9009}", "added this time")
    }

    /// 加入失败后「再试一次」= 同一个动作再做一次（夹具只让第一次失败）：三段式收起，按钮变成「已自选」。
    func testAddFailureRetry() {
        let qa = QA(seed: "query-add-fail")
        qa.launch()
        waitSheet(qa)
        XCTAssertTrue(qa.el("native-query-card-add-fail-retry").waitForExistence(timeout: 5 * QALoad.scale))
        qa.tapNative("native-query-card-add-fail-retry")
        XCTAssertTrue(qa.el("native-query-card-add").waitForExistence(timeout: 8 * QALoad.scale), "the add button is back")
        XCTAssertEqual(qa.el("native-query-card-add").label, "\u{5DF2}\u{81EA}\u{9009}", "the retry wrote it")
        XCTAssertFalse(qa.el("native-query-card-add-fail-note").exists, "the failure block is gone")
    }

    /// S02「开新一组」写失败：留在框内三段式（说明 + [先不保存 | 再试一次]）；「先不保存」关框、什么都没写。
    func testS02FailureStaysInTheBox() {
        let qa = QA(seed: "s02-fail")
        qa.launch()
        XCTAssertTrue(qa.el("native-s02-dialog").waitForExistence(timeout: 20 * QALoad.scale), "the S02 dialog")
        XCTAssertTrue(qa.el("native-s02-fail").exists, "the three-part block")
        XCTAssertEqual(qa.el("native-s02-body").label, "\u{6CA1}\u{4FDD}\u{5B58}\u{4E0A}\u{FF0C}\u{521A}\u{624D}\u{7684}\u{9009}\u{62E9}\u{6CA1}\u{8BB0}\u{4E0B}\u{3002}")
        XCTAssertTrue(qa.el("native-s02-retry").exists, "\u{518D}\u{8BD5}\u{4E00}\u{6B21}")
        XCTAssertFalse(qa.el("native-s02-continue").exists, "the three buttons give their place to the block")
        let before = qa.session("B")
        qa.tapNative("native-s02-fail-cancel")
        let end = Date().addingTimeInterval(8 * QALoad.scale)
        while Date() < end && qa.el("native-s02-dialog").exists { Thread.sleep(forTimeInterval: 0.2) }
        XCTAssertFalse(qa.el("native-s02-dialog").exists, "the dialog is closed")
        XCTAssertEqual(qa.session("B")["cursor"] as? Int, before["cursor"] as? Int, "nothing was written")
        XCTAssertEqual(qa.route["top"] as? String, "home", "back on the home page")
    }

    /// S02 三键：接着写 / 开新一组 / 取消；取消关框不写入。
    func testS02ThreeButtons() {
        let qa = QA(seed: "s02")
        qa.launch()
        XCTAssertTrue(qa.el("native-s02-dialog").waitForExistence(timeout: 20 * QALoad.scale), "the S02 dialog")
        XCTAssertTrue(qa.el("native-s02-body").exists, "the body")
        XCTAssertTrue(qa.el("native-s02-continue").exists, "\u{63A5}\u{7740}\u{5199}")
        XCTAssertTrue(qa.el("native-s02-end-start").exists, "\u{5F00}\u{65B0}\u{4E00}\u{7EC4}")
        XCTAssertTrue(qa.el("native-s02-cancel").exists, "\u{53D6}\u{6D88}")
        // 取消：关框、不写入（探针里的会话不变）
        let before = qa.session("B")
        qa.tap(qa.el("native-s02-cancel"), "cancel")
        let end = Date().addingTimeInterval(8 * QALoad.scale)
        while Date() < end && qa.el("native-s02-dialog").exists { Thread.sleep(forTimeInterval: 0.2) }
        XCTAssertFalse(qa.el("native-s02-dialog").exists, "the dialog is closed")
        let after = qa.session("B")
        XCTAssertEqual(after["cursor"] as? Int, before["cursor"] as? Int, "nothing was written")
    }

    /// 字卡「练这个字」（查字，R-Q07）：写字页推在弹层上面；从写字页返回回到同一张字卡（输入还在），「完成」再关掉弹层回到字库。
    func testPracticeFromCardReturnsToTheCard() {
        let qa = QA(seed: "query-card")
        qa.launch()
        waitSheet(qa)
        qa.tapNative("native-query-card-practice")
        qa.waitNative(true, timeout: 20)
        XCTAssertEqual(qa.route["top"] as? String, "write", "the write page is on top of the sheet")
        qa.tapNative("native-write-back")
        qa.waitNative(false, timeout: 20)
        qa.waitProbe("back on the sheet") { (($0["route"] as? [String: Any])?["top"] as? String) == "query" && (($0["stage"] as? [String: Any])?["screens"] as? [String]) == ["query"] }
        XCTAssertTrue(qa.el("native-query-card").waitForExistence(timeout: 8 * QALoad.scale), "the same card again")
        XCTAssertEqual(qa.el("native-query-card-word").label, "\u{6C38}\u{8FDC}", "the card of the same char")
        qa.tapNative("native-query-done")
        waitSheetGone(qa)
        qa.waitProbe("back on the library") { (($0["route"] as? [String: Any])?["top"] as? String) == "library" }
    }

    /// 自己选字「练这个字」：网页回调先关弹层（api.close）再开写字页——弹层出栈，写字页在上面；返回回到首页（与网页同）。
    func testPickPracticeClosesTheSheetFirst() {
        let qa = QA(seed: "query-pick-1")
        qa.launch()
        waitSheet(qa)
        qa.tapNative("native-query-go")
        qa.waitNative(true, timeout: 20)
        qa.waitProbe("the sheet left the stack") { p in
            ((p["stage"] as? [String: Any])?["screens"] as? [String] ?? []).isEmpty && ((p["route"] as? [String: Any])?["top"] as? String) == "write"
        }
        qa.tapNative("native-write-back")
        qa.waitNative(false, timeout: 20)
        qa.waitProbe("back on the home page") { (($0["route"] as? [String: Any])?["top"] as? String) == "home" }
        XCTAssertFalse(qa.el("native-query-sheet").exists, "the sheet does not come back")
    }
}
