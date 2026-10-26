import XCTest

// B3.11 流程测试（原生图片预览弹层）：结果页「分享」→ 原生弹层；比例切换、「也放进来」、> 80 字分页、保存、失败提示条。
// 起点用 QA(seed: "<夹具状态>") 一键到（夹具在 ShiziUITests/States/）；原生弹层里的控件经 accessibilityIdentifier 找
// （native-image-ratio / native-image-chip / native-image-save / native-image-share / native-image-long / native-image-done），
// 数据与状态经探针（qa-probe）。比例与「也放进来」的选中态读无障碍的 selected 特性（网页是 aria-pressed）。

@MainActor
final class ImageFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// 比例切换（3:4 / 1:1）：默认比例由这次作品的字数定（网页 core/images/layout.js defaultRatio），切到另一档后选中态跟着走。
    func testRatioSwitch() throws {
        let qa = QA(seed: "preview-3x4")
        qa.launch()
        let r34 = qa.ratioButton("3:4")
        let r11 = qa.ratioButton("1:1")
        XCTAssertTrue(r34.waitForExistence(timeout: 15 * QALoad.scale), "比例键在弹层里")
        XCTAssertTrue(r11.waitForExistence(timeout: 15 * QALoad.scale), "比例键在弹层里")
        // 参考图（Reference/preview-3x4_light_L）里预览板是 270 × 270 = 1:1 → 默认就是 1:1
        XCTAssertTrue(r11.isSelected, "默认比例是 1:1")
        XCTAssertFalse(r34.isSelected, "3:4 起初没选中")
        qa.tap(r34, "比例 3:4")
        XCTAssertTrue(waitSelected(r34), "切到 3:4 后选中态在 3:4")
        XCTAssertFalse(r11.isSelected, "切到 3:4 后 1:1 不再选中")
        qa.tap(r11, "比例 1:1")
        XCTAssertTrue(waitSelected(r11), "切回 1:1 后选中态回到 1:1")
    }

    /// 「也放进来」：点一个写错的字 → 它进了图（选中态），图也重画。
    func testAlsoPutIn() throws {
        let qa = QA(seed: "_preview-open")
        qa.launch()
        let chip = qa.el("native-image-chip")
        XCTAssertTrue(chip.waitForExistence(timeout: 15 * QALoad.scale), "「也放进来」的写错的字在弹层里")
        XCTAssertFalse(chip.isSelected, "起初没放进图里")
        qa.tap(chip, "也放进来 · 写错的字")
        XCTAssertTrue(waitSelected(chip), "点一下之后这个字进了图")
    }

    /// > 80 字分页：90 个字存成 2 张（说明句与保存键都写着 2 张）。
    func testPagedOver80Chars() throws {
        let qa = QA(seed: "preview-paged")
        qa.launch()
        let note = qa.el("native-image-note")
        XCTAssertTrue(note.waitForExistence(timeout: 20 * QALoad.scale), "说明句在弹层里")
        XCTAssertTrue(note.label.contains("90"), "说明句写着 90 个字：\(note.label)")
        XCTAssertTrue(note.label.contains("2 张"), "说明句写着存成 2 张：\(note.label)")
        let save = qa.el("native-image-save")
        XCTAssertTrue(save.waitForExistence(timeout: 10 * QALoad.scale), "保存键在弹层里")
        XCTAssertEqual(save.label, "保存 2 张")
    }

    /// 保存：相册权限由系统（这里桩掉写入，原生弹层按网页同一口径回「已存好」）。
    func testSaveToPhotos() throws {
        let qa = QA(seed: "_preview-open")
        qa.launch()
        let save = qa.el("native-image-save")
        XCTAssertTrue(save.waitForExistence(timeout: 15 * QALoad.scale), "保存键在弹层里")
        // 视图模型还没到手时键是空的（网页同口径：键上有字了才能点）；忙时键也是禁用的 → 都等
        XCTAssertTrue(waitReady(save, timeout: 20 * QALoad.scale), "保存键有文案且可点")
        // 「已存好」只闪 1.5 秒（网页 motion.timing.savedFlash）：qa.tap 的点按校验要读探针（一次 ~1s），
        // 校验完那一瞬已经过去了 → 这里不校验，点完立刻密轮询文案
        qa.tap(save, "保存图片", verify: false)
        let end = Date().addingTimeInterval(10 * QALoad.scale)
        var saved = false
        while Date() < end, !saved {
            saved = save.label == "已存好"
            if !saved { Thread.sleep(forTimeInterval: 0.02) }
        }
        XCTAssertTrue(saved, "保存成功后键原地变「已存好」")
    }

    /// 失败 Toast：分享失败 → 原生提示条（文案在网页一侧，出条是原生）。
    /// 提示条只存在 3.2s（网页 motion.timing.toast）：不等夹具跑完，边等边找。
    func testFailureToast() throws {
        let qa = QA(seed: "toast-share-failed")
        qa.app.launch()
        let text = qa.el("native-toast-text")
        let end = Date().addingTimeInterval(30 * QALoad.scale)
        var seen = false
        var label = ""
        while Date() < end, !seen {
            seen = text.exists
            if seen { label = text.label }
            if !seen { Thread.sleep(forTimeInterval: 0.1) }
        }
        XCTAssertTrue(seen, "失败提示条出来了")
        XCTAssertEqual(label, "图片没有分享出去，可以再试一次。")
    }
}

extension QA {
    /// 弹层里的比例键（accessibilityValue = 比例文字；网页是 data-ratio）。
    func ratioButton(_ ratio: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier == %@ AND value == %@", "native-image-ratio", ratio)).firstMatch
    }
}

extension ImageFlowTests {
    /// 等一个键的选中态（原生重画是异步的：点完要等它换视图）。
    func waitSelected(_ e: XCUIElement, timeout: TimeInterval = 8) -> Bool {
        let end = Date().addingTimeInterval(timeout * QALoad.scale)
        while Date() < end {
            if e.isSelected { return true }
            Thread.sleep(forTimeInterval: 0.25)
        }
        return e.isSelected
    }

    /// 等一个键「有文案且可点」（视图模型没到手时键是空的；忙的时候是禁用的）。
    func waitReady(_ e: XCUIElement, timeout: TimeInterval = 10) -> Bool {
        let end = Date().addingTimeInterval(timeout * QALoad.scale)
        while Date() < end {
            if e.exists, !e.label.isEmpty, e.isEnabled { return true }
            Thread.sleep(forTimeInterval: 0.2)
        }
        return e.exists && !e.label.isEmpty && e.isEnabled
    }
}
