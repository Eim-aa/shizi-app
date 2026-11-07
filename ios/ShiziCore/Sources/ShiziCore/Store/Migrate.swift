import Foundation

// 1:1 移植自原 JS 版（B4.4）：v1 → v2 转换（convertV1，纯函数）、读 v1 键（readV1）、v1 备份 → v2 备份（legacyBackupToV2）、
// 设备迁移（runMigration / bootMigration：一次不回收的 commit，核对 meta 后删旧大键）、P53 回退窗口（releaseLegacyKeys）。
// 转换规则逐条照 JS；报告、记录、调度项、墨迹的键序与 JS 相同。

public enum Migrate {
    /// v1 键（声明顺序同 JS V1_KEYS）。
    public static let v1Keys: [(name: String, key: String)] = [
        ("deck", "shizi.deck.v8105.context2"), ("opens", "shizi.opens.v1"), ("memory", "shizi.memory.v1"), ("quality", "shizi.quality.v1"),
        ("pref", "shizi.pref.v1"), ("tuning", "shizi.tuning.v1"), ("activity", "shizi.activity.v1"), ("session", "shizi.session.v1"),
        ("backupMeta", "shizi.backupMeta.v1"), ("reminder", "shizi.reminder.v1"), ("safety", "shizi.safety.v1"), ("fsrsLog", "shizi.fsrsReviewLog.v1"),
        ("traceTutorial", "shizi.traceTutorial.v1"), ("fontScale", "shizi.fontScale.v1"), ("funnel", "shizi.funnel.v1"), ("sound", "shizi.sound.v1"),
        ("topic", "shizi.topic.v1"), ("custom", "shizi.custom.v1"), ("added", "shizi.added.v1"), ("wild", "shizi.wild.v1"),
        ("handCard", "shizi.handCard.v1"), ("library", "shizi.library.v1"),
    ]
    public static func v1Key(_ name: String) -> String { v1Keys.first { $0.name == name }!.key }
    public static var bigKeys: [String] { [v1Key("session"), v1Key("safety")] }
    public static var detectKey: String { v1Key("memory") }
    public static let label = "migrate:v1"
    public static let reportVersion = 1.0

    static func nameOfKey(_ key: String) -> String? { v1Keys.first { UTF16Order.eq($0.key, key) }?.name }

    static let wildPhotoMax = 30
    static let wildPhotoBudget = 420.0 * 1024
    static let wildPhotoMaxBytes = 64.0 * 1024
    static let legacyLibraryIds: [String: String] = ["primary": "curriculum2500", "junior": "core3500", "senior": "adv3000"]
    static var libraryIds: [String] { CardRules.libraries.map { $0.id } }
    static let hintedAsOptions = ["none", "correct", "wrong"]

    static func isPlain(_ v: JSValue?) -> Bool { if case .object? = v { return true }; return false }
    /// 旧版 isCJK（/[一-鿿]/：任一 UTF-16 码元在 U+4E00–U+9FFF）。
    static func isCJK(_ s: String) -> Bool { s.utf16.contains { $0 >= 0x4E00 && $0 <= 0x9FFF } }
    static func finitePos(_ x: Double) -> Bool { x.isFinite && x > 0 }
    static func finitePos(_ v: JSValue?) -> Bool { if case .number(let d)? = v { return finitePos(d) }; return false }

    // MARK: 读 v1 键

    static func shapeOK(_ name: String, _ v: JSValue) -> Bool {
        switch name {
        case "memory":
            guard case .object(let o) = v else { return false }
            return o.entries.allSatisfy { isPlain($0.value) }
        case "quality", "wild": return isPlain(v)
        case "activity", "backupMeta", "reminder", "sound": return v.isNull || isPlain(v)
        case "fsrsLog":
            if case .array = v { return true }
            if case .object(let o) = v, case .array? = o["events"] { return true }
            return false
        case "fontScale": if case .bool = v { return true }; return false
        case "custom":
            guard case .array(let a) = v else { return false }
            return a.allSatisfy { $0.stringValue != nil }
        case "added":
            if v.isNull { return true }
            guard case .array(let a) = v else { return false }
            return a.allSatisfy { $0.stringValue != nil }
        case "library": if case .string = v { return true }; return v.isNull || isPlain(v)
        default: return true
        }
    }

    /// v1 原始字串表 → {ok:true, values, present, bad} | {ok:false, reason, key?}。
    public static func readV1(_ data: JSValue, strict: Bool = false) -> JSValue {
        guard case .object(let d) = data else { return .object(JSObject([("ok", .bool(false)), ("reason", .string("format"))])) }
        var values = JSObject()
        var present: [String] = []
        var bad: [String] = []
        for (key, raw) in d.entries {
            guard let name = nameOfKey(key) else { continue }
            if raw.isNull { continue }
            present.append(key)
            var value: JSValue = .null
            var ok = false
            if case .string(let text) = raw, let v = try? JSONParser.parse(text) {
                value = v
                ok = shapeOK(name, v)
            }
            if !ok {
                if strict {
                    return .object(JSObject([("ok", .bool(false)), ("reason", .string(raw.stringValue != nil ? "shape" : "value")), ("key", .string(key))]))
                }
                bad.append(key)
                continue
            }
            values[name] = value
        }
        return .object(JSObject([("ok", .bool(true)), ("values", .object(values)), ("present", .array(UTF16Order.sorted(present).map { .string($0) })),
                                 ("bad", .array(UTF16Order.sorted(bad).map { .string($0) }))]))
    }

    // MARK: 小工具

    /// v1 卡键 → base:<字> / custom:<字>；旧 custom:<n>:<字> 收敛；legacy:* 与其他丢弃。
    public static func canonicalCardKey(_ raw: JSValue?) -> String? {
        guard case .string(let s)? = raw, UTF16Order.length(s) <= 80 else { return nil }
        var prefix = ""
        for p in ["base:", "custom:"] where UTF16Order.hasPrefix(s, p) { prefix = p }
        if prefix.isEmpty { return nil }
        let rest = Array(s.utf16.dropFirst(prefix.utf16.count))
        var candidate = rest
        var i = 0
        while i < rest.count, rest[i] >= 0x30, rest[i] <= 0x39 { i += 1 }
        if i > 0, i < rest.count, rest[i] == 0x3A, i + 1 < rest.count { candidate = Array(rest[(i + 1)...]) }
        if candidate.isEmpty { return nil }
        let ch = String(decoding: candidate, as: UTF16.self)
        guard Schema.isSingleChar(ch), UTF16Order.length(ch) <= 2 else { return nil }
        return String(prefix.dropLast()) + ":" + ch
    }

    static func charOfKey(_ key: String) -> String {
        guard let i = key.firstIndex(of: ":") else { return key }
        return String(key[key.index(after: i)...])
    }

    static func clampHints(_ n: JSValue?) -> Double {
        let x = JS.numberOr0(n).rounded(.down)
        return JSMath.max(0, JSMath.min(Schema.hintsShapeMax, x))
    }

    static func isoMs(_ v: JSValue?, _ dates: Dates) -> Double? {
        guard case .string(let s)? = v, UTF16Order.length(s) <= 40 else { return nil }
        let ms = JSDate.parse(s, dates.timeZone)
        return ms.isFinite ? ms : nil
    }

    static func base64Bytes(_ dataURL: String) -> Double {
        let parts = dataURL.split(separator: ",", omittingEmptySubsequences: false)
        let raw = parts.count > 1 ? String(parts[1]) : ""
        let padding = raw.utf16.reversed().prefix { $0 == 0x3D }.count
        return max(0, (Double(UTF16Order.length(raw) * 3) / 4).rounded(.down) - Double(padding))
    }

    static func newReport(_ source: String) -> JSObject {
        func counts(_ names: [String]) -> JSValue { .object(JSObject(names.map { ($0, JSValue.number(0)) })) }
        return JSObject([
            ("version", .number(reportVersion)), ("source", .string(source)),
            ("events", counts(["total", "correct", "wrong", "answerSeen", "uncertain", "hintedWithHints", "other", "badKey", "duplicate"])),
            ("hintedAs", .string("none")),
            ("synthesized", counts(["correct", "wrong", "answerSeen", "hinted", "fromLastReview", "addedOnly", "unknown"])),
            ("records", counts(["total", "judged", "chars"])),
            ("sched", counts(["kept", "droppedNoJudged", "badCard", "spread"])),
            ("ink", .object(JSObject([("enabled", .bool(false)), ("migrated", .number(0)), ("skipped", .number(0))]))),
            ("photos", counts(["kept", "evicted", "wishesDropped"])),
            ("custom", .number(0)), ("wordOff", .number(0)), ("days", .number(0)), ("settings", .array([])),
            ("dropped", .object(JSObject([("soundScene", .bool(false)), ("keys", .array([]))]))), ("badKeys", .array([])),
        ])
    }

    /// 报告里的计数 +1（report[group][name]）。
    static func bump(_ report: inout JSObject, _ group: String, _ name: String, by n: Double = 1) {
        var g = report[group]!.objectValue!
        g[name] = .number((g[name]?.numberValue ?? 0) + n)
        report[group] = .object(g)
    }

    static func setIn(_ report: inout JSObject, _ group: String, _ name: String, _ v: JSValue) {
        var g = report[group]!.objectValue!
        g[name] = v
        report[group] = .object(g)
    }

    /// 两个旧键收敛到同一 cardKey 时合并 memory 行。
    static func mergeRows(_ a: JSObject?, _ b: JSObject) -> JSObject {
        guard let a = a else { return b }
        let newerIsB = JS.numberOr0(b["last"]) >= JS.numberOr0(a["last"])
        let newer = newerIsB ? b : a, older = newerIsB ? a : b
        var out = older
        for (k, v) in newer.entries { out[k] = v }
        for k in ["seen", "fast", "slow", "hints", "misses", "streak"] where a[k] != nil || b[k] != nil {
            out[k] = .number(JSMath.max(JS.numberOr0(a[k]), JS.numberOr0(b[k])))
        }
        return out
    }

    // MARK: 摊开到期日（D65 #2）

    /// 每天至多摊几个：round(groupSize × migration.spreadDuePerDayShare)；没配 → 0。
    public static func spreadPerDayOf(_ policy: JSValue = Config.policy) -> Double {
        let share = policy["migration"].map { JS.number($0["spreadDuePerDayShare"]) } ?? 0
        let size: Double = { if case .number(let d)? = policy["groupSize"], d.isFinite, d.rounded(.towardZero) == d { return d }; return 0 }()
        if !(share > 0) || !(size > 0) { return 0 }
        return JSMath.max(1, Dates.jsRound(size * share))
    }

    public static func spreadLegacyDue(_ sched: JSValue?, today: String, perDay: Double, dates: Dates) throws -> (sched: JSObject, moved: Int) {
        try ScheduleRules(dates: dates).spreadDue(sched, today: today, perDay: perDay)
    }

    /// serializeCard（v1 卡对象 → CompactCard）。
    static func serializeCard(_ card: JSValue, _ rules: ScheduleRules) throws -> JSValue {
        guard case .object(let c) = card else { throw CoreError.type("serializeCard expects a card object") }
        func n(_ k: String) -> JSValue { .number(JS.numberOr0(c[k])) }
        return JS.obj([
            ("due", try rules.isoOrNull(c["due"])), ("stability", n("stability")), ("difficulty", n("difficulty")), ("elapsed_days", n("elapsed_days")),
            ("scheduled_days", n("scheduled_days")), ("learning_steps", n("learning_steps")), ("reps", n("reps")), ("lapses", n("lapses")),
            ("state", n("state")), ("last_review", try rules.isoOrNull(c["last_review"])),
        ])
    }

    // MARK: 转换（纯函数）

    public struct Converted {
        public let state: JSObject
        public let report: JSObject
        public let serial: Double
    }

    /// 解析后的 v1 值 → v2 各域（不含 sessions / funnel / safety）。idFor：第 i 条记录的 id（缺省 r1, r2 …）。
    public static func convertV1(_ values: JSValue?, now: Double, dueBase: Double? = nil, source: String = "device", present: [String] = [], bad: [String] = [],
                                 idFor: ((Int) throws -> String)? = nil, policy: JSValue = Config.policy, dates: Dates) throws -> Converted {
        guard now.isFinite else { throw CoreError.type("convertV1 needs opts.now (ms)") }
        let v = values?.objectValue ?? JSObject()
        let mig = policy["migration"]?.objectValue ?? JSObject()
        let hintedAs: String = { if case .string(let s)? = mig["legacyHintedAs"], hintedAsOptions.contains(s) { return s }; return "none" }()
        let synthesize = mig["synthesizeFromMemory"] != .bool(false)
        let withInk = policy["features"]?["perRecordInk"] == .bool(true)
        let rules = ScheduleRules(dates: dates)
        var report = newReport(source)
        report["hintedAs"] = .string(hintedAs)
        setIn(&report, "ink", "enabled", .bool(withInk))
        report["badKeys"] = .array(bad.map { .string($0) })
        var days = KeySet()
        func addDay(_ d: JSValue?) { if let d = d, Schema.isLocalDay(d), case .string(let s) = d { days.insert(s) } }

        // memory（按 v2 cardKey 收敛）
        var memory = KeyMap<JSObject>()
        if case .object(let mem)? = v["memory"] {
            for (rawKey, row) in mem.entries {
                guard let key = canonicalCardKey(.string(rawKey)), case .object(let r) = row else { continue }
                memory[key] = mergeRows(memory[key], r)
            }
        }

        // 事件 → 待定记录
        struct Pending { var cardKey: String, at: Double, localDay: String, kind: String, judgment: String?, help: JSObject, order: Int }
        var pending: [Pending] = []
        var order = 0
        func push(_ p: Pending) {
            var q = p
            q.order = order
            order += 1
            pending.append(q)
        }
        let log = v["fsrsLog"]
        let rawEvents: [JSValue] = { if case .array(let a)? = log { return a }; if case .array(let a)? = log?["events"], isPlain(log) { return a }; return [] }()
        let monthly = log?["monthly"].flatMap { isPlain($0) && isPlain(log) ? $0.objectValue : nil } ?? JSObject()
        var withEvents = KeySet()
        var seenIds = KeySet()
        struct Ev { let cardKey: String, at: Double, localDay: String, rating: String, reason: String, hintCount: Double, traced: Bool }
        var events: [Ev] = []
        for e in rawEvents {
            bump(&report, "events", "total")
            guard case .object(let o) = e else { bump(&report, "events", "badKey"); continue }
            let cardKey = canonicalCardKey(o["cardKey"])
            let at = isoMs(o["reviewedAt"], dates)
            guard let ck = cardKey, let t = at, let ld = o["localDay"], Schema.isLocalDay(ld), case .string(let day) = ld else {
                bump(&report, "events", "badKey")
                continue
            }
            if case .string(let id)? = o["eventId"], !id.isEmpty {
                if seenIds.contains(id) {
                    bump(&report, "events", "duplicate")
                    continue
                }
                seenIds.insert(id)
            }
            events.append(Ev(cardKey: ck, at: t, localDay: day, rating: o["rating"] == .string("Good") ? "Good" : "Again", reason: o["reason"]?.stringValue ?? "",
                             hintCount: JSMath.max(0, JS.numberOr0(o["hintCount"]).rounded(.down)), traced: o["traced"] == .bool(true)))
        }
        events = events.jsSorted { $0.at - $1.at }
        for e in events {
            withEvents.insert(e.cardKey)
            addDay(.string(e.localDay))
            var help = JSObject([("hints", .number(clampHints(.number(e.hintCount)))), ("answerSeen", .bool(false)), ("traced", .bool(e.traced))])
            if e.rating == "Good" {
                push(Pending(cardKey: e.cardKey, at: e.at, localDay: e.localDay, kind: "judged", judgment: "correct", help: help, order: 0))
                bump(&report, "events", "correct")
            } else if e.reason == "wrong" {
                push(Pending(cardKey: e.cardKey, at: e.at, localDay: e.localDay, kind: "judged", judgment: "wrong", help: help, order: 0))
                bump(&report, "events", "wrong")
            } else if e.reason == "dontKnow" {
                help["answerSeen"] = .bool(true)
                push(Pending(cardKey: e.cardKey, at: e.at, localDay: e.localDay, kind: "answer-seen", judgment: nil, help: help, order: 0))
                bump(&report, "events", "answerSeen")
            } else if e.reason == "hinted" && e.hintCount == 0 {
                bump(&report, "events", "uncertain")
            } else if e.reason == "hinted" {
                bump(&report, "events", "hintedWithHints")
                if hintedAs != "none" { push(Pending(cardKey: e.cardKey, at: e.at, localDay: e.localDay, kind: "judged", judgment: hintedAs, help: help, order: 0)) }
            } else {
                bump(&report, "events", "other")
            }
        }

        // 有 memory 无事件的字：合成（P35）
        for (key, m) in memory.entries {
            if withEvents.contains(key) || !(JS.number(m["seen"]) > 0) { continue }
            if !synthesize { continue }
            let addArtifact = m["queuedFront"] == .bool(true)
            var outcome: JSValue? = m["lastOutcome"]
            var at = JS.number(m["last"])
            if addArtifact || (outcome == .string("miss") && !isPlain(m["fsrsCard"])) {
                let lastReview = isPlain(m["fsrsCard"]) ? isoMs(m["fsrsCard"]?["last_review"], dates) : nil
                guard let lr = lastReview else {
                    bump(&report, "synthesized", "addedOnly")
                    continue
                }
                let ep = isPlain(m["lastEpisode"]) ? m["lastEpisode"] : nil
                outcome = ep.map { $0["independentlyRecovered"] == .bool(true) ? .string("fast") : ($0["firstOutcome"] ?? nil) } ?? .null
                at = lr
                bump(&report, "synthesized", "fromLastReview")
            }
            if !finitePos(at) {
                bump(&report, "synthesized", "unknown")
                continue
            }
            let day = try dates.calendarDay(.number(at))
            var help = JSObject([("hints", .number(clampHints(m["lastHints"]))), ("answerSeen", .bool(false)), ("traced", .bool(m["traced"] == .bool(true)))])
            switch outcome {
            case .string("fast")?:
                push(Pending(cardKey: key, at: at, localDay: day, kind: "judged", judgment: "correct", help: help, order: 0))
                bump(&report, "synthesized", "correct")
            case .string("slow")?:
                push(Pending(cardKey: key, at: at, localDay: day, kind: "judged", judgment: "wrong", help: help, order: 0))
                bump(&report, "synthesized", "wrong")
            case .string("miss")?:
                help["answerSeen"] = .bool(true)
                push(Pending(cardKey: key, at: at, localDay: day, kind: "answer-seen", judgment: nil, help: help, order: 0))
                bump(&report, "synthesized", "answerSeen")
            case .string("hinted")?:
                bump(&report, "synthesized", "hinted")
                if hintedAs != "none" { push(Pending(cardKey: key, at: at, localDay: day, kind: "judged", judgment: hintedAs, help: help, order: 0)) }
            default:
                bump(&report, "synthesized", "unknown")
                continue
            }
            addDay(.string(day))
        }

        // 记录：按时间先后分配 id、按 localDay 月份分键
        pending = pending.jsSorted { a, b in
            let d = a.at - b.at
            return d != 0 && !d.isNaN ? d : Double(a.order - b.order)
        }
        var records = JSObject()
        var flat: [JSObject] = []
        for (i, p) in pending.enumerated() {
            let id = try idFor?(i) ?? ("r" + String(i + 1))
            var rec = JSObject([("id", .string(id)), ("cardKey", .string(p.cardKey)), ("char", .string(charOfKey(p.cardKey))), ("kind", .string(p.kind))])
            if p.kind == "judged" { rec["judgment"] = .string(p.judgment!) }
            rec["at"] = .number(p.at)
            rec["localDay"] = .string(p.localDay)
            rec["help"] = .object(p.help)
            rec["legacy"] = .bool(true)
            let month = Schema.monthOfDay(p.localDay)
            var list = records[month]?.arrayValue ?? []
            list.append(.object(rec))
            records[month] = .array(list)
            flat.append(rec)
        }
        var lastJudged = KeyMap<JSObject>()
        var lastCorrect = KeyMap<JSObject>()
        for rec in flat where rec["kind"] == .string("judged") {
            let ck = rec["cardKey"]!.stringValue!
            lastJudged[ck] = rec
            if rec["judgment"] == .string("correct") { lastCorrect[ck] = rec }
        }
        setIn(&report, "records", "total", .number(Double(flat.count)))
        setIn(&report, "records", "judged", .number(Double(flat.filter { $0["kind"] == .string("judged") }.count)))
        setIn(&report, "records", "chars", .number(Double(lastJudged.count)))

        // sched（不变式：sched 存在 ⇒ 有 judged 记录）
        let today = try dates.localDay(.number(dueBase.flatMap { $0.isFinite ? $0 : nil } ?? now))
        var sched = JSObject()
        for (key, m) in memory.entries {
            guard let card = m["fsrsCard"], isPlain(card) else { continue }
            let fsrs = try? serializeCard(card, rules)
            guard let f = fsrs, rules.isCompactCard(f) else {
                bump(&report, "sched", "badCard")
                continue
            }
            guard let lj = lastJudged[key] else {
                bump(&report, "sched", "droppedNoJudged")
                continue
            }
            let cardDue = try dates.calendarDay(.number(JSDate.parse(f["due"]!.stringValue!, dates.timeZone)))
            let due: String
            if m["queuedFront"] == .bool(true) { due = cardDue } else if m["pendingLearning"] == .bool(true) { due = try dates.addDays(.string(today), 1) } else if let dd = m["dueDay"], Schema.isLocalDay(dd), case .string(let s) = dd { due = s } else { due = cardDue }
            sched[key] = .object(JSObject([("fsrs", f), ("due", .string(due)), ("lastJudgedAt", lj["at"]!)]))
            bump(&report, "sched", "kept")
        }
        let perDay = spreadPerDayOf(policy)
        if perDay > 0 {
            let spread = try spreadLegacyDue(.object(sched), today: today, perDay: perDay, dates: dates)
            sched = spread.sched
            setIn(&report, "sched", "spread", .number(Double(spread.moved)))
        }
        let schedV: JSValue = sched.isEmpty ? .null : .object(sched)

        // 墨迹（P31）
        var ink = JSObject()
        let inkBase = InkParams.standard.base
        for (key, m) in memory.entries {
            guard case .object(let recent)? = m["recentInk"], case .array(let strokesV)? = recent["strokes"], !strokesV.isEmpty else { continue }
            guard withInk, let target = lastCorrect[key] else {
                bump(&report, "ink", "skipped")
                continue
            }
            var strokes: [[InkPoint]] = []
            for s in strokesV {
                guard case .array(let pts) = s else { continue }
                var out: [InkPoint] = []
                for p in pts {
                    guard case .object(let po) = p, case .number(let x)? = po["x"], x.isFinite, case .number(let y)? = po["y"], y.isFinite else { continue }
                    let w: Double = { if case .number(let w)? = po["w"], w.isFinite { return w }; return 1 }()
                    out.append(InkPoint(x: x * InkMath.grid, y: y * InkMath.grid, w: w * inkBase, order: ["x", "y", "w"]))
                }
                if !out.isEmpty { strokes.append(out) }
            }
            if strokes.isEmpty {
                bump(&report, "ink", "skipped")
                continue
            }
            let month = Schema.monthOfDay(target["localDay"]!.stringValue!)
            var table = ink[month]?.objectValue ?? JSObject()
            table[target["id"]!.stringValue!] = try InkMath.encodeInk(strokes, options: InkMath.EncodeOptions(policy: policy.objectValue))
            ink[month] = .object(table)
            bump(&report, "ink", "migrated")
        }

        // 照片（沿旧预算）
        var photos = JSObject()
        let wild = v["wild"]?.objectValue ?? JSObject()
        let captures = wild["captures"]?.objectValue ?? JSObject()
        struct Row { let ch: String, at: Double, day: String, dataURL: String, bytes: Double }
        var rows: [Row] = []
        for (ch, row) in captures.entries {
            guard case .object(let r) = row, case .string(let dataURL)? = r["dataURL"], !dataURL.isEmpty else { continue }
            let okChar = Schema.isSingleChar(ch) && UTF16Order.length(ch) <= 2 && isCJK(ch)
            let okImage = (UTF16Order.hasPrefix(dataURL, "data:image/webp;base64,") || UTF16Order.hasPrefix(dataURL, "data:image/jpeg;base64,")) && base64Bytes(dataURL) <= wildPhotoMaxBytes
            if !okChar || !okImage {
                bump(&report, "photos", "evicted")
                continue
            }
            let atN = JS.number(r["at"])
            let at = finitePos(atN) ? atN : now
            let day: String = { if let d = r["day"], Schema.isLocalDay(d), case .string(let s) = d { return s }; return (try? dates.calendarDay(.number(at))) ?? "" }()
            rows.append(Row(ch: ch, at: at, day: day, dataURL: dataURL, bytes: Double(UTF16Order.length(dataURL) * 2)))
        }
        rows = rows.jsSorted { a, b in
            let d = b.at - a.at
            return d != 0 && !d.isNaN ? d : (UTF16Order.less(a.ch, b.ch) ? -1 : 1)
        }
        var photoBytes = 0.0
        var keptPhotos = 0
        for row in rows {
            if keptPhotos < wildPhotoMax && photoBytes + row.bytes <= wildPhotoBudget {
                photos[row.ch] = .object(JSObject([("day", .string(row.day)), ("at", .number(row.at)), ("dataURL", .string(row.dataURL))]))
                photoBytes += row.bytes
                keptPhotos += 1
                bump(&report, "photos", "kept")
            } else {
                bump(&report, "photos", "evicted")
            }
        }
        setIn(&report, "photos", "wishesDropped", .number(Double(wild["wishes"]?.objectValue?.count ?? 0)))
        let photosV: JSValue = keptPhotos == 0 ? .null : .object(photos)

        // 自选的字
        var addedChars: [JSValue]? = v["added"]?.arrayValue
        if addedChars == nil, case .array(let words)? = v["custom"] {
            addedChars = words.flatMap { w -> [JSValue] in
                JS.string(w).unicodeScalars.map { String($0) }.filter { isCJK($0) }.map { .string($0) }
            }
        }
        var custom: JSValue = .null
        if let list = addedChars, !list.isEmpty {
            var added: [JSValue] = []
            var seen = KeySet()
            for raw in list {
                let ch = raw.stringValue ?? ""
                if !Schema.isSingleChar(ch) || UTF16Order.length(ch) > 2 || !isCJK(ch) || seen.contains(ch) { continue }
                seen.insert(ch)
                let m = memory["base:" + ch] ?? memory["custom:" + ch]
                let qa = JS.number(m?["queuedFrontAt"]), fs = JS.number(m?["firstSeenAt"])
                let at = m != nil && finitePos(qa) ? qa : m != nil && finitePos(fs) ? fs : now
                added.append(.object(JSObject([("char", .string(ch)), ("at", .number(at))])))
            }
            if !added.isEmpty { custom = .object(JSObject([("added", .array(added))])) }
        }
        report["custom"] = .number(Double(custom["added"]?.arrayValue?.count ?? 0))

        // 停用的词语
        var wordOff = JSObject()
        if case .object(let q)? = v["quality"] {
            for (rawKey, row) in q.entries {
                guard let key = canonicalCardKey(.string(rawKey)), case .object(let r) = row, JSX.truthy(r["badWord"]) || r["hide"] == .bool(true) else { continue }
                let last = JS.number(r["last"])
                wordOff[key] = .number(finitePos(last) ? last : now)
            }
        }
        report["wordOff"] = .number(Double(wordOff.count))
        let wordOffV: JSValue = wordOff.isEmpty ? .null : .object(wordOff)

        // 设置
        var settings = JSObject()
        if let lib = v["library"], !lib.isNull {
            let stored: JSValue = isPlain(lib) ? (lib["id"] ?? .null) : lib
            let mapped: JSValue = { if case .string(let s) = stored, let m = legacyLibraryIds[s] { return .string(m) }; return stored }()
            if case .string(let id) = mapped, libraryIds.contains(where: { UTF16Order.eq($0, id) }) { settings["library"] = .string(id) }
        }
        if case .object(let sound)? = v["sound"] {
            settings["sound"] = .bool(sound["enabled"] != .bool(false))
            if sound["scene"] != nil { setIn(&report, "dropped", "soundScene", .bool(true)) }
        }
        if case .object(let rem)? = v["reminder"] {
            let perm = rem["permission"]
            let p: String = perm == .string("granted") || perm == .string("denied") ? perm!.stringValue! : "unknown"
            settings["remind"] = .object(JSObject([("enabled", .bool(rem["enabled"] == .bool(true))), ("permission", .string(p))]))
        }
        if case .bool(let b)? = v["fontScale"] { settings["large"] = .bool(b) }
        let settingKeys = UTF16Order.sorted(settings.keys)
        report["settings"] = .array(settingKeys.map { .string($0) })

        // 上次导出
        var backupMeta: JSValue = .null
        if case .object(let bm)? = v["backupMeta"], finitePos(JS.number(bm["lastExportAt"])) {
            backupMeta = .object(JSObject([("lastExportAt", .number(JS.number(bm["lastExportAt"]))), ("lastExportSig", .null)]))
        }

        // 练习日
        let activity = v["activity"]?.objectValue ?? JSObject()
        if case .array(let pd)? = activity["practiceDays"] { pd.forEach { addDay($0) } }
        for (_, row) in monthly.entries {
            if case .object(let r) = row, case .object(let lr)? = r["lastReviewByDay"] { lr.keys.forEach { addDay(.string($0)) } }
        }
        let dayList = UTF16Order.sorted(days.items)
        report["days"] = .number(Double(dayList.count))

        let known = Set(["memory", "fsrsLog", "wild", "added", "custom", "quality", "library", "sound", "reminder", "fontScale", "backupMeta", "activity"])
        setIn(&report, "dropped", "keys", .array(present.filter { !known.contains(nameOfKey($0) ?? "") }.map { .string($0) }))

        let legacy = JSObject([("importedAt", .number(now)), ("fromKeys", .array(present.map { .string($0) })), ("days", .array(dayList.map { .string($0) })), ("report", .object(report))])
        let serial = flat.reduce(0.0) { m, r in
            let id = r["id"]!.stringValue!
            let n = JS.numberOr0(.string(String(id.unicodeScalars.dropFirst().map { Character($0) })))
            return JSMath.max(m, n)
        }
        let meta = JSObject([("schema", .number(Double(Schema.schemaVersion))), ("serial", .number(serial)), ("createdAt", .number(now)),
                             ("months", .array(UTF16Order.sorted(records.keys).map { .string($0) }))])
        let state = JSObject([
            ("meta", .object(meta)), ("records", .object(records)), ("sched", schedV), ("ink", .object(ink)), ("custom", custom), ("wordOff", wordOffV),
            ("settings", settingKeys.isEmpty ? .null : .object(settings)), ("photos", photosV), ("legacy", .object(legacy)), ("backupMeta", backupMeta),
        ])
        return Converted(state: state, report: report, serial: serial)
    }

    static func hasV2Records(_ state: JSObject) -> Bool {
        let records = state["records"]?.objectValue ?? JSObject()
        return !records.isEmpty || !(state["sched"]?.objectValue?.isEmpty ?? true)
    }

    // MARK: v1 备份 → v2 备份

    /// {ok:true, backup, report} | {ok:false, reason, key?}。
    public static func legacyBackupToV2(_ obj: JSValue, now: Double? = nil, policy: JSValue = Config.policy, dates: Dates = Dates(timeZone: .current)) -> JSValue {
        let nowMs = now ?? Date().timeIntervalSince1970 * 1000
        guard case .object(let o) = obj, JS.isString(o["app"], Schema.appID), o["version"] == .number(1), let data = o["data"], isPlain(data) else {
            return .object(JSObject([("ok", .bool(false)), ("reason", .string("format"))]))
        }
        let read = readV1(data, strict: true)
        if read["ok"] != .bool(true) { return read }
        let present = (read["present"]?.arrayValue ?? []).compactMap { $0.stringValue }
        if present.isEmpty { return .object(JSObject([("ok", .bool(false)), ("reason", .string("empty"))])) }
        let date = isoMs(o["date"], dates)
        do {
            let conv = try convertV1(read["values"], now: nowMs, dueBase: date ?? nowMs, source: "backup", present: present, bad: [], policy: policy, dates: dates)
            var backup = try Backup.buildBackupV2(conv.state, now: date ?? nowMs, serial: conv.serial)
            if case .string? = o["date"], date != nil { backup["date"] = o["date"]! }
            return .object(JSObject([("ok", .bool(true)), ("backup", .object(backup)), ("report", .object(conv.report))]))
        } catch {
            return .object(JSObject([("ok", .bool(false)), ("reason", .string("v1-failed"))]))
        }
    }

    // MARK: 设备迁移

    /// 本机 v1 键 → {key: raw}。
    public static func readDeviceV1(_ storage: StoreStorage) throws -> JSObject {
        var out = JSObject()
        for (_, key) in v1Keys {
            if let raw = try storage.read(key) { out[key] = .string(raw) }
        }
        return out
    }

    public static func detectV1(_ storage: StoreStorage) throws -> Bool { try storage.read(detectKey) != nil }

    /// v1 时代的隔离坏值（shizi.corrupt.<原键>，原键不是 v2 键）。
    public static func legacyCorruptKeys(_ storage: StoreStorage) throws -> [String] {
        try storage.listKeys(Schema.corruptPrefix).filter { !UTF16Order.hasPrefix(String($0.utf16.dropFirst(Schema.corruptPrefix.utf16.count)) ?? "", Schema.v2Prefix) }
    }

    @discardableResult
    public static func dropBigLegacyKeys(_ storage: StoreStorage) throws -> [String] {
        let keys = try bigKeys.filter { try storage.read($0) != nil } + legacyCorruptKeys(storage)
        return keys.isEmpty ? [] : try storage.removeKeys(keys)
    }

    /// 执行一次迁移（调用方已确认：没有 v2.meta、有 v1 数据）。
    public static func runMigration(_ store: Store, now at: Double, policy: JSValue = Config.policy) throws -> JSValue {
        let storage = store.storage
        let read = readV1(.object(try readDeviceV1(storage)), strict: false)
        if hasV2Records(store.state) {
            return .object(JSObject([("ok", .bool(true)), ("action", .string("skipped")), ("reason", .string("v2-records"))]))
        }
        let present = (read["present"]?.arrayValue ?? []).compactMap { $0.stringValue }
        let bad = (read["bad"]?.arrayValue ?? []).compactMap { $0.stringValue }
        var report = JSObject()
        let result = store.commit(label, reclaim: false, replace: true) { draft, ctx in
            var c = ctx
            let conv = try convertV1(read["values"], now: at, source: "device", present: present, bad: bad, idFor: { _ in try c.nextId("r") }, policy: policy, dates: store.dates)
            ctx = c
            report = conv.report
            let s = conv.state
            draft["records"] = s["records"]
            draft["ink"] = s["ink"]
            for d in ["sched", "custom", "wordOff", "settings", "photos", "backupMeta"] where draft[d] == nil || draft[d] == .null { draft[d] = s[d] }
            draft["legacy"] = s["legacy"]
            var meta = s["meta"]!.objectValue!
            meta["migratedAt"] = .number(at)
            draft["meta"] = .object(meta)
            var funnel = draft["funnel"]?.objectValue ?? JSObject()
            func n(_ g: String, _ k: String) -> Double { report[g]?[k]?.numberValue ?? 0 }
            funnel["legacyImport"] = .object(JSObject([
                ("at", .number(at)), ("records", .number(n("records", "total"))), ("judged", .number(n("records", "judged"))), ("chars", .number(n("records", "chars"))),
                ("uncertain", .number(n("events", "uncertain"))), ("hintedWithHints", .number(n("events", "hintedWithHints"))),
                ("synthesized", .number(n("synthesized", "correct") + n("synthesized", "wrong") + n("synthesized", "answerSeen"))),
                ("schedDropped", .number(n("sched", "droppedNoJudged"))), ("photosEvicted", .number(n("photos", "evicted"))),
            ]))
            draft["funnel"] = .object(funnel)
        }
        if result["ok"] != .bool(true) { return .object(JSObject([("ok", .bool(false)), ("error", result["error"] ?? .null)])) }
        var metaOk = false
        if let raw = try? storage.read(Schema.metaKey), let meta = try? JSONParser.parse(raw) {
            metaOk = JSX.truthy(meta) && JS.strictEquals(meta["migratedAt"], .number(at))
        }
        var removed: [String] = []
        if metaOk { removed = (try? dropBigLegacyKeys(storage)) ?? [] }
        return .object(JSObject([("ok", .bool(true)), ("action", .string("migrated")), ("report", .object(report)), ("removed", .array(removed.map { .string($0) })), ("metaVerified", .bool(metaOk))]))
    }

    /// P53 回退窗口：满 retentionDays 天或起点之后导出过一次 v2 → 删其余 v1 键；残留大键无条件删。
    public static func releaseLegacyKeys(_ store: Store, now at: Double, policy: JSValue = Config.policy) throws -> JSObject {
        let storage = store.storage
        var out = JSObject([("released", .array([])), ("big", .array([]))])
        guard case .object(let meta)? = store.state["meta"] else { return out }
        let present = try v1Keys.map { $0.key }.filter { try storage.read($0) != nil }
        if present.isEmpty, try legacyCorruptKeys(storage).isEmpty { return out }
        out["big"] = .array(try dropBigLegacyKeys(storage).map { .string($0) })
        let mig = policy["migration"]?.objectValue ?? JSObject()
        let startV: Double = { if case .number(let d)? = meta["migratedAt"], d.isFinite { return d }; if case .number(let d)? = meta["createdAt"] { return d }; return .nan }()
        let days: Double = { if case .number(let d)? = mig["legacyKeyRetentionDays"], d.isFinite { return d }; return 30 }()
        var exportedAt: Double? = nil
        if let bm = store.state["backupMeta"], JSX.truthy(bm), case .number(let e)? = bm["lastExportAt"], e.isFinite { exportedAt = e }
        let expired = startV.isFinite && at - startV >= days * 86_400_000
        let exported = mig["legacyKeyReleaseOnExport"] == .bool(true) && exportedAt != nil && startV.isFinite && exportedAt! > startV
        if !expired && !exported { return out }
        let rest = present.filter { k in !bigKeys.contains { UTF16Order.eq($0, k) } }
        out["released"] = .array((rest.isEmpty ? [] : try storage.removeKeys(rest)).map { .string($0) })
        return out
    }

    /// 启动入口：不抛错。{ok:true, action:'none'|'migrated'|'skipped'|'disabled'|'unavailable', …} | {ok:false, error:{kind, reason}}。
    public static func bootMigration(_ store: Store?, now: () -> Double, policy: JSValue = Config.policy) -> JSValue {
        guard let s = store else { return .object(JSObject([("ok", .bool(true)), ("action", .string("unavailable"))])) }
        do {
            if !s.available || s.blocked != nil { return .object(JSObject([("ok", .bool(true)), ("action", .string("unavailable"))])) }
            if let m = s.state["meta"], JSX.truthy(m) {
                var out = JSObject([("ok", .bool(true)), ("action", .string("none"))])
                for (k, v) in try releaseLegacyKeys(s, now: now(), policy: policy).entries { out[k] = v }
                return .object(out)
            }
            if try !detectV1(s.storage) { return .object(JSObject([("ok", .bool(true)), ("action", .string("none"))])) }
            if policy["migration"]?["importLegacy"] != .bool(true) { return .object(JSObject([("ok", .bool(true)), ("action", .string("disabled"))])) }
            return try runMigration(s, now: now(), policy: policy)
        } catch {
            let e = error as? StoreJSError
            let kind = e?.kind ?? "exception"
            let reason = e?.messageOrString ?? Store.mutatorReason(error)
            return .object(JSObject([("ok", .bool(false)), ("error", .object(JSObject([("kind", .string(kind)), ("reason", .string(reason))])))]))
        }
    }
}
