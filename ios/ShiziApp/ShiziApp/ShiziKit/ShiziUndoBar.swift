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

    /// 细边宽（网页 border:1px，border-box：边在盒内、内边距之外）。
    private var edge: CGFloat { layer.borderWidth }

    /// 「撤销」等文字按钮的高：44；AX 档按字号长高（网页 components/ax.js .sz-btn--text min-height max(44, 1.3em + 12)，量到的值）。
    private var buttonH: CGFloat { max(44, type.role("undoBar", "minH") ?? 44) }
    /// 字与按钮之间 / 折行后两行之间的间距（网页 gap s3）。
    private var colGap: CGFloat { type.role("undoBar", "colGap", sub: "r2") ?? 12 }
    private var rowGap: CGFloat { type.role("undoBar", "gap", sub: "r2") ?? 12 }

    /// 网页 .sz-skipbar 的 flex-wrap：字（单行的自然宽）+ 间距 + 按钮放不下一行时，按钮折到下一行行首（AX 档「已跳过「永」」49pt 时就是这样）。
    private func plan(width: CGFloat) -> (wrap: Bool, textW: CGFloat, textH: CGFloat, height: CGFloat) {
        let inner = max(0, width - 16 - 8 - 2 * edge)
        let bw = buttonsWidth()
        let natural = ceil(NativeType.width(label))
        let wrap = natural + colGap + bw > inner + 0.5
        let textW = wrap ? inner : max(60, inner - colGap - bw)
        let textH = NativeType.height(label, width: textW, line: type.line("lh15"))
        let content = wrap ? textH + rowGap + buttonH : max(textH, buttonH)
        return (wrap, textW, textH, max(48, content + 16 + 2 * edge))
    }

    /// 按给定宽度算出整条的高度：max(48, 内容高 + 上下 8 + 上下细边)。
    func height(for width: CGFloat) -> CGFloat { plan(width: width).height }

    override func layoutSubviews() {
        super.layoutSubviews()
        if layer.shadowOpacity > 0 { layer.shadowPath = UIBezierPath(roundedRect: bounds, cornerRadius: layer.cornerRadius).cgPath }
        buttons().forEach { NativeType.trackTitle($0) } // 中文字距同网页（B2.9b）
        accessibilityElements = [label] + buttons() // 读屏：先读「已跳过「永」」再读「撤销」（网页 DOM 顺序；几何排序会把靠上的按钮排前）
        let p = plan(width: bounds.width)
        let left = 16 + edge
        if p.wrap {
            let top = (bounds.height - (p.textH + rowGap + buttonH)) / 2
            label.frame = CGRect(x: left, y: top, width: p.textW, height: p.textH)
            var x = left
            for b in buttons() {
                let w = buttonWidth(b)
                b.frame = CGRect(x: x, y: top + p.textH + rowGap, width: w, height: buttonH)
                x += w + 4
            }
        } else {
            var x = bounds.width - 8 - edge
            for b in buttons().reversed() {
                let w = buttonWidth(b)
                x -= w
                b.frame = CGRect(x: x, y: (bounds.height - buttonH) / 2, width: w, height: buttonH)
                x -= 4
            }
            label.frame = CGRect(x: left, y: (bounds.height - p.textH) / 2, width: p.textW, height: p.textH)
        }
    }

    var undoButtonForTesting: UIButton { undoButton }
    var retryButtonForTesting: UIButton { retryButton }
    var cancelButtonForTesting: UIButton { cancelButton }
    var textForTesting: String { label.text ?? "" }
}
