import Foundation
import XCTest
@testable import ShiziCore

// 会话与选字规则的转写（B4.2）：test/core/sessions.test.mjs（27）。
// JS 的对象同一性断言（assert.equal(a, b) 比的是引用）在这里按值比较（JSValue 是值类型）；其余逐条对照。
// 汉字一律用 \u{…} 转义。

private let tz = TimeZone(identifier: "Asia/Shanghai")!
private let rules = ScheduleRules(timeZone: tz)
private let TODAY = "2026-09-24"
// D65 #2 / D66 ⑫：本文件的选字用例按 5 字一组、关掉新用户前三天封顶来写（见 JS 文件头注释）。

/// test/core/helpers.mjs at()：本地时间 ms。
private func at(_ day: String, _ hour: Int = 12, _ minute: Int = 0) -> Double {
    let p = day.split(separator: "-").map { Int($0)! }
    return JSDate.makeLocal(p[0], p[1] - 1, p[2], hours: hour, tz)! + Double(minute) * 60_000
}

/// test/core/helpers.mjs rec()。
private func rec(_ serial: Int, _ char: String, _ kind: String, _ judgment: String?, _ day: String, sessionId: String = "s1", hints: Double = 0) -> JSValue {
    var pairs: [(String, JSValue)] = [
        ("id", .string("r\(serial)")), ("cardKey", .string("base:" + char)), ("char", .string(char)), ("sessionId", .string(sessionId)),
        ("kind", .string(kind)), ("at", .number(at(day, 12, serial % 60))), ("localDay", .string(day)),
        ("help", JS.obj([("hints", .number(hints)), ("answerSeen", .bool(kind == "answer-seen")), ("traced", .bool(false))])),
    ]
    if kind == "judged" { pairs.append(("judgment", judgment.map { .string($0) } ?? .null)) }
    return JS.obj(pairs)
}

private func policyWith(_ overrides: [(String, JSValue)]) -> JSValue { JS.with(Config.policy, overrides.map { ($0.0, Optional($0.1)) }) }

private func K(_ s: String) -> [String] { s.unicodeScalars.map { "base:" + String($0) } }
private func arr(_ a: [String]) -> JSValue { .array(a.map { .string($0) }) }
private func S(_ s: String) -> JSValue { .string(s) }
private func N(_ n: Double) -> JSValue { .number(n) }

private func sched(_ due: String, _ stability: Double = 5) -> JSValue {
    JS.obj([("fsrs", JS.obj([("stability", .number(stability))])), ("due", .string(due)), ("lastJudgedAt", .number(0))])
}

private func table(_ pairs: [(String, JSValue)]) -> JSValue { JS.obj(pairs) }

private func addDays(_ day: String, _ n: Double) throws -> String { try rules.dates.addDays(day, n) }

private func makeSession(_ id: String, _ kind: String, _ queue: [String], source: JSValue? = nil, at t: Double) throws -> JSValue {
    try SessionRules.createSession(id: .string(id), kind: .string(kind), source: source, queue: arr(queue), at: .number(t), dates: rules.dates)
}

private func daily(_ id: String, _ chars: String, _ day: String = TODAY) throws -> JSValue {
    try makeSession(id, "daily", K(chars), source: JS.obj([("view", S("home"))]), at: at(day, 8))
}

private func picked(_ id: String, _ chars: String) throws -> JSValue {
    try makeSession(id, "picked", K(chars), source: JS.obj([("view", S("home"))]), at: at(TODAY, 9))
}

/// advance(session, {cardKey, recordId, kind, fsrsBefore, at})：nil = undefined。
private func adv(_ s: JSValue, _ cardKey: String, _ recordId: String?, _ kind: String, fsrsBefore: JSValue? = nil, at t: Double? = nil) throws -> JSValue {
    try SessionRules.advance(s, cardKey: S(cardKey), recordId: recordId.map { S($0) }, kind: S(kind), fsrsBefore: fsrsBefore, at: t.map { N($0) })
}

private func cur(_ s: JSValue, _ patch: [(String, JSValue)]) throws -> JSValue { try SessionRules.withCurrent(s, JS.obj(patch), at: nil) }

private func selectDaily(sched: JSValue? = nil, records: [JSValue] = [], today: String = TODAY, newCandidates: [String] = [], custom: JSValue? = nil,
                         policy: JSValue = Config.policy, isWarm: ((String) -> Bool)? = nil, groupSize: JSValue? = N(5)) throws -> ScheduleRules.DailyPlan {
    if let w = isWarm {
        return try rules.selectDaily(sched: sched, records: records, today: today, newCandidates: newCandidates, custom: custom, policy: policy, isWarm: w, groupSize: groupSize)
    }
    return try rules.selectDaily(sched: sched, records: records, today: today, newCandidates: newCandidates, custom: custom, policy: policy, groupSize: groupSize)
}

private func assertThrowsRange<T>(_ expr: @autoclosure () throws -> T, _ part: String, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertThrowsError(try expr(), file: file, line: line) { err in
        guard let e = err as? CoreError else { return XCTFail("not a CoreError: \(err)", file: file, line: line) }
        XCTAssertTrue(e.message.contains(part), "message '\(e.message)' should contain '\(part)'", file: file, line: line)
    }
}

private func lastEnded(_ sessions: JSValue, _ slot: String) -> JSValue? { sessions["lastEnded"]?[slot] }

final class SessionRulesTests: XCTestCase {
    // sessions: kinds map to slots A/B and createSession validates its queue
    func testSessionsKindsMapToSlotsABAndCreateSessionValidatesItsQueue() throws {
        XCTAssertEqual(try SessionRules.slotOfKind(S("first")), "A")
        XCTAssertEqual(try SessionRules.slotOfKind(S("daily")), "A")
        XCTAssertEqual(try SessionRules.slotOfKind(S("picked")), "B")
        let s = try daily("s1", "\u{9759}\u{4EA6}\u{6162}")
        XCTAssertEqual(s["slot"], S("A"))
        XCTAssertEqual(s["startedDay"], S(TODAY))
        XCTAssertEqual(SessionRules.currentCardKey(s), S("base:\u{9759}"))
        XCTAssertEqual(SessionRules.remainingCount(s), 3)
        XCTAssertEqual(s["current"], J(#"{"phase":"recall","strokes":[],"hints":0,"answerSeen":false,"hintRange":null,"referenceReady":false}"#))
        assertThrowsRange(try daily("s2", "\u{9759}\u{9759}"), "repeat")
        assertThrowsRange(try SessionRules.createSession(id: S("x"), kind: S("daily"), source: nil, queue: arr(K("\u{9759}")), at: N(1), dates: rules.dates), "session id")
        assertThrowsRange(try SessionRules.createSession(id: S("s3"), kind: S("focus"), source: nil, queue: arr(K("\u{9759}")), at: N(1), dates: rules.dates), "kind")
        assertThrowsRange(try SessionRules.createSession(id: S("s3"), kind: S("daily"), source: nil, queue: .array([]), at: N(1), dates: rules.dates), "non-empty")
    }

    // sessions: advancing records items, moves the cursor and sets the result line (D19)
    func testSessionsAdvancingRecordsItemsMovesTheCursorAndSetsTheResultLineD19() throws {
        var s = try daily("s1", "\u{9759}\u{4EA6}\u{6162}")
        s = try cur(s, [("strokes", J("[[1,2]]")), ("hints", N(1))])
        s = try adv(s, "base:\u{9759}", "r1", "judged", fsrsBefore: .null, at: 5)
        XCTAssertEqual(s["cursor"], N(1))
        XCTAssertEqual(s["current"]?["strokes"], .array([]), "fresh current for the next char")
        XCTAssertEqual(s["lastLine"], J(#"{"recordId":"r1","kind":"record"}"#))
        s = try adv(s, "base:\u{4EA6}", "r2", "answer-seen", at: 6)
        XCTAssertEqual(s["lastLine"], J(#"{"recordId":"r2","kind":"saw"}"#))
        s = try adv(s, "base:\u{6162}", "r3", "skipped", at: 7)
        XCTAssertEqual(s["lastLine"], .null, "skip clears the line")
        XCTAssertTrue(SessionRules.isComplete(s))
        XCTAssertEqual(s["items"]?.arrayValue?.map { $0["kind"] }, [S("judged"), S("answer-seen"), S("skipped")])
        XCTAssertNil(s["items"]?.arrayValue?[1]["fsrsBefore"], "only judged items keep fsrsBefore")
        assertThrowsRange(try SessionRules.advance(try daily("s9", "\u{9759}\u{4EA6}"), cardKey: S("base:\u{4EA6}"), recordId: nil, kind: S("judged"), fsrsBefore: nil, at: nil), "current card")
        assertThrowsRange(try cur(s, [("phase", S("feedback"))]), "phase")
    }

    // sessions: result line can switch to "changed" and collapses on demand
    func testSessionsResultLineCanSwitchToChangedAndCollapsesOnDemand() throws {
        var s = try adv(try daily("s1", "\u{9759}\u{4EA6}"), "base:\u{9759}", "r1", "judged", fsrsBefore: .null)
        XCTAssertEqual(SessionRules.markLineChanged(s, S("r9")), s, "other record: unchanged")
        s = SessionRules.markLineChanged(s, S("r1"))
        XCTAssertEqual(s["lastLine"], J(#"{"recordId":"r1","kind":"changed"}"#))
        XCTAssertEqual(try Copy.text("R-W10.lineChangedCorrect", JSObject([("char", S("\u{9759}"))])), "\u{300C}\u{9759}\u{300D}\u{5DF2}\u{6539}\u{4E3A}\u{5199}\u{5BF9} \u{B7} \u{4FEE}\u{6539} \u{203A}")
        XCTAssertEqual(SessionRules.clearLine(s)["lastLine"], .null)
    }

    // sessions: skip undo puts the char back at the cursor (W16)
    func testSessionsSkipUndoPutsTheCharBackAtTheCursorW16() throws {
        var s = try adv(try daily("s1", "\u{9759}\u{4EA6}"), "base:\u{9759}", "r1", "skipped")
        s = try SessionRules.undoSkip(s, S("r1"), at: N(9))
        XCTAssertEqual(SessionRules.currentCardKey(s), S("base:\u{9759}"))
        XCTAssertEqual(s["items"]?.arrayValue?.count, 0)
        XCTAssertEqual(s["current"]?["phase"], S("recall"))
        let judged = try adv(try daily("s2", "\u{9759}\u{4EA6}"), "base:\u{9759}", "r2", "judged", fsrsBefore: .null)
        assertThrowsRange(try SessionRules.undoSkip(judged, S("r2"), at: nil), "not this skip")
    }

    // sessions: fsrsBefore lives only in the session and gates corrections
    func testSessionsFsrsBeforeLivesOnlyInTheSessionAndGatesCorrections() throws {
        let card = J(#"{"due":"2026-09-30T00:00:00.000Z"}"#)
        var s = try adv(try daily("s1", "\u{9759}\u{4EA6}\u{6162}"), "base:\u{9759}", "r1", "judged", fsrsBefore: card)
        s = try adv(s, "base:\u{4EA6}", "r2", "answer-seen")
        XCTAssertEqual(SessionRules.fsrsBeforeOf(s, S("r1")), card)
        XCTAssertTrue(SessionRules.canCorrect(s, S("r1")))
        XCTAssertFalse(SessionRules.canCorrect(s, S("r2")), "answer-seen cannot be re-judged (K25)")
        XCTAssertFalse(SessionRules.canCorrect(nil, S("r1")))
    }

    // sessions: A and B are isolated — opening B leaves A exactly as it was (D05)
    func testSessionsAAndBAreIsolatedOpeningBLeavesAExactlyAsItWasD05() throws {
        var sessions = SessionRules.emptySessions()
        let a = try cur(try daily("s1", "\u{9759}\u{4EA6}\u{6162}"), [("strokes", J("[[1,2,3]]")), ("hints", N(1)), ("phase", S("recall"))])
        sessions = try SessionRules.startInSlot(sessions, a)
        let snapshot = sessions["A"]
        sessions = try SessionRules.startInSlot(sessions, try picked("s2", "\u{9C9C}\u{5883}"))
        XCTAssertEqual(sessions["A"], snapshot)
        XCTAssertEqual(sessions["B"]?["id"], S("s2"))
        assertThrowsRange(try SessionRules.startInSlot(sessions, try daily("s3", "\u{989D}")), "occupied")
        assertThrowsRange(try SessionRules.startInSlot(sessions, try picked("s4", "\u{989D}")), "occupied")
    }

    // sessions: ending moves the session to lastEnded; the next start in that slot clears it
    func testSessionsEndingMovesTheSessionToLastEndedTheNextStartInThatSlotClearsIt() throws {
        var sessions = try SessionRules.startInSlot(try SessionRules.startInSlot(SessionRules.emptySessions(), try daily("s1", "\u{9759}")), try picked("s2", "\u{9C9C}"))
        sessions = try SessionRules.endSlot(sessions, "B", at: N(50), early: true)
        XCTAssertEqual(sessions["B"], .null)
        XCTAssertEqual(lastEnded(sessions, "B")?["id"], S("s2"))
        XCTAssertEqual(lastEnded(sessions, "B")?["endedEarly"], .bool(true))
        XCTAssertEqual(lastEnded(sessions, "B")?["endedAt"], N(50))
        sessions = try SessionRules.endSlot(sessions, "A", at: N(60))
        XCTAssertNil(lastEnded(sessions, "A")?["endedEarly"])
        sessions = try SessionRules.startInSlot(sessions, try picked("s3", "\u{5883}"))
        XCTAssertNil(lastEnded(sessions, "B"), "same slot cleared")
        XCTAssertEqual(lastEnded(sessions, "A")?["id"], S("s1"), "other slot kept")
        XCTAssertNil(lastEnded(SessionRules.clearLastEnded(sessions, "A"), "A"))
        assertThrowsRange(try SessionRules.endSlot(SessionRules.emptySessions(), "A", at: N(1)), "empty")
    }

    // sessions: home resume lines list B first, then A, with remaining counts (S01)
    func testSessionsHomeResumeLinesListBFirstThenAWithRemainingCountsS01() throws {
        let a = try adv(try daily("s1", "\u{9759}\u{4EA6}\u{6162}"), "base:\u{9759}", "r1", "judged", fsrsBefore: .null)
        let sessions = try SessionRules.startInSlot(try SessionRules.startInSlot(SessionRules.emptySessions(), a), try picked("s2", "\u{9C9C}\u{5883}"))
        XCTAssertEqual(SessionRules.resumeLines(sessions), J(#"[{"slot":"B","kind":"picked","remaining":2},{"slot":"A","kind":"daily","remaining":2}]"#))
        XCTAssertEqual(try Copy.text("R-H04.resumePicked", JSObject([("n", N(0)), ("total", N(2))])), "\u{81EA}\u{5DF1}\u{9009}\u{7684} \u{B7} 0 / 2")
        XCTAssertEqual(try Copy.text("R-H04.resumePickedAria", JSObject([("n", N(0)), ("total", N(2))])), "\u{63A5}\u{7740}\u{5199}\u{81EA}\u{5DF1}\u{9009}\u{7684}\u{5B57}\u{FF0C}\u{5DF2}\u{5199} 0 \u{4E2A}\u{FF0C}\u{5171} 2 \u{4E2A}")
        XCTAssertEqual(SessionRules.resumeLines(SessionRules.emptySessions()), .array([]))
    }

    // sessions: S02 prompt lists the unwritten chars of the old B and its judged count
    func testSessionsS02PromptListsTheUnwrittenCharsOfTheOldBAndItsJudgedCount() throws {
        var b = try picked("s2", "\u{989D}\u{9C9C}\u{5883}")
        b = try adv(b, "base:\u{989D}", "r1", "judged", fsrsBefore: .null)
        let sessions = try SessionRules.startInSlot(SessionRules.emptySessions(), b)
        let p = SessionRules.s02Prompt(sessions)
        XCTAssertEqual(p["unwrittenChars"], arr(["\u{9C9C}", "\u{5883}"]))
        XCTAssertEqual(p["judgedCount"], N(1))
        let chars = (p["unwrittenChars"]?.arrayValue ?? []).map { "\u{300C}" + ($0.stringValue ?? "") + "\u{300D}" }.joined()
        XCTAssertEqual(try Copy.text("R-H05.body", JSObject([("chars", S(chars))])), "\u{4E0A}\u{4E00}\u{7EC4}\u{8FD8}\u{6709}\u{300C}\u{9C9C}\u{300D}\u{300C}\u{5883}\u{300D}\u{6CA1}\u{5199}\u{3002}")
        XCTAssertEqual(SessionRules.s02Prompt(SessionRules.emptySessions()), .null)
        XCTAssertEqual(SessionRules.s02Prompt(try SessionRules.startInSlot(SessionRules.emptySessions(), try daily("s1", "\u{9759}"))), .null, "only B triggers S02")
    }

    // sessions: "结束那组，开新的" ends old B early into lastEnded and starts the new one in one step (P38)
    func testSessionsEndOldGroupAndStartNewEndsOldBEarlyIntoLastEndedAndStartsTheNewOneInOneStepP38() throws {
        var b = try picked("s2", "\u{989D}\u{9C9C}\u{5883}")
        b = try adv(b, "base:\u{989D}", "r1", "judged", fsrsBefore: .null)
        let a = try daily("s1", "\u{9759}")
        let sessions = try SessionRules.startInSlot(try SessionRules.startInSlot(SessionRules.emptySessions(), a), b)
        let res = try SessionRules.endAndStartPicked(sessions, try picked("s3", "\u{6162}"), at: N(99))
        XCTAssertEqual(res.sessions["B"]?["id"], S("s3"))
        XCTAssertEqual(lastEnded(res.sessions, "B")?["id"], S("s2"))
        XCTAssertEqual(lastEnded(res.sessions, "B")?["endedEarly"], .bool(true))
        XCTAssertEqual(res.sessions["A"], a, "A untouched")
        XCTAssertEqual(res.notice, J(#"{"kind":"oldGroupSaved","judgedCount":1}"#))
        XCTAssertFalse(res.showOldResult)
        let zero = try SessionRules.endAndStartPicked(try SessionRules.startInSlot(SessionRules.emptySessions(), try picked("s2", "\u{9C9C}")), try picked("s3", "\u{6162}"), at: N(1))
        XCTAssertEqual(zero.notice, .null, "no judged \u{2192} no toast")
    }

    // sessions: S02 policy alternative shows the old result page instead
    func testSessionsS02PolicyAlternativeShowsTheOldResultPageInstead() throws {
        let b = try adv(try picked("s2", "\u{989D}\u{9C9C}"), "base:\u{989D}", "r1", "judged", fsrsBefore: .null)
        let res = try SessionRules.endAndStartPicked(try SessionRules.startInSlot(SessionRules.emptySessions(), b), try picked("s3", "\u{6162}"), at: N(1),
                                                     policy: policyWith([("s02EndOld", S("result"))]))
        XCTAssertTrue(res.showOldResult)
        XCTAssertEqual(res.notice, .null)
        assertThrowsRange(try SessionRules.endAndStartPicked(SessionRules.emptySessions(), try daily("s4", "\u{9759}"), at: N(1)), "picked")
    }

    // sessions: an unfinished daily from yesterday expires; today, first and picked do not (P37)
    func testSessionsAnUnfinishedDailyFromYesterdayExpiresTodayFirstAndPickedDoNotP37() throws {
        let yesterday = try daily("s1", "\u{9759}\u{4EA6}", "2026-09-23")
        func box(_ a: JSValue?, _ b: JSValue? = nil) -> JSValue { JS.obj([("A", a ?? .null), ("B", b ?? .null), ("lastEnded", .object(JSObject()))]) }
        let r0 = try SessionRules.expireDaily(box(yesterday), S(TODAY))
        XCTAssertEqual(r0.sessions["A"], .null)
        XCTAssertEqual(r0.expired, yesterday)
        XCTAssertNil(lastEnded(r0.sessions, "A"), "discard: no result page")
        let todays = box(try daily("s2", "\u{9759}"))
        XCTAssertEqual(try SessionRules.expireDaily(todays, S(TODAY)).sessions, todays)
        let first = try makeSession("s3", "first", K("\u{5C34}"), at: at("2026-09-20"))
        XCTAssertNil(try SessionRules.expireDaily(box(first), S(TODAY)).expired)
        let res = try SessionRules.expireDaily(box(yesterday), S(TODAY), policy: policyWith([("dailyExpiry", S("result"))]))
        XCTAssertEqual(lastEnded(res.sessions, "A")?["id"], S("s1"))
        XCTAssertEqual(lastEnded(res.sessions, "A")?["endedEarly"], .bool(true))
        assertThrowsRange(try SessionRules.expireDaily(box(yesterday), S(TODAY), policy: JS.obj([("dailyExpiry", S("x"))])), "dailyExpiry")
    }

    // sessions: first / picked cross-day expiry follows policy.sessionExpiry (P61)
    func testSessionsFirstPickedCrossDayExpiryFollowsPolicySessionExpiryP61() throws {
        let first = try makeSession("s3", "first", K("\u{5C34}"), at: at("2026-09-20"))
        let oldPicked = try makeSession("s4", "picked", K("\u{989D}"), source: JS.obj([("view", S("home"))]), at: at("2026-09-20", 9))
        let both = JS.obj([("A", first), ("B", oldPicked), ("lastEnded", .object(JSObject()))])
        let kept = try SessionRules.expireDaily(both, S(TODAY))
        XCTAssertEqual(kept.sessions, both, "default 'never': nothing expires, same value back")
        XCTAssertEqual(kept.expiredAll, [])
        let same = policyWith([("sessionExpiry", JS.obj([("first", S("daily")), ("picked", S("daily"))]))])
        let gone = try SessionRules.expireDaily(both, S(TODAY), policy: same)
        XCTAssertEqual(gone.sessions["A"], .null)
        XCTAssertEqual(gone.sessions["B"], .null)
        XCTAssertEqual(gone.expired, first, "A first")
        XCTAssertEqual(gone.expiredAll.map { $0["id"] }, [S("s3"), S("s4")])
        let asResult = try SessionRules.expireDaily(both, S(TODAY), policy: policyWith([
            ("sessionExpiry", JS.obj([("first", S("never")), ("picked", S("daily"))])), ("dailyExpiry", S("result")),
        ]))
        XCTAssertEqual(asResult.sessions["A"], first, "first still never expires")
        XCTAssertEqual(lastEnded(asResult.sessions, "B")?["id"], S("s4"))
        let badPolicy = policyWith([("sessionExpiry", JS.obj([("first", S("x")), ("picked", S("never"))]))])
        assertThrowsRange(try SessionRules.expireDaily(both, S(TODAY), policy: badPolicy), "sessionExpiry.first")
    }

    // sessions: recovery is idempotent — a committed judgment is not counted twice (D07)
    func testSessionsRecoveryIsIdempotentACommittedJudgmentIsNotCountedTwiceD07() throws {
        let s = try cur(try daily("s1", "\u{9759}\u{4EA6}"), [("phase", S("compare")), ("strokes", J("[[1]]"))])
        let records = [rec(4, "\u{9759}", "judged", "correct", TODAY, sessionId: "s1")]
        let once = try SessionRules.recoverSession(s, records)
        XCTAssertTrue(once.recovered)
        XCTAssertEqual(SessionRules.currentCardKey(once.session), S("base:\u{4EA6}"))
        XCTAssertEqual(once.session?["items"]?.arrayValue?.count, 1)
        let twice = try SessionRules.recoverSession(once.session, records)
        XCTAssertFalse(twice.recovered)
        XCTAssertEqual(twice.session?["items"]?.arrayValue?.count, 1)
        let other = try SessionRules.recoverSession(s, [rec(5, "\u{9759}", "judged", "correct", TODAY, sessionId: "s9")])
        XCTAssertFalse(other.recovered, "another session\u{2019}s record does not count")
    }

    // sessions: compare with no strokes falls back to recall on restore
    func testSessionsCompareWithNoStrokesFallsBackToRecallOnRestore() throws {
        let s = try cur(try daily("s1", "\u{9759}"), [("phase", S("compare")), ("strokes", .array([]))])
        let r = try SessionRules.recoverSession(s, [])
        XCTAssertTrue(r.recovered)
        XCTAssertEqual(r.session?["current"]?["phase"], S("recall"))
    }

    // sessions (D63): a stored current.paper=true (the removed 在纸上写 mode) is dropped on restore and the card goes back to recall
    func testSessionsD63AStoredCurrentPaperTrueIsDroppedOnRestoreAndTheCardGoesBackToRecall() throws {
        let s = try cur(try daily("s1", "\u{9759}"), [("phase", S("compare")), ("strokes", .array([])), ("paper", .bool(true))])
        let r = try SessionRules.recoverSession(s, [])
        XCTAssertTrue(r.recovered)
        XCTAssertEqual(r.session?["current"]?["phase"], S("recall"))
        XCTAssertNil(r.session?["current"]?["paper"])
    }

    // sessions: first practice is the fixed 3 chars 尴 赢 拾 (D38 / P09; was 5 chars in D17)
    func testSessionsFirstPracticeIsTheFixed3CharsD38P09WasFiveCharsInD17() throws {
        let q = SessionRules.selectFirst()
        XCTAssertEqual(q.count, 3)
        XCTAssertEqual(q, (Config.policyValue("firstQueue")?.arrayValue ?? []).map { "base:" + ($0.stringValue ?? "") })
        XCTAssertEqual(q, ["base:\u{5C34}", "base:\u{8D62}", "base:\u{62FE}"])
        let s = try makeSession("s1", "first", q, at: at(TODAY))
        XCTAssertEqual(try Copy.text("R-W01.progress", JSObject([("n", N((s["cursor"]?.numberValue ?? 0) + 1)), ("total", N(Double(s["queue"]?.arrayValue?.count ?? 0)))])), "1 / 3")
        XCTAssertEqual(try Copy.text("R-H03.firstVisit"), "\u{5148}\u{5199}\u{4E09}\u{4E2A}\u{5927}\u{5BB6}\u{5E38}\u{5FD8}\u{7684}\u{5B57}\u{3002}", "P1-E5: the line under \u{5F00}\u{59CB}\u{5199}\u{5B57} (stage-1 design \u{A7}\u{4E00})")
        XCTAssertEqual(Config.policyNumber("groupSize"), 15, "D38: first practice only; ordinary groups default to 15 (D83)")
    }

    // sessions: next A group is first until any judged record exists (P46)
    func testSessionsNextAGroupIsFirstUntilAnyJudgedRecordExistsP46() throws {
        XCTAssertEqual(SessionRules.nextAKind([]), "first")
        XCTAssertEqual(SessionRules.nextAKind([rec(1, "\u{9759}", "answer-seen", nil, TODAY)]), "first", "answer-seen is not a record")
        XCTAssertEqual(SessionRules.nextAKind([rec(1, "\u{9759}", "judged", "wrong", TODAY)]), "daily")
        XCTAssertEqual(SessionRules.nextAKind([], everPracticed: true), "first", "after clearing all records \u{2192} first again (default)")
        XCTAssertEqual(SessionRules.nextAKind([], policy: policyWith([("afterClearRestartFirst", .bool(false))]), everPracticed: true), "daily")
    }

    // daily: chars judged today are excluded
    func testDailyCharsJudgedTodayAreExcluded() throws {
        let records = [rec(1, "\u{9759}", "judged", "correct", TODAY)]
        let s = table([("base:\u{9759}", sched("2026-09-20"))])
        let plan = try selectDaily(sched: s, records: records, newCandidates: K("\u{9759}\u{4EA6}\u{6162}\u{989D}\u{9C9C}\u{5883}"))
        XCTAssertFalse(plan.queue.contains("base:\u{9759}"))
        XCTAssertEqual(plan.queue, K("\u{4EA6}\u{6162}\u{989D}\u{9C9C}\u{5883}"))
    }

    // daily: due chars are taken most overdue first then least stable; new chars in candidate order, interleaved (D41)
    func testDailyDueCharsAreTakenMostOverdueFirstThenLeastStableNewCharsInCandidateOrderInterleavedD41() throws {
        let s = table([
            ("base:\u{9759}", sched("2026-09-22", 10)),
            ("base:\u{4EA6}", sched("2026-09-10", 30)),
            ("base:\u{6162}", sched("2026-09-22", 2)),
            ("base:\u{989D}", sched("2026-09-30", 1)), // 未到期
        ])
        let res = try selectDaily(sched: s, records: [], newCandidates: K("\u{9C9C}\u{5883}\u{989D}"), isWarm: { _ in false })
        XCTAssertEqual(res.dueKeys, K("\u{4EA6}\u{6162}\u{9759}"))
        // D41：3 个到期 → p = 0.75 → 2 新，复、新交错（复 新 复 新 复），已写过的额不算新字
        XCTAssertEqual(res.queue, K("\u{4EA6}\u{9C9C}\u{6162}\u{5883}\u{9759}"), "new chars in candidate order; seen chars are not new")
        XCTAssertEqual(res.newKeys, K("\u{9C9C}\u{5883}"))
    }

    // daily: group size comes from policy (P03) and stopped cards are skipped
    func testDailyGroupSizeComesFromPolicyP03AndStoppedCardsAreSkipped() throws {
        let s = table([("base:\u{9759}", JS.with(sched("2026-09-01"), [("stoppedAt", N(3))]))])
        let cands = K("\u{4E00}\u{4E8C}\u{4E09}\u{56DB}\u{4E94}\u{516D}\u{4E03}\u{516B}")
        XCTAssertEqual(try selectDaily(sched: s, records: [], newCandidates: cands).queue.count, 5)
        // 不给 groupSize → 按 policy.groupSize
        let noSize = try selectDaily(sched: s, records: [], newCandidates: cands, groupSize: nil)
        XCTAssertEqual(noSize.queue.count, Int(min(Config.policyNumber("groupSize") ?? 0, Double(cands.count))), "no groupSize \u{2192} policy.groupSize")
        let big = try selectDaily(sched: s, records: [], newCandidates: cands, policy: policyWith([("groupSize", N(7))]), groupSize: nil)
        XCTAssertEqual(big.queue.count, 7)
        XCTAssertFalse(big.queue.contains("base:\u{9759}"))
        XCTAssertEqual(try selectDaily(sched: .object(JSObject()), records: [], newCandidates: []).queue, [], "nothing to write (R-H11)")
    }

    // daily: custom: keys outside the deck are never selected
    func testDailyCustomKeysOutsideTheDeckAreNeverSelected() throws {
        let res = try selectDaily(sched: table([("custom:\u{2000B}", sched("2026-09-01"))]), records: [], newCandidates: ["custom:\u{2000B}", "base:\u{9759}"])
        XCTAssertEqual(res.queue, ["base:\u{9759}"])
    }
}
