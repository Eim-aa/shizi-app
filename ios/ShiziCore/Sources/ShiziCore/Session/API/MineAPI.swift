import Foundation

// src/session/api/mine.js, session/prefs-ops.js.
extension PageAPI {
    static func mine(_ op: String, _ store: Store, _ a: JSObject, hooks: SessionActionHooks? = nil) throws -> JSValue {
        if op == "mine.appearance" || op == "mine.groupSize" {
            let value = a["value"] ?? .null
            let valid = op == "mine.appearance" ? ["auto", "light", "dark"].contains(JS.string(value)) && value.stringValue != nil : GroupSize.isOption(value)
            if !valid { return SessionWrites.failure("invalid") }
            let r = SettingsView.commitSettings(store, label: op == "mine.appearance" ? "settings:appearance" : "settings:group-size", fields: JSObject([(op == "mine.appearance" ? "appearance" : "groupSize", value)]))
            return reply(r, skipped: true)
        }
        let width = a["width"]?.numberValue.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? 402
        let ax = SessionWrites.integer(a["ax"]) && JS.number(a["ax"]) > 0 ? min(5, JS.number(a["ax"])) : 0
        let candidate = a["today"]?.stringValue ?? "", today = candidate.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil ? candidate : try store.dates.localDay(.number(store.now()))
        var args = a; args["width"] = .number(width); args["ax"] = .number(ax); args["storagePressure"] = Budget.storagePressureOf(store.status["usage"]); let build = try hooks?.build?(); args["build"] = build?.objectValue != nil || build?.arrayValue != nil ? build! : JS.obj([("version", .string("")), ("build", .string(""))])
        let view = try MinePageView.mineView(.object(store.state), today: today, args, dates: store.dates)
        return JS.obj([("ok", .bool(true)), ("view", SessionWrites.patch(view, [("env", JS.obj([("width", .number(width)), ("ax", .number(ax))]))]))])
    }
}
