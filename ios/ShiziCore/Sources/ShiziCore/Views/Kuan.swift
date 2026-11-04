import Foundation

// Kuan view; invalid/missing day falls back to the injected clock.
public enum KuanView {
    public static func dateRef(_ day: JSValue?, now: Double, dates: Dates) throws -> JSValue {
        let valid = day.map { dates.isValidDay($0) } ?? false
        return ViewSupport.ref("R-I01.signatureDate", try dates.signatureDateParts(valid ? day! : .string(try dates.localDay(.number(now)))))
    }
    public static func monthRef(_ month: JSValue, dates: Dates) throws -> JSValue {
        ViewSupport.ref("R-I01.signatureMonth", try dates.signatureMonthParts(month))
    }
    public static func partRef(_ i: Double) throws -> JSValue { ViewSupport.ref("X-WORK.kuanPart", ViewSupport.obj([("n", .string(try Dates.cnNumber(i)))])) }
    public static func kuanRef(_ a: JSObject = JSObject(), now: Double, dates: Dates) throws -> JSValue {
        if JS.truthy(a["brand"]) { return ViewSupport.ref("X-WORK.annualBrand") }
        let date = try JS.truthy(a["month"]) ? monthRef(a["month"]!, dates: dates) : dateRef(a["day"], now: now, dates: dates)
        let n = a["n"]?.numberValue
        let base = try n != nil && n!.isFinite && n! >= 0 ? ViewSupport.ref("X-WORK.kuanJoin", ViewSupport.obj([("date", date), ("n", ViewSupport.ref(JS.truthy(a["picked"]) ? "X-WORK.kuanCountPicked" : "X-WORK.kuanCount", ViewSupport.obj([("n", .string(try Dates.cnCount(n!)))])))])) : date
        return try JS.truthy(a["part"]) && JS.number(a["of"] ?? .number(1)) > 1 ? ViewSupport.ref("X-WORK.kuanJoinPart", ViewSupport.obj([("kuan", base), ("part", partRef(JS.number(a["part"])))])) : base
    }
    public static func annualYearText(_ year: Double) throws -> String { try Dates.cnDigits(year) }
    public static func annualCoverLineRef(_ n: Double) throws -> JSValue { ViewSupport.ref("X-WORK.annualCoverLine", ViewSupport.obj([("n", .string(try Dates.cnCount(n)))])) }
}
