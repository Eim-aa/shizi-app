import Foundation
import XCTest
@testable import ShiziCore

// B4.9a 金标准：导航层（ShiziCore Navigation/）↔ JS 参考（route-memory.js / engine.js / paper-transition.js / native-session.js 的导航那一半）。
// 夹具当年由 JS 参考实现生成（D84 起冻结，生成脚本已删）：冷启动判定、RESTORE_GUARDS、重载截短、提示键编解码，
// 以及导航镜像 + 宿主消息 + 来源记账 + 「去哪」规则的整串场景（三个时区）。

final class GoldenNavTests: XCTestCase {
    func testNavGolden() throws {
        XCTAssertGreaterThan(try runOpGolden("nav"), 400)
    }

    /// 屏名表与 JS 的登记同一份（node 侧 test/core/nav-screens.test.mjs 核对 src 的 registerScreen）。
    func testNavScreensTable() {
        let s = NavScreens.app()
        XCTAssertEqual(s.tab("home"), true)
        XCTAssertEqual(s.tab("write"), false)
        XCTAssertNil(s.tab("glyph-demo"))
        XCTAssertEqual(NavScreens.app(testHost: true).tab("glyph-demo"), false)
        XCTAssertNil(s.tab("hasOwnProperty"))
    }
}
