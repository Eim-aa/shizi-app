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
    public init() {}
}
