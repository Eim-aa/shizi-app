import XCTest

// B3.3 流程测试骨架（B3B4 §5.2 · 查字弹层与 S02）：每个用例先「待办」（XCTSkip），由 B3.6 的页面卡填实。
// 填的时候：用 QA(seed: "<夹具状态>") 一键到起点（夹具在 ShiziUITests/States/），数据经探针断言；把 try QAPending.skip(…) 换成真实步骤即可，不改别的文件。

@MainActor
final class QueryFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// lookup / pick 两种
    func testLookupAndPickModes() throws { try QAPending.skip("B3.6", "lookup / pick 两种") }

    /// 键盘抬起时四个出口（完成 / 遮罩 / 下滑 / 左缘）一帧内开始退场（T0-7、IC-24 原生版）
    func testKeyboardUpFourExitsStartAtOnce() throws { try QAPending.skip("B3.6", "键盘抬起时四个出口（完成 / 遮罩 / 下滑 / 左缘）一帧内开始退场（T0-7、IC-24 原生版）") }

    /// 中文输入法组字中不提前查
    func testImeComposingDoesNotQueryEarly() throws { try QAPending.skip("B3.6", "中文输入法组字中不提前查") }

    /// 加入失败三段式
    func testAddFailureThreeStage() throws { try QAPending.skip("B3.6", "加入失败三段式") }

    /// S02 三键
    func testS02ThreeButtons() throws { try QAPending.skip("B3.6", "S02 三键") }
}
