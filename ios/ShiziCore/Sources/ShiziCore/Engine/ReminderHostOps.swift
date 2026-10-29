import Foundation

extension CoreEngine {
    static func reminderPlatform(_ store: Store, _ a: JSObject) -> JSValue {
        let c = ReminderController(store:store);var messages: [JSValue] = [],opens: [JSValue] = [],replies: [JSValue] = [],syncs: [JSValue] = []
        var timer: (() -> Void)?
        c.isNative = { a["native"] == .bool(true) }
        c.post = { name,payload in guard a["native"] == .bool(true) else { return false };messages.append(SessionWrites.patch(JS.obj([("type",.string(name))]),payload.objectValue!.entries.map { ($0.key,$0.value) }));return true }
        c.schedule = { _,fn in timer = fn;return { timer = nil } }
        c.startPicked = { keys,source in opens.append(JS.obj([("keys",.array(keys)),("options",source)]));return JS.obj([("ok",.bool(true)),("opened",.string("new"))]) }
        c.applyStatus = { store,payload in PageAPI.call("reminder.status",store:store,args:payload.objectValue ?? JSObject()) }
        for command in a["commands"]?.arrayValue ?? [] {
            switch JS.string(command["op"]) {
            case "sync":replies.append(c.sync(remind:command["remind"],force:command["force"] == .bool(true)) ?? .null)
            case "schedule":c.scheduleSync()
            case "fire":let fn = timer;timer = nil;fn?()
            case "forget":c.forget()
            case "query":replies.append(.bool(c.queryStatus()))
            case "status":replies.append(c.receiveStatus(command["payload"] ?? .null) ?? .null)
            case "target":replies.append(c.openTarget(command["value"]))
            case "queueTarget":c.receiveTargetBeforeReady(command["value"] ?? .null)
            case "queueStatus":c.receiveStatusBeforeReady(command["payload"] ?? .null)
            case "ready":c.markReady()
            case "invite":replies.append(ReminderInviteHost.invite(store,hour:command["hour"] ?? .null,minute:command["minute"] ?? .null,sync:{syncs.append($0)}))
            case "time":replies.append(ReminderInviteHost.changeTime(store,hour:command["hour"] ?? .null,minute:command["minute"] ?? .null,sync:{syncs.append($0)}))
            default:break
            }
        }
        return JS.obj([("replies",.array(replies)),("messages",.array(messages)),("opens",.array(opens)),("sent",.array(c.sent)),("syncs",.array(syncs))])
    }
}
