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
            "shizi.v2.ink.2026-10.r12", "shizi.v2.ink.2026-10.r0", "shizi.v2.ink.2026-10.s1", "shizi.v2.ink.2026-10.", "shizi.v2.ink.2026-13.r1",
        ]
        for key in keys {
            let slot = NativeStoreSlot.slot(for: key)
            XCTAssertNotNil(slot, key)
            XCTAssertEqual(slot?.key, key, key)
        }
        XCTAssertEqual(NativeStoreSlot.slot(for: "shizi.v2.records.2026-09"), .monthly(table: "records", month: "2026-09"))
        XCTAssertEqual(NativeStoreSlot.slot(for: "shizi.v2.records.bogus"), .aux(key: "shizi.v2.records.bogus"))
        // B2.3 schema 2：单条墨迹键 → ink_records 一行；不合格的 id / 月份落 aux（键 ↔ 行仍一一对应）
        XCTAssertEqual(NativeStoreSlot.slot(for: "shizi.v2.ink.2026-10.r12"), .inkRecord(month: "2026-10", id: "r12"))
        XCTAssertEqual(NativeStoreSlot.slot(for: "shizi.v2.ink.2026-10"), .monthly(table: "ink", month: "2026-10"))
        XCTAssertEqual(NativeStoreSlot.slot(for: "shizi.v2.ink.2026-10.r0"), .aux(key: "shizi.v2.ink.2026-10.r0"))
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

    // MARK: schema 2（B2.3：墨迹每条一行）

    func testInkRecordRowsRoundTripAndLoadSorted() throws {
        let store = try makeStore()
        XCTAssertEqual(store.userVersion, 2)
        let rows: [(String, String)] = [
            ("shizi.v2.ink.2026-10.r12", #"{"v":4,"c":345,"r":["A8gBkAMALiIIsQKOO1w="],"g":[0]}"#),
            ("shizi.v2.ink.2026-10.r3", #"{"v":3,"c":345,"s":["AAAA"]}"#),
            ("shizi.v2.ink.2026-09", #"{"r1":{"v":3,"c":345,"s":["AAAA"]}}"#),
            ("shizi.v2.ink.2026-09.r2", #"{"v":3,"c":345,"s":["BBBB"]}"#),
        ]
        try store.apply(rows.map { op($0.0, $0.1) })
        XCTAssertEqual(try store.loadAll().map { $0.0 }, rows.map { $0.0 }.sorted { $0.utf16.lexicographicallyPrecedes($1.utf16) })
        for (key, value) in rows { XCTAssertEqual(try store.value(for: key), value, key) }
        XCTAssertEqual(try store.stats().tables["ink_records"]?.rows, 3)
        XCTAssertEqual(try store.stats().tables["ink"]?.rows, 1, "legacy month row stays readable")
        try store.apply([op("shizi.v2.ink.2026-10.r12", nil), op("shizi.v2.ink.2026-09", nil)])
        XCTAssertNil(try store.value(for: "shizi.v2.ink.2026-10.r12"))
        XCTAssertEqual(try store.loadAll().count, 2)
    }

    /// 把一个 schema 2 的库退回 schema 1 的样子（没有 ink_records、user_version = 1），模拟 B2.3 之前的库。
    private func makeSchema1Store(rows: [(String, String)]) throws {
        let store = try makeStore()
        try store.apply(rows.map { op($0.0, $0.1) })
        try store.exec("DROP TABLE ink_records")
        try store.exec("PRAGMA user_version = 1")
        store.close()
    }

    func testUpgradeFromSchema1KeepsEveryRowAndIsReentrant() throws {
        let legacy: [(String, String)] = [
            ("shizi.v2.ink.2026-09", #"{"r1":{"v":3,"c":345,"s":["AAAA"]},"r2":{"v":2,"c":345,"s":[[1,2,3]]}}"#),
            ("shizi.v2.records.2026-09", #"[{"id":"r1"}]"#),
            ("shizi.v2.meta", #"{"schema":2,"serial":2}"#),
        ]
        try makeSchema1Store(rows: legacy)
        let before = NativeStore.digest(legacy.sorted { $0.0.utf16.lexicographicallyPrecedes($1.0.utf16) })
        let store = try makeStore()
        XCTAssertEqual(store.userVersion, 2)
        XCTAssertNotNil(try store.meta("schema2At"))
        XCTAssertEqual(try store.digestOfRows().digest, before.digest, "every row byte-equal after the structural upgrade")
        // 旧月行照常可读可写；新的单条行可写（JS store 启动时把旧月行拆成单条行，store.js migrateInkSchema）
        try store.apply([op("shizi.v2.ink.2026-09.r1", #"{"v":3,"c":345,"s":["AAAA"]}"#), op("shizi.v2.ink.2026-09", nil)])
        XCTAssertEqual(try store.stats().tables["ink"]?.rows, 0)
        store.close()
        // 再开一次：已是 schema 2，什么都不做
        let again = try makeStore()
        XCTAssertEqual(again.userVersion, 2)
        XCTAssertEqual(try again.loadAll().count, 3)
    }

    func testUpgradeFailureRollsBackKeepsDataAndRecordsADiagnostic() throws {
        let legacy: [(String, String)] = [("shizi.v2.ink.2026-09", #"{"r1":{"v":3,"c":345,"s":["AAAA"]}}"#), ("shizi.v2.meta", "{}")]
        try makeSchema1Store(rows: legacy)
        let broken = NativeStore(fileURL: dir.appendingPathComponent("t.sqlite"))
        broken.failUpgrade = 2
        XCTAssertThrowsError(try broken.open()) { error in
            XCTAssertEqual((error as? NativeStoreError)?.code, "E_SQLITE")
        }
        XCTAssertNil(broken.db, "not opened")
        // 下次启动：升级重做成功，数据一字不少，诊断里有上次失败的记录
        let store = try makeStore()
        XCTAssertEqual(store.userVersion, 2)
        XCTAssertEqual(try store.loadAll().map { $0.1 }, legacy.map { $0.1 })
        let diag = try store.diagEntries().compactMap { $0 as? [String: Any] }
        XCTAssertEqual(diag.last?["kind"] as? String, "schema-upgrade-failed")
        XCTAssertEqual((diag.last?["from"] as? NSNumber)?.intValue, 1)
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
        // B2.3 schema 2：同样形状的判断，但墨迹只写这一条（Ink v4 一份约 1.5KB UTF-8，120Hz 常用字实测）
        let one = #"{"v":4,"c":345,"r":[""# + String(repeating: "AbCd", count: 360) + #""],"g":[0]}"#
        var judge2: [Double] = []
        for i in 0..<30 {
            let t0 = CFAbsoluteTimeGetCurrent()
            try store.apply([op("shizi.v2.ink.2026-10.r\(100 + i)", one), op("shizi.v2.records.2026-10", records + " \(i)"), op("shizi.v2.sched", sched + " \(i)")])
            judge2.append((CFAbsoluteTimeGetCurrent() - t0) * 1000)
        }
        let p50 = { (xs: [Double]) -> Double in xs.sorted()[xs.count / 2] }
        print(String(format: "[shizi] native apply timing: judge-shaped (%d bytes) p50 %.2fms max %.2fms; small p50 %.2fms max %.2fms",
                     records.utf8.count + ink.utf8.count + sched.utf8.count, p50(judge), judge.max() ?? 0, p50(small), small.max() ?? 0))
        print(String(format: "[shizi] native apply timing (B2.3 schema 2): judge-shaped with one ink row (%d bytes; ink %d → %d bytes) p50 %.2fms max %.2fms",
                     records.utf8.count + one.utf8.count + sched.utf8.count, ink.utf8.count, one.utf8.count, p50(judge2), judge2.max() ?? 0))
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

    // MARK: B4.9b 新装的迁移标记（LegacyStorage.swift）

    /// 在 lib/WebKit/… 下造一个 WKWebView 风格的 localstorage.sqlite3，里面放给定的键。
    @discardableResult
    private func makeLocalStorage(_ lib: URL, keys: [String], layout: String = "com.eimaa.shizi/WebsiteData/Default/h/h/LocalStorage") throws -> URL {
        let folder = lib.appendingPathComponent("WebKit/" + layout, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent("localstorage.sqlite3")
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open(file.path, &db), SQLITE_OK)
        defer { sqlite3_close(db) }
        XCTAssertEqual(sqlite3_exec(db, "CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB NOT NULL ON CONFLICT FAIL)", nil, nil, nil), SQLITE_OK)
        for k in keys { XCTAssertEqual(sqlite3_exec(db, "INSERT INTO ItemTable VALUES ('\(k)', X'7B7D')", nil, nil, nil), SQLITE_OK) }
        return file
    }

    private func lib(_ name: String) throws -> URL {
        let l = dir.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: l, withIntermediateDirectories: true)
        return l
    }

    /// 新装：库里没标记没行、WebKit 目录不存在 → 原生记 done；字段与 JS 迁空 localStorage 的走法（import 0 行 → commitMigration）一致。
    func testFreshInstallIsMarkedDoneNatively() throws {
        let store = try makeStore()
        XCTAssertTrue(store.settleMigrationForLaunch { LegacyStorageProbe.probe(libraryURL: try! self.lib("fresh")) })
        let m = try XCTUnwrap(store.migration())
        XCTAssertEqual(m.state, "done")
        XCTAssertEqual(m.count, 0)
        XCTAssertEqual(m.digest, "0:0:811c9dc5")
        XCTAssertEqual(m.source, "localStorage")
        XCTAssertNotNil(m.doneAt)
        // 与 JS 的走法（同样的 op 序列）结果逐字段相同（除时间）
        let js = try makeStore("js.sqlite")
        _ = try js.importRows([], count: 0, digest: NativeStore.digest([]).digest, source: "localStorage")
        let jm = try js.commitMigration(count: 0, digest: NativeStore.digest([]).digest)
        XCTAssertEqual([m.state, m.digest, m.source, "\(m.count)"], [jm.state, jm.digest, jm.source, "\(jm.count)"])
        XCTAssertEqual(Set(m.dictionary.keys), Set(jm.dictionary.keys))
        // 再来一次：已 done，幂等
        XCTAssertTrue(store.settleMigrationForLaunch { .present })
    }

    /// 旧版升级：旧 localStorage 里有 shizi.* 键 → 不动库，仍 false（交 WebEngine 去迁）。
    func testLegacyPresentStaysOnWebEngine() throws {
        let store = try makeStore()
        let l = try lib("legacy")
        try makeLocalStorage(l, keys: ["shizi.v2.meta", "other"])
        XCTAssertEqual(LegacyStorageProbe.probe(libraryURL: l), .present)
        XCTAssertFalse(store.settleMigrationForLaunch { LegacyStorageProbe.probe(libraryURL: l) })
        XCTAssertNil(try store.migration(), "没有写任何标记")
        // 旧布局（WebsiteData/LocalStorage/<origin>.localstorage）同样认
        let l2 = try lib("legacy2")
        let folder = l2.appendingPathComponent("WebKit/WebsiteData/LocalStorage", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: try makeLocalStorage(l, keys: [], layout: "tmp/LocalStorage").deletingLastPathComponent().appendingPathComponent("localstorage.sqlite3"), to: folder.appendingPathComponent("shizi-resource_app_0.localstorage"))
        XCTAssertEqual(LegacyStorageProbe.probe(libraryURL: l2), .none, "空的旧布局文件：没有 shizi 键")
        // WKWebView 建过库但里面没有 shizi.* 键 → 没有
        let l3 = try lib("empty-ls")
        try makeLocalStorage(l3, keys: ["unrelated"])
        XCTAssertEqual(LegacyStorageProbe.probe(libraryURL: l3), .none)
    }

    /// 已 done：什么也不做；done 之外的状态（imported）、库里已有行但没标记 → false。
    func testAlreadyDoneAndHalfDoneStates() throws {
        let done = try makeStore("done.sqlite")
        _ = try done.importRows([], count: 0, digest: NativeStore.digest([]).digest, source: "localStorage")
        _ = try done.commitMigration(count: 0, digest: NativeStore.digest([]).digest)
        let before = try XCTUnwrap(done.migration())
        XCTAssertTrue(done.settleMigrationForLaunch { XCTFail("done 不该再判旧数据"); return .none })
        XCTAssertEqual(try done.migration(), before)

        let imported = try makeStore("imported.sqlite")
        _ = try imported.importRows([], count: 0, digest: NativeStore.digest([]).digest, source: "localStorage")
        XCTAssertFalse(imported.settleMigrationForLaunch { .none })
        XCTAssertEqual(try imported.migration()?.state, "imported")

        let rows = try makeStore("rows.sqlite")
        try rows.apply([op("shizi.v2.records.2026-09", "[1]")])
        XCTAssertFalse(rows.settleMigrationForLaunch { .none }, "有行没标记：不碰")
        XCTAssertNil(try rows.migration())
        XCTAssertEqual(try rows.digestOfRows().count, 1)
    }

    /// 读不出：库打不开 → 桥层返回 false（这里测 NativeStore 层：未打开抛错被吞成 false）；旧 localStorage 库读不出 / 形状没见过 → unsure → false。
    func testUnreadableStoresAreTreatedAsPresent() throws {
        let closed = NativeStore(fileURL: dir.appendingPathComponent("never-opened.sqlite"))
        XCTAssertFalse(closed.settleMigrationForLaunch { .none })

        let store = try makeStore()
        let l = try lib("garbage")
        let file = try makeLocalStorage(l, keys: [])
        try Data("not a sqlite file at all, padded to look like one........".utf8).write(to: file)
        XCTAssertEqual(LegacyStorageProbe.probe(libraryURL: l), .unsure)
        XCTAssertFalse(store.settleMigrationForLaunch { LegacyStorageProbe.probe(libraryURL: l) })
        XCTAssertNil(try store.migration())

        let l2 = try lib("odd-shape")
        let folder = l2.appendingPathComponent("WebKit/x/LocalStorage", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try Data("?".utf8).write(to: folder.appendingPathComponent("mystery.bin"))
        XCTAssertEqual(LegacyStorageProbe.probe(libraryURL: l2), .unsure)

        // 没有 ItemTable 的 sqlite 文件 → unsure
        let l3 = try lib("no-table")
        let f3 = try makeLocalStorage(l3, keys: [])
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open(f3.path, &db), SQLITE_OK)
        sqlite3_exec(db, "DROP TABLE ItemTable", nil, nil, nil)
        sqlite3_close(db)
        XCTAssertEqual(LegacyStorageProbe.probe(libraryURL: l3), .unsure)
    }
}
