import Foundation
import XCTest
@testable import ShiziCore

// test/core/cards.test.mjs 的转写（12 个用例，用例名保留原名）。题面字串读生成的 card-rules.json；其余汉字用转义。
// 另有 cards.json 金标准（题库每隔 7 行 + 全部有语境覆盖的行）与 deck.cardsOfRow 的随机差分逐字段、逐键序核对。

final class CardsTests: XCTestCase {
    static let seed = DeckData.shared.seed
    static let overrides = JSValue.object(DeckData.shared.overrides)
    static let cards: [JSValue] = try! Cards.buildCards(seed: seed, overrides: overrides)
    static let rawCards: [JSValue] = try! Cards.buildCards(seed: seed, overrides: .object(JSObject()))

    static func byTarget(_ list: [JSValue]) -> OMap<JSValue> {
        var m = OMap<JSValue>()
        for c in list { if let t = c["target"]?.stringValue, !m.has(t) { m[t] = c } }
        return m
    }
    static let withOverrides = byTarget(cards)
    static let withoutOverrides = byTarget(rawCards)

    let yue = "\u{8D8A}" // 越
    let lai = "\u{6765}" // 来
    let manC = "\u{6162}" // 慢
    let geng = "\u{803F}" // 耿
    let ta = "\u{5979}" // 她
    let niang = "\u{5A18}" // 娘
    let yu = "\u{6B24}" // 欤
    let ha = "\u{54C8}" // 哈
    let zi = "\u{5B57}" // 字
    let huan = "\u{FF1F}" // ？
    var copy: JSObject { CardRules.promptCopy }

    func card(_ t: String, raw: Bool = false) -> JSValue { (raw ? Self.withoutOverrides : Self.withOverrides)[t]! }
    func seedRow(_ t: String) -> JSValue { Self.seed.first { $0["target"]?.stringValue == t }! }

    // test/core/cards.test.mjs: cards.js is a pure module (no browser globals, storage or network)
    func testCardsJsIsAPureModuleNoBrowserGlobalsStorageOrNetwork() throws {
        // Swift 对应：卡片规则源码只依赖 Foundation，不碰 UI / 存储 / 网络框架
        for rel in ["Cards/Cards.swift", "Query/Query.swift", "Records/Records.swift", "Records/WorkMembers.swift", "Records/InkPick.swift", "Records/FirstResult.swift", "Records/Reminder.swift",
                    "Structure/Structure.swift", "Ink/InkMath.swift", "Ink/JSMath.swift"] {
            let src = try readRepoFile("ios/ShiziCore/Sources/ShiziCore/" + rel)
            for forbidden in ["import UIKit", "import SwiftUI", "import WebKit", "import SQLite", "URLSession", "UserDefaults", "FileManager", "import CoreGraphics"] {
                XCTAssertFalse(src.contains(forbidden), rel + " uses " + forbidden)
            }
            let imports = src.split(separator: "\n").filter { $0.hasPrefix("import ") }.map(String.init)
            XCTAssertEqual(imports, ["import Foundation"], rel)
        }
    }

    // test/core/cards.test.mjs: buildCards yields one card per SEED row: 7218 unique targets
    func testBuildCardsYieldsOneCardPerSEEDRow7218UniqueTargets() {
        XCTAssertEqual(Self.seed.count, 7218)
        XCTAssertEqual(Self.cards.count, 7218)
        XCTAssertEqual(Set(Self.cards.map { $0["target"]?.stringValue ?? "" }).count, 7218)
        XCTAssertEqual(Self.cards.map { $0["target"] }, Self.seed.map { $0["target"] }, "SEED order preserved")
        XCTAssertEqual(Self.rawCards.count, 7218)
    }

    // test/core/cards.test.mjs: card fields and key order match the legacy CARDS construction
    func testCardFieldsAndKeyOrderMatchTheLegacyCARDSConstruction() throws {
        let legacy = ["word", "chars", "ci", "target", "py", "hint", "rank", "strokes", "parts", "topic", "d", "band", "edu", "common", "norm", "std", "ctx"]
        for c in Self.cards {
            let keys = c.objectValue!.keys
            XCTAssertEqual(Array(keys.prefix(legacy.count)), legacy, c["target"]?.stringValue ?? "")
            XCTAssertTrue(keys.count == legacy.count || (keys.count == legacy.count + 1 && keys.last == "promptHint"), c["target"]?.stringValue ?? "")
            XCTAssertEqual(c["chars"]?.arrayValue?.compactMap { $0.stringValue }.joined(), c["word"]?.stringValue)
            let ci = Int(c["ci"]!.numberValue!)
            XCTAssertEqual(c["chars"]?.arrayValue?[ci], c["target"])
        }
        // 越（原始 SEED，不套覆盖）：逐字段取自 SEED 行，键序 = 旧 CARDS 构造
        let plain = card(yue, raw: true)
        let row = seedRow(yue)
        let want = obj43([
            ("word", row["ans"]!), ("chars", arrayOf43([yue, lai, yue])), ("ci", n43(0)), ("target", s43(yue)), ("py", row["py"]!), ("hint", row["hint"]!),
            ("rank", row["rank"]!), ("strokes", row["strokes"]!), ("parts", row["parts"]!), ("topic", row["topic"]!), ("d", row["d"]!), ("band", row["band"]!),
            ("edu", row["edu"]!), ("common", row["common"]!), ("norm", row["norm"]!), ("std", row["std"]!), ("ctx", s43("dict")),
        ])
        XCTAssertSameJSON(plain, want)
        XCTAssertEqual(plain["word"], s43(yue + lai + yue))
        XCTAssertEqual([plain["rank"], plain["strokes"], plain["parts"], plain["d"], plain["common"], plain["std"]], [n43(440), n43(12), n43(3), n43(58), n43(5), n43(2514)])
    }

    // test/core/cards.test.mjs: LIBRARIES: legacy ids, v10 labels, counts 3500/2974/744/2500
    func testLIBRARIESLegacyIdsV10LabelsCounts3500297474425() {
        XCTAssertEqual(Cards.libraries.map { $0.id }, ["core3500", "adv3000", "rare", "curriculum2500"])
        XCTAssertEqual(Cards.libraries.map { $0.label }, ["\u{5E38}\u{7528}\u{5B57}", "\u{6B21}\u{5E38}\u{7528}\u{5B57}", "\u{5C11}\u{89C1}\u{5B57}", "\u{8BFE}\u{672C}\u{5B57}"])
        XCTAssertEqual(Cards.libraries.map { $0.officialTotal }, [3500, 3000, 1605, 2500])
        let counts = Cards.libraries.map { lib in Self.cards.filter(lib.test).count }
        XCTAssertEqual(counts, [3500, 2974, 744, 2500])
        XCTAssertEqual(Cards.libraryById("rare")?.label, "\u{5C11}\u{89C1}\u{5B57}")
        XCTAssertNil(Cards.libraryById("primary"))
        XCTAssertEqual(Cards.libraryIdsFor(card(ta)), ["core3500", "curriculum2500"])
    }

    // test/core/cards.test.mjs: cardKey is base:<字> / custom:<字>
    func testCardKeyIsBaseCustom() {
        XCTAssertEqual(Cards.cardKey(card(yue)), "base:" + yue)
        XCTAssertEqual(Cards.cardKey(obj43([("target", s43("\u{20BB7}")), ("custom", .bool(true))])), "custom:\u{20BB7}")
        XCTAssertEqual(Set(Self.cards.map(Cards.cardKey)).count, 7218)
    }

    // test/core/cards.test.mjs: promptModel masks every occurrence of a repeated target (越来越, raw SEED)
    func testPromptModelMasksEveryOccurrenceOfARepeatedTargetRawSEED() throws {
        let c = card(yue, raw: true)
        let model = try Cards.promptModel(c)
        let py = seedRow(yue)["py"]!
        XCTAssertEqual(model["segments"], jsArray43([
            obj43([("kind", s43("blank")), ("text", py)]),
            obj43([("kind", s43("text")), ("text", s43(lai))]),
            obj43([("kind", s43("repeatBlank")), ("text", s43("\u{25A1}")), ("label", copy["repeatBlankLabel"]!)]),
        ]))
        XCTAssertEqual(model["instruction"], copy["repeatInstruction"])
        XCTAssertEqual(model["contentHint"], s43(""))
        XCTAssertEqual(model["visibleHint"], copy["repeatInstruction"])
        let label = copy["repeatBlankLabel"]!.stringValue!
        XCTAssertEqual(try Cards.promptHTML(c),
                       "<span class=\"blank\">\(py.stringValue!)</span><span class=\"given\">\(lai)</span><span class=\"blank repeatBlank\" role=\"img\" aria-label=\"\(label)\">\u{25A1}</span>")
    }

    // test/core/cards.test.mjs: promptModel for 慢慢 (raw SEED): only the original position carries pinyin
    func testPromptModelForManManRawSEEDOnlyTheOriginalPositionCarriesPinyin() throws {
        let model = try Cards.promptModel(card(manC, raw: true))
        let segs = model["segments"]!.arrayValue!
        XCTAssertEqual(segs.map { $0.str("kind") }, ["blank", "repeatBlank"])
        XCTAssertEqual(segs[0]["text"], seedRow(manC)["py"])
        XCTAssertTrue(segs.allSatisfy { $0["text"] != s43(manC) && $0["label"] != s43(manC) })
    }

    // test/core/cards.test.mjs: #175 overrides replace 越来越/慢慢 and keep masking other repeated words (忠心耿耿)
    func testOverrides175ReplaceYueLaiYueManManAndKeepMaskingOtherRepeatedWords() throws {
        XCTAssertEqual(card(yue)["word"], s43(yue + "\u{91CE}")) // 越野
        XCTAssertEqual(card(manC)["word"], s43("\u{7F13}" + manC)) // 缓慢
        XCTAssertEqual(try Cards.promptModel(card(yue))["instruction"], s43(""))
        let model = try Cards.promptModel(card(geng))
        XCTAssertEqual(model["segments"]!.arrayValue!.map { $0.str("kind") }, ["text", "text", "blank", "repeatBlank"])
        XCTAssertTrue((model["visibleHint"]?.stringValue ?? "").hasSuffix(copy["repeatInstruction"]!.stringValue!))
    }

    // test/core/cards.test.mjs: no prompt or visible hint leaks the target; exactly one pinyin blank per card
    func testNoPromptOrVisibleHintLeaksTheTargetExactlyOnePinyinBlankPerCard() throws {
        for c in Self.cards {
            let target = c["target"]!.stringValue!
            let html = try Cards.promptHTML(c)
            let model = try Cards.promptModel(c)
            XCTAssertFalse(html.contains(target), target)
            XCTAssertFalse((model["visibleHint"]?.stringValue ?? "").contains(target), target)
            let segs = model["segments"]!.arrayValue!
            XCTAssertEqual(segs.filter { $0.str("kind") == "blank" }.count, 1, target)
            XCTAssertEqual(segs.filter { $0.str("kind") != "text" }.count, c["chars"]!.arrayValue!.filter { $0 == s43(target) }.count)
            XCTAssertTrue(segs.allSatisfy { $0.str("kind") == "text" || ($0["text"] != s43(target) && $0["label"] != s43(target)) })
        }
    }

    // test/core/cards.test.mjs: visible hint: gloss, promptHint, fallback, custom
    func testVisibleHintGlossPromptHintFallbackCustom() throws {
        // gloss / promptHint 的内容来自题库覆盖：取出来对账（不手抄汉字）
        let o = DeckData.shared.overrides
        XCTAssertEqual(try Cards.visibleHint(card(ta)), o[ta]?["gloss"])
        XCTAssertEqual(try Cards.visibleHint(card(niang)), o[niang]?["promptHint"])
        XCTAssertEqual(try Cards.visibleHint(card(yu)), copy["fallbackHint"])
        let custom = obj43([("custom", .bool(true)), ("hint", s43("x")), ("chars", arrayOf43([ha, ha])), ("ci", n43(0)), ("target", s43(ha)), ("py", s43("h\u{101}"))])
        XCTAssertEqual(try Cards.visibleHint(custom), s43("x " + copy["repeatInstruction"]!.stringValue!))
        XCTAssertEqual(try Cards.visibleHint(obj43([("custom", .bool(true)), ("chars", arrayOf43([zi])), ("ci", n43(0)), ("target", s43(zi)), ("py", s43("z\u{EC}"))])), s43(""))
    }

    // test/core/cards.test.mjs: promptHTML escapes markup and falls back to ？ without pinyin
    func testPromptHTMLEscapesMarkupAndFallsBackToFullwidthQuestionMarkWithoutPinyin() throws {
        let c = obj43([("chars", arrayOf43(["<", zi, "&"])), ("ci", n43(1)), ("target", s43(zi)), ("py", s43(""))])
        XCTAssertEqual(try Cards.promptHTML(c), "<span class=\"given\">&lt;</span><span class=\"blank\">\(huan)</span><span class=\"given\">&amp;</span>")
        var cp = copy
        cp["repeatInstruction"] = s43("X")
        XCTAssertEqual(try Cards.promptModel(obj43([("chars", arrayOf43(["a", "a"])), ("ci", n43(0)), ("target", s43("a")), ("py", s43("p"))]), copy: cp)["instruction"], s43("X"))
    }

    // test/core/cards.test.mjs: applyContextOverride: invalid w is ignored, gloss/preserveCommon/py/promptHint semantics
    func testApplyContextOverrideInvalidWIsIgnoredGlossPreserveCommonPyPromptHintSemantics() throws {
        let row = seedRow(yue)
        func tbl(_ pairs: [(String, JSValue)]) -> JSValue { obj43([(yue, obj43(pairs))]) }
        XCTAssertSameJSON(try Cards.applyContextOverride(row, tbl([("w", s43("\u{4E0D}\u{542B}")), ("ci", n43(0))])), row, "invalid override returns the source row")
        let same = try Cards.applyContextOverride(row, tbl([("w", s43(yue + lai + yue)), ("ci", n43(0)), ("py", s43(" yu\u{E8} ")), ("promptHint", s43(" x "))]))
        XCTAssertEqual(same["ctx"], s43("dict"), "identical context keeps its ctx")
        XCTAssertEqual(same["py"], s43("yu\u{E8}"))
        XCTAssertEqual(same["promptHint"], s43("x"))
        let zeroCommon = setting(row, "common", n43(0))
        let gloss = try Cards.applyContextOverride(zeroCommon, tbl([("gloss", s43("g")), ("preserveCommon", .bool(true))]))
        XCTAssertEqual([gloss["ans"], gloss["ci"], gloss["ctx"], gloss["hint"], gloss["common"]], [s43(yue), n43(0), s43("gloss"), s43("g"), n43(0)])
        XCTAssertEqual(try Cards.applyContextOverride(zeroCommon, tbl([("gloss", s43("g"))]))["common"], n43(1))
        XCTAssertEqual(try Cards.applyContextOverride(zeroCommon, tbl([("boost", .bool(true))]))["common"], n43(1.2))
        XCTAssertEqual(row["ans"], s43(yue + lai + yue), "source row not mutated")
        XCTAssertThrowsCore("type") { _ = try Cards.buildCards(seed: [obj43([])], overrides: nil) }
    }
}
