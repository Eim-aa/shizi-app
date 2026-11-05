import Foundation
import XCTest
@testable import ShiziCore

// 年报的墨迹按需取（view.annual.ink）：
//   · 每个墨迹键（「月|id」= state.ink[月][id]）取回的 ink.points = view.annual 里那条记录那一格的 ink.points（AnnualInkWire.built），逐位相同；
//   · 入参校验：keys 不是字串数组 / 多于 AnnualInkWire.maxBatch 个 → invalid；认不得的键 → null；重复的键只回一次。
final class AnnualLazyInkTests: XCTestCase {
    typealias P = LibraryInkPayloadTests

    static func store(_ state: JSObject) -> Store {
        let env = freshStore(.native, budgets: Budgets.native.js)
        let r = env.store.seed(.object(state), label: "lazy-ink-seed")
        XCTAssertEqual(r["ok"], .bool(true), str(r))
        return env.store
    }

    static func keysArg(_ keys: [String]) -> JSObject { JSObject([("keys", .array(keys.map(JSValue.string)))]) }

    static func fetch(_ store: Store, _ keys: [String]) -> JSValue { PageAPI.call("view.annual.ink", store: store, args: keysArg(keys)) }

    // MARK: 入参

    func testInkOpValidatesItsInput() throws {
        let store = Self.store(try AnnualInkBenchTests.annualState(12))
        func kind(_ r: JSValue) -> String? { r["error"]?["kind"]?.stringValue }
        XCTAssertEqual(kind(PageAPI.call("view.annual.ink", store: store, args: JSObject())), "invalid", "no keys")
        XCTAssertEqual(kind(PageAPI.call("view.annual.ink", store: store, args: JSObject([("keys", .string("2026-01|r1"))]))), "invalid", "keys is not an array")
        XCTAssertEqual(kind(PageAPI.call("view.annual.ink", store: store, args: JSObject([("keys", .array([.string("2026-01|r1"), .number(3)]))]))), "invalid", "a key is not a string")
        XCTAssertEqual(kind(PageAPI.call("view.annual.ink", store: store, args: JSObject([("keys", .array([.null]))]))), "invalid", "a null key")
        let tooMany = (0...AnnualInkWire.maxBatch).map { "2026-01|r\($0)" }
        XCTAssertEqual(kind(Self.fetch(store, tooMany)), "invalid", "more than maxBatch keys")
        let atLimit = Self.fetch(store, Array(tooMany.dropLast()))
        XCTAssertEqual(atLimit["ok"], .bool(true), "exactly maxBatch keys: \(str(atLimit["error"] ?? .null))")
        XCTAssertEqual(atLimit["ink"]?.objectValue?.count, AnnualInkWire.maxBatch)
        let empty = Self.fetch(store, [])
        XCTAssertEqual(empty["ok"], .bool(true))
        XCTAssertEqual(empty["ink"], .object(JSObject()))
        // 认不得的键 → null（不是错）；重复的只回一次
        let unknown = ["", "|", "2026-01|", "|r1", "2026-01", "2026-01|r999999", "2031-01|r1", "2026-01|r1|x", "NaN-NaN|r1", "__proto__", "0"]
        let r = Self.fetch(store, unknown + ["2026-01|r1", "2026-01|r1"])
        XCTAssertEqual(r["ok"], .bool(true), str(r))
        let ink = try XCTUnwrap(r["ink"]?.objectValue)
        XCTAssertEqual(ink.count, unknown.count + 1, "duplicates collapse: \(ink.keys)")
        for k in unknown { XCTAssertEqual(ink[k], .null, "unknown key \(k) → null") }
        XCTAssertNotEqual(ink["2026-01|r1"], .null, "a real key has ink")
        XCTAssertNotNil(ink["2026-01|r1"]?.arrayValue)
    }

    /// 墨迹键的拆法：月里、id 里都没有「|」；拆回去 = Schema.inkMonthOf / inkIdOf。
    func testKeyRoundTrips() throws {
        let tz = shanghaiTZ
        let recs: [JSValue] = [
            srec(5, "永", day: "2026-03-04"),
            srec(6, "永", day: "2026-03-04", extra: [("inkId", .string("r2"))]),
            .object(JSObject([("id", .string("r7")), ("at", .number(T0))])),
        ]
        for r in recs {
            let key = try XCTUnwrap(AnnualInkWire.key(r, timeZone: tz), str(r))
            let month = try XCTUnwrap(Schema.inkMonthOf(r, timeZone: tz)), id = try XCTUnwrap(Schema.inkIdOf(r))
            XCTAssertEqual(key, month + "|" + id)
            XCTAssertFalse(month.contains("|"))
            XCTAssertFalse(id.contains("|"))
        }
        XCTAssertNil(AnnualInkWire.key(.object(JSObject([("id", .string("x"))])), timeZone: tz), "no valid id")
        XCTAssertNil(AnnualInkWire.key(.object(JSObject([("id", .string("r1"))])), timeZone: tz), "no day, no time")
        XCTAssertNil(AnnualInkWire.key(.string("r1"), timeZone: tz), "not an object")
        XCTAssertNil(AnnualInkWire.key(nil, timeZone: tz))
    }

    // MARK: 取回的 = 整份回包里的

    /// 每条记录：view.annual.ink 取它的键 = AnnualInkWire.built(state, record:)（view.annual 每格墨迹就是它）；
    /// 整份 view.annual 里每个有墨迹的格的 ink.points = 按那一格的记录的键取回的（干净的数据：一个 id 一条记录）。
    func testFetchedInkIsTheFullReplysInk() throws {
        var state = try AnnualInkBenchTests.annualState(90)
        guard case .object(var jan)? = state["ink"]?["2026-01"] else { return XCTFail("no January ink table") }
        jan["r2"] = P.overflowingV2Ink()
        jan["r3"] = inkEntry(12, 4)
        jan["r4"] = inkEntryV2(10, 2)
        jan["r5"] = nil
        var inkTable = state["ink"]?.objectValue ?? JSObject()
        inkTable["2026-01"] = .object(jan)
        state["ink"] = .object(inkTable)
        let store = Self.store(state)
        let st = JSValue.object(store.state), tz = store.dates.timeZone
        let records = Query.flattenRecords(st["records"])
        var byId: [String: JSValue] = [:]
        for r in records { byId[JS.string(r["id"])] = r }
        let keys = records.compactMap { AnnualInkWire.key($0, timeZone: tz) }
        XCTAssertEqual(keys.count, records.count)
        var fetched = JSObject()
        for start in stride(from: 0, to: keys.count, by: AnnualInkWire.maxBatch) {
            let r = Self.fetch(store, Array(keys[start..<min(keys.count, start + AnnualInkWire.maxBatch)]))
            XCTAssertEqual(r["ok"], .bool(true), str(r))
            for (k, v) in r["ink"]?.objectValue?.entries ?? [] { fetched[k] = v }
        }
        for r in records {
            let key = try XCTUnwrap(AnnualInkWire.key(r, timeZone: tz))
            let want = try AnnualInkWire.built(st, record: r, dates: store.dates) ?? .null
            XCTAssertTrue(P.same(fetched[key] ?? .null, want), "\(key): fetched = built(record)")
        }
        XCTAssertEqual(fetched["2026-01|r5"], .null, "a record without ink → null")
        let full = PageAPI.call("view.annual", store: store, args: JSObject([("year", .number(2026))]))
        XCTAssertEqual(full["ok"], .bool(true))
        var inked = 0
        for m in full["view"]?["months"]?.arrayValue ?? [] {
            for c in m["cells"]?.arrayValue ?? [] {
                let r = byId[JS.string(c["recordId"])]
                let key = AnnualInkWire.key(r, timeZone: tz)
                if let box = c["ink"], JS.truthy(box) {
                    inked += 1
                    XCTAssertTrue(P.same(box["points"] ?? .null, key.flatMap { fetched[$0] } ?? .missing), "cell \(JS.string(c["recordId"]))")
                } else {
                    XCTAssertEqual(key.flatMap { fetched[$0] } ?? .null, .null, "a glyph cell fetches nothing")
                }
            }
        }
        XCTAssertGreaterThan(inked, 80)
    }
}

private extension JSValue {
    /// 测试里「取不到」的占位（不会与任何 ink.points 相同）。
    static var missing: JSValue { .string("\u{0}missing") }
}
