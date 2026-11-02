import Foundation
import XCTest
@testable import ShiziCore

// test/core/spread.test.mjs 的转写（B4.2，2 条）：core/spread.js（D66 ⑨）到期日摊开的纯函数。
// 原用例里 spreadLegacyDue（src/store/migrate.js，v1 迁移）是 JS 存储层模块，Swift 里没有对应物，对应的断言「迁移用同一个函数」在注释处说明并略去。

private let TODAY = "2026-09-24"
private let rules = ScheduleRules(timeZone: TimeZone(identifier: "Asia/Shanghai")!)

private func e(_ due: String, _ stability: Double = 5, stoppedAt: Double? = nil) -> JSValue {
    var o = JSObject([("fsrs", JS.obj([("stability", .number(stability))])), ("due", .string(due)), ("lastJudgedAt", .number(0))])
    if let s = stoppedAt { o["stoppedAt"] = .number(s) }
    return .object(o)
}

private func rec(_ serial: Int, _ char: String, _ judgment: String, _ day: String) -> JSValue {
    let p = day.split(separator: "-").map { Int($0)! }
    let ms = JSDate.makeLocal(p[0], p[1] - 1, p[2], hours: 12, TimeZone(identifier: "Asia/Shanghai")!)! + Double(serial % 60) * 60_000
    return JS.obj([
        ("id", .string("r\(serial)")), ("cardKey", .string("base:" + char)), ("char", .string(char)), ("sessionId", .string("s1")), ("kind", .string("judged")),
        ("at", .number(ms)), ("localDay", .string(day)),
        ("help", JS.obj([("hints", .number(0)), ("answerSeen", .bool(false)), ("traced", .bool(false))])), ("judgment", .string(judgment)),
    ])
}

final class SpreadTests: XCTestCase {
    // test/core/spread.test.mjs: spreadDue: overdue first, then lower stability; at most perDay a day including what was already due there; never earlier; stopped / not-due untouched
    func testSpreadDueOverdueFirstThenLowerStabilityAtMostPerDayADayIncludingWhatWasAlreadyDueThereNeverEarlierStoppedNotDueUntouched() throws {
        let sched = JS.obj([
            ("base:\u{7532}", e("2026-09-01", 9)), ("base:\u{4E59}", e("2026-09-01", 2)), ("base:\u{4E19}", e("2026-09-10")), ("base:\u{4E01}", e(TODAY)),
            ("base:\u{620A}", e("2026-09-25")), ("base:\u{5DF1}", e("2026-08-01", stoppedAt: 1)),
        ])
        let (out, moved) = try rules.spreadDue(sched, today: TODAY, perDay: 2)
        XCTAssertEqual(out["base:\u{4E59}"]?["due"], .string(TODAY), "most overdue, least stable first")
        XCTAssertEqual(out["base:\u{7532}"]?["due"], .string(TODAY))
        XCTAssertEqual(out["base:\u{4E19}"]?["due"], .string("2026-09-25"), "09-25 already has \u{620A} \u{2192} one more slot")
        XCTAssertEqual(out["base:\u{4E01}"]?["due"], .string("2026-09-26"))
        XCTAssertEqual(out["base:\u{620A}"]?["due"], .string("2026-09-25"), "not due: untouched")
        XCTAssertEqual(out["base:\u{5DF1}"]?["due"], .string("2026-08-01"), "stopped: untouched")
        XCTAssertEqual(moved, 4)
        XCTAssertEqual(sched["base:\u{4E59}"]?["due"], .string("2026-09-01"), "input not mutated")
        // 原用例：spreadLegacyDue（src/store/migrate.js）与 spreadDue 同一结果——迁移层是 JS 存储模块，这里不转写。
        XCTAssertEqual(try rules.spreadDue(sched, today: TODAY, perDay: 10).moved, 0, "few enough \u{2192} nothing moves")
    }

}
