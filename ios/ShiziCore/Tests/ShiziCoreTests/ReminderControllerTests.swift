import XCTest
@testable import ShiziCore

final class ReminderControllerTests: XCTestCase {
    // test/platform/reminder.test.mjs — payload shape = WebViewController.syncReminder fields; user time; practicedToday from today's judged records
    func testPayloadShape() throws {
        let core = SessionPageContractTests().runtime()
        _ = ReminderInviteHost.invite(core.store,hour:.number(21),minute:.number(5))
        let p = try Reminder.reminderPayload(.object(core.store.state),today:.string("2026-10-02"),now:.number(core.store.now()),dates:core.store.dates)
        XCTAssertEqual(p.objectValue!.keys,["enabled","hour","minute","practicedToday","questions"])
        XCTAssertEqual(p["hour"],.number(21));XCTAssertEqual(p["minute"],.number(5));XCTAssertEqual(p["practicedToday"],.bool(false))
    }
    // test/platform/reminder.test.mjs — controller: sync posts {type:syncReminder,…}; identical content is not re-sent unless forced; nothing outside the shell
    func testControllerSyncDedupForceDebounceAndOutsideShell() {
        let core = SessionPageContractTests().runtime(), c = ReminderController(store:SessionPageContractTests().runtime().store)
        _ = ReminderInviteHost.invite(c.store,hour:.number(21),minute:.number(5))
        var messages: [String] = [], queued: (() -> Void)?, cancelled = 0
        c.post = { name,_ in messages.append(name);return true };c.isNative = { true }
        c.schedule = { ms,fn in XCTAssertEqual(ms,300);queued = fn;return { cancelled += 1 } }
        XCTAssertNotNil(c.sync());XCTAssertNil(c.sync());XCTAssertNotNil(c.sync(force:true));XCTAssertEqual(messages,["syncReminder","syncReminder"])
        c.scheduleSync();c.scheduleSync();XCTAssertEqual(cancelled,1)
        _ = ReminderInviteHost.changeTime(c.store,hour:.number(7),minute:.number(30));queued?();XCTAssertEqual(c.sent.last?["hour"],.number(7))
        let off = ReminderController(store:core.store);off.post = { _,_ in XCTFail("never sent + off");return true };XCTAssertNil(off.sync())
        c.post = { _,_ in false };XCTAssertNil(c.sync(force:true))
    }
    // test/platform/reminder.test.mjs — cold-start deep link: queued before ready, replayed once (last cardKey only) after markReady → startPicked as B (P47)
    func testColdStartTargetQueue() {
        let c = ReminderController(store:SessionPageContractTests().runtime().store);var opened: [JSValue] = []
        c.startPicked = { keys,source in opened.append(JS.obj([("keys",.array(keys)),("source",source)]));return JS.obj([("ok",.bool(true))]) }
        c.receiveTargetBeforeReady(.string("base:口"));c.receiveTargetBeforeReady(.string("base:人"));XCTAssertTrue(opened.isEmpty)
        c.markReady();c.markReady();XCTAssertEqual(opened.count,1);XCTAssertEqual(opened[0]["keys"],.array([.string("base:人")]))
        XCTAssertEqual(opened[0]["source"]?["source"]?["view"],.string("reminder"))
        XCTAssertEqual(c.openTarget(.string("base:学习"))["ok"],.bool(false))
    }
    // test/platform/reminder.test.mjs — permission report is handed to the settings page (applyReminderStatus) with the live store
    func testPermissionReportAndQueryStatus() {
        let core = SessionPageContractTests().runtime(), c = ReminderController(store:SessionPageContractTests().runtime().store);var got = 0
        c.applyStatus = { store,p in XCTAssertTrue(store === c.store);got += 1;return PageAPI.call("reminder.status",store:store,args:p.objectValue!) }
        c.receiveStatusBeforeReady(JS.obj([("permission",.string("denied"))]));XCTAssertEqual(got,0);c.markReady();XCTAssertEqual(got,1)
        c.post = { name,p in XCTAssertEqual(name,"queryReminderStatus");XCTAssertEqual(p,.object(JSObject()));return true };XCTAssertTrue(c.queryStatus());XCTAssertNotNil(core.store)
    }
    // test/platform/reminder.test.mjs — inviteReminder (点「好」): one settings commit turns the reminder on at the invited time and syncs; inviteChangeTime writes the time and re-syncs (the permission message itself is covered by e2e 72)
    func testPlatformInviteAndTimeUseSingleCommitThenSync() {
        let store = SessionPageContractTests().runtime().store;var labels: [String] = [], syncs: [JSValue] = [], requested = 0
        let off = store.subscribe { _,info in if info["type"] == .string("commit") { labels.append(JS.string(info["label"])) } };defer { off() }
        let r = ReminderInviteHost.invite(store,hour:.number(9),minute:.number(30),request:{ _ in requested += 1;return false },sync:{ syncs.append($0) })
        XCTAssertEqual(r,JS.obj([("ok",.bool(true)),("requested",.bool(false))]));XCTAssertEqual(labels,["settings:remind"]);XCTAssertEqual(syncs.count,1)
        _ = ReminderInviteHost.changeTime(store,hour:.number(21),minute:.number(15),sync:{syncs.append($0)})
        XCTAssertEqual(syncs.count,2);XCTAssertEqual(syncs[1]["hour"],.number(21));XCTAssertEqual(syncs[1]["enabled"],.bool(true))
        store.storage.failNextWrite(1)
        XCTAssertEqual(ReminderInviteHost.invite(store,hour:.number(8),minute:.number(0),request:{_ in requested += 1;return true},sync:{syncs.append($0)})["ok"],.bool(false));XCTAssertEqual(requested,1);XCTAssertEqual(syncs.count,2)
    }
}
