import XCTest

// B3.9 流程测试（练习记录 / 月字帖 / 年报）：原生三屏的进出、翻月、展开某天进单字详情再回来、月字帖、年报切年份 / 往年、
// 图片按钮开原生图片预览、从这几页返回。
//
// 夹具（ShiziUITests/States/）：records-day（展开 10 月 18 日）、records-month（练习记录有月历与字帖块）、month-ink（2026 年 9 月的字帖）、
// annual-report（2026 年一卷）、annual-past-year（今年没有记录 → 2025 年）、annual-two-years（两年，用来切年份；只给流程测试用，不进逐屏对比）。
// 断言：原生元素经 accessibilityIdentifier 找（native-records-* / native-month-* / native-annual-*）；路由与原生栈经探针看。
// 单字详情（B3.7 起原生）推在原生栈上：返回走它页头的「‹」（被盖住的页的「‹」不在无障碍树里，R14），回来时原页还在、状态不变。

@MainActor
final class MineSubFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// 原生栈：看得见的根页 + 推入的原生页（同 MineFlowTests.stack）。
    nonisolated private static func stack(_ p: [String: Any]) -> [String] {
        let st = p["stage"] as? [String: Any] ?? [:]
        let pushed = st["screens"] as? [String] ?? []
        if let r = st["root"] as? [String: Any], let name = r["screen"] as? String, (r["hidden"] as? Bool) != true { return [name] + pushed }
        return pushed
    }

    private func top(_ p: [String: Any]) -> String? { (p["route"] as? [String: Any])?["top"] as? String }

    /// 等某个原生元素的读屏名变成某个值。
    private func waitLabel(_ qa: QA, _ id: String, _ expected: String, timeout: TimeInterval = 12) -> Bool {
        let end = Date().addingTimeInterval(timeout * QALoad.scale)
        while Date() < end {
            let e = qa.el(id)
            if e.exists, e.label == expected { return true }
            Thread.sleep(forTimeInterval: 0.3)
        }
        return false
    }

    /// 等某个原生元素的读屏名不再是某个值（返回最后的读屏名）。
    private func waitLabelChanged(_ qa: QA, _ id: String, from: String, timeout: TimeInterval = 12) -> String {
        let end = Date().addingTimeInterval(timeout * QALoad.scale)
        var last = ""
        while Date() < end {
            let e = qa.el(id)
            if e.exists {
                last = e.label
                if last != from { return last }
            }
            Thread.sleep(forTimeInterval: 0.3)
        }
        return last
    }

    /// 页头「‹」：只有最上面那一页的在无障碍树里（R14），点它回到下面一页。
    private func tapPageBack(_ qa: QA, file: StaticString = #filePath, line: UInt = #line) {
        let backs = qa.app.descendants(matching: .any).matching(identifier: "native-page-back")
        XCTAssertEqual(backs.count, 1, "only the top page's back button is reachable", file: file, line: line)
        qa.tap(backs.firstMatch, "page back ‹", file: file, line: line)
    }

    /// 把原生页往下滚一点（页左边距那一列没有可点的东西）。
    private func scrollDown(_ qa: QA) {
        let start = qa.app.coordinate(withNormalizedOffset: CGVector(dx: 0.03, dy: 0.72))
        let end = qa.app.coordinate(withNormalizedOffset: CGVector(dx: 0.03, dy: 0.32))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: 600, thenHoldForDuration: 0.05)
        Thread.sleep(forTimeInterval: 0.4)
    }

    /// 图片按钮 → 原生图片预览弹层（B3.11：与结果页同一个弹层）→「完成」收起，回到原页。
    private func openAndCloseImagePreview(_ qa: QA, button id: String, page: String, file: StaticString = #filePath, line: UInt = #line) {
        let b = qa.el(id)
        XCTAssertTrue(b.waitForExistence(timeout: 10 * QALoad.scale), "\(id) is there", file: file, line: line)
        for _ in 0..<8 where !b.isHittable { scrollDown(qa) }
        qa.tap(b, id, file: file, line: line)
        let save = qa.el("native-image-save")
        XCTAssertTrue(save.waitForExistence(timeout: 20 * QALoad.scale), "the native image preview is up (\(id))", file: file, line: line)
        XCTAssertEqual(top(qa.probe), page, "the preview is a sheet over \(page), not a page of its own", file: file, line: line)
        qa.tapNative("native-image-done", file: file, line: line)
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: save)
        waitForExpectations(timeout: 10 * QALoad.scale)
        XCTAssertEqual(top(qa.probe), page, "closing the preview leaves \(page) where it was", file: file, line: line)
    }

    // MARK: 练习记录

    /// 练习记录：原生页出来 → 翻到上一个月 → 月份标签跟着变 → 再翻回来。
    func testRecordsMonthSwitch() {
        let qa = QA(seed: "records-day")
        qa.launch()
        qa.waitRouteTop("records", timeout: 25)
        let month = qa.el("native-records-month")
        XCTAssertTrue(month.waitForExistence(timeout: 10), "the native records page is on screen")
        let before = month.label
        XCTAssertFalse(before.isEmpty, "the month label has a name")
        qa.tapNative("native-records-prev")
        let after = waitLabelChanged(qa, "native-records-month", from: before)
        XCTAssertNotEqual(after, before, "the previous month is shown (\(before) → \(after))")
        // 再翻回来
        qa.tapNative("native-records-next")
        XCTAssertTrue(waitLabel(qa, "native-records-month", before), "back to \(before)")
    }

    /// 练习记录：点某一天 → 展开那天写的字（选中态在那一天）→ 再点同一天收起。
    func testRecordsExpandAndCollapseDay() {
        let qa = QA(seed: "records-month")
        qa.launch()
        qa.waitRouteTop("records", timeout: 25)
        XCTAssertTrue(qa.el("native-records-month").waitForExistence(timeout: 10), "the native records page is on screen")
        XCTAssertFalse(qa.el("native-records-daylist").exists, "no day is open at first")
        let day = qa.app.buttons.matching(identifier: "native-records-day").firstMatch
        XCTAssertTrue(day.waitForExistence(timeout: 8), "days with records are buttons")
        let name = day.label
        qa.tap(day, "day \(name)")
        let cells = qa.app.buttons.matching(identifier: "native-records-daylist-cell")
        XCTAssertTrue(cells.firstMatch.waitForExistence(timeout: 8 * QALoad.scale) || qa.el("native-records-daylist-paper").exists,
                      "the day opens: its grid, or the paper note")
        XCTAssertTrue(day.isSelected, "the open day reads as selected")
        qa.tap(day, "day \(name) again")
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: cells.firstMatch)
        waitForExpectations(timeout: 8 * QALoad.scale)
        XCTAssertFalse(day.isSelected, "tapping the open day again closes it")
    }

    /// 滚动手势按规则对所有页面（ShiziScrollView）：从一个按钮（日按钮）上起手的拖动也能滚页面，不被控件吃掉。
    func testDragStartingOnADayButtonScrollsThePage() {
        let qa = QA(seed: "records-month")
        qa.launch()
        qa.waitRouteTop("records", timeout: 25)
        let month = qa.el("native-records-month")
        XCTAssertTrue(month.waitForExistence(timeout: 10), "the native records page is on screen")
        let day = qa.app.buttons.matching(identifier: "native-records-day").firstMatch
        XCTAssertTrue(day.waitForExistence(timeout: 8), "days with records are buttons")
        let before = month.frame.minY
        let start = day.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = start.withOffset(CGVector(dx: 0, dy: -260))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: 500, thenHoldForDuration: 0.05)
        Thread.sleep(forTimeInterval: 0.6)
        let after = month.exists ? month.frame.minY : -10_000
        XCTAssertLessThan(after, before - 40, "the page scrolled under a drag that began on a day button (\(before) → \(after))")
        XCTAssertFalse(qa.el("native-records-daylist").exists, "the drag did not count as a tap on the day")
    }

    /// 练习记录：展开那天的一个字 → 单字详情（原生页推在练习记录上）→「‹」返回，练习记录还在、那一天还开着。
    func testRecordsDayCellIntoDetailAndBack() {
        let qa = QA(seed: "records-day")
        qa.launch()
        qa.waitRouteTop("records", timeout: 25)
        let cells = qa.app.buttons.matching(identifier: "native-records-daylist-cell")
        XCTAssertTrue(cells.firstMatch.waitForExistence(timeout: 10 * QALoad.scale), "the open day's grid is there")
        qa.tap(cells.firstMatch, "day cell")
        qa.waitProbe("detail pushed over records", timeout: 20) { self.top($0) == "detail" && Self.stack($0).suffix(2) == ["records", "detail"] && ($0["navRunning"] as? Int) == 0 }
        Thread.sleep(forTimeInterval: 0.6)
        tapPageBack(qa)
        qa.waitProbe("back on records", timeout: 20) { self.top($0) == "records" && Self.stack($0).last == "records" && ($0["navRunning"] as? Int) == 0 }
        XCTAssertTrue(qa.app.buttons.matching(identifier: "native-records-daylist-cell").firstMatch.waitForExistence(timeout: 8), "the same day is still open")
    }

    /// 练习记录：月字帖块的「10月字帖 ›」→ 原生月字帖页 → 左缘返回。
    func testRecordsSheetOpensMonthAndEdgeBack() {
        let qa = QA(seed: "records-month")
        qa.launch()
        qa.waitRouteTop("records", timeout: 25)
        let open = qa.el("native-records-sheet-open")
        XCTAssertTrue(open.waitForExistence(timeout: 10), "the copybook block is there")
        for _ in 0..<8 where !open.isHittable { scrollDown(qa) }
        qa.tap(open, "records › month copybook")
        qa.waitProbe("month pushed over records", timeout: 20) { self.top($0) == "month" && Self.stack($0).suffix(2) == ["records", "month"] && ($0["navRunning"] as? Int) == 0 }
        XCTAssertTrue(qa.el("native-month-title").waitForExistence(timeout: 10), "the native copybook page is on screen")
        Thread.sleep(forTimeInterval: 0.6)
        qa.edgeBack()
        qa.waitProbe("edge back to records", timeout: 20) { self.top($0) == "records" && Self.stack($0).last == "records" && ($0["navRunning"] as? Int) == 0 }
    }

    /// 练习记录「保存图片」→ 原生图片预览弹层 →「完成」。
    func testRecordsSaveOpensImagePreview() {
        let qa = QA(seed: "records-month")
        qa.launch()
        qa.waitRouteTop("records", timeout: 25)
        openAndCloseImagePreview(qa, button: "native-records-sheet-save", page: "records")
    }

    // MARK: 月字帖

    /// 月字帖：原生页出来 → 一格一个字（按钮，读屏名「{字} · {日期}」）→ 点一个字进单字详情 →「‹」返回。
    func testMonthCopybookOpensDetail() {
        let qa = QA(seed: "month-ink")
        qa.launch()
        qa.waitRouteTop("month", timeout: 25)
        XCTAssertTrue(qa.el("native-month-title").waitForExistence(timeout: 10), "the native month page is on screen")
        XCTAssertTrue(qa.el("native-month-paper").exists, "the copybook paper is there")
        let cells = qa.app.buttons.matching(NSPredicate(format: "label CONTAINS %@", " · "))
        XCTAssertTrue(cells.firstMatch.waitForExistence(timeout: 8), "the copybook cells are there")
        XCTAssertGreaterThanOrEqual(cells.count, 10, "the whole month is laid out (\(cells.count))")
        qa.tap(cells.element(boundBy: 1), "copybook cell")
        qa.waitProbe("detail pushed over month", timeout: 20) { self.top($0) == "detail" && Self.stack($0).suffix(2) == ["month", "detail"] && ($0["navRunning"] as? Int) == 0 }
        Thread.sleep(forTimeInterval: 0.6)
        tapPageBack(qa)
        qa.waitProbe("back on month", timeout: 20) { self.top($0) == "month" && Self.stack($0).last == "month" && ($0["navRunning"] as? Int) == 0 }
        XCTAssertTrue(qa.el("native-month-title").waitForExistence(timeout: 10), "back on the native month page")
    }

    /// 月字帖「保存图片」与页头「调整图片 ›」都开原生图片预览弹层。
    func testMonthImageButtonsOpenPreview() {
        let qa = QA(seed: "month-ink")
        qa.launch()
        qa.waitRouteTop("month", timeout: 25)
        openAndCloseImagePreview(qa, button: "native-month-save", page: "month")
        Thread.sleep(forTimeInterval: 0.6)
        openAndCloseImagePreview(qa, button: "native-month-adjust", page: "month")
    }

    // MARK: 年报

    /// 年报：原生页出来 → 切到上一年 → 卷首的年份跟着变 → 再切回来。
    func testAnnualSwitchYear() {
        let qa = QA(seed: "annual-two-years")
        qa.launch()
        qa.waitRouteTop("annual", timeout: 25)
        let year = qa.el("native-annual-year")
        XCTAssertTrue(year.waitForExistence(timeout: 10), "the native annual page is on screen")
        let before = year.label
        XCTAssertTrue(qa.el("native-annual-prev").waitForExistence(timeout: 8), "two years: the previous-year arrow is there")
        XCTAssertFalse(qa.el("native-annual-next").isEnabled, "the latest year has no next year")
        qa.tapNative("native-annual-prev")
        let after = waitLabelChanged(qa, "native-annual-year", from: before)
        XCTAssertNotEqual(after, before, "the previous year is shown (\(before) → \(after))")
        XCTAssertFalse(qa.el("native-annual-prev").isEnabled, "the earliest year has no previous year")
        qa.tapNative("native-annual-next")
        XCTAssertTrue(waitLabel(qa, "native-annual-year", before), "back to \(before)")
    }

    /// 年报往年：今年没有记录 → 打开的是最近有记录的一年（2025，D66 ⑪）；只有一年，没有切换箭头；今年首字按折叠后的成员算（R15）。
    func testAnnualPastYear() {
        let qa = QA(seed: "annual-past-year")
        qa.launch()
        qa.waitRouteTop("annual", timeout: 25)
        let year = qa.el("native-annual-year")
        XCTAssertTrue(year.waitForExistence(timeout: 10), "the native annual page is on screen")
        XCTAssertEqual(year.label, "二〇二五", "the most recent year with records")
        XCTAssertFalse(qa.el("native-annual-prev").exists, "a single year: no year arrows")
        XCTAssertTrue(qa.el("native-annual-first-date").label.hasPrefix("3月4日"), "the year's first character is from 3月4日 (\(qa.el("native-annual-first-date").label))")
        XCTAssertEqual(qa.app.buttons.matching(identifier: "native-annual-month").count, 3, "three months: 3, 4, 5")
    }

    /// 每月一段 → 那个月的字帖（原生月字帖页推在年报上）→「‹」回到年报。
    func testAnnualMonthOpensCopybookAndBack() {
        let qa = QA(seed: "annual-report")
        qa.launch()
        qa.waitRouteTop("annual", timeout: 25)
        XCTAssertTrue(qa.el("native-annual-year").waitForExistence(timeout: 10), "the native annual page is on screen")
        let months = qa.app.buttons.matching(identifier: "native-annual-month")
        XCTAssertTrue(months.firstMatch.waitForExistence(timeout: 8), "a section per month")
        qa.tap(months.firstMatch, "annual month section")
        qa.waitProbe("month pushed over annual", timeout: 20) { self.top($0) == "month" && Self.stack($0).suffix(2) == ["annual", "month"] && ($0["navRunning"] as? Int) == 0 }
        XCTAssertTrue(qa.el("native-month-title").waitForExistence(timeout: 10), "the native copybook page is on screen")
        Thread.sleep(forTimeInterval: 0.6)
        tapPageBack(qa)
        qa.waitProbe("back on annual", timeout: 20) { self.top($0) == "annual" && Self.stack($0).last == "annual" && ($0["navRunning"] as? Int) == 0 }
    }

    /// 月段的格子只建看得见的（格子放在段按钮里铺满按钮的格网容器里）之后，真手指点照旧落在段按钮上：
    /// 点第一段的月名那一行 → 推入那个月的字帖 →「‹」回来；滑到最后一段整段进了屏、两次读到的框不变（惯性停了）为止，
    /// 真手指点它格网里的一格（第一列、最后一行）→ 同样推入字帖。
    func testAnnualMonthSectionsTakeARealTap() {
        let qa = QA(seed: "annual-report")
        qa.launch()
        qa.waitRouteTop("annual", timeout: 25)
        let months = qa.app.buttons.matching(identifier: "native-annual-month")
        XCTAssertTrue(months.firstMatch.waitForExistence(timeout: 10), "a section per month")
        months.element(boundBy: 0).coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap() // 真的点（不走 qa.tap 的 sendActions）
        qa.waitProbe("month pushed (tap on the month name row)", timeout: 20) { self.top($0) == "month" && Self.stack($0).suffix(2) == ["annual", "month"] && ($0["navRunning"] as? Int) == 0 }
        Thread.sleep(forTimeInterval: 0.6)
        tapPageBack(qa)
        qa.waitProbe("back on annual", timeout: 20) { self.top($0) == "annual" && Self.stack($0).last == "annual" && ($0["navRunning"] as? Int) == 0 }
        let count = months.count
        XCTAssertGreaterThan(count, 1, "several months")
        let last = months.element(boundBy: count - 1)
        let window = qa.app.windows.firstMatch.frame
        let footerTop = qa.el("native-annual-save").frame.minY - 12 // 底栏（保存图片）的上沿：滚动区到这里为止
        // 格网里第一列、最后一行那一格的中心：按钮下沿 − 下边距 28 − 半格（格边 ≤ 45）
        func target(_ f: CGRect) -> CGPoint { CGPoint(x: f.minX + 20, y: f.maxY - 28 - 20) }
        var lastFrame = CGRect.null
        var reached = false
        for _ in 0..<20 {
            let f = last.frame
            let p = target(f)
            if window.contains(p), p.y < footerTop, f.minY > window.minY, f == lastFrame { reached = true; break }
            lastFrame = f
            scrollDown(qa)
        }
        XCTAssertTrue(reached, "the last month section is on screen and still (\(lastFrame))")
        let f = last.frame
        last.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: target(f).x - f.minX, dy: target(f).y - f.minY)).tap()
        qa.waitProbe("month pushed (tap on a cell of the last month)", timeout: 20) { self.top($0) == "month" && Self.stack($0).suffix(2) == ["annual", "month"] && ($0["navRunning"] as? Int) == 0 }
        XCTAssertTrue(qa.el("native-month-title").waitForExistence(timeout: 10), "the native copybook page is on screen")
    }

    /// 年报卷尾「同一个字，两次」：两格墨迹与各自的日期都在（读屏名是格的说明）。
    func testAnnualTwiceAtTheEnd() {
        let qa = QA(seed: "annual-report")
        qa.launch()
        qa.waitRouteTop("annual", timeout: 25)
        let first = qa.el("native-annual-twice-first")
        let last = qa.el("native-annual-twice-last")
        XCTAssertTrue(first.waitForExistence(timeout: 10), "the twice section is laid out")
        for _ in 0..<10 where !last.isHittable { scrollDown(qa) }
        scrollDown(qa) // 滚到底：两格与日期整个露出来（截图核对）
        scrollDown(qa)
        XCTAssertTrue(first.isHittable && last.isHittable, "both cells are on screen after scrolling to the end")
        XCTAssertFalse(first.label.isEmpty, "the first cell has a name")
        XCTAssertFalse(last.label.isEmpty, "the last cell has a name")
        XCTAssertEqual(qa.app.descendants(matching: .any).matching(identifier: "native-annual-twice-date").count, 2, "a date under each cell")
        qa.attach(self, "annual-twice")
    }

    /// 年报「保存图片」→ 原生图片预览弹层 →「完成」。
    func testAnnualSaveOpensImagePreview() {
        let qa = QA(seed: "annual-report")
        qa.launch()
        qa.waitRouteTop("annual", timeout: 25)
        openAndCloseImagePreview(qa, button: "native-annual-save", page: "annual")
    }
}
