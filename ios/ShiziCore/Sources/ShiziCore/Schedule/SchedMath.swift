import Foundation

// JS 数值语义的小工具（B4.2：FSRS 与选字要与 V8 逐位一致；计划 §4.3「数字与 JSON」）。
//
// · Math.exp / Math.log：V8 用的是 fdlibm 移植（v8/src/base/ieee754.cc），与 Darwin libm 在约 2% / 0.5% 的输入上差 1 ulp
//   （B4.2 实测 30 万组）；这里照 V8 的 fdlibm 版逐行移植。Math.pow 在 V8 里走 std::pow，与 Darwin `pow` 逐位相同（同一实测），直接用。
// · Math.round：.5 向 +∞，保留 −0（Dates.jsRound）。
// · Number.prototype.toFixed(f) 再 `+`：按双精度的精确二进制值做十进制「四舍五入、同距取大」（ECMA-262 §21.1.3.3），再按最近值读回。
// · ToInt32 / ToUint32（`x|0`、`x>>>0`）。
// B4.3 已有 Ink/JSMath.swift（Math.hypot / exp / round / max / min 的 V8 复刻）；这里是 B4.2 加的扩展。
extension JSMath {
    /// FSRS 里的 Math.exp / Math.log 跟哪个 JS 引擎：
    ///   .v8     = node（V8）的 fdlibm 移植，darwin-arm64 上编译器把乘加收缩成 FMA——差分 / 金标准 / 调度模拟器的参考实现（缺省）；
    ///   .darwin = 系统 libm——iOS 上 WKWebView 的 JavaScriptCore 用的就是它（B4.2 实测 jsc 与 Darwin libm 120 万组逐位相同）。
    /// 两者在约 2% 的 exp、0.5% 的 log 输入上差 1 ulp；FSRS 的结果再经 toFixed(8)，绝大多数被吸收（见 B4.2 实施记录）。
    /// App 内用哪个由 B4.5 / B4.7（影子运行对的是设备上的 JSC）决定；进程启动时设一次，之后不要改。
    public enum Flavor { case v8, darwin }
    public static var flavor: Flavor = .v8

    /// FSRS 用的 Math.exp（.v8 = B4.3 的 `JSMath.exp`）。
    @inline(__always) public static func schedExp(_ x: Double) -> Double { flavor == .v8 ? exp(x) : Foundation.exp(x) }
    @inline(__always) public static func log(_ x: Double) -> Double { flavor == .v8 ? v8Log(x) : Foundation.log(x) }

    // MARK: fdlibm（V8 base::ieee754）

    @inline(__always) static func hi(_ x: Double) -> Int32 { Int32(bitPattern: UInt32(truncatingIfNeeded: x.bitPattern >> 32)) }
    @inline(__always) static func lo(_ x: Double) -> UInt32 { UInt32(truncatingIfNeeded: x.bitPattern) }
    @inline(__always) static func words(_ h: Int32, _ l: UInt32) -> Double {
        Double(bitPattern: (UInt64(UInt32(bitPattern: h)) << 32) | UInt64(l))
    }
    @inline(__always) static func setHi(_ x: Double, _ h: Int32) -> Double { words(h, lo(x)) }

    /// V8 `Math.log`（ieee754::log，fdlibm e_log.c 的 FreeBSD 版；同上，fma 照 V8 arm64 的机器码）。
    public static func v8Log(_ x0: Double) -> Double {
        let ln2_hi = 6.93147180369123816490e-01
        let ln2_lo = 1.90821492927058770002e-10
        let two54 = 1.80143985094819840000e+16
        let Lg1 = 6.666666666666735130e-01
        let Lg2 = 3.999999999940941908e-01
        let Lg3 = 2.857142874366239149e-01
        let Lg4 = 2.222219843214978396e-01
        let Lg5 = 1.818357216161805012e-01
        let Lg6 = 1.531383769920937332e-01
        let Lg7 = 1.479819860511658591e-01
        let zero = 0.0

        var x = x0
        var hx = JSMath.hi(x)
        let lx = JSMath.lo(x)
        var k: Int32 = 0
        if hx < 0x0010_0000 { // x < 2**-1022
            if ((hx & 0x7FFF_FFFF) | Int32(bitPattern: lx)) == 0 { return -two54 / zero }
            if hx < 0 { return (x - x) / zero }
            k -= 54
            x *= two54
            hx = JSMath.hi(x)
        }
        if hx >= 0x7FF0_0000 { return x + x }
        k += (hx >> 20) - 1023
        hx &= 0x000F_FFFF
        var i: Int32 = (hx &+ 0x95F64) & 0x10_0000
        x = setHi(x, hx | (i ^ 0x3FF0_0000))
        k += (i >> 20)
        let f = x - 1.0
        if (0x000F_FFFF & (2 &+ hx)) < 3 { // -2**-20 <= f < 2**-20
            if f == zero {
                if k == 0 { return zero }
                let dk = Double(k)
                return fma(dk, ln2_hi, dk * ln2_lo)
            }
            let R = f * f * fma(-0.33333333333333333, f, 0.5)
            if k == 0 { return f - R }
            let dk = Double(k)
            return fma(dk, ln2_hi, -(fma(-dk, ln2_lo, R) - f))
        }
        let s = f / (2.0 + f)
        let dk = Double(k)
        let z = s * s
        i = hx &- 0x6147A
        let w = z * z
        let j: Int32 = 0x6B851 &- hx
        let t1 = w * fma(w, fma(w, Lg6, Lg4), Lg2)
        let t2 = z * fma(w, fma(w, fma(w, Lg7, Lg5), Lg3), Lg1)
        i |= j
        let R = t2 + t1
        if i > 0 {
            let hfsq = 0.5 * f * f
            if k == 0 { return f - fma(-s, hfsq + R, hfsq) }
            return fma(dk, ln2_hi, -((hfsq - fma(s, hfsq + R, dk * ln2_lo)) - f))
        }
        if k == 0 { return fma(-s, f - R, f) }
        return fma(dk, ln2_hi, -(fma(s, f - R, -(dk * ln2_lo)) - f))
    }

    /// V8 `Math.pow`（std::pow；与 Darwin libm 逐位相同）。
    @inline(__always) public static func pow(_ x: Double, _ y: Double) -> Double { Foundation.pow(x, y) }

    // MARK: 取整与整数转换

    /// ToUint32（`x >>> 0`）。
    public static func toUint32(_ x: Double) -> Double {
        guard x.isFinite else { return 0 }
        let n = x.rounded(.towardZero)
        var m = n.truncatingRemainder(dividingBy: 4_294_967_296)
        if m < 0 { m += 4_294_967_296 }
        return m == 0 ? 0 : m
    }

    /// ToInt32（`x | 0`）。
    public static func toInt32(_ x: Double) -> Double {
        let m = toUint32(x)
        return m >= 2_147_483_648 ? m - 4_294_967_296 : m
    }

    // MARK: toFixed

    /// `+x.toFixed(digits)`（0 ≤ digits ≤ 20）。
    public static func toFixedNumber(_ x: Double, _ digits: Int) -> Double {
        if !x.isFinite { return x }
        if abs(x) >= 1e21 { return x }
        let neg = x < 0
        let n = fixedDigits(abs(x), digits)
        let v: Double
        if n.hi == 0 && n.lo < (1 << 53) && digits <= 22 {
            v = Double(n.lo) / pow10[digits] // 两个精确值相除，IEEE 除法即最近值
        } else {
            v = Double(n.decimalString + "e-" + String(digits)) ?? .nan
        }
        // JS：(-0.0000000001).toFixed(8) = "-0.00000000"，+ 之后是 -0
        return neg ? -v : v
    }

    static let pow10: [Double] = (0...22).map { Foundation.pow(10.0, Double($0)) }

    /// round_half_up(x × 10^f)，x ≥ 0 有限，按精确二进制值。
    static func fixedDigits(_ x: Double, _ f: Int) -> U128 {
        if x == 0 { return U128(0) }
        let bits = x.bitPattern
        let expBits = Int((bits >> 52) & 0x7ff)
        var mant = bits & ((1 << 52) - 1)
        var e: Int
        if expBits == 0 { e = -1074 } else { mant |= (1 << 52); e = expBits - 1075 }
        // x = mant × 2^e；x × 10^f = mant × 5^f × 2^(e+f)
        var p = U128(mant)
        for _ in 0..<f { p = p.times(5) }
        let s = e + f
        if s >= 0 { return p.shiftedLeft(s) }
        let k = -s
        if k > 127 { return U128(0) }
        let q = p.shiftedRight(k)
        let half = p.shiftedRight(k - 1).lo & 1
        return half == 1 ? q.plus(1) : q
    }

    struct U128 {
        var hi: UInt64
        var lo: UInt64
        init(_ v: UInt64) { hi = 0; lo = v }
        init(hi: UInt64, lo: UInt64) { self.hi = hi; self.lo = lo }

        func times(_ m: UInt64) -> U128 {
            let l = lo.multipliedFullWidth(by: m)
            let h = hi &* m
            return U128(hi: h &+ l.high, lo: l.low)
        }
        func plus(_ v: UInt64) -> U128 {
            let (s, o) = lo.addingReportingOverflow(v)
            return U128(hi: hi &+ (o ? 1 : 0), lo: s)
        }
        func shiftedLeft(_ n: Int) -> U128 {
            if n == 0 { return self }
            if n >= 128 { return U128(0) }
            if n >= 64 { return U128(hi: lo << UInt64(n - 64), lo: 0) }
            return U128(hi: (hi << UInt64(n)) | (lo >> UInt64(64 - n)), lo: lo << UInt64(n))
        }
        func shiftedRight(_ n: Int) -> U128 {
            if n == 0 { return self }
            if n >= 128 { return U128(0) }
            if n >= 64 { return U128(hi: 0, lo: hi >> UInt64(n - 64)) }
            return U128(hi: hi >> UInt64(n), lo: (lo >> UInt64(n)) | (hi << UInt64(64 - n)))
        }
        var decimalString: String {
            if hi == 0 { return String(lo) }
            var digits: [Character] = []
            var cur = self
            while cur.hi != 0 || cur.lo != 0 {
                let (qh, rh) = cur.hi.quotientAndRemainder(dividingBy: 10)
                let (ql, rl) = UInt64(10).dividingFullWidth((high: rh, low: cur.lo))
                digits.append(Character(String(rl)))
                cur = U128(hi: qh, lo: ql)
            }
            return String(digits.reversed())
        }
    }

    // MARK: 比较（JS 关系运算的常用子集）

    /// JS 字符串 `<`：按 UTF-16 码元。
    public static func lessThan(_ a: String, _ b: String) -> Bool {
        var ia = a.utf16.makeIterator()
        var ib = b.utf16.makeIterator()
        while true {
            switch (ia.next(), ib.next()) {
            case (nil, nil): return false
            case (nil, _): return true
            case (_, nil): return false
            case (let x?, let y?): if x != y { return x < y }
            }
        }
    }

    /// 三路比较（UTF-16 码元序），给 sort 用。
    public static func compare(_ a: String, _ b: String) -> Int {
        lessThan(a, b) ? -1 : lessThan(b, a) ? 1 : 0
    }
}

/// JS 字符串判等（逐码点；Swift 的 == 是规范等价）。
@inline(__always) func jsEq(_ a: String, _ b: String) -> Bool { a.utf8.elementsEqual(b.utf8) }
@inline(__always) func jsEq(_ a: String?, _ b: String?) -> Bool {
    switch (a, b) {
    case (nil, nil): return true
    case (let x?, let y?): return x.utf8.elementsEqual(y.utf8)
    default: return false
    }
}
