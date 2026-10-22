import Foundation

// src/core/query.js 的 1:1 移植：查字 / 自己选字组件的纯逻辑（M2-0；D21；04 R-Q01–R-Q06；03 P42 / P43 / P45）。
// 不碰存储与文案表：文案由调用方按这里给出的 copy 键取，数字 / 字作为占位符值一并给出（{key, vars}）。
// 汉字判定 = \p{Script=Han}（生成的 unicode-scripts.json）；拼音比较键的去声调 = NFD 去组合符号（U+0300–U+036F）。

public enum Query {
    /// 拼音查找上限（弹层不做虚拟列表）。
    public static let pinyinMax = 100

    static let openQuote = "\u{300C}"
    static let closeQuote = "\u{300D}"

    // ---- 汉字与拼音 ----

    public static func isHanScalar(_ u: Unicode.Scalar) -> Bool { UnicodeScripts.isHan(u) }

    public static func containsHan(_ s: String) -> Bool { s.unicodeScalars.contains(where: UnicodeScripts.isHan) }

    /// 汉字判定：恰好一个码点且是 Han。
    public static func isHan(_ v: JSValue?) -> Bool {
        guard case .string(let s)? = v else { return false }
        let u = Array(s.unicodeScalars)
        return u.count == 1 && UnicodeScripts.isHan(u[0])
    }

    /// 拼音比较键：去声调（NFD 去组合符号，ü → u）、小写、只留字母（v 当 ü 处理，也成 u）。
    public static func pyKey(_ py: JSValue?) -> String {
        let text: String
        if let py = py, JSX.truthy(py) { text = Copy.jsString(py) } else { text = "" }
        var out = String.UnicodeScalarView()
        for u in text.decomposedStringWithCanonicalMapping.unicodeScalars {
            if u.value >= 0x300 && u.value <= 0x36F { continue }
            var c = u.value
            if c >= 0x41 && c <= 0x5A { c += 0x20 }
            if c == 0x76 { c = 0x75 }
            if c >= 0x61 && c <= 0x7A { out.append(Unicode.Scalar(c)!) }
        }
        return String(out)
    }

    /// JS String.prototype.trim。
    static func jsTrim(_ s: String) -> String {
        var u = Array(s.utf16)
        while let f = u.first, JSX.isJSSpace(f) { u.removeFirst() }
        while let l = u.last, JSX.isJSSpace(l) { u.removeLast() }
        return String(decoding: u, as: UTF16.self)
    }

    /// 输入是不是「只有拼音字母」（可带声调、空格、撇号，没有汉字）→ {raw, query}，否则 nil。
    public static func parsePinyinInput(_ text: JSValue?) -> JSValue? {
        let s = text.flatMap { $0.stringValue }.map(jsTrim) ?? ""
        if s.isEmpty || containsHan(s) { return nil }
        let ok = s.unicodeScalars.allSatisfy { u in
            if UnicodeScripts.isLatin(u) { return true }
            switch u.properties.generalCategory {
            case .nonspacingMark, .spacingMark, .enclosingMark: return true
            default: break
            }
            return u.value == 0x27 || (u.value <= 0xFFFF && JSX.isJSSpace(UInt16(u.value)))
        }
        guard ok else { return nil }
        let query = pyKey(.string(s))
        if query.isEmpty { return nil }
        return .object(JSObject([("raw", .string(s)), ("query", .string(query))]))
    }

    /// 拼音匹配的字：先找读音完全相同的，没有再找以它开头的；本人写过的在前，再按 entries 顺序。
    public static func pinyinMatches(_ query: String, _ entries: [JSValue], written: [String]? = nil, max: JSValue? = nil) -> [String] {
        if query.isEmpty { return [] }
        let list = entries.filter { e in JSX.truthy(e) && JSX.truthy(e["char"]) && JSX.truthy(e["key"]) }
        func key(_ e: JSValue) -> String { Copy.jsString(e["key"]!) }
        var hits = list.filter { JSX.eq(key($0), query) }
        if hits.isEmpty { hits = list.filter { key($0).utf8.starts(with: query.utf8) } }
        var seen = OSet()
        let uniq = hits.filter { e in seen.insert(Copy.jsString(e["char"]!)) }
        var w = OSet()
        for c in written ?? [] { w.insert(c) }
        let chars = uniq.map { Copy.jsString($0["char"]!) }
        let out = chars.filter { w.contains($0) } + chars.filter { !w.contains($0) }
        let cap: Double
        if let m = max { if case .number(let d) = m { cap = d } else { cap = -1 } } else { cap = Double(pinyinMax) }
        if cap.isFinite, cap.rounded(.towardZero) == cap, cap > 0 { return Array(out.prefix(cap > Double(out.count) ? out.count : Int(cap))) }
        return out
    }

    /// 本人写过（有 judged 记录）的字集合（按首次出现）。
    public static func writtenChars(_ records: [JSValue]) -> [String] {
        var out = OSet()
        for r in records {
            if Records.isJudged(r), case .string(let k)? = r["cardKey"], k.utf8.starts(with: "base:".utf8) {
                out.insert(String(decoding: Array(k.utf8).dropFirst(5), as: UTF8.self))
            }
        }
        return out.items
    }

    // ---- 输入过滤 ----

    public struct Filtered: Equatable {
        public var chars: [String]
        public var removed: Int
        public var duplicates: [String]
        public var hanCount: Int
        public var overLimit: Int
        public var total: Int

        public var js: JSValue {
            .object(JSObject([
                ("chars", .array(chars.map { .string($0) })),
                ("removed", .number(Double(removed))),
                ("duplicates", .array(duplicates.map { .string($0) })),
                ("hanCount", .number(Double(hanCount))),
                ("overLimit", .number(Double(overLimit))),
                ("total", .number(Double(total))),
            ]))
        }

        init?(js v: JSValue) {
            guard case .array(let cs)? = v["chars"], case .array(let ds)? = v["duplicates"],
                  let removed = v["removed"]?.numberValue else { return nil }
            chars = cs.compactMap { $0.stringValue }
            duplicates = ds.compactMap { $0.stringValue }
            self.removed = Int(removed)
            hanCount = Int(v["hanCount"]?.numberValue ?? 0)
            overLimit = Int(v["overLimit"]?.numberValue ?? 0)
            total = Int(v["total"]?.numberValue ?? 0)
        }

        init(chars: [String], removed: Int, duplicates: [String], hanCount: Int, overLimit: Int, total: Int) {
            self.chars = chars; self.removed = removed; self.duplicates = duplicates
            self.hanCount = hanCount; self.overLimit = overLimit; self.total = total
        }
    }

    /// 输入过滤（R-Q03；P45 上限）。max：nil = 缺省读 policy.queryInputMax；null / 非正整数 = 不设上限。
    public static func filterInput(_ text: JSValue?, max: JSValue? = nil) -> Filtered {
        let all: [Unicode.Scalar] = { if case .string(let s)? = text { return Array(s.unicodeScalars) }; return [] }()
        var seen = OSet()
        var dupSet = OSet()
        var unique: [String] = []
        var duplicates: [String] = []
        var hanCount = 0
        for u in all {
            guard UnicodeScripts.isHan(u) else { continue }
            hanCount += 1
            let ch = String(u)
            if seen.contains(ch) {
                if dupSet.insert(ch) { duplicates.append(ch) }
                continue
            }
            seen.insert(ch)
            unique.append(ch)
        }
        let limit: JSValue = max ?? (Config.policyValue("queryInputMax") ?? .null)
        var cap: Int?
        if case .number(let d) = limit, d.isFinite, d.rounded(.towardZero) == d, d > 0 { cap = d > Double(unique.count) ? unique.count : Int(d) }
        let chars = cap.map { Array(unique.prefix($0)) } ?? unique
        return Filtered(chars: chars, removed: all.count - hanCount, duplicates: duplicates, hanCount: hanCount, overLimit: unique.count - chars.count, total: all.count)
    }

    /// 输入过滤提示（R-Q03）：[{key, vars?}]。
    public static func filterNotes(_ filtered: Filtered?, view: String?) -> [JSValue] {
        var notes: [JSValue] = []
        guard let f = filtered else { return notes }
        if f.removed > 0 && f.chars.isEmpty {
            notes.append(.object(JSObject([("key", .string("R-Q03.onlyHanzi"))])))
        } else if f.removed > 0 {
            notes.append(.object(JSObject([("key", .string("R-Q03.removed")), ("vars", .object(JSObject([("n", .number(Double(f.removed)))])))])))
        }
        if !f.duplicates.isEmpty, let v = view, JSX.eq(v, "rows") {
            let listed = f.duplicates.filter { ch in f.chars.contains { JSX.eq($0, ch) } }
            if listed.count == 1 {
                notes.append(.object(JSObject([("key", .string("R-Q03.duplicate")), ("vars", .object(JSObject([("char", .string(listed[0]))])))])))
            } else if listed.count > 1 {
                let joined = listed.map { openQuote + $0 + closeQuote }.joined()
                notes.append(.object(JSObject([("key", .string("X-QUERY.duplicateMany")), ("vars", .object(JSObject([("chars", .string(joined))])))])))
            }
        }
        return notes
    }

    /// store 的 records 域 → 平铺记录数组（按月数组，或折叠月的 kept）。
    public static func flattenRecords(_ domain: JSValue?) -> [JSValue] {
        var out: [JSValue] = []
        guard case .object(let months)? = domain else { return out }
        for month in months.keys {
            let value = months[month]!
            if case .array(let l) = value { out += l } else if case .array(let kept)? = value["kept"], JSX.truthy(value) { out += kept }
        }
        return out
    }

    public static func baseKey(_ char: String) -> String { "base:" + char }

    /// 「不能练」判定：不在当前库且不在题库 → false。
    public static func isPracticable(_ char: JSValue?, inDeck: ((String) -> Bool)? = nil, inLibrary: ((String) -> Bool)? = nil) -> Bool {
        guard isHan(char), case .string(let c)? = char else { return false }
        let lib = inLibrary?(c) ?? false
        let deck = inDeck?(c) ?? false
        return lib || deck
    }

    public static func customChars(_ custom: JSValue?) -> [String] {
        guard case .array(let added)? = custom?["added"] else { return [] }
        var out: [String] = []
        for e in added {
            guard JSX.truthy(e), let c = e["char"], JSX.truthy(c) else { continue }
            out.append(Copy.jsString(c))
        }
        return out
    }

    public static func isCustom(_ custom: JSValue?, _ char: String) -> Bool { customChars(custom).contains { JSX.eq($0, char) } }

    /// custom 域加一个字（D21）。已在里面返回 nil；不合法抛 TypeError。
    public static func withCustomAdded(_ custom: JSValue?, _ char: JSValue, _ at: JSValue) throws -> JSValue? {
        guard isHan(char), case .string(let c) = char else { throw CoreError.type("withCustomAdded: char must be a single Han character") }
        guard case .number(let t) = at, t.isFinite else { throw CoreError.type("withCustomAdded: at must be a number") }
        var base = JSObject()
        if let custom = custom, case .object(let o) = custom { base = o }
        var added: [JSValue] = []
        if case .array(let a)? = base["added"] { added = a }
        if added.contains(where: { JSX.truthy($0) && JSX.eq($0["char"], c) }) { return nil }
        base["added"] = .array(added + [.object(JSObject([("char", .string(c)), ("at", .number(t))]))])
        return .object(base)
    }

    /// 逐字记录情况摘要。
    public static func charSummary(_ char: String, records: [JSValue] = [], sched: JSValue? = nil, custom: JSValue? = nil, practicable: Bool = false) -> JSValue {
        let cardKey = baseKey(char)
        let count = Records.judgedCountOfCard(records, cardKey)
        let latest = count > 0 ? Records.latestJudged(records, cardKey) : nil
        var due: JSValue = .null
        if let s = sched, case .object = s, let entry = s[cardKey], JSX.truthy(entry), case .string(let d)? = entry["due"] { due = .string(d) }
        var latestDay: JSValue = .null
        if let l = latest, let d = l["localDay"], JSX.truthy(d) { latestDay = d }
        return .object(JSObject([
            ("char", .string(char)),
            ("cardKey", .string(cardKey)),
            ("practicable", .bool(practicable)),
            ("custom", .bool(isCustom(custom, char))),
            ("count", .number(Double(count))),
            ("latest", (latest.map { Records.isJudged($0) ? $0 : .null }) ?? .null),
            ("latestDay", latestDay),
            ("due", due),
        ]))
    }

    static func entry(_ key: String, vars: [(String, JSValue)]? = nil) -> JSValue {
        var o = JSObject([("key", .string(key))])
        if let v = vars { o["vars"] = .object(JSObject(v)) }
        return .object(o)
    }

    /// 行尾记录情况（R-Q04）。不能练优先。
    public static func rowStatus(_ summary: JSValue) -> JSValue {
        if !JSX.truthy(summary["practicable"]) { return entry("R-Q04.rowUnavailable") }
        let n = summary["count"] ?? .null
        if JSX.truthy(summary["custom"]) {
            return JSX.truthy(n) ? entry("R-Q04.rowCustomCount", vars: [("n", n)]) : entry("R-Q04.rowCustomNone")
        }
        return JSX.truthy(n) ? entry("R-Q04.rowCount", vars: [("n", n)]) : entry("R-Q04.rowNone")
    }

    /// 卡片记录行：有记录「记录了 N 次 · 最近一次 {date}」，否则「还没有记录」。
    public static func cardStat(_ summary: JSValue) -> JSValue {
        if JSX.truthy(summary["count"]) && JSX.truthy(summary["latestDay"]) {
            return entry("R-Q05.cardStat", vars: [("n", summary["count"]!), ("day", summary["latestDay"]!)])
        }
        return entry("R-Q04.rowNone")
    }

    /// 视图：hint（未输入）/ rows（多字）/ card（一个字，能练）/ bad（一个字，不能练）。
    public static func queryView(chars: [String], cur: String = "", practicable: (String) -> Bool = { _ in false }) -> (view: String, cur: String) {
        let current: String
        if !cur.isEmpty && chars.contains(where: { JSX.eq($0, cur) }) { current = cur } else if chars.count == 1 { current = chars[0] } else { current = "" }
        if !current.isEmpty { return (practicable(current) ? "card" : "bad", current) }
        return (chars.isEmpty ? "hint" : "rows", "")
    }

    /// pick 多选：已选字里仍在输入中、且能练的（按输入顺序）。
    public static func selectedChars(_ chars: [String], _ selected: [String], practicable: (String) -> Bool = { _ in true }) -> [String] {
        var set = OSet()
        for s in selected { set.insert(s) }
        return chars.filter { set.contains($0) && practicable($0) }
    }

    /// pick 底栏（R-Q06）：0 个真禁用。
    public static func pickBar(_ count: JSValue?) -> JSValue {
        if !JSX.truthy(count) { return .object(JSObject([("key", .string("R-Q06.btnNone")), ("disabled", .bool(true))])) }
        if case .number(let n)? = count, n == 1 { return .object(JSObject([("key", .string("R-Q05.btnPractice")), ("disabled", .bool(false))])) }
        return .object(JSObject([("key", .string("R-Q06.btnPracticeN")), ("vars", .object(JSObject([("n", count!)]))), ("disabled", .bool(false))]))
    }

    /// 模式（P42：只保留 lookup / pick）。
    public static func normalizeMode(_ mode: JSValue?, policy: JSObject? = nil) throws -> String {
        let pol = policy ?? (Config.policy.objectValue ?? JSObject())
        var modes = ["lookup", "pick"]
        if let m = pol["queryModes"], JSX.truthy(m), case .array(let a) = m { modes = a.compactMap { $0.stringValue } }
        if case .string(let s)? = mode, modes.contains(where: { JSX.eq($0, s) }) { return s }
        throw CoreError.range("query mode must be one of \(modes.joined(separator: " / ")) (P42), got " + (mode.map { Copy.jsString($0) } ?? "undefined"))
    }
}
