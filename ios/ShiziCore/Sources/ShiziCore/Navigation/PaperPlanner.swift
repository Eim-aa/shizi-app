import Foundation

// B4.9a：写字页进出转场的来源记账（src/ui/paper-transition.js 引擎模式用到的那一半：没有 DOM，root = null）。
// 记的东西与 JS 同一份：pending（这次点按）、sources（下层页面 id → 来源 / PUSHED / QUIET）、nativeLive（原生入口此刻的位置）、
// nativePlans（宿主条目进来时的计划，最多 16 条）。D62：只有从首页（tab 根 home）页面上的元素进写字页才是纸展开 B1。
public final class PaperPlanner {
    enum Src { case quiet, pushed, source(JSObject) }

    private var pending: JSObject?
    private var sources: [String: Src] = [:]
    private var nativeLive: [String: JSObject] = [:]
    private var planKeys: [String] = []
    private var plans: [String: JSObject] = [:]
    /// performance.now 的对应物（来源 2s 内有效）。
    public var now: () -> Double
    public var freshMs: Double

    public init(now: @escaping () -> Double, policy: JSValue = Config.policy) {
        self.now = now
        freshMs = JS.number(policy["paperTransition"]?["sourceFreshMs"])
    }

    public func reset() { pending = nil; sources.removeAll(); nativeLive.removeAll(); planKeys.removeAll(); plans.removeAll() }

    static func gt0(_ v: JSValue?) -> Bool { JS.number(v) > 0 }

    static func rectCopy(_ r: JSValue?) -> JSObject {
        var o = JSObject()
        for k in ["x", "y", "w", "h"] { if let v = r?[k] { o[k] = v } }
        return o
    }

    static func liveKey(_ key: JSValue) -> String { JSONWriter.stringify(key) }

    /// markNativePaperSource({rect, label = '', radius = 12, solid = true, key = null})。
    public func markNativeSource(_ a: JSObject) {
        let rect = a["rect"]
        guard JS.truthy(rect), Self.gt0(rect?["w"]), Self.gt0(rect?["h"]) else { return }
        let solidRaw = a["solid"] ?? .bool(true)
        let label = a["label"] ?? .string("")
        let key = a["key"] ?? .null
        let r = Self.rectCopy(rect)
        let lab: JSValue = JS.truthy(solidRaw) ? .string(JS.truthy(label) ? JS.string(label) : "") : .string("")
        pending = JSObject([("el", .null), ("rect", .object(r)), ("label", lab), ("radius", a["radius"] ?? .number(12)), ("bg", .string("")), ("fg", .string("")),
                            ("solid", .bool(JS.truthy(solidRaw))), ("key", key), ("at", .number(now())), ("overlay", .bool(false))])
        if JS.truthy(key) { nativeLive[Self.liveKey(key)] = JSObject([("rect", .object(r)), ("label", lab)]) }
    }

    /// markNativeOverlayTap()：原生弹层上的点按（普通推入，不画纸）。
    public func markOverlayTap() {
        let zero = JSObject([("x", .number(0)), ("y", .number(0)), ("w", .number(0)), ("h", .number(0))])
        pending = JSObject([("el", .null), ("rect", .object(zero)), ("label", .string("")), ("radius", .number(0)), ("bg", .string("")), ("fg", .string("")),
                            ("solid", .bool(false)), ("key", .null), ("at", .number(now())), ("overlay", .bool(true))])
    }

    /// setNativeLiveSource(key, live)。
    public func setLive(_ key: JSValue, _ live: JSValue?) {
        guard JS.truthy(key) else { return }
        if let live, JS.truthy(live), JS.truthy(live["rect"]), Self.gt0(live["rect"]?["w"]), Self.gt0(live["rect"]?["h"]) {
            nativeLive[Self.liveKey(key)] = JSObject([("rect", .object(Self.rectCopy(live["rect"]))), ("label", .string(JS.truthy(live["label"]) ? JS.string(live["label"]) : ""))])
        } else {
            nativeLive[Self.liveKey(key)] = nil
        }
    }

    /// forgetTap()。
    public func forgetTap() { pending = nil }

    private func takePending() -> JSObject? {
        let p = pending
        pending = nil
        guard let p, now() - JS.number(p["at"]) <= freshMs else { return nil }
        return p
    }

    private static func id(_ e: JSValue?) -> String { JS.string(e?["id"]) }
    private static func name(_ e: JSValue?) -> String? { e?["n"]?.stringValue }

    /// planPaper(t, {reduced:false, root:null, underId, nativeTap})。
    func planPaper(_ t: JSValue, underId: String?, nativeTap: Bool) -> JSObject? {
        guard JS.truthy(t["from"]), JS.truthy(t["to"]) else { return nil }
        let kind = t["kind"]?.stringValue ?? ""
        let from = t["from"], to = t["to"]
        if kind == "push" || kind == "replace" {
            if !jsEq(Self.name(to), "write") || (kind == "replace" && jsEq(Self.name(from), "write")) {
                if kind == "push" {
                    sources[Self.id(from)] = nil
                    pending = nil
                }
                return nil
            }
            let src = takePending()
            if kind == "replace" {
                if src == nil && !nativeTap { return nil }
                if let underId, !underId.isEmpty { sources[underId] = .pushed }
                return JSObject([("mode", .string("S")), ("dir", .string("open"))])
            }
            if let src, !jsEq(Self.name(from), "home") || JS.truthy(src["overlay"]) {
                sources[Self.id(from)] = .pushed
                return nil
            }
            sources[Self.id(from)] = src.map { .source($0) } ?? .quiet
            if let src { return JSObject([("mode", .string("B1")), ("dir", .string("open")), ("source", .object(src))]) }
            return JSObject([("mode", .string("B3")), ("dir", .string("open"))])
        }
        if kind == "pop" {
            pending = nil
            if !jsEq(Self.name(from), "write") && !jsEq(Self.name(from), "result") { return nil }
            let had = sources[Self.id(to)]
            if jsEq(Self.name(from), "result") && had == nil { return nil }
            sources[Self.id(to)] = nil
            switch had {
            case .pushed?: return nil
            case nil, .quiet?: return JSObject([("mode", .string("B3")), ("dir", .string("close"))])
            case .source(let s)?: return JSObject([("mode", .string("B1")), ("dir", .string("close")), ("source", .object(liveSource(s)))])
            }
        }
        if kind == "tab" { pending = nil }
        return nil
    }

    /// liveSource（root = null）：原生报的此刻位置与字；没有就沿用记下的。
    private func liveSource(_ src: JSObject) -> JSObject {
        var out = src
        if !JS.truthy(src["el"]), JS.truthy(src["key"]), let live = nativeLive[Self.liveKey(src["key"]!)] {
            out["el"] = .null
            out["rect"] = .object(Self.rectCopy(live["rect"]))
            out["label"] = JS.truthy(src["solid"]) ? (JS.truthy(live["label"]) ? live["label"]! : src["label"] ?? .null) : .string("")
            out["gone"] = .bool(false)
            return out
        }
        out["gone"] = .bool(false)
        return out
    }

    /// planPaperDrag(top, under, root = null)。
    func planPaperDrag(_ top: JSValue?, _ under: JSValue?) -> JSObject? {
        guard JS.truthy(top), JS.truthy(under) else { return nil }
        let had = sources[Self.id(under)]
        if case .pushed? = had { return nil }
        var b1: JSObject?
        if case .source(let s)? = had { b1 = JSObject([("mode", .string("B1")), ("dir", .string("close")), ("drag", .bool(true)), ("source", .object(liveSource(s)))]) }
        let b3 = JSObject([("mode", .string("B3")), ("dir", .string("close")), ("drag", .bool(true))])
        if jsEq(Self.name(top), "write") { return b1 ?? b3 }
        if jsEq(Self.name(top), "result"), had != nil { return b1 ?? b3 }
        return nil
    }

    /// nativePlanShape(plan, underId, root = null)：{mode:'paper', source, panel:null} | {mode:'quiet'} | {mode:'push'}。
    static func shape(_ plan: JSObject?) -> JSObject {
        if let plan, plan["mode"] == .string("B1"), let s = plan["source"], JS.truthy(s) {
            var src = JSObject()
            src["rect"] = JS.truthy(s["rect"]) ? .object(rectCopy(s["rect"])) : .null
            if let r = s["radius"] { src["radius"] = r }
            src["label"] = JS.truthy(s["label"]) ? s["label"]! : .string("")
            src["bg"] = JS.truthy(s["bg"]) ? s["bg"]! : .string("")
            src["fg"] = JS.truthy(s["fg"]) ? s["fg"]! : .string("")
            src["solid"] = .bool(s["solid"] != .bool(false))
            src["gone"] = .bool(JS.truthy(s["gone"]))
            src["key"] = JS.truthy(s["key"]) ? s["key"]! : .null
            return JSObject([("mode", .string("paper")), ("source", .object(src)), ("panel", .null)])
        }
        if let plan, plan["mode"] == .string("B3") { return JSObject([("mode", .string("quiet"))]) }
        return JSObject([("mode", .string("push"))])
    }

    /// noteNativePlan(entryId, plan)。
    func noteNativePlan(_ entryId: String, _ plan: JSObject?) {
        guard !entryId.isEmpty else { return }
        if plans[entryId] == nil { planKeys.append(entryId) }
        plans[entryId] = Self.shape(plan)
        if planKeys.count > 16 { plans[planKeys.removeFirst()] = nil }
    }

    /// nativePlanOf(entryId)：宿主条目进来时的计划；没有记录时 null。
    public func nativePlanOf(_ entryId: String) -> JSValue { plans[entryId].map { .object($0) } ?? .null }

    /// nativeBackPlan(top, under)：原生页返回前问（不消耗来源记录）。
    public func nativeBackPlan(_ top: JSValue?, _ under: JSValue?) -> JSObject {
        guard JS.truthy(top), JS.truthy(under) else { return JSObject([("mode", .string("push"))]) }
        return Self.shape(planPaperDrag(top, under))
    }

    /// paperSourceOf(entryId)（诊断 / core-diff）。
    public func sourceOf(_ entryId: String) -> JSValue {
        switch sources[entryId] {
        case nil: return .null
        case .quiet?: return .object(JSObject([("quiet", .bool(true))]))
        case .pushed?: return .object(JSObject([("pushed", .bool(true))]))
        case .source(let s)?: return .object(JSObject([("rect", .object(Self.rectCopy(s["rect"]))), ("solid", s["solid"] ?? .null), ("key", s["key"] ?? .null)]))
        }
    }
}
