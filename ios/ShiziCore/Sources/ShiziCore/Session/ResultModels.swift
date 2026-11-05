import Foundation

// Result page base view and cell contract.
public enum ResultModels {
    static func items(_ s: JSValue?, records: [JSValue]) -> [JSValue] {
        guard let s else { return records.map { JS.obj([("cardKey", $0["cardKey"]!), ("recordId", $0["id"]!), ("kind", $0["kind"]!)]) } }
        var items = (s["items"]?.arrayValue ?? []).filter { !TodayPlan.isRetryItem($0) } // D83 重考不进格子 / 作品
        if s["current"]?["answerSeen"] == .bool(true), let key = SessionRules.currentCardKey(s), !items.contains(where: { $0["cardKey"] == key }), let r = records.last(where: { $0["kind"] == .string("answer-seen") && $0["cardKey"] == key && $0["sessionId"] == s["id"] }) {
            items.append(JS.obj([("cardKey", key), ("recordId", r["id"]!), ("kind", .string("answer-seen"))]))
        }; return items
    }
    static func cells(_ state: JSObject, _ a: JSObject) throws -> [JSValue] {
        let s = SessionResults.locate(state, a)?.session, records = Records.sortById(RecordLookup.records(state, .session, a["sessionId"]).filter { $0["sessionId"] == a["sessionId"] })
        return try items(s, records: records).enumerated().map { i,it in
            let record = records.first { $0["id"] == it["recordId"] }, kind = record?["kind"] ?? it["kind"] ?? .null
            let judgment = kind == .string("judged") ? record?["judgment"] ?? .null : .null
            return JS.obj([("index", .number(Double(i))), ("cardKey", it["cardKey"] ?? .null), ("recordId", record?["id"] ?? it["recordId"] ?? .null), ("char", record?["char"] ?? Records.charOfCardKey(it["cardKey"]).map(JSValue.string) ?? .null), ("kind", kind), ("judgment", judgment), ("caption", try Copy.t(kind == .string("judged") ? (judgment == .string("wrong") ? "X-RESULT.cellWrong" : "X-RESULT.cellCorrect") : kind == .string("answer-seen") ? "R-R02.cellSaw" : "X-RESULT.cellSkipped")), ("canChange", .bool(kind == .string("judged") && record != nil && !JS.truthy(record?["legacy"]) && s != nil && SessionRules.canCorrect(s, record?["id"])))])
        }
    }
    public static func leaveOf(_ source: JSValue?) throws -> JSValue {
        let view = source?["view"]?.stringValue ?? "home", char = source?["char"]?.stringValue.map(JSValue.string) ?? .null
        let keys = ["wrongList":"R-R06.leaveWrong", "againList":"R-R06.leaveWrong", "forgetList":"R-R06.leaveForget", "dueList":"X-LIBFOUR.leave.due", "shakyList":"X-LIBFOUR.leave.shaky", "knownList":"X-LIBFOUR.leave.known", "skippedList":"X-LIBFOUR.leave.skipped", "allWritten":"R-R06.leaveAll", "mine":"R-R06.leaveMine", "library":"R-R06.leaveLibrary", "home":"X-RESULT.leaveHome"]
        if view == "detail", JS.truthy(char) { return JS.obj([("view", .string(view)), ("char", char), ("label", try Copy.t("R-R06.leaveDetail", JSObject([("char", char)])))]) }
        if let key = keys[view] { return JS.obj([("view", .string(view == "againList" ? "wrongList" : view)), ("char", char), ("label", try Copy.t(key))]) }
        return JS.obj([("view", .string("home")), ("char", .null), ("label", try Copy.t("X-RESULT.leaveHome"))])
    }
    public static func model(_ state: JSObject, _ a: JSObject, dates: Dates, hasInk: InkPick.HasInk? = nil) throws -> JSValue {
        let found = SessionResults.locate(state, a), s = found?.session
        let records = Records.sortById(RecordLookup.records(state, .session, a["sessionId"]).filter { $0["sessionId"] == a["sessionId"] })
        let cells = try cells(state, a), variant = s.map { $0["kind"] == .string("picked") ? "picked" : $0["kind"] == .string("first") ? "first" : "daily" } ?? (a["slot"] == .string("B") ? "picked" : "daily")
        let early = JS.truthy(s?["endedEarly"])
        // 还没写的字（D83：只算还没写过第一次的字，待重考的不算）
        let unwritten = s.map { s in Double(Set(SessionRules.remainingKeys(s).compactMap { k in TodayPlan.attempts(s, k) == 0 ? k.stringValue : nil }).count) } ?? 0
        let source = JS.truthy(s?["source"]) ? s!["source"]! : JS.obj([("view", .string("home"))])
        var day: JSValue = .null
        if let s {
            let at = s["endedAt"]?.numberValue.flatMap { $0.isFinite ? $0 : nil } ?? s["updatedAt"]?.numberValue
            if let at, at.isFinite { day = .string(try dates.localDay(.number(at))) } else { day = JS.truthy(s["startedDay"]) ? s["startedDay"]! : .null }
        }
        let work: JSValue = cells.isEmpty ? .null : ImageSelection.buildWork(items: items(s, records: records), records: records, hasInk: hasInk ?? { record in
            let month = String((record["localDay"]?.stringValue ?? "").prefix(7)), id = JS.string(record["inkId"] ?? record["id"])
            return JS.truthy(state["ink"]?[month]?[id]) || (RecentInk.page.recalledInk(record["id"], policy: a["policy"] ?? Config.policy).arrayValue ?? []).contains { !($0.arrayValue ?? []).isEmpty }
        }, added: ImageSelection.addedOf(s))
        var sub: [JSValue] = []
        if variant != "first" && early && unwritten > 0 { sub.append(try Copy.t("R-R05.bodyEarly", JSObject([("n", .number(unwritten))]))) }
        // D83 完成画面：写对 / 重考过关 / 明天再来 / 新学；今天的练习那一组写完时标题「今天完成了」
        let complete = s.map { SessionRules.isComplete($0) && !early } ?? false
        if variant != "first", complete, let s {
            let sum = TodayPlan.summary(s, records: RecordLookup.forSummary(state, s))
            sub.append(try Copy.t("X-TODAY.summary", JSObject([("correct", .number(Double(sum.correct))), ("passed", .number(Double(sum.passed))), ("again", .number(Double(sum.again))), ("fresh", .number(Double(sum.fresh)))])))
        }
        let doneTitle: JSValue = variant == "daily" && complete && TodayPlan.isPlan(s) ? try Copy.t("X-TODAY.doneTitle") : .null
        let value = JS.obj([("found", .bool(s != nil)), ("where", found.map { .string($0.ended ? "ended" : "slot") } ?? .null), ("session", s ?? .null), ("slot", a["slot"] ?? .null), ("sessionId", a["sessionId"] ?? .null), ("variant", .string(variant)), ("early", .bool(early)), ("header", try Copy.t(variant == "first" ? "X-RESULT.headerFirst" : variant == "picked" ? "R-R05.kicker" : "X-RESULT.headerDaily")), ("title", variant == "first" ? try Copy.t("X-FIRST.title") : doneTitle), ("sub", .array(sub)), ("cells", .array(cells)), ("count", .number(Double(Set(records.filter(Records.isJudged).map { JS.string($0["cardKey"]) }).count))), ("unwritten", .number(unwritten)), ("day", day), ("work", work), ("share", .bool(!(work["cells"]?.arrayValue ?? []).isEmpty)), ("leave", try leaveOf(source)), ("again", .bool(variant != "picked")), ("source", source)])
        var out = value.objectValue!;out["slot"] = a["slot"];out["sessionId"] = a["sessionId"];return .object(out)
    }
    public static func firstExtras(_ a: JSObject, dates: Dates) throws -> JSValue {
        let cells = a["cells"]?.arrayValue ?? [], judged = cells.filter { $0["kind"] == .string("judged") }
        // D83 ⑦：不显示「N 天后再见」（features.nextReviewLine 关）
        let later = JS.truthy(Config.policy["features"]?["nextReviewLine"]) ? try FirstResult.daysLaterLine(chars: judged, sched: a["sched"], today: a["today"] ?? .null, dates: dates) : ""
        let mark = try Copy.t("X-HOME.shiLabel")
        let inWork = (a["work"]?["cells"]?.arrayValue ?? []).contains { $0["char"] == mark }
        let inGroup = inWork || cells.contains { $0["char"] == mark }
        let lead = a["variant"] == .string("first") && inGroup ? try Copy.text(inWork ? "X-FIRST.shiWritten" : "X-FIRST.shiHome") : ""
        return JS.obj([("preview", .string(lead + later))])
    }
    public static func daysLaterOf(_ a: JSObject, dates: Dates) throws -> JSValue {
        .array(try FirstResult.reviewDays(chars: (a["cells"]?.arrayValue ?? []).filter { $0["kind"] == .string("judged") }, sched: a["sched"], today: a["today"] ?? .null, dates: dates).map { item in
            SessionWrites.patch(item.js, [("text", .string(try FirstResult.daysLaterText(.number(item.days))))])
        })
    }
    static func baseView(_ state: JSObject, _ a: JSObject) throws -> JSValue {
        let s = SessionResults.locate(state, a)?.session
        let variant = s.map { $0["kind"] == .string("picked") ? "picked" : $0["kind"] == .string("first") ? "first" : "daily" } ?? (a["slot"] == .string("B") ? "picked" : "daily")
        let cells = try cells(state, a).map { ViewSupport.ordered($0, "index char recordId kind judgment canChange") }
        let value = JS.obj([("found", .bool(s != nil)), ("variant", .string(variant)), ("early", .bool(JS.truthy(s?["endedEarly"]))), ("sessionId", a["sessionId"] ?? .null), ("slot", a["slot"] ?? .null), ("cells", .array(cells))])
        var out = value.objectValue!;out["sessionId"] = a["sessionId"];return .object(out)
    }
    static func cell(_ state: JSObject, _ a: JSObject) throws -> JSValue {
        let r = JS.truthy(a["recordId"]) ? SessionWrites.find(state, a["recordId"]) : nil, kind = r?["kind"] ?? a["kind"] ?? .null, char = r?["char"] ?? a["char"] ?? .string("")
        let found = SessionResults.locate(state, a), judged = kind == .string("judged") && r != nil && Records.isJudged(r)
        let changeable = judged && !JS.truthy(r?["legacy"]) && found != nil && SessionRules.canCorrect(found?.session, r?["id"])
        let judgment = judged ? r?["judgment"] ?? .null : .null
        let title = judged ? (judgment == .string("wrong") ? "R-R02.sheetTitleWrong" : "R-R02.sheetTitleCorrect") : kind == .string("answer-seen") ? "R-R02.sheetTitleSaw" : "R-R02.sheetTitleSkipped"
        let note = judged ? "R-R02.sheetNoteChange" : kind == .string("answer-seen") ? "R-R02.sheetNoteSaw" : "R-R02.sheetNoteSkipped"
        return JS.obj([("recordId", r?["id"] ?? a["recordId"] ?? .null), ("kind", JS.truthy(kind) ? kind : .string("skipped")), ("char", char), ("judgment", judgment), ("judged", .bool(judged)), ("changeable", .bool(changeable)), ("paper", .bool(Records.isPaperRecord(r))), ("inked", .bool(judged || (kind == .string("answer-seen") && r != nil))), ("title", try Copy.t(title, JSObject([("char", char)]))), ("note", try Copy.t(note)), ("topLabel", try Copy.t(changeable ? "R-R02.sheetCancel" : "R-R02.sheetClose")), ("flipLabel", changeable ? try Copy.t(judgment == .string("correct") ? "X-JUDGE.changeToWrong" : "X-JUDGE.changeToCorrect") : .null), ("emptyText", try Copy.t(judged ? "R-D07.noInkLarge" : "R-R02.sheetNoInk"))])
    }
}
