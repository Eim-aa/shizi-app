import Foundation

// Query API: pure state actions and models. Navigation hooks stay with host.
extension PageAPI {
    static func queryLines(_ kind: String, _ text: String, _ hooks: SessionActionHooks?) throws -> JSValue? {
        guard !text.isEmpty, let fn = hooks?.queryLayout[kind] else { return nil }
        let value = try fn(text);return !(value.arrayValue ?? []).isEmpty ? value : nil
    }
    static func query(_ op: String, _ store: Store, _ a: JSObject, hooks: SessionActionHooks? = nil) throws -> JSValue {
        switch op {
        case "query.add":
            guard let char = a["char"]?.stringValue, !char.isEmpty else { return SessionWrites.failure("invalid") }
            return reply(QueryView.commitAdd(store, char: .string(char)))
        case "view.query":
            var args = JSObject([("mode", .string(a["mode"] == .string("pick") ? "pick" : "lookup")), ("text", .string(a["text"]?.stringValue ?? "")), ("cur", .string(a["cur"]?.stringValue ?? "")), ("selected", .array(a["selected"]?.arrayValue ?? [])), ("state", .object(store.state))])
            args["policy"] = Config.policy
            var view = try QueryView.querySheetModel(args, dates: store.dates)
            if let card = view["card"], JS.truthy(card) {
                var next = card.objectValue ?? JSObject()
                if let lines = try queryLines("cardAction", Copy.text(JS.truthy(card["custom"]) ? "R-Q05.alreadyAdded" : "R-Q05.btnAdd"), hooks) { next["addLines"] = lines }
                if let lines = try queryLines("cardAction", Copy.text("R-Q05.viewRecords"), hooks) { next["detailLines"] = lines }
                view = SessionWrites.patch(view,[("card",.object(next))])
            }
            return JS.obj([("ok", .bool(true)), ("view", view)])
        case "view.s02":
            let chars = (a["chars"]?.arrayValue ?? []).filter { $0.stringValue != nil }, quoted = chars.map { "「" + JS.string($0) + "」" }.joined()
            var view = JSObject([("chars", .array(chars))])
            for (name,key) in [("body","R-H05.body"),("fail","X-SESSION.s02SaveFailed"),("continue","R-H05.continueOld"),("endStart","R-H05.endOldStartNew"),("cancel","R-H05.cancel"),("failCancel","X-SESSION.s02Cancel"),("retry","X-SESSION.s02Retry")] {
                view[name] = JS.obj([("key", .string(key)), ("vars", name == "body" ? JS.obj([("chars", .string(quoted))]) : .object(JSObject()))])
            }
            if let lines = try queryLines("s02Body", Copy.text("R-H05.body", JSObject([("chars",.string(quoted))])), hooks) { view["bodyLines"] = lines }
            return JS.obj([("ok", .bool(true)), ("view", .object(view))])
        case "query.detail":
            guard let char = a["char"]?.stringValue, !char.isEmpty else { return SessionWrites.failure("invalid") }
            guard let callback = hooks?.queryDetail else { return SessionWrites.failure("unavailable") }
            let r = try callback(char, QueryActionContext(mode: "lookup", close: {}))
            return r["ok"] == .bool(false) ? SessionWrites.failure("generic") : JS.obj([("ok", .bool(true))])
        case "query.pick":
            let chars = (a["chars"]?.arrayValue ?? []).compactMap(\.stringValue)
            if chars.isEmpty { return SessionWrites.failure("invalid") }
            guard let hooks else { return SessionWrites.failure("unavailable") }
            var closed = false
            let context = QueryActionContext(mode: chars.count > 1 || a["from"] == .string("bar") ? "pick" : (hooks.queryMode.isEmpty ? "lookup" : hooks.queryMode)) { if !closed { closed = true; try hooks.queryClose?() } }
            let result: JSValue?
            if a["from"] == .string("card"), let callback = hooks.queryPractice { result = try callback(chars[0], context) }
                else if let callback = hooks.queryPick { result = try callback(chars, context) }
                else { return SessionWrites.failure("unavailable") }
            if result?["ok"] == .bool(false) { return SessionWrites.failure("generic") }
            return JS.obj([("ok", .bool(true)), ("close", .bool(closed && hooks.queryClose == nil))])
        case "s02.decide":
            guard let hooks, hooks.hasS02Actions else { return SessionWrites.failure("unavailable") }
            switch a["action"] {
            case .string("continue"):
                guard let callback = hooks.s02Continue else { return SessionWrites.failure("unavailable") }
                try hooks.s02Close?(); try callback(); return JS.obj([("ok", .bool(true)), ("close", .bool(hooks.s02Close == nil))])
            case .string("cancel"): try hooks.s02Cancel?(); return JS.obj([("ok", .bool(true)), ("close", .bool(true))])
            case .string("endStart"):
                guard let callback = hooks.s02EndStart else { return SessionWrites.failure("unavailable") }
                guard let result = try callback(), result["ok"] != .bool(false), JS.truthy(result) else { return SessionWrites.failure("generic") }
                try hooks.s02Close?(); try hooks.s02Started?(result); return JS.obj([("ok", .bool(true)), ("close", .bool(hooks.s02Close == nil))])
            default: return SessionWrites.failure("invalid")
            }
        default: return SessionWrites.failure("unknown-op")
        }
    }
}
