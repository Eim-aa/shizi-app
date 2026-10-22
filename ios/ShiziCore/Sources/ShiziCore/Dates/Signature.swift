import Foundation

// src/core/dates.js 的落款汉字数字（cnDigits / cnNumber / cnCount / signature*）。
// 汉字来自生成的 signature.json（src/core/dates.js 的 CN_NUMERALS），Swift 源码里没有汉字字面量。

public struct CNNumerals {
    public let digits: [String]
    public let zero: String
    public let units: [String]
    public let two: String

    public static let shared = CNNumerals(Config.signature)

    init(_ v: JSValue) {
        digits = (v["digits"]?.arrayValue ?? []).compactMap { $0.stringValue }
        zero = v["zero"]?.stringValue ?? ""
        units = (v["units"]?.arrayValue ?? []).compactMap { $0.stringValue }
        two = v["two"]?.stringValue ?? ""
    }
}

extension Dates {
    static let cn = CNNumerals.shared

    /// 年份式逐位汉字：2026 → 逐位。`Number(n)` 后必须是非负整数，否则 RangeError。
    /// 逐字照搬 JS：`String(v).split('').map(c => CN_DIGITS[Number(c)]).join('')`——v ≥ 1e21 时 String(v) 带 e / + 号，
    /// CN_DIGITS[NaN] 是 undefined，join 当空串。
    public static func cnDigits(_ n: Double) throws -> String {
        guard n.isFinite, n.rounded(.towardZero) == n, n >= 0 else { throw CoreError.range("cnDigits expects a non-negative integer") }
        var out = ""
        for c in JSNumber.toString(n).utf8 {
            if c >= 0x30 && c <= 0x39 { out += cn.digits[Int(c - 0x30)] }
        }
        return out
    }

    /// 计数式汉字数字（0–9999）。
    public static func cnNumber(_ n: Double) throws -> String {
        guard n.isFinite, n.rounded(.towardZero) == n, n >= 0, n <= 9999 else { throw CoreError.range("cnNumber supports integers 0-9999") }
        let v = Int(n)
        if v == 0 { return cn.digits[0] }
        let digits = String(v).utf8.map { Int($0 - 0x30) }
        let len = digits.count
        var out = ""
        var pendingZero = false
        for i in 0..<len {
            let d = digits[i]
            let unit = cn.units[len - 1 - i]
            if d == 0 {
                pendingZero = !out.isEmpty
                continue
            }
            if pendingZero {
                out += cn.zero
                pendingZero = false
            }
            // 10–19 读作「十…」而不是「一十…」。
            if !(d == 1 && len - 1 - i == 1 && i == 0) { out += cn.digits[d] }
            out += unit
        }
        return out
    }

    /// 数量词：2 读「两」，开头的 200 / 2000 读「两百」「两千」；其余同 cnNumber。
    public static func cnCount(_ n: Double) throws -> String {
        if n == 2 { return cn.two }
        let out = try cnNumber(n)
        let two = cn.digits[2]
        if out.hasPrefix(two) {
            let rest = out.dropFirst(two.count)
            if rest.hasPrefix(cn.units[2]) || rest.hasPrefix(cn.units[3]) { return cn.two + rest }
        }
        return out
    }

    /// 日键 → 落款日期各段 {year, month, day}。
    public func signatureDateParts(_ day: JSValue) throws -> JSValue {
        let p = try parseDay(day)
        return .object(JSObject([
            ("year", .string(try Dates.cnDigits(Double(p.year)))),
            ("month", .string(try Dates.cnNumber(Double(p.month)))),
            ("day", .string(try Dates.cnNumber(Double(p.day)))),
        ]))
    }

    /// YYYY-MM → 落款月份各段 {year, month}。
    public func signatureMonthParts(_ month: JSValue) throws -> JSValue {
        guard isValidMonth(month), case .string(let s) = month, let (y, m) = Dates.matchMonth(s) else {
            throw CoreError.range("invalid month key: " + Dates.jsString(month))
        }
        return .object(JSObject([
            ("year", .string(try Dates.cnDigits(Double(y)))),
            ("month", .string(try Dates.cnNumber(Double(m)))),
        ]))
    }
}
