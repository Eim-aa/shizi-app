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
                guard let raw = store.getInk(r), let decoded = try? InkMath.decodeInk(raw),
                      let strokes = LibraryInkWire.record(InkMath.resampleForReplay(decoded)) else { continue }
                ink[JS.string(r["id"])] = strokes
            }
            return JS.obj([("ok", .bool(true)), ("view", view), ("ink", .object(ink)), ("metrics", (try? hooks?.invoke(op == "view.library-list" ? "measure.list" : "measure.all", JSObject([("view", view)]))) ?? .null)])
        }
        return SessionWrites.failure("unavailable")
    }
}

/// 字库子页回包 ink 里一条墨迹的形状：{记录 id: [笔, …]}，App 端 LibraryInkView.decodeInk 读成 [[{x, y, w?}]]。
///
/// 一笔平铺成一个数组，头一个数是步长：
///   · 每点都有 w → [3, x0, y0, w0, x1, y1, w1, …]
///   · 每点都没有 w → [2, x0, y0, x1, y1, …]
///   · 有的有、有的没有 → 旧形状：每点一个 {x, y, w?} 对象（legacyStroke）
///   · 没有点 → []（同旧形状）
/// 解出来的点与旧形状逐位相同：数原样放（同一个 Double，过边界时同一个 EngineValue.any），缺 w 仍是缺 w。
/// 以前每点一个对象：引擎侧每点建一个 JSObject（字典 + 键序数组），过边界再建一个 [String: Any]，App 再按键查三次；
/// 平铺后每笔一个数组。
///
/// 只发有限数：存储校验只要求整数，过大的 v2 坐标在 Catmull-Rom 里会溢出成 ±∞ / NaN；回包进 App 后可能经 JSONSerialization 往返，
/// 非有限数在 Apple 平台上抛 Objective-C 异常（Swift 接不住）。x / y 不是有限数的点丢掉，w 不是有限数当缺省（两种形状同此）。
/// 合法墨迹的点 x / y / w 全是有限数。
public enum LibraryInkWire {
    /// 一条记录的全部笔画（回包 ink[记录 id]）；没有笔画 → nil（不放进回包）。legacy = 旧形状（只给测试 / 量测对照）。
    public static func record(_ resampled: [[InkPoint]], legacy: Bool = false) -> JSValue? {
        resampled.isEmpty ? nil : .array(resampled.map { legacy ? legacyStroke($0) : stroke($0) })
    }

    /// 一笔（见类型说明）。
    public static func stroke(_ points: [InkPoint]) -> JSValue {
        var kept = 0, withWidth = 0
        for q in points where q.x.isFinite && q.y.isFinite {
            kept += 1
            if let w = q.w, w.isFinite { withWidth += 1 }
        }
        if kept == 0 { return .array([]) }
        if withWidth != 0 && withWidth != kept { return legacyStroke(points) }
        let hasWidth = withWidth == kept
        var flat: [JSValue] = []
        flat.reserveCapacity(1 + kept * (hasWidth ? 3 : 2))
        flat.append(.number(hasWidth ? 3 : 2))
        for q in points where q.x.isFinite && q.y.isFinite {
            flat.append(.number(q.x))
            flat.append(.number(q.y))
            if hasWidth, let w = q.w { flat.append(.number(w)) }
        }
        return .array(flat)
    }

    /// 旧形状：每点一个 {x, y, w?} 对象（w 不是有限数就不写）。
    public static func legacyStroke(_ points: [InkPoint]) -> JSValue {
        .array(points.compactMap { q -> JSValue? in
            guard q.x.isFinite, q.y.isFinite else { return nil }
            var o = JSObject([("x", .number(q.x)), ("y", .number(q.y))])
            if let w = q.w, w.isFinite { o["w"] = .number(w) }
            return .object(o)
        })
    }
}
