import Foundation

// src/core/dates.js 的 1:1 移植（B4.0 示例域：日期 4 点分界；B4.1 接着补落款汉字数字 cnDigits / cnNumber / cnCount 等）。
// 逐函数对照，连 JS 的边角行为一起照搬（无效时间 → "NaN-NaN-NaN"、两位年怪癖、addMonths 负下标的「0-10」月份……）：
// 金标准 scripts/core-golden/domains/dates.mjs → Tests/ShiziCoreTests/Fixtures/dates.json；随机差分 scripts/core-diff。
// 时区显式传入（JS 用进程时区；App 里传 TimeZone.current）。

public enum CoreError: Error, Equatable {
    case range(String) // JS RangeError
    case type(String) // JS TypeError
    case badArgs(String) // 协议层：参数形状不对（两个引擎同一套校验）
    case badRequest(String)
    case unknownOp(String)

    public var code: String {
        switch self {
        case .range: return "range"
        case .type: return "type"
        case .badArgs: return "bad-args"
        case .badRequest: return "bad-request"
        case .unknownOp: return "unknown-op"
        }
    }

    public var message: String {
        switch self {
        case .range(let m), .type(let m), .badArgs(let m), .badRequest(let m), .unknownOp(let m): return m
        }
    }
}

public struct Dates {
    /// policy.dayStartHour 的缺省值（P320 / D66 ⑦）。金标准里带着 JS policy 的值，Swift 测试核对两边相同；B4.1 换成生成的 Policy。
    public static let defaultDayStartHour = 4

    public let timeZone: TimeZone
    public init(timeZone: TimeZone) { self.timeZone = timeZone }

    static func pad2(_ n: Int) -> String { n < 10 ? "0" + String(n) : String(n) }

    /// 只认 ASCII 数字（JS 正则 \d 不带 u 标志）。
    static func digits(_ u: ArraySlice<UInt8>) -> Int? {
        var v = 0
        for c in u {
            guard c >= 0x30 && c <= 0x39 else { return nil }
            v = v * 10 + Int(c - 0x30)
        }
        return v
    }

    static func matchDay(_ s: String) -> (Int, Int, Int)? {
        let u = Array(s.utf8)
        guard u.count == 10, u[4] == 0x2D, u[7] == 0x2D,
              let y = digits(u[0..<4]), let m = digits(u[5..<7]), let d = digits(u[8..<10]) else { return nil }
        return (y, m, d)
    }

    static func matchMonth(_ s: String) -> (Int, Int)? {
        let u = Array(s.utf8)
        guard u.count == 7, u[4] == 0x2D, let y = digits(u[0..<4]), let m = digits(u[5..<7]) else { return nil }
        return (y, m)
    }

    public func isValidDay(_ value: JSValue) -> Bool {
        guard case .string(let s) = value, let (y, mo, d) = Dates.matchDay(s) else { return false }
        if mo < 1 || mo > 12 || d < 1 { return false }
        return Double(d) <= daysInMonth(y, mo)
    }

    public func isValidMonth(_ value: JSValue) -> Bool {
        guard case .string(let s) = value, let (_, mo) = Dates.matchMonth(s) else { return false }
        return mo >= 1 && mo <= 12
    }

    /// `new Date(year, month, 0).getDate()`；Date 无效时 NaN。
    public func daysInMonth(_ year: Int, _ month: Int) -> Double {
        guard let t = JSDate.makeLocal(year, month, 0, timeZone), let f = JSDate.localFields(t, timeZone) else { return .nan }
        return Double(f.day)
    }

    static func fieldsKey(_ f: JSDate.Fields?) -> String {
        guard let f = f else { return "NaN-NaN-NaN" }
        return String(f.year) + "-" + pad2(f.month) + "-" + pad2(f.day)
    }

    /// toDate：有限数 → 时间值（无效 Date 为 nil）；其余 TypeError。
    static func toDate(_ input: JSValue) throws -> Double? {
        guard case .number(let x) = input, x.isFinite else { throw CoreError.type("expected a Date or a finite ms timestamp") }
        return JSDate.timeClip(x)
    }

    public func calendarDay(_ input: JSValue) throws -> String {
        Dates.fieldsKey(JSDate.localFields(try Dates.toDate(input), timeZone))
    }

    /// dayStartHourOf(policy)：nil = 缺省 policy；否则按 JS `Number.isInteger(h) && h > 0 && h < 24`。
    public static func dayStartHourOf(_ policyValue: JSValue?) -> Int {
        guard let v = policyValue else { return defaultDayStartHour }
        guard case .number(let h) = v, h.isFinite, h.rounded(.towardZero) == h, h > 0, h < 24 else { return 0 }
        return Int(h)
    }

    public func localDay(_ input: JSValue, dayStartHour policyValue: JSValue? = nil) throws -> String {
        let t = try Dates.toDate(input)
        let f = JSDate.localFields(t, timeZone)
        let day = Dates.fieldsKey(f)
        let h = Dates.dayStartHourOf(policyValue)
        if h != 0, let f = f, f.hours < h { return try addDays(day, -1) }
        return day
    }

    public func parseDay(_ day: JSValue) throws -> (year: Int, month: Int, day: Int) {
        guard isValidDay(day), case .string(let s) = day, let (y, m, d) = Dates.matchDay(s) else {
            throw CoreError.range("invalid day key: " + Dates.jsString(day))
        }
        return (y, m, d)
    }

    func parseDay(_ day: String) throws -> (year: Int, month: Int, day: Int) { try parseDay(.string(day)) }

    public func dayStartMs(_ day: JSValue) throws -> Double {
        let p = try parseDay(day)
        return JSDate.makeLocal(p.year, p.month - 1, p.day, timeZone) ?? .nan
    }

    /// Math.trunc(n) 后的整数天数；超出 Date 可表示范围时结果必然无效，返回 nil。
    static func truncInt(_ n: Double) -> Int? {
        let t = n.rounded(.towardZero)
        guard t.isFinite, abs(t) <= 4e8 else { return nil }
        return Int(t)
    }

    public func addDays(_ day: JSValue, _ n: Double) throws -> String {
        let p = try parseDay(day)
        guard let k = Dates.truncInt(n) else { return "NaN-NaN-NaN" }
        let t = JSDate.makeLocal(p.year, p.month - 1, p.day + k, hours: 12, timeZone)
        return Dates.fieldsKey(JSDate.localFields(t, timeZone))
    }

    func addDays(_ day: String, _ n: Double) throws -> String { try addDays(.string(day), n) }

    public func diffDays(_ a: JSValue, _ b: JSValue) throws -> Double {
        let pa = try parseDay(a)
        let pb = try parseDay(b)
        guard let ua = JSDate.makeUTC(pa.year, pa.month - 1, pa.day), let ub = JSDate.makeUTC(pb.year, pb.month - 1, pb.day) else { return .nan }
        return Dates.jsRound((ub - ua) / JSDate.msPerDay)
    }

    /// Math.round（.5 向 +∞）。
    static func jsRound(_ x: Double) -> Double {
        let f = x.rounded(.down)
        let r = x - f >= 0.5 ? f + 1 : f
        return r == 0 && x < 0 ? -0.0 : r
    }

    public func monthOf(_ dayOrMs: JSValue) throws -> String {
        let day: JSValue
        if case .string = dayOrMs { day = dayOrMs } else { day = .string(try localDay(dayOrMs)) }
        guard isValidDay(day), case .string(let s) = day else { throw CoreError.range("invalid day key: " + Dates.jsString(day)) }
        return String(s.prefix(7))
    }

    public func addMonths(_ month: JSValue, _ n: Double) throws -> String {
        guard isValidMonth(month), case .string(let s) = month, let (y, m) = Dates.matchMonth(s) else {
            throw CoreError.range("invalid month key: " + Dates.jsString(month))
        }
        guard let k = Dates.truncInt(n) else { throw CoreError.badArgs("n out of range") }
        let index = y * 12 + (m - 1) + k
        let year = Int((Double(index) / 12).rounded(.down))
        return String(year) + "-" + Dates.pad2((index % 12) + 1)
    }

    public func dayOfYear(_ day: JSValue) throws -> Double {
        let p = try parseDay(day)
        return try diffDays(.string(String(p.year) + "-01-01"), day) + 1
    }

    public static let periods = ["dawn", "noon", "dusk", "night"]

    public static func periodOfHour(_ hour: Double) throws -> String {
        guard hour.isFinite, hour.rounded(.towardZero) == hour, hour >= 0, hour <= 23 else {
            throw CoreError.range("hour must be an integer 0-23")
        }
        let h = Int(hour)
        if h >= 5 && h < 10 { return "dawn" }
        if h >= 10 && h < 15 { return "noon" }
        if h >= 15 && h < 19 { return "dusk" }
        return "night"
    }

    public func periodOf(_ input: JSValue) throws -> String {
        let f = JSDate.localFields(try Dates.toDate(input), timeZone)
        return try Dates.periodOfHour(f.map { Double($0.hours) } ?? .nan)
    }

    public func monthDayParts(_ day: JSValue) throws -> JSValue {
        let p = try parseDay(day)
        return .object(JSObject([("month", .number(Double(p.month))), ("day", .number(Double(p.day)))]))
    }

    /// 错误信息里的 String(value)（只用于诊断，差分不比 message）。
    static func jsString(_ v: JSValue) -> String {
        switch v {
        case .string(let s): return s
        case .number(let d): return JSNumber.toString(d)
        default: return JSONWriter.stringify(v)
        }
    }
}
