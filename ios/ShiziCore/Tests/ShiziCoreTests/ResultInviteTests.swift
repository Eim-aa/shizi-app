import XCTest
@testable import ShiziCore

final class ResultInviteTests: XCTestCase {
    // B2.7 resultInvite: shown / no / yes (denied, failed) / time = the web useReminderInvite commits
    func testInviteWaitsForPermissionReport() async {
        let core = SessionPageContractTests().runtime()
        core.writeDependencies.reminderInvite = { store,_ in
            _ = PageAPI.call("remind.enabled", store: store, args: JSObject([("on", .bool(true))]))
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.01) {
                _ = PageAPI.call("reminder.status", store: store, args: JSObject([("permission", .string("denied"))]))
            }
            return JS.obj([("ok", .bool(true)), ("requested", .bool(true))])
        }
        core.writeDependencies.reminderWaitMs = 1000
        let r = await core.callAsync("write.resultInvite", JSObject([("action", .string("yes"))]))
        XCTAssertEqual(r["phase"], .string("denied"))
        XCTAssertEqual(core.store.state["settings"]?["remind"]?["permission"], .string("denied"))
    }
    // permission wait times out with current settings; a host rejection is failed
    func testInviteTimeoutAndFailure() async {
        let core = SessionPageContractTests().runtime()
        core.writeDependencies.reminderWaitMs = 0
        core.writeDependencies.reminderInvite = { _,_ in JS.obj([("ok", .bool(true)), ("requested", .bool(true))]) }
        let r = await core.callAsync("write.resultInvite", JSObject([("action", .string("yes"))]))
        XCTAssertEqual(r["phase"], .string("accepted")); XCTAssertEqual(r["hour"], .number(20)); XCTAssertEqual(r["minute"], .number(30))
        core.writeDependencies.reminderInvite = { _,_ in throw CoreError.error("platform") }
        let before = core.store.state
        let failed = await core.callAsync("write.resultInvite", JSObject([("action", .string("yes"))]))
        XCTAssertEqual(failed["phase"], .string("failed")); XCTAssertEqual(core.store.state, before)
    }
}
