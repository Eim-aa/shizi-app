import Foundation
import XCTest
@testable import ShiziCore

// test/core/session-start.test.mjs 的逐条转写（24 条）：开组的 store.commit 包装——首练 3 字、今天的练习选字、S02、跨天过期、失败不发布（D07）。
// JS 里用真的 createStore；Swift 用 MemoryScheduleStore（seed / commits / failNext）。假题库 {newCandidates, practicable, currentLibraryId}
// 对应 ScheduleDeck。第 18–20 条里关于 data/deck.js 内部（注入 SEED、卡片、prompt.js 再导出、S02 正文的 UI 拼字）的部分属于 B4.3（卡片构建）/ UI，
// 这里只转写能用 DeckIndex（字库成员 / 顺序 / 默认字库 / 可练）与 ScheduleRules.s02Data + Copy 表达的部分，各条注释里写明哪些留在 JS。

final class SessionStartTests: XCTestCase {
    // MARK: 助手

    let tz = TimeZone(identifier: "Asia/Shanghai")!
    lazy var rules = ScheduleRules(timeZone: tz)
    let TODAY = "2026-09-24"
    let YESTERDAY = "2026-09-23"
    let policy = Config.policy

    final class Clock { var t: Double; init(_ t: Double) { self.t = t } }

    struct Env {
        let store: MemoryScheduleStore
        let clock: Clock
        var now: Double { clock.t }
        var state: JSValue { .object(store.state) }
        var sessions: JSValue { store.state["sessions"] ?? .null }
        var commits: [String] { store.commits.map { $0.label } }
    }

    func at(_ day: String, _ hour: Int = 12, _ minute: Int = 0) -> Double {
        let p = day.split(separator: "-").map { Int($0)! }
        return JSDate.makeLocal(p[0], p[1] - 1, p[2], hours: hour, tz)! + Double(minute) * 60000
    }

    func makeEnv(_ nowMs: Double? = nil) -> Env {
        let clock = Clock(nowMs ?? at(TODAY, 20))
        let store = MemoryScheduleStore(state: JSObject(), now: { clock.t })
        return Env(store: store, clock: clock)
    }

    func rec(_ serial: Int, _ ch: String, _ kind: String, _ judgment: String?, _ day: String, sessionId: String = "s1") -> JSValue {
        var o = JSObject([
            ("id", .string("r\(serial)")), ("cardKey", .string("base:" + ch)), ("char", .string(ch)), ("sessionId", .string(sessionId)), ("kind", .string(kind)),
            ("at", .number(at(day, 12, serial % 60))), ("localDay", .string(day)),
            ("help", JS.obj([("hints", .number(0)), ("answerSeen", .bool(kind == "answer-seen")), ("traced", .bool(false))])),
        ])
        if kind == "judged", let j = judgment { o["judgment"] = .string(j) }
        return .object(o)
    }

    func monthsOf(_ records: [JSValue]) -> JSValue {
        var out = JSObject()
        for r in records {
            let m = String(JS.string(r["localDay"]).prefix(7))
            var list = out[m]?.arrayValue ?? []
            list.append(r)
            out[m] = .array(list)
        }
        return .object(out)
    }

    func sched(_ due: String, _ stability: Double = 5) -> JSValue {
        JS.obj([("fsrs", JS.obj([("stability", .number(stability)), ("difficulty", .number(5)), ("state", .number(2))])), ("due", .string(due)), ("lastJudgedAt", .number(at("2026-09-01")))])
    }

    func session(id: String = "s90", slot: String = "A", kind: String? = nil, chars: [String], cursor: Double = 0, day: String? = nil, items: [JSValue] = []) -> JSValue {
        let d = day ?? TODAY
        let t = at(d, 9)
        return JS.obj([
            ("id", .string(id)), ("slot", .string(slot)), ("kind", .string(kind ?? (slot == "B" ? "picked" : "daily"))),
            ("source", JS.obj([("view", .string("home"))])), ("queue", .array(chars.map { .string("base:" + $0) })), ("cursor", .number(cursor)), ("items", .array(items)),
            ("current", JS.obj([("phase", .string("recall")), ("strokes", .array([])), ("hints", .number(0)), ("answerSeen", .bool(false)), ("hintRange", .null), ("referenceReady", .bool(false))])),
            ("lastLine", .null), ("startedAt", .number(t)), ("startedDay", .string(d)), ("updatedAt", .number(t)),
        ])
    }

    func item(_ char: String, _ recordId: String) -> JSValue {
        JS.obj([("cardKey", .string("base:" + char)), ("recordId", .string(recordId)), ("kind", .string("judged"))])
    }

    func emptySessions() -> JSValue { JS.obj([("A", .null), ("B", .null), ("lastEnded", .object(JSObject()))]) }

    func seed(_ env: Env, records: [JSValue] = [], schedTable: JSValue? = nil, sessions: JSValue? = nil, custom: JSValue? = nil, settings: [(String, JSValue)] = [],
              backupMeta: JSValue? = nil) {
        var st = JSObject([("records", monthsOf(records)), ("sched", schedTable ?? .object(JSObject())), ("sessions", sessions ?? emptySessions())])
        if let c = custom { st["custom"] = c }
        // D65 #2：本文件的用例按 5 字一组写（D41），缺省把「每组字数」设成 5；用例自己给 settings 时以它为准
        var s = JSObject([("groupSize", .number(5))])
        for (k, v) in settings { s[k] = v }
        st["settings"] = .object(s)
        if let b = backupMeta { st["backupMeta"] = b }
        env.store.seed(st)
    }

    func strs(_ v: JSValue?) -> [String] { (v?.arrayValue ?? []).map { JS.string($0) } }
    func K(_ chars: [String]) -> [String] { chars.map { "base:" + $0 } }
    func ch(_ s: String) -> [String] { s.unicodeScalars.map { String($0) } }

    // 假题库：新字来源按给定顺序；可练 = base: 且在题库里。
    var LIB: [String] { K(ch("\u{7532}\u{4E59}\u{4E19}\u{4E01}\u{620A}\u{5DF1}\u{5E9A}\u{8F9B}\u{58EC}\u{7678}")) }
    func fakeDeck(_ keys: [String]? = nil, extra: [String] = []) -> ScheduleDeck {
        let ks = keys ?? LIB
        let known = Set(ks + extra)
        return ScheduleDeck(newCandidates: { _ in ks }, practicable: { known.contains($0) }, currentLibraryId: { _ in .string("core3500") })
    }

    func addDays(_ day: String, _ n: Int) -> String { try! rules.dates.addDays(day, Double(n)) }
    func ok(_ r: JSValue?) -> Bool { r?["ok"] == .bool(true) }

    // MARK: 题库（P73）

    // test/core/session-start.test.mjs: planDaily: a deck without currentLibraryId falls back to settings.library, then policy.defaultLibrary (P73)
    func testPlanDailyADeckWithoutCurrentLibraryIdFallsBackToSettingsLibraryThenPolicyDefaultLibrary() throws {
        var asked: [String] = []
        let lib = LIB
        let deck = ScheduleDeck(newCandidates: { id in asked.append(JS.string(id)); return lib }, practicable: { lib.contains($0) })
        let empty = J(#"{"records":{},"sched":{},"sessions":{"A":null,"B":null,"lastEnded":{}}}"#)
        XCTAssertEqual(try rules.planDaily(empty, today: TODAY, deck: deck)["libraryId"], .string("core3500"))
        XCTAssertEqual(try rules.planDaily(JS.with(empty, [("settings", J(#"{"library":"adv3000"}"#))]), today: TODAY, deck: deck)["libraryId"], .string("adv3000"))
        XCTAssertEqual(try rules.planDaily(empty, today: TODAY, deck: deck, policy: JS.with(policy, [("defaultLibrary", .string("rare"))]))["libraryId"], .string("rare"))
        XCTAssertEqual(asked, ["core3500", "adv3000", "rare"])
    }

    // MARK: 第一次练习

    // test/core/session-start.test.mjs: first practice: fixed 3 characters from policy.firstQueue (P09 / D38), slot A, one commit
    func testFirstPracticeFixed3CharactersFromPolicyFirstQueueSlotAOneCommit() throws {
        let env = makeEnv()
        seed(env)
        let info = ScheduleRules.aStartInfo(env.state)
        XCTAssertEqual(info.kind, "first")
        XCTAssertTrue(info.firstVisit)
        let r = try rules.startNextA(env.store, now: env.now, deck: fakeDeck())
        XCTAssertTrue(ok(r))
        XCTAssertEqual(r["started"], .bool(true))
        XCTAssertEqual(r["kind"], .string("first"))
        let s = try XCTUnwrap(env.sessions["A"])
        XCTAssertEqual(strs(s["queue"]), K(strs(policy["firstQueue"])))
        XCTAssertEqual(strs(s["queue"]).count, 3, "D38: first practice is 3 characters (was 5 in D17 / P09)")
        XCTAssertEqual(strs(s["queue"]), ["base:\u{5C34}", "base:\u{8D62}", "base:\u{62FE}"])
        XCTAssertEqual(s["kind"], .string("first"))
        XCTAssertEqual(s["slot"], .string("A"))
        XCTAssertEqual(s["startedDay"], .string(TODAY))
        XCTAssertEqual(env.commits, ["session:start-first"])
        XCTAssertEqual(env.sessions["B"], .null)
    }

    // test/core/session-start.test.mjs: after clearing all records: next A is first again (P46) but not a first visit (R-H09)
    func testAfterClearingAllRecordsNextAIsFirstAgainP46ButNotAFirstVisitRH09() throws {
        let env = makeEnv()
        seed(env, backupMeta: J(#"{"lastExportAt":null,"lastExportSig":null,"lastConclusion":{"kind":"clear","date":"2026-09-23","count":3}}"#))
        XCTAssertTrue(ScheduleRules.everPracticed(env.state))
        var info = ScheduleRules.aStartInfo(env.state)
        XCTAssertEqual(info.kind, "first")
        XCTAssertFalse(info.firstVisit)
        let withRecords = makeEnv()
        seed(withRecords, records: [rec(1, "\u{7532}", "judged", "correct", YESTERDAY)], schedTable: JS.obj([("base:\u{7532}", sched("2026-09-30"))]))
        info = ScheduleRules.aStartInfo(withRecords.state)
        XCTAssertEqual(info.kind, "daily")
        XCTAssertFalse(info.firstVisit)
    }

    // test/core/session-start.test.mjs: startFirst ignores the deck and does not expire a first session across days (P61 never)
    func testStartFirstIgnoresTheDeckAndDoesNotExpireAFirstSessionAcrossDays() throws {
        let env = makeEnv()
        seed(env, sessions: JS.obj([("A", session(kind: "first", chars: ["\u{5C34}", "\u{568F}"], day: YESTERDAY)), ("B", .null), ("lastEnded", .object(JSObject()))]))
        let r = try rules.startFirst(env.store, now: env.now)
        XCTAssertTrue(ok(r))
        XCTAssertEqual(r["occupied"], .bool(true), "yesterday's unfinished first session is kept")
        XCTAssertEqual(env.commits.count, 0)
        let res = try rules.resumeSlot(env.store, slot: "A", now: env.now)
        XCTAssertEqual(res["session"]?["id"], .string("s90"))
        XCTAssertEqual(res["expired"], .array([]))
    }

    // MARK: 今天的练习

    // test/core/session-start.test.mjs: daily: due ordered overdue desc / stability asc, new characters in library order, interleaved review-new (D41); group size 5
    func testDailyDueOrderedOverdueDescStabilityAscNewCharactersInLibraryOrderInterleavedReviewNew() throws {
        let env = makeEnv()
        let zi = "\u{5B50}", chou = "\u{4E11}", yin = "\u{5BC5}", mao = "\u{536F}"
        seed(env,
             records: [
                 rec(1, zi, "judged", "correct", "2026-09-01"),
                 rec(2, chou, "judged", "wrong", "2026-09-01"),
                 rec(3, yin, "judged", "correct", "2026-09-01"),
                 // Q2-15（D48 ⑧）：最近一次练习落在昨天，本用例看的是 5 字组的排序
                 rec(4, mao, "judged", "correct", YESTERDAY),
             ],
             schedTable: JS.obj([
                 ("base:" + zi, sched("2026-09-20", 9)), // 逾期 4 天
                 ("base:" + chou, sched("2026-09-22", 1)), // 逾期 2 天
                 ("base:" + yin, sched("2026-09-22", 3)), // 逾期 2 天，稳定度高 → 排在丑后
                 ("base:" + mao, sched("2026-10-10")), // 未到期
             ]))
        let deck = fakeDeck(LIB, extra: ["base:" + zi, "base:" + chou, "base:" + yin, "base:" + mao])
        let r = try rules.startDaily(env.store, now: env.now, deck: deck)
        XCTAssertTrue(ok(r))
        XCTAssertEqual(r["started"], .bool(true))
        let s = try XCTUnwrap(env.sessions["A"])
        XCTAssertEqual(s["kind"], .string("daily"))
        // D41：3 个到期 → p = 3 / 4 = 0.75，落在「2 新」档；组内复、新交错（复 新 复 新 复）。
        // D65 #1：丑最近一次判断是写错 → 排在普通到期字（子、寅）之前；其余按逾期降序、稳定度升序。
        XCTAssertEqual(strs(s["queue"]), ["base:" + chou, "base:\u{7532}", "base:" + zi, "base:\u{4E59}", "base:" + yin])
        XCTAssertEqual(strs(r["plan"]?["dueKeys"]), ["base:" + chou, "base:" + zi, "base:" + yin])
        XCTAssertEqual(strs(r["plan"]?["newKeys"]), ["base:\u{7532}", "base:\u{4E59}"])
        XCTAssertEqual(strs(s["queue"]).count, 5)
        XCTAssertEqual(env.commits, ["session:start-daily"])
    }

    // test/core/session-start.test.mjs: daily: nothing to write → no commit, {empty}; libraryExhausted when every library character has a record
    func testDailyNothingToWriteNoCommitEmptyLibraryExhaustedWhenEveryLibraryCharacterHasARecord() throws {
        let env = makeEnv()
        let records = LIB.enumerated().map { (i, k) in rec(i + 1, String(k.dropFirst(5)), "judged", "correct", TODAY) }
        var schedTable = JSObject()
        for k in LIB { schedTable[k] = sched("2026-10-20") }
        seed(env, records: records, schedTable: .object(schedTable))
        let r = try rules.startDaily(env.store, now: env.now, deck: fakeDeck())
        XCTAssertTrue(ok(r))
        XCTAssertEqual(r["started"], .bool(false))
        XCTAssertEqual(r["empty"], .bool(true))
        XCTAssertEqual(r["libraryExhausted"], .bool(true))
        XCTAssertEqual(env.commits.count, 0)
        XCTAssertEqual(env.sessions["A"], .null)
    }

    // test/core/session-start.test.mjs: daily: an unfinished A is not replaced (occupied); a finished-but-not-ended A is ended in the same commit
    func testDailyAnUnfinishedAIsNotReplacedAFinishedButNotEndedAIsEndedInTheSameCommit() throws {
        let jia = "\u{7532}", yi = "\u{4E59}"
        let env = makeEnv()
        seed(env, sessions: JS.obj([("A", session(chars: [jia, yi], cursor: 1)), ("B", .null), ("lastEnded", .object(JSObject()))]))
        var r = try rules.startDaily(env.store, now: env.now, deck: fakeDeck())
        XCTAssertEqual(r["occupied"], .bool(true))
        XCTAssertEqual(env.commits.count, 0)

        let env2 = makeEnv()
        seed(env2,
             records: [rec(1, jia, "judged", "correct", TODAY, sessionId: "s90")],
             schedTable: JS.obj([("base:" + jia, sched("2026-09-26"))]),
             sessions: JS.obj([("A", session(chars: [jia], cursor: 1, items: [item(jia, "r1")])), ("B", .null), ("lastEnded", .object(JSObject()))]))
        r = try rules.startDaily(env2.store, now: env2.now, deck: fakeDeck())
        XCTAssertEqual(r["started"], .bool(true))
        let st = env2.sessions
        XCTAssertNotEqual(st["A"]?["id"], .string("s90"))
        XCTAssertFalse(strs(st["A"]?["queue"]).contains("base:" + jia), "jia judged today is not picked again")
        XCTAssertNil(st["lastEnded"]?["A"], "startInSlot clears lastEnded.A of the slot it opens")
        XCTAssertEqual(env2.commits.count, 1)
    }

    // test/core/session-start.test.mjs: daily expires across days (P37 discard): judged records stay, the slot is cleared, a new daily starts in one commit
    func testDailyExpiresAcrossDaysP37DiscardJudgedRecordsStayTheSlotIsClearedANewDailyStartsInOneCommit() throws {
        let jia = "\u{7532}", yi = "\u{4E59}", bing = "\u{4E19}", ding = "\u{4E01}"
        let env = makeEnv()
        seed(env,
             records: [rec(1, jia, "judged", "correct", YESTERDAY, sessionId: "s90")],
             schedTable: JS.obj([("base:" + jia, sched("2026-09-25"))]),
             sessions: JS.obj([
                 ("A", session(chars: [jia, yi, bing], cursor: 1, day: YESTERDAY, items: [item(jia, "r1")])),
                 ("B", session(id: "s91", slot: "B", chars: [ding], day: YESTERDAY)),
                 ("lastEnded", .object(JSObject())),
             ]))
        // 同一天不过期
        env.clock.t = at(YESTERDAY, 22)
        XCTAssertEqual(try rules.expireStale(env.store, now: env.now), J(#"{"ok":true,"expired":[],"spread":null}"#))
        XCTAssertEqual(env.commits.count, 0)
        // 第二天
        env.clock.t = at(TODAY, 7)
        let res = try rules.resumeSlot(env.store, slot: "A", now: env.now)
        XCTAssertTrue(ok(res))
        XCTAssertEqual(res["session"], .null)
        XCTAssertEqual((res["expired"]?.arrayValue ?? []).map { JS.string($0["id"]) }, ["s90"])
        var st = env.sessions
        XCTAssertEqual(st["A"], .null)
        XCTAssertEqual(st["B"]?["id"], .string("s91"), "picked B does not expire (P61 never)")
        XCTAssertEqual(ScheduleRules.recordsOf(env.state).count, 1, "the judged record stays")
        XCTAssertEqual(env.commits, ["session:expire"])
        let r = try rules.startDaily(env.store, now: env.now, deck: fakeDeck())
        XCTAssertEqual(r["started"], .bool(true))
        st = env.sessions
        XCTAssertEqual(st["A"]?["startedDay"], .string(TODAY))
        XCTAssertEqual(try rules.resumableSession(env.state, slot: "A", now: env.now)["id"], st["A"]?["id"])
        XCTAssertEqual(try rules.resumableSession(env.state, slot: "A", now: at("2026-09-25", 7)), .null, "would expire tomorrow")
        XCTAssertEqual(try rules.resumableSession(env.state, slot: "B", now: at("2026-09-25", 7))["id"], .string("s91"), "B never expires")

        // 过期与开新组在一次 commit 里
        let env2 = makeEnv(at(TODAY, 7))
        seed(env2, sessions: JS.obj([("A", session(chars: [jia, yi], day: YESTERDAY)), ("B", .null), ("lastEnded", .object(JSObject()))]))
        let r2 = try rules.startDaily(env2.store, now: env2.now, deck: fakeDeck())
        XCTAssertEqual(r2["started"], .bool(true))
        XCTAssertEqual(env2.commits, ["session:start-daily"])
        XCTAssertNil(env2.sessions["lastEnded"]?["A"], "discard: not kept for a result page")
    }

    // MARK: 这次选的字（B）与 S02

    // test/core/session-start.test.mjs: picked: free slot → one commit; source kept; duplicates and non-practicable characters dropped
    func testPickedFreeSlotOneCommitSourceKeptDuplicatesAndNonPracticableCharactersDropped() throws {
        let env = makeEnv()
        seed(env)
        let keys: [JSValue] = ["\u{7532}", "\u{4E59}", "\u{7532}", "base:\u{4E19}", "\u{9C9C}"].map { .string($0) }
        let r = try rules.startPicked(env.store, keys: keys, source: J(#"{"view":"library"}"#), deck: fakeDeck())
        XCTAssertEqual(r["started"], .bool(true))
        let b = try XCTUnwrap(env.sessions["B"])
        XCTAssertEqual(strs(b["queue"]), K(ch("\u{7532}\u{4E59}\u{4E19}")))
        XCTAssertEqual(b["source"], J(#"{"view":"library"}"#))
        XCTAssertEqual(b["kind"], .string("picked"))
        XCTAssertEqual(env.commits, ["session:start-picked"])
        XCTAssertThrowsError(try rules.startPicked(env.store, keys: [.string("\u{9C9C}")], deck: fakeDeck())) { error in
            XCTAssertTrue((error as? CoreError)?.message.contains("no practicable") ?? false, "\(error)")
        }
    }

    // test/core/session-start.test.mjs: picked while the old B is unfinished → no write, S02 data lists the unwritten characters (R-H05)
    func testPickedWhileTheOldBIsUnfinishedNoWriteS02DataListsTheUnwrittenCharacters() throws {
        let e = "\u{989D}", xian = "\u{9C9C}", jing = "\u{5883}"
        let env = makeEnv()
        let old = session(id: "s91", slot: "B", chars: [e, xian, jing], cursor: 1, items: [item(e, "r1")])
        seed(env,
             records: [rec(1, e, "judged", "correct", TODAY, sessionId: "s91")],
             schedTable: JS.obj([("base:" + e, sched("2026-09-26"))]),
             sessions: JS.obj([("A", .null), ("B", old), ("lastEnded", .object(JSObject()))]))
        let r = try rules.startPicked(env.store, keys: [.string("\u{7532}")], deck: fakeDeck())
        XCTAssertTrue(ok(r))
        XCTAssertEqual(r["started"], .bool(false))
        XCTAssertEqual(strs(r["s02"]?["unwrittenChars"]), [xian, jing])
        XCTAssertEqual(r["s02"]?["judgedCount"], .number(1))
        XCTAssertEqual(ScheduleRules.s02Data(env.state), r["s02"])
        XCTAssertEqual(env.commits.count, 0)
    }

    // test/core/session-start.test.mjs: S02 end-and-start: single commit; old B endedEarly into lastEnded.B; toast only when the old B had judgments (P38)
    func testS02EndAndStartSingleCommitOldBEndedEarlyIntoLastEndedBToastOnlyWhenTheOldBHadJudgments() throws {
        let e = "\u{989D}", xian = "\u{9C9C}", zi = "\u{5B50}"
        // 有判断
        let env = makeEnv()
        seed(env,
             records: [rec(1, e, "judged", "correct", TODAY, sessionId: "s91")],
             schedTable: JS.obj([("base:" + e, sched("2026-09-26"))]),
             sessions: JS.obj([
                 ("A", session(chars: [zi])),
                 ("B", session(id: "s91", slot: "B", chars: [e, xian], cursor: 1, items: [item(e, "r1")])),
                 ("lastEnded", .object(JSObject())),
             ]))
        let beforeA = env.sessions["A"]
        var r = try rules.endOldAndStartPicked(env.store, keys: [.string("\u{7532}"), .string("\u{4E59}")], source: J(#"{"view":"home"}"#), deck: fakeDeck())
        XCTAssertTrue(ok(r))
        XCTAssertEqual(env.commits, ["session:end-and-start-picked"], "exactly one commit")
        var st = env.sessions
        XCTAssertEqual(strs(st["B"]?["queue"]), K(ch("\u{7532}\u{4E59}")))
        XCTAssertEqual(st["lastEnded"]?["B"]?["id"], .string("s91"))
        XCTAssertEqual(st["lastEnded"]?["B"]?["endedEarly"], .bool(true))
        XCTAssertNotNil(st["lastEnded"]?["B"]?["endedAt"]?.numberValue)
        XCTAssertEqual(r["notice"], J(#"{"kind":"oldGroupSaved","judgedCount":1}"#))
        XCTAssertEqual(r["showOldResult"], .bool(false))
        XCTAssertEqual(st["A"], beforeA, "slot A untouched (D05)")
        XCTAssertEqual(ScheduleRules.recordsOf(env.state).count, 1, "judged record kept; unwritten adds nothing")

        // 零判断
        let env2 = makeEnv()
        seed(env2, sessions: JS.obj([("A", .null), ("B", session(id: "s91", slot: "B", chars: [e, xian])), ("lastEnded", .object(JSObject()))]))
        r = try rules.endOldAndStartPicked(env2.store, keys: [.string("\u{7532}")], deck: fakeDeck())
        XCTAssertTrue(ok(r))
        XCTAssertEqual(r["notice"], .null)
        st = env2.sessions
        XCTAssertEqual(st["lastEnded"]?["B"]?["endedEarly"], .bool(true))
        XCTAssertEqual(ScheduleRules.recordsOf(env2.state).count, 0)
    }

    // test/core/session-start.test.mjs: S02 end-and-start: a failed write publishes nothing (D07) and a retry succeeds once
    func testS02EndAndStartAFailedWritePublishesNothingD07AndARetrySucceedsOnce() throws {
        let e = "\u{989D}", xian = "\u{9C9C}"
        let env = makeEnv()
        seed(env, sessions: JS.obj([("A", .null), ("B", session(id: "s91", slot: "B", chars: [e, xian])), ("lastEnded", .object(JSObject()))]))
        let before = str(env.sessions)
        var failures = 1
        env.store.failNext = { _ in
            if failures > 0 { failures -= 1; return J(#"{"kind":"generic"}"#) }
            return nil
        }
        var r = try rules.endOldAndStartPicked(env.store, keys: [.string("\u{7532}")], deck: fakeDeck())
        XCTAssertEqual(r["ok"], .bool(false))
        XCTAssertEqual(str(env.sessions), before, "old B still in place, no new B")
        r = try rules.endOldAndStartPicked(env.store, keys: [.string("\u{7532}")], deck: fakeDeck())
        XCTAssertTrue(ok(r))
        XCTAssertEqual(strs(env.sessions["B"]?["queue"]).first, "base:\u{7532}")
        XCTAssertEqual(env.sessions["lastEnded"]?["B"]?["id"], .string("s91"))
    }

    // test/core/session-start.test.mjs: picked: a finished-but-not-ended B gives no S02 and is ended in the same commit
    func testPickedAFinishedButNotEndedBGivesNoS02AndIsEndedInTheSameCommit() throws {
        let e = "\u{989D}"
        let env = makeEnv()
        seed(env,
             records: [rec(1, e, "judged", "correct", TODAY, sessionId: "s91")],
             schedTable: JS.obj([("base:" + e, sched("2026-09-26"))]),
             sessions: JS.obj([("A", .null), ("B", session(id: "s91", slot: "B", chars: [e], cursor: 1, items: [item(e, "r1")])), ("lastEnded", .object(JSObject()))]))
        XCTAssertEqual(ScheduleRules.s02Data(env.state), .null)
        let r = try rules.startPicked(env.store, keys: [.string("\u{7532}")], deck: fakeDeck())
        XCTAssertEqual(r["started"], .bool(true))
        XCTAssertEqual(env.commits, ["session:start-picked"])
    }

    // MARK: data/deck.js

    // test/core/session-start.test.mjs: deck.js: cards from the injected SEED, library membership, SEED order as new-character order, default library
    // 只转写字库部分（DeckIndex）：成员、SEED 顺序、默认字库、currentLibraryId、可练。注入 SEED / allCards / cardForKey / setCardResolver / loadDeck 的
    // 失败路径（「no SEED global」「deck is not available」）是 data/deck.js 的卡片装载，属于 B4.3，留在 JS。
    func testDeckJsCardsFromTheInjectedSeedLibraryMembershipSeedOrderAsNewCharacterOrderDefaultLibrary() throws {
        let idx = DeckIndex.shared
        XCTAssertEqual(idx.defaultLibraryId, "core3500")
        XCTAssertEqual(.string(idx.defaultLibraryId), policy["defaultLibrary"], "DEFAULT_LIBRARY_ID comes from policy.defaultLibrary (P73)")
        XCTAssertEqual(idx.currentLibraryId(nil), .string("core3500"))
        XCTAssertEqual(idx.currentLibraryId(J(#"{"library":"nope"}"#)), .string("core3500"))
        XCTAssertEqual(idx.currentLibraryId(J(#"{"library":"adv3000"}"#)), .string("adv3000"))
        XCTAssertNil(idx.library(.string("nope")))
        func libraryKeys(_ id: String) -> [String] { idx.library(.string(id))?.keys ?? [] }
        func idsOfKey(_ key: String) -> [String] { idx.libraries.filter { $0.keys.contains(key) }.map { $0.id } }
        // 成员（真实题库里这几个字的归属与 JS 用例注入的 SEED 一致）
        XCTAssertTrue(libraryKeys("core3500").contains("base:\u{7684}") && libraryKeys("core3500").contains("base:\u{5C34}") && libraryKeys("core3500").contains("base:\u{4E00}"))
        XCTAssertFalse(libraryKeys("core3500").contains("base:\u{568F}"))
        XCTAssertTrue(libraryKeys("curriculum2500").contains("base:\u{7684}") && libraryKeys("curriculum2500").contains("base:\u{4E00}"))
        XCTAssertFalse(libraryKeys("curriculum2500").contains("base:\u{5C34}"))
        XCTAssertEqual(idsOfKey("base:\u{7684}"), ["core3500", "curriculum2500"])
        XCTAssertEqual(idsOfKey("base:\u{568F}"), ["adv3000"])
        // 字库成员按 SEED（全部卡键）顺序
        var position = KeyMap<Int>()
        for (i, k) in idx.keys.enumerated() { position[k] = i }
        for lib in idx.libraries {
            let pos = lib.keys.map { position[$0] ?? -1 }
            XCTAssertFalse(pos.contains(-1), lib.id)
            XCTAssertEqual(pos, pos.sorted(), "\(lib.id) keeps the SEED order")
        }
        // deckAdapter：新字 = 当前字库（易忘度顺序），未知字库回到默认字库；可练 = 题库里的 base: 卡
        let adapter = ScheduleDeck.real
        XCTAssertTrue(adapter.newCandidates(.string("adv3000")).contains("base:\u{568F}"))
        XCTAssertEqual(adapter.newCandidates(.string("adv3000")), idx.newOrder(.string("adv3000")))
        XCTAssertEqual(adapter.newCandidates(.string("nope")), idx.newOrder(.string("core3500")), "an unknown library falls back to the default one")
        XCTAssertTrue(adapter.practicable("base:\u{4E00}"))
        XCTAssertFalse(adapter.practicable("base:\u{1F600}"))
        XCTAssertFalse(adapter.practicable("custom:\u{4E00}"), "only base: cards are practicable")
    }

    // test/core/session-start.test.mjs: deck.js via prompt.js: the M1-8 import path re-exports the same cardForKey / setCardResolver
    // prompt.js 对 data/deck.js 的再导出（模块导入路径）是 JS 模块结构，Swift 没有对应物；这里转写的是它背后的不变量：
    // 「选字用的题库访问只有一份」——ScheduleDeck.real 的新字 / 热身 / 可练都直接来自 DeckIndex.shared（同一个对象，不是第二份拷贝）。
    func testDeckJsViaPromptJsTheM18ImportPathReExportsTheSameCardForKeySetCardResolver() throws {
        let idx = DeckIndex.shared
        let adapter = ScheduleDeck.real
        let id = JSValue.string(idx.defaultLibraryId)
        XCTAssertEqual(adapter.newCandidates(id), idx.newOrder(id))
        XCTAssertEqual(adapter.warmupCandidates?(id), idx.warmup(id))
        for k in idx.keys.prefix(50) { XCTAssertEqual(adapter.practicable(k), idx.isPracticable(k)) }
        XCTAssertEqual(adapter.currentLibraryId?(nil), idx.currentLibraryId(nil))
    }

    // test/core/session-start.test.mjs: S02 body names the unwritten characters (R-H05)
    // 「鲜」「境」的引号拼接（quoteChars）在 UI 的 s02.js 里，留在 JS；这里转写正文模板（R-H05.body，copy 表）+ s02Data 的未写字列表。
    func testS02BodyNamesTheUnwrittenCharacters() throws {
        func quoteChars(_ chars: [String]) -> String { chars.map { "\u{300C}\($0)\u{300D}" }.joined() }
        func s02Body(_ chars: [String]) throws -> String { try Copy.text("R-H05.body", JSObject([("chars", .string(quoteChars(chars)))])) }
        let xian = "\u{9C9C}", jing = "\u{5883}"
        XCTAssertEqual(quoteChars([xian, jing]), "\u{300C}\u{9C9C}\u{300D}\u{300C}\u{5883}\u{300D}")
        XCTAssertEqual(try s02Body([xian, jing]), "\u{4E0A}\u{4E00}\u{7EC4}\u{8FD8}\u{6709}\u{300C}\u{9C9C}\u{300D}\u{300C}\u{5883}\u{300D}\u{6CA1}\u{5199}\u{3002}")
        XCTAssertEqual(try s02Body([xian]), "\u{4E0A}\u{4E00}\u{7EC4}\u{8FD8}\u{6709}\u{300C}\u{9C9C}\u{300D}\u{6CA1}\u{5199}\u{3002}")
        // 正文里的字来自 s02Data.unwrittenChars（含当前字）
        let env = makeEnv()
        seed(env, sessions: JS.obj([("A", .null), ("B", session(id: "s91", slot: "B", chars: [xian, jing])), ("lastEnded", .object(JSObject()))]))
        XCTAssertEqual(try s02Body(strs(ScheduleRules.s02Data(env.state)["unwrittenChars"])), "\u{4E0A}\u{4E00}\u{7EC4}\u{8FD8}\u{6709}\u{300C}\u{9C9C}\u{300D}\u{300C}\u{5883}\u{300D}\u{6CA1}\u{5199}\u{3002}")
    }

    // MARK: 阶段 1 P1-E4：D38 首练之后的第一组、D41 热身字、D40 特别组

    // test/core/session-start.test.mjs: startDaily opens the D40 special group as an ordinary daily session: one commit, queue 壹贰叁肆伍, then 陆柒捌玖拾 next
    func testStartDailyOpensTheD40SpecialGroupAsAnOrdinaryDailySessionOneCommit() throws {
        let env = makeEnv()
        var records: [JSValue] = []
        for g in 1...10 {
            records.append(rec(g, String(Unicode.Scalar(0x6200 + g)!), "judged", "correct", "2026-09-\(13 + g)", sessionId: "s\(g)"))
        }
        seed(env, records: records)
        let deck = ScheduleDeck(newCandidates: { _ in ["base:\u{4EA6}", "base:\u{9C9C}"] }, practicable: { _ in true }, currentLibraryId: { _ in .string("core3500") })
        let r = try rules.startDaily(env.store, now: env.now, deck: deck)
        XCTAssertEqual(r["started"], .bool(true))
        XCTAssertEqual(r["plan"]?["special"]?["kind"], .string("capital1"))
        let s = try XCTUnwrap(env.sessions["A"])
        XCTAssertEqual(s["kind"], .string("daily"))
        XCTAssertEqual(strs(s["queue"]), K(ch("\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}")))
        XCTAssertEqual(env.commits, ["session:start-daily"])
    }

    // MARK: D66 ⑨：离开 ≥ 30 天回来时把到期字摊开（只一次）

}
