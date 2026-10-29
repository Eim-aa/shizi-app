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
        if config["colors"] != nil { d.colors = { try invoke("colors", .array([])) } }
        if config["type"] != nil { d.type = { try invoke("type", .array([])) } }
        if config["theme"] != nil { d.theme = { try invoke("theme", .array([])) } }
        if config["refLabel"] != nil { d.refLabel = { try invoke("refLabel", .object($0)) } }
        if config["refLabel"]?["async"] == .bool(true) { d.refLabelAsync = { await Task.yield(); return try invoke("refLabel", .object($0)) } }
        if let nav = a["navigate"]?.objectValue {
            d.navigate = [:]
            for name in nav.keys { d.navigate?[name] = { args in
                calls.append(JS.obj([("name", .string("navigate." + name)), ("args", .array(args))]))
                if nav[name]?["throws"] == .bool(true) { throw CoreError.error("host-navigate." + name) }
                return nav[name]?["reply"] ?? .null
            } }
        }
        func reminder(_ name: String, _ store: Store, _ args: JSObject) async throws -> JSValue {
            if let settings = config[name]?["settings"] { _ = store.commit("host:reminder") { d,_ in d["settings"] = settings } }
            let r = try invoke(name, .object(args))
            if let permission = config[name]?["laterPermission"] {
                DispatchQueue.global().asyncAfter(deadline: .now() + 0.005) {
                    _ = PageAPI.call("reminder.status", store: store, args: JSObject([("permission", permission)]))
                }
            }
            return r
        }
        if config["invite"] != nil { d.reminderInvite = { try await reminder("invite", $0, $1) } }
        if config["changeTime"] != nil { d.reminderChangeTime = { try await reminder("changeTime", $0, $1) } }
        d.reminderWaitMs = a["waitMs"]?.numberValue ?? 30
        let semaphore = DispatchSemaphore(value: 0)
        var asyncReply: JSValue = .null
        let async = a["op"] == .string("resultInvite") || (a["op"] == .string("refLabel") && d.refLabelAsync != nil)
        if async {
            Task { asyncReply = await WriteAPI.callAsync(JS.string(a["op"]), store, a["args"]?.objectValue ?? JSObject(), dependencies: d); semaphore.signal() }
            semaphore.wait()
        }
        let reply = async ? asyncReply : WriteAPI.call(JS.string(a["op"]), store, a["args"]?.objectValue ?? JSObject(), dependencies: d)
        return JS.obj([("reply", reply), ("calls", .array(calls))])
    }
}
