import ShiziCore
import UIKit
import XCTest
@testable import Shizi

// MARK: - 字库子页重拉一次的耗时：量测（BENCH）

/// 「全部字」页 / 清单页收到一份视图回包之后的耗时（CI 日志里 grep BENCH）。只打印、不断言时间。
///   BENCH library-all <ink|glyph> n=<字数> first=…ms relayout=…ms reapply=…ms layers=<层数> images=…MB backing≈…MB
///     first    = 新页面第一次 apply + 排版 + CATransaction.flush（画墨 / 字形图都在这里）
///     relayout = 同一份内容再排一次版（setNeedsLayout → layoutIfNeeded → flush）
///     reapply  = 同一份回包再 apply 一次（= 查字框里打一个字：重拉 view.library-all，内容多半没变）
///     layers   = 窗口下全部 CALayer 个数；images = 层上 CGImage 的字节（同一张图只算一次）；backing ≈ 自己画的层（标签 / 墨迹小图）的后备存储估算
///   BENCH library-all ink-decode n=<字数> points=<点数> json=…ms direct=…ms（回包 ink → [记录 id: [[点]]]：ShiziDecode.value 的 JSON 往返 / 直接读）
///   BENCH library-list <ink|glyph> n=<行数> first=… relayout=… reapply=… layers=… images=… backing≈…
/// 合成回包：形状同 ShiziCore LibrarySubAPI（{ok, view, ink}），数字按 EngineValue.any 的口径装箱（整数 → Int64、其余 → Double）；
/// 字取包里有字形数据的字（Web/data/<字>.json）；每个墨迹 8 笔 × 62 点（≈ 网页 resampleForReplay 之后的一字）。页面挂在 393 × 852 的窗口里。
/// n = 300 时 relayout / reapply 各量 3 次取中位数，n = 1500 时各 1 次（控制总时长）。
@MainActor
enum LibraryBench {
    static let windowSize = CGSize(width: 393, height: 852)

    static func num(_ d: Double) -> Any { EngineValue.any(.number(d)) }

    static func ms(_ from: UInt64, _ to: UInt64) -> Double { Double(to - from) / 1e6 }

    static func now() -> UInt64 { DispatchTime.now().uptimeNanoseconds }

    static func median(_ xs: [Double]) -> Double {
        guard !xs.isEmpty else { return 0 }
        let s = xs.sorted()
        return s[s.count / 2]
    }

    /// 包里有字形数据的字（按文件名排序取前 n 个；不够时循环）。
    static func chars(_ n: Int) -> [String] {
        let names = (NativeGlyphData.dataDirectory.flatMap { try? FileManager.default.contentsOfDirectory(atPath: $0.path) } ?? [])
            .filter { $0.hasSuffix(".json") }
            .map { String($0.dropLast(5)) }
            .filter { $0.count == 1 }
            .sorted()
        guard !names.isEmpty else { return Array(repeating: "永", count: n) }
        return (0..<n).map { names[$0 % names.count] }
    }

    /// 一个字的墨迹（345 单位格；8 笔 × 62 点，{x, y, w}）。
    static func strokes(_ seed: Int) -> [Any] {
        var out: [Any] = []
        for s in 0..<8 {
            var pts: [Any] = []
            for j in 0..<62 {
                let u = Double(j) / 61
                let a = Double(seed % 17) * 0.37 + Double(s) * 0.8
                let x = 40 + 230 * u * (0.5 + 0.5 * cos(a)) + Double(s) * 9
                let y = 40 + 30 * Double(s) + 25 * sin(u * 3 + a)
                let w = 9 + 4 * sin(u * 5 + Double(s))
                pts.append(["x": num(x), "y": num(y), "w": num(w)] as [String: Any])
            }
            out.append(pts)
        }
        return out
    }

    /// 同 strokes(seed) 的点，作引擎侧的回放点（ShiziCore InkPoint；w 都在）。
    static func inkPoints(_ seed: Int) -> [[InkPoint]] {
        (0..<8).map { s in
            (0..<62).map { j in
                let u = Double(j) / 61
                let a = Double(seed % 17) * 0.37 + Double(s) * 0.8
                let x = 40 + 230 * u * (0.5 + 0.5 * cos(a)) + Double(s) * 9
                let y = 40 + 30 * Double(s) + 25 * sin(u * 3 + a)
                let w = 9 + 4 * sin(u * 5 + Double(s))
                return InkPoint(x: x, y: y, w: w)
            }
        }
    }

    /// 引擎回包里的 ink（JSValue，过边界之前）：n 条记录 r0…，形状同 ShiziCore LibrarySubAPI 现在发的（每点一个 {x, y, w?} 对象，只发有限数）。
    static func engineInkPerPoint(_ n: Int) -> JSValue {
        var ink = JSObject()
        for i in 0..<n {
            let strokes = inkPoints(i).map { points in JSValue.array(points.compactMap { q -> JSValue? in
                guard q.x.isFinite, q.y.isFinite else { return nil }
                var o = JSObject([("x", .number(q.x)), ("y", .number(q.y))])
                if let w = q.w, w.isFinite { o["w"] = .number(w) }
                return .object(o)
            }) }
            if !strokes.isEmpty { ink["r\(i)"] = .array(strokes) }
        }
        return .object(ink)
    }

    /// view.library-all 的回包：n 个字，每 40 个一组（按月排、组头可点）；ink = 每格都有墨迹，否则都画标准字形。
    static func allPayload(_ n: Int, ink: Bool) -> [String: Any] {
        let cs = chars(n)
        var groups: [Any] = []
        var inkMap: [String: Any] = [:]
        var start = 0, g = 0
        while start < n {
            let end = min(n, start + 40)
            var cells: [Any] = []
            for i in start..<end {
                let rid = "r\(i)"
                if ink { inkMap[rid] = strokes(i) }
                cells.append(["char": cs[i], "kind": "ink", "tone": num(Double(i % 4)), "record": ["id": rid] as [String: Any],
                              "py": NSNull(), "hit": false] as [String: Any])
            }
            groups.append(["key": "m\(g)", "head": true, "name": "2026年\(g % 12 + 1)月", "count": "\(end - start) 个字", "tone": NSNull(),
                           "fold": "open", "month": "2026-\(g)", "cells": cells] as [String: Any])
            start = end
            g += 1
        }
        let view: [String: Any] = [
            "cols": num(8), "empty": false, "sort": "recent", "filter": "", "sorts": [Any](), "showSort": true, "chips": [Any](),
            "showChips": true, "showLegend": true, "note": "",
            "find": ["text": "", "mode": "none", "found": false, "where": "", "miss": ""] as [String: Any],
            "groups": groups, "closed": [Any](), "go": ["kind": "start", "keys": [String]()] as [String: Any], "total": num(Double(n)),
        ]
        return ["ok": true, "view": view, "ink": inkMap]
    }

    static func ref(_ key: String) -> [String: Any] { ["copy": key] }

    /// view.library-list 的回包：n 行（都在「先练这些」里、都展开）；ink = 每行都有笔迹小图。
    static func listPayload(_ n: Int, ink: Bool) -> [String: Any] {
        let cs = chars(n)
        var rows: [Any] = []
        var inkMap: [String: Any] = [:]
        for i in 0..<n {
            let rid = "r\(i)"
            if ink { inkMap[rid] = strokes(i) }
            rows.append([
                "char": cs[i], "cardKey": "base:\(cs[i])", "recordId": rid,
                "word": ["pre": "", "tg": cs[i], "post": "字", "has": true] as [String: Any],
                "meta": "写过 \(i % 9 + 1) 次 · 上次 \(i % 30 + 1) 天前", "thumbCaption": i % 3 == 0 ? "写错那次" : "",
                "noThumb": false, "selectable": true, "selected": i < 5, "group": "top",
            ] as [String: Any])
        }
        let view: [String: Any] = [
            "kind": "due", "view": "due", "title": ref("X-LIST.titleDue"), "empty": false, "emptyGlyph": ref("X-LIST.emptyGlyph"),
            "emptyTitle": ref("X-LIST.emptyTitle"), "emptyBody": ref("X-LIST.emptyBody"), "head": ref("X-LIST.head"), "top": ref("X-LIST.top"),
            "note": ref("X-LIST.note"), "hint": ref("X-LIST.hint"), "button": ["label": ref("R-A02.practiceThese"), "disabled": false] as [String: Any],
            "restCount": num(0), "restLabel": "", "restHideLabel": "", "toggleAllLabel": ref("X-LIST.selectAll"), "rows": rows,
            "selectedCount": num(5), "selectableCount": num(Double(n)), "allSelected": false,
        ]
        return ["ok": true, "view": view, "ink": inkMap]
    }

    /// 页面挂进一个 393 × 852 的窗口（显示出来：墨迹小图 / 标签要真的画）。
    static func host(_ vc: UIViewController) -> UIWindow {
        let frame = CGRect(origin: .zero, size: windowSize)
        let w: UIWindow
        if let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first {
            w = UIWindow(windowScene: scene)
            w.frame = frame
        } else {
            w = UIWindow(frame: frame)
        }
        w.rootViewController = vc
        w.isHidden = false
        vc.loadViewIfNeeded()
        w.layoutIfNeeded()
        CATransaction.flush()
        return w
    }

    static func unhost(_ w: UIWindow) {
        w.isHidden = true
        w.rootViewController = nil
        CATransaction.flush()
    }

    /// 排版 + 提交（画墨 / 标签在提交里画）。
    static func settle(_ w: UIWindow) {
        w.layoutIfNeeded()
        CATransaction.flush()
    }

    /// 窗口下的层数、层上 CGImage 的字节（同一张图只算一次）、自己画的层的后备存储估算（宽 × 高 × scale² × 4）。
    static func layerStats(_ root: CALayer) -> (layers: Int, imageBytes: Int, backingBytes: Int) {
        var layers = 0, imageBytes = 0, backingBytes = 0
        var seen = Set<ObjectIdentifier>()
        func walk(_ l: CALayer) {
            layers += 1
            if let c = l.contents {
                let obj = c as AnyObject
                if CFGetTypeID(obj) == CGImage.typeID {
                    if seen.insert(ObjectIdentifier(obj)).inserted {
                        let im = c as! CGImage
                        imageBytes += im.bytesPerRow * im.height
                    }
                } else {
                    let s = l.contentsScale
                    backingBytes += Int((l.bounds.width * s).rounded(.up)) * Int((l.bounds.height * s).rounded(.up)) * 4
                }
            }
            for sub in l.sublayers ?? [] { walk(sub) }
        }
        walk(root)
        return (layers, imageBytes, backingBytes)
    }

    /// 一个页面：first / relayout / reapply（ms）与层的统计，打一行 BENCH。
    static func run(_ name: String, variant: String, n: Int, make: () -> ShiziScreenViewController, payload: [String: Any]) {
        let reps = n <= 300 ? 3 : 1
        autoreleasepool {
            let vc = make()
            let w = host(vc)
            let t0 = now()
            vc.apply(payload: payload)
            settle(w)
            let first = ms(t0, now())
            var relayout: [Double] = [], reapply: [Double] = []
            for _ in 0..<reps {
                let t1 = now()
                vc.view.setNeedsLayout()
                settle(w)
                relayout.append(ms(t1, now()))
            }
            for _ in 0..<reps {
                let t2 = now()
                vc.apply(payload: payload)
                settle(w)
                reapply.append(ms(t2, now()))
            }
            let st = layerStats(w.layer)
            print(String(format: "BENCH \(name) \(variant) n=%ld first=%.1fms relayout=%.1fms reapply=%.1fms layers=%ld images=%.1fMB backing≈%.1fMB",
                         n, first, median(relayout), median(reapply), st.layers, Double(st.imageBytes) / 1e6, Double(st.backingBytes) / 1e6))
            unhost(w)
        }
    }
}

@MainActor
final class LibraryBenchTests: XCTestCase {
    func testLibraryAllReloadCost() throws {
        for n in [300, 1500] {
            for ink in [true, false] {
                let payload = LibraryBench.allPayload(n, ink: ink)
                LibraryBench.run("library-all", variant: ink ? "ink" : "glyph", n: n,
                                 make: { LibraryAllScreen(screen: "library-all", entryId: "bench", params: [:]) }, payload: payload)
            }
        }
    }

    func testLibraryAllInkDecodeCost() throws {
        for n in [300, 1500] {
            let ink = try XCTUnwrap(LibraryBench.allPayload(n, ink: true)["ink"] as? [String: Any])
            var times: [Double] = [], direct: [Double] = []
            var points = 0, directPoints = 0
            for _ in 0..<3 {
                let t0 = LibraryBench.now()
                let decoded = (try? ShiziDecode.value(ink, as: [String: [[LibraryInkView.Point]]].self)) ?? [:]
                times.append(LibraryBench.ms(t0, LibraryBench.now()))
                points = decoded.values.reduce(0) { $0 + $1.reduce(0) { $0 + $1.count } }
                let t1 = LibraryBench.now()
                let fast = LibraryInkView.decodeInk(ink) // 产品现在走的路（直接读）
                direct.append(LibraryBench.ms(t1, LibraryBench.now()))
                directPoints = fast.values.reduce(0) { $0 + $1.reduce(0) { $0 + $1.count } }
            }
            print(String(format: "BENCH library-all ink-decode n=%ld points=%ld json=%.1fms direct=%.1fms", n, points, LibraryBench.median(times), LibraryBench.median(direct)))
            XCTAssertEqual(points, n * 8 * 62)
            XCTAssertEqual(directPoints, points)
        }
    }

    /// 引擎边界到笔画：回包 ink 的 JSValue → [String: Any]（EngineValue.any，App 收回包时走的那一步）→ decodeInk。
    ///   BENCH library-all ink-wire format=<points> n=… points=… build=…ms convert=…ms decode=…ms（build = 引擎侧拼 JSValue，量的是同形的拼法）
    func testLibraryInkWireCost() throws {
        for n in [300, 1500] {
            var builds: [Double] = [], converts: [Double] = [], decodes: [Double] = []
            var points = 0
            for _ in 0..<3 {
                try autoreleasepool {
                    let t0 = LibraryBench.now()
                    let js = LibraryBench.engineInkPerPoint(n)
                    let t1 = LibraryBench.now()
                    let any = try XCTUnwrap(EngineValue.any(js) as? [String: Any])
                    let t2 = LibraryBench.now()
                    let decoded = LibraryInkView.decodeInk(any)
                    let t3 = LibraryBench.now()
                    builds.append(LibraryBench.ms(t0, t1)); converts.append(LibraryBench.ms(t1, t2)); decodes.append(LibraryBench.ms(t2, t3))
                    points = decoded.values.reduce(0) { $0 + $1.reduce(0) { $0 + $1.count } }
                    XCTAssertNotNil(LibraryInkView.decodeInkDirect(any), "direct path")
                }
            }
            print(String(format: "BENCH library-all ink-wire format=points n=%ld points=%ld build=%.1fms convert=%.1fms decode=%.1fms",
                         n, points, LibraryBench.median(builds), LibraryBench.median(converts), LibraryBench.median(decodes)))
            XCTAssertEqual(points, n * 8 * 62)
        }
    }

    func testLibraryListReloadCost() throws {
        for n in [100, 300] {
            for ink in [true, false] {
                let payload = LibraryBench.listPayload(n, ink: ink)
                LibraryBench.run("library-list", variant: ink ? "ink" : "glyph", n: n,
                                 make: { LibraryListScreen(screen: "library-list", entryId: "bench", params: ["kind": "due"]) }, payload: payload)
            }
        }
    }
}
