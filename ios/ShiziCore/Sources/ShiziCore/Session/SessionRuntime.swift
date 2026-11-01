import Foundation

/// Store-backed session entry point for a future SwiftEngine; it does not wire the app.
/// Set the process math flavor once before calls: iOS compares with JSC (Darwin),
/// while the CLI and golden/differential tests compare with Node (V8).
public final class SessionRuntime {
    public let store: Store
    public let writeDependencies: WriteDependencies
    public let hooks: SessionActionHooks
    public init(store: Store, mathFlavor: JSMath.Flavor = .darwin, hooks: SessionActionHooks = SessionActionHooks(), writeDependencies: WriteDependencies = WriteDependencies()) {
        self.store = store
        self.writeDependencies = writeDependencies
        self.hooks = hooks
        JSMath.flavor = mathFlavor
    }
    nonisolated(nonsending) public func callAsync(_ op: String, _ args: JSObject = JSObject()) async -> JSValue {
        if op.hasPrefix("write.") {
            let restore = installMeasurement(); defer { restore() }
            return await WriteAPI.callAsync(String(op.dropFirst(6)), store, args, dependencies: writeDependencies)
        }
        return await PageAPI.callAsync(op, store: store, args: args, hooks: hooks)
    }
    public func call(_ op: String, _ args: JSObject = JSObject()) -> JSValue {
        if op.hasPrefix("write.") {
            let restore = installMeasurement(); defer { restore() }
            return WriteAPI.call(String(op.dropFirst(6)), store, args, dependencies: writeDependencies)
        }
        return PageAPI.call(op, store: store, args: args, hooks: hooks)
    }
    /// The renderer's measurement (line starts) for the write/result session too, as PageAPI.call installs it for page ops
    /// (result page lines: title / sub / preview / inviteBody). Without a host measurer they stay null, as in the CLI.
    private func installMeasurement() -> () -> Void {
        let oldBreaker = ViewLineStarts.provider, oldMeasurement = ViewMeasurement.provider
        if let provider = hooks.measurer { ViewMeasurement.provider = provider }
        if let provider = hooks.lineBreaker { ViewLineStarts.provider = provider }
        return { ViewLineStarts.provider = oldBreaker; ViewMeasurement.provider = oldMeasurement }
    }
}
