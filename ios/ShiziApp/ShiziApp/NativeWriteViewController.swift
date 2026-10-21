#if DEBUG
import UIKit
import WebKit

// 原生写字页（B2.0 最小纵切；docs/engineering/v10/B2-原生写字架构.md §6）。只在 DEBUG、启动参数 -shizi-native-write 时出现。
//
// 回忆：题面（词语 + 拼音，要写的字是空格）+ 书写格（NativeInkView：跟手、抬笔落笔）+ 格下「撤销 / 清空」（清空后可撤销一次）+「写好了」（无墨不可点）。
// 判断：书写格收成上格（你写的）、下格标准写法（data/<字>.json 轮廓），「写错了 / 写对了」；左上「‹」= 接着写（左缘右滑同一个动作）。
// 提交：judge 经桥由页面 store.commit 完成（与网页同一个 commitJudgment）；成功才推进（D07），失败留在判断页三段式（R-W16）。
// 现场：抬笔 / 撤销 / 清空后发 strokes（P52 不阻断，不等回包）；进 / 出判断页发 phase。
// 文案：全部取自页面 src/config/copy（open 回包的 copy 字典），本文件不写任何用户可见的字。
// 不在本纵切里（见架构文档 §8 后续卡）：提示、看答案、跳过、结束这组、结果行与改判、换字防误触时窗、转场与落定动效、读屏逐笔播报。

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
    private(set) var phase: Phase = .recall
    private(set) var strokes: [[InkRawPoint]] = []
    private var cleared: [[InkRawPoint]]?
    private var submitting = false
    private var failed = false
    /// 已经交给协调者离开（返回 / 结果页），之后的 viewDidDisappear 不再发 exit。
    var exitHandled = false
    /// 页面打开量测：消息到达时刻（CACurrentMediaTime）与页面发出时刻（epoch ms）。
    var openTiming: (sentAtEpochMs: Double, receivedAt: CFTimeInterval, receivedEpochMs: Double)?

    // MARK: 视图

    private let backButton = UIButton(type: .system)
    private let centerLabel = UILabel()
    private let promptRow = UIView()
    private var promptCells: [UIView] = []
    private let gridFrame = UIView()
    private var ink: NativeInkView!
    private let refFrame = UIView()
    private let refGlyph = NativeGlyphView()
    private let undoButton = UIButton(type: .system)
    private let clearButton = UIButton(type: .system)
    private let doneButton = UIButton(type: .system)
    private let wrongButton = UIButton(type: .system)
    private let correctButton = UIButton(type: .system)
    private let failNote = UILabel()
    private let failCancel = UIButton(type: .system)
    private let edgeBack = UIScreenEdgePanGestureRecognizer()
    private lazy var judgeHaptic = UIImpactFeedbackGenerator(style: .soft)
    private lazy var lightHaptic = UIImpactFeedbackGenerator(style: .light)

    init(slot: String, payload: [String: Any], bridge: NativeWriteBridge) {
        self.slot = slot
        self.bridge = bridge
        self.snapshot = payload["snapshot"] as? [String: Any] ?? [:]
        self.copy = (payload["copy"] as? [String: String]) ?? [:]
        super.init(nibName: nil, bundle: nil)
        applyColors(payload["colors"] as? [String: String])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    // MARK: 文案 / 颜色（单一来源：页面）

    private func tr(_ key: String, _ vars: [String: CustomStringConvertible] = [:]) -> String {
        var s = copy[key] ?? ""
        for (k, v) in vars { s = s.replacingOccurrences(of: "{\(k)}", with: v.description) }
        return s
    }

    private func applyColors(_ raw: [String: String]?) {
        for (k, v) in raw ?? [:] {
            if let c = NativeInkSpike.parseColor(v) {
                colors[k] = UIColor(red: CGFloat(c.x), green: CGFloat(c.y), blue: CGFloat(c.z), alpha: CGFloat(c.w))
            }
        }
    }

    private func color(_ name: String, _ fallback: UIColor) -> UIColor { colors[name] ?? fallback }

    // MARK: 生命周期

    override func loadView() {
        let v = UIView()
        v.backgroundColor = color("paper", UIColor(named: "Paper") ?? .systemBackground)
        view = v
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let renderer = NativeInkRenderer(), let inkView = NativeInkView(frame: .zero, renderer: renderer) else {
            NSLog("[shizi] native-write: Metal unavailable")
            return
        }
        ink = inkView
        ink.latency = NativeWriteMetrics.shared.inkLatency
        ink.delegate = self
        ink.isAccessibilityElement = true
        ink.accessibilityTraits = [.allowsDirectInteraction]
        if let c = colors["hand"] { var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0; c.getRed(&r, green: &g, blue: &b, alpha: &a); ink.inkColor = SIMD4(Float(r), Float(g), Float(b), 1) }

        backButton.setImage(UIImage(systemName: "chevron.left", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .regular)), for: .normal)
        backButton.tintColor = color("ink1", .label)
        backButton.addTarget(self, action: #selector(tapBack), for: .touchUpInside)
        backButton.accessibilityIdentifier = "native-write-back"

        centerLabel.font = UIFont.preferredFont(forTextStyle: .subheadline)
        centerLabel.adjustsFontForContentSizeCategory = true
        centerLabel.textAlignment = .center
        centerLabel.textColor = color("ink3", .secondaryLabel)
        centerLabel.accessibilityIdentifier = "native-write-progress"

        for f in [gridFrame, refFrame] {
            f.layer.borderWidth = 1.5
            f.layer.borderColor = color("frame", .separator).cgColor
            f.layer.cornerRadius = 4
            f.backgroundColor = .clear
        }
        refFrame.addSubview(refGlyph)
        refGlyph.color = color("ref", .label)
        refGlyph.isAccessibilityElement = true
        refFrame.isHidden = true

        configureTextButton(undoButton, title: tr("R-W18.btnUndo"), icon: "arrow.uturn.backward", action: #selector(tapUndo), id: "native-write-undo")
        configureTextButton(clearButton, title: tr("R-W18.btnClear"), icon: "xmark.circle", action: #selector(tapClear), id: "native-write-clear")
        configurePrimary(doneButton, title: tr("R-W29.btnDone"), action: #selector(tapDone), id: "native-write-done")
        configureOutline(wrongButton, title: tr("R-W09.btnWrong"), action: #selector(tapWrong), id: "native-write-wrong")
        configureOutline(correctButton, title: tr("R-W09.btnCorrect"), action: #selector(tapCorrect), id: "native-write-correct")
        configureTextButton(failCancel, title: tr("R-W16.cancel"), icon: nil, action: #selector(tapFailCancel), id: "native-write-fail-cancel")
        failNote.text = tr("R-W16.saveFailed")
        failNote.font = UIFont.preferredFont(forTextStyle: .subheadline)
        failNote.adjustsFontForContentSizeCategory = true
        failNote.textColor = color("ink2", .secondaryLabel)
        failNote.textAlignment = .center
        failNote.numberOfLines = 0

        [backButton, centerLabel, promptRow, gridFrame, ink, refFrame, undoButton, clearButton, doneButton, wrongButton, correctButton, failNote, failCancel]
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

    func saveMetrics() {
        NativeWriteMetrics.shared.inkSummary = ink?.latency.summary ?? [:]
        NativeWriteMetrics.shared.save()
    }

    /// 读屏两指 Z 形 = 左上「‹」（回忆阶段离开，判断阶段接着写；R5-I2）。
    override func accessibilityPerformEscape() -> Bool {
        tapBack()
        return true
    }

    @objc private func contentSizeChanged() { view.setNeedsLayout() }

    // MARK: 快照

    var cardKey: String? { snapshot["cardKey"] as? String }
    private var char: String { snapshot["char"] as? String ?? "" }

    /// 用快照刷新页面。keepLocal：同一个字时保留本地笔画（页面重载后的重新同步）。
    func apply(snapshot next: [String: Any], keepLocal: Bool) {
        let sameCard = (next["cardKey"] as? String) == cardKey
        snapshot = next
        if !(keepLocal && sameCard) {
            strokes = NativeInkSpike.rawStrokes(next["strokes"])
            cleared = nil
            phase = (next["phase"] as? String) == "compare" && !strokes.isEmpty ? .compare : .recall
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
        if let s = payload["snapshot"] as? [String: Any] { apply(snapshot: s, keepLocal: true) }
    }

    private func rebuildPrompt() {
        promptCells.forEach { $0.removeFromSuperview() }
        promptCells = []
        let prompt = snapshot["prompt"] as? [String: Any] ?? [:]
        let cells = prompt["cells"] as? [[String: Any]] ?? []
        promptRow.accessibilityLabel = tr("X-PROMPT.groupLabel")
        for c in cells {
            let kind = c["kind"] as? String ?? "text"
            let text = c["text"] as? String ?? ""
            let cell = UIView()
            switch kind {
            case "blank":
                cell.layer.borderWidth = 1.5
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
                cell.layer.borderWidth = 1.5
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

    // MARK: 状态 → 控件

    private func refresh() {
        let n = (snapshot["cursor"] as? Int ?? 0) + 1
        let total = snapshot["total"] as? Int ?? 0
        if phase == .recall {
            centerLabel.text = tr("R-W01.progress", ["n": n, "total": total])
            centerLabel.accessibilityLabel = tr("R-W01.progressLabel", ["n": n, "total": total])
            backButton.accessibilityLabel = tr("X-COMMON.back")
        } else {
            centerLabel.text = tr("R-W03.titleCompare")
            centerLabel.accessibilityLabel = nil
            backButton.accessibilityLabel = tr("R-W09.continueWriting")
        }
        let recall = phase == .recall
        ink?.drawable = recall && !submitting
        ink?.accessibilityLabel = recall
            ? (strokes.isEmpty ? tr("X-WRITE.gridLabel") : tr("X-WRITE.gridLabelCount", ["n": strokes.count]))
            : tr("R-W09.mineCardLabel", ["n": strokes.count])
        refFrame.isHidden = recall
        undoButton.isHidden = !recall
        clearButton.isHidden = !recall
        undoButton.isEnabled = !strokes.isEmpty || cleared != nil
        clearButton.isEnabled = !strokes.isEmpty
        doneButton.isHidden = !recall
        doneButton.isEnabled = !strokes.isEmpty
        doneButton.alpha = strokes.isEmpty ? 0.4 : 1
        wrongButton.isHidden = recall || failed
        correctButton.isHidden = recall
        correctButton.setTitle(failed ? tr("R-W16.retry") : tr("R-W09.btnCorrect"), for: .normal)
        failNote.isHidden = !failed
        failCancel.isHidden = !failed
        wrongButton.isEnabled = !submitting
        correctButton.isEnabled = !submitting
    }

    // MARK: 版式（B2.0 最小版；完整版式与 AX 档见 B2.1 / B2.9）

    private var firstLayoutDone = false

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        defer {
            if !firstLayoutDone, let t = openTiming {
                firstLayoutDone = true
                NativeWriteMetrics.shared.firstLayout(ms: (CACurrentMediaTime() - t.receivedAt) * 1000)
            }
        }
        let safe = view.safeAreaInsets
        let w = view.bounds.width, h = view.bounds.height
        let gutter: CGFloat = 20
        backButton.frame = CGRect(x: 8, y: safe.top, width: 44, height: 44)
        centerLabel.frame = CGRect(x: 60, y: safe.top, width: w - 120, height: 44)

        let footBottom = h - max(24, safe.bottom)
        let btnH: CGFloat = max(50, UIFont.preferredFont(forTextStyle: .headline).lineHeight + 26)
        doneButton.frame = CGRect(x: gutter, y: footBottom - btnH, width: w - 2 * gutter, height: btnH)
        let half = (w - 2 * gutter - 12) / 2
        wrongButton.frame = CGRect(x: gutter, y: footBottom - btnH, width: half, height: btnH)
        correctButton.frame = CGRect(x: gutter + half + 12, y: footBottom - btnH, width: half, height: btnH)
        if failed {
            failCancel.frame = wrongButton.frame
        }
        failNote.frame = CGRect(x: gutter, y: footBottom - btnH - 44, width: w - 2 * gutter, height: 40)

        // 题面：一行 52pt 的格（拼音在要写的格上方）
        let cell: CGFloat = 52
        let pyH = UIFont.preferredFont(forTextStyle: .subheadline).lineHeight + 4
        let count = CGFloat(max(1, promptCells.count))
        let rowW = min(w - 2 * gutter, cell * count)
        let cw = rowW / count
        let promptTop = safe.top + 44 + 12 + pyH
        promptRow.frame = CGRect(x: (w - rowW) / 2, y: promptTop, width: rowW, height: cw)
        for (i, c) in promptCells.enumerated() {
            c.frame = CGRect(x: CGFloat(i) * cw, y: 0, width: cw, height: cw)
            for sub in c.subviews {
                switch sub.tag {
                case 1: sub.frame = CGRect(x: -20, y: -pyH, width: cw + 40, height: pyH)
                case 2: sub.frame = c.bounds
                default: sub.frame = c.bounds.insetBy(dx: cw * 0.1, dy: cw * 0.1)
                }
            }
        }

        // 书写格：边长 clamp(258, min(屏宽 − 40, 400, 可用高), 400)（D36 / P118 的同一公式，与字号无关）
        let gridTop = promptRow.frame.maxY + 16
        let toolsH: CGFloat = 44
        let avail = footBottom - btnH - 16 - toolsH - 40 - gridTop
        let g = max(min(258, w - 2 * gutter), min(w - 2 * gutter, 400, avail))
        let gridRect = CGRect(x: (w - g) / 2, y: gridTop, width: g, height: g)
        undoButton.frame = CGRect(x: gridRect.minX, y: gridRect.maxY + 4, width: 100, height: toolsH)
        clearButton.frame = CGRect(x: gridRect.maxX - 100, y: gridRect.maxY + 4, width: 100, height: toolsH)
        undoButton.contentHorizontalAlignment = .leading
        clearButton.contentHorizontalAlignment = .trailing

        if phase == .recall {
            gridFrame.frame = gridRect
        } else {
            // 判断：上下两格（同一顶边、同一中线，共用一条格线；D46 ⑪），边长受按钮行限制
            let room = (wrongButton.frame.minY - 12 - (failed ? 44 : 0)) - gridTop
            let s = min(g, max(120, room / 2))
            gridFrame.frame = CGRect(x: (w - s) / 2, y: gridTop, width: s, height: s)
            refFrame.frame = CGRect(x: (w - s) / 2, y: gridTop + s - 1.5, width: s, height: s)
            refGlyph.frame = refFrame.bounds
        }
        ink?.frame = gridFrame.frame.insetBy(dx: 1.5, dy: 1.5)
    }

    // MARK: 控件样式

    private func configureTextButton(_ b: UIButton, title: String, icon: String?, action: Selector, id: String) {
        b.setTitle(title, for: .normal)
        if let icon { b.setImage(UIImage(systemName: icon), for: .normal) }
        b.titleLabel?.font = UIFont.preferredFont(forTextStyle: .body)
        b.titleLabel?.adjustsFontForContentSizeCategory = true
        b.tintColor = color("ink2", .secondaryLabel)
        b.setTitleColor(color("ink2", .secondaryLabel), for: .normal)
        b.setTitleColor(color("ink4", .tertiaryLabel), for: .disabled)
        b.addTarget(self, action: action, for: .touchUpInside)
        b.accessibilityIdentifier = id
    }

    private func configurePrimary(_ b: UIButton, title: String, action: Selector, id: String) {
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = UIFont.preferredFont(forTextStyle: .headline)
        b.titleLabel?.adjustsFontForContentSizeCategory = true
        b.backgroundColor = color("ink1", .label)
        b.setTitleColor(color("paper", .systemBackground), for: .normal)
        b.layer.cornerRadius = 12
        b.addTarget(self, action: action, for: .touchUpInside)
        b.accessibilityIdentifier = id
    }

    private func configureOutline(_ b: UIButton, title: String, action: Selector, id: String) {
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = UIFont.preferredFont(forTextStyle: .headline)
        b.titleLabel?.adjustsFontForContentSizeCategory = true
        b.setTitleColor(color("ink1", .label), for: .normal)
        b.layer.cornerRadius = 12
        b.layer.borderWidth = 1
        b.layer.borderColor = color("ink4", .separator).cgColor
        b.addTarget(self, action: action, for: .touchUpInside)
        b.accessibilityIdentifier = id
    }

    // MARK: 动作

    private var currentPhaseName: String { phase == .compare ? "compare" : "recall" }

    private func wire(_ s: [[InkRawPoint]]) -> [[[Double]]] {
        s.map { stroke in stroke.map { q in q.p.map { [q.x, q.y, q.t, $0] } ?? [q.x, q.y, q.t] } }
    }

    private func persistStrokes() {
        guard let key = cardKey else { return }
        bridge.send("strokes", ["slot": slot, "cardKey": key, "strokes": wire(strokes), "phase": currentPhaseName])
    }

    @objc private func tapBack() {
        if phase == .compare { continueWriting(); return }
        coordinator?.nativeWriteDidRequestBack(self)
    }

    @objc private func tapUndo() {
        if !strokes.isEmpty { strokes.removeLast() } else if let c = cleared { strokes = c; cleared = nil } else { return }
        ink.syncPageStrokes(strokes)
        refresh()
        persistStrokes()
    }

    @objc private func tapClear() {
        guard !strokes.isEmpty else { return }
        cleared = strokes
        strokes = []
        ink.syncPageStrokes(strokes)
        refresh()
        persistStrokes()
    }

    @objc private func tapDone() {
        guard phase == .recall, !strokes.isEmpty, let key = cardKey else { return }
        lightHaptic.impactOccurred(intensity: 0.5)
        bridge.send("phase", ["slot": slot, "cardKey": key, "phase": "compare", "strokes": wire(strokes)])
        setPhase(.compare)
    }

    private func continueWriting() {
        guard phase == .compare, !submitting, let key = cardKey else { return }
        failed = false
        bridge.send("phase", ["slot": slot, "cardKey": key, "phase": "recall"])
        setPhase(.recall)
    }

    private func setPhase(_ p: Phase) {
        phase = p
        if p == .compare {
            // 参考格先就位（不从零尺寸长出来），随两格版式一起出现
            UIView.performWithoutAnimation {
                view.setNeedsLayout()
                view.layoutIfNeeded()
                refFrame.alpha = 0
            }
            phase = .recall
            view.setNeedsLayout()
            view.layoutIfNeeded() // 书写格回到动画起点
            phase = p
            UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0.15 : 0.3) { self.refFrame.alpha = 1 }
        }
        refresh()
        let reduce = UIAccessibility.isReduceMotionEnabled
        UIView.animate(withDuration: reduce ? 0.15 : 0.3, delay: 0, options: [.curveEaseInOut]) {
            self.view.setNeedsLayout()
            self.view.layoutIfNeeded()
        }
        UIAccessibility.post(notification: .screenChanged, argument: centerLabel)
    }

    @objc private func tapWrong() { judge("wrong") }
    @objc private func tapCorrect() { judge(failed ? lastJudgment : "correct") }
    @objc private func tapFailCancel() {
        // 「先不保存」：回到判断前（两键），笔迹仍在（R-W16）
        failed = false
        refresh()
        view.setNeedsLayout()
    }

    private var lastJudgment = "correct"

    private func judge(_ judgment: String) {
        guard phase == .compare, !submitting, let key = cardKey, !strokes.isEmpty else { return }
        submitting = true
        lastJudgment = judgment
        refresh()
        judgeHaptic.prepare()
        let hints = snapshot["hints"] as? Int ?? 0
        bridge.call("judge", ["slot": slot, "cardKey": key, "judgment": judgment, "strokes": wire(strokes), "hints": hints]) { [weak self] reply in
            guard let self else { return }
            self.submitting = false
            // 结果未知后重发（或连点）：页面回 stale 且快照已经不是这个字 → 上一次其实已提交，按成功对账（不多记，D07）
            let advanced = !reply.ok && reply.errorKind == "stale" && reply.snapshot.map { ($0["cardKey"] as? String) != key } == true
            guard reply.ok || advanced else {
                // D07：没保存上——留在判断页，笔迹还在；两键换成「先不保存 / 再试一次」
                self.failed = true
                self.refresh()
                self.view.setNeedsLayout()
                UIAccessibility.post(notification: .announcement, argument: self.failNote.text)
                return
            }
            self.judgeHaptic.impactOccurred(intensity: 0.7)
            self.failed = false
            let finished = reply.body["finished"] as? [String: Any]
            if let finished, let sid = finished["sessionId"] as? String {
                self.coordinator?.nativeWriteDidFinish(self, sessionId: sid)
                return
            }
            if advanced, let snap = reply.snapshot, (snap["active"] as? Bool) != true || (snap["done"] as? Bool) == true {
                // 已提交的是最后一个字：这组已结束，交给结果页
                self.coordinator?.nativeWriteDidFinish(self, sessionId: self.snapshot["sessionId"] as? String ?? "")
                return
            }
            if let next = reply.snapshot {
                let reduce = UIAccessibility.isReduceMotionEnabled
                UIView.transition(with: self.view, duration: reduce ? 0.15 : 0.15, options: [.transitionCrossDissolve, .allowUserInteraction]) {
                    self.apply(snapshot: next, keepLocal: false)
                    self.view.layoutIfNeeded()
                }
                UIAccessibility.post(notification: .screenChanged, argument: self.centerLabel)
                self.scheduleAutoStep()
            }
        }
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
            if g.state == .ended, BackGestureThreshold.commits(distance: x, velocity: v, width: width) { continueWriting() }
            return
        }
        switch g.state {
        case .began:
            guard !submitting else { return }
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
    func nativeInkDidBeginStroke(_ view: NativeInkView, at timestamp: TimeInterval) {}

    func nativeInkDidEndStroke(_ view: NativeInkView, raw: [InkRawPoint]) {
        guard phase == .recall else { return }
        strokes.append(raw)
        cleared = nil
        view.syncPageStrokes(strokes)
        refresh()
        persistStrokes()
    }

    func nativeInkDidCancelStroke(_ view: NativeInkView, reason: String) {}

    func nativeInkRequestsExport(_ view: NativeInkView) {
        NativeWriteMetrics.shared.inkSummary = view.latency.summary
        NativeWriteMetrics.shared.save()
    }
}
#endif
