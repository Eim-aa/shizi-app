import Foundation
import XCTest
@testable import ShiziCore

// test/core/after-seen-works.test.mjs（5 个用例）与 test/core/paper-works.test.mjs（9 个用例）的转写，用例名保留原名。
// 作品出口的成员规则（看后自写 / 纸上记录 / D42 取段内留有墨迹的那一次）在这里逐条核对；原用例里经过「图片 / 页面视图」的断言
// （core/images/pick.js 的格子与版式、session/views/annual|mine 的模型、store/budget.js 的折叠）用测试里按同一规则直接装配的成员代替（helpers 见 WorkMembersTests.swift），
// 视图 / 折叠 / 图片本身分别在 B4.5 / B4.4 / B4.6 的转写里接上（它们的清单行里这些用例已标明）。

final class AfterSeenWorksTests: XCTestCase {
    // 10-02：永 写对（r1，有墨）；和 看过答案并自己写（r2，有墨）；春 看过答案没写（r3，无墨）；大 跳过（r4）
    // 10-05：和 写错（r5，墨已回收）；中 看过答案并自己写（r6，有墨）
    func fixture() -> JSValue {
        let records = [
            rec43(1, yong43, "judged", "correct", "2026-10-02"), rec43(2, he43, "answer-seen", nil, "2026-10-02"), rec43(3, chun43, "answer-seen", nil, "2026-10-02"),
            rec43(4, da43, "skipped", nil, "2026-10-02"), rec43(5, he43, "judged", "wrong", "2026-10-05", sessionId: "s2"), rec43(6, zhong43, "answer-seen", nil, "2026-10-05", sessionId: "s2"),
        ]
        return stateOf43(records, inked: ["r1", "r2", "r6"])
    }

    // test/core/after-seen-works.test.mjs: Q1 pick: the day image takes after-seen chars with ink; seen-without-ink / skipped stay out
    func testQ1PickTheDayImageTakesAfterSeenCharsWithInkSeenWithoutInkSkippedStayOut() {
        let st = fixture()
        let has = hasInkOfState43(st)
        XCTAssertEqual(pairs43(dayMembers43(st, "2026-10-02", hasInk: has)), [yong43, "r1", he43, "r2"])
        // 不给 hasInk 时按 state.ink 判断看后自写有没有墨
        XCTAssertEqual(dayMembers43(st, "2026-10-02").map { $0.char }, [yong43, he43])
        // 看过答案没写（春）、跳过（大）：不是成员
        XCTAssertFalse(WorkMembers.isWorkMember(allRecords43(st).first { $0["id"] == s43("r3") }, hasInk: has))
        XCTAssertFalse(WorkMembers.isWorkMember(allRecords43(st).first { $0["id"] == s43("r4") }, hasInk: has))
    }

    // test/core/after-seen-works.test.mjs: Q1 pick: the month sheet takes after-seen chars; D42 picks the record with ink inside the month (an after-seen one counts)
    func testQ1PickTheMonthSheetTakesAfterSeenCharsD42PicksTheRecordWithInkInsideTheMonthAnAfterSeenOneCounts() {
        let st = fixture()
        let has = hasInkOfState43(st)
        let m = monthMembers43(st, "2026-10", hasInk: has)
        XCTAssertEqual(pairs43(m), [yong43, "r1", he43, "r2", zhong43, "r6"],
                       "he: the first record with ink this month is the after-seen r2 (the later judged r5 lost its ink); chun (seen, no ink) is not in")
        // 没有 hasInk 也同口径（年报 yearMonths 只问成员数）
        XCTAssertEqual(monthMembers43(st, "2026-10").count, 3)
    }

    // test/core/after-seen-works.test.mjs: Q1 pick: the session image keeps the after-seen member with its ink (作品「看后写的」)
    func testQ1PickTheSessionImageKeepsTheAfterSeenMemberWithItsInk() {
        let st = fixture()
        let has = hasInkOfState43(st)
        // 这次（s1）的条目：永 judged r1、和 answer-seen r2、春 answer-seen r3、大 skipped r4
        let items: [(String, String)] = [("r1", "judged"), ("r2", "answer-seen"), ("r3", "answer-seen"), ("r4", "skipped")]
        let recs = allRecords43(st)
        let inWork = items.compactMap { (id, _) in recs.first { $0["id"] == s43(id) } }.filter { WorkMembers.isWorkMember($0, hasInk: has) }
        XCTAssertEqual(ids43(inWork), ["r1", "r2"], "work cells: yong, he (written after seeing the answer)")
        XCTAssertEqual(inWork.map { $0["kind"]?.stringValue }, ["judged", "answer-seen"], "the after-seen member is tagged by its kind")
        let rows = items.compactMap { (id, _) in recs.first { $0["id"] == s43(id) } }.filter { !WorkMembers.isWorkMember($0, hasInk: has) }
        XCTAssertEqual(rows.map { [$0["char"]!.stringValue!, $0["kind"]!.stringValue!] }, [[chun43, "answer-seen"], [da43, "skipped"]], "chun seen, da skipped stay out")
    }

    // test/core/after-seen-works.test.mjs: Q1 mine: 月字帖 and the chars of a day include after-seen chars with ink
    func testQ1MineMonthSheetAndTheCharsOfADayIncludeAfterSeenCharsWithInk() {
        let st = fixture()
        let has = hasInkOfState43(st)
        let sheet = monthMembers43(st, "2026-10", hasInk: has)
        XCTAssertEqual(pairs43(sheet), [yong43, "r1", he43, "r2", zhong43, "r6"])
        XCTAssertEqual(sheet.count, 3, "month char count = cells")
        XCTAssertEqual(pairs43(dayMembers43(st, "2026-10-05", hasInk: has)), [zhong43, "r6"], "he on 10-05 is a wrong write: not a member (D51 5), and nothing is borrowed from 10-02")
        XCTAssertEqual(dayMembers43(st, "2026-10-02", hasInk: has).map { $0.char }, [yong43, he43])
        // 日历「写过的日子」仍只看判断（看过答案不是有效记录，D18 / D23）
        let judgedDays = Set(allRecords43(st).filter { Records.isJudged($0) }.map { $0["localDay"]!.stringValue! })
        XCTAssertEqual(judgedDays.sorted(), ["2026-10-02", "2026-10-05"])
    }

    // test/core/after-seen-works.test.mjs: Q1 annual: 年字数 and month sections count after-seen chars with ink; the first char of the year is still the first judged one
    func testQ1AnnualYearCharCountAndMonthSectionsCountAfterSeenCharsWithInkTheFirstCharOfTheYearIsStillTheFirstJudgedOne() {
        let st = stateOf43([rec43(1, zhong43, "answer-seen", nil, "2026-01-03"), rec43(2, yong43, "judged", "correct", "2026-01-05"), rec43(3, chun43, "answer-seen", nil, "2026-02-01")], inked: ["r1", "r2"])
        let has = hasInkOfState43(st)
        let works = WorkMembers.workMemberRecords(allRecords43(st), hasInk: has)
        var seen = OSet()
        for r in works { seen.insert(r["char"]!.stringValue!) }
        XCTAssertEqual(seen.items, [zhong43, yong43], "chun (seen, never written) is not counted")
        XCTAssertEqual(seen.count, 2)
        var months = OMap<Int>()
        for m in monthMembers43(st, "2026-01", hasInk: has) + monthMembers43(st, "2026-02", hasInk: has) {
            let month = String(m.record["localDay"]!.stringValue!.prefix(7))
            months[month] = (months[month] ?? 0) + 1
        }
        XCTAssertEqual(months.entries.map { "\($0.key):\($0.value)" }, ["2026-01:2"])
        let firstJudged = Records.sortById(allRecords43(st).filter { Records.isJudged($0) }).first
        XCTAssertEqual(firstJudged?["char"], s43(yong43), "the first char of the year stays the first judged char")
    }
}

final class PaperWorksTests: XCTestCase {
    let INK = true
    func mixedYear() -> [JSValue] {
        [
            paper43(rec43(0, "\u{5148}", "judged", "correct", "2026-01-02")), // 今年最早，但只在纸上 -> 不是「今年第一个字」
            rec43(1, yong43, "judged", "correct", "2026-03-02"), rec43(2, he43, "judged", "correct", "2026-03-02"),
            paper43(rec43(3, zhi43, "judged", "correct", "2026-03-03")), // 只在纸上写过 -> 不计
            paper43(rec43(4, he43, "judged", "wrong", "2026-03-04")), // 和 屏幕上也写过 -> 仍是 1 个字
            rec43(5, "\u{5C71}", "judged", "correct", "2026-09-02"), paper43(rec43(6, "\u{7B14}", "judged", "wrong", "2026-09-05")),
        ]
    }

    // test/core/paper-works.test.mjs: isWorkRecord / withoutPaper: judged and not on paper
    func testIsWorkRecordWithoutPaperJudgedAndNotOnPaper() {
        XCTAssertTrue(Records.isWorkRecord(rec43(1, yong43, "judged", "correct", "2026-09-02")))
        XCTAssertFalse(Records.isWorkRecord(paper43(rec43(1, yong43, "judged", "correct", "2026-09-02"))))
        XCTAssertFalse(Records.isWorkRecord(rec43(1, yong43, "skipped", nil, "2026-09-02")))
        XCTAssertFalse(Records.isWorkRecord(rec43(1, yong43, "answer-seen", nil, "2026-09-02")))
        XCTAssertFalse(Records.isWorkRecord(.null))
        XCTAssertEqual(ids43(Records.withoutPaper([rec43(1, yong43, "judged", "correct", "2026-09-02"), paper43(rec43(2, he43, "judged", "correct", "2026-09-02"))])), ["r1"])
    }

    // test/core/paper-works.test.mjs: pick: a char written only on paper is not a member of day / month / glyph; with a screen record too, the screen record is the member (D42 fallback must not pick the paper one)
    func testPickACharWrittenOnlyOnPaperIsNotAMemberOfDayMonthGlyphWithAScreenRecordTooTheScreenRecordIsTheMember() {
        let recs = [
            rec43(1, yong43, "judged", "correct", "2026-09-02"), paper43(rec43(2, zhi43, "judged", "correct", "2026-09-02")),
            // 和：屏幕上写过但没留墨（段内全无墨 -> 兜底取偏好方向上那条）、之后又在纸上写过：兜底必须落在屏幕那条，不能是纸上那条
            rec43(3, he43, "judged", "correct", "2026-09-03"), paper43(rec43(4, he43, "judged", "correct", "2026-09-04")),
        ]
        let st = stateOf43(recs)
        let noInk: InkPick.HasInk = { _ in false }
        XCTAssertEqual(dayMembers43(st, "2026-09-02", hasInk: noInk).map { $0.char }, [yong43], "day: the paper-only char is not in")
        XCTAssertEqual(dayMembers43(st, "2026-09-04", hasInk: noInk).count, 0, "a paper-only day has no members")
        let month = monthMembers43(st, "2026-09", hasInk: noInk)
        XCTAssertEqual(pairs43(month), [yong43, "r1", he43, "r3"], "month: zhi not in; he fallback is its screen record r3")
        XCTAssertEqual(month.map { $0.record["source"] }, [nil, nil])
        let days = Set(month.flatMap { _ in [String]() } + recs.filter { Records.isWorkRecord($0) }.map { $0["localDay"]!.stringValue! })
        XCTAssertEqual(days.count, 2, "month days count work days only (the calendar uses the record index instead)")
        // glyph（单字）：只在纸上 -> 没有成员；最近一条在纸上 -> 取最近的屏幕记录
        func glyph(_ ch: String) -> WorkMembers.Member? { WorkMembers.workMembers(recs.filter { $0["char"] == s43(ch) }, prefer: s43("last"), hasInk: noInk).first }
        XCTAssertNil(glyph(zhi43), "glyph: only on paper -> no member")
        XCTAssertEqual(glyph(he43)?.record["id"], s43("r3"), "glyph: the latest record is on paper -> the latest screen record, the paper one takes no place")
        XCTAssertEqual(glyph(he43)?.firstDay, s43("2026-09-03"))
    }

    // test/core/paper-works.test.mjs: pick: image plans — day / month / glyph exclude paper; the glyph of a paper-only char is empty
    func testPickImagePlansDayMonthGlyphExcludePaperTheGlyphOfAPaperOnlyCharIsEmpty() {
        let st = stateOf43([rec43(1, yong43, "judged", "correct", "2026-09-02"), paper43(rec43(2, zhi43, "judged", "correct", "2026-09-02")), paper43(rec43(3, yong43, "judged", "wrong", "2026-09-05"))])
        let ink: InkPick.HasInk = { r in !Records.isPaperRecord(r) } // inkOf：纸上的没有墨
        XCTAssertEqual(dayMembers43(st, "2026-09-02", hasInk: ink).map { $0.char }, [yong43])
        XCTAssertEqual(dayMembers43(st, "2026-09-05", hasInk: ink).count, 0, "a paper-only day is empty")
        let month = monthMembers43(st, "2026-09", hasInk: ink)
        XCTAssertEqual(month.map { $0.char }, [yong43])
        XCTAssertEqual(month.count, 1)
        let glyphZhi = WorkMembers.workMembers(allRecords43(st).filter { $0["char"] == s43(zhi43) }, prefer: s43("last"), hasInk: ink)
        XCTAssertEqual(glyphZhi.count, 0, "the glyph of a paper-only char has no ink")
        let g = WorkMembers.workMembers(allRecords43(st).filter { $0["char"] == s43(yong43) }, prefer: s43("last"), hasInk: ink)
        XCTAssertEqual(g.first?.record["id"], s43("r1"), "the glyph image uses the latest screen record, not the later paper one")
    }

    // test/core/paper-works.test.mjs: pick: session work — the paper char is not in the work, shows as a paper row with no 「放进去」; all on paper -> the no-ink variant
    func testPickSessionWorkThePaperCharIsNotInTheWorkShowsAsAPaperRowWithNoPutItInAllOnPaperTheNoInkVariant() {
        let rs = [rec43(1, "\u{7586}", "judged", "correct", "2026-10-05", sessionId: "s9"), paper43(rec43(2, "\u{9171}", "judged", "wrong", "2026-10-05", sessionId: "s9")),
                  paper43(rec43(3, "\u{75D2}", "judged", "correct", "2026-10-05", sessionId: "s9"))]
        let added = WorkMembers.Added(["r2"])
        let yes: InkPick.HasInk = { _ in true }
        let members = rs.filter { WorkMembers.isWorkMember($0, hasInk: yes, added: added) }
        XCTAssertEqual(members.map { $0["char"]!.stringValue! }, ["\u{7586}"])
        let paperRows = rs.filter { Records.isPaperRecord($0) }
        XCTAssertEqual(paperRows.map { [$0["char"]!.stringValue!, $0["judgment"]!.stringValue!] }, [["\u{9171}", "wrong"], ["\u{75D2}", "correct"]])
        // 「放进去」只对屏幕上写错的记录：纸上的写错，即使 id 在 session.added 里也不是成员
        XCTAssertFalse(WorkMembers.isWorkMember(rs[1], hasInk: yes, added: added), "no put-it-in, even when its id is in session.added")
        XCTAssertEqual(WorkMembers.workMembers(rs, hasInk: yes, added: added).map { $0.dot }, [false])
        // 全在纸上：没有成员（无墨变体）
        XCTAssertEqual(WorkMembers.workMembers(rs.map(paper43), hasInk: yes, added: added).count, 0, "all on paper -> the no-ink variant")
    }

    // test/core/paper-works.test.mjs: annual: year count, first char of the year and each month's 「{n} 字」 skip paper-only chars (D47)
    func testAnnualYearCountFirstCharOfTheYearAndEachMonthsNCharsSkipPaperOnlyCharsD47() {
        let st = stateOf43(mixedYear())
        let works = WorkMembers.workMemberRecords(allRecords43(st), hasInk: { _ in true })
        var seen = OSet()
        for r in works { seen.insert(r["char"]!.stringValue!) }
        XCTAssertEqual(seen.count, 3, "yong he shan count; xian zhi bi are paper-only")
        XCTAssertEqual(seen.items, [yong43, he43, "\u{5C71}"])
        let sorted = Records.sortById(works.filter { Records.isWorkRecord($0) })
        XCTAssertEqual(sorted.first?["char"], s43(yong43), "the earliest record this year is on paper -> the first char is the earliest work record")
        XCTAssertEqual(sorted.first?["localDay"], s43("2026-03-02"))
        var months = OMap<OSet>()
        for r in works { let m = String(r["localDay"]!.stringValue!.prefix(7)); var set = months[m] ?? OSet(); set.insert(r["char"]!.stringValue!); months[m] = set }
        XCTAssertEqual(months.entries.map { "\($0.key):\($0.value.count)" }, ["2026-03:2", "2026-09:1"])
        XCTAssertEqual(Set(works.map { $0["localDay"]!.stringValue! }).count, 2, "days with work this year")
        // 只在纸上写过的月份不出一段
        let onlyPaper = stateOf43([rec43(1, yong43, "judged", "correct", "2026-03-02"), paper43(rec43(2, zhi43, "judged", "correct", "2026-05-02"))])
        let w2 = WorkMembers.workMemberRecords(allRecords43(onlyPaper), hasInk: { _ in true })
        XCTAssertEqual(Set(w2.map { String($0["localDay"]!.stringValue!.prefix(7)) }), ["2026-03"])
        XCTAssertEqual(w2.count, 1)
    }

    // test/core/paper-works.test.mjs: mine sheet / day list / month count: monthSheet and dayItems skip paper; the signature days and the calendar do not (a paper day still counts as written)
    func testMineSheetDayListMonthCountMonthSheetAndDayItemsSkipPaperTheSignatureDaysAndTheCalendarDoNot() {
        let st = stateOf43(mixedYear())
        let has: InkPick.HasInk = { _ in true }
        let sheet = monthMembers43(st, "2026-03", hasInk: has)
        XCTAssertEqual(sheet.map { $0.char }, [yong43, he43], "the home / records month sheet: no zhi")
        XCTAssertEqual(sheet.count, 2, "the character count does not count zhi")
        // 落款天数与日历按「写过的日子」（含纸上）算
        let writtenDays = Set(allRecords43(st).filter { Records.isJudged($0) && ($0["localDay"]!.stringValue!).hasPrefix("2026-03-") }.map { $0["localDay"]!.stringValue! })
        XCTAssertEqual(writtenDays.sorted(), ["2026-03-02", "2026-03-03", "2026-03-04"], "days written in March: 3-02, 3-03 (paper), 3-04 (paper)")
        XCTAssertEqual(dayMembers43(st, "2026-03-03", hasInk: has).map { $0.char }, [], "a paper-only day has no chars to list")
        XCTAssertEqual(dayMembers43(st, "2026-03-04", hasInk: has).map { $0.char }, [], "he on paper that day: the screen record is on another day")
        XCTAssertEqual(dayMembers43(st, "2026-03-02", hasInk: has).map { $0.char }, [yong43, he43])
        // 日历 / 概览天数：不过滤（纸上那天仍写过）
        XCTAssertEqual(Records.judgedDaysInMonth(allRecords43(st), "2026-03"), ["2026-03-02", "2026-03-03", "2026-03-04"], "calendar: the paper days still show a dot")
        let onlyPaper = [paper43(rec43(1, zhi43, "judged", "correct", "2026-09-24"))]
        XCTAssertEqual(Records.todayCount(onlyPaper, "2026-09-24"), 1, "overview: a paper-only day still counts as a practice day")
        XCTAssertTrue(Records.hasAnyJudged(onlyPaper), "only paper this month: not an empty Mine page (it was written)")
        XCTAssertEqual(WorkMembers.workMemberRecords(onlyPaper, hasInk: { _ in true }).count, 0, "but no sheet block: there is nothing to put in it")
    }

    func foldMarch() -> JSValue {
        // 折叠时记下的形状（store/budget.js foldMonth 的产出：JS 参考实现的输出，逐字固定在这里）
        J("{\"folded\":true,\"month\":\"2026-03\",\"byDay\":{\"2026-03-02\":[\"\(yong43)\",\"\(he43)\"],\"2026-03-03\":[\"\(zhi43)\"],\"2026-03-04\":[\"\(he43)\"]},\"chars\":[\"\(yong43)\",\"\(he43)\",\"\(zhi43)\"],\"kept\":[],\"paperOnly\":{\"2026-03-03\":[\"\(zhi43)\"],\"2026-03-04\":[\"\(he43)\"]}}")
    }

    // test/core/paper-works.test.mjs: fold: foldMonth records paperOnly — (day, char) pairs written only on paper — and nothing when there are none; the shape validates
    func testFoldFoldMonthRecordsPaperOnlyDayCharPairsWrittenOnlyOnPaperAndNothingWhenThereAreNoneTheShapeValidates() {
        // 折叠本身（budget.recover → foldMonth）在 B4.4；这里核对折叠产物的形状与读取规则
        let march = foldMarch()
        XCTAssertNil(Schema.validateRecordsMonth(march, month: "2026-03"))
        XCTAssertEqual(Records.foldWorkByDay(march), J("{\"2026-03-02\":[\"\(yong43)\",\"\(he43)\"]}").objectValue!)
        XCTAssertSameJSON(.object(Records.foldWorkByDay(march)), J("{\"2026-03-02\":[\"\(yong43)\",\"\(he43)\"]}"))
        // 没有纸上记录的月份不带这个字段（旧数据形状不变）：没有 paperOnly = byDay 本身
        XCTAssertSameJSON(.object(Records.foldWorkByDay(J("{\"byDay\":{\"2026-03-02\":[\"\(yong43)\"]}}"))), J("{\"2026-03-02\":[\"\(yong43)\"]}"), "no paperOnly (older folds) = byDay")
        XCTAssertEqual(Records.foldWorkByDay(.null).count, 0)
    }

    // test/core/paper-works.test.mjs: fold: a folded month — annual year count / month count / month members skip paper-only chars; the calendar days keep them
    func testFoldAFoldedMonthAnnualYearCountMonthCountMonthMembersSkipPaperOnlyCharsTheCalendarDaysKeepThem() {
        let march = foldMarch()
        let work = Records.foldWorkByDay(march)
        // 年字数 / 月字数 / 月字帖成员：折叠月份取作品口径的 byDay（去掉只在纸上写过的字）
        var chars = OSet()
        for d in work.keys { for c in work[d]!.arrayValue! { chars.insert(c.stringValue!) } }
        let oct = [rec43(6, "\u{5C71}", "judged", "correct", "2026-10-02")]
        for r in oct { chars.insert(r["char"]!.stringValue!) }
        XCTAssertEqual(chars.items, [yong43, he43, "\u{5C71}"], "zhi (only on paper in a folded month) is not counted")
        XCTAssertEqual(chars.count, 3)
        XCTAssertEqual(work.keys, ["2026-03-02"], "year days: work days only (3-02, then 10-02 from the live month)")
        // 日历：纸上那几天仍是写过的日子（byDay 本身不过滤）
        XCTAssertEqual(march["byDay"]?.objectValue?.keys, ["2026-03-02", "2026-03-03", "2026-03-04"])
    }

    // test/core/paper-works.test.mjs: fold: a month folded with paper-only chars only gives no month section and no count
    func testFoldAMonthFoldedWithPaperOnlyCharsOnlyGivesNoMonthSectionAndNoCount() {
        let fold = J("{\"folded\":true,\"month\":\"2026-03\",\"byDay\":{\"2026-03-03\":[\"\(zhi43)\"]},\"chars\":[\"\(zhi43)\"],\"kept\":[],\"paperOnly\":{\"2026-03-03\":[\"\(zhi43)\"]}}")
        XCTAssertNil(Schema.validateRecordsMonth(fold, month: "2026-03"))
        XCTAssertEqual(Records.foldWorkByDay(fold).count, 0, "no month section, no count")
        XCTAssertNotNil(fold["byDay"]?["2026-03-03"], "the calendar still has the paper day")
        let oct = [rec43(2, "\u{5C71}", "judged", "correct", "2026-10-02")]
        XCTAssertEqual(WorkMembers.workMemberRecords(oct, hasInk: { _ in true }).map { $0["char"]!.stringValue! }, ["\u{5C71}"])
    }
}
