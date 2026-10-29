import Foundation

// src/session/api/detail.js and src/session/ops/detail.js.
extension PageAPI {
    static func detail(_ op: String, _ store: Store, _ a: JSObject, hooks: SessionActionHooks? = nil) throws -> JSValue {
        let char = a["char"]?.stringValue ?? ""
        if op != "detail.correct" && op != "detail.restoreCustom" && char.isEmpty { return SessionWrites.failure("invalid") }
        let key = "base:" + char
        switch op {
        case "detail.wordOff", "detail.wordOn":
            let r = store.commit(op == "detail.wordOff" ? "detail:word-off" : "detail:word-off-undo") { d,c in
                var off = d["wordOff"]?.objectValue ?? JSObject()
                if op == "detail.wordOff" { if off[key] == nil { off[key] = .number(c.now); d["wordOff"] = .object(off) } }
                else if off[key] != nil { off[key] = nil; d["wordOff"] = .object(off) }
            }; return reply(r, fallback: "failed")
        case "detail.addCustom": return reply(QueryView.commitAdd(store, char: .string(char)), fallback: "failed")
        case "detail.removeCustom":
            var removed = JSValue.null
            let r = store.commit("detail:custom-remove") { d,_ in
                var custom = d["custom"]?.objectValue ?? JSObject(); let added = custom["added"]?.arrayValue ?? []
                if let i = added.firstIndex(where: { $0["char"] == .string(char) }) {
                    removed = JS.obj([("entry", added[i]), ("index", .number(Double(i)))])
                    custom["added"] = .array(added.enumerated().filter { $0.offset != i }.map(\.element)); d["custom"] = .object(custom)
                }
            }; return r["ok"] == .bool(true) ? JS.obj([("ok", .bool(true)), ("removed", removed)]) : reply(r, fallback: "failed")
        case "detail.restoreCustom":
            guard let removed = a["removed"], removed.objectValue != nil || removed.arrayValue != nil else { return SessionWrites.failure("invalid") }
            return reply(store.commit("detail:custom-restore") { d,_ in
                guard let entry = removed["entry"], JS.truthy(entry) else { return }
                var custom = d["custom"]?.objectValue ?? JSObject(); var added = custom["added"]?.arrayValue ?? []
                if added.contains(where: { $0["char"] == entry["char"] }) { return }
                let i = SessionWrites.integer(removed["index"]) ? max(0, min(JS.number(removed["index"]), Double(added.count))) : Double(added.count)
                added.insert(entry, at: Int(i)); custom["added"] = .array(added); d["custom"] = .object(custom)
            }, fallback: "failed")
        case "detail.correct":
            guard let id = a["recordId"]?.stringValue, !id.isEmpty else { return SessionWrites.failure("invalid") }
            var args = a; if !["correct", "wrong"].contains(JS.string(a["to"])) { args["to"] = nil }
            return reply(SessionResults.correct(store, args, mode: "detail"), fallback: "failed")
        case "view.detail-photo": return JS.obj([("ok", .bool(true)), ("view", try DetailView.photoView(.object(store.state), char: char))])
        case "view.detail":
            return JS.obj([("ok", .bool(true)), ("view", try DetailView.detailView(.object(store.state), char: char, today: store.dates.localDay(.number(store.now())), etymology: hooks?.charData?.etymologyOf(char), imageAction: hooks?.has("detail.image") == true, dates: store.dates))])
        default: return SessionWrites.failure("unavailable")
        }
    }
}
