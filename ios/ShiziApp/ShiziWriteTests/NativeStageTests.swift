import UIKit
import WebKit
import XCTest
@testable import Shizi

// B3.2 NativeStage / ShiziEngine / 通用原生屏（scheme ShiziWriteTests：App 作测试宿主，SHIZI_NATIVE_WRITE=1、SHIZI_TEST_HOST=1）。
// 纯逻辑：屏名 ⇄ 类约定、文案引用与 Codable 回包、许可全文的折行、引擎状态与 changed 订阅；
// 宿主：真 App 里网页路由推入「关于」→ 宿主发 open → NativeStage 盖上原生页（视图回包首帧就在）→ App API 经 WebEngine 调用 → 原生返回 → 网页出栈。

@MainActor
final class NativeStageTests: XCTestCase {
    private var web: WebViewController!

    override func setUp() async throws {
        try await super.setUp()
        let root = UIApplication.shared.delegate?.window??.rootViewController
        web = try XCTUnwrap(root as? WebViewController, "root is the web shell")
        try await waitUntil("page ready") { self.web.pageReady }
        try await waitUntil("app api") { (try? await self.js("return typeof window.shiziNative === 'function' && !!window.__shiziTest;")) as? Bool == true }
        if let top = web.nativeWriteTop {
            top.exitHandled = true
            top.dismiss(animated: false)
        }
        await web.stage.resetScreensForTesting()
        _ = try await js("(await import('/src/ui/router.js')).nav.switchTab('mine'); return true;")
        try await waitUntil("no native page") { self.web.presentedViewController == nil && self.web.stage.screens.isEmpty }
    }

    @discardableResult
    private func js(_ body: String) async throws -> Any? {
        try await web.webView.callAsyncJavaScript(body, arguments: [:], in: nil, contentWorld: .page)
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

    private func routeTop() async throws -> String? {
        try await js("return (await import('/src/ui/router.js')).getRouter().getState().top.n;") as? String
    }

    // MARK: 纯逻辑

    func testB32_screenNamesFindClassesByConvention() {
        XCTAssertTrue(ShiziScreenRegistry.screenClass("about") == AboutScreen.self)
        XCTAssertTrue(ShiziScreenRegistry.screenClass("about-privacy") == AboutPrivacyScreen.self)
        XCTAssertNil(ShiziScreenRegistry.screenClass("library-all"), "not native yet → no class → the web keeps the page")
        XCTAssertEqual(ShiziScreenRegistry.className("about-credits"), "ShiziScreen_about_credits")
        // 页面卡陆续加原生屏：只核对已有的这几个都在（清单 = 按名字排好的全部原生屏），不写死整份清单
        XCTAssertTrue(Set(ShiziScreenRegistry.screens).isSuperset(of: ["about", "about-credits", "about-letter", "about-privacy", "mine"]))
        XCTAssertEqual(ShiziScreenRegistry.screens, ShiziScreenRegistry.screens.sorted())
        XCTAssertTrue(ShiziScreenRegistry.screenClass("mine") == MineScreen.self)
        let list = (try? JSONSerialization.data(withJSONObject: ShiziScreenRegistry.screens)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        XCTAssertTrue(NativeStage.userScript().contains("window.__shiziNativeScreens = \(list)"))
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

    func testB32_licenseTextWrapsWhereWebKitDoes() {
        // 「/」后不折、空格后与字母数字间的连字符后可折、一个词比一行长时任意处折
        XCTAssertEqual(ShiziMonoWrap.wrap("aaaa chanind/hanzi-writer", perLine: 12), "aaaa \nchanind/hanz\ni-writer")
        XCTAssertEqual(ShiziMonoWrap.wrap("hanzi-writer-LICENSE.txt", perLine: 14), "hanzi-writer-\nLICENSE.txt")
        XCTAssertEqual(ShiziMonoWrap.wrap("one\n\ntwo", perLine: 10), "one\n\ntwo")
    }

    func testB32_engineStatusAndChanges() async throws {
        let e = WebEngine(webView: nil)
        XCTAssertEqual(e.status, .reloading)
        var seen: [ShiziEngineStatus] = []
        e.observeStatus { seen.append($0) }
        e.pageDidBecomeReady()
        e.receiveStatus(["status": "blocked", "reason": "unavailable"])
        e.pageDidBecomeReady() // 页面推过 blocked：就绪不改成 ready
        e.receiveStatus(["status": "ready"])
        XCTAssertEqual(seen, [.ready, .blocked("unavailable"), .ready])
        let stream = e.changes
        let got = Task { () -> ShiziChangeSet? in for await s in stream { return s }; return nil }
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertNil(e.receiveChanged(["domains": []]), "no dirty domain → no push")
        _ = e.receiveChanged(["domains": ["records", "settings"], "label": "judge"])
        let set = await got.value
        XCTAssertEqual(set, ShiziChangeSet(domains: ["records", "settings"], label: "judge"))
        XCTAssertTrue(set?.touches(["settings"]) == true)
        let reply = await e.raw("view.about", [:])
        XCTAssertEqual((reply["error"] as? [String: Any])?["kind"] as? String, "transport", "no web view → transport failure, not a crash")
    }

    // MARK: 宿主

    func testB32_aboutHostOpensTheNativePageAndBackPopsTheWebEntry() async throws {
        _ = try await js("(await import('/src/ui/router.js')).nav.push('about'); return true;")
        try await waitUntil("native about") { self.web.stage.topScreen is AboutScreen && NativeWriteTransitions.running == 0 }
        let about = try XCTUnwrap(web.stage.topScreen as? AboutScreen)
        XCTAssertNotNil(about.lastView, "the view came with the open message (first frame does not wait for the bridge)")
        XCTAssertEqual(about.rowButtons.count, 3)
        // App API 经 WebEngine（同一个视图 op）
        let v = try await web.stage.engine.view("about", as: AboutScreen.View.self)
        XCTAssertEqual(v.rows.map(\.to), ["about-privacy", "about-credits", "about-letter"])
        // 原生里点按 → nav.push → 宿主挂载回发 open → 原生栈两层
        try await Task.sleep(nanoseconds: 500_000_000)
        about.rowButtons[0].sendActions(for: .touchUpInside)
        try await waitUntil("native privacy") { self.web.stage.screens.map(\.screen) == ["about", "about-privacy"] && NativeWriteTransitions.running == 0 }
        let top = try await routeTop()
        XCTAssertEqual(top, "about-privacy")
        // 返回：原生收起 → nav.back {via:'native'} → 网页出栈
        web.stage.topScreen?.requestBack()
        try await waitUntil("back to about") { self.web.stage.screens.map(\.screen) == ["about"] }
        try await waitUntil("web popped") { (try? await self.routeTop()) == "about" }
        // 宿主被别处卸掉（切 tab）：原生页收起、不发 nav.back（网页栈只因切 tab 改变）
        _ = try await js("(await import('/src/ui/router.js')).nav.switchTab('home'); return true;")
        try await waitUntil("released") { self.web.stage.screens.isEmpty && self.web.presentedViewController == nil }
        let tab = try await js("return (await import('/src/ui/router.js')).getRouter().getState().tab;") as? String
        XCTAssertEqual(tab, "home")
    }

    func testB32_changedPushReachesTheEngineAfterACommit() async throws {
        let stream = web.stage.engine.changes
        let got = Task { () -> ShiziChangeSet? in for await s in stream { if s.domains.contains("settings") { return s } }; return nil }
        try await Task.sleep(nanoseconds: 100_000_000)
        _ = try await js("const { getStore } = await import('/src/store/store.js'); const p = await import('/src/ui/screens/mine/prefs.js'); return p.commitAppearance(getStore(), 'auto').ok;")
        let timeout = Task { try await Task.sleep(nanoseconds: 5_000_000_000); got.cancel() }
        let set = await got.value
        timeout.cancel()
        XCTAssertTrue(set?.domains.contains("settings") == true, "settings commit → changed {domains:[settings]}")
        XCTAssertEqual(web.stage.engine.status, .ready)
    }
}
