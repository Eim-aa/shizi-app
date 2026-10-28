import Foundation

// src/session/views/settings.js
public enum SettingsView {
    public static func parseTime(_ text: JSValue?) -> JSValue {
        guard let s = text?.stringValue?.trimmingCharacters(in: ViewSupport.whitespace) else { return .null }
        let p = s.split(separator: ":", omittingEmptySubsequences: false)
        guard p.count == 2, (1...2).contains(p[0].utf8.count), p[1].utf8.count == 2,
              p.allSatisfy({ $0.utf8.allSatisfy { $0 >= 48 && $0 <= 57 } }),
              let h = Int(p[0]), let m = Int(p[1]), h <= 23, m <= 59 else { return .null }
        return ViewSupport.obj([("hour", .number(Double(h))), ("minute", .number(Double(m)))])
    }
    public static func timeText(_ hour: JSValue?, _ minute: JSValue?) -> String {
        func pad(_ n: JSValue?) -> String { (JS.number(n) < 10 ? "0" : "") + JS.string(n) }
        return pad(hour) + ":" + pad(minute)
    }
    public static func defaultRemindTime(_ p: JSValue = Config.policy) -> JSValue {
        let r = parseTime(p["remindDefault"])
        return r.isNull ? ViewSupport.obj([("hour", .number(20)), ("minute", .number(0))]) : r
    }
    public static func settingsView(_ settings: JSValue?, policy p: JSValue = Config.policy) -> JSValue {
        let library = DeckIndex.shared.currentLibraryId(settings), r = settings?["remind"]
        let def = defaultRemindTime(p)
        let permission = ["granted", "denied", "unknown"].contains(r?["permission"]?.stringValue ?? "") ? r!["permission"]! : .string("unknown")
        let remind = ViewSupport.obj([("enabled", .bool(r?["enabled"] == .bool(true))), ("hour", JS.isInteger(r?["hour"]) ? r!["hour"]! : def["hour"]!), ("minute", JS.isInteger(r?["minute"]) ? r!["minute"]! : def["minute"]!), ("permission", permission)])
        let on = r?["enabled"] == .bool(true) && permission != .string("denied")
        let raw = settings?["appearance"]?.stringValue ?? "auto"
        let appearance = p["features"]?["appearanceSwitch"] != .bool(false) && ["auto", "light", "dark"].contains(raw) ? raw : "auto"
        var base = JSObject([("library", library), ("libraryName", LibrarySwitchView.libraryNameRef(library)), ("remind", remind), ("denied", .bool(permission == .string("denied"))), ("on", .bool(on)), ("appearance", .string(appearance))])
        base["groupSize"] = GroupSize.of(settings, policy: p)
        base["appearanceSwitch"] = .bool(p["features"]?["appearanceSwitch"] != .bool(false))
        base["remindPage"] = remindPageOf(.object(base))
        return .object(base)
    }
    static func remindPageOf(_ base: JSValue) -> JSValue {
        ViewSupport.obj([
            ("title", ViewSupport.ref("R-M03.remind")), ("label", ViewSupport.ref("X-SETTINGS.remindLabel")),
            ("sub", ViewSupport.obj([("on", ViewSupport.ref("R-S01.remindNote")), ("denied", ViewSupport.ref("R-S02.title"))])),
            ("timeLabel", ViewSupport.ref("X-SETTINGS.remindTime")),
            ("time", JS.truthy(base["on"]) ? .string(timeText(base["remind"]?["hour"], base["remind"]?["minute"])) : .null),
            ("note", ViewSupport.obj([("body", ViewSupport.ref("R-S02.body")), ("link", ViewSupport.ref("R-S02.link"))])),
            ("fail", ViewSupport.obj([("text", ViewSupport.ref("X-SETTINGS.saveFailed")), ("cancel", ViewSupport.ref("X-SETTINGS.cancel")), ("retry", ViewSupport.ref("X-SETTINGS.retry"))])),
        ])
    }
    public static func remindView(_ settings: JSValue?, policy: JSValue = Config.policy) -> JSValue { settingsView(settings, policy: policy) }
    static func merge(_ base: JSValue?, _ fields: JSObject) -> JSObject {
        var merged = base?.objectValue ?? JSObject()
        for (key, v) in fields.entries {
            if key == "remind" {
                var r = base?["remind"]?.objectValue ?? JSObject()
                for (k, x) in v.objectValue?.entries ?? [] { r[k] = x }
                merged[key] = .object(r)
            } else { merged[key] = v }
        }
        return merged
    }
    public static func commitSettings(_ store: Store, label: String, fields: JSObject) -> JSValue {
        let cur = store.state["settings"]
        let next = merge(cur, fields)
        if JSONWriter.stringify(.object(next)) == JSONWriter.stringify(cur ?? .object(JSObject())), JS.truthy(cur) {
            return ViewSupport.obj([("ok", .bool(true)), ("keys", .array([])), ("skipped", .bool(true))])
        }
        return store.commit(label) { draft, _ in draft["settings"] = .object(merge(draft["settings"], fields)) }
    }
    public static func commitRemindEnabled(_ store: Store, on: JSValue?, policy: JSValue = Config.policy) -> JSValue {
        let cur = store.state["settings"]?["remind"]
        var patch = JSObject([("enabled", .bool(JS.truthy(on)))])
        if JS.truthy(on) {
            let def = defaultRemindTime(policy)
            if !JS.isInteger(cur?["hour"]) { patch["hour"] = def["hour"] }
            if !JS.isInteger(cur?["minute"]) { patch["minute"] = def["minute"] }
        }
        return commitSettings(store, label: "settings:remind", fields: JSObject([("remind", .object(patch))]))
    }
    public static func commitRemindTime(_ store: Store, hour: JSValue, minute: JSValue) -> JSValue {
        commitSettings(store, label: "settings:remind-time", fields: JSObject([("remind", ViewSupport.obj([("hour", hour), ("minute", minute)]))]))
    }
    public static func remindOf(_ store: Store) -> JSValue { settingsView(store.state["settings"])["remind"]! }
    public static func applyReminderStatus(_ store: Store, payload: JSValue?) -> JSValue {
        let raw = payload?.objectValue != nil || payload?.arrayValue != nil ? payload?["permission"] : payload
        let permission = ["granted", "denied", "unknown"].contains(raw?.stringValue ?? "") ? raw! : .string("unknown")
        return commitSettings(store, label: "settings:remind-permission", fields: JSObject([("remind", ViewSupport.obj([("permission", permission)]))]))
    }
}
