import Foundation

// src/config/char-order.js（CHAR_ORDER，由 scripts/build_char_order.mjs 生成）的类型化读取；数据来自生成的 char-order.json。
// 排序与特别组的规则（core/new-order.js）在 B4.2 用这里的数据。

public struct CapitalContext: Equatable {
    public let word: String
    public let ci: Int
    public let py: String
    public let promptHint: String
}

public struct CharOrder {
    public let status: String
    public let commonRankMax: Int
    public let inputs: [(String, String)]
    /// 默认新字顺序（易忘度；已剔除 reserved）。
    public let order: [String]
    public let level2: [String]
    public let warmup: [String]
    public let surnames: [String]
    public let places: [String]
    public let capitalNumerals: [String]
    public let heavy: [String]
    public let surnameOnly: [String]
    public let commonKeptSurnames: [String]
    public let commonKeptPlaces: [String]
    public let capitalGroups: [[String]]
    public let capitalAfter: [String]
    /// 大写数字特别组的题面语境（键 = 字）。
    public let capitalContexts: [(char: String, context: CapitalContext)]

    public static let shared = CharOrder(Config.charOrderData)

    public func capitalContext(of char: String) -> CapitalContext? {
        capitalContexts.first { $0.char.utf8.elementsEqual(char.utf8) }?.context
    }

    init(_ v: JSValue) {
        func strings(_ x: JSValue?) -> [String] { (x?.arrayValue ?? []).compactMap { $0.stringValue } }
        let meta = v["meta"]
        status = meta?["status"]?.stringValue ?? ""
        commonRankMax = Int(meta?["commonRankMax"]?.numberValue ?? 0)
        inputs = (meta?["inputs"]?.objectValue?.entries ?? []).map { ($0.key, $0.value.stringValue ?? "") }
        order = strings(v["order"])
        level2 = strings(v["level2"])
        warmup = strings(v["warmup"])
        let reserved = v["reserved"]
        surnames = strings(reserved?["surnames"])
        places = strings(reserved?["places"])
        capitalNumerals = strings(reserved?["capitalNumerals"])
        heavy = strings(reserved?["heavy"])
        surnameOnly = strings(v["surnameOnly"])
        commonKeptSurnames = strings(v["commonKept"]?["surnames"])
        commonKeptPlaces = strings(v["commonKept"]?["places"])
        let capital = v["capital"]
        capitalGroups = (capital?["groups"]?.arrayValue ?? []).map { strings($0) }
        capitalAfter = strings(capital?["after"])
        capitalContexts = (capital?["contexts"]?.objectValue?.entries ?? []).map { e in
            (e.key, CapitalContext(
                word: e.value["word"]?.stringValue ?? "",
                ci: Int(e.value["ci"]?.numberValue ?? 0),
                py: e.value["py"]?.stringValue ?? "",
                promptHint: e.value["promptHint"]?.stringValue ?? ""
            ))
        }
    }
}
