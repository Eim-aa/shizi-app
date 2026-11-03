import XCTest

// B3.10 备份页流程（原生 Screens/Backup.swift，屏名 backup；网页 src/ui/screens/mine/backup.js）。
// 夹具：ShiziUITests/States/backup-*.json（网页参考、原生取证、流程测试同一份）。
// 断言：原生元素经 accessibilityIdentifier（native-backup-*）找；数据经探针（记录条数 qa.records）。
// 纯容器（native-backup-body / native-backup-note / 确认框本身）不是读屏元素，测试用里面的文字与按钮判断。
// QA 运行（-shizi-qa）里「用户选中的文件」放在网页侧 window.__qaBackupPick（原生页把它写成临时文件，走与系统选择器同一条预检）。
@MainActor
final class BackupFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    // MARK: 辅助

    /// 备份页起来（夹具把路由推到 backup）。
    private func launchBackup(_ seed: String, failNext: Int = 0, file: StaticString = #filePath, line: UInt = #line) -> QA {
        let qa = QA(seed: seed, failNext: failNext)
        qa.launch()
        XCTAssertTrue(qa.el("native-backup-restore").waitForExistence(timeout: 30 * QALoad.scale), "backup page (\(seed))", file: file, line: line)
        return qa
    }

    /// 元素出现 / 消失（等一段时间；返回有没有等到）。
    @discardableResult
    private func waitExists(_ qa: QA, _ id: String, _ want: Bool, timeout: TimeInterval = 8, quiet: Bool = false, file: StaticString = #filePath, line: UInt = #line) -> Bool {
        let end = Date().addingTimeInterval(timeout * QALoad.scale)
        while Date() < end {
            if qa.el(id).exists == want { return true }
            Thread.sleep(forTimeInterval: 0.25)
        }
        if !quiet {
            XCTFail("\(id) \(want ? "没有出现" : "没有消失")", file: file, line: line)
        }
        return false
    }

    /// 点一下某个元素（等它出现再点；等 0.4s 防误点窗口）。
    @discardableResult
    private func tap(_ qa: QA, _ id: String, file: StaticString = #filePath, line: UInt = #line) -> Bool {
        let e = qa.el(id)
        guard e.waitForExistence(timeout: 8 * QALoad.scale) else {
            XCTFail("找不到：\(id)", file: file, line: line)
            return false
        }
        e.tap()
        Thread.sleep(forTimeInterval: 0.6)
        return true
    }

    /// 记录条数等到某个值（探针每 0.3s 刷一次）。
    private func waitRecords(_ qa: QA, _ want: Int, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
        let end = Date().addingTimeInterval(timeout * QALoad.scale)
        var last = qa.records
        while Date() < end {
            last = qa.records
            if last == want { return }
            Thread.sleep(forTimeInterval: 0.25)
        }
        XCTFail("记录条数：期望 \(want)，实际 \(last)", file: file, line: line)
    }

    // MARK: 用例

    /// 导出：系统分享面板出现（分享完成才记「上次备份」；这里只看面板出现）。
    func testExportShowsShareSheet() throws {
        let qa = launchBackup("backup-recent")
        let export = qa.el("native-backup-export")
        XCTAssertTrue(export.waitForExistence(timeout: 8 * QALoad.scale), "export button")
        XCTAssertTrue(export.isEnabled, "有记录时导出可点")
        export.tap()
        // UIActivityViewController（iPhone 上是底部面板）
        let activity = qa.app.otherElements["ActivityListView"]
        let sheet = qa.app.sheets.firstMatch
        XCTAssertTrue(activity.waitForExistence(timeout: 20) || sheet.waitForExistence(timeout: 3), "分享面板没有出现")
        XCTAssertFalse(qa.el("native-backup-export-fail-note").exists, "导出没有失败")
    }

    /// 导入预检拒收三种（太大 / 不是备份 / 取消）。
    /// · 太大与「不是备份」在网页侧是同一条分支（都落到 R-B06.notBackup 说明框；core/backup.js 的 failureKind：tooLarge / json / format → notBackup），
    ///   原生侧走的是同一张说明框；「太大」那一步的口径在 test/core/backup.test.mjs 里已覆盖（inspectBackup 的 tooLarge → notBackup）。
    /// · 取消：什么都不显示（网页 receiveRejected 的 cancelled 分支）。
    func testImportPrecheckRejectsThreeKinds() throws {
        // 不是备份（夹具 backup-reject 已把「坏文件」放进 QA 通道，点按由夹具的步骤完成）
        let bad = launchBackup("backup-reject")
        XCTAssertTrue(bad.el("native-backup-note-text").waitForExistence(timeout: 20), "不是备份：说明框")
        // 太大（夹具 backup-too-large：QA 通道里是一个超过 64MB 上限的文件）
        let big = launchBackup("backup-too-large")
        tap(big, "native-backup-restore")
        XCTAssertTrue(big.el("native-backup-note-text").waitForExistence(timeout: 20), "太大：说明框")
        // 取消：没有选中文件 → 什么都不显示
        let cancel = launchBackup("backup-recent")
        tap(cancel, "native-backup-restore")
        Thread.sleep(forTimeInterval: 2.0)
        XCTAssertFalse(cancel.el("native-backup-note-text").exists, "取消：不该有说明框")
    }

    /// 替换确认 → 撤销条 → 撤销（记录回到替换前）。
    func testRestoreConfirmUndoBarUndo() throws {
        let qa = launchBackup("backup-restore-confirm")
        // 夹具已点过「恢复备份」→ 替换确认框
        XCTAssertTrue(qa.el("native-backup-restore-ok").waitForExistence(timeout: 25), "替换确认框")
        let before = qa.records
        XCTAssertGreaterThan(before, 0, "替换前有记录")
        tap(qa, "native-backup-restore-ok")
        XCTAssertTrue(qa.el("native-backup-undo-button").waitForExistence(timeout: 20), "撤销条")
        // 换成备份里的记录：条数变了
        let after = qa.records
        XCTAssertNotEqual(after, before, "替换后记录条数应该变了（替换前 \(before)，替换后 \(after)）")
        // 撤销：回到替换前
        tap(qa, "native-backup-undo-button")
        waitRecords(qa, before)
    }

    /// 杀进程重开撤销条仍在（P32：保护副本跨进程）。
    func testUndoBarSurvivesKill() throws {
        let qa = launchBackup("backup-clear-undo")
        // 夹具已清空 → 撤销条
        XCTAssertTrue(qa.el("native-backup-undo-button").waitForExistence(timeout: 25), "撤销条")
        waitRecords(qa, 0)
        // 杀进程重开（不带注入）：保护副本还在 → 撤销条还在
        qa.relaunchWithoutSeed()
        XCTAssertTrue(qa.el("native-backup-undo-button").waitForExistence(timeout: 30), "重开后撤销条还在")
        // 撤销 → 记录回来
        tap(qa, "native-backup-undo-button")
        let end = Date().addingTimeInterval(10 * QALoad.scale)
        while Date() < end {
            if qa.records > 0 { return }
            Thread.sleep(forTimeInterval: 0.25)
        }
        XCTFail("撤销后记录没有回来（\(qa.records)）")
    }

    /// 清空 → 撤销条 → 撤销（记录回来）。
    func testClearThenUndo() throws {
        let qa = launchBackup("backup-clear-sheet")
        // 夹具已点「清空记录」→ 确认框
        XCTAssertTrue(qa.el("native-backup-clear-ok").waitForExistence(timeout: 25), "清空确认框")
        let before = qa.records
        XCTAssertGreaterThan(before, 0, "清空前有记录")
        tap(qa, "native-backup-clear-ok")
        XCTAssertTrue(qa.el("native-backup-undo-button").waitForExistence(timeout: 20), "撤销条")
        waitRecords(qa, 0)
        // 撤销 → 记录回来
        tap(qa, "native-backup-undo-button")
        waitRecords(qa, before)
    }
}
