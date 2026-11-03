import Foundation
import XCTest
@testable import ShiziCore

// ShiziCore Store 的 SQLite 后端（B4.4）：与 App 的 NativeStore（B1）同一份表结构与键 ↔ 行映射；App 里 JS 已经写下的库，Swift 原样能读。
//   · Fixtures/native-rows.json：JS 写下的行（含旧 ink 月键、坏值、路由提示）→ 经 SQLiteKVStore.apply 写进真的 SQLite 文件 →
//     Store 打开：启动报告 / 状态 / status / 迁移与修复后的库，与 JS 在原生替身上读出的逐字节相同；
//   · Store 在 SQLite 上提交 → 重开读回相同；同一组提交在原生替身上写出的行与 SQLite 里的逐字节相同；
//   · 表结构与 App 的 NativeStore.swift 一致（两份 SQL 字串集合相同）。

private func tempDB() -> URL {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("shizicore-sqlite-\(UUID().uuidString)", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("shizi.sqlite")
}

private func sqliteStore(_ url: URL) -> Store {
    let storage = StoreStorage(SQLiteTransport.backend(fileURL: url), now: { STORE_NOW })
    let store = Store(storage: storage, now: { STORE_NOW }, dates: shanghai)
    store.load()
    return store
}

private func rowsObject(_ url: URL) throws -> JSObject {
    let db = SQLiteKVStore(fileURL: url)
    try db.open()
    defer { db.close() }
    return JSObject(try db.loadAll().map { ($0.0, JSValue.string($0.1)) })
}

final class SQLiteStoreTests: XCTestCase {
    func testAppWrittenDatabaseReadsTheSameAsJS() throws {
        let cases = try loadFixture("native-rows")["cases"]!.arrayValue!
        XCTAssertEqual(cases.count, 8)
        for c in cases {
            let label = c["label"]!.stringValue!
            let url = tempDB()
            let db = SQLiteKVStore(fileURL: url)
            try db.open()
            let rows = c["rows"]!.objectValue!.entries.sorted { UTF16Order.less($0.key, $1.key) }
            try db.apply(rows.map { SQLiteStoreOp(key: $0.key, value: $0.value.stringValue!, sum: NativeChecksum.checksum($0.value.stringValue!)) })
            db.close()
            let store = sqliteStore(url)
            XCTAssertEqual(str(.object(store.state)), str(c["state"]!), "\(label): state")
            XCTAssertEqual(store.serial, c["serial"]!.numberValue!, label)
            XCTAssertEqual(str(.object(store.status)), str(c["status"]!), "\(label): status (repair, ink schema, usage)")
            XCTAssertEqual(str(.object(try rowsObject(url))), str(c["disk"]!), "\(label): database after repair / ink schema migration")
            XCTAssertEqual(c["load"]!["available"], .bool(true))
        }
    }

    func testStoreOnSQLiteCommitsReopensAndMatchesTheNativeFake() throws {
        let url = tempDB()
        let store = sqliteStore(url)
        XCTAssertEqual(store.backendInfo["kind"], .string("native"))
        XCTAssertEqual(store.inkFormat, Config.policyString("nativeStorage.inkFormat"))
        XCTAssertTrue(ok(store.seed(.object(storeBaseline()))))
        XCTAssertTrue(ok(store.commit("judge", judgeMutation(cDa))))
        XCTAssertTrue(ok(Backup.clearAllRecords(store, now: STORE_NOW)))
        XCTAssertTrue(ok(Backup.undoFromSafety(store)))
        let reopened = sqliteStore(url)
        XCTAssertEqual(str(.object(reopened.state)), str(.object(store.state)), "reopen reads back the same state")
        let fake = freshStore(.native)
        XCTAssertTrue(ok(fake.store.seed(.object(storeBaseline()))))
        XCTAssertTrue(ok(fake.store.commit("judge", judgeMutation(cDa))))
        XCTAssertTrue(ok(Backup.clearAllRecords(fake.store, now: STORE_NOW)))
        XCTAssertTrue(ok(Backup.undoFromSafety(fake.store)))
        XCTAssertEqual(str(.object(try rowsObject(url))), str(.object(diskObject(fake.disk))), "same rows as the native fake (= what JS writes)")
    }

    func testSQLiteSchemaMatchesTheAppNativeStore() throws {
        let app = try readRepoFile("ios/ShiziApp/ShiziApp/NativeStore.swift")
        let core = try readRepoFile("ios/ShiziCore/Sources/ShiziCore/Store/SQLiteKVStore.swift")
        func sqlStrings(_ s: String) -> Set<String> {
            var out = Set<String>()
            let re = try! NSRegularExpression(pattern: #""((?:CREATE|INSERT|SELECT|DELETE|PRAGMA|BEGIN|COMMIT)[^"]*)""#)
            for m in re.matches(in: s, range: NSRange(s.startIndex..., in: s)) { out.insert(String(s[Range(m.range(at: 1), in: s)!])) }
            return out
        }
        let a = sqlStrings(app), b = sqlStrings(core)
        XCTAssertGreaterThan(a.count, 10)
        XCTAssertEqual(a, b, "ShiziCore SQLiteKVStore must keep the App NativeStore tables / SQL")
        XCTAssertTrue(core.contains("static let schemaVersion: Int32 = 2") && app.contains("static let schemaVersion: Int32 = 2"))
    }
}
