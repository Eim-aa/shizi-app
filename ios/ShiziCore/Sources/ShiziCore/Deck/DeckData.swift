import Foundation

// 题库数据（deck.json：deck-data.js 的 SEED / GROUPS 与 data/context-overrides.js 的 CONTEXT_OVERRIDES，由 scripts/build_core_config.mjs 在构建期导出）。
// 这里只给原始数据（JSValue）；卡片构建（core/cards.js buildCards）在 B4.3。懒加载：约 2MB，首次访问才解析。

public final class DeckData {
    public let seed: [JSValue]
    public let overrides: JSObject
    public let groups: JSObject

    /// 题库身份键与指纹（src/config/deck-meta.js）。
    public static var key: String { Config.deckMeta["DECK_KEY"]?.stringValue ?? "" }
    public static var fingerprint: String { Config.deckMeta["DECK_FINGERPRINT"]?.stringValue ?? "" }

    public static let shared: DeckData = {
        do { return try DeckData(CoreResources.load("deck")) } catch { fatalError("ShiziCore deck.json: \(error)") }
    }()

    init(_ v: JSValue) {
        seed = v["seed"]?.arrayValue ?? []
        overrides = v["overrides"]?.objectValue ?? JSObject()
        groups = v["groups"]?.objectValue ?? JSObject()
    }
}
