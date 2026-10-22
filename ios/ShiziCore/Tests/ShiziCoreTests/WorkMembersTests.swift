import Foundation
import XCTest
@testable import ShiziCore

// test/core/work-members.test.mjs 的转写（5 个用例，用例名保留原名）+ test/core/ink-pick.test.mjs（6）+ test/core/after-seen-works.test.mjs（5）+ test/core/paper-works.test.mjs（9）。
// 成员规则（work-members / records / ink-pick）逐条转写；原用例里经过「图片 / 页面视图」（core/images/pick.js、work.js、session/views/*、store/budget.js recover）的断言，
// 在这里用同一条成员规则在测试里直接装配（dayMembers / monthMembers 的取法照 pick.js：workMembers(段内记录, prefer, order, hasInk, pickInk, added)），
// 视图模型本身（格子 / 版式 / 年报与「我的」模型 / 折叠）留给 B4.4（折叠）、B4.5（视图）、B4.6（图片）按各自的转写清单接。

let storedInk43 = obj43([("v", n43(3)), ("c", n43(345)), ("s", arrayOf43(["AAAAAAAA"]))])

/// 记录按月放好；inked = 留有墨迹的记录 id（state.ink 按记录月份分键）。
func stateOf43(_ records: [JSValue], inked: [String] = [], sessions: JSValue? = nil) -> JSValue {
    var months = JSObject()
    var ink = JSObject()
    for r in records {
        let m = String(r["localDay"]!.stringValue!.prefix(7))
        var list = months[m]?.arrayValue ?? []
        list.append(r)
        months[m] = .array(list)
        if inked.contains(r["id"]!.stringValue!) {
            var month = ink[m]?.objectValue ?? JSObject()
            month[r["id"]!.stringValue!] = storedInk43
            ink[m] = .object(month)
        }
    }
    return obj43([("records", .object(months)), ("sessions", sessions ?? J("{\"A\":null,\"B\":null,\"lastEnded\":{}}")), ("ink", .object(ink))])
}

func hasInkOfState43(_ state: JSValue) -> InkPick.HasInk { { r in InkPick.storedInkPresent(state, r, timeZone: sixTimeZone) } }

func allRecords43(_ state: JSValue) -> [JSValue] { Query.flattenRecords(state["records"]) }

func paper43(_ r: JSValue) -> JSValue { setting(r, "source", s43("paper")) }

/// core/images/pick.js dayMembers 的取法：这天的记录 -> workMembers(prefer last, order first)；没注入 hasInk 时不做 D42。
func dayMembers43(_ state: JSValue, _ day: String, hasInk: InkPick.HasInk? = nil, added: [String]? = nil) -> [WorkMembers.Member] {
    let has = hasInk ?? hasInkOfState43(state)
    let inDay = allRecords43(state).filter { JSX.eq($0["localDay"], day) }
    return WorkMembers.workMembers(inDay, prefer: s43("last"), order: s43("first"), hasInk: has, pickInk: hasInk != nil ? .test(hasInk!) : .none, added: WorkMembers.Added(added))
}

/// 同上，月字帖（非折叠月）：prefer 取 policy.monthSheetPick。
func monthMembers43(_ state: JSValue, _ month: String, hasInk: InkPick.HasInk? = nil, added: [String]? = nil) -> [WorkMembers.Member] {
    let has = hasInk ?? hasInkOfState43(state)
    let prefix = month + "-"
    let inMonth = allRecords43(state).filter { ($0["localDay"]?.stringValue ?? "").hasPrefix(prefix) }
    let prefer = Config.policyString("monthSheetPick") == "first" ? "first" : "last"
    return WorkMembers.workMembers(inMonth, prefer: s43(prefer), order: s43("first"), hasInk: has, pickInk: hasInk != nil ? .test(hasInk!) : .none, added: WorkMembers.Added(added))
}

func pairs43(_ m: [WorkMembers.Member]) -> [String] { m.flatMap { [$0.char, $0.record["id"]?.stringValue ?? ""] } }

final class WorkMembersTests: XCTestCase {
    let TODAY = "2026-10-05"

    // 10-05（今天）：永 写对（有墨）、赢 写错（有墨）、和 看后自写（有墨）、春 看过答案没写、大 跳过、纸 写对在纸上
    func fixture() -> JSValue {
        let records = [
            rec43(1, yong43, "judged", "correct", TODAY), rec43(2, ying43, "judged", "wrong", TODAY), rec43(3, he43, "answer-seen", nil, TODAY),
            rec43(4, chun43, "answer-seen", nil, TODAY), rec43(5, da43, "skipped", nil, TODAY), paper43(rec43(6, zhi43, "judged", "correct", TODAY)),
        ]
        return stateOf43(records, inked: ["r1", "r2", "r3"])
    }

    // test/core/work-members.test.mjs: isWorkMember: correct and after-seen-with-ink are in; wrong only when added (dot); paper / skipped / seen-without-ink are out
    func testIsWorkMemberCorrectAndAfterSeenWithInkAreInWrongOnlyWhenAddedDotPaperSkippedSeenWithoutInkAreOut() {
        let has = inkIn43(["r3"])
        let all = allRecords43(fixture())
        func R(_ id: String) -> JSValue { all.first { $0["id"] == s43(id) }! }
        XCTAssertTrue(WorkMembers.isWorkMember(R("r1")), "correct")
        XCTAssertFalse(WorkMembers.isWorkMember(R("r2")), "wrong is out by default")
        XCTAssertTrue(WorkMembers.isWorkMember(R("r2"), added: WorkMembers.Added(["r2"])), "wrong in when added")
        XCTAssertFalse(WorkMembers.isWorkMember(R("r2"), added: WorkMembers.Added(["rX"])))
        XCTAssertTrue(WorkMembers.isWorkMember(R("r3"), hasInk: has), "after-seen with ink")
        XCTAssertFalse(WorkMembers.isWorkMember(R("r3")), "after-seen needs an injected hasInk")
        XCTAssertFalse(WorkMembers.isWorkMember(R("r4"), hasInk: has), "seen without writing")
        XCTAssertFalse(WorkMembers.isWorkMember(R("r5"), hasInk: { _ in true }), "skipped")
        XCTAssertFalse(WorkMembers.isWorkMember(R("r6"), added: WorkMembers.Added(["r6"])), "paper never")
        XCTAssertFalse(WorkMembers.isWorkMember(nil))
        XCTAssertFalse(WorkMembers.isWorkMember(.null))
    }

    // test/core/work-members.test.mjs: workMembers: wrong in / out, after-seen, D42 across days (record with ink, tag day = firstDay), first / last order
    func testWorkMembersWrongInOutAfterSeenD42AcrossDaysRecordWithInkTagDayFirstDayFirstLastOrder() {
        let records = [
            rec43(1, yong43, "judged", "correct", "2026-10-01"), rec43(2, ying43, "judged", "wrong", "2026-10-01"), rec43(3, he43, "answer-seen", nil, "2026-10-02"),
            rec43(4, yong43, "judged", "correct", "2026-10-04"), rec43(5, ying43, "judged", "correct", "2026-10-06"),
        ]
        let has = inkIn43(["r3", "r4", "r2"])
        func summary(_ m: [WorkMembers.Member]) -> [[String]] { m.map { [$0.char, $0.record["id"]!.stringValue!, $0.firstDay.stringValue!, "\($0.dot)"] } }
        let out = WorkMembers.workMembers(records, prefer: s43("first"), hasInk: has)
        XCTAssertEqual(summary(out), [[yong43, "r4", "2026-10-01", "false"], [he43, "r3", "2026-10-02", "false"], [ying43, "r5", "2026-10-06", "false"]],
                       "the first record has no ink -> D42 takes the 10-04 one but the sheet position / tag stay on 10-01; the wrong r2 never counts, only the correct r5")
        let withAdded = WorkMembers.workMembers(records, prefer: s43("first"), hasInk: has, added: WorkMembers.Added(["r2"]))
        XCTAssertEqual(withAdded.map { [$0.char, $0.record["id"]!.stringValue!, "\($0.dot)"] }, [[yong43, "r4", "false"], [ying43, "r2", "true"], [he43, "r3", "false"]],
                       "added wrong r2 is a member (ink, first from the earliest) and carries the dot; order by first appearance")
        XCTAssertEqual(WorkMembers.workMembers(records, prefer: s43("last"), order: s43("last"), hasInk: has).map { $0.char }, [he43, yong43, ying43], "order last = by latest appearance")
        XCTAssertEqual(ids43(WorkMembers.workMemberRecords(records, hasInk: has)), ["r1", "r3", "r4", "r5"])
    }

    // test/core/work-members.test.mjs: exits agree: session work, month sheet, annual all drop the wrong char and keep correct ∪ after-seen (the home row is gone, D55)
    func testExitsAgreeSessionWorkMonthSheetAnnualAllDropTheWrongCharAndKeepCorrectUnionAfterSeen() {
        let st = fixture()
        let has = hasInkOfState43(st)
        // 这次的图片（session）作品格 / 这天的图片 / 月字帖 / 「我的」月字帖预览 / 年报：同一条成员规则
        let day = dayMembers43(st, TODAY, hasInk: has)
        XCTAssertEqual(day.map { $0.char }, [yong43, he43])
        XCTAssertEqual(monthMembers43(st, "2026-10", hasInk: has).map { $0.char }, [yong43, he43])
        // 写错的赢在「手动放进来」时才进（可放进去的就是它）
        let added = dayMembers43(st, TODAY, hasInk: has, added: ["r2"])
        XCTAssertEqual(added.map { [$0.char, "\($0.dot)"] }, [[yong43, "false"], [ying43, "true"], [he43, "false"]])
        let members = WorkMembers.workMemberRecords(allRecords43(st), hasInk: has)
        XCTAssertEqual(ids43(members), ["r1", "r3"])
        // 年字数：成员记录按字去重
        var seen = OSet()
        for r in members { seen.insert(r["char"]!.stringValue!) }
        XCTAssertEqual(seen.items, [yong43, he43])
        XCTAssertEqual(seen.count, 2)
    }

    // test/core/work-members.test.mjs: buildWork stays in step with isWorkMember: a cell iff (has ink ∧ member); the dot iff a wrong member
    func testBuildWorkStaysInStepWithIsWorkMemberACellIffHasInkAndMemberTheDotIffAWrongMember() {
        let kinds: [(String, String?)] = [("judged", "correct"), ("judged", "wrong"), ("answer-seen", nil), ("skipped", nil)]
        for (kind, judgment) in kinds {
            for isPaper in [false, true] {
                for inked in [false, true] {
                    for added in [false, true] {
                        if isPaper && kind != "judged" { continue } // 只有 judged 记录能在纸上
                        var record = rec43(1, "\u{5B57}", kind, judgment, TODAY)
                        if isPaper { record = paper43(record) }
                        let member = WorkMembers.isWorkMember(record, hasInk: { _ in inked }, added: WorkMembers.Added(added ? ["r1"] : nil))
                        let label = "\(kind) \(judgment ?? "-") paper=\(isPaper) ink=\(inked) added=\(added)"
                        // 规则（D27 Q1 / D31 / D46 ⑬ / D51 ⑤）：写对（非纸上）、看后自写（有墨）、写错且被放进来（非纸上）才是成员
                        let expectMember = !isPaper && ((kind == "judged" && (judgment == "correct" || added)) || (kind == "answer-seen" && inked))
                        XCTAssertEqual(member, expectMember, "member " + label)
                        // 结果页作品格 = 有墨 ∧ 成员；朱点 = 写错的成员
                        XCTAssertEqual(inked && member && WorkMembers.isWrongMember(record) && member, inked && member && judgment == "wrong", "dot " + label)
                    }
                }
            }
        }
    }

    // test/core/work-members.test.mjs: folded month: wrong chars never draw wrong ink — the member rule applies to what is still kept
    func testFoldedMonthWrongCharsNeverDrawWrongInkTheMemberRuleAppliesToWhatIsStillKept() throws {
        let kept = [rec43(1, yong43, "judged", "correct", "2026-09-03"), rec43(2, ying43, "judged", "wrong", "2026-09-04")]
        let fold = obj43([("folded", .bool(true)), ("byDay", obj43([("2026-09-03", arrayOf43([yong43])), ("2026-09-04", arrayOf43([ying43]))])), ("chars", arrayOf43([yong43, ying43])), ("kept", jsArray43(kept))])
        let st = obj43([("records", obj43([("2026-09", fold)])), ("sessions", J("{\"A\":null,\"B\":null,\"lastEnded\":{}}")), ("ink", obj43([("2026-09", obj43([("r1", storedInk43), ("r2", storedInk43)]))]))])
        let has = hasInkOfState43(st)
        // 折叠月：byDay 记下全部字；留下来的 kept 里按成员规则取——写错没放进来的记录取不到
        let keptRecords = Query.flattenRecords(st["records"])
        XCTAssertEqual(ids43(keptRecords), ["r1", "r2"])
        XCTAssertEqual(Records.foldWorkByDay(fold).keys, ["2026-09-03", "2026-09-04"])
        for (char, want) in [(yong43, "r1"), (ying43, "")] {
            let m = WorkMembers.workMembers(keptRecords.filter { $0["char"] == s43(char) }, prefer: s43("last"), hasInk: has)
            XCTAssertEqual(m.first?.record["id"]?.stringValue ?? "", want, "the kept wrong record is never picked; \(char) falls back to the under placeholder")
        }
    }
}
