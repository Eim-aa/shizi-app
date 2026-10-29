import Foundation

/// src/session/text-lines.js. Renderer measurements are injected; absent/invalid/throwing
/// providers return null. No attempt is made to guess DOM/font line breaks.
public final class SessionTextLines {
    public static let shared = SessionTextLines()
    public typealias Provider = (String, JSValue?) throws -> JSValue
    private var registry: [String:(UUID,Provider)] = [:]
    public init() {}
    @discardableResult public func register(_ key: String, _ provider: @escaping Provider) -> () -> Void {
        let token = UUID(); registry[key] = (token,provider)
        return { [weak self] in if self?.registry[key]?.0 == token { self?.registry[key] = nil } }
    }
    public func starts(_ key: String, text: JSValue?, extra: JSValue? = nil) -> JSValue {
        guard let text = text?.stringValue, !text.isEmpty, let provider = registry[key]?.1, let result = try? provider(text, extra), let rows = result.arrayValue else { return .null }
        let n = Double(text.unicodeScalars.count)
        return .array(rows.filter { SessionWrites.integer($0) && JS.number($0) > 0 && JS.number($0) < n })
    }
    func ref(_ key: String, _ value: JSValue?, extra: JSValue? = nil) -> JSValue {
        starts(key, text: value.flatMap { try? Copy.tRef($0) }, extra: extra)
    }
}
