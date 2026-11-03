import ShiziCore
import QuartzCore
import UIKit

// B4.9a：导航层在 Swift（缺省 swift 模式；计划 B3B4-原生化架构与计划.md §3.3 段 2、§10.x B3.F / B4.9a）。
//
// 原来只在 JS（src/ui/engine.js 引擎模式）的那一半——栈记账（route.save / stage.enter / stage.resync）、冷启动判定（route.plan：planColdStart、
// RESTORE_GUARDS）、提醒深链（deeplink.reminder：runDeepLink）、宿主消息（hostBodies）、来源记账（planPaper）、网页界面层的 stage.cover / fence /
// under 与 shiziNativeNav——由 ShiziCore Navigation/ 的同一套规则答（当年 JS 是参考实现，D84 起 JS 对照退役）。
// 「去哪」的规则（首页主按钮、结果页离开 / 再写一组、深链、开组失败、S02、查字……）由 EngineHost 调 SwiftNavigator 的同名入口：
// 镜像记上 → {op:'nav'} 交 NativeStage 照做（与原来页面发的同一条消息）→ 宿主消息紧跟着（视图 / 会话回包延后按序求值）交原来的处理。

/// hostBodies 的 App 一侧：会话 API / 视图回包先放占位，deliver 时按发出顺序求值（JS 在 hostBodies 里同步调，顺序相同）。
final class AppHostIO: HostIO {
    enum Req {
        case api(String, JSObject)
        case view(String, JSObject)
        case leave(String, String)
    }

    unowned let nav: SwiftNavigator
    private(set) var reqs: [Req] = []
    init(nav: SwiftNavigator) { self.nav = nav }

    static let key = "$shiziReq"
    private func placeholder(_ r: Req) -> JSValue {
        reqs.append(r)
        return .object(JSObject([(Self.key, .number(Double(reqs.count - 1)))]))
    }

    /// 取走这一批（deliver 时求值）。
    func drain() -> [Req] {
        let out = reqs
        reqs = []
        return out
    }

    func nativeOn(_ name: String) -> Bool { ShiziScreenRegistry.screenClass(name) != nil }
    func api(_ op: String, _ args: JSObject) -> JSValue { placeholder(.api(op, args)) }
    func view(_ name: String, _ params: JSValue?) -> JSValue {
        var a = SwiftNavigator.viewEnv()
        for (k, v) in params?.objectValue?.entries ?? [] { a[k] = v }
        return placeholder(.view(name, a))
    }
    func viewAsync(_ name: String) -> Bool { name == "detail" } // session/api/detail.js view.detail 是 async
    func now() -> Double { Date().timeIntervalSince1970 * 1000 }
    func undo(_ slot: String, _ sessionId: String) -> JSValue { nav.host.takeSkipUndo(slot, sessionId) }
    func leave(_ slot: String, _ sessionId: String) { _ = placeholder(.leave(slot, sessionId)) }
    func width() -> JSValue { .number(Double(UIScreen.main.bounds.width)) }
    func ax() -> JSValue { .bool(SwiftNavigator.axLevel() > 0) }
    func back() { nav.host.router.back() }
    func isOk(_ v: JSValue) -> Bool? { v[Self.key] != nil ? nil : v["ok"] == .bool(true) }
}

final class SwiftNavigator {
    let core: SwiftEngineCore
    let host: NavHost
    private(set) var io: AppHostIO!
    weak var stage: NativeStage?
    private var attached = false
    /// 宿主消息按序交出（engine.js deliver 的 chain）。
    private var chain: Task<Void, Never>?
    private var imageSeq = 0

    init(core: SwiftEngineCore) {
        self.core = core
        var testHost = false
        #if DEBUG
        testHost = RootViewController.nativeTestHostEnabled
        #endif
        host = NavHost(screens: .app(testHost: testHost), now: SwiftEngine.clock, clockNow: { CACurrentMediaTime() * 1000 })
        io = AppHostIO(nav: self)
        let router = host.router
        router.idPrefix = "s" // 与页面路由（QA 镜像里的测试脚本）开的 e<n> 条目分开编号
        router.hosts = { [unowned self] prev, next, _, _ in HostBodies.bodies(prev, next, io: io, state: host.state, paper: host.paper) }
        router.post = { [weak self] wire in
            self?.stage?.engineNav(EngineValue.any(.object(wire)) as? [String: Any] ?? [:])
            self?.onStack?()
        }
        router.deliver = { [weak self] bodies in self?.deliver(bodies) }
        #if DEBUG
        router.trace = { SwiftNavigator.noteTrace($0) }
        #endif
        // 原生发起的导航：订阅者（提示键写入是一次同步落库）推迟到转场之后（engine.js NATIVE_EMIT_DELAY_MS = 推入 + 一个淡化）
        router.deferNativeEmit = { fn in
            let m = NativeNavMotion.current
            let ms = m.map { $0.pushMs + $0.phaseMs } ?? 450
            DispatchQueue.main.asyncAfter(deadline: .now() + ms / 1000, execute: fn)
        }
        host.memory.writeRoute = { [unowned self] raw in core.store.storage.writeRoute(raw) }
        host.memory.blocked = { [unowned self] in !BlockView.blockReasonOf(.object(core.store.status)).isNull }
    }

    var router: EngineRouter { host.router }

    #if DEBUG
    /// B4.9c：转场记录（engine.js account 的 traceNav 同一处、同一格式，最近 12 条）。swift 模式里导航不经页面，QA 探针的 webNav 读这里。
    private(set) static var traceLog: [String] = []
    static func noteTrace(_ s: String) {
        traceLog.append(s)
        if traceLog.count > 12 { traceLog.removeFirst(traceLog.count - 12) }
    }
    #endif

    /// 视图请求的环境（native-stage.js viewEnv：页面宽与大字号档）。
    static func viewEnv() -> JSObject {
        JSObject([("width", .number(Double(UIScreen.main.bounds.width))), ("ax", .number(Double(axLevel())))])
    }

    /// 大字号档（text-size.js axLevelOf：AX1…AX5 → 1…5，其余 0）。
    static func axLevel() -> Int { NativeAXLayout.level() }

    // MARK: 宿主消息

    /// JS 发起的导航之后：宿主消息（视图 / 会话回包按发出顺序求值）交 NativeStage 原来的处理。
    private func deliver(_ bodies: [HostBody]) {
        let reqs = io.drain()
        guard !bodies.isEmpty || !reqs.isEmpty else { return }
        let prev = chain
        chain = Task { @MainActor [weak self] in
            await prev?.value
            guard let self else { return }
            let out = await self.resolve(bodies, reqs)
            self.stage?.dispatch(out)
        }
    }

    /// 帧同步（fence）：网页版 = 「等页面把刚换好的页画完一帧」；swift 模式里换页的是原生——等已经发出的宿主消息求完值、交给 NativeStage，
    /// 且 NativeStage 排着的开 / 关屏都做完（B4.9c：原来立即回，写字页「看这个字 ›」让开时字详情还没盖上，写字页被收起，返回时不是同一页）。
    @MainActor private func fence() async {
        await chain?.value
        guard let stage else { return }
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in stage.afterQueued { c.resume() } }
    }

    /// 原生发起的导航 / 冷启动 / 重载对齐：回包里带求好值的宿主消息（排在已经发出的那些后面）。
    @MainActor private func resolved(_ bodies: [HostBody]) async -> [[String: Any]] {
        let reqs = io.drain()
        let prev = chain
        var out: [[String: Any]] = []
        let mine = Task { @MainActor [weak self] in
            await prev?.value
            guard let self else { return }
            out = await self.resolve(bodies, reqs)
        }
        chain = mine
        await mine.value
        return out
    }

    /// 占位按发出顺序求值（commitLeave 在它之后的 open 之前），换回消息里；重写错字页 redo-open 求出来不是 ok → 丢掉、退回去。
    @MainActor private func resolve(_ bodies: [HostBody], _ reqs: [AppHostIO.Req]) async -> [[String: Any]] {
        var values: [JSValue] = []
        var committed = false
        for r in reqs {
            switch r {
            case .api(let op, let args): values.append(await core.answer(function: EngineOps.write, op: op, args: args))
            case .view(let name, let args): values.append(await core.answer(function: EngineOps.app, op: "view." + name, args: args))
            case .leave(let slot, let sid):
                _ = SessionResults.leave(core.store, JSObject([("slot", .string(slot)), ("sessionId", .string(sid))]))
                committed = true
                values.append(.null)
            }
        }
        if committed { onCommit?() }
        func fill(_ v: JSValue) -> JSValue {
            switch v {
            case .object(let o):
                if o.count == 1, case .number(let i)? = o[AppHostIO.key], Int(i) < values.count { return values[Int(i)] }
                var out = JSObject()
                for (k, x) in o.entries { out[k] = fill(x) }
                return .object(out)
            case .array(let a): return .array(a.map(fill))
            default: return v
            }
        }
        var out: [[String: Any]] = []
        var back = false
        for b in bodies {
            let body = fill(b.body)
            if b.redoGuard, body["payload"]?["ok"] != .bool(true) { back = true; continue }
            out.append(["type": b.type, "body": EngineValue.any(body)])
        }
        if back { DispatchQueue.main.async { [weak self] in self?.router.back() } } // redoOpenBody：Promise.resolve().then(() => nav.back())
        return out
    }

    /// Swift 在宿主消息求值里写了库（commitLeave）：通知 SwiftEngine（QA 镜像同步）。
    var onCommit: (() -> Void)?
    /// 镜像的栈变了（QA 镜像：页面的导航镜像对齐）。
    var onStack: (() -> Void)?

    // MARK: 栈往来 op（原来交 JS 的 route.* / stage.* / deeplink.reminder / shiziNativeNav）

    static let appOps: Set<String> = ["route.plan", "route.save", "stage.enter", "stage.resync", "deeplink.reminder", "stage.cover", "stage.fence", "stage.under"]
    static let navOps: Set<String> = ["back", "cover", "fence"]

    private func attach() {
        guard !attached else { return }
        attached = true
        host.memory.attach()
    }

    private func blocked() -> Bool { !BlockView.blockReasonOf(.object(core.store.status)).isNull }

    /// 一个栈往来 op；不是的回 nil。
    @MainActor func answer(function: String, op: String, args: JSObject) async -> JSValue? {
        func reply(_ pairs: [(String, JSValue)]) -> JSValue { .object(JSObject(pairs)) }
        func bodiesValue(_ list: [[String: Any]]) -> JSValue { EngineValue.js(list) }
        if function == EngineOps.nav {
            switch op {
            case "back": return host.backPlan()
            case "cover": return reply([("ok", .bool(true))]) // 网页宿主层的截图：没有网页界面，原生页自己画
            case "fence": await fence(); return reply([("ok", .bool(true))])
            default: return reply([("ok", .bool(false)), ("error", reply([("kind", .string("invalid"))]))])
            }
        }
        guard function == EngineOps.app, Self.appOps.contains(op) else { return nil }
        switch op {
        case "route.plan":
            let status = JSValue.object(core.store.status)
            let raw = (try? core.store.storage.read(Schema.keyNamed("route") ?? "shizi.v2.route")).flatMap { $0 }.map(JSValue.string) ?? .null
            let plan = (try? RouteRules.planColdStart(route: RouteRules.parseRoute(raw), state: .object(core.store.state), blockReason: BlockView.blockReasonOf(status),
                                                      corrupt: !(status["corruptNotice"] ?? .null).isNull, deepLink: args["deepLink"] == .bool(true),
                                                      now: SwiftEngine.clock(), screens: router.screens, dates: core.store.dates)) ?? reply([("stack", .null), ("reason", .string("none"))])
            host.memory.noteColdStart(plan)
            let stack = plan["stack"] ?? .null
            let r = router.start(stack, cold: !stack.isNull)
            attach()
            onStack?()
            let bodies = await resolved(r.bodies)
            return reply([("ok", .bool(true)), ("reason", plan["reason"] ?? .null), ("restored", .bool(!stack.isNull)), ("stack", .array(r.stack)),
                          ("bodies", bodiesValue(bodies)), ("blocked", .bool(blocked()))])
        case "route.save":
            if router.adopt(args["stack"], seq: args["seq"].flatMap { $0.numberValue.map(JSValue.number) }) { onStack?() }
            attach()
            let res = args["flush"] == .bool(true) ? host.memory.hidden() : nil // 进后台：之后再来的深链是热启动；刷新离开时刻
            return reply([("ok", .bool(true)), ("written", .bool(res?["ok"] == .bool(true)))])
        case "stage.enter":
            guard let bodies = router.apply(NavHost.enterIntent(.object(args)), origin: "native") else {
                return reply([("ok", .bool(false)), ("error", reply([("kind", .string("invalid"))]))])
            }
            onStack?()
            return reply([("ok", .bool(true)), ("bodies", bodiesValue(await resolved(bodies)))])
        case "stage.resync":
            let r = router.start(args["stack"], silent: true)
            attach()
            let keep = RouteRules.validPrefix(r.stack, state: .object(core.store.state), now: SwiftEngine.clock(), dates: core.store.dates)
            var bodies: [HostBody] = []
            if keep.count < r.stack.count { bodies = router.apply(JSObject([("kind", .string("restore")), ("stack", .array(keep))])) ?? [] }
            onStack?()
            return reply([("ok", .bool(true)), ("stack", .array(keep)), ("bodies", bodiesValue(await resolved(bodies))), ("blocked", .bool(blocked()))])
        case "deeplink.reminder":
            guard case .string(let key)? = args["cardKey"], !key.isEmpty, let open = openReminder else { return reply([("ok", .bool(false)), ("error", reply([("kind", .string("unavailable"))]))]) }
            host.memory.yieldToDeepLink { open(key) }
            return reply([("ok", .bool(true))])
        case "stage.cover": return host.cover(entryId: args["entryId"], url: args["url"])
        case "stage.fence": await fence(); return reply([("ok", .bool(true))])
        case "stage.under": return host.under(nativeOn: { ShiziScreenRegistry.screenClass($0) != nil })
        default: return nil
        }
    }

    /// 提醒深链的开组（reminder.js controller.openTarget；SwiftEngine 接到 ReminderController）。
    var openReminder: ((String) -> Void)?

    // MARK: 「去哪」的规则（EngineHost 调）

    /// 改栈失败（JS 里路由抛错，op 照样抛出）：记一笔再抛。
    private func logged<T>(_ what: String, _ fn: () throws -> T) throws -> T {
        do { return try fn() } catch {
            ShiziProbe.log("swift nav: \(what) failed: \(error) stack=\(router.stack.map { $0["n"]?.stringValue ?? "?" })")
            throw error
        }
    }

    func openWrite(_ slot: String) throws { _ = try logged("openWrite") { try host.openWrite(slot) } }
    func push(_ name: String, _ params: JSValue) throws { try logged("push \(name)") { try router.push(name, params) } }
    func replace(_ name: String, _ params: JSValue, animate: Bool = false) throws { try logged("replace \(name)") { try router.replace(name, params, animate: animate) } }
    func back(cause: String = "ui") { router.back(cause: cause) }
    func openNone(_ exhausted: JSValue?) throws { try logged("openNone") { try host.openNone(exhausted: exhausted) } }
    func openS02(_ prompt: JSValue?) throws { try logged("openS02") { try host.openS02(chars: prompt?["unwrittenChars"]) } }
    func closeTop(_ name: String) { host.closeTop(name) }
    func openQuery(_ mode: String) throws { try logged("openQuery") { try host.openQuery(mode: mode) } }
    func openLibrarySwitch() throws { try logged("openLibrarySwitch") { try host.openLibrarySwitch() } }
    func markSource(_ source: JSValue?, key: String) {
        guard var src = source?.objectValue, src["rect"] != nil, source?["rect"] != .null else { return }
        src["key"] = .string(key)
        host.paper.markNativeSource(src)
    }
    func markOverlayTap() { host.paper.markOverlayTap() }
    func setLive(_ key: String, _ live: JSValue?) { host.paper.setLive(.string(key), live) }
    @discardableResult func openCharDetail(_ char: String) throws -> Bool { try logged("openCharDetail") { try host.openCharDetail(.string(char)) } }

    /// 写字页的导航（native-session.js WRITE_NAVIGATE）。
    func writeBack() { host.writeBack() }
    func writeToResult(_ slot: JSValue, _ sessionId: JSValue, _ undo: JSValue?) throws { try logged("writeToResult") { try host.writeToResult(slot: slot, sessionId: sessionId, undo: undo) } }
    func writeToDetail(_ char: JSValue?) throws -> Bool { try logged("writeToDetail") { try host.writeToDetail(char: char) } }
    func redoBack() { host.redoBack() }

    /// 结果页（RESULT_DEPS）。
    func resultAgain(_ r: JSValue) throws { try logged("resultAgain") { try host.resultAgain(r) } }
    func resultToWrite(_ slot: JSValue) throws { try logged("resultToWrite") { try host.resultToWrite(slot) } }
    func resultRedo(_ chars: [JSValue]) throws -> Bool { try logged("resultRedo") { try host.resultRedo(chars) } }
    func leaveTo(_ leave: JSValue?) throws { try logged("leaveTo") { try host.leaveTo(leave) } }

    /// 原生图片预览弹层（images-entry.js openNativePreview：结果页「分享」、字详情「做成图片」）。
    func openImagePreview(_ scope: JSObject) {
        imageSeq += 1
        var plain = JSObject([("kind", .string(["day", "month", "glyph", "annual"].contains(scope["kind"]?.stringValue ?? "") ? scope["kind"]!.stringValue! : "session"))])
        for k in ["slot", "sessionId", "day", "month", "char", "year"] { if let v = scope[k], !v.isNull { plain[k] = v } }
        // nativeRunUnderPreview：顶层是原生页时把它与它下面连着的原生页带上（原生栈按 run 对齐）
        var run: JSValue = .array([])
        let snap = router.snapshot()
        if router.stack.count >= 2, let top = router.top, let n = top["n"]?.stringValue, ShiziScreenRegistry.screenClass(n) != nil {
            var items = HostBodies.runBelow(snap, top["id"] ?? .null, withViews: false, io: io).arrayValue ?? []
            items.append(.object(JSObject([("entryId", top["id"] ?? .null), ("screen", top["n"] ?? .null), ("params", top["p"] ?? .object(JSObject()))])))
            run = .array(items)
        }
        let msg = JSObject([("op", .string("open")), ("screen", .string("image-preview")), ("entryId", .string("image-preview-\(imageSeq)")),
                            ("params", .object(JSObject([("scope", .object(plain))]))), ("via", .string("quiet")), ("run", run)])
        post(msg)
    }

    /// 原生分享 / 外链失败的提示条（share-failed.js postNativeToast：按 kind 取 X-SHARE 文案，未知 kind 用通用句）。
    private var toastSeq = 0
    func postShareFailed(kind: String) {
        let keys = ["backup": "X-SHARE.backupFailed", "card": "X-SHARE.cardFailed", "link": "X-SHARE.linkFailed"]
        let text = (try? Copy.text(keys[kind] ?? "X-SHARE.failed")) ?? ""
        toastSeq += 1
        post(JSObject([("op", .string("open")), ("screen", .string("image-toast")), ("entryId", .string("image-toast-\(toastSeq)")),
                       ("params", .object(JSObject([("text", .string(text)), ("kind", .string("failure"))]))), ("via", .string("quiet"))]))
    }

    /// 宿主自己发的原生屏消息（图片预览的开 / 收、阻断页、坏值提示）：排在已经发出的宿主消息后面。
    func post(_ msg: JSObject) {
        deliverRaw([["type": "native", "body": EngineValue.any(.object(msg))]])
    }

    private func deliverRaw(_ list: [[String: Any]]) {
        let prev = chain
        chain = Task { @MainActor [weak self] in
            await prev?.value
            self?.stage?.dispatch(list)
        }
    }
}
