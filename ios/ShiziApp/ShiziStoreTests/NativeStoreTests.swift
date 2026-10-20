import SQLite3
import XCTest

// B1 原生数据层单测（只测 NativeStore.swift：表结构、事务、校验、迁移标记；不起 WebView）。
// 运行：xcodebuild test -project ios/ShiziApp/ShiziApp.xcodeproj -scheme ShiziStoreTests \
//         -destination 'platform=iOS Simulator,id=<udid>' CODE_SIGNING_ALLOWED=NO
// 校验和 / 摘要向量与 test/store/native-store.test.mjs 相同（JS 与 Swift 必须同口径）。
final class NativeStoreTests: XCTestCase {
    private var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("shizi-store-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    private func makeStore(_ name: String = "t.sqlite") throws -> NativeStore {
        let store = NativeStore(fileURL: dir.appendingPathComponent(name))
        try store.open()
        return store
    }

    private func op(_ key: String, _ value: String?) -> NativeStoreOp {
        guard var v = value else { return NativeStoreOp(key: key, value: nil, sum: nil) }
        return NativeStoreOp(key: key, value: v, sum: NativeStore.checksum(&v))
    }

    private func sum(_ s: String) -> String {
        var v = s
        return NativeStore.checksum(&v)
    }

    // MARK: 口径

    func testChecksumVectorsMatchJS() {
        XCTAssertEqual(sum(""), "0:811c9dc5")
        XCTAssertEqual(sum("a"), "1:e40c292c")
        XCTAssertEqual(sum("shizi"), "5:5ef7173c")
        XCTAssertEqual(sum("拾字"), "6:85111e4b")
        XCTAssertEqual(sum(#"{"k":"值"}"#), "11:f2384e21")
        XCTAssertEqual(sum("😀"), "4:33a29608")
        XCTAssertEqual(NativeStore.digest([("shizi.v2.meta", #"{"schema":2}"#), ("shizi.v2.records.2026-09", "[]")]).digest, "2:14:6e6d7a67")
        XCTAssertEqual(NativeStore.digest([]).digest, "0:0:811c9dc5")
    }

    func testSlotRoutingIsABijection() {
        let keys = [
            "shizi.v2.records.2026-09", "shizi.v2.ink.2026-10", "shizi.v2.sched", "shizi.v2.sessions", "shizi.v2.settings",
            "shizi.v2.meta", "shizi.v2.custom", "shizi.v2.wordOff", "shizi.v2.photos", "shizi.v2.legacy", "shizi.v2.backupMeta",
            "shizi.v2.funnel", "shizi.v2.safety", "shizi.v2.route", "shizi.corrupt.shizi.v2.sched", "shizi.memory.v1",
            "shizi.v2.records.bogus", "shizi.v2.unknownThing",
        ]
        for key in keys {
            let slot = NativeStoreSlot.slot(for: key)
            XCTAssertNotNil(slot, key)
            XCTAssertEqual(slot?.key, key, key)
        }
        XCTAssertEqual(NativeStoreSlot.slot(for: "shizi.v2.records.2026-09"), .monthly(table: "records", month: "2026-09"))
        XCTAssertEqual(NativeStoreSlot.slot(for: "shizi.v2.records.bogus"), .aux(key: "shizi.v2.records.bogus"))
        XCTAssertNil(NativeStoreSlot.slot(for: "other.key"))
    }

    // MARK: 结构与配置

    func testSchemaAndPragmas() throws {
        let store = try makeStore()
        XCTAssertEqual(store.userVersion, NativeStore.schemaVersion)
        var mode: String?
        var sync: Int32 = -1
        var stmt: OpaquePointer?
        sqlite3_prepare_v2(store.db, "PRAGMA journal_mode", -1, &stmt, nil)
        if sqlite3_step(stmt) == SQLITE_ROW { mode = String(cString: sqlite3_column_text(stmt, 0)) }
        sqlite3_finalize(stmt)
        sqlite3_prepare_v2(store.db, "PRAGMA synchronous", -1, &stmt, nil)
        if sqlite3_step(stmt) == SQLITE_ROW { sync = sqlite3_column_int(stmt, 0) }
        sqlite3_finalize(stmt)
        XCTAssertEqual(mode, "wal")
        XCTAssertEqual(sync, 2, "synchronous=FULL")
        XCTAssertNotNil(try store.meta("createdAt"))
    }

    func testNewerSchemaIsRefused() throws {
        let store = try makeStore()
        try store.exec("PRAGMA user_version = \(NativeStore.schemaVersion + 1)")
        store.close()
        let again = NativeStore(fileURL: dir.appendingPathComponent("t.sqlite"))
        XCTAssertThrowsError(try again.open()) { error in
            XCTAssertEqual((error as? NativeStoreError)?.code, "E_SCHEMA")
        }
    }

    // MARK: 读写

    func testApplyRoundTripAcrossTablesAndReopen() throws {
        let store = try makeStore()
        let rows: [(String, String)] = [
            ("shizi.v2.records.2026-09", #"[{"id":"r1","char":"拾"}]"#),
            ("shizi.v2.ink.2026-09", #"{"r1":{"v":3,"c":345,"s":["AAAA"]}}"#),
            ("shizi.v2.sched", #"{"base:拾":{"due":"2026-09-18"}}"#),
            ("shizi.v2.sessions", #"{"A":null,"B":null,"lastEnded":{}}"#),
            ("shizi.v2.settings", #"{"sound":true}"#),
            ("shizi.v2.meta", #"{"schema":2,"serial":1}"#),
            ("shizi.v2.route", #"{"v":1}"#),
            ("shizi.corrupt.shizi.v2.custom", "not json"),
            ("shizi.memory.v1", ""),
        ]
        XCTAssertEqual(try store.apply(rows.map { op($0.0, $0.1) }), rows.count)
        let loaded = try store.loadAll()
        XCTAssertEqual(loaded.map { $0.0 }, rows.map { $0.0 }.sorted { $0.utf16.lexicographicallyPrecedes($1.utf16) })
        for (key, value) in rows { XCTAssertEqual(try store.value(for: key), value, key) }
        store.close()
        let again = try makeStore()
        XCTAssertEqual(try again.loadAll().count, rows.count)
        XCTAssertEqual(try again.value(for: "shizi.v2.ink.2026-09"), rows[1].1)
        // 删除
        try again.apply([op("shizi.v2.route", nil), op("shizi.v2.records.2026-09", nil)])
        XCTAssertNil(try again.value(for: "shizi.v2.route"))
        XCTAssertNil(try again.value(for: "shizi.v2.records.2026-09"))
        XCTAssertEqual(try again.loadAll().count, rows.count - 2)
    }

    func testApplyIsAtomic() throws {
        let store = try makeStore()
        try store.apply([op("shizi.v2.settings", #"{"sound":true}"#)])
        // 第二项校验和不符：整笔回滚，第一项也不落盘
        let bad = NativeStoreOp(key: "shizi.v2.sched", value: "{}", sum: "2:00000000")
        XCTAssertThrowsError(try store.apply([op("shizi.v2.settings", #"{"sound":false}"#), bad])) { error in
            XCTAssertEqual((error as? NativeStoreError)?.code, "E_VERIFY")
            XCTAssertEqual((error as? NativeStoreError)?.key, "shizi.v2.sched")
        }
        XCTAssertEqual(try store.value(for: "shizi.v2.settings"), #"{"sound":true}"#)
        XCTAssertNil(try store.value(for: "shizi.v2.sched"))
        // 非本 App 的键：整笔拒绝
        XCTAssertThrowsError(try store.apply([op("shizi.v2.settings", "{}"), op("evil", "{}")])) { error in
            XCTAssertEqual((error as? NativeStoreError)?.code, "E_BAD_KEY")
        }
        XCTAssertEqual(try store.value(for: "shizi.v2.settings"), #"{"sound":true}"#)
    }

    func testLargeValues() throws {
        let store = try makeStore()
        let big = "{\"x\":\"" + String(repeating: "拾字ab", count: 300_000) + "\"}"
        try store.apply([op("shizi.v2.ink.2026-10", big)])
        XCTAssertEqual(try store.value(for: "shizi.v2.ink.2026-10"), big)
    }

    // MARK: 迁移标记

    func testImportCommitAndRefuseReimport() throws {
        let store = try makeStore()
        try store.apply([op("shizi.v2.settings", "{}")]) // 迁移前的残留（例如上次中断）：导入时清空
        let rows: [(String, String)] = [("shizi.v2.meta", #"{"schema":2}"#), ("shizi.v2.records.2026-09", "[]")]
        let digest = NativeStore.digest(rows).digest
        XCTAssertEqual(digest, "2:14:6e6d7a67")
        let imported = try store.importRows(rows.map { op($0.0, $0.1) }, count: 2, digest: digest, source: "localStorage")
        XCTAssertEqual(imported.state, "imported")
        XCTAssertNil(try store.value(for: "shizi.v2.settings"), "data tables wiped before import")
        XCTAssertEqual(try store.loadAll().count, 2)
        XCTAssertThrowsError(try store.commitMigration(count: 2, digest: "2:14:00000000"))
        let done = try store.commitMigration(count: 2, digest: digest)
        XCTAssertEqual(done.state, "done")
        XCTAssertNotNil(done.doneAt)
        XCTAssertEqual(try store.commitMigration(count: 2, digest: digest).state, "done", "idempotent")
        XCTAssertThrowsError(try store.importRows([], count: 0, digest: "0:0:811c9dc5", source: "localStorage")) { error in
            XCTAssertEqual((error as? NativeStoreError)?.code, "E_MIGRATION")
        }
        XCTAssertEqual(try store.loadAll().count, 2, "done database untouched")
    }

    func testImportDigestMismatchRollsBack() throws {
        let store = try makeStore()
        try store.apply([op("shizi.v2.settings", "{}")])
        let rows = [op("shizi.v2.meta", "{}")]
        XCTAssertThrowsError(try store.importRows(rows, count: 1, digest: "1:2:deadbeef", source: "localStorage")) { error in
            XCTAssertEqual((error as? NativeStoreError)?.code, "E_VERIFY")
        }
        XCTAssertEqual(try store.value(for: "shizi.v2.settings"), "{}", "rolled back: previous rows still there")
        XCTAssertNil(try store.migration())
    }

    /// 耗时参考（打印，不做严格断言）：一次「判断」形状的事务（当月 records 16KB + 当月 ink 52KB + sched 73KB，带校验和与读回比对，
    /// synchronous=FULL），以及一次小写入（settings）。Debug / Release 各跑一次看原生侧的份额（01 §4.1 记录）。
    func testWriteTimingReference() throws {
        let store = try makeStore()
        let records = "[" + String(repeating: #"{"id":"r1","cardKey":"base:拾","char":"拾","kind":"judged"},"#, count: 270) + "1]"
        let ink = "{" + String(repeating: #""r1":{"v":3,"c":345,"s":["AAAABBBBCCCCDDDDEEEE"]},"#, count: 1050) + #""x":1}"#
        let sched = "{" + String(repeating: #""base:拾":{"fsrs":{"s":1,"d":5},"due":"2026-09-18","lastJudgedAt":1},"#, count: 900) + #""x":1}"#
        var judge: [Double] = []
        var small: [Double] = []
        for i in 0..<30 {
            let t0 = CFAbsoluteTimeGetCurrent()
            try store.apply([op("shizi.v2.ink.2026-10", ink + " \(i)"), op("shizi.v2.records.2026-10", records + " \(i)"), op("shizi.v2.sched", sched + " \(i)")])
            judge.append((CFAbsoluteTimeGetCurrent() - t0) * 1000)
            let t1 = CFAbsoluteTimeGetCurrent()
            try store.apply([op("shizi.v2.settings", #"{"sound":\#(i % 2 == 0)}"#)])
            small.append((CFAbsoluteTimeGetCurrent() - t1) * 1000)
        }
        let p50 = { (xs: [Double]) -> Double in xs.sorted()[xs.count / 2] }
        print(String(format: "[shizi] native apply timing: judge-shaped (%d bytes) p50 %.2fms max %.2fms; small p50 %.2fms max %.2fms",
                     records.utf8.count + ink.utf8.count + sched.utf8.count, p50(judge), judge.max() ?? 0, p50(small), small.max() ?? 0))
        XCTAssertLessThan(p50(judge), 500)
    }

    func testStatsAndDiag() throws {
        let store = try makeStore()
        try store.apply([op("shizi.v2.records.2026-09", "[1]"), op("shizi.v2.records.2026-10", "[2]"), op("shizi.v2.sched", "{}")])
        let stats = try store.stats()
        XCTAssertEqual(stats.rows, 3)
        XCTAssertEqual(stats.tables["records"]?.rows, 2)
        XCTAssertGreaterThan(stats.fileBytes, 0)
        try store.appendDiag(["kind": "migration-failed", "stage": "verify"])
        XCTAssertEqual(try store.diagEntries().count, 1)
        for i in 0..<30 { try store.appendDiag(["i": i]) }
        XCTAssertEqual(try store.diagEntries().count, NativeStore.diagLimit)
    }
}
