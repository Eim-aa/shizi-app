import Foundation
import XCTest
@testable import ShiziCore
@testable import ShiziCoreEngine

// 生成资源（Resources/*.json）的读取与类型化访问。D84：资源是手改的唯一真相源（Bundled/README.md），原先生成器保证的结构由本文件的类型表与 policy 覆盖测试守，
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

    // D84：policy.json 成了手改的唯一真相源，原来 build_core_config 从 policy.js 导出时顺带保证的「键齐全、类型对」改由这里守。
    // 下表是 policy.json 的全部顶层导出与类型（当前学习规则是初版，见 D82，调整规则时同步改本表）；
    // 之后是 App / 引擎用 Config.policyNumber / policyString / policyBool 按路径直接读的嵌套键。
    private static let policyTopLevelKinds: [String: String] = [
        "afterClearRestartFirst": "bool",
        "afterSeenInkKeepDays": "number",
        "answerSeenRating": "string",
        "assumedQuotaBytes": "number",
        "capitalNumerals": "object",
        "compactTextScale": "number",
        "contentSizeScale": "object",
        "dailyExpiry": "string",
        "dailyPlan": "object",
        "dayStartHour": "number",
        "defaultLibrary": "string",
        "features": "object",
        "firstQueue": "array",
        "firstTip": "object",
        "forgetCap": "number",
        "forgetRule": "string",
        "groupMix": "object",
        "groupSize": "number",
        "groupSizeOptions": "array",
        "imageMaxChars": "number",
        "ink": "object",
        "inkBudgetByGroupSize": "object",
        "inkBudgetBytes": "number",
        "inkFormat": "string",
        "inkMaxPointsPerStroke": "number",
        "inkMaxStrokes": "number",
        "inkStoreTolerance": "object",
        "inkToneDays": "array",
        "keySoundEvents": "array",
        "knownZone": "object",
        "legacyPhotoCountsAsRecord": "bool",
        "listDefaultSelect": "number",
        "migration": "object",
        "monthSheetPick": "string",
        "motion": "object",
        "nativeStorage": "object",
        "paperTransition": "object",
        "queryCardInk": "string",
        "queryInputMax": "null",
        "queryModes": "array",
        "ratingFirstCorrect": "string",
        "ratingWithHint": "object",
        "recordsBudgetBytes": "number",
        "recordsFoldAfterDays": "number",
        "remindDefault": "string",
        "reminderBlank": "string",
        "reminderPick": "string",
        "reminderWord": "string",
        "routeRestore": "object",
        "s02EndOld": "string",
        "sessionExpiry": "object",
        "skipNewDeferDays": "number",
        "skipScope": "string",
        "skipUndo": "object",
        "soundGainDb": "object",
        "storageWarnRatio": "number",
        "wallMoreScope": "string",
        "warmup": "object",
    ]
    private static let policyDirectPathKinds: [String: String] = [
        "nativeStorage.inkFormat": "string",
        "nativeStorage.totalTargetBytes": "number",
        "nativeStorage.recordsBudgetBytes": "number",
        "nativeStorage.quotaBytes": "number",
        "nativeStorage.inkBudgetBytes": "number",
        "nativeStorage.freeSpaceWarnBytes": "number",
        "nativeStorage.freeSpaceFullBytes": "number",
        "features.perRecordInk": "bool",
    ]

    private func kind(_ v: JSValue?) -> String {
        switch v {
        case .object?: return "object"
        case .array?: return "array"
        case .string?: return "string"
        case .number?: return "number"
        case .bool?: return "bool"
        case .null?: return "null"
        default: return "missing"
        }
    }

    func testPolicyEveryTopLevelKeyExistsWithItsType() {
        let policy = Config.policy.objectValue ?? JSObject()
        XCTAssertEqual(Set(policy.keys), Set(Self.policyTopLevelKinds.keys), "policy.json keys = the pinned table (add / remove a key: edit this table too)")
        for (key, expected) in Self.policyTopLevelKinds {
            XCTAssertEqual(kind(policy[key]), expected, "policy.\(key)")
        }
    }

    func testPolicyEveryDirectlyReadPathExistsWithItsType() {
        for (path, expected) in Self.policyDirectPathKinds {
            XCTAssertEqual(kind(Config.policyValue(path)), expected, "policy.\(path)")
        }
        // 取值器与类型一致
        XCTAssertNotNil(Config.policyNumber("nativeStorage.quotaBytes"))
        XCTAssertNotNil(Config.policyString("nativeStorage.inkFormat"))
        XCTAssertNotNil(Config.policyBool("features.perRecordInk"))
    }

    func testPolicyMetaCoversExactlyThePolicyExports() {
        let exports = PolicyCoverage.pMap.keys.sorted()
        XCTAssertEqual(exports, (Config.policy.objectValue?.keys ?? []).sorted(), "policy-meta.json registers every policy export, and nothing else")
        for e in PolicyCoverage.pMap.entries {
            XCTAssertFalse((e.value["p"]?.arrayValue ?? []).isEmpty, "policy.\(e.key) carries a P number")
        }
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
