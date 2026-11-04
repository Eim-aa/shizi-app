import Foundation

// 练习状态与组内顺序（B4.2 移植自原 JS 版）。D83（调度规则 v2）起配比改由 TodayPlan.compose 按档位比例算，
// 规则 D 的「积压阀 / 新字目标 / 新用户封顶 / 每日复习上限」已删除；这里只留热身字门控（P126）、练习状态与 arrangeGroup（交错、热身字在组首、末位不是新字）。

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

    /// 热身字门控（P126）。
    public static func warmupAllowed(_ stats: PracticeStats, warm: JSValue?) throws -> Bool {
        guard JS.isString(warm?["mode"], "gated") else { throw CoreError.range("unsupported policy.warmup.mode: " + JS.string(warm?["mode"])) }
        return JS.lessOrEqual(.number(stats.dayIndex), warm?["firstDays"]) || JS.less(.number(stats.allAccuracy), warm?["accuracyBelow"])
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
}
