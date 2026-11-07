import Foundation

// JS Date 的本地时间语义（B4.0；ECMA-262 §21.4.1），供 Dates 的 1:1 移植用：
//   · 时间值 = 自 1970-01-01T00:00Z 的毫秒（Double）；TimeClip：|t| > 8.64e15 为无效（nil），非整数向零截断；
//   · 历法 = 前推格里历、天文纪年（有 0 年与负年），不用 Foundation 的 Calendar（它在 1582 年前换儒略历、年份按纪元）；
//   · 本地 ↔ UTC 按时区偏移；本地时刻不存在（夏令时跳过的那段）时取跳变前的偏移（结果落在跳变之后），
//     本地时刻重复时取较早的那个时刻——与 V8 / Temporal 的「compatible」消歧一致；
//   · `new Date(y, m, d, …)` / `Date.UTC(y, …)` 的两位年怪癖：0 ≤ y ≤ 99 当作 1900 + y（行为依赖它，照搬）。

public enum JSDate {
    public static let msPerDay: Double = 86_400_000
    static let maxTime: Double = 8.64e15

    /// TimeClip。
    public static func timeClip(_ t: Double) -> Double? {
        guard t.isFinite, abs(t) <= maxTime else { return nil }
        return t < 0 ? -(-t).rounded(.down) : t.rounded(.down)
    }

    /// 前推格里历：年月日 → 自 1970-01-01 的天数（H. Hinnant days_from_civil）。m 为 1–12。
    public static func daysFromCivil(_ y0: Int, _ m: Int, _ d: Int) -> Int {
        let y = m <= 2 ? y0 - 1 : y0
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let mp = (m + 9) % 12
        let doy = (153 * mp + 2) / 5 + d - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    /// 天数 → 年月日（civil_from_days）。
    public static func civilFromDays(_ z0: Int) -> (year: Int, month: Int, day: Int) {
        let z = z0 + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        return (m <= 2 ? yoe + era * 400 + 1 : yoe + era * 400, m, d)
    }

    /// MakeDay(year, monthIndex 0 起, date)：月份越界按年进位。年月日都是整数。
    public static func makeDay(_ year: Int, _ monthIndex: Int, _ date: Int) -> Int {
        let ym = year + Int((Double(monthIndex) / 12).rounded(.down))
        let mn = ((monthIndex % 12) + 12) % 12
        return daysFromCivil(ym, mn + 1, 1) + date - 1
    }

    /// Date 构造器的两位年怪癖。
    public static func legacyYear(_ y: Int) -> Int { (0...99).contains(y) ? 1900 + y : y }

    static func offsetMs(_ tz: TimeZone, _ t: Double) -> Double {
        Double(tz.secondsFromGMT(for: Date(timeIntervalSince1970: t / 1000))) * 1000
    }

    /// LocalTime(t)。
    public static func localTime(_ t: Double, _ tz: TimeZone) -> Double { t + offsetMs(tz, t) }

    /// UTC(tl)：本地时间值 → 时间值（见文件头的消歧规则）。
    public static func utc(_ tl: Double, _ tz: TimeZone) -> Double {
        let before = offsetMs(tz, tl - msPerDay)
        let after = offsetMs(tz, tl + msPerDay)
        var instants: [Double] = []
        for o in Set([before, after]) where offsetMs(tz, tl - o) == o { instants.append(tl - o) }
        if let first = instants.min() { return first }
        return tl - before
    }

    public struct Fields: Equatable {
        public let year: Int, month: Int, day: Int, hours: Int
    }

    /// 本地年 / 月（1 起）/ 日 / 时；t 无效时 nil（JS 各 getter 返回 NaN）。
    public static func localFields(_ t: Double?, _ tz: TimeZone) -> Fields? {
        guard let t = t else { return nil }
        let tl = localTime(t, tz)
        let dayNum = (tl / msPerDay).rounded(.down)
        let msInDay = tl - dayNum * msPerDay
        let c = civilFromDays(Int(dayNum))
        return Fields(year: c.year, month: c.month, day: c.day, hours: Int((msInDay / 3_600_000).rounded(.down)))
    }

    /// `new Date(y, monthIndex, date, hours).getTime()`（各参数为整数；构造器语义含两位年怪癖与 TimeClip）。
    public static func makeLocal(_ year: Int, _ monthIndex: Int, _ date: Int, hours: Int = 0, _ tz: TimeZone) -> Double? {
        let day = makeDay(legacyYear(year), monthIndex, date)
        let tl = Double(day) * msPerDay + Double(hours) * 3_600_000
        return timeClip(utc(tl, tz))
    }

    /// `Date.UTC(y, monthIndex, date)`。
    public static func makeUTC(_ year: Int, _ monthIndex: Int, _ date: Int) -> Double? {
        timeClip(Double(makeDay(legacyYear(year), monthIndex, date)) * msPerDay)
    }
}
