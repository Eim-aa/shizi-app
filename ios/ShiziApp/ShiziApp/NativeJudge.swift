#if DEBUG
import UIKit

// 原生判断页的两块独立部件（B2.5；docs/engineering/v10/B2-原生写字架构.md §11、§14）：
//   1. NativeSettle：判断落定（时刻编排 ② M23）——本人笔迹离纸、收进页头计数；时刻与曲线全部取自 open 回包的 motion.settle / easeOut（src/config/motion.js），
//      本文件不写死任何时长；
//   2. NativeChangeSheetViewController：改判弹层（D19 / D66 ④；网页 result-row.js ChangeSheet 的原生版）——标题、两张小卡、说明、主按钮、失败三段式。
// 文案全部来自页面（open 回包的 copy 字典），本文件不写任何用户可见的字。

// MARK: 时刻参数

/// open 回包 motion.settle（+ easeOut）：M23 判断落定。缺任何一项就不做落定动画（原生不自带默认值，时刻只有页面一个来源）。
struct NativeSettleSpec {
    let lift: Double
    let fadeFrom: Double
    let end: Double
    let countBox: CGFloat
    let liftScale: Double
    let gather: [Double]
    let easeOut: [Double]
    let reduceMs: Double

    init?(motion: [String: Any]) {
        guard let s = motion["settle"] as? [String: Any],
              let lift = (s["lift"] as? NSNumber)?.doubleValue, let fadeFrom = (s["fadeFrom"] as? NSNumber)?.doubleValue,
              let end = (s["end"] as? NSNumber)?.doubleValue, let box = (s["countBox"] as? NSNumber)?.doubleValue,
              let scale = (s["liftScale"] as? NSNumber)?.doubleValue,
              let gather = (s["gather"] as? [NSNumber])?.map({ $0.doubleValue }), gather.count == 4,
              let ease = (motion["easeOut"] as? [NSNumber])?.map({ $0.doubleValue }), ease.count == 4,
              let reduce = (motion["reduce"] as? NSNumber)?.doubleValue else { return nil }
        self.lift = lift
        self.fadeFrom = fadeFrom
        self.end = end
        self.countBox = CGFloat(box)
        self.liftScale = scale
        self.gather = gather
        self.easeOut = ease
        self.reduceMs = reduce
    }
}

enum NativeBezier {
    /// cubic-bezier(x1, y1, x2, y2) 在时间 x（0–1）处的值（二分求参数）。
    static func value(_ x: Double, _ p: [Double]) -> Double {
        guard p.count == 4 else { return x }
        let x = min(1, max(0, x))
        var lo = 0.0, hi = 1.0, u = x
        for _ in 0..<24 {
            u = (lo + hi) / 2
            let bx = 3 * (1 - u) * (1 - u) * u * p[0] + 3 * (1 - u) * u * u * p[2] + u * u * u
            if bx < x { lo = u } else { hi = u }
        }
        return 3 * (1 - u) * (1 - u) * u * p[1] + 3 * (1 - u) * u * u * p[3] + u * u * u
    }

    static func timing(_ p: [Double]?) -> UITimingCurveProvider {
        guard let p, p.count == 4 else { return UICubicTimingParameters(animationCurve: .easeOut) }
        return UICubicTimingParameters(controlPoint1: CGPoint(x: p[0], y: p[1]), controlPoint2: CGPoint(x: p[2], y: p[3]))
    }
}

// MARK: 判断落定（M23）

enum NativeSettle {
    private static var sharedRenderer: NativeInkRenderer?

    /// 本人笔迹：t = 0 离纸（liftScale，lift ms，ease.out），之后收进计数方框（gather 曲线，到 end），fadeFrom → end 淡出；
    /// 触觉与第一帧同一个 CADisplayLink 回调（firstFrame）。减少动态效果：不飞，reduceMs 原地淡出，触觉照发。
    /// 返回叠层（播完自己移除）；Metal 不可用 / 没有笔画 / 没有起点返回 nil（调用方自己发触觉）。
    @discardableResult
    static func play(in container: UIView, from: CGRect, to counter: CGRect?, strokes: [[InkRawPoint]], params: InkParams, color: SIMD4<Float>,
                     spec: NativeSettleSpec, reduceMotion: Bool, firstFrame: @escaping () -> Void) -> NativeInkView? {
        guard !strokes.isEmpty, from.width > 0 else { return nil }
        if sharedRenderer == nil { sharedRenderer = NativeInkRenderer() }
        guard let renderer = sharedRenderer, let v = NativeInkView(frame: container.bounds, renderer: renderer) else { return nil }
        v.drawable = false
        v.isUserInteractionEnabled = false
        v.accessibilityElementsHidden = true
        container.addSubview(v)
        let box = spec.countBox
        let to = counter.map { CGRect(x: $0.midX - box / 2, y: $0.midY - box / 2, width: box, height: box) }
            ?? CGRect(x: from.midX - box / 2, y: from.minY - 40, width: box, height: box)
        let meshes = strokes.map { NativeInkStrokeMesh.build(raw: $0, params: params) }
        let size = container.bounds.size
        var t0: CFTimeInterval = 0
        func lerp(_ a: CGRect, _ b: CGRect, _ u: Double) -> CGRect {
            let f = CGFloat(u)
            return CGRect(x: a.minX + (b.minX - a.minX) * f, y: a.minY + (b.minY - a.minY) * f, width: a.width + (b.width - a.width) * f, height: a.height + (b.height - a.height) * f)
        }
        v.overlayFrame = { target in
            if t0 == 0 { t0 = target }
            let ms = (target - t0) * 1000
            var r = from
            var alpha = 1.0
            if reduceMotion {
                if ms > spec.reduceMs { return nil }
                alpha = 1 - ms / spec.reduceMs
            } else {
                if ms > spec.end { return nil }
                if ms < spec.lift {
                    let s = 1 - (1 - spec.liftScale) * NativeBezier.value(ms / spec.lift, spec.easeOut)
                    r = from.insetBy(dx: from.width * CGFloat(1 - s) / 2, dy: from.height * CGFloat(1 - s) / 2)
                } else {
                    let half = CGFloat((1 - spec.liftScale) / 2)
                    let start = from.insetBy(dx: from.width * half, dy: from.height * half)
                    r = lerp(start, to, NativeBezier.value((ms - spec.lift) / (spec.end - spec.lift), spec.gather))
                }
                if ms > spec.fadeFrom { alpha = max(0, 1 - (ms - spec.fadeFrom) / (spec.end - spec.fadeFrom)) }
            }
            let a = Float(alpha)
            let u = NativeInkRenderer.uniforms(color: SIMD4(color.x * a, color.y * a, color.z * a, a), rectInView: r, viewSize: size)
            return meshes.map { m in
                if m.buffer == nil { m.buffer = renderer.makeBuffer(m.vertices) }
                return NativeInkRenderer.Batch(vertices: nil, buffer: m.buffer, count: m.vertexCount, uniforms: u)
            }
        }
        var first = true
        v.afterFrame = { [weak v] _ in
            if first {
                first = false
                firstFrame() // 与离纸第一帧同一个 CADisplayLink 回调（F1：触觉与画面同帧）
            }
            if v?.overlayFrame == nil { DispatchQueue.main.async { v?.removeFromSuperview() } }
        }
        v.requestRender()
        return v
    }
}

// MARK: 改判弹层

/// 弹层需要的外观与文案：由原生写字页给（同一份 copy 字典与令牌颜色）。
struct NativeJudgeStyle {
    var tr: (String, [String: CustomStringConvertible]) -> String
    var color: (String, UIColor) -> UIColor
    var inkTint: SIMD4<Float>?
}

/// 改判弹层（决定型弹层：没有默认项、焦点落在弹层标题，D03；取消在左上外 / 右上「取消」，确认类在主按钮）。
/// 点主按钮 → correct op（apply，明示目标判断，重发不会改回去）；成功或 stale 关弹层并把回包快照交给写字页；失败就地换三段式（说明 → [先不改 | 再试一次]），
/// 记录与 FSRS 不变。
final class NativeChangeSheetViewController: UIViewController {
    struct Model {
        let recordId: String
        let char: String
        let judgment: String // 此刻记录里的判断
        let paper: Bool
        let strokes: [[InkRawPoint]]

        init?(_ body: [String: Any]) {
            guard (body["ok"] as? Bool) == true, let id = body["recordId"] as? String, let char = body["char"] as? String,
                  let j = body["judgment"] as? String, j == "correct" || j == "wrong" else { return nil }
            recordId = id
            self.char = char
            judgment = j
            paper = (body["paper"] as? Bool) == true
            strokes = NativeInkWire.rawStrokes(body["strokes"])
        }

        /// 主按钮要改成的判断（与记录里的相反；明示给 op）。
        var target: String { judgment == "correct" ? "wrong" : "correct" }
    }

    let model: Model
    private let slot: String
    private let bridge: NativeWriteBridge
    private let style: NativeJudgeStyle
    private let onApplied: ([String: Any]?) -> Void
    private(set) var failed = false
    private var busy = false

    private let titleLabel = UILabel()
    private let cancelButton = UIButton(type: .system)
    private let mineCard = UIView()
    private let refCard = UIView()
    private let refGlyph = NativeGlyphView()
    private var inkView: NativeInkView?
    private let mineEmpty = UILabel()
    private let mineLabel = UILabel()
    private let refLabel = UILabel()
    private let noteLabel = UILabel()
    private let flipButton = UIButton(type: .system)
    private let failCancel = UIButton(type: .system)
    private let failRetry = UIButton(type: .system)
    private lazy var haptic = UIImpactFeedbackGenerator(style: .soft)
    private var contentHeight: CGFloat = 520

    init(slot: String, model: Model, bridge: NativeWriteBridge, style: NativeJudgeStyle, onApplied: @escaping ([String: Any]?) -> Void) {
        self.slot = slot
        self.model = model
        self.bridge = bridge
        self.style = style
        self.onApplied = onApplied
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .pageSheet
        if let sheet = sheetPresentationController {
            if #available(iOS 16.0, *) {
                sheet.detents = [.custom(identifier: .init("changeSheet")) { [weak self] ctx in min(ctx.maximumDetentValue, self?.contentHeight ?? 520) }]
            } else {
                sheet.detents = [.medium(), .large()]
            }
            sheet.prefersGrabberVisible = true
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func tr(_ key: String, _ vars: [String: CustomStringConvertible] = [:]) -> String { style.tr(key, vars) }

    // MARK: 视图

    override func viewDidLoad() {
        super.viewDidLoad()
        let paper = style.color("paper", .systemBackground)
        view.backgroundColor = paper

        titleLabel.text = tr("X-JUDGE.changeTitle", ["char": model.char])
        titleLabel.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 17, weight: .medium))
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.textColor = style.color("ink1", .label)
        titleLabel.numberOfLines = 0
        titleLabel.accessibilityTraits = [.header]
        titleLabel.accessibilityIdentifier = "native-change-title"

        cancelButton.setTitle(tr("X-JUDGE.changeCancel"), for: .normal)
        cancelButton.titleLabel?.font = UIFont.preferredFont(forTextStyle: .subheadline)
        cancelButton.titleLabel?.adjustsFontForContentSizeCategory = true
        cancelButton.setTitleColor(style.color("ink2", .secondaryLabel), for: .normal)
        cancelButton.accessibilityIdentifier = "native-change-cancel"
        cancelButton.addAction(UIAction { [weak self] _ in self?.close() }, for: .touchUpInside)

        for card in [mineCard, refCard] {
            card.layer.borderWidth = 1
            card.layer.borderColor = style.color("frame", .separator).cgColor
            card.layer.cornerRadius = 4
            card.clipsToBounds = true
        }
        mineCard.isAccessibilityElement = true
        mineCard.accessibilityIdentifier = "native-change-mine"
        refCard.isAccessibilityElement = true
        refCard.accessibilityIdentifier = "native-change-ref"
        refCard.accessibilityLabel = tr("R-W09.refCardLabelChar", ["char": model.char])
        refGlyph.char = model.char
        refGlyph.color = style.color("ref", .label)
        refCard.addSubview(refGlyph)

        let nStrokes = model.strokes.filter { !$0.isEmpty }.count
        if model.paper {
            mineEmpty.text = tr("X-JUDGE.paperMineBox")
            mineCard.accessibilityLabel = tr("X-JUDGE.paperMineBox")
        } else if nStrokes > 0, let ink = NativeInkView.make(frame: .zero) {
            ink.drawable = false
            ink.isUserInteractionEnabled = false
            ink.isAccessibilityElement = false
            if let c = style.inkTint { ink.inkColor = c }
            ink.syncPageStrokes(model.strokes)
            mineCard.addSubview(ink)
            inkView = ink
            mineCard.accessibilityLabel = tr("R-W09.mineCardLabel", ["n": nStrokes])
        } else {
            mineEmpty.text = tr("R-D07.noInkLarge")
            mineCard.accessibilityLabel = tr("R-D07.noInkLarge")
        }
        mineEmpty.font = UIFont.preferredFont(forTextStyle: .footnote)
        mineEmpty.adjustsFontForContentSizeCategory = true
        mineEmpty.textColor = style.color("ink3", .secondaryLabel)
        mineEmpty.textAlignment = .center
        mineEmpty.numberOfLines = 0
        mineEmpty.isHidden = mineEmpty.text == nil
        mineEmpty.accessibilityIdentifier = "native-change-noink"
        mineCard.addSubview(mineEmpty)

        for (l, key) in [(mineLabel, "R-W09.labelMine"), (refLabel, "R-W09.labelReference")] {
            l.text = tr(key)
            l.font = UIFont.preferredFont(forTextStyle: .footnote)
            l.adjustsFontForContentSizeCategory = true
            l.textColor = style.color("ink3", .secondaryLabel)
            l.textAlignment = .center
            l.isAccessibilityElement = false // 旁注只留视觉，读屏名称在两张卡上
        }

        noteLabel.font = UIFont.preferredFont(forTextStyle: .footnote)
        noteLabel.adjustsFontForContentSizeCategory = true
        noteLabel.textColor = style.color("ink3", .secondaryLabel)
        noteLabel.textAlignment = .center
        noteLabel.numberOfLines = 0
        noteLabel.accessibilityIdentifier = "native-change-note"

        configureButton(flipButton, title: "", id: "native-change-flip")
        configureButton(failRetry, title: tr("R-W10.retry"), id: "native-change-retry")
        failCancel.setTitle(tr("R-W10.cancel"), for: .normal)
        failCancel.titleLabel?.font = UIFont.preferredFont(forTextStyle: .subheadline)
        failCancel.titleLabel?.adjustsFontForContentSizeCategory = true
        failCancel.setTitleColor(style.color("ink2", .secondaryLabel), for: .normal)
        failCancel.accessibilityIdentifier = "native-change-fail-cancel"
        flipButton.addAction(UIAction { [weak self] _ in self?.apply() }, for: .touchUpInside)
        failRetry.addAction(UIAction { [weak self] _ in self?.apply() }, for: .touchUpInside)
        failCancel.addAction(UIAction { [weak self] _ in self?.close() }, for: .touchUpInside)

        [titleLabel, cancelButton, mineCard, refCard, mineLabel, refLabel, noteLabel, flipButton, failCancel, failRetry].forEach { view.addSubview($0) }
        render()
    }

    private func configureButton(_ b: UIButton, title: String, id: String) {
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 17, weight: .medium))
        b.titleLabel?.adjustsFontForContentSizeCategory = true
        b.backgroundColor = style.color("ink1", .label)
        b.setTitleColor(style.color("paper", .systemBackground), for: .normal)
        b.layer.cornerRadius = 12
        b.accessibilityIdentifier = id
    }

    /// 主按钮文字 / 说明 / 失败三段式（就地换，不开第二层）。
    private func render() {
        flipButton.setTitle(tr(model.judgment == "correct" ? "X-JUDGE.changeToWrong" : "X-JUDGE.changeToCorrect"), for: .normal)
        noteLabel.text = failed ? tr("R-W10.changeFailed") : tr(model.judgment == "correct" ? "R-W10.changeBodyCorrect" : "R-W10.changeBodyWrong")
        flipButton.isHidden = failed
        failCancel.isHidden = !failed
        failRetry.isHidden = !failed
        view.setNeedsLayout()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let w = view.bounds.width
        let gutter: CGFloat = 20
        let safeBottom = max(24, view.safeAreaInsets.bottom)
        let cancelW = max(60, ceil(cancelButton.sizeThatFits(CGSize(width: w, height: 44)).width) + 24)
        cancelButton.frame = CGRect(x: w - 12 - cancelW, y: 18, width: cancelW, height: 44)
        let titleW = w - gutter - (cancelW + 12)
        let titleH = ceil(titleLabel.sizeThatFits(CGSize(width: titleW, height: .greatestFiniteMagnitude)).height)
        titleLabel.frame = CGRect(x: gutter, y: 18 + max(0, (44 - titleH) / 2), width: titleW, height: titleH)
        var y = max(18 + 44, titleLabel.frame.maxY) + 12
        let card = floor((w - 2 * gutter - 12) / 2)
        mineCard.frame = CGRect(x: gutter, y: y, width: card, height: card)
        refCard.frame = CGRect(x: gutter + card + 12, y: y, width: card, height: card)
        mineEmpty.frame = mineCard.bounds.insetBy(dx: 8, dy: 8)
        inkView?.frame = mineCard.bounds
        refGlyph.frame = refCard.bounds
        y = mineCard.frame.maxY + 6
        let labH = ceil(mineLabel.font.lineHeight)
        mineLabel.frame = CGRect(x: mineCard.frame.minX, y: y, width: card, height: labH)
        refLabel.frame = CGRect(x: refCard.frame.minX, y: y, width: card, height: labH)
        y = mineLabel.frame.maxY + 12
        let noteH = ceil(noteLabel.sizeThatFits(CGSize(width: w - 2 * gutter, height: .greatestFiniteMagnitude)).height)
        noteLabel.frame = CGRect(x: gutter, y: y, width: w - 2 * gutter, height: noteH)
        y = noteLabel.frame.maxY + 16
        let btnH = max(54, ceil(flipButton.titleLabel?.font.lineHeight ?? 22) + 32)
        if failed {
            let half = floor((w - 2 * gutter - 12) / 2)
            failCancel.frame = CGRect(x: gutter, y: y, width: half, height: btnH)
            failRetry.frame = CGRect(x: gutter + half + 12, y: y, width: half, height: btnH)
        } else {
            flipButton.frame = CGRect(x: gutter, y: y, width: w - 2 * gutter, height: btnH)
        }
        let h = y + btnH + safeBottom
        if abs(h - contentHeight) > 0.5 {
            contentHeight = h
            if #available(iOS 16.0, *) { sheetPresentationController?.invalidateDetents() }
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // 决定型弹层：焦点落在弹层标题，不落在任何按钮上（D03）
        UIAccessibility.post(notification: .screenChanged, argument: titleLabel)
    }

    override func accessibilityPerformEscape() -> Bool {
        close()
        return true
    }

    var titleTextForTesting: String? { titleLabel.text }
    var failedForTesting: Bool { failed }
    var noteTextForTesting: String? { noteLabel.text }
    var flipTitleForTesting: String? { flipButton.title(for: .normal) }
    var hasInkForTesting: Bool { inkView != nil }
    var emptyTextForTesting: String? { mineEmpty.isHidden ? nil : mineEmpty.text }

    // MARK: 动作

    private func close() {
        dismiss(animated: true)
    }

    /// 主按钮 / 再试一次：同一个动作（明示目标判断）。
    func apply() {
        guard !busy else { return }
        busy = true
        bridge.call("correct", ["slot": slot, "recordId": model.recordId, "to": model.target, "action": "apply"]) { [weak self] reply in
            guard let self else { return }
            self.busy = false
            // 网页同样：成功或结果行已不是这条记录（stale）都关弹层
            if reply.ok || reply.errorKind == "stale" {
                if reply.ok { self.haptic.impactOccurred(intensity: 0.7) } // F1：修改判断成功，commit 之后发
                self.dismiss(animated: true)
                self.onApplied(reply.snapshot)
                return
            }
            self.failed = true
            self.render()
            UIAccessibility.post(notification: .announcement, argument: self.noteLabel.text)
        }
    }
}
#endif
