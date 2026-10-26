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
        XCTAssertEqual(qa.session("A")["cursor"] as? Int, 0, "刚开的组从头开始")
    }

    /// 临时：量一下网页对不上的那几处字体度量（诊断用，交付前删）。
    func testTempFontMetrics() {
        func w(_ s: String, _ f: UIFont) -> CGFloat { (s as NSString).size(withAttributes: [.font: f]).width }
        func wKern0(_ s: String, _ f: UIFont) -> CGFloat { (s as NSString).size(withAttributes: [.font: f, .kern: 0]).width }
        for (name, fs17, fs15) in [("L", CGFloat(17), CGFloat(15)), ("XXXL", CGFloat(22.95), CGFloat(20.25)), ("AX3", CGFloat(40), CGFloat(36)), ("AX5", CGFloat(53), CGFloat(49))] {
            let sysR = UIFont.systemFont(ofSize: fs15, weight: .regular)
            let sysM = UIFont.systemFont(ofSize: fs17, weight: .medium)
            print("WIDTH \(name) fs15=\(fs15) fs17=\(fs17)")
            print("WIDTH \(name) label17: plain=\(w("排序 · 筛选", sysM)) kern0=\(wKern0("排序 · 筛选", sysM))")
            print("WIDTH \(name) label15: plain=\(w("排序 · 筛选", sysR)) kern0=\(wKern0("排序 · 筛选", sysR))")
            print("WIDTH \(name) pieces15: 排序=\(w("排序", sysR)) space=\(w(" ", sysR)) dot=\(w("·", sysR)) 筛选=\(w("筛选", sysR))")
            print("WIDTH \(name) pieces17: 排序=\(w("排序", sysM)) space=\(w(" ", sysM)) dot=\(w("·", sysM)) 筛选=\(w("筛选", sysM))")
        }
        for (name, fs22, lh22, fs15, lh15) in [("AX3", CGFloat(44), CGFloat(52), CGFloat(36), CGFloat(42)), ("AX5", CGFloat(56), CGFloat(66), CGFloat(49), CGFloat(58))] {
            let sf = UIFont.systemFont(ofSize: fs15, weight: .regular)
            let probe = UIFont.systemFont(ofSize: 17, weight: .regular)
            let ct = CTFontCreateForString(probe as CTFont, "\u{6C38}" as CFString, CFRange(location: 0, length: 1))
            let desc = CTFontDescriptorCreateCopyWithAttributes(CTFontCopyFontDescriptor(ct), [kCTFontOpticalSizeAttribute: 17] as CFDictionary)
            let cjk = CTFontCreateWithFontDescriptor(desc, fs15, nil) as UIFont
            print("METRIC \(name) sf asc=\(sf.ascender) desc=\(sf.descender) lh=\(sf.lineHeight)")
            print("METRIC \(name) cjk asc=\(cjk.ascender) desc=\(cjk.descender) lh=\(cjk.lineHeight)")
            print("METRIC \(name) songA=\(fs22 * 1.15091) songD=\(fs22 * 0.28599)")
        }
        for (size, asc, desc) in [(CGFloat(22), CGFloat(25.322), CGFloat(6.292)), (CGFloat(29.7), CGFloat(34.185), CGFloat(8.494)), (CGFloat(44), CGFloat(50.644), CGFloat(12.584)), (CGFloat(56), CGFloat(64.456), CGFloat(16.015))] {
            print("SONG size=\(size) asc=\(asc) desc=\(desc)")
        }
    }

    /// 底栏提示现在的字（勾选后会变）。
    private func qaHintLabel(_ qa: QA) -> String { qa.el("native-library-list-hint").label }

    /// 全部字页：排序 / 筛选 / 查找。
    func testAllCharsSortFilterFind() {
        let qa = QA(seed: "all-pinyin")
        qa.launch()
        waitScreen(qa, "library-all")
        XCTAssertTrue(qa.el("native-library-all-menu-open").waitForExistence(timeout: 6), "页头的「排序 · 筛选」")
        XCTAssertTrue(qa.el("native-library-all-cell").exists, "字墙的格子")
        // 排序：选「多久没写」→ 分组换了（格子数变了）
        let cellsBefore = qaCellCount(qa)
        qa.tapNative("native-library-all-menu-open")
        let sorts = qaQuery(qa, "native-library-all-sort")
        XCTAssertTrue(sorts.element(boundBy: 0).waitForExistence(timeout: 6), "排序三键")
        qa.tap(sorts.element(boundBy: 2), "sort by age")
        qa.waitProbe("sort applied", timeout: 10) { _ in
            self.qaCellCount(qa) != cellsBefore
        }
        // 筛选：选「待复习」→ 底栏主键变成区清单（页面多一个「看这些字 ›」）
        qa.tapNative("native-library-all-menu-open")
        let chips = qaQuery(qa, "native-library-all-chip")
        XCTAssertTrue(chips.element(boundBy: 0).waitForExistence(timeout: 6), "筛选项")
        qa.tap(chips.element(boundBy: 0), "chip due")
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

    private func qaCellCount(_ qa: QA) -> Int { qaQuery(qa, "native-library-all-cell").count }
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
    func testSwitchLibraryFailureThreeStage() {
        let qa = QA(seed: "switch-fail", failNext: 1)
        qa.launch()
        waitScreen(qa, "library-switch")
        let row = qa.app.descendants(matching: .any).matching(identifier: "native-library-switch-row-1").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 6), "换库页的第二行（不是当前库）")
        qa.tap(row, "switch fails")
        XCTAssertTrue(qa.el("native-library-switch-fail-note").waitForExistence(timeout: 8), "失败说明")
        XCTAssertTrue(qa.el("native-library-switch-fail-cancel").exists, "先不换")
        XCTAssertTrue(qa.el("native-library-switch-fail-retry").exists, "再试一次")
        // 再试一次 → 这次写成功 → 返回
        qa.tapNative("native-library-switch-fail-retry")
        qa.waitRouteTop("mine", timeout: 20)
    }
}
