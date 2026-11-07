import Foundation

// 调度规则（B4.2）共用的小工具：JS 取值语义（Number(x) / 真值 / Number.isInteger）、按码点判等的有序集合、稳定排序、
// 记录查询（原 JS 里选字与 FSRS 用到的那几个，逐行同语义）。
//
// 记录整体由 B4.3 移植；这里只放调度规则依赖的纯查询，名字带 Sched 前缀以免与 B4.3 的 `Records` 冲突，
// 合并后可改为调用 B4.3 的同名函数（行为相同，转写单测两边都有）。

// MARK: - JS 取值

package enum JS {
    /// `Number(v)`（v 为 nil = undefined → NaN）。
    package static func number(_ v: JSValue?) -> Double {
        guard let v = v else { return .nan }
        switch v {
        case .null: return 0
        case .bool(let b): return b ? 1 : 0
        case .number(let d): return d
        case .string(let s): return stringToNumber(s)
        case .array(let a):
            if a.isEmpty { return 0 }
            if a.count == 1 { return number(.string(toPrimitiveString(a[0]))) }
            return .nan
        case .object: return .nan
        }
    }

    /// `Number(v) || 0`。
    static func numberOr0(_ v: JSValue?) -> Double {
        let d = number(v)
        return d.isNaN || d == 0 ? 0 : d
    }

    /// 数组元素在 `String(array)` 里的写法（null → 空串）。
    static func toPrimitiveString(_ v: JSValue) -> String {
        switch v {
        case .null: return ""
        case .bool(let b): return b ? "true" : "false"
        case .number(let d): return JSNumber.toString(d)
        case .string(let s): return s
        case .array(let a): return a.map { toPrimitiveString($0) }.joined(separator: ",")
        case .object: return "[object Object]"
        }
    }

    /// `String(v)`（v 为 nil = undefined）。
    package static func string(_ v: JSValue?) -> String {
        guard let v = v else { return "undefined" }
        if case .null = v { return "null" }
        return toPrimitiveString(v)
    }

    /// StringToNumber（ECMA-262 §7.1.4.1.1）：去空白、空串 0、十进制 / 0x / 0o / 0b / Infinity。
    static func stringToNumber(_ s0: String) -> Double {
        let ws: Set<Unicode.Scalar> = ["\u{9}", "\u{A}", "\u{B}", "\u{C}", "\u{D}", "\u{20}", "\u{A0}", "\u{1680}", "\u{2000}", "\u{2001}", "\u{2002}", "\u{2003}",
                                       "\u{2004}", "\u{2005}", "\u{2006}", "\u{2007}", "\u{2008}", "\u{2009}", "\u{200A}", "\u{2028}", "\u{2029}", "\u{202F}", "\u{205F}", "\u{3000}", "\u{FEFF}"]
        var scalars = Array(s0.unicodeScalars)
        while let f = scalars.first, ws.contains(f) { scalars.removeFirst() }
        while let l = scalars.last, ws.contains(l) { scalars.removeLast() }
        let s = String(String.UnicodeScalarView(scalars))
        if s.isEmpty { return 0 }
        let lower = s.lowercased()
        for (prefix, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] where lower.hasPrefix(prefix) && s.utf8.count > 2 {
            var v = 0.0
            for c in s.dropFirst(2) {
                guard let d = c.hexDigitValue, d < radix else { return .nan }
                v = v * Double(radix) + Double(d)
            }
            return v
        }
        switch s {
        case "Infinity", "+Infinity": return .infinity
        case "-Infinity": return -.infinity
        default: break
        }
        // 十进制字面量：[+-] 数字 [. 数字] [e[+-]数字]，至少一位数字
        let u = Array(s.utf8)
        var i = 0
        if i < u.count && (u[i] == 0x2B || u[i] == 0x2D) { i += 1 }
        var digits = 0
        while i < u.count && u[i] >= 0x30 && u[i] <= 0x39 { i += 1; digits += 1 }
        if i < u.count && u[i] == 0x2E {
            i += 1
            while i < u.count && u[i] >= 0x30 && u[i] <= 0x39 { i += 1; digits += 1 }
        }
        if digits == 0 { return .nan }
        if i < u.count && (u[i] == 0x65 || u[i] == 0x45) {
            i += 1
            if i < u.count && (u[i] == 0x2B || u[i] == 0x2D) { i += 1 }
            var ed = 0
            while i < u.count && u[i] >= 0x30 && u[i] <= 0x39 { i += 1; ed += 1 }
            if ed == 0 { return .nan }
        }
        if i != u.count { return .nan }
        return Double(s) ?? .nan
    }

    /// JS 真值。
    package static func truthy(_ v: JSValue?) -> Bool {
        guard let v = v else { return false }
        switch v {
        case .null: return false
        case .bool(let b): return b
        case .number(let d): return !(d == 0 || d.isNaN)
        case .string(let s): return !s.isEmpty
        case .array, .object: return true
        }
    }

    /// `Number.isInteger(v)`。
    static func isInteger(_ v: JSValue?) -> Bool {
        guard case .number(let d)? = v else { return false }
        return d.isFinite && d.rounded(.towardZero) == d
    }

    /// `typeof v === 'string'` 时的值。
    static func str(_ v: JSValue?) -> String? { v?.stringValue }

    /// `v === s`（v 是字符串且逐码点相等）。
    package static func isString(_ v: JSValue?, _ s: String) -> Bool {
        guard case .string(let x)? = v else { return false }
        return jsEq(x, s)
    }

    /// `a === b`（JSON 值：对象 / 数组按「不是同一个」处理为 false，除非两边都是 nil）。
    static func strictEquals(_ a: JSValue?, _ b: JSValue?) -> Bool {
        switch (a, b) {
        case (nil, nil): return true
        case (.null?, .null?): return true
        case (.bool(let x)?, .bool(let y)?): return x == y
        case (.number(let x)?, .number(let y)?): return x == y
        case (.string(let x)?, .string(let y)?): return jsEq(x, y)
        default: return false
        }
    }

    /// JS 关系运算 `a < b`（字符串按码元比、其余转数字；undefined / NaN 恒为假）。
    static func less(_ a: JSValue?, _ b: JSValue?) -> Bool {
        if case .string(let x)? = a, case .string(let y)? = b { return JSMath.lessThan(x, y) }
        let pa = primitive(a), pb = primitive(b)
        if case .string(let x) = pa, case .string(let y) = pb { return JSMath.lessThan(x, y) }
        let x = number(pa), y = number(pb)
        return x < y
    }

    private static func primitive(_ v: JSValue?) -> JSValue? {
        guard let v = v else { return nil }
        switch v {
        case .array, .object: return .string(toPrimitiveString(v))
        default: return v
        }
    }

    static func lessOrEqual(_ a: JSValue?, _ b: JSValue?) -> Bool {
        // a <= b ⇔ !(b < a)，但有 NaN / undefined 时为假
        if case .string? = a, case .string? = b { return !less(b, a) }
        let pa = primitive(a), pb = primitive(b)
        if case .string? = pa, case .string? = pb { return !less(b, a) }
        let x = number(pa), y = number(pb)
        return x <= y
    }

    package static func obj(_ pairs: [(String, JSValue)]) -> JSValue { .object(JSObject(pairs)) }
}

// MARK: - 按码点判等的有序集合（JS Set<string>）

public struct KeySet: Sequence {
    public private(set) var items: [String] = []
    private var set = Set<JSKey>()

    public init() {}
    public init<S: Sequence>(_ s: S) where S.Element == String { for k in s { insert(k) } }

    public mutating func insert(_ k: String) {
        if set.insert(JSKey(s: k)).inserted { items.append(k) }
    }
    public func contains(_ k: String) -> Bool { set.contains(JSKey(s: k)) }
    public func contains(_ v: JSValue?) -> Bool {
        guard case .string(let s)? = v else { return false }
        return contains(s)
    }
    public var count: Int { items.count }
    public var isEmpty: Bool { items.isEmpty }
    public func makeIterator() -> IndexingIterator<[String]> { items.makeIterator() }
}

/// 按码点判等的有序映射（JS Map<string, V>）。
struct KeyMap<V> {
    private(set) var keys: [String] = []
    private var dict: [JSKey: V] = [:]
    subscript(_ k: String) -> V? {
        get { dict[JSKey(s: k)] }
        set {
            let key = JSKey(s: k)
            if let v = newValue {
                if dict.updateValue(v, forKey: key) == nil { keys.append(k) }
            } else if dict.removeValue(forKey: key) != nil {
                keys.removeAll { JSKey(s: $0) == key }
            }
        }
    }
    func has(_ k: String) -> Bool { dict[JSKey(s: k)] != nil }
    var entries: [(String, V)] { keys.map { ($0, dict[JSKey(s: $0)]!) } }
    var count: Int { keys.count }
}

// MARK: - 稳定排序（Array.prototype.sort 对一致比较函数的结果）

extension Array {
    /// 稳定归并排序；cmp(a, b) < 0 表示 a 排在 b 前（与 JS 比较函数同义）。
    func jsSorted(_ cmp: (Element, Element) -> Double) -> [Element] {
        if count < 2 { return self }
        var a = self
        var buf = self
        var width = 1
        while width < a.count {
            var i = 0
            while i < a.count {
                let mid = Swift.min(i + width, a.count)
                let hi = Swift.min(i + 2 * width, a.count)
                var l = i, r = mid, k = i
                while l < mid && r < hi {
                    if cmp(a[r], a[l]) < 0 { buf[k] = a[r]; r += 1 } else { buf[k] = a[l]; l += 1 }
                    k += 1
                }
                while l < mid { buf[k] = a[l]; l += 1; k += 1 }
                while r < hi { buf[k] = a[r]; r += 1; k += 1 }
                i += 2 * width
            }
            swap(&a, &buf)
            width *= 2
        }
        return a
    }
}

// MARK: - 记录查询（子集）

enum SchedRecords {
    /// 'r12' → 12；不合法 NaN。
    static func recordSerial(_ id: JSValue?) -> Double { serial(id, prefix: 0x72) }
    /// 's7' → 7；不合法 NaN。
    static func sessionSerial(_ id: JSValue?) -> Double { serial(id, prefix: 0x73) }

    /// 合法 = 前缀字母 + [1-9] + 若干 ASCII 数字（与旧写法 `Array(s.utf8)` 逐字节检查同一判据），值 = Number(数字部分)。
    /// 不建数组：至多 18 位数字时按 UInt64 累加再转 Double（< 10^18 < 2^64 不溢出；整数 → Double 与 strtod 都是就近舍入到偶数，结果相同）；
    /// 更长的才回到 Double(String)。
    private static func serial(_ id: JSValue?, prefix: UInt8) -> Double {
        guard case .string(let s)? = id else { return .nan }
        var it = s.utf8.makeIterator()
        guard it.next() == prefix, let lead = it.next(), lead >= 0x31, lead <= 0x39 else { return .nan }
        var v = UInt64(lead - 0x30), digits = 1
        while let c = it.next() {
            guard c >= 0x30 && c <= 0x39 else { return .nan }
            if digits < 18 { v = v * 10 + UInt64(c - 0x30) }
            digits += 1
        }
        if digits <= 18 { return Double(v) }
        return Double(String(decoding: s.utf8.dropFirst(), as: UTF8.self)) ?? .nan
    }

    static func compareRecordIds(_ a: JSValue?, _ b: JSValue?) -> Double {
        let sa = recordSerial(a), sb = recordSerial(b)
        return (sa.isNaN ? -1 : sa) - (sb.isNaN ? -1 : sb)
    }

    /// 按 id 序号稳定排序。比较值只取决于两边的 id 序号，所以先把每条的「序号或 -1」算一次（n 次解析，而不是每次比较解析两次），
    /// 再用同一个归并排序、同一个差值（ka - kb）排下标：每一步比较的结果与 `jsSorted { compareRecordIds($0["id"], $1["id"]) }` 相同，排列也就相同。
    static func sortById(_ records: [JSValue]) -> [JSValue] {
        if records.count < 2 { return records }
        let keys = records.map { r -> Double in
            let s = recordSerial(r["id"])
            return s.isNaN ? -1 : s
        }
        return Array(records.indices).jsSorted { keys[$0] - keys[$1] }.map { records[$0] }
    }

    /// 'base:静' → '静'（/^(base|custom):(.+)$/u 且恰一个码点）；不合法 nil。
    static func charOfCardKey(_ key: JSValue?) -> String? {
        guard case .string(let s)? = key else { return nil }
        return charOfCardKey(s)
    }

    static func charOfCardKey(_ s: String) -> String? {
        let u = s.utf8
        var rest: Substring.UnicodeScalarView
        if u.starts(with: "base:".utf8) {
            rest = s.unicodeScalars.dropFirst(5)
        } else if u.starts(with: "custom:".utf8) {
            rest = s.unicodeScalars.dropFirst(7)
        } else {
            return nil
        }
        guard rest.count == 1, let c = rest.first else { return nil }
        // `.` 不匹配行终止符
        if c == "\n" || c == "\r" || c == "\u{2028}" || c == "\u{2029}" { return nil }
        return String(String.UnicodeScalarView(rest))
    }

    static func isJudged(_ r: JSValue?) -> Bool { JS.isString(r?["kind"], "judged") }
    static func isKind(_ r: JSValue?, _ kind: String) -> Bool { JS.isString(r?["kind"], kind) }

    static func hasAnyJudged(_ records: [JSValue]) -> Bool { records.contains { isJudged($0) } }

    static func keyOf(_ r: JSValue) -> String? { r["cardKey"]?.stringValue }

    static func judgedCardKeysOn(_ records: [JSValue], _ day: String) -> KeySet {
        var out = KeySet()
        for r in records where isJudged(r) && JS.isString(r["localDay"], day) { if let k = keyOf(r) { out.insert(k) } }
        return out
    }

    static func answerSeenCardKeysOn(_ records: [JSValue], _ day: String) -> KeySet {
        var out = KeySet()
        for r in records where isKind(r, "answer-seen") && JS.isString(r["localDay"], day) { if let k = keyOf(r) { out.insert(k) } }
        return out
    }

    static func skippedCardKeysOn(_ records: [JSValue], _ day: String, from fromDay: String? = nil) -> KeySet {
        let from = JSValue.string(fromDay ?? day)
        var out = KeySet()
        for r in records where isKind(r, "skipped") && JS.lessOrEqual(from, r["localDay"]) && JS.lessOrEqual(r["localDay"], .string(day)) {
            if let k = keyOf(r) { out.insert(k) }
        }
        return out
    }

    /// 本日 judged 的「复习字」个数（records.reviewsDoneOn）。
    static func reviewsDoneOn(_ records: [JSValue], _ day: String) -> Int {
        var firstDay = KeyMap<JSValue>()
        for r in records where isJudged(r) {
            guard let k = keyOf(r) else { continue }
            let prev = firstDay[k]
            if !JS.truthy(prev) || JS.less(r["localDay"], prev) { firstDay[k] = r["localDay"] ?? .null }
        }
        var count = 0
        for key in judgedCardKeysOn(records, day) where JS.less(firstDay[key], .string(day)) { count += 1 }
        return count
    }

    /// 每个 cardKey 最近一次 judged（按 id 序号）。
    static func latestJudgedByCard(_ records: [JSValue]) -> KeyMap<JSValue> {
        var latest = KeyMap<JSValue>()
        for r in records where isJudged(r) {
            guard let k = keyOf(r) else { continue }
            if let prev = latest[k] {
                if compareRecordIds(prev["id"], r["id"]) < 0 { latest[k] = r }
            } else {
                latest[k] = r
            }
        }
        return latest
    }

    static func latestJudged(_ records: [JSValue], _ cardKey: String) -> JSValue? {
        latestJudgedByCard(records.filter { JS.isString($0["cardKey"], cardKey) })[cardKey]
    }
}
