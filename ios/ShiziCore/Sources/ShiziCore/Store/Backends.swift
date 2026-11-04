import Foundation

// store 的持久化后端（B4.4）：Storage 兼容接口 + 事务后端（原生 SQLite），以及测试 / 差分用的两个「磁盘」替身。
//   KVBackend            ≡ 原 JS 存储驱动眼里的后端：Web Storage 接口（length / key / getItem / setItem / removeItem），
//                          有 applyBatch 的是事务后端（原 JS 的 NativeBackend）。
//   StoreJSError         JS 里抛来抛去的错误对象（name / message / code / kind / key …）；分类、文案与 JS 逐字相同（差分比回包字串）。
//   NativeMirrorBackend  ≡ 原 JS 的 NativeBackend：内存镜像 + 原生传输（apply 一个事务，成功后才更新镜像）。
//   UnavailableBackend   ≡ 原 JS 的 UnavailableBackend：任何读写都抛错（库打不开 → store 不可用）。
//   MemoryDisk           ≡ 原 JS 测试里的 MemoryStorage（配额、failWhen、interruptAfterWrites、failReads）。
//   FakeNativeDisk       ≡ 原 JS 测试里的 FakeNativeDb（原生 SQLite 的替身：事务、校验和、断电、failOp）。
//   NativeChecksum       ≡ 原 JS 的 checksum / digestRows（UTF-8 字节数 + FNV-1a 32）。

// MARK: - 错误

public final class StoreJSError: Error, CustomStringConvertible {
    public enum Class { case write, blocking, read, plain }
    public let cls: Class
    /// JS error.name（StorageWriteError / BlockingStorageError / StorageReadError / QuotaExceededError / SecurityError / Error / TypeError / NativeStoreError / NativeStoreUnavailable …）。
    public var name: String
    public var message: String
    /// write / read：'quota' | 'security' | 'unknown' | 'verify' | 'interrupted'；blocking：'blocked'。
    public var kind: String?
    public var key: String?
    public var phase: String?
    /// DOMException code（数字）或原生错误码（字串）。
    public var code: JSValue?
    public var uncertain = false
    /// blocking：没能恢复的键；reason：'rollback-failed' | 'uncertain'。
    public var keys: [String] = []
    public var reason: String?
    public var cause: StoreJSError?

    public init(_ cls: Class, name: String, message: String) {
        self.cls = cls
        self.name = name
        self.message = message
    }

    public var description: String { name + ": " + message }

    static func write(_ kind: String, _ message: String, key: String? = nil, phase: String? = nil, cause: StoreJSError? = nil) -> StoreJSError {
        let e = StoreJSError(.write, name: "StorageWriteError", message: message)
        e.kind = kind
        e.key = key
        e.phase = phase
        e.cause = cause
        return e
    }

    static func blocking(_ message: String, keys: [String], cause: StoreJSError? = nil, reason: String = "rollback-failed") -> StoreJSError {
        let e = StoreJSError(.blocking, name: "BlockingStorageError", message: message)
        e.kind = "blocked"
        e.keys = keys
        e.cause = cause
        e.reason = reason
        return e
    }

    static func read(_ kind: String, _ message: String, key: String?, cause: StoreJSError?) -> StoreJSError {
        let e = StoreJSError(.read, name: "StorageReadError", message: message)
        e.kind = kind
        e.key = key
        e.cause = cause
        return e
    }

    static func typeError(_ message: String) -> StoreJSError { StoreJSError(.plain, name: "TypeError", message: message) }
    static func plainError(_ message: String) -> StoreJSError { StoreJSError(.plain, name: "Error", message: message) }

    /// DOMException（名字 + 旧式 code）。
    static func dom(_ message: String, _ name: String) -> StoreJSError {
        let e = StoreJSError(.plain, name: name, message: message)
        if name == "QuotaExceededError" { e.code = .number(22) } else if name == "SecurityError" { e.code = .number(18) }
        return e
    }

    /// JS 的 `String(error)`（Error.prototype.toString：name + ": " + message，消息空时只有 name）。
    var jsString: String { message.isEmpty ? name : name + ": " + message }
    /// `error && error.message ? error.message : String(error)`。
    var messageOrString: String { message.isEmpty ? jsString : message }
}

// MARK: - 后端接口

public protocol KVBackend: AnyObject {
    func length() throws -> Int
    func key(_ index: Int) throws -> String?
    func getItem(_ key: String) throws -> String?
    func setItem(_ key: String, _ value: String) throws
    func removeItem(_ key: String) throws
    /// 有 applyBatch（事务后端：一次 writeAll = 一个原生事务）。
    var isTransactional: Bool { get }
    func applyBatch(_ entries: [(String, String?)]) throws
    /// 往原生库的诊断记一条（只有原生后端有；不抛错）。
    var supportsDiag: Bool { get }
    func diag(_ entry: JSObject)
}

public extension KVBackend {
    var isTransactional: Bool { false }
    func applyBatch(_ entries: [(String, String?)]) throws { throw StoreJSError.typeError("applyBatch is not a function") }
    var supportsDiag: Bool { false }
    func diag(_ entry: JSObject) {}
}

// MARK: - 字符串次序（JS 默认排序 / 关系运算：UTF-16 码元序）

package enum UTF16Order {
    static func less(_ a: String, _ b: String) -> Bool { a.utf16.lexicographicallyPrecedes(b.utf16) }
    static func sorted(_ xs: [String]) -> [String] { xs.sorted(by: less) }
    /// JS `a < b ? -1 : a > b ? 1 : 0`。
    static func compare(_ a: String, _ b: String) -> Int { less(a, b) ? -1 : less(b, a) ? 1 : 0 }
    /// `str.indexOf(prefix) === 0`（按 UTF-16 码元）。
    package static func hasPrefix(_ s: String, _ p: String) -> Bool {
        var i = s.utf16.makeIterator()
        for c in p.utf16 { guard let d = i.next(), d == c else { return false } }
        return true
    }
    static func eq(_ a: String, _ b: String) -> Bool { a.utf8.elementsEqual(b.utf8) }
    /// JS 字串长度（UTF-16 码元数）。
    static func length(_ s: String) -> Int { s.utf16.count }
}

// MARK: - 校验和

public enum NativeChecksum {
    public static let offset: UInt32 = 0x811c9dc5
    public static let prime: UInt32 = 0x01000193

    /// UTF-8 字节流的 FNV-1a 32 与字节数（Swift String 没有孤立代理项，与 JS 逐码元编码一致）。
    public static func fnv1a(_ s: String, seed: UInt32 = offset) -> (h: UInt32, bytes: Int) {
        var h = seed
        var n = 0
        for b in s.utf8 {
            h ^= UInt32(b)
            h = h &* prime
            n += 1
        }
        return (h, n)
    }

    public static func hex8(_ h: UInt32) -> String {
        let s = String(h, radix: 16)
        return String(repeating: "0", count: max(0, 8 - s.count)) + s
    }

    /// 「UTF-8 字节数:FNV-1a 32」。
    public static func checksum(_ raw: String) -> String {
        let r = fnv1a(raw)
        return String(r.bytes) + ":" + hex8(r.h)
    }

    /// 一批行（已按键的 UTF-16 序排好）的摘要 {count, bytes, digest:'count:bytes:fnv'}。
    public static func digestRows(_ rows: [(String, String)]) -> (count: Int, bytes: Int, digest: String) {
        var h = offset
        var bytes = 0
        for (key, raw) in rows {
            let sum = checksum(raw)
            bytes += Int(sum.prefix { $0 != ":" })!
            h = fnv1a(key + "\u{0}" + sum + "\n", seed: h).h
        }
        return (rows.count, bytes, String(rows.count) + ":" + String(bytes) + ":" + hex8(h))
    }
}

// MARK: - 原生传输与镜像后端

/// 原生调用失败（NativeStoreError）。E_TIMEOUT / E_TRANSPORT = 结果未知。
public struct NativeCallError: Error {
    public let code: String
    public let message: String
    public let key: String?
    public var uncertain: Bool { code == "E_TIMEOUT" || code == "E_TRANSPORT" }
    public init(_ code: String, _ message: String, key: String? = nil) {
        self.code = code
        self.message = message
        self.key = key
    }
}

/// 原生数据层的同步调用（op = load / apply / diag …；回 {ok:true, …} 的内容或抛 NativeCallError）。
public protocol NativeTransport: AnyObject {
    func callSync(_ op: String, _ payload: JSObject) throws -> JSObject
}

public final class NativeMirrorBackend: KVBackend {
    let transport: NativeTransport
    private var mem = [JSKey: String]()
    private var sortedKeys: [String]?

    /// rows：启动时 load 读出的全部键值。
    public init(transport: NativeTransport, rows: [(String, String)]) {
        self.transport = transport
        for (k, v) in rows { mem[JSKey(s: k)] = v }
    }

    public var isTransactional: Bool { true }
    public var supportsDiag: Bool { true }

    public func length() throws -> Int { mem.count }

    public func key(_ index: Int) throws -> String? {
        if sortedKeys == nil { sortedKeys = UTF16Order.sorted(mem.keys.map { $0.s }) }
        return index >= 0 && index < sortedKeys!.count ? sortedKeys![index] : nil
    }

    public func getItem(_ key: String) throws -> String? { mem[JSKey(s: key)] }
    public func setItem(_ key: String, _ value: String) throws { try apply([(key, value)]) }
    public func removeItem(_ key: String) throws { try apply([(key, nil)]) }
    public func applyBatch(_ entries: [(String, String?)]) throws { try apply(entries) }

    public func diag(_ entry: JSObject) {
        _ = try? transport.callSync("diag", JSObject([("entry", .object(entry))]))
    }

    private func apply(_ entries: [(String, String?)]) throws {
        if entries.isEmpty { return }
        let ops: [JSValue] = entries.map { k, v in
            v == nil ? .array([.string(k), .null]) : .array([.string(k), .string(v!), .string(NativeChecksum.checksum(v!))])
        }
        do {
            _ = try transport.callSync("apply", JSObject([("ops", .array(ops))]))
        } catch let e as NativeCallError {
            throw NativeMirrorBackend.storageError(e, keys: entries.map { $0.0 })
        }
        for (k, v) in entries {
            if let v = v { mem[JSKey(s: k)] = v } else { mem[JSKey(s: k)] = nil }
        }
        sortedKeys = nil
    }

    /// E_FULL → QuotaExceededError；其余 NativeStoreError（code 原样）。
    static func storageError(_ e: NativeCallError, keys: [String]) -> StoreJSError {
        let out = StoreJSError(.plain, name: e.code == "E_FULL" ? "QuotaExceededError" : "NativeStoreError", message: e.message)
        out.code = .string(e.code)
        out.uncertain = e.uncertain
        out.key = e.key ?? (keys.count == 1 ? keys[0] : nil)
        return out
    }

    /// 「启动」：load 全部行建镜像；库打不开 → UnavailableBackend（原因 = 错误码）。
    public static func open(_ transport: NativeTransport) -> KVBackend {
        do {
            let snap = try transport.callSync("load", JSObject())
            var rows: [(String, String)] = []
            for r in snap["rows"]?.arrayValue ?? [] {
                if let p = r.arrayValue, p.count >= 2, let k = p[0].stringValue, let v = p[1].stringValue { rows.append((k, v)) }
            }
            return NativeMirrorBackend(transport: transport, rows: rows)
        } catch let e as NativeCallError {
            return UnavailableBackend(e.code)
        } catch {
            return UnavailableBackend(String(describing: error))
        }
    }
}

/// 原生库读不出来时的后端：任何读写都抛错（store.load 的探测失败 → status.available=false）。
public final class UnavailableBackend: KVBackend {
    let reason: String
    public init(_ reason: String?) { self.reason = reason ?? "native store unavailable" }
    private func fail() -> StoreJSError { StoreJSError(.plain, name: "NativeStoreUnavailable", message: reason) }
    public func length() throws -> Int { throw fail() }
    public func key(_ index: Int) throws -> String? { throw fail() }
    public func getItem(_ key: String) throws -> String? { throw fail() }
    public func setItem(_ key: String, _ value: String) throws { throw fail() }
    public func removeItem(_ key: String) throws { throw fail() }
}

// MARK: - 注入裁决（MemoryDisk / FakeNativeDisk 的 failWhen）

public enum DiskVerdict {
    case quota
    case security
    /// 其他失败（MemoryStorage：Error(`generic failure (<名>)`)；原生替身：E_IO）。
    case generic(String)
    /// 静默写入别的值（读回不一致）。
    case corrupt(String)
}

public struct DiskWrite {
    public let op: String // 'set' | 'remove' | 'clear'
    public let key: String
    public let value: String?
    public let count: Int
}

/// 两种「磁盘」共用的注入与观察接口（store 契约测试与差分对两种后端跑同一套用例）。
public protocol TestDisk: AnyObject {
    var quotaBytes: Double { get set }
    var writeCount: Int { get }
    func failWhen(_ fn: ((DiskWrite) -> DiskVerdict?)?)
    func interruptAfterWrites(_ k: Int)
    func failReads(_ kind: String?)
    func resume()
    /// 直接读写「磁盘」（不经注入）：布置与核对。
    func rawGet(_ key: String) -> String?
    func rawSet(_ key: String, _ value: String)
    func rawRemove(_ key: String)
    func snapshot() -> [(String, String)]
    func usedBytes() -> Double
    /// 「启动」：交给 StoreStorage 的后端（localStorage = 磁盘本身；原生 = load 一次建镜像）。
    func open() -> KVBackend
    func cloneDisk() -> TestDisk
    var isNative: Bool { get }
}

extension TestDisk {
    package func snapshotObject() -> JSObject {
        var o = JSObject()
        for (k, v) in snapshot() { o[k] = .string(v) }
        return o
    }
}

func jsEntryBytes(_ key: String, _ value: String) -> Double { Double(UTF16Order.length(key) + UTF16Order.length(value)) * 2 }

// MARK: - MemoryDisk（MemoryStorage）

public final class MemoryDisk: KVBackend, TestDisk {
    private var keysInOrder: [String] = []
    private var map = [JSKey: String]()
    public var quotaBytes: Double
    private var failFn: ((DiskWrite) -> DiskVerdict?)?
    private var interruptAt: Int?
    private var halted = false
    private var readFailure: String?
    public private(set) var writeCount = 0

    public init(quotaBytes: Double = .infinity, initial: [(String, String)] = []) {
        self.quotaBytes = quotaBytes
        for (k, v) in initial { put(k, v) }
    }

    private func put(_ k: String, _ v: String) {
        if map.updateValue(v, forKey: JSKey(s: k)) == nil { keysInOrder.append(k) }
    }

    private func drop(_ k: String) {
        let jk = JSKey(s: k)
        if map.removeValue(forKey: jk) != nil { keysInOrder.removeAll { JSKey(s: $0) == jk } }
    }

    public var isNative: Bool { false }

    static func makeError(_ kind: String) -> StoreJSError {
        if kind == "quota" { return StoreJSError.dom("The quota has been exceeded.", "QuotaExceededError") }
        if kind == "security" { return StoreJSError.dom("The operation is insecure.", "SecurityError") }
        return StoreJSError.plainError("generic failure (" + kind + ")")
    }

    private func checkRead() throws {
        if let f = readFailure { throw MemoryDisk.makeError(f) }
    }

    public func length() throws -> Int {
        try checkRead()
        return keysInOrder.count
    }

    public func key(_ index: Int) throws -> String? {
        try checkRead()
        return index >= 0 && index < keysInOrder.count ? keysInOrder[index] : nil
    }

    public func getItem(_ key: String) throws -> String? {
        try checkRead()
        return map[JSKey(s: key)]
    }

    public func setItem(_ key: String, _ value: String) throws {
        var value = value
        if case .corrupt(let v)? = try beforeWrite("set", key, value) { value = v }
        let cur = map[JSKey(s: key)]
        let used = usedBytes() - (cur.map { jsEntryBytes(key, $0) } ?? 0)
        if used + jsEntryBytes(key, value) > quotaBytes { throw MemoryDisk.makeError("quota") }
        put(key, value)
        afterWrite()
    }

    public func removeItem(_ key: String) throws {
        _ = try beforeWrite("remove", key, nil)
        drop(key)
        afterWrite()
    }

    private func beforeWrite(_ op: String, _ key: String, _ value: String?) throws -> DiskVerdict? {
        if halted { throw StoreJSError.plainError("interrupted") }
        if readFailure == "security" { throw MemoryDisk.makeError("security") }
        if let fn = failFn, let verdict = fn(DiskWrite(op: op, key: key, value: value, count: writeCount + 1)) {
            switch verdict {
            case .corrupt: return verdict
            case .quota: throw MemoryDisk.makeError("quota")
            case .security: throw MemoryDisk.makeError("security")
            case .generic(let k): throw MemoryDisk.makeError(k)
            }
        }
        return nil
    }

    private func afterWrite() {
        writeCount += 1
        if let at = interruptAt, writeCount >= at {
            interruptAt = nil
            halted = true
        }
    }

    public func failWhen(_ fn: ((DiskWrite) -> DiskVerdict?)?) { failFn = fn }
    public func interruptAfterWrites(_ k: Int) { interruptAt = writeCount + k }
    public func failReads(_ kind: String?) { readFailure = kind }
    public func resume() {
        halted = false
        interruptAt = nil
        failFn = nil
        readFailure = nil
    }

    public func rawGet(_ key: String) -> String? { map[JSKey(s: key)] }
    public func rawSet(_ key: String, _ value: String) { put(key, value) }
    public func rawRemove(_ key: String) { drop(key) }
    public func usedBytes() -> Double { keysInOrder.reduce(0) { $0 + jsEntryBytes($1, map[JSKey(s: $1)]!) } }
    public func snapshot() -> [(String, String)] { UTF16Order.sorted(keysInOrder).map { ($0, map[JSKey(s: $0)]!) } }
    public func open() -> KVBackend { self }
    public func cloneDisk() -> TestDisk { MemoryDisk(quotaBytes: quotaBytes, initial: snapshot()) }
}

// MARK: - FakeNativeDisk（FakeNativeDb）

public final class FakeNativeDisk: TestDisk {
    private var map = [JSKey: String]()
    public var quotaBytes: Double
    public var migration: JSValue
    public private(set) var diag: [JSValue] = []
    private var failFn: ((DiskWrite) -> DiskVerdict?)?
    private var interruptAt: Int?
    private var halted = false
    private var readFailure: String?
    private var opFailures: [(op: String, code: String, after: Bool, times: Int)] = []
    public private(set) var writeCount = 0
    public private(set) var calls: [String] = []

    public static let doneMigration: JSValue = .object(JSObject([("state", .string("done")), ("count", .number(0)), ("digest", .string("0:0:811c9dc5")), ("source", .string("test"))]))

    public init(quotaBytes: Double = .infinity, initial: [(String, String)] = [], migration: JSValue = FakeNativeDisk.doneMigration) {
        self.quotaBytes = quotaBytes
        self.migration = migration
        for (k, v) in initial { map[JSKey(s: k)] = v }
    }

    public var isNative: Bool { true }

    struct Failure: Error {
        let code: String
        var message: String?
        var key: String?
    }

    private func sortedKeys() -> [String] { UTF16Order.sorted(map.keys.map { $0.s }) }
    public func rows() -> [(String, String)] { sortedKeys().map { ($0, map[JSKey(s: $0)]!) } }

    public func rawGet(_ key: String) -> String? { map[JSKey(s: key)] }
    public func rawSet(_ key: String, _ value: String) { map[JSKey(s: key)] = value }
    public func rawRemove(_ key: String) { map[JSKey(s: key)] = nil }
    public func usedBytes() -> Double { map.reduce(0) { $0 + jsEntryBytes($1.key.s, $1.value) } }
    public func snapshot() -> [(String, String)] { rows() }
    public func cloneDisk() -> TestDisk { FakeNativeDisk(quotaBytes: quotaBytes, initial: snapshot(), migration: migration) }

    public func failWhen(_ fn: ((DiskWrite) -> DiskVerdict?)?) { failFn = fn }
    public func interruptAfterWrites(_ k: Int) { interruptAt = writeCount + k }
    public func failReads(_ kind: String?) { readFailure = kind }
    public func failOp(_ op: String, _ code: String, after: Bool = false, times: Int = 1) { opFailures.append((op, code, after, times)) }
    public func resume() {
        halted = false
        interruptAt = nil
        failFn = nil
        readFailure = nil
        opFailures = []
    }

    private func takeOpFailure(_ op: String) -> (op: String, code: String, after: Bool, times: Int)? {
        guard let i = opFailures.firstIndex(where: { $0.op == op }) else { return nil }
        let f = opFailures[i]
        opFailures[i].times -= 1
        if opFailures[i].times <= 0 { opFailures.remove(at: i) }
        return f
    }

    /// 一个事务写 ops（[key, raw|nil, sum?]）；失败抛 Failure，磁盘不变。
    private func transaction(_ ops: [(String, String?, String?)], checkInterrupt: Bool = true) throws -> Int {
        var undo: [(String, String?)] = []
        func rollback() {
            for (k, prev) in undo.reversed() { map[JSKey(s: k)] = prev }
        }
        if checkInterrupt, let at = interruptAt, writeCount + ops.count > at {
            interruptAt = nil
            halted = true
            throw Failure(code: "E_TRANSPORT", message: "process died inside transaction")
        }
        do {
            for (key, raw, sum) in ops {
                guard UTF16Order.hasPrefix(key, "shizi.") else { throw Failure(code: "E_BAD_KEY", key: key) }
                let prev = map[JSKey(s: key)]
                var value = raw
                if let fn = failFn, let verdict = fn(DiskWrite(op: raw == nil ? "remove" : "set", key: key, value: raw, count: writeCount + undo.count + 1)) {
                    switch verdict {
                    case .corrupt(let v): value = v
                    case .quota: throw Failure(code: "E_FULL", key: key)
                    case .security, .generic: throw Failure(code: "E_IO", key: key)
                    }
                }
                guard let raw = raw, let v = value else {
                    undo.append((key, prev))
                    map[JSKey(s: key)] = nil
                    continue
                }
                if let sum = sum, NativeChecksum.checksum(raw) != sum { throw Failure(code: "E_VERIFY", message: "checksum mismatch on arrival", key: key) }
                let used = usedBytes() - (prev.map { jsEntryBytes(key, $0) } ?? 0)
                if used + jsEntryBytes(key, v) > quotaBytes { throw Failure(code: "E_FULL", key: key) }
                undo.append((key, prev))
                map[JSKey(s: key)] = v
                if !UTF16Order.eq(v, raw) { throw Failure(code: "E_VERIFY", message: "read-back mismatch", key: key) }
            }
        } catch {
            rollback()
            throw error
        }
        writeCount += ops.count
        if checkInterrupt, let at = interruptAt, writeCount >= at {
            interruptAt = nil
            halted = true
            throw Failure(code: "E_TRANSPORT", message: "process died after commit")
        }
        return ops.count
    }

    /// handle + 传输的 parseResponse：成功回结果对象，失败抛 NativeCallError（message = `${op}: ${message || code}`）。
    public func call(_ op: String, _ payload: JSObject) throws -> JSObject {
        calls.append(op)
        do {
            if halted { throw Failure(code: "E_TRANSPORT", message: "process is gone") }
            let injected = takeOpFailure(op)
            if let f = injected, !f.after { throw Failure(code: f.code, message: "injected " + f.code) }
            let out = try perform(op, payload)
            if let f = injected, f.after { throw Failure(code: f.code, message: "injected " + f.code + " after success") }
            return out
        } catch let f as Failure {
            throw NativeCallError(f.code, op + ": " + (f.message ?? f.code), key: f.key)
        }
    }

    private func perform(_ op: String, _ payload: JSObject) throws -> JSObject {
        if readFailure != nil, ["load", "ping", "stats", "apply", "import", "commitMigration"].contains(op) {
            throw Failure(code: "E_UNAVAILABLE", message: "database cannot be opened (" + readFailure! + ")")
        }
        switch op {
        case "ping":
            return JSObject([("schema", .number(1)), ("migration", migration)])
        case "load":
            return JSObject([("schema", .number(1)), ("migration", migration), ("rows", .array(rows().map { .array([.string($0.0), .string($0.1)]) }))])
        case "apply":
            guard case .array(let list)? = payload["ops"] else { throw Failure(code: "E_BAD_REQUEST") }
            let ops: [(String, String?, String?)] = list.map { item in
                let a = item.arrayValue ?? []
                let k = a.count > 0 ? (a[0].stringValue ?? "") : ""
                let v = a.count > 1 ? a[1].stringValue : nil
                let s = a.count > 2 ? a[2].stringValue : nil
                return (k, v, s)
            }
            return JSObject([("written", .number(Double(try transaction(ops))))])
        case "diag":
            if let e = payload["entry"], JSX.truthy(e) { diag.append(e) }
            return JSObject([("diag", .array(diag))])
        case "stats":
            return JSObject([("rows", .number(Double(map.count))), ("migration", migration)])
        default:
            throw Failure(code: "E_UNKNOWN_OP")
        }
    }

    final class Transport: NativeTransport {
        let disk: FakeNativeDisk
        init(_ disk: FakeNativeDisk) { self.disk = disk }
        func callSync(_ op: String, _ payload: JSObject) throws -> JSObject { try disk.call(op, payload) }
    }

    public func transport() -> NativeTransport { Transport(self) }

    public func open() -> KVBackend { NativeMirrorBackend.open(transport()) }
}
