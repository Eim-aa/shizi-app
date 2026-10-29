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
        (try? SessionHints.meanDistanceRaw(.array(points.map(\.js)),median:.array(median.map { .array($0.map(JSValue.number)) }))) ?? .nan
    }
    public static func match(_ a: JSObject) throws -> JSValue {
        let remaining = a["remaining"]?.arrayValue ?? [], index = a["index"] ?? .null
        if remaining.contains(index) { return index }
        let points = a["points"]?.arrayValue ?? [], medians = a["medians"]?.arrayValue ?? []
        if points.isEmpty || medians.isEmpty { return .null }
        var best = JSValue.null, distance = Double.infinity
        for h in remaining {
            let i = JS.number(h); guard i >= 0 && i < Double(medians.count) && i.rounded(.towardZero) == i else { continue }
            let d = try SessionHints.meanDistanceRaw(.array(points),median:medians[Int(i)])
            if d < distance { distance = d; best = h }
        }; return !best.isNull && distance <= JS.number(a["maxDist"] ?? .number(40)) ? best : .null
    }
    public static func strokeDrawMs(_ count: JSValue?, motion: JSValue? = nil) -> Double {
        let n = max(1,number(count)), draw = SessionResources.ui["hintDraw"]!
        let rawMax = motion?["hintStrokeMs"]?.numberValue
        let maxMs = rawMax?.isFinite == true ? rawMax! : JS.number(Config.policy["motion"]?["hintStrokeMs"])
        return JSMath.round(min(max(1100/n,JS.number(draw["minMs"])),maxMs,1200/(0.3+0.7*n)))
    }
    public static func timeline(_ count: JSValue?, motion: JSValue? = nil) -> JSValue {
        let m = Config.policy["motion"], n = max(0,number(count))
        let dur = strokeDrawMs(.number(n == 0 ? 1 : n),motion:motion)
        let stagger = motion?["hintStagger"]?.numberValue ?? m!["hintStagger"]!.numberValue!
        var items: [JSValue] = [], j = 0.0
        while j < n { items.append(JS.obj([("delay", .number(JSMath.round(j*dur*stagger))), ("dur", .number(dur))])); j += 1 }
        return JS.obj([("dur", .number(dur)), ("items", .array(items)), ("total", .number(n > 0 ? JS.number(items.last?["delay"])+dur : 0))])
    }
}
