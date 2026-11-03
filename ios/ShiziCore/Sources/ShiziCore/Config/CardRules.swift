import Foundation

// B4.3 的两份生成数据（Bundled/card-rules.json / unicode-scripts.json，D84 起手改）：
// 卡片规则（题面字串、四库规则表、buildCards 缺省值）与 JS 正则 \p{Script=…} 的码点区间。Swift 源码里没有汉字字面量，一律读这里。

public enum CardRules {
    static let data: JSValue = { do { return try CoreResources.load("card-rules") } catch { fatalError("ShiziCore card-rules.json: \(error)") } }()

    /// 题面字串（PROMPT_COPY）。
    public static let promptCopy: JSObject = data["promptCopy"]?.objectValue ?? JSObject()
    /// buildCards 的缺省值（CARD_DEFAULTS，键序即卡片 meta 字段序）。
    public static let defaults: JSObject = data["defaults"]?.objectValue ?? JSObject()

    public struct Library {
        public let id: String
        public let label: String
        public let officialTotal: Double
        let field: String
        let value: String
        /// 卡片是否属于这个库（`card[field] === value`）。
        public func test(_ card: JSValue) -> Bool { JSX.eq(card[field], value) }
    }

    public static let libraries: [Library] = (data["libraries"]?.arrayValue ?? []).map {
        Library(id: $0.str("id") ?? "", label: $0.str("label") ?? "", officialTotal: $0["officialTotal"]?.numberValue ?? 0,
                field: $0.str("field") ?? "", value: $0.str("value") ?? "")
    }
}

public enum UnicodeScripts {
    static let data: JSValue = { do { return try CoreResources.load("unicode-scripts") } catch { fatalError("ShiziCore unicode-scripts.json: \(error)") } }()

    static func table(_ name: String) -> [(UInt32, UInt32)] {
        (data[name]?.arrayValue ?? []).compactMap { r in
            guard let a = r.arrayValue, a.count == 2, let lo = a[0].numberValue, let hi = a[1].numberValue else { return nil }
            return (UInt32(lo), UInt32(hi))
        }
    }

    static let han = table("han")
    static let latin = table("latin")

    static func contains(_ ranges: [(UInt32, UInt32)], _ v: UInt32) -> Bool {
        var lo = 0, hi = ranges.count - 1
        while lo <= hi {
            let mid = (lo + hi) / 2
            if v < ranges[mid].0 { hi = mid - 1 } else if v > ranges[mid].1 { lo = mid + 1 } else { return true }
        }
        return false
    }

    /// `\p{Script=Han}`
    public static func isHan(_ u: Unicode.Scalar) -> Bool { contains(han, u.value) }
    /// `\p{Script=Latin}`
    public static func isLatin(_ u: Unicode.Scalar) -> Bool { contains(latin, u.value) }
}
