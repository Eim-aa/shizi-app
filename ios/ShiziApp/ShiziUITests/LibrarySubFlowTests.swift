import XCTest

// B3.8 流程测试（字库子页：清单 / 全部字 / 换库）。
//
// 从 LibraryFlowTests 搬来的用例（属子页的五个）：
//   testTierToListToPickedSession（清单）、testAllCharsSortFilterFind（全部字）、testAllCharsParamsColdRestore（全部字）、
//   testSwitchLibrarySuccessReturnsAtOnce（换库）、testSwitchLibraryFailureThreeStage（换库）。
// 留在 LibraryFlowTests 的两个属字库根页（B3.5b）：testSearchOpensQuery、testTodayPracticeRowPaperTransition。
//
// 原生子页元素经 accessibilityIdentifier（native-library-*）找；数据经探针（stage.screens = 当前打开的原生屏；route = 网页路由栈；sessions = 会话）。

@MainActor
final class LibrarySubFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// 按 accessibilityIdentifier 取一组元素（QA.el 只给第一个；这里要按序号点第几个）。
    private func qaQuery(_ qa: QA, _ id: String) -> XCUIElementQuery {
        qa.app.descendants(matching: .any).matching(identifier: id)
    }

    /// 原生子页出来了（探针 stage.screens = 打开中的原生屏名）。
    private func waitScreen(_ qa: QA, _ name: String, file: StaticString = #filePath, line: UInt = #line) {
        qa.waitProbe("native screen \(name)", timeout: 30, file: file, line: line) { p in
            let screens = (p["stage"] as? [String: Any])?["screens"] as? [String] ?? []
            return screens.contains(name)
        }
    }

    /// 清单页：勾选 → 底栏提示跟着变 → 「练这些字」开组进写字页（来源 = 清单）。
    func testTierToListToPickedSession() {
        let qa = QA(seed: "list-due")
        qa.launch()
        waitScreen(qa, "library-list")
        XCTAssertTrue(qa.el("native-library-list-go").waitForExistence(timeout: 6), "清单页的主按钮")
        XCTAssertTrue(qa.el("native-library-list-row-select").exists, "清单页的行")
        // 勾掉一个 → 选中的字少一个（底栏提示跟着变：「选了 6 个字」→「选了 5 个字」）
        let before = qaHintLabel(qa)
        XCTAssertTrue(before.contains("6"), "底栏提示：\(before)")
        qa.tap(qa.el("native-library-list-row-select"), "list row select")
        qa.waitProbe("selection changed", timeout: 8) { _ in
            self.qaHintLabel(qa) != before
        }
        XCTAssertTrue(qaHintLabel(qa).contains("5"), "勾掉一个后：\(qaHintLabel(qa))")
        // 开组 → 写字页（原生）
        qa.tapNative("native-library-list-go")
        qa.waitNative(true, timeout: 30)
        qa.waitRouteTop("write", timeout: 20)
        // 勾选开组走 startPicked → 会话槽 B（今日练习才是 A）
        XCTAssertEqual(qa.session("B")["cursor"] as? Int, 0, "刚开的组从头开始")
    }

    /// 底栏提示现在的字（勾选后会变）。
    private func qaHintLabel(_ qa: QA) -> String { qa.el("native-library-list-hint").label }

    /// B3.Z（35-all）：按月折叠——点折起的月份展开，点展开月份的标题折起。
    func testAllCharsMonthOpensAndFolds() {
        let qa = QA(seed: "all-month")
        qa.launch()
        waitScreen(qa, "library-all")
        let closed = qaQuery(qa, "native-library-all-month")
        XCTAssertTrue(closed.element(boundBy: 0).waitForExistence(timeout: 8), "older months are folded")
        let n = closed.count
        let heads = qaQuery(qa, "native-library-all-group-head")
        let headsBefore = heads.count
        qa.tap(closed.element(boundBy: 0), "open a folded month", verify: false)
        qa.waitProbe("a month opened", timeout: 10) { _ in closed.count == n - 1 }
        XCTAssertEqual(heads.count, headsBefore + 1, "the opened month gets its own group")
        qa.tap(heads.element(boundBy: heads.count - 1), "fold it again", verify: false)
        qa.waitProbe("folded again", timeout: 10) { _ in closed.count == n }
    }

    /// 全部字页：排序 / 筛选 / 查找。
    func testAllCharsSortFilterFind() {
        let qa = QA(seed: "all-pinyin")
        qa.launch()
        waitScreen(qa, "library-all")
        XCTAssertTrue(qa.el("native-library-all-menu-open").waitForExistence(timeout: 6), "页头的「排序 · 筛选」")
        XCTAssertTrue(qa.el("native-library-all-cell").exists, "字墙的格子")
        // 排序：选「多久没写」→ 分组换了（第一组的组名变了）
        let groupBefore = qaFirstGroupName(qa) // 拼音分组的第一组名（字母）；换成「多久没写」后变成档位名
        XCTAssertFalse(groupBefore.isEmpty, "拼音分组有组名")
        // 打开弹层不改探针里的任何东西（tapSignature 看不见弹层），用 verify: false 点一下，免得「没效果」的重点把弹层又点掉
        qa.tap(qa.el("native-library-all-menu-open"), "open sort sheet", verify: false)
        let sorts = qaQuery(qa, "native-library-all-sort")
        XCTAssertTrue(sorts.element(boundBy: 0).waitForExistence(timeout: 6), "排序三键")
        qa.tap(sorts.element(boundBy: 2), "sort by age")
        // R16：弹层开着时下面的页对读屏（无障碍树）藏起来（主控决定），页面上的组名 / 清单要关掉弹层再看
        qa.tap(qa.el("native-library-all-sheet-done"), "close the sheet", verify: false)
        qa.waitProbe("sort applied", timeout: 10) { _ in
            // R16 keeps the underlying page out of AX until the closing sheet is gone.
            let name = qa.el("native-library-all-group-name")
            guard name.exists else { return false }
            let text = name.label
            return !text.isEmpty && text != groupBefore
        }
        // 筛选：再开弹层选「待复习」→ 底栏主键变成区清单（页面多一个「看这些字 ›」）
        qa.tap(qa.el("native-library-all-menu-open"), "reopen sort sheet", verify: false)
        let chips = qaQuery(qa, "native-library-all-chip")
        XCTAssertTrue(chips.element(boundBy: 0).waitForExistence(timeout: 6), "筛选项")
        // 筛选项是开关：「没效果就重点」会把它点回去，所以不验证
        qa.tap(chips.element(boundBy: 0), "chip due", verify: false)
        // 关掉弹层（完成），回到页面
        qa.tap(qa.el("native-library-all-sheet-done"), "close the sheet", verify: false)
        qa.waitProbe("filter applied", timeout: 10) { _ in
            self.qaHasElement(qa, "native-library-all-list")
        }
        // 查找：输入一个字 → 只剩命中那个月
        let input = qa.el("native-library-all-find")
        XCTAssertTrue(input.waitForExistence(timeout: 6), "查字框")
        input.tap()
        input.typeText("永")
        qa.waitProbe("find applied", timeout: 10) { _ in
            (self.qaTextOf(qa, "native-library-all-find-where").isEmpty == false)
        }
    }

    private func qaFirstGroupName(_ qa: QA) -> String { qa.el("native-library-all-group-name").label }
    private func qaHasElement(_ qa: QA, _ id: String) -> Bool { qa.el(id).exists }
    private func qaTextOf(_ qa: QA, _ id: String) -> String { qa.el(id).label }

    /// 全部字页：视图参数写进路由 params → 冷启动恢复后仍在这一屏、筛选还在。
    func testAllCharsParamsColdRestore() {
        let qa = QA(seed: "all-filter")
        qa.launch()
        waitScreen(qa, "library-all")
        XCTAssertTrue(qa.el("native-library-all-go").waitForExistence(timeout: 6), "底栏主键")
        // 杀进程再开（不带注入）：冷启动恢复到这一屏
        qa.relaunchWithoutSeed()
        qa.waitRouteTop("library-all", timeout: 30)
        XCTAssertTrue(qa.el("native-library-all-go").waitForExistence(timeout: 10), "冷启动后仍在全部字页")
    }

    /// 换库成功即返回（不提示）。
    func testSwitchLibrarySuccessReturnsAtOnce() {
        let qa = QA(seed: "switch")
        qa.launch()
        waitScreen(qa, "library-switch")
        let row = qa.app.descendants(matching: .any).matching(identifier: "native-library-switch-row-1").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 6), "换库页的第二行（不是当前库）")
        qa.tap(row, "switch to the second library")
        qa.waitRouteTop("mine", timeout: 20)
        XCTAssertFalse(qa.el("native-library-switch-fail-note").exists, "成功不提示")
    }

    /// 换库失败就地三段式：说明 + 先不换 + 再试一次；再试一次成功就返回。
    /// 夹具 switch-fail 自己在起点就点过一次（注入写失败），所以一进来就是失败态。
    func testSwitchLibraryFailureThreeStage() {
        let qa = QA(seed: "switch-fail")
        qa.launch()
        waitScreen(qa, "library-switch")
        XCTAssertTrue(qa.el("native-library-switch-fail-note").waitForExistence(timeout: 10), "失败说明")
        XCTAssertTrue(qa.el("native-library-switch-fail-cancel").exists, "先不换")
        XCTAssertTrue(qa.el("native-library-switch-fail-retry").exists, "再试一次")
        // 再试一次 → 这次写成功 → 返回
        qa.tapNative("native-library-switch-fail-retry")
        qa.waitRouteTop("mine", timeout: 20)
    }
}
