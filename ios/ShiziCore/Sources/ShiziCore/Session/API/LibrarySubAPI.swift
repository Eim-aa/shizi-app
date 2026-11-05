import Foundation

// src/session/api/library-sub.js. Renderer measurements default to null, as in JS.
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
                // 只发有限数：存储校验只要求整数，过大的 v2 坐标在 Catmull-Rom 里会溢出成 ±∞ / NaN；回包进 App 后经 JSONSerialization 往返，
                // 非有限数在 Apple 平台上抛 Objective-C 异常（Swift 接不住）。合法墨迹的点 x / y / w 全是有限数，输出不变。
                let strokes = InkMath.resampleForReplay(decoded).map { points in JSValue.array(points.compactMap { q -> JSValue? in
                    guard q.x.isFinite, q.y.isFinite else { return nil }
                    var o = JSObject([("x", .number(q.x)), ("y", .number(q.y))])
                    if let w = q.w, w.isFinite { o["w"] = .number(w) }
                    return .object(o)
                }) }
                if !strokes.isEmpty { ink[JS.string(r["id"])] = .array(strokes) }
            }
            return JS.obj([("ok", .bool(true)), ("view", view), ("ink", .object(ink)), ("metrics", (try? hooks?.invoke(op == "view.library-list" ? "measure.list" : "measure.all", JSObject([("view", view)]))) ?? .null)])
        }
        return SessionWrites.failure("unavailable")
    }
}
