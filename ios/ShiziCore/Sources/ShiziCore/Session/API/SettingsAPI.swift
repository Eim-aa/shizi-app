import Foundation

// src/session/api/settings.js. System permission UI and scheduling execution are host-owned.
extension PageAPI {
    static func reminderPlan(_ store: Store) throws -> JSValue {
        // api/settings.js supplies deckAdapter, which has no cardFor. Preserve the JS exception.
        if Reminder.remindOf(store.state["settings"])["enabled"] == .bool(true), (store.state["sched"]?.objectValue?.entries ?? []).contains(where: { k,v in JS.truthy(v) && v["stoppedAt"] == nil && store.dates.isValidDay(v["due"] ?? .null) && DeckIndex.shared.isPracticable(k) }) {
            throw CoreError.type("deck.cardFor is not a function")
        }
        var out = try Reminder.reminderPayload(.object(store.state), today: .string(store.dates.localDay(.number(store.now()))), now: .number(store.now()), dates: store.dates).objectValue!
        let candidates = try Reminder.reminderCandidates(.object(store.state), dates: store.dates)
        out["questions"] = .array((out["questions"]?.arrayValue ?? []).map { q in
            let item = candidates.first { .string($0.cardKey) == q["targetCardKey"] }!
            return JS.obj([("day", q["day"]!), ("title", ViewSupport.ref("X-REMIND.title", JS.obj([("word", .string(Reminder.maskedWord(item.card))), ("pinyin", .string(Query.jsTrim(JS.string(item.card["py"]))))]))), ("body", ViewSupport.ref("X-REMIND.body")), ("targetCardKey", q["targetCardKey"]!)])
        })
        return .object(out)
    }
    static func settings(_ op: String, _ store: Store, _ a: JSObject) throws -> JSValue {
        switch op {
        case "view.remind":
            let view = SettingsView.remindView(store.state["settings"]), sub = view["remindPage"]?["sub"]?[JS.truthy(view["denied"]) ? "denied" : "on"]
            return JS.obj([("ok", .bool(true)), ("view", view), ("lines", JS.obj([("sub", SessionTextLines.shared.ref("remind.sub", sub, extra: JS.obj([("title", try Copy.tRef(view["remindPage"]!["label"]!))])))]))])
        case "remind.enabled": return reply(SettingsView.commitRemindEnabled(store, on: .bool(a["on"] == .bool(true))))
        case "remind.time": return reply(SettingsView.commitRemindTime(store, hour: a["hour"] ?? .number(.nan), minute: a["minute"] ?? .number(.nan)))
        case "reminder.status": return reply(SettingsView.applyReminderStatus(store, payload: .object(a)))
        case "reminder.plan":
            return JS.obj([("ok", .bool(true)), ("plan", try reminderPlan(store))])
        default: return SessionWrites.failure("unknown-op")
        }
    }
}
