import Foundation

// src/core/fsrs.js 的 1:1 移植（B4.2）：评级（D41 / D65 #4 / P34 / P126 / P127）、reviewCard（至少次日、时钟回拨夹到上次复习 D65 #3）、
// 看过答案记一次 Again（D66 ①，P321）、判断落定、更正重放（D19）、逾期 / 到期 / 可提取率。
// 输入输出都是 JS 形状的 JSValue（卡 = CompactCard、调度项 = {fsrs, due, lastJudgedAt, seenAgainDay?, stoppedAt?}），
// 键序、缺省 / null / undefined 的区别与 JS 一致，所以写出的 JSON 与 JS 逐字节相同。
// 库（ts-fsrs）参数读生成的 fsrs-config.json（= FSRS_CONFIG），不手抄。

/// 调度规则的上下文：时区（日期分界）+ 缺省 policy。各模块的函数挂在它的扩展上。
public struct ScheduleRules {
    public let dates: Dates
    public init(dates: Dates) { self.dates = dates }
    public init(timeZone: TimeZone) { dates = Dates(timeZone: timeZone) }

    public static let fsrsLibrary: FSRS6 = {
        let c = Config.fsrsConfig
        do {
            return try FSRS6(requestRetention: JS.number(c["requestRetention"]), maximumInterval: JS.number(c["maximumInterval"]),
                             enableFuzz: JS.truthy(c["enableFuzz"]))
        } catch { fatalError("ShiziCore fsrs-config: \(error)") }
    }()

    var lib: FSRS6 { ScheduleRules.fsrsLibrary }

    /// policy 的 dayStartHour 参数（policy 给了就照它的字段——缺字段 = undefined = 0 点；nil = 缺省 policy）。
    static func dayStart(_ policy: JSValue?) -> JSValue? {
        guard let p = policy else { return nil }
        if !JS.truthy(p) { return .number(0) }
        return p["dayStartHour"] ?? .null
    }
}

public struct ReviewResult: Equatable {
    public var card: JSValue
    public var due: String
    public var rating: String
    public var clockBackMs: Double?

    public var js: JSValue {
        var o = JSObject([("card", card), ("due", .string(due)), ("rating", .string(rating))])
        if let c = clockBackMs { o["clockBackMs"] = .number(c) }
        return .object(o)
    }
}

extension ScheduleRules {
    static let ratings = ["Again", "Hard", "Good"]
    static let firstRatings = ["Good", "Easy"]
    static let replayMarks = ["seenAgainDay", "seenBefore"]

    // MARK: 时间

    /// toMs：有限数 → 原值；能解析的字串 → 时刻；其余 TypeError。
    func toMs(_ v: JSValue?) throws -> Double {
        if case .number(let d)? = v, d.isFinite { return d }
        if case .string(let s)? = v {
            let ms = JSDate.parse(s, dates.timeZone)
            if ms.isFinite { return ms }
        }
        throw CoreError.type("invalid time value: " + JS.string(v))
    }

    func isoOrNull(_ v: JSValue?) throws -> JSValue {
        guard let v = v, !v.isNull else { return .null }
        return .string(try JSDate.isoString(try toMs(v)))
    }

    /// Date.parse(String(v))。
    func dateParse(_ v: JSValue?) -> Double { JSDate.parse(JS.string(v), dates.timeZone) }

    func localDayOf(_ ms: Double, policy: JSValue? = nil) throws -> String {
        try dates.localDay(.number(ms), dayStartHour: ScheduleRules.dayStart(policy))
    }

    // MARK: 卡的形状

    /// 库的卡 → CompactCard（serializeCard）。
    public func serializeCard(_ c: FSRSCard) throws -> JSValue {
        func n(_ x: Double) -> JSValue { .number(x.isNaN || x == 0 ? 0 : x) }
        let due = try JSDate.isoString(c.due)
        let lastReview: JSValue = try c.lastReview.map { .string(try JSDate.isoString($0)) } ?? .null
        return JS.obj([
            ("due", .string(due)),
            ("stability", n(c.stability)), ("difficulty", n(c.difficulty)), ("elapsed_days", n(c.elapsedDays)),
            ("scheduled_days", n(c.scheduledDays)), ("learning_steps", n(c.learningSteps)), ("reps", n(c.reps)), ("lapses", n(c.lapses)),
            ("state", n(c.state)), ("last_review", lastReview),
        ])
    }

    /// CompactCard 校验（isCompactCard）。
    public func isCompactCard(_ v: JSValue?) -> Bool {
        guard case .object(let o)? = v else { return false }
        guard case .string(let due)? = o["due"], JSDate.parse(due, dates.timeZone).isFinite else { return false }
        if let lr = o["last_review"], !lr.isNull {
            guard case .string(let s) = lr, JSDate.parse(s, dates.timeZone).isFinite else { return false }
        } else if o["last_review"] == nil {
            return false // undefined !== null 且不是字串
        }
        for k in ["stability", "difficulty", "elapsed_days", "scheduled_days", "learning_steps", "reps", "lapses", "state"] {
            guard case .number(let d)? = o[k], d.isFinite else { return false }
        }
        return true
    }

    /// 去掉给 replay 用的标记（seenAgainDay / seenBefore）。
    func stripMarks(_ card: JSValue?) throws -> JSValue? {
        guard let card = card, JS.truthy(card) else { return card }
        guard case .object(var o) = card else {
            if case .array = card { return card }
            throw CoreError.type("Cannot use 'in' operator to search for 'seenAgainDay' in " + JS.string(card))
        }
        if !ScheduleRules.replayMarks.contains(where: { o[$0] != nil }) { return card }
        for k in ScheduleRules.replayMarks { o[k] = nil }
        return .object(o)
    }

    /// TypeConvert.time。
    func libTime(_ v: JSValue?) throws -> Double {
        switch v {
        case .string(let s)?:
            let ms = JSDate.parse(s, dates.timeZone)
            if ms.isNaN { throw CoreError.error("Invalid date:[" + s + "]") }
            return ms
        case .number(let d)?:
            return JSDate.timeClip(d) ?? .nan
        default:
            throw CoreError.error("Invalid date:[" + JS.string(v) + "]")
        }
    }

    /// toLibraryCard + TypeConvert.card。
    func toLibraryCard(_ compact: JSValue) throws -> FSRSCard {
        let c = try stripMarks(compact) ?? .null
        let state: Double
        switch c["state"] {
        case .number(let d)?: state = d
        case .string(let s)?:
            let name = s.prefix(1).uppercased() + s.dropFirst().lowercased()
            guard let st = ["New": 0.0, "Learning": 1, "Review": 2, "Relearning": 3][name] else { throw CoreError.error("Invalid state:[" + s + "]") }
            state = st
        default: throw CoreError.error("Invalid state:[" + JS.string(c["state"]) + "]")
        }
        let due = try libTime(c["due"])
        let lr = c["last_review"]
        let lastReview: Double? = (lr != nil && !lr!.isNull && JS.truthy(lr)) ? try libTime(lr) : nil
        return FSRSCard(due: due, stability: JS.number(c["stability"]), difficulty: JS.number(c["difficulty"]), elapsedDays: JS.number(c["elapsed_days"]),
                        scheduledDays: JS.number(c["scheduled_days"]), learningSteps: JS.number(c["learning_steps"]), reps: JS.number(c["reps"]),
                        lapses: JS.number(c["lapses"]), state: state, lastReview: lastReview)
    }

    func libraryEmptyCard(_ at: Double) -> FSRSCard {
        FSRSCard(due: JSDate.timeClip(at) ?? .nan, stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0,
                 state: FSRSState.new.rawValue, lastReview: nil)
    }

    /// 新卡（在 at 时刻创建）。
    public func emptyCard(_ at: JSValue?) throws -> JSValue {
        try serializeCard(libraryEmptyCard(try toMs(at)))
    }

    // MARK: 评级

    /// ratingFor(judgment, help, policy, ctx)。
    public static func ratingFor(_ judgment: JSValue?, _ help: JSValue?, policy: JSValue = Config.policy, first: Bool = false, warmup: Bool = false) throws -> String {
        if JS.isString(judgment, "wrong") { return "Again" }
        if !JS.isString(judgment, "correct") { throw CoreError.range("judgment must be correct or wrong") }
        let hintsN = JS.truthy(help) ? JS.number(help?["hints"]) : 0
        let hints = hintsN > 0 ? hintsN : 0
        if hints == 0 {
            if warmup, JS.truthy(policy["warmup"]), JS.truthy(policy["warmup"]?["easyOnCorrect"]) { return "Easy" }
            if first {
                let f = policy["ratingFirstCorrect"]
                guard let v = f else { return "Good" }
                guard case .string(let s) = v, firstRatings.contains(where: { jsEq($0, s) }) else {
                    throw CoreError.range("unsupported policy.ratingFirstCorrect: " + JS.string(v))
                }
                return s
            }
            return "Good"
        }
        let r = hintedRating(policy["ratingWithHint"], hints, first)
        guard case .string(let s)? = r, ratings.contains(where: { jsEq($0, s) }) else {
            throw CoreError.range("unsupported policy.ratingWithHint: " + JS.string(r))
        }
        return s
    }

    static func hintedRating(_ cfg: JSValue?, _ hints: Double, _ first: Bool) -> JSValue? {
        if case .string? = cfg { return cfg }
        let listV = JS.truthy(cfg) ? (first ? cfg?["first"] : cfg?["review"]) : nil
        guard case .array(let list)? = listV, !list.isEmpty else { return .string(JS.string(cfg)) }
        let idx = jsMin(hints, Double(list.count)) - 1
        guard idx.rounded(.towardZero) == idx, idx >= 0, idx < Double(list.count) else { return nil }
        return list[Int(idx)]
    }

    static func isFirstReview(_ before: JSValue?) -> Bool {
        if let b = before, JS.truthy(b), b["seenBefore"] == .bool(true) { return false }
        guard let b = before, JS.truthy(b) else { return true }
        return JS.numberOr0(b["reps"]) == 0
    }

    // MARK: reviewCard / applyAnswerSeen / applyJudgment / replay

    /// 对一张卡做一次 review。warmup：nil = 按 review.cardKey 查热身清单。
    public func reviewCard(_ before: JSValue?, _ review: JSValue, policy: JSValue = Config.policy, warmup warmupOverride: Bool? = nil) throws -> ReviewResult {
        let at = try toMs(review["at"])
        let warmup = warmupOverride ?? (JS.truthy(review["cardKey"]) && NewOrder.isWarmupKey(review["cardKey"]))
        let rating = try ScheduleRules.ratingFor(review["judgment"], review["help"], policy: policy, first: ScheduleRules.isFirstReview(before), warmup: warmup)
        let beforeT = before.map { JS.truthy($0) } ?? false
        let start = beforeT ? try toLibraryCard(before!) : libraryEmptyCard(at)
        let last = beforeT && JS.truthy(before?["last_review"]) ? dateParse(before?["last_review"]) : .nan
        let clockBackMs = last.isFinite && at < last ? last - at : 0
        let reviewAt = clockBackMs != 0 ? last : at
        guard let grade = FSRSRating(name: rating) else { throw CoreError.error("Invalid rating") }
        let next = try lib.next(start, now: reviewAt, grade: grade)
        let card = try serializeCard(next)
        let today = try localDayOf(at)
        let tomorrow = try dates.addDays(today, 1)
        let fsrsDay = try localDayOf(try toMs(card["due"]))
        // D83 ③：写错 / 看了答案（judgment wrong）= 明天再来——FSRS 照记 Again（稳定度、难度照算），到期日夹到第二天（不错开）
        let due = JS.isString(review["judgment"], "wrong") ? tomorrow : (JSMath.lessThan(tomorrow, fsrsDay) ? fsrsDay : tomorrow)
        return ReviewResult(card: card, due: due, rating: rating, clockBackMs: clockBackMs != 0 ? clockBackMs : nil)
    }

    func reviewedOn(_ card: JSValue?, _ day: JSValue?, policy: JSValue) throws -> Bool {
        guard let c = card, JS.truthy(c), JS.truthy(c["last_review"]) else { return false }
        let ms = dateParse(c["last_review"])
        guard ms.isFinite else { return false }
        return JS.strictEquals(.string(try localDayOf(ms, policy: policy)), day)
    }

    /// 看过答案要不要记一次 Again（D66 ①，P321）。
    public func answerSeenAgainApplies(_ entry: JSValue?, _ record: JSValue?, policy: JSValue = Config.policy) throws -> Bool {
        if !JS.truthy(policy) || !JS.isString(policy["answerSeenRating"], "Again") { return false }
        guard let r = record, JS.truthy(r), JS.isString(r["kind"], "answer-seen") else { return false }
        guard let e = entry, JS.truthy(e), JS.truthy(e["fsrs"]), e["stoppedAt"] == nil else { return false }
        if JS.numberOr0(e["fsrs"]?["reps"]) == 0 { return false }
        if JS.strictEquals(e["seenAgainDay"], r["localDay"]) { return false }
        return !(try reviewedOn(e["fsrs"], r["localDay"], policy: policy))
    }

    /// 调度项（键序固定：fsrs, due, lastJudgedAt, seenAgainDay?, stoppedAt?）。nil 值 = undefined（JSON 里不出现）。
    static func entryOf(_ fsrs: JSValue?, _ due: JSValue?, _ lastJudgedAt: JSValue?, _ seenAgainDay: JSValue?, _ stoppedAt: JSValue?) -> JSValue {
        var o = JSObject()
        if let f = fsrs { o["fsrs"] = f }
        if let d = due { o["due"] = d }
        if let l = lastJudgedAt { o["lastJudgedAt"] = l }
        if JS.truthy(seenAgainDay) { o["seenAgainDay"] = seenAgainDay! }
        if let s = stoppedAt { o["stoppedAt"] = s }
        return .object(o)
    }

    /// 新字（还没有 FSRS 卡 / 一次都没复习过）第一次就看了答案，记一次 Again（D83 ③：「写错 / 看了答案 → 没记住，明天再来」）。
    public func answerSeenNewApplies(_ entry: JSValue?, _ record: JSValue?, policy: JSValue = Config.policy) -> Bool {
        if !JS.truthy(policy) || !JS.isString(policy["answerSeenRating"], "Again") { return false }
        guard let r = record, JS.truthy(r), JS.isString(r["kind"], "answer-seen") else { return false }
        let e = entry.flatMap { JS.truthy($0) ? $0 : nil }
        if e?["stoppedAt"] != nil { return false }
        guard let f = e?["fsrs"], JS.truthy(f) else { return true }
        return JS.numberOr0(f["reps"]) == 0 && !JS.strictEquals(e?["seenAgainDay"], r["localDay"])
    }

    /// 看过答案后的调度项（D66 ①；D83 起新字第一次就看答案也记 Again）。
    public func applyAnswerSeen(_ entry: JSValue?, _ record: JSValue, policy: JSValue = Config.policy) throws -> (entry: JSValue?, applied: Bool) {
        let probe = JS.obj([("judgment", .string("wrong")), ("at", record["at"] ?? .null), ("cardKey", record["cardKey"] ?? .null)])
        if try answerSeenAgainApplies(entry, record, policy: policy), let e = entry {
            let step = try reviewCard(e["fsrs"], undefinedAware(probe, record), policy: policy)
            return (ScheduleRules.entryOf(step.card, .string(step.due), e["lastJudgedAt"], record["localDay"], e["stoppedAt"]), true)
        }
        if answerSeenNewApplies(entry, record, policy: policy) {
            let e = entry.flatMap { JS.truthy($0) ? $0 : nil }
            let before = try e?["fsrs"].flatMap { JS.truthy($0) ? $0 : nil } ?? emptyCard(record["at"])
            let step = try reviewCard(before, undefinedAware(probe, record), policy: policy)
            // 调度项必有 lastJudgedAt（形状表）：新字还没判断过，记看答案的时刻
            let seenAt = JSValue.number(try toMs(record["at"]))
            return (ScheduleRules.entryOf(step.card, .string(step.due), e?["lastJudgedAt"] ?? seenAt, record["localDay"], e?["stoppedAt"]), true)
        }
        return (entry, false)
    }

    /// {judgment, at: record.at, cardKey: record.cardKey}：record 里缺的键在 JS 里是 undefined（不是 null）。
    private func undefinedAware(_ probe: JSValue, _ record: JSValue) -> JSValue {
        guard case .object(var o) = probe else { return probe }
        if record["at"] == nil { o["at"] = nil }
        if record["cardKey"] == nil { o["cardKey"] = nil }
        return .object(o)
    }

    /// records 里 cardKey 在 beforeId 之前有没有「看过答案」（/^r(\d+)$/，前导 0 也算）。
    static func seenBeforeIn(_ records: [JSValue]?, _ cardKey: JSValue?, _ beforeId: JSValue?) -> Bool {
        guard let records = records else { return false }
        func serial(_ id: JSValue?) -> Double {
            let s = JS.string(id)
            let u = Array(s.utf8)
            guard u.count >= 2, u[0] == 0x72, u.dropFirst().allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }) else { return .nan }
            return Double(String(decoding: u.dropFirst(), as: UTF8.self)) ?? .nan
        }
        let limit = serial(beforeId)
        return records.contains { r in
            JS.truthy(r) && JS.isString(r["kind"], "answer-seen") && JS.strictEquals(r["cardKey"], cardKey) && (!limit.isFinite || serial(r["id"]) < limit)
        }
    }

    /// 判断落定后的调度项与判断前的卡（D66 ①：当天看答案已记过 Again 的不再评级；新字判断前看过答案按复习口径）。
    public func applyJudgment(_ entry: JSValue?, _ record: JSValue?, policy: JSValue = Config.policy, records: [JSValue]? = nil) throws -> (entry: JSValue, fsrsBefore: JSValue) {
        guard let r = record, JS.truthy(r), JS.isString(r["kind"], "judged") else { throw CoreError.range("applyJudgment expects a judged record") }
        let at = try toMs(r["at"])
        let e = entry.flatMap { JS.truthy($0) ? $0 : nil }
        if let e = e, JS.truthy(e["fsrs"]), JS.truthy(e["seenAgainDay"]), JS.strictEquals(e["seenAgainDay"], r["localDay"]) {
            var before = e["fsrs"]!
            if case .object(var o) = before {
                o["seenAgainDay"] = e["seenAgainDay"]!
                before = .object(o)
            } else {
                before = JS.obj([("seenAgainDay", e["seenAgainDay"]!)])
            }
            return (ScheduleRules.entryOf(e["fsrs"], e["due"], .number(at), e["seenAgainDay"], e["stoppedAt"]), before)
        }
        // D83：复习日期只看每个字当天的第一次——当天已经评过级（例如先在今天的练习里写过，又在自选里写）的不再评级
        if let e = e, let f = e["fsrs"], JS.truthy(f), try reviewedOn(f, r["localDay"], policy: policy) {
            return (ScheduleRules.entryOf(f, e["due"], .number(at), e["seenAgainDay"], e["stoppedAt"]), f)
        }
        var fsrsBefore: JSValue
        if let e = e, JS.truthy(e["fsrs"]) {
            fsrsBefore = e["fsrs"]!
        } else {
            fsrsBefore = try emptyCard(r["at"])
            if ScheduleRules.seenBeforeIn(records, r["cardKey"], r["id"]), case .object(var o) = fsrsBefore {
                o["seenBefore"] = .bool(true)
                fsrsBefore = .object(o)
            }
        }
        let step = try reviewCard(fsrsBefore, r, policy: policy)
        return (ScheduleRules.entryOf(step.card, .string(step.due), .number(at), nil, e?["stoppedAt"]), fsrsBefore)
    }

    /// 从 fsrsBefore 依次重放若干记录（D19 更正 / 从头重放）。没有可重放的 judged 记录时 nil。
    public func replay(_ fsrsBefore: JSValue?, _ records: [JSValue], policy: JSValue = Config.policy, stoppedAt: JSValue? = nil) throws -> JSValue? {
        let fb = fsrsBefore.flatMap { JS.truthy($0) ? $0 : nil }
        var card: JSValue? = fb != nil ? try stripMarks(fb) : nil
        var seenAgainDay: JSValue? = nil
        if let s = fb?["seenAgainDay"], case .string = s { seenAgainDay = s }
        var seenBefore = fb?["seenBefore"] == .bool(true)
        var due: String? = nil
        var lastJudgedAt: Double? = nil
        var judgedAny = false
        for record in records where JS.truthy(record) {
            if JS.isString(record["kind"], "answer-seen") {
                guard let c = card, JS.truthy(c), JS.numberOr0(c["reps"]) != 0 else {
                    if answerSeenNewApplies(card.map { JS.obj([("fsrs", $0), ("seenAgainDay", seenAgainDay ?? .null)]) }, record, policy: policy) {
                        let before = try card.flatMap { JS.truthy($0) ? $0 : nil } ?? emptyCard(record["at"])
                        let step = try reviewCard(before, undefinedAware(JS.obj([("judgment", .string("wrong")), ("at", record["at"] ?? .null), ("cardKey", record["cardKey"] ?? .null)]), record), policy: policy)
                        card = step.card
                        due = step.due
                        seenAgainDay = record["localDay"]
                        if lastJudgedAt == nil { lastJudgedAt = try toMs(record["at"]) }
                    } else {
                        seenBefore = true
                    }
                    continue
                }
                let probe = JS.obj([("fsrs", c), ("seenAgainDay", seenAgainDay ?? .null)])
                if !(try answerSeenAgainApplies(probe, record, policy: policy)) { continue }
                let step = try reviewCard(c, undefinedAware(JS.obj([("judgment", .string("wrong")), ("at", record["at"] ?? .null), ("cardKey", record["cardKey"] ?? .null)]), record), policy: policy)
                card = step.card
                due = step.due
                seenAgainDay = record["localDay"]
                continue
            }
            if !JS.isString(record["kind"], "judged") { continue }
            judgedAny = true
            lastJudgedAt = try toMs(record["at"])
            // D83：同一天第二次起不评级（当天看答案已记过 Again，或当天已经评过级）
            if let c = card, JS.truthy(c), try (JS.truthy(seenAgainDay) && JS.strictEquals(seenAgainDay, record["localDay"])) || reviewedOn(c, record["localDay"], policy: policy) {
                if due == nil {
                    let fsrsDay = try localDayOf(try toMs(c["due"]), policy: policy)
                    let next = try dates.addDays(record["localDay"] ?? .null, 1)
                    // D83 ③：当天看过答案（记过 Again）= 明天再来；当天已评过级的照那次的结果
                    due = JS.truthy(seenAgainDay) && JS.strictEquals(seenAgainDay, record["localDay"]) ? next : (JSMath.lessThan(next, fsrsDay) ? fsrsDay : next)
                }
                continue
            }
            var before: JSValue? = card
            let cardT = card.map { JS.truthy($0) } ?? false
            if !cardT && seenBefore {
                var o = try emptyCard(record["at"]).objectValue!
                o["seenBefore"] = .bool(true)
                before = .object(o)
            } else if cardT && seenBefore && JS.numberOr0(card?["reps"]) == 0, case .object(var o)? = card {
                o["seenBefore"] = .bool(true)
                before = .object(o)
            }
            let step = try reviewCard(before, record, policy: policy)
            card = step.card
            due = step.due
            seenAgainDay = nil
            seenBefore = false
        }
        guard judgedAny, let d = due else { return nil }
        return ScheduleRules.entryOf(card, .string(d), lastJudgedAt.map { .number($0) }, seenAgainDay, stoppedAt)
    }

    // MARK: 到期

    /// sched 项相对 today 的逾期天数（未到期为负；无 due 为 nil）。
    public func overdueDays(_ entry: JSValue?, _ today: JSValue) throws -> Double? {
        guard let e = entry, JS.truthy(e), dates.isValidDay(e["due"] ?? .null) else { return nil }
        return try dates.diffDays(e["due"]!, today)
    }

    public func overdueDays(_ entry: JSValue?, _ today: String) throws -> Double? { try overdueDays(entry, .string(today)) }

    /// sched 项是否到期（due ≤ today，且没有 stoppedAt）。
    public func isDue(_ entry: JSValue?, _ today: JSValue) throws -> Bool {
        guard let e = entry, JS.truthy(e), e["stoppedAt"] == nil else { return false }
        guard let od = try overdueDays(e, today) else { return false }
        return od >= 0
    }

    /// 可提取率（0–1）。
    public func retrievability(_ entry: JSValue?, now: JSValue?) throws -> Double? {
        guard let e = entry, JS.truthy(e), JS.truthy(e["fsrs"]) else { return nil }
        let t = try toMs(now)
        return try lib.retrievability(try toLibraryCard(e["fsrs"]!), now: t)
    }
}
