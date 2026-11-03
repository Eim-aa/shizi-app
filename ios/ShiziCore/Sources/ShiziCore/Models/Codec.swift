import Foundation

// 模型的编解码底座（B4.1）。
//
// 为什么不是 Foundation 的 Codable：落盘 JSON 必须与 JS `JSON.stringify` 逐字节相同（键序、数字格式，计划 §4.3「数字与 JSON」），
// JSONEncoder 两样都做不到，所以模型走自己的 `JSCodable`（`init(js:)` / `js`，经 JSValue 与 JSONWriter）。
//
// 键序规则：解码时记下对象的键序（`order`），编码时先按记下的键序写（存在的键），其余键按模型的规范序（= JS 写入处构造对象的字面量序）补在后面；
// 所以「读 → 改 → 写」不会无故重排键，新构造的模型按 JS 的键序写。形状校验仍由 Schema 做（模型只在校验通过后解码，形状不对时抛 bad-args）。

public protocol JSCodable {
    init(js: JSValue) throws
    var js: JSValue { get }
}

/// 三态字段：JS 里「键不存在」与「键存在且为 null」是两件事（形状表里 `dayOrNull` / `strOrNull` 与可缺省并存）。
public enum Field<T> {
    case absent
    case null
    case value(T)

    public var value: T? { if case .value(let v) = self { return v }; return nil }
}
extension Field: Equatable where T: Equatable {}

enum ModelError {
    static func shape(_ path: String) -> CoreError { CoreError.badArgs("model shape: " + path) }
}

/// 读对象字段的助手。
struct Reader {
    let o: JSObject
    let path: String
    var order: [String] { o.keys }

    init(_ v: JSValue, _ path: String) throws {
        guard case .object(let o) = v else { throw ModelError.shape(path) }
        self.o = o
        self.path = path
    }

    func raw(_ k: String) -> JSValue? { o[k] }

    func req<T>(_ k: String, _ conv: (JSValue) throws -> T) throws -> T {
        guard let v = o[k] else { throw ModelError.shape(path + "." + k + " missing") }
        return try conv(v)
    }
    func opt<T>(_ k: String, _ conv: (JSValue) throws -> T) throws -> T? {
        guard let v = o[k] else { return nil }
        return try conv(v)
    }
    func field<T>(_ k: String, _ conv: (JSValue) throws -> T) throws -> Field<T> {
        guard let v = o[k] else { return .absent }
        if case .null = v { return .null }
        return .value(try conv(v))
    }
}

enum Conv {
    static func str(_ v: JSValue) throws -> String {
        guard case .string(let s) = v else { throw ModelError.shape("string") }
        return s
    }
    static func num(_ v: JSValue) throws -> Double {
        guard case .number(let d) = v else { throw ModelError.shape("number") }
        return d
    }
    static func bool(_ v: JSValue) throws -> Bool {
        guard case .bool(let b) = v else { throw ModelError.shape("boolean") }
        return b
    }
    static func any(_ v: JSValue) throws -> JSValue { v }
    static func array<T>(_ conv: @escaping (JSValue) throws -> T) -> (JSValue) throws -> [T] {
        { v in
            guard case .array(let a) = v else { throw ModelError.shape("array") }
            return try a.map(conv)
        }
    }
    static func model<M: JSCodable>(_ type: M.Type) -> (JSValue) throws -> M { { try M(js: $0) } }
    static func nullable<T>(_ conv: @escaping (JSValue) throws -> T) -> (JSValue) throws -> T? {
        { v in v.isNull ? nil : try conv(v) }
    }
}

/// 写对象字段的助手：add 的顺序 = 规范键序。
struct Writer {
    private var pairs: [(String, JSValue)] = []

    mutating func add(_ k: String, _ v: JSValue?) { if let v = v { pairs.append((k, v)) } }
    mutating func add(_ k: String, _ v: String?) { if let v = v { pairs.append((k, .string(v))) } }
    mutating func add(_ k: String, _ v: Double?) { if let v = v { pairs.append((k, .number(v))) } }
    mutating func add(_ k: String, _ v: Bool?) { if let v = v { pairs.append((k, .bool(v))) } }
    mutating func add<M: JSCodable>(_ k: String, model v: M?) { if let v = v { pairs.append((k, v.js)) } }
    mutating func add<T>(_ k: String, _ f: Field<T>, _ enc: (T) -> JSValue) {
        switch f {
        case .absent: break
        case .null: pairs.append((k, .null))
        case .value(let v): pairs.append((k, enc(v)))
        }
    }
    mutating func add<T>(_ k: String, array: [T]?, _ enc: (T) -> JSValue) {
        if let a = array { pairs.append((k, .array(a.map(enc)))) }
    }

    func build(order: [String]?) -> JSValue {
        var out = JSObject()
        var used = Set<JSKey>()
        if let order = order {
            for k in order {
                if let p = pairs.first(where: { $0.0.utf8.elementsEqual(k.utf8) }), !used.contains(JSKey(s: k)) {
                    out[p.0] = p.1
                    used.insert(JSKey(s: k))
                }
            }
        }
        for p in pairs where !used.contains(JSKey(s: p.0)) { out[p.0] = p.1 }
        return .object(out)
    }
}

/// 键序保持的映射（sched / wordOff / photos / ink / byDay 这类 `{键: 值}` 对象）。
public struct OrderedMap<T> {
    public var entries: [(key: String, value: T)]
    public init(_ entries: [(key: String, value: T)] = []) { self.entries = entries }

    public subscript(key: String) -> T? {
        get { entries.first { $0.key.utf8.elementsEqual(key.utf8) }?.value }
        set {
            if let i = entries.firstIndex(where: { $0.key.utf8.elementsEqual(key.utf8) }) {
                if let v = newValue { entries[i].value = v } else { entries.remove(at: i) }
            } else if let v = newValue {
                entries.append((key, v))
            }
        }
    }
    public var keys: [String] { entries.map { $0.key } }
    public var count: Int { entries.count }

    init(_ v: JSValue, _ path: String, _ conv: (JSValue) throws -> T) throws {
        guard case .object(let o) = v else { throw ModelError.shape(path) }
        entries = try o.entries.map { ($0.key, try conv($0.value)) }
    }

    func encode(_ enc: (T) -> JSValue) -> JSValue {
        var o = JSObject()
        for e in entries { o[e.key] = enc(e.value) }
        return .object(o)
    }
}

extension OrderedMap: Equatable where T: Equatable {
    public static func == (a: OrderedMap<T>, b: OrderedMap<T>) -> Bool {
        a.entries.count == b.entries.count && zip(a.entries, b.entries).allSatisfy { $0.key.utf8.elementsEqual($1.key.utf8) && $0.value == $1.value }
    }
}
