import Foundation

extension SessionHints {
    public static func groupsFor(_ char: JSValue?, table: JSValue? = nil) -> JSValue {
        guard let c = char?.stringValue, !c.isEmpty, let g = table?[c], g.arrayValue != nil else { return .null }; return g
    }
    public static func hasGroupData(_ groups: JSValue?, totalStrokes: JSValue?) -> Bool {
        guard let a = groups?.arrayValue, !a.isEmpty, a.allSatisfy({ SessionWrites.integer($0) && JS.number($0) >= 1 }) else { return false }
        return .number(a.reduce(0) { $0 + JS.number($1) }) == totalStrokes
    }
    public static func sourceOf(_ a: JSObject, table: JSValue? = nil) -> JSValue {
        if a["status"] == .string("ready"), let medians = a["data"]?["medians"]?.arrayValue, !medians.isEmpty {
            return source(JSObject([("totalStrokes", .number(Double(medians.count))), ("groups", a["groups"] ?? groupsFor(a["char"], table: table))]))
        }
        return source(a["status"] == .string("missing") ? JSObject([("totalStrokes", .number(0))]) : JSObject())
    }
    static func jsAdd(_ a: JSValue, _ b: JSValue) -> JSValue {
        if a.stringValue != nil || b.stringValue != nil { return .string(JS.string(a) + JS.string(b)) }
        return .number(JS.number(a) + JS.number(b))
    }
    public static func plan(_ a: JSObject) throws -> JSValue { try step(a)["plan"] ?? .null }
    public static func strokeRangeText(_ from: JSValue?, _ to: JSValue?) throws -> JSValue {
        let a = JS.number(from).rounded(.towardZero) + 1, b = JS.number(to).rounded(.towardZero)
        guard a >= 1 && b >= a else { return .string("") }
        return try Copy.t(a == b ? "X-WRITE.liveRangeOne" : "X-WRITE.liveRangeMany", JSObject([("a", .number(a)), ("b", .number(b))]))
    }
    public static func announcement(_ range: JSValue?) throws -> JSValue {
        if !JS.truthy(range) { return .string("") }
        let text = try strokeRangeText(range?["from"], range?["to"])
        return JS.truthy(text) ? try Copy.t("X-WRITE.liveHint", JSObject([("range", text)])) : .string("")
    }
    public static func helper(_ name: String, _ a: JSObject) throws -> JSValue {
        switch name {
        case "groupsFor": return groupsFor(a["char"], table: a["table"])
        case "hasGroupData": return .bool(hasGroupData(a["groups"], totalStrokes: a["totalStrokes"]))
        case "hintSourceOf": return sourceOf(a, table: a["table"])
        case "hintSourceOfCount": var v = a; if a["groups"] == nil { v["groups"] = groupsFor(a["char"], table: a["table"]) }; return source(v)
        case "planHint": return try plan(a)
        case "hintStep": return try step(a)
        case "hintButtonModel": return try button(a)
        case "hintNoteModel": return try note(a)
        case "mergeHintRange": return merge(a["prev"], a["next"] ?? .null)
        case "strokeRangeText": return try strokeRangeText(a["from"], a["to"])
        case "hintAnnouncement": return try announcement(a["range"])
        case "strokeDrawMs": return HintViewState.timeline(.number(max(1, HintViewState.number(a["count"]))), motion: a["motion"])["dur"]!
        case "meanDistanceToMedian": return .number(try meanDistanceRaw(a["points"],median:a["median"]))
        case "hintRemaining": return .array(HintViewState.remaining(a["view"]))
        case "hintVisible": return .bool(HintViewState.visible(a["view"]))
        case "matchHintStroke": return try HintViewState.match(a)
        case "initialHintView": return HintViewState.initial(a["key"] ?? .null, stored: a["stored"], written: a["written"])
        case "reduceHintView": return HintViewState.reduce(a["view"] ?? .null, a["action"] ?? .null)
        case "hintTimeline": return HintViewState.timeline(a["count"], motion: a["motion"])
        default: throw CoreError.badArgs("unknown hint helper")
        }
    }
}

extension SessionHints {
    // Preserve JS NaN propagation for partially malformed geometry rather than dropping points.
    public static func meanDistanceRaw(_ raw: JSValue?, median rawMedian: JSValue?) throws -> Double {
        guard let points = raw?.arrayValue,!points.isEmpty,let median = rawMedian?.arrayValue,!median.isEmpty else { return .infinity }
        var sum = 0.0,n = 0.0
        func ordinate(_ p: JSValue, _ i: Int) throws -> Double {
            if p.isNull { throw CoreError.type("Cannot read properties of null (reading '\(i)')") }
            if let text = p.stringValue { let chars = Array(text.utf16);return i < chars.count ? JS.number(UnicodeScalar(chars[i]).map { .string(String($0)) }) : .nan }
            return JS.number(p.arrayValue.flatMap { i < $0.count ? $0[i] : nil })
        }
        for i in stride(from:0,to:points.count,by:max(1,points.count/24)) {
            let p = points[i]
            if p.isNull { throw CoreError.type("Cannot read properties of null (reading 'x')") }
            let x = JS.number(p["x"]), y = JS.number(p["y"]);var best = Double.infinity
            if median.count == 1 { best = try JSMath.hypot(x-ordinate(median[0],0),y-ordinate(median[0],1)) }
            if median.count > 1 { for j in 0..<(median.count-1) {
                let ax = try ordinate(median[j],0),ay = try ordinate(median[j],1),bx = try ordinate(median[j+1],0),by = try ordinate(median[j+1],1)
                let dx = bx-ax,dy = by-ay,len = dx*dx+dy*dy
                let fraction = ((x-ax)*dx+(y-ay)*dy)/len
                let t = len > 0 ? fraction.isNaN ? .nan : max(0,min(1,fraction)) : 0
                let d = JSMath.hypot(x-(ax+t*dx),y-(ay+t*dy))
                best = best.isNaN || d.isNaN ? .nan : min(best,d)
            } }
            sum += best;n += 1
        }
        return n > 0 ? sum/n : .infinity
    }
}
