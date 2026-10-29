import Foundation

/// App API transport, separate from pure B4.5b model ops. Host actions are injected;
/// navigation and native image rendering remain outside ShiziCore.
public enum PageAPI {
    public static func call(_ op: String, store: Store, args: JSObject = JSObject()) -> JSValue {
        do {
        if op.hasPrefix("detail.") || op == "view.detail" || op == "view.detail-photo" { return try detail(op, store, args) }
        if op.hasPrefix("home.") || op == "view.home" { return try home(op, store, args) }
        if op.hasPrefix("library.") || op == "view.library" { return try library(op, store, args) }
        if ["view.library-list", "view.library-all", "view.library-switch", "library.list.start", "library.all.start", "library.switch"].contains(op) { return try librarySub(op, store, args) }
        if op.hasPrefix("mine.") || op == "view.mine" { return try mine(op, store, args) }
        if ["view.records", "view.month", "view.annual"].contains(op) { return try mineSub(op, store, args) }
        if op.hasPrefix("remind.") || op.hasPrefix("reminder.") || op == "view.remind" { return try settings(op, store, args) }
        if op.hasPrefix("backup.") || op == "view.backup" { return try backup(op, store, args) }
        if op.hasPrefix("block.") || op == "view.block" { return try block(op, store, args) }
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
