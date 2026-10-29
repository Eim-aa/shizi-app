import Foundation

// src/session/api/mine-sub.js.
extension PageAPI {
    static func mineSub(_ op: String, _ store: Store, _ a: JSObject) throws -> JSValue {
        let today = try store.dates.localDay(.number(store.now())), state = JSValue.object(store.state)
        let view: JSValue
        if op == "view.records" {
            var args = JSObject(); for key in ["month", "day"] { if let v = a[key]?.stringValue, !v.isEmpty { args[key] = .string(v) } }
            view = try MineSubView.recordsView(state, today: today, args, dates: store.dates)
        } else if op == "view.month" {
            let candidate = a["month"]?.stringValue ?? "", month = candidate.range(of: #"^\d{4}-\d{2}$"#, options: .regularExpression) != nil ? candidate : String(today.prefix(7))
            view = try MineSubView.monthView(state, month: month, policy: Config.policy, dates: store.dates)
        } else {
            let year = SessionWrites.integer(a["year"]) ? a["year"] : try AnnualView.annualDefaultYear(state, today: today, dates: store.dates)
            view = try MineSubView.annualView(state, today: today, year: year, policy: Config.policy, dates: store.dates)
        }; return JS.obj([("ok", .bool(true)), ("view", view)])
    }
}
