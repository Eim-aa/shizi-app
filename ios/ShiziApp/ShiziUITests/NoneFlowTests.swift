import XCTest

// B3.12「现在没有要写的字」页（原生 ShiziScreen_session_none）的流程：
// 网页路由仍是真相源（探针 route 是网页栈），stage.screens 是原生栈（底 → 顶）。
// 入口（自己选字 / 看写错过的字 / 更换字库）由网页模块登记（setNoneActions），原生页经 App API 的 session.* op 走同一批函数。
@MainActor
final class NoneFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func stage(_ qa: QA) -> [String] { ((qa.probe["stage"] as? [String: Any])?["screens"] as? [String]) ?? [] }

    private func waitStage(_ qa: QA, _ want: [String], file: StaticString = #filePath, line: UInt = #line) {
        qa.waitProbe("stage \(want)", file: file, line: line) { (($0["stage"] as? [String: Any])?["screens"] as? [String]) == want && ($0["navRunning"] as? Int) == 0 }
    }

    /// 「没有要写的字」页（自己选字）：原生页在场，空状态与底栏都在；没登记的入口不显示。
    func test910_nonePageIsNative() {
        let qa = QA(seed: "none-pick")
        qa.launch()
        waitStage(qa, ["session-none"])
        XCTAssertEqual(qa.route["top"] as? String, "session-none")
        XCTAssertTrue(qa.el("native-session-none-title").waitForExistence(timeout: 5), "空状态的标题")
        XCTAssertTrue(qa.el("native-session-none-cell").exists, "空格子")
        XCTAssertTrue(qa.el("native-session-none-body").exists, "说明")
        XCTAssertTrue(qa.el("native-session-none-pick").exists, "底栏的「自己选字」")
        // 没登记的入口不显示（不放点了没反应的按钮）
        XCTAssertFalse(qa.el("native-session-none-libswitch").exists, "没到「换范围」那一态")
        XCTAssertFalse(qa.el("native-session-none-wrong").exists, "没到「看写错过的字」那一态")
    }

    /// 「自己选字」：原生查字弹层（B3.6）推在这一页上面（不让给网页）；「完成」关掉后回到这一页。
    func test911_nonePickOpensTheNativeSheet() {
        let qa = QA(seed: "none-pick")
        qa.launch()
        waitStage(qa, ["session-none"])
        Thread.sleep(forTimeInterval: 0.5) // 新状态 0.4s 防误点
        qa.tapNative("native-session-none-pick")
        waitStage(qa, ["session-none", "query"])
        XCTAssertTrue(qa.el("native-query-sheet").waitForExistence(timeout: 5 * QALoad.scale), "the native pick sheet")
        qa.tapNative("native-query-done")
        waitStage(qa, ["session-none"])
    }

    /// 「练习范围学完」：主按钮是「换范围」，「自己选字」降为次按钮，空状态里多一段说明与「待复习 ›」。
    func test912_noneExhaustedHasLibSwitchAndWrong() {
        let qa = QA(seed: "none-exhausted")
        qa.launch()
        waitStage(qa, ["session-none"])
        XCTAssertTrue(qa.el("native-session-none-libswitch").waitForExistence(timeout: 5), "主按钮「换范围」")
        XCTAssertTrue(qa.el("native-session-none-pick").exists, "次按钮「自己选字」")
        XCTAssertTrue(qa.el("native-session-none-nochars").exists, "多出来的那一段说明")
        XCTAssertTrue(qa.el("native-session-none-wrong").exists, "「待复习 ›」")
    }
}
