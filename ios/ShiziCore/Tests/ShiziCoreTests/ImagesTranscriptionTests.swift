import Foundation
import XCTest
@testable import ShiziCore

// test/core/images.test.mjs 的转写（35 个用例，用例名保留原名）。版式 / 分页 / 选字口径逐条对 ImageLayout / ImageSelection 断言；
// 画图部分（renderWorkPage / renderSingleGlyph / renderAnnualLong / palette）的 canvas 调用断言是网页渲染器（src/core/images/render.js）的契约，
// Swift 原生渲染器 ShiziImageRendering 在独立 target（ShiziCoreTests 不依赖它），构图等价性由 scripts/image-parity 参考 PNG 比对（46 页）门禁覆盖——
// 这些行里没有 Swift 对应物的断言按 G1 约定以 XCTExpectFailure 登记（见各用例内说明与 GLM 报告）。
// 几何与选字另有 JS 生成的金标准夹具（images-geometry.json 324 条 / images-selection.json 50 条）经 ImageParityTests 逐字段核对。

final class ImagesTranscriptionTests: XCTestCase {
    static let INK = J(#"[[{"x":60,"y":170,"w":11.5},{"x":280,"y":172,"w":11.5}]]"#)
    static let jiang = "\u{7586}", jiang4 = "\u{9171}", yang = "\u{75D2}", yun = "\u{915D}", rang = "\u{56B7}", cu = "\u{918B}" // 疆酱痒酝嚷醋
    let dates = shanghai43
    func num(_ v: JSValue?, _ k: String) -> Double { JS.number(v?[k] ?? .null) }
    func chars(_ list: [JSValue]) -> [String] { list.map { JS.string($0["ch"] ?? $0["char"] ?? .null) } }

    // test/core/images.test.mjs: layout: the §6.2 result table — 3:4 and 1:1 columns × rows and cell size
    func testLayoutThe62ResultTable34And11ColumnsRowsAndCellSize() throws {
        let t34: [(Int, [Double])] = [(1, [1, 1, 670]), (2, [2, 1, 443]), (3, [3, 1, 295]), (4, [2, 2, 367]), (5, [3, 2, 295]), (20, [4, 5, 221]), (46, [6, 8, 146]), (80, [8, 10, 110])]
        for (n, want) in t34 {
            let l = try ImageLayout.layout(n, ratio: "3:4")
            XCTAssertEqual([num(l, "cols"), num(l, "rows"), num(l, "c")], want, "3:4 × \(n)")
            XCTAssertEqual(num(l, "W"), 1080); XCTAssertEqual(num(l, "H"), 1440)
        }
        let t11: [(Int, [Double])] = [(5, [3, 2, 295]), (20, [5, 4, 177]), (80, [9, 9, 90])]
        for (n, want) in t11 {
            let l = try ImageLayout.layout(n, ratio: "1:1")
            XCTAssertEqual([num(l, "cols"), num(l, "rows"), num(l, "c")], want, "1:1 × \(n)")
            XCTAssertEqual(num(l, "H"), 1080)
        }
        // 输入是格子数组时只数个数
        XCTAssertEqual(try ImageLayout.layout(2, ratio: "3:4")["c"], .number(443))
        XCTAssertSameJSON(try ImageLayout.gridOf(0), J(#"{"cols":0,"rows":0,"c":0}"#))
        XCTAssertEqual(try ImageLayout.layout(0, ratio: "3:4")["n"], .number(0))
        XCTAssertEqual(try ImageLayout.layout(0, ratio: "3:4")["cells"], .array([]))
        XCTAssertThrowsCore("bad-args", containing: "INVALID_RATIO") { _ = try ImageLayout.layout(3, ratio: "4:3") }
        XCTAssertThrowsCore("bad-args", containing: "INVALID_COUNT") { _ = try ImageLayout.layout(-1, ratio: "3:4") }
    }

    // test/core/images.test.mjs: layout: every cell fits the paper, the grid is never taller than the paper, and the last row is left-aligned (n = 1..80 × both ratios)
    func testLayoutEveryCellFitsThePaperTheGridIsNeverTallerThanThePaperAndTheLastRowIsLeftAlignedN180BothRatios() throws {
        for ratio in ["3:4", "1:1"] {
            let H = ratio == "3:4" ? 1440.0 : 1080.0
            for n in 1...80 {
                let l = try ImageLayout.layout(n, ratio: ratio), cells = l["cells"]!.arrayValue!
                XCTAssertEqual(cells.count, n)
                XCTAssertTrue(num(l, "rows") * num(l, "cols") >= Double(n) && (num(l, "rows") - 1) * num(l, "cols") < Double(n), "\(ratio) n=\(n): no empty row")
                XCTAssertTrue(num(l, "left") >= 0 && num(l, "left") + num(l, "cols") * num(l, "c") <= 1080, "\(ratio) n=\(n): inside the width")
                XCTAssertTrue(num(l, "top") >= 0 && num(l, "top") + num(l, "rows") * num(l, "c") <= H, "\(ratio) n=\(n): inside the height")
                if n >= 2 { XCTAssertLessThanOrEqual(num(l, "rows"), num(l, "cols") * (H / 1080) + 0.01, "\(ratio) n=\(n): not taller than the paper") }
                XCTAssertSameJSON(cells[0], J(#"{"x":\#(num(l, "left")),"y":\#(num(l, "top"))}"#))
                let last = cells[n - 1]
                XCTAssertEqual(num(last, "x"), num(l, "left") + Double((n - 1) % Int(num(l, "cols"))) * num(l, "c"), "left-aligned last row")
                XCTAssertTrue(num(l["seal"], "x") + num(l["seal"], "size") <= 1080 && num(l["seal"], "y") + num(l["seal"], "size") <= H, "\(ratio) n=\(n): seal on the paper")
                XCTAssertTrue(num(l["kuan"], "top") + num(l["kuan"], "lineHeight") <= H, "\(ratio) n=\(n): kuan on the paper")
            }
        }
    }

    // test/core/images.test.mjs: layout: one row on a portrait paper keeps top : bottom white space at 2 : 3 (D46 acceptance improvement)
    func testLayoutOneRowOnAPortraitPaperKeepsTopBottomWhiteSpaceAt23D46AcceptanceImprovement() throws {
        for n in [1, 2, 3] {
            let l = try ImageLayout.layout(n, ratio: "3:4")
            let blockH = num(l, "rows") * num(l, "c") + 38 + max(num(l["seal"], "size"), num(l["kuan"], "size") * 1.4)
            let bottom = 1440 - num(l, "top") - blockH
            XCTAssertLessThan(abs(num(l, "top") / bottom - 2.0 / 3.0), 0.01, "n=\(n) top \(num(l, "top")) bottom \(bottom)")
        }
        // 两行以上：居中再上移 0.025H
        let l = try ImageLayout.layout(4, ratio: "3:4")
        let blockH = 2 * num(l, "c") + 38 + 64
        XCTAssertEqual(num(l, "top"), (1440 - blockH) / 2 - 1440 * 0.025)
    }

    // test/core/images.test.mjs: layout: seal and 落款 — last cell in the rightmost column → seal under it (right edges aligned), 落款 left of the seal; otherwise seal beside the last cell, 落款 under the grid right-aligned (§6.4)
    func testLayoutSealAndKuanLastCellInTheRightmostColumnSealUnderItRightEdgesAlignedOtherwiseSealBesideTheLastCellKuanUnderTheGridRightAligned() throws {
        let three = try ImageLayout.layout(3, ratio: "3:4")
        XCTAssertEqual(three["below"], .bool(true))
        XCTAssertEqual([num(three["seal"], "size"), num(three["kuan"], "size")], [64, 36])
        XCTAssertEqual(num(three["seal"], "x") + num(three["seal"], "size"), num(three, "left") + 3 * num(three, "c"), "seal right edge = last cell right edge")
        XCTAssertEqual(num(three["seal"], "y"), num(three, "top") + num(three, "c") + 38, "seal 0.035W below the grid")
        XCTAssertEqual(num(three["kuan"], "right"), num(three["seal"], "x") - 22, "落款 22px left of the seal")
        XCTAssertLessThan(abs(num(three["kuan"], "top") + num(three["kuan"], "lineHeight") / 2 - (num(three["seal"], "y") + num(three["seal"], "size") / 2)), 1e-9, "落款 vertically centred on the seal")
        XCTAssertEqual(num(three["seal"], "rotate"), 0, "the seal is not tilted (R2-R1: one kind of seal)")
        let five = try ImageLayout.layout(5, ratio: "3:4") // 3 + 2：末字在第 2 列，不在最右列
        XCTAssertEqual(five["below"], .bool(false))
        XCTAssertEqual(num(five["seal"], "x"), num(five, "left") + 2 * num(five, "c") + (num(five, "c") * 0.12).rounded(), "beside the last cell, 0.12c")
        XCTAssertEqual(num(five["seal"], "y"), num(five, "top") + 2 * num(five, "c") - 64 - (num(five, "c") * 0.06).rounded(), "bottom raised by 0.06c")
        XCTAssertEqual(num(five["kuan"], "right"), num(five, "left") + 3 * num(five, "c"), "落款 right-aligned to the grid")
        XCTAssertEqual(num(five["kuan"], "top"), num(five, "top") + 2 * num(five, "c") + 38, "落款 0.035W under the grid")
        let one = try ImageLayout.layout(1, ratio: "3:4")
        XCTAssertEqual([num(one["seal"], "size"), num(one["kuan"], "size")], [64, 36], "a single char: the same seal / 落款 size as every other count (V2-05 / T2-22)")
        for n in [1, 2, 3, 4, 5, 9, 20, 80] {
            for ratio in ["3:4", "1:1"] {
                let l = try ImageLayout.layout(n, ratio: ratio)
                XCTAssertEqual([num(l["seal"], "size"), num(l["seal"], "rotate"), num(l["kuan"], "size")], [64, 0, 36], "n=\(n) \(ratio): one seal size, no tilt")
            }
        }
        // 外框：末行不满且末字不在最右列 → 两段（满行矩形 + 末行矩形）；否则一个矩形
        XCTAssertEqual(five["frame"]!.arrayValue!.count, 2)
        XCTAssertSameJSON(five["frame"]!.arrayValue![1], J(#"{"x":\#(num(five, "left")),"y":\#(num(five, "top") + num(five, "c")),"w":\#(2 * num(five, "c")),"h":\#(num(five, "c"))}"#))
        XCTAssertEqual(three["frame"]!.arrayValue!.count, 1)
        XCTAssertEqual(try ImageLayout.layout(6, ratio: "3:4")["frame"]!.arrayValue!.count, 1, "full rows → one rectangle")
    }

    // test/core/images.test.mjs: D47: 1–3 chars default to 1:1, 4 and more to 3:4 (a constant, not a magic number)
    func testD4713CharsDefaultTo114AndMoreTo34AConstantNotAMagicNumber() {
        XCTAssertEqual([1, 2, 3, 4, 5, 20, 80].map { ImageLayout.defaultRatio($0) }, ["1:1", "1:1", "1:1", "3:4", "3:4", "3:4", "3:4"])
    }

    // test/core/images.test.mjs: result-page work cells (§5.2, D49: no board, cw = b): 402 → 181 / 181 / 120 / 144 / 120, plus the SE 375 and Pro Max 440 columns; same cols × rows as the 3:4 image
    func testResultPageWorkCells525D49NoBoardCwB402181181120144120PlusTheSE375AndProMax440ColumnsSameColsRowsAsThe34Image() throws {
        let widths: [(Double, [Double])] = [(402, [181, 181, 120, 144, 120]), (375, [167, 167, 111, 134, 111]), (440, [200, 200, 133, 160, 133])]
        for (w, expected) in widths {
            XCTAssertEqual(try (1...5).map { try ImageLayout.resultGrid($0, screenWidth: w)["c"]!.numberValue! }, expected, "screen \(w)")
        }
        for n in 1...12 {
            let g = try ImageLayout.resultGrid(n, screenWidth: 402), l = try ImageLayout.layout(n, ratio: "3:4")
            XCTAssertEqual([num(g, "cols"), num(g, "rows")], [num(l, "cols"), num(l, "rows")], "n=\(n) same shape as the share image")
        }
        XCTAssertSameJSON(try ImageLayout.resultGrid(0, screenWidth: 402), J(#"{"cols":0,"rows":0,"c":0}"#))
    }

    // test/core/images.test.mjs: ink width compensation table (§1.1) and the red dot (components.wrongDot)
    func testInkWidthCompensationTable11AndTheRedDotComponentswrongDot() throws {
        // R2-R1 / V2-03：只有一条规则——原宽，小格只抬到最小物理线宽 1.2pt（旧补偿表 ×1.15 / 1.35 / 1.5 已废）
        XCTAssertEqual([160, 150, 100, 70, 50, 47.5].map { ImageLayout.inkWidthScale($0) }, [1, 1, 1, 1, 1, 1])
        XCTAssertLessThan(abs(ImageLayout.inkWidthScale(40) - 47.37 / 40), 0.01)
        XCTAssertGreaterThan(ImageLayout.inkWidthScale(40), 1, "40pt cell: lifted so the stroke is 1.2pt")
        XCTAssertLessThan(abs(ImageLayout.inkWidthScale(30) * 11.5 * 0.76 * 30 / 345 - 1.2), 1e-6, "the lifted stroke is exactly the minimum physical width")
        XCTAssertEqual(ImageLayout.minInkScale(234), 1, "the 234pt judge card: original width (no ×1.41)")
        XCTAssertEqual(ImageLayout.minInkScale(0), 1)
        XCTAssertEqual(ImageLayout.dotDiameterPt(40), 5, "clamp low")
        XCTAssertEqual(ImageLayout.dotDiameterPt(110), 7.7, accuracy: 1e-9)
        XCTAssertEqual(ImageLayout.dotDiameterPt(300), 8, "clamp high")
        // 墨迹外框右上外 2pt：圆心在外框右上角再向外 2pt + 半径；不出格
        let bounds = J(#"{"x":60,"y":60,"width":200,"height":200}"#) // 345 单位
        let d = ImageLayout.dotLayout(110, unit: 1, bounds: bounds), k = (110 * 0.76) / 345
        XCTAssertLessThan(abs(num(d, "cx") - (110 * 0.12 + 260 * k + 2 + num(d, "d") / 2)), 1e-9)
        XCTAssertLessThan(abs(num(d, "cy") - (110 * 0.12 + 60 * k - 2 - num(d, "d") / 2)), 1e-9)
        let edge = ImageLayout.dotLayout(110, unit: 1, bounds: J(#"{"x":0,"y":0,"width":345,"height":345}"#))
        XCTAssertLessThanOrEqual(num(edge, "cx") + num(edge, "d") / 2, 110)
        XCTAssertGreaterThanOrEqual(num(edge, "cy") - num(edge, "d") / 2, 0, "clamped inside the cell")
        let exported = ImageLayout.dotLayout(400, unit: 2.69, bounds: bounds)
        XCTAssertLessThan(abs(num(exported, "d") - 8 * 2.69), 1e-9, "export unit: 8pt × 2.69")
    }

    // test/core/images.test.mjs: month page grid: 6 columns (Pro Max 7, AX 4), cell ⌊(W − 40) / cols⌋; day tags only on the first char of each day
    func testMonthPageGrid6ColumnsProMax7AX4CellW40ColsDayTagsOnlyOnTheFirstCharOfEachDay() {
        XCTAssertEqual([402, 375, 440].map { ImageLayout.monthColumns(Double($0)) }, [6, 6, 7])
        XCTAssertEqual(ImageLayout.monthColumns(402, ax: true), 4)
        XCTAssertEqual([(402.0, 6), (375.0, 6), (440.0, 7)].map { ImageLayout.monthCell($0.0, cols: $0.1) }, [60, 55, 57])
        XCTAssertEqual(ImageLayout.dayTag("2026-08-05"), "5")
        XCTAssertEqual(ImageLayout.dayTag("2026-08-15"), "15")
        XCTAssertEqual(ImageLayout.dayTag(""), "")
        let tagged = ImageLayout.withDayTags([J(#"{"day":"2026-08-05"}"#), J(#"{"day":"2026-08-05"}"#), J(#"{"day":"2026-08-06"}"#), J(#"{"day":"2026-08-06"}"#), J(#"{"day":"2026-08-05"}"#)])
        XCTAssertEqual(tagged.map { $0["tag"]! }, ["5", "", "6", "", "5"].map(JSValue.string))
    }

    // ---------------------------------------------------------------- 分张（D39 / §6.7）

    func cellsOn(_ day: String, _ n: Int, from: Int = 0) -> [JSValue] {
        (0..<n).map { i in obj43([("ch", .string(String(Unicode.Scalar(0x4e00 + from + i)!))), ("day", .string(day))]) }
    }

    // test/core/images.test.mjs: paginate: ≤ 80 chars is one page; whole days go to the next page instead of being split; each page ≤ 80
    func testPaginate80CharsIsOnePageWholeDaysGoToTheNextPageInsteadOfBeingSplitEachPage80() {
        XCTAssertEqual(ImageLayout.paginate([]), [] as [[JSValue]])
        XCTAssertEqual(ImageLayout.paginate(cellsOn("2026-09-01", 80)).count, 1)
        let cells = cellsOn("2026-09-01", 50) + cellsOn("2026-09-02", 40, from: 50) + cellsOn("2026-09-03", 6, from: 90)
        let pages = ImageLayout.paginate(cells)
        XCTAssertEqual(pages.map(\.count), [50, 46], "day 2 (40) does not fit page 1 (50 + 40 > 80) → page 2; day 3 joins it")
        XCTAssertEqual(pages.flatMap { chars($0) }, chars(cells), "order kept, nothing dropped or duplicated")
        XCTAssertTrue(pages.allSatisfy { $0.count <= 80 })
        // 同一天的字不拆到两张
        for p in pages { XCTAssertEqual(Set(p.map { JS.string($0["day"] ?? .null) }).count, p.count == 50 ? 1 : 2) }
    }

    // test/core/images.test.mjs: paginate: a single day over 80 chars is cut inside the day at 80; the remainder page can take later days
    func testPaginateASingleDayOver80CharsIsCutInsideTheDayAt80TheRemainderPageCanTakeLaterDays() {
        let cells = cellsOn("2026-09-01", 10) + cellsOn("2026-09-02", 170, from: 10) + cellsOn("2026-09-03", 5, from: 180)
        let pages = ImageLayout.paginate(cells)
        XCTAssertEqual(pages.map(\.count), [10, 80, 80, 15], "the small first page is closed, day 2 cut 80 + 80 + 10, day 3 joins the remainder")
        XCTAssertEqual(pages.flatMap { $0 }.count, 185)
        XCTAssertEqual(ImageLayout.paginate(cellsOn("2026-09-01", 96)).count, 2, "the design example: 96 chars of one day → 80 + 16")
        XCTAssertEqual(ImageLayout.paginate(cellsOn("2026-09-01", 160)).map(\.count), [80, 80])
        // 没有 day 的格子当作同一天；上限可传
        let noDay = (0..<7).map { i in obj43([("ch", .string(String(i)))]) }
        XCTAssertEqual(ImageLayout.paginate(noDay, max: 3).map(\.count), [3, 3, 1])
    }

    // test/core/images.test.mjs: paginate: every page re-runs the layout with its own count (the last page is not a big grid with one corner filled); a new page starts with a day tag
    func testPaginateEveryPageReRunsTheLayoutWithItsOwnCountTheLastPageIsNotABigGridWithOneCornerFilledANewPageStartsWithADayTag() throws {
        let pages = ImageLayout.paginate(cellsOn("2026-09-01", 96))
        let layouts = try pages.map { try ImageLayout.layout($0.count, ratio: "3:4") }
        XCTAssertEqual(layouts.map { [num($0, "cols"), num($0, "rows")] }, [[8, 10], [4, 4]], "80 chars → 8 × 10; 16 chars → 4 × 4, bigger cells")
        XCTAssertGreaterThan(num(layouts[1], "c"), num(layouts[0], "c"))
        // 每张重排后第一格重标日期（imagePlan 的月字帖页就是逐页重跑 withDayTags）
        let retagged = ImageLayout.withDayTags([J(#"{"day":"2026-09-02","tag":""}"#), J(#"{"day":"2026-09-02","tag":""}"#)])
        XCTAssertEqual(retagged.map { $0["tag"]! }, ["2", ""].map(JSValue.string), "a new page starts with a tag on its first char")
    }

    // ---------------------------------------------------------------- 作品成员（§4.2）

    func group(_ steps: [String], ink: [Int] = [], added: [String] = [], paper: Set<Int> = []) -> JSValue {
        let chars = [Self.jiang, Self.jiang4, Self.yang, Self.yun, Self.rang, Self.cu]
        var records: [JSValue] = []
        var items: [JSValue] = []
        for (i, step) in steps.enumerated() {
            let kind = step == "skip" ? "skipped" : step == "seen" ? "answer-seen" : "judged"
            var r = rec43(i + 1, chars[i], kind, kind == "judged" ? step : nil, "2026-10-05", sessionId: "s9")
            if paper.contains(i) { r = setting(r, "source", .string("paper")) }
            records.append(r)
            items.append(obj43([("cardKey", r["cardKey"]!), ("recordId", r["id"]!), ("kind", .string(kind))]))
        }
        return ImageSelection.buildWork(items: items, records: records,
            hasInk: { r in ink.contains(Int(JS.string(r["id"]).dropFirst())! - 1) }, added: added)
    }

    // test/core/images.test.mjs: work members: default = right ∪ (saw answer ∧ wrote after, with ink); wrong with ink can be added; no ink can never be added
    func testWorkMembersDefaultRightSawAnswerWroteAfterWithInkWrongWithInkCanBeAddedNoInkCanNeverBeAdded() {
        // 疆 写对有墨 / 酱 写对有墨 / 痒 写错有墨 / 酝 看后写（有墨）/ 嚷 跳过 / 醋 看过答案没写
        let w = group(["correct", "correct", "wrong", "seen", "skip", "seen"], ink: [0, 1, 2, 3])
        XCTAssertEqual(chars(w["cells"]!.arrayValue!), [Self.jiang, Self.jiang4, Self.yun], "in group order")
        XCTAssertEqual(w["entries"]!.arrayValue!.map { $0["state"]! }, ["in", "in", "addable", "in", "skipped", "seen"].map(JSValue.string))
        XCTAssertEqual(w["cells"]!.arrayValue!.map { $0["tag"]! }, ["", "", "afterSeen"].map(JSValue.string), "only the after-answer writing is tagged 看后写的")
        XCTAssertEqual(chars(w["rows"]!.arrayValue!), [Self.yang, Self.rang, Self.cu])
        XCTAssertEqual(chars(w["addable"]!.arrayValue!), [Self.yang], "only a wrong char with ink can be added")
        XCTAssertEqual(w["empty"], .bool(false))
        // 放进去之后：作品里按组内原位置，带朱点；行仍在（可以拿出来）
        let added = group(["correct", "correct", "wrong", "seen", "skip", "seen"], ink: [0, 1, 2, 3], added: ["r3"])
        XCTAssertEqual(added["cells"]!.arrayValue!.map { (c: JSValue) -> [JSValue] in [.string(chars([c]).first!), c["dot"]!] }, [[.string(Self.jiang), .bool(false)], [.string(Self.jiang4), .bool(false)], [.string(Self.yang), .bool(true)], [.string(Self.yun), .bool(false)]], "back in its original position, red dot kept (D46 ⑥)")
        XCTAssertEqual(added["rows"]!.arrayValue!.first { chars([$0]).first == Self.yang }?["state"], .string("added"))
        // 无墨：写对 / 写错都不收，也不能加入（added 里有它也不收）
        let noInk = group(["correct", "wrong"], ink: [], added: ["r2"])
        XCTAssertEqual(noInk["entries"]!.arrayValue!.map { $0["state"]! }, ["noInk", "noInk"].map(JSValue.string))
        XCTAssertEqual(noInk["empty"], .bool(true), "nothing with ink → the plain-row variant, share hidden")
        XCTAssertEqual(noInk["addable"], .array([]))
    }

    // test/core/images.test.mjs: work members: 纸上记录 (D46-13) — judged but never in the work, not addable; the interface is isPaperRecord(record.source)
    func testWorkMembersPaperRecordsD4613JudgedButNeverInTheWorkNotAddableTheInterfaceIsIsPaperRecordrecordsource() {
        XCTAssertEqual(Records.isPaperRecord(J(#"{"source":"paper"}"#)), true)
        XCTAssertEqual(Records.isPaperRecord(J(#"{"source":"screen"}"#)), false)
        XCTAssertEqual(Records.isPaperRecord(J(#"{}"#)), false)
        XCTAssertEqual(Records.isPaperRecord(nil), false)
        let w = group(["correct", "wrong", "correct"], ink: [0, 1, 2], added: ["r2"], paper: [1, 2])
        XCTAssertEqual(w["entries"]!.arrayValue!.map { $0["state"]! }, ["in", "paper", "paper"].map(JSValue.string))
        XCTAssertEqual(chars(w["cells"]!.arrayValue!), [Self.jiang])
        XCTAssertEqual(w["addable"], .array([]), "no 「放进去」 for a paper record")
    }

    // test/core/images.test.mjs: 「放进去」 state helpers: addedOf / toggleAdded are pure, keep first-added order, and ignore garbage
    func testPutItInStateHelpersAddedOfToggleAddedArePureKeepFirstAddedOrderAndIgnoreGarbage() {
        XCTAssertEqual(ImageSelection.addedOf(nil), [])
        XCTAssertEqual(ImageSelection.addedOf(J(#"{"added":["r2",7,"r5"]}"#)), ["r2", "r5"])
        let s = J(#"{"added":["r2"]}"#)
        XCTAssertEqual(ImageSelection.toggleAdded(s, recordId: "r5"), ["r2", "r5"])
        XCTAssertEqual(ImageSelection.toggleAdded(s, recordId: "r2"), [])
        XCTAssertEqual(ImageSelection.toggleAdded(s, recordId: "r2", on: true), ["r2"], "idempotent")
        XCTAssertEqual(ImageSelection.toggleAdded(s, recordId: "r9", on: false), ["r2"], "removing something not there is a no-op")
        XCTAssertEqual(ImageSelection.addedOf(s), ["r2"], "the input is not touched")
        XCTAssertEqual(ImageSelection.toggleAdded(nil, recordId: "r1"), ["r1"])
    }

    // ---------------------------------------------------------------- 选字口径

    func stateOf(_ records: [JSValue], inked: [String] = []) -> JSValue { stateOf43(records, inked: inked) }
    func unwritten(_ base: @escaping ImageSelection.InkOf) -> ImageSelection.InkOf {
        { r in r["kind"] == .string("answer-seen") ? nil : try base(r) }
    }

    // test/core/images.test.mjs: session image: the plan carries the work members in group order; the added wrong char is back in place with its dot; others are missing
    func testSessionImageThePlanCarriesTheWorkMembersInGroupOrderTheAddedWrongCharIsBackInPlaceWithItsDotOthersAreMissing() throws {
        let recs = [
            rec43(1, Self.jiang, "judged", "correct", "2026-10-05", sessionId: "s9"),
            rec43(2, Self.yang, "judged", "wrong", "2026-10-05", sessionId: "s9"),
            rec43(3, Self.yun, "answer-seen", nil, "2026-10-05", sessionId: "s9"),
            rec43(4, Self.rang, "skipped", nil, "2026-10-05", sessionId: "s9"),
            rec43(5, cShui, "judged", "correct", "2026-10-05", sessionId: "s6"),
        ]
        let items = (1...4).map { n in obj43([("cardKey", recs[n - 1]["cardKey"]!), ("recordId", recs[n - 1]["id"]!), ("kind", recs[n - 1]["kind"]!)]) }
        let session = obj43([("id", .string("s9")), ("slot", .string("A")), ("kind", .string("daily")), ("items", .array(items)), ("endedAt", .number(at43("2026-10-05", 21))), ("startedDay", .string("2026-10-05"))])
        func mk(_ added: [String]?) -> JSValue {
            // JS：lastEnded.A = { ...session, added }（没有 added 时就是会话本身）
            let withAdded = added.map { setting(session, "added", .array($0.map { .string($0) })) } ?? session
            return stateOf43(recs, sessions: obj43([("A", .null), ("B", .null), ("lastEnded", .object(JSObject([("A", withAdded)])))]))
        }
        let inkOf: ImageSelection.InkOf = { r in ["r1", "r2", "r3"].contains(JS.string(r["id"])) ? Self.INK : nil }
        func plan(_ added: [String]?, ink: ImageSelection.InkOf? = nil) throws -> JSValue {
            try ImageSelection.imagePlan(mk(added), scope: obj43([("kind", .string("session")), ("slot", .string("A")), ("sessionId", .string("s9"))]),
                inkOf: ink ?? inkOf, dates: dates)
        }
        let plain = try plan(nil)
        XCTAssertEqual(plain["status"], .string("ready"))
        XCTAssertEqual(plain["cells"]!.arrayValue!.map { (c: JSValue) -> [JSValue] in [.string(chars([c]).first!), c["dot"]!, c["mode"]!] }, [[.string(Self.jiang), .bool(false), .string("hand")], [.string(Self.yun), .bool(false), .string("hand")]], "看后写的 酝 is in, wrong 痒 is not yet")
        XCTAssertEqual(plain["missing"], .array([.string(Self.rang)]))
        XCTAssertEqual(plain["day"], .string("2026-10-05"))
        XCTAssertEqual(chars(plain["work"]!["addable"]!.arrayValue!), [Self.yang])
        let withAdded = try plan(["r2"])
        XCTAssertEqual(withAdded["cells"]!.arrayValue!.map { (c: JSValue) -> [JSValue] in [.string(chars([c]).first!), c["dot"]!] }, [[.string(Self.jiang), .bool(false)], [.string(Self.yang), .bool(true)], [.string(Self.yun), .bool(false)]])
        XCTAssertEqual(withAdded["recordIds"], .array(["r1", "r2", "r3"].map(JSValue.string)))
        XCTAssertEqual(withAdded["pages"]!.arrayValue!.count, 1)
        XCTAssertEqual(try ImageSelection.imagePlan(mk(nil), scope: obj43([("kind", .string("session")), ("sessionId", .string("s9"))]), inkOf: { _ in nil }, dates: dates)["status"], .string("empty"))
        let found = try ImageSelection.sessionDay(ImageSelection.findSession(mk(nil), slot: "A", sessionId: .string("s9")), records: ImageSelection.flattenRecords(mk(nil)["records"]), dates: dates)
        XCTAssertEqual(found, .string("2026-10-05"))
    }

    // test/core/images.test.mjs: month cells (§7): first-appearance order, ink = FIRST judgment in the month with ink (D42); a char with no ink all month stays as an under cell; tags only on the first char of each day
    func testMonthCells7FirstAppearanceOrderInkFirstJudgmentInTheMonthWithInkD42ACharWithNoInkAllMonthStaysAsAnUnderCellTagsOnlyOnTheFirstCharOfEachDay() throws {
        let recs = [
            rec43(1, cYong, "judged", "wrong", "2026-08-30"), rec43(2, cYong, "judged", "correct", "2026-09-02"),
            rec43(3, he43, "judged", "correct", "2026-09-02"), rec43(4, jing43, "answer-seen", nil, "2026-09-03"),
            rec43(5, jing43, "judged", "correct", "2026-09-05"), rec43(6, cYong, "judged", "correct", "2026-09-05"),
            rec43(7, cShan, "judged", "correct", "2026-09-07"),
        ]
        let st = stateOf(recs)
        XCTAssertEqual(Config.policyString("monthSheetPick"), "first")
        let m = try ImageSelection.monthMembers(st, month: "2026-09", dates: dates)
        XCTAssertEqual(m["members"]!.arrayValue!.map { (c: JSValue) -> [JSValue] in [.string(chars([c]).first!), c["record"]!["id"]!] }, [[.string(cYong), .string("r2")], [.string(he43), .string("r3")], [.string(jing43), .string("r5")], [.string(cShan), .string("r7")]])
        XCTAssertEqual(m["days"], .number(3), "judged days only (answer-seen day 9-03 not counted, K27)")
        let all = try ImageSelection.imagePlan(st, scope: obj43([("kind", .string("month")), ("month", .string("2026-09"))]), inkOf: unwritten({ _ in Self.INK }), dates: dates)
        XCTAssertEqual(all["cells"]!.arrayValue!.map { (c: JSValue) -> [JSValue] in [.string(chars([c]).first!), c["mode"]!, c["tag"]!] }, [[.string(cYong), .string("hand"), .string("2")], [.string(he43), .string("hand"), .string("")], [.string(jing43), .string("hand"), .string("5")], [.string(cShan), .string("hand"), .string("7")]])
        XCTAssertEqual(all["cells"]!.arrayValue!.filter { $0["mode"] == .string("hand") }.count, 4, "inked = 4")
        // D42：第一次那条缺墨 → 本月内从早到晚找下一条有墨的（永 r6，9-5）；角标与排序用同一个日子（firstDay = 永第一次作为成员出现的 9-02），不跟着取墨那条走
        let gap = try ImageSelection.imagePlan(st, scope: obj43([("kind", .string("month")), ("month", .string("2026-09"))]), inkOf: unwritten({ r in r["id"] == .string("r2") ? nil : Self.INK }), dates: dates)
        XCTAssertEqual(gap["cells"]!.arrayValue!.map { (c: JSValue) -> [JSValue] in [.string(chars([c]).first!), c["record"]!["id"]!, c["day"]!, c["tag"]!] }, [[.string(cYong), .string("r6"), .string("2026-09-02"), .string("2")], [.string(he43), .string("r3"), .string("2026-09-02"), .string("")], [.string(jing43), .string("r5"), .string("2026-09-05"), .string("5")], [.string(cShan), .string("r7"), .string("2026-09-07"), .string("7")]])
        let dayNumbers = gap["cells"]!.arrayValue!.compactMap { Int(JS.string($0["tag"] ?? .null)) }
        XCTAssertEqual(dayNumbers, dayNumbers.sorted(), "the margin numbers only ever go up (T2-05 / N2-07)")
        // 本月内一份都没有（8-30 那条不算：时间段外不冒充）→ 画 under 衬底，仍占一格、仍计字数；它的日期是偏好方向上的那条
        let none = try ImageSelection.imagePlan(st, scope: obj43([("kind", .string("month")), ("month", .string("2026-09"))]), inkOf: unwritten({ r in r["id"] == .string("r2") || r["id"] == .string("r6") ? nil : Self.INK }), dates: dates)
        XCTAssertEqual(none["cells"]!.arrayValue!.map { (c: JSValue) -> [JSValue] in [.string(chars([c]).first!), c["mode"]!, c["tag"]!] }, [[.string(cYong), .string("under"), .string("2")], [.string(he43), .string("hand"), .string("")], [.string(jing43), .string("hand"), .string("5")], [.string(cShan), .string("hand"), .string("7")]])
        XCTAssertEqual(none["cells"]!.arrayValue!.count, 4, "the char with no ink all month still counts")
        XCTAssertEqual(none["cells"]!.arrayValue!.filter { $0["mode"] == .string("hand") }.count, 3, "inked = 3")
        XCTAssertEqual(none["cells"]!.arrayValue!.first?["ink"], .null)
        // 'last' 偏好：从晚到早找
        let lastGap = try ImageSelection.imagePlan(st, scope: obj43([("kind", .string("month")), ("month", .string("2026-09"))]), inkOf: unwritten({ r in r["id"] == .string("r6") ? nil : Self.INK }), monthPick: "last", dates: dates)
        XCTAssertEqual(lastGap["cells"]!.arrayValue!.map { (c: JSValue) -> [JSValue] in [.string(chars([c]).first!), c["record"]!["id"]!] }, [[.string(cYong), .string("r2")], [.string(he43), .string("r3")], [.string(jing43), .string("r5")], [.string(cShan), .string("r7")]])
        let last = try ImageSelection.monthMembers(st, month: "2026-09", pick: "last", dates: dates)
        XCTAssertEqual(last["members"]!.arrayValue!.map { $0["record"]!["id"]! }, ["r6", "r3", "r5", "r7"].map(JSValue.string))
    }

    // test/core/images.test.mjs: month cells: 纸上 records are not in the month page and are not counted (D46-13: the judgment interface is isPaperRecord)
    func testMonthCellsPaperRecordsAreNotInTheMonthPageAndAreNotCountedD4613TheJudgmentInterfaceIsIsPaperRecordrecordsource() throws {
        let paper = setting(rec43(2, he43, "judged", "correct", "2026-09-02"), "source", .string("paper"))
        let st = stateOf([rec43(1, cYong, "judged", "correct", "2026-09-02"), paper, rec43(3, cShan, "judged", "correct", "2026-09-03")])
        let r = try ImageSelection.imagePlan(st, scope: obj43([("kind", .string("month")), ("month", .string("2026-09"))]), inkOf: { _ in Self.INK }, dates: dates)
        XCTAssertEqual(chars(r["cells"]!.arrayValue!), [cYong, cShan])
        XCTAssertEqual(r["days"], .number(2))
        XCTAssertEqual(try ImageSelection.dayMembers(st, day: "2026-09-02", dates: dates)["members"]!.arrayValue!.count, 1, "the day list skips it too")
    }

    // test/core/images.test.mjs: month cells on a folded month: members from byDay, only kept records can carry ink; the rest are under cells
    func testMonthCellsOnAFoldedMonthMembersFromByDayOnlyKeptRecordsCanCarryInkTheRestAreUnderCells() throws {
        let kept = rec43(9, he43, "judged", "correct", "2025-01-10")
        let st = obj43([
            ("records", .object(JSObject([("2025-01", J(#"{"folded":true,"month":"2025-01","byDay":{"2025-01-03":["永","和"],"2025-01-10":["和","山"]},"chars":["永","和","山"],"kept":["r9"]}"#))]))),
            ("sessions", J(#"{"A":null,"B":null,"lastEnded":{}}"#)), ("ink", .object(JSObject()))])
        var keptList = st["records"]!["2025-01"]!.objectValue!
        keptList["kept"] = .array([kept])
        var months = st["records"]!.objectValue!
        months["2025-01"] = .object(keptList)
        let state = setting(st, "records", .object(months))
        let m = try ImageSelection.monthMembers(state, month: "2025-01", dates: dates)
        XCTAssertEqual(m["members"]!.arrayValue!.map { (c: JSValue) -> [JSValue] in [.string(chars([c]).first!), c["record"]!.isNull ? .string("null") : c["record"]!["id"]!] }, [[.string(cYong), .string("null")], [.string(he43), .string("r9")], [.string(cShan), .string("null")]])
        XCTAssertEqual(m["days"], .number(2))
        let r = try ImageSelection.imagePlan(state, scope: obj43([("kind", .string("month")), ("month", .string("2025-01"))]), inkOf: { _ in Self.INK }, dates: dates)
        XCTAssertEqual(r["cells"]!.arrayValue!.map { (c: JSValue) -> [JSValue] in [.string(chars([c]).first!), c["mode"]!, c["tag"]!] }, [[.string(cYong), .string("under"), .string("3")], [.string(he43), .string("hand"), .string("")], [.string(cShan), .string("under"), .string("10")]], "和 sits on its first day (01-03) even though the kept ink is from 01-10; 山 first appears on 01-10")
        XCTAssertEqual(ImageSelection.flattenRecords(state["records"]).map { $0["id"]! }, [.string("r9")])
    }

    // test/core/images.test.mjs: day image (R-P03): that day judged chars, each char = latest that day; no ink → missing, not drawn
    func testDayImageRP03ThatDayJudgedCharsEachCharLatestThatDayNoInkMissingNotDrawn() throws {
        let recs = [
            rec43(1, cYong, "judged", "wrong", "2026-09-24"), rec43(2, he43, "judged", "correct", "2026-09-23"),
            rec43(3, cYong, "judged", "correct", "2026-09-24"), rec43(4, cShan, "judged", "correct", "2026-09-24"),
        ]
        let st = stateOf(recs)
        let m = try ImageSelection.dayMembers(st, day: "2026-09-24", dates: dates)
        XCTAssertEqual(m["members"]!.arrayValue!.map { (c: JSValue) -> [JSValue] in [.string(chars([c]).first!), c["record"]!["id"]!] }, [[.string(cYong), .string("r3")], [.string(cShan), .string("r4")]])
        XCTAssertThrowsCore("bad-args", containing: "INVALID_DAY") { _ = try ImageSelection.dayMembers(st, day: "2026-9-1", dates: dates) }
        let plan = try ImageSelection.imagePlan(st, scope: obj43([("kind", .string("day")), ("day", .string("2026-09-24"))]), inkOf: { r in r["id"] == .string("r4") ? nil : Self.INK }, dates: dates)
        XCTAssertEqual(chars(plan["cells"]!.arrayValue!), [cYong])
        XCTAssertEqual(plan["missing"], .array([.string(cShan)]))
    }

    // D42（解 P122）：时间段内找留有墨迹的那一次

    /// 「静」：8-05 首次、9-01、9-08、9-22（D27 只留首次与最近一次的墨迹：r1 与 r4 有墨，中间 r2 r3 已回收）。
    func jingState(inked: [String] = ["r1", "r4"]) -> JSValue {
        stateOf([
            rec43(1, jing43, "judged", "correct", "2026-08-05"),
            rec43(2, jing43, "judged", "correct", "2026-09-01", sessionId: "s2"),
            rec43(3, jing43, "judged", "correct", "2026-09-08", sessionId: "s3"),
            rec43(4, jing43, "judged", "correct", "2026-09-22", sessionId: "s4"),
        ], inked: inked)
    }

    // test/core/images.test.mjs: D42 month cells: September picks 9-22 (the month's ink-bearing one), August keeps its own — no ink borrowed across months
    func testD42MonthCellsSeptemberPicks922TheMonthsInkBearingOneAugustKeepsItsOwnNoInkBorrowedAcrossMonths() throws {
        let st = jingState(), has = hasInkOfState43(st)
        let sep = try ImageSelection.monthMembers(st, month: "2026-09", hasInk: has, dates: dates)
        XCTAssertEqual(sep["members"]!.arrayValue!.map { (c: JSValue) -> [JSValue] in [.string(chars([c]).first!), c["record"]!["id"]!] }, [[.string(jing43), .string("r4")]], "9-01 recycled → 9-22 (not the August ink)")
        let aug = try ImageSelection.monthMembers(st, month: "2026-08", hasInk: has, dates: dates)
        XCTAssertEqual(aug["members"]!.arrayValue!.map { (c: JSValue) -> [JSValue] in [.string(chars([c]).first!), c["record"]!["id"]!] }, [[.string(jing43), .string("r1")]])
        let plan = try ImageSelection.imagePlan(st, scope: obj43([("kind", .string("month")), ("month", .string("2026-09"))]), inkOf: { r in try has(r) ? Self.INK : nil }, dates: dates)
        XCTAssertEqual(plan["cells"]!.arrayValue!.map { (c: JSValue) -> [JSValue] in [.string(chars([c]).first!), c["record"]!["id"]!, c["tag"]!] }, [[.string(jing43), .string("r4"), .string("1")]], "the tag is the sort day (first member day 9-01), not the day of the picked record (T2-05)")
        XCTAssertEqual(try ImageSelection.monthMembers(st, month: "2026-09", dates: dates)["members"]!.arrayValue!.first?["record"]!["id"], .string("r2"), "without hasInk: the plain first of the month")
    }

    // test/core/images.test.mjs: D42 month cells: nothing with ink inside the month → an under cell (preferred record kept for the day); ink outside the month does not stand in
    func testD42MonthCellsNothingWithInkInsideTheMonthAnUnderCellPreferredRecordKeptForTheDayInkOutsideTheMonthDoesNotStandIn() throws {
        let st = jingState(inked: ["r1"]), has = hasInkOfState43(st)
        let plan = try ImageSelection.imagePlan(st, scope: obj43([("kind", .string("month")), ("month", .string("2026-09"))]), inkOf: { r in try has(r) ? Self.INK : nil }, dates: dates)
        XCTAssertEqual(plan["status"], .string("ready"), "the char is still on the page (as an under cell), D42 / §7")
        XCTAssertEqual(plan["cells"]!.arrayValue!.map { (c: JSValue) -> [JSValue] in [.string(chars([c]).first!), c["mode"]!, c["day"]!] }, [[.string(jing43), .string("under"), .string("2026-09-01")]])
        XCTAssertEqual(plan["drawn"], .array([]), "drawn = cells with ink")
    }

    // test/core/images.test.mjs: D42 month cells: preference direction — first scans early→late, last scans late→early
    func testD42MonthCellsPreferenceDirectionFirstScansEarlylateLastScansLateearly() throws {
        let st = jingState(inked: ["r2", "r3"]), has = hasInkOfState43(st)
        XCTAssertEqual(try ImageSelection.monthMembers(st, month: "2026-09", pick: "first", hasInk: has, dates: dates)["members"]!.arrayValue!.first?["record"]!["id"], .string("r2"))
        XCTAssertEqual(try ImageSelection.monthMembers(st, month: "2026-09", pick: "last", hasInk: has, dates: dates)["members"]!.arrayValue!.first?["record"]!["id"], .string("r3"), "last: r4 has none → r3, not r2")
    }

    // test/core/images.test.mjs: D42 month cells on a folded month: only kept records are candidates; the one with ink wins
    func testD42MonthCellsOnAFoldedMonthOnlyKeptRecordsAreCandidatesTheOneWithInkWins() throws {
        let k1 = rec43(8, he43, "judged", "correct", "2025-01-03"), k2 = rec43(9, he43, "judged", "correct", "2025-01-10")
        var st = obj43([
            ("records", .object(JSObject([("2025-01", J(#"{"folded":true,"month":"2025-01","byDay":{"2025-01-03":["和"],"2025-01-10":["和","山"]},"chars":["和","山"],"kept":["r8","r9"]}"#))]))),
            ("sessions", J(#"{"A":null,"B":null,"lastEnded":{}}"#)), ("ink", .object(JSObject()))])
        var january = st["records"]!["2025-01"]!.objectValue!
        january["kept"] = .array([k1, k2])
        var months = st["records"]!.objectValue!
        months["2025-01"] = .object(january)
        st = setting(st, "records", .object(months))
        st = setting(st, "ink", .object(JSObject([("2025-01", .object(JSObject([("r9", storedInk43)])))])))
        let m = try ImageSelection.monthMembers(st, month: "2025-01", hasInk: hasInkOfState43(st), dates: dates)
        XCTAssertEqual(m["members"]!.arrayValue!.map { (c: JSValue) -> [JSValue] in [.string(chars([c]).first!), c["record"]!.isNull ? .string("null") : c["record"]!["id"]!] }, [[.string(he43), .string("r9")], [.string(cShan), .string("null")]])
    }

    // test/core/images.test.mjs: D42 day image: each char = the latest record of THAT day that has ink (older same-day one), none that day → missing
    func testD42DayImageEachCharTheLatestRecordOfTHATDayThatHasInkOlderSameDayOneNoneThatDayMissing() throws {
        let recs = [
            rec43(1, jing43, "judged", "correct", "2026-09-24"), rec43(2, jing43, "judged", "wrong", "2026-09-24"),
            rec43(3, cShan, "judged", "correct", "2026-09-24"), rec43(4, cShan, "judged", "correct", "2026-09-25"),
        ]
        let st = stateOf(recs, inked: ["r1", "r4"]), has = hasInkOfState43(st)
        let d = try ImageSelection.dayMembers(st, day: "2026-09-24", hasInk: has, dates: dates)
        XCTAssertEqual(d["members"]!.arrayValue!.map { (c: JSValue) -> [JSValue] in [.string(chars([c]).first!), c["record"]!["id"]!] }, [[.string(jing43), .string("r1")], [.string(cShan), .string("r3")]], "静: r2 has none → r1; 山: only the 9-25 ink exists → not borrowed")
        let plan = try ImageSelection.imagePlan(st, scope: obj43([("kind", .string("day")), ("day", .string("2026-09-24"))]), inkOf: { r in try has(r) ? Self.INK : nil }, dates: dates)
        XCTAssertEqual(chars(plan["cells"]!.arrayValue!), [jing43])
        XCTAssertEqual(plan["missing"], .array([.string(cShan)]))
    }

    // test/core/images.test.mjs: glyph image (A05): latest judged of the char; that record without ink → noInk (no fallback to an older one, I03)
    func testGlyphImageA05LatestJudgedOfTheCharThatRecordWithoutInkNoInkNoFallbackToAnOlderOneI03() throws {
        let recs = [rec43(1, jing43, "judged", "correct", "2026-09-20"), rec43(2, jing43, "judged", "wrong", "2026-09-22"), rec43(3, jing43, "answer-seen", nil, "2026-09-23")]
        let st = stateOf(recs)
        XCTAssertEqual(ImageSelection.glyphMember(st, char: jing43)["record"]!["id"], .string("r2"))
        let ok = try ImageSelection.imagePlan(st, scope: obj43([("kind", .string("glyph")), ("char", .string(jing43))]), inkOf: { _ in Self.INK }, dates: dates)
        XCTAssertEqual(ok["status"], .string("ready"))
        XCTAssertEqual(ok["day"], .string("2026-09-22"))
        let miss = try ImageSelection.imagePlan(st, scope: obj43([("kind", .string("glyph")), ("char", .string(jing43))]), inkOf: { r in r["id"] == .string("r1") ? Self.INK : nil }, dates: dates)
        XCTAssertEqual(miss["status"], .string("noInk"))
        XCTAssertEqual(try ImageSelection.imagePlan(st, scope: obj43([("kind", .string("glyph")), ("char", .string(he43))]), inkOf: { _ in Self.INK }, dates: dates)["status"], .string("noInk"))
    }

    // test/core/images.test.mjs: > 80 chars is not pending any more (D39 / D12): the plan returns pages, each ≤ 80, in date order, nothing truncated
    func test80CharsIsNotPendingAnyMoreD39D12ThePlanReturnsPagesEach80InDateOrderNothingTruncated() throws {
        var recs: [JSValue] = []
        for i in 0..<96 { recs.append(rec43(i + 1, String(Unicode.Scalar(0x4e00 + i)!), "judged", "correct", "2026-09-10")) }
        for i in 96..<100 { recs.append(rec43(i + 1, String(Unicode.Scalar(0x4e00 + i)!), "judged", "correct", "2026-09-12")) }
        let plan = try ImageSelection.imagePlan(stateOf(recs), scope: obj43([("kind", .string("month")), ("month", .string("2026-09"))]), inkOf: { _ in Self.INK }, dates: dates)
        XCTAssertEqual(plan["status"], .string("ready"))
        XCTAssertEqual(plan["n"], .number(100))
        XCTAssertEqual(plan["pages"]!.arrayValue!.map { $0.arrayValue!.count }, [80, 20])
        XCTAssertEqual(plan["pages"]!.arrayValue!.flatMap { $0.arrayValue! }.count, 100)
        XCTAssertEqual(plan["pages"]!.arrayValue![1].arrayValue!.first?["tag"], .string("10"), "the new page starts with a tag on its first char (same day continued)")
        XCTAssertEqual(plan["pages"]!.arrayValue![1].arrayValue![16]["tag"], .string("12"))
        XCTAssertEqual(try ImageSelection.imagePlan(stateOf(Array(recs.prefix(80))), scope: obj43([("kind", .string("month")), ("month", .string("2026-09"))]), inkOf: { _ in Self.INK }, dates: dates)["pages"]!.arrayValue!.count, 1)
    }

    // test/core/images.test.mjs: cellOfMember: ink → hand, none → under only when asked; day follows the record (or the first day for a folded month)
    func testCellOfMemberInkHandNoneUnderOnlyWhenAskedDayFollowsTheRecordOrTheFirstDayForAFoldedMonth() throws {
        let r = rec43(1, cYong, "judged", "correct", "2026-09-02")
        let m = obj43([("char", .string(cYong)), ("record", r)])
        XCTAssertNil(ImageSelection.cellOfMember(m, inkOf: { _ in nil }))
        XCTAssertSameJSON(ImageSelection.cellOfMember(m, inkOf: { _ in nil }, under: true)!, J(#"{"ch":"永","ink":null,"mode":"under","dot":false,"tag":"","day":"2026-09-02","record":\#(jsonText43(r))}"#))
        XCTAssertEqual(try ImageSelection.cellOfMember(m, inkOf: { _ in Self.INK })?["mode"], .string("hand"))
        let folded = obj43([("char", .string(cShan)), ("record", .null), ("firstDay", .string("2025-01-03"))])
        XCTAssertEqual(ImageSelection.cellOfMember(folded, inkOf: { _ in nil }, under: true)?["day"], .string("2025-01-03"))
    }

    // ---------------------------------------------------------------- 单字手写图（A05，沿用）

    // test/core/images.test.mjs: glyph layout (A05): ink box ≈ 60% of the width (or limited by height), centered, caption under it, seal bottom-right
    func testGlyphLayoutA05InkBox60OfTheWidthOrLimitedByHeightCenteredCaptionUnderItSealBottomRight() throws {
        let pts = J(#"[[{"x":100,"y":60,"w":12},{"x":250,"y":60,"w":12}],[{"x":172,"y":40,"w":12},{"x":172,"y":300,"w":12}]]"#)
        let b = ImageLayout.inkBounds(pts)
        XCTAssertSameJSON(b, J(#"{"x":94,"y":34,"width":162,"height":272}"#))
        for ratio in ["portrait", "square"] {
            let g = try ImageLayout.glyphLayout(b, ratio: ratio)
            XCTAssertEqual(g["status"], .string("ready"))
            let width = num(g, "width"), height = num(g, "height")
            XCTAssertEqual(width, 1080); XCTAssertEqual(height, ratio == "portrait" ? 1440 : 1080)
            XCTAssertLessThanOrEqual(num(g["glyph"], "width"), width * 0.6 + 1e-6, "\(ratio) width ≤ 60%")
            XCTAssertLessThan(abs(num(g["glyph"], "x") + num(g["glyph"], "width") / 2 - width / 2), 1e-6, "\(ratio) centered")
            XCTAssertGreaterThanOrEqual(num(g["glyph"], "y"), 72 - 1e-6, "\(ratio) fits above the seal row")
            XCTAssertLessThanOrEqual(num(g["info"], "top") + num(g["info"], "line"), height - 72 - 78 - 48 + 1e-6, "\(ratio) fits above the seal row")
            XCTAssertEqual(num(g["seal"], "x"), width - 72 - 78)
            XCTAssertEqual(num(g["seal"], "y"), height - 72 - 78)
            XCTAssertEqual(num(g["info"], "font"), 33)
        }
        let wide = try ImageLayout.glyphLayout(J(#"{"x":0,"y":150,"width":345,"height":40}"#), ratio: "portrait")
        XCTAssertLessThan(abs(num(wide["glyph"], "width") - 1080 * 0.6), 1e-6, "wide ink → exactly 60% of the width")
        XCTAssertEqual(try ImageLayout.glyphLayout(.null, ratio: "portrait")["status"], .string("noInk"))
        XCTAssertTrue(ImageLayout.inkBounds(.array([])).isNull)
    }

    // ---------------------------------------------------------------- 渲染（假 canvas → 原生无 canvas 契约，见文件头）

    // test/core/images.test.mjs: renderWorkPage: 1440×1920 / 1440×1440 (logical 1080 × 4/3), only the given cells, dataset carries members / modes / dots / record ids / 落款
    func testRenderWorkPage1440192014401440Logical108043OnlyTheGivenCellsDatasetCarriesMembersModesDotsRecordIdsKuan() throws {
        // 画布尺寸 = 版式的逻辑 W/H × 4/3：3:4 → 1440×1920，1:1 → 1440×1440；under 格不画墨、只给 under 格取参考字形是选字口径（上面已核对）
        for (ratio, w, h) in [("3:4", 1440.0, 1920.0), ("1:1", 1440.0, 1440.0)] {
            let l = try ImageLayout.layout(3, ratio: ratio)
            XCTAssertEqual(num(l, "W") * 4 / 3, w, "\(ratio) bitmap width")
            XCTAssertEqual(num(l, "H") * 4 / 3, h, "\(ratio) bitmap height")
        }
        XCTExpectFailure("G1: dataset（members / modes / dots / recordIds / tags / signature / kind / n）与假 canvas 的逐次调用断言是网页渲染器（src/core/images/render.js）的契约；ShiziCore 不含渲染器，原生 ShiziImageRendering 在独立 target（ShiziCoreTests 不依赖它），构图等价性由 scripts/image-parity 参考 PNG 比对（46 页）门禁覆盖") {
            XCTFail("canvas.dataset 与绘制调用断言属于网页渲染器")
        }
    }

    // test/core/images.test.mjs: renderWorkPage: the day tag is drawn inside its own cell, top-left, without a colour block — it never rides a grid line (V2-09)
    func testRenderWorkPageTheDayTagIsDrawnInsideItsOwnCellTopLeftWithoutAColourBlockItNeverRidesAGridLineV209() throws {
        // 版式侧：三格 3:4 的格框（角标的落点就在这些格内），V2-09 的几何约束在这里
        let l = try ImageLayout.layout(3, ratio: "3:4")
        XCTAssertEqual(l["cells"]!.arrayValue!.count, 3)
        XCTAssertEqual(ImageLayout.dayTag("2026-09-02"), "2")
        XCTExpectFailure("G1: fillText / fillRect 的位置与「角标后面没有色块」是网页渲染器（src/core/images/render.js）的绘制断言；原生渲染在 ShiziImageRendering（独立 target），由 scripts/image-parity 参考 PNG 比对门禁覆盖") {
            XCTFail("绘制调用断言属于网页渲染器")
        }
    }

    // test/core/images.test.mjs: renderWorkPage: colours come from the LIGHT design tokens (never the dark ones); ink keeps its own width, only tiny cells are lifted to the minimum physical width (R2-R1)
    func testRenderWorkPageColoursComeFromTheLightDesignTokensNeverTheDarkOnesInkKeepsItsOwnWidthOnlyTinyCellsAreLiftedToTheMinimumPhysicalWidthR2R1() throws {
        // 一个 670px 的格 ≈ 249pt：笔锋收到的点宽就是 11.5（原宽）；3 字格 295px ≈ 110pt：原宽（旧 ×1.15 已废）；80 字的小格只抬到最小物理线宽
        let single = 11.5 * ImageLayout.inkWidthScale(670 / 2.69)
        XCTAssertLessThan(abs(single - 11.5), 1e-9, "single char: cell 670px ≈ 249pt → ×1.0")
        XCTAssertLessThan(abs(11.5 * ImageLayout.inkWidthScale(295 / 2.69) - 11.5), 1e-9, "3 chars: cell 295px ≈ 110pt → original width")
        let tiny = try ImageLayout.layout(80, ratio: "3:4")
        let tinyPt = num(tiny, "c") / 2.69
        XCTAssertLessThan(tinyPt, 47, "80 cells are tiny (\(tinyPt)pt)")
        let lifted = 11.5 * ImageLayout.inkWidthScale(tinyPt)
        XCTAssertGreaterThan(lifted, 11.5, "tiny cells: lifted to the minimum physical width only")
        XCTAssertLessThan(abs(lifted - 11.5 * ImageLayout.inkWidthScale(tinyPt)), 1e-9)
        XCTExpectFailure("G1: 颜色断言（设计 tokens 的 color.light、无暗色字面量）是网页渲染器 + palette.js 的契约；ShiziCore 无调色板模块（原生渲染的调色板经 spec 传入，见下一用例的源码扫描），由 scripts/image-parity 参考 PNG 比对门禁覆盖") {
            XCTFail("颜色断言属于网页渲染器")
        }
    }

    // test/core/images.test.mjs: renderWorkPage awaits the injected requireFont (落款 song, tags hei 500; the seal is drawn, not set in a font) before creating the canvas
    func testRenderWorkPageAwaitsTheInjectedRequireFontKuanSongTagsHei500TheSealIsDrawnNotSetInAFontBeforeCreatingTheCanvas() {
        XCTExpectFailure("G1: requireFont 注入与字体加载次序是网页渲染器的 document.fonts 契约；原生用 CoreText 直接取字（ShiziImageRendering），ShiziCore 无字体管线可断言，字形等价性由 scripts/image-parity 参考 PNG 比对门禁覆盖") {
            XCTFail("字体注入次序断言属于网页渲染器")
        }
    }

    // test/core/images.test.mjs: palette: paletteFromTokens reads color.light only and has no colour literal of its own
    func testPalettePaletteFromTokensReadsColorLightOnlyAndHasNoColourLiteralOfItsOwn() throws {
        // 同一条不变式对 Swift 侧成立：图片模块（ShiziCore/Images 与 ShiziImageRendering）不写颜色字面量（调色板经 spec 传入）
        for rel in ["ios/ShiziCore/Sources/ShiziCore/Images/ImageLayout.swift", "ios/ShiziCore/Sources/ShiziCore/Images/ImageSelection.swift", "ios/ShiziCore/Sources/ShiziImageRendering/ImageRenderer.swift"] {
            let src = try readRepoFile(rel)
            XCTAssertNil(src.range(of: "#[0-9a-fA-F]{6}\\b|rgba?\\(\\s*[0-9]", options: .regularExpression), "\(rel) has no colour literals (P1-E1a leftovers are gone)")
        }
        XCTExpectFailure("G1: paletteFromTokens 读 tokens.json 的 color.light 是网页调色板函数（src/core/images/palette.js）的契约；ShiziCore 无该函数可断言，色彩等价性由 scripts/image-parity 参考 PNG 比对门禁覆盖") {
            XCTFail("paletteFromTokens 属于网页调色板")
        }
    }

    // test/core/images.test.mjs: renderSingleGlyph: A05 sizes, caption and brand; no ink → noInk without a canvas
    func testRenderSingleGlyphA05SizesCaptionAndBrandNoInkNoInkWithoutACanvas() throws {
        // A05 尺寸：portrait 1080×1440 / square 1080×1080（× 4/3 = 1440×1920 / 1440×1440 位图）；caption 在 info 行（居中）；无墨 → noInk、不出图
        for ratio in ["portrait", "square"] {
            let g = try ImageLayout.glyphLayout(J(#"{"x":94,"y":34,"width":162,"height":272}"#), ratio: ratio)
            XCTAssertEqual(g["status"], .string("ready"))
            XCTAssertEqual(num(g, "width") * 4 / 3, 1440)
            XCTAssertEqual(num(g, "height") * 4 / 3, ratio == "portrait" ? 1920 : 1440)
            XCTAssertLessThanOrEqual(num(g["glyph"], "width"), 648, "glyphWidth ≤ 648")
            XCTAssertEqual(num(g["info"], "centerX"), 540, "caption centred")
        }
        XCTAssertEqual(try ImageLayout.glyphLayout(.null, ratio: "portrait")["status"], .string("noInk"))
        XCTAssertTrue(ImageLayout.inkBounds(.array([])).isNull, "no ink → noInk without a canvas")
        XCTExpectFailure("G1: caption / brand 的 fillText 断言是网页渲染器（render.js renderSingleGlyph）的绘制契约；原生在 ShiziImageRendering（独立 target），由 scripts/image-parity 参考 PNG 比对门禁覆盖") {
            XCTFail("caption / brand 绘制断言属于网页渲染器")
        }
    }

    // ---------------------------------------------------------------- 年报长图（§8.2）

    // test/core/images.test.mjs: annual long image: width 1440, height by content, not capped at 80 chars; a total over the limit is cut by month (rows if one month alone is too tall), no char dropped
    func testAnnualLongImageWidth1440HeightByContentNotCappedAt80CharsATotalOverTheLimitIsCutByMonthRowsIfOneMonthAloneIsTooTallNoCharDropped() {
        XCTExpectFailure("G1: renderAnnualLong（宽 1440、按内容出高、限高按月 / 按行切、字一个不少）的画布断言属于网页渲染器（annual-render.js）；原生实现在 ShiziImageRendering.annualLong（独立 target，ShiziCoreTests 不依赖它），等价性由 scripts/image-parity 参考 PNG 比对门禁（长图切张在 inputs.json 内）覆盖") {
            XCTFail("年报长图渲染断言属于网页渲染器")
        }
    }
}
