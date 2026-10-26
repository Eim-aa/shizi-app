import XCTest

// B3.9 流程测试（练习记录 / 月字帖 / 年报）：原生三屏的进出、翻月、展开某天进单字详情再回来、年报切年份。
//
// 夹具（ShiziUITests/States/）：records-day（展开 10 月 18 日）、records-month（练习记录有月历与字帖块）、month-ink（2026 年 9 月的字帖）、
// annual-report（2026 年一卷）、annual-two-years（两年，用来切年份；只给流程测试用，不进逐屏对比）。
// 断言：原生元素经 accessibilityIdentifier 找（native-records-* / native-month-* / native-annual-*）；路由经探针看；
// 单字详情是网页页（「返回」按钮是网页页头的），返回后原生页重新盖上来。

@MainActor
final class MineSubFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

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

    /// 网页页头的「返回」：单字详情是网页页，回到原生页走它。
    private func tapWebBack(_ qa: QA, file: StaticString = #filePath, line: UInt = #line) {
        let b = qa.button("返回")
        guard b.waitForExistence(timeout: 8 * QALoad.scale) else {
            XCTFail("the web back button is not there", file: file, line: line)
            return
        }
        b.tap()
    }

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

    /// 练习记录：点某一天 → 展开那天写的字 → 点一个字进单字详情 → 返回，原生页还在。
    func testRecordsExpandDayIntoDetailAndBack() {
        let qa = QA(seed: "records-month")
        qa.launch()
        qa.waitRouteTop("records", timeout: 25)
        XCTAssertTrue(qa.el("native-records-month").waitForExistence(timeout: 10), "the native records page is on screen")
        // 月历里有记录的日子是按钮：点第一个
        let days = qa.app.buttons.matching(identifier: "native-records-day")
        XCTAssertTrue(days.firstMatch.waitForExistence(timeout: 8), "days with records are buttons")
        days.firstMatch.tap()
        // 展开的那一天：格网出现
        let cells = qa.app.buttons.matching(identifier: "native-records-daylist-cell")
        guard cells.firstMatch.waitForExistence(timeout: 8) else {
            // 纸上写的一天：只有一句说明，没有格子
            XCTAssertTrue(qa.el("native-records-daylist-paper").exists, "either the grid or the paper note")
            return
        }
        cells.firstMatch.tap()
        qa.waitRouteTop("detail", timeout: 20)
        // 返回：网页的单字详情退回来，原生练习记录还在
        tapWebBack(qa)
        qa.waitRouteTop("records", timeout: 20)
        XCTAssertTrue(qa.el("native-records-month").waitForExistence(timeout: 10), "back on the native records page")
    }

    /// 月字帖：原生页出来 → 格子里有墨 → 点一个字进单字详情 → 返回。
    func testMonthCopybookOpensDetail() {
        let qa = QA(seed: "month-ink")
        qa.launch()
        qa.waitRouteTop("month", timeout: 25)
        XCTAssertTrue(qa.el("native-month-title").waitForExistence(timeout: 10), "the native month page is on screen")
        let cells = qa.app.buttons.matching(identifier: "native-month-cell")
        XCTAssertTrue(cells.firstMatch.waitForExistence(timeout: 8), "the copybook cells are there")
        XCTAssertTrue(cells.count >= 10, "the whole month is laid out (\(cells.count))")
        cells.element(boundBy: 1).tap()
        qa.waitRouteTop("detail", timeout: 20)
        tapWebBack(qa)
        qa.waitRouteTop("month", timeout: 20)
        XCTAssertTrue(qa.el("native-month-title").waitForExistence(timeout: 10), "back on the native month page")
    }

    /// 年报：原生页出来 → 切到上一年 → 卷首的年份跟着变 → 再切回来。
    func testAnnualSwitchYear() {
        let qa = QA(seed: "annual-two-years")
        qa.launch()
        qa.waitRouteTop("annual", timeout: 25)
        let year = qa.el("native-annual-year")
        XCTAssertTrue(year.waitForExistence(timeout: 10), "the native annual page is on screen")
        let before = year.label
        XCTAssertTrue(qa.el("native-annual-prev").waitForExistence(timeout: 8), "two years: the previous-year arrow is there")
        qa.tapNative("native-annual-prev")
        let after = waitLabelChanged(qa, "native-annual-year", from: before)
        XCTAssertNotEqual(after, before, "the previous year is shown (\(before) → \(after))")
        qa.tapNative("native-annual-next")
        XCTAssertTrue(waitLabel(qa, "native-annual-year", before), "back to \(before)")
    }

    /// 每月一段 → 那个月的字帖（原生月字帖页）。
    func testAnnualMonthOpensCopybook() {
        let qa = QA(seed: "annual-report")
        qa.launch()
        qa.waitRouteTop("annual", timeout: 25)
        XCTAssertTrue(qa.el("native-annual-year").waitForExistence(timeout: 10), "the native annual page is on screen")
        let months = qa.app.buttons.matching(identifier: "native-annual-month")
        XCTAssertTrue(months.firstMatch.waitForExistence(timeout: 8), "a section per month")
        months.firstMatch.tap()
        qa.waitRouteTop("month", timeout: 20)
        XCTAssertTrue(qa.el("native-month-title").waitForExistence(timeout: 10), "the native copybook page is on screen")
    }
}
