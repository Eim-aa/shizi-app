import Foundation

extension CoreEngine {
    static func writeHost(_ store: Store, _ a: JSObject) throws -> JSValue {
        let d = WriteDependencies(), config = a["hooks"]?.objectValue ?? JSObject()
        var calls: [JSValue] = []
        func invoke(_ name: String, _ arg: JSValue) throws -> JSValue {
            calls.append(JS.obj([("name", .string(name)), ("args", arg)]))
            if config[name]?["throws"] == .bool(true) { throw CoreError.error("host-" + name) }
            return config[name]?["reply"] ?? .null
        }
        if config["view"] != nil { d.resultView = { _, args in try invoke("view", .object(args)) } }
        if config["seal"] != nil { d.seal = { _ = try invoke("seal", .string($0)) } }
        if config["toWrite"] != nil { d.toWrite = { _ = try invoke("toWrite", .string($0)) } }
        if config["again"] != nil { d.again = { _ = try invoke("again", $0) } }
        if config["leave"] != nil { d.leave = { _ = try invoke("leave", $0) } }
        if config["redo"] != nil { d.redo = { try invoke("redo", .array($0)) } }
        if config["detail"] != nil { d.detail = { try invoke("detail", .string($0)) } }
        if config["share"] != nil { d.share = { try invoke("share", .object($0)) } }
        let reply = WriteAPI.call(JS.string(a["op"]), store, a["args"]?.objectValue ?? JSObject(), dependencies: d)
        return JS.obj([("reply", reply), ("calls", .array(calls))])
    }
}
