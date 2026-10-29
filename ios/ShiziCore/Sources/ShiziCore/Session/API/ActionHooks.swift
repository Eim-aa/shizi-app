import Foundation

/// Counterpart of the API modules' set*Actions/set*Hooks registrations.
/// The host supplies navigation, renderer and platform callbacks; the core owns Store writes.
public final class SessionActionHooks {
    public typealias Action = (JSObject) throws -> JSValue
    private var asyncActions: [String: (JSObject) async throws -> JSValue] = [:]
    public func setAsync(_ name: String, _ action: ((JSObject) async throws -> JSValue)?) { asyncActions[name] = action }
    func invokeAsync(_ name: String, _ args: JSObject) async throws -> JSValue? { try await asyncActions[name]?(args) }
    func hasAsync(_ name: String) -> Bool { asyncActions[name] != nil }
    private var actions: [String: Action] = [:]
    public var queryMode = "lookup"
    public var queryClose: (() -> Void)?
    public var queryPractice: ((String, QueryActionContext) throws -> JSValue)?
    public var queryPick: (([String], QueryActionContext) throws -> JSValue)?
    public var queryDetail: ((String, QueryActionContext) throws -> JSValue)?
    public var s02Registered = false
    public var hasS02Actions: Bool { s02Registered || s02Continue != nil || s02Cancel != nil || s02Close != nil || s02EndStart != nil || s02Started != nil }
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
