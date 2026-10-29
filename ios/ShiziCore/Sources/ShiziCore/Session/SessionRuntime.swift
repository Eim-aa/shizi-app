import Foundation

/// Store-backed session entry point for a future SwiftEngine; it does not wire the app.
/// Set the process math flavor once before calls: iOS compares with JSC (Darwin),
/// while the CLI and golden/differential tests compare with Node (V8).
public final class SessionRuntime {
    public let store: Store
    public let hooks: SessionActionHooks
    public init(store: Store, mathFlavor: JSMath.Flavor = .darwin, hooks: SessionActionHooks = SessionActionHooks()) {
        self.store = store
        self.hooks = hooks
        JSMath.flavor = mathFlavor
    }
    public func call(_ op: String, _ args: JSObject = JSObject()) -> JSValue {
        if op.hasPrefix("write.") { return WriteAPI.call(String(op.dropFirst(6)), store, args) }
        return PageAPI.call(op, store: store, args: args, hooks: hooks)
    }
}
