import XCTest

// B3.3 流程测试骨架（B3B4 §5.2 · 首页）：每个用例先「待办」（XCTSkip），由 B3.5a 的页面卡填实。
// 填的时候：用 QA(seed: "<夹具状态>") 一键到起点（夹具在 ShiziUITests/States/），数据经探针断言；把 try QAPending.skip(…) 换成真实步骤即可，不改别的文件。

@MainActor
final class HomeFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// 六态（first / fresh / progress / today / back / special）主按钮各自去处
    func testSixStatesMainButtonDestinations() throws { try QAPending.skip("B3.5a", "六态（first / fresh / progress / today / back / special）主按钮各自去处") }

    /// T-paper 首帧 = 来源矩形、返回末帧 = 当前矩形（IC-23 原生版）
    func testPaperTransitionFirstFrameIsSourceRect() throws { try QAPending.skip("B3.5a", "T-paper 首帧 = 来源矩形、返回末帧 = 当前矩形（IC-23 原生版）") }

    /// 「自己选字」打开查字弹层（pick）
    func testPickCharsEntry() throws { try QAPending.skip("B3.5a", "「自己选字」打开查字弹层（pick）") }

    /// 特别组顺延（这次先写平常的字）
    func testSpecialGroupDeferral() throws { try QAPending.skip("B3.5a", "特别组顺延（这次先写平常的字）") }

    /// 离开撤销条交接（写字页离开后跟到首页）
    func testLeaveUndoBarHandoff() throws { try QAPending.skip("B3.5a", "离开撤销条交接（写字页离开后跟到首页）") }

    /// 首次品牌时刻点击静帧
    func testFirstBrandMomentTapFreezes() throws { try QAPending.skip("B3.5a", "首次品牌时刻点击静帧") }

    /// 冷启动恢复到首页
    func testColdStartRestoresHome() throws { try QAPending.skip("B3.5a", "冷启动恢复到首页") }
}
