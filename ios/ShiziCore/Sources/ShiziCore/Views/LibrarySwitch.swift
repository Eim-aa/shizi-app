import Foundation

public enum LibrarySwitchView {
    public static func libraryNameRef(_ id: JSValue?) -> JSValue { ViewSupport.ref("R-L06.lib." + JS.string(id) + ".name") }
    public static func libraryDescRef(_ id: JSValue?) -> JSValue { ViewSupport.ref("R-L06.lib." + JS.string(id) + ".desc") }
    public static func judgedChars(_ state: JSValue?) -> KeySet {
        var out = KeySet()
        for r in Query.flattenRecords(state?["records"]) where Records.isJudged(r) {
            if let c = r["char"]?.stringValue, !c.isEmpty { out.insert(c) }
        }
        return out
    }
    public static func libraryRows(_ state: JSValue?, libraries: JSValue? = nil, current: JSValue? = nil) -> JSValue {
        let selected = current ?? DeckIndex.shared.currentLibraryId(state?["settings"])
        let chars = judgedChars(state)
        // 说明句「来源」的折行点（渲染器量；没注入 = null）
        let sourceStarts = ViewLineStarts.starts("library-switch-source", ViewSupport.ref("R-L06.sourceNote"))
        return .array(DeckIndex.shared.libraries.map { lib in
            let keys: [String]
            if let libraries { keys = (libraries[lib.id]?["keys"]?.arrayValue ?? []).map { JS.string($0) } }
            else { keys = lib.keys }
            let keySet = KeySet(keys)
            let recorded = chars.filter { keySet.contains("base:" + $0) }.count
            return ViewSupport.obj([("id", .string(lib.id)), ("sourceStarts", sourceStarts), ("name", libraryNameRef(.string(lib.id))), ("desc", libraryDescRef(.string(lib.id))), ("total", .number(Double(keys.count))), ("recorded", .number(Double(recorded))), ("current", .bool(selected == .string(lib.id))), ("countLine", ViewSupport.ref("R-L06.countLine", ViewSupport.obj([("n", .number(Double(keys.count))), ("m", .number(Double(recorded)))])))])
        })
    }
}
