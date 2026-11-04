import Foundation

// Write-API snapshots and the prompt / line / redo ops.
public enum WriteModels {
    static func prompt(_ state: JSObject, key: String, queue: [JSValue], revealed: Bool) throws -> JSValue {
        var card = DeckCards.shared.cardForKey(key)
        if NewOrder.isCapitalQueue(queue), let c = card, let ctx = CharOrder.shared.capitalContext(of: JS.string(c["target"])) {
            card = SessionWrites.patch(c, [("word", .string(ctx.word)), ("chars", .array(ctx.word.unicodeScalars.map { .string(String($0)) })), ("ci", .number(Double(ctx.ci))), ("target", c["target"]!), ("py", .string(ctx.py)), ("ctx", .string("override")), ("promptHint", .string(ctx.promptHint))])
        }
        card = DeckCards.withWordOff(card, state["wordOff"])
        guard let card, let chars = card["chars"]?.arrayValue else { return JS.obj([("cells", .array([])), ("hint", .string(""))]) }
        let m = try Cards.promptModel(card)
        let cells = try (m["segments"]?.arrayValue ?? []).enumerated().map { i,s -> JSValue in
            let kind = s["kind"] ?? .string("text"); var text = s["text"] ?? .null, label = JSValue.null, fill = JSValue.null
            if kind == .string("blank") {
                if revealed { fill = card["target"] ?? .null }
                else {
                    let py = JS.string(card["py"]).trimmingCharacters(in: ViewSupport.whitespace)
                    if !py.isEmpty {
                        let marks: [UInt32:Int] = [0x304:1,0x301:2,0x30c:3,0x300:4]
                        let tone = py.decomposedStringWithCanonicalMapping.unicodeScalars.compactMap { marks[$0.value] }.first ?? 5
                        label = try Copy.t(chars.count > 1 ? "X-PROMPT.blankLabel" : "X-PROMPT.blankLabelSingle", JSObject([("n", .number(Double(i+1))), ("pinyin", .string(py)), ("tone", try Copy.t("X-PROMPT.tone" + String(tone)))]))
                    }
                }
            } else if kind == .string("repeatBlank") { if revealed { text = card["target"] ?? .null } else { label = s["label"] ?? .null } }
            return JS.obj([("kind", kind), ("text", text), ("label", label), ("fill", fill)])
        }
        return JS.obj([("cells", .array(cells)), ("hint", m["visibleHint"] ?? .string(""))])
    }
    static func line(_ s: JSValue, _ state: JSObject) throws -> JSValue {
        let none = JS.obj([("state", .string("none"))])
        guard let line = s["lastLine"], !line.isNull else { return s["items"]?.arrayValue?.last?["kind"] == .string("skipped") ? JS.obj([("state", .string("skipped"))]) : none }
        guard let r = SessionWrites.find(state, line["recordId"]), JS.truthy(r["char"]) else { return none }
        if line["kind"] == .string("saw") { return JS.obj([("state", .string("saw")), ("kind", .string("saw")), ("recordId", r["id"]!), ("text", try Copy.t("R-W10.lineSaw", JSObject([("char", r["char"]!)]))), ("action", .null), ("canChange", .bool(false))]) }
        guard Records.isJudged(r) else { return none }
        let changed = line["kind"] == .string("changed")
        let key = "R-W10.line" + (changed ? "Changed" : "Recorded") + (r["judgment"] == .string("correct") ? "Correct" : "Wrong")
        let full = try Copy.text(key, JSObject([("char", r["char"]!)])), cut = full.range(of: " · ", options: .backwards)
        let text = cut.map { String(full[..<$0.lowerBound]) } ?? full, action = cut.map { String(full[$0.upperBound...]) }
        return JS.obj([("state", .string("judged")), ("kind", .string(changed ? "changed" : "record")), ("recordId", r["id"]!), ("text", .string(text)), ("action", action.map(JSValue.string) ?? .null), ("canChange", .bool(action != nil && SessionRules.canCorrect(s, r["id"])))])
    }
    static func wire(_ strokes: [[InkPoint]]) -> JSValue { .array(strokes.map { .array($0.map { p in .array([.number(p.x), .number(p.y), .number(p.t ?? .nan)] + ((p.p?.isFinite ?? false) ? [.number(p.p!)] : [])) }) }) }
    static func fromWire(_ v: JSValue?) -> [[InkPoint]] {
        (v?.arrayValue ?? []).compactMap { s in
            guard let list = s.arrayValue else { return nil }
            let points = list.compactMap { q -> InkPoint? in
                guard let row = q.arrayValue, row.count >= 3, row.prefix(3).allSatisfy({ $0.numberValue?.isFinite == true }) else { return nil }
                let pressure = row.count > 3 ? row[3].numberValue : nil
                return InkPoint(x: row[0].numberValue!, y: row[1].numberValue!, t: row[2].numberValue!, p: pressure != nil && pressure!.isFinite && pressure! > 0 ? min(1, pressure!) : nil, order: InkPoint.orderXYTP)
            }; return points.isEmpty ? nil : points
        }
    }
    static func stored(_ s: JSValue) -> [[InkPoint]] { InkMath.decodeRawStrokes((s["current"]?["strokes"]?.arrayValue ?? []).map { ($0.arrayValue ?? []).map { JS.number($0) } }) }
    public static func snapshot(_ state: JSObject, slot: String) throws -> JSValue {
        guard let s = SessionWrites.session(state, slot) else { return JS.obj([("slot", .string(slot)), ("active", .bool(false))]) }
        var out = JSObject([("slot", .string(slot)), ("active", .bool(true)), ("sessionId", s["id"] ?? .null), ("kind", s["kind"] ?? .null), ("cursor", s["cursor"] ?? .null), ("total", .number(Double(s["queue"]?.arrayValue?.count ?? 0))), ("done", .bool(SessionRules.isComplete(s)))])
        guard let key = SessionRules.currentCardKey(s), !key.isNull else { out["cardKey"] = .null; return .object(out) }
        let raw = s["current"]?["phase"], strokes = stored(s), answer = ["answer", "trace"].contains(JS.string(raw)) ? "trace" : raw == .string("retrace") ? "retrace" : nil
        out["cardKey"] = key; out["char"] = Records.charOfCardKey(key).map(JSValue.string) ?? .null
        out["phase"] = .string(raw == .string("compare") && !strokes.isEmpty ? "compare" : "recall"); out["storedPhase"] = JS.truthy(raw) ? raw : .string("recall"); out["answerPhase"] = answer.map(JSValue.string) ?? .null
        out["canEnd"] = .bool(SessionWrites.canEnd(s)); out["strokes"] = wire(strokes); out["hints"] = SessionWrites.integer(s["current"]?["hints"]) ? s["current"]?["hints"] : .number(0)
        out["hintRange"] = JS.truthy(s["current"]?["hintRange"]) ? SessionHints.range(s["current"]?["hintRange"]) ?? .null : .null
        out["answerSeen"] = .bool(JS.truthy(s["current"]?["answerSeen"])); out["prompt"] = try prompt(state, key: JS.string(key), queue: s["queue"]?.arrayValue ?? [], revealed: answer == "trace")
        out["firstTip"] = .bool(s["kind"] == .string("first") && s["cursor"] == .number(0) && raw != .string("compare") && answer == nil && state["settings"]?["firstTipSeen"] != .bool(true))
        out["lastLine"] = s["lastLine"] ?? .null; out["line"] = try line(s, state); return .object(out)
    }
    static func sheet(_ store: Store, _ r: JSValue, policy: JSValue? = Config.policy) throws -> JSValue {
        if let ink = store.getInk(r) {
            if let raw = InkMath.decodeInkRaw(ink) { return wire(raw) }
            if let decoded = try InkMath.decodeInk(ink) { return wire(decoded) }
        }
        return .array((RecentInk.page.recalledInk(r["id"], policy: policy).arrayValue ?? []).map { stroke in .array((stroke.arrayValue ?? []).map { p in
            .array([p["x"] ?? .null, p["y"] ?? .null, p["t"] ?? .null] + (p["p"]?.numberValue?.isFinite == true ? [p["p"]!] : []))
        }) })
    }
}
