import UIKit

// ShiziKit（B3.1）：改判 / 对照弹层（写字页、结果页共用；原在 NativeJudge.swift）。

// MARK: 改判弹层

/// 弹层需要的外观与文案：由原生写字页给（同一份 copy 字典、令牌颜色、字阶与时刻）。
struct NativeJudgeStyle {
    var tr: (String, [String: CustomStringConvertible]) -> String
    var color: (String, UIColor) -> UIColor
    var inkTint: SIMD4<Float>?
    var type = NativeType()
    var overlay = NativeOverlaySpec()
}

/// 改判弹层（决定型弹层：没有默认项、焦点落在弹层标题，D03；右上「取消」、点遮罩、下滑、两指 Z 形都是关）。网页 result-row.js ChangeSheet 的原生版，
/// 排法逐项照网页（R9-B）：满宽贴底、上两角 24、elev 底；内边距 24 / 20 / max(32, 下安全区)、段间 16：
///   标题（22 / 30，500）+ 右上「取消」（15，ink2，距顶 18、44 高）→ 两张小卡（1fr 1fr、间 12，笺底 + 格框、方角）各带下方 12 处的旁注（13，ink3）
///   → 说明（13 / 20，ink3，居中）→「看这个字 ›」（15，ink2，文字按钮，左对齐页边）→ 主按钮（btn-h，墨底）。
/// 点主按钮 → correct op（apply，明示目标判断，重发不会改回去）；成功或 stale 关弹层并把回包快照交给写字页；失败就地换三段式（说明 → [先不改 | 再试一次]），
/// 记录与 FSRS 不变。「看这个字 ›」（D66 ⑮）：关弹层，写字页让开、推入这个字的详情（onViewChar）。
final class NativeChangeSheetViewController: UIViewController, UIViewControllerTransitioningDelegate, UIGestureRecognizerDelegate, NativeSheetSizing {
    struct Model {
        let recordId: String
        let char: String
        let judgment: String // 此刻记录里的判断
        let paper: Bool
        let strokes: [[InkRawPoint]]
        /// B2.7 结果页的对照弹层（网页 ResultCellSheet，与写字页改判弹层同一版式）：标题 / 说明 / 右上 / 主按钮文字由页面给；看过答案、跳过的字只看不改（changeable = false，没有主按钮）。
        var title: String?
        var note: String?
        var topLabel: String?
        var flipLabel: String?
        var emptyText: String?
        var changeable = true

        init?(_ body: [String: Any]) {
            guard (body["ok"] as? Bool) == true, let id = body["recordId"] as? String, let char = body["char"] as? String,
                  let j = body["judgment"] as? String, j == "correct" || j == "wrong" else { return nil }
            recordId = id
            self.char = char
            judgment = j
            paper = (body["paper"] as? Bool) == true
            strokes = NativeInkWire.rawStrokes(body["strokes"])
        }

        /// B2.7：结果页 resultCell 回包。
        init?(result body: [String: Any]) {
            guard (body["ok"] as? Bool) == true, let char = body["char"] as? String else { return nil }
            recordId = body["recordId"] as? String ?? ""
            self.char = char
            judgment = body["judgment"] as? String ?? ""
            paper = (body["paper"] as? Bool) == true
            strokes = NativeInkWire.rawStrokes(body["strokes"])
            title = body["title"] as? String
            note = body["note"] as? String
            topLabel = body["topLabel"] as? String
            flipLabel = body["flipLabel"] as? String
            emptyText = body["emptyText"] as? String
            changeable = (body["changeable"] as? Bool) == true && (judgment == "correct" || judgment == "wrong")
        }

        /// 主按钮要改成的判断（与记录里的相反；明示给 op）。
        var target: String { judgment == "correct" ? "wrong" : "correct" }
    }

    let model: Model
    private let slot: String
    private let bridge: WriteSessionChannel
    private let style: NativeJudgeStyle
    private let onApplied: ([String: Any]?) -> Void
    /// 「看这个字 ›」：弹层已关，写字页接着去字详情。
    var onViewChar: ((String) -> Void)?
    /// B2.7：改判的提交（结果页走 resultCorrect）；nil = 写字页的 correct op。参数是目标判断。
    var applyCall: ((String, @escaping (NativeWriteReply) -> Void) -> Void)?
    private(set) var failed = false
    private var busy = false

    private let scroll = UIScrollView()
    private let titleLabel = UILabel()
    private let cancelButton = NativeTextButton(type: .system)
    private let mineCard = UIView()
    private let refCard = UIView()
    private let refGlyph = NativeGlyphView()
    private var inkView: UIView?
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

    init(slot: String, model: Model, bridge: WriteSessionChannel, style: NativeJudgeStyle, onApplied: @escaping ([String: Any]?) -> Void) {
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
        ShiziElev.apply(view, dark: dark) // --elev-shadow：模糊影子 + 上沿发丝线（ShiziKit ShiziElev）
        view.accessibilityViewIsModal = true
        view.accessibilityIdentifier = "native-change-sheet"

        scroll.alwaysBounceVertical = false
        scroll.showsVerticalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        view.addSubview(scroll)

        // 标题用宋（网页 .sz-sheet__title：--song 22 / 30，500）
        titleLabel.font = NativeType.song(size: type.value("fs22"), weight: .medium)
        titleLabel.textColor = ink1
        titleLabel.numberOfLines = 0
        // 行盒 = 网页行高 lh22（宋体自然行高 1.46em 比它高：不钉住的话 AX 档两行放不进算出来的盒子，被截成一行省略号）
        let songTitle = NativeType.song(size: type.value("fs22"), weight: .medium)
        titleLabel.font = songTitle
        titleLabel.attributedText = NSAttributedString(string: model.title ?? tr("X-JUDGE.changeTitle", ["char": model.char]), attributes: [.font: songTitle, .foregroundColor: ink1])
        NativeResultViewController.fixLineBox(titleLabel, line: type.line("lh22"))
        titleLabel.accessibilityTraits = [.header]
        titleLabel.accessibilityIdentifier = "native-change-title"

        configureText(cancelButton, title: model.topLabel ?? tr("X-JUDGE.changeCancel"), color: ink2, id: "native-change-cancel")
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
        } else if nStrokes > 0, let ink = NativeInkPaint.view(strokes: model.strokes, side: 1, color: style.inkTint) { // B2.7：画墨接口（R11-A 换实现）
            mineCard.addSubview(ink)
            inkView = ink
            mineCard.accessibilityLabel = tr("R-W09.mineCardLabel", ["n": nStrokes])
        } else {
            emptyText = model.emptyText ?? tr("R-D07.noInkLarge")
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
        }
        // B2.9b：读屏同网页（弹层小卡是图、不读；读两条旁注「你写的」「标准写法」，没墨时读格里那句）
        mineCard.isAccessibilityElement = false
        refCard.isAccessibilityElement = false

        noteLabel.numberOfLines = 0
        noteLabel.accessibilityIdentifier = "native-change-note"

        configureText(detailButton, title: tr("X-DETAIL.viewChar"), color: ink2, id: "native-change-detail")
        detailButton.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
        detailButton.contentHorizontalAlignment = .left
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
        b.titleLabel?.numberOfLines = 0
        b.titleLabel?.textAlignment = .center
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 24, bottom: 0, right: 24) // 网页 .sz-btn--primary padding 0 24（AX 档折行时同宽）
        b.backgroundColor = style.color("btn-bg", style.color("ink1", .label))
        b.setTitleColor(style.color("btn-fg", style.color("paper", .systemBackground)), for: .normal)
        b.layer.cornerRadius = 12
        b.layer.cornerCurve = .continuous
        b.accessibilityIdentifier = id
    }

    /// 主按钮文字 / 说明 / 失败三段式（就地换，不开第二层）。
    private func render() {
        flipButton.setTitle(model.flipLabel ?? tr(model.judgment == "correct" ? "X-JUDGE.changeToWrong" : "X-JUDGE.changeToCorrect"), for: .normal)
        let note = failed ? tr("R-W10.changeFailed") : (model.note ?? tr(model.judgment == "correct" ? "R-W10.changeBodyCorrect" : "R-W10.changeBodyWrong"))
        NativeType.set(noteLabel, note, font: type.font("fs13"), color: style.color("ink3", .secondaryLabel), align: .center, line: type.line("lh13"))
        flipButton.isHidden = failed || !model.changeable
        NativeType.trackTitle(flipButton)
        failCancel.isHidden = !failed || !model.changeable
        failRetry.isHidden = !failed || !model.changeable
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
        let cancelW = NativeType.titleWidth(cancelButton) + 24
        // 标题右侧给「取消」留 64（网页）；AX 档「取消」本身比 64 宽时让到它左边 8（网页这里标题会压在「取消」下面，B2.9b 不照搬）
        let titleW = min(inner - 64, w - 8 - cancelW - 8 - gutter)
        let titleH = NativeType.height(titleLabel, width: titleW, line: lh22)
        let headH = max(lh22, titleH)
        // AX 档文字按钮按字号长高（网页 components/ax.js .sz-btn--text：min-height max(44, 1.3em + 12)，量到的值）
        let cancelH = max(44, type.role("change", "minH") ?? 44)
        if layout {
            titleLabel.frame = CGRect(x: gutter, y: y, width: titleW, height: titleH)
            // 「取消」：距弹层顶 18、右缘外伸 4（文字右缘对齐页边）
            cancelButton.frame = CGRect(x: w - 8 - cancelW, y: 18, width: cancelW, height: cancelH)
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
            let dh = max(44, type.role("change", "minH", sub: "r2") ?? 44)
            if layout {
                let dw = NativeType.titleWidth(detailButton) + 8
                detailButton.frame = CGRect(x: gutter - 4, y: y, width: dw, height: dh)
            }
            y += dh + gap
        }
        let btnH = type.axButtonHeight("change", sub: "r3", title: flipButton.title(for: .normal), font: flipButton.titleLabel?.font, width: inner - 48) ?? type.value("btn-h") // 主按钮左右内边距 24
        guard model.changeable else {
            // 只看不改（看过答案 / 跳过，K25）：没有主按钮，弹层在「看这个字 ›」后结束
            return y - gap + max(32, safeBottom)
        }
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
        [cancelButton, detailButton, flipButton, failCancel, failRetry].forEach { NativeType.trackTitle($0) } // 中文字距同网页（B2.9b）
        let safeBottom = presentationController?.containerView?.safeAreaInsets.bottom ?? view.safeAreaInsets.bottom
        let h = layoutContent(width: view.bounds.width, safeBottom: safeBottom, layout: true)
        scroll.contentSize = CGSize(width: view.bounds.width, height: h)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // 决定型弹层：焦点落在弹层标题，不落在任何按钮上（D03）
        NativeA11y.screenChanged(titleLabel)
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
        let call: (@escaping (NativeWriteReply) -> Void) -> Void = { [bridge, slot, model, applyCall] done in
            if let applyCall { applyCall(model.target, done) } else { bridge.call("correct", ["slot": slot, "recordId": model.recordId, "to": model.target, "action": "apply"], completion: done) }
        }
        call { [weak self] reply in
            guard let self else { return }
            self.busy = false
            // 网页同样：成功或结果行已不是这条记录（stale）都关弹层
            if reply.ok || reply.errorKind == "stale" {
                if reply.ok { self.haptic.impact("judge", 0.7) } // F1：修改判断成功，commit 之后发
                self.dismiss(animated: true)
                self.onApplied(reply.snapshot)
                return
            }
            self.failed = true
            self.render()
            NativeA11y.announce(self.noteLabel.text)
        }
    }
}
