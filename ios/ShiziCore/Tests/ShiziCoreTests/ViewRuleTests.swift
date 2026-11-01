import Foundation
import XCTest
@testable import ShiziCore

// Rule-only transcriptions from the JS view suites. UI / DOM / bridge assertions
// remain in node; each original rule name and path is retained beside its test.
final class ViewRuleTests: XCTestCase {
    typealias V = ViewSupport
    let dates = Dates(timeZone: TimeZone(identifier: "Asia/Shanghai")!)
    let today = "2026-09-24"
    func json(_ s: String) throws -> JSValue { try JSONParser.parse(s) }
    func state(_ records: [JSValue], extra: [(String, JSValue)] = []) -> JSValue {
        var months = JSObject()
        for r in records { let m = String(JS.string(r["localDay"]).prefix(7)); months[m] = .array((months[m]?.arrayValue ?? []) + [r]) }
        var out = JSObject([("records", .object(months))]); for (k,v) in extra { out[k] = v }; return .object(out)
    }
    func model(_ s: JSValue) throws -> JSValue { try V.mineModel(s, today: today, policy: Config.policy, storagePressure: nil, dates: dates) }
    func home(_ s: JSValue, deck: ScheduleDeck? = nil) throws -> JSValue { try HomeView.homeModel(s, now: dates.dayStartMs(.string(today))+12*3600000, policy: Config.policy, deck: deck, dates: dates) }
    func detail(_ s: JSValue, char: String = cYong) throws -> JSValue { try DetailView.detailModel(s, char: char, today: today, policy: Config.policy, dates: dates) }

    // test/ui/query.test.mjs — sheetModel pick: typing selects nothing; selection filtered by input and practicability; bar label by count
    func testSheetModelPickSelection() throws {
        var a = JSObject([("mode", .string("pick")), ("text", .string(cYong+cRen)), ("selected", .array([]))])
        XCTAssertEqual(QueryView.sheetModel(a)["chosen"], .array([])); XCTAssertEqual(QueryView.sheetModel(a)["bar"]?["disabled"], .bool(true))
        a["selected"] = .array([.string(cYong),.string(cRen),.string("x")])
        XCTAssertEqual(QueryView.sheetModel(a)["chosen"], .array([.string(cYong),.string(cRen)]))
        XCTAssertEqual(QueryView.sheetModel(a)["bar"]?["vars"]?["n"], .number(2))
    }
    // test/ui/query.test.mjs — sheetModel lookup: no selection, no bar; rows carry summaries from records / custom
    func testSheetModelLookupSummaries() throws {
        let s = state([srec(1,cYong),srec(2,cYong,judgment:"wrong")], extra:[("custom",try json(#"{"added":[{"char":"永","at":1}]}"#))])
        let m = QueryView.sheetModel(JSObject([("mode",.string("lookup")),("text",.string(cYong+cRen)),("state",s)]))
        XCTAssertEqual(m["bar"],.null); XCTAssertEqual(m["chosen"],.array([])); XCTAssertEqual(m["summaries"]?.arrayValue?[0]["count"],.number(2)); XCTAssertEqual(m["summaries"]?.arrayValue?[0]["custom"],.bool(true))
    }
    // test/ui/query.test.mjs — sheetModel: pinyin with no match → one note; digits / symbols stay「只能输入汉字」; Han input unaffected
    func testPinyinMissAndSymbols() {
        for (text,key) in [("zzzzzz","X-QUERY.pinyinNone"),("123","R-Q03.onlyHanzi")] {
            let m = QueryView.sheetModel(JSObject([("mode",.string("lookup")),("text",.string(text))]))
            XCTAssertEqual(m["notes"]?.arrayValue?.first?["key"],.string(key))
        }
    }
    // test/ui/annual.test.mjs — empty: no records / only answer-seen or skipped / only last year / only paper → empty; null state safe
    func testAnnualEmptyCases() throws {
        for s in [JSValue.null,state([srec(1,cYong,kind:"skipped")]),state([srec(1,cYong,day:"2025-09-01")]),state([srec(1,cYong,extra:[("source",.string("paper"))])])] {
            XCTAssertEqual(try AnnualView.annualModel(s,today:today,dates:dates)["empty"],.bool(true))
        }
    }
    // test/ui/annual.test.mjs — the year count: distinct work chars this year (right ones; a wrong-only char does not count, D51 ⑤); answer-seen / skipped / last year / 纸上 do not (D46-13)
    func testAnnualDistinctWorkCount() throws {
        let shi = "\u{8C55}", shui = "\u{8C01}", ti = "\u{9898}", hu = "\u{6237}", sui = "\u{867D}" // 豕 谁 题 户 虽
        let s = state([
            srec(1, shi, day: "2025-12-30"), // last year
            srec(2, jing43, day: "2026-01-03"), srec(3, jing43, judgment: "wrong", day: "2026-02-10"),
            srec(4, shui, judgment: "wrong", day: "2026-02-10"),
            srec(5, ti, day: "2026-09-01"), srec(6, hu, kind: "answer-seen", day: "2026-09-02"), srec(7, sui, kind: "skipped", day: "2026-09-03"),
            srec(8, zhi43, day: "2026-09-04", extra: [("source", .string("paper"))]),
        ])
        let m = try AnnualView.annualModel(s, today: today, dates: dates)
        XCTAssertEqual(m["empty"], .bool(false))
        XCTAssertEqual(m["count"], .number(2))
        XCTAssertEqual(m["chars"], .array([.string(jing43), .string(ti)]), "谁 was only ever written wrong this year")
        XCTAssertEqual(m["days"], .number(2), "days with a work record this year: the wrong-only day and the paper day are not counted")
    }
    // test/ui/annual.test.mjs — months: one section per month that has chars, ascending; the count is the month sheet size (chars with no ink included)
    func testAnnualMonthsAndNoInkPlan() throws {
        let s=state([srec(1,cYong,day:"2026-08-01"),srec(2,cRen,day:"2026-09-01")])
        let m=try AnnualView.annualModel(s,today:today,dates:dates)
        XCTAssertEqual(m["months"]?.arrayValue?.map{$0["month"]!},["2026-08","2026-09"].map(JSValue.string))
        let p=try AnnualView.annualPlan(s,today:today,year:nil,policy:Config.policy,dates:dates)
        XCTAssertEqual(p["status"],.string("ready")); XCTAssertEqual(p["first"]?["mode"],.string("under")); XCTAssertEqual(p["pages"]?.arrayValue?.count,3); XCTAssertEqual(p["tail"],.null); XCTAssertNil(p["cover"])
    }
    // test/ui/annual.test.mjs — D66 ⑪ a single year of records has no previous / next year (nothing to switch)
    func testAnnualSingleYearNavigation() throws {
        let m=try AnnualView.annualModel(state([srec(1,cYong)]),today:today,dates:dates)
        XCTAssertEqual(m["prevYear"],.null); XCTAssertEqual(m["nextYear"],.null)
        XCTAssertEqual(AnnualView.annualDefaultYear(state([srec(1,cYong,day:"2027-01-01")]),today:today,dates:dates),.number(2027))
    }
    // test/ui/library-list.test.mjs — R-E01 / D23: only the latest judged record decides; answer-seen / skipped after a wrong keep it in 写错过
    func testLatestJudgmentDecidesWrongList() throws {
        let s=state([srec(1,cYong,judgment:"wrong"),srec(2,cYong,kind:"answer-seen"),srec(3,cYong,kind:"skipped")])
        XCTAssertEqual(try LibraryListView.listEntries(s,kind:.string("wrong"),today:today,policy:Config.policy,dates:dates).count,1)
        let corrected=state([srec(1,cYong,judgment:"wrong"),srec(2,cYong)])
        XCTAssertTrue(try LibraryListView.listEntries(corrected,kind:.string("wrong"),today:today,policy:Config.policy,dates:dates).isEmpty)
    }
    // test/ui/library-list.test.mjs — B4 (G38, D36): 写错过 with 8 rows → default selects only the 5 most recently wrong; head 先练这 5 个; the rest fold under 其余 N 个字
    func testWrongListDefaultTopAndRestFold() throws {
        let many = ["\u{4E00}", "\u{4E8C}", "\u{4E09}", "\u{56DB}", "\u{4E94}", "\u{516D}", "\u{4E03}", "\u{516B}"] // 一二三四五六七八
        let records = many.enumerated().map { i, c in srec(i + 1, c, judgment: "wrong", day: String(format: "2026-09-%02d", 10 + i)) }
        // JS 测试夹具 stateOf 的默认 settings = { groupSize: 5 }
        let st = state(records, extra: [("settings", V.obj([("groupSize", .number(5))]))])
        func model(_ sel: JSValue? = nil, _ policy: JSValue? = nil) throws -> JSValue {
            var a = JSObject([("kind", .string("wrong")), ("today", .string(today))])
            if let sel { a["sel"] = sel }; if let policy { a["policy"] = policy }
            return try LibraryListView.listModel(st, a, dates: dates)
        }
        let m = try model()
        XCTAssertEqual(m["rows"]!.arrayValue!.map { $0["char"]! }, many.reversed().map(JSValue.string), "most recently wrong first")
        XCTAssertEqual(m["rows"]!.arrayValue!.filter { $0["selected"] == .bool(true) }.map { $0["char"]! }, many.suffix(5).reversed().map(JSValue.string), "default = the 5 most recent")
        XCTAssertEqual(m["rows"]!.arrayValue!.map { $0["group"]! }, (Array(repeating: "top", count: 5) + Array(repeating: "rest", count: 3)).map(JSValue.string))
        XCTAssertEqual(m["selectedCount"], .number(5))
        XCTAssertEqual(m["head"], V.ref("X-LIST.firstHead", V.obj([("n", .number(5))])))
        XCTAssertEqual(m["topCount"], .number(5)); XCTAssertEqual(m["restCount"], .number(3))
        XCTAssertEqual(m["restLabel"], V.ref("X-LIST.restShow", V.obj([("n", .number(3))])))
        XCTAssertEqual(m["restHideLabel"], V.ref("X-LIST.restHide", V.obj([("n", .number(3))])))
        XCTAssertEqual(m["allSelected"], .bool(false)); XCTAssertEqual(m["toggleAllLabel"], V.ref("X-LIST.selectAll"))
        XCTAssertEqual(m["hint"], V.ref("R-E02.selected", V.obj([("n", .number(5))])))
        XCTAssertEqual(m["customSel"], .bool(false))
        XCTAssertEqual(Config.policy["listDefaultSelect"], .number(5))
        // 从默认展开成数组再点：取消最该练的一个、选上其余的一个；head 标的是组（仍是 5 个），不是当前选择
        let defaults = m["rows"]!.arrayValue!.filter { $0["selected"] == .bool(true) }.map { $0["char"]! }
        let sel = LibraryListView.toggleSel(LibraryListView.toggleSel(.array(defaults), .string(many[7])), .string(many[1]))
        let m2 = try model(sel)
        XCTAssertEqual(m2["rows"]!.arrayValue!.filter { $0["selected"] == .bool(true) }.map { $0["char"]! }, [many[6], many[5], many[4], many[3], many[1]].map(JSValue.string))
        XCTAssertEqual(m2["head"], V.ref("X-LIST.firstHead", V.obj([("n", .number(5))])), "the head labels the group, not the current selection")
        // 全选 → 8 个
        let all = try model(.array(many.reversed().map(JSValue.string)))
        XCTAssertEqual(all["selectedCount"], .number(8)); XCTAssertEqual(all["allSelected"], .bool(true))
        // 自定义 limit
        let three = try model(nil, V.obj([("listDefaultSelect", .number(3))]))
        XCTAssertEqual(three["selectedCount"], .number(3))
        XCTAssertEqual(three["head"], V.ref("X-LIST.firstHead", V.obj([("n", .number(3))])))
    }
    // test/ui/library-list.test.mjs — D66 ⑬: the default selection follows 每组字数 (policy.listDefaultSelect 5 per 5-char group → = group size)
    func testDefaultSelectionFollowsGroupSize() throws {
        let chars = (0..<34).map { String(Unicode.Scalar(0x4e00 + 0x100 + $0)!) }
        let records = chars.enumerated().map { i, c in srec(i + 1, c, judgment: "wrong", day: String(format: "2026-09-%02d", 1 + i % 28)) }
        func pick(_ settings: JSValue?) throws -> JSValue {
            let s = settings == nil ? state(records) : state(records, extra: [("settings", settings!)])
            return try LibraryListView.listModel(s, JSObject([("kind", .string("wrong")), ("today", .string(today))]), dates: dates)
        }
        XCTAssertEqual(try pick(nil)["selectedCount"], .number(20), "never chosen → group size 20 → 20")
        XCTAssertEqual(try pick(.object(JSObject()))["head"], V.ref("X-LIST.firstHead", V.obj([("n", .number(20))])))
        for (size, want) in [(10, 10), (30, 30), (5, 5)] {
            XCTAssertEqual(try pick(V.obj([("groupSize", .number(Double(size)))]))["selectedCount"], .number(Double(want)))
        }
        XCTAssertEqual(GroupSize.listDefaultSelectOf(V.obj([("groupSize", .number(30))])), 30)
        XCTAssertEqual(GroupSize.listDefaultSelectOf(nil), 20)
    }
    // test/ui/library-list.test.mjs — rows that cannot be practised (custom: / not in deck) show but are not selectable and never go into the group
    func testListUnavailableRows() throws {
        let s=state([srec(1,cYong,judgment:"wrong")])
        let m=try LibraryListView.listModel(s,JSObject([("kind",.string("wrong")),("today",.string(today)),("unpracticable",.array([.string("base:"+cYong)]))]),dates:dates)
        XCTAssertEqual(m["selectedCount"],.number(0)); XCTAssertEqual(m["rows"]?.arrayValue?.first?["selectable"],.bool(false)); XCTAssertEqual(m["button"]?["disabled"],.bool(true))
    }
    // test/ui/library-list.test.mjs — groupFromHereActive: an unfinished B whose source is this list
    func testGroupFromHereActive() throws {
        let s=try json(#"{"sessions":{"B":{"queue":["base:永"],"cursor":0,"source":{"view":"againList"}}}}"#)
        XCTAssertTrue(LibraryListView.groupFromHereActive(s,view:.string("wrongList"))); XCTAssertFalse(LibraryListView.groupFromHereActive(s,view:.string("forgetList")))
    }
    // test/ui/home.test.mjs — records dimension: first / empty / record (K06: cleared → empty, not first)
    func testHomeRecordsDimension() throws {
        XCTAssertEqual(HomeView.recordsStateOf(.null,today:today,policy:Config.policy),"first")
        XCTAssertEqual(HomeView.recordsStateOf(state([srec(1,cYong)]),today:today,policy:Config.policy),"empty")
        XCTAssertEqual(HomeView.recordsStateOf(state([srec(1,cYong,day:today)]),today:today,policy:Config.policy),"record")
        let cleared=try json(#"{"backupMeta":{"lastConclusion":{"kind":"clear","date":"2026-09-23","count":3}}}"#)
        XCTAssertEqual(try home(cleared)["view"],.string("fresh"))
    }
    // test/ui/home.test.mjs — homeViewOf: first / fresh / today / progress / special / back, with this priority (03 P155)
    func testHomeSixStatesPriority() throws {
        for (r,res,c,g,want) in [("first","none",false,0,"first"),("empty","none",false,0,"fresh"),("record","none",false,0,"today"),("first","B",true,10,"progress"),("record","none",true,0,"special"),("empty","none",false,7,"back")] {
            let m=V.obj([("records",.string(r)),("resume",.string(res)),("capital",c ? .string("capital1") : .null),("gapDays",.number(Double(g)))])
            XCTAssertEqual(HomeView.homeViewOf(m),want)
        }
    }
    // test/ui/home.test.mjs — D40 (P129): the home model says which special group is next — only with a deck, no unfinished group, and the conditions met
    func testHomeSpecialGroup() throws {
        let recs=(1...10).map{srec($0,String(Unicode.Scalar(0x6100+$0)!),day:"2026-09-"+String(format:"%02d",24-$0),session:$0)}
        let deck=ScheduleDeck(newCandidates:{_ in []},practicable:{$0.hasPrefix("base:")})
        XCTAssertEqual(try home(state(recs),deck:deck)["capital"],.string("capital1")); XCTAssertEqual(try home(state(recs))["capital"],.null)
        XCTAssertEqual(try home(state(Array(recs.prefix(9))),deck:deck)["capital"],.null)
    }
    // test/ui/h2-home-e.test.mjs — the two extra lines: back = 「你写过的 N 个字都还在。」 with the real N, special = the special-group sentence; nothing else has one
    func testHomeNotesAndRemovedFields() throws {
        let back=try home(state([srec(1,cYong,day:"2026-09-10")]))
        XCTAssertEqual(HomeView.homeNoteOf(back)["vars"]?["n"],.number(1)); XCTAssertEqual(HomeView.homeNoteOf(try home(.null)),.null)
        for k in ["copybook","recent","progressCells","handoff","todayRow"]{XCTAssertNil(back[k])}
    }
    // test/ui/library-all.test.mjs — counts match the library home (recorded, custom unwritten); D66 ⑤: answer-seen chars count, skipped-only do not
    func testAllCountsAndFind() throws {
        let s=state([srec(1,cYong,kind:"answer-seen"),srec(2,cRen,kind:"skipped")],extra:[("custom",try json(#"{"added":[{"char":"甲","at":1}]}"#))])
        let m=try LibraryAllView.allModel(s,JSObject([("today",.string(today)),("find",.string(cYong))]),dates:dates)
        XCTAssertEqual(m["recorded"],.number(1)); XCTAssertEqual(m["members"],.number(2)); XCTAssertEqual(m["find"]?["found"],.bool(true)); XCTAssertEqual(m["showChips"],.bool(false))
    }
    // test/ui/library-all.test.mjs — recent (default): hollow first, months new → old, two open by default, rest closed; fold overrides; cross-year label
    func testAllRecentFoldAndYear() throws {
        let s=state([srec(1,cYong,day:"2025-01-01"),srec(2,cRen,day:"2026-08-01"),srec(3,cKou,day:"2026-09-01")])
        let m=try LibraryAllView.allModel(s,JSObject([("today",.string(today))]),dates:dates)
        XCTAssertEqual(m["closed"]?.arrayValue?.first?["month"],.string("2025-01")); XCTAssertEqual(m["groups"]?.arrayValue?.count,2)
        XCTAssertEqual(LibraryAllView.monthRef("2025-01",today:today,found:false,dates:dates)["copy"],.string("X-ALL.groupMonthYear"))
    }
    // test/ui/library-all.test.mjs — filters: due / shaky / known / unw / custom; sort collapses; 0-count chips disabled unless active; practice go
    func testAllEmptyFilterChipAndUnwrittenGo() throws {
        let s=state([],extra:[("custom",try json(#"{"added":[{"char":"永","at":1}]}"#))])
        let m=try LibraryAllView.allModel(s,JSObject([("today",.string(today)),("filter",.string("unw"))]),dates:dates)
        XCTAssertEqual(m["go"]?["kind"],.string("start")); XCTAssertEqual(m["showSort"],.bool(false)); XCTAssertEqual(m["empty"],.bool(true))
        let empty=try LibraryAllView.allModel(.null,JSObject([("today",.string(today)),("filter",.string("due"))]),dates:dates)
        XCTAssertEqual(empty["chips"]?.arrayValue?.first?["disabled"],.bool(false)); XCTAssertEqual(empty["chips"]?.arrayValue?[1]["disabled"],.bool(true))
    }
    // test/ui/detail.test.mjs — detailModel: judged records only (answer-seen / skipped excluded), oldest first; first / latest; due only with judged (P12)
    func testDetailJudgedAndImage() throws {
        let first=srec(1,cYong),last=srec(4,cYong,judgment:"wrong"),s=state([last,srec(2,cYong,kind:"answer-seen"),first,srec(3,cYong,kind:"skipped")])
        let m=try detail(s)
        XCTAssertEqual(m["count"],.number(2)); XCTAssertEqual(m["first"],first); XCTAssertEqual(m["latest"],last); XCTAssertEqual(m["image"],.string("noInk")); XCTAssertEqual(m["list"],.string("wrong"))
        XCTAssertEqual(try detail(.null)["image"],.string("noRecord"))
    }
    // test/ui/paper-detail.test.mjs — P169: detailModel——纸上记录计入次数与写错过，但不进笔迹格；留墨的第一次 / 最近一次与做图片取屏幕上写的
    func testDetailPaperCountsButNoInkCell() throws {
        let a = srec(1, cYong, day: "2026-09-21"), b = srec(2, cYong, judgment: "wrong", day: "2026-09-28")
        let p = srec(3, cYong, judgment: "wrong", day: today, extra: [("source", .string("paper"))])
        let seen = srec(4, cYong, kind: "answer-seen", day: "2026-09-29")
        let hasInk: InkPick.HasInk = { $0["id"] == .string("r1") || $0["id"] == .string("r2") }
        let m = try DetailView.detailModel(state([a, b, seen, p]), char: cYong, today: today, policy: Config.policy, hasInk: hasInk, dates: dates)
        XCTAssertEqual(m["count"], .number(3), "paper counts as a record")
        XCTAssertEqual(m["cells"]!.arrayValue!.map { $0["id"]! }, [.string("r1"), .string("r2")], "paper record takes no ink cell")
        XCTAssertEqual(m["paperRows"]!.arrayValue!.map { $0["id"]! }, [.string("r3")])
        XCTAssertEqual(m["first"], a)
        XCTAssertEqual(m["latest"], p, "latest judgment is the paper one")
        XCTAssertEqual(m["inkFirst"], a)
        XCTAssertEqual(m["inkLatest"], b, "latest ink record skips the paper one (D27 / D42)")
        XCTAssertEqual(m["list"], .string("wrong"), "paper wrong → 写错过 as usual")
        XCTAssertEqual(m["image"], .string("ok"), "image from the latest screen record")
        XCTAssertEqual(m["imageRecord"], b)
        let only = try DetailView.detailModel(state([srec(1, cYong, day: today, extra: [("source", .string("paper"))])]), char: cYong, today: today, policy: Config.policy, hasInk: { _ in true }, dates: dates)
        XCTAssertEqual(only["count"], .number(1))
        XCTAssertEqual(only["cells"], .array([]))
        XCTAssertEqual(only["image"], .string("noInk"), "only paper → nothing to draw")
    }
    // test/ui/detail.test.mjs — detailModel: custom (index / entry), wordOff (label 释义 + prompt hint, no swap), photo not counted as a record (P10b)
    func testDetailCustomWordOffAndPhoto() throws {
        let s=state([],extra:[("custom",try json(#"{"added":[{"char":"永","at":1}]}"#)),("wordOff",V.obj([("base:"+cYong,.bool(true))])),("photos",V.obj([(cYong,V.obj([("dataURL",.string("data:image/png;base64,AA"))]))]))])
        let m=try detail(s)
        XCTAssertEqual(m["customIndex"],.number(0)); XCTAssertEqual(m["canSwapWord"],.bool(false)); XCTAssertEqual(m["count"],.number(0)); XCTAssertEqual(m["photoCountsAsRecord"],.bool(false)); XCTAssertNotEqual(m["photo"],.null)
    }
    // test/ui/mine.test.mjs — empty: no judged record (answer-seen / skipped only) → empty; overview all 0; no sheet
    func testMineAnswerSeenEmptyDays() throws {
        let m=try model(state([srec(1,cYong,kind:"answer-seen"),srec(2,cRen,kind:"skipped")]))
        XCTAssertEqual(m["empty"],.bool(true)); XCTAssertEqual(m["sheetOn"],.bool(false)); XCTAssertEqual(m["overview"],try json(#"{"streak":0,"total":0,"chars":1}"#))
    }
    // test/ui/mine.test.mjs — weekdayIndex: Monday first; week wraps across months
    func testWeekdayIndex() throws {
        for (d,n) in [("2026-09-21",0),("2026-09-27",6),("2026-09-01",1)]{XCTAssertEqual(try V.weekdayIndex(d,dates:dates),n)}
    }
    // test/ui/mine.test.mjs — overview (D63): streak counts back from today, or from yesterday when today is not written yet; legacy.days counted
    func testStreakAndLegacyDays() throws {
        XCTAssertEqual(try V.streakDays(KeySet([today,"2026-09-23","2026-09-22","2026-09-20"]),today:today,dates:dates),3)
        XCTAssertEqual(try V.streakDays(KeySet(["2026-09-23","2026-09-22"]),today:today,dates:dates),2)
        let s=state([],extra:[("legacy",try json(#"{"days":["2026-09-23","2099-01-01"]}"#))]),m=try model(s)
        XCTAssertEqual(m["overview"]?["total"],.number(1)); XCTAssertEqual(m["overview"]?["streak"],.number(1)); XCTAssertEqual(m["empty"],.bool(true))
    }
    // test/ui/mine.test.mjs — month sheet: first-appearance order, date tags on day change, P02 pick first vs last
    func testMonthSheetFirstAndLast() throws {
        let a=srec(1,cYong,day:"2026-09-01"),b=srec(2,cRen,day:"2026-09-02"),c=srec(3,cYong,day:"2026-09-03"),i=V.recordIndex(state([a,b,c]),dates:dates)
        let first=V.monthSheet(i,month:"2026-09",policy:V.policy(.object(JSObject([("monthSheetPick",.string("first"))])))),last=V.monthSheet(i,month:"2026-09",policy:V.policy(.object(JSObject([("monthSheetPick",.string("last"))]))))
        XCTAssertEqual(first["cells"]?.arrayValue?[0]["record"],a); XCTAssertEqual(last["cells"]?.arrayValue?[0]["record"],c); XCTAssertEqual(last["cells"]?.arrayValue?[0]["day"],a["localDay"])
    }
    // test/ui/mine.test.mjs — record days: judged + folded byDay; answer-seen / skipped / legacy.days excluded
    func testRecordDaysExcludeLegacyAndSeen() throws {
        let s=state([srec(1,cYong,kind:"answer-seen"),srec(2,cRen,kind:"skipped"),srec(3,cKou,day:today)],extra:[("legacy",try json(#"{"days":["2026-09-01"]}"#))])
        XCTAssertEqual(V.recordIndex(s,dates:dates).days.items,[today])
    }
    // test/ui/mine.test.mjs — calendar: Monday-first blanks, 7-multiple, today / future / has flags
    func testCalendarFlags() throws {
        let i=V.recordIndex(state([srec(1,cYong,day:today)]),dates:dates),c=try V.calendarModel(i,month:"2026-09",today:today)
        XCTAssertEqual(c.count%7,0); XCTAssertEqual(c.first?["blank"],.bool(true)); let cell=c.first{$0["day"] == .string(today)}!
        XCTAssertEqual(cell["has"],.bool(true)); XCTAssertEqual(cell["today"],.bool(true)); XCTAssertEqual(c.first{$0["day"] == .string("2026-09-25")}?["future"],.bool(true))
    }
    // test/ui/mine.test.mjs — sheet preview: ≤ 3 rows untouched; more → last 3 rows of the 7-column layout, first cell re-tagged
    func testSheetPreviewWholeRows() {
        let cells=(0..<30).map{V.obj([("char",.string(String($0))),("day",.string(today)),("tag",.null)])},p=V.sheetPreview(V.obj([("cells",.array(cells))]))
        XCTAssertEqual(p["hidden"],.number(14)); XCTAssertEqual(p["cells"]?.arrayValue?.count,16); XCTAssertEqual(p["cells"]?.arrayValue?.first?["tag"],.string(today))
    }
    // test/ui/mine.test.mjs — day items: same char keeps its latest record, ordered by latest (home ink row rule)
    func testDayItemsLatestOrder() {
        let a=srec(1,cYong,day:today),b=srec(2,cRen,day:today),c=srec(3,cYong,day:today),items=V.dayItems(V.recordIndex(state([a,b,c]),dates:dates),day:today)
        XCTAssertEqual(items.map{$0["char"]!},[cRen,cYong].map(JSValue.string)); XCTAssertEqual(items.last?["record"],c)
    }
    // test/ui/mine.test.mjs — records model: clamp month, prev / next ends, selection only on record days of that month, today row only this month
    func testRecordsClampAndSelection() throws {
        let s=state([srec(1,cYong,day:"2026-08-01"),srec(2,cRen,day:today)]),i=V.recordIndex(s,dates:dates)
        XCTAssertEqual(V.clampMonth(.string("1900-01"),index:i,today:today),"2026-08"); XCTAssertEqual(V.clampMonth(.string("2099-01"),index:i,today:today),"2026-09")
        let m=try V.recordsModel(s,today:today,month:.string("2026-08"),day:.string(today),policy:Config.policy,dates:dates)
        XCTAssertEqual(m["selected"],.null); XCTAssertEqual(m["todayRow"],.null); XCTAssertEqual(m["prev"],.null); XCTAssertEqual(m["next"],.string("2026-09"))
    }
    // test/ui/mine.test.mjs — D66 ⑱ backup hint: >= 30 days since last backup (or since first record when never backed up), only with records and changes
    func testBackupStaleBoundaryAndSignature() throws {
        let s=state([srec(1,cYong,day:"2026-08-25")]),i=V.recordIndex(s,dates:dates)
        XCTAssertEqual(try V.backupHint(s,today:today,index:i,storagePressure:nil)["days"],.number(30))
        XCTAssertEqual(try V.backupHint(s,today:"2026-09-23",index:i,storagePressure:nil),.null)
        var o=s.objectValue!; o["backupMeta"]=V.obj([("lastExportAt",.number(try dates.dayStartMs(.string("2026-08-01")))),("lastExportSig",.string(Backup.recordsSignature(s["records"])))] )
        XCTAssertEqual(try V.backupHint(.object(o),today:today,index:i,storagePressure:nil),.null)
    }
    // test/ui/mine.test.mjs — D66 ⑱ storage pressure: shown only when readable and near the limit; wins over the 30-day hint
    func testStoragePressureForms() throws {
        for v in [JSValue.bool(true),.number(0.8),.string("warn"),try json(#"{"near":true}"#),try json(#"{"level":"high"}"#),try json(#"{"ratio":0.9}"#)]{XCTAssertTrue(V.storagePressureNear(v))}
        for v in [JSValue.null,.bool(false),.number(0.79),.string("low")]{XCTAssertFalse(V.storagePressureNear(v))}
        let s=state([srec(1,cYong)])
        XCTAssertEqual(try V.backupHint(s,today:today,index:V.recordIndex(s,dates:dates),storagePressure:.bool(true))["kind"],.string("pressure"))
    }
    // test/ui/library.test.mjs — tone buckets follow policy.inkToneDays (P56) — boundaries inclusive
    func testToneInclusiveBoundaries() {
        for (d,t) in [("2026-09-17",0),("2026-09-16",1),("2026-08-25",1),("2026-08-24",2),("bad",3)]{XCTAssertEqual(V.toneOf(.string(d),today:today,days:nil,dates:dates),t)}
    }
    // test/ui/library.test.mjs — columns (8, Pro Max 9, large text ≤ 6, every cell ≥ 44pt; independent of members) and truncation to 8 rows + more (P27 wall members; P1-E1b design system)
    func testWallColumnWidths() throws {
        // （成员数不再影响列数：JS 版前两个参数只有宽度未知 / 已知两种口径，这里按宽度转写）
        XCTAssertEqual(V.wallColumns(large: false, width: nil), 8, "unknown width → the standard 8")
        for (w, n) in [(393.0, 8), (402.0, 8), (440.0, 9), (430.0, 8), (375.0, 7), (360.0, 7), (320.0, 6), (200.0, 4)] {
            XCTAssertEqual(V.wallColumns(large: false, width: .number(w)), n)
        }
        XCTAssertEqual(V.wallColumns(large: true, width: nil), 6, "large text: 6 columns (width unknown)")
        for (w, n) in [(440.0, 6), (320.0, 6), (300.0, 5)] {
            XCTAssertEqual(V.wallColumns(large: true, width: .number(w)), n, "large text caps at 6 even on a wide screen")
        }
        XCTAssertEqual(Config.policy["wallMoreScope"], .string("wall-members"))
        func mk(_ n: Int) -> [JSValue] {
            (0..<n).map { i in srec(i + 1, String(Unicode.Scalar(0x4E00 + i)!), day: try! dates.addDays(.string(today), Double(-(n - i)))) }
        }
        func home(_ records: [JSValue], extra: [(String, JSValue)] = [], policy: JSValue? = nil, compact: Bool = false, width: JSValue? = nil) throws -> JSValue {
            return try LibraryView.libraryHomeModel(state(records, extra: extra), today: today, policy: policy ?? Config.policy, compact: compact, width: width, dates: dates)
        }
        let m5 = try home(mk(5))
        XCTAssertEqual(m5["wall"]?["cols"], .number(8)); XCTAssertEqual(m5["wall"]?["cells"]?.arrayValue?.count, 5); XCTAssertEqual(m5["wall"]?["more"], .number(0))
        let m30 = try home(mk(30))
        XCTAssertEqual(m30["wall"]?["cols"], .number(8)); XCTAssertEqual(m30["wall"]?["cells"]?.arrayValue?.count, 30); XCTAssertEqual(m30["wall"]?["more"], .number(0))
        let m70 = try home(mk(70))
        XCTAssertEqual(m70["wall"]?["cells"]?.arrayValue?.count, 64, "70 members, 8 cols → 64 cells")
        XCTAssertEqual(m70["wall"]?["more"], .number(6)); XCTAssertEqual(m70["wall"]?["rows"], .number(8))
        let proMax = try home(mk(80), width: .number(440))
        XCTAssertEqual(proMax["wall"]?["cols"], .number(9), "Pro Max: 9 columns"); XCTAssertEqual(proMax["wall"]?["cells"]?.arrayValue?.count, 72)
        let custom = J(#"{"added":[{"char":"馨","at":0},{"char":"鼎","at":1},{"char":"瓷","at":2}]}"#)
        let m300 = try home(mk(300), extra: [("custom", custom)])
        XCTAssertEqual(m300["recorded"], .number(300)); XCTAssertEqual(m300["wall"]?["members"], .number(303))
        XCTAssertEqual(m300["wall"]?["cols"], .number(8)); XCTAssertEqual(m300["wall"]?["cells"]?.arrayValue?.count, 64)
        XCTAssertEqual(m300["wall"]?["more"], .number(303 - 64), "denominator includes hollow (P27)")
        XCTAssertEqual(m300["wall"]!["cells"]!.arrayValue!.prefix(3).map { $0["kind"]! }, [.string("hollow"), .string("hollow"), .string("hollow")])
        let recordsScope = try home(mk(300), extra: [("custom", custom)], policy: V.policy(V.obj([("wallMoreScope", .string("records"))])))
        XCTAssertEqual(recordsScope["wall"]?["more"], .number(300 - 61), "'records' scope only counts written chars")
        let compact = try home(mk(300), compact: true)
        XCTAssertEqual(compact["wall"]?["cols"], .number(6)); XCTAssertEqual(compact["wall"]?["cells"]?.arrayValue?.count, 48)
    }
    // test/ui/library.test.mjs — helpers: customCharsOf dedups and drops non-single chars; latestJudgedByChar uses id order
    func testCustomSingleCodepoints() throws {
        XCTAssertEqual(V.customCharsOf(try json(#"{"added":[{"char":"永"},{"char":"永"},{"char":"ab"},{"char":"𠀀"}]}"#)),[cYong,"𠀀"])
    }
    // test/ui/library-zones.test.mjs — memoryZoneOf (D66 ⑰): 已熟悉 also needs ≥ 3 successes (reps − lapses)
    func testKnownZoneThresholds() throws {
        let r=srec(1,cYong),base=try json(#"{"due":"2026-10-01","fsrs":{"stability":21,"reps":4,"lapses":1}}"#)
        XCTAssertEqual(try V.memoryZoneOf(r,base,today:today,knownDays:21,minSuccesses:3,dates:dates),"known")
        XCTAssertEqual(try V.memoryZoneOf(r,base,today:today,knownDays:21,minSuccesses:4,dates:dates),"shaky")
        XCTAssertEqual(try V.memoryZoneOf(srec(2,cYong,judgment:"wrong"),base,today:today,knownDays:21,minSuccesses:3,dates:dates),"due")
    }
    // test/ui/library-zones.test.mjs — skippedZone (D62): skipped and still no judged record; not counted in recorded; newest skip first; written later → leaves; undo (record removed) → leaves
    func testSkippedLeavesAfterPractice() throws {
        let jia = "\u{7532}", yi = "\u{4E59}", bing = "\u{4E19}", ding = "\u{4E01}", wu = "\u{620A}" // 甲乙丙丁戊
        func skip(_ n: Int,_ c: String,_ day: String) -> JSValue { srec(n, c, kind: "skipped", day: day) }
        let rows = [
            skip(1, jia, "2026-09-01"), skip(2, yi, "2026-09-08"), skip(3, jia, "2026-09-09"), // 甲 skipped twice → newest record
            skip(4, bing, "2026-09-10"), srec(5, bing, day: "2026-09-11"), // 丙 written afterwards → not skipped any more
            srec(6, ding, day: "2026-08-01"), skip(7, ding, "2026-09-12"), // 丁 judged before, skipped later → has a judged record → not here
            srec(8, wu, kind: "answer-seen"), skip(9, wu, "2026-09-13"), // 看过答案 → 在待复习（D66 ⑤），不在已跳过
        ]
        let s = state(rows), z = V.skippedZone(s)
        XCTAssertEqual(z["kind"], .string("skipped")); XCTAssertEqual(z["n"], .number(2))
        XCTAssertEqual(z["items"]!.arrayValue!.map { $0["char"]! }, [jia, yi].map(JSValue.string), "newest skip first")
        XCTAssertEqual(z["items"]!.arrayValue!.first?["record"]?["id"], .string("r3"), "a char keeps its latest skip record")
        XCTAssertEqual(z["items"]!.arrayValue!.map { $0["tone"]! }, [.number(3), .number(3)])
        XCTAssertEqual(try V.memoryZones(s, today: today, dates: dates)["recorded"], .number(3), "丙、丁 and 戊 (seen): skipped-only chars are not 已练汉字")
        XCTAssertEqual(LibraryView.zoneSamples(z).count, 2)
        XCTAssertEqual(V.skippedZone(.null), J(#"{"kind":"skipped","n":0,"items":[]}"#))
        XCTAssertEqual(try LibraryListView.listEntries(s, kind: .string("skipped"), today: today, policy: Config.policy, dates: dates).map { [$0["char"]!, $0["count"]!, $0["day"]!] }, [[.string(jia), .number(0), .string("2026-09-09")], [.string(yi), .number(0), .string("2026-09-08")]])
        XCTAssertEqual(LibraryListView.normalizeKind(.string("skippedList")), "skipped")
        let m = try LibraryListView.listModel(s, JSObject([("kind", .string("skipped")), ("today", .string(today))]), dates: dates)
        XCTAssertEqual(m["title"], V.ref("X-LIBFOUR.zone.skipped")); XCTAssertEqual(m["view"], .string("skippedList"))
        XCTAssertEqual(m["rows"]!.arrayValue!.count, 2); XCTAssertEqual(m["button"]?["label"], LibraryListView.buttonLabel(2))
        XCTAssertEqual(m["rows"]!.arrayValue!.map { [$0["noThumb"]!, $0["thumbCaption"]!] }, [[.bool(true), .string("")], [.bool(true), .string("")]], "no 没有笔迹 thumbnail on skipped rows")
        XCTAssertEqual(m["rows"]!.arrayValue!.first?["meta"]?["copy"], .string("X-LIBFOUR.skippedMeta"))
        XCTAssertEqual(m["rows"]!.arrayValue!.first?["meta"]?["params"]?["date"]?["params"], J(#"{"month":9,"day":9}"#))
        XCTAssertEqual(try LibraryListView.listModel(state([]), JSObject([("kind", .string("skipped")), ("today", .string(today))]), dates: dates)["empty"], .bool(true))
        let undone = state(rows.filter { $0["id"] != .string("r2") })
        XCTAssertEqual(V.skippedZone(undone)["items"]!.arrayValue!.map { $0["char"]! }, [jia].map(JSValue.string))
    }
    // test/ui/query.test.mjs — deckPredicates: deck membership and current library (settings.library; unknown → default core3500)
    func testDeckPredicatesInjectedLookup() {
        let missing = QueryView.deckPredicates(nil, lookup: { _ in nil })
        XCTAssertFalse(missing.inDeck(cYong)); XCTAssertFalse(missing.inLibrary(cYong)); XCTAssertTrue(missing.pinyinEntries().isEmpty)
        let real = QueryView.deckPredicates(.object(JSObject([("library", .string("nope"))])))
        XCTAssertTrue(real.inDeck(cYong)); XCTAssertTrue(real.inLibrary(cYong)); XCTAssertNotNil(real.card(cYong))
    }
    // src/core/line-starts.js — no provider, non-array and thrown measurements are null; valid line starts pass through.
    func testInjectedLineStartsContract() throws {
        let expected = JSValue.array([.number(0), .number(4)])
        for (breaks, want) in [(V.obj([("month-sub", expected)]), expected), (V.obj([("month-sub", .bool(false))]), .null), (V.obj([("throws", .bool(true))]), .null)] {
            let result = try CoreEngine.measuredView(JSObject([("breaks", breaks)])) {
                try MineSubView.monthView(.null, month: "2026-03", policy: Config.policy, dates: dates)
            }
            XCTAssertEqual(result["lines"]?["sub"], want)
        }
        XCTAssertNil(ViewLineStarts.provider)
    }

    func inkState(_ records: [JSValue], ids: [String]) -> JSValue {
        let ink = InkMath.encodeInkRaw([[InkPoint(x: 10,y: 20,t: 0,p: 0.5),InkPoint(x: 30,y: 40,t: 20,p: 0.7)]])
        var months=JSObject()
        for r in records where ids.contains(JS.string(r["id"])) { let m=String(JS.string(r["localDay"]).prefix(7)); var table=months[m]?.objectValue ?? JSObject();table[JS.string(r["id"])]=ink;months[m] = .object(table) }
        return state(records,extra:[("ink",.object(months))])
    }
    // test/ui/annual.test.mjs — D42 first of the year: the ink comes from the earliest of this year's records of that char that still has ink (date = that record's day); none this year → earliest record; last year's ink never stands in
    func testAnnualFirstInkStaysInYear() throws {
        let old = srec(1, jing43, day: "2025-12-30"), a = srec(2, jing43, day: "2026-01-02"), b = srec(3, jing43, day: "2026-03-05"), c = srec(4, jing43, day: "2026-05-09"), who = srec(5, cRen, day: "2026-01-03")
        // 1-02 和 3-05 的墨已回收 → 今年留墨的最早一条是 5-09（日期 = 那条记录的日子），去年的墨不顶替
        let s = inkState([old, a, b, c, who], ids: ["r1", "r4"]), m = try AnnualView.annualModel(s, today: today, dates: dates)
        XCTAssertEqual(m["first"]?["char"], .string(jing43)); XCTAssertEqual(m["first"]?["record"], c); XCTAssertEqual(m["first"]?["day"], c["localDay"])
        // 今年一条墨都没有 → 退回今年的最早一条记录（去年的墨不冒充）
        let none = try AnnualView.annualModel(inkState([old, a, b, c, who], ids: ["r1"]), today: today, dates: dates)
        XCTAssertEqual(none["first"]?["char"], .string(jing43)); XCTAssertEqual(none["first"]?["day"], a["localDay"]); XCTAssertEqual(none["first"]?["record"], a)
        // 墨今年内有（1 月）：还是最早那条自己
        let own = try AnnualView.annualModel(inkState([old, a, b, c, who], ids: ["r2"]), today: today, dates: dates)
        XCTAssertEqual(own["first"]?["day"], a["localDay"]); XCTAssertEqual(own["first"]?["record"], a)
        // 折叠月：kept 的记录才有墨；没有墨时 first 记 firstDay、record 为 null
        let kept = srec(6, he43, day: "2026-02-10")
        let someInk = InkMath.encodeInkRaw([[InkPoint(x: 10, y: 20, t: 0, p: 0.5), InkPoint(x: 30, y: 40, t: 20, p: 0.7)]])
        var folded = try json(#"{"records":{"2026-02":{"folded":true,"month":"2026-02","byDay":{"2026-02-03":["和"],"2026-02-10":["和"]},"chars":["和"],"kept":[],"work":{"2026-02-03":["和"],"2026-02-10":["和"]},"workJudged":{"2026-02-03":["和"],"2026-02-10":["和"]}}},"ink":{}}"#).objectValue!
        var february = folded["records"]!["2026-02"]!.objectValue!
        february["kept"] = .array([kept])
        var months = folded["records"]!.objectValue!
        months["2026-02"] = .object(february)
        folded["records"] = .object(months)
        folded["ink"] = .object(JSObject([("2026-02", .object(JSObject([("r6", someInk)])))]))
        let f = try AnnualView.annualModel(.object(folded), today: today, dates: dates)
        XCTAssertEqual(f["first"]?["char"], .string(he43)); XCTAssertEqual(f["first"]?["day"], .string("2026-02-10")); XCTAssertEqual(f["first"]?["record"], kept)
        let fNoInk = try AnnualView.annualModel(removing(.object(folded), "ink"), today: today, dates: dates)
        XCTAssertEqual(fNoInk["first"]?["char"], .string(he43)); XCTAssertEqual(fNoInk["first"]?["day"], .string("2026-02-03")); XCTAssertEqual(fNoInk["first"]?["record"], .null)
        // 注入的 hasInk（年报的取墨接口）：r3 有墨就取 r3
        let override = try AnnualView.annualModel(inkState([old, a, b, c, who], ids: ["r1", "r4"]), today: today, hasInk: { $0["id"] == .string("r3") }, dates: dates)
        XCTAssertEqual(override["first"]?["record"], b)
    }
    // test/ui/annual.test.mjs — 卷尾「同一个字，两次」(P161): a char with two inked records this year, the pair furthest apart; ties → written first; none → no tail
    func testAnnualTwiceLargestGapAndTie() throws {
        let recs=[srec(1,cYong,day:"2026-01-01"),srec(2,cRen,day:"2026-01-01"),srec(3,cRen,day:"2026-09-01"),srec(4,cYong,day:"2026-09-01")]
        let s=inkState(recs,ids:recs.map{JS.string($0["id"])}),m=try AnnualView.annualModel(s,today:today,dates:dates)
        XCTAssertEqual(m["twice"]?["char"],.string(cYong));XCTAssertEqual(m["twice"]?["first"]?["record"],recs[0]);XCTAssertEqual(m["twice"]?["last"]?["record"],recs[3])
        XCTAssertEqual(try AnnualView.annualPlan(s,today:today,year:nil,policy:Config.policy,dates:dates)["pages"]?.arrayValue?.last?["type"],.string("tail"))
    }
    // test/ui/mine.test.mjs — D42 month sheet: ink never borrowed across months; date tag stays the first member day.
    func testMonthInkSelectionAndStableTag() {
        let old=srec(1,cYong,day:"2026-08-01"),a=srec(2,cYong,day:"2026-09-01"),b=srec(3,cYong,day:"2026-09-22"),s=inkState([old,a,b],ids:["r1","r3"])
        let sheet=V.monthSheet(V.recordIndex(s,dates:dates),month:"2026-09",policy:Config.policy)
        XCTAssertEqual(sheet["cells"]?.arrayValue?.first?["record"],b);XCTAssertEqual(sheet["cells"]?.arrayValue?.first?["day"],a["localDay"])
        let without=inkState([old,a,b],ids:["r1"]),fallback=V.monthSheet(V.recordIndex(without,dates:dates),month:"2026-09",policy:Config.policy)
        XCTAssertEqual(fallback["cells"]?.arrayValue?.first?["record"],a)
    }
    // test/ui/mine.test.mjs — D42 day items: the char keeps the latest record OF THAT DAY that has ink; none that day keeps the latest
    func testDayInkSelectionAndFoldedNoRecord() throws {
        let a=srec(1,cYong,day:today),b=srec(2,cYong,day:today),s=inkState([a,b],ids:["r1"])
        XCTAssertEqual(V.dayItems(V.recordIndex(s,dates:dates),day:today).first?["record"],a)
        let fold=try json(#"{"records":{"2026-09":{"folded":true,"kept":[],"chars":["永"],"byDay":{"2026-09-24":["永"]},"work":{"2026-09-24":["永"]},"workJudged":{"2026-09-24":["永"]}}}}"#)
        XCTAssertEqual(V.dayItems(V.recordIndex(fold,dates:dates),day:today).first?["record"],.null)
    }
    // test/ui/home.test.mjs — resume dimension: none / A / B / A+B; B is the primary line, A the other (D05 / S01); D66 ⑧ lines carry done / total, `daily` is A whatever B does
    // B6 (G45, D36): a current char that has seen its answer is not counted in 「还有 N 个字没写」
    func testResumePriorityAndSeenPosition() throws {
        let at=try dates.dayStartMs(.string(today))+12*3600000
        func session(_ id: String,_ kind: String) throws -> JSValue { try SessionRules.createSession(id:.string(id),kind:.string(kind),source:nil,queue:.array([cYong,cRen,cKou].map{.string("base:"+$0)}),at:.number(at),dates:dates) }
        var a=try session("s1","daily").objectValue!,b=try session("s2","picked").objectValue!,current=b["current"]!.objectValue!
        a["items"]=try json(#"[{"kind":"skipped"},{"kind":"judged"},{"kind":"answer-seen"}]"#)
        b["cursor"] = .number(1);current["answerSeen"] = .bool(true);b["current"] = .object(current)
        let s=state([],extra:[("sessions",V.obj([("A",.object(a)),("B",.object(b))]))]),m=try HomeView.resumeOf(s,now:at,policy:Config.policy,dates:dates)
        XCTAssertEqual(m["resume"],.string("A+B"));XCTAssertEqual(m["primary"]?["slot"],.string("B"));XCTAssertEqual(m["primary"]?["remaining"],.number(1));XCTAssertEqual(m["primary"]?["position"],.number(2));XCTAssertEqual(m["other"]?["done"],.number(2));XCTAssertEqual(m["daily"],m["other"])
        // none / A / B / A+B 的整表：B 是主行、A 是副行；daily 永远是 A（无论 B 是什么）（D66 ⑧）
        func sess(_ slot: String,_ kind: String,_ n: Int,_ cursor: Int,_ day: String) throws -> JSValue {
            let chars: [JSValue] = (0..<n).map { .string("base:" + String(Unicode.Scalar(0x4E00 + $0)!)) }
            let started = try dates.dayStartMs(.string(day)) + 7 * 3600000
            return .object(JSObject([("id", .string("s" + slot)),("slot", .string(slot)),("kind", .string(kind)),("source",.object(JSObject([("view",.string("home"))]))),
                ("queue",.array(chars)),("cursor",.number(Double(cursor))),("items",.array([])),("current",.object(JSObject([("phase",.string("recall")),("strokes",.array([]))]))),("lastLine",.null),
                ("startedAt",.number(started)),("startedDay",.string(day)),("updatedAt",.number(started))]))
        }
        let yday = try dates.addDays(.string(today), -1)
        func resume(_ A: JSValue?, _ B: JSValue?) throws -> JSValue {
            try HomeView.resumeOf(state([],extra:[("sessions",V.obj([("A",A ?? .null),("B",B ?? .null),("lastEnded",.object(JSObject()))]))]),now:at,policy:Config.policy,dates:dates)
        }
        XCTAssertEqual(try resume(nil,nil),J(#"{"resume":"none","primary":null,"other":null,"daily":null}"#))
        XCTAssertEqual(try resume(try sess("A","daily",5,2,today),nil),J(#"{"resume":"A","primary":{"slot":"A","kind":"daily","remaining":3,"done":0,"total":5},"other":null,"daily":{"slot":"A","kind":"daily","remaining":3,"done":0,"total":5}}"#))
        XCTAssertEqual(try resume(nil,try sess("B","picked",2,0,today)),J(#"{"resume":"B","primary":{"slot":"B","kind":"picked","remaining":2,"done":0,"total":2},"other":null,"daily":null}"#))
        XCTAssertEqual(try resume(try sess("A","first",5,1,today),try sess("B","picked",2,1,today)),J(#"{"resume":"A+B","primary":{"slot":"B","kind":"picked","remaining":1,"done":0,"total":2},"other":{"slot":"A","kind":"first","remaining":4,"done":0,"total":5},"daily":{"slot":"A","kind":"first","remaining":4,"done":0,"total":5}}"#))
        XCTAssertEqual(try resume(try sess("A","daily",5,5,today),nil)["resume"],.string("none"),"written-out group is not resumable")
        XCTAssertEqual(try resume(try sess("A","daily",5,2,yday),nil)["resume"],.string("none"),"yesterday's daily expires (P37)")
        XCTAssertEqual(try resume(nil,try sess("B","picked",2,0,yday))["resume"],.string("B"),"picked never expires (P61)")
    }
    // test/ui/library-all.test.mjs — pinyin: initial groups (tones stripped, ü → u), each cell labelled with pinyin, no-pinyin chars in 其他
    func testAllPinyinGroupingAndExactFind() throws {
        let s=state([srec(1,cYong),srec(2,cRen),srec(3,cKou)]),py=V.obj([(cYong,.string("yǒng")),(cRen,.string("rén")),(cKou,.string(""))])
        var a=JSObject([("today",.string(today)),("sort",.string("py")),("pinyin",py)])
        let m=try LibraryAllView.allModel(s,a,dates:dates)
        XCTAssertEqual(m["groups"]?.arrayValue?.map{$0["key"]!},["p:R","p:Y","p:#"].map(JSValue.string))
        a["find"] = .string("ren");let found=try LibraryAllView.allModel(s,a,dates:dates)
        XCTAssertEqual(found["find"]?["chars"],.array([.string(cRen)]));XCTAssertEqual(found["showSort"],.bool(false))
    }
    // test/ui/library-list.test.mjs — R-E01 / K16: 快忘了 = latest judged correct and due; mutually exclusive with 写错过; cap from policy
    func testForgetListCapAndWrongExclusion() throws {
        let recs=[srec(1,cYong),srec(2,cRen),srec(3,cKou,judgment:"wrong")],sched=V.obj([("base:"+cYong,try json(#"{"due":"2026-09-01","fsrs":{"stability":1}}"#)),("base:"+cRen,try json(#"{"due":"2026-09-02","fsrs":{"stability":1}}"#))])
        let s=state(recs,extra:[("sched",sched)]),p=V.policy(V.obj([("forgetCap",.number(1))]))
        let entries=try LibraryListView.listEntries(s,kind:.string("forget"),today:today,policy:p,dates:dates)
        XCTAssertEqual(entries.count,1);XCTAssertEqual(entries.first?["char"],.string(cYong))
    }
    // test/ui/library.test.mjs — wall order: hollow first, then latest judged newest → oldest (by id); wrong = standard glyph kind
    func testWallOrderAndTruncation() throws {
        let recs=(1...90).map{srec($0,String(Unicode.Scalar(0x4e00+$0)!),judgment:$0==90 ? "wrong":"correct")},s=state(recs,extra:[("custom",V.obj([("added",.array([V.obj([("char",.string(cYong)),("at",.number(1))])]))]))])
        let m=try LibraryView.libraryHomeModel(s,today:today,policy:Config.policy,compact:false,width:.number(200),dates:dates),cells=m["wall"]!["cells"]!.arrayValue!
        XCTAssertEqual(cells.count,32);XCTAssertEqual(cells[0]["kind"],.string("hollow"));XCTAssertEqual(cells[1]["kind"],.string("wrong"));XCTAssertEqual(m["wall"]?["more"],.number(59))
        XCTAssertEqual(LibraryView.cardMini(recs).arrayValue?.count,5)
    }

    // ECMAScript edge: compatibility ideographs are distinct code points, even when Swift considers them canonically equal.
    func testWordPartsPreservesJSCodepointIdentity() {
        let compat="\u{f900}", canonical="\u{8c48}"
        let parts=LibraryListView.wordParts(.string(compat),.string(canonical))
        XCTAssertEqual(parts["has"],.bool(true));XCTAssertEqual(parts["pre"],.string(compat));XCTAssertEqual(parts["tg"],.string(""))
    }
    func testAllUsesUTF16SortAndExactCustomMembership() throws {
        let compat="\u{f900}", canonical="\u{8c48}", astral="\u{20000}"
        let s=state([srec(1,compat),srec(2,astral)],extra:[("custom",V.obj([("added",.array([V.obj([("char",.string(canonical)),("at",.number(1))])]))]))])
        let sorted=try LibraryAllView.allModel(s,JSObject([("today",.string(today)),("sort",.string("py")),("pinyin",V.obj([(compat,.string("")),(astral,.string(""))]))]),dates:dates)
        let other=sorted["groups"]!.arrayValue!.first{$0["key"] == .string("p:#")}!
        XCTAssertEqual(other["cells"]?.arrayValue?.map{$0["char"]!},[astral,compat].map(JSValue.string))
        let filtered=try LibraryAllView.allModel(s,JSObject([("today",.string(today)),("filter",.string("custom"))]),dates:dates)
        XCTAssertFalse(filtered["groups"]!.arrayValue!.contains{$0["key"] == .string("custom-done")})
    }

}
