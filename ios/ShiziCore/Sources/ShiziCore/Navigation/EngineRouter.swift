import Foundation

// B4.9a：引擎的导航镜像（src/ui/engine.js createEngineRouter 的 Swift 版；同一套改栈语义 push / replace / pop / tab / params / restore）。
// 真相仍在原生 NativeStage 的栈：原生发起的导航 apply(intent, origin: native) 只记账、回宿主消息；「去哪」的规则（首页主按钮、结果页离开……）
// 发起的 request(intent) 记上之后把 {op:'nav', …} 交给 post（原生照做、存栈），宿主消息紧跟着交给 deliver。
// 来源记账（planPaper / noteNativePlan）在 PaperPlanner；宿主消息（hostBodies）由 hosts 回调算。

public struct NavError: Error, CustomStringConvertible {
    public let description: String
    init(_ s: String) { description = s }
}

public struct HostBody {
    public var type: String
    public var body: JSValue
    /// 重写错字页的 redo-open：回包延后求值（App），求出来不是 ok 时丢掉这条、退回去（与网页页面同样，见 HostBodies.redoOpen）。
    public var redoGuard = false
    public init(type: String, body: JSValue) { self.type = type; self.body = body }
}

public final class EngineRouter {
    public typealias Hosts = (_ prev: JSObject, _ next: JSObject, _ transition: JSValue, _ origin: String) -> [HostBody]

    public private(set) var stack: [JSObject] = []
    private var idCounter = 0.0
    private var seq = 0.0
    public private(set) var navSeq = 0.0
    private var transition: JSValue = .null
    /// JS（Swift 规则）发给原生的导航意图序号。
    public private(set) var jsSeq = 0.0
    private var listeners: [UUID: (JSObject) -> Void] = [:]

    public let screens: NavScreens
    public let paper: PaperPlanner
    public let defaultTab: String
    public var hosts: Hosts = { _, _, _, _ in [] }
    /// JS 发起的导航（{op:'nav', kind, seq, entry?, animate?, cause?, patch?}）交给原生。
    public var post: (JSObject) -> Void = { _ in }
    /// 宿主消息交给原生（按序）。
    public var deliver: ([HostBody]) -> Void = { _ in }
    /// 原生发起的导航：订阅者（路由提示写入是一次同步落库）推迟到转场之后（engine.js NATIVE_EMIT_DELAY_MS）；nil = 立即。
    public var deferNativeEmit: ((@escaping () -> Void) -> Void)?

    public init(screens: NavScreens, paper: PaperPlanner, defaultTab: String = "home") {
        self.screens = screens
        self.paper = paper
        self.defaultTab = defaultTab
    }

    // MARK: 条目

    public func nextId() -> String {
        idCounter += 1
        return "e" + JSNumber.toString(idCounter)
    }

    private func bump(_ entries: [JSObject]) {
        for e in entries {
            guard let id = e["id"]?.stringValue, id.hasPrefix("e") else { continue }
            let digits = id.dropFirst()
            guard !digits.isEmpty, digits.unicodeScalars.allSatisfy({ ("0"..."9").contains($0) }) else { continue }
            idCounter = max(idCounter, Double(String(digits)) ?? 0)
        }
    }

    static func plainParams(_ p: JSValue?) -> JSObject { p?.objectValue ?? JSObject() }

    /// entriesOf：[{id?, n, p}] → 镜像条目；第一条必须是 tab 根、其余是已登记的子页；不合格（一条都没有）返回 nil。
    func entriesOf(_ list: JSValue?) -> [JSObject]? {
        guard let items = list?.arrayValue, !items.isEmpty else { return nil }
        var out: [JSObject] = []
        for (i, e) in items.enumerated() {
            guard JS.truthy(e), case .string(let n)? = e["n"], let tab = screens.tab(n), (i == 0) == tab else { break }
            let id: String = { if case .string(let s)? = e["id"], !s.isEmpty { return s }; return nextId() }()
            out.append(JSObject([("k", .string("s")), ("id", .string(id)), ("n", .string(n)), ("p", .object(Self.plainParams(e["p"])))]))
        }
        return out.isEmpty ? nil : out
    }

    // MARK: 快照

    public var top: JSObject? { stack.last }

    public func snapshot() -> JSObject {
        JSObject([
            ("stack", .array(stack.map { .object($0) })),
            ("depth", .number(Double(max(0, stack.count - 1)))),
            ("tab", stack.first?["n"] ?? .null),
            ("top", stack.last.map { .object($0) } ?? .null),
            ("topIsOverlay", .bool(false)),
            ("transition", transition),
            ("navSeq", .number(navSeq)),
            ("pending", .bool(false)),
        ])
    }

    @discardableResult public func subscribe(_ fn: @escaping (JSObject) -> Void) -> () -> Void {
        let id = UUID()
        listeners[id] = fn
        return { [weak self] in self?.listeners[id] = nil }
    }

    private func emit() {
        let snap = snapshot()
        for fn in listeners.values { fn(snap) }
    }

    private func setTransition(_ kind: String, animate: Bool, cause: JSValue, from: JSObject?, to: JSObject?, cold: Bool = false) {
        seq += 1
        var t = JSObject([("seq", .number(seq)), ("kind", .string(kind)), ("animate", .bool(animate)), ("cause", cause),
                          ("from", from.map { .object($0) } ?? .null), ("to", to.map { .object($0) } ?? .null)])
        if cold { t["cold"] = .bool(true) }
        transition = .object(t)
    }

    /// 来源记账（engine.js account）：进写字页的计划随 open 交给原生；返回时删来源。
    private func account(_ t: JSValue) {
        guard JS.truthy(t["from"]), JS.truthy(t["to"]) else { return }
        let kind = t["kind"]?.stringValue ?? ""
        if !(jsEq(t["to"]?["n"]?.stringValue, "write") && (kind == "push" || kind == "replace")) { paper.forgetTap() }
        guard kind == "push" || kind == "replace" || kind == "pop" else { return }
        let under = stack.count >= 2 ? stack[stack.count - 2] : nil
        let underId = under?["id"]?.stringValue
        let plan = paper.planPaper(t, underId: underId, nativeTap: kind == "replace")
        if kind != "pop" { paper.noteNativePlan(JS.string(t["to"]?["id"]), plan) }
    }

    /// 改栈。intent: {kind:'push', entry} {kind:'replace', entry, animate} {kind:'pop', cause} {kind:'tab', entry} {kind:'params', patch}
    /// {kind:'restore', stack, cold?, silent?}。返回宿主消息；改不了返回 nil。
    public func apply(_ intent: JSObject, origin: String = "js") -> [HostBody]? {
        let prev = snapshot()
        let from = top
        let kind = intent["kind"]?.stringValue ?? ""
        let cause: JSValue = JS.truthy(intent["cause"]) ? intent["cause"]! : .string("ui")
        switch kind {
        case "push":
            guard let entry = intent["entry"]?.objectValue else { return nil }
            stack.append(entry)
            setTransition("push", animate: true, cause: cause, from: from, to: entry)
        case "replace":
            guard stack.count >= 2, let entry = intent["entry"]?.objectValue else { return nil }
            stack[stack.count - 1] = entry
            setTransition("replace", animate: JS.truthy(intent["animate"]), cause: .string("ui"), from: from, to: entry)
        case "pop":
            guard stack.count >= 2 else { return nil }
            stack.removeLast()
            setTransition("pop", animate: !JS.isString(intent["cause"], "native"), cause: cause, from: from, to: top)
        case "tab":
            guard let entry = intent["entry"]?.objectValue else { return nil }
            if stack.count == 1, jsEq(stack[0]["n"]?.stringValue, entry["n"]?.stringValue) { return [] }
            stack = [entry]
            setTransition("tab", animate: false, cause: .string("ui"), from: from, to: entry)
        case "params":
            guard var entry = top else { return [] }
            var p = Self.plainParams(entry["p"])
            for (k, v) in Self.plainParams(intent["patch"]).entries { p[k] = v }
            entry["p"] = .object(p)
            stack[stack.count - 1] = entry
            if case .object(var t) = transition, JS.isString(t["to"]?["id"], JS.string(entry["id"])) {
                t["to"] = .object(entry)
                transition = .object(t)
            }
            emit()
            return []
        case "restore":
            guard let entries = entriesOf(intent["stack"]) else { return nil }
            bump(entries)
            stack = entries
            setTransition("none", animate: false, cause: .string("restore"), from: from, to: top, cold: JS.truthy(intent["cold"]))
        default:
            return nil
        }
        navSeq += 1
        if kind != "restore" { account(transition) }
        let next = snapshot()
        let bodies = JS.truthy(intent["silent"]) ? [] : hosts(prev, next, transition, origin)
        if origin == "native", let later = deferNativeEmit { later { [weak self] in self?.emit() } } else { emit() }
        return bodies
    }

    /// JS 发起（Swift 里「去哪」的规则）：本地记上，告诉原生去哪，宿主消息紧跟着交出去。
    @discardableResult func request(_ intent: JSObject) -> Bool {
        guard let bodies = apply(intent, origin: "js") else { return false }
        jsSeq += 1
        let kind = intent["kind"]?.stringValue ?? ""
        var wire = JSObject([("op", .string("nav")), ("kind", .string(kind)), ("seq", .number(jsSeq))])
        if let e = intent["entry"]?.objectValue { wire["entry"] = .object(JSObject([("id", e["id"] ?? .null), ("n", e["n"] ?? .null), ("p", e["p"] ?? .null)])) }
        if kind == "replace" { wire["animate"] = .bool(JS.truthy(intent["animate"])) }
        if kind == "pop" { wire["cause"] = JS.truthy(intent["cause"]) ? intent["cause"]! : .string("ui") }
        if kind == "params" { wire["patch"] = intent["patch"] ?? .null }
        post(wire)
        deliver(bodies)
        return true
    }

    // MARK: 接口（与网页路由同名）

    static func plain(_ e: JSObject) -> JSValue { .object(JSObject([("id", e["id"] ?? .null), ("n", e["n"] ?? .null), ("p", e["p"] ?? .null)])) }

    /// 冷启动（route.plan）/ 页面重载后对齐（stage.resync）。
    public func start(_ list: JSValue?, cold: Bool = false, silent: Bool = false) -> (stack: [JSValue], bodies: [HostBody]) {
        let fallback = JSValue.array([.object(JSObject([("n", .string(defaultTab)), ("p", .object(JSObject()))]))])
        let want: JSValue = (list?.arrayValue.map { !$0.isEmpty } ?? false) ? list! : fallback
        var bodies = apply(JSObject([("kind", .string("restore")), ("stack", want), ("cold", .bool(cold)), ("silent", .bool(silent))]))
        if bodies == nil { bodies = apply(JSObject([("kind", .string("restore")), ("stack", fallback), ("cold", .bool(false)), ("silent", .bool(silent))])) ?? [] }
        return (stack.map(Self.plain), bodies ?? [])
    }

    /// 原生存栈（route.save）：以原生的栈为准。返回是否有变。
    @discardableResult public func adopt(_ list: JSValue?, seq: JSValue? = nil) -> Bool {
        if case .number(let s)? = seq, s.isFinite, s < jsSeq { return false }
        guard let entries = entriesOf(list) else { return false }
        let same = entries.count == stack.count && zip(entries, stack).allSatisfy { a, b in
            jsEq(a["id"]?.stringValue, b["id"]?.stringValue) && jsEq(a["n"]?.stringValue, b["n"]?.stringValue)
                && JSONWriter.stringify(a["p"] ?? .null) == JSONWriter.stringify(b["p"] ?? .null)
        }
        if same { return false }
        bump(entries)
        stack = entries
        navSeq += 1
        emit()
        return true
    }

    public var canGoBack: Bool { stack.count > 1 }

    public func push(_ name: String, _ params: JSValue = .object(JSObject())) throws {
        guard let tab = screens.tab(name) else { throw NavError("router.push: unknown screen \"\(name)\"") }
        if tab { try switchTab(name); return }
        request(JSObject([("kind", .string("push")), ("entry", .object(JSObject([("k", .string("s")), ("id", .string(nextId())), ("n", .string(name)), ("p", .object(Self.plainParams(params)))])))]))
    }

    public func replace(_ name: String, _ params: JSValue = .object(JSObject()), animate: Bool = false) throws {
        guard screens.tab(name) == false else { throw NavError("router.replace: \"\(name)\" is not a registered sub screen") }
        guard stack.count >= 2 else { throw NavError("router.replace: top entry is not a sub screen") }
        request(JSObject([("kind", .string("replace")), ("entry", .object(JSObject([("k", .string("s")), ("id", .string(nextId())), ("n", .string(name)), ("p", .object(Self.plainParams(params)))]))), ("animate", .bool(animate))]))
    }

    public func setParams(_ patch: JSValue) {
        request(JSObject([("kind", .string("params")), ("patch", .object(Self.plainParams(patch)))]))
    }

    @discardableResult public func back(cause: String = "ui") -> Bool {
        guard stack.count >= 2 else { return false }
        request(JSObject([("kind", .string("pop")), ("cause", .string(cause))]))
        return true
    }

    public func switchTab(_ name: String) throws {
        guard screens.tab(name) == true else { throw NavError("router.switchTab: \"\(name)\" is not a registered tab screen") }
        if stack.count == 1, jsEq(stack[0]["n"]?.stringValue, name) { return }
        request(JSObject([("kind", .string("tab")), ("entry", .object(JSObject([("k", .string("s")), ("id", .string(nextId())), ("n", .string(name)), ("p", .object(JSObject()))])))]))
    }
}
