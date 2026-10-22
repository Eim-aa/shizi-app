import Foundation

// B4.2 的 op（FSRS 与出题调度）。参考实现在 scripts/core-diff/lib/js-ops-b42.mjs（同名、同参数校验、同错误码；约定见那边文件头）。

extension CoreEngine {
    var rules: ScheduleRules { ScheduleRules(dates: dates) }

    // ---- 参数校验（与 js-ops-b42.mjs 同一规则）----

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

    static func optArrOfObj(_ a: JSObject, _ k: String) throws -> [JSValue]? { a[k] == nil ? nil : try arrOfObj(a, k) }

    static func strArr(_ a: JSObject, _ k: String) throws -> [String] {
        guard case .array(let arr) = try required(a, k) else { throw CoreError.badArgs(k + " must be an array of strings") }
        var out: [String] = []
        for v in arr {
            guard case .string(let s) = v else { throw CoreError.badArgs(k + " must be an array of strings") }
            out.append(s)
        }
        return out
    }

    static func optStrArr(_ a: JSObject, _ k: String) throws -> [String]? { a[k] == nil ? nil : try strArr(a, k) }

    static func schedArg(_ a: JSObject, _ k: String) throws -> JSValue {
        let v = try required(a, k)
        guard case .object(let o) = v, o.entries.allSatisfy({ $0.value.isNull || $0.value.objectValue != nil }) else {
            throw CoreError.badArgs(k + " must be an object of entries")
        }
        return v
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

    static func deckOf(_ a: JSObject) throws -> ScheduleDeck {
        if a["deck"] == .string("real") { return ScheduleDeck.real }
        guard let d = try optObj(a, "deck")?.objectValue else { return ScheduleDeck.real }
        func list(_ k: String) throws -> [String]? {
            guard let v = d[k] else { return nil }
            guard case .array(let arr) = v else { throw CoreError.badArgs("deck." + k + " must be an array of strings") }
            return try arr.map { x -> String in
                guard case .string(let s) = x else { throw CoreError.badArgs("deck." + k + " must be an array of strings") }
                return s
            }
        }
        let cands = try list("newCandidates") ?? []
        let warm = try list("warmupCandidates")
        let prac = try list("practicable")
        var current: JSValue? = nil
        if let c = d["currentLibraryId"] {
            guard case .string = c else { throw CoreError.badArgs("deck.currentLibraryId must be a string") }
            current = c
        }
        let known = prac.map { KeySet($0) }
        return ScheduleDeck(
            newCandidates: { _ in cands },
            warmupCandidates: warm.map { w in { _ in w } },
            practicable: { k in known.map { $0.contains(k) } ?? ScheduleRules.defaultPracticable(k) },
            currentLibraryId: current.map { c in { _ in c } })
    }

    static func practicableOf(_ a: JSObject) throws -> ((String) -> Bool)? {
        guard a["practicable"] != nil else { return nil }
        let known = KeySet(try strArr(a, "practicable"))
        return { known.contains($0) }
    }

    static func orNull(_ v: JSValue?) -> JSValue { v ?? .null }

    /// state 参数：对象，或 "mirror"（用镜像）。
    func stateArg(_ a: JSObject) throws -> JSValue {
        if a["state"] == .string("mirror") { return .object(schedMirror) }
        return try CoreEngine.objArg(a, "state")
    }

    func patchMirror(_ a: JSObject) throws {
        var next = schedMirror
        if a["set"] != nil {
            for (k, v) in try CoreEngine.objArg(a, "set").objectValue!.entries { next[k] = v }
        }
        if a["drop"] != nil { for k in try CoreEngine.strArr(a, "drop") { next[k] = nil } }
        if a["records"] != nil {
            let months = try CoreEngine.objArg(a, "records").objectValue!
            var cur = next["records"]?.objectValue ?? JSObject()
            for (m, v) in months.entries { cur[m] = v.isNull ? nil : v }
            next["records"] = .object(cur)
        }
        if a["sched"] != nil {
            let entries = try CoreEngine.objArg(a, "sched").objectValue!
            var cur = next["sched"]?.objectValue ?? JSObject()
            for (k, v) in entries.entries { cur[k] = v.isNull ? nil : v }
            next["sched"] = .object(cur)
        }
        schedMirror = next
    }

    /// 提交类 op：在内存 store 上跑，回包 {result, commits:[{label, set, schedPatch?, serial}], serial}。
    static func runStore(_ e: CoreEngine, _ a: JSObject, _ fn: (MemoryScheduleStore, Double) throws -> JSValue) throws -> JSValue {
        guard case .object(let state) = try e.stateArg(a) else { throw CoreError.badArgs("state must be an object") }
        let serial = Double(try int(a, "serial", 1_000_000_000_000))
        let now = try finite(try required(a, "now"), "now")
        let store = MemoryScheduleStore(state: state, now: { now }, serial: serial)
        let result = try fn(store, now)
        let commits: [JSValue] = store.commits.map { c in
            var set = JSObject()
            var patch: JSObject? = nil
            for (k, v) in c.after.entries {
                if k == "sched" {
                    let before = c.before["sched"]?.objectValue ?? JSObject()
                    for (key, e) in (v.objectValue ?? JSObject()).entries {
                        if let b = before[key], JSONWriter.stringify(b) == JSONWriter.stringify(e) { continue }
                        if patch == nil { patch = JSObject() }
                        patch![key] = e
                    }
                } else if c.before[k].map({ JSONWriter.stringify($0) }) != JSONWriter.stringify(v) {
                    set[k] = v
                }
            }
            var o = JSObject([("label", .string(c.label)), ("set", .object(set))])
            if let p = patch { o["schedPatch"] = .object(p) }
            o["serial"] = .number(c.serial)
            return .object(o)
        }
        return obj([("result", result), ("commits", .array(commits)), ("serial", .number(store.serial))])
    }

    static func sourceOf(_ a: JSObject) throws -> JSValue? { a["source"] == nil ? nil : try objArg(a, "source") }

    static func keysArg(_ a: JSObject) throws -> [JSValue] {
        guard case .array(let arr) = try required(a, "keys") else { throw CoreError.badArgs("keys must be an array") }
        return arr
    }

    static func numOrString(_ d: Double) -> JSValue { d == .infinity ? .string("Infinity") : .number(d) }

    static let schedOps: [String: Op] = [
        "mirror.patch": { e, a in
            try e.patchMirror(a)
            return .null
        },
        "mirror.get": { e, _ in .object(e.schedMirror) },
        "tz.set": { e, a in
            let zone = try string(a, "zone")
            guard let tz = TimeZone(identifier: zone) else { throw CoreError.badArgs("unknown zone " + zone) }
            e.dates = Dates(timeZone: tz)
            return .null
        },

        // ---- fsrs ----
        "fsrs.ratingFor": { _, a in
            .string(try ScheduleRules.ratingFor(try required(a, "judgment"), a["help"], policy: try policyOf(a), first: try optBool(a, "first") == true, warmup: try optBool(a, "warmup") == true))
        },
        "fsrs.emptyCard": { e, a in try e.rules.emptyCard(try required(a, "at")) },
        "fsrs.isCompactCard": { e, a in .bool(e.rules.isCompactCard(try required(a, "value"))) },
        "fsrs.reviewCard": { e, a in
            let w = try optBool(a, "warmup")
            let before = a["before"] == nil ? nil : try objArg(a, "before")
            return try e.rules.reviewCard(before, try objArg(a, "review"), policy: try policyOf(a), warmup: w).js
        },
        "fsrs.answerSeenAgainApplies": { e, a in .bool(try e.rules.answerSeenAgainApplies(try optObj(a, "entry"), try objArg(a, "record"), policy: try policyOf(a))) },
        "fsrs.applyAnswerSeen": { e, a in
            let r = try e.rules.applyAnswerSeen(try optObj(a, "entry"), try objArg(a, "record"), policy: try policyOf(a))
            return obj([("entry", orNull(r.entry)), ("applied", .bool(r.applied))])
        },
        "fsrs.applyJudgment": { e, a in
            let entry = try optObj(a, "entry")
            let record = try objArg(a, "record")
            let p = try policyOf(a)
            let r = try e.rules.applyJudgment(entry, record, policy: p, records: try optArrOfObj(a, "records"))
            return obj([("entry", r.entry), ("fsrsBefore", r.fsrsBefore)])
        },
        "fsrs.replay": { e, a in
            let before = a["fsrsBefore"] == nil ? nil : try objArg(a, "fsrsBefore")
            let records = try arrOfObj(a, "records")
            return orNull(try e.rules.replay(before, records, policy: try policyOf(a), stoppedAt: a["stoppedAt"]))
        },
        "fsrs.overdueDays": { e, a in
            let entry = try optObj(a, "entry")
            return (try e.rules.overdueDays(entry, try required(a, "today"))).map { .number($0) } ?? .null
        },
        "fsrs.isDue": { e, a in
            let entry = try optObj(a, "entry")
            return .bool(try e.rules.isDue(entry, try required(a, "today")))
        },
        "fsrs.retrievability": { e, a in
            let entry = try optObj(a, "entry")
            return (try e.rules.retrievability(entry, now: try required(a, "now"))).map { .number($0) } ?? .null
        },

        // ---- mix ----
        "mix.practiceStats": { e, a in
            try e.rules.practiceStats(try arrOfObj(a, "records"), try string(a, "today"), policy: try policyOf(a), isWarm: NewOrder.isWarmupKey).js
        },
        "mix.scaledCount": { _, a in
            .number(Mix.scaledCount(try finite(try required(a, "n"), "n"), try finite(try required(a, "size"), "size"), mix: try policyOf(a)["groupMix"]))
        },
        "mix.pressureOf": { _, a in
            let backlog = try finite(try required(a, "backlog"), "backlog")
            let gpd = try finite(try required(a, "groupsPerDay"), "groupsPerDay")
            let p = try policyOf(a)
            let size = try a["size"].map { try finite($0, "size") }
            return .number(Mix.pressureOf(backlog, gpd, mix: p["groupMix"], size: size))
        },
        "mix.newTargetOf": { _, a in
            let s = try objArg(a, "state")
            let p = try policyOf(a)
            let size = try a["size"].map { try finite($0, "size") }
            let st = MixState(backlog: JS.number(s["backlog"]), groupsPerDay: JS.number(s["groupsPerDay"]), newAccuracy: JS.number(s["newAccuracy"]),
                              lastHadNew: s["lastHadNew"], firstBack: s["firstBack"])
            return .number(Mix.newTargetOf(st, mix: p["groupMix"], size: size))
        },
        "mix.planGroup": { _, a in
            let size = try finite(try required(a, "size"), "size")
            let budget = try finite(try required(a, "budget"), "budget")
            let due = try strArr(a, "due")
            let early = try strArr(a, "early")
            var warmNext: String? = nil
            if let w = a["warmNext"], !w.isNull { warmNext = try string(a, "warmNext") }
            let warmOk = try optBool(a, "warmOk") == true
            let s = try objArg(a, "state")
            let p = try policyOf(a)
            func num(_ k: String) throws -> Double? { try a[k].map { try finite($0, k) } }
            let st = MixState(backlog: JS.number(s["backlog"]), groupsPerDay: JS.number(s["groupsPerDay"]), newAccuracy: JS.number(s["newAccuracy"]),
                              lastHadNew: s["lastHadNew"], firstBack: s["firstBack"])
            return Mix.planGroup(size: size, budget: budget, due: due, early: early, isWarm: NewOrder.isWarmupKey, warmNext: warmNext, warmOk: warmOk, state: st,
                                 mix: p["groupMix"], newAvailable: try num("newAvailable") ?? .infinity, reserve: try num("reserve") ?? 0,
                                 pressureSize: try num("pressureSize"), newCap: try num("newCap") ?? .infinity).js
        },
        "mix.arrangeGroup": { _, a in
            var warmNew: String? = nil
            if let w = a["warmNew"], !w.isNull { warmNew = try string(a, "warmNew") }
            return strs(Mix.arrangeGroup(warmNew: warmNew, revKeys: try strArr(a, "revKeys"), earlyKeys: try strArr(a, "earlyKeys"), newKeys: try strArr(a, "newKeys"), isWarm: NewOrder.isWarmupKey))
        },
        "mix.dueReviewsDoneOn": { e, a in
            let records = try arrOfObj(a, "records")
            let today = try string(a, "today")
            return .number(e.rules.dueReviewsDoneOn(records, today, sched: try schedArg(a, "sched"), policy: try policyOf(a)))
        },
        "mix.newUserCapOf": { e, a in
            let p = try policyOf(a)
            let stats = try e.rules.practiceStats(try arrOfObj(a, "records"), try string(a, "today"), policy: p, isWarm: NewOrder.isWarmupKey)
            let size = try finite(try required(a, "size"), "size")
            let cap = Mix.newUserCapOf(stats, ramp: p["newUserRamp"], size: size, mix: p["groupMix"])
            return cap == .infinity ? .null : .number(cap) // JSON.stringify(Infinity) = null
        },
        "mix.warmupAllowed": { e, a in
            let p = try policyOf(a)
            let stats = try e.rules.practiceStats(try arrOfObj(a, "records"), try string(a, "today"), policy: p, isWarm: NewOrder.isWarmupKey)
            return .bool(try Mix.warmupAllowed(stats, warm: p["warmup"]))
        },

        // ---- sessions ----
        "sessions.createSession": { e, a in
            try SessionRules.createSession(id: a["id"], kind: a["kind"], source: a["source"], queue: a["queue"], at: a["at"], dates: e.dates)
        },
        "sessions.currentCardKey": { _, a in orNull(SessionRules.currentCardKey(try objArg(a, "session"))) },
        "sessions.remaining": { _, a in
            let s = try objArg(a, "session")
            return obj([("keys", .array(SessionRules.remainingKeys(s))), ("count", .number(SessionRules.remainingCount(s))), ("complete", .bool(SessionRules.isComplete(s))),
                        ("judged", .array(SessionRules.judgedItems(s)))])
        },
        "sessions.withCurrent": { _, a in try SessionRules.withCurrent(try objArg(a, "session"), a["patch"], at: a["at"]) },
        "sessions.advance": { _, a in
            try SessionRules.advance(try objArg(a, "session"), cardKey: a["cardKey"], recordId: a["recordId"], kind: a["kind"], fsrsBefore: a["fsrsBefore"], at: a["at"])
        },
        "sessions.markLineChanged": { _, a in SessionRules.markLineChanged(try objArg(a, "session"), a["recordId"]) },
        "sessions.clearLine": { _, a in SessionRules.clearLine(try objArg(a, "session")) },
        "sessions.undoSkip": { _, a in try SessionRules.undoSkip(try objArg(a, "session"), a["recordId"], at: a["at"]) },
        "sessions.fsrsBeforeOf": { _, a in orNull(SessionRules.fsrsBeforeOf(try objArg(a, "session"), a["recordId"])) },
        "sessions.canCorrect": { _, a in .bool(SessionRules.canCorrect(try objArg(a, "session"), a["recordId"])) },
        "sessions.startInSlot": { _, a in try SessionRules.startInSlot(try objArg(a, "sessions"), try objArg(a, "session")) },
        "sessions.endSlot": { _, a in
            let ss = try objArg(a, "sessions")
            let slot = try string(a, "slot")
            let at = a["at"]
            return try SessionRules.endSlot(ss, slot, at: at, early: try optBool(a, "early") == true)
        },
        "sessions.clearLastEnded": { _, a in SessionRules.clearLastEnded(try objArg(a, "sessions"), try string(a, "slot")) },
        "sessions.resumeLines": { _, a in SessionRules.resumeLines(try objArg(a, "sessions")) },
        "sessions.s02Prompt": { _, a in SessionRules.s02Prompt(try objArg(a, "sessions")) },
        "sessions.endAndStartPicked": { _, a in
            let ss = try objArg(a, "sessions")
            let s = try objArg(a, "session")
            let r = try SessionRules.endAndStartPicked(ss, s, at: a["at"], policy: try policyOf(a))
            return obj([("sessions", r.sessions), ("notice", r.notice), ("showOldResult", .bool(r.showOldResult))])
        },
        "sessions.expireDaily": { _, a in
            let ss = try objArg(a, "sessions")
            let today = try required(a, "today")
            let r = try SessionRules.expireDaily(ss, today, policy: try policyOf(a))
            return obj([("sessions", r.sessions), ("expired", orNull(r.expired)), ("expiredAll", .array(r.expiredAll))])
        },
        "sessions.recoverSession": { _, a in
            let s = try objArg(a, "session")
            let r = try SessionRules.recoverSession(s, try arrOfObj(a, "records"))
            return obj([("session", orNull(r.session)), ("recovered", .bool(r.recovered))])
        },
        "sessions.nextAKind": { _, a in
            let records = try arrOfObj(a, "records")
            return .string(SessionRules.nextAKind(records, policy: try policyOf(a), everPracticed: try optBool(a, "everPracticed") == true))
        },
        "sessions.selectFirst": { _, a in strs(SessionRules.selectFirst(policy: try policyOf(a))) },
        "sessions.wrongReserveOf": { _, a in .number(SessionRules.wrongReserveOf(try finite(try required(a, "size"), "size"), policy: try policyOf(a))) },
        "sessions.skipDeferredNewKeys": { e, a in
            let records = try arrOfObj(a, "records")
            let today = try string(a, "today")
            return strs(try e.rules.skipDeferredNewKeys(records, today, policy: try policyOf(a)).items)
        },
        "sessions.selectDaily": { e, a in
            let sched = try schedArg(a, "sched")
            let records = try arrOfObj(a, "records")
            let today = try string(a, "today")
            let nc = try optStrArr(a, "newCandidates") ?? []
            let wc = try optStrArr(a, "warmupCandidates") ?? []
            let custom = a["custom"] == nil ? JSValue.null : try objArg(a, "custom")
            let p = try policyOf(a)
            let prac = try practicableOf(a) ?? ScheduleRules.defaultPracticable
            return try e.rules.selectDaily(sched: sched, records: records, today: today, newCandidates: nc, warmupCandidates: wc, custom: custom, practicable: prac,
                                           policy: p, capitalDeferredDay: a["capitalDeferredDay"] ?? .null, groupSize: a["groupSize"] ?? .null).js
        },
        "sessions.specialPlan": { e, a in
            let sched = try schedArg(a, "sched")
            let records = try arrOfObj(a, "records")
            let today = try string(a, "today")
            let p = try policyOf(a)
            let prac = try practicableOf(a) ?? ScheduleRules.defaultPracticable
            let r = try e.rules.specialPlan(sched: sched, records: records, today: today, practicable: prac, policy: p,
                                            capitalDeferredDay: a["capitalDeferredDay"] ?? .null, groupSize: a["groupSize"] ?? .null)
            return r.map { obj([("kind", .string($0.kind)), ("keys", strs($0.keys))]) } ?? .null
        },

        // ---- new-order / special / group-size ----
        "newOrder.orderNewKeys": { _, a in strs(NewOrder.orderNewKeys(try strArr(a, "keys"))) },
        "newOrder.warmupKeys": { _, a in strs(NewOrder.warmupKeys(try strArr(a, "keys"))) },
        "newOrder.facts": { _, a in
            let ch = try string(a, "char")
            return obj([("reserved", .bool(NewOrder.isReservedChar(ch))), ("warmup", .bool(NewOrder.isWarmupChar(ch))), ("capital", .bool(NewOrder.isCapitalChar(ch))),
                        ("warmupKey", .bool(NewOrder.isWarmupKey("base:" + ch)))])
        },
        "newOrder.capital": { _, _ in obj([("groups", .array(NewOrder.capitalGroupKeys().map { strs($0) })), ("after", strs(NewOrder.capitalAfterKeys()))]) },
        "newOrder.isCapitalQueue": { _, a in .bool(NewOrder.isCapitalQueue(try required(a, "queue").arrayValue)) },
        "special.capitalProgress": { _, a in
            let records = try arrOfObj(a, "records")
            return .array(Special.capitalProgress(records, policy: try policyOf(a)).map { obj([("keys", strs($0.keys)), ("done", .bool($0.done))]) })
        },
        "special.capitalAfterKeysFor": { _, a in
            let records = try arrOfObj(a, "records")
            return strs(Special.capitalAfterKeysFor(records, policy: try policyOf(a)))
        },
        "special.isDeferred": { _, a in .bool(Special.isDeferred(a["deferredDay"], a["today"])) },
        "groupSize.of": { _, a in orNull(GroupSize.of(a["settings"], policy: try policyOf(a))) },
        "groupSize.valid": { _, a in orNull(GroupSize.valid(a["value"], policy: try policyOf(a))) },
        "groupSize.dailyReviewCapOf": { _, a in .number(GroupSize.dailyReviewCapOf(a["size"], policy: try policyOf(a))) },
        "groupSize.listDefaultSelectOf": { _, a in numOrString(GroupSize.listDefaultSelectOf(a["settings"], policy: try policyOf(a))) },

        // ---- spread ----
        "spread.spreadDue": { e, a in
            let sched = try schedArg(a, "sched")
            let today = try string(a, "today")
            let perDay = try finite(try required(a, "perDay"), "perDay")
            let r = try e.rules.spreadDue(sched, today: today, perDay: perDay)
            return obj([("sched", .object(r.sched)), ("moved", .number(Double(r.moved)))])
        },
        "spread.returnSpreadPerDay": { _, a in .number(ScheduleRules.returnSpreadPerDay(a["settings"], policy: try policyOf(a))) },
        "spread.returnSpreadPlan": { e, a in
            let state = try objArg(a, "state")
            let today = try required(a, "today")
            guard let p = try e.rules.returnSpreadPlan(state, today, policy: try policyOf(a)) else { return .null }
            return obj([("sched", .object(p.sched)), ("moved", .number(Double(p.moved))), ("lastDay", .string(p.lastDay)), ("perDay", .number(p.perDay)), ("gapDays", .number(p.gapDays))])
        },

        // ---- hints ----
        "hints.quota": { _, a in .number(try Hints.quota(try required(a, "totalStrokes"))) },
        "hints.facts": { _, a in
            let input = try objArg(a, "input")
            func safe(_ fn: () throws -> JSValue) -> JSValue {
                do { return obj([("ok", .bool(true)), ("value", try fn())]) } catch let e as CoreError {
                    return obj([("ok", .bool(false)), ("error", .string(e.code == "range" ? "range" : "error"))])
                } catch { return obj([("ok", .bool(false)), ("error", .string("error"))]) }
            }
            return obj([
                ("mode", .string(Hints.mode(input))),
                ("given", safe { .number(try Hints.given(input)) }),
                ("segments", safe { .number(try Hints.segments(input)) }),
                ("remaining", safe { .number(try Hints.remaining(input)) }),
                ("allGiven", safe { .bool(try Hints.allGiven(input)) }),
                ("next", safe { try Hints.nextRange(input) }),
            ])
        },
        "hints.button": { _, a in
            let st = try Hints.buttonState(try objArg(a, "input"))
            return obj([("state", st), ("copy", try Hints.buttonCopy(st))])
        },

        // ---- correct ----
        "correct.findFsrsBefore": { _, a in orNull(ScheduleRules.findFsrsBefore(try objArg(a, "sessions"), a["recordId"])) },
        "correct.schedAfterCorrection": { e, a in
            let records = try arrOfObj(a, "records")
            let p = try policyOf(a)
            return orNull(try e.rules.schedAfterCorrection(records: records, recordId: a["recordId"], fsrsBefore: a["fsrsBefore"], policy: p, stoppedAt: a["stoppedAt"]))
        },

        // ---- session-start（读）----
        "start.recordsOf": { e, a in .array(ScheduleRules.recordsOf(try e.stateArg(a))) },
        "start.aStartInfo": { e, a in
            let state = try e.stateArg(a)
            let r = ScheduleRules.aStartInfo(state, policy: try policyOf(a))
            return obj([("kind", .string(r.kind)), ("firstVisit", .bool(r.firstVisit))])
        },
        "start.planDaily": { e, a in
            let state = try e.stateArg(a)
            let today = try string(a, "today")
            let deck = try deckOf(a)
            return try e.rules.planDaily(state, today: today, deck: deck, policy: try policyOf(a))
        },
        "start.planSpecial": { e, a in
            let state = try e.stateArg(a)
            let today = try string(a, "today")
            let deck = try deckOf(a)
            return try e.rules.planSpecial(state, today: today, deck: deck, policy: try policyOf(a))
        },
        "start.s02Data": { e, a in ScheduleRules.s02Data(try e.stateArg(a)) },
        "start.resumableSession": { e, a in
            let state = try e.stateArg(a)
            let slot = try string(a, "slot")
            let now = try finite(try required(a, "now"), "now")
            return try e.rules.resumableSession(state, slot: slot, now: now, policy: try policyOf(a))
        },
        "schedDeck.facts": { _, a in
            let d = ScheduleDeck.real
            let lib = a["libraryId"] ?? .null
            let nc = d.newCandidates(lib)
            return obj([("newCandidates", strs(Array(nc.prefix(40)))), ("newCount", .number(Double(nc.count))), ("warmup", strs(d.warmupCandidates!(lib))),
                        ("current", d.currentLibraryId!(a["settings"]))])
        },
        "schedDeck.practicable": { _, a in
            guard case .string(let k) = try required(a, "key") else { return .bool(false) }
            return .bool(ScheduleDeck.real.practicable(k))
        },

        // ---- session-start（提交，内存 store）----
        "start.expireStale": { e, a in try runStore(e, a) { s, now in try e.rules.expireStale(s, now: now, policy: try policyOf(a)) } },
        "start.resumeSlot": { e, a in try runStore(e, a) { s, now in try e.rules.resumeSlot(s, slot: try string(a, "slot"), now: now, policy: try policyOf(a)) } },
        "start.startFirst": { e, a in try runStore(e, a) { s, now in try e.rules.startFirst(s, now: now, source: try sourceOf(a), policy: try policyOf(a)) } },
        "start.startDaily": { e, a in try runStore(e, a) { s, now in try e.rules.startDaily(s, now: now, deck: try deckOf(a), source: try sourceOf(a), policy: try policyOf(a)) } },
        "start.startNextA": { e, a in try runStore(e, a) { s, now in try e.rules.startNextA(s, now: now, deck: try deckOf(a), source: try sourceOf(a), policy: try policyOf(a)) } },
        "start.startPicked": { e, a in
            try runStore(e, a) { s, _ in try e.rules.startPicked(s, keys: try keysArg(a), source: try sourceOf(a), deck: a["deck"] == nil ? nil : try deckOf(a)) }
        },
        "start.endOldAndStartPicked": { e, a in
            try runStore(e, a) { s, _ in
                try e.rules.endOldAndStartPicked(s, keys: try keysArg(a), source: try sourceOf(a), deck: a["deck"] == nil ? nil : try deckOf(a), policy: try policyOf(a))
            }
        },
        "start.deferSpecial": { e, a in try runStore(e, a) { s, now in try e.rules.deferSpecial(s, now: now) } },
    ]
}
