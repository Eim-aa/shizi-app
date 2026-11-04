import Foundation

// B4.9a：宿主消息（hostBodies + 各页的消息构造：writeOpenBody / writeCloseBody / redoOpenBody / redoCloseBody /
// resultOpenBody / resultCloseBody、screenOpenMessage / nativeRunBelow）。新旧两个栈 → 给原生的 open / close / result-open …，
// 消息格式与原来一字不差（原生两条通道的处理不变）。会话 API 与视图回包、时钟、平台量值由 HostIO 给（测试用桩，App 用 SwiftEngine）。

public protocol HostIO: AnyObject {
    /// 原生有没有这一屏的类（nativeScreenOn）。
    func nativeOn(_ name: String) -> Bool
    /// 写字会话 API（open / redoOpen / result / resultLook）。
    func api(_ op: String, _ args: JSObject) -> JSValue
    /// 视图回包（viewPayload：view.<name>，带页面宽与大字号档）。
    func view(_ name: String, _ params: JSValue?) -> JSValue
    /// 这一屏的视图回包在 JS 里是异步的（Promise：nativeRunBelow 带视图时不带它）。
    func viewAsync(_ name: String) -> Bool
    /// Date.now()（消息的 sentAt）。
    func now() -> Double
    /// 写字页交接来的跳过撤销（takeSkipUndo，取一次即清）。
    func undo(_ slot: String, _ sessionId: String) -> JSValue
    /// 结果条目离开栈：清 lastEnded[slot]（commitLeave）。
    func leave(_ slot: String, _ sessionId: String)
    func width() -> JSValue
    func ax() -> JSValue
    /// 重写错字页没有能练的字：退回去（nav.back）。
    func back()
    /// 回包的 ok；nil = 还没算（App 里回包延后求值，见 HostBody.redoGuard）。
    func isOk(_ v: JSValue) -> Bool?
}

/// 宿主状态（JS 里散在模块里的三份）：让开过的结果条目、stage.cover 过的原生屏条目、为字详情让开的写字条目。
public final class HostState {
    public var resultAway = Set<String>()
    public var screenAway = Set<String>()
    public var writeAway: String?
    public init() {}
    /// takeAway(entryId)：stage.cover 过的条目回到顶上（取一次即清）。
    public func takeAway(_ id: String) -> Bool { screenAway.remove(id) != nil }
    /// takeWriteAway(entryId)。
    public func takeWriteAway(_ id: String) -> Bool {
        guard let w = writeAway, jsEq(w, id) else { return false }
        writeAway = nil
        return true
    }
}

public enum HostBodies {
    static func str(_ v: JSValue?) -> String? { v?.stringValue }
    static func id(_ e: JSObject?) -> JSValue { e?["id"] ?? .null }
    static func slotOf(_ e: JSObject?) -> String { JS.isString(e?["p"]?["slot"], "B") ? "B" : "A" }
    static func pages(_ snap: JSObject?) -> [JSObject] { (snap?["stack"]?.arrayValue ?? []).compactMap { $0.objectValue }.filter { JS.isString($0["k"], "s") } }

    public static func hostKind(_ name: String?, _ io: HostIO) -> String? {
        guard let name else { return nil }
        if jsEq(name, "write") { return "write" }
        if jsEq(name, "redo") { return "redo" }
        if jsEq(name, "result") { return "result" }
        return io.nativeOn(name) ? "screen" : nil
    }

    static func transitionTargets(_ tr: JSValue?, _ entry: JSObject?) -> Bool {
        guard let tr, JS.truthy(tr), JS.truthy(tr["to"]), let entry else { return false }
        return JS.strictEquals(tr["to"]?["id"], entry["id"]) && JS.truthy(tr["animate"]) && !JS.truthy(tr["cold"])
    }

    // MARK: 写字 / 重写错字 / 结果（nativeWrite 通道）

    public static func writeOpen(_ entry: JSObject, _ snap: JSObject, returning: Bool, io: HostIO, paper: PaperPlanner) -> JSValue {
        let slot = slotOf(entry)
        if returning {
            let again = io.api("open", JSObject([("slot", .string(slot))]))
            return .object(JSObject([("op", .string("open")), ("slot", .string(slot)), ("entryId", id(entry)), ("animate", .bool(false)), ("via", .string("return")),
                                     ("sentAt", .number(io.now())), ("payload", again)]))
        }
        let tr = snap["transition"]
        let animate = transitionTargets(tr, entry)
        let plan = paper.nativePlanOf(JS.string(entry["id"]))
        let replaced = JS.truthy(tr) && JS.isString(tr?["kind"], "replace") && JS.truthy(tr?["from"]) && JS.isString(tr?["from"]?["n"], "result")
        let mode = plan["mode"]
        let via = !animate ? "restore" : replaced ? "again" : mode == .string("paper") ? "home" : mode == .string("quiet") ? "quiet" : "push"
        let opened = io.api("open", JSObject([("slot", .string(slot))]))
        return .object(JSObject([("op", .string("open")), ("slot", .string(slot)), ("entryId", id(entry)), ("animate", .bool(animate)), ("via", .string(via)),
                                 ("plan", plan), ("sentAt", .number(io.now())), ("payload", opened)]))
    }

    public static func writeClose(_ entry: JSObject) -> JSValue {
        .object(JSObject([("op", .string("close")), ("slot", .string(slotOf(entry))), ("entryId", id(entry))]))
    }

    /// redoOpenBody：没有能练的字时与网页页面同样退回去（nil）；App 里回包延后求值时由 HostBody.redoGuard 收尾。
    public static func redoOpen(_ entry: JSObject, _ snap: JSObject, io: HostIO) -> (body: JSValue, guarded: Bool)? {
        let animate = transitionTargets(snap["transition"], entry)
        var args = JSObject()
        if let chars = entry["p"]?["chars"] { args["chars"] = chars }
        let opened = io.api("redoOpen", args)
        var guarded = false
        if let ok = io.isOk(opened) {
            if !ok { io.back(); return nil }
        } else { guarded = true }
        return (.object(JSObject([("op", .string("redo-open")), ("entryId", id(entry)), ("animate", .bool(animate)), ("via", .string(animate ? "push" : "restore")),
                                  ("sentAt", .number(io.now())), ("payload", opened)])), guarded)
    }

    public static func redoClose(_ entry: JSObject) -> JSValue { .object(JSObject([("op", .string("redo-close")), ("entryId", id(entry))])) }

    static func sessionIdOf(_ entry: JSObject) -> String { entry["p"]?["sessionId"]?.stringValue ?? "" }

    public static func resultOpen(_ entry: JSObject, _ snap: JSObject, returning: Bool, io: HostIO) -> JSValue {
        let slot = slotOf(entry), sessionId = sessionIdOf(entry)
        let tr = snap["transition"]
        let fromWrite = JS.truthy(tr) && JS.truthy(tr?["from"]) && JS.isString(tr?["from"]?["n"], "write")
        let restore = !returning && JS.truthy(tr) && (JS.truthy(tr?["cold"]) || JS.isString(tr?["cause"], "restore") || JS.isString(tr?["cause"], "start") || !JS.truthy(tr?["animate"])) && !fromWrite
        let via = returning ? "return" : restore ? "restore" : fromWrite ? "write" : "push"
        let undo = io.undo(slot, sessionId)
        let look = io.api("resultLook", JSObject())
        let opened = io.api("result", JSObject([("slot", .string(slot)), ("sessionId", .string(sessionId)), ("width", io.width()), ("ax", io.ax()), ("undo", undo)]))
        return .object(JSObject([("op", .string("result-open")), ("slot", .string(slot)), ("sessionId", .string(sessionId)), ("entryId", id(entry)), ("animate", .bool(!restore)),
                                 ("via", .string(via)), ("sentAt", .number(io.now())), ("look", look), ("payload", opened)]))
    }

    public static func resultClose(_ entry: JSObject, away: Bool, io: HostIO) -> JSValue {
        let slot = slotOf(entry), sessionId = sessionIdOf(entry)
        if !away { io.leave(slot, sessionId) }
        return .object(JSObject([("op", .string("result-close")), ("slot", .string(slot)), ("sessionId", .string(sessionId)), ("entryId", id(entry)), ("away", .bool(away))]))
    }

    // MARK: 通用原生屏（native 通道）

    static func underOf(_ snap: JSObject, _ entryId: JSValue) -> JSObject? {
        let ps = pages(snap)
        guard let i = ps.firstIndex(where: { JS.strictEquals($0["id"], entryId) }), i > 0 else { return nil }
        return ps[i - 1]
    }

    static func isRoot(_ snap: JSObject, _ entryId: JSValue) -> Bool {
        guard let first = snap["stack"]?.arrayValue?.first else { return false }
        return JS.strictEquals(first["id"], entryId)
    }

    /// nativeRunBelow：这一条下面连续的原生宿主条目（底 → 顶，不含自己、不含 tab 根）。
    public static func runBelow(_ snap: JSObject, _ entryId: JSValue, withViews: Bool, io: HostIO) -> JSValue {
        let ps = pages(snap)
        let i = ps.firstIndex(where: { JS.strictEquals($0["id"], entryId) }) ?? -1
        var out: [JSValue] = []
        var j = i - 1
        while j >= 1 {
            let e = ps[j]
            guard let n = e["n"]?.stringValue, io.nativeOn(n) else { break }
            var item = JSObject([("entryId", e["id"] ?? .null), ("screen", e["n"] ?? .null), ("params", JS.truthy(e["p"]) ? e["p"]! : .object(JSObject()))])
            if withViews {
                let p = io.view(n, e["p"])
                if !io.viewAsync(n) { item["payload"] = p }
            }
            out.insert(.object(item), at: 0)
            j -= 1
        }
        return .array(out)
    }

    public static func screenOpen(_ entry: JSObject, _ snap: JSObject, returning: Bool, io: HostIO, paper: PaperPlanner) -> JSValue {
        let name = entry["n"]?.stringValue ?? ""
        let eid = id(entry)
        let params: JSValue = JS.truthy(entry["p"]) ? entry["p"]! : .object(JSObject())
        let under = underOf(snap, eid)
        let root = isRoot(snap, eid)
        var msg = JSObject([("op", .string("open")), ("screen", entry["n"] ?? .null), ("entryId", eid), ("params", params),
                            ("underId", under?["id"] ?? .null), ("underScreen", under?["n"] ?? .null), ("sentAt", .number(io.now()))])
        if root { msg["root"] = .bool(true); msg["covered"] = .bool(false) }
        if returning {
            msg["via"] = .string("return")
            msg["plan"] = .null
            msg["run"] = root ? .array([]) : runBelow(snap, eid, withViews: true, io: io)
        } else {
            let tr = snap["transition"]
            let animate = transitionTargets(tr, entry)
            let plan = paper.nativePlanOf(JS.string(eid))
            let via = !animate ? "restore" : JS.isString(tr?["kind"], "replace") ? "replace" : plan["mode"] == .string("quiet") ? "quiet" : "push"
            msg["via"] = .string(via)
            msg["plan"] = plan
            msg["run"] = runBelow(snap, eid, withViews: false, io: io)
        }
        msg["payload"] = io.view(name, params)
        return .object(msg)
    }

    // MARK: 新旧两个栈 → 消息

    /// hostBodies(prev, next, tr)：先卸后挂（离开栈的、被盖住的结果页、新进来的、回到顶上的）。
    public static func bodies(_ prev: JSObject, _ next: JSObject, io: HostIO, state: HostState, paper: PaperPlanner) -> [HostBody] {
        var out: [HostBody] = []
        let before = (prev["stack"]?.arrayValue ?? []).compactMap { $0.objectValue }
        let after = (next["stack"]?.arrayValue ?? []).compactMap { $0.objectValue }
        let nextIds = Set(after.compactMap { $0["id"]?.stringValue })
        let prevIds = Set(before.compactMap { $0["id"]?.stringValue })
        func idOf(_ e: JSObject) -> String { JS.string(e["id"]) }
        // 1. 离开栈的（从上往下）
        for e in before.reversed() where !nextIds.contains(idOf(e)) {
            let kind = hostKind(e["n"]?.stringValue, io)
            state.resultAway.remove(idOf(e))
            _ = state.takeAway(idOf(e))
            switch kind {
            case "write": out.append(HostBody(type: "nativeWrite", body: writeClose(e)))
            case "redo": out.append(HostBody(type: "nativeWrite", body: redoClose(e)))
            case "result": out.append(HostBody(type: "nativeWrite", body: resultClose(e, away: false, io: io)))
            case "screen": out.append(HostBody(type: "native", body: .object(JSObject([("op", .string("close")), ("screen", e["n"] ?? .null), ("entryId", e["id"] ?? .null)]))))
            default: break
            }
        }
        // 2. 原来的顶层被盖住（结果页让开）
        let oldTop = before.last, newTop = after.last
        if let oldTop, let newTop, idOf(oldTop) != idOf(newTop), nextIds.contains(idOf(oldTop)), hostKind(oldTop["n"]?.stringValue, io) == "result" {
            state.resultAway.insert(idOf(oldTop))
            out.append(HostBody(type: "nativeWrite", body: resultClose(oldTop, away: true, io: io)))
        }
        // 3. 新进来的（从下往上）
        for e in after where !prevIds.contains(idOf(e)) {
            switch hostKind(e["n"]?.stringValue, io) {
            case "write": out.append(HostBody(type: "nativeWrite", body: writeOpen(e, next, returning: false, io: io, paper: paper)))
            case "redo":
                if let r = redoOpen(e, next, io: io) {
                    var b = HostBody(type: "nativeWrite", body: r.body)
                    b.redoGuard = r.guarded
                    out.append(b)
                }
            case "result":
                if let newTop, idOf(newTop) == idOf(e) { out.append(HostBody(type: "nativeWrite", body: resultOpen(e, next, returning: false, io: io))) }
                else { state.resultAway.insert(idOf(e)) } // 冷启动恢复出的、上面还压着页的结果条目：回到顶上时再请原生
            case "screen": out.append(HostBody(type: "native", body: screenOpen(e, next, returning: false, io: io, paper: paper)))
            default: break
            }
        }
        // 4. 回到顶上的
        if let newTop, prevIds.contains(idOf(newTop)), oldTop == nil || idOf(oldTop!) != idOf(newTop) {
            let kind = hostKind(newTop["n"]?.stringValue, io)
            if kind == "result", state.resultAway.contains(idOf(newTop)) {
                state.resultAway.remove(idOf(newTop))
                out.append(HostBody(type: "nativeWrite", body: resultOpen(newTop, next, returning: true, io: io)))
            } else if kind == "write", state.takeWriteAway(idOf(newTop)) {
                out.append(HostBody(type: "nativeWrite", body: writeOpen(newTop, next, returning: true, io: io, paper: paper)))
            } else if kind == "screen", state.takeAway(idOf(newTop)) {
                out.append(HostBody(type: "native", body: screenOpen(newTop, next, returning: true, io: io, paper: paper)))
            }
        }
        return out
    }
}
