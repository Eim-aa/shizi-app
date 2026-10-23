import XCTest

// B3.3 流程测试骨架（B3B4 §5.2 · 我的与子页）：每个用例先「待办」（XCTSkip），由 B3.5c / B3.9 / B3.10 的页面卡填实。
// 填的时候：用 QA(seed: "<夹具状态>") 一键到起点（夹具在 ShiziUITests/States/），数据经探针断言；把 try QAPending.skip(…) 换成真实步骤即可，不改别的文件。

@MainActor
final class MineFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// 「我的」原生（根页开关打开）：探针里原生栈只有 mine。
    private func openMine(_ qa: QA) {
        qa.launch()
        qa.waitProbe("native mine") { (($0["stage"] as? [String: Any])?["screens"] as? [String]) == ["mine"] && ($0["navRunning"] as? Int) == 0 }
        Thread.sleep(forTimeInterval: 0.6) // 新状态 0.4s 防误点
    }

    private func settings(_ qa: QA) -> [String: Any] { qa.probe["settings"] as? [String: Any] ?? [:] }
    private func themeOverride(_ qa: QA) -> Int { (qa.probe["theme"] as? [String: Any])?["override"] as? Int ?? -1 }
    private func options(_ qa: QA, _ id: String) -> XCUIElementQuery { qa.app.buttons.matching(identifier: id) }

    /// 外观三段即时生效（浅 / 深）：点第 3 段（夜间）→ 存下 dark、选中态换过去、原生主题立刻是深色；再点第 2 段（日间）→ 浅。
    func testAppearanceSegmentsApplyAtOnce() throws {
        let qa = QA(seed: "mine-records", extra: ["-shizi-native-roots"])
        openMine(qa)
        XCTAssertEqual(themeOverride(qa), 0, "follows the system until a choice is made")
        let seg = options(qa, "native-mine-appearance-option")
        XCTAssertEqual(seg.count, 3)
        qa.tap(seg.element(boundBy: 2), "appearance › dark")
        qa.waitProbe("appearance dark saved, native theme dark") { ($0["settings"] as? [String: Any])?["appearance"] as? String == "dark" && (($0["theme"] as? [String: Any])?["override"] as? Int) == 2 }
        XCTAssertTrue(seg.element(boundBy: 2).isSelected)
        XCTAssertFalse(seg.element(boundBy: 0).isSelected)
        Thread.sleep(forTimeInterval: 0.5)
        qa.tap(seg.element(boundBy: 1), "appearance › light")
        qa.waitProbe("appearance light saved, native theme light") { ($0["settings"] as? [String: Any])?["appearance"] as? String == "light" && (($0["theme"] as? [String: Any])?["override"] as? Int) == 1 }
        XCTAssertTrue(seg.element(boundBy: 1).isSelected)
        qa.tap(seg.element(boundBy: 0), "appearance › follow system")
        qa.waitProbe("appearance auto saved, native theme follows system") { ($0["settings"] as? [String: Any])?["appearance"] as? String == "auto" && (($0["theme"] as? [String: Any])?["override"] as? Int) == 0 }
        XCTAssertTrue(seg.element(boundBy: 0).isSelected)
    }

    /// 每组字数改了从下一组起生效：点第 1 段（5）→ 存下 5，选中态换过去；失败时行下就地三段式，再试一次成功后收起（D07）。
    func testGroupSizeSyncsHomeAndLibrary() throws {
        let qa = QA(seed: "mine-records", failNext: 1, extra: ["-shizi-native-roots"])
        openMine(qa)
        let seg = options(qa, "native-mine-group-size-option")
        XCTAssertEqual(seg.count, 4)
        qa.tap(seg.element(boundBy: 0), "group size › 5 (fails)")
        XCTAssertTrue(qa.el("native-mine-fail-retry").waitForExistence(timeout: 6), "three-part failure in place")
        XCTAssertNotEqual(settings(qa)["groupSize"] as? Int, 5, "a failed write leaves the setting alone")
        Thread.sleep(forTimeInterval: 0.5)
        qa.tapNative("native-mine-fail-retry")
        qa.waitProbe("group size 5 saved") { ($0["settings"] as? [String: Any])?["groupSize"] as? Int == 5 }
        XCTAssertFalse(qa.el("native-mine-fail-retry").exists, "the failure block goes away")
        XCTAssertTrue(seg.element(boundBy: 0).isSelected)
        // 两个入口都读同一个设置：下一组从首页开成 5 个，回字库后「今日练习」续同一组。
        qa.tap(qa.button("习字"), "home tab")
        qa.waitRouteTop("home")
        qa.tap(qa.buttonContaining("开始写字"), "home starts the next group")
        qa.waitNative(true)
        XCTAssertEqual(qa.session("A")["total"] as? Int, 5)
        qa.tapNative("native-write-back")
        qa.waitNative(false)
        qa.tap(qa.button("字库"), "library tab")
        qa.waitRouteTop("library")
        qa.tap(qa.buttonContaining("今日练习"), "library resumes the same group")
        qa.waitNative(true)
        XCTAssertEqual(qa.session("A")["total"] as? Int, 5)
        XCTAssertEqual(settings(qa)["groupSize"] as? Int, 5)
    }

    /// AX5 改选择弹层：AX 档外观 / 每组字数是「名称 …… 值 ›」，点开底部弹层，选一项即写并关。
    func testAx5ChoiceSheet() throws {
        let qa = QA(seed: "mine-records", extra: ["-shizi-native-roots", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        openMine(qa)
        qa.tapNative("native-mine-group-size")
        XCTAssertTrue(qa.el("native-mine-group-size-sheet").waitForExistence(timeout: 6))
        let opts = options(qa, "native-mine-group-size-sheet-option")
        XCTAssertEqual(opts.count, 4)
        Thread.sleep(forTimeInterval: 0.5)
        qa.tap(opts.element(boundBy: 1), "sheet › 10")
        qa.waitProbe("group size 10 saved") { ($0["settings"] as? [String: Any])?["groupSize"] as? Int == 10 }
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: qa.el("native-mine-group-size-sheet"))
        waitForExpectations(timeout: 6)
    }

    /// 打开选择弹层不播失败；写失败留在弹层、旧值不变，只在失败时读出三段式说明；重试写同一个目标并关闭。
    func testAx5ChoiceFailureAnnouncesOnlyAfterFailure() throws {
        let qa = QA(seed: "mine-records", failNext: 1, extra: ["-shizi-native-roots", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        openMine(qa)
        let before = settings(qa)["groupSize"] as? Int
        let failure = "announce:没保存上，刚才的选择没记下。"
        qa.tapNative("native-mine-group-size")
        XCTAssertTrue(qa.el("native-mine-group-size-sheet").waitForExistence(timeout: 6))
        XCTAssertFalse((qa.probe["a11y"] as? [String] ?? []).contains(failure), "opening the sheet does not announce a save failure")
        let opts = options(qa, "native-mine-group-size-sheet-option")
        qa.tap(opts.element(boundBy: 0), "sheet › 5 (fails)")
        XCTAssertTrue(qa.el("native-mine-group-size-sheet-fail-retry").waitForExistence(timeout: 6))
        XCTAssertEqual(settings(qa)["groupSize"] as? Int, before)
        qa.waitProbe("failure announced once") { ($0["a11y"] as? [String] ?? []).filter { $0 == failure }.count == 1 }
        qa.tapNative("native-mine-group-size-sheet-fail-retry")
        qa.waitProbe("group size 5 saved after retry") { ($0["settings"] as? [String: Any])?["groupSize"] as? Int == 5 }
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: qa.el("native-mine-group-size-sheet"))
        waitForExpectations(timeout: 6)
    }

    /// Tab 根没有页面返回，但上面的弹层始终可以左缘右滑关闭（N4）；设置没有被改动。
    func testAx5ChoiceSheetEdgeClosesOnlySheet() throws {
        let qa = QA(seed: "mine-records", extra: ["-shizi-native-roots", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        openMine(qa)
        let before = settings(qa)["groupSize"] as? Int
        qa.tapNative("native-mine-group-size")
        XCTAssertTrue(qa.el("native-mine-group-size-sheet").waitForExistence(timeout: 6))
        qa.edgeBack()
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: qa.el("native-mine-group-size-sheet"))
        waitForExpectations(timeout: 6)
        XCTAssertEqual(settings(qa)["groupSize"] as? Int, before)
        XCTAssertEqual((qa.probe["stage"] as? [String: Any])?["screens"] as? [String], ["mine"])
    }

    /// 让给网页再回来（备份页还不是原生的，B3.10）：原生「我的」→ 点备份行 → 网页备份页（原生栈收起）→ 左缘返回 → 原生「我的」盖回来；
    /// 推入原生子页（关于）= 原生栈 [mine, about]，「‹」回到 mine，根页没有「‹」也没有左缘返回。
    func testYieldToWebAndBack() throws {
        let qa = QA(seed: "mine-records", extra: ["-shizi-native-roots"])
        openMine(qa)
        XCTAssertFalse(qa.el("native-page-back").isHittable, "a tab root has no back button")
        qa.tapNative("native-mine-menu-backup")
        qa.waitProbe("web backup page, native stack released") { (($0["route"] as? [String: Any])?["top"] as? String) == "backup" && (($0["stage"] as? [String: Any])?["screens"] as? [String]) == [] }
        Thread.sleep(forTimeInterval: 0.6)
        qa.edgeBack()
        qa.waitProbe("back on native mine") { (($0["route"] as? [String: Any])?["top"] as? String) == "mine" && (($0["stage"] as? [String: Any])?["screens"] as? [String]) == ["mine"] && ($0["navRunning"] as? Int) == 0 }
        Thread.sleep(forTimeInterval: 0.6)
        qa.tapNative("native-mine-menu-about")
        qa.waitProbe("native about over native mine") { (($0["stage"] as? [String: Any])?["screens"] as? [String]) == ["mine", "about"] && ($0["navRunning"] as? Int) == 0 }
        Thread.sleep(forTimeInterval: 0.6)
        qa.tapNative("native-page-back")
        qa.waitProbe("back to native mine only") { (($0["stage"] as? [String: Any])?["screens"] as? [String]) == ["mine"] && (($0["route"] as? [String: Any])?["top"] as? String) == "mine" }
    }

    /// 练习记录翻月 / 展开某天
    func testRecordsMonthAndDay() throws { try QAPending.skip("B3.9", "练习记录翻月 / 展开某天") }

    /// 月字帖
    func testMonthCopybook() throws { try QAPending.skip("B3.9", "月字帖") }

    /// 年报往年
    func testAnnualPastYear() throws { try QAPending.skip("B3.9", "年报往年") }

    /// 提醒开关 / 时间 / 被拒跳设置
    func testRemindSwitchTimeDenied() throws { try QAPending.skip("B3.10", "提醒开关 / 时间 / 被拒跳设置") }
}
