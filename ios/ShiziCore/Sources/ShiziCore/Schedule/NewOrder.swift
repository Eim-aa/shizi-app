import Foundation

// 新字顺序（D28 / D39 / D40 / D45 / D50）、大写数字特别组（D40 / D46 ④）、
// 每组字数（D65 #2 / P314）的 1:1 移植（B4.2）。数据 = 生成的 char-order.json（可传别的表，测试「换表」用）。

public enum NewOrder {
    struct Index {
        var rank: KeyMap<Int>
        var reserved: KeySet
        var warmup: KeySet
        var warmupRank: KeyMap<Int>
        var capital: KeySet
    }

    static let defaultIndex = index(Config.charOrderData)

    static func strings(_ v: JSValue?) -> [String] { (v?.arrayValue ?? []).map { JS.string($0) } }

    static func index(_ data: JSValue) -> Index {
        var rank = KeyMap<Int>()
        for ch in strings(data["order"]) + strings(data["level2"]) where !rank.has(ch) { rank[ch] = rank.count }
        let r = data["reserved"]
        let reserved = KeySet(strings(r?["surnames"]) + strings(r?["places"]) + strings(r?["capitalNumerals"]) + strings(r?["heavy"]))
        var warmupRank = KeyMap<Int>()
        for (i, ch) in strings(data["warmup"]).enumerated() { warmupRank[ch] = i }
        return Index(rank: rank, reserved: reserved, warmup: KeySet(strings(data["warmup"])), warmupRank: warmupRank, capital: KeySet(strings(r?["capitalNumerals"])))
    }

    static func indexOf(_ data: JSValue?) -> Index { data.map { index($0) } ?? defaultIndex }

    public static func isReservedChar(_ ch: String, data: JSValue? = nil) -> Bool { indexOf(data).reserved.contains(ch) }
    public static func isWarmupChar(_ ch: String, data: JSValue? = nil) -> Bool { indexOf(data).warmup.contains(ch) }
    public static func isCapitalChar(_ ch: String, data: JSValue? = nil) -> Bool { indexOf(data).capital.contains(ch) }

    public static func isWarmupKey(_ cardKey: JSValue?, data: JSValue? = nil) -> Bool {
        guard let ch = SchedRecords.charOfCardKey(cardKey) else { return false }
        return isWarmupChar(ch, data: data)
    }

    public static func isWarmupKey(_ cardKey: String) -> Bool { isWarmupKey(.string(cardKey)) }

    /// 某字库的新字顺序：清单内按清单顺序在前，清单外按原顺序在后；reserved 剔除。
    public static func orderNewKeys(_ keys: [String], data: JSValue? = nil) -> [String] {
        let idx = indexOf(data)
        var listed: [(String, Int)] = []
        var rest: [String] = []
        for key in keys {
            guard let ch = SchedRecords.charOfCardKey(key), !idx.reserved.contains(ch) else { continue }
            if let r = idx.rank[ch] { listed.append((key, r)) } else { rest.append(key) }
        }
        return listed.jsSorted { Double($0.1 - $1.1) }.map { $0.0 } + rest
    }

    /// 某字库里的热身字（按热身清单顺序）。
    public static func warmupKeys(_ keys: [String], data: JSValue? = nil) -> [String] {
        let idx = indexOf(data)
        var found: [(String, Int)] = []
        for key in keys {
            if let ch = SchedRecords.charOfCardKey(key), let r = idx.warmupRank[ch] { found.append((key, r)) }
        }
        return found.jsSorted { Double($0.1 - $1.1) }.map { $0.0 }
    }

    /// 特别组（D40）的 cardKey 分组。
    public static func capitalGroupKeys(data: JSValue? = nil) -> [[String]] {
        let d = data ?? Config.charOrderData
        return (d["capital"]?["groups"]?.arrayValue ?? []).map { strings($0).map { "base:" + $0 } }
    }

    /// 特别组之后进入普通新字队列最前的字（佰仟）。
    public static func capitalAfterKeys(data: JSValue? = nil) -> [String] {
        let d = data ?? Config.charOrderData
        return strings(d["capital"]?["after"]).map { "base:" + $0 }
    }

    /// 一个队列是不是「整组都是大写数字字」。
    public static func isCapitalQueue(_ queue: [JSValue]?, data: JSValue? = nil) -> Bool {
        guard let q = queue, !q.isEmpty else { return false }
        let capital = indexOf(data).capital
        return q.allSatisfy { k in SchedRecords.charOfCardKey(k).map { capital.contains($0) } ?? false }
    }
}

// MARK: - 特别组

public enum Special {
    static func charsWithAnyRecord(_ records: [JSValue]) -> KeySet {
        var out = KeySet()
        for r in records where JS.truthy(r) && JS.truthy(r["cardKey"]) {
            if let ch = SchedRecords.charOfCardKey(r["cardKey"]) { out.insert(ch) }
        }
        return out
    }

    /// 「这次先写平常的字」只管点的那一天。
    public static func isDeferred(_ deferredDay: JSValue?, _ today: JSValue?) -> Bool {
        guard case .string(let d)? = deferredDay, case .string(let t)? = today else { return false }
        return jsEq(d, t)
    }

    /// 每一组是否已经出现过（标记字有任何记录；首练里的字不当标记）。
    public static func capitalProgress(_ records: [JSValue], policy: JSValue = Config.policy, data: JSValue? = nil) -> [(keys: [String], done: Bool)] {
        let appeared = charsWithAnyRecord(records)
        var first = KeySet()
        if let fq = policy["firstQueue"] {
            // Array.from(policy.firstQueue || [])
            switch fq {
            case .array(let a): for v in a { first.insert(JS.string(v)) }
            case .string(let s): for c in s.unicodeScalars { first.insert(String(c)) }
            default: break
            }
        }
        return NewOrder.capitalGroupKeys(data: data).map { keys in
            let marks = keys.compactMap { SchedRecords.charOfCardKey($0) }.filter { !first.contains($0) }
            return (keys, marks.contains { appeared.contains($0) })
        }
    }

    /// 下一次日常组是不是大写数字特别组；返回 (kind, keys) 或 nil。
    public static func capitalSpecial(records: [JSValue], groupsTotal: Double, pressure: Double, practicable: (String) -> Bool, excluded: KeySet,
                                      policy: JSValue = Config.policy, data: JSValue? = nil, today: JSValue? = nil, deferredDay: JSValue? = nil) -> (kind: String, keys: [String])? {
        let cfg = policy["capitalNumerals"]
        if !JS.truthy(cfg) || cfg?["enabled"] == .bool(false) { return nil }
        if isDeferred(deferredDay, today) { return nil }
        if JS.less(.number(groupsTotal), cfg?["afterGroups"]) || JS.lessOrEqual(cfg?["belowDays"], .number(pressure)) { return nil }
        let progress = capitalProgress(records, policy: policy, data: data)
        for (i, g) in progress.enumerated() where !g.done {
            let keys = g.keys.filter { practicable($0) && !excluded.contains($0) }
            if !keys.isEmpty { return ("capital" + String(i + 1), keys) }
        }
        return nil
    }

    /// 两组特别组都出现过之后，佰仟排到普通新字队列最前；还没出现过时返回空。
    public static func capitalAfterKeysFor(_ records: [JSValue], policy: JSValue = Config.policy, data: JSValue? = nil) -> [String] {
        let cfg = policy["capitalNumerals"]
        if !JS.truthy(cfg) || cfg?["enabled"] == .bool(false) { return [] }
        let progress = capitalProgress(records, policy: policy, data: data)
        return !progress.isEmpty && progress.allSatisfy { $0.done } ? NewOrder.capitalAfterKeys(data: data) : []
    }
}

// MARK: - 每组字数

public enum GroupSize {
    /// 一个值是不是可选的组大小（`indexOf(value) >= 0`，严格相等）。
    public static func isOption(_ value: JSValue?, policy: JSValue = Config.policy) -> Bool {
        guard case .array(let opts)? = policy["groupSizeOptions"] else { return false }
        return opts.contains { JS.strictEquals($0, value) }
    }

    /// 规整：可选值原样返回，其余按 policy.groupSize。
    public static func valid(_ value: JSValue?, policy: JSValue = Config.policy) -> JSValue? {
        isOption(value, policy: policy) ? value : policy["groupSize"]
    }

    /// settings → 每组字数。
    public static func of(_ settings: JSValue?, policy: JSValue = Config.policy) -> JSValue? {
        valid(JS.truthy(settings) ? settings?["groupSize"] : nil, policy: policy)
    }

    /// 区详情 / 清单「练这些字」默认勾选几个（D66 ⑬，P113）。
    public static func listDefaultSelectOf(_ settings: JSValue?, policy: JSValue = Config.policy) -> Double {
        let raw = policy["listDefaultSelect"]
        let n: Double = JS.isInteger(raw) && JS.number(raw) > 0 ? JS.number(raw) : 0
        return n != 0 ? Mix.scaledCount(n, JS.number(of(settings, policy: policy)), mix: policy["groupMix"]) : .infinity
    }
}
