import XCTest

// B3.3 流程测试骨架（B3B4 §5.2 · 我的与子页）：每个用例先「待办」（XCTSkip），由 B3.5c / B3.9 / B3.10 的页面卡填实。
// 填的时候：用 QA(seed: "<夹具状态>") 一键到起点（夹具在 ShiziUITests/States/），数据经探针断言；把 try QAPending.skip(…) 换成真实步骤即可，不改别的文件。

@MainActor
final class MineFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// 外观三段即时生效（浅 / 深）
    func testAppearanceSegmentsApplyAtOnce() throws { try QAPending.skip("B3.5c / B3.9 / B3.10", "外观三段即时生效（浅 / 深）") }

    /// 每组字数改了首页 / 字库同值
    func testGroupSizeSyncsHomeAndLibrary() throws { try QAPending.skip("B3.5c / B3.9 / B3.10", "每组字数改了首页 / 字库同值") }

    /// AX5 改选择弹层
    func testAx5ChoiceSheet() throws { try QAPending.skip("B3.5c / B3.9 / B3.10", "AX5 改选择弹层") }

    /// 练习记录翻月 / 展开某天
    func testRecordsMonthAndDay() throws { try QAPending.skip("B3.5c / B3.9 / B3.10", "练习记录翻月 / 展开某天") }

    /// 月字帖
    func testMonthCopybook() throws { try QAPending.skip("B3.5c / B3.9 / B3.10", "月字帖") }

    /// 年报往年
    func testAnnualPastYear() throws { try QAPending.skip("B3.5c / B3.9 / B3.10", "年报往年") }

    /// 提醒开关 / 时间 / 被拒跳设置
    func testRemindSwitchTimeDenied() throws { try QAPending.skip("B3.5c / B3.9 / B3.10", "提醒开关 / 时间 / 被拒跳设置") }
}
