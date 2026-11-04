import Foundation

// Library view. Shared zone / wall calculations live in this
// file too, after their first consumers were ported earlier in the series.
public enum LibraryView {
    typealias V = ViewSupport
    public static func latestJudgedByChar(_ records: [JSValue]) -> OMap<JSValue> {
        var latest = OMap<JSValue>()
        for r in records where Records.isJudged(r) { guard let c = r["char"]?.stringValue else { continue }; if latest[c] == nil || Records.compareRecordIds(latest[c]?["id"], r["id"]) < 0 { latest[c] = r } }; return latest
    }
    public static func firstRecordDay(_ records: [JSValue], foldedDays: [String], dates: Dates) -> JSValue {
        let days = records.filter(Records.isJudged).compactMap { $0["localDay"]?.stringValue } + foldedDays
        return days.filter { dates.isValidDay(.string($0)) }.min().map(JSValue.string) ?? .null
    }
    public static func libraryHomeModel(_ state: JSValue, today: String, policy: JSValue, compact: Bool, width: JSValue?, dates: Dates) throws -> JSValue {
        let (records, folded) = V.libraryRecords(state), latest = Records.practicedByChar(records), recorded = latest.count, hollow = V.customCharsOf(state["custom"]).filter { !latest.has($0) }, first = recorded > 0 ? firstRecordDay(records, foldedDays: folded, dates: dates) : .null
        var facts: [JSValue] = []
        if recorded > 0 { if !hollow.isEmpty { facts.append(V.obj([("kind", .string("customUnwritten")), ("n", .number(Double(hollow.count)))])) }; if JS.truthy(first) { facts.append(V.obj([("kind", .string("since")), ("day", first)])) } }
        let byNew = latest.entries.map(\.value).sorted { Records.compareRecordIds($1["id"], $0["id"]) < 0 }
        func item(_ r: JSValue) -> JSValue { V.obj([("char", r["char"]!), ("record", r), ("tone", .number(Double(V.toneOf(r["localDay"], today: today, days: policy["inkToneDays"], dates: dates))))]) }
        let wrong = byNew.filter { $0["judgment"] == .string("wrong") }.map(item), wrongSet = KeySet(wrong.map { JS.string($0["char"]) })
        let fl = try Records.forgetList(records: records, sched: state["sched"], today: .string(today), dates: dates, policy: policy.objectValue), forget = fl.items.map { item($0.record) }.filter { !wrongSet.contains(JS.string($0["char"])) }
        let members = hollow.count+recorded, cols = V.wallColumns(large: compact, width: width)
        let ordered = hollow.map { c in V.obj([("char", .string(c)), ("kind", .string("hollow")), ("tone", .null), ("record", .null)]) } + byNew.map { r in V.obj([("char", r["char"]!), ("kind", .string(wrongSet.contains(JS.string(r["char"])) ? "wrong" : "ink")), ("tone", .number(Double(V.toneOf(r["localDay"], today: today, days: policy["inkToneDays"], dates: dates)))), ("record", r)]) }
        let cells = recorded > 0 ? Array(ordered.prefix(cols*8)) : [], more = recorded == 0 ? 0 : policy["wallMoreScope"] == .string("records") ? max(0, recorded-cells.filter { $0["kind"] != .string("hollow") }.count) : max(0, members-cells.count)
        return V.obj([("today", .string(today)), ("libraryId", state["settings"]?["library"]?.stringValue.map(JSValue.string) ?? .null), ("recorded", .number(Double(recorded))), ("hollow", .array(hollow.map(JSValue.string))), ("firstDay", first), ("facts", .array(facts)), ("wrong", V.obj([("chars", .array(wrong.map { $0["char"]! })), ("items", .array(wrong))])), ("forget", V.obj([("chars", .array(forget.map { $0["char"]! })), ("items", .array(forget)), ("total", .number(Double(fl.total)))])), ("wall", V.obj([("cols", .number(Double(cols))), ("rows", .number(ceil(Double(cells.count)/Double(cols)))), ("cells", .array(cells)), ("members", .number(Double(members))), ("more", .number(Double(more)))])), ("empty", .bool(recorded == 0))])
    }
    public static func cardMini(_ items: [JSValue]) -> JSValue { .array(items.prefix(5).map { V.obj([("char", $0["char"]!), ("kind", .string("sample")), ("tone", .number(0)), ("record", .null)]) }) }
    public static func zoneSamples(_ zone: JSValue) -> [JSValue] { (zone["items"]?.arrayValue ?? []).prefix(3).map { V.obj([("char", $0["char"]!), ("kind", .string("ink")), ("tone", $0["tone"]!), ("record", $0["record"]!)]) } }
    public static func todayPlanModel(_ state: JSValue, now: Double, deck: ScheduleDeck, policy: JSValue, dates: Dates) throws -> JSValue {
        // D83：与首页同一份「今天的练习」——写到一半 = 还剩几个（只算第一次）；写完了 = 今天完成；还没开始 = 今天这一份剩下的字
        let home = try HomeView.homeModel(state, now: now, policy: policy, deck: deck, dates: dates)
        if let daily = home["daily"], JS.truthy(daily) {
            let left = JSValue.number(max(0, JS.number(daily["total"]) - JS.number(daily["done"])))
            return V.obj([("phase", .string("half")), ("n", left), ("review", .number(0)), ("fresh", .number(0)), ("remaining", left)])
        }
        if home["plan"]?["done"] == .bool(true) { return V.obj([("phase", .string("done")), ("n", .number(0)), ("review", .number(0)), ("fresh", .number(0)), ("remaining", .null)]) }
        let queue = ScheduleRules.aStartInfo(state, policy: policy).kind == "first" ? SessionRules.selectFirst(policy: policy) : try TodayPlan.remainingQueue(state, day: JS.string(home["today"]), rules: ScheduleRules(dates: dates), deck: deck, policy: policy)
        let review = queue.filter { JS.truthy(state["sched"]?[$0]) }.count
        return V.obj([("phase", .string("fresh")), ("n", .number(Double(queue.count))), ("review", .number(Double(review))), ("fresh", .number(Double(queue.count-review))), ("remaining", .null)])
    }
    public static func libraryNameRef(_ id: JSValue) -> JSValue { V.ref(id == .string("curriculum2500") ? "R-L01.curriculumName" : "R-L06.lib."+JS.string(id)+".name") }
    public static func todayRefs(_ plan: JSValue) -> JSValue {
        if plan["phase"] == .string("half") { return V.obj([("value", V.ref("X-LIBFOUR.todayHalfValue", V.obj([("n", plan["n"]!)]))), ("sub", V.ref("X-LIBFOUR.todayHalfSub"))]) }
        if plan["phase"] == .string("done") { return V.obj([("value", V.ref("X-LIBFOUR.todayDoneValue")), ("sub", V.ref("X-LIBFOUR.todayDoneSub"))]) }
        if JS.number(plan["n"]) <= 0 { return V.obj([("value", V.ref("X-LIBFOUR.todayNoneValue")), ("sub", .null)]) }
        let r = JS.number(plan["review"]) > 0, f = JS.number(plan["fresh"]) > 0
        let sub = r && f ? V.ref("X-LIBFOUR.todaySubBoth", V.obj([("n", plan["review"]!), ("m", plan["fresh"]!)])) : V.ref(r ? "X-LIBFOUR.todaySubReview" : "X-LIBFOUR.todaySubNew", V.obj([("n", plan[r ? "review" : "fresh"]!)]))
        return V.obj([("value", V.ref("X-LIBFOUR.todayValue", V.obj([("n", plan["n"]!)]))), ("sub", sub)])
    }
    public static func sampleStrokes(_ state: JSValue, record: JSValue?, policy: JSValue, dates: Dates) throws -> JSValue {
        guard let record, JS.truthy(record), JS.truthy(policy["features"]?["perRecordInk"]), let decoded = try InkMath.decodeInk(QueryView.inkOf(state, record, dates: dates)), !decoded.isEmpty else { return .null }
        let wire = try QueryView.sheetStrokes(state, record, dates: dates)
        return (wire.arrayValue ?? []).contains { !($0.arrayValue ?? []).isEmpty } ? wire : .null
    }
    public static func libraryPageView(_ state: JSValue, now: Double, today: String, deck: ScheduleDeck, policy: JSValue, ui: JSValue?, dates: Dates) throws -> JSValue {
        let mem = try V.memoryZones(state, today: today, dates: dates), skipped = V.skippedZone(state), plan = try todayPlanModel(state, now: now, deck: deck, policy: policy, dates: dates), refs = todayRefs(plan), id = DeckIndex.shared.currentLibraryId(state["settings"])
        func zoneView(_ z: JSValue) throws -> JSValue {
            let kind = JS.string(z["kind"])
            return V.obj([("kind", .string(kind)), ("name", V.ref("X-LIBFOUR.zone."+kind)), ("n", z["n"]!), ("to", JS.truthy(z["n"]) ? V.obj([("screen", .string("library-list")), ("params", V.obj([("kind", .string(kind))]))]) : .null), ("samples", .array(try zoneSamples(z).map { c in V.obj([("char", c["char"]!), ("tone", c["tone"]!), ("strokes", try sampleStrokes(state, record: c["record"], policy: policy, dates: dates))]) }))])
        }
        var out = JSObject()
        out["today"] = .string(today); out["state"] = .string(JS.truthy(mem["recorded"]) ? "records" : "empty"); out["recorded"] = mem["recorded"]; out["title"] = V.ref("X-TABS.library"); out["search"] = V.obj([("placeholder", V.ref("X-LIBFOUR.searchPlaceholder"))])
        out["range"] = V.obj([("label", V.ref("R-S01.library")), ("value", libraryNameRef(id)), ("libraryId", id), ("to", V.obj([("screen", .string("library-switch")), ("params", V.obj([]))]))])
        out["todayRow"] = V.obj([("label", V.ref("X-LIBFOUR.todayLabel")), ("phase", plan["phase"]!), ("n", plan["n"]!), ("value", refs["value"]!), ("sub", refs["sub"]!)])
        out["written"] = V.obj([("heading", V.ref("X-LIBFOUR.writtenHeading")), ("count", mem["recorded"]!), ("all", V.ref("X-LIBFOUR.writtenAll")), ("allAria", V.ref("X-LIBFOUR.writtenAllAria")), ("to", V.obj([("screen", .string("library-all")), ("params", V.obj([]))]))])
        out["zones"] = .array(try ["due","shaky","known"].map { try zoneView(mem["zones"]![$0]!) }); out["skipped"] = try zoneView(skipped); out["ink"] = try V.inkParams(policy)
        let side = 34.0*(1-2*0.04); out["sample"] = V.obj([("side", .number(34)), ("inkSide", .number(side)), ("inkScale", .number(ImageLayout.minInkScale(side)))])
        var leave = ui?["leaveUndo"]?.objectValue
        if leave != nil { leave!["text"] = V.ref("R-W20.skippedToast", V.obj([("char", leave!["char"] ?? .null)])) }; out["leaveUndo"] = leave.map(JSValue.object) ?? .null
        out["undo"] = V.obj([("undo", V.ref("R-W20.undo")), ("failed", V.ref("R-W16.saveFailed")), ("cancel", V.ref("R-W16.cancel")), ("retry", V.ref("R-W16.retry"))]); return .object(out)
    }
}

extension ViewSupport {
    package static func libraryRecords(_ state: JSValue) -> (records: [JSValue], foldedDays: [String]) {
        var records: [JSValue] = [], days: [String] = []
        for month in (state["records"]?.objectValue?.keys ?? []).sorted() {
            let value = state["records"]![month]!
            records += value.arrayValue ?? value["kept"]?.arrayValue ?? []
            if value.arrayValue == nil { for (day, cs) in value["byDay"]?.objectValue?.entries ?? [] where !(cs.arrayValue ?? []).isEmpty { days.append(day) } }
        }
        return (records, days)
    }
    package static func successesOf(_ entry: JSValue?) -> Double { max(0, (JS.number(entry?["fsrs"]?["reps"]).isNaN ? 0 : JS.number(entry?["fsrs"]?["reps"])) - (JS.number(entry?["fsrs"]?["lapses"]).isNaN ? 0 : JS.number(entry?["fsrs"]?["lapses"]))) }
    package static func memoryZoneOf(_ record: JSValue, _ entry: JSValue?, today: String, knownDays: Double, minSuccesses: Double, dates: Dates) throws -> String {
        if record["judgment"] == .string("wrong") || record["kind"] == .string("answer-seen") { return "due" }
        if let entry, entry["stoppedAt"] == nil, let od = try ScheduleRules(dates: dates).overdueDays(entry, today), od >= 0 { return "due" }
        let stability = JS.number(entry?["fsrs"]?["stability"])
        return stability >= knownDays && successesOf(entry) >= minSuccesses ? "known" : "shaky"
    }
    package static func memoryZones(_ state: JSValue, today: String, knownDays: Double? = nil, minSuccesses: Double? = nil, dates: Dates) throws -> JSValue {
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
    package static func skippedZone(_ state: JSValue) -> JSValue {
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
    package static func customCharsOf(_ custom: JSValue?) -> [String] {
        var out = KeySet()
        for e in custom?["added"]?.arrayValue ?? [] { if let c = e["char"]?.stringValue, c.unicodeScalars.count == 1 { out.insert(c) } }; return out.items
    }
    package static func wallColumns(large: Bool, width: JSValue?) -> Int {
        guard let w = width?.numberValue, w.isFinite, w > 0 else { return large ? 6 : 8 }; return max(4, min(large ? 6 : 9, Int(floor((w-40)/44))))
    }
    package static func toneOf(_ day: JSValue?, today: String, days: JSValue?, dates: Dates) -> Int {
        guard dates.isValidDay(day ?? .null), dates.isValidDay(.string(today)), let ago = try? dates.diffDays(day!, .string(today)) else { return 3 }
        let d = (days?.arrayValue?.count ?? 0) >= 3 ? days!.arrayValue! : [7,30,90].map { .number(Double($0)) }
        for i in 0..<3 where ago <= JS.number(d[i]) { return i }; return 3
    }
}

