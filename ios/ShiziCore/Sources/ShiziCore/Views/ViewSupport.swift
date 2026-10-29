import Foundation

// Shared JS-shaped construction; copy remains a reference, never rendered text.
enum ViewSupport {
    static func obj(_ pairs: [(String, JSValue)]) -> JSValue { .object(JSObject(pairs)) }
    static func ref(_ key: String, _ params: JSValue? = nil) -> JSValue {
        var out = JSObject([("copy", .string(key))])
        if let params { out["params"] = params }
        return .object(out)
    }
    static func inkParams(_ policy: JSValue) throws -> JSValue {
        let p = try InkParams(policy: policy.objectValue)
        return obj(InkParams.tunableKeys.map { ($0, .number(p[$0]!)) } + InkParams.spec.map { ($0.0, .number($0.1)) })
    }
    static func policy(_ override: JSValue?) -> JSValue {
        var out = Config.policy.objectValue!
        for (k, v) in override?.objectValue?.entries ?? [] { out[k] = v }
        return .object(out)
    }
    // ECMAScript whitespace, including BOM (Foundation trimming differs).
    static let whitespace = CharacterSet(charactersIn: "\u{9}\u{a}\u{b}\u{c}\u{d}\u{20}\u{a0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}")
    static func trimEnd(_ s: String) -> String {
        var chars = s.unicodeScalars
        while let last = chars.last, whitespace.contains(last) { chars.removeLast() }
        return String(chars)
    }
}

extension ViewSupport {
    struct RecordIndex {
        var judged: [JSValue]; var folded: JSObject; var days: KeySet; var ink: JSValue; var afterSeen: [JSValue]; var dates: Dates
        var works: [JSValue] {
            let all = afterSeen.isEmpty ? judged : Records.sortById(judged + afterSeen)
            return all.filter { WorkMembers.isWorkMember($0, hasInk: { InkPick.storedInkPresent(.object(JSObject([("ink", ink)])), $0, timeZone: dates.timeZone) }) }
        }
        var js: JSValue { ViewSupport.obj([("judged", .array(judged)), ("folded", .object(folded)), ("days", .array(days.items.map(JSValue.string))), ("ink", ink), ("afterSeen", .array(afterSeen))]) }
    }
    static func recordIndex(_ state: JSValue, dates: Dates) -> RecordIndex {
        let records = Query.flattenRecords(state["records"]), judged = Records.sortById(records.filter(Records.isJudged))
        var folded = JSObject(), days = KeySet()
        for (month, value) in state["records"]?.objectValue?.entries ?? [] where value["folded"] == .bool(true) {
            var byDay = JSObject()
            for (day, chars) in value["byDay"]?.objectValue?.entries ?? [] where dates.isValidDay(.string(day)) && !(chars.arrayValue ?? []).isEmpty { byDay[day] = chars; days.insert(day) }
            var f = JSObject([("byDay", .object(byDay)), ("chars", .array(value["chars"]?.arrayValue ?? []))])
            for key in ["paperOnly", "work", "workJudged"] { if let v = value[key], v.objectValue != nil || v.arrayValue != nil { f[key] = v } }
            if let kept = value["kept"]?.arrayValue { f["kept"] = .array(kept) }; folded[month] = .object(f)
        }
        for r in judged where dates.isValidDay(r["localDay"] ?? .null) { days.insert(JS.string(r["localDay"])) }
        let ink = state["ink"]?.objectValue != nil ? state["ink"]! : .null
        let seen = Records.sortById(records.filter { $0["kind"] == .string("answer-seen") && Records.isAfterSeenWork($0, { InkPick.storedInkPresent(state, $0, timeZone: dates.timeZone) }) })
        return RecordIndex(judged: judged, folded: folded, days: days, ink: ink, afterSeen: seen, dates: dates)
    }
}
