import Foundation

// 生成的配置与数据资源（Bundled/*.json，D84 起是手改的唯一真相源）。Swift 源码里没有任何规则数值与汉字字面量：
// 一律从这里读（计划 B3B4 §4.1；--check 守与 src/ 同步）。资源是 SwiftPM 资源（Bundle.module，目录 Bundled/：iOS 包内不能有名为 Resources 的子目录，否则签名失败）。

public enum CoreResources {
    private static let lock = NSLock()
    private static var cache: [String: JSValue] = [:]

    private static func url(_ name: String) throws -> URL {
        guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Bundled") else {
            throw CoreError.badRequest("missing resource " + name)
        }
        return url
    }

    /// 读并解析 Resources/<name>.json（解析结果缓存）。资源缺失或不是合法 JSON 时抛错。
    public static func load(_ name: String) throws -> JSValue {
        lock.lock()
        defer { lock.unlock() }
        if let hit = cache[name] { return hit }
        let text = String(decoding: try Data(contentsOf: try url(name)), as: UTF8.self)
        let value = try JSONParser.parse(text)
        cache[name] = value
        return value
    }
}

/// 生成的配置（只读）。读不到资源是打包错误，直接停（与读 Info.plist 同级）。
public enum Config {
    private static func get(_ name: String) -> JSValue {
        do { return try CoreResources.load(name) } catch { fatalError("ShiziCore resource \(name): \(error)") }
    }

    public static let policy: JSValue = get("policy")
    public static let policyMeta: JSValue = get("policy-meta")
    public static let motion: JSValue = get("motion")
    public static let charOrderData: JSValue = get("char-order")
    public static let epigraphsData: JSValue = get("epigraphs")
    public static let credits: JSValue = get("credits")
    public static let deckMeta: JSValue = get("deck-meta")
    public static let signature: JSValue = get("signature")
    /// FSRS 参数（FSRS_CONFIG；B4.2）。
    public static let fsrsConfig: JSValue = get("fsrs-config")
    /// 选字用的题库索引（全部卡键、四个字库的成员、缺省字库；B4.2）。
    public static let deckLibraries: JSValue = get("deck-libraries")

    /// 按名取配置（`config.get` op）：policy / policy-meta / motion / char-order / epigraphs / credits / deck-meta / signature / copy。
    public static func named(_ name: String) -> JSValue? {
        switch name {
        case "policy": return policy
        case "policy-meta": return policyMeta
        case "motion": return motion
        case "char-order": return charOrderData
        case "epigraphs": return epigraphsData
        case "credits": return credits
        case "deck-meta": return deckMeta
        case "signature": return signature
        case "copy": return copyData
        case "fsrs-config": return fsrsConfig
        case "deck-libraries": return deckLibraries
        default: return nil
        }
    }

    public static let configNames = ["policy", "policy-meta", "motion", "char-order", "epigraphs", "credits", "deck-meta", "signature", "copy", "fsrs-config", "deck-libraries"]

    // ---- policy 取值（路径用「.」分隔，如 "groupMix.valveDays"）----

    /// 沿路径取 policy 里的值；中途不是对象或键不存在返回 nil。
    public static func policyValue(_ path: String) -> JSValue? {
        var cur: JSValue? = policy
        for part in path.split(separator: ".", omittingEmptySubsequences: false) {
            guard let c = cur, let v = c[String(part)] else { return nil }
            cur = v
        }
        return cur
    }

    public static func policyNumber(_ path: String) -> Double? { policyValue(path)?.numberValue }
    public static func policyBool(_ path: String) -> Bool? { policyValue(path)?.boolValue }
    public static func policyString(_ path: String) -> String? { policyValue(path)?.stringValue }
}
