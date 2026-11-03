import Foundation
import XCTest
@testable import ShiziCore

// test/platform/reminder.test.mjs 里属于规则的 6 个用例的转写（用例名保留原名）：提醒题目的选取、词语遮字、今天是否已练（按提醒时刻归日）、目标字归一、store 变化是否影响提醒。
// 其余 5 个（syncReminder 消息体、网页控制器的去重与去抖、冷启动深链的就绪队列、权限回调、邀请入口）是网页 ↔ 原生桥的运行时，B4 后不存在，清单里标「不转」。
// 题库用测试自带的 7 行 SEED（与原用例同一份），经 DeckCards 注入；其余规则读真实 policy / 文案。

final class ReminderTests: XCTestCase {
    let TODAY = "2026-09-24"
    let AT = at43("2026-09-24", 10)
    let DAY_MS = 24.0 * 3600 * 1000
    var serial = 0

    // 汉字与带声调拼音（转义）
    let xue = "\u{5B66}", xi = "\u{4E60}", tian = "\u{5929}", kong = "\u{7A7A}", ming = "\u{660E}", bai = "\u{767D}", hai = "\u{6D77}", shan = "\u{5C71}", chuan = "\u{5DDD}"
    let shui = "\u{6C35}", xianC = "\u{9C9C}"
    var blank: String { Config.policyString("reminderBlank")! }

    func row(_ ans: String, _ ci: Int, _ py: String, _ extra: [(String, JSValue)] = []) -> JSValue {
        let target = String(Array(ans.unicodeScalars)[ci])
        var o = JSObject([("py", s43(py)), ("hint", s43("")), ("ans", s43(ans)), ("ci", n43(ci)), ("target", s43(target)), ("rank", n43(1)), ("strokes", n43(3)), ("parts", n43(1)), ("topic", s43("t")),
                          ("d", n43(50)), ("band", s43("\u{57FA}\u{7840}")), ("edu", .null), ("common", n43(1)), ("norm", s43("\u{4E00}\u{7EA7}")), ("std", n43(0)), ("ctx", s43("dict"))])
        for (k, v) in extra { o[k] = v }
        return .object(o)
    }

    lazy var deck: Reminder.Deck = {
        let seed = [row(xue + xi, 1, "x\u{ED}"), row(tian + kong, 1, "k\u{14D}ng"), row(ming + bai, 1, "b\u{E1}i"), row(ren243 + ren243, 0, "r\u{E9}n"),
                    row(shui, 0, "shu\u{1D0}", [("ctx", s43("gloss")), ("hint", s43("\u{4E09}\u{70B9}\u{6C34}"))]), row(da43 + hai, 1, "h\u{1CE}i"), row(shan + chuan, 1, "chu\u{101}n")]
        let d = try! DeckCards(seed: seed, overrides: nil)
        return Reminder.Deck(cardFor: { d.cardForKey($0) }, practicable: { d.isPracticable($0) })
    }()

    func judged(_ char: String, _ judgment: String, _ atMs: Double) throws -> JSValue {
        serial += 1
        return try Records.makeRecord(JSObject([("id", s43("r\(serial)")), ("cardKey", s43("base:" + char)), ("sessionId", s43("s1")), ("kind", s43("judged")), ("judgment", s43(judgment)), ("at", n43(atMs)),
                                                ("help", obj43([]))]), dates: shanghai43)
    }

    func stateWith(records: [JSValue] = [], sched: [(String, JSValue)] = [], settings: JSValue? = nil, wordOff: JSValue? = nil) -> JSValue {
        var months = JSObject()
        for r in records {
            let m = String(r["localDay"]!.stringValue!.prefix(7))
            months[m] = .array((months[m]?.arrayValue ?? []) + [r])
        }
        var o = JSObject([("records", .object(months)), ("sched", obj43(sched))])
        o["settings"] = settings ?? .null
        o["wordOff"] = wordOff ?? .null
        return .object(o)
    }

    func entry(_ due: String, _ extra: [(String, JSValue)] = []) -> JSValue {
        var o = JSObject([("fsrs", obj43([("stability", n43(1))])), ("due", s43(due)), ("lastJudgedAt", n43(AT - DAY_MS))])
        for (k, v) in extra { o[k] = v }
        return .object(o)
    }

    /// 习 写错过、明天到期；空 写对、4 天前到期（最久）；白 写对、今天到期；海 停练；川 后天之后才到期。
    func baseState(_ settings: JSValue? = nil) throws -> JSValue {
        let st = settings ?? J("{\"remind\":{\"enabled\":true,\"hour\":21,\"minute\":5}}")
        return stateWith(
            records: [try judged(kong, "correct", AT - 9 * DAY_MS), try judged(bai, "correct", AT - 5 * DAY_MS), try judged(xi, "wrong", AT - 2 * DAY_MS),
                      try judged(hai, "wrong", AT - 2 * DAY_MS), try judged(chuan, "correct", AT - 1 * DAY_MS)],
            sched: [("base:" + xi, entry("2026-09-25")), ("base:" + kong, entry("2026-09-20")), ("base:" + bai, entry("2026-09-24")),
                    ("base:" + hai, entry("2026-09-01", [("stoppedAt", n43(AT - DAY_MS))])), ("base:" + chuan, entry("2026-10-10")),
                    ("base:" + xianC, entry("2026-09-01"))], // 不在题库：不能练
            settings: st)
    }

    func candidates(_ state: JSValue, policy: JSObject? = nil) throws -> [Reminder.Candidate] { try Reminder.reminderCandidates(state, deck: deck, policy: policy, dates: shanghai43) }

    // candidates follow P48: 写错过 first, then the longest overdue; stopped / unpracticable / no-context-word excluded
    func testCandidatesFollowP48FirstThenTheLongestOverdueStoppedUnpracticableNoContextWordExcluded() throws {
        let list = try candidates(try baseState())
        XCTAssertEqual(list.map { "\($0.cardKey)|\($0.wrong)|\($0.due)" }, ["base:\(xi)|true|2026-09-25", "base:\(kong)|false|2026-09-20", "base:\(bai)|false|2026-09-24", "base:\(chuan)|false|2026-10-10"])
        var withGloss = try baseState()
        var sched = withGloss["sched"]!.objectValue!
        sched["base:" + shui] = entry("2026-09-01")
        withGloss = setting(withGloss, "sched", .object(sched))
        XCTAssertFalse(try candidates(withGloss).contains { $0.cardKey == "base:" + shui }, "gloss card has no word")
        let off = setting(try baseState(), "wordOff", obj43([("base:" + kong, n43(AT))]))
        XCTAssertFalse(try candidates(off).contains { $0.cardKey == "base:" + kong }, "word replaced -> no word left")
        XCTAssertThrowsCore("range", containing: "reminderPick") { _ = try candidates(try baseState(), policy: Reminder.policyObject(JSObject([("reminderPick", s43("random"))]))) }
    }

    // questions: one per day from chars due by that day, 写错过 first, no repeats while others are left
    func testQuestionsOnePerDayFromCharsDueByThatDayFirstNoRepeatsWhileOthersAreLeft() throws {
        let qs = try Reminder.reminderQuestions(try baseState(), today: s43(TODAY), deck: deck, dates: shanghai43)
        XCTAssertEqual(Reminder.reminderDays, 8)
        XCTAssertEqual(qs.count, 8, "every day of the window has a due char")
        XCTAssertEqual(qs.prefix(4).map { "\($0["day"]!.stringValue!)|\($0["targetCardKey"]!.stringValue!)" }, [
            "2026-09-24|base:\(kong)", // 今天：到期的只有 空（09-20）、白（09-24）；都写对 -> 到期最久的 空
            "2026-09-25|base:\(xi)", // 明天：习 到期且写错过 -> 排最前
            "2026-09-26|base:\(bai)", // 前两个用过了
            "2026-09-27|base:\(xi)", // 都用过：沿旧版取第一个
        ])
        let tomorrow = qs[1]
        XCTAssertEqual(tomorrow.objectValue?.keys.sorted(), ["body", "day", "targetCardKey", "title"])
        XCTAssertEqual(tomorrow["title"], s43(try Copy.text("X-REMIND.title", JSObject([("word", s43(xue + blank)), ("pinyin", s43("x\u{ED}"))]))), "word with the target masked + pinyin")
        XCTAssertEqual(tomorrow["title"], s43(xue + blank + "\u{FF08}x\u{ED}\u{FF09}"), "the target position is the full-width low line, parentheses full-width")
        XCTAssertEqual(tomorrow["body"], s43(try Copy.text("X-REMIND.body")))
        for q in qs { for k in ["day", "title", "body", "targetCardKey"] { XCTAssertFalse((q[k]?.stringValue ?? "").isEmpty, "\(k) non-empty (native drops empty fields)") } }
        XCTAssertEqual(try Reminder.reminderQuestions(stateWith(), today: s43(TODAY), deck: deck, dates: shanghai43).count, 0, "nothing due -> no questions")
        XCTAssertThrowsCore("range", containing: "invalid today") { _ = try Reminder.reminderQuestions(try baseState(), today: s43("2026-9-24"), deck: deck, dates: shanghai43) }
    }

    // masked word: every position of the target is blanked; policy.reminderWord=word keeps the old whole word
    func testMaskedWordEveryPositionOfTheTargetIsBlankedPolicyReminderWordWordKeepsTheOldWholeWord() {
        func card(_ chars: [String], _ target: String, word: String? = nil) -> JSValue {
            var o = JSObject([("chars", arrayOf43(chars)), ("target", s43(target))])
            if let w = word { o["word"] = s43(w) }
            return .object(o)
        }
        func pol(_ k: String, _ v: JSValue) -> JSObject { Reminder.policyObject(JSObject([(k, v)])) }
        XCTAssertEqual(Reminder.maskedWord(card([ren243, ren243], ren243, word: ren243 + ren243)), blank + blank)
        XCTAssertEqual(Config.policyString("reminderBlank"), "\u{FF3F}", "P99 (D53): the lock-screen blank is the full-width low line")
        XCTAssertEqual(Reminder.maskedWord(card(["\u{5C34}", "\u{5C2C}"], "\u{5C34}")), blank + "\u{5C2C}", "N2-13: the lock screen reads the blank, not a lookalike of the mouth radical")
        XCTAssertEqual(Reminder.maskedWord(card([ren243, ren243], ren243), policy: pol("reminderBlank", s43("?"))), "??", "policy.reminderBlank is what is used")
        XCTAssertEqual(Reminder.maskedWord(card([xue, xi], xi), policy: pol("reminderWord", s43("word"))), xue + xi)
        XCTAssertEqual(Config.policyString("reminderWord"), "blank", "P48 transitional default")
    }

    // practicedToday (D66 ⑦): written at 1 am belongs to the day before — tonight's reminder still fires
    func testPracticedTodayD66WrittenAt1AmBelongsToTheDayBeforeTonightsReminderStillFires() throws {
        // 凌晨 1 点（日历 9 月 25 日）写了一个字：localDay = 9 月 24 日；今晚 21:05 的提醒属于 9 月 25 日，没练过
        let oneAm = at43("2026-09-25", 1, 0)
        var st = try baseState()
        let r = try judged(bai, "correct", oneAm)
        var months = st["records"]!.objectValue!
        let m = String(r["localDay"]!.stringValue!.prefix(7))
        months[m] = .array((months[m]?.arrayValue ?? []) + [r])
        st = setting(st, "records", .object(months))
        let today = s43(try shanghai43.localDay(n43(oneAm)))
        XCTAssertEqual(today, s43("2026-09-24"))
        XCTAssertEqual(try Reminder.fireDayOf(n43(oneAm), obj43([("hour", n43(21)), ("minute", n43(5))]), today, dates: shanghai43), s43("2026-09-25"))
        let p1 = try Reminder.reminderPayload(st, today: today, now: n43(oneAm), deck: deck, dates: shanghai43)
        XCTAssertEqual(p1["practicedToday"], .bool(false), "1 am practice does not silence tonight")
        let tenPm = at43("2026-09-24", 22, 0)
        let p2 = try Reminder.reminderPayload(st, today: s43(try shanghai43.localDay(n43(tenPm))), now: n43(tenPm), deck: deck, dates: shanghai43)
        XCTAssertEqual(p2["practicedToday"], .bool(true), "the evening before: practiced that day")
        // 提醒时刻本身在 0–4 点之间：属于前一天
        XCTAssertEqual(try Reminder.fireDayOf(n43(oneAm), obj43([("hour", n43(2)), ("minute", n43(0))]), s43("2026-09-24"), dates: shanghai43), s43("2026-09-24"))
    }

    // normalizeTargetKey accepts base:/custom:/bare single chars only
    func testNormalizeTargetKeyAcceptsBaseCustomBareSingleCharsOnly() {
        XCTAssertEqual(Reminder.normalizeTargetKey(s43("base:" + xi)), "base:" + xi)
        XCTAssertEqual(Reminder.normalizeTargetKey(s43(" " + xi + " ")), "base:" + xi)
        XCTAssertEqual(Reminder.normalizeTargetKey(s43("custom:" + xi)), "custom:" + xi)
        XCTAssertNil(Reminder.normalizeTargetKey(s43("base:" + xue + xi)))
        XCTAssertNil(Reminder.normalizeTargetKey(n43(42)))
        XCTAssertNil(Reminder.normalizeTargetKey(s43("")))
    }

    // affectsReminder: records / sched / settings / wordOff writes and replacements; not session strokes or status
    func testAffectsReminderRecordsSchedSettingsWordOffWritesAndReplacementsNotSessionStrokesOrStatus() {
        func a(_ json: String) -> Bool { Reminder.affectsReminder(J(json)) }
        XCTAssertTrue(a("{\"type\":\"commit\",\"keys\":[\"shizi.v2.records.2026-09\",\"shizi.v2.sessions\"]}"))
        XCTAssertTrue(a("{\"type\":\"commit\",\"keys\":[\"shizi.v2.sched\"]}"))
        XCTAssertTrue(a("{\"type\":\"commit\",\"keys\":[\"shizi.v2.settings\"]}"))
        XCTAssertTrue(a("{\"type\":\"commit\",\"keys\":[\"shizi.v2.wordOff\"]}"))
        XCTAssertFalse(a("{\"type\":\"commit\",\"keys\":[\"shizi.v2.sessions\"]}"))
        XCTAssertTrue(a("{\"type\":\"commit\",\"keys\":[],\"replace\":true}"))
        XCTAssertTrue(a("{\"type\":\"load\"}"))
        XCTAssertFalse(a("{\"type\":\"status\"}"))
        XCTAssertFalse(Reminder.affectsReminder(.null))
    }
}
