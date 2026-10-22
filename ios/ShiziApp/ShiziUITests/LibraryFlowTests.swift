import XCTest

// B3.3 流程测试骨架（B3B4 §5.2 · 字库）：每个用例先「待办」（XCTSkip），由 B3.5b / B3.8 的页面卡填实。
// 填的时候：用 QA(seed: "<夹具状态>") 一键到起点（夹具在 ShiziUITests/States/），数据经探针断言；把 try QAPending.skip(…) 换成真实步骤即可，不改别的文件。

@MainActor
final class LibraryFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// 搜索框 → 查字弹层（lookup）
    func testSearchOpensQuery() throws { try QAPending.skip("B3.5b / B3.8", "搜索框 → 查字弹层（lookup）") }

    /// 今日练习行 → T-paper（来源 = 该行）
    func testTodayPracticeRowPaperTransition() throws { try QAPending.skip("B3.5b / B3.8", "今日练习行 → T-paper（来源 = 该行）") }

    /// 三档 / 已跳过 → 区详情 → 勾选 → 练这些字（T-push）→ 返回
    func testTierToListToPickedSession() throws { try QAPending.skip("B3.5b / B3.8", "三档 / 已跳过 → 区详情 → 勾选 → 练这些字（T-push）→ 返回") }

    /// 全部字：排序 / 筛选 / 查找
    func testAllCharsSortFilterFind() throws { try QAPending.skip("B3.5b / B3.8", "全部字：排序 / 筛选 / 查找") }

    /// 全部字：params 冷启动恢复
    func testAllCharsParamsColdRestore() throws { try QAPending.skip("B3.5b / B3.8", "全部字：params 冷启动恢复") }

    /// 换库成功即返回（不提示）
    func testSwitchLibrarySuccessReturnsAtOnce() throws { try QAPending.skip("B3.5b / B3.8", "换库成功即返回（不提示）") }

    /// 换库失败三段式
    func testSwitchLibraryFailureThreeStage() throws { try QAPending.skip("B3.5b / B3.8", "换库失败三段式") }
}
