import XCTest
@testable import ShiziCore

final class RegisteredS02Tests: XCTestCase {
    // src/ui/screens/session/index.js startPicked: native S02 owns the real endOldAndStartPicked callback.
    func testRegisteredLibraryStartWiresS02FailureRetryAndCloseBeforeWrite() throws {
        let core = SessionPageContractTests().runtime()
        let old = try SessionRules.createSession(id:.string("s1"),kind:.string("picked"),source:JS.obj([("view",.string("home"))]),queue:.array([.string("base:口"),.string("base:水")]),at:.number(core.store.now()),dates:core.store.dates)
        XCTAssertEqual(core.store.seed(JS.obj([("sessions",JS.obj([("A",.null),("B",old),("lastEnded",.object(JSObject()))]))]))["ok"],.bool(true))
        let pages = PageRegisteredActions(store:core.store);var events: [String] = []
        pages.open = { screen,_ in events.append(screen) };pages.install(on:core.hooks)
        XCTAssertEqual(core.call("library.list.start",JSObject([("keys",.array([.string("base:人")])),("view",.string("dueList"))]))["ok"],.bool(true))
        XCTAssertEqual(events,["s02"])
        core.store.storage.failNextWrite(1)
        let args = JSObject([("action",.string("endStart"))])
        XCTAssertEqual(core.call("s02.decide",args)["ok"],.bool(false));XCTAssertEqual(core.store.state["sessions"]?["B"]?["id"],.string("s1"));XCTAssertEqual(events,["s02"])
        XCTAssertEqual(core.call("s02.decide",args),JS.obj([("ok",.bool(true)),("close",.bool(false))]))
        XCTAssertEqual(core.store.state["sessions"]?["B"]?["queue"],.array([.string("base:人")]))
        XCTAssertEqual(events,["s02","s02-close","write"])
    }
}
