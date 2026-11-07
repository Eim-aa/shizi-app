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
        case (.string(let x), .string(let y)): return utf8Equal(x, y)
        case (.array(let x), .array(let y)): return x == y
        case (.object(let x), .object(let y)): return x == y
        default: return false
        }
    }
}

/// 两串 UTF-8 字节是否相同（= `a.utf8.elementsEqual(b.utf8)`）；连续存储时整段 memcmp（同一块存储直接相同）。
func utf8Equal(_ a: String, _ b: String) -> Bool {
    let fast = a.utf8.withContiguousStorageIfAvailable { pa in
        b.utf8.withContiguousStorageIfAvailable { pb -> Bool in
            if pa.count != pb.count { return false }
            if pa.count == 0 || pa.baseAddress == pb.baseAddress { return true }
            return memcmp(pa.baseAddress!, pb.baseAddress!, pa.count) == 0
        }
    }
    if let f = fast, let eq = f { return eq }
    return a.utf8.elementsEqual(b.utf8)
}

/// 两个值的位模式完全相同（同一个引用 / 同一块写时复制的存储，或同一个内联小值）。true ⇒ 是同一个值；false 什么也不说明。
func sameRepresentation<T>(_ a: T, _ b: T) -> Bool {
    var x = a, y = b
    return withUnsafeBytes(of: &x) { px in withUnsafeBytes(of: &y) { py in px.elementsEqual(py) } }
}

/// 按 UTF-8 字节判等的键（见文件头）。散列 = 整串 UTF-8 字节一次喂给 Hasher（与 == 一致：字节相同 ⇒ 散列相同）。
struct JSKey: Hashable {
    let s: String
    static func == (a: JSKey, b: JSKey) -> Bool { utf8Equal(a.s, b.s) }
    func hash(into h: inout Hasher) {
        if s.utf8.withContiguousStorageIfAvailable({ h.combine(bytes: UnsafeRawBufferPointer($0)) }) == nil {
            Array(s.utf8).withUnsafeBytes { h.combine(bytes: $0) }
        }
    }
}

/// JS 普通对象（键序见文件头）。
public struct JSObject: Equatable {
    private var values: [JSKey: JSValue] = [:]
    private var insertion: [String] = []

    public init() {}

    public init(_ pairs: [(String, JSValue)]) {
        for (k, v) in pairs { self[k] = v }
    }

    /// 预留 n 个键的空对象（只影响容量，不影响内容与键序）：已知键数时一次分配好，免得逐个写入时反复扩容、重新散列。
    init(minimumCapacity n: Int) {
        values = Dictionary(minimumCapacity: n)
        insertion.reserveCapacity(n)
    }

    public var count: Int { insertion.count }
    public var isEmpty: Bool { insertion.isEmpty }

    public subscript(key: String) -> JSValue? {
        get { values[JSKey(s: key)] }
        set {
            let k = JSKey(s: key)
            if let v = newValue {
                // 一次散列：updateValue 返回旧值，nil 即新键（与先查 values[k] == nil 再写同义）
                if values.updateValue(v, forKey: k) == nil { insertion.append(key) }
            } else if values.removeValue(forKey: k) != nil {
                insertion.removeAll { JSKey(s: $0) == k }
            }
        }
    }

    /// 键序与 JS `Object.keys` 相同。没有下标形的键时就是插入序（常见情形，不另建数组）。
    public var keys: [String] {
        if !insertion.contains(where: { JSObject.arrayIndex($0) != nil }) { return insertion }
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
        let u = k.utf8
        let n = u.count
        if n == 0 || n > 10 { return nil }
        if n > 1 && u.first == 0x30 { return nil }
        var v: UInt64 = 0
        for c in u {
            guard c >= 0x30 && c <= 0x39 else { return nil }
            v = v * 10 + UInt64(c - 0x30)
        }
        return v <= 4_294_967_294 ? UInt32(v) : nil
    }

    /// 与 other 是同一块存储（写时复制的副本，之后两边都没改过）：true ⇒ 键、键序、值全同；false 什么也不说明。
    func sharesStorage(with other: JSObject) -> Bool { sameRepresentation(self, other) }

    public static func == (a: JSObject, b: JSObject) -> Bool { a.values == b.values }
}
