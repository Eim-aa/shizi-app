import Foundation
import XCTest

@testable import ShiziCore

/// Source-generated, independent JS oracles. Regenerate with scripts/image-parity/{geometry,selection}.mjs --fixtures.
/// Exhaustive geometry: every 1–80 character page and both aspect ratios. Selection: correct,
/// wrong/added, answer-seen, missing ink, paper, skipped, folded months and session slot precedence.
final class ImageParityTests: XCTestCase {
  func check(_ name: String) throws {
    let url = try XCTUnwrap(
      Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
    let rows = try XCTUnwrap(JSONParser.parse(String(contentsOf: url)).arrayValue)
    let engine = CoreEngine(timeZone: TimeZone(identifier: "Asia/Shanghai")!)
    for (i, row) in rows.enumerated() {
      let request = JSValue.object(
        JSObject([("op", row["op"]!), ("args", row["args"]!), ("state", .bool(false))]))
      let result = engine.handle(request)
      XCTAssertEqual(result["ok"], .bool(true), "\(name)[\(i)]: \(result)")
      XCTAssertEqual(result["reply"], row["reply"], "\(name)[\(i)] \(row["op"]!)")
    }
  }
  func testEveryPageGeometryAgainstJavaScript() throws { try check("images-geometry") }
  func testSelectionAndFoldedMonthPlansAgainstJavaScript() throws { try check("images-selection") }
  func testPaginationKeepsDaysTogetherAndRetagsEachPage() {
    let cells = (0..<170).map { i in
      JSValue.object(
        JSObject([
          ("day", .string(i < 85 ? "2026-10-01" : "2026-10-02")), ("tag", .string("")),
          ("index", .number(Double(i))),
        ]))
    }
    let pages = ImageLayout.paginate(cells)
    XCTAssertEqual(pages.map(\.count), [80, 5, 80, 5])
    XCTAssertEqual(pages.flatMap { $0 }, cells)
    XCTAssertEqual(
      pages.map { ImageLayout.withDayTags($0).first?["tag"] },
      [.string("1"), .string("1"), .string("2"), .string("2")])
  }
}
