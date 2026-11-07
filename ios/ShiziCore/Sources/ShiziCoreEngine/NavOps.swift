import Foundation
import ShiziCore

// B4.9a：导航层的差分 op（JS 参考已随 D84 退役）。

/// 场景里 hostBodies 的桩：会话 API / 视图回包只回 {ok, op|view}，调用记进 calls。
final class NavStubIO: HostIO {
    var calls: [JSValue] = []
    var native: Set<String> = []
    var wantBack = false
    weak var host: NavHost?

    static func norm(_ v: JSValue?) -> JSValue {
        guard let v else { return .null }
        switch v {
        case .array(let a): return .array(a.map { norm($0) })
        case .object(let o):
            var out = JSObject()
            for (k, x) in o.entries {
                if k == "until" { if case .number(let d) = x, d.isFinite { out[k] = .string("finite") } else { out[k] = .string(JS.string(x)) } }
                else { out[k] = norm(x) }
            }
            return .object(out)
        default: return v
        }
    }

    func nativeOn(_ name: String) -> Bool { native.contains(name) }
    func api(_ op: String, _ args: JSObject) -> JSValue {
        let ok = op == "redoOpen" ? ((args["chars"]?.arrayValue?.count ?? 0) > 0) : true
        calls.append(JS.obj([("api", .string(op)), ("args", Self.norm(.object(args))), ("ok", .bool(ok))]))
        return JS.obj([("ok", .bool(ok)), ("op", .string(op))])
    }
    func view(_ name: String, _ params: JSValue?) -> JSValue {
        calls.append(JS.obj([("view", .string(name)), ("params", Self.norm(params))]))
        return JS.obj([("ok", .bool(true)), ("view", .string(name))])
    }
    func viewAsync(_ name: String) -> Bool { name == "detail" }
    func now() -> Double { 0 }
    func undo(_ slot: String, _ sessionId: String) -> JSValue {
        let u = host?.takeSkipUndo(slot, sessionId) ?? .null
        calls.append(JS.obj([("undo", .array([.string(slot), .string(sessionId)])), ("got", Self.norm(u))]))
        return u
    }
    func leave(_ slot: String, _ sessionId: String) { calls.append(JS.obj([("leave", .array([.string(slot), .string(sessionId)]))])) }
    func width() -> JSValue { .number(390) }
    func ax() -> JSValue { .bool(false) }
    func back() { wantBack = true }
    func isOk(_ v: JSValue) -> Bool? { v["ok"] == .bool(true) }
}

extension CoreEngine {
    static func navRoutePolicy(_ a: JSObject) -> JSValue {
        guard let rr = a["routeRestore"], JS.truthy(rr) else { return Config.policy }
        var p = Config.policy.objectValue ?? JSObject()
        p["routeRestore"] = rr
        return .object(p)
    }

    static let navOps: [String: Op] = [
        "nav.route.parse": { _, a in RouteRules.parseRoute(a["raw"]) },
        "nav.route.encode": { _, a in RouteRules.encodeRoute(a["stack"], a["at"]).map(JSValue.string) ?? .null },
        "nav.route.fresh": { e, a in .bool(try RouteRules.routeFresh(a["at"], a["now"], policy: navRoutePolicy(a), dates: e.dates)) },
        "nav.route.stackOf": { _, a in RouteRules.routeStackOf(a["snap"]) },
        "nav.route.plan": { e, a in
            try RouteRules.planColdStart(route: RouteRules.parseRoute(a["raw"]), state: a["state"] ?? .null, blockReason: JS.truthy(a["blocked"]) ? JS.obj([("kind", .string("blocked"))]) : nil,
                                         corrupt: JS.truthy(a["corrupt"]), deepLink: JS.truthy(a["deepLink"]), now: a["now"]?.numberValue ?? e.clock,
                                         policy: navRoutePolicy(a), screens: .app(), dates: e.dates)
        },
        "nav.route.guard": { e, a in
            guard let ok = RouteRules.restoreGuard(JS.string(a["name"]), a["p"], state: a["state"] ?? .null, now: a["now"]?.numberValue ?? e.clock, dates: e.dates) else { return .null }
            return .bool(ok)
        },
        "nav.route.validPrefix": { e, a in .array(RouteRules.validPrefix(a["stack"]?.arrayValue ?? [], state: a["state"] ?? .null, now: a["now"]?.numberValue ?? e.clock, dates: e.dates)) },
        "nav.scenario": { e, a in navScenario(e, a) },
    ]

    static func navScenario(_ e: CoreEngine, _ a: JSObject) -> JSValue {
        let now = a["now"]?.numberValue ?? 0
        let host = NavHost(screens: .app(), now: { now }, clockNow: { ProcessInfo.processInfo.systemUptime * 1000 })
        let io = NavStubIO()
        io.host = host
        io.native = Set((a["native"]?.arrayValue ?? []).compactMap { $0.stringValue })
        let router = host.router
        var captured: [HostBody] = [], posted: [JSValue] = [], writes: [JSValue] = [], timers: [() -> Void] = []
        router.hosts = { prev, next, _, _ in
            let b = HostBodies.bodies(prev, next, io: io, state: host.state, paper: host.paper)
            captured.append(contentsOf: b)
            return b
        }
        router.post = { posted.append(.object($0)) }
        router.deferNativeEmit = { timers.append($0) }
        host.memory.writeRoute = { raw in writes.append(.string(raw)); return JS.obj([("ok", .bool(true))]) }
        var out: [JSValue] = []
        for step in a["steps"]?.arrayValue ?? [] {
            io.calls = []; captured = []; posted = []; writes = []; io.wantBack = false
            var ret: JSValue
            do { ret = try navStep(step, host: host) } catch { ret = JS.obj([("error", .bool(true))]) }
            while !timers.isEmpty { timers.removeFirst()() }
            if io.wantBack { router.back() }
            while !timers.isEmpty { timers.removeFirst()() }
            var plans = JSObject(), sources = JSObject()
            for e in router.stack { let id = JS.string(e["id"]); plans[id] = host.paper.nativePlanOf(id); sources[id] = host.paper.sourceOf(id) }
            let snap = router.snapshot()
            var tr: JSValue = .null
            if case .object(let t)? = snap["transition"] {
                var o = JSObject([("seq", t["seq"]!), ("kind", t["kind"]!), ("animate", t["animate"]!), ("cause", t["cause"]!),
                                  ("from", t["from"]?["id"] ?? .null), ("to", t["to"]?["id"] ?? .null)])
                if JS.truthy(t["cold"]) { o["cold"] = .bool(true) }
                tr = .object(o)
            }
            let s = JS.obj([("stack", .array(router.stack.map(EngineRouter.plain))), ("depth", snap["depth"]!), ("tab", snap["tab"]!), ("navSeq", snap["navSeq"]!), ("transition", tr)])
            out.append(JS.obj([
                ("ret", NavStubIO.norm(ret)),
                ("bodies", .array(captured.map { JS.obj([("type", .string($0.type)), ("body", NavStubIO.norm($0.body))]) })),
                ("posted", NavStubIO.norm(.array(posted))), ("calls", .array(io.calls)), ("writes", .array(writes)), ("snap", s),
                ("plans", NavStubIO.norm(.object(plans))), ("sources", NavStubIO.norm(.object(sources))), ("pristine", .bool(host.memory.pristine)),
            ]))
        }
        return .array(out)
    }

    static func navStep(_ step: JSValue, host: NavHost) throws -> JSValue {
        let router = host.router
        let args = step["args"]?.arrayValue ?? []
        func arg(_ i: Int) -> JSValue? { i < args.count ? args[i] : nil }
        switch step["do"]?.stringValue ?? "" {
        case "start": return JS.obj([("stack", .array(router.start(step["stack"], cold: JS.truthy(step["cold"]), silent: JS.truthy(step["silent"])).stack))])
        case "enter": return JS.obj([("ok", .bool(router.apply(NavHost.enterIntent(step), origin: "native") != nil))])
        case "push": try router.push(JS.string(step["name"]), step["params"] ?? .null); return .null
        case "replace": try router.replace(JS.string(step["name"]), step["params"] ?? .null, animate: JS.truthy(step["animate"])); return .null
        case "back": return .bool(router.back(cause: JS.truthy(step["cause"]) ? JS.string(step["cause"]) : "ui"))
        case "tab": try router.switchTab(JS.string(step["name"])); return .null
        case "params": router.setParams(step["patch"] ?? .null); return .null
        case "adopt":
            let seq: JSValue? = { if case .number(let d)? = step["seq"], d.isFinite { return .number(d) }; return nil }()
            return .bool(router.adopt(step["stack"], seq: seq))
        case "mark":
            var o = step["source"]?.objectValue ?? JSObject()
            o["key"] = step["key"] ?? .null
            host.paper.markNativeSource(o); return .null
        case "overlay": host.paper.markOverlayTap(); return .null
        case "live": host.paper.setLive(step["key"] ?? .null, step["live"]); return .null
        case "forget": host.paper.forgetTap(); return .null
        case "cover": return host.cover(entryId: step["entryId"], url: step["url"])
        case "write":
            switch JS.string(step["fn"]) {
            case "back": host.writeBack(); return .null
            case "toResult": try host.writeToResult(slot: arg(0) ?? .null, sessionId: arg(1) ?? .null, undo: arg(2)); return .null
            case "toDetail": return .bool(try host.writeToDetail(char: arg(1)))
            case "redoBack": return .bool(host.redoBack())
            default: throw CoreError.badArgs("unknown write fn")
            }
        case "result":
            switch JS.string(step["fn"]) {
            case "again": try host.resultAgain(arg(0) ?? .null); return .null
            case "toWrite": try host.resultToWrite(arg(0) ?? .null); return .null
            case "redo": return .bool(try host.resultRedo(arg(0)?.arrayValue ?? []))
            case "detail": return .bool(try host.openCharDetail(arg(0)))
            case "leave": try host.leaveTo(arg(0)); return .null
            default: throw CoreError.badArgs("unknown result fn")
            }
        case "openWrite": return .string(try host.openWrite(JS.string(step["slot"])))
        case "detail": return .bool(try host.openCharDetail(step["char"]))
        case "leaveTo": try host.leaveTo(step["leave"]); return .null
        case "attach": host.memory.attach(); return .null
        case "hidden": host.memory.hidden(); return .null
        case "flush": host.memory.flush(); return .null
        case "deepLink":
            var ran = false
            let how = host.memory.yieldToDeepLink { ran = true }
            return JS.obj([("how", .string(how)), ("ran", .bool(ran))])
        case "backPlan": return host.backPlan()
        default: throw CoreError.badArgs("unknown step")
        }
    }
}
