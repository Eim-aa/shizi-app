import Foundation

extension CoreEngine {
    static func apiHost(_ store: Store, _ a: JSObject) -> JSValue {
        let hooks = SessionActionHooks(),op = JS.string(a["op"]);var calls: [JSValue] = []
        hooks.set(op) { args in
            calls.append(.object(args))
            if a["throws"] == .bool(true) { throw CoreError.error("host-action") }
            return a["reply"] ?? .null
        }
        return JS.obj([("reply",PageAPI.call(op,store:store,args:a["args"]?.objectValue ?? JSObject(),hooks:hooks)),("calls",.array(calls))])
    }
}
