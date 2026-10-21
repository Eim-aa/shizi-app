#if DEBUG
import UIKit
import WebKit

// 原生写字页（B2.0 纵切 → B2.2 回忆阶段完整版 + 提示；docs/engineering/v10/B2-原生写字架构.md §6、§11；确认单 2、3）。
// 只在 DEBUG、启动参数 -shizi-native-write 时出现（主控宣布切换前）。
//
// 版式（A7 / D57；01 §6.1；NativeWriteLayout 与网页 layout.js 同一组公式）：
//   页头：左「‹」（44 × 44，图标外缘落在 20pt 页边线）、中间「n / 总数」（回忆阶段没有可见标题，读屏「第 n 个字，共 m 个」）、右上「跳过」与「结束这组」的位置
//         （按钮在 B2.6 接上功能前不显示）；
//   题面（词语 + 拼音，要写的字是空格；有提示行时在格下一行）→ 16 → 书写格（边长只由视口决定，258–400）→ 格下：撤销（贴格左沿）/ 清空（贴格右沿），
//   再下面是说明位：「上一个字」结果行（D19：落笔后收起；「修改 ›」由 B2.5 接）与提示说明（没有笔顺数据时一句）；
//   底栏：求助行（主按钮正上方 20 的凹面按钮：提示 / 看答案——看答案在 B2.4 接上前不显示，提示占满一行）+ 主按钮「写好了」（没写时不能点），
//   主按钮下沿 = 屏底 − max(24, 下安全区)。书写格顶边在同一张卡的所有阶段不动（D53 ②）。
//   字号：全部系统字体 + adjustsFontForContentSizeCategory，按量到的行高排；书写格边长与字号无关（D36）。AX 档的专门排法在 B2.9。
// 判断（B2.5 完整版；确认单 5、D46 ⑪、D49、D55）：书写格收成上格（你写的）、下格标准写法，同一顶边、同一中线、共用一条 1pt 格线（第二格上移 1pt）；
//   页头「‹」（读屏「接着写」）/ 中间标题 / 右侧计数；题面与写字页相同、目标格不显示答案；两键「写错了 / 写对了」在主按钮的位置，同一个样式、
//   无预选、无着色；两键按时刻编排出现（0–judgeAppear 不显示，之后 60% 且不可点，judgeReady 变实可点；减少动态效果与读屏直接可点）；没有本人笔画时上格「这次没写」；
//   进判断页时读屏焦点落在页标题。回忆 → 判断：本人墨以顶边中点为原点纯缩放（inkFlip，ease.out），参考格 fade 后淡入（T-phase）；
//   「‹ 接着写」与左缘右滑是同一个动作：判断 → 回忆的 T-phase 倒放（phaseReverse，左缘滑回跟手，过阈值才完成），书写格与笔迹原样回来。
//   判断落定（M23，NativeJudge.swift）：提交成功后本人笔迹离纸、收进页头计数，触觉与第一帧同帧；失败走三段式（说明 → 先不保存 → 再试一次）。
//   改判（D19）：回忆阶段的结果行「修改 ›」→ 改判弹层（NativeChangeSheetViewController）→ correct op。
// 提交：judge 经桥由页面 store.commit 完成；成功才推进（D07），失败留在判断页三段式（R-W16）。现场：抬笔 / 撤销 / 清空后发 strokes（P52 不等）。
// 提示（D64 ①，NativeHint.swift）：每点一次经 hint op 多给一段（规则在页面），淡朱实填画在本人墨下面、整组淡入；写过哪笔收哪笔、撤销回来；
//   整字给完 = 看过答案（同一次写入），按钮留着变灰；读屏播报给出了哪几笔（页面给的那句）。
// 换字 / 换阶段（交互规范 T0 / T-phase；确认单 2）：按钮 0.4s 不响应（网页 markStateChange 同一个值，返回键除外）；换字后 250ms 内落下的笔先持住、到点补画
//   （P227）；换字转场：内容变了的文字区旧的 0–75ms 淡出、新的 75–150ms 淡入，书写格 / 墨 / 提示 / 参考格这些非文字的旧样子 150ms 淡出；
//   减少动态效果下一律 150ms 交叉淡化。转场中落笔或点按：动画一帧到终态，这次输入照常生效（T0 规则 3）。
// 文案：全部取自页面 src/config/copy（open 回包的 copy 字典与 hint op 的回包），本文件不写任何用户可见的字。

protocol NativeWriteCoordinating: AnyObject {
    func nativeWriteDidRequestBack(_ vc: NativeWriteViewController)
    func nativeWriteDidFinish(_ vc: NativeWriteViewController, sessionId: String)
}

final class NativeWriteViewController: UIViewController {
    enum Phase { case recall, compare }

    let slot: String
    private let bridge: NativeWriteBridge
    weak var coordinator: NativeWriteCoordinating?
    let transitions = NativeWriteTransitions()

    private(set) var snapshot: [String: Any]
    private var copy: [String: String]
    private var colors: [String: UIColor] = [:]
    private var inkTint: SIMD4<Float>?
    private(set) var phase: Phase = .recall
    private(set) var strokes: [[InkRawPoint]] = []
    private var cleared: [[InkRawPoint]]?
    private var submitting = false
    private var failed = false
    /// 页面给的时刻（s；open 回包 timing，单一来源 src/session/write-api.js writeTiming）。
    private var penArm: TimeInterval = 0
    private var judgeAppear: TimeInterval = 0
    private var judgeReady: TimeInterval = 0
    private var pressGuard: TimeInterval = 0
    /// 页面给的动效时长（ms；writeMotion）与版式常量（writeLayoutConstants）。
    private var motion: [String: Double] = [:]
    private var layoutK = NativeWriteLayoutConstants()
    private var judgeKeysReady = true
    private var judgeArmToken = 0
    /// 回忆 ⇄ 判断的缓动与判断落定的时刻（页面给的 motion.easeOut / motion.settle，原生不自带默认值）。
    private var easeOut: [Double]?
    private var settleSpec: NativeSettleSpec?
    /// 格框线宽（tokens.css --frame-w = 1，网页同一值）。
    private let frameW: CGFloat = 1
    /// 判断 → 回忆的 T-phase 倒放进行中（版式里书写格 / 参考格的 frame 由动画驱动，viewDidLayoutSubviews 不覆盖）。
    private var reversing = false
    private var reverseAnimator: UIViewPropertyAnimator?
    private var reverseFinished = false
    /// 书写格（回忆版式）的位置：判断 → 回忆倒放的终点。
    private var recallGridRect = CGRect.zero
    /// 上一次按「换字」设门限的字（含进页面的第一个字）。
    private var armedCard: String?
    /// 已经交给协调者离开（返回 / 结果页），之后的 viewDidDisappear 不再发 exit。
    var exitHandled = false
    /// 页面打开量测：消息到达时刻（CACurrentMediaTime）与页面发出时刻（epoch ms）。
    var openTiming: (sentAtEpochMs: Double, receivedAt: CFTimeInterval, receivedEpochMs: Double)?

    // 0.4s 防误点（确认单 2；网页 Button.js createPressGuard 同口径：新状态后 pressGuard 内不响应；同一按钮两次按下也隔 pressGuard，撤销 / 清空除外）
    private var stateChangedAt: CFTimeInterval = -.infinity
    private var lastPress: [String: CFTimeInterval] = [:]

    // 本字：落过笔（结果行收起，D19）、提示
    private var penDown = false
    private var glyph: NativeGlyphData?
    private var medians: [[CGPoint]]?
    private(set) var hint: NativeHintView?
    private var hintButton: [String: Any] = [:]
    private var hintNoteText: String?
    private var hintBusy = false
    private var hintCleared = false
    private var answerSeen = false

    // MARK: 视图

    private let backButton = UIButton(type: .system)
    private let centerLabel = UILabel()
    private let progressLabel = UILabel() // 判断页页头右侧的计数（回忆阶段计数在中间）
    private let noInkLabel = UILabel() // 没有本人笔画时上格「这次没写」
    private let changeButton = UIButton(type: .system) // 结果行「修改 ›」
    private let lineDot = UILabel()
    private let failRetry = UIButton(type: .system)
    private let skipButton = UIButton(type: .system)
    private let endButton = UIButton(type: .system)
    private let promptView = UIView()
    private let promptRow = UIView()
    private let promptHint = UILabel()
    private var promptCells: [UIView] = []
    private let gridFrame = UIView()
    private let hintLayer = NativeHintLayerView()
    private var ink: NativeInkView!
    private let refFrame = UIView()
    private let refGlyph = NativeGlyphView()
    private let undoButton = UIButton(type: .system)
    private let clearButton = UIButton(type: .system)
    private let noteView = UIView()
    private let lineLabel = UILabel()
    private let noteDot = UIView()
    private let noteLabel = UILabel()
    private let footView = UIView()
    private let hintButtonView = UIButton(type: .system)
    private let answerButton = UIButton(type: .system)
    private let doneButton = UIButton(type: .system)
    private let wrongButton = UIButton(type: .system)
    private let correctButton = UIButton(type: .system)
    private let failNote = UILabel()
    private let failCancel = UIButton(type: .system)
    private let edgeBack = UIScreenEdgePanGestureRecognizer()
    private lazy var judgeHaptic = UIImpactFeedbackGenerator(style: .soft)
    private lazy var lightHaptic = UIImpactFeedbackGenerator(style: .light)
    private lazy var selectHaptic = UISelectionFeedbackGenerator()
    /// 换字转场的旧样子（替身视图，不接收触摸）。
    private var transitionOverlay: UIView?

    init(slot: String, payload: [String: Any], bridge: NativeWriteBridge) {
        self.slot = slot
        self.bridge = bridge
        self.snapshot = payload["snapshot"] as? [String: Any] ?? [:]
        self.copy = (payload["copy"] as? [String: String]) ?? [:]
        super.init(nibName: nil, bundle: nil)
        applyColors(payload["colors"] as? [String: String])
        applyTiming(payload)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    // MARK: 文案 / 颜色 / 时刻（单一来源：页面）

    private func tr(_ key: String, _ vars: [String: CustomStringConvertible] = [:]) -> String {
        var s = copy[key] ?? ""
        for (k, v) in vars { s = s.replacingOccurrences(of: "{\(k)}", with: v.description) }
        return s
    }

    private func applyColors(_ raw: [String: String]?) {
        for (k, v) in raw ?? [:] {
            if let c = NativeInkWire.uiColor(v) { colors[k] = c }
        }
        if let h = NativeInkWire.parseColor(raw?["hand"]) { inkTint = SIMD4(h.x, h.y, h.z, 1) }
    }

    private func color(_ name: String, _ fallback: UIColor) -> UIColor { colors[name] ?? fallback }

    private func applyTiming(_ payload: [String: Any]) {
        let raw = payload["timing"] as? [String: Any]
        let ms = { (k: String) in ((raw?[k] as? NSNumber)?.doubleValue ?? 0) / 1000 }
        penArm = ms("penArmMs")
        judgeAppear = ms("judgeAppearMs")
        judgeReady = ms("judgeReadyMs")
        pressGuard = ms("pressGuardMs")
        if let m = payload["motion"] as? [String: Any] {
            motion = m.compactMapValues { ($0 as? NSNumber)?.doubleValue }
            easeOut = (m["easeOut"] as? [NSNumber])?.map { $0.doubleValue }
            settleSpec = NativeSettleSpec(motion: m)
        }
        if let l = payload["layout"] as? [String: Any] { layoutK = NativeWriteLayoutConstants(l) }
    }

    /// 动效时长（s）：减少动态效果时一律 reduce（150ms，D58 ②）。
    private func dur(_ key: String) -> TimeInterval { (motion[key] ?? 0) / 1000 }
    private var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }

    // MARK: 生命周期

    override func loadView() {
        let v = UIView()
        v.backgroundColor = color("paper", UIColor(named: "Paper") ?? .systemBackground)
        view = v
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let inkView = NativeInkView.make(frame: .zero) else {
            NSLog("[shizi] native-write: Metal unavailable")
            return
        }
        ink = inkView
        ink.latency = NativeWriteMetrics.shared.inkLatency
        ink.delegate = self
        ink.isAccessibilityElement = true
        ink.accessibilityTraits = [.allowsDirectInteraction]
        ink.accessibilityIdentifier = "native-write-grid"
        if let c = inkTint { ink.inkColor = c }

        backButton.setImage(UIImage(systemName: "chevron.left", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .regular)), for: .normal)
        backButton.tintColor = color("ink1", .label)
        backButton.accessibilityIdentifier = "native-write-back"
        wire(backButton, id: "back", state: false) { $0.tapBack() }

        centerLabel.font = UIFont.preferredFont(forTextStyle: .subheadline)
        centerLabel.adjustsFontForContentSizeCategory = true
        centerLabel.textAlignment = .center
        centerLabel.textColor = color("ink2", .secondaryLabel)
        centerLabel.accessibilityIdentifier = "native-write-progress"
        centerLabel.accessibilityTraits = [.header]
        progressLabel.font = UIFont.preferredFont(forTextStyle: .subheadline)
        progressLabel.adjustsFontForContentSizeCategory = true
        progressLabel.textAlignment = .right
        progressLabel.textColor = color("ink3", .secondaryLabel)
        progressLabel.accessibilityIdentifier = "native-write-count"
        progressLabel.isHidden = true
        noInkLabel.font = UIFont.preferredFont(forTextStyle: .footnote)
        noInkLabel.adjustsFontForContentSizeCategory = true
        noInkLabel.textAlignment = .center
        noInkLabel.numberOfLines = 0
        noInkLabel.textColor = color("ink3", .secondaryLabel)
        noInkLabel.text = tr("R-W17.noInk")
        noInkLabel.accessibilityIdentifier = "native-write-noink"
        noInkLabel.isHidden = true

        // 页头右上：跳过 / 结束这组（文字按钮；B2.6 接上功能前不显示，位置已留）
        configureTextButton(skipButton, title: tr("R-W14.btnSkip"), icon: nil, id: "native-write-skip")
        configureTextButton(endButton, title: tr("R-W15.end"), icon: nil, id: "native-write-end")
        skipButton.isHidden = true
        endButton.isHidden = true

        promptHint.font = UIFont.preferredFont(forTextStyle: .footnote)
        promptHint.adjustsFontForContentSizeCategory = true
        promptHint.textColor = color("ink3", .secondaryLabel)
        promptHint.textAlignment = .center
        promptHint.numberOfLines = 0
        promptView.addSubview(promptRow)
        promptView.addSubview(promptHint)
        promptView.isAccessibilityElement = false
        promptView.shouldGroupAccessibilityChildren = true

        for f in [gridFrame, refFrame] {
            f.layer.borderWidth = frameW
            f.layer.borderColor = color("frame", .separator).cgColor
            f.layer.cornerRadius = 4
            f.backgroundColor = .clear
            f.isUserInteractionEnabled = false
        }
        hintLayer.color = color("danzhu", .systemRed)
        refFrame.addSubview(refGlyph)
        refGlyph.color = color("ref", .label)
        refGlyph.isAccessibilityElement = true
        refFrame.isHidden = true

        configureTextButton(undoButton, title: tr("R-W18.btnUndo"), icon: "arrow.uturn.backward", id: "native-write-undo")
        configureTextButton(clearButton, title: tr("R-W18.btnClear"), icon: "xmark.circle", id: "native-write-clear")
        wire(undoButton, id: "undo", rapid: true) { $0.tapUndo() }
        wire(clearButton, id: "clear", rapid: true) { $0.tapClear() }

        for l in [lineLabel, noteLabel] {
            l.font = UIFont.preferredFont(forTextStyle: .footnote)
            l.adjustsFontForContentSizeCategory = true
            l.textColor = color("ink3", .secondaryLabel)
            l.numberOfLines = 0
            noteView.addSubview(l)
        }
        lineLabel.accessibilityIdentifier = "native-write-line"
        noteLabel.accessibilityIdentifier = "native-write-note"
        lineDot.text = "\u{00B7}"
        lineDot.font = UIFont.preferredFont(forTextStyle: .footnote)
        lineDot.adjustsFontForContentSizeCategory = true
        lineDot.textColor = color("ink4", .tertiaryLabel)
        lineDot.isAccessibilityElement = false
        lineDot.textAlignment = .center
        noteView.addSubview(lineDot)
        // 结果行「修改 ›」：文字按钮 13 号 ink1，热区 44（D19 / D46 ⑭）；文字来自页面（line.action），读屏名称去掉 ›
        changeButton.titleLabel?.font = UIFont.preferredFont(forTextStyle: .footnote)
        changeButton.titleLabel?.adjustsFontForContentSizeCategory = true
        changeButton.setTitleColor(color("ink1", .label), for: .normal)
        changeButton.accessibilityIdentifier = "native-write-line-change"
        wire(changeButton, id: "change") { $0.tapChange() }
        noteView.addSubview(changeButton)
        noteDot.backgroundColor = color("danzhu", .systemRed)
        noteDot.layer.cornerRadius = 3
        noteDot.isAccessibilityElement = false
        noteView.addSubview(noteDot)

        configureHelp(hintButtonView, title: tr("R-W05.hintLabel"), icon: "lightbulb", id: "native-write-hint")
        configureHelp(answerButton, title: tr("R-W07.btnShowAnswer"), icon: "eye", id: "native-write-show-answer")
        answerButton.isHidden = true // B2.4 接上「看答案」前不显示（提示占满求助行）
        wire(hintButtonView, id: "hint") { $0.tapHint() }
        configurePrimary(doneButton, title: tr("R-W29.btnDone"), id: "native-write-done")
        wire(doneButton, id: "done") { $0.tapDone() }
        configureOutline(wrongButton, title: tr("R-W09.btnWrong"), id: "native-write-wrong")
        configureOutline(correctButton, title: tr("R-W09.btnCorrect"), id: "native-write-correct")
        wire(wrongButton, id: "wrong") { $0.tapWrong() }
        wire(correctButton, id: "correct") { $0.tapCorrect() }
        // 保存失败三段式（S1，D07）：说明 → 求助行「先不保存」（凹面）→ 主按钮「再试一次」（满宽墨底）；写字流程同一写法
        configureHelp(failCancel, title: tr("R-W16.cancel"), icon: nil, id: "native-write-fail-cancel")
        configurePrimary(failRetry, title: tr("R-W16.retry"), id: "native-write-fail-retry")
        wire(failCancel, id: "failCancel") { $0.tapFailCancel() }
        wire(failRetry, id: "retry") { $0.tapRetry() }
        failNote.text = tr("R-W16.saveFailed")
        failNote.font = UIFont.preferredFont(forTextStyle: .subheadline)
        failNote.adjustsFontForContentSizeCategory = true
        failNote.textColor = color("ink2", .secondaryLabel)
        failNote.textAlignment = .center
        failNote.numberOfLines = 0
        [hintButtonView, answerButton, doneButton, wrongButton, correctButton, failNote, failCancel, failRetry].forEach { footView.addSubview($0) }

        [backButton, centerLabel, progressLabel, endButton, skipButton, promptView, gridFrame, noInkLabel, hintLayer, ink, refFrame, undoButton, clearButton, noteView, footView]
            .forEach { view.addSubview($0) }

        // 左缘右滑 = 左上「‹」：回忆阶段跟手滑回上一页（交互式转场），判断阶段 = 接着写（D58 ① / 确认单 2）
        edgeBack.edges = .left
        edgeBack.addTarget(self, action: #selector(handleEdgeBack(_:)))
        view.addGestureRecognizer(edgeBack)

        apply(snapshot: snapshot, keepLocal: false)
        NotificationCenter.default.addObserver(self, selector: #selector(contentSizeChanged), name: UIContentSizeCategory.didChangeNotification, object: nil)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if let t = openTiming {
            NativeWriteMetrics.shared.open(sentAtEpochMs: t.sentAtEpochMs, receivedAt: t.receivedAt, appearedAt: CACurrentMediaTime(), receivedEpochMs: t.receivedEpochMs)
            openTiming = nil
        }
        UIAccessibility.post(notification: .screenChanged, argument: centerLabel)
        scheduleAutoStep()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        guard isBeingDismissed || presentingViewController == nil else { return }
        saveMetrics()
        if !exitHandled {
            exitHandled = true
            bridge.call("exit", ["slot": slot, "to": "back"]) { _ in NativeWriteMetrics.shared.save() }
        }
    }

    var inkViewForTesting: NativeInkView? { ink }
    var hintLayerForTesting: NativeHintLayerView { hintLayer }
    var hintButtonKindForTesting: String? { hintButton["kind"] as? String }
    var lineShownForTesting: Bool { !lineLabel.isHidden }

    func saveMetrics() {
        NativeWriteMetrics.shared.inkSummary = ink?.latency.summary ?? [:]
        NativeWriteMetrics.shared.save()
    }

    /// 读屏两指 Z 形 = 左上「‹」（回忆阶段离开，判断阶段接着写；R5-I2）。
    override func accessibilityPerformEscape() -> Bool {
        tapBack()
        return true
    }

    @objc private func contentSizeChanged() {
        rebuildPrompt()
        view.setNeedsLayout()
    }

    // MARK: 按钮与防误点

    /// 按钮动作（UIAction）：先过 0.4s 防误点，再调动作函数（动作函数本身可直接调用：测试与自动驾驶用 perform 走同一个函数）。
    /// state = false：不看「新状态后 0.4s」（返回键，T0-3）；rapid = true：不看同一按钮上一次按下（撤销 / 清空）。
    private func wire(_ b: UIButton, id: String, state: Bool = true, rapid: Bool = false, _ action: @escaping (NativeWriteViewController) -> Void) {
        b.addAction(UIAction { [weak self] _ in
            guard let self, self.acceptPress(id, at: CACurrentMediaTime(), state: state, rapid: rapid) else { return }
            self.settleAnimations()
            action(self)
        }, for: .touchUpInside)
    }

    /// 网页 createPressGuard 的同一判据。
    func acceptPress(_ id: String, at t: CFTimeInterval, state: Bool = true, rapid: Bool = false) -> Bool {
        if state, t < stateChangedAt + pressGuard { return false }
        if !rapid, let last = lastPress[id], t < last + pressGuard { return false }
        lastPress[id] = t
        return true
    }

    /// 换字 / 换阶段 = 新状态：按钮 0.4s 不响应。
    private func markStateChange() { stateChangedAt = CACurrentMediaTime() }

    // MARK: 快照

    var cardKey: String? { snapshot["cardKey"] as? String }
    private var char: String { snapshot["char"] as? String ?? "" }

    /// 用快照刷新页面。keepLocal：同一个字时保留本地笔画与提示（页面重载后的重新同步）。
    func apply(snapshot next: [String: Any], keepLocal: Bool) {
        let sameCard = (next["cardKey"] as? String) == cardKey
        let prevPhase = phase
        snapshot = next
        if !(keepLocal && sameCard) {
            strokes = NativeInkWire.rawStrokes(next["strokes"])
            cleared = nil
            phase = (next["phase"] as? String) == "compare" && !strokes.isEmpty ? .compare : .recall
            penDown = false
            loadHint()
        }
        // 换字（含进页面）：门限内落下的笔先持住、到点补画（P227）；判断回包前持住的笔在这里接上新字
        if cardKey != armedCard || ink?.acceptFrom == .infinity {
            armedCard = cardKey
            ink?.acceptFrom = CACurrentMediaTime() + penArm
            markStateChange()
        } else if phase != prevPhase {
            markStateChange()
        }
        failed = false
        ink?.syncPageStrokes(strokes)
        refGlyph.char = char
        refGlyph.accessibilityLabel = tr("R-W09.refCardLabelChar", ["char": char])
        rebuildPrompt()
        refresh()
        view.setNeedsLayout()
    }

    /// 页面重载（WebContent 进程被回收）后宿主重新发 open：用新的文案 / 颜色 / 快照重新同步。
    func resync(payload: [String: Any]) {
        if let c = payload["copy"] as? [String: String] { copy = c }
        applyColors(payload["colors"] as? [String: String])
        applyTiming(payload)
        if let s = payload["snapshot"] as? [String: Any] { apply(snapshot: s, keepLocal: true) }
    }

    private func rebuildPrompt() {
        promptCells.forEach { $0.removeFromSuperview() }
        promptCells = []
        let prompt = snapshot["prompt"] as? [String: Any] ?? [:]
        let cells = prompt["cells"] as? [[String: Any]] ?? []
        promptRow.accessibilityLabel = tr("X-PROMPT.groupLabel")
        let hintText = prompt["hint"] as? String ?? ""
        promptHint.text = hintText
        promptHint.isHidden = hintText.isEmpty
        for c in cells {
            let kind = c["kind"] as? String ?? "text"
            let text = c["text"] as? String ?? ""
            let cell = UIView()
            switch kind {
            case "blank":
                cell.layer.borderWidth = frameW
                cell.layer.borderColor = color("frame", .separator).cgColor
                let py = UILabel()
                py.text = text
                py.font = UIFont.preferredFont(forTextStyle: .subheadline)
                py.adjustsFontForContentSizeCategory = true
                py.textColor = color("ink2", .secondaryLabel)
                py.textAlignment = .center
                py.tag = 1
                cell.addSubview(py)
                cell.isAccessibilityElement = true
                cell.accessibilityLabel = c["label"] as? String // 只有位置与拼音，不含答案字（D16）
                cell.accessibilityIdentifier = "native-write-blank"
            case "repeatBlank":
                cell.layer.borderWidth = frameW
                cell.layer.borderColor = color("frame", .separator).cgColor
                let l = UILabel()
                l.text = text
                l.textAlignment = .center
                l.textColor = color("ink3", .tertiaryLabel)
                l.tag = 2
                cell.addSubview(l)
                cell.isAccessibilityElement = true
                cell.accessibilityLabel = c["label"] as? String
            default:
                let g = NativeGlyphView()
                g.char = text
                g.padRatio = 0
                g.color = color("ink1", .label)
                g.tag = 3
                cell.addSubview(g)
                cell.isAccessibilityElement = true
                cell.accessibilityLabel = text
            }
            promptRow.addSubview(cell)
            promptCells.append(cell)
        }
    }

    // MARK: 提示（D64 ①；规则在页面 hint op，这里只有视图）

    private var hintActive: Bool {
        phase == .recall && (!answerSeen || (hintButton["kind"] as? String) == "exhausted")
    }

    /// 换字：读字形、恢复提示现场（open 时已有 hintRange → 静态显示，按已写笔数推出哪些已收掉），再问页面按钮状态。
    private func loadHint() {
        glyph = char.isEmpty ? nil : NativeGlyphData.load(char)
        medians = glyph.map { NativeHintMatch.medians345($0, padRatio: hintLayer.padRatio) }
        hintLayer.setGlyph(glyph)
        let used = snapshot["hints"] as? Int ?? 0
        var range: Range<Int>?
        if let r = snapshot["hintRange"] as? [String: Any], let a = r["from"] as? Int, let b = r["to"] as? Int, b > a, a >= 0 { range = a..<b }
        hint = NativeHintView(used: used, range: range, written: strokes.count)
        hintCleared = false
        hintBusy = false
        answerSeen = snapshot["answerSeen"] as? Bool ?? false
        hintButton = ["kind": "loading", "text": tr("R-W05.hintLabel"), "label": tr("R-W05.hintLabel"), "disabled": true]
        hintNoteText = nil
        renderHint(fadeIn: false)
        requestHintState()
    }

    /// 字形的总笔数交给页面（没有数据 = 0：这个字没有分步提示）。
    private var totalStrokes: Int { glyph?.medians.count ?? 0 }

    private func hintArgs(_ action: String) -> [String: Any] {
        var a: [String: Any] = ["slot": slot, "cardKey": cardKey ?? "", "action": action, "totalStrokes": totalStrokes, "used": hint?.used ?? 0, "written": strokes.count]
        if let r = hint?.range { a["range"] = ["from": r.lowerBound, "to": r.upperBound] }
        return a
    }

    private func requestHintState() {
        guard let key = cardKey else { return }
        bridge.call("hint", hintArgs("state")) { [weak self] reply in
            guard let self, self.cardKey == key, reply.ok else { return }
            self.applyHintModel(reply.body)
        }
    }

    private func applyHintModel(_ body: [String: Any]) {
        if let b = body["button"] as? [String: Any] { hintButton = b }
        hintNoteText = (body["note"] as? [String: Any])?["text"] as? String
        refresh()
        view.setNeedsLayout()
    }

    @objc private func tapHint() {
        guard phase == .recall, !submitting, !hintBusy, (hintButton["kind"] as? String) == "available", let key = cardKey else { return }
        hintBusy = true
        bridge.call("hint", hintArgs("give")) { [weak self] reply in
            guard let self, self.cardKey == key else { return }
            self.hintBusy = false
            // 写入失败也照常显示（P52）：本地次数保留，下次写入带上
            guard let given = reply.body["given"] as? [String: Any], let a = given["from"] as? Int, let b = given["to"] as? Int, b > a,
                  let merged = reply.body["hintRange"] as? [String: Any], let ma = merged["from"] as? Int, let mb = merged["to"] as? Int, mb > ma else {
                self.applyHintModel(reply.body)
                return
            }
            self.settleAnimations()
            self.hint?.give(segment: a..<b, merged: ma..<mb, used: reply.body["used"] as? Int ?? 0, written: self.strokes.count)
            self.hintCleared = false
            if (reply.body["whole"] as? Bool) == true { self.answerSeen = true }
            self.applyHintModel(reply.body)
            self.renderHint(fadeIn: true)
            self.selectHaptic.selectionChanged() // F1 haptic.select：提示显影，与第一帧同帧
            self.checkHintCleared()
            if let say = reply.body["announce"] as? String, !say.isEmpty { UIAccessibility.post(notification: .announcement, argument: say) }
        }
    }

    private func renderHint(fadeIn: Bool) {
        let ms = fadeIn ? (reduceMotion ? dur("hintReduced") : dur("hintIn")) * 1000 : 0
        hintLayer.render(hint, visible: hintActive && glyph != nil, fadeInMs: ms)
    }

    /// 本人写完第 index 笔：收掉与它匹配的那一笔提示（只那一笔淡出，D53 ⑧）。
    private func absorbHint(index: Int, raw: [InkRawPoint]) {
        guard hintActive, var h = hint, h.range != nil else { return }
        guard let m = NativeHintMatch.match(remaining: h.remaining, index: index, points: raw, medians: medians, maxDist: layoutK.hintMatchMaxDist),
              h.absorb(user: index, hint: m) else { return }
        hint = h
        let out = (reduceMotion ? dur("hintReduced") : dur("hintOut"))
        hintLayer.fadeOut(m, ms: out * 1000)
        let key = cardKey
        DispatchQueue.main.asyncAfter(deadline: .now() + out) { [weak self] in
            guard let self, self.cardKey == key, var v = self.hint, v.fading.contains(m) else { return }
            v.faded(m)
            self.hint = v
            self.renderHint(fadeIn: false)
            self.checkHintCleared()
        }
    }

    /// 撤销 / 清空：笔数退到 n，这些笔收掉的提示笔回来（整组重新淡入）。
    private func restoreHint(toCount n: Int) {
        guard hintActive, var h = hint, h.restore(fromUser: n) else { return }
        hint = h
        renderHint(fadeIn: true)
        checkHintCleared()
    }

    /// 提示笔全部收掉（淡完）→ 页面写 hintRange:null；撤销让它们回来 → 写回范围（网页 'hint-fade'，P52 不等）。
    private func checkHintCleared() {
        guard let h = hint, let r = h.range, let key = cardKey else { return }
        if h.remaining.isEmpty, h.fading.isEmpty, !hintCleared {
            hintCleared = true
            bridge.send("hint", ["slot": slot, "cardKey": key, "action": "range", "hints": h.used, "hintRange": NSNull()])
        } else if !h.remaining.isEmpty, hintCleared {
            hintCleared = false
            bridge.send("hint", ["slot": slot, "cardKey": key, "action": "range", "hints": h.used, "hintRange": ["from": r.lowerBound, "to": r.upperBound]])
        }
    }

    // MARK: 状态 → 控件

    private func refresh() {
        let n = (snapshot["cursor"] as? Int ?? 0) + 1
        let total = snapshot["total"] as? Int ?? 0
        let recall = phase == .recall
        if recall {
            centerLabel.text = tr("R-W01.progress", ["n": n, "total": total])
            centerLabel.accessibilityLabel = tr("R-W01.progressLabel", ["n": n, "total": total])
            backButton.accessibilityLabel = tr("X-COMMON.back")
        } else {
            // 判断页页头：左「‹」（读屏「接着写」）/ 中间标题 / 右计数
            centerLabel.text = tr("R-W03.titleCompare")
            centerLabel.accessibilityLabel = nil
            backButton.accessibilityLabel = tr("R-W09.continueWriting")
            progressLabel.text = tr("R-W01.progress", ["n": n, "total": total])
            progressLabel.accessibilityLabel = tr("R-W01.progressLabel", ["n": n, "total": total])
        }
        progressLabel.isHidden = recall
        // 没有本人笔画时上格「这次没写」（R-W17；正常流程到不了：没有笔画进不了判断页）
        noInkLabel.isHidden = recall || !strokes.isEmpty
        // 判断提交中也接收落笔（持住，等回包推进到下一个字；见 judge）
        ink?.drawable = recall ? !submitting : submitting
        ink?.accessibilityLabel = recall
            ? (strokes.isEmpty ? tr("X-WRITE.gridLabel") : tr("X-WRITE.gridLabelCount", ["n": strokes.count]))
            : tr("R-W09.mineCardLabel", ["n": strokes.count])
        refFrame.isHidden = recall
        // 撤销 / 清空：判断阶段不显示；无墨时 ink4 且不可点（禁用的控件仍在原位）
        undoButton.isHidden = !recall
        clearButton.isHidden = !recall
        undoButton.isEnabled = !strokes.isEmpty || cleared != nil
        clearButton.isEnabled = !strokes.isEmpty
        // 说明位：结果行（D19：回忆阶段、没看过答案、没有本人笔画、本字没落过笔）+ 提示说明
        let line = snapshot["line"] as? [String: Any]
        let lineText = line?["text"] as? String ?? ""
        let lineOn = recall && !answerSeen && strokes.isEmpty && !penDown && !lineText.isEmpty
        lineLabel.text = lineOn ? lineText : nil
        lineLabel.isHidden = !lineOn
        // 「修改 ›」只对可改的记录开放（sessions.canCorrect → line.canChange；看过答案 / 跳过不可改）
        let action = line?["action"] as? String ?? ""
        let changeOn = lineOn && (line?["canChange"] as? Bool) == true && !action.isEmpty
        changeButton.isHidden = !changeOn
        lineDot.isHidden = !changeOn
        if changeOn {
            changeButton.setTitle(action, for: .normal)
            changeButton.accessibilityLabel = action.replacingOccurrences(of: "\u{203A}", with: "").trimmingCharacters(in: .whitespaces)
        }
        let noteOn = recall && !answerSeen && !(hintNoteText ?? "").isEmpty
        noteLabel.text = noteOn ? hintNoteText : nil
        noteLabel.isHidden = !noteOn
        noteDot.isHidden = !noteOn
        noteView.isHidden = !recall
        // 求助行：提示（看过答案后不显示；提示整字给完的例外：留着、不可点，读屏「提示已用完」）
        let kind = hintButton["kind"] as? String ?? "loading"
        let hintShown = recall && !(answerSeen && kind != "exhausted")
        hintButtonView.isHidden = !hintShown
        if kind == "unavailable" {
            // 没有笔顺数据：灰字「暂时没有提示」，不是按钮（M1-2 NoHintLabel）
            hintButtonView.setTitle(hintButton["label"] as? String ?? "", for: .normal)
            hintButtonView.setImage(nil, for: .normal)
            hintButtonView.isEnabled = false
            hintButtonView.backgroundColor = .clear
            hintButtonView.accessibilityTraits = [.staticText]
        } else {
            hintButtonView.setTitle(hintButton["text"] as? String ?? tr("R-W05.hintLabel"), for: .normal)
            hintButtonView.setImage(UIImage(systemName: "lightbulb"), for: .normal)
            hintButtonView.isEnabled = (hintButton["disabled"] as? Bool) != true && !hintBusy
            hintButtonView.backgroundColor = color("field", .secondarySystemFill)
            hintButtonView.accessibilityTraits = [.button]
        }
        hintButtonView.accessibilityLabel = hintButton["label"] as? String
        doneButton.isHidden = !recall
        doneButton.isEnabled = !strokes.isEmpty
        doneButton.backgroundColor = strokes.isEmpty ? color("field", .secondarySystemFill) : color("ink1", .label)
        wrongButton.isHidden = recall || failed
        correctButton.isHidden = recall || failed
        failNote.isHidden = recall || !failed
        failCancel.isHidden = recall || !failed
        failRetry.isHidden = recall || !failed
        wrongButton.isEnabled = !submitting && judgeKeysReady
        correctButton.isEnabled = !submitting && judgeKeysReady
        failRetry.isEnabled = !submitting
    }

    // MARK: 版式（A7；NativeWriteLayout = 网页 layout.js；AX 档专门排法在 B2.9）

    private var firstLayoutDone = false

    private static func scaled(_ style: UIFont.TextStyle, _ size: CGFloat, _ weight: UIFont.Weight) -> UIFont {
        UIFontMetrics(forTextStyle: style).scaledFont(for: .systemFont(ofSize: size, weight: weight))
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        defer {
            if !firstLayoutDone, let t = openTiming {
                firstLayoutDone = true
                NativeWriteMetrics.shared.firstLayout(ms: (CACurrentMediaTime() - t.receivedAt) * 1000)
            }
        }
        let k = layoutK
        let safe = view.safeAreaInsets
        let w = view.bounds.width, h = view.bounds.height
        let gutter = k.sideMargin

        // 页头：名义 44，大字号下按量到的行高长高（多出的部分从组顶扣掉，书写格在页面上的 y 不变）
        let headH = max(k.nominalHead, ceil(centerLabel.font.lineHeight) + 16)
        let headExtra = headH - k.nominalHead
        backButton.frame = CGRect(x: gutter - 11, y: safe.top + (headH - 44) / 2, width: 44, height: 44)
        var right = w - gutter
        for b in [skipButton, endButton] where !b.isHidden {
            let bw = ceil(b.sizeThatFits(CGSize(width: w / 3, height: 44)).width)
            b.frame = CGRect(x: right - bw, y: safe.top + (headH - 44) / 2, width: bw, height: 44)
            right -= bw + 16
        }
        if !progressLabel.isHidden {
            // 判断页：计数在右（页边 20 对齐），标题居中，两边留出对称的空
            let pw = ceil(progressLabel.sizeThatFits(CGSize(width: w / 3, height: headH)).width)
            progressLabel.frame = CGRect(x: w - gutter - pw, y: safe.top, width: pw, height: headH)
            right = progressLabel.frame.minX - 8
        }
        let side = max(64, w - right)
        centerLabel.frame = CGRect(x: side, y: safe.top, width: max(0, w - 2 * side), height: headH)

        // 底栏：主按钮下沿 = 屏底 − max(24, 下安全区)；求助行在主按钮正上方 20
        let footBottom = max(k.footBottomMin, safe.bottom)
        let primaryH = max(54, ceil(doneButton.titleLabel?.font.lineHeight ?? 22) + 32)
        let helpH = max(48, ceil(hintButtonView.titleLabel?.font.lineHeight ?? 22) + 26)
        let primaryY = h - footBottom - primaryH
        let helpY = primaryY - 20 - helpH
        // 保存失败：说明句在求助行上面一行，底栏比平时高出这一截（网页底栏同一结构：说明 → 20 → 求助行 → 20 → 主按钮，说明 margin-bottom 6）
        let noteH = failed ? ceil(failNote.sizeThatFits(CGSize(width: w - 2 * gutter, height: .greatestFiniteMagnitude)).height) : 0
        let noteExtra = failed ? noteH + 26 : 0
        let footTopBase = helpY - 12
        let footTop = footTopBase - noteExtra
        footView.frame = CGRect(x: 0, y: footTop, width: w, height: h - footTop)
        let fy = { (y: CGFloat) in y - footTop }
        doneButton.frame = CGRect(x: gutter, y: fy(primaryY), width: w - 2 * gutter, height: primaryH)
        let half = (w - 2 * gutter - 12) / 2
        wrongButton.frame = CGRect(x: gutter, y: fy(primaryY), width: half, height: primaryH)
        correctButton.frame = CGRect(x: gutter + half + 12, y: fy(primaryY), width: half, height: primaryH)
        let helps = [hintButtonView, answerButton].filter { !$0.isHidden }
        let slotW = helps.count > 1 ? (w - 2 * gutter - 12) / 2 : w - 2 * gutter
        for (i, b) in helps.enumerated() {
            b.frame = CGRect(x: gutter + CGFloat(i) * (slotW + 12), y: fy(helpY), width: slotW, height: helpH)
        }
        failRetry.frame = doneButton.frame
        failCancel.frame = CGRect(x: gutter, y: fy(helpY), width: w - 2 * gutter, height: helpH)
        failNote.frame = CGRect(x: gutter, y: fy(helpY) - 26 - noteH, width: w - 2 * gutter, height: noteH)

        // 题面：拼音行 + 4 + 52 的格（有提示行时下面再一行）；P = 量到的整个题面高
        let cell: CGFloat = 52
        let pyH = ceil(UIFont.preferredFont(forTextStyle: .subheadline).lineHeight) + 4
        let count = CGFloat(max(1, promptCells.count))
        let rowW = min(w - 2 * gutter, cell * count)
        let cw = rowW / count
        let hintH = promptHint.isHidden ? 0 : ceil(promptHint.sizeThatFits(CGSize(width: w - 2 * gutter, height: .greatestFiniteMagnitude)).height) + 4
        let promptH = pyH + 4 + cw + hintH

        let headBottom = safe.top + headH
        let mainH = footTopBase - headBottom
        let nominal = NativeWriteLayout.nominalMainHeight(pageHeight: h, safeTop: safe.top, footBottom: footBottom, k)
        let L = NativeWriteLayout.write(width: w, nominalHeight: nominal, promptHeight: promptH, headExtra: headExtra, k)
        // 大字号下页头 / 底栏比名义高：组超出主区时整体上移（不与底栏重叠），书写格边长不变（D36）
        let overflow = max(0, L.top + promptH + k.promptGap + L.g + k.toolsHeight - mainH)
        let top = max(0, L.top - overflow)
        let g = L.g
        promptView.frame = CGRect(x: 0, y: headBottom + top, width: w, height: promptH)
        promptRow.frame = CGRect(x: (w - rowW) / 2, y: pyH + 4, width: rowW, height: cw)
        promptHint.frame = CGRect(x: gutter, y: promptRow.frame.maxY + 4, width: w - 2 * gutter, height: max(0, hintH - 4))
        for (i, c) in promptCells.enumerated() {
            c.frame = CGRect(x: CGFloat(i) * cw, y: 0, width: cw, height: cw)
            for sub in c.subviews {
                switch sub.tag {
                case 1: sub.frame = CGRect(x: -20, y: -pyH - 4, width: cw + 40, height: pyH)
                case 2: sub.frame = c.bounds
                default: sub.frame = c.bounds.insetBy(dx: cw * 0.1, dy: cw * 0.1)
                }
            }
        }

        // 书写格：边长与顶边由名义版式定（同一张卡的所有阶段不动）
        let gridTop = headBottom + top + promptH + k.promptGap
        let gridRect = CGRect(x: (w - g) / 2, y: gridTop, width: g, height: g)
        // 格下：撤销贴格左沿、清空贴格右沿（离格 4、高 44），说明位在它下面
        let toolW = max(88, g / 2 - 8)
        undoButton.frame = CGRect(x: gridRect.minX, y: gridRect.maxY + 4, width: toolW, height: 44)
        clearButton.frame = CGRect(x: gridRect.maxX - toolW, y: gridRect.maxY + 4, width: toolW, height: 44)
        undoButton.contentHorizontalAlignment = .leading
        clearButton.contentHorizontalAlignment = .trailing
        let noteTop = gridRect.maxY + k.toolRowHeight
        let noteW = g
        var ny: CGFloat = 0
        if !lineLabel.isHidden {
            let lh = ceil(lineLabel.sizeThatFits(CGSize(width: noteW, height: .greatestFiniteMagnitude)).height)
            let infinite = CGSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
            if changeButton.isHidden {
                lineLabel.frame = CGRect(x: 0, y: 0, width: noteW, height: max(lh, 20))
                lineDot.frame = .zero
                ny = lineLabel.frame.maxY + 2
            } else {
                // 「正文 · 修改 ›」：一行放得下就一行（修改按钮盒 = 文字宽 + 8、44 高，上下对着行中线伸出；点击区 ≥ 44），放不下折行、修改在下一行行首
                let lw = ceil(lineLabel.sizeThatFits(infinite).width)
                let bw = max(44, ceil((changeButton.titleLabel?.sizeThatFits(infinite).width ?? 0)) + 8)
                let dotW: CGFloat = 12
                let rowH = max(20, ceil(lineLabel.font.lineHeight))
                if lw + dotW + bw - 8 <= noteW {
                    lineLabel.frame = CGRect(x: 0, y: 0, width: lw, height: rowH)
                    lineDot.frame = CGRect(x: lw, y: 0, width: dotW, height: rowH)
                    changeButton.frame = CGRect(x: lw + dotW - 4, y: rowH / 2 - 22, width: bw, height: 44)
                    ny = rowH + 2
                } else {
                    lineLabel.frame = CGRect(x: 0, y: 0, width: noteW, height: max(lh, rowH))
                    lineDot.frame = .zero
                    changeButton.frame = CGRect(x: -4, y: lineLabel.frame.maxY + 2 + rowH / 2 - 22, width: bw, height: 44)
                    ny = lineLabel.frame.maxY + 2 + rowH + 2
                }
            }
        }
        if !noteLabel.isHidden {
            let nh = ceil(noteLabel.sizeThatFits(CGSize(width: noteW - 14, height: .greatestFiniteMagnitude)).height)
            noteLabel.frame = CGRect(x: 14, y: ny, width: noteW - 14, height: nh)
            noteDot.frame = CGRect(x: 0, y: ny + (noteLabel.font.lineHeight - 6) / 2, width: 6, height: 6)
            ny = noteLabel.frame.maxY
        }
        noteView.frame = CGRect(x: gridRect.minX, y: noteTop + max(0, (k.noteHeight - ny) / 2), width: noteW, height: max(ny, 1))

        recallGridRect = gridRect
        if !reversing { // 判断 → 回忆倒放中：书写格 / 参考格的位置由动画驱动（版式不覆盖）
            if phase == .recall {
                gridFrame.frame = gridRect
            } else {
                // 判断：上下两格（同一顶边、同一中线，共用一条格线 = 第二格上移 frameW；D46 ⑪）。边长按「主区高 − 说明句」算（保存失败时底栏长高）
                let s = min(g, NativeWriteLayout.judgePair(width: w, mainHeight: mainH - noteExtra, gridTop: gridTop - headBottom, k))
                gridFrame.frame = CGRect(x: (w - s) / 2, y: gridTop, width: s, height: s)
                refFrame.frame = CGRect(x: (w - s) / 2, y: gridTop + s - frameW, width: s, height: s)
                refGlyph.frame = refFrame.bounds
            }
            ink?.frame = gridFrame.frame.insetBy(dx: frameW, dy: frameW)
        }
        noInkLabel.frame = gridFrame.frame.insetBy(dx: 8, dy: 8)
        hintLayer.frame = gridRect.insetBy(dx: frameW, dy: frameW)
    }

    // MARK: 控件样式（设计系统：文字按钮 15 ink2；凹面求助 field 底 17/500；主按钮墨底 17/500 圆角 12）

    private func configureTextButton(_ b: UIButton, title: String, icon: String?, id: String) {
        b.setTitle(title, for: .normal)
        if let icon {
            b.setImage(UIImage(systemName: icon, withConfiguration: UIImage.SymbolConfiguration(textStyle: .subheadline)), for: .normal)
        }
        b.titleLabel?.font = UIFont.preferredFont(forTextStyle: .subheadline)
        b.titleLabel?.adjustsFontForContentSizeCategory = true
        b.tintColor = color("ink2", .secondaryLabel)
        b.setTitleColor(color("ink2", .secondaryLabel), for: .normal)
        b.setTitleColor(color("ink4", .tertiaryLabel), for: .disabled)
        b.accessibilityIdentifier = id
    }

    private func configureHelp(_ b: UIButton, title: String, icon: String?, id: String) {
        b.setTitle(title, for: .normal)
        if let icon { b.setImage(UIImage(systemName: icon), for: .normal) }
        b.titleLabel?.font = Self.scaled(.body, 17, .medium)
        b.titleLabel?.adjustsFontForContentSizeCategory = true
        b.titleLabel?.numberOfLines = 2
        b.titleLabel?.textAlignment = .center
        b.tintColor = color("ink2", .secondaryLabel)
        b.setTitleColor(color("ink1", .label), for: .normal)
        b.setTitleColor(color("ink4", .tertiaryLabel), for: .disabled)
        b.backgroundColor = color("field", .secondarySystemFill)
        b.layer.cornerRadius = 12
        b.accessibilityIdentifier = id
    }

    private func configurePrimary(_ b: UIButton, title: String, id: String) {
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = Self.scaled(.body, 17, .medium)
        b.titleLabel?.adjustsFontForContentSizeCategory = true
        b.backgroundColor = color("ink1", .label)
        b.setTitleColor(color("paper", .systemBackground), for: .normal)
        b.setTitleColor(color("ink4", .tertiaryLabel), for: .disabled)
        b.layer.cornerRadius = 12
        b.accessibilityIdentifier = id
    }

    private func configureOutline(_ b: UIButton, title: String, id: String) {
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = Self.scaled(.body, 17, .medium)
        b.titleLabel?.adjustsFontForContentSizeCategory = true
        b.setTitleColor(color("ink1", .label), for: .normal)
        b.layer.cornerRadius = 12
        b.layer.borderWidth = 1
        b.layer.borderColor = color("ink4", .separator).cgColor
        b.accessibilityIdentifier = id
        // 按下的底是 field（网页 .sz-judge__btn[data-pressed]）；只有按下态，没有选中 / 预选 / 判定着色（D03）
        b.addAction(UIAction { [weak b, weak self] _ in b?.backgroundColor = self?.color("field", .secondarySystemFill) }, for: [.touchDown, .touchDragEnter])
        b.addAction(UIAction { [weak b] _ in b?.backgroundColor = .clear }, for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit])
    }

    // MARK: 动作

    private var currentPhaseName: String { phase == .compare ? "compare" : "recall" }

    private func persistStrokes() {
        guard let key = cardKey else { return }
        bridge.send("strokes", ["slot": slot, "cardKey": key, "strokes": NativeInkWire.wire(strokes), "phase": currentPhaseName])
    }

    @objc private func tapBack() {
        if phase == .compare { continueWriting(); return }
        coordinator?.nativeWriteDidRequestBack(self)
    }

    @objc private func tapUndo() {
        if !strokes.isEmpty { strokes.removeLast() } else if let c = cleared { strokes = c; cleared = nil } else { return }
        ink.syncPageStrokes(strokes)
        restoreHint(toCount: strokes.count)
        refresh()
        view.setNeedsLayout()
        persistStrokes()
    }

    @objc private func tapClear() {
        guard !strokes.isEmpty else { return }
        cleared = strokes
        strokes = []
        ink.syncPageStrokes(strokes)
        restoreHint(toCount: 0)
        refresh()
        view.setNeedsLayout()
        persistStrokes()
    }

    @objc private func tapDone() {
        guard phase == .recall, !strokes.isEmpty, let key = cardKey else { return }
        lightHaptic.impactOccurred(intensity: 0.5)
        bridge.send("phase", ["slot": slot, "cardKey": key, "phase": "compare", "strokes": NativeInkWire.wire(strokes)])
        enterCompare()
    }

    // MARK: 回忆 ⇄ 判断（T-phase；交互规范 T0 / N3-3；时长与缓动取页面 motion：inkFlip / phaseReverse / easeOut / fade / reduce）

    /// 「写好了」→ 判断页：本人墨以顶边中点为原点纯缩放（inkFlip，ease.out）进上格；参考格在 fade 之后淡入（inkFlip 长）；两键按时刻编排出现。
    /// 减少动态效果：不缩放，整页 150ms 交叉淡化，两键直接可点（T0-3）。
    private func enterCompare() {
        phase = .compare
        markStateChange()
        reverseFinished = false
        if reduceMotion {
            crossfade {
                self.refFrame.alpha = 1
                self.refresh()
                self.renderHint(fadeIn: false)
                self.view.setNeedsLayout()
                self.view.layoutIfNeeded()
            }
            disarmJudgeKeys()
            UIAccessibility.post(notification: .screenChanged, argument: centerLabel)
            return
        }
        // 参考格先就位（不从零尺寸长出来），随两格版式一起出现
        UIView.performWithoutAnimation {
            view.setNeedsLayout()
            view.layoutIfNeeded()
            refFrame.alpha = 0
        }
        phase = .recall
        view.setNeedsLayout()
        view.layoutIfNeeded() // 书写格回到动画起点
        phase = .compare
        armJudgeKeys()
        refresh()
        renderHint(fadeIn: false)
        // .allowUserInteraction：动画进行中落笔照常生效（T0 规则 3；落笔时 settleAnimations 让动画一帧到终态）
        let a = UIViewPropertyAnimator(duration: dur("inkFlip"), timingParameters: NativeBezier.timing(easeOut))
        a.addAnimations {
            self.view.setNeedsLayout()
            self.view.layoutIfNeeded()
        }
        a.isUserInteractionEnabled = true
        a.startAnimation()
        UIView.animate(withDuration: dur("inkFlip"), delay: dur("fade"), options: [.curveLinear, .allowUserInteraction]) {
            self.refFrame.alpha = 1
        }
        UIAccessibility.post(notification: .screenChanged, argument: centerLabel) // 焦点落在页标题，不落在任何判断键上（D03）
    }

    /// 「‹ 接着写」（点按）：判断 → 回忆的 T-phase 倒放（phaseReverse，ease.out）。
    private func continueWriting() {
        guard phase == .compare, !submitting, !reversing else { return }
        startReverse(interactive: false)
    }

    /// 倒放的起点。interactive = 左缘右滑跟手（暂停在 0，由手指决定进度）；否则直接播放。
    /// 画面：上格（本人书写）以顶边中点为原点长回书写格的大小与位置，参考格与两键淡出，题面与页头不动；结束后文字区 150ms 交叉淡化换成回忆阶段的内容。
    private func startReverse(interactive: Bool) {
        guard phase == .compare, !submitting, !reversing, cardKey != nil else { return }
        if failed {
            failed = false
            refresh()
            view.layoutIfNeeded()
        }
        disarmJudgeKeys()
        if reduceMotion {
            // 减少动态效果：不缩放，整页 150ms 交叉淡化（点按立即；手势在松手时由 handleEdgeBack 调用）
            crossfade { self.completeReverse() }
            return
        }
        settleAnimations()
        let target = recallGridRect
        reversing = true
        reverseFinished = false
        ink?.drawable = true // 倒放进行中落笔：动画一帧到终态，这一笔照常生效（T0 规则 3）
        let timing: UITimingCurveProvider = interactive ? UICubicTimingParameters(animationCurve: .linear) : NativeBezier.timing(easeOut)
        let a = UIViewPropertyAnimator(duration: max(0.01, dur("phaseReverse")), timingParameters: timing)
        a.addAnimations {
            self.gridFrame.frame = target
            self.ink?.frame = target.insetBy(dx: self.frameW, dy: self.frameW)
            self.refFrame.alpha = 0
            self.setJudgeKeysAlpha(0)
            self.noInkLabel.alpha = 0
        }
        a.addCompletion { [weak self] pos in self?.reverseEnded(at: pos) }
        a.isUserInteractionEnabled = true
        reverseAnimator = a
        if interactive { a.pauseAnimation() } else { a.startAnimation() }
    }

    /// 左缘右滑的判断阶段三步（手势识别器与测试同一条路）：开始 / 跟手（progress = 位移 ÷ 屏宽，与网页同一口径）/ 松手（commit = 过阈值）。
    func edgeReverseBegan() {
        guard phase == .compare, !submitting, !reversing else { return }
        startReverse(interactive: true)
    }

    func edgeReverseChanged(progress: CGFloat) {
        reverseAnimator?.fractionComplete = min(1, max(0, progress))
    }

    func edgeReverseEnded(commit: Bool) {
        guard let a = reverseAnimator, reversing else { return }
        if commit {
            a.isReversed = false
            a.continueAnimation(withTimingParameters: NativeBezier.timing(easeOut), durationFactor: max(0.25, 1 - a.fractionComplete))
        } else {
            a.isReversed = true
            a.continueAnimation(withTimingParameters: nil, durationFactor: 0.5)
        }
    }

    private func reverseEnded(at pos: UIViewAnimatingPosition) {
        guard reverseAnimator != nil || reversing else { return }
        reverseAnimator = nil
        reversing = false
        if pos == .end {
            finishReverse()
        } else {
            // 手势没过阈值：回到判断页（上格 / 参考格 / 两键回到原样）
            refFrame.alpha = 1
            noInkLabel.alpha = 1
            setJudgeKeysAlpha(1)
            ink?.drawable = submitting
            UIView.performWithoutAnimation {
                view.setNeedsLayout()
                view.layoutIfNeeded()
            }
        }
    }

    /// 倒放走完 → 回忆阶段：文字区交叉淡化（内容变了的旧的 0–75ms 淡出、新的 75–150ms 淡入），现场写回 phase recall（P52 不阻断）。
    private func finishReverse() {
        guard !reverseFinished, phase == .compare else { return }
        reverseFinished = true
        swapText { self.completeReverse() }
    }

    /// 回忆阶段的状态切换本身（无动画）。
    private func completeReverse() {
        guard phase == .compare, let key = cardKey else { return }
        failed = false
        phase = .recall
        markStateChange()
        bridge.send("phase", ["slot": slot, "cardKey": key, "phase": "recall"])
        refFrame.alpha = 1
        noInkLabel.alpha = 1
        setJudgeKeysAlpha(1)
        refresh()
        renderHint(fadeIn: false)
        view.setNeedsLayout()
        view.layoutIfNeeded()
        UIAccessibility.post(notification: .screenChanged, argument: centerLabel)
    }

    /// 倒放进行中被打断（落笔 / 点按）：一帧到终态，状态切到回忆（T0 规则 3）。
    private func settleReverse() {
        guard let a = reverseAnimator else { return }
        a.stopAnimation(false)
        a.finishAnimation(at: .end)
        if reverseAnimator != nil { reverseEnded(at: .end) }
    }

    /// 减少动态效果的整页交叉淡化：旧页的替身 reduce（150ms）线性淡出，新状态在它下面（D58 ②）。
    private func crossfade(_ change: () -> Void) {
        settleAnimations()
        let ghost = view.snapshotView(afterScreenUpdates: false)
        ghost?.isUserInteractionEnabled = false
        ghost?.accessibilityElementsHidden = true
        change()
        guard let ghost else { return }
        ghost.frame = view.bounds
        view.addSubview(ghost)
        transitionOverlay = ghost
        UIView.animate(withDuration: dur("reduce"), delay: 0, options: [.curveLinear, .allowUserInteraction]) {
            ghost.alpha = 0
        } completion: { [weak self, weak ghost] _ in
            ghost?.removeFromSuperview()
            if self?.transitionOverlay === ghost { self?.transitionOverlay = nil }
        }
    }

    private func ghostOf(_ v: UIView, in overlay: UIView) -> UIView? {
        guard !v.isHidden, v.alpha > 0, let s = v.snapshotView(afterScreenUpdates: false) else { return nil }
        s.frame = v.frame
        overlay.addSubview(s)
        return s
    }

    /// 文字类区域（页头标题 / 计数 / 格下说明 / 底栏）的状态切换：内容变了的旧的 0–textOut 淡出、新的 textOut–fade 淡入，不叠字；内容没变的不动。
    /// 减少动态效果：整页交叉淡化（不走这里）。
    private func swapText(_ change: () -> Void) {
        if reduceMotion {
            crossfade(change)
            return
        }
        let fade = dur("fade") > 0 ? dur("fade") : 0.15
        let textOut = dur("textOut") > 0 ? dur("textOut") : fade / 2
        let regions: [UIView] = [centerLabel, progressLabel, noteView, footView]
        let oldKeys = regions.map(textKey)
        let overlay = UIView(frame: view.bounds)
        overlay.isUserInteractionEnabled = false
        overlay.accessibilityElementsHidden = true
        let ghosts = regions.map { ghostOf($0, in: overlay) }
        change()
        view.layoutIfNeeded()
        view.addSubview(overlay)
        transitionOverlay = overlay
        for (i, v) in regions.enumerated() {
            guard let g = ghosts[i] else { continue }
            if textKey(v) == oldKeys[i] { g.removeFromSuperview(); continue }
            v.alpha = 0
            UIView.animate(withDuration: textOut, delay: 0, options: [.curveLinear, .allowUserInteraction]) { g.alpha = 0 }
            UIView.animate(withDuration: fade - textOut, delay: textOut, options: [.curveLinear, .allowUserInteraction]) { v.alpha = 1 } completion: { [weak self, weak overlay] _ in
                overlay?.removeFromSuperview()
                if self?.transitionOverlay === overlay { self?.transitionOverlay = nil }
            }
        }
        if !regions.indices.contains(where: { ghosts[$0] != nil && textKey(regions[$0]) != oldKeys[$0] }) { overlay.removeFromSuperview(); transitionOverlay = nil }
    }

    // MARK: 换字转场（T-phase；交互规范 T0：文字类先出后进，非文字 150ms 淡出；减少动态效果 150ms 交叉淡化）

    /// 文字类区域此刻的内容（内容没变的区域不动：「‹」、不变的题面不闪）。
    private func textKey(_ v: UIView) -> String {
        switch v {
        case centerLabel: return centerLabel.text ?? ""
        case progressLabel: return progressLabel.isHidden ? "" : progressLabel.text ?? ""
        case promptView: return (promptCells.map { $0.accessibilityLabel ?? "" } + [promptHint.text ?? ""]).joined(separator: "|")
        case noteView: return [lineLabel.isHidden ? "" : lineLabel.text ?? "", changeButton.isHidden ? "" : "c", noteLabel.isHidden ? "" : noteLabel.text ?? ""].joined(separator: "|")
        case footView: return ([hintButtonView, doneButton, wrongButton, correctButton, failCancel, failRetry].map { $0.isHidden ? "" : ($0.title(for: .normal) ?? "") } + [failNote.isHidden ? "" : "n"]).joined(separator: "|")
        default: return ""
        }
    }

    private func advance(to next: [String: Any]) {
        settleAnimations()
        let reduce = reduceMotion
        let fade = dur("fade") > 0 ? dur("fade") : 0.15
        let textOut = reduce ? fade : (dur("textOut") > 0 ? dur("textOut") : fade / 2)
        let textRegions: [UIView] = [centerLabel, progressLabel, promptView, noteView, footView]
        let oldKeys = textRegions.map(textKey)
        let oldFrames = [gridFrame.frame, refFrame.frame]
        // 旧样子的替身（渲染服务器的副本，含书写面的 Metal 内容）：书写格、参考格、本人墨、提示层、各文字区
        let overlay = UIView(frame: view.bounds)
        overlay.isUserInteractionEnabled = false
        overlay.accessibilityElementsHidden = true
        var textGhosts: [Int: UIView] = [:]
        var shapeGhosts: [UIView] = []
        func ghost(_ v: UIView) -> UIView? {
            guard !v.isHidden, v.alpha > 0, let s = v.snapshotView(afterScreenUpdates: false) else { return nil }
            s.frame = v.frame
            overlay.addSubview(s)
            return s
        }
        for v in [gridFrame, refFrame, hintLayer] { if let g = ghost(v) { shapeGhosts.append(g) } }
        if let ink, !strokes.isEmpty, let g = ghost(ink) { shapeGhosts.append(g) }
        for (i, v) in textRegions.enumerated() { textGhosts[i] = ghost(v) }

        apply(snapshot: next, keepLocal: false)
        view.layoutIfNeeded()

        view.addSubview(overlay)
        transitionOverlay = overlay
        // 文字类：内容变了的旧的先出（0–textOut），新的后进（textOut–fade）；减少动态效果：同时 150ms 交叉淡化
        for (i, v) in textRegions.enumerated() {
            let changed = textKey(v) != oldKeys[i]
            guard let g = textGhosts[i] else { continue }
            if !changed { g.removeFromSuperview(); continue }
            v.alpha = 0
            UIView.animate(withDuration: textOut, delay: 0, options: [.curveLinear, .allowUserInteraction]) { g.alpha = 0 }
            UIView.animate(withDuration: reduce ? fade : fade - textOut, delay: reduce ? 0 : textOut, options: [.curveLinear, .allowUserInteraction]) { v.alpha = 1 }
        }
        // 非文字：旧的 150ms 淡出；书写格框位置 / 大小变了的（判断两格 → 回忆一格）新的同时淡入，没变的不动
        if gridFrame.frame != oldFrames[0] {
            gridFrame.alpha = 0
            UIView.animate(withDuration: fade, delay: 0, options: [.curveLinear, .allowUserInteraction]) { self.gridFrame.alpha = 1 }
        } else if let first = shapeGhosts.first, first.frame == gridFrame.frame {
            first.removeFromSuperview() // 同一个格框：只留真的那一个（不做两层半透明）
        }
        UIView.animate(withDuration: fade, delay: 0, options: [.curveLinear, .allowUserInteraction]) {
            shapeGhosts.forEach { $0.alpha = 0 }
        } completion: { [weak self, weak overlay] _ in
            overlay?.removeFromSuperview()
            if self?.transitionOverlay === overlay { self?.transitionOverlay = nil }
        }
        UIAccessibility.post(notification: .screenChanged, argument: centerLabel)
    }

    // MARK: 判断两键的出现与就绪（时刻编排 M1：0–judgeAppear 不显示，之后 60% 且不可点，judgeReady 变实可点；取代看不见的锁）

    private func armJudgeKeys() {
        judgeArmToken += 1
        let token = judgeArmToken
        // 减少动态效果 / 读屏：直接可点、不淡入（T0-3：不留看不见的锁）
        guard judgeReady > 0, !UIAccessibility.isReduceMotionEnabled, !UIAccessibility.isVoiceOverRunning else {
            disarmJudgeKeys()
            return
        }
        judgeKeysReady = false
        setJudgeKeysAlpha(0)
        DispatchQueue.main.asyncAfter(deadline: .now() + judgeAppear) { [weak self] in
            guard let self, self.judgeArmToken == token else { return }
            self.setJudgeKeysAlpha(0.6)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + judgeReady) { [weak self] in
            guard let self, self.judgeArmToken == token else { return }
            self.judgeKeysReady = true
            self.setJudgeKeysAlpha(1)
            self.refresh()
        }
    }

    private func disarmJudgeKeys() {
        judgeArmToken += 1
        judgeKeysReady = true
        setJudgeKeysAlpha(1)
    }

    private func setJudgeKeysAlpha(_ a: CGFloat) {
        wrongButton.alpha = a
        correctButton.alpha = a
    }

    /// 落笔 / 点按时正在进行的版式动画与换字转场一帧到终态（T0 规则 3：动画不挡输入，这次输入照常生效）。
    private func settleAnimations() {
        settleReverse()
        view.layer.removeAllAnimations()
        for v in view.subviews {
            v.layer.removeAllAnimations()
            if v !== transitionOverlay, v.alpha < 1, !(v === refFrame && phase == .recall) { v.alpha = 1 }
        }
        refFrame.alpha = 1
        transitionOverlay?.removeFromSuperview()
        transitionOverlay = nil
        hintLayer.settle()
    }

    @objc private func tapWrong() { judge("wrong") }
    @objc private func tapCorrect() { judge("correct") }
    /// 保存失败三段式的「再试一次」：重发上一次的判断（commit 是原子事务，失败不留半条记录，重试不重复计数，D07）。
    @objc private func tapRetry() { judge(lastJudgment) }
    @objc private func tapFailCancel() {
        // 「先不保存」：回到判断前（两键），笔迹仍在（R-W16）；失败态到判断态是新状态（0.4s 不响应，走查 W08）
        failed = false
        markStateChange()
        refresh()
        view.setNeedsLayout()
    }

    // MARK: 结果行「修改 ›」与改判弹层（D19）

    @objc private func tapChange() {
        guard phase == .recall, !submitting, let line = snapshot["line"] as? [String: Any], (line["canChange"] as? Bool) == true,
              let rid = line["recordId"] as? String else { return }
        bridge.call("correct", ["slot": slot, "recordId": rid, "action": "state"]) { [weak self] reply in
            guard let self else { return }
            guard reply.ok, let model = NativeChangeSheetViewController.Model(reply.body) else {
                // 结果行已不是这条记录（stale）：按回包快照刷新，「修改 ›」随之收起
                if let snap = reply.snapshot { self.apply(snapshot: snap, keepLocal: true) }
                return
            }
            self.presentChangeSheet(model)
        }
    }

    func presentChangeSheet(_ model: NativeChangeSheetViewController.Model) {
        guard presentedViewController == nil else { return }
        let style = NativeJudgeStyle(tr: { [weak self] k, v in self?.tr(k, v) ?? "" }, color: { [weak self] n, f in self?.color(n, f) ?? f }, inkTint: inkTint)
        let vc = NativeChangeSheetViewController(slot: slot, model: model, bridge: bridge, style: style) { [weak self] snap in
            // 改判成功：结果行换成「已改为……」，当前字的笔迹 / 提示 / 阶段原样（只改这一次，D19）
            if let snap, (snap["cardKey"] as? String) == self?.cardKey { self?.apply(snapshot: snap, keepLocal: true) }
        }
        present(vc, animated: true)
    }

    /// 测试：没有本人笔画的判断页（正常流程到不了，R-W17）。
    func forceCompareWithoutInkForTesting() {
        strokes = []
        ink?.syncPageStrokes([])
        phase = .compare
        refresh()
        view.setNeedsLayout()
        view.layoutIfNeeded()
    }

    var gridFrameLineWidthForTesting: CGFloat { gridFrame.layer.borderWidth }
    var noInkTextForTesting: String? { noInkLabel.text }
    var failNoteTextForTesting: String? { failNote.isHidden ? nil : failNote.text }
    var failNoteFrameForTesting: CGRect { failNote.convert(failNote.bounds, to: view) }
    var lineTextForTesting: String? { lineLabel.isHidden ? nil : lineLabel.text }
    /// 题面里能被读到 / 看到的全部文字（题面不含答案字，D16）。
    var promptTextsForTesting: [String] {
        promptCells.flatMap { c -> [String] in
            [c.accessibilityLabel ?? ""] + c.subviews.flatMap { sub -> [String] in
                if let l = sub as? UILabel { return [l.text ?? ""] }
                if let g = sub as? NativeGlyphView { return [g.char] }
                return []
            }
        }
    }

    var changeSheetForTesting: NativeChangeSheetViewController? { presentedViewController as? NativeChangeSheetViewController }
    var changeShownForTesting: Bool { !changeButton.isHidden }
    var failShownForTesting: Bool { phase == .compare && failed }
    var reversingForTesting: Bool { reversing }
    var settlePlayedForTesting = 0
    var noInkShownForTesting: Bool { !noInkLabel.isHidden }
    var judgeKeysForTesting: (wrong: UIButton, correct: UIButton) { (wrongButton, correctButton) }
    var failRetryForTesting: UIButton { failRetry }
    var failCancelForTesting: UIButton { failCancel }
    var progressTextForTesting: String? { progressLabel.isHidden ? nil : progressLabel.text }
    var titleTextForTesting: String? { centerLabel.text }
    var judgeKeysReadyForTesting: Bool { judgeKeysReady }
    var gridFramesForTesting: (mine: CGRect, ref: CGRect) { (gridFrame.frame, refFrame.frame) }

    private var lastJudgment = "correct"

    private func judge(_ judgment: String) {
        guard phase == .compare, !submitting, !reversing, let key = cardKey, !strokes.isEmpty else { return }
        submitting = true
        lastJudgment = judgment
        // 回包之前落下的笔先持住（不画、不交出），推进到下一个字后接着画（P227 同语义：这一笔不丢）
        ink?.acceptFrom = .infinity
        refresh()
        judgeHaptic.prepare()
        // D66 ②：提示次数取本地与已存的较大者（提示写入失败时本地多于已存，P52）
        let hints = max(snapshot["hints"] as? Int ?? 0, hint?.used ?? 0)
        bridge.call("judge", ["slot": slot, "cardKey": key, "judgment": judgment, "strokes": NativeInkWire.wire(strokes), "hints": hints]) { [weak self] reply in
            guard let self else { return }
            self.submitting = false
            // 结果未知后重发（或连点）：页面回 stale 且快照已经不是这个字 → 上一次其实已提交，按成功对账（不多记，D07）
            let advanced = !reply.ok && reply.errorKind == "stale" && reply.snapshot.map { ($0["cardKey"] as? String) != key } == true
            guard reply.ok || advanced else {
                // D07：没保存上——留在判断页，笔迹还在；两键换成「先不保存 / 再试一次」。这期间持住的笔不属于任何一个字，丢掉
                self.ink?.dropHeld()
                self.ink?.acceptFrom = 0
                self.failed = true
                self.refresh()
                self.view.setNeedsLayout()
                UIAccessibility.post(notification: .announcement, argument: self.failNote.text)
                return
            }
            self.failed = false
            let finished = reply.body["finished"] as? [String: Any]
            if let finished, let sid = finished["sessionId"] as? String {
                self.judgeHaptic.impactOccurred(intensity: 0.7)
                self.coordinator?.nativeWriteDidFinish(self, sessionId: sid)
                return
            }
            if advanced, let snap = reply.snapshot, (snap["active"] as? Bool) != true || (snap["done"] as? Bool) == true {
                // 已提交的是最后一个字：这组已结束，交给结果页
                self.judgeHaptic.impactOccurred(intensity: 0.7)
                self.coordinator?.nativeWriteDidFinish(self, sessionId: self.snapshot["sessionId"] as? String ?? "")
                return
            }
            if let next = reply.snapshot {
                // M23 判断落定：commit 成功后本人笔迹离纸、收进页头计数，触觉与第一帧同帧（F1：成功后才发，失败三段式不发）
                let plan = self.settlePlan()
                self.ink?.isHidden = plan != nil // 墨在第 0 帧离开纸面：这一层由落定叠层接着画
                self.advance(to: next)
                self.ink?.isHidden = false
                if let plan, !self.playSettle(plan) { self.judgeHaptic.impactOccurred(intensity: 0.7) }
                if plan == nil { self.judgeHaptic.impactOccurred(intensity: 0.7) }
                self.scheduleAutoStep()
            }
        }
    }

    // MARK: 判断落定（M23；时刻与曲线来自页面 motion.settle，NativeSettle 只负责画）

    private struct SettlePlan {
        let from: CGRect
        let to: CGRect?
        let strokes: [[InkRawPoint]]
    }

    /// 落定前的记录：上格墨的位置、页头计数的位置、本人笔画。没有笔画 / 页面没给时刻（没有 settle 参数）/ 没有书写面 → nil（不做落定动画）。
    private func settlePlan() -> SettlePlan? {
        guard settleSpec != nil, let ink, !strokes.isEmpty, ink.window != nil else { return nil }
        return SettlePlan(from: ink.frame, to: progressLabel.isHidden ? nil : progressLabel.frame, strokes: strokes)
    }

    private func playSettle(_ plan: SettlePlan) -> Bool {
        guard let spec = settleSpec, let ink else { return false }
        let played = NativeSettle.play(in: view, from: plan.from, to: plan.to, strokes: plan.strokes, params: ink.params, color: ink.inkColor, spec: spec,
                                       reduceMotion: reduceMotion) { [weak self] in
            self?.judgeHaptic.impactOccurred(intensity: 0.7)
        }
        if played != nil { settlePlayedForTesting += 1 }
        return played != nil
    }

    // MARK: 量测用自动驾驶（DEBUG：SHIZI_NW_AUTO=1；每个字写一笔合成笔画 →「写好了」→ 判断，写错 / 写对交替）

    static var autoDrive: Bool { ProcessInfo.processInfo.environment["SHIZI_NW_AUTO"] == "1" }
    private var autoCount = 0

    func scheduleAutoStep() {
        guard Self.autoDrive else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.autoStep() }
    }

    private func autoStep() {
        guard !exitHandled, !submitting, cardKey != nil else { return }
        if phase == .recall {
            let t0 = CACurrentMediaTime() * 1000
            let stroke = (0..<12).map { i in InkRawPoint(x: 60 + Double(i) * 20, y: 170 + Double(i % 3), t: t0 + Double(i) * 16) }
            nativeInkDidEndStroke(ink, raw: stroke)
            tapDone()
            scheduleAutoStep()
        } else {
            autoCount += 1
            judge(autoCount % 2 == 0 ? "wrong" : "correct")
        }
    }

    @objc private func handleEdgeBack(_ g: UIScreenEdgePanGestureRecognizer) {
        let x = max(0, g.translation(in: view).x), v = g.velocity(in: view).x
        let width = max(1, view.bounds.width)
        if phase == .compare {
            // 判断阶段：左缘右滑 = 「‹ 接着写」，跟手画面是 T-phase 倒放（上格长回书写格、参考格与两键淡出）；过阈值才完成，否则回弹（N3-3）。
            // 减少动态效果：不跟手，松手按同一阈值判定，完成后 150ms 淡化。
            let commit = BackGestureThreshold.commits(distance: x, velocity: v, width: width)
            if reduceMotion {
                if g.state == .ended, commit { continueWriting() }
                return
            }
            switch g.state {
            case .began: edgeReverseBegan()
            case .changed: edgeReverseChanged(progress: x / width)
            case .ended: edgeReverseEnded(commit: commit)
            case .cancelled, .failed: edgeReverseEnded(commit: false)
            default: break
            }
            return
        }
        switch g.state {
        case .began:
            guard !submitting else { return }
            settleAnimations()
            ink?.cancelStroke(reason: "cancel", notify: false) // 落笔中被手势打断：这一笔丢弃（与网页 pointercancel 同语义）
            transitions.interactor = UIPercentDrivenInteractiveTransition()
            dismiss(animated: true)
        case .changed:
            transitions.interactor?.update(min(1, x / width))
        case .ended, .cancelled, .failed:
            guard let it = transitions.interactor else { return }
            transitions.interactor = nil
            if g.state == .ended, BackGestureThreshold.commits(distance: x, velocity: v, width: width) { it.finish() } else { it.cancel() }
        default:
            break
        }
    }
}

extension NativeWriteViewController: NativeInkViewDelegate {
    func nativeInkDidBeginStroke(_ view: NativeInkView, at timestamp: TimeInterval) {
        settleAnimations()
        guard phase == .recall else { return }
        // 落笔：上一字的结果行收起（D19，本字内不再出现）
        if !penDown {
            penDown = true
            refresh()
            self.view.setNeedsLayout()
        }
    }

    func nativeInkDidEndStroke(_ view: NativeInkView, raw: [InkRawPoint]) {
        guard phase == .recall else { return }
        strokes.append(raw)
        cleared = nil
        penDown = true
        view.syncPageStrokes(strokes)
        absorbHint(index: strokes.count - 1, raw: raw)
        refresh()
        self.view.setNeedsLayout()
        persistStrokes()
    }

    func nativeInkDidCancelStroke(_ view: NativeInkView, reason: String) {}

    /// Apple Pencil 双击（按系统偏好映射，NativeInkPencilAction）：与格下「撤销 / 清空」同一个动作，只在回忆阶段。
    func nativeInk(_ view: NativeInkView, didRequest action: NativeInkPencilAction) {
        guard phase == .recall, !submitting else { return }
        switch action {
        case .undo: tapUndo()
        case .clear: tapClear()
        }
    }
}
#endif
