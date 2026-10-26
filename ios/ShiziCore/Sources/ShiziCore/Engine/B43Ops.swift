import Foundation

// B4.3 的 op：记录 / 查字 / 卡片 / 结构 / 作品成员 / 取墨 / 首练结果页 / 提醒题目 / 墨 v2 v3 v4 编解码 / V8 数学函数。
// 参考实现在 scripts/core-diff/lib/js-ops-b43.mjs（同名、同参数校验、同错误码）；规则一律直接调 src/。
// 参数约定：记录 / 卡片 / 墨迹等都是原样 JSON 值；注入函数（hasInk 之类）用数据描述：{ids: [记录 id…], throwIds?: [抛错的记录 id…]}。

extension CoreEngine {
    // ---- 参数校验（与 js-ops-b43.mjs 的助手同一规则）----

    static func has(_ a: JSObject, _ k: String) -> Bool { a[k] != nil }

    static func array(_ a: JSObject, _ k: String) throws -> [JSValue] {
        guard case .array(let l) = try required(a, k) else { throw CoreError.badArgs(k + " must be an array") }
        return l
    }

    static func optArray(_ a: JSObject, _ k: String) throws -> [JSValue]? {
        guard let v = a[k] else { return nil }
        guard case .array(let l) = v else { throw CoreError.badArgs(k + " must be an array") }
        return l
    }

    static func object(_ a: JSObject, _ k: String) throws -> JSObject {
        guard case .object(let o) = try required(a, k) else { throw CoreError.badArgs(k + " must be an object") }
        return o
    }

    static func optObject(_ a: JSObject, _ k: String) throws -> JSObject? {
        guard let v = a[k] else { return nil }
        guard case .object(let o) = v else { throw CoreError.badArgs(k + " must be an object") }
        return o
    }

    static func strings(_ v: JSValue, _ k: String) throws -> [String] {
        guard case .array(let l) = v else { throw CoreError.badArgs(k + " must be an array of strings") }
        return try l.map { guard case .string(let s) = $0 else { throw CoreError.badArgs(k + " must be an array of strings") }; return s }
    }

    static func optStrings(_ a: JSObject, _ k: String) throws -> [String]? {
        guard let v = a[k] else { return nil }
        return try strings(v, k)
    }

    static func numberArg(_ a: JSObject, _ k: String) throws -> Double {
        guard case .number(let d) = try required(a, k) else { throw CoreError.badArgs(k + " must be a number") }
        return d
    }

    static func optNumber(_ a: JSObject, _ k: String) throws -> Double? {
        guard let v = a[k] else { return nil }
        guard case .number(let d) = v else { throw CoreError.badArgs(k + " must be a number") }
        return d
    }

    /// 数据描述的 hasInk：{ids, throwIds?}；键缺省 = 没有注入函数。
    static func hasInkSpec(_ a: JSObject, _ k: String) throws -> InkPick.HasInk? {
        guard let v = a[k] else { return nil }
        guard case .object(let o) = v else { throw CoreError.badArgs(k + " must be an object") }
        let ids = try strings(try required(o, "ids"), k + ".ids")
        let thr = try optStrings(o, "throwIds") ?? []
        return { r in
            if case .string(let id)? = r["id"], thr.contains(where: { JSX.eq($0, id) }) { throw CoreError.error("x") }
            if case .string(let id)? = r["id"] { return ids.contains { JSX.eq($0, id) } }
            return false
        }
    }

    static func arr(_ l: [JSValue]) -> JSValue { .array(l) }
    static func str(_ s: String) -> JSValue { .string(s) }
    static func strs(_ l: [String]) -> JSValue { .array(l.map { .string($0) }) }
    static func num(_ d: Double) -> JSValue { .number(d) }
    static func pairs(_ m: OMap<JSValue>) -> JSValue { .array(m.entries.map { .array([.string($0.key), $0.value]) }) }
    static func optStr(_ s: String?) -> JSValue { s.map { .string($0) } ?? .null }

    static func records(_ a: JSObject) throws -> [JSValue] { try array(a, "records") }

    static func points(_ v: JSValue, _ k: String) throws -> [InkPoint] {
        guard case .array(let l) = v else { throw CoreError.badArgs(k + " must be an array") }
        return try l.map { guard let p = InkPoint(js: $0) else { throw CoreError.badArgs(k + " must be an array of point objects") }; return p }
    }

    static func strokes(_ a: JSObject, _ k: String) throws -> [[InkPoint]] {
        try array(a, k).map { try points($0, k) }
    }

    static func strokesJS(_ s: [[InkPoint]]) -> JSValue { .array(s.map { .array($0.map { $0.js }) }) }

    static func rowsOf(_ v: JSValue, _ k: String) throws -> [[Double]] {
        guard case .array(let l) = v else { throw CoreError.badArgs(k + " must be an array") }
        return l.map { r in
            guard case .array(let e) = r else { return [.nan] }
            var out: [Double] = []
            for x in e { if case .number(let d) = x { out.append(d) } else { return [.nan] } }
            return out
        }
    }

    static func rowsJS(_ rows: [[Double]]) -> JSValue { .array(rows.map { .array($0.map { .number($0) }) }) }

    static func policyArg(_ a: JSObject) throws -> JSObject? {
        guard let o = try optObject(a, "policy") else { return nil }
        // JS 侧是 {...真实 policy, ...覆盖}
        return Reminder.policyObject(o)
    }

    static func toleranceArg(_ a: JSObject) throws -> InkMath.ToleranceSetting {
        guard let v = a["tolerance"] else { return .policyDefault }
        if v.isNull { return .none }
        guard case .object = v else { throw CoreError.badArgs("tolerance must be an object or null") }
        return .value(InkMath.Tolerance(js: v) ?? InkMath.Tolerance())
    }

    static func card(_ a: JSObject, _ k: String = "card") throws -> JSValue {
        guard case .object = try required(a, k) else { throw CoreError.badArgs(k + " must be an object") }
        return a[k]!
    }

    static func copyArg(_ a: JSObject) throws -> JSObject? { try optObject(a, "copy") }

    static func stateArg(_ a: JSObject) throws -> JSValue { guard case .object = try required(a, "state") else { throw CoreError.badArgs("state must be an object") }; return a["state"]! }

    static let b43Ops: [String: Op] = recordOps.merging(queryOps) { a, _ in a }.merging(cardOps) { a, _ in a }
        .merging(memberOps) { a, _ in a }.merging(inkOps) { a, _ in a }

    // MARK: records

    static let recordOps: [String: Op] = [
        "records.recordSerial": { _, a in num(Records.recordSerial(try required(a, "id"))) },
        "records.sessionSerial": { _, a in num(Records.sessionSerial(try required(a, "id"))) },
        "records.recordId": { _, a in str(try Records.recordId(try numberArg(a, "serial"))) },
        "records.sessionId": { _, a in str(try Records.sessionId(try numberArg(a, "serial"))) },
        "records.compareRecordIds": { _, a in num(Records.compareRecordIds(try required(a, "a"), try required(a, "b"))) },
        "records.sortById": { _, a in arr(Records.sortById(try records(a))) },
        "records.nextSerial": { _, a in
            let recs = try optArray(a, "records") ?? []
            var meta = 0.0
            if case .number(let d)? = a["metaSerial"] { meta = d }
            return num(Records.nextSerial(records: recs, sessions: a["sessions"], metaSerial: meta))
        },
        "records.charOfCardKey": { _, a in optStr(Records.charOfCardKey(try required(a, "cardKey"))) },
        "records.validateRecord": { e, a in strs(Records.validateRecord(try required(a, "record"), dates: e.dates)) },
        "records.makeRecord": { e, a in try Records.makeRecord(a, dates: e.dates) },
        "records.predicates": { _, a in
            let r = try required(a, "record")
            return .object(JSObject([
                ("recordSource", str(Records.recordSource(r))), ("isPaperRecord", .bool(Records.isPaperRecord(r))),
                ("isWorkRecord", .bool(Records.isWorkRecord(r))), ("isJudged", .bool(Records.isJudged(r))), ("isSeenOnly", .bool(Records.isSeenOnly(r))),
            ]))
        },
        "records.isAfterSeenWork": { _, a in .bool(Records.isAfterSeenWork(try required(a, "record"), try hasInkSpec(a, "hasInk"))) },
        "records.isWorkOrAfterSeen": { _, a in .bool(Records.isWorkOrAfterSeen(try required(a, "record"), try hasInkSpec(a, "hasInk"))) },
        "records.withoutPaper": { _, a in arr(Records.withoutPaper(try records(a))) },
        "records.foldWorkByDay": { _, a in .object(Records.foldWorkByDay(try required(a, "fold"), order: JSX.eq(a["order"], "last") ? "last" : "first", judgedOnly: a["judgedOnly"] == .bool(true))) },
        "records.correctRecord": { _, a in try Records.correctRecord(try required(a, "record"), try required(a, "judgment"), at: try required(a, "at")) },
        "records.replaceRecord": { _, a in arr(try Records.replaceRecord(try records(a), try required(a, "next"))) },
        "records.removeRecord": { _, a in arr(try Records.removeRecord(try records(a), try required(a, "id"))) },
        "records.latestJudgedByCard": { _, a in pairs(Records.latestJudgedByCard(try records(a))) },
        "records.practicedByChar": { _, a in pairs(Records.practicedByChar(try records(a))) },
        "records.latestJudged": { _, a in Records.latestJudged(try records(a), try string(a, "cardKey")) ?? .null },
        "records.recordsOfCard": { _, a in arr(Records.recordsOfCard(try records(a), try string(a, "cardKey"))) },
        "records.judgedCountOfCard": { _, a in num(Double(Records.judgedCountOfCard(try records(a), try string(a, "cardKey")))) },
        "records.wrongCountOfCard": { _, a in num(Double(Records.wrongCountOfCard(try records(a), try string(a, "cardKey")))) },
        "records.firstJudgedOfCard": { _, a in Records.firstJudgedOfCard(try records(a), try string(a, "cardKey")) ?? .null },
        "records.writtenCardKeys": { _, a in strs(Records.writtenCardKeys(try records(a))) },
        "records.hasAnyJudged": { _, a in .bool(Records.hasAnyJudged(try records(a))) },
        "records.wrongList": { _, a in arr(Records.wrongList(try records(a))) },
        "records.isInWrongList": { _, a in .bool(Records.isInWrongList(try records(a), try string(a, "cardKey"))) },
        "records.forgetList": { e, a in
            let r = try Records.forgetList(records: try records(a), sched: a["sched"], today: try required(a, "today"), dates: e.dates, policy: try policyArg(a))
            return .object(JSObject([
                ("items", arr(r.items.map { .object(JSObject([("cardKey", str($0.cardKey)), ("record", $0.record), ("due", str($0.due)), ("overdue", num($0.overdue))])) })),
                ("total", num(Double(r.total))),
            ]))
        },
        "records.judgedCardKeysOn": { _, a in strs(Records.judgedCardKeysOn(try records(a), try string(a, "day"))) },
        "records.answerSeenCardKeysOn": { _, a in strs(Records.answerSeenCardKeysOn(try records(a), try string(a, "day"))) },
        "records.skippedCardKeysOn": { _, a in strs(Records.skippedCardKeysOn(try records(a), try string(a, "day"), fromDay: try optionalString(a, "fromDay"))) },
        "records.todayCount": { _, a in num(Double(Records.todayCount(try records(a), try string(a, "today")))) },
        "records.reviewsDoneOn": { _, a in num(Double(Records.reviewsDoneOn(try records(a), try string(a, "day")))) },
        "records.recordsByMonth": { e, a in .object(try Records.recordsByMonth(try records(a), dates: e.dates)) },
        "records.judgedDaysInMonth": { _, a in strs(Records.judgedDaysInMonth(try records(a), try string(a, "month"))) },
    ]

    // MARK: query

    static func filteredArg(_ a: JSObject) throws -> Query.Filtered? {
        guard let v = a["filtered"], !v.isNull else { return nil }
        guard let f = Query.Filtered(js: v) else { throw CoreError.badArgs("filtered must be a filterInput result") }
        return f
    }

    static let queryOps: [String: Op] = [
        "query.pyKey": { _, a in str(Query.pyKey(try required(a, "py"))) },
        "query.parsePinyinInput": { _, a in Query.parsePinyinInput(try required(a, "text")) ?? .null },
        "query.pinyinMatches": { _, a in
            strs(Query.pinyinMatches(try string(a, "query"), try array(a, "entries"), written: try optStrings(a, "written"), max: a["max"]))
        },
        "query.writtenChars": { _, a in strs(Query.writtenChars(try records(a))) },
        "query.isHan": { _, a in .bool(Query.isHan(try required(a, "value"))) },
        "query.filterInput": { _, a in Query.filterInput(try required(a, "text"), max: a["max"]).js },
        "query.filterNotes": { _, a in arr(Query.filterNotes(try filteredArg(a), view: try optionalString(a, "view"))) },
        "query.flattenRecords": { _, a in arr(Query.flattenRecords(try required(a, "domain"))) },
        "query.isPracticable": { _, a in
            let deck = try optStrings(a, "deck"), lib = try optStrings(a, "library")
            return .bool(Query.isPracticable(try required(a, "char"),
                                             inDeck: deck.map { d in { c in d.contains { JSX.eq($0, c) } } },
                                             inLibrary: lib.map { d in { c in d.contains { JSX.eq($0, c) } } }))
        },
        "query.customChars": { _, a in strs(Query.customChars(try required(a, "custom"))) },
        "query.isCustom": { _, a in .bool(Query.isCustom(try required(a, "custom"), try string(a, "char"))) },
        "query.withCustomAdded": { _, a in try Query.withCustomAdded(try required(a, "custom"), try required(a, "char"), try required(a, "at")) ?? .null },
        "query.charSummary": { _, a in
            Query.charSummary(try string(a, "char"), records: try optArray(a, "records") ?? [], sched: a["sched"], custom: a["custom"], practicable: JSX.truthy(a["practicable"]))
        },
        "query.rowStatus": { _, a in Query.rowStatus(try object(a, "summary").asValue) },
        "query.cardStat": { _, a in Query.cardStat(try object(a, "summary").asValue) },
        "query.queryView": { _, a in
            let chars = try strings(try required(a, "chars"), "chars")
            let prac = try optStrings(a, "practicable") ?? []
            let r = Query.queryView(chars: chars, cur: try optionalString(a, "cur") ?? "", practicable: { c in prac.contains { JSX.eq($0, c) } })
            return .object(JSObject([("view", str(r.view)), ("cur", str(r.cur))]))
        },
        "query.selectedChars": { _, a in
            let prac = try optStrings(a, "practicable")
            return strs(Query.selectedChars(try strings(try required(a, "chars"), "chars"), try strings(try required(a, "selected"), "selected"),
                                            practicable: prac.map { p in { c in p.contains { JSX.eq($0, c) } } } ?? { _ in true }))
        },
        "query.pickBar": { _, a in Query.pickBar(try required(a, "count")) },
        "query.normalizeMode": { _, a in str(try Query.normalizeMode(try required(a, "mode"), policy: try policyArg(a))) },
    ]
}

extension JSObject {
    var asValue: JSValue { .object(self) }
}
