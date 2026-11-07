import Foundation

// 1:1 移植自原 JS 版（B4.4）：单例状态 + commit 事务 + 订阅（01-架构设计 §4）。
//
// commit(label, mutate, reclaim:, replace:) → {ok:true, keys, recovered} | {ok:false, error:{kind, label, …}}，步骤照 JS：
//   草稿（按域拷贝）→ mutate(&draft, &ctx) → 脏键（序列化后与上次落盘的字串比）→ 形状校验 → 写前估算回收 → storage.writeAll
//   → 撞配额回收（旁路单键写 + 重试一次）→ 只有写成功才发布并通知订阅者。写失败不发布（D07）。
//
// 与 JS 的唯一机制差别：JS 靠「冻结 + 同一个引用」判断一个值没动过（plan 复用上次的落盘字串、旧 ink 月键原样保留、旁路回收挑出
// 变了的键）；Swift 是值类型，没有引用身份，改用 shallowSame：顶层浅比、子值按结构（含键序、数字逐位）全同。两者只在
// 「mutate 换进一个与原值深相等的拷贝、且落盘的原字串不是规范 JSON」时可能不同——JS 写出的值永远是规范 JSON（JSON.stringify），
// 所以对 App 写下的数据没有差别（随机差分 ④ 守住）。冻结本身（mutate 就地改已发布状态 → mutator 错）在 Swift 不会发生：草稿是副本。

public final class Store: ScheduleStore {
    public let storage: StoreStorage
    public let now: () -> Double
    public let budgets: Budgets
    public let dates: Dates
    /// 判断墨迹的存储编码（policy P05）：原生 'raw'（Ink v4），localStorage 'v3'。
    public let inkFormat: String

    public private(set) var state: JSObject
    public private(set) var serial: Double = 0
    var lastRaw = KeyMap<String>()
    var lastValues = KeyMap<JSValue>()
    var legacyInk = KeyMap<JSValue>()
    private var listeners: [(id: Int, fn: (JSObject, JSObject) -> Void)] = []
    private var nextListener = 0

    // status
    public private(set) var available = true
    public private(set) var unavailableKind: String?
    public private(set) var blocked: JSObject?
    public private(set) var corruptNotice: JSObject?
    public private(set) var usage: JSObject?
    /// 原生（App 注入）：设备剩余空间的读数（字节；量不到 = nil）。挂上之后 usage.level 按 DeviceSpaceRule 判
    /// （真实剩余空间 + 真写盘撞满），不再按估算总量 / quotaBytes；没挂（nil，缺省）= 网页 / JS 金样口径，与原来逐字节相同。
    /// 每次 refreshUsage（每次提交发布后）都会读一次：App 一侧自己缓存（NativeStore.swift DeviceFreeSpace）。
    public var deviceAvailableBytes: (() -> Double?)?
    /// 原生口径的阈值（缺省 policy.nativeStorage，P57）。
    public var deviceSpaceRule: DeviceSpaceRule = .policy
    /// 最近一次写盘撞满（write 失败、kind 'quota'；原生 = SQLITE_FULL → E_FULL）且之后还没有提交写成功过。只有原生口径读它。
    public private(set) var writeFull = false
    public private(set) var lastRepair: JSObject?
    public let backendInfo: JSObject
    public private(set) var inkSchema: JSObject?

    public init(storage: StoreStorage, now: @escaping () -> Double, budgets: JSObject? = nil, backendInfo: JSObject? = nil, inkFormat: String? = nil, dates: Dates = Dates(timeZone: .current)) {
        self.storage = storage
        self.now = now
        self.dates = dates
        self.budgets = Budgets.resolve(budgets)
        self.inkFormat = inkFormat ?? (storage.kind == "native" ? Config.policyString("nativeStorage.inkFormat")! : Config.policyString("inkFormat")!)
        var b = JSObject([("kind", .string(storage.kind))])
        for (k, v) in backendInfo?.entries ?? [] { b[k] = v }
        self.backendInfo = b
        self.state = Store.emptyState()
    }

    // MARK: 工具

    public static let domains = Schema.domains

    public static func emptyState() -> JSObject {
        JSObject(domains.map { ($0, Schema.isMonthlyDomain($0) ? JSValue.object(JSObject()) : .null) })
    }

    /// 订阅通知是不是「整体替换」（load / seed / replaceWithBackup / replace:true 的 commit）。
    public static func isReplacement(_ info: JSValue?) -> Bool {
        guard case .object(let o)? = info else { return false }
        return o["type"] == .string("load") || o["replace"] == .bool(true)
    }

    /// 结构全同（含键序、数字 ===）：JS「同一个引用」的值语义替身。
    static func same(_ a: JSValue, _ b: JSValue) -> Bool {
        switch (a, b) {
        case (.null, .null): return true
        case (.bool(let x), .bool(let y)): return x == y
        case (.number(let x), .number(let y)): return x == y
        case (.string(let x), .string(let y)): return utf8Equal(x, y)
        case (.array(let x), .array(let y)):
            if x.count != y.count { return false }
            for i in 0..<x.count where !same(x[i], y[i]) { return false }
            return true
        case (.object(let x), .object(let y)):
            if x.count != y.count { return false }
            let kx = x.keys, ky = y.keys
            for i in 0..<kx.count {
                guard UTF16Order.eq(kx[i], ky[i]), let vx = x[kx[i]], let vy = y[ky[i]], same(vx, vy) else { return false }
            }
            return true
        default: return false
        }
    }

    /// JS shallowEqual：数组逐元素、对象逐键（不看键序）比「同一个」。
    static func shallowEqual(_ a: JSValue?, _ b: JSValue?) -> Bool {
        guard let a = a, let b = b else { return a == nil && b == nil }
        switch (a, b) {
        case (.array(let x), .array(let y)):
            if x.count != y.count { return false }
            for i in 0..<x.count where !same(x[i], y[i]) { return false }
            return true
        case (.object(let x), .object(let y)):
            if x.count != y.count { return false }
            for (k, v) in x.entries {
                guard let w = y[k], same(v, w) else { return false }
            }
            return true
        default:
            return same(a, b)
        }
    }

    /// same，另加捷径：两边是同一块存储（写时复制的副本、都没改过）就直接算相同（任何一层）。
    /// 与 same 只在「共享的子值里有 NaN」时不同（same 认为 NaN ≠ NaN）；只给 plan 用，理由见 unchanged。
    static func sameOrShared(_ a: JSValue, _ b: JSValue) -> Bool {
        switch (a, b) {
        case (.null, .null): return true
        case (.bool(let x), .bool(let y)): return x == y
        case (.number(let x), .number(let y)): return x == y
        case (.string(let x), .string(let y)): return utf8Equal(x, y)
        case (.array(let x), .array(let y)):
            if x.count != y.count { return false }
            if sameRepresentation(x, y) { return true }
            for i in 0..<x.count where !sameOrShared(x[i], y[i]) { return false }
            return true
        case (.object(let x), .object(let y)):
            if x.count != y.count { return false }
            if x.sharesStorage(with: y) { return true }
            let kx = x.keys, ky = y.keys
            for i in 0..<kx.count {
                guard UTF16Order.eq(kx[i], ky[i]), let vx = x[kx[i]], let vy = y[ky[i]], sameOrShared(vx, vy) else { return false }
            }
            return true
        default: return false
        }
    }

    /// plan 的「这个键的值没动过」：与 shallowEqual(lastValues[key], value) 结论相同时照用；只在共享子值里有 NaN 时可能
    /// 说「没动过」而 shallowEqual 说「动过」——那时 plan 走 shallowEqual 那条路也是序列化后与 lastRaw 逐字节相同、不写，
    /// 结果一样（见 plan）。顶层对象键序与上次不同时退回 shallowEqual 本身（那条路的序列化与 lastRaw 不再必然相同）。
    static func unchanged(_ a: JSValue?, _ b: JSValue?) -> Bool {
        guard let a = a, let b = b else { return a == nil && b == nil }
        switch (a, b) {
        case (.array(let x), .array(let y)):
            if x.count != y.count { return false }
            if sameRepresentation(x, y) { return true }
            for i in 0..<x.count where !sameOrShared(x[i], y[i]) { return false }
            return true
        case (.object(let x), .object(let y)):
            if x.count != y.count { return false }
            if x.sharesStorage(with: y) { return true }
            let kx = x.keys, ky = y.keys
            var ordered = true
            for i in 0..<kx.count {
                if ordered && !UTF16Order.eq(kx[i], ky[i]) { ordered = false }
                guard let vx = x[kx[i]], let vy = y[kx[i]], sameOrShared(vx, vy) else { return false }
            }
            return ordered || shallowEqual(a, b)
        default:
            return sameOrShared(a, b)
        }
    }

    static func isEmptyMonth(_ v: JSValue?) -> Bool {
        guard let v = v else { return true }
        switch v {
        case .null: return true
        case .array(let a): return a.isEmpty
        case .object(let o): return o["folded"] != .bool(true) && o.isEmpty
        default: return false
        }
    }

    static func errorResult(_ kind: String, _ label: String, _ extra: [(String, JSValue)] = []) -> JSValue {
        .object(JSObject([("ok", .bool(false)), ("error", .object(JSObject([("kind", .string(kind)), ("label", .string(label))] + extra)))]))
    }

    static func opt(_ s: String?) -> JSValue { s.map { .string($0) } ?? .null }

    /// 状态 → 有序的 键 → 值（空月份、null 域不出现）。legacy：还没迁成单条键的旧 ink 月表（nil = 全部按单条键）。
    func stateToEntries(_ state: JSObject, legacy: KeyMap<JSValue>?) -> KeyMap<JSValue> {
        var map = KeyMap<JSValue>()
        for domain in Store.domains {
            guard let value = state[domain] else { continue }
            if domain == "ink" {
                for (month, table) in value.objectValue?.entries ?? [] {
                    if Store.isEmptyMonth(table) { continue }
                    if let l = legacy, let old = l[month], Store.shallowEqual(old, table) {
                        map[Schema.inkKey(month)] = table
                        continue
                    }
                    for (id, e) in table.objectValue?.entries ?? [] { map[Schema.inkRecordKey(month, id)] = e }
                }
            } else if Schema.isMonthlyDomain(domain) {
                for (month, v) in value.objectValue?.entries ?? [] {
                    if Store.isEmptyMonth(v) { continue }
                    map[(try? Schema.keyForDomain(domain, month: month)) ?? ""] = v
                }
            } else if !value.isNull {
                map[(try? Schema.keyForDomain(domain, month: nil)) ?? ""] = value
            }
        }
        return map
    }

    /// 已用序号的最大值：meta.serial、records（含折叠 kept）、sessions、ink 键。
    public static func deriveSerial(_ state: JSObject) -> Double {
        var maxV = 0.0
        if case .number(let s)? = state["meta"]?["serial"], s.isFinite, s.rounded(.towardZero) == s { maxV = s }
        func bump(_ id: JSValue?) {
            let s = Budget.serial(id)
            if s > maxV { maxV = s }
        }
        for (_, value) in state["records"]?.objectValue?.entries ?? [] {
            for rec in Budget.monthRecords(value) { bump(rec["id"]) }
        }
        if let sessions = state["sessions"], JSX.truthy(sessions) {
            let all = [sessions["A"], sessions["B"], sessions["lastEnded"]?["A"], sessions["lastEnded"]?["B"]]
            for s in all {
                guard let s = s, JSX.truthy(s) else { continue }
                bump(s["id"])
                for item in s["items"]?.arrayValue ?? [] { if let r = item["recordId"], JSX.truthy(r) { bump(r) } }
                if let ll = s["lastLine"], JSX.truthy(ll), let r = ll["recordId"], JSX.truthy(r) { bump(r) }
            }
        }
        for (_, table) in state["ink"]?.objectValue?.entries ?? [] {
            for id in table.objectValue?.keys ?? [] { bump(.string(id)) }
        }
        return maxV
    }

    /// meta.months 与 records 的非空月份一致；空月份从草稿删掉。
    static func syncMonths(_ draft: inout JSObject) {
        if case .object(var r)? = draft["records"] {
            for m in r.keys where isEmptyMonth(r[m]) { r[m] = nil }
            draft["records"] = .object(r)
        }
        if case .object(var ink)? = draft["ink"] {
            for m in ink.keys where isEmptyMonth(ink[m]) { ink[m] = nil }
            draft["ink"] = .object(ink)
        }
        guard case .object(var meta)? = draft["meta"] else { return }
        let months = UTF16Order.sorted(draft["records"]?.objectValue?.keys ?? [])
        let current = meta["months"]?.arrayValue ?? []
        if current.count == months.count && zip(current, months).allSatisfy({ JS.isString($0, $1) }) { return }
        meta["months"] = .array(months.map { .string($0) })
        draft["meta"] = .object(meta)
    }

    // MARK: 墨迹读写 helper

    /// 读一条记录的墨迹：state.ink[inkMonthOf(record)][inkIdOf(record)]；没有返回 nil。
    public static func getInk(_ state: JSObject, _ record: JSValue, timeZone: TimeZone) -> JSValue? {
        guard let month = Schema.inkMonthOf(record, timeZone: timeZone), let id = Schema.inkIdOf(record), case .object(let ink)? = state["ink"] else { return nil }
        guard case .object(let table)? = ink[month] else { return nil }
        return table[id]
    }

    /// 在草稿里写一条记录的墨迹（ink 为 nil 等于 deleteInk）。返回 {month, id}（删除时返回是否删到）。
    @discardableResult
    public static func setInk(_ draft: inout JSObject, _ record: JSValue, _ ink: JSValue?, timeZone: TimeZone) throws -> JSValue {
        guard let ink = ink else { return .bool(deleteInk(&draft, record, timeZone: timeZone)) }
        guard let month = Schema.inkMonthOf(record, timeZone: timeZone), let id = Schema.inkIdOf(record) else {
            throw CoreError.error("setInk: record has no month or id")
        }
        var all = draft["ink"]?.objectValue ?? JSObject()
        var next = all[month]?.objectValue ?? JSObject()
        next[id] = ink
        all[month] = .object(next)
        draft["ink"] = .object(all)
        return .object(JSObject([("month", .string(month)), ("id", .string(id))]))
    }

    /// 在草稿里删一条记录的墨迹；返回是否删到了。
    @discardableResult
    public static func deleteInk(_ draft: inout JSObject, _ record: JSValue, timeZone: TimeZone) -> Bool {
        guard let month = Schema.inkMonthOf(record, timeZone: timeZone), let id = Schema.inkIdOf(record),
              case .object(var all)? = draft["ink"], case .object(var table)? = all[month], table[id] != nil else { return false }
        table[id] = nil
        all[month] = .object(table)
        draft["ink"] = .object(all)
        return true
    }

    public func getInk(_ record: JSValue) -> JSValue? { Store.getInk(state, record, timeZone: dates.timeZone) }

    // MARK: 订阅

    @discardableResult
    public func subscribe(_ fn: @escaping (JSObject, JSObject) -> Void) -> () -> Void {
        let id = nextListener
        nextListener += 1
        listeners.append((id, fn))
        return { [weak self] in self?.listeners.removeAll { $0.id == id } }
    }

    private func notify(_ info: JSObject) {
        for l in listeners { l.fn(state, info) }
    }

    // MARK: 状态

    public var status: JSObject {
        JSObject([
            ("available", .bool(available)), ("unavailableKind", Store.opt(unavailableKind)), ("blocked", blocked.map { .object($0) } ?? .null),
            ("corruptNotice", corruptNotice.map { .object($0) } ?? .null), ("usage", usage.map { .object($0) } ?? .null),
            ("lastRepair", lastRepair.map { .object($0) } ?? .null), ("backend", .object(backendInfo)), ("inkSchema", inkSchema.map { .object($0) } ?? .null),
        ])
    }

    @discardableResult
    public func refreshUsage() -> JSObject? {
        let estimate = try? storage.estimateUsage(budgets)
        // QA 夹具 setUsage（usageOverride）照原样报：界面取证要能造出 warn / full
        if let read = deviceAvailableBytes, storage.usageOverride == nil {
            usage = Budget.deviceUsage(estimate ?? JSObject([("total", .number(0)), ("byBucket", .object(JSObject()))]), availableBytes: read(), writeFull: writeFull, rule: deviceSpaceRule)
        } else {
            usage = estimate
        }
        return usage
    }

    /// 调度模拟器的镜像 store（SchedOps runStore store:"core"）：序号跟 JS 的真 store 对齐。
    func setSerial(_ s: Double) { serial = s }

    /// 坏值顶部提示显示过后调用；本次启动不再提示。
    public func ackCorruptNotice() { corruptNotice = nil }

    // MARK: 读

    func readState() -> (next: JSObject, raws: KeyMap<String>, legacy: KeyMap<JSValue>) {
        var next = Store.emptyState()
        var raws = KeyMap<String>()
        var monthTables = KeyMap<JSValue>()
        var recordTables = KeyMap<JSObject>()
        // repair 刚对同一份原文 parseAndValidate 过：原文逐字节相同就用它的结果（parseAndValidate 只取决于 key 与原文），不同或没有就照常解析校验。
        let parsedByRepair = storage.takeRepairParsed()
        let all = (try? storage.readAll(Schema.v2Prefix)) ?? []
        for (key, rawOpt) in all {
            guard let spec = Schema.specForKey(key), let domain = spec.domain, let raw = rawOpt else { continue }
            let value: JSValue
            if let hit = parsedByRepair[key], utf8Equal(hit.raw, raw) {
                value = hit.value
            } else {
                guard case .ok(let v) = Schema.parseAndValidate(key: key, raw: .string(raw)) else { continue }
                value = v
            }
            raws[key] = raw
            validatedValues[key] = value
            if spec.id == "inkRecord" {
                let p = Schema.parseInkRecordKey(key)!
                var t = recordTables[p.month] ?? JSObject()
                t[p.id] = value
                recordTables[p.month] = t
            } else if spec.id == "ink" {
                monthTables[Schema.monthOfKey(key)!] = value
            } else if Schema.isMonthlyDomain(domain) {
                var m = next[domain]?.objectValue ?? JSObject()
                m[Schema.monthOfKey(key)!] = value
                next[domain] = .object(m)
            } else {
                next[domain] = value
            }
        }
        var legacy = KeyMap<JSValue>()
        var months = KeySet(monthTables.keys)
        for m in recordTables.keys { months.insert(m) }
        var ink = next["ink"]?.objectValue ?? JSObject()
        for month in months {
            let old = monthTables[month]
            let rows = recordTables[month]
            var merged = old?.objectValue ?? JSObject()
            for (id, v) in rows?.entries ?? [] { merged[id] = v }
            ink[month] = .object(merged)
            if let o = old, rows == nil { legacy[month] = o }
        }
        next["ink"] = .object(ink)
        return (next, raws, legacy)
    }

    func inkSchemaReport(schema: Int, legacyMonths: Int) -> JSObject {
        JSObject([("schema", .number(Double(schema))), ("legacyMonths", .number(Double(legacyMonths))), ("migrated", .number(0)), ("records", .number(0)), ("failed", .null)])
    }

    /// ink schema 1 → 2：把旧月键逐月改成单条键（每月一个事务；失败这个月回滚、停止、记诊断）。
    func migrateInkSchema() -> JSObject {
        let started = now()
        let months = UTF16Order.sorted(legacyInk.keys)
        var report = inkSchemaReport(schema: months.isEmpty ? 2 : 1, legacyMonths: months.count)
        if months.isEmpty { return report }
        var migrated = 0.0, recs = 0.0
        var failed: JSObject? = nil
        for month in months {
            let table = state["ink"]?[month]?.objectValue ?? JSObject()
            var entries: [(String, String?)] = []
            var bad: JSObject? = nil
            for (id, e) in table.entries {
                let err = Schema.isRecordId(id) ? Schema.validateInk(e, path: month + "." + id) : month + "." + id + ": bad record id"
                if let err = err {
                    bad = JSObject([("month", .string(month)), ("id", .string(id)), ("stage", .string("validate")), ("reason", .string(err))])
                    break
                }
                entries.append((Schema.inkRecordKey(month, id), JSONWriter.stringify(e)))
            }
            if let b = bad {
                failed = b
                break
            }
            entries.append((Schema.inkKey(month), nil))
            if let f = write(entries, "ink-schema-2") {
                failed = JSObject([("month", .string(month)), ("stage", .string("write")), ("error", f["kind"]!), ("reason", f["reason"]!)])
                break
            }
            legacyInk[month] = nil
            for (k, r) in entries {
                if let r = r { lastRaw[k] = r } else { lastRaw[k] = nil }
            }
            migrated += 1
            recs += Double(entries.count - 1)
        }
        report["migrated"] = .number(migrated)
        report["records"] = .number(recs)
        report["failed"] = failed.map { .object($0) } ?? .null
        lastValues = stateToEntries(state, legacy: legacyInk)
        report["schema"] = .number(legacyInk.count > 0 ? 1 : 2)
        report["ms"] = .number(now() - started)
        if let f = failed {
            var entry = JSObject([("kind", .string("ink-schema-2-failed"))])
            for (k, v) in f.entries { entry[k] = v }
            if storage.backend.supportsDiag { storage.backend.diag(entry) }
        }
        return report
    }

    /// 启动：探测 → repair → 读全部 v2 键 → ink schema 迁移。返回 {available, repair, corruptNotice} | {available:false, kind}。
    @discardableResult
    public func load() -> JSObject {
        let probe = storage.probe()
        if !probe.ok {
            available = false
            unavailableKind = probe.kind
            state = Store.emptyState()
            lastRaw = KeyMap()
            lastValues = KeyMap()
            legacyInk = KeyMap()
            notify(JSObject([("type", .string("status"))]))
            return JSObject([("available", .bool(false)), ("kind", Store.opt(probe.kind))])
        }
        available = true
        unavailableKind = nil
        let report: JSObject
        do {
            report = try storage.repair()
        } catch {
            available = false
            unavailableKind = (error as? StoreJSError)?.kind ?? "unknown"
            notify(JSObject([("type", .string("status"))]))
            return JSObject([("available", .bool(false)), ("kind", Store.opt(unavailableKind))])
        }
        lastRepair = report
        if let b = storage.blocked {
            blocked = JSObject([("reason", .string(b.reason)), ("keys", .array(b.keys.map { .string($0) }))])
        } else {
            blocked = nil
        }
        if let q = report["quarantined"]?.arrayValue, !q.isEmpty {
            corruptNotice = JSObject([("keys", .array(q.map { $0["key"] ?? .null }))])
        }
        validatedValues = KeyMap()
        childTexts = [:]
        let (next, raws, legacy) = readState()
        state = next
        lastRaw = raws
        legacyInk = legacy
        lastValues = stateToEntries(state, legacy: legacyInk)
        serial = Store.deriveSerial(state)
        inkSchema = blocked != nil ? inkSchemaReport(schema: legacyInk.count > 0 ? 1 : 2, legacyMonths: legacyInk.count) : migrateInkSchema()
        refreshUsage()
        notify(JSObject([("type", .string("load"))]))
        return JSObject([("available", .bool(true)), ("repair", .object(report)), ("corruptNotice", corruptNotice.map { .object($0) } ?? .null)])
    }

    /// 重新从存储读（测试钩子 reset 之后等）。
    @discardableResult
    public func reload() -> JSObject { load() }

    // MARK: 写

    struct Plan {
        var entries: [(String, String?)] = []
        var raws = KeyMap<String>()
        var error: (kind: String, key: String, reason: String)?
        /// 算这个 plan 用的 stateToEntries(draft)；之后草稿又被改过（回收没回收到东西也可能动草稿）就置 nil。
        /// publish 发布的正是这个草稿时，它就是 publish 要重算的 lastValues（见 publish）。
        var next: KeyMap<JSValue>?
    }

    private func plan(_ draft: JSObject, convertAll: Bool) -> Plan {
        let next = stateToEntries(draft, legacy: convertAll ? nil : legacyInk)
        var p = Plan()
        p.next = next
        for (key, value) in next.entries {
            if let last = lastRaw[key], Store.unchanged(lastValues[key], value) {
                p.raws[key] = last
                continue
            }
            let raw = stringify(key, value)
            p.raws[key] = raw
            if rawEq(lastRaw[key], raw) { continue }
            if let err = validate(key, value) {
                p.error = ("shape", key, err)
                return p
            }
            p.entries.append((key, raw))
        }
        for key in lastRaw.keys where !next.has(key) { p.entries.append((key, nil)) }
        return p
    }

    // MARK: 校验与序列化的增量做法（结果与整值的 Schema.validateValue / JSONWriter.stringify 逐字相同）

    /// 每个键上一次「整值校验通过」的值：读盘时 parseAndValidate 通过的，或 plan 里 validate 通过的。
    /// 「validateValue(key, 这个值) == nil」是关于这个值本身的事实，永不过期；这里持有它，它的存储也就不会被回收重用。
    var validatedValues = KeyMap<JSValue>()
    /// 键 → 子键 → (子值, 它的 JSON 文本)：上次在 plan 里序列化这个键时各子值的文本（持有子值，理由同上）。
    private var childTexts = [JSKey: [JSKey: (value: JSValue, text: String)]]()

    /// 两个值显然是同一个值：容器是同一块存储；数逐位、串逐字节相同。true ⇒ 校验结论、序列化文本都相同。
    static func samePayload(_ a: JSValue, _ b: JSValue) -> Bool {
        switch (a, b) {
        case (.null, .null): return true
        case (.bool(let x), .bool(let y)): return x == y
        case (.number(let x), .number(let y)): return x.bitPattern == y.bitPattern
        case (.string(let x), .string(let y)): return utf8Equal(x, y)
        case (.array(let x), .array(let y)): return sameRepresentation(x, y)
        case (.object(let x), .object(let y)): return x.sharesStorage(with: y)
        default: return false
        }
    }

    /// 校验是「逐条独立」的映射的键（Schema.keySpecs 里 validate 只是 checkMap(x, 只由键决定的 path, keyOk, each)：
    /// 每条只看自己的子键与子值、报第一条错）。改 keySpecs 里这几项的校验时要一并看这里。
    static let entryLocalMaps: Set<String> = ["sched", "wordOff", "photos", "ink"]

    /// = Schema.validateValue(key: key, value: value)；通过时记下这个值。
    func validate(_ key: String, _ value: JSValue) -> String? {
        let err = Store.validate(key, value, previous: validatedValues[key])
        if err == nil { validatedValues[key] = value }
        return err
    }

    /// = Schema.validateValue(key: key, value: value)，利用同一个键上一次整值校验通过的值 previous 只校验变了的部分：
    /// · 逐条独立的映射：checkMap 按 keys 序逐条查、报第一条错；与 previous 同子键且同一个值的那条当时查过没错（查法只看子键与子值），
    ///   现在也没错——所以第一条错一定在其余各条里，按原来的次序只查它们（子集按原序插入，keys 序不变；path 只由键决定），结论相同。
    /// · records 月表（数组）且 previous 是它逐元素相同的前缀（追加）：前缀里每条的 validateRecord 与递增检查只看前缀，当时都过了；
    ///   从前缀之后照 Schema.validateRecordList 的同一个循环接着查（prev 接前缀最后一条的序号），结论相同。
    /// 其余一律整值校验。
    static func validate(_ key: String, _ value: JSValue, previous: JSValue?) -> String? {
        guard let prev = previous, let spec = Schema.specForKey(key) else { return Schema.validateValue(key: key, value: value) }
        if entryLocalMaps.contains(spec.id), case .object(let v) = value, case .object(let p) = prev {
            var changed = JSObject()
            for (k, e) in v.entries {
                if let pe = p[k], samePayload(pe, e) { continue }
                changed[k] = e
            }
            return Schema.validateValue(key: key, value: .object(changed))
        }
        if spec.id == "records", case .array(let v) = value, case .array(let p) = prev, v.count >= p.count,
           !(0..<p.count).contains(where: { !samePayload(v[$0], p[$0]) }) {
            let month = Schema.monthOfRecordsKey(key)
            var last = p.isEmpty ? 0.0 : Schema.serialOf(v[p.count - 1]["id"]?.stringValue ?? "")
            for i in p.count..<v.count {
                let r = v[i]
                if let err = Schema.validateRecord(r, path: key + "[" + String(i) + "]", month: month) { return err }
                let serial = Schema.serialOf(r["id"]?.stringValue ?? "")
                if serial <= last { return Schema.fail(key + "[" + String(i) + "].id", "ids must be strictly ascending") }
                last = serial
            }
            return nil
        }
        return Schema.validateValue(key: key, value: value)
    }

    /// = JSONWriter.stringify(value)。大的对象 / 数组按子值拼：JSONWriter 写对象 = 「{」+ 按 keys 序的「"键":子值文本」以「,」相连 +「}」，
    /// 数组同理，子值文本就是 stringify(子值)；与上次同一个子值（samePayload）的文本直接沿用。
    func stringify(_ key: String, _ value: JSValue) -> String {
        let jk = JSKey(s: key)
        switch value {
        case .object(let o) where o.count >= 16:
            let old = childTexts[jk] ?? [:]
            var memo = [JSKey: (value: JSValue, text: String)](minimumCapacity: o.count)
            var out = "{"
            for (n, e) in o.entries.enumerated() {
                if n > 0 { out += "," }
                JSONWriter.quote(e.key, into: &out)
                out += ":"
                let ck = JSKey(s: e.key)
                let text: String
                if let hit = old[ck], Store.samePayload(hit.value, e.value) { text = hit.text } else { text = JSONWriter.stringify(e.value) }
                out += text
                memo[ck] = (e.value, text)
            }
            out += "}"
            childTexts[jk] = memo
            return out
        case .array(let a) where a.count >= 16:
            let old = childTexts[jk] ?? [:]
            var memo = [JSKey: (value: JSValue, text: String)](minimumCapacity: a.count)
            var out = "["
            for (n, e) in a.enumerated() {
                if n > 0 { out += "," }
                // 子键只为命中：记录按 id，其余按下标；沿用与否只看 samePayload
                let ck: JSKey
                if case .string(let id)? = e["id"] { ck = JSKey(s: "id:" + id) } else { ck = JSKey(s: "#" + String(n)) }
                let text: String
                if let hit = old[ck], Store.samePayload(hit.value, e) { text = hit.text } else { text = JSONWriter.stringify(e) }
                out += text
                memo[ck] = (e, text)
            }
            out += "]"
            childTexts[jk] = memo
            return out
        default:
            return JSONWriter.stringify(value)
        }
    }

    private func projectedTotal(_ entries: [(String, String?)]) -> Double {
        let base = usage?["total"]?.numberValue ?? 0
        var delta = 0.0
        for (k, r) in entries { delta += Budget.entryBytes(k, r) - Budget.entryBytes(k, lastRaw[k]) }
        return base + delta
    }

    private func quotaNeedBytes(_ entries: [(String, String?)]) -> Double {
        var total = 1024.0
        for (k, r) in entries { total += max(0, Budget.entryBytes(k, r) - Budget.entryBytes(k, lastRaw[k])) }
        return total
    }

    private func txnBytes(_ entries: [(String, String?)]) -> Double {
        entries.reduce(0) { $0 + Budget.entryBytes($1.0, lastRaw[$1.0]) }
    }

    /// 撞配额后的旁路回收（本次没要写的月键逐键单写并立即发布）。返回 (written, blocked)。
    private func persistSideRecovery(_ draft: inout JSObject, _ dirty: Set<JSKey>, _ label: String) -> (written: [String], blocked: JSObject?) {
        let next = stateToEntries(draft, legacy: legacyInk)
        struct Side { let key: String, raw: String?, size: Double }
        var side: [Side] = []
        for (key, oldRaw) in lastRaw.entries {
            if dirty.contains(JSKey(s: key)) { continue }
            guard let spec = Schema.specForKey(key), let d = spec.domain, Schema.isMonthlyDomain(d) else { continue }
            if spec.id == "ink" { continue }
            if !next.has(key) {
                side.append(Side(key: key, raw: nil, size: Budget.entryBytes(key, oldRaw)))
            } else if !Store.shallowEqual(lastValues[key], next[key]) {
                let value = next[key]!
                if Schema.validateValue(key: key, value: value) != nil { continue }
                side.append(Side(key: key, raw: JSONWriter.stringify(value), size: Budget.entryBytes(key, oldRaw)))
            }
        }
        side = side.jsSorted { x, y in
            let d = x.size - y.size
            if !d.isNaN && d != 0 { return d }
            return UTF16Order.less(x.key, y.key) ? -1 : 1
        }
        var written: [String] = []
        for s in side {
            let spec = Schema.specForKey(s.key)!
            let domain = spec.domain!
            let one = Schema.parseInkRecordKey(s.key)
            let month = one?.month ?? Schema.monthOfKey(s.key)!
            let failure = write([(s.key, s.raw)], label + ":recover", single: true)
            if let f = failure, f["kind"] == .string("blocked") { return (written, f) }
            let published = state[domain]?.objectValue ?? JSObject()
            if failure != nil {
                if case .object = draft[domain] {} else { draft[domain] = .object(JSObject()) }
                var dd = draft[domain]!.objectValue!
                if let o = one {
                    if case .object(let table)? = published[month], let v = table[o.id] {
                        var t = dd[month]?.objectValue ?? JSObject()
                        t[o.id] = v
                        dd[month] = .object(t)
                    }
                } else if let pv = published[month] {
                    dd[month] = pv
                }
                draft[domain] = .object(dd)
                continue
            }
            var domainNext = published
            if let o = one {
                var table = published[month]?.objectValue ?? JSObject()
                if s.raw == nil { table[o.id] = nil } else { table[o.id] = next[s.key]! }
                if table.isEmpty { domainNext[month] = nil } else { domainNext[month] = .object(table) }
            } else if s.raw == nil {
                domainNext[month] = nil
            } else {
                domainNext[month] = next[s.key]!
            }
            state[domain] = .object(domainNext)
            if let r = s.raw { lastRaw[s.key] = r } else { lastRaw[s.key] = nil }
            lastValues = stateToEntries(state, legacy: legacyInk)
            written.append(s.key)
        }
        if !written.isEmpty {
            refreshUsage()
            notify(JSObject([("type", .string("recover")), ("label", .string(label)), ("keys", .array(written.map { .string($0) }))]))
        }
        return (written, nil)
    }

    /// sizesOf 的键分类（1 = records 月键、2 = ink 存储键、0 = 其它）按键记住：只看键本身（纯函数），每次提交都要对全部键各分一次。
    private var keyKinds = [JSKey: UInt8]()

    private func sizesOf(_ raws: KeyMap<String>) -> (records: Double, ink: Double) {
        var r = 0.0, i = 0.0
        if keyKinds.count > 2 * raws.count + 1024 { keyKinds = [:] }
        for (k, raw) in raws.entries {
            let jk = JSKey(s: k)
            let kind: UInt8
            if let known = keyKinds[jk] {
                kind = known
            } else {
                kind = Schema.isRecordsKey(k) ? 1 : Schema.isInkStorageKey(k) ? 2 : 0
                keyKinds[jk] = kind
            }
            if kind == 1 { r += Budget.entryBytes(k, raw) } else if kind == 2 { i += Budget.entryBytes(k, raw) }
        }
        return (r, i)
    }

    /// 写入；失败返回 {kind, key, reason}（blocked 时同时置 status.blocked 并通知）。
    private func write(_ entries: [(String, String?)], _ label: String, single: Bool = false) -> JSObject? {
        do {
            if single { try storage.writeOne(entries[0].0, entries[0].1, label: label) } else { try storage.writeAll(entries, label: label) }
            return nil
        } catch {
            let e = StoreStorage.jsError(error)
            if e.cls == .blocking {
                blocked = JSObject([("reason", .string(e.reason ?? "rollback-failed")), ("keys", .array(e.keys.map { .string($0) }))])
                notify(JSObject([("type", .string("status"))]))
                return JSObject([("kind", .string("blocked")), ("key", .null), ("reason", .string(e.message))])
            }
            if e.kind == "quota" { writeFull = true }
            return JSObject([("kind", .string(e.kind ?? "unknown")), ("key", Store.opt(e.key)), ("reason", .string(e.messageOrString))])
        }
    }

    /// entries：算出 raws 的那个 plan 的 next（草稿之后没再改过时）。它等于 stateToEntries(draft, legacy: 剪过的 legacyInk)：
    /// plan 保留旧月键 ⇔ raws 里有那个月键 ⇔ 剪完 legacyInk 还留着那个月（且旧表、草稿都没变，shallowEqual 结论相同）；
    /// 其余月 plan 拆成单条键，剪完的 legacyInk 里也没有它，同样拆。convertAll（legacy nil）时剪完的 legacyInk 不含草稿里的任何月，同。
    private func publish(_ draft: JSObject, _ raws: KeyMap<String>, _ nextSerial: Double, _ info: JSObject, entries: KeyMap<JSValue>? = nil) {
        state = draft
        lastRaw = raws
        for month in legacyInk.keys where !raws.has(Schema.inkKey(month)) { legacyInk[month] = nil }
        if legacyInk.count == 0, var s = inkSchema, s["schema"] == .number(1) {
            s["schema"] = .number(2)
            inkSchema = s
        }
        lastValues = entries ?? stateToEntries(state, legacy: legacyInk)
        serial = nextSerial
        refreshUsage()
        notify(info)
    }

    private func persist(_ draft0: JSObject, _ label: String, _ nextSerial: Double, allowRecover: Bool, replace: Bool) -> JSValue {
        var draft = draft0
        let tag: [(String, JSValue)] = replace ? [("replace", .bool(true))] : []
        let nowMs = now()
        Store.syncMonths(&draft)
        var p = plan(draft, convertAll: replace)
        if let e = p.error { return Store.errorResult(e.kind, label, [("key", .string(e.key)), ("reason", .string(e.reason))]) }
        if p.entries.isEmpty {
            publish(draft, p.raws, nextSerial, JSObject([("type", .string("commit")), ("label", .string(label)), ("keys", .array([]))] + tag), entries: p.next)
            return .object(JSObject([("ok", .bool(true)), ("keys", .array([])), ("recovered", .array([]))]))
        }
        var recovered: [JSValue] = []
        if allowRecover {
            let need = Budget.needsRecovery(draft, now: nowMs, budgets: budgets, totalBytes: projectedTotal(p.entries), sizes: sizesOf(p.raws), dates: dates)
            if need["any"] == .bool(true) {
                let r = Budget.recover(&draft, now: nowMs, budgets: budgets, dates: dates)
                if !r.actions.isEmpty {
                    recovered += r.actions
                    Store.syncMonths(&draft)
                    p = plan(draft, convertAll: replace)
                    if let e = p.error { return Store.errorResult(e.kind, label, [("key", .string(e.key)), ("reason", .string(e.reason))]) }
                } else {
                    p.next = nil
                }
            }
        }
        var failure = write(p.entries, label)
        if let f = failure, f["kind"] == .string("quota"), allowRecover, !JS.isString(f["key"], Schema.keyNamed("txn")!) {
            var dirty = Set<JSKey>()
            for (k, _) in p.entries { dirty.insert(JSKey(s: k)) }
            let r = Budget.recover(&draft, now: nowMs, budgets: budgets, force: true, needBytes: quotaNeedBytes(p.entries) + txnBytes(p.entries), dates: dates)
            if !r.actions.isEmpty {
                recovered += r.actions
                Store.syncMonths(&draft)
                let side = persistSideRecovery(&draft, dirty, label)
                if let b = side.blocked {
                    return Store.errorResult("blocked", label, [("key", b["key"] ?? .null), ("reason", b["reason"] ?? .null), ("recoveredAttempted", .bool(true))])
                }
                Store.syncMonths(&draft)
                p = plan(draft, convertAll: replace)
                if let e = p.error { return Store.errorResult(e.kind, label, [("key", .string(e.key)), ("reason", .string(e.reason))]) }
                failure = write(p.entries, label)
            } else {
                p.next = nil
            }
        }
        if let f = failure {
            refreshUsage()
            return Store.errorResult(f["kind"]!.stringValue!, label, [("key", f["key"] ?? .null), ("reason", f["reason"] ?? .null), ("recoveredAttempted", .bool(!recovered.isEmpty))])
        }
        let keys: [JSValue] = p.entries.map { .string($0.0) }
        writeFull = false // 这次真的写进去了（空提交不算：没写过盘，证明不了有空间）
        publish(draft, p.raws, nextSerial, JSObject([("type", .string("commit")), ("label", .string(label)), ("keys", .array(keys)), ("recovered", .array(recovered))] + tag), entries: p.next)
        return .object(JSObject([("ok", .bool(true)), ("keys", .array(keys)), ("recovered", .array(recovered))]))
    }

    private func guardBlocked(_ label: String) -> JSValue? {
        if !available { return Store.errorResult("unavailable", label, [("reason", Store.opt(unavailableKind))]) }
        if let b = blocked { return Store.errorResult("blocked", label, [("keys", b["keys"] ?? .array([]))]) }
        return nil
    }

    static func buildDraft(_ state: JSObject) -> JSObject {
        JSObject(domains.map { d in
            if Schema.isMonthlyDomain(d) { return (d, JSValue.object(state[d]?.objectValue ?? JSObject())) }
            return (d, state[d] ?? .null)
        })
    }

    static func mutatorReason(_ error: Error) -> String {
        if let c = error as? CoreError { return c.message }
        if let s = error as? StoreJSError { return s.messageOrString }
        return String(describing: error)
    }

    /// 一次提交（ScheduleStore）。
    public func commit(_ label: String, _ mutate: (inout JSObject, inout CommitContext) throws -> Void) -> JSValue {
        commit(label, reclaim: true, replace: false, mutate)
    }

    /// reclaim:false —— 不做预算回收（保护副本 / 替换 / 撤销 / 清空 / 迁移）；replace:true —— 通知带 replace:true。
    public func commit(_ label: String, reclaim: Bool = true, replace: Bool = false, _ mutate: (inout JSObject, inout CommitContext) throws -> Void) -> JSValue {
        if let r = guardBlocked(label) { return r }
        var draft = Store.buildDraft(state)
        var ctx = CommitContext(now: now(), label: label, serial: serial)
        ctx.inkFormat = inkFormat
        do {
            try mutate(&draft, &ctx)
        } catch {
            return Store.errorResult("mutator", label, [("reason", .string(Store.mutatorReason(error)))])
        }
        let nextSerial = ctx.serial
        for d in draft.keys where !Store.domains.contains(d) {
            return Store.errorResult("shape", label, [("reason", .string("unknown domain " + d))])
        }
        guard case .object = draft["records"] else { return Store.errorResult("shape", label, [("reason", .string("records must be an object"))]) }
        if draft["ink"] == nil || draft["ink"] == .null { draft["ink"] = .object(JSObject()) }
        guard case .object = draft["ink"] else { return Store.errorResult("shape", label, [("reason", .string("ink must be an object of months"))]) }
        for d in ["records", "ink"] {
            for m in draft[d]!.objectValue!.keys where !Schema.isMonthKey(m) {
                return Store.errorResult("shape", label, [("reason", .string(d + " month " + m + " is not YYYY-MM"))])
            }
        }
        if nextSerial != serial, case .object(var meta)? = draft["meta"], !JS.strictEquals(meta["serial"], .number(nextSerial)) {
            meta["serial"] = .number(nextSerial)
            draft["meta"] = .object(meta)
        }
        return persist(draft, label, nextSerial, allowRecover: reclaim, replace: replace)
    }

    /// seed：整体替换全部 v2 域（未给出的域删除），校验形状，不回收。
    public func seed(_ input: JSValue, label: String = "test-seed") -> JSValue {
        if let r = guardBlocked(label) { return r }
        guard case .object(let obj) = input else { return Store.errorResult("shape", label, [("reason", .string("state must be an object"))]) }
        for k in obj.keys where !Store.domains.contains(k) {
            return Store.errorResult("shape", label, [("reason", .string("unknown domain " + k))])
        }
        var draft = Store.emptyState()
        for d in Store.domains {
            guard let v = obj[d], !v.isNull else { continue }
            draft[d] = v
        }
        for d in ["records", "ink"] {
            guard case .object(let o)? = draft[d] else { return Store.errorResult("shape", label, [("reason", .string(d + " must be an object of months"))]) }
            for m in o.keys where !Schema.isMonthKey(m) {
                return Store.errorResult("shape", label, [("reason", .string(d + " month " + m + " is not YYYY-MM"))])
            }
        }
        return persist(draft, label, Store.deriveSerial(draft), allowRecover: false, replace: true)
    }

    /// 用 v2 备份替换全部白名单域（sessions / funnel / safety 不动）。任一键坏 → 整单拒绝。mutate：落盘前再改草稿（同一次写入）。
    public func replaceWithBackup(_ obj: JSValue, label: String = "restore-backup", mutate: ((inout JSObject) throws -> Void)? = nil) -> JSValue {
        if let r = guardBlocked(label) { return r }
        let parsed = Schema.parseBackupV2(obj)
        guard parsed["ok"] == .bool(true) else {
            func orNull(_ v: JSValue?) -> JSValue { if let v = v, JSX.truthy(v) { return v }; return .null }
            return Store.errorResult("invalid", label, [("reason", parsed["reason"] ?? .null), ("key", orNull(parsed["key"])), ("detail", orNull(parsed["detail"]))])
        }
        var draft = Store.buildDraft(state)
        for d in Schema.backupWhitelist { draft[d] = Schema.isMonthlyDomain(d) ? .object(JSObject()) : .null }
        for e in parsed["entries"]?.arrayValue ?? [] {
            guard let pair = e.arrayValue, let key = pair[0].stringValue, let raw = pair[1].stringValue,
                  let spec = Schema.specForKey(key), let d = spec.domain, let value = try? JSONParser.parse(raw) else { continue }
            if Schema.isMonthlyDomain(d) {
                var m = draft[d]!.objectValue!
                m[Schema.monthOfKey(key)!] = value
                draft[d] = .object(m)
            } else {
                draft[d] = value
            }
        }
        if let mutate = mutate {
            do { try mutate(&draft) } catch {
                return Store.errorResult("mutator", label, [("reason", .string(Store.mutatorReason(error)))])
            }
        }
        let result = persist(draft, label, max(Store.deriveSerial(draft), serial), allowRecover: false, replace: true)
        if result["ok"] == .bool(true) {
            if let keys = try? storage.listKeys(Schema.corruptPrefix) { _ = try? storage.removeKeys(keys) }
            corruptNotice = nil
            refreshUsage()
        }
        return result
    }
}
