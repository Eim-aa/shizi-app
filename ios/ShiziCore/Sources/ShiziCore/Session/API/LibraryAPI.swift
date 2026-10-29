import Foundation

// src/session/api/library.js. Injected navigation actions are a host boundary.
extension PageAPI {
    static func library(_ op: String, _ store: Store, _ a: JSObject) throws -> JSValue {
        if op == "view.library" { return JS.obj([("ok", .bool(true)), ("view", try LibraryView.libraryPageView(.object(store.state), now: store.now(), today: store.dates.localDay(.number(store.now())), deck: .real, policy: Config.policy, ui: nil, dates: store.dates))]) }
        return SessionWrites.failure("unavailable")
    }
}
