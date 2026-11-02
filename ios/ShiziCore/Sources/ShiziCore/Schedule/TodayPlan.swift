import Foundation

// 调度规则 v2「一天的练习」（S2，已决定 D83；规则全文 docs/product/调度规则v2-一天的练习.md；数值 policy.dailyPlan，P327）。
// D82 起规则不再要求与 JS 一致：这里是原生的唯一实现，测试见 Tests/ShiziCoreTests/TodayPlanTests.swift 与 TodayPlanSimulationTests.swift。
//
// · 今天的练习 = 一组（字数 = 每组字数）。第一次开始时定下这一份有几个字（sessions.today.target），当天不再变；
//   开始之前首页按当时的状态算出来显示（与第一次开始时得到的同一个数）。早上 4 点以后是新的一天，没写完的那份直接换掉（会话过期规则不变）。
// · 新字按档位比例配（compose）；复习不够新字补，复习太多（到期 ≥ 每组字数 × yieldAtGroups）新字让位但至少 1 个（只复习档 0 个），
//   新字也不够就用复习补，都不够这一份就少几个字。
// · 今天的进度只算每个字的第一次（sessions.today.handled）：今天的练习里写过 / 看过答案 / 跳过的字，加上自选里写过 / 看过答案的字。
//   自选写过的字计入进度，今天的练习相应少排（先少排新字，再少排最不急的复习字；已经在自选里写过的字直接拿掉）。
// · 写错（含看答案）当天隔 retryGap 个字重考，最多 maxAttempts 次；重考不写记录、不动复习日期（会话 items 里记 kind: 'retry'）。
// · 完成 = 今天的练习那一组每个字都写过第一次、重考都结束（会话写完），或者今天的进度已经满了（自选写满一组）。之后「再来一组」是额外的组（extra）。

public enum TodayPlan {
    // MARK: policy

    static func cfg(_ p: JSValue) -> JSValue? { p["dailyPlan"].flatMap { JS.truthy($0) ? $0 : nil } }

    /// 设置里档位的排列顺序。
    public static func tierIds(policy p: JSValue = Config.policy) -> [String] {
        (cfg(p)?["tierOrder"]?.arrayValue ?? []).compactMap { $0.stringValue }
    }

    /// settings.mixTier → 档位（没选过 / 不认识 = 缺省档）。
    public static func tierOf(_ settings: JSValue?, policy p: JSValue = Config.policy) -> String {
        if let t = settings?["mixTier"]?.stringValue, tierIds(policy: p).contains(t) { return t }
        return cfg(p)?["defaultTier"]?.stringValue ?? "balanced"
    }

    public static func isTier(_ value: JSValue?, policy p: JSValue = Config.policy) -> Bool {
        guard let s = value?.stringValue else { return false }
        return tierIds(policy: p).contains(s)
    }

    /// 档位的新字比例（分子, 分母）。
    public static func ratio(_ tier: String, policy p: JSValue = Config.policy) -> (num: Int, den: Int) {
        let a = cfg(p)?["tiers"]?[tier]?.arrayValue ?? []
        guard a.count == 2, let n = a[0].numberValue, let d = a[1].numberValue, n >= 0, d > 0, n <= d else { return (1, 2) }
        return (Int(n), Int(d))
    }

    public static func retryGap(policy p: JSValue = Config.policy) -> Int {
        let v = JS.number(cfg(p)?["retryGap"])
        return v.isFinite && v >= 0 ? Int(v) : 3
    }

    public static func maxAttempts(policy p: JSValue = Config.policy) -> Int {
        let v = JS.number(cfg(p)?["maxAttempts"])
        return v.isFinite && v >= 1 ? Int(v) : 3
    }

    static func yieldAt(policy p: JSValue) -> Double {
        let v = JS.number(cfg(p)?["yieldAtGroups"])
        return v.isFinite && v > 0 ? v : 1
    }

    // MARK: 配比（纯函数）

    /// 新字份额 = 每组字数 × 比例，四舍五入；正好一半时偏复习（15 × 1/2 → 7，规则文档一的例子）。
    public static func newShare(size: Int, ratio r: (num: Int, den: Int)) -> Int {
        guard size > 0, r.num > 0, r.den > 0 else { return 0 }
        return (2 * size * r.num + r.den - 1) / (2 * r.den)
    }

    public struct Mix: Equatable {
        public var rev: Int
        public var new: Int
        public var total: Int { rev + new }
        public init(rev: Int, new: Int) { self.rev = rev; self.new = new }
    }

    /// 一组怎么配：due = 可排的到期字数，pool = 可排的新字数。
    public static func compose(size: Int, due: Int, pool: Int, ratio r: (num: Int, den: Int), policy p: JSValue = Config.policy) -> Mix {
        guard size > 0 else { return Mix(rev: 0, new: 0) }
        if r.num == 0 { return Mix(rev: min(due, size), new: 0) } // 只复习
        let share = max(1, newShare(size: size, ratio: r)) // 新字至少 1 个
        let newTarget = Double(due) >= Double(size) * yieldAt(policy: p) ? 1 : share // 复习太多：新字让位到 1 个
        var rev = min(due, size - newTarget)
        let new = min(pool, size - rev) // 复习不够：新字补
        rev = min(due, size - new) // 新字不够：复习补
        return Mix(rev: rev, new: new)
    }

    /// 少排 n 个之外的：先少排新字，再少排复习字。
    public static func shrink(_ m: Mix, to cap: Int) -> Mix {
        var excess = m.total - max(0, cap)
        if excess <= 0 { return m }
        let dn = min(m.new, excess)
        excess -= dn
        return Mix(rev: max(0, m.rev - excess), new: m.new - dn)
    }

    // MARK: sessions.today

    /// 今天这一份的账：day、进度（每个字的第一次）、这一份几个字（第一次开始时定）、是否已完成。
    public struct Today: Equatable {
        public var day: String
        public var handled: [String]
        public var target: Int?
        public var done: Bool

        public init(day: String, handled: [String] = [], target: Int? = nil, done: Bool = false) {
            self.day = day
            self.handled = handled
            self.target = target
            self.done = done
        }

        public var js: JSValue {
            var o = JSObject([("day", .string(day)), ("handled", .array(handled.map { .string($0) }))])
            if let t = target { o["target"] = .number(Double(t)) }
            o["done"] = .bool(done)
            return .object(o)
        }
    }

    /// 状态里今天的账（不是今天的 = 新的一天，空账）。
    public static func today(_ state: JSValue?, day: String) -> Today {
        guard let t = state?["sessions"]?["today"], JS.truthy(t), t["day"]?.stringValue == day else { return Today(day: day) }
        let target = t["target"]?.numberValue.flatMap { $0.isFinite && $0 >= 0 ? Int($0) : nil }
        return Today(day: day, handled: (t["handled"]?.arrayValue ?? []).compactMap { $0.stringValue }, target: target, done: t["done"] == .bool(true))
    }

    static func setToday(_ d: inout JSObject, _ t: Today) {
        var s = d["sessions"]?.objectValue ?? SessionRules.emptySessions().objectValue!
        s["today"] = t.js
        d["sessions"] = .object(s)
    }

    // MARK: 会话的角色

    /// A 槽里今天的练习（第一次练习 / 今天的练习；「再来一组」的额外组除外）。
    public static func isPlan(_ s: JSValue?) -> Bool {
        guard let s, JS.truthy(s) else { return false }
        return JS.isString(s["slot"], "A") && s["extra"] != .bool(true)
    }

    static func activeSession(_ state: JSValue?, _ slot: String) -> JSValue? {
        guard let s = state?["sessions"]?[slot], JS.truthy(s), !SessionRules.isComplete(s) else { return nil }
        return s
    }

    // MARK: 重考

    /// 这一组里这个字已经考过几次（第一次 + 重考）。
    public static func attempts(_ s: JSValue?, _ key: JSValue?) -> Int {
        (s?["items"]?.arrayValue ?? []).filter { JS.strictEquals($0["cardKey"], key) }.count
    }

    /// 重考 item（不写记录）。
    public static func isRetryItem(_ item: JSValue?) -> Bool { JS.isString(item?["kind"], "retry") }

    /// cursor 已推进之后，把这个字隔 retryGap 个字插回队列（后面不够就放到最后）。
    public static func requeue(_ s: JSValue, _ key: JSValue, policy: JSValue = Config.policy) -> JSValue {
        var q = s["queue"]?.arrayValue ?? []
        let c = Int(max(0, JS.number(s["cursor"])))
        q.insert(key, at: min(c + retryGap(policy: policy), q.count))
        return JS.with(s, [("queue", .array(q))])
    }

    /// 重考一次：追加 {cardKey, kind: 'retry', outcome, attempt}、推进；错了且没到上限 → 再插回去。outcome：correct / wrong / skipped。
    public static func retryAdvance(_ s: JSValue, key: JSValue, outcome: String, at: JSValue?, policy: JSValue = Config.policy) throws -> JSValue {
        guard JS.strictEquals(SessionRules.currentCardKey(s), key) else { throw CoreError.range("retry: not the current card") }
        guard ["correct", "wrong", "skipped"].contains(outcome) else { throw CoreError.range("retry: unknown outcome") }
        let attempt = attempts(s, key) + 1
        let item = JS.obj([("cardKey", key), ("kind", .string("retry")), ("outcome", .string(outcome)), ("attempt", .number(Double(attempt)))])
        var next = JS.with(s, [
            ("items", .array((s["items"]?.arrayValue ?? []) + [item])), ("cursor", .number(JS.number(s["cursor"]) + 1)),
            ("current", SessionRules.freshCurrent()), ("lastLine", .null), ("updatedAt", at == nil || at == .null ? s["updatedAt"] : at),
        ])
        if outcome == "wrong" && attempt < maxAttempts(policy: policy) { next = requeue(next, key, policy: policy) }
        return next
    }

    /// 第一次写错 / 看了答案之后（advance 已推进）：要重考就插回去。
    public static func afterFirstWrong(_ s: JSValue, key: JSValue, policy: JSValue = Config.policy) -> JSValue {
        maxAttempts(policy: policy) > 1 ? requeue(s, key, policy: policy) : s
    }

    /// 改判（写字页「修改 ›」）后重考跟着变：错 → 对，拿掉还没考的那一次；对 → 错，插回去。
    public static func afterCorrection(_ s: JSValue, key: JSValue, to judgment: JSValue?, policy: JSValue = Config.policy) -> JSValue {
        let cursor = Int(max(0, JS.number(s["cursor"])))
        var q = s["queue"]?.arrayValue ?? []
        let pending = q.indices.filter { $0 >= cursor && JS.strictEquals(q[$0], key) }
        if JS.isString(judgment, "correct") {
            guard let i = pending.first, !(s["items"]?.arrayValue ?? []).contains(where: { isRetryItem($0) && JS.strictEquals($0["cardKey"], key) }) else { return s }
            q.remove(at: i)
            return JS.with(s, [("queue", .array(q))])
        }
        if JS.isString(judgment, "wrong"), pending.isEmpty { return afterFirstWrong(s, key: key, policy: policy) }
        return s
    }

    // MARK: 进度记账

    /// 第一次（不是重考）处理一个字之后记账：今天的练习里写过 / 看过答案 / 跳过，或自选里写过 / 看过答案。完成后不再记。
    public static func note(_ d: inout JSObject, session s: JSValue, key: String, kind: String, day: String) {
        let plan = isPlan(s), picked = JS.isString(s["kind"], "picked")
        guard plan || (picked && kind != "skipped") else { return }
        var t = today(.object(d), day: day)
        if t.done || t.handled.contains(key) { return }
        t.handled.append(key)
        setToday(&d, t)
    }

    /// 撤销跳过：从今天的进度里拿掉；撤销的是今天的练习那一组时，「完成」也收回。
    public static func unnote(_ d: inout JSObject, session s: JSValue, key: String, day: String) {
        guard isPlan(s) else { return } // 只有今天的练习里的跳过记进了进度（自选的跳过不算）
        var t = today(.object(d), day: day)
        guard t.handled.contains(key) || t.done else { return }
        t.handled.removeAll { $0 == key }
        t.done = false
        setToday(&d, t)
    }

    /// 处理完一个字之后对账：今天的练习写完 → 完成；自选写过的字让今天的练习少排；进度满了且没有在写的今天的练习 → 完成。
    public static func settle(_ d: inout JSObject, day: String, rules: ScheduleRules, deck: ScheduleDeck? = .real, policy: JSValue = Config.policy) throws {
        var t = today(.object(d), day: day)
        let before = t
        if let a = d["sessions"]?["A"], JS.truthy(a), isPlan(a) {
            if SessionRules.isComplete(a) {
                if a["endedEarly"] != .bool(true) && !t.handled.isEmpty { t.done = true }
            } else if let target = t.target {
                trim(&d, today: t, target: target)
                // 拿掉之后这一组可能就写完了
                if let after = d["sessions"]?["A"], SessionRules.isComplete(after), !t.handled.isEmpty { t.done = true }
            }
        }
        let active = activeSession(.object(d), "A").map(isPlan) ?? false
        if !t.done && !active && !t.handled.isEmpty { // 自选写满一份
            if let target = t.target {
                if t.handled.count >= target { t.done = true }
            } else if let deck, try remainingQueue(.object(d), day: day, rules: rules, deck: deck, policy: policy).isEmpty {
                t.done = true
            }
        }
        if t != before { setToday(&d, t) }
    }

    /// 今天的练习还没写的字超出这一份时拿掉：先拿掉今天已经写过的（自选里），再拿掉新字（从后往前），再拿掉最不急的复习字（从后往前）。
    static func trim(_ d: inout JSObject, today t: Today, target: Int) {
        guard var a = d["sessions"]?["A"], JS.truthy(a) else { return }
        let cursor = Int(max(0, JS.number(a["cursor"])))
        var q = a["queue"]?.arrayValue ?? []
        func unattempted() -> [String] {
            var seen = Set<String>(), out: [String] = []
            for i in q.indices where i >= cursor {
                guard let k = q[i].stringValue, !seen.contains(k), attempts(a, q[i]) == 0 else { continue }
                seen.insert(k)
                out.append(k)
            }
            return out
        }
        var drop = Set<String>()
        let pending = unattempted()
        for k in pending where t.handled.contains(k) { drop.insert(k) }
        let counted = t.handled.count
        var excess = counted + pending.count - drop.count - target
        if excess > 0 {
            let sched = d["sched"]?.objectValue
            let isNew: (String) -> Bool = { k in !(sched?[k].map { JS.truthy($0) && JS.truthy($0["fsrs"]) } ?? false) }
            let rest = pending.filter { !drop.contains($0) }
            for k in rest.reversed() where excess > 0 && isNew(k) { drop.insert(k); excess -= 1 }
            for k in rest.reversed() where excess > 0 && !drop.contains(k) { drop.insert(k); excess -= 1 }
        }
        if drop.isEmpty { return }
        let currentBefore = q.indices.contains(cursor) ? q[cursor] : .null
        q = q.enumerated().filter { !($0.offset >= cursor && drop.contains($0.element.stringValue ?? "")) }.map { $0.element }
        var pairs: [(String, JSValue?)] = [("queue", .array(q))]
        let currentAfter = q.indices.contains(cursor) ? q[cursor] : .null
        if !JS.strictEquals(currentBefore, currentAfter) { pairs.append(("current", SessionRules.freshCurrent())) }
        a = JS.with(a, pairs)
        SessionWrites.set(&d, "A", a)
    }

    // MARK: 读（首页 / 开组）

    /// 这一组里还没写第一次的字（按队列顺序，不重复）。
    static func pendingFirsts(_ s: JSValue) -> [String] {
        var seen = Set<String>(), out: [String] = []
        for k in SessionRules.remainingKeys(s) {
            guard let key = k.stringValue, !seen.contains(key), attempts(s, k) == 0 else { continue }
            seen.insert(key)
            out.append(key)
        }
        return out
    }

    /// 今天的练习还要排的字（不写入）：这一份定下之前按每组字数算、减去今天已经写过的；定下之后按这一份剩下的。
    public static func remainingQueue(_ state: JSValue, day: String, rules: ScheduleRules, deck: ScheduleDeck, policy: JSValue = Config.policy) throws -> [String] {
        let t = today(state, day: day)
        let size = Int(JS.number(GroupSize.of(state["settings"], policy: policy)))
        let cap = (t.target ?? size) - t.handled.count
        if cap <= 0 { return [] }
        let plan = try rules.planDaily(state, today: day, deck: deck, policy: policy, cap: cap, handled: t.handled)
        return (plan["queue"]?.arrayValue ?? []).compactMap { $0.stringValue }
    }

    public struct Progress: Equatable {
        public var n: Int
        public var total: Int
        public var done: Bool
        /// 今天的练习有一组正在写（A 槽，没写完）。
        public var active: Bool
    }

    /// 首页用的今天进度。
    public static func progress(_ state: JSValue, day: String, rules: ScheduleRules, deck: ScheduleDeck?, policy: JSValue = Config.policy) throws -> Progress {
        let t = today(state, day: day)
        let active = activeSession(state, "A").map(isPlan) ?? false
        let n = t.handled.count
        if t.done { return Progress(n: n, total: max(n, t.target ?? n), done: true, active: false) }
        if let target = t.target { return Progress(n: n, total: max(n, target), done: !active && n > 0 && n >= target, active: active) }
        // 正在写的今天的练习还没定份数（旧数据 / 夹具造的组）：按这一组还没写第一次的字算
        if active, let a = activeSession(state, "A") { return Progress(n: n, total: n + pendingFirsts(a).count, done: false, active: true) }
        guard let deck else { return Progress(n: n, total: n, done: false, active: active) }
        let rest = try remainingQueue(state, day: day, rules: rules, deck: deck, policy: policy)
        // 今天这一份没有可排的字（例如「只复习」档今天没有到期字）：今天的练习就是 0 个字，算完成（之后「再来一组」）
        return Progress(n: n, total: n + rest.count, done: !active && rest.isEmpty, active: active)
    }

    /// 今天的练习已经完成（下一组 A 是「再来一组」）。
    public static func isDone(_ state: JSValue, day: String, rules: ScheduleRules, deck: ScheduleDeck?, policy: JSValue = Config.policy) throws -> Bool {
        try progress(state, day: day, rules: rules, deck: deck, policy: policy).done
    }

    // MARK: 完成画面

    public struct Summary: Equatable {
        public var correct = 0, passed = 0, again = 0, fresh = 0
        public init(correct: Int = 0, passed: Int = 0, again: Int = 0, fresh: Int = 0) {
            self.correct = correct; self.passed = passed; self.again = again; self.fresh = fresh
        }
    }

    /// 一组的汇总：写对（第一次就对）/ 重考过关 / 明天再来（第一次错或看答案、重考没过）/ 新学（这一组里第一次写的字）。跳过的字不计。
    public static func summary(_ s: JSValue?, records: [JSValue]) -> Summary {
        guard let s, JS.truthy(s) else { return Summary() }
        let items = s["items"]?.arrayValue ?? []
        let byId = Dictionary(records.compactMap { r in r["id"]?.stringValue.map { ($0, r) } }, uniquingKeysWith: { a, _ in a })
        var firstSeen = [String: JSValue]() // cardKey → 最早一条判断 / 看答案记录
        for r in SchedRecords.sortById(records) where SchedRecords.isJudged(r) || JS.isString(r["kind"], "answer-seen") {
            if let k = r["cardKey"]?.stringValue, firstSeen[k] == nil { firstSeen[k] = r }
        }
        var out = Summary()
        for it in items where JS.isString(it["kind"], "judged") || JS.isString(it["kind"], "answer-seen") {
            let key = it["cardKey"]
            let record = it["recordId"]?.stringValue.flatMap { byId[$0] }
            if JS.isString(it["kind"], "judged") && JS.isString(record?["judgment"], "correct") {
                out.correct += 1
            } else if items.contains(where: { isRetryItem($0) && JS.strictEquals($0["cardKey"], key) && JS.isString($0["outcome"], "correct") }) {
                out.passed += 1
            } else {
                out.again += 1
            }
            if let k = key?.stringValue, let f = firstSeen[k], JS.strictEquals(f["sessionId"], s["id"]) { out.fresh += 1 }
        }
        return out
    }
}
