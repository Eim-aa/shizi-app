import Foundation

// src/session/ops/hint.js: pure presentation state; no drawing or platform clocks.
public enum HintViewState {
    static func number(_ v: JSValue?) -> Double { JS.numberOr0(v).rounded(.towardZero) }
    public static func initial(_ key: JSValue, stored: JSValue?, written: JSValue? = nil) -> JSValue {
        let range = SessionHints.range(stored?["hintRange"]), used = max(0, number(stored?["hints"])), w = max(0, number(written))
        var absorbed: [JSValue] = []
        if let range {
            var u = JS.number(range["from"]); while u < min(JS.number(range["to"]), w) { absorbed.append(JS.obj([("user", .number(u)), ("hint", .number(u))])); u += 1 }
        }
        return JS.obj([("key", key), ("used", .number(used)), ("range", range ?? .null), ("absorbed", .array(absorbed)), ("fading", .array([])), ("show", .string(range == nil ? "none" : "in")), ("run", .number(0)), ("restored", .bool(range != nil))])
    }
    public static func remaining(_ view: JSValue?) -> [JSValue] {
        guard let range = SessionHints.range(view?["range"]) else { return [] }
        let gone = (view?["absorbed"]?.arrayValue ?? []).compactMap { $0["hint"] }
        var out: [JSValue] = [], i = JS.number(range["from"])
        while i < JS.number(range["to"]) { let value = JSValue.number(i); if !gone.contains(value) { out.append(value) }; i += 1 }; return out
    }
    public static func visible(_ view: JSValue?) -> Bool { !remaining(view).isEmpty || !(view?["fading"]?.arrayValue ?? []).isEmpty }
    public static func reduce(_ view: JSValue, _ action: JSValue) -> JSValue {
        let absorbed = view["absorbed"]?.arrayValue ?? [], fading = view["fading"]?.arrayValue ?? []
        func with(_ pairs: [(String,JSValue)]) -> JSValue { SessionWrites.patch(view, pairs) }
        switch action["type"] {
        case .string("reset"): return initial(action["key"] ?? .null, stored: action["stored"], written: action["written"])
        case .string("hint"):
            guard let range = SessionHints.range(action["range"]) else { return view }
            let keep = SessionHints.range(view["range"]) != nil && JS.number(view["range"]?["to"]) <= JS.number(range["from"])
            var next = keep ? absorbed : [], u = JS.number(range["from"]), w = max(0, number(action["written"]))
            while u < min(JS.number(range["to"]), w) {
                if !next.contains(where: { $0["hint"] == .number(u) }) { next.append(JS.obj([("user", .number(u)), ("hint", .number(u))])) }; u += 1
            }
            return with([("used", .number(JS.number(view["used"]) + 1 + max(0, number(action["skip"])))), ("range", SessionHints.merge(view["range"], range)), ("absorbed", .array(next)), ("fading", .array(keep ? fading : [])), ("show", .string("in")), ("run", .number(JS.number(view["run"])+1)), ("restored", .bool(false))])
        case .string("absorb"):
            guard SessionHints.range(view["range"]) != nil, remaining(view).contains(action["hint"] ?? .null) else { return view }
            return with([("absorbed", .array(absorbed + [JS.obj([("user", action["user"] ?? .null), ("hint", action["hint"] ?? .null)])])), ("fading", .array(fading + [JS.obj([("hint", action["hint"] ?? .null)])]))])
        case .string("faded"):
            if !fading.contains(where: { $0["hint"] == action["hint"] }) { return view }
            return with([("fading", .array(fading.filter { $0["hint"] != action["hint"] }))])
        case .string("restore"):
            let back = absorbed.filter { JS.number($0["user"]) >= JS.number(action["fromUser"]) }; if back.isEmpty { return view }
            let gone = back.compactMap { $0["hint"] }
            return with([("absorbed", .array(absorbed.filter { JS.number($0["user"]) < JS.number(action["fromUser"]) })), ("fading", .array(fading.filter { !gone.contains($0["hint"] ?? .null) })), ("show", .string("in")), ("run", .number(JS.number(view["run"])+1)), ("restored", .bool(false))])
        case .string("sync-used"): return JS.number(action["used"]) > JS.number(view["used"]) ? with([("used", action["used"]!)]) : view
        default: return view
        }
    }
    public static func meanDistance(_ points: [InkPoint], median: [[Double]]) -> Double {
        if points.isEmpty || median.isEmpty { return .infinity }
        var sum = 0.0, n = 0.0
        for i in stride(from: 0, to: points.count, by: max(1, points.count/24)) {
            let p = points[i]; var best = Double.infinity
            if median.count == 1 && median[0].count >= 2 { best = JSMath.hypot(p.x-median[0][0], p.y-median[0][1]) }
            if median.count > 1 { for j in 0..<(median.count-1) where median[j].count >= 2 && median[j+1].count >= 2 {
                let a = median[j], b = median[j+1], dx = b[0]-a[0], dy = b[1]-a[1], len = dx*dx+dy*dy
                let t = len > 0 ? max(0, min(1, ((p.x-a[0])*dx + (p.y-a[1])*dy)/len)) : 0
                best = min(best, JSMath.hypot(p.x-(a[0]+t*dx), p.y-(a[1]+t*dy)))
            }}
            sum += best; n += 1
        }; return n > 0 ? sum/n : .infinity
    }
    public static func match(_ a: JSObject) -> JSValue {
        let remaining = a["remaining"]?.arrayValue ?? [], index = a["index"] ?? .null
        if remaining.contains(index) { return index }
        let points = (a["points"]?.arrayValue ?? []).compactMap(InkPoint.init(js:)), medians = a["medians"]?.arrayValue ?? []
        if points.isEmpty || medians.isEmpty { return .null }
        var best = JSValue.null, distance = Double.infinity
        for h in remaining {
            let i = JS.number(h); guard i >= 0 && i < Double(medians.count) && i.rounded(.towardZero) == i else { continue }
            let d = meanDistance(points, median: (medians[Int(i)].arrayValue ?? []).map { ($0.arrayValue ?? []).map { JS.number($0) } })
            if d < distance { distance = d; best = h }
        }; return !best.isNull && distance <= JS.number(a["maxDist"] ?? .number(40)) ? best : .null
    }
    public static func timeline(_ count: JSValue?, motion: JSValue? = nil) -> JSValue {
        let draw = SessionResources.ui["hintDraw"]!, m = Config.policy["motion"]
        let n = max(0, number(count)), used = max(1, n), maxMs = motion?["hintStrokeMs"]?.numberValue ?? m!["hintStrokeMs"]!.numberValue!
        let dur = JSMath.round(min(max(1100/used, draw["minMs"]!.numberValue!), maxMs, 1200/(0.3+0.7*used)))
        let stagger = motion?["hintStagger"]?.numberValue ?? m!["hintStagger"]!.numberValue!
        var items: [JSValue] = [], j = 0.0
        while j < n { items.append(JS.obj([("delay", .number(JSMath.round(j*dur*stagger))), ("dur", .number(dur))])); j += 1 }
        return JS.obj([("dur", .number(dur)), ("items", .array(items)), ("total", .number(n > 0 ? JS.number(items.last?["delay"])+dur : 0))])
    }
}
