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
    static func play(in container: UIView, from: CGRect, to counter: CGRect?, strokes: [[InkRawPoint]], params: WebInkParams?, color: SIMD4<Float>,
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

// MARK: 字阶（R9-B）

/// 网页字阶的此刻计算值（open 回包 type，pt：fs13 / lh13 / fs15 / lh15 / fs17 / lh17s / fs22 / lh22 / btn-h；页面 native-session.js typeBundle）。
/// 原生按它排字，与网页同字号同行高（系统字号连续倍率 --k 与 AX 档取值表只在 tokens.css 一处）。行高按 WebKit 的做法取整到整 pt。
/// 缺项（旧页面 / 单测）或原生页开着时系统字号变了：回包值作废，按 UIFontMetrics 近似（下一次 open 再对齐）。
/// 字体：系统字体（SF，中文落到系统的苹方 UI）——与网页 -apple-system 同一套字形与度量。例外：含全角标点（「」。，等）的句子，
/// 系统字体排版会把标点挤成半宽，网页（WebKit）不挤；这类句子直接用系统给中文的那一款（CTFontCreateForString 取到的苹方 UI），字宽与网页一致（NP-14）。
/// 行高：控件盒子按网页行高排（lines × lh，WebKit 取整到整 pt），字在盒子里竖向居中（同网页半行距）。
struct NativeType {
    private let raw: [String: CGFloat]
    private let category: UIContentSizeCategory

    init(_ payload: Any? = nil) {
        var r: [String: CGFloat] = [:]
        for (k, v) in (payload as? [String: Any]) ?? [:] {
            if let n = v as? NSNumber, n.doubleValue > 0 { r[k] = CGFloat(n.doubleValue) }
        }
        raw = r
        category = UIApplication.shared.preferredContentSizeCategory
    }

    private static let fallback: [String: (CGFloat, UIFont.TextStyle)] = [
        "fs13": (13, .footnote), "lh13": (20, .footnote), "fs15": (15, .subheadline), "lh15": (22, .subheadline),
        "fs17": (17, .body), "lh17": (26, .body), "lh17s": (22, .body), "fs28": (28, .title1), "fs22": (22, .title2), "lh22": (30, .title2), "btn-h": (54, .body),
        "r-box": (24, .body),
    ]

    func value(_ name: String) -> CGFloat {
        if name.hasPrefix("r-") { return raw[name] ?? Self.fallback[name]?.0 ?? 0 } // 圆角档（--r-box …）不随字号
        if let v = raw[name], UIApplication.shared.preferredContentSizeCategory == category { return v }
        let (base, style) = Self.fallback[name] ?? (17, .body)
        let v = UIFontMetrics(forTextStyle: style).scaledValue(for: base)
        return name == "btn-h" ? max(base, v) : v
    }

    /// 行高（WebKit 把小数行高取整到整 pt）。
    func line(_ name: String) -> CGFloat { floor(value(name)) }

    /// 系统字体，中文字形接到苹方 UI 的正文款（cascade）：系统在大字号下会给中文换成展示款（字距更紧），网页（WebKit）一直用正文款，
    /// 不接的话 XXXL 下「改为写对」这类字比网页窄 3pt。拉丁字母 / 数字 / 行高仍是 SF（与网页 -apple-system 同）。
    func font(_ name: String, weight: UIFont.Weight = .regular) -> UIFont {
        let size = value(name)
        let sys = UIFont.systemFont(ofSize: size, weight: weight)
        let cjk = Self.cjkFont(size: size, weight: weight)
        let d = sys.fontDescriptor.addingAttributes([.cascadeList: [cjk.fontDescriptor]])
        return UIFont(descriptor: d, size: size)
    }

    static func hasCJKPunctuation(_ s: String) -> Bool {
        s.unicodeScalars.contains { (0x3000...0x303F).contains($0.value) || (0xFF00...0xFFEF).contains($0.value) }
    }

    /// 系统给中文的那一款（苹方 UI）的正文款：按 17pt 取到字体，再换成要的字号（光学尺寸钉在 17，换字号不换款）。
    static func cjkFont(size: CGFloat, weight: UIFont.Weight) -> UIFont {
        let probe = UIFont.systemFont(ofSize: 17, weight: weight)
        let text = CTFontCreateForString(probe as CTFont, "\u{6C38}" as CFString, CFRange(location: 0, length: 1))
        // 钉住光学尺寸 17：只换字号的话 CoreText 在 20pt 以上会自动换成展示款
        let d = CTFontDescriptorCreateCopyWithAttributes(CTFontCopyFontDescriptor(text), [kCTFontOpticalSizeAttribute: 17] as CFDictionary)
        return CTFontCreateWithFontDescriptor(d, size, nil) as UIFont
    }

    static func weight(of f: UIFont) -> UIFont.Weight {
        let traits = f.fontDescriptor.object(forKey: .traits) as? [UIFontDescriptor.TraitKey: Any]
        return UIFont.Weight(rawValue: CGFloat((traits?[.weight] as? NSNumber)?.doubleValue ?? 0))
    }

    /// 标签：字号、颜色、对齐；含全角标点的句子换成苹方 UI（见上），句中的拉丁字母 / 数字 / 空格按 SF 的字宽排（网页里它们是 SF），
    /// 多行时行距 = 网页行高（line，相邻两行基线相隔 line，同网页）。
    static func set(_ label: UILabel, _ text: String?, font: UIFont, color: UIColor, align: NSTextAlignment = .natural, line: CGFloat? = nil) {
        let punct = text.map(hasCJKPunctuation) ?? false
        let f = punct ? cjkFont(size: font.pointSize, weight: weight(of: font)) : font
        label.attributedText = nil
        label.font = f
        label.textColor = color
        label.textAlignment = align
        guard let text, !text.isEmpty, punct || line != nil else {
            label.text = text
            return
        }
        let p = NSMutableParagraphStyle()
        p.alignment = align
        p.lineSpacing = max(0, (line ?? 0) - f.lineHeight)
        let out = NSMutableAttributedString(string: text, attributes: [.font: f, .foregroundColor: color, .paragraphStyle: p])
        if punct {
            let sf = UIFont.systemFont(ofSize: font.pointSize, weight: weight(of: font))
            var i = 0
            for ch in text {
                let n = (String(ch) as NSString).length
                if !ch.unicodeScalars.contains(where: { $0.value >= 0x2E80 }) {
                    let want = (String(ch) as NSString).size(withAttributes: [.font: sf]).width
                    let have = (String(ch) as NSString).size(withAttributes: [.font: f]).width
                    out.addAttribute(.kern, value: want - have, range: NSRange(location: i, length: n))
                }
                i += n
            }
        }
        label.attributedText = out
    }

    /// 宋（ShiziSerifSC，网页 --song；包里 Web/fonts 的 woff2，CoreText 直接读）。弹层标题这类网页用宋体的地方；读不到时退回系统字体。
    static func song(size: CGFloat, weight: UIFont.Weight) -> UIFont {
        let medium = weight.rawValue >= UIFont.Weight.medium.rawValue
        let name = medium ? "ShiziSerifSC-Medium" : "ShiziSerifSC-Regular"
        if songCache[name] == nil, let url = Bundle.main.url(forResource: "Web", withExtension: nil)?.appendingPathComponent("fonts/\(name).woff2"),
           let data = try? Data(contentsOf: url), let d = CTFontManagerCreateFontDescriptorFromData(data as CFData) {
            songCache[name] = d
        }
        guard let d = songCache[name] else { return .systemFont(ofSize: size, weight: weight) }
        return CTFontCreateWithFontDescriptor(d, size, nil) as UIFont
    }

    private static var songCache: [String: CTFontDescriptor] = [:]

    /// 标签在给定宽度下的盒高（行数 × 网页行高）。
    static func height(_ label: UILabel, width: CGFloat, line: CGFloat) -> CGFloat {
        guard !(label.text ?? "").isEmpty else { return 0 }
        let h = label.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        let lines = max(1, (h / max(1, label.font.lineHeight)).rounded())
        return lines * line
    }

    /// 网页段落 `text-wrap: pretty`（base.css p）的近似：两行的段落按贪心折行时末行太短（不到一行的 1/3），
    /// 改在第一行里最后一个句读（。，；！？）之后折行——与 WebKit 的结果相同（例：「……不写了。」/「判断过的 1 个字已经记下。」）。
    /// 返回要显示的字（可能多一个换行；读屏与比对都把空白去掉，不影响文案）。
    static func pretty(_ text: String, font: UIFont, width: CGFloat) -> String {
        func w(_ s: Substring) -> CGFloat { (String(s) as NSString).size(withAttributes: [.font: font]).width }
        let full = Substring(text)
        guard width > 0, w(full) > width, !text.contains("\n") else { return text }
        var fit = text.startIndex
        var i = text.startIndex
        while i < text.endIndex {
            let next = text.index(after: i)
            if w(full[..<next]) > width { break }
            fit = next
            i = next
        }
        let rest = full[fit...]
        guard w(rest) <= width, w(rest) < width / 3 else { return text }
        var cut: String.Index?
        var j = text.startIndex
        while j < fit {
            let next = text.index(after: j)
            if "\u{3002}\u{FF0C}\u{FF1B}\u{FF01}\u{FF1F}".contains(text[j]), next < fit { cut = next }
            j = next
        }
        guard let cut else { return text }
        return String(full[..<cut]) + "\n" + String(full[cut...]).trimmingCharacters(in: .whitespaces)
    }

    static func width(_ label: UILabel) -> CGFloat {
        label.sizeThatFits(CGSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude)).width
    }
}

// MARK: 弹层 / 确认框的时刻（R9-B）

/// open 回包 motion.overlay（交互规范 T0：T-sheet 进 280 ease.out / 退 220 ease.in，遮罩 200 / 180；T-confirm 进 200 由 0.96 放大淡入 / 退 180 淡出；
/// 减少动态效果一律 reduce 淡化）与下滑关闭阈值（gesture，与网页 Sheet.js createSheetDrag 同一组）。缺项：时长 0（不做动画），阈值取左缘返回同一组常量。
struct NativeOverlaySpec {
    var sheetIn = 0.0, sheetOut = 0.0, scrimIn = 0.0, scrimOut = 0.0, confirmIn = 0.0, confirmOut = 0.0, reduce = 0.0, snap = 0.0
    var confirmFrom: CGFloat = 1
    var easeOut: [Double]?
    var easeIn: [Double]?
    var directionSlop: CGFloat = 10
    var commitRatio: CGFloat = BackGestureThreshold.commitRatio
    var commitVelocity: CGFloat = BackGestureThreshold.commitVelocity
    var returnVelocity: CGFloat = BackGestureThreshold.returnVelocity

    init(motion: [String: Any]? = nil) {
        let o = motion?["overlay"] as? [String: Any] ?? [:]
        func d(_ k: String) -> Double { ((o[k] as? NSNumber)?.doubleValue ?? 0) / 1000 }
        sheetIn = d("sheetIn"); sheetOut = d("sheetOut"); scrimIn = d("scrimIn"); scrimOut = d("scrimOut")
        confirmIn = d("confirmIn"); confirmOut = d("confirmOut"); snap = d("snap")
        reduce = ((motion?["reduce"] as? NSNumber)?.doubleValue ?? 0) / 1000
        if let x = o["confirmFrom"] as? NSNumber { confirmFrom = CGFloat(x.doubleValue) }
        easeOut = (motion?["easeOut"] as? [NSNumber])?.map { $0.doubleValue }
        easeIn = (o["easeIn"] as? [NSNumber])?.map { $0.doubleValue }
        if let x = o["directionSlop"] as? NSNumber { directionSlop = CGFloat(x.doubleValue) }
        if let x = o["commitRatio"] as? NSNumber { commitRatio = CGFloat(x.doubleValue) }
        if let x = o["commitVelocity"] as? NSNumber { commitVelocity = CGFloat(x.doubleValue) }
        if let x = o["returnVelocity"] as? NSNumber { returnVelocity = CGFloat(x.doubleValue) }
    }

    static func curve(_ p: [Double]?, fallback: UIView.AnimationCurve) -> UITimingCurveProvider {
        guard let p, p.count == 4 else { return UICubicTimingParameters(animationCurve: fallback) }
        return UICubicTimingParameters(controlPoint1: CGPoint(x: p[0], y: p[1]), controlPoint2: CGPoint(x: p[2], y: p[3]))
    }

    static func run(_ duration: TimeInterval, _ curve: UITimingCurveProvider, _ body: @escaping () -> Void, done: (() -> Void)? = nil) {
        guard duration > 0 else {
            body()
            done?()
            return
        }
        let a = UIViewPropertyAnimator(duration: duration, timingParameters: curve)
        a.addAnimations(body)
        if let done { a.addCompletion { _ in done() } }
        a.startAnimation()
    }
}

/// 子视图可以伸出自身边界接收点按（结果行「修改 ›」的 44pt 热区伸到说明位上沿以外，NP-01）。
final class NativeOverflowView: UIView {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard !isHidden, alpha > 0.01, isUserInteractionEnabled else { return nil }
        for s in subviews.reversed() {
            if let hit = s.hitTest(convert(point, to: s), with: event) { return hit }
        }
        return self.point(inside: point, with: event) ? self : nil
    }
}

/// 文字按钮：字的盒子比 44 窄时，点击区仍按 44 × 44 以盒子中心向外扩（网页 .sz-btn--text::after）。
final class NativeTextButton: UIButton {
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        let dx = max(0, 44 - bounds.width) / 2, dy = max(0, 44 - bounds.height) / 2
        return bounds.insetBy(dx: -dx, dy: -dy).contains(point)
    }
}

// MARK: 改判弹层

/// 弹层需要的外观与文案：由原生写字页给（同一份 copy 字典、令牌颜色、字阶与时刻）。
struct NativeJudgeStyle {
    var tr: (String, [String: CustomStringConvertible]) -> String
    var color: (String, UIColor) -> UIColor
    var inkTint: SIMD4<Float>?
    var type = NativeType()
    var overlay = NativeOverlaySpec()
}

/// 底部弹层的呈现（网页 Sheet.js：满宽贴底、上两角 24、max-height 88%、遮罩 --scrim；点遮罩 = 关）。
final class NativeSheetPresentation: UIPresentationController {
    let scrim = UIView()
    var onScrimTap: (() -> Void)?

    init(presented: UIViewController, presenting: UIViewController?, scrimColor: UIColor) {
        super.init(presentedViewController: presented, presenting: presenting)
        scrim.backgroundColor = scrimColor
        scrim.isAccessibilityElement = false
        scrim.accessibilityIdentifier = "native-change-scrim"
        scrim.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapScrim)))
    }

    @objc private func tapScrim() { onScrimTap?() }

    override var frameOfPresentedViewInContainerView: CGRect {
        guard let c = containerView else { return .zero }
        let want = (presentedViewController as? NativeChangeSheetViewController)?.preferredHeight(width: c.bounds.width, safeBottom: c.safeAreaInsets.bottom) ?? c.bounds.height / 2
        let h = min(want, floor(c.bounds.height * 0.88))
        return CGRect(x: 0, y: c.bounds.height - h, width: c.bounds.width, height: h)
    }

    override func presentationTransitionWillBegin() {
        guard let c = containerView else { return }
        scrim.frame = c.bounds
        scrim.alpha = 0
        c.insertSubview(scrim, at: 0)
    }

    override func containerViewWillLayoutSubviews() {
        super.containerViewWillLayoutSubviews()
        scrim.frame = containerView?.bounds ?? .zero
        guard let v = presentedView, v.transform == .identity, !presentedViewController.isBeingPresented, !presentedViewController.isBeingDismissed else { return }
        v.frame = frameOfPresentedViewInContainerView
    }

    override func dismissalTransitionDidEnd(_ completed: Bool) {
        if completed { scrim.removeFromSuperview() }
    }
}

/// T-sheet：进场自下而上（sheetIn，ease.out）+ 遮罩淡入（scrimIn）；退场下滑（sheetOut，ease.in）+ 遮罩淡出（scrimOut）；减少动态效果：reduce 淡化。
final class NativeSheetAnimator: NSObject, UIViewControllerAnimatedTransitioning {
    let presenting: Bool
    let spec: NativeOverlaySpec
    let reduce: Bool

    init(presenting: Bool, spec: NativeOverlaySpec, reduce: Bool) {
        self.presenting = presenting
        self.spec = spec
        self.reduce = reduce
    }

    func transitionDuration(using ctx: UIViewControllerContextTransitioning?) -> TimeInterval {
        reduce ? spec.reduce : (presenting ? max(spec.sheetIn, spec.scrimIn) : max(spec.sheetOut, spec.scrimOut))
    }

    func animateTransition(using ctx: UIViewControllerContextTransitioning) {
        let key: UITransitionContextViewControllerKey = presenting ? .to : .from
        guard let vc = ctx.viewController(forKey: key) else { ctx.completeTransition(false); return }
        let v = ctx.view(forKey: presenting ? .to : .from) ?? vc.view!
        let scrim = (vc.presentationController as? NativeSheetPresentation)?.scrim
        let linear = UICubicTimingParameters(animationCurve: .linear)
        var pending = 2
        let finish = { pending -= 1; if pending == 0 { ctx.completeTransition(!ctx.transitionWasCancelled) } }
        if presenting {
            let final = ctx.finalFrame(for: vc)
            ctx.containerView.addSubview(v)
            if reduce {
                v.frame = final
                v.alpha = 0
                NativeOverlaySpec.run(spec.reduce, linear, { v.alpha = 1 }, done: finish)
                NativeOverlaySpec.run(spec.reduce, linear, { scrim?.alpha = 1 }, done: finish)
            } else {
                v.frame = final.offsetBy(dx: 0, dy: final.height)
                NativeOverlaySpec.run(spec.sheetIn, NativeOverlaySpec.curve(spec.easeOut, fallback: .easeOut), { v.frame = final }, done: finish)
                NativeOverlaySpec.run(spec.scrimIn, NativeOverlaySpec.curve(spec.easeOut, fallback: .easeOut), { scrim?.alpha = 1 }, done: finish)
            }
        } else {
            if reduce {
                NativeOverlaySpec.run(spec.reduce, linear, { v.alpha = 0 }, done: finish)
                NativeOverlaySpec.run(spec.reduce, linear, { scrim?.alpha = 0 }, done: finish)
            } else {
                // 下滑关闭时弹层带着手指的位移：从当前位置接着滑出
                let start = v.frame.offsetBy(dx: 0, dy: v.transform.ty)
                v.transform = .identity
                v.frame = start
                let end = CGRect(x: start.minX, y: ctx.containerView.bounds.height, width: start.width, height: start.height)
                NativeOverlaySpec.run(spec.sheetOut, NativeOverlaySpec.curve(spec.easeIn, fallback: .easeIn), { v.frame = end }, done: finish)
                NativeOverlaySpec.run(spec.scrimOut, NativeOverlaySpec.curve(spec.easeIn, fallback: .easeIn), { scrim?.alpha = 0 }, done: finish)
            }
        }
    }
}

/// 改判弹层（决定型弹层：没有默认项、焦点落在弹层标题，D03；右上「取消」、点遮罩、下滑、两指 Z 形都是关）。网页 result-row.js ChangeSheet 的原生版，
/// 排法逐项照网页（R9-B）：满宽贴底、上两角 24、elev 底；内边距 24 / 20 / max(32, 下安全区)、段间 16：
///   标题（22 / 30，500）+ 右上「取消」（15，ink2，距顶 18、44 高）→ 两张小卡（1fr 1fr、间 12，笺底 + 格框、方角）各带下方 12 处的旁注（13，ink3）
///   → 说明（13 / 20，ink3，居中）→「看这个字 ›」（15，ink2，文字按钮，左对齐页边）→ 主按钮（btn-h，墨底）。
/// 点主按钮 → correct op（apply，明示目标判断，重发不会改回去）；成功或 stale 关弹层并把回包快照交给写字页；失败就地换三段式（说明 → [先不改 | 再试一次]），
/// 记录与 FSRS 不变。「看这个字 ›」（D66 ⑮）：关弹层，写字页让开、推入这个字的详情（onViewChar）。
final class NativeChangeSheetViewController: UIViewController, UIViewControllerTransitioningDelegate, UIGestureRecognizerDelegate {
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
    /// 「看这个字 ›」：弹层已关，写字页接着去字详情。
    var onViewChar: ((String) -> Void)?
    private(set) var failed = false
    private var busy = false

    private let scroll = UIScrollView()
    private let titleLabel = UILabel()
    private let cancelButton = NativeTextButton(type: .system)
    private let mineCard = UIView()
    private let refCard = UIView()
    private let refGlyph = NativeGlyphView()
    private var inkView: NativeInkView?
    private let mineEmpty = UILabel()
    private let dashed = CAShapeLayer()
    private let mineLabel = UILabel()
    private let refLabel = UILabel()
    private let noteLabel = UILabel()
    private let detailButton = NativeTextButton(type: .system)
    private let flipButton = UIButton(type: .system)
    private let failCancel = NativeTextButton(type: .system)
    private let failRetry = UIButton(type: .system)
    private let pan = UIPanGestureRecognizer()
    private lazy var haptic = UIImpactFeedbackGenerator(style: .soft)

    private var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }
    private var type: NativeType { style.type }

    init(slot: String, model: Model, bridge: NativeWriteBridge, style: NativeJudgeStyle, onApplied: @escaping ([String: Any]?) -> Void) {
        self.slot = slot
        self.model = model
        self.bridge = bridge
        self.style = style
        self.onApplied = onApplied
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .custom
        transitioningDelegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func tr(_ key: String, _ vars: [String: CustomStringConvertible] = [:]) -> String { style.tr(key, vars) }

    // MARK: 呈现

    func presentationController(forPresented presented: UIViewController, presenting: UIViewController?, source: UIViewController) -> UIPresentationController? {
        let p = NativeSheetPresentation(presented: presented, presenting: presenting, scrimColor: style.color("scrim", UIColor.black.withAlphaComponent(0.32)))
        p.onScrimTap = { [weak self] in self?.close() }
        return p
    }

    func animationController(forPresented presented: UIViewController, presenting: UIViewController, source: UIViewController) -> UIViewControllerAnimatedTransitioning? {
        NativeSheetAnimator(presenting: true, spec: style.overlay, reduce: reduceMotion)
    }

    func animationController(forDismissed dismissed: UIViewController) -> UIViewControllerAnimatedTransitioning? {
        NativeSheetAnimator(presenting: false, spec: style.overlay, reduce: reduceMotion)
    }

    // MARK: 视图

    override func viewDidLoad() {
        super.viewDidLoad()
        let ink1 = style.color("ink1", .label), ink2 = style.color("ink2", .secondaryLabel), ink3 = style.color("ink3", .secondaryLabel)
        view.backgroundColor = style.color("elev", .systemBackground)
        view.layer.cornerRadius = 24
        view.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        view.layer.cornerCurve = .continuous
        // --elev-shadow：浅色 0 -10 30 墨 10%（另有 0.5 的上沿线），深色只有一条极淡的上沿高光
        let dark = traitCollection.userInterfaceStyle == .dark
        view.layer.shadowColor = (dark ? UIColor(red: 1, green: 240 / 255, blue: 220 / 255, alpha: 1) : UIColor(red: 38 / 255, green: 33 / 255, blue: 29 / 255, alpha: 1)).cgColor
        view.layer.shadowOpacity = dark ? 0.06 : 0.10
        view.layer.shadowRadius = dark ? 0 : 15
        view.layer.shadowOffset = CGSize(width: 0, height: dark ? -0.5 : -10)
        view.accessibilityViewIsModal = true
        view.accessibilityIdentifier = "native-change-sheet"

        scroll.alwaysBounceVertical = false
        scroll.showsVerticalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        view.addSubview(scroll)

        // 标题用宋（网页 .sz-sheet__title：--song 22 / 30，500）
        titleLabel.font = NativeType.song(size: type.value("fs22"), weight: .medium)
        titleLabel.textColor = ink1
        titleLabel.text = tr("X-JUDGE.changeTitle", ["char": model.char])
        titleLabel.numberOfLines = 0
        titleLabel.accessibilityTraits = [.header]
        titleLabel.accessibilityIdentifier = "native-change-title"

        configureText(cancelButton, title: tr("X-JUDGE.changeCancel"), color: ink2, id: "native-change-cancel")
        cancelButton.contentEdgeInsets = UIEdgeInsets(top: 0, left: 12, bottom: 0, right: 12)
        cancelButton.addAction(UIAction { [weak self] _ in self?.close() }, for: .touchUpInside)

        for card in [mineCard, refCard] {
            card.backgroundColor = style.color("sheet", .systemBackground)
            card.layer.borderWidth = 1
            card.layer.borderColor = style.color("frame", .separator).cgColor
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
        var emptyText: String?
        if model.paper {
            emptyText = tr("X-JUDGE.paperMineBox")
            mineCard.accessibilityLabel = emptyText
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
            emptyText = tr("R-D07.noInkLarge")
            mineCard.accessibilityLabel = emptyText
        }
        if let emptyText {
            // 网页 .sz-compare__empty：虚线格框、无笺底，字 13 ink3 居中
            mineCard.backgroundColor = .clear
            mineCard.layer.borderWidth = 0
            dashed.strokeColor = style.color("frame", .separator).cgColor
            dashed.fillColor = UIColor.clear.cgColor
            dashed.lineWidth = 1
            dashed.lineDashPattern = [4, 3]
            mineCard.layer.addSublayer(dashed)
            NativeType.set(mineEmpty, emptyText, font: type.font("fs13"), color: ink3, align: .center)
        }
        mineEmpty.numberOfLines = 0
        mineEmpty.isHidden = emptyText == nil
        mineEmpty.accessibilityIdentifier = "native-change-noink"
        mineCard.addSubview(mineEmpty)

        for (l, key) in [(mineLabel, "R-W09.labelMine"), (refLabel, "R-W09.labelReference")] {
            NativeType.set(l, tr(key), font: type.font("fs13"), color: ink3, align: .center)
            l.isAccessibilityElement = false // 旁注只留视觉，读屏名称在两张卡上
        }

        noteLabel.numberOfLines = 0
        noteLabel.accessibilityIdentifier = "native-change-note"

        configureText(detailButton, title: tr("X-DETAIL.viewChar"), color: ink2, id: "native-change-detail")
        detailButton.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
        detailButton.accessibilityLabel = tr("X-DETAIL.viewChar").replacingOccurrences(of: "\u{203A}", with: "").trimmingCharacters(in: .whitespaces)
        detailButton.addAction(UIAction { [weak self] _ in self?.viewChar() }, for: .touchUpInside)
        detailButton.isHidden = model.char.isEmpty

        configurePrimary(flipButton, title: "", id: "native-change-flip")
        configurePrimary(failRetry, title: tr("R-W10.retry"), id: "native-change-retry")
        configureText(failCancel, title: tr("R-W10.cancel"), color: ink2, id: "native-change-fail-cancel")
        failCancel.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
        flipButton.addAction(UIAction { [weak self] _ in self?.apply() }, for: .touchUpInside)
        failRetry.addAction(UIAction { [weak self] _ in self?.apply() }, for: .touchUpInside)
        failCancel.addAction(UIAction { [weak self] _ in self?.close() }, for: .touchUpInside)

        [titleLabel, cancelButton, mineCard, refCard, mineLabel, refLabel, noteLabel, detailButton, flipButton, failCancel, failRetry].forEach { scroll.addSubview($0) }

        // 下滑关闭（网页 Sheet.js createSheetDrag：内容在顶部、向下为主才接管；跟手，松手按阈值关或回弹）
        pan.delegate = self
        pan.addTarget(self, action: #selector(panned(_:)))
        view.addGestureRecognizer(pan)
        render()
    }

    private func configureText(_ b: UIButton, title: String, color: UIColor, id: String) {
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = type.font("fs15")
        b.setTitleColor(color, for: .normal)
        b.setTitleColor(style.color("ink4", .tertiaryLabel), for: .disabled)
        b.accessibilityIdentifier = id
    }

    private func configurePrimary(_ b: UIButton, title: String, id: String) {
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = type.font("fs17", weight: .medium)
        b.backgroundColor = style.color("btn-bg", style.color("ink1", .label))
        b.setTitleColor(style.color("btn-fg", style.color("paper", .systemBackground)), for: .normal)
        b.layer.cornerRadius = 12
        b.layer.cornerCurve = .continuous
        b.accessibilityIdentifier = id
    }

    /// 主按钮文字 / 说明 / 失败三段式（就地换，不开第二层）。
    private func render() {
        flipButton.setTitle(tr(model.judgment == "correct" ? "X-JUDGE.changeToWrong" : "X-JUDGE.changeToCorrect"), for: .normal)
        let note = failed ? tr("R-W10.changeFailed") : tr(model.judgment == "correct" ? "R-W10.changeBodyCorrect" : "R-W10.changeBodyWrong")
        NativeType.set(noteLabel, note, font: type.font("fs13"), color: style.color("ink3", .secondaryLabel), align: .center, line: type.line("lh13"))
        flipButton.isHidden = failed
        failCancel.isHidden = !failed
        failRetry.isHidden = !failed
        view.setNeedsLayout()
        if let c = presentationController?.containerView { c.setNeedsLayout() }
    }

    /// 内容总高（含上下内边距）；layout = true 时同时排好各控件。
    @discardableResult
    private func layoutContent(width w: CGFloat, safeBottom: CGFloat, layout: Bool) -> CGFloat {
        let gutter: CGFloat = 20, gap: CGFloat = 16
        let inner = w - 2 * gutter
        var y: CGFloat = 24
        // 标题行：标题右侧给「取消」留 64（网页 .sz-change .sz-sheet__title padding-right）
        let lh22 = type.line("lh22")
        let titleH = NativeType.height(titleLabel, width: inner - 64, line: lh22)
        let headH = max(lh22, titleH)
        let cancelW = NativeType.width(cancelButton.titleLabel ?? UILabel()) + 24
        if layout {
            titleLabel.frame = CGRect(x: gutter, y: y, width: inner - 64, height: titleH)
            // 「取消」：距弹层顶 18、右缘外伸 4（文字右缘对齐页边）
            cancelButton.frame = CGRect(x: w - 8 - cancelW, y: 18, width: cancelW, height: 44)
        }
        y += headH + gap
        let card = floor((inner - 12) / 2)
        let labH = type.line("lh15")
        if layout {
            mineCard.frame = CGRect(x: gutter, y: y, width: card, height: card)
            refCard.frame = CGRect(x: gutter + card + 12, y: y, width: card, height: card)
            inkView?.frame = mineCard.bounds
            refGlyph.frame = refCard.bounds
            mineEmpty.frame = mineCard.bounds.insetBy(dx: 8, dy: 8)
            dashed.path = UIBezierPath(rect: mineCard.bounds.insetBy(dx: 0.5, dy: 0.5)).cgPath
            mineLabel.frame = CGRect(x: gutter, y: y + card + 12, width: card, height: labH)
            refLabel.frame = CGRect(x: gutter + card + 12, y: y + card + 12, width: card, height: labH)
        }
        y += card + 12 + labH + gap
        let noteH = NativeType.height(noteLabel, width: inner, line: type.line("lh13"))
        if layout { noteLabel.frame = CGRect(x: gutter, y: y, width: inner, height: noteH) }
        y += noteH + gap
        if !detailButton.isHidden {
            if layout {
                let dw = NativeType.width(detailButton.titleLabel ?? UILabel()) + 8
                detailButton.frame = CGRect(x: gutter - 4, y: y, width: dw, height: 44)
            }
            y += 44 + gap
        }
        let btnH = type.value("btn-h")
        if layout {
            flipButton.frame = CGRect(x: gutter, y: y, width: inner, height: btnH)
            let half = floor((inner - 12) / 2)
            let fw = NativeType.width(failCancel.titleLabel ?? UILabel()) + 8
            failCancel.frame = CGRect(x: gutter + (half - fw) / 2, y: y + (btnH - 44) / 2, width: fw, height: 44)
            failRetry.frame = CGRect(x: gutter + half + 12, y: y, width: half, height: btnH)
        }
        y += btnH + max(32, safeBottom)
        return y
    }

    func preferredHeight(width: CGFloat, safeBottom: CGFloat) -> CGFloat {
        loadViewIfNeeded()
        return layoutContent(width: width, safeBottom: safeBottom, layout: false)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        scroll.frame = view.bounds
        let safeBottom = presentationController?.containerView?.safeAreaInsets.bottom ?? view.safeAreaInsets.bottom
        let h = layoutContent(width: view.bounds.width, safeBottom: safeBottom, layout: true)
        scroll.contentSize = CGSize(width: view.bounds.width, height: h)
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
    var detailTitleForTesting: String? { detailButton.isHidden ? nil : detailButton.title(for: .normal) }

    // MARK: 下滑关闭

    func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        guard g === pan else { return true }
        let v = pan.velocity(in: view)
        return v.y > 0 && v.y > abs(v.x) && scroll.contentOffset.y <= 0
    }

    @objc private func panned(_ g: UIPanGestureRecognizer) {
        let dy = max(0, g.translation(in: view).y)
        let h = max(1, view.bounds.height)
        let scrim = (presentationController as? NativeSheetPresentation)?.scrim
        let follow = !reduceMotion
        switch g.state {
        case .changed:
            guard follow else { return }
            view.transform = CGAffineTransform(translationX: 0, y: dy)
            scrim?.alpha = max(0, 1 - dy / h)
        case .ended, .cancelled:
            let v = g.velocity(in: view).y
            let commit = g.state == .ended && (v > style.overlay.commitVelocity || (dy > h * style.overlay.commitRatio && v > style.overlay.returnVelocity))
            if commit {
                close()
            } else if follow {
                NativeOverlaySpec.run(style.overlay.snap, NativeOverlaySpec.curve(style.overlay.easeOut, fallback: .easeOut), {
                    self.view.transform = .identity
                    scrim?.alpha = 1
                })
            }
        default:
            break
        }
    }

    // MARK: 动作

    private func close(then: (() -> Void)? = nil) {
        guard presentingViewController != nil, !isBeingDismissed else { return }
        dismiss(animated: then == nil, completion: then)
    }

    /// 「看这个字 ›」（D66 ⑮；网页 ViewCharLink：先关弹层再推入详情，详情返回回到写字页）。
    private func viewChar() {
        let char = model.char
        let go = onViewChar
        close { go?(char) }
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
