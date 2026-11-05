import UIKit

// B3.11：原生图片预览弹层（L3 底部弹层）与失败提示条（L4）。
//
// 标准答案是网页的两处：（弹层）与 （提示条）。
// 版式逐项照网页（交接 §5.3）：底部弹层（满宽贴底、上两角 24、遮罩）、标题行（宋 22 / 30 + 右上「完成」）、
//   预览台（比弹层深一档的底，高 340；图是放在上面的一张笺：3:4 → 225 × 300、1:1 → 270 × 270）、
//   页点（6pt 圆点）、比例分段（3:4 / 1:1，60 × 38；AX 档竖排 56 高）、说明句（15 / 22 ink2）、「也放进来」（写错的字 + 小格，可换行）、
//   「分享」（次）/「保存图片」（主）、年报的「存成长图」、失败三段式（说明 → [先不保存 | 再试一次]）。
// 图由页面用**同一批函数**画好（image.render op；预览带 display: true 直接取画好的位图，分享取 PNG），原生只显示；文案取 ShiziCopy，颜色 / 字号 / 间距取 ShiziTokens。
// 本文件不写汉字字面量。

// MARK: - 回包形状（image.view / image.render）

struct NativeImageChip: Decodable {
    let recordId: String
    let ch: String
    let on: Bool
    let thumb: String
}

struct NativeImageAlt: Decodable {
    let label: String
    let note: String
}

struct NativeImageFailTexts: Decodable {
    let share: String
    let render: String
    let denied: String
    let save: String
}

struct NativeImageView: Decodable {
    let kind: String
    let title: String
    let ratios: [String]
    let ratio: String
    let initialRatio: String
    let pageCount: Int
    let status: String
    let note: String
    /// 说明句的折行点（网页量的：text-wrap: pretty 的折行与原生贪心折行不同，网页把每一行从第几个字开始给原生）
    let noteStarts: [Int]?
    /// 失败说明句的折行点（同上；键与 failText 一样：share / render / denied / save）
    let failStarts: [String: [Int]]?
    let boardNote: String
    let saveLabel: String
    let shareLabel: String
    let chips: [NativeImageChip]
    let alt: NativeImageAlt?
    let failText: NativeImageFailTexts
}

struct NativeImagePicture: Decodable {
    let status: String
    let dataURL: String
    let width: Int
    let height: Int
    let name: String
}

struct NativeImageRenderReply: Decodable {
    let image: NativeImagePicture
}

// MARK: - 预览板的尺寸（网页 PREVIEW_BOX：图按比例缩小后摆在台上）

enum NativeImagePreviewBox {
    static func size(_ ratio: String) -> CGSize {
        switch ratio {
        case "1:1": return CGSize(width: 270, height: 270)
        default: return CGSize(width: 225, height: 300)
        }
    }
    /// 台高：网页 .sz-img__stage min-height = 300 + 上下 40 的内边（切比例时弹层不跳）。
    static let stageMinHeight: CGFloat = 340
    /// 台里内容区的高（台高 − 上下 20 的内边）：图在这里竖向居中。
    static let stageContentHeight: CGFloat = 300
    /// 台里图板之间的间距（网页 .sz-img__scroll 的 gap）。
    static let boardGap: CGFloat = 14
}

// MARK: - 底部弹层的呈现（高度由内容算出；遮罩与转场同网页 T-sheet）

/// 底部弹层的呈现控制器（满宽贴底、上两角 24、遮罩点一下关；高度由内容算出，最多 88%）。
final class NativeImageSheetPresentation: UIPresentationController {
    let scrim = UIView()
    var onScrimTap: (() -> Void)?
    /// (宽, 下安全区) → 弹层高。
    var heightProvider: ((CGFloat, CGFloat) -> CGFloat)?

    init(presented: UIViewController, presenting: UIViewController?, scrimColor: UIColor) {
        super.init(presentedViewController: presented, presenting: presenting)
        scrim.backgroundColor = scrimColor
        scrim.isAccessibilityElement = false
        scrim.accessibilityIdentifier = "native-image-scrim"
        scrim.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapScrim)))
    }

    @objc private func tapScrim() { onScrimTap?() }

    override var frameOfPresentedViewInContainerView: CGRect {
        guard let c = containerView else { return .zero }
        let want = heightProvider?(c.bounds.width, c.safeAreaInsets.bottom) ?? (c.bounds.height / 2)
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
        guard let v = presentedView, v.transform == CGAffineTransform.identity, !presentedViewController.isBeingPresented, !presentedViewController.isBeingDismissed else { return }
        v.frame = frameOfPresentedViewInContainerView
    }

    override func dismissalTransitionDidEnd(_ completed: Bool) {
        if completed { scrim.removeFromSuperview() }
    }
}

/// T-sheet：进场自下而上 + 遮罩淡入；退场下滑 + 遮罩淡出；减少动态效果一律淡化（时刻取 motion.overlay）。
final class NativeImageSheetAnimator: NSObject, UIViewControllerAnimatedTransitioning {
    private let presenting: Bool
    private let spec: NativeOverlaySpec
    private let reduce: Bool

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
        let scrim = (vc.presentationController as? NativeImageSheetPresentation)?.scrim
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

// MARK: - 图片预览弹层

final class NativeImagePreviewController: UIViewController, UIViewControllerTransitioningDelegate, UIGestureRecognizerDelegate, UIScrollViewDelegate {
    private let engine: ShiziEngine
    /// 要生成哪张图（原生只说这个；图与文案都由页面给）。
    private let scope: [String: Any]
    /// 弹层关掉了（原生页面据此收掉这一层）。
    var onClose: (() -> Void)?

    private var model: NativeImageView?
    private var ratio: String = ""
    private var page: Int = 0
    /// 'share' | 'save' | 'long'
    private var busy: String?
    /// 'saved' | 'failed'
    private var saveState: String = ""
    /// (kind: 'save' | 'share', reason)
    private var fail: (kind: String, reason: String)?
    private var slowLoad = false
    private var slowBusy = false
    private var loadTimer: Timer?
    private var busyTimer: Timer?
    private var saveFlash: Timer?
    #if DEBUG
    // Only the saved-state screenshot proxy freezes this transient, matching the web fixture's frozen 1500ms timeout.
    private var qaHoldSaved = false
    #endif
    private var token = 0

    // 视图
    let panel = UIView()
    private let scroll = UIScrollView()
    private let content = UIView()
    private let titleLabel = UILabel()
    private let doneButton = NativeTextButton(type: .system)
    private let stage = UIView()
    private let boardScroll = UIScrollView()
    private var boards: [UIView] = []
    private var pictures: [UIImageView] = []
    private let boardNote = UILabel()
    private let pager = UIView()
    private var dots: [UIView] = []
    private let ratioBar = UIView()
    private var ratioButtons: [UIButton] = []
    private let noteLabel = UILabel()
    private let chipsRow = UIView()
    private let chipsLabel = UILabel()
    private var chipButtons: [NativeImageChipButton] = []
    private var chipCells: [UIImageView] = []
    private let shareButton = UIButton(type: .system)
    private let saveButton = UIButton(type: .system)
    private let longButton = NativeTextButton(type: .system)
    private let failBox = UIView()
    private let failNote = UILabel()
    private let failCancel = NativeTextButton(type: .system)
    private let failRetry = UIButton(type: .system)
    private let pan = UIPanGestureRecognizer()

    private var metrics = ShiziMetrics()
    private var overlaySpec = NativeOverlaySpec()

    // 排版算出来的框（每次布局重算）
    private var titleBox = CGRect.zero
    private var doneBox = CGRect.zero
    private var stageBox = CGRect.zero
    private var pagerBox = CGRect.zero
    private var ratioBox = CGRect.zero
    private var noteBox = CGRect.zero
    private var chipsBox = CGRect.zero
    private var actionsBox = CGRect.zero
    private var failBoxRect = CGRect.zero
    private var longBox = CGRect.zero
    private var boardFrames: [CGRect] = []
    private var dotRects: [CGRect] = []
    private var ratioButtonFrames: [CGRect] = []
    private var chipRects: [CGRect] = []
    private var chipCellRects: [CGRect] = []
    private var chipsLabelRect = CGRect.zero
    private var contentHeight: CGFloat = 0
    /// QA 夹具用的转发按钮（装在宿主页里；见 installQAProxies）。
    private var qaProxies: [UIButton] = []

    init(engine: ShiziEngine, scope: [String: Any]) {
        self.engine = engine
        self.scope = scope
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .custom
        transitioningDelegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    deinit {
        loadTimer?.invalidate()
        busyTimer?.invalidate()
        saveFlash?.invalidate()
        qaProxies.forEach { $0.removeFromSuperview() }
    }

    // MARK: 令牌 / 文案

    private func color(_ name: String) -> UIColor { ShiziTokens.dynamicColor(name) ?? .label }
    private func tr(_ key: String, _ vars: [String: CustomStringConvertible] = [:]) -> String { ShiziCopy.t(key, vars) }

    /// AX 档（网页 :root[data-ax]）：比例两项上下排、「也放进来」换行、分享 / 保存上下排。
    private var axLayout: Bool { metrics.category.isAccessibilityCategory }

    // MARK: 呈现

    /// 先把视图模型取回来再呈现（弹层高由内容算出：模型没到手时高度算不准）。
    @discardableResult
    func prepare() async -> Bool {
        token += 1
        let my = token
        let body = await engine.raw("image.view", ["scope": scope])
        guard my == token else { return false }
        guard (body["ok"] as? Bool) == true, let v = try? ShiziDecode.reply(body, as: ShiziViewReply<NativeImageView>.self).view else {
            ShiziProbe.log("native image preview: view failed")
            return false
        }
        model = v
        if ratio.isEmpty { ratio = v.ratio }
        buildControls()
        styleAll()
        return true
    }

    func presentationController(forPresented presented: UIViewController, presenting: UIViewController?, source: UIViewController) -> UIPresentationController? {
        let p = NativeImageSheetPresentation(presented: presented, presenting: presenting, scrimColor: color("scrim"))
        p.heightProvider = { [weak self] w, safe in self?.sheetHeight(width: w, safeBottom: safe) ?? 0 }
        p.onScrimTap = { [weak self] in self?.close() }
        return p
    }

    func animationController(forPresented presented: UIViewController, presenting: UIViewController, source: UIViewController) -> UIViewControllerAnimatedTransitioning? {
        NativeImageSheetAnimator(presenting: true, spec: overlaySpec, reduce: UIAccessibility.isReduceMotionEnabled)
    }

    func animationController(forDismissed dismissed: UIViewController) -> UIViewControllerAnimatedTransitioning? {
        NativeImageSheetAnimator(presenting: false, spec: overlaySpec, reduce: UIAccessibility.isReduceMotionEnabled)
    }

    // MARK: 视图

    /// 弹层的根视图就是弹层本体（网页 .sz-sheet）：呈现控制器把它摆在容器底部，遮罩另在容器里。
    /// 这样 QA 取证时「弹层根视图」就是有语义键的那一块（native-image-sheet），不多出一个空容器。
    override func loadView() {
        view = panel
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let dark = traitCollection.userInterfaceStyle == .dark
        panel.backgroundColor = color("elev")
        panel.layer.cornerRadius = metrics.value("r-box")
        panel.layer.cornerCurve = .continuous
        panel.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        ShiziElev.apply(panel, dark: dark) // --elev-shadow：模糊影子 + 上沿发丝线（ShiziKit ShiziElev）
        panel.accessibilityIdentifier = "native-image-sheet"

        scroll.alwaysBounceVertical = false
        scroll.showsVerticalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        panel.addSubview(scroll)

        // 标题（宋 22 / 30，500）——在弹层的头部（网页 .sz-sheet__head），不在正文容器里
        titleLabel.numberOfLines = 0
        titleLabel.accessibilityTraits = [.header]
        titleLabel.accessibilityIdentifier = "native-image-title"
        panel.addSubview(titleLabel)

        doneButton.titleLabel?.numberOfLines = 0
        doneButton.accessibilityIdentifier = "native-image-done"
        doneButton.addAction(UIAction { [weak self] _ in self?.close() }, for: .touchUpInside)
        panel.addSubview(doneButton)

        content.accessibilityIdentifier = "native-image-preview"
        scroll.addSubview(content)

        stage.backgroundColor = color("field")
        stage.accessibilityIdentifier = "native-image-stage"
        content.addSubview(stage)

        boardScroll.showsHorizontalScrollIndicator = false
        boardScroll.showsVerticalScrollIndicator = false
        boardScroll.delegate = self
        stage.addSubview(boardScroll)

        boardNote.numberOfLines = 0
        boardNote.textAlignment = .center
        boardNote.accessibilityIdentifier = "native-image-board-note"
        content.addSubview(boardNote)

        pager.accessibilityIdentifier = "native-image-pager"
        content.addSubview(pager)

        ratioBar.accessibilityIdentifier = "native-image-ratio-bar"
        ratioBar.backgroundColor = color("field")
        ratioBar.layer.cornerRadius = metrics.value("r-ctl")
        ratioBar.layer.cornerCurve = .continuous
        content.addSubview(ratioBar)

        noteLabel.numberOfLines = 0
        noteLabel.accessibilityIdentifier = "native-image-note"
        content.addSubview(noteLabel)

        chipsRow.accessibilityIdentifier = "native-image-chips"
        chipsRow.isHidden = true
        content.addSubview(chipsRow)

        chipsLabel.accessibilityIdentifier = "native-image-chips-label"
        chipsRow.addSubview(chipsLabel)

        styleButton(shareButton, id: "native-image-share", primary: false)
        styleButton(saveButton, id: "native-image-save", primary: true)
        shareButton.addAction(UIAction { [weak self] _ in self?.onShare() }, for: .touchUpInside)
        saveButton.addAction(UIAction { [weak self] _ in self?.onSave() }, for: .touchUpInside)
        content.addSubview(shareButton)
        content.addSubview(saveButton)

        longButton.titleLabel?.numberOfLines = 0
        longButton.accessibilityIdentifier = "native-image-long"
        longButton.addAction(UIAction { [weak self] _ in self?.onSaveLong() }, for: .touchUpInside)
        content.addSubview(longButton)

        failBox.accessibilityIdentifier = "native-image-fail"
        failBox.isHidden = true
        content.addSubview(failBox)
        failNote.numberOfLines = 0
        failNote.accessibilityIdentifier = "native-image-fail-note"
        failBox.addSubview(failNote)
        failCancel.titleLabel?.numberOfLines = 0
        failCancel.accessibilityIdentifier = "native-image-fail-cancel"
        failCancel.addAction(UIAction { [weak self] _ in self?.clearFail() }, for: .touchUpInside)
        failBox.addSubview(failCancel)
        styleButton(failRetry, id: "native-image-retry", primary: true)
        failRetry.addAction(UIAction { [weak self] _ in self?.onRetry() }, for: .touchUpInside)
        failBox.addSubview(failRetry)

        // 下滑关闭
        pan.delegate = self
        pan.addTarget(self, action: #selector(panned(_:)))
        panel.addGestureRecognizer(pan)

        styleAll()
        buildControls()
        styleAll()
        view.setNeedsLayout()
    }

    /// 按钮外观（网页 .sz-btn--primary / --secondary：主 = 墨底纸字；次 = 透明底 + 1pt ink4 细边；禁用 = field 底 + ink4 字）。
    private func styleButton(_ b: UIButton, id: String, primary: Bool) {
        b.titleLabel?.numberOfLines = 0
        b.titleLabel?.textAlignment = .center
        b.accessibilityIdentifier = id
        b.layer.cornerRadius = metrics.value("r-ctl")
        b.layer.cornerCurve = .continuous
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 24, bottom: 0, right: 24)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let w = view.bounds.width
        guard w > 0 else { return }
        let safeBottom = presentationController?.containerView?.safeAreaInsets.bottom ?? view.safeAreaInsets.bottom
        layoutContent(width: w, safeBottom: safeBottom)
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        if previous?.preferredContentSizeCategory != traitCollection.preferredContentSizeCategory {
            metrics = ShiziMetrics(UIApplication.shared.preferredContentSizeCategory)
        }
        if previous?.preferredContentSizeCategory != traitCollection.preferredContentSizeCategory
            || previous?.userInterfaceStyle != traitCollection.userInterfaceStyle {
            styleAll()
            buildControls()
            view.setNeedsLayout()
            presentationController?.containerView?.setNeedsLayout()
        }
    }

    // MARK: 排版（网页 .sz-sheet + .sz-img 的同一套盒模型）

    /// 弹层高（网页 .sz-sheet：上内边 24 + 标题行 + 间距 16 + 正文 + 下内边 max(32, 安全区)；最多 88%）。
    private func sheetHeight(width w: CGFloat, safeBottom: CGFloat) -> CGFloat {
        let h = contentHeightFor(width: w, safeBottom: safeBottom)
        return min(h, floor((presentationController?.containerView?.bounds.height ?? UIScreen.main.bounds.height) * 0.88))
    }

    /// 正文（.sz-img）高：各块之和 + 块间 16。
    private func bodyHeight(contentW: CGFloat) -> CGFloat {
        var h: CGFloat = 0
        var first = true
        func add(_ v: CGFloat) {
            if !first { h += metrics.space(4) }
            first = false
            h += v
        }
        add(NativeImagePreviewBox.stageMinHeight)
        if (model?.pageCount ?? 0) > 1 { add(6) }
        if (model?.ratios.count ?? 0) > 1 { add(ratioBarHeight()) }
        if !(model?.note ?? "").isEmpty { add(noteHeight(contentW: contentW)) }
        if !(model?.chips.isEmpty ?? true) { add(chipsHeight(contentW: contentW)) }
        if fail != nil { add(failHeight(contentW: contentW)) } else { add(actionsHeight()) }
        if model?.alt != nil { add(longHeight()) }
        return h
    }

    private func contentHeightFor(width w: CGFloat, safeBottom: CGFloat) -> CGFloat {
        let m = metrics
        let contentW = w - 2 * m.gutter
        var h = m.space(6)
        h += headHeight(contentW: contentW)
        h += m.space(4)
        h += bodyHeight(contentW: contentW)
        h += max(m.space(8), safeBottom)
        return h
    }

    /// 标题行高（网页 .sz-sheet__head：标题与「完成」并排，取高的那个）。
    private func headHeight(contentW: CGFloat) -> CGFloat {
        max(titleHeight(contentW: contentW), doneHeight())
    }

    /// 标题盒高（宋 lh22 × 行数）。
    private func titleHeight(contentW: CGFloat) -> CGFloat {
        let doneW = doneWidth()
        let w = max(1, contentW - 8 - doneW)
        return NativeType.height(titleLabel, width: w, line: metrics.line("lh22"))
    }

    /// 「完成」（网页 .sz-btn--text：min-height 44；AX 档 max(44, 1.3em + 12)）。
    private func doneHeight() -> CGFloat {
        let m = metrics
        if axLayout { return max(m.value("hit"), 1.3 * m.value("fs15") + 12) }
        return m.value("hit")
    }

    /// 「完成」盒宽（字宽 + 左右 4 的内边；网页 .sz-btn--text padding 0 var(--bx)）。
    private func doneWidth() -> CGFloat {
        ceil(NativeType.titleWidth(doneButton)) + 8
    }

    /// 比例分段的高（网页 .sz-img__ratio：内边 3 + 按钮 38；AX 档竖排、每项 56）。
    private func ratioBarHeight() -> CGFloat {
        if axLayout { return 6 + ratioButtonHeight() * CGFloat(max(1, model?.ratios.count ?? 1)) }
        return 6 + 38
    }

    /// AX 档比例按钮的高（网页 :root[data-ax] .sz-img__ratio button{min-height:56px;height:auto}）。
    private func ratioButtonHeight() -> CGFloat {
        max(56, metrics.line("lh15"))
    }

    private func noteHeight(contentW: CGFloat) -> CGFloat {
        NativeType.height(noteLabel, width: contentW, line: metrics.line("lh15"))
    }

    /// 「也放进来」的高（网页 flex-wrap：行高取行里最高的；行距 12）。
    private func chipsHeight(contentW: CGFloat) -> CGFloat {
        let rows = chipRows(contentW: contentW)
        return rows.reduce(CGFloat(0)) { $0 + $1.height } + CGFloat(max(0, rows.count - 1)) * metrics.space(3)
    }

    /// chip 的高（网页 .sz-img__chip：min-height 44；内容 = 小格 32 / 文字行高，再加上下 4 的内边）。
    private func chipHeight() -> CGFloat {
        max(metrics.value("hit"), metrics.line("lh15") + 8)
    }

    /// 「也放进来」这一块按网页的 flex-wrap 排（标签也是一项；放不下就换行；行内竖向居中）。
    /// 返回每一行（行高 + 各项的框）。
    private func chipRows(contentW: CGFloat) -> [(height: CGFloat, items: [(frame: CGRect, chip: Int?)])] {
        let m = metrics
        let gap = m.space(3)
        var rows: [(height: CGFloat, items: [(frame: CGRect, chip: Int?)])] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowH: CGFloat = 0
        var rowItems: [(frame: CGRect, chip: Int?)] = []
        func flush() {
            guard !rowItems.isEmpty else { return }
            // 行内竖向居中（网页 align-items:center）
            let items = rowItems.map { (frame: CGRect(x: $0.frame.minX, y: y + (rowH - $0.frame.height) / 2, width: $0.frame.width, height: $0.frame.height), chip: $0.chip) }
            rows.append((height: rowH, items: items))
            rowItems = []
            let h = rowH
            rowH = 0
            x = 0
            y += h + gap
        }
        // 标签（网页 .sz-img__chipslabel：13 / 20 ink3）
        let labelW = chipsLabelWidth()
        if labelW > 0 {
            let h = m.line("lh13")
            rowItems.append((frame: CGRect(x: 0, y: 0, width: labelW, height: h), chip: nil))
            rowH = max(rowH, h)
            x = labelW + gap
        }
        for (i, chip) in (model?.chips ?? []).enumerated() {
            let bw = chipWidth(i)
            if x > 0, x + bw > contentW {
                flush()
            }
            let h = chipHeight()
            rowItems.append((frame: CGRect(x: x, y: 0, width: bw, height: h), chip: i))
            rowH = max(rowH, h)
            x += bw + gap
        }
        flush()
        return rows
    }

    /// chip 的盒宽（网页 .sz-img__chip：内边 6 + 小格 32 + 间距 8 + 字 + 内边 12）。
    /// 不取整：网页按内容排版，盒宽就是各段之和（取整会让后一个 chip 偏出 1pt）。
    private func chipWidth(_ index: Int) -> CGFloat {
        guard let b = chipButtons.indices.contains(index) ? chipButtons[index] : nil else { return 0 }
        return 6 + 32 + 8 + NativeType.titleWidth(b) + 12
    }

    private func chipsLabelWidth() -> CGFloat {
        NativeType.width(chipsLabel)
    }

    /// 主 / 次按钮的高（网页 .sz-btn--primary min-height btn-h；AX 档竖排两行）。
    private func actionsHeight() -> CGFloat {
        let h = buttonHeight()
        return axLayout ? h * 2 + metrics.space(3) : h
    }

    private func buttonHeight() -> CGFloat {
        metrics.value("btn-h")
    }

    /// 失败三段式的高（网页 .sz-fail：说明 → 4 的下边距 → 8 的间距 → 两键一行）。
    private func failHeight(contentW: CGFloat) -> CGFloat {
        let m = metrics
        let noteH = NativeType.height(failNote, width: contentW, line: m.line("lh15"))
        return noteH + m.space(1) + m.space(2) + buttonHeight()
    }

    /// 「存成长图」等文字按钮的高（网页 .sz-btn--text min-height 44；AX 档 max(44, 1.3em + 12)）。
    private func longHeight() -> CGFloat {
        if axLayout { return max(metrics.value("hit"), 1.3 * metrics.value("fs15") + 12) }
        return metrics.value("hit")
    }

    /// 当前比例（还没拿到视图时先按 3:4 占位，与网页的 defaultRatio 同一口径由页面给）。
    private var currentRatio: String {
        if !ratio.isEmpty { return ratio }
        return model?.ratio ?? model?.initialRatio ?? "3:4"
    }

    private func layoutContent(width w: CGFloat, safeBottom: CGFloat) {
        let m = metrics
        let gutter = m.gutter
        let contentW = w - 2 * gutter

        // 标题行（弹层头部：上内边 24 + 标题与「完成」并排 + 间距 16）
        let headH = headHeight(contentW: contentW)
        let dw = doneWidth()
        let titleW = max(1, contentW - 8 - dw)
        let titleH = titleHeight(contentW: contentW)
        titleBox = CGRect(x: gutter, y: m.space(6) + (headH - titleH) / 2, width: titleW, height: titleH)
        doneBox = CGRect(x: w - gutter + 4 - dw, y: m.space(6), width: dw, height: doneHeight())
        titleLabel.frame = titleBox
        doneButton.frame = doneBox

        // 正文（网页 .sz-img）：左右各留 gutter 的内容盒；台是满宽的（左右各出去 gutter）
        let bodyTop = m.space(6) + headH + m.space(4)
        var y: CGFloat = 0

        // 台（网页 .sz-img__stage：满宽、比弹层深一档的底）
        let stageH = NativeImagePreviewBox.stageMinHeight
        stageBox = CGRect(x: -gutter, y: y, width: w, height: stageH)
        stage.frame = stageBox
        layoutBoards(stageH: stageH, screenW: w)
        y += stageH

        // 页点
        if (model?.pageCount ?? 0) > 1 {
            y += m.space(4)
            let n = model?.pageCount ?? 0
            let total = CGFloat(n) * 6 + CGFloat(max(0, n - 1)) * 8
            pagerBox = CGRect(x: 0, y: y, width: contentW, height: 6)
            pager.frame = pagerBox
            let x0 = (contentW - total) / 2
            dotRects = (0..<n).map { CGRect(x: x0 + CGFloat($0) * 14, y: 0, width: 6, height: 6) }
            for (i, d) in dots.enumerated() where i < dotRects.count {
                d.frame = dotRects[i]
            }
            y += 6
        } else {
            pager.isHidden = true
        }

        // 比例分段（网页 .sz-img__ratio：align-self:center；AX 档 stretch）
        if (model?.ratios.count ?? 0) > 1 {
            y += m.space(4)
            let barH = ratioBarHeight()
            let n = CGFloat(model?.ratios.count ?? 0)
            let barW = axLayout ? contentW : (6 + 60 * n)
            ratioBox = CGRect(x: axLayout ? 0 : (contentW - barW) / 2, y: y, width: barW, height: barH)
            ratioBar.frame = ratioBox
            layoutRatioBar(contentW: contentW)
            y += barH
        } else {
            ratioBar.isHidden = true
        }

        // 说明句
        if !(model?.note ?? "").isEmpty {
            y += m.space(4)
            let nh = noteHeight(contentW: contentW)
            noteBox = CGRect(x: 0, y: y, width: contentW, height: nh)
            noteLabel.frame = noteBox
            y += nh
        } else {
            noteLabel.isHidden = true
        }

        // 「也放进来」
        if !(model?.chips.isEmpty ?? true) {
            y += m.space(4)
            let ch = chipsHeight(contentW: contentW)
            chipsBox = CGRect(x: 0, y: y, width: contentW, height: ch)
            chipsRow.frame = chipsBox
            layoutChips(contentW: contentW)
            y += ch
        } else {
            chipsRow.isHidden = true
        }

        // 分享 / 保存（或失败三段式）
        y += m.space(4)
        if fail != nil {
            let fh = failHeight(contentW: contentW)
            failBoxRect = CGRect(x: 0, y: y, width: contentW, height: fh)
            failBox.isHidden = false
            failBox.frame = failBoxRect
            layoutFail(contentW: contentW)
            shareButton.isHidden = true
            saveButton.isHidden = true
            y += fh
        } else {
            failBox.isHidden = true
            let bh = buttonHeight()
            if axLayout {
                shareButton.frame = CGRect(x: 0, y: y, width: contentW, height: bh)
                saveButton.frame = CGRect(x: 0, y: y + bh + m.space(3), width: contentW, height: bh)
                actionsBox = CGRect(x: 0, y: y, width: contentW, height: bh * 2 + m.space(3))
                y += bh * 2 + m.space(3)
            } else {
                let half = (contentW - m.space(3)) / 2
                shareButton.frame = CGRect(x: 0, y: y, width: half, height: bh)
                saveButton.frame = CGRect(x: half + m.space(3), y: y, width: half, height: bh)
                actionsBox = CGRect(x: 0, y: y, width: contentW, height: bh)
                y += bh
            }
        }

        // 「存成长图」
        if model?.alt != nil {
            y += m.space(4)
            let lw = ceil(NativeType.titleWidth(longButton)) + 8
            longBox = CGRect(x: (contentW - lw) / 2, y: y, width: lw, height: longHeight())
            longButton.frame = longBox
            y += longHeight()
        } else {
            longButton.isHidden = true
        }

        content.frame = CGRect(x: gutter, y: bodyTop, width: contentW, height: y)
        scroll.frame = panel.bounds
        scroll.contentSize = CGSize(width: w, height: bodyTop + y + max(m.space(8), safeBottom))
        contentHeight = bodyTop + y + max(m.space(8), safeBottom)
    }

    /// 台上的图板（网页 .sz-img__scroll：横向滚动，每页一块，块间 14；单块时居中）。
    /// 坐标都在台里（台是满宽的）：块居中于台，竖向居中于台的内高 300（上下各 20 的内边）。
    private func layoutBoards(stageH: CGFloat, screenW: CGFloat) {
        let box = NativeImagePreviewBox.size(currentRatio)
        let n = max(1, model?.pageCount ?? 1)
        let pad = (screenW - box.width) / 2 // 网页 .sz-img__scroll 的左右内边距（居中）
        let boardY = 20 + (NativeImagePreviewBox.stageContentHeight - box.height) / 2
        boardScroll.frame = CGRect(x: 0, y: 0, width: screenW, height: stageH)
        boardScroll.contentSize = CGSize(width: pad * 2 + CGFloat(n) * box.width + CGFloat(max(0, n - 1)) * NativeImagePreviewBox.boardGap, height: stageH)
        boardFrames = (0..<n).map { i in
            CGRect(x: pad + CGFloat(i) * (box.width + NativeImagePreviewBox.boardGap), y: boardY, width: box.width, height: box.height)
        }
        for (i, b) in boards.enumerated() where i < boardFrames.count {
            b.frame = boardFrames[i]
        }
        for (i, p) in pictures.enumerated() where i < boardFrames.count {
            // 图（网页 .sz-img__board canvas）铺满板
            p.frame = i < boards.count ? boards[i].bounds : .zero
        }
        // 没有图时的说明（网页 .sz-img__boardnote：板里居中）
        boardNote.frame = CGRect(x: pad - metrics.gutter, y: boardY, width: box.width, height: box.height)
    }

    private func layoutRatioBar(contentW: CGFloat) {
        let ratios = model?.ratios ?? []
        let n = ratios.count
        if axLayout {
            // 网页 :root[data-ax] .sz-img__ratio{flex-direction:column;align-self:stretch}，按钮 width:auto → 撑满内容宽
            let h = ratioButtonHeight()
            ratioButtonFrames = (0..<n).map { CGRect(x: 3, y: 3 + CGFloat($0) * h, width: contentW - 6, height: h) }
        } else {
            ratioButtonFrames = (0..<n).map { CGRect(x: 3 + CGFloat($0) * 60, y: 3, width: 60, height: 38) }
        }
        for (i, b) in ratioButtons.enumerated() where i < ratioButtonFrames.count {
            b.frame = ratioButtonFrames[i]
        }
        ratioBar.isHidden = ratios.count <= 1
    }

    private func layoutChips(contentW: CGFloat) {
        let rows = chipRows(contentW: contentW)
        var labelRect = CGRect.zero
        var rects: [CGRect] = []
        var cellRects: [CGRect] = []
        for row in rows {
            for item in row.items {
                if item.chip == nil {
                    labelRect = item.frame
                    continue
                }
                let i = item.chip ?? 0
                if rects.count == i { rects.append(item.frame) } else if rects.count > i { rects[i] = item.frame }
                let cell = CGRect(x: 6, y: (item.frame.height - 32) / 2, width: 32, height: 32)
                if cellRects.count == i { cellRects.append(cell) } else if cellRects.count > i { cellRects[i] = cell }
            }
        }
        chipsLabelRect = labelRect
        chipRects = rects
        chipCellRects = cellRects
        chipsLabel.frame = chipsLabelRect
        for (i, b) in chipButtons.enumerated() where i < chipRects.count {
            b.frame = chipRects[i]
            if i < chipCellRects.count {
                chipCells[i].frame = chipCellRects[i]
            }
        }
    }

    private func layoutFail(contentW: CGFloat) {
        let m = metrics
        let noteH = NativeType.height(failNote, width: contentW, line: m.line("lh15"))
        failNote.frame = CGRect(x: 0, y: 0, width: contentW, height: noteH)
        let bh = buttonHeight()
        let half = (contentW - m.space(3)) / 2
        let cw = ceil(NativeType.titleWidth(failCancel)) + 8
        // 网页 .sz-fail__btns：两列 1fr，间距 12；文字按钮 align-self:flex-start（在行顶，不居中）
        failCancel.frame = CGRect(x: (half - cw) / 2, y: noteH + m.space(1) + m.space(2), width: cw, height: m.value("hit"))
        failRetry.frame = CGRect(x: half + m.space(3), y: noteH + m.space(1) + m.space(2), width: half, height: bh)
    }

    // MARK: 样式

    private func styleAll() {
        let m = metrics
        guard let model else { return }
        let song = NativeType.song(size: m.value("fs22"), weight: .medium)
        titleLabel.attributedText = NSAttributedString(string: model.title, attributes: [.font: song, .foregroundColor: color("ink1")])
        NativeResultViewController.fixLineBox(titleLabel, line: m.line("lh22"))
        titleLabel.accessibilityLabel = model.title

        doneButton.setTitle(tr("X-COMMON.done"), for: .normal)
        doneButton.setTitleColor(color("ink2"), for: .normal)
        doneButton.setTitleColor(color("ink4"), for: .disabled)
        doneButton.titleLabel?.font = NativeType.compose(size: m.value("fs15"), weight: .regular)
        doneButton.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
        doneButton.contentHorizontalAlignment = .left

        boardNote.attributedText = NSAttributedString(string: model.boardNote, attributes: [
            .font: NativeType.compose(size: m.value("fs13"), weight: .regular), .foregroundColor: color("ink2"),
        ])

        let note = model.note
        // 说明句是 text-wrap: pretty 的段落：网页量的折行点（B2.7 webLineStarts 同一做法），原生按它换行
        let noteText = Self.brokenTrim(note, model.noteStarts)
        NativeType.set(noteLabel, noteText, font: NativeType.compose(size: m.value("fs15"), weight: .regular), color: color("ink2"), line: m.line("lh15"))
        noteLabel.accessibilityLabel = note // 读屏仍读整句（折行点前的空格在网页是悬空的，不影响朗读）
        noteLabel.isHidden = note.isEmpty
        NativeType.set(chipsLabel, tr("X-WORK.alsoAdd"), font: NativeType.compose(size: m.value("fs13"), weight: .regular), color: color("ink3"), line: m.line("lh13"))

        shareButton.setTitle(model.shareLabel, for: .normal)
        shareButton.titleLabel?.font = NativeType.compose(size: m.value("fs17"), weight: .medium)
        shareButton.setTitleColor(color("ink1"), for: .normal)
        shareButton.setTitleColor(color("ink4"), for: .disabled)
        shareButton.backgroundColor = .clear
        shareButton.layer.borderWidth = 1
        shareButton.layer.borderColor = color("ink4").cgColor

        saveButton.setTitle(saveTitle(), for: .normal)
        saveButton.titleLabel?.font = NativeType.compose(size: m.value("fs17"), weight: .medium)
        saveButton.setTitleColor(color("btn-fg"), for: .normal)
        saveButton.setTitleColor(color("ink4"), for: .disabled)
        saveButton.backgroundColor = color("btn-bg")

        longButton.setTitle(model.alt?.label ?? "", for: .normal)
        longButton.setTitleColor(color("ink2"), for: .normal)
        longButton.setTitleColor(color("ink4"), for: .disabled)
        longButton.titleLabel?.font = NativeType.compose(size: m.value("fs15"), weight: .regular)
        longButton.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
        longButton.contentHorizontalAlignment = .left

        failNote.attributedText = nil
        NativeType.set(failNote, failSentence(), font: NativeType.compose(size: m.value("fs15"), weight: .regular), color: color("ink2"), line: m.line("lh15"))
        failCancel.setTitle(fail?.kind == "share" ? tr("X-IMAGES.shareStay") : tr("R-W16.cancel"), for: .normal)
        failCancel.setTitleColor(color("ink2"), for: .normal)
        failCancel.setTitleColor(color("ink4"), for: .disabled)
        failCancel.titleLabel?.font = NativeType.compose(size: m.value("fs15"), weight: .regular)
        failCancel.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
        failCancel.contentHorizontalAlignment = .left
        failRetry.setTitle(tr("X-IMAGES.retry"), for: .normal)
        failRetry.titleLabel?.font = NativeType.compose(size: m.value("fs17"), weight: .medium)
        failRetry.setTitleColor(color("btn-fg"), for: .normal)
        failRetry.backgroundColor = color("btn-bg")

        ([doneButton, shareButton, saveButton, longButton, failCancel, failRetry] as [UIButton]).forEach { NativeType.trackTitle($0) }
        styleChipTitles()
        applyStates()
    }

    /// 禁用态（网页 .sz-btn[disabled]：底 field、字 ink4；主键保存成功后变「已存好」也是禁用的）。
    /// 网页：分享键只在忙时禁用；保存键忙时或已存好时禁用；「存成长图」忙时禁用。
    private func applyStates() {
        let busyState = busy != nil
        shareButton.isEnabled = !busyState
        saveButton.isEnabled = !busyState && saveState != "saved"
        longButton.isEnabled = !busyState
        if busyState {
            shareButton.backgroundColor = color("field")
            shareButton.layer.borderWidth = 0
            shareButton.setTitleColor(color("ink4"), for: .normal)
            saveButton.backgroundColor = color("field")
            saveButton.setTitleColor(color("ink4"), for: .normal)
            longButton.setTitleColor(color("ink4"), for: .normal)
        } else {
            shareButton.backgroundColor = .clear
            shareButton.layer.borderWidth = 1
            shareButton.layer.borderColor = color("ink4").cgColor
            shareButton.setTitleColor(color("ink1"), for: .normal)
            if saveState == "saved" {
                saveButton.backgroundColor = color("field")
                saveButton.setTitleColor(color("ink4"), for: .normal)
            } else {
                saveButton.backgroundColor = color("btn-bg")
                saveButton.setTitleColor(color("btn-fg"), for: .normal)
            }
            longButton.setTitleColor(color("ink2"), for: .normal)
        }
    }

    /// 主按钮的字（网页：保存中 → 「正在保存…」；已存好 → 「已存好」；否则保存 / 保存 N 张）。
    private func saveTitle() -> String {
        guard let model else { return "" }
        if slowBusy && (busy == "save" || busy == "long") { return tr("X-IMAGES.saving") }
        if saveState == "saved" { return tr("X-IMAGES.saved") }
        return model.saveLabel
    }

    /// 按网页的折行点换行；折行点前那个空格在网页是「悬空」的（行尾不算进行宽），这里也去掉，行宽才与网页一样。
    /// 网页的 text-wrap: pretty 折出来的行首就是空格的下一个字（webLineStarts 量的是每个字的位置）。
    static func brokenTrim(_ text: String, _ starts: Any?) -> String {
        guard let starts = (starts as? [NSNumber])?.map({ $0.intValue }), !starts.isEmpty else { return text }
        var out = ""
        for (i, ch) in text.enumerated() {
            if starts.contains(i) {
                while let last = out.last, last == " " || last == "\u{3000}" { out.removeLast() }
                out.append("\n")
            }
            out.append(ch)
        }
        return out
    }

    private func failSentence() -> String {
        guard let model, let f = fail else { return "" }
        let key: String
        let text: String
        switch f.kind {
        case "share":
            key = "share"
            text = model.failText.share
        default:
            switch f.reason {
            case "render":
                key = "render"
                text = model.failText.render
            case "denied":
                key = "denied"
                text = model.failText.denied
            default:
                key = "save"
                text = model.failText.save
            }
        }
        // 失败说明句也是 text-wrap: pretty 的段落：按网页量的折行点换行
        return Self.brokenTrim(text, model.failStarts?[key])
    }

    // MARK: 控件（比例 / 也放进来 / 页点）

    /// chip 标题（网页 .sz-img__chip 的字）：中文用钉住光学尺寸的苹方（原生保住中文字形，R9-B）+ 字距补偿，
    /// 拉丁标点（「·」）用**纯系统字体**——网页那里「·」由 -apple-system 自己排（iOS 实测 36px 时 17.05pt），
    /// 原生把苹方接成回退后「·」落到苹方（18.18pt），整串宽差 1.1pt（AX 档才显出来）。
    private func styleChipTitles() {
        let m = metrics
        let size = m.value("fs15")
        let cjk = NativeType.compose(size: size, weight: .regular)
        let latin = UIFont.systemFont(ofSize: size, weight: .regular)
        let track = NativeType.cjkTrack(size: size, weight: .regular)
        for b in chipButtons {
            guard let text = b.title(for: .normal), !text.isEmpty else { continue }
            let p = NSMutableParagraphStyle()
            p.alignment = b.titleLabel?.textAlignment ?? .center
            p.lineBreakMode = b.titleLabel?.numberOfLines == 1 ? (b.titleLabel?.lineBreakMode ?? .byTruncatingMiddle) : .byWordWrapping
            for st in [UIControl.State.normal, .disabled, .highlighted] {
                let out = NSMutableAttributedString(string: text, attributes: [
                    .font: latin,
                    .foregroundColor: b.titleColor(for: st) ?? b.currentTitleColor,
                    .paragraphStyle: p,
                    .kern: 0,
                ])
                var i = 0
                for ch in text {
                    let n = (String(ch) as NSString).length
                    if ch.unicodeScalars.contains(where: { $0.value >= 0x2E80 }) {
                        out.addAttribute(.font, value: cjk, range: NSRange(location: i, length: n))
                        if track != 0 { out.addAttribute(.kern, value: track, range: NSRange(location: i, length: n)) }
                    }
                    i += n
                }
                b.setAttributedTitle(out, for: st)
            }
        }
    }

    /// 按视图模型重建控件（比例分段、也放进来、页点、图板）。
    private func buildControls() {
        guard let model else { return }
        let m = metrics

        ratioButtons.forEach { $0.removeFromSuperview() }
        ratioButtons = model.ratios.map { r in
            let b = UIButton(type: .system)
            b.setTitle(r, for: .normal)
            // 网页 .sz-img__ratio button 有 font-variant-numeric:tabular-nums（「3:4」与「1:1」一样宽）→ 等宽数字
            b.titleLabel?.font = UIFont.monospacedDigitSystemFont(ofSize: m.value("fs15"), weight: .regular)
            b.setTitleColor(color("ink2"), for: .normal)
            b.layer.cornerRadius = m.value("r-ctl") - 3
            b.layer.cornerCurve = .continuous
            b.accessibilityIdentifier = "native-image-ratio"
            b.accessibilityValue = r
            b.addAction(UIAction { [weak self] _ in self?.onRatio(r) }, for: .touchUpInside)
            ratioBar.addSubview(b)
            return b
        }
        styleRatioButtons()

        chipButtons.forEach { $0.removeFromSuperview() }
        chipCells.forEach { $0.removeFromSuperview() }
        chipButtons = []
        chipCells = []
        for chip in model.chips {
            let b = NativeImageChipButton(type: .custom)
            b.setTitle(tr("X-WORK.chipWrong", ["char": chip.ch]), for: .normal)
            b.titleLabel?.font = NativeType.compose(size: m.value("fs15"), weight: .regular)
            b.setTitleColor(color("ink1"), for: .normal)
            b.layer.cornerRadius = m.value("r-ctl")
            b.layer.cornerCurve = .continuous
            b.contentHorizontalAlignment = .left
            b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 46, bottom: 0, right: 12)
            b.accessibilityIdentifier = "native-image-chip"
            b.accessibilityValue = chip.ch
            b.addAction(UIAction { [weak self] _ in self?.onChip(chip.recordId) }, for: .touchUpInside)
            let cell = UIImageView(image: Self.image(from: chip.thumb))
            cell.contentMode = .scaleToFill
            cell.layer.borderWidth = m.value("frame-w")
            cell.layer.borderColor = color("frame").cgColor
            cell.isUserInteractionEnabled = false
            b.addSubview(cell)
            chipsRow.addSubview(b)
            chipButtons.append(b)
            chipCells.append(cell)
        }
        chipsRow.isHidden = model.chips.isEmpty
        styleChips()
        styleChipTitles()

        dots.forEach { $0.removeFromSuperview() }
        dots = (0..<max(0, model.pageCount)).map { _ in
            let d = UIView()
            d.layer.cornerRadius = 3
            d.accessibilityIdentifier = "native-image-dot"
            pager.addSubview(d)
            return d
        }
        styleDots()

        // 图板（每页一块）
        boards.forEach { $0.removeFromSuperview() }
        pictures.forEach { $0.removeFromSuperview() }
        boards = []
        pictures = []
        let n = max(1, model.pageCount)
        for _ in 0..<n {
            let b = UIView()
            b.clipsToBounds = true
            // 网页 .sz-img__board 自身没有底色（canvas 铺满板）；底是图自己的纸色
            b.backgroundColor = .clear
            b.layer.borderWidth = metrics.value("hair")
            // 板是一张浅色的纸（网页 .sz-img__board.t-light，不随主题）：外缘线取浅色的 line
            b.layer.borderColor = color("line").resolvedColor(with: UITraitCollection(userInterfaceStyle: .light)).cgColor
            b.accessibilityIdentifier = "native-image-board"
            b.accessibilityLabel = model.title
            boardScroll.addSubview(b)
            boards.append(b)
            let p = UIImageView()
            p.contentMode = .scaleToFill
            p.accessibilityIdentifier = "native-image-canvas"
            b.addSubview(p)
            pictures.append(p)
        }
    }

    /// 比例分段：选中的那项底是纸色、字是 ink1（网页 [aria-pressed="true"]）。
    private func styleRatioButtons() {
        for b in ratioButtons {
            let on = (b.accessibilityValue ?? "") == currentRatio
            b.backgroundColor = on ? color("paper") : .clear
            b.setTitleColor(on ? color("ink1") : color("ink2"), for: .normal)
            b.accessibilityTraits = on ? [.button, .selected] : [.button]
        }
    }

    /// 已放进来的字：底是 field、边是 ink1（网页 [aria-pressed="true"]）。
    private func styleChips() {
        guard let model else { return }
        for (i, b) in chipButtons.enumerated() {
            let on = i < model.chips.count && model.chips[i].on
            b.backgroundColor = on ? color("field") : .clear
            b.layer.borderWidth = 1
            b.layer.borderColor = (on ? color("ink1") : color("line")).cgColor
            b.accessibilityTraits = on ? [.button, .selected] : [.button]
        }
    }

    /// 页点：当前页 ink1，其余 ink4。
    private func styleDots() {
        for (i, d) in dots.enumerated() {
            d.backgroundColor = i == page ? color("ink1") : color("ink4")
        }
    }

    // MARK: 数据

    /// 画全部页（网页把每一页都画出来放在横向滚动区里）。
    private func renderAll() {
        guard let model else { return }
        let my = token
        let r = currentRatio
        let n = max(1, model.pageCount)
        startLoad()
        Task { @MainActor [weak self] in
            guard let self else { return }
            var images: [UIImage?] = []
            for p in 0..<n {
                // display：引擎直接给画好的图（不经 PNG / base64 往返；像素与 PNG 解回来的逐个相同）；分享 / 保存仍取 PNG
                var body = await engine.raw("image.render", ["scope": scope, "ratio": r, "page": p, "display": true])
                guard my == token else { return }
                let picture = body.removeValue(forKey: SwiftEngine.pictureKey) as? UIImage // 不是 JSON 值：解码之前取走
                guard (body["ok"] as? Bool) == true, let reply = try? ShiziDecode.reply(body, as: NativeImageRenderReply.self) else {
                    images.append(nil)
                    continue
                }
                images.append(reply.image.status == "ready" ? (picture ?? Self.image(from: reply.image.dataURL)) : nil)
            }
            guard my == token else { return }
            stopLoad()
            for (i, p) in pictures.enumerated() {
                p.image = i < images.count ? images[i] : nil
                p.isHidden = p.image == nil
                if i < boards.count { boards[i].isHidden = p.image == nil }
            }
            let hasImage = images.contains { $0 != nil }
            boardNote.isHidden = hasImage
            view.setNeedsLayout()
        }
    }

    private static func image(from dataURL: String) -> UIImage? {
        guard let comma = dataURL.firstIndex(of: ","), dataURL.hasPrefix("data:") else { return nil }
        let b64 = String(dataURL[dataURL.index(after: comma)...])
        guard let data = Data(base64Encoded: b64) else { return nil }
        return UIImage(data: data)
    }

    /// F4：等待超过 400ms 才显示「正在生成…」。
    private func startLoad() {
        loadTimer?.invalidate()
        slowLoad = false
        loadTimer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: false) { [weak self] _ in
            guard let self else { return }
            self.slowLoad = true
            self.view.setNeedsLayout()
        }
    }

    private func stopLoad() {
        loadTimer?.invalidate()
        loadTimer = nil
        slowLoad = false
    }

    private func startBusy() {
        busyTimer?.invalidate()
        slowBusy = false
        busyTimer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: false) { [weak self] _ in
            guard let self else { return }
            self.slowBusy = true
            self.styleAll()
        }
    }

    private func stopBusy() {
        busyTimer?.invalidate()
        busyTimer = nil
        slowBusy = false
    }

    // MARK: 动作

    private func onRatio(_ r: String) {
        guard r != currentRatio else { return }
        if saveState == "failed" { saveState = "" }
        ratio = r
        page = 0
        styleRatioButtons()
        styleAll()
        view.setNeedsLayout()
        renderAll()
    }

    private func onChip(_ recordId: String) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            _ = await engine.raw("image.add", ["scope": scope, "recordId": recordId])
            await refresh()
            refreshPresentingResult()
        }
    }

    /// 「也放进来」之后，底下那张**原生结果页**（作品格 / 行）也要跟着变：
    /// 网页那一侧靠 store 订阅就地更新；原生结果页不订阅 store，只在挂载与自身写入回包时换视图。
    /// 这里用写字会话的同一个 op「result」重新取一次视图，换到正在呈现这张弹层的结果页上（不改 NativeResult.swift）。
    private func refreshPresentingResult() {
        guard let result = presentingViewController as? NativeResultViewController else { return }
        let bridge = WriteSessionChannel()
        let ax = traitCollection.preferredContentSizeCategory.isAccessibilityCategory
        bridge.call("result", ["slot": result.slot, "sessionId": result.sessionId, "width": result.view.bounds.width, "ax": ax]) { reply in
            if reply.ok, let v = reply.body["view"] as? [String: Any] {
                result.apply(view: v)
            }
        }
    }

    /// 重新取视图模型（也放进来之后）：标题 / 说明 / chip 都可能变。
    private func refresh() async {
        token += 1
        let my = token
        let body = await engine.raw("image.view", ["scope": scope])
        guard my == token else { return }
        guard (body["ok"] as? Bool) == true, let v = try? ShiziDecode.reply(body, as: ShiziViewReply<NativeImageView>.self).view else { return }
        model = v
        styleAll()
        buildControls()
        view.setNeedsLayout()
        presentationController?.containerView?.setNeedsLayout()
        await renderAll()
    }

    /// 弹层内容变了（失败三段式出现 / 消失）：正文重排，弹层本身的高度也要重算（由呈现控制器按内容算出）。
    private func layoutSheet() {
        view.setNeedsLayout()
        presentationController?.containerView?.setNeedsLayout()
    }

    private func onShare() {
        guard model != nil, busy == nil else { return }
        busy = "share"
        fail = nil
        startBusy()
        styleAll()
        Task { @MainActor [weak self] in
            guard let self else { return }
            let body = await engine.raw("image.render", ["scope": scope, "ratio": currentRatio, "page": page, "mode": "export"])
            busy = nil
            stopBusy()
            guard (body["ok"] as? Bool) == true, let reply = try? ShiziDecode.reply(body, as: NativeImageRenderReply.self),
                  let img = Self.image(from: reply.image.dataURL) else {
                fail = (kind: "share", reason: "render")
                styleAll()
                layoutSheet()
                return
            }
            let sheet = UIActivityViewController(activityItems: [img], applicationActivities: nil)
            sheet.completionWithItemsHandler = { [weak self] _, completed, _, error in
                guard let self else { return }
                if !completed, error != nil {
                    self.fail = (kind: "share", reason: "activity")
                    self.styleAll()
                    self.layoutSheet()
                }
            }
            self.present(sheet, animated: true)
        }
    }

    private func onSave() {
        guard model != nil, busy == nil else { return }
        fail = nil
        busy = "save"
        startBusy()
        styleAll()
        Task { @MainActor [weak self] in
            guard let self else { return }
            let body = await engine.raw("image.save", ["scope": scope, "ratio": currentRatio])
            busy = nil
            stopBusy()
            let ok = (body["ok"] as? Bool) == true
            if ok {
                saveState = "saved"
                fail = nil
                styleAll()
                saveFlash?.invalidate()
                #if DEBUG
                let holdSaved = qaHoldSaved
                #else
                let holdSaved = false
                #endif
                if !holdSaved {
                    saveFlash = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { [weak self] _ in
                        guard let self else { return }
                        self.saveState = ""
                        self.styleAll()
                    }
                }
            } else {
                saveState = "failed"
                let kind = (body["error"] as? [String: Any])?["kind"] as? String ?? "download"
                fail = (kind: "save", reason: kind)
                styleAll()
            }
            layoutSheet()
        }
    }

    private func onSaveLong() {
        guard let model, model.alt != nil, busy == nil else { return }
        fail = nil
        busy = "long"
        startBusy()
        styleAll()
        Task { @MainActor [weak self] in
            guard let self else { return }
            let body = await engine.raw("image.save", ["scope": scope, "ratio": currentRatio, "mode": "long"])
            busy = nil
            stopBusy()
            let ok = (body["ok"] as? Bool) == true
            saveState = ok ? "saved" : "failed"
            if !ok {
                let kind = (body["error"] as? [String: Any])?["kind"] as? String ?? "render"
                fail = (kind: "save", reason: kind)
            }
            styleAll()
            layoutSheet()
        }
    }

    private func onRetry() {
        guard let f = fail else { return }
        if f.kind == "share" { onShare() } else { onSave() }
    }

    private func clearFail() {
        fail = nil
        saveState = ""
        styleAll()
        layoutSheet()
    }

    private func close() {
        removeQAProxies()
        dismiss(animated: true) { [weak self] in self?.onClose?() }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // 夹具的点按只够得着宿主页（见 installQAProxies）
        if let host = presentingViewController?.view { installQAProxies(in: host) }
        renderAll()
    }

    // MARK: QA 夹具的点在弹层里（QAFixtures.swift qaTap）

    /// 夹具的点按只在**宿主页**的视图里找 accessibilityIdentifier（qaTap：stage.topScreen / presentedViewController 的视图）；
    /// 弹层是模态呈现的，夹具点不到它 → 在宿主页放几个不可见的转发按钮（1 × 1、alpha 0.01：不进元素清单），把点按转给弹层。
    /// 只有测试宿主（-shizi-test-host）才装；正式包没有这几个按钮。
    #if DEBUG
    func installQAProxies(in host: UIView) {
        guard RootViewController.nativeTestHostEnabled, qaProxies.isEmpty, let model else { return }
        let firstChip = model.chips.first?.recordId ?? ""
        let actions: [(String, () -> Void)] = [
            ("qa-image-save", { [weak self] in self?.onSave() }),
            ("qa-image-save-held", { [weak self] in self?.qaHoldSaved = true; self?.onSave() }),
            ("qa-image-share", { [weak self] in self?.onShare() }),
            ("qa-image-long", { [weak self] in self?.onSaveLong() }),
            ("qa-image-chip", { [weak self] in self?.onChip(firstChip) }),
            ("qa-image-ratio-3x4", { [weak self] in self?.onRatio("3:4") }),
            ("qa-image-ratio-1x1", { [weak self] in self?.onRatio("1:1") }),
        ]
        for (id, action) in actions {
            let b = UIButton(type: .custom)
            b.accessibilityIdentifier = id
            b.alpha = 0.01
            b.isUserInteractionEnabled = false
            b.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
            b.addAction(UIAction { _ in action() }, for: .touchUpInside)
            host.addSubview(b)
            qaProxies.append(b)
        }
    }
    #else
    func installQAProxies(in host: UIView) {}
    #endif

    /// 弹层关掉了：转发按钮一起收掉。
    func removeQAProxies() {
        qaProxies.forEach { $0.removeFromSuperview() }
        qaProxies = []
    }

    // MARK: 横向翻页（网页 .sz-img__scroll 的滚动定位）

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        guard scrollView === boardScroll, let box = boards.first?.bounds, box.width > 0 else { return }
        let step = box.width + NativeImagePreviewBox.boardGap
        let next = max(0, min(max(0, dots.count - 1), Int((scrollView.contentOffset.x / step).rounded())))
        if next != page {
            page = next
            styleDots()
        }
    }

    // MARK: 下滑关闭

    @objc private func panned(_ g: UIPanGestureRecognizer) {
        let h = panel.bounds.height
        switch g.state {
        case .began:
            panel.transform = .identity
        case .changed:
            let dy = max(0, g.translation(in: panel).y)
            panel.transform = CGAffineTransform(translationX: 0, y: dy)
        case .ended, .cancelled:
            let dy = max(0, g.translation(in: panel).y)
            let v = g.velocity(in: panel).y
            if dy > h / 3 || v > 500 { close() } else { UIView.animate(withDuration: 0.2) { self.panel.transform = .identity } }
        default:
            break
        }
    }

    func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        guard g === pan else { return true }
        let v = pan.velocity(in: panel)
        return abs(v.y) > abs(v.x) && v.y > 0
    }
}

// MARK: - 「也放进来」的 chip（小格 + 字；字的盒子照网页的排法）

final class NativeImageChipButton: UIButton {
    /// 小格 32pt；字从 46 起（网页 padding 6 + 格 32 + 间距 8），右边 12（contentEdgeInsets 里已给）。
    /// 这里不再改 titleRect：按钮的内容内边已经把它推到 46，再改一次会把字挤没。
}

// MARK: - 失败提示条（L4；网页的 failure 一支）

/// 提示条（浮起的浅面 + 细边 + 阴影，D71；距底 110 + 安全区，左右页边 20，最小高 48，15 / 22，底边一条 2pt 计时线）。
final class NativeImageToastView: UIView {
    private let label = UILabel()
    private let timerLine = UIView()
    private var metrics = ShiziMetrics()

    init(text: String) {
        super.init(frame: .zero)
        let m = metrics
        backgroundColor = ShiziTokens.dynamicColor("toast-bg") ?? .secondarySystemBackground
        layer.borderWidth = 1
        layer.borderColor = (ShiziTokens.dynamicColor("toast-line") ?? .separator).cgColor
        layer.cornerRadius = m.value("r-box")
        layer.cornerCurve = .continuous
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.10
        layer.shadowRadius = 12
        layer.shadowOffset = CGSize(width: 0, height: 4)
        label.numberOfLines = 0
        NativeType.set(label, text, font: NativeType.compose(size: m.value("fs15"), weight: .regular),
                      color: ShiziTokens.dynamicColor("toast-fg") ?? .label, line: m.line("lh15"))
        label.accessibilityIdentifier = "native-toast-text"
        addSubview(label)
        timerLine.backgroundColor = ShiziTokens.dynamicColor("ink3") ?? .tertiaryLabel
        timerLine.alpha = 0.4
        timerLine.accessibilityIdentifier = "native-toast-timer"
        // 锚点挪到左边中点：网页的计时线是 transform-origin: left center（从左往右收）
        timerLine.layer.anchorPoint = CGPoint(x: 0, y: 0.5)
        addSubview(timerLine)
        accessibilityIdentifier = "native-toast"
        isAccessibilityElement = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        let m = metrics
        let pad = m.space(3)
        let side = m.space(4)
        // 网页 .sz-toast：min-height 48、padding s3 s4、上下各 1px 边（box-sizing: border-box）
        let h = max(48, m.line("lh15") + pad * 2 + 2)
        label.frame = CGRect(x: 1 + side, y: (h - m.line("lh15")) / 2, width: bounds.width - (1 + side) * 2, height: m.line("lh15"))
        // 计时线：网页是绝对定位在内容盒底边（padding 盒底：上下各留 1px 边），从左往右收尽
        timerLine.bounds = CGRect(x: 0, y: 0, width: max(0, bounds.width - 2), height: 2)
        timerLine.layer.position = CGPoint(x: 1, y: h - 2)
    }

    /// 计时线在显示时长内收尽（网页 .sz-toast__timer 的 scaleX 动画，transform-origin: left center）。
    /// 用 CABasicAnimation 动 presentation 层：动画从左往右收，模型仍是满宽（取证量得到宽度，不会变成「原生缺少」）。
    func runTimer(_ seconds: Double) {
        let w = timerLine.bounds.width
        guard w > 0 else { return }
        timerLine.layer.removeAnimation(forKey: "shizi-toast-timer")
        let anim = CABasicAnimation(keyPath: "bounds.size.width")
        anim.fromValue = w
        anim.toValue = 0
        anim.duration = seconds
        anim.timingFunction = CAMediaTimingFunction(name: .linear)
        anim.fillMode = .both
        anim.isRemovedOnCompletion = false
        timerLine.layer.add(anim, forKey: "shizi-toast-timer")
    }
}
