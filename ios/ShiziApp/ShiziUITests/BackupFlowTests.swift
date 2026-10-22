import XCTest

// B3.3 流程测试骨架（B3B4 §5.2 · 备份）：每个用例先「待办」（XCTSkip），由 B3.10 的页面卡填实。
// 填的时候：用 QA(seed: "<夹具状态>") 一键到起点（夹具在 ShiziUITests/States/），数据经探针断言；把 try QAPending.skip(…) 换成真实步骤即可，不改别的文件。

@MainActor
final class BackupFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// 导出（分享面板出现）
    func testExportShowsShareSheet() throws { try QAPending.skip("B3.10", "导出（分享面板出现）") }

    /// 导入预检拒收三种（太大 / 不是备份 / 取消）
    func testImportPrecheckRejectsThreeKinds() throws { try QAPending.skip("B3.10", "导入预检拒收三种（太大 / 不是备份 / 取消）") }

    /// 替换确认 → 撤销条 → 撤销
    func testRestoreConfirmUndoBarUndo() throws { try QAPending.skip("B3.10", "替换确认 → 撤销条 → 撤销") }

    /// 杀进程重开撤销条仍在（P32）
    func testUndoBarSurvivesKill() throws { try QAPending.skip("B3.10", "杀进程重开撤销条仍在（P32）") }

    /// 清空 → 撤销
    func testClearThenUndo() throws { try QAPending.skip("B3.10", "清空 → 撤销") }
}
