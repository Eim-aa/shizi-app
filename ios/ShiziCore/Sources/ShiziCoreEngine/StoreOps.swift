import Foundation
import ShiziCore

// B4.4 的 op（store / storage / budget / backup / migrate / 原生校验和）。JS 参考实现（同名、同参数校验、同错误码；store 会话、数据描述的 mutate 与磁盘注入规则、存储层抛错的回包）已随 D84 退役。

/// 引擎里的 store 会话：一块「磁盘」（MemoryDisk | FakeNativeDisk）+ storage + store。
final class StoreSession {
    let kind: String
    let disk: TestDisk
    let budgets: JSObject?
    let inkFormat: String?
    var storage: StoreStorage!
    var store: Store!
    var notices: [JSValue] = []

    init(kind: String, disk: TestDisk, budgets: JSObject?, inkFormat: String?) {
        self.kind = kind
        self.disk = disk
        self.budgets = budgets
        self.inkFormat = inkFormat
    }

    func boot(now: @escaping () -> Double, dates: Dates) -> JSObject {
        storage = StoreStorage(disk.open(), now: now)
        store = Store(storage: storage, now: now, budgets: budgets, inkFormat: inkFormat, dates: dates)
        store.subscribe { [weak self] _, info in self?.notices.append(.object(info)) }
        return store.load()
    }

    var snapshot: JSValue {
        var o = JSObject([("backend", .string(kind)), ("disk", .object(disk.snapshotObject())), ("state", .object(store.state)), ("serial", .number(store.serial)),
                          ("status", .object(store.status)), ("notices", .array(notices))])
        if let f = disk as? FakeNativeDisk { o["diag"] = .array(f.diag) }
        return .object(o)
    }
}

/// 磁盘注入规则表 → failWhen（与 makeFailWhen 同一规则：每条规则自己数命中次数）。
func makeFailWhen(_ rules: [JSObject]) -> (DiskWrite) -> DiskVerdict? {
    final class Box { var hits: [Int]; init(hits: [Int]) { self.hits = hits } }
    let box = Box(hits: Array(repeating: 0, count: rules.count))
    return { w in
        for (i, r) in rules.enumerated() {
            if let op = r["op"], !JS.isString(op, w.op) { continue }
            if let k = r["key"], !JS.isString(k, w.key) { continue }
            if case .string(let p)? = r["prefix"], !UTF16Order.hasPrefix(w.key, p) { continue }
            box.hits[i] += 1
            let h = Double(box.hits[i])
            let fire: Bool = { if let n = r["nth"] { return n == .number(h) }; if case .number(let f)? = r["from"] { return h >= f }; return true }()
            if fire {
                switch r["verdict"] {
                case .string("quota")?: return .quota
                case .string("security")?: return .security
                case .string(let g)?: return .generic(g)
                case .object(let c)?: return .corrupt(c["corrupt"]?.stringValue ?? "")
                default: return nil
                }
            }
        }
        return nil
    }
}

extension CoreEngine {
    // ---- 参数 ----

    static func arrArg(_ a: JSObject, _ k: String) throws -> [JSValue] {
        guard case .array(let arr) = try required(a, k) else { throw CoreError.badArgs(k + " must be an array") }
        return arr
    }

    static func optStr(_ a: JSObject, _ k: String) throws -> String? {
        guard let v = a[k] else { return nil }
        guard case .string(let s) = v else { throw CoreError.badArgs(k + " must be a string") }
        return s
    }

    static func optFinite(_ a: JSObject, _ k: String) throws -> Double? { a[k] == nil ? nil : try finite(a[k]!, k) }

    func nowArg(_ a: JSObject) throws -> Double { a["now"] == nil ? clock : try CoreEngine.finite(a["now"]!, "now") }

    func session() throws -> StoreSession {
        guard let s = storeSession else { throw CoreError.badArgs("store is not open") }
        return s
    }

    static func checkRules(_ list: [JSValue]) throws -> [JSObject] {
        var out: [JSObject] = []
        for v in list {
            guard case .object(let r) = v else { throw CoreError.badArgs("fail rules must be objects") }
            if let op = r["op"], op != .string("set"), op != .string("remove") { throw CoreError.badArgs("rule op must be set or remove") }
            if let k = r["key"], k.stringValue == nil { throw CoreError.badArgs("rule key must be a string") }
            if let p = r["prefix"], p.stringValue == nil { throw CoreError.badArgs("rule prefix must be a string") }
            for k in ["nth", "from"] {
                if let n = r[k] {
                    guard case .number(let d) = n, d.isFinite, d.rounded(.towardZero) == d, d >= 1, d <= 1e6 else { throw CoreError.badArgs("rule " + k + " must be a positive integer") }
                }
            }
            let verdict = r["verdict"]
            let ok: Bool = {
                switch verdict {
                case .string("quota")?, .string("security")?, .string("generic")?: return true
                case .object(let c)?: return c["corrupt"]?.stringValue != nil
                default: return false
                }
            }()
            if !ok { throw CoreError.badArgs("rule verdict must be quota | security | generic | {corrupt}") }
            out.append(r)
        }
        return out
    }

    static let b44Raw: [String: Op] = [
        // ---------------------------------------------------------------- store 会话
        "store.open": { e, a in
            let kind = try string(a, "backend")
            guard kind == "local" || kind == "native" else { throw CoreError.badArgs("backend must be local or native") }
            let budgets = try optObj(a, "budgets")?.objectValue
            let inkFormat = try optStr(a, "inkFormat")
            var initial: [(String, String)] = []
            if let d = try optObj(a, "disk")?.objectValue {
                for (k, v) in d.entries {
                    guard case .string(let s) = v else { throw CoreError.badArgs("disk values must be strings") }
                    initial.append((k, s))
                }
            }
            let quota = try optFinite(a, "quota") ?? .infinity
            let rules = a["fail"] != nil ? try checkRules(try arrArg(a, "fail")) : nil
            let clockArg = try optFinite(a, "clock")
            let disk: TestDisk = kind == "native" ? FakeNativeDisk(quotaBytes: quota, initial: initial) : MemoryDisk(quotaBytes: quota, initial: initial)
            if let r = rules { disk.failWhen(makeFailWhen(r)) }
            if let c = clockArg { e.clock = c }
            let s = StoreSession(kind: kind, disk: disk, budgets: budgets, inkFormat: (inkFormat ?? "").isEmpty ? nil : inkFormat)
            e.storeSession = s
            return .object(s.boot(now: { [unowned e] in e.clock }, dates: e.dates))
        },
        "store.reboot": { e, a in
            let s = try e.session()
            if try optBool(a, "resume") == true { s.disk.resume() }
            s.notices = []
            return .object(s.boot(now: { [unowned e] in e.clock }, dates: e.dates))
        },
        "store.seed": { e, a in
            let s = try e.session()
            let input = try required(a, "state")
            let label = try optStr(a, "label")
            return s.store.seed(input, label: label ?? "test-seed")
        },
        "store.fault": { e, a in
            let s = try e.session()
            var fail: (n: Double, kind: String, matchKey: String?)? = nil
            if a["failNextWrite"] != nil {
                let f = try objArg(a, "failNextWrite").objectValue!
                let n = try finite(try required(f, "n"), "n")
                let kind = f["kind"] != nil ? try string(f, "kind") : "generic"
                guard ["quota", "generic", "security"].contains(kind) else { throw CoreError.badArgs("kind must be quota | generic | security") }
                fail = (n, kind, try optStr(f, "matchKey"))
            }
            let interrupt = try optFinite(a, "interruptAfterWrite")
            let clear = try optBool(a, "clearFaults")
            if let f = fail { s.storage.failNextWrite(f.n, kind: f.kind, matchKey: f.matchKey) }
            if let i = interrupt { s.storage.interruptAfterWrite(i) }
            if clear == true { s.storage.clearFaults() }
            return .null
        },

        "backup.restore": { e, a in
            let s = try e.session()
            let input = try required(a, "input")
            guard input.stringValue != nil || input.objectValue != nil else { throw CoreError.badArgs("input must be a string or an object") }
            let at = try e.nowArg(a)
            let report = withLegacyDates(e) { Backup.inspectBackup(input, dates: e.dates) }
            if report["ok"] != .bool(true) { return .object(JSObject([("inspected", .object(report))])) }
            let inspected = JSObject([("ok", .bool(true)), ("day", report["day"] ?? .null), ("count", report["count"] ?? .null)])
            return .object(JSObject([("inspected", .object(inspected)), ("result", Backup.restoreFromBackup(s.store, report, now: at))]))
        },
        "backup.undo": { e, _ in Backup.undoFromSafety(try e.session().store) },
        "backup.export": { e, a in
            let s = try e.session()
            return .string(Backup.serializeBackup(.object(try Backup.buildBackupV2(s.store.state, now: try e.nowArg(a), serial: s.store.serial))))
        },
    ]

    /// 每个 B4.4 op 开始时清空「本步收到的通知」。
    static let b44Ops: [String: Op] = {
        var wrapped: [String: Op] = [:]
        for (name, fn) in b44Raw {
            wrapped[name] = { e, a in
                e.storeSession?.notices = []
                return try fn(e, a)
            }
        }
        return wrapped
    }()

    /// v1 备份经 Backup.legacyImporter 转换时用引擎的时区与时钟（JS 一侧 inspect 不给 now 时取 Date.now，参考引擎把它钉在引擎时钟上）。
    static func withLegacyDates<T>(_ e: CoreEngine, _ body: () -> T) -> T {
        let saved = Backup.legacyImporter
        let dates = e.dates, clock = e.clock
        Backup.legacyImporter = { obj, now in Migrate.legacyBackupToV2(.object(obj), now: now ?? clock, dates: dates) }
        defer { Backup.legacyImporter = saved }
        return body()
    }
}
