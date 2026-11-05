import Foundation

// 1:1 移植自原 JS 版（B4.4）：占用估算（UTF-16 口径）、预算回收（墨迹按层级淘汰、旧月份折叠）、
// D27「每字第一次 + 最近一次」留存、Q1 看后自写的层级。只改传入的草稿（JSObject），不碰存储。
// 回收结果（actions、折叠月的形状、草稿里月表的键序）与 JS 逐字段相同。

public struct Budgets: Equatable {
    public var quotaBytes: Double
    public var warnRatio: Double
    public var totalTargetBytes: Double
    public var recordsBudgetBytes: Double
    public var recordsFoldAfterDays: Double
    public var inkBudgetBytes: Double

    static let MiB = 1024.0 * 1024.0
    static let names = ["quotaBytes", "warnRatio", "totalTargetBytes", "recordsBudgetBytes", "recordsFoldAfterDays", "inkBudgetBytes"]

    /// BUDGET_DEFAULTS（policy P05 / P28 / P57）。
    public static let defaults = Budgets(
        quotaBytes: Config.policyNumber("assumedQuotaBytes")!, warnRatio: Config.policyNumber("storageWarnRatio")!,
        totalTargetBytes: 3.2 * MiB, recordsBudgetBytes: Config.policyNumber("recordsBudgetBytes")!,
        recordsFoldAfterDays: Config.policyNumber("recordsFoldAfterDays")!, inkBudgetBytes: Config.policyNumber("inkBudgetBytes")!)

    /// NATIVE_BUDGETS（policy.nativeStorage）。
    public static let native = Budgets(
        quotaBytes: Config.policyNumber("nativeStorage.quotaBytes")!, warnRatio: Config.policyNumber("storageWarnRatio")!,
        totalTargetBytes: Config.policyNumber("nativeStorage.totalTargetBytes")!, recordsBudgetBytes: Config.policyNumber("nativeStorage.recordsBudgetBytes")!,
        recordsFoldAfterDays: Config.policyNumber("recordsFoldAfterDays")!, inkBudgetBytes: Config.policyNumber("nativeStorage.inkBudgetBytes")!)

    subscript(name: String) -> Double {
        get {
            switch name {
            case "quotaBytes": return quotaBytes
            case "warnRatio": return warnRatio
            case "totalTargetBytes": return totalTargetBytes
            case "recordsBudgetBytes": return recordsBudgetBytes
            case "recordsFoldAfterDays": return recordsFoldAfterDays
            default: return inkBudgetBytes
            }
        }
        set {
            switch name {
            case "quotaBytes": quotaBytes = newValue
            case "warnRatio": warnRatio = newValue
            case "totalTargetBytes": totalTargetBytes = newValue
            case "recordsBudgetBytes": recordsBudgetBytes = newValue
            case "recordsFoldAfterDays": recordsFoldAfterDays = newValue
            default: inkBudgetBytes = newValue
            }
        }
    }

    /// resolveBudgets：覆盖里是有限数的项用覆盖，其余缺省。
    public static func resolve(_ overrides: JSObject?) -> Budgets {
        var b = defaults
        for n in names {
            if case .number(let d)? = overrides?[n], d.isFinite { b[n] = d }
        }
        return b
    }

    public var js: JSObject { JSObject(Budgets.names.map { ($0, JSValue.number(self[$0])) }) }
}

public enum Budget {
    static let dayMs = 86_400_000.0

    /// 单个条目的估算字节（UTF-16）：(键长 + 值长) × 2；值 nil = 0。
    public static func entryBytes(_ key: String, _ raw: String?) -> Double {
        guard let raw = raw else { return 0 }
        return Double(UTF16Order.length(key) + UTF16Order.length(raw)) * 2
    }

    /// 键归到哪个统计桶。
    public static func bucketOfKey(_ key: String) -> String {
        if let spec = Schema.specForKey(key) { return spec.domain ?? spec.id }
        if UTF16Order.hasPrefix(key, Schema.corruptPrefix) { return "corrupt" }
        if UTF16Order.hasPrefix(key, "shizi.") { return "legacy-v1" }
        return "foreign"
    }

    /// {total, byBucket, ratio, level}。
    public static func estimateUsage(_ pairs: [(String, String)], _ budgets: Budgets = .defaults) -> JSObject {
        estimateUsage(pairs, budgets, bucketOf: bucketOfKey)
    }

    /// bucketOf ≡ bucketOfKey（调用方可以记住结果）。桶按第一次出现的次序、各桶按出现次序累加：与逐条改 byBucket 同序同值
    /// （第一笔 0 + bytes == bytes：bytes 是非负的 Double(整数)）。
    static func estimateUsage(_ pairs: [(String, String)], _ budgets: Budgets, bucketOf: (String) -> String) -> JSObject {
        var names: [String] = []
        var sums: [Double] = []
        var slots = [JSKey: Int]()
        var prev = -1
        var total = 0.0
        for (k, v) in pairs {
            let bytes = entryBytes(k, v)
            total += bytes
            let bucket = bucketOf(k)
            if prev >= 0 && UTF16Order.eq(names[prev], bucket) {
                sums[prev] += bytes
            } else if let i = slots[JSKey(s: bucket)] {
                sums[i] += bytes
                prev = i
            } else {
                prev = names.count
                slots[JSKey(s: bucket)] = prev
                names.append(bucket)
                sums.append(bytes)
            }
        }
        var byBucket = JSObject()
        for i in names.indices { byBucket[names[i]] = .number(sums[i]) }
        let ratio = budgets.quotaBytes > 0 ? total / budgets.quotaBytes : 1
        let level = ratio >= 1 ? "full" : ratio > budgets.warnRatio ? "warn" : "ok"
        return JSObject([("total", .number(total)), ("byBucket", .object(byBucket)), ("ratio", .number(ratio)), ("level", .string(level))])
    }

    /// null | {level, ratio（三位小数）}。
    public static func storagePressureOf(_ usage: JSValue?) -> JSValue {
        guard let u = usage, case .object(let o) = u, let l = o["level"]?.stringValue, l == "warn" || l == "full" else { return .null }
        let r = JS.number(o["ratio"])
        let ratio = r.isNaN ? 0 : r
        return .object(JSObject([("level", .string(l)), ("ratio", .number(Dates.jsRound(ratio * 1000) / 1000))]))
    }

    /// 墨迹预算随每组字数（P326）。
    public static func inkBudgetOf(_ settings: JSValue?, policy p: JSValue = Config.policy) -> Double {
        var size: JSValue = p["groupSize"] ?? .null
        if let s = settings, JSX.truthy(s), case .array(let opts)? = p["groupSizeOptions"], let g = s["groupSize"], opts.contains(where: { JS.strictEquals($0, g) }) {
            size = g
        }
        let table = p["inkBudgetByGroupSize"]?.objectValue ?? JSObject()
        let key: String = {
            switch size {
            case .number(let d): return JSNumber.toString(d)
            case .string(let s): return s
            case .bool(let b): return b ? "true" : "false"
            case .null: return "null"
            default: return JSONWriter.stringify(size)
            }
        }()
        if case .number(let d)? = table[key], d.isFinite { return d }
        return p["inkBudgetBytes"]?.numberValue ?? .nan
    }

    static func inkBudgetFor(_ b: Budgets, _ state: JSObject) -> Double {
        if b.inkBudgetBytes != Config.policyNumber("inkBudgetBytes")! { return b.inkBudgetBytes }
        return inkBudgetOf(state["settings"])
    }

    // MARK: 日期

    /// 该月最后一天距 today 的整天数（月份在未来为负）。
    static func daysSinceMonthEnd(_ month: String, _ today: String, _ dates: Dates) -> Double {
        let y = JSX.stringToNumber(String(month.utf16.prefix(4)).map { String($0) } ?? "")
        let m = JSX.stringToNumber(String(month.utf16.dropFirst(5).prefix(2)).map { String($0) } ?? "")
        let ty = JSX.stringToNumber(String(today.utf16.prefix(4)).map { String($0) } ?? "")
        let tm = JSX.stringToNumber(String(today.utf16.dropFirst(5).prefix(2)).map { String($0) } ?? "")
        let td = JSX.stringToNumber(String(today.utf16.dropFirst(8).prefix(2)).map { String($0) } ?? "")
        guard [y, m, ty, tm, td].allSatisfy({ $0.isFinite }) else { return .nan }
        guard let monthEnd = JSDate.makeLocal(Int(y), Int(m), 0, hours: 12, dates.timeZone),
              let t = JSDate.makeLocal(Int(ty), Int(tm) - 1, Int(td), hours: 12, dates.timeZone) else { return .nan }
        return Dates.jsRound((t - monthEnd) / dayMs)
    }

    static func localDayOf(_ ms: Double, _ dates: Dates) -> String { (try? dates.localDay(.number(ms))) ?? "NaN-NaN-NaN" }

    // MARK: 记录索引

    static func monthRecords(_ value: JSValue?) -> [JSValue] {
        if case .array(let a)? = value { return a }
        if case .object(let o)? = value, o["folded"] == .bool(true), case .array(let k)? = o["kept"] { return k }
        return []
    }

    static func isFolded(_ value: JSValue?) -> Bool {
        if case .object(let o)? = value { return o["folded"] == .bool(true) }
        return false
    }

    /// 还开着的组的 id（槽里的 A / B 与 lastEnded 的 A / B）。
    static func openSessionIds(_ sessions: JSValue?) -> Set<JSKey> {
        var out = Set<JSKey>()
        guard case .object(let s)? = sessions else { return out }
        func add(_ v: JSValue?) { if case .object(let o)? = v, case .string(let id)? = o["id"] { out.insert(JSKey(s: id)) } }
        add(s["A"])
        add(s["B"])
        if case .object(let le)? = s["lastEnded"] {
            add(le["A"])
            add(le["B"])
        }
        return out
    }

    public struct RecordIndex {
        var byId: [JSKey: (rec: JSValue, month: String)] = [:]
        var latestIds = Set<JSKey>()
        var firstIds = Set<JSKey>()
        var edges = Set<JSKey>()
        var afterSeen: [JSKey: Double] = [:]
        var protectedIds = Set<JSKey>()

        var retained: Set<JSKey> { firstIds.union(latestIds).union(protectedIds) }
    }

    static func sid(_ rec: JSValue) -> String { rec["id"]?.stringValue ?? "" }
    static func serial(_ v: JSValue?) -> Double { if case .string(let s)? = v { return Schema.serialOf(s) }; return 0 }
    static func cardKey(_ rec: JSValue) -> String? { rec["cardKey"]?.stringValue }

    /// indexRecords（records 域 → 层级索引）。now = nil 时不判断看后自写是否过期。
    public static func indexRecords(_ records: JSObject, sessions: JSValue? = nil, now: Double? = nil, keepDays: Double = Config.policyNumber("afterSeenInkKeepDays")!) -> RecordIndex {
        var idx = RecordIndex()
        var seen: [JSValue] = []
        var latestByCard = KeyMap<JSValue>(), firstByCard = KeyMap<JSValue>(), latestScreen = KeyMap<JSValue>(), firstScreen = KeyMap<JSValue>()
        var perMonthCard = KeyMap<(first: JSValue, last: JSValue)>()
        func keepExtreme(_ map: inout KeyMap<JSValue>, _ rec: JSValue, _ s: Double, latest: Bool) {
            let ck = cardKey(rec) ?? "undefined"
            if let cur = map[ck] {
                if latest ? serial(cur["id"]) < s : serial(cur["id"]) > s { map[ck] = rec }
            } else {
                map[ck] = rec
            }
        }
        for (month, value) in records.entries {
            for rec in monthRecords(value) {
                guard case .object(let r) = rec else { continue }
                if case .string(let id)? = r["id"] { idx.byId[JSKey(s: id)] = (rec, month) }
                if case .string(let inkId)? = r["inkId"], !inkId.isEmpty { idx.byId[JSKey(s: inkId)] = (rec, month) }
                if r["kind"] == .string("answer-seen") { seen.append(rec) }
                if r["kind"] != .string("judged") { continue }
                let s = serial(r["id"])
                keepExtreme(&latestByCard, rec, s, latest: true)
                keepExtreme(&firstByCard, rec, s, latest: false)
                if r["source"] == .string("paper") { continue }
                keepExtreme(&latestScreen, rec, s, latest: true)
                keepExtreme(&firstScreen, rec, s, latest: false)
                let mk = month + "|" + (cardKey(rec) ?? "undefined")
                if var pair = perMonthCard[mk] {
                    if serial(pair.first["id"]) > s { pair.first = rec }
                    if serial(pair.last["id"]) < s { pair.last = rec }
                    perMonthCard[mk] = pair
                } else {
                    perMonthCard[mk] = (rec, rec)
                }
            }
        }
        for (_, pair) in perMonthCard.entries {
            idx.edges.insert(JSKey(s: sid(pair.first)))
            idx.edges.insert(JSKey(s: sid(pair.last)))
        }
        for (_, r) in latestByCard.entries { idx.latestIds.insert(JSKey(s: sid(r))) }
        for (_, r) in latestScreen.entries { idx.latestIds.insert(JSKey(s: sid(r))) }
        for (_, r) in firstByCard.entries { idx.firstIds.insert(JSKey(s: sid(r))) }
        for (_, r) in firstScreen.entries { idx.firstIds.insert(JSKey(s: sid(r))) }
        let open = openSessionIds(sessions)
        var latestSeen = KeyMap<Double>()
        for rec in seen {
            let s = serial(rec["id"])
            let ck = cardKey(rec) ?? "undefined"
            if !((latestSeen[ck] ?? .nan) >= s) { latestSeen[ck] = s }
        }
        let nowMs: Double? = now.flatMap { $0.isFinite ? $0 : nil }
        for rec in seen {
            let id = JSKey(s: sid(rec))
            if case .string(let sess)? = rec["sessionId"], open.contains(JSKey(s: sess)) {
                idx.afterSeen[id] = .infinity
                idx.protectedIds.insert(id)
                continue
            }
            let s = serial(rec["id"])
            let ck = cardKey(rec) ?? "undefined"
            let judged = latestByCard[ck]
            var aged = false
            if let n = nowMs, case .number(let at)? = rec["at"], keepDays.isFinite { aged = n - at > keepDays * dayMs }
            let expired = (judged.map { serial($0["id"]) > s } ?? false) || (latestSeen[ck] ?? .nan) > s || aged
            idx.afterSeen[id] = expired ? 4 : 5
        }
        return idx
    }

    /// 墨迹淘汰层级（越小越先淘汰；∞ 永不淘汰）。
    public static func inkTier(_ id: String, _ index: RecordIndex, _ currentMonth: String) -> Double {
        guard let hit = index.byId[JSKey(s: id)] else { return 0 }
        let recId = JSKey(s: sid(hit.rec))
        if let t = index.afterSeen[recId] { return t }
        if index.latestIds.contains(recId) || index.firstIds.contains(recId) { return .infinity }
        if index.edges.contains(recId) { return 3 }
        return UTF16Order.eq(hit.month, currentMonth) ? 2 : 1
    }

    // MARK: 字节

    static func inkEntryBytes(_ month: String, _ id: String, _ entry: JSValue) -> Double {
        entryBytes(Schema.inkRecordKey(month, id), JSONWriter.stringify(entry))
    }

    public static func recordsBytes(_ records: JSObject) -> Double {
        var total = 0.0
        for (m, v) in records.entries { total += entryBytes(Schema.recordsKey(m), JSONWriter.stringify(v)) }
        return total
    }

    public static func inkBytes(_ ink: JSValue?) -> Double {
        guard case .object(let o)? = ink else { return 0 }
        var total = 0.0
        for (m, t) in o.entries { total += inkMonthBytes(m, t) }
        return total
    }

    static func inkMonthBytes(_ month: String, _ table: JSValue?) -> Double {
        guard case .object(let t)? = table else { return 0 }
        var total = 0.0
        for (id, e) in t.entries { total += inkEntryBytes(month, id, e) }
        return total
    }

    // MARK: 判断与回收

    /// 需要回收吗？{records, aged, ink, total, any}。sizes = (records, ink) 已算好的字节。
    public static func needsRecovery(_ state: JSObject, now: Double, budgets b: Budgets, totalBytes: Double? = nil, sizes: (records: Double, ink: Double)? = nil, dates: Dates) -> JSObject {
        let records = state["records"]?.objectValue ?? JSObject()
        let today = localDayOf(now, dates)
        let currentMonth = String(today.utf16.prefix(7)).map { String($0) } ?? today
        let rBytes = sizes?.records ?? recordsBytes(records)
        var aged = false
        for (month, value) in records.entries {
            if !UTF16Order.less(month, currentMonth) || isFolded(value) { continue }
            if daysSinceMonthEnd(month, today, dates) > b.recordsFoldAfterDays { aged = true }
        }
        let r = rBytes > b.recordsBudgetBytes
        let i = (sizes?.ink ?? inkBytes(state["ink"])) > inkBudgetFor(b, state)
        let t = totalBytes.map { $0 > b.totalTargetBytes } ?? false
        return JSObject([("records", .bool(r)), ("aged", .bool(aged)), ("ink", .bool(i)), ("total", .bool(t)), ("any", .bool(r || aged || i))])
    }

    static func foldMonth(_ month: String, _ list: [JSValue], _ keepIds: Set<JSKey>, hasInk: InkPick.HasInk? = nil) -> JSObject {
        var byDay = JSObject()
        var chars: [JSValue] = []
        var seenChars = OSet()
        var screenDay = OSet()
        func str(_ v: JSValue?) -> String { JS.string(v) }
        for rec in list where rec["kind"] == .string("judged") && rec["source"] != .string("paper") {
            screenDay.insert(str(rec["localDay"]) + "\u{0}" + str(rec["char"]))
        }
        var paperOnly = JSObject()
        func pushUnique(_ o: inout JSObject, _ day: String, _ ch: JSValue) {
            var arr = o[day]?.arrayValue ?? []
            if !arr.contains(where: { JS.strictEquals($0, ch) }) { arr.append(ch) }
            o[day] = .array(arr)
        }
        for rec in list {
            if rec["kind"] != .string("judged") { continue }
            let day = str(rec["localDay"])
            let ch = rec["char"] ?? .null
            pushUnique(&byDay, day, ch)
            if rec["source"] == .string("paper") && !screenDay.contains(day + "\u{0}" + str(rec["char"])) {
                pushUnique(&paperOnly, day, ch)
            }
            if seenChars.insert(str(rec["char"])) { chars.append(ch) }
        }
        let kept = list.filter { keepIds.contains(JSKey(s: sid($0))) }
        var out = JSObject([("folded", .bool(true)), ("month", .string(month)), ("byDay", .object(byDay)), ("chars", .array(chars)), ("kept", .array(kept))])
        if !paperOnly.isEmpty { out["paperOnly"] = .object(paperOnly) }
        // R15：作品成员按 isWorkMember 逐条记下（byDay 是「写过的字」，含写错没放进来的、纸上的）；work 总是写，没有 = 旧版折叠。
        let fw = WorkMembers.foldWorkOf(list, hasInk: hasInk)
        out["work"] = .object(fw.work)
        if let wj = fw.workJudged { out["workJudged"] = .object(wj) }
        return out
    }

    /// D27 写入新判断时的回收（只看 cardKeys 这些字）；返回被回收的 [{id, month, recordId}]。
    @discardableResult
    public static func pruneInkOfCards(_ draft: inout JSObject, _ cardKeys: [String], dates: Dates) -> [JSValue] {
        pruneInkOfCards(&draft, cardKeys, dates: dates) { recs, want in
            var mine: [JSValue] = []
            for (_, v) in recs.objectValue?.entries ?? [] {
                for rec in Budget.monthRecords(v) {
                    if case .object = rec, let ck = Budget.cardKey(rec), want.contains(ck) { mine.append(rec) }
                }
            }
            return mine
        }
    }

    /// 同上；collect(records 域, want) 给出 mine（records 域里按月键序、月内按列表序，cardKey 在 want 里的对象记录）。
    /// 判字传 RecordLookup.recordsOfCards（只看这个字的记录，结果与上面的逐条扫描逐条相同）。
    @discardableResult
    static func pruneInkOfCards(_ draft: inout JSObject, _ cardKeys: [String], dates: Dates, collect: (JSValue, KeySet) -> [JSValue]) -> [JSValue] {
        guard case .object(var ink)? = draft["ink"], let recs = draft["records"], JSX.truthy(recs) else { return [] }
        let want = KeySet(cardKeys)
        if want.isEmpty { return [] }
        let mine = collect(recs, want)
        let index = indexRecords(JSObject([("all", .array(mine))]), sessions: draft["sessions"])
        var keep = index.retained
        func slot(_ rec: JSValue) -> (month: String, id: String)? {
            guard let m = Schema.inkMonthOf(rec, timeZone: dates.timeZone), let i = Schema.inkIdOf(rec) else { return nil }
            return (m, i)
        }
        func stored(_ rec: JSValue) -> Bool {
            guard let s = slot(rec), case .object(let t)? = ink[s.month] else { return false }
            return t[s.id] != nil
        }
        var latestJudged = KeyMap<JSValue>()
        for rec in mine where rec["kind"] == .string("judged") {
            let ck = cardKey(rec)!
            if let cur = latestJudged[ck] { if serial(cur["id"]) < serial(rec["id"]) { latestJudged[ck] = rec } } else { latestJudged[ck] = rec }
        }
        var latestSeen = KeyMap<JSValue>()
        for rec in mine where rec["kind"] == .string("answer-seen") && stored(rec) {
            let ck = cardKey(rec)!
            if let cur = latestSeen[ck] { if serial(cur["id"]) < serial(rec["id"]) { latestSeen[ck] = rec } } else { latestSeen[ck] = rec }
        }
        for (ck, rec) in latestSeen.entries {
            let j = latestJudged[ck]
            if j == nil || serial(j!["id"]) < serial(rec["id"]) { keep.insert(JSKey(s: sid(rec))) }
        }
        var kept = Set<JSKey>()
        for rec in mine where keep.contains(JSKey(s: sid(rec))) {
            if let s = slot(rec) { kept.insert(JSKey(s: s.month + "|" + s.id)) }
        }
        var drops = KeyMap<KeyMap<String>>()
        for rec in mine {
            if keep.contains(JSKey(s: sid(rec))) { continue }
            guard let s = slot(rec), !kept.contains(JSKey(s: s.month + "|" + s.id)) else { continue }
            guard case .object(let t)? = ink[s.month], t[s.id] != nil else { continue }
            var m = drops[s.month] ?? KeyMap<String>()
            m[s.id] = sid(rec)
            drops[s.month] = m
        }
        if drops.count == 0 { return [] }
        var out: [JSValue] = []
        for (month, ids) in drops.entries {
            var next = ink[month]?.objectValue ?? JSObject()
            for (id, recordId) in ids.entries {
                next[id] = nil
                out.append(.object(JSObject([("id", .string(id)), ("month", .string(month)), ("recordId", .string(recordId))])))
            }
            ink[month] = .object(next)
        }
        draft["ink"] = .object(ink)
        return out
    }

    /// 回收的范围限制（撞配额时只许动这些月键；ink:true = 全部 ink 月键）。
    public struct Limit {
        public var ink = false
        public var inkMonths: [String]?
        public var months: [String]?
        public init(ink: Bool = false, inkMonths: [String]? = nil, months: [String]? = nil) {
            self.ink = ink
            self.inkMonths = inkMonths
            self.months = months
        }
    }

    /// 按 §9 优先级回收（改草稿）。返回 (actions, freedBytes)。
    @discardableResult
    public static func recover(_ draft: inout JSObject, now: Double, budgets b: Budgets, force: Bool = false, needBytes: Double = 0, limit: Limit? = nil,
                               afterSeenKeepDays: Double = Config.policyNumber("afterSeenInkKeepDays")!, dates: Dates) -> (actions: [JSValue], freedBytes: Double) {
        let today = localDayOf(now, dates)
        let currentMonth = String(today.utf16.prefix(7)).map { String($0) } ?? today
        var actions: [JSValue] = []
        var freed = 0.0
        func wantMore() -> Bool { force && freed < needBytes }

        var records = draft["records"]?.objectValue ?? JSObject()
        let index = indexRecords(records, sessions: draft["sessions"], now: now, keepDays: afterSeenKeepDays)
        func inkMonthAllowed(_ m: String) -> Bool {
            guard let l = limit else { return true }
            return l.ink || (l.inkMonths?.contains { UTF16Order.eq($0, m) } ?? false)
        }
        func monthAllowed(_ m: String) -> Bool {
            guard let l = limit else { return true }
            return l.months?.contains { UTF16Order.eq($0, m) } ?? false
        }
        let hasInk: Bool = { if case .object = draft["ink"] { return true }; return false }()

        func dropInk(_ month: String, _ ids: Set<JSKey>) -> Double {
            guard case .object(var ink)? = draft["ink"] else { return 0 }
            let table = ink[month]
            let before = inkMonthBytes(month, table)
            var next = JSObject()
            for (id, e) in table?.objectValue?.entries ?? [] where !ids.contains(JSKey(s: id)) { next[id] = e }
            ink[month] = .object(next)
            draft["ink"] = .object(ink)
            return before - inkMonthBytes(month, .object(next))
        }

        if hasInk {
            var bytes = inkBytes(draft["ink"])
            let inkBudget = inkBudgetFor(b, draft)
            if bytes > inkBudget || wantMore() {
                struct Cand { let month: String, id: String, tier: Double, serial: Double, size: Double }
                var candidates: [Cand] = []
                for (month, table) in draft["ink"]!.objectValue!.entries {
                    guard inkMonthAllowed(month), case .object(let t) = table else { continue }
                    for (id, e) in t.entries {
                        candidates.append(Cand(month: month, id: id, tier: inkTier(id, index, currentMonth), serial: Schema.serialOf(id), size: inkEntryBytes(month, id, e)))
                    }
                }
                candidates = candidates.jsSorted { x, y in
                    let a = x.tier - y.tier
                    if !a.isNaN && a != 0 { return a }
                    let s = x.serial - y.serial
                    if !s.isNaN && s != 0 { return s }
                    let c = UTF16Order.compare(x.id, y.id)
                    if c != 0 { return Double(c) }
                    return UTF16Order.less(x.month, y.month) ? -1 : 1
                }
                var evicted = KeyMap<Set<JSKey>>()
                for c in candidates {
                    if c.tier == .infinity { break }
                    if !(bytes > inkBudget || wantMore()) { break }
                    var set = evicted[c.month] ?? Set<JSKey>()
                    set.insert(JSKey(s: c.id))
                    evicted[c.month] = set
                    bytes -= c.size
                    freed += c.size
                    actions.append(.object(JSObject([("type", .string("evictInk")), ("id", .string(c.id)), ("month", .string(c.month)), ("tier", .number(c.tier))])))
                }
                for (month, ids) in evicted.entries { _ = dropInk(month, ids) }
            }
        }

        var rBytes = recordsBytes(records)
        let months = UTF16Order.sorted(records.keys)
        var folded = false
        let keepIds = index.retained
        for month in months {
            if !UTF16Order.less(month, currentMonth) || isFolded(records[month]) || !monthAllowed(month) { continue }
            let aged = daysSinceMonthEnd(month, today, dates) > b.recordsFoldAfterDays
            if !(aged || rBytes > b.recordsBudgetBytes || wantMore()) { break }
            let listV = records[month]!
            let list = listV.arrayValue ?? []
            let before = entryBytes(Schema.recordsKey(month), JSONWriter.stringify(listV))
            // 看后自写算不算成员看折叠这一刻存下的墨迹（与折叠前的原始月份同一判据；折掉的记录的墨迹随后才删）
            let snapshot = JSValue.object(JSObject([("ink", draft["ink"] ?? .null)]))
            let tz = dates.timeZone
            let value = foldMonth(month, list, keepIds, hasInk: hasInk ? { rec in InkPick.storedInkPresent(snapshot, rec, timeZone: tz) } : nil)
            let after = entryBytes(Schema.recordsKey(month), JSONWriter.stringify(.object(value)))
            folded = true
            records[month] = .object(value)
            rBytes += after - before
            freed += max(0, before - after)
            let keptCount = value["kept"]?.arrayValue?.count ?? 0
            actions.append(.object(JSObject([("type", .string("fold")), ("month", .string(month)), ("kept", .number(Double(keptCount))), ("dropped", .number(Double(list.count - keptCount)))])))
            if hasInk {
                var keptIds = Set<JSKey>()
                for r in value["kept"]?.arrayValue ?? [] { keptIds.insert(JSKey(s: sid(r))) }
                var gone = Set<JSKey>()
                for rec in list {
                    let id = JSKey(s: sid(rec))
                    if keptIds.contains(id) { continue }
                    gone.insert(id)
                    if case .string(let inkId)? = rec["inkId"], !inkId.isEmpty { gone.insert(JSKey(s: inkId)) }
                }
                var removed = 0.0
                for (inkMonth, table) in draft["ink"]?.objectValue?.entries ?? [] {
                    guard inkMonthAllowed(inkMonth), case .object(let t) = table else { continue }
                    let hit = Set(t.keys.filter { gone.contains(JSKey(s: $0)) }.map { JSKey(s: $0) })
                    if !hit.isEmpty { removed += dropInk(inkMonth, hit) }
                }
                if removed != 0 {
                    freed += removed
                    actions.append(.object(JSObject([("type", .string("dropFoldedInk")), ("month", .string(month)), ("bytes", .number(removed))])))
                }
            }
        }
        if folded { draft["records"] = .object(records) }
        return (actions, freed)
    }
}
