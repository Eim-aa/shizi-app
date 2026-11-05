import ImageIO
import ShiziCore
import ShiziImageRendering
import UIKit
import XCTest
@testable import Shizi

// MARK: - 图片预览直接上屏的图 = 原来 PNG / base64 解回来的图（逐像素）；保存 / 分享的 PNG 字节不变

/// 预览弹层现在带 display: true 取 image.render 的 picture（画好的位图，不经 PNG / base64）。这里逐页比它与原来那条路
/// （不带 display → dataURL → base64 解 → UIImage(data:)，即预览页原来的 image(from:)）得到的图：
///   · 尺寸 / scale / 方向 / 回包的 width、height、name 相同；
///   · 两张图画进同一个位图（sRGB 与 Display P3 各一个，8 位 RGBA premultipliedLast，像素尺寸）后原始字节逐个相同；
///   · 放进预览同样的 UIImageView（scaleToFill、预览板的框）在浅色 / 深色下画出来逐字节相同（图的纸色只取浅色令牌，D51 §6，不随主题）；
///   · 同一张位图编 PNG 再解回来，字节逐个相同（PNG 往返无损，且纸面铺满、没有半透明像素）。
/// 板：月字帖 2 页（scale 4/3）与 5 页（scale 0.4）、某一天、单字、年报（封面 / 月页 / 尾页），比例 3:4 与 1:1（年报只有 3:4）。
/// 保存 / 分享：image.render mode export（分享）与 image.save（存相册，含年报长图）的 PNG 字节 = ImageRenderer.render(spec)
/// = 改动前的编码（ImagePreviewBench.encodePNG，原样抄来）编 renderImages 的同一张位图。
@MainActor
final class ImagePreviewEquivalenceTests: XCTestCase {
    private var host: TestHost!
    private var renderer: ImageRenderer!

    override func setUp() async throws {
        try await super.setUp()
        host = try TestHost()
        let ok = await ImagePreviewBench.poll(15) { self.host.ready }
        XCTAssertTrue(ok, "engine ready")
        renderer = ImageRenderer(assets: try XCTUnwrap(EngineHost.webRoot, "bundled Web/"))
    }

    override func tearDown() async throws {
        host?.reset()
        try await super.tearDown()
    }

    // MARK: 工具

    private var engine: SwiftEngine { host.engine }

    /// 原来预览页的 image(from:)（原样）。
    private static func oldImage(from dataURL: String) -> UIImage? {
        guard let comma = dataURL.firstIndex(of: ","), dataURL.hasPrefix("data:") else { return nil }
        let b64 = String(dataURL[dataURL.index(after: comma)...])
        guard let data = Data(base64Encoded: b64) else { return nil }
        return UIImage(data: data)
    }

    private static func pngBytes(_ dataURL: String) -> Data? {
        guard let comma = dataURL.firstIndex(of: ","), dataURL.hasPrefix("data:image/png;base64,") else { return nil }
        return Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...]))
    }

    /// CGImage 画进 w × h 的 8 位 RGBA premultipliedLast 位图（给定色彩空间），取原始字节。
    private static func raw(_ image: CGImage, space: CGColorSpace) -> [UInt8]? {
        let w = image.width, h = image.height
        var buf = [UInt8](repeating: 0, count: w * h * 4)
        let ok = buf.withUnsafeMutableBytes { (p: UnsafeMutableRawBufferPointer) -> Bool in
            guard let ctx = CGContext(data: p.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.interpolationQuality = .none
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        return ok ? buf : nil
    }

    /// UIImage 按自己的 scale / 方向画进同一个位图（UIGraphicsImageRenderer：scale 1、sRGB、透明底、像素尺寸）。
    private static func drawn(_ image: UIImage, pixels: CGSize) -> [UInt8]? {
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 1
        fmt.opaque = false
        fmt.preferredRange = .standard
        let out = UIGraphicsImageRenderer(size: pixels, format: fmt).image { _ in image.draw(in: CGRect(origin: .zero, size: pixels)) }
        guard let cg = out.cgImage, let cs = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        return raw(cg, space: cs)
    }

    /// 放进预览同样的 UIImageView（scaleToFill、预览板的框、给定主题）画出来（layer.render，scale 3）。
    private static func shown(_ image: UIImage, box: CGSize, style: UIUserInterfaceStyle) -> [UInt8]? {
        let iv = UIImageView(frame: CGRect(origin: .zero, size: box))
        iv.contentMode = .scaleToFill
        iv.overrideUserInterfaceStyle = style
        iv.image = image
        iv.layoutIfNeeded()
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 3
        fmt.opaque = false
        fmt.preferredRange = .standard
        let out = UIGraphicsImageRenderer(size: box, format: fmt).image { c in iv.layer.render(in: c.cgContext) }
        guard let cg = out.cgImage, let cs = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        return raw(cg, space: cs)
    }

    private static func differing(_ a: [UInt8], _ b: [UInt8]) -> Int {
        guard a.count == b.count else { return max(a.count, b.count) }
        var n = 0
        for i in 0..<a.count where a[i] != b[i] { n += 1 }
        return n
    }

    private func assertSame(_ a: [UInt8]?, _ b: [UInt8]?, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        guard let a, let b else { XCTFail("\(what): no pixels", file: file, line: line); return }
        XCTAssertTrue(a == b, "\(what): \(Self.differing(a, b)) of \(a.count) bytes differ", file: file, line: line)
    }

    private func view(_ scope: [String: Any]) async throws -> (pages: Int, ratios: [String], status: String) {
        let body = await engine.raw("image.view", ["scope": scope])
        let v = try XCTUnwrap(body["view"] as? [String: Any], "image.view \(scope)")
        return ((v["pageCount"] as? Int) ?? 0, (v["ratios"] as? [String]) ?? [], (v["status"] as? String) ?? "")
    }

    /// 一页：新路（display）与旧路（PNG / base64）得到的图逐项比。
    private func comparePage(_ scope: [String: Any], ratio: String, page: Int, label: String) async throws {
        let args: [String: Any] = ["scope": scope, "ratio": ratio, "page": page]
        var displayArgs = args
        displayArgs["display"] = true
        var newBody = await engine.raw("image.render", displayArgs)
        let taken = newBody.removeValue(forKey: SwiftEngine.pictureKey)
        let picture = try XCTUnwrap(taken as? UIImage, "\(label): picture")
        let newReply = try ShiziDecode.reply(newBody, as: NativeImageRenderReply.self) // 取走 picture 之后回包仍是 JSON（预览页同样解）
        let oldBody = await engine.raw("image.render", args)
        XCTAssertNil(oldBody[SwiftEngine.pictureKey], "\(label): no picture without display")
        let oldReply = try ShiziDecode.reply(oldBody, as: NativeImageRenderReply.self)
        let old = try XCTUnwrap(Self.oldImage(from: oldReply.image.dataURL), "\(label): old PNG decodes")

        XCTAssertEqual(newReply.image.status, "ready", label)
        XCTAssertEqual(newReply.image.status, oldReply.image.status, label)
        XCTAssertEqual(newReply.image.width, oldReply.image.width, "\(label): width")
        XCTAssertEqual(newReply.image.height, oldReply.image.height, "\(label): height")
        XCTAssertEqual(newReply.image.name, oldReply.image.name, "\(label): name")
        XCTAssertEqual(newReply.image.dataURL, "", "\(label): no dataURL on the display path")
        XCTAssertEqual(picture.size, old.size, "\(label): size")
        XCTAssertEqual(picture.scale, old.scale, "\(label): scale")
        XCTAssertEqual(picture.scale, 1, "\(label): scale 1 (PNG decode)")
        XCTAssertEqual(picture.imageOrientation, old.imageOrientation, "\(label): orientation")
        let pc = try XCTUnwrap(picture.cgImage, label), oc = try XCTUnwrap(old.cgImage, label)
        XCTAssertEqual(pc.width, oc.width, label)
        XCTAssertEqual(pc.height, oc.height, label)
        XCTAssertEqual(Double(pc.width), Double(newReply.image.width), "\(label): reply width = pixels")
        let spaces = "new \(String(describing: pc.colorSpace?.name)) / old \(String(describing: oc.colorSpace?.name)), bitmapInfo new \(pc.bitmapInfo.rawValue) / old \(oc.bitmapInfo.rawValue)"

        // 同一个位图（sRGB / Display P3）
        let srgb = try XCTUnwrap(CGColorSpace(name: CGColorSpace.sRGB)), p3 = try XCTUnwrap(CGColorSpace(name: CGColorSpace.displayP3))
        assertSame(Self.raw(pc, space: srgb), Self.raw(oc, space: srgb), "\(label): raw pixels in sRGB (\(spaces))")
        assertSame(Self.raw(pc, space: p3), Self.raw(oc, space: p3), "\(label): raw pixels in Display P3 (\(spaces))")
        // UIImage 自己画（按 scale / 方向）
        let px = CGSize(width: pc.width, height: pc.height)
        assertSame(Self.drawn(picture, pixels: px), Self.drawn(old, pixels: px), "\(label): UIImage.draw")
        // 预览板里上屏的样子（浅 / 深）
        let box = NativeImagePreviewBox.size(ratio)
        for style in [UIUserInterfaceStyle.light, .dark] {
            assertSame(Self.shown(picture, box: box, style: style), Self.shown(old, box: box, style: style), "\(label): UIImageView \(style == .dark ? "dark" : "light")")
        }
        // 同一张位图 PNG 往返无损
        let roundTrip = try XCTUnwrap(ImagePreviewBench.decodePNG(try ImageRenderer.png(pc)), "\(label): PNG round trip")
        assertSame(Self.raw(pc, space: srgb), Self.raw(roundTrip, space: srgb), "\(label): PNG round trip of the same bitmap")
    }

    /// 一块板的每个比例、每一页。
    private func compareBoard(_ scope: [String: Any], _ name: String, minPages: Int = 1) async throws {
        let v = try await view(scope)
        XCTAssertEqual(v.status, "ready", "\(name): image.view status")
        XCTAssertGreaterThanOrEqual(v.pages, minPages, "\(name): pages")
        XCTAssertFalse(v.ratios.isEmpty, name)
        for ratio in v.ratios {
            for page in 0..<v.pages {
                try await comparePage(scope, ratio: ratio, page: page, label: "\(name) \(ratio) page \(page + 1)/\(v.pages)")
            }
        }
    }

    private func seed(_ board: ImagePreviewBench.Board) async throws {
        if let err = await ImagePreviewBench.seed(host, board) {
            XCTFail("seed \(board.name): \(err)")
            throw CancellationError()
        }
    }

    /// 造好的数据里第一个有记录的字（单字图的 scope）。
    private func firstChar() throws -> String {
        let records = Query.flattenRecords(engine.core.store.state["records"])
        let key = try XCTUnwrap(records.compactMap { $0["cardKey"]?.stringValue }.first { $0.hasPrefix("base:") }, "a seeded record")
        return String(key.dropFirst("base:".count))
    }

    // MARK: 预览：新路 = 旧路

    func testPreviewPictureEqualsTheFormerPNGDecodedImageForEveryPageRatioAndTheme() async throws {
        try await seed(ImagePreviewBench.boards[0]) // month-90：2 页、scale 4/3
        try await compareBoard(ImagePreviewBench.scope, "month-90", minPages: 2)
        try await compareBoard(["kind": "day", "day": "2026-08-05"], "day")
        let ch = try firstChar()
        try await compareBoard(["kind": "glyph", "char": ch], "glyph")
        try await compareBoard(["kind": "annual"], "annual")
    }

    func testPreviewPictureEqualsTheFormerPNGDecodedImageOnTheSmallPagedBoard() async throws {
        try await seed(ImagePreviewBench.boards[2]) // month-330：5 页、scale 0.4
        try await compareBoard(ImagePreviewBench.scope, "month-330", minPages: 4)
    }

    /// 预览页本身：开弹层后每一页 UIImageView 上的图就是 display 的那一张（scale 1、像素尺寸同 PNG）。
    func testThePreviewSheetShowsTheDirectPictures() async throws {
        try await seed(ImagePreviewBench.boards[0])
        let vc = NativeImagePreviewController(engine: engine, scope: ImagePreviewBench.scope)
        let prepared = await vc.prepare()
        XCTAssertTrue(prepared)
        ImagePreviewBench.topPresenter(host.root).present(vc, animated: false)
        let shown = await ImagePreviewBench.poll { let c = ImagePreviewBench.canvases(vc.view); return !c.isEmpty && c.allSatisfy { $0.image != nil } }
        XCTAssertTrue(shown, "every page shows an image")
        let canvases = ImagePreviewBench.canvases(vc.view)
        XCTAssertEqual(canvases.count, 2)
        let srgb = try XCTUnwrap(CGColorSpace(name: CGColorSpace.sRGB))
        for (i, iv) in canvases.enumerated() {
            let img = try XCTUnwrap(iv.image)
            XCTAssertEqual(img.scale, 1)
            XCTAssertEqual(iv.contentMode, .scaleToFill)
            let body = await engine.raw("image.render", ["scope": ImagePreviewBench.scope, "ratio": "3:4", "page": i])
            let old = try XCTUnwrap(Self.oldImage(from: try ShiziDecode.reply(body, as: NativeImageRenderReply.self).image.dataURL))
            XCTAssertEqual(img.size, old.size, "page \(i + 1)")
            assertSame(Self.raw(try XCTUnwrap(img.cgImage), space: srgb), Self.raw(try XCTUnwrap(old.cgImage), space: srgb), "sheet page \(i + 1)")
        }
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in vc.dismiss(animated: false) { cont.resume() } }
    }

    // MARK: 保存 / 分享：PNG 字节不变

    /// 分享（image.render mode export）的 PNG = ImageRenderer.render(spec) = 改动前的编码编 renderImages 的同一张位图。
    func testSharePNGBytesAreTheRendererPNG() async throws {
        try await seed(ImagePreviewBench.boards[0])
        for ratio in ["3:4", "1:1"] {
            for page in 0..<2 {
                let args: [String: Any] = ["scope": ImagePreviewBench.scope, "ratio": ratio, "page": page, "mode": "export"]
                let body = await engine.raw("image.render", args)
                XCTAssertNil(body[SwiftEngine.pictureKey])
                let reply = try ShiziDecode.reply(body, as: NativeImageRenderReply.self)
                let shared = try XCTUnwrap(Self.pngBytes(reply.image.dataURL), "share PNG \(ratio) \(page)")
                let specBody = await engine.raw("image.spec", args)
                let spec = try XCTUnwrap(specBody["spec"] as? [String: Any])
                let rendered = try XCTUnwrap(try renderer.render(spec).first)
                let former = try XCTUnwrap(ImagePreviewBench.encodePNG(try XCTUnwrap(try renderer.renderImages(spec).first)))
                XCTAssertTrue(shared == rendered, "share \(ratio) page \(page + 1): \(shared.count) vs \(rendered.count) bytes")
                XCTAssertTrue(rendered == former, "render() = former encoding of renderImages() \(ratio) page \(page + 1)")
                XCTAssertTrue(try ImageRenderer.png(try XCTUnwrap(try renderer.renderImages(spec).first)) == rendered, "ImageRenderer.png = render()")
            }
        }
    }

    /// 存相册（image.save → image.persist → saveFile）写进去的每一张 PNG = ImageRenderer.render(spec mode export / long)。
    func testSavedPNGBytesAreTheRendererPNG() async throws {
        try await seed(ImagePreviewBench.boards[0])
        final class Box { var urls: [String] = [] }
        let box = Box()
        let images = engine.core.host.images
        let saved = images.saveFile
        defer { images.saveFile = saved }
        images.saveFile = { file in
            box.urls.append(file["dataURL"]?.stringValue ?? "")
            return EngineValue.obj([("via", .string("native")), ("ok", .bool(true))])
        }
        func expected(_ scope: [String: Any], _ extra: [String: Any], pages: Int) async throws -> [Data] {
            var out: [Data] = []
            for page in 0..<pages {
                var args = extra
                args["scope"] = scope
                args["page"] = page
                let specBody = await engine.raw("image.spec", args)
                let spec = try XCTUnwrap(specBody["spec"] as? [String: Any])
                out += try renderer.render(spec)
            }
            return out
        }
        // 月字帖（2 页、每页一张）
        for ratio in ["3:4", "1:1"] {
            box.urls = []
            let body = await engine.raw("image.save", ["scope": ImagePreviewBench.scope, "ratio": ratio])
            XCTAssertEqual(body["ok"] as? Bool, true, "image.save \(ratio)")
            let want = try await expected(ImagePreviewBench.scope, ["ratio": ratio, "mode": "export"], pages: 2)
            XCTAssertEqual(box.urls.count, want.count, "saved files \(ratio)")
            for (i, url) in box.urls.enumerated() where i < want.count {
                let got = try XCTUnwrap(Self.pngBytes(url), "saved PNG \(i)")
                XCTAssertTrue(got == want[i], "saved \(ratio) file \(i + 1): \(got.count) vs \(want[i].count) bytes")
            }
        }
        // 年报长图（annual-long：按内容出高、超高切张）
        box.urls = []
        let long = await engine.raw("image.save", ["scope": ["kind": "annual"], "mode": "long"])
        XCTAssertEqual(long["ok"] as? Bool, true, "image.save long")
        let longSpec = await engine.raw("image.spec", ["scope": ["kind": "annual"], "mode": "long"])
        let spec = try XCTUnwrap(longSpec["spec"] as? [String: Any])
        let want = try renderer.render(spec)
        XCTAssertFalse(want.isEmpty)
        XCTAssertEqual(box.urls.count, want.count, "long image files")
        for (i, url) in box.urls.enumerated() where i < want.count {
            let got = try XCTUnwrap(Self.pngBytes(url), "long PNG \(i)")
            XCTAssertTrue(got == want[i], "long file \(i + 1): \(got.count) vs \(want[i].count) bytes")
            let former = try XCTUnwrap(ImagePreviewBench.encodePNG(try renderer.renderImages(spec)[i]))
            XCTAssertTrue(got == former, "long file \(i + 1) = former encoding")
        }
    }
}
