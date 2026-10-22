import Foundation

// src/core/hints.js（提示量，D25 方案① / D64 ①；R-W05 / R-W06 / R-W08）与 src/core/correct.js（事后改判的调度重算，D66 ④）的 1:1 移植（B4.2）。
// 提示的输入是 JS 形状的对象 {totalStrokes, used, hasStrokeData?, hasGroups?}；缺省值只在键为 undefined 时生效（与解构默认值同）。

public enum Hints {
    static func flag(_ input: JSValue?, _ key: String) -> Bool {
        guard let v = input?[key] else { return true } // 缺省 true
        return JS.truthy(v)
    }

    static func positiveInt(_ v: JSValue?) -> Double? {
        let n = JS.number(v)
        return n.isFinite && n.rounded(.towardZero) == n && n >= 1 ? n : nil
    }

    /// 每段提示的笔数：max(1, round(N/4))。
    public static func quota(_ totalStrokes: JSValue?) throws -> Double {
        guard let n = positiveInt(totalStrokes) else { throw CoreError.range("totalStrokes must be a positive integer") }
        return jsMax(1, JSMath.round(n / 4))
    }

    /// 'none' | 'quarter' | 'prefix'。
    public static func mode(_ input: JSValue?) -> String {
        if !flag(input, "hasStrokeData") { return "none" }
        return flag(input, "hasGroups") ? "quarter" : "prefix"
    }

    static func perSegment(_ n: Double, _ mode: String) throws -> Double { mode == "quarter" ? try quota(.number(n)) : 1 }

    static func count(_ used: JSValue?) -> Double { jsMax(0, JS.numberOr0(used).rounded(.towardZero)) }

    public static func given(_ input: JSValue?) throws -> Double {
        let m = mode(input)
        if m == "none" { return 0 }
        guard let n = positiveInt(input?["totalStrokes"]) else { throw CoreError.range("totalStrokes must be a positive integer") }
        return jsMin(n, count(input?["used"]) * (try perSegment(n, m)))
    }

    public static func segments(_ input: JSValue?) throws -> Double {
        let m = mode(input)
        if m == "none" { return 0 }
        guard let n = positiveInt(input?["totalStrokes"]) else { return 0 }
        return (n / (try perSegment(n, m))).rounded(.up)
    }

    public static func remaining(_ input: JSValue?) throws -> Double { jsMax(0, try segments(input) - count(input?["used"])) }

    public static func allGiven(_ input: JSValue?) throws -> Bool {
        guard mode(input) != "none", let n = positiveInt(input?["totalStrokes"]) else { return false }
        return try given(input) >= n
    }

    /// 下一次提示给哪几笔；没有可给的返回 nil。
    public static func nextRange(_ input: JSValue?) throws -> JSValue {
        let m = mode(input)
        if m == "none" { return .null }
        guard let n = positiveInt(input?["totalStrokes"]) else { throw CoreError.range("totalStrokes must be a positive integer") }
        let from = try given(input)
        if from >= n { return .null }
        return JS.obj([("from", .number(from)), ("count", .number(jsMin(try perSegment(n, m), n - from))), ("index", .number(count(input?["used"]) + 1))])
    }

    /// 提示按钮状态。
    public static func buttonState(_ input: JSValue?) throws -> JSValue {
        let used = input?["used"] ?? .number(0)
        let hasStrokeData = input?["hasStrokeData"] ?? .bool(true)
        let total = input?["totalStrokes"] ?? .number(0)
        let hasGroups = input?["hasGroups"] ?? .bool(true)
        if !JS.truthy(hasStrokeData) { return JS.obj([("state", .string("unavailable"))]) }
        if !(JS.number(total) >= 1) { return JS.obj([("state", .string("available")), ("remaining", .null)]) }
        let rem = try remaining(JS.obj([("used", used), ("totalStrokes", total), ("hasStrokeData", hasStrokeData), ("hasGroups", hasGroups)]))
        return rem > 0 ? JS.obj([("state", .string("available")), ("remaining", .number(rem))]) : JS.obj([("state", .string("exhausted"))])
    }

    /// 按钮状态 → copy 键与占位值（R-W05）。
    public static func buttonCopy(_ state: JSValue) throws -> JSValue {
        let empty = JSValue.object(JSObject())
        switch state["state"]?.stringValue {
        case "available"?:
            if state["remaining"] == nil || state["remaining"] == .null { return JS.obj([("key", .string("R-W05.hintLabel")), ("vars", empty)]) }
            return JS.obj([("key", .string("R-W05.hintRemaining")), ("vars", JS.obj([("n", state["remaining"]!)]))])
        case "exhausted"?: return JS.obj([("key", .string("R-W05.hintUsedUp")), ("vars", empty)])
        case "unavailable"?: return JS.obj([("key", .string("R-W05.hintUnavailable")), ("vars", empty)])
        default: throw CoreError.range("unknown hint button state")
        }
    }
}

// MARK: - correct.js

extension ScheduleRules {
    /// 在 A / B 两个槽和各自的 lastEnded 里找这条记录判断前的卡；找不到 nil（undefined）。
    public static func findFsrsBefore(_ sessions: JSValue?, _ recordId: JSValue?) -> JSValue? {
        let s = sessions.flatMap { JS.truthy($0) ? $0 : nil } ?? .object(JSObject())
        let le = s["lastEnded"]
        let candidates: [JSValue?] = [s["A"], s["B"], JS.truthy(le) ? le?["A"] : nil, JS.truthy(le) ? le?["B"] : nil]
        for c in candidates {
            guard let session = c, JS.truthy(session) else { continue }
            if let found = SessionRules.fsrsBeforeOf(session, recordId) { return found }
        }
        return nil
    }

    /// 改判后这个字新的 sched 项（records = 本字全部记录，已含改判后的那一条）；没有 judged 记录时 nil。
    public func schedAfterCorrection(records: [JSValue], recordId: JSValue?, fsrsBefore: JSValue?, policy: JSValue = Config.policy, stoppedAt: JSValue? = nil) throws -> JSValue? {
        let judged = SchedRecords.sortById(records.filter { SchedRecords.isJudged($0) })
        if let fb = fsrsBefore {
            return try replay(fb, judged.filter { SchedRecords.compareRecordIds($0["id"], recordId) >= 0 }, policy: policy, stoppedAt: stoppedAt)
        }
        return try replay(nil, judged, policy: policy, stoppedAt: stoppedAt)
    }
}
