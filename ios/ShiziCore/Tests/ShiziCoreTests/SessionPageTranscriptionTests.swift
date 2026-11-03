import XCTest
@testable import ShiziCore

final class SessionPageTranscriptionTests: XCTestCase {
    // B3.12 view.session-none = the same model function the web page renders (web path == API path)
    func testNoneView() {
        let core = SessionPageContractTests().runtime()
        XCTAssertEqual(core.call("view.session-none")["view"],SessionView.noneView())
        for op in ["session.pick","session.libSwitch","session.wrongList"] { core.hooks.set(op) { _ in .null } }
        let v = core.call("view.session-none",JSObject([("exhausted",.bool(true))]))["view"]
        XCTAssertEqual(v?["primary"]?["to"],.string("libSwitch"));XCTAssertEqual(v?["secondary"]?["to"],.string("pick"))
    }
    // B3.12 session.pick / session.libSwitch / session.wrongList call the very function the web registered
    func testNoneActions() {
        let core = SessionPageContractTests().runtime();var calls: [String] = []
        for op in ["session.pick","session.libSwitch","session.wrongList"] { core.hooks.set(op) { _ in calls.append(op);return .null };XCTAssertEqual(core.call(op)["ok"],.bool(true)) }
        XCTAssertEqual(calls.count,3);core.hooks.set("session.pick") { _ in SessionWrites.failure("stale") };XCTAssertEqual(core.call("session.pick"),SessionWrites.failure("stale"))
        core.hooks.set("session.pick",nil);XCTAssertEqual(core.call("session.pick"),SessionWrites.failure("unavailable"))
    }
    // B3.13 view.block = the same model function the web page renders (web path == API path)
    func testBlockView() throws {
        let core = SessionPageContractTests().runtime()
        for kind in ["unavailable","blocked","migration"] { let a = JSObject([("kind",.string(kind)),("still",.bool(true)),("exportFail",.bool(true)),("canExport",.bool(true))]);XCTAssertEqual(core.call("view.block",a)["view"],try BlockView.blockView(a)) }
    }
    // B3.13 block.retry: unavailable re-probes (still), blocked / migration reload the page
    func testBlockRetry() {
        let core = SessionPageContractTests().runtime()
        XCTAssertEqual(core.call("block.retry",JSObject([("kind",.string("unavailable"))]))["still"],.bool(false))
        for kind in ["blocked","migration"] { XCTAssertEqual(core.call("block.retry",JSObject([("kind",.string(kind))]))["reload"],.bool(true)) }
    }
    // B3.13 block.export = the web export function (read-only: packs memory, writes nothing)
    func testBlockExport() throws {
        let core = SessionPageContractTests().runtime(), before = core.store.state
        let value = core.call("block.export")
        XCTAssertEqual(value["ok"],.bool(true));XCTAssertNotNil(value["text"]?.stringValue);XCTAssertEqual(core.store.state,before)
    }
    // B3.13 block.exportable: only blocked + readable memory + judged chars
    func testBlockExportable() {
        let core = SessionPageContractTests().runtime();XCTAssertEqual(core.call("block.exportable")["exportable"],.bool(false))
        XCTAssertFalse(BlockView.hasJudged(.object(core.store.state)))
    }
    // B3.12 / B3.13 the view models carry the web-measured line starts (native wraps by them, not by itself)
    func testBlockAndNoneLineMeasurer() throws {
        defer { ViewMeasurement.provider = nil }
        XCTAssertEqual(SessionView.noneView()["lines"]?["title"],.null)
        ViewMeasurement.provider = { spec in spec["variant"] == .string("empty-body") ? .array([.number(8),.number(12)]) : .array([.number(4)]) }
        let none = SessionView.noneView(JSObject([("exhausted",.bool(true))]));XCTAssertEqual(none["lines"]?["title"],.array([.number(4)]));XCTAssertEqual(none["lines"]?["body"],.array([.number(8),.number(12)]))
        let block = try BlockView.blockView(JSObject([("kind",.string("blocked")),("still",.bool(true))]));XCTAssertEqual(block["lines"]?["body"],.array([.array([.number(4)]),.array([.number(4)])]))
    }
    // B3.12 / B3.13 the ops are registered and the native screens have their Swift classes
    func testRegisteredCoreOps() throws {
        for op in ["view.session-none","session.pick","session.libSwitch","session.wrongList","view.block","block.retry","block.export","block.exportable"] { XCTAssertNotNil(CoreEngine.ops["api.call"]);XCTAssertTrue(SessionResources.ui["apiOps"]!.arrayValue!.contains(.string(op))) }
        var root = URL(fileURLWithPath:#filePath);for _ in 0..<5 { root.deleteLastPathComponent() }
        let directory = root.appendingPathComponent("ios/ShiziApp/ShiziApp")
        let files = FileManager.default.enumerator(at:directory,includingPropertiesForKeys:nil)!.allObjects.compactMap { $0 as? URL }.filter { $0.pathExtension == "swift" }
        let source = try files.map { try String(contentsOf:$0) }.joined(separator:"\n")
        let re = try NSRegularExpression(pattern:#"@objc\(ShiziScreen_([A-Za-z0-9_]+)\)\s*\n\s*final class \w+: ShiziScreenViewController"#)
        let names = re.matches(in:source,range:NSRange(source.startIndex...,in:source)).compactMap { Range($0.range(at:1),in:source).map { String(source[$0]).replacingOccurrences(of:"_",with:"-") } }
        XCTAssertTrue(names.contains("session-none"));XCTAssertTrue(names.contains("block"))
    }
    // commitWordOff / commitWordOn: one write each, idempotent; failure publishes nothing
    func testWordOffOn() {
        let core = SessionPageContractTests().runtime(),a = JSObject([("char",.string("人"))]);_ = core.call("detail.wordOff",a);let before = core.store.state;_ = core.call("detail.wordOff",a);XCTAssertEqual(core.store.state,before)
        core.store.storage.failNextWrite(1);XCTAssertEqual(core.call("detail.wordOn",a)["ok"],.bool(false));XCTAssertEqual(core.store.state,before);XCTAssertEqual(core.call("detail.wordOn",a)["ok"],.bool(true))
    }
    // commitRemoveCustom / commitRestoreCustom: records untouched; undo restores position and time; failures publish nothing
    func testRemoveRestoreCustom() { SessionPageContractTests().testCustomRemoveRestoreAndFailure() }
    // B3.5c op table: view.mine / mine.appearance / mine.groupSize
    func testMineOpTable() { for op in ["view.mine","mine.appearance","mine.groupSize"] { XCTAssertTrue(SessionResources.ui["apiOps"]!.arrayValue!.contains(.string(op))) } }
    // B3.5c write ops: mine.appearance / mine.groupSize run the same commit as the web (whole-store deepEqual, same commit order)
    func testMineCommitOrder() {
        let core = SessionPageContractTests().runtime();var labels: [String] = [];let off = core.store.subscribe { _,i in labels.append(JS.string(i["label"])) };defer { off() }
        _ = core.call("mine.appearance",JSObject([("value",.string("dark"))]));_ = core.call("mine.groupSize",JSObject([("value",.number(10))]));XCTAssertEqual(labels,["settings:appearance","settings:group-size"])
    }
    // B3.5c D07: a failed commit writes nothing and answers {ok:false, error:{kind}}; a retry of the same target writes once; invalid values are refused
    func testMineD07() {
        let core = SessionPageContractTests().runtime(),before=core.store.state,a=JSObject([("value",.string("dark"))]);core.store.storage.failNextWrite(1)
        XCTAssertEqual(core.call("mine.appearance",a)["ok"],.bool(false));XCTAssertEqual(core.store.state,before);XCTAssertEqual(core.call("mine.appearance",a)["ok"],.bool(true));let serial=core.store.serial;_ = core.call("mine.appearance",a);XCTAssertEqual(core.store.serial,serial)
        XCTAssertEqual(core.call("mine.groupSize",JSObject([("value",.number(9))]))["ok"],.bool(false))
    }
    // B3.5c the web prefs module re-exports the session commit functions (one implementation, two callers)
    func testPrefsAndApiUseSameCommit() {
        let a = SessionPageContractTests().runtime(),b=SessionPageContractTests().runtime()
        _ = a.call("mine.appearance",JSObject([("value",.string("dark"))]));_ = SettingsView.commitSettings(b.store,label:"settings:appearance",fields:JSObject([("appearance",.string("dark"))]));XCTAssertEqual(a.store.state,b.store.state)
    }
}
