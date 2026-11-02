import Foundation
import XCTest
@testable import ShiziCore

// 金标准（计划 §4.3 ①）：夹具由 node scripts/core-golden/golden.mjs 用 JS 参考实现生成，这里逐条比对。
// 按 op 组织的域：每组一个时区，CoreEngine 跑同一个 op，比 ok、reply（值相等 + 序列化逐字节相同）或错误码。

func loadFixture(_ name: String) throws -> JSObject {
    guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures") else {
        throw XCTSkip("missing fixture " + name)
    }
    let text = try String(contentsOf: url, encoding: .utf8)
    guard let o = try JSONParser.parse(text).objectValue else { throw CoreError.badArgs("fixture is not an object") }
    return o
}

/// S2（调度规则 v2，D83）：规则改了、不再与 JS 参考对照的 op（D82：JS 不再是参考；这些规则由 Swift 自己的测试守，
/// 见 TodayPlanTests / TodayPlanSimulationTests）。夹具仍由 golden.mjs 从 JS 生成（--check 照常），这里跳过这些 op 的条目。
let d83RetiredGoldenOps: Set<String> = [
    // 配比（规则 D 的积压阀 / 新字目标 / 每日复习上限 / 新用户封顶 / 久别摊开）→ TodayPlan.compose
    "mix.pressureOf", "mix.newTargetOf", "mix.planGroup", "mix.dueReviewsDoneOn", "mix.newUserCapOf",
    "sessions.wrongReserveOf", "groupSize.dailyReviewCapOf", "spread.returnSpreadPlan", "spread.returnSpreadPerDay",
    // 选字与开组（今天的练习一天一份、再来一组、到期字按回忆概率排、自加的字优先）
    "sessions.selectDaily", "start.planDaily", "start.startDaily", "start.startNextA", "start.expireStale",
    // FSRS：复习日期只看当天第一次；新字第一次就看答案记 Again
    "fsrs.replay", "fsrs.applyAnswerSeen", "fsrs.applyJudgment",
    // 首页（今天的进度 / 今天完成了 / 再来一组）、「我的」（新字比例档位）、字库「今日练习」
    "view.home", "view.home.model", "view.home.helpers", "view.mine", "view.mine.helpers", "view.library", "view.library.plan",
]

/// 按 op 组织的夹具逐条跑；返回比对条数（跳过 d83RetiredGoldenOps）。
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
            if let op = c["op"]?.stringValue, d83RetiredGoldenOps.contains(op) { continue }
            // D83：会话 item 多了 retry 一种（形状表的报错句列出可选值，与 JS 的不同）
            if JSONWriter.stringify(c["reply"] ?? .null).contains("judged|answer-seen|skipped") { continue }
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
