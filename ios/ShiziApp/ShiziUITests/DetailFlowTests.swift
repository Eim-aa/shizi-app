import XCTest

// B3.7 字详情流程（B3B4 §5.2 · DetailFlowTests）：用夹具一键到起点（States/detail-*.json，原生页），数据与页面经探针 / 无障碍标识断言。
// 网页路由仍是真相源：探针 route 是网页栈，stage.screens 是原生栈（底 → 顶），transitions 是原生转场记录。
@MainActor
final class DetailFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func stageScreens(_ qa: QA) -> [String] { ((qa.probe["stage"] as? [String: Any])?["screens"] as? [String]) ?? [] }

    private func waitStage(_ qa: QA, _ want: [String], file: StaticString = #filePath, line: UInt = #line) {
        qa.waitProbe("stage \(want)", file: file, line: line) { (($0["stage"] as? [String: Any])?["screens"] as? [String]) == want && ($0["navRunning"] as? Int) == 0 }
    }

    private func open(_ seed: String) -> QA {
        let qa = QA(seed: seed)
        qa.launch()
        waitStage(qa, ["detail"])
        return qa
    }

    /// 练这个字：写字页 T-push 推入（B 组、来源字详情），返回落回原生字详情（宿主等网页空闲请原生盖回，不带转场）。
    func testPracticeThisChar() {
        let qa = open("detail-many")
        qa.tapNative("native-detail-practice")
        qa.waitNative(true)
        XCTAssertTrue(qa.transitions.contains("present:push"), "\(qa.transitions)")
        XCTAssertEqual(qa.session("B")["total"] as? Int, 1)
        qa.tapNative("native-write-back")
        qa.waitNative(false)
        qa.waitRouteTop("detail")
        waitStage(qa, ["detail"])
        XCTAssertTrue(qa.el("native-detail-practice").waitForExistence(timeout: 4), "native detail page is back")
    }

    /// 换掉 + 撤销（页内撤销条）：换词后「换个词语」行消失、撤销条出现；撤销 →「已撤销」→ 行回来。
    func testWordOffAndUndo() {
        let qa = open("detail-wrong")
        Thread.sleep(forTimeInterval: 0.5)
        let swap = qa.el("native-detail-swap")
        if !swap.isHittable { qa.app.swipeUp() }
        qa.tapNative("native-detail-swap")
        XCTAssertTrue(qa.el("native-detail-undo-bar").waitForExistence(timeout: 4), "undo bar shown")
        XCTAssertFalse(qa.el("native-detail-swap").exists, "the swap row goes away once it is off")
        qa.tapNative("native-detail-undo-button")
        qa.waitProbe("undone") { _ in qa.el("native-detail-swap").exists }
    }

    /// 自选字加入 / 移除 + 撤销：加入后这一行变「移出自选」；移出出现撤销条，撤销把它放回。
    func testCustomAddRemoveUndo() {
        let qa = open("detail-none")
        Thread.sleep(forTimeInterval: 0.5)
        qa.tapNative("native-detail-add")
        qa.waitProbe("added") { _ in qa.el("native-detail-remove").exists && !qa.el("native-detail-add").exists }
        qa.tapNative("native-detail-remove")
        XCTAssertTrue(qa.el("native-detail-undo-bar").waitForExistence(timeout: 4), "undo bar shown")
        XCTAssertTrue(qa.el("native-detail-add").exists, "back to not-custom")
        qa.tapNative("native-detail-undo-button")
        qa.waitProbe("restored") { _ in qa.el("native-detail-remove").exists }
    }

    /// 记录格放大改判（再点改回）：头图格 → 放大弹层 → 改为写对 → 弹层关；再开一次是「改为写错」，再点改回。
    func testRecordCellZoomCorrectJudgment() {
        let qa = open("detail-many")
        Thread.sleep(forTimeInterval: 0.5)
        qa.tapNative("native-detail-hero-cell")
        let flip = qa.el("native-detail-zoom-flip")
        XCTAssertTrue(flip.waitForExistence(timeout: 5), "zoom sheet shown")
        let before = qa.records
        let first = flip.label
        qa.tapNative("native-detail-zoom-flip")
        qa.waitProbe("sheet closed") { _ in !qa.el("native-detail-zoom-flip").exists }
        XCTAssertEqual(qa.records, before, "same record, no extra one")
        Thread.sleep(forTimeInterval: 0.5)
        qa.tapNative("native-detail-hero-cell")
        XCTAssertTrue(qa.el("native-detail-zoom-flip").waitForExistence(timeout: 5))
        XCTAssertNotEqual(qa.el("native-detail-zoom-flip").label, first, "the button now offers the opposite")
        qa.tapNative("native-detail-zoom-flip")
        qa.waitProbe("sheet closed again") { _ in !qa.el("native-detail-zoom-flip").exists }
        qa.tapNative("native-detail-hero-cell")
        XCTAssertEqual(qa.el("native-detail-zoom-flip").label, first, "flipped back")
        qa.tapNative("native-detail-zoom-close")
    }

    /// 旧版本的记录（照片页）：原生 → 原生推入，「‹」回字详情。
    func testLegacyPhotoPage() {
        let qa = open("detail-photo-row")
        Thread.sleep(forTimeInterval: 0.5)
        let row = qa.el("native-detail-legacy")
        XCTAssertTrue(row.waitForExistence(timeout: 4))
        for _ in 0..<3 where !row.isHittable { qa.app.swipeUp() }
        qa.tapNative("native-detail-legacy")
        waitStage(qa, ["detail", "detail-photo"])
        XCTAssertTrue(qa.el("native-detail-photo-image").waitForExistence(timeout: 4))
        qa.tapNative("native-page-back")
        waitStage(qa, ["detail"])
        qa.waitRouteTop("detail")
    }

    /// 左缘首先只关闭放大弹层，字详情和记录保持原样。
    func testZoomEdgeClosesOnlyTheSheet() {
        let qa = open("detail-many")
        let before = qa.records
        qa.tapNative("native-detail-hero-cell")
        XCTAssertTrue(qa.el("native-detail-zoom-close").waitForExistence(timeout: 5))
        qa.edgeBack()
        qa.waitProbe("zoom closed by edge") { _ in !qa.el("native-detail-zoom-close").exists }
        waitStage(qa, ["detail"])
        qa.waitRouteTop("detail")
        XCTAssertEqual(qa.records, before)
    }

    /// 关掉放大弹层后立刻再点记录格：弹层要开（上一张还在退场时点按不能被吞掉——网页版是 DOM 叠层，关掉就能立刻再开）。
    func testReopenZoomRightAfterClosing() {
        let qa = open("detail-many")
        Thread.sleep(forTimeInterval: 0.5)
        qa.tapNative("native-detail-hero-cell")
        XCTAssertTrue(qa.el("native-detail-zoom-close").waitForExistence(timeout: 5), "zoom sheet shown")
        qa.tapNative("native-detail-zoom-close")
        qa.waitProbe("zoom closed") { _ in !qa.el("native-detail-zoom-close").exists }
        qa.tapNative("native-detail-hero-cell")
        XCTAssertTrue(qa.el("native-detail-zoom-flip").waitForExistence(timeout: 5), "the zoom sheet opens again right after the previous one left")
    }

    /// 写失败后保留同一张弹层，重试成功关闭；记录条数不增加。
    func testZoomCorrectionFailureAndRetry() {
        let qa = open("detail-zoom-fail")
        let before = qa.records
        XCTAssertTrue(qa.el("native-detail-zoom-fail-retry").waitForExistence(timeout: 5))
        XCTAssertTrue(qa.el("native-detail-zoom-note").exists)
        qa.tapNative("native-detail-zoom-fail-retry")
        qa.waitProbe("retry closes zoom") { _ in !qa.el("native-detail-zoom-close").exists }
        waitStage(qa, ["detail"])
        XCTAssertEqual(qa.records, before)
        qa.tapNative("native-detail-hero-cell")
        XCTAssertTrue(qa.el("native-detail-zoom-flip").waitForExistence(timeout: 5))
        XCTAssertFalse(qa.el("native-detail-zoom-fail-retry").exists)
    }

    /// 让给网页再回来（B3.2 记录里留给本页的流程用例）：字详情 →（网页的）待复习清单 → 返回，原生字详情盖回来（open via 'return'，不带转场）。
    func testYieldToWebAndComeBack() {
        let qa = open("detail-wrong")
        Thread.sleep(forTimeInterval: 0.5)
        let row = qa.el("native-detail-list-row")
        if !row.waitForExistence(timeout: 3) { XCTFail("no list row"); return }
        if !row.isHittable { qa.app.swipeUp() }
        qa.tapNative("native-detail-list-row")
        waitStage(qa, [])
        XCTAssertTrue(qa.transitions.contains("yield:screen"), "\(qa.transitions)")
        qa.edgeBack()
        waitStage(qa, ["detail"])
        XCTAssertTrue(qa.transitions.contains { $0.hasPrefix("screen:open detail via=return") }, "\(qa.transitions)")
        qa.waitRouteTop("detail")
    }

    /// 结果页对照弹层「看这个字 ›」→ 原生字详情盖在原生结果页上面（不再让开给网页），返回回到同一个结果页。
    /// 弹层自己开：夹具 result-sheet 的那一步是给网页取证用的（原生取证时改判弹层是结果页 present 出来的另一张控制器，
    /// 夹具的原生点按够不到它——见 QAFixtures.qaTap 只在 host.view 里找），所以这里从结果页点「修改 ›」把弹层打开。
    func testEnterFromResultAndComeBack() {
        let qa = QA(seed: "result-daily")
        qa.launch()
        qa.waitResult(true)
        qa.tapNative("native-result-row-change")
        XCTAssertTrue(qa.el("native-change-title").waitForExistence(timeout: 6), "change sheet shown")
        qa.tapNative("native-change-detail")
        qa.waitRouteTop("detail")
        XCTAssertTrue(qa.el("native-detail-practice").waitForExistence(timeout: 6), "native detail page on top")
        XCTAssertTrue(qa.transitions.contains { $0.hasPrefix("screen:open detail via=") }, "\(qa.transitions)")
        // 结果页不收起：原生字详情盖在它上面（让开时看到上面有原生页 → 留在下面，返回后回同一个结果页）
        XCTAssertTrue(qa.transitions.contains("yield:under-native"), "\(qa.transitions)")
        qa.edgeBack()
        qa.waitResult(true)
        XCTAssertTrue(qa.resultShown)
    }
}
