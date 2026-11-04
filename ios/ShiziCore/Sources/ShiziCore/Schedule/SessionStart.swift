import Foundation

// 开组的 store.commit 包装（首练 / 今天的练习 / 自选 / S02 / 跨天过期 / 特别组顺延）的移植（B4.2）。
// D83（调度规则 v2）起：今天的练习一天一份（TodayPlan），写完以后再开的是「再来一组」（extra）；离开很久回来的摊开（D66 ⑨）删除。
//
// store 是协议 ScheduleStore（state + commit(label, mutate)）：commit 语义照原 JS 的 store——草稿 = 当前状态的浅拷贝，
// mutate 抛错 → {ok:false, error:{kind:'mutator', label, reason}}，成功才发布；ctx.nextId('r'|'s') 分配共用序号。
// 真正的持久化 store 在 B4.4；这里给一个内存实现 MemoryScheduleStore（差分 op 与转写单测用，也可注入写失败）。

public struct CommitContext {
    public let now: Double
    public let label: String
    public internal(set) var serial: Double
    /// 判断墨迹的存储编码（ctx.inkFormat，policy P05）：原生 'raw'，localStorage 'v3'（B4.4 的 Store 按后端给）。
    public internal(set) var inkFormat: String = "v3"

    public init(now: Double, label: String, serial: Double) {
        self.now = now
        self.label = label
        self.serial = serial
    }

    public mutating func nextId(_ prefix: String) throws -> String {
        guard prefix == "r" || prefix == "s" else { throw CoreError.error("nextId prefix must be 'r' or 's', got " + prefix) }
        serial += 1
        return prefix + JSNumber.toString(serial)
    }
}

public protocol ScheduleStore: AnyObject {
    /// 已发布状态（各域）。
    var state: JSObject { get }
    /// 一次提交：成功 {ok:true, …}，失败 {ok:false, error}（失败不发布）。
    func commit(_ label: String, _ mutate: (inout JSObject, inout CommitContext) throws -> Void) -> JSValue
}

/// 内存 store：草稿浅拷贝 → mutate → 成功即发布；序号 = 构造时给的 serial（缺省按状态推出）。
public final class MemoryScheduleStore: ScheduleStore {
    public private(set) var state: JSObject
    public private(set) var serial: Double
    public var now: () -> Double
    /// 写失败注入：返回非 nil = 这次提交失败（error 对象），不发布。
    public var failNext: ((String) -> JSValue?)?
    /// 成功提交的 label（按顺序）与每次提交后的状态。
    public private(set) var commits: [(label: String, before: JSObject, after: JSObject, serial: Double)] = []

    public init(state: JSObject, now: @escaping () -> Double, serial: Double? = nil) {
        self.state = state
        self.now = now
        self.serial = serial ?? MemoryScheduleStore.deriveSerial(state)
    }

    /// 已用序号的最大值：meta.serial、records（含折叠 kept）、sessions（会话 id 与 items[].recordId）。
    public static func deriveSerial(_ state: JSObject) -> Double {
        var maxV = 0.0
        if let m = state["meta"]?["serial"], JS.isInteger(m) { maxV = JS.number(m) }
        for r in ScheduleRules.recordsOf(.object(state)) { let s = SchedRecords.recordSerial(r["id"]); if s > maxV { maxV = s } }
        func visit(_ s: JSValue?) {
            guard let s = s, JS.truthy(s) else { return }
            let v = SchedRecords.sessionSerial(s["id"])
            if v > maxV { maxV = v }
            for it in s["items"]?.arrayValue ?? [] { let r = SchedRecords.recordSerial(it["recordId"]); if r > maxV { maxV = r } }
        }
        let ss = state["sessions"]
        visit(ss?["A"]); visit(ss?["B"]); visit(ss?["lastEnded"]?["A"]); visit(ss?["lastEnded"]?["B"])
        return maxV
    }

    public func commit(_ label: String, _ mutate: (inout JSObject, inout CommitContext) throws -> Void) -> JSValue {
        var draft = state
        var ctx = CommitContext(now: now(), label: label, serial: serial)
        do {
            try mutate(&draft, &ctx)
        } catch let e as CoreError {
            return JS.obj([("ok", .bool(false)), ("error", JS.obj([("kind", .string("mutator")), ("label", .string(label)), ("reason", .string(e.message))]))])
        } catch {
            return JS.obj([("ok", .bool(false)), ("error", JS.obj([("kind", .string("mutator")), ("label", .string(label)), ("reason", .string(String(describing: error)))]))])
        }
        if let fail = failNext?(label) { return JS.obj([("ok", .bool(false)), ("error", fail)]) }
        if ctx.serial != serial, case .object(var meta)? = draft["meta"], !JS.strictEquals(meta["serial"], .number(ctx.serial)) {
            meta["serial"] = .number(ctx.serial)
            draft["meta"] = .object(meta)
        }
        commits.append((label, state, draft, ctx.serial))
        state = draft
        serial = ctx.serial
        return JS.obj([("ok", .bool(true))])
    }

    /// 直接换状态（测试的 seed）。
    public func seed(_ s: JSObject) {
        state = s
        serial = MemoryScheduleStore.deriveSerial(s)
        commits = []
    }
}

/// 选字用的题库适配器（session-start 的 deck 参数）。
public struct ScheduleDeck {
    public var newCandidates: (JSValue) -> [String]
    public var warmupCandidates: ((JSValue) -> [String])?
    public var practicable: (String) -> Bool
    public var currentLibraryId: ((JSValue?) -> JSValue)?

    public init(newCandidates: @escaping (JSValue) -> [String], warmupCandidates: ((JSValue) -> [String])? = nil, practicable: @escaping (String) -> Bool,
                currentLibraryId: ((JSValue?) -> JSValue)? = nil) {
        self.newCandidates = newCandidates
        self.warmupCandidates = warmupCandidates
        self.practicable = practicable
        self.currentLibraryId = currentLibraryId
    }

    /// deckAdapter：新字 = 当前练习范围（易忘度顺序），热身字，可练 = 题库里的 base: 卡。
    public static let real: ScheduleDeck = {
        let idx = DeckIndex.shared
        return ScheduleDeck(
            newCandidates: { idx.newOrder(idx.library($0) != nil ? $0 : .string(idx.defaultLibraryId)) },
            warmupCandidates: { idx.warmup(idx.library($0) != nil ? $0 : .string(idx.defaultLibraryId)) },
            practicable: { idx.isPracticable($0) },
            currentLibraryId: { idx.currentLibraryId($0) })
    }()
}

/// 题库索引（生成的 deck-libraries.json：全部卡键与四个字库的成员；libraryOf / newOrderOf / warmupOf / isPracticable）。
public final class DeckIndex {
    public let defaultLibraryId: String
    public let keys: [String]
    public let libraries: [(id: String, label: String, officialTotal: Double, keys: [String])]
    let known: KeySet
    private var orderCache: [String: [String]] = [:]
    private var warmCache: [String: [String]] = [:]
    private let lock = NSLock()

    public static let shared = DeckIndex(Config.deckLibraries)

    init(_ v: JSValue) {
        defaultLibraryId = JS.string(v["defaultLibraryId"])
        keys = (v["keys"]?.arrayValue ?? []).map { JS.string($0) }
        libraries = (v["libraries"]?.arrayValue ?? []).map { l in
            (JS.string(l["id"]), JS.string(l["label"]), JS.number(l["officialTotal"]), (l["keys"]?.arrayValue ?? []).map { JS.string($0) })
        }
        known = KeySet(keys)
    }

    public func library(_ id: JSValue?) -> (id: String, label: String, officialTotal: Double, keys: [String])? {
        guard case .string(let s)? = id else { return nil }
        return libraries.first { jsEq($0.id, s) }
    }

    public func isPracticable(_ key: String) -> Bool { key.utf8.starts(with: "base:".utf8) && known.contains(key) }

    public func currentLibraryId(_ settings: JSValue?) -> JSValue {
        let id = JS.truthy(settings) ? settings?["library"] : nil
        if case .string(let s)? = id, !s.isEmpty, library(id) != nil { return .string(s) }
        return .string(defaultLibraryId)
    }

    public func newOrder(_ id: JSValue) -> [String] {
        guard let lib = library(id) else { return [] }
        lock.lock(); defer { lock.unlock() }
        if let hit = orderCache[lib.id] { return hit }
        let v = NewOrder.orderNewKeys(lib.keys)
        orderCache[lib.id] = v
        return v
    }

    public func warmup(_ id: JSValue) -> [String] {
        guard let lib = library(id) else { return [] }
        lock.lock(); defer { lock.unlock() }
        if let hit = warmCache[lib.id] { return hit }
        let v = NewOrder.warmupKeys(lib.keys)
        warmCache[lib.id] = v
        return v
    }
}

// MARK: - spread（D83 起只给 v1 迁移的摊开用，Migrate.spreadLegacyDue）

extension ScheduleRules {
    /// 把 due ≤ today 的调度项摊到 today 起的之后几天（只往后挪）。
    public func spreadDue(_ sched: JSValue?, today: String, perDay: Double) throws -> (sched: JSObject, moved: Int) {
        var out = JSObject()
        var load = KeyMap<Double>()
        var overdue: [(String, JSValue)] = []
        for (key, entry) in (sched.flatMap { JS.truthy($0) ? $0 : nil }.map { JS.spread($0) } ?? JSObject()).entries {
            out[key] = entry
            if !JS.truthy(entry) || !dates.isValidDay(entry["due"] ?? .null) || entry["stoppedAt"] != nil { continue }
            let due = JS.string(entry["due"])
            if !JSMath.lessThan(today, due) { overdue.append((key, entry)) } else { load[due] = (load[due] ?? 0) + 1 }
        }
        if !(perDay > 0) || Double(overdue.count) <= perDay { return (out, 0) }
        func stab(_ e: JSValue) -> Double { JS.truthy(e["fsrs"]) ? JS.numberOr0(e["fsrs"]?["stability"]) : 0 }
        overdue = overdue.jsSorted { a, b in
            let da = JS.string(a.1["due"]), db = JS.string(b.1["due"])
            let c = Double(JSMath.compare(da, db))
            if c != 0 { return c }
            let s = stab(a.1) - stab(b.1)
            if s != 0 && !s.isNaN { return s }
            return Double(JSMath.compare(a.0, b.0))
        }
        var day = today
        var moved = 0
        for (key, entry) in overdue {
            while (load[day] ?? 0) >= perDay { day = try dates.addDays(day, 1) }
            load[day] = (load[day] ?? 0) + 1
            if !JS.isString(entry["due"], day) {
                out[key] = JS.with(entry, [("due", .string(day))])
                moved += 1
            }
        }
        return (out, moved)
    }
}

// MARK: - session-start

extension ScheduleRules {
    public static let labels = (
        expire: "session:expire", startFirst: "session:start-first", startDaily: "session:start-daily", startPicked: "session:start-picked",
        endAndStartPicked: "session:end-and-start-picked", deferSpecial: "session:defer-special"
    )

    /// store 状态 → 全部记录（月份键排序后平铺；折叠月取 kept）。
    public static func recordsOf(_ state: JSValue?) -> [JSValue] {
        let monthsV = state.flatMap { JS.truthy($0) ? $0["records"] : nil }.flatMap { JS.truthy($0) ? $0 : nil }
        let months = monthsV.map { JS.spread($0) } ?? JSObject()
        var out: [JSValue] = []
        for month in months.keys.jsSorted({ Double(JSMath.compare($0, $1)) }) {
            let value = months[month]!
            let list: [JSValue] = value.arrayValue ?? (JS.truthy(value) ? value["kept"]?.arrayValue ?? [] : [])
            out.append(contentsOf: list)
        }
        return out
    }

    static func sessionsOf(_ state: JSValue?) -> JSValue {
        let s = state.flatMap { JS.truthy($0) ? $0["sessions"] : nil }
        guard let ss = s, JS.truthy(ss) else { return SessionRules.emptySessions() }
        func orNull(_ v: JSValue?) -> JSValue { v.flatMap { JS.truthy($0) ? $0 : nil } ?? .null }
        let le = ss["lastEnded"].flatMap { JS.truthy($0) ? $0 : nil } ?? .object(JSObject())
        return JS.obj([("A", orNull(ss["A"])), ("B", orNull(ss["B"])), ("lastEnded", le)])
    }

    /// 是否曾有过记录（清空所有记录留下的结论句、或导入过旧数据的练习日）。
    public static func everPracticed(_ state: JSValue?) -> Bool {
        let concl = state.flatMap { JS.truthy($0) ? $0["backupMeta"] : nil }.flatMap { JS.truthy($0) ? $0["lastConclusion"] : nil }
        if let c = concl, JS.truthy(c), JS.isString(c["kind"], "clear") { return true }
        let legacy = state.flatMap { JS.truthy($0) ? $0["legacy"] : nil }
        guard let l = legacy, JS.truthy(l), case .array(let days)? = l["days"] else { return false }
        return !days.isEmpty
    }

    /// 下一组 A 是第一次练习还是今天的练习，以及是不是真的第一次来。
    public static func aStartInfo(_ state: JSValue?, policy: JSValue = Config.policy) -> (kind: String, firstVisit: Bool) {
        let ever = everPracticed(state)
        let kind = SessionRules.nextAKind(recordsOf(state), policy: policy, everPracticed: ever)
        return (kind, kind == "first" && !ever)
    }

    public static func capitalDeferredDayOf(_ state: JSValue?) -> JSValue? {
        let s = state.flatMap { JS.truthy($0) ? $0["settings"] : nil }
        guard let st = s, JS.truthy(st), case .string(let d)? = st["capitalDeferredDay"] else { return nil }
        return .string(d)
    }

    /// 今天的练习会选出哪些字（不写入）：selectDaily 的结果 + libraryId + libraryExhausted。cap / handled 见 selectDaily。
    public func planDaily(_ state: JSValue?, today: String, deck: ScheduleDeck, policy: JSValue = Config.policy, cap: Int? = nil, handled: [String] = [], extra: Bool = false) throws -> JSValue {
        let settings = state.flatMap { JS.truthy($0) ? $0["settings"] : nil }
        let settingsLib: JSValue? = { if case .string(let s)? = settings?["library"], JS.truthy(settings) { return .string(s) }; return nil }()
        let libraryId: JSValue
        if let cur = deck.currentLibraryId {
            libraryId = cur(settings)
        } else if let s = settingsLib, JS.truthy(s) {
            libraryId = s
        } else if let d = policy["defaultLibrary"], JS.truthy(d) {
            libraryId = d
        } else {
            libraryId = .null
        }
        let newCandidates = deck.newCandidates(libraryId)
        let warmupCandidates = deck.warmupCandidates?(libraryId) ?? []
        let sched: JSValue = state?["sched"].flatMap { JS.truthy($0) ? $0 : nil } ?? .object(JSObject())
        let custom = state?["custom"].flatMap { JS.truthy($0) ? $0 : nil }
        let plan = try selectDaily(sched: sched, records: ScheduleRules.recordsOf(state), today: today, newCandidates: newCandidates,
                                   warmupCandidates: warmupCandidates, custom: custom ?? .null, practicable: deck.practicable, policy: policy,
                                   capitalDeferredDay: ScheduleRules.capitalDeferredDayOf(state), groupSize: GroupSize.of(settings, policy: policy),
                                   tier: TodayPlan.tierOf(settings, policy: policy), cap: cap, handled: handled, extra: extra)
        let schedObj = sched.objectValue
        let exhausted = !newCandidates.contains { deck.practicable($0) && !JS.truthy(schedObj?[$0]) }
        guard case .object(var o) = plan.js else { return plan.js }
        o["libraryId"] = libraryId
        o["libraryExhausted"] = .bool(exhausted)
        return .object(o)
    }

    /// 下一次「今天的练习」是不是大写数字特别组（首页提示用；不写入）。
    public func planSpecial(_ state: JSValue?, today: String, deck: ScheduleDeck, policy: JSValue = Config.policy) throws -> JSValue {
        let records = ScheduleRules.recordsOf(state)
        if !SchedRecords.hasAnyJudged(records) { return .null }
        let settings = state.flatMap { JS.truthy($0) ? $0["settings"] : nil }
        let sp = try specialPlan(sched: state?["sched"].flatMap { JS.truthy($0) ? $0 : nil } ?? .object(JSObject()), records: records, today: today,
                                 practicable: deck.practicable, policy: policy, capitalDeferredDay: ScheduleRules.capitalDeferredDayOf(state),
                                 groupSize: GroupSize.of(settings, policy: policy))
        return sp.map { JS.obj([("kind", .string($0.kind)), ("keys", .array($0.keys.map { .string($0) }))]) } ?? .null
    }

    /// S02 确认框数据。
    public static func s02Data(_ state: JSValue?) -> JSValue { SessionRules.s02Prompt(sessionsOf(state)) }

    // ---- 草稿变换

    static func setSessions(_ draft: inout JSObject, _ sessions: JSValue) {
        func orNull(_ v: JSValue?) -> JSValue { v.flatMap { JS.truthy($0) ? $0 : nil } ?? .null }
        let le = JS.truthy(sessions["lastEnded"]) ? JS.spread(sessions["lastEnded"]) : JSObject()
        var next = JSObject([("A", orNull(sessions["A"])), ("B", orNull(sessions["B"])), ("lastEnded", .object(le))])
        if let t = sessions["today"] ?? draft["sessions"]?["today"], JS.truthy(t) { next["today"] = t } // D83 今天的账跟着 sessions 走
        draft["sessions"] = .object(next)
    }

    func expireInDraft(_ draft: inout JSObject, _ today: String, policy: JSValue) throws -> [JSValue] {
        let current = ScheduleRules.sessionsOf(.object(draft))
        let r = try SessionRules.expireDaily(current, .string(today), policy: policy)
        if !r.expiredAll.isEmpty { ScheduleRules.setSessions(&draft, r.sessions) }
        return r.expiredAll
    }

    static func endCompleteInDraft(_ draft: inout JSObject, _ slot: String, at: Double) throws {
        let current = sessionsOf(.object(draft))
        if let s = current[slot], JS.truthy(s), SessionRules.isComplete(s) {
            setSessions(&draft, try SessionRules.endSlot(current, slot, at: .number(at)))
        }
    }

    public static func normalizeKeys(_ input: [JSValue]) -> [String] {
        var out: [String] = []
        for item in input {
            let key: String
            if case .string(let s) = item, s.utf8.contains(0x3A) { key = s } else { key = "base:" + JS.string(item) }
            if SchedRecords.charOfCardKey(key) == nil { continue }
            if !out.contains(where: { jsEq($0, key) }) { out.append(key) }
        }
        return out
    }

    // ---- 提交

    static func failed(_ r: JSValue) -> Bool { r["ok"] != .bool(true) }

    /// 跨天过期（没写完的今天的练习直接换掉，D83）。
    public func expireStale(_ store: ScheduleStore, now: Double, policy: JSValue = Config.policy) throws -> JSValue {
        let today = try dates.localDay(.number(now))
        let state = JSValue.object(store.state)
        let exp = try SessionRules.expireDaily(ScheduleRules.sessionsOf(state), .string(today), policy: policy)
        if exp.expiredAll.isEmpty { return JS.obj([("ok", .bool(true)), ("expired", .array([])), ("spread", .null)]) }
        let result = store.commit(ScheduleRules.labels.expire) { draft, _ in
            _ = try self.expireInDraft(&draft, today, policy: policy)
        }
        return ScheduleRules.failed(result) ? result : JS.obj([("ok", .bool(true)), ("expired", .array(exp.expiredAll)), ("spread", .null)])
    }

    /// 不写入的续写判断。
    public func resumableSession(_ state: JSValue?, slot: String, now: Double, policy: JSValue = Config.policy) throws -> JSValue {
        let today = try dates.localDay(.number(now))
        let s = try SessionRules.expireDaily(ScheduleRules.sessionsOf(state), .string(today), policy: policy).sessions[slot]
        if let s = s, JS.truthy(s), !SessionRules.isComplete(s) { return s }
        return .null
    }

    /// 续写某槽之前的检查（含跨天过期）。
    public func resumeSlot(_ store: ScheduleStore, slot: String, now: Double, policy: JSValue = Config.policy) throws -> JSValue {
        guard slot == "A" || slot == "B" else { throw CoreError.range("resumeSlot: slot must be A or B") }
        let expired = try expireStale(store, now: now, policy: policy)
        if ScheduleRules.failed(expired) { return expired }
        let s = ScheduleRules.sessionsOf(.object(store.state))[slot]
        let session: JSValue = (s.map { JS.truthy($0) && !SessionRules.isComplete($0) } ?? false) ? s! : .null
        return JS.obj([("ok", .bool(true)), ("session", session), ("expired", expired["expired"] ?? .array([]))])
    }

    func startA(_ store: ScheduleStore, kind: String, now at: Double, deck: ScheduleDeck?, source: JSValue?, policy: JSValue) throws -> JSValue {
        let today = try dates.localDay(.number(at))
        let state = JSValue.object(store.state)
        let afterExpiry = try SessionRules.expireDaily(ScheduleRules.sessionsOf(state), .string(today), policy: policy).sessions
        if let a = afterExpiry["A"], JS.truthy(a), !SessionRules.isComplete(a) {
            return JS.obj([("ok", .bool(true)), ("started", .bool(false)), ("occupied", .bool(true)), ("session", a)])
        }
        var queue: [String]
        var plan: JSValue = .null
        var extra = false
        if kind == "first" {
            queue = SessionRules.selectFirst(policy: policy)
        } else {
            // 今天的练习写完了 → 再来一组（同样的字数与比例，额外的，不改变「今天完成了」）；否则排今天这一份剩下的
            extra = try TodayPlan.isDone(state, day: today, rules: self, deck: deck, policy: policy)
            if extra {
                plan = try planDaily(state, today: today, deck: deck!, policy: policy, extra: true)
            } else {
                let t = TodayPlan.today(state, day: today)
                let size = Int(JS.number(GroupSize.of(state["settings"], policy: policy)))
                plan = try planDaily(state, today: today, deck: deck!, policy: policy, cap: max(0, (t.target ?? size) - t.handled.count), handled: t.handled)
            }
            queue = (plan["queue"]?.arrayValue ?? []).map { JS.string($0) }
        }
        if queue.isEmpty {
            let expired = try expireStale(store, now: at, policy: policy)
            if ScheduleRules.failed(expired) { return expired }
            return JS.obj([("ok", .bool(true)), ("started", .bool(false)), ("empty", .bool(true)), ("kind", .string(kind)), ("plan", plan),
                           ("libraryExhausted", .bool(JS.truthy(plan) && JS.truthy(plan["libraryExhausted"])))])
        }
        var created: JSValue = .null
        let result = store.commit(kind == "first" ? ScheduleRules.labels.startFirst : ScheduleRules.labels.startDaily) { draft, ctx in
            let day = try self.dates.localDay(.number(ctx.now))
            _ = try self.expireInDraft(&draft, day, policy: policy)
            try ScheduleRules.endCompleteInDraft(&draft, "A", at: ctx.now)
            var session = try SessionRules.createSession(id: .string(try ctx.nextId("s")), kind: .string(kind), source: source.flatMap { JS.truthy($0) ? $0 : nil } ?? JS.obj([("view", .string("home"))]),
                                                         queue: .array(queue.map { .string($0) }), at: .number(ctx.now), dates: self.dates)
            if extra { session = JS.with(session, [("extra", .bool(true))]) }
            ScheduleRules.setSessions(&draft, try SessionRules.startInSlot(ScheduleRules.sessionsOf(.object(draft)), session))
            if !extra {
                // 这一份几个字：第一次开始时定下（今天已经写过的 + 这一组），当天不再变
                var t = TodayPlan.today(.object(draft), day: day)
                if t.target == nil { t.target = t.handled.count + Set(queue).count }
                TodayPlan.setToday(&draft, t)
            }
            created = session
        }
        if ScheduleRules.failed(result) { return result }
        return JS.obj([("ok", .bool(true)), ("started", .bool(true)), ("kind", .string(kind)), ("extra", .bool(extra)), ("session", created), ("plan", plan)])
    }

    /// 开第一次练习（固定 policy.firstQueue，P09）。
    public func startFirst(_ store: ScheduleStore, now: Double, source: JSValue? = nil, policy: JSValue = Config.policy) throws -> JSValue {
        try startA(store, kind: "first", now: now, deck: nil, source: source, policy: policy)
    }

    /// 开今天的练习。
    public func startDaily(_ store: ScheduleStore, now: Double, deck: ScheduleDeck, source: JSValue? = nil, policy: JSValue = Config.policy) throws -> JSValue {
        try startA(store, kind: "daily", now: now, deck: deck, source: source, policy: policy)
    }

    /// 开 A 槽的下一组：第一次练习或今天的练习。
    public func startNextA(_ store: ScheduleStore, now: Double, deck: ScheduleDeck, source: JSValue? = nil, policy: JSValue = Config.policy) throws -> JSValue {
        let info = ScheduleRules.aStartInfo(.object(store.state), policy: policy)
        return try startA(store, kind: info.kind, now: now, deck: deck, source: source, policy: policy)
    }

    /// 开这次选的字（B）。
    public func startPicked(_ store: ScheduleStore, keys: [JSValue], source: JSValue? = nil, deck: ScheduleDeck? = nil) throws -> JSValue {
        let queue = ScheduleRules.normalizeKeys(keys).filter { deck == nil || deck!.practicable($0) }
        if queue.isEmpty { throw CoreError.range("startPicked: no practicable card") }
        let prompt = ScheduleRules.s02Data(.object(store.state))
        if JS.truthy(prompt) {
            return JS.obj([("ok", .bool(true)), ("started", .bool(false)), ("s02", prompt), ("queue", .array(queue.map { .string($0) }))])
        }
        var created: JSValue = .null
        let result = store.commit(ScheduleRules.labels.startPicked) { draft, ctx in
            try ScheduleRules.endCompleteInDraft(&draft, "B", at: ctx.now)
            let session = try SessionRules.createSession(id: .string(try ctx.nextId("s")), kind: .string("picked"), source: source.flatMap { JS.truthy($0) ? $0 : nil } ?? JS.obj([("view", .string("home"))]),
                                                     queue: .array(queue.map { .string($0) }), at: .number(ctx.now), dates: self.dates)
            ScheduleRules.setSessions(&draft, try SessionRules.startInSlot(ScheduleRules.sessionsOf(.object(draft)), session))
            created = session
        }
        if ScheduleRules.failed(result) { return result }
        return JS.obj([("ok", .bool(true)), ("started", .bool(true)), ("session", created)])
    }

    /// S02「结束那组，开新的」：一次 commit（P38）。
    public func endOldAndStartPicked(_ store: ScheduleStore, keys: [JSValue], source: JSValue? = nil, deck: ScheduleDeck? = nil, policy: JSValue = Config.policy) throws -> JSValue {
        let queue = ScheduleRules.normalizeKeys(keys).filter { deck == nil || deck!.practicable($0) }
        if queue.isEmpty { throw CoreError.range("endOldAndStartPicked: no practicable card") }
        var out: [(String, JSValue)] = []
        let result = store.commit(ScheduleRules.labels.endAndStartPicked) { draft, ctx in
            try ScheduleRules.endCompleteInDraft(&draft, "B", at: ctx.now)
            let current = ScheduleRules.sessionsOf(.object(draft))
            let old = current["B"]
            let session = try SessionRules.createSession(id: .string(try ctx.nextId("s")), kind: .string("picked"), source: source.flatMap { JS.truthy($0) ? $0 : nil } ?? JS.obj([("view", .string("home"))]),
                                                     queue: .array(queue.map { .string($0) }), at: .number(ctx.now), dates: self.dates)
            let hasOld = old.map { JS.truthy($0) } ?? false
            let r: (sessions: JSValue, notice: JSValue, showOldResult: Bool) = hasOld
                ? try SessionRules.endAndStartPicked(current, session, at: .number(ctx.now), policy: policy)
                : (try SessionRules.startInSlot(current, session), .null, false)
            ScheduleRules.setSessions(&draft, r.sessions)
            out = [("session", session), ("ended", hasOld ? (r.sessions["lastEnded"]?["B"] ?? .null) : .null), ("notice", r.notice), ("showOldResult", .bool(r.showOldResult))]
        }
        if ScheduleRules.failed(result) { return result }
        return JS.obj([("ok", .bool(true))] + out)
    }

    /// 「这次先写平常的字」（D46 ④）：今天不再出特别组。
    public func deferSpecial(_ store: ScheduleStore, now: Double) throws -> JSValue {
        let today = try dates.localDay(.number(now))
        if JS.isString(ScheduleRules.capitalDeferredDayOf(.object(store.state)), today) {
            return JS.obj([("ok", .bool(true)), ("keys", .array([])), ("skipped", .bool(true))])
        }
        return store.commit(ScheduleRules.labels.deferSpecial) { draft, _ in
            var s = JS.truthy(draft["settings"]) ? JS.spread(draft["settings"]) : JSObject()
            s["capitalDeferredDay"] = .string(today)
            draft["settings"] = .object(s)
        }
    }
}
