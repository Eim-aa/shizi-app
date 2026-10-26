import UIKit

// B3.7：字详情记录格的放大弹层（网页 records.js ZoomSheet：标题 = 「M月D日 · 写对 / 写错」、右上「完成」、本人墨一格（没有墨 = 「这一次没有留下笔迹」）、说明、改判主按钮）。
// 与改判弹层（ShiziChangeSheet）同一套呈现与手势：满宽贴底、上两角 24、遮罩 scrim、点遮罩 / 下滑 / 两指 Z 形 = 完成；
// 呈现与转场用本文件自己的 DetailSheetPresentation / DetailSheetAnimator（NativeSheetPresentation 只认改判弹层来量高度，是共享件，这里不改它）。
// 改判走 App API detail.correct（commitCorrectRecord：同一条记录只改 judgment；再点一次改回去，没有撤销条）；成功或 stale 关弹层，失败就地三段式（说明换「没改成，还是原来的结果。」+ [先不改 | 再试一次]）。

final class DetailSheetPresentation: UIPresentationController {
    let scrim = UIView()
    var onScrimTap: (() -> Void)?

    init(presented: UIViewController, presenting: UIViewController?, scrimColor: UIColor) {
        super.init(presentedViewController: presented, presenting: presenting)
        scrim.backgroundColor = scrimColor
        scrim.isAccessibilityElement = false
        scrim.accessibilityIdentifier = "native-detail-zoom-scrim"
        scrim.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapScrim)))
    }

    @objc private func tapScrim() { onScrimTap?() }

    override var frameOfPresentedViewInContainerView: CGRect {
        guard let c = containerView else { return .zero }
        let want = (presentedViewController as? DetailZoomSheet)?.preferredHeight(width: c.bounds.width, safeBottom: c.safeAreaInsets.bottom) ?? c.bounds.height / 2
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

/// T-sheet（与 NativeSheetAnimator 同一组时长与曲线）。
final class DetailSheetAnimator: NSObject, UIViewControllerAnimatedTransitioning {
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
        let scrim = (vc.presentationController as? DetailSheetPresentation)?.scrim
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
        } else if reduce {
            NativeOverlaySpec.run(spec.reduce, linear, { v.alpha = 0 }, done: finish)
            NativeOverlaySpec.run(spec.reduce, linear, { scrim?.alpha = 0 }, done: finish)
        } else {
            let start = v.frame.offsetBy(dx: 0, dy: v.transform.ty)
            v.transform = .identity
            v.frame = start
            let end = CGRect(x: start.minX, y: ctx.containerView.bounds.height, width: start.width, height: start.height)
            NativeOverlaySpec.run(spec.sheetOut, NativeOverlaySpec.curve(spec.easeIn, fallback: .easeIn), { v.frame = end }, done: finish)
            NativeOverlaySpec.run(spec.scrimOut, NativeOverlaySpec.curve(spec.easeIn, fallback: .easeIn), { scrim?.alpha = 0 }, done: finish)
        }
    }
}

final class DetailZoomSheet: UIViewController, UIViewControllerTransitioningDelegate, UIGestureRecognizerDelegate {
    let recordId: String
    let judgment: String
    let strokes: [[InkRawPoint]]
    let titleText: String
    let changeable: Bool
    private weak var screen: DetailScreen?
    private let metrics: ShiziMetrics
    private let overlay = NativeOverlaySpec(motion: ShiziTokens.pageMotion(.write))
    private(set) var failed = false
    private var busy = false
    /// 正在退场（close() 已调用、退场动画还没走完）。原生有呈现状态：退场没结束时页面上的点按会被「弹层还在」挡住，
    /// 网页版是 DOM 叠层（关掉就能立刻再开），所以这里给页面一个「等它退完再开下一张」的钩子。
    private(set) var isClosing = false
    /// 退场完成时叫一次（页面等它退完再开下一张放大弹层）。
    var onDismissed: (() -> Void)?

    private let scroll = UIScrollView()
    private let titleLabel = UILabel()
    private let doneButton = NativeTextButton(type: .custom)
    private let card = DetailSquare()
    private var inkView: UIView?
    private let emptyBox = UIView()
    private let emptyLabel = UILabel()
    private let dashed = CAShapeLayer()
    private let note = UILabel()
    private let flip = UIButton(type: .custom)
    private let failWrap = UIView()
    private let failCancel = NativeTextButton(type: .custom)
    private let failRetry = UIButton(type: .custom)
    private let pan = UIPanGestureRecognizer()
    private let edge = UIScreenEdgePanGestureRecognizer()
    private var exitsFromEdge = false
    private lazy var haptic = UIImpactFeedbackGenerator(style: .soft)
    private var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled || ShiziProbe.forceReduceMotion }

    init(recordId: String, judgment: String, strokes: [[InkRawPoint]], title: String, changeable: Bool, metrics: ShiziMetrics, screen: DetailScreen) {
        self.recordId = recordId
        self.judgment = judgment
        self.strokes = strokes
        self.titleText = title
        self.changeable = changeable
        self.metrics = metrics
        self.screen = screen
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .custom
        transitioningDelegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func color(_ n: String) -> UIColor { ShiziTokens.dynamicColor(n) ?? .label }
    private func t(_ k: String, _ v: [String: CustomStringConvertible] = [:]) -> String { ShiziCopy.t(k, v) }

    // MARK: 呈现

    func presentationController(forPresented presented: UIViewController, presenting: UIViewController?, source: UIViewController) -> UIPresentationController? {
        let p = DetailSheetPresentation(presented: presented, presenting: presenting, scrimColor: color("scrim"))
        p.onScrimTap = { [weak self] in self?.close() }
        return p
    }

    func animationController(forPresented presented: UIViewController, presenting: UIViewController, source: UIViewController) -> UIViewControllerAnimatedTransitioning? {
        DetailSheetAnimator(presenting: true, spec: overlay, reduce: reduceMotion)
    }

    func animationController(forDismissed dismissed: UIViewController) -> UIViewControllerAnimatedTransitioning? {
        DetailSheetAnimator(presenting: false, spec: overlay, reduce: reduceMotion || exitsFromEdge)
    }

    // MARK: 视图

    override func viewDidLoad() {
        super.viewDidLoad()
        let mt = metrics
        view.backgroundColor = color("elev")
        view.layer.cornerRadius = mt.value("r-box")
        view.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        view.layer.cornerCurve = .continuous
        let dark = traitCollection.userInterfaceStyle == .dark
        view.layer.shadowColor = (dark ? UIColor(red: 1, green: 240 / 255, blue: 220 / 255, alpha: 1) : UIColor(red: 38 / 255, green: 33 / 255, blue: 29 / 255, alpha: 1)).cgColor
        view.layer.shadowOpacity = dark ? 0.06 : 0.10
        view.layer.shadowRadius = dark ? 0 : 15
        view.layer.shadowOffset = CGSize(width: 0, height: dark ? -0.5 : -10)
        view.accessibilityViewIsModal = true
        view.accessibilityIdentifier = "native-detail-zoom"
        scroll.alwaysBounceVertical = false
        scroll.showsVerticalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        // 同页面的滚动区（ShiziScreen）：按钮不等滚动手势判定就收到点按（这里有下滑关闭 + 左缘两个手势，
        // 延迟点按会让「再试一次」看着像没反应）
        scroll.delaysContentTouches = false
        view.addSubview(scroll)

        let song = NativeType.song(size: mt.value("fs22"), weight: .medium)
        titleLabel.numberOfLines = 0
        titleLabel.attributedText = NSAttributedString(string: titleText, attributes: [.font: song, .foregroundColor: color("ink1")])
        NativeResultViewController.fixLineBox(titleLabel, line: mt.line("lh22"))
        titleLabel.accessibilityTraits = [.header]
        titleLabel.accessibilityIdentifier = "native-detail-zoom-title"

        doneButton.setTitle(t("X-COMMON.done"), for: .normal)
        doneButton.titleLabel?.font = mt.font(15)
        doneButton.setTitleColor(color("ink2"), for: .normal)
        doneButton.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
        doneButton.accessibilityIdentifier = "native-detail-zoom-close"
        doneButton.addAction(UIAction { [weak self] _ in self?.close() }, for: .touchUpInside)

        card.configure(sheet: color("sheet"), frame: color("frame"), borderWidth: mt.value("frame-w"))
        card.accessibilityIdentifier = "native-detail-zoom-ink"
        card.isAccessibilityElement = true
        card.accessibilityLabel = titleText
        card.accessibilityTraits = [.image]

        let hasInk = strokes.contains { !$0.isEmpty }
        if hasInk {
            card.isHidden = false
        } else {
            card.isHidden = true
            dashed.strokeColor = color("frame").cgColor
            dashed.fillColor = UIColor.clear.cgColor
            dashed.lineWidth = 1
            dashed.lineDashPattern = [4, 3]
            emptyBox.layer.addSublayer(dashed)
            emptyBox.isAccessibilityElement = false
            emptyLabel.numberOfLines = 0
            emptyLabel.accessibilityIdentifier = "native-detail-zoom-noink"
            NativeType.set(emptyLabel, t("R-D07.noInkLarge"), font: mt.font(13), color: color("ink3"), align: .center, line: mt.line("lh13"))
            emptyBox.addSubview(emptyLabel)
        }

        note.numberOfLines = 0
        note.accessibilityIdentifier = "native-detail-zoom-note"
        note.accessibilityTraits = [.updatesFrequently]

        styleButton(flip, id: "native-detail-zoom-flip")
        styleButton(failRetry, id: "native-detail-zoom-fail-retry")
        failRetry.setTitle(t("R-W10.retry"), for: .normal)
        failCancel.setTitle(t("R-W10.cancel"), for: .normal)
        failCancel.titleLabel?.font = mt.font(15)
        failCancel.setTitleColor(color("ink2"), for: .normal)
        failCancel.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
        failCancel.accessibilityIdentifier = "native-detail-zoom-fail-cancel"
        failWrap.accessibilityIdentifier = "native-detail-zoom-fail"
        failWrap.isUserInteractionEnabled = false
        flip.addAction(UIAction { [weak self] _ in self?.apply() }, for: .touchUpInside)
        failRetry.addAction(UIAction { [weak self] _ in self?.apply() }, for: .touchUpInside)
        failCancel.addAction(UIAction { [weak self] _ in self?.close() }, for: .touchUpInside)

        [titleLabel, doneButton, card, emptyBox, note, flip, failWrap, failCancel, failRetry].forEach { scroll.addSubview($0) }
        pan.delegate = self
        pan.addTarget(self, action: #selector(panned(_:)))
        view.addGestureRecognizer(pan)
        edge.edges = .left
        edge.delegate = self
        edge.addTarget(self, action: #selector(edgePanned(_:)))
        pan.require(toFail: edge)
        scroll.panGestureRecognizer.require(toFail: edge)
        render()
    }

    private func styleButton(_ b: UIButton, id: String) {
        let mt = metrics
        b.titleLabel?.font = mt.font(17, .medium)
        b.titleLabel?.numberOfLines = 0
        b.titleLabel?.textAlignment = .center
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 24, bottom: 0, right: 24)
        b.backgroundColor = color("btn-bg")
        b.setTitleColor(color("btn-fg"), for: .normal)
        b.layer.cornerRadius = mt.value("r-ctl")
        b.layer.cornerCurve = .continuous
        b.accessibilityIdentifier = id
    }

    private func render() {
        let mt = metrics
        flip.setTitle(t(judgment == "correct" ? "X-JUDGE.changeToWrong" : "X-JUDGE.changeToCorrect"), for: .normal)
        NativeType.trackTitle(flip)
        NativeType.trackTitle(failRetry)
        NativeType.trackTitle(failCancel)
        NativeType.trackTitle(doneButton)
        if changeable {
            NativeType.set(note, failed ? t("R-W10.changeFailed") : t("R-R02.sheetNoteChange"), font: mt.font(13), color: color("ink3"), align: .center, line: mt.line("lh13"))
        } else {
            note.text = nil
        }
        note.isHidden = !changeable
        flip.isHidden = failed || !changeable
        failCancel.isHidden = !failed || !changeable
        failRetry.isHidden = !failed || !changeable
        failWrap.isHidden = !failed || !changeable
        view.setNeedsLayout()
        presentationController?.containerView?.setNeedsLayout()
    }

    private func layoutContent(width w: CGFloat, safeBottom: CGFloat, layout: Bool) -> CGFloat {
        let mt = metrics
        let gutter = mt.gutter, gap = mt.space(4)
        let inner = w - 2 * gutter
        var y = mt.space(6)
        // 标题行：标题 + 右端「完成」（44 高，右缘外伸 4）
        let lh22 = mt.line("lh22")
        let doneW = NativeType.titleWidth(doneButton) + 8
        let doneH = max(mt.hit, 44)
        let titleW = inner - gap - doneW + 4
        let titleH = NativeType.height(titleLabel, width: titleW, line: lh22)
        let headH = max(doneH, titleH)
        if layout {
            titleLabel.frame = CGRect(x: gutter, y: y + (headH - titleH) / 2, width: titleW, height: titleH)
            doneButton.frame = CGRect(x: w - gutter + 4 - doneW, y: y + (headH - doneH) / 2, width: doneW, height: doneH)
        }
        y += headH + gap
        // 本人墨一格（最大 300，居中）
        let side = min(300, inner)
        if layout {
            let f = CGRect(x: (w - side) / 2, y: y, width: side, height: side)
            card.frame = f
            emptyBox.frame = f
            emptyLabel.frame = emptyBox.bounds.insetBy(dx: 8, dy: 8)
            dashed.path = UIBezierPath(rect: emptyBox.bounds.insetBy(dx: 0.5, dy: 0.5)).cgPath
            if inkView == nil, strokes.contains(where: { !$0.isEmpty }) {
                let b = mt.value("frame-w")
                if let v = NativeInkPaint.view(strokes: strokes, side: side - 2 * b, color: detailInkColor(traitCollection), widthScale: detailInkScale(side - 2 * b)) {
                    card.addSubview(v)
                    card.ink = v
                    inkView = v
                }
            }
            card.setNeedsLayout()
        }
        y += side
        guard changeable else { return y + max(mt.space(8), safeBottom) }
        y += gap
        let nh = NativeType.height(note, width: inner, line: mt.line("lh13"))
        if layout { note.frame = CGRect(x: gutter, y: y, width: inner, height: nh) }
        y += nh + gap
        let btnH = mt.value("btn-h")
        if layout {
            flip.frame = CGRect(x: gutter, y: y, width: inner, height: btnH)
            let half = floor((inner - 12) / 2)
            let fw = NativeType.titleWidth(failCancel) + 8
            failCancel.frame = CGRect(x: gutter + (half - fw) / 2, y: y, width: fw, height: 44)
            failRetry.frame = CGRect(x: gutter + half + 12, y: y, width: half + (inner - 12 - 2 * half), height: btnH)
            failWrap.frame = CGRect(x: gutter, y: y, width: inner, height: btnH)
        }
        return y + btnH + max(mt.space(8), safeBottom)
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
        presentationController?.containerView?.addGestureRecognizer(edge)
        NativeA11y.screenChanged(titleLabel)
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        edge.view?.removeGestureRecognizer(edge)
        // 退场完成：页面等这一下再开下一张放大弹层（否则关掉弹层后立刻点记录格，点按会被「弹层还在」吞掉）
        if isBeingDismissed || isMovingFromParent { fireDismissed() }
    }

    override func accessibilityPerformEscape() -> Bool {
        close()
        return true
    }

    // MARK: 下滑关闭

    func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        if g === edge { return !isBeingDismissed && !isBeingPresented }
        guard g === pan else { return true }
        let v = pan.velocity(in: view)
        return v.y > 0 && v.y > abs(v.x) && scroll.contentOffset.y <= 0
    }

    /// N3-6：左缘只移动最上面的弹层；提交后从松手位置淡出，取消则回弹（同 overlay-gesture.js）。
    @objc private func edgePanned(_ g: UIScreenEdgePanGestureRecognizer) {
        guard let container = presentationController?.containerView else { return }
        let dx = max(0, g.translation(in: container).x)
        let width = max(1, container.bounds.width)
        let scrim = (presentationController as? DetailSheetPresentation)?.scrim
        switch g.state {
        case .changed:
            guard !reduceMotion else { return }
            view.transform = CGAffineTransform(translationX: dx, y: 0)
            scrim?.alpha = max(0, 1 - dx / width)
        case .ended, .cancelled:
            if g.state == .ended && BackGestureThreshold.commits(distance: dx, velocity: g.velocity(in: container).x, width: width) {
                exitsFromEdge = true
                close()
            } else if !reduceMotion {
                NativeOverlaySpec.run(overlay.snap, NativeOverlaySpec.curve(overlay.easeOut, fallback: .easeOut), {
                    self.view.transform = .identity
                    scrim?.alpha = 1
                })
            }
        default: break
        }
    }

    @objc private func panned(_ g: UIPanGestureRecognizer) {
        let dy = max(0, g.translation(in: view).y)
        let h = max(1, view.bounds.height)
        let scrim = (presentationController as? DetailSheetPresentation)?.scrim
        switch g.state {
        case .changed:
            guard !reduceMotion else { return }
            view.transform = CGAffineTransform(translationX: 0, y: dy)
            scrim?.alpha = max(0, 1 - dy / h)
        case .ended, .cancelled:
            let v = g.velocity(in: view).y
            let commit = g.state == .ended && (v > overlay.commitVelocity || (dy > h * overlay.commitRatio && v > overlay.returnVelocity))
            if commit {
                close()
            } else if !reduceMotion {
                NativeOverlaySpec.run(overlay.snap, NativeOverlaySpec.curve(overlay.easeOut, fallback: .easeOut), {
                    self.view.transform = .identity
                    scrim?.alpha = 1
                })
            }
        default:
            break
        }
    }

    // MARK: 动作

    func close() {
        guard presentingViewController != nil, !isBeingDismissed else { return }
        isClosing = true
        dismiss(animated: true) { [weak self] in self?.fireDismissed() }
    }

    /// 退场完成只叫一次（页面等它退完再开下一张放大弹层）。
    private func fireDismissed() {
        let done = onDismissed
        onDismissed = nil
        done?()
    }

    /// 主按钮 / 再试一次：始终提交打开弹层时明确显示的目标判断，重发不会反改；成功或 stale 关弹层，失败就地三段式。
    func apply() {
        guard !busy, let screen else { return }
        busy = true
        screen.correct(recordId: recordId, to: judgment == "correct" ? "wrong" : "correct") { [weak self] r in
            guard let self else { return }
            self.busy = false
            let ok = (r["ok"] as? Bool) == true
            if ok || ((r["error"] as? [String: Any])?["kind"] as? String) == "stale" {
                if ok { self.haptic.impactOccurred(intensity: 0.7) }
                self.close()
                return
            }
            self.failed = true
            screen.markStateChange()
            self.render()
            NativeA11y.announce(self.note.text)
        }
    }

    var failedForTesting: Bool { failed }
    var flipTitleForTesting: String? { flip.title(for: .normal) }
}
