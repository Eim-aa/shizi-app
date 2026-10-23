import XCTest

// QA-H1：写字流程确认单 §1（进入写字页）与 §8 结果页出口、§9 重写错字：每个入口进入、转场类型（D62）、返回落点、数字同步。
// 转场类型经探针 transitions（原生写字页每次呈现 / 收起记一条：open via=… animate=…、present:<paper|push|quiet|phase|fade|none>、dismiss:…、
// drag:<种类>、dismiss:<种类>:interactive、overlap = 两个原生转场同时在跑）与 webNav（网页 root.js 每次转场：push:native = 让给原生、push:slide / pop:paper …）。
// D62（B2.8）：只有首页入口是「纸展开 / 缩回」（present:paper / dismiss:paper），其余点按入口普通推入（present:push）、返回往右滑出；
// 网页对原生宿主条目不再播自己的转场（webNav 是 push:native / pop:native），同一时刻只有一个转场（没有 overlap）。
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
        qa.strokeLanded(1) // R12：先确认原生页收下了这一笔，再测「离开后还在」
        qa.tapNative("native-write-back")
        qa.waitNative(false)
        qa.waitRouteTop("home")
        XCTAssertTrue(qa.buttonContaining("继续写字").waitForExistence(timeout: 4), "home CTA becomes 继续写字")
        qa.waitProbe("the stroke is kept") { (($0["sessions"] as? [String: Any])?["A"] as? [String: Any])?["strokes"] as? Int == 1 }
        // 再进：回到同一字、同一笔迹
        qa.tap(qa.buttonContaining("继续写字"), "继续写字")
        qa.waitNative(true)
        XCTAssertEqual(qa.native["strokes"] as? Int, 1)
        XCTAssertEqual(qa.native["cursor"] as? Int, 0)
    }

    /// R12：写完一笔马上离开（‹ / 左缘右滑），桥被人为放慢（每个 op 晚 400ms 交给页面，-shizi-qa-bridge-delay）——这一笔一定在会话里，
    /// 再进回到同一笔迹。抬笔时发的 strokes 与离开时的整份写回都在 exit 之前（同一条桥队列）。
    private func strokeThenLeave(edge: Bool) {
        let qa = QA(seed: "home", extra: ["-shizi-qa-bridge-delay", "400"])
        qa.launch()
        // 桥放慢时，冷启动恢复出的上一条写字页（前一个用例停在写字页）收起得也慢：等它收完、导航空闲再点，免得点按落在收起途中
        qa.waitProbe("restored page gone, nav idle") { p in
            ((p["native"] as? [String: Any])?["shown"] as? Bool) != true && (p["navRunning"] as? Int ?? 0) == 0 && (p["navAnim"] as? String ?? "idle") == "idle"
        }
        Thread.sleep(forTimeInterval: 0.6)
        qa.tap(qa.buttonContaining("开始写字"), "开始写字")
        qa.waitNative(true)
        let g = qa.el("native-write-grid")
        XCTAssertTrue(g.waitForExistence(timeout: 5))
        g.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.45)).press(forDuration: 0.05, thenDragTo: g.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)), withVelocity: 300, thenHoldForDuration: 0.02)
        // 不等：抬笔后立即离开（strokes op 还在桥上）
        if edge { qa.edgeBack() } else { qa.el("native-write-back").tap() }
        qa.waitNative(false)
        qa.waitRouteTop("home")
        qa.waitProbe("stroke kept after leaving at once") { (($0["sessions"] as? [String: Any])?["A"] as? [String: Any])?["strokes"] as? Int == 1 }
        qa.tap(qa.buttonContaining("继续写字"), "继续写字")
        qa.waitNative(true)
        XCTAssertEqual(qa.native["strokes"] as? Int, 1, "re-entering shows the stroke")
        XCTAssertEqual(qa.native["cursor"] as? Int, 0)
    }

    func test101b_strokeThenImmediateBackUnderSlowBridge() { strokeThenLeave(edge: false) }
    func test101c_strokeThenImmediateEdgeBackUnderSlowBridge() { strokeThenLeave(edge: true) }

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

    /// §1：字库「今日练习」→ 推入（present:push）；返回落在字库；字库「已练汉字」数字随判断变化（已验证路径 10、12）。
    func test103_libraryTodayPushesAndReturns() {
        let qa = QA(seed: "home-used")
        qa.launch()
        tabLibrary(qa)
        XCTAssertTrue(qa.text("3").exists, "已练汉字 3")
        qa.tap(qa.buttonContaining("今日练习"), "今日练习")
        qa.waitNative(true)
        XCTAssertTrue(qa.transitions.contains("present:push"), "\(qa.transitions)")
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
        XCTAssertTrue(qa.transitions.contains { $0.hasPrefix("dismiss:push") }, "slides out to the right: \(qa.transitions)")
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
        XCTAssertTrue(qa.transitions.contains("present:push"), "\(qa.transitions)")
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
        XCTAssertTrue(qa.transitions.contains("present:push"), "\(qa.transitions)")
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
        XCTAssertTrue(qa.transitions.contains("present:push"), "\(qa.transitions)")
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
        XCTAssertTrue(qa.transitions.contains("present:push"), "\(qa.transitions)")
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

    // MARK: B2.8 转场整合（交互规范 T0-6 / IC-23 的原生版）

    /// IC-23（首页入口）：「开始写字」→ 纸从按钮展开（present:paper）；左缘右滑跟手缩回（drag:paper → dismiss:paper:interactive），落回首页；
    /// 网页不另播（webNav push:native / pop:native），同一时刻只有一个转场。
    func test110_homeEntryEdgeBackFoldsTheSamePaper() {
        let qa = QA(seed: "home")
        qa.launch()
        qa.tap(qa.buttonContaining("开始写字"), "开始写字")
        qa.waitNative(true)
        XCTAssertTrue(qa.transitions.contains("present:paper"), "\(qa.transitions)")
        qa.waitProbe("transition settled") { ($0["navRunning"] as? Int) == 0 }
        qa.edgeBack()
        qa.waitNative(false)
        qa.waitRouteTop("home")
        let t = qa.transitions
        XCTAssertTrue(t.contains("drag:paper"), "the edge drag follows the paper: \(t)")
        XCTAssertTrue(t.contains("dismiss:paper:interactive"), "\(t)")
        XCTAssertFalse(t.contains("overlap"), "\(t)")
        XCTAssertEqual(qa.webNav.filter { $0.hasSuffix(":paper") || $0.hasSuffix(":slide") || $0.hasSuffix(":quiet") }, [], "no web transition for the hosted entry: \(qa.webNav)")
        XCTAssertTrue(qa.buttonContaining("写字").waitForExistence(timeout: 3), "back on the home CTA")
    }

    /// IC-23（其他入口）：字库「今日练习」→ 普通推入（present:push）、网页不另播；左缘右滑跟手右滑出（drag:push），落回字库。
    func test111_libraryEntryPushesAndEdgeSlidesBack() {
        let qa = QA(seed: "home-used")
        qa.launch()
        qa.tap(qa.button("字库"), "字库 tab")
        qa.waitProbe("library tab") { (($0["route"] as? [String: Any])?["tab"] as? String) == "library" }
        qa.tap(qa.buttonContaining("今日练习"), "今日练习")
        qa.waitNative(true)
        XCTAssertTrue(qa.transitions.contains { $0.hasPrefix("open via=push") }, "\(qa.transitions)")
        XCTAssertTrue(qa.transitions.contains("present:push"), "\(qa.transitions)")
        XCTAssertFalse(qa.transitions.contains("present:paper"), "not a home entry: \(qa.transitions)")
        XCTAssertTrue(qa.webNav.contains("push:native"), "\(qa.webNav)")
        qa.waitProbe("transition settled") { ($0["navRunning"] as? Int) == 0 }
        qa.edgeBack()
        qa.waitNative(false)
        qa.waitProbe("back on library") { (($0["route"] as? [String: Any])?["tab"] as? String) == "library" && (($0["route"] as? [String: Any])?["depth"] as? Int) == 0 }
        XCTAssertTrue(qa.transitions.contains("drag:push"), "\(qa.transitions)")
        XCTAssertTrue(qa.transitions.contains("dismiss:push:interactive"), "\(qa.transitions)")
        XCTAssertFalse(qa.transitions.contains("overlap"), "\(qa.transitions)")
    }

    /// 减少动态效果（A3 / T0）：首页入口与返回一律 150ms 淡化（present:fade / dismiss:fade），不展开纸、不推入。
    func test112_reduceMotionFadesEveryEntry() {
        let qa = QA(seed: "home-mid", reduceMotion: true)
        qa.launch()
        qa.tap(qa.buttonContaining("继续写字"), "继续写字")
        qa.waitNative(true)
        XCTAssertTrue(qa.transitions.contains { $0.hasPrefix("open via=home") }, "\(qa.transitions)")
        XCTAssertTrue(qa.transitions.contains("present:fade"), "\(qa.transitions)")
        XCTAssertFalse(qa.transitions.contains("present:paper"), "\(qa.transitions)")
        qa.tapNative("native-write-back")
        qa.waitNative(false)
        qa.waitRouteTop("home")
        XCTAssertTrue(qa.transitions.contains("dismiss:fade"), "\(qa.transitions)")
        // 左缘右滑：不跟手（没有 drag:），松手过阈值后同样淡化
        qa.tap(qa.buttonContaining("继续写字"), "继续写字 again")
        qa.waitNative(true)
        qa.waitProbe("transition settled") { ($0["navRunning"] as? Int) == 0 }
        qa.edgeBack()
        qa.waitNative(false)
        XCTAssertFalse(qa.transitions.contains { $0.hasPrefix("drag:") }, "no finger-following under reduce motion: \(qa.transitions)")
        XCTAssertEqual(qa.transitions.filter { $0 == "dismiss:fade" }.count, 2, "\(qa.transitions)")
    }

    /// T-quiet：屏上没有来源元素的入口（程序打开的写字页 = 通知 / 深链同一条路）安静淡入；返回安静淡出。
    func test113_entryWithoutSourceIsQuiet() {
        let qa = QA(seed: "recall")
        qa.launch()
        XCTAssertTrue(qa.transitions.contains { $0.hasPrefix("open via=quiet") }, "\(qa.transitions)")
        XCTAssertTrue(qa.transitions.contains("present:quiet"), "\(qa.transitions)")
        qa.tapNative("native-write-back")
        qa.waitNative(false)
        XCTAssertTrue(qa.transitions.contains("dismiss:quiet"), "\(qa.transitions)")
        XCTAssertFalse(qa.transitions.contains("overlap"), "\(qa.transitions)")
    }

    /// N3-5 / IC-23：首页「开始写字」进来、写完一组 → 结果页「完成」/「×」回首页 = 纸缩回首页按钮（T-paper 倒放）。
    func test114_resultFromAHomeEntryFoldsBackIntoTheButton() {
        let qa = QA(seed: "home")
        qa.launch()
        qa.tap(qa.buttonContaining("开始写字"), "开始写字")
        qa.waitNative(true)
        for i in 0..<3 {
            qa.waitProbe("card \(i)") { (($0["sessions"] as? [String: Any])?["A"] as? [String: Any])?["cursor"] as? Int == i }
            qa.stroke()
            qa.tapNative("native-write-done")
            qa.waitProbe("compare \(i)") { (($0["native"] as? [String: Any])?["phase"] as? String) == "compare" }
            Thread.sleep(forTimeInterval: 0.6)
            qa.tapNative("native-write-correct")
        }
        qa.waitResult(true)
        XCTAssertTrue(qa.transitions.contains("present:phase"), "\(qa.transitions)")
        qa.waitProbe("transition settled") { ($0["navRunning"] as? Int) == 0 }
        qa.tapNative("native-result-close")
        qa.waitResult(false)
        qa.waitRouteTop("home")
        XCTAssertTrue(qa.transitions.contains("dismiss:paper"), "the result page folds back into the home button: \(qa.transitions)")
        XCTAssertFalse(qa.transitions.contains("overlap"), "\(qa.transitions)")
        XCTAssertTrue(qa.webNav.contains("pop:native"), "\(qa.webNav)")
    }
}
