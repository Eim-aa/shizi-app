import Foundation

// src/core/structure.js 的 1:1 移植：字的结构（左右 / 上下）与部件数，供参考字形的读屏名称用（R2-A1，D45；03 P232）。
// 数据只有部件分组 groups（每个部件占几笔）与笔顺中线 medians；只有恰好 2 个部件、且两块的包围盒在一个方向上基本不重叠、
// 在另一个方向上大部分重叠时才断言「左右」或「上下」；部件数只在 2–4 组时说。

public enum Structure {
    /// 两块在「分离轴」上重叠不超过较短一块的 15%，在「并排轴」上重叠至少较短一块的 60%，才算清楚的左右 / 上下。
    public static let separationMax = 0.15
    public static let shareMin = 0.6
    /// 部件数只在这个范围内报。
    public static let partsReportMin = 2
    public static let partsReportMax = 4

    struct Box { var x0: Double, x1: Double, y0: Double, y1: Double }

    static func boxOfStrokes(_ medians: [JSValue], _ from: Int, _ to: Int) -> Box? {
        var x0 = Double.infinity, x1 = -Double.infinity, y0 = Double.infinity, y1 = -Double.infinity
        var i = from
        while i < to {
            guard case .array(let line) = medians[i] else { return nil }
            for p in line {
                guard case .array(let pt) = p, pt.count >= 2, case .number(let px) = pt[0], case .number(let py) = pt[1], px.isFinite, py.isFinite else { return nil }
                if px < x0 { x0 = px }
                if px > x1 { x1 = px }
                if py < y0 { y0 = py }
                if py > y1 { y1 = py }
            }
            i += 1
        }
        return x0.isFinite ? Box(x0: x0, x1: x1, y0: y0, y1: y1) : nil
    }

    static func overlap(_ a0: Double, _ a1: Double, _ b0: Double, _ b1: Double) -> Double { Swift.max(0, Swift.min(a1, b1) - Swift.max(a0, b0)) }

    /// 分组是否有效：每组为正整数、总和等于笔画数。
    public static func validGroups(_ groups: JSValue?, _ totalStrokes: Int) -> Bool {
        guard case .array(let list)? = groups, !list.isEmpty else { return false }
        var sum = 0.0
        for n in list {
            guard case .number(let d) = n, d.isFinite, d.rounded(.towardZero) == d, d >= 1 else { return false }
            sum += d
        }
        return sum == Double(totalStrokes)
    }

    /// 两个部件的结构：'lr' | 'tb' | nil。
    public static func inferStructure(_ groups: JSValue?, _ medians: JSValue?) -> String? {
        guard case .array(let ms)? = medians, validGroups(groups, ms.count), case .array(let gs)? = groups, gs.count == 2,
              case .number(let g0) = gs[0], case .number(let g1) = gs[1] else { return nil }
        let n0 = Int(g0), n1 = Int(g1)
        guard let a = boxOfStrokes(ms, 0, n0), let b = boxOfStrokes(ms, n0, n0 + n1) else { return nil }
        func axis(_ lo: (Box) -> Double, _ hi: (Box) -> Double) -> (shorter: Double, over: Double) {
            let la = hi(a) - lo(a)
            let lb = hi(b) - lo(b)
            return (Swift.min(la, lb), overlap(lo(a), hi(a), lo(b), hi(b)))
        }
        let x = axis({ $0.x0 }, { $0.x1 })
        let y = axis({ $0.y0 }, { $0.y1 })
        // 某一轴上的「长度」可能是 0（一横一点之类）：按 1 算，免得除零
        func ratio(_ ax: (shorter: Double, over: Double)) -> Double { ax.over / (ax.shorter == 0 ? 1 : ax.shorter) }
        func clean(_ sep: (shorter: Double, over: Double), _ share: (shorter: Double, over: Double)) -> Bool {
            ratio(sep) <= separationMax && ratio(share) >= shareMin
        }
        let lr = clean(x, y)
        let tb = clean(y, x)
        if lr && !tb { return "lr" }
        if tb && !lr { return "tb" }
        return nil
    }

    /// 参考字形的结构说明：{structure: 'lr'|'tb'|null, parts: 数|null}。
    public static func describeStructure(groups: JSValue?, medians: JSValue?) -> JSValue {
        func result(_ s: String?, _ p: Int?) -> JSValue {
            .object(JSObject([("structure", s.map { .string($0) } ?? .null), ("parts", p.map { .number(Double($0)) } ?? .null)]))
        }
        guard case .array(let ms)? = medians, validGroups(groups, ms.count), case .array(let gs)? = groups else { return result(nil, nil) }
        if let s = inferStructure(groups, medians) { return result(s, nil) }
        let n = gs.count
        return n >= partsReportMin && n <= partsReportMax ? result(nil, n) : result(nil, nil)
    }
}
