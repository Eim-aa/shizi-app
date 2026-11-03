import Foundation
import XCTest
@testable import ShiziCore

// test/core/structure.test.mjs 的转写（7 个用例，用例名保留原名）。部件分组读题库（deck.json 的 groups），笔顺中线读 data/<字>.json（与 App 内同一份数据）。
// 第 6 条（参考字形读屏名称）原用例测的是 UI 文字拼装（src/ui/screens/write/ref-label.js：「标准写法：…」「左右结构」），那部分留在界面层（B3 / B4.5）；
// 这里转写它依赖的规则部分：同一批字的 describeStructure 结果（结构 / 部件数 / 数据没到时不说）。

final class StructureTests: XCTestCase {
    static let groups = DeckData.shared.groups

    func groupsOf(_ ch: String) -> JSValue { Self.groups[ch] ?? .null }

    func dataOf(_ ch: String) -> JSValue {
        let text = (try? readRepoFile("data/\(ch).json")) ?? "null"
        return (try? JSONParser.parse(text)) ?? .null
    }

    func mediansOf(_ ch: String) -> JSValue { dataOf(ch)["medians"] ?? .null }

    func hasData(_ ch: String) -> Bool { FileManager.default.fileExists(atPath: repoRoot.appendingPathComponent("data/\(ch).json").path) }

    let de = "\u{7684}", gen = "\u{6839}", he2 = "\u{548C}", si = "\u{601D}", hua = "\u{82B1}", nan = "\u{7537}", chang = "\u{660C}", ga = "\u{5C34}", tong = "\u{540C}", guo = "\u{56FD}"

    // validGroups：每组正整数、总和 = 笔画数
    func testValidGroupsEveryGroupAPositiveIntegerSumEqualsStrokeCount() {
        XCTAssertTrue(Structure.validGroups(J("[5,3]"), 8))
        XCTAssertFalse(Structure.validGroups(J("[5,3]"), 9))
        XCTAssertFalse(Structure.validGroups(J("[]"), 0))
        XCTAssertFalse(Structure.validGroups(J("[0,8]"), 8))
        XCTAssertFalse(Structure.validGroups(.null, 8))
    }

    // 左右结构：的（白 + 勺）、根（木 + 艮）、和（禾 + 口）
    func testLeftRightStructureDeGenHe() {
        for ch in [de, gen, he2] { XCTAssertEqual(Structure.inferStructure(groupsOf(ch), mediansOf(ch)), "lr", ch) }
    }

    // 上下结构：思（田 + 心）、花（艹 + 化）、男（田 + 力）、昌（日 + 日）
    func testTopBottomStructureSiHuaNanChang() {
        for ch in [si, hua, nan, chang] { XCTAssertEqual(Structure.inferStructure(groupsOf(ch), mediansOf(ch)), "tb", ch) }
    }

    // 包围 / 半包围 / 镶嵌与单部件不断言结构：尴（⿺）、同（⿵）、国（⿴）、大
    func testEnclosingAndSingleComponentAreNotClaimed() {
        for ch in [ga, tong, guo] {
            if (groupsOf(ch).arrayValue?.count ?? 0) != 2 { continue }
            XCTAssertNil(Structure.inferStructure(groupsOf(ch), mediansOf(ch)), ch)
        }
        XCTAssertNil(Structure.inferStructure(groupsOf(da43), mediansOf(da43)))
        XCTAssertEqual(groupsOf(ren243).arrayValue?.count, 1)
    }

    func firstChar(withGroupCount count: Int) -> String? {
        Self.groups.keys.first { (Self.groups[$0]?.arrayValue?.count ?? 0) == count && hasData($0) }
    }

    // describeStructure：断言了结构就不重复部件数；没结构时 2–4 个部件报部件数；1 个与 5 个不说
    func testDescribeStructureNoRepeatOfPartsPartsOnlyFor2To4NothingFor1And5() {
        func d(_ g: JSValue, _ m: JSValue) -> JSValue { Structure.describeStructure(groups: g, medians: m) }
        XCTAssertEqual(d(groupsOf(de), mediansOf(de)), J("{\"structure\":\"lr\",\"parts\":null}"))
        let many = firstChar(withGroupCount: 3)!
        XCTAssertEqual(d(groupsOf(many), mediansOf(many)), J("{\"structure\":null,\"parts\":3}"), many)
        let five = firstChar(withGroupCount: 5)!
        XCTAssertEqual(d(groupsOf(five), mediansOf(five)), J("{\"structure\":null,\"parts\":null}"), five)
        XCTAssertEqual(d(J("[8]"), mediansOf(de)), J("{\"structure\":null,\"parts\":null}"), "one group")
        XCTAssertEqual(d(J("[5,4]"), mediansOf(de)), J("{\"structure\":null,\"parts\":null}"), "groups do not add up to the stroke count")
        XCTAssertEqual(Structure.describeStructure(groups: nil, medians: nil), J("{\"structure\":null,\"parts\":null}"))
    }

    // 参考字形读屏名称：字，拼音，n 画，结构 / 部件数；没数据的部分不说（判断页与看答案页共用 ref-label.js）
    func testReferenceGlyphReadoutNameInputsStrokeCountStructurePartsNothingWithoutData() {
        func d(_ ch: String) -> JSValue { Structure.describeStructure(groups: groupsOf(ch), medians: mediansOf(ch)) }
        func strokes(_ ch: String) -> Int { mediansOf(ch).arrayValue?.count ?? 0 }
        XCTAssertEqual(strokes(de), 8)
        XCTAssertEqual(d(de), J("{\"structure\":\"lr\",\"parts\":null}"))
        XCTAssertEqual(strokes(si), 9)
        XCTAssertEqual(d(si), J("{\"structure\":\"tb\",\"parts\":null}"))
        let many = firstChar(withGroupCount: 3)!
        XCTAssertEqual(d(many)["parts"], n43(3))
        XCTAssertEqual(strokes(ren243), 2)
        XCTAssertEqual(d(ren243), J("{\"structure\":null,\"parts\":null}"), "one component: say nothing")
        XCTAssertEqual(strokes(da43), 3)
        XCTAssertEqual(d(da43), J("{\"structure\":null,\"parts\":2}"), "nested 2 components: geometry cannot tell the structure, only the part count")
        // 数据没到：没有笔顺中线 -> 不说；没有分组数据 -> 不说
        XCTAssertEqual(Structure.describeStructure(groups: groupsOf(de), medians: nil), J("{\"structure\":null,\"parts\":null}"))
        XCTAssertEqual(Structure.describeStructure(groups: nil, medians: mediansOf(de)), J("{\"structure\":null,\"parts\":null}"))
    }

    // 校准：2 部件字里断言的结构与 MMAH 的 IDS 一致（只读测试，不随 App 发布）
    func testCalibrationTwoComponentClaimsAgreeWithMMAHIDS() throws {
        let path = repoRoot.appendingPathComponent("sources/make-me-a-hanzi-dict.txt")
        guard FileManager.default.fileExists(atPath: path.path) else { throw XCTSkip("sources/make-me-a-hanzi-dict.txt is not in this checkout") }
        let text = String(decoding: try Data(contentsOf: path), as: UTF8.self)
        var ids: [String: String] = [:]
        for line in text.split(separator: "\n") where !line.isEmpty {
            guard let r = try? JSONParser.parse(String(line)), let ch = r.str("character") else { continue }
            ids[ch] = r.str("decomposition").flatMap { $0.unicodeScalars.first.map { String($0) } } ?? ""
        }
        let truth = ["\u{2FF0}": "lr", "\u{2FF1}": "tb"]
        let enclosing = Set("\u{2FF4}\u{2FF5}\u{2FF6}\u{2FF7}\u{2FF8}\u{2FF9}\u{2FFA}".unicodeScalars.map { String($0) })
        var claimed = 0, right = 0, enclosureClaimed = 0, twoPart = 0
        for ch in Self.groups.keys {
            guard let g = Self.groups[ch], g.arrayValue?.count == 2, let id = ids[ch], hasData(ch) else { continue }
            let medians = mediansOf(ch)
            guard Structure.validGroups(g, medians.arrayValue?.count ?? 0) else { continue }
            twoPart += 1
            guard let got = Structure.inferStructure(g, medians) else { continue }
            claimed += 1
            if truth[id] == got { right += 1 } else if enclosing.contains(id) { enclosureClaimed += 1 }
        }
        XCTAssertGreaterThan(twoPart, 2000, "2-part chars: \(twoPart)")
        XCTAssertGreaterThan(claimed, 1200, "claims: \(claimed)")
        XCTAssertGreaterThanOrEqual(Double(right) / Double(claimed), 0.995, "precision \(right)/\(claimed)")
        XCTAssertLessThanOrEqual(enclosureClaimed, 3, "enclosing structures claimed as lr/tb: \(enclosureClaimed)")
    }
}
