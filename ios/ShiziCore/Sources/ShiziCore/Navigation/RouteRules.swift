import Foundation

// B4.9a：导航层的纯规则（纯函数部分 + validPrefix；当年 JS 是参考实现并逐条核对过，D84 起 JS 已退役）。
//   routeStackOf / encodeRoute / parseRoute / routeFresh / RESTORE_GUARDS / planColdStart / validPrefix
// 屏名表（getScreen 的 tab 与否）见 NavScreens。

/// 已登记的屏（registerScreen 的那一份；App 引擎模式里全部登记）。
public struct NavScreens {
    public let tabs: [String]
    public let subs: [String]

    public init(tabs: [String], subs: [String]) { self.tabs = tabs; self.subs = subs }

    /// App 里登记的屏（tab 根按 order）。testHost：测试宿主多登记的开发屏。
    public static func app(testHost: Bool = false) -> NavScreens {
        NavScreens(tabs: ["home", "library", "mine"], subs: [
            "write", "redo", "result", "session-none", "s02", "query", "image-preview", "image-toast",
            "library-all", "library-switch", "library-list", "detail", "detail-photo",
            "records", "about", "about-privacy", "about-credits", "about-letter", "backup", "annual", "remind", "month", "block",
            "_demo/sub", "query-demo",
        ] + (testHost ? ["glyph-demo"] : []))
    }

    /// getScreen(name)：nil = 没登记；否则 def.tab。
    public func tab(_ name: String) -> Bool? {
        if tabs.contains(where: { jsEq($0, name) }) { return true }
        if subs.contains(where: { jsEq($0, name) }) { return false }
        return nil
    }
}

public enum RouteRules {
    public static let routeVersion = 1.0
    public static let maxRouteDepth = 16
    public static let maxRouteChars = 8192

    static func isPlainObject(_ v: JSValue?) -> Bool { if case .object? = v { return true }; return false }

    /// JS 属性读：只有对象有命名属性（数组 / 字符串 / 数字上的 'A' / 'id' 都是 undefined）。
    static func prop(_ v: JSValue?, _ key: String) -> JSValue? {
        guard case .object(let o)? = v else { return nil }
        return o[key]
    }

    /// routeStackOf：快照里的栈 → [{n, p}]（只取页面，遇到第一个不是页面的为止）。
    public static func routeStackOf(_ snap: JSValue?) -> JSValue {
        var out: [JSValue] = []
        let stack = prop(snap, "stack")?.arrayValue ?? []
        for e in stack {
            guard JS.truthy(e), JS.isString(prop(e, "k"), "s") else { break }
            let p = prop(e, "p")
            let pv: JSValue = (p.map { v -> Bool in if case .object = v { return true }; if case .array = v { return true }; return false } ?? false) ? p! : .object(JSObject())
            var o = JSObject()
            if let n = prop(e, "n") { o["n"] = n } // {n: undefined} 的 JSON 没有 n
            o["p"] = pv
            out.append(.object(o))
        }
        return .array(out)
    }

    /// encodeRoute：栈 + 时刻 → 原始字串；不合格返回 nil（不写）。
    public static func encodeRoute(_ stack: JSValue?, _ at: JSValue?) -> String? {
        guard let list = stack?.arrayValue, !list.isEmpty, list.count <= maxRouteDepth, case .number(let t)? = at, t.isFinite else { return nil }
        let raw = JSONWriter.stringify(.object(JSObject([("v", .number(routeVersion)), ("at", .number(JSMath.round(t))), ("stack", .array(list))])))
        return raw.utf16.count <= maxRouteChars ? raw : nil
    }

    /// parseRoute：原始字串 → {at, stack:[{n, p}]} | null。
    public static func parseRoute(_ raw: JSValue?) -> JSValue {
        guard case .string(let s)? = raw, !s.isEmpty, s.utf16.count <= maxRouteChars else { return .null }
        guard let value = try? JSONParser.parse(s), isPlainObject(value) else { return .null }
        guard case .number(let v)? = value["v"], v == routeVersion, case .number(let at)? = value["at"], at.isFinite else { return .null }
        guard let stack = value["stack"]?.arrayValue, !stack.isEmpty, stack.count <= maxRouteDepth else { return .null }
        var out: [JSValue] = []
        for e in stack {
            guard isPlainObject(e), case .string(let n)? = e["n"], !n.isEmpty, isPlainObject(e["p"]) else { return .null }
            out.append(.object(JSObject([("n", .string(n)), ("p", e["p"]!)])))
        }
        return .object(JSObject([("at", .number(at)), ("stack", .array(out))]))
    }

    /// routeFresh：离开时刻 at 到现在是否还在恢复窗口里（P108）。
    public static func routeFresh(_ at: JSValue?, _ now: JSValue?, policy: JSValue = Config.policy, dates: Dates) throws -> Bool {
        let cfg = JS.truthy(prop(policy, "routeRestore")) ? prop(policy, "routeRestore") : .object(JSObject())
        guard case .number(let a)? = at, a.isFinite, case .number(let n)? = now, n.isFinite else { return false }
        let maxMs = JS.numberOr0(prop(cfg, "maxAgeMinutes")) * 60 * 1000
        if abs(n - a) > maxMs { return false }
        if prop(cfg, "crossDay") != .bool(true), try !jsEq(dates.localDay(.number(a)), dates.localDay(.number(n))) { return false }
        return true
    }

    static func slotOf(_ p: JSValue?) -> String { JS.isString(prop(p, "slot"), "B") ? "B" : "A" }

    static func singleChar(_ v: JSValue?) -> Bool {
        guard case .string(let s)? = v else { return false }
        return s.unicodeScalars.count == 1
    }

    static func hasPhoto(_ state: JSValue?, _ char: String) -> Bool {
        guard let photos = prop(state, "photos"), case .object(let o) = photos, let v = o[char] else { return false }
        return JS.truthy(v)
    }

    /// 逐页有效性（RESTORE_GUARDS[name](p, ctx)；guard 抛错算不合格）。nil = 这一页没有 guard（恒可恢复）。
    public static func restoreGuard(_ name: String, _ p: JSValue?, state: JSValue?, now: Double, policy: JSValue = Config.policy, dates: Dates,
                                    lookup: (String) -> JSValue? = { DeckCards.shared.cardForKey($0) }) -> Bool? {
        switch name {
        case "write":
            guard let s = try? ScheduleRules(dates: dates).resumableSession(state, slot: slotOf(p), now: now, policy: policy) else { return false }
            return JS.truthy(s)
        case "result":
            guard case .string(let id)? = prop(p, "sessionId"), !id.isEmpty else { return false }
            let sessions = JS.truthy(state) ? prop(state, "sessions") : nil
            let slot = slotOf(p)
            let lastEnded = JS.truthy(sessions) ? (JS.truthy(prop(sessions, "lastEnded")) ? prop(sessions, "lastEnded") : .object(JSObject())) : .object(JSObject())
            let cur = JS.truthy(sessions) ? (JS.truthy(prop(sessions, slot)) ? prop(sessions, slot) : nil) : nil
            let ended = prop(lastEnded, slot)
            if JS.truthy(ended), JS.isString(prop(ended, "id"), id) { return true }
            if JS.truthy(cur), JS.isString(prop(cur, "id"), id) { return true }
            return false
        case "detail":
            let char = prop(p, "char")
            guard singleChar(char), let c = char?.stringValue else { return false }
            if JS.truthy(lookup("base:" + c)) { return true }
            let custom = JS.truthy(state) ? prop(state, "custom") : nil
            let added = JS.truthy(custom) ? (prop(custom, "added")?.arrayValue ?? []) : []
            if added.contains(where: { JS.truthy($0) && JS.isString(prop($0, "char"), c) }) { return true }
            if hasPhoto(state, c) { return true }
            return ScheduleRules.recordsOf(state).contains { JS.truthy($0) && JS.isString(prop($0, "char"), c) }
        case "detail-photo":
            let char = prop(p, "char")
            guard singleChar(char), let c = char?.stringValue else { return false }
            return hasPhoto(state, c)
        case "session-none", "redo":
            return false
        default:
            return nil
        }
    }

    /// planColdStart：冷启动判定。返回 {stack:[{n,p}]|null, reason}。
    public static func planColdStart(route: JSValue, state: JSValue?, blockReason: JSValue?, corrupt: Bool, deepLink: Bool, now: Double,
                                     policy: JSValue = Config.policy, screens: NavScreens, dates: Dates,
                                     lookup: (String) -> JSValue? = { DeckCards.shared.cardForKey($0) }) throws -> JSValue {
        func plan(_ stack: JSValue, _ reason: String) -> JSValue { .object(JSObject([("stack", stack), ("reason", .string(reason))])) }
        let cfg = JS.truthy(prop(policy, "routeRestore")) ? prop(policy, "routeRestore") : .object(JSObject())
        if prop(cfg, "enabled") != .bool(true) { return plan(.null, "disabled") }
        if !JS.truthy(route) { return plan(.null, "none") }
        if JS.truthy(blockReason) { return plan(.null, "blocked") }
        if corrupt { return plan(.null, "corrupt") }
        if deepLink { return plan(.null, "deep-link") }
        if try !routeFresh(prop(route, "at"), .number(now), policy: policy, dates: dates) { return plan(.null, "stale") }
        let stack = prop(route, "stack")?.arrayValue ?? []
        for (i, e) in stack.enumerated() {
            let n = JS.string(prop(e, "n"))
            let tab = prop(e, "n")?.stringValue.flatMap { screens.tab($0) }
            guard let isTab = tab, (i == 0) == isTab else { return plan(.null, "unknown-screen:" + n) }
            if let ok = restoreGuard(n, prop(e, "p"), state: state, now: now, policy: policy, dates: dates, lookup: lookup), !ok { return plan(.null, "invalid:" + n) }
        }
        return plan(.array(stack.map { .object(JSObject([("n", prop($0, "n") ?? .null), ("p", prop($0, "p") ?? .null)])) }), "ok")
    }

    /// 栈里从底往上第一页不合格之前的那一段（一页都不剩时留 tab 根）。
    public static func validPrefix(_ stack: [JSValue], state: JSValue?, now: Double, policy: JSValue = Config.policy, dates: Dates,
                                   lookup: (String) -> JSValue? = { DeckCards.shared.cardForKey($0) }) -> [JSValue] {
        var out: [JSValue] = []
        for e in stack {
            if let name = prop(e, "n")?.stringValue, let ok = restoreGuard(name, prop(e, "p"), state: state, now: now, policy: policy, dates: dates, lookup: lookup), !ok { break }
            out.append(e)
        }
        return out.isEmpty ? Array(stack.prefix(1)) : out
    }
}
