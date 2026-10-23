import XCTest

// B3.3 流程测试骨架（B3B4 §5.2 · 字库）：每个用例先「待办」（XCTSkip），由 B3.5b / B3.8 的页面卡填实。
// 填的时候：用 QA(seed: "<夹具状态>") 一键到起点（夹具在 ShiziUITests/States/），数据经探针断言；把 try QAPending.skip(…) 换成真实步骤即可，不改别的文件。

@MainActor
final class LibraryFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    // B3.5b：原生字库首页（tab 根页，root-pending：夹具的 nativeRoots 步骤打开它）。网页路由仍是真相源，探针 stage.screens 是原生栈。
    private func stageScreens(_ qa: QA) -> [String] { ((qa.probe["stage"] as? [String: Any])?["screens"] as? [String]) ?? [] }

    private func waitStage(_ qa: QA, _ want: [String], file: StaticString = #filePath, line: UInt = #line) {
        qa.waitProbe("stage \(want)", file: file, line: line) { (($0["stage"] as? [String: Any])?["screens"] as? [String]) == want && ($0["navRunning"] as? Int) == 0 }
    }

    /// 搜索框 → 查字弹层（lookup）：原生根页把样子交给宿主层、让开，网页的查字弹层在它上面。
    func testSearchOpensQuery() throws {
        let qa = QA(seed: "library-records")
        qa.launch()
        waitStage(qa, ["library"])
        qa.tapNative("native-library-query-open")
        waitStage(qa, [])
        qa.waitProbe("query overlay over the library") { (($0["route"] as? [String: Any])?["overlay"] as? Bool) == true }
        XCTAssertEqual(qa.route["top"] as? String, "library")
    }

    /// 今日练习行 → 原生根页发 library.startToday，网页路由开写字页（写入成功才推进，D07）；写字页盖上来。
    func testTodayPracticeRowPaperTransition() throws {
        let qa = QA(seed: "library-records")
        qa.launch()
        waitStage(qa, ["library"])
        let before = qa.records
        qa.tapNative("native-library-today")
        qa.waitRouteTop("write")
        XCTAssertEqual(qa.records, before, "opening the group writes a session, not a record")
        XCTAssertFalse(qa.session("A").isEmpty, "the A group is open")
    }

    /// 开组写入失败（D07）：原生页不动，就地三段式；「先不保存」收起。
    func testTodayPracticeFailureThreeStage() throws {
        let qa = QA(seed: "library-records", failNext: 1)
        qa.launch()
        waitStage(qa, ["library"])
        qa.tapNative("native-library-today")
        XCTAssertTrue(qa.el("native-library-today-fail-note").waitForExistence(timeout: 4))
        XCTAssertEqual(qa.route["top"] as? String, "library")
        XCTAssertEqual(stageScreens(qa), ["library"])
        qa.tapNative("native-library-today-fail-cancel")
        XCTAssertFalse(qa.el("native-library-today-fail-note").waitForExistence(timeout: 1.5))
    }

    /// 三档 → 区详情（网页页面）→ 左缘返回 → 原生字库按原样盖回。
    func testTierToListToPickedSession() throws {
        let qa = QA(seed: "library-records")
        qa.launch()
        waitStage(qa, ["library"])
        qa.tap(qa.el("native-library-zone"), "first zone row")
        qa.waitRouteTop("library-list")
        waitStage(qa, [])
        qa.edgeBack()
        qa.waitRouteTop("library")
        waitStage(qa, ["library"])
        XCTAssertTrue(qa.el("native-library-range").waitForExistence(timeout: 4))
    }

    /// 全部字：排序 / 筛选 / 查找
    func testAllCharsSortFilterFind() throws { try QAPending.skip("B3.5b / B3.8", "全部字：排序 / 筛选 / 查找") }

    /// 全部字：params 冷启动恢复
    func testAllCharsParamsColdRestore() throws { try QAPending.skip("B3.5b / B3.8", "全部字：params 冷启动恢复") }

    /// 换库成功即返回（不提示）
    func testSwitchLibrarySuccessReturnsAtOnce() throws { try QAPending.skip("B3.5b / B3.8", "换库成功即返回（不提示）") }

    /// 换库失败三段式
    func testSwitchLibraryFailureThreeStage() throws { try QAPending.skip("B3.5b / B3.8", "换库失败三段式") }
}
