import Foundation

// 1:1 移植自原 JS 版（B4.2）：会话状态（创建 / 推进 / 结果行 / 跳过撤销 / 槽位 / 过期 / 恢复）与选字（首练 / 今天的练习 / 特别组）。
// 会话与 sessions 是 JS 形状的 JSValue 对象：`{...x, k: v}` 的键序（已有键原位、新键在后）由 JSObject 保证。
// 选字的规则逐行同序照原 JS；policy 一律读传入的值。

extension JS {
    /// `{...v}`：对象照抄；数组 / 字串按下标（字串按 UTF-16 码元）；其余 {}。
    static func spread(_ v: JSValue?) -> JSObject {
        switch v {
        case .object(let o)?: return o
        case .array(let a)?: return JSObject(a.enumerated().map { (String($0.offset), $0.element) })
        case .string(let s)?:
            return JSObject(Array(s.utf16).enumerated().map { (String($0.offset), JSValue.string(String(decoding: [$0.element], as: UTF16.self))) })
        default: return JSObject()
        }
    }

    /// `{...base, k1: v1, …}`；值为 nil 表示 undefined（JSON 里不出现：已有的键删掉）。
    static func with(_ base: JSValue?, _ pairs: [(String, JSValue?)]) -> JSValue {
        var o = spread(base)
        for (k, v) in pairs { o[k] = v }
        return .object(o)
    }

    /// SameValueZero 意义下的去重键（对象 / 数组彼此都不相等）。
    static func sameValueKey(_ v: JSValue, _ i: Int) -> String {
        switch v {
        case .null: return "l"
        case .bool(let b): return b ? "t" : "f"
        case .number(let d): return d.isNaN ? "nNaN" : "n" + JSNumber.toString(d)
        case .string(let s): return "s" + s
        default: return "o" + String(i)
        }
    }
}

public enum SessionRules {
    public static let kinds = ["first", "daily", "picked"]
    public static let phases = ["recall", "compare", "answer", "trace", "retrace"]

    public static func slotOfKind(_ kind: JSValue?) throws -> String {
        switch kind {
        case .string(let k)? where jsEq(k, "first") || jsEq(k, "daily"): return "A"
        case .string(let k)? where jsEq(k, "picked"): return "B"
        default: throw CoreError.range("unknown session kind: " + JS.string(kind))
        }
    }

    public static func emptySessions() -> JSValue { JS.obj([("A", .null), ("B", .null), ("lastEnded", .object(JSObject()))]) }

    public static func freshCurrent() -> JSValue {
        JS.obj([("phase", .string("recall")), ("strokes", .array([])), ("hints", .number(0)), ("answerSeen", .bool(false)),
                ("hintRange", .null), ("referenceReady", .bool(false))])
    }

    static func isSessionId(_ v: JSValue?) -> Bool {
        guard case .string(let s)? = v else { return false }
        let u = Array(s.utf8)
        return u.count >= 2 && u[0] == 0x73 && u[1] >= 0x31 && u[1] <= 0x39 && u.dropFirst(2).allSatisfy { $0 >= 0x30 && $0 <= 0x39 }
    }

    // MARK: 会话

    static func queueOf(_ s: JSValue?) -> [JSValue] { s?["queue"]?.arrayValue ?? [] }
    static func cursorOf(_ s: JSValue?) -> Double { JS.number(s?["cursor"]) }

    /// 当前字：没有会话 / 已写完 → null（JS 返回 null）；下标不是整数 → nil（undefined）。
    public static func currentCardKey(_ session: JSValue?) -> JSValue? {
        guard let s = session, JS.truthy(s) else { return .null }
        let q = queueOf(s)
        let c = cursorOf(s)
        if c >= Double(q.count) { return .null }
        guard c.rounded(.towardZero) == c, c >= 0 else { return nil } // queue[1.5] / queue[-1] = undefined
        return q[Int(c)]
    }

    public static func remainingKeys(_ session: JSValue?) -> [JSValue] {
        guard let s = session, JS.truthy(s) else { return [] }
        return Mix.jsSlice(queueOf(s), cursorOf(s), Double(queueOf(s).count))
    }

    public static func remainingCount(_ session: JSValue?) -> Double {
        guard let s = session, JS.truthy(s) else { return 0 }
        return jsMax(0, Double(queueOf(s).count) - cursorOf(s))
    }

    public static func isComplete(_ session: JSValue?) -> Bool {
        guard let s = session, JS.truthy(s) else { return false }
        return cursorOf(s) >= Double(queueOf(s).count)
    }

    public static func judgedItems(_ session: JSValue?) -> [JSValue] {
        guard let s = session, JS.truthy(s) else { return [] }
        return (s["items"]?.arrayValue ?? []).filter { JS.isString($0["kind"], "judged") }
    }

    /// 新建会话（queue 不重复、都是卡键；at 有限）。
    public static func createSession(id: JSValue?, kind: JSValue?, source: JSValue?, queue: JSValue?, at: JSValue?, dates: Dates) throws -> JSValue {
        let slot = try slotOfKind(kind)
        guard isSessionId(id) else { throw CoreError.range("session id must look like s<serial>") }
        guard case .array(let q)? = queue, !q.isEmpty else { throw CoreError.range("queue must be a non-empty array") }
        if Set(q.enumerated().map { JS.sameValueKey($0.element, $0.offset) }).count != q.count { throw CoreError.range("queue must not repeat a card") }
        if q.contains(where: { SchedRecords.charOfCardKey($0) == nil }) { throw CoreError.range("queue entries must be card keys") }
        guard case .number(let t)? = at, t.isFinite else { throw CoreError.range("at must be a finite ms timestamp") }
        let src: JSValue = JS.truthy(source) ? .object(JS.spread(source)) : JS.obj([("view", .string("home"))])
        return JS.obj([
            ("id", id!), ("slot", .string(slot)), ("kind", kind!), ("source", src), ("queue", .array(q)), ("cursor", .number(0)), ("items", .array([])),
            ("current", freshCurrent()), ("lastLine", .null), ("startedAt", .number(t)), ("startedDay", .string(try dates.localDay(.number(t)))),
            ("updatedAt", .number(t)),
        ])
    }

    static func nullish(_ v: JSValue?) -> Bool { v == nil || v == .null }

    /// 更新当前字的现场。
    public static func withCurrent(_ session: JSValue, _ patch: JSValue?, at: JSValue?) throws -> JSValue {
        if let p = patch, JS.truthy(p), let ph = p["phase"] {
            guard case .string(let s) = ph, phases.contains(where: { jsEq($0, s) }) else { throw CoreError.range("unknown phase: " + JS.string(ph)) }
        }
        var cur = JS.spread(session["current"])
        for (k, v) in JS.spread(patch).entries { cur[k] = v }
        return JS.with(session, [("current", .object(cur)), ("updatedAt", nullish(at) ? session["updatedAt"] : at)])
    }

    /// 当前字处理完 → 追加 item、推进 cursor、重置现场、更新结果行。
    public static func advance(_ session: JSValue, cardKey: JSValue?, recordId: JSValue?, kind: JSValue?, fsrsBefore: JSValue?, at: JSValue?) throws -> JSValue {
        if !JS.strictEquals(currentCardKey(session), cardKey) { throw CoreError.range("advance: not the current card") }
        guard case .string(let k)? = kind, ["judged", "answer-seen", "skipped"].contains(where: { jsEq($0, k) }) else {
            throw CoreError.range("advance: unknown item kind")
        }
        var item = JSObject()
        if let c = cardKey { item["cardKey"] = c }
        item["kind"] = .string(k)
        if let r = recordId { item["recordId"] = r }
        if jsEq(k, "judged"), let f = fsrsBefore { item["fsrsBefore"] = f }
        var lastLine: JSValue = .null
        if jsEq(k, "judged") && JS.truthy(recordId) { lastLine = JS.obj([("recordId", recordId!), ("kind", .string("record"))]) }
        else if jsEq(k, "answer-seen") && JS.truthy(recordId) { lastLine = JS.obj([("recordId", recordId!), ("kind", .string("saw"))]) }
        return JS.with(session, [
            ("items", .array((session["items"]?.arrayValue ?? []) + [.object(item)])), ("cursor", .number(cursorOf(session) + 1)), ("current", freshCurrent()),
            ("lastLine", lastLine), ("updatedAt", nullish(at) ? session["updatedAt"] : at),
        ])
    }

    public static func markLineChanged(_ session: JSValue, _ recordId: JSValue?) -> JSValue {
        guard let line = session["lastLine"], JS.truthy(line), JS.strictEquals(line["recordId"], recordId) else { return session }
        var o = JSObject()
        if let r = recordId { o["recordId"] = r }
        o["kind"] = .string("changed")
        return JS.with(session, [("lastLine", .object(o))])
    }

    public static func clearLine(_ session: JSValue) -> JSValue {
        JS.truthy(session["lastLine"]) ? JS.with(session, [("lastLine", .null)]) : session
    }

    /// 跳过撤销：最后一个 item 必须是这条 skipped。
    public static func undoSkip(_ session: JSValue, _ recordId: JSValue?, at: JSValue?) throws -> JSValue {
        let items = session["items"]?.arrayValue ?? []
        guard let last = items.last, JS.truthy(last), JS.isString(last["kind"], "skipped"), JS.strictEquals(last["recordId"], recordId) else {
            throw CoreError.range("undoSkip: last item is not this skip")
        }
        return JS.with(session, [
            ("items", .array(Array(items.dropLast()))), ("cursor", .number(cursorOf(session) - 1)), ("current", freshCurrent()), ("lastLine", .null),
            ("updatedAt", nullish(at) ? session["updatedAt"] : at),
        ])
    }

    public static func fsrsBeforeOf(_ session: JSValue?, _ recordId: JSValue?) -> JSValue? {
        guard let s = session, JS.truthy(s) else { return nil }
        let item = (s["items"]?.arrayValue ?? []).first { JS.strictEquals($0["recordId"], recordId) && JS.isString($0["kind"], "judged") }
        return item?["fsrsBefore"]
    }

    public static func canCorrect(_ session: JSValue?, _ recordId: JSValue?) -> Bool {
        guard let s = session, JS.truthy(s) else { return false }
        return (s["items"]?.arrayValue ?? []).contains { JS.strictEquals($0["recordId"], recordId) && JS.isString($0["kind"], "judged") && $0["fsrsBefore"] != nil }
    }

    // MARK: 槽位

    public static func startInSlot(_ sessions: JSValue, _ session: JSValue) throws -> JSValue {
        let slot = JS.string(session["slot"])
        if JS.truthy(sessions[slot]) { throw CoreError.range("slot " + slot + " is occupied") }
        var lastEnded = JS.truthy(sessions["lastEnded"]) ? JS.spread(sessions["lastEnded"]) : JSObject()
        lastEnded[slot] = nil
        return JS.with(sessions, [(slot, session), ("lastEnded", .object(lastEnded))])
    }

    public static func endSlot(_ sessions: JSValue, _ slot: String, at: JSValue?, early: Bool = false) throws -> JSValue {
        guard let session = sessions[slot], JS.truthy(session) else { throw CoreError.range("slot " + slot + " is empty") }
        var ended = JS.spread(session)
        ended["endedAt"] = at
        if early { ended["endedEarly"] = .bool(true) }
        var lastEnded = JS.truthy(sessions["lastEnded"]) ? JS.spread(sessions["lastEnded"]) : JSObject()
        lastEnded[slot] = .object(ended)
        return JS.with(sessions, [(slot, .null), ("lastEnded", .object(lastEnded))])
    }

    public static func clearLastEnded(_ sessions: JSValue, _ slot: String) -> JSValue {
        guard let le = sessions["lastEnded"], JS.truthy(le), JS.truthy(le[slot]) else { return sessions }
        var o = JS.spread(le)
        o[slot] = nil
        return JS.with(sessions, [("lastEnded", .object(o))])
    }

    public static func resumeLines(_ sessions: JSValue) -> JSValue {
        var out: [JSValue] = []
        for slot in ["B", "A"] {
            let s = sessions[slot]
            if let s = s, JS.truthy(s), !isComplete(s) {
                out.append(JS.obj([("slot", .string(slot)), ("kind", s["kind"] ?? .null), ("remaining", .number(remainingCount(s)))]).removingUndefined(["kind"], from: s))
            }
        }
        return .array(out)
    }

    public static func s02Prompt(_ sessions: JSValue) -> JSValue {
        guard let b = sessions["B"], JS.truthy(b), !isComplete(b) else { return .null }
        // D83：上一组还没写的字 = 还没写过第一次的字（待重考的不算；只剩重考时列出它们，不重复）
        let firsts = TodayPlan.pendingFirsts(b).map { JSValue.string($0) }
        var seen = Set<String>()
        let unwritten = firsts.isEmpty ? remainingKeys(b).filter { seen.insert(JS.string($0)).inserted } : firsts
        var o = JSObject()
        if let id = b["id"] { o["sessionId"] = id }
        o["unwrittenKeys"] = .array(unwritten)
        o["unwrittenChars"] = .array(unwritten.map { SchedRecords.charOfCardKey($0).map { .string($0) } ?? .null })
        o["judgedCount"] = .number(Double(judgedItems(b).count))
        return .object(o)
    }

    /// S02「结束那组，开新的」。
    public static func endAndStartPicked(_ sessions: JSValue, _ newSession: JSValue, at: JSValue?, policy: JSValue = Config.policy) throws -> (sessions: JSValue, notice: JSValue, showOldResult: Bool) {
        if !JS.isString(newSession["slot"], "B") { throw CoreError.range("endAndStartPicked: new session must be picked") }
        guard let old = sessions["B"], JS.truthy(old) else {
            return (JS.with(sessions, [("B", newSession)]), .null, false)
        }
        let judgedCount = Double(judgedItems(old).count)
        let ended = JS.with(old, [("endedAt", at), ("endedEarly", .bool(true))])
        var lastEnded = JS.truthy(sessions["lastEnded"]) ? JS.spread(sessions["lastEnded"]) : JSObject()
        lastEnded["B"] = ended
        let next = JS.with(sessions, [("B", newSession), ("lastEnded", .object(lastEnded))])
        let showOld = JS.isString(policy["s02EndOld"], "result") && judgedCount > 0
        let notice: JSValue = JS.isString(policy["s02EndOld"], "toast") && judgedCount > 0
            ? JS.obj([("kind", .string("oldGroupSaved")), ("judgedCount", .number(judgedCount))]) : .null
        return (next, notice, showOld)
    }

    static func expiryRuleOf(_ kind: JSValue?, policy: JSValue) throws -> String {
        if JS.isString(kind, "daily") { return "daily" }
        let table = policy["sessionExpiry"]
        let rule: JSValue? = JS.truthy(table) ? table?[JS.string(kind)] : nil
        if case .string(let r)? = rule, jsEq(r, "never") || jsEq(r, "daily") { return r }
        throw CoreError.range("unsupported policy.sessionExpiry." + JS.string(kind) + ": " + JS.string(rule))
    }

    /// 跨天未完成的会话过期（P37 / P61）。expired = 最先过期的那个（A 优先）。
    public static func expireDaily(_ sessions: JSValue, _ today: JSValue?, policy: JSValue = Config.policy) throws -> (sessions: JSValue, expired: JSValue?, expiredAll: [JSValue]) {
        var next = sessions
        var expiredAll: [JSValue] = []
        for slot in ["A", "B"] {
            guard let s = next[slot], JS.truthy(s), !JS.strictEquals(s["startedDay"], today) else { continue }
            if try expiryRuleOf(s["kind"], policy: policy) != "daily" { continue }
            if JS.isString(policy["dailyExpiry"], "discard") {
                next = JS.with(next, [(slot, .null)])
            } else if JS.isString(policy["dailyExpiry"], "result") {
                let ended = JS.with(s, [("endedAt", s["updatedAt"]), ("endedEarly", .bool(true))])
                var le = JS.truthy(next["lastEnded"]) ? JS.spread(next["lastEnded"]) : JSObject()
                le[slot] = ended
                next = JS.with(next, [(slot, .null), ("lastEnded", .object(le))])
            } else {
                throw CoreError.range("unsupported policy.dailyExpiry: " + JS.string(policy["dailyExpiry"]))
            }
            expiredAll.append(s)
        }
        return (next, expiredAll.first, expiredAll)
    }

    /// 恢复幂等（D07）。
    public static func recoverSession(_ session: JSValue?, _ records: [JSValue]) throws -> (session: JSValue?, recovered: Bool) {
        guard var s = session, JS.truthy(s) else { return (session, false) }
        var recovered = false
        if let key = currentCardKey(s), JS.truthy(key) {
            let already = (s["items"]?.arrayValue ?? []).contains { JS.strictEquals($0["cardKey"], key) }
            let committed = records.first { SchedRecords.isJudged($0) && JS.strictEquals($0["sessionId"], s["id"]) && JS.strictEquals($0["cardKey"], key) }
            if let c = committed, !already {
                s = try advance(s, cardKey: key, recordId: c["id"], kind: .string("judged"), fsrsBefore: nil, at: s["updatedAt"])
                recovered = true
            }
        }
        if let cur = s["current"], JS.truthy(cur), JS.isString(cur["phase"], "compare") {
            let strokes = cur["strokes"]
            let empty: Bool
            switch strokes {
            case nil, .null?: empty = true
            case .array(let a)?: empty = a.isEmpty
            case .string(let t)?: empty = t.isEmpty
            case .bool(let b)?: empty = !b
            case .number(let d)?: empty = d == 0 || d.isNaN
            case .object?: empty = false // {}.length === undefined，不等于 0
            }
            if empty {
                s = JS.with(s, [("current", JS.with(cur, [("phase", .string("recall"))]))])
                recovered = true
            }
        }
        if let cur = s["current"], JS.truthy(cur), cur["paper"] == .bool(true) {
            var rest = JS.spread(cur)
            rest["paper"] = nil
            s = JS.with(s, [("current", .object(rest))])
            recovered = true
        }
        return (s, recovered)
    }

    // MARK: 选字

    /// 开 A 槽新组时是第一次练习还是今天的练习（D17；P46）。
    public static func nextAKind(_ records: [JSValue], policy: JSValue = Config.policy, everPracticed: Bool = false) -> String {
        if SchedRecords.hasAnyJudged(records) { return "daily" }
        if everPracticed && !JS.truthy(policy["afterClearRestartFirst"]) { return "daily" }
        return "first"
    }

    /// 第一次练习的字（P09）→ cardKey 队列。
    public static func selectFirst(policy: JSValue = Config.policy) -> [String] {
        (policy["firstQueue"]?.arrayValue ?? []).map { "base:" + JS.string($0) }
    }

}

private extension JSValue {
    /// resumeLines 的 kind：s.kind 为 undefined 时 JSON 里不出现。
    func removingUndefined(_ keys: [String], from s: JSValue) -> JSValue {
        guard case .object(var o) = self else { return self }
        for k in keys where s[k] == nil { o[k] = nil }
        return .object(o)
    }
}

extension ScheduleRules {
    /// 跳过后推迟进新字池的字（D65 #5，P06）。
    public func skipDeferredNewKeys(_ records: [JSValue], _ today: String, policy: JSValue = Config.policy) throws -> KeySet {
        let raw = policy["skipNewDeferDays"]
        let days = JS.isInteger(raw) && JS.number(raw) > 0 ? JS.number(raw) : 0
        if days == 0 { return KeySet() }
        return SchedRecords.skippedCardKeysOn(records, today, from: try dates.addDays(today, -(days - 1)))
    }

    /// selectDaily 的结果（调度规则 v2，D83）。
    public struct DailyPlan {
        public var queue: [String]
        public var dueKeys: [String]
        public var newKeys: [String]
        public var warmKeys: [String]
        public var customKeys: [String]
        /// 可排的到期字数（已排除今天写过 / 看过答案 / 跳过的）。
        public var backlog: Double
        public var groupSize: JSValue?
        public var tier: String
        /// 档位算出的新字份额（让位 / 补位之前）。
        public var newShare: Double
        public var special: (kind: String, keys: [String])?

        public var js: JSValue {
            func arr(_ a: [String]) -> JSValue { .array(a.map { .string($0) }) }
            var o = JSObject([("dueKeys", arr(dueKeys)), ("newKeys", arr(newKeys)), ("warmKeys", arr(warmKeys)), ("customKeys", arr(customKeys)),
                              ("backlog", .number(backlog))])
            if let g = groupSize { o["groupSize"] = g }
            o["tier"] = .string(tier)
            o["queue"] = arr(queue)
            o["newShare"] = .number(newShare)
            o["special"] = special.map { JS.obj([("kind", .string($0.kind)), ("keys", arr($0.keys))]) } ?? .null
            return .object(o)
        }
    }

    public static func defaultPracticable(_ key: String) -> Bool { key.utf8.starts(with: "base:".utf8) }

    /// 到期字的先后（D83）：上次写错（或看了答案）的排最前，其余按 FSRS 回忆概率从低到高；同概率逾期久的先、再按键。
    func dueOrder(_ schedObj: JSObject?, keys: [String], records: [JSValue], today: String) throws -> [String] {
        var lastAttempt = KeyMap<JSValue>()
        for r in SchedRecords.sortById(records.filter { SchedRecords.isJudged($0) || JS.isString($0["kind"], "answer-seen") }) { lastAttempt[JS.string(r["cardKey"])] = r }
        let at = JSValue.number(try dates.dayStartMs(.string(today)))
        struct Item { var key: String; var wrong: Bool; var r: Double; var od: Double }
        var items: [Item] = []
        for key in keys {
            let entry = schedObj?[key]
            let last = lastAttempt[key]
            let wrong = last.map { JS.isString($0["kind"], "answer-seen") || JS.isString($0["judgment"], "wrong") } ?? false
            let r = (try? retrievability(entry, now: at)) ?? nil
            items.append(Item(key: key, wrong: wrong, r: r.map { $0.isFinite ? $0 : 0 } ?? 0, od: (try overdueDays(entry, today)) ?? 0))
        }
        return items.jsSorted { a, b in
            if a.wrong != b.wrong { return a.wrong ? -1 : 1 }
            if a.r != b.r { return a.r < b.r ? -1 : 1 }
            if a.od != b.od { return a.od > b.od ? -1 : 1 }
            return Double(JSMath.compare(a.key, b.key))
        }.map { $0.key }
    }

    /// 今天的练习选字（调度规则 v2，D83；docs/product/调度规则v2-一天的练习.md 一 / 二）。
    /// cap：这一份最多还排几个（今天已经写过的从每组字数里扣掉）；handled：今天已经算进进度的字（不再排）；extra：再来一组。
    public func selectDaily(sched: JSValue? = nil, records: [JSValue] = [], today: String, newCandidates: [String] = [], warmupCandidates: [String] = [],
                            custom: JSValue? = nil, practicable: (String) -> Bool = ScheduleRules.defaultPracticable, policy: JSValue = Config.policy,
                            isWarm: (String) -> Bool = NewOrder.isWarmupKey, capitalDeferredDay: JSValue? = nil, groupSize: JSValue? = nil,
                            tier: String? = nil, cap: Int? = nil, handled: [String] = [], extra: Bool = false) throws -> DailyPlan {
        var excluded = SchedRecords.judgedCardKeysOn(records, today)
        for k in SchedRecords.answerSeenCardKeysOn(records, today) { excluded.insert(k) }
        for k in SchedRecords.skippedCardKeysOn(records, today) { excluded.insert(k) }
        for k in handled { excluded.insert(k) }
        let deferredNew = try skipDeferredNewKeys(records, today, policy: policy)
        let schedObj = (sched.flatMap { JS.truthy($0) ? $0 : nil })?.objectValue
        func inSched(_ key: String) -> Bool { JS.truthy(schedObj?[key]) }
        let tierId = tier ?? TodayPlan.tierOf(nil, policy: policy)
        // 到期字
        var dueKeys0: [String] = []
        for (key, entry) in schedObj?.entries ?? [] {
            if excluded.contains(key) || !practicable(key) { continue }
            if !JS.truthy(entry) || entry["stoppedAt"] != nil { continue }
            guard let od = try overdueDays(entry, today), od >= 0 else { continue }
            dueKeys0.append(key)
        }
        let due = try dueOrder(schedObj, keys: dueKeys0, records: records, today: today)
        let full = GroupSize.valid(groupSize, policy: policy)
        let size = Int(JS.number(full))
        let backlog = Double(due.count)
        let ratio = TodayPlan.ratio(tierId, policy: policy)
        let share = Double(TodayPlan.newShare(size: size, ratio: ratio))
        let stats = try practiceStats(records, today, policy: policy, isWarm: isWarm)

        // 大写数字特别组（D40）：积压按「一天一组」折算成天数
        if let special = Special.capitalSpecial(records: records, groupsTotal: stats.groupsTotal, pressure: backlog / Double(max(1, size)), practicable: practicable,
                                                excluded: excluded, policy: policy, today: .string(today), deferredDay: capitalDeferredDay) {
            let keys = cap.map { Array(special.keys.prefix(max(0, $0))) } ?? special.keys
            return DailyPlan(queue: keys, dueKeys: [], newKeys: [], warmKeys: [], customKeys: [], backlog: backlog, groupSize: full, tier: tierId, newShare: share, special: special)
        }

        // 新字：自己加的字优先，再按字库顺序（佰仟在两组特别组之后排最前）
        var customPick: [String] = []
        for row in (custom.flatMap { JS.truthy($0) ? $0["added"]?.arrayValue : nil } ?? []) {
            let key = "base:" + JS.string(row["char"])
            if !practicable(key) || inSched(key) || excluded.contains(key) || deferredNew.contains(key) { continue }
            if !customPick.contains(where: { jsEq($0, key) }) { customPick.append(key) }
        }
        var taken = KeySet(due)
        var pool: [String] = []
        for key in customPick + Special.capitalAfterKeysFor(records, policy: policy) + newCandidates {
            if taken.contains(key) || excluded.contains(key) || deferredNew.contains(key) || !practicable(key) || inSched(key) { continue }
            pool.append(key)
            taken.insert(key)
        }
        let poolSet = KeySet(pool)
        var warmNext: String? = nil
        for key in warmupCandidates {
            if KeySet(due).contains(key) || excluded.contains(key) || deferredNew.contains(key) || !practicable(key) || inSched(key) { continue }
            warmNext = key
            break
        }
        let poolCount = pool.count + (warmNext.map { poolSet.contains($0) ? 0 : 1 } ?? 0)

        // 再来一组（allNewWhenNothingDue）：没有到期字时全是新字，「只复习」档也一样（规则文档四）
        let allNewWhenNothingDue = extra && due.isEmpty
        var mix = allNewWhenNothingDue ? TodayPlan.Mix(rev: 0, new: min(size, poolCount)) : TodayPlan.compose(size: size, due: due.count, pool: poolCount, ratio: ratio, policy: policy)
        if let cap { mix = TodayPlan.shrink(mix, to: cap) }
        // 复习字：按先后取；热身字的复习一组至多 1 个（P126）
        var revKeys: [String] = []
        var warmRev = 0
        for key in due {
            if revKeys.count >= mix.rev { break }
            if isWarm(key) {
                if warmRev >= 1 { continue }
                warmRev += 1
            }
            revKeys.append(key)
        }
        let newN = ratio.num == 0 && !allNewWhenNothingDue ? 0 : min(poolCount, mix.total - revKeys.count) // 只复习档不补新字
        var warmNew: String? = nil
        if newN >= 2 && warmRev == 0, let w = warmNext, !w.isEmpty, try Mix.warmupAllowed(stats, warm: policy["warmup"]) { warmNew = w }
        let ordinary = pool.filter { warmNew == nil || !jsEq($0, warmNew!) }
        let ordinaryNew = Array(ordinary.prefix(max(0, min(ordinary.count, newN - (warmNew != nil ? 1 : 0)))))
        let queue = Mix.arrangeGroup(warmNew: warmNew, revKeys: revKeys, earlyKeys: [], newKeys: ordinaryNew, isWarm: isWarm)
        let pickSet = KeySet(customPick), revSet = KeySet(revKeys)
        return DailyPlan(
            queue: queue, dueKeys: queue.filter { revSet.contains($0) }, newKeys: (warmNew.map { [$0] } ?? []) + ordinaryNew, warmKeys: warmNew.map { [$0] } ?? [],
            customKeys: queue.filter { pickSet.contains($0) }, backlog: backlog, groupSize: full, tier: tierId, newShare: share, special: nil)
    }

    /// 下一次日常组是不是大写数字特别组（首页提示用，不选字）。
    public func specialPlan(sched: JSValue? = nil, records: [JSValue] = [], today: String, practicable: (String) -> Bool = ScheduleRules.defaultPracticable,
                            policy: JSValue = Config.policy, isWarm: (String) -> Bool = NewOrder.isWarmupKey, capitalDeferredDay: JSValue? = nil,
                            groupSize: JSValue? = nil) throws -> (kind: String, keys: [String])? {
        let cfg = policy["capitalNumerals"]
        if !JS.truthy(cfg) || cfg?["enabled"] == .bool(false) { return nil }
        if JS.strictEquals(capitalDeferredDay, .string(today)) { return nil }
        let stats = try practiceStats(records, today, policy: policy, isWarm: isWarm)
        if JS.less(.number(stats.groupsTotal), cfg?["afterGroups"]) { return nil }
        let excluded = SchedRecords.judgedCardKeysOn(records, today)
        var backlog = 0.0
        for (key, entry) in (sched.flatMap { JS.truthy($0) ? $0 : nil })?.objectValue?.entries ?? [] {
            if excluded.contains(key) || !practicable(key) || !JS.truthy(entry) || entry["stoppedAt"] != nil { continue }
            if let od = try overdueDays(entry, today), od >= 0 { backlog += 1 }
        }
        let size = max(1, JS.number(GroupSize.valid(groupSize, policy: policy)))
        return Special.capitalSpecial(records: records, groupsTotal: stats.groupsTotal, pressure: backlog / size, practicable: practicable, excluded: excluded,
                                      policy: policy, today: .string(today), deferredDay: capitalDeferredDay)
    }
}
