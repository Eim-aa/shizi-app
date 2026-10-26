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
        XCTAssertEqual(titleOf(lookup), "查字")
        XCTAssertTrue(lookup.el("native-query-input").exists, "the query field")
        XCTAssertFalse(lookup.el("native-query-bar").exists, "no pick bar in lookup mode")

        // 输入一个字：出字卡（原生重拉 view.query，模型与网页同一份）
        let input = lookup.el("native-query-input")
        input.tap()
        input.typeText("永")
        XCTAssertTrue(lookup.el("native-query-card").waitForExistence(timeout: 8 * QALoad.scale), "the card of the typed char")
        XCTAssertEqual(lookup.el("native-query-card-word").label, "永远", "the card shows the word")

        let pick0 = QA(seed: "query-pick-0")
        pick0.launch()
        waitSheet(pick0)
        XCTAssertEqual(titleOf(pick0), "自己选字")
        XCTAssertTrue(pick0.el("native-query-bar").exists, "the pick bar")
        XCTAssertTrue(pick0.el("native-query-go").exists, "the pick button")
        XCTAssertEqual(pick0.el("native-query-go").label, "先选字", "nothing picked: the button says so")
        XCTAssertFalse(pick0.el("native-query-go").isEnabled, "nothing picked: the button is disabled")

        let pick1 = QA(seed: "query-pick-1")
        pick1.launch()
        waitSheet(pick1)
        XCTAssertEqual(pick1.el("native-query-go").label, "练这个字", "one picked")
        XCTAssertTrue(pick1.el("native-query-go").isEnabled)

        let pickN = QA(seed: "query-pick-n")
        pickN.launch()
        waitSheet(pickN)
        XCTAssertEqual(pickN.el("native-query-go").label, "练这 3 个字", "three picked")
    }

    /// 自己选字：点行首的勾选圈 → 底栏从「先选字」变成「练这个字」（原生重拉 view.query，selected 一起带上）。
    func testPickSelectsChar() {
        let qa = QA(seed: "query-pick-0")
        qa.launch()
        waitSheet(qa)
        XCTAssertEqual(qa.el("native-query-go").label, "先选字")
        qa.tap(qa.el("native-query-row-select"), "the first row's checkbox")
        XCTAssertTrue(qa.el("native-query-go").waitForExistence(timeout: 8 * QALoad.scale))
        XCTAssertEqual(qa.el("native-query-go").label, "练这个字", "one char picked")
        XCTAssertTrue(qa.el("native-query-go").isEnabled, "one char picked: the button is live")
    }

    /// 加入自选：一次 commit；成功不弹提示，按钮自己变成禁用的「已自选」（网页同一份 commitAdd）。
    func testAddSuccessTurnsButtonIntoAlreadyAdded() {
        let qa = QA(seed: "query-card")
        qa.launch()
        waitSheet(qa)
        let add = qa.el("native-query-card-add")
        XCTAssertTrue(add.waitForExistence(timeout: 8 * QALoad.scale), "the add button")
        XCTAssertEqual(add.label, "加入自选")
        qa.tap(add, "加入自选")
        XCTAssertTrue(qa.el("native-query-card-add").waitForExistence(timeout: 8 * QALoad.scale))
        XCTAssertEqual(qa.el("native-query-card-add").label, "已自选", "already in the list")
        XCTAssertFalse(qa.el("native-query-card-add").isEnabled, "the button is greyed out")
        XCTAssertFalse(qa.el("native-query-card-add-fail-note").exists, "no failure block on success")
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

    /// 加入失败三段式：说明 + [先不加 | 再试一次]；输入与卡片留着。
    func testAddFailureThreeStage() {
        let qa = QA(seed: "query-add-fail")
        qa.launch()
        waitSheet(qa)
        XCTAssertTrue(qa.el("native-query-card").exists, "the card is still there")
        XCTAssertTrue(qa.el("native-query-card-add-fail-note").exists, "the note")
        XCTAssertTrue(qa.el("native-query-card-add-fail-cancel").exists, "先不加")
        XCTAssertTrue(qa.el("native-query-card-add-fail-retry").exists, "再试一次")
        XCTAssertTrue(qa.el("native-query-input").exists, "the input is still there")
    }

    /// S02 三键：接着写 / 开新一组 / 取消；取消关框不写入。
    func testS02ThreeButtons() {
        let qa = QA(seed: "s02")
        qa.launch()
        XCTAssertTrue(qa.el("native-s02-dialog").waitForExistence(timeout: 20 * QALoad.scale), "the S02 dialog")
        XCTAssertTrue(qa.el("native-s02-body").exists, "the body")
        XCTAssertTrue(qa.el("native-s02-continue").exists, "接着写")
        XCTAssertTrue(qa.el("native-s02-end-start").exists, "开新一组")
        XCTAssertTrue(qa.el("native-s02-cancel").exists, "取消")
        // 取消：关框、不写入（探针里的会话不变）
        let before = qa.session("B")
        qa.tap(qa.el("native-s02-cancel"), "cancel")
        let end = Date().addingTimeInterval(8 * QALoad.scale)
        while Date() < end && qa.el("native-s02-dialog").exists { Thread.sleep(forTimeInterval: 0.2) }
        XCTAssertFalse(qa.el("native-s02-dialog").exists, "the dialog is closed")
        let after = qa.session("B")
        XCTAssertEqual(after["cursor"] as? Int, before["cursor"] as? Int, "nothing was written")
    }
}
