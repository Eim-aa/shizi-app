import XCTest

// B3.3 流程测试骨架（B3B4 §5.2 · 阻断页）：每个用例先「待办」（XCTSkip），由 B3.13 的页面卡填实。
// 填的时候：用 QA(seed: "<夹具状态>") 一键到起点（夹具在 ShiziUITests/States/），数据经探针断言；把 try QAPending.skip(…) 换成真实步骤即可，不改别的文件。

@MainActor
final class BlockTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// 阻断：存储不可用（注入）
    func testUnavailableBlock() throws { try QAPending.skip("B3.13", "阻断：存储不可用（注入）") }

    /// 阻断：写失败回滚失败（可导出备份）
    func testBlockedBlockWithExport() throws { try QAPending.skip("B3.13", "阻断：写失败回滚失败（可导出备份）") }

    /// 阻断：迁移
    func testMigrationBlock() throws { try QAPending.skip("B3.13", "阻断：迁移") }

    /// 导出备份
    func testExportBackupFromBlock() throws { try QAPending.skip("B3.13", "导出备份") }

    /// 再试一次
    func testRetry() throws { try QAPending.skip("B3.13", "再试一次") }
}
