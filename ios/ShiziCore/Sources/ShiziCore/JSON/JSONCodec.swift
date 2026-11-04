import Foundation

// 与 JS 同规则的 JSON 读写（B4.0；计划 §4.3）。
//   JSONParser  ≡ JSON.parse（语法同 ECMA-404；重复键后者覆盖、位置取首次出现）
//   JSONWriter  ≡ JSON.stringify（无缩进；数字按 ECMAScript Number::toString；非有限数写 null；字符串转义同 QuoteJSONString）
// 不用 JSONSerialization / JSONEncoder：它们不保留键序、数字格式与 JS 不同（Swift 写「1.0」、JS 写「1」）。

public enum JSONError: Error, Equatable, CustomStringConvertible {
    case syntax(String, offset: Int)
    case loneSurrogate(offset: Int)

    public var description: String {
        switch self {
        case .syntax(let m, let o): return "JSON syntax error at \(o): \(m)"
        case .loneSurrogate(let o): return "lone surrogate escape at \(o) (not representable)"
        }
    }
}

public struct JSONParser {
    private let b: [UInt8]
    private var i = 0

    public static func parse(_ text: String) throws -> JSValue {
        var p = JSONParser(bytes: Array(text.utf8))
        p.ws()
        let v = try p.value()
        p.ws()
        if p.i != p.b.count { throw JSONError.syntax("trailing characters", offset: p.i) }
        return v
    }

    private init(bytes: [UInt8]) { b = bytes }

    private mutating func ws() {
        while i < b.count, b[i] == 0x20 || b[i] == 0x09 || b[i] == 0x0A || b[i] == 0x0D { i += 1 }
    }

    private func fail(_ m: String) -> JSONError { .syntax(m, offset: i) }

    private mutating func literal(_ s: String, _ v: JSValue) throws -> JSValue {
        let u = Array(s.utf8)
        guard i + u.count <= b.count, Array(b[i..<(i + u.count)]) == u else { throw fail("bad literal") }
        i += u.count
        return v
    }

    private mutating func value() throws -> JSValue {
        guard i < b.count else { throw fail("unexpected end") }
        switch b[i] {
        case 0x7B: return try object()
        case 0x5B: return try array()
        case 0x22: return .string(try string())
        case 0x74: return try literal("true", .bool(true))
        case 0x66: return try literal("false", .bool(false))
        case 0x6E: return try literal("null", .null)
        default: return .number(try number())
        }
    }

    private mutating func object() throws -> JSValue {
        i += 1
        var o = JSObject()
        ws()
        if i < b.count, b[i] == 0x7D { i += 1; return .object(o) }
        while true {
            ws()
            guard i < b.count, b[i] == 0x22 else { throw fail("expected key") }
            let k = try string()
            ws()
            guard i < b.count, b[i] == 0x3A else { throw fail("expected ':'") }
            i += 1
            ws()
            o[k] = try value()
            ws()
            guard i < b.count else { throw fail("unexpected end") }
            if b[i] == 0x2C { i += 1; continue }
            if b[i] == 0x7D { i += 1; return .object(o) }
            throw fail("expected ',' or '}'")
        }
    }

    private mutating func array() throws -> JSValue {
        i += 1
        var a: [JSValue] = []
        ws()
        if i < b.count, b[i] == 0x5D { i += 1; return .array(a) }
        while true {
            ws()
            a.append(try value())
            ws()
            guard i < b.count else { throw fail("unexpected end") }
            if b[i] == 0x2C { i += 1; continue }
            if b[i] == 0x5D { i += 1; return .array(a) }
            throw fail("expected ',' or ']'")
        }
    }

    private mutating func hex4() throws -> UInt32 {
        guard i + 4 <= b.count else { throw fail("short \\u escape") }
        var v: UInt32 = 0
        for _ in 0..<4 {
            let c = b[i]
            let d: UInt32
            switch c {
            case 0x30...0x39: d = UInt32(c - 0x30)
            case 0x41...0x46: d = UInt32(c - 0x41 + 10)
            case 0x61...0x66: d = UInt32(c - 0x61 + 10)
            default: throw fail("bad hex digit")
            }
            v = v * 16 + d
            i += 1
        }
        return v
    }

    private mutating func string() throws -> String {
        i += 1
        var out = [UInt8]()
        while true {
            guard i < b.count else { throw fail("unterminated string") }
            let c = b[i]
            if c == 0x22 { i += 1; break }
            if c < 0x20 { throw fail("control character in string") }
            if c != 0x5C { out.append(c); i += 1; continue }
            i += 1
            guard i < b.count else { throw fail("unterminated escape") }
            let e = b[i]
            i += 1
            switch e {
            case 0x22: out.append(0x22)
            case 0x5C: out.append(0x5C)
            case 0x2F: out.append(0x2F)
            case 0x62: out.append(0x08)
            case 0x66: out.append(0x0C)
            case 0x6E: out.append(0x0A)
            case 0x72: out.append(0x0D)
            case 0x74: out.append(0x09)
            case 0x75:
                let start = i - 2
                var cp = try hex4()
                if cp >= 0xD800 && cp <= 0xDBFF {
                    guard i + 6 <= b.count, b[i] == 0x5C, b[i + 1] == 0x75 else { throw JSONError.loneSurrogate(offset: start) }
                    i += 2
                    let lo = try hex4()
                    guard lo >= 0xDC00 && lo <= 0xDFFF else { throw JSONError.loneSurrogate(offset: start) }
                    cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00)
                } else if cp >= 0xDC00 && cp <= 0xDFFF {
                    throw JSONError.loneSurrogate(offset: start)
                }
                out.append(contentsOf: Array(String(Character(Unicode.Scalar(cp)!)).utf8))
            default: throw fail("bad escape")
            }
        }
        // 不用 String(bytes:encoding:)：它会吃掉开头的 U+FEFF。输入本是合法 UTF-8，这里只拼合法序列。
        return String(decoding: out, as: UTF8.self)
    }

    private mutating func number() throws -> Double {
        let start = i
        if i < b.count, b[i] == 0x2D { i += 1 }
        guard i < b.count, b[i] >= 0x30 && b[i] <= 0x39 else { throw fail("bad number") }
        if b[i] == 0x30 { i += 1 } else { while i < b.count, b[i] >= 0x30 && b[i] <= 0x39 { i += 1 } }
        if i < b.count, b[i] == 0x2E {
            i += 1
            guard i < b.count, b[i] >= 0x30 && b[i] <= 0x39 else { throw fail("bad fraction") }
            while i < b.count, b[i] >= 0x30 && b[i] <= 0x39 { i += 1 }
        }
        if i < b.count, b[i] == 0x65 || b[i] == 0x45 {
            i += 1
            if i < b.count, b[i] == 0x2B || b[i] == 0x2D { i += 1 }
            guard i < b.count, b[i] >= 0x30 && b[i] <= 0x39 else { throw fail("bad exponent") }
            while i < b.count, b[i] >= 0x30 && b[i] <= 0x39 { i += 1 }
        }
        let text = String(decoding: b[start..<i], as: UTF8.self)
        guard let d = Double(text) else { throw fail("bad number") }
        return d
    }
}

public enum JSONWriter {
    public static func stringify(_ v: JSValue) -> String {
        var out = ""
        write(v, into: &out)
        return out
    }

    static func write(_ v: JSValue, into out: inout String) {
        switch v {
        case .null: out += "null"
        case .bool(let x): out += x ? "true" : "false"
        case .number(let d): out += d.isFinite ? JSNumber.toString(d) : "null"
        case .string(let s): quote(s, into: &out)
        case .array(let a):
            out += "["
            for (n, e) in a.enumerated() {
                if n > 0 { out += "," }
                write(e, into: &out)
            }
            out += "]"
        case .object(let o):
            out += "{"
            for (n, e) in o.entries.enumerated() {
                if n > 0 { out += "," }
                quote(e.key, into: &out)
                out += ":"
                write(e.value, into: &out)
            }
            out += "}"
        }
    }

    static let hex: [Character] = Array("0123456789abcdef")

    /// stringify(a) 与 stringify(b) 是否逐字节相同，不真的拼出字串。JSON 文本的解析唯一，所以逐层比「各自会写成什么」：
    /// 有限数写最短往返串（不同的有限数串不同，±0 都写「0」）⇔ JS ===；非有限数写「null」；字符串的转义逐码点一一对应 ⇔ 原串逐字节相同；
    /// 数组逐元素；对象按 keys 序逐个比键与值。
    static func sameText(_ a: JSValue, _ b: JSValue) -> Bool {
        switch (a, b) {
        case (.number(let x), .number(let y)): return x.isFinite ? (y.isFinite && x == y) : !y.isFinite
        case (.number(let x), .null), (.null, .number(let x)): return !x.isFinite
        case (.null, .null): return true
        case (.bool(let x), .bool(let y)): return x == y
        case (.string(let x), .string(let y)): return utf8Equal(x, y)
        case (.array(let x), .array(let y)):
            if x.count != y.count { return false }
            for i in 0..<x.count where !sameText(x[i], y[i]) { return false }
            return true
        case (.object(let x), .object(let y)):
            if x.count != y.count { return false }
            let kx = x.keys, ky = y.keys
            for i in 0..<kx.count {
                guard utf8Equal(kx[i], ky[i]), let vx = x[kx[i]], let vy = y[ky[i]], sameText(vx, vy) else { return false }
            }
            return true
        default: return false
        }
    }

    public static func quote(_ s: String, into out: inout String) {
        out += "\""
        for u in s.unicodeScalars {
            switch u.value {
            case 0x22: out += "\\\""
            case 0x5C: out += "\\\\"
            case 0x08: out += "\\b"
            case 0x0C: out += "\\f"
            case 0x0A: out += "\\n"
            case 0x0D: out += "\\r"
            case 0x09: out += "\\t"
            case 0..<0x20:
                out += "\\u00"
                out.append(hex[Int(u.value >> 4)])
                out.append(hex[Int(u.value & 0xF)])
            default: out.unicodeScalars.append(u)
            }
        }
        out += "\""
    }
}

/// ECMAScript Number::toString(x)（基数 10）。最短往返数字取自 Swift 的 `description`（SwiftDtoa，最短且最近），
/// 再按 ECMA-262 §6.1.6.1.20 的版式规则排：k ≤ n ≤ 21 整数、0 < n ≤ 21 定点、−6 < n ≤ 0 前导「0.」、否则指数式。
public enum JSNumber {
    public static func toString(_ x: Double) -> String {
        if x.isNaN { return "NaN" }
        if x == 0 { return "0" } // 含 −0
        if x.isInfinite { return x < 0 ? "-Infinity" : "Infinity" }
        if x < 0 { return "-" + toString(-x) }
        let (digits, n) = shortest(x)
        let k = digits.count
        if k <= n && n <= 21 { return digits + String(repeating: "0", count: n - k) }
        if 0 < n && n <= 21 {
            let cut = digits.index(digits.startIndex, offsetBy: n)
            return String(digits[..<cut]) + "." + String(digits[cut...])
        }
        if -6 < n && n <= 0 { return "0." + String(repeating: "0", count: -n) + digits }
        let e = n - 1
        let sign = e < 0 ? "-" : "+"
        let head = String(digits.first!)
        let tail = k == 1 ? "" : "." + String(digits.dropFirst())
        return head + tail + "e" + sign + String(abs(e))
    }

    /// 正有限数 → (最短十进制有效数字串, n)，值 = 0.d1d2…dk × 10^n。
    static func shortest(_ x: Double) -> (String, Int) {
        let s = x.description // 例：「1e-07」「100000.0」「1.2345678901234568e+20」「5e-324」
        var mantissa = Substring(s)
        var exp = 0
        if let ei = s.firstIndex(where: { $0 == "e" || $0 == "E" }) {
            mantissa = s[..<ei]
            exp = Int(s[s.index(after: ei)...])!
        }
        var intPart = mantissa
        var frac: Substring = ""
        if let dot = mantissa.firstIndex(of: ".") {
            intPart = mantissa[..<dot]
            frac = mantissa[mantissa.index(after: dot)...]
        }
        var digits = Array(intPart + frac)
        var n = intPart.count + exp
        while let f = digits.first, f == "0" { digits.removeFirst(); n -= 1 }
        while let l = digits.last, l == "0" { digits.removeLast() }
        return (String(digits), n)
    }
}
