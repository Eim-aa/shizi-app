import Foundation

public enum LibraryListView {
    typealias V = ViewSupport
    public static func normalizeKind(_ kind: JSValue?) -> String {
        let k = JS.string(kind)
        for s in ["forget", "due", "shaky", "known", "skipped"] where k == s || k == s + "List" { return s }; return "wrong"
    }
    public static func isZoneKind(_ kind: JSValue?) -> Bool { ["due", "shaky", "known", "skipped"].contains(normalizeKind(kind)) }
    public static func listRowMetaParts(_ meta: JSValue?) -> JSValue {
        let parts = (meta == nil || meta == .null ? "" : JS.string(meta)).components(separatedBy: " · ")
        return .array(parts.enumerated().map { .string($0.offset < parts.count - 1 ? $0.element + " ·" : $0.element) })
    }
    public static func dateText(_ day: JSValue?, dates: Dates) -> JSValue {
        guard JS.truthy(day), let p = try? dates.monthDayParts(day!) else { return .string("") }; return V.ref("R-H02.dateFormat", p)
    }
    public static func wordParts(_ word: JSValue?, _ char: JSValue?) -> JSValue {
        let w = word?.stringValue ?? "", c = char?.stringValue ?? ""
        if w.isEmpty || JSX.eq(w, c) { return V.obj([("pre", .string("")), ("tg", .string("")), ("post", .string("")), ("has", .bool(false))]) }
        let cps = w.unicodeScalars.map(String.init)
        guard let i = cps.firstIndex(where: { JSX.eq($0, c) }) else { return V.obj([("pre", .string(w)), ("tg", .string("")), ("post", .string("")), ("has", .bool(true))]) }
        return V.obj([("pre", .string(cps[..<i].joined())), ("tg", .string(c)), ("post", .string(cps[(i+1)...].joined())), ("has", .bool(true))])
    }
    public static func normalizeSel(_ sel: JSValue?) -> [String]? {
        guard let a = sel?.arrayValue else { return nil }; var seen = KeySet()
        for c in a { if let s = c.stringValue, !s.isEmpty { seen.insert(s) } }; return seen.items
    }
    public static func sameSel(_ a: JSValue?, _ b: JSValue?) -> Bool {
        let x = normalizeSel(a), y = normalizeSel(b)
        guard let x, let y else { return x == nil && y == nil }; let set = KeySet(x)
        return x.count == y.count && y.allSatisfy { set.contains($0) }
    }
    public static func toggleSel(_ cur: JSValue?, _ char: JSValue) -> JSValue {
        let list = (normalizeSel(cur) ?? []).map(JSValue.string)
        return .array(list.contains(char) ? list.filter { $0 != char } : list + [char])
    }
    public static func buttonLabel(_ n: Double) -> JSValue { V.ref(n > 1 ? "R-E02.btnMany" : n == 1 ? "R-E02.btnOne" : "R-E02.btnNone") }
    public static func hintText(_ n: Double) -> JSValue { n > 0 ? V.ref("R-E02.selected", V.obj([("n", .number(n))])) : V.ref("R-E02.selectedZero") }
    public static func listEntries(_ state: JSValue, kind: JSValue?, today: String, policy: JSValue, dates: Dates) throws -> [JSValue] {
        let records = Query.flattenRecords(state["records"]), k = normalizeKind(kind)
        func entry(_ r: JSValue, _ count: Int) -> JSValue { V.obj([("cardKey", r["cardKey"]!), ("char", r["char"]!), ("record", r), ("count", .number(Double(count))), ("day", r["localDay"]!)]) }
        if isZoneKind(kind) {
            let zone = k == "skipped" ? V.skippedZone(state) : try V.memoryZones(state, today: today, dates: dates)["zones"]![k]!
            return zone["items"]!.arrayValue!.map { r in entry(r["record"]!, Records.judgedCountOfCard(records, JS.string(r["cardKey"]))) }
        }
        if k == "wrong" { return Records.wrongList(records).map { entry($0, Records.wrongCountOfCard(records, JS.string($0["cardKey"]))) } }
        let fl = try Records.forgetList(records: records, sched: state["sched"], today: .string(today), dates: dates, policy: policy.objectValue)
        return fl.items.map { entry($0.record, Records.judgedCountOfCard(records, $0.cardKey)) }
    }
    public static func listModel(_ state: JSValue, _ a: JSObject, dates: Dates) throws -> JSValue {
        let kind = normalizeKind(a["kind"]), wrong = kind == "wrong", zone = isZoneKind(.string(kind)), chosen = normalizeSel(a["sel"]), chosenSet = KeySet(chosen ?? []), policy = V.policy(a["policy"])
        let limit = GroupSize.listDefaultSelectOf(state["settings"], policy: policy)
        let entries = try listEntries(state, kind: .string(kind), today: a["today"]?.stringValue ?? "", policy: policy, dates: dates)
        func practicable(_ key: String) -> Bool { a["unpracticable"]?.arrayValue?.contains(.string(key)) != true }
        var seen = 0, topEnd = 0
        for (i, e) in entries.enumerated() where Double(seen) < limit && practicable(JS.string(e["cardKey"])) { seen += 1; topEnd = i+1 }
        let rows = entries.enumerated().map { i, e -> JSValue in
            let key = JS.string(e["cardKey"]), c = a["cards"]?[key] ?? DeckCards.shared.cardForKey(key), selectable = practicable(key), inTop = i < topEnd
            let selected = selectable && (chosen != nil ? chosenSet.contains(JS.string(e["char"])) : inTop), date = dateText(e["day"], dates: dates), r = e["record"]!
            let rowWrong = wrong || (zone && r["judgment"] == .string("wrong")), skipped = kind == "skipped", seenOnly = zone && r["kind"] == .string("answer-seen")
            let meta = skipped ? V.ref("X-LIBFOUR.skippedMeta", V.obj([("date", date)])) : seenOnly ? V.ref("X-LIBFOUR.seenMeta", V.obj([("date", date)])) : V.ref(rowWrong ? "R-E03.wrongMeta" : "R-E03.forgetMeta", V.obj([("date", date), ("n", e["count"]!)]))
            return V.obj([("char", e["char"]!), ("cardKey", e["cardKey"]!), ("recordId", r["id"]!), ("record", r), ("day", e["day"]!), ("count", e["count"]!), ("word", wordParts(c?["word"], e["char"])), ("meta", meta), ("thumbCaption", rowWrong ? V.ref("R-E03.wrongThumb") : .string("")), ("noThumb", .bool(skipped || seenOnly)), ("selectable", .bool(selectable)), ("selected", .bool(selected)), ("group", .string(inTop ? "top" : "rest"))])
        }
        let top = rows.filter { $0["group"] == .string("top") }, topSelectable = top.filter { JS.truthy($0["selectable"]) }.count, rest = rows.count-top.count
        let selectedKeys = rows.filter { JS.truthy($0["selected"]) }.map { $0["cardKey"]! }, n = selectedKeys.count, selectableCount = rows.filter { JS.truthy($0["selectable"]) }.count
        let all = selectableCount > 0 && n == selectableCount
        let view = ["wrong":"wrongList", "forget":"forgetList", "due":"dueList", "shaky":"shakyList", "known":"knownList", "skipped":"skippedList"][kind]!
        var out = JSObject()
        out["kind"] = .string(kind); out["view"] = .string(view)
        out["title"] = V.ref(zone ? "X-LIBFOUR.zone."+kind : wrong ? "R-E04.titleWrong" : "R-E04.titleForget")
        out["empty"] = .bool(rows.isEmpty)
        out["emptyGlyph"] = V.ref(zone ? "X-LIBFOUR.emptyGlyph."+kind : wrong ? "X-LIST.emptyGlyphWrong" : "X-LIST.emptyGlyphForget")
        out["emptyTitle"] = V.ref(zone ? "X-LIBFOUR.zoneEmptyTitle" : wrong ? "R-E04.wrongEmpty" : "X-LIST.forgetEmptyTitle")
        out["emptyBody"] = V.ref(zone ? "X-LIBFOUR.zoneEmptyBody."+kind : wrong ? "X-LIST.wrongEmptyBody" : "R-E04.forgetEmpty")
        out["head"] = V.ref(topSelectable > 0 ? "X-LIST.firstHead" : "X-LIST.countHead", V.obj([("n", .number(Double(topSelectable > 0 ? topSelectable : rows.count)))]))
        out["topCount"] = .number(Double(top.count)); out["restCount"] = .number(Double(rest))
        out["restLabel"] = rest > 0 ? V.ref("X-LIST.restShow", V.obj([("n", .number(Double(rest)))])) : .string("")
        out["restHideLabel"] = rest > 0 ? V.ref("X-LIST.restHide", V.obj([("n", .number(Double(rest)))])) : .string("")
        out["customSel"] = .bool(chosen != nil)
        out["top"] = V.ref(zone ? "X-LIBFOUR.zoneTop."+kind : wrong ? "R-E04.wrongTop" : "R-E04.forgetTop")
        out["note"] = V.ref(Copy.inkKey(wrong ? "R-E03.wrongNote" : "R-E03.forgetNote", perRecordInk: JS.truthy(policy["features"]?["perRecordInk"])))
        out["rows"] = .array(rows); out["selectedKeys"] = .array(selectedKeys); out["selectedCount"] = .number(Double(n)); out["selectableCount"] = .number(Double(selectableCount)); out["allSelected"] = .bool(all)
        out["toggleAllLabel"] = V.ref(all ? "X-LIST.selectNone" : "X-LIST.selectAll"); out["hint"] = hintText(Double(n)); out["button"] = V.obj([("label", buttonLabel(Double(n))), ("disabled", .bool(n == 0))])
        return .object(out)
    }
    public static func groupFromHereActive(_ state: JSValue, view: JSValue?) -> Bool {
        guard let b = state["sessions"]?["B"], let q = b["queue"]?.arrayValue, JS.number(b["cursor"]) < Double(q.count) else { return false }
        let v = b["source"]?["view"] == .string("againList") ? .string("wrongList") : b["source"]?["view"]
        return v == view
    }
}
