import Foundation

// src/session/views/library-all.js
public enum LibraryAllView {
    typealias V = ViewSupport
    static let sorts = ["recent", "py", "age"], filters = ["due", "shaky", "known", "unw", "custom"]
    public static func normalizeSort(_ s: JSValue?) -> String { let s = s?.stringValue ?? ""; return sorts.contains(s) ? s : "recent" }
    public static func normalizeFilter(_ f: JSValue?) -> String { let f = f?.stringValue ?? ""; return ["wrong", "forget"].contains(f) ? "due" : filters.contains(f) ? f : "" }
    public static func normalizeFold(_ f: JSValue?) -> JSObject {
        var out = JSObject()
        for (k, v) in f?.objectValue?.entries ?? [] where k.range(of: #"^\d{4}-\d{2}$"#, options: .regularExpression) != nil && v.boolValue != nil { out[k] = v }; return out
    }
    public static func pyInitial(_ py: JSValue?) -> JSValue { Query.pyKey(py).first.map { .string(String($0).uppercased()) } ?? .null }
    public static func parseFind(_ text: JSValue?) -> JSValue {
        if let ch = text?.stringValue?.unicodeScalars.first(where: UnicodeScripts.isHan) { let c = String(ch); return V.obj([("mode", .string("char")), ("char", .string(c)), ("query", .string(c))]) }
        if let p = Query.parsePinyinInput(text) { return V.obj([("mode", .string("pinyin")), ("query", p["query"]!), ("raw", p["raw"]!)]) }
        return V.obj([("mode", .string("none")), ("query", .string(""))])
    }
    public static func monthRef(_ month: String, today: String, found: Bool, dates: Dates) -> JSValue {
        let parts = month.components(separatedBy: "-"), y = Double(parts[0]) ?? .nan, m = parts.count > 1 ? Double(parts[1]) ?? .nan : .nan
        let current = dates.isValidDay(.string(today)) ? Double(today.prefix(4)) ?? y : y
        return V.ref(y == current ? (found ? "R-A03.foundIn" : "X-ALL.groupMonth") : (found ? "X-ALL.foundInYear" : "X-ALL.groupMonthYear"), V.obj(y == current ? [("month", .number(m))] : [("year", .number(y)), ("month", .number(m))]))
    }
    public static func takeCells(_ groups: [JSValue], limit: Double) -> [JSValue] {
        var budget = max(0, limit), out: [JSValue] = []
        for g in groups {
            if budget <= 0 && JS.truthy(g["head"]) { break }
            let list = g["cells"]?.arrayValue ?? [], cells = Array(list.prefix(Int(min(Double(list.count), max(0, budget.rounded(.towardZero)))))); budget -= Double(cells.count)
            if !cells.isEmpty || !JS.truthy(g["head"]) { var o = g.objectValue!; o["cells"] = .array(cells); o["partial"] = .bool(cells.count < list.count); out.append(.object(o)) }
        }; return out
    }
    public static func allModel(_ state: JSValue, _ a: JSObject, dates: Dates) throws -> JSValue {
        let today = a["today"]?.stringValue ?? "", policy = V.policy(a["policy"]), records = V.libraryRecords(state).records, latest = Records.practicedByChar(records)
        let byNew = latest.entries.map(\.value).sorted { Records.compareRecordIds($1["id"], $0["id"]) < 0 }, custom = V.customCharsOf(state["custom"]), hollow = custom.filter { !latest.has($0) }
        let recorded = latest.count, members = recorded+hollow.count, cols = V.wallColumns(large: JS.truthy(a["compact"]), width: a["width"])
        let wrong = KeySet(byNew.filter { $0["judgment"] == .string("wrong") }.map { JS.string($0["char"]) }), zones = try V.memoryZones(state, today: today, dates: dates)["zones"]!
        let sort = normalizeSort(a["sort"]), fold = normalizeFold(a["fold"]), requested = normalizeFilter(a["filter"])
        var counts = JSObject()
        for k in ["due", "shaky", "known"] { counts[k] = zones[k]!["n"]! }; counts["unw"] = .number(Double(hollow.count)); counts["custom"] = .number(Double(custom.count))
        func py(_ c: String) -> String { let v = a["pinyin"]?[c] ?? DeckCards.shared.cardForKey("base:"+c)?["py"]; return JS.truthy(v) ? JS.string(v) : "" }
        let find = parseFind(a["find"]); var hits: [String] = []
        if find["mode"] == .string("char"), latest.has(JS.string(find["char"])) { hits = [JS.string(find["char"])] }
        else if find["mode"] == .string("pinyin") {
            let q = JS.string(find["query"]), exact = byNew.filter { Query.pyKey(.string(py(JS.string($0["char"])))) == q }.map { JS.string($0["char"]) }
            hits = exact.isEmpty ? byNew.filter { Query.pyKey(.string(py(JS.string($0["char"])))).hasPrefix(q) }.map { JS.string($0["char"]) } : exact
        }
        let found = !hits.isEmpty, hit = KeySet(hits), filter = found ? "" : requested
        func ink(_ r: JSValue, withPy: Bool = false) -> JSValue { let c = JS.string(r["char"]); return V.obj([("char", .string(c)), ("kind", .string(wrong.contains(c) ? "wrong" : "ink")), ("tone", .number(Double(V.toneOf(r["localDay"], today: today, days: policy["inkToneDays"], dates: dates)))), ("record", r), ("py", withPy ? .string(py(c)) : .null), ("hit", .bool(hit.contains(c)))]) }
        func hol(_ c: String, withPy: Bool = false) -> JSValue { V.obj([("char", .string(c)), ("kind", .string("hollow")), ("tone", .null), ("record", .null), ("py", withPy ? .string(py(c)) : .null), ("hit", .bool(false))]) }
        func group(_ key: String, name: JSValue, cells: [JSValue], head: Bool = true, tone: JSValue = .null, fold: JSValue = .null, month: JSValue = .null) -> JSValue {
            V.obj([("key", .string(key)), ("head", .bool(head)), ("name", name), ("count", head ? V.ref("X-ALL.groupCount", V.obj([("n", .number(Double(cells.count)))])) : .string("")), ("tone", tone), ("fold", fold), ("month", month), ("cells", .array(cells))])
        }
        func hollowGroup(_ withPy: Bool) -> JSValue { group("hollow", name: V.ref("R-A02.filterCustomUnwritten"), cells: hollow.map { hol($0, withPy: withPy) }) }
        func monthOf(_ r: JSValue) -> String { dates.isValidDay(r["localDay"] ?? .null) ? String(JS.string(r["localDay"]).prefix(7)) : "0000-00" }
        var months = OMap<[JSValue]>()
        for r in byNew { let m = monthOf(r); months[m] = (months[m] ?? [])+[r] }
        var groups: [JSValue] = [], closed: [JSValue] = []; var note: JSValue = .string(""), whereRef: JSValue = .string("")
        if found {
            let ms = Set(hits.map { monthOf(latest[$0]!) }).sorted().reversed()
            groups = ms.map { m in group("m:"+m, name: monthRef(m, today: today, found: false, dates: dates), cells: months[m]!.map { ink($0) }, month: .string(m)) }
            if ms.count == 1 { whereRef = monthRef(ms.first!, today: today, found: true, dates: dates) }
        } else if !filter.isEmpty {
            if filter == "custom" {
                groups = [hollowGroup(false), group("custom-done", name: V.ref("X-ALL.groupRecorded"), cells: byNew.filter { custom.contains(JS.string($0["char"])) }.map { ink($0) })]; note = V.ref("R-A02.customNote")
            } else {
                let cells = ["due", "shaky", "known"].contains(filter) ? zones[filter]!["items"]!.arrayValue!.map { ink($0["record"]!) } : hollow.map { hol($0) }
                groups = [group("f:"+filter, name: .string(""), cells: cells, head: false)]; note = V.ref(["due", "shaky", "known"].contains(filter) ? "X-LIBFOUR.zoneTop."+filter : "R-A02.customUnwrittenNote")
            }
        } else if sort == "age" {
            groups = [hollowGroup(false)] + [3,2,1,0].map { t in
                let list = byNew.filter { V.toneOf($0["localDay"], today: today, days: policy["inkToneDays"], dates: dates) == t }.reversed()
                return group("t:"+String(t), name: V.ref(["X-LIBHOME.tone0", "X-LIBHOME.tone1", "X-LIBHOME.tone2", "R-L03.toneOldest"][t]), cells: list.map { ink($0) }, tone: .number(Double(t)))
            }; note = V.ref("X-ALL.ageNote")
        } else if sort == "py" {
            var buckets = OMap<[JSValue]>()
            let sorted = byNew.sorted { a, b in let ca = JS.string(a["char"]), cb = JS.string(b["char"]), ka = Query.pyKey(.string(py(ca))), kb = Query.pyKey(.string(py(cb))); return ka == kb ? ca < cb : ka < kb }
            for r in sorted { let k = pyInitial(.string(py(JS.string(r["char"])))).stringValue ?? "#"; buckets[k] = (buckets[k] ?? []) + [r] }
            var keys = buckets.keys.filter { $0 != "#" }.sorted(); if buckets.has("#") { keys.append("#") }
            groups = [hollowGroup(true)] + keys.map { k in group("p:"+k, name: k == "#" ? V.ref("X-ALL.groupOther") : .string(k), cells: buckets[k]!.map { ink($0, withPy: true) }) }; note = V.ref("R-A01.sortPinyinNote")
        } else {
            let ms = months.keys.sorted().reversed(), def = Array(ms.prefix(2))
            func open(_ m: String) -> Bool { fold[m]?.boolValue ?? def.contains(m) }
            groups = [hollowGroup(false)] + ms.filter(open).map { m in group("m:"+m, name: monthRef(m, today: today, found: false, dates: dates), cells: months[m]!.map { ink($0) }, fold: .string("open"), month: .string(m)) }
            closed = ms.filter { !open($0) }.map { m in V.obj([("month", .string(m)), ("name", monthRef(m, today: today, found: false, dates: dates)), ("count", .number(Double(months[m]!.count)))]) }
            note = V.ref(Copy.inkKey("R-A01.sortRecentNote", perRecordInk: JS.truthy(policy["features"]?["perRecordInk"])))
        }
        groups = groups.filter { !($0["cells"]?.arrayValue ?? []).isEmpty || !JS.truthy($0["head"]) }
        var go: JSValue = .null
        if !found && filter == "unw" {
            let keys = hollow.map { "base:"+$0 }.filter { a["unpracticable"]?.arrayValue?.contains(.string($0)) != true }
            if !keys.isEmpty { go = V.obj([("kind", .string("start")), ("keys", .array(keys.map(JSValue.string)))]) }
        } else if !found && ["due", "shaky", "known"].contains(filter) && JS.number(counts[filter]) > 0 { go = V.obj([("kind", .string("list")), ("listKind", .string(filter))]) }
        let miss = !found && ["char", "pinyin"].contains(JS.string(find["mode"])) ? V.ref("R-A03.notFound", V.obj([("char", find[find["mode"] == .string("char") ? "char" : "raw"]!)])) : .string("")
        let chipKeys = ["X-ALL.chipDue", "X-ALL.chipShaky", "X-ALL.chipKnown", "X-ALL.chipUnwritten", "R-A02.filterCustom"]
        let chips = filters.enumerated().map { i, k in V.obj([("key", .string(k)), ("label", V.ref(chipKeys[i], V.obj([("n", counts[k]!)]))), ("n", counts[k]!), ("active", .bool(k == filter)), ("disabled", .bool(JS.number(counts[k]) == 0 && k != filter))]) }
        return V.obj([("today", .string(today)), ("recorded", .number(Double(recorded))), ("members", .number(Double(members))), ("cols", .number(Double(cols))), ("empty", .bool(recorded == 0)), ("sort", .string(sort)), ("filter", .string(filter)), ("sorts", .array(sorts.enumerated().map { i,k in V.obj([("key", .string(k)), ("label", V.ref(["R-A01.sortRecent", "R-A01.sortPinyin", "R-A01.sortAge"][i])), ("active", .bool(k == sort))]) })), ("showSort", .bool(!found && filter.isEmpty)), ("chips", .array(chips)), ("showChips", .bool(!found)), ("showLegend", .bool(!found)), ("note", found ? .string("") : note), ("find", V.obj([("text", .string(a["find"]?.stringValue ?? "")), ("mode", find["mode"]!), ("query", find["query"]!), ("found", .bool(found)), ("chars", .array(hits.map(JSValue.string))), ("where", whereRef), ("miss", miss)])), ("groups", .array(groups)), ("closed", .array(closed)), ("go", go), ("total", .number(Double(groups.reduce(0) { $0+($1["cells"]?.arrayValue?.count ?? 0) }))), ("counts", .object(counts))])
    }
}
