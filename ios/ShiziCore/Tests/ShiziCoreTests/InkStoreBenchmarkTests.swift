import Foundation
import SQLite3
import XCTest
@testable import ShiziCore

// 墨迹搬出内存状态（单独的 SQLite 表、按需读）之前的量测：冷启动读库里，墨迹（state.ink[月][id]）占多少时间、多少字节、多少内存。
// 只打印，不断言耗时；只断言「造出来的数据确实是这个量、两份对照库除墨迹外逐字节相同」。
//
// 做法：同一份 heavyState（ScaleBenchmarkTests 的 1x / 3x / 10x 形状）播两份库——full（原样）与 noink（ink = {}，其余逐字节相同），
// 两种后端（fake = FakeNativeDisk 内存替身；sqlite = SQLiteTransport 真库，App 走的同一份表结构）。每份库上：
//   · store.load：新后端 + 新 Store 冷读（照 Store.load 全程）；open+load = 打开后端（sqlite 是 loadAll 读全部行进镜像）+ store.load。
//   · 分步（照 load 的顺序逐步调同样的内部函数，每遍都是新后端、新 Store）：disk.open、probe、repair、readState、stateToEntries、deriveSerial、usage
//     （refreshUsage = 每次提交后也要跑的占用估算），并把能按键拆开的拆成 .ink / .other 两份直接量：
//       repair.read.*（listKeys 之后逐键读原文）、repair.parse.*（JSON 解析）、repair.validate.*（Schema.validateValue），三项 ≈ repair 里逐键 parseAndValidate；
//       stateToEntries.* / deriveSerial.* / usage.*（Budget.estimateUsage）只喂 ink 域或只喂其余域；budget.inkBytes.ink（回收时整表 stringify 求墨迹字节）。
//     readState 拆不开：看 full 与 noink 之差（ink-store-delta 行）。
//   · bytes：两类键的个数、UTF-8 字节、预算口径（UTF-16 × 2，Budget.entryBytes）。
//   · memory（fake、full）：ink 域与其余域 JSValue 树的估算字节（见 estimateBytes：Swift 的 Array / Dictionary / 堆字符串布局，偏下限），
//     原文常驻（镜像 / lastRaw 共用同一份 String）的字节；另在 Darwin 上量一次「把全部 ink 原文再解析一遍并持有」的 phys_footprint 增量（粗）。
//   · ondemand（sqlite）：按需读的成本——直接 SELECT ink_records 的键 / 键 + 长度（启动时要的「有没有墨迹」索引与预算账）/ 全部 body / 最近一个月的 body，
//     以及经 SQLiteKVStore.value(for:) 一条一条取 + 解析（一条、最近一个月）。
// 每个 op：第一次就超过 1 s 时只量这一次（n=1）。3x / 10x 只在 SHIZI_SCALE_BENCH=1（CI 手动的 bench-release）时跑；1x 每次跑（守住量测本身能跑通）。
//
// 输出：
//   BENCH ink-store scale=<1x|3x|10x> backend=<fake|sqlite> variant=<full|noink> op=<op> part=<ink|other|all> n=… median=…ms max=…ms
//   BENCH ink-store-delta scale=… backend=… op=<op> full=…ms noink=…ms ink=…ms share=…%      （ink = full − noink：搬走墨迹最多能省的）
//   BENCH ink-store-bytes scale=… backend=… variant=… part=<ink|other> keys=… utf8=… budget=…
//   BENCH ink-store-memory scale=… part=<ink|other> entries=… treeEst=… rawHeap=… budget=… perEntryTree=… perEntryRaw=…
//   BENCH ink-store-ondemand scale=… backend=sqlite variant=… op=<op> rows=… bytes=… n=… median=…ms max=…ms
final class InkStoreBenchmarkTests: XCTestCase {
    typealias B = StoreCommitBenchmarkTests
    typealias S = ScaleBenchmarkTests

    struct Tier {
        let name: String
        let factor: Double
        let shape: B.Shape
        let samples: Int
    }

    static func tier1x() -> Tier { Tier(name: "1x", factor: 1, shape: B.shape1x, samples: 3) }
    static func tier3x() -> Tier { Tier(name: "3x", factor: 3, shape: S.shape3x(), samples: 3) }
    static func tier10x() -> Tier { Tier(name: "10x", factor: 10, shape: S.shape10x(), samples: 3) }

    static let slowMs = 1000.0

    struct BenchError: Error { let message: String }

    /// op → 样本（ms），按第一次出现的次序打印。
    final class Samples {
        var order: [String] = []
        var byOp: [String: [Double]] = [:]
        func add(_ op: String, _ ms: Double) {
            if byOp[op] == nil {
                order.append(op)
                byOp[op] = []
            }
            byOp[op]!.append(ms)
        }
        func median(_ op: String) -> Double? {
            guard let xs = byOp[op], !xs.isEmpty else { return nil }
            return B.median(xs.sorted())
        }
    }

    struct Part {
        var keys = 0
        var utf8 = 0
        var heap = 0
        var budget = 0.0
    }

    struct PassResult {
        let state: JSObject
        let inkRaw: [(key: String, raw: String)]
        let otherRaw: [(key: String, raw: String)]
    }

    private var sink = 0

    private static func ms(_ t0: UInt64) -> Double { Double(DispatchTime.now().uptimeNanoseconds - t0) / 1_000_000 }

    @discardableResult
    private func timed<T>(_ out: Samples, _ op: String, _ body: () throws -> T) rethrows -> T {
        let t0 = DispatchTime.now().uptimeNanoseconds
        let v = try body()
        out.add(op, Self.ms(t0))
        return v
    }

    private func requireScaleBench() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["SHIZI_SCALE_BENCH"] == "1", "3x / 10x ink-store benches run only with SHIZI_SCALE_BENCH=1 (CI bench-release job)")
    }

    func testInkStore1x() throws { try run(Self.tier1x()) }
    func testInkStore3x() throws { try requireScaleBench(); try run(Self.tier3x()) }
    func testInkStore10x() throws { try requireScaleBench(); try run(Self.tier10x()) }

    // MARK: 主流程

    private func run(_ tier: Tier) throws {
        JSMath.flavor = .v8
        let t0 = DispatchTime.now().uptimeNanoseconds
        let full = try B.heavyState(tier.shape)
        var noInk = full
        noInk["ink"] = .object(JSObject())
        print("BENCH ink-store-note scale=\(tier.name) generate=\(B.fmt(Self.ms(t0)))ms records=\(tier.shape.records) ink=\(tier.shape.inkRecords) chars=\(tier.shape.studied)")
        let budgets = S.budgets(tier.factor)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("shizicore-ink-store-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        for backend in ["fake", "sqlite"] {
            var byVariant: [String: Samples] = [:]
            var otherBytes: [String: Part] = [:]
            for variant in ["full", "noink"] {
                let state = variant == "full" ? full : noInk
                let url = dir.appendingPathComponent("\(backend)-\(variant).sqlite")
                let disk = FakeNativeDisk()
                let open: () -> KVBackend
                if backend == "fake" {
                    open = { disk.open() }
                } else {
                    open = { SQLiteTransport.backend(fileURL: url) }
                }
                // 播种（不计入）：seed 必须 ok，否则生成器有错，宁可失败也不打印假数字
                do {
                    let seeding = makeStore(open(), budgets)
                    XCTAssertEqual(seeding.load()["available"], .bool(true))
                    let t1 = DispatchTime.now().uptimeNanoseconds
                    let r = seeding.seed(.object(state), label: "ink-store-seed")
                    XCTAssertEqual(r["ok"], .bool(true), str(r))
                    guard ok(r) else { return }
                    print("BENCH ink-store-note scale=\(tier.name) backend=\(backend) variant=\(variant) seed=\(B.fmt(Self.ms(t1)))ms")
                }

                let out = Samples()
                let loaded = loads(out, n: tier.samples, open: open, budgets: budgets)
                guard let store = loaded else { return XCTFail("no store") }
                let inkCount = flatInk(store.state["ink"]).count
                XCTAssertEqual(inkCount, variant == "full" ? tier.shape.inkRecords : 0, "ink must survive seed + load")
                XCTAssertEqual(SessionWrites.allRecords(store.state).count, tier.shape.records, "records must survive seed + load")

                var last: PassResult? = nil
                for i in 0..<max(1, tier.samples) {
                    let t1 = DispatchTime.now().uptimeNanoseconds
                    last = try pass(out, open: open, budgets: budgets)
                    if i == 0 && Self.ms(t1) > Self.slowMs { break }
                }
                guard let p = last else { return XCTFail("no pass") }
                report(out, tier, backend, variant)
                byVariant[variant] = out

                let inkPart = Self.part(p.inkRaw), otherPart = Self.part(p.otherRaw)
                otherBytes[variant] = otherPart
                for (name, x) in [("ink", inkPart), ("other", otherPart)] {
                    print("BENCH ink-store-bytes scale=\(tier.name) backend=\(backend) variant=\(variant) part=\(name) keys=\(x.keys) utf8=\(x.utf8) budget=\(Int(x.budget))")
                }
                if backend == "fake" && variant == "full" { try memory(tier, p) }
                if backend == "sqlite" { try onDemand(tier, variant, url: url, inkState: full) }
            }
            // 公平对照：两份库除墨迹外逐字节相同
            XCTAssertEqual(otherBytes["full"]?.keys, otherBytes["noink"]?.keys)
            XCTAssertEqual(otherBytes["full"]?.utf8, otherBytes["noink"]?.utf8)
            if let f = byVariant["full"], let n = byVariant["noink"] { deltas(f, n, tier, backend) }
        }
        print("BENCH ink-store-note sink=\(sink)")
    }

    private func makeStore(_ backend: KVBackend, _ budgets: JSObject) -> Store {
        Store(storage: StoreStorage(backend, now: { B.benchNow }), now: { B.benchNow }, budgets: budgets, dates: shanghai)
    }

    /// 真的 Store.load（新后端 + 新 Store），量 n 次；第一次超过 1 s 只量一次。返回最后一次的 store。
    private func loads(_ out: Samples, n: Int, open: () -> KVBackend, budgets: JSObject) -> Store? {
        var kept: Store? = nil
        for i in 0..<max(1, n) {
            kept = nil
            let t0 = DispatchTime.now().uptimeNanoseconds
            let be = open()
            let openMs = Self.ms(t0)
            let store = makeStore(be, budgets)
            let t1 = DispatchTime.now().uptimeNanoseconds
            let r = store.load()
            let loadMs = Self.ms(t1)
            XCTAssertEqual(r["available"], .bool(true))
            out.add("store.load", loadMs)
            out.add("open+load", openMs + loadMs)
            kept = store
            if i == 0 && openMs + loadMs > Self.slowMs { break }
        }
        return kept
    }

    /// 一遍分步冷读：照 Store.load 的顺序（probe → repair → readState → stateToEntries → deriveSerial → refreshUsage）逐步调同样的内部函数，
    /// 再在同一份后端上把能按键拆开的几步拆成 .ink / .other 各量一次。ink 迁移在这份数据上（无旧月键）提前返回，不量。
    private func pass(_ out: Samples, open: () -> KVBackend, budgets: JSObject) throws -> PassResult {
        let be = timed(out, "disk.open") { open() }
        let store = makeStore(be, budgets)
        let storage = store.storage
        let probe = timed(out, "probe") { storage.probe() }
        XCTAssertTrue(probe.ok)
        let repairReport = try timed(out, "repair") { try storage.repair() }
        XCTAssertEqual(repairReport["quarantined"]?.arrayValue?.count, 0)
        let (next, raws, legacy) = timed(out, "readState") { store.readState() }
        sink &+= raws.keys.count
        let entries = timed(out, "stateToEntries") { store.stateToEntries(next, legacy: legacy) }
        sink &+= entries.keys.count
        sink &+= Int(timed(out, "deriveSerial") { Store.deriveSerial(next) })
        let usage = timed(out, "usage") { store.refreshUsage() }
        sink &+= usage?.count ?? 0

        // ---- 按键拆开 ----
        var inkOnly = JSObject()
        inkOnly["ink"] = next["ink"]
        var otherOnly = next
        otherOnly["ink"] = nil
        sink &+= timed(out, "stateToEntries.ink") { store.stateToEntries(inkOnly, legacy: legacy) }.keys.count
        sink &+= timed(out, "stateToEntries.other") { store.stateToEntries(otherOnly, legacy: legacy) }.keys.count
        sink &+= Int(timed(out, "deriveSerial.ink") { Store.deriveSerial(inkOnly) })
        sink &+= Int(timed(out, "deriveSerial.other") { Store.deriveSerial(otherOnly) })
        sink &+= Int(timed(out, "budget.inkBytes.ink") { Budget.inkBytes(next["ink"]) })

        let txnKey = Schema.keyNamed("txn")!, probeKey = Schema.keyNamed("probe")!
        let keys = try timed(out, "repair.listKeys") { try storage.listKeys(Schema.v2Prefix) }
        let candidates = keys.filter { k in !UTF16Order.eq(k, txnKey) && !UTF16Order.eq(k, probeKey) && Schema.specForKey(k) != nil }
        let inkKeys = candidates.filter { Schema.isInkStorageKey($0) }
        let otherKeys = candidates.filter { !Schema.isInkStorageKey($0) }
        let inkRaw = try timed(out, "repair.read.ink") { try Self.readRaws(storage, inkKeys) }
        let otherRaw = try timed(out, "repair.read.other") { try Self.readRaws(storage, otherKeys) }
        let inkValues = try timed(out, "repair.parse.ink") { try Self.parseAll(inkRaw) }
        let otherValues = try timed(out, "repair.parse.other") { try Self.parseAll(otherRaw) }
        let inkPassed = timed(out, "repair.validate.ink") { Self.validateAll(inkValues) }
        let otherPassed = timed(out, "repair.validate.other") { Self.validateAll(otherValues) }
        XCTAssertEqual(inkPassed, inkValues.count)
        XCTAssertEqual(otherPassed, otherValues.count)

        let all = try storage.readAll("").compactMap { k, v in v.map { (k, $0) } }
        let inkPairs = all.filter { Schema.isInkStorageKey($0.0) }
        let otherPairs = all.filter { !Schema.isInkStorageKey($0.0) }
        sink &+= timed(out, "usage.ink") { Budget.estimateUsage(inkPairs, store.budgets) }.count
        sink &+= timed(out, "usage.other") { Budget.estimateUsage(otherPairs, store.budgets) }.count
        return PassResult(state: next, inkRaw: inkRaw, otherRaw: otherRaw)
    }

    private static func readRaws(_ storage: StoreStorage, _ keys: [String]) throws -> [(key: String, raw: String)] {
        var out: [(key: String, raw: String)] = []
        out.reserveCapacity(keys.count)
        for k in keys {
            if let raw = try storage.read(k) { out.append((key: k, raw: raw)) }
        }
        return out
    }

    private static func parseAll(_ raws: [(key: String, raw: String)]) throws -> [(key: String, value: JSValue)] {
        var out: [(key: String, value: JSValue)] = []
        out.reserveCapacity(raws.count)
        for e in raws { out.append((key: e.key, value: try JSONParser.parse(e.raw))) }
        return out
    }

    private static func validateAll(_ values: [(key: String, value: JSValue)]) -> Int {
        var passed = 0
        for e in values where Schema.validateValue(key: e.key, value: e.value) == nil { passed += 1 }
        return passed
    }

    private static func part(_ raws: [(key: String, raw: String)]) -> Part {
        var p = Part()
        for e in raws {
            p.keys += 1
            p.utf8 += e.raw.utf8.count
            p.heap += heapString(e.raw)
            p.budget += Budget.entryBytes(e.key, e.raw)
        }
        return p
    }

    // MARK: 打印

    private static func partOf(_ op: String) -> String {
        if op.hasSuffix(".ink") { return "ink" }
        if op.hasSuffix(".other") { return "other" }
        return "all"
    }

    private func report(_ out: Samples, _ tier: Tier, _ backend: String, _ variant: String) {
        for op in out.order {
            let s = out.byOp[op]!.sorted()
            print("BENCH ink-store scale=\(tier.name) backend=\(backend) variant=\(variant) op=\(op) part=\(Self.partOf(op)) n=\(s.count) median=\(B.fmt(B.median(s)))ms max=\(B.fmt(s.last!))ms")
        }
    }

    private func deltas(_ full: Samples, _ noink: Samples, _ tier: Tier, _ backend: String) {
        for op in full.order where Self.partOf(op) == "all" {
            guard let f = full.median(op), let n = noink.median(op) else { continue }
            let share = f > 0 ? (f - n) / f * 100 : 0
            print("BENCH ink-store-delta scale=\(tier.name) backend=\(backend) op=\(op) full=\(B.fmt(f))ms noink=\(B.fmt(n))ms ink=\(B.fmt(f - n))ms share=\(String(format: "%.1f", share))%")
        }
    }

    // MARK: 内存估算

    /// 堆上的 Swift 原生字符串：≤ 15 个 UTF-8 字节内联（0）；否则对象头 32 + 内容（含结尾 0）按 16 取整。
    static func heapString(_ s: String) -> Int {
        let n = s.utf8.count
        return n <= 15 ? 0 : 32 + ((n + 1 + 15) / 16) * 16
    }

    /// Dictionary 的桶数：2 的幂、装载率 ≤ 3/4。
    static func dictBuckets(_ n: Int) -> Int {
        if n == 0 { return 0 }
        var b = 1
        while b * 3 < n * 4 { b <<= 1 }
        return b
    }

    /// 一个 JSValue 子树在堆上占的字节（估算，偏下限：数组按 count 不按 capacity，不计 malloc 取整）。值本身的槽位算在父容器里。
    /// 数组：头 32 + count × stride(JSValue)；对象（JSObject = [JSKey: JSValue] + insertion [String]）：字典头 80 + 桶 × (stride(JSKey) + stride(JSValue)) + 位图，
    /// 再加 insertion 数组头 32 + count × stride(String)；键串 JSKey 与 insertion 共用同一块字符串存储，只算一次。
    static func estimateBytes(_ v: JSValue) -> Int {
        let slot = MemoryLayout<JSValue>.stride
        switch v {
        case .null, .bool, .number:
            return 0
        case .string(let s):
            return heapString(s)
        case .array(let a):
            var n = 32 + a.count * slot
            for e in a { n += estimateBytes(e) }
            return n
        case .object(let o):
            let buckets = dictBuckets(o.count)
            var n = 80 + buckets * (MemoryLayout<JSKey>.stride + slot) + (buckets + 7) / 8
            n += 32 + o.count * MemoryLayout<String>.stride
            for (k, e) in o.entries { n += heapString(k) + estimateBytes(e) }
            return n
        }
    }

    /// 进程的 phys_footprint（Darwin）；拿不到返回 -1。
    static func physFootprint() -> Int {
        #if canImport(Darwin)
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let kr: kern_return_t = withUnsafeMutablePointer(to: &info) { p in
            p.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { q in
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), q, &count)
            }
        }
        return kr == KERN_SUCCESS ? Int(info.phys_footprint) : -1
        #else
        return -1
        #endif
    }

    private func memory(_ tier: Tier, _ p: PassResult) throws {
        let inkTree = Self.estimateBytes(p.state["ink"] ?? .null)
        var otherTree = 0
        for (d, v) in p.state.entries where d != "ink" { otherTree += Self.estimateBytes(v) }
        let inkPart = Self.part(p.inkRaw), otherPart = Self.part(p.otherRaw)
        print("BENCH ink-store-memory-note stride.JSValue=\(MemoryLayout<JSValue>.stride) stride.JSKey=\(MemoryLayout<JSKey>.stride) stride.String=\(MemoryLayout<String>.stride)"
            + " (resident per key today: the mirror's raw String, shared by lastRaw / repairParsed; plus the parsed JSValue tree in state, shared by validatedValues)")
        for (name, tree, x) in [("ink", inkTree, inkPart), ("other", otherTree, otherPart)] {
            let k = max(1, x.keys)
            print("BENCH ink-store-memory scale=\(tier.name) part=\(name) entries=\(x.keys) treeEst=\(tree) rawHeap=\(x.heap) utf8=\(x.utf8) budget=\(Int(x.budget))"
                + " perEntryTree=\(tree / k) perEntryRaw=\(x.heap / k) residentEst=\(tree + x.heap)")
        }
        // 粗量：把全部 ink 原文再解析一遍并持有，看 phys_footprint 涨多少（malloc 可能复用已释放的块，偏小）
        let before = Self.physFootprint()
        var held: [JSValue] = []
        held.reserveCapacity(p.inkRaw.count)
        for e in p.inkRaw { held.append(try JSONParser.parse(e.raw)) }
        let after = Self.physFootprint()
        sink &+= held.count
        let delta = before < 0 || after < 0 ? -1 : after - before
        var heldEst = 0
        for v in held { heldEst += Self.estimateBytes(v) }
        print("BENCH ink-store-memory scale=\(tier.name) part=ink op=reparse-held entries=\(held.count) footprintDelta=\(delta) treeEstSum=\(heldEst)")
        held.removeAll()
    }

    // MARK: 按需读（sqlite）

    /// 另开一条连接（不建库：没有 SQLITE_OPEN_CREATE）直接跑 SELECT（不经 SQLiteKVStore）：逐行取出 textColumn 那一列做成 String（与 SQLiteKVStore.text 同一做法）。
    final class RawDB {
        private var db: OpaquePointer?

        init(_ url: URL) throws {
            var handle: OpaquePointer?
            let rc = sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE, nil)
            guard rc == SQLITE_OK, let h = handle else {
                sqlite3_close_v2(handle)
                throw BenchError(message: "open failed rc=\(rc)")
            }
            db = h
        }

        deinit { sqlite3_close_v2(db) }

        func scan(_ sql: String, textColumn: Int32) throws -> (rows: Int, bytes: Int) {
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let s = stmt else { throw BenchError(message: "prepare failed: " + sql) }
            defer { sqlite3_finalize(s) }
            var rows = 0, bytes = 0
            while true {
                let rc = sqlite3_step(s)
                if rc == SQLITE_DONE { break }
                guard rc == SQLITE_ROW else { throw BenchError(message: "step failed rc=\(rc): " + sql) }
                rows += 1
                let n = Int(sqlite3_column_bytes(s, textColumn))
                if n > 0, let ptr = sqlite3_column_text(s, textColumn) {
                    let text = String(decoding: UnsafeBufferPointer(start: ptr, count: n), as: UTF8.self)
                    bytes += text.utf8.count
                }
            }
            return (rows, bytes)
        }
    }

    private func reportOnDemand(_ tier: Tier, _ variant: String, _ op: String, rows: Int, bytes: Int, _ samples: [Double]) {
        let s = samples.sorted()
        print("BENCH ink-store-ondemand scale=\(tier.name) backend=sqlite variant=\(variant) op=\(op) rows=\(rows) bytes=\(bytes) n=\(s.count) median=\(B.fmt(B.median(s)))ms max=\(B.fmt(s.last!))ms")
    }

    /// 预热 1 次后量 n 次；第一次就超过 1 s 只留这一次。
    private func sampled(_ n: Int, _ body: () throws -> Void) rethrows -> [Double] {
        let t0 = DispatchTime.now().uptimeNanoseconds
        try body()
        let first = Self.ms(t0)
        if first > Self.slowMs { return [first] }
        var out: [Double] = []
        for _ in 0..<max(1, n) {
            let t1 = DispatchTime.now().uptimeNanoseconds
            try body()
            out.append(Self.ms(t1))
        }
        return out
    }

    /// inkState：取最近一个有墨迹的月与它的键（noink 库里这些键都不在，只量 SELECT 的空扫）。
    private func onDemand(_ tier: Tier, _ variant: String, url: URL, inkState: JSObject) throws {
        let ink = inkState["ink"]?.objectValue ?? JSObject()
        let months = UTF16Order.sorted(ink.keys)
        let lastMonth = months.last ?? "2026-10"
        let monthIds = ink[lastMonth]?.objectValue?.keys ?? []

        let raw = try RawDB(url)
        let queries: [(op: String, sql: String, col: Int32)] = [
            ("sql.inkKeys", "SELECT month, id FROM ink_records", 1),
            ("sql.inkKeysAndLength", "SELECT month, id, length(body) FROM ink_records", 1),
            ("sql.inkBodies", "SELECT month, id, body FROM ink_records", 2),
            ("sql.inkMonthBodies", "SELECT id, body FROM ink_records WHERE month = '" + lastMonth + "'", 1),
            ("sql.recordsBodies", "SELECT month, body FROM records", 1),
        ]
        for q in queries {
            var last = (rows: 0, bytes: 0)
            let samples = try sampled(tier.samples) { last = try raw.scan(q.sql, textColumn: q.col) }
            reportOnDemand(tier, variant, q.op, rows: last.rows, bytes: last.bytes, samples)
        }

        let kv = SQLiteKVStore(fileURL: url)
        try kv.open()
        defer { kv.close() }
        var rows = 0, bytes = 0
        let loadAllMs = try sampled(tier.samples) {
            let all = try kv.loadAll()
            rows = all.count
            bytes = all.reduce(0) { $0 + $1.1.utf8.count }
        }
        reportOnDemand(tier, variant, "kv.loadAll", rows: rows, bytes: bytes, loadAllMs)

        if variant != "full" || monthIds.isEmpty { return }
        // 一条：最近一个月的前 50 条各取一次 + 解析（第一次取另算预热）
        let keys = monthIds.map { Schema.inkRecordKey(lastMonth, $0) }
        if let first = keys.first { _ = try kv.value(for: first) }
        var one: [Double] = []
        var oneBytes = 0
        for k in keys.prefix(50) {
            let t0 = DispatchTime.now().uptimeNanoseconds
            guard let text = try kv.value(for: k) else { throw BenchError(message: "missing " + k) }
            sink &+= try JSONParser.parse(text).objectValue?.count ?? 0
            one.append(Self.ms(t0))
            oneBytes = text.utf8.count
        }
        reportOnDemand(tier, variant, "kv.value+parse.one", rows: 1, bytes: oneBytes, one)
        // 最近一个月：逐键取 + 解析（月报 / 记录页一屏要的量级）
        var monthBytes = 0
        let month = try sampled(tier.samples) {
            monthBytes = 0
            for k in keys {
                guard let text = try kv.value(for: k) else { throw BenchError(message: "missing " + k) }
                monthBytes += text.utf8.count
                sink &+= try JSONParser.parse(text).objectValue?.count ?? 0
            }
        }
        reportOnDemand(tier, variant, "kv.value+parse.month", rows: keys.count, bytes: monthBytes, month)
    }
}
