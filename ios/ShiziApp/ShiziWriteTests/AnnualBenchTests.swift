import ShiziCore
import UIKit
import XCTest
@testable import Shizi

// MARK: - 年报收到一份视图回包之后的耗时：量测（BENCH）

/// 年报（AnnualScreen）收到 view.annual 回包之后的耗时（CI 日志里 grep BENCH）。只打印、不断言时间。
///   BENCH annual view-decode n=<格数> points=<点数> json=…ms perpoint=…ms direct=…ms（回包 view → AnnualScreen.View）
///     json = 改动前 render 里那一行：旧形状（每点一个 InkPoint.js 对象）整份经 ShiziDecode.value（JSONSerialization 往返）
///     perpoint = 旧形状经 AnnualScreen.decodeView（点有 t，直接读不收 → 展开后走原路，≈ json）
///     direct = 现在的平铺形状经 AnnualScreen.decodeView（墨迹直接读，只有去掉墨迹的 view 经 JSON 往返；产品走的路）
///   BENCH annual ink-wire format=<flat|points> n=… points=… build=…ms convert=…ms decode=…ms
///     build = 引擎侧拼整份 view 的 JSValue；convert = EngineValue.any（App 收回包时走的那一步）；decode = AnnualScreen.decodeView
///     flat = 现在发的（ink.points 由 AnnualInkWire 拼），points = 旧形状（每点一个 InkPoint.js 对象）对照
///   BENCH annual <ink|glyph> n=… first=… relayout=… reapply=… layers=… images=… backing≈…（同 LibraryBench.run：新页面 apply + 排版 + 提交，
///     再排一次版，同一份回包再 apply 一次）。月段的格子只建可见框 ± overscan 的（ShiziLazyCells，2.5 屏与 8 行取大的）；
///     variant 带 -all 的（ink-all / glyph-all）= 测试开关 materializeAll（全部格子都建出来 = 以前的做法）对照，n = 300（SHIZI_SCALE_BENCH：300 / 1200 / 3000）
/// 规模：默认 300 / 800（CI 的 Debug 模拟器）；SHIZI_SCALE_BENCH 时 300 / 1200 / 3000（见 AppScale）。
///   BENCH annual scroll <ink|glyph>[-all] n=… steps=… step=…pt median=…ms max=…ms live=<建出来的格子数> layers=… backing≈…MB
///     从顶滚到底，每步半屏（contentOffset → 滚动回调建 / 收格子、墨判要不要画 → layoutIfNeeded → flush：新进来的格子的配置与画墨都在这一步里）
/// 合成回包：形状同 ShiziCore MineSubView.annualView(inkWire:)（每月一段、每段的格、今年首字、卷尾两格；ink.points 由 AnnualInkWire 拼），经 EngineValue.any 过边界，同引擎真发的；
/// 每格墨迹（每点 x / y / t / w，键序同 InkPoint.js）：默认轻的 3 笔 × 8 点，每 50 格（种子 % 50 == 0：第 0 格、今年首字、卷尾第一格等）一格重的
/// 8 笔 × 62 点（≈ resampleForReplay 之后的一字）；SHIZI_SCALE_BENCH 时每格都是重的（以前的形状）。字取包里有字形数据的字，分 12 个月。
/// 为什么默认轻：CI 的 Debug 模拟器上一格重墨（≈ 1.1 万个三角形）填充要 ≈ 200ms，画几百格的用例就要几分钟；轻的一格 ≈ 550 个三角形（≈ 10ms）。
/// 画面对照（eager / lazy、只建一部分 / 全部建出来）两边用的是同一份回包，重的那几格照样画、照样比。解码量测（view-decode / ink-wire）用 full: true（每格重的，不画）。
@MainActor
enum AnnualBench {
    static func ref(_ key: String, _ params: [(String, JSValue)] = []) -> JSValue {
        params.isEmpty ? .object(JSObject([("copy", .string(key))])) : .object(JSObject([("copy", .string(key)), ("params", .object(JSObject(params)))]))
    }

    /// 每多少格一格重的墨迹（种子 % heavyEvery == 0）。
    static let heavyEvery: Int = 50

    /// 这一格是不是重的（8 笔 × 62 点）：full、SHIZI_SCALE_BENCH，或种子是 heavyEvery 的倍数。
    static func isHeavy(_ seed: Int, full: Bool = false) -> Bool { full || AppScale.enabled || seed % heavyEvery == 0 }

    /// 一格的笔数与每笔点数：重的 8 × 62，轻的 3 × 8。
    static func shape(_ seed: Int, full: Bool = false) -> (strokes: Int, points: Int) {
        isHeavy(seed, full: full) ? (strokes: 8, points: 62) : (strokes: 3, points: 8)
    }

    /// 一格的点数（= 笔数 × 每笔点数）。
    static func pointCount(_ seed: Int, full: Bool = false) -> Int {
        let sh = shape(seed, full: full)
        return sh.strokes * sh.points
    }

    /// view(n, ink: true) 解出来的总点数：月段 n 格（种子 0..<n）+ 今年首字（种子 0）+ 卷尾两格（种子 0、n + 1）。
    static func expectedPoints(_ n: Int, full: Bool = false) -> Int {
        var total: Int = 2 * pointCount(0, full: full) + pointCount(n + 1, full: full)
        for i in 0..<max(0, n) { total += pointCount(i, full: full) }
        return total
    }

    /// 一格的回放点（ShiziCore InkPoint，同 resampleForReplay 的输出：x / y / t / w，键序 x, y, t, p, w）。形状见 shape（重的 = 以前每格的点列，逐位相同）。
    static func inkPoints(_ seed: Int, full: Bool = false) -> [[InkPoint]] {
        let sh = shape(seed, full: full)
        let last: Double = Double(sh.points - 1)
        return (0..<sh.strokes).map { (s: Int) -> [InkPoint] in
            (0..<sh.points).map { (j: Int) -> InkPoint in
                let u = Double(j) / last
                let a = Double(seed % 17) * 0.37 + Double(s) * 0.8
                let x = 40 + 230 * u * (0.5 + 0.5 * cos(a)) + Double(s) * 9
                let y = 40 + 30 * Double(s) + 25 * sin(u * 3 + a)
                let w = 9 + 4 * sin(u * 5 + Double(s))
                return InkPoint(x: x, y: y, t: Double(1000 * s) + 8.25 * Double(j), w: w)
            }
        }
    }

    /// 一格的 ink（{points}）：AnnualInkWire.points（legacy = 旧形状，每点一个 InkPoint.js 对象，同改动前的 DetailView.builtInk）。
    static func box(_ seed: Int, legacy: Bool = false, full: Bool = false) -> JSValue {
        .object(JSObject([("points", AnnualInkWire.points(inkPoints(seed, full: full), legacy: legacy))]))
    }

    /// view.annual 的 view（JSValue，过边界之前）：n 格分 12 个月；ink = 每格都有墨迹，否则都画衬底字（今年首字与卷尾照样有墨迹）。
    static func view(_ n: Int, ink: Bool, legacy: Bool = false, full: Bool = false) -> JSValue {
        let cs = LibraryBench.chars(max(n, 1))
        let per = max(1, (n + 11) / 12)
        var months: [JSValue] = []
        var start = 0
        while start < n {
            let end = min(n, start + per), mn = Double(months.count + 1)
            let month = String(format: "2026-%02d", months.count + 1)
            let cells: [JSValue] = (start..<end).map { i in
                .object(JSObject([
                    ("ch", .string(cs[i])), ("ink", ink ? box(i, legacy: legacy, full: full) : .null), ("mode", .string(ink ? "hand" : "under")), ("tag", .string("")), ("day", .string("")),
                    ("recordId", .string("r\(i)")), ("recordDay", .string(month + "-01")),
                    ("label", ink ? ref("X-MINE.cellLabel", [("char", .string(cs[i])), ("date", .string(""))]) : ref("X-WORK.monthCellNoInk", [("char", .string(cs[i]))])),
                ]))
            }
            let count = JSValue.number(Double(end - start))
            months.append(.object(JSObject([
                ("month", .string(month)), ("monthNum", .number(mn)), ("n", count),
                ("name", ref("X-WORK.annualMonthName", [("month", .number(mn))])), ("count", ref("X-WORK.annualMonthCount", [("n", count)])),
                ("aria", ref("X-WORK.annualMonthAria", [("month", .number(mn)), ("n", count)])), ("cells", .array(cells)),
            ])))
            start = end
        }
        func date(_ m: Double, _ d: Double) -> JSValue { ref("R-H02.dateFormat", [("month", .number(m)), ("day", .number(d))]) }
        func side(_ seed: Int, _ day: String, _ label: String) -> JSValue {
            .object(JSObject([("recordId", .string("r\(seed)")), ("day", .string(day)), ("ink", box(seed, legacy: legacy, full: full)), ("label", ref(label, [("char", .string(cs[0]))])), ("date", date(1, 1))]))
        }
        let first = JSValue.object(JSObject([
            ("char", .string(cs[0])), ("day", .string("2026-01-01")), ("recordId", .string("r0")), ("ink", box(0, legacy: legacy, full: full)),
            ("label", ref("X-ANNUAL.firstInk", [("char", .string(cs[0]))])), ("date", ref("R-M06.inkDate", [("date", date(1, 1))])),
        ]))
        let twice = JSValue.object(JSObject([
            ("char", .string(cs[0])), ("title", ref("X-WORK.annualTwiceTitle")),
            ("first", side(0, "2026-01-01", "X-WORK.annualFirstCellAria")), ("last", side(n + 1, "2026-12-01", "X-WORK.annualLastCellAria")),
        ]))
        return .object(JSObject([
            ("today", .string("2026-12-31")), ("year", .number(2026)), ("years", .array([.number(2025), .number(2026)])), ("prevYear", .number(2025)), ("nextYear", .null),
            ("empty", .bool(false)), ("count", .number(Double(n))), ("days", .number(Double(min(n, 300)))), ("coverYear", .string("二〇二六")),
            ("coverLine", ref("X-WORK.annualCoverLine", [("n", .string("\(n)"))])), ("first", first), ("months", .array(months)), ("twice", twice),
            ("emptyTitle", ref("R-M06.emptyTitle")), ("emptyBody", ref("R-M06.emptyBody")), ("emptyGlyph", ref("X-ANNUAL.emptyGlyph")),
            ("adjust", ref("X-WORK.adjustImage")), ("adjustAria", ref("X-WORK.adjustAria")), ("save", ref("R-M01.saveImage")),
        ]))
    }

    /// view.annual 的回包（{ok, view}；view 经 EngineValue.any 过边界）。
    static func payload(_ n: Int, ink: Bool, legacy: Bool = false, full: Bool = false) -> [String: Any] {
        ["ok": true, "view": EngineValue.any(view(n, ink: ink, legacy: legacy, full: full))]
    }

    /// 年报从顶滚到底（每步半屏）：每步的耗时、滚到底时建出来的格子数与层的统计，打一行 BENCH。
    static func scrollRun(variant: String, n: Int, all: Bool, payload: [String: Any]) {
        autoreleasepool {
            let vc = AnnualScreen(screen: "annual", entryId: "bench", params: [:])
            vc.cells.materializeAll = all
            let w = LibraryBench.host(vc)
            vc.apply(payload: payload)
            LibraryBench.settle(w)
            let h = vc.scroll.bounds.height
            let bottom = max(0, vc.scroll.contentSize.height - h)
            var times: [Double] = []
            var y: CGFloat = 0
            while y < bottom {
                y = min(bottom, y + h / 2)
                let t = LibraryBench.now()
                vc.scroll.contentOffset = CGPoint(x: 0, y: y)
                LibraryBench.settle(w)
                times.append(LibraryBench.ms(t, LibraryBench.now()))
            }
            let st = LibraryBench.layerStats(w.layer)
            print(String(format: "BENCH annual scroll \(variant)\(all ? "-all" : "") n=%ld steps=%ld step=%.0fpt median=%.1fms max=%.1fms live=%ld layers=%ld backing≈%.1fMB",
                         n, times.count, Double(h / 2), LibraryBench.median(times), times.max() ?? 0, vc.cells.liveIndices.count, st.layers, Double(st.backingBytes) / 1e6))
            LibraryBench.unhost(w)
        }
    }

    /// 解出来的视图里墨迹的点数（今年首字 + 每格 + 卷尾两格）。
    static func points(_ m: AnnualScreen.View) -> Int {
        func count(_ b: ShiziInkBox?) -> Int { b?.points.reduce(0) { $0 + $1.count } ?? 0 }
        var n = count(m.first?.ink) + count(m.twice?.first.ink) + count(m.twice?.last.ink)
        for sec in m.months { for c in sec.cells { n += count(c.ink) } }
        return n
    }
}

@MainActor
final class AnnualBenchTests: XCTestCase {
    /// 回包 view → AnnualScreen.View：改动前（旧形状 + ShiziDecode.value）/ 旧形状经 decodeView / 现在（平铺 + decodeView）。
    func testAnnualViewDecodeCost() throws {
        let sizes: [Int] = AppScale.pick([300, 800], scale: [300, 1200])
        for n in sizes {
            // 每格都是重的（8 笔 × 62 点）：只解不画，量的仍是以前的形状
            let raw = try XCTUnwrap(AnnualBench.payload(n, ink: true, full: true)["view"])
            let old = try XCTUnwrap(AnnualBench.payload(n, ink: true, legacy: true, full: true)["view"])
            var times: [Double] = [], perPoint: [Double] = [], direct: [Double] = []
            var points = 0, perPointPoints = 0, directPoints = 0
            for _ in 0..<3 {
                let t0 = LibraryBench.now()
                let m = try ShiziDecode.value(old, as: AnnualScreen.View.self)
                times.append(LibraryBench.ms(t0, LibraryBench.now()))
                points = AnnualBench.points(m)
                let t1 = LibraryBench.now()
                let slow = try AnnualScreen.decodeView(old)
                perPoint.append(LibraryBench.ms(t1, LibraryBench.now()))
                perPointPoints = AnnualBench.points(slow)
                let t2 = LibraryBench.now()
                let fast = try AnnualScreen.decodeView(raw) // 产品现在走的路
                direct.append(LibraryBench.ms(t2, LibraryBench.now()))
                directPoints = AnnualBench.points(fast)
            }
            print(String(format: "BENCH annual view-decode n=%ld points=%ld json=%.1fms perpoint=%.1fms direct=%.1fms",
                         n, points, LibraryBench.median(times), LibraryBench.median(perPoint), LibraryBench.median(direct)))
            XCTAssertEqual(points, (n + 3) * 8 * 62)
            XCTAssertEqual(perPointPoints, points)
            XCTAssertEqual(directPoints, points)
            XCTAssertNil(AnnualScreen.decodeViewDirect(old), "points carry t: the old shape goes the original way")
            XCTAssertNotNil(AnnualScreen.decodeViewDirect(raw), "direct path")
        }
    }

    /// 引擎边界到视图：view 的 JSValue → [String: Any]（EngineValue.any）→ AnnualScreen.View。
    func testAnnualInkWireCost() throws {
        let big: Int = AppScale.pick(800, scale: 1200)
        let cases: [(Int, Bool)] = [(300, false), (300, true), (big, false), (big, true)]
        for (n, legacy) in cases {
            var builds: [Double] = [], converts: [Double] = [], decodes: [Double] = []
            var points = 0
            for _ in 0..<3 {
                try autoreleasepool {
                    let t0 = LibraryBench.now()
                    let js = AnnualBench.view(n, ink: true, legacy: legacy, full: true) // 每格重的：只解不画
                    let t1 = LibraryBench.now()
                    let any = EngineValue.any(js)
                    let t2 = LibraryBench.now()
                    let m = try AnnualScreen.decodeView(any)
                    let t3 = LibraryBench.now()
                    builds.append(LibraryBench.ms(t0, t1)); converts.append(LibraryBench.ms(t1, t2)); decodes.append(LibraryBench.ms(t2, t3))
                    points = AnnualBench.points(m)
                }
            }
            print(String(format: "BENCH annual ink-wire format=\(legacy ? "points" : "flat") n=%ld points=%ld build=%.1fms convert=%.1fms decode=%.1fms",
                         n, points, LibraryBench.median(builds), LibraryBench.median(converts), LibraryBench.median(decodes)))
            XCTAssertEqual(points, (n + 3) * 8 * 62)
        }
    }

    /// 整页：新页面收回包、再排一次版、同一份回包再 apply 一次（每格都有墨迹 / 都是衬底字）；只建看得见的格子（产品）与全部建出来对照。
    func testAnnualReloadCost() throws {
        // 默认 300 / 800（全部建出来的对照只在 300）；SHIZI_SCALE_BENCH 时 300 / 1200 / 3000、每个都对照
        let sizes: [Int] = AppScale.pick([300, 800], scale: [300, 1200, 3000])
        for n in sizes {
            for ink in [true, false] {
                let payload = AnnualBench.payload(n, ink: ink)
                LibraryBench.run("annual", variant: ink ? "ink" : "glyph", n: n,
                                 make: { AnnualScreen(screen: "annual", entryId: "bench", params: [:]) }, payload: payload)
                guard AppScale.enabled || n <= 300 else { continue }
                LibraryBench.run("annual", variant: ink ? "ink-all" : "glyph-all", n: n, make: {
                    let vc = AnnualScreen(screen: "annual", entryId: "bench", params: [:])
                    vc.cells.materializeAll = true
                    return vc
                }, payload: payload)
            }
        }
    }

    /// 打开年报（App 一侧）：整份回包（每格带墨迹，以前的做法）vs 带 lazyInk 的回包 + 按建出来的格子取墨迹（现在的做法）。
    ///   BENCH annual open variant=<full|lazy> n=… payload=…ms（回包 view 从 JSValue 过边界：EngineValue.any，不含引擎侧拼回包——那一半见 ShiziCore 的 BENCH annual-lazy）
    ///     first=…ms（新页面 apply + 排版 + 提交：画面出来，lazy 时月段的墨还空着）loaded=…ms（到建出来的格子的墨迹都到了、画好；full = first）
    ///     requests=<view.annual.ink 次数> keys=<取的键数>
    /// 墨迹表在内存里（假的 view.annual.ink 立刻回，回包同引擎发的形状：AnnualInkWire 平铺、经 EngineValue.any），量的是 App 收包、解、建格子、画的那部分。
    func testAnnualOpenLazyVsFull() throws {
        let sizes: [Int] = AppScale.pick([300, 800], scale: [300, 1200, 3000])
        for n in sizes {
            let fullJS = AnnualBench.view(n, ink: true)
            // 带 lazyInk 的形状（hand 格 ink = null + inkKey）与墨迹表：引擎直接拼的就是这个形状，换的耗时不计
            let (liteJS, inkJS) = AnnualLazy.splitJS(fullJS)
            for lazy in [false, true] {
                var payloads: [Double] = [], firsts: [Double] = [], loads: [Double] = []
                var requests = 0, keys = 0
                for _ in 0..<3 {
                    autoreleasepool {
                        let t0 = LibraryBench.now()
                        let payload: [String: Any] = ["ok": true, "view": EngineValue.any(lazy ? liteJS : fullJS)]
                        let t1 = LibraryBench.now()
                        let fetcher = AnnualLazy.Fetcher([:])
                        fetcher.jsTable = inkJS // 取的时候才过边界（EngineValue.any），同引擎回 view.annual.ink
                        let vc = lazy ? AnnualLazy.make(fetcher) : AnnualScreen(screen: "annual", entryId: "bench", params: [:])
                        let w = LibraryBench.host(vc)
                        let t2 = LibraryBench.now()
                        vc.apply(payload: payload)
                        LibraryBench.settle(w)
                        let t3 = LibraryBench.now()
                        if lazy { XCTAssertTrue(AnnualLazy.waitInk(vc, w, timeout: AppScale.enabled ? 30 : 10), "n=\(n): ink arrives") }
                        let t4 = LibraryBench.now()
                        payloads.append(LibraryBench.ms(t0, t1))
                        firsts.append(LibraryBench.ms(t2, t3))
                        loads.append(LibraryBench.ms(t2, t4))
                        requests = fetcher.calls.count
                        keys = fetcher.keys.count
                        LibraryBench.unhost(w)
                    }
                }
                print(String(format: "BENCH annual open variant=\(lazy ? "lazy" : "full") n=%ld payload=%.1fms first=%.1fms loaded=%.1fms requests=%ld keys=%ld",
                             n, LibraryBench.median(payloads), LibraryBench.median(firsts), LibraryBench.median(loads), requests, keys))
            }
        }
    }

    /// 滚动的每一步要多久（新进来的格子在这一步里建 / 配 / 画；全部建出来时 = 以前每格一个 KVO 的做法之外的那部分）。
    func testAnnualScrollCost() throws {
        let sizes: [Int] = AppScale.pick([300, 800], scale: [300, 1200, 3000])
        let compareAt: Int = AppScale.pick(300, scale: 1200)
        for n in sizes {
            for ink in [true, false] {
                let payload = AnnualBench.payload(n, ink: ink)
                AnnualBench.scrollRun(variant: ink ? "ink" : "glyph", n: n, all: false, payload: payload)
                if n == compareAt { AnnualBench.scrollRun(variant: ink ? "ink" : "glyph", n: n, all: true, payload: payload) }
            }
        }
    }
}
