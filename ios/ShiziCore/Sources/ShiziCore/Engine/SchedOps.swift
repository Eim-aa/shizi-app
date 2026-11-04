import Foundation

// B4.2 的 op（FSRS 与出题调度）。JS 参考实现（同名、同参数校验、同错误码）已随 D84 退役。

extension CoreEngine {
    var rules: ScheduleRules { ScheduleRules(dates: dates) }

    // ---- 参数校验 ----

    static func objArg(_ a: JSObject, _ k: String) throws -> JSValue {
        let v = try required(a, k)
        guard case .object = v else { throw CoreError.badArgs(k + " must be an object") }
        return v
    }

    static func optObj(_ a: JSObject, _ k: String) throws -> JSValue? {
        guard let v = a[k] else { return nil }
        guard case .object = v else { throw CoreError.badArgs(k + " must be an object") }
        return v
    }

    static func arrOfObj(_ a: JSObject, _ k: String) throws -> [JSValue] {
        guard case .array(let arr) = try required(a, k), arr.allSatisfy({ $0.objectValue != nil }) else { throw CoreError.badArgs(k + " must be an array of objects") }
        return arr
    }

    static func strArr(_ a: JSObject, _ k: String) throws -> [String] {
        guard case .array(let arr) = try required(a, k) else { throw CoreError.badArgs(k + " must be an array of strings") }
        var out: [String] = []
        for v in arr {
            guard case .string(let s) = v else { throw CoreError.badArgs(k + " must be an array of strings") }
            out.append(s)
        }
        return out
    }

    static func optBool(_ a: JSObject, _ k: String) throws -> Bool? {
        guard let v = a[k] else { return nil }
        guard case .bool(let b) = v else { throw CoreError.badArgs(k + " must be a boolean") }
        return b
    }

    static func policyOf(_ a: JSObject) throws -> JSValue {
        guard let p = try optObj(a, "policy") else { return Config.policy }
        return JS.with(Config.policy, (p.objectValue?.entries ?? []).map { ($0.key, $0.value) })
    }

    static let schedOps: [String: Op] = [
        // ---- fsrs ----
        "fsrs.ratingFor": { _, a in
            .string(try ScheduleRules.ratingFor(try required(a, "judgment"), a["help"], policy: try policyOf(a), first: try optBool(a, "first") == true, warmup: try optBool(a, "warmup") == true))
        },
        "fsrs.emptyCard": { e, a in try e.rules.emptyCard(try required(a, "at")) },
        "fsrs.isCompactCard": { e, a in .bool(e.rules.isCompactCard(try required(a, "value"))) },
        "fsrs.answerSeenAgainApplies": { e, a in .bool(try e.rules.answerSeenAgainApplies(try optObj(a, "entry"), try objArg(a, "record"), policy: try policyOf(a))) },
        "fsrs.retrievability": { e, a in
            let entry = try optObj(a, "entry")
            return (try e.rules.retrievability(entry, now: try required(a, "now"))).map { .number($0) } ?? .null
        },

        // ---- mix ----
        "mix.practiceStats": { e, a in
            try e.rules.practiceStats(try arrOfObj(a, "records"), try string(a, "today"), policy: try policyOf(a), isWarm: NewOrder.isWarmupKey).js
        },

        // ---- new-order / special / group-size ----
        "newOrder.orderNewKeys": { _, a in strs(NewOrder.orderNewKeys(try strArr(a, "keys"))) },
        "newOrder.warmupKeys": { _, a in strs(NewOrder.warmupKeys(try strArr(a, "keys"))) },
        "newOrder.capital": { _, _ in obj([("groups", .array(NewOrder.capitalGroupKeys().map { strs($0) })), ("after", strs(NewOrder.capitalAfterKeys()))]) },

        "schedDeck.facts": { _, a in
            let d = ScheduleDeck.real
            let lib = a["libraryId"] ?? .null
            let nc = d.newCandidates(lib)
            return obj([("newCandidates", strs(Array(nc.prefix(40)))), ("newCount", .number(Double(nc.count))), ("warmup", strs(d.warmupCandidates!(lib))),
                        ("current", d.currentLibraryId!(a["settings"]))])
        },
    ]
}
