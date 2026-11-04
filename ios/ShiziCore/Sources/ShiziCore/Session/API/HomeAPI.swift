import Foundation

// Home API. Action callbacks are owned by the navigation host.
extension PageAPI {
    static func home(_ op: String, _ store: Store, _ a: JSObject, hooks: SessionActionHooks? = nil) throws -> JSValue {
        if op == "view.home" { return JS.obj([("ok", .bool(true)), ("view", try HomeView.homeView(.object(store.state), now: store.now(), policy: Config.policy, deck: .real, ui: try? hooks?.invoke("home.ui", JSObject()), dates: store.dates))]) }
        if op == "home.expire" { return reply(try ScheduleRules(dates: store.dates).expireStale(store, now: store.now())) }
        return SessionWrites.failure("unavailable")
    }
}
