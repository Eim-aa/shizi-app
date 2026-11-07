import UIKit

// ShiziKit（B3.1）：弹层 / 确认框的时刻、缓动与底部弹层的呈现（原在 NativeJudge.swift）。

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

// MARK: 弹层 / 确认框的时刻（R9-B）

/// open 回包 motion.overlay（交互规范 T0：T-sheet 进 280 ease.out / 退 220 ease.in，遮罩 200 / 180；T-confirm 进 200 由 0.96 放大淡入 / 退 180 淡出；
/// 减少动态效果一律 reduce 淡化）与下滑关闭阈值（gesture，与网页 createSheetDrag 同一组）。缺项：时长 0（不做动画），阈值取左缘返回同一组常量。
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

/// 弹层自己说要多高（B3.5c：不再只认改判弹层；选择弹层也走这个）。
protocol NativeSheetSizing: AnyObject {
    func preferredHeight(width: CGFloat, safeBottom: CGFloat) -> CGFloat
}

/// 底部弹层的呈现（网页：满宽贴底、上两角 24、max-height 88%、遮罩 --scrim；点遮罩 = 关）。
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
        let want = (presentedViewController as? NativeSheetSizing)?.preferredHeight(width: c.bounds.width, safeBottom: c.safeAreaInsets.bottom) ?? c.bounds.height / 2
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
    let fadeExit: Bool

    init(presenting: Bool, spec: NativeOverlaySpec, reduce: Bool, fadeExit: Bool = false) {
        self.presenting = presenting
        self.spec = spec
        self.reduce = reduce
        self.fadeExit = fadeExit
    }

    /// 左缘提交后按 T-fade 原位退场；普通点击 / 下滑仍用 T-sheet。
    private var fadeDuration: TimeInterval {
        (((ShiziTokens.motion["duration"] as? [String: Any])?["fade"] as? NSNumber)?.doubleValue ?? 0) / 1000
    }

    func transitionDuration(using ctx: UIViewControllerContextTransitioning?) -> TimeInterval {
        if !presenting, fadeExit { return reduce ? spec.reduce : fadeDuration }
        return reduce ? spec.reduce : (presenting ? max(spec.sheetIn, spec.scrimIn) : max(spec.sheetOut, spec.scrimOut))
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
            if reduce || fadeExit {
                let duration = reduce ? spec.reduce : fadeDuration
                NativeOverlaySpec.run(duration, linear, { v.alpha = 0 }, done: finish)
                NativeOverlaySpec.run(duration, linear, { scrim?.alpha = 0 }, done: finish)
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

/// 浮起的面（弹层 / 确认框，网页 --elev-shadow）的影子与上沿线，全 App 一处。
/// 网页：浅色 `0 -0.5px 0 墨 10%, 0 -10px 30px 墨 10%`，深色 `0 -0.5px 0 rgba(255,240,220,.06)`——第一段是一条贴着上沿（顺着圆角）的 0.5pt 发丝线。
/// 原生：模糊的那段用图层影子（只浅色），发丝线用 ShiziElevEdgeView 画在面的上沿外面（QA-H2 逐屏对比按线比它）。
enum ShiziElev {
    static let edgeTag = 0x5E1E
    static func apply(_ v: UIView, dark: Bool) {
        v.layer.shadowColor = UIColor(red: 38 / 255, green: 33 / 255, blue: 29 / 255, alpha: 1).cgColor
        v.layer.shadowOpacity = dark ? 0 : 0.10
        v.layer.shadowRadius = 15
        v.layer.shadowOffset = CGSize(width: 0, height: -10)
        let edge = (v.viewWithTag(edgeTag) as? ShiziElevEdgeView) ?? {
            let e = ShiziElevEdgeView()
            e.tag = edgeTag
            v.addSubview(e)
            return e
        }()
        edge.color = dark ? UIColor(red: 1, green: 240 / 255, blue: 220 / 255, alpha: 0.06) : UIColor(red: 38 / 255, green: 33 / 255, blue: 29 / 255, alpha: 0.10)
        edge.radius = v.layer.cornerRadius
        edge.frame = CGRect(x: 0, y: -edge.hair, width: v.bounds.width, height: edge.radius + edge.hair)
        edge.autoresizingMask = [.flexibleWidth]
        edge.setNeedsDisplay()
    }
}

/// 面的上沿发丝线：沿上沿与两个上圆角描一条 0.5pt（取整到设备像素）的线，画在面的外面紧贴上沿。
final class ShiziElevEdgeView: UIView, ShiziDrawnLines {
    var color: UIColor = .clear
    var radius: CGFloat = 0
    let hair: CGFloat = max(1, floor(0.5 * UIScreen.main.scale)) / UIScreen.main.scale

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        isUserInteractionEnabled = false
        isAccessibilityElement = false
        contentMode = .redraw
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        setNeedsDisplay()
    }

    override func draw(_ rect: CGRect) {
        let r = min(radius, bounds.width / 2)
        let y = hair / 2
        let p = UIBezierPath()
        p.move(to: CGPoint(x: 0, y: y + r))
        p.addArc(withCenter: CGPoint(x: r, y: y + r), radius: r, startAngle: .pi, endAngle: 1.5 * .pi, clockwise: true)
        p.addLine(to: CGPoint(x: bounds.width - r, y: y))
        p.addArc(withCenter: CGPoint(x: bounds.width - r, y: y + r), radius: r, startAngle: 1.5 * .pi, endAngle: 0, clockwise: true)
        p.lineWidth = hair
        color.setStroke()
        p.stroke()
    }

    /// 取证：上沿那一条（网页 box-shadow 细条同样按整条上沿量）
    var drawnLines: [(CGRect, UIColor)] { [(CGRect(x: 0, y: 0, width: bounds.width, height: hair), color)] }
}
