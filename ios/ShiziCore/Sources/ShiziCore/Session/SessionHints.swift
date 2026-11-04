import Foundation

// Hint ops: the source, button and transactional hint step.
public enum SessionHints {
    static func source(_ a: JSObject) -> JSValue {
        let n = JS.number(a["totalStrokes"])
        if n.isFinite && n.rounded(.towardZero) == n && n > 0 {
            let groups = a["groups"] ?? .null
            let list = groups.arrayValue ?? [], has = !list.isEmpty && list.allSatisfy { SessionWrites.integer($0) && JS.number($0) >= 1 } && list.reduce(0.0) { $0 + JS.number($1) } == n
            return JS.obj([("status", .string("ready")), ("totalStrokes", .number(n)), ("hasStrokeData", .bool(true)), ("hasGroups", .bool(has))])
        }
        return JS.obj([("status", .string(a["totalStrokes"] == .number(0) ? "missing" : "loading")), ("totalStrokes", .number(0)), ("hasStrokeData", .bool(a["totalStrokes"] != .number(0))), ("hasGroups", .bool(false))])
    }
    static func range(_ r: JSValue?) -> JSValue? {
        guard let r, SessionWrites.integer(r["from"]), SessionWrites.integer(r["to"]), JS.number(r["from"]) >= 0, JS.number(r["to"]) > JS.number(r["from"]) else { return nil }
        return JS.obj([("from", r["from"]!), ("to", r["to"]!)])
    }
    static func merge(_ prev: JSValue?, _ next: JSValue) -> JSValue {
        var out = JSObject()
        out["from"] = range(prev) != nil && range(next) != nil && JS.number(prev?["to"]) <= JS.number(next["from"]) ? prev?["from"] : next["from"]
        out["to"] = next["to"]; return .object(out)
    }
    static func button(_ a: JSObject) throws -> JSValue {
        let source = a["source"], status = JS.string(a["status"]), used = a["used"] ?? .number(0), phase = a["phase"] ?? .string("recall")
        let total = source?["status"] == .string("ready") ? source?["totalStrokes"] ?? .number(0) : .number(0)
        let args = JS.obj([("totalStrokes", total), ("used", used), ("hasStrokeData", .bool(status != "missing")), ("hasGroups", source?["hasGroups"] ?? .bool(true))])
        let done = try Hints.allGiven(args)
        if phase != .string("recall") || (JS.truthy(a["answerSeen"]) && !done) { return JS.obj([("kind", .string("hidden"))]) }
        let st = try Hints.buttonState(args), copy = try Hints.buttonCopy(st)
        let label = try Copy.t(JS.string(copy["key"]), copy["vars"]?.objectValue)
        if st["state"] == .string("unavailable") { return JS.obj([("kind", .string("unavailable")), ("label", label)]) }
        let exhausted = st["state"] == .string("exhausted"), ready = status == "ready"
        return JS.obj([("kind", .string(exhausted ? "exhausted" : ready ? "available" : "loading")), ("label", label), ("text", try Copy.t("R-W05.hintLabel")), ("disabled", .bool(exhausted || !ready)), ("remaining", exhausted ? .number(0) : st["remaining"] ?? .null)])
    }
    static func note(_ a: JSObject) throws -> JSValue {
        if (a["phase"] ?? .string("recall")) != .string("recall") || JS.truthy(a["answerSeen"]) { return .null }
        return a["status"] == .string("missing") ? JS.obj([("kind", .string("no-hint")), ("text", try Copy.t("R-W05.noHintNote")), ("dot", .bool(true))]) : .null
    }
    static func step(_ a: JSObject) throws -> JSValue {
        guard let source = a["source"], source["status"] == .string("ready") else { return .null }
        let used = a["used"] ?? .number(0), written = JS.number(a["written"] ?? .number(0))
        func at(_ u: JSValue) throws -> JSValue { try Hints.nextRange(SessionWrites.patch(source, [("used", u)])) }
        var r = try at(used), skip = 0.0
        if r.isNull { return .null }
        while JS.number(r["from"]) + JS.number(r["count"]) <= written {
            let next = try at(jsAdd(jsAdd(used, .number(skip)), .number(1))); if next.isNull { break }; r = next; skip += 1
        }
        let plan = JS.obj([("from", r["from"]!), ("to", .number(JS.number(r["from"]) + JS.number(r["count"]))), ("count", r["count"]!), ("index", r["index"]!), ("skip", .number(skip))])
        let n = jsAdd(jsAdd(used, .number(1)), .number(skip))
        return JS.obj([("plan", plan), ("used", n), ("hintRange", merge(a["range"], plan)), ("whole", .bool(try Hints.allGiven(SessionWrites.patch(source, [("used", n)]))))])
    }
    public static func commitHint(_ store: Store, _ a: JSObject, label: String = "hint") -> JSValue {
        var applied = false
        let result = store.commit(label) { d,c in
            let slot = JS.string(a["slot"])
            guard let s = SessionWrites.session(d, slot), s["id"] == a["sessionId"], SessionRules.currentCardKey(s) == a["cardKey"], JS.truthy(s["current"]) else { return }
            var hintRange = JSObject(); hintRange["from"] = a["hintRange"]?["from"]; hintRange["to"] = a["hintRange"]?["to"]
            var p = JSObject([("hintRange", JS.truthy(a["hintRange"]) ? .object(hintRange) : .null)])
            if let n = a["hints"] { p["hints"] = .number(max(JS.numberOr0(s["current"]?["hints"]), JS.number(n))) }
            SessionWrites.set(&d, slot, try SessionRules.withCurrent(s, .object(p), at: .number(c.now))); applied = true
        }
        return result["ok"] == .bool(true) ? JS.obj([("ok", .bool(true)), ("applied", .bool(applied))]) : JS.obj([("ok", .bool(false)), ("error", result["error"] ?? .null)])
    }
    public static func commitStep(_ store: Store, _ a: JSObject) -> JSValue {
        let step = a["step"] ?? .null
        var args = a; args["hints"] = step["used"]; args["hintRange"] = step["hintRange"]
        if !JS.truthy(step["whole"]) { return commitHint(store, args) }
        args["stay"] = .bool(true)
        let r = SessionWrites.commitAnswerSeen(store, args)
        return r["ok"] == .bool(true) ? JS.obj([("ok", .bool(true)), ("applied", .bool(true))]) : JS.obj([("ok", .bool(false)), ("error", r["error"] ?? JS.obj([("kind", .string("generic"))]))])
    }
}
