import XCTest

// QA-H1：原生写字页流程测试（XCUITest，真实触摸）的公用工具。
//
// 启动：App 带 -shizi-test-host（页面测试钩子）+ -shizi-native-write（原生写字页开关）+ -shizi-qa-seed <状态>（NativeQAHarness 注入：
// 清空数据、开「这次选的字」5 字组并带到指定阶段）+ -shizi-qa-probe（探针）。
// 断言：
//   · 原生页面元素经 accessibilityIdentifier（native-write-*）找；网页页面（首页 / 字库 / 结果页…）经无障碍名称（文案）找；
//   · 数据经探针：读屏元素「qa-probe」的 value 是 store 摘要 JSON（记录条数与种类、判断写对 / 写错数、会话 cursor / 阶段 / 笔数、
//     路由顶层、原生页阶段与字、最近的原生转场），见 NativeQAHarness.swift QAProbe。
// 已知问题（两份 AI 测试报告 NP-* / NF-*）在 KnownIssueTests 里，用 XCTExpectFailure 标「预期失败 · 待修」，修好后会显示「意外通过」。

enum QAIssue {
    /// 预期失败（待修）：issue 写进失败说明，修复卡转绿后删掉这一层包装。
    static func expectFail(_ id: String, _ title: String, _ body: () throws -> Void) rethrows {
        let options = XCTExpectedFailure.Options()
        options.isStrict = true // 修好后报「预期失败没有发生」= 意外通过，提醒把包装去掉
        try XCTExpectFailure("\(id) 待修：\(title)", options: options, failingBlock: body)
    }
}

@MainActor
final class QA {
    let app = XCUIApplication()
    private(set) var seed: String?

    init(seed: String?, native: Bool = true, failNext: Int = 0, reduceMotion: Bool = false, extra: [String] = []) {
        self.seed = seed
        app.launchArguments = Self.args(seed: seed, native: native, failNext: failNext) + (reduceMotion ? ["-shizi-qa-reduce-motion"] : []) + extra
    }

    static func args(seed: String?, native: Bool = true, failNext: Int = 0) -> [String] {
        var a = ["-shizi-test-host", "-shizi-qa-probe", native ? "-shizi-native-write" : "-shizi-native-write-off"]
        if let seed { a += ["-shizi-qa-seed", seed] }
        if failNext > 0 { a += ["-shizi-qa-fail-next", String(failNext)] }
        return a
    }

    /// 启动并等注入完成（探针 seed = ok）。
    func launch(file: StaticString = #filePath, line: UInt = #line) {
        app.launch()
        waitProbe("seed applied", timeout: 40, file: file, line: line) { p in
            guard (p["pageReady"] as? Bool) == true else { return false }
            if self.seed == nil { return (p["hooks"] as? Bool) == true }
            return (p["seed"] as? String) == "ok"
        }
        if let s = probe["seed"] as? String, s != "ok" { XCTFail("seed failed: \(s)", file: file, line: line) }
        // 原生页转场与 0.4s 防误点
        Thread.sleep(forTimeInterval: 0.8)
    }

    /// 杀进程再开（不带注入：测冷启动恢复）。
    func relaunchWithoutSeed() {
        app.terminate()
        seed = nil
        app.launchArguments = Self.args(seed: nil)
        app.launch()
        waitProbe("relaunch page ready", timeout: 40) { ($0["pageReady"] as? Bool) == true && ($0["hooks"] as? Bool) == true }
        Thread.sleep(forTimeInterval: 1.2)
    }

    // MARK: 探针

    var probe: [String: Any] {
        let e = app.staticTexts["qa-probe"]
        guard e.waitForExistence(timeout: 10), let s = e.value as? String, let d = s.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return [:] }
        return obj
    }

    @discardableResult
    func waitProbe(_ what: String, timeout: TimeInterval = 8, file: StaticString = #filePath, line: UInt = #line, _ cond: ([String: Any]) -> Bool) -> [String: Any] {
        let end = Date().addingTimeInterval(timeout)
        var last: [String: Any] = [:]
        while Date() < end {
            last = probe
            if cond(last) { return last }
            Thread.sleep(forTimeInterval: 0.25)
        }
        print("QA-H1 element tree on timeout (\(what)):\n\(app.debugDescription)")
        XCTFail("timed out: \(what); probe = \(last)", file: file, line: line)
        return last
    }

    var native: [String: Any] { probe["native"] as? [String: Any] ?? [:] }
    /// B2.7：原生结果页（探针 result）。
    var resultInfo: [String: Any] { probe["result"] as? [String: Any] ?? [:] }
    var resultShown: Bool { resultInfo["shown"] as? Bool == true }

    func waitResult(_ shown: Bool, timeout: TimeInterval = 8, file: StaticString = #filePath, line: UInt = #line) {
        waitProbe(shown ? "native result shown" : "native result gone", timeout: timeout, file: file, line: line) { (($0["result"] as? [String: Any])?["shown"] as? Bool ?? false) == shown }
    }
    var nativeShown: Bool { native["shown"] as? Bool == true }
    func session(_ slot: String = "B") -> [String: Any] { (probe["sessions"] as? [String: Any])?[slot] as? [String: Any] ?? [:] }
    var route: [String: Any] { probe["route"] as? [String: Any] ?? [:] }
    var kinds: [String: Int] { probe["kinds"] as? [String: Int] ?? [:] }
    var records: Int { probe["records"] as? Int ?? -1 }
    var transitions: [String] { probe["transitions"] as? [String] ?? [] }
    /// B2.9b：冷启动判定（route-memory lastPlan：{reason, restored}）与页面时钟（ms，QA 钉住时跨重开保持）。
    var coldPlan: [String: Any] { probe["coldPlan"] as? [String: Any] ?? [:] }
    var clockMs: Double { (probe["clock"] as? NSNumber)?.doubleValue ?? 0 }
    /// B2.8：网页 root.js 的转场记录（push:native = 让给原生；push:slide / pop:paper … = 网页自己播）。
    var webNav: [String] { probe["webNav"] as? [String] ?? [] }

    // MARK: 元素

    /// 原生元素（accessibilityIdentifier）。
    func el(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }

    /// 网页或原生里名称为 label 的按钮。
    func button(_ label: String) -> XCUIElement { app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch }
    func buttonContaining(_ text: String) -> XCUIElement { app.buttons.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch }
    func text(_ label: String) -> XCUIElement { app.staticTexts.matching(NSPredicate(format: "label == %@", label)).firstMatch }
    func textContaining(_ s: String) -> XCUIElement { app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", s)).firstMatch }

    func tap(_ e: XCUIElement, _ what: String, timeout: TimeInterval = 6, file: StaticString = #filePath, line: UInt = #line) {
        guard e.waitForExistence(timeout: timeout) else {
            print("QA-H1 element tree when \(what) was not found:\n\(app.debugDescription)")
            XCTFail("not found: \(what)", file: file, line: line)
            return
        }
        e.tap()
        Thread.sleep(forTimeInterval: 0.5) // 换状态后 0.4s 防误点
    }

    func tapNative(_ id: String, file: StaticString = #filePath, line: UInt = #line) { tap(el(id), id, file: file, line: line) }

    /// 点撤销条右端的「撤销」（撤销条整体是一个读屏元素，按钮不单独出现在无障碍树里时按位置点）。
    func tapUndoBar(file: StaticString = #filePath, line: UInt = #line) {
        let b = el("native-write-skip-undo")
        if b.waitForExistence(timeout: 1.5) { b.tap(); return }
        let text = el("native-write-undo-text")
        guard text.waitForExistence(timeout: 3) else { XCTFail("undo bar not found", file: file, line: line); return }
        // 「撤销」在撤销条右端（条左右各留页边 20pt）
        let w = app.windows.firstMatch.frame.width
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: w - 44, dy: text.frame.midY)).tap()
    }

    /// 在原生书写格里画一笔（相对坐标 0–1）。
    func stroke(from: CGVector = CGVector(dx: 0.2, dy: 0.45), to: CGVector = CGVector(dx: 0.8, dy: 0.5), grid: String = "native-write-grid") {
        let g = el(grid)
        XCTAssertTrue(g.waitForExistence(timeout: 5), "grid exists")
        g.coordinate(withNormalizedOffset: from).press(forDuration: 0.05, thenDragTo: g.coordinate(withNormalizedOffset: to), withVelocity: 300, thenHoldForDuration: 0.02)
        Thread.sleep(forTimeInterval: 0.35)
    }

    /// 画一笔并确认原生页收下了（R12）：原生笔数到 n 才返回。机器很忙时 XCTest 合成的拖动偶尔在按下点停住、随后被系统取消
    /// （录屏：起笔点停 ~0.9s 后消失，没有移动、没有抬笔；书写面按设计丢弃没写完的一笔，与网页 pointercancel 同语义）——
    /// 这不是「写完的笔丢了」，按合成触摸失败重画一次，并把书写面日志（native.inkLog）打进测试输出备查。
    func strokeLanded(_ n: Int, file: StaticString = #filePath, line: UInt = #line) {
        for attempt in 0..<2 {
            stroke()
            let end = Date().addingTimeInterval(2)
            var last: [String: Any] = [:]
            while Date() < end {
                last = native
                if last["strokes"] as? Int == n { return }
                Thread.sleep(forTimeInterval: 0.25)
            }
            print("QA-H1 synthesized stroke not received (attempt \(attempt)); inkLog = \(last["inkLog"] ?? "-")")
        }
        XCTFail("native page never received the stroke; probe.native = \(native)", file: file, line: line)
    }

    /// 左缘右滑（N3：= 点左上）。
    func edgeBack() {
        let w = app.windows.firstMatch
        let start = w.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.55)).withOffset(CGVector(dx: 2, dy: 0))
        let end = w.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.55))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: 900, thenHoldForDuration: 0)
        Thread.sleep(forTimeInterval: 0.9)
    }

    func waitNative(_ shown: Bool, timeout: TimeInterval = 8, file: StaticString = #filePath, line: UInt = #line) {
        waitProbe(shown ? "native page shown" : "native page gone", timeout: timeout, file: file, line: line) { (($0["native"] as? [String: Any])?["shown"] as? Bool ?? false) == shown }
    }

    func waitRouteTop(_ name: String, timeout: TimeInterval = 8, file: StaticString = #filePath, line: UInt = #line) {
        waitProbe("route top \(name)", timeout: timeout, file: file, line: line) { (($0["route"] as? [String: Any])?["top"] as? String) == name || ($0["topScreen"] as? String) == name }
    }

    func attach(_ test: XCTestCase, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        test.add(a)
    }
}
