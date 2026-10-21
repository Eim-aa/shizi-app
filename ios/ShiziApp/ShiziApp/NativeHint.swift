#if DEBUG
import UIKit

// 原生写字页的提示层（B2.2；D64 ①、D53 ① ⑧；01 §6.4）。
//
// 规则在页面：给哪一段、次数、整字给完记看过答案、按钮读屏名称都由写字会话 API 的 hint op 算（src/session/ops/hint.js，与网页 useHint 同一组函数）。
// 这里只有视图那一半，逐条照网页 hint-layer.js 的视图状态机（initialHintView / reduceHintView）与「写过哪笔收哪笔」的匹配（matchHintStroke）：
//   - 画法（D53 ①）：给出的那几笔用淡朱（令牌 danzhu）不透明实填，画在本人墨下面；每笔一层，同色不透明，交叠处不叠色；本人墨不变暗。
//   - 新给一段：整组淡入（hintIn 150ms；减少动态效果 150ms）；恢复现场（open 时已有 hintRange）直接静态显示。
//   - 本人每写完一笔：先按笔顺序号（第 n 笔对第 n 笔提示），对不上时按几何最近（本人笔到提示笔中线的平均距离 ≤ hintMatchMaxDist，345 单位）
//     收掉那一笔提示——只那一笔淡出（hintOut 260ms），其余留着；全部收掉后提示层消失，页面写 hintRange:null（hint op action 'range'）。
//   - 撤销 / 清空：被收掉的提示笔回来（整组重新淡入），页面把范围写回去。
// 回忆阶段答案字不进任何读屏名称（D16）：本层 isAccessibilityElement = false、不带标签。

/** 提示层视图状态（每个字一份；网页 reduceHintView 的移植）。笔序 0 起，range 不含 upperBound。 */
struct NativeHintView: Equatable {
    struct Absorbed: Equatable {
        let user: Int
        let hint: Int
    }

    var used: Int
    var range: Range<Int>?
    var absorbed: [Absorbed] = []
    var fading: [Int] = []
    /// 每次需要整组重新淡入时 +1（新给一段 / 撤销让提示笔回来）。
    var run = 0
    /// 恢复现场出来的提示：静态显示，不淡入。
    var restored = false

    /// initialHintView：会话现场 {hints, hintRange} + 已写笔数 → 按笔顺序号推出哪些提示笔已被收掉。
    init(used: Int, range: Range<Int>?, written: Int) {
        self.used = max(0, used)
        self.range = range
        if let r = range {
            for u in r.lowerBound..<max(r.lowerBound, min(r.upperBound, written)) { absorbed.append(Absorbed(user: u, hint: u)) }
        }
        restored = range != nil
    }

    /// 还没被本人笔收掉的提示笔（升序）。
    var remaining: [Int] {
        guard let r = range else { return [] }
        let gone = Set(absorbed.map(\.hint))
        return r.filter { !gone.contains($0) }
    }

    /// 此刻有没有东西可看。
    var visible: Bool { !remaining.isEmpty || !fading.isEmpty }

    /// 'hint'：新给的一段 seg（并入后的范围 merged 由页面算好）。紧接着现有范围 → 已收掉的保留；否则重来。新一段里已写过的笔直接算收掉。
    mutating func give(segment seg: Range<Int>, merged: Range<Int>, used newUsed: Int, written: Int) {
        let keep = range.map { $0.upperBound <= seg.lowerBound } ?? false
        var abs = keep ? absorbed : []
        for u in seg.lowerBound..<max(seg.lowerBound, min(seg.upperBound, written)) where !abs.contains(where: { $0.hint == u }) {
            abs.append(Absorbed(user: u, hint: u))
        }
        absorbed = abs
        if !keep { fading = [] }
        range = merged
        used = max(used, newUsed)
        run += 1
        restored = false
    }

    /// 'absorb'：本人第 user 笔收掉提示笔 hint（只那一笔淡出）。不在剩余里的不收。
    @discardableResult
    mutating func absorb(user: Int, hint: Int) -> Bool {
        guard range != nil, remaining.contains(hint) else { return false }
        absorbed.append(Absorbed(user: user, hint: hint))
        fading.append(hint)
        return true
    }

    /// 'faded'：那一笔淡完。
    mutating func faded(_ hint: Int) {
        fading.removeAll { $0 == hint }
    }

    /// 'restore'：笔数退到 fromUser——这些笔收掉的提示笔回来（整组重新淡入）。
    @discardableResult
    mutating func restore(fromUser: Int) -> Bool {
        let back = absorbed.filter { $0.user >= fromUser }
        guard !back.isEmpty else { return false }
        let gone = Set(back.map(\.hint))
        absorbed.removeAll { $0.user >= fromUser }
        fading.removeAll { gone.contains($0) }
        run += 1
        restored = false
        return true
    }
}

/** 写过哪笔收哪笔的匹配（网页 meanDistanceToMedian / matchHintStroke 的移植）。 */
enum NativeHintMatch {
    private static func distToSegment(_ px: Double, _ py: Double, _ a: CGPoint, _ b: CGPoint) -> Double {
        let ax = Double(a.x), ay = Double(a.y), dx = Double(b.x) - ax, dy = Double(b.y) - ay
        let len2 = dx * dx + dy * dy
        let t = len2 > 0 ? max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
        return hypot(px - (ax + t * dx), py - (ay + t * dy))
    }

    /// 本人一笔（原始采样，345 单位）到一条中线（同单位折线）的平均距离（每 ⌊n/24⌋ 个点取一个）。
    static func meanDistance(_ points: [InkRawPoint], _ median: [CGPoint]) -> Double {
        guard !points.isEmpty, !median.isEmpty else { return .infinity }
        let step = max(1, points.count / 24)
        var sum = 0.0, n = 0
        var i = 0
        while i < points.count {
            let p = points[i]
            var best = Double.infinity
            if median.count == 1 { best = hypot(p.x - Double(median[0].x), p.y - Double(median[0].y)) }
            if median.count > 1 {
                for j in 0..<(median.count - 1) { best = min(best, distToSegment(p.x, p.y, median[j], median[j + 1])) }
            }
            sum += best
            n += 1
            i += step
        }
        return n > 0 ? sum / Double(n) : .infinity
    }

    /// 本人第 index 笔对应哪一笔提示：index 本身还在剩余里就是它；否则剩余里中线最近的一笔，平均距离 ≤ maxDist 才算。
    static func match(remaining: [Int], index: Int, points: [InkRawPoint]?, medians: [[CGPoint]]?, maxDist: Double) -> Int? {
        guard !remaining.isEmpty else { return nil }
        if remaining.contains(index) { return index }
        guard let points, !points.isEmpty, let medians else { return nil }
        var best: Int?
        var bestD = Double.infinity
        for h in remaining where h < medians.count {
            let d = meanDistance(points, medians[h])
            if d < bestD {
                bestD = d
                best = h
            }
        }
        return best != nil && bestD <= maxDist ? best : nil
    }

    /// 字形中线（1024 单位、已翻成 y 向下）→ 书写格 345 单位（与 glyph.js mediansInBox({size:345}) 同一仿射）。
    static func medians345(_ glyph: NativeGlyphData, padRatio: CGFloat) -> [[CGPoint]] {
        let t = NativeGlyphData.transform(size: 345, padRatio: padRatio)
        return glyph.medians.map { $0.map { $0.applying(t) } }
    }
}

/// 提示层视图：书写格里、本人墨下面。每笔一层 CAShapeLayer（淡朱不透明实填）。
final class NativeHintLayerView: UIView {
    var color: UIColor = .systemRed { didSet { shapes.forEach { $0.fillColor = color.cgColor } } }
    var padRatio: CGFloat = 0.06
    private(set) var glyph: NativeGlyphData?
    private let group = UIView()
    private var shapes: [CAShapeLayer] = []
    private var shown: Set<Int> = []

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        isAccessibilityElement = false
        accessibilityElementsHidden = true
        backgroundColor = .clear
        addSubview(group)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// 换字：新字的字形（没有数据时 nil，层空着）。
    func setGlyph(_ g: NativeGlyphData?) {
        glyph = g
        shapes.forEach { $0.removeFromSuperlayer() }
        shapes = (g?.strokes ?? []).map { _ in
            let s = CAShapeLayer()
            s.fillColor = color.cgColor
            s.strokeColor = nil
            s.isHidden = true
            return s
        }
        shapes.forEach { group.layer.addSublayer($0) }
        shown = []
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        group.frame = bounds
        guard let g = glyph else { return }
        let side = min(bounds.width, bounds.height)
        guard side > 0 else { return }
        var t = NativeGlyphData.transform(size: side, padRatio: padRatio)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for (i, s) in shapes.enumerated() where i < g.strokes.count {
            s.frame = group.bounds
            s.path = g.strokes[i].copy(using: &t)
        }
        CATransaction.commit()
    }

    /// 按视图状态显示：remaining ∪ fading 可见；fadeIn = 整组从 0 淡入的时长（0 = 不淡入）。
    func render(_ view: NativeHintView?, visible: Bool, fadeInMs: Double) {
        let next: Set<Int> = visible ? Set((view?.remaining ?? []) + (view?.fading ?? [])) : []
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for (i, s) in shapes.enumerated() {
            let on = next.contains(i)
            s.isHidden = !on
            // 正在淡出的那一笔由 fadeOut 管；其余回到不透明
            if on, !(view?.fading.contains(i) ?? false) {
                s.removeAnimation(forKey: "out")
                s.opacity = 1
            }
        }
        CATransaction.commit()
        shown = next
        if fadeInMs > 0, !next.isEmpty {
            group.layer.removeAnimation(forKey: "in")
            let a = CABasicAnimation(keyPath: "opacity")
            a.fromValue = 0
            a.toValue = 1
            a.duration = fadeInMs / 1000
            a.timingFunction = CAMediaTimingFunction(name: .linear)
            group.layer.add(a, forKey: "in")
        }
    }

    /// 只那一笔淡出（hintOut 260ms，线性）。完了由调用方 faded → render 隐藏。
    func fadeOut(_ i: Int, ms: Double) {
        guard i < shapes.count else { return }
        let s = shapes[i]
        let a = CABasicAnimation(keyPath: "opacity")
        a.fromValue = 1
        a.toValue = 0
        a.duration = ms / 1000
        a.timingFunction = CAMediaTimingFunction(name: .linear)
        a.fillMode = .forwards
        a.isRemovedOnCompletion = false
        s.add(a, forKey: "out")
    }

    /// 动画一帧到终态（落笔 / 换字时；T0 规则 3）。
    func settle() {
        group.layer.removeAnimation(forKey: "in")
    }

    /// 测试与诊断：此刻画出的提示笔。
    var shownStrokes: [Int] { shown.sorted() }
}
#endif
