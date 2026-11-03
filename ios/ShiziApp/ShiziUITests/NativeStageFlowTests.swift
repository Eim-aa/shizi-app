import XCTest

// B3.2 NativeStage（通用原生屏）的流程：试点页「关于」与三个子页（计划 §6.1 B3.2 验收：网页 → 原生 → 原生 → 网页 推入 / 返回 / 跟手取消；
// 点按到转场第一帧 p95 ≤ 50ms）。网页路由仍是真相源：探针 route 是网页栈，stage.screens 是原生栈（底 → 顶），transitions 是原生转场记录。
@MainActor
final class NativeStageFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// 关于拾字（「我的」菜单行，网页）
    private let aboutRow = "\u{5173}\u{4E8E}\u{62FE}\u{5B57}"

    private func stage(_ qa: QA) -> [String] { ((qa.probe["stage"] as? [String: Any])?["screens"] as? [String]) ?? [] }

    private func waitStage(_ qa: QA, _ want: [String], file: StaticString = #filePath, line: UInt = #line) {
        qa.waitProbe("stage \(want)", file: file, line: line) { (($0["stage"] as? [String: Any])?["screens"] as? [String]) == want && ($0["navRunning"] as? Int) == 0 }
    }

    private func openAbout(_ qa: QA) {
        qa.launch()
        qa.waitProbe("mine tab") { (($0["route"] as? [String: Any])?["tab"] as? String) == "mine" }
        qa.tap(qa.button(aboutRow), "mine › about")
        waitStage(qa, ["about"])
    }

    /// 「我的」（B3.5d 起原生根页）→ 原生关于（T-push，网页不另播）→ 原生隐私（推入，下层是原生关于）→「‹」回关于 → 左缘右滑跟手回「我的」（网页）。
    func test900_webNativeNativeWebPushAndBack() {
        let qa = QA(seed: "mine-empty")
        openAbout(qa)
        XCTAssertTrue(qa.transitions.contains("screen:open about via=push"), "\(qa.transitions)")
        XCTAssertTrue(qa.transitions.contains("present:push"), "\(qa.transitions)")
        XCTAssertTrue(qa.webNav.contains("push:native"), "the web does not play its own push: \(qa.webNav)")
        XCTAssertEqual(qa.route["top"] as? String, "about")
        Thread.sleep(forTimeInterval: 0.5) // 新状态 0.4s 防误点
        qa.tapNative("native-about-row-privacy")
        waitStage(qa, ["about", "about-privacy"])
        XCTAssertEqual(qa.route["top"] as? String, "about-privacy")
        XCTAssertTrue(qa.el("native-about-privacy-p").waitForExistence(timeout: 3))
        // 「‹」= 原生 T-push 倒放，收起后网页出栈（不再播）
        qa.tapNative("native-page-back")
        waitStage(qa, ["about"])
        qa.waitRouteTop("about")
        XCTAssertTrue(qa.transitions.contains("dismiss:push"), "\(qa.transitions)")
        XCTAssertTrue(qa.transitions.contains("screen:back about-privacy"), "\(qa.transitions)")
        // 左缘右滑（跟手）回到网页「我的」
        qa.edgeBack()
        waitStage(qa, [])
        qa.waitProbe("back on mine") { (($0["route"] as? [String: Any])?["tab"] as? String) == "mine" && (($0["route"] as? [String: Any])?["depth"] as? Int) == 0 }
        XCTAssertTrue(qa.transitions.contains("drag:push"), "\(qa.transitions)")
        XCTAssertTrue(qa.transitions.contains("dismiss:push:interactive"), "\(qa.transitions)")
        XCTAssertFalse(qa.transitions.contains("overlap"), "\(qa.transitions)")
        XCTAssertFalse(qa.webNav.contains { $0.hasPrefix("pop:") && !$0.hasSuffix(":native") }, "no web pop animation for the native entry: \(qa.webNav)")
        XCTAssertTrue(qa.button(aboutRow).waitForExistence(timeout: 3), "back on the web mine page")
    }

    /// 左缘右滑没过阈值就松手：页面回弹、原生栈与网页栈都不变（跟手取消）。
    func test901_edgeDragCancelKeepsThePage() {
        let qa = QA(seed: "mine-empty")
        openAbout(qa)
        Thread.sleep(forTimeInterval: 0.5)
        qa.tapNative("native-about-row-credits")
        waitStage(qa, ["about", "about-credits"])
        let w = qa.app.windows.firstMatch
        let start = w.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.55)).withOffset(CGVector(dx: 2, dy: 0))
        let end = w.coordinate(withNormalizedOffset: CGVector(dx: 0.18, dy: 0.55))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: 60, thenHoldForDuration: 0.4)
        Thread.sleep(forTimeInterval: 0.9)
        waitStage(qa, ["about", "about-credits"])
        XCTAssertEqual(qa.route["top"] as? String, "about-credits")
        XCTAssertTrue(qa.transitions.contains("drag:push"), "\(qa.transitions)")
        XCTAssertFalse(qa.transitions.contains("dismiss:push:interactive"), "cancelled, not committed: \(qa.transitions)")
        // 再滑过阈值：回到原生关于
        qa.edgeBack()
        waitStage(qa, ["about"])
        qa.waitRouteTop("about")
    }

    /// 原生 → 原生 → 「‹」两次回到网页（每一层出栈各一次 nav.back，网页栈与原生栈同步）。
    func test902_backTwiceReturnsToTheWebPage() {
        let qa = QA(seed: "mine-empty")
        openAbout(qa)
        Thread.sleep(forTimeInterval: 0.5)
        qa.tapNative("native-about-row-letter")
        waitStage(qa, ["about", "about-letter"])
        XCTAssertTrue(qa.el("native-about-letter-address").waitForExistence(timeout: 3))
        qa.tapNative("native-page-back")
        waitStage(qa, ["about"])
        qa.tapNative("native-page-back")
        waitStage(qa, [])
        qa.waitProbe("back on mine") { (($0["route"] as? [String: Any])?["depth"] as? Int) == 0 }
    }

    /// 点按（原生页里的行）→ 转场第一帧：p95 ≤ 50ms（计划 §3.3 量测门槛；模拟器 Debug）。点按经 nav.push 交给网页路由，宿主挂载回发 open，原生开始转场。
    func test903_tapToFirstFrameP95() {
        let qa = QA(seed: "mine-empty")
        openAbout(qa)
        // B3.5d：「我的」根页常开原生后，进关于页（起点的准备动作）这一下也记一个样本（从根页第一次推入，冷启动的首个转场）；只量下面 20 次点按
        let setup = ((qa.probe["stage"] as? [String: Any])?["latency"] as? [NSNumber])?.count ?? 0
        for _ in 0..<20 {
            Thread.sleep(forTimeInterval: 0.5)
            qa.tapNative("native-about-row-privacy")
            waitStage(qa, ["about", "about-privacy"])
            qa.tapNative("native-page-back")
            waitStage(qa, ["about"])
        }
        let lat = Array((((qa.probe["stage"] as? [String: Any])?["latency"] as? [NSNumber])?.map(\.doubleValue) ?? []).dropFirst(setup))
        XCTAssertGreaterThanOrEqual(lat.count, 20, "one sample per tap: \(lat)")
        let sorted = lat.sorted()
        let p95 = sorted[min(sorted.count - 1, Int((Double(sorted.count) * 0.95).rounded(.up)) - 1)]
        let p50 = sorted[sorted.count / 2]
        let a = XCTAttachment(string: String(format: "tap → first frame (ms): p50 %.1f, p95 %.1f, max %.1f, n %d\n%@", p50, p95, sorted.last ?? 0, sorted.count, lat.map { String(format: "%.1f", $0) }.joined(separator: ", ")))
        a.name = "B3.2 latency"
        a.lifetime = .keepAlways
        add(a)
        print(String(format: "B3.2 latency p50 %.1f p95 %.1f n %d", p50, p95, sorted.count))
        XCTAssertLessThanOrEqual(p95, 50, "tap → first frame p95 \(p95)ms (samples \(lat))")
    }
}
