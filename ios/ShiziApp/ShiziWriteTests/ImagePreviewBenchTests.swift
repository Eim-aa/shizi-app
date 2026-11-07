import ImageIO
import ShiziCore
import ShiziImageRendering
import UIKit
import XCTest
@testable import Shizi

// MARK: - 图片预览弹层画图的耗时：量测（BENCH）

/// 图片预览弹层（NativeImagePreviewController）每一页图从引擎到屏上的耗时（CI 日志里 grep BENCH）。只打印、不断言时间。
///   BENCH image-preview page <板> ratio=<比例> page=<第几页>/<页数> px=<宽>x<高> png=…KB
///         spec=…ms render+png=…ms png≈…ms draw≈…ms b64enc=…ms b64dec=…ms decode=…ms op=…ms
///     spec       = image.spec（选字 / 落款 / 版式参数，SessionRuntime）
///     render+png = ImageRenderer.render(spec)：Core Graphics 画 + 编 PNG（产品 image.render 里的那一步）
///     png        = 同一张位图（同一格式：sRGB、8 位、premultipliedLast）单独编一次 PNG（CGImageDestination，与渲染器同一个调用）
///     draw       = render+png − png（只画的估算）
///     b64enc     = PNG → "data:image/png;base64,…"（引擎回包里的 dataURL）
///     b64dec     = dataURL → Data（预览页 image(from:)）
///     decode     = UIImage(data:) + preparingForDisplay()（PNG 解码成能上屏的位图；UIImageView 上屏时在主线程做的那一步）
///     op         = 整个 engine.raw("image.render") 一页的墙钟（spec + 画 + PNG + 读图头 + base64）
///   BENCH image-preview open <板> pages=<页数> prepare=…ms open=…ms switch-1:1=…ms switch-3:4=…ms
///     prepare    = vc.prepare()（image.view：视图模型）
///     open       = 弹层呈现（无动画）→ 每一页的图都放进 UIImageView 并提交一次（CATransaction.flush：图在提交里解码上屏）
///     switch-x   = 点比例分段 → 新比例的每一页都换上并提交一次（预览页 renderAll：逐页串行、都在主线程）
/// 板：月字帖（2026-08，core3500 的前 n 个字，每天 perDay 个；夹具 seedRecords + seed，与 UI 夹具 preview-paged 同一批入口）。
///   month-90  = 2 页、scale 4/3（每页 1440 × 1920 / 1440 × 1440 像素）
///   month-240 = 3 页、scale 4/3
///   month-330 = 5 页、scale 0.4（超过 3 页的预览用小图）
@MainActor
enum ImagePreviewBench {
    struct Board {
        let name: String
        let n: Int
        let perDay: Int
    }

    static let boards = [Board(name: "month-90", n: 90, perDay: 3), Board(name: "month-240", n: 240, perDay: 8), Board(name: "month-330", n: 330, perDay: 11)]
    static let month = "2026-08"
    static var scope: [String: Any] { ["kind": "month", "month": month] }

    static func now() -> UInt64 { DispatchTime.now().uptimeNanoseconds }
    static func ms(_ from: UInt64, _ to: UInt64) -> Double { Double(to &- from) / 1e6 }

    /// 造一块月字帖（清空数据后 seedRecords + seed；时钟钉在 2026-10-22 09:00 起）。nil = 成功。
    static func seed(_ host: TestHost, _ board: Board) async -> String? {
        let setup: [[String: Any]] = [
            ["op": "seedRecords", "lib": ["id": "core3500", "n": board.n, "from": "2026-08-01", "perDay": board.perDay] as [String: Any]],
            ["op": "seed"],
        ]
        return await QAFixtureRunner(host: host.root).run(setup, pin: "2026-10-22T09:00:00", clock: "", reset: true)
    }

    /// 渲染器画好的位图的同一格式（sRGB、8 位、premultipliedLast、紧排）：把一张图原样画进去再取出来。
    static func bitmapCopy(_ image: CGImage) -> CGImage? {
        guard let cs = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4, space: cs,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
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

    static func decodePNG(_ data: Data) -> CGImage? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(src, 0, nil)
    }

    /// 视图树里的预览图（native-image-canvas），按加进去的顺序。
    static func canvases(_ v: UIView) -> [UIImageView] {
        var out: [UIImageView] = []
        func walk(_ x: UIView) {
            if let iv = x as? UIImageView, iv.accessibilityIdentifier == "native-image-canvas" { out.append(iv) }
            for s in x.subviews { walk(s) }
        }
        walk(v)
        return out
    }

    /// 主线程上轮询（每 1ms 让出一次，预览页的 Task 在这期间跑）。
    static func poll(_ timeout: Double = 30, _ cond: () -> Bool) async -> Bool {
        let end = now() + UInt64(timeout * 1e9)
        while now() < end {
            if cond() { return true }
            try? await Task.sleep(nanoseconds: 1_000_000)
        }
        return cond()
    }

    /// 最上面的呈现者（从它上面呈现弹层）。
    static func topPresenter(_ root: UIViewController) -> UIViewController {
        var top = root
        while let p = top.presentedViewController, !p.isBeingDismissed { top = p }
        return top
    }

    /// 一页的分段耗时（ms）、像素、PNG 字节。
    struct Stages {
        var spec = 0.0, renderPNG = 0.0, png = 0.0, b64enc = 0.0, b64dec = 0.0, decode = 0.0, op = 0.0
        var width = 0, height = 0, bytes = 0
    }

    static func stages(_ engine: SwiftEngine, _ renderer: ImageRenderer, ratio: String, page: Int) async throws -> Stages {
        var s = Stages()
        let args: [String: Any] = ["scope": scope, "ratio": ratio, "page": page]
        let t0 = now()
        let body = await engine.raw("image.spec", args)
        s.spec = ms(t0, now())
        let spec = try XCTUnwrap(body["spec"] as? [String: Any], "image.spec page \(page)")
        let t1 = now()
        let png = try XCTUnwrap(try renderer.render(spec).first, "render page \(page)")
        s.renderPNG = ms(t1, now())
        s.bytes = png.count
        let bitmap = try XCTUnwrap(decodePNG(png).flatMap(bitmapCopy), "bitmap page \(page)")
        s.width = bitmap.width
        s.height = bitmap.height
        let t2 = now()
        _ = try XCTUnwrap(encodePNG(bitmap))
        s.png = ms(t2, now())
        let t3 = now()
        let url = "data:image/png;base64," + png.base64EncodedString()
        s.b64enc = ms(t3, now())
        let t4 = now()
        let comma = try XCTUnwrap(url.firstIndex(of: ","))
        let data = try XCTUnwrap(Data(base64Encoded: String(url[url.index(after: comma)...])))
        s.b64dec = ms(t4, now())
        let t5 = now()
        let img = try XCTUnwrap(UIImage(data: data))
        _ = try XCTUnwrap(img.preparingForDisplay())
        s.decode = ms(t5, now())
        let t6 = now()
        let reply = await engine.raw("image.render", args)
        s.op = ms(t6, now())
        XCTAssertEqual(reply["ok"] as? Bool, true, "image.render page \(page)")
        return s
    }

    static func report(_ board: String, ratio: String, page: Int, of n: Int, _ s: Stages) {
        print(String(format: "BENCH image-preview page \(board) ratio=\(ratio) page=%ld/%ld px=%ldx%ld png=%.0fKB spec=%.1fms render+png=%.1fms png≈%.1fms draw≈%.1fms b64enc=%.1fms b64dec=%.1fms decode=%.1fms op=%.1fms",
                     page + 1, n, s.width, s.height, Double(s.bytes) / 1024, s.spec, s.renderPNG, s.png, max(0, s.renderPNG - s.png), s.b64enc, s.b64dec, s.decode, s.op))
    }

    /// 弹层开出来（无动画）到每一页的图都上屏；再点两次比例分段。返回 (prepare, open, switch-1:1, switch-3:4) ms。
    static func open(_ host: TestHost) async throws -> (pages: Int, prepare: Double, open: Double, toSquare: Double, toPortrait: Double) {
        let vc = NativeImagePreviewController(engine: host.engine, scope: scope)
        let t0 = now()
        let prepared = await vc.prepare()
        let prepare = ms(t0, now())
        XCTAssertTrue(prepared, "image.view")
        let presenter = topPresenter(host.root)
        let t1 = now()
        presenter.present(vc, animated: false)
        let pages = canvases(vc.view).count
        let shown = await poll { let c = canvases(vc.view); return !c.isEmpty && c.allSatisfy { $0.image != nil } }
        CATransaction.flush()
        let open = ms(t1, now())
        XCTAssertTrue(shown, "every page shows an image")
        func flip(_ ratio: String) async -> Double {
            let old = Set(canvases(vc.view).compactMap { (iv: UIImageView) -> ObjectIdentifier? in iv.image.map { (img: UIImage) in ObjectIdentifier(img) } })
            let button = allButtons(vc.view).first { $0.accessibilityIdentifier == "native-image-ratio" && $0.accessibilityValue == ratio }
            XCTAssertNotNil(button, "ratio button \(ratio)")
            let t = now()
            button?.sendActions(for: .touchUpInside)
            let ok = await poll {
                let c = canvases(vc.view)
                return !c.isEmpty && c.allSatisfy { (iv: UIImageView) in iv.image.map { (img: UIImage) in !old.contains(ObjectIdentifier(img)) } ?? false }
            }
            CATransaction.flush()
            XCTAssertTrue(ok, "every page re-rendered at \(ratio)")
            return ms(t, now())
        }
        let toSquare = await flip("1:1")
        let toPortrait = await flip("3:4")
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in vc.dismiss(animated: false) { cont.resume() } }
        return (pages, prepare, open, toSquare, toPortrait)
    }

    static func allButtons(_ v: UIView) -> [UIButton] {
        var out: [UIButton] = []
        func walk(_ x: UIView) {
            if let b = x as? UIButton { out.append(b) }
            for s in x.subviews { walk(s) }
        }
        walk(v)
        return out
    }
}

@MainActor
final class ImagePreviewBenchTests: XCTestCase {
    private var host: TestHost!

    override func setUp() async throws {
        try await super.setUp()
        host = try TestHost()
        let ok = await ImagePreviewBench.poll(15) { self.host.ready }
        XCTAssertTrue(ok, "engine ready")
    }

    override func tearDown() async throws {
        host?.reset()
        try await super.tearDown()
    }

    /// 每一页：spec / 画 / PNG / base64 / 解码（BENCH image-preview page …）；整个弹层：开 / 切比例（BENCH image-preview open …）。
    func testPreviewImageCostPerPageAndEndToEnd() async throws {
        let assets = try XCTUnwrap(EngineHost.webRoot, "bundled Web/ (fonts, glyph data)")
        let renderer = ImageRenderer(assets: assets)
        for board in ImagePreviewBench.boards {
            if let err = await ImagePreviewBench.seed(host, board) { XCTFail("seed \(board.name): \(err)"); continue }
            let view = await host.engine.raw("image.view", ["scope": ImagePreviewBench.scope])
            let pages = ((view["view"] as? [String: Any])?["pageCount"] as? Int) ?? 0
            XCTAssertGreaterThan(pages, 0, board.name)
            for ratio in ["3:4", "1:1"] {
                for page in 0..<pages {
                    let s = try await ImagePreviewBench.stages(host.engine, renderer, ratio: ratio, page: page)
                    ImagePreviewBench.report(board.name, ratio: ratio, page: page, of: pages, s)
                }
            }
            let r = try await ImagePreviewBench.open(host)
            XCTAssertEqual(r.pages, pages, board.name)
            print(String(format: "BENCH image-preview open \(board.name) pages=%ld prepare=%.1fms open=%.1fms switch-1:1=%.1fms switch-3:4=%.1fms",
                         r.pages, r.prepare, r.open, r.toSquare, r.toPortrait))
        }
    }
}
