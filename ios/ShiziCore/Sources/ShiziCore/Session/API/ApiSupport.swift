import Foundation

/// App API transport, separate from pure B4.5b model ops. Host actions are injected;
/// navigation and native image rendering remain outside ShiziCore.
public enum PageAPI {
    public static func callAsync(_ op: String, store: Store, args: JSObject = JSObject(), hooks: SessionActionHooks? = nil) async -> JSValue {
        if op == "view.detail", let provider = hooks?.charData, let char = args["char"]?.stringValue, !char.isEmpty { _ = await provider.load() }
        do {
            if ["query.pick", "query.detail", "s02.decide"].contains(op) { return try await queryAsync(op, store, args, hooks: hooks) }
            guard hooks?.hasAsync(op) == true else { return call(op, store: store, args: args, hooks: hooks) }
            return try await hooks?.invokeAsync(op, args) ?? SessionWrites.failure("unavailable")
        }
        catch let e as CoreError { return JS.obj([("ok", .bool(false)), ("error", JS.obj([("kind", .string("exception")), ("reason", .string(e.message))]))]) }
        catch { return SessionWrites.failure("exception") }
    }
    public static func call(_ op: String, store: Store, args: JSObject = JSObject(), hooks: SessionActionHooks? = nil) -> JSValue {
        guard (SessionResources.ui["apiOps"]?.arrayValue ?? []).contains(.string(op)) else {
            return JS.obj([("ok", .bool(false)), ("error", JS.obj([("kind", .string("unknown-op")), ("op", .string(op))]))])
        }
        let oldBreaker = ViewLineStarts.provider
        if let provider = hooks?.lineBreaker { ViewLineStarts.provider = provider }
        defer { ViewLineStarts.provider = oldBreaker }
        do {
        if op.hasPrefix("image.") { return try image(op, args, hooks: hooks) }
        if ["view.session-none", "session.pick", "session.libSwitch", "session.wrongList"].contains(op) { return try none(op, args, hooks: hooks) }
        if op == "detail.practice" {
            guard let char = args["char"]?.stringValue, !char.isEmpty else { return SessionWrites.failure("invalid") }
            guard let result = try hooks?.invoke(op, JSObject([("chars", .array([.string(char)])), ("source", JS.obj([("view", .string("detail")), ("char", .string(char))]))])) else { return SessionWrites.failure("unavailable") }
            return result["ok"] == .bool(false) ? reply(result, fallback: "failed") : JS.obj([("ok", .bool(true)), ("opened", result["opened"]?.stringValue.map(JSValue.string) ?? .null)])
        }
        if op == "detail.image" {
            guard let char = args["char"]?.stringValue, !char.isEmpty else { return SessionWrites.failure("invalid") }
            guard hooks?.has(op) == true else { return SessionWrites.failure("unavailable") }
            let model = try DetailView.detailModel(.object(store.state), char: char, today: store.dates.localDay(.number(store.now())), policy: Config.policy, hasInk: { DetailView.recordHasInk(.object(store.state), record: $0, dates: store.dates) }, dates: store.dates)
            _ = try hooks?.invoke(op, JSObject([("char", .string(char)), ("cardKey", model["cardKey"] ?? .null), ("record", model["imageRecord"] ?? model["latest"] ?? .null)]))
            return JS.obj([("ok", .bool(true))])
        }
        if ["home.start", "home.resumeOther", "home.deferSpecial", "home.switchLibrary", "home.pick", "home.source", "home.undoLeave", "home.undoLeaveCancel", "library.startToday", "library.openQuery", "library.undoLeave", "library.undoLeaveCancel", "library.list.start", "library.all.start", "library.switch", "detail.practice", "detail.image"].contains(op) {
            if op.hasPrefix("detail.") && (args["char"]?.stringValue ?? "").isEmpty { return SessionWrites.failure("invalid") }
            return try action(op, args, hooks: hooks, opened: op.hasPrefix("home.") || op.hasPrefix("library.") && !op.hasPrefix("library.list.") && !op.hasPrefix("library.all.") && op != "library.switch")
        }
        if op.hasPrefix("detail.") || op == "view.detail" || op == "view.detail-photo" { return try detail(op, store, args, hooks: hooks) }
        if op.hasPrefix("home.") || op == "view.home" { return try home(op, store, args, hooks: hooks) }
        if op.hasPrefix("library.") || op == "view.library" { return try library(op, store, args, hooks: hooks) }
        if ["view.library-list", "view.library-all", "view.library-switch", "library.list.start", "library.all.start", "library.switch"].contains(op) { return try librarySub(op, store, args, hooks: hooks) }
        if op.hasPrefix("mine.") || op == "view.mine" { return try mine(op, store, args) }
        if ["view.records", "view.month", "view.annual"].contains(op) { return try mineSub(op, store, args) }
        if op.hasPrefix("remind.") || op.hasPrefix("reminder.") || op == "view.remind" { return try settings(op, store, args) }
        if op.hasPrefix("backup.") || op == "view.backup" { return try backup(op, store, args) }
        if op.hasPrefix("block.") || op == "view.block" { return try block(op, store, args) }
        if op.hasPrefix("query.") || op == "s02.decide" || op == "view.query" || op == "view.s02" { return try query(op, store, args, hooks: hooks) }
        if op.hasPrefix("view.about") { return try about(op, args, hooks: hooks) }
        return JS.obj([("ok", .bool(false)), ("error", JS.obj([("kind", .string("unknown-op")), ("op", .string(op))]))])
        } catch let error as CoreError { return JS.obj([("ok", .bool(false)), ("error", JS.obj([("kind", .string("exception")), ("reason", .string(error.message))]))]) }
        catch { return JS.obj([("ok", .bool(false)), ("error", JS.obj([("kind", .string("exception")), ("reason", .string(String(describing: error)))]))]) }
    }
    static func reply(_ r: JSValue, fallback: String = "generic", skipped: Bool = false) -> JSValue {
        if r["ok"] == .bool(false) { return SessionWrites.failure(r["error"]?["kind"]?.stringValue ?? fallback) }
        return skipped ? JS.obj([("ok", .bool(true)), ("skipped", .bool(r["skipped"] == .bool(true)))]) : JS.obj([("ok", .bool(true))])
    }
    public static func domainsOf(_ info: JSValue?) -> [String] {
        if info?["type"] == .string("load") || info?["replace"] == .bool(true) { return Schema.domains }
        if info?["type"] != .string("commit") && info?["type"] != .string("recover") { return [] }
        var dirty = Set<String>()
        for key in info?["keys"]?.arrayValue ?? [] { if let spec = Schema.specForKey(JS.string(key)), let domain = spec.domain { dirty.insert(domain) } }
        if !(info?["recovered"]?.arrayValue ?? []).isEmpty { dirty.insert("records"); dirty.insert("ink") }
        return Schema.domains.filter { dirty.contains($0) }
    }
}
