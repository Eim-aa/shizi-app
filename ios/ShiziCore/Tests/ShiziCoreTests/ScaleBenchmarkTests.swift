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
// 3x-folded / 10x-folded：同样的历史，先放大预算播种，再用 App 的原生预算（recordsFoldAfterDays 400、records 16MB、墨迹 32MB）做一次真提交，
// 让 Budget.recover 像在设备上那样折叠旧月份、淘汰墨迹；再在折叠后的状态上量同样的操作。note 行打印剩下什么（未折叠月数 / 记录数、折叠月的 kept 数、墨迹数、bytes），
// 并给每档一行 backupBytes（Backup.buildBackupV2 + serializeBackup 的完整导出文件大小）。
//
// 输出（每行一个 (op, backend, scale)）：
//   BENCH scale op=<op> backend=<fake|sqlite> scale=<1x|3x|10x> records=… chars=… ink=… bytes=… n=… median=…ms max=…ms
//   op：disk.open（建后端 / 读入镜像）、store.load（冷：新 Store 读全库并校验）、usage（refreshUsage）、
//       flatten（Query.flattenRecords）、practiceStats、planDaily、home（HomeView.homeView，无开着的会话，走最重的分支）、
//       strokes（WriteAPI strokes 提交）、judge（WriteAPI judge 提交）、commit-judge（与判断同形的 store.commit）。
//       api.view.*（只在 fake 上）：各页的 App 回答，PageAPI.call 同一入口——home（A 槽有开着的会话）、mine、month（当月 / .old = 最早的月，折叠档里是折叠月）、
//       records（当月 + 选中 10-20）、detail（最近写的字）、query.han10（10 个汉字）/ query.pinyin（"shi"）、annual（缺省年 / .2025）、library、backup、remind。
//       part.*：页内反复用到的块——recordIndex（我的 / 记录 / 年报）、flattenSorted（ImageSelection 的全量排序平铺）、monthMembers（月报 / 我的 / 年报每月）、
//       annualYears（我的、年报：每年各建一次 recordIndex）、memoryZones（我的 / 字库）、recordsSignature（我的的备份提示）、reminderPayload（提醒开着时每次提交后的同步）、
//       yearSlice / annualModel（年报的切片与模型，不含每格墨迹）、monthCells（月报 / 记录 / 年报每月的格，含每格墨迹）、monthSheetCells（我的页的月报格）、
//       builtInk.month（当月每个成员各解一次回放墨迹；scale-note 行给每格单价）。
//   api.* 与较重的 part.*：第一次就超过 1 s 时只量这一次（n=1），免得 10x 的手动量测步骤超出作业时限。
//   bytes = Store.usage 的 total（UTF-16 口径，与预算同口径）。
//   另有 testFoldPolicyBytes 打印 BENCH fold-policy 行（每条记录 / 墨迹 / sched 的字节、折叠一个月前后、按每天写多少字推到碰预算的天数），见该方法的注释。
// 读法：同一 op 的 1x → 3x → 10x，records 依次约 ×3、×3.3；median 也约 ×3、×3.3 即线性（O(总记录数)）；基本不变即与总量无关
// （O(1) 或 O(一个月)）；涨得比数据量还快（10x 比 3x 的倍数明显大于 3.3）才是超线性。max 看偶发长尾。跨机器只看量级与倍数。
final class ScaleBenchmarkTests: XCTestCase {
    typealias B = StoreCommitBenchmarkTests

    struct Scale {
        let name: String
        /// 播种用的预算倍数（1 = App 原生预算）；factor 是量测时 Store 用的预算倍数。两者不同 = 先按 seedFactor 播种，再用 factor 的预算让真实的回收折叠一遍（见 folded）。
        let seedFactor: Double
        let factor: Double
        let shape: B.Shape
        /// 写操作（strokes / judge / commit-judge）与读操作（home 等）的样本数；store.load 的次数。
        let writes: Int
        let reads: Int
        let loads: Int
        var folded: Bool { seedFactor != factor }
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

    static func scale1x() -> Scale { Scale(name: "1x", seedFactor: 1, factor: 1, shape: B.shape1x, writes: 15, reads: 9, loads: 5) }
    static func scale3x() -> Scale {
        Scale(name: "3x", seedFactor: 3, factor: 3, shape: shape3x(), writes: 9, reads: 5, loads: 3)
    }
    static func shape3x() -> B.Shape { B.Shape(months: monthsEndingOct2026(20), recordsPerMonth: 900, studied: studied(4500), inkRecords: 1500) }
    static func shape10x() -> B.Shape { B.Shape(months: monthsEndingOct2026(40), recordsPerMonth: 1500, studied: studied(7000), inkRecords: 5000) }
    /// 真实预算版：同样的历史，播种时放大预算（不折叠），再用 App 的原生预算让回收折叠（400 天前的月份、超预算的记录 / 墨迹）。
    static func scale3xFolded() -> Scale { Scale(name: "3x-folded", seedFactor: 3, factor: 1, shape: shape3x(), writes: 9, reads: 5, loads: 3) }
    static func scale10xFolded() -> Scale { Scale(name: "10x-folded", seedFactor: 10, factor: 1, shape: shape10x(), writes: 5, reads: 3, loads: 3) }
    static func scale10x() -> Scale {
        Scale(name: "10x", seedFactor: 10, factor: 10, shape: shape10x(), writes: 5, reads: 3, loads: 3)
    }

    /// 1x = App 的原生预算；更大的档把各项预算按倍数放大并取消折叠（见文件头）。
    static func budgets(_ factor: Double) -> JSObject {
        var b = Budgets.native
        if factor > 1 {
            b.quotaBytes *= factor
            b.totalTargetBytes *= factor
            b.recordsBudgetBytes *= factor
            b.inkBudgetBytes *= factor
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

    private func makeStore(_ backend: KVBackend, _ clock: B.Clock, _ factor: Double) -> Store {
        let storage = StoreStorage(backend, now: { clock.t })
        return Store(storage: storage, now: { clock.t }, budgets: Self.budgets(factor), dates: shanghai)
    }

    private func run(_ name: String, _ scale: Scale, _ state: JSObject, _ backend: () -> KVBackend) throws {
        JSMath.flavor = .v8
        let clock = B.Clock(B.benchNow)
        let shape = scale.shape

        // 播种（计时只作说明）：seed 必须 ok，否则生成器有错，宁可在这里失败也不打印假数字
        do {
            let seeding = makeStore(backend(), clock, scale.seedFactor)
            XCTAssertEqual(seeding.load()["available"], .bool(true))
            var r: JSValue = .null
            let ms = timed { r = seeding.seed(.object(state), label: "scale-seed") }
            XCTAssertEqual(r["ok"], .bool(true), str(r))
            print("BENCH scale-note scale=\(scale.name) backend=\(name) seed=\(B.fmt(ms))ms")
            guard ok(r) else { return }
        }

        // 真实预算版：用 App 的原生预算开一个 Store，做一次真提交——persist 里 needsRecovery 命中（400 天前的月份）就跑 Budget.recover（foldMonth / 墨迹淘汰），与 App 在设备上相同
        if scale.folded {
            let folding = makeStore(backend(), clock, scale.factor)
            XCTAssertEqual(folding.load()["available"], .bool(true))
            var r: JSValue = .null
            clock.t += 1000
            let ms = timed {
                r = folding.commit("bench:fold-trigger") { d, c in
                    var sessions = d["sessions"]!.objectValue!
                    var A = sessions["A"]!.objectValue!
                    A["updatedAt"] = .number(c.now)
                    sessions["A"] = .object(A)
                    d["sessions"] = .object(sessions)
                }
            }
            XCTAssertEqual(r["ok"], .bool(true), str(r))
            let actions = r["recovered"]?.arrayValue ?? []
            func count(_ type: String) -> Int { actions.filter { $0["type"] == .string(type) }.count }
            XCTAssertGreaterThan(count("fold"), 0, "real budgets must fold the aged months")
            print("BENCH scale-note scale=\(scale.name) foldTime=\(B.fmt(ms))ms actions=\(actions.count) fold=\(count("fold")) dropFoldedInk=\(count("dropFoldedInk")) evictInk=\(count("evictInk"))")
        }

        // store.load：每次都是新 Store 从库里冷读（后端也重新打开）；最后一次的 store 留给后面的操作
        var openSamples: [Double] = [], loadSamples: [Double] = []
        var kept: Store? = nil
        for _ in 0..<scale.loads {
            kept = nil
            var be: KVBackend? = nil
            openSamples.append(timed { be = backend() })
            let fresh = makeStore(be!, clock, scale.factor)
            var loaded = JSObject()
            loadSamples.append(timed { loaded = fresh.load() })
            XCTAssertEqual(loaded["available"], .bool(true))
            kept = fresh
        }
        guard let store = kept else { return XCTFail("no store") }

        let schedCount = store.state["sched"]?.objectValue?.count ?? 0
        let recordCount = SessionWrites.allRecords(store.state).count
        let inkCount = flatInk(store.state["ink"]).count
        XCTAssertEqual(schedCount, shape.studied, "sched must survive seed + load")
        XCTAssertEqual(store.state["records"]?.objectValue?.count, shape.months.count)
        if scale.folded {
            XCTAssertLessThan(recordCount, shape.records, "folding must have dropped records")
            XCTAssertLessThanOrEqual(inkCount, shape.inkRecords)
        } else {
            XCTAssertEqual(recordCount, shape.records, "records must survive seed + load (no budget recovery / folding)")
            XCTAssertEqual(inkCount, shape.inkRecords, "ink must survive seed + load (no budget recovery)")
        }
        var unfoldedMonths = 0, unfoldedRecords = 0, foldedMonths = 0, keptRecords = 0
        for (_, value) in store.state["records"]?.objectValue?.entries ?? [] {
            if let list = value.arrayValue {
                unfoldedMonths += 1
                unfoldedRecords += list.count
            } else if value["folded"] == .bool(true) {
                foldedMonths += 1
                keptRecords += value["kept"]?.arrayValue?.count ?? 0
            }
        }
        XCTAssertEqual(unfoldedRecords + keptRecords, recordCount)
        if scale.folded {
            XCTAssertGreaterThan(unfoldedMonths, 0)
            XCTAssertGreaterThan(foldedMonths, 0)
        }
        print("BENCH scale-note scale=\(scale.name) backend=\(name) unfoldedMonths=\(unfoldedMonths) unfoldedRecords=\(unfoldedRecords) foldedMonths=\(foldedMonths) keptRecords=\(keptRecords) ink=\(inkCount) chars=\(schedCount) bytes=\(Int(store.usage?["total"]?.numberValue ?? 0))")
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
        XCTAssertEqual(recs.count, recordCount) // 折叠过的月只剩 kept，少于 shape.records（上面已断言过折叠确实丢了记录）

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

        // 备份：App 导出的完整文件（Backup.buildBackupV2 + serializeBackup，即 JSON.stringify(obj, null, 1)）的大小与耗时；只在 fake 上量一次
        if name == "fake" {
            var text = ""
            let ms = try timed { text = Backup.serializeBackup(.object(try Backup.buildBackupV2(store.state, now: B.benchNow, serial: store.serial))) }
            print("BENCH scale-note scale=\(scale.name) backend=\(name) backupBytes=\(text.utf8.count) usageBytes=\(info.bytes)")
            report("backup.export", name, scale, info, [ms])
        }

        // 各页的 App 回答（PageAPI.call，与 App 同一入口）与它们共用的几块；只读，只在 fake 上量（与后端无关）
        if name == "fake" {
            let detailChar = recs.last?["char"]?.stringValue ?? "一"
            try screens(name, scale, info, store, today: today, detailChar: detailChar)
        }

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
            // inkRecord + records.2026-10 + sched + meta + sessions（折叠版里回收可能再动别的键，只断言 ok）
            if !scale.folded { XCTAssertEqual(r["keys"]?.arrayValue?.count, 5, str(r)) }
            if i >= warm { commits.append(ms) }
        }
        report("commit-judge", name, scale, info, commits)
        print("BENCH scale-note sink=\(sink)")
    }

    /// 量 n 次（不预热）；第一次就超过 slowMs 时只留这一次（n=1）：10x 上单次几秒到几十秒的页，多量几次只是让 CI 的手动量测步骤超时。
    static let slowMs = 1000.0
    private func sampleUnlessSlow(n: Int, _ body: () throws -> Void) rethrows -> [Double] {
        var out: [Double] = []
        for _ in 0..<max(1, n) {
            out.append(try timed(body))
            if out.count == 1 && out[0] > Self.slowMs { break }
        }
        return out
    }

    /// 一个页的 App 回答：PageAPI.call(op) 量 scale.reads 次（不预热：页面打开本来就是冷的一次；看 median；第一次超过 1 s 只量一次），最后一次的回包必须 ok。
    private func api(_ label: String, _ op: String, _ args: JSObject, _ store: Store, _ name: String, _ scale: Scale, _ info: Info) -> JSValue {
        var last: JSValue = .null
        let samples = sampleUnlessSlow(n: scale.reads) { last = PageAPI.call(op, store: store, args: args) }
        XCTAssertEqual(last["ok"], .bool(true), label + ": " + String(str(last).prefix(300)))
        report(label, name, scale, info, samples)
        return last
    }

    /// 各页的模型构建（App 回答）+ 页内反复用到的几块（part.*，便于把页面的耗时拆到具体的全量遍历上）。
    /// 状态就是 store 里的（A 槽有开着的会话，所以 api.view.home 走「有进度」分支；无会话的最重分支见上面的 home）。
    private func screens(_ name: String, _ scale: Scale, _ info: Info, _ store: Store, today: String, detailChar: String) throws {
        let month = String(today.prefix(7)), oldMonth = scale.shape.months[0]
        let pool = B.chars(scale.shape.studied)
        let han10 = pool.prefix(10).joined()

        _ = api("api.view.home", "view.home", JSObject(), store, name, scale, info)
        _ = api("api.view.mine", "view.mine", JSObject([("width", .number(402))]), store, name, scale, info)
        _ = api("api.view.month", "view.month", JSObject([("month", .string(month))]), store, name, scale, info)
        _ = api("api.view.month.old", "view.month", JSObject([("month", .string(oldMonth))]), store, name, scale, info)
        _ = api("api.view.records", "view.records", JSObject([("month", .string(month)), ("day", .string("2026-10-20"))]), store, name, scale, info)
        _ = api("api.view.detail", "view.detail", JSObject([("char", .string(detailChar))]), store, name, scale, info)
        let q10 = api("api.view.query.han10", "view.query", JSObject([("mode", .string("lookup")), ("text", .string(han10))]), store, name, scale, info)
        let qpy = api("api.view.query.pinyin", "view.query", JSObject([("mode", .string("lookup")), ("text", .string("shi"))]), store, name, scale, info)
        print("BENCH scale-note scale=\(scale.name) backend=\(name) queryRows.han10=\(q10["view"]?["rows"]?.arrayValue?.count ?? -1) queryRows.pinyin=\(qpy["view"]?["rows"]?.arrayValue?.count ?? -1)")
        let annual = api("api.view.annual", "view.annual", JSObject(), store, name, scale, info)
        _ = api("api.view.annual.2025", "view.annual", JSObject([("year", .number(2025))]), store, name, scale, info)
        print("BENCH scale-note scale=\(scale.name) backend=\(name) annualYears=\(annual["view"]?["years"]?.arrayValue?.count ?? -1) annualMonths=\(annual["view"]?["months"]?.arrayValue?.count ?? -1)")
        _ = api("api.view.library", "view.library", JSObject(), store, name, scale, info)
        _ = api("api.view.backup", "view.backup", JSObject(), store, name, scale, info)
        _ = api("api.view.remind", "view.remind", JSObject(), store, name, scale, info)

        // ---- 页内共用的几块（同一状态）----
        let stv = JSValue.object(store.state), dates = store.dates
        report("part.recordIndex", name, scale, info, sample(warm: 0, n: scale.reads) {
            sink &+= ViewSupport.recordIndex(stv, dates: dates).judged.count
        })
        report("part.flattenSorted", name, scale, info, sample(warm: 0, n: scale.reads) {
            sink &+= ImageSelection.flattenRecords(stv["records"]).count
        })
        report("part.monthMembers", name, scale, info, try sample(warm: 0, n: scale.reads) {
            sink &+= try ImageSelection.monthMembers(stv, month: month, dates: dates)["members"]?.arrayValue?.count ?? 0
        })
        report("part.annualYears", name, scale, info, sampleUnlessSlow(n: scale.reads) {
            sink &+= AnnualView.annualYears(stv, dates: dates).count
        })
        // 年报 / 月报 / 我的拆开：缺省年的切片与模型（不含每格墨迹）、当月的月报格（MineSubView.monthCells：成员 + 每格墨迹）、
        // 我的页的月报格（MinePageView.monthSheetCells：只要有没有墨迹）、当月每个成员各解一次回放墨迹（DetailView.builtInk，看每格的单价）
        let year = Int(today.prefix(4))!
        report("part.yearSlice", name, scale, info, sampleUnlessSlow(n: scale.reads) {
            sink &+= AnnualView.yearSlice(stv, year: year, dates: dates).chars.count
        })
        report("part.annualModel", name, scale, info, try sampleUnlessSlow(n: scale.reads) {
            sink &+= try AnnualView.annualModel(stv, today: today, year: .number(Double(year)), dates: dates)["months"]?.arrayValue?.count ?? 0
        })
        report("part.monthCells", name, scale, info, try sampleUnlessSlow(n: scale.reads) {
            sink &+= try MineSubView.monthCells(stv, month: month, policy: Config.policy, dates: dates)["cells"]?.arrayValue?.count ?? 0
        })
        report("part.monthSheetCells", name, scale, info, try sampleUnlessSlow(n: scale.reads) {
            sink &+= try MinePageView.monthSheetCells(stv, month: month, policy: Config.policy, dates: dates)["n"]?.numberValue.map { Int($0) } ?? 0
        })
        let memberRecords: [JSValue] = (try ImageSelection.monthMembers(stv, month: month, dates: dates)["members"]?.arrayValue ?? []).compactMap { (m: JSValue) -> JSValue? in
            guard let r = m["record"], !r.isNull else { return nil }
            return r
        }
        let inkMs = try sampleUnlessSlow(n: scale.reads) {
            for r in memberRecords { if try DetailView.builtInk(stv, record: r, dates: dates) != nil { sink &+= 1 } }
        }
        report("part.builtInk.month", name, scale, info, inkMs)
        print("BENCH scale-note scale=\(scale.name) backend=\(name) builtInk.month cells=\(memberRecords.count) perCell=\(B.fmt(B.median(inkMs.sorted()) / Double(max(1, memberRecords.count))))ms")
        report("part.memoryZones", name, scale, info, try sample(warm: 0, n: scale.reads) {
            sink &+= Int(try ViewSupport.memoryZones(stv, today: today, dates: dates)["recorded"]?.numberValue ?? 0)
        })
        report("part.recordsSignature", name, scale, info, sample(warm: 0, n: scale.reads) {
            sink &+= Backup.recordsSignature(stv["records"]).count
        })
        // 提醒同步（ReminderController.sync：每次 load / commit / recover 后 300ms 防抖一次）在提醒开着时的计算
        let remind = JSValue.object(JSObject([("enabled", .bool(true)), ("hour", .number(20)), ("minute", .number(0))]))
        report("part.reminderPayload", name, scale, info, try sample(warm: 0, n: scale.reads) {
            sink &+= try Reminder.reminderPayload(stv, remind: remind, today: .string(today), now: .number(B.benchNow), dates: dates)["questions"]?.arrayValue?.count ?? 0
        })
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

    /// 3x / 10x 只在 CI 手动的 Release 量测步骤里跑（它设 SHIZI_SCALE_BENCH=1）：verify:core 是 Debug、不带过滤，
    /// 每次都跑 6 万条记录的播种与逐次 fsync 会白白多出好几分钟。1x 照常每次跑（守住量测本身能跑通）。
    private func requireScaleBench() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["SHIZI_SCALE_BENCH"] == "1", "3x / 10x scale benches run only with SHIZI_SCALE_BENCH=1 (CI release-bench step)")
    }

    // MARK: 折叠策略的数据：重度用户每年多少字节、何时碰到原生预算（只量不改）

    /// 一个字的笔画（345 网格）：每笔从不同处起笔，每个采样走 step 个单位、方向缓慢转弯；dtMs 一个点；pen = 带压力（Apple Pencil）。
    static func syntheticStrokes(strokes: Int, points: Int, step: Double, dtMs: Double, pen: Bool) -> [[InkPoint]] {
        (0..<strokes).map { (i: Int) -> [InkPoint] in
            var x = 60.0 + Double((i * 37) % 200), y = 50.0 + Double((i * 53) % 220)
            let theta0 = Double(i) * 1.3
            var out: [InkPoint] = []
            for j in 0..<points {
                let theta = theta0 + Double(j) * 0.04
                x = min(335.0, max(10.0, x + step * cos(theta)))
                y = min(335.0, max(10.0, y + step * sin(theta)))
                let p: Double? = pen ? 0.35 + 0.3 * sin(Double(j) * 0.2) : nil
                out.append(InkPoint(x: x, y: y, t: Double(1000 * i) + dtMs * Double(j), p: p, order: InkPoint.orderXYTP))
            }
            return out
        }
    }

    /// 一条墨迹在预算里的字节（UTF-16 口径，与 Budget.inkEntryBytes 同：键 shizi.v2.ink.<月>.<id> + JSON 值）。
    static func inkEntryBytes(_ strokes: [[InkPoint]]) throws -> Double {
        let ink = try InkMath.encodeStoredInk(strokes, policy: Config.policy.objectValue, format: "raw")
        return Budget.entryBytes(Schema.inkRecordKey("2026-10", "r123456"), JSONWriter.stringify(ink))
    }

    static func utf16Bytes(_ v: JSValue) -> Double { Double(JSONWriter.stringify(v).utf16.count) * 2 }

    /// 输出：
    ///   BENCH fold-policy record bytesPerRecord=… （生成器的判断记录，按月数组存，含逗号；与 makeRecord 同键序、无 inkId / source）
    ///   BENCH fold-policy sched bytesPerChar=…
    ///   BENCH fold-policy ink variant=<名> strokes=… points=… step=… pen=… bytes=…（单条墨迹）
    ///   BENCH fold-policy folded month=… records=… kept=… bytesBefore=… bytesAfter=…
    ///   BENCH fold-policy project perDay=… ink=<名> recordsPerYear=… inkPerYear=… daysToRecordsBudget=… daysToInkBudget=… daysToQuota=… foldWindowRecords=…
    ///   BENCH fold-policy protectedInk chars=… bytes=… overInkBudget=…（每字第一次与最近一次的墨迹不淘汰：Budget.inkTier = ∞）
    func testFoldPolicyBytes() throws {
        JSMath.flavor = .v8
        let b = Budgets.native
        let MiB = 1024.0 * 1024.0
        print("BENCH fold-policy budgets records=\(Int(b.recordsBudgetBytes)) ink=\(Int(b.inkBudgetBytes)) totalTarget=\(Int(b.totalTargetBytes)) quota=\(Int(b.quotaBytes)) foldAfterDays=\(Int(b.recordsFoldAfterDays))")

        // 记录与 sched：14 个月 × 1200 条（约 43 条 / 天）、3000 个字、100 条墨迹（墨迹另量）
        let months = Self.monthsEndingOct2026(14)
        let shape = B.Shape(months: months, recordsPerMonth: 1200, studied: Self.studied(3000), inkRecords: 100)
        let state = try B.heavyState(shape)
        let records = state["records"]!.objectValue!
        let recordCount = Query.flattenRecords(JSValue.object(records)).count
        XCTAssertEqual(recordCount, shape.records)
        let recBytes = Budget.recordsBytes(records) / Double(recordCount)
        XCTAssertGreaterThan(recBytes, 100)
        let schedCount = state["sched"]!.objectValue!.count
        let schedBytes = Self.utf16Bytes(state["sched"]!) / Double(schedCount)
        let genInk = Budget.inkBytes(state["ink"]) / Double(shape.inkRecords)
        print("BENCH fold-policy record bytesPerRecord=\(B.fmt(recBytes)) records=\(recordCount)")
        print("BENCH fold-policy sched bytesPerChar=\(B.fmt(schedBytes)) chars=\(schedCount)")
        print("BENCH fold-policy ink variant=generator bytes=\(B.fmt(genInk)) (B.rawStrokes: 4–13 笔 × 40 点、x 每点 +6)")

        // 折叠一个月：最老的月（字几乎都是第一次写 → 留得多）与中间的月（字已写过 → 只留每字最近一次之类）
        let index = Budget.indexRecords(records)
        for m in [months[0], months[6]] {
            let listV = records[m]!, list = listV.arrayValue!
            let before = Budget.entryBytes(Schema.recordsKey(m), JSONWriter.stringify(listV))
            let folded = Budget.foldMonth(m, list, index.retained)
            let after = Budget.entryBytes(Schema.recordsKey(m), JSONWriter.stringify(.object(folded)))
            print("BENCH fold-policy folded month=\(m) records=\(list.count) kept=\(folded["kept"]?.arrayValue?.count ?? -1) bytesBefore=\(Int(before)) bytesAfter=\(Int(after))")
        }

        // 墨迹：几种写法（120Hz 手指 dt 8ms；Pencil 240Hz dt 4ms 带压力）
        let variants: [(String, Int, Int, Double, Double, Bool)] = [
            ("finger-light", 6, 30, 4, 8, false),
            ("finger-typical", 10, 40, 4, 8, false),
            ("finger-fast", 10, 40, 9, 8, false),
            ("finger-complex", 14, 50, 4, 8, false),
            ("pencil-typical", 10, 80, 2, 4, true),
        ]
        var inkBy: [String: Double] = [:]
        for (label, strokes, points, step, dt, pen) in variants {
            let bytes = try Self.inkEntryBytes(Self.syntheticStrokes(strokes: strokes, points: points, step: step, dtMs: dt, pen: pen))
            XCTAssertGreaterThan(bytes, 0)
            inkBy[label] = bytes
            print("BENCH fold-policy ink variant=\(label) strokes=\(strokes) points=\(points) step=\(step) pen=\(pen) bytes=\(Int(bytes))")
        }

        // 不折叠、不淘汰时的增长与碰到预算的天数；foldWindowRecords = 400 天折叠线以内（约 430 天：再加上当月）的记录字节
        for perDay in [30.0, 60.0, 120.0] {
            for label in ["finger-typical", "pencil-typical"] {
                let ink = inkBy[label]!
                let recDay = perDay * recBytes, inkDay = perDay * ink
                print("BENCH fold-policy project perDay=\(Int(perDay)) ink=\(label) recordsPerYear=\(B.fmt(recDay * 365 / MiB))MiB inkPerYear=\(B.fmt(inkDay * 365 / MiB))MiB daysToRecordsBudget=\(Int(b.recordsBudgetBytes / recDay)) daysToInkBudget=\(Int(b.inkBudgetBytes / inkDay)) daysToQuota=\(Int(b.quotaBytes / (recDay + inkDay))) foldWindowRecords=\(B.fmt(recDay * 430 / MiB))MiB")
            }
        }

        // 不淘汰的墨迹下限：每字第一次与最近一次（写过两次以上的字两条）
        for chars in [2000, 3500, 5000, 7000] {
            let ink = inkBy["finger-typical"]!, bytes = 2 * Double(chars) * ink
            print("BENCH fold-policy protectedInk chars=\(chars) ink=finger-typical bytes=\(B.fmt(bytes / MiB))MiB overInkBudget=\(bytes > b.inkBudgetBytes) schedBytes=\(B.fmt(Double(chars) * schedBytes / MiB))MiB")
        }
        print("BENCH fold-policy protectedInk charsAtInkBudget=\(Int(b.inkBudgetBytes / (2 * inkBy["finger-typical"]!))) (finger-typical) \(Int(b.inkBudgetBytes / (2 * inkBy["pencil-typical"]!))) (pencil-typical)")
    }

    func testScale1x() throws { try runFakeAndSQLite(Self.scale1x()) }
    func testScale3x() throws { try requireScaleBench(); try runFakeAndSQLite(Self.scale3x()) }
    /// 10x 只跑 fake（内存替身）：sqlite 上 6 万条记录 + 5000 条墨迹的播种与每次提交的 fsync 太慢。
    func testScale10x() throws { try requireScaleBench(); try runFake(Self.scale10x()) }
    /// 真实预算版只跑 fake。
    func testScale3xFolded() throws { try requireScaleBench(); try runFake(Self.scale3xFolded()) }
    func testScale10xFolded() throws { try requireScaleBench(); try runFake(Self.scale10xFolded()) }
}
