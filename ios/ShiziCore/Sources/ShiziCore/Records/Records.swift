import Foundation

// src/core/records.js 的 1:1 移植：记录的构造、校验与查询。纯函数，记录一律是 JSValue（store 里的原样对象，透传时逐字节不变）。
// 口径（01 §3.1 / §3.2）：「最近一次」以 id 序号为准；只有 judged 是有效记录（D18 / D23）；纸上记录（P1-E8）是有效记录但不进作品。
// 需要日期运算的函数带 `Dates`（时区显式传入）。

public enum Records {
    public static let recordKinds = ["judged", "answer-seen", "skipped"]
    public static let judgments = ["correct", "wrong"]
    public static let recordSources = ["screen", "paper"]

    // ---- id 与序号（§3.1）----

    /// `^<lead>([1-9]\d*)$` → 序号（Number(...)）；不匹配 NaN。\d 只认 ASCII。
    static func serial(_ v: JSValue?, lead: UInt8) -> Double {
        guard case .string(let s)? = v else { return .nan }
        let u = Array(s.utf8)
        guard u.count >= 2, u[0] == lead, u[1] >= 0x31, u[1] <= 0x39, u[1...].allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }) else { return .nan }
        return Double(String(decoding: u[1...], as: UTF8.self)) ?? .nan
    }

    public static func recordSerial(_ id: JSValue?) -> Double { serial(id, lead: 0x72) }
    public static func sessionSerial(_ id: JSValue?) -> Double { serial(id, lead: 0x73) }

    public static func recordId(_ serial: Double) throws -> String {
        guard serial.isFinite, serial.rounded(.towardZero) == serial, serial >= 1 else { throw CoreError.range("serial must be a positive integer") }
        return "r" + JSNumber.toString(serial)
    }

    public static func sessionId(_ serial: Double) throws -> String {
        guard serial.isFinite, serial.rounded(.towardZero) == serial, serial >= 1 else { throw CoreError.range("serial must be a positive integer") }
        return "s" + JSNumber.toString(serial)
    }

    /// 按 id 序号升序比较（不合法 id 排最前）；返回 JS 的差值（可能是 NaN：两边都是 Infinity）。
    public static func compareRecordIds(_ a: JSValue?, _ b: JSValue?) -> Double {
        let sa = recordSerial(a)
        let sb = recordSerial(b)
        return (sa.isNaN ? -1 : sa) - (sb.isNaN ? -1 : sb)
    }

    public static func sortById(_ records: [JSValue]) -> [JSValue] {
        JSX.stableSort(records) { compareRecordIds($0["id"], $1["id"]) }
    }

    /// 下一个可用序号 = max(records、sessions 中已用序号, meta.serial) + 1。sessions 形如 {A, B, lastEnded:{A?, B?}}。
    public static func nextSerial(records: [JSValue] = [], sessions: JSValue? = nil, metaSerial: Double = 0) -> Double {
        var max = (metaSerial.isFinite && metaSerial.rounded(.towardZero) == metaSerial && metaSerial > 0) ? metaSerial : 0
        for r in records {
            let s = recordSerial(r["id"])
            if s > max { max = s }
        }
        func visit(_ session: JSValue?) {
            guard JSX.truthy(session), let session = session else { return }
            let s = sessionSerial(session["id"])
            if s > max { max = s }
            if case .array(let items)? = session["items"] {
                for item in items {
                    let rs = recordSerial(JSX.truthy(item) ? item["recordId"] : nil)
                    if rs > max { max = rs }
                }
            }
        }
        if JSX.truthy(sessions), let sessions = sessions {
            visit(sessions["A"])
            visit(sessions["B"])
            if let last = sessions["lastEnded"], JSX.truthy(last) {
                visit(last["A"])
                visit(last["B"])
            }
        }
        return max + 1
    }

    // ---- 卡键 ----

    /// `^(base|custom):(.+)$`（u 标志：`.` 不含行终止符 \n \r U+2028 U+2029），后半恰好一个码点。
    public static func charOfCardKey(_ cardKey: JSValue?) -> String? {
        guard case .string(let s)? = cardKey else { return nil }
        return charOfCardKey(s)
    }

    public static func charOfCardKey(_ s: String) -> String? {
        var rest: Substring.UnicodeScalarView?
        let us = s.unicodeScalars
        for p in ["base:", "custom:"] {
            if us.starts(with: p.unicodeScalars) {
                rest = us.dropFirst(p.unicodeScalars.count)
                break
            }
        }
        guard let body = rest, !body.isEmpty else { return nil }
        if body.contains(where: { $0.value == 0x0A || $0.value == 0x0D || $0.value == 0x2028 || $0.value == 0x2029 }) { return nil }
        guard body.count == 1 else { return nil }
        return String(String.UnicodeScalarView(body))
    }

    // ---- 构造与校验 ----

    static func normalizeHelp(_ help: JSValue?) -> JSValue {
        let h = JSX.truthy(help) ? help! : .object(JSObject())
        var hints = JSX.toNumber(h["hints"])
        if hints.isNaN || hints == 0 { hints = 0 }
        let t = hints.rounded(.towardZero)
        let clamped = Swift.max(0, Swift.min(Schema.hintsShapeMax, t))
        return .object(JSObject([
            ("hints", .number(clamped == 0 ? 0 : clamped)),
            ("answerSeen", .bool(h["answerSeen"] == .bool(true))),
            ("traced", .bool(h["traced"] == .bool(true))),
        ]))
    }

    static func isObjectOrArray(_ v: JSValue) -> Bool {
        switch v { case .object, .array: return true; default: return false }
    }

    static func isInteger(_ v: JSValue?) -> Bool {
        if case .number(let d)? = v { return d.isFinite && d.rounded(.towardZero) == d }
        return false
    }

    /// 记录形状校验；返回错误列表（空 = 合法）。
    public static func validateRecord(_ r: JSValue?, dates: Dates) -> [String] {
        guard let r = r, case .object = r else { return ["record must be an object"] }
        var errors: [String] = []
        if recordSerial(r["id"]).isNaN { errors.append("id must look like r<serial>") }
        let ch = charOfCardKey(r["cardKey"])
        if ch == nil { errors.append("cardKey must be base:<\u{5B57}> or custom:<\u{5B57}>") } else if !JSX.eq(r["char"], ch!) { errors.append("char must match cardKey") }
        let kind = r["kind"]?.stringValue
        if !(kind.map { k in recordKinds.contains { JSX.eq($0, k) } } ?? false) { errors.append("kind must be judged | answer-seen | skipped") }
        if kind != nil && JSX.eq(kind!, "judged") {
            let j = r["judgment"]?.stringValue
            if !(j.map { x in judgments.contains { JSX.eq($0, x) } } ?? false) { errors.append("judged record needs judgment correct | wrong") }
        } else if r["judgment"] != nil {
            errors.append("only judged records carry a judgment")
        }
        if !JSX.truthy(r["legacy"]) && sessionSerial(r["sessionId"]).isNaN { errors.append("sessionId must look like s<serial>") }
        if case .number(let at)? = r["at"], at.isFinite {} else { errors.append("at must be a finite ms timestamp") }
        if !dates.isValidDay(r["localDay"] ?? .null) { errors.append("localDay must be YYYY-MM-DD") }
        if let help = r["help"], JSX.truthy(help), isObjectOrArray(help) {
            let hmax = Int(Schema.hintsShapeMax)
            if case .number(let h)? = help["hints"], isInteger(.number(h)), h >= 0, h <= Schema.hintsShapeMax {} else { errors.append("help.hints must be an integer 0..\(hmax)") }
            if help["answerSeen"]?.boolValue == nil { errors.append("help.answerSeen must be boolean") }
            if help["traced"]?.boolValue == nil { errors.append("help.traced must be boolean") }
        } else {
            errors.append("help must be an object")
        }
        if let corrections = r["corrections"] {
            if case .array(let list) = corrections {
                if !(kind.map { JSX.eq($0, "judged") } ?? false) {
                    errors.append("only judged records can be corrected")
                } else if list.contains(where: { c in
                    guard JSX.truthy(c) else { return true }
                    guard let from = c["from"]?.stringValue, judgments.contains(where: { JSX.eq($0, from) }) else { return true }
                    if case .number? = c["at"] { return false }
                    return true
                }) {
                    errors.append("corrections entries must be {from, at}")
                }
            } else {
                errors.append("corrections must be an array")
            }
        }
        if let inkId = r["inkId"], inkId.stringValue == nil { errors.append("inkId must be a string") }
        if let legacy = r["legacy"], legacy != .bool(true) { errors.append("legacy must be true when present") }
        if let source = r["source"] {
            if let s = source.stringValue, recordSources.contains(where: { JSX.eq($0, s) }) {
                if JSX.eq(s, "paper") {
                    if !(kind.map { JSX.eq($0, "judged") } ?? false) { errors.append("only judged records can be on paper") }
                    if r["inkId"] != nil { errors.append("a paper record has no ink (inkId not allowed)") }
                }
            } else {
                errors.append("source must be screen | paper")
            }
        }
        return errors
    }

    /// 构造一条记录。localDay 由 at 按本地日推出；help 规整；形状不合法时抛 RangeError。
    public static func makeRecord(_ a: JSObject, dates: Dates) throws -> JSValue {
        var o = JSObject()
        o["id"] = a["id"]
        o["cardKey"] = a["cardKey"]
        if let ch = charOfCardKey(a["cardKey"]) { o["char"] = .string(ch) }
        o["sessionId"] = a["sessionId"]
        o["kind"] = a["kind"]
        o["at"] = a["at"]
        if case .number(let at)? = a["at"], at.isFinite { o["localDay"] = .string(try dates.localDay(.number(at))) }
        var help = normalizeHelp(a["help"])
        if JSX.eq(a["kind"], "answer-seen"), case .object(var h) = help { h["answerSeen"] = .bool(true); help = .object(h) }
        o["help"] = help
        // 非 judged 带 judgment 视为编程错误：放进对象让校验报出来（judged 缺 judgment：JS 里键存在而值 undefined，校验同样报错）
        if let j = a["judgment"] { o["judgment"] = j }
        if let ink = a["inkId"] { o["inkId"] = ink }
        if let s = a["source"], !JSX.eq(s, "screen") { o["source"] = s }
        // 键序：JS 字面量序 id, cardKey, char, sessionId, kind, at, localDay, help，其后 judgment, inkId, source
        let ordered = orderedRecord(o)
        let errors = validateRecord(ordered, dates: dates)
        if !errors.isEmpty { throw CoreError.range("invalid record: " + errors.joined(separator: "; ")) }
        return ordered
    }

    /// 按 makeRecord 的写入序整理键序（缺的键跳过）。
    private static func orderedRecord(_ o: JSObject) -> JSValue {
        var out = JSObject()
        for k in ["id", "cardKey", "char", "sessionId", "kind", "at", "localDay", "help", "judgment", "inkId", "source"] {
            if let v = o[k] { out[k] = v }
        }
        return .object(out)
    }

    public static func isJudged(_ r: JSValue?) -> Bool { JSX.truthy(r) && JSX.eq(r?["kind"], "judged") }

    // ---- 纸上记录（P1-E8，D46 ⑬ / D47）----

    public static func recordSource(_ r: JSValue?) -> String { JSX.truthy(r) && JSX.eq(r?["source"], "paper") ? "paper" : "screen" }
    public static func isPaperRecord(_ r: JSValue?) -> Bool { JSX.truthy(r) && JSX.eq(r?["source"], "paper") }
    public static func isWorkRecord(_ r: JSValue?) -> Bool { isJudged(r) && !isPaperRecord(r) }

    /// 看后自写：看过答案、且留有本人墨（hasInk 由调用方注入；抛错按没有）。
    public static func isAfterSeenWork(_ r: JSValue?, _ hasInk: ((JSValue) throws -> Bool)?) -> Bool {
        guard JSX.truthy(r), let r = r, JSX.eq(r["kind"], "answer-seen"), let hasInk = hasInk else { return false }
        return (try? hasInk(r)) ?? false
    }

    public static func isWorkOrAfterSeen(_ r: JSValue?, _ hasInk: ((JSValue) throws -> Bool)?) -> Bool {
        isWorkRecord(r) || isAfterSeenWork(r, hasInk)
    }

    public static func withoutPaper(_ records: [JSValue]) -> [JSValue] { records.filter { !isPaperRecord($0) } }

    /// 折叠月份里「作品」的 byDay：去掉只在纸上写过的（日, 字）；去掉后没有字的日子不出现。
    public static func foldWorkByDay(_ fold: JSValue?) -> JSObject {
        var out = JSObject()
        guard let fold = fold, JSX.truthy(fold) else { return out }
        let byDay = (fold["byDay"].flatMap { v -> JSObject? in if case .object(let o) = v, JSX.truthy(v) { return o }; return nil }) ?? JSObject()
        let paperOnly = fold["paperOnly"].flatMap { v -> JSObject? in if case .object(let o) = v { return o }; return nil }
        for (day, chars) in byDay.entries {
            guard case .array(let list) = chars else { continue }
            var kept = list
            if let po = paperOnly, case .array(let skip)? = po[day] { kept = list.filter { c in !skip.contains(c) } }
            if !kept.isEmpty { out[day] = .array(kept) }
        }
        return out
    }

    /// 更正（D19）：只改 judgment、追加 corrections；同判断返回原对象。
    public static func correctRecord(_ record: JSValue, _ judgment: JSValue, at: JSValue) throws -> JSValue {
        guard isJudged(record) else { throw CoreError.range("only judged records can be corrected") }
        if JSX.truthy(record["legacy"]) { throw CoreError.range("legacy records cannot be corrected") }
        guard let j = judgment.stringValue, judgments.contains(where: { JSX.eq($0, j) }) else { throw CoreError.range("judgment must be correct or wrong") }
        if JSX.eq(record["judgment"], j) { return record }
        guard case .object(var o) = record else { return record }
        // [...(record.corrections || [])]：数组展开；字符串按码点展开；其余真值不可迭代（TypeError）
        var prior: [JSValue] = []
        if let c = record["corrections"], JSX.truthy(c) {
            switch c {
            case .array(let a): prior = a
            case .string(let s): prior = s.unicodeScalars.map { .string(String($0)) }
            default: throw CoreError.type("record.corrections is not iterable")
            }
        }
        // { ...record, judgment, corrections }：已有键保位，新键追加
        o["judgment"] = .string(j)
        // JS: from 为 record.judgment（可能 undefined → 键丢失）
        var entry = JSObject()
        if let from = record["judgment"] { entry["from"] = from }
        entry["at"] = at
        o["corrections"] = .array(prior + [.object(entry)])
        return .object(o)
    }

    public static func replaceRecord(_ records: [JSValue], _ next: JSValue) throws -> [JSValue] {
        var found = false
        let out = records.map { r -> JSValue in
            if let id = r["id"], let nid = next["id"], id == nid { found = true; return next }
            if r["id"] == nil, next["id"] == nil { found = true; return next }
            return r
        }
        if !found { throw CoreError.range("record not found: " + (next["id"].map { Copy.jsString($0) } ?? "undefined")) }
        return out
    }

    public static func removeRecord(_ records: [JSValue], _ id: JSValue) throws -> [JSValue] {
        let out = records.filter { r in
            guard let rid = r["id"] else { return true } // undefined !== id
            return rid != id
        }
        if out.count == records.count { throw CoreError.range("record not found: " + Copy.jsString(id)) }
        return out
    }

    // ---- 查询 ----

    /// 每个 cardKey 最近一次 judged 记录（按 id 序号，D23）。按首次出现的顺序。
    public static func latestJudgedByCard(_ records: [JSValue]) -> OMap<JSValue> {
        var latest = OMap<JSValue>()
        for r in records where isJudged(r) {
            guard case .string(let key)? = r["cardKey"] else { continue } // JS Map 键可为 undefined；协议数据里 cardKey 总是字串
            if let prev = latest[key], !(compareRecordIds(prev["id"], r["id"]) < 0) { continue }
            latest[key] = r
        }
        return latest
    }

    /// 「已练汉字」（D66 ⑤）：有判断记录的字取最近一次判断；没判断过但看过答案的字取最近一次看过答案。按字聚合。
    public static func practicedByChar(_ records: [JSValue]) -> OMap<JSValue> {
        var judged = OMap<JSValue>()
        var seen = OMap<JSValue>()
        for r in records {
            guard JSX.truthy(r), case .string(let ch)? = r["char"] else { continue }
            let isSeen = JSX.eq(r["kind"], "answer-seen")
            guard isJudged(r) || isSeen else { continue }
            if isJudged(r) {
                if let prev = judged[ch], !(compareRecordIds(prev["id"], r["id"]) < 0) { continue }
                judged[ch] = r
            } else {
                if let prev = seen[ch], !(compareRecordIds(prev["id"], r["id"]) < 0) { continue }
                seen[ch] = r
            }
        }
        for (ch, r) in seen.entries where !judged.has(ch) { judged[ch] = r }
        return judged
    }

    public static func isSeenOnly(_ record: JSValue?) -> Bool { JSX.truthy(record) && JSX.eq(record?["kind"], "answer-seen") }

    public static func latestJudged(_ records: [JSValue], _ cardKey: String) -> JSValue? {
        latestJudgedByCard(records.filter { JSX.eq($0["cardKey"], cardKey) })[cardKey]
    }

    public static func recordsOfCard(_ records: [JSValue], _ cardKey: String) -> [JSValue] {
        sortById(records.filter { JSX.eq($0["cardKey"], cardKey) })
    }

    public static func judgedCountOfCard(_ records: [JSValue], _ cardKey: String) -> Int {
        records.filter { isJudged($0) && JSX.eq($0["cardKey"], cardKey) }.count
    }

    public static func wrongCountOfCard(_ records: [JSValue], _ cardKey: String) -> Int {
        records.filter { isJudged($0) && JSX.eq($0["cardKey"], cardKey) && JSX.eq($0["judgment"], "wrong") }.count
    }

    public static func firstJudgedOfCard(_ records: [JSValue], _ cardKey: String) -> JSValue? {
        sortById(records.filter { isJudged($0) && JSX.eq($0["cardKey"], cardKey) }).first
    }

    public static func writtenCardKeys(_ records: [JSValue]) -> [String] { latestJudgedByCard(records).keys }

    public static func hasAnyJudged(_ records: [JSValue]) -> Bool { records.contains { isJudged($0) } }

    /// 写错过（K15）：最近一次 judged 为 wrong 的字，最近写错的排前。
    public static func wrongList(_ records: [JSValue]) -> [JSValue] {
        let wrong = latestJudgedByCard(records).values.filter { JSX.eq($0["judgment"], "wrong") }
        return JSX.stableSort(wrong) { compareRecordIds($1["id"], $0["id"]) }
    }

    public static func isInWrongList(_ records: [JSValue], _ cardKey: String) -> Bool {
        guard let r = latestJudged(records, cardKey) else { return false }
        return JSX.eq(r["judgment"], "wrong")
    }

    public struct ForgetItem {
        public let cardKey: String
        public let record: JSValue
        public let due: String
        public let overdue: Double
    }

    /// 快忘了（K16，P04）：最近一次 judged 为 correct 且 sched 到期；逾期天数降序 → 稳定度升序 → 最近记录 id 升序；最多 policy.forgetCap 个。
    public static func forgetList(records: [JSValue], sched: JSValue?, today: JSValue, dates: Dates, policy: JSObject? = nil) throws -> (items: [ForgetItem], total: Int) {
        let pol = policy ?? (Config.policy.objectValue ?? JSObject())
        guard JSX.eq(pol["forgetRule"], "due") else {
            throw CoreError.range("unsupported policy.forgetRule: " + (pol["forgetRule"].map { Copy.jsString($0) } ?? "undefined"))
        }
        struct Row { var cardKey: String; var record: JSValue; var due: String; var overdue: Double; var stability: Double }
        var all: [Row] = []
        for (cardKey, record) in latestJudgedByCard(records).entries {
            guard JSX.eq(record["judgment"], "correct") else { continue }
            guard let schedObj = sched, JSX.truthy(schedObj) else { continue }
            guard let entry = schedObj[cardKey], JSX.truthy(entry) else { continue }
            if entry["stoppedAt"] != nil { continue }
            guard let dueV = entry["due"], dates.isValidDay(dueV), case .string(let due) = dueV else { continue }
            let overdue = try dates.diffDays(dueV, today)
            if overdue < 0 { continue }
            var stability = 0.0
            if let fsrs = entry["fsrs"], JSX.truthy(fsrs) {
                let n = JSX.toNumber(fsrs["stability"])
                stability = (n.isNaN || n == 0) ? 0 : n
            }
            all.append(Row(cardKey: cardKey, record: record, due: due, overdue: overdue, stability: stability))
        }
        func orElse(_ x: Double, _ y: () -> Double) -> Double { (x == 0 || x.isNaN) ? y() : x }
        let sorted = JSX.stableSort(all) { a, b in
            orElse(b.overdue - a.overdue) { orElse(a.stability - b.stability) { compareRecordIds(a.record["id"], b.record["id"]) } }
        }
        let capV = pol["forgetCap"]
        let cap: Int
        if case .number(let c)? = capV, isInteger(.number(c)), c >= 0 { cap = c > Double(sorted.count) ? sorted.count : Int(c) } else { cap = sorted.count }
        let items = sorted.prefix(cap).map { ForgetItem(cardKey: $0.cardKey, record: $0.record, due: $0.due, overdue: $0.overdue) }
        return (Array(items), sorted.count)
    }

    /// 某天有 judged 记录的 cardKey 集合（按首次出现）。
    public static func judgedCardKeysOn(_ records: [JSValue], _ day: String) -> [String] {
        var out = OSet()
        for r in records where isJudged(r) && JSX.eq(r["localDay"], day) { if case .string(let k)? = r["cardKey"] { out.insert(k) } }
        return out.items
    }

    public static func answerSeenCardKeysOn(_ records: [JSValue], _ day: String) -> [String] {
        var out = OSet()
        for r in records where JSX.truthy(r) && JSX.eq(r["kind"], "answer-seen") && JSX.eq(r["localDay"], day) { if case .string(let k)? = r["cardKey"] { out.insert(k) } }
        return out.items
    }

    /// 某一天（或 fromDay 起到 day 为止，含两端）跳过的 cardKey 集合（D65 #5）。
    public static func skippedCardKeysOn(_ records: [JSValue], _ day: String, fromDay: String? = nil) -> [String] {
        let from = fromDay ?? day
        var out = OSet()
        for r in records where JSX.truthy(r) && JSX.eq(r["kind"], "skipped") {
            guard case .string(let ld)? = r["localDay"] else { continue }
            if JSX.cmp(ld, from) >= 0 && JSX.cmp(ld, day) <= 0, case .string(let k)? = r["cardKey"] { out.insert(k) }
        }
        return out.items
    }

    /// 「今天记录了 N 个字」：今天 judged 按字去重的个数。
    public static func todayCount(_ records: [JSValue], _ today: String) -> Int { judgedCardKeysOn(records, today).count }

    /// 本日 judged 的「复习字」个数：今天有 judged、且在今天以前已有 judged。
    public static func reviewsDoneOn(_ records: [JSValue], _ day: String) -> Int {
        var firstDay = OMap<String>()
        for r in records where isJudged(r) {
            guard case .string(let k)? = r["cardKey"], case .string(let d)? = r["localDay"] else { continue }
            if let prev = firstDay[k], !(JSX.cmp(d, prev) < 0) { continue }
            firstDay[k] = d
        }
        var count = 0
        for key in judgedCardKeysOn(records, day) {
            if let f = firstDay[key], JSX.cmp(f, day) < 0 { count += 1 }
        }
        return count
    }

    /// 按月索引：{ 'YYYY-MM': Record[]（按 id 升序） }。
    public static func recordsByMonth(_ records: [JSValue], dates: Dates) throws -> JSObject {
        var out = JSObject()
        for r in sortById(records) {
            let month = try dates.monthOf(r["localDay"] ?? .null)
            if case .array(let list)? = out[month] { out[month] = .array(list + [r]) } else { out[month] = .array([r]) }
        }
        return out
    }

    /// 某月有 judged 记录的日子（升序）。
    public static func judgedDaysInMonth(_ records: [JSValue], _ month: String) -> [String] {
        var days = OSet()
        let prefix = month + "-"
        for r in records where isJudged(r) {
            if case .string(let d)? = r["localDay"], d.utf8.starts(with: prefix.utf8) { days.insert(d) }
        }
        return days.items.sorted { JSX.cmp($0, $1) < 0 }
    }
}
