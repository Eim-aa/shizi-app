import Foundation

// 移植自原 JS 版：首页题记（上句、下句、出处），数据来自生成的 epigraphs.json；
// 轮换按日「一年中第几天 mod 条数」（P23）。

public struct Epigraph: Equatable {
    public let lines: [String]
    public let source: String
}

public enum Epigraphs {
    public static let all: [Epigraph] = (Config.epigraphsData.arrayValue ?? []).map { e in
        Epigraph(lines: (e["lines"]?.arrayValue ?? []).compactMap { $0.stringValue }, source: e["source"]?.stringValue ?? "")
    }

    /// 出处里只写作者名（书名号之前的部分）：`source.indexOf('《')`（i > 0 才截）后 trim。
    /// 书名号是 JS 源里的汉字字面量；Swift 里用其码点 U+300A。
    public static func author(of epigraph: Epigraph?) -> String {
        let source = epigraph?.source ?? ""
        let mark: Unicode.Scalar = "\u{300A}"
        var cut = source.unicodeScalars.startIndex
        var index = 0
        var found: Int?
        for s in source.unicodeScalars {
            if s == mark { found = index; break }
            index += s.utf16.count
            cut = source.unicodeScalars.index(after: cut)
        }
        let head: String
        if let f = found, f > 0 {
            head = String(String.UnicodeScalarView(source.unicodeScalars[source.unicodeScalars.startIndex..<cut]))
        } else {
            head = source
        }
        return jsTrim(head)
    }

    /// JS String.prototype.trim：空白 = WhiteSpace + LineTerminator（含 U+FEFF、U+00A0、U+2028/2029 等）。
    static func jsTrim(_ s: String) -> String {
        func isWS(_ u: Unicode.Scalar) -> Bool {
            switch u.value {
            case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
            case 0x2000...0x200A: return true
            default: return false
            }
        }
        var scalars = Array(s.unicodeScalars)
        while let l = scalars.last, isWS(l) { scalars.removeLast() }
        var start = 0
        while start < scalars.count, isWS(scalars[start]) { start += 1 }
        var out = String.UnicodeScalarView()
        out.append(contentsOf: scalars[start...])
        return String(out)
    }

    /// 某日（YYYY-MM-DD）显示哪一条题记的下标（P23：dayOfYear % 条数）。日键不合法抛 RangeError（同 dates.dayOfYear）。
    public static func indexFor(day: JSValue, dates: Dates) throws -> Double {
        let doy = try dates.dayOfYear(day)
        return fmod(doy, Double(all.count))
    }

    public static func epigraph(for day: JSValue, dates: Dates) throws -> Epigraph {
        let i = try indexFor(day: day, dates: dates)
        guard i.isFinite, i >= 0, Int(i) < all.count else { throw CoreError.type("no epigraph") }
        return all[Int(i)]
    }
}
