import Foundation

// src/core/mix.js 的 1:1 移植（B4.2）：每组复习与新字的配比（规则 D「保底一新 + 积压阀」，D41 / D28 / D40 / D65 #2 / D66 ⑫；
// policy.groupMix P125、policy.warmup P126）。全部输入从 records / sched 推出；数值一律读传入的 policy（缺省 = 生成的 policy.json）。

public struct PracticeStats: Equatable {
    public var groupsTotal: Double
    public var groupsPerDay: Double
    public var newAccuracy: Double
    public var allAccuracy: Double
    public var lastHadNew: Bool
    public var firstBack: Bool
    public var dayIndex: Double
    public var hadToday: Bool
    public var lastDay: String?
    public var firstDay: String?

    public var js: JSValue {
        JS.obj([
            ("groupsTotal", .number(groupsTotal)), ("groupsPerDay", .number(groupsPerDay)), ("newAccuracy", .number(newAccuracy)),
            ("allAccuracy", .number(allAccuracy)), ("lastHadNew", .bool(lastHadNew)), ("firstBack", .bool(firstBack)), ("dayIndex", .number(dayIndex)),
            ("hadToday", .bool(hadToday)), ("lastDay", lastDay.map { .string($0) } ?? .null), ("firstDay", firstDay.map { .string($0) } ?? .null),
        ])
    }
}

/// newTargetOf / planGroup 的 state。
public struct MixState {
    public var backlog: Double
    public var groupsPerDay: Double
    public var newAccuracy: Double
    public var lastHadNew: JSValue?
    public var firstBack: JSValue?
    public init(backlog: Double, groupsPerDay: Double, newAccuracy: Double, lastHadNew: JSValue?, firstBack: JSValue? = nil) {
        self.backlog = backlog
        self.groupsPerDay = groupsPerDay
        self.newAccuracy = newAccuracy
        self.lastHadNew = lastHadNew
        self.firstBack = firstBack
    }
}

public struct GroupPlan: Equatable {
    public var newTarget: Double
    public var revKeys: [String]
    public var earlyKeys: [String]
    public var newSlots: Double
    public var warmNew: String?
    public var warmRev: Int

    public var js: JSValue {
        JS.obj([
            ("newTarget", .number(newTarget)), ("revKeys", .array(revKeys.map { .string($0) })), ("earlyKeys", .array(earlyKeys.map { .string($0) })),
            ("newSlots", .number(newSlots)), ("warmNew", warmNew.map { .string($0) } ?? .null), ("warmRev", .number(Double(warmRev))),
        ])
    }
}

public enum Mix {
    static func accuracyOf(_ values: [Bool], _ prior: Double, _ weight: Double) -> Double {
        if values.isEmpty { return prior }
        let ok = Double(values.filter { $0 }.count)
        return (ok + prior * weight) / (Double(values.count) + weight)
    }

    static func groupId(_ r: JSValue) -> String {
        if JS.truthy(r["sessionId"]) { return JS.string(r["sessionId"]) }
        return "legacy:" + JS.string(r["localDay"])
    }

    static func baseOf(_ mix: JSValue?) -> Double {
        let b = mix?["baseSize"]
        return JS.isInteger(b) && JS.number(b) > 0 ? JS.number(b) : 5
    }

    /// 按组大小换算一个「以 5 字一组写的」个数：round(n × size / base)，至少 1（n 为 0 时 0）。
    public static func scaledCount(_ n: Double, _ size: Double, mix: JSValue?) -> Double {
        let base = baseOf(mix)
        if !size.isFinite || size == base || n == 0 || n.isNaN { return n }
        return jsMax(1, JSMath.round((n * size) / base))
    }

    /// 积压天数 p。
    public static func pressureOf(_ backlog: Double, _ groupsPerDay: Double, mix: JSValue?, size: Double? = nil) -> Double {
        let s = size ?? baseOf(mix)
        let perGroup = (JS.number(mix?["reviewsPerGroupForPressure"]) * s) / baseOf(mix)
        return backlog / jsMax(1, perGroup * jsMax(1, groupsPerDay))
    }

    /// 这一组的新字数目标。
    public static func newTargetOf(_ state: MixState, mix: JSValue?, size: Double? = nil) -> Double {
        let s = size ?? baseOf(mix)
        let p = pressureOf(state.backlog, state.groupsPerDay, mix: mix, size: s)
        let one = scaledCount(1, s, mix: mix)
        let p2 = JSValue.number(p)
        let release = mix?["valveReleaseDays"]
        if release == nil || release == .null {
            if JS.lessOrEqual(mix?["valveDays"], p2) { return JS.truthy(state.lastHadNew) ? 0 : one }
        } else {
            let closed = JS.lessOrEqual(mix?["valveDays"], p2) || (JS.lessOrEqual(release, p2) && state.lastHadNew == .bool(false))
            if closed { return JS.truthy(state.firstBack) ? one : 0 }
        }
        if JS.lessOrEqual(mix?["twoNewBelowDays"], p2) { return one }
        if JS.less(p2, mix?["threeNewBelowDays"]) && JS.lessOrEqual(mix?["threeNewMinAccuracy"], .number(state.newAccuracy)) {
            return scaledCount(JS.number(mix?["newMax"]), s, mix: mix)
        }
        return scaledCount(2, s, mix: mix)
    }

    /// 新用户前几天的新字上限（D66 ⑫，P325）。
    public static func newUserCapOf(_ stats: PracticeStats?, ramp: JSValue?, size: Double, mix: JSValue?) -> Double {
        guard let r = ramp, JS.truthy(r), JS.isInteger(r["days"]), JS.number(r["days"]) > 0, JS.isInteger(r["newMax"]) else { return .infinity }
        guard let st = stats, !(st.dayIndex > JS.number(r["days"])) else { return .infinity }
        return scaledCount(JS.number(r["newMax"]), size, mix: mix)
    }

    /// 热身字门控（P126）。
    public static func warmupAllowed(_ stats: PracticeStats, warm: JSValue?) throws -> Bool {
        guard JS.isString(warm?["mode"], "gated") else { throw CoreError.range("unsupported policy.warmup.mode: " + JS.string(warm?["mode"])) }
        return JS.lessOrEqual(.number(stats.dayIndex), warm?["firstDays"]) || JS.less(.number(stats.allAccuracy), warm?["accuracyBelow"])
    }

    /// 一组怎么配（不排序、不写入）。
    public static func planGroup(size: Double, budget: Double, due: [String], early: [String], isWarm: (String) -> Bool, warmNext: String?, warmOk: Bool,
                                 state: MixState, mix: JSValue?, newAvailable: Double = .infinity, reserve: Double = 0, pressureSize: Double? = nil,
                                 newCap: Double = .infinity) -> GroupPlan {
        let ps = pressureSize ?? size
        let newTarget = jsMin(jsMin(size, newCap), newTargetOf(state, mix: mix, size: ps))
        let revSlots = jsMax(jsMin(size - newTarget, budget), jsMin(size, jsMax(0, reserve)))
        var revKeys: [String] = []
        var warmRev = 0
        for key in due {
            if Double(revKeys.count) >= revSlots { break }
            if isWarm(key) {
                if warmRev >= 1 { continue }
                warmRev += 1
            }
            revKeys.append(key)
        }
        let rev = Double(revKeys.count)
        var newSlots = jsMin(jsMin(jsMin(scaledCount(JS.number(mix?["newMax"]), ps, mix: mix), size - rev), newAvailable), newCap)
        var earlyKeys: [String] = []
        if JS.truthy(mix?["earlyReviewFill"]) && rev + newSlots < size {
            earlyKeys = jsSlice(early, 0, size - rev - newSlots)
        }
        newSlots = jsMin(jsMin(size - rev - Double(earlyKeys.count), newAvailable), newCap)
        var warmNew: String? = nil
        if newSlots >= 2 && warmRev == 0 && warmOk, let w = warmNext, !w.isEmpty { warmNew = w }
        return GroupPlan(newTarget: newTarget, revKeys: revKeys, earlyKeys: earlyKeys, newSlots: newSlots, warmNew: warmNew, warmRev: warmRev)
    }

    /// Array.prototype.slice(start, end)（end 可为小数 / 负数 / NaN）。
    static func jsSlice<T>(_ a: [T], _ start: Double, _ end: Double) -> [T] {
        func rel(_ x: Double) -> Int {
            let n = Double(a.count)
            if x.isNaN { return 0 }
            let t = x.rounded(.towardZero)
            if t < 0 { return Int(Swift.max(n + t, 0)) }
            return Int(Swift.min(t, n))
        }
        let s = rel(start), e = rel(end)
        return s < e ? Array(a[s..<e]) : []
    }

    /// 组内顺序：热身字在组首；其余「复习、新」交错；提前复习放最后；末位不是新字（有可换的时候）。
    public static func arrangeGroup(warmNew: String?, revKeys: [String], earlyKeys: [String], newKeys: [String], isWarm: (String) -> Bool) -> [String] {
        var items: [(key: String, kind: String)] = []
        if let w = warmNew, !w.isEmpty { items.append((w, "warm")) }
        var revs = revKeys.jsSorted { (isWarm($1) ? 1.0 : 0) - (isWarm($0) ? 1.0 : 0) }.map { (key: $0, kind: "rev") }
        var news = newKeys.map { (key: $0, kind: "new") }
        if let f = revs.first, isWarm(f.key) {
            revs.removeFirst()
            items.append((f.key, "warm"))
        }
        while !revs.isEmpty || !news.isEmpty {
            if !revs.isEmpty { items.append(revs.removeFirst()) }
            if !news.isEmpty { items.append(news.removeFirst()) }
        }
        for key in earlyKeys { items.append((key, "early")) }
        if items.count > 1 && items[items.count - 1].kind == "new" {
            var i = items.count - 2
            while i >= 0 {
                if items[i].kind == "rev" || items[i].kind == "early" {
                    items.append(items.remove(at: i))
                    break
                }
                i -= 1
            }
        }
        return items.map { $0.key }
    }
}

extension ScheduleRules {
    /// 练习状态（全部从 records 推出）。
    public func practiceStats(_ records: [JSValue], _ today: String, policy: JSValue = Config.policy, isWarm: (String) -> Bool) throws -> PracticeStats {
        let mix = policy["groupMix"]
        let warm = policy["warmup"]
        let judged = SchedRecords.sortById(records.filter { SchedRecords.isJudged($0) })
        var groupIds = KeySet()
        var perDay = KeyMap<KeySet>()
        var firstOfCard = KeyMap<Int>() // cardKey → judged 里的下标（JS 按对象身份比）
        var firstNew: [Bool] = []
        var firstDay: String? = nil
        var lastDay: String? = nil
        var hadToday = false
        for (i, r) in judged.enumerated() {
            let gid = Mix.groupId(r)
            groupIds.insert(gid)
            let day = JS.string(r["localDay"])
            var set = perDay[day] ?? KeySet()
            set.insert(gid)
            perDay[day] = set
            if firstDay == nil || JS.less(r["localDay"], .string(firstDay!)) { firstDay = day }
            if JS.isString(r["localDay"], today) {
                hadToday = true
            } else if JS.less(r["localDay"], .string(today)) && (lastDay == nil || JS.less(.string(lastDay!), r["localDay"])) {
                lastDay = day
            }
            let key = JS.string(r["cardKey"])
            if !firstOfCard.has(key) {
                firstOfCard[key] = i
                if !isWarm(key) { firstNew.append(JS.isString(r["judgment"], "correct")) }
            }
        }
        var groupsInWindow = 0.0
        let window = JS.number(mix?["pressureWindowDays"])
        var i = 1.0
        while i <= window {
            if let set = perDay[try dates.addDays(today, -i)] { groupsInWindow += Double(set.count) }
            i += 1
        }
        let groupsPerDay = jsMax(1, groupsInWindow / window)
        let recentNew = Mix.jsSlice(firstNew, jsMax(0, Double(firstNew.count) - JS.number(mix?["recentNewWindow"])), Double(firstNew.count))
        let recentAll = Mix.jsSlice(judged, jsMax(0, Double(judged.count) - JS.number(warm?["window"])), Double(judged.count)).map { JS.isString($0["judgment"], "correct") }
        var lastHadNew = true
        if let tail = judged.last {
            let gid = Mix.groupId(tail)
            lastHadNew = judged.enumerated().contains { (j, r) in jsEq(Mix.groupId(r), gid) && firstOfCard[JS.string(r["cardKey"])] == j }
        }
        var firstBack = false
        if !hadToday, let ld = lastDay {
            firstBack = JS.lessOrEqual(mix?["returnAfterDays"], .number(try dates.diffDays(.string(ld), .string(today))))
        }
        if firstBack { lastHadNew = false }
        return PracticeStats(
            groupsTotal: Double(groupIds.count), groupsPerDay: groupsPerDay,
            newAccuracy: Mix.accuracyOf(recentNew, JS.number(mix?["newAccuracyPrior"]), JS.number(mix?["accuracyPriorWeight"])),
            allAccuracy: Mix.accuracyOf(recentAll, JS.number(mix?["allAccuracyPrior"]), JS.number(mix?["accuracyPriorWeight"])),
            lastHadNew: lastHadNew, firstBack: firstBack,
            dayIndex: firstDay == nil ? 1 : try dates.diffDays(.string(firstDay!), .string(today)) + 1,
            hadToday: hadToday, lastDay: lastDay, firstDay: firstDay)
    }

    /// 今天已做的「到期复习」数（提前复习不计入；P125 earlyCountsTowardCap=false）。
    public func dueReviewsDoneOn(_ records: [JSValue], _ today: String, sched: JSValue?, policy: JSValue = Config.policy) -> Double {
        let all = SchedRecords.reviewsDoneOn(records, today)
        if policy["groupMix"]?["earlyCountsTowardCap"] != .bool(false) || all == 0 { return Double(all) }
        var byCard = KeyMap<[JSValue]>()
        for r in records {
            if !SchedRecords.isJudged(r) && !(JS.truthy(r) && JS.isString(r["kind"], "answer-seen")) { continue }
            let k = JS.string(r["cardKey"])
            var list = byCard[k] ?? []
            list.append(r)
            byCard[k] = list
        }
        var early = 0
        for (cardKey, list0) in byCard.entries {
            let list = list0.filter { SchedRecords.isJudged($0) }
            if !list.contains(where: { JS.isString($0["localDay"], today) }) || !list.contains(where: { JS.less($0["localDay"], .string(today)) }) { continue }
            guard let entry = JS.truthy(sched) ? sched?[cardKey] : nil, JS.truthy(entry) else { continue }
            do {
                let sorted = SchedRecords.sortById(list0)
                guard let full = try replay(nil, sorted, policy: policy), JS.strictEquals(full["due"], entry["due"]) else { continue }
                let before = try replay(nil, sorted.filter { JS.less($0["localDay"], .string(today)) }, policy: policy)
                if let b = before, JS.less(.string(today), b["due"]) { early += 1 }
            } catch {
                // 保守地不扣
            }
        }
        return Double(Swift.max(0, all - early))
    }
}
