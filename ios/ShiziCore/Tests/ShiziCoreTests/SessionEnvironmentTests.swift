import XCTest
@testable import ShiziCore

final class SessionEnvironmentTests: XCTestCase {
    // src/data/etymology.js — one in-flight request, success cached; failed fetch retries on the next view.
    func testEtymologyCacheAndRetry() async {
        var reads = 0
        let provider = EtymologyProvider {
            reads += 1
            if reads == 1 { throw CoreError.error("fetch") }
            return .array([JS.obj([("char",.string("人")),("gloss",.string("origin"))])])
        }
        let missing = await provider.load();XCTAssertNil(missing)
        _ = await provider.load();_ = await provider.load()
        XCTAssertEqual(reads,2);XCTAssertEqual(provider.etymologyOf("人")?["source"],.string(""))
    }
    // test/ui/native-about.test.mjs — build and native are host environment, not user-controlled page args.
    func testAboutEnvironmentIsInjected() {
        let core = SessionPageContractTests().runtime()
        core.hooks.native = true
        let view = core.call("view.about-privacy",JSObject([("native",.bool(false))]))["view"]
        XCTAssertEqual(view,AboutView.privacyModel(.bool(true)))
    }
}
