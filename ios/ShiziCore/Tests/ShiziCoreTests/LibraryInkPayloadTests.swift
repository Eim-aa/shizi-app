import Foundation
import XCTest
@testable import ShiziCore

// 字库页（全部字 / 清单）回包里的墨迹（LibrarySubAPI）：App 把回包经 JSONSerialization 往返解码，
// 非有限数（NaN / ±∞）在 Apple 平台上抛 Objective-C 异常、Swift 接不住，所以回包里只能有有限数。
// 本文件的用例只检查 JSValue，不走 JSONSerialization，所以即使复现了坏数据也不会让测试进程崩。

final class LibraryInkPayloadTests: XCTestCase {
    /// 存下的 v4 原始点没有 w（{x, y, t, p?}），但 decodeInk 走 buildStroke 重算宽度：解码 + 回放重采样后每点都有有限的 w。
    /// 即「w 缺省 → 回包写 NaN」那条路对合法墨迹走不到。
    func testRawV4InkWithoutWidthDecodesWithFiniteWidthEverywhere() throws {
        var raw: [[InkPoint]] = []
        for i in 0..<3 {
            raw.append((0..<12).map { j in InkPoint(x: Double(60 + i * 40 + j * 9), y: Double(80 + j * 14), t: Double(i * 400 + j * 16), order: InkPoint.orderXYTP) })
        }
        XCTAssertTrue(raw.allSatisfy { $0.allSatisfy { $0.w == nil } })
        let ink = InkMath.encodeInkRaw(raw)
        XCTAssertTrue(InkMath.isInkV4(ink))
        XCTAssertNil(Schema.validateInk(ink))
        let decoded = try XCTUnwrap(try InkMath.decodeInk(ink))
        let replay = InkMath.resampleForReplay(decoded)
        XCTAssertFalse(replay.isEmpty)
        for s in replay {
            for q in s {
                let w = try XCTUnwrap(q.w, "every replayed point carries a width")
                XCTAssertTrue(w.isFinite && q.x.isFinite && q.y.isFinite)
            }
        }
    }

    /// 能过存储校验（intRow 只要求整数）的 v2 墨迹：坐标取到接近 Double 上限，Catmull-Rom 的 5·b.x / 4·c.x 溢出成 ∞，∞ − ∞ = NaN。
    static func overflowingV2Ink() -> JSValue {
        let big = 1.7e308
        let row: [JSValue] = [.number(big), .number(big), .number(100), .number(big), .number(big), .number(100)]
        return .object(JSObject([("v", .number(2)), ("c", .number(345)), ("s", .array([.array(row)]))]))
    }

    func testOverflowingV2InkPassesValidationButReplaysToNonFinite() throws {
        let ink = Self.overflowingV2Ink()
        XCTAssertTrue(InkMath.isInkV2(ink))
        XCTAssertNil(Schema.validateInk(ink), "backup import / seed accept it")
        let replay = InkMath.resampleForReplay(try XCTUnwrap(try InkMath.decodeInk(ink)))
        XCTAssertTrue(replay.flatMap { $0 }.contains { !$0.x.isFinite || !$0.y.isFinite }, "the replay itself overflows (root cause)")
    }

    /// view.library-all / view.library-list 的 ink 回包：坏墨迹里的非有限点被丢掉，合法墨迹逐值不变（x / y / w 都在）。
    func testLibraryInkPayloadOnlyCarriesFiniteNumbers() throws {
        var state = storeBaseline()
        let good = inkEntry()
        state["ink"] = .object(JSObject([("2026-09", .object(JSObject([("r2", good), ("r3", Self.overflowingV2Ink())])))]))
        let env = freshStore(.local)
        let seededResult = env.store.seed(.object(state))
        XCTAssertEqual(seededResult["ok"], .bool(true), str(seededResult))

        for op in ["view.library-all", "view.library-list"] {
            let r = PageAPI.call(op, store: env.store)
            XCTAssertEqual(r["ok"], .bool(true), "\(op): \(str(r))")
            guard case .object(let ink)? = r["ink"] else { return XCTFail("\(op): no ink map") }
            var numbers = 0
            func walk(_ v: JSValue) {
                switch v {
                case .number(let d): numbers += 1; XCTAssertTrue(d.isFinite, "\(op): non-finite number in ink payload")
                case .array(let a): a.forEach(walk)
                case .object(let o): o.entries.forEach { walk($0.1) }
                default: break
                }
            }
            walk(.object(ink))
            if op == "view.library-all" {
                // 合法墨迹：与直接解码 + 重采样逐值一致，每点 {x, y, w}
                let expected = InkMath.resampleForReplay(try XCTUnwrap(try InkMath.decodeInk(good)))
                guard case .array(let got)? = ink["r2"] else { return XCTFail("r2 ink missing: \(str(.object(ink)))") }
                XCTAssertEqual(got.count, expected.count)
                for (gs, es) in zip(got, expected) {
                    let pts = gs.arrayValue ?? []
                    XCTAssertEqual(pts.count, es.count)
                    for (g, e) in zip(pts, es) {
                        XCTAssertEqual(g["x"], .number(e.x)); XCTAssertEqual(g["y"], .number(e.y)); XCTAssertEqual(g["w"], .number(e.w!))
                    }
                }
                XCTAssertGreaterThan(numbers, 0)
            }
        }
    }
}
