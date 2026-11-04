import Foundation
import XCTest
@testable import ShiziCore

// 冷启动量测（只打印，不断言耗时）：首页第一次可用之前，懒加载的资源各花多少。
// 输出一行一项：`BENCH coldstart <name> <ms>`（CI 日志里 grep BENCH）。
//
// 读法：
//   · static.* = 进程里第一次碰这个 static let 的耗时（Swift 的 static let 每个进程只初始化一次，之后再碰是 0）。
//     这些数只有在本测试是进程里第一个碰它们的才是「冷」的：类名以 A 开头，XCTest 按类名字母序跑（swift test 不加 --parallel），
//     它排在全部测试类之前；若顺序变了，static.* 会偏小（偏到 0），fresh.* 不受影响。
//     碰的顺序照 App 冷启动的顺序：SwiftEngineCore.install 先碰 DeckData.shared → core.load()（读库）→ route.plan 的 view.home
//     （policy / 文案 / 字库索引 / 字序 / 题词 / 首页图形）→ 点「开始」才建的 DeckCards（buildCards + 索引）。
//     每一项只量它自己那一层：前面已经碰过的依赖不再算进去（例如 DeckIndex.shared 不含 deck-libraries.json 的解析）。
//   · fresh.* = 不经 static、在同一进程里从头再做一遍（读文件 / 解析 / 建对象），与测试顺序无关，可重复。
//   · store.* / home.* = 空库与一个有数据的库：读库（Store.load = readState，读全部行并逐值校验）与一次 view.home 等价的构建
//     （HomeView.homeView，deck: .real，与 HomeAPI 的 view.home 同参；ui 钩子为 nil）。
final class AColdStartBenchmarkTests: XCTestCase {
    private var sink = 0

    private static func ms(since t0: UInt64) -> Double { Double(DispatchTime.now().uptimeNanoseconds - t0) / 1_000_000 }

    private static func report(_ name: String, _ ms: Double) {
        print("BENCH coldstart \(name) \(String(format: "%.2f", ms))")
    }

    /// 量一次 body；返回值折进 sink，免得 -O 把构建删掉。
    @discardableResult
    private func bench<T>(_ name: String, _ size: (T) -> Int = { _ in 0 }, _ body: () throws -> T) rethrows -> T {
        let t0 = DispatchTime.now().uptimeNanoseconds
        let v = try body()
        Self.report(name, Self.ms(since: t0))
        sink &+= size(v)
        return v
    }

    /// 资源原文（ShiziCore 的资源包 Bundled/<name>.json）；找不到资源包时用解析结果重新写成 JSON（标在 source 行上）。
    private func resourceText(_ name: String) throws -> String {
        let testBundle = Bundle(for: AColdStartBenchmarkTests.self)
        let dirs = [testBundle.bundleURL.deletingLastPathComponent(), Bundle.main.bundleURL, testBundle.resourceURL].compactMap { $0 }
        for dir in dirs {
            let url = dir.appendingPathComponent("ShiziCore_ShiziCore.bundle")
            if let b = Bundle(url: url), let r = b.url(forResource: name, withExtension: "json", subdirectory: "Bundled") {
                return String(decoding: try Data(contentsOf: r), as: UTF8.self)
            }
        }
        print("BENCH coldstart-note \(name) source=restringified")
        return JSONWriter.stringify(try CoreResources.load(name))
    }

    func testColdStartFirstTouch() throws {
        print("BENCH coldstart-note order: static.* first (cold only if this class runs first in the process), then fresh.*, then store/home")

        // ---- 1. static 第一次碰（照 App 冷启动顺序）----
        // SwiftEngine.init → SwiftEngineCore.install：deps.groups = DeckData.shared.groups（deck.json 约 2MB，主线程）
        bench("static.DeckData.shared", { $0.seed.count }) { DeckData.shared }
        // core.load()：空库（FakeNativeDisk 替身；App 是 SQLite）。Store 的初始化顺带碰 policy / 预算 / Schema 的 static。
        let empty = bench("store.load.empty") { freshStore(.native) }
        // route.plan → view.home 碰到的配置
        bench("static.Config.policy", { $0.objectValue?.count ?? 0 }) { Config.policy }
        bench("static.Config.copyData", { $0.objectValue?.count ?? 0 }) { Config.copyData }
        bench("static.Copy.table", { $0.count }) { Copy.table }
        bench("static.Config.deckLibraries", { $0.objectValue?.count ?? 0 }) { Config.deckLibraries }
        bench("static.DeckIndex.shared", { $0.keys.count }) { DeckIndex.shared }
        bench("static.ScheduleDeck.real", { $0.practicable("base:\u{4EBA}") ? 1 : 0 }) { ScheduleDeck.real }
        bench("static.Config.charOrderData", { $0.objectValue?.count ?? 0 }) { Config.charOrderData }
        bench("static.NewOrder.defaultIndex", { $0.rank.count }) { NewOrder.defaultIndex }
        bench("static.CharOrder.shared", { $0.order.count }) { CharOrder.shared }
        bench("static.Epigraphs.all", { $0.count }) { Epigraphs.all }
        bench("static.CardRules.libraries", { $0.count }) { CardRules.libraries }
        bench("static.HomeView.brandPath", { $0.isNull ? 0 : 1 }) { HomeView.brandPath }
        // 第一次 view.home：其余没列到的懒加载 + 当前字库的新字顺序（DeckIndex.newOrder 的缓存）
        let homeNow = STORE_NOW
        func home(_ store: Store) throws -> JSValue {
            try HomeView.homeView(.object(store.state), now: homeNow, policy: Config.policy, deck: .real, ui: nil, dates: store.dates)
        }
        try bench("home.empty.first", { $0.objectValue?.count ?? 0 }) { try home(empty.store) }
        try bench("home.empty.second", { $0.objectValue?.count ?? 0 }) { try home(empty.store) }
        // 点「开始」（写字页取卡）才建：buildCards 全部卡 + cardKey 索引
        bench("static.DeckCards.shared", { $0.cards.count }) { DeckCards.shared }

        // ---- 2. 不经 static 从头再做一遍（可重复）----
        let deckText = try bench("fresh.read.deck", { $0.utf8.count }) { try resourceText("deck") }
        let deckValue = try bench("fresh.parse.deck") { try JSONParser.parse(deckText) }
        let data = bench("fresh.DeckData.init", { $0.seed.count }) { DeckData(deckValue) }
        let overrides = JSValue.object(data.overrides)
        try bench("fresh.Cards.buildCards", { $0.count }) { try Cards.buildCards(seed: data.seed, overrides: overrides) }
        try bench("fresh.DeckCards.init", { $0.cards.count }) { try DeckCards(seed: data.seed, overrides: overrides) }

        let libText = try bench("fresh.read.deck-libraries", { $0.utf8.count }) { try resourceText("deck-libraries") }
        let libValue = try bench("fresh.parse.deck-libraries") { try JSONParser.parse(libText) }
        let index = bench("fresh.DeckIndex.init", { $0.keys.count }) { DeckIndex(libValue) }
        bench("fresh.DeckIndex.newOrder.default", { $0.count }) { index.newOrder(.string(index.defaultLibraryId)) }
        bench("fresh.DeckIndex.warmup.default", { $0.count }) { index.warmup(.string(index.defaultLibraryId)) }

        for name in ["policy", "copy", "char-order", "card-rules", "epigraphs", "unicode-scripts", "view-brand", "view-seal"] {
            let text = try resourceText(name)
            try bench("fresh.parse." + name) { try JSONParser.parse(text) }
        }
        bench("fresh.NewOrder.index", { $0.rank.count }) { NewOrder.index(Config.charOrderData) }

        // ---- 3. 有数据的库：读库 + view.home ----
        let filled = try populatedDisk(records: 2000)
        guard let disk = filled else { return }
        let storage = StoreStorage(disk.open(), now: { STORE_NOW })
        let store = Store(storage: storage, now: { STORE_NOW }, dates: shanghai)
        bench("store.load.populated", { $0.count }) { store.load() }
        try bench("home.populated.first", { $0.objectValue?.count ?? 0 }) { try home(store) }
        try bench("home.populated.second", { $0.objectValue?.count ?? 0 }) { try home(store) }
        try storeSubSteps(disk)
        try homeSubSteps(.object(store.state), now: homeNow, dates: store.dates)

        print("BENCH coldstart-note sink=\(sink)")
    }

    /// Store.load 的分项：在同一份有数据的盘上新建一个 store，按 load() 的顺序逐步调同样的内部函数各量一次：`BENCH coldstart store.sub.<name> <ms>`。
    /// 盘已被上面的 load 修复过，这里的 repair 是对干净盘再跑一遍；ink 迁移在这份数据上（无旧月键）走提前返回。
    private func storeSubSteps(_ disk: TestDisk) throws {
        let store = Store(storage: StoreStorage(disk.open(), now: { STORE_NOW }), now: { STORE_NOW }, dates: shanghai)
        let storage = store.storage
        bench("store.sub.probe", { $0.ok ? 1 : 0 }) { storage.probe() }
        try bench("store.sub.repair", { $0.count }) { try storage.repair() }
        let (next, raws, legacy) = bench("store.sub.readState", { $0.raws.count }) { store.readState() }
        store.legacyInk = legacy
        store.lastRaw = raws
        let entries = bench("store.sub.stateToEntries", { $0.keys.count }) { store.stateToEntries(next, legacy: legacy) }
        bench("store.sub.deriveSerial", { Int($0) }) { Store.deriveSerial(next) }
        bench("store.sub.migrateInkSchema", { $0.count }) { store.migrateInkSchema() }
        bench("store.sub.inkSchemaReport", { $0.count }) { store.inkSchemaReport(schema: 2, legacyMonths: legacy.count) }
        bench("store.sub.refreshUsage", { $0?.count ?? 0 }) { store.refreshUsage() }
        sink &+= entries.keys.count
    }

    /// 首页构建（HomeView.homeModel / homeView）的分项，各自单独跑一次（懒加载此时都已就绪）：`BENCH coldstart home.sub.<name> <ms>`。
    /// 分项之间有重叠（例如 todayProgress 里含一次 planDaily → selectDaily → dueOrder / practiceStats），只用来看时间花在哪一层。
    private func homeSubSteps(_ st: JSValue, now: Double, dates: Dates) throws {
        let policy = Config.policy, rules = ScheduleRules(dates: dates), deck = ScheduleDeck.real
        let today = try dates.localDay(.number(now))
        let recs = bench("home.sub.flattenRecords", { $0.count }) { Query.flattenRecords(st["records"]) }
        bench("home.sub.recordsOf", { $0.count }) { ScheduleRules.recordsOf(st) }
        bench("home.sub.recordsState", { $0.utf8.count }) { HomeView.recordsStateOf(st, today: today, policy: policy) }
        try bench("home.sub.todayProgress", { $0.total }) { try TodayPlan.progress(st, day: today, rules: rules, deck: deck, policy: policy) }
        try bench("home.sub.resume", { $0.objectValue?.count ?? 0 }) { try HomeView.resumeOf(st, now: now, policy: policy, dates: dates) }
        try bench("home.sub.planSpecial", { $0.isNull ? 0 : 1 }) { try rules.planSpecial(st, today: today, deck: deck, policy: policy) }
        try bench("home.sub.noCharsLeft", { $0 ? 1 : 0 }) { try HomeView.noCharsLeft(st, today: today, deck: deck, policy: policy, dates: dates) }
        try bench("home.sub.planDaily", { $0.objectValue?.count ?? 0 }) { try rules.planDaily(st, today: today, deck: deck, policy: policy) }
        try bench("home.sub.practiceStats", { Int($0.groupsTotal) }) { try rules.practiceStats(recs, today, policy: policy, isWarm: NewOrder.isWarmupKey) }
        bench("home.sub.sortById.sched", { $0.count }) { SchedRecords.sortById(recs) }
        bench("home.sub.sortById.records", { $0.count }) { Records.sortById(recs) }
        bench("home.sub.capitalProgress", { $0.count }) { Special.capitalProgress(recs, policy: policy) }
        bench("home.sub.practicedByChar", { $0.count }) { Records.practicedByChar(recs) }
        bench("home.sub.lastJudgedDay", { $0.isNull ? 0 : 1 }) { HomeView.lastJudgedDayOf(recs) }
        let entries = st["sched"]?.objectValue?.entries ?? []
        try bench("home.sub.overdueScan.direct", { $0 }) { () throws -> Int in
            var n = 0
            for (_, e) in entries { if let od = try rules.overdueDays(e, today), od >= 0 { n += 1 } }
            return n
        }
        try bench("home.sub.overdueScan.memo", { $0 }) { () throws -> Int in
            var memo = ScheduleRules.OverdueMemo(today: today), n = 0
            for (_, e) in entries { if let od = try memo.days(e, rules), od >= 0 { n += 1 } }
            return n
        }
        try bench("home.sub.epigraph", { $0.lines.count }) { try Epigraphs.epigraph(for: .string(today), dates: dates) }
    }

    /// 2000 条记录（2026-01 … 2026-09，每条带墨迹）、对应的调度项、设置 = 缺省字库。seed 失败时只打印、不让测试失败（这是量测，不是规则测试）。
    private func populatedDisk(records n: Int) throws -> TestDisk? {
        let keys = DeckIndex.shared.keys.filter { $0.hasPrefix("base:") }
        guard keys.count >= 100 else { print("BENCH coldstart-note populated skipped: deck has \(keys.count) keys"); return nil }
        let uniq = min(keys.count, n * 3 / 4)
        var recordsByMonth = JSObject(), inkByMonth = JSObject(), sched = JSObject()
        var months: [JSValue] = []
        let perMonth = (n + 8) / 9
        var serial = 0
        for m in 1...9 {
            let month = String(format: "2026-%02d", m)
            var list: [JSValue] = [], inks = JSObject()
            for j in 0..<perMonth where serial < n {
                serial += 1
                let key = keys[(serial - 1) % uniq]
                let char = String(key.dropFirst("base:".count))
                let day = month + String(format: "-%02d", 1 + j % 28)
                let r = srec(serial, char, judgment: serial % 5 == 0 ? "wrong" : "correct", day: day, session: 1 + serial / 15, at: T0 + Double(serial) * 1000)
                list.append(r)
                inks["r\(serial)"] = inkEntry()
                sched[key] = .object(JSObject([("fsrs", .object(JSObject([("s", .number(Double(1 + serial % 30))), ("d", .number(5))]))),
                                               ("due", .string(String(format: "2026-10-%02d", 1 + serial % 28))), ("lastJudgedAt", .number(T0 + Double(serial) * 1000))]))
            }
            if list.isEmpty { continue }
            recordsByMonth[month] = .array(list)
            inkByMonth[month] = .object(inks)
            months.append(.string(month))
        }
        let state = JSObject([
            ("meta", .object(JSObject([("schema", .number(2)), ("serial", .number(Double(serial))), ("createdAt", .number(T0)), ("months", .array(months))]))),
            ("records", .object(recordsByMonth)), ("ink", .object(inkByMonth)), ("sched", .object(sched)),
            ("settings", .object(JSObject([("library", .string(DeckIndex.shared.defaultLibraryId)), ("sound", .bool(true)), ("large", .bool(false)), ("appearance", .string("auto"))]))),
        ])
        let env = freshStore(.native)
        let r = bench("store.seed.populated") { env.store.seed(.object(state)) }
        guard ok(r) else { print("BENCH coldstart-note populated skipped: seed failed \(str(r))"); return nil }
        print("BENCH coldstart-note populated records=\(serial) chars=\(sched.count) rows=\(env.disk.snapshot().count)")
        return env.disk
    }
}
