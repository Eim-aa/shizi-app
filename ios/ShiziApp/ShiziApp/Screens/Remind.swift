import UIKit
import UserNotifications

// B3.10 原生提醒页（网页 src/ui/screens/mine/remind.js；视图模型 src/session/views/settings.js 的 remindView，App API view.remind）。
// 屏名 ⇄ 类：remind ⇄ ShiziScreen_remind。
// 版式照网页 .sz-remind__* 逐项排（开关行 56 / 时间行 56 / 通知被手机关掉时的说明 / 写入失败的三段式 FailBlock），
// 数值取 ShiziTokens，文案取视图模型给的引用（ShiziCopyRef）。系统能力原生直接做：
// UNUserNotificationCenter 查 / 要权限、排接下来几天的通知；UIApplication 跳手机设置。
// 写 store 走会话层同一批函数（App API：remind.enabled / remind.time / reminder.status / reminder.plan）。

/// 网页量出的折行点（App API 回包里的 lines）：原生按这些位置断行，与网页同一个折行。
/// 网页的小字是 text-wrap: pretty（.sz-remind__sub），WebKit 的折法不是贪心折行（末行太短时它会把字往上一行挪），
/// 原生排版是贪心折行，所以断行点得由网页量出来给原生（量法见 src/platform/text-lines.js，与结果页 native-view.js 同一做法）。
private enum ShiziWebLines {
    /// 每一行从第几个字开始（网页量出来的）→ 带换行的字（量不到时原样返回，原生按自己的宽度折行）。
    static func breakText(_ text: String, _ starts: Any?) -> String {
        guard let starts = (starts as? [NSNumber])?.map({ $0.intValue }), !starts.isEmpty else { return text }
        var out = ""
        for (i, ch) in text.enumerated() {
            if starts.contains(i) { out.append("\n") }
            out.append(ch)
        }
        return out
    }
}

/// 通知权限（原生查到的结果 → App API reminder.status 的参数）。
private enum ShiziReminderPermission: String {
    case granted, denied, unknown
}

/// 时间框（网页是 <input type=time>）：只显示 HH:MM。
/// 网页 input 的值不是文字节点，取证清单里没有它——原生同样不做成文字标签（否则对比会多出一条文字）。
final class ShiziTimeField: UIView {
    /// 显示的 'HH:MM'。
    var value: String = "" { didSet { setNeedsDisplay(); accessibilityLabel = value } }
    /// 点按（弹时间轮）。
    var onPick: (() -> Void)?
    /// 字的字体与颜色（页面给，跟网页 input 的 font-size / color 一致）。
    var textFont: UIFont = .systemFont(ofSize: 15)
    var textColor: UIColor = .label

    override init(frame: CGRect) {
        super.init(frame: frame)
        isAccessibilityElement = true
        accessibilityTraits = [.button]
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func tapped() { onPick?() }

    override func draw(_ rect: CGRect) {
        guard !value.isEmpty else { return }
        let para = NSMutableParagraphStyle()
        para.alignment = .left
        let attrs: [NSAttributedString.Key: Any] = [.font: textFont, .foregroundColor: textColor, .paragraphStyle: para, .kern: 0]
        let s = NSAttributedString(string: value, attributes: attrs)
        let size = s.size()
        s.draw(at: CGPoint(x: 10, y: (rect.height - size.height) / 2))
    }
}

/// 时间轮（网页 <input type=time> 弹的是系统时间轮；原生用 UIDatePicker(.time, .wheels)）。
private final class ShiziTimePickerView: UIView {
    var onDone: ((Int, Int) -> Void)?
    var onCancel: (() -> Void)?

    private let scrim = UIView()
    private let panel = UIView()
    private let picker = UIDatePicker()
    private let doneButton = UIButton(type: .system)

    init(hour: Int, minute: Int) {
        super.init(frame: .zero)
        scrim.backgroundColor = UIColor.black.withAlphaComponent(0.32)
        scrim.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapScrim)))
        scrim.isAccessibilityElement = true
        scrim.accessibilityTraits = [.button]
        scrim.accessibilityIdentifier = "native-remind-time-cancel"
        addSubview(scrim)
        panel.backgroundColor = UIColor.systemBackground
        panel.layer.cornerRadius = 24
        panel.layer.cornerCurve = .continuous
        addSubview(panel)
        picker.datePickerMode = .time
        picker.preferredDatePickerStyle = .wheels
        var d = DateComponents()
        d.hour = hour
        d.minute = minute
        picker.date = Calendar.current.date(from: d) ?? Date()
        panel.addSubview(picker)
        doneButton.setTitle(ShiziCopy.t("X-COMMON.done"), for: .normal)
        doneButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .medium)
        doneButton.accessibilityIdentifier = "native-remind-time-done"
        doneButton.addAction(UIAction { [weak self] _ in self?.finish() }, for: .touchUpInside)
        panel.addSubview(doneButton)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func tapScrim() { onCancel?() }

    private func finish() {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: picker.date)
        onDone?(parts.hour ?? 0, parts.minute ?? 0)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        scrim.frame = bounds
        let w = min(bounds.width - 40, 320)
        let h: CGFloat = 300
        panel.frame = CGRect(x: (bounds.width - w) / 2, y: (bounds.height - h) / 2, width: w, height: h)
        picker.frame = CGRect(x: 0, y: 0, width: w, height: 240)
        doneButton.frame = CGRect(x: 0, y: 240, width: w, height: 60)
    }
}

@objc(ShiziScreen_remind)
final class RemindScreen: ShiziScreenViewController {
    struct View: Decodable {
        struct Remind: Decodable { let enabled: Bool; let hour: Int; let minute: Int; let permission: String }
        struct Sub: Decodable { let on: ShiziCopyRef; let denied: ShiziCopyRef }
        struct Note: Decodable { let body: ShiziCopyRef; let link: ShiziCopyRef }
        struct Fail: Decodable { let text: ShiziCopyRef; let cancel: ShiziCopyRef; let retry: ShiziCopyRef }
        struct Page: Decodable {
            let title: ShiziCopyRef
            let label: ShiziCopyRef
            let sub: Sub
            let timeLabel: ShiziCopyRef
            let time: String?
            let note: Note
            let fail: Fail
        }
        let remind: Remind
        let denied: Bool
        let on: Bool
        let remindPage: Page
    }

    /// 提醒排期（App API reminder.plan 的回包）。
    struct Plan: Decodable {
        struct Question: Decodable { let day: String; let title: ShiziCopyRef; let body: ShiziCopyRef }
        let enabled: Bool
        let hour: Int
        let minute: Int
        let practicedToday: Bool
        let questions: [Question]
    }

    // 视图（accessibilityIdentifier 与网页 data-testid 一一对应；成员名 = QA 取证的语义键）
    private let bodyView = UIView()
    private let switchButton = ShiziRowButton(type: .custom)
    private let switchTrack = UIView()
    private let switchKnob = UIView()
    private let timeRow = UIView()
    private let timeLabel = UILabel()
    private let timeField = ShiziTimeField()
    private let noteView = UIView()
    private let noteLabel = UILabel()
    private let noteButton = NativeTextButton(type: .custom)
    private let failView = UIView()
    private let failNote = UILabel()
    private let failCancel = NativeTextButton(type: .custom)
    private let failRetry = UIButton(type: .custom)
    /// 行的发丝线（网页 .sz-remind__row：border-top / border-bottom 0.5px line，相邻两行之间只一条）：开关行上沿、开关行下沿、时间行下沿。
    private let rowLines = (0..<3).map { _ in UIView() }

    private var model: View?
    /// 网页量出的折行点（App API view.remind 回包里的 lines）：开关行的小字。
    private var lines: [String: Any] = [:]
    /// 失败的是哪个动作（'remind' / 'time'）；null = 没有失败块。
    private var failField: String?
    /// 失败后「再试一次」要重跑的动作。
    private var retryAction: (() -> Void)?
    private var timePicker: ShiziTimePickerView?

    override var watchedDomains: [String]? { ["settings"] }

    override func viewDidLoad() {
        super.viewDidLoad()
        bodyView.accessibilityIdentifier = "native-remind-body"
        switchButton.accessibilityIdentifier = "native-remind-switch"
        timeLabel.accessibilityIdentifier = "native-remind-time-label"
        timeField.accessibilityIdentifier = "native-remind-time"
        noteView.accessibilityIdentifier = "native-remind-note"
        noteLabel.accessibilityIdentifier = "native-remind-note-text"
        noteButton.accessibilityIdentifier = "native-remind-open-system"
        failView.accessibilityIdentifier = "native-remind-fail"
        failNote.accessibilityIdentifier = "native-remind-fail-note"
        failCancel.accessibilityIdentifier = "native-remind-fail-cancel"
        failRetry.accessibilityIdentifier = "native-remind-fail-retry"
        content.addSubview(bodyView)
        // 层级照网页 .sz-remind（正文块里依次是开关行 / 时间行 / 说明 / 失败三段式）
        bodyView.addSubview(switchButton)
        bodyView.addSubview(timeRow)
        bodyView.addSubview(noteView)
        bodyView.addSubview(failView)
        switchButton.addSubview(switchTrack)
        timeRow.addSubview(timeLabel)
        timeRow.addSubview(timeField)
        noteView.addSubview(noteLabel)
        noteView.addSubview(noteButton)
        failView.addSubview(failNote)
        failView.addSubview(failCancel)
        failView.addSubview(failRetry)
        switchTrack.addSubview(switchKnob)
        rowLines.forEach { $0.isUserInteractionEnabled = false; bodyView.addSubview($0) }
        wire(switchButton) { page in (page as? RemindScreen)?.toggle() }
        wire(noteButton) { page in (page as? RemindScreen)?.openSystemSettings() }
        wire(failCancel) { page in (page as? RemindScreen)?.clearFail() }
        wire(failRetry) { page in (page as? RemindScreen)?.retry() }
        timeField.onPick = { [weak self] in self?.presentTimePicker() }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        applyQAPermissionOnce()
    }

    /// QA 运行（流程测试）：用启动参数模拟「通知被手机关掉」（-shizi-qa-remind-permission denied）。
    /// App 里系统权限是权威的（启动时 startReminder 会把真实权限写回 store，夹具种下的 denied 会被覆盖），
    /// 这条通道让流程测试能测到被拒版面；逐屏对比不传这个参数，网页参考与原生版面都不受影响。
    #if DEBUG
    private func applyQAPermissionOnce() {
        guard !qaPermissionApplied else { return }
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-shizi-qa-remind-permission"), i + 1 < args.count else { return }
        let value = args[i + 1]
        guard ["granted", "denied", "unknown"].contains(value) else { return }
        qaPermissionApplied = true
        call("reminder.status", ["permission": value]) { _ in }
    }

    private var qaPermissionApplied = false
    #else
    private func applyQAPermissionOnce() {}
    #endif

    // MARK: 视图

    /// App API 的回包（{ok, view, lines}）：lines = 网页量出的折行点（原生照它断行）。
    override func apply(payload: [String: Any]) {
        lines = payload["lines"] as? [String: Any] ?? [:]
        super.apply(payload: payload)
    }

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: View.self)
        model = m
        setTitle(m.remindPage.title.text)
        let mt = metrics
        // 开关行：标题 17 / 500 墨一，小字 13 / 墨三（通知被手机关掉时换 R-S02 的标题）
        let label = m.remindPage.label.text
        let sub = (m.denied ? m.remindPage.sub.denied : m.remindPage.sub.on).text
        NativeType.set(switchButton.label, label, font: mt.font(17, .medium), color: color("ink1"), line: mt.line("lh17s"))
        // 小字（网页 .sz-remind__sub：text-wrap:pretty，折行点由网页量出来）
        NativeType.set(switchButton.valueLabel, ShiziWebLines.breakText(sub, lines["sub"]), font: mt.font(13), color: color("ink3"), line: mt.line("lh13"))
        switchButton.label.numberOfLines = 0
        switchButton.valueLabel.numberOfLines = 0
        // 按钮自己继承正文的字体与颜色（网页 .sz-btn：font / color inherit；取证读按钮的 titleLabel）
        switchButton.titleLabel?.font = mt.font(15)
        switchButton.setTitleColor(color("ink1"), for: .normal)
        switchButton.setTitleColor(color("ink1"), for: .disabled)
        switchButton.accessibilityLabel = label
        switchButton.accessibilityValue = sub
        switchButton.accessibilityTraits = [.button]
        switchButton.isAccessibilityElement = true
        // 开关本体（网页 .sz-remind__switch，aria-hidden）：轨道 44 × 26、旋钮 20；关着时轨道描一圈墨三
        switchTrack.backgroundColor = color(m.on ? "ink1" : "line")
        switchTrack.layer.cornerRadius = 13
        switchTrack.layer.borderWidth = m.on ? 0 : 1
        switchTrack.layer.borderColor = color("ink3").cgColor
        switchKnob.backgroundColor = color(m.on ? "paper" : "sheet")
        switchKnob.layer.cornerRadius = 10
        // 时间行
        NativeType.set(timeLabel, m.remindPage.timeLabel.text, font: mt.font(17, .medium), color: color("ink1"), line: mt.line("lh17s"))
        timeLabel.numberOfLines = 0
        timeLabel.accessibilityLabel = m.remindPage.timeLabel.text
        let timeText = m.remindPage.time ?? ""
        timeField.value = timeText
        timeField.accessibilityLabel = timeText
        timeField.textColor = color("ink1")
        // 通知被手机关掉时的说明
        noteLabel.numberOfLines = 0
        NativeType.set(noteLabel, m.remindPage.note.body.text, font: mt.font(15), color: color("ink2"), line: mt.line("lh15"))
        noteLabel.accessibilityLabel = m.remindPage.note.body.text
        noteButton.setTitle(m.remindPage.note.link.text, for: .normal)
        noteButton.setTitleColor(color("ink1"), for: .normal)
        noteButton.titleLabel?.font = mt.font(15)
        noteButton.contentHorizontalAlignment = .left
        noteButton.contentEdgeInsets = .zero
        NativeType.trackTitle(noteButton)
        noteButton.accessibilityLabel = m.remindPage.note.link.text
        // 写入失败的三段式
        failNote.numberOfLines = 0
        NativeType.set(failNote, m.remindPage.fail.text.text, font: mt.font(15), color: color("ink2"), line: mt.line("lh15"))
        failNote.accessibilityLabel = m.remindPage.fail.text.text
        failCancel.setTitle(m.remindPage.fail.cancel.text, for: .normal)
        failCancel.setTitleColor(color("ink2"), for: .normal)
        failCancel.titleLabel?.font = mt.font(15)
        NativeType.trackTitle(failCancel)
        failCancel.accessibilityLabel = m.remindPage.fail.cancel.text
        failRetry.setTitle(m.remindPage.fail.retry.text, for: .normal)
        failRetry.setTitleColor(color("btn-fg"), for: .normal)
        failRetry.titleLabel?.font = mt.font(17, .medium)
        failRetry.backgroundColor = color("btn-bg")
        failRetry.layer.cornerRadius = 12
        failRetry.layer.cornerCurve = .continuous
        NativeType.trackTitle(failRetry)
        failRetry.accessibilityLabel = m.remindPage.fail.retry.text
        view.setNeedsLayout()
    }

    // MARK: 排版

    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat {
        let mt = metrics
        guard let m = model else { return top }
        var y: CGFloat = 0                          // bodyView 坐标（bodyView 在内容里的位置 = x / top）
        let gap: CGFloat = 12                       // 网页 .sz-remind__row 的间距
        // 开关行（网页 .sz-remind__row：最小高 56；文字块竖向居中，标题与字之间 1px）
        // 文字块的宽 = 整行减去右边的开关（44）与间距（12）；行高按内容（AX 档字会折行）
        let switchW: CGFloat = 44
        let textW = width - switchW - gap
        let titleH = NativeType.height(switchButton.label, width: textW, line: mt.line("lh17s"))
        let subH = NativeType.height(switchButton.valueLabel, width: textW, line: mt.line("lh13"))
        let blockH = titleH + 1 + subH
        let rowH: CGFloat = max(56, blockH)
        switchButton.frame = CGRect(x: 0, y: y, width: width, height: rowH)
        let blockTop = (rowH - blockH) / 2
        switchButton.label.frame = CGRect(x: 0, y: blockTop, width: textW, height: titleH)
        switchButton.valueLabel.frame = CGRect(x: 0, y: blockTop + titleH + 1, width: textW, height: subH)
        // 开关本体（网页 .sz-remind__switch：44 × 26、旋钮 20，右对齐）
        let trackW: CGFloat = 44, trackH: CGFloat = 26, knob: CGFloat = 20
        switchTrack.frame = CGRect(x: width - trackW, y: (rowH - trackH) / 2, width: trackW, height: trackH)
        switchKnob.frame = CGRect(x: m.on ? trackW - knob - 3 : 3, y: 3, width: knob, height: knob)
        // 行的发丝线（网页 border-box：线画在行框以内，上沿一条、下沿一条）
        let hair = shiziHairline(mt.value("hair"))
        rowLines.forEach { $0.backgroundColor = color("line") }
        rowLines[0].frame = CGRect(x: 0, y: y, width: width, height: hair)
        rowLines[1].frame = CGRect(x: 0, y: y + rowH - hair, width: width, height: hair)
        y += rowH
        // 时间行（开着时多一行）
        if m.on {
            timeRow.isHidden = false
            timeField.isHidden = false
            // 时间框（网页 .sz-remind__time：min-width 88、内边距 10、最小高 44；数字等宽）
            let fieldFont = Self.tabular(mt.font(15))
            let timeText = m.remindPage.time ?? ""
            let fieldW = max(88, ceil((timeText as NSString).size(withAttributes: [.font: fieldFont]).width) + 20)
            let fieldH = max(44, mt.line("lh15"))
            // 「提醒时间」的可用宽 = 整行减去时间框与间距（网页里标签是 flex 项，会被挤窄后折行）
            let labelW = width - fieldW - gap
            let labelH = NativeType.height(timeLabel, width: labelW, line: mt.line("lh17s"))
            let timeRowH = max(56, labelH, fieldH)
            timeRow.frame = CGRect(x: 0, y: y, width: width, height: timeRowH)
            timeLabel.frame = CGRect(x: 0, y: (timeRowH - labelH) / 2, width: labelW, height: labelH)
            timeField.frame = CGRect(x: width - fieldW, y: (timeRowH - fieldH) / 2, width: fieldW, height: fieldH)
            timeField.layer.cornerRadius = 12
            timeField.layer.cornerCurve = .continuous
            timeField.backgroundColor = color("field")
            timeField.textFont = fieldFont
            rowLines[2].isHidden = false
            rowLines[2].frame = CGRect(x: 0, y: y + timeRowH - hair, width: width, height: hair)
            y += timeRowH
        } else {
            rowLines[2].isHidden = true
            timeRow.isHidden = true
            timeField.isHidden = false
        }
        // 通知被手机关掉时的说明（网页 .sz-remind__note：上外边距 12；正文一行 + 「手机设置 ›」一行）
        if m.denied {
            noteView.isHidden = false
            y += mt.space(3)
            let noteH = NativeType.height(noteLabel, width: width, line: mt.line("lh15"))
            noteLabel.frame = CGRect(x: 0, y: 0, width: width, height: noteH)
            // 「手机设置 ›」是文字按钮（网页 .sz-btn--text：最小高 44、左右内边距 0、外边距 −4）
            let bw = ceil(NativeType.width(noteButton.titleLabel ?? UILabel())) + 8
            noteButton.frame = CGRect(x: -4, y: noteH, width: bw, height: mt.hit)
            noteView.frame = CGRect(x: 0, y: y, width: width, height: noteH + mt.hit)
            y += noteH + mt.hit
        } else {
            noteView.isHidden = true
        }
        // 写入失败的三段式（网页 FailBlock：说明 → 先不保存 → 再试一次；说明的下外边距 4、竖向间距 8）
        if failField != nil {
            failView.isHidden = false
            y += mt.space(3)
            let noteH = NativeType.height(failNote, width: width, line: mt.line("lh15"))
            failNote.frame = CGRect(x: 0, y: 0, width: width, height: noteH)
            var fy = noteH + mt.space(1) + mt.space(2)
            let cw = ceil(NativeType.width(failCancel.titleLabel ?? UILabel())) + 8
            failCancel.frame = CGRect(x: -4, y: fy, width: cw, height: mt.hit)
            fy += mt.hit + mt.space(2)
            failRetry.frame = CGRect(x: 0, y: fy, width: width, height: mt.value("btn-h"))
            fy += mt.value("btn-h")
            failView.frame = CGRect(x: 0, y: y, width: width, height: fy)
            y += fy
        } else {
            failView.isHidden = true
        }
        bodyView.frame = CGRect(x: x, y: top, width: width, height: y)
        return top + y
    }

    // MARK: 动作

    /// 开关：写 store →（开着时）向系统要权限 → 排通知。写失败 → 三段式。
    private func toggle() {
        guard let m = model else { return }
        let denied = m.denied
        let wasOn = m.on
        // 通知被手机关掉时（denied）开关显示关：再点一下 = 记下「要开」、重新向系统要一次权限并带去手机设置（iOS 只能在那里重新打开，网页 R-S02 同一条路）。
        let next = (denied && !wasOn) ? true : !wasOn
        clearFail()
        call("remind.enabled", ["on": next]) { [weak self] ok in
            guard let self else { return }
            guard ok else { self.showFail("remind") { self.toggle() }; return }
            if denied && !wasOn {
                self.requestPermission()
                self.syncPlan()
                self.openSystemSettings()
                return
            }
            if next {
                self.requestPermission()
                self.syncPlan()
            }
        }
    }

    private func requestPermission() {
        // QA 运行（逐屏取证 / 流程测试）不弹系统权限框：系统面板在测试宿主里没有替代品，
        // 参照 NativeSmoke 的做法（系统面板在冒烟里换成可断言的替身）。正式包走系统。
        guard !Self.qaMode else { return }
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { [weak self] settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                self?.reportPermission(.granted)
            case .denied:
                self?.reportPermission(.denied)
            default:
                break // 还没问过：先问系统
            }
        }
        center.requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] granted, _ in
            DispatchQueue.main.async {
                self?.reportPermission(granted ? .granted : .denied)
            }
        }
    }

    /// 权限回报（原生 → 会话层，同网页 applyReminderStatus 的写入那一半）。
    private func reportPermission(_ p: ShiziReminderPermission) {
        call("reminder.status", ["permission": p.rawValue]) { _ in }
    }

    /// 排接下来几天的通知（题目与时间由会话层算，原生只排期）。
    private func syncPlan() {
        guard let engine = stage?.engine else { return }
        Task { @MainActor [weak self] in
            guard let plan = try? await engine.call("reminder.plan", as: PlanReply.self) else { return }
            self?.schedule(plan: plan.plan)
        }
    }

    /// reminder.plan 的回包。
    private struct PlanReply: Decodable { let plan: Plan }

    /// 排期（UNUserNotificationCenter）：每天一条，题目与正文取会话层给的文案引用。
    private func schedule(plan: Plan) {
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()
        for q in plan.questions {
            let parts = q.day.split(separator: "-").compactMap { Int($0) }
            guard parts.count == 3 else { continue }
            var d = DateComponents()
            d.year = parts[0]; d.month = parts[1]; d.day = parts[2]
            d.hour = plan.hour; d.minute = plan.minute
            let content = UNMutableNotificationContent()
            content.title = q.title.text
            content.body = q.body.text
            let request = UNNotificationRequest(identifier: "shizi-reminder-\(q.day)", content: content, trigger: UNCalendarNotificationTrigger(dateMatching: d, repeats: false))
            center.add(request, withCompletionHandler: nil)
        }
    }

    private func openSystemSettings() {
        // QA 运行不跳系统设置（会离开 App，流程测试没法继续）：只记一笔，页面不变。
        guard !Self.qaMode else { return }
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    /// QA 运行（逐屏取证 / 流程测试）：见 requestPermission 的说明。
    /// QA 运行（逐屏取证 / 流程测试）：判定跟宿主的 QA 开关一致（NativeQAHarness 的 qaEnabled：探针 / 夹具 / -shizi-qa 都算）。
    #if DEBUG
    private static var qaMode: Bool { RootViewController.qaEnabled }
    #else
    private static let qaMode = false
    #endif

    /// QA 运行（流程测试）：让时间轮开在一个与 store 里的时刻不同的值（-shizi-qa-remind-picker-time HH:MM）。
    /// 「值没变不写」（commitSettings，网页同一口径）：轮上的时刻与 store 相同的话，确认了也不会写，流程测试看不见写入。
    #if DEBUG
    private static var qaPickerTime: (hour: Int, minute: Int)? {
        guard qaMode else { return nil }
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-shizi-qa-remind-picker-time"), i + 1 < args.count else { return nil }
        let parts = args[i + 1].split(separator: ":")
        guard parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]), (0...23).contains(hour), (0...59).contains(minute) else { return nil }
        return (hour, minute)
    }
    #else
    private static var qaPickerTime: (hour: Int, minute: Int)? { nil }
    #endif

    /// 时间轮：改完写 store（失败 → 三段式）。
    private func presentTimePicker() {
        guard let m = model else { return }
        let start = Self.qaPickerTime ?? (m.remind.hour, m.remind.minute)
        let overlay = ShiziTimePickerView(hour: start.hour, minute: start.minute)
        overlay.accessibilityIdentifier = "native-remind-time-picker"
        overlay.onDone = { [weak self] hour, minute in
            self?.timePicker?.removeFromSuperview()
            self?.timePicker = nil
            self?.commitTime(hour: hour, minute: minute)
        }
        overlay.onCancel = { [weak self] in
            self?.timePicker?.removeFromSuperview()
            self?.timePicker = nil
        }
        timePicker = overlay
        view.addSubview(overlay)
        overlay.frame = view.bounds
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    }

    private func commitTime(hour: Int, minute: Int) {
        clearFail()
        call("remind.time", ["hour": hour, "minute": minute]) { [weak self] ok in
            guard let self else { return }
            if ok { self.syncPlan() } else { self.showFail("time") { self.commitTime(hour: hour, minute: minute) } }
        }
    }

    // MARK: 失败三段式

    private func showFail(_ field: String, retry: @escaping () -> Void) {
        failField = field
        retryAction = retry
        markStateChange()
        view.setNeedsLayout()
    }

    private func clearFail() {
        guard failField != nil else { return }
        failField = nil
        retryAction = nil
        markStateChange()
        view.setNeedsLayout()
    }

    private func retry() {
        guard let action = retryAction else { return }
        action()
    }

    // MARK: 引擎

    /// 数字等宽（网页 .sz-remind__time 的 font-variant-numeric: tabular-nums）。
    /// CoreText：数字间隔特性（kNumberSpacingType）+ 等宽选择器（0 = kMonospacedNumbersSelector，即网页的 tabular-nums）。
    private static func tabular(_ f: UIFont) -> UIFont {
        let d = f.fontDescriptor.addingAttributes([.featureSettings: [[UIFontDescriptor.FeatureKey.type: kNumberSpacingType,
                                                                       UIFontDescriptor.FeatureKey.selector: 0]]])
        return UIFont(descriptor: d, size: f.pointSize)
    }

    private func call(_ op: String, _ args: [String: Any], then: @escaping (Bool) -> Void) {
        guard let engine = stage?.engine else { then(false); return }
        engine.raw(op, args) { body in
            DispatchQueue.main.async { then((body["ok"] as? Bool) == true) }
        }
    }
}
