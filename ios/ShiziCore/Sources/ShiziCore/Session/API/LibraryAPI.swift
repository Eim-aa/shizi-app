import Foundation

// Library API. Injected navigation actions are a host boundary.
extension PageAPI {
    static func library(_ op: String, _ store: Store, _ a: JSObject, hooks: SessionActionHooks? = nil) throws -> JSValue {
        if op == "view.library" { return JS.obj([("ok", .bool(true)), ("view", try LibraryView.libraryPageView(.object(store.state), now: store.now(), today: store.dates.localDay(.number(store.now())), deck: .real, policy: Config.policy, ui: try? hooks?.invoke("library.ui", JSObject()), dates: store.dates))]) }
        return SessionWrites.failure("unavailable")
    }
}
