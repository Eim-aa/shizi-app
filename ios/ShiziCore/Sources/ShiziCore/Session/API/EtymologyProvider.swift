import Foundation

/// src/data/etymology.js: one in-flight read; successful tables cache, failed reads retry.
public final class EtymologyProvider {
    public var loadRows: (() async throws -> JSValue?)?
    private var table: JSObject?
    private var pending: Task<JSValue?, Never>?
    public init(loadRows: (() async throws -> JSValue?)? = nil) { self.loadRows = loadRows }
    public func etymologyOf(_ char: String) -> JSValue? { table?[char] }
    public var ready: Bool { table != nil }
    public func load() async -> JSValue? {
        if let table { return .object(table) }
        if let pending { return await pending.value }
        guard let loadRows else { return nil }
        let task = Task { [self] () -> JSValue? in
            do {
                guard let rows = try await loadRows()?.arrayValue else { return nil }
                var map = JSObject()
                for r in rows { if let c = r["char"]?.stringValue, let gloss = r["gloss"]?.stringValue, !gloss.isEmpty { map[c] = JS.obj([("gloss",.string(gloss)),("source",r["source"]?.stringValue.map(JSValue.string) ?? .string(""))]) } }
                table = map;return .object(map)
            } catch { return nil }
        }
        pending = task;let result = await task.value;pending = nil;return result
    }
}
