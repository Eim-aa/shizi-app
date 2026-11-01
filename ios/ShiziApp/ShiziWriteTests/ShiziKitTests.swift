import UIKit
import WebKit
import XCTest
@testable import Shizi

// B3.1 ShiziKit：构建期生成的令牌 / 文案 / 动效（ShiziKitTokens.json、ShiziKitCopy.json）与页面此刻现算的回包逐项相同。
// 页面是真的（App 作测试宿主、WKWebView 里的 tokens.css / policy / motion.js / copy）：每个系统字号档位（xS … AX5）× 浅 / 深都让页面算一遍
// 写字页令牌包（native-session.js typeBundle / colorBundle / themeOf——原来 open 回包里的同一组函数；B4.9a 起 open 由 Swift 答，这里直接问页面），
// 再与 ShiziLook.resolve 换上的生成值比（字阶是 WebKit 量出来的 1/64 截断值，生成器照同一规则取）。
// 生成物与来源（tokens.css / policy / motion.js / copy）不同步由 node 侧 test/ios-shizikit.test.mjs 守；这里守「生成规则 = 页面算法」。

@MainActor
final class ShiziKitTests: XCTestCase {
    private var web: WebViewController!
    private var bridge: NativeWriteBridge!

    override func setUp() async throws {
        try await super.setUp()
        let root = UIApplication.shared.delegate?.window??.rootViewController
        web = try XCTUnwrap(root as? WebViewController, "root is the web shell")
        try await waitUntil("page ready") { self.web.pageReady }
        try await waitUntil("session api") { (try? await self.js("return typeof window.shiziNativeWrite === 'function';")) as? Bool == true }
        bridge = NativeWriteBridge(webView: web.webView)
    }

    override func tearDown() async throws {
        _ = try? await js("document.documentElement.removeAttribute('data-theme'); window.shiziContentSize({category:'L', scale:1}); return true;")
        try await super.tearDown()
    }

    @discardableResult
    private func js(_ body: String) async throws -> Any? {
        try await web.webView.callAsyncJavaScript(body, arguments: [:], in: nil, contentWorld: .page)
    }

    private func call(_ op: String, _ args: [String: Any]) async -> NativeWriteReply {
        await withCheckedContinuation { cont in bridge.call(op, args) { cont.resume(returning: $0) } }
    }

    private func waitUntil(_ what: String, timeout: TimeInterval = 15, _ cond: @escaping () async -> Bool) async throws {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if await cond() { return }
            try await Task.sleep(nanoseconds: 30_000_000)
        }
        XCTFail("timed out waiting for \(what)")
        throw CancellationError()
    }

    private static let categories: [(UIContentSizeCategory, String)] = [
        (.extraSmall, "xS"), (.small, "S"), (.medium, "M"), (.large, "L"), (.extraLarge, "XL"), (.extraExtraLarge, "XXL"), (.extraExtraExtraLarge, "XXXL"),
        (.accessibilityMedium, "AX1"), (.accessibilityLarge, "AX2"), (.accessibilityExtraLarge, "AX3"), (.accessibilityExtraExtraLarge, "AX4"),
        (.accessibilityExtraExtraExtraLarge, "AX5"),
    ]

    /// 页面的写字页令牌包（native-session.js 的同名函数：WebKit 按 tokens.css 现算）。
    private func pageBundle(_ fn: String) async throws -> Any? {
        try await js("const m = await import('/src/ui/screens/write/native-session.js'); return m.\(fn)();")
    }

    /// 页面在某个字号档位下算出来的字阶（typeBundle 的数值键 = 原来 open 回包 type 的数值键）。
    private func pageType(_ name: String) async throws -> [String: Double] {
        _ = try await js("window.shiziContentSize({category:'\(name)', scale:1}); return true;")
        let type = try await pageBundle("typeBundle") as? [String: Any] ?? [:]
        return type.compactMapValues { ($0 as? NSNumber)?.doubleValue }.filter { $0.key != "ax" }
    }

    /// 字阶：12 个档位，页面 typeBundle 的每个键 = 生成表同档位的值（含 XXXL 等非整数档的 1/64 截断）。
    func testTypeScaleMatchesThePageAtEveryContentSize() async throws {
        for (category, name) in Self.categories {
            XCTAssertEqual(ShiziTokens.categoryName(category), name)
            let page = try await pageType(name)
            XCTAssertGreaterThanOrEqual(page.count, 12, "\(name): page type bundle")
            let gen = try XCTUnwrap(ShiziTokens.lengths(category), "\(name): generated row")
            for (k, v) in page {
                XCTAssertEqual(Double(gen[k] ?? -1), v, accuracy: 1e-9, "\(name) \(k)")
            }
        }
    }

    /// 颜色：浅 / 深两套，页面令牌的计算值（原文）= 生成值；回包 theme 跟着页面主题走。
    func testColorsAndThemeMatchThePage() async throws {
        for theme in [ShiziTokens.Theme.light, .dark] {
            _ = try await js("document.documentElement.setAttribute('data-theme', '\(theme.rawValue)'); return true;")
            let pageTheme = try await pageBundle("themeOf") as? String
            XCTAssertEqual(pageTheme, theme.rawValue)
            let colorsRaw = try await pageBundle("colorBundle")
            let colors = try XCTUnwrap(colorsRaw as? [String: String])
            XCTAssertGreaterThanOrEqual(colors.count, 20)
            let gen = ShiziTokens.colorStrings(theme)
            for (k, v) in colors { XCTAssertEqual(gen[k], v, "\(theme.rawValue) \(k)") }
            // 生成值换上去以后颜色来自生成表、主题按回包
            let look = ShiziLook.resolve(["colors": colors, "theme": pageTheme ?? ""], page: .write)
            XCTAssertEqual(look["colors"] as? [String: String], gen)
        }
    }

    /// 文案、动效、时刻：写字页 open 与结果页 resultLook 的回包 = 生成值（copy 是这一页的键；动效与时刻整份相同），ShiziLook 核对不报不一致。
    func testCopyMotionAndTimingMatchThePage() async throws {
        let before = ShiziLook.mismatches.count
        for (op, page) in [("open", ShiziLook.Page.write), ("resultLook", .result)] {
            let r = await call(op, op == "open" ? ["slot": "A"] : [:])
            XCTAssertTrue(r.ok, op)
            let copy = try XCTUnwrap(r.body["copy"] as? [String: String], op)
            XCTAssertGreaterThan(copy.count, 20)
            for (k, v) in copy { XCTAssertEqual(ShiziCopy.strings[k], v, "\(op) copy \(k)") }
            XCTAssertTrue(NSDictionary(dictionary: r.body["motion"] as? [String: Any] ?? [:]).isEqual(to: ShiziTokens.pageMotion(page)), "\(op) motion")
            XCTAssertTrue(NSDictionary(dictionary: r.body["timing"] as? [String: Any] ?? [:]).isEqual(to: ShiziTokens.pageTiming(page)), "\(op) timing")
            _ = ShiziLook.resolve(r.body, page: page)
        }
        XCTAssertEqual(Array(ShiziLook.mismatches.dropFirst(before)), [])
    }

    /// 文案的占位符填充与页面 format() 同一规则（缺值原样保留）。
    func testCopyFillsPlaceholdersLikeThePage() {
        let key = "R-W01.progress"
        let raw = ShiziCopy.strings[key] ?? ""
        XCTAssertTrue(raw.contains("{"), "progress has placeholders")
        let filled = ShiziCopy.t(key, ["n": 2, "total": 5])
        XCTAssertFalse(filled.contains("{n}"))
        XCTAssertEqual(ShiziCopy.t("no.such.key"), "")
    }
}
