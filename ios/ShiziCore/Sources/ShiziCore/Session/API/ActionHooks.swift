import Foundation

/// Counterpart of the API modules' set*Actions/set*Hooks registrations.
/// The host supplies navigation, renderer and platform callbacks; the core owns Store writes.
public final class SessionActionHooks {
    public typealias Action = (JSObject) throws -> JSValue
    private var actions: [String: Action] = [:]
    public var queryMode = "lookup"
    public var queryClose: (() -> Void)?
    public var queryPractice: ((String, QueryActionContext) throws -> JSValue)?
    public var queryPick: (([String], QueryActionContext) throws -> JSValue)?
    public var queryDetail: ((String, QueryActionContext) throws -> JSValue)?
    public var s02Continue: (() -> Void)?
    public var s02Cancel: (() -> Void)?
    public var s02Close: (() -> Void)?
    public var s02EndStart: (() throws -> JSValue?)?
    public var s02Started: ((JSValue) -> Void)?
    public init() {}
    public func set(_ name: String, _ action: Action?) { actions[name] = action }
    public func has(_ name: String) -> Bool { actions[name] != nil }
    func invoke(_ name: String, _ args: JSObject) throws -> JSValue? { try actions[name]?(args) }
}

extension PageAPI {
    static func action(_ op: String, _ a: JSObject, hooks: SessionActionHooks?, opened: Bool = false) throws -> JSValue {
        guard let r = try hooks?.invoke(op, a) else { return SessionWrites.failure("unavailable") }
        if r["ok"] == .bool(false) { return reply(r) }
        var out = JSObject([("ok", .bool(true))]); if opened, let s = r["opened"]?.stringValue { out["opened"] = .string(s) }; return .object(out)
    }
}

public final class QueryActionContext {
    public let mode: String
    public let close: () -> Void
    init(mode: String, close: @escaping () -> Void) { self.mode = mode; self.close = close }
}
