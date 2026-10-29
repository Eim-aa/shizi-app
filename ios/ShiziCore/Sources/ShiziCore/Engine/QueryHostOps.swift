import Foundation

extension CoreEngine {
    static func queryHost(_ store: Store, _ a: JSObject) -> JSValue {
        let hooks = SessionActionHooks(), config = a["callbacks"]?.objectValue ?? JSObject()
        var calls: [JSValue] = []
        func invoke(_ name: String, _ arg: JSValue = .null) throws -> JSValue {
            calls.append(JS.obj([("name",.string(name)),("args",arg)]))
            if config[name]?["throws"] == .bool(true) { throw CoreError.error("host-" + name) }
            return config[name]?["reply"] ?? .null
        }
        func callback(_ name: String, _ input: JSValue, _ context: QueryActionContext) throws -> JSValue {
            calls.append(JS.obj([("name",.string(name)),("args",name == "detail" ? input : JS.obj([("input",input),("mode",.string(context.mode))]))]))
            if config[name]?["close"] == .bool(true) { try context.close();try context.close() }
            if config[name]?["throws"] == .bool(true) { throw CoreError.error("host-" + name) }
            return config[name]?["reply"] ?? .null
        }
        hooks.queryMode = a["mode"]?.stringValue ?? "lookup"
        if config["close"] != nil { hooks.queryClose = { _ = try invoke("close") }; hooks.s02Close = { _ = try invoke("close") } }
        for name in ["practice","pick","detail"] where config[name] != nil {
            let async = config[name]?["async"] == .bool(true)
            if name == "practice" { if async { hooks.queryPracticeAsync = { c,ctx in await Task.yield();return try callback(name,.string(c),ctx) } } else { hooks.queryPractice = { try callback(name,.string($0),$1) } } }
            if name == "pick" { if async { hooks.queryPickAsync = { c,ctx in await Task.yield();return try callback(name,.array(c.map(JSValue.string)),ctx) } } else { hooks.queryPick = { try callback(name,.array($0.map(JSValue.string)),$1) } } }
            if name == "detail" { if async { hooks.queryDetailAsync = { c,ctx in await Task.yield();return try callback(name,.string(c),ctx) } } else { hooks.queryDetail = { try callback(name,.string($0),$1) } } }
        }
        hooks.s02Registered = a["registered"] == .bool(true)
        if config["continue"] != nil { hooks.s02Continue = { _ = try invoke("continue") } }
        if config["cancel"] != nil { hooks.s02Cancel = { _ = try invoke("cancel") } }
        if config["started"] != nil { hooks.s02Started = { _ = try invoke("started",$0) } }
        if config["endStart"] != nil {
            if config["endStart"]?["async"] == .bool(true) { hooks.s02EndStartAsync = { await Task.yield();return try invoke("endStart") } }
            else { hooks.s02EndStart = { try invoke("endStart") } }
        }
        let done = DispatchSemaphore(value:0);var reply: JSValue = .null
        Task { reply = await PageAPI.callAsync(JS.string(a["op"]),store:store,args:a["args"]?.objectValue ?? JSObject(),hooks:hooks);done.signal() };done.wait()
        return JS.obj([("reply",reply),("calls",.array(calls))])
    }
}
