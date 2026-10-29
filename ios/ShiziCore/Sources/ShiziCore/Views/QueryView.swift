import Foundation

// src/session/views/query.js; predicates use the already ported real deck.
public enum QueryView {
    static func entry(_ key: String, _ vars: JSValue = .object(JSObject())) -> JSValue {
        ViewSupport.obj([("key", .string(key)), ("vars", vars)])
    }
    static func normalized(_ v: JSValue) -> JSValue { entry(JS.string(v["key"]), v["vars"] ?? .object(JSObject())) }
    static let pinyinEntries: [JSValue] = {
        var seen = KeySet()
        return DeckCards.shared.cards.compactMap { c in
            guard let ch = c["target"]?.stringValue, !ch.isEmpty, !seen.contains(ch), let card = DeckCards.shared.cardForKey("base:" + ch) else { return nil }
            seen.insert(ch)
            let key = Query.pyKey(card["py"])
            return key.isEmpty ? nil : ViewSupport.obj([("char", .string(ch)), ("key", .string(key))])
        }
    }()
    static func practicable(_ c: String) -> Bool { Query.isPracticable(.string(c), inDeck: { DeckCards.shared.cardForKey("base:" + $0) != nil }) }
    public static func sheetModel(_ a: JSObject) -> JSValue {
        let state = a["state"], policy = ViewSupport.policy(a["policy"])
        let records = Query.flattenRecords(state?["records"])
        var filtered = Query.filterInput(a["text"], max: policy["queryInputMax"])
        let py = filtered.hanCount == 0 ? Query.parsePinyinInput(a["text"]) : nil
        var pinyin: JSValue? = nil
        if let py {
            let chars = Query.pinyinMatches(JS.string(py["query"]), pinyinEntries, written: Query.writtenChars(records))
            pinyin = ViewSupport.obj([("raw", py["raw"]!), ("count", .number(Double(chars.count)))])
            filtered = Query.Filtered(chars: chars, removed: 0, duplicates: [], hanCount: 0, overLimit: 0, total: filtered.total)
        }
        let v = Query.queryView(chars: filtered.chars, cur: a["cur"]?.stringValue ?? "", practicable: practicable)
        let summaries = filtered.chars.map { Query.charSummary($0, records: records, sched: state?["sched"], custom: state?["custom"], practicable: practicable($0)) }
        let chosen = a["mode"] == .string("pick") ? Query.selectedChars(filtered.chars, (a["selected"]?.arrayValue ?? []).compactMap(\.stringValue), practicable: practicable) : []
        let notes: [JSValue]
        if let pinyin { notes = JS.number(pinyin["count"]) > 0 ? [] : [entry("X-QUERY.pinyinNone", ViewSupport.obj([("char", pinyin["raw"]!)]))] }
        else { notes = Query.filterNotes(filtered, view: v.view) }
        return ViewSupport.obj([("filtered", filtered.js), ("view", .string(v.view)), ("cur", .string(v.cur)), ("notes", .array(notes)), ("pinyin", .bool(pinyin != nil)), ("summaries", .array(summaries)), ("summary", v.cur.isEmpty ? .null : summaries.first { $0["char"] == .string(v.cur) } ?? .null), ("multi", .bool(filtered.chars.count > 1)), ("chosen", .array(chosen.map(JSValue.string))), ("bar", a["mode"] == .string("pick") && ["hint", "rows"].contains(v.view) ? Query.pickBar(.number(Double(chosen.count))) : .null)])
    }
    public static func commitAdd(_ store: Store, char: JSValue) -> JSValue {
        store.commit("query:add") { draft, ctx in
            if let next = try Query.withCustomAdded(draft["custom"], char, .number(ctx.now)) { draft["custom"] = next }
        }
    }
    public static func cardMetaRef(_ pinyin: JSValue?, _ strokes: JSValue?) -> JSValue {
        guard JS.truthy(pinyin) else { return .null }
        return entry("X-QUERY.cardMeta", ViewSupport.obj([("pinyin", pinyin!), ("n", JS.number(strokes) > 0 ? strokes! : .number(0))]))
    }
    public static func cardStatRef(_ summary: JSValue?) -> JSValue {
        JS.truthy(summary?["count"]) && JS.truthy(summary?["latestDay"]) ? entry("R-Q05.cardStat", ViewSupport.obj([("n", summary!["count"]!), ("day", summary!["latestDay"]!)])) : entry("R-Q04.rowNone")
    }
    public static func dateRef(_ day: JSValue?, dates: Dates) throws -> JSValue {
        JS.truthy(day) ? entry("R-H02.dateFormat", try dates.monthDayParts(day!)) : .null
    }
    static func inkOf(_ state: JSValue?, _ record: JSValue?, dates: Dates) -> JSValue? {
        guard let r = record, let month = Schema.inkMonthOf(r, timeZone: dates.timeZone), let id = Schema.inkIdOf(r) else { return nil }
        return state?["ink"]?[month]?[id]
    }
    public static func inkPointsOf(_ summary: JSValue?, state: JSValue?, policy: JSValue = Config.policy, dates: Dates) throws -> JSValue {
        guard let latest = summary?["latest"], JS.truthy(latest), policy["queryCardInk"] == .string("latest"), let decoded = try InkMath.decodeInk(inkOf(state, latest, dates: dates)), !decoded.isEmpty else { return .null }
        return .array(InkMath.resampleForReplay(decoded).map { .array($0.map { .array([.number($0.x), .number($0.y)]) }) })
    }
    static func sheetStrokes(_ state: JSValue?, _ record: JSValue?, dates: Dates) throws -> JSValue {
        let ink = inkOf(state, record, dates: dates)
        let points = try InkMath.decodeInkRaw(ink) ?? InkMath.decodeInk(ink) ?? []
        return .array(points.map { .array($0.map { .array([.number($0.x), .number($0.y), .number($0.t ?? 0)] + ($0.p.map { [.number($0)] } ?? [])) }) })
    }
    public static func querySheetModel(_ a: JSObject, dates: Dates) throws -> JSValue {
        let m = sheetModel(a), mode = a["mode"] ?? .null, view = JS.string(m["view"]), cur = m["cur"]!
        var rows: [JSValue] = [], card: JSValue = .null, bad: JSValue = .null
        if view == "rows" {
            rows = (m["summaries"]?.arrayValue ?? []).map { s in
                let c = DeckCards.shared.cardForKey("base:" + JS.string(s["char"]))
                return ViewSupport.obj([("char", s["char"]!), ("pinyin", c?["py"] ?? .string("")), ("word", c?["word"] ?? .string("")), ("status", normalized(Query.rowStatus(s))), ("selectable", .bool(mode == .string("pick") && JS.truthy(s["practicable"]))), ("selected", .bool(m["chosen"]!.arrayValue!.contains(s["char"]!))), ("practicable", .bool(JS.truthy(s["practicable"]))), ("custom", .bool(JS.truthy(s["custom"]))), ("count", s["count"]!)])
            }
        }
        if ["card", "bad"].contains(view), let s = m["summary"], JS.truthy(s) {
            let c = DeckCards.shared.cardForKey("base:" + JS.string(cur))
            var common = JSObject([("char", cur), ("pinyin", c?["py"] ?? .string("")), ("word", c?["word"] ?? .string("")), ("strokes", c?["strokes"] ?? .number(0)), ("custom", .bool(JS.truthy(s["custom"]))), ("count", s["count"]!)])
            if view == "card" {
                let ink = try inkPointsOf(s, state: a["state"], dates: dates)
                common["meta"] = cardMetaRef(common["pinyin"], common["strokes"]); common["stat"] = cardStatRef(s); common["ink"] = ink
                common["inkStrokes"] = JS.truthy(ink) ? try sheetStrokes(a["state"], s["latest"], dates: dates) : .array([])
                card = .object(common)
            } else {
                common["title"] = entry("R-Q05.unavailableTitle", ViewSupport.obj([("char", cur)])); common["reason"] = entry("R-Q05.unavailableReason"); common["source"] = entry("R-Q05.unavailableSource"); bad = .object(common)
            }
        }
        var bar = m["bar"] ?? .null
        if JS.truthy(bar) { var b = normalized(bar).objectValue!; b["disabled"] = .bool(JS.truthy(bar["disabled"])); bar = .object(b) }
        return ViewSupport.obj([("mode", mode), ("title", entry(mode == .string("pick") ? "R-Q01.titlePick" : "R-Q01.titleLookup")), ("placeholder", entry("R-Q01.placeholder")), ("view", .string(view)), ("cur", cur), ("multi", m["multi"]!), ("notes", .array(m["notes"]!.arrayValue!.map(normalized))), ("hint", view == "hint" ? entry("R-Q02.pickNote") : view == "rows" ? entry("R-Q02.lookupNote") : .null), ("rows", .array(rows)), ("card", card), ("bad", bad), ("back", JS.truthy(m["multi"]) && ["card", "bad"].contains(view) ? entry("R-Q05.backToList", ViewSupport.obj([("n", .number(Double(m["filtered"]!["chars"]!.arrayValue!.count)))])) : .null), ("bar", bar), ("chosen", m["chosen"]!), ("ink", !(card["inkStrokes"]?.arrayValue ?? []).isEmpty ? try ViewSupport.inkParams(ViewSupport.policy(a["policy"])) : .null)])
    }
}
