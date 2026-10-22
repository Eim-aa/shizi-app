import XCTest

// B2.9b：读屏与大字号（交互规范 A1 / A2 / N3；B2-原生写字架构 §9）。
//   · 读屏名称与顺序：同一个注入状态分别打开网页版与原生版，按读屏能摸到的顺序取「名称」序列逐项比（网页 = 标准答案）；
//   · 播报队列：原生所有读屏通知经 NativeA11y（screenChanged / announcement），探针 a11y 带出最近 40 条，逐条核对与网页 sr-live.js 同一组句子；
//   · AX5：系统字号由启动参数 -UIPreferredContentSizeCategoryName 指定；每一页跑 performAccessibilityAudit（文字被裁、名称、可点区域、元素识别）。
// 两指 Z 形（accessibilityPerformEscape）XCUITest 发不出，在 ShiziWriteTests（NativeJudgeTests.testB29b_…）里直接调。

@MainActor
final class AccessibilityFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private static let ax5 = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]

    private func launch(_ seed: String, native: Bool = true, ax5: Bool = false, failNext: Int = 0) -> QA {
        let qa = QA(seed: seed, native: native, failNext: failNext)
        if ax5 { qa.app.launchArguments += Self.ax5 }
        qa.launch()
        return qa
    }

    /// 读屏能摸到的元素名称，按读屏顺序（XCUITest 快照的前序遍历 = 无障碍树顺序）。只取有名称的叶子：按钮、文字、图片与带名称的「其它」；
    /// 探针（qa-probe）、状态栏、网页的读屏专用空白播报区不算。名称去掉空白与零宽字符、「›」。
    private func spoken(_ app: XCUIApplication) -> [String] {
        var out: [String] = []
        let tree = try? app.snapshot()
        func norm(_ s: String) -> String {
            s.replacingOccurrences(of: "\u{200B}", with: "").replacingOccurrences(of: "\u{203A}", with: "").components(separatedBy: .whitespacesAndNewlines).joined()
        }
        func walk(_ e: XCUIElementSnapshot) {
            let label = norm(e.label)
            let leaf = e.children.isEmpty || [.button, .staticText, .image].contains(e.elementType)
            // 网页的 aria-live 播报区（role=status，空着时读屏不停留）在快照里只有角色名「应用程序状态」，不是内容，不比
            if leaf, !label.isEmpty, label != "应用程序状态", e.identifier != "qa-probe", e.elementType != .statusBar, e.frame.width > 0 {
                if out.last != label { out.append(label) }
            }
            if [.button, .staticText, .image].contains(e.elementType) { return }
            for c in e.children { walk(c) }
        }
        if let tree { walk(tree) }
        return out
    }

    /// 两边的名称序列（去掉状态栏以上与页面外的部分）；打印出来方便看差在哪。
    private func compareSpoken(_ seed: String, file: StaticString = #filePath, line: UInt = #line, prepare: (QA) -> Void = { _ in }) {
        let web = launch(seed, native: false)
        prepare(web)
        Thread.sleep(forTimeInterval: 0.8)
        let w = spoken(web.app)
        web.app.terminate()
        let nat = launch(seed, native: true)
        prepare(nat)
        Thread.sleep(forTimeInterval: 0.8)
        let n = spoken(nat.app)
        print("B29b spoken web(\(seed)) = \(w)")
        print("B29b spoken native(\(seed)) = \(n)")
        XCTAssertEqual(n, w, "读屏名称与顺序（\(seed)）", file: file, line: line)
    }

    // MARK: 读屏名称与顺序（网页 = 标准答案）

    func test1001_spokenOrderMatchesTheWebOnTheWritePage() {
        continueAfterFailure = true
        for seed in ["recall", "trace", "retrace", "line", "skip-undo", "redo", "redo-check"] { compareSpoken(seed) }
    }

    func test1002_spokenOrderMatchesTheWebOnTheJudgeResultAndOverlays() {
        continueAfterFailure = true
        for seed in ["judge", "end-dialog", "change-sheet", "result-daily", "result-sheet"] { compareSpoken(seed) }
    }

    // MARK: 播报队列（与网页 sr-live.js 同一组句子）

    func test1003_announcementsFollowTheWeb() {
        let qa = launch("recall", failNext: 0)
        var a11y: [String] { qa.probe["a11y"] as? [String] ?? [] }
        XCTAssertTrue(a11y.contains("screen:凭记忆写"), "进页面 screenChanged 落在页标题：\(a11y)")
        qa.tapNative("native-write-hint")
        qa.waitProbe("hint announced") { (($0["a11y"] as? [String]) ?? []).contains { $0.hasPrefix("announce:提示画出了第 1") } }
        // 播报留在播报区里（网页 aria-live 区同义），读屏可以摸回来再听
        XCTAssertTrue(qa.el("native-write-sr-status").label.hasPrefix("提示画出了第 1"))
        qa.stroke()
        qa.waitProbe("stroke announced") { (($0["a11y"] as? [String]) ?? []).contains("announce:已写 1 笔") }
        qa.stroke(from: CGVector(dx: 0.5, dy: 0.2), to: CGVector(dx: 0.5, dy: 0.8))
        qa.waitProbe("second stroke announced") { (($0["a11y"] as? [String]) ?? []).contains("announce:已写 2 笔") }
        qa.tapNative("native-write-undo")
        qa.waitProbe("undo announced") { (($0["a11y"] as? [String]) ?? []).contains("announce:撤销了一笔，还有 1 笔") }
        qa.stroke(from: CGVector(dx: 0.3, dy: 0.3), to: CGVector(dx: 0.7, dy: 0.3))
        qa.waitProbe("back to two strokes") { (($0["a11y"] as? [String]) ?? []).last == "announce:已写 2 笔" }
        qa.tapNative("native-write-clear")
        qa.waitProbe("clear announced") { (($0["a11y"] as? [String]) ?? []).contains("announce:已清空") }
        qa.tapNative("native-write-undo")
        qa.waitProbe("restore announced") { (($0["a11y"] as? [String]) ?? []).contains("announce:恢复了，现在是 2 笔") }
        // 换阶段：判断页 screenChanged 落在页标题（只给读屏的「写对了吗」）
        qa.tapNative("native-write-done")
        qa.waitProbe("judge screen changed") { (($0["a11y"] as? [String]) ?? []).last == "screen:写对了吗" }
    }

    func test1004_saveFailureIsAnnounced() {
        let qa = launch("judge", failNext: 1)
        Thread.sleep(forTimeInterval: 0.6)
        qa.tapNative("native-write-wrong")
        qa.waitProbe("save failure announced") { (($0["a11y"] as? [String]) ?? []).contains("announce:没保存上，你写的字还在。") }
        // 再试一次成功：换字 screenChanged（进度）
        qa.tapNative("native-write-fail-retry")
        qa.waitProbe("next char screen changed") { (($0["a11y"] as? [String]) ?? []).last?.hasPrefix("screen:") == true && (($0["native"] as? [String: Any])?["cursor"] as? Int) == 1 }
    }

    // MARK: AX5：读屏审计（XCUIApplication.performAccessibilityAudit，iOS 17+）

    func test1005_ax5AccessibilityAudit() throws {
        guard #available(iOS 17.0, *) else { throw XCTSkip("performAccessibilityAudit 要 iOS 17") }
        continueAfterFailure = true
        for seed in ["recall", "trace", "judge", "line", "skip-undo", "end-dialog", "change-sheet", "result-daily", "result-first", "redo-check"] {
            let qa = launch(seed, ax5: true)
            Thread.sleep(forTimeInterval: 1.2)
            // 动态字体（.dynamicType）不审：字号由页面按网页字阶 / AX 分层封顶给出（与网页同值），不是 UIFontMetrics；
            // 对比（.contrast）不审：颜色是设计令牌（test/ui/contrast.test.mjs 另有门禁）。
            // 文字被裁（.textClipped）照跑、只记不判：它按字形外框比标签框——行盒按网页钉成 1.18em，苹方字形外框约 1.4em，单行按钮字也会被报；
            // 只给读屏的 1×1 标题 / 播报区按设计如此。字是否完整、有没有被裁、互相压住，由逐屏对比的 AX-01（截断 / 祖先裁切 / 同层重叠）逐元素核对。
            // 判的：元素名称、可点区域（按钮）、元素识别、特性。
            try qa.app.performAccessibilityAudit(for: [.textClipped, .sufficientElementDescription, .hitRegion, .elementDetection, .trait]) { issue in
                if issue.auditType == .textClipped {
                    print("B29b audit \(seed) (记录): \(issue.compactDescription) \(issue.element?.label.prefix(30) ?? "")")
                    return true
                }
                // 网页（WKWebView，在原生页下面、被盖住）里的元素不归原生页管
                if let e = issue.element, e.identifier.isEmpty, (try? e.snapshot())?.elementType == .webView { return true }
                // 只读的装饰元素（描一遍 / 凭记忆写的两个步骤点：高 5pt，网页同）不是可点的控件，点击区不适用
                if issue.auditType == .hitRegion, let e = issue.element, e.elementType != .button { return true }
                print("B29b audit \(seed): \(issue.auditType) \(issue.compactDescription) \(issue.element?.debugDescription.prefix(160) ?? "")")
                return false
            }
            qa.app.terminate()
        }
    }
}
