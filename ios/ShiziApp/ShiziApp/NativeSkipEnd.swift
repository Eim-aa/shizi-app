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

/// 底部轻提示：「已跳过「X」· 撤销」；撤销写失败时换成「没保存上，你写的字还在。」+ [先不保存 / 再试一次]（不自动消失）。撤销条同一视觉（toast 底 / 字）。
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
    private let undoButton = UIButton(type: .system)
    private let cancelButton = UIButton(type: .system)
    private let retryButton = UIButton(type: .system)
    private let press = UILongPressGestureRecognizer()
    private let fg: UIColor

    init(background: UIColor, foreground: UIColor) {
        fg = foreground
        super.init(frame: .zero)
        backgroundColor = background
        layer.cornerRadius = 12
        label.font = UIFont.preferredFont(forTextStyle: .subheadline)
        label.adjustsFontForContentSizeCategory = true
        label.textColor = foreground
        label.numberOfLines = 0
        label.accessibilityTraits = [.updatesFrequently]
        label.accessibilityIdentifier = "native-write-undo-text"
        for (b, id) in [(undoButton, "native-write-skip-undo"), (cancelButton, "native-write-skip-undo-cancel"), (retryButton, "native-write-skip-undo-retry")] {
            b.titleLabel?.font = UIFont.preferredFont(forTextStyle: .subheadline).withWeight(.medium)
            b.titleLabel?.adjustsFontForContentSizeCategory = true
            b.setTitleColor(foreground, for: .normal)
            b.tintColor = foreground
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
        label.text = isFailed ? strings.failed : strings.text
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

    private func buttonsWidth() -> CGFloat {
        buttons().reduce(0) { $0 + ceil($1.sizeThatFits(CGSize(width: 200, height: 44)).width) + 16 }
    }

    /// 按给定宽度算出整条的高度（最少 48）。
    func height(for width: CGFloat) -> CGFloat {
        let textW = max(60, width - 16 - 8 - buttonsWidth())
        let h = ceil(label.sizeThatFits(CGSize(width: textW, height: .greatestFiniteMagnitude)).height)
        return max(48, h + 16)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        var x = bounds.width - 8
        for b in buttons().reversed() {
            let w = ceil(b.sizeThatFits(CGSize(width: 200, height: 44)).width) + 16
            x -= w
            b.frame = CGRect(x: x, y: (bounds.height - 44) / 2, width: w, height: 44)
        }
        label.frame = CGRect(x: 16, y: 0, width: max(0, x - 16 - 8), height: bounds.height)
    }

    var undoButtonForTesting: UIButton { undoButton }
    var retryButtonForTesting: UIButton { retryButton }
    var cancelButtonForTesting: UIButton { cancelButton }
    var textForTesting: String { label.text ?? "" }
}

private extension UIFont {
    func withWeight(_ w: UIFont.Weight) -> UIFont {
        UIFont.systemFont(ofSize: pointSize, weight: w)
    }
}

/// 「结束这组」居中确认框（S04）：正文 + 两键 [结束这组（普通） | 接着写（主按钮）]，不预选；点遮罩 = 接着写。
/// 写入失败留在框里（R-G04 三段式）：正文换「没保存上，你写的字还在。」、按钮换 [先不保存 | 再试一次]。
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
    }

    private(set) var isFailed = false
    var strings: Strings { didSet { render() } }
    var onContinue: (() -> Void)?
    var onEnd: (() -> Void)?
    var onCancelFail: (() -> Void)?

    private let palette: Palette
    private let scrim = UIView()
    private let panel = UIView()
    private let bodyLabel = UILabel()
    private let leftButton = UIButton(type: .system)
    private let rightButton = UIButton(type: .system)

    init(frame: CGRect, strings: Strings, palette: Palette) {
        self.strings = strings
        self.palette = palette
        super.init(frame: frame)
        scrim.backgroundColor = palette.scrim
        scrim.accessibilityIdentifier = "native-write-end-scrim"
        scrim.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapScrim)))
        addSubview(scrim)
        panel.backgroundColor = palette.panel
        panel.layer.cornerRadius = 20
        panel.layer.shadowColor = UIColor.black.cgColor
        panel.layer.shadowOpacity = 0.14
        panel.layer.shadowRadius = 24
        panel.layer.shadowOffset = CGSize(width: 0, height: 8)
        panel.accessibilityIdentifier = "native-write-end-dialog"
        addSubview(panel)
        bodyLabel.font = UIFont.preferredFont(forTextStyle: .subheadline)
        bodyLabel.adjustsFontForContentSizeCategory = true
        bodyLabel.textColor = palette.ink2
        bodyLabel.numberOfLines = 0
        bodyLabel.accessibilityIdentifier = "native-write-end-body"
        panel.addSubview(bodyLabel)
        for b in [leftButton, rightButton] {
            b.titleLabel?.font = UIFont.preferredFont(forTextStyle: .body).withWeight(.medium)
            b.titleLabel?.adjustsFontForContentSizeCategory = true
            b.titleLabel?.numberOfLines = 2
            b.titleLabel?.textAlignment = .center
            b.layer.cornerRadius = 12
            panel.addSubview(b)
        }
        leftButton.setTitleColor(palette.ink1, for: .normal)
        leftButton.layer.borderWidth = 1
        leftButton.layer.borderColor = palette.ink4.cgColor
        rightButton.backgroundColor = palette.ink1
        rightButton.setTitleColor(palette.paper, for: .normal)
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
        bodyLabel.text = isFailed ? strings.failed : strings.body
        leftButton.setTitle(isFailed ? strings.cancel : strings.end, for: .normal)
        rightButton.setTitle(isFailed ? strings.retry : strings.cont, for: .normal)
        leftButton.accessibilityIdentifier = isFailed ? "native-write-end-fail-cancel" : "native-write-end-confirm"
        rightButton.accessibilityIdentifier = isFailed ? "native-write-end-retry" : "native-write-end-continue"
        setNeedsLayout()
    }

    @objc private func tapScrim() { onContinue?() } // 点遮罩 = 接着写（失败态同样是关框）

    override func layoutSubviews() {
        super.layoutSubviews()
        scrim.frame = bounds
        let gutter: CGFloat = 20
        let w = bounds.width - 2 * gutter
        let padX: CGFloat = 20
        let innerW = w - 2 * padX
        let bodyH = ceil(bodyLabel.sizeThatFits(CGSize(width: innerW, height: .greatestFiniteMagnitude)).height)
        let btnH = max(54, ceil((rightButton.titleLabel?.font.lineHeight ?? 22)) * 2 + 20)
        let half = (innerW - 12) / 2
        let lh = max(btnH, 54)
        let contentH = 24 + bodyH + 16 + lh + 20
        let safe = safeAreaInsets
        let maxH = bounds.height - safe.top - safe.bottom - 48
        let h = min(contentH, maxH)
        panel.frame = CGRect(x: gutter, y: (bounds.height - h) / 2, width: w, height: h)
        bodyLabel.frame = CGRect(x: padX, y: 24, width: innerW, height: bodyH)
        leftButton.frame = CGRect(x: padX, y: 24 + bodyH + 16, width: half, height: lh)
        rightButton.frame = CGRect(x: padX + half + 12, y: 24 + bodyH + 16, width: half, height: lh)
    }

    var bodyForTesting: String { bodyLabel.text ?? "" }
    var leftTitleForTesting: String { leftButton.title(for: .normal) ?? "" }
    var rightTitleForTesting: String { rightButton.title(for: .normal) ?? "" }
    func tapLeftForTesting() { leftButton.sendActions(for: .touchUpInside) }
    func tapRightForTesting() { rightButton.sendActions(for: .touchUpInside) }
    func tapScrimForTesting() { tapScrim() }
}
#endif
