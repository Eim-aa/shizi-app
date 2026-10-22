import Foundation
import XCTest
@testable import ShiziCore

// test/core/first-result.test.mjs 的转写（11 个用例，用例名保留原名）。
// 第 9 条（commitInviteShown / commitInviteAnswer 经 store.commit）：规则部分（新的 settings 或「跳过」）在这里逐步对照；store 的提交 / 校验 / 发布由 B4.4。
// 第 10、11 条（特别组顺延：sessions.selectDaily / specialPlan / special.capitalSpecial / session-start.deferSpecial）依赖 B4.2 的 Swift 模块，
// 清单已改记 B4.2，这里留 XCTSkip 占位，B4.2 并入后在它那张卡里转。

final class FirstResultTests: XCTestCase {
    let TODAY = "2026-09-24"
    let gan = "\u{5C34}" // 尴
    let yingC = "\u{8D62}" // 赢
    let shi = "\u{62FE}" // 拾
    let tiao = "\u{8DF3}" // 跳
    let jia = "\u{7532}" // 甲

    func item(_ c: String) -> JSValue { obj43([("char", s43(c)), ("cardKey", s43("base:" + c))]) }
    func sched(_ due: String, _ extra: [(String, JSValue)] = []) -> JSValue {
        var o = JSObject([("fsrs", obj43([("stability", n43(3))])), ("due", s43(due)), ("lastJudgedAt", n43(0))])
        for (k, v) in extra { o[k] = v }
        return .object(o)
    }
    func day(_ n: Int) -> String { try! shanghai43.addDays(TODAY, Double(n)) }
    func preview(_ chars: [JSValue], _ sched: [(String, JSValue)]) throws -> FirstResult.Preview {
        try FirstResult.reviewPreview(chars: chars, sched: obj43(sched), today: s43(TODAY), dates: shanghai43)
    }
    func line(_ chars: [JSValue], _ sched: [(String, JSValue)]) throws -> String {
        try FirstResult.daysLaterLine(chars: chars, sched: obj43(sched), today: s43(TODAY), dates: shanghai43)
    }

    // test/core/first-result.test.mjs: tierOfDue: ≤1 day = 明天, 2–3 = 过两天, ≥4 = 过几天 (already due counts as 明天)
    func testTierOfDueLE1DayTomorrow23SoonGE4LaterAlreadyDueCountsAsTomorrow() throws {
        func tier(_ d: Int) throws -> String { try FirstResult.tierOfDue(s43(day(d)), s43(TODAY), dates: shanghai43) }
        XCTAssertEqual(try tier(-2), "tomorrow")
        XCTAssertEqual(try tier(0), "tomorrow")
        XCTAssertEqual(try tier(1), "tomorrow")
        XCTAssertEqual(try tier(2), "soon")
        XCTAssertEqual(try tier(3), "soon")
        XCTAssertEqual(try tier(4), "later")
        XCTAssertEqual(try tier(30), "later")
    }

    // test/core/first-result.test.mjs: reviewDays: per-char days until the real FSRS due day (same source as the preview sentence); already due counts as 1; no schedule -> not listed
    func testReviewDaysPerCharDaysUntilTheRealFSRSDueDayAlreadyDueCountsAs1NoScheduleNotListed() throws {
        let out = try FirstResult.reviewDays(chars: [item(gan), item(yingC), item(shi), item(tiao), item(gan)],
                                             sched: obj43([("base:" + gan, sched(day(8))), ("base:" + yingC, sched(day(1))), ("base:" + shi, sched(day(-2)))]),
                                             today: s43(TODAY), dates: shanghai43)
        XCTAssertEqual(out.map { $0.js }, [
            obj43([("char", s43(gan)), ("cardKey", s43("base:" + gan)), ("days", n43(8))]),
            obj43([("char", s43(yingC)), ("cardKey", s43("base:" + yingC)), ("days", n43(1))]),
            obj43([("char", s43(shi)), ("cardKey", s43("base:" + shi)), ("days", n43(1))]),
        ], "group order, duplicates dropped, the skipped one (no sched) left out, overdue -> 1")
        let p = try preview([item(yingC), item(gan)], [("base:" + yingC, sched(day(1))), ("base:" + gan, sched(day(8)))])
        XCTAssertEqual(p.groups.map { $0.tier }, ["tomorrow", "later"])
        XCTAssertEqual(try FirstResult.reviewDays(chars: [], sched: obj43([]), today: s43(TODAY), dates: shanghai43).count, 0)
        XCTAssertEqual(try FirstResult.reviewDays(chars: [item(jia)], sched: obj43([("base:" + jia, sched(day(5), [("stoppedAt", n43(1))]))]), today: s43(TODAY), dates: shanghai43).count, 0, "stopped chars never come back")
    }

    // test/core/first-result.test.mjs: daysLaterText: 「N 天后再见」, and 「明天再见」 for 1 day (copy slots X-FIRST.daysLater / daysLaterTomorrow, P185)
    func testDaysLaterTextNDaysLaterAndTomorrowForOneDay() throws {
        let tomorrow = "\u{660E}\u{5929}\u{518D}\u{89C1}"
        XCTAssertEqual(try FirstResult.daysLaterText(n43(1)), tomorrow)
        XCTAssertEqual(try FirstResult.daysLaterText(n43(0)), tomorrow, "never says 0 days")
        XCTAssertEqual(try FirstResult.daysLaterText(n43(2)), "2 \u{5929}\u{540E}\u{518D}\u{89C1}")
        XCTAssertEqual(try FirstResult.daysLaterText(n43(8)), "8 \u{5929}\u{540E}\u{518D}\u{89C1}")
        XCTAssertEqual(try Copy.text("X-FIRST.daysLater", JSObject([("n", n43(12))])), "12 \u{5929}\u{540E}\u{518D}\u{89C1}")
    }

    // test/core/first-result.test.mjs: reviewPreview + previewText: tiers merge by due (near -> far); the design-sheet sentences
    func testReviewPreviewPreviewTextTiersMergeByDueNearToFarTheDesignSheetSentences() throws {
        func sc(_ a: Int, _ b: Int, _ c: Int) -> [(String, JSValue)] { [("base:" + gan, sched(day(a))), ("base:" + yingC, sched(day(b))), ("base:" + shi, sched(day(c)))] }
        let three = [item(gan), item(yingC), item(shi)]
        let mixed = try preview(three, sc(2, 1, 3))
        XCTAssertEqual(mixed.js, J("{\"groups\":[{\"tier\":\"tomorrow\",\"chars\":[\"\(yingC)\"]},{\"tier\":\"soon\",\"chars\":[\"\(gan)\",\"\(shi)\"]}],\"same\":false}"))
        XCTAssertEqual(try FirstResult.previewText(mixed), "\u{300C}\u{8D62}\u{300D}\u{660E}\u{5929}\u{518D}\u{6765}\u{FF0C}\u{300C}\u{5C34}\u{300D}\u{300C}\u{62FE}\u{300D}\u{8FC7}\u{4E24}\u{5929}\u{3002}")

        XCTAssertEqual(try FirstResult.previewText(try preview(three, sc(5, 1, 2))),
                       "\u{300C}\u{8D62}\u{300D}\u{660E}\u{5929}\u{518D}\u{6765}\u{FF0C}\u{300C}\u{62FE}\u{300D}\u{8FC7}\u{4E24}\u{5929}\u{FF0C}\u{300C}\u{5C34}\u{300D}\u{8FC7}\u{51E0}\u{5929}\u{3002}")

        let same = try preview(three, sc(2, 2, 3))
        XCTAssertTrue(same.same)
        XCTAssertEqual(try FirstResult.previewText(same), "\u{8FC7}\u{4E24}\u{5929}\u{FF0C}\u{5B83}\u{4EEC}\u{518D}\u{6765}\u{3002}")
        let tomorrowAll = try preview([item(gan), item(yingC)], [("base:" + gan, sched(day(1))), ("base:" + yingC, sched(day(1)))])
        XCTAssertEqual(try FirstResult.previewText(tomorrowAll), "\u{660E}\u{5929}\u{FF0C}\u{5B83}\u{4EEC}\u{518D}\u{6765}\u{3002}")

        let one = try preview([item(yingC)], [("base:" + yingC, sched(day(1)))])
        XCTAssertFalse(one.same, "a single char is not the plural")
        XCTAssertEqual(try FirstResult.previewText(one), "\u{300C}\u{8D62}\u{300D}\u{660E}\u{5929}\u{518D}\u{6765}\u{3002}")
    }

    // test/core/first-result.test.mjs: daysLaterLine (E9c, D48): the result-page 复现句 — chars with the same days merge (near -> far), all same days -> one bare clause, unscheduled chars are left out
    func testDaysLaterLineE9cD48TheResultPageSentenceCharsWithTheSameDaysMergeNearToFarAllSameDaysOneBareClauseUnscheduledCharsAreLeftOut() throws {
        let chars = [item(gan), item(yingC), item(shi)]
        func sc(_ a: Int, _ b: Int, _ c: Int) -> [(String, JSValue)] { [("base:" + gan, sched(day(a))), ("base:" + yingC, sched(day(b))), ("base:" + shi, sched(day(c)))] }
        XCTAssertEqual(try line(chars, sc(8, 1, 3)),
                       "\u{300C}\u{8D62}\u{300D}\u{660E}\u{5929}\u{518D}\u{89C1}\u{FF0C}\u{300C}\u{62FE}\u{300D}3 \u{5929}\u{540E}\u{518D}\u{89C1}\u{FF0C}\u{300C}\u{5C34}\u{300D}8 \u{5929}\u{540E}\u{518D}\u{89C1}\u{3002}")
        XCTAssertEqual(try line(chars, sc(3, 1, 3)),
                       "\u{300C}\u{8D62}\u{300D}\u{660E}\u{5929}\u{518D}\u{89C1}\u{FF0C}\u{300C}\u{5C34}\u{300D}\u{300C}\u{62FE}\u{300D}3 \u{5929}\u{540E}\u{518D}\u{89C1}\u{3002}", "same days merge into one clause, in group order")
        XCTAssertEqual(try line(chars, sc(2, 2, 2)), "2 \u{5929}\u{540E}\u{518D}\u{89C1}\u{3002}")
        XCTAssertEqual(try line([item(gan), item(yingC)], [("base:" + gan, sched(day(-2))), ("base:" + yingC, sched(TODAY))]), "\u{660E}\u{5929}\u{518D}\u{89C1}\u{3002}", "already due counts as tomorrow")
        XCTAssertEqual(try line([item(yingC)], [("base:" + yingC, sched(day(1)))]), "\u{300C}\u{8D62}\u{300D}\u{660E}\u{5929}\u{518D}\u{89C1}\u{3002}", "a single char keeps its own clause")
        XCTAssertEqual(try line(chars, [("base:" + shi, sched(day(4)))]), "\u{300C}\u{62FE}\u{300D}4 \u{5929}\u{540E}\u{518D}\u{89C1}\u{3002}", "no schedule (skipped / answer-seen) -> left out")
        XCTAssertEqual(try line(chars, []), "", "none at all -> no sentence")
        XCTAssertEqual(try line([item(gan)], [("base:" + gan, sched(day(3), [("stoppedAt", n43(5))]))]), "", "stopped cards never come back")
    }

    // test/core/first-result.test.mjs: reviewPreview: chars without a schedule (skipped / answer-seen, D18) are left out; none at all -> no sentence
    func testReviewPreviewCharsWithoutAScheduleAreLeftOutNoneAtAllNoSentence() throws {
        let p = try preview([item(gan), item(yingC), item(shi)], [("base:" + shi, sched(day(3)))])
        XCTAssertEqual(p.js["groups"], J("[{\"tier\":\"soon\",\"chars\":[\"\(shi)\"]}]"))
        XCTAssertEqual(try FirstResult.previewText(p), "\u{300C}\u{62FE}\u{300D}\u{8FC7}\u{4E24}\u{5929}\u{518D}\u{6765}\u{3002}")
        let none = try preview([item(gan), item(yingC)], [])
        XCTAssertEqual(none.groups.count, 0)
        XCTAssertEqual(try FirstResult.previewText(none), "")
        let stopped = try preview([item(gan)], [("base:" + gan, sched(day(3), [("stoppedAt", n43(5))]))])
        XCTAssertEqual(stopped.groups.count, 0, "stopped cards never come back")
        let dup = try preview([item(gan), item(gan)], [("base:" + gan, sched(day(1)))])
        XCTAssertEqual(dup.js["groups"], J("[{\"tier\":\"tomorrow\",\"chars\":[\"\(gan)\"]}]"))
    }

    // test/core/first-result.test.mjs: inviteTime: now floored to the half hour; outside 7:00–22:00 -> 20:30 (evening title)
    func testInviteTimeNowFlooredToTheHalfHourOutside7To22Gives2030() throws {
        func t(_ h: Int, _ m: Int) -> JSValue { FirstResult.inviteTime(at43("2026-09-24", h, m), dates: shanghai43) }
        func want(_ h: Int, _ m: Int, _ e: Bool) -> JSValue { J("{\"hour\":\(h),\"minute\":\(m),\"evening\":\(e)}") }
        XCTAssertEqual(t(9, 41), want(9, 30, false))
        XCTAssertEqual(t(9, 29), want(9, 0, false))
        XCTAssertEqual(t(7, 0), want(7, 0, false))
        XCTAssertEqual(t(21, 59), want(21, 30, false))
        XCTAssertEqual(t(22, 0), want(20, 30, true))
        XCTAssertEqual(t(23, 40), want(20, 30, true))
        XCTAssertEqual(t(6, 50), want(20, 30, true), "6:50 floors to 6:30, before 7:00")
        XCTAssertEqual(t(0, 5), want(20, 30, true))
        XCTAssertEqual(FirstResult.inviteTimeText(n43(9), n43(30)), "9:30")
        XCTAssertEqual(FirstResult.inviteTimeText(n43(20), n43(0)), "20:00")
        XCTAssertEqual(try Copy.text("X-INVITE.accepted", JSObject([("time", s43(FirstResult.inviteTimeText(n43(9), n43(30))))])), "\u{597D}\u{FF0C}\u{660E}\u{5929} 9:30 \u{7ED9}\u{4F60}\u{4E00}\u{4E2A}\u{8BCD}\u{3002}")
    }

    // test/core/first-result.test.mjs: inviteDecision: asked at most twice — first result page once, then the next daily result page once; never after an answer
    func testInviteDecisionAskedAtMostTwiceFirstResultPageOnceThenTheNextDailyResultPageOnceNeverAfterAnAnswer() {
        func S(_ remindInvite: [(String, JSValue)]?, _ remind: [(String, JSValue)]? = nil) -> JSValue {
            var o = JSObject()
            if let r = remindInvite { o["remindInvite"] = obj43(r) }
            if let r = remind { o["remind"] = obj43(r) }
            return .object(o)
        }
        func d(_ settings: JSValue?, _ variant: String, _ sid: String) -> String { FirstResult.inviteDecision(settings: settings, variant: s43(variant), sessionId: s43(sid)) }
        XCTAssertEqual(FirstResult.inviteMax, 2)
        // 第一次：首练结果页显示；每日结果页不显示
        XCTAssertEqual(d(.null, "first", "s1"), "show")
        XCTAssertEqual(d(.null, "daily", "s2"), "hidden")
        XCTAssertEqual(d(.null, "picked", "s3"), "hidden")
        // 首练页已邀请（shown 1，last s1）：同一页继续显示；未回应 -> 下一次每日结果页再问一次
        let once = S([("shown", n43(1)), ("last", s43("s1"))])
        XCTAssertEqual(d(once, "first", "s1"), "show")
        XCTAssertEqual(d(once, "daily", "s2"), "show", "second chance")
        XCTAssertEqual(d(once, "picked", "s2"), "hidden", "picked result pages never invite")
        XCTAssertEqual(d(once, "first", "s9"), "hidden", "a later first-variant page does not restart the count")
        // 第二次已问：再下一页不再问；但就是第二次那一页本身仍显示
        let twice = S([("shown", n43(2)), ("last", s43("s2"))])
        XCTAssertEqual(d(twice, "daily", "s2"), "show")
        XCTAssertEqual(d(twice, "daily", "s3"), "hidden")
        // 回应过：永不再问
        for answered in ["yes", "no", "denied"] { XCTAssertEqual(d(S([("shown", n43(1)), ("last", s43("s1")), ("answered", s43(answered))]), "daily", "s2"), "hidden", answered) }
        // 提醒已经开着：不问
        XCTAssertEqual(d(S(nil, [("enabled", .bool(true))]), "first", "s1"), "hidden")
        XCTAssertEqual(d(S(nil, [("enabled", .bool(false))]), "first", "s1"), "show")
    }

    // test/core/first-result.test.mjs: commitInviteShown / commitInviteAnswer: counted once per session, capped at 2, answers stick; all through store.commit
    func testCommitInviteShownCommitInviteAnswerCountedOncePerSessionCappedAt2AnswersStickAllThroughStoreCommit() throws {
        var settings: JSValue = .null // 新库没有 settings
        var commits: [String] = []
        func shown(_ sid: String) -> Bool {
            guard let next = FirstResult.inviteShownUpdate(settings: settings, sessionId: s43(sid)) else { return false }
            settings = next
            commits.append(FirstResult.inviteShownLabel)
            return true
        }
        func answer(_ a: String) throws -> Bool {
            guard let next = try FirstResult.inviteAnswerUpdate(settings: settings, answer: s43(a)) else { return false }
            settings = next
            commits.append(FirstResult.inviteAnswerLabel)
            return true
        }
        XCTAssertEqual(FirstResult.inviteOf(settings), FirstResult.Invite(shown: 0, last: nil, answered: nil))
        XCTAssertTrue(shown("s1"))
        XCTAssertEqual(FirstResult.inviteOf(settings), FirstResult.Invite(shown: 1, last: "s1", answered: nil))
        XCTAssertFalse(shown("s1"), "same session (page refresh) is not counted again")
        XCTAssertTrue(shown("s2"))
        XCTAssertEqual(FirstResult.inviteOf(settings).shown, 2)
        XCTAssertFalse(shown("s3"), "never more than two")
        XCTAssertEqual(FirstResult.inviteOf(settings).last, "s2")
        XCTAssertTrue(try answer("no"))
        XCTAssertEqual(FirstResult.inviteOf(settings).answered, "no")
        XCTAssertFalse(try answer("no"))
        XCTAssertThrowsCore("range") { _ = try FirstResult.inviteAnswerUpdate(settings: settings, answer: s43("maybe")) }
        XCTAssertEqual(commits, ["invite:shown", "invite:shown", "invite:answer"], "only these commits")
        // 其他 settings 字段不被抹掉
        settings = setting(settings, "sound", .bool(false))
        XCTAssertTrue(try answer("denied"))
        XCTAssertEqual(settings["sound"], .bool(false))
        XCTAssertEqual(settings["remindInvite"]?["shown"], n43(2))
        // 写出的形状过形状表（schema 认这些字段）
        XCTAssertNil(Schema.validateValue(key: Schema.keyNamed("settings")!, value: settings))
    }

    // test/core/first-result.test.mjs: special deferral (D46 ④): only the deferred day skips the special group; the next day it is back if the conditions hold
    func testSpecialDeferralD46OnlyTheDeferredDaySkipsTheSpecialGroupTheNextDayItIsBackIfTheConditionsHold() throws {
        throw XCTSkip("needs B4.2 (sessions.selectDaily / specialPlan / special.capitalSpecial); the transcription list assigns this case to B4.2")
    }

    // test/core/first-result.test.mjs: deferSpecial writes settings.capitalDeferredDay once through store.commit; planDaily / planSpecial read it
    func testDeferSpecialWritesSettingsCapitalDeferredDayOnceThroughStoreCommitPlanDailyPlanSpecialReadIt() throws {
        throw XCTSkip("needs B4.2 (session-start planDaily / planSpecial / deferSpecial) and B4.4 (store.commit); the transcription list assigns this case to B4.2")
    }
}
