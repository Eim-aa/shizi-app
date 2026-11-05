import Foundation

// Detail view. Recalled ink is an injected session-memory value;
// with the shipped perRecordInk policy JS recalledInk always returns null.
public enum DetailView {
    typealias V = ViewSupport
    public static func recordsOfChar(_ state: JSValue, char: String) -> [JSValue] { Records.sortById(Query.flattenRecords(state["records"]).filter { $0["char"] == .string(char) }) }
    public static func cellCopy(_ r: JSValue, dates: Dates) -> JSValue {
        let caption = V.ref(r["judgment"] == .string("wrong") ? "X-RESULT.cellWrong" : "X-RESULT.cellCorrect"), date = LibraryListView.dateText(r["localDay"], dates: dates)
        return V.obj([("date", date), ("caption", caption), ("title", JS.truthy(date) ? V.ref("X-DETAIL.cellTitle", V.obj([("date", date), ("caption", caption)])) : caption)])
    }
    public static func listOf(_ records: [JSValue], sched: JSValue?, today: String, key: String, dates: Dates) throws -> JSValue {
        let latest = Records.sortById(records.filter { Records.isJudged($0) && $0["cardKey"] == .string(key) }).last
        guard let latest else { return .null }; if latest["judgment"] == .string("wrong") { return .string("wrong") }
        return try V.memoryZoneOf(latest, sched?[key], today: today, knownDays: JS.number(Config.policy["knownZone"]?["stabilityDays"]), minSuccesses: JS.number(Config.policy["knownZone"]?["minSuccesses"]), dates: dates) == "due" ? .string("forget") : .null
    }
    public static func wordView(_ card: JSValue?) throws -> JSValue {
        guard let card, JS.truthy(card) else { return V.obj([("hasWord", .bool(false)), ("tiles", .array([])), ("gloss", .string(""))]) }
        if DeckCards.hasContextWord(card) {
            let tiles = (card["chars"]?.arrayValue ?? []).enumerated().map { i, ch in V.obj([("ch", ch), ("blank", .bool(card["ci"] == .number(Double(i))))]) }
            return V.obj([("hasWord", .bool(true)), ("tiles", .array(tiles)), ("gloss", .string(""))])
        }
        return try V.obj([("hasWord", .bool(false)), ("tiles", .array([])), ("gloss", Cards.promptModel(card)["contentHint"] ?? .string(""))])
    }
    public static func inkOf(_ state: JSValue, record: JSValue?, recalled: JSValue? = nil, dates: Dates) throws -> JSValue {
        guard let record, JS.truthy(record) else { return V.obj([("points", .null), ("strokes", .null)]) }
        if let decoded = try InkMath.decodeInk(QueryView.inkOf(state, record, dates: dates)), !decoded.isEmpty { return V.obj([("points", .array(InkMath.resampleForReplay(decoded).map { .array($0.map(\.js)) })), ("strokes", .null)]) }
        let raw = recalled?[JS.string(record["id"])]
        return V.obj([("points", .null), ("strokes", !(raw?.arrayValue ?? []).isEmpty ? raw! : .null)])
    }
    public static func recordHasInk(_ state: JSValue, record: JSValue?, recalled: JSValue? = nil, dates: Dates) -> Bool {
        guard let record, JS.truthy(record) else { return false }
        return InkPick.inkHasStrokes(QueryView.inkOf(state, record, dates: dates)) || !(recalled?[JS.string(record["id"])]?.arrayValue ?? []).isEmpty
    }
    public static func hasInkPoints(_ ink: JSValue?) -> Bool { !(ink?["points"]?.arrayValue ?? []).isEmpty || !(ink?["strokes"]?.arrayValue ?? []).isEmpty }
    static func builtInk(_ state: JSValue, record: JSValue?, dates: Dates) throws -> JSValue? {
        let ink = try inkOf(state, record: record, dates: dates), pts = ink["points"]?.arrayValue ?? []
        return pts.contains { !($0.arrayValue ?? []).isEmpty } ? .array(pts) : nil
    }
    public static func detailModel(_ state: JSValue, char: String, today: String, policy: JSValue, hasInk: InkPick.HasInk = { _ in false }, dates: Dates) throws -> JSValue {
        let key = "base:"+char, base = DeckCards.shared.cardForKey(key), off = state["wordOff"]?[key] != nil, card = DeckCards.withWordOff(base, state["wordOff"])
        let all = Query.flattenRecords(state["records"]), judged = Records.sortById(all.filter { $0["char"] == .string(char) }).filter(Records.isJudged), latest = judged.last // = recordsOfChar(state, char:)，只平铺一次
        let screen = judged.filter { !Records.isPaperRecord($0) }, paper = judged.filter(Records.isPaperRecord), inkLatest = screen.last, entry = state["sched"]?[key]
        let due = !judged.isEmpty && JS.truthy(policy["features"]?["nextReviewLine"]) && entry?["due"]?.stringValue != nil ? entry!["due"]! : .null
        let added = state["custom"]?["added"]?.arrayValue ?? [], ci = added.firstIndex { $0["char"] == .string(char) }
        let image = try latest == nil ? "noRecord" : inkLatest == nil || !(try hasInk(inkLatest!)) ? "noInk" : "ok"
        var out = JSObject()
        out["char"] = .string(char); out["cardKey"] = .string(key); out["card"] = card ?? .null; out["baseCard"] = base ?? .null; out["practicable"] = .bool(base != nil)
        out["pinyin"] = card?["py"].flatMap { JS.truthy($0) ? $0 : nil } ?? .string(""); out["strokes"] = JS.number(card?["strokes"]) > 0 ? card!["strokes"]! : .number(0); out["word"] = try wordView(card)
        out["canSwapWord"] = .bool(!off && base != nil && DeckCards.hasContextWord(base)); out["wordOff"] = .bool(off); out["originalWord"] = base?["word"] ?? .string("")
        out["judged"] = .array(judged); out["count"] = .number(Double(judged.count)); out["first"] = judged.first ?? .null; out["latest"] = latest ?? .null; out["cells"] = .array(screen); out["paperRows"] = .array(paper)
        out["inkFirst"] = screen.first ?? .null; out["inkLatest"] = inkLatest ?? .null; out["imageRecord"] = inkLatest ?? .null; out["list"] = try listOf(all, sched: state["sched"], today: today, key: key, dates: dates); out["due"] = due; out["image"] = .string(image)
        out["custom"] = .bool(ci != nil); out["customIndex"] = .number(Double(ci ?? -1)); out["customEntry"] = ci.map { added[$0] } ?? .null; out["photo"] = state["photos"]?[char] ?? .null; out["photoCountsAsRecord"] = .bool(policy["legacyPhotoCountsAsRecord"] == .bool(true))
        return .object(out)
    }
    public static func detailHero(_ m: JSValue) -> JSValue {
        let screen = m["cells"]?.arrayValue ?? []; guard let first = screen.first, let last = screen.last else { return V.obj([("kind", .string("ref")), ("cells", .array([]))]) }
        var cells = [V.obj([("kind", .string("first")), ("record", first)])]
        if first["id"] != last["id"] { cells.append(V.obj([("kind", .string("latest")), ("record", last)])) }; return V.obj([("kind", .string("ink")), ("cells", .array(cells))])
    }
    /// 一格的墨迹：(有没有可画的点, 有就是 QueryView.sheetStrokes 的笔画，没有是 [])。墨迹只解一次、不做回放重采样。
    /// = (hasInkPoints(inkOf(state, record: r)), has ? QueryView.sheetStrokes(state, r) : [])：inkOf（没有 recalled）里 points 非空 ⇔ decodeInk 的结果非空
    /// （resampleForReplay 逐笔映射、笔数不变），strokes 恒为 null；sheetStrokes 取 decodeInkRaw ?? decodeInk ?? []，同一份墨迹 decodeInk 结果相同，直接用这次解出的。
    /// 抛错与原来同处（decodeInk）。笔画的写法与 sheetStrokes 同（测试里逐格比对）。
    static func cellInk(_ state: JSValue, _ r: JSValue, dates: Dates) throws -> (has: Bool, strokes: JSValue) {
        guard JS.truthy(r) else { return (false, JSValue.array([])) }
        let ink = QueryView.inkOf(state, r, dates: dates)
        guard let decoded = try InkMath.decodeInk(ink), !decoded.isEmpty else { return (false, JSValue.array([])) }
        let points = InkMath.decodeInkRaw(ink) ?? decoded
        return (true, JSValue.array(points.map { .array($0.map { .array([.number($0.x), .number($0.y), .number($0.t ?? 0)] + ($0.p.map { [.number($0)] } ?? [])) }) }))
    }
    static func changeable(_ r: JSValue) -> Bool { Records.isJudged(r) && !JS.truthy(r["legacy"]) && !Records.isPaperRecord(r) }
    public static func detailView(_ state: JSValue, char: String, today: String, etymology: JSValue?, imageAction: Bool, dates: Dates) throws -> JSValue {
        // hasInk 只问 inkLatest，它随后又是首图那一格：记住最近算过的一格，同一条记录不再解第二次（cellInk 只取决于记录的值与 state）
        var memo: (record: JSValue, ink: (has: Bool, strokes: JSValue))?
        func wire(_ r: JSValue) throws -> (has: Bool, strokes: JSValue) {
            if let hit = memo, hit.record == r { return hit.ink }
            let w = try cellInk(state, r, dates: dates); memo = (record: r, ink: w); return w
        }
        let m = try detailModel(state, char: char, today: today, policy: Config.policy, hasInk: { try wire($0).has }, dates: dates), hero = detailHero(m)
        let heroCells = try hero["cells"]!.arrayValue!.map { c -> JSValue in
            let r = c["record"]!, (has, strokes) = try wire(r), title = cellCopy(r, dates: dates)["title"]!, label = V.ref(c["kind"] == .string("first") ? "X-DETAIL.heroFirst" : "X-DETAIL.heroLatest")
            return V.obj([("kind", c["kind"]!), ("title", title), ("changeable", .bool(changeable(r))), ("recordId", r["id"]!), ("judgment", r["judgment"]!), ("wrong", .bool(r["judgment"] == .string("wrong"))), ("hasInk", .bool(has)), ("strokes", strokes), ("caption", V.ref("X-DETAIL.heroCaption", V.obj([("label", label), ("date", LibraryListView.dateText(r["localDay"], dates: dates))]))), ("aria", V.ref("X-DETAIL.heroCellLabel", V.obj([("label", label), ("text", has ? title : V.ref("X-DETAIL.cellNoInkLabel", V.obj([("text", title)])))])))])
        }
        let ids = heroCells.map { $0["recordId"]! }
        let cells = try m["cells"]!.arrayValue!.filter { !ids.contains($0["id"]!) }.map { r -> JSValue in
            let (has, strokes) = try wire(r), c = cellCopy(r, dates: dates), title = c["title"]!
            return V.obj([("recordId", r["id"]!), ("title", title), ("changeable", .bool(changeable(r))), ("judgment", r["judgment"]!), ("wrong", .bool(r["judgment"] == .string("wrong"))), ("hasInk", .bool(has)), ("strokes", strokes), ("first", .bool(r == m["inkFirst"])), ("latest", .bool(r == m["inkLatest"])), ("date", c["date"]!), ("caption", c["caption"]!), ("aria", has ? title : V.ref("X-DETAIL.cellNoInkLabel", V.obj([("text", title)])))])
        }
        let paper = m["paperRows"]!.arrayValue!.map { r -> JSValue in
            let date = LibraryListView.dateText(r["localDay"], dates: dates), caption = V.ref(r["judgment"] == .string("wrong") ? "X-RESULT.cellWrong" : "X-RESULT.cellCorrect")
            return V.obj([("recordId", r["id"]!), ("judgment", r["judgment"]!), ("date", date), ("caption", caption), ("tag", V.ref("X-DETAIL.paperTag")), ("label", V.ref("X-DETAIL.paperRowLabel", V.obj([("date", date), ("caption", caption)])))])
        }
        var rows: [JSValue] = []
        if JS.truthy(m["list"]) { rows.append(V.obj([("key", .string("list")), ("kind", m["list"]!), ("title", V.ref("X-LIBFOUR.zone.due")), ("sub", V.ref(m["list"] == .string("wrong") ? "R-D01.wrongLine" : "R-D01.forgetLine")), ("to", V.obj([("screen", .string("library-list")), ("params", V.obj([("kind", .string("due"))]))]))])) }
        if JS.truthy(m["due"]) { rows.append(V.obj([("key", .string("next")), ("title", V.ref("R-D02.nextReview", V.obj([("date", LibraryListView.dateText(m["due"], dates: dates))]))), ("starts", ViewLineStarts.starts("detail-next", V.ref("R-D02.nextReview", V.obj([("date", LibraryListView.dateText(m["due"], dates: dates))]))))])) }
        if imageAction {
            var r = JSObject([("key", .string("image")), ("state", m["image"]!), ("title", V.ref("R-D04.makeImage"))])
            if m["image"] != .string("ok") { r["note"] = V.ref(m["image"] == .string("noInk") ? Copy.inkKey("R-D04.noInkNote") : "R-D04.noRecordNote") }; rows.append(.object(r))
        }
        if JS.truthy(m["photo"]) { rows.append(V.obj([("key", .string("legacy")), ("title", V.ref("X-DETAIL.legacyEntry")), ("to", V.obj([("screen", .string("detail-photo")), ("params", V.obj([("char", .string(char))]))]))])) }
        if JS.truthy(m["canSwapWord"]) { rows.append(V.obj([("key", .string("swap")), ("title", V.ref("R-D05.swapWord"))])) }
        if JS.truthy(m["custom"]) { rows.append(V.obj([("key", .string("remove")), ("title", V.ref("R-D06.rowTitle")), ("sub", V.ref("R-D06.rowSub"))])) }
        if !JS.truthy(m["custom"]) && JS.truthy(m["practicable"]) { rows.append(V.obj([("key", .string("add")), ("title", V.ref("R-Q05.btnAdd"))])) }
        let word = m["word"]!, n = m["strokes"]!
        var out = JSObject()
        for k in ["char", "cardKey", "practicable", "pinyin", "originalWord", "wordOff", "custom", "list"] { out[k] = m[k] }
        out["ink"] = try V.inkParams(Config.policy); out["title"] = V.ref("X-DETAIL.pageTitle", V.obj([("char", .string(char))])); out["practice"] = V.ref("R-D08.btnPractice")
        out["strokes"] = JS.truthy(n) ? V.obj([("n", n), ("label", V.ref("X-DETAIL.strokes", V.obj([("n", n)])))]) : .null
        out["word"] = JS.truthy(m["card"]) ? V.obj([("hasWord", word["hasWord"]!), ("label", V.ref(JS.truthy(word["hasWord"]) ? "X-DETAIL.wordLabel" : "X-DETAIL.glossLabel")), ("text", JS.truthy(word["hasWord"]) ? m["card"]!["word"]! : .string("")), ("tiles", word["tiles"]!), ("gloss", word["gloss"]!)]) : .null
        out["hero"] = V.obj([("kind", hero["kind"]!), ("cells", .array(heroCells))]); out["refLabel"] = V.ref("R-W09.labelReference")
        out["records"] = JS.number(m["count"]) > 0 ? V.obj([("count", m["count"]!), ("countLabel", V.ref("R-D03.count", V.obj([("n", m["count"]!)]))), ("cells", .array(cells)), ("paperRows", .array(paper))]) : V.obj([("count", .number(0)), ("countLabel", V.ref("R-D03.none")), ("empty", V.ref("X-DETAIL.emptyNote")), ("cells", .array([])), ("paperRows", .array([]))])
        out["source"] = JS.truthy(etymology) ? V.obj([("label", V.ref("X-DETAIL.sourceLabel")), ("gloss", etymology!["gloss"] ?? .null), ("from", JS.truthy(etymology?["source"]) ? etymology!["source"]! : .string(""))]) : .null
        out["rows"] = .array(rows); return V.ordered(.object(out), "char cardKey ink title practicable practice pinyin strokes word originalWord wordOff hero refLabel records source rows custom list")
    }
    public static func photoOf(_ state: JSValue, char: String) -> JSValue { guard let p = state["photos"]?[char], p["dataURL"]?.stringValue?.hasPrefix("data:image/") == true else { return .null }; return p }
    public static func photoView(_ state: JSValue, char: String) -> JSValue {
        V.obj([("char", .string(char)), ("title", V.ref("R-D10.title", V.obj([("char", .string(char))]))), ("alt", V.ref("X-DETAIL.photoAlt")), ("caption", V.ref("X-DETAIL.legacyEntry")), ("body", V.ref("R-D10.body")), ("photo", photoOf(state, char: char)["dataURL"] ?? .null)])
    }
}
