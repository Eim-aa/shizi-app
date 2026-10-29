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

enum QAPending {
    /// 流程测试骨架（B3B4 §5.2）：还没填的用例，报「跳过」并写明由哪张卡填（flows-summary 记为待办，不算失败）。
    static func skip(_ card: String, _ what: String) throws {
        throw XCTSkip("待 \(card)：\(what)")
    }
}

/// R13：负载相关的偶发失败（多台模拟器同时在跑时点按没生效 / 合成触摸被取消 / 超时）统一在这里兜：
///   · 超时按一个系数放大：环境变量 QA_TIMEOUT_SCALE（xcodebuild 用 TEST_RUNNER_QA_TIMEOUT_SCALE=2 传入），没给就按启动时的负载均值定（空闲 1，机器很忙最高 5）；
///   · 重试最多一次，每次都打一行 `QA-RETRY …`（verify-native-ui.sh 从 flows.log 收进 flows.md 的「flaky retries」），重试不吞产品失败：
///     重试后仍没效果的点按只记 `QA-NOEFFECT` 警告（后面的断言照常判），重试后仍没落笔的笔照常 XCTFail。
enum QALoad {
    static let scale: Double = {
        if let s = ProcessInfo.processInfo.environment["QA_TIMEOUT_SCALE"], let v = Double(s), v > 0 { return v }
        var l = [Double](repeating: 0, count: 1)
        getloadavg(&l, 1)
        let ratio = l[0] / Double(max(1, ProcessInfo.processInfo.activeProcessorCount))
        return min(5, max(1, ratio * 1.5))
    }()
    nonisolated(unsafe) static var retries = 0
    static func retry(_ kind: String, _ detail: String) {
        retries += 1
        print("QA-RETRY \(kind) scale=\(String(format: "%.1f", scale)) \(detail)")
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
        settle(file: file, line: line)
    }

    /// R13：第一次点按之前，等页面就绪、导航空闲、没有原生写字页在恢复 / 收起途中——连续三次读探针（间隔 0.4s）路由顶层、原生页是否显示、转场记录条数都不变。
    func settle(file: StaticString = #filePath, line: UInt = #line) {
        var prev = ""
        var same = 0
        waitProbe("settled after launch", timeout: 20, file: file, line: line) { p in
            guard (p["pageReady"] as? Bool) == true, (p["navRunning"] as? Int ?? 0) == 0, (p["navAnim"] as? String ?? "idle") == "idle" else { same = 0; return false }
            let n = p["native"] as? [String: Any] ?? [:]
            let r = p["route"] as? [String: Any] ?? [:]
            let sig = "\(n["shown"] ?? "-")|\(r["top"] ?? "-")|\(p["topScreen"] ?? "-")|\((p["transitions"] as? [String])?.count ?? 0)"
            same = sig == prev ? same + 1 : 1
            prev = sig
            return same >= 3
        }
    }

    /// 杀进程再开（不带注入：测冷启动恢复）。
    func relaunchWithoutSeed() {
        app.terminate()
        seed = nil
        app.launchArguments = Self.args(seed: nil)
        app.launch()
        waitProbe("relaunch page ready", timeout: 40) { ($0["pageReady"] as? Bool) == true && ($0["hooks"] as? Bool) == true }
        Thread.sleep(forTimeInterval: 1.2)
        settle()
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
        let end = Date().addingTimeInterval(timeout * QALoad.scale)
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
    /// 声音 / 触觉事件记录（探针 feedback：haptic:<judge|seal|light|select>、sound:<文件名>，按发出顺序，最近 200 条）。
    var feedback: [String] { probe["feedback"] as? [String] ?? [] }
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

    /// 这一刻「看得见的状态」：探针里的路由 / 原生页 / 结果页 / 记录 / 播报 / 转场计数 + 元素自己的存在、标签、值、可用 + 会话与记录种类。
    private func tapSignature(_ e: XCUIElement) -> String {
        let p = probe
        let n = p["native"] as? [String: Any] ?? [:]
        let r = p["route"] as? [String: Any] ?? [:]
        let res = p["result"] as? [String: Any] ?? [:]
        let el = e.exists ? "\(e.label)|\(String(describing: e.value))|\(e.isEnabled)|\(e.isSelected)" : "gone"
        // 会话 / 记录种类整份（提示次数、跳过、写对写错这些只在会话里变的东西）；不取截图——点按之后马上要点撤销条（5 秒窗口）的用例经不起慢
        let data = (try? JSONSerialization.data(withJSONObject: ["s": p["sessions"] ?? [:], "k": p["kinds"] ?? [:]], options: [.sortedKeys])) ?? Data()
        let shot = String(data: data, encoding: .utf8) ?? ""
        return "\(r["top"] ?? "-")|\(p["topScreen"] ?? "-")|\(n["shown"] ?? "-")|\(n["phase"] ?? "-")|\(n["strokes"] ?? "-")|\(n["cursor"] ?? "-")|\(res["shown"] ?? "-")|\(p["records"] ?? "-")|\((p["a11y"] as? [String])?.count ?? 0)|\((p["transitions"] as? [String])?.count ?? 0)|\((p["webNav"] as? [String])?.count ?? 0)|\(el)|\(shot)"
    }

    /// 点一下并确认它有效果（R13）：状态 / 路由 / 元素 / 画面任一变化即算有效。机器很忙时点按偶尔被吞（录屏：点按落在上一个页面还在收起 / 恢复的途中，什么都没发生）——
    /// 没效果就重点一次（只在 tapSignature 全都没变时）（最多一次）、打 QA-RETRY 与探针；重点后还没效果只打 QA-NOEFFECT 警告（可能这一下本来就没有可见效果），不替产品掩盖：后面的断言照常判。
    func tap(_ e: XCUIElement, _ what: String, timeout: TimeInterval = 6, verify: Bool = true, file: StaticString = #filePath, line: UInt = #line) {
        guard e.waitForExistence(timeout: timeout * QALoad.scale) else {
            print("QA-H1 element tree when \(what) was not found:\n\(app.debugDescription)")
            XCTFail("not found: \(what)", file: file, line: line)
            return
        }
        // verify: false = 点完马上有 5 秒撤销窗口的按钮（跳过）：验证本身要读探针，机器忙时会吃掉窗口，不验证
        guard verify else { e.tap(); Thread.sleep(forTimeInterval: 0.5); return }
        let before = tapSignature(e)
        e.tap()
        Thread.sleep(forTimeInterval: 0.5) // 换状态后 0.4s 防误点
        if tapEffective(e, before) { return }
        guard e.exists else { return }
        QALoad.retry("tap-no-effect", "\(what) probe=\(probe)")
        e.tap()
        Thread.sleep(forTimeInterval: 0.5)
        if !tapEffective(e, before) { print("QA-NOEFFECT tap \(what) still shows no change after one retry; probe = \(probe)") }
    }

    private func tapEffective(_ e: XCUIElement, _ before: String) -> Bool {
        let end = Date().addingTimeInterval(2.5 * QALoad.scale)
        while true {
            if tapSignature(e) != before { return true }
            if Date() >= end { return false }
            Thread.sleep(forTimeInterval: 0.3)
        }
    }

    func tapNative(_ id: String, file: StaticString = #filePath, line: UInt = #line) { tap(el(id), id, verify: id != "native-write-skip", file: file, line: line) }

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

    /// 在原生书写格里画一笔（相对坐标 0–1），并确认原生页收下了（R13，原 R12 strokeLanded）：原生笔数有变化才返回。
    /// 机器很忙时 XCTest 合成的拖动偶尔在按下点停住、随后被系统取消（录屏：起笔点停 ~0.9s 后消失，没有移动、没有抬笔；
    /// 书写面按设计丢弃没写完的一笔，与网页 pointercancel 同语义）——这不是「写完的笔丢了」，按合成触摸失败重画一次（最多一次），
    /// 打 QA-RETRY 与书写面日志（native.inkLog）；重画后还没收下 = XCTFail（产品问题）。
    func stroke(from: CGVector = CGVector(dx: 0.2, dy: 0.45), to: CGVector = CGVector(dx: 0.8, dy: 0.5), grid: String = "native-write-grid", file: StaticString = #filePath, line: UInt = #line) {
        let before = native["strokes"] as? Int
        for attempt in 0..<2 {
            drag(from: from, to: to, grid: grid)
            guard let before else { return } // 原生页不在（别的格子）：无从确认
            let end = Date().addingTimeInterval(2.5 * QALoad.scale)
            var last: [String: Any] = [:]
            while Date() < end {
                last = native
                if let n = last["strokes"] as? Int, n != before { return }
                Thread.sleep(forTimeInterval: 0.25)
            }
            if attempt == 0 { QALoad.retry("stroke-not-received", "inkLog=\(last["inkLog"] ?? "-")") }
        }
        XCTFail("native page never received the stroke; probe.native = \(native)", file: file, line: line)
    }

    /// 只拖不确认（要在抬笔后立刻离开等场景用）。
    func drag(from: CGVector = CGVector(dx: 0.2, dy: 0.45), to: CGVector = CGVector(dx: 0.8, dy: 0.5), grid: String = "native-write-grid") {
        let g = el(grid)
        XCTAssertTrue(g.waitForExistence(timeout: 5 * QALoad.scale), "grid exists")
        g.coordinate(withNormalizedOffset: from).press(forDuration: 0.05, thenDragTo: g.coordinate(withNormalizedOffset: to), withVelocity: 300, thenHoldForDuration: 0.02)
        Thread.sleep(forTimeInterval: 0.35)
    }

    /// R12 的旧名：画一笔并确认笔数到 n（n 仅作为额外断言）。
    func strokeLanded(_ n: Int, file: StaticString = #filePath, line: UInt = #line) {
        stroke(file: file, line: line)
        if let c = native["strokes"] as? Int, c != n { XCTFail("expected \(n) strokes after the stroke, native has \(c)", file: file, line: line) }
    }

    /// 左缘右滑（N3：= 点左上）。
    /// 左缘右滑返回。机器很忙时 XCTest 合成的边缘拖动偶尔整个没被识别（R14：模拟器日志里这一下没有任何左缘识别器 began——网页容器、原生页都没有；
    /// 探针的路由 / 原生栈 / 转场记录 / 网页转场全都没变）——按合成触摸失败重滑一次（最多一次）、打 QA-RETRY；
    /// 有任何变化（开始跟手、回弹、出栈）都不重滑，重滑后还没效果交给后面的断言判（不替产品掩盖）。
    func edgeBack() {
        let w = app.windows.firstMatch
        edgeBack(from: w.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.55)).withOffset(CGVector(dx: 2, dy: 0)),
                 to: w.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.55)))
    }

    /// 从 start 起手的左缘拖动（起手点须在屏幕左缘），同样的「没效果重滑一次」。
    func edgeBack(from start: XCUICoordinate, to end: XCUICoordinate) {
        let before = edgeSignature()
        for attempt in 0..<2 {
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: 900, thenHoldForDuration: 0)
            Thread.sleep(forTimeInterval: 0.9)
            guard attempt == 0 else { return }
            let deadline = Date().addingTimeInterval(2.5 * QALoad.scale)
            while Date() < deadline {
                if edgeSignature() != before { return }
                Thread.sleep(forTimeInterval: 0.3)
            }
            QALoad.retry("edge-back-no-effect", "probe=\(probe)")
        }
    }

    /// 左缘返回「有没有发生任何事」：整份探针（路由、原生栈与根页、宿主呈现链、写字页阶段、结果页、会话、转场记录、网页转场记录……），只去掉自己会走的时钟。
    /// 宁可多算「有变化」（不重滑），不漏算（漏算会多返回一次：写字页判断阶段的左缘 = 回到写，只有 native.phase 变）。
    private func edgeSignature() -> String {
        var p = probe
        p.removeValue(forKey: "clock")
        let data = (try? JSONSerialization.data(withJSONObject: p, options: [.sortedKeys])) ?? Data()
        return String(data: data, encoding: .utf8) ?? ""
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
