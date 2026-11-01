import XCTest
@testable import ShiziCore

// B4.7 影子比对（App 内 SwiftEngine ⇄ WebEngine）抓到的注入口缺口：网页由界面层量的值（折行点、选字条缩略图）在 JS 里是注入的，
// Swift 一侧原先写死成 null / {} / ""——App 的宿主注入了也拿不到。这里守住：宿主注入了就用注入的，没注入保持原值（命令行 / 差分不变）。
final class EngineInjectionTests: XCTestCase {
    let now = 1790906400000.0

    func runtime() -> SessionRuntime {
        let disk = MemoryDisk(), dates = Dates(timeZone: TimeZone(identifier: "Asia/Shanghai")!)
        let store = Store(storage: StoreStorage(disk.open(), now: { [now] in now }), now: { [now] in now }, dates: dates)
        _ = store.load()
        return SessionRuntime(store: store, mathFlavor: .v8)
    }

    /// 结果页的 lines（title / sub / preview / inviteBody）：write.* 路径也装上宿主的折行量测（screens/result/native-view.js 量的同四段）。
    func testResultPageLinesUseHostBreaker() throws {
        let core = runtime()
        core.writeDependencies.resultView = { [now] store, a in try ResultPageView.view(store, a, now: now) }
        let r = try ScheduleRules(dates: core.store.dates).startPicked(core.store, keys: [.string("base:" + cYong)], source: JS.obj([("view", .string("home"))]), deck: .real)
        let sid = try XCTUnwrap(r["session"]?["id"] ?? core.store.state["sessions"]?["B"]?["id"])
        let args = JSObject([("slot", .string("B")), ("sessionId", sid)])
        let plain = core.call("write.result", args)
        XCTAssertEqual(plain["view"]?["lines"]?["title"], .null)
        var kinds: [String] = []
        core.hooks.lineBreaker = { kind, _ in kinds.append(kind); return .array([.number(1)]) }
        let lines = core.call("write.result", args)["view"]?["lines"]
        XCTAssertEqual(lines?["inviteBody"], .array([.number(1)]))
        XCTAssertTrue(kinds.contains("result-invite"))
        XCTAssertNil(ViewLineStarts.provider) // 装上的只在这一次调用里有效
    }

    /// 图片预览：noteStarts / failStarts 用宿主的折行量测，选字条缩略图用宿主的渲染器（images-entry.js imageView）。
    func testImageViewUsesHostMeasurementAndThumb() {
        let core = runtime(), image = ImageRegisteredActions(store: core.store)
        image.palette = { .object(JSObject()) }
        image.install(on: core.hooks)
        let args = JSObject([("scope", JS.obj([("kind", .string("session")), ("slot", .string("B")), ("sessionId", .string("none"))]))])
        let plain = core.call("image.view", args)["view"]
        XCTAssertEqual(plain?["failStarts"], .object(JSObject()))
        core.hooks.lineBreaker = { kind, _ in .array([.number(kind == "image-fail" ? 2 : 1)]) }
        let view = core.call("image.view", args)["view"]
        XCTAssertEqual(view?["failStarts"]?["share"], .array([.number(2)]))
        XCTAssertEqual(view?["failStarts"]?.objectValue?.keys.sorted(), ["denied", "render", "save", "share"])
        if view?["note"]?.stringValue?.isEmpty == false { XCTAssertEqual(view?["noteStarts"], .array([.number(1)])) }
    }

    /// D80 ②（B4.9a）：App 里不再注入 ctx.now（缺省 = store.now()，App 时钟）——阻断页导出备份的日期跟 store 的「现在」走，
    /// 测试宿主钉住的时钟管得到；注入时仍用注入的（命令行 / 差分与 JS 镜像同一个钟）。
    func testContextClockDefaultsToTheStoreClock() throws {
        let core = runtime()
        XCTAssertNil(core.hooks.now)
        let day = try core.store.dates.localDay(.number(now)).replacingOccurrences(of: "-", with: "")
        let name = core.call("block.export", JSObject())["name"]?.stringValue ?? ""
        XCTAssertTrue(name.replacingOccurrences(of: "-", with: "").contains(day), name)
        core.hooks.now = { 1893456000000 } // 2030-01-01
        let pinned = core.call("block.export", JSObject())["name"]?.stringValue ?? ""
        XCTAssertTrue(pinned.contains("2030"), pinned)
    }
}
