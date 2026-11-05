import Foundation
import XCTest
@testable import ShiziCore

// 年报（view.annual）回包里墨迹那一份在引擎侧的耗时（只打印、不断言耗时；CI 日志里 grep BENCH）。
//
// 场景：2026 年 1200 个不同的字，每字一条写对的记录、每条都有墨迹（Ink v4 原始点，8 笔 × 40 点），分在 1–9 月；
// 头一个字 9 月底又写了一次（有墨迹），卷尾「同字两次」也有两格墨迹。年报每月一段把那个月的字全列出来，
// 所以回包里有 1200 格墨迹 + 今年首字 1 格 + 卷尾 2 格。
//
// 输出：
//   BENCH annual-ink engine slots=<带墨迹的格数> cells=<月段里的格数> points=<回放点数> total=…ms view=…ms view-points=…ms read=…ms build=…ms build-points=…ms
//     total = PageAPI.call("view.annual") 整个 op
//     view  = 只算视图（MineSubView.annualView，同 op 传的参数：inkWire，平铺、每条墨迹只解一次）
//     view-points = 同上，inkWire: false（改动前的路：每点一个 InkPoint.js 对象，每条墨迹解好几遍）对照
//     read  = 每个带墨迹的格各一次：store.getInk + InkMath.decodeInk + resampleForReplay
//     build = 每个带墨迹的格各一次：回放点 → 回包里的 ink.points（AnnualInkWire.points，平铺）
//     build-points = 同上，旧形状（每点一个 InkPoint.js 对象，同 DetailView.builtInk）对照
//   view-points ≫ read + build-points：改动前视图里每条墨迹要解几遍（月段的 imagePlan 判有无墨迹、拼格各一遍，annualView 再拼一遍）。
// 每个量跑 3 次取中位数（先空跑一次）。

final class AnnualInkBenchTests: XCTestCase {
    static let count = 1200
    static let year = 2026
    static let months = (1...9).map { "2026-" + StoreCommitBenchmarkTests.pad2($0) }

    static func median(_ xs: [Double]) -> Double {
        let s = xs.sorted()
        return s.isEmpty ? 0 : s[s.count / 2]
    }

    static func time(_ body: () throws -> Void) rethrows -> Double {
        let t0 = DispatchTime.now().uptimeNanoseconds
        try body()
        return Double(DispatchTime.now().uptimeNanoseconds - t0) / 1_000_000
    }

    /// n 个字、每字一条写对的记录 + 一条墨迹（1–9 月）；头一个字 9 月 28 日再写一次（也有墨迹）。
    static func annualState(_ n: Int = count) throws -> JSObject {
        let pool = StoreCommitBenchmarkTests.chars(n)
        var records = JSObject(), ink = JSObject()
        func add(_ serial: Int, _ char: String, _ day: String, seed: Int) throws {
            let month = String(day.prefix(7))
            let rec = srec(serial, char, day: day, at: dayMs(day, 9) + Double(serial) * 1000)
            records[month] = .array((records[month]?.arrayValue ?? []) + [rec])
            var table = ink[month]?.objectValue ?? JSObject()
            table["r\(serial)"] = try InkMath.encodeStoredInk(StoreCommitBenchmarkTests.rawStrokes(8, seed: seed), policy: Config.policy.objectValue, format: "raw")
            ink[month] = .object(table)
        }
        for i in 0..<n {
            let month = months[i * months.count / n]
            try add(i + 1, pool[i], month + "-" + StoreCommitBenchmarkTests.pad2(1 + i % 27), seed: i)
        }
        try add(n + 1, pool[0], "2026-09-28", seed: n)
        var state = storeBaseline()
        state["meta"] = .object(JSObject([("schema", .number(2)), ("serial", .number(Double(n + 1))), ("createdAt", .number(T0)), ("months", .array(months.map { .string($0) }))]))
        state["records"] = .object(records)
        state["sched"] = .object(JSObject())
        state["ink"] = .object(ink)
        state["custom"] = .object(JSObject([("added", .array([]))]))
        state["sessions"] = .object(JSObject([("A", .null), ("B", .null), ("lastEnded", .object(JSObject()))]))
        return state
    }

    static func annualStore(_ n: Int = count) throws -> Store {
        let env = freshStore(.native, budgets: Budgets.native.js)
        let r = env.store.seed(.object(try annualState(n)), label: "bench-seed")
        XCTAssertEqual(r["ok"], .bool(true), str(r))
        return env.store
    }

    static var args: JSObject { JSObject([("year", .number(Double(year)))]) }

    /// 只算视图（同 MineSubAPI 给 annualView 的参数；inkWire: false = 改动前的路）。
    static func view(_ store: Store, inkWire: Bool = true) throws -> JSValue {
        try MineSubView.annualView(.object(store.state), today: try store.dates.localDay(.number(store.now())), year: .number(Double(year)), policy: Config.policy, inkWire: inkWire, dates: store.dates)
    }

    /// 视图里带墨迹的格（今年首字、每月一段的格、卷尾两格）对应的记录 id。
    static func inkedIds(_ view: JSValue) -> [String] {
        var ids: [String] = []
        func take(_ slot: JSValue?) { if let s = slot, JS.truthy(s["ink"] ?? .null) { ids.append(JS.string(s["recordId"])) } }
        take(view["first"])
        for m in view["months"]?.arrayValue ?? [] { for c in m["cells"]?.arrayValue ?? [] { take(c) } }
        take(view["twice"]?["first"])
        take(view["twice"]?["last"])
        return ids
    }

    static func cellCount(_ view: JSValue) -> Int { (view["months"]?.arrayValue ?? []).reduce(0) { $0 + ($1["cells"]?.arrayValue?.count ?? 0) } }

    /// 每个带墨迹的格的回放点（读 + 解码 + 重采样，各一次）。
    static func replay(_ store: Store, _ ids: [String]) -> [[[InkPoint]]] {
        var byId: [String: JSValue] = [:]
        for r in Query.flattenRecords(store.state["records"]) { byId[JS.string(r["id"])] = r }
        return ids.compactMap { id in
            guard let r = byId[id], let raw = store.getInk(r), let decoded = try? InkMath.decodeInk(raw) else { return nil }
            return InkMath.resampleForReplay(decoded)
        }
    }

    /// 改动前 annualView 发的 ink.points：每点一个 InkPoint.js 对象（DetailView.builtInk）。
    static func perPointPoints(_ resampled: [[InkPoint]]) -> JSValue { .array(resampled.map { .array($0.map(\.js)) }) }

    func testAnnualInkEngineCost() throws {
        let store = try Self.annualStore()
        var total: [Double] = [], views: [Double] = [], legacyViews: [Double] = [], reads: [Double] = [], builds: [Double] = [], legacyBuilds: [Double] = []
        var slots = 0, cells = 0, points = 0
        for rep in 0..<4 {
            var reply: JSValue = .null
            let t = Self.time { reply = PageAPI.call("view.annual", store: store, args: Self.args) }
            XCTAssertEqual(reply["ok"], .bool(true), str(reply["error"] ?? .null))
            var v: JSValue = .null
            let tv = try Self.time { v = try Self.view(store) }
            if rep == 0 { XCTAssertEqual(v, reply["view"], "the op sends annualView(inkWire: true)") }
            var legacyView: JSValue = .null
            let tl = try Self.time { legacyView = try Self.view(store, inkWire: false) }
            XCTAssertEqual(Self.inkedIds(legacyView), Self.inkedIds(v))
            let ids = Self.inkedIds(v)
            var replayed: [[[InkPoint]]] = []
            let tr = Self.time { replayed = Self.replay(store, ids) }
            var built: [JSValue] = [], legacy: [JSValue] = []
            let tb = Self.time { built = replayed.map { AnnualInkWire.points($0) } }
            let tlb = Self.time { legacy = replayed.map(Self.perPointPoints) }
            XCTAssertEqual(built.count, ids.count)
            if rep == 0 { XCTAssertEqual(legacy, replayed.map { AnnualInkWire.points($0, legacy: true) }, "the legacy replica is AnnualInkWire's legacy shape") }
            slots = ids.count
            cells = Self.cellCount(v)
            points = replayed.reduce(0) { $0 + $1.reduce(0) { $0 + $1.count } }
            if rep > 0 { total.append(t); views.append(tv); legacyViews.append(tl); reads.append(tr); builds.append(tb); legacyBuilds.append(tlb) }
        }
        XCTAssertEqual(cells, Self.count + 1, "every char of the year is a month cell (the first char twice: January and September)")
        XCTAssertEqual(slots, cells + 3, "every cell, the first char and both twice halves carry ink")
        print(String(format: "BENCH annual-ink engine slots=%ld cells=%ld points=%ld total=%.1fms view=%.1fms view-points=%.1fms read=%.1fms build=%.1fms build-points=%.1fms",
                     slots, cells, points, Self.median(total), Self.median(views), Self.median(legacyViews), Self.median(reads), Self.median(builds), Self.median(legacyBuilds)))
    }
}
