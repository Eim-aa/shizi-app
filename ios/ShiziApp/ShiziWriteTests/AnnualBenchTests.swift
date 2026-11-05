import ShiziCore
import UIKit
import XCTest
@testable import Shizi

// MARK: - 年报收到一份视图回包之后的耗时：量测（BENCH）

/// 年报（AnnualScreen）收到 view.annual 回包之后的耗时（CI 日志里 grep BENCH）。只打印、不断言时间。
///   BENCH annual view-decode n=<格数> points=<点数> json=…ms
///     json = render 里那一行：整份 view 经 ShiziDecode.value（JSONSerialization 往返）解成 AnnualScreen.View（墨迹每点一个对象）
///   BENCH annual ink-wire format=<points> n=… points=… build=…ms convert=…ms decode=…ms
///     build = 引擎侧拼整份 view 的 JSValue；convert = EngineValue.any（App 收回包时走的那一步）；decode = 同上 json
///   BENCH annual <ink|glyph> n=… first=… relayout=… reapply=… layers=… images=… backing≈…（同 LibraryBench.run：新页面 apply + 排版 + 提交，
///     再排一次版，同一份回包再 apply 一次；年报的格子一次全建出来，没有按视口建）
/// 合成回包：形状同 ShiziCore MineSubView.annualView（每月一段、每段的格、今年首字、卷尾两格），经 EngineValue.any 过边界，同引擎真发的；
/// 每格墨迹 8 笔 × 62 点（≈ resampleForReplay 之后的一字；每点 x / y / t / w，键序同 InkPoint.js），字取包里有字形数据的字，分 12 个月。
@MainActor
enum AnnualBench {
    static func ref(_ key: String, _ params: [(String, JSValue)] = []) -> JSValue {
        params.isEmpty ? .object(JSObject([("copy", .string(key))])) : .object(JSObject([("copy", .string(key)), ("params", .object(JSObject(params)))]))
    }

    /// 一格的回放点（ShiziCore InkPoint，同 resampleForReplay 的输出：x / y / t / w，键序 x, y, t, p, w）。
    static func inkPoints(_ seed: Int) -> [[InkPoint]] {
        (0..<8).map { s in
            (0..<62).map { j in
                let u = Double(j) / 61
                let a = Double(seed % 17) * 0.37 + Double(s) * 0.8
                let x = 40 + 230 * u * (0.5 + 0.5 * cos(a)) + Double(s) * 9
                let y = 40 + 30 * Double(s) + 25 * sin(u * 3 + a)
                let w = 9 + 4 * sin(u * 5 + Double(s))
                return InkPoint(x: x, y: y, t: Double(1000 * s) + 8.25 * Double(j), w: w)
            }
        }
    }

    /// ink.points：每点一个 InkPoint.js 对象（DetailView.builtInk，现在 annualView 发的）。
    static func perPointPoints(_ resampled: [[InkPoint]]) -> JSValue { .array(resampled.map { .array($0.map(\.js)) }) }

    /// 一格的 ink（{points}）。
    static func box(_ seed: Int) -> JSValue { .object(JSObject([("points", perPointPoints(inkPoints(seed)))])) }

    /// view.annual 的 view（JSValue，过边界之前）：n 格分 12 个月；ink = 每格都有墨迹，否则都画衬底字（今年首字与卷尾照样有墨迹）。
    static func view(_ n: Int, ink: Bool) -> JSValue {
        let cs = LibraryBench.chars(max(n, 1))
        let per = max(1, (n + 11) / 12)
        var months: [JSValue] = []
        var start = 0
        while start < n {
            let end = min(n, start + per), mn = Double(months.count + 1)
            let month = String(format: "2026-%02d", months.count + 1)
            let cells: [JSValue] = (start..<end).map { i in
                .object(JSObject([
                    ("ch", .string(cs[i])), ("ink", ink ? box(i) : .null), ("mode", .string(ink ? "hand" : "under")), ("tag", .string("")), ("day", .string("")),
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
            .object(JSObject([("recordId", .string("r\(seed)")), ("day", .string(day)), ("ink", box(seed)), ("label", ref(label, [("char", .string(cs[0]))])), ("date", date(1, 1))]))
        }
        let first = JSValue.object(JSObject([
            ("char", .string(cs[0])), ("day", .string("2026-01-01")), ("recordId", .string("r0")), ("ink", box(0)),
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
    static func payload(_ n: Int, ink: Bool) -> [String: Any] { ["ok": true, "view": EngineValue.any(view(n, ink: ink))] }

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
    /// 回包 view → AnnualScreen.View（render 里的 ShiziDecode.value）。
    func testAnnualViewDecodeCost() throws {
        for n in [300, 1200] {
            let raw = try XCTUnwrap(AnnualBench.payload(n, ink: true)["view"])
            var times: [Double] = []
            var points = 0
            for _ in 0..<3 {
                let t0 = LibraryBench.now()
                let m = try ShiziDecode.value(raw, as: AnnualScreen.View.self)
                times.append(LibraryBench.ms(t0, LibraryBench.now()))
                points = AnnualBench.points(m)
            }
            print(String(format: "BENCH annual view-decode n=%ld points=%ld json=%.1fms", n, points, LibraryBench.median(times)))
            XCTAssertEqual(points, (n + 3) * 8 * 62)
        }
    }

    /// 引擎边界到视图：view 的 JSValue → [String: Any]（EngineValue.any）→ AnnualScreen.View。
    func testAnnualInkWireCost() throws {
        for n in [300, 1200] {
            var builds: [Double] = [], converts: [Double] = [], decodes: [Double] = []
            var points = 0
            for _ in 0..<3 {
                try autoreleasepool {
                    let t0 = LibraryBench.now()
                    let js = AnnualBench.view(n, ink: true)
                    let t1 = LibraryBench.now()
                    let any = EngineValue.any(js)
                    let t2 = LibraryBench.now()
                    let m = try ShiziDecode.value(any, as: AnnualScreen.View.self)
                    let t3 = LibraryBench.now()
                    builds.append(LibraryBench.ms(t0, t1)); converts.append(LibraryBench.ms(t1, t2)); decodes.append(LibraryBench.ms(t2, t3))
                    points = AnnualBench.points(m)
                }
            }
            print(String(format: "BENCH annual ink-wire format=points n=%ld points=%ld build=%.1fms convert=%.1fms decode=%.1fms",
                         n, points, LibraryBench.median(builds), LibraryBench.median(converts), LibraryBench.median(decodes)))
            XCTAssertEqual(points, (n + 3) * 8 * 62)
        }
    }

    /// 整页：新页面收回包、再排一次版、同一份回包再 apply 一次（每格都有墨迹 / 都是衬底字）。
    func testAnnualReloadCost() throws {
        for n in [300, 1200] {
            for ink in [true, false] {
                LibraryBench.run("annual", variant: ink ? "ink" : "glyph", n: n,
                                 make: { AnnualScreen(screen: "annual", entryId: "bench", params: [:]) }, payload: AnnualBench.payload(n, ink: ink))
            }
        }
    }
}
