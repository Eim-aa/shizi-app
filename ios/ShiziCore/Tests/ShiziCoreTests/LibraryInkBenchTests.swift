import Foundation
import XCTest
@testable import ShiziCore

// 字库子页（全部字 / 清单）回包里墨迹那一份在引擎侧的耗时（只打印、不断言耗时；CI 日志里 grep BENCH）。
//
// 场景：1500 个不同的字，每字一条写错的记录、每条都有墨迹（Ink v4 原始点，8 笔 × 40 点）；全部字页按「新旧」排（所有格都展开），
// 清单页是「写错过」（每字一行）。两页都把 1500 条墨迹放进回包。
//
// 输出：
//   BENCH library-ink engine op=<all|list> records=… points=… total=…ms view=…ms read=…ms build=…ms build-points=…ms
//     total = PageAPI.call 整个 op（视图 + 墨迹 + 回包对象）
//     view  = 只算视图模型（LibraryAllView.allModel / LibraryListView.listModel，同 op 传的参数）
//     read  = 墨迹：store.getInk + InkMath.decodeInk + resampleForReplay（每条记录）
//     build = 墨迹：重采样后的点 → 回包里的 JSValue（LibrarySubAPI 现在发的平铺形状，LibraryInkWire.record）
//     build-points = 同上，改用旧形状（每点一个 {x, y, w} 对象）对照
// 每个量跑 3 次取中位数（先空跑一次）。

final class LibraryInkBenchTests: XCTestCase {
    static let count = 1500
    static let months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]

    static func median(_ xs: [Double]) -> Double {
        let s = xs.sorted()
        return s.isEmpty ? 0 : s[s.count / 2]
    }

    static func time(_ body: () throws -> Void) rethrows -> Double {
        let t0 = DispatchTime.now().uptimeNanoseconds
        try body()
        return Double(DispatchTime.now().uptimeNanoseconds - t0) / 1_000_000
    }

    /// 1500 个字、每字一条写错的记录 + 一条墨迹的 v2 状态。
    static func inkedState(_ n: Int = count) throws -> JSObject {
        let pool = StoreCommitBenchmarkTests.chars(n)
        var records = JSObject(), ink = JSObject()
        for i in 0..<n {
            let month = months[i * months.count / n]
            let day = month + "-" + StoreCommitBenchmarkTests.pad2(1 + i % 28)
            let rec = srec(i + 1, pool[i], judgment: "wrong", day: day, at: dayMs(day, 9) + Double(i) * 1000)
            records[month] = .array((records[month]?.arrayValue ?? []) + [rec])
            var table = ink[month]?.objectValue ?? JSObject()
            table["r\(i + 1)"] = try InkMath.encodeStoredInk(StoreCommitBenchmarkTests.rawStrokes(8, seed: i), policy: Config.policy.objectValue, format: "raw")
            ink[month] = .object(table)
        }
        var state = storeBaseline()
        state["meta"] = .object(JSObject([("schema", .number(2)), ("serial", .number(Double(n))), ("createdAt", .number(T0)), ("months", .array(months.map { .string($0) }))]))
        state["records"] = .object(records)
        state["sched"] = .object(JSObject())
        state["ink"] = .object(ink)
        state["custom"] = .object(JSObject([("added", .array([]))]))
        state["sessions"] = .object(JSObject([("A", .null), ("B", .null), ("lastEnded", .object(JSObject()))]))
        return state
    }

    static func inkedStore(_ n: Int = count) throws -> Store {
        let env = freshStore(.native, budgets: Budgets.native.js)
        let r = env.store.seed(.object(try inkedState(n)), label: "bench-seed")
        XCTAssertEqual(r["ok"], .bool(true), str(r))
        return env.store
    }

    /// 回包里带墨迹的记录（同 LibrarySubAPI 的取法）。
    static func inkRecords(_ op: String, _ view: JSValue) -> [JSValue] {
        op == "view.library-list" ? (view["rows"]?.arrayValue ?? []).compactMap { $0["record"] }
            : (view["groups"]?.arrayValue ?? []).flatMap { ($0["cells"]?.arrayValue ?? []).compactMap { $0["record"] } }
    }

    /// 视图参数（同 LibrarySubAPI 给 allModel / listModel 的）。
    static func viewArgs(_ op: String, _ store: Store) throws -> JSObject {
        var a = JSObject([("today", .string(try store.dates.localDay(.number(store.now()))))])
        if op == "view.library-all" { a["sort"] = .string("age"); a["compact"] = .bool(false); a["find"] = .string("") }
        return a
    }

    static func view(_ op: String, _ store: Store) throws -> JSValue {
        let state = JSValue.object(store.state), args = try viewArgs(op, store)
        return op == "view.library-list" ? try LibraryListView.listModel(state, args, dates: store.dates) : try LibraryAllView.allModel(state, args, dates: store.dates)
    }

    /// 每条记录的回放点（读 + 解码 + 重采样）。
    static func replay(_ store: Store, _ records: [JSValue]) -> [(String, [[InkPoint]])] {
        records.compactMap { r in
            guard let raw = store.getInk(r), let decoded = try? InkMath.decodeInk(raw) else { return nil }
            return (JS.string(r["id"]), InkMath.resampleForReplay(decoded))
        }
    }

    /// 回包里的 ink（LibraryInkWire：平铺；legacy = 旧形状，每点一个 {x, y, w?} 对象）。
    static func build(_ replayed: [(String, [[InkPoint]])], legacy: Bool) -> JSObject {
        var ink = JSObject()
        for (id, resampled) in replayed {
            if let strokes = LibraryInkWire.record(resampled, legacy: legacy) { ink[id] = strokes }
        }
        return ink
    }

    func testLibraryInkEngineCost() throws {
        let store = try Self.inkedStore()
        for (op, name) in [("view.library-all", "all"), ("view.library-list", "list")] {
            let args: JSObject = op == "view.library-all" ? JSObject([("sort", .string("age"))]) : JSObject()
            var total: [Double] = [], views: [Double] = [], reads: [Double] = [], builds: [Double] = [], legacyBuilds: [Double] = []
            var records = 0, points = 0, inkKeys = 0
            for rep in 0..<4 {
                var reply: JSValue = .null
                let t = Self.time { reply = PageAPI.call(op, store: store, args: args) }
                XCTAssertEqual(reply["ok"], .bool(true), op)
                inkKeys = reply["ink"]?.objectValue?.count ?? -1
                var v: JSValue = .null
                let tv = try Self.time { v = try Self.view(op, store) }
                let recs = Self.inkRecords(op, v)
                var replayed: [(String, [[InkPoint]])] = []
                let tr = Self.time { replayed = Self.replay(store, recs) }
                var built = JSObject(), legacy = JSObject()
                let tb = Self.time { built = Self.build(replayed, legacy: false) }
                let tl = Self.time { legacy = Self.build(replayed, legacy: true) }
                XCTAssertEqual(built.count, inkKeys, "\(op): builds the same ink map as the op")
                XCTAssertEqual(legacy.count, inkKeys, op)
                if rep == 0 { XCTAssertEqual(JSValue.object(built), reply["ink"], "\(op): same payload as the op") }
                records = recs.count
                points = replayed.reduce(0) { $0 + $1.1.reduce(0) { $0 + $1.count } }
                if rep > 0 { total.append(t); views.append(tv); reads.append(tr); builds.append(tb); legacyBuilds.append(tl) }
            }
            XCTAssertEqual(records, Self.count, op)
            XCTAssertEqual(inkKeys, Self.count, op)
            print(String(format: "BENCH library-ink engine op=\(name) records=%ld points=%ld total=%.1fms view=%.1fms read=%.1fms build=%.1fms build-points=%.1fms",
                         records, points, Self.median(total), Self.median(views), Self.median(reads), Self.median(builds), Self.median(legacyBuilds)))
        }
    }
}
