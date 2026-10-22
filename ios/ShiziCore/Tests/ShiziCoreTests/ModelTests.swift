import Foundation
import XCTest
@testable import ShiziCore

// 模型（Models/*.swift）：与 SQLite 里的 JSON 形状逐字节一致（键序、数字格式）。随机往返见差分域 schema 的 models.roundtrip 与金标准 schema.json。

final class ModelTests: XCTestCase {
    func bytes(_ v: JSValue) -> String { JSONWriter.stringify(v) }

    func testBaselineStateRoundTripsByteForByte() throws {
        let state = try baselineState()
        var n = 0
        for domain in Schema.domains {
            func check(_ key: String, _ value: JSValue) throws {
                let spec = try XCTUnwrap(Schema.specForKey(key), key)
                XCTAssertEqual(bytes(try Models.roundTrip(specId: spec.id, value: value)), bytes(value), key)
                n += 1
            }
            if domain == "records" { for e in state["records"]?.objectValue?.entries ?? [] { try check(Schema.recordsKey(e.key), e.value) } }
            else if domain == "ink" { for e in state["ink"]?.objectValue?.entries ?? [] { try check(Schema.inkKey(e.key), e.value) } }
            else if let v = state[domain], !v.isNull { try check(Schema.keyNamed(domain)!, v) }
        }
        XCTAssertGreaterThan(n, 8)
    }

    func testTypedAccess() throws {
        let state = try baselineState()
        let sessions = try Sessions(js: try XCTUnwrap(state["sessions"]))
        XCTAssertEqual(sessions.A?.slot, "A")
        XCTAssertNil(sessions.B)
        XCTAssertEqual(sessions.A?.items.count, 2)
        XCTAssertEqual(sessions.A?.items.first?.recordId, "r2")
        guard case .value(let current)? = Optional(sessions.A!.current) else { return XCTFail("current") }
        XCTAssertEqual(current.phase, "recall")
        XCTAssertEqual(sessions.A?.lastLine, .null)
        let meta = try Meta(js: try XCTUnwrap(state["meta"]))
        XCTAssertEqual(meta.schema, 2)
        XCTAssertEqual(meta.months, ["2026-09"])
        let sched = try Sched(js: try XCTUnwrap(state["sched"]))
        XCTAssertEqual(sched.entries.count, 2)
        XCTAssertEqual(sched.entries.entries.first?.value.due, "2026-09-18")
        guard case .list(let list) = try RecordsMonth(js: try XCTUnwrap(state["records"]?["2026-09"])) else { return XCTFail("list") }
        XCTAssertEqual(list.map { $0.id }, ["r2", "r3"])
        XCTAssertEqual(list[1].judgment, "wrong")
    }

    /// 读入时的键序在改写后保留；新构造的模型按 JS 写入处的键序（core/records.js makeRecord）。
    func testKeyOrderIsKeptAndCanonicalOrderMatchesMakeRecord() throws {
        let shuffled = #"{"judgment":"wrong","help":{"traced":false,"hints":2,"answerSeen":true},"kind":"judged","id":"r7","at":1790000000000,"localDay":"2026-09-15","cardKey":"base:人","sessionId":"s2","char":"人","inkId":"r5"}"#
        var rec = try RecordModel(js: J(shuffled))
        XCTAssertEqual(bytes(rec.js), bytes(J(shuffled)))
        rec.judgment = "correct"
        rec.source = "paper"
        let out = bytes(rec.js)
        XCTAssertTrue(out.hasPrefix(#"{"judgment":"correct","help":{"#), out)
        XCTAssertTrue(out.hasSuffix(#""inkId":"r5","source":"paper"}"#), out)

        let made = RecordModel(id: "r1", cardKey: "base:\u{4EBA}", char: "\u{4EBA}", sessionId: "s1", kind: "judged", judgment: "correct", at: 1790000000000,
                               localDay: "2026-09-15", help: Help(hints: 2, answerSeen: false, traced: false), inkId: "r1")
        let want = #"{"id":"r1","cardKey":"base:\#u{4EBA}","char":"\#u{4EBA}","sessionId":"s1","kind":"judged","at":1790000000000,"localDay":"2026-09-15","help":{"hints":2,"answerSeen":false,"traced":false},"judgment":"correct","inkId":"r1"}"#
        XCTAssertEqual(bytes(made.js), want)
    }

    func testThreeStateFieldsKeepAbsentAndNullApart() throws {
        for text in [#"{}"#, #"{"lastExportAt":null}"#, #"{"lastExportAt":1,"lastExportSig":null,"lastConclusion":null}"#,
                     #"{"lastConclusion":{"kind":"clear","count":2,"date":null}}"#, #"{"lastConclusion":{"count":2,"kind":"clear"}}"#] {
            XCTAssertEqual(bytes(try BackupMeta(js: J(text)).js), text)
        }
        XCTAssertEqual(try BackupMeta(js: J("{}")).lastExportAt, .absent)
        XCTAssertEqual(try BackupMeta(js: J(#"{"lastExportAt":null}"#)).lastExportAt, .null)
    }

    func testInkVersions() throws {
        for text in [#"{"v":4,"c":345,"r":["A8gBkAMALiIIsQKOO1w="],"g":[0]}"#, #"{"g":[0],"r":["A8gBkAMALiIIsQKOO1w="],"c":345,"v":4}"#,
                     #"{"v":3,"c":345,"s":["AAAAAA==",""],"p":["AA==",""]}"#, #"{"v":2,"c":345,"s":[[1,2,100]],"dt":[[0]],"p":[[1]]}"#, #"{"v":2,"c":345,"s":[]}"#] {
            XCTAssertEqual(bytes(try Ink(js: J(text)).js), text)
        }
        XCTAssertThrowsError(try Ink(js: J(#"{"v":1,"c":345,"s":[]}"#)))
    }

    func testNumbersKeepJSFormat() throws {
        let text = #"{"schema":2,"serial":3,"createdAt":1789434000000.5,"migratedAt":1e21,"months":["2026-09"]}"#
        XCTAssertEqual(bytes(try Meta(js: J(text)).js), #"{"schema":2,"serial":3,"createdAt":1789434000000.5,"migratedAt":1e+21,"months":["2026-09"]}"#)
    }

    func testDecodeRejectsWrongShapeWithoutCrashing() {
        XCTAssertThrowsError(try RecordModel(js: J("[]")))
        XCTAssertThrowsError(try Sessions(js: J(#"{"A":5,"B":null,"lastEnded":{}}"#)))
        XCTAssertThrowsError(try Meta(js: J(#"{"schema":"2"}"#)))
    }
}
