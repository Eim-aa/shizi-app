import Foundation

/// Write-session API. Platform callbacks and elapsed `ms` belong to the host.
public enum WriteAPI {
    static func plain(_ r: JSValue) -> JSValue {
        var error = JSObject([("kind", r["error"]?["kind"]?.stringValue.map(JSValue.string) ?? .string("generic"))])
        if let reason = r["error"]?["reason"]?.stringValue { error["reason"] = .string(reason) }
        return JS.obj([("ok", .bool(false)), ("error", .object(error))])
    }
    static func finish(_ store: Store, slot: String) -> JSValue {
        guard let s = SessionWrites.session(store.state, slot), SessionRules.isComplete(s) else { return .null }
        let r = SessionResults.finish(store, JSObject([("slot", .string(slot)), ("sessionId", s["id"]!)]))
        return JS.obj([("ok", .bool(r["ok"] == .bool(true))), ("sessionId", s["id"]!)])
    }
    static func look(_ result: Bool = false, dependencies d: WriteDependencies? = nil) throws -> JSObject {
        let ui = try SessionResources.ui; var out = JSObject([("ok", .bool(true))])
        let keys = (ui["writeKeys"]?.arrayValue ?? []) + (result ? ui["resultKeys"]?.arrayValue ?? [] : [])
        out["copy"] = bundle(keys); out["colors"] = try d?.colors?() ?? .object(JSObject()); out["type"] = try d?.type?() ?? .object(JSObject())
        for key in ["timing", "motion", "layout", "trace", "skipUndo", "ink"] { out[key] = ui[key] }
        if result { out["layout"] = nil; out["trace"] = nil; out["motion"] = SessionWrites.patch(out["motion"], [("result", ui["resultMotion"]!)]) }
        if let theme = try d?.theme?(), theme == .string("light") || theme == .string("dark") { out["theme"] = theme }
        return out
    }
    static func bundle(_ keys: [JSValue]) -> JSValue { var o = JSObject(); for k in keys { if let v = try? Copy.t(JS.string(k)) { o[JS.string(k)] = v } }; return .object(o) }
    public static func call(_ op: String, _ store: Store, _ args: JSObject, dependencies: WriteDependencies? = nil) -> JSValue {
        do { return try run(op, store, args, dependencies: dependencies) }
        catch let error as CoreError { return JS.obj([("ok", .bool(false)), ("error", JS.obj([("kind", .string("exception")), ("reason", .string(error.message))]))]) }
        catch { return JS.obj([("ok", .bool(false)), ("error", JS.obj([("kind", .string("exception")), ("reason", .string(String(describing: error)))]))]) }
    }
    static func run(_ op: String, _ store: Store, _ a: JSObject, dependencies: WriteDependencies? = nil) throws -> JSValue {
        let slot = JS.string(a["slot"])
        func snapshot() throws -> JSValue { var value = try WriteModels.snapshot(store.state,slot:slot).objectValue!;value["slot"] = a["slot"];return .object(value) }
        func flow(_ r: JSValue) throws -> JSValue { SessionWrites.patch(r["ok"] == .bool(true) ? JS.obj([("ok", .bool(true))]) : plain(r), [("snapshot", try snapshot())]) }
        var args = a
        switch op {
        case "open":
            let r = try SessionWrites.commitRecover(store, a); let out = try look(dependencies: dependencies)
            var ordered = JSObject([("ok", .bool(true)), ("recovered", .bool(r["ok"] == .bool(true) && r["noop"] != .bool(true))), ("snapshot", try snapshot())])
            for (k,v) in out.entries where k != "ok" { ordered[k] = v }; return .object(ordered)
        case "strokes", "phase", "judge", "answerPhase", "answerNext": args["strokes"] = CoreEngine.strokesJS(WriteModels.fromWire(a["strokes"]))
        default: break
        }
        switch op {
        case "strokes":
            let raw = SessionWrites.session(store.state, slot)?["current"]?["phase"] ?? .string("recall")
            args["inkKey"] = .string(SessionWrites.inkKey(JS.string(a["cardKey"]), raw))
            let r = SessionWrites.commitStrokes(store, args)
            return r["ok"] == .bool(true) ? JS.obj([("ok", .bool(true)), ("noop", .bool(r["noop"] == .bool(true)))]) : plain(r)
        case "phase":
            if a["phase"] != .string("compare") { args["strokes"] = nil }
            let r = try SessionWrites.commitComparePhase(store, args); return r["ok"] == .bool(true) ? JS.obj([("ok", .bool(true))]) : plain(r)
        case "judge":
            let r = SessionWrites.commitJudgment(store, args)
            if r["ok"] != .bool(true) { return try flow(r) }
            let f = finish(store, slot: slot)
            return JS.obj([("ok", .bool(true)), ("recordId", r["record"]?["id"] ?? .null), ("reused", .bool(JS.truthy(r["reused"]))), ("finished", f), ("snapshot", try snapshot())])
        case "showAnswer": return try flow(SessionWrites.commitAnswerSeen(store, a))
        case "answerPhase":
            guard ["trace", "retrace"].contains(JS.string(a["phase"])) else { return try flow(SessionWrites.failure("invalid")) }
            return try flow(SessionWrites.commitAnswerPhase(store, args))
        case "answerNext":
            let r = SessionWrites.commitAnswerNext(store, args); if r["ok"] != .bool(true) { return try flow(r) }
            let f = finish(store, slot: slot); return JS.obj([("ok", .bool(true)), ("finished", f), ("snapshot", try snapshot())])
        case "skip":
            args["hints"] = .number(SessionWrites.count(a["hints"])); let r = SessionWrites.commitSkip(store, args)
            if r["ok"] != .bool(true) { return try flow(r) }; let f = finish(store, slot: slot), rcd = r["record"]
            let undo = rcd.flatMap { $0.isNull ? nil : $0 }.map { JS.obj([("sessionId", $0["sessionId"]!), ("recordId", $0["id"]!), ("char", $0["char"]!), ("ms", Config.policy["skipUndo"]!["ms"]!)]) } ?? .null
            return JS.obj([("ok", .bool(true)), ("finished", f), ("snapshot", try snapshot()), ("undo", undo)])
        case "undoSkip":
            let strokes = WriteModels.fromWire(a["strokes"]); args["strokes"] = strokes.isEmpty ? .null : SessionWrites.rows(strokes)
            return try flow(SessionWrites.commitUndoSkip(store, args))
        case "end":
            if a["action"] == .string("counts") { let s = SessionWrites.session(store.state, slot); return JS.obj([("ok", .bool(true)), ("n", .number(s.map { Double(TodayPlan.pendingFirsts($0).count) } ?? 0)), ("m", .number(Double(s == nil ? 0 : SessionWrites.judgedCount(store.state, s?["id"])))), ("canEnd", .bool(SessionWrites.canEnd(s)))]) }
            let r = SessionWrites.commitEndGroup(store, a); return r["ok"] == .bool(true) ? JS.obj([("ok", .bool(true)), ("judgedCount", r["judgedCount"]!), ("sessionId", a["sessionId"] ?? .null), ("snapshot", try snapshot())]) : try flow(r)
        case "firstTip":
            let r = SessionWrites.commitFlag(store, key: "firstTipSeen", label: "write:first-tip"); return r["ok"] == .bool(true) ? JS.obj([("ok", .bool(true))]) : plain(r)
        case "correct":
            if !["correct", "wrong"].contains(JS.string(a["to"])) { args["to"] = nil }
            if a["action"] == .string("state") {
                guard let s = SessionWrites.session(store.state, slot), s["lastLine"]?["recordId"] == a["recordId"], SessionRules.canCorrect(s, a["recordId"]), let r = SessionWrites.find(store.state, a["recordId"]), Records.isJudged(r) else { return try flow(SessionWrites.failure("stale")) }
                return JS.obj([("ok", .bool(true)), ("recordId", a["recordId"]!), ("char", r["char"]!), ("judgment", r["judgment"]!), ("paper", .bool(Records.isPaperRecord(r))), ("strokes", try WriteModels.sheet(store, r))])
            }
            let r = SessionResults.correct(store, args, mode: "write"); return r["ok"] == .bool(true) ? JS.obj([("ok", .bool(true)), ("recordId", a["recordId"] ?? .null), ("judgment", r["record"]?["judgment"] ?? .null), ("snapshot", try snapshot())]) : try flow(r)
        case "hint": return try hint(store, a, groups: dependencies?.groups)
        case "copy":
            let defaultKeys = try SessionResources.ui["writeKeys"]!.arrayValue!
            return JS.obj([("ok", .bool(true)), ("copy", bundle(a["keys"]?.arrayValue ?? defaultKeys))])
        case "refLabel":
            guard let char = a["char"]?.stringValue, !char.isEmpty else { return SessionWrites.failure("invalid") }
            let v = try dependencies?.refLabel?(JSObject([("char", .string(char)), ("cardKey", a["cardKey"]?.stringValue.map(JSValue.string) ?? .null)])) ?? Copy.t("R-W09.refCardLabelChar", JSObject([("char", .string(char))]))
            return JS.obj([("ok", .bool(true)), ("label", .string(JS.truthy(v) ? JS.string(v) : ""))])
        case "redoOpen", "redoNext":
            var seen = Set<String>()
            let list = (a["chars"]?.arrayValue ?? []).compactMap { v -> String? in
                guard let c = v.stringValue, c.unicodeScalars.count == 1, !seen.contains(c), DeckCards.shared.isPracticable("base:" + c) else { return nil }; seen.insert(c); return c
            }
            let n = JS.number(a["index"]).rounded(.towardZero)
            if list.isEmpty || (op == "redoNext" && (!n.isFinite || n < 0 || n >= Double(list.count))) { return SessionWrites.failure("invalid") }
            if op == "redoNext" && n == Double(list.count-1) { return JS.obj([("ok", .bool(true)), ("done", .bool(true))]) }
            let i = op == "redoOpen" ? 0 : Int(n)+1, queue = list.map { JSValue.string("base:"+$0) }
            let snap = JS.obj([("slot", .string("redo")), ("active", .bool(true)), ("kind", .string("redo")), ("sessionId", .null), ("cursor", .number(Double(i))), ("total", .number(Double(list.count))), ("done", .bool(false)), ("cardKey", queue[i]), ("char", .string(list[i])), ("last", .bool(i == list.count-1)), ("phase", .string("recall")), ("storedPhase", .string("recall")), ("answerPhase", .null), ("canEnd", .bool(false)), ("strokes", .array([])), ("hints", .number(0)), ("hintRange", .null), ("answerSeen", .bool(false)), ("prompt", try WriteModels.prompt(store.state, key: JS.string(queue[i]), queue: queue, revealed: false)), ("firstTip", .bool(false)), ("lastLine", .null), ("line", JS.obj([("state", .string("none"))]))])
            if op == "redoNext" { return JS.obj([("ok", .bool(true)), ("done", .bool(false)), ("snapshot", snap)]) }
            let appearance = try look(dependencies: dependencies); var out = JSObject([("ok", .bool(true)), ("chars", .array(list.map(JSValue.string))), ("snapshot", snap)])
            for key in ["copy", "colors", "type", "timing", "motion", "layout", "ink", "theme"] { out[key] = appearance[key] }; return .object(out)
        case "redoExit":
            guard let f = dependencies?.navigate?["redoBack"] else { return SessionWrites.failure("invalid") }
            _ = try f([]); return JS.obj([("ok", .bool(true))])
        case "exit":
            if a["to"] == .string("detail") {
                guard let char = a["char"]?.stringValue, !char.isEmpty, let f = dependencies?.navigate?["toDetail"] else { return SessionWrites.failure("invalid") }
                return JS.obj([("ok", .bool(try f([a["slot"] ?? .null, .string(char)]) != .bool(false)))])
            }
            let name = a["to"] == .string("result") ? "toResult" : "back"
            guard let f = dependencies?.navigate?[name] else { throw CoreError.error(dependencies?.navigate == nil ? "write session api: navigate.\(name) not provided" : "navigate.\(name) is not a function") }
            var undo: JSValue = .null
            if let raw = a["undo"], raw["sessionId"]?.stringValue != nil, raw["recordId"]?.stringValue != nil {
                let wire = WriteModels.fromWire(raw["strokes"])
                let n = JS.number(raw["remainingMs"])
                undo = JS.obj([("sessionId", raw["sessionId"]!), ("recordId", raw["recordId"]!), ("char", raw["char"]?.stringValue.map(JSValue.string) ?? .string("")), ("strokes", wire.isEmpty ? .null : SessionWrites.rows(wire)), ("remainingMs", .number(max(0, n.isNaN ? 0 : n)))])
            }
            _ = try f(name == "back" ? [a["slot"] ?? .null, undo] : [a["slot"] ?? .null, a["sessionId"] ?? .null, undo])
            return JS.obj([("ok", .bool(true))])
        case "resultLook": return .object(try look(true, dependencies: dependencies))
        case "result", "resultCell", "resultCorrect", "resultAdd", "resultSealed", "resultUndoSkip", "resultAgain", "resultExit", "resultInvite": return try ResultAPI.call(op, store, a, dependencies: dependencies)
        default: return SessionWrites.failure("unknown-op")
        }
    }
    static func hint(_ store: Store, _ a: JSObject, groups: JSValue? = nil) throws -> JSValue {
        guard let s = SessionWrites.current(store, a), JS.truthy(s["current"]) else { return SessionWrites.failure("stale") }
        var args = a; args["char"] = Records.charOfCardKey(a["cardKey"]).map(JSValue.string); args["groups"] = SessionHints.groupsFor(args["char"], table: groups)
        let source = SessionHints.source(args), stored = SessionWrites.integer(s["current"]?["hints"]) ? JS.number(s["current"]?["hints"]) : 0
        let used = max(stored, SessionWrites.count(a["used"])), seen = JS.truthy(s["current"]?["answerSeen"]), phase = JS.truthy(s["current"]?["phase"]) ? s["current"]!["phase"]! : .string("recall")
        func view(_ u: Double, _ seen: Bool) throws -> JSValue {
            let v = JSObject([("phase", phase), ("status", source["status"]!), ("used", .number(u)), ("answerSeen", .bool(seen)), ("source", source)])
            return JS.obj([("button", try SessionHints.button(v)), ("note", try SessionHints.note(v))])
        }
        args["sessionId"] = s["id"]; args["hints"] = a["hints"] ?? .number(used)
        if a["action"] == .string("range") {
            args["hintRange"] = SessionHints.range(a["hintRange"]) ?? .null
            let r = SessionHints.commitHint(store, args, label: "hint-fade"); return r["ok"] == .bool(true) ? JS.obj([("ok", .bool(true)), ("applied", .bool(JS.truthy(r["applied"])))]) : plain(r)
        }
        if a["action"] != .string("give") { return SessionWrites.patch(JS.obj([("ok", .bool(true)), ("used", .number(used))]), (try view(used, seen)).objectValue!.entries.map { ($0.key,$0.value) }) }
        let model = try view(used, seen)
        let step = model["button"]?["kind"] == .string("available") ? try SessionHints.step(JSObject([("source", source), ("used", .number(used)), ("written", .number(SessionWrites.count(a["written"]))), ("range", SessionHints.range(a["range"]) ?? .null)])) : .null
        if step.isNull { return SessionWrites.patch(SessionWrites.failure("unavailable"), [("used", .number(used))] + model.objectValue!.entries.map { ($0.key,$0.value) }) }
        args["step"] = step; let r = SessionHints.commitStep(store, args), range = step["hintRange"]!, from = JS.number(range["from"]) + 1, to = JS.number(range["to"])
        let text = try Copy.t(from == to ? "X-WRITE.liveRangeOne" : "X-WRITE.liveRangeMany", JSObject([("a", .number(from)), ("b", .number(to))]))
        let out: [(String,JSValue)] = [("given", JS.obj([("from", step["plan"]!["from"]!), ("to", step["plan"]!["to"]!), ("skip", step["plan"]!["skip"]!)])), ("used", step["used"]!), ("hintRange", range), ("whole", step["whole"]!), ("announce", try Copy.t("X-WRITE.liveHint", JSObject([("range", text)])))]
        return SessionWrites.patch(r["ok"] == .bool(true) ? JS.obj([("ok", .bool(true))]) : plain(r), out + (try view(JS.number(step["used"]), seen || (JS.truthy(step["whole"]) && r["ok"] == .bool(true)))).objectValue!.entries.map { ($0.key,$0.value) })
    }
}
