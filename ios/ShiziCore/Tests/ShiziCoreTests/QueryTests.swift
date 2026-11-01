import Foundation
import XCTest
@testable import ShiziCore

// test/core/query.test.mjs 的转写（18 个用例，用例名保留原名）。另有 query.json 金标准与随机差分逐条核对。

final class QueryTests: XCTestCase {
    let DAY = "2026-09-24"
    let AT = at43("2026-09-24", 10)
    let hao = "\u{597D}" // 好
    let ya = "\u{4E5D}" // 九（占位，未用）
    let sup = "\u{20000}" // 𠀀
    let kana = "\u{3042}" // あ
    let zero = "\u{3007}" // 〇
    let long = "\u{4E00}\u{4E8C}\u{4E09}\u{56DB}\u{4E94}\u{516D}\u{4E03}\u{516B}\u{4E5D}\u{5341}\u{767E}\u{5343}\u{4E07}" // 一二三四五六七八九十百千万
    let ju = "\u{9F98}" // 龘
    let quoteL = "\u{300C}", quoteR = "\u{300D}"

    func qrec(_ id: String, _ char: String, _ kind: String = "judged", _ judgment: String = "correct", _ localDay: String? = nil) -> JSValue {
        var pairs: [(String, JSValue)] = [("id", s43(id)), ("cardKey", s43("base:" + char)), ("char", s43(char)), ("sessionId", s43("s1")), ("kind", s43(kind)), ("at", n43(AT)),
                                          ("localDay", s43(localDay ?? DAY)), ("help", obj43([("hints", n43(0)), ("answerSeen", .bool(false)), ("traced", .bool(false))]))]
        if kind == "judged" { pairs.append(("judgment", s43(judgment))) }
        return obj43(pairs)
    }

    func filtered(_ text: String, max: JSValue? = nil) -> Query.Filtered { Query.filterInput(s43(text), max: max) }
    func copyT(_ key: String, _ vars: [(String, JSValue)] = []) throws -> String { try Copy.text(key, vars.isEmpty ? nil : JSObject(vars)) }

    // ---------------------------------------------------------------- 输入过滤（R-Q03 / P45）

    // test/core/query.test.mjs: filterInput: keeps Han only, dedupes in first-seen order, counts removed code points and duplicates
    func testFilterInputKeepsHanOnlyDedupesInFirstSeenOrderCountsRemovedCodePointsAndDuplicates() {
        let f = filtered(yong43 + "a" + he43 + "!" + yong43)
        XCTAssertEqual(f.chars, [yong43, he43])
        XCTAssertEqual(f.removed, 2)
        XCTAssertEqual(f.duplicates, [yong43])
        XCTAssertEqual(f.hanCount, 3)
        XCTAssertEqual(f.total, 5)
        XCTAssertEqual(f.overLimit, 0)
        let letters = filtered("abc 12")
        XCTAssertEqual(letters.chars, [])
        XCTAssertEqual(letters.removed, 6, "letters, digits and the space all count as removed")
        XCTAssertEqual(filtered("").chars, [])
        XCTAssertEqual(Query.filterInput(.null).total, 0, "non-string input -> empty")
        XCTAssertEqual(filtered(hao + hao + hao).duplicates, [hao], "each repeated char listed once")
    }

    // test/core/query.test.mjs: filterInput: supplementary-plane Han counts as one char; punctuation / kana are removed
    func testFilterInputSupplementaryPlaneHanCountsAsOneCharPunctuationKanaAreRemoved() {
        let f = filtered(sup + "\u{FF0C}" + yong43 + "\u{3002}" + kana)
        XCTAssertEqual(f.chars, [sup, yong43])
        XCTAssertEqual(f.removed, 3)
        XCTAssertTrue(Query.isHan(s43(sup)) && Query.isHan(s43(yong43)) && !Query.isHan(s43(kana)) && !Query.isHan(s43(yong43 + he43)) && !Query.isHan(s43("")))
        XCTAssertTrue(Query.containsHan(zero), "Script=Han (same predicate as the prototype)")
    }

    // test/core/query.test.mjs: filterInput: no hard cap by default (P45 queryInputMax=null); an explicit cap truncates the list and reports overLimit
    func testFilterInputNoHardCapByDefaultP45QueryInputMaxNullAnExplicitCapTruncatesTheListAndReportsOverLimit() {
        XCTAssertEqual(Config.policyValue("queryInputMax"), .null)
        XCTAssertEqual(filtered(long).chars.count, 13, "default: nothing truncated")
        let capped = filtered(long, max: n43(5))
        XCTAssertEqual(capped.chars, ["\u{4E00}", "\u{4E8C}", "\u{4E09}", "\u{56DB}", "\u{4E94}"])
        XCTAssertEqual(capped.overLimit, 8)
        XCTAssertEqual(filtered(long, max: n43(0)).chars.count, 13, "non-positive cap = no cap")
    }

    // test/core/query.test.mjs: filterNotes: the three R-Q03 notes, duplicates only in the rows view, several duplicates in one line
    func testFilterNotesTheThreeRQ03NotesDuplicatesOnlyInTheRowsViewSeveralDuplicatesInOneLine() throws {
        XCTAssertEqual(Query.filterNotes(filtered("abc"), view: "hint"), [J("{\"key\":\"R-Q03.onlyHanzi\"}")])
        XCTAssertEqual(Query.filterNotes(filtered(yong43 + "a" + he43 + "!" + yong43), view: "rows"), [
            J("{\"key\":\"R-Q03.removed\",\"vars\":{\"n\":2}}"),
            obj43([("key", s43("R-Q03.duplicate")), ("vars", obj43([("char", s43(yong43))]))]),
        ])
        XCTAssertEqual(Query.filterNotes(filtered(yong43 + he43 + yong43), view: "card"), [], "no duplicate note outside rows (prototype L428)")
        XCTAssertEqual(Query.filterNotes(filtered(yong43 + he43 + yong43 + he43), view: "rows"),
                       [obj43([("key", s43("X-QUERY.duplicateMany")), ("vars", obj43([("chars", s43(quoteL + yong43 + quoteR + quoteL + he43 + quoteR))]))])])
        XCTAssertEqual(Query.filterNotes(filtered(yong43 + he43), view: "rows"), [])
        XCTAssertEqual(Query.filterNotes(nil, view: "rows"), [])
        // 文案（文案表读生成的 copy.json；这里核对占位符填充与取用）
        XCTAssertEqual(try copyT("R-Q03.removed", [("n", n43(2))]).contains("2"), true)
        XCTAssertEqual(try copyT("R-Q03.duplicate", [("char", s43(yong43))]).contains(yong43), true)
        XCTAssertEqual(try copyT("X-QUERY.duplicateMany", [("chars", s43(quoteL + yong43 + quoteR + quoteL + he43 + quoteR))]).contains(quoteL + yong43 + quoteR), true)
        XCTAssertFalse(try copyT("R-Q03.onlyHanzi").isEmpty)
    }

    // ---------------------------------------------------------------- 能不能练、自选

    // test/core/query.test.mjs: isPracticable: 不能练 = not in the current library AND not in the deck; non-Han never practicable
    func testIsPracticableNotInTheCurrentLibraryAndNotInTheDeckNonHanNeverPracticable() {
        let bull = "\u{7287}"
        let inDeck: (String) -> Bool = { $0 == yong43 || $0 == bull }
        let inLibrary: (String) -> Bool = { $0 == yong43 }
        XCTAssertTrue(Query.isPracticable(s43(yong43), inDeck: inDeck, inLibrary: inLibrary))
        XCTAssertTrue(Query.isPracticable(s43(bull), inDeck: inDeck, inLibrary: inLibrary), "in deck, outside the current library -> still practicable")
        XCTAssertFalse(Query.isPracticable(s43(ju), inDeck: inDeck, inLibrary: inLibrary))
        XCTAssertFalse(Query.isPracticable(s43("a"), inDeck: { _ in true }, inLibrary: { _ in true }))
        XCTAssertFalse(Query.isPracticable(s43(yong43)), "no predicates -> not practicable")
    }

    // test/core/query.test.mjs: withCustomAdded: appends {char, at}; no-op (null) when already added; never mutates; result passes the schema
    func testWithCustomAddedAppendsCharAtNoOpNullWhenAlreadyAddedNeverMutatesResultPassesTheSchema() throws {
        let empty = try Query.withCustomAdded(.null, s43(yong43), n43(AT))!
        XCTAssertEqual(empty, obj43([("added", jsArray43([obj43([("char", s43(yong43)), ("at", n43(AT))])]))]))
        XCTAssertNil(Schema.validateValue(key: Schema.keyNamed("custom")!, value: empty), "custom shape valid")
        let frozen = obj43([("added", jsArray43([obj43([("char", s43(yong43)), ("at", n43(1))])])), ("note", s43("x"))])
        XCTAssertNil(try Query.withCustomAdded(frozen, s43(yong43), n43(AT)), "already in custom -> null, nothing to write")
        let next = try Query.withCustomAdded(frozen, s43(he43), n43(AT))!
        XCTAssertEqual(next, obj43([("added", jsArray43([obj43([("char", s43(yong43)), ("at", n43(1))]), obj43([("char", s43(he43)), ("at", n43(AT))])])), ("note", s43("x"))]))
        XCTAssertEqual(next.objectValue?.keys, ["added", "note"], "other keys kept in place")
        XCTAssertEqual(frozen["added"]?.arrayValue?.count, 1, "input untouched")
        XCTAssertThrowsCore("type") { _ = try Query.withCustomAdded(.null, s43("ab"), n43(AT)) }
        XCTAssertThrowsCore("type") { _ = try Query.withCustomAdded(.null, s43(yong43), n43(.nan)) }
        XCTAssertEqual(Query.customChars(next), [yong43, he43])
        XCTAssertTrue(Query.isCustom(next, he43) && !Query.isCustom(next, chun43) && !Query.isCustom(.null, yong43))
    }

    // ---------------------------------------------------------------- 记录情况（R-Q04 / R-Q05 / P43）

    // test/core/query.test.mjs: flattenRecords: month arrays and folded months (kept)
    func testFlattenRecordsMonthArraysAndFoldedMonthsKept() {
        let domain = obj43([("2026-08", jsArray43([qrec("r1", yong43)])), ("2026-09", obj43([("folded", .bool(true)), ("kept", jsArray43([qrec("r2", he43)]))])), ("bad", .null)])
        XCTAssertEqual(ids43(Query.flattenRecords(domain)), ["r1", "r2"])
        XCTAssertEqual(Query.flattenRecords(.null), [])
    }

    // test/core/query.test.mjs: charSummary: counts judged only; latest by id; custom flag; sched due
    func testCharSummaryCountsJudgedOnlyLatestByIdCustomFlagSchedDue() {
        let records = [qrec("r1", yong43, "judged", "wrong", "2026-09-20"), qrec("r2", yong43, "answer-seen"), qrec("r3", yong43, "skipped"),
                       qrec("r4", yong43, "judged", "correct", "2026-09-24"), qrec("r5", he43, "answer-seen")]
        let custom = obj43([("added", jsArray43([obj43([("char", s43(he43)), ("at", n43(AT))])]))])
        let sched = obj43([("base:" + yong43, obj43([("fsrs", obj43([])), ("due", s43("2026-10-01")), ("lastJudgedAt", n43(AT))]))])
        let sm = Query.charSummary(yong43, records: records, sched: sched, custom: custom, practicable: true)
        XCTAssertEqual(sm["cardKey"], s43("base:" + yong43))
        XCTAssertEqual(sm["count"], n43(2), "answer-seen / skipped are not records (01 §3.2)")
        XCTAssertEqual(sm["latest"]?["id"], s43("r4"))
        XCTAssertEqual(sm["latestDay"], s43("2026-09-24"))
        XCTAssertEqual(sm["due"], s43("2026-10-01"))
        XCTAssertEqual(sm["custom"], .bool(false))
        let h = Query.charSummary(he43, records: records, sched: sched, custom: custom, practicable: true)
        XCTAssertEqual(h["count"], n43(0))
        XCTAssertEqual(h["latest"], .null)
        XCTAssertEqual(h["custom"], .bool(true))
    }

    // test/core/query.test.mjs: rowStatus: 记录了 N 次 / 还没有记录 / 暂时不能练 / 自选的字 · … (P43 transitional wording)
    func testRowStatusRecordedNTimesNoRecordUnavailableCustomP43TransitionalWording() throws {
        func base(_ over: [(String, JSValue)] = []) -> JSValue {
            var o = JSObject([("char", s43(yong43)), ("practicable", .bool(true)), ("custom", .bool(false)), ("count", n43(0))])
            for (k, v) in over { o[k] = v }
            return .object(o)
        }
        XCTAssertEqual(Query.rowStatus(base([("count", n43(3))])), J("{\"key\":\"R-Q04.rowCount\",\"vars\":{\"n\":3}}"))
        XCTAssertEqual(Query.rowStatus(base()), J("{\"key\":\"R-Q04.rowNone\"}"))
        XCTAssertEqual(Query.rowStatus(base([("custom", .bool(true))])), J("{\"key\":\"R-Q04.rowCustomNone\"}"))
        XCTAssertEqual(Query.rowStatus(base([("custom", .bool(true)), ("count", n43(2))])), J("{\"key\":\"R-Q04.rowCustomCount\",\"vars\":{\"n\":2}}"))
        XCTAssertEqual(Query.rowStatus(base([("practicable", .bool(false)), ("custom", .bool(true)), ("count", n43(2))])), J("{\"key\":\"R-Q04.rowUnavailable\"}"), "unavailable wins")
        XCTAssertTrue(try copyT("R-Q04.rowCustomCount", [("n", n43(2))]).contains("2"))
        XCTAssertFalse(try copyT("R-Q04.rowCustomNone").isEmpty)
    }

    // test/core/query.test.mjs: cardStat: record line with date day, or 还没有记录
    func testCardStatRecordLineWithDateDayOrNoRecord() {
        XCTAssertEqual(Query.cardStat(obj43([("count", n43(2)), ("latestDay", s43(DAY))])), J("{\"key\":\"R-Q05.cardStat\",\"vars\":{\"n\":2,\"day\":\"\(DAY)\"}}"))
        XCTAssertEqual(Query.cardStat(obj43([("count", n43(0)), ("latestDay", .null)])), J("{\"key\":\"R-Q04.rowNone\"}"))
    }

    // ---------------------------------------------------------------- 视图与 pick 底栏（R-Q06）

    // test/core/query.test.mjs: queryView: hint → rows → card / bad; a single char opens its card; cur must still be in the input
    func testQueryViewHintRowsCardBadASingleCharOpensItsCardCurMustStillBeInTheInput() {
        let practicable: (String) -> Bool = { $0 != self.ju }
        func v(_ chars: [String], _ cur: String = "") -> [String] { let r = Query.queryView(chars: chars, cur: cur, practicable: practicable); return [r.view, r.cur] }
        XCTAssertEqual(v([]), ["hint", ""])
        XCTAssertEqual(v([yong43, he43]), ["rows", ""])
        XCTAssertEqual(v([yong43]), ["card", yong43])
        XCTAssertEqual(v([ju]), ["bad", ju])
        XCTAssertEqual(v([yong43, ju], ju), ["bad", ju])
        XCTAssertEqual(v([yong43, he43], chun43), ["rows", ""], "stale cur ignored")
    }

    // test/core/query.test.mjs: selectedChars: only chars still typed and practicable, in input order; nothing selected by default
    func testSelectedCharsOnlyCharsStillTypedAndPracticableInInputOrderNothingSelectedByDefault() {
        let practicable: (String) -> Bool = { $0 != self.ju }
        XCTAssertEqual(Query.selectedChars([yong43, he43], [], practicable: practicable), [], "typing selects nothing")
        XCTAssertEqual(Query.selectedChars([yong43, he43, ju], [he43, yong43, ju, chun43], practicable: practicable), [yong43, he43])
        XCTAssertEqual(Query.selectedChars([yong43], [yong43]), [yong43])
    }

    // test/core/query.test.mjs: pickBar: 0 →「先选字」disabled; 1 →「练这个字」; N →「练这 N 个字」
    func testPickBar0First1ThisChar() throws {
        XCTAssertSameJSON(Query.pickBar(n43(0)), J("{\"key\":\"R-Q06.btnNone\",\"disabled\":true}"))
        XCTAssertSameJSON(Query.pickBar(n43(1)), J("{\"key\":\"R-Q05.btnPractice\",\"disabled\":false}"))
        XCTAssertSameJSON(Query.pickBar(n43(3)), J("{\"key\":\"R-Q06.btnPracticeN\",\"vars\":{\"n\":3},\"disabled\":false}"))
        XCTAssertFalse(try copyT("R-Q06.btnNone").isEmpty)
        XCTAssertTrue(try copyT("R-Q06.btnPracticeN", [("n", n43(3))]).contains("3"))
    }

    // test/core/query.test.mjs: normalizeMode: only lookup / pick (P42: no add mode)
    func testNormalizeModeOnlyLookupPickP42NoAddMode() throws {
        XCTAssertEqual(Config.policyValue("queryModes"), arrayOf43(["lookup", "pick"]))
        XCTAssertEqual(try Query.normalizeMode(s43("lookup")), "lookup")
        XCTAssertEqual(try Query.normalizeMode(s43("pick")), "pick")
        XCTAssertThrowsCore("range") { _ = try Query.normalizeMode(s43("add")) }
        XCTAssertThrowsCore("range") { _ = try Query.normalizeMode(nil) }
    }

    // test/core/query.test.mjs: copy: every R-Q key the component uses exists (R-Q01–R-Q06 filled)
    func testCopyEveryRQKeyTheComponentUsesExistsRQ01RQ06Filled() {
        let keys = [
            "R-Q01.titleLookup", "R-Q01.titlePick", "R-Q01.placeholder", "R-Q02.pickNote", "R-Q02.lookupNote",
            "R-Q03.onlyHanzi", "R-Q03.removed", "R-Q03.duplicate", "R-Q04.rowCount", "R-Q04.rowNone", "R-Q04.rowUnavailable",
            "R-Q04.rowCustomNone", "R-Q04.rowCustomCount", "R-Q05.cardStat", "R-Q05.btnPractice", "R-Q05.btnAdd",
            "R-Q05.alreadyAdded", "R-Q05.addFailed", "R-Q05.retry", "R-Q05.cancel", "R-Q05.backToList",
            "R-Q05.unavailableTitle", "R-Q05.unavailableReason", "R-Q05.unavailableSource", "R-Q05.viewRecords",
            "R-Q06.btnPracticeN", "R-Q06.btnNone", "R-H06.saveFailed", "R-H06.cancel", "R-H06.retry",
            "X-QUERY.selectAria", "X-QUERY.unselectAria", "X-QUERY.cardMeta", "X-QUERY.duplicateMany",
        ]
        for k in keys { XCTAssertTrue(Copy.has(k), "copy key \(k)") }
    }

    // ---------------------------------------------------------------- 拼音查字（r7-Q1 / D3）

    func pyEntries() -> [JSValue] {
        let shi4 = "\u{662F}", shi2 = "\u{65F6}", shi10 = "\u{5341}", shi4b = "\u{4E8B}", nv = "\u{5973}", song = "\u{5B8B}"
        func e(_ c: String, _ py: String) -> JSValue { obj43([("char", s43(c)), ("key", s43(Query.pyKey(s43(py))))]) }
        return [e(shi4, "sh\u{EC}"), e(shi2, "sh\u{ED}"), e(shi10, "sh\u{ED}"), e(shi4b, "sh\u{EC}"), e(nv, "n\u{1DA}"), e(song, "s\u{F2}ng")]
    }

    // test/core/query.test.mjs: pyKey / parsePinyinInput: strip tones, v = ü, letters only; Han or digits are not pinyin
    func testPyKeyParsePinyinInputStripTonesVULettersOnlyHanOrDigitsAreNotPinyin() {
        XCTAssertEqual(Query.pyKey(s43("n\u{1DA}")), "nu")
        XCTAssertEqual(Query.pyKey(s43("nv")), "nu")
        XCTAssertEqual(Query.pyKey(s43("Sh\u{ED}")), "shi")
        XCTAssertEqual(Query.parsePinyinInput(s43(" sh\u{ED} ")), obj43([("raw", s43("sh\u{ED}")), ("query", s43("shi"))]))
        XCTAssertEqual(Query.parsePinyinInput(s43("xi'an")), obj43([("raw", s43("xi'an")), ("query", s43("xian"))]))
        XCTAssertNil(Query.parsePinyinInput(s43(yong43)))
        XCTAssertNil(Query.parsePinyinInput(s43("shi" + yong43)))
        XCTAssertNil(Query.parsePinyinInput(s43("a1")))
        XCTAssertNil(Query.parsePinyinInput(s43("")))
        XCTAssertNil(Query.parsePinyinInput(s43("  ")))
    }

    // test/core/query.test.mjs: pinyinMatches: exact reading first else prefix; written chars first, then deck (frequency) order
    func testPinyinMatchesExactReadingFirstElsePrefixWrittenCharsFirstThenDeckFrequencyOrder() {
        let shi4 = "\u{662F}", shi2 = "\u{65F6}", shi10 = "\u{5341}", shi4b = "\u{4E8B}", nv = "\u{5973}", song = "\u{5B8B}"
        let entries = pyEntries()
        XCTAssertEqual(Query.pinyinMatches("shi", entries), [shi4, shi2, shi10, shi4b])
        XCTAssertEqual(Query.pinyinMatches("shi", entries, written: [shi10, shi4b]), [shi10, shi4b, shi4, shi2])
        XCTAssertEqual(Query.pinyinMatches("s", entries), [shi4, shi2, shi10, shi4b, song], "no exact reading -> prefix")
        XCTAssertEqual(Query.pinyinMatches("nu", entries), [nv])
        XCTAssertEqual(Query.pinyinMatches("zzz", entries), [])
        let many = (0..<(Query.pinyinMax + 20)).map { obj43([("char", s43(String(Unicode.Scalar(0x4E00 + $0)!))), ("key", s43("shi"))]) }
        XCTAssertEqual(Query.pinyinMatches("shi", many).count, Query.pinyinMax, "capped")
    }

    // test/core/query.test.mjs: writtenChars: chars with a judged record
    func testWrittenCharsCharsWithAJudgedRecord() {
        let shi10 = "\u{5341}", shi4 = "\u{662F}"
        let recs = [obj43([("cardKey", s43("base:" + shi10)), ("kind", s43("judged")), ("judgment", s43("correct")), ("char", s43(shi10))]),
                    obj43([("cardKey", s43("base:" + shi4)), ("kind", s43("other")), ("char", s43(shi4))])]
        XCTAssertEqual(Query.writtenChars(recs), [shi10])
    }
}
