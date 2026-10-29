import Foundation

// src/session/views/lines.js. Measurement is injected per instance, with no DOM dependency.
public final class ViewLines {
    private var measurer: ((JSValue) throws -> JSValue)?
    public init() {}
    public func setLineMeasurer(_ fn: ((JSValue) throws -> JSValue)?) { measurer = fn }
    public func measureLines(_ spec: JSValue) -> JSValue {
        guard let fn = measurer, let r = try? fn(spec), r.arrayValue != nil else { return .null }
        return r
    }
}

// src/core/line-starts.js: the pure registration / result contract. Actual text
// measurement is injected by the renderer, exactly as it is in the JS module.
enum ViewLineStarts {
    static var provider: ((String, String) throws -> JSValue)?
    static func starts(_ kind: String, _ text: JSValue) -> JSValue {
        guard let provider, let rendered = try? Copy.tRef(text), JS.truthy(rendered) else { return .null }
        guard let r = try? provider(kind, JS.string(rendered)), r.arrayValue != nil else { return .null }; return r
    }
}
