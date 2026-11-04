import Foundation

/// Reminder controller: platform delivery, debounce and cold-start queue are injected.
public final class ReminderController {
    public let store: Store
    public var deck: Reminder.Deck = .shared
    public var isNative: () -> Bool = { false }
    public var post: (String, JSValue) -> Bool = { _,_ in false }
    public var startPicked: (([JSValue], JSValue) -> JSValue)?
    public var applyStatus: ((Store, JSValue) -> JSValue)?
    public var schedule: ((Double, @escaping () -> Void) -> (() -> Void))?
    private var cancel: (() -> Void)?
    private var lastSent: String?
    public private(set) var sent: [JSValue] = []
    private var ready = false
    private var pending: [(Bool,JSValue)] = []
    public init(store: Store) { self.store = store }
    public func sync(remind: JSValue? = nil, force: Bool = false) -> JSValue? {
        let payload: JSValue
        do { payload = try Reminder.reminderPayload(.object(store.state),remind:remind,today:.string(store.dates.localDay(.number(store.now()))),now:.number(store.now()),deck:deck,dates:store.dates) } catch { return nil }
        let json = JSONWriter.stringify(payload)
        if !force && (lastSent == json || (lastSent == nil && !JS.truthy(payload["enabled"]))) { return nil }
        guard post("syncReminder",payload) else { return nil }
        lastSent = json;sent.append(payload);if sent.count > 20 { sent.removeFirst() };return payload
    }
    public func forget() { lastSent = nil }
    public func scheduleSync() {
        if !isNative() { return }
        cancel?();cancel = schedule?(300) { [weak self] in self?.cancel = nil;_ = self?.sync() }
    }
    public func queryStatus() -> Bool { post("queryReminderStatus",.object(JSObject())) }
    public func receiveStatus(_ payload: JSValue) -> JSValue? { applyStatus?(store,payload) }
    public func openTarget(_ raw: JSValue?) -> JSValue {
        guard let key = Reminder.normalizeTargetKey(raw),deck.practicable(key) else { return JS.obj([("ok",.bool(false)),("error",JS.obj([("kind",.string("invalid")),("reason",.string("target"))]))]) }
        let char = key.components(separatedBy:":").dropFirst().joined(separator:":")
        return startPicked?([.string(key)],JS.obj([("source",JS.obj([("view",.string("reminder")),("char",.string(char))]))])) ?? SessionWrites.failure("unavailable")
    }
    // Bridge adapter: only the last reminder target survives cold start; permission reports retain order.
    public func receiveTargetBeforeReady(_ raw: JSValue) { if ready { _ = openTarget(raw) } else { pending.removeAll { $0.0 };pending.append((true,raw)) } }
    public func receiveStatusBeforeReady(_ payload: JSValue) { if ready { _ = receiveStatus(payload) } else { pending.append((false,payload)) } }
    public func markReady() {
        ready = true
        let queue = pending;pending.removeAll()
        for (target,value) in queue { if target { _ = openTarget(value) } else { _ = receiveStatus(value) } }
    }
}

public enum ReminderInviteHost {
    public static func invite(_ store: Store, hour: JSValue, minute: JSValue, request: ((JSValue) -> Bool)? = nil, sync: ((JSValue) -> Void)? = nil) -> JSValue {
        let r = SettingsView.commitSettings(store,label:"settings:remind",fields:JSObject([("remind",JS.obj([("enabled",.bool(true)),("hour",hour),("minute",minute)]))]))
        if r["ok"] != .bool(true) { return r }
        let remind = SettingsView.settingsView(store.state["settings"])["remind"] ?? .null
        let requested = request?(remind) == true;sync?(remind)
        return JS.obj([("ok",.bool(true)),("requested",.bool(requested))])
    }
    public static func changeTime(_ store: Store, hour: JSValue, minute: JSValue, sync: ((JSValue) -> Void)? = nil) -> JSValue {
        let r = SettingsView.commitRemindTime(store,hour:hour,minute:minute)
        if r["ok"] != .bool(true) { return r }
        sync?(SettingsView.settingsView(store.state["settings"])["remind"] ?? .null)
        return JS.obj([("ok",.bool(true))])
    }
}
