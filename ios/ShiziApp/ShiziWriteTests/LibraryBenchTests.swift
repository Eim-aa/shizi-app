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
///   BENCH library-all ink-decode n=<字数> points=<点数> json=…ms perpoint=…ms direct=…ms（回包 ink → [记录 id: [[点]]]：
///     json = 旧形状（每点一个对象）经 ShiziDecode.value 的 JSON 往返；perpoint = 旧形状直接读；direct = 现在的平铺形状直接读（产品走的路））
///   BENCH library-list <ink|glyph> n=<行数> first=… relayout=… reapply=… layers=… images=… backing≈…
/// 全部字页只建看得见的格子（ShiziLazyCells，可见框上下各 2.5 屏）之后，上面 library-all 那一行量的是产品的做法；
///   variant 带 -all 的（ink-all / glyph-all）= 测试开关 materializeAll（全部格子都建出来 = 以前的做法）对照。
///   BENCH library-all scroll <ink|glyph> n=… steps=… step=…pt median=…ms max=…ms live=<建出来的格子数> layers=… backing≈…MB
///     从顶滚到底，每步半屏（contentOffset → layoutIfNeeded → flush：新建 / 重配进来的格子、画墨都在这一步里）
/// 合成回包：形状同 ShiziCore LibrarySubAPI（{ok, view, ink}；ink 由 LibraryInkWire 拼、经 EngineValue.any 过边界，同引擎真发的）；
/// 字取包里有字形数据的字（Web/data/<字>.json）；每个墨迹 8 笔 × 62 点（≈ 网页 resampleForReplay 之后的一字）。页面挂在 393 × 852 的窗口里。
/// n ≤ 300 时 relayout / reapply 各量 3 次取中位数，更大的各 1 次（控制总时长）。
/// 规模：默认 300 / 900（CI 的 Debug 模拟器）；SHIZI_SCALE_BENCH 时 300 / 1500 / 5000（见 AppScale）。
/// 大规模的量测 / 对照开关：默认（CI 的 Debug 模拟器）只跑中等规模（仍大于 overscan、格子照样被裁掉 / 复用）；
/// 设了 SHIZI_SCALE_BENCH（xcodebuild 下用 TEST_RUNNER_SHIZI_SCALE_BENCH=1 传进测试进程）才跑 1500 / 3000 / 5000 与它们的全部建出来对照。
enum AppScale {
    static let enabled: Bool = !(ProcessInfo.processInfo.environment["SHIZI_SCALE_BENCH"] ?? "").isEmpty

    /// 默认用 normal，开了大规模用 scale。
    static func pick<T>(_ normal: T, scale: T) -> T { enabled ? scale : normal }

    /// stdout 改成行缓冲（只做一次）：BENCH / [library-eq] 行随跑随出，不攒到进程退出（CI 被取消时也看得到跑到了哪一条）。
    private static let lineBuffered: Int32 = setvbuf(stdout, nil, _IOLBF, 0)

    static func streamOutput() { _ = lineBuffered }
}

@MainActor
enum LibraryBench {
    static let windowSize = CGSize(width: 393, height: 852)

    static func num(_ d: Double) -> Any { EngineValue.any(.number(d)) }

    static func ms(_ from: UInt64, _ to: UInt64) -> Double { Double(to - from) / 1e6 }

    static func now() -> UInt64 {
        AppScale.streamOutput()
        return DispatchTime.now().uptimeNanoseconds
    }

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

    /// 一个字的墨迹过了边界的样子（345 单位格；8 笔 × 62 点，点都有 w）：LibraryInkWire 拼 → EngineValue.any。legacy = 旧形状（每点一个 {x, y, w}）。
    static func strokes(_ seed: Int, legacy: Bool = false) -> [Any] {
        EngineValue.any(LibraryInkWire.record(inkPoints(seed), legacy: legacy) ?? .array([])) as? [Any] ?? []
    }

    /// 一个字的回放点（ShiziCore InkPoint；w 都在）。
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

    /// 引擎回包里的 ink（JSValue，过边界之前）：n 条记录 r0…，同 ShiziCore LibrarySubAPI 的拼法（LibraryInkWire.record；legacy = 旧形状）。
    static func engineInk(_ n: Int, legacy: Bool = false) -> JSValue {
        var ink = JSObject()
        for i in 0..<n {
            if let strokes = LibraryInkWire.record(inkPoints(i), legacy: legacy) { ink["r\(i)"] = strokes }
        }
        return .object(ink)
    }

    /// view.library-all 的回包：n 个字，每 40 个一组（按月排、组头可点）；ink = 每格都有墨迹，否则都画标准字形。
    static func allPayload(_ n: Int, ink: Bool, legacy: Bool = false) -> [String: Any] {
        let cs = chars(n)
        var groups: [Any] = []
        var inkMap: [String: Any] = [:]
        var start = 0, g = 0
        while start < n {
            let end = min(n, start + 40)
            var cells: [Any] = []
            for i in start..<end {
                let rid = "r\(i)"
                if ink { inkMap[rid] = strokes(i, legacy: legacy) }
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
    static func listPayload(_ n: Int, ink: Bool, legacy: Bool = false) -> [String: Any] {
        let cs = chars(n)
        var rows: [Any] = []
        var inkMap: [String: Any] = [:]
        for i in 0..<n {
            let rid = "r\(i)"
            if ink { inkMap[rid] = strokes(i, legacy: legacy) }
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
        AppScale.streamOutput()
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
    /// 墨的位图在后台画（ShiziInkRaster）：也等它们画完、显示出来（最多 20 秒）。
    static func settle(_ w: UIWindow) {
        w.layoutIfNeeded()
        CATransaction.flush()
        if ShiziInkRaster.isBusy {
            let end = Date().addingTimeInterval(20)
            while ShiziInkRaster.isBusy, Date() < end { RunLoop.current.run(until: Date().addingTimeInterval(0.002)) }
            w.layoutIfNeeded()
            CATransaction.flush()
        }
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

    /// 全部字页从顶滚到底（每步半屏）：每步的耗时、滚到底时建出来的格子数与层的统计，打一行 BENCH。
    static func scrollRun(variant: String, n: Int, payload: [String: Any]) {
        autoreleasepool {
            let vc = LibraryAllScreen(screen: "library-all", entryId: "bench", params: [:])
            let w = host(vc)
            vc.apply(payload: payload)
            settle(w)
            let h = vc.scroll.bounds.height
            let bottom = max(0, vc.scroll.contentSize.height - h)
            var times: [Double] = []
            var y: CGFloat = 0
            while y < bottom {
                y = min(bottom, y + h / 2)
                let t = now()
                vc.scroll.contentOffset = CGPoint(x: 0, y: y)
                settle(w)
                times.append(ms(t, now()))
            }
            let st = layerStats(w.layer)
            print(String(format: "BENCH library-all scroll \(variant) n=%ld steps=%ld step=%.0fpt median=%.1fms max=%.1fms live=%ld layers=%ld backing≈%.1fMB",
                         n, times.count, Double(h / 2), median(times), times.max() ?? 0, vc.cells.liveIndices.count, st.layers, Double(st.backingBytes) / 1e6))
            unhost(w)
        }
    }
}

@MainActor
final class LibraryBenchTests: XCTestCase {
    func testLibraryAllReloadCost() throws {
        // 默认 300 / 900（全部建出来的对照在 300）；SHIZI_SCALE_BENCH 时 300 / 1500 / 5000（对照在 1500）
        let sizes: [Int] = AppScale.pick([300, 900], scale: [300, 1500, 5000])
        let compareAt: Int = AppScale.pick(300, scale: 1500)
        for n in sizes {
            for ink in [true, false] {
                let payload = LibraryBench.allPayload(n, ink: ink)
                LibraryBench.run("library-all", variant: ink ? "ink" : "glyph", n: n,
                                 make: { LibraryAllScreen(screen: "library-all", entryId: "bench", params: [:]) }, payload: payload)
                if n == compareAt { // 对照：全部格子都建出来（以前的做法）
                    LibraryBench.run("library-all", variant: ink ? "ink-all" : "glyph-all", n: n, make: {
                        let vc = LibraryAllScreen(screen: "library-all", entryId: "bench", params: [:])
                        vc.cells.materializeAll = true
                        return vc
                    }, payload: payload)
                }
            }
        }
    }

    /// 只建看得见的格子之后，滚动的每一步要多久（新进来的格子在这一步里建 / 配 / 画）。
    func testLibraryAllScrollCost() throws {
        let sizes: [Int] = AppScale.pick([900], scale: [1500, 5000])
        for n in sizes {
            for ink in [true, false] {
                LibraryBench.scrollRun(variant: ink ? "ink" : "glyph", n: n, payload: LibraryBench.allPayload(n, ink: ink))
            }
        }
    }

    func testLibraryAllInkDecodeCost() throws {
        let sizes: [Int] = AppScale.pick([300, 900], scale: [300, 1500])
        for n in sizes {
            let ink = try XCTUnwrap(LibraryBench.allPayload(n, ink: true)["ink"] as? [String: Any])
            let old = try XCTUnwrap(LibraryBench.allPayload(n, ink: true, legacy: true)["ink"] as? [String: Any])
            var times: [Double] = [], perPoint: [Double] = [], direct: [Double] = []
            var points = 0, perPointPoints = 0, directPoints = 0
            func count(_ d: [String: [[LibraryInkView.Point]]]) -> Int { d.values.reduce(0) { $0 + $1.reduce(0) { $0 + $1.count } } }
            for _ in 0..<3 {
                let t0 = LibraryBench.now()
                let decoded = (try? ShiziDecode.value(old, as: [String: [[LibraryInkView.Point]]].self)) ?? [:]
                times.append(LibraryBench.ms(t0, LibraryBench.now()))
                points = count(decoded)
                let t1 = LibraryBench.now()
                let slow = LibraryInkView.decodeInk(old) // 旧形状直接读
                perPoint.append(LibraryBench.ms(t1, LibraryBench.now()))
                perPointPoints = count(slow)
                let t2 = LibraryBench.now()
                let fast = LibraryInkView.decodeInk(ink) // 产品现在走的路（平铺、直接读）
                direct.append(LibraryBench.ms(t2, LibraryBench.now()))
                directPoints = count(fast)
            }
            print(String(format: "BENCH library-all ink-decode n=%ld points=%ld json=%.1fms perpoint=%.1fms direct=%.1fms",
                         n, points, LibraryBench.median(times), LibraryBench.median(perPoint), LibraryBench.median(direct)))
            XCTAssertEqual(points, n * 8 * 62)
            XCTAssertEqual(perPointPoints, points)
            XCTAssertEqual(directPoints, points)
        }
    }

    /// 引擎边界到笔画：回包 ink 的 JSValue → [String: Any]（EngineValue.any，App 收回包时走的那一步）→ decodeInk。
    ///   BENCH library-all ink-wire format=<flat|points> n=… points=… build=…ms convert=…ms decode=…ms
    ///     build = 引擎侧拼 JSValue（LibraryInkWire.record）；flat = 现在发的平铺形状，points = 旧形状（每点一个 {x, y, w}）对照
    func testLibraryInkWireCost() throws {
        let big: Int = AppScale.pick(900, scale: 1500)
        let cases: [(Int, Bool)] = [(300, false), (300, true), (big, false), (big, true)]
        for (n, legacy) in cases {
            var builds: [Double] = [], converts: [Double] = [], decodes: [Double] = []
            var points = 0
            for _ in 0..<3 {
                try autoreleasepool {
                    let t0 = LibraryBench.now()
                    let js = LibraryBench.engineInk(n, legacy: legacy)
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
            print(String(format: "BENCH library-all ink-wire format=\(legacy ? "points" : "flat") n=%ld points=%ld build=%.1fms convert=%.1fms decode=%.1fms",
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
