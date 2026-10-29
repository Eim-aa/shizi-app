import Foundation

/// Transactional port of src/session/ops/{answer,judge,skip,strokes,line,end}.js.
/// All writes use the B4.4 Store; rules and ink encoders remain shared with B4.2/B4.3.
public enum SessionWrites {
    static let clean = JS.obj([("ok", .bool(true)), ("keys", .array([])), ("noop", .bool(true))])
    static func failure(_ kind: String) -> JSValue { JS.obj([("ok", .bool(false)), ("error", JS.obj([("kind", .string(kind))]))]) }
    static func session(_ state: JSObject, _ slot: String) -> JSValue? { state["sessions"]?[slot].flatMap { $0.isNull ? nil : $0 } }
    static func set(_ draft: inout JSObject, _ slot: String, _ session: JSValue) {
        var sessions = draft["sessions"]?.objectValue ?? JSObject(); sessions[slot] = session; draft["sessions"] = .object(sessions)
    }
    static func patch(_ base: JSValue?, _ pairs: [(String, JSValue)]) -> JSValue {
        var out = base?.objectValue ?? JSObject(); for (k,v) in pairs { out[k] = v }; return .object(out)
    }
    static func allRecords(_ state: JSObject) -> [JSValue] { Query.flattenRecords(state["records"]) }
    static func find(_ state: JSObject, _ id: JSValue?) -> JSValue? { allRecords(state).first { $0["id"] == id } }
    static func seen(_ state: JSObject, _ session: JSValue, _ key: JSValue?) -> JSValue? {
        allRecords(state).last { $0["kind"] == .string("answer-seen") && $0["sessionId"] == session["id"] && $0["cardKey"] == key }
    }
    static func append(_ draft: inout JSObject, _ record: JSValue) throws {
        guard let day = record["localDay"]?.stringValue else { throw CoreError.error("appendRecord: record has no localDay") }
        let month = String(day.prefix(7)); var months = draft["records"]?.objectValue ?? JSObject()
        let value = months[month]
        if value == nil || value == .null { months[month] = .array([record]) }
        else if let list = value?.arrayValue { months[month] = .array(list + [record]) }
        else if let list = value?["kept"]?.arrayValue { months[month] = patch(value, [("kept", .array(list + [record]))]) }
        else { throw CoreError.error("appendRecord: unexpected records month shape") }
        draft["records"] = .object(months)
    }
    static func replace(_ draft: inout JSObject, _ record: JSValue, remove: Bool = false) throws {
        let month = String((record["localDay"]?.stringValue ?? "").prefix(7)); var months = draft["records"]?.objectValue ?? JSObject()
        let v = months[month]
        func swap(_ list: [JSValue]) -> [JSValue] { remove ? list.filter { $0["id"] != record["id"] } : list.map { $0["id"] == record["id"] ? record : $0 } }
        if let list = v?.arrayValue { months[month] = .array(swap(list)) }
        else if let list = v?["kept"]?.arrayValue { months[month] = patch(v, [("kept", .array(swap(list)))]) }
        else { throw CoreError.error(remove ? "undo skip: record month not found" : "replaceRecord: month not found") }
        draft["records"] = .object(months)
    }
    static func current(_ store: Store, _ a: JSObject) -> JSValue? {
        let s = session(store.state, JS.string(a["slot"])); return s != nil && SessionRules.currentCardKey(s) == a["cardKey"] ? s : nil
    }
    static func integer(_ v: JSValue?) -> Bool { guard case .number(let n)? = v else { return false }; return n.isFinite && n.rounded(.towardZero) == n }
    static func count(_ v: JSValue?) -> Double { max(0, JS.numberOr0(v).rounded(.towardZero)) }
    static func hints(_ session: JSValue, _ value: JSValue?) -> Double { max(integer(session["current"]?["hints"]) ? JS.number(session["current"]?["hints"]) : 0, JS.numberOr0(value)) }
    static func raw(_ a: JSObject) -> [[InkPoint]] { (a["strokes"]?.arrayValue ?? []).map { ($0.arrayValue ?? []).compactMap(InkPoint.init(js:)) } }
    static func rows(_ strokes: [[InkPoint]]) -> JSValue { .array(InkMath.encodeRawStrokes(strokes).map { .array($0.map(JSValue.number)) }) }
    static func inkKey(_ key: String, _ phase: JSValue?) -> String { phase == .string("trace") || phase == .string("retrace") ? key + "|" + JS.string(phase) : key }

    public static func commitStrokes(_ store: Store, _ a: JSObject) -> JSValue {
        guard let s = current(store, a) else { return failure("stale") }
        let key = JS.string(a["cardKey"]), phase = s["current"]?["phase"]
        guard s["current"] != nil, inkKey(key, phase) == JS.string(a["inkKey"]) else { return clean }
        let r = rows(raw(a)); var p = JSObject()
        if JSONWriter.stringify(r) != JSONWriter.stringify(s["current"]?["strokes"] ?? .array([])) { p["strokes"] = r }
        if let next = a["phase"], next != phase, ["recall", "compare"].contains(JS.string(next)), ["recall", "compare"].contains(JS.string(phase)), next == .string("recall") || !(r.arrayValue ?? []).isEmpty { p["phase"] = next }
        if p.count == 0 { return clean }
        return store.commit("write:strokes") { d,c in set(&d, JS.string(a["slot"]), try SessionRules.withCurrent(s, .object(p), at: .number(c.now))) }
    }
    public static func commitRecover(_ store: Store, _ a: JSObject) throws -> JSValue {
        let slot = JS.string(a["slot"])
        guard let s = session(store.state, slot), try SessionRules.recoverSession(s, allRecords(store.state)).recovered else { return clean }
        return store.commit("write:recover") { d,_ in
            let r = try SessionRules.recoverSession(session(d, slot), allRecords(d)); if r.recovered, let s = r.session { set(&d, slot, s) }
        }
    }
    public static func commitComparePhase(_ store: Store, _ a: JSObject) throws -> JSValue {
        let phase = a["phase"] ?? .null
        guard phase == .string("compare") || phase == .string("recall") else { throw CoreError.range("commitComparePhase: compare or recall only") }
        guard let s = current(store, a) else { return failure("stale") }
        return store.commit(phase == .string("compare") ? "write:compare" : "write:continue") { d,c in
            var p = JSObject([("phase", phase)]); if phase == .string("compare"), a["strokes"]?.arrayValue != nil { p["strokes"] = rows(raw(a)) }
            set(&d, JS.string(a["slot"]), try SessionRules.withCurrent(s, .object(p), at: .number(c.now)))
        }
    }
    public static func commitAnswerSeen(_ store: Store, _ a: JSObject) -> JSValue {
        guard let s = current(store, a) else { return failure("stale") }
        return store.commit("write:answer-seen") { d,c in
            let stay = JS.truthy(a["stay"]), key = a["cardKey"]!, n = hints(s, integer(a["hints"]) ? a["hints"] : .number(0))
            if let r = seen(d, s, key) {
                if !stay && !JS.truthy(r["help"]?["traced"]) { try replace(&d, patch(r, [("help", patch(r["help"], [("traced", .bool(true))]))])) }
            } else {
                let r = try Records.makeRecord(JSObject([("id", .string(try c.nextId("r"))), ("cardKey", key), ("sessionId", s["id"]!), ("kind", .string("answer-seen")), ("at", .number(c.now)), ("help", JS.obj([("hints", .number(n)), ("answerSeen", .bool(true)), ("traced", .bool(!stay))]))]), dates: store.dates)
                try append(&d, r)
                let seen = try ScheduleRules(dates: store.dates).applyAnswerSeen(d["sched"]?[JS.string(key)], r)
                if seen.applied, let entry = seen.entry { d["sched"] = patch(d["sched"], [(JS.string(key), entry)]) }
            }
            let p = stay ? JS.obj([("answerSeen", .bool(true)), ("hints", .number(n)), ("hintRange", a["hintRange"] ?? .null)]) : JS.obj([("phase", .string("trace")), ("strokes", .array([])), ("answerSeen", .bool(true)), ("hintRange", .null)])
            set(&d, JS.string(a["slot"]), SessionRules.clearLine(try SessionRules.withCurrent(s, p, at: .number(c.now))))
        }
    }
    public static func commitAnswerPhase(_ store: Store, _ a: JSObject) throws -> JSValue {
        let phase = JS.string(a["phase"])
        guard ["answer", "trace", "retrace"].contains(phase) else { throw CoreError.range("commitAnswerPhase: not an answer-flow phase") }
        guard let s = current(store, a) else { return failure("stale") }
        return store.commit("write:answer-" + phase) { d,c in
            if phase == "trace", let r = seen(d, s, a["cardKey"]), !JS.truthy(r["help"]?["traced"]) { try replace(&d, patch(r, [("help", patch(r["help"], [("traced", .bool(true))]))])) }
            var p = JSObject([("phase", .string(phase))]); if phase != "answer" { p["strokes"] = .array([]) }; p["hintRange"] = .null
            set(&d, JS.string(a["slot"]), try SessionRules.withCurrent(s, .object(p), at: .number(c.now)))
        }
    }
    public static func commitAnswerNext(_ store: Store, _ a: JSObject) -> JSValue {
        guard let s = current(store, a) else { return failure("stale") }
        return store.commit("write:answer-next") { d,c in
            set(&d, JS.string(a["slot"]), try SessionRules.advance(s, cardKey: a["cardKey"], recordId: seen(d, s, a["cardKey"])?["id"], kind: .string("answer-seen"), fsrsBefore: nil, at: .number(c.now)))
        }
    }
    public static func commitJudgment(_ store: Store, _ a: JSObject) -> JSValue {
        let strokes = raw(a); if !strokes.contains(where: { !$0.isEmpty }) { return failure("empty-strokes") }
        guard let s = current(store, a) else { return failure("stale") }
        var record: JSValue?, reused = false
        let result = store.commit("write:judge") { d,c in
            guard Records.judgments.contains(JS.string(a["judgment"])) else { throw CoreError.range("judge: judgment must be correct or wrong") }
            let key = a["cardKey"]!, k = JS.string(key)
            if let r = allRecords(d).last(where: { Records.isJudged($0) && $0["sessionId"] == s["id"] && $0["cardKey"] == key }) {
                record = r; reused = true; set(&d, JS.string(a["slot"]), try SessionRules.advance(s, cardKey: key, recordId: r["id"], kind: .string("judged"), fsrsBefore: nil, at: .number(c.now))); return
            }
            let policy = ViewSupport.policy(a["policy"])
            let r = try Records.makeRecord(JSObject([("id", .string(try c.nextId("r"))), ("cardKey", key), ("sessionId", s["id"]!), ("kind", .string("judged")), ("judgment", a["judgment"]!), ("at", .number(c.now)), ("help", JS.obj([("hints", .number(min(Schema.hintsShapeMax, max(0, hints(s, a["hints"]).rounded(.towardZero))))), ("answerSeen", .bool(false)), ("traced", .bool(false))]))]), dates: store.dates)
            record = r; try append(&d, r)
            if a["perRecordInk"]?.boolValue ?? (policy["features"]?["perRecordInk"] == .bool(true)) { _ = try Store.setInk(&d, r, InkMath.encodeStoredInk(strokes, policy: policy.objectValue, format: c.inkFormat), timeZone: store.dates.timeZone) }
            _ = Budget.pruneInkOfCards(&d, [k], dates: store.dates)
            let next = try ScheduleRules(dates: store.dates).applyJudgment(d["sched"]?[k], r, policy: policy, records: allRecords(d))
            d["sched"] = patch(d["sched"], [(k, next.entry)])
            set(&d, JS.string(a["slot"]), try SessionRules.advance(s, cardKey: key, recordId: r["id"], kind: .string("judged"), fsrsBefore: next.fsrsBefore, at: .number(c.now)))
        }
        return result["ok"] == .bool(true) && record != nil ? patch(result, [("record", record!), ("reused", .bool(reused))]) : result
    }
    public static func commitSkip(_ store: Store, _ a: JSObject) -> JSValue {
        guard let s = current(store, a) else { return failure("stale") }; var record: JSValue?
        let result = store.commit("write:skip") { d,c in
            let policy = ViewSupport.policy(a["policy"]), scope = JS.string(policy["skipScope"])
            guard ["session", "today"].contains(scope) else { throw CoreError.range("unsupported policy.skipScope: " + scope) }
            let r = try Records.makeRecord(JSObject([("id", .string(try c.nextId("r"))), ("cardKey", a["cardKey"]!), ("sessionId", s["id"]!), ("kind", .string("skipped")), ("at", .number(c.now)), ("help", JS.obj([("hints", .number(min(Schema.hintsShapeMax, max(0, hints(s, .number(JS.numberOr0(a["hints"]).rounded(.towardZero))))))), ("answerSeen", .bool(false)), ("traced", .bool(false))]))]), dates: store.dates)
            record = r; try append(&d, r); set(&d, JS.string(a["slot"]), try SessionRules.advance(s, cardKey: a["cardKey"], recordId: r["id"], kind: .string("skipped"), fsrsBefore: nil, at: .number(c.now)))
        }
        return result["ok"] == .bool(true) && record != nil ? patch(result, [("record", record!)]) : result
    }
    static func canUndo(_ s: JSValue?, _ a: JSObject) -> Bool { s != nil && s?["id"] == a["sessionId"] && s?["items"]?.arrayValue?.last?["kind"] == .string("skipped") && s?["items"]?.arrayValue?.last?["recordId"] == a["recordId"] }
    static func undo(_ d: inout JSObject, _ a: JSObject, at: Double) throws {
        let slot = JS.string(a["slot"])
        guard let s = session(d, slot), let record = find(d, a["recordId"]), record["kind"] == .string("skipped"), record["sessionId"] == s["id"] else { throw CoreError.error("undo skip: skipped record not found") }
        let back = try SessionRules.undoSkip(s, a["recordId"], at: .number(at)); try replace(&d, record, remove: true)
        var p = JSObject(); if integer(record["help"]?["hints"]), JS.truthy(record["help"]?["hints"]) { p["hints"] = record["help"]?["hints"] }
        if let rows = a["strokes"]?.arrayValue, !rows.isEmpty { p["strokes"] = .array(rows) }
        set(&d, slot, p.count > 0 ? try SessionRules.withCurrent(back, .object(p), at: .number(at)) : back)
    }
    public static func commitUndoSkip(_ store: Store, _ a: JSObject) -> JSValue {
        guard canUndo(session(store.state, JS.string(a["slot"])), a) else { return failure("stale") }
        return store.commit("write:skip-undo") { d,c in try undo(&d, a, at: c.now) }
    }
    static func canEnd(_ s: JSValue?) -> Bool { s != nil && ["picked", "daily"].contains(JS.string(s?["kind"])) && !SessionRules.isComplete(s) }
    static func judgedCount(_ state: JSObject, _ id: JSValue?) -> Int { Set(allRecords(state).filter { Records.isJudged($0) && $0["sessionId"] == id }.map { JS.string($0["cardKey"]) }).count }
    public static func commitEndGroup(_ store: Store, _ a: JSObject) -> JSValue {
        let slot = JS.string(a["slot"])
        guard let s = session(store.state, slot), s["id"] == a["sessionId"], ["daily", "picked"].contains(JS.string(s["kind"])) else { return failure("stale") }
        var ended: JSValue?, count = 0
        let result = store.commit("write:end") { d,c in
            d["sessions"] = try SessionRules.endSlot(d["sessions"] ?? SessionRules.emptySessions(), slot, at: .number(c.now), early: !SessionRules.isComplete(s))
            ended = d["sessions"]?["lastEnded"]?[slot]; count = judgedCount(d, a["sessionId"])
        }
        return result["ok"] == .bool(true) ? patch(result, [("ended", ended ?? .null), ("judgedCount", .number(Double(count)))]) : result
    }
    public static func commitFlag(_ store: Store, key: String, label: String) -> JSValue {
        if store.state["settings"]?[key] == .bool(true) { return JS.obj([("ok", .bool(true)), ("keys", .array([])), ("skipped", .bool(true))]) }
        return store.commit(label) { d,_ in d["settings"] = patch(d["settings"], [(key, .bool(true))]) }
    }
}
