import XCTest

// B3.3 流程测试骨架（B3B4 §5.2 · 无障碍审计）：每个用例先「待办」（XCTSkip），由 B3.Z 的页面卡填实。
// 填的时候：用 QA(seed: "<夹具状态>") 一键到起点（夹具在 ShiziUITests/States/），数据经探针断言；把 try QAPending.skip(…) 换成真实步骤即可，不改别的文件。

@MainActor
final class AccessibilityAuditTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// 每个状态 performAccessibilityAudit()：点击区 ≥ 44、对比度、动态字体裁切、元素有名称（iOS 17+ 模拟器 API）
    func testPerformAccessibilityAuditEveryState() throws { try QAPending.skip("B3.Z", "每个状态 performAccessibilityAudit()：点击区 ≥ 44、对比度、动态字体裁切、元素有名称（iOS 17+ 模拟器 API）") }

    /// VoiceOver 名称表（A2：返回 / 关闭 / 接着写…）逐屏断言 label
    func testVoiceOverNameTable() throws { try QAPending.skip("B3.Z", "VoiceOver 名称表（A2：返回 / 关闭 / 接着写…）逐屏断言 label") }

    /// 焦点落点：推入后在标题、返回后回原控件、弹层焦点落弹层
    func testVoiceOverFocusLanding() throws { try QAPending.skip("B3.Z", "焦点落点：推入后在标题、返回后回原控件、弹层焦点落弹层") }
}
