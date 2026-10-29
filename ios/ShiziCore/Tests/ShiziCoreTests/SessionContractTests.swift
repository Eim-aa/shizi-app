import XCTest
@testable import ShiziCore

final class SessionContractTests: XCTestCase {
    // test/ui/native-write.test.mjs — original contract names are preserved per fixture group.
    // JS real Store → Swift real Store; compare every reply and full normalized store snapshot.
    func testWriteAndResultContracts() throws {
        JSMath.flavor = .v8
        let fixture = try loadFixture("session-contract")
        for group in fixture["groups"]!.arrayValue! {
            let engine = CoreEngine(timeZone: TimeZone(identifier: group["tz"]!.stringValue!)!)
            for (i,step) in group["steps"]!.arrayValue!.enumerated() {
                let result = engine.handle(step["request"]!), label = JS.string(group["name"]) + " [" + JS.string(group["backend"]) + "] step " + String(i)
                XCTAssertEqual(result["ok"], .bool(true), label)
                XCTAssertEqual(JSONWriter.stringify(result["reply"] ?? .null), JSONWriter.stringify(step["reply"] ?? .null), label)
                XCTAssertEqual(JSONWriter.stringify(result["state"] ?? .null), JSONWriter.stringify(step["state"] ?? .null), label)
            }
        }
    }
    // test/ui/native-write.test.mjs — D07: a failed judgment changes nothing and does not advance; the retry records once
    func testFailurePublishesNothingAndRetryRecordsOnce() throws {
        let doc = try loadFixture("session-contract")
        for group in doc["groups"]!.arrayValue! where JS.string(group["name"]).hasPrefix("D07:") {
            let steps = group["steps"]!.arrayValue!
            XCTAssertEqual(steps[3]["state"]?["store"]?["state"], steps[2]["state"]?["store"]?["state"])
            XCTAssertEqual(steps[4]["state"]?["store"]?["state"], steps[5]["state"]?["store"]?["state"])
            XCTAssertEqual(steps[5]["reply"]?["error"]?["kind"], .string("stale"))
        }
    }
}
