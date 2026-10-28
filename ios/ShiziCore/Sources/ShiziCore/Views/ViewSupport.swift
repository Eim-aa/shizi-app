import Foundation

// Shared JS-shaped construction; copy remains a reference, never rendered text.
enum ViewSupport {
    static func obj(_ pairs: [(String, JSValue)]) -> JSValue { .object(JSObject(pairs)) }
    static func ref(_ key: String, _ params: JSValue? = nil) -> JSValue {
        var out = JSObject([("copy", .string(key))])
        if let params { out["params"] = params }
        return .object(out)
    }
    static func policy(_ override: JSValue?) -> JSValue {
        var out = Config.policy.objectValue!
        for (k, v) in override?.objectValue?.entries ?? [] { out[k] = v }
        return .object(out)
    }
    // ECMAScript whitespace, including BOM (Foundation trimming differs).
    static let whitespace = CharacterSet(charactersIn: "\u{9}\u{a}\u{b}\u{c}\u{d}\u{20}\u{a0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}")
    static func trimEnd(_ s: String) -> String {
        var chars = s.unicodeScalars
        while let last = chars.last, whitespace.contains(last) { chars.removeLast() }
        return String(chars)
    }
}
