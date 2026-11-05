import ShiziCore
import UIKit
import XCTest
@testable import Shizi

// 字库子页的性能改动与改动前逐项相同（只换做法、不换结果）：
//   令牌颜色缓存 = 每次现解析；（之后的改动各自在下面加一节）

/// 颜色的可比形式：色彩空间名 + 各分量的位（不按容差比）。
func libraryColorKey(_ c: UIColor?) -> String {
    guard let cg = c?.cgColor else { return "nil" }
    let space = (cg.colorSpace?.name as String?) ?? "?"
    return space + ":" + (cg.components ?? []).map { String(Double($0).bitPattern, radix: 16) }.joined(separator: ",")
}

@MainActor
final class LibraryTokenColorCacheTests: XCTestCase {
    /// 每个颜色令牌（两套主题的并集 + 一个不存在的名字）：缓存给的动态色在浅 / 深下解析出的颜色 = 现解析令牌原文；
    /// 同一个名字反复取是同一个对象（墨迹小图按对象同一判断墨色没变）。
    func testDynamicColorCacheMatchesFreshParse() throws {
        let lightRaw = ShiziTokens.colorStrings(.light), darkRaw = ShiziTokens.colorStrings(.dark)
        let names = Set(lightRaw.keys).union(darkRaw.keys).sorted() + ["no-such-token"]
        XCTAssertGreaterThan(names.count, 10)
        let light = UITraitCollection(userInterfaceStyle: .light), dark = UITraitCollection(userInterfaceStyle: .dark)
        for name in names {
            let freshLight = NativeInkWire.uiColor(lightRaw[name]), freshDark = NativeInkWire.uiColor(darkRaw[name])
            for round in 0..<2 { // 第一次填缓存，第二次命中
                XCTAssertEqual(libraryColorKey(ShiziTokens.color(name, .light)), libraryColorKey(freshLight), "\(name) light #\(round)")
                XCTAssertEqual(libraryColorKey(ShiziTokens.color(name, .dark)), libraryColorKey(freshDark), "\(name) dark #\(round)")
                let d = ShiziTokens.dynamicColor(name)
                guard freshLight != nil, freshDark != nil else {
                    XCTAssertNil(d, name)
                    continue
                }
                let dyn = try XCTUnwrap(d, name)
                XCTAssertEqual(libraryColorKey(dyn.resolvedColor(with: light)), libraryColorKey(freshLight), "\(name) dynamic light #\(round)")
                XCTAssertEqual(libraryColorKey(dyn.resolvedColor(with: dark)), libraryColorKey(freshDark), "\(name) dynamic dark #\(round)")
            }
            if let a = ShiziTokens.dynamicColor(name) {
                XCTAssertTrue(a === ShiziTokens.dynamicColor(name), name)
            }
        }
    }
}
