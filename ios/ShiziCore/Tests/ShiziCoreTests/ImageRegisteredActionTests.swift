import XCTest
@testable import ShiziCore

final class ImageRegisteredActionTests: XCTestCase {
    // image.persist writes files in order, stops at failure and preserves the failure reason.
    func testPersistenceConvertsPNGAndStopsAtFirstFailure() async {
        let image = ImageRegisteredActions(store: SessionPageContractTests().runtime().store)
        var names: [String] = []
        image.saveFile = { file in
            names.append(JS.string(file["name"]))
            return names.count == 1 ? JS.obj([("ok", .bool(true))]) : JS.obj([("ok", .bool(false)), ("via", .string("native"))])
        }
        let files = ["a.JPG", "b.jpeg", "c.jpg"].map { JS.obj([("name", .string($0)), ("dataURL", .string("data:image/png;base64,AA=="))]) }
        let r = await image.persist(JSObject([("images", .array(files))]))
        XCTAssertEqual(r, SessionWrites.failure("denied")); XCTAssertEqual(names, ["a.png", "b.png"])
    }
    // closeNativePreview closes the right native entry and never navigates back.
    func testClosedBookkeeping() throws {
        let image = ImageRegisteredActions(store: SessionPageContractTests().runtime().store); var messages: [JSValue] = []
        image.post = { messages.append($0) }
        _ = try image.call("closed", JSObject()); XCTAssertTrue(messages.isEmpty)
        _ = try image.call("closed", JSObject([("entryId", .string("image-toast-2"))]))
        XCTAssertEqual(messages.first?["screen"], .string("image-toast")); XCTAssertEqual(messages.first?["op"], .string("close"))
    }
}
