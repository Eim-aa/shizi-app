import Foundation

/// ui/screens/result/native-view.js. Geometry and text only; rendering is the host's job.
public enum ResultPageView {
    public static func view(_ store: Store, _ a: JSObject, now: Double? = nil, shareAvailable: Bool = false) throws -> JSValue {
        let state = store.state
        func ink(_ r: JSValue?) throws -> JSValue {
            guard let r, let raw = store.getInk(r), let decoded = try InkMath.decodeInk(raw), !decoded.isEmpty else { return .null }
            return CoreEngine.strokesJS(InkMath.resampleForReplay(decoded))
        }
        let m = try ResultModels.model(state,a,dates:store.dates,hasInk:{ r in JS.truthy(try ink(r)) })
        let work = m["work"], session = m["session"], quiet = work?["empty"] == .bool(true), cells = m["cells"]?.arrayValue ?? []
        let width = a["width"]?.numberValue.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? 402
        let glyph = JS.truthy(a["ax"]) ? 52.0 : 36.0, pad = 0.03
        func t(_ key: String, _ values: [(String,JSValue)] = []) throws -> JSValue { try Copy.t(key,JSObject(values)) }
        func judgment(_ e: JSValue) throws -> JSValue { try t(e["judgment"] == .string("wrong") ? "X-WORK.statusWrong" : "X-WORK.statusCorrect") }
        func status(_ e: JSValue) throws -> JSValue {
            if e["state"] == .string("paper") { return try t("X-WORK.statusPaper") }
            if e["kind"] == .string("skipped") { return try t("X-WORK.statusSkipped") }
            if e["kind"] == .string("answer-seen") { return try t("X-WORK.statusSeen") };return try judgment(e)
        }
        func dot(_ c: Double, _ record: JSValue?, _ pad: Double) throws -> JSValue { ImageLayout.dotLayout(c,unit:1,bounds:ImageLayout.inkBounds(try ink(record)),pad:pad) }
        func label(_ entries: [JSValue]) throws -> JSValue {
            let chars = entries.map { JS.string($0["char"]) }.joined(separator:JS.string(try t("X-WORK.charsJoin")))
            let date = JS.truthy(m["day"]) ? try Copy.t("R-H02.dateFormat",store.dates.monthDayParts(m["day"]!).objectValue) : .string("")
            return try t(entries.count > 1 ? "X-WORK.workAria" : "X-WORK.workAriaOne",[("chars",.string(chars)),("n",.number(Double(entries.count))),("date",date)])
        }
        var workView: JSValue = .null
        if let work, !work.isNull {
            let entries = quiet ? work["entries"]?.arrayValue ?? [] : work["cells"]?.arrayValue ?? []
            if !entries.isEmpty {
                let grid = try ImageLayout.resultGrid(entries.count,screenWidth:width), c = JS.number(grid["c"]), cols = Int(JS.number(grid["cols"])), rows = Int(JS.number(grid["rows"]))
                var v = JSObject([("empty",.bool(quiet)),("c",.number(c)),("cols",grid["cols"]!),("rows",grid["rows"]!),("label",try label(entries))])
                if !quiet {
                    let n = entries.count, lastCol = (n-1)%cols, below = lastCol == cols-1
                    var frames: [JSValue] = []
                    func rect(_ y: Double, _ w: Double, _ h: Double) -> JSValue { JS.obj([("x",.number(0)),("y",.number(y)),("w",.number(w)),("h",.number(h))]) }
                    if rows == 1 { frames = [rect(0,Double(n)*c,c)] }
                    else if n%cols == 0 { frames = [rect(0,Double(cols)*c,Double(rows)*c)] }
                    else { frames = [rect(0,Double(cols)*c,Double(rows-1)*c),rect(Double(rows-1)*c,Double(n%cols)*c,c)] }
                    v["frames"] = .array(frames);v["kuan"] = try Copy.tRef(KuanView.kuanRef(JSObject([("day",m["day"] ?? .null),("n",.number(Double(n))),("picked",.bool(m["variant"] == .string("picked")))]),now:store.now(),dates:store.dates))
                    v["pad"] = .number(0.12);v["widthScale"] = .number(ImageLayout.inkWidthScale(c));v["sealPath"] = try CoreResources.load("view-seal")
                    var seal = JSObject([("below",.bool(below)),("size",.number(24))]);if !below {seal["x"] = .number(Double(lastCol+1)*c+JSMath.round(c*0.12));seal["y"] = .number(Double(rows)*c-24-JSMath.round(c*0.06))};v["seal"] = .object(seal)
                }
                v["cells"] = .array(try entries.map { e in
                    var row = JSObject([("index",e["index"]!),("char",e["char"]!),("recordId",e["recordId"] ?? .null),("kind",e["kind"]!)])
                    if quiet {
                        row["status"] = e["judgment"] == .string("wrong") && e["kind"] == .string("judged") && e["state"] != .string("paper") ? .string("") : try status(e)
                        let word = e["state"] == .string("paper") ? try t("X-WORK.paperState",[("state",judgment(e))]) : try status(e)
                        row["label"] = try t("X-WORK.cellAria",[("char",e["char"]!),("state",word)])
                    } else {
                        row["state"] = e["state"];row["label"] = try t("X-WORK.cellAria",[("char",e["char"]!),("state",t(e["tag"] == .string("afterSeen") ? "X-WORK.cellStateAfterSeen" : e["judgment"] == .string("wrong") ? "X-WORK.cellStateWrong" : "X-WORK.cellStateCorrect"))])
                        row["strokes"] = try e["record"].map { try WriteModels.sheet(store,$0) } ?? .array([]);row["dot"] = JS.truthy(e["dot"]) ? try dot(c,e["record"],0.12) : .null;row["cap"] = e["tag"] == .string("afterSeen") ? try t("X-WORK.afterSeen") : .string("")
                    };return .object(row)
                });workView = ViewSupport.ordered(.object(v),quiet ? "empty c cols rows label cells" : "empty c cols rows frames label kuan pad widthScale sealPath seal cells")
            }
        }
        let rows = try (work?["rows"]?.arrayValue ?? []).filter { $0["state"] != .string("in") && $0["state"] != .string("added") }.map { e -> JSValue in
            let inked = e["state"] == .string("addable"), wrong = !quiet && (inked || (e["state"] == .string("noInk") && e["judgment"] == .string("wrong")))
            let key: String
            switch JS.string(e["state"]) {case "addable","added":key = quiet ? "X-FIRST.excludedQuiet" : "X-FIRST.excluded";case "noInk":key = e["judgment"] == .string("wrong") ? "X-WORK.rowNoInkWrong" : "X-WORK.rowNoInkCorrect";case "seen":key="X-WORK.rowSeen";case "skipped":key="X-WORK.rowSkipped";default:key=e["judgment"] == .string("wrong") ? "X-WORK.rowPaperWrong" : "X-WORK.rowPaperCorrect"}
            let text = try t(key), paper = e["state"] == .string("paper"), index = Int(JS.number(e["index"]))
            let label = try t(paper ? "X-WORK.rowPaperAria" : "X-WORK.rowAria",[("char",e["char"]!),("state",paper ? judgment(e) : text)])
            return JS.obj([("index",e["index"]!),("char",e["char"]!),("recordId",e["recordId"] ?? .null),("kind",e["kind"]!),("state",e["state"]!),("judgment",e["judgment"] ?? .null),("text",text),("tag",paper ? try t("X-DETAIL.paperTag") : .string("")),("label",label),("widthScale",.number(ImageLayout.inkWidthScale(glyph))),("mode",.string(inked ? "hand" : "under")),("strokes",inked ? try WriteModels.sheet(store,e["record"]!) : .array([])),("dot",wrong ? try dot(glyph,inked ? e["record"] : nil,pad) : .null),("change",.bool(e["judgment"] == .string("wrong") && index < cells.count && cells[index]["canChange"] == .bool(true))),("changeLabel",.string(JS.string(try t("R-W10.lineRecordedCorrect")).components(separatedBy:" · ").last!.replacingOccurrences(of:" ›",with:"")+" ›")),("add",.bool(inked)),("addAria",inked ? try t("X-FIRST.addAria",[("char",e["char"]!)]) : .string(""))])
        }
        let extras = try ResultModels.firstExtras(JSObject([("cells",.array(cells)),("sched",state["sched"] ?? .null),("today",.string(try store.dates.localDay(.number(store.now())))),("work",work ?? .null),("variant",m["variant"]!)]),dates:store.dates)
        var body = JS.obj([("plain",try t("X-INVITE.bodyPlain"))])
        if let key = session?["queue"]?.arrayValue?.first, let card = DeckCards.shared.cardForKey(JS.string(key)), let py = card["py"]?.stringValue, !py.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty {
            let word = try Reminder.maskedWord(card), blank = Config.policy["reminderBlank"]!
            let parts = JS.string(try t("X-INVITE.body",[("word",.string("\u{1}")),("pinyin",.string(py.trimmingCharacters(in:.whitespacesAndNewlines)))])).components(separatedBy:"\u{1}")
            body = JS.obj([("pre",.string(parts[0])),("post",parts.count > 1 ? .string(parts[1]) : .null),("word",.array(word.unicodeScalars.map { .string(String($0)) })),("blanks",.array(word.unicodeScalars.map { .bool(.string(String($0)) == blank) }))])
        }
        let config = Config.motion["M"] ?? Config.motion, moment = config["moment"]!, dur = config["duration"]!, count = max(1,work?["empty"] == .bool(false) ? work?["cells"]?.arrayValue?.count ?? 1 : 1)
        let cellMs = JS.number(moment["workCellIn"]), sealMs = JS.number(moment["sealDrop"]), stagger = count > 1 ? min(JS.number(moment["workStagger"]),floor((JS.number(moment["max"])-(cellMs-40+60+sealMs))/Double(count-1))) : 0
        let kuanDelay = Double(count-1)*stagger+cellMs-40, sealDelay = kuanDelay+60
        let plan = JS.obj([("stagger",.number(stagger)),("cellMs",.number(cellMs)),("kuanDelay",.number(kuanDelay)),("kuanMs",dur["fade"]!),("sealDelay",.number(sealDelay)),("sealMs",.number(sealMs)),("contactMs",.number(sealMs-JS.number(dur["press"]))),("total",.number(sealDelay+sealMs))])
        let remaining = a["undo"]?["until"]?.numberValue.flatMap { $0.isFinite ? max(0,$0-(now ?? ProcessInfo.processInfo.systemUptime*1000)) : nil } ?? 0
        let undo = a["undo"]
        return JS.obj([("found",m["found"]!),("slot",a["slot"] ?? .null),("sessionId",a["sessionId"] ?? .null),("variant",m["variant"]!),("early",m["early"]!),("header",m["header"]!),("title",m["title"]!),("sub",.string((m["sub"]?.arrayValue ?? []).map(JS.string).joined())),("day",m["day"]!),("work",workView),("rows",.array(rows)),("quiet",.bool(quiet)),("lines",JS.obj([("title",ViewLineStarts.starts("result-title",m["title"] ?? .null)),("sub",ViewLineStarts.starts("result-sub",.string((m["sub"]?.arrayValue ?? []).map(JS.string).joined()))),("preview",ViewLineStarts.starts("result-preview",extras["preview"] ?? .null)),("inviteBody",ViewLineStarts.starts("result-invite",.string(body["plain"]?.stringValue ?? ((body["pre"]?.stringValue ?? "") + (body["word"]?.arrayValue ?? []).map(JS.string).joined() + (body["post"]?.stringValue ?? "")))))])),("rowGlyph",.number(glyph)),("rowPad",.number(pad)),("preview",extras["preview"]!),("share",.bool(JS.truthy(m["share"]) && shareAvailable)),("footer",JS.obj([("kind",.string(m["variant"] == .string("first") ? "first" : JS.truthy(m["again"]) ? "again" : "leave")),("leave",m["leave"]!["label"]!),("redo",.bool(cells.contains { $0["kind"] == .string("judged") && $0["judgment"] == .string("wrong") }))])),("invite",JS.obj([("show",.bool(JS.truthy(session) && FirstResult.inviteDecision(settings:state["settings"],variant:m["variant"] ?? .null,sessionId:session?["id"] ?? .null) == "show")),("title",try t("X-INVITE.title")),("titleEvening",try t("X-INVITE.titleEvening")),("body",body)])),("reveal",JS.obj([("sealed",.bool(session?["sealedAt"]?.numberValue?.isFinite == true)),("plan",plan)])),("undo",remaining > 0 ? JS.obj([("char",undo?["char"] ?? .string("")),("recordId",undo?["recordId"] ?? .null),("sessionId",undo?["sessionId"] ?? .null),("remainingMs",.number(remaining)),("strokes",undo?["strokes"] ?? .null)]) : .null)])
    }
}
