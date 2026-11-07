import Foundation

// 1:1 移植自原 JS 版：首练结果页专属的纯函数（P1-E5；D28 / D35 / D41 / D46 ③ / D48）。
//   复现预告（reviewPreview / previewText）、每字「N 天后再见」（reviewDays / daysLaterText / daysLaterLine）、提醒邀请（inviteOf / inviteDecision / inviteTime）。
// commitInviteShown / commitInviteAnswer 是对 store 的写入（经 store.commit）：这里只有它们的规则部分（给出新的 settings 或「跳过」），
// 提交、校验、发布由 B4.4 的 store 与 B4.5 的会话 ops 接。
// 文案经 translate（= Copy.text）取：占位符值里的「字」引号用 U+300C / U+300D。

public enum FirstResult {
    /// 档位（近 → 远）。
    public static let tiers = ["tomorrow", "soon", "later"]
    /// 邀请次数上限（D46 ③）。
    public static let inviteMax = 2.0

    static let openQuote = "\u{300C}"
    static let closeQuote = "\u{300D}"

    public typealias Translate = (String, JSObject?) throws -> String

    public static let copyTranslate: Translate = { key, vars in try Copy.text(key, vars) }

    /// 到期日 → 档位。到期日不晚于今天（已到期）也算「明天」。
    public static func tierOfDue(_ due: JSValue, _ today: JSValue, dates: Dates) throws -> String {
        let n = try dates.diffDays(today, due)
        if n <= 1 { return "tomorrow" }
        if n <= 3 { return "soon" }
        return "later"
    }

    /// {char, cardKey} 项（按组内顺序）。
    static func itemParts(_ item: JSValue) -> (char: JSValue, cardKey: String)? {
        guard JSX.truthy(item), case .string(let k)? = item["cardKey"] else { return nil }
        return (item["char"] ?? .null, k)
    }

    static func schedEntry(_ sched: JSValue?, _ cardKey: String) -> JSValue? {
        guard let s = sched, JSX.truthy(s), let e = s[cardKey], JSX.truthy(e) else { return nil }
        return e
    }

    public struct Preview {
        public var groups: [(tier: String, chars: [JSValue])]
        public var same: Bool
        public var js: JSValue {
            .object(JSObject([
                ("groups", .array(groups.map { .object(JSObject([("tier", .string($0.tier)), ("chars", .array($0.chars))])) })),
                ("same", .bool(same)),
            ]))
        }
    }

    /// 复现预告的分组：按档位从近到远、同档的字按组内顺序；same = 只有一档且至少两个字。
    public static func reviewPreview(chars: [JSValue], sched: JSValue?, today: JSValue, dates: Dates) throws -> Preview {
        var by: [String: [JSValue]] = ["tomorrow": [], "soon": [], "later": []]
        var seen = OSet()
        for item in chars {
            guard let (ch, key) = itemParts(item), !seen.contains(key) else { continue }
            guard let entry = schedEntry(sched, key), case .string? = entry["due"], entry["stoppedAt"] == nil else { continue }
            seen.insert(key)
            by[try tierOfDue(entry["due"]!, today, dates: dates)]!.append(ch)
        }
        let groups = tiers.filter { !by[$0]!.isEmpty }.map { (tier: $0, chars: by[$0]!) }
        let total = groups.reduce(0) { $0 + $1.chars.count }
        return Preview(groups: groups, same: groups.count == 1 && total >= 2)
    }

    /// 预告句文案；没有可预告的字返回 ""。
    public static func previewText(_ preview: Preview, translate: Translate = copyTranslate) throws -> String {
        if preview.groups.isEmpty { return "" }
        func tier(_ g: (tier: String, chars: [JSValue])) throws -> String { try translate("X-FIRST.tier." + g.tier, nil) }
        if preview.same { return try translate("X-FIRST.reviewSame", JSObject([("tier", .string(try tier(preview.groups[0])))])) }
        func quote(_ g: (tier: String, chars: [JSValue])) -> String { g.chars.map { openQuote + Copy.jsString($0) + closeQuote }.joined() }
        var parts: [String] = []
        for (i, g) in preview.groups.enumerated() {
            parts.append(try translate(i == 0 ? "X-FIRST.reviewFirst" : "X-FIRST.reviewNext",
                                       JSObject([("chars", .string(quote(g))), ("tier", .string(try tier(g)))])))
        }
        return parts.joined(separator: try translate("X-FIRST.reviewJoin", nil)) + (try translate("X-FIRST.reviewEnd", nil))
    }

    public struct DayItem {
        public let char: JSValue
        public let cardKey: String
        public let days: Double
        public var js: JSValue { .object(JSObject([("char", char), ("cardKey", .string(cardKey)), ("days", .number(days))])) }
    }

    /// 每字「N 天后再见」的天数：没有调度或已停的字不列；重复的字只列一次；已到期按 1 天。
    public static func reviewDays(chars: [JSValue], sched: JSValue?, today: JSValue, dates: Dates) throws -> [DayItem] {
        var out: [DayItem] = []
        var seen = OSet()
        for item in chars {
            guard let (ch, key) = itemParts(item), !seen.contains(key) else { continue }
            guard let entry = schedEntry(sched, key), case .string? = entry["due"], entry["stoppedAt"] == nil else { continue }
            seen.insert(key)
            let d = try dates.diffDays(today, entry["due"]!)
            out.append(DayItem(char: ch, cardKey: key, days: d.isNaN ? .nan : Swift.max(1, d)))
        }
        return out
    }

    /// 「N 天后再见」；1 天（含已到期）说「明天再见」。
    public static func daysLaterText(_ days: JSValue?, translate: Translate = copyTranslate) throws -> String {
        let raw = JSX.toNumber(days)
        let v = (raw.isNaN || raw == 0) ? 0 : raw
        let n = Swift.max(1, Dates.jsRound(v))
        if n <= 1 { return try translate("X-FIRST.daysLaterTomorrow", nil) }
        return try translate("X-FIRST.daysLater", JSObject([("n", .number(n))]))
    }

    /// 结果页复现句：天数相同的字合并成一个分句，天数从近到远；所有字天数相同且至少两个字时只写「3 天后再见。」。没有调度的字不进；一个都没有返回 ""。
    public static func daysLaterLine(chars: [JSValue], sched: JSValue?, today: JSValue, dates: Dates, translate: Translate = copyTranslate) throws -> String {
        let list = try reviewDays(chars: chars, sched: sched, today: today, dates: dates)
        if list.isEmpty { return "" }
        var byDays: [(days: Double, chars: [JSValue])] = []
        for item in list {
            if let i = byDays.firstIndex(where: { $0.days == item.days || ($0.days.isNaN && item.days.isNaN) }) { byDays[i].chars.append(item.char) } else { byDays.append((item.days, [item.char])) }
        }
        let groups = JSX.stableSort(byDays) { $0.days - $1.days }
        if groups.count == 1 && list.count >= 2 {
            let text = try daysLaterText(.number(groups[0].days), translate: translate)
            return try translate("X-FIRST.laterSame", JSObject([("text", .string(text))])) + (try translate("X-FIRST.reviewEnd", nil))
        }
        var parts: [String] = []
        for g in groups {
            let chars = g.chars.map { openQuote + Copy.jsString($0) + closeQuote }.joined()
            parts.append(try translate("X-FIRST.laterGroup", JSObject([("chars", .string(chars)), ("text", .string(try daysLaterText(.number(g.days), translate: translate)))])))
        }
        return parts.joined(separator: try translate("X-FIRST.reviewJoin", nil)) + (try translate("X-FIRST.reviewEnd", nil))
    }

    // ---- 提醒邀请 ----

    public struct Invite: Equatable {
        public var shown: Double
        public var last: String?
        public var answered: String?
        public var js: JSValue {
            .object(JSObject([("shown", .number(shown)), ("last", last.map { .string($0) } ?? .null), ("answered", answered.map { .string($0) } ?? .null)]))
        }
    }

    /// settings → 邀请状态（补缺省）。
    public static func inviteOf(_ settings: JSValue?) -> Invite {
        var r: JSValue = .object(JSObject())
        if let s = settings, JSX.truthy(s), let ri = s["remindInvite"], JSX.truthy(ri) { r = ri }
        var shown = 0.0
        if case .number(let d)? = r["shown"], d.isFinite, d.rounded(.towardZero) == d, d > 0 { shown = d }
        var last: String?
        if case .string(let s)? = r["last"] { last = s }
        var answered: String?
        if case .string(let a)? = r["answered"], ["yes", "no", "denied"].contains(where: { JSX.eq($0, a) }) { answered = a }
        return Invite(shown: shown, last: last, answered: answered)
    }

    /// 这一页要不要显示提醒邀请块：'show' | 'hidden'。variant: first | daily | picked。
    public static func inviteDecision(settings: JSValue?, variant: JSValue?, sessionId: JSValue?) -> String {
        if let s = settings, JSX.truthy(s), let remind = s["remind"], JSX.truthy(remind), remind["enabled"] == .bool(true) { return "hidden" }
        let s = inviteOf(settings)
        if s.answered != nil { return "hidden" }
        if let last = s.last, JSX.eq(sessionId, last) { return "show" }
        if s.shown >= inviteMax { return "hidden" }
        if JSX.eq(variant, "first") { return s.shown == 0 ? "show" : "hidden" }
        if JSX.eq(variant, "daily") { return s.shown == 1 ? "show" : "hidden" }
        return "hidden"
    }

    /// 邀请的提醒时间：现在向下取整到半点；落在 7:00–22:00 之外取 20:30。evening = 取了 20:30。
    public static func inviteTime(_ nowMs: Double, dates: Dates) -> JSValue {
        var hour = Double.nan
        var minute = 30.0
        if let t = JSDate.timeClip(nowMs) {
            let tl = JSDate.localTime(t, dates.timeZone)
            let dayNum = (tl / JSDate.msPerDay).rounded(.down)
            let msInDay = tl - dayNum * JSDate.msPerDay
            hour = (msInDay / 3_600_000).rounded(.down)
            let m = ((msInDay - hour * 3_600_000) / 60_000).rounded(.down)
            minute = m < 30 ? 0 : 30
        }
        let total = hour * 60 + minute
        if total < 7 * 60 || total >= 22 * 60 {
            return .object(JSObject([("hour", .number(20)), ("minute", .number(30)), ("evening", .bool(true))]))
        }
        return .object(JSObject([("hour", .number(hour)), ("minute", .number(minute)), ("evening", .bool(false))]))
    }

    /// 'H:MM'（小时不补零）。
    public static func inviteTimeText(_ hour: JSValue?, _ minute: JSValue?) -> String {
        let m = Copy.jsString(minute ?? .string("undefined"))
        let padded = String(repeating: "0", count: Swift.max(0, 2 - m.utf16.count)) + m
        return Copy.jsString(hour ?? .string("undefined")) + ":" + padded
    }

    // ---- 邀请写入的规则部分（commitInvite*）----

    public static let inviteShownLabel = "invite:shown"
    public static let inviteAnswerLabel = "invite:answer"

    /// `{...settings, remindInvite: {...(settings.remindInvite || {}), ...patch}}`（settings 缺省按 {}）。
    static func writeInvite(_ settings: JSValue?, _ patch: [(String, JSValue)]) -> JSValue {
        var base = JSObject()
        if let st = settings, JSX.truthy(st), case .object(let o) = st { base = o }
        var invite = JSObject()
        if let ri = base["remindInvite"], JSX.truthy(ri), case .object(let o) = ri { invite = o }
        for (k, v) in patch { invite[k] = v }
        base["remindInvite"] = .object(invite)
        return .object(base)
    }

    /// 邀请显示出来时记一次：返回写入后的 settings；同一会话 / 已满两次返回 nil（跳过，不写）。
    public static func inviteShownUpdate(settings: JSValue?, sessionId: JSValue) -> JSValue? {
        let cur = inviteOf(settings)
        if let last = cur.last, JSX.eq(sessionId, last) { return nil }
        if cur.shown >= inviteMax { return nil }
        let now = inviteOf(settings)
        return writeInvite(settings, [("shown", .number(Swift.min(inviteMax, now.shown + 1))), ("last", sessionId)])
    }

    /// 记下用户的回应（yes / no / denied）：返回写入后的 settings；同一回应已记过返回 nil。其他值抛 RangeError。
    public static func inviteAnswerUpdate(settings: JSValue?, answer: JSValue) throws -> JSValue? {
        guard case .string(let a) = answer, ["yes", "no", "denied"].contains(where: { JSX.eq($0, a) }) else {
            throw CoreError.range("unknown invite answer: " + Copy.jsString(answer))
        }
        if let cur = inviteOf(settings).answered, JSX.eq(cur, a) { return nil }
        return writeInvite(settings, [("answered", answer)])
    }
}
