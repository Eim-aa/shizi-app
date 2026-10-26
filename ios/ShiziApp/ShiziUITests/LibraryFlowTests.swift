import XCTest

// B3.5b 字库首页流程（B3B4 §5.2 LibraryFlowTests）：原生字库首页（tab 根页，夹具 op nativeRoots 打开；B3.5d 前默认关）。
// 探针：stage.root = 原生根页 {screen, hidden, page:{leaveUndo, undoVisible, failed}}；route = 网页栈（仍是真相源）；
// transitions = 原生转场记录（present:push = 普通推入，D62：从字库进写字页不是纸展开）。
// 子页（区详情 / 全部 / 换库）还是网页屏（B3.8 原生化）：原生根页先把样子交给宿主层再让开，回来时按原样盖回。
@MainActor
final class LibraryFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func root(_ qa: QA) -> [String: Any] { ((qa.probe["stage"] as? [String: Any])?["root"] as? [String: Any]) ?? [:] }
    private func page(_ p: [String: Any]) -> [String: Any] { ((p["stage"] as? [String: Any])?["root"] as? [String: Any])?["page"] as? [String: Any] ?? [:] }

    /// 原生字库首页出来、看得见、转场停了。
    private func waitLibrary(_ qa: QA, file: StaticString = #filePath, line: UInt = #line) {
        qa.waitProbe("native library shown", timeout: 25, file: file, line: line) { p in
            let r = (p["stage"] as? [String: Any])?["root"] as? [String: Any]
            return r?["screen"] as? String == "library" && r?["hidden"] as? Bool == false && (p["navRunning"] as? Int) == 0
        }
    }

    private func launchLibrary(_ seed: String) -> QA {
        let qa = QA(seed: seed)
        qa.launch()
        waitLibrary(qa)
        Thread.sleep(forTimeInterval: 0.6) // 原生页出现后 0.4s 防误点（同网页 pressGuard）
        return qa
    }

    /// 分类行进入子页：三档第一行「待复习」→ 区详情（library-list；子页还是网页的，B3.8 原生化）。
    /// 原生根页让开给网页页面，回来时按原样盖回。
    func testCategoryRowOpensZoneList() {
        let qa = launchLibrary("library-records")
        XCTAssertTrue(qa.el("native-library-zone-0").waitForExistence(timeout: 5), "the first zone row")
        qa.tapNative("native-library-zone-0")
        qa.waitRouteTop("library-list", timeout: 20)
        qa.waitProbe("root steps aside for the web page") { ((($0["stage"] as? [String: Any])?["root"] as? [String: Any])?["hidden"] as? Bool) == true }
    }

    /// 「全部 ›」进入有记录的字（library-all；同样是 nav.push，子页还是网页的）。
    func testAllButtonOpensAllPage() {
        let qa = launchLibrary("library-records")
        XCTAssertTrue(qa.el("native-library-all-open").waitForExistence(timeout: 5))
        qa.tapNative("native-library-all-open")
        qa.waitRouteTop("library-all", timeout: 20)
    }

    /// 今日练习行 → 写字页（D62：从字库进写字页是普通推入 T-push，不是纸展开）→ 返回仍是这张字库。
    func testTodayPracticeRowPushesWritePage() {
        let qa = launchLibrary("library-empty")
        qa.tapNative("native-library-today")
        qa.waitNative(true, timeout: 25)
        qa.waitRouteTop("write", timeout: 20)
        XCTAssertFalse(qa.transitions.contains("present:paper"), "D62: T-push, not the paper \(qa.transitions)")
        XCTAssertTrue(qa.transitions.contains("present:push"), "\(qa.transitions)")
        // 返回：回到同一张字库
        qa.tapNative("native-write-back")
        qa.waitNative(false, timeout: 25)
        waitLibrary(qa)
    }

    /// 搜索框 → 原生查字弹层（lookup；B3.6 Screens/Query.swift）：网页 openLibraryQuery 推入原生查字屏，盖在原生字库页上面（字库页不让开）。
    func testSearchOpensQuery() {
        let qa = launchLibrary("library-empty")
        XCTAssertTrue(qa.el("native-library-query-open").waitForExistence(timeout: 5))
        qa.tapNative("native-library-query-open")
        qa.waitProbe("native query sheet over the root") { p in
            ((p["stage"] as? [String: Any])?["screens"] as? [String]) == ["query"] && (((p["stage"] as? [String: Any])?["root"] as? [String: Any])?["hidden"] as? Bool) == false
        }
        XCTAssertTrue(qa.el("native-query-sheet").waitForExistence(timeout: 5 * QALoad.scale), "the native lookup sheet is open")
        XCTAssertEqual(qa.el("native-query-title").label, "\u{67E5}\u{5B57}", "lookup sheet title")
    }

    /// 今日练习开组失败 → 就地三段式（说明 +「先不保存」+「再试一次」）；重试成功才进写字页。
    func testTodayPracticeFailureShowsThreeStage() {
        let qa = launchLibrary("library-today-fail")
        XCTAssertEqual(page(qa.probe)["failed"] as? Bool, true, "the failure stays on the page")
        XCTAssertTrue(qa.el("native-library-today-fail-note").exists)
        XCTAssertTrue(qa.el("native-library-today-fail-cancel").exists)
        XCTAssertTrue(qa.el("native-library-today-fail-retry").exists)
        XCTAssertEqual(qa.route["top"] as? String, "library", "the page did not move")
        // 「再试一次」重跑同一个动作：这次写得进去 → 进写字页
        qa.tapNative("native-library-today-fail-retry")
        qa.waitNative(true, timeout: 25)
        qa.waitRouteTop("write", timeout: 20)
    }

    /// 离开撤销条跟到字库（写字页跳过后离开，撤销机会跟到原生字库）；点「撤销」回到那个字。
    /// 撤销机会只有 5 秒（网页 skip.js 的同一份状态）：机器忙时一次点按往返就要 1–2 秒，机会会在等的时候用完——
    /// 这一条没赶上就整串重做一次（同 QA 的负载重试做法：重试照记 QA-RETRY，产品失败不会被吞）。
    func testLeaveUndoBarFollowsToLibrary() {
        var last: [String: Any] = [:]
        for attempt in 0..<2 {
            let qa = launchLibrary("library-empty")
            qa.tapNative("native-library-today")
            qa.waitNative(true, timeout: 25)
            Thread.sleep(forTimeInterval: 0.4)
            let skip = qa.el("native-write-skip")
            XCTAssertTrue(skip.waitForExistence(timeout: 5), "the write page is up")
            skip.tap()
            let back = qa.el("native-write-back")
            XCTAssertTrue(back.waitForExistence(timeout: 5), "the write page has a back button")
            back.tap()
            let undo = qa.el("native-write-skip-undo")
            if undo.waitForExistence(timeout: 3) {
                undo.tap()
                qa.waitNative(true, timeout: 25)
                qa.waitRouteTop("write", timeout: 20)
                XCTAssertEqual(qa.session("A")["cursor"] as? Int, 0, "back on the skipped char")
                return
            }
            last = qa.probe
            QALoad.retry("leave-undo-window", "the 5s undo window closed before the check (attempt \(attempt + 1))")
            qa.app.terminate()
        }
        XCTFail("the undo bar never followed to the native library; probe = \(last)")
    }

    // B3.8：字库子页的流程用例（清单 / 全部字 / 换库）已搬到 LibrarySubFlowTests。
}
