import Foundation
import XCTest
@testable import ShiziCore

// test/core/compliance-removal.test.mjs 的转写（B4.2）：只转写其中「旧记录降级」这一条的规则层部分；
// 同文件里「76 个字已从题库 / 笔顺数据中移除」一条读的是 JS 侧的 deck-data.js / data/*.json / shell manifest，不在这张卡的范围。
//
// 「旧记录降级」原用例的 JS 专属部分在 Swift 里没有对应物，不能在这里转写：
//   · cardForKey / libraryIdsOfKey / setDeckSource（src/data/deck.js 的卡对象与字库归属）→ 用 DeckIndex 的 isPracticable / libraries 成员关系代替；
//   · reminderCandidates（src/platform/reminder.js，提醒模块）、listModel（src/session/views/library-list.js，清单视图）、
//     buildBackupV2 / serializeBackup / inspectBackup / stateOfEntries（src/core/backup.js，备份）→ 都属于 JS 的平台 / 视图 / 备份模块，
//     分别由 B4.3（备份）与各视图卡转写，这里不含。
// 规则层（planDaily / practicable）完整转写。

private let tz = TimeZone(identifier: "Asia/Shanghai")!
private let rules = ScheduleRules(timeZone: tz)
private let TODAY = "2026-10-04"
private let DAY_MS = 24.0 * 3600 * 1000
private let AT = JSDate.makeLocal(2026, 9, 4, hours: 9, tz)!
private let GONE = ["\u{5EC6}", "\u{56AD}", "\u{39D0}"] // strokeorder.cc / 台湾教育部 / 华文楷体 各一个
private let KEPT = ["\u{6C38}", "\u{9F0E}"]

private var serial = 0

/// makeRecord 的 judged 记录（localDay 由 at 按 4 点分界算出，help 为空对象的补全值）。
private func judged(_ char: String, _ judgment: String, _ at: Double) throws -> JSValue {
    serial += 1
    return JS.obj([
        ("id", .string("r\(serial)")), ("cardKey", .string("base:" + char)), ("char", .string(char)), ("sessionId", .string("s1")), ("kind", .string("judged")),
        ("judgment", .string(judgment)), ("at", .number(at)), ("localDay", .string(try rules.dates.localDay(.number(at)))),
        ("help", JS.obj([("hints", .number(0)), ("answerSeen", .bool(false)), ("traced", .bool(false))])),
    ])
}

private func entry(_ due: String) -> JSValue {
    JS.obj([("due", .string(due)), ("fsrs", JS.obj([("stability", .number(1))])), ("lastJudgedAt", .number(AT - 3 * DAY_MS))])
}

private func legacyState() throws -> JSValue {
    var records: [JSValue] = []
    for ch in GONE { records.append(try judged(ch, "wrong", AT - 3 * DAY_MS)) }
    for ch in KEPT { records.append(try judged(ch, "wrong", AT - 3 * DAY_MS)) }
    var months = JSObject()
    for r in records {
        let month = String(r["localDay"]!.stringValue!.prefix(7))
        months[month] = .array((months[month]?.arrayValue ?? []) + [r])
    }
    var sched = JSObject()
    for ch in GONE + KEPT { sched["base:" + ch] = entry("2026-10-01") }
    return JS.obj([
        ("records", .object(months)),
        ("sched", .object(sched)),
        ("custom", JS.obj([("added", .array([JS.obj([("char", .string("\u{56AD}")), ("at", .number(AT - DAY_MS))]),
                                              JS.obj([("char", .string("\u{6C38}")), ("at", .number(AT - DAY_MS))])]))])),
        ("settings", JS.obj([("library", .string("rare")), ("remind", JS.obj([("enabled", .bool(true)), ("hour", .number(21)), ("minute", .number(0))]))])),
        ("wordOff", .null),
    ])
}

final class ComplianceRemovalTests: XCTestCase {
    // test/core/compliance-removal.test.mjs: old records that mention a removed character degrade through the existing 「not in the deck」 path without throwing
    func testOldRecordsThatMentionARemovedCharacterDegradeThroughTheExistingNotInTheDeckPathWithoutThrowing() throws {
        let deck = ScheduleDeck.real
        let index = DeckIndex.shared
        for ch in GONE {
            XCTAssertFalse(deck.practicable("base:" + ch), "\(ch) is no longer practicable")
            XCTAssertNil(DeckData.shared.seed.first { $0["target"] == .string(ch) }, "\(ch) has no card in the deck")
            XCTAssertTrue(index.libraries.allSatisfy { !$0.keys.contains("base:" + ch) }, "\(ch) belongs to no library")
        }
        for ch in KEPT { XCTAssertTrue(deck.practicable("base:" + ch)) }

        let state = try legacyState()
        let plan = try rules.planDaily(state, today: TODAY, deck: deck)
        let planned = Set((plan["queue"]?.arrayValue ?? []).compactMap { $0.stringValue })
        for ch in GONE { XCTAssertFalse(planned.contains("base:" + ch), "today's practice does not offer \(ch)") }
        XCTAssertTrue(planned.contains("base:\u{9F0E}") || planned.contains("base:\u{6C38}"), "due characters still in the deck are still offered")
        XCTAssertEqual(plan["libraryId"], .string("rare"), "the \u{4E09}\u{7EA7} library (which held most removed characters) still works")
    }
}
