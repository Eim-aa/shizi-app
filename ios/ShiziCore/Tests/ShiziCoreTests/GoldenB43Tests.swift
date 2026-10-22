import Foundation
import XCTest
@testable import ShiziCore

// B4.3 金标准（计划 §4.3 ①）：夹具由 node scripts/core-golden/golden.mjs 用 JS 参考实现生成（records / query / cards / members / ink），这里逐条比对
// （值相等 + 序列化逐字节相同；依赖时区的 op 另在 New_York / Lord_Howe 各出一组）。

final class GoldenB43Tests: XCTestCase {
    func testRecordsGolden() throws {
        XCTAssertGreaterThan(try runOpGolden("records"), 700)
    }

    func testQueryGolden() throws {
        XCTAssertGreaterThan(try runOpGolden("query"), 400)
    }

    func testCardsGolden() throws {
        XCTAssertGreaterThan(try runOpGolden("cards"), 1900)
    }

    func testMembersGolden() throws {
        XCTAssertGreaterThan(try runOpGolden("members"), 1000)
    }

    func testInkGolden() throws {
        XCTAssertGreaterThan(try runOpGolden("ink"), 800)
    }
}
