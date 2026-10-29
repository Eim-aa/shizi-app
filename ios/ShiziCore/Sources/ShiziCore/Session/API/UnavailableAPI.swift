import Foundation

extension PageAPI {
    /// Block screen must work while the engine has no readable Store.
    public static func withoutStore(_ op: String, args: JSObject = JSObject()) -> JSValue {
        switch op {
        case "view.block":
            var a = args;a["kind"] = args["kind"]?.stringValue.flatMap { $0.isEmpty ? nil : .string($0) } ?? .string("unavailable");a["canExport"] = .bool(JS.truthy(args["canExport"]))
            return JS.obj([("ok",.bool(true)),("view",(try? BlockView.blockView(a)) ?? .null)])
        case "block.retry":return JS.obj([("ok",.bool(true)),((args["kind"]?.stringValue ?? "unavailable") == "unavailable" ? "still" : "reload",.bool(true))])
        case "block.exportable":return JS.obj([("ok",.bool(true)),("exportable",.bool(false))])
        default:return SessionWrites.failure("unavailable")
        }
    }
}
