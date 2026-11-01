import Foundation

extension ResultAPI {
    static func acceptedOf(_ store: Store) throws -> JSValue {
        let remind = store.state["settings"]?["remind"]
        let hour = SessionWrites.integer(remind?["hour"]) ? remind!["hour"]! : .number(20)
        let minute = SessionWrites.integer(remind?["minute"]) ? remind!["minute"]! : .number(30)
        return JS.obj([("text", try Copy.t("X-INVITE.accepted", JSObject([("time", .string(FirstResult.inviteTimeText(hour, minute)))]))), ("hour", hour), ("minute", minute)])
    }
    static func permissionOf(_ store: Store) -> String { store.state["settings"]?["remind"]?["permission"]?.stringValue ?? "unknown" }
    nonisolated(nonsending) static func settledPermission(_ store: Store, requested: Bool, waitMs: Double) async -> String {
        let now = permissionOf(store)
        if !requested || now != "unknown" { return now }
        return await withCheckedContinuation { continuation in
            let pending = PermissionSettlement(continuation)
            let timer = DispatchWorkItem { pending.finish(permissionOf(store)) }
            pending.timer = timer
            pending.off = store.subscribe { _,_ in
                let p = permissionOf(store)
                if p != "unknown" { pending.finish(p) }
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + max(0, waitMs.isFinite ? waitMs : 0) / 1000, execute: timer)
        }
    }
    nonisolated(nonsending) static func inviteAsync(_ store: Store, _ a: JSObject, dependencies d: WriteDependencies?) async throws -> JSValue {
        let action = JS.string(a["action"])
        if action == "shown" || action == "no" { return try call("resultInvite", store, a, dependencies: d) }
        if action == "time" {
            let h = JS.number(a["hour"]).rounded(.towardZero), m = JS.number(a["minute"]).rounded(.towardZero)
            guard h >= 0 && h < 24 && m >= 0 && m < 60, let change = d?.reminderChangeTime else { return SessionWrites.failure("invalid") }
            let r: JSValue
            do { r = try await change(store, JSObject([("hour", .number(h)), ("minute", .number(m))])) } catch { r = JS.obj([("ok", .bool(false))]) }
            let ok = JS.truthy(r) && r["ok"] != .bool(false)
            return try SessionWrites.patch(ok ? JS.obj([("ok", .bool(true))]) : WriteAPI.plain(r), acceptedOf(store).objectValue!.entries.map { ($0.key,$0.value) })
        }
        guard action == "yes", let inviteHost = d?.reminderInvite else { return SessionWrites.failure("invalid") }
        let r: JSValue
        do { r = try await inviteHost(store, FirstResult.inviteTime(store.now(), dates: store.dates).objectValue!) } catch { r = JS.obj([("ok", .bool(false))]) }
        if !JS.truthy(r) || r["ok"] == .bool(false) { return SessionWrites.patch(WriteAPI.plain(r), [("phase", .string("failed"))]) }
        var answer = a; answer["action"] = .string("yes"); _ = invite(store, answer)
        let permission = await settledPermission(store, requested: JS.truthy(r["requested"]), waitMs: d?.reminderWaitMs ?? 120000)
        if permission == "denied" {
            answer["action"] = .string("denied"); _ = invite(store, answer)
            return JS.obj([("ok", .bool(true)), ("phase", .string("denied")), ("text", try Copy.t("X-INVITE.denied"))])
        }
        return SessionWrites.patch(JS.obj([("ok", .bool(true)), ("phase", .string("accepted"))]), try acceptedOf(store).objectValue!.entries.map { ($0.key,$0.value) })
    }
}

/// Exactly one permission or timeout reply; the listener and timeout are retired together.
private final class PermissionSettlement {
    let lock = NSLock()
    var continuation: CheckedContinuation<String, Never>?
    var off: (() -> Void)?
    var timer: DispatchWorkItem?
    init(_ continuation: CheckedContinuation<String, Never>) { self.continuation = continuation }
    func finish(_ permission: String) {
        lock.lock()
        guard let c = continuation else { lock.unlock(); return }
        continuation = nil
        let unsubscribe = off; off = nil; timer?.cancel(); timer = nil
        lock.unlock()
        unsubscribe?(); c.resume(returning: permission)
    }
}

extension WriteAPI {
    nonisolated(nonsending) public static func callAsync(_ op: String, _ store: Store, _ args: JSObject, dependencies: WriteDependencies? = nil) async -> JSValue {
        guard op == "resultInvite" || (op == "refLabel" && dependencies?.refLabelAsync != nil) else { return call(op, store, args, dependencies: dependencies) }
        do {
            if op == "refLabel", let f = dependencies?.refLabelAsync {
                guard let char = args["char"]?.stringValue, !char.isEmpty else { return SessionWrites.failure("invalid") }
                let v = try await f(JSObject([("char", .string(char)), ("cardKey", args["cardKey"]?.stringValue.map(JSValue.string) ?? .null)]))
                return JS.obj([("ok", .bool(true)), ("label", .string(JS.truthy(v) ? JS.string(v) : ""))])
            }
            return try await ResultAPI.inviteAsync(store, args, dependencies: dependencies)
        }
        catch let e as CoreError { return JS.obj([("ok", .bool(false)), ("error", JS.obj([("kind", .string("exception")), ("reason", .string(e.message))]))]) }
        catch { return SessionWrites.failure("exception") }
    }
}
