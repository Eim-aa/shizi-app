import Foundation
import XCTest
@testable import ShiziCore

// 首页 / 提醒同步 / 详情 / 字库首页去掉重复的全量遍历之后的等价性：与改动之前的写法（照抄在 Ref 里当参照）逐字节比整页回答。
//
// 比的是 JSONWriter.stringify 的结果（键序、数字写法都算），按 UTF-8 字节比；抛错时比错误文字（两边都得抛同一个错）。
// 状态有三类：
//   · 夹具：views-basic / views-pages 里出现过的每个 state（两个时区各一份），在夹具的 today、记录里最后一天、跨年等几个时刻上；
//   · 随机的多月历史：判断 / 看过答案 / 跳过、纸上记录（含事后补录到旧月的）、同一时刻的记录、跨月 / 跨年 / 闰二月、折叠月（Budget.foldMonth）、
//     墨迹（raw / v3）、sched（停练、到期日无效）、自选字、换词、提醒开 / 关与各种时刻；「刁钻」的一半还有重复 id、localDay 不在所在月、
//     月份对象的插入序打乱、custom: 卡、坏墨迹——不是 Store 能存下的状态，也照样要逐字节相同；时刻取午夜前后一毫秒（上海 / 纽约 / 豪勋爵岛）；
//   · 经 Store 的：小号的 heavyState（旧月份真折叠过）在 PageAPI.call 同一入口上的回答（首页 / 字库 / 详情）与 ReminderController.sync 的消息体，
//     有会话 / 无会话、提醒关 / 开、午夜前后、跨月、跨年。1x 与 3x-folded（ScaleBenchmarkTests 同一份数据）只在 SHIZI_SCALE_BENCH=1 时跑。
final class HomeScaleEquivalenceTests: XCTestCase {
    typealias B = StoreCommitBenchmarkTests
    typealias V = ViewSupport

    // MARK: - 参照（改动前的写法，照抄）

    enum Ref {
        // ---- 首页（Views/Home.swift）----
        static func recordsStateOf(_ state: JSValue, today: String, policy: JSValue) -> String {
            let records = Query.flattenRecords(state["records"])
            if Records.todayCount(records, today) > 0 { return "record" }
            if Records.hasAnyJudged(records) { return "empty" }
            return ScheduleRules.aStartInfo(state, policy: policy).firstVisit ? "first" : "empty"
        }
        static func lastJudgedDayOf(_ records: [JSValue]) -> JSValue {
            let days = records.filter(Records.isJudged).compactMap { $0["localDay"]?.stringValue }; return days.max().map(JSValue.string) ?? .null
        }
        static func homeModel(_ state: JSValue, now: Double, policy: JSValue, deck: ScheduleDeck?, dates: Dates) throws -> JSValue {
            let today = try dates.localDay(.number(now)), records = Query.flattenRecords(state["records"]), rs = recordsStateOf(state, today: today, policy: policy)
            let statsMemo = PracticeStatsMemo()
            let plan = rs == "first" ? TodayPlan.Progress(n: 0, total: 0, done: false, active: false) : try TodayPlan.progress(state, day: today, rules: ScheduleRules(dates: dates), deck: deck, policy: policy, statsMemo: statsMemo)
            let resume = try HomeView.resumeOf(state, now: now, policy: policy, dates: dates, plan: plan), on = resume["resume"] != .string("none")
            let special = deck != nil && !on && rs != "first" ? try ScheduleRules(dates: dates).planSpecial(state, today: today, deck: deck!, policy: policy, statsMemo: statsMemo) : .null
            let capital = special["kind"] ?? .null, last = lastJudgedDayOf(records), gap: JSValue = last == .null ? .null : .number(try dates.diffDays(last, .string(today)))
            let ep = try Epigraphs.epigraph(for: .string(today), dates: dates)
            var m = JSObject()
            m["switchLibrary"] = .bool(try deck != nil && !on && rs != "first" && !JS.truthy(capital) && (try HomeView.noCharsLeft(state, today: today, deck: deck, policy: policy, dates: dates, statsMemo: statsMemo)))
            m["today"] = .string(today); m["period"] = .string(try dates.periodOf(.number(now))); m["dateParts"] = try dates.monthDayParts(.string(dates.calendarDay(.number(now))))
            m["epigraph"] = V.obj([("lines", .array(ep.lines.map(JSValue.string))), ("source", .string(ep.source))]); m["records"] = .string(rs)
            for k in ["resume", "primary", "other", "daily"] { m[k] = resume[k] }
            m["plan"] = V.obj([("n", .number(Double(plan.n))), ("total", .number(Double(plan.total))), ("done", .bool(plan.done)), ("active", .bool(plan.active))])
            m["showRecord"] = .bool(rs == "record" && !on); m["showFirstTip"] = .bool(rs == "first" && !on); m["capital"] = capital; m["gapDays"] = gap
            m["view"] = .string(HomeView.homeViewOf(.object(m))); m["libraryCount"] = .number(Double(Records.practicedByChar(records).count)); m["showPick"] = .bool(rs != "first" && resume["primary"]?["kind"] != .string("first"))
            return .object(m)
        }
        static func homeView(_ state: JSValue, now: Double, policy: JSValue, deck: ScheduleDeck?, ui: JSValue?, dates: Dates) throws -> JSValue {
            let m = try homeModel(state, now: now, policy: policy, deck: deck, dates: dates), key = HomeView.homeCtaKey(m), l = m["resume"] != .string("none") ? m["primary"] : nil, note = HomeView.homeNoteOf(m), ep = m["epigraph"]!, other = m["other"]!
            var out = JSObject()
            for k in ["view", "records", "resume", "period", "today"] { out[k] = m[k] }
            out["title"] = V.ref("R-H01.title"); out["date"] = V.ref("R-H02.line", V.obj([("date", V.ref("R-H02.dateFormat", m["dateParts"])), ("period", V.ref("R-H02.period."+JS.string(m["period"])))]))
            out["shiLabel"] = V.ref("X-HOME.shiLabel")
            let e = try Epigraphs.epigraph(for: m["today"]!, dates: dates)
            out["epigraph"] = V.obj([("index", .number(try Epigraphs.indexFor(day: m["today"]!, dates: dates))), ("lines", ep["lines"]!), ("author", .string(Epigraphs.author(of: e))), ("label", .string(e.lines.joined()+e.source))])
            out["motto"] = .array((1...3).map { V.ref("X-HOME.mottoLine"+String($0)) })
            out["cta"] = V.obj([("label", V.ref(key)), ("progress", JS.truthy(l) && !JS.truthy(m["switchLibrary"]) ? HomeView.progressText(l) : .null), ("aria", JS.truthy(m["switchLibrary"]) ? V.ref(key) : HomeView.ctaAria(m)), ("action", .string(JS.truthy(m["switchLibrary"]) ? "switchLibrary" : "start"))])
            out["note"] = JS.truthy(note) ? V.obj([("kind", .string(HomeView.noteKind(m, key: JS.string(note["key"])))), ("text", V.ref(JS.string(note["key"]), note["vars"]))]) : .null
            out["capital"] = m["capital"]
            out["firstTip"] = m["view"] == .string("first") ? V.ref("R-H03.firstVisit") : .null
            out["other"] = JS.truthy(other) ? V.obj([("slot", other["slot"]!), ("kind", other["kind"]!), ("remaining", other["remaining"]!), ("text", HomeView.resumeLineText(other)), ("aria", HomeView.resumeLineAria(other))]) : .null
            out["pick"] = JS.truthy(m["showPick"]) ? V.ref("X-HOME.pick") : .null; out["defer"] = m["view"] == .string("special") ? V.ref("X-HOME.capitalDefer") : .null
            out["fail"] = V.obj([("text", V.ref("X-HOME.startFailed")), ("cancel", V.ref("R-H06.cancel")), ("retry", V.ref("R-H06.retry"))])
            out["undo"] = V.obj([("undo", V.ref("R-W20.undo")), ("failed", V.ref("R-W16.saveFailed")), ("cancel", V.ref("R-W16.cancel")), ("retry", V.ref("R-W16.retry"))])
            out["shi"] = HomeView.brandPath; out["seal"] = try CoreResources.load("view-seal"); out["brand"] = .bool(JS.truthy(ui?["brand"]))
            var leave = ui?["leaveUndo"]?.objectValue
            if leave != nil { leave!["text"] = V.ref("R-W20.skippedToast", V.obj([("char", leave!["char"] ?? .null)])) }; out["leaveUndo"] = leave.map(JSValue.object) ?? .null
            return .object(out)
        }

        // ---- 提醒（Records/Reminder.swift）----
        static func recordsOf(_ state: JSValue?) -> [JSValue] {
            var out: [JSValue] = []
            guard let state = state, JSX.truthy(state), let months = state["records"], JSX.truthy(months), case .object(let m) = months else { return out }
            let keys = m.keys.sorted { JSX.cmp($0, $1) < 0 }
            for k in keys {
                let v = m[k]!
                if case .array(let l) = v { out += l } else if JSX.truthy(v), case .array(let kept)? = v["kept"] { out += kept }
            }
            return out
        }
        static func reminderCandidates(_ state: JSValue?, deck: Reminder.Deck = .shared, policy: JSObject? = nil, dates: Dates) throws -> [Reminder.Candidate] {
            let pol = Reminder.policyObject(policy)
            guard JSX.eq(pol["reminderPick"], "wrong-then-overdue") else {
                throw CoreError.range("unsupported policy.reminderPick: " + (pol["reminderPick"].map { Copy.jsString($0) } ?? "undefined"))
            }
            var sched = JSValue.object(JSObject())
            if let s = state, JSX.truthy(s), let sc = s["sched"], JSX.truthy(sc) { sched = sc }
            var wordOff: JSValue?
            if let s = state, JSX.truthy(s), let w = s["wordOff"], JSX.truthy(w) { wordOff = w }
            var latest = OMap<JSValue>()
            for r in recordsOf(state) where Records.isJudged(r) {
                guard case .string(let k)? = r["cardKey"] else { continue }
                if let prev = latest[k], !(Records.compareRecordIds(prev["id"], r["id"]) < 0) { continue }
                latest[k] = r
            }
            var out: [Reminder.Candidate] = []
            let keys: [String] = { if case .object(let o) = sched { return o.keys }; return [] }()
            for cardKey in keys {
                guard let entry = sched[cardKey], JSX.truthy(entry), entry["stoppedAt"] == nil, let dueV = entry["due"], dates.isValidDay(dueV), case .string(let due) = dueV else { continue }
                if !deck.practicable(cardKey) { continue }
                guard let card = DeckCards.withWordOff(deck.cardFor(cardKey), wordOff), DeckCards.hasContextWord(card) else { continue }
                if Query.jsTrim(card["py"].flatMap { JSX.truthy($0) ? Copy.jsString($0) : nil } ?? "").isEmpty { continue }
                let last = latest[cardKey]
                out.append(Reminder.Candidate(cardKey: cardKey, due: due, wrong: last.map { JSX.eq($0["judgment"], "wrong") } ?? false, card: card, lastId: last?["id"]))
            }
            func orElse(_ x: Double, _ y: () -> Double) -> Double { (x == 0 || x.isNaN) ? y() : x }
            let sorted = JSX.stableSort(out) { a, b in
                orElse(a.wrong == b.wrong ? 0 : (a.wrong ? -1 : 1)) {
                    orElse(Double(JSX.cmp(a.due, b.due))) {
                        orElse((a.lastId != nil && b.lastId != nil) ? Records.compareRecordIds(a.lastId, b.lastId) : (a.lastId != nil ? -1 : (b.lastId != nil ? 1 : 0))) {
                            Double(JSX.cmp(a.cardKey, b.cardKey))
                        }
                    }
                }
            }
            return sorted
        }
        static func reminderQuestions(_ state: JSValue?, today: JSValue, count: Int = Reminder.reminderDays, deck: Reminder.Deck = .shared, policy: JSObject? = nil, dates: Dates) throws -> [JSValue] {
            guard dates.isValidDay(today) else { throw CoreError.range("reminderQuestions: invalid today " + Copy.jsString(today)) }
            let all = try reminderCandidates(state, deck: deck, policy: policy, dates: dates)
            var used = OSet()
            var out: [JSValue] = []
            for offset in 0..<Swift.max(0, count) {
                let day = try dates.addDays(today, Double(offset))
                let candidates = all.filter { JSX.cmp($0.due, day) <= 0 }
                if candidates.isEmpty { continue }
                let pick = candidates.first { !used.contains($0.cardKey) } ?? candidates[0]
                used.insert(pick.cardKey)
                out.append(try Reminder.reminderQuestion(pick, day: day, policy: policy))
            }
            return out
        }
        static func reminderPayload(_ state: JSValue?, remind: JSValue? = nil, today: JSValue, now: JSValue? = nil, deck: Reminder.Deck = .shared, policy: JSObject? = nil, dates: Dates) throws -> JSValue {
            let settings: JSValue? = (state.map { JSX.truthy($0) } ?? false) ? state!["settings"] : nil
            let r = (remind.map { JSX.truthy($0) } ?? false) ? remind! : Reminder.remindOf(settings, policy: policy)
            let enabled = r["enabled"] == .bool(true)
            let fireDay = try Reminder.fireDayOf(now, r, today, policy: policy, dates: dates)
            let practiced = Records.todayCount(recordsOf(state), fireDay.stringValue ?? "") > 0
            let questions: [JSValue] = enabled ? try reminderQuestions(state, today: today, deck: deck, policy: policy, dates: dates) : []
            return .object(JSObject([
                ("enabled", .bool(enabled)),
                ("hour", r["hour"] ?? .null),
                ("minute", r["minute"] ?? .null),
                ("practicedToday", .bool(practiced)),
                ("questions", .array(questions)),
            ]))
        }

        // ---- 详情（Views/Detail.swift）----
        static func detailModel(_ state: JSValue, char: String, today: String, policy: JSValue, hasInk: InkPick.HasInk = { _ in false }, dates: Dates) throws -> JSValue {
            let key = "base:"+char, base = DeckCards.shared.cardForKey(key), off = state["wordOff"]?[key] != nil, card = DeckCards.withWordOff(base, state["wordOff"])
            let all = Query.flattenRecords(state["records"]), judged = DetailView.recordsOfChar(state, char: char).filter(Records.isJudged), latest = judged.last
            let screen = judged.filter { !Records.isPaperRecord($0) }, paper = judged.filter(Records.isPaperRecord), inkLatest = screen.last, entry = state["sched"]?[key]
            let due = !judged.isEmpty && JS.truthy(policy["features"]?["nextReviewLine"]) && entry?["due"]?.stringValue != nil ? entry!["due"]! : .null
            let added = state["custom"]?["added"]?.arrayValue ?? [], ci = added.firstIndex { $0["char"] == .string(char) }
            let image = try latest == nil ? "noRecord" : inkLatest == nil || !(try hasInk(inkLatest!)) ? "noInk" : "ok"
            var out = JSObject()
            out["char"] = .string(char); out["cardKey"] = .string(key); out["card"] = card ?? .null; out["baseCard"] = base ?? .null; out["practicable"] = .bool(base != nil)
            out["pinyin"] = card?["py"].flatMap { JS.truthy($0) ? $0 : nil } ?? .string(""); out["strokes"] = JS.number(card?["strokes"]) > 0 ? card!["strokes"]! : .number(0); out["word"] = try DetailView.wordView(card)
            out["canSwapWord"] = .bool(!off && base != nil && DeckCards.hasContextWord(base)); out["wordOff"] = .bool(off); out["originalWord"] = base?["word"] ?? .string("")
            out["judged"] = .array(judged); out["count"] = .number(Double(judged.count)); out["first"] = judged.first ?? .null; out["latest"] = latest ?? .null; out["cells"] = .array(screen); out["paperRows"] = .array(paper)
            out["inkFirst"] = screen.first ?? .null; out["inkLatest"] = inkLatest ?? .null; out["imageRecord"] = inkLatest ?? .null; out["list"] = try DetailView.listOf(all, sched: state["sched"], today: today, key: key, dates: dates); out["due"] = due; out["image"] = .string(image)
            out["custom"] = .bool(ci != nil); out["customIndex"] = .number(Double(ci ?? -1)); out["customEntry"] = ci.map { added[$0] } ?? .null; out["photo"] = state["photos"]?[char] ?? .null; out["photoCountsAsRecord"] = .bool(policy["legacyPhotoCountsAsRecord"] == .bool(true))
            return .object(out)
        }
        static func detailView(_ state: JSValue, char: String, today: String, etymology: JSValue?, imageAction: Bool, dates: Dates) throws -> JSValue {
            let m = try detailModel(state, char: char, today: today, policy: Config.policy, hasInk: { DetailView.hasInkPoints(try DetailView.inkOf(state, record: $0, dates: dates)) }, dates: dates), hero = DetailView.detailHero(m)
            func wire(_ r: JSValue) throws -> (Bool, JSValue) { let has = DetailView.hasInkPoints(try DetailView.inkOf(state, record: r, dates: dates)); return (has, has ? try QueryView.sheetStrokes(state, r, dates: dates) : .array([])) }
            let heroCells = try hero["cells"]!.arrayValue!.map { c -> JSValue in
                let r = c["record"]!, (has, strokes) = try wire(r), title = DetailView.cellCopy(r, dates: dates)["title"]!, label = V.ref(c["kind"] == .string("first") ? "X-DETAIL.heroFirst" : "X-DETAIL.heroLatest")
                return V.obj([("kind", c["kind"]!), ("title", title), ("changeable", .bool(DetailView.changeable(r))), ("recordId", r["id"]!), ("judgment", r["judgment"]!), ("wrong", .bool(r["judgment"] == .string("wrong"))), ("hasInk", .bool(has)), ("strokes", strokes), ("caption", V.ref("X-DETAIL.heroCaption", V.obj([("label", label), ("date", LibraryListView.dateText(r["localDay"], dates: dates))]))), ("aria", V.ref("X-DETAIL.heroCellLabel", V.obj([("label", label), ("text", has ? title : V.ref("X-DETAIL.cellNoInkLabel", V.obj([("text", title)])))])))])
            }
            let ids = heroCells.map { $0["recordId"]! }
            let cells = try m["cells"]!.arrayValue!.filter { !ids.contains($0["id"]!) }.map { r -> JSValue in
                let (has, strokes) = try wire(r), c = DetailView.cellCopy(r, dates: dates), title = c["title"]!
                return V.obj([("recordId", r["id"]!), ("title", title), ("changeable", .bool(DetailView.changeable(r))), ("judgment", r["judgment"]!), ("wrong", .bool(r["judgment"] == .string("wrong"))), ("hasInk", .bool(has)), ("strokes", strokes), ("first", .bool(r == m["inkFirst"])), ("latest", .bool(r == m["inkLatest"])), ("date", c["date"]!), ("caption", c["caption"]!), ("aria", has ? title : V.ref("X-DETAIL.cellNoInkLabel", V.obj([("text", title)])))])
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

        // ---- 字库首页（Views/Library.swift）----
        static func memoryZones(_ state: JSValue, today: String, knownDays: Double? = nil, minSuccesses: Double? = nil, dates: Dates) throws -> JSValue {
            let latest = Records.practicedByChar(V.libraryRecords(state).records)
            var buckets: [String: [JSValue]] = ["due": [], "shaky": [], "known": []]
            for (_, r) in latest.entries {
                let entry = state["sched"]?[JS.string(r["cardKey"])]
                let kind = try V.memoryZoneOf(r, entry, today: today, knownDays: knownDays ?? JS.number(Config.policy["knownZone"]?["stabilityDays"]), minSuccesses: minSuccesses ?? JS.number(Config.policy["knownZone"]?["minSuccesses"]), dates: dates)
                let due = dates.isValidDay(entry?["due"] ?? .null) ? entry!["due"]! : .string("9999-12-31")
                buckets[kind]!.append(V.obj([("char", r["char"]!), ("cardKey", r["cardKey"]!), ("record", r), ("dueDay", due), ("rank", .number(r["judgment"] == .string("wrong") ? 0 : r["kind"] == .string("answer-seen") ? 1 : 2))]))
            }
            var zones = JSObject()
            for kind in ["due", "shaky", "known"] {
                let sorted = buckets[kind]!.sorted { a, b in
                    let ar = JS.number(a["rank"]), br = JS.number(b["rank"])
                    if kind == "due" { if ar != br { return ar < br }; if ar < 2 { return Records.compareRecordIds(b["record"]?["id"], a["record"]?["id"]) < 0 } }
                    let ad = JS.string(a["dueDay"]), bd = JS.string(b["dueDay"])
                    return ad != bd ? ad < bd : Records.compareRecordIds(a["record"]?["id"], b["record"]?["id"]) < 0
                }
                let items = sorted.map { r in V.obj([("char", r["char"]!), ("cardKey", r["cardKey"]!), ("record", r["record"]!), ("tone", .number(kind == "due" ? 3 : kind == "shaky" ? 1 : 0))]) }
                zones[kind] = V.obj([("kind", .string(kind)), ("n", .number(Double(items.count))), ("items", .array(items))])
            }
            return V.obj([("recorded", .number(Double(latest.count))), ("zones", .object(zones))])
        }
        static func skippedZone(_ state: JSValue) -> JSValue {
            let records = V.libraryRecords(state).records, judged = Records.practicedByChar(records)
            var latest = OMap<JSValue>()
            for r in records where r["kind"] == .string("skipped") {
                guard let c = r["char"]?.stringValue, !judged.has(c) else { continue }
                if latest[c] == nil || Records.compareRecordIds(latest[c]?["id"], r["id"]) < 0 { latest[c] = r }
            }
            let items = latest.entries.map(\.value).sorted { Records.compareRecordIds($1["id"], $0["id"]) < 0 }.map { r in V.obj([("char", r["char"]!), ("cardKey", r["cardKey"]!), ("record", r), ("tone", .number(3))]) }
            return V.obj([("kind", .string("skipped")), ("n", .number(Double(items.count))), ("items", .array(items))])
        }
        static func libraryPageView(_ state: JSValue, now: Double, today: String, deck: ScheduleDeck, policy: JSValue, ui: JSValue?, dates: Dates) throws -> JSValue {
            let mem = try memoryZones(state, today: today, dates: dates), skipped = skippedZone(state), plan = try LibraryView.todayPlanModel(state, now: now, deck: deck, policy: policy, dates: dates), refs = LibraryView.todayRefs(plan), id = DeckIndex.shared.currentLibraryId(state["settings"])
            func zoneView(_ z: JSValue) throws -> JSValue {
                let kind = JS.string(z["kind"])
                return V.obj([("kind", .string(kind)), ("name", V.ref("X-LIBFOUR.zone."+kind)), ("n", z["n"]!), ("to", JS.truthy(z["n"]) ? V.obj([("screen", .string("library-list")), ("params", V.obj([("kind", .string(kind))]))]) : .null), ("samples", .array(try LibraryView.zoneSamples(z).map { c in V.obj([("char", c["char"]!), ("tone", c["tone"]!), ("strokes", try LibraryView.sampleStrokes(state, record: c["record"], policy: policy, dates: dates))]) }))])
            }
            var out = JSObject()
            out["today"] = .string(today); out["state"] = .string(JS.truthy(mem["recorded"]) ? "records" : "empty"); out["recorded"] = mem["recorded"]; out["title"] = V.ref("X-TABS.library"); out["search"] = V.obj([("placeholder", V.ref("X-LIBFOUR.searchPlaceholder"))])
            out["range"] = V.obj([("label", V.ref("R-S01.library")), ("value", LibraryView.libraryNameRef(id)), ("libraryId", id), ("to", V.obj([("screen", .string("library-switch")), ("params", V.obj([]))]))])
            out["todayRow"] = V.obj([("label", V.ref("X-LIBFOUR.todayLabel")), ("phase", plan["phase"]!), ("n", plan["n"]!), ("value", refs["value"]!), ("sub", refs["sub"]!)])
            out["written"] = V.obj([("heading", V.ref("X-LIBFOUR.writtenHeading")), ("count", mem["recorded"]!), ("all", V.ref("X-LIBFOUR.writtenAll")), ("allAria", V.ref("X-LIBFOUR.writtenAllAria")), ("to", V.obj([("screen", .string("library-all")), ("params", V.obj([]))]))])
            out["zones"] = .array(try ["due","shaky","known"].map { try zoneView(mem["zones"]![$0]!) }); out["skipped"] = try zoneView(skipped); out["ink"] = try V.inkParams(policy)
            let side = 34.0*(1-2*0.04); out["sample"] = V.obj([("side", .number(34)), ("inkSide", .number(side)), ("inkScale", .number(ImageLayout.minInkScale(side)))])
            var leave = ui?["leaveUndo"]?.objectValue
            if leave != nil { leave!["text"] = V.ref("R-W20.skippedToast", V.obj([("char", leave!["char"] ?? .null)])) }; out["leaveUndo"] = leave.map(JSValue.object) ?? .null
            out["undo"] = V.obj([("undo", V.ref("R-W20.undo")), ("failed", V.ref("R-W16.saveFailed")), ("cancel", V.ref("R-W16.cancel")), ("retry", V.ref("R-W16.retry"))]); return .object(out)
        }
    }

    // MARK: - 比较

    private var compared = 0

    private static func outcome(_ body: () throws -> JSValue) -> String {
        do { return "ok " + JSONWriter.stringify(try body()) } catch { return "throw " + String(describing: error) }
    }

    /// 新写法与参照逐字节相同（都抛错时错误文字相同）。
    private func same(_ label: @autoclosure () -> String, _ new: () throws -> JSValue, _ ref: () throws -> JSValue, file: StaticString = #filePath, line: UInt = #line) {
        let a = Self.outcome(new), b = Self.outcome(ref)
        compared += 1
        if !a.utf8.elementsEqual(b.utf8) {
            XCTFail(label() + "\n new: " + String(a.prefix(800)) + "\n ref: " + String(b.prefix(800)), file: file, line: line)
        }
    }

    private static func candidatesJSON(_ cs: [Reminder.Candidate]) -> JSValue {
        .array(cs.map { c in
            var o = JSObject([("cardKey", .string(c.cardKey)), ("due", .string(c.due)), ("wrong", .bool(c.wrong)), ("card", c.card)])
            if let l = c.lastId { o["lastId"] = l }
            return .object(o)
        })
    }

    private static func remindValue(_ enabled: Bool, _ hour: Int, _ minute: Int) -> JSValue {
        .object(JSObject([("enabled", .bool(enabled)), ("hour", .number(Double(hour))), ("minute", .number(Double(minute))), ("permission", .string("granted"))]))
    }

    /// 一个状态、一个时刻上的全部比较（函数层：与 App 回答里用的是同一个函数、同样的参数）。
    private func checkAll(_ st: JSValue, dates: Dates, now: Double, chars: [String], label: String, reminds: [JSValue?]) {
        let policy = Config.policy
        let today = (try? dates.localDay(.number(now))) ?? "2026-10-21"
        let l = label + " now=" + String(format: "%.0f", now) + " today=" + today
        same(l + " home.view", { try HomeView.homeView(st, now: now, policy: policy, deck: .real, ui: nil, dates: dates) }, { try Ref.homeView(st, now: now, policy: policy, deck: .real, ui: nil, dates: dates) })
        same(l + " home.model", { try HomeView.homeModel(st, now: now, policy: policy, deck: .real, dates: dates) }, { try Ref.homeModel(st, now: now, policy: policy, deck: .real, dates: dates) })
        same(l + " home.recordsState", { .string(HomeView.recordsStateOf(st, today: today, policy: policy)) }, { .string(Ref.recordsStateOf(st, today: today, policy: policy)) })
        let flat = Query.flattenRecords(st["records"])
        same(l + " home.lastJudged", { HomeView.lastJudgedDayOf(flat) }, { Ref.lastJudgedDayOf(flat) })
        same(l + " library.page", { try LibraryView.libraryPageView(st, now: now, today: today, deck: .real, policy: policy, ui: nil, dates: dates) }, { try Ref.libraryPageView(st, now: now, today: today, deck: .real, policy: policy, ui: nil, dates: dates) })
        same(l + " library.zones", { try V.memoryZones(st, today: today, dates: dates) }, { try Ref.memoryZones(st, today: today, dates: dates) })
        same(l + " library.zones.args", { try V.memoryZones(st, today: today, knownDays: 3, minSuccesses: 1, dates: dates) }, { try Ref.memoryZones(st, today: today, knownDays: 3, minSuccesses: 1, dates: dates) })
        same(l + " library.skipped", { V.skippedZone(st) }, { Ref.skippedZone(st) })
        let ety = JSValue.object(JSObject([("gloss", .string("g")), ("source", .string("s"))]))
        for (i, ch) in chars.enumerated() {
            same(l + " detail.view " + ch, { try DetailView.detailView(st, char: ch, today: today, etymology: i % 2 == 0 ? nil : ety, imageAction: i % 3 != 1, dates: dates) },
                 { try Ref.detailView(st, char: ch, today: today, etymology: i % 2 == 0 ? nil : ety, imageAction: i % 3 != 1, dates: dates) })
            same(l + " detail.model " + ch, { try DetailView.detailModel(st, char: ch, today: today, policy: policy, hasInk: { DetailView.recordHasInk(st, record: $0, dates: dates) }, dates: dates) },
                 { try Ref.detailModel(st, char: ch, today: today, policy: policy, hasInk: { DetailView.recordHasInk(st, record: $0, dates: dates) }, dates: dates) })
        }
        for remind in reminds {
            let rl = l + " remind=" + (remind.map { JSONWriter.stringify($0) } ?? "settings")
            same(rl + " remind.payload", { try Reminder.reminderPayload(st, remind: remind, today: .string(today), now: .number(now), dates: dates) },
                 { try Ref.reminderPayload(st, remind: remind, today: .string(today), now: .number(now), dates: dates) })
        }
        same(l + " remind.payload.noNow", { try Reminder.reminderPayload(st, today: .string(today), dates: dates) }, { try Ref.reminderPayload(st, today: .string(today), dates: dates) })
        same(l + " remind.payload.badToday", { try Reminder.reminderPayload(st, remind: Self.remindValue(true, 20, 0), today: .string("2026-13-01"), now: .number(now), dates: dates) },
             { try Ref.reminderPayload(st, remind: Self.remindValue(true, 20, 0), today: .string("2026-13-01"), now: .number(now), dates: dates) })
        same(l + " remind.candidates", { Self.candidatesJSON(try Reminder.reminderCandidates(st, dates: dates)) }, { Self.candidatesJSON(try Ref.reminderCandidates(st, dates: dates)) })
        same(l + " remind.recordsOf", { .array(Reminder.recordsOf(st)) }, { .array(Ref.recordsOf(st)) })
    }

    /// DetailView.cellInk（每格墨迹只解一次）= 原来的 (hasInkPoints(inkOf(…)), has ? sheetStrokes(…) : [])，逐条记录比。
    private func checkCellInk(_ st: JSValue, dates: Dates, label: String) {
        for (i, r) in Query.flattenRecords(st["records"]).enumerated() {
            same(label + " detail.cellInk #\(i)", { let w = try DetailView.cellInk(st, r, dates: dates); return .array([.bool(w.has), w.strokes]) },
                 { let has = DetailView.hasInkPoints(try DetailView.inkOf(st, record: r, dates: dates)); return .array([.bool(has), has ? try QueryView.sheetStrokes(st, r, dates: dates) : .array([])]) })
        }
    }

    // MARK: - 时刻

    /// day 当天 0 点（dates 的时区）；day 不合法返回 nil。
    private static func startOfDay(_ day: String, _ dates: Dates) -> Double? {
        let p = day.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3, dates.isValidDay(.string(day)) else { return nil }
        return JSDate.makeLocal(p[0], p[1] - 1, p[2], hours: 0, dates.timeZone)
    }

    /// 这几天的午夜前后一毫秒、中午、当天最后一毫秒，挑 pick 个（rng 决定）。
    private static func moments(_ days: [String], _ dates: Dates, _ g: Gen, pick: Int) -> [Double] {
        var all: [Double] = []
        for d in days {
            guard let s = startOfDay(d, dates) else { continue }
            all += [s, s - 1, s + 12 * 3_600_000, s + 86_400_000 - 1, s + 86_400_000]
        }
        if all.isEmpty { return [] }
        var out: [Double] = []
        for _ in 0..<pick { out.append(all[g.int(all.count)]) }
        return out
    }

    // MARK: - 随机历史

    final class Gen {
        var rng: HomeScaleRNG
        init(_ seed: UInt64) { rng = HomeScaleRNG(seed: seed) }
        func int(_ n: Int) -> Int { n <= 1 ? 0 : Int(rng.next() % UInt64(n)) }
        func chance(_ p: Double) -> Bool { Double(rng.next() % 1_000_000) < p * 1_000_000 }
    }

    static func daysIn(_ month: String) -> Int {
        let p = month.split(separator: "-").compactMap { Int($0) }
        let y = p[0], m = p[1]
        if m == 2 { return (y % 4 == 0 && (y % 100 != 0 || y % 400 == 0)) ? 29 : 28 }
        return [4, 6, 9, 11].contains(m) ? 30 : 31
    }

    struct Generated {
        let state: JSValue
        let days: [String]
        let chars: [String]
    }

    /// 一份随机的多月历史（见文件头）。months 升序。
    static func randomState(_ g: Gen, months: [String], perMonth: Int, pool: [String], fold: Int, adversarial: Bool) throws -> Generated {
        let help = JSValue.object(JSObject([("hints", .number(0)), ("answerSeen", .bool(false)), ("traced", .bool(false))]))
        let helpSeen = JSValue.object(JSObject([("hints", .number(1)), ("answerSeen", .bool(true)), ("traced", .bool(false))]))
        let active = Array(pool.prefix(max(4, min(pool.count, perMonth / 2 + 3)))) // 字少一些，好让同一个字反复出现
        var serial = 0, prevAt = dayMs("2024-01-01"), maxDay: String? = nil
        var lists: [(String, [JSValue])] = []
        var ink = JSObject()
        var usedChars: [String] = [], lastAtOf: [String: Double] = [:]
        var paperChar: String? = nil, skippedChar: String? = nil

        func newRecord(_ id: String, _ ch: String, _ kind: String, _ day: String, paper: Bool, at: Double) -> JSValue {
            let custom = adversarial && g.chance(0.08)
            var o = JSObject([("id", .string(id)), ("cardKey", .string((custom ? "custom:" : "base:") + ch)), ("char", .string(ch)), ("sessionId", .string("s\(1 + serial / 20)")),
                              ("kind", .string(kind)), ("at", .number(at)), ("localDay", .string(day)), ("help", kind == "answer-seen" ? helpSeen : help)])
            if kind == "judged" {
                o["judgment"] = .string(g.chance(0.25) ? "wrong" : "correct")
                if paper { o["source"] = .string("paper") }
            }
            return .object(o)
        }
        func addInk(_ rec: JSValue) throws {
            guard rec["source"] != .string("paper"), rec["kind"] != .string("skipped"), g.chance(0.5) else { return }
            let month = String(rec["localDay"]!.stringValue!.prefix(7)), id = rec["id"]!.stringValue!
            var table = ink[month]?.objectValue ?? JSObject()
            if adversarial && g.chance(0.05) {
                table[id] = g.chance(0.5) ? JSValue.object(JSObject([("v", .number(4))])) : JSValue.object(JSObject())
            } else {
                table[id] = try InkMath.encodeStoredInk(B.rawStrokes(1 + g.int(5), seed: serial), policy: Config.policy.objectValue, format: g.chance(0.3) ? "v3" : "raw")
            }
            ink[month] = .object(table)
        }

        for (mi, month) in months.enumerated() {
            var list: [JSValue] = []
            let n = g.chance(0.1) ? 0 : perMonth / 2 + g.int(perMonth + 1)
            let dim = daysIn(month)
            var dayNo = 1
            for _ in 0..<n {
                // 日子单调不减地往后走，偶尔落在月初 / 月末
                if g.chance(0.3) { dayNo = min(dim, dayNo + 1 + g.int(3)) }
                if g.chance(0.03) { dayNo = dim }
                var day = month + "-" + B.pad2(dayNo)
                if adversarial && mi > 0 && g.chance(0.04) { let pm = months[mi - 1]; day = pm + "-" + B.pad2(1 + g.int(daysIn(pm))) } // localDay 不在所在月
                serial += 1
                var id = "r\(serial)"
                if adversarial && serial > 3 && g.chance(0.06) { id = "r\(serial - 1 - g.int(3))" } // 重复 id
                let ch = active[g.int(active.count)]
                let roll = g.int(100)
                let kind = roll < 65 ? "judged" : roll < 83 ? "answer-seen" : "skipped"
                let paper = kind == "judged" && g.chance(0.12)
                let at = g.chance(0.15) ? prevAt : (startOfDayShanghai(day) ?? prevAt) + Double(6 + g.int(16)) * 3_600_000 + Double(g.int(3_600_000))
                prevAt = at
                let rec = newRecord(id, ch, kind, day, paper: paper, at: at)
                list.append(rec)
                try addInk(rec)
                if !usedChars.contains(ch) { usedChars.append(ch) }
                lastAtOf[ch] = at
                if paper { paperChar = ch }
                if kind == "skipped" { skippedChar = ch }
                if maxDay == nil || day > maxDay! { maxDay = day }
            }
            lists.append((month, list))
        }
        // 事后补录的纸上记录：序号最大，却落在旧月（追加在那个月的末尾，月内 id 仍递增）
        if lists.count > 1 {
            for _ in 0..<(1 + perMonth / 8) {
                let i = g.int(lists.count - 1), month = lists[i].0
                let day = month + "-" + B.pad2(1 + g.int(daysIn(month)))
                serial += 1
                let ch = active[g.int(active.count)]
                let rec = newRecord("r\(serial)", ch, "judged", day, paper: true, at: prevAt + 1000)
                lists[i].1.append(rec)
                paperChar = ch
                if !usedChars.contains(ch) { usedChars.append(ch) }
            }
        }
        var arrays = JSObject()
        for (m, l) in lists { arrays[m] = .array(l) }
        // 折叠最老的 fold 个非空月（与预算回收同一个 foldMonth）
        var values: [(String, JSValue)] = lists.map { ($0.0, JSValue.array($0.1)) }
        if fold > 0 {
            let index = Budget.indexRecords(arrays)
            var done = 0
            for i in values.indices where done < fold {
                guard let l = values[i].1.arrayValue, !l.isEmpty else { continue }
                values[i].1 = .object(Budget.foldMonth(values[i].0, l, index.retained))
                done += 1
            }
        }
        if adversarial { // 月份的插入序打乱（Query.flattenRecords 按对象键序走，Reminder / 字库按月键排序走）
            for i in stride(from: values.count - 1, to: 0, by: -1) { values.swapAt(i, g.int(i + 1)) }
        }
        var records = JSObject()
        for (m, v) in values { records[m] = v }

        var sched = JSObject()
        let base = lastAtOf.values.max() ?? dayMs("2026-10-01")
        for ch in usedChars + Array(pool.suffix(3)) where g.chance(0.85) {
            var e = try B.schedEntry(lastMs: lastAtOf[ch] ?? base, scheduledDays: 1 + g.int(40), reps: 1 + g.int(6), stability: Double(1 + g.int(60)) + 0.5).objectValue!
            if g.chance(0.08) { e["stoppedAt"] = .number(base) }
            if g.chance(0.03) { e["due"] = .string("x") }
            sched["base:" + ch] = .object(e)
        }
        var settings = JSObject([("groupSize", .number(30))])
        if g.chance(0.7) { settings["library"] = .string(g.chance(0.8) ? "common" : DeckIndex.shared.defaultLibraryId) }
        if g.chance(0.7) { settings["remind"] = remindValue(g.chance(0.6), g.int(24), g.int(60)) }
        let unwritten = pool.last!
        let customChars = [usedChars.first, unwritten].compactMap { $0 }
        let added = JSValue.array(customChars.map { .object(JSObject([("char", .string($0)), ("addedAt", .number(base))])) })
        var wordOff = JSObject()
        if let c = usedChars.last, g.chance(0.4) { wordOff["base:" + c] = .number(base) }
        let sessionDay = maxDay ?? "2026-10-21"
        let session: JSValue = g.chance(0.4) ? .object(JSObject([
            ("id", .string("s\(serial / 20 + 5)")), ("slot", .string("A")), ("kind", .string("daily")), ("source", .object(JSObject([("view", .string("home"))]))),
            ("queue", .array(active.prefix(6).map { .string("base:" + $0) })), ("cursor", .number(0)), ("items", .array([])),
            ("current", .object(JSObject([("phase", .string("recall")), ("strokes", .array([])), ("hints", .number(0)), ("answerSeen", .bool(false)), ("hintRange", .null), ("referenceReady", .bool(false))]))),
            ("lastLine", .null), ("startedAt", .number(base)), ("startedDay", .string(sessionDay)), ("updatedAt", .number(base)),
        ])) : .null
        let state = JSValue.object(JSObject([
            ("meta", .object(JSObject([("schema", .number(2)), ("serial", .number(Double(serial))), ("createdAt", .number(dayMs("2024-01-01"))), ("months", .array(months.map { .string($0) }))]))),
            ("records", .object(records)), ("sched", .object(sched)), ("ink", .object(ink)),
            ("custom", .object(JSObject([("added", added)]))), ("wordOff", .object(wordOff)), ("settings", .object(settings)),
            ("photos", .null), ("legacy", .null),
            ("sessions", .object(JSObject([("A", session), ("B", .null), ("lastEnded", .object(JSObject()))]))),
            ("funnel", .null), ("safety", .null),
        ]))
        var days: [String] = []
        if let d = maxDay { days.append(d) }
        if let first = months.first { days.append(first + "-01") }
        if let last = months.last { days.append(last + "-" + B.pad2(daysIn(last))) }
        days += ["2026-01-01", "2025-12-31", "2026-03-01", "2024-02-29"]
        var chars: [String] = []
        for c in [usedChars.last, usedChars.first, paperChar, skippedChar, unwritten] { if let c, !chars.contains(c) { chars.append(c) } }
        return Generated(state: state, days: days, chars: chars)
    }

    private static func startOfDayShanghai(_ day: String) -> Double? { startOfDay(day, shanghai) }

    static let monthSets: [[String]] = [
        ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03"], // 跨年、二月
        ScaleBenchmarkTests.monthsEndingOct2026(6),
        ["2024-01", "2024-02", "2024-03", "2025-12", "2026-01"], // 闰二月、中间断几个月
        ["2026-10"],
        [],
    ]

    static let zones: [Dates] = [shanghai, Dates(timeZone: TimeZone(identifier: "America/New_York")!), Dates(timeZone: TimeZone(identifier: "Australia/Lord_Howe")!)]

    private static func remindVariants(_ g: Gen) -> [JSValue?] {
        // nil = 用 state.settings 里的；开着（午夜前后、正午）；关着
        [nil, remindValue(true, 0, 0), remindValue(true, 23, 59), remindValue(true, g.int(24), g.int(60)), remindValue(false, 20, 0)]
    }

    // MARK: - 用例

    func testRandomHistoriesMatchReference() throws {
        JSMath.flavor = .v8
        let pool = B.chars(60)
        let g = Gen(20261105)
        for round in 0..<20 {
            let months = Self.monthSets[round % Self.monthSets.count]
            let adversarial = round % 2 == 1
            let fold = months.count > 2 ? (round / 2) % 3 : 0
            let gen = try Self.randomState(g, months: months, perMonth: [6, 25, 60][round % 3], pool: pool, fold: fold, adversarial: adversarial)
            let dates = Self.zones[round % Self.zones.count]
            checkCellInk(gen.state, dates: dates, label: "random#\(round)")
            for now in Self.moments(gen.days, dates, g, pick: 3) {
                checkAll(gen.state, dates: dates, now: now, chars: gen.chars, label: "random#\(round) adversarial=\(adversarial) fold=\(fold)", reminds: Self.remindVariants(g))
            }
        }
        XCTAssertGreaterThan(compared, 1000)
    }

    /// views-basic / views-pages 夹具里出现过的每个 state。
    func testFixtureStatesMatchReference() throws {
        JSMath.flavor = .v8
        let g = Gen(77)
        var states = 0
        for name in ["views-basic", "views-pages"] {
            let fx = try loadFixture(name)
            for group in fx["groups"]?.arrayValue ?? [] {
                let dates = Dates(timeZone: TimeZone(identifier: group["tz"]?.stringValue ?? "Asia/Shanghai")!)
                var seen: [String] = [], todays: [String] = []
                var list: [JSValue] = []
                for c in group["cases"]?.arrayValue ?? [] {
                    guard let a = c["args"], let st = a["state"], st.objectValue != nil else { continue }
                    if let t = a["today"]?.stringValue, !todays.contains(t) { todays.append(t) }
                    let key = JSONWriter.stringify(st)
                    if !seen.contains(where: { $0.utf8.elementsEqual(key.utf8) }) { seen.append(key); list.append(st) }
                }
                for (i, st) in list.enumerated() {
                    let recs = Query.flattenRecords(st["records"])
                    var chars: [String] = []
                    let picks: [JSValue?] = [recs.last, recs.first, recs.first(where: { Records.isPaperRecord($0) }), recs.first(where: { $0["kind"] == .string("skipped") })]
                    for r in picks {
                        if let c = r?["char"]?.stringValue, !chars.contains(c) { chars.append(c) }
                    }
                    chars.append("\u{6C38}")
                    let maxDay = recs.compactMap { $0["localDay"]?.stringValue }.max()
                    let days = [maxDay].compactMap { $0 } + Array(todays.prefix(4)) + ["2026-01-01"]
                    for now in Self.moments(days, dates, g, pick: 2) {
                        checkAll(st, dates: dates, now: now, chars: chars, label: "\(name) tz=\(dates.timeZone.identifier) state#\(i)", reminds: Self.remindVariants(g))
                    }
                    checkCellInk(st, dates: dates, label: "\(name) tz=\(dates.timeZone.identifier) state#\(i)")
                    states += 1
                }
            }
        }
        XCTAssertGreaterThan(states, 10)
    }

    // MARK: - 经 Store 的整页回答

    /// 播种 state（预算放大 seedFactor 倍，不折叠），再用 factor 倍预算开库；folded 时做一次真提交让回收按 400 天折叠旧月份（同 ScaleBenchmarkTests）。
    private func openStore(_ state: JSObject, seedFactor: Double, factor: Double, clock: B.Clock) throws -> Store {
        let disk = FakeNativeDisk()
        func make(_ f: Double) -> Store { Store(storage: StoreStorage(disk.open(), now: { clock.t }), now: { clock.t }, budgets: ScaleBenchmarkTests.budgets(f), dates: shanghai) }
        let seeding = make(seedFactor)
        XCTAssertEqual(seeding.load()["available"], .bool(true))
        let r = seeding.seed(.object(state), label: "eq-seed")
        XCTAssertEqual(r["ok"], .bool(true), str(r))
        let store = make(factor)
        XCTAssertEqual(store.load()["available"], .bool(true))
        if seedFactor != factor {
            clock.t += 1000
            let trig = store.commit("eq:fold-trigger") { d, c in
                var sessions = d["sessions"]!.objectValue!
                var A = sessions["A"]!.objectValue!
                A["updatedAt"] = .number(c.now)
                sessions["A"] = .object(A)
                d["sessions"] = .object(sessions)
            }
            XCTAssertEqual(trig["ok"], .bool(true), str(trig))
            let folded = (store.state["records"]?.objectValue?.entries ?? []).filter { $0.value["folded"] == .bool(true) }.count
            XCTAssertGreaterThan(folded, 0, "real budgets must fold the aged months")
        }
        return store
    }

    /// PageAPI.call（首页 / 字库 / 详情）与 ReminderController.sync 的回答 = 用参照拼出的同一个回包；再在同一状态上做函数层的全部比较。
    private func storeRound(_ store: Store, _ label: String, detailChars: [String], functions: Bool) throws {
        let st = JSValue.object(store.state), now = store.now(), dates = store.dates, today = try dates.localDay(.number(now))
        let l = label + " now=" + String(format: "%.0f", now)
        same(l + " api.view.home", { PageAPI.call("view.home", store: store) }, { JS.obj([("ok", .bool(true)), ("view", try Ref.homeView(st, now: now, policy: Config.policy, deck: .real, ui: nil, dates: dates))]) })
        same(l + " api.view.library", { PageAPI.call("view.library", store: store) }, { JS.obj([("ok", .bool(true)), ("view", try Ref.libraryPageView(st, now: now, today: today, deck: .real, policy: Config.policy, ui: nil, dates: dates))]) })
        for ch in detailChars {
            same(l + " api.view.detail " + ch, { PageAPI.call("view.detail", store: store, args: JSObject([("char", .string(ch))])) },
                 { JS.obj([("ok", .bool(true)), ("view", try Ref.detailView(st, char: ch, today: today, etymology: nil, imageAction: false, dates: dates))]) })
        }
        let rc = ReminderController(store: store)
        var posted: [JSValue] = []
        rc.post = { name, payload in if name == "syncReminder" { posted.append(payload) }; return true }
        let synced = rc.sync(force: true)
        XCTAssertNotNil(synced, l)
        same(l + " remind.sync", { synced ?? .null }, { try Ref.reminderPayload(st, remind: nil, today: .string(today), now: .number(now), deck: .shared, dates: dates) })
        same(l + " remind.sync.posted", { posted.first ?? .null }, { try Ref.reminderPayload(st, remind: nil, today: .string(today), now: .number(now), deck: .shared, dates: dates) })
        if functions {
            let g = Gen(UInt64(now.magnitude.truncatingRemainder(dividingBy: 1_000_000)))
            checkAll(st, dates: dates, now: now, chars: detailChars, label: l, reminds: Self.remindVariants(g))
        }
    }

    /// 有会话 / 无会话、提醒关 / 开，各在几个时刻上。
    private func storeScenario(_ state: JSObject, seedFactor: Double, factor: Double, label: String, functions: Bool) throws {
        JSMath.flavor = .v8
        let clock = B.Clock(B.benchNow)
        let store = try openStore(state, seedFactor: seedFactor, factor: factor, clock: clock)
        let recs = Query.flattenRecords(store.state["records"])
        var detailChars: [String] = []
        for c in [recs.last?["char"]?.stringValue, recs.first?["char"]?.stringValue, B.chars(9000).last] { if let c, !detailChars.contains(c) { detailChars.append(c) } }
        let clocks = [B.benchNow, localMs(2026, 10, 22) - 1, localMs(2026, 10, 22), localMs(2026, 11, 1), localMs(2027, 1, 1) - 1, localMs(2027, 1, 1)]
        func runRound(_ tag: String) throws {
            for t in clocks {
                clock.t = t
                try storeRound(store, label + " " + tag, detailChars: detailChars, functions: functions)
            }
            clock.t = B.benchNow + 5000
        }
        try runRound("session")
        clock.t = B.benchNow + 5000
        let cleared = store.commit("eq:clear-sessions") { d, _ in d["sessions"] = .object(JSObject([("A", .null), ("B", .null), ("lastEnded", .object(JSObject()))])) }
        XCTAssertEqual(cleared["ok"], .bool(true), str(cleared))
        try runRound("no-session")
        let on = SettingsView.commitRemindEnabled(store, on: .bool(true))
        XCTAssertEqual(on["ok"], .bool(true), str(on))
        try runRound("remind-on")
    }

    /// 小号的 heavyState：22 个月（2025-01 起，旧月份会被真折叠），每月 25 条，120 个字，60 条墨迹。每次都跑。
    func testSmallFoldedStoreMatchesReference() throws {
        let shape = B.Shape(months: ScaleBenchmarkTests.monthsEndingOct2026(22), recordsPerMonth: 25, studied: ScaleBenchmarkTests.studied(120), inkRecords: 60)
        try storeScenario(try B.heavyState(shape), seedFactor: 3, factor: 1, label: "small-folded", functions: true)
    }

    private func requireScaleBench() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["SHIZI_SCALE_BENCH"] == "1", "scale equivalence runs only with SHIZI_SCALE_BENCH=1")
    }

    /// ScaleBenchmarkTests 的 1x（6000 条记录、2000 个字）。
    func testScale1xMatchesReference() throws {
        try requireScaleBench()
        try storeScenario(try B.heavyState(), seedFactor: 1, factor: 1, label: "1x", functions: false)
    }

    /// ScaleBenchmarkTests 的 3x-folded（18000 条播种，原生预算折叠后的状态）。
    func testScale3xFoldedMatchesReference() throws {
        try requireScaleBench()
        let scale = ScaleBenchmarkTests.scale3xFolded()
        try storeScenario(try B.heavyState(scale.shape), seedFactor: scale.seedFactor, factor: scale.factor, label: "3x-folded", functions: false)
    }
}

/// 可复现的伪随机数（SplitMix64）。
struct HomeScaleRNG {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}
