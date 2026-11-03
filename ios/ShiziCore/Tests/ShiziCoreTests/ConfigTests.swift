import Foundation
import XCTest
@testable import ShiziCore

// 配置域的转写（B4.1）：test/core/epigraphs.test.mjs（3）、policy-mix.test.mjs（2）、policy.test.mjs（11）、dates.test.mjs 的落款汉字数字与文案取用（4）。
// 原测试里读 JS 源码 / 导入 UI 模块的部分在 Swift 里没有对应物，转成读生成的 policy-meta.json / policy.json 做同样的判定（每条的说明见注释）。

private let dates = Dates(timeZone: TimeZone(identifier: "Asia/Shanghai")!)

/// 解析 JSON 字面量并与 Config 里的值比较（按值，不看键序）。
private func assertPolicy(_ path: String, _ json: String, _ message: String = "", file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertEqual(Config.policyValue(path), J(json, file: file, line: line), message.isEmpty ? path : message, file: file, line: line)
}

final class ConfigEpigraphTests: XCTestCase {
    // epigraphs: verbatim from the prototype home shell L141 QUOTES
    func testEpigraphsVerbatimFromThePrototypeHomeShellL141QUOTES() throws {
        let text = try readRepoFile("docs/design/v10/extracted/\u{9996}\u{9875}\u{58F3}-v3-\u{7B2C}\u{5341}\u{7A3F}\u{4EA4}\u{63A5}\u{7248}.dc.html")
        let line = text.split(separator: "\n", omittingEmptySubsequences: false)[140]
        XCTAssertTrue(line.contains("const QUOTES=["), "L141 still defines QUOTES")
        // 原型里 QUOTES 是 JS 字面量 [{q:['上句','下句'],src:'出处'}, ...]：按出现顺序取全部单引号串 = 上句、下句、出处 × 3。
        var literals: [String] = []
        var cur: String?
        for ch in line {
            if ch == "'" {
                if let c = cur { literals.append(c); cur = nil } else { cur = "" }
            } else if cur != nil {
                cur!.append(ch)
            }
        }
        XCTAssertEqual(literals.count, 9)
        XCTAssertEqual(Epigraphs.all.count, 3)
        for (i, e) in Epigraphs.all.enumerated() {
            XCTAssertEqual(e.lines, [literals[i * 3], literals[i * 3 + 1]], "lines \(i)")
            XCTAssertEqual(e.source, literals[i * 3 + 2], "source \(i)")
        }
    }

    // epigraphs: each couplet has two halves of equal length
    // （原用例另断言导出对象被 Object.freeze；Swift 的 let / 值类型已保证只读，不再断言）
    func testEpigraphsEachCoupletHasTwoHalvesOfEqualLength() {
        for e in Epigraphs.all {
            XCTAssertEqual(e.lines.count, 2)
            XCTAssertEqual(e.lines[0].unicodeScalars.count, e.lines[1].unicodeScalars.count, e.lines.joined())
        }
    }

    // epigraphs: rotate by day of year mod 3 (P23; 9月24日 = 267 → first)
    func testEpigraphsRotateByDayOfYearMod3() throws {
        func index(_ day: String) throws -> Double { try Epigraphs.indexFor(day: .string(day), dates: dates) }
        func epigraph(_ day: String) throws -> Epigraph { try Epigraphs.epigraph(for: .string(day), dates: dates) }
        XCTAssertEqual(try index("2026-09-24"), Double(267 % 3))
        XCTAssertEqual(try epigraph("2026-09-24"), Epigraphs.all[0])
        XCTAssertEqual(try epigraph("2026-09-25"), Epigraphs.all[1])
        XCTAssertEqual(try epigraph("2026-09-26"), Epigraphs.all[2])
        var seen = Set<Int>()
        for i in 0..<30 {
            let day = try dates.addDays(.string("2026-09-24"), Double(i))
            XCTAssertEqual(try epigraph(day), try epigraph(day), "stable within a day")
            seen.insert(Int(try index(day)))
        }
        XCTAssertEqual(seen.sorted(), [0, 1, 2])
    }
}

final class ConfigPolicyTests: XCTestCase {
    // policy D41: groupMix (P125) matches the recommendation in 复习新字配比-研究与推荐.md §6.1
    func testPolicyD41GroupMixP125MatchesTheRecommendation() {
        assertPolicy("groupMix", #"""
        {"baseSize":5,"newMax":3,"threeNewBelowDays":0.5,"threeNewMinAccuracy":0.6,"twoNewBelowDays":1.5,"valveDays":4,"valveReleaseDays":2,"reviewsPerGroupForPressure":4,
         "pressureWindowDays":7,"recentNewWindow":10,"newAccuracyPrior":0.5,"allAccuracyPrior":0.7,"accuracyPriorWeight":2,"returnAfterDays":7,"returnGroupSize":3,
         "earlyReviewFill":true,"earlyCountsTowardCap":false,"earlyFillWhenExhausted":false}
        """#)
        XCTAssertEqual(Config.policyNumber("groupMix.baseSize"), 5, "the counts are written for groups of 5 and scaled by size / 5 (D65 #2)")
        XCTAssertEqual(Config.policyNumber("groupSize"), 15, "D83: default per-group size 15")
        assertPolicy("groupSizeOptions", "[5,10,15,20,30]")
        XCTAssertEqual(Config.policyNumber("dailyReviewCap"), 30, "P03 stays as a safety net")
    }

    // policy D41: warmup gate (P126) and first-correct rating (P127)
    func testPolicyD41WarmupGateP126AndFirstCorrectRatingP127() {
        assertPolicy("warmup", #"{"mode":"gated","firstDays":7,"accuracyBelow":0.6,"window":10,"perGroupMax":1,"easyOnCorrect":true}"#)
        XCTAssertEqual(Config.policyString("ratingFirstCorrect"), "Easy")
        assertPolicy("ratingWithHint.first", #"["Good","Hard","Again"]"#, "P34 D65 #4 / D66 ②")
        assertPolicy("ratingWithHint.review", #"["Hard","Again","Again"]"#, "P34 D65 #4 / D66 ②")
        XCTAssertEqual(Config.policyString("answerSeenRating"), "Again", "P321 D66 ①")
    }

    // policy: `node -e "import('./src/config/policy.js')"` loads
    // （Swift 对应：生成的 policy.json 能读出来，且有 groupSize）
    func testPolicyLoads() {
        XCTAssertFalse((Config.policy.objectValue ?? JSObject()).isEmpty)
        XCTAssertNotNil(Config.policyNumber("groupSize"))
    }

    // policy: 03 registers P01–P61 (incl. P10b); the table only grows
    // （原用例另测 registeredPNumbers 解析函数本身——它是 verify_copy.mjs 里读 03 表的 JS 函数，没有 Swift 对应物，留在 node）
    func testPolicy03RegistersP01P61InclP10bTheTableOnlyGrows() {
        let registered = PolicyCoverage.registered
        for n in 1...61 { XCTAssertTrue(registered.contains("P" + (n < 10 ? "0" : "") + String(n)), "P\(n) registered in 03") }
        XCTAssertTrue(registered.contains("P10b"))
        XCTAssertGreaterThanOrEqual(registered.count, 62, "P01–P61 + P10b at least")
    }

    // policy: every export and every nested key carries a registered P number
    func testPolicyEveryExportAndEveryNestedKeyCarriesARegisteredPNumber() {
        let registered = PolicyCoverage.registered
        XCTAssertEqual(PolicyCoverage.errors(pMap: PolicyCoverage.pMap, registered: registered), [])
        // 解析器看到了每一个运行时导出（生成时 checkPolicy 已核对一次，这里再对 policy.json 核对）
        XCTAssertEqual(PolicyCoverage.pMap.keys.sorted(), (Config.policy.objectValue?.keys ?? []).sorted(), "parser saw every runtime export")
        // 解析到的嵌套键都是 policy.json 里真有的键（解析器只认标识符形的键、一行写完的对象不展开，所以是子集）
        for e in PolicyCoverage.pMap.entries {
            if case .object(let o)? = Config.policy[e.key], let keys = e.value["keys"]?.objectValue {
                for k in keys.keys { XCTAssertNotNil(o[k], "nested key \(e.key).\(k)") }
            }
        }
    }

    // policy: the check catches an export without a P number
    func testPolicyTheCheckCatchesAnExportWithoutAPNumber() {
        var map = PolicyCoverage.pMap
        guard case .object(var entry)? = map["hintUseGroups"] else { return XCTFail("hintUseGroups missing") }
        entry["p"] = .array([])
        map["hintUseGroups"] = .object(entry)
        let errors = PolicyCoverage.errors(pMap: map, registered: PolicyCoverage.registered)
        XCTAssertTrue(errors.contains { $0.hasPrefix("policy.hintUseGroups") }, errors.joined(separator: "\n"))
    }

    // policy: the check catches a nested key without a P number and an unregistered P
    func testPolicyTheCheckCatchesANestedKeyWithoutAPNumberAndAnUnregisteredP() {
        let registered = PolicyCoverage.registered
        var map = PolicyCoverage.pMap
        guard case .object(var features)? = map["features"], case .object(var keys)? = features["keys"] else { return XCTFail("features missing") }
        keys["milestones"] = .array([])
        features["keys"] = .object(keys)
        map["features"] = .object(features)
        XCTAssertTrue(PolicyCoverage.errors(pMap: map, registered: registered).contains { $0.contains("features.milestones") })
        // 哨兵编号取 03 里还没登记的
        var n = 99
        while registered.contains("P\(n)") { n += 1 }
        let sentinel = "P\(n)"
        var map2 = PolicyCoverage.pMap
        guard case .object(var entry)? = map2["hintUseGroups"] else { return XCTFail("hintUseGroups missing") }
        entry["p"] = .array([.string(sentinel)])
        map2["hintUseGroups"] = .object(entry)
        XCTAssertTrue(PolicyCoverage.errors(pMap: map2, registered: registered).contains { $0.contains(sentinel) }, sentinel)
    }

    // policy: every P in 03 is covered by policy.js, a copy decision or a non-runtime note
    func testPolicyEveryPIn03IsCoveredByPolicyACopyDecisionOrANonRuntimeNote() {
        let uncovered = PolicyCoverage.registered.subtracting(PolicyCoverage.covered)
        XCTAssertTrue(uncovered.isEmpty, "registered in 03 but not covered: \(uncovered.sorted())")
    }

    // policy: transitional defaults match 03 / the M0-6 card
    func testPolicyTransitionalDefaultsMatch03AndTheM06Card() {
        let policy = Config.policy
        XCTAssertEqual(Config.policyNumber("groupSize"), 15) // D83（原 D65 #2 的 20）
        assertPolicy("groupSizeOptions", "[5,10,15,20,30]") // P314 / D83
        XCTAssertEqual(Config.policyNumber("dailyReviewCap"), 30)
        assertPolicy("firstQueue", #"["\u5c34","\u8d62","\u62fe"]"#, "P09 decided D38: first queue is 3 chars")
        XCTAssertNil(policy["hintMax"], "P17 decided D64: no hint cap")
        XCTAssertEqual(["base", "lo", "hi", "pressureLo", "pressureGain", "pressureHi"].map { Config.policyNumber("ink." + $0) }, [11.5, 0.25, 0.9, 0.58, 0.94, 1.52], "P65 ink hand-feel constants")
        XCTAssertNil(policy["hintStartRule"], "P01 decided D64")
        XCTAssertEqual(Config.policyBool("hintUseGroups"), false)
        XCTAssertEqual(Config.policyString("forgetRule"), "due")
        XCTAssertEqual(Config.policyNumber("forgetCap"), 12)
        XCTAssertEqual(Config.policyString("customIntoDaily"), "none")
        XCTAssertEqual(Config.policyString("answerSeenScope"), "today") // D65 #5
        assertPolicy("ratingWithHint.review", #"["Hard","Again","Again"]"#) // D66 ②
        XCTAssertEqual(Config.policyString("answerSeenRating"), "Again") // D66 ①
        XCTAssertEqual(Config.policyNumber("dayStartHour"), 4) // D66 ⑦
        XCTAssertEqual(Config.policyString("skipScope"), "today") // D65 #5
        XCTAssertEqual(Config.policyNumber("skipNewDeferDays"), 7)
        XCTAssertEqual(Config.policyString("dailyExpiry"), "discard")
        XCTAssertEqual(Config.policyString("s02EndOld"), "toast")
        XCTAssertEqual(Config.policyString("monthSheetPick"), "first")
        XCTAssertEqual(Config.policyNumber("inkBudgetBytes"), 1.5 * 1024 * 1024)
        XCTAssertEqual(Config.policyNumber("recordsBudgetBytes"), 1.5 * 1024 * 1024)
        XCTAssertEqual(Config.policyString("migration.legacyHintedAs"), "none")
        XCTAssertEqual(Config.policyBool("features.perRecordInk"), true, "P31 decided D27")
        XCTAssertEqual(Config.policyBool("features.soundscape"), false)
        XCTAssertEqual(Config.policyString("defaultLibrary"), "core3500", "P73 default library")
        XCTAssertEqual(Config.policyBool("features.difficultyFeedback"), false)
        XCTAssertEqual(Config.policyBool("features.nextReviewLine"), false) // D83 ⑦ 不显示「下次见」
        // M0 验收修复 F4：P56–P61
        assertPolicy("inkToneDays", "[7,30,90]", "P56")
        XCTAssertEqual(Config.policyNumber("storageWarnRatio"), 0.8, "P57")
        XCTAssertEqual(Config.policyNumber("assumedQuotaBytes"), 5 * 1024 * 1024, "P57")
        XCTAssertNil(policy["homeShowRecordWhileResume"], "P16 decided by the stage-1 home design (P1-E5)")
        XCTAssertNil(policy["inkRowCompactMax"], "P75 decided by the stage-1 home design (P1-E5)")
        XCTAssertNil(policy["darkLampLevel"], "P58 decided D43: the dark warm lamp is cancelled")
        XCTAssertNil(policy["darkBrightenStep"], "P58 decided D43")
        XCTAssertNil(policy["largeTextScale"], "P59 decided D29")
        assertPolicy("contentSizeScale", #"{"xS":0.82,"S":0.88,"M":0.94,"L":1,"XL":1.12,"XXL":1.24,"XXXL":1.35,"AX1":1.6,"AX2":1.8,"AX3":2,"AX4":2.2,"AX5":2.4}"#, "P130 Dynamic Type mapping (D29)")
        XCTAssertEqual(Config.policyNumber("compactTextScale"), 1.3, "P131")
        XCTAssertEqual(Config.policyBool("dailyCapCountsPicked"), true, "P60")
        assertPolicy("sessionExpiry", #"{"first":"never","picked":"never"}"#, "P61")
        // M2-H：P69 / P70 迁入 policy（值不变）
        XCTAssertEqual(Config.policyNumber("compactMaxHeight"), 760, "P69")
        assertPolicy("mainButtonLine", #"{"gapAboveEdge":24}"#, "P258")
        XCTAssertEqual(Config.policyNumber("writeGrid.footBottomMin"), 24, "P298 / audit P1-15")
        assertPolicy("writeGrid", #"""
        {"min":258,"max":400,"sideMargin":20,"promptGap":16,"toolsHeight":40,"toolRowHeight":48,"axMin":220,"axNoteHeight":56,
         "axAux":{"pinyin":[22,28],"note":[17,22],"progress":[17,22],"title":[17,22],"links":[17,22],"paper":[22,28]},
         "promptFitMin":0.6,"fitGridMin":180,"axPromptScaleMax":1.6,"bottomGap":16,"topShare":0.4,"topMin":12,"nominalHead":44,"nominalFoot":134,"footBottomMin":24,"nominalPrompt":80}
        """#, "P118 D36 / D49")
        assertPolicy("motion", #"{"answerSpeed":1.6,"answerStrokeGapMs":180,"answerFadeMs":220,"hintStrokeMs":220,"hintStagger":0.7,"reducedFadeMs":150,"persistNoticeMs":5000,"hintFadeInMs":150,"answerRevealMs":400,"stepPlayMaxMs":1600}"#, "P70 + P210")
    }

    // policy: --k defaults to 1 = contentSizeScale.L (P130); the P58 lamp token is gone (D43)
    // （D84：网页 tokens.css 不再是来源，改读 ShiziKitTokens.json）
    func testPolicyKDefaultsTo1EqualsContentSizeScaleLTheP58LampTokenIsGone() throws {
        // D84：网页的 tokens.css 不再是来源，改读手改的 ShiziKitTokens.json：L 档（系统默认字号）的 k = 1，颜色里没有 lamp（P58 已撤）。
        let data = try Data(contentsOf: repoRoot.appendingPathComponent("ios/ShiziApp/ShiziApp/ShiziKit/Generated/ShiziKitTokens.json"))
        let root = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let categories = try XCTUnwrap((root["type"] as? [String: Any])?["categories"] as? [String: Any])
        XCTAssertEqual((categories["L"] as? [String: Any])?["k"] as? Double, 1, "ShiziKitTokens.json type.categories.L.k = 1")
        let colors = try XCTUnwrap(root["colors"] as? [String: Any])
        for theme in ["light", "dark"] {
            let table = try XCTUnwrap(colors[theme] as? [String: Any])
            XCTAssertFalse(table.keys.contains { $0.contains("lamp") }, "no lamp colour in \(theme)")
        }
        XCTAssertEqual(Config.policyNumber("contentSizeScale.L"), 1, "system default size maps to the same 1")
    }

    // policy: exported objects and arrays are frozen
    // （JS 的 Object.freeze 在 Swift 里由 let + 值类型保证；这里核对「改一份副本不影响全局配置」）
    func testPolicyExportedObjectsAndArraysAreFrozen() {
        guard case .object(var copy)? = Config.policy["features"] else { return XCTFail("features missing") }
        copy["perRecordInk"] = .bool(false)
        XCTAssertEqual(Config.policyBool("features.perRecordInk"), true, "mutating a copy never changes the shared policy")
    }

    // policy: core modules do not hard-code transitional values that live in policy.js
    // （Swift 对应：ShiziCore 的 Swift 源码里没有「尴」字面量，也没有重新声明 policy 数字）
    func testPolicyCoreModulesDoNotHardCodeTransitionalValuesThatLiveInPolicy() throws {
        let dir = repoRoot.appendingPathComponent("ios/ShiziCore/Sources/ShiziCore")
        let files = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: nil)?.compactMap { $0 as? URL }.filter { $0.pathExtension == "swift" } ?? []
        XCTAssertGreaterThan(files.count, 10)
        for f in files {
            // 去掉行内注释再查（注释可以写汉字，字面量不行）
            let text = String(decoding: try Data(contentsOf: f), as: UTF8.self).split(separator: "\n", omittingEmptySubsequences: false)
                .map { line -> String in line.range(of: "//").map { String(line[..<$0.lowerBound]) } ?? String(line) }.joined(separator: "\n")
            XCTAssertFalse(text.unicodeScalars.contains { $0.value == 0x5C34 }, f.lastPathComponent + " repeats firstQueue")
            XCTAssertNil(text.range(of: #"\b(?:dailyReviewCap|groupSize|hintMax|forgetCap)\s*=\s*\d"#, options: .regularExpression), f.lastPathComponent + " re-declares a policy number")
            // 原生源码不写汉字字面量（B3B4 通用说明）
            XCTAssertFalse(text.unicodeScalars.contains { (0x4E00...0x9FFF).contains($0.value) }, f.lastPathComponent + " has a CJK literal")
        }
    }

    // policy: P69 / P70 modules read their defaults from policy.js (M2-H)
    // （原用例导入 UI 模块核对它们取 policy 的值——UI 模块是 JS 专属，留在 node；这里转写其数据部分：被取用的 policy 值）
    func testPolicyP69P70ModulesReadTheirDefaultsFromPolicy() {
        XCTAssertEqual(Config.policyNumber("compactMaxHeight"), 760)
        XCTAssertEqual("(max-height: \(Int(Config.policyNumber("compactMaxHeight")!))px)", "(max-height: 760px)")
        XCTAssertEqual(Config.policyNumber("writeGrid.min"), 258)
        XCTAssertEqual(Config.policyNumber("writeGrid.max"), 400)
        XCTAssertEqual(Config.policyNumber("motion.answerSpeed"), 1.6)
        XCTAssertEqual(Config.policyNumber("motion.answerStrokeGapMs"), 180)
        XCTAssertEqual(Config.policyNumber("motion.answerFadeMs"), 220)
        XCTAssertEqual(Config.policyNumber("motion.hintStrokeMs"), 220)
        XCTAssertEqual(Config.policyNumber("motion.hintStagger"), 0.7)
        XCTAssertEqual(Config.policyNumber("motion.reducedFadeMs"), 150)
        XCTAssertEqual(Config.policyNumber("motion.persistNoticeMs"), 5000)
    }
}

final class ConfigDatesTests: XCTestCase {
    private let N = CNNumerals.shared
    private var TEN: String { N.units[1] }
    private var HUNDRED: String { N.units[2] }
    private var THOUSAND: String { N.units[3] }
    /// 把「数字串」按位翻成汉字（0–9 → digits）。
    private func digits(_ s: String) -> String { s.unicodeScalars.map { N.digits[Int($0.value) - 0x30] }.joined() }

    // dates: period words and date line come from copy (R-H02)
    func testDatesPeriodWordsAndDateLineComeFromCopy() throws {
        let words = try Dates.periods.map { try Copy.text("R-H02.period." + $0) }
        XCTAssertEqual(words, ["\u{65E9}\u{4E0A}", "\u{4E2D}\u{5348}", "\u{508D}\u{665A}", "\u{665A}\u{4E0A}"])
        let parts = try XCTUnwrap(try dates.monthDayParts(.string("2026-09-24")).objectValue)
        let date = try Copy.text("R-H02.dateFormat", parts)
        XCTAssertEqual(date, "9\u{6708}24\u{65E5}")
        let period = try Copy.text("R-H02.period." + (try Dates.periodOfHour(20)))
        XCTAssertEqual(try Copy.text("R-H02.line", JSObject([("date", .string(date)), ("period", .string(period))])), "9\u{6708}24\u{65E5} \u{B7} \u{665A}\u{4E0A}")
    }

    // dates: cnNumber counts in Chinese numerals (signature only)
    func testDatesCnNumberCountsInChineseNumeralsSignatureOnly() throws {
        let d = N.digits, zero = N.zero
        let cases: [(Double, String)] = [
            (0, d[0]), (1, d[1]), (9, d[9]), (10, TEN), (11, TEN + d[1]), (20, d[2] + TEN), (22, d[2] + TEN + d[2]), (80, d[8] + TEN),
            (100, d[1] + HUNDRED), (105, d[1] + HUNDRED + zero + d[5]), (110, d[1] + HUNDRED + d[1] + TEN), (1000, d[1] + THOUSAND),
            (2026, d[2] + THOUSAND + zero + d[2] + TEN + d[6]),
        ]
        for (n, s) in cases { XCTAssertEqual(try Dates.cnNumber(n), s, String(n)) }
        XCTAssertThrowsError(try Dates.cnNumber(-1)) { XCTAssertEqual(($0 as? CoreError)?.code, "range") }
        XCTAssertThrowsError(try Dates.cnNumber(1.5)) { XCTAssertEqual(($0 as? CoreError)?.code, "range") }
    }

    // dates: cnCount reads 2 as 两 for quantities (D36), other numbers as cnNumber
    func testDatesCnCountReads2AsLiangForQuantitiesOtherNumbersAsCnNumber() throws {
        let d = N.digits, zero = N.zero, two = N.two
        let cases: [(Double, String)] = [
            (0, d[0]), (1, d[1]), (2, two), (3, d[3]), (12, TEN + d[2]), (22, d[2] + TEN + d[2]), (102, d[1] + HUNDRED + zero + d[2]),
            (200, two + HUNDRED), (202, two + HUNDRED + zero + d[2]), (220, two + HUNDRED + d[2] + TEN), (2000, two + THOUSAND),
            (2200, two + THOUSAND + d[2] + HUNDRED), (2026, two + THOUSAND + zero + d[2] + TEN + d[6]),
        ]
        for (n, s) in cases { XCTAssertEqual(try Dates.cnCount(n), s, String(n)) }
        XCTAssertThrowsError(try Dates.cnCount(-1)) { XCTAssertEqual(($0 as? CoreError)?.code, "range") }
        let date = try Copy.text("R-I01.signatureDate", try XCTUnwrap(try dates.signatureDateParts(.string("2026-09-24")).objectValue))
        let kuanCount = try Copy.text("X-WORK.kuanCount", JSObject([("n", .string(try Dates.cnCount(2)))]))
        XCTAssertEqual(try Copy.text("X-WORK.kuanJoin", JSObject([("date", .string(date)), ("n", .string(kuanCount))])),
                       "\u{4E8C}\u{3007}\u{4E8C}\u{516D}\u{5E74}\u{4E5D}\u{6708}\u{4E8C}\u{5341}\u{56DB}\u{65E5}\u{3000}\u{4E24}\u{5B57}")
    }

    // dates: signature parts produce the paper-seal date with copy templates
    func testDatesSignaturePartsProduceThePaperSealDateWithCopyTemplates() throws {
        XCTAssertEqual(try Dates.cnDigits(2026), digits("2026"))
        XCTAssertEqual(try dates.signatureDateParts(.string("2026-09-24")),
                       .object(JSObject([("year", .string(digits("2026"))), ("month", .string(N.digits[9])), ("day", .string(N.digits[2] + TEN + N.digits[4]))])))
        let dateParts = try XCTUnwrap(try dates.signatureDateParts(.string("2026-09-24")).objectValue)
        XCTAssertEqual(try Copy.text("R-I01.signatureDate", dateParts), "\u{4E8C}\u{3007}\u{4E8C}\u{516D}\u{5E74}\u{4E5D}\u{6708}\u{4E8C}\u{5341}\u{56DB}\u{65E5}")
        let monthParts = try XCTUnwrap(try dates.signatureMonthParts(.string("2026-09")).objectValue)
        let month = try Copy.text("R-I01.signatureMonth", monthParts)
        XCTAssertEqual(month, "\u{4E8C}\u{3007}\u{4E8C}\u{516D}\u{5E74}\u{4E5D}\u{6708}")
        let kuanCount = try Copy.text("X-WORK.kuanCount", JSObject([("n", .string(try Dates.cnNumber(80)))]))
        XCTAssertEqual(try Copy.text("X-WORK.kuanJoin", JSObject([("date", .string(month)), ("n", .string(kuanCount))])),
                       "\u{4E8C}\u{3007}\u{4E8C}\u{516D}\u{5E74}\u{4E5D}\u{6708}\u{3000}\u{516B}\u{5341}\u{5B57}")
    }
}
