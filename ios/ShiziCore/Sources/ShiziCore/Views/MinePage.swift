import Foundation

public enum MinePageView {
    typealias V = ViewSupport
    public static func cellLabelRef(_ c: JSValue, dates: Dates) throws -> JSValue { try MineSubView.cellLabelRef(c, dates: dates) }
    public static func monthSheetCells(_ state: JSValue, month: String, policy: JSValue, dates: Dates) throws -> JSValue {
        let r = try ImageSelection.imagePlan(state, scope: V.obj([("kind", .string("month")), ("month", .string(month))]), inkOf: { try DetailView.builtInk(state, record: $0, dates: dates) }, hasInk: { DetailView.recordHasInk(state, record: $0, dates: dates) }, maxChars: Int(JS.number(policy["imageMaxChars"])), monthPick: policy["monthSheetPick"]?.stringValue ?? "first", dates: dates)
        let cells = try (r["cells"]?.arrayValue ?? []).enumerated().map { i,c -> JSValue in
            V.obj([("key", .string(JS.string(c["ch"])+"-"+String(i))), ("ch", c["ch"]!), ("mode", c["mode"]!), ("tag", c["tag"]!), ("day", JS.truthy(c["day"]) ? c["day"]! : .string("")), ("record", c["record"]?["id"] ?? .string("")), ("rec", c["record"] ?? .null), ("label", try cellLabelRef(c, dates: dates))])
        }
        return V.obj([("month", .string(month)), ("monthNum", .number(Double(month.suffix(2))!)), ("cells", .array(cells)), ("n", .number(Double(cells.count))), ("days", r["days"] ?? .number(0)), ("under", .bool(cells.contains { $0["mode"] == .string("under") })), ("kuan", cells.isEmpty ? .null : try KuanView.kuanRef(JSObject([("month", .string(month)), ("n", .number(Double(cells.count)))]), now: 0, dates: dates))])
    }
    public static func trimSheetCells(_ cells: [JSValue], max cap: Int = 80) -> JSValue {
        let n = cells.count
        if n <= cap { return V.obj([("cells", .array(cells)), ("truncated", .bool(false)), ("hidden", .number(0)), ("total", .number(Double(n)))]) }
        var prev: JSValue? = nil
        let shown = cells.suffix(max(0, cap)).map { c -> JSValue in
            var out = c.objectValue!; out["tag"] = JS.truthy(c["day"]) && c["day"] != prev ? .string(ImageLayout.dayTag(JS.string(c["day"]))) : .string("")
            if JS.truthy(c["day"]) { prev = c["day"] }; return .object(out)
        }
        return V.obj([("cells", .array(shown)), ("truncated", .bool(true)), ("hidden", .number(Double(n-cap))), ("total", .number(Double(n)))])
    }
    public static func mineSheetRows(_ n: Int, ax: Double) -> JSValue {
        let cols = ax > 0 && n > 0 ? min(4, ImageLayout.sheetColumns(n)) : ImageLayout.sheetColumns(n)
        return V.obj([("cols", .number(Double(cols))), ("max", .number(Double(cols*2)))])
    }
    public static func mineSheetView(_ state: JSValue, model: JSValue, policy: JSValue, width: Double, ax: Double, dates: Dates) throws -> JSValue {
        let month = JS.string(model["month"]), mv = try monthSheetCells(state, month: month, policy: policy, dates: dates), rows = mineSheetRows(Int(JS.number(mv["n"])), ax: ax), cols = Int(JS.number(rows["cols"])), trimmed = trimSheetCells(mv["cells"]!.arrayValue!, max: max(1, Int(JS.number(rows["max"])))), shown = trimmed["cells"]!.arrayValue!, n = mv["n"]!
        var out = JSObject([("month", .string(month)), ("monthNum", mv["monthNum"]!), ("title", V.ref("R-P02.sheetTitle", V.obj([("month", mv["monthNum"]!)]))), ("aria", V.ref("X-WORK.monthTitle", V.obj([("month", mv["monthNum"]!)]))), ("total", n), ("shown", .number(Double(shown.count))), ("truncated", trimmed["truncated"]!), ("days", model["sheet"]!["days"]!), ("all", JS.truthy(n) ? V.ref("R-M05.sheetAll", V.obj([("n", n)])) : .null), ("empty", shown.isEmpty ? V.ref("X-MINE.sheetEmpty") : .null), ("note", !shown.isEmpty && JS.truthy(mv["under"]) ? V.ref("X-WORK.monthUnderNote") : .null), ("paper", .null)])
        guard !shown.isEmpty else { return .object(out) }
        let g = try ImageLayout.sheetGrid(shown.count, width: width-40, cols: JS.truthy(trimmed["truncated"]) || ax > 0 ? cols : 0), tags = ImageLayout.sheetTags(shown), sign = !JS.truthy(trimmed["truncated"])
        var paper = JSObject()
        for k in ["cols", "rows", "c", "W", "H", "lastW", "full", "outline", "inner"] { paper[k] = g[k] }
        paper["pad"] = .number(0.12); paper["widthScale"] = .number(ImageLayout.inkWidthScale(JS.number(g["c"]))); paper["sign"] = .bool(sign); paper["kuan"] = sign ? mv["kuan"]! : .null
        paper["seal"] = V.obj([("size", .number(24)), ("below", g["full"]!), ("x", .number(JS.number(g["lastW"])+8)), ("y", .number(JS.number(g["H"])-24))]); paper["sealPath"] = try CoreResources.load("view-seal")
        paper["cells"] = .array(try shown.enumerated().map { i,c -> JSValue in
            let hand = c["mode"] == .string("hand") && JS.truthy(c["rec"]), point = g["cells"]!.arrayValue![i]
            return V.obj([("ch", c["ch"]!), ("mode", c["mode"]!), ("tag", tags[i]), ("day", c["day"]!), ("record", c["record"]!), ("label", c["label"]!), ("x", point["x"]!), ("y", point["y"]!), ("ink", hand ? V.obj([("points", try DetailView.builtInk(state, record: c["rec"], dates: dates) ?? .array([]))]) : .null), ("strokes", hand ? try QueryView.sheetStrokes(state, c["rec"], dates: dates) : .array([]))])
        }); out["paper"] = .object(paper); return .object(out)
    }
    public static func backupValueRef(_ model: JSValue, dates: Dates) throws -> JSValue {
        if let hint = model["backupHint"], JS.truthy(hint) { return hint["kind"] == .string("pressure") ? V.ref("X-MINE.backupNearFull") : V.ref("X-MINE.backupStale", V.obj([("n", hint["days"]!)])) }
        return JS.truthy(model["lastBackup"]) ? V.ref("R-M03.lastBackup", V.obj([("date", try MineSubView.dayTextRef(model["lastBackup"]!, dates: dates))])) : V.ref("R-M03.noBackup")
    }
    public static func mineChoices(_ view: JSValue, policy: JSValue, settings: JSValue? = nil) -> JSValue {
        let ap = view["appearance"] ?? .null, size = view["groupSize"] ?? .null
        func sizeRef(_ n: JSValue) -> JSValue { V.ref("X-SETTINGS.groupSizeValue", V.obj([("n", n)])) }
        let appearance = V.obj([("title", V.ref("R-S03.appearance")), ("value", ap), ("valueText", V.ref("R-S03.appearance."+JS.string(ap))), ("options", .array(["auto","light","dark"].map { id in V.obj([("id", .string(id)), ("label", V.ref("R-S03.appearance."+id)), ("aria", .null), ("sheetLabel", V.ref("R-S03.appearance."+id))]) }))])
        let group = V.obj([("title", V.ref("X-SETTINGS.groupSize")), ("value", size), ("valueText", sizeRef(size)), ("options", .array((policy["groupSizeOptions"]?.arrayValue ?? []).map { n in V.obj([("id", n), ("label", .string(JS.string(n))), ("aria", sizeRef(n)), ("sheetLabel", sizeRef(n))]) }))])
        // D83：新字比例档位（行右值 + 选择弹层；四个档位放不进行内分段）
        let tier = JSValue.string(TodayPlan.tierOf(settings, policy: policy))
        func tierRef(_ id: JSValue) -> JSValue { V.ref("X-SETTINGS.mixTier." + JS.string(id)) }
        let mix = V.obj([("title", V.ref("X-SETTINGS.mixTier")), ("value", tier), ("valueText", tierRef(tier)), ("options", .array(TodayPlan.tierIds(policy: policy).map { id in V.obj([("id", .string(id)), ("label", tierRef(.string(id))), ("aria", .null), ("sheetLabel", tierRef(.string(id)))]) }))])
        return V.obj([("appearance", appearance), ("groupSize", group), ("mixTier", mix)])
    }
    public static func mineView(_ state: JSValue, today: String, _ a: JSObject, dates: Dates) throws -> JSValue {
        // 一个 recordIndex 给本页模型与「年报」链接的缺省年份共用（AnnualView.annualDefaultYear 每个候选年份各建一次）
        let policy = V.policy(a["policy"]), index = V.recordIndex(state, dates: dates), m = try V.mineModel(state, today: today, policy: policy, hasInk: { DetailView.recordHasInk(state, record: $0, dates: dates) }, storagePressure: a["storagePressure"], dates: dates, index: index), view = SettingsView.settingsView(state["settings"]), year = V.annualDefaultYear(state, today: today, index: index)
        func stat(_ id: String, _ key: String, _ label: String, _ unit: String) -> JSValue { V.obj([("id", .string(id)), ("n", m["overview"]![key]!), ("label", V.ref(label)), ("unit", V.ref(unit))]) }
        var out = JSObject()
        out["title"] = V.ref("X-TABS.mine"); out["today"] = .string(today); out["month"] = m["month"]; out["empty"] = m["empty"]
        out["overview"] = .array([stat("streak","streak","X-MINE.ovStreak","X-MINE.ovDay"),stat("total","total","X-MINE.ovTotal","X-MINE.ovDay"),stat("chars","chars","X-MINE.ovChars","X-MINE.ovChar")])
        out["emptyBlock"] = JS.truthy(m["empty"]) ? V.obj([("title", V.ref("R-M04.emptyTitle")), ("body", V.ref("R-M04.emptyBody"))]) : .null
        out["sheet"] = JS.truthy(m["empty"]) ? .null : try mineSheetView(state, model: m, policy: policy, width: a["width"]?.numberValue ?? 402, ax: a["ax"]?.numberValue ?? 0, dates: dates)
        out["remind"] = V.obj([("label", V.ref("R-M03.remind")), ("on", view["on"]!), ("time", JS.truthy(view["on"]) ? .string(SettingsView.timeText(view["remind"]?["hour"], view["remind"]?["minute"])) : .null), ("off", V.ref("R-M03.remindOff")), ("to", .string("remind"))])
        out["library"] = V.obj([("label", V.ref("R-S01.library")), ("value", view["libraryName"]!), ("id", view["library"]!), ("to", .string("library-switch"))]); out["appearanceOn"] = view["appearanceSwitch"]; out["choices"] = mineChoices(view, policy: policy, settings: state["settings"])
        out["choiceFail"] = V.obj([("note", V.ref("X-SETTINGS.saveFailed")), ("cancel", V.ref("X-SETTINGS.cancel")), ("retry", V.ref("X-SETTINGS.retry"))]); out["done"] = V.ref("X-COMMON.done")
        out["backup"] = V.obj([("label", V.ref("R-M03.backup")), ("value", try backupValueRef(m, dates: dates)), ("last", JS.truthy(m["lastBackup"]) ? m["lastBackup"]! : .string("")), ("hint", m["backupHint"]?["kind"] ?? .string("")), ("to", .string("backup"))])
        out["annual"] = V.obj([("label", V.ref("X-MINE.annual")), ("year", .string(JS.string(year))), ("to", .string("annual")), ("params", year == m["year"] ? V.obj([]) : V.obj([("year", year)]))])
        out["about"] = V.obj([("label", V.ref("X-MINE.about")), ("to", .string("about"))]); out["records"] = V.obj([("to", .string("records")), ("params", V.obj([("month", m["month"]!)]))]); out["detail"] = V.obj([("to", .string("detail"))]); out["version"] = AboutView.versionRefs(a["build"]?["version"], a["build"]?["build"])["line"]
        return .object(out)
    }
}
