import Foundation

// src/session/api/query.js: pure state actions and models. Navigation hooks stay with host.
extension PageAPI {
    static func query(_ op: String, _ store: Store, _ a: JSObject) throws -> JSValue {
        switch op {
        case "query.add":
            guard let char = a["char"]?.stringValue, !char.isEmpty else { return SessionWrites.failure("invalid") }
            return reply(QueryView.commitAdd(store, char: .string(char)))
        case "view.query":
            var args = JSObject([("mode", .string(a["mode"] == .string("pick") ? "pick" : "lookup")), ("text", .string(a["text"]?.stringValue ?? "")), ("cur", .string(a["cur"]?.stringValue ?? "")), ("selected", .array(a["selected"]?.arrayValue ?? [])), ("state", .object(store.state))])
            args["policy"] = Config.policy
            return JS.obj([("ok", .bool(true)), ("view", try QueryView.querySheetModel(args, dates: store.dates))])
        case "view.s02":
            let chars = (a["chars"]?.arrayValue ?? []).filter { $0.stringValue != nil }, quoted = chars.map { "「" + JS.string($0) + "」" }.joined()
            var view = JSObject([("chars", .array(chars))])
            for (name,key) in [("body","R-H05.body"),("fail","X-SESSION.s02SaveFailed"),("continue","R-H05.continueOld"),("endStart","R-H05.endOldStartNew"),("cancel","R-H05.cancel"),("failCancel","X-SESSION.s02Cancel"),("retry","X-SESSION.s02Retry")] {
                view[name] = JS.obj([("key", .string(key)), ("vars", name == "body" ? JS.obj([("chars", .string(quoted))]) : .object(JSObject()))])
            }; return JS.obj([("ok", .bool(true)), ("view", .object(view))])
        case "query.detail": return (a["char"]?.stringValue ?? "").isEmpty ? SessionWrites.failure("invalid") : SessionWrites.failure("unavailable")
        case "query.pick": return (a["chars"]?.arrayValue ?? []).contains(where: { $0.stringValue != nil }) ? SessionWrites.failure("unavailable") : SessionWrites.failure("invalid")
        case "s02.decide": return SessionWrites.failure("unavailable")
        default: return SessionWrites.failure("unknown-op")
        }
    }
}
