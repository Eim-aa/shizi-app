import Foundation

// src/session/result-api.js. Base contract, using the same Store and schedule rules.
public enum ResultAPI {
    static func invite(_ store: Store, _ a: JSObject) -> JSValue {
        let settings = store.state["settings"], next = a["action"] == .string("shown") ? FirstResult.inviteShownUpdate(settings: settings, sessionId: a["sessionId"] ?? .null) : try? FirstResult.inviteAnswerUpdate(settings: settings, answer: a["action"] ?? .null)
        guard let next else { return JS.obj([("ok", .bool(true)), ("skipped", .bool(true))]) }
        return store.commit(a["action"] == .string("shown") ? "invite:shown" : "invite:answer") { d,_ in d["settings"] = next }
    }
    static func call(_ op: String, _ store: Store, _ args: JSObject) throws -> JSValue {
        var a = args; a["slot"] = .string(args["slot"] == .string("B") ? "B" : "A")
        func view() throws -> JSValue { try ResultModels.baseView(store.state, a) }
        switch op {
        case "result":
            let r = SessionResults.finish(store, a); return JS.obj([("ok", .bool(true)), ("finished", .bool(r["ok"] == .bool(true))), ("view", try view())])
        case "resultCell":
            let m = try ResultModels.cell(store.state, a), r = SessionWrites.find(store.state, m["recordId"])
            return SessionWrites.patch(JS.obj([("ok", .bool(true))]), m.objectValue!.entries.map { ($0.key,$0.value) } + [("strokes", JS.truthy(m["inked"]) && r != nil ? try WriteModels.sheet(store, r!) : .array([]))])
        case "resultCorrect":
            if !["correct", "wrong"].contains(JS.string(a["to"])) { a["to"] = nil }
            let r = SessionResults.correct(store, a, mode: "result")
            return r["ok"] == .bool(true) ? JS.obj([("ok", .bool(true)), ("judgment", r["record"]?["judgment"] ?? .null), ("view", try view())]) : WriteAPI.plain(r)
        case "resultAdd":
            if a["on"]?.boolValue == nil { a["on"] = nil }; let r = SessionResults.added(store, a)
            return r["ok"] == .bool(true) ? JS.obj([("ok", .bool(true)), ("view", try view())]) : WriteAPI.plain(r)
        case "resultSealed":
            let r = SessionResults.sealed(store, a); return r["ok"] == .bool(true) ? JS.obj([("ok", .bool(true)), ("already", .bool(JS.truthy(r["already"])))]) : WriteAPI.plain(r)
        case "resultUndoSkip":
            let r = SessionResults.undoSkip(store, a); return r["ok"] == .bool(true) ? JS.obj([("ok", .bool(true))]) : WriteAPI.plain(r)
        case "resultAgain":
            let source = SessionResults.locate(store.state, a)?.session["source"] ?? JS.obj([("view", .string("home"))])
            let r = try ScheduleRules(dates: store.dates).startNextA(store, now: store.now(), deck: .real, source: source)
            return r["ok"] == .bool(true) ? JS.obj([("ok", .bool(true)), ("started", .bool(JS.truthy(r["started"]))), ("occupied", .bool(JS.truthy(r["occupied"]))), ("empty", .bool(JS.truthy(r["empty"])))]) : WriteAPI.plain(r)
        case "resultExit": return a["to"] == .string("leave") ? JS.obj([("ok", .bool(true))]) : SessionWrites.failure("invalid")
        case "resultInvite":
            if a["action"] == .string("shown") {
                let r = invite(store, a)
                if r["ok"] == .bool(false) { return WriteAPI.plain(r) }
                return JS.obj([("ok", .bool(true)), ("evening", FirstResult.inviteTime(store.now(), dates: store.dates)["evening"]!)])
            }
            if a["action"] == .string("no") { _ = invite(store, a); return JS.obj([("ok", .bool(true)), ("phase", .string("gone"))]) }
            return SessionWrites.failure("invalid")
        default: return SessionWrites.failure("unknown-op")
        }
    }
}
