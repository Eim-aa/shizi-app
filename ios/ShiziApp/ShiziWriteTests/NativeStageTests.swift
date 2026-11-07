import MachO
import ShiziCore
import UIKit
import XCTest
@testable import Shizi

// B3.2 NativeStage / ShiziEngine / 通用原生屏（scheme ShiziWriteTests：App 作测试宿主，SHIZI_NATIVE_WRITE=1、SHIZI_TEST_HOST=1）。
// 纯逻辑：屏名 ⇄ 类约定、文案引用与 Codable 回包、许可全文的折行；
// 宿主：真 App 里引擎推入「关于」→ 宿主消息 open → NativeStage 盖上原生页（视图回包首帧就在）→ App API 经 SwiftEngine 调用 → 原生返回 → 出栈。

@MainActor
final class NativeStageTests: XCTestCase {
    private var host: TestHost!
    private var root: RootViewController { host.root }

    override func setUp() async throws {
        try await super.setUp()
        host = try TestHost()
        try await waitUntil("engine ready") { self.host.ready }
        if let top = root.nativeWriteTop {
            top.exitHandled = true
            top.dismiss(animated: false)
        }
        await root.stage.resetScreensForTesting()
        host.switchTab("mine")
        try await waitUntil("no native page") { self.root.presentedViewController == nil && self.root.stage.screens.isEmpty }
    }

    private func waitUntil(_ what: String, timeout: TimeInterval = 15, _ cond: @escaping () async -> Bool) async throws {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if await cond() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("timed out waiting for \(what)")
        throw CancellationError()
    }

    private func routeTop() async throws -> String? { host.top }

    // MARK: 纯逻辑

    func testB32_screenNamesFindClassesByConvention() {
        XCTAssertTrue(ShiziScreenRegistry.screenClass("about") == AboutScreen.self)
        XCTAssertTrue(ShiziScreenRegistry.screenClass("about-privacy") == AboutPrivacyScreen.self)
        XCTAssertNil(ShiziScreenRegistry.screenClass("_demo/sub"), "not native → no class") // 只有网页参考的开发演示屏
        XCTAssertTrue(ShiziScreenRegistry.screenClass("records") == RecordsScreen.self)
        XCTAssertEqual(ShiziScreenRegistry.className("about-credits"), "ShiziScreen_about_credits")
        // 页面卡陆续加类（B3.5a 起 home …）：清单含关于四页、有序
        let screens = ShiziScreenRegistry.screens
        XCTAssertTrue(Set(["about", "about-credits", "about-letter", "about-privacy"]).isSubset(of: Set(screens)), "\(screens)")
        XCTAssertEqual(screens, screens.sorted())
    }

    func testB32_copyRefsAndCodableReplies() throws {
        struct V: Decodable { let title: ShiziCopyRef; let version: ShiziCopyRef }
        let body: [String: Any] = ["ok": true, "view": [
            "title": ["copy": "X-ABOUT.title"],
            "version": ["copy": "X-ABOUT.version", "params": ["version": "1.0.0", "day": "20261001"]],
        ]]
        let v = try ShiziDecode.reply(body, as: ShiziViewReply<V>.self).view
        XCTAssertEqual(v.title.text, ShiziCopy.t("X-ABOUT.title"))
        XCTAssertEqual(v.version.text, ShiziCopy.t("X-ABOUT.version", ["version": "1.0.0", "day": "20261001"]))
        XCTAssertFalse(v.version.text.contains("{"), "params filled")
        XCTAssertThrowsError(try ShiziDecode.reply(["ok": false, "error": ["kind": "blocked"]], as: ShiziViewReply<V>.self)) { e in
            XCTAssertEqual(e as? ShiziEngineError, .failed("blocked"))
        }
        // 嵌套引用（参数本身是引用）与多行文案
        let nested = try ShiziDecode.value(["copy": "X-ABOUT.versionAria", "params": ["version": ["copy": "X-ABOUT.appName"], "day": 1]], as: ShiziCopyRef.self)
        XCTAssertTrue(nested.text.contains(ShiziCopy.t("X-ABOUT.appName")))
        XCTAssertEqual(ShiziCopyRef(copy: "X-ABOUT.motto").lines.count, 2)
    }

    /// 非有限数 / 非 JSON 值：ShiziDecode.value 抛可接的 decode 错误，不把它交给 JSONSerialization（那里抛 ObjC 异常，进程直接崩）。
    func testDecodeRejectsNonFiniteNumbersInsteadOfCrashing() {
        struct P: Decodable { let x: Double; let y: Double; let w: Double? }
        for bad in [Double.nan, .infinity, -.infinity] {
            let ink: [String: Any] = ["r1": [[["x": 1.0, "y": 2.0, "w": NSNumber(value: bad)]]]]
            XCTAssertFalse(JSONSerialization.isValidJSONObject(ink))
            XCTAssertThrowsError(try ShiziDecode.value(ink, as: [String: [[P]]].self)) { e in
                guard case .decode? = e as? ShiziEngineError else { return XCTFail("\(e)") }
            }
        }
        XCTAssertThrowsError(try ShiziDecode.value(["at": Date()], as: [String: Double].self))
        // 合法的照旧（w 缺省 → nil）
        let ok = try? ShiziDecode.value(["r1": [[["x": 1.0, "y": 2.0, "w": 3.5], ["x": 4, "y": 5]]]], as: [String: [[P]]].self)
        XCTAssertEqual(ok?["r1"]?.first?.map(\.w), [3.5, nil])
    }

    func testB32_licenseTextWrapsWhereWebKitDoes() {
        // 「/」后不折、空格后与字母数字间的连字符后可折、一个词比一行长时任意处折
        XCTAssertEqual(ShiziMonoWrap.wrap("aaaa chanind/hanzi-writer", perLine: 12), "aaaa \nchanind/hanz\ni-writer")
        XCTAssertEqual(ShiziMonoWrap.wrap("hanzi-writer-LICENSE.txt", perLine: 14), "hanzi-writer-\nLICENSE.txt")
        XCTAssertEqual(ShiziMonoWrap.wrap("one\n\ntwo", perLine: 10), "one\n\ntwo")
    }

    /// B4.9：引擎是 SwiftEngine，冷启动判定之后 ready；没有引擎的通道回 unavailable（不崩）。
    func testB49_engineIsSwiftAndReady() async throws {
        XCTAssertEqual(root.stage.engine.status, .ready)
        let saved = EngineRoute.swift
        EngineRoute.swift = nil
        defer { EngineRoute.swift = saved }
        var body: [String: Any] = [:]
        EngineRoute.evaluate(function: EngineOps.app, op: "view.about", args: [:]) { b, _ in body = b }
        XCTAssertEqual((body["error"] as? [String: Any])?["kind"] as? String, "unavailable")
    }

    // MARK: 宿主

    func testB32_aboutHostOpensTheNativePageAndBackPopsTheEntry() async throws {
        host.push("about")
        try await waitUntil("native about") { self.root.stage.topScreen is AboutScreen && NativeWriteTransitions.running == 0 }
        let about = try XCTUnwrap(root.stage.topScreen as? AboutScreen)
        XCTAssertNotNil(about.lastView, "the view came with the open message (first frame does not wait for the bridge)")
        XCTAssertEqual(about.rowButtons.count, 3)
        // App API 经 SwiftEngine（同一个视图 op）
        let v = try await root.stage.engine.view("about", as: AboutScreen.View.self)
        XCTAssertEqual(v.rows.map(\.to), ["about-privacy", "about-credits", "about-letter"])
        // 原生里点按 → nav.push → 宿主挂载回发 open → 原生栈两层
        // 新状态后 pressGuard（0.4s）内按钮不响应：viewDidAppear 在重载的机器上可能比固定 sleep 晚到，
        // 被防误点吞掉的按下隔 0.6s 再按一次（防误点本身是产品行为、断言不变）。
        try await Task.sleep(nanoseconds: 500_000_000)
        var lastTap = Date.distantPast
        try await waitUntil("native privacy") {
            if self.root.stage.screens.count < 2, Date().timeIntervalSince(lastTap) > 0.6 {
                lastTap = Date()
                about.rowButtons[0].sendActions(for: .touchUpInside)
            }
            return self.root.stage.screens.map(\.screen) == ["about", "about-privacy"] && NativeWriteTransitions.running == 0
        }
        let top = try await routeTop()
        XCTAssertEqual(top, "about-privacy")
        // 返回：原生收起 → 出栈
        root.stage.topScreen?.requestBack()
        try await waitUntil("back to about") { self.root.stage.screens.map(\.screen) == ["about"] }
        try await waitUntil("popped") { (try? await self.routeTop()) == "about" }
        // 宿主被别处卸掉（切 tab）：原生页收起、不发 nav.back（栈只因切 tab 改变）
        host.switchTab("home")
        try await waitUntil("released") { self.root.stage.screens.isEmpty && self.root.presentedViewController == nil }
        XCTAssertEqual(host.tab, "home")
    }

    func testB32_changedPushReachesTheEngineAfterACommit() async throws {
        let stream = root.stage.engine.changes
        let got = Task { () -> ShiziChangeSet? in for await s in stream { if s.domains.contains("settings") { return s } }; return nil }
        try await Task.sleep(nanoseconds: 100_000_000)
        let r = await root.stage.engine.raw("mine.appearance", ["value": "auto"])
        XCTAssertEqual(r["ok"] as? Bool, true, "\(r)")
        let timeout = Task { try await Task.sleep(nanoseconds: 5_000_000_000); got.cancel() }
        let set = await got.value
        timeout.cancel()
        XCTAssertTrue(set?.domains.contains("settings") == true, "settings commit → changed {domains:[settings]}")
        XCTAssertEqual(root.stage.engine.status, .ready)
    }

    // MARK: B4.9 App 里没有 WebKit

    /// B4.9（取代 B4.9a 的零调用检查）：进程里没有载入 WebKit、包里没有网页壳；同一条路线（冷启动 → 首页开组写一组（全部跳过）→ 结果页 → 离开回首页 →
    /// 字库 → 我的 → 提醒深链开组）照样走通。可执行文件不链接 WebKit 另由 verify-bundle-assets.sh（otool -L）核对。
    func testB49_noWebKitAndTheMainJourneyStillWorks() async throws {
        var images: [String] = []
        for i in 0..<_dyld_image_count() { if let n = _dyld_get_image_name(i) { images.append(String(cString: n)) } }
        XCTAssertFalse(images.contains { $0.hasSuffix("/WebKit.framework/WebKit") }, "WebKit is not loaded into the app")
        XCTAssertNil(Bundle.main.url(forResource: "Web/src", withExtension: nil), "no JS in the bundle")
        XCTAssertNil(Bundle.main.url(forResource: "Web/index", withExtension: "html"), "no web shell in the bundle")
        XCTAssertNotNil(SoundPlayer.directory, "sounds are a native resource")
        host.reset()
        let names = { self.root.stage.entries.map { $0.n ?? "" } }
        // 1. 冷启动判定（route.plan → 无转场重建）
        var planned = false
        root.stage.replanForTesting { planned = true }
        try await waitUntil("planned") { planned }
        root.stage.switchTab("home")
        try await waitUntil("home root") { names() == ["home"] }
        // 2. 首页主按钮开组 → 原生写字页
        let start = await root.stage.engine.raw("home.start", [:])
        XCTAssertEqual(start["ok"] as? Bool, true, "\(start)")
        try await waitUntil("native write page") { self.root.nativeWriteTop != nil && self.root.presentedViewController?.isBeingPresented == false }
        XCTAssertEqual(names(), ["home", "write"])
        // 3. 全部跳过 → 写字页换成结果页
        let vc = try XCTUnwrap(root.nativeWriteTop)
        var n = 0
        while root.nativeWriteTop != nil, n < 40 {
            n += 1
            let key = vc.cardKey
            vc.perform(Selector(("tapSkip")))
            try await waitUntil("next or result") { self.root.nativeWriteTop == nil || vc.cardKey != key }
        }
        try await waitUntil("native result page") { names() == ["home", "result"] && self.root.nativeResultTop != nil }
        // 4. 结果页离开 → 回首页（leaveTo：来源是 tab 根且就在下面 → nav.back）
        let rv = try XCTUnwrap(root.nativeResultTop)
        var left: Bool?
        WriteSessionChannel().call("resultExit", ["slot": rv.slot, "sessionId": rv.sessionId, "to": "leave"]) { left = $0.ok }
        try await waitUntil("left") { left != nil }
        XCTAssertEqual(left, true)
        try await waitUntil("back home") { names() == ["home"] && self.root.nativeResultTop == nil }
        // 5. 字库、我的
        root.stage.switchTab("library")
        try await waitUntil("library") { names() == ["library"] }
        root.stage.switchTab("mine")
        try await waitUntil("mine") { names() == ["mine"] }
        // 6. 提醒深链：开「这次选的字」（B）
        root.openReminderTarget(cardKey: "base:永")
        try await waitUntil("reminder target opened") { ["write", "s02"].contains(names().last ?? "") }
        try await Task.sleep(nanoseconds: 500_000_000)
        // 收尾：回到「我的」根
        if let top = root.nativeWriteTop { top.exitHandled = true; top.dismiss(animated: false) }
        root.stage.switchTab("mine")
    }
}

