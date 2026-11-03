import Foundation

// src/config/copy/index.js 的移植：文案表来自生成的 copy.json（不手抄任何文案），这里只有占位符填充与取用规则。
// 占位符 {name}（name = [A-Za-z]+）；缺值（没有这个键、值为 null）的占位符原样保留。

public enum Copy {
    /// 合并后的文案表：键 → 字串 | 字串数组。
    static let table: JSObject = Config.copyData.objectValue ?? JSObject()

    public static func has(_ key: String) -> Bool { table[key] != nil }

    public static var keys: [String] { table.keys }

    /// 模板里的 {name} 填充（`format`）。数组模板逐行填。
    public static func format(_ template: JSValue, _ vars: JSObject?) -> JSValue {
        switch template {
        case .string(let s): return .string(fill(s, vars))
        case .array(let a): return .array(a.map { format($0, vars) })
        default: return template
        }
    }

    static func fill(_ s: String, _ vars: JSObject?) -> String {
        let u = Array(s.utf8)
        var out: [UInt8] = []
        out.reserveCapacity(u.count)
        var i = 0
        func isLetter(_ c: UInt8) -> Bool { (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) }
        while i < u.count {
            if u[i] == 0x7B { // {
                var j = i + 1
                while j < u.count, isLetter(u[j]) { j += 1 }
                if j > i + 1, j < u.count, u[j] == 0x7D {
                    let name = String(decoding: u[(i + 1)..<j], as: UTF8.self)
                    if let vars = vars, let v = vars[name], !v.isNull {
                        out.append(contentsOf: Array(jsString(v).utf8))
                        i = j + 1
                        continue
                    }
                    out.append(contentsOf: u[i...j])
                    i = j + 1
                    continue
                }
            }
            out.append(u[i])
            i += 1
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// JS `String(value)`（数组按 join(',')，null / undefined 元素当空串；对象为 [object Object]）。
    public static func jsString(_ v: JSValue) -> String {
        switch v {
        case .null: return "null"
        case .bool(let b): return b ? "true" : "false"
        case .number(let d): return JSNumber.toString(d)
        case .string(let s): return s
        case .array(let a):
            return a.map { e -> String in
                if case .null = e { return "" }
                return jsString(e)
            }.joined(separator: ",")
        case .object: return "[object Object]"
        }
    }

    /// 取文案并填充占位符；键不存在抛错（文案门禁保证键齐全）。数组值返回数组。
    public static func t(_ key: String, _ vars: JSObject? = nil) throws -> JSValue {
        guard let template = table[key] else { throw CoreError.error("unknown copy key: " + key) }
        return format(template, vars)
    }

    /// 取单句文案（字串值）。
    public static func text(_ key: String, _ vars: JSObject? = nil) throws -> String {
        guard let s = try t(key, vars).stringValue else { throw CoreError.error("copy key is not a single line: " + key) }
        return s
    }

    /// 涉及「笔迹」承诺的文案槽：policy.features.perRecordInk 为 true 取 base，否则取 base + 「Glyph」。
    public static func inkKey(_ base: String, perRecordInk: Bool = Config.policyBool("features.perRecordInk") ?? false) -> String {
        perRecordInk ? base : base + "Glyph"
    }

    // ---- 文案引用（{copy, params}；views 里只给引用，渲染在这里）----

    public static func isRef(_ v: JSValue) -> Bool {
        if case .object(let o) = v, case .string? = o["copy"] { return true }
        return false
    }

    /// 把文案引用渲染成句子（参数里的引用先展开）；null → ''；非引用原样返回。
    public static func tRef(_ value: JSValue) throws -> JSValue {
        guard isRef(value), case .object(let o) = value, let key = o["copy"]?.stringValue else {
            if case .null = value { return .string("") }
            return value
        }
        var vars: JSObject?
        if case .object(let p)? = o["params"] {
            var rendered = JSObject()
            for e in p.entries { rendered[e.key] = isRef(e.value) ? try tRef(e.value) : e.value }
            vars = rendered
        }
        return try t(key, vars)
    }
}

extension Config {
    public static let copyData: JSValue = {
        do { return try CoreResources.load("copy") } catch { fatalError("ShiziCore resource copy: \(error)") }
    }()
}
