import Foundation
import XCTest
@testable import ShiziCore

// 新字顺序（D28 易忘度排序、D39 姓氏与地名、D40 大写数字、D45、D50）的转写（B4.2）：test/core/new-order.test.mjs（11）。
// JS 里「脚本生成 char-order.js」「deck.js 适配器」「capitalCard」在 Swift 里没有一一对应的代码，各条测试里写明转成什么；
// 汉字一律用 \u{…} 转义。

private func K(_ s: String) -> [String] { s.unicodeScalars.map { "base:" + String($0) } }
private func chars(_ s: String) -> [String] { s.unicodeScalars.map { String($0) } }
private func char(_ key: String) -> String { String(key.unicodeScalars.dropFirst(5)) }
private func S(_ s: String) -> JSValue { .string(s) }
private func strs(_ v: JSValue?) -> [String] { (v?.arrayValue ?? []).compactMap { $0.stringValue } }

private let CO = CharOrder.shared
private let reservedAll = Set(CO.surnames + CO.places + CO.capitalNumerals + CO.heavy)

/// docs/engineering/v10/phase1/易忘度字表-1.0.json
private func loadTable() throws -> JSValue {
    try JSONParser.parse(try readRepoFile("docs/engineering/v10/phase1/\u{6613}\u{5FD8}\u{5EA6}\u{5B57}\u{8868}-1.0.json"))
}

/// 题库（deck.json 的 seed 行）里每个字的最小字频序。
private func deckRanks() throws -> [String: Double] {
    var ranks: [String: Double] = [:]
    for row in try CoreResources.load("deck")["seed"]?.arrayValue ?? [] {
        guard let t = row["target"]?.stringValue, let r = row["rank"]?.numberValue else { continue }
        if let old = ranks[t], old <= r { continue }
        ranks[t] = r
    }
    return ranks
}

final class NewOrderTests: XCTestCase {
    // test/core/new-order.test.mjs: char-order.js is generated from the draft table (--check passes) and a change to the table makes it stale
    func testCharOrderJsIsGeneratedFromTheDraftTableCheckPassesAndAChangeToTheTableMakesItStale() throws {
        // JS 原测试跑生成器脚本 scripts/build_char_order.mjs --check / generate()，对的是 src/config/char-order.js。
        // Swift 没有这个生成器：资源 char-order.json 由 scripts/build_core_config.mjs 导出，并由它的 --check 守与 src/ 同步。
        // 这里转成数据层的判定：资源带着三份输入的指纹（orderTable / curation / capitalNumerals），状态说明与阈值齐全；
        // 「表变了即过期」由指纹 + 同步门禁负责，「生成物与表一致」见下一条测试（order == 表序 − reserved）。
        let meta = Config.charOrderData["meta"]
        XCTAssertEqual(meta?["inputs"]?.objectValue?.keys.sorted(), ["capitalNumerals", "curation", "orderTable"])
        for (k, v) in meta?["inputs"]?.objectValue?.entries ?? [] { XCTAssertFalse((v.stringValue ?? "").isEmpty, k) }
        XCTAssertFalse(CO.status.isEmpty)
        XCTAssertFalse(CO.order.isEmpty)
    }

    // test/core/new-order.test.mjs: default order = the table order minus the reserved chars; nothing is reordered or invented
    func testDefaultOrderIsTheTableOrderMinusTheReservedCharsNothingIsReorderedOrInvented() throws {
        let table = try loadTable()
        XCTAssertEqual(CO.order, strs(table["order"]).filter { !reservedAll.contains($0) })
        XCTAssertEqual(CO.level2, (table["level2Appendix"]?.arrayValue ?? []).compactMap { $0["char"]?.stringValue }.filter { !reservedAll.contains($0) })
        XCTAssertEqual(CO.warmup, strs(table["warmup"]?["order"]), "warm-up list is the table's, none of them reserved")
        XCTAssertEqual(Set(CO.order).count, CO.order.count, "no duplicates")
        XCTAssertGreaterThan(CO.order.count, 400)
    }

    // test/core/new-order.test.mjs: D39 / D40 / D45: rarely-used surnames / place names and capital numerals are not in the default sort
    func testD39D40D45RarelyUsedSurnamesPlaceNamesAndCapitalNumeralsAreNotInTheDefaultSort() throws {
        let inOrder = Set(CO.order + CO.level2)
        let sample: [(String, String)] = [("surnames", "\u{6ED5}\u{7FDF}\u{853A}"), ("places", "\u{9ED4}\u{6EC7}\u{6E1D}"), ("capital", "\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}\u{9646}\u{67D2}\u{634C}\u{7396}\u{62FE}\u{4F70}\u{4EDF}")]
        for (group, cs) in sample {
            for c in chars(cs) {
                XCTAssertFalse(inOrder.contains(c), "\(c)\u{FF08}\(group)\u{FF09}\u{4E0D}\u{5E94}\u{5728}\u{9ED8}\u{8BA4}\u{6392}\u{5E8F}\u{91CC}")
                XCTAssertTrue(NewOrder.isReservedChar(c), "\(c) reserved")
            }
        }
        // 它们也不会从「清单之后的字频尾部」混进来
        let ordered = NewOrder.orderNewKeys(K("\u{7684}\u{4E00}\u{662F}\u{6ED5}\u{7FDF}\u{9ED4}\u{6E1D}\u{58F9}\u{8086}\u{62FE}\u{4F70}\u{4EDF}\u{6625}\u{9171}\u{5C34}\u{8D62}\u{70ED}"))
        for c in chars("\u{6ED5}\u{7FDF}\u{9ED4}\u{6E1D}\u{58F9}\u{8086}\u{62FE}\u{4F70}\u{4EDF}") { XCTAssertFalse(ordered.contains("base:" + c), c) }
        // removed 列表逐个写明（供审读）：肆 贰 拾 是主表里的大写数字；姓氏 / 地名带字频
        let removed = Config.charOrderData["removed"]
        XCTAssertTrue(strs(removed?["capitalNumerals"]).contains { $0.hasPrefix("\u{8086}") })
        func hasRank(_ x: String) -> Bool { x.range(of: "\u{5B57}\u{9891}#[0-9]+", options: .regularExpression) != nil }
        XCTAssertTrue(strs(removed?["surnames"]).allSatisfy(hasRank) && strs(removed?["places"]).allSatisfy(hasRank))
        XCTAssertEqual(strs(removed?["surnames"]).map { String($0.unicodeScalars.first!) }.sorted(), chars("\u{6ED5}\u{7FDF}\u{853A}").sorted())
        XCTAssertEqual(strs(removed?["places"]).map { String($0.unicodeScalars.first!) }.sorted(), chars("\u{9ED4}\u{6EC7}\u{6E1D}").sorted())
        XCTAssertEqual(CO.capitalNumerals.joined(), "\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}\u{9646}\u{67D2}\u{634C}\u{7396}\u{62FE}\u{4F70}\u{4EDF}")
    }

    // test/core/new-order.test.mjs: D45 / P145: commonly-used surnames and place names (熊 颜 藏 桂 厦 傅 鞠 豫 疆 …) are back in the default sort, at their table positions
    func testD45P145CommonlyUsedSurnamesAndPlaceNamesAreBackInTheDefaultSortAtTheirTablePositions() throws {
        let table = try loadTable()
        let inOrder = Set(CO.order + CO.level2)
        for c in chars("\u{718A}\u{989C}\u{85CF}\u{6842}\u{53A6}\u{5085}\u{97A0}\u{8C6B}\u{7586}") {
            XCTAssertTrue(inOrder.contains(c), "\(c) \u{5E38}\u{7528}\u{5B57}\u{5728}\u{9ED8}\u{8BA4}\u{6392}\u{5E8F}\u{91CC}")
            XCTAssertFalse(NewOrder.isReservedChar(c), "\(c) not reserved")
            XCTAssertTrue((CO.commonKeptSurnames + CO.commonKeptPlaces).contains(c), "\(c) \u{767B}\u{8BB0}\u{5728} commonKept")
        }
        // 原位：与易忘度表里的相对顺序一致（只少了被剔除的字）
        let removedSet = Set(CO.capitalNumerals + CO.surnames + CO.places)
        XCTAssertEqual(CO.order, strs(table["order"]).filter { !removedSet.contains($0) })
        // 经 orderNewKeys：常用姓氏 / 地名字按表序出现在前，不被挡在字频尾部之后
        let ordered = NewOrder.orderNewKeys(K("\u{7684}\u{4E00}\u{662F}\u{718A}\u{989C}\u{85CF}\u{6842}\u{53A6}\u{5085}\u{97A0}\u{8C6B}\u{7586}\u{9171}\u{5C34}\u{6625}")).map(char)
        for c in chars("\u{718A}\u{989C}\u{85CF}\u{6842}\u{53A6}\u{5085}\u{97A0}\u{8C6B}\u{7586}") { XCTAssertTrue(ordered.contains(c), c) }
        XCTAssertLessThan(ordered.firstIndex(of: "\u{7586}")!, ordered.firstIndex(of: "\u{7684}")!, "listed chars precede the frequency tail")
        // 阈值与字频：reserved 里的姓氏 / 地名都比阈值靠后，commonKept 都不超过阈值；两边合起来正好是 curation 的两张清单
        let ranks = try deckRanks()
        let max = Double(CO.commonRankMax)
        // JS 导入生成器的 COMMON_RANK_MAX 常量；Swift 没有生成器，从脚本源码里取同一个常量核对资源里的阈值。
        let script = try readRepoFile("scripts/build_char_order.mjs")
        let m = script.range(of: "export const COMMON_RANK_MAX = [0-9]+", options: .regularExpression)
        XCTAssertNotNil(m)
        XCTAssertEqual(Double(script[m!].split(separator: " ").last!), max)
        let surnameOnly = Set(CO.surnameOnly)
        for c in CO.surnames + CO.places where !surnameOnly.contains(c) {
            XCTAssertFalse((ranks[c] ?? .infinity) <= max, "\(c) \u{751F}\u{50FB}\u{FF08}\u{5B57}\u{9891} > \(max)\u{FF09}\u{624D}\u{5254}\u{9664}")
        }
        for c in CO.commonKeptSurnames + CO.commonKeptPlaces { XCTAssertLessThanOrEqual(ranks[c] ?? .infinity, max, "\(c) \u{5B57}\u{9891} \u{2264} \(max)") }
        XCTAssertEqual(CO.surnames.count + CO.commonKeptSurnames.count, 32, "\u{7B7E}\u{540D}\u{59D3}\u{6C0F} 31 \u{5B57} \u{222A} \u{53EA}\u{4F5C}\u{59D3}\u{6C0F} 7 \u{5B57}\u{FF08}\u{8881}\u{4E0D}\u{5728}\u{7B7E}\u{540D}\u{6E05}\u{5355}\u{91CC}\u{FF09}")
        XCTAssertEqual(CO.places.count + CO.commonKeptPlaces.count, 21)
    }

    // test/core/new-order.test.mjs: D45 / P145: the threshold is a generator parameter — a stricter one (1500) removes more of the list
    func testD45P145TheThresholdIsAGeneratorParameterAStricterOne1500RemovesMoreOfTheList() throws {
        // JS 原测试用 generate(ROOT, {commonRankMax: 1500}) 重新生成并比对文本。Swift 没有生成器；
        // 数据层的后果是：阈值 1500 时「熊 桂」仍会被剔除（字频 > 1500）而「谢 藏」留下（字频 ≤ 1500）——
        // 用题库字频直接核对这几个字落在阈值的哪一侧，并确认现行资源（阈值 3500）把它们都留在 commonKept 里，所以阈值确实起作用。
        let ranks = try deckRanks()
        XCTAssertGreaterThan(ranks["\u{718A}"] ?? 0, 1500)
        XCTAssertGreaterThan(ranks["\u{6842}"] ?? 0, 1500)
        XCTAssertLessThanOrEqual(ranks["\u{8C22}"] ?? .infinity, 1500)
        XCTAssertLessThanOrEqual(ranks["\u{85CF}"] ?? .infinity, 1500)
        XCTAssertTrue(CO.commonKeptSurnames.contains("\u{718A}") && CO.commonKeptPlaces.contains("\u{6842}") && CO.commonKeptPlaces.contains("\u{85CF}"))
        XCTAssertFalse(CO.surnames.contains("\u{718A}") || CO.places.contains("\u{6842}"))
        XCTAssertGreaterThan(CO.commonRankMax, 1500)
    }

    // test/core/new-order.test.mjs: listed chars come first in table order; unlisted chars follow in the original frequency order; keys outside the list are kept
    func testListedCharsComeFirstInTableOrderUnlistedCharsFollowInTheOriginalFrequencyOrderKeysOutsideTheListAreKept() throws {
        let freq = K("\u{7684}\u{4E00}\u{662F}\u{4E86}\u{4E0D}\u{6211}\u{9171}\u{4EBA}\u{5728}\u{5C34}\u{6709}\u{4ED6}\u{8FD9}\u{6625}\u{4E2D}\u{5927}\u{6765}\u{918B}\u{4E0A}\u{56FD}\u{4E2A}\u{5230}\u{8BF4}\u{4EEC}\u{4E3A}\u{5B50}\u{548C}\u{4F60}\u{5730}\u{51FA}\u{9053}\u{4E5F}\u{65F6}\u{5E74}\u{5F97}\u{5C31}\u{90A3}\u{8981}\u{4E0B}\u{4EE5}\u{751F}\u{4F1A}\u{81EA}\u{7740}\u{53BB}\u{4E4B}\u{8FC7}\u{5BB6}\u{5B66}\u{5BF9}\u{53EF}\u{5979}\u{91CC}\u{540E}\u{5C0F}\u{4E48}\u{5FC3}\u{591A}\u{5929}\u{800C}\u{80FD}\u{597D}\u{90FD}\u{7136}\u{6CA1}\u{65E5}\u{4E8E}\u{8D77}\u{8FD8}\u{53D1}\u{6210}\u{4E8B}\u{53EA}\u{4F5C}\u{5F53}\u{60F3}\u{770B}\u{6587}\u{65E0}\u{5F00}\u{624B}\u{5341}\u{7528}\u{4E3B}\u{884C}\u{65B9}\u{53C8}\u{5982}\u{524D}\u{6240}\u{672C}\u{89C1}\u{7ECF}\u{5934}\u{9762}\u{516C}\u{540C}\u{4E09}\u{5DF2}\u{8001}\u{4ECE}\u{52A8}\u{4E24}\u{957F}\u{77E5}\u{6C11}\u{6837}\u{73B0}\u{5206}\u{5C06}\u{5916}\u{4F46}\u{8EAB}\u{4E9B}\u{4E0E}\u{9AD8}\u{610F}\u{8FDB}\u{628A}\u{6CD5}\u{6B64}\u{5B9E}\u{56DE}\u{4E8C}\u{7406}\u{7F8E}\u{70B9}\u{6708}\u{660E}\u{5176}\u{79CD}\u{58F0}\u{5168}\u{5DE5}\u{5DF2}")
        let ordered = NewOrder.orderNewKeys(freq)
        let listed = ordered.filter { CO.order.contains(char($0)) }
        XCTAssertEqual(listed.map(char), CO.order.filter { freq.contains("base:" + $0) }, "listed part follows the table order")
        let firstUnlisted = ordered.firstIndex { !CO.order.contains(char($0)) }!
        XCTAssertGreaterThanOrEqual(firstUnlisted, listed.count - 1)
        XCTAssertTrue(ordered[firstUnlisted...].allSatisfy { !CO.order.contains(char($0)) }, "listed chars all before unlisted ones")
        let tail = ordered[firstUnlisted...].map(char)
        XCTAssertEqual(tail, freq.map(char).filter { !CO.order.contains($0) && !CO.level2.contains($0) }, "unlisted keep their frequency order")
        // 高频字「的 一 是」不再排最前（旧口径 P74 字频序）
        XCTAssertNotEqual(Array(ordered.prefix(3)), K("\u{7684}\u{4E00}\u{662F}"))
        XCTAssertEqual(NewOrder.orderNewKeys([]).count, 0)
        // JS 还试了 orderNewKeys(null) → []；Swift 的参数类型是 [String]，不接受 null，没有对应情形。
    }

    // test/core/new-order.test.mjs: swapping the table swaps the order: orderNewKeys / warmupKeys read only the data they are given
    func testSwappingTheTableSwapsTheOrderOrderNewKeysWarmupKeysReadOnlyTheDataTheyAreGiven() throws {
        func a(_ s: String) -> JSValue { .array(chars(s).map { S($0) }) }
        let data = JS.obj([
            ("order", a("\u{4E59}\u{7532}")), ("level2", a("\u{4E19}")), ("warmup", a("\u{4E01}\u{6625}")),
            ("reserved", JS.obj([("surnames", a("\u{620A}")), ("places", .array([])), ("capitalNumerals", .array([]))])),
            ("capital", Config.charOrderData["capital"]!),
        ])
        XCTAssertEqual(NewOrder.orderNewKeys(K("\u{7532}\u{4E59}\u{4E19}\u{4E01}\u{620A}"), data: data), K("\u{4E59}\u{7532}\u{4E19}\u{4E01}"))
        XCTAssertEqual(NewOrder.warmupKeys(K("\u{6625}\u{4E01}\u{7532}"), data: data), K("\u{4E01}\u{6625}"))
        XCTAssertTrue(NewOrder.isWarmupChar("\u{4E01}", data: data))
        XCTAssertFalse(NewOrder.isWarmupChar("\u{7532}", data: data))
        XCTAssertTrue(NewOrder.isReservedChar("\u{620A}", data: data))
    }

    // test/core/new-order.test.mjs: deck adapter: newCandidates are in table order for the default library, 的 一 是 do not lead, warm-up chars are listed separately
    func testDeckAdapterNewCandidatesAreInTableOrderForTheDefaultLibraryDeYiShiDoNotLeadWarmUpCharsAreListedSeparately() throws {
        // JS 用 setDeckSource 注入一份小题库（一级 / 二级两个库）。Swift 的适配器是 ScheduleDeck + DeckIndex（B4.2 里它的数据来自生成的
        // deck-libraries.json）；这里用同样形状的手工索引：core3500 = 一级行的字（字频序），adv3000 = 二级行的字。
        let core = K("\u{7684}\u{4E00}\u{662F}\u{6625}\u{9171}\u{5C34}\u{6ED5}\u{58F9}\u{62FE}\u{6E1D}")
        let index = DeckIndex(JS.obj([
            ("defaultLibraryId", S("core3500")),
            ("keys", .array((core + ["base:\u{568F}"]).map { S($0) })),
            ("libraries", .array([
                JS.obj([("id", S("core3500")), ("label", S("core")), ("officialTotal", .number(3500)), ("keys", .array(core.map { S($0) }))]),
                JS.obj([("id", S("adv3000")), ("label", S("adv")), ("officialTotal", .number(3000)), ("keys", .array([S("base:\u{568F}")]))]),
            ])),
        ]))
        let deck = ScheduleDeck(newCandidates: { index.newOrder(index.library($0) != nil ? $0 : S(index.defaultLibraryId)) },
                                warmupCandidates: { index.warmup(index.library($0) != nil ? $0 : S(index.defaultLibraryId)) },
                                practicable: { index.isPracticable($0) }, currentLibraryId: { index.currentLibraryId($0) })
        let c = deck.newCandidates(S("core3500"))
        XCTAssertEqual(Array(c.prefix(2)), K("\u{5C34}\u{9171}"), "listed chars first (\u{5C34} before \u{9171} in the 1.0 table), table order")
        XCTAssertFalse(c.contains("base:\u{6ED5}") || c.contains("base:\u{58F9}") || c.contains("base:\u{62FE}") || c.contains("base:\u{6E1D}"), "reserved never come as new")
        XCTAssertEqual(Array(c.dropFirst(2)), K("\u{7684}\u{4E00}\u{662F}\u{6625}"), "then the rest in frequency order")
        XCTAssertEqual(deck.warmupCandidates?(S("core3500")), K("\u{6625}"))
        XCTAssertEqual(index.warmup(S("adv3000")), [], "\u{4E8C}\u{7EA7}\u{5E93}\u{91CC}\u{6CA1}\u{6709}\u{70ED}\u{8EAB}\u{5B57}")
        XCTAssertEqual(deck.newCandidates(S("adv3000")), ["base:\u{568F}"])
        XCTAssertEqual(index.newOrder(S("core3500")), c)
        XCTAssertTrue(index.library(S("core3500"))!.keys.contains("base:\u{6ED5}"), "the library itself still holds them (look-up, pick)")
        // JS 的 Object.isFrozen 断言在 Swift（值类型）里没有对应物。
        // 再对生成的真实题库适配器核对同样的规则：新字里没有 reserved，且清单内的字按表序在前。
        let real = ScheduleDeck.real.newCandidates(S("core3500"))
        XCTAssertFalse(real.isEmpty)
        XCTAssertFalse(real.contains { reservedAll.contains(char($0)) })
        let listed = real.filter { CO.order.contains(char($0)) }.map(char)
        XCTAssertEqual(listed, CO.order.filter { real.contains("base:" + $0) })
        XCTAssertEqual(Array(real.prefix(listed.count).map(char)), listed, "listed chars lead the candidates")
        XCTAssertEqual(ScheduleDeck.real.warmupCandidates?(S("core3500")), NewOrder.warmupKeys(DeckIndex.shared.library(S("core3500"))!.keys))
    }

    // test/core/new-order.test.mjs: capital numerals data: groups 壹贰叁肆伍 / 陆柒捌玖拾, 佰仟 after; every one has a leak-free context word with the target exactly once
    func testCapitalNumeralsDataGroupsAfterEveryOneHasALeakFreeContextWordWithTheTargetExactlyOnce() throws {
        XCTAssertEqual(NewOrder.capitalGroupKeys().map { $0.map(char).joined() }, ["\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}", "\u{9646}\u{67D2}\u{634C}\u{7396}\u{62FE}"])
        XCTAssertEqual(NewOrder.capitalAfterKeys(), K("\u{4F70}\u{4EDF}"))
        for c in chars("\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}\u{9646}\u{67D2}\u{634C}\u{7396}\u{62FE}\u{4F70}\u{4EDF}") {
            XCTAssertTrue(NewOrder.isCapitalChar(c))
            guard let ctx = CO.capitalContext(of: c) else { XCTFail(c + " has a context"); continue }
            let ws = chars(ctx.word)
            XCTAssertEqual(ws[ctx.ci], c)
            XCTAssertEqual(ws.filter { $0 == c }.count, 1, "target appears once \u{2192} no repeat-blank instruction")
            XCTAssertFalse(ctx.promptHint.contains(c), "hint does not leak the answer")
            XCTAssertNotNil(ctx.promptHint.range(of: "\u{501F}\u{6761}|\u{62A5}\u{9500}|\u{7EA2}\u{5305}|\u{6536}\u{636E}", options: .regularExpression))
            XCTAssertFalse(ctx.py.isEmpty)
        }
        func q(_ keys: [String]) -> [JSValue] { keys.map { S($0) } }
        XCTAssertTrue(NewOrder.isCapitalQueue(q(K("\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}"))))
        XCTAssertTrue(NewOrder.isCapitalQueue(q(K("\u{9646}\u{67D2}\u{634C}\u{7396}\u{62FE}"))))
        XCTAssertFalse(NewOrder.isCapitalQueue(q(K("\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{6625}"))))
        XCTAssertFalse(NewOrder.isCapitalQueue([]))
    }

    // test/core/new-order.test.mjs: capitalCard swaps in the money context only for a whole-capital queue; other cards and queues are untouched
    func testCapitalCardSwapsInTheMoneyContextOnlyForAWholeCapitalQueueOtherCardsAndQueuesAreUntouched() throws {
        // data/deck.js 的 capitalCard（造卡）属于 B4.3，这里没有移植。它的规则只有两步：队列整组是大写数字（NewOrder.isCapitalQueue）、
        // 且这个字有语境（CharOrder.capitalContext(of:)）才换题面。下面的本地函数按 deck.js 的写法实现同一规则，对手工构造的 JSValue 卡检验。
        func capitalCard(_ card: JSValue?, _ queue: [String]) -> JSValue? {
            guard let card = card, NewOrder.isCapitalQueue(queue.map { S($0) }) else { return card }
            guard let target = card["target"]?.stringValue, let ctx = CO.capitalContext(of: target) else { return card }
            return JS.with(card, [("word", S(ctx.word)), ("chars", .array(chars(ctx.word).map { S($0) })), ("ci", .number(Double(ctx.ci))), ("target", S(target)),
                                  ("py", S(ctx.py)), ("ctx", S("override")), ("promptHint", S(ctx.promptHint))])
        }
        let card = J(#"{"word":"\u5927\u8086","chars":["\u5927","\u8086"],"ci":1,"target":"\u8086","py":"s\u00ec","hint":"h","ctx":"dict","rank":1}"#)
        let plain = capitalCard(card, K("\u{8086}\u{5C34}\u{8D62}"))
        XCTAssertEqual(plain, card, "not a special group \u{2192} the very same card")
        let special = capitalCard(card, K("\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}"))
        XCTAssertEqual(special?["word"], S("\u{8086}\u{4EDF}\u{5143}\u{6574}"))
        XCTAssertEqual(special?["chars"], .array(chars("\u{8086}\u{4EDF}\u{5143}\u{6574}").map { S($0) }))
        XCTAssertEqual(special?["ci"], .number(0))
        XCTAssertEqual(special?["target"], S("\u{8086}"))
        XCTAssertEqual(special?["ctx"], S("override"))
        XCTAssertEqual(special?["promptHint"], S("\u{501F}\u{6761}\u{4E0A}\u{7684}\u{5927}\u{5199}\u{91D1}\u{989D}"))
        XCTAssertEqual(card["word"], S("\u{5927}\u{8086}"), "input not mutated")
        XCTAssertNil(capitalCard(nil, K("\u{58F9}")))
        let noCtx = J(#"{"word":"\u5c34\u5c2c","chars":["\u5c34","\u5c2c"],"ci":0,"target":"\u5c34"}"#)
        XCTAssertEqual(capitalCard(noCtx, K("\u{58F9}\u{8D30}\u{53C1}\u{8086}\u{4F0D}")), noCtx)
    }

    // test/core/new-order.test.mjs: D50 ⑤ ⑥ (C1): surname-only chars go to 「姓氏与地名」 whatever their frequency; heavy chars never come as new, yet stay practicable
    func testD50N5N6C1SurnameOnlyCharsGoToSurnamesAndPlacesWhateverTheirFrequencyHeavyCharsNeverComeAsNewYetStayPracticable() throws {
        XCTAssertEqual(CO.surnameOnly, chars("\u{859B}\u{5F6D}\u{6F58}\u{8521}\u{960E}\u{9B4F}\u{8881}"))
        for c in chars("\u{859B}\u{5F6D}\u{6F58}\u{8521}\u{960E}\u{9B4F}\u{8881}") {
            XCTAssertTrue(CO.surnames.contains(c), "\(c) in reserved.surnames")
            XCTAssertFalse(CO.commonKeptSurnames.contains(c), "\(c) not kept in the default order")
            XCTAssertTrue(NewOrder.isReservedChar(c))
        }
        for c in chars("\u{764C}\u{7624}\u{761F}\u{75E2}\u{7663}\u{7638}\u{68FA}\u{5993}\u{5A3C}\u{5AD6}") {
            XCTAssertTrue(CO.heavy.contains(c), "\(c) in reserved.heavy")
            XCTAssertTrue(NewOrder.isReservedChar(c))
        }
        let inOrder = Set(CO.order + CO.level2 + CO.warmup)
        for c in CO.surnameOnly + CO.heavy { XCTAssertFalse(inOrder.contains(c), "\(c) not in any default list") }
        // 字频尾部也不出现：彭 #1340、癌 #1907 这类常用字以前会按字频冒出来
        let ordered = NewOrder.orderNewKeys(K("\u{7684}\u{4E00}\u{662F}\u{5F6D}\u{6F58}\u{8521}\u{9B4F}\u{764C}\u{7624}\u{68FA}\u{5993}\u{6625}")).map(char)
        XCTAssertEqual(ordered.sorted(), chars("\u{7684}\u{4E00}\u{662F}\u{6625}").sorted(), "only the ordinary chars come as new")
        // 「仍可练」（heavy 字留在题库里）是题库适配器的事：真实适配器里它们是可练的卡。
        for c in chars("\u{764C}\u{7624}\u{761F}\u{75E2}\u{7663}\u{7638}\u{68FA}\u{5993}\u{5A3C}\u{5AD6}") where DeckIndex.shared.keys.contains("base:" + c) {
            XCTAssertTrue(DeckIndex.shared.isPracticable("base:" + c), c)
        }
    }
}
