import ShiziCore
import UIKit
import XCTest
@testable import Shizi

// 字库子页的性能改动与改动前逐项相同（只换做法、不换结果）：
//   令牌颜色缓存 = 每次现解析；
//   墨迹小图「没变不重画」：连续 apply 几份回包之后的整窗截图 = 每格强制重画后的截图 = 新页面直接 apply 最后一份的截图（浅 / 深）；

/// 颜色的可比形式：色彩空间名 + 各分量的位（不按容差比）。
func libraryColorKey(_ c: UIColor?) -> String {
    guard let cg = c?.cgColor else { return "nil" }
    let space = (cg.colorSpace?.name as String?) ?? "?"
    return space + ":" + (cg.components ?? []).map { String(Double($0).bitPattern, radix: 16) }.joined(separator: ",")
}

@MainActor
final class LibraryTokenColorCacheTests: XCTestCase {
    /// 每个颜色令牌（两套主题的并集 + 一个不存在的名字）：缓存给的动态色在浅 / 深下解析出的颜色 = 现解析令牌原文；
    /// 同一个名字反复取是同一个对象（墨迹小图按对象同一判断墨色没变）。
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
                XCTAssertTrue(a === ShiziTokens.dynamicColor(name), name)
            }
        }
    }
}

// MARK: - 墨迹小图：笔画 / 墨色没变不重画

@MainActor
enum LibraryEq {
    /// 整窗截图（drawHierarchy afterScreenUpdates：真的经过一次渲染，看到的是各层此刻的内容）的原始像素。
    static func snapshot(_ w: UIWindow, file: StaticString = #filePath, line: UInt = #line) throws -> Data {
        let fmt = UIGraphicsImageRendererFormat.preferred()
        fmt.opaque = true
        var drawn = false
        let img = UIGraphicsImageRenderer(bounds: w.bounds, format: fmt).image { _ in
            drawn = w.drawHierarchy(in: w.bounds, afterScreenUpdates: true)
        }
        XCTAssertTrue(drawn, "drawHierarchy", file: file, line: line)
        let cg = try XCTUnwrap(img.cgImage, file: file, line: line)
        let data = try XCTUnwrap(cg.dataProvider?.data as Data?, file: file, line: line)
        return data
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

    /// 一页连续收几份回包（每份之后排版 + 提交），截图；再把每格墨迹强制重画（= 改动前每次都重画）后截一次；
    /// 再浅 / 深切换一次重复；最后新页面直接 apply 最后一份截图。三者逐字节相同。
    static func checkNoStaleInk(_ make: () -> ShiziScreenViewController, steps: [[String: Any]], file: StaticString = #filePath, line: UInt = #line) throws {
        let vc = make()
        let w = LibraryBench.host(vc)
        defer { LibraryBench.unhost(w) }
        for p in steps {
            vc.apply(payload: p)
            LibraryBench.settle(w)
        }
        XCTAssertFalse(inkViews(w).isEmpty, file: file, line: line)
        var shots: [String: Data] = [:]
        for style in [UIUserInterfaceStyle.light, .dark] {
            w.overrideUserInterfaceStyle = style
            LibraryBench.settle(w)
            let seq = try snapshot(w, file: file, line: line)
            for v in inkViews(w) { v.setNeedsDisplay() }
            LibraryBench.settle(w)
            let forced = try snapshot(w, file: file, line: line)
            XCTAssertTrue(seq == forced, "\(style.rawValue): sequence vs forced redraw", file: file, line: line)
            shots["\(style.rawValue)"] = seq
        }
        let vc2 = make()
        let w2 = LibraryBench.host(vc2)
        defer { LibraryBench.unhost(w2) }
        w2.overrideUserInterfaceStyle = .dark
        vc2.apply(payload: steps[steps.count - 1])
        LibraryBench.settle(w2)
        let fresh = try snapshot(w2, file: file, line: line)
        XCTAssertTrue(shots["\(UIUserInterfaceStyle.dark.rawValue)"] == fresh, "sequence vs fresh page", file: file, line: line)
    }
}

@MainActor
final class LibraryInkRedrawGuardTests: XCTestCase {
    private func pts(_ seed: Int) -> [[LibraryInkView.Point]] {
        (0..<3).map { s in (0..<20).map { j in LibraryInkView.Point(x: Double(j * 7 + s), y: Double(seed + j), w: j % 5 == 0 ? nil : 8.5) } }
    }

    /// 同一份笔画 / 同一个墨色再设一次不标重画；笔画（哪怕一个点、一个 w）或墨色对象变了照旧标重画。
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
        v.ink = UIColor(red: 1, green: 0, blue: 0, alpha: 1) // 颜色一样、对象不同 → 保守地重画
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
