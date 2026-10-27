import XCTest
import UIKit

// B3.3 流程测试骨架（B3B4 §5.2 · 我的与子页）：每个用例先「待办」（XCTSkip），由 B3.5c / B3.9 / B3.10 的页面卡填实。
// 填的时候：用 QA(seed: "<夹具状态>") 一键到起点（夹具在 ShiziUITests/States/），数据经探针断言；把 try QAPending.skip(…) 换成真实步骤即可，不改别的文件。

@MainActor
final class MineFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// 原生栈（主线采用 B3.5a 的根页底座：根页是 stage.root，不在 stage.screens 里）——看得见的根页 + 推入的原生页，与 B3.5c 原写法的 screens 等价。
    nonisolated private static func stack(_ p: [String: Any]) -> [String] {
        let st = p["stage"] as? [String: Any] ?? [:]
        let pushed = st["screens"] as? [String] ?? []
        if let r = st["root"] as? [String: Any], let name = r["screen"] as? String, (r["hidden"] as? Bool) != true { return [name] + pushed }
        return pushed
    }

    /// 「我的」原生：探针里原生栈只有 mine。
    private func openMine(_ qa: QA) {
        qa.launch()
        qa.waitProbe("native mine") { Self.stack($0) == ["mine"] && ($0["navRunning"] as? Int) == 0 }
        Thread.sleep(forTimeInterval: 0.6) // 新状态 0.4s 防误点
    }

    private func settings(_ qa: QA) -> [String: Any] { qa.probe["settings"] as? [String: Any] ?? [:] }
    private func themeOverride(_ qa: QA) -> Int { (qa.probe["theme"] as? [String: Any])?["override"] as? Int ?? -1 }
    private func options(_ qa: QA, _ id: String) -> XCUIElementQuery { qa.app.buttons.matching(identifier: id) }

    /// 点一个原生控件，等它的效果出现。第一下偶尔被防误点的 0.4s 门槛吞掉（新状态后 0.4s 内不响应），没生效就再点一次。
    @discardableResult
    private func tapUntil(_ qa: QA, _ e: XCUIElement, _ what: String, _ effect: ([String: Any]) -> Bool) -> Bool {
        for attempt in 0..<3 {
            guard e.exists else { XCTFail("\(what): the control is gone"); return false }
            e.tap()
            Thread.sleep(forTimeInterval: 0.7)
            let end = Date().addingTimeInterval(2.5)
            while Date() < end {
                if effect(qa.probe) { return true }
                Thread.sleep(forTimeInterval: 0.25)
            }
        }
        XCTFail("\(what): the tap did not take effect")
        return false
    }

    /// 把原生页往下滚一点（页左边距那一列没有可点的东西，滑动手势不会误触字帖格）。
    private func scrollDown(_ qa: QA) {
        let start = qa.app.coordinate(withNormalizedOffset: CGVector(dx: 0.03, dy: 0.72))
        let end = qa.app.coordinate(withNormalizedOffset: CGVector(dx: 0.03, dy: 0.32))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: 600, thenHoldForDuration: 0.05)
        Thread.sleep(forTimeInterval: 0.4)
    }

    /// 屏幕某点的颜色（原生页的纸色）：外观切换后颜色要立刻跟着变，探针的 theme 只说窗口外观，纸色另取像素核对。
    private func pixel(_ shot: XCUIScreenshot, at point: CGPoint) -> (r: Int, g: Int, b: Int)? {
        guard let cg = shot.image.cgImage else { return nil }
        let px = Int(point.x * shot.image.scale)
        let py = Int(point.y * shot.image.scale)
        guard px >= 0, py >= 0, px < cg.width, py < cg.height else { return nil }
        var buf = [UInt8](repeating: 0, count: 4)
        let drawn = buf.withUnsafeMutableBytes { raw -> Bool in
            guard let ctx = CGContext(data: raw.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.translateBy(x: CGFloat(-px), y: CGFloat(-(cg.height - 1 - py))) // CGImage 原点在左下，UIImage 在左上
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: CGFloat(cg.width), height: CGFloat(cg.height)))
            return true
        }
        guard drawn else { return nil }
        return (Int(buf[0]), Int(buf[1]), Int(buf[2]))
    }

    /// 外观三段即时生效（浅 / 深）：点第 3 段（夜间）→ 存下 dark、选中态换过去、原生主题立刻是深色；再点第 2 段（日间）→ 浅。
    func testAppearanceSegmentsApplyAtOnce() throws {
        let qa = QA(seed: "mine-records")
        openMine(qa)
        XCTAssertEqual(themeOverride(qa), 0, "follows the system until a choice is made")
        let seg = options(qa, "native-mine-appearance-option")
        XCTAssertEqual(seg.count, 3)
        // 纸色（页左边距，网页的纸 = #F4EFE6 / 深色 #1B1814）：外观切换后原生页的颜色要立刻跟着变
        let lightPaper = pixel(XCUIScreen.main.screenshot(), at: CGPoint(x: 6, y: 300))
        XCTAssertNotNil(lightPaper)
        XCTAssertGreaterThan(lightPaper?.r ?? 0, 150, "the native page starts on the light paper")
        tapUntil(qa, seg.element(boundBy: 2), "appearance › dark") { p in
            (p["settings"] as? [String: Any])?["appearance"] as? String == "dark" && (p["theme"] as? [String: Any])?["override"] as? Int == 2
        }
        XCTAssertTrue(seg.element(boundBy: 2).isSelected)
        XCTAssertFalse(seg.element(boundBy: 0).isSelected)
        Thread.sleep(forTimeInterval: 0.5)
        let darkPaper = pixel(XCUIScreen.main.screenshot(), at: CGPoint(x: 6, y: 300))
        XCTAssertLessThan(darkPaper?.r ?? 255, 100, "the native page turns dark right after the switch")
        tapUntil(qa, seg.element(boundBy: 1), "appearance › light") { p in
            (p["settings"] as? [String: Any])?["appearance"] as? String == "light" && (p["theme"] as? [String: Any])?["override"] as? Int == 1
        }
        XCTAssertTrue(seg.element(boundBy: 1).isSelected)
        Thread.sleep(forTimeInterval: 0.5)
        let backLight = pixel(XCUIScreen.main.screenshot(), at: CGPoint(x: 6, y: 300))
        XCTAssertGreaterThan(backLight?.r ?? 0, 150, "and back to the light paper")
        tapUntil(qa, seg.element(boundBy: 0), "appearance › follow system") { p in
            (p["settings"] as? [String: Any])?["appearance"] as? String == "auto" && (p["theme"] as? [String: Any])?["override"] as? Int == 0
        }
        XCTAssertTrue(seg.element(boundBy: 0).isSelected)
    }

    /// 每组字数改了从下一组起生效：点第 1 段（5）→ 存下 5，选中态换过去；失败时行下就地三段式，再试一次成功后收起（D07）。
    /// 两个入口读同一个设置：重开 App 后，经原生 Tab 栏（B3.5d）到首页「开始写字」开成 5 个字的一组，字库「今日练习」续同一组。
    func testGroupSizeSyncsHomeAndLibrary() throws {
        let qa = QA(seed: "mine-records", failNext: 1)
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
        // 重开：原生写的设置留在 store 里，首页 / 字库读同一个值
        qa.relaunchWithoutSeed()
        XCTAssertEqual(settings(qa)["groupSize"] as? Int, 5, "the setting the native page wrote survives a relaunch")
        qa.tap(qa.button("写字"), "home tab") // tab 名的文案是「写字」（copy X-TABS.write），不是架构文档里的旧称
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

    /// AX5 外观选择弹层：点开底部弹层 → 选「夜间」即写并关，原生窗口外观立刻变深；再点开、用「完成」关掉，设置不变。
    func testAx5AppearanceSheetOpenSelectClose() throws {
        let qa = QA(seed: "mine-records", extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        openMine(qa)
        XCTAssertEqual(themeOverride(qa), 0, "follows the system until a choice is made")
        qa.tapNative("native-mine-appearance")
        XCTAssertTrue(qa.el("native-mine-appearance-sheet").waitForExistence(timeout: 6), "the appearance sheet opens")
        let opts = options(qa, "native-mine-appearance-sheet-option")
        XCTAssertEqual(opts.count, 3, "auto / light / dark")
        Thread.sleep(forTimeInterval: 0.5)
        tapUntil(qa, opts.element(boundBy: 2), "sheet › 夜间") { p in
            (p["settings"] as? [String: Any])?["appearance"] as? String == "dark" && (p["theme"] as? [String: Any])?["override"] as? Int == 2
        }
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: qa.el("native-mine-appearance-sheet"))
        waitForExpectations(timeout: 6)
        // 再点开、用「完成」关掉：设置不变
        qa.tapNative("native-mine-appearance")
        XCTAssertTrue(qa.el("native-mine-appearance-sheet").waitForExistence(timeout: 6), "the appearance sheet opens again")
        qa.tap(qa.el("native-sheet-done"), "sheet › 完成")
        expectation(for: gone, evaluatedWith: qa.el("native-mine-appearance-sheet"))
        waitForExpectations(timeout: 6)
        XCTAssertEqual(settings(qa)["appearance"] as? String, "dark", "closing the sheet without choosing changes nothing")
        XCTAssertEqual(themeOverride(qa), 2)
    }

    /// 各行进入子页再返回：提醒 / 换库 / 练习记录 / 年报（都是原生子页，推在「我的」上）左缘返回后回到原生「我的」。
    func testEachRowOpensItsPageAndComesBack() throws {
        let qa = QA(seed: "mine-records")
        openMine(qa)
        let rows: [(String, String)] = [("native-mine-remind", "remind"), ("native-mine-library", "library-switch"),
                                        ("native-mine-sheet-head", "records"), ("native-mine-menu-annual", "annual")]
        for (id, screen) in rows {
            let row = qa.el(id)
            XCTAssertTrue(row.waitForExistence(timeout: 8), "row \(id) exists")
            for _ in 0..<8 where !row.isHittable { scrollDown(qa) }
            XCTAssertTrue(row.isHittable, "row \(id) is on screen")
            tapUntil(qa, row, "row \(id)") { p in
                (p["route"] as? [String: Any])?["top"] as? String == screen && (p["navRunning"] as? Int) == 0
            }
            Thread.sleep(forTimeInterval: 0.6)
            qa.edgeBack()
            qa.waitProbe("back on native mine") { (($0["route"] as? [String: Any])?["top"] as? String) == "mine" && Self.stack($0) == ["mine"] && ($0["navRunning"] as? Int) == 0 }
            Thread.sleep(forTimeInterval: 0.6)
        }
    }

    /// AX5 改选择弹层：AX 档外观 / 每组字数是「名称 …… 值 ›」，点开底部弹层，选一项即写并关。
    func testAx5ChoiceSheet() throws {
        let qa = QA(seed: "mine-records", extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
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
        let qa = QA(seed: "mine-records", failNext: 1, extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
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
        let qa = QA(seed: "mine-records", extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        openMine(qa)
        let before = settings(qa)["groupSize"] as? Int
        qa.tapNative("native-mine-group-size")
        XCTAssertTrue(qa.el("native-mine-group-size-sheet").waitForExistence(timeout: 6))
        let window = qa.app.windows.firstMatch
        let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.55)).withOffset(CGVector(dx: 2, dy: 0))
        let short = window.coordinate(withNormalizedOffset: CGVector(dx: 0.18, dy: 0.55))
        start.press(forDuration: 0.05, thenDragTo: short, withVelocity: 80, thenHoldForDuration: 0.3)
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertTrue(qa.el("native-mine-group-size-sheet").exists, "a short, slow edge drag snaps the sheet back")
        qa.edgeBack()
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: qa.el("native-mine-group-size-sheet"))
        waitForExpectations(timeout: 6)
        XCTAssertEqual(settings(qa)["groupSize"] as? Int, before)
        XCTAssertEqual(Self.stack(qa.probe), ["mine"])
    }

    /// 推入原生子页再回来：原生「我的」→ 点练习记录行 → 原生练习记录推在「我的」上（B3.9 起原生；「我的」下面已没有网页子页可让）
    /// = 原生栈 [mine, records]、根页不让开 → 左缘返回 → [mine]；推入关于 = [mine, about]，「‹」回到 mine，根页没有「‹」也没有左缘返回。
    func testYieldToWebAndBack() throws {
        let qa = QA(seed: "mine-records")
        openMine(qa)
        XCTAssertFalse(qa.el("native-page-back").isHittable, "a tab root has no back button")
        let records = qa.el("native-mine-sheet-head")
        for _ in 0..<8 where !records.isHittable { scrollDown(qa) }
        qa.tap(records, "row 练习记录")
        qa.waitProbe("native records pushed over native mine") { (($0["route"] as? [String: Any])?["top"] as? String) == "records" && Self.stack($0) == ["mine", "records"] && ($0["navRunning"] as? Int) == 0 }
        XCTAssertTrue(qa.el("native-records-month").waitForExistence(timeout: 10), "the native records page is on screen")
        Thread.sleep(forTimeInterval: 0.6)
        qa.edgeBack()
        qa.waitProbe("back on native mine") { (($0["route"] as? [String: Any])?["top"] as? String) == "mine" && Self.stack($0) == ["mine"] && ($0["navRunning"] as? Int) == 0 }
        Thread.sleep(forTimeInterval: 0.6)
        qa.tapNative("native-mine-menu-about")
        qa.waitProbe("native about over native mine") { Self.stack($0) == ["mine", "about"] && ($0["navRunning"] as? Int) == 0 }
        Thread.sleep(forTimeInterval: 0.6)
        // R14：盖在关于页下面的「我的」根页不进无障碍树（读屏摸不到；页头「‹」只剩关于页那一个）
        XCTAssertFalse(qa.el("native-mine-menu-about").exists, "the covered native root is out of the accessibility tree")
        XCTAssertEqual(qa.app.descendants(matching: .any).matching(identifier: "native-page-back").count, 1, "only the top page's back button is reachable")
        qa.tapNative("native-page-back")
        qa.waitProbe("back to native mine only") { Self.stack($0) == ["mine"] && (($0["route"] as? [String: Any])?["top"] as? String) == "mine" }
    }

    // B3.9 的三条骨架（练习记录翻月 / 展开某天、月字帖、年报往年）已填实，在 MineSubFlowTests 里（与图片按钮、返回路径一起）。

    /// 提醒开关 / 时间 / 被拒跳设置
    func testRemindSwitchTimeDenied() throws { try QAPending.skip("B3.10", "提醒开关 / 时间 / 被拒跳设置") }
}
