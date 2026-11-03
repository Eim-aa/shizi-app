import Foundation

// src/core/work-members.js 的 1:1 移植：作品成员规则（D27 Q1 / D31 / D42 / D51 ⑤）。
// 作品 = 写对 ∪ 看后自写；写错的字只在用户手动放进来时进入（added：记录 id 集合）并带朱点；跳过、看过答案没写、纸上记录不进。
// 每字取某个时间段内的一条记录（D42）。

public enum WorkMembers {
    /// 「手动放进来的记录 id」：Set 或数组。
    public struct Added {
        let ids: OSet?
        public init(_ ids: [String]?) {
            if let ids = ids { var s = OSet(); for i in ids { s.insert(i) }; self.ids = s } else { self.ids = nil }
        }
        func has(_ id: JSValue?) -> Bool {
            guard let ids = ids, case .string(let s)? = id else { return false }
            return ids.contains(s)
        }
    }

    /// pickInk 的三态：缺省（与 hasInk 同一判据）/ 显式 null（不做 D42）/ 函数。
    public enum PickInk {
        case sameAsHasInk
        case none
        case test(InkPick.HasInk)
    }

    /// 一条记录算不算作品成员（单一来源）。
    public static func isWorkMember(_ record: JSValue?, hasInk: InkPick.HasInk? = nil, added: Added = Added(nil)) -> Bool {
        guard let record = record, JSX.truthy(record) else { return false }
        if JSX.eq(record["kind"], "judged") {
            if Records.isPaperRecord(record) { return false }
            return JSX.eq(record["judgment"], "wrong") ? added.has(record["id"]) : true
        }
        if JSX.eq(record["kind"], "answer-seen") { return Records.isAfterSeenWork(record, hasInk) }
        return false
    }

    /// 这条成员记录要不要带朱点：写错而被手动放进来的。
    public static func isWrongMember(_ record: JSValue?) -> Bool {
        guard let r = record, JSX.truthy(r) else { return false }
        return JSX.eq(r["kind"], "judged") && JSX.eq(r["judgment"], "wrong")
    }

    /// 从一批记录里筛出作品成员记录（id 升序）。
    public static func workMemberRecords(_ records: [JSValue], hasInk: InkPick.HasInk? = nil, added: Added = Added(nil)) -> [JSValue] {
        JSX.stableSort(records.filter { isWorkMember($0, hasInk: hasInk, added: added) }) { Records.compareRecordIds($0["id"], $1["id"]) }
    }

    /// 折叠一个月时按作品成员规则逐条记下的成员字（R15，src/core/work-members.js foldWorkOf）：
    /// work = 每天的成员字（按记录先后、同字可重复）；workJudged = 只算判断记录的成员，这个月没有看后自写成员时为 nil。
    public static func foldWorkOf(_ list: [JSValue], hasInk: InkPick.HasInk? = nil) -> (work: JSObject, workJudged: JSObject?) {
        var work = JSObject()
        var judged = JSObject()
        var seen = false
        func push(_ o: inout JSObject, _ day: String, _ c: String) {
            var arr = o[day]?.arrayValue ?? []
            arr.append(.string(c))
            o[day] = .array(arr)
        }
        for r in list {
            if !isWorkMember(r, hasInk: hasInk) { continue }
            guard case .string(let day)? = r["localDay"] else { continue }
            let c = charOf(r)
            if c.isEmpty { continue }
            push(&work, day, c)
            if JSX.eq(r["kind"], "judged") { push(&judged, day, c) } else { seen = true }
        }
        return (work, seen ? judged : nil)
    }

    static func charOf(_ record: JSValue) -> String {
        if case .string(let c)? = record["char"], !c.isEmpty { return c }
        let key: String = { if case .string(let k)? = record["cardKey"] { return k }; return "" }()
        let u = Array(key.utf16)
        if let i = u.firstIndex(of: 0x3A) { return String(decoding: u[(i + 1)...], as: UTF16.self) }
        return key
    }

    public struct Member {
        public let char: String
        public let cardKey: JSValue?
        public let record: JSValue
        public let firstDay: JSValue
        public let dot: Bool

        public var js: JSValue {
            var o = JSObject([("char", .string(char))])
            if let k = cardKey { o["cardKey"] = k }
            o["record"] = record
            o["firstDay"] = firstDay
            o["dot"] = .bool(dot)
            return .object(o)
        }
    }

    /// 一个时间段的作品成员：记录先过成员规则，再按字分组，每字取一条（D42）。
    /// prefer：每字取哪一次（缺省 'last'）；order：成员顺序（'first' 字在段内第一次出现的先后；'last' 最近一次出现的先后）。
    public static func workMembers(_ records: [JSValue], prefer: JSValue? = nil, order: JSValue? = nil, hasInk: InkPick.HasInk? = nil,
                                   pickInk: PickInk = .sameAsHasInk, added: Added = Added(nil)) -> [Member] {
        let sorted = workMemberRecords(records, hasInk: hasInk, added: added)
        var byChar = OMap<[JSValue]>()
        for r in sorted {
            let c = charOf(r)
            if var list = byChar[c] { list.append(r); byChar[c] = list } else { byChar[c] = [r] }
        }
        var rows = byChar.entries
        let orderKind = order == nil ? "first" : (JSX.eq(order, "last") ? "last" : "first")
        if orderKind == "last" {
            rows = JSX.stableSort(rows) { Records.compareRecordIds($0.value[$0.value.count - 1]["id"], $1.value[$1.value.count - 1]["id"]) }
        }
        let picker: InkPick.HasInk?
        switch pickInk {
        case .sameAsHasInk: picker = hasInk
        case .none: picker = nil
        case .test(let f): picker = f
        }
        let preferV: JSValue = JSX.eq(prefer ?? .string("last"), "first") ? .string("first") : .string("last")
        return rows.map { row in
            let record = InkPick.pickRecordInPeriod(row.value, prefer: preferV, hasInk: picker).record!
            return Member(char: row.key, cardKey: record["cardKey"], record: record, firstDay: row.value[0]["localDay"].flatMap { JSX.truthy($0) ? $0 : nil } ?? .null,
                          dot: isWrongMember(record))
        }
    }
}
