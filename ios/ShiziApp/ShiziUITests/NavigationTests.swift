import XCTest

// B3.3 流程测试骨架（B3B4 §5.2 · 导航）：每个用例先「待办」（XCTSkip），由 B3.2 / B3.5d 的页面卡填实。
// 填的时候：用 QA(seed: "<夹具状态>") 一键到起点（夹具在 ShiziUITests/States/），数据经探针断言；把 try QAPending.skip(…) 换成真实步骤即可，不改别的文件。
//
// B3.5d Tab 部分：原生 Tab 栏（NativeStage 的 UITabBarController）。探针 stage.tabs = {shown, selected, frame, a11yHidden, rootScrollY}；
// stage.root = 原生根页 {screen, hidden}；route.tab / route.top = 网页路由（仍是真相源）。Tab 按钮经系统 Tab 栏的无障碍树找（app.tabBars）。

@MainActor
final class NavigationTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    // MARK: B3.5d 工具

    nonisolated private static func tabs(_ p: [String: Any]) -> [String: Any] { ((p["stage"] as? [String: Any])?["tabs"] as? [String: Any]) ?? [:] }
    nonisolated private static func root(_ p: [String: Any]) -> [String: Any] { ((p["stage"] as? [String: Any])?["root"] as? [String: Any]) ?? [:] }
    nonisolated private static func routeTab(_ p: [String: Any]) -> String? { (p["route"] as? [String: Any])?["tab"] as? String }
    nonisolated private static func depth(_ p: [String: Any]) -> Int { (p["route"] as? [String: Any])?["depth"] as? Int ?? -1 }

    /// 系统 Tab 栏里名为 label 的按钮（写字 / 字库 / 我的）。
    private func tabButton(_ qa: QA, _ label: String) -> XCUIElement { qa.app.tabBars.buttons[label] }

    /// 这一个 tab 是看得见的原生根页：路由在这个 tab 的根上、原生根页是它且没让开、Tab 栏看得见且选中它、转场停了。
    private func waitRoot(_ qa: QA, _ screen: String, timeout: TimeInterval = 20, file: StaticString = #filePath, line: UInt = #line) {
        qa.waitProbe("native root \(screen) with the tab bar", timeout: timeout, file: file, line: line) { p in
            Self.routeTab(p) == screen && Self.depth(p) == 0 && Self.root(p)["screen"] as? String == screen && Self.root(p)["hidden"] as? Bool == false
                && Self.tabs(p)["shown"] as? Bool == true && Self.tabs(p)["selected"] as? String == screen && (p["navRunning"] as? Int) == 0
        }
    }

    /// Tab 栏只有一条（原生的），三项都在、读屏摸得到；网页 Tabs 不画（不出现第二个「字库」按钮）。
    private func assertOneNativeTabBar(_ qa: QA, file: StaticString = #filePath, line: UInt = #line) {
        for label in ["写字", "字库", "我的"] {
            XCTAssertTrue(tabButton(qa, label).waitForExistence(timeout: 4), "native tab \(label)", file: file, line: line)
            XCTAssertEqual(qa.app.buttons.matching(NSPredicate(format: "label == %@", label)).count, 1, "exactly one \(label) tab (no web Tabs underneath)", file: file, line: line)
        }
    }

    /// Tab 栏不在：看不见或对读屏藏起（被推入页 / 写字页盖住）。
    private func assertTabBarCovered(_ qa: QA, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertFalse(tabButton(qa, "字库").exists, "the tab bar is out of reach on \(what)", file: file, line: line)
        let t = Self.tabs(qa.probe)
        XCTAssertTrue(t["shown"] as? Bool == false || t["a11yHidden"] as? Bool == true, "the tab bar is covered on \(what): \(t)", file: file, line: line)
    }

    private func launch(_ seed: String, _ screen: String, extra: [String] = []) -> QA {
        let qa = QA(seed: seed, extra: extra)
        qa.launch()
        waitRoot(qa, screen)
        Thread.sleep(forTimeInterval: 0.6) // 新状态 0.4s 防误点
        return qa
    }

    // MARK: B3.5d Tab 栏

    /// 三个根页互切：点 Tab → nav.tab（网页路由切 tab）→ 原生根页换成那一页、选中格跟着换；切换无动画（不记原生转场）、Tab 栏始终只有原生一条。
    func testTabsSwitchBetweenThreeRoots() {
        let qa = launch("home-fresh", "home")
        assertOneNativeTabBar(qa)
        XCTAssertTrue(tabButton(qa, "写字").isSelected, "home tab selected")
        let presents = qa.transitions.filter { $0.hasPrefix("present:") || $0.hasPrefix("dismiss:") }.count
        for (label, screen) in [("字库", "library"), ("我的", "mine"), ("写字", "home"), ("我的", "mine"), ("字库", "library")] {
            qa.tap(tabButton(qa, label), "tab \(label)")
            waitRoot(qa, screen)
            XCTAssertTrue(tabButton(qa, label).isSelected, "\(label) selected")
            XCTAssertTrue(qa.transitions.contains("tab:select \(screen)"), "the tap went through nav.tab: \(qa.transitions)")
            assertOneNativeTabBar(qa)
        }
        XCTAssertEqual(qa.transitions.filter { $0.hasPrefix("present:") || $0.hasPrefix("dismiss:") }.count, presents, "tab switches play no transition: \(qa.transitions)")
    }

    /// 从三个根页各推入一页（首页 → 写字页、字库 → 区详情、我的 → 关于），推入页上看不到 Tab 栏；左缘右滑回到同一个根页，Tab 栏回来、选中不变。
    func testPushFromEachRootHidesTheBarAndEdgeBackReturns() {
        // 首页 → 写字页（纸展开）
        let qa = launch("home-fresh", "home")
        qa.tap(qa.el("native-home-start"), "开始写字")
        qa.waitNative(true, timeout: 20)
        qa.waitProbe("write page settled") { ($0["navRunning"] as? Int) == 0 }
        assertTabBarCovered(qa, "the write page")
        qa.edgeBack()
        qa.waitNative(false, timeout: 20)
        waitRoot(qa, "home")
        assertOneNativeTabBar(qa)
        qa.app.terminate()

        // 字库 → 区详情（原生推入）
        let lib = launch("library-records", "library")
        lib.tapNative("native-library-zone-0")
        lib.waitProbe("native list pushed over the library root") { p in
            ((p["stage"] as? [String: Any])?["screens"] as? [String]) == ["library-list"] && (p["navRunning"] as? Int) == 0
        }
        Thread.sleep(forTimeInterval: 0.6)
        assertTabBarCovered(lib, "the zone list")
        lib.edgeBack()
        waitRoot(lib, "library")
        assertOneNativeTabBar(lib)
        lib.app.terminate()

        // 我的 → 关于（原生推入）
        let mine = launch("mine-records", "mine")
        mine.tapNative("native-mine-menu-about")
        mine.waitProbe("native about over mine") { p in
            ((p["stage"] as? [String: Any])?["screens"] as? [String]) == ["about"] && (p["navRunning"] as? Int) == 0
        }
        Thread.sleep(forTimeInterval: 0.6)
        assertTabBarCovered(mine, "the about page")
        mine.edgeBack()
        waitRoot(mine, "mine")
        assertOneNativeTabBar(mine)
    }

    /// 冷启动恢复到上次的 tab：切到「我的」→ 杀进程重开（不注入）→ 原生「我的」根页、Tab 栏选中「我的」。
    func testColdStartRestoresTheTab() {
        let qa = launch("library-half", "library")
        qa.tap(tabButton(qa, "我的"), "tab 我的")
        waitRoot(qa, "mine")
        Thread.sleep(forTimeInterval: 1.0) // 路由提示写下（单一写入者，免事务）
        qa.relaunchWithoutSeed()
        waitRoot(qa, "mine", timeout: 30)
        XCTAssertTrue(tabButton(qa, "我的").isSelected, "restored tab selected")
        assertOneNativeTabBar(qa)
    }

    // MARK: 骨架（B3.2 / B3.5d）

    /// 每个 L1 / L2 画面：左缘右滑结果 == 点左上（IC-03 遍历原生版）
    func testEdgeSwipeEqualsTapBackOnEveryL1L2() throws { try QAPending.skip("B3.2 / B3.5d", "每个 L1 / L2 画面：左缘右滑结果 == 点左上（IC-03 遍历原生版）") }

    /// 两指 Z 形
    func testTwoFingerZ() throws { try QAPending.skip("B3.2 / B3.5d", "两指 Z 形") }

    /// 弹层开着时左缘只关弹层
    func testSheetOpenEdgeOnlyClosesSheet() throws { try QAPending.skip("B3.2 / B3.5d", "弹层开着时左缘只关弹层") }

    /// Tab 再点滚回顶部（N6）：「我的」在 AX 大字号下可滚——滚下去后再点「我的」→ 回到顶部、仍在「我的」、没有切 tab。
    func testTabReTapScrollsToTop() {
        let qa = launch("mine-records", "mine", extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        for _ in 0..<3 { qa.app.swipeUp(velocity: .slow) }
        qa.waitProbe("mine scrolled down") { ((Self.tabs($0)["rootScrollY"] as? NSNumber)?.doubleValue ?? 0) > 100 }
        let before = qa.transitions.filter { $0.hasPrefix("tab:select") }.count
        qa.tap(tabButton(qa, "我的"), "re-tap 我的")
        qa.waitProbe("mine back at the top") { ((Self.tabs($0)["rootScrollY"] as? NSNumber)?.doubleValue ?? -1).magnitude < 1 }
        XCTAssertTrue(qa.transitions.contains("tab:top mine"), "\(qa.transitions)")
        XCTAssertEqual(qa.transitions.filter { $0.hasPrefix("tab:select") }.count, before, "re-tapping does not switch tabs")
        waitRoot(qa, "mine")
        // 已在顶部：再点什么都不做
        qa.tap(tabButton(qa, "我的"), "re-tap 我的 at the top", verify: false)
        XCTAssertEqual(qa.transitions.filter { $0 == "tab:top mine" }.count, 1, "nothing happens at the top: \(qa.transitions)")
    }

    /// Tab 根无左缘返回：根页上左缘右滑，路由与根页都不变。
    func testTabRootHasNoEdgeBack() {
        let qa = launch("library-half", "library")
        // 直接拖（不用 QA.edgeBack：它把「没效果」当合成触摸丢失重滑一次，这里没效果才是对的）
        let w = qa.app.windows.firstMatch
        w.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.55)).withOffset(CGVector(dx: 2, dy: 0))
            .press(forDuration: 0.05, thenDragTo: w.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.55)), withVelocity: 900, thenHoldForDuration: 0)
        Thread.sleep(forTimeInterval: 1.2)
        waitRoot(qa, "library")
        XCTAssertEqual(Self.depth(qa.probe), 0)
    }

    /// N7 整页不平移（内容容器外拖动页头不动）
    func testN7PageDoesNotPan() throws { try QAPending.skip("B3.2 / B3.5d", "N7 整页不平移（内容容器外拖动页头不动）") }
}
