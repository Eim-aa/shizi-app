import Foundation
import XCTest
@testable import ShiziCore

// 生成资源（Resources/*.json）的读取与类型化访问。资源与 src/ 的同步由 node scripts/build_core_config.mjs --check 守，
// 两个引擎对同一资源的一致由差分域 config（config.get / deck.*）守；这里只验 Swift 侧读得出、取得到。

final class ConfigDataTests: XCTestCase {
    func testEveryNamedConfigLoadsAndIsNonEmpty() {
        for name in Config.configNames {
            let v = Config.named(name)
            XCTAssertNotNil(v, name)
            switch v {
            case .object(let o)?: XCTAssertFalse(o.isEmpty, name)
            case .array(let a)?: XCTAssertFalse(a.isEmpty, name)
            default: XCTFail(name)
            }
        }
        XCTAssertNil(Config.named("nope"))
    }

    func testMotionTokens() {
        XCTAssertEqual(Config.motion["duration"]?["paperOpen"], .number(420))
        XCTAssertEqual(Config.motion["role"]?["sheetIn"], .number(280))
        XCTAssertEqual(Config.motion["gesture"]?["commitRatio"], .number(1.0 / 3.0))
        XCTAssertEqual(Config.motion["easing"]?["out"], .string("cubic-bezier(.2,.7,.2,1)"))
        XCTAssertEqual(Config.motion["bezier"]?["out"], .array([.number(0.2), .number(0.7), .number(0.2), .number(1)]))
        XCTAssertEqual(Config.motion["bezier"]?["linear"], .array([.number(0), .number(0), .number(1), .number(1)]))
        XCTAssertEqual(Config.motion["haptic"]?["select"]?["native"], .string("UISelectionFeedbackGenerator"))
        XCTAssertEqual(Config.motion["cssVars"]?["--dur-paper-open"], .string("420ms"))
    }

    func testCharOrderTyped() {
        let c = CharOrder.shared
        XCTAssertGreaterThan(c.order.count, 400)
        XCTAssertGreaterThan(c.warmup.count, 90)
        XCTAssertEqual(c.capitalGroups.count, 2)
        XCTAssertEqual(c.capitalGroups.map { $0.count }, [5, 5])
        XCTAssertEqual(c.capitalAfter.count, 2)
        XCTAssertEqual(c.capitalNumerals.count, 12)
        XCTAssertEqual(c.capitalContexts.count, 12)
        XCTAssertEqual(c.commonRankMax, 3500)
        // 特别组里的每个字都有语境，且语境词里含该字
        for g in c.capitalGroups + [c.capitalAfter] {
            for ch in g {
                let ctx = c.capitalContext(of: ch)
                XCTAssertNotNil(ctx, ch)
                XCTAssertTrue(ctx?.word.contains(ch) ?? false, ch)
            }
        }
        // 默认排序与 reserved 不相交（reserved 已剔除）
        XCTAssertTrue(Set(c.order).isDisjoint(with: Set(c.capitalNumerals)))
        XCTAssertTrue(Set(c.order).isDisjoint(with: Set(c.heavy)))
    }

    func testDeckData() {
        let d = DeckData.shared
        XCTAssertEqual(d.seed.count, d.groups.count)
        XCTAssertGreaterThan(d.seed.count, 7000)
        XCTAssertEqual(d.seed.first?["rank"], .number(1))
        XCTAssertEqual(d.seed.first?["target"]?.stringValue?.unicodeScalars.count, 1)
        XCTAssertGreaterThan(d.overrides.count, 800)
        XCTAssertEqual(DeckData.key, Config.deckMeta["DECK_KEY"]?.stringValue)
        XCTAssertEqual(DeckData.fingerprint.count, 12)
        // 每张卡都有目标字与拼音、笔画数
        for row in d.seed.prefix(500) {
            XCTAssertNotNil(row["target"]?.stringValue)
            XCTAssertNotNil(row["py"]?.stringValue)
            XCTAssertNotNil(row["strokes"]?.numberValue)
        }
    }

    func testCopyFormatRules() throws {
        XCTAssertEqual(Copy.fill("{n} / {total}", JSObject([("n", .number(3)), ("total", .number(5))])), "3 / 5")
        XCTAssertEqual(Copy.fill("{n} {x}", JSObject([("n", .number(1))])), "1 {x}", "missing placeholders are kept")
        XCTAssertEqual(Copy.fill("{n}", JSObject([("n", .null)])), "{n}", "null counts as missing")
        XCTAssertEqual(Copy.fill("{n}", JSObject([("n", .array([.number(1), .null, .string("a")]))])), "1,,a", "arrays join like String(array)")
        XCTAssertEqual(Copy.fill("{ n }{{n}}", JSObject([("n", .number(2))])), "{ n }{2}")
        XCTAssertThrowsError(try Copy.t("nope")) { XCTAssertEqual(($0 as? CoreError)?.code, "error") }
        XCTAssertTrue(Copy.has("R-H02.dateFormat"))
        XCTAssertEqual(Copy.inkKey("base", perRecordInk: true), "base")
        XCTAssertEqual(Copy.inkKey("base", perRecordInk: false), "baseGlyph")
    }

    func testEngineOpTableHasTheNewDomains() {
        for op in ["config.get", "deck.seed", "epigraphs.for", "copy.t", "dates.cnNumber", "schema.validateValue", "schema.parseBackupV2", "models.roundtrip"] {
            XCTAssertNotNil(CoreEngine.ops[op], op)
        }
    }
}
