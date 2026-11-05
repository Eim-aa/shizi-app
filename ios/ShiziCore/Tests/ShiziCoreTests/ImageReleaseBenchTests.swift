import CoreGraphics
import Foundation
import ImageIO
import XCTest

@testable import ShiziCore
import ShiziImageRendering

// 图片预览每一页的耗时（Release / -O 下量；只打印、不断言耗时；CI 日志里 grep BENCH）。
// 对照 App 的 ShiziWriteTests ImagePreviewBenchTests（Debug 模拟器：每页 1440 × 1920 的 draw 约 250–400 ms）。
//
// 规格怎么来：与 App 同一条路 —— SessionRuntime.call("image.spec")（ImageRegisteredActions 装在 hooks 上，palette 用 App 的浅色一套），
// 回包的 JSValue 转成 [String: Any] 再交给 ImageRenderer.render（App 里 EngineValue.dict 那一步算在 spec 里）。
// 数据：与 ImagePreviewBench 同形 —— 月字帖 2026-08，前 n 个可练的字，每天 perDay 个，每个字一条写对的记录 + 一条墨迹（QA 夹具的三种笔画）。
//   月：month-90（2 页，scale 4/3）、month-240（3 页，scale 4/3）、month-330（5 页，scale 0.4）× 比例 3:4 / 1:1；
//   日：day-12、day-80（一页）；年报：annual-360（封面 + 各月 + 末页，3:4）。
//
// 输出（中位数：先整轮空跑一次，再 3 轮取中位）：
//   BENCH image-release page <板> ratio=<比例> page=<第几页>/<页数> px=<宽>x<高> png=…KB spec=…ms render+png=…ms png≈…ms draw≈…ms
//     spec       = runtime.call("image.spec") + JSValue → [String: Any]
//     render+png = ImageRenderer.render(spec)：Core Graphics 画 + 编 PNG
//     png        = 同一张位图单独再编一次 PNG（同一个 CGImageDestination 调用）
//     draw       = render+png − png
//   BENCH image-release board <板> ratio=<比例> pages=<页数> spec=…ms render+png=…ms png≈…ms draw≈…ms serial=…ms
//     各页中位数之和；serial = spec + render+png 之和（预览页 renderAll 逐页串行时用户等的时间，不含 base64 / 解码 / 上屏）
//   BENCH image-release parallel <板> pages=<页数> serial=…ms concurrent=…ms failures=…
//     同一批规格：一个 ImageRenderer 串行画，对照每页各用一个 ImageRenderer（已预热）在全局队列并发画
//   BENCH image-release cold <板> render+png=…ms   第一页用一个全新的 ImageRenderer 画（字体 / 字形轮廓首次加载）
//
// 只在 CI 手动的 Release 量测步骤里跑（它设 SHIZI_SCALE_BENCH=1）；verify:core 的 Debug swift test 里跳过（但照常编译）。

struct ImageBenchFixture {
    let name: String
    let n: Int
    let perDay: Int
    let from: String
    let scope: JSObject
    let ratios: [String]
}

struct ImageBenchPage {
    var spec = 0.0
    var renderPNG = 0.0
    var png = 0.0
    var width = 0
    var height = 0
    var bytes = 0
}

final class ImageBenchCounter {
    var failures = 0
    let lock = NSLock()
    func fail() {
        lock.lock()
        failures += 1
        lock.unlock()
    }
}

final class ImageReleaseBenchTests: XCTestCase {
    static let runs = 3
    static let today = "2026-10-22"

    static let fixtures: [ImageBenchFixture] = [
        ImageBenchFixture(name: "month-90", n: 90, perDay: 3, from: "2026-08-01", scope: monthScope("2026-08"), ratios: ["3:4", "1:1"]),
        ImageBenchFixture(name: "month-240", n: 240, perDay: 8, from: "2026-08-01", scope: monthScope("2026-08"), ratios: ["3:4", "1:1"]),
        ImageBenchFixture(name: "month-330", n: 330, perDay: 11, from: "2026-08-01", scope: monthScope("2026-08"), ratios: ["3:4", "1:1"]),
        ImageBenchFixture(name: "day-12", n: 12, perDay: 12, from: "2026-08-01", scope: dayScope("2026-08-01"), ratios: ["3:4", "1:1"]),
        ImageBenchFixture(name: "day-80", n: 80, perDay: 80, from: "2026-08-01", scope: dayScope("2026-08-01"), ratios: ["3:4", "1:1"]),
        ImageBenchFixture(name: "annual-360", n: 360, perDay: 3, from: "2026-06-01", scope: annualScope(2026), ratios: ["3:4"]),
    ]

    static func monthScope(_ month: String) -> JSObject {
        JSObject([("kind", .string("month")), ("month", .string(month))])
    }

    static func dayScope(_ day: String) -> JSObject {
        JSObject([("kind", .string("day")), ("day", .string(day))])
    }

    static func annualScope(_ year: Int) -> JSObject {
        JSObject([("kind", .string("annual")), ("year", .number(Double(year)))])
    }

    // MARK: 夹具

    /// App 导出图调色板（SwiftEngineCore.palette：tokens color.light；textures 空、tiles = [240]）。
    static func palette() -> JSValue {
        let pairs: [(String, JSValue)] = [
            ("paper", .string("#F4EFE6")), ("sheet", .string("#FBF8F2")), ("line", .string("#DDD5C7")), ("frame", .string("#95826B")),
            ("guide", .string("#D3C6B3")), ("ink1", .string("#26211D")), ("ink2", .string("#564E46")), ("ink3", .string("#6E655B")),
            ("hand", .string("#221D19")), ("ref", .string("#4E4741")), ("under", .string("#93897D")), ("zhu", .string("#B03A27")),
            ("seal", .string("#B03A27")), ("onSeal", .string("#FBF8F2")),
            ("textures", .array([])), ("tiles", .array([.number(240)])),
        ]
        return .object(JSObject(pairs))
    }

    /// QA 夹具的三种笔画（QAOps.variants）。
    static func strokes(_ k: Int) -> [[InkPoint]] {
        let a: [[(Double, Double, Double)]] = [[(60.0, 170.0, 0.0), (170.0, 168.0, 60.0), (290.0, 172.0, 120.0)]]
        let b: [[(Double, Double, Double)]] = [
            [(60.0, 120.0, 0.0), (170.0, 118.0, 60.0), (290.0, 122.0, 120.0)],
            [(172.0, 50.0, 300.0), (170.0, 170.0, 360.0), (174.0, 300.0, 420.0)],
        ]
        let c: [[(Double, Double, Double)]] = [
            [(70.0, 70.0, 0.0), (170.0, 170.0, 60.0), (290.0, 290.0, 120.0)],
            [(290.0, 70.0, 250.0), (180.0, 180.0, 310.0), (70.0, 290.0, 370.0)],
        ]
        let variants: [[[(Double, Double, Double)]]] = [a, b, c]
        let chosen = variants[k % 3]
        return chosen.map { stroke in
            stroke.map { p in InkPoint(x: p.0, y: p.1, t: p.2, order: InkPoint.orderXYTP) }
        }
    }

    /// v2 状态：前 n 个可练的字，每天 perDay 个，每字一条写对的记录 + 一条墨迹（同 LibraryInkBenchTests.inkedState 的形状）。
    static func state(_ f: ImageBenchFixture) throws -> JSObject {
        let pool = StoreCommitBenchmarkTests.practicableChars(f.n)
        XCTAssertEqual(pool.count, f.n, f.name)
        var byMonth: [String: [JSValue]] = [:]
        var inkByMonth: [String: JSObject] = [:]
        let start = dayMs(f.from, 9)
        for (i, ch) in pool.enumerated() {
            let dayStart = start + Double(i / f.perDay) * ONE_DAY_MS
            let day = try shanghai.localDay(.number(dayStart))
            let month = String(day.prefix(7))
            let at = dayStart + Double(i % f.perDay) * 60_000
            var list = byMonth[month] ?? []
            list.append(srec(i + 1, ch, day: day, at: at))
            byMonth[month] = list
            var table = inkByMonth[month] ?? JSObject()
            table["r\(i + 1)"] = try InkMath.encodeStoredInk(strokes(i), policy: Config.policy.objectValue, format: "raw")
            inkByMonth[month] = table
        }
        let months = byMonth.keys.sorted()
        var records = JSObject()
        var ink = JSObject()
        for m in months {
            records[m] = .array(byMonth[m] ?? [])
            ink[m] = .object(inkByMonth[m] ?? JSObject())
        }
        var s = storeBaseline()
        s["meta"] = .object(JSObject([("schema", .number(2)), ("serial", .number(Double(f.n))), ("createdAt", .number(T0)), ("months", .array(months.map { JSValue.string($0) }))]))
        s["records"] = .object(records)
        s["sched"] = .object(JSObject())
        s["ink"] = .object(ink)
        s["custom"] = .object(JSObject([("added", .array([]))]))
        s["sessions"] = .object(JSObject([("A", .null), ("B", .null), ("lastEnded", .object(JSObject()))]))
        return s
    }

    /// App 里图片预览用的运行时：SessionRuntime + ImageRegisteredActions（palette 同 App），时钟钉在 2026-10-22 09:00。
    static func runtime(_ f: ImageBenchFixture) throws -> SessionRuntime {
        let env = freshStore(.native, now: dayMs(today, 9), budgets: Budgets.native.js)
        let r = env.store.seed(.object(try state(f)), label: "image-bench-seed")
        XCTAssertEqual(r["ok"], .bool(true), str(r))
        let runtime = SessionRuntime(store: env.store, mathFlavor: .darwin)
        let images = ImageRegisteredActions(store: env.store)
        images.palette = { palette() }
        images.install(on: runtime.hooks)
        return runtime
    }

    /// 字体 / 字形等资源：仓库根的 fonts/、data/（App 的 Web/ 是它们的打包拷贝）。
    static func assetsRoot() -> URL {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { url = url.deletingLastPathComponent() }
        return url
    }

    // MARK: 小工具

    static func now() -> UInt64 { DispatchTime.now().uptimeNanoseconds }
    static func ms(_ from: UInt64, _ to: UInt64) -> Double { Double(to &- from) / 1e6 }

    static func median(_ xs: [Double]) -> Double {
        let s = xs.sorted()
        return s.isEmpty ? 0 : s[s.count / 2]
    }

    static func medianInt(_ xs: [Int]) -> Int {
        let s = xs.sorted()
        return s.isEmpty ? 0 : s[s.count / 2]
    }

    /// JSValue → [String: Any]（同 App 的 EngineValue.any）。
    static func plain(_ v: JSValue) -> Any {
        switch v {
        case .null: return NSNull()
        case .bool(let b): return b
        case .number(let d):
            if d.rounded() == d && abs(d) < 9e15 { return NSNumber(value: Int64(d)) }
            return NSNumber(value: d)
        case .string(let s): return s
        case .array(let a): return a.map { plain($0) }
        case .object(let o):
            var out: [String: Any] = [:]
            for (k, x) in o.entries { out[k] = plain(x) }
            return out
        }
    }

    static func decodePNG(_ data: Data) -> CGImage? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(src, 0, nil)
    }

    /// 渲染器画好的位图的同一格式（sRGB、8 位、premultipliedLast、紧排）。
    static func bitmapCopy(_ image: CGImage) -> CGImage? {
        guard let cs = CGColorSpace(name: CGColorSpace.sRGB),
            let ctx = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return ctx.makeImage()
    }

    /// 与 ImageRenderer 同一个 PNG 编码调用。
    static func encodePNG(_ image: CGImage) -> Data? {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, nil)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return data as Data
    }

    // MARK: 量一页

    static func pageArgs(_ scope: JSObject, ratio: String, page: Int) -> JSObject {
        JSObject([("scope", .object(scope)), ("ratio", .string(ratio)), ("page", .number(Double(page)))])
    }

    static func pageCount(_ runtime: SessionRuntime, _ scope: JSObject, ratio: String) -> Int {
        let reply = runtime.call("image.view", pageArgs(scope, ratio: ratio, page: 0))
        return Int(reply["view"]?["pageCount"]?.numberValue ?? 0)
    }

    /// image.spec 一页（含转 [String: Any]）。
    static func specOf(_ runtime: SessionRuntime, _ scope: JSObject, ratio: String, page: Int) throws -> [String: Any] {
        let reply = runtime.call("image.spec", pageArgs(scope, ratio: ratio, page: page))
        XCTAssertEqual(reply["ok"], .bool(true), str(reply))
        let value = try XCTUnwrap(reply["spec"], "image.spec page \(page)")
        let spec = try XCTUnwrap(plain(value) as? [String: Any], "spec dictionary page \(page)")
        XCTAssertEqual(spec["status"] as? String, "ready", "spec status page \(page)")
        return spec
    }

    static func measure(_ runtime: SessionRuntime, _ renderer: ImageRenderer, _ scope: JSObject, ratio: String, page: Int) throws -> ImageBenchPage {
        var out = ImageBenchPage()
        let t0 = now()
        let spec = try specOf(runtime, scope, ratio: ratio, page: page)
        out.spec = ms(t0, now())
        let t1 = now()
        let pngs = try renderer.render(spec)
        out.renderPNG = ms(t1, now())
        let png = try XCTUnwrap(pngs.first, "render page \(page)")
        out.bytes = png.count
        let decoded = try XCTUnwrap(decodePNG(png), "decode page \(page)")
        let bitmap = try XCTUnwrap(bitmapCopy(decoded), "bitmap page \(page)")
        out.width = bitmap.width
        out.height = bitmap.height
        let t2 = now()
        let again = encodePNG(bitmap)
        out.png = ms(t2, now())
        XCTAssertNotNil(again, "encode page \(page)")
        return out
    }

    static func line(_ name: String, ratio: String, page: Int, of n: Int, _ s: ImageBenchPage) -> String {
        String(
            format: "BENCH image-release page \(name) ratio=\(ratio) page=%ld/%ld px=%ldx%ld png=%.0fKB spec=%.1fms render+png=%.1fms png≈%.1fms draw≈%.1fms",
            page + 1, n, s.width, s.height, Double(s.bytes) / 1024, s.spec, s.renderPNG, s.png, max(0, s.renderPNG - s.png))
    }

    // MARK: 用例

    func testReleaseImagePreviewCostPerPage() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["SHIZI_SCALE_BENCH"] == "1", "image release bench runs only with SHIZI_SCALE_BENCH=1 (CI release-bench step)")
        let assets = Self.assetsRoot()
        XCTAssertTrue(FileManager.default.fileExists(atPath: assets.appendingPathComponent("fonts/ShiziKai-Regular.woff2").path), "fonts/ under \(assets.path)")
        XCTAssertTrue(FileManager.default.fileExists(atPath: assets.appendingPathComponent("data").path), "data/ under \(assets.path)")
        var coldDone = false
        for f in Self.fixtures {
            let runtime = try Self.runtime(f)
            if !coldDone {
                coldDone = true
                let fresh = ImageRenderer(assets: assets)
                let spec = try Self.specOf(runtime, f.scope, ratio: f.ratios[0], page: 0)
                let t0 = Self.now()
                _ = try fresh.render(spec)
                print(String(format: "BENCH image-release cold \(f.name) render+png=%.1fms", Self.ms(t0, Self.now())))
            }
            let renderer = ImageRenderer(assets: assets)
            for ratio in f.ratios {
                let pages = Self.pageCount(runtime, f.scope, ratio: ratio)
                XCTAssertGreaterThan(pages, 0, f.name)
                guard pages > 0 else { continue }
                // 空跑一整轮（字体 / 字形轮廓缓存、代码预热），再 runs 轮取中位。
                for p in 0..<pages { _ = try Self.measure(runtime, renderer, f.scope, ratio: ratio, page: p) }
                var samples: [[ImageBenchPage]] = []
                for _ in 0..<Self.runs {
                    var round: [ImageBenchPage] = []
                    for p in 0..<pages { round.append(try Self.measure(runtime, renderer, f.scope, ratio: ratio, page: p)) }
                    samples.append(round)
                }
                var sumSpec = 0.0
                var sumRender = 0.0
                var sumPNG = 0.0
                for p in 0..<pages {
                    let col = samples.map { $0[p] }
                    var m = ImageBenchPage()
                    m.spec = Self.median(col.map { $0.spec })
                    m.renderPNG = Self.median(col.map { $0.renderPNG })
                    m.png = Self.median(col.map { $0.png })
                    m.width = col[0].width
                    m.height = col[0].height
                    m.bytes = Self.medianInt(col.map { $0.bytes })
                    sumSpec += m.spec
                    sumRender += m.renderPNG
                    sumPNG += m.png
                    print(Self.line(f.name, ratio: ratio, page: p, of: pages, m))
                }
                print(String(
                    format: "BENCH image-release board \(f.name) ratio=\(ratio) pages=%ld spec=%.1fms render+png=%.1fms png≈%.1fms draw≈%.1fms serial=%.1fms",
                    pages, sumSpec, sumRender, sumPNG, max(0, sumRender - sumPNG), sumSpec + sumRender))
                if ratio == "3:4" && pages > 1 { try parallelProbe(runtime, f, ratio: ratio, pages: pages, assets: assets) }
            }
        }
    }

    /// 同一批规格：一个渲染器串行 vs 每页一个（预热过的）渲染器并发。
    private func parallelProbe(_ runtime: SessionRuntime, _ f: ImageBenchFixture, ratio: String, pages: Int, assets: URL) throws {
        var specs: [[String: Any]] = []
        for p in 0..<pages { specs.append(try Self.specOf(runtime, f.scope, ratio: ratio, page: p)) }
        let shared = ImageRenderer(assets: assets)
        var renderers: [ImageRenderer] = []
        for s in specs {
            let r = ImageRenderer(assets: assets)
            _ = try r.render(s) // 预热：字体 / 字形各自加载一次
            renderers.append(r)
        }
        for s in specs { _ = try shared.render(s) }
        var serial: [Double] = []
        var concurrent: [Double] = []
        let counter = ImageBenchCounter()
        for _ in 0..<Self.runs {
            let t0 = Self.now()
            for s in specs { _ = try shared.render(s) }
            serial.append(Self.ms(t0, Self.now()))
            let group = DispatchGroup()
            let t1 = Self.now()
            for i in 0..<specs.count {
                let r = renderers[i]
                let s = specs[i]
                DispatchQueue.global(qos: .userInitiated).async(group: group) {
                    let out = try? r.render(s)
                    if out == nil || out?.isEmpty == true { counter.fail() }
                }
            }
            group.wait()
            concurrent.append(Self.ms(t1, Self.now()))
        }
        XCTAssertEqual(counter.failures, 0, "concurrent render failures \(f.name)")
        print(String(format: "BENCH image-release parallel \(f.name) pages=%ld serial=%.1fms concurrent=%.1fms failures=%ld", pages, Self.median(serial), Self.median(concurrent), counter.failures))
    }
}
