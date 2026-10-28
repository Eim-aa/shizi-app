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
