import XCTest
#if canImport(JavaScriptCore)
import JavaScriptCore
#endif
@testable import ShiziCore

// B4.7 影子比对（App 内 WebEngine ⇄ SwiftEngine）抓到：「我的」页月字帖的墨宽在最后一位不同（11.155472390498883 对 …884）。
// 设备上的 JS 是 JavaScriptCore：Math.exp 走 Darwin libm，Math.hypot 是 JSC 的 C++（arm64 上 clang 把 a*b−c 合成 fmsub）——都不是 V8。
// App 里的 SessionRuntime 用 .darwin 口径，所以 JSMath 的 exp / hypot 也要跟 JSC 逐位一致。这里直接拿 macOS 的 JavaScriptCore（与 iOS 同一份源码、
// 同为 arm64）在随机输入上逐位对照；.v8 口径（命令行 / 差分 / 金标准）不变。
final class JSCMathTests: XCTestCase {
    override func tearDown() { JSMath.flavor = .v8 }

    #if canImport(JavaScriptCore)
    func jsc(_ fn: String, _ args: [[Double]]) -> [Double] {
        let ctx = JSContext()!
        ctx.setObject(args, forKeyedSubscript: "INPUT" as NSString)
        let out = ctx.evaluateScript("INPUT.map(a => \(fn)(...a))")!
        return (out.toArray() as? [NSNumber] ?? []).map(\.doubleValue)
    }

    func samples(_ n: Int, seed: UInt64, _ make: (inout SplitMix) -> [Double]) -> [[Double]] {
        var g = SplitMix(seed); return (0..<n).map { _ in make(&g) }
    }

    func testDarwinExpMatchesJavaScriptCore() {
        let inputs = samples(20000, seed: 7) { g in [g.unit() * 40 - 20] } + samples(5000, seed: 8) { g in [-g.unit() * 3] }
        let ref = jsc("Math.exp", inputs)
        JSMath.flavor = .darwin
        var bad = 0
        for (i, a) in inputs.enumerated() where JSMath.exp(a[0]).bitPattern != ref[i].bitPattern { bad += 1 }
        XCTAssertEqual(bad, 0, "exp differs from JSC on \(bad) inputs")
    }

    func testDarwinHypotMatchesJavaScriptCore() {
        let inputs = samples(30000, seed: 9) { g in [g.unit() * 200 - 100, g.unit() * 200 - 100] } + samples(10000, seed: 10) { g in [g.unit() * 3, g.unit() * 0.001] }
        let ref = jsc("Math.hypot", inputs)
        JSMath.flavor = .darwin
        var bad = 0
        for (i, a) in inputs.enumerated() where JSMath.hypot(a[0], a[1]).bitPattern != ref[i].bitPattern { bad += 1 }
        XCTAssertEqual(bad, 0, "hypot differs from JSC on \(bad) inputs")
    }
    #endif
}

struct SplitMix {
    var state: UInt64
    init(_ seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
    mutating func unit() -> Double { Double(next() >> 11) / Double(1 << 53) }
}
