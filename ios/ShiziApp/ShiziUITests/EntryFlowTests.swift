import XCTest

// QA-H1：写字流程确认单 §1（进入写字页）与 §8 结果页出口、§9 重写错字：每个入口进入、转场类型（D62）、返回落点、数字同步。
// 转场类型经探针 transitions（原生写字页每次呈现 / 收起记一条：open via=… animate=…、present:slide|fade、dismiss:…）。
// D62：只有首页入口是「纸展开 / 缩回」，其余入口普通推入（present:slide）、返回往右滑出；首页入口现状仍是推入 → KnownIssueTests NF-01。
// D70：结果页「再写一组」进的写字页，返回回首页（D62 的明文例外）。

@MainActor
final class EntryFlowTests: XCTestCase {
    override func setUp() async throws {
        continueAfterFailure = false
    }

    private func tabLibrary(_ qa: QA) {
        qa.tap(qa.button("字库"), "字库 tab")
        qa.waitProbe("library tab") { (($0["route"] as? [String: Any])?["tab"] as? String) == "library" }
    }

    /// §1：首页主按钮「开始写字」（全新用户 = 首次练习 3 字）→ 原生写字页；‹ 回到首页，按钮变「继续写字」（AI 流程报告已验证路径 1、3）。
    func test101_homeStartFirstPractice() {
        let qa = QA(seed: "home")
        qa.launch()
        qa.tap(qa.buttonContaining("开始写字"), "开始写字")
        qa.waitNative(true)
        let a = qa.session("A")
        XCTAssertEqual(a["kind"] as? String, "first")
        XCTAssertEqual(a["total"] as? Int, 3, "first practice is 3 chars")
        XCTAssertTrue(qa.el("native-write-progress").label.contains("共 3 个"))
        XCTAssertTrue(qa.el("native-write-end").exists == false || qa.el("native-write-end").isHittable == false, "no 结束这组 in the first practice (D66 ⑥)")
        XCTAssertTrue(qa.transitions.contains { $0.hasPrefix("open via=home") }, "\(qa.transitions)")
        qa.stroke()
        qa.tapNative("native-write-back")
        qa.waitNative(false)
        qa.waitRouteTop("home")
        XCTAssertTrue(qa.buttonContaining("继续写字").waitForExistence(timeout: 4), "home CTA becomes 继续写字")
        XCTAssertEqual(qa.session("A")["strokes"] as? Int, 1, "the stroke is kept")
        // 再进：回到同一字、同一笔迹
        qa.tap(qa.buttonContaining("继续写字"), "继续写字")
        qa.waitNative(true)
        XCTAssertEqual(qa.native["strokes"] as? Int, 1)
        XCTAssertEqual(qa.native["cursor"] as? Int, 0)
    }

    /// §1：首页「继续写字，已写 1 个，共 8 个」→ 回到第 2 字；判断后首页数字变「已写 2 个」。
    func test102_homeContinueAndProgressSync() {
        let qa = QA(seed: "home-mid")
        qa.launch()
        let cta = qa.buttonContaining("继续写字")
        XCTAssertTrue(cta.waitForExistence(timeout: 5))
        XCTAssertTrue(cta.label.contains("已写 1 个"), cta.label)
        qa.tap(cta, "继续写字")
        qa.waitNative(true)
        XCTAssertEqual(qa.native["cursor"] as? Int, 1)
        qa.stroke()
        qa.tapNative("native-write-done")
        qa.waitProbe("compare") { (($0["native"] as? [String: Any])?["phase"] as? String) == "compare" }
        Thread.sleep(forTimeInterval: 0.6) // 判断两键 440ms 可点
        qa.tapNative("native-write-correct")
        qa.waitProbe("advanced") { (($0["sessions"] as? [String: Any])?["A"] as? [String: Any])?["cursor"] as? Int == 2 }
        qa.tapNative("native-write-back")
        qa.waitNative(false)
        XCTAssertTrue(qa.buttonContaining("已写 2 个").waitForExistence(timeout: 5), "home progress synced")
    }

    /// §1：字库「今日练习」→ 推入（present:slide）；返回落在字库；字库「已练汉字」数字随判断变化（已验证路径 10、12）。
    func test103_libraryTodayPushesAndReturns() {
        let qa = QA(seed: "home-used")
        qa.launch()
        tabLibrary(qa)
        XCTAssertTrue(qa.text("3").exists, "已练汉字 3")
        qa.tap(qa.buttonContaining("今日练习"), "今日练习")
        qa.waitNative(true)
        XCTAssertTrue(qa.transitions.contains("present:slide"), "\(qa.transitions)")
        XCTAssertFalse(qa.transitions.contains { $0.hasPrefix("open via=home") }, "not a home entry: \(qa.transitions)")
        qa.stroke()
        qa.tapNative("native-write-done")
        qa.waitProbe("compare") { (($0["native"] as? [String: Any])?["phase"] as? String) == "compare" }
        Thread.sleep(forTimeInterval: 0.6)
        qa.tapNative("native-write-wrong")
        qa.waitProbe("judged") { ($0["records"] as? Int) == 4 }
        qa.tapNative("native-write-back")
        qa.waitNative(false)
        qa.waitProbe("back on library") { (($0["route"] as? [String: Any])?["tab"] as? String) == "library" && (($0["route"] as? [String: Any])?["depth"] as? Int) == 0 }
        XCTAssertTrue(qa.transitions.contains { $0.hasPrefix("dismiss:slide") }, "slides out to the right: \(qa.transitions)")
        XCTAssertEqual(qa.probe["chars"] as? Int, 4)
        XCTAssertTrue(qa.text("4").waitForExistence(timeout: 4), "已练汉字 4")
    }

    /// §1：字库「待复习」→ 区详情「练这些字」→ 推入；左缘滑回落在区详情（已验证路径 10）。
    func test104_libraryTierPracticeAndEdgeBack() {
        let qa = QA(seed: "home-used")
        qa.launch()
        tabLibrary(qa)
        qa.tap(qa.buttonContaining("待复习"), "待复习")
        qa.waitProbe("tier list") { (($0["route"] as? [String: Any])?["depth"] as? Int) == 1 }
        let listTop = qa.route["top"] as? String
        qa.tap(qa.buttonContaining("练这"), "练这些字 / 练这 N 个字")
        qa.waitNative(true)
        XCTAssertTrue(qa.transitions.contains("present:slide"), "\(qa.transitions)")
        qa.edgeBack()
        qa.waitNative(false)
        qa.waitProbe("back on the tier list") { (($0["route"] as? [String: Any])?["top"] as? String) == listTop }
    }

    /// §1：字详情「练这个字」→ 推入；返回落在字详情（已验证路径 10）。
    func test105_detailPracticeThisChar() {
        let qa = QA(seed: "home-used")
        qa.launch()
        tabLibrary(qa)
        qa.tap(qa.buttonContaining("待复习"), "待复习")
        qa.waitProbe("tier list") { (($0["route"] as? [String: Any])?["depth"] as? Int) == 1 }
        // 点这一行看记录 → 字详情
        let row = qa.app.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "共", "次")).firstMatch
        qa.tap(row, "a char row in the list")
        qa.waitProbe("detail") { (($0["route"] as? [String: Any])?["top"] as? String) == "detail" }
        qa.tap(qa.buttonContaining("练这个字"), "练这个字")
        qa.waitNative(true)
        XCTAssertTrue(qa.transitions.contains("present:slide"), "\(qa.transitions)")
        XCTAssertEqual(qa.session("B")["total"] as? Int, 1)
        qa.tapNative("native-write-back")
        qa.waitNative(false)
        qa.waitRouteTop("detail")
    }

    /// §1：查字弹层（字库搜索框）输入一个字 → 字卡「练这个字」→ 推入；返回落回查字（已验证路径 13）。
    func test109_queryPracticeThisChar() {
        let qa = QA(seed: "home-used")
        qa.launch()
        tabLibrary(qa)
        let search = qa.app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "搜索汉字或拼音")).firstMatch
        qa.tap(search, "搜索汉字或拼音")
        Thread.sleep(forTimeInterval: 0.8)
        qa.app.typeText("永")
        Thread.sleep(forTimeInterval: 1.0)
        let practice = qa.buttonContaining("练这个字")
        if !practice.waitForExistence(timeout: 3) {
            // 列表里先点这个字打开字卡
            qa.tap(qa.app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "永")).firstMatch, "永 row")
        }
        qa.tap(qa.buttonContaining("练这个字"), "练这个字")
        qa.waitNative(true)
        XCTAssertTrue(qa.transitions.contains("present:slide"), "\(qa.transitions)")
        XCTAssertEqual(qa.native["cardKey"] as? String, "base:永")
        qa.tapNative("native-write-back")
        qa.waitNative(false)
        XCTAssertNotEqual(qa.route["top"] as? String, "write")
    }

    /// §8：结果页「再写一组」→ 推入新写字页；D70：返回回首页（NF-02，负责人已定）。
    func test106_resultAgainThenBackGoesHome() {
        let qa = QA(seed: "result-daily")
        qa.launch()
        qa.waitRouteTop("result")
        qa.tap(qa.buttonContaining("再写一组"), "再写一组")
        qa.waitNative(true)
        XCTAssertTrue(qa.transitions.contains("present:slide"), "\(qa.transitions)")
        qa.tapNative("native-write-back")
        qa.waitNative(false)
        qa.waitRouteTop("home") // D70：结果页「再写一组」进的写字页返回回首页
    }

    /// §8：结果页出口：左上「×」/「回到…」回到来源页（首页），数据已更新（已验证路径 9）。
    func test107_resultExitReturnsToSource() {
        let qa = QA(seed: "result")
        qa.launch()
        qa.waitRouteTop("result")
        let exit = qa.app.buttons.matching(NSPredicate(format: "label == %@ OR label == %@ OR label BEGINSWITH %@", "关闭", "完成", "回到")).firstMatch
        qa.tap(exit, "result exit (× / 完成 / 回到…)")
        qa.waitRouteTop("home")
        XCTAssertEqual(qa.probe["records"] as? Int, 5)
    }

    /// §9：结果页「重写错字」→ 逐个写写错的字 → 写好了 → 对照 → 下一个 / 完成 → 回到结果页；只算练习：不记录（AI 流程报告：功能正常）。
    func test108_resultRedoWrongCharsRecordsNothing() {
        let qa = QA(seed: "result-daily")
        qa.launch()
        qa.waitRouteTop("result")
        let before = qa.records
        qa.tap(qa.buttonContaining("重写错字"), "重写错字")
        qa.waitRouteTop("redo")
        var guardN = 0
        while qa.route["top"] as? String == "redo" && guardN < 6 {
            guardN += 1
            // 网页重写错字页：书写格是网页的，画在页面中部
            let w = qa.app.windows.firstMatch
            w.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.45)).press(forDuration: 0.05, thenDragTo: w.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.45)))
            qa.tap(qa.button("写好了"), "写好了")
            let next = qa.app.buttons.matching(NSPredicate(format: "label == %@ OR label == %@", "下一个", "完成")).firstMatch
            qa.tap(next, "下一个 / 完成")
            Thread.sleep(forTimeInterval: 0.6)
        }
        qa.waitRouteTop("result")
        XCTAssertEqual(qa.records, before, "redo records nothing (D66 ③)")
    }
}
