import Foundation
import XCTest
@testable import ShiziCore

// B4.2 金标准（计划 §4.3 ①）：FSRS（每档评分 × 稳定度 × 难度 × 间隔 × fuzz 种子，三个时区）与选字 / 组成（随机状态 × 真 / 假题库 × policy 覆盖）。
// 夹具由 node scripts/core-golden/golden.mjs 用 JS 参考实现生成（domains/fsrs.mjs、domains/schedule.mjs）。

final class ScheduleGoldenTests: XCTestCase {
    func testFSRSGolden() throws {
        let n = try runOpGolden("fsrs")
        XCTAssertGreaterThan(n, 1500) // D83：reviewCard / applyJudgment / replay / applyAnswerSeen 退役（写错 = 明天再来、只看当天第一次）
    }

    func testScheduleGolden() throws {
        let n = try runOpGolden("schedule")
        XCTAssertGreaterThan(n, 30) // D83：配比 / 选字 / 开组的条目退役（d83RetiredGoldenOps），剩 FSRS 评级、到期、热身字、特别组、会话形状等
    }

    /// V8 的 Math.exp / Math.log（fdlibm，arm64 上带 FMA 收缩）与 JSMath 逐位相同的抽样；完整的 120 万组对照见 B4.2 实施记录。
    func testJSMathMatchesV8Samples() {
        // 值来自 node（V8，darwin-arm64）：Math.exp / Math.log 的位型
        let cases: [(String, Double, UInt64)] = [
            ("exp", 1.8722, 0x401A_02A5_FFFC_DC30),
            ("exp", -0.1542 * 0.0, 0x3FF0_0000_0000_0000),
            ("log", 0.9, 0xBFBA_F8E8_210A_415C),
        ]
        for (fn, x, bits) in cases {
            let got = fn == "exp" ? JSMath.exp(x) : JSMath.log(x)
            XCTAssertEqual(got.bitPattern, bits, "\(fn)(\(x))")
        }
    }

    func testToFixedRoundsHalfUpOnTheExactBinaryValue() {
        XCTAssertEqual(JSMath.toFixedNumber(1.0 / 512, 8), 0.00195313) // 0.001953125 正好在中点：取大
        XCTAssertEqual(JSMath.toFixedNumber(1.005, 2), 1.0) // 1.005 的二进制值略小于中点
        XCTAssertEqual(JSMath.toFixedNumber(-0.000000001, 8).sign, .minus)
        XCTAssertEqual(JSMath.toFixedNumber(48.731317764999, 8), 48.73131776)
    }
}
