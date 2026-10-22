import XCTest

// B3.3 流程测试骨架（B3B4 §5.2 · 冷启动恢复与深链）：每个用例先「待办」（XCTSkip），由 B3.F 的页面卡填实。
// 填的时候：用 QA(seed: "<夹具状态>") 一键到起点（夹具在 ShiziUITests/States/），数据经探针断言；把 try QAPending.skip(…) 换成真实步骤即可，不改别的文件。

@MainActor
final class RestoreAndDeepLinkTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// 杀进程恢复（各页）
    func testKillRestoresEachPage() throws { try QAPending.skip("B3.F", "杀进程恢复（各页）") }

    /// 过期不恢复
    func testStaleNotRestored() throws { try QAPending.skip("B3.F", "过期不恢复") }

    /// 跨 4 点不恢复
    func testAcross4amNotRestored() throws { try QAPending.skip("B3.F", "跨 4 点不恢复") }

    /// 坏值优先
    func testCorruptNoticePriority() throws { try QAPending.skip("B3.F", "坏值优先") }

    /// 阻断优先
    func testBlockPriority() throws { try QAPending.skip("B3.F", "阻断优先") }

    /// 提醒深链压过恢复
    func testReminderDeepLinkBeatsRestore() throws { try QAPending.skip("B3.F", "提醒深链压过恢复") }

    /// 深链遇 B 组没写完弹 S02
    func testDeepLinkWithUnfinishedBGroupShowsS02() throws { try QAPending.skip("B3.F", "深链遇 B 组没写完弹 S02") }
}
