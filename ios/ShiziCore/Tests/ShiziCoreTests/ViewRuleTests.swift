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
    // test/ui/annual.test.mjs — the year count: distinct work chars this year (right ones; a wrong-only char does not count, D51 ⑤)
    func testAnnualDistinctWorkCount() throws {
        let s=state([srec(1,cYong),srec(2,cYong),srec(3,cRen,judgment:"wrong"),srec(4,cKou,extra:[("source",.string("paper"))])])
        let m=try AnnualView.annualModel(s,today:today,dates:dates)
        XCTAssertEqual(m["count"],.number(1)); XCTAssertEqual(m["chars"],.array([.string(cYong)])); XCTAssertNil(m["busiestMonth"]); XCTAssertNil(m["rarestChar"])
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
    // test/ui/library-list.test.mjs — B4 (G38, D36): 写错过 with 8 rows → default selects only the 5 most recently wrong
    // test/ui/library-list.test.mjs — D66 ⑬: the default selection follows 每组字数
    func testListDefaultTopAndGroupSize() throws {
        let records=(1...8).map{srec($0,String(Unicode.Scalar(0x4e00+$0)!),judgment:"wrong")}
        for (size,expected) in [(5,5),(20,8)] {
            let s=state(records,extra:[("settings",V.obj([("groupSize",.number(Double(size)))]))])
            let m=try LibraryListView.listModel(s,JSObject([("kind",.string("wrong")),("today",.string(today))]),dates:dates)
            XCTAssertEqual(m["selectedCount"],.number(Double(expected))); XCTAssertEqual(m["restCount"],.number(Double(8-expected)))
        }
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
    // test/ui/paper-detail.test.mjs — P169: detailModel——纸上记录计入次数与写错过，但不进笔迹格
    func testDetailPaperCountsButNoInkCell() throws {
        let screen=srec(1,cYong),paper=srec(2,cYong,judgment:"wrong",extra:[("source",.string("paper"))]),m=try detail(state([screen,paper]))
        XCTAssertEqual(m["count"],.number(2)); XCTAssertEqual(m["cells"],.array([screen])); XCTAssertEqual(m["paperRows"],.array([paper])); XCTAssertEqual(m["imageRecord"],screen); XCTAssertEqual(m["list"],.string("wrong"))
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
    // test/ui/library.test.mjs — columns (8, Pro Max 9, large text ≤ 6, every cell ≥ 44pt; independent of members)
    func testWallColumnWidths() {
        for (w,n) in [(320,6),(375,7),(393,8),(402,8),(440,9)]{XCTAssertEqual(V.wallColumns(large:false,width:.number(Double(w))),n); XCTAssertLessThanOrEqual(V.wallColumns(large:true,width:.number(Double(w))),6)}
        XCTAssertEqual(V.wallColumns(large:false,width:nil),8); XCTAssertEqual(V.wallColumns(large:true,width:nil),6)
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
    // test/ui/library-zones.test.mjs — skippedZone (D62): skipped and still no judged record; not counted in recorded; newest skip first
    func testSkippedLeavesAfterPractice() {
        let skipped=srec(1,cYong,kind:"skipped")
        XCTAssertEqual(V.skippedZone(state([skipped]))["n"],.number(1))
        XCTAssertEqual(V.skippedZone(state([skipped,srec(2,cYong,kind:"answer-seen")]))["n"],.number(0))
        XCTAssertEqual(V.skippedZone(state([skipped,srec(2,cYong)]))["n"],.number(0))
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
    // test/ui/annual.test.mjs — D42 first of the year: the ink comes from the earliest of this year's records of that char that still has ink
    func testAnnualFirstInkStaysInYear() throws {
        let old=srec(1,cYong,day:"2025-12-31"),a=srec(2,cYong,day:"2026-01-01"),b=srec(3,cYong,day:"2026-02-01")
        let s=inkState([old,a,b],ids:["r1","r3"]),m=try AnnualView.annualModel(s,today:today,dates:dates)
        XCTAssertEqual(m["first"]?["record"],b);XCTAssertEqual(m["first"]?["day"],b["localDay"])
        XCTAssertEqual(try AnnualView.annualModel(inkState([old,a,b],ids:["r1"]),today:today,dates:dates)["first"]?["record"],a)
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
    // test/ui/home.test.mjs — resume dimension: none / A / B / A+B; B is the primary line, A the other (D05 / S01)
    // B6 (G45, D36): a current char that has seen its answer is not counted in 「还有 N 个字没写」
    func testResumePriorityAndSeenPosition() throws {
        let at=try dates.dayStartMs(.string(today))+12*3600000
        func session(_ id: String,_ kind: String) throws -> JSValue { try SessionRules.createSession(id:.string(id),kind:.string(kind),source:nil,queue:.array([cYong,cRen,cKou].map{.string("base:"+$0)}),at:.number(at),dates:dates) }
        var a=try session("s1","daily").objectValue!,b=try session("s2","picked").objectValue!,current=b["current"]!.objectValue!
        a["items"]=try json(#"[{"kind":"skipped"},{"kind":"judged"},{"kind":"answer-seen"}]"#)
        b["cursor"] = .number(1);current["answerSeen"] = .bool(true);b["current"] = .object(current)
        let s=state([],extra:[("sessions",V.obj([("A",.object(a)),("B",.object(b))]))]),m=try HomeView.resumeOf(s,now:at,policy:Config.policy,dates:dates)
        XCTAssertEqual(m["resume"],.string("A+B"));XCTAssertEqual(m["primary"]?["slot"],.string("B"));XCTAssertEqual(m["primary"]?["remaining"],.number(1));XCTAssertEqual(m["primary"]?["position"],.number(2));XCTAssertEqual(m["other"]?["done"],.number(2));XCTAssertEqual(m["daily"],m["other"])
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
