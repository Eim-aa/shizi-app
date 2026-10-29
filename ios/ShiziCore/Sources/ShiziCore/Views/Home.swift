import Foundation

// src/session/views/home.js
public enum HomeView {
    typealias V = ViewSupport
    static func lineOf(_ s: JSValue, slot: String) -> JSValue {
        let left = SessionRules.remainingCount(s), done = (s["items"]?.arrayValue ?? []).filter { JS.truthy($0) && $0["kind"] != .string("skipped") }.count
        var line = JSObject([("slot", .string(slot)), ("kind", s["kind"] ?? .null), ("remaining", .number(left)), ("done", .number(Double(done))), ("total", .number(Double(s["queue"]?.arrayValue?.count ?? 0)))])
        if left > 0 && s["current"]?["answerSeen"] == .bool(true) { line["remaining"] = .number(left-1); line["position"] = .number(JS.number(s["cursor"])+1) }; return .object(line)
    }
    public static func resumeOf(_ state: JSValue, now: Double, policy: JSValue, dates: Dates) throws -> JSValue {
        let rules = ScheduleRules(dates: dates), a = try rules.resumableSession(state, slot: "A", now: now, policy: policy), b = try rules.resumableSession(state, slot: "B", now: now, policy: policy)
        let hasA = JS.truthy(a), hasB = JS.truthy(b), la = hasA ? lineOf(a, slot: "A") : .null, lb = hasB ? lineOf(b, slot: "B") : .null
        return V.obj([("resume", .string(hasA && hasB ? "A+B" : hasB ? "B" : hasA ? "A" : "none")), ("primary", hasB ? lb : la), ("other", hasA && hasB ? la : .null), ("daily", la)])
    }
    public static func recordsStateOf(_ state: JSValue, today: String, policy: JSValue) -> String {
        let records = Query.flattenRecords(state["records"])
        if Records.todayCount(records, today) > 0 { return "record" }
        if Records.hasAnyJudged(records) { return "empty" }
        return ScheduleRules.aStartInfo(state, policy: policy).firstVisit ? "first" : "empty"
    }
    public static func lastJudgedDayOf(_ records: [JSValue]) -> JSValue {
        let days = records.filter(Records.isJudged).compactMap { $0["localDay"]?.stringValue }; return days.max().map(JSValue.string) ?? .null
    }
    public static func homeViewOf(_ m: JSValue) -> String {
        if m["resume"] != .string("none") { return "progress" }; if m["records"] == .string("first") { return "first" }
        if JS.truthy(m["capital"]) { return "special" }; if m["records"] == .string("record") { return "today" }
        if m["gapDays"] != .null && JS.number(m["gapDays"]) >= 7 { return "back" }; return "fresh"
    }
    public static func noCharsLeft(_ state: JSValue, today: String, deck: ScheduleDeck?, policy: JSValue, dates: Dates) throws -> Bool {
        guard let deck else { return false }
        let id = deck.currentLibraryId?(state["settings"]) ?? state["settings"]?["library"] ?? policy["defaultLibrary"] ?? .null
        if deck.newCandidates(id).contains(where: { deck.practicable($0) && !JS.truthy(state["sched"]?[$0]) }) { return false }
        let plan = try ScheduleRules(dates: dates).planDaily(state, today: today, deck: deck, policy: policy)
        return JS.truthy(plan["libraryExhausted"]) && (plan["queue"]?.arrayValue ?? []).isEmpty
    }
    public static func homeModel(_ state: JSValue, now: Double, policy: JSValue, deck: ScheduleDeck?, dates: Dates) throws -> JSValue {
        let today = try dates.localDay(.number(now)), records = Query.flattenRecords(state["records"]), rs = recordsStateOf(state, today: today, policy: policy)
        let resume = try resumeOf(state, now: now, policy: policy, dates: dates), on = resume["resume"] != .string("none")
        let special = deck != nil && !on && rs != "first" ? try ScheduleRules(dates: dates).planSpecial(state, today: today, deck: deck!, policy: policy) : .null
        let capital = special["kind"] ?? .null, last = lastJudgedDayOf(records), gap: JSValue = last == .null ? .null : .number(try dates.diffDays(last, .string(today)))
        let ep = try Epigraphs.epigraph(for: .string(today), dates: dates)
        var m = JSObject()
        m["switchLibrary"] = .bool(try deck != nil && !on && rs != "first" && !JS.truthy(capital) && (try noCharsLeft(state, today: today, deck: deck, policy: policy, dates: dates)))
        m["today"] = .string(today); m["period"] = .string(try dates.periodOf(.number(now))); m["dateParts"] = try dates.monthDayParts(.string(dates.calendarDay(.number(now))))
        m["epigraph"] = V.obj([("lines", .array(ep.lines.map(JSValue.string))), ("source", .string(ep.source))]); m["records"] = .string(rs)
        for k in ["resume", "primary", "other", "daily"] { m[k] = resume[k] }
        m["showRecord"] = .bool(rs == "record" && !on); m["showFirstTip"] = .bool(rs == "first" && !on); m["capital"] = capital; m["view"] = .string(homeViewOf(V.obj([("records", .string(rs)), ("resume", resume["resume"]!), ("capital", capital), ("gapDays", gap)]))); m["gapDays"] = gap
        m["view"] = .string(homeViewOf(.object(m))); m["libraryCount"] = .number(Double(Records.practicedByChar(records).count)); m["showPick"] = .bool(rs != "first" && resume["primary"]?["kind"] != .string("first"))
        return .object(m)
    }
    public static func homeCtaKey(_ m: JSValue) -> String {
        if m["resume"] != .string("none") { return m["primary"]?["kind"] == .string("picked") ? "X-HOME.continuePicked" : "X-HOME.continue" }
        if JS.truthy(m["switchLibrary"]) { return "X-HOME.switchLibrary" }
        return m["view"] == .string("first") || m["records"] != .string("record") ? "X-HOME.start" : "X-RESULT.again"
    }
    public static func homeNoteOf(_ m: JSValue) -> JSValue {
        if m["view"] == .string("back") { return QueryView.entry("X-HOME.backNote", V.obj([("n", m["libraryCount"] ?? .null)])) }
        return m["view"] == .string("special") ? QueryView.entry("X-HOME.capitalBody") : .null
    }
    public static func resumeKeyOf(_ kind: JSValue?) -> String { kind == .string("picked") ? "R-H04.resumePicked" : kind == .string("first") ? "R-H04.resumeFirst" : "R-H04.resumeDaily" }
    public static func progressText(_ l: JSValue?) -> JSValue { guard let l, JS.truthy(l) else { return .string("") }; return V.ref("X-HOME.progress", V.obj([("n", l["done"] ?? .null), ("total", l["total"] ?? .null)])) }
    public static func resumeLineText(_ l: JSValue?) -> JSValue { guard let l, JS.truthy(l) else { return .string("") }; return V.ref(resumeKeyOf(l["kind"]), V.obj([("n", l["done"] ?? .null), ("total", l["total"] ?? .null)])) }
    public static func resumeLineAria(_ l: JSValue?) -> JSValue {
        guard let l, JS.truthy(l) else { return .string("") }; let base = resumeKeyOf(l["kind"])
        if l["position"] == nil { return V.ref(base+"Aria", V.obj([("n", l["done"] ?? .null), ("total", l["total"] ?? .null)])) }
        return V.ref(base+(JS.number(l["remaining"]) > 0 ? "Now" : "NowLast"), V.obj([("k", l["position"]!), ("total", l["total"] ?? .null)]))
    }
    public static func ctaAria(_ m: JSValue) -> JSValue {
        let label = V.ref(homeCtaKey(m)); guard m["resume"] != .string("none"), let l = m["primary"], JS.truthy(l) else { return label }
        return V.ref("X-HOME.continueAria", V.obj([("label", label), ("n", l["done"] ?? .null), ("total", l["total"] ?? .null)]))
    }
    static let brandPath = try! CoreResources.load("view-brand")
    public static func homeView(_ state: JSValue, now: Double, policy: JSValue, deck: ScheduleDeck?, ui: JSValue?, dates: Dates) throws -> JSValue {
        let m = try homeModel(state, now: now, policy: policy, deck: deck, dates: dates), key = homeCtaKey(m), l = m["resume"] != .string("none") ? m["primary"] : nil, note = homeNoteOf(m), ep = m["epigraph"]!, other = m["other"]!
        var out = JSObject()
        for k in ["view", "records", "resume", "period", "today"] { out[k] = m[k] }
        out["title"] = V.ref("R-H01.title"); out["date"] = V.ref("R-H02.line", V.obj([("date", V.ref("R-H02.dateFormat", m["dateParts"])), ("period", V.ref("R-H02.period."+JS.string(m["period"])))]))
        out["shiLabel"] = V.ref("X-HOME.shiLabel")
        let e = try Epigraphs.epigraph(for: m["today"]!, dates: dates)
        out["epigraph"] = V.obj([("index", .number(try Epigraphs.indexFor(day: m["today"]!, dates: dates))), ("lines", ep["lines"]!), ("author", .string(Epigraphs.author(of: e))), ("label", .string(e.lines.joined()+e.source))])
        out["motto"] = .array((1...3).map { V.ref("X-HOME.mottoLine"+String($0)) })
        out["cta"] = V.obj([("label", V.ref(key)), ("progress", JS.truthy(l) && !JS.truthy(m["switchLibrary"]) ? progressText(l) : .null), ("aria", JS.truthy(m["switchLibrary"]) ? V.ref(key) : ctaAria(m)), ("action", .string(JS.truthy(m["switchLibrary"]) ? "switchLibrary" : "start"))])
        out["note"] = JS.truthy(note) ? V.obj([("kind", .string(m["view"] == .string("special") ? "capital" : "back")), ("text", V.ref(JS.string(note["key"]), note["vars"]))]) : .null
        out["capital"] = m["capital"]
        out["firstTip"] = m["view"] == .string("first") ? V.ref("R-H03.firstVisit") : .null
        out["other"] = JS.truthy(other) ? V.obj([("slot", other["slot"]!), ("kind", other["kind"]!), ("remaining", other["remaining"]!), ("text", resumeLineText(other)), ("aria", resumeLineAria(other))]) : .null
        out["pick"] = JS.truthy(m["showPick"]) ? V.ref("X-HOME.pick") : .null; out["defer"] = m["view"] == .string("special") ? V.ref("X-HOME.capitalDefer") : .null
        out["fail"] = V.obj([("text", V.ref("X-HOME.startFailed")), ("cancel", V.ref("R-H06.cancel")), ("retry", V.ref("R-H06.retry"))])
        out["undo"] = V.obj([("undo", V.ref("R-W20.undo")), ("failed", V.ref("R-W16.saveFailed")), ("cancel", V.ref("R-W16.cancel")), ("retry", V.ref("R-W16.retry"))])
        out["shi"] = brandPath; out["seal"] = try CoreResources.load("view-seal"); out["brand"] = .bool(JS.truthy(ui?["brand"]))
        var leave = ui?["leaveUndo"]?.objectValue
        if leave != nil { leave!["text"] = V.ref("R-W20.skippedToast", V.obj([("char", leave!["char"] ?? .null)])) }; out["leaveUndo"] = leave.map(JSValue.object) ?? .null
        return .object(out)
    }
}
