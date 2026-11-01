import Foundation

// src/session/api/block.js.
extension PageAPI {
    static func block(_ op: String, _ store: Store, _ a: JSObject, hooks: SessionActionHooks? = nil) throws -> JSValue {
        let reason = BlockView.blockReasonOf(.object(store.status), migration: a["migration"])
        let exportable = reason["kind"] == .string("blocked") && store.available && BlockView.hasJudged(.object(store.state))
        switch op {
        case "view.block":
            var args = a; args["kind"] = a["kind"]?.stringValue.flatMap { $0.isEmpty ? nil : .string($0) } ?? reason["kind"] ?? .string("unavailable"); args["canExport"] = a["canExport"].map { .bool(JS.truthy($0)) } ?? .bool(exportable)
            return JS.obj([("ok", .bool(true)), ("view", try BlockView.blockView(args))])
        case "block.exportable": return JS.obj([("ok", .bool(true)), ("exportable", .bool(exportable))])
        case "block.export": return SessionWrites.patch(JS.obj([("ok", .bool(true))]), try BlockView.blockBackup(store.state, serial: store.serial, now: hooks?.now?() ?? store.now(), dates: store.dates).objectValue!.entries.map { ($0.key,$0.value) })
        case "block.retry":
            let kind = a["kind"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? reason["kind"]?.stringValue ?? "unavailable"
            if kind != "unavailable" { return JS.obj([("ok", .bool(true)), ("reload", .bool(true))]) }
            _ = store.load(); return JS.obj([("ok", .bool(true)), ("still", .bool(!store.available))])
        default: return SessionWrites.failure("unknown-op")
        }
    }
}
