import Foundation

// Shared JS-shaped construction; copy remains a reference, never rendered text.
enum ViewSupport {
    static func ordered(_ value: JSValue, _ keys: String) -> JSValue {
        var out = JSObject()
        for k in keys.split(separator: " ").map(String.init) { out[k] = value[k] }; return .object(out)
    }
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

extension ViewSupport {
    static func libraryRecords(_ state: JSValue) -> (records: [JSValue], foldedDays: [String]) {
        var records: [JSValue] = [], days: [String] = []
        for month in (state["records"]?.objectValue?.keys ?? []).sorted() {
            let value = state["records"]![month]!
            records += value.arrayValue ?? value["kept"]?.arrayValue ?? []
            if value.arrayValue == nil { for (day, cs) in value["byDay"]?.objectValue?.entries ?? [] where !(cs.arrayValue ?? []).isEmpty { days.append(day) } }
        }
        return (records, days)
    }
    static func successesOf(_ entry: JSValue?) -> Double { max(0, (JS.number(entry?["fsrs"]?["reps"]).isNaN ? 0 : JS.number(entry?["fsrs"]?["reps"])) - (JS.number(entry?["fsrs"]?["lapses"]).isNaN ? 0 : JS.number(entry?["fsrs"]?["lapses"]))) }
    static func memoryZoneOf(_ record: JSValue, _ entry: JSValue?, today: String, knownDays: Double, minSuccesses: Double, dates: Dates) throws -> String {
        if record["judgment"] == .string("wrong") || record["kind"] == .string("answer-seen") { return "due" }
        if let entry, entry["stoppedAt"] == nil, let od = try ScheduleRules(dates: dates).overdueDays(entry, today), od >= 0 { return "due" }
        let stability = JS.number(entry?["fsrs"]?["stability"])
        return stability >= knownDays && successesOf(entry) >= minSuccesses ? "known" : "shaky"
    }
    static func memoryZones(_ state: JSValue, today: String, knownDays: Double? = nil, minSuccesses: Double? = nil, dates: Dates) throws -> JSValue {
        let latest = Records.practicedByChar(libraryRecords(state).records)
        var buckets: [String: [JSValue]] = ["due": [], "shaky": [], "known": []]
        for (_, r) in latest.entries {
            let entry = state["sched"]?[JS.string(r["cardKey"])]
            let kind = try memoryZoneOf(r, entry, today: today, knownDays: knownDays ?? JS.number(Config.policy["knownZone"]?["stabilityDays"]), minSuccesses: minSuccesses ?? JS.number(Config.policy["knownZone"]?["minSuccesses"]), dates: dates)
            let due = dates.isValidDay(entry?["due"] ?? .null) ? entry!["due"]! : .string("9999-12-31")
            buckets[kind]!.append(obj([("char", r["char"]!), ("cardKey", r["cardKey"]!), ("record", r), ("dueDay", due), ("rank", .number(r["judgment"] == .string("wrong") ? 0 : r["kind"] == .string("answer-seen") ? 1 : 2))]))
        }
        var zones = JSObject()
        for kind in ["due", "shaky", "known"] {
            let sorted = buckets[kind]!.sorted { a, b in
                let ar = JS.number(a["rank"]), br = JS.number(b["rank"])
                if kind == "due" { if ar != br { return ar < br }; if ar < 2 { return Records.compareRecordIds(b["record"]?["id"], a["record"]?["id"]) < 0 } }
                let ad = JS.string(a["dueDay"]), bd = JS.string(b["dueDay"])
                return ad != bd ? ad < bd : Records.compareRecordIds(a["record"]?["id"], b["record"]?["id"]) < 0
            }
            let items = sorted.map { r in obj([("char", r["char"]!), ("cardKey", r["cardKey"]!), ("record", r["record"]!), ("tone", .number(kind == "due" ? 3 : kind == "shaky" ? 1 : 0))]) }
            zones[kind] = obj([("kind", .string(kind)), ("n", .number(Double(items.count))), ("items", .array(items))])
        }
        return obj([("recorded", .number(Double(latest.count))), ("zones", .object(zones))])
    }
    static func skippedZone(_ state: JSValue) -> JSValue {
        let records = libraryRecords(state).records, judged = Records.practicedByChar(records)
        var latest = OMap<JSValue>()
        for r in records where r["kind"] == .string("skipped") {
            guard let c = r["char"]?.stringValue, !judged.has(c) else { continue }
            if latest[c] == nil || Records.compareRecordIds(latest[c]?["id"], r["id"]) < 0 { latest[c] = r }
        }
        let items = latest.entries.map(\.value).sorted { Records.compareRecordIds($1["id"], $0["id"]) < 0 }.map { r in obj([("char", r["char"]!), ("cardKey", r["cardKey"]!), ("record", r), ("tone", .number(3))]) }
        return obj([("kind", .string("skipped")), ("n", .number(Double(items.count))), ("items", .array(items))])
    }
}

extension ViewSupport {
    static func customCharsOf(_ custom: JSValue?) -> [String] {
        var out = KeySet()
        for e in custom?["added"]?.arrayValue ?? [] { if let c = e["char"]?.stringValue, c.unicodeScalars.count == 1 { out.insert(c) } }; return out.items
    }
    static func wallColumns(large: Bool, width: JSValue?) -> Int {
        guard let w = width?.numberValue, w.isFinite, w > 0 else { return large ? 6 : 8 }; return max(4, min(large ? 6 : 9, Int(floor((w-40)/44))))
    }
    static func toneOf(_ day: JSValue?, today: String, days: JSValue?, dates: Dates) -> Int {
        guard dates.isValidDay(day ?? .null), dates.isValidDay(.string(today)), let ago = try? dates.diffDays(day!, .string(today)) else { return 3 }
        let d = (days?.arrayValue?.count ?? 0) >= 3 ? days!.arrayValue! : [7,30,90].map { .number(Double($0)) }
        for i in 0..<3 where ago <= JS.number(d[i]) { return i }; return 3
    }
}
