import Foundation

// Line / result / work / detail ops. Shared correction, distinct guards/labels.
public enum SessionResults {
    static func locate(_ state: JSObject, _ a: JSObject) -> (session: JSValue, slot: String, ended: Bool)? {
        let slots = JS.truthy(a["slot"]) ? [JS.string(a["slot"])] : ["A", "B"]
        for ended in [true, false] { for slot in slots {
            let s = ended ? state["sessions"]?["lastEnded"]?[slot] : state["sessions"]?[slot]
            if let s, !s.isNull, s["id"] == a["sessionId"] { return (s, slot, ended) }
        }}; return nil
    }
    static func save(_ d: inout JSObject, _ found: (session: JSValue, slot: String, ended: Bool), _ next: JSValue) {
        if found.ended { d["sessions"] = SessionWrites.patch(d["sessions"], [("lastEnded", SessionWrites.patch(d["sessions"]?["lastEnded"], [(found.slot, next)]))]) }
        else { SessionWrites.set(&d, found.slot, next) }
    }
    public static func finish(_ store: Store, _ a: JSObject) -> JSValue {
        guard let found = locate(store.state, a) else { return SessionWrites.failure("stale") }
        if found.ended { return JS.obj([("ok", .bool(true)), ("noop", .bool(true)), ("keys", .array([]))]) }
        guard SessionRules.isComplete(found.session) else { return SessionWrites.failure("stale") }
        return store.commit("result:finish") { d,c in d["sessions"] = try SessionRules.endSlot(d["sessions"] ?? SessionRules.emptySessions(), found.slot, at: .number(c.now)) }
    }
    public static func leave(_ store: Store, _ a: JSObject) -> JSValue {
        guard let found = locate(store.state, a), found.ended else { return JS.obj([("ok", .bool(true)), ("noop", .bool(true)), ("keys", .array([]))]) }
        return store.commit("result:leave") { d,_ in d["sessions"] = SessionRules.clearLastEnded(d["sessions"] ?? SessionRules.emptySessions(), found.slot) }
    }
    public static func added(_ store: Store, _ a: JSObject) -> JSValue {
        guard let found = locate(store.state, a) else { return SessionWrites.failure("stale") }
        return store.commit("result:added") { d,_ in
            guard (found.session["items"]?.arrayValue ?? []).contains(where: { $0["recordId"] == a["recordId"] }) else { throw CoreError.error("added: record is not in this session") }
            let list = ImageSelection.toggleAdded(found.session, recordId: JS.string(a["recordId"]), on: a["on"]?.boolValue)
            save(&d, found, SessionWrites.patch(found.session, [("added", .array(list.map(JSValue.string)))]))
        }
    }
    public static func sealed(_ store: Store, _ a: JSObject) -> JSValue {
        guard let found = locate(store.state, a) else { return SessionWrites.failure("stale") }
        if let n = found.session["sealedAt"]?.numberValue, n.isFinite { return JS.obj([("ok", .bool(true)), ("keys", .array([])), ("recovered", .array([])), ("already", .bool(true))]) }
        return store.commit("result:sealed") { d,c in save(&d, found, SessionWrites.patch(found.session, [("sealedAt", .number(c.now))])) }
    }
    public static func undoSkip(_ store: Store, _ a: JSObject) -> JSValue {
        guard let found = locate(store.state, a), SessionWrites.canUndo(found.session, a), !found.ended || !JS.truthy(store.state["sessions"]?[found.slot]) else { return SessionWrites.failure("stale") }
        return store.commit("result:skip-undo") { d,c in
            if found.ended {
                var s = found.session.objectValue!; s["endedAt"] = nil; s["endedEarly"] = nil
                d["sessions"] = SessionRules.clearLastEnded(d["sessions"] ?? SessionRules.emptySessions(), found.slot)
                SessionWrites.set(&d, found.slot, .object(s))
            }
            try SessionWrites.undo(&d, a, at: c.now, dates: store.dates)
        }
    }
    static func correctableHere(_ record: JSValue?) -> Bool { record != nil && Records.isJudged(record) && !JS.truthy(record?["legacy"]) && !Records.isPaperRecord(record) }
    public static func correct(_ store: Store, _ a: JSObject, mode: String) -> JSValue {
        let id = a["recordId"], slot = JS.string(a["slot"]), record = SessionWrites.find(store.state, id)
        let found = mode == "result" ? locate(store.state, a)?.session : SessionWrites.session(store.state, slot)
        if mode == "detail" {
            guard correctableHere(record) else { return SessionWrites.failure("stale") }
        } else {
            guard let found, SessionRules.canCorrect(found, id), mode != "write" || found["lastLine"]?["recordId"] == id else { return SessionWrites.failure("stale") }
        }
        var next: JSValue?
        let result = store.commit(mode + ":correct") { d,c in
            let all = SessionWrites.allRecords(d)
            guard let r = all.first(where: { $0["id"] == id }), Records.isJudged(r), mode != "result" || r["sessionId"] == a["sessionId"] else { throw CoreError.error("correct: judged record not found") }
            let target = a["to"] ?? .string(r["judgment"] == .string("correct") ? "wrong" : "correct")
            let n = try Records.correctRecord(r, target, at: .number(c.now)); next = n
            if Store.same(n, r) { return }
            try SessionWrites.replace(&d, n)
            let key = JS.string(r["cardKey"]), rules = ScheduleRules(dates: store.dates), policy = ViewSupport.policy(a["policy"])
            let later = all.filter { mode == "detail" ? $0["cardKey"] == r["cardKey"] : Records.isJudged($0) && $0["cardKey"] == r["cardKey"] && Records.compareRecordIds($0["id"], id) >= 0 }.map { $0["id"] == id ? n : $0 }
            let entry: JSValue?
            if mode == "detail" { entry = try rules.schedAfterCorrection(records: later, recordId: id, fsrsBefore: ScheduleRules.findFsrsBefore(d["sessions"], id), policy: policy, stoppedAt: d["sched"]?[key]?["stoppedAt"]) }
            else { entry = try rules.replay(SessionRules.fsrsBeforeOf(found, id), Records.sortById(later), policy: policy, stoppedAt: d["sched"]?[key]?["stoppedAt"]) }
            if let entry { d["sched"] = SessionWrites.patch(d["sched"], [(key, entry)]) }
            if mode == "write", let found { SessionWrites.set(&d, slot, TodayPlan.afterCorrection(SessionRules.markLineChanged(found, id), key: r["cardKey"] ?? .null, to: n["judgment"], policy: policy)) } // D83 改判后重考跟着变
        }
        return result["ok"] == .bool(true) && next != nil ? SessionWrites.patch(result, [("record", next!)]) : result
    }
}
