import Foundation

extension PageAPI {
    /// src/session/api/index.js createChangeFeed. No dirty domains means no message.
    /// An observer exception cannot affect the transaction or other subscribers.
    public static func createChangeFeed(store: Store?, post: ((JSValue) throws -> Void)?) -> () -> Void {
        guard let store, let post else { return {} }
        return store.subscribe { _, info in
            let domains = domainsOf(.object(info))
            if domains.isEmpty { return }
            let packet = JS.obj([("domains",.array(domains.map(JSValue.string))),("label",JS.truthy(info["label"]) ? .string(JS.string(info["label"])) : .null)])
            do { try post(packet) } catch { /* Push failures do not undo a successful commit. */ }
        }
    }
}

extension SessionRuntime {
    public func changed(_ post: @escaping (JSValue) throws -> Void) -> () -> Void { PageAPI.createChangeFeed(store: store, post: post) }
}
