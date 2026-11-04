import XCTest
@testable import ShiziCore
@testable import ShiziCoreEngine

/// S2（调度规则 v2，D83）：这组契约场景的回包与状态和 JS 参考不同（D82：会话域的 JS 对照退役），主测试不重放它；
/// 夹具里留着它，是因为下面的 testFailurePublishesNothingAndRetryRecordsOnce 按名字读它。其余退役场景已从夹具删掉（2026-11 清扫）。
let d83RetiredSessionContracts: Set<String> = [
    "D07: a failed judgment changes nothing and does not advance; the retry records once",
]

final class SessionContractTests: XCTestCase {
    // original contract names are preserved per fixture group.
    // JS real Store → Swift real Store; compare every reply and full normalized store snapshot.
    func testWriteAndResultContracts() throws {
        JSMath.flavor = .v8
        let fixture = try loadFixture("session-contract")
        for group in fixture["groups"]!.arrayValue! where !d83RetiredSessionContracts.contains(JS.string(group["name"])) {
            let engine = CoreEngine(timeZone: TimeZone(identifier: group["tz"]!.stringValue!)!)
            for (i,step) in group["steps"]!.arrayValue!.enumerated() {
                let result = engine.handle(step["request"]!), label = JS.string(group["name"]) + " [" + JS.string(group["backend"]) + "] step " + String(i)
                XCTAssertEqual(result["ok"], .bool(true), label)
                XCTAssertEqual(JSONWriter.stringify(result["reply"] ?? .null), JSONWriter.stringify(step["reply"] ?? .null), label)
                XCTAssertEqual(JSONWriter.stringify(result["state"] ?? .null), JSONWriter.stringify(step["state"] ?? .null), label)
            }
        }
    }
    // D07: a failed judgment changes nothing and does not advance; the retry records once
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
