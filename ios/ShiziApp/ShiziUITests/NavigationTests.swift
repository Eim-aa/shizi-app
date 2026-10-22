import XCTest

// B3.3 流程测试骨架（B3B4 §5.2 · 导航）：每个用例先「待办」（XCTSkip），由 B3.2 / B3.5d 的页面卡填实。
// 填的时候：用 QA(seed: "<夹具状态>") 一键到起点（夹具在 ShiziUITests/States/），数据经探针断言；把 try QAPending.skip(…) 换成真实步骤即可，不改别的文件。

@MainActor
final class NavigationTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// 每个 L1 / L2 画面：左缘右滑结果 == 点左上（IC-03 遍历原生版）
    func testEdgeSwipeEqualsTapBackOnEveryL1L2() throws { try QAPending.skip("B3.2 / B3.5d", "每个 L1 / L2 画面：左缘右滑结果 == 点左上（IC-03 遍历原生版）") }

    /// 两指 Z 形
    func testTwoFingerZ() throws { try QAPending.skip("B3.2 / B3.5d", "两指 Z 形") }

    /// 弹层开着时左缘只关弹层
    func testSheetOpenEdgeOnlyClosesSheet() throws { try QAPending.skip("B3.2 / B3.5d", "弹层开着时左缘只关弹层") }

    /// Tab 再点滚回顶部
    func testTabReTapScrollsToTop() throws { try QAPending.skip("B3.2 / B3.5d", "Tab 再点滚回顶部") }

    /// Tab 根无左缘返回
    func testTabRootHasNoEdgeBack() throws { try QAPending.skip("B3.2 / B3.5d", "Tab 根无左缘返回") }

    /// N7 整页不平移（内容容器外拖动页头不动）
    func testN7PageDoesNotPan() throws { try QAPending.skip("B3.2 / B3.5d", "N7 整页不平移（内容容器外拖动页头不动）") }
}
