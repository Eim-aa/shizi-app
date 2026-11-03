import Foundation
import XCTest
@testable import ShiziCore

// test/core/first-practice.test.mjs 的转写（B4.2，3 条）：第一次练习（阶段 1 P1-E4，决定 D38：尴 → 赢 → 拾，3 个字；覆盖 D17 / P09 的 5 字）。
// 原用例用 vm 加载 deck-data.js 并经 buildCards 取卡；Swift 里题库数据是生成的 deck.json（DeckData.shared.seed），这三个字没有语境覆盖，
// 直接取 SEED 里 target 为该字的行（word = ans，norm 缺省 = 一级，与 buildCards 同）。

private let tz = TimeZone(identifier: "Asia/Shanghai")!

private func table() throws -> JSValue {
    try JSONParser.parse(try readRepoFile("docs/engineering/v10/phase1/\u{6613}\u{5FD8}\u{5EA6}\u{5B57}\u{8868}-1.0.json"))
}

private func firstQueue() -> [String] { (Config.policy["firstQueue"]?.arrayValue ?? []).compactMap { $0.stringValue } }

final class FirstPracticeTests: XCTestCase {
    // policy.firstQueue is 尴 赢 拾: the table's default combination A, none of them a warm-up char
    func testPolicyFirstQueueIsAwkwardWinPickUpTheTablesDefaultCombinationANoneOfThemAWarmUpChar() throws {
        XCTAssertEqual(firstQueue(), ["\u{5C34}", "\u{8D62}", "\u{62FE}"])
        XCTAssertEqual(SessionRules.selectFirst(), ["base:\u{5C34}", "base:\u{8D62}", "base:\u{62FE}"])
        for c in firstQueue() { XCTAssertFalse(NewOrder.isWarmupChar(c), c) }
        let t = try table()
        let combos = try XCTUnwrap(t["firstCombos"]?.arrayValue)
        let combo = try XCTUnwrap(combos.first { $0["id"] == t["defaultCombo"] })
        XCTAssertEqual(Config.policy["firstQueue"], combo["chars"], "policy.firstQueue = the table's default combination A")
        for row in try XCTUnwrap(combo["rows"]?.arrayValue) {
            XCTAssertEqual(row["norm"], .string("\u{4E00}\u{7EA7}"), "\(row["char"]?.stringValue ?? "?") is in core3500")
        }
    }

    // all three first-practice chars are in the default library (规范常用字 = norm 一级) and their words are 尴尬 / 赢得 / 收拾
    func testAllThreeFirstPracticeCharsAreInTheDefaultLibraryNormLevel1AndTheirWordsAreAwkwardWinCleanUp() throws {
        let words = ["\u{5C34}": "\u{5C34}\u{5C2C}", "\u{8D62}": "\u{8D62}\u{5F97}", "\u{62FE}": "\u{6536}\u{62FE}"]
        let seed = DeckData.shared.seed
        let lib = try XCTUnwrap(DeckIndex.shared.library(.string("core3500")))
        for c in firstQueue() {
            let row = try XCTUnwrap(seed.first { $0["target"] == .string(c) }, "\(c) is in the deck")
            XCTAssertTrue(DeckIndex.shared.isPracticable("base:" + c), "\(c) is practicable")
            // norm 缺省为 一级（buildCards 的 w.norm || '一级'）；core3500 库的成员 = norm 一级
            XCTAssertEqual(row["norm"] ?? .string("\u{4E00}\u{7EA7}"), .string("\u{4E00}\u{7EA7}"), "\(c) belongs to core3500")
            XCTAssertTrue(lib.keys.contains("base:" + c), "\(c) is a member of the core3500 library")
            XCTAssertEqual(row["ans"]?.stringValue, words[c], "\(c) word")
        }
    }

    // the first group is 3 characters and only the first practice: progress reads 1 / 3, later groups stay at groupSize
    func testTheFirstGroupIs3CharactersAndOnlyTheFirstPracticeProgressReads13LaterGroupsStayAtGroupSize() throws {
        let dates = Dates(timeZone: tz)
        let q = SessionRules.selectFirst().map { JSValue.string($0) }
        let atMs = try XCTUnwrap(JSDate.makeLocal(2026, 8, 24, hours: 12, tz))
        let s = try SessionRules.createSession(id: .string("s1"), kind: .string("first"), source: nil, queue: .array(q), at: .number(atMs), dates: dates)
        XCTAssertEqual(s["queue"]?.arrayValue?.count, 3)
        let cursor = try XCTUnwrap(s["cursor"]?.numberValue)
        let total = Double(s["queue"]?.arrayValue?.count ?? 0)
        XCTAssertEqual(try Copy.text("R-W01.progress", JSObject([("n", .number(cursor + 1)), ("total", .number(total))])), "1 / 3")
        XCTAssertEqual(try Copy.text("R-H04.resumeFirst", JSObject([("n", .number(1)), ("total", .number(3))])), "\u{9996}\u{6B21}\u{7EC3}\u{4E60} \u{B7} 1 / 3")
        XCTAssertEqual(try Copy.text("R-H04.resumeFirstAria", JSObject([("n", .number(1)), ("total", .number(3))])), "\u{63A5}\u{7740}\u{5199}\u{9996}\u{6B21}\u{7EC3}\u{4E60}\u{FF0C}\u{5DF2}\u{5199} 1 \u{4E2A}\u{FF0C}\u{5171} 3 \u{4E2A}")
        XCTAssertEqual(try Copy.text("R-H03.firstVisit"), "\u{5148}\u{5199}\u{4E09}\u{4E2A}\u{5927}\u{5BB6}\u{5E38}\u{5FD8}\u{7684}\u{5B57}\u{3002}", "P1-E5: the line under \u{5F00}\u{59CB}\u{5199}\u{5B57} (stage-1 design \u{A7}\u{4E00})")
        XCTAssertEqual(Config.policyNumber("groupSize"), 15) // D83：每组字数缺省 15（首练仍是 3）
    }
}
