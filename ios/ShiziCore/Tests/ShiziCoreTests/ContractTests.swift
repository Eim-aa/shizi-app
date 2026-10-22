import Foundation
import XCTest
@testable import ShiziCore

// test/core/contract.test.mjs 的转写（4 个用例，用例名保留原名）。
// 契约测试：core 产出的记录 / 调度项 / 会话必须通过 store 形状表。JS 的 core 是参考实现：夹具 contract.json（node scripts/core-golden/domains/contract.mjs）
// 由真实的 makeRecord / correctRecord / applyJudgment / replay / sessions.*（整个生命周期每一步）造出，Swift 这边对每一条跑 Schema 校验并走模型往返逐字节不变。
// （B4.2 的 Swift 版 fsrs / sessions 产出的值由它们自己的测试与随机差分过同一张形状表。）

final class ContractTests: XCTestCase {
    func cases(prefix: String) throws -> [JSValue] {
        try (loadFixture("contract")["cases"]?.arrayValue ?? []).filter { ($0.str("label") ?? "").hasPrefix(prefix) }
    }

    func check(_ c: JSValue, file: StaticString = #filePath, line: UInt = #line) throws {
        let key = c.str("key")!, value = c["value"]!
        let label = c.str("label") ?? ""
        XCTAssertNil(Schema.validateValue(key: key, value: value), label, file: file, line: line)
        // 形状表通过的值，模型解码再编码必须逐字节不变
        guard let spec = Schema.specForKey(key) else { return XCTFail("no spec for \(key)", file: file, line: line) }
        XCTAssertSameJSON(try Models.roundTrip(specId: spec.id, value: value), value, label, file: file, line: line)
    }

    // test/core/contract.test.mjs: contract: records built and corrected by core pass the schema
    func testContractRecordsBuiltAndCorrectedByCorePassTheSchema() throws {
        let list = try cases(prefix: "records:")
        XCTAssertEqual(list.count, 2)
        for c in list { try check(c) }
        // 单条记录也过记录形状（validateRecord）
        for c in list { for r in c["value"]?.arrayValue ?? [] { XCTAssertNil(Schema.validateRecord(r, month: nil), jsonText43(r)) } }
        // Swift 自己造 / 更正的记录同样通过
        let made = try Records.makeRecord(JSObject([("id", s43("r1")), ("cardKey", s43("base:" + jing43)), ("sessionId", s43("s1")), ("kind", s43("judged")), ("judgment", s43("wrong")),
                                                    ("at", n43(at43("2026-09-24", 20))), ("help", obj43([("hints", n43(2)), ("traced", .bool(false))]))]), dates: shanghai43)
        let fixed = try Records.correctRecord(made, s43("correct"), at: n43(at43("2026-09-24", 20, 5)))
        for r in [made, fixed] { XCTAssertNil(Schema.validateRecord(r, month: nil), jsonText43(r)) }
        XCTAssertNil(Schema.validateValue(key: Schema.recordsKey("2026-09"), value: .array([made])))
        XCTAssertNil(Schema.validateValue(key: Schema.recordsKey("2026-09"), value: .array([fixed])))
    }

    // test/core/contract.test.mjs: contract: sched entries from applyJudgment / replay pass the schema
    func testContractSchedEntriesFromApplyJudgmentReplayPassTheSchema() throws {
        let list = try cases(prefix: "sched:")
        XCTAssertEqual(list.count, 3)
        for c in list { try check(c) }
    }

    // test/core/contract.test.mjs: contract: sessions through their whole lifecycle pass the schema
    func testContractSessionsThroughTheirWholeLifecyclePassTheSchema() throws {
        let list = try cases(prefix: "sessions:")
        XCTAssertEqual(list.count, 8)
        for c in list { try check(c) }
    }

    // test/core/contract.test.mjs: contract: cards.js placeholder prompt copy (M0-2) equals the copy table
    func testContractCardsJsPlaceholderPromptCopyM02EqualsTheCopyTable() throws {
        XCTAssertEqual(CardRules.promptCopy["repeatInstruction"], s43(try Copy.text("R-W28.repeatBlankNote")))
        XCTAssertEqual(CardRules.promptCopy["fallbackHint"], s43(try Copy.text("X-PROMPT.fallbackHint")))
        XCTAssertEqual(CardRules.promptCopy["repeatBlankLabel"], s43(try Copy.text("X-PROMPT.repeatBlankLabel")))
    }
}
