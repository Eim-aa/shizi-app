import XCTest

// B3.3 流程测试骨架（B3B4 §5.2 · 字详情）：每个用例先「待办」（XCTSkip），由 B3.7 的页面卡填实。
// 填的时候：用 QA(seed: "<夹具状态>") 一键到起点（夹具在 ShiziUITests/States/），数据经探针断言；把 try QAPending.skip(…) 换成真实步骤即可，不改别的文件。

@MainActor
final class DetailFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// 练这个字
    func testPracticeThisChar() throws { try QAPending.skip("B3.7", "练这个字") }

    /// 换掉 + 撤销（页内撤销条）
    func testWordOffAndUndo() throws { try QAPending.skip("B3.7", "换掉 + 撤销（页内撤销条）") }

    /// 自选字加入 / 移除 + 撤销
    func testCustomAddRemoveUndo() throws { try QAPending.skip("B3.7", "自选字加入 / 移除 + 撤销") }

    /// 记录格放大改判（再点改回）
    func testRecordCellZoomCorrectJudgment() throws { try QAPending.skip("B3.7", "记录格放大改判（再点改回）") }

    /// 旧版本的记录（照片页）
    func testLegacyPhotoPage() throws { try QAPending.skip("B3.7", "旧版本的记录（照片页）") }

    /// 从结果页 / 写字页「看这个字 ›」进出
    func testEnterAndLeaveFromResultAndWrite() throws { try QAPending.skip("B3.7", "从结果页 / 写字页「看这个字 ›」进出") }
}
