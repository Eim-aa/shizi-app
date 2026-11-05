import Foundation

// 首页视图模型。D83（调度规则 v2）起首页显示今天的进度：没写完「今天的练习 n / N」，写完「今天完成了 ✓」+「再来一组」。
public enum HomeView {
    typealias V = ViewSupport
    static func lineOf(_ s: JSValue, slot: String, plan: TodayPlan.Progress? = nil) -> JSValue {
        // 已写 = 写过第一次的字（重考、跳过不算），总数 = 这一组几个字（重考插回的不重复算）；今天的练习那一组按今天的进度（自选写过的也算）
        let left = SessionRules.remainingCount(s), items = s["items"]?.arrayValue ?? []
        var done = items.filter { JS.isString($0["kind"], "judged") || JS.isString($0["kind"], "answer-seen") }.count
        var total = Set((s["queue"]?.arrayValue ?? []).compactMap { $0.stringValue }).count
        if let plan, TodayPlan.isPlan(s) { done = plan.n; total = plan.total }
        var line = JSObject([("slot", .string(slot)), ("kind", s["kind"] ?? .null), ("remaining", .number(left)), ("done", .number(Double(done))), ("total", .number(Double(total)))])
        if left > 0 && s["current"]?["answerSeen"] == .bool(true) { line["remaining"] = .number(left-1); line["position"] = .number(JS.number(s["cursor"])+1) }; return .object(line)
    }
    public static func resumeOf(_ state: JSValue, now: Double, policy: JSValue, dates: Dates, plan: TodayPlan.Progress? = nil) throws -> JSValue {
        let rules = ScheduleRules(dates: dates), a = try rules.resumableSession(state, slot: "A", now: now, policy: policy), b = try rules.resumableSession(state, slot: "B", now: now, policy: policy)
        let hasA = JS.truthy(a), hasB = JS.truthy(b), la = hasA ? lineOf(a, slot: "A", plan: plan) : .null, lb = hasB ? lineOf(b, slot: "B") : .null
        return V.obj([("resume", .string(hasA && hasB ? "A+B" : hasB ? "B" : hasA ? "A" : "none")), ("primary", hasB ? lb : la), ("other", hasA && hasB ? la : .null), ("daily", la)])
    }
    public static func recordsStateOf(_ state: JSValue, today: String, policy: JSValue) -> String {
        recordsStateOf(state, records: Query.flattenRecords(state["records"]), today: today, policy: policy)
    }
    /// records = Query.flattenRecords(state["records"])（首页一次构建只平铺一次，与 homeModel 共用）。
    static func recordsStateOf(_ state: JSValue, records: [JSValue], today: String, policy: JSValue) -> String {
        if Records.todayCount(records, today) > 0 { return "record" }
        if Records.hasAnyJudged(records) { return "empty" }
        return ScheduleRules.aStartInfo(state, policy: policy).firstVisit ? "first" : "empty"
    }
    /// 判断过的记录里最大的 localDay（字串）。= filter(isJudged).compactMap(localDay).max()：同一个 `<`，只在严格更大时替换（与 Sequence.max 相同），不建中间数组。
    public static func lastJudgedDayOf(_ records: [JSValue]) -> JSValue {
        var best: String?
        for r in records where Records.isJudged(r) {
            guard let d = r["localDay"]?.stringValue else { continue }
            if let b = best, !(b < d) { continue }
            best = d
        }
        return best.map(JSValue.string) ?? .null
    }
    /// progress（有没写完的组）> first > special（大写数字）> today（今天的练习写完了）> back（离开一周、今天还没写）> fresh。
    public static func homeViewOf(_ m: JSValue) -> String {
        if m["resume"] != .string("none") { return "progress" }; if m["records"] == .string("first") { return "first" }
        if JS.truthy(m["capital"]) { return "special" }; if m["plan"]?["done"] == .bool(true) { return "today" }
        if m["gapDays"] != .null && JS.number(m["gapDays"]) >= 7 && JS.number(m["plan"]?["n"]) == 0 { return "back" }; return "fresh"
    }
    public static func noCharsLeft(_ state: JSValue, today: String, deck: ScheduleDeck?, policy: JSValue, dates: Dates, statsMemo: PracticeStatsMemo? = nil) throws -> Bool {
        guard let deck else { return false }
        let id = deck.currentLibraryId?(state["settings"]) ?? state["settings"]?["library"] ?? policy["defaultLibrary"] ?? .null
        if deck.newCandidates(id).contains(where: { deck.practicable($0) && !JS.truthy(state["sched"]?[$0]) }) { return false }
        let plan = try ScheduleRules(dates: dates).planDaily(state, today: today, deck: deck, policy: policy, statsMemo: statsMemo)
        return JS.truthy(plan["libraryExhausted"]) && (plan["queue"]?.arrayValue ?? []).isEmpty
    }
    public static func homeModel(_ state: JSValue, now: Double, policy: JSValue, deck: ScheduleDeck?, dates: Dates) throws -> JSValue {
        let today = try dates.localDay(.number(now)), records = Query.flattenRecords(state["records"]), rs = recordsStateOf(state, records: records, today: today, policy: policy)
        let statsMemo = PracticeStatsMemo() // 进度 / 特别组 / noCharsLeft 里的 selectDaily、specialPlan 共用一次 practiceStats
        let plan = rs == "first" ? TodayPlan.Progress(n: 0, total: 0, done: false, active: false) : try TodayPlan.progress(state, day: today, rules: ScheduleRules(dates: dates), deck: deck, policy: policy, statsMemo: statsMemo)
        let resume = try resumeOf(state, now: now, policy: policy, dates: dates, plan: plan), on = resume["resume"] != .string("none")
        let special = deck != nil && !on && rs != "first" ? try ScheduleRules(dates: dates).planSpecial(state, today: today, deck: deck!, policy: policy, statsMemo: statsMemo) : .null
        let capital = special["kind"] ?? .null, last = lastJudgedDayOf(records), gap: JSValue = last == .null ? .null : .number(try dates.diffDays(last, .string(today)))
        let ep = try Epigraphs.epigraph(for: .string(today), dates: dates)
        var m = JSObject()
        m["switchLibrary"] = .bool(try deck != nil && !on && rs != "first" && !JS.truthy(capital) && (try noCharsLeft(state, today: today, deck: deck, policy: policy, dates: dates, statsMemo: statsMemo)))
        m["today"] = .string(today); m["period"] = .string(try dates.periodOf(.number(now))); m["dateParts"] = try dates.monthDayParts(.string(dates.calendarDay(.number(now))))
        m["epigraph"] = V.obj([("lines", .array(ep.lines.map(JSValue.string))), ("source", .string(ep.source))]); m["records"] = .string(rs)
        for k in ["resume", "primary", "other", "daily"] { m[k] = resume[k] }
        m["plan"] = V.obj([("n", .number(Double(plan.n))), ("total", .number(Double(plan.total))), ("done", .bool(plan.done)), ("active", .bool(plan.active))])
        m["showRecord"] = .bool(rs == "record" && !on); m["showFirstTip"] = .bool(rs == "first" && !on); m["capital"] = capital; m["gapDays"] = gap
        m["view"] = .string(homeViewOf(.object(m))); m["libraryCount"] = .number(Double(Records.practicedByChar(records).count)); m["showPick"] = .bool(rs != "first" && resume["primary"]?["kind"] != .string("first"))
        return .object(m)
    }
    public static func homeCtaKey(_ m: JSValue) -> String {
        if m["resume"] != .string("none") { return m["primary"]?["kind"] == .string("picked") ? "X-HOME.continuePicked" : "X-HOME.continue" }
        if JS.truthy(m["switchLibrary"]) { return "X-HOME.switchLibrary" }
        return m["view"] == .string("today") ? "X-RESULT.again" : "X-HOME.start"
    }
    /// 按钮上方那一行：离开一周 / 大写数字 / 今天完成了 / 今天的练习 n / N（有组没写完时进度在按钮上，不重复）。
    public static func homeNoteOf(_ m: JSValue) -> JSValue {
        if m["view"] == .string("back") { return QueryView.entry("X-HOME.backNote", V.obj([("n", m["libraryCount"] ?? .null)])) }
        if m["view"] == .string("special") { return QueryView.entry("X-HOME.capitalBody") }
        if m["view"] == .string("first") || JS.truthy(m["switchLibrary"]) { return .null }
        if m["plan"]?["done"] == .bool(true) { return QueryView.entry("X-TODAY.done") }
        if m["view"] == .string("fresh"), JS.number(m["plan"]?["total"]) > 0 { return QueryView.entry("X-TODAY.progress", V.obj([("n", m["plan"]!["n"]!), ("total", m["plan"]!["total"]!)])) }
        return .null
    }
    static func noteKind(_ m: JSValue, key: String) -> String {
        switch key { case "X-HOME.capitalBody": return "capital"; case "X-TODAY.done": return "done"; case "X-TODAY.progress": return "today"; default: return "back" }
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
        out["note"] = JS.truthy(note) ? V.obj([("kind", .string(noteKind(m, key: JS.string(note["key"])))), ("text", V.ref(JS.string(note["key"]), note["vars"]))]) : .null
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
