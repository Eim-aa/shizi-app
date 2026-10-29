import Foundation

/// Pure part of ui/images-entry.js and ui/images-annual.js. Rendering stays in B4.6.
public final class ImageRegisteredActions {
    public let store: Store
    public var palette: (() throws -> JSValue)?
    public var saveFile: ((JSValue) async throws -> JSValue)?
    public var post: ((JSValue) throws -> Void)?
    public init(store: Store) { self.store = store }
    public func install(on hooks: SessionActionHooks) {
        for name in ["view", "spec", "add", "closed"] { hooks.set("image." + name) { [self] in try call(name, $0) } }
        hooks.setAsync("image.persist") { [self] in await persist($0) }
    }
    func ink(_ record: JSValue) throws -> JSValue? {
        guard let raw = store.getInk(record), let decoded = try InkMath.decodeInk(raw), !decoded.isEmpty else { return nil }
        return CoreEngine.strokesJS(InkMath.resampleForReplay(decoded))
    }
    func job(_ a: JSObject) throws -> (scope: JSValue, plan: JSValue, annual: Bool) {
        var scope = a["scope"]?.objectValue ?? JSObject()
        let annual = scope["kind"] == .string("annual")
        if annual { return (.object(scope), try restoreInk(AnnualView.annualPlan(.object(store.state), today: store.dates.localDay(.number(store.now())), year: scope["year"], policy: Config.policy, dates: store.dates)), true) }
        if !["day", "month", "glyph"].contains(JS.string(scope["kind"])) { scope["kind"] = .string("session") }
        let plan = try ImageSelection.imagePlan(.object(store.state), scope: .object(scope), inkOf: ink, hasInk: { DetailView.recordHasInk(.object(self.store.state), record: $0, dates: self.store.dates) }, maxChars: Int(JS.number(Config.policy["imageMaxChars"])), monthPick: Config.policy["monthSheetPick"]?.stringValue ?? "first", dates: store.dates)
        return (.object(scope), plan, false)
    }
    func restoreInk(_ value: JSValue) throws -> JSValue {
        if let a = value.arrayValue { return .array(try a.map(restoreInk)) }
        guard var o = value.objectValue else { return value }
        for key in o.keys { o[key] = try restoreInk(o[key]!) }
        if o["ink"] != nil, let record = o["record"], !record.isNull { o["ink"] = try ink(record) ?? .null }
        return .object(o)
    }
    func text(_ key: String, _ pairs: [(String, JSValue)] = []) throws -> JSValue { try Copy.t(key, JSObject(pairs)) }
    func kuan(_ a: JSObject) throws -> JSValue { try Copy.tRef(KuanView.kuanRef(a, now: store.now(), dates: store.dates)) }
    func monthDay(_ day: JSValue) throws -> JSValue { try text("X-WORK.kuanMonthDay", store.dates.signatureDateParts(day).objectValue!.entries.map { ($0.key, $0.value) }) }
    func annualCover(_ p: JSValue) throws -> JSObject {
        guard JS.truthy(p["model"]?["first"]) else { throw CoreError.error("Cannot read properties of null (reading 'day')") }
        return JSObject([("yearText", .string(try KuanView.annualYearText(JS.number(p["model"]?["year"])))), ("line", try text("X-WORK.annualCoverLine", [("n", .string(Dates.cnCount(JS.number(p["model"]?["count"]))))])), ("first", p["first"] ?? .null), ("firstLabel", try text("X-WORK.annualFirstLabel")), ("firstDate", try text("X-WORK.annualFirstDate", [("date", monthDay(p["model"]?["first"]?["day"] ?? .null))])), ("kuan", try kuan(JSObject([("brand", .bool(true))])))])
    }
    func annualTail(_ p: JSValue) throws -> JSObject {
        JSObject([("title", try text("X-WORK.annualTwiceTitle")), ("first", p["tail"]?["first"] ?? .null), ("last", p["tail"]?["last"] ?? .null), ("firstDate", try monthDay(p["tail"]?["firstDay"] ?? .null)), ("lastDate", try monthDay(p["tail"]?["lastDay"] ?? .null)), ("kuan", try kuan(JSObject([("month", .string(String(try store.dates.localDay(.number(store.now())).prefix(7))))])))])
    }
    public func call(_ name: String, _ a: JSObject) throws -> JSValue {
        if name == "closed" {
            if let id = a["entryId"], JS.truthy(id) { try post?(JS.obj([("op", .string("close")), ("screen", .string(JS.string(id).hasPrefix("image-toast") ? "image-toast" : "image-preview")), ("entryId", id)])) }
            return JS.obj([("ok", .bool(true))])
        }
        let (scope,p,annual) = try job(a), kind = annual ? "annual" : JS.string(p["kind"]), pages = p["pages"]?.arrayValue ?? []
        let total = max(1, pages.count), status = JS.string(p["status"]), initial = annual || kind == "glyph" ? "3:4" : ImageLayout.defaultRatio(Int(JS.number(p["n"])))
        let ratio = JS.truthy(a["ratio"]) ? a["ratio"]! : .string(initial)
        if name == "add" {
            if kind != "session" { return SessionWrites.failure("unsupported") }
            _ = SessionResults.added(store, JSObject([("slot", scope["slot"] ?? .null), ("sessionId", scope["sessionId"] ?? .null), ("recordId", a["recordId"] ?? .null)]))
            return JS.obj([("ok", .bool(true))]) // toggleChip deliberately ignores the commit reply.
        }
        let title = try kind == "annual" ? text("X-WORK.annualSaveTitle") : kind == "month" ? text("X-WORK.monthTitle", [("month", .number(Double(String(JS.string(p["month"]).suffix(2))) ?? .nan))]) : text(kind == "glyph" ? "R-I01.kindGlyph" : "R-I01.kindSession")
        let emptyNote = try kind == "annual" ? .string("") : text(kind == "glyph" ? "R-D04.noInkNote" : kind == "month" ? "X-IMAGES.emptyMonth" : "R-R07.allMissing")
        let note = try annual ? text("X-WORK.annualSaveNote") : (status == "empty" || status == "noInk") ? emptyNote : total > 1 ? text("X-WORK.splitNote", [("n", p["n"] ?? .null), ("m", .number(Double(total))), ("max", p["maxChars"] ?? .null)]) : .string("")
        if name == "view" {
            let chips = try (p["work"]?["addable"]?.arrayValue ?? []).map { e in JS.obj([("recordId", e["recordId"] ?? .null), ("ch", e["char"] ?? .null), ("on", .bool(e["state"] == .string("added"))), ("thumb", .string(""))]) }
            return JS.obj([("ok", .bool(true)), ("view", JS.obj([("kind", .string(kind)), ("title", title), ("ratios", .array((annual ? ["3:4"] : ["3:4", "1:1"]).map(JSValue.string))), ("ratio", ratio), ("initialRatio", .string(initial)), ("pageCount", .number(Double(total))), ("status", .string(status)), ("note", note), ("noteStarts", .null), ("boardNote", status == "ready" ? .string("") : note), ("saveLabel", try annual ? text("X-WORK.annualSaveButton", [("n", .number(Double(total)))]) : total > 1 ? text("X-WORK.saveMany", [("m", .number(Double(total)))]) : text("X-IMAGES.save")), ("shareLabel", try text("R-B10.share")), ("chips", .array(chips)), ("alt", annual ? JS.obj([("label", try text("X-WORK.annualSaveLong")), ("note", try text("X-WORK.annualLongNote"))]) : .null), ("failText", JS.obj([("share", try text("X-SHARE.cardFailed")), ("render", try text("X-IMAGES.renderFailed")), ("denied", try text("R-B10.albumDenied")), ("save", try text("X-IMAGES.saveFailed"))])), ("failStarts", .object(JSObject()))]))])
        }
        guard name == "spec" else { return SessionWrites.failure("unavailable") }
        if a["mode"] == .string("long") && !annual { return SessionWrites.failure("unsupported") }
        let n = JS.numberOr0(a["page"]), i = n.isFinite && n >= 0 && n.rounded(.towardZero) == n && n < Double(pages.count) ? Int(n) : -1
        let scale = a["mode"] == .string("export") || a["mode"] == .string("long") || total <= 3 ? 4.0/3 : 0.4
        var spec = JSObject([("status", .string(status))]), file: String
        if annual {
            let year = JS.string(p["model"]?["year"])
            file = a["mode"] == .string("long") ? "shizi-annual-\(year)-long.jpg" : "shizi-annual-\(year)-\(String(format: "%02d", Int(n)+1))of\(total).jpg"
            var args = JSObject()
            if a["mode"] == .string("long") {
                args = try annualCover(p)
                args["months"] = .array(try (p["months"]?.arrayValue ?? []).map { m in JS.obj([("name", try text("X-WORK.annualMonthName", [("month", m["monthNum"]!)])), ("count", try text("X-WORK.annualMonthCount", [("n", .number(Double(m["cells"]?.arrayValue?.count ?? 0)))])), ("cells", m["cells"]!)]) })
                args["tail"] = JS.truthy(p["tail"]) ? .object(try annualTail(p)) : .null
                spec = JSObject([("status", .string("ready")), ("kind", .string("annual-long")), ("args", .object(args))])
            } else if i >= 0 {
                let page = pages[i], type = JS.string(page["type"])
                if type == "cover" { args = try annualCover(p) } else if type == "tail" { args = try annualTail(p) }
                else { args = JSObject([("cells", page["cells"]!), ("ratio", .string("3:4")), ("kuan", try kuan(JSObject([("month", page["month"]!), ("n", .number(Double(page["cells"]?.arrayValue?.count ?? 0))), ("part", page["part"]!), ("of", page["of"]!)])))]) }
                args["scale"] = .number(scale)
                var meta = JSObject(); if type == "month" { meta["kind"] = .string("annual-month"); meta["month"] = page["month"] }; meta["page"] = .number(Double(i+1)); meta["pages"] = .number(Double(pages.count)); args["meta"] = .object(meta)
                spec = JSObject([("status", .string("ready")), ("kind", .string(type == "cover" ? "annual-cover" : type == "tail" ? "annual-tail" : "work")), ("args", .object(args))])
            } else { spec = JSObject([("status", .string("empty"))]) }
        } else {
            let key = JS.string(p["key"]).unicodeScalars.filter { (48...57).contains($0.value) || (65...90).contains($0.value) || (97...122).contains($0.value) || (0x3400...0x9fff).contains($0.value) || $0 == "-" }.map(String.init).joined()
            file = "shizi-\(kind)-\(key)-\(ratio == .string("1:1") ? "1x1" : "3x4")\(total > 1 ? "-\(JS.string(.number(n+1)))of\(total)" : "").jpg"
            if status == "ready" {
                if kind == "glyph", let cell = p["drawn"]?.arrayValue?.first, let record = cell["record"] {
                    let py = DeckCards.shared.cardForKey(JS.string(record["cardKey"]))?["py"], day = record["localDay"] ?? .null
                    let date = try text("R-H02.dateFormat", store.dates.monthDayParts(day).objectValue!.entries.map { ($0.key,$0.value) })
                    let caption = JS.truthy(py) ? try text("R-I02.glyphCaption", [("pinyin", py!), ("date", date)]) : date
                    spec = JSObject([("status", .string("ready")), ("kind", .string("glyph")), ("args", JS.obj([("points", cell["points"] ?? .null), ("caption", caption), ("signatureText", try text("X-IMAGES.brand")), ("ratio", .string(ratio == .string("1:1") ? "square" : "portrait")), ("meta", JS.obj([("kind", .string("glyph")), ("members", cell["char"] ?? .null), ("recordIds", record["id"]!), ("day", day)]))]))])
                } else {
                    let cells = i >= 0 ? pages[i].arrayValue ?? [] : []
                    spec = JSObject([("status", .string(cells.isEmpty ? "empty" : "ready")), ("kind", .string(kind == "month" ? "sheet" : "work")), ("args", JS.obj([("cells", .array(cells)), ("ratio", ratio), ("kuan", try kuan(JSObject([(kind == "month" ? "month" : "day", p[kind == "month" ? "month" : "day"] ?? .null), ("n", .number(Double(cells.count))), ("part", .number(n+1)), ("of", .number(Double(pages.count)))]))), ("scale", .number(scale)), ("meta", JS.obj([("kind", .string(kind)), ("key", p["key"] ?? .null), ("plan", .string(status)), ("day", JS.truthy(p["day"]) ? p["day"]! : .string("")), ("month", JS.truthy(p["month"]) ? p["month"]! : .string("")), ("days", (p["days"] == nil || p["days"] == .null) ? .string("") : p["days"]!), ("page", .number(n+1)), ("pages", .number(Double(pages.count)))]))]))])
                }
            }
        }
        guard let palette else { throw CoreError.error("PALETTE_UNAVAILABLE") }; spec["palette"] = try palette()
        return JS.obj([("ok", .bool(true)), ("spec", .object(spec)), ("name", .string(file)), ("total", .number(Double(total)))])
    }
    public func persist(_ a: JSObject) async -> JSValue {
        for image in a["images"]?.arrayValue ?? [] {
            var file = image
            if JS.string(image["dataURL"]).hasPrefix("data:image/png"), let name = image["name"]?.stringValue {
                let converted = name.replacingOccurrences(of: "\\.jpe?g$", with: ".png", options: [.regularExpression, .caseInsensitive])
                file = SessionWrites.patch(image, [("name", .string(converted))])
            }
            let one: JSValue
            do { one = try await saveFile?(file) ?? .null } catch { return SessionWrites.failure("download") }
            if !JS.truthy(one["ok"]) { return SessionWrites.failure(JS.truthy(one["reason"]) ? JS.string(one["reason"]) : one["via"] == .string("native") ? "denied" : "download") }
        }
        return JS.obj([("ok", .bool(true)), ("via", .string("native"))])
    }
}
