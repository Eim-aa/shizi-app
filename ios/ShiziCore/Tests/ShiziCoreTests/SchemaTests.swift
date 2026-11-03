import Foundation
import XCTest
@testable import ShiziCore

// test/store/schema.test.mjs 的转写（11 个用例，用例名保留原名）。基线状态来自金标准夹具（node 导出），不手抄。
// 另有 schema.json 金标准（正反例 1106 条）逐条比对，见 GoldenTests.testSchemaGolden。

func settingPath(_ v: JSValue, _ path: [String], _ value: JSValue) -> JSValue {
    guard let head = path.first else { return value }
    guard case .object(var o) = v else { return v }
    o[head] = settingPath(o[head] ?? .null, Array(path.dropFirst()), value)
    return .object(o)
}

final class SchemaTests: XCTestCase {
    let V2 = Schema.v2Prefix

    func valid(_ key: String, _ value: JSValue) -> String? { Schema.validateValue(key: key, value: value) }

    func backupOf(_ state: JSObject) -> JSValue {
        var data = JSObject()
        for id in Schema.backupWhitelist {
            if id == "records", case .object(let recs)? = state["records"] {
                for e in recs.entries { data[Schema.recordsKey(e.key)] = .string(str(e.value)) }
            } else if id == "ink", case .object(let inks)? = state["ink"] {
                for e in inks.entries { data[Schema.inkKey(e.key)] = .string(str(e.value)) }
            } else if let v = state[id], !v.isNull {
                data[Schema.keyNamed(id)!] = .string(str(v))
            }
        }
        if let s = state["sessions"] { data[Schema.sessionsKey] = .string(str(s)) }
        return .object(JSObject([("app", .string("shizi")), ("version", .number(2)), ("date", .string("2026-09-15T01:00:00.000Z")), ("data", .object(data))]))
    }

    // key coverage invariant: schema key table = backup whitelist ∪ exclusion table, disjoint
    func testKeyCoverageInvariantSchemaKeyTableEqualsBackupWhitelistUnionExclusionTableDisjoint() {
        let ids = Schema.keySpecs.map { $0.id }.sorted()
        let union = (Schema.backupWhitelist + Schema.backupExcluded).sorted()
        XCTAssertEqual(ids, union, "every schema key must be listed exactly once in whitelist or exclusion table")
        for id in Schema.backupWhitelist { XCTAssertFalse(Schema.backupExcluded.contains(id), "\(id) is in both tables") }
        XCTAssertEqual(Set(ids).count, ids.count, "schema ids unique")
    }

    // key coverage invariant: every store domain maps to a schema key, and 01 §3.6 backup column holds
    func testKeyCoverageInvariantEveryStoreDomainMapsToASchemaKeyAnd01Section36BackupColumnHolds() {
        for domain in Schema.domains {
            XCTAssertNotNil(Schema.keySpecs.first { $0.domain == domain }, "domain \(domain) has no schema entry")
        }
        XCTAssertEqual(Schema.backupExcluded.sorted(), ["funnel", "inkRecord", "route", "safety", "sessions", "txn"])
        XCTAssertFalse(Schema.isBackupKey(Schema.sessionsKey))
        XCTAssertTrue(Schema.isBackupKey(Schema.metaKey))
        XCTAssertTrue(Schema.isBackupKey(Schema.recordsKey("2026-09")))
        XCTAssertFalse(Schema.isBackupKey("shizi.corrupt.shizi.v2.meta"))
        XCTAssertFalse(Schema.isBackupKey("shizi.nativeSmoke.v1"))
        XCTAssertNil(Schema.specForKey("shizi.v2.records.2026-13"), "bad month is not a records key")
        XCTAssertNil(Schema.specForKey("shizi.v2.whatever"))
        XCTAssertTrue(Schema.isBackupKey(Schema.inkKey("2026-09")), "ink month keys are backed up")
        XCTAssertNil(Schema.specForKey("shizi.v2.ink"), "the old single ink key is gone")
        XCTAssertNil(Schema.specForKey("shizi.v2.ink.2026-13"), "bad month is not an ink key")
        XCTAssertFalse(Schema.isBackupKey(Schema.inkRecordKey("2026-09", "r5")), "one-record ink keys are storage-only (backup groups ink by month)")
    }

    // B2.3 ink schema 2: one key per record shizi.v2.ink.<YYYY-MM>.<recordId> = one Ink (v4 raw points | v3 | v2)
    func testB23InkSchema2OneKeyPerRecordIsOneInk() {
        let key = Schema.inkRecordKey("2026-09", "r12")
        XCTAssertEqual(key, "shizi.v2.ink.2026-09.r12")
        let parsed = Schema.parseInkRecordKey(key)
        XCTAssertEqual(parsed?.month, "2026-09")
        XCTAssertEqual(parsed?.id, "r12")
        XCTAssertTrue(Schema.isInkRecordKey(key))
        XCTAssertFalse(Schema.isInkKey(key), "not a month key")
        XCTAssertTrue(Schema.isInkStorageKey(key) && Schema.isInkStorageKey(Schema.inkKey("2026-09")), "both are ink storage keys")
        for bad in ["shizi.v2.ink.2026-09.", "shizi.v2.ink.2026-09.s1", "shizi.v2.ink.2026-13.r1", "shizi.v2.ink.2026-09.r0", "shizi.v2.ink.2026-09r1", "shizi.v2.ink.2026-09.r1.x"] {
            XCTAssertNil(Schema.parseInkRecordKey(bad), bad)
            XCTAssertNil(Schema.specForKey(bad), bad)
        }
        XCTAssertEqual(Schema.specForKey(key)?.id, "inkRecord")
        XCTAssertEqual(Schema.specForKey(key)?.domain, "ink")
        XCTAssertNil(Schema.monthOfKey(key), "monthOfKey stays for month keys only")
        let v4 = J(#"{"v":4,"c":345,"r":["A8gBkAMALiIIsQKOO1w=","BNAP0A8A7AQUEwT8Ag=="],"g":[0,400]}"#)
        XCTAssertNil(valid(key, v4), "v4 one-record value valid")
        XCTAssertNil(valid(Schema.inkKey("2026-09"), .object(JSObject([("r12", v4)]))), "v4 inside a month table (backup files) valid")
        XCTAssertNil(valid(key, J(#"{"v":3,"c":345,"s":["AAAAAA=="]}"#)), "v3 still valid per record")
        XCTAssertTrue(contains(valid(key, J(#"{"v":4,"c":345,"r":["A8gBkAMALiIIsQKOO1w="],"g":[]}"#)), "length differs"))
        XCTAssertTrue(contains(valid(key, J(#"{"v":4,"c":345,"r":[[3,1,2,0]],"g":[0]}"#)), "packed stroke"))
        XCTAssertTrue(contains(valid(key, J(#"{"v":4,"c":345,"r":["AAA="],"g":[0]}"#)), "packed stroke"), "shorter than one point")
        XCTAssertTrue(contains(valid(key, J(#"{"v":4,"c":345,"r":["A8gBkAMALiIIsQKOO1w="],"g":[-1]}"#)), "non-negative"))
        XCTAssertTrue(contains(valid(key, J(#"{"v":4,"c":345,"r":[],"g":[],"s":[]}"#)), "unknown field"))
        XCTAssertTrue(contains(valid(key, J(#"{"v":4,"c":345,"r":[]}"#)), "missing"))
    }

    // ink is split by record month: shizi.v2.ink.<YYYY-MM> = {recordId: Ink v3 | legacy v2} (F3 / P78)
    func testInkIsSplitByRecordMonth() throws {
        XCTAssertEqual(Schema.inkKey("2026-09"), "shizi.v2.ink.2026-09")
        XCTAssertEqual(try Schema.keyForDomain("ink", month: "2026-09"), "shizi.v2.ink.2026-09")
        XCTAssertTrue(Schema.isInkKey("shizi.v2.ink.2026-09"))
        XCTAssertFalse(Schema.isInkKey("shizi.v2.records.2026-09"))
        XCTAssertEqual(Schema.monthOfKey("shizi.v2.ink.2026-09"), "2026-09")
        XCTAssertEqual(Schema.monthOfKey(Schema.recordsKey("2026-08")), "2026-08")
        XCTAssertEqual(Schema.specForKey(Schema.inkKey("2026-09"))?.id, "ink")
        let rec = makeRecord(5, "\u{4EBA}", day: "2026-09-30", extra: [("at", .number(1790782200000))])
        XCTAssertEqual(Schema.inkMonthOf(rec, timeZone: sixTimeZone), "2026-09", "same month rule as records (localDay)")
        XCTAssertEqual(Schema.inkMonthOf(J(#"{"id":"r1","at":1783137600000}"#), timeZone: sixTimeZone), "2026-07", "falls back to local month of at")
        XCTAssertNil(Schema.inkMonthOf(J(#"{"id":"r1"}"#), timeZone: sixTimeZone))
        XCTAssertEqual(Schema.inkIdOf(rec), "r5")
        XCTAssertEqual(Schema.inkIdOf(setting(rec, "inkId", .string("r4"))), "r4", "inkId wins")
        let ink = J(#"{"r5":{"v":2,"c":345,"s":[[1,2,100]]}}"#)
        XCTAssertNil(valid(Schema.inkKey("2026-09"), ink), "legacy v2 still valid (P78 read compatibility)")
        XCTAssertTrue(contains(valid(Schema.inkKey("2026-09"), J(#"{"s5":{"v":2,"c":345,"s":[[1,2,100]]}}"#)), "bad key"))
        XCTAssertTrue(contains(valid(Schema.inkKey("2026-09"), J(#"{"r5":{"v":1,"c":345,"s":[]}}"#)), "must be 2"))
        // v3 打包编码（P78）：s / p 为 base64 串，没有 dt
        XCTAssertNil(valid(Schema.inkKey("2026-09"), J(#"{"r5":{"v":3,"c":345,"s":["AAAAAA==",""],"p":["AA==",""]}}"#)), "v3 valid")
        XCTAssertTrue(contains(valid(Schema.inkKey("2026-09"), J(#"{"r5":{"v":3,"c":345,"s":[[1,2,100]]}}"#)), "base64"), "v3 rows must be base64 strings")
        XCTAssertTrue(contains(valid(Schema.inkKey("2026-09"), J(#"{"r5":{"v":3,"c":345,"s":["AA=A"]}}"#)), "base64"), "bad padding rejected")
        XCTAssertTrue(contains(valid(Schema.inkKey("2026-09"), J(#"{"r5":{"v":3,"c":345,"s":["AAAAAA=="],"dt":[[0]]}}"#)), "unknown field"), "v3 has no dt")
        XCTAssertTrue(contains(valid(Schema.inkKey("2026-09"), J(#"{"r5":{"v":3,"c":345}}"#)), "missing"))
        let v2rows = valid(Schema.inkKey("2026-09"), J(#"{"r5":{"v":2,"c":345,"s":["AAAAAA=="]}}"#))
        XCTAssertTrue(contains(v2rows, "integer") || contains(v2rows, "array"), "v2 rows must be int arrays")
    }

    // baseline fixture passes every key shape
    func testBaselineFixturePassesEveryKeyShape() throws {
        let state = try baselineState()
        for domain in Schema.domains {
            if domain == "records" {
                for e in state["records"]?.objectValue?.entries ?? [] { XCTAssertNil(valid(Schema.recordsKey(e.key), e.value)) }
            } else if domain == "ink" {
                for e in state["ink"]?.objectValue?.entries ?? [] { XCTAssertNil(valid(Schema.inkKey(e.key), e.value)) }
            } else if let v = state[domain], !v.isNull {
                XCTAssertNil(valid(Schema.keyNamed(domain)!, v), domain)
            }
        }
    }

    // record shape rules (judged needs judgment; char matches cardKey; month ownership; ascending ids)
    func testRecordShapeRules() {
        let ren = "\u{4EBA}", kou = "\u{53E3}"
        XCTAssertNil(Schema.validateRecord(makeRecord(1, ren)))
        XCTAssertTrue(contains(Schema.validateRecord(removing(makeRecord(1, ren), "judgment")), "judgment"))
        XCTAssertTrue(contains(Schema.validateRecord(makeRecord(1, ren, kind: "skipped", extra: [("judgment", .string("wrong"))])), "judgment"))
        XCTAssertTrue(contains(Schema.validateRecord(setting(makeRecord(1, ren), "char", .string(kou))), "char"))
        XCTAssertTrue(contains(Schema.validateRecord(setting(makeRecord(1, ren), "help", J(#"{"hints":65,"answerSeen":false,"traced":false}"#))), "hints"))
        XCTAssertTrue(contains(Schema.validateRecord(setting(makeRecord(1, ren), "extraField", .number(1))), "unknown field"))
        let noSession = removing(makeRecord(1, ren), "sessionId")
        XCTAssertTrue(contains(Schema.validateRecord(noSession), "sessionId"))
        XCTAssertNil(Schema.validateRecord(setting(noSession, "legacy", .bool(true))), "legacy records may lack sessionId")
        XCTAssertTrue(contains(valid(Schema.recordsKey("2026-10"), .array([makeRecord(1, ren)])), "not in month"))
        XCTAssertTrue(contains(valid(Schema.recordsKey("2026-09"), .array([makeRecord(2, ren), makeRecord(1, kou)])), "ascending"))
        XCTAssertNil(valid(Schema.recordsKey("2026-09"), .array([makeRecord(1, "\u{20BB7}")])), "supplementary-plane char is one char")
        XCTAssertFalse(Schema.isLocalDay("2026-02-30"))
        XCTAssertTrue(Schema.isLocalDay("2028-02-29"))
    }

    // folded month shape
    func testFoldedMonthShape() {
        let ren = "\u{4EBA}"
        let folded = JSValue.object(JSObject([
            ("folded", .bool(true)), ("month", .string("2025-01")),
            ("byDay", .object(JSObject([("2025-01-03", .array([.string(ren)]))]))), ("chars", .array([.string(ren)])),
            ("kept", .array([makeRecord(1, ren, day: "2025-01-03")])),
        ]))
        XCTAssertNil(valid(Schema.recordsKey("2025-01"), folded))
        XCTAssertTrue(contains(valid(Schema.recordsKey("2025-02"), folded), "month"))
    }

    // session shape: slot/kind pairing, cursor bound
    func testSessionShapeSlotKindPairingCursorBound() throws {
        let s = try XCTUnwrap(try baselineState()["sessions"])
        XCTAssertNil(valid(Schema.sessionsKey, s))
        XCTAssertTrue(contains(valid(Schema.sessionsKey, settingPath(s, ["A", "kind"], .string("picked"))), "slot A"))
        XCTAssertTrue(contains(valid(Schema.sessionsKey, settingPath(s, ["A", "cursor"], .number(99))), "cursor"))
    }

    // parseAndValidate: invalid JSON and bad shape are reported
    func testParseAndValidateInvalidJSONAndBadShapeAreReported() {
        func ok(_ raw: String) -> Bool { if case .ok = Schema.parseAndValidate(key: Schema.metaKey, raw: .string(raw)) { return true }; return false }
        XCTAssertFalse(ok("{"))
        XCTAssertFalse(ok(#"{"schema":1,"serial":0,"createdAt":1,"months":[]}"#))
        XCTAssertTrue(ok(#"{"schema":2,"serial":0,"createdAt":1,"months":[]}"#))
    }

    // backup v2 envelope: good file parses, sessions ignored
    func testBackupV2EnvelopeGoodFileParsesSessionsIgnored() throws {
        let parsed = Schema.parseBackupV2(backupOf(try baselineState()))
        XCTAssertEqual(parsed["ok"], .bool(true))
        XCTAssertTrue((parsed["ignored"]?.arrayValue ?? []).contains(.string(Schema.sessionsKey)))
        for e in parsed["entries"]?.arrayValue ?? [] { XCTAssertTrue(Schema.isBackupKey(e.arrayValue?.first?.stringValue ?? "")) }
    }

    // backup v2 envelope: any single bad key rejects the whole file
    func testBackupV2EnvelopeAnySingleBadKeyRejectsTheWholeFile() throws {
        let base = backupOf(try baselineState())
        let data = try XCTUnwrap(base["data"]?.objectValue)
        for key in data.keys where Schema.isBackupKey(key) {
            for broken in [JSValue.string(#"{"not":"the right shape"}"#), .string("{oops")] {
                let parsed = Schema.parseBackupV2(settingPath(base, ["data", key], broken))
                XCTAssertEqual(parsed["ok"], .bool(false), "\(key) broken should reject")
                if broken == .string(#"{"not":"the right shape"}"#) { XCTAssertEqual(parsed["key"], .string(key)) }
                XCTAssertNil(parsed["entries"], "no partial result")
            }
            let notString = Schema.parseBackupV2(settingPath(base, ["data", key], J(#"{"raw":true}"#)))
            XCTAssertEqual(notString["reason"], .string("value"))
        }
        XCTAssertEqual(Schema.parseBackupV2(J(#"{"app":"shizi","version":1,"data":{}}"#))["reason"], .string("v1"))
        XCTAssertEqual(Schema.parseBackupV2(J(#"{"app":"other","version":2,"data":{}}"#))["reason"], .string("format"))
        var noMeta = data
        noMeta[Schema.metaKey] = nil
        XCTAssertEqual(Schema.parseBackupV2(settingPath(base, ["data"], .object(noMeta)))["reason"], .string("empty"))
    }
}
