import XCTest

// B3.3 流程测试骨架（B3B4 §5.2 · 图片预览）：每个用例先「待办」（XCTSkip），由 B3.11 的页面卡填实。
// 填的时候：用 QA(seed: "<夹具状态>") 一键到起点（夹具在 ShiziUITests/States/），数据经探针断言；把 try QAPending.skip(…) 换成真实步骤即可，不改别的文件。

@MainActor
final class ImageFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// 比例切换（3:4 / 1:1）
    func testRatioSwitch() throws { try QAPending.skip("B3.11", "比例切换（3:4 / 1:1）") }

    /// 「也放进来」
    func testAlsoPutIn() throws { try QAPending.skip("B3.11", "「也放进来」") }

    /// > 80 字分页翻页
    func testPagedOver80Chars() throws { try QAPending.skip("B3.11", "> 80 字分页翻页") }

    /// 保存（相册权限由系统）
    func testSaveToPhotos() throws { try QAPending.skip("B3.11", "保存（相册权限由系统）") }

    /// 失败 Toast
    func testFailureToast() throws { try QAPending.skip("B3.11", "失败 Toast") }
}
