#if DEBUG
import UIKit

// 原生写字页的描一遍：描红层与笔顺快放（B2.4；确认单 4；D64 ②、D68 ②；D53 ①）。
//
// 规则在页面：进描一遍 / 凭记忆写 / 下一个 / 看答案由写字会话 API 的 showAnswer / answerPhase / answerNext 提交（src/session/ops/answer.js，与网页同一批函数）。
// 这里只有视图那一半，逐条照网页 write/answer.js 与 canvas/glyph-wash.js、canvas/glyph.js：
//   - 画法（D53 ①）：当前一笔 = 本阶段已写笔数，用 --danzhu 不透明实填；其余还没轮到的笔是同色相的双钩（0.75pt 细轮廓，增强对比度 1.5pt，不填色）；
//     已描过的笔被本人墨盖住、不再画；全部写完什么都不画；没有灰外廓、没有整层不透明度；没有笔顺数据时用浅色（danzhu）整字（10.13）。
//   - 笔顺快放：每字第一次进描一遍时播（会话 id + 字，只记在本次运行里）；总时长 ≤ 1.6s（policy.motion.stepPlayMaxMs），节奏取 glyph.js playbackPlan 的同一组公式
//     （NativeTrace.plan 是它的移植，XCTest 对照 node 输出）；落笔 / 点一下即到终态；减少动态效果不播。快放的笔画用 --ref 色，播完收起，只剩描红。
// 文案与参数全部来自页面（open 回包的 copy / trace），本文件不写用户可见的字。

enum NativeTrace {
    struct Plan: Equatable {
        let speed: Double
        let delay: Double
        let fade: Double
        let estimatedMs: Double
    }

    /// 一笔中线的折线长度（数据单位；hanzi-writer Stroke.getLength 同口径，glyph.js medianLength）。
    static func medianLength(_ pts: [CGPoint]) -> Double {
        var sum = 0.0
        for i in 1..<max(1, pts.count) { sum += hypot(Double(pts[i].x - pts[i - 1].x), Double(pts[i].y - pts[i - 1].y)) }
        return sum
    }

    /// 笔顺快放的节奏（glyph.js playbackPlan 的移植；D34 / I2-02：总时长 ≤ maxMs）。
    /// hanzi-writer 的总时长 = 起始淡化 fade + Σ (长度_i + 600) ÷ (3 × speed) + 笔间隔 × (n − 1)。
    static func plan(medians: [[CGPoint]], strokeCount: Int, maxMs: Double, speed: Double, delay: Double, fade: Double) -> Plan {
        let n = Double(max(1, medians.count > 0 ? medians.count : (strokeCount > 0 ? strokeCount : 1)))
        let sumLen = medians.isEmpty ? n * 300 : medians.reduce(0.0) { $0 + ($1.count > 1 ? medianLength($1) : 0) }
        let work = sumLen + 600 * n
        func estimate(_ s: Double, _ g: Double, _ f: Double) -> Double { f + work / (3 * s) + g * (n - 1) }
        guard maxMs.isFinite, maxMs > 0 else { return Plan(speed: speed, delay: delay, fade: fade, estimatedMs: estimate(speed, delay, fade).rounded()) }
        let f = min(fade, 100)
        let g = n > 1 ? min(delay, floor(maxMs * 0.15 / (n - 1))) : 0
        let room = max(maxMs * 0.4, maxMs - f - g * (n - 1))
        let s = max(speed, work / (3 * room * 0.9))
        let sp = (s * 1000).rounded() / 1000
        return Plan(speed: sp, delay: g, fade: f, estimatedMs: estimate(sp, g, f).rounded())
    }

    /// 每一笔快放的时长（ms）：(长度 + 600) ÷ (3 × speed)，与 plan 的总时长同一公式。
    static func strokeDurations(medians: [[CGPoint]], strokeCount: Int, speed: Double) -> [Double] {
        let n = max(1, strokeCount)
        return (0..<n).map { i in
            let len = i < medians.count && medians[i].count > 1 ? medianLength(medians[i]) : 300
            return (len + 600) / (3 * speed)
        }
    }

    /// traceSplit（answer.js）：当前一笔实心、其余还没轮到的笔是双钩；已描过的不画；写完什么都不画。
    static func split(total: Int, written: Int) -> (solid: [Int], hook: [Int]) {
        let n = max(0, total), w = max(0, written)
        if w >= n { return ([], []) }
        return ([w], Array((w + 1)..<max(w + 1, n)))
    }
}

/// 描红层：书写格里、本人墨下面。每笔一层 CAShapeLayer（实填 / 双钩 / 不画）。
final class NativeTraceLayerView: UIView {
    var color: UIColor = .systemRed { didSet { restyle() } }
    /// 快放的笔画色（--ref）。
    var refColor: UIColor = .label
    var padRatio: CGFloat = 0.06
    /// 双钩线宽（pt）：页面给（trace.hookWidthPt / hookWidthMoreContrastPt）。
    var hookWidthPt: CGFloat = 0.75 { didSet { restyle() } }
    var hookWidthMoreContrastPt: CGFloat = 1.5 { didSet { restyle() } }
    private(set) var glyph: NativeGlyphData?
    private(set) var written = 0
    private(set) var isShown = false
    private let fallback = UILabel()
    private let playHost = UIView()
    private var shapes: [CAShapeLayer] = []
    private(set) var playing = false
    private var playToken = 0
    private var playCompletion: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        isAccessibilityElement = false
        accessibilityElementsHidden = true
        backgroundColor = .clear
        fallback.textAlignment = .center
        fallback.isHidden = true
        addSubview(fallback)
        playHost.isUserInteractionEnabled = false
        addSubview(playHost)
        isHidden = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// 换字：新字的字形（没有数据时 nil：用整字退回，10.13）。
    func setGlyph(_ g: NativeGlyphData?, char: String) {
        skipPlay()
        glyph = g
        shapes.forEach { $0.removeFromSuperlayer() }
        shapes = (g?.strokes ?? []).map { _ in
            let s = CAShapeLayer()
            s.isHidden = true
            return s
        }
        shapes.forEach { layer.insertSublayer($0, below: playHost.layer) }
        fallback.text = g == nil ? char : nil
        setNeedsLayout()
        restyle()
    }

    /// 本阶段已写笔数（当前一笔 = 它）；撤销 / 清空后退回。
    func setWritten(_ n: Int) {
        guard n != written else { return }
        written = n
        restyle()
    }

    func render(visible: Bool) {
        isShown = visible
        isHidden = !visible
        if !visible { skipPlay() }
        restyle()
    }

    /// 此刻画成实填的笔 / 双钩的笔（测试与诊断）。
    var solidStrokes: [Int] { isShown ? (glyph == nil ? [] : NativeTrace.split(total: shapes.count, written: written).solid) : [] }
    var hookStrokes: [Int] { isShown ? (glyph == nil ? [] : NativeTrace.split(total: shapes.count, written: written).hook) : [] }
    var showsFallbackChar: Bool { isShown && glyph == nil && !(fallback.text ?? "").isEmpty }

    private var hookWidth: CGFloat {
        UIAccessibility.isDarkerSystemColorsEnabled ? hookWidthMoreContrastPt : hookWidthPt
    }

    private func restyle() {
        let sp = NativeTrace.split(total: shapes.count, written: written)
        let solid = Set(sp.solid), hook = Set(sp.hook)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for (i, s) in shapes.enumerated() {
            if !isShown { s.isHidden = true; continue }
            if solid.contains(i) {
                s.isHidden = false
                s.fillColor = color.cgColor
                s.strokeColor = nil
                s.zPosition = 1 // 实填后画（同一色相，盖住与之交叠的钩线）
            } else if hook.contains(i) {
                s.isHidden = false
                s.fillColor = nil
                s.strokeColor = color.cgColor
                s.lineWidth = hookWidth
                s.lineJoin = .round
                s.zPosition = 0
            } else {
                s.isHidden = true
            }
        }
        fallback.textColor = color
        fallback.isHidden = !showsFallbackChar
        CATransaction.commit()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        playHost.frame = bounds
        let side = min(bounds.width, bounds.height)
        guard side > 0 else { return }
        if let g = glyph {
            var t = NativeGlyphData.transform(size: side, padRatio: padRatio)
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            for (i, s) in shapes.enumerated() where i < g.strokes.count {
                s.frame = bounds
                s.path = g.strokes[i].copy(using: &t)
            }
            CATransaction.commit()
        }
        // 10.13：整字，字号 = 格边长 × 0.78，基线在中心下方 3%（glyph-fallback.js）
        fallback.font = UIFont.systemFont(ofSize: side * 0.78)
        fallback.frame = CGRect(x: 0, y: side * 0.03, width: bounds.width, height: bounds.height)
    }

    // MARK: 笔顺快放

    /// 播一遍笔顺（preview：播完或跳过后把播的笔画收起，只剩描红）。没有笔顺数据 / 已在播 / 尺寸还没定时不播并返回 false。
    @discardableResult
    func play(plan: NativeTrace.Plan, completion: (() -> Void)? = nil) -> Bool {
        guard let g = glyph, !playing, bounds.width > 0, !g.strokes.isEmpty else { return false }
        playing = true
        playToken += 1
        let token = playToken
        playCompletion = completion
        let side = min(bounds.width, bounds.height)
        var t = NativeGlyphData.transform(size: side, padRatio: padRatio)
        let k = side * (1 - 2 * padRatio) / NativeGlyphData.units
        let durs = NativeTrace.strokeDurations(medians: g.medians, strokeCount: g.strokes.count, speed: plan.speed)
        var start = 0.0
        let layersToRemove = playHost.layer
        playHost.alpha = 1
        for (i, path) in g.strokes.enumerated() {
            let fill = CAShapeLayer()
            fill.frame = bounds
            fill.path = path.copy(using: &t)
            fill.fillColor = refColor.cgColor
            // 遮罩：沿中线的粗线，strokeEnd 0 → 1 把这一笔「写出来」（hanzi-writer 同一思路；线宽盖住笔画最粗处）
            let mask = CAShapeLayer()
            mask.frame = bounds
            let line = UIBezierPath()
            let m = i < g.medians.count ? g.medians[i] : []
            if let first = m.first {
                line.move(to: first.applying(t))
                for p in m.dropFirst() { line.addLine(to: p.applying(t)) }
                if m.count == 1 { line.addLine(to: CGPoint(x: first.applying(t).x + 0.01, y: first.applying(t).y)) }
            }
            mask.path = line.cgPath
            mask.strokeColor = UIColor.black.cgColor
            mask.fillColor = nil
            mask.lineWidth = 220 * k
            mask.lineCap = .round
            mask.lineJoin = .round
            mask.strokeEnd = 0
            fill.mask = mask
            layersToRemove.addSublayer(fill)
            let begin = CACurrentMediaTime() + start / 1000
            let sweep = CABasicAnimation(keyPath: "strokeEnd")
            sweep.fromValue = 0
            sweep.toValue = 1
            sweep.beginTime = begin
            sweep.duration = durs[i] / 1000
            sweep.fillMode = .forwards
            sweep.isRemovedOnCompletion = false
            sweep.timingFunction = CAMediaTimingFunction(name: .linear)
            mask.add(sweep, forKey: "sweep")
            start += durs[i] + plan.delay
        }
        let total = max(0, start - plan.delay) / 1000
        DispatchQueue.main.asyncAfter(deadline: .now() + total) { [weak self] in
            guard let self, self.playing, self.playToken == token else { return }
            self.finishPlay(fadeMs: plan.fade)
        }
        return true
    }

    /// 播完：整体淡出（plan.fade）后收起，只剩描红。
    private func finishPlay(fadeMs: Double) {
        let token = playToken
        UIView.animate(withDuration: max(0.01, fadeMs / 1000), delay: 0, options: [.curveLinear, .allowUserInteraction]) {
            self.playHost.alpha = 0
        } completion: { [weak self] _ in
            guard let self, self.playToken == token else { return }
            self.endPlay()
        }
    }

    /// 落笔 / 点一下：直接到终态（收起播放的笔画）。
    func skipPlay() {
        guard playing else { return }
        playToken += 1
        endPlay()
    }

    private func endPlay() {
        playing = false
        playHost.layer.sublayers?.forEach { $0.removeFromSuperlayer() }
        playHost.layer.removeAllAnimations()
        playHost.alpha = 1
        let done = playCompletion
        playCompletion = nil
        done?()
    }
}
#endif
