import Foundation

// JSON 值，语义照 JS（B4.0；计划 §4.3「数字与 JSON」）：
//   · 数字只有一种 Double（JS Number）；
//   · 对象的键序照 ECMAScript OrdinaryOwnPropertyKeys：数组下标形的键（0 … 2^32−2 的规范十进制）升序在前，其余按插入序；
//     所以 Swift 解析、改写、再序列化出的文字与 JS `JSON.stringify(JSON.parse(x))` 逐字节相同（JSONWriter）。
//   · 字符串是 Swift String（合法 Unicode）；JS 的孤立代理项无法表示——协议约定不传孤立代理项（差分生成器也不生成）。
//   · 字符串相等按码点逐个比（JS 语义）。Swift String 的 == 按 Unicode 规范等价（「é」== 「e\u{301}」），
//     所以对象键与字符串比较一律经 JSKey / utf8 比较，不直接用 String 的 == 与 Hashable。

public enum JSValue: Equatable, CustomStringConvertible {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSValue])
    case object(JSObject)

    public var description: String { JSONWriter.stringify(self) }

    public subscript(key: String) -> JSValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    public var stringValue: String? { if case .string(let s) = self { return s }; return nil }
    public var numberValue: Double? { if case .number(let d) = self { return d }; return nil }
    public var boolValue: Bool? { if case .bool(let b) = self { return b }; return nil }
    public var objectValue: JSObject? { if case .object(let o) = self { return o }; return nil }
    public var arrayValue: [JSValue]? { if case .array(let a) = self { return a }; return nil }
    public var isNull: Bool { if case .null = self { return true }; return false }

    /// 语义相等：数字按 JS `===`（0 == −0；NaN 不出现在 JSON 里），字符串逐码点，对象键集合相同且各值相等（不看键序）。
    public static func == (a: JSValue, b: JSValue) -> Bool {
        switch (a, b) {
        case (.null, .null): return true
        case (.bool(let x), .bool(let y)): return x == y
        case (.number(let x), .number(let y)): return x == y
        case (.string(let x), .string(let y)): return x.utf8.elementsEqual(y.utf8)
        case (.array(let x), .array(let y)): return x == y
        case (.object(let x), .object(let y)): return x == y
        default: return false
        }
    }
}

/// 按 UTF-8 字节判等的键（见文件头）。
struct JSKey: Hashable {
    let s: String
    static func == (a: JSKey, b: JSKey) -> Bool { a.s.utf8.elementsEqual(b.s.utf8) }
    func hash(into h: inout Hasher) { for b in s.utf8 { h.combine(b) } }
}

/// JS 普通对象（键序见文件头）。
public struct JSObject: Equatable {
    private var values: [JSKey: JSValue] = [:]
    private var insertion: [String] = []

    public init() {}

    public init(_ pairs: [(String, JSValue)]) {
        for (k, v) in pairs { self[k] = v }
    }

    public var count: Int { insertion.count }
    public var isEmpty: Bool { insertion.isEmpty }

    public subscript(key: String) -> JSValue? {
        get { values[JSKey(s: key)] }
        set {
            let k = JSKey(s: key)
            if let v = newValue {
                if values[k] == nil { insertion.append(key) }
                values[k] = v
            } else if values.removeValue(forKey: k) != nil {
                insertion.removeAll { JSKey(s: $0) == k }
            }
        }
    }

    /// 键序与 JS `Object.keys` 相同。
    public var keys: [String] {
        var index: [(UInt32, String)] = []
        var named: [String] = []
        for k in insertion {
            if let i = JSObject.arrayIndex(k) { index.append((i, k)) } else { named.append(k) }
        }
        index.sort { $0.0 < $1.0 }
        return index.map { $0.1 } + named
    }

    public var entries: [(key: String, value: JSValue)] { keys.map { ($0, values[JSKey(s: $0)]!) } }

    /// 规范数组下标：「0」或不以 0 开头的十进制，值 ≤ 2^32 − 2。
    static func arrayIndex(_ k: String) -> UInt32? {
        let u = Array(k.utf8)
        if u.isEmpty || u.count > 10 { return nil }
        if u.count > 1 && u[0] == 0x30 { return nil }
        var v: UInt64 = 0
        for c in u {
            guard c >= 0x30 && c <= 0x39 else { return nil }
            v = v * 10 + UInt64(c - 0x30)
        }
        return v <= 4_294_967_294 ? UInt32(v) : nil
    }

    public static func == (a: JSObject, b: JSObject) -> Bool { a.values == b.values }
}
