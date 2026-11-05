import ShiziCore
import UIKit
import XCTest
@testable import Shizi

// 字库子页的性能改动与改动前逐项相同（只换做法、不换结果）：
//   令牌颜色缓存 = 每次现解析；
//   墨迹小图「没变不重画」：连续 apply 几份回包之后的整窗截图 = 每格强制重画后的截图 = 新页面直接 apply 最后一份的截图（浅 / 深）；
//   字形图缓存：缓存给的图与现画的逐字节相同（字 / 边长 / 字面比例 / 双钩 / 颜色 / 浅深）；整页同上截图对照；
//   墨迹直接读 = ShiziDecode.value 的 JSON 往返（逐位；合成 / 随机位型 / 边界整数 / 缺 w / null w / 空笔画；不认得的形状交回原路）；
//   textWidth 的记忆 = 每次新建标签量（逐位；字体每次新建、等宽 / 比例数字交替、各字号档、浅 / 深）。

/// 颜色的可比形式：色彩空间名 + 各分量的位（不按容差比）。
func libraryColorKey(_ c: UIColor?) -> String {
    guard let cg = c?.cgColor else { return "nil" }
    let space = (cg.colorSpace?.name as String?) ?? "?"
    return space + ":" + (cg.components ?? []).map { String(Double($0).bitPattern, radix: 16) }.joined(separator: ",")
}

/// 视图上读回来的框（UIView.frame）与设它时用的框 / 独立再算一遍的框：原点差在 accuracy（绝对）以内，尺寸逐位相同。
/// 为什么原点不能逐位比：设 frame 时 UIKit / CALayer 存的是 position = 原点 + 尺寸 × anchorPoint（0.5）与 bounds.size，
/// 读 frame 时再算 position − 尺寸 × 0.5；position 的量级比原点大，原点在这一来一回里会差末一两位
/// （CI 上见过 14.333333333333334 → 14.333333333333336、1.7650000000000001 → 1.7650000000000006）。尺寸原样存、原样读，仍逐位比。
/// 独立再算一遍的框（测试自己从别的视图量回来的数再按式子算，如 marker.bounds.width / 8 × 0.92）本来就只在末位以内相同：
/// exactSize = false，尺寸也按 accuracy 比。
/// 两份都是模型（只算数、不经视图，如两页的 grid / wall）照旧逐位比（XCTAssertEqual）。
func assertFrame(_ view: CGRect, _ want: CGRect, accuracy: CGFloat = 1e-9, exactSize: Bool = true, _ message: String = "",
                 file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertEqual(view.minX, want.minX, accuracy: accuracy, "x: \(view) vs \(want) \(message)", file: file, line: line)
    XCTAssertEqual(view.minY, want.minY, accuracy: accuracy, "y: \(view) vs \(want) \(message)", file: file, line: line)
    if exactSize {
        XCTAssertEqual(view.width, want.width, "width: \(view) vs \(want) \(message)", file: file, line: line)
        XCTAssertEqual(view.height, want.height, "height: \(view) vs \(want) \(message)", file: file, line: line)
    } else {
        XCTAssertEqual(view.width, want.width, accuracy: accuracy, "width: \(view) vs \(want) \(message)", file: file, line: line)
        XCTAssertEqual(view.height, want.height, accuracy: accuracy, "height: \(view) vs \(want) \(message)", file: file, line: line)
    }
}

@MainActor
final class LibraryTokenColorCacheTests: XCTestCase {
    /// 每个颜色令牌（两套主题的并集 + 一个不存在的名字）：缓存给的动态色在浅 / 深下解析出的颜色 = 现解析令牌原文；
    /// 同一个名字反复取仍是各自新建的对象（同改动前：UIKit 颜色属性收到新对象才当场重新解析）。
    func testDynamicColorCacheMatchesFreshParse() throws {
        let lightRaw = ShiziTokens.colorStrings(.light), darkRaw = ShiziTokens.colorStrings(.dark)
        let names = Set(lightRaw.keys).union(darkRaw.keys).sorted() + ["no-such-token"]
        XCTAssertGreaterThan(names.count, 10)
        let light = UITraitCollection(userInterfaceStyle: .light), dark = UITraitCollection(userInterfaceStyle: .dark)
        for name in names {
            let freshLight = NativeInkWire.uiColor(lightRaw[name]), freshDark = NativeInkWire.uiColor(darkRaw[name])
            for round in 0..<2 { // 第一次填缓存，第二次命中
                XCTAssertEqual(libraryColorKey(ShiziTokens.color(name, .light)), libraryColorKey(freshLight), "\(name) light #\(round)")
                XCTAssertEqual(libraryColorKey(ShiziTokens.color(name, .dark)), libraryColorKey(freshDark), "\(name) dark #\(round)")
                let d = ShiziTokens.dynamicColor(name)
                guard freshLight != nil, freshDark != nil else {
                    XCTAssertNil(d, name)
                    continue
                }
                let dyn = try XCTUnwrap(d, name)
                XCTAssertEqual(libraryColorKey(dyn.resolvedColor(with: light)), libraryColorKey(freshLight), "\(name) dynamic light #\(round)")
                XCTAssertEqual(libraryColorKey(dyn.resolvedColor(with: dark)), libraryColorKey(freshDark), "\(name) dynamic dark #\(round)")
            }
            if let a = ShiziTokens.dynamicColor(name) {
                XCTAssertFalse(a === ShiziTokens.dynamicColor(name), name)
            }
        }
    }
}

// MARK: - 墨迹小图：笔画 / 墨色没变不重画

@MainActor
enum LibraryEq {
    /// 一层的状态（layerDump 的一行）。
    typealias Layer = (path: String, line: String, frame: CGRect)

    /// 设了 SHIZI_EQ_LAYERS 时每张截图当场记下各层的状态（全部建出来的页有上万层，每张都记很慢；默认只在两张对不上时才量）。
    static let eagerLayers: Bool = ProcessInfo.processInfo.environment["SHIZI_EQ_LAYERS"] != nil

    /// 一张整窗截图：原始像素 + 截的是哪个窗口（对不上时量各层的状态、打印哪里不同）。
    struct Shot {
        let data: Data
        let width: Int
        let height: Int
        let bytesPerRow: Int
        let scale: CGFloat
        /// 截图那一刻各层的状态：只在 eagerLayers 时有；否则 nil，对不上时从 window 量此刻的。
        let layers: [Layer]?
        weak var window: UIWindow?
    }

    /// 整窗截图（drawHierarchy afterScreenUpdates：真的经过一次渲染，看到的是各层此刻的内容）的原始像素。
    static func snapshot(_ w: UIWindow, file: StaticString = #filePath, line: UInt = #line) throws -> Shot {
        let fmt = UIGraphicsImageRendererFormat.preferred()
        fmt.opaque = true
        var drawn = false
        let img = UIGraphicsImageRenderer(bounds: w.bounds, format: fmt).image { _ in
            drawn = w.drawHierarchy(in: w.bounds, afterScreenUpdates: true)
        }
        XCTAssertTrue(drawn, "drawHierarchy", file: file, line: line)
        let cg = try XCTUnwrap(img.cgImage, file: file, line: line)
        let data = try XCTUnwrap(cg.dataProvider?.data as Data?, file: file, line: line)
        let layers: [Layer]? = eagerLayers ? layerDump(w) : nil
        return Shot(data: data, width: cg.width, height: cg.height, bytesPerRow: cg.bytesPerRow, scale: img.scale, layers: layers, window: w)
    }

    private static func cgKey(_ c: CGColor?) -> String {
        guard let c else { return "-" }
        return libraryColorKey(UIColor(cgColor: c))
    }

    /// 窗口下每个看得见的层：路径、所属视图（类 / 标识）、窗口坐标、底色、描边、不透明度、内容对象；标签另记字色与视图外观。
    static func layerDump(_ w: UIWindow) -> [Layer] {
        var out: [Layer] = []
        func walk(_ l: CALayer, _ path: String) {
            guard !l.isHidden, l.opacity > 0 else { return }
            let view = l.delegate as? UIView
            var name = view.map { String(describing: type(of: $0)) } ?? String(describing: type(of: l))
            if let id = view?.accessibilityIdentifier, !id.isEmpty { name += "#" + id }
            let frame = l.convert(l.bounds, to: w.layer)
            var desc = "\(name) frame=\(frame.integral) bg=\(cgKey(l.backgroundColor)) border=\(l.borderWidth)/\(cgKey(l.borderColor)) op=\(l.opacity)"
            if let c = l.contents {
                let obj = c as AnyObject
                desc += " contents=\(String(describing: type(of: obj)))@\(UInt(bitPattern: ObjectIdentifier(obj).hashValue))"
            }
            if let v = view { desc += " style=\(v.traitCollection.userInterfaceStyle.rawValue)" }
            if let lab = view as? UILabel {
                desc += " text=\(lab.text ?? "") color=\(libraryColorKey(lab.textColor?.resolvedColor(with: lab.traitCollection)))"
            }
            out.append((path, desc, frame))
            for (i, sub) in (l.sublayers ?? []).enumerated() { walk(sub, path + "." + String(i)) }
        }
        walk(w.layer, "0")
        return out
    }

    /// 切换浅 / 深之后，drawHierarchy 的头一两张可能还停在系统重绘的中间（6c21128d 的 CI：两张之间 App 什么都没做、各层状态逐项相同，
    /// 像素仍差 2 万多个）。截到连续两张逐字节相同为止（每次之间跑一小段 run loop、再排版提交），最多 12 次；用了几次打印出来。
    /// 不放宽对照：内容若真的过期且没人安排重画，它会稳定地停在过期的样子上，之后与强制重画 / 新页面的对照照样不等。
    static func stableSnapshot(_ w: UIWindow, _ label: String, file: StaticString = #filePath, line: UInt = #line) throws -> Shot {
        var last = try snapshot(w, file: file, line: line)
        for attempt in 1...12 {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
            LibraryBench.settle(w)
            let next = try snapshot(w, file: file, line: line)
            if next.data == last.data {
                if attempt > 1 { print("[library-eq] \(label): settled after \(attempt) snapshots") }
                return next
            }
            last = next
        }
        XCTFail("\(label): window never settled", file: file, line: line)
        return last
    }

    /// 两张截图逐字节比；不同就打印差异像素的外框（pt）与前几处状态不同的层（状态全同时打印落在外框里的层）。
    static func same(_ a: Shot, _ b: Shot, _ label: String) -> Bool {
        if a.data == b.data { return true }
        print("[library-eq] MISMATCH \(label)")
        guard a.width == b.width, a.height == b.height, a.bytesPerRow == b.bytesPerRow, a.data.count == b.data.count else {
            print("[library-eq]   size differs \(a.width)x\(a.height) vs \(b.width)x\(b.height)")
            return false
        }
        var minX = Int.max, minY = Int.max, maxX = -1, maxY = -1, count = 0
        a.data.withUnsafeBytes { (pa: UnsafeRawBufferPointer) in
            b.data.withUnsafeBytes { (pb: UnsafeRawBufferPointer) in
                for y in 0..<a.height {
                    let row = y * a.bytesPerRow
                    for x in 0..<a.width {
                        let o = row + x * 4
                        if o + 3 < pa.count, pa[o] != pb[o] || pa[o + 1] != pb[o + 1] || pa[o + 2] != pb[o + 2] || pa[o + 3] != pb[o + 3] {
                            count += 1
                            minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
                        }
                    }
                }
            }
        }
        let k = max(1, a.scale)
        let box = maxX < 0 ? CGRect.null : CGRect(x: CGFloat(minX) / k, y: CGFloat(minY) / k, width: CGFloat(maxX - minX + 1) / k, height: CGFloat(maxY - minY + 1) / k)
        print("[library-eq]   \(count) px differ, box(pt)=\(box)")
        // 各层的状态：截图时记下的（eagerLayers），否则此刻从窗口量（两张出自同一个窗口、之间改过状态时，量到的是此刻的）
        let aLayers: [Layer] = layers(of: a), bLayers: [Layer] = layers(of: b)
        if a.layers == nil || b.layers == nil {
            let sameWindow = a.window != nil && a.window === b.window
            print("[library-eq]   layer state measured now, not at capture\(sameWindow ? " (both shots from one window)" : "") — SHIZI_EQ_LAYERS=1 records it at capture")
        }
        if aLayers.isEmpty || bLayers.isEmpty { // 有一张的窗口已经关了：只列另一张落在外框里的层
            print("[library-eq]   one window is gone; layers over the box (innermost last):")
            for e in (aLayers.isEmpty ? bLayers : aLayers).filter({ $0.frame.intersects(box) }).suffix(10) { print("[library-eq]     \(e.path) \(e.line)") }
            return false
        }
        let before = Dictionary(aLayers.map { ($0.path, $0.line) }, uniquingKeysWith: { x, _ in x })
        let after = Dictionary(bLayers.map { ($0.path, $0.line) }, uniquingKeysWith: { x, _ in x })
        var shown = 0
        for e in bLayers where before[e.path] != e.line && shown < 12 {
            print("[library-eq]   layer \(e.path)\n      was: \(before[e.path] ?? "(absent)")\n      now: \(e.line)")
            shown += 1
        }
        for e in aLayers where after[e.path] == nil && shown < 12 {
            print("[library-eq]   layer \(e.path) gone: \(e.line)")
            shown += 1
        }
        if shown == 0, !box.isNull {
            print("[library-eq]   layer state identical; layers over the box (innermost last):")
            for e in aLayers.filter({ $0.frame.intersects(box) }).suffix(10) { print("[library-eq]     \(e.path) \(e.line)") }
        }
        return false
    }

    /// 一张截图的各层状态：截图时记下的，否则此刻从它的窗口量（窗口已经关了 → 空）。
    static func layers(of s: Shot) -> [Layer] {
        if let l = s.layers { return l }
        if let w = s.window { return layerDump(w) }
        return []
    }

    static func inkViews(_ v: UIView) -> [LibraryInkView] {
        var out: [LibraryInkView] = []
        if let iv = v as? LibraryInkView { out.append(iv) }
        for sub in v.subviews { out += inkViews(sub) }
        return out
    }

    /// 回包里某一格（全部字页：按出现顺序数第 index 格）改一下。
    static func editCell(_ payload: [String: Any], _ index: Int, _ edit: (inout [String: Any]) -> Void) -> [String: Any] {
        guard var view = payload["view"] as? [String: Any], var groups = view["groups"] as? [Any] else { return payload }
        var seen = 0
        for gi in groups.indices {
            guard var g = groups[gi] as? [String: Any], var cells = g["cells"] as? [Any] else { continue }
            if index < seen + cells.count, var c = cells[index - seen] as? [String: Any] {
                edit(&c)
                cells[index - seen] = c
                g["cells"] = cells
                groups[gi] = g
                view["groups"] = groups
                var out = payload
                out["view"] = view
                return out
            }
            seen += cells.count
        }
        return payload
    }

    /// 一页连续收几份回包（每份之后排版 + 提交）、再排一次版，浅色下截图；把每格墨迹强制重画（= 改动前每次都重画）后再截；
    /// 切到深色重复一遍。另开一个新页面只收最后一份，同样先浅后深各截一次（两页的外观切换经历相同，只差回包的先后）。
    /// 同一外观下：连收几份 = 强制重画 = 新页面，逐字节相同。
    static func checkNoStaleInk(_ make: () -> ShiziScreenViewController, steps: [[String: Any]], requireInk: Bool = true,
                                file: StaticString = #filePath, line: UInt = #line) throws {
        let styles: [UIUserInterfaceStyle] = [.light, .dark]
        var shots: [Shot] = []
        do {
            let vc = make()
            let w = LibraryBench.host(vc)
            defer { LibraryBench.unhost(w) }
            w.overrideUserInterfaceStyle = .light
            for p in steps {
                vc.apply(payload: p)
                LibraryBench.settle(w)
            }
            vc.view.setNeedsLayout() // 再排一次版（内容不变）
            LibraryBench.settle(w)
            if requireInk { XCTAssertFalse(inkViews(w).filter { !$0.isHidden }.isEmpty, file: file, line: line) }
            for style in styles {
                w.overrideUserInterfaceStyle = style
                LibraryBench.settle(w)
                let seq = try stableSnapshot(w, "\(style.rawValue) sequence", file: file, line: line)
                for v in inkViews(w) { v.setNeedsDisplay() }
                LibraryBench.settle(w)
                let forced = try stableSnapshot(w, "\(style.rawValue) forced", file: file, line: line)
                let ok = same(seq, forced, "\(style.rawValue): sequence vs forced redraw")
                XCTAssertTrue(ok, "\(style.rawValue): sequence vs forced redraw", file: file, line: line)
                shots.append(seq)
            }
        }
        let vc2 = make()
        let w2 = LibraryBench.host(vc2)
        defer { LibraryBench.unhost(w2) }
        w2.overrideUserInterfaceStyle = .light
        vc2.apply(payload: steps[steps.count - 1])
        LibraryBench.settle(w2)
        for (i, style) in styles.enumerated() {
            w2.overrideUserInterfaceStyle = style
            LibraryBench.settle(w2)
            let fresh = try stableSnapshot(w2, "\(style.rawValue) fresh", file: file, line: line)
            let ok = i < shots.count && same(shots[i], fresh, "\(style.rawValue): sequence vs fresh page")
            XCTAssertTrue(ok, "\(style.rawValue): sequence vs fresh page", file: file, line: line)
        }
    }
}

@MainActor
final class LibraryInkRedrawGuardTests: XCTestCase {
    private func pts(_ seed: Int) -> [[LibraryInkView.Point]] {
        (0..<3).map { s in (0..<20).map { j in LibraryInkView.Point(x: Double(j * 7 + s), y: Double(seed + j), w: j % 5 == 0 ? nil : 8.5) } }
    }

    /// 同一份笔画 / 同一墨色再设一次不标重画；笔画（哪怕一个点、一个 w）或墨色（按本视图外观解析）变了照旧标重画。
    func testSameStrokesDoNotMarkForRedisplay() {
        let v = LibraryInkView(frame: CGRect(x: 0, y: 0, width: 50, height: 50))
        let ink = UIColor.red
        v.strokes = pts(1)
        v.ink = ink
        XCTAssertTrue(v.layer.needsDisplay())
        v.layer.displayIfNeeded()
        XCTAssertFalse(v.layer.needsDisplay())
        v.strokes = pts(1) // 另一份、内容相同
        v.ink = ink
        XCTAssertFalse(v.layer.needsDisplay())
        var moved = pts(1)
        moved[2][19] = LibraryInkView.Point(x: moved[2][19].x, y: moved[2][19].y, w: 8.25)
        v.strokes = moved
        XCTAssertTrue(v.layer.needsDisplay())
        v.layer.displayIfNeeded()
        var noW = moved
        noW[0][1] = LibraryInkView.Point(x: noW[0][1].x, y: noW[0][1].y, w: nil)
        v.strokes = noW
        XCTAssertTrue(v.layer.needsDisplay())
        v.layer.displayIfNeeded()
        v.ink = UIColor(red: 0, green: 0, blue: 1, alpha: 1) // 颜色变了 → 重画
        XCTAssertTrue(v.layer.needsDisplay())
        v.layer.displayIfNeeded()
        let wall = ShiziTokens.dynamicColor("wall1")
        v.ink = wall ?? .label
        XCTAssertTrue(v.layer.needsDisplay())
        v.layer.displayIfNeeded()
        v.ink = ShiziTokens.dynamicColor("wall1") ?? .label // 另一个对象、按本视图外观解析出同一颜色 → 不重画
        XCTAssertFalse(v.layer.needsDisplay())
        v.ink = ShiziTokens.dynamicColor("wall4") ?? .label
        XCTAssertTrue(v.layer.needsDisplay())
        v.layer.displayIfNeeded()
        v.strokes = []
        XCTAssertTrue(v.layer.needsDisplay())
    }

    func testPointEqualityIsFieldwise() {
        typealias P = LibraryInkView.Point
        XCTAssertEqual(P(x: 1, y: 2, w: 3), P(x: 1, y: 2, w: 3))
        XCTAssertEqual(P(x: 1, y: 2, w: nil), P(x: 1, y: 2, w: nil))
        XCTAssertNotEqual(P(x: 1, y: 2, w: nil), P(x: 1, y: 2, w: 0))
        XCTAssertNotEqual(P(x: 1, y: 2, w: 3), P(x: 1.0000000000000002, y: 2, w: 3))
        XCTAssertNotEqual(P(x: .nan, y: 2, w: 3), P(x: .nan, y: 2, w: 3)) // NaN 不等 → 重画（保守）
    }

    /// 全部字页：同一份回包连收两次、换掉一格的笔画、去掉一格的墨迹（改画字形）、改一格的新旧档（墨色），截图逐字节相同。
    func testLibraryAllPixelsMatchForcedRedraw() throws {
        let p1 = LibraryBench.allPayload(48, ink: true)
        var p2 = p1
        var ink = p1["ink"] as? [String: Any] ?? [:]
        ink["r3"] = LibraryBench.strokes(97)
        ink["r5"] = nil
        p2["ink"] = ink
        p2 = LibraryEq.editCell(p2, 7) { c in c["tone"] = LibraryBench.num(Double((((c["tone"] as? NSNumber)?.intValue ?? 0) + 1) % 4)) }
        try LibraryEq.checkNoStaleInk({ LibraryAllScreen(screen: "library-all", entryId: "eq", params: [:]) }, steps: [p1, p1, p2, p2])
    }

    /// 清单页：同上（换一行的笔画、去掉一行的墨迹）。
    func testLibraryListPixelsMatchForcedRedraw() throws {
        let p1 = LibraryBench.listPayload(12, ink: true)
        var p2 = p1
        var ink = p1["ink"] as? [String: Any] ?? [:]
        ink["r1"] = LibraryBench.strokes(55)
        ink["r2"] = nil
        p2["ink"] = ink
        try LibraryEq.checkNoStaleInk({ LibraryListScreen(screen: "library-list", entryId: "eq", params: ["kind": "due"]) }, steps: [p1, p1, p2, p2])
    }
}

// MARK: - 字形图缓存

@MainActor
final class LibraryGlyphCacheTests: XCTestCase {
    private func bytes(_ img: UIImage?) -> Data? {
        guard let img, let cg = img.cgImage else { return nil }
        var d = Data("\(cg.width)x\(cg.height)@\(img.scale) \(cg.bitsPerPixel) \(cg.bytesPerRow) \(cg.bitmapInfo.rawValue)|".utf8)
        d.append((cg.dataProvider?.data as Data?) ?? Data())
        return d
    }

    /// 缓存的键用「画之前」按当前外观解析的颜色；字形图里 color.cgColor 在渲染闭包里解析——两处的当前外观必须相同。
    func testImageRendererKeepsTheCurrentTraits() {
        for style in [UIUserInterfaceStyle.light, .dark] {
            UITraitCollection(userInterfaceStyle: style).performAsCurrent {
                var inside = UIUserInterfaceStyle.unspecified
                let fmt = UIGraphicsImageRendererFormat.preferred()
                _ = UIGraphicsImageRenderer(size: CGSize(width: 2, height: 2), format: fmt).image { _ in
                    inside = UITraitCollection.current.userInterfaceStyle
                }
                XCTAssertEqual(inside, style)
            }
        }
    }

    /// 字 × 边长 × 字面比例 × 双钩 × 颜色 × 浅 / 深：缓存给的图 = 现画的图（逐字节）；第二次取是同一张；跨轮（endPass）仍相同。
    func testCachedGlyphsMatchFreshRenders() throws {
        let cache = LibraryGlyphCache()
        let chars = LibraryBench.chars(4) + ["永", "\u{E000}"] // 最后一个包里没有字形数据 → 两边都是 nil
        let colors = try ["wall1", "wall4", "ink4", "ink1"].map { try XCTUnwrap(ShiziTokens.dynamicColor($0), $0) } + [UIColor.label]
        var compared = 0
        for round in 0..<2 {
            for style in [UIUserInterfaceStyle.light, .dark] {
                UITraitCollection(userInterfaceStyle: style).performAsCurrent {
                    for ch in chars {
                        for size in [CGFloat(44.875), 45.125, 0] {
                            for face in [CGFloat(0.8), 0.7] {
                                for hollow in [false, true] {
                                    for color in colors {
                                        let a = cache.image(ch, size: size, face: face, color: color, hollow: hollow)
                                        let b = LibraryGlyph.image(ch, size: size, face: face, color: color, hollow: hollow)
                                        XCTAssertEqual(a == nil, b == nil, "\(ch) \(size) \(face) \(hollow) \(style.rawValue)")
                                        XCTAssertTrue(bytes(a) == bytes(b), "\(ch) \(size) \(face) \(hollow) \(style.rawValue) #\(round)")
                                        let again = cache.image(ch, size: size, face: face, color: color, hollow: hollow)
                                        XCTAssertTrue(again === a, "\(ch) \(size) hit")
                                        if a != nil { compared += 1 }
                                    }
                                }
                            }
                        }
                    }
                }
                cache.endPass()
            }
        }
        XCTAssertGreaterThan(compared, 100)
    }

    /// 全部字页（全字形）：同一份回包两次、改几格的新旧档（颜色）与空心 / 换字、再排一次版之后的整窗截图 = 新页面直接收最后一份（浅 / 深）。
    func testLibraryAllGlyphPixelsMatchFreshPage() throws {
        let g1 = LibraryBench.allPayload(48, ink: false)
        var g2 = LibraryEq.editCell(g1, 2) { c in c["tone"] = LibraryBench.num(0) }
        g2 = LibraryEq.editCell(g2, 9) { c in c["kind"] = "hollow" }
        g2 = LibraryEq.editCell(g2, 11) { c in c["char"] = "永" }
        try LibraryEq.checkNoStaleInk({ LibraryAllScreen(screen: "library-all", entryId: "eq", params: [:]) }, steps: [g1, g1, g2, g2], requireInk: false)
    }

    /// 清单页（无墨迹）：同上。
    func testLibraryListGlyphPixelsMatchFreshPage() throws {
        let l1 = LibraryBench.listPayload(12, ink: false)
        try LibraryEq.checkNoStaleInk({ LibraryListScreen(screen: "library-list", entryId: "eq", params: ["kind": "due"]) }, steps: [l1, l1], requireInk: false)
    }
}

// MARK: - 墨迹直接读（不经 JSON 往返）

@MainActor
final class LibraryInkDecodeTests: XCTestCase {
    typealias Strokes = [String: [[LibraryInkView.Point]]]

    /// 改动前的路（render 里原来的那一行）。
    private func old(_ ink: [String: Any]) -> Strokes { (try? ShiziDecode.value(ink, as: Strokes.self)) ?? [:] }

    /// 逐位的可比形式（w：nil → [0]，有 → [1, 位]）。
    private func bits(_ d: Strokes) -> [String: [[[UInt64]]]] {
        func one(_ p: LibraryInkView.Point) -> [UInt64] {
            var out: [UInt64] = [p.x.bitPattern, p.y.bitPattern]
            if let w = p.w { out += [1, w.bitPattern] } else { out.append(0) }
            return out
        }
        return d.mapValues { strokes in strokes.map { stroke in stroke.map(one) } }
    }

    /// legacy = 同一份墨迹的旧形状（每点一个对象；缺省 = ink 本身就是旧形状）：新路解 ink = 原路解 legacy，逐位相同。
    private func check(_ ink: [String: Any], legacy: [String: Any]? = nil, direct expectDirect: Bool, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        let ref = old(legacy ?? ink)
        XCTAssertEqual(LibraryInkView.decodeInkDirect(ink) != nil, expectDirect, "\(what): direct path taken", file: file, line: line)
        XCTAssertEqual(bits(LibraryInkView.decodeInk(ink)), bits(ref), what, file: file, line: line)
        checkStore(ink, what, file: file, line: line)
    }

    /// 按需解码（LibraryInkStore，全部字页用的）= 整份 decodeInk 的那一条（逐位；回包里没有的记录 = 空、has = false）；
    /// isRecordDirect = decodeRecordDirect 解得出来。
    private func checkStore(_ ink: [String: Any], _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        let whole = LibraryInkView.decodeInk(ink)
        let store = LibraryInkStore()
        store.load(ink)
        for id in Array(ink.keys) + ["no-such-record"] {
            for round in 0..<2 { // 第一次解，第二次命中留着的
                XCTAssertEqual(bits([id: store.strokes(id)]), bits([id: whole[id] ?? []]), "\(what): store \(id) #\(round)", file: file, line: line)
                XCTAssertEqual(store.has(id), whole[id] != nil, "\(what): has \(id)", file: file, line: line)
            }
            if let raw = ink[id] {
                XCTAssertEqual(LibraryInkView.isRecordDirect(raw), LibraryInkView.decodeRecordDirect(raw) != nil, "\(what): isRecordDirect \(id)", file: file, line: line)
            }
        }
    }

    private func pt(_ x: Any, _ y: Any, _ w: Any? = nil) -> [String: Any] {
        var o: [String: Any] = ["x": x, "y": y]
        if let w { o["w"] = w }
        return o
    }

    /// 合成回包（同量测：LibraryInkWire 拼、EngineValue.any 过边界）：平铺形状 = 旧形状经原路，旧形状直接读 = 原路。
    func testSyntheticPayloadsMatch() throws {
        for n in [0, 1, 37] {
            let ink = try XCTUnwrap(LibraryBench.allPayload(max(n, 1), ink: n > 0)["ink"] as? [String: Any])
            let legacy = try XCTUnwrap(LibraryBench.allPayload(max(n, 1), ink: n > 0, legacy: true)["ink"] as? [String: Any])
            check(ink, legacy: legacy, direct: true, "bench n=\(n)")
            check(legacy, direct: true, "bench legacy n=\(n)")
            if n > 0 { XCTAssertEqual(bits(old(legacy)).count, n) }
        }
    }

    /// 随机位型的有限 Double、0…345 的常见值、±2^53 以内的整数（NSNumber Int64 / Int32 / Int16、Swift 原生 Int / Double）、
    /// 缺 w / null w / w 为整数、空笔画、一个点的笔画、没有笔画的记录、多余的键。
    func testRandomAndEdgePayloadsMatch() {
        var rng = WebInkTestRNG(state: 20261105)
        func finite() -> Double {
            while true {
                let d = Double(bitPattern: rng.next())
                if d.isFinite, !(d == 0 && d.sign == .minus) { return d }
            }
        }
        func value(_ k: Int) -> Any {
            switch k % 9 {
            case 0: return NSNumber(value: finite())
            case 1: return EngineValue.any(.number(Double.random(in: 0...345, using: &rng)))
            case 2: return EngineValue.any(.number((Double.random(in: 0...3450, using: &rng)).rounded() / 10))
            case 3: return NSNumber(value: Int64.random(in: -(1 << 53)...(1 << 53), using: &rng))
            case 4: return NSNumber(value: Int32.random(in: Int32.min...Int32.max, using: &rng))
            case 5: return NSNumber(value: Int16.random(in: Int16.min...Int16.max, using: &rng))
            case 6: return Double.random(in: -1e6...1e6, using: &rng) // Swift 原生 Double
            case 7: return Int.random(in: -1000...1000, using: &rng) // Swift 原生 Int
            default: return NSNumber(value: [Double.leastNonzeroMagnitude, -Double.leastNonzeroMagnitude, Double.greatestFiniteMagnitude,
                                            -Double.greatestFiniteMagnitude, Double.leastNormalMagnitude, 0.1, 1.0 / 3, 0][Int.random(in: 0..<8, using: &rng)])
            }
        }
        for round in 0..<40 {
            var ink: [String: Any] = [:]
            for r in 0..<Int.random(in: 0...6, using: &rng) {
                var strokes: [Any] = []
                for _ in 0..<Int.random(in: 0...4, using: &rng) {
                    var pts: [Any] = []
                    for _ in 0..<Int.random(in: 0...30, using: &rng) {
                        let k = Int.random(in: 0..<1000, using: &rng)
                        var o: [String: Any] = ["x": value(k), "y": value(k / 9)]
                        switch k % 4 {
                        case 0: break // 缺 w
                        case 1: o["w"] = NSNull()
                        default: o["w"] = value(k / 81)
                        }
                        if k % 13 == 0 { o["t"] = NSNumber(value: 12.5) } // 多余的键
                        pts.append(o)
                    }
                    strokes.append(pts)
                }
                ink["rec-\(round)-\(r)"] = strokes
            }
            check(ink, direct: true, "random #\(round)")
        }
        let limit = Int64(1) << 53
        check(["a": [[pt(NSNumber(value: limit), NSNumber(value: -limit), NSNumber(value: limit - 1))]]], direct: true, "±2^53")
        check(["a": [[pt(NSNumber(value: 0.0), NSNumber(value: Int64(0)), NSNumber(value: 0))]]], direct: true, "zeros")
        check(["a": [[Any]](), "b": [[pt(1.5, 2.5)]]], direct: true, "record without strokes")
        check(["a": [[Any](), [pt(3, 4, 5)]]], direct: true, "empty stroke")
    }

    /// 引擎拼的回包（LibraryInkWire）：同一份点，平铺形状过边界（EngineValue.any）后新路解出的 = 旧形状过边界后原路解出的，逐位相同。
    /// 点：w 全有 / 全无 / 混着、空笔、一个点、没有笔画的记录、x / y / w 里夹 NaN / ±∞（引擎丢掉或当缺省）、±0（EngineValue.any 把 −0 装成整数 0，两种形状同此）、
    /// 极大极小的有限数、2^53 附近与 9e15 附近的整数、随机位型。
    func testEngineFlatPayloadsDecodeLikeTheLegacyPayload() {
        var rng = WebInkTestRNG(state: 20261106)
        let specials: [Double] = [0, -0.0, 1, -1, 0.5, 0.1, 1.0 / 3, 345, -345, .greatestFiniteMagnitude, -.greatestFiniteMagnitude, .leastNonzeroMagnitude,
                                  -.leastNonzeroMagnitude, .leastNormalMagnitude, 9e15, -9e15, 8999999999999999, 9007199254740992, -9007199254740992, 9007199254740994, 1e-300]
        let bad: [Double] = [.nan, .infinity, -.infinity]
        func finite() -> Double {
            switch rng.next() % 4 {
            case 0: return specials[Int(rng.next() % UInt64(specials.count))]
            case 1: return Double.random(in: 0...345, using: &rng)
            case 2: return (Double.random(in: 0...3450, using: &rng)).rounded() / 10
            default:
                while true {
                    let d = Double(bitPattern: rng.next())
                    if d.isFinite { return d }
                }
            }
        }
        func value(_ badRate: UInt64) -> Double { badRate > 0 && rng.next() % badRate == 0 ? bad[Int(rng.next() % 3)] : finite() }
        func stroke() -> [InkPoint] {
            let n = Int(rng.next() % 30), mode = rng.next() % 5, badRate: UInt64 = rng.next() % 3 == 0 ? 0 : 1 + rng.next() % 40
            return (0..<n).map { _ in
                let w: Double?
                switch mode {
                case 0: w = value(badRate)
                case 1: w = nil
                case 2: w = rng.next() % 2 == 0 ? value(badRate) : nil
                case 3: w = rng.next() % 40 == 0 ? nil : value(badRate)
                default: w = rng.next() % 40 == 0 ? value(0) : nil
                }
                return InkPoint(x: value(badRate), y: value(badRate), w: w)
            }
        }
        func payloads(_ records: [(String, [[InkPoint]])]) -> (flat: [String: Any], legacy: [String: Any]) {
            var flat = JSObject(), legacy = JSObject()
            for (id, strokes) in records {
                if let v = LibraryInkWire.record(strokes) { flat[id] = v }
                if let v = LibraryInkWire.record(strokes, legacy: true) { legacy[id] = v }
            }
            return (EngineValue.any(.object(flat)) as? [String: Any] ?? ["?": "not a dictionary"], EngineValue.any(.object(legacy)) as? [String: Any] ?? ["?": "not a dictionary"])
        }
        func checkRecords(_ records: [(String, [[InkPoint]])], _ what: String) {
            let (flat, legacy) = payloads(records)
            check(flat, legacy: legacy, direct: true, what)
            check(legacy, direct: true, "\(what) (legacy)")
        }
        checkRecords([], "no records")
        checkRecords([("a", [])], "a record without strokes")
        checkRecords([("a", [[]]), ("b", [[], [InkPoint(x: 1, y: 2, w: 3)]])], "empty strokes")
        checkRecords([("a", [[InkPoint(x: 1, y: 2, w: 3)]]), ("b", [[InkPoint(x: 1, y: 2)]])], "single points")
        checkRecords([("a", [[InkPoint(x: -0.0, y: 0, w: -0.0), InkPoint(x: 0, y: -0.0, w: 0)], [InkPoint(x: -0.0, y: -0.0)]])], "signed zeros")
        checkRecords([("a", [[InkPoint(x: 1, y: 2, w: 3), InkPoint(x: 4, y: 5)], [InkPoint(x: 1, y: 2, w: .nan), InkPoint(x: 4, y: 5, w: 6)]])], "mixed w")
        checkRecords([("a", [[InkPoint(x: .nan, y: 2, w: 3), InkPoint(x: 4, y: .infinity)], [InkPoint(x: .nan, y: 2), InkPoint(x: 4, y: 5, w: 6)]])], "dropped points")
        checkRecords([("a", [specials.map { InkPoint(x: $0, y: -$0, w: $0) }, specials.map { InkPoint(x: -$0, y: $0) }])], "specials")
        for round in 0..<120 {
            let records: [(String, [[InkPoint]])] = (0..<Int(rng.next() % 6)).map { r in ("rec-\(round)-\(r)", (0..<Int(rng.next() % 5)).map { _ in stroke() }) }
            checkRecords(records, "random #\(round)")
        }
    }

    /// 不是引擎拼出来的平铺（App 里别的来源、−0 的 NSNumber、形状不对）：新路解 = 把它手工展开成旧形状后原路解；展开不了的 = 原路解原样（解不了 = 空）。
    func testFlatEdgeShapesDecodeLikeTheirLegacyExpansion() {
        let negZero = NSNumber(value: -0.0)
        func expands(_ what: String, _ flat: [String: Any], _ legacy: [String: Any], direct: Bool) {
            check(flat, legacy: legacy, direct: direct, what)
            XCTAssertEqual(bits(LibraryInkView.decodeInk(flat)), bits(LibraryInkView.decodeInk(legacy)), "\(what): new path on both shapes")
        }
        expands("xyw", ["a": [[3, 1.5, 2, 3.25, 4, 5, 6] as [Any]]], ["a": [[pt(1.5, 2, 3.25), pt(4, 5, 6)]]], direct: true)
        expands("xy", ["a": [[2, 1.5, 2, 4, 5] as [Any]]], ["a": [[pt(1.5, 2), pt(4, 5)]]], direct: true)
        expands("header only", ["a": [[3] as [Any], [2] as [Any]]], ["a": [[Any](), [Any]()]], direct: true)
        expands("flat and legacy strokes in one record", ["a": [[2, 1, 2] as [Any], [pt(3, 4, 5)]] as [Any]], ["a": [[pt(1, 2)], [pt(3, 4, 5)]]], direct: true)
        let big = NSNumber(value: Int64(1) << 53)
        expands("Int64 / Int32 / Int16 numbers", ["a": [[NSNumber(value: Int64(3)), NSNumber(value: Int32(7)), big, NSNumber(value: Int16(-2))] as [Any]]],
                ["a": [[pt(NSNumber(value: Int32(7)), big, NSNumber(value: Int16(-2)))]]], direct: true)
        expands("negative zero x", ["a": [[3, negZero, 2, 3] as [Any]]], ["a": [[pt(negZero, 2, 3)]]], direct: false)
        expands("negative zero w", ["a": [[3, 1, 2, negZero] as [Any]], "b": [[2, 1, 2] as [Any]]], ["a": [[pt(1, 2, negZero)]], "b": [[pt(1, 2)]]], direct: false)
        let float = NSNumber(value: Float(0.1))
        expands("float w", ["a": [[3, 1, 2, float] as [Any]]], ["a": [[pt(1, 2, float)]]], direct: false)
        expands("null w", ["a": [[3, 1, 2, NSNull()] as [Any]]], ["a": [[pt(1, 2, NSNull())]]], direct: false)
        expands("bool x", ["a": [[2, true, 2] as [Any]]], ["a": [[pt(true, 2)]]], direct: false)
        let past = NSNumber(value: (Int64(1) << 53) + 1)
        expands("2^53 + 1", ["a": [[2, past, 2] as [Any]]], ["a": [[pt(past, 2)]]], direct: false)
        // 不是平铺、也不是旧形状：展开不动，与原路解原样一样（解不了 → 空）
        func broken(_ what: String, _ ink: [String: Any]) {
            XCTAssertNil(LibraryInkView.decodeInkDirect(ink), "\(what): direct path not taken")
            XCTAssertEqual(bits(LibraryInkView.decodeInk(ink)), bits(old(ink)), what)
            checkStore(ink, what) // 一条坏的整份清空：按需解码的那一条也是空（不是只把坏的那条当空）
        }
        broken("header 4", ["a": [[4, 1, 2, 3, 4] as [Any]]])
        broken("header 3, count not a multiple", ["a": [[3, 1, 2] as [Any]]])
        broken("header 2, count not a multiple", ["a": [[2, 1, 2, 3] as [Any]]])
        broken("header 2.5", ["a": [[2.5, 1, 2] as [Any]]])
        broken("header bool", ["a": [[true, 1, 2] as [Any]]])
        broken("header string", ["a": [["3", 1, 2, 3] as [Any]]])
        broken("header null", ["a": [[NSNull(), 1, 2] as [Any]]])
        broken("header -0", ["a": [[negZero, 1, 2] as [Any]]])
        broken("string inside", ["a": [[2, "1", 2] as [Any]]])
        broken("one good record, one broken", ["a": [[2, 1, 2] as [Any]], "b": [[3, 1] as [Any]]])
        XCTAssertTrue(LibraryInkView.decodeInk(["a": [[2, 1, 2] as [Any]], "b": [[3, 1] as [Any]]]).isEmpty, "one broken record empties the whole map, as before")
    }

    /// 直接读不认得的形状：交回原路（结果当然与原路相同；这里也确认确实没走直接读）。
    func testUnrecognisedShapesFallBack() {
        let cases: [(String, [String: Any])] = [
            ("bool x", ["a": [[pt(true, 2)]]]),
            ("bool w", ["a": [[pt(1, 2, false)]]]),
            ("string w", ["a": [[pt(1, 2, "3")]]]),
            ("null x", ["a": [[pt(NSNull(), 2)]]]),
            ("missing y", ["a": [[["x": 1] as [String: Any]]]]),
            ("float w", ["a": [[pt(1, 2, NSNumber(value: Float(0.1)))]]]),
            ("negative zero", ["a": [[pt(NSNumber(value: -0.0), 2)]]]),
            ("2^53 + 1", ["a": [[pt(NSNumber(value: (Int64(1) << 53) + 1), 2)]]]),
            ("unsigned", ["a": [[pt(NSNumber(value: UInt64.max), 2)]]]),
            ("point not object", ["a": [[NSNumber(value: 1)]]]),
            ("stroke not array", ["a": [pt(1, 2)]]),
            ("record not array", ["a": "x"]),
        ]
        for (what, ink) in cases { check(ink, direct: false, what) }
    }
}

// MARK: - textWidth 的记忆

@MainActor
final class LibraryTextWidthMemoTests: XCTestCase {
    private let texts = ["", "全选", "全不选", "1111", "0000", "写过 3 次 ·", "上次 10 天前", "排序 · 筛选", "Abc 123", "「修改」", "，。",
                         "看这些字 ›", "写错那次", "2026年10月", "40 个字", "🙂 x"]

    /// 字体每次现做（同页面每次调 metrics.font）：系统字 11 / 13 / 15 / 17 / 17 中、等宽数字 15、宋 22 中、楷 22；默认档与两个大字号档。
    private func fonts() -> [(String, () -> UIFont)] {
        var out: [(String, () -> UIFont)] = []
        for cat in [UIContentSizeCategory.large, .extraExtraExtraLarge, .accessibilityExtraExtraLarge] {
            let mt = ShiziMetrics(cat)
            let c = cat.rawValue
            out.append(("\(c) fs11", { mt.font(11) }))
            out.append(("\(c) fs13", { mt.font(13) }))
            out.append(("\(c) fs15", { mt.font(15) }))
            out.append(("\(c) fs17", { mt.font(17) }))
            out.append(("\(c) fs17m", { mt.font(17, .medium) }))
            out.append(("\(c) tab15", { mt.fontTabular(15) }))
            out.append(("\(c) song22", { NativeType.song(size: mt.value("fs22"), weight: .medium) }))
            out.append(("\(c) kai22", { ShiziFonts.kai(size: mt.value("fs22")) }))
        }
        return out
    }

    func testMemoisedWidthsMatchFreshMeasurement() {
        let fs = fonts()
        var hits = 0
        for style in [UIUserInterfaceStyle.light, .dark] {
            UITraitCollection(userInterfaceStyle: style).performAsCurrent {
                for round in 0..<2 { // 第一次填，第二次命中（字体对象是新的）
                    for (name, make) in fs {
                        for text in texts {
                            let memo = LibraryCommon.textWidth(text, make())
                            let fresh = LibraryCommon.measureTextWidth(text, make())
                            XCTAssertEqual(memo.bitPattern, fresh.bitPattern, "\(name) \(text) \(style.rawValue) #\(round)")
                            if round == 1 { hits += 1 }
                        }
                    }
                }
            }
        }
        XCTAssertGreaterThan(hits, 0)
    }

    /// 只差等宽数字特性的两个字体各量各的（键分得开）：交替取，结果始终 = 各自现量。
    func testTabularAndProportionalDigitsStayApart() {
        let mt = ShiziMetrics(.large)
        for _ in 0..<3 {
            for text in ["1111", "1010 · 11", "上次 11 天前"] {
                XCTAssertEqual(LibraryCommon.textWidth(text, mt.font(15)).bitPattern, LibraryCommon.measureTextWidth(text, mt.font(15)).bitPattern, text)
                XCTAssertEqual(LibraryCommon.textWidth(text, mt.fontTabular(15)).bitPattern, LibraryCommon.measureTextWidth(text, mt.fontTabular(15)).bitPattern, text)
            }
        }
    }
}

// MARK: - 全部字页只建看得见的格子（ShiziLazyCells）

/// 全部字页的两种建法：只建可见框 ± overscan 的（产品）与全部建出来（materializeAll = 以前一次建完的做法，同一套配置代码）。
@MainActor
enum LibraryVirtual {
    static func make(all: Bool) -> LibraryAllScreen {
        let vc = LibraryAllScreen(screen: "library-all", entryId: all ? "eq-all" : "eq-virtual", params: [:])
        vc.cells.materializeAll = all
        return vc
    }

    /// 回包：n 格（每 40 格一组、按月排）；每 9 格有一格写错过（朱点、画字形）、每 13 格有一格查找命中（命中圈）。
    static func payload(_ n: Int, ink: Bool) -> [String: Any] {
        var p = LibraryBench.allPayload(n, ink: ink)
        for i in stride(from: 4, to: n, by: 9) { p = LibraryEq.editCell(p, i) { $0["kind"] = "wrong" } }
        for i in stride(from: 6, to: n, by: 13) { p = LibraryEq.editCell(p, i) { $0["hit"] = true } }
        return p
    }

    /// 页面里的分组视图（content 里按顺序加进去的，= 页面的 groupViews）。
    static func groups(_ vc: LibraryAllScreen) -> [LibraryAllScreen.GroupView] {
        vc.content.subviews.compactMap { $0 as? LibraryAllScreen.GroupView }
    }

    /// 一格的状态摘要：框、读屏名、标识、图标框、字形图的像素、拼音、墨迹（框 / 笔画 / 看得见时的墨色）、朱点、命中圈。
    struct Digest: Equatable, CustomStringConvertible {
        var frame: CGRect
        var composed: String
        var label: String?
        var id: String?
        var icon: CGSize
        var image: Data?
        var pyHidden: Bool
        var pyText: String?
        var pyFrame: CGRect
        var inkHidden: Bool
        var inkFrame: CGRect
        var strokes: [[LibraryInkView.Point]]
        var inkColor: String
        var markHidden: Bool?
        var ringHidden: Bool?
        var ringBorder: String

        var description: String {
            "frame=\(frame) label=\(label ?? "-") image=\(image?.count ?? -1)B py=\(pyHidden)/\(pyText ?? "") ink=\(inkHidden)/\(strokes.count)/\(inkColor) mark=\(String(describing: markHidden)) ring=\(String(describing: ringHidden))"
        }
    }

    static func digest(_ s: LibraryAllScreen.CellSlot, _ traits: UITraitCollection) -> Digest {
        let b = s.button
        let ring = b.viewWithTag(9002)
        return Digest(frame: b.frame, composed: b.composed, label: b.accessibilityLabel, id: b.accessibilityIdentifier, icon: b.iconSize,
                      image: b.image(for: .normal)?.cgImage?.dataProvider?.data as Data?,
                      pyHidden: s.py.isHidden, pyText: s.py.attributedText?.string ?? s.py.text, pyFrame: s.py.frame,
                      inkHidden: s.ink.isHidden, inkFrame: s.ink.frame, strokes: s.ink.strokes,
                      inkColor: s.ink.isHidden ? "-" : libraryColorKey(s.ink.ink.resolvedColor(with: traits)),
                      markHidden: b.viewWithTag(9001)?.isHidden, ringHidden: ring?.isHidden,
                      ringBorder: ring?.layer.borderColor.map { libraryColorKey(UIColor(cgColor: $0)) } ?? "-")
    }

    /// 视图树：每组的墙格里正好是这一组建出来的格子（按序号，按钮后面紧跟它的墨迹小图），没有多余的。
    static func hierarchyProblems(_ vc: LibraryAllScreen) -> [String] {
        let gvs = groups(vc)
        var want: [ObjectIdentifier: [UIView]] = [:]
        var out: [String] = []
        for i in vc.cells.liveIndices {
            guard let s = vc.cells.slot(at: i), i < vc.wall.cellGroup.count, vc.wall.cellGroup[i] < gvs.count else { out.append("\(i): no slot / group"); continue }
            want[ObjectIdentifier(gvs[vc.wall.cellGroup[i]].cellsMarker), default: []] += [s.button, s.ink]
        }
        for (gi, gv) in gvs.enumerated() {
            let expected = want[ObjectIdentifier(gv.cellsMarker)] ?? []
            let have = gv.cellsMarker.subviews
            if have.count != expected.count || zip(have, expected).contains(where: { $0 !== $1 }) {
                out.append("group \(gi): \(have.count) subviews, expected \(expected.count) in index order")
            }
        }
        return out
    }

    /// 滚到 y（夹在内容范围里），排版提交。
    static func scroll(_ vc: LibraryAllScreen, _ w: UIWindow, to y: CGFloat) {
        vc.scroll.contentOffset = CGPoint(x: 0, y: min(max(0, y), bottomOffset(vc)))
        LibraryBench.settle(w)
    }

    static func bottomOffset(_ vc: LibraryAllScreen) -> CGFloat { max(0, vc.scroll.contentSize.height - vc.scroll.bounds.height) }

    /// 墙的大格数：默认 900（≈ 113 行 × 44pt + 23 个组头 ≈ 6000pt，比可见框 ± 2.5 屏（≤ 6 × 852pt）高：中间时上下两头都裁掉）；
    /// SHIZI_SCALE_BENCH 时 1500（以前的规模）。
    static let bigN: Int = AppScale.pick(900, scale: 1500)
}

@MainActor
final class LibraryVirtualCellsTests: XCTestCase {
    /// 排版的框（wall）= 视图上的框：组 / 组头 / 墙格；全部建出来时每一格的按钮 / 墨迹小图的框 = 以前逐格排的算法（列 × 格宽、行 × 格高，
    /// 格宽 = 墙宽 / 列数、格高 = 墙高 / 行数，独立地从视图量回来），content 坐标 = 框 + 墙格原点；只建一部分时，建出来的格子同样。
    func testFrameModelMatchesTheViews() throws {
        let sizes: [Int] = [48, 300, LibraryVirtual.bigN]
        for n in sizes {
            let payload = LibraryVirtual.payload(n, ink: true)
            let all = LibraryVirtual.make(all: true), virt = LibraryVirtual.make(all: false)
            let wa = LibraryBench.host(all), wv = LibraryBench.host(virt)
            defer { LibraryBench.unhost(wa); LibraryBench.unhost(wv) }
            all.apply(payload: payload)
            virt.apply(payload: payload)
            LibraryBench.settle(wa)
            LibraryBench.settle(wv)
            let wall = all.wall
            XCTAssertEqual(wall.cells.count, n, "n=\(n)")
            XCTAssertEqual(all.cells.liveIndices, Array(0..<n), "n=\(n): materialize-all builds every cell")
            XCTAssertEqual(virt.wall.cells, wall.cells, "n=\(n): same frame model on both pages")
            XCTAssertEqual(virt.wall.cellsInContent, wall.cellsInContent)
            if n >= LibraryVirtual.bigN { XCTAssertLessThan(virt.cells.liveIndices.count, n, "n=\(n): only part of the wall is built") }
            for vc in [all, virt] {
                let gvs = LibraryVirtual.groups(vc)
                XCTAssertEqual(gvs.count, wall.groups.count, "n=\(n)")
                for (gi, box) in wall.groups.enumerated() where gi < gvs.count {
                    let gv = gvs[gi]
                    // 视图读回的框 vs 模型：原点按末位容差、尺寸逐位（见 assertFrame）
                    assertFrame(gv.frame, box.frame, "n=\(n) group \(gi)")
                    assertFrame(gv.cellsMarker.frame, CGRect(x: 0, y: box.gridTop, width: box.frame.width, height: box.gridH), "n=\(n) group \(gi) grid")
                    XCTAssertEqual(gv.headButton.frame.height, box.headH)
                    assertFrame(gv.nameLabel.frame, box.nameFrame, "n=\(n) group \(gi) name")
                    assertFrame(gv.countLabel.frame, box.countFrame, "n=\(n) group \(gi) count")
                }
                for i in vc.cells.liveIndices {
                    guard let s = vc.cells.slot(at: i) else { XCTFail("n=\(n) \(i): no slot"); continue }
                    let gi = wall.cellGroup[i], box = wall.groups[gi], ci = i - box.firstCell
                    let marker = gvs[gi].cellsMarker
                    let rows = Int(ceil(Double(box.cellCount) / 8))
                    let cw = marker.bounds.width / 8, ch = marker.bounds.height / CGFloat(rows)
                    let r = s.button.frame
                    assertFrame(r, wall.cells[i], "n=\(n) cell \(i)")
                    XCTAssertEqual(r.minX, CGFloat(ci % 8) * cw, accuracy: 1e-9, "n=\(n) cell \(i) x")
                    XCTAssertEqual(r.minY, CGFloat(ci / 8) * ch, accuracy: 1e-6, "n=\(n) cell \(i) y")
                    XCTAssertEqual(r.width, cw, accuracy: 1e-9)
                    XCTAssertEqual(r.height, ch, accuracy: 1e-6)
                    let inC = s.button.convert(s.button.bounds, to: vc.content)
                    let model = wall.cellsInContent[i]
                    XCTAssertEqual(inC.minY, model.minY, accuracy: 1e-6, "n=\(n) cell \(i) content y")
                    XCTAssertEqual(inC.minX, model.minX, accuracy: 1e-6, "n=\(n) cell \(i) content x")
                    // 独立再算一遍（cw 从格网量回来、原点从读回的按钮框起算）：原点与尺寸都按末位容差
                    assertFrame(s.ink.frame, CGRect(x: r.minX + cw * 0.04, y: r.minY + cw * 0.04, width: cw * 0.92, height: cw * 0.92), exactSize: false, "n=\(n) cell \(i) ink")
                }
                XCTAssertEqual(LibraryVirtual.hierarchyProblems(vc), [], "n=\(n)")
            }
        }
    }

    /// 整窗截图逐字节相同：只建一部分 vs 全部建出来，滚到顶 / 中间 / 底 / 一个月份组头被上沿切开的位置，浅 / 深。
    /// 两页同时开着（各一个窗口），每个位置各截一张就比（不攒截图）。
    func testVirtualizedPixelsMatchMaterializeAll() throws {
        let cases: [(Int, Bool)] = [(LibraryVirtual.bigN, true), (300, false)]
        for (n, ink) in cases {
            let payload = LibraryVirtual.payload(n, ink: ink)
            let all = LibraryVirtual.make(all: true), virt = LibraryVirtual.make(all: false)
            let wa = LibraryBench.host(all), wv = LibraryBench.host(virt)
            defer { LibraryBench.unhost(wa); LibraryBench.unhost(wv) }
            for w in [wa, wv] { w.overrideUserInterfaceStyle = .light }
            all.apply(payload: payload)
            virt.apply(payload: payload)
            LibraryBench.settle(wa)
            LibraryBench.settle(wv)
            let bottom = LibraryVirtual.bottomOffset(virt)
            XCTAssertGreaterThan(bottom, virt.scroll.bounds.height, "n=\(n): content is taller than a screen")
            let mid = virt.wall.groups[virt.wall.groups.count / 2]
            let offsets: [(String, CGFloat)] = [("top", 0), ("middle", (bottom / 2).rounded()), ("bottom", bottom), ("cut head", mid.frame.minY + mid.headH / 2)]
            for style in [UIUserInterfaceStyle.light, .dark] {
                for w in [wa, wv] {
                    w.overrideUserInterfaceStyle = style
                    LibraryBench.settle(w)
                }
                for (name, y) in offsets {
                    LibraryVirtual.scroll(all, wa, to: y)
                    LibraryVirtual.scroll(virt, wv, to: y)
                    XCTAssertEqual(all.scroll.contentOffset, virt.scroll.contentOffset)
                    let label = "n=\(n) \(ink ? "ink" : "glyph") \(style == .dark ? "dark" : "light") \(name)"
                    let a = try LibraryEq.stableSnapshot(wa, "\(label) all")
                    let b = try LibraryEq.stableSnapshot(wv, "\(label) virtual")
                    XCTAssertTrue(LibraryEq.same(a, b, label), label)
                    XCTAssertEqual(LibraryVirtual.hierarchyProblems(virt), [], label)
                    if n == LibraryVirtual.bigN, name == "middle" {
                        let live = virt.cells.liveIndices
                        XCTAssertFalse(live.contains(0) || live.contains(n - 1), "\(label): cells culled at both ends")
                    }
                }
            }
        }
    }

    /// 一步一步滚过整面墙（每步 0.37 屏往下，再每步 2.3 屏往上跳回顶）：每一步之后建出来的格子 = 逐个判断与可见框 ± overscan 相交的那些，
    /// 没有一个格子用在两处；视图树按序号。每格的状态摘要 = 新建一格按同一序号配出来的：顶、底、每次收回包之后与每 4 步核一次（每格新建探针、
    /// 取字形图的像素，很慢），其余各步只核建了哪些（checkLive）。中途重收同一份回包（停在底部）、收一份小的回包（滚动位置被夹回）也一样。
    /// 中间某一步上下两头都裁掉了（格子真的被收走、复用）。
    func testScrollStress() throws {
        let cases: [(Int, Bool)] = [(LibraryVirtual.bigN, true), (300, false)]
        for (n, ink) in cases {
            let vc = LibraryVirtual.make(all: false)
            let w = LibraryBench.host(vc)
            defer { LibraryBench.unhost(w) }
            vc.apply(payload: LibraryVirtual.payload(n, ink: ink))
            LibraryBench.settle(w)
            let traits = vc.traitCollection
            var culledBoth = false
            func verify(_ what: String, deep: Bool = true) {
                XCTAssertEqual(vc.cells.overscan, vc.scroll.bounds.height * LibraryAllScreen.overscanViewports, what)
                let problems: [String]
                if deep {
                    problems = vc.cells.check(visible: vc.scroll.bounds) { (s: LibraryAllScreen.CellSlot) -> LibraryVirtual.Digest in LibraryVirtual.digest(s, traits) }
                } else {
                    problems = vc.cells.checkLive(visible: vc.scroll.bounds)
                }
                XCTAssertEqual(Array(problems.prefix(5)), [], "\(what): \(problems.count) problem(s)")
                XCTAssertEqual(LibraryVirtual.hierarchyProblems(vc), [], what)
                let live = vc.cells.liveIndices
                if let first = live.first, let last = live.last, first > 0, last < n - 1 { culledBoth = true }
            }
            verify("n=\(n) open")
            let h = vc.scroll.bounds.height, bottom = LibraryVirtual.bottomOffset(vc)
            var y: CGFloat = 0, steps = 0
            while y < bottom {
                y = min(bottom, y + h * 0.37)
                LibraryVirtual.scroll(vc, w, to: y)
                steps += 1
                verify("n=\(n) down y=\(y)", deep: steps % 4 == 0 || y >= bottom)
            }
            XCTAssertGreaterThan(steps, 5)
            XCTAssertTrue(vc.cells.liveIndices.contains(n - 1), "n=\(n): the last cell is built at the bottom")
            if n == LibraryVirtual.bigN {
                XCTAssertTrue(culledBoth, "n=\(n): somewhere in the middle both ends of the wall were culled")
                XCTAssertFalse(vc.cells.liveIndices.contains(0), "n=\(n): the first cells are gone at the bottom")
            }
            vc.apply(payload: LibraryVirtual.payload(n, ink: ink)) // 同一份再收一次（= 查字框里打一个字），停在底部
            LibraryBench.settle(w)
            verify("n=\(n) reapply at bottom")
            var upSteps = 0
            while y > 0 {
                y = max(0, y - h * 2.3)
                LibraryVirtual.scroll(vc, w, to: y)
                upSteps += 1
                verify("n=\(n) up y=\(y)", deep: upSteps % 4 == 0 || y <= 0)
            }
            XCTAssertTrue(vc.cells.liveIndices.contains(0))
            LibraryVirtual.scroll(vc, w, to: bottom)
            vc.apply(payload: LibraryVirtual.payload(48, ink: ink)) // 内容变短：格子按新的框重建（滚动位置不靠 UIScrollView 自己夹回，明确滚回顶）
            LibraryBench.settle(w)
            verify("n=\(n) to 48, still at the old offset")
            LibraryVirtual.scroll(vc, w, to: 0)
            verify("n=\(n) to 48")
            XCTAssertEqual(vc.cells.liveIndices, Array(0..<48))
        }
    }

    /// 每格都换了内容（字 / 新旧档 / 双钩 / 拼音）的另一份回包，格子序号与原来重叠。
    static func changed(_ p: [String: Any]) -> [String: Any] {
        guard var view = p["view"] as? [String: Any], var groups = view["groups"] as? [Any] else { return p }
        let chars = LibraryBench.chars(97)
        var k = 0
        for gi in groups.indices {
            guard var g = groups[gi] as? [String: Any], let cells = g["cells"] as? [Any] else { continue }
            g["cells"] = cells.map { raw -> Any in
                guard var c = raw as? [String: Any] else { return raw }
                c["char"] = chars[(k * 7 + 3) % chars.count]
                c["tone"] = LibraryBench.num(Double((k + 1) % 4))
                if k % 3 == 0 { c["kind"] = "hollow"; c["record"] = NSNull() }
                c["py"] = "p\(k % 5)"
                k += 1
                return c
            }
            groups[gi] = g
        }
        view["groups"] = groups
        var out = p
        out["view"] = view
        return out
    }

    /// 渲染了一份新回包、还没排版时来了滚动（惯性滚动中重拉、底部时排版前的滚动位置变化）：建出来的格子不能留着旧的内容。
    /// 两条路：滚动回调（排版前不建格子）、直接 updateCells（用旧 wall 建的格子按旧 wall 记，排版后按新 wall 重配内容）。之后每格的摘要 = 新配的。
    func testScrollBetweenRenderAndLayoutKeepsNoStaleContent() throws {
        for direct in [false, true] {
            for ink in [true, false] {
                let vc = LibraryVirtual.make(all: false)
                let w = LibraryBench.host(vc)
                defer { LibraryBench.unhost(w) }
                let p1 = LibraryVirtual.payload(1500, ink: ink)
                vc.apply(payload: p1)
                LibraryBench.settle(w)
                let h = vc.scroll.bounds.height
                LibraryVirtual.scroll(vc, w, to: h * 4)
                vc.apply(payload: Self.changed(p1)) // 渲染了，排版还没来（apply 只标 setNeedsLayout）
                vc.scroll.contentOffset = CGPoint(x: 0, y: h * 7.3) // 滚过 overscan：新的格子要进来
                if direct { vc.updateCells() }
                LibraryBench.settle(w)
                let traits = vc.traitCollection
                let what = "\(direct ? "updateCells" : "scroll callback") \(ink ? "ink" : "glyph")"
                let problems = vc.cells.check(visible: vc.scroll.bounds) { LibraryVirtual.digest($0, traits) }
                XCTAssertEqual(Array(problems.prefix(5)), [], "\(what): \(problems.count) problem(s)")
                XCTAssertEqual(LibraryVirtual.hierarchyProblems(vc), [], what)
                // 再滚一段（排版之后的滚动照常建格子）
                LibraryVirtual.scroll(vc, w, to: h * 9.1)
                let after = vc.cells.check(visible: vc.scroll.bounds) { LibraryVirtual.digest($0, traits) }
                XCTAssertEqual(Array(after.prefix(5)), [], "\(what) then scroll: \(after.count) problem(s)")
            }
        }
    }
}
