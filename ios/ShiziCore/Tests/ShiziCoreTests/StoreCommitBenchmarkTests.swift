import Foundation
import XCTest
@testable import ShiziCore

// 写字页提交路径的基准（只打印耗时，不断言耗时——CI 机器快慢不一；只断言功能正确）。
//
// 场景：重度用户（约 2000 个学过的字的 sched、8 个月的判断记录、几百条单条墨迹），写字页里：
//   strokes      每次抬笔：WriteAPI "strokes"（= SessionWrites.commitStrokes → store.commit "write:strokes"），笔画数 1…12 轮换，每次都真的提交；
//   judge        每次判断：WriteAPI "judge"（commitJudgment → store.commit "write:judge"，含记录 / 墨迹 / FSRS / 会话推进 / 回包快照）；
//   commit-judge 只量 store：一次与判断同形的 store.commit（追加一条本月记录 + 改一条 sched + 写一条墨迹 + 改会话），不经会话规则；
//   usage        store.refreshUsage() 单独（storage.estimateUsage → readAll("")）。
// 两种后端各跑一遍：fake = FakeNativeDisk（原生 SQLite 的内存替身，经 NativeMirrorBackend，与 App 同一条 Swift 路径，不含磁盘 I/O）；
// sqlite = 真的 SQLiteKVStore（临时目录里的库文件，WAL + synchronous=FULL，与 App 相同，含 fsync）。
// 状态先 seed 进库，再新开一个 Store 从库里 load（与 App 启动后的内存形态相同：每个值都是从落盘字串解析出来的）。
//
// 输出（每行一个量）：
//   BENCH store backend=<fake|sqlite> state keys=… bytes=… sched=… records=… ink=…
//   BENCH store backend=<…> op=<strokes|judge|commit-judge|usage> n=… median=…ms p95=…ms min=…ms max=…ms
// 读法：看 median（典型一次）与 p95（偶发长尾）；同一台 CI 机器上前后两次提交的数字可比，跨机器只看量级。

final class StoreCommitBenchmarkTests: XCTestCase {
    /// 2026-10-21 09:00（上海）。
    static let benchNow = 1792544400000.0
    static let months = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]
    static let studied = 2000
    static let recordsPerMonth = 750
    static let inkRecords = 500
    static let queueSize = 60

    final class Clock {
        var t: Double
        init(_ t: Double) { self.t = t }
    }

    static func pad2(_ n: Int) -> String { n < 10 ? "0" + String(n) : String(n) }

    /// 题库里前 n 个可练的单字（不够时用 U+4E00 起的字补足）。
    static func chars(_ n: Int) -> [String] {
        var out: [String] = []
        var seen = Set<String>()
        for card in DeckData.shared.seed {
            guard let ch = card["target"]?.stringValue, ch.unicodeScalars.count == 1, !seen.contains(ch), DeckCards.shared.isPracticable("base:" + ch) else { continue }
            seen.insert(ch)
            out.append(ch)
            if out.count == n { return out }
        }
        var u: UInt32 = 0x4E00
        while out.count < n {
            let ch = String(Character(Unicode.Scalar(u)!))
            u += 1
            if seen.insert(ch).inserted { out.append(ch) }
        }
        return out
    }

    /// 一个字的原始笔画（345 单位网格，120Hz 左右）。
    static func rawStrokes(_ count: Int, seed: Int) -> [[InkPoint]] {
        (0..<count).map { i in
            (0..<40).map { j in
                InkPoint(x: Double(40 + 6 * j + (seed % 7)), y: Double(60 + 22 * i + (j * (seed % 5)) % 9), t: Double(1000 * i + 8 * j), order: InkPoint.orderXYTP)
            }
        }
    }

    /// 写字页线上格式的笔画：[[[x, y, t], …], …]。
    static func wireStrokes(_ count: Int, seed: Int) -> JSValue {
        .array(rawStrokes(count, seed: seed).map { s in .array(s.map { p in .array([.number(p.x), .number(p.y), .number(p.t!)]) }) })
    }

    /// 重度用户的 v2 状态。
    static func heavyState() throws -> JSObject {
        let pool = chars(studied)
        let help = JSValue.object(JSObject([("hints", .number(0)), ("answerSeen", .bool(false)), ("traced", .bool(false))]))
        var serial = 0
        var records = JSObject()
        var flat: [JSValue] = []
        for (mi, month) in months.enumerated() {
            let days = month == "2026-10" ? 20 : 28
            var list: [JSValue] = []
            for i in 0..<recordsPerMonth {
                serial += 1
                let day = month + "-" + pad2(1 + i * days / recordsPerMonth)
                let ch = pool[(mi * recordsPerMonth + i) % pool.count]
                let rec = JSValue.object(JSObject([
                    ("id", .string("r\(serial)")), ("cardKey", .string("base:" + ch)), ("char", .string(ch)), ("sessionId", .string("s\(1 + serial / 30)")),
                    ("kind", .string("judged")), ("at", .number(dayMs(day, 9) + Double(i % 600) * 1000)), ("localDay", .string(day)),
                    ("help", help), ("judgment", .string(i % 5 == 0 ? "wrong" : "correct")),
                ]))
                list.append(rec)
                flat.append(rec)
            }
            records[month] = .array(list)
        }
        var ink = JSObject()
        for (n, rec) in flat.suffix(inkRecords).enumerated() {
            let month = String(rec["localDay"]!.stringValue!.prefix(7))
            var table = ink[month]?.objectValue ?? JSObject()
            table[rec["id"]!.stringValue!] = try InkMath.encodeStoredInk(rawStrokes(4 + n % 10, seed: n), policy: Config.policy.objectValue, format: "raw")
            ink[month] = .object(table)
        }
        var sched = JSObject()
        for (i, ch) in pool.enumerated() {
            sched["base:" + ch] = .object(JSObject([
                ("fsrs", .object(JSObject([("stability", .number(Double(3 + i % 40))), ("difficulty", .number(Double(4 + i % 5))), ("state", .number(2))]))),
                ("due", .string(i < 200 ? "2026-10-" + pad2(10 + i % 11) : "2026-11-" + pad2(1 + i % 28))),
                ("lastJudgedAt", .number(benchNow - Double(1 + i % 200) * ONE_DAY_MS)),
            ]))
        }
        let sessionSerial = 1 + serial / 30 + 1
        let session = JSValue.object(JSObject([
            ("id", .string("s\(sessionSerial)")), ("slot", .string("A")), ("kind", .string("daily")), ("source", .object(JSObject([("view", .string("home"))]))),
            ("queue", .array(pool.prefix(queueSize).map { .string("base:" + $0) })), ("cursor", .number(0)), ("items", .array([])),
            ("current", .object(JSObject([("phase", .string("recall")), ("strokes", .array([])), ("hints", .number(0)), ("answerSeen", .bool(false)), ("hintRange", .null), ("referenceReady", .bool(false))]))),
            ("lastLine", .null), ("startedAt", .number(benchNow - 60_000)), ("startedDay", .string("2026-10-21")), ("updatedAt", .number(benchNow - 60_000)),
        ]))
        return JSObject([
            ("meta", .object(JSObject([("schema", .number(2)), ("serial", .number(Double(serial))), ("createdAt", .number(dayMs("2026-03-01", 8))), ("months", .array(months.map { .string($0) }))]))),
            ("records", .object(records)),
            ("sched", .object(sched)),
            ("ink", .object(ink)),
            ("custom", .object(JSObject([("added", .array([]))]))),
            ("wordOff", .object(JSObject())),
            ("settings", .object(JSObject([("library", .string("common")), ("sound", .bool(true)), ("groupSize", .number(30))]))),
            ("photos", .null), ("legacy", .null),
            ("backupMeta", .object(JSObject([("lastExportAt", .number(benchNow - 3 * ONE_DAY_MS)), ("lastExportSig", .string("x"))]))),
            ("sessions", .object(JSObject([("A", session), ("B", .null), ("lastEnded", .object(JSObject()))]))),
            ("funnel", .null), ("safety", .null),
        ])
    }

    static func median(_ s: [Double]) -> Double { s.count % 2 == 1 ? s[s.count / 2] : (s[s.count / 2 - 1] + s[s.count / 2]) / 2 }
    static func fmt(_ x: Double) -> String { String(format: "%.3f", x) }

    static func report(_ backend: String, _ op: String, _ samples: [Double]) {
        let s = samples.sorted()
        let p95 = s[max(0, min(s.count - 1, Int((Double(s.count) * 0.95).rounded(.up)) - 1))]
        print("BENCH store backend=\(backend) op=\(op) n=\(s.count) median=\(fmt(median(s)))ms p95=\(fmt(p95))ms min=\(fmt(s.first!))ms max=\(fmt(s.last!))ms")
    }

    static func time(_ body: () -> Void) -> Double {
        let t0 = DispatchTime.now().uptimeNanoseconds
        body()
        return Double(DispatchTime.now().uptimeNanoseconds - t0) / 1_000_000
    }

    func makeStore(_ backend: () -> KVBackend, _ clock: Clock) -> Store {
        let storage = StoreStorage(backend(), now: { clock.t })
        let store = Store(storage: storage, now: { clock.t }, budgets: Budgets.native.js, dates: shanghai)
        let loaded = store.load()
        XCTAssertEqual(loaded["available"], .bool(true))
        return store
    }

    func run(_ name: String, _ backend: () -> KVBackend) throws {
        JSMath.flavor = .v8
        let clock = Clock(Self.benchNow)
        let state = try Self.heavyState()
        do {
            let seeding = makeStore(backend, clock)
            let r = seeding.seed(.object(state), label: "bench-seed")
            XCTAssertEqual(r["ok"], .bool(true), str(r))
        }
        // 与 App 相同：从库里 load 出来的状态
        let store = makeStore(backend, clock)
        let keys = try store.storage.listKeys(Schema.v2Prefix).count
        let schedCount = store.state["sched"]?.objectValue?.count ?? 0
        let recordCount = SessionWrites.allRecords(store.state).count
        let inkCount = flatInk(store.state["ink"]).count
        XCTAssertEqual(schedCount, Self.studied)
        XCTAssertEqual(recordCount, Self.months.count * Self.recordsPerMonth)
        XCTAssertEqual(inkCount, Self.inkRecords)
        print("BENCH store backend=\(name) state keys=\(keys) bytes=\(Int(store.usage?["total"]?.numberValue ?? 0)) sched=\(schedCount) records=\(recordCount) ink=\(inkCount)")

        let opened = WriteAPI.call("open", store, JSObject([("slot", .string("A"))]))
        XCTAssertEqual(opened["ok"], .bool(true), str(opened))
        var cardKey = opened["snapshot"]?["cardKey"] ?? .null
        XCTAssertNotEqual(cardKey, .null)

        // (a) 抬笔：一次 strokes 提交（笔画数轮换，保证每次都与已存的不同、真的提交）
        var strokes: [Double] = []
        for i in 0..<65 {
            clock.t += 500
            let args = JSObject([("slot", .string("A")), ("cardKey", cardKey), ("strokes", Self.wireStrokes(1 + i % 12, seed: i))])
            var r: JSValue = .null
            let ms = Self.time { r = WriteAPI.call("strokes", store, args) }
            XCTAssertEqual(r["ok"], .bool(true), str(r))
            XCTAssertEqual(r["noop"], .bool(false), str(r))
            if i >= 5 { strokes.append(ms) }
        }
        let current = store.state["sessions"]?["A"]?["current"]?["strokes"]?.arrayValue?.count
        XCTAssertEqual(current, 1 + 64 % 12, "the last strokes commit is what the session holds")
        Self.report(name, "strokes", strokes)

        // (b) 判断：一次 judge（记录 + 墨迹 + FSRS + 会话推进 + 回包快照）
        var judges: [Double] = []
        let serialBefore = store.serial
        for i in 0..<42 {
            clock.t += 1000
            let args = JSObject([("slot", .string("A")), ("cardKey", cardKey), ("strokes", Self.wireStrokes(3 + i % 8, seed: 100 + i)), ("judgment", .string("correct"))])
            var r: JSValue = .null
            let ms = Self.time { r = WriteAPI.call("judge", store, args) }
            XCTAssertEqual(r["ok"], .bool(true), str(r))
            XCTAssertEqual(r["reused"], .bool(false), str(r))
            XCTAssertNotEqual(r["recordId"] ?? .null, .null, str(r))
            XCTAssertEqual(r["snapshot"]?["done"], .bool(false), str(r))
            cardKey = r["snapshot"]?["cardKey"] ?? .null
            if i >= 2 { judges.append(ms) }
        }
        XCTAssertGreaterThan(store.serial, serialBefore)
        XCTAssertEqual(SessionWrites.allRecords(store.state).count, recordCount + 42)
        Self.report(name, "judge", judges)

        // (b') 只量 store：与判断同形的一次提交
        var commits: [Double] = []
        let pool = Self.chars(Self.studied)
        for i in 0..<42 {
            clock.t += 1000
            let ch = pool[Self.queueSize + 100 + i]
            var r: JSValue = .null
            let ms = Self.time {
                r = store.commit("bench:judge-shape") { d, c in
                    let id = try c.nextId("r")
                    let rec = JSValue.object(JSObject([
                        ("id", .string(id)), ("cardKey", .string("base:" + ch)), ("char", .string(ch)), ("sessionId", d["sessions"]!["A"]!["id"]!),
                        ("kind", .string("judged")), ("at", .number(c.now)), ("localDay", .string("2026-10-21")),
                        ("help", .object(JSObject([("hints", .number(0)), ("answerSeen", .bool(false)), ("traced", .bool(false))]))), ("judgment", .string("correct")),
                    ]))
                    var months = d["records"]!.objectValue!
                    months["2026-10"] = .array((months["2026-10"]?.arrayValue ?? []) + [rec])
                    d["records"] = .object(months)
                    var sched = d["sched"]!.objectValue!
                    sched["base:" + ch] = .object(JSObject([("fsrs", .object(JSObject([("stability", .number(9)), ("difficulty", .number(5)), ("state", .number(2))]))), ("due", .string("2026-10-30")), ("lastJudgedAt", .number(c.now))]))
                    d["sched"] = .object(sched)
                    try Store.setInk(&d, rec, try InkMath.encodeStoredInk(Self.rawStrokes(3 + i % 8, seed: 200 + i), policy: Config.policy.objectValue, format: c.inkFormat), timeZone: shanghaiTZ)
                    var sessions = d["sessions"]!.objectValue!
                    var A = sessions["A"]!.objectValue!
                    A["updatedAt"] = .number(c.now)
                    sessions["A"] = .object(A)
                    d["sessions"] = .object(sessions)
                }
            }
            XCTAssertEqual(r["ok"], .bool(true), str(r))
            XCTAssertEqual(r["keys"]?.arrayValue?.count, 5, str(r)) // inkRecord + records.2026-10 + sched + meta + sessions
            if i >= 2 { commits.append(ms) }
        }
        Self.report(name, "commit-judge", commits)

        // (c) 占用估算单独
        var usage: [Double] = []
        let before = store.usage
        for i in 0..<105 {
            var u: JSObject? = nil
            let ms = Self.time { u = store.refreshUsage() }
            XCTAssertNotNil(u)
            if i >= 5 { usage.append(ms) }
        }
        XCTAssertEqual(store.usage.map { str(.object($0)) }, before.map { str(.object($0)) }, "usage is a pure read")
        Self.report(name, "usage", usage)

        // 功能核对：重开读回的状态与内存里的相同（落盘的就是发布的）
        let reopened = makeStore(backend, clock)
        XCTAssertEqual(sortedJSON(.object(reopened.state)), sortedJSON(.object(store.state)))
        XCTAssertEqual(reopened.serial, store.serial)
        XCTAssertEqual(reopened.usage.map { str(.object($0)) }, store.usage.map { str(.object($0)) })
    }

    func testBenchmarkFakeNative() throws {
        let disk = FakeNativeDisk()
        try run("fake") { disk.open() }
    }

    func testBenchmarkSQLite() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("shizicore-bench-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("shizi.sqlite")
        try run("sqlite") { SQLiteTransport.backend(fileURL: url) }
    }
}
