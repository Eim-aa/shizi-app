import Foundation
import XCTest
@testable import ShiziCore

// test/store/ink-schema.test.mjs 的转写（B4.4，6 条 × 两种后端 = 12）：ink schema 2（每条墨迹一个键）——旧月键启动时逐月迁移、
// 失败不丢数据并记诊断、没迁完时照常读写、判断只写自己那一条、墨迹编码随后端（P05）、备份按月分组。
// 第 5 条原用例经 session/ops/judge.js commitJudgment（会话 op，B4.5）提交；这里用同一组规则直接拼出那次判断的提交
// （记录 + encodeStoredInk(按 ctx.inkFormat) + setInk），断言不变。

private func rawStroke(_ x0: Double, _ y0: Double, _ n: Int = 40, _ t0: Double = 0) -> [InkPoint] {
    (0..<n).map { k in InkPoint(x: x0 + Double(k) * 3.1, y: y0 + sin(Double(k) / 5) * 4, t: t0 + Double(k) * (1000.0 / 120), order: ["x", "y", "t"]) }
}

private func open(_ B: TestBackend, _ disk: TestDisk) -> StoreEnv { freshStore(B, disk: disk) }

/// 把盘上的单条墨迹键改回 schema 1 的旧月键。返回 月 → 表。
private func toLegacyDisk(_ disk: TestDisk) -> JSObject {
    var tables = JSObject()
    for (key, raw) in disk.snapshot() {
        guard let p = Schema.parseInkRecordKey(key) else { continue }
        var t = tables[p.month]?.objectValue ?? JSObject()
        t[p.id] = J(raw)
        tables[p.month] = .object(t)
        disk.rawRemove(key)
    }
    for (m, t) in tables.entries { disk.rawSet(Schema.inkKey(m), str(t)) }
    return tables
}

/// 两个月的墨迹（9 月 r2 v3、r3 v2；10 月 r5 v3），全部按旧月键放在盘上。
private func legacyDisk(_ B: TestBackend) -> (disk: TestDisk, tables: JSObject, base: JSObject) {
    let disk = B.make()
    var base = storeBaseline()
    var recs = base["records"]!.objectValue!
    recs["2026-10"] = .array([srec(5, cDa, day: "2026-10-01")])
    base["records"] = .object(recs)
    var meta = base["meta"]!.objectValue!
    meta["serial"] = .number(5)
    meta["months"] = J(#"["2026-09","2026-10"]"#)
    base["meta"] = .object(meta)
    base["ink"] = .object(JSObject([("2026-09", .object(JSObject([("r2", inkEntry()), ("r3", inkEntryV2())]))), ("2026-10", .object(JSObject([("r5", inkEntry(6, 2))])))]))
    XCTAssertTrue(ok(open(B, disk).store.seed(.object(base))))
    return (disk, toLegacyDisk(disk), base)
}

private func pick(_ o: JSObject?, _ keys: [String]) -> JSValue { .object(JSObject(keys.map { ($0, o?[$0] ?? .null) })) }

enum InkSchemaContract {
    // ink schema 1 → 2 at load: every legacy month becomes one key per record, state unchanged, idempotent
    static func migratesAtLoad(_ B: TestBackend) {
        let (disk, tables, base) = legacyDisk(B)
        XCTAssertTrue(disk.rawGet(Schema.inkKey("2026-09")) != nil && disk.rawGet(Schema.inkKey("2026-10")) != nil, "legacy month keys on disk")
        let store = open(B, disk).store
        XCTAssertEqual(pick(store.inkSchema, ["schema", "legacyMonths", "migrated", "records", "failed"]), J(#"{"schema":2,"legacyMonths":2,"migrated":2,"records":3,"failed":null}"#))
        XCTAssertNil(disk.rawGet(Schema.inkKey("2026-09")), "month key removed")
        XCTAssertNil(disk.rawGet(Schema.inkKey("2026-10")))
        for (m, t) in tables.entries {
            for (id, e) in t.objectValue!.entries { XCTAssertEqual(disk.rawGet(Schema.inkRecordKey(m, id)), str(e), "\(m).\(id) byte-equal to the legacy entry") }
        }
        XCTAssertEqual(sortedJSON(store.state["ink"]!), sortedJSON(base["ink"]!), "state.ink unchanged by the migration")
        XCTAssertNil(disk.rawGet(SK("txn")))
        let before = diskObject(disk)
        let again = open(B, disk).store
        XCTAssertEqual(again.inkSchema.map { JSValue.object($0) }, J(#"{"schema":2,"legacyMonths":0,"migrated":0,"records":0,"failed":null}"#))
        XCTAssertEqual(diskObject(disk), before)
        XCTAssertEqual(sortedJSON(.object(again.state)), sortedJSON(.object(store.state)))
    }

    // ink schema migration failure: that month rolls back untouched, earlier months stay migrated, diagnostic recorded, next start retries
    static func migrationFailure(_ B: TestBackend) {
        let (disk, tables, _) = legacyDisk(B)
        disk.failWhen { w in w.op == "set" && w.key == Schema.inkRecordKey("2026-10", "r5") ? .corrupt("{}") : nil }
        let first = open(B, disk)
        disk.failWhen(nil)
        let s = first.store.inkSchema!
        XCTAssertEqual(s["schema"], .number(1), "still schema 1")
        XCTAssertEqual(s["migrated"], .number(1))
        XCTAssertEqual(s["failed"]?["month"], .string("2026-10"))
        XCTAssertEqual(s["failed"]?["stage"], .string("write"))
        XCTAssertEqual(s["failed"]?["error"], .string("verify"))
        XCTAssertEqual(disk.rawGet(Schema.inkKey("2026-10")), str(tables["2026-10"]!), "failed month: legacy key byte-equal")
        XCTAssertNil(disk.rawGet(Schema.inkRecordKey("2026-10", "r5")), "no half-written record key")
        XCTAssertNil(disk.rawGet(Schema.inkKey("2026-09")), "September migrated before the failure")
        XCTAssertEqual(first.store.getInk(J(#"{"id":"r5","localDay":"2026-10-01"}"#)), tables["2026-10"]!["r5"], "reads still work")
        if let n = disk as? FakeNativeDisk { XCTAssertEqual(n.diag.last?["kind"], .string("ink-schema-2-failed"), "native diag entry") }
        let r = first.store.commit("settings") { draft, _ in
            var st = draft["settings"]!.objectValue!
            st["sound"] = .bool(false)
            draft["settings"] = .object(st)
        }
        XCTAssertTrue(ok(r))
        XCTAssertFalse(r["keys"]!.arrayValue!.contains { $0.stringValue!.hasPrefix("shizi.v2.ink.") }, "no ink key rewritten")
        XCTAssertEqual(disk.rawGet(Schema.inkKey("2026-10")), str(tables["2026-10"]!))
        let second = open(B, disk).store
        XCTAssertEqual(second.inkSchema?["schema"], .number(2))
        XCTAssertEqual(second.inkSchema?["migrated"], .number(1))
        XCTAssertNil(disk.rawGet(Schema.inkKey("2026-10")))
        XCTAssertEqual(disk.rawGet(Schema.inkRecordKey("2026-10", "r5")), str(tables["2026-10"]!["r5"]!))
    }

    // a commit that touches a not-yet-migrated month converts that month in the same transaction
    static func commitConvertsTouchedMonth(_ B: TestBackend) {
        let (disk, tables, _) = legacyDisk(B)
        disk.failWhen { w in w.op == "set" && w.key.hasPrefix("shizi.v2.ink.") ? .generic("generic") : nil }
        let store = open(B, disk).store
        disk.failWhen(nil)
        XCTAssertEqual(store.inkSchema?["migrated"], .number(0))
        let r6 = srec(6, cTian, day: "2026-09-20")
        let r = store.commit("judge-ish") { draft, _ in
            var recs = draft["records"]!.objectValue!
            recs["2026-09"] = .array(recs["2026-09"]!.arrayValue! + [r6])
            draft["records"] = .object(recs)
            try Store.setInk(&draft, r6, inkEntry(5, 1), timeZone: shanghaiTZ)
        }
        XCTAssertTrue(ok(r), str(r))
        XCTAssertNil(disk.rawGet(Schema.inkKey("2026-09")), "September converted inside the commit")
        for id in ["r2", "r3"] { XCTAssertEqual(disk.rawGet(Schema.inkRecordKey("2026-09", id)), str(tables["2026-09"]![id]!)) }
        XCTAssertNotNil(disk.rawGet(Schema.inkRecordKey("2026-09", "r6")))
        XCTAssertEqual(disk.rawGet(Schema.inkKey("2026-10")), str(tables["2026-10"]!), "October untouched (still legacy)")
        XCTAssertEqual(store.inkSchema?["schema"], .number(1))
        let again = open(B, disk).store
        XCTAssertEqual(again.inkSchema?["schema"], .number(2))
        XCTAssertEqual(sortedJSON(again.state["ink"]!), sortedJSON(store.state["ink"]!))
    }

    // judge commit writes only its own ink record (bytes: one record vs the whole month)
    static func judgeWritesOnlyItsOwnRecord(_ B: TestBackend) {
        let disk = B.make()
        let store = open(B, disk).store
        var base = storeBaseline()
        var recsList: [JSValue] = []
        var table = JSObject()
        for i in 0..<60 {
            let rec = srec(10 + i, String(Unicode.Scalar(0x4e00 + i)!), day: "2026-10-01")
            recsList.append(rec)
            table[rec["id"]!.stringValue!] = store.inkFormat == "raw"
                ? InkMath.encodeInkRaw([rawStroke(20, 40 + Double(i)), rawStroke(30, 120, 30, 400), rawStroke(40, 220, 50, 900)]) : inkEntry(16, 7)
        }
        var recs = base["records"]!.objectValue!
        recs["2026-10"] = .array(recsList)
        base["records"] = .object(recs)
        var meta = base["meta"]!.objectValue!
        meta["serial"] = .number(70)
        meta["months"] = J(#"["2026-09","2026-10"]"#)
        base["meta"] = .object(meta)
        var ink = base["ink"]!.objectValue!
        ink["2026-10"] = .object(table)
        base["ink"] = .object(ink)
        XCTAssertTrue(ok(store.seed(.object(base))))
        let rec = srec(71, cYong, day: "2026-10-02")
        let inkV = store.inkFormat == "raw" ? InkMath.encodeInkRaw([rawStroke(20, 40), rawStroke(30, 120, 30, 400), rawStroke(40, 220, 50, 900)]) : inkEntry(16, 7)
        var written: [(String, String)] = []
        disk.failWhen { w in
            if w.op == "set" && w.key.hasPrefix("shizi.v2.ink.") { written.append((w.key, w.value ?? "")) }
            return nil
        }
        let r = store.commit("judge") { draft, _ in
            var recs = draft["records"]!.objectValue!
            recs["2026-10"] = .array(recs["2026-10"]!.arrayValue! + [rec])
            draft["records"] = .object(recs)
            try Store.setInk(&draft, rec, inkV, timeZone: shanghaiTZ)
        }
        disk.failWhen(nil)
        XCTAssertTrue(ok(r))
        XCTAssertEqual(written.map { $0.0 }, [Schema.inkRecordKey("2026-10", "r71")], "exactly one ink key written")
        let after = written.reduce(0) { $0 + UTF16Order.length($1.1) }
        let before = UTF16Order.length(str(store.state["ink"]!["2026-10"]!))
        XCTAssertLessThan(after * 30, before, "one record is a small fraction of the month")
    }

    // judge ink encoding follows the backend (policy P05): native raw points (Ink v4), localStorage v3
    static func judgeInkEncodingFollowsBackend(_ B: TestBackend) throws {
        let disk = B.make()
        let store = open(B, disk).store
        XCTAssertEqual(store.inkFormat, B.native ? Config.policyString("nativeStorage.inkFormat") : Config.policyString("inkFormat"))
        let session = J(#"{"id":"s1","slot":"A","kind":"daily","source":{"view":"home"},"queue":["base:永"],"cursor":0,"items":[],"current":{"phase":"recall","strokes":[],"hints":0,"answerSeen":false},"lastLine":null,"startedAt":1790906400000,"startedDay":"2026-10-02","updatedAt":1790906400000}"#)
        XCTAssertTrue(ok(store.seed(.object(JSObject([("meta", J(#"{"schema":2,"serial":1,"createdAt":1790906400000,"months":[]}"#)), ("records", .object(JSObject())), ("ink", .object(JSObject())),
                                                    ("sched", .object(JSObject())), ("sessions", .object(JSObject([("A", session), ("B", .null), ("lastEnded", .object(JSObject()))])))])))))
        let strokes = [rawStroke(30, 100, 40, 1000), rawStroke(60, 200, 30, 1700)]
        var record: JSValue = .null
        let r = store.commit("write:judge") { draft, ctx in
            let id = try ctx.nextId("r")
            record = JS.obj([("id", .string(id)), ("cardKey", .string("base:" + cYong)), ("char", .string(cYong)), ("sessionId", .string("s1")), ("kind", .string("judged")),
                             ("judgment", .string("correct")), ("at", .number(ctx.now)), ("localDay", .string(try shanghai.localDay(.number(ctx.now)))),
                             ("help", J(#"{"hints":0,"answerSeen":false,"traced":false}"#))])
            var recs = draft["records"]!.objectValue!
            recs["2026-10"] = .array([record])
            draft["records"] = .object(recs)
            try Store.setInk(&draft, record, try InkMath.encodeStoredInk(strokes, policy: Config.policy.objectValue, format: ctx.inkFormat), timeZone: shanghaiTZ)
        }
        XCTAssertTrue(ok(r), str(r))
        let ink = Store.getInk(store.state, record, timeZone: shanghaiTZ)
        if B.native {
            XCTAssertTrue(InkMath.isInkV4(ink), "native: raw points")
            let back = InkMath.decodeInkRaw(ink)!
            XCTAssertEqual(back.count, 2)
            for (i, st) in back.enumerated() {
                for (j, p) in st.enumerated() {
                    XCTAssertTrue(abs(p.x - strokes[i][j].x) <= 0.05 + 1e-9 && abs(p.y - strokes[i][j].y) <= 0.05 + 1e-9, "x / y within 0.1 unit")
                    XCTAssertLessThanOrEqual(abs(p.t! - (strokes[i][j].t! - 1000)), 1, "t within 1 ms")
                }
            }
        } else {
            XCTAssertTrue(InkMath.isInkV3(ink), "localStorage: v3 (capacity)")
        }
        XCTAssertEqual(try InkMath.decodeInk(ink)!.count, 2, "renders either way")
        XCTAssertNotNil(disk.rawGet(Schema.inkRecordKey(String(record["localDay"]!.stringValue!.prefix(7)), record["id"]!.stringValue!)), "one key per record on disk")
    }

    // backup: export groups ink by month (format unchanged), restore of an old (schema 1 era) backup writes one key per record
    static func backupGroupsInkByMonth(_ B: TestBackend) throws {
        let (disk, _, base) = legacyDisk(B)
        let store = open(B, disk).store
        let file = try Backup.buildBackupV2(store.state, now: STORE_NOW)
        XCTAssertEqual(file["version"], .number(2), "backup version unchanged")
        let data = file["data"]!.objectValue!
        XCTAssertTrue(data[Schema.inkKey("2026-09")] != nil && data[Schema.inkKey("2026-10")] != nil, "ink grouped by month in the envelope")
        XCTAssertFalse(data.keys.contains { Schema.isInkRecordKey($0) }, "no one-record keys in backups")
        let fresh = open(B, B.make())
        let report = Backup.inspectBackup(.string(Backup.serializeBackup(.object(file))), dates: shanghai)
        XCTAssertEqual(report["ok"], .bool(true))
        XCTAssertTrue(ok(Backup.restoreFromBackup(fresh.store, report, now: STORE_NOW)))
        XCTAssertEqual(sortedJSON(fresh.store.state["ink"]!), sortedJSON(base["ink"]!))
        XCTAssertNil(fresh.disk.rawGet(Schema.inkKey("2026-09")))
        XCTAssertNotNil(fresh.disk.rawGet(Schema.inkRecordKey("2026-09", "r3")))
        let v4 = InkMath.encodeInkRaw([rawStroke(10, 10), rawStroke(20, 30, 10, 500)])
        XCTAssertTrue(ok(fresh.store.commit("v4") { draft, _ in try Store.setInk(&draft, J(#"{"id":"r2","localDay":"2026-09-15"}"#), v4, timeZone: shanghaiTZ) }))
        let again = Backup.inspectBackup(.string(Backup.serializeBackup(.object(try Backup.buildBackupV2(fresh.store.state, now: STORE_NOW)))), dates: shanghai)
        XCTAssertEqual(again["ok"], .bool(true), str(.object(again)))
        let third = open(B, B.make())
        XCTAssertTrue(ok(Backup.restoreFromBackup(third.store, again, now: STORE_NOW)))
        XCTAssertEqual(third.store.getInk(J(#"{"id":"r2","localDay":"2026-09-15"}"#)), v4)
    }
}

final class InkSchemaLocalTests: XCTestCase {
    let B = TestBackend.local
    func testLocalStorageInkSchema1To2AtLoadEveryLegacyMonthBecomesOneKeyPerRecordIdempotent() { InkSchemaContract.migratesAtLoad(B) }
    func testLocalStorageInkSchemaMigrationFailureMonthRollsBackDiagnosticRecordedNextStartRetries() { InkSchemaContract.migrationFailure(B) }
    func testLocalStorageACommitThatTouchesANotYetMigratedMonthConvertsThatMonth() { InkSchemaContract.commitConvertsTouchedMonth(B) }
    func testLocalStorageJudgeCommitWritesOnlyItsOwnInkRecord() { InkSchemaContract.judgeWritesOnlyItsOwnRecord(B) }
    func testLocalStorageJudgeInkEncodingFollowsTheBackend() throws { try InkSchemaContract.judgeInkEncodingFollowsBackend(B) }
    func testLocalStorageBackupExportGroupsInkByMonthRestoreOfOldBackupWritesOneKeyPerRecord() throws { try InkSchemaContract.backupGroupsInkByMonth(B) }
}

final class InkSchemaNativeTests: XCTestCase {
    let B = TestBackend.native
    func testNativeInkSchema1To2AtLoadEveryLegacyMonthBecomesOneKeyPerRecordIdempotent() { InkSchemaContract.migratesAtLoad(B) }
    func testNativeInkSchemaMigrationFailureMonthRollsBackDiagnosticRecordedNextStartRetries() { InkSchemaContract.migrationFailure(B) }
    func testNativeACommitThatTouchesANotYetMigratedMonthConvertsThatMonth() { InkSchemaContract.commitConvertsTouchedMonth(B) }
    func testNativeJudgeCommitWritesOnlyItsOwnInkRecord() { InkSchemaContract.judgeWritesOnlyItsOwnRecord(B) }
    func testNativeJudgeInkEncodingFollowsTheBackend() throws { try InkSchemaContract.judgeInkEncodingFollowsBackend(B) }
    func testNativeBackupExportGroupsInkByMonthRestoreOfOldBackupWritesOneKeyPerRecord() throws { try InkSchemaContract.backupGroupsInkByMonth(B) }
}
