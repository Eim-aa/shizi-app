import UIKit

// 原生写字页与页面之间的数据格式工具（B2.2；Release 组件）。原在 DEBUG spike NativeInkSpike 里（parseColor / rawStrokes），
// 原生写字页不该依赖 spike：挪到这里，spike 与写字页都调用它。格式与 src/session/write-api.js 一致：
//   笔画：每笔 [[x, y, t, p?]…]（345 单位，t 毫秒，p 只在 Pencil 且 > 0）；
//   颜色：页面令牌的计算值（"#RRGGBB" / "#RGB" / "rgb(r, g, b)" / "rgba(…)"）。

enum NativeInkWire {
    /// 桥上的紧凑数组 → 原始点（坏点丢掉；p ≤ 0 不写）。
    static func rawStrokes(_ any: Any?) -> [[InkRawPoint]] {
        ((any as? [[[NSNumber]]]) ?? []).map { stroke in
            stroke.compactMap { r in
                guard r.count >= 3 else { return nil }
                var q = InkRawPoint(x: r[0].doubleValue, y: r[1].doubleValue, t: r[2].doubleValue)
                if r.count > 3, r[3].doubleValue > 0 { q.p = r[3].doubleValue }
                return q
            }
        }
    }

    /// 原始点 → 桥上的紧凑数组（strokesFromWire 的逆）。
    static func wire(_ strokes: [[InkRawPoint]]) -> [[[Double]]] {
        strokes.map { stroke in stroke.map { q in q.p.map { [q.x, q.y, q.t, $0] } ?? [q.x, q.y, q.t] } }
    }

    /// "#RRGGBB" / "#RGB" / "rgb(r, g, b)" / "rgba(…)" → 0–1。
    static func parseColor(_ s: String?) -> SIMD4<Float>? {
        guard let s = s?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
        if s.hasPrefix("#") {
            var hex = String(s.dropFirst())
            if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
            guard hex.count >= 6, let n = UInt32(hex.prefix(6), radix: 16) else { return nil }
            return SIMD4(Float((n >> 16) & 0xFF) / 255, Float((n >> 8) & 0xFF) / 255, Float(n & 0xFF) / 255, 1)
        }
        if let open = s.firstIndex(of: "("), let close = s.lastIndex(of: ")") {
            let parts = s[s.index(after: open)..<close].split(whereSeparator: { $0 == "," || $0 == " " || $0 == "/" }).compactMap { Float($0) }
            guard parts.count >= 3 else { return nil }
            return SIMD4(parts[0] / 255, parts[1] / 255, parts[2] / 255, parts.count > 3 ? parts[3] : 1)
        }
        return nil
    }

    /// 页面 box-shadow 令牌（"0px 4px 16px rgba(…)"，单层）→ 偏移 / 模糊 / 颜色。CSS 的 blur 是高斯 2σ，CALayer.shadowRadius 取 blur / 2。
    static func shadow(_ s: String?) -> (dx: CGFloat, dy: CGFloat, blur: CGFloat, color: UIColor)? {
        guard let s = s?.trimmingCharacters(in: .whitespaces), !s.isEmpty, s != "none",
              let open = s.firstIndex(of: "(") ?? s.firstIndex(of: "#") else { return nil }
        let start = s[..<open].range(of: "rgb", options: .backwards)?.lowerBound ?? open
        let nums = s[..<start].split(separator: " ").compactMap { Double($0.replacingOccurrences(of: "px", with: "")) }
        guard nums.count >= 3, let c = uiColor(String(s[start...])) else { return nil }
        return (CGFloat(nums[0]), CGFloat(nums[1]), CGFloat(nums[2]), c)
    }

    /// 页面令牌颜色 → UIColor。
    static func uiColor(_ s: String?) -> UIColor? {
        guard let c = parseColor(s) else { return nil }
        return UIColor(red: CGFloat(c.x), green: CGFloat(c.y), blue: CGFloat(c.z), alpha: CGFloat(c.w))
    }
}
