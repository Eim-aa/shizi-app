import Foundation
import XCTest
@testable import ShiziCore

// B4.3 转写测试的共用工具（对应 test/core/helpers.mjs 的 at / rec）。源码与测试里不写汉字字面量：用到的字一律在这里用 \u{…} 转义命名。

let jing43 = "\u{9759}" // 静
let yi43 = "\u{4EA6}" // 亦
let man43 = "\u{6162}" // 慢
let e143 = "\u{989D}" // 额
let xian43 = "\u{9C9C}" // 鲜
let yong43 = "\u{6C38}" // 永
let he43 = "\u{548C}" // 和
let chun43 = "\u{6625}" // 春
let da43 = "\u{5927}" // 大
let zhong43 = "\u{4E2D}" // 中
let ying43 = "\u{8D62}" // 赢
let zhi43 = "\u{7EB8}" // 纸
let ren243 = "\u{4EBA}" // 人
let kou243 = "\u{53E3}" // 口
let jingYi43 = jing43 + yi43 // 静亦

let shanghai43 = Dates(timeZone: sixTimeZone)

/// 本地时间 ms（Asia/Shanghai）：at("2026-09-24", 20) = 2026-09-24 20:00 本地。
func at43(_ day: String, _ hour: Int = 12, _ minute: Int = 0) -> Double {
    let p = day.split(separator: "-").map { Int($0)! }
    return JSDate.makeLocal(p[0], p[1] - 1, p[2], hours: hour, sixTimeZone)! + Double(minute) * 60_000
}

func obj43(_ pairs: [(String, JSValue)]) -> JSValue { .object(JSObject(pairs)) }
func s43(_ v: String) -> JSValue { .string(v) }
func n43(_ v: Double) -> JSValue { .number(v) }
func n43(_ v: Int) -> JSValue { .number(Double(v)) }
func arrayOf43(_ v: [String]) -> JSValue { .array(v.map { .string($0) }) }
func jsArray43(_ v: [JSValue]) -> JSValue { .array(v) }

/// test/core/helpers.mjs rec()：绕过 makeRecord 的便捷写法，字段与 01 §3.2 一致。
func rec43(_ serial: Int, _ char: String, _ kind: String, _ judgment: String?, _ day: String, sessionId: String = "s1", at atMs: Double? = nil,
         hints: Double = 0, extra: [(String, JSValue)] = []) -> JSValue {
    var pairs: [(String, JSValue)] = [
        ("id", s43("r\(serial)")), ("cardKey", s43("base:" + char)), ("char", s43(char)), ("sessionId", s43(sessionId)), ("kind", s43(kind)),
        ("at", n43(atMs ?? at43(day, 12, serial % 60))), ("localDay", s43(day)),
        ("help", obj43([("hints", n43(hints)), ("answerSeen", .bool(kind == "answer-seen")), ("traced", .bool(false))])),
    ]
    if kind == "judged", let j = judgment { pairs.append(("judgment", s43(j))) }
    var o = JSObject(pairs)
    for (k, v) in extra { o[k] = v }
    return .object(o)
}

func ids43(_ records: [JSValue]) -> [String] { records.map { $0["id"]?.stringValue ?? "" } }
func chars43(_ records: [JSValue]) -> [String] { records.map { $0["char"]?.stringValue ?? "" } }

/// 注入的 hasInk：记录 id 在集合里。
func inkIn43(_ list: [String]) -> InkPick.HasInk { { r in list.contains { JSX.eq(r["id"], $0) } } }

func jsonText43(_ v: JSValue) -> String { JSONWriter.stringify(v) }

/// 断言两个 JSValue 的序列化文字（含键序）逐字节相同。
func XCTAssertSameJSON(_ a: JSValue, _ b: JSValue, _ message: String = "", file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertEqual(jsonText43(a), jsonText43(b), message, file: file, line: line)
}

/// 断言抛出指定错误码且消息含片段。
func XCTAssertThrowsCore(_ code: String, containing part: String = "", file: StaticString = #filePath, line: UInt = #line, _ body: () throws -> Void) {
    do {
        try body()
        XCTFail("expected throw", file: file, line: line)
    } catch let e as CoreError {
        XCTAssertEqual(e.code, code, file: file, line: line)
        XCTAssertTrue(part.isEmpty || e.message.contains(part), "message \"\(e.message)\" lacks \"\(part)\"", file: file, line: line)
    } catch {
        XCTFail("unexpected error \(error)", file: file, line: line)
    }
}

/// 一条记录以外字段的存取简写。
extension JSValue {
    var string: String? { stringValue }
}
