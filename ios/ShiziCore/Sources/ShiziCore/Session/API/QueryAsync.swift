import Foundation

extension PageAPI {
    static func queryAsync(_ op: String, _ store: Store, _ a: JSObject, hooks: SessionActionHooks?) async throws -> JSValue {
        guard let hooks else { return try query(op, store, a) }
        if op == "query.detail", let callback = hooks.queryDetailAsync {
            guard let char = a["char"]?.stringValue, !char.isEmpty else { return SessionWrites.failure("invalid") }
            let r: JSValue
            do { r = try await callback(char, QueryActionContext(mode:"",close:{})) } catch { return SessionWrites.failure("generic") }
            return r["ok"] == .bool(false) ? SessionWrites.failure("generic") : JS.obj([("ok",.bool(true))])
        }
        if op == "query.pick", hooks.queryPickAsync != nil || hooks.queryPracticeAsync != nil {
            let chars = (a["chars"]?.arrayValue ?? []).compactMap(\.stringValue)
            if chars.isEmpty { return SessionWrites.failure("invalid") }
            var closed = false
            let context = QueryActionContext(mode: chars.count > 1 || a["from"] == .string("bar") ? "pick" : hooks.queryMode) { if !closed { closed = true; try hooks.queryClose?() } }
            let result: JSValue
            if a["from"] == .string("card"), let callback = hooks.queryPracticeAsync {
                do { result = try await callback(chars[0],context) } catch { return SessionWrites.failure("generic") }
            } else if a["from"] == .string("card"), let callback = hooks.queryPractice { result = try callback(chars[0],context) }
            else if let callback = hooks.queryPickAsync {
                do { result = try await callback(chars,context) } catch { return SessionWrites.failure("generic") }
            } else if let callback = hooks.queryPick { result = try callback(chars,context) }
            else { return SessionWrites.failure("unavailable") }
            if result["ok"] == .bool(false) { return SessionWrites.failure("generic") }
            return JS.obj([("ok",.bool(true)),("close",.bool(closed && hooks.queryClose == nil))])
        }
        if op == "s02.decide", a["action"] == .string("endStart"), let callback = hooks.s02EndStartAsync {
            guard let r = try await callback(), JS.truthy(r), r["ok"] != .bool(false) else { return SessionWrites.failure("generic") }
            try hooks.s02Close?();try hooks.s02Started?(r)
            return JS.obj([("ok",.bool(true)),("close",.bool(hooks.s02Close == nil))])
        }
        return try query(op,store,a,hooks:hooks)
    }
}
