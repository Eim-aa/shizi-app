import UIKit

// B3.5c：「我的」页的零件——行内分段（外观 / 每组字数）、选择行、失败三段式、字帖的一格、AX 档的选择弹层。
// 网页对应：components/Rows.js（RowShell）、mine/choice.js（ChoiceSeg / ChoiceSheetView）、components/FailBlock.js、components/work.js MonthPaper、components/Sheet.js。

/// 像素对齐的发丝线宽（网页 border 0.5px 在 3 倍屏取整成 1 个设备像素）。
func shiziHairline(_ token: CGFloat) -> CGFloat {
    let s = UIScreen.main.scale
    return max(1, floor(token * s)) / s
}

/// 网页折行点（页面侧量，每个新行起始字的序号）→ 在那些字前插换行；没有折行点时原样。
func shiziBreak(_ text: String, _ starts: [Int]?) -> String {
    guard let starts, !starts.isEmpty else { return text }
    let set = Set(starts)
    var out = ""
    for (i, ch) in text.enumerated() {
        if set.contains(i) { out += "\n" }
        out.append(ch)
    }
    return out
}

func shiziTabular(_ f: UIFont) -> UIFont {
    let d = f.fontDescriptor.addingAttributes([.featureSettings: [[UIFontDescriptor.FeatureKey.type: kNumberSpacingType, UIFontDescriptor.FeatureKey.selector: kMonospacedNumbersSelector]]])
    return UIFont(descriptor: d, size: f.pointSize)
}

// MARK: - 行内分段（网页 .sz-seg）

final class MineSeg: UIView {
    struct Item { let id: ChoiceID; let text: String; let aria: String? }

    var onPick: ((ChoiceID) -> Void)?
    private(set) var buttons: [UIButton] = []
    private var rings: [CALayer] = []
    private var items: [Item] = []
    private var selected: ChoiceID = .text("")
    private var numeric = false
    private var metrics = ShiziMetrics()
    private var idPrefix = ""

    func configure(items: [Item], selected: ChoiceID, numeric: Bool, metrics m: ShiziMetrics, title: String, idPrefix: String, colors: (ink1: UIColor, ink2: UIColor, field: UIColor, sheet: UIColor, line: UIColor)) {
        self.items = items
        self.selected = selected
        self.numeric = numeric
        metrics = m
        self.idPrefix = idPrefix
        backgroundColor = colors.field
        layer.cornerRadius = m.value("r-ctl")
        layer.cornerCurve = .continuous
        accessibilityIdentifier = "native-\(idPrefix)-seg"
        isAccessibilityElement = false
        accessibilityContainerType = .semanticGroup
        accessibilityLabel = title
        if buttons.count != items.count {
            buttons.forEach { $0.removeFromSuperview() }
            rings.forEach { $0.removeFromSuperlayer() }
            buttons = items.map { _ in UIButton(type: .custom) }
            rings = items.map { _ in CALayer() }
            for (i, b) in buttons.enumerated() {
                b.layer.addSublayer(rings[i])
                rings[i].zPosition = -1
                b.layer.masksToBounds = false
                b.addAction(UIAction { [weak self] _ in
                    guard let self, i < self.items.count else { return }
                    self.onPick?(self.items[i].id)
                }, for: .touchUpInside)
                addSubview(b)
            }
        }
        let hair = shiziHairline(m.value("hair"))
        for (i, it) in items.enumerated() {
            let b = buttons[i]
            let on = it.id == selected
            b.accessibilityIdentifier = "native-\(idPrefix)-option"
            b.setTitle(it.text, for: .normal)
            b.titleLabel?.font = numeric ? shiziTabular(m.font(15, on ? .medium : .regular)) : m.font(15, on ? .medium : .regular)
            b.setTitleColor(on ? colors.ink1 : colors.ink2, for: .normal)
            b.backgroundColor = on ? colors.sheet : .clear
            b.layer.cornerRadius = m.value("r-ctl") - 3
            b.layer.cornerCurve = .continuous
            NativeType.trackTitle(b)
            b.accessibilityLabel = it.aria ?? it.text
            b.accessibilityTraits = on ? [.button, .selected] : [.button]
            rings[i].isHidden = !on
            rings[i].borderWidth = hair
            rings[i].borderColor = colors.line.resolvedColor(with: traitCollection).cgColor
            rings[i].cornerRadius = b.layer.cornerRadius + hair
        }
        setNeedsLayout()
    }

    /// 每项宽：文字宽 + 左右内边距（数字分段最小 44、内边距 s2；文字分段内边距 s3）。
    private func optionWidths() -> [CGFloat] {
        let pad = numeric ? metrics.space(2) : metrics.space(3)
        return buttons.map { b in
            let w = ceil(NativeType.titleWidth(b) * 10) / 10 + 2 * pad
            return numeric ? max(44, w) : w
        }
    }

    var fittingSize2: CGSize {
        let w = optionWidths().reduce(0, +) + 4
        return CGSize(width: w, height: max(44, metrics.value("hit")) + 4)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        var x: CGFloat = 2
        for (b, w) in zip(buttons, optionWidths()) {
            b.frame = CGRect(x: x, y: 2, width: w, height: bounds.height - 4)
            rings.first?.frame = .zero
            x += w
        }
        for (i, b) in buttons.enumerated() {
            let hair = rings[i].borderWidth
            rings[i].frame = b.bounds.insetBy(dx: -hair, dy: -hair)
        }
    }
}

// MARK: - 选择行（标准字号：名称 + 分段；AX 档：名称 …… 当前值 ›）

final class MineChoiceRow: UIView {
    var onPick: ((ChoiceID) -> Void)?
    var onOpen: (() -> Void)?
    let nameLabel = UILabel()
    let seg = MineSeg()
    let pick = ShiziRowButton(type: .custom)
    let line = UIView()
    private var rowId = ""
    private(set) var axMode = false

    func configure(id: String, pickable: Bool) {
        rowId = id
        for v in [nameLabel, seg, pick, line] as [UIView] { addSubview(v) }
        seg.onPick = { [weak self] v in self?.onPick?(v) }
        pick.addAction(UIAction { [weak self] _ in self?.onOpen?() }, for: .touchUpInside)
        pick.accessibilityTraits = [.button]
    }

    /// 内容（view.mine 的 choice）。
    func update(choice: MineView.Choice, ax: Bool, numeric: Bool, metrics m: ShiziMetrics, color: (String) -> UIColor) {
        axMode = ax
        let title = choice.title.text
        seg.isHidden = ax
        nameLabel.isHidden = ax
        pick.isHidden = !ax
        accessibilityIdentifier = ax ? nil : "native-\(rowId)"
        pick.accessibilityIdentifier = "native-\(rowId)"
        line.backgroundColor = color("line")
        if ax {
            NativeType.set(pick.label, title, font: m.font(17, .medium), color: color("ink1"), line: m.line("lh17s"))
            NativeType.set(pick.valueLabel, choice.valueText.text, font: shiziTabular(m.font(15)), color: color("ink2"), align: .left, line: m.line("lh15"))
            pick.titleLabel?.font = m.font(15)
            pick.setTitleColor(color("ink1"), for: .normal)
            pick.chevronSize = CGSize(width: 8, height: 13)
            pick.setImage(ShiziChevron.image(color("ink4"), size: pick.chevronSize), for: .normal)
            pick.valueLabel.isHidden = false
            pick.accessibilityLabel = title
            pick.accessibilityValue = choice.valueText.text
        } else {
            NativeType.set(nameLabel, title, font: m.font(17, .medium), color: color("ink1"), line: m.line("lh17s"))
            let items = choice.options.map { MineSeg.Item(id: $0.id, text: $0.label?.text ?? $0.sheetLabel.text, aria: $0.aria?.text) }
            seg.configure(items: items, selected: choice.value, numeric: numeric, metrics: m, title: title, idPrefix: rowId,
                          colors: (color("ink1"), color("ink2"), color("field"), color("sheet"), color("line")))
        }
        setNeedsLayout()
    }

    /// 行高（含底线）；layout = true 时排好子视图（坐标相对本视图，宽 width）。
    @discardableResult
    func layoutRow(width: CGFloat, metrics m: ShiziMetrics, layout: Bool) -> CGFloat {
        let hair = shiziHairline(m.value("hair"))
        if axMode {
            // :root[data-ax] .sz-rrow：名称 / 值上下排（值 15 左对齐），右 30 给 chevron
            let lw = width - 30
            let nh = NativeType.height(pick.label, width: lw, line: m.line("lh17s"))
            let vh = NativeType.height(pick.valueLabel, width: lw, line: m.line("lh15"))
            let h = max(56, m.space(2) * 2 + nh + vh + hair)
            if layout {
                pick.frame = CGRect(x: 0, y: 0, width: width, height: h)
                pick.label.frame = CGRect(x: 0, y: (h - hair - nh - vh) / 2, width: lw, height: nh)
                pick.valueLabel.frame = CGRect(x: 0, y: pick.label.frame.maxY, width: lw, height: vh)
                pick.label.numberOfLines = 0
                pick.valueLabel.numberOfLines = 0
                line.frame = CGRect(x: 0, y: h - hair, width: width, height: hair)
            }
            return h
        }
        let sz = seg.fittingSize2
        let h = max(56, sz.height + 2 * m.space(1) + hair)
        if layout {
            frame.size.height = h
            seg.frame = CGRect(x: width - sz.width, y: m.space(1), width: sz.width, height: sz.height)
            let lh = m.line("lh17s")
            let nw = min(width - sz.width - m.space(2), ceil(NativeType.width(nameLabel)))
            nameLabel.frame = CGRect(x: 0, y: (h - hair - lh) / 2, width: max(0, nw), height: lh)
            line.frame = CGRect(x: 0, y: h - hair, width: width, height: hair)
        }
        return h
    }
}

// MARK: - 失败三段式（网页 FailBlock layout=page：说明 → 先不 X → 再试一次；不发触觉）

final class MineFailBlock: UIView {
    var onCancel: (() -> Void)?
    var onRetry: (() -> Void)?
    private let note = UILabel()
    let cancel = NativeTextButton(type: .system)
    let retry = UIButton(type: .system)
    private var prefix = "native-mine-fail"

    override init(frame: CGRect) {
        super.init(frame: frame)
        note.numberOfLines = 0
        for v in [note, cancel, retry] as [UIView] { addSubview(v) }
        cancel.addAction(UIAction { [weak self] _ in self?.onCancel?() }, for: .touchUpInside)
        retry.addAction(UIAction { [weak self] _ in self?.onRetry?() }, for: .touchUpInside)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(fail: MineView.Fail, idPrefix: String, metrics m: ShiziMetrics, color: (String) -> UIColor, noteBreaks: [Int]? = nil) {
        prefix = idPrefix
        accessibilityIdentifier = idPrefix
        note.accessibilityIdentifier = "\(idPrefix)-note"
        cancel.accessibilityIdentifier = "\(idPrefix)-cancel"
        retry.accessibilityIdentifier = "\(idPrefix)-retry"
        NativeType.set(note, shiziBreak(fail.note.text, noteBreaks), font: m.font(15), color: color("ink2"), line: m.line("lh15"))
        cancel.setTitle(fail.cancel.text, for: .normal)
        cancel.titleLabel?.font = m.font(15)
        cancel.setTitleColor(color("ink2"), for: .normal)
        cancel.contentHorizontalAlignment = .left
        cancel.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
        cancel.titleLabel?.numberOfLines = 0
        NativeType.trackTitle(cancel)
        retry.setTitle(fail.retry.text, for: .normal)
        retry.titleLabel?.font = m.font(17, .medium)
        retry.titleLabel?.numberOfLines = 0
        retry.titleLabel?.textAlignment = .center
        retry.backgroundColor = color("btn-bg")
        retry.setTitleColor(color("btn-fg"), for: .normal)
        retry.layer.cornerRadius = m.value("r-ctl")
        retry.layer.cornerCurve = .continuous
        NativeType.trackTitle(retry)
    }

    @discardableResult
    func layoutBlock(width: CGFloat, metrics m: ShiziMetrics, layout: Bool) -> CGFloat {
        var y: CGFloat = 0
        let nh = NativeType.height(note, width: width, line: m.line("lh15"))
        if layout { note.frame = CGRect(x: 0, y: y, width: width, height: nh) }
        y += nh + m.space(1) + m.space(2)
        let ch = max(44, 1.3 * m.value("fs15") + 12)
        if layout { cancel.frame = CGRect(x: -4, y: y, width: NativeType.titleWidth(cancel) + 8, height: ch) }
        y += ch + m.space(2)
        let rh = m.value("btn-h")
        if layout { retry.frame = CGRect(x: 0, y: y, width: width, height: rh) }
        return y + rh
    }
}

// MARK: - 字帖的一格（网页 .sz-mcell：按钮，里面是本人墨 / 衬底参考字，角标骑在格上边线上）

final class MineSheetCell: UIButton {
    private var inkView: UIView?
    private let glyph = NativeGlyphView()
    private let tagBg = UIView()
    private var tagWidth: CGFloat = 0
    private var pressColor: UIColor = .clear
    private var pad: CGFloat = 0.12
    private var hasTag = false

    func configure(cell: MineView.Cell, strokes: [[InkRawPoint]], side: CGFloat, pad: CGFloat, widthScale: Double, look: (hand: SIMD4<Float>?, under: UIColor, ink1: UIColor, ink3: UIColor, paper: UIColor, field: UIColor)) {
        self.pad = pad
        inkView?.removeFromSuperview()
        inkView = nil
        glyph.removeFromSuperview()
        let inner = side * (1 - 2 * pad)
        if cell.mode == "hand", let v = NativeInkPaint.view(strokes: strokes, side: inner, color: look.hand, widthScale: widthScale) {
            inkView = v
            addSubview(v)
        } else {
            glyph.char = cell.ch
            glyph.color = look.under
            glyph.isUserInteractionEnabled = false
            addSubview(glyph)
        }
        accessibilityLabel = cell.label.text
        accessibilityTraits = [.button]
        // 角标：就是按钮自己的标题（网页按钮的文字 = 角标 span）：黑体 11 / 500、墨三，纸色衬底断开格线
        hasTag = !cell.tag.isEmpty
        setTitle(hasTag ? cell.tag : nil, for: .normal)
        setTitleColor(look.ink3, for: .normal)
        titleLabel?.font = shiziTabular(NativeType.compose(size: 11, weight: .medium)) // 角标数字等宽（网页 font-variant-numeric: tabular-nums）
        tagWidth = hasTag ? ceil((cell.tag as NSString).size(withAttributes: [.font: titleLabel?.font ?? .systemFont(ofSize: 11)]).width) : 0
        tagBg.backgroundColor = look.paper
        tagBg.isUserInteractionEnabled = false
        tagBg.isHidden = !hasTag
        if tagBg.superview == nil, let tl = titleLabel { insertSubview(tagBg, belowSubview: tl) }
        pressColor = look.field
        removeTarget(nil, action: nil, for: .allEvents)
        addTarget(self, action: #selector(down), for: [.touchDown, .touchDragEnter])
        addTarget(self, action: #selector(up), for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit])
        setNeedsLayout()
    }

    @objc private func down() { backgroundColor = pressColor }
    @objc private func up() { backgroundColor = .clear }

    override func titleRect(forContentRect contentRect: CGRect) -> CGRect {
        hasTag ? CGRect(x: 5, y: -7, width: tagWidth, height: 13) : .zero
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let s = bounds.width
        let p = s * pad, inner = s - 2 * p
        inkView?.frame = CGRect(x: p, y: p, width: inner, height: inner)
        glyph.frame = CGRect(x: p, y: p, width: inner, height: inner)
        tagBg.frame = CGRect(x: 3, y: -7, width: tagWidth + 4, height: 13)
    }
}

// MARK: - 弹层里的一项（网页 .sz-mine__opt：整行按钮，左字右对勾；对勾占位始终在，没选中时不可见）

final class MineOptionButton: UIButton {
    var textY: CGFloat = 0
    var textH: CGFloat = 0
    var hair: CGFloat = 0

    override func titleRect(forContentRect contentRect: CGRect) -> CGRect {
        CGRect(x: 0, y: textY, width: max(0, bounds.width - 22 - 12), height: textH)
    }

    override func imageRect(forContentRect contentRect: CGRect) -> CGRect {
        CGRect(x: bounds.width - 22, y: (bounds.height - hair - 22) / 2, width: 22, height: 22)
    }
}

// MARK: - AX 档的选择弹层（网页 Sheet + ChoiceSheetView）

final class MineChoiceSheetViewController: UIViewController, UIViewControllerTransitioningDelegate, UIGestureRecognizerDelegate, NativeSheetSizing {
    struct Config {
        let rowId: String
        let choice: MineView.Choice
        let fail: MineView.Fail
        let done: ShiziCopyRef
        let metrics: ShiziMetrics
        /// 失败说明的折行点（网页 text-wrap: pretty 的量法）
        let failBreaks: [Int]?
        /// 提交：回调 true = 成功
        let commit: (ChoiceID, @escaping (Bool) -> Void) -> Void
    }

    private let cfg: Config
    private let spec = NativeOverlaySpec(motion: ShiziTokens.pageMotion(.write))
    private let titleLabel = UILabel()
    private let doneButton = NativeTextButton(type: .system)
    private let scroll = UIScrollView()
    private let topLine = UIView()
    private var optionButtons: [MineOptionButton] = []
    private var optionLines: [UIView] = []
    private var checkImage = UIImage()
    private var blankImage = UIImage()
    private let failBlock = MineFailBlock()
    private let pan = UIPanGestureRecognizer()
    private let edge = UIScreenEdgePanGestureRecognizer()
    private var failed = false
    private var pending: ChoiceID?
    private var finished = false
    private var edgeExit = false
    var current: ChoiceID

    private var m: ShiziMetrics { cfg.metrics }
    private func color(_ n: String) -> UIColor { ShiziTokens.dynamicColor(n) ?? .label }
    private var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled || ShiziProbe.forceReduceMotion }

    init(config: Config) {
        cfg = config
        current = config.choice.value
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .custom
        transitioningDelegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    // MARK: 呈现

    func presentationController(forPresented presented: UIViewController, presenting: UIViewController?, source: UIViewController) -> UIPresentationController? {
        let p = NativeSheetPresentation(presented: presented, presenting: presenting, scrimColor: color("scrim"))
        p.onScrimTap = { [weak self] in self?.close() }
        return p
    }

    func animationController(forPresented presented: UIViewController, presenting: UIViewController, source: UIViewController) -> UIViewControllerAnimatedTransitioning? {
        NativeSheetAnimator(presenting: true, spec: spec, reduce: reduceMotion)
    }

    func animationController(forDismissed dismissed: UIViewController) -> UIViewControllerAnimatedTransitioning? {
        NativeSheetAnimator(presenting: false, spec: spec, reduce: reduceMotion, fadeExit: edgeExit)
    }

    // MARK: 视图

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = color("elev")
        view.layer.cornerRadius = m.value("r-box")
        view.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        view.layer.cornerCurve = .continuous
        let dark = traitCollection.userInterfaceStyle == .dark
        ShiziElev.apply(view, dark: dark) // --elev-shadow：模糊影子 + 上沿发丝线（ShiziKit ShiziElev）
        view.accessibilityViewIsModal = true
        view.accessibilityIdentifier = "native-\(cfg.rowId)-sheet"
        scroll.alwaysBounceVertical = false
        scroll.showsVerticalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        view.addSubview(scroll)
        titleLabel.numberOfLines = 0
        titleLabel.accessibilityTraits = [.header]
        titleLabel.accessibilityIdentifier = "native-sheet-title"
        let song = NativeType.song(size: m.value("fs22"), weight: .medium)
        titleLabel.attributedText = NSAttributedString(string: cfg.choice.title.text, attributes: [.font: song, .foregroundColor: color("ink1")])
        NativeResultViewController.fixLineBox(titleLabel, line: m.line("lh22"))
        doneButton.setTitle(cfg.done.text, for: .normal)
        doneButton.titleLabel?.font = m.font(15)
        doneButton.setTitleColor(color("ink2"), for: .normal)
        doneButton.accessibilityIdentifier = "native-sheet-done"
        NativeType.trackTitle(doneButton)
        doneButton.addAction(UIAction { [weak self] _ in self?.close() }, for: .touchUpInside)
        topLine.backgroundColor = color("line")
        for v in [titleLabel, doneButton, topLine, failBlock] as [UIView] { scroll.addSubview(v) }
        checkImage = Self.checkImage(color("ink1"))
        blankImage = UIGraphicsImageRenderer(size: CGSize(width: 22, height: 22)).image { _ in }.withRenderingMode(.alwaysOriginal)
        for o in cfg.choice.options {
            let b = MineOptionButton(type: .custom)
            b.accessibilityIdentifier = "native-\(cfg.rowId)-sheet-option"
            b.accessibilityLabel = o.sheetLabel.text
            b.contentHorizontalAlignment = .left
            b.setTitle(o.sheetLabel.text, for: .normal)
            b.setTitleColor(color("ink1"), for: .normal)
            b.addAction(UIAction { [weak self] _ in self?.pick(o.id) }, for: .touchUpInside)
            let line = UIView()
            line.backgroundColor = color("line")
            b.addSubview(line)
            scroll.addSubview(b)
            optionButtons.append(b); optionLines.append(line)
        }
        failBlock.isHidden = true
        failBlock.configure(fail: cfg.fail, idPrefix: "native-\(cfg.rowId)-sheet-fail", metrics: m, color: color, noteBreaks: cfg.failBreaks)
        failBlock.onCancel = { [weak self] in self?.close() }
        failBlock.onRetry = { [weak self] in if let p = self?.pending { self?.run(p) } }
        pan.delegate = self
        pan.addTarget(self, action: #selector(panned(_:)))
        view.addGestureRecognizer(pan)
        refreshOptions()
    }

    private static func checkImage(_ c: UIColor) -> UIImage {
        let size = CGSize(width: 22, height: 22)
        return UIGraphicsImageRenderer(size: size).image { _ in
            let p = UIBezierPath()
            p.move(to: CGPoint(x: 5, y: 11.5)); p.addLine(to: CGPoint(x: 9.5, y: 16)); p.addLine(to: CGPoint(x: 17, y: 6.5))
            p.lineWidth = 1.5; p.lineCapStyle = .round; p.lineJoinStyle = .round
            c.setStroke(); p.stroke()
        }.withRenderingMode(.alwaysOriginal)
    }

    private func refreshOptions() {
        for (i, o) in cfg.choice.options.enumerated() {
            let on = o.id == current
            let b = optionButtons[i]
            b.titleLabel?.font = m.font(17, on ? .medium : .regular)
            b.setImage(on ? checkImage : blankImage, for: .normal)
            NativeType.trackTitle(b)
            b.accessibilityTraits = on ? [.button, .selected] : [.button]
        }
        failBlock.isHidden = !failed
        view.setNeedsLayout()
        presentationController?.containerView?.setNeedsLayout()
    }

    // MARK: 版式

    @discardableResult
    private func layoutContent(width w: CGFloat, safeBottom: CGFloat, layout: Bool) -> CGFloat {
        let gutter = m.gutter
        let inner = w - 2 * gutter
        let hair = shiziHairline(m.value("hair"))
        var y = m.space(6)
        let doneW = NativeType.titleWidth(doneButton) + 8
        let doneH = max(44, 1.3 * m.value("fs15") + 12)
        let titleW = inner - doneW - 8
        let titleH = NativeType.height(titleLabel, width: titleW, line: m.line("lh22"))
        let headH = max(doneH, titleH)
        if layout {
            titleLabel.frame = CGRect(x: gutter, y: y + (headH - titleH) / 2, width: titleW, height: titleH)
            doneButton.frame = CGRect(x: gutter + inner - doneW + 4, y: y, width: doneW, height: doneH)
        }
        y += headH + m.space(4)
        if layout { topLine.frame = CGRect(x: gutter, y: y, width: inner, height: hair) }
        y += hair
        let rowH = m.line("lh15") + 2 * m.space(2) + hair
        for (i, b) in optionButtons.enumerated() {
            if layout {
                b.frame = CGRect(x: gutter, y: y, width: inner, height: rowH)
                // 行盒 lh15、字的内容区比它高（AX 档）：标题框取字体行高、中线仍在行盒中线（网页文字框 = 内容区）
                let lh = m.line("lh15")
                let fh = max(lh, ceil(b.titleLabel?.font?.lineHeight ?? lh))
                b.textY = m.space(2) + (lh - fh) / 2
                b.textH = fh
                b.hair = hair
                optionLines[i].frame = CGRect(x: 0, y: rowH - hair, width: inner, height: hair)
            }
            y += rowH
        }
        if failed {
            y += m.space(4) + m.space(3)
            let fh = failBlock.layoutBlock(width: inner, metrics: m, layout: layout)
            if layout { failBlock.frame = CGRect(x: gutter, y: y, width: inner, height: fh) }
            y += fh
        }
        return y + max(m.space(8), safeBottom)
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
        // 弹层优先接管左缘（含遮罩区域），与下面是否为 Tab 根无关（N4）。
        edge.edges = .left
        edge.addTarget(self, action: #selector(edgeBack(_:)))
        presentationController?.containerView?.addGestureRecognizer(edge)
        becomeFirstResponder()
        NativeA11y.screenChanged(titleLabel) // 决定型弹层：焦点落在弹层标题（D03）
    }

    override var canBecomeFirstResponder: Bool { true }
    override var keyCommands: [UIKeyCommand]? {
        [UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(escapeKey))]
    }

    @objc private func escapeKey() { close() }

    @objc private func edgeBack(_ g: UIScreenEdgePanGestureRecognizer) {
        guard let container = g.view else { return }
        let dx = max(0, g.translation(in: container).x)
        let vx = g.velocity(in: container).x
        let width = max(1, container.bounds.width)
        let scrim = (presentationController as? NativeSheetPresentation)?.scrim
        switch g.state {
        case .began, .changed:
            guard !reduceMotion else { return }
            view.transform = CGAffineTransform(translationX: dx, y: 0)
            scrim?.alpha = max(0, 1 - dx / width)
        case .ended, .cancelled:
            let commit = g.state == .ended && (vx > spec.commitVelocity || (dx > width * spec.commitRatio && vx > spec.returnVelocity))
            if commit {
                edgeExit = true
                close()
            } else if !reduceMotion {
                NativeOverlaySpec.run(spec.snap, NativeOverlaySpec.curve(spec.easeOut, fallback: .easeOut), {
                    self.view.transform = .identity
                    scrim?.alpha = 1
                })
            }
        default:
            break
        }
    }

    override func accessibilityPerformEscape() -> Bool {
        close()
        return true
    }

    // MARK: 选择（点当前项 → 关；点别的 → 提交，成功关，失败就地换成三段式，再试一次 = 同一选择）

    private func pick(_ id: ChoiceID) {
        guard !finished else { return }
        pending = id
        if id == current { close(); return }
        run(id)
    }

    private func run(_ id: ChoiceID) {
        guard !finished else { return }
        cfg.commit(id) { [weak self] ok in
            guard let self, !self.finished else { return }
            if ok {
                self.finished = true
                self.dismiss(animated: true)
            } else {
                self.failed = true
                self.refreshOptions()
                NativeA11y.announce(self.cfg.fail.note.text)
            }
        }
    }

    private func close() {
        guard presentingViewController != nil, !isBeingDismissed else { return }
        finished = true
        dismiss(animated: true)
    }

    // MARK: 下滑关闭（网页 Sheet.js createSheetDrag：内容在顶部、向下为主才接管）

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
            let commit = g.state == .ended && (v > spec.commitVelocity || (dy > h * spec.commitRatio && v > spec.returnVelocity))
            if commit {
                close()
            } else if follow {
                NativeOverlaySpec.run(spec.snap, NativeOverlaySpec.curve(spec.easeOut, fallback: .easeOut), {
                    self.view.transform = .identity
                    scrim?.alpha = 1
                })
            }
        default:
            break
        }
    }
}
