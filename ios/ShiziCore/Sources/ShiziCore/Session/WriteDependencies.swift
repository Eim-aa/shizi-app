import Foundation

/// Host functions supplied to createWriteSessionApi / createResultOps in JS.
/// Values and callback return values are preserved; only seal errors are swallowed.
public final class WriteDependencies {
    public var resultView: ((Store, JSObject) throws -> JSValue)?
    public var seal: ((String) throws -> Void)?
    public var toWrite: ((String) throws -> Void)?
    public var again: ((JSValue) throws -> Void)?
    public var leave: ((JSValue) throws -> Void)?
    public var redo: (([JSValue]) throws -> JSValue)?
    public var detail: ((String) throws -> JSValue)?
    public var share: ((JSObject) throws -> JSValue)?
    public var reminderInvite: ((Store, JSObject) async throws -> JSValue)?
    public var reminderChangeTime: ((Store, JSObject) async throws -> JSValue)?
    public var reminderWaitMs: Double = 120000
    public var groups: JSValue?
    public var colors: (() throws -> JSValue)?
    public var type: (() throws -> JSValue)?
    public var theme: (() throws -> JSValue)?
    public var refLabel: ((JSObject) throws -> JSValue)?
    public var refLabelAsync: ((JSObject) async throws -> JSValue)?
    public var navigate: [String: ([JSValue]) throws -> JSValue]?
    public init() {}
}
