import XCTest

// B3.10 提醒页流程（原生 Screens/Remind.swift，屏名 remind；网页 src/ui/screens/mine/remind.js）。
// 夹具：ShiziUITests/States/remind-*.json（网页参考、原生取证、流程测试同一份）。
// 断言：原生元素经 accessibilityIdentifier（native-remind-*）找；写入结果经界面可见变化判断（探针里没有 settings 域）。
// 纯容器（native-remind-body / native-remind-note / native-remind-fail）不是读屏元素，测试用里面的文字与按钮判断。
// QA 运行（-shizi-qa）不弹系统通知权限框、也不跳手机设置：系统面板在测试宿主里没有替代品（见 Screens/Remind.swift 的说明）。
@MainActor
final class RemindFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    // MARK: 辅助

    /// 提醒页起来（夹具把路由推到 remind）。
    private func launchRemind(_ seed: String, failNext: Int = 0, extra: [String] = [], file: StaticString = #filePath, line: UInt = #line) -> QA {
        let qa = QA(seed: seed, failNext: failNext, extra: extra)
        qa.launch()
        XCTAssertTrue(qa.el("native-remind-switch").waitForExistence(timeout: 30 * QALoad.scale), "remind page (\(seed))", file: file, line: line)
        return qa
    }

    /// 元素出现 / 消失（等一段时间；返回有没有等到）。
    @discardableResult
    private func waitExists(_ qa: QA, _ id: String, _ want: Bool, timeout: TimeInterval = 8, quiet: Bool = false, file: StaticString = #filePath, line: UInt = #line) -> Bool {
        let end = Date().addingTimeInterval(timeout * QALoad.scale)
        while Date() < end {
            if qa.el(id).exists == want { return true }
            Thread.sleep(forTimeInterval: 0.25)
        }
        if !quiet {
            XCTFail("\(id) \(want ? "没有出现" : "没有消失")", file: file, line: line)
        }
        return false
    }

    /// 点一下某个元素，并等另一个元素变成想要的样子（机器很忙时点按偶尔被吞：没效果就重点一次，最多一次）。
    private func tapUntil(_ qa: QA, _ id: String, _ wantId: String, _ want: Bool, file: StaticString = #filePath, line: UInt = #line) {
        let e = qa.el(id)
        XCTAssertTrue(e.waitForExistence(timeout: 8 * QALoad.scale), "找不到：\(id)", file: file, line: line)
        for _ in 0..<2 {
            e.tap()
            Thread.sleep(forTimeInterval: 0.6) // 换状态后 0.4s 防误点
            if waitExists(qa, wantId, want, timeout: 6, quiet: true) { return }
            QALoad.retry("tap-no-effect", "\(id) -> \(wantId)")
        }
        XCTFail("\(id)：\(wantId) \(want ? "没有出现" : "没有消失")", file: file, line: line)
    }

    // MARK: 用例

    /// 开关：关 → 开（多一行「提醒时间」）→ 关（时间行收起来）。
    /// 开着才显示时间行，是网页 settingsView 的同一条口径（on = 用户选了开 且 通知没被手机关掉）。
    func testSwitchTurnsTimeRowOnAndOff() {
        let qa = launchRemind("remind-off")
        XCTAssertFalse(qa.el("native-remind-time").exists, "关着时没有时间行")
        tapUntil(qa, "native-remind-switch", "native-remind-time", true)
        tapUntil(qa, "native-remind-switch", "native-remind-time", false)
    }

    /// 通知被手机关掉：说明 +「手机设置 ›」在；开关按 iOS 习惯显示关（没有时间行）。
    /// App 里系统通知权限是权威的（启动时真实权限会写回 store，覆盖夹具种下的 denied），所以用 QA 通道模拟：
    /// 启动参数 -shizi-qa-remind-permission denied（逐屏对比不传这个参数）。
    func testDeniedShowsNoteWithoutTimeRow() {
        let qa = launchRemind("remind-denied", extra: ["-shizi-qa-remind-permission", "denied"])
        XCTAssertTrue(qa.el("native-remind-note-text").waitForExistence(timeout: 20 * QALoad.scale), "说明正文")
        XCTAssertTrue(qa.el("native-remind-open-system").exists, "手机设置按钮")
        XCTAssertFalse(qa.el("native-remind-time").exists, "通知被关时开关显示关，没有时间行")
    }

    /// 写入失败的三段式：「先不保存」→ 说明框收起来，开关仍是关的（没写成）。
    func testWriteFailureCancelKeepsSwitchOff() {
        // 夹具 remind-fail：点开关 → 写入失败（failNext 1）
        let qa = launchRemind("remind-fail")
        XCTAssertTrue(qa.el("native-remind-fail-note").waitForExistence(timeout: 15), "失败三段式")
        XCTAssertFalse(qa.el("native-remind-time").exists, "没写成：开关还是关的")
        tapUntil(qa, "native-remind-fail-cancel", "native-remind-fail-note", false)
        XCTAssertFalse(qa.el("native-remind-time").exists, "仍然没写成")
    }

    /// 写入失败的三段式：「再试一次」→ 重跑写入，这次写成（时间行出来）。
    func testWriteFailureRetryWritesAgain() {
        let qa = launchRemind("remind-fail")
        XCTAssertTrue(qa.el("native-remind-fail-note").waitForExistence(timeout: 15), "失败三段式")
        tapUntil(qa, "native-remind-fail-retry", "native-remind-time", true)
        XCTAssertFalse(qa.el("native-remind-fail-note").exists, "写成了就没有失败块")
    }

    /// 时间：点时间框 → 时间轮 →「完成」→ 写进 store（失败时是时间这一项的三段式）；点遮罩 = 取消，不写。
    func testTimePickerConfirmsAndWrites() {
        // failNext 1：时间这一次的写入失败 → 三段式（失败的字段是时间）
        let qa = launchRemind("remind-on", failNext: 1)
        XCTAssertTrue(qa.el("native-remind-time").waitForExistence(timeout: 10), "时间行")
        let field = qa.el("native-remind-time")
        field.tap()
        XCTAssertTrue(qa.el("native-remind-time-done").waitForExistence(timeout: 8), "时间轮")
        tapUntil(qa, "native-remind-time-done", "native-remind-fail-note", true)
        // 取消：时间轮收起来，不写（点面板上方的遮罩）
        field.tap()
        XCTAssertTrue(qa.el("native-remind-time-done").waitForExistence(timeout: 8), "时间轮")
        qa.app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)).tap()
        waitExists(qa, "native-remind-time-done", false)
    }
}
