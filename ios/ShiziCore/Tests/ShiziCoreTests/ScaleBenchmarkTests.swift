import Foundation
import XCTest
@testable import ShiziCore

// 数据量梯度量测（只打印耗时，不断言耗时；只断言「造出来的数据确实是这个量、seed 接受、没被预算回收折叠」）。
//
// 动机：深度用户几年下来可能有 1000–7000 个练过的字、几万条练习记录。StoreCommitBenchmarkTests / AColdStartBenchmarkTests 只量一档
// （records 6000、sched 2000、ink 500），看不出哪些操作随数据量线性（或更糟）增长。这里用同一个生成器（StoreCommitBenchmarkTests.heavyState(_:)，
// 参数化为 Shape）在三档数据量上各量一遍每次交互路径上的操作：
//
//   档     月份            每月   records  sched(字)  ink
//   1x     8（2026-03…10）   750     6000     2000      500     = StoreCommitBenchmarkTests 的现有档
//   3x     20（2025-03…）    900    18000     4500     1500
//   10x    40（2023-07…）   1500    60000     7000     5000     （sched 不超过题库里可练的单字数，约 7200）
//
// 记录按月分存（records.<YYYY-MM>），日期全在固定时钟（2026-10-21 09:00 上海）之前、按天铺开；墨迹挂在最后 N 条记录上（最近的字才有墨迹）。
//
// 预算：1x 用 App 的原生预算（与现有基准相同）。3x / 10x 的数据量超过原生预算（records 16MB、墨迹 32MB、总目标 48MB，且 400 天前的月份会被折叠），
// 一旦超出，seed / commit 会触发预算回收，把旧月份折叠、丢旧墨迹，量到的就不是这个数据量了；所以 3x / 10x 把各项预算按倍数放大、折叠天数放到 36500，
// 只为「在这个数据量上量」——这不是 App 的真实行为（真实 App 会折叠）。造完后断言条数没变（没被回收）。
//
// 输出（每行一个 (op, backend, scale)）：
//   BENCH scale op=<op> backend=<fake|sqlite> scale=<1x|3x|10x> records=… chars=… ink=… bytes=… n=… median=…ms max=…ms
//   op：disk.open（建后端 / 读入镜像）、store.load（冷：新 Store 读全库并校验）、usage（refreshUsage）、
//       flatten（Query.flattenRecords）、practiceStats、planDaily、home（HomeView.homeView，无开着的会话，走最重的分支）、
//       strokes（WriteAPI strokes 提交）、judge（WriteAPI judge 提交）、commit-judge（与判断同形的 store.commit）。
//   bytes = Store.usage 的 total（UTF-16 口径，与预算同口径）。
// 读法：同一 op 的 1x → 3x → 10x，records 依次约 ×3、×3.3；median 也约 ×3、×3.3 即线性（O(总记录数)）；基本不变即与总量无关
// （O(1) 或 O(一个月)）；涨得比数据量还快（10x 比 3x 的倍数明显大于 3.3）才是超线性。max 看偶发长尾。跨机器只看量级与倍数。
final class ScaleBenchmarkTests: XCTestCase {
    typealias B = StoreCommitBenchmarkTests

    struct Scale {
        let name: String
        let factor: Double
        let shape: B.Shape
        /// 写操作（strokes / judge / commit-judge）与读操作（home 等）的样本数；store.load 的次数。
        let writes: Int
        let reads: Int
        let loads: Int
    }

    struct Info {
        let records: Int
        let chars: Int
        let ink: Int
        let bytes: Int
    }

    private var sink = 0

    /// 止于 2026-10 的 count 个月（升序）。
    static func monthsEndingOct2026(_ count: Int) -> [String] {
        (0..<count).reversed().map { (k: Int) -> String in
            let total = 2026 * 12 + 9 - k
            return String(total / 12) + "-" + B.pad2(total % 12 + 1)
        }
    }

    /// 可练的单字数封顶（题库里约 7200 个）。
    static func studied(_ want: Int) -> Int { min(want, B.practicableChars(want).count) }

    static func scale1x() -> Scale { Scale(name: "1x", factor: 1, shape: B.shape1x, writes: 15, reads: 9, loads: 5) }
    static func scale3x() -> Scale {
        Scale(name: "3x", factor: 3, shape: B.Shape(months: monthsEndingOct2026(20), recordsPerMonth: 900, studied: studied(4500), inkRecords: 1500), writes: 9, reads: 5, loads: 3)
    }
    static func scale10x() -> Scale {
        Scale(name: "10x", factor: 10, shape: B.Shape(months: monthsEndingOct2026(40), recordsPerMonth: 1500, studied: studied(7000), inkRecords: 5000), writes: 5, reads: 3, loads: 3)
    }

    /// 1x = App 的原生预算；更大的档把各项预算按倍数放大并取消折叠（见文件头）。
    static func budgets(_ scale: Scale) -> JSObject {
        var b = Budgets.native
        if scale.factor > 1 {
            b.quotaBytes *= scale.factor
            b.totalTargetBytes *= scale.factor
            b.recordsBudgetBytes *= scale.factor
            b.inkBudgetBytes *= scale.factor
            b.recordsFoldAfterDays = 36500
        }
        return b.js
    }

    private func report(_ op: String, _ backend: String, _ scale: Scale, _ info: Info, _ samples: [Double]) {
        let s = samples.sorted()
        print("BENCH scale op=\(op) backend=\(backend) scale=\(scale.name) records=\(info.records) chars=\(info.chars) ink=\(info.ink) bytes=\(info.bytes) n=\(s.count) median=\(B.fmt(B.median(s)))ms max=\(B.fmt(s.last!))ms")
    }

    @discardableResult
    private func timed(_ body: () throws -> Void) rethrows -> Double {
        let t0 = DispatchTime.now().uptimeNanoseconds
        try body()
        return Double(DispatchTime.now().uptimeNanoseconds - t0) / 1_000_000
    }

    /// 预热 warm 次（不计）后量 n 次。
    private func sample(warm: Int, n: Int, _ body: () throws -> Void) rethrows -> [Double] {
        var out: [Double] = []
        for i in 0..<(warm + n) {
            let ms = try timed(body)
            if i >= warm { out.append(ms) }
        }
        return out
    }

    private func buildState(_ scale: Scale) throws -> JSObject {
        let t0 = DispatchTime.now().uptimeNanoseconds
        let state = try B.heavyState(scale.shape)
        print("BENCH scale-note scale=\(scale.name) generate=\(B.fmt(Double(DispatchTime.now().uptimeNanoseconds - t0) / 1_000_000))ms")
        return state
    }

    private func makeStore(_ backend: KVBackend, _ clock: B.Clock, _ scale: Scale) -> Store {
        let storage = StoreStorage(backend, now: { clock.t })
        return Store(storage: storage, now: { clock.t }, budgets: Self.budgets(scale), dates: shanghai)
    }

    private func run(_ name: String, _ scale: Scale, _ state: JSObject, _ backend: () -> KVBackend) throws {
        JSMath.flavor = .v8
        let clock = B.Clock(B.benchNow)
        let shape = scale.shape

        // 播种（计时只作说明）：seed 必须 ok，否则生成器有错，宁可在这里失败也不打印假数字
        do {
            let seeding = makeStore(backend(), clock, scale)
            XCTAssertEqual(seeding.load()["available"], .bool(true))
            var r: JSValue = .null
            let ms = timed { r = seeding.seed(.object(state), label: "scale-seed") }
            XCTAssertEqual(r["ok"], .bool(true), str(r))
            print("BENCH scale-note scale=\(scale.name) backend=\(name) seed=\(B.fmt(ms))ms")
            guard ok(r) else { return }
        }

        // store.load：每次都是新 Store 从库里冷读（后端也重新打开）；最后一次的 store 留给后面的操作
        var openSamples: [Double] = [], loadSamples: [Double] = []
        var kept: Store? = nil
        for _ in 0..<scale.loads {
            kept = nil
            var be: KVBackend? = nil
            openSamples.append(timed { be = backend() })
            let fresh = makeStore(be!, clock, scale)
            var loaded: JSValue = .null
            loadSamples.append(timed { loaded = fresh.load() })
            XCTAssertEqual(loaded["available"], .bool(true))
            kept = fresh
        }
        guard let store = kept else { return XCTFail("no store") }

        let schedCount = store.state["sched"]?.objectValue?.count ?? 0
        let recordCount = SessionWrites.allRecords(store.state).count
        let inkCount = flatInk(store.state["ink"]).count
        XCTAssertEqual(schedCount, shape.studied, "sched must survive seed + load (no budget recovery)")
        XCTAssertEqual(recordCount, shape.records, "records must survive seed + load (no budget recovery / folding)")
        XCTAssertEqual(inkCount, shape.inkRecords, "ink must survive seed + load (no budget recovery)")
        XCTAssertEqual(store.state["records"]?.objectValue?.count, shape.months.count)
        let info = Info(records: recordCount, chars: schedCount, ink: inkCount, bytes: Int(store.usage?["total"]?.numberValue ?? 0))
        report("disk.open", name, scale, info, openSamples)
        report("store.load", name, scale, info, loadSamples)

        // ---- 读路径（不改状态）----
        report("usage", name, scale, info, sample(warm: 1, n: scale.reads) {
            let u = store.refreshUsage()
            XCTAssertNotNil(u)
        })

        // 首页：没有开着的会话 = 最重的分支（走 planDaily / planSpecial / noCharsLeft）；字库用缺省字库
        var hs = store.state
        hs["sessions"] = .object(JSObject([("A", .null), ("B", .null), ("lastEnded", .object(JSObject()))]))
        var settings = hs["settings"]?.objectValue ?? JSObject()
        settings["library"] = .string(DeckIndex.shared.defaultLibraryId)
        hs["settings"] = .object(settings)
        let st = JSValue.object(hs)
        let policy = Config.policy, rules = ScheduleRules(dates: shanghai), deck = ScheduleDeck.real
        let today = try shanghai.localDay(.number(B.benchNow))
        let recs = Query.flattenRecords(st["records"])
        XCTAssertEqual(recs.count, shape.records)

        report("flatten", name, scale, info, sample(warm: 1, n: scale.reads) { sink &+= Query.flattenRecords(st["records"]).count })
        report("practiceStats", name, scale, info, try sample(warm: 1, n: scale.reads) {
            sink &+= Int(try rules.practiceStats(recs, today, policy: policy, isWarm: NewOrder.isWarmupKey).groupsTotal)
        })
        report("planDaily", name, scale, info, try sample(warm: 1, n: scale.reads) {
            sink &+= try rules.planDaily(st, today: today, deck: deck, policy: policy).objectValue?.count ?? 0
        })
        let home = try HomeView.homeView(st, now: B.benchNow, policy: policy, deck: .real, ui: nil, dates: shanghai)
        XCTAssertNotNil(home.objectValue, "home view must build")
        report("home", name, scale, info, try sample(warm: 0, n: scale.reads) {
            sink &+= try HomeView.homeView(st, now: B.benchNow, policy: policy, deck: .real, ui: nil, dates: shanghai).objectValue?.count ?? 0
        })

        // ---- 写路径（与 StoreCommitBenchmarkTests 同形；之后状态会变，所以放在读路径之后）----
        let opened = WriteAPI.call("open", store, JSObject([("slot", .string("A"))]))
        XCTAssertEqual(opened["ok"], .bool(true), str(opened))
        var cardKey = opened["snapshot"]?["cardKey"] ?? .null
        XCTAssertNotEqual(cardKey, .null)

        let warm = 3
        var strokes: [Double] = []
        for i in 0..<(warm + scale.writes) {
            clock.t += 500
            let args = JSObject([("slot", .string("A")), ("cardKey", cardKey), ("strokes", B.wireStrokes(1 + i % 12, seed: i))])
            var r: JSValue = .null
            let ms = B.time { r = WriteAPI.call("strokes", store, args) }
            XCTAssertEqual(r["ok"], .bool(true), str(r))
            XCTAssertEqual(r["noop"], .bool(false), str(r))
            if i >= warm { strokes.append(ms) }
        }
        report("strokes", name, scale, info, strokes)

        var judges: [Double] = []
        for i in 0..<(warm + scale.writes) {
            clock.t += 1000
            let args = JSObject([("slot", .string("A")), ("cardKey", cardKey), ("strokes", B.wireStrokes(3 + i % 8, seed: 100 + i)), ("judgment", .string("correct"))])
            var r: JSValue = .null
            let ms = B.time { r = WriteAPI.call("judge", store, args) }
            XCTAssertEqual(r["ok"], .bool(true), str(r))
            XCTAssertEqual(r["reused"], .bool(false), str(r))
            XCTAssertEqual(r["snapshot"]?["done"], .bool(false), str(r))
            cardKey = r["snapshot"]?["cardKey"] ?? .null
            if i >= warm { judges.append(ms) }
        }
        XCTAssertEqual(SessionWrites.allRecords(store.state).count, recordCount + warm + scale.writes)
        report("judge", name, scale, info, judges)

        var commits: [Double] = []
        let pool = B.chars(shape.studied)
        for i in 0..<(warm + scale.writes) {
            clock.t += 1000
            let ch = pool[B.queueSize + 100 + i]
            var r: JSValue = .null
            let ms = B.time { r = B.commitJudgeShape(store, ch: ch, i: i) }
            XCTAssertEqual(r["ok"], .bool(true), str(r))
            XCTAssertEqual(r["keys"]?.arrayValue?.count, 5, str(r)) // inkRecord + records.2026-10 + sched + meta + sessions
            if i >= warm { commits.append(ms) }
        }
        report("commit-judge", name, scale, info, commits)
        print("BENCH scale-note sink=\(sink)")
    }

    private func runFake(_ scale: Scale) throws {
        let state = try buildState(scale)
        let disk = FakeNativeDisk()
        try run("fake", scale, state) { disk.open() }
    }

    private func runFakeAndSQLite(_ scale: Scale) throws {
        let state = try buildState(scale)
        let disk = FakeNativeDisk()
        try run("fake", scale, state) { disk.open() }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("shizicore-scale-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("shizi.sqlite")
        try run("sqlite", scale, state) { SQLiteTransport.backend(fileURL: url) }
    }

    func testScale1x() throws { try runFakeAndSQLite(Self.scale1x()) }
    func testScale3x() throws { try runFakeAndSQLite(Self.scale3x()) }
    /// 10x 只跑 fake（内存替身）：sqlite 上 6 万条记录 + 5000 条墨迹的播种与每次提交的 fsync 在 Debug 里太慢。
    func testScale10x() throws { try runFake(Self.scale10x()) }
}
