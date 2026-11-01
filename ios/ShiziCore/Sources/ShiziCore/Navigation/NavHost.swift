import Foundation

// B4.9a：导航层的「去哪」规则（JS 参考：src/ui/route-memory.js createRouteMemory、src/ui/screens/session/index.js openWrite、
// detail/open.js openCharDetail、result/index.js leaveTo / openResult / handoffSkipUndo / takeSkipUndo、write/native-session.js 的
// 写字页导航（back / toResult / toDetail / redoBack）与结果页 RESULT_DEPS（again / toWrite / redo / detail）、
// session/none.js openNonePage、session/s02.js openS02 / closeNativeS02、components/query/index.js openQuery / closeNativeQuery、
// library/switch.js openLibrarySwitch）。都只改镜像栈（router.request → 原生照做）与来源记账，不写 store（commitLeave 在 HostBodies 的 io.leave）。

/// 路由提示键的读写与冷启动恢复后的「动过没有」（createRouteMemory）。
public final class RouteMemory {
    public let router: EngineRouter
    /// storage.writeRoute(raw)。
    public var writeRoute: (String) -> JSValue = { _ in .null }
    /// 阻断页（含迁移失败）期间不写。
    public var blocked: () -> Bool = { false }
    /// env.now（App 时钟）。
    public var now: () -> Double
    public let defaultTab: String
    private var lastKey: String?
    private var coldNavSeq: Double?
    private var touched = false
    private var off: (() -> Void)?
    /// attach 过（JS：router 接上之前写与切后台都不做）。
    public private(set) var attached = false
    public private(set) var plan: JSValue = .null

    public init(router: EngineRouter, now: @escaping () -> Double, defaultTab: String = "home") {
        self.router = router
        self.now = now
        self.defaultTab = defaultTab
    }

    /// coldStart：记下这次判定（lastPlan 读）。
    public func noteColdStart(_ plan: JSValue) { self.plan = plan }
    public var lastPlan: JSValue {
        guard JS.truthy(plan) else { return .null }
        return .object(JSObject([("reason", plan["reason"] ?? .null), ("restored", .bool(JS.truthy(plan["stack"])))]))
    }

    /// 写一次提示键；force = 不管与上次是否相同。没写返回 nil。
    @discardableResult public func write(force: Bool) -> JSValue? {
        guard attached else { return nil }
        let stack = RouteRules.routeStackOf(.object(router.snapshot()))
        let key = JSONWriter.stringify(stack)
        if !force, let lastKey, lastKey == key { return nil }
        if blocked() { return nil }
        guard let raw = RouteRules.encodeRoute(stack, .number(now())) else { return nil }
        let result = writeRoute(raw)
        if result["ok"] == .bool(true) { lastKey = key }
        return result
    }

    /// router 启动之后接上：订阅镜像变化（写提示键、记「动过了」），立即写一次。
    public func attach() {
        off?()
        attached = true
        let snap = router.snapshot()
        coldNavSeq = JS.truthy(snap["transition"]?["cold"]) ? JS.number(snap["navSeq"]) : nil
        touched = false
        off = router.subscribe { [weak self] next in
            guard let self else { return }
            if let c = self.coldNavSeq, JS.number(next["navSeq"]) != c { self.touched = true }
            self.write(force: false)
        }
        write(force: true)
    }

    /// 进后台（visibilitychange hidden）：之后再来的深链是热启动；刷新离开时刻。
    public func hidden() {
        guard attached else { return }
        touched = true
        write(force: true)
    }

    /// 立即写一次（刷新离开时刻）。
    @discardableResult public func flush() -> JSValue? { write(force: true) }

    /// 冷恢复之后是否还没动过。
    public var pristine: Bool { coldNavSeq != nil && !touched }

    /// 提醒深链压过冷恢复：冷恢复且还没动过 → 先静默回首页再执行 fn；否则立即执行。'yielded' | 'direct'。
    @discardableResult public func yieldToDeepLink(_ fn: () -> Void) -> String {
        guard coldNavSeq != nil, !touched else { fn(); return "direct" }
        touched = true
        if router.stack.count == 1, jsEq(router.stack[0]["n"]?.stringValue, defaultTab) { fn(); return "direct" }
        try? router.switchTab(defaultTab)
        fn() // whenIdle：镜像没有转场要等
        return "yielded"
    }
}

public final class NavHost {
    public let router: EngineRouter
    public let paper: PaperPlanner
    public let state = HostState()
    public let memory: RouteMemory
    /// performance.now（跳过撤销的截止时刻）。
    public var clockNow: () -> Double
    private var pendingSkipUndo: JSObject?

    public init(screens: NavScreens, now: @escaping () -> Double, clockNow: @escaping () -> Double, policy: JSValue = Config.policy) {
        paper = PaperPlanner(now: clockNow, policy: policy)
        router = EngineRouter(screens: screens, paper: paper)
        memory = RouteMemory(router: router, now: now)
        self.clockNow = clockNow
    }

    static func p(_ pairs: [(String, JSValue)]) -> JSValue { .object(JSObject(pairs)) }
    var snapTop: JSObject? { router.top }

    /// openWrite(slot)：栈顶已是同槽写字页 → replace（不叠两层）；否则 push。'push' | 'replace'。
    @discardableResult public func openWrite(_ slot: String) throws -> String {
        let s = slot == "B" ? "B" : "A"
        if router.stack.count > 1, let top = snapTop, JS.isString(top["n"], "write"), RouteRules.slotOf(top["p"]) == s {
            try router.replace("write", Self.p([("slot", .string(s))]))
            return "replace"
        }
        try router.push("write", Self.p([("slot", .string(s))]))
        return "push"
    }

    /// openCharDetail(char)：不是汉字 / 栈顶已是同一个字的详情 → false；否则推入。
    @discardableResult public func openCharDetail(_ char: JSValue?) throws -> Bool {
        guard Query.isHan(char), let c = char?.stringValue else { return false }
        if router.stack.count > 1, let top = snapTop, JS.isString(top["n"], "detail"), JS.truthy(top["p"]), JS.isString(top["p"]?["char"], c) { return false }
        try router.push("detail", Self.p([("char", .string(c))]))
        return true
    }

    /// leaveTo(leave)：来源是 tab 根且就在结果页正下方 → nav.back（同左缘右滑）；中间隔着页 → 切回 tab 根；其余 nav.back。
    public func leaveTo(_ leave: JSValue?) throws {
        if let view = leave?["view"]?.stringValue, ["home", "library", "mine"].contains(where: { jsEq($0, view) }), router.screens.tab(view) == true {
            if router.stack.count == 2, JS.isString(router.stack[0]["n"], view) { router.back(); return }
            try router.switchTab(view)
            return
        }
        router.back()
    }

    /// openResult：写字页换成结果页（决定-D20：无中间页）。
    public func openResult(_ slot: JSValue, _ sessionId: JSValue) throws {
        try router.replace("result", Self.p([("slot", slot), ("sessionId", sessionId)]))
    }

    /// handoffSkipUndo：写字页把跳过撤销的剩余机会交给结果页。
    public func handoffSkipUndo(_ undo: JSValue?) {
        if let u = undo?.objectValue, JS.truthy(u["sessionId"]), JS.truthy(u["recordId"]) {
            var o = u
            o["failed"] = .bool(false)
            pendingSkipUndo = o
        } else { pendingSkipUndo = nil }
    }

    /// takeSkipUndo：结果页取走（取一次即清）；不是本组的或已过期的丢掉。
    public func takeSkipUndo(_ slot: String, _ sessionId: String) -> JSValue {
        let u = pendingSkipUndo
        pendingSkipUndo = nil
        guard let u, JS.isString(u["slot"], slot), JS.isString(u["sessionId"], sessionId) else { return .null }
        if case .number(let until)? = u["until"], until.isFinite, until <= clockNow() { return .null }
        return .object(u)
    }

    /// 撤销条交接用的截止时刻（{...undo, slot, until: clockNow() + remainingMs}）。
    public func withUntil(_ undo: JSValue?, slot: JSValue) -> JSValue? {
        guard let u = undo?.objectValue, JS.truthy(undo) else { return nil }
        var o = u
        o["slot"] = slot
        o["until"] = .number(clockNow() + JS.number(u["remainingMs"]))
        return .object(o)
    }

    // MARK: 写字页的导航（native-session.js createWriteSessionApi 的 navigate；撤销条交接在宿主）

    public func writeBack() { router.back(cause: "native") }

    public func writeToResult(slot: JSValue, sessionId: JSValue, undo: JSValue?) throws {
        handoffSkipUndo(withUntil(undo, slot: slot))
        try openResult(slot, sessionId)
    }

    /// 改判弹层「看这个字 ›」：写字条目留在栈里，字详情推在它上面；回到写字条目时请原生盖上（takeWriteAway）。
    @discardableResult public func writeToDetail(char: JSValue?) throws -> Bool {
        let top = snapTop
        state.writeAway = top.flatMap { JS.isString($0["n"], "write") ? $0["id"]?.stringValue : nil }
        let ok = try openCharDetail(char)
        if !ok { state.writeAway = nil }
        return ok
    }

    @discardableResult public func redoBack() -> Bool { router.back(cause: "native") }

    // MARK: 结果页（RESULT_DEPS 的导航那一半）

    public func resultAgain(_ r: JSValue) throws {
        if JS.truthy(r["started"]) || JS.truthy(r["occupied"]) { try router.replace("write", Self.p([("slot", .string("A"))]), animate: true) }
        else if JS.truthy(r["empty"]) { try router.replace("session-none", Self.p([("exhausted", .bool(JS.truthy(r["libraryExhausted"])))]), animate: true) }
        else { router.back() }
    }

    public func resultToWrite(_ slot: JSValue) throws { try router.replace("write", Self.p([("slot", slot)]), animate: true) }

    /// write/redo.js openRedo：只收单字、去重、题库里能练的字。
    public static func redoCharsOf(_ chars: [JSValue]) -> [JSValue] {
        var seen = Set<String>(), out: [JSValue] = []
        for c in chars {
            guard case .string(let s) = c, s.unicodeScalars.count == 1, !seen.contains(s), DeckIndex.shared.isPracticable("base:" + s) else { continue }
            seen.insert(s)
            out.append(c)
        }
        return out
    }

    @discardableResult public func resultRedo(_ chars: [JSValue]) throws -> Bool {
        let list = Self.redoCharsOf(chars)
        if list.isEmpty { return false }
        try router.push("redo", Self.p([("chars", .array(list))]))
        return true
    }

    // MARK: 其它入口

    /// openNonePage({exhausted})。
    public func openNone(exhausted: JSValue?) throws { try router.push("session-none", Self.p([("exhausted", .bool(JS.truthy(exhausted)))])) }

    /// openS02 的原生分支：推入确认框（chars = 旧组没写完的字）。
    public func openS02(chars: JSValue?) throws { try router.push("s02", Self.p([("chars", .array(chars?.arrayValue ?? []))])) }

    /// closeNativeQuery / closeNativeS02：栈顶是那一屏才出栈。
    public func closeTop(_ name: String) {
        if let top = snapTop, JS.isString(top["n"], name) { router.back() }
    }

    /// openQuery 的原生分支：推入查字屏（弹层的初始状态）。
    public func openQuery(mode: String, text: JSValue = .string(""), selected: JSValue = .array([]), composing: JSValue = .bool(false)) throws {
        let sel = (selected.arrayValue ?? []).filter { if case .string = $0 { return true }; return false }
        try router.push("query", Self.p([("mode", .string(mode)), ("text", text.stringValue.map(JSValue.string) ?? .string("")), ("selected", .array(sel)), ("composing", .bool(composing == .bool(true)))]))
    }

    public func openLibrarySwitch() throws { try router.push("library-switch", .object(JSObject())) }

    /// stage.under：顶层下面一页 {entryId, screen, native}。
    public func under(nativeOn: (String) -> Bool) -> JSValue {
        let under = router.stack.count >= 2 ? router.stack[router.stack.count - 2] : nil
        return Self.p([("ok", .bool(true)), ("entryId", under?["id"] ?? .null), ("screen", under?["n"] ?? .null),
                       ("native", .bool(under.flatMap { $0["n"]?.stringValue }.map(nativeOn) ?? false))])
    }

    /// shiziNativeNav back：顶层回到下层时怎么走（不消耗来源记录）。
    public func backPlan() -> JSValue {
        let top = router.stack.last, under = router.stack.count >= 2 ? router.stack[router.stack.count - 2] : nil
        return Self.p([("ok", .bool(top != nil)), ("plan", .object(paper.nativeBackPlan(top.map { .object($0) }, under.map { .object($0) }))), ("top", top?["n"] ?? .null)])
    }

    /// stage.cover {entryId, url?}：带图 = 这一条让开了（回到顶上时 via 'return'）。
    public func cover(entryId: JSValue?, url: JSValue?) -> JSValue {
        guard case .string(let id)? = entryId, !id.isEmpty else { return Self.p([("ok", .bool(false)), ("error", Self.p([("kind", .string("invalid"))]))]) }
        if case .string(let u)? = url, !u.isEmpty { state.screenAway.insert(id) }
        return Self.p([("ok", .bool(true))])
    }
}
