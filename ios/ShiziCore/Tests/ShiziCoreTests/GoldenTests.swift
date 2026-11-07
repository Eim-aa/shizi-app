import Foundation
import XCTest
@testable import ShiziCore
@testable import ShiziCoreEngine

// 金标准（计划 §4.3 ①）：夹具当年由 JS 参考实现生成（D84 起冻结，生成脚本已删），这里逐条比对。
// 按 op 组织的域：每组一个时区，CoreEngine 跑同一个 op，比 ok、reply（值相等 + 序列化逐字节相同）或错误码。

func loadFixture(_ name: String) throws -> JSObject {
    guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures") else {
        throw XCTSkip("missing fixture " + name)
    }
    let text = try String(contentsOf: url, encoding: .utf8)
    guard let o = try JSONParser.parse(text).objectValue else { throw CoreError.badArgs("fixture is not an object") }
    return o
}

/// 按 op 组织的夹具逐条跑；返回比对条数。D83 改了行为的 op 的条目已从夹具里删掉（2026-11 清扫），不再需要跳过表。
func runOpGolden(_ name: String, file: StaticString = #filePath, line: UInt = #line) throws -> Int {
    let doc = try loadFixture(name)
    var n = 0
    for group in doc["groups"]?.arrayValue ?? [] {
        let tzName = group["tz"]!.stringValue!
        guard let tz = TimeZone(identifier: tzName) else {
            XCTFail("unknown time zone " + tzName, file: file, line: line)
            continue
        }
        let engine = CoreEngine(timeZone: tz)
        for c in group["cases"]?.arrayValue ?? [] {
            let req = JSValue.object(JSObject([("op", c["op"]!), ("args", c["args"]!), ("state", .bool(false))]))
            let res = engine.handle(req)
            let label = tzName + " " + JSONWriter.stringify(req)
            let wantOk = c["ok"] == .bool(true)
            XCTAssertEqual(res["ok"], .bool(wantOk), label + " -> " + JSONWriter.stringify(res), file: file, line: line)
            if wantOk {
                let want = c["reply"]!
                let got = res["reply"] ?? .null
                XCTAssertEqual(JSONWriter.stringify(got), JSONWriter.stringify(want), label, file: file, line: line)
            } else {
                XCTAssertEqual(res["error"]?["code"], c["code"], label + " -> " + JSONWriter.stringify(res), file: file, line: line)
            }
            n += 1
        }
    }
    return n
}

final class GoldenTests: XCTestCase {
    func testDatesGolden() throws {
        let doc = try loadFixture("dates")
        XCTAssertEqual(doc["policy"]?["dayStartHour"], .number(Double(Dates.defaultDayStartHour)), "policy.dayStartHour drifted from Swift default")
        let n = try runOpGolden("dates")
        XCTAssertGreaterThan(n, 1000)
    }

    func testNumberFormatGolden() throws {
        let doc = try loadFixture("number-format")
        let cases = doc["cases"]?.arrayValue ?? []
        XCTAssertGreaterThan(cases.count, 500)
        for c in cases {
            let bits = UInt64(c["bits"]!.stringValue!, radix: 16)!
            let x = Double(bitPattern: bits)
            let want = c["text"]!.stringValue!
            XCTAssertEqual(JSNumber.toString(x), want, "bits " + c["bits"]!.stringValue!)
            // 反方向：JS 写出的文字被 Swift 读回同一个值（−0 写成「0」，读回 +0）。
            if case .number(let back) = try JSONParser.parse(want) {
                XCTAssertEqual(back, x == 0 ? 0 : x, want)
            } else {
                XCTFail("not a number: " + want)
            }
        }
    }

    // B4.1：形状表正反例（含模型往返逐字节不变）、落款汉字数字与题记、文案取用。
    func testSchemaGolden() throws {
        let n = try runOpGolden("schema")
        XCTAssertGreaterThan(n, 1000)
    }

    func testSignatureGolden() throws {
        let n = try runOpGolden("signature")
        XCTAssertGreaterThan(n, 5000)
    }

    func testCopyGolden() throws {
        let n = try runOpGolden("copy")
        XCTAssertGreaterThan(n, 4000)
    }
}
