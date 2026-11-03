import Foundation
import XCTest
@testable import ShiziCore

// test/core/group-size.test.mjs 的转写（B4.2，4 条）：每组字数（D65 #2，P03 / P314）：core/group-size.js + 配比按组大小换算（core/mix.js scaledCount）+ settings / 备份。

private let TODAY = "2026-09-24"
private let rules = ScheduleRules(timeZone: TimeZone(identifier: "Asia/Shanghai")!)
private let mix = Config.policy["groupMix"]

private func K(_ s: String) -> [String] { s.map { "base:" + String($0) } }

private func sched(_ due: String, _ stability: Double = 5) -> JSValue {
    JS.obj([("fsrs", JS.obj([("stability", .number(stability))])), ("due", .string(due)), ("lastJudgedAt", .number(0))])
}

/// test/core/helpers.mjs rec()（judged 记录）。
private func rec(_ serial: Int, _ char: String, _ judgment: String, _ day: String) -> JSValue {
    let p = day.split(separator: "-").map { Int($0)! }
    let ms = JSDate.makeLocal(p[0], p[1] - 1, p[2], hours: 12, TimeZone(identifier: "Asia/Shanghai")!)! + Double(serial % 60) * 60_000
    return JS.obj([
        ("id", .string("r\(serial)")), ("cardKey", .string("base:" + char)), ("char", .string(char)), ("sessionId", .string("s1")), ("kind", .string("judged")),
        ("at", .number(ms)), ("localDay", .string(day)),
        ("help", JS.obj([("hints", .number(0)), ("answerSeen", .bool(false)), ("traced", .bool(false))])), ("judgment", .string(judgment)),
    ])
}


final class GroupSizeTests: XCTestCase {
    // test/core/group-size.test.mjs: groupSizeOf: 5 / 10 / 20 / 30 kept, anything else (missing, old users, junk) → 20
    // （D83 起选项是 5 / 10 / 15 / 20 / 30、缺省 15）
    func testGroupSizeOf5102030KeptAnythingElseMissingOldUsersJunk20() {
        for n in [5.0, 10, 15, 20, 30] { XCTAssertEqual(GroupSize.of(JS.obj([("groupSize", .number(n))])), .number(n)) }
        let junk: [JSValue?] = [.null, nil, J("{}"), J(#"{"groupSize":7}"#), J(#"{"groupSize":"20"}"#), J(#"{"groupSize":0}"#)]
        for s in junk { XCTAssertEqual(GroupSize.of(s), .number(15), "\(String(describing: s))") }
        XCTAssertTrue(GroupSize.isOption(.number(10)))
        XCTAssertTrue(GroupSize.isOption(.number(15)))
        XCTAssertFalse(GroupSize.isOption(.number(25)))
        XCTAssertEqual(GroupSize.valid(.null), Config.policy["groupSize"])
    }

    // test/core/group-size.test.mjs: scaledCount: counts written for groups of 5 scale with size (round, at least 1); the daily review cap follows
    func testScaledCountCountsWrittenForGroupsOf5ScaleWithSizeRoundAtLeast1TheDailyReviewCapFollows() throws {
        let sizes: [Double] = [5, 10, 20, 30]
        let newMax = try XCTUnwrap(mix?["newMax"]?.numberValue)
        let returnGroupSize = try XCTUnwrap(mix?["returnGroupSize"]?.numberValue)
        XCTAssertEqual(sizes.map { Mix.scaledCount(newMax, $0, mix: mix) }, [3, 6, 12, 18])
        XCTAssertEqual(sizes.map { Mix.scaledCount(1, $0, mix: mix) }, [1, 2, 4, 6])
        XCTAssertEqual(sizes.map { Mix.scaledCount(returnGroupSize, $0, mix: mix) }, [3, 6, 12, 18])
        XCTAssertEqual(Mix.scaledCount(0, 20, mix: mix), 0) // D83：每日复习上限删除（GroupSize.dailyReviewCapOf 退役）
    }

    // test/core/group-size.test.mjs: settings.groupSize: schema accepts the four options only; it rides along in backups
    // （buildBackupV2 是 B4.3 的备份模块、JS 里才有；这里按 JS 备份文件的形状手工构造 settings 域的条目，再用 Swift 的 parseBackupV2 校验——
    //   「设置里的 groupSize 随备份走」的整包导出部分只能在 B4.3 转写 backup.test 时覆盖。）
    func testSettingsGroupSizeSchemaAcceptsTheFourOptionsOnlyItRidesAlongInBackups() throws {
        let key = try XCTUnwrap(Schema.keyNamed("settings"))
        for n in [5.0, 10, 15, 20, 30] { XCTAssertNil(Schema.validateValue(key: key, value: JS.obj([("groupSize", .number(n))])), "\(n)") }
        for bad in [JSValue.number(7), .string("20"), .null] {
            XCTAssertNotNil(Schema.validateValue(key: key, value: JS.obj([("groupSize", bad)])), "\(bad)")
        }
        XCTAssertEqual(Config.policy["groupSizeOptions"], J("[5,10,15,20,30]"), "schema list and policy list agree")
        let settings = JS.obj([("groupSize", .number(10)), ("library", .string("core3500"))])
        // buildBackupV2 补的 meta 条目：{schema, serial, createdAt, months}
        let meta = JS.obj([("schema", .number(Double(Schema.schemaVersion))), ("serial", .number(0)), ("createdAt", .number(1_790_251_200_000)), ("months", .array([]))])
        let file = JS.obj([("app", .string("shizi")), ("version", .number(2)), ("date", .string("2026-09-24T12:00:00.000Z")),
                           ("data", JS.obj([(Schema.metaKey, .string(str(meta))), (key, .string(str(settings)))]))])
        let parsed = Schema.parseBackupV2(J(str(file)))
        XCTAssertEqual(parsed["ok"], .bool(true), str(parsed))
        let stored = try XCTUnwrap(file["data"]?[key]?.stringValue)
        XCTAssertEqual(J(stored)["groupSize"], .number(10))
    }
}
