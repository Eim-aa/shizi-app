import UIKit
import UniformTypeIdentifiers

// B3.10 原生备份页（网页；视图模型 backupView / restoreConfirmView / clearSheetView，App API view.backup）。
// 屏名 ⇄ 类：backup ⇄ ShiziScreen_backup。
// 版式照网页 .sz-bk__* 逐项排（状态块 / 正文首句 / 说明框 / 两行列表 / 底栏主按钮 / 撤销条 / 居中确认框），
// 数值取 ShiziTokens，文案取视图模型给的引用（ShiziCopyRef）。系统能力原生直接做：
// UIActivityViewController 分享备份文件、UIDocumentPickerViewController 选文件。
// 写 store 走会话层同一批函数（App API：backup.export / exportDone / picked / restore / clear / undoRestore / undoClear）。
//
// ShiziKit 的 NativeEndDialogView（ShiziConfirm.swift）没有标题槽，网页版有标题（宋体 22 / 30）；
// ShiziKit 的 NativeUndoBarView（ShiziUndoBar.swift）只有一行，网页版是两行。
// 所以确认框与撤销条在本文件里自己画（照网页版的规格），转场用 ShiziKit 的 NativeOverlaySpec。

/// 网页量出的折行点（App API 回包里的 lines）：原生按这些位置断行，与网页同一个折行。
/// 网页的段落是 text-wrap: pretty，WebKit 的折法不是贪心折行（末行太短时它会把字往上一行挪），
/// 原生排版是贪心折行，所以断行点得由网页量出来给原生。
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

/// 居中确认框：标题（宋 22 / 30）+ 正文（15 / 22）+ 两键（1fr 1fr，gap 12）。
/// 规格：左右页边 20、垂直居中、24 圆角、elev 底、内边距 24 / 20 / 20、标题与正文之间 12、正文与两键之间 12、两键上方 4、键高 btn-h。
final class BackupConfirmView: UIView {
    struct Strings {
        var title = ""
        var body = ""
        var cancel = ""
        var ok = ""
        var bodyColorIsStrong = false
        var loss = ""
        var exportFirst = ""
    }

    /// 确认框用到的颜色（网页 .sz-confirm 的规格：面板 elev 底、取消键描边墨四、确认键主按钮底 / 字）。
    struct Palette {
        var ink1 = UIColor.label
        var ink2 = UIColor.secondaryLabel
        var ink4 = UIColor.tertiaryLabel
        var elev = UIColor.systemBackground
        var btnBg = UIColor.label
        var btnFg = UIColor.systemBackground
    }

    var onCancel: (() -> Void)?
    var onOK: (() -> Void)?
    var onExportFirst: (() -> Void)?

    private let scrim = UIView()
    /// 面板（网页 .sz-confirm 本体：取证按语义键比的就是它）。
    let panel = UIView()
    let titleLabel = UILabel()
    let bodyLabel = UILabel()
    let lossLabel = UILabel()
    let exportFirstButton = NativeTextButton(type: .custom)
    let cancelButton = UIButton(type: .custom)
    let okButton = UIButton(type: .custom)
    private var strings = Strings()
    private var metrics = ShiziMetrics()

    override init(frame: CGRect) {
        super.init(frame: frame)
        scrim.backgroundColor = UIColor.black.withAlphaComponent(0.32)
        scrim.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapScrim)))
        addSubview(scrim)
        panel.layer.cornerRadius = 24
        panel.layer.cornerCurve = .continuous
        addSubview(panel)
        titleLabel.numberOfLines = 0
        bodyLabel.numberOfLines = 0
        lossLabel.numberOfLines = 0
        for l in [titleLabel, bodyLabel, lossLabel] { panel.addSubview(l) }
        for b in [cancelButton, okButton] {
            b.titleLabel?.numberOfLines = 2
            b.titleLabel?.textAlignment = .center
            b.layer.cornerRadius = 12
            b.layer.cornerCurve = .continuous
            panel.addSubview(b)
        }
        cancelButton.addAction(UIAction { [weak self] _ in self?.onCancel?() }, for: .touchUpInside)
        okButton.addAction(UIAction { [weak self] _ in self?.onOK?() }, for: .touchUpInside)
        exportFirstButton.addAction(UIAction { [weak self] _ in self?.onExportFirst?() }, for: .touchUpInside)
        panel.addSubview(exportFirstButton)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func tapScrim() { onCancel?() }

    func configure(_ s: Strings, metrics: ShiziMetrics, colors: Palette) {
        strings = s
        self.metrics = metrics
        let ink1 = colors.ink1, ink2 = colors.ink2, ink4 = colors.ink4
        panel.backgroundColor = colors.elev
        // 标题（宋体 22 / 30，500；网页用宋体，全角标点也走宋体——不走 NativeType.set 的苹方替换）
        let titleFont = NativeType.song(size: metrics.value("fs22"), weight: .medium)
        let titleLine = metrics.line("lh22")
        let tp = NSMutableParagraphStyle()
        tp.alignment = .natural
        tp.minimumLineHeight = titleLine
        tp.maximumLineHeight = titleLine
        let tattrs: [NSAttributedString.Key: Any] = [.font: titleFont, .foregroundColor: ink1, .paragraphStyle: tp, .kern: 0,
                                                   .baselineOffset: (titleLine - titleFont.lineHeight) / 4]
        titleLabel.attributedText = NSAttributedString(string: s.title, attributes: tattrs)
        titleLabel.accessibilityLabel = s.title
        // 正文（15 / 22；替换 / 清空的确认框用墨一，其余用墨二）
        NativeType.set(bodyLabel, s.body, font: metrics.font(15), color: s.bodyColorIsStrong ? ink1 : ink2, line: metrics.line("lh15"))
        bodyLabel.accessibilityLabel = s.body
        // 丢失日期范围（网页 .sz-bk__loss：15 / 22 墨一）
        lossLabel.isHidden = s.loss.isEmpty
        NativeType.set(lossLabel, s.loss, font: metrics.font(15), color: ink1, line: metrics.line("lh15"))
        lossLabel.accessibilityLabel = s.loss
        // 两键（取消 = 次按钮：透明底 + 墨四描边；确认 = 主按钮：btn-bg 底 / btn-fg 字）
        cancelButton.setTitle(s.cancel, for: .normal)
        cancelButton.setTitleColor(ink1, for: .normal)
        cancelButton.setTitleColor(ink1, for: .disabled)
        cancelButton.titleLabel?.font = metrics.font(17, .medium)
        cancelButton.backgroundColor = .clear
        cancelButton.layer.borderWidth = 1
        cancelButton.layer.borderColor = ink4.cgColor
        cancelButton.accessibilityLabel = s.cancel
        okButton.setTitle(s.ok, for: .normal)
        okButton.setTitleColor(colors.btnFg, for: .normal)
        okButton.setTitleColor(colors.btnFg, for: .disabled)
        okButton.titleLabel?.font = metrics.font(17, .medium)
        okButton.backgroundColor = colors.btnBg
        okButton.accessibilityLabel = s.ok
        exportFirstButton.isHidden = s.exportFirst.isEmpty
        exportFirstButton.setTitle(s.exportFirst, for: .normal)
        exportFirstButton.setTitleColor(ink1, for: .normal)
        exportFirstButton.titleLabel?.font = metrics.font(15)
        exportFirstButton.accessibilityLabel = s.exportFirst
        setNeedsLayout()
    }

    /// 面板的尺寸（网页 .sz-confirm：宽 = 页宽 − 2 × 20；高按内容）。
    func panelSize(width: CGFloat) -> CGSize {
        let mt = metrics
        let inner = width - 40 - 40
        let titleH = mt.line("lh22")
        let bodyH = NativeType.height(bodyLabel, width: inner, line: mt.line("lh15"))
        let lossH = lossLabel.isHidden ? 0 : NativeType.height(lossLabel, width: inner, line: mt.line("lh15"))
        let exportH = exportFirstButton.isHidden ? 0 : 44
        var h: CGFloat = 24 + titleH
        h += 12 + bodyH
        if lossH > 0 { h += 12 + lossH }
        if exportH > 0 { h += 12 + CGFloat(exportH) }
        h += 12 + 4 + mt.value("btn-h") + 20
        return CGSize(width: width - 40, height: h)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let mt = metrics
        scrim.frame = bounds
        let gutter: CGFloat = 20
        let w = bounds.width - 2 * gutter
        let inner = w - 40
        let size = panelSize(width: bounds.width)
        panel.frame = CGRect(x: gutter, y: (bounds.height - size.height) / 2, width: w, height: size.height)
        ShiziElev.apply(panel, dark: traitCollection.userInterfaceStyle == .dark) // --elev-shadow：影子 + 上沿发丝线（同 ShiziConfirm）
        let titleH = mt.line("lh22")
        titleLabel.frame = CGRect(x: 20, y: 24, width: inner, height: titleH)
        var y = 24 + titleH + 12
        let bodyH = NativeType.height(bodyLabel, width: inner, line: mt.line("lh15"))
        bodyLabel.frame = CGRect(x: 20, y: y, width: inner, height: bodyH)
        y += bodyH
        if !lossLabel.isHidden {
            y += 12
            let lossH = NativeType.height(lossLabel, width: inner, line: mt.line("lh15"))
            lossLabel.frame = CGRect(x: 20, y: y, width: inner, height: lossH)
            y += lossH
        }
        if !exportFirstButton.isHidden {
            y += 12
            exportFirstButton.frame = CGRect(x: 16, y: y, width: inner, height: 44)
            y += 44
        }
        y += 12 + 4
        let half = (inner - mt.space(3)) / 2
        let btnH = mt.value("btn-h")
        cancelButton.frame = CGRect(x: 20, y: y, width: half, height: btnH)
        okButton.frame = CGRect(x: 20 + half + mt.space(3), y: y, width: half, height: btnH)
    }

    /// 进场 / 退场（网页 T-confirm：进场由 0.96 放大淡入，退场淡出）。
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
}

/// 撤销条：两行说明 + 「撤销」文字按钮；浮条（elev 底 + 1pt 线 + 轻阴影、24 圆角）。
final class BackupUndoBarView: UIView {
    var onUndo: (() -> Void)?

    private let line1 = UILabel()
    private let line2 = UILabel()
    private let undoButton = UIButton(type: .custom)
    private var metrics = ShiziMetrics()

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.cornerRadius = 24
        layer.cornerCurve = .continuous
        for l in [line1, line2] {
            l.numberOfLines = 1
            addSubview(l)
        }
        undoButton.titleLabel?.font = .systemFont(ofSize: 15, weight: .medium)
        undoButton.accessibilityIdentifier = "native-backup-undo-button"
        undoButton.addAction(UIAction { [weak self] _ in self?.onUndo?() }, for: .touchUpInside)
        addSubview(undoButton)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(l1: String, l2: String, undo: String, metrics: ShiziMetrics, colors: (UIColor, UIColor, UIColor)) {
        self.metrics = metrics
        let (fg, act, line) = colors
        NativeType.set(line1, l1, font: metrics.font(15), color: fg, line: metrics.line("lh15"))
        line1.accessibilityLabel = l1
        NativeType.set(line2, l2, font: metrics.font(15), color: fg, line: metrics.line("lh15"))
        line2.accessibilityLabel = l2
        undoButton.setTitle(undo, for: .normal)
        undoButton.setTitleColor(act, for: .normal)
        undoButton.titleLabel?.font = metrics.font(15, .medium)
        undoButton.accessibilityLabel = undo
        backgroundColor = ShiziTokens.dynamicColor("toast-bg")
        layer.borderWidth = 1
        layer.borderColor = line.cgColor
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let mt = metrics
        let edge: CGFloat = 1
        let left = 16 + edge
        let h = mt.line("lh15")
        // 「撤销」是文字按钮（网页 .sz-btn--text：左右内边距 4、字距条 12）
        let bw = ceil(NativeType.width(undoButton.titleLabel ?? UILabel())) + 8
        let textW = max(0, bounds.width - edge - left - 8 - bw - 12)
        line1.frame = CGRect(x: left, y: edge + 8, width: textW, height: h)
        line2.frame = CGRect(x: left, y: edge + 8 + h, width: textW, height: h)
        undoButton.frame = CGRect(x: bounds.width - 8 - edge - bw, y: (bounds.height - 44) / 2, width: bw, height: 44)
    }
}

@objc(ShiziScreen_backup)
final class BackupScreen: ShiziScreenViewController {
    struct View: Decodable {
        struct Restore: Decodable { let label: ShiziCopyRef; let sub: ShiziCopyRef }
        struct Clear: Decodable { let label: ShiziCopyRef }
        struct ExportBtn: Decodable { let label: ShiziCopyRef }
        struct UndoLine: Decodable { let l1: ShiziCopyRef; let l2: ShiziCopyRef }
        struct Undo: Decodable {
            let restore: UndoLine
            let clear: UndoLine
            let failedRestore: UndoLine
            let failedClear: UndoLine
        }
        struct NoteBox: Decodable {
            let kind: String
            let text: ShiziCopyRef
            let retry: ShiziCopyRef?
            let stay: ShiziCopyRef?
        }
        struct NoteBoxes: Decodable {
            let protectFailed: NoteBox
            let notBackup: NoteBox
            let restoreFailed: NoteBox
        }
        struct ExportFail: Decodable { let text: ShiziCopyRef; let stay: ShiziCopyRef; let retry: ShiziCopyRef }
        struct ClearSheet: Decodable {
            struct Failed: Decodable { let body: ShiziCopyRef; let cancel: ShiziCopyRef; let retry: ShiziCopyRef }
            let title: ShiziCopyRef
            let body: ShiziCopyRef
            let cancel: ShiziCopyRef
            let ok: ShiziCopyRef
            let failed: Failed
        }
        let title: ShiziCopyRef
        let lastLabel: ShiziCopyRef
        let lastDate: ShiziCopyRef
        let lastDay: String?
        let statusLines: [ShiziCopyRef]
        let noteKeys: [String]
        let intro: ShiziCopyRef
        let hasRecords: Bool
        let count: Int
        let restore: Restore
        let clear: Clear
        let export: ExportBtn
        let undo: Undo
        let noteBox: NoteBoxes
        let exportFail: ExportFail
        let clearSheet: ClearSheet
    }

    /// 替换 / 恢复确认框的模型（App API backup.picked 的 preview）。
    struct Preview: Decodable {
        struct Loss: Decodable { let from: String; let to: String; let days: Int }
        let mode: String
        let day: String?
        let n: Int
        let m: Int
        let loss: Loss?
        let title: ShiziCopyRef
        let body: ShiziCopyRef
        let cancel: ShiziCopyRef
        let ok: ShiziCopyRef
        let lossText: ShiziCopyRef?
        let exportFirst: ShiziCopyRef?
    }

    /// 撤销条的状态（网页 undo = {kind, failed, done}）。
    private enum UndoKind: String { case restore, clear }
    private enum NoteKind: String { case protectFailed, notBackup, restoreFailed }

    // 视图（accessibilityIdentifier 与网页 data-testid 一一对应；成员名 = QA 取证的语义键）
    private let bodyView = UIView()
    private let statusView = UIView()
    private let lastLabel = UILabel()
    private let lastDate = UILabel()
    private let statusNote = UILabel()
    private let introLabel = UILabel()
    private let noteView = UIView()
    private let noteDot = UIView()
    private let noteText = UILabel()
    private let listView = UIView()
    /// 列表的发丝线（网页 .sz-bk__list 上边线、.sz-bk__row 下边线、危险行 .sz-bk__row--danger 上边线）：列表顶、恢复行底、清空行顶、清空行底。
    private let listLines = (0..<4).map { _ in UIView() }
    private let restoreRow = ShiziRowButton(type: .custom)
    private let clearRow = ShiziRowButton(type: .custom)
    private let exportButton = UIButton(type: .custom)
    private let exportFailNote = UILabel()
    private let exportFailCancel = NativeTextButton(type: .custom)
    private let exportFailRetry = UIButton(type: .custom)
    private let undoWrap = UIView()
    private let undoBar = BackupUndoBarView()
    private var confirmView: BackupConfirmView?

    private var model: View?
    /// 网页量出的折行点（App API view.backup 回包里的 lines）：正文首句与清空确认框的正文。
    private var lines: [String: Any] = [:]
    /// 网页量出的折行点（App API backup.picked 回包里的 lines）：替换确认框的正文。
    private var pickedLines: [String: Any] = [:]
    private var undoKind: UndoKind?
    private var undoFailed = false
    private var undoDone = false
    private var noteKind: NoteKind?
    private var noteRetry: (() -> Void)?
    private var exportFail = false
    private var clearSheetOpen = false
    private var clearSheetFailed = false
    private var preview: Preview?
    private var pickedText: String?
    private var exportSig: String?
    private var shareURL: URL?

    override var watchedDomains: [String]? { ["records", "ink", "backupMeta", "settings", "safety"] }

    override func viewDidLoad() {
        super.viewDidLoad()
        bodyView.accessibilityIdentifier = "native-backup-body"
        statusView.accessibilityIdentifier = "native-backup-status"
        lastLabel.accessibilityIdentifier = "native-backup-last-label"
        lastDate.accessibilityIdentifier = "native-backup-last-date"
        statusNote.accessibilityIdentifier = "native-backup-status-note"
        introLabel.accessibilityIdentifier = "native-backup-intro"
        noteView.accessibilityIdentifier = "native-backup-note"
        noteText.accessibilityIdentifier = "native-backup-note-text"
        listView.accessibilityIdentifier = "native-backup-list"
        restoreRow.accessibilityIdentifier = "native-backup-restore"
        clearRow.accessibilityIdentifier = "native-backup-clear"
        exportButton.accessibilityIdentifier = "native-backup-export"
        exportFailNote.accessibilityIdentifier = "native-backup-export-fail-note"
        exportFailCancel.accessibilityIdentifier = "native-backup-export-fail-cancel"
        exportFailRetry.accessibilityIdentifier = "native-backup-export-fail-retry"
        undoBar.accessibilityIdentifier = "native-backup-undo-bar"
        undoWrap.accessibilityIdentifier = "native-backup-undo"
        content.addSubview(bodyView)
        // 层级照网页 .sz-bk（正文块里依次是状态块 / 首句 / 说明框 / 列表；列表里是两行）
        bodyView.addSubview(statusView)
        bodyView.addSubview(introLabel)
        bodyView.addSubview(noteView)
        bodyView.addSubview(listView)
        statusView.addSubview(lastLabel)
        statusView.addSubview(lastDate)
        statusView.addSubview(statusNote)
        noteView.addSubview(noteDot)
        noteView.addSubview(noteText)
        listView.addSubview(restoreRow)
        listView.addSubview(clearRow)
        listLines.forEach { $0.isUserInteractionEnabled = false; listView.addSubview($0) }
        for v in [exportButton, exportFailNote, exportFailCancel, exportFailRetry, undoWrap] as [UIView] { view.addSubview(v) }
        undoWrap.addSubview(undoBar)
        wire(restoreRow) { page in (page as? BackupScreen)?.pickBackup() }
        wire(clearRow) { page in (page as? BackupScreen)?.openClearSheet() }
        wire(exportButton) { page in (page as? BackupScreen)?.doExport() }
        wire(exportFailCancel) { page in (page as? BackupScreen)?.setExportFail(false) }
        wire(exportFailRetry) { page in (page as? BackupScreen)?.doExport() }
        undoBar.onUndo = { [weak self] in self?.doUndo() }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        layoutFooter()
        // 网页 .sz-page__foot 是正文的兄弟节点：正文滚动区到按钮上沿为止（AX 档正文长时不会从按钮底下滚过去）。
        scroll.frame.size.height = max(0, footerTop - scroll.frame.minY)
    }

    /// 底栏占的上沿（网页 .sz-page__foot 的上边 = 底栏内容上沿 − 上内边距 12；正文滚动区到这里为止）。
    private var footerTop: CGFloat {
        let bottom = view.bounds.height - view.safeAreaInsets.bottom
        let contentTop: CGFloat
        if undoKind != nil { contentTop = undoWrap.frame.minY }
        else if exportFail { contentTop = exportFailNote.frame.minY }
        else { contentTop = exportButton.frame.minY }
        return contentTop - metrics.space(3)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // 冷启动恢复（P32）：保护副本还在 → 撤销条仍在（网页的 mountedByRestore 分支）。
        if undoKind == nil { loadUndoState() }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        // 离开这一页 → 撤销失效、删副本（D24 / 01 §9；网页的 route.subscribe 分支）。
        if isBeingDismissed { stage?.engine.raw("backup.dropSafety", [:]) { _ in } }
    }

    /// 保护副本在不在（原生页的撤销条自己持有；冷启动恢复时问会话层）。
    private func loadUndoState() {
        guard let engine = stage?.engine else { return }
        engine.raw("backup.undoState", [:]) { [weak self] body in
            guard let self, (body["ok"] as? Bool) == true else { return }
            let kind = body["kind"] as? String
            guard let kind, let k = UndoKind(rawValue: kind) else { return }
            DispatchQueue.main.async {
                guard self.undoKind == nil else { return }
                self.undoKind = k
                self.undoFailed = false
                self.undoDone = false
                self.markStateChange()
                self.view.setNeedsLayout()
            }
        }
    }

    // MARK: 视图

    /// App API 的回包（{ok, view, lines}）：lines = 网页量出的折行点（原生照它断行）。
    override func apply(payload: [String: Any]) {
        lines = payload["lines"] as? [String: Any] ?? [:]
        super.apply(payload: payload)
    }

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: View.self)
        model = m
        setTitle(m.title.text)
        let mt = metrics
        // 状态块：标签 13 墨三 / 日期（宋 28 / 500 墨一）/ 状态句 13 墨三
        NativeType.set(lastLabel, m.lastLabel.text, font: mt.font(13), color: color("ink3"), line: mt.line("lh15"))
        lastLabel.accessibilityLabel = m.lastLabel.text
        NativeType.set(lastDate, m.lastDate.text, font: NativeType.song(size: mt.value("fs28"), weight: .medium), color: color("ink1"), line: mt.line("lh15"))
        ShiziFonts.untrack(lastDate)
        lastDate.accessibilityLabel = m.lastDate.text
        let statusText = m.statusLines.map { $0.text }.joined()
        statusNote.accessibilityLabel = statusText
        statusNote.numberOfLines = 0
        NativeType.set(statusNote, statusText, font: mt.font(13), color: color("ink3"), line: mt.line("lh13"))
        // 正文首句（网页 .sz-bk__intro：text-wrap:pretty，折行点由网页量出来）
        introLabel.numberOfLines = 0
        introLabel.accessibilityLabel = m.intro.text
        // 列表两行：恢复备份（带副行 + chevron）/ 清空记录
        NativeType.set(restoreRow.label, m.restore.label.text, font: mt.font(17, .medium), color: color("ink1"), line: mt.line("lh17s"))
        restoreRow.label.numberOfLines = 0
        NativeType.set(restoreRow.valueLabel, m.restore.sub.text, font: mt.font(15), color: color("ink3"), line: mt.line("lh15"))
        restoreRow.valueLabel.numberOfLines = 0
        restoreRow.titleLabel?.font = mt.font(15)
        restoreRow.setTitleColor(color("ink1"), for: .normal)
        restoreRow.setTitleColor(color("ink1"), for: .disabled)
        restoreRow.chevronSize = CGSize(width: 8, height: 13)
        restoreRow.setImage(ShiziChevron.image(color("ink4"), size: restoreRow.chevronSize), for: .normal)
        restoreRow.accessibilityLabel = m.restore.label.text
        restoreRow.isAccessibilityElement = true
        NativeType.set(clearRow.label, m.clear.label.text, font: mt.font(17, .medium), color: color("ink1"), line: mt.line("lh17s"))
        clearRow.label.numberOfLines = 0
        clearRow.titleLabel?.font = mt.font(15)
        clearRow.setTitleColor(color("ink1"), for: .normal)
        clearRow.setTitleColor(color("ink1"), for: .disabled)
        clearRow.chevronSize = .zero
        clearRow.setImage(nil, for: .normal)
        clearRow.accessibilityLabel = m.clear.label.text
        clearRow.isAccessibilityElement = true
        // 底栏主按钮
        exportButton.setTitle(m.export.label.text, for: .normal)
        exportButton.titleLabel?.font = mt.font(17, .medium)
        exportButton.titleLabel?.textAlignment = .center
        exportButton.layer.cornerRadius = 12
        exportButton.layer.cornerCurve = .continuous
        NativeType.trackTitle(exportButton)
        exportButton.accessibilityLabel = m.export.label.text
        // 导出失败的三段式
        NativeType.set(exportFailNote, m.exportFail.text.text, font: mt.font(15), color: color("ink2"), line: mt.line("lh15"))
        exportFailCancel.setTitle(m.exportFail.stay.text, for: .normal)
        exportFailCancel.setTitleColor(color("ink2"), for: .normal)
        exportFailCancel.titleLabel?.font = mt.font(15)
        NativeType.trackTitle(exportFailCancel)
        exportFailRetry.setTitle(m.exportFail.retry.text, for: .normal)
        exportFailRetry.setTitleColor(color("btn-fg"), for: .normal)
        exportFailRetry.titleLabel?.font = mt.font(17, .medium)
        exportFailRetry.backgroundColor = color("btn-bg")
        exportFailRetry.layer.cornerRadius = 12
        exportFailRetry.layer.cornerCurve = .continuous
        NativeType.trackTitle(exportFailRetry)
        view.setNeedsLayout()
    }

    // MARK: 排版

    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat {
        let mt = metrics
        guard let m = model else { return top }
        var y: CGFloat = 0                          // bodyView 坐标（bodyView 在内容里的位置 = x / top）
        // 状态块（网页 .sz-bk__status：列，间距 8）
        let labelH = mt.line("lh15")     // 网页 .sz-bk__label 没设 line-height，继承正文的 22
        let dateH = mt.line("lh15")      // 同上（宋体 28 的字面比行盒高，溢出但盒子还是 22）
        let hasStatus = !m.statusLines.isEmpty
        let statusNoteH = hasStatus ? NativeType.height(statusNote, width: width, line: mt.line("lh13")) : 0
        var statusH = labelH + 8 + dateH
        if hasStatus { statusH += 8 + statusNoteH }
        statusView.frame = CGRect(x: 0, y: y, width: width, height: statusH)
        lastLabel.frame = CGRect(x: 0, y: 0, width: width, height: labelH)
        lastDate.frame = CGRect(x: 0, y: labelH + 8, width: width, height: dateH)
        statusNote.isHidden = !hasStatus
        if hasStatus { statusNote.frame = CGRect(x: 0, y: labelH + 8 + dateH + 8, width: width, height: statusNoteH) }
        y += statusH
        // 正文首句（撤销条在时网页不显示首句；折行点照网页量出来的那些）
        if undoKind == nil {
            introLabel.isHidden = false
            y += mt.groupGap
            let introText = ShiziWebLines.breakText(m.intro.text, lines["intro"])
            y += ShiziParagraph.place(introLabel, introText, font: mt.font(15), color: color("ink2"), line: mt.line("lh15"), x: 0, y: y, width: width)
            introLabel.accessibilityLabel = m.intro.text
        } else {
            introLabel.isHidden = true
        }
        // 说明框（网页 .sz-bk__note：内边距 12 / 16，一行 15 / 22；圆点 6 × 6）
        if let kind = noteKind, let box = noteBoxOf(kind, m) {
            noteView.isHidden = false
            noteText.isHidden = false
            y += mt.groupGap
            NativeType.set(noteText, box.text.text, font: mt.font(15), color: color("ink1"), line: mt.line("lh15"))
            noteText.accessibilityLabel = box.text.text
            noteText.numberOfLines = 0
            let textW = width - 50                       // 左右内边距 16 + 圆点 6 + 间距 12
            let textH = NativeType.height(noteText, width: textW, line: mt.line("lh15"))
            noteView.frame = CGRect(x: 0, y: y, width: width, height: textH + 24)
            noteView.backgroundColor = color("field")
            noteView.layer.cornerRadius = mt.value("r-ctl")
            noteView.layer.cornerCurve = .continuous
            noteDot.frame = CGRect(x: 16, y: 12 + 8, width: 6, height: 6)
            noteDot.backgroundColor = color("ink1")
            noteDot.layer.cornerRadius = 3
            noteText.frame = CGRect(x: 34, y: 12, width: textW, height: textH)
            y += textH + 24
        } else {
            noteView.isHidden = true
            noteText.isHidden = true
        }
        // 列表（网页 .sz-bk__list：上边线 0.5；恢复行 / 危险行之间 32）
        y += mt.groupGap
        let listTop = y
        let hasSub = m.hasRecords && undoKind == nil
        let rowW = width - 20                           // 行内文字的可用宽（右边留 chevron 的位）
        let titleH = NativeType.height(restoreRow.label, width: rowW, line: mt.line("lh17s"))
        let subH = hasSub ? NativeType.height(restoreRow.valueLabel, width: rowW, line: mt.line("lh15")) : 0
        let restoreBlock = hasSub ? titleH + 3 + subH : titleH
        let hairW = shiziHairline(mt.value("hair"))
        let restoreH = max(52, restoreBlock + 24 + hairW) // 网页 .sz-bk__row（border-box）：内边距 12 上下 + 下边线、最小高 52
        let clearH = max(52, NativeType.height(clearRow.label, width: rowW, line: mt.line("lh17s")) + 24 + hairW)
        restoreRow.frame = CGRect(x: 0, y: hairW, width: width, height: restoreH) // 列表上边线占 hair（不是 0.5）
        restoreRow.chevronFrame = CGRect(x: width - 8, y: (restoreH - hairW - 13) / 2, width: 8, height: 13) // 行框的下边线占 hair：chevron 在内容框里居中
        clearRow.frame = CGRect(x: 0, y: hairW + restoreH + mt.groupGap, width: width, height: clearH)
        // 行内文字（网页 .sz-bk__rowl：主文字 17 / 22，副文字 15 / 22，间距 3；整块竖向居中）
        if hasSub {
            let top = (restoreH - hairW - restoreBlock) / 2
            restoreRow.label.frame = CGRect(x: 0, y: top, width: rowW, height: titleH)
            restoreRow.valueLabel.frame = CGRect(x: 0, y: top + titleH + 3, width: rowW, height: subH)
            restoreRow.valueLabel.isHidden = false
        } else {
            restoreRow.label.frame = CGRect(x: 0, y: (restoreH - hairW - titleH) / 2, width: rowW, height: titleH)
            restoreRow.valueLabel.isHidden = true
        }
        clearRow.label.frame = CGRect(x: 0, y: (clearH - hairW - NativeType.height(clearRow.label, width: rowW, line: mt.line("lh17s"))) / 2, width: rowW, height: NativeType.height(clearRow.label, width: rowW, line: mt.line("lh17s")))
        // 可点状态（网页：没有记录时导出与清空都禁用）
        let has = m.hasRecords
        clearRow.isEnabled = has
        clearRow.label.textColor = has ? color("ink1") : color("ink4")
        restoreRow.isEnabled = true
        restoreRow.isUserInteractionEnabled = true
        listView.frame = CGRect(x: 0, y: listTop, width: width, height: hairW + restoreH + mt.groupGap + clearH)
        // 发丝线（网页 border-box：行的上 / 下边线画在行框以内）
        let hair = shiziHairline(mt.value("hair"))
        listLines.forEach { $0.backgroundColor = color("line") }
        listLines[0].frame = CGRect(x: 0, y: 0, width: width, height: hair)
        listLines[1].frame = CGRect(x: 0, y: restoreRow.frame.maxY - hair, width: width, height: hair)
        listLines[2].frame = CGRect(x: 0, y: clearRow.frame.minY, width: width, height: hair)
        listLines[3].frame = CGRect(x: 0, y: clearRow.frame.maxY - hair, width: width, height: hair)
        y = listView.frame.maxY
        bodyView.frame = CGRect(x: x, y: top, width: width, height: y)
        return top + y
    }

    /// 底栏（网页 .sz-page__foot：主按钮 / 撤销条 / 导出失败三段式）。
    private func layoutFooter() {
        let mt = metrics
        let w = view.bounds.width
        let bottom = view.bounds.height - view.safeAreaInsets.bottom
        let showUndo = undoKind != nil
        exportButton.isHidden = showUndo || exportFail
        exportFailNote.isHidden = !exportFail
        exportFailCancel.isHidden = !exportFail
        exportFailRetry.isHidden = !exportFail
        undoBar.isHidden = !showUndo
        if showUndo {
            // 撤销条（网页 .sz-undobar：内边距 8 上下 + 1pt 边；内容 = 两行说明或 44 高的按钮，取大的）
            let contentH = max(2 * mt.line("lh15"), mt.hit)
            let h = contentH + 18
            undoWrap.frame = CGRect(x: 12, y: bottom - h, width: w - 24, height: h)
            undoBar.frame = undoWrap.bounds
            if let m = model, let kind = undoKind {
                let lines = undoFailed ? (kind == .clear ? m.undo.failedClear : m.undo.failedRestore) : (kind == .clear ? m.undo.clear : m.undo.restore)
                undoBar.configure(l1: lines.l1.text, l2: lines.l2.text, undo: ShiziCopy.t("X-COMMON.undo"), metrics: mt,
                                  colors: (color("toast-fg"), color("toast-act"), color("toast-line")))
            }
            return
        }
        if exportFail {
            // 导出失败的三段式（网页 FailBlock layout=foot：说明 → 先不保存 → 再试一次）
            let noteH = mt.line("lh15")
            let cancelH = mt.hit
            let btnH = mt.value("btn-h")
            let top = bottom - btnH
            exportFailRetry.frame = CGRect(x: mt.gutter, y: top, width: w - 2 * mt.gutter, height: btnH)
            exportFailCancel.frame = CGRect(x: mt.gutter - 4, y: top - mt.space(2) - cancelH, width: 120, height: cancelH)
            exportFailNote.frame = CGRect(x: mt.gutter, y: top - mt.space(2) - cancelH - mt.space(1) - mt.space(2) - noteH, width: w - 2 * mt.gutter, height: noteH)
            return
        }
        let h = mt.value("btn-h")
        exportButton.frame = CGRect(x: mt.gutter, y: bottom - h, width: w - 2 * mt.gutter, height: h)
        let has = model?.hasRecords ?? false
        exportButton.isEnabled = has
        exportButton.backgroundColor = has ? color("btn-bg") : color("field")
        exportButton.setTitleColor(has ? color("btn-fg") : color("ink4"), for: .normal)
    }

    private func noteBoxOf(_ kind: NoteKind, _ m: View) -> View.NoteBox? {
        switch kind {
        case .protectFailed: return m.noteBox.protectFailed
        case .notBackup: return m.noteBox.notBackup
        case .restoreFailed: return m.noteBox.restoreFailed
        }
    }

    // MARK: 导出

    private func doExport() {
        guard let engine = stage?.engine else { return }
        setExportFail(false)
        engine.raw("backup.export", [:]) { [weak self] body in
            guard let self, (body["ok"] as? Bool) == true, let name = body["name"] as? String, let text = body["text"] as? String else {
                self?.setExportFail(true)
                return
            }
            self.exportSig = body["sig"] as? String
            self.share(text: text, name: name)
        }
    }

    /// 分享（网页 shareBackupFile：原生走系统分享面板；完成才记「上次备份」）。
    private func share(text: String, name: String) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("shizi-share", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        do {
            try text.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            setExportFail(true)
            return
        }
        shareURL = url
        let activity = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        activity.completionWithItemsHandler = { [weak self] _, done, _, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                if done { self.finishExport() } else { self.setExportFail(true) }
            }
        }
        if let pop = activity.popoverPresentationController {
            pop.sourceView = exportButton
            pop.sourceRect = exportButton.bounds
        }
        present(activity, animated: true)
    }

    private func finishExport() {
        guard let engine = stage?.engine, let sig = exportSig else { return }
        exportSig = nil
        engine.raw("backup.exportDone", ["sig": sig]) { _ in }
    }

    private func setExportFail(_ on: Bool) {
        exportFail = on
        markStateChange()
        view.setNeedsLayout()
    }

    // MARK: 导入（选文件 → 预检 → 替换确认框）

    private func pickBackup() {
        // 系统文件选择器（正式路径）
        if !Self.qaFileMode {
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.json], asCopy: true)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            present(picker, animated: true)
            return
        }
        // QA 取证（逐屏对比 / 流程测试）：系统选择器没法在夹具里点，夹具把「用户选中的文件」放在网页侧。
        qaPickFile { [weak self] url in
            guard let self else { return }
            guard let url else { return } // 用户取消：什么都不显示（网页 receiveRejected 的 cancelled 分支）
            self.precheckAndPick(url)
        }
    }

    /// QA 取证用的「用户选中的文件」：夹具 op stashBackupPick / stashBadBackup / stashTooLargeBackup 放进 QABackupPick.current
    /// （{text} = 这个内容的文件；{bytes} = 这么大字节的文件）。写成临时文件后走**与系统选择器同一条预检**（BackupFile.precheck）。
    /// 只有 QA 运行（逐屏取证 / 流程测试：NativeQAHarness 的 qaEnabled——探针 / 夹具 / -shizi-qa 都算）走这条路；正式包走 UIDocumentPickerViewController。
    #if DEBUG
    private static var qaFileMode: Bool { RootViewController.qaEnabled }

    private func qaPickFile(_ done: @escaping (URL?) -> Void) {
        guard let pick = QABackupPick.current else { done(nil); return } // 没选文件 = 用户取消
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("shizi-qa-pick-\(UUID().uuidString).json")
        do {
            if pick.bytes > 0 {
                // 太大：造一个这么大的文件（稀疏文件，不占内存），预检按真实文件大小判
                FileManager.default.createFile(atPath: url.path, contents: nil)
                let handle = try FileHandle(forWritingTo: url)
                try handle.truncate(atOffset: UInt64(pick.bytes))
                try handle.close()
            } else if let text = pick.text {
                try text.write(to: url, atomically: true, encoding: .utf8)
            } else {
                done(nil)
                return
            }
            done(url)
        } catch {
            done(nil)
        }
    }
    #else
    private static let qaFileMode = false
    private func qaPickFile(_ done: @escaping (URL?) -> Void) { done(nil) }
    #endif

    /// 原生预检（BackupFile.precheck：64MB 上限 + 拾字外壳）→ 通过了交给会话层，拒收了显示说明框。
    private func precheckAndPick(_ url: URL) {
        switch BackupFile.precheck(at: url) {
        case .success(let text):
            picked(text)
        case .failure(let rejection):
            // tooLarge / invalid：网页侧同样是 R-B06.notBackup 一张说明框（failureKind）
            showNote(.notBackup, retry: nil)
            _ = rejection
        }
    }

    /// 拿到文件文本 → 预检（会话层）。
    private func picked(_ text: String) {
        pickedText = text
        guard let engine = stage?.engine else { return }
        engine.raw("backup.picked", ["text": text]) { [weak self] body in
            guard let self else { return }
            if let preview = body["preview"] as? [String: Any], let p = try? ShiziDecode.value(preview, as: Preview.self) {
                self.preview = p
                self.pickedLines = body["lines"] as? [String: Any] ?? [:]
                self.showRestoreConfirm(p)
                return
            }
            let kind = (body["note"] as? [String: Any])?["kind"] as? String ?? "notBackup"
            self.showNote(NoteKind(rawValue: kind) ?? .notBackup, retry: nil)
        }
    }

    /// 替换 / 恢复确认框（网页 RestoreConfirm）。
    private func showRestoreConfirm(_ p: Preview) {
        let dialog = BackupConfirmView(frame: .zero)
        dialog.panel.accessibilityIdentifier = "native-backup-restore-confirm"
        dialog.titleLabel.accessibilityIdentifier = "native-backup-restore-title"
        dialog.bodyLabel.accessibilityIdentifier = "native-backup-restore-body"
        dialog.cancelButton.accessibilityIdentifier = "native-backup-restore-cancel"
        dialog.okButton.accessibilityIdentifier = "native-backup-restore-ok"
        let loss = p.lossText?.text ?? ""
        dialog.lossLabel.accessibilityIdentifier = "native-backup-restore-loss"
        dialog.exportFirstButton.accessibilityIdentifier = "native-backup-restore-export"
        dialog.configure(BackupConfirmView.Strings(title: p.title.text, body: ShiziWebLines.breakText(p.body.text, pickedLines["body"]),
                                                  cancel: p.cancel.text, ok: p.ok.text,
                                                  bodyColorIsStrong: p.mode == "replace", loss: loss, exportFirst: p.exportFirst?.text ?? ""),
                         metrics: metrics, colors: confirmPalette())
        dialog.onCancel = { [weak self] in self?.closeConfirm() }
        dialog.onOK = { [weak self] in self?.confirmRestore() }
        dialog.onExportFirst = { [weak self] in self?.doExport() }
        confirmView = dialog
        view.addSubview(dialog)
        dialog.frame = view.bounds
        dialog.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        dialog.animateIn(NativeOverlaySpec(motion: ShiziTokens.pageMotion(.write)), reduce: UIAccessibility.isReduceMotionEnabled)
    }

    /// 确认框用的颜色（网页 .sz-confirm 的规格）。
    private func confirmPalette() -> BackupConfirmView.Palette {
        BackupConfirmView.Palette(ink1: color("ink1"), ink2: color("ink2"), ink4: color("ink4"),
                                  elev: color("elev"), btnBg: color("btn-bg"), btnFg: color("btn-fg"))
    }

    private func confirmRestore() {
        guard let text = pickedText, let engine = stage?.engine else { closeConfirm(); return }
        closeConfirm()
        engine.raw("backup.restore", ["text": text]) { [weak self] body in
            guard let self else { return }
            if (body["ok"] as? Bool) == true {
                self.pickedText = nil
                self.setUndo(.restore)
            } else {
                self.showNote(.restoreFailed, retry: { self.confirmRestore() })
            }
        }
    }

    // MARK: 清空

    private func openClearSheet() {
        guard let m = model, m.hasRecords else { return }
        clearSheetOpen = true
        clearSheetFailed = false
        showClearSheet()
    }

    /// 清空确认框（网页 ClearSheet：正常态 / 失败态）。
    private func showClearSheet() {
        guard let m = model else { return }
        let dialog = BackupConfirmView(frame: .zero)
        dialog.panel.accessibilityIdentifier = "native-backup-clear-sheet"
        dialog.bodyLabel.accessibilityIdentifier = "native-backup-clear-body"
        let failed = clearSheetFailed
        dialog.cancelButton.accessibilityIdentifier = failed ? "native-backup-clear-stay" : "native-backup-clear-cancel"
        dialog.okButton.accessibilityIdentifier = failed ? "native-backup-clear-retry" : "native-backup-clear-ok"
        let bodyText = failed ? m.clearSheet.failed.body.text : m.clearSheet.body.text
        let body = ShiziWebLines.breakText(bodyText, failed ? lines["clearBodyFailed"] : lines["clearBody"])
        let cancel = failed ? m.clearSheet.failed.cancel.text : m.clearSheet.cancel.text
        let ok = failed ? m.clearSheet.failed.retry.text : m.clearSheet.ok.text
        dialog.configure(BackupConfirmView.Strings(title: m.clearSheet.title.text, body: body, cancel: cancel, ok: ok,
                                                  bodyColorIsStrong: !failed, loss: "", exportFirst: ""),
                         metrics: metrics, colors: confirmPalette())
        dialog.onCancel = { [weak self] in self?.closeConfirm() }
        dialog.onOK = { [weak self] in self?.confirmClear() }
        confirmView = dialog
        view.addSubview(dialog)
        dialog.frame = view.bounds
        dialog.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        dialog.animateIn(NativeOverlaySpec(motion: ShiziTokens.pageMotion(.write)), reduce: UIAccessibility.isReduceMotionEnabled)
    }

    private func confirmClear() {
        guard let engine = stage?.engine else { closeConfirm(); return }
        engine.raw("backup.clear", [:]) { [weak self] body in
            guard let self else { return }
            if (body["ok"] as? Bool) == true {
                self.clearSheetOpen = false
                self.clearSheetFailed = false
                self.closeConfirm()
                self.setUndo(.clear)
            } else {
                self.clearSheetFailed = true
                self.closeConfirm()
                self.showClearSheet()
            }
        }
    }

    private func closeConfirm() {
        guard let dialog = confirmView else { return }
        confirmView = nil
        dialog.animateOut(NativeOverlaySpec(motion: ShiziTokens.pageMotion(.write)), reduce: UIAccessibility.isReduceMotionEnabled)
    }

    // MARK: 撤销

    private func setUndo(_ kind: UndoKind) {
        undoKind = kind
        undoFailed = false
        undoDone = false
        markStateChange()
        view.setNeedsLayout()
    }

    private func doUndo() {
        guard let kind = undoKind, !undoDone, let engine = stage?.engine else { return }
        let op = kind == .clear ? "backup.undoClear" : "backup.undoRestore"
        engine.raw(op, [:]) { [weak self] body in
            guard let self else { return }
            if (body["ok"] as? Bool) == true {
                self.undoDone = true
                self.markStateChange()
                self.view.setNeedsLayout()
                // 「已撤销」2.4s 后收起（网页 UndoBar 的 UNDONE_MS）
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.4) {
                    guard self.undoDone else { return }
                    self.undoKind = nil
                    self.undoDone = false
                    self.markStateChange()
                    self.view.setNeedsLayout()
                }
            } else {
                self.undoFailed = true
                self.markStateChange()
                self.view.setNeedsLayout()
            }
        }
    }

    // MARK: 说明框

    private func showNote(_ kind: NoteKind, retry: (() -> Void)?) {
        noteKind = kind
        noteRetry = retry
        markStateChange()
        view.setNeedsLayout()
    }
}

extension BackupScreen: UIDocumentPickerDelegate {
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else { return }
        precheckAndPick(url)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        // 用户自己取消：什么都不显示（网页 receiveRejected 的 cancelled 分支）
    }
}

// MARK: - 备份文件的原生预检（01 §8.1；B4.9 从 WebViewController 搬来）

/// 原生只做 64MB 上限（B1 前为 10MB）与 JSON 外壳预检（app=="shizi"、data 是非空对象、键全部 `shizi.` 前缀；v1/v2 都放行），
/// 通过则把文件文本交给会话层（backup.picked：校验、页内确认、保护副本、替换、撤销），否则备份页显示说明框。
enum BackupFile {
    /// 与 JS 参考 BACKUP_MAX_BYTES 相同。
    static let maxBytes = 64 * 1024 * 1024

    enum Rejection: String, Error {
        case tooLarge
        case invalid
        case cancelled
    }

    static func precheck(at url: URL) -> Result<String, Rejection> {
        if let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize, size > maxBytes {
            return .failure(.tooLarge)
        }
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else {
            return .failure(.invalid)
        }
        guard data.count <= maxBytes else {
            return .failure(.tooLarge)
        }
        guard
            let text = String(data: data, encoding: .utf8),
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            object["app"] as? String == "shizi",
            let backupData = object["data"] as? [String: Any],
            !backupData.isEmpty,
            backupData.keys.allSatisfy({ $0.hasPrefix("shizi.") })
        else {
            return .failure(.invalid)
        }
        return .success(text)
    }
}

#if DEBUG
/// QA 的「用户选中的文件」（夹具 op stashBackupPick / stashBadBackup / stashTooLargeBackup 写，备份页的 QA 选文件读；下一个顶层夹具清空）。
enum QABackupPick {
    static var current: (text: String?, bytes: Int)?
}
#endif
