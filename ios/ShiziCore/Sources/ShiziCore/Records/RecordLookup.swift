import Foundation

/// 按字 / 按组 / 按记录号取记录：代替「展开全部记录（Query.flattenRecords）再筛」。判字、看答案、撤销跳过、结束一组、结果页用它，
/// 每次只花 O(月数 + 命中的条数)，外加「这次读到的月列表与上次建索引的不是同一块存储」的月重建一次（O(那个月的条数)）。
/// 判字时只有当月的列表变了：旧月（含折叠月的 kept）一直命中，所以一次判断是 O(当月 + 这个字 / 这一组的记录)，与历史总量无关。
///
/// 等价（逐条相同、同序）：`records(state, .card, v)` 是 flattenRecords 结果里「cardKey 是字串、且与 v 规范等价（Swift String ==）」的那些记录，
/// 按展开顺序（月按 records 对象的键序，月内按列表顺序）——即展开结果的一个子序列。调用方在它上面用原来的条件再筛
/// （JSValue == / JS.strictEquals 比字串都是逐字节相同，逐字节相同 ⇒ 规范等价，所以满足原条件的记录全在子序列里；
/// 不在子序列里的记录这个字段不是字串、或与 v 不规范等价，原条件对它们必为 false）。于是 first / last / filter / contains、
/// 以及子序列上的稳定排序（sortById：同一个严格弱序下，子序列的稳定排序 = 全体稳定排序再取子序列）都与在全部记录上做的逐条相同。
/// v 不是字串（缺、null、数字……）时退回全部记录（原条件里 nil / null 也可能相等，不走索引）。
///
/// 缓存为什么不会与状态不同步（不需要在任何写入路径上作废）：每个月记住的是 (列表本身, 列表上的下标表)。命中的条件是这次读到的列表与记住的列表
/// 是同一块存储（sameRepresentation：位模式相同 = 同一个缓冲区引用）。记住的列表自己持有那块缓冲区的引用：缓冲区活着，它的地址就不会被别的数组复用；
/// Swift 数组写时复制，被两处引用的缓冲区不会被原地改写。所以任何写法——提交、播种、恢复备份、清空、折叠 / 回收、迁移、撤销、App 的夹具造数据——
/// 只要改了这个月，读到的就是另一块存储，于是不命中、按新列表重建；没改就是同一块存储，内容逐条相同，下标表仍然对。
/// 每个月只记一份（按月键），这一轮读到的月以外的旧项会被清掉，最多多留一份记录列表的引用。
enum RecordLookup {
    enum Field { case card, session, id }

    /// 一个月的记录列表上的下标表：字段的字串值 → 下标（升序）。只收对象里是字串的值。
    final class MonthIndex {
        let list: [JSValue]
        let byCard: [String: [Int]]
        let bySession: [String: [Int]]
        let byId: [String: [Int]]

        init(_ list: [JSValue]) {
            self.list = list
            var card: [String: [Int]] = [:], session: [String: [Int]] = [:], id: [String: [Int]] = [:]
            for (n, r) in list.enumerated() {
                guard case .object(let o) = r else { continue }
                if case .string(let v)? = o["cardKey"] { card[v, default: []].append(n) }
                if case .string(let v)? = o["sessionId"] { session[v, default: []].append(n) }
                if case .string(let v)? = o["id"] { id[v, default: []].append(n) }
            }
            byCard = card
            bySession = session
            byId = id
        }

        func hits(_ field: Field, _ value: String) -> [Int]? {
            switch field {
            case .card: return byCard[value]
            case .session: return bySession[value]
            case .id: return byId[value]
            }
        }
    }

    private static let lock = NSLock()
    private static var cache: [String: MonthIndex] = [:]

    /// 这个月这份列表的下标表（同一块存储就用记住的，否则重建并记住）。
    static func index(_ month: String, _ list: [JSValue]) -> MonthIndex {
        lock.lock()
        let hit = cache[month]
        lock.unlock()
        if let h = hit, sameRepresentation(h.list, list) { return h }
        let built = MonthIndex(list)
        lock.lock()
        cache[month] = built
        lock.unlock()
        return built
    }

    /// 清掉这一轮没读到的月（换了状态 / 删了月之后不再白留旧列表）。
    private static func trim(_ months: [String]) {
        lock.lock()
        defer { lock.unlock() }
        guard cache.count > months.count else { return }
        let live = Set(months)
        cache = cache.filter { live.contains($0.key) }
    }

    /// Query.flattenRecords 对一个月取的列表：数组本身；否则 kept 是数组（且值为真）就取 kept；都不是 nil。
    static func flatList(_ value: JSValue) -> [JSValue]? {
        if case .array(let l) = value { return l }
        if case .array(let kept)? = value["kept"], JSX.truthy(value) { return kept }
        return nil
    }

    /// records 域里命中 wants 任一项（字段的字串值与给的字串规范等价）的记录，按展开顺序；pick 决定每个月取哪份列表（缺省与 flattenRecords 同）。
    static func candidates(_ domain: JSValue?, _ wants: [(Field, String)], pick: (JSValue) -> [JSValue]? = RecordLookup.flatList) -> [JSValue] {
        var out: [JSValue] = []
        guard case .object(let months)? = domain, !wants.isEmpty else { return out }
        let keys = months.keys
        for month in keys {
            guard let value = months[month], let list = pick(value), !list.isEmpty else { continue }
            let idx = index(month, list)
            if wants.count == 1 {
                for n in idx.hits(wants[0].0, wants[0].1) ?? [] { out.append(list[n]) }
            } else {
                var at = Set<Int>()
                for (field, v) in wants { for n in idx.hits(field, v) ?? [] { at.insert(n) } }
                for n in at.sorted() { out.append(list[n]) }
            }
        }
        trim(keys)
        return out
    }

    /// 全部记录里 field 可能等于 value 的那些（见类型说明）；value 不是字串时 = 全部记录（Query.flattenRecords）。
    static func records(_ state: JSObject, _ field: Field, _ value: JSValue?) -> [JSValue] {
        guard case .string(let v)? = value else { return Query.flattenRecords(state["records"]) }
        return candidates(state["records"], [(field, v)])
    }

    /// TodayPlan.summary(s, records:) 只读两样：items 里各 recordId 在全部记录里的第一条（byId），与 items 里各 cardKey 按 id 排序后的第一条判断 / 看答案（firstSeen）。
    /// 这里给的是「id 与某个 item 的 recordId 规范等价，或 cardKey 与某个 item 的 cardKey 规范等价」的记录（展开顺序的子序列）：
    /// 两样要找的记录全在里面且相对顺序不变（summary 的两张表都按 Swift String 散列，键也是规范等价），所以汇总逐个相同。s 不成立时 summary 不读记录，给空。
    static func forSummary(_ state: JSObject, _ s: JSValue?) -> [JSValue] {
        guard let s, JS.truthy(s) else { return [] }
        var wants: [(Field, String)] = []
        for it in s["items"]?.arrayValue ?? [] {
            if let id = it["recordId"]?.stringValue { wants.append((.id, id)) }
            if let k = it["cardKey"]?.stringValue { wants.append((.card, k)) }
        }
        return candidates(state["records"], wants)
    }

    /// Budget.pruneInkOfCards 的 mine：records 域里（按 Budget.monthRecords 取每个月的列表，即数组或 folded 的 kept）cardKey 在 want 里的对象记录，按原来的遍历顺序。
    static func recordsOfCards(_ recs: JSValue, _ want: KeySet) -> [JSValue] {
        candidates(recs, want.map { (Field.card, $0) }, pick: { Budget.monthRecords($0) }).filter { rec in
            if case .object = rec, let ck = Budget.cardKey(rec), want.contains(ck) { return true }
            return false
        }
    }
}
