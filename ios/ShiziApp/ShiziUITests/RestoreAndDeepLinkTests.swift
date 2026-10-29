import XCTest

// B3.F 冷启动恢复与提醒深链（B3B4 §5.2 · RestoreAndDeepLinkTests；计划 §3.3 段 2 第 2–4 条）。
// 段 2 起页面栈在原生：每次栈变化原生调 route.save（引擎写路由提示键），冷启动 pageReady 后调 route.plan——判定（守卫 RESTORE_GUARDS、
// 过期 / 跨 4 点、深链 / 坏值 / 阻断优先）全在 JS planColdStart，原生按回包无转场重建。提醒深链：AppDelegate → deeplink.reminder（同一个
// JS 处理：开 B 组，B 组没写完弹 S02），原生 T-quiet 打开。
// 探针：route = 引擎镜像的栈（与原生同步），coldPlan = 最近一次冷启动判定 {reason, restored}，transitions 里 route:plan <reason> …。
// 启动参数（DEBUG 测试宿主）：-shizi-reminder-target <cardKey> 冷启动深链；-shizi-qa-warm-reminder <cardKey> 栈建好后几秒的热深链；
// -shizi-qa-clock-advance <分钟> 这次启动前把 QA 时钟往后拨；-shizi-qa-storage-unavailable 这次启动存储探测失败（阻断页）。

@MainActor
final class RestoreAndDeepLinkTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    nonisolated private static func top(_ p: [String: Any]) -> String? { (p["route"] as? [String: Any])?["top"] as? String }
    nonisolated private static func depth(_ p: [String: Any]) -> Int { (p["route"] as? [String: Any])?["depth"] as? Int ?? -1 }
    nonisolated private static func reason(_ p: [String: Any]) -> String? { (p["coldPlan"] as? [String: Any])?["reason"] as? String }
    nonisolated private static func screens(_ p: [String: Any]) -> [String] { ((p["stage"] as? [String: Any])?["screens"] as? [String]) ?? [] }
    nonisolated private static func shown(_ p: [String: Any], _ key: String) -> Bool { ((p[key] as? [String: Any])?["shown"] as? Bool) == true }

    /// 这一页在屏上：写字 / 结果页看 B2 探针，其余看原生屏栈顶。
    nonisolated private static func onScreen(_ p: [String: Any], _ screen: String) -> Bool {
        switch screen {
        case "write": return shown(p, "native")
        case "result": return shown(p, "result")
        default: return screens(p).last == screen
        }
    }

    private func start(_ seed: String, extra: [String] = []) -> QA {
        let qa = QA(seed: seed, extra: extra)
        qa.launch()
        return qa
    }

    /// 杀进程再开（不注入），带这次启动的参数。
    private func relaunch(_ qa: QA, _ extra: [String]) {
        qa.app.terminate()
        qa.app.launchArguments = QA.args(seed: nil) + extra
        qa.app.launch()
        qa.waitProbe("relaunch page ready", timeout: 40) { ($0["pageReady"] as? Bool) == true && ($0["hooks"] as? Bool) == true }
    }

    /// 冷启动之后落在首页（tab 根、没有推入页），判定原因 = reason。
    private func waitHome(_ qa: QA, reason: String, file: StaticString = #filePath, line: UInt = #line) {
        qa.waitProbe("cold start lands on home (\(reason))", timeout: 30, file: file, line: line) { p in
            Self.reason(p) == reason && Self.top(p) == "home" && Self.depth(p) == 0 && Self.screens(p).isEmpty && !Self.shown(p, "native") && (p["navRunning"] as? Int) == 0
        }
    }

    // MARK: 恢复

    /// 杀进程恢复：守卫表里每一种可恢复的栈（写字页 / 结果页 / 单字详情 / 旧照片页）+ 不依赖易失状态的普通原生屏（关于）。
    /// 原生按 route.plan 的回包无转场重建：栈顶是那一页、在屏上，判定 ok，转场记录是 restore（不重演进入动画，S5）。
    func testKillRestoresEachPage() {
        for (seed, screen) in [("recall", "write"), ("result-daily", "result"), ("detail-wrong", "detail"), ("photo", "detail-photo"), ("about", "about")] {
            let qa = start(seed)
            qa.waitProbe("\(seed) on \(screen)", timeout: 20) { Self.top($0) == screen && Self.onScreen($0, screen) }
            Thread.sleep(forTimeInterval: 1.0) // route.save（单一写入者，免事务写）
            let depthBefore = Self.depth(qa.probe)
            qa.relaunchWithoutSeed()
            qa.waitProbe("\(seed) restored to \(screen)", timeout: 30) { p in
                Self.reason(p) == "ok" && Self.top(p) == screen && Self.depth(p) == depthBefore && Self.onScreen(p, screen) && (p["navRunning"] as? Int) == 0
            }
            XCTAssertTrue(qa.transitions.contains { $0.hasPrefix("route:plan ok restored=true") }, "\(seed): \(qa.transitions)")
            XCTAssertFalse(qa.transitions.contains { $0.hasPrefix("present:") && $0 != "present:none" }, "\(seed): restored without an entry transition: \(qa.transitions)")
            qa.app.terminate()
        }
    }

    /// 离开太久（P108 maxAgeMinutes = 360）不恢复，落首页。
    func testStaleNotRestored() {
        let qa = start("about")
        qa.waitProbe("about") { Self.top($0) == "about" && Self.onScreen($0, "about") }
        Thread.sleep(forTimeInterval: 1.0)
        relaunch(qa, ["-shizi-qa-clock-advance", "400"])
        waitHome(qa, reason: "stale")
    }

    /// 跨凌晨 4 点（本地日分界）不恢复：凌晨 3 点停在「关于」，拨到 4 点半（只过了 1.5 小时，没超过离开时长上限）→ 落首页。
    func testAcross4amNotRestored() {
        let qa = start("_restore-late")
        qa.waitProbe("about at 3am") { Self.top($0) == "about" && Self.onScreen($0, "about") }
        Thread.sleep(forTimeInterval: 1.0)
        relaunch(qa, ["-shizi-qa-clock-advance", "90"])
        waitHome(qa, reason: "stale")
    }

    /// 坏的路由提示（栈里有一页不该恢复：重写错字页只在内存里练）→ 整个栈不恢复，落首页（安全降级）。
    func testBadRouteHintGoesHome() {
        let qa = start("redo")
        qa.waitProbe("redo on screen", timeout: 20) { Self.top($0) == "redo" }
        Thread.sleep(forTimeInterval: 1.0)
        qa.relaunchWithoutSeed()
        waitHome(qa, reason: "invalid:redo")
    }

    /// 坏值优先（这次启动隔离了坏值）：由 node 单测覆盖（test/ui/route-memory.test.mjs planColdStart corrupt）——冷启动注入坏值要改存储层，App 里没有测试入口。
    func testCorruptNoticePriority() throws { try QAPending.skip("B3.F", "坏值优先：planColdStart 的 node 单测覆盖；App 内无启动时隔离坏值的测试入口") }

    /// 阻断优先：停在「关于」→ 这次启动存储不可用 → 不恢复（判定 blocked），原生阻断页盖上。
    func testBlockPriority() {
        let qa = start("about")
        qa.waitProbe("about") { Self.top($0) == "about" && Self.onScreen($0, "about") }
        Thread.sleep(forTimeInterval: 1.0)
        relaunch(qa, ["-shizi-qa-storage-unavailable"])
        qa.waitProbe("blocked: home underneath, block page on top", timeout: 30) { p in
            Self.reason(p) == "blocked" && Self.top(p) == "home" && Self.depth(p) == 0 && Self.screens(p).last == "block"
        }
        XCTAssertTrue(qa.el("native-block-title").waitForExistence(timeout: 5), "the native block page is on screen")
    }

    // MARK: 提醒深链

    /// 冷启动深链压过恢复：停在「关于」→ 点通知冷启动 → 不恢复（判定 deep-link），开 B 组写字页（T-quiet 安静淡入，没有来源元素）。
    func testReminderDeepLinkBeatsRestore() {
        let qa = start("about")
        qa.waitProbe("about") { Self.top($0) == "about" && Self.onScreen($0, "about") }
        Thread.sleep(forTimeInterval: 1.0)
        relaunch(qa, ["-shizi-reminder-target", "base:春"])
        qa.waitProbe("deep link opened the write page", timeout: 30) { p in
            Self.reason(p) == "deep-link" && Self.top(p) == "write" && Self.depth(p) == 1 && Self.shown(p, "native") && (p["navRunning"] as? Int) == 0
        }
        XCTAssertTrue(qa.transitions.contains("open via=quiet animate=true"), "T-quiet: \(qa.transitions)")
        XCTAssertTrue(qa.transitions.contains("nav:push write"), "the JS rule decided where to go: \(qa.transitions)")
    }

    /// 热启动深链（栈已建好、App 在前台）：首页上收到 → 开 B 组写字页，T-quiet。
    func testWarmReminderDeepLinkOpensTheWritePage() {
        let qa = start("home-fresh", extra: ["-shizi-qa-warm-reminder", "base:春"])
        qa.waitProbe("warm deep link opened the write page", timeout: 30) { p in
            Self.top(p) == "write" && Self.shown(p, "native") && (p["navRunning"] as? Int) == 0
        }
        XCTAssertTrue(qa.transitions.contains("open via=quiet animate=true"), "T-quiet: \(qa.transitions)")
    }

    /// 深链遇 B 组没写完：冷启动（B 组写字页开着时杀进程）→ 深链换字 → 弹 S02（接着写 / 结束这组开新的），不直接换组。
    func testDeepLinkWithUnfinishedBGroupShowsS02() {
        let qa = start("recall")
        qa.waitProbe("B group open") { Self.top($0) == "write" && Self.shown($0, "native") }
        Thread.sleep(forTimeInterval: 1.0)
        relaunch(qa, ["-shizi-reminder-target", "base:火"])
        qa.waitProbe("S02 over home (cold)", timeout: 30) { p in Self.reason(p) == "deep-link" && Self.screens(p).last == "s02" && (p["navRunning"] as? Int) == 0 }
        XCTAssertTrue(qa.el("native-s02-ready").waitForExistence(timeout: 5), "S02 shown")
    }

    /// 同上，热启动：B 组写字页开着时收到深链 → 弹 S02（盖在写字页上）。
    func testWarmDeepLinkWithUnfinishedBGroupShowsS02() {
        let qa = start("recall", extra: ["-shizi-qa-warm-reminder", "base:火"])
        qa.waitProbe("S02 over the write page (warm)", timeout: 30) { p in Self.screens(p).last == "s02" && (p["navRunning"] as? Int) == 0 }
        XCTAssertTrue(qa.el("native-s02-ready").waitForExistence(timeout: 5), "S02 shown")
    }
}
