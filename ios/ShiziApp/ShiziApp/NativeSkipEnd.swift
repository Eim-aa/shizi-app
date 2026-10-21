#if DEBUG
import UIKit

// 原生写字页的跳过撤销条与「结束这组」确认框（B2.6；确认单 6、7；D68 ③ ④、D36 / P115、D66 ⑥；S1 / S04）。
//
// 规则在页面：skip / undoSkip / end 由写字会话 API 提交（src/session/ops/skip.js、end.js，与网页同一批函数）；撤销条的寿命参数（5 秒、按住暂停、
// 读屏不自动收起）来自 open 回包 skipUndo（policy.skipUndo）。这里只有视图那一半与寿命计时（NativeUndoLifetime = write/skip.js createUndoLifetime 的移植，
// 时钟与定时器可注入，XCTest 用假时钟逐条对照）。文案全部来自页面（open 回包的 copy 字典），本文件不写用户可见的字。

/// 撤销条的自动收起计时（write/skip.js createUndoLifetime 的移植）：
///   start：从现在起算 ms；hold / release：手指按在撤销条上时暂停、松开后用剩下的时间继续（pauseWhileHeld = false 时忽略）；
///   到点时若读屏 / 切换控制在运行（assistive()）则不收起、改为「钉住」，assistiveChanged(false) 后重新给一整段 ms；stop：取消（用户已经往下操作 / 离开）。
/// 到期只调一次 onExpire。
final class NativeUndoLifetime {
    typealias Cancel = () -> Void

    let ms: Double
    private let pauseWhileHeld: Bool
    private let keepOpenWithAssistiveTech: Bool
    private let now: () -> Double
    private let schedule: (Double, @escaping () -> Void) -> Cancel
    private let assistive: () -> Bool
    private let onExpire: () -> Void
    private var deadline: Double?
    private var cancelTimer: Cancel?
    private var heldAt: Double?
    private var pinned = false
    private var stopped = false
    private var done = false

    static func systemNow() -> Double { CACurrentMediaTime() * 1000 }

    static func systemSchedule(_ delayMs: Double, _ fire: @escaping () -> Void) -> Cancel {
        let item = DispatchWorkItem(block: fire)
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0, delayMs) / 1000, execute: item)
        return { item.cancel() }
    }

    static var systemAssistive: Bool { UIAccessibility.isVoiceOverRunning || UIAccessibility.isSwitchControlRunning }

    init(ms: Double, pauseWhileHeld: Bool = true, keepOpenWithAssistiveTech: Bool = true,
         now: @escaping () -> Double = NativeUndoLifetime.systemNow,
         schedule: @escaping (Double, @escaping () -> Void) -> Cancel = NativeUndoLifetime.systemSchedule,
         assistive: @escaping () -> Bool = { NativeUndoLifetime.systemAssistive },
         onExpire: @escaping () -> Void) {
        self.ms = ms
        self.pauseWhileHeld = pauseWhileHeld
        self.keepOpenWithAssistiveTech = keepOpenWithAssistiveTech
        self.now = now
        self.schedule = schedule
        self.assistive = assistive
        self.onExpire = onExpire
    }

    private func cancel() {
        cancelTimer?()
        cancelTimer = nil
    }

    private func fire() {
        cancelTimer = nil
        if stopped || done { return }
        if keepOpenWithAssistiveTech, assistive() {
            pinned = true
            return
        }
        done = true
        onExpire()
    }

    private func reschedule() {
        cancel()
        guard !stopped, !done, heldAt == nil, let d = deadline else { return }
        cancelTimer = schedule(max(0, d - now())) { [weak self] in self?.fire() }
    }

    func start() {
        stopped = false
        done = false
        pinned = false
        heldAt = nil
        if deadline == nil { deadline = now() + ms }
        reschedule()
    }

    func hold() {
        guard pauseWhileHeld, !stopped, !done, heldAt == nil else { return }
        heldAt = now()
        cancel()
    }

    func release() {
        guard let h = heldAt, let d = deadline else { return }
        deadline = d + (now() - h)
        heldAt = nil
        reschedule()
    }

    /// 读屏状态变了：关掉且之前被钉住 → 重新给一整段。
    func assistiveChanged(_ active: Bool) {
        guard !active, pinned, !stopped, !done else { return }
        pinned = false
        deadline = now() + ms
        reschedule()
    }

    func stop() {
        stopped = true
        cancel()
    }

    /// 还剩多少毫秒（按住时是按住那一刻剩的；已钉住 / 已结束 / 已取消 → 钉住时给一整段，其余 0）。离开写字页时交给来源页 / 结果页接着走。
    var remainingMs: Double {
        guard !stopped, !done, let d = deadline else { return 0 }
        if pinned { return ms }
        return max(0, d - (heldAt ?? now()))
    }
}

/// 底部轻提示：「已跳过「X」· 撤销」；撤销写失败时换成「没保存上，你写的字还在。」+ [先不保存 / 再试一次]（不自动消失）。
/// 视觉照网页 UndoBar.js / skip.js（R9-B，NP-19）：最小高 48、上下内边距 8、左 16 右 8；字 15 / 22；
/// 「撤销」是 15 / 500 的文字按钮（盒子 = 字宽 + 8、44 高，点击区仍 ≥ 44）；条贴在底栏上方 8（写字页排）。
/// 外观是 L4 浮条（R10-B，D71 ③）：浮起的浅面 toast-bg（= elev）+ 1pt toast-line 细边 + toast-shadow 轻阴影、r-box 圆角（24，单行即胶囊），
/// 正文 toast-fg、操作 toast-act——全部取页面令牌（NativeToastStyle），不写死；实心深色只给主按钮。
struct NativeToastStyle {
    var background: UIColor
    var foreground: UIColor
    var action: UIColor
    var line: UIColor?
    var shadow: (dx: CGFloat, dy: CGFloat, blur: CGFloat, color: UIColor)?
    var radius: CGFloat
}

final class NativeUndoBarView: UIView, UIGestureRecognizerDelegate {
    struct Strings {
        var text = ""
        var undo = ""
        var failed = ""
        var cancel = ""
        var retry = ""
    }

    var strings = Strings() { didSet { render() } }
    private(set) var isFailed = false
    var onUndo: (() -> Void)?
    var onCancelFail: (() -> Void)?
    /// 手指按在撤销条上（暂停计时）/ 抬起、取消（接着走）。
    var onHold: (() -> Void)?
    var onRelease: (() -> Void)?

    private let label = UILabel()
    private let undoButton = NativeTextButton(type: .system)
    private let cancelButton = NativeTextButton(type: .system)
    private let retryButton = NativeTextButton(type: .system)
    private let press = UILongPressGestureRecognizer()
    private let fg: UIColor
    private let type: NativeType

    convenience init(background: UIColor, foreground: UIColor, type: NativeType = NativeType()) {
        self.init(style: NativeToastStyle(background: background, foreground: foreground, action: foreground, line: nil, shadow: nil, radius: type.value("r-box")), type: type)
    }

    init(style: NativeToastStyle, type: NativeType = NativeType()) {
        fg = style.foreground
        let foreground = style.action
        self.type = type
        super.init(frame: .zero)
        backgroundColor = style.background
        layer.cornerRadius = style.radius
        layer.cornerCurve = .continuous
        if let line = style.line {
            layer.borderWidth = 1
            layer.borderColor = line.cgColor
        }
        if let sh = style.shadow {
            layer.shadowColor = sh.color.withAlphaComponent(1).cgColor
            layer.shadowOpacity = Float(sh.color.cgColor.alpha)
            layer.shadowOffset = CGSize(width: sh.dx, height: sh.dy)
            layer.shadowRadius = sh.blur / 2
        }
        label.numberOfLines = 0
        label.accessibilityTraits = [.updatesFrequently]
        label.accessibilityIdentifier = "native-write-undo-text"
        for (b, id) in [(undoButton, "native-write-skip-undo"), (cancelButton, "native-write-skip-undo-cancel"), (retryButton, "native-write-skip-undo-retry")] {
            b.titleLabel?.font = type.font("fs15", weight: .medium)
            b.setTitleColor(foreground, for: .normal)
            b.setTitleColor(foreground.withAlphaComponent(0.55), for: .disabled)
            b.tintColor = foreground
            b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
            b.accessibilityIdentifier = id
            addSubview(b)
        }
        undoButton.addAction(UIAction { [weak self] _ in self?.onUndo?() }, for: .touchUpInside)
        retryButton.addAction(UIAction { [weak self] _ in self?.onUndo?() }, for: .touchUpInside)
        cancelButton.addAction(UIAction { [weak self] _ in self?.onCancelFail?() }, for: .touchUpInside)
        addSubview(label)
        // 手指按住（含按在「撤销」上）：暂停；松开 / 取消 / 移出：接着走（网页 pointerdown / up / cancel / leave）
        press.minimumPressDuration = 0
        press.cancelsTouchesInView = false
        press.delegate = self
        press.addTarget(self, action: #selector(pressed(_:)))
        addGestureRecognizer(press)
        accessibilityIdentifier = "native-write-undo-bar"
        render()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func setFailed(_ failed: Bool) {
        isFailed = failed
        render()
        setNeedsLayout()
    }

    private func render() {
        NativeType.set(label, isFailed ? strings.failed : strings.text, font: type.font("fs15"), color: fg, line: type.line("lh15"))
        undoButton.setTitle(strings.undo, for: .normal)
        cancelButton.setTitle(strings.cancel, for: .normal)
        retryButton.setTitle(strings.retry, for: .normal)
        undoButton.isHidden = isFailed
        cancelButton.isHidden = !isFailed
        retryButton.isHidden = !isFailed
        accessibilityLabel = nil
        setNeedsLayout()
    }

    @objc private func pressed(_ g: UILongPressGestureRecognizer) {
        switch g.state {
        case .began: onHold?()
        case .ended, .cancelled, .failed: onRelease?()
        default: break
        }
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    private func buttons() -> [UIButton] { isFailed ? [cancelButton, retryButton] : [undoButton] }

    private func buttonWidth(_ b: UIButton) -> CGFloat { NativeType.width(b.titleLabel ?? UILabel()) + 8 }

    /// 按钮区宽（失败两键间 4）。
    private func buttonsWidth() -> CGFloat {
        let bs = buttons()
        return bs.reduce(0) { $0 + buttonWidth($1) } + CGFloat(max(0, bs.count - 1)) * 4
    }

    /// 按给定宽度算出整条的高度：max(48, max(字高, 44) + 上下 8 + 上下细边)。
    /// 细边宽（网页 border:1px，border-box：边在盒内、内边距之外）。
    private var edge: CGFloat { layer.borderWidth }

    func height(for width: CGFloat) -> CGFloat {
        let textW = max(60, width - 16 - 8 - 12 - 2 * edge - buttonsWidth())
        let h = NativeType.height(label, width: textW, line: type.line("lh15"))
        return max(48, max(h, 44) + 16 + 2 * edge)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if layer.shadowOpacity > 0 { layer.shadowPath = UIBezierPath(roundedRect: bounds, cornerRadius: layer.cornerRadius).cgPath }
        var x = bounds.width - 8 - edge
        for b in buttons().reversed() {
            let w = buttonWidth(b)
            x -= w
            b.frame = CGRect(x: x, y: (bounds.height - 44) / 2, width: w, height: 44)
            x -= 4
        }
        let textW = max(0, x + 4 - 12 - 16 - edge)
        let h = NativeType.height(label, width: textW, line: type.line("lh15"))
        label.frame = CGRect(x: 16 + edge, y: (bounds.height - h) / 2, width: textW, height: h)
    }

    var undoButtonForTesting: UIButton { undoButton }
    var retryButtonForTesting: UIButton { retryButton }
    var cancelButtonForTesting: UIButton { cancelButton }
    var textForTesting: String { label.text ?? "" }
}

/// 「结束这组」居中确认框（S04）：正文 + 两键 [结束这组（普通） | 接着写（主按钮）]，不预选；点遮罩 = 接着写。
/// 写入失败留在框里（R-G04 三段式）：正文换「没保存上，你写的字还在。」、按钮换 [先不保存（文字按钮）| 再试一次（主按钮）]（网页 FailBlock dialog）。
/// 视觉照网页 Confirm.js（R9-B）：左右页边 20、垂直居中、24 圆角、elev 底、内边距 24 / 20 / 20、正文 15 / 22 ink2、两键上方 12 + 4、键高 btn-h；
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
        UIAccessibility.post(notification: .layoutChanged, argument: bodyLabel)
    }

    private func render() {
        NativeType.set(bodyLabel, isFailed ? strings.failed : strings.body, font: type.font("fs15"), color: palette.ink2)
        leftButton.setTitle(isFailed ? strings.cancel : strings.end, for: .normal)
        rightButton.setTitle(isFailed ? strings.retry : strings.cont, for: .normal)
        // 普通按钮（墨四描边、17 / 500 墨一）；失败态换成文字按钮「先不保存」（15，ink2，在左栏居中）
        leftButton.titleLabel?.font = isFailed ? type.font("fs15") : type.font("fs17", weight: .medium)
        leftButton.setTitleColor(isFailed ? palette.ink2 : palette.ink1, for: .normal)
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
        panel.layer.shadowColor = (dark ? UIColor(red: 1, green: 240 / 255, blue: 220 / 255, alpha: 1) : UIColor(red: 38 / 255, green: 33 / 255, blue: 29 / 255, alpha: 1)).cgColor
        panel.layer.shadowOpacity = dark ? 0.06 : 0.10
        panel.layer.shadowRadius = dark ? 0 : 15
        panel.layer.shadowOffset = CGSize(width: 0, height: dark ? -0.5 : -10)
        let gutter: CGFloat = 20
        let w = bounds.width - 2 * gutter
        let padX: CGFloat = 20
        let innerW = w - 2 * padX
        let source = isFailed ? strings.failed : strings.body
        // 网页 p 的 text-wrap: pretty（两行时末行太短就在句读后折行）
        NativeType.set(bodyLabel, NativeType.pretty(source, font: bodyLabel.font, width: innerW), font: type.font("fs15"), color: palette.ink2, line: type.line("lh15"))
        bodyLabel.accessibilityLabel = source
        let bodyH = NativeType.height(bodyLabel, width: innerW, line: type.line("lh15"))
        let lineH = ceil(type.font("fs17").lineHeight)
        let btnH = needsTwoLines(innerW) ? max(type.value("btn-h"), lineH * 2 + 20) : type.value("btn-h")
        let half = (innerW - 12) / 2
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
#endif
