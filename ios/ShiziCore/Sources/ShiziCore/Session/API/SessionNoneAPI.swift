import Foundation

extension PageAPI {
    static func none(_ op: String, _ a: JSObject, hooks: SessionActionHooks?) throws -> JSValue {
        if op == "view.session-none" {
            return JS.obj([("ok", .bool(true)), ("view", SessionView.noneView(JSObject([("exhausted", .bool(JS.truthy(a["exhausted"]))), ("pick", .bool(hooks?.has("session.pick") == true)), ("wrongList", .bool(hooks?.has("session.wrongList") == true)), ("libSwitch", .bool(hooks?.has("session.libSwitch") == true))])))])
        }
        return try action(op, JSObject(), hooks: hooks)
    }
}
