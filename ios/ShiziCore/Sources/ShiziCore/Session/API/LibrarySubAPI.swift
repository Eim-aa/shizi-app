import Foundation

// Library sub-page API. Renderer measurements default to null, as in JS.
extension PageAPI {
    static func librarySub(_ op: String, _ store: Store, _ a: JSObject, hooks: SessionActionHooks? = nil) throws -> JSValue {
        let state = JSValue.object(store.state), today = try store.dates.localDay(.number(store.now()))
        if op == "view.library-switch" { return JS.obj([("ok", .bool(true)), ("view", LibrarySwitchView.libraryRows(state))]) }
        if op == "view.library-list" || op == "view.library-all" {
            var args = a; args["today"] = .string(today)
            let view: JSValue
            if op == "view.library-list" { view = try LibraryListView.listModel(state, args, dates: store.dates) }
            else {
                args["compact"] = .bool(a["large"] == nil ? (try? hooks?.invoke("measure.large", JSObject())) == .bool(true) : a["large"] == .bool(true)); args["find"] = .string(a["find"]?.stringValue ?? "")
                view = try LibraryAllView.allModel(state, args, dates: store.dates)
            }
            var ink = JSObject()
            let records = op == "view.library-list" ? (view["rows"]?.arrayValue ?? []).compactMap { $0["record"] } : (view["groups"]?.arrayValue ?? []).flatMap { ($0["cells"]?.arrayValue ?? []).compactMap { $0["record"] } }
            for r in records {
                guard let raw = store.getInk(r), let decoded = try? InkMath.decodeInk(raw) else { continue }
                let strokes = InkMath.resampleForReplay(decoded).map { points in JSValue.array(points.map { JS.obj([("x", .number($0.x)), ("y", .number($0.y)), ("w", .number($0.w ?? .nan))]) }) }
                if !strokes.isEmpty { ink[JS.string(r["id"])] = .array(strokes) }
            }
            return JS.obj([("ok", .bool(true)), ("view", view), ("ink", .object(ink)), ("metrics", (try? hooks?.invoke(op == "view.library-list" ? "measure.list" : "measure.all", JSObject([("view", view)]))) ?? .null)])
        }
        return SessionWrites.failure("unavailable")
    }
}
