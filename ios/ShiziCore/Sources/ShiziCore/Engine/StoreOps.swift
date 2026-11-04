import Foundation

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

    static func rawOrNull(_ a: JSObject, _ k: String) throws -> String? {
        let v = try required(a, k)
        if v.isNull { return nil }
        guard case .string(let s) = v else { throw CoreError.badArgs(k + " must be a string or null") }
        return s
    }

    func nowArg(_ a: JSObject) throws -> Double { a["now"] == nil ? clock : try CoreEngine.finite(a["now"]!, "now") }

    func session() throws -> StoreSession {
        guard let s = storeSession else { throw CoreError.badArgs("store is not open") }
        return s
    }

    static func budgetsOf(_ a: JSObject) throws -> Budgets { Budgets.resolve(try optObj(a, "budgets")?.objectValue) }

    static func recList(_ v: JSValue?) -> Bool {
        guard case .array(let a)? = v else { return false }
        return a.allSatisfy { $0.objectValue != nil }
    }

    /// 预算类 op 的状态形状。
    static func checkShape(_ state: JSObject) throws -> JSObject {
        if let r = state["records"], !r.isNull {
            guard case .object(let o) = r else { throw CoreError.badArgs("records must be an object of months") }
            for (_, v) in o.entries {
                let folded: Bool = { if case .object(let f) = v { return f["folded"] == .bool(true) && recList(f["kept"]) }; return false }()
                if !(recList(v) || folded) { throw CoreError.badArgs("records months must be record lists") }
            }
        }
        if let i = state["ink"], !i.isNull {
            guard case .object(let o) = i else { throw CoreError.badArgs("ink must be an object of months") }
            for (_, v) in o.entries where v.objectValue == nil { throw CoreError.badArgs("ink months must be objects") }
        }
        return state
    }

    static let mutationOps = ["set", "delete", "month", "append", "setInk", "deleteInk", "judgeInk", "nextId", "patch", "prune", "endSessions", "throw"]

    static func checkMutation(_ list: [JSValue]) throws {
        for v in list {
            guard case .object(let m) = v, case .string(let op)? = m["op"], mutationOps.contains(op) else { throw CoreError.badArgs("ops must be mutation objects") }
            if ["set", "delete", "month", "patch"].contains(op), m["domain"]?.stringValue == nil { throw CoreError.badArgs("mutation domain must be a string") }
            if (op == "month" || op == "append"), m["month"]?.stringValue == nil { throw CoreError.badArgs("mutation month must be a string") }
            if op == "patch", m["key"]?.stringValue == nil { throw CoreError.badArgs("mutation key must be a string") }
            if op == "append", m["record"]?.objectValue == nil { throw CoreError.badArgs("mutation record must be an object") }
            if ["setInk", "deleteInk", "judgeInk"].contains(op), m["record"] != .string("$last"), m["record"]?.objectValue == nil { throw CoreError.badArgs("mutation record must be an object or $last") }
            if op == "setInk", m["ink"] == nil { throw CoreError.badArgs("mutation ink is missing") }
            if op == "judgeInk" {
                guard case .array(let strokes)? = m["strokes"], strokes.allSatisfy({ s in
                    guard case .array(let pts) = s else { return false }
                    return pts.allSatisfy { p in
                        guard case .object(let o) = p, o["x"]?.numberValue != nil, o["y"]?.numberValue != nil else { return false }
                        if let t = o["t"], t.numberValue == nil { return false }
                        return true
                    }
                }) else { throw CoreError.badArgs("mutation strokes must be arrays of points") }
            }
            if op == "nextId", m["prefix"]?.stringValue == nil { throw CoreError.badArgs("mutation prefix must be a string") }
            if op == "prune" {
                guard case .array(let ks)? = m["cardKeys"], ks.allSatisfy({ $0.stringValue != nil }) else { throw CoreError.badArgs("mutation cardKeys must be strings") }
            }
            if op == "throw", m["message"]?.stringValue == nil { throw CoreError.badArgs("mutation message must be a string") }
            if ["set", "month", "patch"].contains(op), m["value"] == nil { throw CoreError.badArgs("mutation value is missing") }
        }
    }

    func applyMutation(_ ops: [JSValue], _ draft: inout JSObject, _ ctx: inout CommitContext) throws {
        var last: JSValue = .null
        let tz = dates.timeZone
        func recOf(_ r: JSValue?) -> JSValue { r == .string("$last") ? last : (r ?? .null) }
        for v in ops {
            let m = v.objectValue!
            let op = m["op"]!.stringValue!
            switch op {
            case "set":
                draft[m["domain"]!.stringValue!] = m["value"]!
            case "delete":
                draft[m["domain"]!.stringValue!] = nil
            case "month":
                let d = m["domain"]!.stringValue!
                guard case .object(var o)? = draft[d] else { throw CoreError.error("mutation: " + d + " is not an object") }
                o[m["month"]!.stringValue!] = m["value"]!
                draft[d] = .object(o)
            case "append":
                guard case .object(var recs)? = draft["records"] else { throw CoreError.error("mutation: records is not an object") }
                var rec = JSObject([("id", .string(try ctx.nextId("r")))])
                for (k, x) in m["record"]!.objectValue!.entries { rec[k] = x }
                let month = m["month"]!.stringValue!
                if case .array(var cur)? = recs[month] { cur.append(.object(rec)); recs[month] = .array(cur) } else { recs[month] = .array([.object(rec)]) }
                draft["records"] = .object(recs)
                last = .object(rec)
            case "setInk":
                let ink = m["ink"]!
                try Store.setInk(&draft, recOf(m["record"]), ink.isNull ? nil : ink, timeZone: tz)
            case "deleteInk":
                Store.deleteInk(&draft, recOf(m["record"]), timeZone: tz)
            case "judgeInk":
                let strokes = (m["strokes"]!.arrayValue ?? []).map { s in (s.arrayValue ?? []).compactMap { InkPoint(js: $0) } }
                let ink = try InkMath.encodeStoredInk(strokes, policy: Config.policy.objectValue, format: ctx.inkFormat)
                try Store.setInk(&draft, recOf(m["record"]), ink, timeZone: tz)
            case "nextId":
                _ = try ctx.nextId(m["prefix"]!.stringValue!)
            case "patch":
                let d = m["domain"]!.stringValue!
                var o = draft[d]?.objectValue ?? JSObject()
                o[m["key"]!.stringValue!] = m["value"]!
                draft[d] = .object(o)
            case "prune":
                Budget.pruneInkOfCards(&draft, (m["cardKeys"]!.arrayValue ?? []).compactMap { $0.stringValue }, dates: dates)
            case "endSessions":
                Backup.endActiveSessions(&draft)
            default: // throw
                throw CoreError.error(m["message"]!.stringValue!)
            }
        }
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

    static func errReply(_ error: Error) -> JSValue {
        let e = StoreStorage.jsError(error)
        return .object(JSObject([("ok", .bool(false)), ("name", .string(e.name)), ("kind", Store.opt(e.kind)), ("key", Store.opt(e.key)), ("message", .string(e.message))]))
    }

    static func tierOut(_ t: Double) -> JSValue { t == .infinity ? .string("Infinity") : .number(t) }

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
        "store.close": { e, _ in
            e.storeSession = nil
            return .null
        },
        "store.commit": { e, a in
            let s = try e.session()
            let label = try string(a, "label")
            let ops = try arrArg(a, "ops")
            try checkMutation(ops)
            let reclaim = try optBool(a, "reclaim")
            let replace = try optBool(a, "replace")
            return s.store.commit(label, reclaim: reclaim ?? true, replace: replace ?? false) { draft, ctx in
                try e.applyMutation(ops, &draft, &ctx)
            }
        },
        "store.seed": { e, a in
            let s = try e.session()
            let input = try required(a, "state")
            let label = try optStr(a, "label")
            return s.store.seed(input, label: label ?? "test-seed")
        },
        "store.replaceWithBackup": { e, a in
            let s = try e.session()
            let obj = try required(a, "backup")
            let label = try optStr(a, "label")
            let end = try optBool(a, "endSessions")
            return s.store.replaceWithBackup(obj, label: label ?? "restore-backup", mutate: end == true ? { Backup.endActiveSessions(&$0) } : nil)
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
        "store.disk": { e, a in
            let s = try e.session()
            var rules: [JSObject]? = nil
            if let f = a["fail"], !f.isNull { rules = try checkRules(try arrArg(a, "fail")) }
            var quota: Double? = nil
            if let q = a["quota"] { quota = q.isNull ? .infinity : try finite(q, "quota") }
            let quotaRel = try optFinite(a, "quotaRel")
            let interrupt = a["interrupt"] != nil ? try int(a, "interrupt", 1_000_000) : nil
            if let fr = a["failReads"], !fr.isNull, fr.stringValue == nil { throw CoreError.badArgs("failReads must be a string or null") }
            var failOp: (op: String, code: String, after: Bool, times: Int)? = nil
            if a["failOp"] != nil {
                guard s.disk is FakeNativeDisk else { throw CoreError.badArgs("failOp needs the native backend") }
                let f = try objArg(a, "failOp").objectValue!
                failOp = (try string(f, "op"), try string(f, "code"), f["after"] != nil ? (try optBool(f, "after") ?? false) : false, f["times"] != nil ? try int(f, "times", 100) : 1)
            }
            let resume = try optBool(a, "resume")
            if a["fail"] != nil { s.disk.failWhen(rules.map { makeFailWhen($0) }) }
            if let q = quota { s.disk.quotaBytes = q }
            if let q = quotaRel { s.disk.quotaBytes = s.disk.usedBytes() + q }
            if let i = interrupt { s.disk.interruptAfterWrites(i) }
            if let fr = a["failReads"] { s.disk.failReads(fr.stringValue.flatMap { $0.isEmpty ? nil : $0 }) }
            if let f = failOp, let n = s.disk as? FakeNativeDisk { n.failOp(f.op, f.code, after: f.after, times: f.times) }
            if resume == true { s.disk.resume() }
            return .null
        },
        "store.ackCorruptNotice": { e, _ in
            try e.session().store.ackCorruptNotice()
            return .null
        },
        "store.getInk": { e, a in
            let s = try e.session()
            return Store.getInk(s.store.state, try objArg(a, "record"), timeZone: e.dates.timeZone) ?? .null
        },
        "store.refreshUsage": { e, _ in try e.session().store.refreshUsage().map { .object($0) } ?? .null },
        "store.writeRoute": { e, a in try e.session().storage.writeRoute(try rawOrNull(a, "raw")) },
        "store.writeOne": { e, a in
            let s = try e.session()
            let key = try string(a, "key")
            let raw = try rawOrNull(a, "raw")
            do {
                return .object(JSObject([("ok", .bool(true)), ("written", .array(try s.storage.writeOne(key, raw, label: "diff-one").map { .string($0) }))]))
            } catch { return errReply(error) }
        },
        "store.writeAll": { e, a in
            let s = try e.session()
            let entries = try arrArg(a, "entries")
            var list: [(String, String?)] = []
            for v in entries {
                guard case .array(let p) = v, p.count == 2, case .string(let k) = p[0], p[1].isNull || p[1].stringValue != nil else {
                    throw CoreError.badArgs("entries must be [key, raw|null] pairs")
                }
                list.append((k, p[1].stringValue))
            }
            let label = try optStr(a, "label")
            do {
                return .object(JSObject([("ok", .bool(true)), ("written", .array(try s.storage.writeAll(list, label: label ?? "write").map { .string($0) }))]))
            } catch { return errReply(error) }
        },
        "store.repair": { e, _ in
            let s = try e.session()
            do { return .object(JSObject([("ok", .bool(true)), ("report", .object(try s.storage.repair()))])) } catch { return errReply(error) }
        },
        "store.removeKeys": { e, a in
            let s = try e.session()
            let keys = try strArr(a, "keys")
            do { return .object(JSObject([("ok", .bool(true)), ("removed", .array(try s.storage.removeKeys(keys).map { .string($0) }))])) } catch { return errReply(error) }
        },

        // ---------------------------------------------------------------- budget
        "budget.entryBytes": { _, a in .number(Budget.entryBytes(try string(a, "key"), try rawOrNull(a, "raw"))) },
        "budget.bucketOfKey": { _, a in .string(Budget.bucketOfKey(try string(a, "key"))) },
        "budget.estimateUsage": { _, a in
            var pairs: [(String, String)] = []
            for v in try arrArg(a, "pairs") {
                guard case .array(let p) = v, p.count == 2, case .string(let k) = p[0], case .string(let r) = p[1] else { throw CoreError.badArgs("pairs must be [key, raw] pairs") }
                pairs.append((k, r))
            }
            return .object(Budget.estimateUsage(pairs, try budgetsOf(a)))
        },
        "budget.storagePressureOf": { _, a in Budget.storagePressureOf(try required(a, "usage")) },
        "budget.inkBudgetOf": { _, a in .number(Budget.inkBudgetOf(try required(a, "settings"), policy: try policyOf(a))) },
        "budget.needsRecovery": { e, a in
            let state = try checkShape(try objArg(a, "state").objectValue!)
            let now = try e.nowArg(a)
            let b = try budgetsOf(a)
            let total = try optFinite(a, "totalBytes")
            return .object(Budget.needsRecovery(state, now: now, budgets: b, totalBytes: total, dates: e.dates))
        },
        "budget.recover": { e, a in
            var draft = try checkShape(try objArg(a, "draft").objectValue!)
            let now = try e.nowArg(a)
            let b = try budgetsOf(a)
            let force = try optBool(a, "force") ?? false
            let need = try optFinite(a, "needBytes") ?? 0
            var limit: Budget.Limit? = nil
            if a["limit"] != nil {
                let l = try objArg(a, "limit").objectValue!
                limit = Budget.Limit(ink: try optBool(l, "ink") ?? false, inkMonths: try optStrArr(l, "inkMonths"), months: try optStrArr(l, "months"))
            }
            let keep = try optFinite(a, "afterSeenKeepDays") ?? Config.policyNumber("afterSeenInkKeepDays")!
            let r = Budget.recover(&draft, now: now, budgets: b, force: force, needBytes: need, limit: limit, afterSeenKeepDays: keep, dates: e.dates)
            return .object(JSObject([("actions", .array(r.actions)), ("freedBytes", .number(r.freedBytes)), ("draft", .object(draft))]))
        },
        "budget.pruneInkOfCards": { e, a in
            var draft = try checkShape(try objArg(a, "draft").objectValue!)
            let dropped = Budget.pruneInkOfCards(&draft, try strArr(a, "cardKeys"), dates: e.dates)
            return .object(JSObject([("dropped", .array(dropped)), ("draft", .object(draft))]))
        },
        "budget.inkTiers": { _, a in
            let records = try checkShape(JSObject([("records", try objArg(a, "records"))]))["records"]!.objectValue!
            let now = try optFinite(a, "now")
            let keep = try optFinite(a, "keepDays") ?? Config.policyNumber("afterSeenInkKeepDays")!
            let index = Budget.indexRecords(records, sessions: a["sessions"], now: now, keepDays: keep)
            let cur = try string(a, "currentMonth")
            var out = JSObject()
            for id in try strArr(a, "ids") { out[id] = tierOut(Budget.inkTier(id, index, cur)) }
            return .object(out)
        },
        "budget.deriveSerial": { _, a in .number(Store.deriveSerial(try objArg(a, "state").objectValue!)) },

        // ---------------------------------------------------------------- backup
        "backup.recordsSignature": { _, a in .string(Backup.recordsSignature(try required(a, "records"))) },
        "backup.judgedChars": { _, a in .array(Backup.judgedCharsOf(try required(a, "records")).items.map { .string($0) }) },
        "backup.judgedDays": { _, a in .array(Backup.judgedDaysOf(try required(a, "records")).map { .string($0) }) },
        "backup.entries": { _, a in .array(Backup.backupEntries(try objArg(a, "state").objectValue!).map { .array([.string($0.0), .string($0.1)]) }) },
        "backup.build": { e, a in
            let now = try e.nowArg(a)
            let serial = try optFinite(a, "serial") ?? 0
            return .object(try Backup.buildBackupV2(try objArg(a, "state").objectValue!, now: now, serial: serial))
        },
        "backup.serialize": { _, a in .string(Backup.serializeBackup(try required(a, "obj"))) },
        "backup.fileName": { e, a in .string(try Backup.backupFileName(try e.nowArg(a), dates: e.dates)) },
        "backup.failureKind": { _, a in .string(Backup.failureKind(try string(a, "reason"))) },
        "backup.inspect": { e, a in
            let input = try required(a, "input")
            guard input.stringValue != nil || input.objectValue != nil else { throw CoreError.badArgs("input must be a string or an object") }
            let max = try optFinite(a, "maxBytes") ?? Backup.maxBytes
            return .object(withLegacyDates(e) { Backup.inspectBackup(input, maxBytes: max, dates: e.dates) })
        },
        "backup.importLegacy": { e, a in
            let input = try required(a, "input")
            guard input.stringValue != nil || input.objectValue != nil else { throw CoreError.badArgs("input must be a string or an object") }
            let now = try e.nowArg(a)
            return withLegacyDates(e) { Backup.importLegacyBackup(input, now: now) }
        },
        "backup.lossRange": { _, a in Backup.lossRange(try required(a, "records"), try required(a, "day")) },
        "backup.confirmModel": { _, a in
            let showLoss = try optBool(a, "showLoss")
            return .object(Backup.confirmModel(try required(a, "state"), try objArg(a, "report"), showLoss: showLoss ?? true))
        },
        "backup.status": { e, a in .object(Backup.backupStatus(try required(a, "state"), conclusion: a["conclusion"], dates: e.dates)) },
        "backup.makeSafety": { e, a in
            let kind = try string(a, "kind")
            let now = try e.nowArg(a)
            return .object(Backup.makeSafety(try objArg(a, "state").objectValue!, kind: kind, now: now, backupDate: a["backupDate"], count: a["count"]))
        },
        "backup.endActiveSessions": { _, a in
            var d = try objArg(a, "draft").objectValue!
            Backup.endActiveSessions(&d)
            return .object(d)
        },
        "backup.safetyMatches": { _, a in .bool(Backup.safetyMatchesCurrent(try objArg(a, "state").objectValue!)) },
        "backup.conclusionOfSafety": { _, a in
            let state = try objArg(a, "state").objectValue!
            return Backup.conclusionOfSafety(Backup.safetyOf(state), state)
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
        "backup.clearAll": { e, a in
            let s = try e.session()
            return Backup.clearAllRecords(s.store, now: try e.nowArg(a))
        },
        "backup.undo": { e, _ in Backup.undoFromSafety(try e.session().store) },
        "backup.dropSafety": { e, _ in Backup.dropSafety(try e.session().store) },
        "backup.markExported": { e, a in
            let s = try e.session()
            let at = try finite(try required(a, "at"), "at")
            let sig = try optStr(a, "sig")
            return Backup.markExported(s.store, at: at, sig: sig)
        },
        "backup.export": { e, a in
            let s = try e.session()
            return .string(Backup.serializeBackup(.object(try Backup.buildBackupV2(s.store.state, now: try e.nowArg(a), serial: s.store.serial))))
        },

        // ---------------------------------------------------------------- migrate
        "migrate.readV1": { _, a in
            let strict = try optBool(a, "strict")
            return Migrate.readV1(try required(a, "data"), strict: strict ?? false)
        },
        "migrate.canonicalCardKey": { _, a in Migrate.canonicalCardKey(try required(a, "raw")).map { .string($0) } ?? .null },
        "migrate.spreadPerDayOf": { _, a in .number(Migrate.spreadPerDayOf(try policyOf(a))) },
        "migrate.convertV1": { e, a in
            let now = try finite(try required(a, "now"), "now")
            let policy = try policyOf(a)
            let dueBase = try optFinite(a, "dueBase")
            let source = try optStr(a, "source") ?? "device"
            let present = try optStrArr(a, "present") ?? []
            let bad = try optStrArr(a, "bad") ?? []
            let r = try Migrate.convertV1(try required(a, "values"), now: now, dueBase: dueBase, source: source, present: present, bad: bad, policy: policy, dates: e.dates)
            return .object(JSObject([("state", .object(r.state)), ("report", .object(r.report)), ("serial", .number(r.serial))]))
        },
        "migrate.legacyBackupToV2": { e, a in
            let obj = try required(a, "obj")
            let now = try e.nowArg(a)
            return Migrate.legacyBackupToV2(obj, now: now, policy: try policyOf(a), dates: e.dates)
        },
        "migrate.boot": { e, a in
            let s = try e.session()
            let at = try e.nowArg(a)
            return Migrate.bootMigration(s.store, now: { at }, policy: try policyOf(a))
        },
        "migrate.release": { e, a in
            let s = try e.session()
            let at = try e.nowArg(a)
            let policy = try policyOf(a)
            do { return .object(try Migrate.releaseLegacyKeys(s.store, now: at, policy: policy)) } catch {
                throw CoreError.error((error as? StoreJSError)?.messageOrString ?? String(describing: error))
            }
        },

        // ---------------------------------------------------------------- 原生校验和
        "native.checksum": { _, a in .string(NativeChecksum.checksum(try string(a, "raw"))) },
        "native.digestRows": { _, a in
            var rows: [(String, String)] = []
            for v in try arrArg(a, "rows") {
                guard case .array(let p) = v, p.count == 2, case .string(let k) = p[0], case .string(let r) = p[1] else { throw CoreError.badArgs("rows must be [key, raw] pairs") }
                rows.append((k, r))
            }
            let d = NativeChecksum.digestRows(rows)
            return .object(JSObject([("count", .number(Double(d.count))), ("bytes", .number(Double(d.bytes))), ("digest", .string(d.digest))]))
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
