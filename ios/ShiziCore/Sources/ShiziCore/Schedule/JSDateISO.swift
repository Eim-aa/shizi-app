import Foundation

// Date.prototype.toISOString 与 Date.parse（ISO 格式）的 JS 语义（B4.2：FSRS 卡的 due / last_review 是 ISO 字串）。
// Date.parse 只实现 ECMAScript 的日期时间字串格式（V8 的宽松处：日 01–31 溢出到下月、t / z 小写、空格代替 T、小数秒任意位截到毫秒、24:00）；
// V8 的「旧式」回退格式（「Mar 2 2026」之类）不实现，返回 NaN——FSRS 卡与记录里只有 toISOString 写出的字串。

extension JSDate {
    /// toISOString；无效时间（NaN / 超出 TimeClip）抛 RangeError（与 JS 同）。
    public static func isoString(_ t: Double) throws -> String {
        guard let v = timeClip(t) else { throw CoreError.range("Invalid time value") }
        let days = Int((v / msPerDay).rounded(.down))
        var msInDay = Int(v - Double(days) * msPerDay)
        if msInDay < 0 { msInDay += Int(msPerDay) }
        let (y, m, d) = civilFromDays(days)
        let h = msInDay / 3_600_000, mi = (msInDay / 60_000) % 60, s = (msInDay / 1000) % 60, ms = msInDay % 1000
        func pad(_ n: Int, _ w: Int) -> String {
            let s = String(n)
            return String(repeating: "0", count: max(0, w - s.count)) + s
        }
        let year = (0...9999).contains(y) ? pad(y, 4) : (y < 0 ? "-" : "+") + pad(abs(y), 6)
        return year + "-" + pad(m, 2) + "-" + pad(d, 2) + "T" + pad(h, 2) + ":" + pad(mi, 2) + ":" + pad(s, 2) + "." + pad(ms, 3) + "Z"
    }

    /// Date.parse（ISO 格式）；不认识返回 NaN。无时区的日期时间按本地时间（tz）。
    public static func parse(_ text: String, _ tz: TimeZone) -> Double {
        let u = Array(text.utf8)
        var i = 0
        func digits(_ n: Int) -> Int? {
            guard i + n <= u.count else { return nil }
            var v = 0
            for k in 0..<n {
                let c = u[i + k]
                guard c >= 0x30 && c <= 0x39 else { return nil }
                v = v * 10 + Int(c - 0x30)
            }
            i += n
            return v
        }
        func eat(_ c: UInt8) -> Bool {
            if i < u.count && u[i] == c { i += 1; return true }
            return false
        }
        var year: Int
        if i < u.count && (u[i] == 0x2B || u[i] == 0x2D) {
            let neg = u[i] == 0x2D
            i += 1
            guard let y = digits(6) else { return .nan }
            if neg && y == 0 { return .nan }
            year = neg ? -y : y
        } else {
            guard let y = digits(4) else { return .nan }
            year = y
        }
        var month = 1, day = 1
        var hasTime = false
        var h = 0, mi = 0, s = 0, ms = 0
        var offset: Int? = nil // 分钟
        if eat(0x2D) {
            guard let m = digits(2), (1...12).contains(m) else { return .nan }
            month = m
            if eat(0x2D) {
                guard let d = digits(2), (1...31).contains(d) else { return .nan }
                day = d
            }
        }
        if i < u.count && (u[i] == 0x54 || u[i] == 0x74 || u[i] == 0x20) {
            i += 1
            hasTime = true
            guard let hh = digits(2), eat(0x3A), let mm = digits(2) else { return .nan }
            h = hh
            mi = mm
            if eat(0x3A) {
                guard let ss = digits(2) else { return .nan }
                s = ss
                if eat(0x2E) {
                    var n = 0, frac = 0
                    while i < u.count && u[i] >= 0x30 && u[i] <= 0x39 {
                        if n < 3 { frac = frac * 10 + Int(u[i] - 0x30) }
                        n += 1
                        i += 1
                    }
                    if n == 0 { return .nan }
                    if n < 3 { for _ in n..<3 { frac *= 10 } }
                    ms = frac
                }
            }
            if h > 24 || mi > 59 || s > 59 { return .nan }
            if h == 24 && (mi != 0 || s != 0 || ms != 0) { return .nan }
            if i < u.count && (u[i] == 0x5A || u[i] == 0x7A) {
                i += 1
                offset = 0
            } else if i < u.count && (u[i] == 0x2B || u[i] == 0x2D) {
                let sign = u[i] == 0x2D ? -1 : 1
                i += 1
                guard let oh = digits(2), eat(0x3A), let om = digits(2), oh <= 23, om <= 59 else { return .nan }
                offset = sign * (oh * 60 + om)
            }
        }
        if i != u.count { return .nan }
        let dayNum = Double(makeDay(year, month - 1, day))
        let t = dayNum * msPerDay + Double(h) * 3_600_000 + Double(mi) * 60_000 + Double(s) * 1000 + Double(ms)
        let v: Double
        if !hasTime {
            v = t // 只有日期：UTC
        } else if let off = offset {
            v = t - Double(off) * 60_000
        } else {
            v = utc(t, tz)
        }
        return timeClip(v) ?? .nan
    }
}
