import XCTest
@testable import ShiziCore

final class SessionPageContractTests: XCTestCase {
    func runtime() -> SessionRuntime {
        let disk = MemoryDisk(), dates = Dates(timeZone: TimeZone(identifier: "Asia/Shanghai")!)
        let store = Store(storage: StoreStorage(disk.open(), now: { 1790906400000 }), now: { 1790906400000 }, dates: dates)
        _ = store.load()
        return SessionRuntime(store: store, mathFlavor: .v8)
    }
    // test/ui/native-block.test.mjs — B3.12 session.pick / session.libSwitch / session.wrongList call the very function the web registered
    func testSessionActionsCallRegisteredFunctionsWithoutWriting() {
        let core = runtime(), before = core.store.state
        var calls: [String] = []
        for op in ["session.pick", "session.libSwitch", "session.wrongList"] {
            XCTAssertEqual(core.call(op)["error"]?["kind"], .string("unavailable"))
            core.hooks.set(op) { _ in calls.append(op); return .null }
            XCTAssertEqual(core.call(op), JS.obj([("ok", .bool(true))]))
        }
        XCTAssertEqual(calls, ["session.pick", "session.libSwitch", "session.wrongList"])
        XCTAssertEqual(core.store.state, before)
        XCTAssertEqual(core.call("view.session-none")["view"], SessionView.noneView(JSObject([("exhausted", .bool(false)), ("pick", .bool(true)), ("wrongList", .bool(true)), ("libSwitch", .bool(true))])))
    }
    // test/ui/native-detail.test.mjs — detail custom removal/restore preserves original position/time and records.
    func testCustomRemoveRestoreAndFailure() {
        let core = runtime(), a = JSObject([("char", .string(cYong))])
        XCTAssertEqual(core.call("detail.addCustom", a)["ok"], .bool(true))
        let before = core.store.state
        core.store.storage.failNextWrite(1)
        XCTAssertEqual(core.call("detail.removeCustom", a)["ok"], .bool(false))
        XCTAssertEqual(core.store.state, before)
        let removed = core.call("detail.removeCustom", a)["removed"]!
        XCTAssertEqual(core.call("detail.restoreCustom", JSObject([("removed", removed)]))["ok"], .bool(true))
        XCTAssertEqual(core.store.state["custom"], before["custom"])
        XCTAssertEqual(core.store.state["records"], before["records"])
    }
    // test/ui/native-query.test.mjs — S02 closes before continuing; failure keeps the decision open.
    func testS02CallbackOrderAndFailure() {
        let core = runtime(); var calls: [String] = []
        XCTAssertEqual(core.call("s02.decide", JSObject([("action", .string("cancel"))]))["error"]?["kind"], .string("unavailable"))
        core.hooks.s02Close = { calls.append("close") }; core.hooks.s02Continue = { calls.append("continue") }
        XCTAssertEqual(core.call("s02.decide", JSObject([("action", .string("continue"))])), JS.obj([("ok", .bool(true)), ("close", .bool(false))]))
        XCTAssertEqual(calls, ["close", "continue"])
        core.hooks.s02EndStart = { SessionWrites.failure("generic") }
        XCTAssertEqual(core.call("s02.decide", JSObject([("action", .string("endStart"))]))["error"]?["kind"], .string("generic"))
        XCTAssertEqual(calls.count, 2)
    }
    // src/session/text-lines.js — overwrite-safe registration, valid Unicode code point offsets only.
    func testTextLineProviderBoundary() {
        let lines = SessionTextLines(), key = "backup.intro"
        let old = lines.register(key) { _,_ in .array([.number(1)]) }
        let latest = lines.register(key) { _,_ in .array([.number(0), .number(1), .number(1.5), .number(2), .number(3), .string("1")]) }
        old()
        XCTAssertEqual(lines.starts(key, text: .string("a𠮷b")), .array([.number(1), .number(2)]))
        latest(); XCTAssertEqual(lines.starts(key, text: .string("abc")), .null)
        lines.register(key) { _,_ in throw CoreError.error("measurement") }
        XCTAssertEqual(lines.starts(key, text: .string("abc")), .null)
    }
    // test/platform/reminder.test.mjs — permission report is handed to the settings page (applyReminderStatus) with the live store
    func testPermissionReportUsesLiveStore() {
        let core = runtime()
        XCTAssertEqual(core.call("reminder.status", JSObject([("permission", .string("denied"))]))["ok"], .bool(true))
        XCTAssertEqual(core.store.state["settings"]?["remind"]?["permission"], .string("denied"))
        XCTAssertEqual(core.call("reminder.status", JSObject([("permission", .string("bad"))]))["ok"], .bool(true))
        XCTAssertEqual(core.store.state["settings"]?["remind"]?["permission"], .string("unknown"))
    }
}
