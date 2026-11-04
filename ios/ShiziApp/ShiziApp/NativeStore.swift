import Foundation
import SQLite3

// B1 原生数据层（D26 / D67；01-架构设计 §4.1）：拾字的全部持久数据存在 App 自己的 SQLite 库里（系统自带 libsqlite3，不引第三方库）。
//
// 这一层只认「键 → JSON 字串」：键与 JS 侧 store 的 v2 键一一对应，值是 store 序列化好的原始字串，
// 原样存、原样取，原生不解析业务形状（规则在 JS，B4 前不在 Swift 重写）。键按数据形状分表：
//   records(month)   shizi.v2.records.<YYYY-MM>    每月一行（当月 Record[] 或折叠对象）
//   ink_records(month, id)  shizi.v2.ink.<YYYY-MM>.<recordId>  每条墨迹一行（schema 2，B2.3：一次判断只写它自己那一行）
//   ink(month)       shizi.v2.ink.<YYYY-MM>        schema 1 的旧月键（{recordId: Ink}），只剩没迁完的旧数据；JS store 启动时逐月迁成单条行
//   sched / sessions / settings                    各一行（id = 1）
//   docs(name)       shizi.v2.<meta|custom|wordOff|photos|legacy|backupMeta|funnel|safety>
//   aux(key)         其余 shizi.* 键（路由提示 shizi.v2.route、隔离值 shizi.corrupt.*、v1 旧键等），原样保留
//   store_meta       库自身的状态：迁移标记、创建时间、诊断
// 版本号用 PRAGMA user_version（当前 2）；升级在 migrateSchema() 里逐级写（每级一个事务，做完那一级才改 user_version），
// 库比 App 新时拒绝打开（E_SCHEMA）。升级失败：事务回滚（库停在上一级，数据不动），记一条诊断，打不开（JS 侧进阻断页，下次启动重试）。
//
// 写入：apply(ops) 一次一个 SQLite 事务（BEGIN IMMEDIATE … COMMIT），WAL + synchronous=FULL——COMMIT 返回即已落盘（含掉电）。
// 每个值带 JS 算的校验和（UTF-8 字节数 + FNV-1a 32，见 checksum）：入库前核对收到的字串、写后在同一事务里读回逐字节比对，
// 任一不符整笔回滚（E_VERIFY）。这就是 localStorage 时代「逐键读回比对」在原生侧的等价物，且是原子的。
//
// 错误码（桥返回给 JS 的映射）：
//   E_FULL 磁盘满（JS 当作配额错误，走预算回收）  E_IO 读写失败  E_BUSY 库被占用  E_CORRUPT 库损坏  E_SQLITE 其他 SQLite 错误
//   E_VERIFY 校验不符（已回滚）  E_BAD_REQUEST 请求格式错  E_BAD_KEY 键不是 shizi.*  E_SCHEMA 库版本比 App 新
//   E_MIGRATION 迁移状态不允许这一步（例如已完成后再导入）  E_UNAVAILABLE 库打不开
// 线程：NativeStore 不加锁，只能在一个串行队列上用（NativeStoreBridge.queue；XCTest 在测试线程上直接用）。

struct NativeStoreError: Error, CustomStringConvertible {
    let code: String
    let message: String
    var key: String?

    init(_ code: String, _ message: String, key: String? = nil) {
        self.code = code
        self.message = message
        self.key = key
    }

    var description: String { "\(code): \(message)" }

    static func sqlite(_ db: OpaquePointer?, _ rc: Int32, _ what: String, key: String? = nil) -> NativeStoreError {
        let code: String
        switch rc & 0xff {
        case SQLITE_FULL:
            code = "E_FULL"
        case SQLITE_IOERR, SQLITE_CANTOPEN, SQLITE_PERM, SQLITE_READONLY, SQLITE_AUTH, SQLITE_NOLFS:
            code = "E_IO"
        case SQLITE_BUSY, SQLITE_LOCKED:
            code = "E_BUSY"
        case SQLITE_CORRUPT, SQLITE_NOTADB:
            code = "E_CORRUPT"
        default:
            code = "E_SQLITE"
        }
        let detail = db.map { String(cString: sqlite3_errmsg($0)) } ?? "no database"
        return NativeStoreError(code, "\(what): \(detail) (rc=\(rc))", key: key)
    }
}

/// 一个键落在哪张表、哪一行。键 ↔ 行一一对应（key(for:) 是 slot(for:) 的逆）。
enum NativeStoreSlot: Equatable {
    case monthly(table: String, month: String)
    /// schema 2：一条墨迹一行（B2.3）。
    case inkRecord(month: String, id: String)
    case single(table: String)
    case doc(name: String)
    case aux(key: String)

    static let v2Prefix = "shizi.v2."
    static let singleTables: Set<String> = ["sched", "sessions", "settings"]
    static let docNames: Set<String> = ["meta", "custom", "wordOff", "photos", "legacy", "backupMeta", "funnel", "safety"]
    static let maxKeyLength = 512

    /// 记录 id：r + 不以 0 开头的数字（与 JS schema isRecordId 同口径）。
    static func isRecordId(_ s: Substring) -> Bool {
        let u = Array(s.utf8)
        guard u.count >= 2, u.count <= 20, u[0] == UInt8(ascii: "r"), u[1] != UInt8(ascii: "0") else { return false }
        return u.dropFirst().allSatisfy { $0 >= UInt8(ascii: "0") && $0 <= UInt8(ascii: "9") }
    }

    static func isMonth(_ s: Substring) -> Bool {
        let u = Array(s.utf8)
        guard u.count == 7, u[4] == UInt8(ascii: "-") else { return false }
        for (i, c) in u.enumerated() where i != 4 {
            guard c >= UInt8(ascii: "0"), c <= UInt8(ascii: "9") else { return false }
        }
        return true
    }

    /// nil = 不是本 App 的键（只收 shizi.*）。
    static func slot(for key: String) -> NativeStoreSlot? {
        guard key.hasPrefix("shizi."), key.utf8.count <= maxKeyLength, !key.contains("\u{0}") else { return nil }
        if key.hasPrefix(v2Prefix) {
            let rest = key.dropFirst(v2Prefix.count)
            for table in ["records", "ink"] {
                let p = table + "."
                if rest.hasPrefix(p) {
                    let month = rest.dropFirst(p.count)
                    if isMonth(month) { return .monthly(table: table, month: String(month)) }
                    // ink.<YYYY-MM>.<recordId>（schema 2）
                    if table == "ink", month.count > 8 {
                        let m = month.prefix(7), dot = month.dropFirst(7).prefix(1), id = month.dropFirst(8)
                        if isMonth(m), dot == ".", isRecordId(id) { return .inkRecord(month: String(m), id: String(id)) }
                    }
                }
            }
            let name = String(rest)
            if singleTables.contains(name) { return .single(table: name) }
            if docNames.contains(name) { return .doc(name: name) }
        }
        return .aux(key: key)
    }

    var key: String {
        switch self {
        case let .monthly(table, month): return "\(Self.v2Prefix)\(table).\(month)"
        case let .inkRecord(month, id): return "\(Self.v2Prefix)ink.\(month).\(id)"
        case let .single(table): return Self.v2Prefix + table
        case let .doc(name): return Self.v2Prefix + name
        case let .aux(key): return key
        }
    }
}

/// apply / import 的一项：value == nil 表示删除；sum 是 JS 端对 value 算的校验和（可缺省）。
struct NativeStoreOp {
    let key: String
    let value: String?
    let sum: String?
}

/// 迁移标记（store_meta 'migration'）：state = imported（已导入、待 JS 逐项核对）| done（已核对，原生为准）。
struct NativeStoreMigration: Equatable {
    var state: String
    var count: Int
    var digest: String
    var source: String
    var importedAt: Double
    var doneAt: Double?

    var dictionary: [String: Any] {
        var out: [String: Any] = ["state": state, "count": count, "digest": digest, "source": source, "importedAt": importedAt]
        if let doneAt { out["doneAt"] = doneAt }
        return out
    }

    init(state: String, count: Int, digest: String, source: String, importedAt: Double, doneAt: Double? = nil) {
        self.state = state
        self.count = count
        self.digest = digest
        self.source = source
        self.importedAt = importedAt
        self.doneAt = doneAt
    }

    init?(json: String) {
        guard
            let data = json.data(using: .utf8),
            let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let state = obj["state"] as? String
        else { return nil }
        self.state = state
        count = (obj["count"] as? NSNumber)?.intValue ?? 0
        digest = obj["digest"] as? String ?? ""
        source = obj["source"] as? String ?? ""
        importedAt = (obj["importedAt"] as? NSNumber)?.doubleValue ?? 0
        doneAt = (obj["doneAt"] as? NSNumber)?.doubleValue
    }

    var json: String {
        let data = (try? JSONSerialization.data(withJSONObject: dictionary, options: [.sortedKeys])) ?? Data("{}".utf8)
        return String(decoding: data, as: UTF8.self)
    }
}

final class NativeStore {
    /// 库结构版本（PRAGMA user_version）。改表结构时 +1，并在 migrateSchema() 里加一级升级。
    static let schemaVersion: Int32 = 2
    static let dataTables = ["records", "ink", "ink_records", "sched", "sessions", "settings", "docs", "aux"]
    static let diagLimit = 20

    let fileURL: URL
    private(set) var db: OpaquePointer?
    private var statements: [String: OpaquePointer] = [:]
    /// 测试用时钟（毫秒）。
    var now: () -> Double = { Date().timeIntervalSince1970 * 1000 }

    init(fileURL: URL) {
        self.fileURL = fileURL
    }

    deinit {
        close()
    }

    /// Application Support/ShiziStore/shizi.sqlite。目录与文件的保护等级 = 首次解锁后可读写（.completeUntilFirstUserAuthentication）：
    /// 锁屏后进程仍可能在提交最后一笔或做 WAL checkpoint，.complete 会让这些写失败；这也是 iOS 的默认等级，这里显式写明。
    /// 不设 isExcludedFromBackup：记录与笔迹是用户自己产生、不可再生的数据，应随 iCloud / 电脑备份走（体量见 01 §9）。
    static func defaultFileURL(fileManager: FileManager = .default) throws -> URL {
        let base = try fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let dir = base.appendingPathComponent("ShiziStore", isDirectory: true)
        try fileManager.createDirectory(at: dir, withIntermediateDirectories: true, attributes: nil)
        try? fileManager.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: dir.path)
        return dir.appendingPathComponent("shizi.sqlite")
    }

    // MARK: - 打开与结构

    func open() throws {
        if db != nil { return }
        var handle: OpaquePointer?
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_NOMUTEX
        let rc = sqlite3_open_v2(fileURL.path, &handle, flags, nil)
        guard rc == SQLITE_OK, let handle else {
            let error = NativeStoreError.sqlite(handle, rc, "open")
            sqlite3_close_v2(handle)
            throw error
        }
        db = handle
        do {
            sqlite3_busy_timeout(handle, 5000)
            let mode = try scalarText("PRAGMA journal_mode=WAL")
            guard mode?.lowercased() == "wal" else { throw NativeStoreError("E_IO", "journal_mode=\(mode ?? "nil")") }
            try exec("PRAGMA synchronous=FULL")
            do {
                try migrateSchema()
            } catch {
                // 升级失败：那一级的事务已回滚（库停在上一级、数据不动）。尽量记一条诊断，再按打不开处理（下次启动重试）。
                try? appendDiag(["kind": "schema-upgrade-failed", "from": Int(userVersion), "to": Int(Self.schemaVersion), "error": "\(error)"])
                throw error
            }
            protectFiles()
        } catch {
            close()
            throw error
        }
    }

    func close() {
        for (_, stmt) in statements { sqlite3_finalize(stmt) }
        statements.removeAll()
        if let db { sqlite3_close_v2(db) }
        db = nil
    }

    private func protectFiles() {
        #if os(iOS)
        let fm = FileManager.default
        for suffix in ["", "-wal", "-shm"] {
            let path = fileURL.path + suffix
            if fm.fileExists(atPath: path) {
                try? fm.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: path)
            }
        }
        #endif
    }

    var userVersion: Int32 {
        guard let text = try? scalarText("PRAGMA user_version") else { return 0 }
        return Int32(text) ?? 0
    }

    /// 逐级升级：每一级一个事务（改表 + 把 user_version 改成这一级），做完一级才进下一级——中途被杀，下次从停下的那一级接着做（可重入）。
    ///   v0 → v1 建表（B1）。
    ///   v1 → v2 墨迹每条一行（B2.3）：建 ink_records(month, id, body)。只改结构：把旧 ink 月行拆成单条行由 JS store 做
    ///          （migrateInkSchema：逐条形状校验、逐月一个 apply 事务、失败回滚并记诊断、下次启动再迁）——
    ///          值的形状只在 JS 里（D69 / B4 前不在 Swift 重写），原生仍不解析业务 JSON；拆完之前旧月行照常可读可写。
    private func migrateSchema() throws {
        let version = userVersion
        if version > Self.schemaVersion {
            throw NativeStoreError("E_SCHEMA", "database schema \(version) is newer than app schema \(Self.schemaVersion)")
        }
        if version == Self.schemaVersion { return }
        if version < 1 {
            try upgrade(to: 1) {
                for table in ["records", "ink"] {
                    try exec("CREATE TABLE IF NOT EXISTS \(table) (month TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL)")
                }
                for table in NativeStoreSlot.singleTables.sorted() {
                    try exec("CREATE TABLE IF NOT EXISTS \(table) (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL, updated_at INTEGER NOT NULL)")
                }
                try exec("CREATE TABLE IF NOT EXISTS docs (name TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL)")
                try exec("CREATE TABLE IF NOT EXISTS aux (key TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL)")
                try exec("CREATE TABLE IF NOT EXISTS store_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)")
                try setMeta("createdAt", String(Int64(now())))
            }
        }
        if userVersion < 2 {
            try upgrade(to: 2) {
                try exec("CREATE TABLE IF NOT EXISTS ink_records (month TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (month, id))")
                try setMeta("schema2At", String(Int64(now())))
            }
        }
    }

    /// 一级升级：一个事务里做 body 并把 user_version 改成 level。
    private func upgrade(to level: Int32, _ body: () throws -> Void) throws {
        try transaction {
            try body()
            if let fail = failUpgrade, fail == level { throw NativeStoreError("E_SQLITE", "injected upgrade failure at \(level)") }
            try exec("PRAGMA user_version = \(level)")
        }
    }

    /// 测试注入：升级到这一级时在事务提交前失败（验证回滚与诊断）。
    var failUpgrade: Int32?

    // MARK: - 读

    /// 全部键值，按键的 UTF-16 码元序（与 JS 的默认排序一致）。
    func loadAll() throws -> [(String, String)] {
        try requireOpen()
        var out: [(String, String)] = []
        for table in ["records", "ink"] {
            try each("SELECT month, body FROM \(table)") { stmt in
                out.append((NativeStoreSlot.monthly(table: table, month: Self.text(stmt, 0)).key, Self.text(stmt, 1)))
            }
        }
        try each("SELECT month, id, body FROM ink_records") { stmt in
            out.append((NativeStoreSlot.inkRecord(month: Self.text(stmt, 0), id: Self.text(stmt, 1)).key, Self.text(stmt, 2)))
        }
        for table in NativeStoreSlot.singleTables.sorted() {
            try each("SELECT body FROM \(table) WHERE id = 1") { stmt in
                out.append((NativeStoreSlot.single(table: table).key, Self.text(stmt, 0)))
            }
        }
        try each("SELECT name, body FROM docs") { stmt in
            out.append((NativeStoreSlot.doc(name: Self.text(stmt, 0)).key, Self.text(stmt, 1)))
        }
        try each("SELECT key, body FROM aux") { stmt in
            out.append((Self.text(stmt, 0), Self.text(stmt, 1)))
        }
        return out.sorted { $0.0.utf16.lexicographicallyPrecedes($1.0.utf16) }
    }

    func value(for key: String) throws -> String? {
        try requireOpen()
        guard let slot = NativeStoreSlot.slot(for: key) else { throw NativeStoreError("E_BAD_KEY", "not a shizi key", key: key) }
        let (sql, binds) = Self.selectSQL(slot)
        var result: String?
        try each(sql, binds: binds) { stmt in result = Self.text(stmt, 0) }
        return result
    }

    // MARK: - 写

    /// 一个事务写完 ops（按给定顺序）；任一项失败整笔回滚并抛错。返回写入（含删除）的项数。
    @discardableResult
    func apply(_ ops: [NativeStoreOp]) throws -> Int {
        try requireOpen()
        let slots = try ops.map { op -> NativeStoreSlot in
            guard let slot = NativeStoreSlot.slot(for: op.key) else { throw NativeStoreError("E_BAD_KEY", "not a shizi key", key: op.key) }
            return slot
        }
        if ops.isEmpty { return 0 }
        let at = Int64(now())
        try transaction {
            for (op, slot) in zip(ops, slots) {
                try write(op, slot: slot, at: at)
            }
        }
        return ops.count
    }

    private func write(_ op: NativeStoreOp, slot: NativeStoreSlot, at: Int64) throws {
        guard var value = op.value else {
            let (sql, binds) = Self.deleteSQL(slot)
            try run(sql, binds: binds, key: op.key)
            return
        }
        if let sum = op.sum, Self.checksum(&value) != sum {
            throw NativeStoreError("E_VERIFY", "checksum mismatch on arrival", key: op.key)
        }
        let (sql, binds) = Self.upsertSQL(slot)
        try run(sql, binds: binds + [.text(value), .int(at)], key: op.key)
        // 同一事务里读回、逐字节比对（UTF-8）。
        let (select, selectBinds) = Self.selectSQL(slot)
        let stmt = try prepare(select)
        defer { sqlite3_reset(stmt); sqlite3_clear_bindings(stmt) }
        try bind(stmt, selectBinds)
        let rc = sqlite3_step(stmt)
        guard rc == SQLITE_ROW else {
            if rc == SQLITE_DONE { throw NativeStoreError("E_VERIFY", "row missing after write", key: op.key) }
            throw NativeStoreError.sqlite(db, rc, "verify", key: op.key)
        }
        let count = Int(sqlite3_column_bytes(stmt, 0))
        let ptr = sqlite3_column_text(stmt, 0)
        let same: Bool = value.withUTF8 { buf in
            guard buf.count == count else { return false }
            if count == 0 { return true }
            guard let ptr, let base = buf.baseAddress else { return false }
            return memcmp(ptr, base, count) == 0
        }
        if !same { throw NativeStoreError("E_VERIFY", "read-back mismatch", key: op.key) }
    }

    // MARK: - 从 localStorage 迁移（01 §12.1）

    func migration() throws -> NativeStoreMigration? {
        try requireOpen()
        return try meta("migration").flatMap { NativeStoreMigration(json: $0) }
    }

    /// 一个事务：清空全部数据表 → 逐项写入（带校验和、读回比对）→ 按库里实际的行算摘要并与 JS 给的 digest 比对 → 记 state=imported。
    /// 已完成（done）的库拒绝再导入（E_MIGRATION）：此后原生为准，旧 localStorage 已过时，再导入会覆盖新写入。
    func importRows(_ rows: [NativeStoreOp], count: Int, digest: String, source: String) throws -> NativeStoreMigration {
        try requireOpen()
        if let current = try migration(), current.state == "done" {
            throw NativeStoreError("E_MIGRATION", "migration already done")
        }
        guard rows.count == count else { throw NativeStoreError("E_VERIFY", "row count \(rows.count) != \(count)") }
        var seen = Set<String>()
        let slots = try rows.map { op -> NativeStoreSlot in
            guard op.value != nil, let slot = NativeStoreSlot.slot(for: op.key) else { throw NativeStoreError("E_BAD_KEY", "bad import row", key: op.key) }
            guard seen.insert(op.key).inserted else { throw NativeStoreError("E_BAD_REQUEST", "duplicate key", key: op.key) }
            return slot
        }
        let at = Int64(now())
        var result: NativeStoreMigration?
        try transaction {
            for table in Self.dataTables { try exec("DELETE FROM \(table)") }
            for (op, slot) in zip(rows, slots) { try write(op, slot: slot, at: at) }
            let actual = try digestOfRows()
            guard actual.count == count, actual.digest == digest else {
                throw NativeStoreError("E_VERIFY", "digest mismatch: native \(actual.digest) js \(digest)")
            }
            let m = NativeStoreMigration(state: "imported", count: count, digest: digest, source: source, importedAt: Double(at))
            try setMeta("migration", m.json)
            result = m
        }
        return result!
    }

    /// JS 逐项核对通过后调用：按库里实际的行重算摘要，与导入时一致才把 state 置为 done。已 done 且摘要相同 → 幂等成功。
    func commitMigration(count: Int, digest: String) throws -> NativeStoreMigration {
        try requireOpen()
        var result: NativeStoreMigration?
        try transaction {
            guard var m = try migration() else { throw NativeStoreError("E_MIGRATION", "nothing imported") }
            if m.state == "done" {
                guard m.digest == digest else { throw NativeStoreError("E_MIGRATION", "already done with another digest") }
                result = m
                return
            }
            guard m.state == "imported", m.digest == digest, m.count == count else {
                throw NativeStoreError("E_MIGRATION", "state \(m.state) digest \(m.digest) count \(m.count)")
            }
            let actual = try digestOfRows()
            guard actual.count == count, actual.digest == digest else {
                throw NativeStoreError("E_VERIFY", "digest changed since import: \(actual.digest)")
            }
            m.state = "done"
            m.doneAt = now()
            try setMeta("migration", m.json)
            result = m
        }
        return result!
    }

    /// 全部行的摘要：count:总字节:fnv。fnv 按键的 UTF-16 序对每行「键 \0 校验和 \n」的 UTF-8 字节做 FNV-1a 32（与 JS digestRows 同口径）。
    func digestOfRows() throws -> (count: Int, digest: String) {
        let rows = try loadAll()
        return Self.digest(rows)
    }

    static func digest(_ rows: [(String, String)]) -> (count: Int, digest: String) {
        var h: UInt32 = fnvOffset
        var bytes = 0
        for (key, value) in rows {
            var v = value
            let sum = checksum(&v)
            bytes += v.utf8.count
            var line = key + "\u{0}" + sum + "\n"
            h = line.withUTF8 { fnv1a($0, seed: h) }
        }
        return (rows.count, "\(rows.count):\(bytes):\(hex8(h))")
    }

    // MARK: - 统计、诊断、维护

    struct Stats {
        var rows: Int
        var bodyBytes: Int
        var fileBytes: Int
        var tables: [String: (rows: Int, bytes: Int)]
    }

    func stats() throws -> Stats {
        try requireOpen()
        var tables: [String: (rows: Int, bytes: Int)] = [:]
        var rows = 0
        var bytes = 0
        for table in Self.dataTables {
            var r = 0
            var b = 0
            try each("SELECT COUNT(*), IFNULL(SUM(LENGTH(CAST(body AS BLOB))), 0) FROM \(table)") { stmt in
                r = Int(sqlite3_column_int64(stmt, 0))
                b = Int(sqlite3_column_int64(stmt, 1))
            }
            tables[table] = (r, b)
            rows += r
            bytes += b
        }
        let pages = Int(try scalarText("PRAGMA page_count").flatMap { Int($0) } ?? 0)
        let pageSize = Int(try scalarText("PRAGMA page_size").flatMap { Int($0) } ?? 0)
        return Stats(rows: rows, bodyBytes: bytes, fileBytes: pages * pageSize, tables: tables)
    }

    /// 诊断：最近 diagLimit 条（JS 迁移失败 / 回退时写入），只供排查，不影响数据。
    func appendDiag(_ entry: [String: Any]) throws {
        try requireOpen()
        var list: [Any] = []
        if let raw = try meta("diag"), let data = raw.data(using: .utf8), let arr = (try? JSONSerialization.jsonObject(with: data)) as? [Any] {
            list = arr
        }
        var item = entry
        item["at"] = now()
        list.append(item)
        if list.count > Self.diagLimit { list.removeFirst(list.count - Self.diagLimit) }
        let data = try JSONSerialization.data(withJSONObject: list)
        try setMeta("diag", String(decoding: data, as: UTF8.self))
    }

    func diagEntries() throws -> [Any] {
        guard let raw = try meta("diag"), let data = raw.data(using: .utf8) else { return [] }
        return (try? JSONSerialization.jsonObject(with: data)) as? [Any] ?? []
    }

    /// 进后台时把 WAL 并回主库（PASSIVE：不等读者、不阻塞）。数据在 COMMIT 时已落盘，这一步只为让 WAL 不长大。
    func checkpoint() {
        guard let db else { return }
        sqlite3_wal_checkpoint_v2(db, nil, SQLITE_CHECKPOINT_PASSIVE, nil, nil)
    }

    func meta(_ key: String) throws -> String? {
        var out: String?
        try each("SELECT value FROM store_meta WHERE key = ?", binds: [.text(key)]) { stmt in out = Self.text(stmt, 0) }
        return out
    }

    private func setMeta(_ key: String, _ value: String) throws {
        try run("INSERT INTO store_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", binds: [.text(key), .text(value)])
    }

    // MARK: - 校验和（与 checksum 同口径）

    static let fnvOffset: UInt32 = 0x811c9dc5
    static let fnvPrime: UInt32 = 0x01000193

    static func fnv1a(_ bytes: UnsafeBufferPointer<UInt8>, seed: UInt32 = fnvOffset) -> UInt32 {
        var h = seed
        for b in bytes {
            h ^= UInt32(b)
            h = h &* fnvPrime
        }
        return h
    }

    static func hex8(_ h: UInt32) -> String {
        let s = String(h, radix: 16)
        return String(repeating: "0", count: max(0, 8 - s.count)) + s
    }

    /// 「UTF-8 字节数:FNV-1a 32 十六进制」。inout 只为拿连续 UTF-8 缓冲（withUTF8），不改内容。
    static func checksum(_ value: inout String) -> String {
        value.withUTF8 { buf in "\(buf.count):\(hex8(fnv1a(buf)))" }
    }

    // MARK: - SQL 片段

    enum Bind {
        case text(String)
        case int(Int64)
    }

    static func selectSQL(_ slot: NativeStoreSlot) -> (String, [Bind]) {
        switch slot {
        case let .monthly(table, month): return ("SELECT body FROM \(table) WHERE month = ?", [.text(month)])
        case let .inkRecord(month, id): return ("SELECT body FROM ink_records WHERE month = ? AND id = ?", [.text(month), .text(id)])
        case let .single(table): return ("SELECT body FROM \(table) WHERE id = 1", [])
        case let .doc(name): return ("SELECT body FROM docs WHERE name = ?", [.text(name)])
        case let .aux(key): return ("SELECT body FROM aux WHERE key = ?", [.text(key)])
        }
    }

    static func deleteSQL(_ slot: NativeStoreSlot) -> (String, [Bind]) {
        switch slot {
        case let .monthly(table, month): return ("DELETE FROM \(table) WHERE month = ?", [.text(month)])
        case let .inkRecord(month, id): return ("DELETE FROM ink_records WHERE month = ? AND id = ?", [.text(month), .text(id)])
        case let .single(table): return ("DELETE FROM \(table) WHERE id = 1", [])
        case let .doc(name): return ("DELETE FROM docs WHERE name = ?", [.text(name)])
        case let .aux(key): return ("DELETE FROM aux WHERE key = ?", [.text(key)])
        }
    }

    /// 绑定顺序：主键（若有）、body、updated_at。
    static func upsertSQL(_ slot: NativeStoreSlot) -> (String, [Bind]) {
        let tail = "ON CONFLICT DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at"
        switch slot {
        case let .monthly(table, month):
            return ("INSERT INTO \(table) (month, body, updated_at) VALUES (?, ?, ?) \(tail)", [.text(month)])
        case let .inkRecord(month, id):
            return ("INSERT INTO ink_records (month, id, body, updated_at) VALUES (?, ?, ?, ?) \(tail)", [.text(month), .text(id)])
        case let .single(table):
            return ("INSERT INTO \(table) (id, body, updated_at) VALUES (1, ?, ?) \(tail)", [])
        case let .doc(name):
            return ("INSERT INTO docs (name, body, updated_at) VALUES (?, ?, ?) \(tail)", [.text(name)])
        case let .aux(key):
            return ("INSERT INTO aux (key, body, updated_at) VALUES (?, ?, ?) \(tail)", [.text(key)])
        }
    }

    // MARK: - SQLite 小工具

    private func requireOpen() throws {
        if db == nil { throw NativeStoreError("E_UNAVAILABLE", "database is not open") }
    }

    func exec(_ sql: String) throws {
        let rc = sqlite3_exec(db, sql, nil, nil, nil)
        guard rc == SQLITE_OK else { throw NativeStoreError.sqlite(db, rc, sql) }
    }

    private func scalarText(_ sql: String) throws -> String? {
        var out: String?
        try each(sql) { stmt in
            if sqlite3_column_type(stmt, 0) != SQLITE_NULL { out = Self.text(stmt, 0) }
        }
        return out
    }

    private func transaction(_ body: () throws -> Void) throws {
        try exec("BEGIN IMMEDIATE")
        do {
            try body()
            try exec("COMMIT")
        } catch {
            sqlite3_exec(db, "ROLLBACK", nil, nil, nil)
            throw error
        }
    }

    private func prepare(_ sql: String) throws -> OpaquePointer {
        if let cached = statements[sql] { return cached }
        var stmt: OpaquePointer?
        let rc = sqlite3_prepare_v2(db, sql, -1, &stmt, nil)
        guard rc == SQLITE_OK, let stmt else { throw NativeStoreError.sqlite(db, rc, "prepare \(sql)") }
        statements[sql] = stmt
        return stmt
    }

    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    private func bind(_ stmt: OpaquePointer, _ binds: [Bind]) throws {
        for (i, b) in binds.enumerated() {
            let index = Int32(i + 1)
            let rc: Int32
            switch b {
            case var .text(s):
                rc = s.withUTF8 { buf -> Int32 in
                    // 空串也要绑成 TEXT ''（baseAddress 可能为 nil），不能绑成 NULL。
                    guard buf.count > 0, let base = buf.baseAddress else { return sqlite3_bind_text(stmt, index, "", 0, Self.transient) }
                    return base.withMemoryRebound(to: CChar.self, capacity: buf.count) { sqlite3_bind_text(stmt, index, $0, Int32(buf.count), Self.transient) }
                }
            case let .int(v):
                rc = sqlite3_bind_int64(stmt, index, v)
            }
            guard rc == SQLITE_OK else { throw NativeStoreError.sqlite(db, rc, "bind") }
        }
    }

    private func run(_ sql: String, binds: [Bind] = [], key: String? = nil) throws {
        let stmt = try prepare(sql)
        defer { sqlite3_reset(stmt); sqlite3_clear_bindings(stmt) }
        try bind(stmt, binds)
        let rc = sqlite3_step(stmt)
        guard rc == SQLITE_DONE || rc == SQLITE_ROW else { throw NativeStoreError.sqlite(db, rc, sql, key: key) }
    }

    private func each(_ sql: String, binds: [Bind] = [], _ row: (OpaquePointer) throws -> Void) throws {
        let stmt = try prepare(sql)
        defer { sqlite3_reset(stmt); sqlite3_clear_bindings(stmt) }
        try bind(stmt, binds)
        while true {
            let rc = sqlite3_step(stmt)
            if rc == SQLITE_ROW {
                try row(stmt)
            } else if rc == SQLITE_DONE {
                return
            } else {
                throw NativeStoreError.sqlite(db, rc, sql)
            }
        }
    }

    static func text(_ stmt: OpaquePointer, _ column: Int32) -> String {
        let count = Int(sqlite3_column_bytes(stmt, column))
        guard count > 0, let ptr = sqlite3_column_text(stmt, column) else { return "" }
        return String(decoding: UnsafeBufferPointer(start: ptr, count: count), as: UTF8.self)
    }
}
