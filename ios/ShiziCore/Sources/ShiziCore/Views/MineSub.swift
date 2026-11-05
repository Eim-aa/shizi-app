import Foundation

// Mine sub-page views. Line starts preserve the injected provider
// contract; actual text measurement belongs to the renderer.
public enum MineSubView {
    typealias V = ViewSupport
    public static func monthHeadRef(_ n: JSValue) -> JSValue { V.ref("X-MINE.monthHead", V.obj([("month", n)])) }
    public static func dayTextRef(_ day: JSValue, dates: Dates) throws -> JSValue { V.ref("R-H02.dateFormat", try dates.monthDayParts(day)) }
    public static func dayCellLabelRef(_ c: JSValue, dates: Dates) throws -> JSValue {
        let date: JSValue = JS.truthy(c["day"]) ? try dayTextRef(c["day"]!, dates: dates) : .string(""), inkDay = c["record"]?["localDay"]
        if JS.truthy(inkDay), JS.truthy(c["day"]), inkDay != c["day"] { return V.ref("X-WORK.cellInkDay", V.obj([("char", c["ch"]!), ("date", date), ("inkDate", try dayTextRef(inkDay!, dates: dates))])) }
        return V.ref("X-MINE.cellLabel", V.obj([("char", c["ch"]!), ("date", date)]))
    }
    public static func cellLabelRef(_ c: JSValue, dates: Dates) throws -> JSValue {
        c["mode"] == .string("under") ? V.ref("X-WORK.monthCellNoInk", V.obj([("char", c["ch"]!)])) : try dayCellLabelRef(c, dates: dates)
    }
    static func cellModel(_ ch: JSValue, record: JSValue?, mode: JSValue, day: JSValue?, tag: JSValue?, dates: Dates) throws -> JSObject {
        let r = record.flatMap { JS.truthy($0) ? $0 : nil }
        var out = JSObject([("ch", ch), ("ink", .null), ("mode", mode), ("tag", JS.truthy(tag) ? tag! : .string("")), ("day", JS.truthy(day) ? day! : .string("")), ("recordId", r?["id"] ?? .string("")), ("recordDay", r?["localDay"] ?? .string(""))])
        var c = out; c["record"] = r ?? .null; out["label"] = try cellLabelRef(.object(c), dates: dates); return out
    }
    /// ink：这次回答共用的 builtInk 记忆（RecordInkMemo.builtInk(state, dates:)），缺省现建一个；imagePlan 的 hasInk（挑有墨迹的那一次）与取点共用它，每条记录只解一次。
    /// 回 {cells, days}：= imagePlan(month)（inkOf = builtInk）的这两项（ImageSelection.monthPlanCells；这里只读这两项，不再为整份计划分页、拼 drawn）。
    /// rows：同一次回答里共用的 ImageSelection.monthRows(state)（年报每月），缺省现平铺。
    static func monthCells(_ state: JSValue, month: String, policy: JSValue, dates: Dates, ink memo: RecordInkMemo? = nil, rows: [JSValue]? = nil) throws -> JSValue {
        let ink = memo ?? RecordInkMemo.builtInk(state, dates: dates)
        let r = try ImageSelection.monthPlanCells(state, month: month, inkOf: { try ink.get($0) }, monthPick: policy["monthSheetPick"]?.stringValue ?? "first", rows: rows, dates: dates)
        return V.obj([("cells", .array(r.cells)), ("days", r.days)])
    }
    static func displayMonth(_ state: JSValue, month: String, policy: JSValue, block: Bool, dates: Dates, ink: RecordInkMemo? = nil) throws -> JSValue {
        let r = try monthCells(state, month: month, policy: policy, dates: dates, ink: ink), raw = r["cells"]?.arrayValue ?? []
        if block && raw.isEmpty { return .null }
        var cells = try raw.enumerated().map { i, c -> JSValue in
            var out = try cellModel(c["ch"]!, record: c["record"], mode: c["mode"]!, day: c["day"], tag: c["tag"], dates: dates)
            out["key"] = .string(JS.string(c["ch"])+"-"+String(i)); out["ink"] = JS.truthy(c["ink"]) ? V.obj([("points", c["ink"]!)]) : .null; return .object(out)
        }
        let tags = ImageLayout.sheetTags(cells)
        cells = cells.enumerated().map { i, c in var o = c.objectValue!; o["tag"] = tags[i]; return .object(o) }
        let n = cells.count, mn = Double(month.suffix(2))!
        var out = JSObject([("month", .string(month)), ("monthNum", .number(mn)), ("cells", .array(cells)), ("n", .number(Double(n))), ("days", r["days"] ?? .number(0)), ("under", .bool(cells.contains { $0["mode"] == .string("under") }))])
        out["kuan"] = n > 0 ? try Copy.tRef(KuanView.kuanRef(JSObject([("month", .string(month)), ("n", .number(Double(n)))]), now: 0, dates: dates)) : .string("")
        out["cols"] = .number(Double(ImageLayout.sheetColumns(n)))
        // = recordIndex(state).folded[month] != nil：索引只收 records 里 folded === true 的月（键逐码点，与直接取这个月相同），不必为一个布尔值重建整个索引
        if block { out["folded"] = .bool(state["records"]?[month]?["folded"] == .bool(true)); out["title"] = V.ref("R-P02.sheetTitle", V.obj([("month", .number(mn))])) }
        out["seal"] = try CoreResources.load("view-seal")
        if !block { out["lines"] = V.obj([("sub", ViewLineStarts.starts("month-sub", V.ref("X-MINE.sheetOrder")))]) }; return .object(out)
    }
    public static func monthView(_ state: JSValue, month: String, policy: JSValue, dates: Dates) throws -> JSValue { try displayMonth(state, month: month, policy: policy, block: false, dates: dates) }
    public static func monthSheetOf(_ state: JSValue, month: String, policy: JSValue, dates: Dates) throws -> JSValue { try monthSheetOf(state, month: month, policy: policy, dates: dates, ink: nil) }
    static func monthSheetOf(_ state: JSValue, month: String, policy: JSValue, dates: Dates, ink: RecordInkMemo?) throws -> JSValue { try displayMonth(state, month: month, policy: policy, block: true, dates: dates, ink: ink) }
    public static func sheetGeometry(_ n: Int, width: Double) -> JSValue {
        if n == 0 { return V.obj([("n", .number(0)), ("cols", .number(0)), ("rows", .number(0)), ("c", .number(0)), ("W", .number(0)), ("H", .number(0)), ("lastW", .number(0)), ("full", .bool(true)), ("cells", .array([]))]) }
        let cols = ImageLayout.sheetColumns(n), rows = Int(ceil(Double(n)/Double(cols))), c = floor(min(110, width/Double(cols))), last = n-(rows-1)*cols
        return V.obj([("n", .number(Double(n))), ("cols", .number(Double(cols))), ("rows", .number(Double(rows))), ("c", .number(c)), ("W", .number(Double(cols)*c)), ("H", .number(Double(rows)*c)), ("lastW", .number(Double(last)*c)), ("full", .bool(last == cols)), ("cells", .array((0..<n).map { i in V.obj([("x", .number(Double(i%cols)*c)), ("y", .number(Double(i/cols)*c)), ("col", .number(Double(i%cols))), ("row", .number(Double(i/cols)))]) }))])
    }
    public static func recordsView(_ state: JSValue, today: String, _ a: JSObject, dates: Dates) throws -> JSValue {
        let policy = V.policy(a["policy"]), m = try V.recordsModel(state, today: today, month: a["month"], day: a["day"], policy: policy, dates: dates, withSheet: false) // m["sheet"] 这里不读
        let calendar = m["calendar"]!.arrayValue!.map { c -> JSValue in
            let b = JS.truthy(c["blank"])
            return V.obj([("key", c["key"]!), ("blank", .bool(b)), ("day", b ? .string("") : c["day"]!), ("n", b ? .number(0) : c["n"]!), ("has", .bool(!b && JS.truthy(c["has"]))), ("today", .bool(!b && JS.truthy(c["today"]))), ("future", .bool(!b && JS.truthy(c["future"])))])
        }
        // 选中日的格与下面的月报块共用一份 builtInk 记忆（同一条记录常在两处都出现）
        let ink = RecordInkMemo.builtInk(state, dates: dates)
        var selected: JSValue = .null
        if let s = m["selected"], JS.truthy(s) {
            let cells = try s["items"]!.arrayValue!.map { it -> JSValue in
                let pts = try ink.get(it["record"])
                var c = try cellModel(it["char"]!, record: it["record"], mode: .string(pts != nil ? "hand" : "under"), day: s["day"], tag: .string(""), dates: dates)
                c["key"] = .string("d-"+JS.string(it["char"])); c["ink"] = pts.map { V.obj([("points", $0)]) } ?? .null
                var label = c; label["record"] = it["record"]; c["label"] = try dayCellLabelRef(.object(label), dates: dates); return .object(c)
            }
            selected = V.obj([("day", s["day"]!), ("title", V.ref("R-P03.todayChars", V.obj([("date", try dayTextRef(s["day"]!, dates: dates))]))), ("paper", .bool(cells.isEmpty)), ("paperNote", V.ref("X-MINE.paperDayNote")), ("cells", .array(cells))])
        }
        let has = JS.truthy(m["recordDays"]), title = V.ref(has ? "R-P01.monthDays" : "X-MINE.monthNone", V.obj(has ? [("month", m["monthNum"]!), ("n", m["recordDays"]!)] : [("month", m["monthNum"]!)])), legend = V.ref(has ? "R-P01.legend" : "R-P04.empty")
        let dayList = try m["dayList"]!.arrayValue!.map { r -> JSValue in V.obj([("day", r["day"]!), ("n", r["n"]!), ("today", r["today"]!), ("label", V.ref(JS.truthy(r["n"]) ? "X-MINE.axDayRow" : "X-MINE.axDayRowPaper", V.obj(JS.truthy(r["n"]) ? [("date", try dayTextRef(r["day"]!, dates: dates)), ("n", r["n"]!)] : [("date", try dayTextRef(r["day"]!, dates: dates))])))]) }
        let sheet = try monthSheetOf(state, month: JS.string(m["month"]), policy: policy, dates: dates, ink: ink)
        var out = JSObject()
        for k in ["today", "month", "year", "monthNum", "current", "prev", "next"] { out[k] = m[k] }
        out["monthHead"] = monthHeadRef(m["monthNum"]!); out["yearText"] = .string(JS.string(m["year"])); out["title"] = title; out["legend"] = legend; out["weekdays"] = V.ref("X-MINE.weekdays"); out["calendar"] = .array(calendar); out["recordDays"] = m["recordDays"]; out["dayList"] = .array(dayList); out["selected"] = selected; out["sheet"] = sheet
        if let r = m["todayRow"], JS.truthy(r) { out["todayRow"] = V.obj([("day", r["day"]!), ("n", r["n"]!), ("title", V.ref("R-P03.todayChars", V.obj([("date", try dayTextRef(r["day"]!, dates: dates))]))), ("note", V.ref("R-P03.todayImage"))]) } else { out["todayRow"] = .null }
        out["seal"] = try CoreResources.load("view-seal"); out["lines"] = V.obj([("title", ViewLineStarts.starts("records-title", title)), ("legend", ViewLineStarts.starts("records-legend", legend)), ("dayRows", .array(dayList.map { ViewLineStarts.starts("records-axrow", $0["label"]!) })), ("paperday", JS.truthy(selected) ? ViewLineStarts.starts("records-paperday", selected["paperNote"]!) : .null), ("daylistTitle", JS.truthy(selected) ? ViewLineStarts.starts("records-daylist-title", selected["title"]!) : .null), ("sheetNote", JS.number(sheet["n"]) > 0 && JS.truthy(sheet["under"]) ? ViewLineStarts.starts("records-sheet-note", V.ref("X-WORK.monthUnderNote")) : .null)])
        return .object(out)
    }
    public static func annualView(_ state: JSValue, today: String, year: JSValue?, policy: JSValue, dates: Dates) throws -> JSValue {
        try annualView(state, today: today, year: year, policy: policy, dates: dates, index: V.recordIndex(state, dates: dates))
    }
    /// index：调用方已用同一 state / dates 建好的 recordIndex（MineSubAPI 挑缺省年份时建的那个）。
    package static func annualView(_ state: JSValue, today: String, year: JSValue?, policy: JSValue, dates: Dates, index: V.RecordIndex) throws -> JSValue {
        // 年报每月的成员要算两遍（模型里数成员、这里取格），全量平铺一次给它们共用
        let rows = ImageSelection.monthRows(state)
        let m = try AnnualView.annualModel(state, today: today, year: year, policy: policy, hasInk: nil, dates: dates, index: index, rows: rows)
        // 首字、每月的格（含 monthCells 里挑墨迹与取点）、两次对比共用一份 builtInk 记忆：每条记录的墨迹只解一次
        let ink = RecordInkMemo.builtInk(state, dates: dates)
        func points(_ r: JSValue?) throws -> JSValue { try ink.get(r).map { V.obj([("points", $0)]) } ?? .null }
        func cell(_ ch: JSValue, _ r: JSValue?) throws -> JSValue { let p = try points(r); var c = try cellModel(ch, record: r, mode: .string(JS.truthy(p) ? "hand" : "under"), day: .string(""), tag: .string(""), dates: dates); c["ink"] = p; return .object(c) }
        var first: JSValue = .null
        if let f = m["first"], JS.truthy(f) {
            let p = try points(f["record"]), ch = f["char"]!, date = try dayTextRef(f["day"]!, dates: dates)
            first = V.obj([("char", ch), ("day", f["day"]!), ("recordId", f["record"]?["id"] ?? .string("")), ("ink", p), ("label", V.ref(JS.truthy(p) ? "X-ANNUAL.firstInk" : "X-ANNUAL.firstNoInk", V.obj([("char", ch)]))), ("date", JS.truthy(p) ? V.ref("R-M06.inkDate", V.obj([("date", date)])) : date)])
        }
        let months = try m["months"]!.arrayValue!.map { month -> JSValue in
            let r = try monthCells(state, month: JS.string(month["month"]), policy: policy, dates: dates, ink: ink, rows: rows), raw = r["cells"]?.arrayValue ?? [], n = JSValue.number(Double(raw.count)), mn = month["monthNum"]!
            return V.obj([("month", month["month"]!), ("monthNum", mn), ("n", n), ("name", V.ref("X-WORK.annualMonthName", V.obj([("month", mn)]))), ("count", V.ref("X-WORK.annualMonthCount", V.obj([("n", n)]))), ("aria", V.ref("X-WORK.annualMonthAria", V.obj([("month", mn), ("n", n)]))), ("cells", .array(try raw.map { try cell($0["ch"]!, $0["record"]) }))])
        }
        var twice: JSValue = .null
        if let t = m["twice"], JS.truthy(t) {
            func half(_ k: String, _ label: String) throws -> JSValue { let r = t[k]!; return try V.obj([("recordId", r["record"]!["id"]!), ("day", r["day"]!), ("ink", points(r["record"])), ("label", V.ref(label, V.obj([("char", t["char"]!)]))), ("date", dayTextRef(r["day"]!, dates: dates))]) }
            twice = try V.obj([("char", t["char"]!), ("title", V.ref("X-WORK.annualTwiceTitle")), ("first", half("first", "X-WORK.annualFirstCellAria")), ("last", half("last", "X-WORK.annualLastCellAria"))])
        }
        var out = JSObject()
        for k in ["today", "year", "years", "prevYear", "nextYear", "empty", "count", "days"] { out[k] = m[k] }
        out["coverYear"] = .string(try KuanView.annualYearText(JS.number(m["year"]))); out["coverLine"] = try KuanView.annualCoverLineRef(JS.number(m["count"])); out["first"] = first; out["months"] = .array(months); out["twice"] = twice
        for (k,key) in [("emptyTitle","R-M06.emptyTitle"),("emptyBody","R-M06.emptyBody"),("emptyGlyph","X-ANNUAL.emptyGlyph"),("adjust","X-WORK.adjustImage"),("adjustAria","X-WORK.adjustAria"),("save","R-M01.saveImage")] { out[k] = V.ref(key) }
        out["seal"] = try CoreResources.load("view-seal"); out["lines"] = V.obj([("head", ViewLineStarts.starts("annual-head", out["coverLine"]!)), ("firstDate", JS.truthy(first) ? ViewLineStarts.starts("annual-first-date", first["date"]!) : .null)]); return .object(out)
    }
}
