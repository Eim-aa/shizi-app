import XCTest
@testable import ShiziCore

final class ChangeFeedTests: XCTestCase {
    // src/session/api/index.js — createChangeFeed: exceptions are swallowed, success publishes once and unsubscribe stops pushes.
    func testChangedFeedSwallowsPostErrorsAndUnsubscribes() {
        let core = SessionPageContractTests().runtime();var messages: [JSValue] = []
        let off = core.changed { messages.append($0);throw CoreError.error("post") }
        XCTAssertEqual(core.call("mine.appearance",JSObject([("value",.string("dark"))]))["ok"],.bool(true))
        XCTAssertEqual(messages.count,1);XCTAssertEqual(messages[0]["domains"],.array([.string("settings")]))
        core.store.storage.failNextWrite(1)
        XCTAssertEqual(core.call("mine.appearance",JSObject([("value",.string("light"))]))["ok"],.bool(false));XCTAssertEqual(messages.count,1)
        off();off()
        _ = core.call("mine.appearance",JSObject([("value",.string("light"))]));XCTAssertEqual(messages.count,1)
    }
    // src/session/api/index.js — absent store/post is an inert, repeatable unsubscribe.
    func testAbsentFeedInputs() { let off = PageAPI.createChangeFeed(store:nil,post:nil);off();off() }
}
