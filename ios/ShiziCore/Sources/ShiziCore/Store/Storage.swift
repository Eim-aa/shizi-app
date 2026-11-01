import Foundation

// src/store/storage.js 的 1:1 移植（B4.4）：存储驱动——事务写（txn 日志 + 固定顺序 + 逐键读回 + 逆序回滚；事务后端 = 一个原生事务）、
// 单键缩小写 writeOne、路由提示 writeRoute、启动修复 repair、探测 probe、故障注入（failNextWrite / interruptAfterWrite）。
// 语义、失败分类与错误文案逐字照 JS（文件头的说明见 storage.js）。

public final class StoreStorage {
    public let backend: KVBackend
    let now: () -> Double
    private(set) var halted = false
    private var blockedState: (reason: String, keys: [String], moved: [String])?
    /// 写失败且回滚也失败 / 写后读回不确定（之后的写一律拒绝，内部按 blockedState）。store 读这个：有替身时报替身（JS 夹具换的也只是 storage.blocked 这个读口）。
    public var blocked: (reason: String, keys: [String], moved: [String])? { blockedOverride ?? blockedState }
    /// 测试替身（B4.9c）：JS 夹具把 storage.probe / storage.blocked 换成假的（ShiziUITests States/_ops/blockMode.js、test-hooks overrideStorage），
    /// Swift 是写入者时同一件事落在这里——探测按替身答、blocked 按替身报；nil = 真的。
    public var probeOverride: (ok: Bool, kind: String?)?
    public var blockedOverride: (reason: String, keys: [String], moved: [String])?
    private var failQueue: [(remaining: Int, kind: String, matchKey: String?)] = []
    private var interruptAfter: Int?
    public private(set) var lastRepair: JSObject?

    public init(_ backend: KVBackend, now: @escaping () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
        self.backend = backend
        self.now = now
    }

    var isTx: Bool { backend.isTransactional }
    /// 'native'（事务后端，原生 SQLite）| 'localStorage'。
    public var kind: String { isTx ? "native" : "localStorage" }

    // MARK: 错误分类

    /// 'quota' | 'security' | 'unknown'。
    public static func classify(_ error: Error?) -> String {
        guard let e = error as? StoreJSError else { return "unknown" }
        if e.cls == .write || e.cls == .read { return e.kind == "quota" || e.kind == "security" ? e.kind! : "unknown" }
        if e.name == "QuotaExceededError" || e.name == "NS_ERROR_DOM_QUOTA_REACHED" || e.code == .number(22) || e.code == .number(1014) { return "quota" }
        if e.name == "SecurityError" || e.code == .number(18) { return "security" }
        return "unknown"
    }

    static func isInterrupted(_ e: Error) -> Bool {
        guard let s = e as? StoreJSError else { return false }
        return s.cls == .write && s.kind == "interrupted"
    }

    static func makeInjectedError(_ kind: String) -> StoreJSError {
        if kind == "quota" { return StoreJSError.dom("injected quota failure", "QuotaExceededError") }
        if kind == "security" { return StoreJSError.dom("injected security failure", "SecurityError") }
        return StoreJSError.plainError("injected generic write failure")
    }

    static func jsError(_ e: Error) -> StoreJSError {
        if let s = e as? StoreJSError { return s }
        return StoreJSError.plainError(String(describing: e))
    }

    // MARK: 写入顺序

    static let writeOrder = ["inkRecord", "ink", "records", "sched", "custom", "wordOff", "settings", "photos", "legacy", "backupMeta", "funnel", "safety", "*", "meta", "sessions"]

    public static func writeRank(_ key: String) -> Int {
        let id = Schema.specForKey(key)?.id ?? "*"
        return writeOrder.firstIndex(of: id) ?? writeOrder.firstIndex(of: "*")!
    }

    static func compareWriteOrder(_ a: String, _ b: String) -> Bool {
        let ra = writeRank(a), rb = writeRank(b)
        if ra != rb { return ra < rb }
        return UTF16Order.less(a, b)
    }

    // MARK: 原语

    private func noteUncertain(_ error: StoreJSError, _ keys: [String]) {
        if !error.uncertain || blockedState != nil { return }
        blockedState = ("uncertain", keys, [])
    }

    private func matches(_ matchKey: String?, _ key: String) -> Bool {
        guard let m = matchKey, !m.isEmpty else { return true }
        if m.hasSuffix("*") && m.utf16.last == 0x2A {
            return UTF16Order.hasPrefix(key, String(m.dropLast()))
        }
        return UTF16Order.eq(key, m)
    }

    private func takeInjectedFailure(_ key: String, explicitOnly: Bool = false) -> StoreJSError? {
        var i = 0
        while i < failQueue.count {
            let rule = failQueue[i]
            if explicitOnly && (rule.matchKey ?? "").isEmpty { i += 1; continue }
            if rule.remaining > 0 && matches(rule.matchKey, key) {
                failQueue[i].remaining -= 1
                if failQueue[i].remaining <= 0 { failQueue.remove(at: i) }
                return StoreStorage.makeInjectedError(rule.kind)
            }
            i += 1
        }
        return nil
    }

    private func afterWrite(_ key: String) throws {
        guard let n = interruptAfter else { return }
        interruptAfter = n - 1
        if n - 1 <= 0 {
            interruptAfter = nil
            halted = true
            throw StoreJSError.write("interrupted", "interrupted after write to " + key, key: key, phase: "interrupt")
        }
    }

    private func guardHalted(_ key: String?) throws {
        if halted { throw StoreJSError.write("interrupted", "storage halted by interruptAfterWrite", key: key, phase: "halted") }
    }

    func rawSet(_ key: String, _ value: String) throws {
        try guardHalted(key)
        if let injected = takeInjectedFailure(key) { throw injected }
        do {
            try backend.setItem(key, value)
        } catch {
            let e = StoreStorage.jsError(error)
            noteUncertain(e, [key])
            throw e
        }
        try afterWrite(key)
    }

    func rawRemove(_ key: String) throws {
        try guardHalted(key)
        do {
            try backend.removeItem(key)
        } catch {
            let e = StoreStorage.jsError(error)
            noteUncertain(e, [key])
            throw e
        }
        try afterWrite(key)
    }

    func rawGet(_ key: String) throws -> String? {
        do { return try backend.getItem(key) } catch { throw StoreStorage.jsError(error) }
    }

    public func read(_ key: String) throws -> String? {
        do {
            return try rawGet(key)
        } catch {
            let e = StoreStorage.jsError(error)
            throw StoreJSError.read(StoreStorage.classify(e), "read failed: " + key, key: key, cause: e)
        }
    }

    public func listKeys(_ prefix: String = "") throws -> [String] {
        var out: [String] = []
        let n: Int
        do { n = try backend.length() } catch { throw StoreStorage.jsError(error) }
        for i in 0..<max(0, n) {
            let k: String?
            do { k = try backend.key(i) } catch { throw StoreStorage.jsError(error) }
            if let k = k, UTF16Order.hasPrefix(k, prefix) { out.append(k) }
        }
        return UTF16Order.sorted(out)
    }

    public func readAll(_ prefix: String = "") throws -> [(String, String?)] {
        try listKeys(prefix).map { ($0, try rawGet($0)) }
    }

    static func toWriteError(_ error: Error, _ key: String?, _ phase: String) -> StoreJSError {
        let e = jsError(error)
        if e.cls == .write { return e }
        let kind = classify(e)
        return StoreJSError.write(kind, phase + " failed at " + (key ?? "null") + ": " + e.messageOrString, key: key, phase: phase, cause: e)
    }

    private func quarantine(_ key: String, _ raw: String?) throws -> Bool {
        do {
            if let raw = raw { try rawSet(Schema.corruptKeyFor(key), raw) }
            try rawRemove(key)
            return true
        } catch {
            if StoreStorage.isInterrupted(error) { throw error }
            return false
        }
    }

    /// txn = 解析后的日志对象（prev 取用）。
    private func rollback(_ txn: JSObject, _ keys: [String], _ cause: StoreJSError?) throws -> (ok: Bool, keys: [String]) {
        var failed: [String] = []
        let prevMap = txn["prev"]?.objectValue ?? JSObject()
        for key in keys.reversed() {
            let prevV = prevMap[key]
            let prev: String? = prevV?.stringValue
            do {
                if !rawEq(try rawGet(key), prev) {
                    if let p = prev { try rawSet(key, p) } else { try rawRemove(key) }
                }
                if !rawEq(try rawGet(key), prev) { failed.append(key) }
            } catch {
                if StoreStorage.isInterrupted(error) { throw error }
                failed.append(key)
            }
        }
        if failed.isEmpty {
            do {
                try rawRemove(Schema.keyNamed("txn")!)
            } catch {
                if StoreStorage.isInterrupted(error) { throw error }
            }
            return (true, [])
        }
        var moved: [String] = []
        for key in failed {
            var raw: String? = nil
            raw = (try? rawGet(key)) ?? nil
            if raw != nil, try quarantine(key, raw) { moved.append(key) }
        }
        do {
            try rawSet(Schema.corruptKeyFor(Schema.keyNamed("txn")!), JSONWriter.stringify(.object(txn)))
        } catch {
            if StoreStorage.isInterrupted(error) { throw error }
        }
        blockedState = ("rollback-failed", failed, moved)
        return (false, failed)
    }

    func normalizeEntries(_ entries: [(String, String?)]) throws -> [(String, String?)] {
        var order: [String] = []
        var byKey = [JSKey: String?]()
        let txn = Schema.keyNamed("txn")!, probe = Schema.keyNamed("probe")!, route = Schema.keyNamed("route")!
        for (key, raw) in entries {
            if key.isEmpty { throw StoreJSError.typeError("writeAll key must be a non-empty string") }
            if UTF16Order.eq(key, txn) || UTF16Order.eq(key, probe) || UTF16Order.eq(key, route) { throw StoreJSError.typeError("writeAll must not touch " + key) }
            let jk = JSKey(s: key)
            if byKey[jk] == nil { order.append(key) }
            byKey[jk] = .some(raw)
        }
        let list = order.map { ($0, byKey[JSKey(s: $0)]!) }
        return mergeSortStable(list) { StoreStorage.compareWriteOrder($0.0, $1.0) }
    }

    private func txWrite(_ todo: [(String, String?)], _ label: String) throws -> [String] {
        let keys = todo.map { $0.0 }
        for (key, _) in todo {
            if let injected = takeInjectedFailure(key) { throw StoreStorage.toWriteError(injected, key, "write") }
        }
        if let n = interruptAfter, n < todo.count {
            interruptAfter = nil
            halted = true
            throw StoreJSError.write("interrupted", "interrupted inside transaction " + label, key: keys[0], phase: "interrupt")
        }
        do {
            try backend.applyBatch(todo)
        } catch {
            let e = StoreStorage.jsError(error)
            if e.uncertain {
                noteUncertain(e, keys)
                let codeText: String = {
                    if case .string(let c)? = e.code, !c.isEmpty { return c }
                    if case .number(let d)? = e.code, d != 0 { return JSNumber.toString(d) }
                    return e.message
                }()
                throw StoreJSError.blocking("native write outcome unknown (" + codeText + ")", keys: keys, cause: e, reason: "uncertain")
            }
            if e.code == .string("E_VERIFY") {
                throw StoreJSError.write("verify", e.message.isEmpty ? "native read-back mismatch" : e.message, key: e.key, phase: "verify", cause: e)
            }
            throw StoreStorage.toWriteError(e, e.key, "write")
        }
        if let n = interruptAfter {
            interruptAfter = n - todo.count
            if n - todo.count <= 0 {
                interruptAfter = nil
                halted = true
                throw StoreJSError.write("interrupted", "interrupted after transaction " + label, key: keys[keys.count - 1], phase: "interrupt")
            }
        }
        for (key, raw) in todo {
            if !rawEq(try rawGet(key), raw) {
                let error = StoreJSError.write("verify", "mirror mismatch at " + key, key: key, phase: "verify")
                if blockedState == nil { blockedState = ("uncertain", keys, []) }
                throw StoreJSError.blocking(error.message, keys: keys, cause: error, reason: "uncertain")
            }
        }
        return keys
    }

    /// 事务写。成功返回写了的键；失败抛 StoreJSError（write：已回滚；blocking：回滚失败 / 结果未知）。
    @discardableResult
    public func writeAll(_ entries: [(String, String?)], label: String = "write") throws -> [String] {
        if halted { throw StoreJSError.write("interrupted", "storage halted by interruptAfterWrite", phase: "halted") }
        if let b = blockedState { throw StoreJSError.blocking("storage is blocked (" + b.reason + ")", keys: b.keys, reason: b.reason) }
        let sorted = try normalizeEntries(entries)
        var prev = JSObject()
        var todo: [(String, String?)] = []
        for (key, raw) in sorted {
            let before: String?
            do { before = try rawGet(key) } catch { throw StoreStorage.toWriteError(error, key, "read-prev") }
            if rawEq(before, raw) { continue }
            prev[key] = before.map { .string($0) } ?? .null
            todo.append((key, raw))
        }
        if todo.isEmpty { return [] }
        if isTx { return try txWrite(todo, label) }
        let keys = todo.map { $0.0 }
        let txnKey = Schema.keyNamed("txn")!
        let txn = JSObject([("label", .string(label)), ("at", .number(now())), ("keys", .array(keys.map { .string($0) })), ("prev", .object(prev)), ("phase", .string("writing"))])
        let txnRaw = JSONWriter.stringify(.object(txn))
        do {
            try rawSet(txnKey, txnRaw)
            if !rawEq(try rawGet(txnKey), txnRaw) { throw StoreJSError.write("verify", "txn read-back mismatch", key: txnKey, phase: "txn") }
        } catch {
            if StoreStorage.isInterrupted(error) { throw error }
            do {
                if try rawGet(txnKey) != nil { try rawRemove(txnKey) }
            } catch let cleanup {
                if StoreStorage.isInterrupted(cleanup) { throw cleanup }
            }
            throw StoreStorage.toWriteError(error, txnKey, "txn")
        }

        var attempted: [String] = []
        var failure: StoreJSError? = nil
        do {
            for (key, raw) in todo {
                attempted.append(key)
                do {
                    if let raw = raw { try rawSet(key, raw) } else { try rawRemove(key) }
                } catch {
                    throw StoreStorage.toWriteError(error, key, "write")
                }
            }
            for (key, raw) in todo {
                let back: String?
                do { back = try rawGet(key) } catch { throw StoreStorage.toWriteError(error, key, "verify") }
                if !rawEq(back, raw) { throw StoreJSError.write("verify", "read-back mismatch at " + key, key: key, phase: "verify") }
            }
            do {
                try rawRemove(txnKey)
            } catch {
                if StoreStorage.isInterrupted(error) { throw error }
                do {
                    var done = txn
                    done["phase"] = .string("done")
                    try rawSet(txnKey, JSONWriter.stringify(.object(done)))
                } catch let markError {
                    if StoreStorage.isInterrupted(markError) { throw markError }
                    throw StoreStorage.toWriteError(error, txnKey, "finalize")
                }
            }
        } catch {
            if StoreStorage.isInterrupted(error) { throw error }
            failure = StoreStorage.toWriteError(error, nil, "write")
        }
        guard let f = failure else { return keys }
        let rb = try rollback(txn, attempted, f)
        if !rb.ok { throw StoreJSError.blocking("rollback failed for " + rb.keys.joined(separator: ", "), keys: rb.keys, cause: f) }
        throw f
    }

    /// 单键原子写（不写 txn）。成功返回写了的键（没变 = []）。
    @discardableResult
    public func writeOne(_ key: String, _ raw: String?, label: String = "write-one") throws -> [String] {
        if halted { throw StoreJSError.write("interrupted", "storage halted by interruptAfterWrite", phase: "halted") }
        if let b = blockedState { throw StoreJSError.blocking("storage is blocked (" + b.reason + ")", keys: b.keys, reason: b.reason) }
        let (k, value) = try normalizeEntries([(key, raw)])[0]
        let before: String?
        do { before = try rawGet(k) } catch { throw StoreStorage.toWriteError(error, k, "read-prev") }
        if rawEq(before, value) { return [] }
        if isTx {
            _ = try txWrite([(k, value)], label)
            return [k]
        }
        var failure: StoreJSError? = nil
        do {
            do {
                if let v = value { try rawSet(k, v) } else { try rawRemove(k) }
            } catch {
                throw StoreStorage.toWriteError(error, k, "write")
            }
            let back: String?
            do { back = try rawGet(k) } catch { throw StoreStorage.toWriteError(error, k, "verify") }
            if !rawEq(back, value) { throw StoreJSError.write("verify", "read-back mismatch at " + k, key: k, phase: "verify") }
        } catch {
            if StoreStorage.isInterrupted(error) { throw error }
            failure = StoreStorage.toWriteError(error, k, "write")
        }
        guard let f = failure else { return [k] }
        let txn = JSObject([("label", .string(label)), ("at", .number(now())), ("keys", .array([.string(k)])),
                            ("prev", .object(JSObject([(k, before.map { .string($0) } ?? .null)]))), ("phase", .string("writing"))])
        let rb = try rollback(txn, [k], f)
        if !rb.ok { throw StoreJSError.blocking("rollback failed for " + rb.keys.joined(separator: ", "), keys: rb.keys, cause: f) }
        throw f
    }

    /// 路由提示单键写：永不抛错，返回 {ok:true, written} | {ok:false, kind}。
    public func writeRoute(_ raw: String?) -> JSValue {
        func fail(_ k: String) -> JSValue { .object(JSObject([("ok", .bool(false)), ("kind", .string(k))])) }
        if halted { return fail("interrupted") }
        if blockedState != nil { return fail("blocked") }
        let key = Schema.keyNamed("route")!
        do {
            if rawEq(try rawGet(key), raw) { return .object(JSObject([("ok", .bool(true)), ("written", .bool(false))])) }
            if raw != nil, let injected = takeInjectedFailure(key, explicitOnly: true) { throw injected }
            if isTx { try backend.applyBatch([(key, raw)]) } else if let r = raw { try backend.setItem(key, r) } else { try backend.removeItem(key) }
            return .object(JSObject([("ok", .bool(true)), ("written", .bool(true))]))
        } catch {
            return fail(StoreStorage.classify(error))
        }
    }

    /// 启动修复。报告 {txn, quarantined:[{key, reason}], quarantineFailed, unknown, dropped, blocked}。
    public func repair() throws -> JSObject {
        var txnState = "none"
        var quarantined: [JSValue] = []
        var quarantineFailed: [JSValue] = []
        var unknown: [JSValue] = []
        var dropped: [JSValue] = []
        var blockedFlag = false
        let txnKey = Schema.keyNamed("txn")!, probeKey = Schema.keyNamed("probe")!, routeKey = Schema.keyNamed("route")!
        func qEntry(_ k: String, _ r: String) -> JSValue { .object(JSObject([("key", .string(k)), ("reason", .string(r))])) }
        if let txnRaw = try read(txnKey) {
            switch Schema.parseAndValidate(key: txnKey, raw: .string(txnRaw)) {
            case .failed(let reason):
                txnState = "corrupt"
                if try !quarantine(txnKey, txnRaw) { quarantineFailed.append(qEntry(txnKey, reason)) }
            case .ok(let value):
                let t = value.objectValue ?? JSObject()
                if t["phase"] == .string("done") {
                    txnState = "completed"
                    do { try rawRemove(txnKey) } catch { if StoreStorage.isInterrupted(error) { throw error } }
                } else {
                    let keys = (t["keys"]?.arrayValue ?? []).compactMap { $0.stringValue }
                    let rb = try rollback(t, keys, nil)
                    txnState = rb.ok ? "rolled-back" : "blocked"
                    blockedFlag = !rb.ok
                }
            }
        }
        do {
            if try rawGet(probeKey) != nil { try rawRemove(probeKey) }
        } catch {
            if StoreStorage.isInterrupted(error) { throw error }
        }
        for key in try listKeys(Schema.v2Prefix) {
            if UTF16Order.eq(key, txnKey) || UTF16Order.eq(key, probeKey) { continue }
            guard Schema.specForKey(key) != nil else {
                unknown.append(.string(key))
                continue
            }
            guard let raw = try rawGet(key) else { continue }
            guard case .failed(let reason) = Schema.parseAndValidate(key: key, raw: .string(raw)) else { continue }
            if UTF16Order.eq(key, routeKey) {
                do {
                    try rawRemove(key)
                    dropped.append(.string(key))
                } catch {
                    if StoreStorage.isInterrupted(error) { throw error }
                }
                continue
            }
            if try quarantine(key, raw) { quarantined.append(qEntry(key, reason)) } else { quarantineFailed.append(qEntry(key, reason)) }
        }
        let report = JSObject([("txn", .string(txnState)), ("quarantined", .array(quarantined)), ("quarantineFailed", .array(quarantineFailed)),
                               ("unknown", .array(unknown)), ("dropped", .array(dropped)), ("blocked", .bool(blockedFlag))])
        lastRepair = report
        return report
    }

    /// 读写可用性探测：{ok:true} | {ok:false, kind}。
    public func probe() -> (ok: Bool, kind: String?) {
        if let o = probeOverride { return o }
        let key = Schema.keyNamed("probe")!
        do {
            let token = JSNumber.toString(now())
            try rawSet(key, token)
            let back = try rawGet(key)
            try rawRemove(key)
            if !rawEq(back, token) { return (false, "unknown") }
            return (true, nil)
        } catch {
            return (false, StoreStorage.classify(error))
        }
    }

    /// 非事务地删一批键（测试钩子 reset 与「备份导入成功后清 shizi.corrupt.*」）。返回删掉的键。
    @discardableResult
    public func removeKeys(_ keys: [String]) throws -> [String] {
        if isTx {
            try guardHalted(keys.first)
            let present = try keys.filter { try rawGet($0) != nil }
            if present.isEmpty { return keys }
            do {
                try backend.applyBatch(present.map { ($0, nil) })
                return keys
            } catch {
                noteUncertain(StoreStorage.jsError(error), present)
                return []
            }
        }
        var removed: [String] = []
        for key in keys {
            do {
                try rawRemove(key)
                removed.append(key)
            } catch {
                if StoreStorage.isInterrupted(error) { throw error }
            }
        }
        return removed
    }

    /// 占用估算（同源全部键）。
    public func estimateUsage(_ budgets: Budgets) throws -> JSObject {
        Budget.estimateUsage(try readAll("").compactMap { k, v in v.map { (k, $0) } }, budgets)
    }

    // MARK: 故障注入（测试 / 差分）

    /// 接下来 n 次匹配 matchKey 的 setItem 抛错。kind: 'quota' | 'generic' | 'security'；matchKey 可带尾 '*' 做前缀匹配。
    public func failNextWrite(_ n: Double = 1, kind: String = "generic", matchKey: String? = nil) {
        let count = n.isFinite ? max(0, Int(n.rounded(.down))) : 0
        if count > 0 { failQueue.append((count, kind, (matchKey ?? "").isEmpty ? nil : matchKey)) }
    }

    /// 从现在起第 k 次写成功后「进程中断」。
    public func interruptAfterWrite(_ k: Double) {
        let count = k.isFinite ? Int(k.rounded(.down)) : 0
        interruptAfter = count > 0 ? count : nil
    }

    public func clearFaults() {
        failQueue = []
        interruptAfter = nil
        halted = false
    }
}

/// 稳定归并排序（less = 严格「排在前」）。
func mergeSortStable<T>(_ items: [T], _ less: (T, T) -> Bool) -> [T] {
    items.jsSorted { less($0, $1) ? -1 : less($1, $0) ? 1 : 0 }
}

/// 原始字串相等（JS ===：按码元，不是 Swift 的规范等价）。
func rawEq(_ a: String?, _ b: String?) -> Bool {
    switch (a, b) {
    case (nil, nil): return true
    case (let x?, let y?): return x.utf8.elementsEqual(y.utf8)
    default: return false
    }
}
