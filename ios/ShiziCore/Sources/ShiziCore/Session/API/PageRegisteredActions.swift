import Foundation

/// Store part of ui/screens/home, session and library action registrations.
/// The host owns navigation and paper source geometry; no router is recreated here.
public final class PageRegisteredActions {
    public let store: Store
    public var open: ((String, JSValue) throws -> Void)?
    public var paperSource: ((String, JSObject) throws -> Void)?
    public var clockNow: () -> Double = { ProcessInfo.processInfo.systemUptime * 1000 }
    public private(set) var leaveUndo: JSValue?
    public init(store: Store) { self.store = store }
    public func handoffLeaveUndo(_ value: JSValue?) { leaveUndo = JS.truthy(value) && !JS.truthy(value?["failed"]) ? SessionWrites.patch(value, [("anchor", .null)]) : nil }
    public func clearLeaveUndo() { leaveUndo = nil }
    public func leaveUndoView() -> JSValue {
        guard let u = leaveUndo else { return .null }
        var o = JSObject([("failed", .bool(JS.truthy(u["failed"]))), ("remainingMs", .number(max(0, JSMath.round(JS.number(u["until"])-clockNow()))))]);o["slot"] = u["slot"];o["char"] = u["char"];return .object(o)
    }
    public func install(on hooks: SessionActionHooks) {
        for op in ["home.start","home.resumeOther","home.deferSpecial","home.switchLibrary","home.pick","home.source","home.undoLeave","home.undoLeaveCancel","library.startToday","library.openQuery","library.undoLeave","library.undoLeaveCancel","library.list.start","library.all.start","library.switch"] { hooks.set(op) { [self] in try call(op,$0) } }
        for name in ["home.ui","library.ui"] { hooks.set(name) { [self] _ in JS.obj([("brand", .bool(false)), ("leaveUndo", leaveUndoView())]) } }
    }
    func opened(_ r: JSValue, _ slot: String) throws -> JSValue {
        if r["ok"] == .bool(false) { return r }
        if JS.truthy(r["session"]) { try open?("write", JS.obj([("slot", .string(slot))])); return SessionWrites.patch(r, [("opened", .string("resume"))]) }
        return SessionWrites.patch(r, [("opened", .null)])
    }
    func startA(source: JSValue) throws -> JSValue {
        let rules = ScheduleRules(dates: store.dates)
        let s = try rules.resumableSession(.object(store.state), slot:"A", now:store.now())
        if JS.truthy(s) { try open?("write", JS.obj([("slot", .string("A"))]));return JS.obj([("ok", .bool(true)), ("opened", .string("resume")), ("session", s)]) }
        let r = try rules.startNextA(store, now:store.now(), deck:.real, source:source)
        if r["ok"] != .bool(true) { return r }
        if JS.truthy(r["started"]) || JS.truthy(r["occupied"]) { try open?("write", JS.obj([("slot", .string("A"))]));return SessionWrites.patch(r, [("opened", .string(JS.truthy(r["started"]) ? "new" : "resume"))]) }
        if JS.truthy(r["empty"]) { try open?("session-none", JS.obj([("exhausted", r["libraryExhausted"] ?? .bool(false))]));return SessionWrites.patch(r, [("opened", .string("none"))]) }
        return SessionWrites.patch(r, [("opened", .null)])
    }
    func picked(_ keys: [JSValue], source: JSValue) throws -> JSValue {
        let r: JSValue
        do { r = try ScheduleRules(dates:store.dates).startPicked(store,keys:keys,source:source,deck:.real) } catch { return SessionWrites.failure("invalid") }
        if r["ok"] != .bool(true) { return r }
        try open?(JS.truthy(r["started"]) ? "write" : "s02", JS.truthy(r["started"]) ? JS.obj([("slot", .string("B"))]) : r["s02"] ?? .null)
        return SessionWrites.patch(r, [("opened", .string(JS.truthy(r["started"]) ? "new" : "s02"))])
    }
    public func call(_ op: String, _ a: JSObject) throws -> JSValue {
        let rules = ScheduleRules(dates:store.dates), home = JS.obj([("view", .string("home"))])
        if op.hasSuffix("undoLeaveCancel") { clearLeaveUndo();return JS.obj([("ok", .bool(true))]) }
        if op.hasSuffix("undoLeave") {
            guard let u = leaveUndo else { return SessionWrites.failure("stale") }
            let r = SessionWrites.commitUndoSkip(store,u.objectValue ?? JSObject())
            if r["ok"] == .bool(true) { clearLeaveUndo();try open?("write",JS.obj([("slot",u["slot"] ?? .null)])) }
            else if r["error"]?["kind"] == .string("stale") { clearLeaveUndo() }
            else { leaveUndo = SessionWrites.patch(u,[("failed",.bool(true))]) }
            return r
        }
        switch op {
        case "library.switch":
            return store.commit("library:switch") { d,_ in var settings = d["settings"]?.objectValue ?? JSObject();settings["library"] = a["id"];d["settings"] = .object(settings) }
        case "library.list.start":return try picked(a["keys"]?.arrayValue ?? [],source:JS.obj([("view",a["view"] ?? .null)]))
        case "library.all.start":
            if a["kind"] == .string("list") {
                let m = try LibraryListView.listModel(.object(store.state),JSObject([("kind",a["listKind"] ?? .null),("today",.string(try store.dates.localDay(.number(store.now()))))]),dates:store.dates)
                let keys = m["selectedKeys"]?.arrayValue ?? []; if keys.isEmpty { return SessionWrites.failure("invalid") }
                return try picked(keys,source:JS.obj([("view",m["view"] ?? .null)]))
            }
            return try picked(a["keys"]?.arrayValue ?? [],source:JS.obj([("view",.string("allWritten"))]))
        case "home.start":
            if JS.truthy(try rules.resumableSession(.object(store.state),slot:"B",now:store.now())) {
                let r = try opened(rules.resumeSlot(store,slot:"B",now:store.now()),"B")
                if r["ok"] == .bool(false) || JS.truthy(r["opened"]) { return r }
            }
            return try startA(source:home)
        case "home.resumeOther","library.startToday":
            let r = try opened(rules.resumeSlot(store,slot:"A",now:store.now()),"A")
            return r["ok"] == .bool(true) && !JS.truthy(r["opened"]) ? try startA(source:op.hasPrefix("library") ? JS.obj([("view",.string("library"))]) : home) : r
        case "home.deferSpecial":
            let r = try rules.deferSpecial(store,now:store.now());return r["ok"] == .bool(true) ? try startA(source:home) : r
        case "home.source":try paperSource?("source",a)
        case "home.switchLibrary":try open?("library-switch",.object(JSObject()))
        case "home.pick","library.openQuery":try open?("query",JS.obj([("mode",.string(op.hasPrefix("home") ? "pick" : "lookup"))]))
        default:return SessionWrites.failure("unavailable")
        }
        return JS.obj([("ok",.bool(true))])
    }
}
