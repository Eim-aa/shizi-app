import UIKit

// ShiziKit（B3.1）：居中确认框（原在 NativeSkipEnd.swift）。


/// 「结束这组」居中确认框（S04）：正文 + 两键 [结束这组（普通） | 接着写（主按钮）]，不预选；点遮罩 = 接着写。
/// 写入失败留在框里（R-G04 三段式）：正文换「没保存上，你写的字还在。」、按钮换 [先不保存（文字按钮）| 再试一次（主按钮）]（网页 FailBlock dialog）。
/// 视觉照网页（R9-B）：左右页边 20、垂直居中、24 圆角、elev 底、内边距 24 / 20 / 20、正文 15 / 22 ink2、两键上方 12 + 4、键高 btn-h；
/// 转场 T-confirm：进场由 0.96 放大淡入（confirmIn，ease.out），退场淡出（confirmOut，ease.in）；遮罩 scrimIn / scrimOut；减少动态效果 reduce 淡化。
final class NativeEndDialogView: UIView {
    struct Strings {
        var body = ""
        var end = ""
        var cont = ""
        var failed = ""
        var cancel = ""
        var retry = ""
    }

    struct Palette {
        var scrim = UIColor.black.withAlphaComponent(0.32)
        var panel = UIColor.systemBackground
        var ink1 = UIColor.label
        var ink2 = UIColor.secondaryLabel
        var ink4 = UIColor.separator
        var paper = UIColor.systemBackground
        var primary: UIColor?
        var primaryText: UIColor?
    }

    private(set) var isFailed = false
    var strings: Strings { didSet { render() } }
    var onContinue: (() -> Void)?
    var onEnd: (() -> Void)?
    var onCancelFail: (() -> Void)?

    private let palette: Palette
    private let type: NativeType
    private let scrim = UIView()
    private let panel = UIView()
    private let bodyLabel = UILabel()
    private let leftButton = NativeTextButton(type: .system)
    private let rightButton = UIButton(type: .system)

    init(frame: CGRect, strings: Strings, palette: Palette, type: NativeType = NativeType()) {
        self.strings = strings
        self.palette = palette
        self.type = type
        super.init(frame: frame)
        scrim.backgroundColor = palette.scrim
        scrim.accessibilityIdentifier = "native-write-end-scrim"
        scrim.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapScrim)))
        addSubview(scrim)
        panel.backgroundColor = palette.panel
        panel.layer.cornerRadius = 24
        panel.layer.cornerCurve = .continuous
        panel.accessibilityIdentifier = "native-write-end-dialog"
        addSubview(panel)
        bodyLabel.numberOfLines = 0
        bodyLabel.accessibilityIdentifier = "native-write-end-body"
        panel.addSubview(bodyLabel)
        for b in [leftButton, rightButton] {
            b.titleLabel?.numberOfLines = 2
            b.titleLabel?.textAlignment = .center
            b.layer.cornerRadius = 12
            b.layer.cornerCurve = .continuous
            panel.addSubview(b)
        }
        rightButton.titleLabel?.font = type.font("fs17", weight: .medium)
        rightButton.backgroundColor = palette.primary ?? palette.ink1
        rightButton.setTitleColor(palette.primaryText ?? palette.paper, for: .normal)
        leftButton.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            self.isFailed ? self.onCancelFail?() : self.onEnd?()
        }, for: .touchUpInside)
        rightButton.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            self.isFailed ? self.onEnd?() : self.onContinue?()
        }, for: .touchUpInside)
        isAccessibilityElement = false
        accessibilityViewIsModal = true
        accessibilityElements = [bodyLabel, leftButton, rightButton]
        render()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func setFailed(_ failed: Bool) {
        isFailed = failed
        render()
        setNeedsLayout()
        NativeA11y.layoutChanged(bodyLabel)
    }

    private func render() {
        NativeType.set(bodyLabel, isFailed ? strings.failed : strings.body, font: type.font("fs15"), color: palette.ink2)
        leftButton.setTitle(isFailed ? strings.cancel : strings.end, for: .normal)
        rightButton.setTitle(isFailed ? strings.retry : strings.cont, for: .normal)
        // 普通按钮（墨四描边、17 / 500 墨一）；失败态换成文字按钮「先不保存」（15，ink2，在左栏居中）
        leftButton.titleLabel?.font = isFailed ? type.font("fs15") : type.font("fs17", weight: .medium)
        leftButton.setTitleColor(isFailed ? palette.ink2 : palette.ink1, for: .normal)
        // 键的左右内边距 24（网页 .sz-btn--primary / --secondary padding 0 24）：AX 档字折行时每行能放几个字与网页相同；失败态的文字按钮 4
        leftButton.contentEdgeInsets = UIEdgeInsets(top: 0, left: isFailed ? 4 : 24, bottom: 0, right: isFailed ? 4 : 24)
        rightButton.contentEdgeInsets = UIEdgeInsets(top: 0, left: 24, bottom: 0, right: 24)
        leftButton.layer.borderWidth = isFailed ? 0 : 1
        leftButton.layer.borderColor = palette.ink4.cgColor
        leftButton.accessibilityIdentifier = isFailed ? "native-write-end-fail-cancel" : "native-write-end-confirm"
        rightButton.accessibilityIdentifier = isFailed ? "native-write-end-retry" : "native-write-end-continue"
        setNeedsLayout()
    }

    @objc private func tapScrim() { onContinue?() } // 点遮罩 = 接着写（失败态同样是关框）

    /// 键上的字在半宽里放不下一行（AX 档）：键长高成两行。
    private func needsTwoLines(_ innerW: CGFloat) -> Bool {
        let room = (innerW - 12) / 2 - 16
        return [leftButton, rightButton].contains { NativeType.width($0.titleLabel ?? UILabel()) > room }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        scrim.frame = bounds
        // --elev-shadow：浅色墨 10%（上移 10、模糊 30），深色只有一条极淡的上沿高光
        let dark = traitCollection.userInterfaceStyle == .dark
        ShiziElev.apply(panel, dark: dark) // --elev-shadow：模糊影子 + 上沿发丝线（ShiziKit ShiziElev）
        let gutter: CGFloat = 20
        let w = bounds.width - 2 * gutter
        let padX: CGFloat = 20
        let innerW = w - 2 * padX
        [leftButton, rightButton].forEach { NativeType.trackTitle($0) } // 中文字距同网页（B2.9b）
        let source = isFailed ? strings.failed : strings.body
        // 网页 p 的 text-wrap: pretty（两行时末行太短就在句读后折行）
        NativeType.set(bodyLabel, NativeType.pretty(source, font: bodyLabel.font, width: innerW), font: type.font("fs15"), color: palette.ink2, line: type.line("lh15"))
        bodyLabel.accessibilityLabel = source
        let bodyH = NativeType.height(bodyLabel, width: innerW, line: type.line("lh15"))
        let lineH = ceil(type.font("fs17").lineHeight)
        let half = (innerW - 12) / 2
        // AX 档（B2.9b）：两键按网页版排——min-height --btn-h、上下内边距 6、字按行数长高（两键一行同高，取高的）
        let axH = [(leftButton, "r"), (rightButton, "r2")].compactMap { b, sub in
            type.axButtonHeight("confirm", sub: sub == "r" ? nil : sub, title: b.title(for: .normal), font: b.titleLabel?.font, width: half - 48)
        }.max()
        let btnH = axH ?? (needsTwoLines(innerW) ? max(type.value("btn-h"), lineH * 2 + 20) : type.value("btn-h"))
        let contentH = 24 + bodyH + 12 + 4 + btnH + 20
        let safe = safeAreaInsets
        let maxH = bounds.height - safe.top - safe.bottom - 48
        let h = min(contentH, maxH)
        panel.frame = CGRect(x: gutter, y: (bounds.height - h) / 2, width: w, height: h)
        bodyLabel.frame = CGRect(x: padX, y: 24, width: innerW, height: bodyH)
        let by = 24 + bodyH + 16
        if isFailed {
            let lw = NativeType.width(leftButton.titleLabel ?? UILabel()) + 8
            leftButton.frame = CGRect(x: padX + (half - lw) / 2, y: by + (btnH - 44) / 2, width: lw, height: 44)
        } else {
            leftButton.frame = CGRect(x: padX, y: by, width: half, height: btnH)
        }
        rightButton.frame = CGRect(x: padX + half + 12, y: by, width: half, height: btnH)
    }

    /// 进场：遮罩淡入；面板由 confirmFrom 放大淡入（减少动态效果：整体 reduce 淡化）。
    func animateIn(_ spec: NativeOverlaySpec, reduce: Bool) {
        if reduce {
            alpha = 0
            NativeOverlaySpec.run(spec.reduce, UICubicTimingParameters(animationCurve: .linear), { self.alpha = 1 })
            return
        }
        scrim.alpha = 0
        panel.alpha = 0
        panel.transform = CGAffineTransform(scaleX: spec.confirmFrom, y: spec.confirmFrom)
        NativeOverlaySpec.run(spec.scrimIn, NativeOverlaySpec.curve(spec.easeOut, fallback: .easeOut), { self.scrim.alpha = 1 })
        NativeOverlaySpec.run(spec.confirmIn, NativeOverlaySpec.curve(spec.easeOut, fallback: .easeOut), {
            self.panel.alpha = 1
            self.panel.transform = .identity
        })
    }

    /// 退场：面板淡出（confirmOut，ease.in）、遮罩淡出（scrimOut）；完了从父视图拿掉。
    func animateOut(_ spec: NativeOverlaySpec, reduce: Bool) {
        isUserInteractionEnabled = false
        if reduce {
            NativeOverlaySpec.run(spec.reduce, UICubicTimingParameters(animationCurve: .linear), { self.alpha = 0 }, done: { self.removeFromSuperview() })
            return
        }
        let curve = NativeOverlaySpec.curve(spec.easeIn, fallback: .easeIn)
        NativeOverlaySpec.run(spec.confirmOut, curve, { self.panel.alpha = 0 })
        NativeOverlaySpec.run(max(spec.scrimOut, spec.confirmOut), curve, { self.scrim.alpha = 0 }, done: { self.removeFromSuperview() })
    }

    var bodyForTesting: String { isFailed ? strings.failed : strings.body }
    var leftTitleForTesting: String { leftButton.title(for: .normal) ?? "" }
    var rightTitleForTesting: String { rightButton.title(for: .normal) ?? "" }
    func tapLeftForTesting() { leftButton.sendActions(for: .touchUpInside) }
    func tapRightForTesting() { rightButton.sendActions(for: .touchUpInside) }
    func tapScrimForTesting() { tapScrim() }
}
