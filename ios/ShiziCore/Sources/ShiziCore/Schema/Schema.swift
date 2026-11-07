import Foundation

// 1:1 移植自原 JS 版（B4.1）：v2 键的形状表与校验。校验函数返回 nil = 通过，否则「路径: 原因」字串，
// 字串逐字与 JS 相同（差分按回包字节比对）。字符串判断一律走 UTF-8 字节（JS 正则只认 ASCII，Swift String 的前缀 / 相等按
// Unicode 规范等价会与 JS 不同，见 B4.0 踩坑）。

public enum Schema {
    public static let appID = "shizi"
    public static let schemaVersion = 2
    public static let backupVersion = 2

    public static let v2Prefix = "shizi.v2."
    public static let recordsPrefix = "shizi.v2.records."
    public static let inkPrefix = "shizi.v2.ink."
    public static let corruptPrefix = "shizi.corrupt."

    /// KEYS（键名 → 键），声明顺序同 JS。
    public static let keys: [(name: String, key: String)] = [
        ("meta", "shizi.v2.meta"), ("sched", "shizi.v2.sched"), ("custom", "shizi.v2.custom"), ("wordOff", "shizi.v2.wordOff"),
        ("settings", "shizi.v2.settings"), ("photos", "shizi.v2.photos"), ("legacy", "shizi.v2.legacy"), ("backupMeta", "shizi.v2.backupMeta"),
        ("sessions", "shizi.v2.sessions"), ("funnel", "shizi.v2.funnel"), ("safety", "shizi.v2.safety"), ("txn", "shizi.v2.txn"),
        ("route", "shizi.v2.route"), ("probe", "shizi.v2.probe"),
    ]
    public static func keyNamed(_ name: String) -> String? { keys.first { $0.name == name }?.key }
    public static var metaKey: String { keyNamed("meta")! }
    public static var sessionsKey: String { keyNamed("sessions")! }

    /// store 状态里的域。
    public static let domains = ["meta", "records", "sched", "ink", "custom", "wordOff", "settings", "photos", "legacy", "backupMeta", "sessions", "funnel", "safety"]
    public static let monthlyDomains = ["records", "ink"]
    public static let hintsShapeMax = 64.0

    // ---------------------------------------------------------------- 基本判定（字节级）

    static func ascii(_ s: String) -> [UInt8]? {
        let u = Array(s.utf8)
        return u.allSatisfy { $0 < 0x80 } ? u : nil
    }
    static func isDigit(_ c: UInt8) -> Bool { c >= 0x30 && c <= 0x39 }

    static func hasPrefix(_ s: String, _ prefix: String) -> Bool {
        s.utf8.starts(with: prefix.utf8)
    }
    /// JS `s.slice(n)`，前缀是 ASCII 时 n 个码元 = n 个字节。
    static func dropPrefix(_ s: String, _ prefix: String) -> String {
        String(decoding: Array(s.utf8).dropFirst(prefix.utf8.count), as: UTF8.self)
    }

    /// `^(\d{4})-(0[1-9]|1[0-2])$`
    public static func isMonthKey(_ v: String) -> Bool {
        let u = Array(v.utf8)
        guard u.count == 7, u[0...3].allSatisfy(isDigit), u[4] == 0x2D, isDigit(u[5]), isDigit(u[6]) else { return false }
        let m = Int(u[5] - 0x30) * 10 + Int(u[6] - 0x30)
        return m >= 1 && m <= 12
    }

    /// YYYY-MM-DD 且是真实存在的日期（Date.UTC：0–99 年当 1900+，所以 0000–0099 年一律为假）。
    public static func isLocalDay(_ v: String) -> Bool {
        let u = Array(v.utf8)
        guard u.count == 10, u[0...3].allSatisfy(isDigit), u[4] == 0x2D, isDigit(u[5]), isDigit(u[6]), u[7] == 0x2D, isDigit(u[8]), isDigit(u[9]) else { return false }
        let y = Int(String(decoding: u[0...3], as: UTF8.self))!
        let mo = Int(u[5] - 0x30) * 10 + Int(u[6] - 0x30)
        let d = Int(u[8] - 0x30) * 10 + Int(u[9] - 0x30)
        if mo < 1 || mo > 12 || d < 1 { return false }
        if y < 100 { return false }
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
        let dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]
        return d <= dim
    }

    public static func isLocalDay(_ v: JSValue) -> Bool {
        if case .string(let s) = v { return isLocalDay(s) }
        return false
    }

    /// 一个 Unicode 码点（含补充平面）。
    public static func isSingleChar(_ v: String) -> Bool { v.unicodeScalars.count == 1 }

    public static func monthOfDay(_ localDay: String) -> String {
        // JS slice(0, 7)（码元）；调用处的日键已通过 isLocalDay（ASCII）。
        String(decoding: Array(localDay.utf8).prefix(7), as: UTF8.self)
    }

    /// `^(base|custom):([\s\S]+)$` 且后半是一个码点。
    public static func charOfCardKey(_ cardKey: String) -> String? {
        for p in ["base:", "custom:"] where hasPrefix(cardKey, p) {
            let rest = dropPrefix(cardKey, p)
            if !rest.isEmpty { return rest }
        }
        return nil
    }

    public static func isCardKey(_ v: String) -> Bool {
        guard let c = charOfCardKey(v) else { return false }
        return isSingleChar(c)
    }
    public static func isCardKey(_ v: JSValue) -> Bool {
        if case .string(let s) = v { return isCardKey(s) }
        return false
    }

    static func isSerial(_ v: String, _ lead: UInt8) -> Bool {
        let u = Array(v.utf8)
        guard u.count >= 2, u[0] == lead, u[1] >= 0x31, u[1] <= 0x39 else { return false }
        return u[2...].allSatisfy(isDigit)
    }
    public static func isRecordId(_ v: String) -> Bool { isSerial(v, 0x72) }
    public static func isSessionId(_ v: String) -> Bool { isSerial(v, 0x73) }
    public static func isRecordId(_ v: JSValue) -> Bool { if case .string(let s) = v { return isRecordId(s) }; return false }
    public static func isSessionId(_ v: JSValue) -> Bool { if case .string(let s) = v { return isSessionId(s) }; return false }

    /// 'r12' / 's7' → 12 / 7；不合法返回 0。
    public static func serialOf(_ id: String) -> Double {
        guard isRecordId(id) || isSessionId(id) else { return 0 }
        return Double(String(decoding: Array(id.utf8).dropFirst(), as: UTF8.self)) ?? 0
    }

    public static func recordsKey(_ month: String) -> String { recordsPrefix + month }
    public static func isRecordsKey(_ key: String) -> Bool { hasPrefix(key, recordsPrefix) && isMonthKey(dropPrefix(key, recordsPrefix)) }
    public static func monthOfRecordsKey(_ key: String) -> String? { isRecordsKey(key) ? dropPrefix(key, recordsPrefix) : nil }
    public static func inkKey(_ month: String) -> String { inkPrefix + month }
    public static func isInkKey(_ key: String) -> Bool { hasPrefix(key, inkPrefix) && isMonthKey(dropPrefix(key, inkPrefix)) }
    public static func monthOfInkKey(_ key: String) -> String? { isInkKey(key) ? dropPrefix(key, inkPrefix) : nil }

    /// B2.3 ink schema 2：落盘时每条墨迹一个键。
    public static func inkRecordKey(_ month: String, _ id: String) -> String { inkPrefix + month + "." + id }

    /// 单条墨迹键 → (month, id)；不是返回 nil。
    public static func parseInkRecordKey(_ key: String) -> (month: String, id: String)? {
        guard hasPrefix(key, inkPrefix) else { return nil }
        let rest = Array(dropPrefix(key, inkPrefix).utf8)
        guard rest.count > 8, rest[7] == 0x2E else { return nil }
        let month = String(decoding: rest[0..<7], as: UTF8.self)
        let id = String(decoding: rest[8...], as: UTF8.self)
        guard isMonthKey(month), isRecordId(id) else { return nil }
        return (month, id)
    }
    public static func isInkRecordKey(_ key: String) -> Bool { parseInkRecordKey(key) != nil }
    public static func isInkStorageKey(_ key: String) -> Bool { isInkKey(key) || isInkRecordKey(key) }

    public static func isMonthlyDomain(_ domain: String) -> Bool { monthlyDomains.contains(domain) }
    public static func monthOfKey(_ key: String) -> String? { monthOfRecordsKey(key) ?? monthOfInkKey(key) }
    public static func corruptKeyFor(_ key: String) -> String { corruptPrefix + key }

    /// 一条记录的墨迹归哪个月键：localDay 所在月；localDay 不合法退回 at 的本地月；都没有 nil。
    public static func inkMonthOf(_ record: JSValue, timeZone: TimeZone) -> String? {
        guard case .object(let o) = record else { return nil }
        if let d = o["localDay"], isLocalDay(d), case .string(let s) = d { return monthOfDay(s) }
        if let a = o["at"], case .number(let t) = a, t.isFinite {
            guard let f = JSDate.localFields(JSDate.timeClip(t), timeZone) else { return "NaN-NaN" }
            return String(f.year) + "-" + Dates.pad2(f.month)
        }
        return nil
    }

    /// 一条记录的墨迹在月键里的 id：inkId 优先，否则记录自身 id。
    public static func inkIdOf(_ record: JSValue) -> String? {
        guard case .object(let o) = record else { return nil }
        if let i = o["inkId"], isRecordId(i), case .string(let s) = i { return s }
        if let i = o["id"], isRecordId(i), case .string(let s) = i { return s }
        return nil
    }

    // ---------------------------------------------------------------- 小工具

    typealias Check = (JSValue, String) -> String?

    static func fail(_ path: String, _ reason: String) -> String { path + ": " + reason }

    static func isPlainObject(_ v: JSValue) -> Bool { if case .object = v { return true }; return false }
    static func isFiniteNumber(_ v: JSValue) -> Bool { if case .number(let d) = v { return d.isFinite }; return false }
    static func isInteger(_ d: Double) -> Bool { d.isFinite && d.rounded(.towardZero) == d }
    static func isNonNegInt(_ v: JSValue) -> Bool { if case .number(let d) = v { return isInteger(d) && d >= 0 }; return false }

    static func checkArray(_ value: JSValue, _ path: String, _ each: Check) -> String? {
        guard case .array(let a) = value else { return fail(path, "not an array") }
        for (i, e) in a.enumerated() {
            if let err = each(e, path + "[" + String(i) + "]") { return err }
        }
        return nil
    }

    static func checkMap(_ value: JSValue, _ path: String, keyOk: (String) -> Bool, each: (JSValue, String, String) -> String?) -> String? {
        guard case .object(let o) = value else { return fail(path, "not an object") }
        for e in o.entries {
            if !keyOk(e.key) { return fail(path + "." + e.key, "bad key") }
            if let err = each(e.value, path + "." + e.key, e.key) { return err }
        }
        return nil
    }

    /// 字段表：按 UTF-8 判键（见文件头）。
    struct Fields {
        private var table: [JSKey: Check] = [:]
        init(_ pairs: [(String, Check)]) { for (k, c) in pairs { table[JSKey(s: k)] = c } }
        func check(_ key: String) -> Check? { table[JSKey(s: key)] }
    }

    /// 只允许列出的字段；required 必须存在。
    static func checkFields(_ value: JSValue, _ path: String, _ fields: Fields, _ required: [String]) -> String? {
        guard case .object(let o) = value else { return fail(path, "not an object") }
        let entries = o.entries
        for e in entries where fields.check(e.key) == nil { return fail(path + "." + e.key, "unknown field") }
        for k in required where o[k] == nil { return fail(path + "." + k, "missing") }
        for e in entries {
            if let err = fields.check(e.key)!(e.value, path + "." + e.key) { return err }
        }
        return nil
    }

    enum V {
        static let num: Check = { x, p in isFiniteNumber(x) ? nil : fail(p, "not a finite number") }
        static let numOrNull: Check = { x, p in (x.isNull || isFiniteNumber(x)) ? nil : fail(p, "not a number or null") }
        static let int: Check = { x, p in isNonNegInt(x) ? nil : fail(p, "not a non-negative integer") }
        static let bool: Check = { x, p in x.boolValue != nil ? nil : fail(p, "not a boolean") }
        static let str: Check = { x, p in x.stringValue != nil ? nil : fail(p, "not a string") }
        static let strOrNull: Check = { x, p in (x.isNull || x.stringValue != nil) ? nil : fail(p, "not a string or null") }
        static let day: Check = { x, p in isLocalDay(x) ? nil : fail(p, "not a YYYY-MM-DD day") }
        static let dayOrNull: Check = { x, p in (x.isNull || isLocalDay(x)) ? nil : fail(p, "not a day or null") }
        static let char: Check = { x, p in (x.stringValue.map(isSingleChar) ?? false) ? nil : fail(p, "not a single character") }
        static let cardKey: Check = { x, p in isCardKey(x) ? nil : fail(p, "not a cardKey") }
        static let recordId: Check = { x, p in isRecordId(x) ? nil : fail(p, "not a record id") }
        static let sessionId: Check = { x, p in isSessionId(x) ? nil : fail(p, "not a session id") }
        static let obj: Check = { x, p in isPlainObject(x) ? nil : fail(p, "not an object") }
        static func oneOf(_ values: [JSValue]) -> Check {
            let label = values.map { v -> String in
                if case .number(let d) = v { return JSNumber.toString(d) }
                return v.stringValue ?? ""
            }.joined(separator: "|")
            return { x, p in values.contains(x) ? nil : fail(p, "not one of " + label) }
        }
        static func oneOf(_ values: [String]) -> Check { oneOf(values.map { JSValue.string($0) }) }
        static func arrayOf(_ each: @escaping Check) -> Check { { x, p in checkArray(x, p, each) } }
        static func intRange(_ lo: Double, _ hi: Double) -> Check {
            { x, p in
                if case .number(let d) = x, isInteger(d), d >= lo, d <= hi { return nil }
                return fail(p, "not an integer in " + JSNumber.toString(lo) + ".." + JSNumber.toString(hi))
            }
        }
        static func exactly(_ expected: JSValue, _ label: String) -> Check { { x, p in x == expected ? nil : fail(p, label) } }
    }

    // ---------------------------------------------------------------- 各键形状

    static let judgments = ["correct", "wrong"]
    static let recordKinds = ["judged", "answer-seen", "skipped"]

    static let helpFields = Fields([("hints", V.intRange(0, hintsShapeMax)), ("answerSeen", V.bool), ("traced", V.bool)])
    static let correctionFields = Fields([("from", V.oneOf(judgments)), ("at", V.num)])

    static let recordFields = Fields([
        ("id", V.recordId), ("cardKey", V.cardKey), ("char", V.char), ("sessionId", V.sessionId),
        ("kind", V.oneOf(recordKinds)), ("judgment", V.oneOf(judgments)), ("at", V.num), ("localDay", V.day),
        ("help", { x, p in checkFields(x, p, helpFields, ["hints", "answerSeen", "traced"]) }),
        ("corrections", V.arrayOf { x, p in checkFields(x, p, correctionFields, ["from", "at"]) }),
        ("inkId", V.str),
        ("legacy", { x, p in x == .bool(true) ? nil : fail(p, "must be true when present") }),
        ("source", V.oneOf(["screen", "paper"])),
    ])

    /// 单条 Record（01 §3.2）。month 非空时校验 localDay 属于该月。
    public static func validateRecord(_ rec: JSValue, path: String = "record", month: String? = nil) -> String? {
        let required = ["id", "cardKey", "char", "kind", "at", "localDay", "help"]
        if let err = checkFields(rec, path, recordFields, required) { return err }
        guard case .object(let o) = rec else { return nil }
        if o["legacy"] != .bool(true) && o["sessionId"] == nil { return fail(path + ".sessionId", "missing") }
        let cardKey = o["cardKey"]?.stringValue ?? ""
        let char = o["char"]?.stringValue ?? ""
        if !(charOfCardKey(cardKey).map { $0.utf8.elementsEqual(char.utf8) } ?? false) { return fail(path + ".char", "does not match cardKey") }
        let kind = o["kind"]?.stringValue
        let judged = kind == "judged"
        if judged && o["judgment"] == nil { return fail(path + ".judgment", "required when kind is judged") }
        if !judged && o["judgment"] != nil { return fail(path + ".judgment", "only allowed when kind is judged") }
        if !judged && o["corrections"] != nil { return fail(path + ".corrections", "only allowed when kind is judged") }
        if o["source"]?.stringValue == "paper" && !judged { return fail(path + ".source", "paper only for judged records") }
        if o["source"]?.stringValue == "paper" && o["inkId"] != nil { return fail(path + ".inkId", "a paper record has no ink") }
        if let m = month, !m.isEmpty, let d = o["localDay"]?.stringValue, monthOfDay(d) != m { return fail(path + ".localDay", "not in month " + m) }
        return nil
    }

    static func validateRecordList(_ list: JSValue, _ path: String, _ month: String?) -> String? {
        guard case .array(let a) = list else { return fail(path, "not an array") }
        var prev = 0.0
        for (i, r) in a.enumerated() {
            if let err = validateRecord(r, path: path + "[" + String(i) + "]", month: month) { return err }
            let serial = serialOf(r["id"]?.stringValue ?? "")
            if serial <= prev { return fail(path + "[" + String(i) + "].id", "ids must be strictly ascending") }
            prev = serial
        }
        return nil
    }

    /// 按月记录键的值：当月 Record[]，或预算回收折叠后的月汇总。
    public static func validateRecordsMonth(_ value: JSValue, month: String?, path: String = "records") -> String? {
        if case .array = value { return validateRecordList(value, path, month) }
        func dayKeyOk(_ key: String) -> Bool { isLocalDay(key) && monthOfDay(key) == month }
        let byDay: Check = { x, p in checkMap(x, p, keyOk: dayKeyOk, each: { y, q, _ in V.arrayOf(V.char)(y, q) }) }
        let fields = Fields([
            ("folded", V.exactly(.bool(true), "must be true")),
            ("month", { x, p in x.stringValue.map { s in month.map { $0.utf8.elementsEqual(s.utf8) } ?? false } == true ? nil : fail(p, "must equal " + (month ?? "null")) }),
            ("byDay", byDay),
            ("chars", V.arrayOf(V.char)),
            ("kept", { x, p in validateRecordList(x, p, month) }),
            ("paperOnly", byDay),
            // R15：折叠时逐条记下的作品成员（可缺省 = 旧折叠）；workJudged 只在有看后自写成员时有
            ("work", byDay),
            ("workJudged", byDay),
        ])
        return checkFields(value, path, fields, ["folded", "month", "byDay", "chars", "kept"])
    }

    static let metaFields = Fields([
        ("schema", V.exactly(.number(Double(schemaVersion)), "must be 2")),
        ("serial", V.int), ("createdAt", V.num), ("migratedAt", V.num),
        ("months", { x, p in
            if let err = checkArray(x, p, { m, q in (m.stringValue.map(isMonthKey) ?? false) ? nil : fail(q, "not a YYYY-MM month") }) { return err }
            let a = x.arrayValue ?? []
            if a.count > 1 {
                for i in 1..<a.count {
                    // JS 字串 `<` 按码元序；月键已是 ASCII，字节序相同。
                    let l = Array((a[i - 1].stringValue ?? "").utf8), r = Array((a[i].stringValue ?? "").utf8)
                    if !l.lexicographicallyPrecedes(r) { return fail(p, "months must be sorted and unique") }
                }
            }
            return nil
        }),
    ])

    static let schedEntryFields = Fields([
        ("fsrs", { x, p in
            switch x {
            case .object, .array: return nil
            default: return fail(p, "not an object/array")
            }
        }),
        ("due", V.dayOrNull), ("lastJudgedAt", V.num), ("stoppedAt", V.num), ("seenAgainDay", V.day),
    ])

    static let intRow: Check = V.arrayOf { x, p in
        if case .number(let d) = x, isInteger(d) { return nil }
        return fail(p, "not an integer")
    }
    static let inkV2Fields = Fields([
        ("v", V.exactly(.number(2), "must be 2")), ("c", V.num), ("s", V.arrayOf(intRow)), ("dt", V.arrayOf(intRow)), ("p", V.arrayOf(intRow)),
    ])

    /// `^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$`
    static func isBase64(_ s: String) -> Bool {
        let u = Array(s.utf8)
        func ok(_ c: UInt8) -> Bool { (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || isDigit(c) || c == 0x2B || c == 0x2F }
        if u.isEmpty { return true }
        guard u.count % 4 == 0 else { return false }
        var body = u[...]
        if u[u.count - 1] == 0x3D {
            if u[u.count - 2] == 0x3D { body = u.dropLast(2) } else { body = u.dropLast(1) }
        }
        return body.allSatisfy(ok)
    }
    static let b64: Check = { x, p in (x.stringValue.map(isBase64) ?? false) ? nil : fail(p, "not a base64 string") }
    static let inkV3Fields = Fields([
        ("v", V.exactly(.number(3), "must be 3")), ("c", V.num), ("s", V.arrayOf(b64)), ("p", V.arrayOf(b64)),
    ])
    static let inkV4Fields = Fields([
        ("v", V.exactly(.number(4), "must be 4")), ("c", V.num),
        ("r", V.arrayOf { x, p in
            if let s = x.stringValue, s.utf16.count >= 8, isBase64(s) { return nil }
            return fail(p, "not a packed stroke (base64)")
        }),
        ("g", V.arrayOf(V.int)),
    ])

    /// 一条墨迹：v4 / v3 / v2。
    static func checkInk(_ x: JSValue, _ p: String) -> String? {
        if case .object(let o) = x {
            if o["v"] == .number(4) {
                if let err = checkFields(x, p, inkV4Fields, ["v", "c", "r", "g"]) { return err }
                return (o["g"]?.arrayValue?.count ?? 0) == (o["r"]?.arrayValue?.count ?? 0) ? nil : fail(p + ".g", "length differs from r")
            }
            if o["v"] == .number(3) { return checkFields(x, p, inkV3Fields, ["v", "c", "s"]) }
        }
        return checkFields(x, p, inkV2Fields, ["v", "c", "s"])
    }

    public static func validateInk(_ value: JSValue, path: String = "ink") -> String? { checkInk(value, path) }

    static let customFields = Fields([
        ("added", V.arrayOf { x, p in checkFields(x, p, Fields([("char", V.char), ("at", V.num)]), ["char", "at"]) }),
    ])

    static let photoFields = Fields([
        ("day", V.day), ("at", V.num),
        ("dataURL", { x, p in (x.stringValue.map { hasPrefix($0, "data:image/") } ?? false) ? nil : fail(p, "not an image data URL") }),
    ])

    static let remindFields = Fields([("enabled", V.bool), ("hour", V.intRange(0, 23)), ("minute", V.intRange(0, 59)), ("permission", V.str)])
    static let remindInviteFields = Fields([("shown", V.int), ("last", V.str), ("answered", V.oneOf(["yes", "no", "denied"]))])
    static let settingsFields = Fields([
        ("library", V.str), ("sound", V.bool),
        ("remind", { x, p in checkFields(x, p, remindFields, []) }),
        ("remindInvite", { x, p in checkFields(x, p, remindInviteFields, []) }),
        ("capitalDeferredDay", V.day), ("returnSpreadFor", V.day),
        ("writeMode", V.oneOf(["screen", "paper"])),
        ("paperSuggested", V.bool), ("answerNoteSeen", V.bool), ("shiHandoffDone", V.bool), ("firstTipSeen", V.bool),
        ("large", V.bool), ("appearance", V.oneOf(["auto", "light", "dark"])),
        ("groupSize", V.oneOf([5, 10, 15, 20, 30].map { JSValue.number(Double($0)) })),
        ("mixTier", V.oneOf(["more", "balanced", "review", "only"])), // D83 新字比例档位（P327）
    ])

    static let conclusionFields = Fields([("kind", V.oneOf(["restore", "clear"])), ("date", V.strOrNull), ("count", V.int)])
    static let backupMetaFields = Fields([
        ("lastExportAt", V.numOrNull), ("lastExportSig", V.strOrNull),
        ("lastConclusion", { x, p in x.isNull ? nil : checkFields(x, p, conclusionFields, ["kind", "count"]) }),
    ])

    static let legacyFields = Fields([("importedAt", V.num), ("fromKeys", V.arrayOf(V.str)), ("days", V.arrayOf(V.day)), ("report", V.obj)])

    // ---- 会话（01 §3.3）

    static let phases = ["recall", "compare", "answer", "trace", "retrace"]
    static let sessionKinds = ["first", "daily", "picked"]
    static let itemKinds = ["judged", "answer-seen", "skipped", "retry"] // retry：D83 当天重考（不写记录）

    static let currentFields = Fields([
        ("phase", V.oneOf(phases)),
        ("strokes", V.arrayOf { x, p in x.arrayValue != nil ? nil : fail(p, "stroke is not an array") }),
        ("hints", V.int), ("answerSeen", V.bool),
        ("hintRange", { x, p in
            switch x {
            case .null, .array, .object: return nil
            default: return fail(p, "bad hintRange")
            }
        }),
        ("referenceReady", V.bool), ("paper", V.bool),
    ])

    static let itemFields = Fields([
        ("cardKey", V.cardKey), ("recordId", V.recordId), ("kind", V.oneOf(itemKinds)),
        ("outcome", V.oneOf(["correct", "wrong", "skipped"])), ("attempt", V.int),
        ("fsrsBefore", { x, p in
            switch x {
            case .object, .array: return nil
            default: return fail(p, "not an object/array")
            }
        }),
    ])
    static let lastLineFields = Fields([("recordId", V.recordId), ("kind", V.oneOf(["record", "changed", "saw"]))])

    static let sessionFields = Fields([
        ("id", V.sessionId), ("slot", V.oneOf(["A", "B"])), ("kind", V.oneOf(sessionKinds)),
        ("source", { x, p in checkFields(x, p, Fields([("view", V.str), ("char", V.char)]), ["view"]) }),
        ("queue", V.arrayOf(V.cardKey)), ("cursor", V.int),
        ("items", V.arrayOf { x, p in checkFields(x, p, itemFields, ["cardKey", "kind"]) }),
        ("current", { x, p in x.isNull ? nil : checkFields(x, p, currentFields, ["phase", "strokes"]) }),
        ("lastLine", { x, p in x.isNull ? nil : checkFields(x, p, lastLineFields, ["recordId", "kind"]) }),
        ("startedAt", V.num), ("startedDay", V.day), ("updatedAt", V.num), ("endedAt", V.num), ("endedEarly", V.bool),
        ("added", V.arrayOf(V.recordId)), ("sealedAt", V.num),
        ("extra", V.bool), // D83「再来一组」：今天的练习写完之后的额外组
    ])

    /// D83 今天的账（sessions.today）：day、进度（每个字的第一次）、这一份几个字、是否已完成。
    static let todayFields = Fields([("day", V.day), ("handled", V.arrayOf(V.cardKey)), ("target", V.int), ("done", V.bool)])

    public static func validateSession(_ session: JSValue, path: String = "session", slot: String? = nil) -> String? {
        if let err = checkFields(session, path, sessionFields, ["id", "slot", "kind", "source", "queue", "cursor", "items", "startedAt", "startedDay", "updatedAt"]) { return err }
        guard case .object(let o) = session else { return nil }
        let sSlot = o["slot"]?.stringValue
        let kind = o["kind"]?.stringValue
        if let want = slot, !want.isEmpty, sSlot != want { return fail(path + ".slot", "must be " + want) }
        if sSlot == "A" && kind == "picked" { return fail(path + ".kind", "slot A holds first/daily only") }
        if sSlot == "B" && kind != "picked" { return fail(path + ".kind", "slot B holds picked only") }
        if let cursor = o["cursor"]?.numberValue, cursor > Double(o["queue"]?.arrayValue?.count ?? 0) { return fail(path + ".cursor", "beyond queue") }
        return nil
    }

    static func sessionOrNull(_ slot: String) -> Check {
        { x, p in x.isNull ? nil : validateSession(x, path: p, slot: slot) }
    }

    static func validateSessions(_ value: JSValue, _ path: String) -> String? {
        let fields = Fields([
            ("A", sessionOrNull("A")), ("B", sessionOrNull("B")),
            ("lastEnded", { x, p in checkFields(x, p, Fields([("A", sessionOrNull("A")), ("B", sessionOrNull("B"))]), []) }),
            ("today", { x, p in checkFields(x, p, todayFields, ["day", "handled", "done"]) }),
        ])
        return checkFields(value, path, fields, ["A", "B", "lastEnded"])
    }

    static func validateSafety(_ value: JSValue, _ path: String) -> String? {
        let fields = Fields([
            ("version", V.int), ("kind", V.oneOf(["restore", "clear"])), ("createdAt", V.num), ("backupDate", V.strOrNull), ("count", V.int),
            ("payload", { x, p in
                checkMap(x, p, keyOk: { isBackupKey($0) || $0.utf8.elementsEqual(sessionsKey.utf8) }, each: { raw, q, key in
                    let err = V.str(raw, q)
                    if err != nil || !key.utf8.elementsEqual(sessionsKey.utf8) { return err }
                    guard let text = raw.stringValue, let parsed = try? JSONParser.parse(text) else { return fail(q, "not JSON") }
                    return validateSessions(parsed, q)
                })
            }),
        ])
        return checkFields(value, path, fields, ["version", "kind", "createdAt", "payload"])
    }

    static func validateTxn(_ value: JSValue, _ path: String) -> String? {
        let fields = Fields([
            ("label", V.str), ("at", V.num), ("keys", V.arrayOf(V.str)),
            ("prev", { x, p in checkMap(x, p, keyOk: { _ in true }, each: { y, q, _ in V.strOrNull(y, q) }) }),
            ("phase", V.oneOf(["writing", "done"])),
        ])
        if let err = checkFields(value, path, fields, ["label", "at", "keys", "prev", "phase"]) { return err }
        guard case .object(let o) = value, let keys = o["keys"]?.arrayValue, let prev = o["prev"]?.objectValue else { return nil }
        for k in keys {
            if let s = k.stringValue, prev[s] == nil { return fail(path + ".prev", "missing prev for " + s) }
        }
        return nil
    }

    // ---------------------------------------------------------------- 键表

    public struct KeySpec {
        public let id: String
        public let key: String?
        public let pattern: String?
        public let domain: String?
        let match: ((String) -> Bool)?
        let validate: (JSValue, String?) -> String?
    }

    public static let keySpecs: [KeySpec] = [
        KeySpec(id: "meta", key: keyNamed("meta"), pattern: nil, domain: "meta", match: nil, validate: { x, _ in checkFields(x, "meta", metaFields, ["schema", "serial", "createdAt", "months"]) }),
        KeySpec(id: "records", key: nil, pattern: recordsPrefix + "<YYYY-MM>", domain: "records", match: isRecordsKey, validate: { x, key in
            validateRecordsMonth(x, month: key.flatMap(monthOfRecordsKey), path: key ?? "records")
        }),
        KeySpec(id: "sched", key: keyNamed("sched"), pattern: nil, domain: "sched", match: nil, validate: { x, _ in
            checkMap(x, "sched", keyOk: isCardKey, each: { e, p, _ in checkFields(e, p, schedEntryFields, ["fsrs", "due", "lastJudgedAt"]) })
        }),
        KeySpec(id: "ink", key: nil, pattern: inkPrefix + "<YYYY-MM>", domain: "ink", match: isInkKey, validate: { x, key in
            checkMap(x, (key ?? "").isEmpty ? "ink" : key!, keyOk: isRecordId, each: { e, p, _ in checkInk(e, p) })
        }),
        KeySpec(id: "inkRecord", key: nil, pattern: inkPrefix + "<YYYY-MM>.<recordId>", domain: "ink", match: isInkRecordKey, validate: { x, key in
            checkInk(x, (key ?? "").isEmpty ? "inkRecord" : key!)
        }),
        KeySpec(id: "custom", key: keyNamed("custom"), pattern: nil, domain: "custom", match: nil, validate: { x, _ in checkFields(x, "custom", customFields, ["added"]) }),
        KeySpec(id: "wordOff", key: keyNamed("wordOff"), pattern: nil, domain: "wordOff", match: nil, validate: { x, _ in
            checkMap(x, "wordOff", keyOk: isCardKey, each: { e, p, _ in V.num(e, p) })
        }),
        KeySpec(id: "settings", key: keyNamed("settings"), pattern: nil, domain: "settings", match: nil, validate: { x, _ in checkFields(x, "settings", settingsFields, []) }),
        KeySpec(id: "photos", key: keyNamed("photos"), pattern: nil, domain: "photos", match: nil, validate: { x, _ in
            checkMap(x, "photos", keyOk: isSingleChar, each: { e, p, _ in checkFields(e, p, photoFields, ["day", "at", "dataURL"]) })
        }),
        KeySpec(id: "legacy", key: keyNamed("legacy"), pattern: nil, domain: "legacy", match: nil, validate: { x, _ in checkFields(x, "legacy", legacyFields, ["importedAt", "fromKeys", "days", "report"]) }),
        KeySpec(id: "backupMeta", key: keyNamed("backupMeta"), pattern: nil, domain: "backupMeta", match: nil, validate: { x, _ in checkFields(x, "backupMeta", backupMetaFields, []) }),
        KeySpec(id: "sessions", key: keyNamed("sessions"), pattern: nil, domain: "sessions", match: nil, validate: { x, _ in validateSessions(x, "sessions") }),
        KeySpec(id: "funnel", key: keyNamed("funnel"), pattern: nil, domain: "funnel", match: nil, validate: { x, _ in isPlainObject(x) ? nil : fail("funnel", "not an object") }),
        KeySpec(id: "safety", key: keyNamed("safety"), pattern: nil, domain: "safety", match: nil, validate: { x, _ in validateSafety(x, "safety") }),
        KeySpec(id: "txn", key: keyNamed("txn"), pattern: nil, domain: nil, match: nil, validate: { x, _ in validateTxn(x, "txn") }),
        KeySpec(id: "route", key: keyNamed("route"), pattern: nil, domain: nil, match: nil, validate: { x, _ in isPlainObject(x) ? nil : fail("route", "not an object") }),
    ]

    public static let backupWhitelist = ["meta", "records", "sched", "ink", "custom", "wordOff", "settings", "photos", "legacy", "backupMeta"]
    public static let backupExcluded = ["sessions", "funnel", "safety", "txn", "route", "inkRecord"]

    public static func specForKey(_ key: String) -> KeySpec? {
        func spec(_ id: String) -> KeySpec? { keySpecs.first { $0.id == id } }
        if isRecordsKey(key) { return spec("records") }
        if isInkKey(key) { return spec("ink") }
        if isInkRecordKey(key) { return spec("inkRecord") }
        return keySpecs.first { $0.key.map { $0.utf8.elementsEqual(key.utf8) } ?? false }
    }

    public static func isBackupKey(_ key: String) -> Bool {
        guard let spec = specForKey(key) else { return false }
        return backupWhitelist.contains(spec.id)
    }

    /// 对已解析的值做形状校验。未知键返回错误。
    public static func validateValue(key: String, value: JSValue) -> String? {
        guard let spec = specForKey(key) else { return fail(key, "unknown key") }
        return spec.validate(value, key)
    }

    public enum Parsed {
        case ok(JSValue)
        case failed(String)
    }

    /// 原始字串做 JSON 解析 + 形状校验。
    public static func parseAndValidate(key: String, raw: JSValue) -> Parsed {
        guard case .string(let text) = raw else { return .failed(fail(key, "value is not a string")) }
        guard let value = try? JSONParser.parse(text) else { return .failed(fail(key, "invalid JSON")) }
        if let err = validateValue(key: key, value: value) { return .failed(err) }
        return .ok(value)
    }

    /// 域 → 键（records / ink 需给 month）。
    public static func keyForDomain(_ domain: String, month: String?) throws -> String {
        if domain == "records" { return recordsKey(month ?? "undefined") }
        if domain == "ink" { return inkKey(month ?? "undefined") }
        guard let key = keyNamed(domain), domains.contains(domain) else { throw CoreError.error("unknown domain " + domain) }
        return key
    }

    // ---------------------------------------------------------------- 备份外壳（01 §3.6）

    /// 校验 v2 备份外壳；任一白名单键坏 → 整单拒绝。返回对象形同 JS：
    /// {ok:true, entries:[[key, raw]], ignored:[key]} | {ok:false, reason, key?, detail?}。
    public static func parseBackupV2(_ obj: JSValue) -> JSValue {
        func bad(_ pairs: [(String, JSValue)]) -> JSValue { .object(JSObject([("ok", .bool(false))] + pairs)) }
        guard case .object(let o) = obj, o["app"]?.stringValue.map({ $0.utf8.elementsEqual(appID.utf8) }) == true, case .object(let data)? = o["data"] else {
            return bad([("reason", .string("format"))])
        }
        if o["version"] == .number(1) { return bad([("reason", .string("v1"))]) }
        if o["version"] != .number(Double(backupVersion)) { return bad([("reason", .string("version"))]) }
        var entries: [JSValue] = []
        var ignored: [JSValue] = []
        for e in data.entries {
            if !isBackupKey(e.key) {
                ignored.append(.string(e.key))
                continue
            }
            guard case .string = e.value else { return bad([("reason", .string("value")), ("key", .string(e.key))]) }
            switch parseAndValidate(key: e.key, raw: e.value) {
            case .failed(let reason): return bad([("reason", .string("shape")), ("key", .string(e.key)), ("detail", .string(reason))])
            case .ok: entries.append(.array([.string(e.key), e.value]))
            }
        }
        if !entries.contains(where: { $0.arrayValue?.first?.stringValue.map { $0.utf8.elementsEqual(metaKey.utf8) } ?? false }) {
            return bad([("reason", .string("empty"))])
        }
        return .object(JSObject([("ok", .bool(true)), ("entries", .array(entries)), ("ignored", .array(ignored))]))
    }
}
