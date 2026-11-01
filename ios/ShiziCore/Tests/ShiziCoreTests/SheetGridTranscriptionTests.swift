import Foundation
import XCTest
@testable import ShiziCore

// test/core/sheet-grid.test.mjs 的转写（9 个用例，用例名保留原名）。字帖格（D57 / 方案 C1「字帖格 · 按字数排」）：
// 格数 = 字数、列数规则、阶梯外框、限高、日期角标、80 字上限、导出页与屏上同一条规则（D31）。
// 另有 images-geometry.json 金标准（sheetGrid n=0..160 × 两种 unit）经 ImageParityTests 逐字段核对。

final class SheetGridTranscriptionTests: XCTestCase {
    func grid(_ n: Int, _ width: Double, unit: Double = 1, maxHeight: Double = .infinity) throws -> JSValue {
        try ImageLayout.sheetGrid(n, width: width, unit: unit, maxHeight: maxHeight)
    }
    func page(_ n: Int, _ ratio: String) throws -> JSValue { try ImageLayout.layout(n, ratio: ratio, sheet: true) }
    func num(_ v: JSValue?, _ k: String) -> Double { JS.number(v?[k] ?? .null) }

    // test/core/sheet-grid.test.mjs: column rule: 1-4 chars one row (n columns), 5-12 -> 4, 13-24 -> 6, 25+ -> 8
    func testColumnRule14CharsOneRowNColumns512To41324To625To8() {
        let want: [(Int, Int)] = [(1, 1), (2, 2), (3, 3), (4, 4), (5, 4), (12, 4), (13, 6), (24, 6), (25, 8), (72, 8), (80, 8), (900, 8)]
        for (n, cols) in want { XCTAssertEqual(ImageLayout.sheetColumns(n), cols, "n=\(n)") }
        XCTAssertEqual(ImageLayout.sheetColumns(0), 0)
    }

    // test/core/sheet-grid.test.mjs: cell count equals char count for every n — no empty cells, ever
    func testCellCountEqualsCharCountForEveryNNoEmptyCellsEver() throws {
        for n in 1...100 {
            let g = try grid(n, 350), cells = g["cells"]!.arrayValue!
            XCTAssertEqual(cells.count, n, "n=\(n)")
            XCTAssertEqual(Set(cells.map { "\(JS.number($0["x"])),\(JS.number($0["y"]))" }).count, n, "cells are distinct")
            XCTAssertLessThan(num(g, "rows") * num(g, "cols") - Double(n), num(g, "cols"), "last row is never empty")
        }
    }

    // test/core/sheet-grid.test.mjs: 3 chars: one row of 110pt cells; 72 chars: 8 columns, 9 rows, cells fit the width
    func testThreeCharsOneRowOf110ptCells72Chars8Columns9RowsCellsFitTheWidth() throws {
        let a = try grid(3, 350)
        XCTAssertEqual([num(a, "cols"), num(a, "rows"), num(a, "c"), num(a, "W")], [3, 1, 110, 330])
        XCTAssertEqual(a["full"], .bool(true))
        let b = try grid(72, 350)
        XCTAssertEqual([num(b, "cols"), num(b, "rows"), num(b, "c"), num(b, "lastN")], [8, 9, 43, 8])
        XCTAssertEqual(b["full"], .bool(true))
        XCTAssertLessThanOrEqual(num(b, "W"), 350)
        XCTAssertEqual(try grid(72, 335)["c"], .number(41), "375 wide screen")
    }

    // test/core/sheet-grid.test.mjs: short last row: the outline is a staircase (one frame), the inner lines stop at the last cell
    func testShortLastRowTheOutlineIsAStaircaseOneFrameTheInnerLinesStopAtTheLastCell() throws {
        XCTAssertEqual(try grid(18, 350)["full"], .bool(true), "6 cols x 3 rows, last row 6 -> full")
        let s = try grid(19, 350)
        XCTAssertEqual(s["full"], .bool(false)); XCTAssertEqual(num(s, "lastN"), 1)
        XCTAssertNotNil(s["outline"]!.stringValue!.range(of: "^M0 0H[0-9]+V[0-9]+H[0-9]+V[0-9]+H0Z$", options: .regularExpression), "stair outline: 6 corners")
        let c = num(s, "c")
        XCTAssertFalse(s["inner"]!.stringValue!.contains("M\(2 * c) \(3 * c)"), "no vertical line past the last cell")
        XCTAssertEqual(try grid(8, 350)["full"], .bool(true))
    }

    // test/core/sheet-grid.test.mjs: maxHeight shrinks the cell so the grid fits (export on 1:1)
    func testMaxHeightShrinksTheCellSoTheGridFitsExportOn11() throws {
        let g = try grid(80, 974, unit: 2.69, maxHeight: 700)
        XCTAssertLessThanOrEqual(num(g, "H"), 700)
        XCTAssertEqual(g["cells"]!.arrayValue!.count, 80)
    }

    // test/core/sheet-grid.test.mjs: date tag: only the first char of each day; a page with one day has none
    func testDateTagOnlyTheFirstCharOfEachDayAPageWithOneDayHasNone() throws {
        let cells = [J(#"{"ch":"甲","day":"2026-09-01"}"#), J(#"{"ch":"乙","day":"2026-09-01"}"#), J(#"{"ch":"丙","day":"2026-09-03"}"#), J(#"{"ch":"丁","day":"2026-09-03"}"#)]
        XCTAssertEqual(ImageLayout.sheetTags(ImageLayout.withDayTags(cells)), ["1", "", "3", ""].map(JSValue.string))
        XCTAssertEqual(ImageLayout.sheetTags(ImageLayout.withDayTags(Array(cells.prefix(2)))), ["", ""].map(JSValue.string))
        XCTAssertEqual(ImageLayout.sheetTags([]), [] as [JSValue])
    }

    // test/core/sheet-grid.test.mjs: mine page cap is one sheet (80 chars)
    func testMinePageCapIsOneSheet80Chars() {
        let cells = (0..<85).map { _ in J(#"{"ch":"永","day":"2026-09-01"}"#) }
        // MINE_SHEET_MAX_CHARS = 80：超过 80 只放最近的 80 个，第一格重标日期（Swift 的默认上限就是它）
        let trimmed = MinePageView.trimSheetCells(cells)
        XCTAssertEqual(trimmed["truncated"], .bool(true)); XCTAssertEqual(trimmed["hidden"], .number(5)); XCTAssertEqual(trimmed["total"], .number(85))
        XCTAssertEqual(trimmed["cells"]!.arrayValue!.count, 80)
        let kept = MinePageView.trimSheetCells(Array(cells.prefix(80)))
        XCTAssertEqual(kept["truncated"], .bool(false)); XCTAssertEqual(kept["hidden"], .number(0)); XCTAssertEqual(kept["total"], .number(80))
        XCTAssertEqual(kept["cells"]!.arrayValue!, Array(cells.prefix(80)), "≤ 80 untouched")
    }

    // test/core/sheet-grid.test.mjs: export page layout uses the same column rule and staircase as the screen (D31)
    func testExportPageLayoutUsesTheSameColumnRuleAndStaircaseAsTheScreenD31() throws {
        for n in [1, 3, 4, 5, 12, 13, 24, 25, 72, 80] {
            for ratio in ["3:4", "1:1"] {
                let L = try page(n, ratio), screen = try grid(n, 350), g = L["grid"]!
                XCTAssertEqual(num(g, "cols"), num(screen, "cols"), "\(n) \(ratio): columns")
                XCTAssertEqual(num(g, "rows"), num(screen, "rows"), "\(n) \(ratio): rows")
                XCTAssertEqual(g["full"], screen["full"], "\(n) \(ratio): staircase or not")
                XCTAssertEqual(L["cells"]!.arrayValue!.count, n)
                XCTAssertGreaterThanOrEqual(num(L, "top"), 0, "\(n) \(ratio): the grid is on the canvas")
                XCTAssertLessThanOrEqual(num(L, "top") + num(g, "H"), num(L, "H"), "\(n) \(ratio): the grid is on the canvas")
                XCTAssertLessThanOrEqual(num(L["kuan"], "top") + num(L["kuan"], "lineHeight"), num(L, "H"), "\(n) \(ratio): signature is on the canvas")
                XCTAssertLessThanOrEqual(num(L["seal"], "y") + num(L["seal"], "size"), num(L, "H"), "\(n) \(ratio): seal is on the canvas")
            }
        }
        let three = try page(3, "1:1")
        XCTAssertLessThanOrEqual(abs(num(three["grid"], "c") / 2.69 - 110), 1.5, "3 chars: ~110pt cells on the export too")
    }

    // test/core/sheet-grid.test.mjs: export signature: full last row -> seal under the last cell, right edge aligned; short last row -> seal right of the last cell, bottoms aligned
    func testExportSignatureFullLastRowSealUnderTheLastCellRightEdgeAlignedShortLastRowSealRightOfTheLastCellBottomsAligned() throws {
        let full = try page(8, "3:4")
        XCTAssertEqual(full["below"], .bool(true))
        XCTAssertEqual(num(full["seal"], "x") + num(full["seal"], "size"), num(full, "left") + num(full["grid"], "W"))
        XCTAssertGreaterThan(num(full["seal"], "y"), num(full, "top") + num(full["grid"], "H"))
        let short = try page(10, "3:4") // 4 cols: 3 rows, last row has 2
        XCTAssertEqual(short["below"], .bool(false))
        let last = short["cells"]!.arrayValue![9]
        XCTAssertEqual(num(short["seal"], "y") + num(short["seal"], "size"), num(last, "y") + num(short["grid"], "c"), "seal bottom = last cell bottom")
        XCTAssertGreaterThan(num(short["seal"], "x"), num(last, "x") + num(short["grid"], "c"), "seal is right of the last cell")
        XCTAssertEqual(num(short["kuan"], "right"), num(short, "left") + num(short["grid"], "W"), "signature right-aligned to the grid")
    }
}
