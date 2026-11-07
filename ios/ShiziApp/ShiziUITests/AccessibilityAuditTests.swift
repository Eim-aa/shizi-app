import XCTest

// B3.Z（B3B4 §5.2 / §5.3）：无障碍审计——三个 Tab 根页和主要推入页，各在默认字号与 AX5 下跑 XCUIApplication.performAccessibilityAudit()
// （iOS 17+ 模拟器 API，测试端可用；App 最低 15 不受影响）。
//   · 判的类型：元素名称（sufficientElementDescription）、可点区域（hitRegion）、元素识别（elementDetection）、特性（trait）；
//     文字被裁（textClipped）只记不判——字形外框比标签框大、单行按钮字也会被报，字是否完整由逐屏对比的 AX-01 逐元素核对（同 AccessibilityFlowTests.test1005）；
//     动态字体 / 对比不审：字号按网页字阶给出（不是 UIFontMetrics）、颜色是设计令牌（test/ui/contrast.test.mjs 另有门禁）。
//   · 豁免只按名字，没有「全部忽略」：
//       - 系统 Tab 栏（D77 / TAB-01：系统样式，读屏与点击区由系统管）：element 是 tabBar 或 Tab 名（写字 / 字库 / 我的）的按钮；
//       - 网页引擎（WKWebView，在原生页下面、被盖住）里的元素；
//       - 只读装饰元素的点击区（非按钮）。
//   · 已知问题清单 KNOWN：审计发现、但属于产品问题（本卡不修，列给后续卡）的条目，按「状态|类型|元素名」写死；清单之外的新发现一律失败；
//     清单里的条目修好后由修复卡从清单删掉。
//   写字页的 AX5 审计另在 AccessibilityFlowTests.test1005（十个写字 / 判断 / 结果状态）。
// 读屏名称与顺序、播报见 AccessibilityFlowTests（test1001–1004）；这里的两个待办用例（名称表 / 焦点落点）由它们覆盖，保留为待办记录。

@MainActor
final class AccessibilityAuditTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// 三个 Tab 根页（夹具 = 起点状态）。
    private static let roots = ["home", "library-records", "mine-records"]
    /// 主要推入页 / 弹层（夹具直达）：关于及子页、练习记录、月字帖、年报、字详情、清单、全部字、换库、提醒、备份、查字、分享预览、没字可写。
    private static let pages = [
        "about", "credits", "privacy",
        "records-month", "month-ink", "annual-report",
        "detail-many", "list-due", "all-month", "switch",
        "remind-on", "backup-recent", "query-card", "preview-1x1", "none-pick",
    ]

    /// 审计发现但属产品问题、暂不修的条目：「状态|审计类型|元素名」。B3.Z-f 后为空——致谢页网址行已有名字（项目名 + 链接特性）；
    /// 查字弹层键盘上方 3 个无名元素确认是系统键盘的联想条（QuickType），改为按名豁免（见 audit 里的「豁免 4」），不再登记在这里。
    private static let known: Set<String> = []

    private static let ax5 = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    private static let tabNames: Set<String> = ["写字", "字库", "我的"]

    /// 一个状态一次审计（四种类型各跑一次：一次全跑在大页面上会撞系统的审计超时 Code=-56）；
    /// 返回没被豁免、也不在已知清单里的发现。系统审计超时：重试一次，仍超时记入返回（算失败，不静默）。
    private func audit(_ seed: String, ax5: Bool) throws -> [String] {
        guard #available(iOS 17.0, *) else { throw XCTSkip("performAccessibilityAudit 要 iOS 17") }
        let qa = QA(seed: seed)
        if ax5 { qa.app.launchArguments += Self.ax5 }
        qa.launch()
        Thread.sleep(forTimeInterval: 1.5)
        var fresh: [String] = []
        let tag = ax5 ? "AX5" : "L"
        let types: [XCUIAccessibilityAuditType] = [.sufficientElementDescription, .hitRegion, .elementDetection, .trait]
        for type in types {
            var attempt = 0
            while true {
                attempt += 1
                do {
                    try qa.app.performAccessibilityAudit(for: type) { issue in
                        let el = issue.element
                        let label = el?.label ?? ""
                        // 豁免 1：系统 Tab 栏（TAB-01 / D77）
                        if let e = el, e.elementType == .tabBar || (e.elementType == .button && Self.tabNames.contains(label)) { return true }
                        // （豁免 2「网页引擎 WKWebView 里的元素」随 B4.9 删除：App 里没有网页了）
                        // 豁免 4（键盘）：系统键盘（含联想条 QuickType）里的无名元素——不是产品元素。判据：描述类审计、没名字、没 identifier，
                        //   且元素框落在键盘框里，或在键盘框正上方那 48pt 的联想条带（QuickType：三格各 1/3 屏宽 × 44pt，贴在键盘上沿）。
                        if issue.auditType == .sufficientElementDescription, let e = el, label.isEmpty, e.identifier.isEmpty {
                            let kb = qa.app.keyboards.firstMatch
                            if kb.exists, kb.frame.insetBy(dx: 0, dy: -48).intersects(e.frame), e.frame.height <= 48 { print("B3Z audit waived (keyboard) \(seed) \(tag) frame=\(e.frame) keyboard=\(kb.frame)"); return true }
                        }
                        // 豁免 3：只读装饰元素的点击区
                        if issue.auditType == .hitRegion, let e = el, e.elementType != .button { return true }
                        let key = "\(seed)|\(issue.auditType.rawValue)|\(label.prefix(19))"
                        print("B3Z audit \(seed) \(tag): type=\(issue.auditType.rawValue) \(issue.compactDescription) [\(label.prefix(30))] id=\(el?.identifier ?? "") elType=\(el?.elementType.rawValue ?? 0) frame=\(el?.frame ?? .zero) key=\(key)")
                        if Self.known.contains(key) { return true }
                        fresh.append("\(tag) \(key): \(issue.compactDescription)")
                        return false
                    }
                    break
                } catch {
                    print("B3Z audit \(seed) \(tag) type=\(type.rawValue) error (attempt \(attempt)): \(error)")
                    if attempt >= 2 { fresh.append("\(tag) \(seed)|\(type.rawValue): 系统审计没跑完（\(error)）"); break }
                    Thread.sleep(forTimeInterval: 1)
                }
            }
        }
        qa.app.terminate()
        return fresh
    }

    private func run(_ seeds: [String], ax5: Bool) throws {
        continueAfterFailure = true
        var allFresh: [String] = []
        for seed in seeds {
            allFresh += try audit(seed, ax5: ax5)
        }
        XCTAssertTrue(allFresh.isEmpty, "审计新发现：\n" + allFresh.joined(separator: "\n"))
    }

    /// 三个 Tab 根页，默认字号。
    func testPerformAccessibilityAuditRootTabs() throws { try run(Self.roots, ax5: false) }
    /// 三个 Tab 根页，AX5。
    func testPerformAccessibilityAuditRootTabsAX5() throws { try run(Self.roots, ax5: true) }
    /// 主要推入页 / 弹层，默认字号。
    func testPerformAccessibilityAuditPushedPages() throws { try run(Self.pages, ax5: false) }
    /// 主要推入页 / 弹层，AX5。
    func testPerformAccessibilityAuditPushedPagesAX5() throws { try run(Self.pages, ax5: true) }
}
