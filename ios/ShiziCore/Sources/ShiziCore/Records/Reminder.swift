import Foundation

// 规则部分（B4.0 暂记 B4.5，B4.3 认领）：提醒的题目选取。
// 页面只管算内容：时间（settings.remind，缺省 policy.remindDefault）、题目（从今天起 8 天，每天取「到那天为止已到期」的字，
// 按 P48 写错过优先、其次到期最久，已被前几天用过的字尽量不重复）、practicedToday（今天有没有 judged 记录，「今天」按提醒时刻归到的那一天，D66 ⑦）。
// 不移植：createReminder / startReminder / inviteReminder（桥与设置页的运行时，仅网页；原生壳的提醒调度在 B4.5 之后另算）。

public enum Reminder {
    /// 一次同步带几天的题目（今天 + 原生 7 天窗口）。
    public static let reminderDays = 8
    public static let permissions = ["granted", "denied", "unknown"]

    package static func policyObject(_ overrides: JSObject?) -> JSObject {
        var pol = Config.policy.objectValue ?? JSObject()
        if let o = overrides { for (k, v) in o.entries { pol[k] = v } }
        return pol
    }

    /// 题库访问（真题库；测试 / 差分可注入另一份卡片）。
    public struct Deck {
        public var cardFor: (String) -> JSValue?
        public var practicable: (String) -> Bool
        public static let shared = Deck(cardFor: { DeckCards.shared.cardForKey($0) }, practicable: { DeckCards.shared.isPracticable($0) })
        public init(cardFor: @escaping (String) -> JSValue?, practicable: @escaping (String) -> Bool) { self.cardFor = cardFor; self.practicable = practicable }
    }

    /// `^(\d{1,2}):(\d{2})$`（对 String(text||'').trim()）。
    static func parseTime(_ text: JSValue?) -> (hour: Double, minute: Double)? {
        let s = Query.jsTrim(text.flatMap { JSX.truthy($0) ? Copy.jsString($0) : nil } ?? "")
        let u = Array(s.utf8)
        guard let colon = u.firstIndex(of: 0x3A), colon >= 1, colon <= 2, u.count == colon + 3 else { return nil }
        let digits: (ArraySlice<UInt8>) -> Int? = { sl in sl.reduce(0 as Int?) { acc, c in (c >= 0x30 && c <= 0x39) ? acc.map { $0 * 10 + Int(c - 0x30) } : nil } }
        guard let h = digits(u[0..<colon]), let m = digits(u[(colon + 1)...]), h <= 23, m <= 59 else { return nil }
        return (Double(h), Double(m))
    }

    /// settings → 提醒设置（补缺省；与设置页 settingsView().remind 同口径）。
    public static func remindOf(_ settings: JSValue?, policy: JSObject? = nil) -> JSValue {
        let pol = policyObject(policy)
        var r: JSValue = .object(JSObject())
        if let s = settings, JSX.truthy(s), let rr = s["remind"], JSX.truthy(rr) { r = rr }
        let def = parseTime(pol["remindDefault"]) ?? (20, 0)
        func int(_ k: String, _ d: Double) -> Double {
            if case .number(let x)? = r[k], x.isFinite, x.rounded(.towardZero) == x { return x }
            return d
        }
        var permission = "unknown"
        if case .string(let p)? = r["permission"], permissions.contains(where: { JSX.eq($0, p) }) { permission = p }
        return .object(JSObject([
            ("enabled", .bool(r["enabled"] == .bool(true))),
            ("hour", .number(int("hour", def.hour))),
            ("minute", .number(int("minute", def.minute))),
            ("permission", .string(permission)),
        ]))
    }

    /// 'base:字' / 'custom:字' / 单字 → cardKey；认不出返回 nil。
    public static func normalizeTargetKey(_ raw: JSValue?) -> String? {
        guard case .string(let s)? = raw else { return nil }
        let text = Query.jsTrim(s).precomposedStringWithCanonicalMapping
        var kind: String?
        var body = text
        for p in ["base", "custom"] {
            let prefix = p + ":"
            if text.utf8.starts(with: prefix.utf8) {
                let rest = String(decoding: Array(text.utf8).dropFirst(prefix.utf8.count), as: UTF8.self)
                // `.+`：至少一个字符且不含行终止符
                if !rest.isEmpty && !rest.unicodeScalars.contains(where: { [0x0A, 0x0D, 0x2028, 0x2029].contains($0.value) }) {
                    kind = p
                    body = rest
                }
                break
            }
        }
        guard body.unicodeScalars.count == 1 else { return nil }
        return (kind ?? "base") + ":" + body
    }

    /// 题面词语：policy.reminderWord='blank' 时目标字位换成 policy.reminderBlank；'word' 时整词。
    public static func maskedWord(_ card: JSValue, policy: JSObject? = nil) -> String {
        let pol = policyObject(policy)
        let chars: [JSValue]
        if case .array(let a)? = card["chars"] { chars = a } else {
            let w = card["word"].flatMap { JSX.truthy($0) ? Copy.jsString($0) : nil } ?? ""
            chars = w.unicodeScalars.map { .string(String($0)) }
        }
        if JSX.eq(pol["reminderWord"], "word") { return chars.map { Copy.jsString($0) }.joined() }
        var glyph = Config.policyString("reminderBlank") ?? ""
        if case .string(let g)? = pol["reminderBlank"], !g.isEmpty { glyph = g }
        return chars.map { ch in (card["target"].map { ch == $0 } ?? false) ? glyph : Copy.jsString(ch) }.joined()
    }

    public struct Candidate {
        public let cardKey: String
        public let due: String
        public let wrong: Bool
        public let card: JSValue
        let lastId: JSValue?
    }

    /// store 状态 → 全部记录（records 按月分组，折叠月份取 kept；月份键按字符串序）。
    public static func recordsOf(_ state: JSValue?) -> [JSValue] {
        var out: [JSValue] = []
        guard let state = state, JSX.truthy(state), let months = state["records"], JSX.truthy(months), case .object(let m) = months else { return out }
        let keys = m.keys.sorted { JSX.cmp($0, $1) < 0 }
        for k in keys {
            let v = m[k]!
            if case .array(let l) = v { out += l } else if JSX.truthy(v), case .array(let kept)? = v["kept"] { out += kept }
        }
        return out
    }

    /// 能进提醒的字（与日子无关的部分），按 P48 排好：写错过在前 → due 早的在前 → 最近一次记录早的在前 → cardKey。
    public static func reminderCandidates(_ state: JSValue?, deck: Deck = .shared, policy: JSObject? = nil, dates: Dates) throws -> [Candidate] {
        let pol = policyObject(policy)
        guard JSX.eq(pol["reminderPick"], "wrong-then-overdue") else {
            throw CoreError.range("unsupported policy.reminderPick: " + (pol["reminderPick"].map { Copy.jsString($0) } ?? "undefined"))
        }
        var sched = JSValue.object(JSObject())
        if let s = state, JSX.truthy(s), let sc = s["sched"], JSX.truthy(sc) { sched = sc }
        var wordOff: JSValue?
        if let s = state, JSX.truthy(s), let w = s["wordOff"], JSX.truthy(w) { wordOff = w }
        var latest = OMap<JSValue>()
        for r in recordsOf(state) where Records.isJudged(r) {
            guard case .string(let k)? = r["cardKey"] else { continue }
            if let prev = latest[k], !(Records.compareRecordIds(prev["id"], r["id"]) < 0) { continue }
            latest[k] = r
        }
        var out: [Candidate] = []
        let keys: [String] = { if case .object(let o) = sched { return o.keys }; return [] }()
        for cardKey in keys {
            guard let entry = sched[cardKey], JSX.truthy(entry), entry["stoppedAt"] == nil, let dueV = entry["due"], dates.isValidDay(dueV), case .string(let due) = dueV else { continue }
            if !deck.practicable(cardKey) { continue }
            guard let card = DeckCards.withWordOff(deck.cardFor(cardKey), wordOff), DeckCards.hasContextWord(card) else { continue }
            if Query.jsTrim(card["py"].flatMap { JSX.truthy($0) ? Copy.jsString($0) : nil } ?? "").isEmpty { continue }
            let last = latest[cardKey]
            out.append(Candidate(cardKey: cardKey, due: due, wrong: last.map { JSX.eq($0["judgment"], "wrong") } ?? false, card: card, lastId: last?["id"]))
        }
        func orElse(_ x: Double, _ y: () -> Double) -> Double { (x == 0 || x.isNaN) ? y() : x }
        let sorted = JSX.stableSort(out) { a, b in
            orElse(a.wrong == b.wrong ? 0 : (a.wrong ? -1 : 1)) {
                orElse(Double(JSX.cmp(a.due, b.due))) {
                    orElse((a.lastId != nil && b.lastId != nil) ? Records.compareRecordIds(a.lastId, b.lastId) : (a.lastId != nil ? -1 : (b.lastId != nil ? 1 : 0))) {
                        Double(JSX.cmp(a.cardKey, b.cardKey))
                    }
                }
            }
        }
        return sorted
    }

    /// 一道提醒题：{day, title, body, targetCardKey}。
    public static func reminderQuestion(_ item: Candidate, day: String, policy: JSObject? = nil) throws -> JSValue {
        let py = Query.jsTrim(item.card["py"].flatMap { JSX.truthy($0) ? Copy.jsString($0) : nil } ?? "")
        return .object(JSObject([
            ("day", .string(day)),
            ("title", .string(try Copy.text("X-REMIND.title", JSObject([("word", .string(maskedWord(item.card, policy: policy))), ("pinyin", .string(py))])))),
            ("body", .string(try Copy.text("X-REMIND.body"))),
            ("targetCardKey", .string(item.cardKey)),
        ]))
    }

    /// 从 today 起 count 天的题目（每天至多一道；那天没有到期字就没有）。
    public static func reminderQuestions(_ state: JSValue?, today: JSValue, count: Int = reminderDays, deck: Deck = .shared, policy: JSObject? = nil, dates: Dates) throws -> [JSValue] {
        guard dates.isValidDay(today) else { throw CoreError.range("reminderQuestions: invalid today " + Copy.jsString(today)) }
        let all = try reminderCandidates(state, deck: deck, policy: policy, dates: dates)
        var used = OSet()
        var out: [JSValue] = []
        for offset in 0..<Swift.max(0, count) {
            let day = try dates.addDays(today, Double(offset))
            let candidates = all.filter { JSX.cmp($0.due, day) <= 0 }
            if candidates.isEmpty { continue }
            let pick = candidates.first { !used.contains($0.cardKey) } ?? candidates[0]
            used.insert(pick.cardKey)
            out.append(try reminderQuestion(pick, day: day, policy: policy))
        }
        return out
    }

    /// 原生「今天」那次提醒归到哪一天（D66 ⑦）：日历上的今天 hour:minute 这一刻的 localDay。没给 now 时就是 today。
    public static func fireDayOf(_ now: JSValue?, _ remind: JSValue?, _ today: JSValue, policy: JSObject? = nil, dates: Dates) throws -> JSValue {
        guard case .number(let n)? = now, n.isFinite, let remind = remind, JSX.truthy(remind) else { return today }
        let pol = policyObject(policy)
        // 时间无效时 new Date(NaN, …) 也无效，localDay(NaN) 抛 TypeError
        let invalid = { try dates.localDay(.number(.nan), dayStartHour: pol["dayStartHour"] ?? .null) }
        guard let t = JSDate.timeClip(n), let f = JSDate.localFields(t, dates.timeZone) else { return .string(try invalid()) }
        func num(_ k: String) -> Double { let x = JSX.toNumber(remind[k]); return (x.isNaN || x == 0) ? 0 : x }
        let hour = num("hour"), minute = num("minute")
        guard hour.isFinite, minute.isFinite, abs(hour) < 1e9, abs(minute) < 1e9 else { return .string(try invalid()) }
        let day = JSDate.makeDay(JSDate.legacyYear(f.year), f.month - 1, f.day)
        let tl = Double(day) * JSDate.msPerDay + hour.rounded(.towardZero) * 3_600_000 + minute.rounded(.towardZero) * 60_000
        guard let fire = JSDate.timeClip(JSDate.utc(tl, dates.timeZone)) else { return .string(try invalid()) }
        return .string(try dates.localDay(.number(fire), dayStartHour: pol["dayStartHour"] ?? .null))
    }

    /// syncReminder 消息体：{enabled, hour, minute, practicedToday, questions}。提醒关着时不算题目。
    public static func reminderPayload(_ state: JSValue?, remind: JSValue? = nil, today: JSValue, now: JSValue? = nil, deck: Deck = .shared, policy: JSObject? = nil, dates: Dates) throws -> JSValue {
        let settings: JSValue? = (state.map { JSX.truthy($0) } ?? false) ? state!["settings"] : nil
        let r = (remind.map { JSX.truthy($0) } ?? false) ? remind! : remindOf(settings, policy: policy)
        let enabled = r["enabled"] == .bool(true)
        let fireDay = try fireDayOf(now, r, today, policy: policy, dates: dates)
        let practiced = Records.todayCount(recordsOf(state), fireDay.stringValue ?? "") > 0
        let questions: [JSValue] = enabled ? try reminderQuestions(state, today: today, deck: deck, policy: policy, dates: dates) : []
        return .object(JSObject([
            ("enabled", .bool(enabled)),
            ("hour", r["hour"] ?? .null),
            ("minute", r["minute"] ?? .null),
            ("practicedToday", .bool(practiced)),
            ("questions", .array(questions)),
        ]))
    }

    /// store 通知是否可能改变提醒内容。
    public static func affectsReminder(_ info: JSValue?) -> Bool {
        guard let info = info, JSX.truthy(info) else { return false }
        if JSX.eq(info["type"], "load") || info["replace"] == .bool(true) { return true }
        guard JSX.eq(info["type"], "commit") || JSX.eq(info["type"], "recover") else { return false }
        guard case .array(let keys)? = info["keys"] else { return false }
        return keys.contains { matchesReminderKey(Copy.jsString($0)) }
    }

    /// `^shizi\.v2\.(records|sched|settings|wordOff)(\.|$)`
    static func matchesReminderKey(_ key: String) -> Bool {
        let prefix = "shizi.v2."
        guard key.utf8.starts(with: prefix.utf8) else { return false }
        let rest = Array(key.utf8).dropFirst(prefix.utf8.count)
        for name in ["records", "sched", "settings", "wordOff"] {
            let n = Array(name.utf8)
            if rest.starts(with: n) {
                let after = rest.dropFirst(n.count)
                if after.isEmpty || after.first == 0x2E { return true }
            }
        }
        return false
    }
}
