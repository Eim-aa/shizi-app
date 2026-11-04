import Foundation

/// Judge-op ink memory: page lifetime cache, insertion order, eight records.
/// Recalling never promotes a record; remembering an existing id promotes it.
public final class RecentInk {
    public static let page = RecentInk()
    private var entries: [(JSValue, JSValue)] = []
    public init() {}
    public func rememberInk(_ recordId: JSValue?, _ strokes: JSValue?) {
        guard JS.truthy(recordId), let strokes, (strokes.arrayValue ?? []).contains(where: { !($0.arrayValue ?? []).isEmpty }) else { return }
        entries.removeAll { $0.0 == recordId }
        entries.append((recordId!, strokes))
        if entries.count > 8 { entries.removeFirst() }
    }
    public func recalledInk(_ recordId: JSValue?, policy: JSValue? = Config.policy) -> JSValue {
        if policy?["features"]?["perRecordInk"] == .bool(true) { return .null }
        return entries.first { $0.0 == recordId }?.1 ?? .null
    }
    @discardableResult public func forgetRecentInk() -> Int {
        let n = entries.count; entries.removeAll(); return n
    }
}
