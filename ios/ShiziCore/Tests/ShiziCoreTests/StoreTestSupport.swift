import Foundation
import XCTest
@testable import ShiziCore

// test/store/helpers.mjs 的 Swift 版（B4.4）：两种后端（localStorage 替身 MemoryDisk / 原生 SQLite 替身 FakeNativeDisk）、
// v2 状态夹具（baselineState / record / session / inkEntry / judgeMutation）与断言小工具。汉字一律 \u{…} 转义。

let shanghaiTZ = TimeZone(identifier: "Asia/Shanghai")!
let shanghai = Dates(timeZone: shanghaiTZ)
/// Date.parse('2026-10-02T10:00:00+08:00')
let STORE_NOW = 1790906400000.0
let ONE_DAY_MS = 86_400_000.0

// 常用汉字（\u 转义）
let cRen = "\u{4EBA}", cKou = "\u{53E3}", cDa = "\u{5927}", cTian = "\u{5929}", cShui = "\u{6C34}", cShan = "\u{5C71}", cHuo = "\u{706B}", cYong = "\u{6C38}"
let cZhong = "\u{4E2D}", cHa = "\u{54C8}"

enum TestBackend: CaseIterable {
    case local, native
    var name: String { self == .local ? "localStorage" : "native" }
    var native: Bool { self == .native }
    func make(quota: Double = .infinity, initial: [(String, String)] = []) -> TestDisk {
        self == .native ? FakeNativeDisk(quotaBytes: quota, initial: initial) : MemoryDisk(quotaBytes: quota, initial: initial)
    }
}

struct StoreEnv {
    let store: Store
    let storage: StoreStorage
    let disk: TestDisk
}

func freshStore(_ B: TestBackend, disk: TestDisk? = nil, now: Double = STORE_NOW, budgets: JSObject? = nil) -> StoreEnv {
    let d = disk ?? B.make()
    let storage = StoreStorage(d.open(), now: { now })
    let store = Store(storage: storage, now: { now }, budgets: budgets, dates: shanghai)
    store.load()
    return StoreEnv(store: store, storage: storage, disk: d)
}

func seeded(_ B: TestBackend, disk: TestDisk? = nil, budgets: JSObject? = nil, file: StaticString = #filePath, line: UInt = #line) -> StoreEnv {
    let env = freshStore(B, disk: disk, budgets: budgets)
    let r = env.store.seed(.object(storeBaseline()))
    XCTAssertEqual(r["ok"], .bool(true), str(r), file: file, line: line)
    return env
}

/// helpers.mjs record()：at 缺省 T0 + serial × 1000。
func srec(_ serial: Int, _ char: String, kind: String = "judged", judgment: String = "correct", day: String = "2026-09-15", session: Int = 1, at: Double? = nil, extra: [(String, JSValue)] = []) -> JSValue {
    var pairs: [(String, JSValue)] = [
        ("id", .string("r\(serial)")), ("cardKey", .string("base:" + char)), ("char", .string(char)), ("sessionId", .string("s\(session)")),
        ("kind", .string(kind)), ("at", .number(at ?? (T0 + Double(serial) * 1000))), ("localDay", .string(day)),
        ("help", .object(JSObject([("hints", .number(0)), ("answerSeen", .bool(kind == "answer-seen")), ("traced", .bool(false))]))),
    ]
    if kind == "judged" { pairs.append(("judgment", .string(judgment))) }
    var o = JSObject(pairs)
    for (k, v) in extra { o[k] = v }
    return .object(o)
}

/// helpers.mjs inkEntry(points, strokes)：Ink v3，内容确定（tolerance:null）。
func inkEntry(_ points: Int = 8, _ strokes: Int = 3) -> JSValue {
    var raw: [[InkPoint]] = []
    for i in 0..<strokes {
        var pts: [InkPoint] = []
        for j in 0..<points {
            pts.append(InkPoint(x: Double(100 + i * 10 + j) * InkMath.grid / 1000, y: Double(200 + j) * InkMath.grid / 1000, t: Double(i * 1000 + j * 16), w: InkParams.standard.base, order: ["x", "y", "w", "t"]))
        }
        raw.append(pts)
    }
    return try! InkMath.encodeInk(raw, options: InkMath.EncodeOptions(maxPoints: Double(points), maxStrokes: Double(strokes), tolerance: .none))
}

/// 旧 InkV2（JSON 数字编码）。
func inkEntryV2(_ points: Int = 8, _ strokes: Int = 3) -> JSValue {
    var s: [JSValue] = []
    for i in 0..<strokes {
        var row: [JSValue] = []
        for j in 0..<points { row += [.number(Double(100 + i * 10 + j)), .number(Double(200 + j)), .number(100)] }
        s.append(.array(row))
    }
    return .object(JSObject([("v", .number(2)), ("c", .number(345)), ("s", .array(s))]))
}

func sessionJS(_ serial: Int, slot: String = "A", kind: String = "daily", queue: [String] = ["base:" + cRen, "base:" + cKou], cursor: Int = 0, items: [JSValue] = []) -> JSValue {
    .object(JSObject([
        ("id", .string("s\(serial)")), ("slot", .string(slot)), ("kind", .string(kind)), ("source", .object(JSObject([("view", .string("home"))]))),
        ("queue", .array(queue.map { .string($0) })), ("cursor", .number(Double(cursor))), ("items", .array(items)),
        ("current", .object(JSObject([("phase", .string("recall")), ("strokes", .array([])), ("hints", .number(0)), ("answerSeen", .bool(false))]))),
        ("lastLine", .null), ("startedAt", .number(T0)), ("startedDay", .string("2026-09-15")), ("updatedAt", .number(T0)),
    ]))
}

func item(_ cardKey: String, _ recordId: String, _ kind: String = "judged") -> JSValue {
    .object(JSObject([("cardKey", .string(cardKey)), ("recordId", .string(recordId)), ("kind", .string(kind))]))
}

/// helpers.mjs baselineState()。
func storeBaseline() -> JSObject {
    let fsrs = JSValue.object(JSObject([("s", .number(1)), ("d", .number(5))]))
    return JSObject([
        ("meta", .object(JSObject([("schema", .number(2)), ("serial", .number(3)), ("createdAt", .number(T0)), ("months", .array([.string("2026-09")]))]))),
        ("records", .object(JSObject([("2026-09", .array([srec(2, cRen), srec(3, cKou, judgment: "wrong")]))]))),
        ("sched", .object(JSObject([
            ("base:" + cRen, .object(JSObject([("fsrs", fsrs), ("due", .string("2026-09-18")), ("lastJudgedAt", .number(T0))]))),
            ("base:" + cKou, .object(JSObject([("fsrs", fsrs), ("due", .string("2026-09-16")), ("lastJudgedAt", .number(T0))]))),
        ]))),
        ("ink", .object(JSObject([("2026-09", .object(JSObject([("r2", inkEntry())])))]))),
        ("custom", .object(JSObject([("added", .array([.object(JSObject([("char", .string(cHa)), ("at", .number(T0))]))]))]))),
        ("wordOff", .object(JSObject())),
        ("settings", .object(JSObject([("library", .string("common")), ("sound", .bool(true)), ("large", .bool(false)), ("appearance", .string("auto"))]))),
        ("photos", .null), ("legacy", .null),
        ("backupMeta", .object(JSObject([("lastExportAt", .null), ("lastExportSig", .null)]))),
        ("sessions", .object(JSObject([
            ("A", sessionJS(1, cursor: 2, items: [item("base:" + cRen, "r2"), item("base:" + cKou, "r3")])), ("B", .null), ("lastEnded", .object(JSObject())),
        ]))),
        ("funnel", .null), ("safety", .null),
    ])
}

/// helpers.mjs judgeMutation(char)：新增一条 10 月记录、更新 sched、写墨迹、推进会话。
func judgeMutation(_ char: String = "\u{5927}") -> (inout JSObject, inout CommitContext) throws -> Void {
    return { draft, ctx in
        let id = try ctx.nextId("r")
        let serial = Int(id.dropFirst())!
        let rec = srec(serial, char, day: "2026-10-02", at: ctx.now)
        var records = draft["records"]!.objectValue!
        records["2026-10"] = .array((records["2026-10"]?.arrayValue ?? []) + [rec])
        draft["records"] = .object(records)
        var sched = draft["sched"]?.objectValue ?? JSObject()
        sched["base:" + char] = .object(JSObject([("fsrs", .object(JSObject([("s", .number(2)), ("d", .number(4))]))), ("due", .string("2026-10-05")), ("lastJudgedAt", .number(ctx.now))]))
        draft["sched"] = .object(sched)
        try Store.setInk(&draft, rec, inkEntry(), timeZone: shanghaiTZ)
        var sessions = draft["sessions"]!.objectValue!
        var A = sessions["A"]!.objectValue!
        A["queue"] = .array(A["queue"]!.arrayValue! + [.string("base:" + char)])
        A["cursor"] = .number(A["cursor"]!.numberValue! + 1)
        A["items"] = .array(A["items"]!.arrayValue! + [item("base:" + char, id)])
        A["updatedAt"] = .number(ctx.now)
        sessions["A"] = .object(A)
        draft["sessions"] = .object(sessions)
    }
}

func allRecordIds(_ state: JSObject) -> [String] {
    var ids: [String] = []
    for (_, v) in state["records"]?.objectValue?.entries ?? [] {
        let list = v.arrayValue ?? v["kept"]?.arrayValue ?? []
        for r in list { ids.append(r["id"]!.stringValue!) }
    }
    return ids
}

/// ink 域摊平成 {id: Ink}。
func flatInk(_ ink: JSValue?) -> JSObject {
    var out = JSObject()
    for (_, t) in ink?.objectValue?.entries ?? [] { for (id, e) in t.objectValue?.entries ?? [] { out[id] = e } }
    return out
}

/// 键排序后的 JSON（「状态相同」的比较，与 JS 的 sortKeys + JSON.stringify 同义）。
func sortedJSON(_ v: JSValue) -> String {
    func sorted(_ v: JSValue) -> JSValue {
        switch v {
        case .array(let a): return .array(a.map(sorted))
        case .object(let o): return .object(JSObject(UTF16Order.sorted(o.keys).map { ($0, sorted(o[$0]!)) }))
        default: return v
        }
    }
    return str(sorted(v))
}

func ok(_ r: JSValue) -> Bool { r["ok"] == .bool(true) }
func errKind(_ r: JSValue) -> String? { r["error"]?["kind"]?.stringValue }

func diskObject(_ d: TestDisk) -> JSObject { d.snapshotObject() }

/// 磁盘上全部键 → 原始字串（key(i) 遍历，与 JS 测试 keysBefore 同）。
func diskMap(_ d: TestDisk) -> [String: String] {
    var out: [String: String] = [:]
    for (k, v) in d.snapshot() { out[k] = v }
    return out
}

func SK(_ name: String) -> String { Schema.keyNamed(name)! }

/// 本地时刻（上海）：new Date(y, m-1, d, h)。
func localMs(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 0) -> Double { JSDate.makeLocal(y, m - 1, d, hours: h, shanghaiTZ)! }

/// 'YYYY-MM-DD' 当天 h 点（上海）。
func dayMs(_ day: String, _ h: Int = 9) -> Double {
    let p = day.split(separator: "-").map { Int($0)! }
    return localMs(p[0], p[1], p[2], h)
}
