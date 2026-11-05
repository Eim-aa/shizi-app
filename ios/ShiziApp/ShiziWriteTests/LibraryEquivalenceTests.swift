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
    /// 一张整窗截图：原始像素 + 截图时各层的状态（对不上时打印哪里不同）。
    struct Shot {
        let data: Data
        let width: Int
        let height: Int
        let bytesPerRow: Int
        let scale: CGFloat
        let layers: [(path: String, line: String, frame: CGRect)]
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
        return Shot(data: data, width: cg.width, height: cg.height, bytesPerRow: cg.bytesPerRow, scale: img.scale, layers: layerDump(w))
    }

    private static func cgKey(_ c: CGColor?) -> String {
        guard let c else { return "-" }
        return libraryColorKey(UIColor(cgColor: c))
    }

    /// 窗口下每个看得见的层：路径、所属视图（类 / 标识）、窗口坐标、底色、描边、不透明度、内容对象；标签另记字色与视图外观。
    static func layerDump(_ w: UIWindow) -> [(path: String, line: String, frame: CGRect)] {
        var out: [(path: String, line: String, frame: CGRect)] = []
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
        let before = Dictionary(a.layers.map { ($0.path, $0.line) }, uniquingKeysWith: { x, _ in x })
        let after = Dictionary(b.layers.map { ($0.path, $0.line) }, uniquingKeysWith: { x, _ in x })
        var shown = 0
        for e in b.layers where before[e.path] != e.line && shown < 12 {
            print("[library-eq]   layer \(e.path)\n      was: \(before[e.path] ?? "(absent)")\n      now: \(e.line)")
            shown += 1
        }
        for e in a.layers where after[e.path] == nil && shown < 12 {
            print("[library-eq]   layer \(e.path) gone: \(e.line)")
            shown += 1
        }
        if shown == 0, !box.isNull {
            print("[library-eq]   layer state identical; layers over the box (innermost last):")
            for e in a.layers.filter({ $0.frame.intersects(box) }).suffix(10) { print("[library-eq]     \(e.path) \(e.line)") }
        }
        return false
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
