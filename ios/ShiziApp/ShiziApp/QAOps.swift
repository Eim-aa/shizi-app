#if DEBUG
import QuartzCore
import ShiziCore
import UIKit

// QA-H1 夹具的造数据 op（B4.9：从 States/_ops/*.js + _runtime/prologue.js 搬到 Swift；App 里没有 JS 了）。
//
// 夹具 JSON（ShiziUITests/States/<状态>.json）仍是唯一来源：setup = [{op, …}]，op 名与参数同原来的 _ops/<op>.js（那些 JS 文件留在仓库里，
// 只给网页参考的开发工具 scripts/native-ui/fixture-dev.mjs 用）。规则一条：每个 op 调 ShiziCore 里与 JS 同名的那一个函数
// （judgeInDraft / createSession / skipInDraft / startPicked / startNextA / seed / markExported / buildBackupV2 / recover …），
// 写字会话 op 走 SessionRuntime 的 write.*（与原生写字页同一批提交函数），导航走 SwiftNavigator（与「去哪」的规则同一个入口）。
//
// 时钟：clock.pin 期间应用时钟（store / 导航的「现在」）每次读数 +5ms、从固定时刻起（QAClock.pin，= prologue.js 的 Date.now 钉住），
// 造完放开（unpinClock 或 setup 结束），全 App 的钟从那一刻起平移；judge 的 tick 把读数拨到第 tick 次（R16）。
// 造数据期间不放判断声（不是用户的提交；判断声轮换计数不动）。

@MainActor
final class QAFixtureRunner {
    unowned let host: RootViewController
    private var engine: SwiftEngine { host.stage.engine }
    private var core: SwiftEngineCore { engine.core }
    private var store: Store { core.store }

    /// "$名字" 取用的变量（mark 记的会话 id / 总字数、call 的结果 last）。
    private var vars: [String: JSValue] = [:]
    /// seedRecords 累积的草稿（records / sched / ink / sessions），seed 提交。
    private var draft: JSObject?
    /// patch 累积的各域，seed 提交。
    private var patch: JSObject?
    /// seedRecords 的记录号 / 会话号（p + 序号，从 101 起）。
    private var idN = 100

    /// 还原函数（JS window.__qaCleanups）：op 改了全局的东西时登记，下一个顶层夹具清空前执行（同一次启动要连跑上百个状态）。
    static var cleanups: [() -> Void] = []

    /// 固定 5 字（这次选的字，B 槽）：永 和 春 日 月。
    static let chars = ["\u{6C38}", "\u{548C}", "\u{6625}", "\u{65E5}", "\u{6708}"]

    init(host: RootViewController) {
        self.host = host
    }

    // MARK: 前导 + 逐条执行 + 收尾（prologue.js / epilogue.js）

    /// 执行一段 setup。返回 nil = 成功，否则是错误说明。reset：顶层夹具清空数据、回首页；base 链里后一个夹具接着前一个的现场 = false。
    func run(_ setup: [[String: Any]], pin: String, clock: String, reset: Bool) async -> String? {
        if reset {
            for fn in Self.cleanups { fn() }
            Self.cleanups.removeAll()
            QABackupPick.current = nil
            try? engine.nav.router.switchTab("home")
            host.stage.resetRootsForTesting() // B3.F：每个顶层状态从新挂载的字库 / 我的根页开始
            await sleep(120)
            engine.qaReset()
            QAClock.unpinWithoutShift()
            QAClock.setClock(nil)
            if !clock.isEmpty, let at = Self.localMs(clock) { QAClock.setClock(at) }
        }
        if !pin.isEmpty, let fix = Self.localMs(pin) { QAClock.pin(at: fix) }
        core.quiet = true
        defer { core.quiet = false }
        for step in setup {
            let op = step["op"] as? String ?? ""
            let a = EngineValue.object(step)
            if let err = await perform(op, a) { QAClock.unpin(); return err }
        }
        QAClock.unpin()
        return nil
    }

    private func perform(_ op: String, _ a: JSObject) async -> String? {
        do {
            switch op {
            case "seedRecords": try seedRecords(a)
            case "seed": return try await seed(a)
            case "patch": patchDomain(a)
            case "switchTab": await switchTab(a)
            case "push": try engine.nav.push(QAJS.string(a["screen"]), subst(a["params"] ?? .object(JSObject())))
            case "openApi": break // 写字会话 API 不用预先建（JS 那边缓存 API 对象的创建点会多读一次时钟；Swift 直接调 SessionRuntime）
            case "startPicked": return startPicked(a)
            case "startNextA": return startNextA()
            case "openWrite": try engine.nav.openWrite(a["slot"]?.stringValue ?? "B")
            case "judge": return judge(a)
            case "today": return try today(a)
            case "call": return call(a)
            case "mark": try mark(a)
            case "unpinClock": QAClock.unpin()
            case "setClock": if let at = Self.localMs(QAJS.string(a["iso"])) { QAClock.setClock(at) }
            case "resetData": engine.qaReset(); QAClock.setClock(nil); draft = nil; patch = nil
            case "openS02":
                engine.qaUI("startPicked", .object(JSObject([("keys", a["keys"] ?? .array([.string("\u{706B}")])), ("source", .object(JSObject([("view", .string("home"))])))])))
                await sleep(300)
            case "openQuery":
                engine.qaUI("openQuery", .object(JSObject([("mode", a["mode"] ?? .string("lookup")), ("text", a["text"] ?? .string("")),
                                                           ("selected", a["selected"] ?? .array([])), ("composing", .bool(QAJS.truthy(a["composing"])))])))
                await sleep(300)
            case "openImage": return await openImage(a)
            case "blockMode": return await blockMode(a)
            case "corruptNotice": await corruptNotice(a)
            case "setUsage": setUsage(a)
            case "markExported": return markExported(a)
            case "foldNow": return try await foldNow(a)
            case "exhaustLibrary": try exhaustLibrary(a)
            case "stashBackup": break // 网页参考的「选中的备份文件」（window.__qaBackupText，只给网页步骤里的 js 用）；原生取证走 stashBackupPick
            case "stashBackupPick": QABackupPick.current = (Backup.serializeBackup(.object(try Backup.buildBackupV2(store.state, now: Self.localMs("2026-10-22T09:00:00") ?? 0))), 0)
            case "stashBadBackup": QABackupPick.current = ("{\"not\":\"a backup\"}", 0)
            case "stashTooLargeBackup": QABackupPick.current = (nil, Int(a["bytes"]?.numberValue ?? Double(BackupFile.maxBytes + 1)))
            case "stubNative": stubSave(success: false, reply: false)
            case "stubSave": stubSave(success: QAJS.truthy(a["success"]), reply: a["reply"] != .bool(false))
            case "systemPermission":
                engine.qaPermission = a["value"]?.stringValue
                Self.cleanups.append { [weak engine] in engine?.qaPermission = nil }
            case "shareFailed": engine.nav.postShareFailed(kind: "card")
            case "handoffSkipUndo": handoffSkipUndo(a)
            case "leaveUndoCleanup": Self.cleanups.append { [weak core] in core?.host.pages.clearLeaveUndo() }
            case "writeOverflowPrompt": return try writeOverflowPrompt()
            default: return "unknown op \(op)"
            }
        } catch {
            return "\(op): \(error)"
        }
        return nil
    }

    // MARK: 工具

    private func sleep(_ ms: Double) async { try? await Task.sleep(nanoseconds: UInt64(max(0, ms) * 1_000_000)) }

    /// "$名字" → vars（字符串、数组、对象里逐层替换）。
    private func subst(_ v: JSValue) -> JSValue {
        switch v {
        case .string(let s) where s.hasPrefix("$"): return vars[String(s.dropFirst())] ?? .null
        case .array(let a): return .array(a.map(subst))
        case .object(let o):
            var out = JSObject()
            for (k, x) in o.entries { out[k] = subst(x) }
            return .object(out)
        default: return v
        }
    }

    /// 固定笔画（345 单位，每 16ms 一点）：one = 一横；two = 一横一竖（与原生书写面注入的同形）。
    private static func line(_ x0: Double, _ y0: Double, _ dx: Double, _ dy: Double, _ t0: Double) -> JSValue {
        .array((0..<14).map { i in .array([.number(x0 + dx * Double(i)), .number(y0 + dy * Double(i)), .number(t0 + Double(i) * 16)]) })
    }
    private static func strokeSet(_ name: String) -> JSValue {
        name == "one" ? .array([line(70, 150, 15, 1, 1000)]) : .array([line(70, 150, 15, 1, 1000), line(172, 60, 0.5, 17, 2000)])
    }

    /// 本地时间 'YYYY-MM-DDTHH:mm:ss'（或毫秒数）→ ms（JS Date.parse 的本地时间口径）。
    static func localMs(_ iso: String) -> Double? {
        if let n = Double(iso) { return n }
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = iso.count > 16 ? "yyyy-MM-dd'T'HH:mm:ss" : "yyyy-MM-dd'T'HH:mm"
        return f.date(from: iso).map { $0.timeIntervalSince1970 * 1000 }
    }

    /// ms → 本地日期 'YYYY-MM-DD'。
    private static func localDay(_ ms: Double) -> String {
        let c = Calendar(identifier: .gregorian).dateComponents(in: .current, from: Date(timeIntervalSince1970: ms / 1000))
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    private func snapshot(_ slot: String) -> JSValue { (try? WriteModels.snapshot(store.state, slot: slot)) ?? .null }

    /// 写字会话 API（write.*，与原生写字页同一批提交函数）。同步调用：钉住的时钟里读数次数确定。
    private func write(_ name: String, _ args: JSObject) -> JSValue { core.runtime.call("write." + name, args) }

    private func nextId(_ prefix: String) -> String {
        idN += 1
        return prefix + String(idN)
    }

    // MARK: 造数据（seedRecords / patch / seed / foldNow / exhaustLibrary）

    /// 笔画三种（seedRecords.js VARIANTS）。
    private static let variants: [[[InkPoint]]] = [
        [[(60, 170, 0), (170, 168, 60), (290, 172, 120)]],
        [[(60, 120, 0), (170, 118, 60), (290, 122, 120)], [(172, 50, 300), (170, 170, 360), (174, 300, 420)]],
        [[(70, 70, 0), (170, 170, 60), (290, 290, 120)], [(290, 70, 250), (180, 180, 310), (70, 290, 370)]],
    ].map { strokes in strokes.map { pts in pts.compactMap { p in InkPoint(js: .object(JSObject([("x", .number(p.0)), ("y", .number(p.1)), ("t", .number(p.2))]))) } } }

    private func newDraft() -> JSObject {
        JSObject([("records", .object(JSObject())), ("sched", .object(JSObject())), ("ink", .object(JSObject())),
                  ("sessions", .object(JSObject([("A", .null), ("B", .null), ("lastEnded", .object(JSObject()))])))])
    }

    private func setSession(_ d: inout JSObject, _ slot: String, _ s: JSValue) {
        var sessions = d["sessions"]?.objectValue ?? JSObject()
        sessions[slot] = s
        d["sessions"] = .object(sessions)
    }

    private func createSession(kind: JSValue?, queue: [String], at: Double) throws -> JSValue {
        try SessionRules.createSession(id: .string(nextId("s")), kind: kind ?? .string("daily"), source: .object(JSObject([("view", .string("home"))])),
                                       queue: .array(queue.map { .string("base:" + $0) }), at: .number(at), dates: store.dates)
    }

    /// seedRecords.js：每条经 judgeInDraft（与真人判断同一个函数），时间戳全部来自夹具里写死的 at / day。累积进 draft，之后由 seed 提交。
    private func seedRecords(_ a: JSObject) throws {
        var d = draft ?? newDraft()
        var n = 0
        func atOf(_ e: JSValue, _ i: Int) -> Double {
            let base: Double
            if case .number(let x)? = e["at"] { base = x } else if let s = e["at"]?.stringValue { base = Self.localMs(s) ?? .nan } else { base = Self.localMs(QAJS.string(e["day"]) + "T09:00:00") ?? .nan }
            return base + Double(i) * 1000
        }
        func one(_ e: JSValue) throws {
            let text = e["chars"]?.stringValue ?? e["char"]?.stringValue ?? ""
            for (i, ch) in text.unicodeScalars.map({ String($0) }).enumerated() {
                let at = atOf(e, i)
                setSession(&d, "A", try createSession(kind: e["kind"], queue: [ch], at: at))
                let strokes = Self.variants[(e["variant"]?.numberValue.map { Int($0) } ?? n) % 3]
                n += 1
                let args = JSObject([("slot", .string("A")), ("cardKey", .string("base:" + ch)), ("judgment", e["judgment"] ?? .string("correct")), ("perRecordInk", .bool(e["ink"] != .bool(false)))])
                _ = try SessionWrites.judgeInDraft(&d, args, strokes: strokes, at: at, nextId: { nextId("r") }, inkFormat: "raw", dates: store.dates)
                setSession(&d, "A", .null)
            }
        }
        for e in a["entries"]?.arrayValue ?? [] { try one(e) }
        if let g = a["gen"]?.objectValue {
            var s = UInt32(truncatingIfNeeded: Int64(g["seed"]?.numberValue ?? 1))
            func rnd() -> Double { s = s &* 1664525 &+ 1013904223; return Double(s) / 4294967296 }
            let pool = QAJS.string(g["chars"]).unicodeScalars.map { String($0) }
            let start = Self.localMs(QAJS.string(g["from"]) + "T09:00:00") ?? 0
            let days = Int(g["days"]?.numberValue ?? 0), perDay = Int(g["perDay"]?.numberValue ?? 0), wrongEvery = Int(g["wrongEvery"]?.numberValue ?? 0)
            for day in 0..<days {
                let iso = Self.localDay(start + Double(day) * 86_400_000)
                for k in 0..<perDay {
                    let ch = pool[Int(floor(rnd() * Double(pool.count)))]
                    let judgment = wrongEvery > 0 && (day * perDay + k) % wrongEvery == 0 ? "wrong" : "correct"
                    try one(.object(JSObject([("char", .string(ch)), ("at", .string(iso + "T09:" + String(format: "%02d", 10 + k) + ":00")), ("judgment", .string(judgment)), ("ink", g["ink"] ?? .null)])))
                }
            }
        }
        if let lib = a["lib"]?.objectValue {
            let id = lib["id"]?.stringValue ?? "core3500"
            let keys = (DeckIndex.shared.library(.string(id))?.keys ?? []).filter { DeckIndex.shared.isPracticable($0) }.prefix(Int(lib["n"]?.numberValue ?? 0))
            let start = Self.localMs(QAJS.string(lib["from"]) + "T09:00:00") ?? 0
            let perDay = Int(lib["perDay"]?.numberValue ?? 3)
            for (i, k) in keys.enumerated() {
                let iso = Self.localDay(start + Double(i / perDay) * 86_400_000)
                try one(.object(JSObject([("char", .string(String(k.dropFirst("base:".count)))), ("at", .string(iso + "T09:" + String(10 + i % perDay) + ":00"))])))
            }
        }
        for sk in a["skips"]?.arrayValue ?? [] {
            let at = atOf(sk, 0), ch = QAJS.string(sk["char"])
            setSession(&d, "A", try createSession(kind: .string("daily"), queue: [ch], at: at))
            _ = try SessionWrites.skipInDraft(&d, JSObject([("slot", .string("A")), ("cardKey", .string("base:" + ch))]), at: at, nextId: { nextId("r") }, dates: store.dates)
            setSession(&d, "A", .null)
        }
        d["sessions"] = .object(JSObject([("A", .null), ("B", .null), ("lastEnded", .object(JSObject()))]))
        for g in a["groups"]?.arrayValue ?? [] {
            let at = Self.localMs(QAJS.string(g["at"])) ?? 0
            let chars = (g["chars"]?.arrayValue ?? []).map { QAJS.string($0) }
            let slot = g["slot"]?.stringValue ?? "A"
            setSession(&d, slot, try createSession(kind: g["kind"], queue: chars, at: at))
            for (i, step) in (g["steps"]?.arrayValue ?? []).enumerated() {
                let args = JSObject([("slot", .string(slot)), ("cardKey", .string("base:" + chars[i])), ("judgment", step)])
                _ = try SessionWrites.judgeInDraft(&d, args, strokes: Self.variants[(i + 1) % 3], at: at + Double(i) * 1000, nextId: { nextId("r") }, inkFormat: "raw", dates: store.dates)
            }
        }
        draft = d
    }

    private static func isPlainObject(_ v: JSValue?) -> Bool { if case .object? = v { return true }; return false }

    /// patch.js：改某个数据域（对象与同一域里先前 patch 的合并），由 seed 提交。
    private func patchDomain(_ a: JSObject) {
        var p = patch ?? JSObject()
        let domain = QAJS.string(a["domain"]), value = a["value"] ?? .null
        if case .object(var cur)? = p[domain], case .object(let v) = value {
            for (k, x) in v.entries { cur[k] = x }
            p[domain] = .object(cur)
        } else {
            p[domain] = value
        }
        patch = p
    }

    /// seed.js：在当前数据上叠草稿与各域（对象域与现有的合并，草稿里有的域不合并），经 store.seed 整体替换（走形状校验）。
    private func seed(_ a: JSObject) async throws -> String? {
        let base = store.state
        var next = base
        for (k, v) in (draft ?? JSObject()).entries { next[k] = v }
        for (k, v) in (patch ?? JSObject()).entries {
            if case .object(let vo) = v, case .object(var bo)? = base[k], draft?[k] == nil {
                for (kk, x) in vo.entries { bo[kk] = x }
                next[k] = .object(bo)
            } else {
                next[k] = v
            }
        }
        let r = store.seed(.object(next))
        guard r["ok"] == .bool(true) else { return "seed \(JSONWriter.stringify(r))" }
        draft = nil
        patch = nil
        await sleep(a["wait"]?.numberValue ?? 150)
        return nil
    }

    /// foldNow.js：先提交造好的数据，再在一次提交里做 store 在下一次提交时才做的预算回收（旧月份折叠 / 墨迹淘汰）。
    private func foldNow(_ a: JSObject) async throws -> String? {
        if draft != nil || patch != nil {
            var next = store.state
            for (k, v) in (draft ?? JSObject()).entries { next[k] = v }
            for (k, v) in (patch ?? JSObject()).entries { next[k] = v }
            let r0 = store.seed(.object(next))
            guard r0["ok"] == .bool(true) else { return "seed \(JSONWriter.stringify(r0))" }
            draft = nil
            patch = nil
        }
        let budgets = store.budgets, dates = store.dates
        let r = store.commit("qa-fold-now") { d, c in _ = Budget.recover(&d, now: c.now, budgets: budgets, dates: dates) }
        guard r["ok"] == .bool(true) else { return "fold \(JSONWriter.stringify(r))" }
        await sleep(a["wait"]?.numberValue ?? 300)
        return nil
    }

    /// exhaustLibrary.js：练习范围切到最小的库（缺省 rare），再给这个库里每个可练的字（含大写数字特别组）一条写对的判断记录（不留墨）。要提交请接着调 seed。
    private func exhaustLibrary(_ a: JSObject) throws {
        let lib = a["library"]?.stringValue ?? "rare"
        var seen = Set<String>(), chars: [String] = []
        let keys = (DeckIndex.shared.library(.string(lib))?.keys ?? []) + "\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}\u{9646}\u{67D2}\u{634C}\u{7396}\u{62FE}\u{96F6}\u{4F70}\u{4EDF}".unicodeScalars.map { "base:" + String($0) }
        for k in keys where DeckIndex.shared.isPracticable(k) {
            let ch = String(k.dropFirst("base:".count))
            if seen.insert(ch).inserted { chars.append(ch) }
        }
        patchDomain(JSObject([("domain", .string("settings")), ("value", .object(JSObject([("library", .string(lib))])))]))
        let at0 = Self.localMs(a["at"]?.stringValue ?? "2026-10-05T08:00:00") ?? 0
        try seedRecords(JSObject([("entries", .array(chars.enumerated().map { i, ch in .object(JSObject([("char", .string(ch)), ("at", .number(at0 + Double(i) * 1000)), ("ink", .bool(false))])) }))]))
    }

    // MARK: 会话（startPicked / startNextA / judge / call / mark / openWrite）

    private func startPicked(_ a: JSObject) -> String? {
        let keys = a["keys"]?.arrayValue ?? Self.chars.map { .string($0) }
        do {
            let r = try ScheduleRules(dates: store.dates).startPicked(store, keys: keys, source: .object(JSObject([("view", .string("home"))])), deck: .real)
            return r["ok"] == .bool(true) ? nil : "startPicked \(JSONWriter.stringify(r))"
        } catch { return "startPicked \(error)" }
    }

    private func startNextA() -> String? {
        do {
            let r = try ScheduleRules(dates: store.dates).startNextA(store, now: store.now(), deck: .real, source: .object(JSObject([("view", .string("home"))])))
            return r["ok"] == .bool(true) && r["started"] == .bool(true) ? nil : "startNextA \(JSONWriter.stringify(r))"
        } catch { return "startNextA \(error)" }
    }

    /// judge.js：经写字会话 API 连判几个字。a: {slot, judgments:[…循环取], n:数字|'all', strokes:'one'|'two', tick:数字, retry:'correct'|'wrong'}
    /// D83（S2）：n 数的是「第一次」——judgments 只给每个字的第一次；中途轮到的重考按 retry（缺省 correct）判；
    /// 判完 n 个第一次之后，紧接着的重考也判完（这样「写完一组」的夹具在有写错时照样写完）；'all' = 写到这一组结束。
    private func judge(_ a: JSObject) -> String? {
        if let tick = a["tick"]?.numberValue { QAClock.repin(tick) }
        let slot = a["slot"]?.stringValue ?? "B"
        let strokes = Self.strokeSet(a["strokes"]?.stringValue ?? "two")
        let js = a["judgments"]?.arrayValue ?? [.string("correct")]
        let all = a["n"] == .string("all")
        let n = all ? Int.max : a["n"]?.numberValue.map { Int($0) } ?? js.count
        let retryJudgment = a["retry"] ?? .string("correct")
        var firsts = 0
        for _ in 0..<500 {
            guard let session = store.state["sessions"]?[slot], QAJS.truthy(session), let k = SessionRules.currentCardKey(session), QAJS.truthy(k) else { break }
            let retry = TodayPlan.attempts(session, k) > 0
            if !retry && firsts >= n { break }
            let p = write("phase", JSObject([("slot", .string(slot)), ("cardKey", k), ("phase", .string("compare")), ("strokes", strokes)]))
            if slot == "B", p["ok"] != .bool(true) { return "phase \(JSONWriter.stringify(p["error"] ?? .null))" }
            let judgment = retry ? retryJudgment : js[firsts % js.count]
            let r = write("judge", JSObject([("slot", .string(slot)), ("cardKey", k), ("judgment", judgment), ("strokes", strokes), ("hints", .number(0))]))
            if r["ok"] != .bool(true) { return "judge \(JSONWriter.stringify(r["error"] ?? .null))" }
            if !retry { firsts += 1 }
        }
        return nil
    }

    /// today（D83）：今天的账（sessions.today）。a: {done?, target?}；进度 = 今天有判断 / 看答案 / 跳过记录的字（造数据之后、seed 之前或之后都可以）。
    private func today(_ a: JSObject) throws -> String? {
        let day = try store.dates.localDay(.number(store.now()))
        var d = draft ?? store.state
        let records = Query.flattenRecords(d["records"]).filter { $0["localDay"] == .string(day) }
        var keys: [String] = []
        for r in Records.sortById(records) { if let k = r["cardKey"]?.stringValue, !keys.contains(k) { keys.append(k) } }
        var t = TodayPlan.Today(day: day, handled: keys, target: a["target"]?.numberValue.map { Int($0) } ?? (QAJS.truthy(a["done"]) ? keys.count : nil), done: QAJS.truthy(a["done"]))
        if t.target == nil && t.done { t.target = keys.count }
        var sessions = d["sessions"]?.objectValue ?? JSObject([("A", .null), ("B", .null), ("lastEnded", .object(JSObject()))])
        sessions["today"] = t.js
        d["sessions"] = .object(sessions)
        if draft != nil { draft = d; return nil }
        let r = store.seed(.object(d))
        return r["ok"] == .bool(true) ? nil : "today \(JSONWriter.stringify(r))"
    }

    /// call.js：调一次写字会话 API（当前字）。a: {slot, name, args:{…}}；args.strokes 可写 'one' | 'two' | 数组。结果记在 vars.last。
    private func call(_ a: JSObject) -> String? {
        let slot = a["slot"]?.stringValue ?? "B"
        var args = subst(a["args"] ?? .object(JSObject())).objectValue ?? JSObject()
        if let s = args["strokes"]?.stringValue { args["strokes"] = Self.strokeSet(s) }
        let k = args["cardKey"].flatMap { QAJS.truthy($0) ? $0 : nil } ?? snapshot(slot)["cardKey"] ?? .null
        var full = JSObject([("slot", .string(slot)), ("cardKey", k)])
        for (key, v) in args.entries { full[key] = v }
        let name = QAJS.string(a["name"])
        let r = write(name, full)
        guard r["ok"] == .bool(true) else { return "\(name) \(JSONWriter.stringify(r["error"] ?? .null))" }
        vars["last"] = r
        return nil
    }

    private func mark(_ a: JSObject) throws {
        let snap = snapshot(a["slot"]?.stringValue ?? "B")
        if let sid = a["sid"]?.stringValue { vars[sid] = snap["sessionId"] ?? .null }
        if let total = a["total"]?.stringValue { vars[total] = snap["total"] ?? .null }
    }

    /// handoffSkipUndo.js：最后一字跳过 → 写字页把撤销机会交给结果页（取证时撤销条留够久）。需要先 call skip。
    private func handoffSkipUndo(_ a: JSObject) {
        var undo = vars["last"]?["undo"]?.objectValue ?? JSObject()
        undo["slot"] = a["slot"] ?? .string("B")
        undo["strokes"] = .null
        undo["until"] = .number(CACurrentMediaTime() * 1000 + 600_000)
        engine.nav.host.handoffSkipUndo(.object(undo))
    }

    // MARK: 导航

    /// switchTab.js：切 tab 根页。remount: true = 先切到别的 tab 再切回（根页重新挂载）；登记还原：下一个顶层夹具清空前再切走一次。
    private func switchTab(_ a: JSObject) async {
        let tab = a["tab"]?.stringValue ?? "home"
        guard QAJS.truthy(a["remount"]) else { try? engine.nav.router.switchTab(tab); return }
        let other = tab == "mine" ? "home" : "mine"
        host.stage.resetRootsForTesting()
        try? engine.nav.router.switchTab(other)
        await sleep(80)
        host.stage.resetRootsForTesting()
        try? engine.nav.router.switchTab(tab)
        await sleep(80)
        Self.cleanups.append { [weak engine] in try? engine?.nav.router.switchTab(other) }
    }

    /// openImage.js：原生页的图片按钮 = 按夹具写的 scope 直接开原生图片预览（与原生页的图片按钮同一个入口）。前一步推的页先等它推上来、取完视图。
    private func openImage(_ a: JSObject) async -> String? {
        guard let scope = a["scope"]?.objectValue else { return "openImage: no scope (the web button is gone; give the fixture a scope)" }
        await sleep(a["wait"]?.numberValue ?? 2500)
        engine.nav.openImagePreview(scope)
        await sleep(300)
        return nil
    }

    // MARK: 存储替身 / 平台桩

    /// blockMode.js：unavailable = 存储探测不过；blocked = 写失败且回滚也失败；migration = 迁移失败（D81 ② 起只有夹具造得出）。
    private func blockMode(_ a: JSObject) async -> String? {
        switch a["kind"]?.stringValue {
        case "unavailable":
            engine.qaOverrideStorage(probe: "security", blocked: nil, quarantined: nil)
            Self.cleanups.append { [weak engine] in engine?.qaOverrideStorage(probe: nil, blocked: nil, quarantined: nil) }
        case "blocked":
            engine.qaOverrideStorage(probe: nil, blocked: "rollback-failed", quarantined: nil)
            Self.cleanups.append { [weak engine] in engine?.qaOverrideStorage(probe: nil, blocked: nil, quarantined: nil) }
        case "migration":
            engine.qaSetMigrationFailure("qa-injected")
            Self.cleanups.append { [weak engine] in engine?.qaSetMigrationFailure(nil) }
        default:
            return "blockMode: unknown kind \(QAJS.string(a["kind"]))"
        }
        await sleep(300)
        return nil
    }

    /// corruptNotice.js：启动修复的报告换成「隔离了某个键」，重读后坏值浮条出现；还原时收起浮条。
    private func corruptNotice(_ a: JSObject) async {
        engine.qaOverrideStorage(probe: nil, blocked: nil, quarantined: [a["key"]?.stringValue ?? "shizi.v2.settings"])
        Self.cleanups.append { [weak engine] in
            engine?.qaOverrideStorage(probe: nil, blocked: nil, quarantined: nil)
            engine?.qaUI("corruptHide", .null)
        }
        await sleep(300)
    }

    /// setUsage.js：存储占用估算换成预警值（界面只读 store.status.usage）。a: {level: 'warn'|'full', ratio}
    private func setUsage(_ a: JSObject) {
        let ratio = a["ratio"]?.numberValue ?? 0.86
        store.storage.usageOverride = JSObject([("level", a["level"] ?? .string("warn")), ("ratio", .number(ratio)), ("total", .number((ratio * 64 * 1024 * 1024).rounded())), ("byBucket", .object(JSObject()))])
        Self.cleanups.append { [weak store] in store?.storage.usageOverride = nil }
        _ = store.refreshUsage()
    }

    /// markExported.js：把备份记成「已导出」（core/backup.markExported，与真人导出完成同一个写入）。a: {at, same: false = 导出后记录又有改动}
    private func markExported(_ a: JSObject) -> String? {
        let r = Backup.markExported(store, at: Self.localMs(QAJS.string(a["at"])) ?? 0, sig: a["same"] == .bool(false) ? "sig-before-changes" : nil)
        return r["ok"] == .bool(true) ? nil : "markExported \(JSONWriter.stringify(r))"
    }

    /// stubSave.js / stubNative.js：存相册的桩（取证时不能弹相册权限框）。reply = false：不回包（保存中一直等着）。
    private func stubSave(success: Bool, reply: Bool) {
        RootViewController.qaSaveStub = (success, reply)
        Self.cleanups.append { RootViewController.qaSaveStub = nil }
    }

    /// writeOverflowPrompt.js（只给流程用的极端题面）：把「姥」的提示换成现有最长提示的四倍。产品文案与版式常量不动。
    private func writeOverflowPrompt() throws -> String? {
        guard let card = DeckCards.shared.cardForKey("base:\u{59E5}") else { return "missing card" }
        guard let hint = try Cards.visibleHint(card).stringValue, !hint.isEmpty else { return "missing existing hint" }
        var long = card.objectValue ?? JSObject()
        let four = String(repeating: hint, count: 4)
        long["hint"] = .string(four)
        long["promptHint"] = .string(four)
        let replaced = JSValue.object(long)
        DeckCards.resolverOverride = { $0 == "base:\u{59E5}" ? replaced : nil }
        Self.cleanups.append { DeckCards.resolverOverride = nil }
        return nil
    }
}

/// 夹具参数的读法（JS 参考里的 String(v) / 真值，只给 QAOps 用）。
enum QAJS {
    static func string(_ v: JSValue?) -> String {
        switch v {
        case .string(let s)?: return s
        case .number(let d)?: return d.rounded() == d && abs(d) < 1e15 ? String(Int64(d)) : String(d)
        case .bool(let b)?: return b ? "true" : "false"
        default: return ""
        }
    }

    static func truthy(_ v: JSValue?) -> Bool {
        switch v {
        case .bool(let b)?: return b
        case .number(let d)?: return d != 0 && !d.isNaN
        case .string(let s)?: return !s.isEmpty
        case .array?, .object?: return true
        case .null?, nil: return false
        }
    }
}
#endif
