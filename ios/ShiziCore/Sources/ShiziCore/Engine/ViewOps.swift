import Foundation

extension CoreEngine {
    // Pure model results (as with images.*), without the App API transport envelope.
    static let viewOps: [String: Op] = [
        "view.home": { e, a in try HomeView.homeView(a["state"] ?? .null, now: a["now"]?.numberValue ?? e.clock, policy: ViewSupport.policy(a["policy"]), deck: a["deck"] == nil ? nil : deckOf(a), ui: a["ui"], dates: e.dates) },
        "view.home.model": { e, a in try HomeView.homeModel(a["state"] ?? .null, now: a["now"]?.numberValue ?? e.clock, policy: ViewSupport.policy(a["policy"]), deck: a["deck"] == nil ? nil : deckOf(a), dates: e.dates) },
        "view.home.resume": { e, a in try HomeView.resumeOf(a["state"] ?? .null, now: a["now"]?.numberValue ?? e.clock, policy: ViewSupport.policy(a["policy"]), dates: e.dates) },
        "view.home.helpers": { e, a in
            let m = a["model"] ?? .null, l = a["line"]
            return ViewSupport.obj([("records", .string(HomeView.recordsStateOf(a["state"] ?? .null, today: a["today"]?.stringValue ?? "", policy: ViewSupport.policy(a["policy"])))), ("last", HomeView.lastJudgedDayOf(Query.flattenRecords(a["state"]?["records"]))), ("view", .string(HomeView.homeViewOf(m))), ("count", .number(Double(Records.practicedByChar(Query.flattenRecords(a["state"]?["records"])).count))), ("cta", .string(HomeView.homeCtaKey(m))), ("note", HomeView.homeNoteOf(m)), ("resume", .string(HomeView.resumeKeyOf(a["kind"]))), ("progress", HomeView.progressText(l)), ("text", HomeView.resumeLineText(l)), ("aria", HomeView.resumeLineAria(l)), ("ctaAria", HomeView.ctaAria(m)), ("noChars", .bool(try HomeView.noCharsLeft(a["state"] ?? .null, today: a["today"]?.stringValue ?? "", deck: a["deck"] == nil ? nil : deckOf(a), policy: ViewSupport.policy(a["policy"]), dates: e.dates)))])
        },
        "view.library-all": { e, a in try LibraryAllView.allModel(a["state"] ?? .null, a, dates: e.dates) },
        "view.library-all.helpers": { e, a in
            var fold = LibraryAllView.normalizeFold(a["fold"]); fold[JS.string(a["month"])] = .bool(!JS.truthy(a["open"]))
            return ViewSupport.obj([("sort", .string(LibraryAllView.normalizeSort(a["sort"]))), ("filter", .string(LibraryAllView.normalizeFilter(a["filter"]))), ("fold", .object(LibraryAllView.normalizeFold(a["fold"]))), ("py", .string(Query.pyKey(a["py"]))), ("initial", LibraryAllView.pyInitial(a["py"])), ("find", LibraryAllView.parseFind(a["find"])), ("month", LibraryAllView.monthRef(JS.string(a["month"]), today: JS.string(a["today"]), found: false, dates: e.dates)), ("where", LibraryAllView.monthRef(JS.string(a["month"]), today: JS.string(a["today"]), found: true, dates: e.dates)), ("toggle", .object(fold)), ("take", .array(LibraryAllView.takeCells(a["groups"]?.arrayValue ?? [], limit: JS.number(a["limit"]))))])
        },
        "view.detail": { e, a in try DetailView.detailView(a["state"] ?? .null, char: string(a, "char"), today: string(a, "today"), etymology: a["etymology"], imageAction: JS.truthy(a["imageAction"]), dates: e.dates) },
        "view.detail.model": { e, a in try DetailView.detailModel(a["state"] ?? .null, char: string(a, "char"), today: string(a, "today"), policy: ViewSupport.policy(a["policy"]), hasInk: { DetailView.recordHasInk(a["state"] ?? .null, record: $0, dates: e.dates) }, dates: e.dates) },
        "view.detail-photo": { _, a in try DetailView.photoView(a["state"] ?? .null, char: string(a, "char")) },
        "view.detail.helpers": { e, a in
            let state = a["state"] ?? .null, char = try string(a, "char"), r = a["record"] ?? .null
            let model = try DetailView.detailModel(state, char: char, today: string(a, "today"), policy: ViewSupport.policy(a["policy"]), dates: e.dates)
            let ink = try DetailView.inkOf(state, record: r, dates: e.dates)
            return ViewSupport.obj([("base", .string("base:"+char)), ("records", .array(DetailView.recordsOfChar(state, char: char))), ("copy", DetailView.cellCopy(r, dates: e.dates)), ("list", try DetailView.listOf(Query.flattenRecords(state["records"]), sched: state["sched"], today: string(a, "today"), key: "base:"+char, dates: e.dates)), ("word", try DetailView.wordView(DeckCards.shared.cardForKey("base:"+char))), ("hero", DetailView.detailHero(model)), ("ink", ink), ("has", .bool(DetailView.recordHasInk(state, record: r, dates: e.dates))), ("points", .bool(DetailView.hasInkPoints(ink))), ("day", LibraryListView.dateText(a["day"], dates: e.dates)), ("photo", DetailView.photoOf(state, char: char))])
        },
        "view.library-list": { e, a in try LibraryListView.listModel(a["state"] ?? .null, a, dates: e.dates) },
        "view.library-list.entries": { e, a in .array(try LibraryListView.listEntries(a["state"] ?? .null, kind: a["kind"], today: string(a, "today"), policy: ViewSupport.policy(a["policy"]), dates: e.dates)) },
        "view.library-list.helpers": { e, a in
            let n = JS.number(a["n"]), model = a["model"]
            return ViewSupport.obj([("kind", .string(LibraryListView.normalizeKind(a["kind"]))), ("zone", .bool(LibraryListView.isZoneKind(a["kind"]))), ("parts", LibraryListView.listRowMetaParts(a["meta"])), ("date", LibraryListView.dateText(a["day"], dates: e.dates)), ("word", LibraryListView.wordParts(a["word"], a["char"])), ("sel", LibraryListView.normalizeSel(a["sel"]).map { .array($0.map(JSValue.string)) } ?? .null), ("same", .bool(LibraryListView.sameSel(a["sel"], a["other"]))), ("toggle", LibraryListView.toggleSel(a["sel"], a["char"] ?? .null)), ("all", .array((model?["rows"]?.arrayValue ?? []).filter { JS.truthy($0["selectable"]) }.map { $0["char"]! })), ("none", .array([])), ("button", LibraryListView.buttonLabel(n)), ("hint", LibraryListView.hintText(n)), ("active", .bool(LibraryListView.groupFromHereActive(a["state"] ?? .null, view: a["view"])) )])
        },
        "view.annual": { e, a in try AnnualView.annualModel(a["state"] ?? .null, today: string(a, "today"), year: a["year"], policy: ViewSupport.policy(a["policy"]), dates: e.dates) },
        "view.annual.plan": { e, a in try AnnualView.annualPlan(a["state"] ?? .null, today: string(a, "today"), year: a["year"], policy: ViewSupport.policy(a["policy"]), dates: e.dates) },
        "view.annual.years": { e, a in .array(AnnualView.annualYears(a["state"] ?? .null, dates: e.dates).map { .number(Double($0)) }) },
        "view.annual.defaultYear": { e, a in try AnnualView.annualDefaultYear(a["state"] ?? .null, today: string(a, "today"), dates: e.dates) },
        "view.annual.slice": { e, a in AnnualView.yearSlice(a["state"] ?? .null, year: Int(JS.number(a["year"])), dates: e.dates).js },
        "view.annual.first": { e, a in AnnualView.firstOfYear(AnnualView.yearSlice(a["state"] ?? .null, year: Int(JS.number(a["year"])), dates: e.dates), hasInk: nil, dates: e.dates) },
        "view.annual.twice": { e, a in try AnnualView.twiceOfYear(AnnualView.yearSlice(a["state"] ?? .null, year: Int(JS.number(a["year"])), dates: e.dates), hasInk: nil, dates: e.dates) },
        "view.annual.months": { e, a in .array(try AnnualView.yearMonths(a["state"] ?? .null, AnnualView.yearSlice(a["state"] ?? .null, year: Int(JS.number(a["year"])), dates: e.dates), policy: ViewSupport.policy(a["policy"]), dates: e.dates)) },
        "view.query": { e, a in try QueryView.querySheetModel(a, dates: e.dates) },
        "view.query.sheet": { _, a in QueryView.sheetModel(a) },
        "view.query.meta": { _, a in QueryView.cardMetaRef(a["pinyin"], a["strokes"]) },
        "view.query.stat": { _, a in QueryView.cardStatRef(a["summary"]) },
        "view.query.date": { e, a in try QueryView.dateRef(a["day"], dates: e.dates) },
        "view.query.ink": { e, a in try QueryView.inkPointsOf(a["summary"], state: a["state"], policy: ViewSupport.policy(a["policy"]), dates: e.dates) },
        "view.about": { _, a in try AboutView.aboutModel(a) },
        "view.about-privacy": { _, a in AboutView.privacyModel(a["native"]) },
        "view.about-credits": { _, a in AboutView.creditsModel(a["credits"]?.arrayValue ?? Config.credits["CREDITS"]!.arrayValue!, texts: a["texts"] ?? Config.credits["LICENSE_TEXTS"]!) },
        "view.about-letter": { _, _ in AboutView.letterModel() },
        "view.about.buildDay": { _, a in .string(AboutView.buildDay(a["build"])) },
        "view.about.stripArrow": { _, a in .string(AboutView.stripArrow(a["text"])) },
        "view.about.versionRefs": { _, a in AboutView.versionRefs(a["version"], a["build"]) },
        "view.about.rows": { _, _ in AboutView.aboutRowRefs() },
        "view.about.creditName": { _, a in AboutView.creditName(try required(a, "credit")) ?? .null },
        "view.about.creditFullText": { _, a in .string(AboutView.creditFullText(try required(a, "credit"), texts: a["texts"] ?? Config.credits["LICENSE_TEXTS"]!)) },
        "view.about.creditGroups": { _, a in .array(AboutView.creditGroupRefs(a["credits"]?.arrayValue ?? Config.credits["CREDITS"]!.arrayValue!)) },
        "view.settings": { _, a in SettingsView.settingsView(a["settings"], policy: ViewSupport.policy(a["policy"])) },
        "view.remind": { _, a in SettingsView.remindView(a["settings"], policy: ViewSupport.policy(a["policy"])) },
        "view.settings.parseTime": { _, a in SettingsView.parseTime(a["text"]) },
        "view.settings.timeText": { _, a in .string(SettingsView.timeText(a["hour"], a["minute"])) },
        "view.settings.defaultRemindTime": { _, a in SettingsView.defaultRemindTime(ViewSupport.policy(a["policy"])) },
        "view.library-switch": { _, a in LibrarySwitchView.libraryRows(a["state"], libraries: a["libraries"], current: a["current"]) },
        "view.library-switch.name": { _, a in LibrarySwitchView.libraryNameRef(a["id"]) },
        "view.library-switch.desc": { _, a in LibrarySwitchView.libraryDescRef(a["id"]) },
        "view.library-switch.judgedChars": { _, a in .array(LibrarySwitchView.judgedChars(a["state"]).map { .string($0) }) },
        "view.block": { _, a in try BlockView.blockView(a) },
        "view.block.reason": { _, a in BlockView.blockReasonOf(a["status"], migration: a["migration"]) },
        "view.block.hasJudged": { _, a in .bool(BlockView.hasJudged(a["state"])) },
        "view.block.backup": { e, a in try BlockView.blockBackup(try objArg(a, "state").objectValue!, serial: a["serial"]?.numberValue ?? 0, now: a["now"]?.numberValue ?? e.clock, dates: e.dates) },
        "view.session-none": { _, a in SessionView.noneView(a) },
        "view.kuan": { e, a in try KuanView.kuanRef(a, now: a["now"]?.numberValue ?? e.clock, dates: e.dates) },
        "view.kuan.date": { e, a in try KuanView.dateRef(a["day"], now: a["now"]?.numberValue ?? e.clock, dates: e.dates) },
        "view.kuan.month": { e, a in try KuanView.monthRef(required(a, "month"), dates: e.dates) },
        "view.kuan.part": { _, a in try KuanView.partRef(JS.number(a["i"])) },
        "view.kuan.year": { _, a in .string(try KuanView.annualYearText(JS.number(a["year"]))) },
        "view.kuan.cover": { _, a in try KuanView.annualCoverLineRef(JS.number(a["n"])) },
        "view.lines.measure": { _, a in
            let lines = ViewLines()
            if a["result"] != nil || a["throws"] == .bool(true) {
                lines.setLineMeasurer { _ in
                    if a["throws"] == .bool(true) { throw CoreError.error("measurement failed") }
                    return a["result"] ?? .null
                }
            }
            return lines.measureLines(a["spec"] ?? .null)
        },
    ]
}
