import Foundation
import XCTest
@testable import ShiziCore

final class ViewParityTests: XCTestCase {
    let dates = Dates(timeZone: TimeZone(identifier: "Asia/Shanghai")!)
    func value(_ text: String) throws -> JSValue { try JSONParser.parse(text) }

    func testViewsBasicGolden() throws {
        XCTAssertEqual(try runOpGolden("views-basic"), 640)
    }

    // test/ui/annual.test.mjs — empty year and folded work members retain their year.
    func testAnnualEmptyAndFoldedYears() throws {
        let state = try value(#"{"records":{"2025-02":{"folded":true,"chars":["永"],"kept":[],"byDay":{"2025-02-01":["永"]},"work":{"2025-02-01":["永"]},"workJudged":{"2025-02-01":["永"]}}}}"#)
        XCTAssertEqual(AnnualView.annualYears(state, dates: dates), [2025])
        XCTAssertEqual(AnnualView.annualDefaultYear(state, today: "2026-03-01", dates: dates), .number(2025))
        XCTAssertEqual(try AnnualView.annualModel(state, today: "2026-03-01", dates: dates)["empty"], .bool(true))
        let model = try AnnualView.annualModel(state, today: "2025-03-01", dates: dates)
        XCTAssertEqual(model["count"], .number(1)); XCTAssertEqual(model["first"]?["record"], .null)
    }

    // test/ui/library-list.test.mjs — selection normalization, word parts and real disabled zero state.
    func testListSelectionAndEmpty() throws {
        XCTAssertEqual(LibraryListView.normalizeKind(.string("againList")), "wrong")
        XCTAssertTrue(LibraryListView.sameSel(try value(#"["永","甲","永"]"#), try value(#"["甲","永"]"#)))
        XCTAssertEqual(LibraryListView.wordParts(.string("a永b"), .string("永")), try value(#"{"pre":"a","tg":"永","post":"b","has":true}"#))
        let m = try LibraryListView.listModel(.null, JSObject([("today", .string("2026-03-01")), ("kind", .string("wrong"))]), dates: dates)
        XCTAssertEqual(m["empty"], .bool(true)); XCTAssertEqual(m["button"]?["disabled"], .bool(true))
    }

    // test/ui/home.test.mjs / test/ui/h2-home-e.test.mjs — first visit and 4am calendar/local day boundary.
    func testHomeFirstAndFourAM() throws {
        let t = try dates.dayStartMs(.string("2026-03-02"))
        let before = try HomeView.homeModel(.null, now: t-1, policy: Config.policy, deck: nil, dates: dates)
        let after = try HomeView.homeModel(.null, now: t, policy: Config.policy, deck: nil, dates: dates)
        XCTAssertEqual(before["view"], .string("first")); XCTAssertEqual(after["today"], .string("2026-03-02"))
        XCTAssertEqual(before["today"], .string("2026-03-01")); XCTAssertEqual(before["dateParts"], after["dateParts"])
        XCTAssertEqual(HomeView.homeCtaKey(after), "X-HOME.start")
        XCTAssertEqual(HomeView.homeViewOf(try value(#"{"records":"record","resume":"B","capital":null,"gapDays":0}"#)), "progress")
    }

    // test/ui/library-all.test.mjs — old filters map to due; search mode and batching.
    func testAllFiltersFindAndBatch() throws {
        XCTAssertEqual(LibraryAllView.normalizeFilter(.string("wrong")), "due")
        XCTAssertEqual(LibraryAllView.normalizeFilter(.string("forget")), "due")
        XCTAssertEqual(LibraryAllView.parseFind(.string("a永甲"))["char"], .string("永"))
        XCTAssertEqual(LibraryAllView.pyInitial(.string("lǜ")), .string("L"))
        XCTAssertEqual(LibraryAllView.normalizeSort(.string("bad")), "recent")
        let groups = try value(#"[{"head":true,"cells":[1,2,3]}]"#).arrayValue!
        XCTAssertEqual(LibraryAllView.takeCells(groups, limit: 1)[0]["partial"], .bool(true))
        XCTAssertTrue(LibraryAllView.takeCells(groups, limit: 0).isEmpty)
    }

    // test/ui/detail.test.mjs — hero uses first / latest screen judgments; old photos remain read-only.
    func testDetailHeroAndPhoto() throws {
        let first = srec(1, cYong), last = srec(2, cYong, judgment: "wrong")
        let one = DetailView.detailHero(ViewSupport.obj([("cells", .array([first]))]))
        XCTAssertEqual(one["cells"]?.arrayValue?.count, 1)
        let two = DetailView.detailHero(ViewSupport.obj([("cells", .array([first, last]))]))
        XCTAssertEqual(two["cells"]?.arrayValue?.count, 2)
        XCTAssertEqual(DetailView.detailHero(.null)["kind"], .string("ref"))
        let state = try value(#"{"photos":{"永":{"dataURL":"bad"},"甲":{"dataURL":"data:image/png;base64,AA"}}}"#)
        XCTAssertEqual(DetailView.photoOf(state, char: cYong), .null)
        XCTAssertNotEqual(DetailView.photoOf(state, char: "甲"), .null)
        XCTAssertEqual(DetailView.cellCopy(last, dates: dates)["caption"], ViewSupport.ref("X-RESULT.cellWrong"))
    }

    // test/ui/native-mine-sub.test.mjs — B3.9 the sheet geometry is the web sheetGrid rule.
    func testMineSubGeometryAndLabels() throws {
        XCTAssertEqual(MineSubView.sheetGeometry(0, width: 402)["cols"], .number(0))
        let g = MineSubView.sheetGeometry(1, width: 402)
        XCTAssertEqual(g["c"], .number(110)); XCTAssertEqual(g["cells"]?.arrayValue?.count, 1)
        let cell = try value(#"{"ch":"永","mode":"hand","day":"2026-03-02","record":{"localDay":"2026-03-01"}}"#)
        XCTAssertEqual(try MineSubView.cellLabelRef(cell, dates: dates)["copy"], .string("X-WORK.cellInkDay"))
        let empty = try MineSubView.monthView(.null, month: "2026-03", policy: Config.policy, dates: dates)
        XCTAssertEqual(empty["n"], .number(0)); XCTAssertEqual(empty["kuan"], .string(""))
        XCTAssertEqual(try MineSubView.monthSheetOf(.null, month: "2026-03", policy: Config.policy, dates: dates), .null)
    }

    // test/ui/native-mine.test.mjs — small sheets sign; AX limits columns; trim re-tags the first cell.
    func testMinePageAXTrimAndBackupValues() throws {
        XCTAssertEqual(MinePageView.mineSheetRows(80, ax: 5)["cols"], .number(4))
        XCTAssertEqual(MinePageView.mineSheetRows(80, ax: 0)["max"], .number(16))
        let cells = try value(#"[{"day":"2026-03-01"},{"day":"2026-03-02"},{"day":"2026-03-02"}]"#).arrayValue!
        let trimmed = MinePageView.trimSheetCells(cells, max: 2)
        XCTAssertEqual(trimmed["hidden"], .number(1)); XCTAssertEqual(trimmed["cells"]?.arrayValue?.first?["tag"], .string("2"))
        XCTAssertEqual(try MinePageView.backupValueRef(try value(#"{"backupHint":{"kind":"pressure"},"lastBackup":null}"#), dates: dates), ViewSupport.ref("X-MINE.backupNearFull"))
        XCTAssertEqual(try MinePageView.backupValueRef(.null, dates: dates), ViewSupport.ref("R-M03.noBackup"))
        let choices = MinePageView.mineChoices(SettingsView.settingsView(nil), policy: Config.policy)
        XCTAssertEqual(choices["appearance"]?["options"]?.arrayValue?.map { $0["id"]! }, ["auto","light","dark"].map(JSValue.string))
    }

    func testViewsPagesGolden() throws {
        XCTAssertGreaterThan(try runOpGolden("views-pages"), 0)
    }

    // src/session/views/query.js — same core filter and selection rules, copy refs stay keys.
    func testQuerySheetBranches() throws {
        let empty = QueryView.sheetModel(try value(#"{"mode":"pick","text":"","selected":[]}"#).objectValue!)
        XCTAssertEqual(empty["view"], .string("hint"))
        XCTAssertEqual(empty["bar"]?["disabled"], .bool(true))
        for (text, expected) in [("永", "card"), ("永甲", "rows"), ("𠀀", "bad")] {
            let a = JSObject([("mode", .string("lookup")), ("text", .string(text))])
            XCTAssertEqual(QueryView.sheetModel(a)["view"], .string(expected))
        }
    }

    // test/ui/prefs.test.mjs
    // settingsView: defaults — P73 library, remind off at policy.remindDefault (P18), auto; no large field (D29)
    func testSettingsViewDefaults() throws {
        let v = SettingsView.settingsView(nil)
        XCTAssertEqual(v["library"], Config.policy["defaultLibrary"])
        XCTAssertEqual(v["remind"], try value(#"{"enabled":false,"hour":20,"minute":0,"permission":"unknown"}"#))
        for k in ["sound", "writeMode", "large"] { XCTAssertNil(v[k]) }
        XCTAssertEqual(v["appearance"], .string("auto"))
        XCTAssertEqual(v["appearanceSwitch"], .bool(true))
        let settings = try value(#"{"library":"curriculum2500","sound":false,"writeMode":"paper","remind":{"enabled":true,"hour":7,"minute":5,"permission":"denied"},"large":true,"appearance":"dark"}"#)
        let w = SettingsView.settingsView(settings)
        XCTAssertEqual(w["remind"], settings["remind"])
        XCTAssertEqual(w["denied"], .bool(true)); XCTAssertEqual(w["on"], .bool(false))
        XCTAssertNil(w["large"]); XCTAssertEqual(w["appearance"], .string("dark"))
        for permission in ["granted", "unknown"] {
            let s = ViewSupport.obj([("remind", ViewSupport.obj([("enabled", .bool(true)), ("permission", .string(permission))]))])
            XCTAssertEqual(SettingsView.settingsView(s)["on"], .bool(true))
        }
        XCTAssertEqual(SettingsView.settingsView(try value(#"{"library":"nope"}"#))["library"], Config.policy["defaultLibrary"])
        let off = SettingsView.settingsView(settings, policy: ViewSupport.policy(try value(#"{"features":{"appearanceSwitch":false}}"#)))
        XCTAssertEqual(off["appearance"], .string("auto")); XCTAssertEqual(off["appearanceSwitch"], .bool(false))
    }

    // test/ui/prefs.test.mjs — time helpers
    func testTimeHelpers() throws {
        XCTAssertEqual(SettingsView.parseTime(.string("20:00")), try value(#"{"hour":20,"minute":0}"#))
        XCTAssertEqual(SettingsView.parseTime(.string("7:05")), try value(#"{"hour":7,"minute":5}"#))
        XCTAssertEqual(SettingsView.parseTime(.string("24:00")), .null)
        XCTAssertEqual(SettingsView.parseTime(.string("")), .null)
        XCTAssertEqual(SettingsView.timeText(.number(7), .number(5)), "07:05")
        XCTAssertEqual(SettingsView.defaultRemindTime(try value(#"{"remindDefault":"bad"}"#)), SettingsView.defaultRemindTime())
    }

    // test/ui/prefs.test.mjs
    // RemindBody (E3): denied → switch shows off and no time row, with R-S02 subtext, body and 手机设置
    func testRemindBodyDenied() throws {
        let v = SettingsView.remindView(try value(#"{"remind":{"enabled":true,"permission":"denied"}}"#))
        XCTAssertEqual(v["on"], .bool(false)); XCTAssertEqual(v["remind"]?["enabled"], .bool(true))
        XCTAssertEqual(v["remindPage"]?["time"], .null)
        XCTAssertEqual(v["remindPage"]?["sub"]?["denied"], ViewSupport.ref("R-S02.title"))
        XCTAssertEqual(v["remindPage"]?["note"]?["body"], ViewSupport.ref("R-S02.body"))
        XCTAssertEqual(v["remindPage"]?["note"]?["link"], ViewSupport.ref("R-S02.link"))
    }

    // test/ui/about.test.mjs — B7 (G43, D36): version line 「版本 1.0（20261001）」 from VERSION + the date part of BUILD; full BUILD on tap, selectable
    func testB7VersionLine() throws {
        XCTAssertEqual(AboutView.buildDay(.string("20261001-abcdef123456")), "20261001")
        XCTAssertEqual(AboutView.buildDay(.string("weird")), "weird")
        let v = AboutView.versionRefs(.string("1.0"), .string("20261001-abcdef123456"))
        XCTAssertEqual(v["line"]?["params"], try value(#"{"version":"1.0","day":"20261001"}"#))
        XCTAssertEqual(v["full"]?["params"], try value(#"{"build":"20261001-abcdef123456"}"#))
        XCTAssertEqual(v["aria"]?["copy"], .string("X-ABOUT.versionAria"))
    }

    // test/ui/about.test.mjs — C1 / P197: the privacy network sentence depends on the platform (iOS shell never goes online; web says what it fetches)
    func testPrivacyPlatform() {
        let ios = AboutView.privacyModel(.bool(true))["paragraphs"]!.arrayValue!
        let web = AboutView.privacyModel(.bool(false))["paragraphs"]!.arrayValue!
        XCTAssertEqual(ios.count, 4); XCTAssertEqual(web.count, 4)
        XCTAssertEqual(ios[2], ViewSupport.ref("X-ABOUT.privacy3Native"))
        XCTAssertEqual(web[2], ViewSupport.ref("X-ABOUT.privacy3Web"))
        for i in [0, 1, 3] { XCTAssertEqual(ios[i], web[i]) }
    }

    // test/ui/about.test.mjs — sub-pages: privacy paragraphs, credits groups (code → data → font), letter transitional note (P21)
    func testAboutSubPages() {
        let groups = AboutView.creditGroupRefs()
        XCTAssertEqual(groups.map { $0["kind"]! }, ["code", "data", "font"].map(JSValue.string))
        XCTAssertEqual(groups.reduce(0) { $0 + $1["items"]!.arrayValue!.count }, Config.credits["CREDITS"]!.arrayValue!.count)
        let code = Config.credits["CREDITS"]!.arrayValue!.filter { $0["kind"] == .string("code") }
        XCTAssertEqual(AboutView.creditGroupRefs(code).count, 1)
        XCTAssertEqual(AboutView.letterModel()["address"], ViewSupport.ref("R-AB01.letterAddressPending"))
    }

    // test/ui/work-text.test.mjs — 落款 text (§5.2 / §6.4): 汉字日期 + 全角空格 + 汉字字数；2 写「两」；一个字也写「一字」（V2-05）
    func testKuanDateAndCount() throws {
        for n in [1, 2, 3, 12] {
            let r = try KuanView.kuanRef(JSObject([("day", .string("2026-10-05")), ("n", .number(Double(n)))]), now: 0, dates: dates)
            XCTAssertEqual(r["copy"], .string("X-WORK.kuanJoin"))
            XCTAssertEqual(r["params"]?["n"]?["params"]?["n"], .string(try Dates.cnCount(Double(n))))
            XCTAssertEqual(r["params"]?["date"], ViewSupport.ref("R-I01.signatureDate", try dates.signatureDateParts(.string("2026-10-05"))))
        }
        XCTAssertEqual(try KuanView.dateRef(nil, now: 0, dates: dates), try KuanView.dateRef(.string("1970-01-01"), now: 0, dates: dates))
    }

    // test/ui/work-text.test.mjs — 自选组的落款 (T2-03): 「自选N字」，数量照样带
    func testKuanPicked() throws {
        for n in [1, 2, 5] {
            let r = try KuanView.kuanRef(JSObject([("day", .string("2026-10-04")), ("n", .number(Double(n))), ("picked", .bool(true))]), now: 0, dates: dates)
            XCTAssertEqual(r["params"]?["n"]?["copy"], .string("X-WORK.kuanCountPicked"))
            XCTAssertEqual(r["params"]?["n"]?["params"]?["n"], .string(try Dates.cnCount(Double(n))))
        }
    }

    // test/ui/work-text.test.mjs — 分张的落款 (D39 / §6.7): 其一 / 其二 appended, each page writes its own count; one page has no 其几
    func testKuanParts() throws {
        for (n, part) in [(80, 1), (16, 2)] {
            let r = try KuanView.kuanRef(JSObject([("month", .string("2026-09")), ("n", .number(Double(n))), ("part", .number(Double(part))), ("of", .number(2))]), now: 0, dates: dates)
            XCTAssertEqual(r["copy"], .string("X-WORK.kuanJoinPart"))
            XCTAssertEqual(r["params"]?["part"], try KuanView.partRef(Double(part)))
        }
        let a = JSObject([("month", .string("2026-08")), ("n", .number(46))])
        var b = a; b["part"] = .number(1); b["of"] = .number(1)
        XCTAssertEqual(try KuanView.kuanRef(a, now: 0, dates: dates), try KuanView.kuanRef(b, now: 0, dates: dates))
    }

    // src/session/views/lines.js — registration, invalid return and thrown measurement
    func testLineMeasurer() {
        let lines = ViewLines()
        XCTAssertEqual(lines.measureLines(.null), .null)
        lines.setLineMeasurer { _ in .array([.number(3)]) }
        XCTAssertEqual(lines.measureLines(.null), .array([.number(3)]))
        lines.setLineMeasurer { _ in .bool(false) }
        XCTAssertEqual(lines.measureLines(.null), .null)
        lines.setLineMeasurer { _ in throw CoreError.error("failed") }
        XCTAssertEqual(lines.measureLines(.null), .null)
        lines.setLineMeasurer(nil)
        XCTAssertEqual(lines.measureLines(.null), .null)
    }
    // test/ui/prefs.test.mjs — commitSettings on an empty store creates settings with the one field (schema-valid)
    func testCommitSettingsEmptyStore() throws {
        let env = freshStore(.local)
        XCTAssertEqual(env.store.state["settings"], .null)
        XCTAssertEqual(SettingsView.commitSettings(env.store, label: "settings:t", fields: JSObject([("appearance", .string("auto"))]))["ok"], .bool(true))
        XCTAssertEqual(env.store.state["settings"], try value(#"{"appearance":"auto"}"#))
    }

    // test/ui/prefs.test.mjs — commitSettings: one commit writes only settings; keeps other fields; failure publishes nothing; retry works; no-op skips the write
    func testCommitSettingsRollbackRetryAndNoOp() throws {
        let env = freshStore(.local)
        let initial = try value(#"{"settings":{"library":"adv3000"},"custom":{"added":[{"char":"永","at":1790906400000}]}}"#)
        XCTAssertEqual(env.store.seed(initial)["ok"], .bool(true))
        let custom = env.store.state["custom"]
        env.storage.failNextWrite(1, kind: "generic", matchKey: SK("settings"))
        let fields = JSObject([("appearance", .string("light"))])
        XCTAssertEqual(SettingsView.commitSettings(env.store, label: "settings:t", fields: fields)["ok"], .bool(false))
        XCTAssertEqual(env.store.state["settings"], initial["settings"])
        let ok = SettingsView.commitSettings(env.store, label: "settings:t", fields: fields)
        XCTAssertEqual(ok["ok"], .bool(true))
        XCTAssertEqual(ok["keys"], .array([.string(SK("settings"))]))
        XCTAssertEqual(env.store.state["custom"], custom)
        XCTAssertEqual(env.store.state["settings"], try value(#"{"library":"adv3000","appearance":"light"}"#))
        let writes = env.disk.writeCount
        XCTAssertEqual(SettingsView.commitSettings(env.store, label: "settings:t", fields: fields)["skipped"], .bool(true))
        XCTAssertEqual(env.disk.writeCount, writes)
    }

    // test/ui/prefs.test.mjs — remind: enabling fills the P18 default time once; time change and permission keep the other remind fields; sync hook called
    // The JS platform sync hook stays outside the pure Swift package.
    func testRemindEnableTimeAndPermission() throws {
        let store = freshStore(.local).store
        XCTAssertEqual(SettingsView.commitRemindEnabled(store, on: .bool(true))["ok"], .bool(true))
        XCTAssertEqual(store.state["settings"]?["remind"], try value(#"{"enabled":true,"hour":20,"minute":0}"#))
        XCTAssertEqual(SettingsView.commitRemindTime(store, hour: .number(7), minute: .number(30))["ok"], .bool(true))
        _ = SettingsView.commitRemindEnabled(store, on: .bool(false))
        _ = SettingsView.commitRemindEnabled(store, on: .bool(true))
        XCTAssertEqual(store.state["settings"]?["remind"], try value(#"{"enabled":true,"hour":7,"minute":30}"#))
        let payload = try value(#"{"permission":"denied"}"#)
        XCTAssertEqual(SettingsView.applyReminderStatus(store, payload: payload)["ok"], .bool(true))
        XCTAssertEqual(SettingsView.remindOf(store), try value(#"{"enabled":true,"hour":7,"minute":30,"permission":"denied"}"#))
        XCTAssertEqual(SettingsView.applyReminderStatus(store, payload: payload)["skipped"], .bool(true))
        _ = SettingsView.applyReminderStatus(store, payload: .string("weird"))
        XCTAssertEqual(SettingsView.remindOf(store)["permission"], .string("unknown"))
    }

    // test/ui/library-switch.test.mjs — real deck: counts come from the data (3500 / 2974 / 744 / 2500)
    func testLibraryRowsRealDeckCounts() {
        let rows = LibrarySwitchView.libraryRows(nil).arrayValue!
        XCTAssertEqual(rows.map { $0["total"]! }, [3500, 2974, 744, 2500].map { .number(Double($0)) })
        XCTAssertEqual(rows.map { $0["recorded"]! }, Array(repeating: .number(0), count: 4))
        XCTAssertEqual(rows.map { $0["current"]! }, [.bool(true), .bool(false), .bool(false), .bool(false)])
    }

    // test/ui/library-switch.test.mjs — libraryRows: current follows settings.library; unknown id falls back to the default library
    func testLibraryRowsCurrentLibrary() throws {
        for id in ["adv3000", "curriculum2500", "nope"] {
            let state = ViewSupport.obj([("settings", ViewSupport.obj([("library", .string(id))]))])
            let rows = LibrarySwitchView.libraryRows(state).arrayValue!
            let current = rows.filter { $0["current"] == .bool(true) }
            XCTAssertEqual(current.count, 1)
            XCTAssertEqual(current[0]["id"], id == "nope" ? Config.policy["defaultLibrary"] : .string(id))
        }
    }

    // test/ui/library-switch.test.mjs — judgedChars: only judged (correct / wrong) records, deduped by char
    func testJudgedChars() {
        let records = [srec(1, cRen), srec(2, cRen, judgment: "wrong"), srec(3, cKou, kind: "answer-seen"), srec(4, cDa, kind: "skipped")]
        let state = ViewSupport.obj([("records", ViewSupport.obj([("2026-09", .array(records))]))])
        XCTAssertEqual(LibrarySwitchView.judgedChars(state).items, [cRen])
    }

    // test/ui/native-block.test.mjs — B3.13 blockReasonOf: unavailable / blocked / migration, and none when everything is fine
    func testBlockReasonOf() throws {
        XCTAssertEqual(BlockView.blockReasonOf(nil), try value(#"{"kind":"unavailable","detail":"no-store"}"#))
        XCTAssertEqual(BlockView.blockReasonOf(try value(#"{"available":false,"unavailableKind":"probe"}"#)), try value(#"{"kind":"unavailable","detail":"probe"}"#))
        XCTAssertEqual(BlockView.blockReasonOf(try value(#"{"available":true,"blocked":{"reason":"rollback"}}"#)), try value(#"{"kind":"blocked","detail":"rollback"}"#))
        let status = try value(#"{"available":true}"#)
        XCTAssertEqual(BlockView.blockReasonOf(status, migration: try value(#"{"reason":"v1"}"#)), try value(#"{"kind":"migration","detail":"v1"}"#))
        XCTAssertEqual(BlockView.blockReasonOf(status), .null)
    }

    // test/ui/library-switch.test.mjs — libraryRows: four rows in LIBRARIES order, names / descs from copy, n = keys in the library, m = judged chars in it
    func testLibraryRowsCountsAndOrder() throws {
        let records = [srec(1, cRen), srec(2, cKou, judgment: "wrong"), srec(3, cRen, judgment: "wrong"), srec(4, cDa), srec(5, cYong, kind: "answer-seen"), srec(6, cTian, kind: "skipped")]
        let state = ViewSupport.obj([("records", ViewSupport.obj([("2026-09", .array(records)), ("2026-08", ViewSupport.obj([("folded", .bool(true)), ("kept", .array([srec(7, cShui)]))]))]))])
        let ids = ["core3500", "adv3000", "rare", "curriculum2500"]
        let pools = [[cRen, cKou, cYong], [cDa, cTian], [cShui], [cRen, cKou]]
        let libraries = ViewSupport.obj(zip(ids, pools).map { id, chars in (id, ViewSupport.obj([("keys", .array(chars.map { .string("base:" + $0) }))])) })
        let rows = LibrarySwitchView.libraryRows(state, libraries: libraries).arrayValue!
        XCTAssertEqual(rows.map { $0["id"]! }, ids.map(JSValue.string))
        XCTAssertEqual(rows.map { $0["total"]! }, [3, 2, 1, 2].map { .number(Double($0)) })
        XCTAssertEqual(rows.map { $0["recorded"]! }, [2, 1, 1, 2].map { .number(Double($0)) })
        for (i, row) in rows.enumerated() {
            XCTAssertEqual(row["name"], ViewSupport.ref("R-L06.lib." + ids[i] + ".name"))
            XCTAssertEqual(row["desc"], ViewSupport.ref("R-L06.lib." + ids[i] + ".desc"))
            XCTAssertEqual(row["countLine"]?["params"]?["n"], row["total"])
            XCTAssertEqual(row["countLine"]?["params"]?["m"], row["recorded"])
        }
    }

}
