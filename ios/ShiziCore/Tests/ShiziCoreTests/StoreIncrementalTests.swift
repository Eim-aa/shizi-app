import Foundation
import XCTest
@testable import ShiziCore

// plan 里增量的序列化 / 校验（Store.stringify / Store.validate）与整值的 JSONWriter.stringify / Schema.validateValue 逐字相同；
// 整数的 JSNumber.toString 快路径与最短往返串那条路相同；quote 不转义的快路径与逐码点相同。

final class StoreIncrementalTests: XCTestCase {
    let schedKey = Schema.keyNamed("sched")!
    let recordsKey = Schema.recordsKey("2026-09")

    func schedEntry(_ i: Int, due: String = "2026-10-05") -> JSValue {
        .object(JSObject([
            ("fsrs", .object(JSObject([("due", .string("2026-10-05T04:00:00.000Z")), ("stability", .number(Double(i) + 0.37)), ("difficulty", .number(5)), ("state", .number(2))]))),
            ("due", .string(due)), ("lastJudgedAt", .number(T0 + Double(i) * 1000)),
        ]))
    }

    func sched(_ n: Int) -> JSObject {
        var o = JSObject()
        for i in 0..<n { o["base:" + String(Character(Unicode.Scalar(0x4E00 + UInt32(i))!))] = schedEntry(i) }
        return o
    }

    func records(_ n: Int) -> [JSValue] { (0..<n).map { srec($0 + 1, String(Character(Unicode.Scalar(0x4E00 + UInt32($0 % 50))!)), day: "2026-09-" + String(10 + $0 % 15)) } }

    func testStringifyMatchesWholeValue() {
        let store = freshStore(.native).store
        var s = sched(40)
        XCTAssertEqual(store.stringify(schedKey, .object(s)), JSONWriter.stringify(.object(s)))
        XCTAssertEqual(store.stringify(schedKey, .object(s)), JSONWriter.stringify(.object(s)), "second call reuses every entry text")
        s["base:" + cRen] = schedEntry(7, due: "2026-11-01")
        s["base:\u{4E03}"] = schedEntry(99)
        s["base:\u{4E05}"] = nil
        XCTAssertEqual(store.stringify(schedKey, .object(s)), JSONWriter.stringify(.object(s)), "changed / added / removed entries")
        var r = records(30)
        XCTAssertEqual(store.stringify(recordsKey, .array(r)), JSONWriter.stringify(.array(r)))
        r.append(srec(31, cKou, day: "2026-09-30"))
        r[3] = srec(4, cDa, day: "2026-09-11")
        XCTAssertEqual(store.stringify(recordsKey, .array(r)), JSONWriter.stringify(.array(r)), "appended and replaced records")
        r.removeFirst()
        XCTAssertEqual(store.stringify(recordsKey, .array(r)), JSONWriter.stringify(.array(r)), "shifted indexes")
        let small = JSValue.object(JSObject([("a", .number(-0.0)), ("b", .number(.nan)), ("c", .string("q\"\\\n\u{1}\u{4E00}"))]))
        XCTAssertEqual(store.stringify("shizi.v2.settings", small), JSONWriter.stringify(small))
    }

    func testValidateMatchesWholeValue() {
        func same(_ key: String, _ value: JSValue, _ prev: JSValue, _ label: String) {
            XCTAssertNil(Schema.validateValue(key: key, value: prev), "previous must be valid: " + label)
            XCTAssertEqual(Store.validate(key, value, previous: prev), Schema.validateValue(key: key, value: value), label)
        }
        let p = sched(40)
        var v = p
        v["base:\u{4E02}"] = schedEntry(2, due: "2026-02-30")
        same(schedKey, .object(v), .object(p), "one bad changed entry")
        v["base:\u{4E01}"] = .object(JSObject([("due", .string("2026-10-01"))]))
        same(schedKey, .object(v), .object(p), "two bad entries: the first in key order is reported")
        var w = p
        w["nope"] = schedEntry(1)
        same(schedKey, .object(w), .object(p), "a bad new key")
        w = p
        w["base:\u{4E10}"] = schedEntry(500)
        same(schedKey, .object(w), .object(p), "a good changed entry")
        same(schedKey, .array([]), .object(p), "not an object")
        let r = records(30)
        same(recordsKey, .array(r + [srec(31, cKou, day: "2026-09-30")]), .array(r), "a good appended record")
        same(recordsKey, .array(r + [srec(31, cKou, day: "2026-10-01")]), .array(r), "appended record in the wrong month")
        same(recordsKey, .array(r + [srec(30, cKou, day: "2026-09-30")]), .array(r), "appended id not ascending")
        same(recordsKey, .array(r + [srec(31, "xy", day: "2026-09-30")]), .array(r), "appended record with a bad char")
        var changed = r
        changed[5] = srec(6, cKou, kind: "skipped", judgment: "wrong", day: "2026-09-12", extra: [("judgment", .string("wrong"))])
        same(recordsKey, .array(changed + [srec(31, cKou, day: "2026-09-30")]), .array(r), "prefix changed: whole-value check")
        same(recordsKey, .array(Array(r.prefix(10))), .array(r), "shorter than previous")
        let wo = JSObject((0..<20).map { ("base:" + String(Character(Unicode.Scalar(0x4E00 + UInt32($0))!)), JSValue.number(T0)) })
        var wo2 = wo
        wo2["base:\u{4E01}"] = .string("x")
        same(Schema.keyNamed("wordOff")!, .object(wo2), .object(wo), "wordOff")
    }

    func testIntegerToStringMatchesShortestPath() {
        func old(_ x: Double) -> String {
            let (digits, n) = JSNumber.shortest(x)
            return digits + String(repeating: "0", count: n - digits.count)
        }
        var xs: [Double] = [1, 2, 9, 10, 11, 99, 100, 101, 1000, 123456789, 1e15, 1e15 + 1, 4503599627370496, 9007199254740991, 1790906400000, 86_400_000]
        var seed: UInt64 = 0x9E3779B97F4A7C15
        for _ in 0..<2000 {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            xs.append(Double((seed >> 11) % 9007199254740991 + 1))
            xs.append(Double((seed >> 33) % 100_000 + 1))
        }
        for x in xs {
            XCTAssertEqual(JSNumber.toString(x), old(x), String(x))
            XCTAssertEqual(JSNumber.toString(-x), "-" + old(x), String(-x))
        }
        XCTAssertEqual(JSNumber.toString(9007199254740992), "9007199254740992")
        XCTAssertEqual(JSNumber.toString(1e21), "1e+21")
        XCTAssertEqual(JSNumber.toString(0.5), "0.5")
    }

    func testQuoteFastPathMatchesEscaping() {
        for s in ["", "abc", "\u{4E00}\u{20BB7}e\u{301}", "a\"b", "a\\b", "line\nbreak", "\u{1F}", "tab\t", "\u{7F}\u{80}"] {
            var fast = ""
            JSONWriter.quote(s, into: &fast)
            var slow = "\""
            for u in s.unicodeScalars {
                switch u.value {
                case 0x22: slow += "\\\""
                case 0x5C: slow += "\\\\"
                case 0x08: slow += "\\b"
                case 0x0C: slow += "\\f"
                case 0x0A: slow += "\\n"
                case 0x0D: slow += "\\r"
                case 0x09: slow += "\\t"
                case 0..<0x20: slow += String(format: "\\u%04x", u.value)
                default: slow.unicodeScalars.append(u)
                }
            }
            slow += "\""
            XCTAssertTrue(fast.utf8.elementsEqual(slow.utf8), s)
        }
    }
}
