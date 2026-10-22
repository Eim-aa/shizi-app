import Foundation

// B4.3 共用的 JS 语义小工具：真值、字符串按码元比较、稳定排序、Number()、按插入序的映射。
// 规则代码（Records / Query / WorkMembers …）直接处理 JSValue（与 JS 对象一一对应，透传原值逐字节不变），所以这里放 JS 的那几条隐式规则。

enum JSX {
    /// JS 真值：null / false / 0 / NaN / 空串为假；数组与对象恒真。
    static func truthy(_ v: JSValue?) -> Bool {
        guard let v = v else { return false }
        switch v {
        case .null: return false
        case .bool(let b): return b
        case .number(let d): return !(d == 0 || d.isNaN)
        case .string(let s): return !s.isEmpty
        case .array, .object: return true
        }
    }

    /// 字符串相等：逐码点（UTF-8 字节），不是 Swift 的规范等价。
    static func eq(_ a: String, _ b: String) -> Bool { a.utf8.elementsEqual(b.utf8) }
    static func eq(_ a: JSValue?, _ b: String) -> Bool {
        if case .string(let s)? = a { return eq(s, b) }
        return false
    }

    /// JS 字符串 `<` / `>` 比较：UTF-16 码元逐个比。
    static func cmp(_ a: String, _ b: String) -> Int {
        var i = a.utf16.makeIterator()
        var j = b.utf16.makeIterator()
        while true {
            switch (i.next(), j.next()) {
            case (nil, nil): return 0
            case (nil, _): return -1
            case (_, nil): return 1
            case (let x?, let y?): if x != y { return x < y ? -1 : 1 }
            }
        }
    }

    /// JS `Number(value)`（字符串按 StringToNumber；数组 / 对象走 ToPrimitive 的字符串形式）。
    static func toNumber(_ v: JSValue?) -> Double {
        guard let v = v else { return .nan }
        switch v {
        case .null: return 0
        case .bool(let b): return b ? 1 : 0
        case .number(let d): return d
        case .string(let s): return stringToNumber(s)
        case .array(let a):
            if a.isEmpty { return 0 }
            if a.count == 1 { if case .null = a[0] { return 0 }; return toNumber(.string(Copy.jsString(a[0]))) }
            return .nan
        case .object: return .nan
        }
    }

    static func isJSSpace(_ u: UInt16) -> Bool {
        switch u {
        case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
        case 0x2000...0x200A: return true
        default: return false
        }
    }

    static func stringToNumber(_ s: String) -> Double {
        var u = Array(s.utf16)
        while let f = u.first, isJSSpace(f) { u.removeFirst() }
        while let l = u.last, isJSSpace(l) { u.removeLast() }
        if u.isEmpty { return 0 }
        let t = String(decoding: u, as: UTF16.self)
        let ascii = t.utf8.allSatisfy { $0 < 0x80 }
        guard ascii else { return .nan }
        if t.count > 2, t.hasPrefix("0") {
            let radix: Int? = ["x", "X"].contains(String(t[t.index(after: t.startIndex)])) ? 16 : ["o", "O"].contains(String(t[t.index(after: t.startIndex)])) ? 8 : ["b", "B"].contains(String(t[t.index(after: t.startIndex)])) ? 2 : nil
            if let r = radix {
                let body = t.dropFirst(2)
                var acc = 0.0
                for c in body.utf8 {
                    guard let d = Int(String(UnicodeScalar(c)), radix: r) else { return .nan }
                    acc = acc * Double(r) + Double(d)
                }
                return acc
            }
        }
        if t == "Infinity" || t == "+Infinity" { return .infinity }
        if t == "-Infinity" { return -.infinity }
        // StrDecimalLiteral：[+-] digits [. digits] [e[+-]digits]，至少一位数字；不接受 "inf" / "nan" / 十六进制浮点等 strtod 扩展
        let b = Array(t.utf8)
        var i = 0
        if i < b.count, b[i] == 0x2B || b[i] == 0x2D { i += 1 }
        var digits = 0
        while i < b.count, b[i] >= 0x30, b[i] <= 0x39 { i += 1; digits += 1 }
        if i < b.count, b[i] == 0x2E {
            i += 1
            while i < b.count, b[i] >= 0x30, b[i] <= 0x39 { i += 1; digits += 1 }
        }
        if digits == 0 { return .nan }
        if i < b.count, b[i] == 0x65 || b[i] == 0x45 {
            i += 1
            if i < b.count, b[i] == 0x2B || b[i] == 0x2D { i += 1 }
            var ed = 0
            while i < b.count, b[i] >= 0x30, b[i] <= 0x39 { i += 1; ed += 1 }
            if ed == 0 { return .nan }
        }
        guard i == b.count else { return .nan }
        return Double(t) ?? .nan
    }

    /// 稳定排序（JS Array.prototype.sort 是稳定的）。比较函数返回 Double（NaN 当 0，与 SortCompare 一致）。
    static func stableSort<T>(_ items: [T], _ compare: (T, T) -> Double) -> [T] {
        if items.count < 2 { return items }
        func order(_ a: T, _ b: T) -> Bool { // a 排在 b 前面（严格）
            let r = compare(a, b)
            return r < 0
        }
        // 归并（稳定）
        var src = items
        var dst = items
        var width = 1
        let n = items.count
        while width < n {
            var i = 0
            while i < n {
                let mid = min(i + width, n)
                let hi = min(i + 2 * width, n)
                var l = i, r = mid, k = i
                while l < mid && r < hi {
                    if order(src[r], src[l]) { dst[k] = src[r]; r += 1 } else { dst[k] = src[l]; l += 1 }
                    k += 1
                }
                while l < mid { dst[k] = src[l]; l += 1; k += 1 }
                while r < hi { dst[k] = src[r]; r += 1; k += 1 }
                i += 2 * width
            }
            swap(&src, &dst)
            width *= 2
        }
        return src
    }
}

/// 按首次插入序的映射（JS Map）：键按 UTF-8 判等；覆盖旧键保持原位置。
public struct OMap<V> {
    public private(set) var keys: [String] = []
    private var dict: [JSKey: V] = [:]

    public init() {}
    public subscript(key: String) -> V? {
        get { dict[JSKey(s: key)] }
        set {
            let k = JSKey(s: key)
            if let v = newValue {
                if dict[k] == nil { keys.append(key) }
                dict[k] = v
            } else if dict.removeValue(forKey: k) != nil {
                keys.removeAll { JSKey(s: $0) == k }
            }
        }
    }
    public func has(_ key: String) -> Bool { dict[JSKey(s: key)] != nil }
    public var values: [V] { keys.map { dict[JSKey(s: $0)]! } }
    public var entries: [(key: String, value: V)] { keys.map { ($0, dict[JSKey(s: $0)]!) } }
    public var count: Int { keys.count }
}

/// 按插入序的集合（JS Set<string>）。
public struct OSet {
    private var seen = Set<JSKey>()
    public private(set) var items: [String] = []
    public init() {}
    @discardableResult public mutating func insert(_ s: String) -> Bool {
        if seen.insert(JSKey(s: s)).inserted { items.append(s); return true }
        return false
    }
    public func contains(_ s: String) -> Bool { seen.contains(JSKey(s: s)) }
    public var count: Int { items.count }
}

extension JSValue {
    /// 字段取值的简写（非对象返回 nil，与 JS 在非 null 值上取属性得 undefined 一致）。
    func str(_ k: String) -> String? { self[k]?.stringValue }
}
