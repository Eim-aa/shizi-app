import Foundation
import XCTest
@testable import ShiziCore

// 转写测试的共用工具。源码与测试里不写汉字字面量：汉字一律用 \u{…} 转义（人 = U+4EBA，口 = U+53E3，𠮷 = U+20BB7 …）。

let ren = "\\u4eba" // JSON 转义（用在 JSON 字面量里）：人
let kou = "\\u53e3"

/// 解析 JSON 字面量（失败即测试失败）。
func J(_ text: String, file: StaticString = #filePath, line: UInt = #line) -> JSValue {
    do { return try JSONParser.parse(text) } catch {
        XCTFail("bad JSON literal: \(text) (\(error))", file: file, line: line)
        return .null
    }
}

func str(_ v: JSValue) -> String { JSONWriter.stringify(v) }

/// 仓库根（本文件在 ios/ShiziCore/Tests/ShiziCoreTests/ 下）。
let repoRoot: URL = {
    var u = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { u.deleteLastPathComponent() }
    return u
}()

func readRepoFile(_ rel: String) throws -> String {
    String(decoding: try Data(contentsOf: repoRoot.appendingPathComponent(rel)), as: UTF8.self)
}

/// Swift 版校验的回包形式：nil → null。
func nullable(_ s: String?) -> JSValue { s.map { .string($0) } ?? .null }

/// store 测试夹具的基线状态（schema 金标准夹具里的 baseline，来自 test/store/helpers.mjs baselineState）。
func baselineState() throws -> JSObject {
    guard let o = try loadFixture("schema")["baseline"]?.objectValue else { throw CoreError.badArgs("no baseline in fixture") }
    return o
}

let T0 = 1789434000000.0

/// test/store/helpers.mjs makeRecord()。
func makeRecord(_ serial: Int, _ char: String, kind: String = "judged", judgment: String = "correct", day: String = "2026-09-15", session: Int = 1,
            extra: [(String, JSValue)] = []) -> JSValue {
    var pairs: [(String, JSValue)] = [
        ("id", .string("r\(serial)")), ("cardKey", .string("base:" + char)), ("char", .string(char)), ("sessionId", .string("s\(session)")),
        ("kind", .string(kind)), ("at", .number(T0 + Double(serial) * 1000)), ("localDay", .string(day)),
        ("help", .object(JSObject([("hints", .number(0)), ("answerSeen", .bool(kind == "answer-seen")), ("traced", .bool(false))]))),
    ]
    if kind == "judged" { pairs.append(("judgment", .string(judgment))) }
    var o = JSObject(pairs)
    for (k, v) in extra { o[k] = v }
    return .object(o)
}

func removing(_ v: JSValue, _ key: String) -> JSValue {
    guard case .object(var o) = v else { return v }
    o[key] = nil
    return .object(o)
}

func setting(_ v: JSValue, _ key: String, _ value: JSValue) -> JSValue {
    guard case .object(var o) = v else { return v }
    o[key] = value
    return .object(o)
}

func contains(_ err: String?, _ part: String) -> Bool { err?.contains(part) ?? false }

let sixTimeZone = TimeZone(identifier: "Asia/Shanghai")!
