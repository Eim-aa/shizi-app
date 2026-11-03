import Foundation

// V8 的 Math.hypot / Math.exp / Math.round / Math.max / Math.min 的逐位复刻（B4.3）。
// 为什么不用 libm：
//   · Math.hypot：V8 不调 libm hypot，而是先按最大值缩放、再对平方和做 Kahan 求和（builtins/math.tq MathHypot）；libm 的 hypot 在个别输入上差 1 ulp；
//   · Math.exp：V8 用 fdlibm 的 ieee754::exp（含 exp(1) 返回 E 的特例），与 Darwin libm 的 exp 在个别输入上差 1 ulp；
//   笔迹的宽度（decodeInk v4 → buildStroke）对这两个函数的每一位都敏感，落盘 / 差分都按字节比，所以用同一算法。
// 注意（arm64）：V8 的 C++ 部分（ieee754::exp）由 clang 编译，默认允许把 a*b+c 合成 fma（-ffp-contract=on），所以 arm64 上的 Math.exp 与逐步舍入的写法在个别输入上差 1 ulp；
// 这里在 clang 会合成 fma 的位置用 addingProduct 复刻（x86-64 的 Node 没有这个合成，结果可能与此不同——参考值取自开发用的 arm64 Mac，同 CI 平台）。
// Math.sqrt 是 IEEE 正确舍入，Swift 的 squareRoot() 相同；Math.log1p 只用于 quantizeDt 的最近档比较（档位是离散的、无近似平局），用 Foundation 的 log1p。

public enum JSMath {
    /// Math.hypot(a, b)：.v8 = V8 MathHypot（Kahan 求和）；.darwin = 设备上的 JavaScriptCore（见 jscHypot）。
    public static func hypot(_ a: Double, _ b: Double) -> Double {
        if flavor == .darwin { return jscHypot(a, b) }
        return v8Hypot(a, b)
    }

    /// JavaScriptCore 的 Math.hypot（B4.7 影子比对抓到；JSCMathTests 拿 macOS 的 JavaScriptCore 逐位核对）。
    static func jscHypot(_ a: Double, _ b: Double) -> Double {
        Foundation.hypot(a, b)
    }

    static func v8Hypot(_ a: Double, _ b: Double) -> Double {
        let abs0 = a.magnitude, abs1 = b.magnitude
        var oneIsNaN = false
        var maxV = 0.0
        for v in [a, b] {
            if v.isNaN { oneIsNaN = true } else if v.magnitude > maxV { maxV = v.magnitude }
        }
        if maxV == .infinity { return .infinity }
        if oneIsNaN { return .nan }
        if maxV == 0 { return 0 }
        var sum = 0.0
        var compensation = 0.0
        for av in [abs0, abs1] {
            let n = av / maxV
            let summand = n * n - compensation
            let preliminary = sum + summand
            compensation = (preliminary - sum) - summand
            sum = preliminary
        }
        return sum.squareRoot() * maxV
    }

    /// Math.max(a, b)：任一为 NaN 得 NaN；+0 大于 -0。
    public static func max(_ a: Double, _ b: Double) -> Double {
        if a.isNaN || b.isNaN { return .nan }
        if a == 0 && b == 0 { return a.sign == .minus ? b : a }
        return a > b ? a : b
    }

    /// Math.min(a, b)：任一为 NaN 得 NaN；-0 小于 +0。
    public static func min(_ a: Double, _ b: Double) -> Double {
        if a.isNaN || b.isNaN { return .nan }
        if a == 0 && b == 0 { return a.sign == .minus ? a : b }
        return a < b ? a : b
    }

    /// Math.round（.5 向 +∞；-0.5 ≤ x < 0 得 -0）。
    public static func round(_ x: Double) -> Double {
        if !x.isFinite { return x }
        let f = x.rounded(.down)
        let r = x - f >= 0.5 ? f + 1 : f
        return r == 0 && (x < 0 || x.sign == .minus) ? -0.0 : r
    }

    /// Math.exp(x)：.v8 = V8 base::ieee754::exp；.darwin = 设备上的 JavaScriptCore（std::exp = Darwin libm）。
    public static func exp(_ x0: Double) -> Double { flavor == .darwin ? Foundation.exp(x0) : fdlibmExp(x0) }

    /// V8 base::ieee754::exp（FreeBSD msun e_exp.c，含 exp(1) = E 的特例）。
    static func fdlibmExp(_ x0: Double) -> Double {
        var x = x0
        let one = 1.0
        let huge = 1.0e300
        let twom1000 = 9.33263618503218878990e-302 // 2**-1000
        let oThreshold = 7.09782712893383973096e+02
        let uThreshold = -7.45133219101941108420e+02
        let ln2HI = [6.93147180369123816490e-01, -6.93147180369123816490e-01]
        let ln2LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10]
        let invln2 = 1.44269504088896338700e+00
        let halF = [0.5, -0.5]
        let P1 = 1.66666666666666019037e-01
        let P2 = -2.77777777770155933842e-03
        let P3 = 6.61375632143793436117e-05
        let P4 = -1.65339022054652515390e-06
        let P5 = 4.13813679705723846039e-08
        let E = 2.718281828459045

        var hi = 0.0, lo = 0.0
        var k = 0
        var hx = UInt32(truncatingIfNeeded: x.bitPattern >> 32)
        let xsb = Int((hx >> 31) & 1)
        hx &= 0x7fffffff

        if hx >= 0x40862E42 { // |x| >= 709.78...
            if hx >= 0x7ff00000 {
                let lx = UInt32(truncatingIfNeeded: x.bitPattern)
                if ((hx & 0xfffff) | lx) != 0 { return x + x } // NaN
                return xsb == 0 ? x : 0.0 // exp(+-inf) = {inf, 0}
            }
            if x > oThreshold { return Double.infinity } // overflow
            if x < uThreshold { return 0.0 } // underflow (twom1000 * twom1000)
        }

        if hx > 0x3fd62e42 { // |x| > 0.5 ln2
            if hx < 0x3FF0A2B2 { // and |x| < 1.5 ln2
                if x == 1.0 { return E }
                hi = x - ln2HI[xsb]
                lo = ln2LO[xsb]
                k = 1 - xsb - xsb
            } else {
                k = Int(halF[xsb].addingProduct(invln2, x).rounded(.towardZero))
                let t = Double(k)
                hi = x.addingProduct(-t, ln2HI[0]) // t*ln2HI is exact here
                lo = t * ln2LO[0]
            }
            x = hi - lo
        } else if hx < 0x3e300000 { // |x| < 2**-28
            if huge + x > one { return one + x }
        } else {
            k = 0
        }

        let t = x * x
        func twoPow(_ e: Int) -> Double { Double(bitPattern: UInt64(UInt32(truncatingIfNeeded: 0x3FF00000 + (e << 20))) << 32) }
        let twopk = k >= -1021 ? twoPow(k) : twoPow(k + 1000)
        let poly = P1.addingProduct(t, P2.addingProduct(t, P3.addingProduct(t, P4.addingProduct(t, P5))))
        let c = x.addingProduct(-t, poly)
        if k == 0 { return one - ((x * c) / (c - 2.0) - x) }
        let y = one - ((lo - (x * c) / (2.0 - c)) - hi)
        if k >= -1021 {
            if k == 1024 { return y * 2.0 * Double(sign: .plus, exponent: 1023, significand: 1) }
            return y * twopk
        }
        return y * twopk * twom1000
    }
}
