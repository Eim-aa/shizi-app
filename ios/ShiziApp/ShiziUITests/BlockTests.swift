import XCTest

// B3.13 阻断页（原生 ShiziScreen_block）的流程：
// 阻断期间只画这一页（不画 Tab、不能返回）；三种来由（存储不可用 / 写失败回滚失败 / 迁移失败）各有各的入口。
// 引擎不可用时这一页也要能画：原生版不依赖 JS 回包（文案在 ShiziCopy，来由取 params / 引擎状态）。
//
// 网页路由仍是真相源（探针 route 是网页栈），stage.screens 是原生栈（底 → 顶）。

@MainActor
final class BlockTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func stage(_ qa: QA) -> [String] { ((qa.probe["stage"] as? [String: Any])?["screens"] as? [String]) ?? [] }

    private func waitStage(_ qa: QA, _ want: [String], file: StaticString = #filePath, line: UInt = #line) {
        qa.waitProbe("stage \(want)", file: file, line: line) { (($0["stage"] as? [String: Any])?["screens"] as? [String]) == want && ($0["navRunning"] as? Int) == 0 }
    }

    /// 阻断：存储不可用（注入）。只有「再试一次」，没有导出备份，也没有返回键（不可返回）。
    func testUnavailableBlock() throws {
        let qa = QA(seed: "block-unavailable")
        qa.launch()
        waitStage(qa, ["block"])
        XCTAssertTrue(qa.el("native-block-title").waitForExistence(timeout: 8), "阻断页的标题")
        XCTAssertTrue(qa.el("native-block-retry").exists, "「再试一次」")
        XCTAssertFalse(qa.el("native-block-export").exists, "存储不可用时没有「导出备份」")
        XCTAssertFalse(qa.el("native-page-back").exists, "阻断页不可返回")
    }

    /// 阻断：写失败回滚失败（可导出备份）——多一枚「导出备份」。
    func testBlockedBlockWithExport() throws {
        let qa = QA(seed: "block-blocked")
        qa.launch()
        waitStage(qa, ["block"])
        XCTAssertTrue(qa.el("native-block-title").waitForExistence(timeout: 8), "阻断页的标题")
        XCTAssertTrue(qa.el("native-block-retry").exists, "「再试一次」")
        XCTAssertTrue(qa.el("native-block-export").exists, "「导出备份」")
        XCTAssertFalse(qa.el("native-block-migration").exists, "不是迁移变体")
    }

    /// 阻断：迁移——说明里多一句「没能导入这一版」。
    func testMigrationBlock() throws {
        let qa = QA(seed: "block-migration")
        qa.launch()
        waitStage(qa, ["block"])
        XCTAssertTrue(qa.el("native-block-title").waitForExistence(timeout: 8), "阻断页的标题")
        XCTAssertTrue(qa.el("native-block-migration").waitForExistence(timeout: 8), "迁移那一句")
        XCTAssertTrue(qa.el("native-block-retry").exists, "「再试一次」")
    }

    /// 导出备份：导出成功不提示（系统分享面板本身就是反馈，F5）——失败才就地三段式。
    func testExportBackupFromBlock() throws {
        let qa = QA(seed: "block-blocked")
        qa.launch()
        waitStage(qa, ["block"])
        XCTAssertTrue(qa.el("native-block-export").waitForExistence(timeout: 8), "「导出备份」")
        // 点一下：系统分享面板弹出来（不校验面板本身，只断言没有走进「导出没成」的三段式）
        qa.tap(qa.el("native-block-export"), "导出备份", verify: false)
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertFalse(qa.el("native-block-export-fail").exists, "导出没成时才有三段式")
    }

    /// 再试一次：存储还是不可用时，说明里多一句「还是存不了」（S1 三段式）。
    func testRetry() throws {
        let qa = QA(seed: "block-unavailable")
        qa.launch()
        waitStage(qa, ["block"])
        XCTAssertTrue(qa.el("native-block-retry").waitForExistence(timeout: 8), "「再试一次」")
        Thread.sleep(forTimeInterval: 0.5) // 新状态 0.4s 防误点
        qa.tapNative("native-block-retry")
        XCTAssertTrue(qa.el("native-block-still").waitForExistence(timeout: 8), "「还是存不了」")
    }
}
