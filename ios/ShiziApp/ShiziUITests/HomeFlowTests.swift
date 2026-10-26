import XCTest

// B3.5a 首页流程（B3B4 §5.2 HomeFlowTests）：原生首页（tab 根页，夹具 op nativeRoots 打开；B3.5d 前默认关）。
// 探针：stage.root = 原生根页 {screen, hidden, page:{view, cta, ctaId, ctaFrame, failed, undoBar, brand, source}}；route = 网页栈（仍是真相源）；
// transitions = 原生转场记录（present:paper = T-paper 纸展开，dismiss:paper = 纸缩回）。
@MainActor
final class HomeFlowTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func root(_ qa: QA) -> [String: Any] { ((qa.probe["stage"] as? [String: Any])?["root"] as? [String: Any]) ?? [:] }
    private func page(_ p: [String: Any]) -> [String: Any] { ((p["stage"] as? [String: Any])?["root"] as? [String: Any])?["page"] as? [String: Any] ?? [:] }

    /// 原生首页出来、看得见、转场停了。
    private func waitHome(_ qa: QA, file: StaticString = #filePath, line: UInt = #line) {
        qa.waitProbe("native home shown", timeout: 25, file: file, line: line) { p in
            let r = (p["stage"] as? [String: Any])?["root"] as? [String: Any]
            return r?["screen"] as? String == "home" && r?["hidden"] as? Bool == false && (p["navRunning"] as? Int) == 0
                && ((p["route"] as? [String: Any])?["depth"] as? Int) == 0
        }
    }

    private func launchHome(_ seed: String) -> QA {
        let qa = QA(seed: seed)
        qa.launch()
        waitHome(qa)
        Thread.sleep(forTimeInterval: 0.6) // 原生页出现后 0.4s 防误点（同网页 pressGuard）
        return qa
    }

    /// 点原生主按钮进写字页：等原生写字页出现。
    /// 机器忙或页面刚换过状态时，第一次点按可能落在防误点窗口里（网页 Button.js pressGuard：换状态后 0.4s 不响应，原生同规则），
    /// 这一次点按不算数：出了窗口再点一次（同 QAApp.strokeLanded 对合成触摸的重试做法）。
    private func tapCtaIntoWrite(_ qa: QA, _ seed: String, file: StaticString = #filePath, line: UInt = #line) {
        qa.tapNative("native-home-start", file: file, line: line)
        for attempt in 0..<2 {
            let end = Date().addingTimeInterval(attempt == 0 ? 5 : 15)
            while Date() < end {
                if qa.nativeShown { return }
                Thread.sleep(forTimeInterval: 0.25)
            }
            print("QA-H1 主按钮点按没进写字页（\(seed)，第 \(attempt + 1) 次）")
            Thread.sleep(forTimeInterval: 1.0) // 出了防误点窗口再点
            if qa.nativeShown { return }
            qa.tapNative("native-home-start", file: file, line: line)
        }
        qa.waitNative(true, timeout: 10, file: file, line: line)
    }

    /// 六态主按钮各自去处：首次打开 / 今天还没写 → 写字页（原生，T-paper）；练习范围学完「换练习范围」→ 换库页（网页，原生根页让开）；开组失败 → 三段式。
    func testSixStatesMainButtonDestinations() {
        for seed in ["home-first", "home-fresh", "home-progress", "home-today", "home-back", "home-special"] {
            let qa = launchHome(seed)
            tapCtaIntoWrite(qa, seed)
            qa.waitRouteTop("write", timeout: 20)
            XCTAssertTrue(qa.transitions.contains("present:paper"), "\(seed): T-paper from the CTA \(qa.transitions)")
            qa.app.terminate()
        }
        let ex = launchHome("home-exhausted")
        XCTAssertEqual(page(ex.probe)["cta"] as? String, "\u{6362}\u{7EC3}\u{4E60}\u{8303}\u{56F4}") // 换练习范围
        ex.tapNative("native-home-start")
        ex.waitRouteTop("library-switch", timeout: 20)
        ex.waitProbe("root steps aside for the web page") { (($0["stage"] as? [String: Any])?["root"] as? [String: Any])?["hidden"] as? Bool == true }
        // 网页换库页返回：原生根页回来
        ex.tap(ex.button("\u{8FD4}\u{56DE}"), "web back") // 返回
        waitHome(ex)
    }

    /// 开组失败就地保留；重试只开一组，成功后进入写字页。
    func testStartFailureRetriesInPlace() {
        let qa = launchHome("home-start-fail")
        XCTAssertEqual(page(qa.probe)["failed"] as? Bool, true)
        XCTAssertTrue(qa.el("native-home-start-fail-cancel").exists)
        XCTAssertEqual(qa.route["top"] as? String, "home")
        // 失败态的主按钮就是「再试一次」（网页此时的主按钮 data-testid 也换成 home-start-fail-retry，网页失败态是同一个按钮换字）
        qa.tapNative("native-home-start-fail-retry")
        qa.waitNative(true, timeout: 25)
        qa.waitRouteTop("write", timeout: 20)
        XCTAssertEqual(qa.session("A")["cursor"] as? Int, 0)
    }

    /// T-paper 首帧 = 来源矩形、返回末帧 = 当前矩形（IC-23 原生版）：主按钮的真实矩形随 home.start 交给页面（D62），返回时纸缩回原生报的此刻矩形。
    func testPaperTransitionFirstFrameIsSourceRect() {
        let qa = launchHome("home-fresh")
        let p0 = page(qa.probe)
        let frame = p0["ctaFrame"] as? [Double] ?? []
        XCTAssertEqual(frame.count, 4)
        let source = p0["source"] as? String ?? ""
        let reported = source.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
        let rect = reported?["rect"] as? [String: Double] ?? [:]
        XCTAssertEqual([rect["x"], rect["y"], rect["w"], rect["h"]].compactMap { $0 }, frame, "reported source = CTA frame")
        qa.tapNative("native-home-start")
        qa.waitNative(true, timeout: 25)
        let paperOpen = qa.waitProbe("paper open") { (($0["transitions"] as? [String]) ?? []).contains("present:paper") }
        XCTAssertFalse(((paperOpen["transitions"] as? [String]) ?? []).contains("overlap"))
        Thread.sleep(forTimeInterval: 0.6)
        // 返回：纸缩回主按钮（这时字已是「继续写字 · 0 / 3」）
        qa.tapNative("native-write-back")
        qa.waitNative(false, timeout: 25)
        waitHome(qa)
        XCTAssertTrue(qa.transitions.contains("dismiss:paper"), "\(qa.transitions)")
        let p1 = page(qa.probe)
        XCTAssertEqual(p1["view"] as? String, "progress")
        XCTAssertEqual(p1["ctaFrame"] as? [Double], frame, "the CTA did not move (D53 ③ one bottom line)")
    }

    /// 「自己选字」打开原生查字弹层（pick；B3.6 Screens/Query.swift）：网页 openPick 推入原生查字屏，盖在原生首页上面（首页不让开）；「完成」关掉后回到首页。
    func testPickCharsEntry() {
        let qa = launchHome("home-fresh")
        qa.tapNative("native-home-pick")
        qa.waitProbe("native query sheet over the root") { p in
            ((p["stage"] as? [String: Any])?["screens"] as? [String]) == ["query"] && (((p["stage"] as? [String: Any])?["root"] as? [String: Any])?["hidden"] as? Bool) == false
        }
        XCTAssertTrue(qa.el("native-query-sheet").waitForExistence(timeout: 5 * QALoad.scale), "the native pick sheet")
        XCTAssertEqual(qa.el("native-query-title").label, "\u{81EA}\u{5DF1}\u{9009}\u{5B57}", "pick sheet title")
        qa.tapNative("native-query-done")
        waitHome(qa)
    }

    /// 特别组顺延（「写平常字」）：顺延 + 开一组平常的（网页 deferCapital），进写字页。
    func testSpecialGroupDeferral() {
        let qa = launchHome("home-special")
        XCTAssertTrue(qa.el("native-home-capital-defer").waitForExistence(timeout: 4))
        qa.tapNative("native-home-capital-defer")
        qa.waitNative(true, timeout: 25)
        qa.waitRouteTop("write", timeout: 20)
        XCTAssertEqual(qa.session("A")["kind"] as? String, "daily", "a plain daily group, not the capital one")
    }

    /// 离开撤销条交接（写字页跳过后离开，撤销机会跟到原生首页）；点「撤销」回到那个字。撤销机会只有 5 秒：在测试里现做（夹具 home-leave-undo 的同一串动作）。
    func testLeaveUndoBarHandoff() {
        let qa = launchHome("home-fresh")
        qa.tapNative("native-home-start")
        qa.waitNative(true, timeout: 25)
        Thread.sleep(forTimeInterval: 0.5)
        // 撤销机会只有 5 秒：跳过 → 返回 → 撤销连着点（不等探针）
        qa.el("native-write-skip").tap()
        qa.el("native-write-back").tap()
        let undo = qa.el("native-write-skip-undo")
        XCTAssertTrue(undo.waitForExistence(timeout: 3), "the undo bar followed to the native home")
        // S4：按住超过原来5秒的截止时刻仍可撤销；网页宿主不能在原生条下面另开一个计时器。
        qa.el("native-write-undo-text").press(forDuration: 6)
        XCTAssertTrue(undo.exists, "holding the native bar pauses its lifetime")
        undo.tap()
        qa.waitNative(true, timeout: 25)
        qa.waitRouteTop("write", timeout: 20)
        XCTAssertEqual(qa.session("A")["cursor"] as? Int, 0, "back on the skipped char")
    }

    /// 首次打开的品牌时刻：测试宿主与网页同规则不放动画（brandAllowed：测试宿主要 URL brand=1）——首帧就是静帧、主按钮可点。
    func testFirstBrandMomentTapFreezes() {
        let qa = launchHome("home-first")
        let p = page(qa.probe)
        XCTAssertEqual(p["view"] as? String, "first")
        XCTAssertEqual(p["brand"] as? Bool, false, "static frame")
        XCTAssertTrue(qa.el("native-home-start").exists)
    }

    /// 冷启动恢复到首页（-shizi-native-roots：tab 根页从启动起就是原生）。
    func testColdStartRestoresHome() {
        let qa = launchHome("home-progress")
        qa.app.terminate()
        qa.app.launchArguments = QA.args(seed: nil) + ["-shizi-native-roots"]
        qa.app.launch()
        qa.waitProbe("relaunch page ready", timeout: 40) { ($0["pageReady"] as? Bool) == true && ($0["hooks"] as? Bool) == true }
        waitHome(qa)
        XCTAssertEqual(page(qa.probe)["view"] as? String, "progress")
        XCTAssertTrue(qa.el("native-home-start").waitForExistence(timeout: 4))
    }
}
