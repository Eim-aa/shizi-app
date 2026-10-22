import Foundation
import XCTest
@testable import ShiziCore

// JSON 行协议与 JS 同规则编解码（B4.0）。与 JS 的逐行对照在 node 侧（scripts/core-diff 的协议语料与随机差分），这里守 Swift 自身的不变式。
final class ProtocolTests: XCTestCase {
    func line(_ e: CoreEngine, _ s: String) throws -> JSObject {
        try XCTUnwrap(JSONParser.parse(e.handle(line: s)).objectValue)
    }

    func testHelloListsSortedOps() throws {
        let r = try line(CoreEngine(), #"{"id":7,"op":"hello"}"#)
        XCTAssertEqual(r.keys, ["id", "ok", "reply", "state"])
        XCTAssertEqual(r["reply"]?["protocol"], .number(1))
        let ops = r["reply"]?["ops"]?.arrayValue?.compactMap { $0.stringValue } ?? []
        XCTAssertEqual(ops, ops.sorted())
        XCTAssertTrue(ops.contains("dates.localDay"))
    }

    func testErrorsCarryCodesAndKeepState() throws {
        let e = CoreEngine()
        _ = e.handle(line: #"{"op":"kv.set","args":{"key":"a","value":1}}"#)
        for (req, code) in [("garbage", "bad-json"), (#"{"op":"nope"}"#, "unknown-op"), (#"{"op":"echo"}"#, "bad-args"),
                            (#"{"op":"echo","args":[]}"#, "bad-request"), ("[1]", "bad-request"), (#"{"op":"dates.parseDay","args":{"day":"x"}}"#, "range"),
                            (#"{"op":"dates.localDay","args":{"t":"x"}}"#, "type"), (#"{"op":"clock.set","args":{"t":"1"}}"#, "bad-args")] {
            let r = try line(e, req)
            XCTAssertEqual(r["ok"], .bool(false), req)
            XCTAssertEqual(r["error"]?["code"], .string(code), req)
            XCTAssertEqual(r["state"]?["kv"]?["a"], .number(1), req)
        }
    }

    func testStateFalseOmitsSnapshot() throws {
        let r = try line(CoreEngine(), #"{"op":"kv.keys","state":false}"#)
        XCTAssertNil(r["state"])
    }

    func testEchoRoundTripMatchesJsStringify() {
        let e = CoreEngine()
        // 期望文字 = node 里 JSON.stringify({ok:true, reply: JSON.parse(value), state:{clock:0,kv:{}}})。
        let cases: [(String, String)] = [
            (#"{"b":1,"2":0,"a":2,"10":3,"01":4}"#, #"{"2":0,"10":3,"b":1,"a":2,"01":4}"#),
            ("[1.0,1e21,1E-7,-0,0.1,100000000000000000000,1.5e300]", "[1,1e+21,1e-7,0,0.1,100000000000000000000,1.5e+300]"),
            (#""\u0000\u001f\/é😀 ""#, "\"\\u0000\\u001f/\u{e9}\u{1F600}\u{2028}\""),
            (#"{"a":1,"a":2}"#, #"{"a":2}"#),
            ("1e400", "null"),
        ]
        for (value, reply) in cases {
            let out = e.handle(line: #"{"op":"echo","args":{"value":"# + value + "}}")
            XCTAssertEqual(out, #"{"ok":true,"reply":"# + reply + #","state":{"clock":0,"kv":{}}}"#, value)
        }
    }

    func testCanonicallyEquivalentKeysStayDistinct() throws {
        let e = CoreEngine()
        _ = e.handle(line: #"{"op":"kv.set","args":{"key":"é","value":1}}"#)
        _ = e.handle(line: #"{"op":"kv.set","args":{"key":"é","value":2}}"#)
        let r = try line(e, #"{"op":"kv.keys"}"#)
        XCTAssertEqual(r["reply"]?.arrayValue?.count, 2)
    }

    func testBomIsKeptInsideStrings() {
        let out = CoreEngine().handle(line: #"{"op":"echo","args":{"value":"﻿x"}}"#)
        XCTAssertTrue(out.contains("\u{FEFF}x"))
    }

    func testLoneSurrogateIsRejected() {
        XCTAssertThrowsError(try JSONParser.parse(#""\ud800""#))
    }

    func testNumberFormatting() {
        let want: [(Double, String)] = [(0, "0"), (-0.0, "0"), (1, "1"), (-1.5, "-1.5"), (1e21, "1e+21"), (1e20, "100000000000000000000"), (1e-7, "1e-7"),
                                        (1e-6, "0.000001"), (123e-20, "1.23e-18"), (5e-324, "5e-324"), (0.1 + 0.2, "0.30000000000000004"), (.infinity, "Infinity")]
        for (x, s) in want { XCTAssertEqual(JSNumber.toString(x), s) }
    }

    func testDstGapResolvesLikeV8() throws {
        // 2026-03-08 02:30 纽约不存在：V8 给 03:30 EDT（跳变前偏移）。dayStartMs 在圣地亚哥 0 点跳变日落在 01:00。
        let ny = try XCTUnwrap(TimeZone(identifier: "America/New_York"))
        let t = try XCTUnwrap(JSDate.makeLocal(2026, 2, 8, hours: 2, ny))
        XCTAssertEqual(JSDate.localFields(t, ny)?.hours, 3)
        let scl = Dates(timeZone: try XCTUnwrap(TimeZone(identifier: "America/Santiago")))
        let ms = try scl.dayStartMs(.string("2026-09-06"))
        XCTAssertEqual(JSDate.localFields(ms, scl.timeZone)?.hours, 1)
    }
}
