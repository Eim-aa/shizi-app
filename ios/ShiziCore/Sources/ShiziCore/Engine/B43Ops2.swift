import Foundation

// B4.3 的 op（续）：卡片 / 题库访问、结构、作品成员与取墨、首练结果页、提醒题目、墨编解码、V8 数学函数。JS 参考实现已随 D84 退役。

extension CoreEngine {
    // MARK: cards / deck

    static let cardOps: [String: Op] = [
        "cards.applyContextOverride": { _, a in try Cards.applyContextOverride(try card(a, "source"), try required(a, "overrides")) },
        "cards.build": { _, a in arr(try Cards.buildCards(seed: try array(a, "rows"), overrides: try required(a, "overrides"))) },
        "cards.cardKey": { _, a in str(Cards.cardKey(try card(a))) },
        "cards.libraryIdsFor": { _, a in strs(Cards.libraryIdsFor(try card(a))) },
        "cards.libraries": { _, _ in
            arr(Cards.libraries.map { .object(JSObject([("id", str($0.id)), ("label", str($0.label)), ("officialTotal", num($0.officialTotal))])) })
        },
        "cards.promptModel": { _, a in try Cards.promptModel(try card(a), copy: try copyArg(a)) },
        "cards.visibleHint": { _, a in try Cards.visibleHint(try card(a), copy: try copyArg(a)) },
        "cards.promptHTML": { _, a in str(try Cards.promptHTML(try card(a), copy: try copyArg(a))) },
        // 题库：第 index 行 SEED 套用语境覆盖后的卡片（一行可出一张或多张）
        "deck.cardsOfRow": { _, a in
            let i = try int(a, "index", 10_000_000)
            let seed = DeckData.shared.seed
            guard i >= 0 && i < seed.count else { return .null }
            return arr(try Cards.buildCards(seed: [seed[i]], overrides: .object(DeckData.shared.overrides)))
        },
        "deck.summary": { _, a in
            let cards = DeckCards.shared.cards
            var keys = OSet()
            var counts: [Double] = Array(repeating: 0, count: Cards.libraries.count)
            for c in cards {
                keys.insert(Cards.cardKey(c))
                for (i, lib) in Cards.libraries.enumerated() where lib.test(c) { counts[i] += 1 }
            }
            var libs = JSObject()
            for (i, lib) in Cards.libraries.enumerated() { libs[lib.id] = num(counts[i]) }
            return .object(JSObject([("count", num(Double(cards.count))), ("unique", num(Double(keys.count))), ("libraries", .object(libs)),
                                     ("firstKey", str(Cards.cardKey(cards[0]))), ("lastKey", str(Cards.cardKey(cards[cards.count - 1])))]))
        },
        "deck.cardForKey": { _, a in DeckCards.shared.cardForKey(try string(a, "key")) ?? .null },
        "deck.isPracticable": { _, a in .bool(DeckCards.shared.isPracticable(try string(a, "key"))) },
        "deck.hasContextWord": { _, a in .bool(DeckCards.hasContextWord(try required(a, "card"))) },
        "deck.withWordOff": { _, a in DeckCards.withWordOff(try required(a, "card"), try required(a, "wordOff")) ?? .null },
    ]

    // MARK: structure / workMembers / inkPick / firstResult / reminder

    static func addedArg(_ a: JSObject) throws -> WorkMembers.Added { WorkMembers.Added(try optStrings(a, "added")) }

    static func pickInkArg(_ a: JSObject) throws -> WorkMembers.PickInk {
        guard let v = a["pickInk"] else { return .sameAsHasInk }
        if v.isNull { return .none }
        guard let f = try hasInkSpec(a, "pickInk") else { return .sameAsHasInk }
        return .test(f)
    }

    static func memberJS(_ m: [WorkMembers.Member]) -> JSValue { .array(m.map { $0.js }) }

    static func dayArg(_ a: JSObject, _ k: String) throws -> JSValue { try required(a, k) }

    static let memberOps: [String: Op] = [
        "structure.validGroups": { _, a in .bool(Structure.validGroups(a["groups"], try int(a, "total", 1_000_000_000))) },
        "structure.inferStructure": { _, a in optStr(Structure.inferStructure(a["groups"], a["medians"])) },
        "structure.describe": { _, a in Structure.describeStructure(groups: a["groups"], medians: a["medians"]) },

        "workMembers.isWorkMember": { _, a in .bool(WorkMembers.isWorkMember(try required(a, "record"), hasInk: try hasInkSpec(a, "hasInk"), added: try addedArg(a))) },
        "workMembers.isWrongMember": { _, a in .bool(WorkMembers.isWrongMember(try required(a, "record"))) },
        "workMembers.records": { _, a in arr(WorkMembers.workMemberRecords(try records(a), hasInk: try hasInkSpec(a, "hasInk"), added: try addedArg(a))) },
        "workMembers.members": { _, a in
            memberJS(WorkMembers.workMembers(try records(a), prefer: a["prefer"], order: a["order"], hasInk: try hasInkSpec(a, "hasInk"), pickInk: try pickInkArg(a), added: try addedArg(a)))
        },

        "inkPick.normalizePrefer": { _, a in str(InkPick.normalizePrefer(try required(a, "prefer"))) },
        "inkPick.inkHasStrokes": { _, a in .bool(InkPick.inkHasStrokes(try required(a, "ink"))) },
        "inkPick.storedInkPresent": { e, a in .bool(InkPick.storedInkPresent(try required(a, "state"), try required(a, "record"), timeZone: e.dates.timeZone)) },
        "inkPick.pickInkRecord": { _, a in InkPick.pickInkRecord(try records(a), prefer: a["prefer"], hasInk: try hasInkSpec(a, "hasInk")) ?? .null },
        "inkPick.pickRecordInPeriod": { _, a in
            let r = InkPick.pickRecordInPeriod(try records(a), prefer: a["prefer"], hasInk: try hasInkSpec(a, "hasInk"))
            return .object(JSObject([("record", r.record ?? .null), ("inked", .bool(r.inked))]))
        },

        "firstResult.tierOfDue": { e, a in str(try FirstResult.tierOfDue(try required(a, "due"), try required(a, "today"), dates: e.dates)) },
        "firstResult.reviewPreview": { e, a in
            try FirstResult.reviewPreview(chars: try array(a, "chars"), sched: a["sched"], today: try required(a, "today"), dates: e.dates).js
        },
        "firstResult.previewText": { e, a in
            let p = try FirstResult.reviewPreview(chars: try array(a, "chars"), sched: a["sched"], today: try required(a, "today"), dates: e.dates)
            return str(try FirstResult.previewText(p))
        },
        "firstResult.reviewDays": { e, a in
            arr(try FirstResult.reviewDays(chars: try array(a, "chars"), sched: a["sched"], today: try required(a, "today"), dates: e.dates).map { $0.js })
        },
        "firstResult.daysLaterText": { _, a in str(try FirstResult.daysLaterText(try required(a, "days"))) },
        "firstResult.daysLaterLine": { e, a in
            str(try FirstResult.daysLaterLine(chars: try array(a, "chars"), sched: a["sched"], today: try required(a, "today"), dates: e.dates))
        },
        "firstResult.inviteOf": { _, a in FirstResult.inviteOf(try required(a, "settings")).js },
        "firstResult.inviteDecision": { _, a in str(FirstResult.inviteDecision(settings: a["settings"], variant: a["variant"], sessionId: a["sessionId"])) },
        "firstResult.inviteShown": { _, a in
            guard let next = FirstResult.inviteShownUpdate(settings: a["settings"], sessionId: try required(a, "sessionId")) else { return .object(JSObject([("skipped", .bool(true))])) }
            return .object(JSObject([("settings", next), ("label", str(FirstResult.inviteShownLabel))]))
        },
        "firstResult.inviteAnswer": { _, a in
            guard let next = try FirstResult.inviteAnswerUpdate(settings: a["settings"], answer: try required(a, "answer")) else { return .object(JSObject([("skipped", .bool(true))])) }
            return .object(JSObject([("settings", next), ("label", str(FirstResult.inviteAnswerLabel))]))
        },
        "firstResult.inviteTime": { e, a in FirstResult.inviteTime(try numberArg(a, "nowMs"), dates: e.dates) },
        "firstResult.inviteTimeText": { _, a in str(FirstResult.inviteTimeText(a["hour"], a["minute"])) },

        "reminder.remindOf": { _, a in Reminder.remindOf(a["settings"], policy: try optObject(a, "policy")) },
        "reminder.normalizeTargetKey": { _, a in optStr(Reminder.normalizeTargetKey(try required(a, "raw"))) },
        "reminder.maskedWord": { _, a in str(Reminder.maskedWord(try card(a), policy: try optObject(a, "policy"))) },
        "reminder.candidates": { e, a in
            arr(try Reminder.reminderCandidates(try stateArg(a), policy: try optObject(a, "policy"), dates: e.dates).map {
                .object(JSObject([("cardKey", str($0.cardKey)), ("due", str($0.due)), ("wrong", .bool($0.wrong)), ("card", $0.card)]))
            })
        },
        "reminder.questions": { e, a in
            let count = try a["count"].map { _ in try int(a, "count", 100) } ?? Reminder.reminderDays
            return arr(try Reminder.reminderQuestions(try stateArg(a), today: try required(a, "today"), count: count, policy: try optObject(a, "policy"), dates: e.dates))
        },
        "reminder.fireDayOf": { e, a in try Reminder.fireDayOf(a["now"], a["remind"], try required(a, "today"), policy: try optObject(a, "policy"), dates: e.dates) },
        "reminder.payload": { e, a in
            try Reminder.reminderPayload(try stateArg(a), remind: a["remind"], today: try required(a, "today"), now: a["now"], policy: try optObject(a, "policy"), dates: e.dates)
        },
        "reminder.affects": { _, a in .bool(Reminder.affectsReminder(try required(a, "info"))) },
    ]

    // MARK: ink

    static func optionsArg(_ a: JSObject) throws -> InkOptions {
        if let p = a["policy"], case .object = p {} else if a["policy"] != nil { throw CoreError.badArgs("policy must be an object") }
        var o = InkOptions(js: a)
        if let p = try policyArg(a) { o.policy = p }
        return o
    }

    static func builtJS(_ b: BuiltStroke) -> JSValue {
        .object(JSObject([
            ("points", .array(b.points.map { $0.js })), ("v30", b.v30.map { .number($0) } ?? .null), ("dot", .bool(b.dot)),
            ("single", .bool(b.single)), ("endK", num(b.endK)), ("pressure", .bool(b.pressure)),
        ]))
    }

    static func decodedJS(_ d: [[InkPoint]]?) -> JSValue { d.map { strokesJS($0) } ?? .null }

    static let inkOps: [String: Op] = [
        "jsmath.hypot": { _, a in num(JSMath.hypot(try numberArg(a, "a"), try numberArg(a, "b"))) },
        "jsmath.exp": { _, a in num(JSMath.exp(try numberArg(a, "x"))) },
        "ink.params": { _, a in
            let p = try InkParams(policy: try policyArg(a))
            return .object(JSObject((InkParams.tunableKeys + InkParams.spec.map { $0.0 }).map { k in
                (k, num(p[k] ?? InkParams.spec.first { $0.0 == k }!.1))
            }))
        },
        "ink.mergeSameTime": { _, a in .array(InkMath.mergeSameTime(try points(try required(a, "raw"), "raw")).map { $0.js }) },
        "ink.liftSpeed": { _, a in
            InkMath.liftSpeed(try points(try required(a, "merged"), "merged"), window: try optNumber(a, "window") ?? InkParams.standard.window).map { .number($0) } ?? .null
        },
        "ink.catmullRom": { _, a in .array(InkMath.catmullRom(try points(try required(a, "points"), "points"), step: try optNumber(a, "step") ?? InkParams.standard.step).map { $0.js }) },
        "ink.buildStroke": { _, a in builtJS(try InkMath.buildStroke(try points(try required(a, "raw"), "raw"), options: try optionsArg(a))) },
        "ink.strokeLength": { _, a in num(InkMath.strokeLength(try points(try required(a, "points"), "points"))) },
        "ink.thinStroke": { _, a in .array(InkMath.thinStroke(try points(try required(a, "points"), "points"), max: try optNumber(a, "max")).map { $0.js }) },
        "ink.simplifyStroke": { _, a in
            .array(InkMath.simplifyStroke(try points(try required(a, "points"), "points"), max: try optNumber(a, "max"), tolerance: try toleranceArg(a), policy: try policyArg(a)).map { $0.js })
        },
        "ink.quantizeDt": { _, a in num(Double(InkMath.quantizeDt(try numberArg(a, "ms")))) },
        "ink.bytesToBase64": { _, a in
            str(InkMath.bytesToBase64(try array(a, "bytes").map { v in
                guard case .number(let d) = v, d >= 0, d <= 255, d.rounded(.towardZero) == d else { throw CoreError.badArgs("bytes must be integers 0..255") }
                return UInt8(d)
            }))
        },
        "ink.base64ToBytes": { _, a in
            InkMath.base64ToBytes(try string(a, "str")).map { .array($0.map { .number(Double($0)) }) } ?? .null
        },
        "ink.isBase64": { _, a in .bool(InkMath.isBase64(try string(a, "str"))) },
        "ink.encodeInk": { _, a in
            try InkMath.encodeInk(try strokes(a, "strokes"), options: InkMath.EncodeOptions(
                base: try optNumber(a, "base"), maxPoints: try optNumber(a, "maxPoints"), maxStrokes: try optNumber(a, "maxStrokes"),
                tolerance: try toleranceArg(a), policy: try policyArg(a)))
        },
        "ink.isInk": { _, a in
            let ink = try required(a, "ink")
            return .object(JSObject([("v2", .bool(InkMath.isInkV2(ink))), ("v3", .bool(InkMath.isInkV3(ink))), ("v4", .bool(InkMath.isInkV4(ink))), ("any", .bool(InkMath.isInk(ink)))]))
        },
        "ink.decodeInk": { _, a in decodedJS(try InkMath.decodeInk(try required(a, "ink"), options: try optionsArg(a))) },
        "ink.resampleForReplay": { _, a in
            strokesJS(InkMath.resampleForReplay(try strokes(a, "decoded"), step: try optNumber(a, "step") ?? InkParams.standard.step))
        },
        "ink.encodeRawStrokes": { _, a in rowsJS(InkMath.encodeRawStrokes(try strokes(a, "strokes"))) },
        "ink.decodeRawStrokes": { _, a in strokesJS(InkMath.decodeRawStrokes(try rowsOf(try required(a, "rows"), "rows"))) },
        "ink.rawRowToPacked": { _, a in
            guard case .array(let r) = try required(a, "row") else { throw CoreError.badArgs("row must be an array") }
            let row = try rowsOf(.array([.array(r)]), "row")[0]
            return optStr(InkMath.rawRowToPacked(row))
        },
        "ink.packedToRawRow": { _, a in InkMath.packedToRawRow(try string(a, "str")).map { .array($0.map { .number($0) }) } ?? .null },
        "ink.encodeInkRaw": { _, a in InkMath.encodeInkRaw(try strokes(a, "strokes"), maxStrokes: try optNumber(a, "maxStrokes"), policy: try policyArg(a)) },
        "ink.inkRawRows": { _, a in InkMath.inkRawRows(try required(a, "ink")).map { rowsJS($0) } ?? .null },
        "ink.decodeInkRaw": { _, a in decodedJS(InkMath.decodeInkRaw(try required(a, "ink"))) },
        "ink.encodeStoredInk": { _, a in
            let format = try optionalString(a, "format") ?? "raw"
            return try InkMath.encodeStoredInk(try strokes(a, "strokes"), policy: try policyArg(a), format: JSX.eq(format, "v3") ? "v3" : "raw")
        },
    ]
}
