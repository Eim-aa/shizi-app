import UIKit

// B3.5b 字库 tab 根页（网页 src/ui/screens/library/index.js「字库方向四」，1:1 移植；视图模型 src/session/views/library.js libraryPageView，App API view.library）。
// 屏名 ⇄ 类：library ⇄ ShiziScreen_library。tab 根页：NativeStage 把它作为 WebViewController 的子控制器插在 WKWebView 上面、只盖到 Tab 栏上沿
// （Tab 栏仍是网页的，B3.5d 与另两个根页同开时换原生 Tab 栏）；B3.5d 之前只在 -shizi-native-roots / QA 夹具 op nativeRoots 打开时出现。
//
// 只读页：不写 store。「今日练习」= op library.startToday（网页字库页同一个动作；D62：从字库进写字页是普通推入 T-push，不是纸展开——不记纸来源）；
// 搜索框 = 让给网页的查字弹层（原生查字弹层 B3.6 之前：先把本页的样子交给宿主层 stage.cover，再开弹层）；
// 其余行（练习范围 / 全部 / 三档 / 已跳过）= nav.push（目标屏还是网页屏：NativeStage 先把本页的样子交给宿主层再让开，回来时按原样盖回）。
// 离开撤销条跟到字库（网页 write/skip.js 同一份状态；原生经 library.undoLeave / undoLeaveCancel）。
//
// 版式按网页 CSS 逐项排（library/index.js 的 .sz-libr__* / .sz-libq / Page.js .sz-tabpage），数值取 ShiziTokens（fs* / lh* / s* / gutter / hit / r-ctl），
// 文案取视图模型给的引用（{copy, params}，原生递归渲染）。

/// 字库首页的一行（名称 / 值 / 样字 / chevron）的按压反馈（网页 .sz-btn[data-pressed]：缩到 0.97，按下 120ms、松开 220ms）。
private enum LibPress {
    static func attach(_ b: UIControl) {
        let scale = CGFloat(((ShiziTokens.motion["scale"] as? [String: Any])?["press"] as? NSNumber)?.doubleValue ?? 1)
        let dur = ShiziTokens.motion["duration"] as? [String: Any]
        let down = (dur?["press"] as? NSNumber)?.doubleValue ?? 0, up = (dur?["release"] as? NSNumber)?.doubleValue ?? 0
        b.addAction(UIAction { [weak b] _ in
            guard let b, b.isEnabled else { return }
            UIView.animate(withDuration: down / 1000, delay: 0, options: [.allowUserInteraction, .beginFromCurrentState]) { b.transform = CGAffineTransform(scaleX: scale, y: scale) }
        }, for: .touchDown)
        b.addAction(UIAction { [weak b] _ in
            UIView.animate(withDuration: up / 1000, delay: 0, options: [.allowUserInteraction, .beginFromCurrentState]) { b?.transform = .identity }
        }, for: [.touchUpInside, .touchUpOutside, .touchCancel])
    }
}

@objc(ShiziScreen_library)
final class LibraryScreen: ShiziScreenViewController, ShiziRootProbing {
    struct Route: Decodable { let screen: String; let params: [String: String]? }
    struct Sample: Decodable { let char: String; let tone: Int; let strokes: [[[Double]]]? }
    struct Zone: Decodable { let kind: String; let name: ShiziCopyRef; let n: Int; let to: Route?; let samples: [Sample] }
    struct View: Decodable {
        struct Search: Decodable { let placeholder: ShiziCopyRef }
        struct Range: Decodable { let label: ShiziCopyRef; let value: ShiziCopyRef; let to: Route }
        struct Today: Decodable { let label: ShiziCopyRef; let phase: String; let n: Int; let value: ShiziCopyRef; let sub: ShiziCopyRef? }
        struct Written: Decodable { let heading: ShiziCopyRef; let count: Int; let all: ShiziCopyRef; let allAria: ShiziCopyRef; let to: Route }
        struct SampleSpec: Decodable { let side: Double; let inkSide: Double; let inkScale: Double }
        struct Leave: Decodable { let slot: String; let char: String; let failed: Bool; let remainingMs: Double; let text: ShiziCopyRef }
        struct Undo: Decodable { let undo: ShiziCopyRef; let failed: ShiziCopyRef; let cancel: ShiziCopyRef; let retry: ShiziCopyRef }
        let state: String
        let title: ShiziCopyRef
        let search: Search
        let range: Range
        let todayRow: Today
        let written: Written
        let zones: [Zone]
        let skipped: Zone
        let sample: SampleSpec
        let leaveUndo: Leave?
        let undo: Undo
    }

    // 行：可点（按钮）与 0 个字（不可点，只写名称与 0）两种样子共用一个对象
    final class Row {
        let button = ShiziRowButton(type: .custom)
        let zero = UIView()
        let zeroName = UILabel()
        let zeroCount = UILabel()
        let line = UIView()
        let chevron = UIImageView()
        /// 样字（按钮里的视图；网页上是 svg / canvas，QA 取证按 innerText 取，原生报在那一行的字里）。
        var samples: [UIView] = []
        var zeroMode = false
        /// 这一行有第二行小字（今日练习行）：名称与小字是两行，文字框按两行的并集量（网页的字体内容区，原生是行盒——见 layoutRow 里的上移量）。
        var hasCap = false
        /// 按钮里的第二段字是「值」（练习范围 / 今日练习，右对齐）还是「数」（三档 / 已跳过，紧跟名称）。
        enum Role { case none, value, count }
        var role = Role.none
        init() {
            zero.addSubview(zeroName)
            zero.addSubview(zeroCount)
        }
    }

    private var model: View?
    // 块与分隔线
    private let homeMarker = UIView()
    private let searchMarker = UIView()
    private let slotMarker = UIView()
    private let writtenMarker = UIView()
    private let skippedMarker = UIView()
    private let failMarker = UIView()
    private let blockLines = (0..<4).map { _ in UIView() } // 练习范围 / 今日练习 / 三档 / 已跳过 四块的顶线
    // 搜索框
    private let searchButton = ShiziRowButton(type: .custom)
    private let searchIcon = UIImageView()
    // 行
    private let rangeRow = Row()
    private let todayRow = Row()
    private let zoneRows = (0..<3).map { _ in Row() }
    private let skippedRow = Row()
    private var allRows: [Row] { [rangeRow, todayRow] + zoneRows + [skippedRow] }
    // 「已练汉字 N 全部 ›」
    private let headingLabel = UILabel()
    private let countLabel = UILabel()
    private let allButton = NativeTextButton(type: .custom)
    // 开组失败三段式（今日练习行下面就地）
    private let failNote = UILabel()
    private let failCancel = NativeTextButton(type: .custom)
    private let failRetry = UIButton(type: .custom)
    private var failed = false
    private var starting = false
    private var undoBar: NativeUndoBarView?
    private var undoLife: NativeUndoLifetime?
    var rootProbe: [String: Any] { ["leaveUndo": model?.leaveUndo != nil, "undoVisible": undoBar != nil, "failed": failed] }

    private var foregroundObserver: NSObjectProtocol?
    private var accessibilityObservers: [NSObjectProtocol] = []

    deinit {
        undoLife?.stop()
        if let foregroundObserver { NotificationCenter.default.removeObserver(foregroundObserver) }
        accessibilityObservers.forEach { NotificationCenter.default.removeObserver($0) }
    }

    // MARK: 构建

    override func viewDidLoad() {
        super.viewDidLoad()
        backButton.isHidden = true
        // 大标题在滚动内容里（网页 .sz-tabpage__title），不是固定页头
        titleLabel.removeFromSuperview()
        titleLabel.accessibilityIdentifier = "native-library-title"
        titleLabel.numberOfLines = 0
        content.addSubview(titleLabel)
        let ids: [(UIView, String)] = [
            (homeMarker, "native-library-home"), (searchMarker, "native-library-search"), (slotMarker, "native-library-query-slot"),
            (writtenMarker, "native-library-written"), (skippedMarker, "native-library-skipped-block"), (failMarker, "native-library-today-fail"),
        ]
        for (v, id) in ids {
            v.accessibilityIdentifier = id
            v.isUserInteractionEnabled = false
            v.isAccessibilityElement = false
            content.addSubview(v)
        }
        blockLines.forEach { content.addSubview($0) }
        searchButton.accessibilityIdentifier = "native-library-query-open"
        searchIcon.isUserInteractionEnabled = false
        searchIcon.isAccessibilityElement = false
        searchButton.addSubview(searchIcon)
        content.addSubview(searchButton)
        wire(searchButton) { page in (page as? LibraryScreen)?.openQuery() }
        LibPress.attach(searchButton)
        // 行 id：三档用 -0/-1/-2（XCUITest 要点其中一行），其余用本行自己的名字
        let rowIds = ["native-library-range", "native-library-today", "native-library-zone-0", "native-library-zone-1", "native-library-zone-2", "native-library-skipped"]
        let rowBases = ["range", "today", "zone", "zone", "zone", "skipped"]
        for ((row, id), base) in zip(zip(allRows, rowIds), rowBases) {
            row.button.accessibilityIdentifier = id
            row.zero.accessibilityIdentifier = id
            if base == "zone" || base == "skipped" {
                row.zeroName.accessibilityIdentifier = "native-library-\(base)-name"
                row.zeroCount.accessibilityIdentifier = "native-library-\(base)-count"
            }
            row.chevron.isUserInteractionEnabled = false
            row.chevron.isAccessibilityElement = false
            row.button.addSubview(row.chevron)
            content.addSubview(row.button)
            content.addSubview(row.zero)
            content.addSubview(row.line)
            row.zero.isAccessibilityElement = false
            LibPress.attach(row.button)
        }
        wire(rangeRow.button) { page in (page as? LibraryScreen)?.go((page as? LibraryScreen)?.model?.range.to) }
        wire(todayRow.button) { page in (page as? LibraryScreen)?.startToday() }
        for (i, row) in zoneRows.enumerated() {
            wire(row.button) { page in (page as? LibraryScreen)?.go((page as? LibraryScreen)?.model?.zones[i].to) }
        }
        wire(skippedRow.button) { page in (page as? LibraryScreen)?.go((page as? LibraryScreen)?.model?.skipped.to) }
        headingLabel.accessibilityIdentifier = "native-library-written-heading"
        headingLabel.isAccessibilityElement = false
        countLabel.accessibilityIdentifier = "native-library-written-count"
        countLabel.isAccessibilityElement = false
        allButton.accessibilityIdentifier = "native-library-all-open"
        for v in [headingLabel, countLabel, allButton] as [UIView] { content.addSubview(v) }
        wire(allButton) { page in (page as? LibraryScreen)?.go((page as? LibraryScreen)?.model?.written.to) }
        failNote.accessibilityIdentifier = "native-library-today-fail-note"
        failNote.numberOfLines = 0
        failCancel.accessibilityIdentifier = "native-library-today-fail-cancel"
        failRetry.accessibilityIdentifier = "native-library-today-fail-retry"
        for v in [failNote, failCancel, failRetry] as [UIView] { v.isHidden = true; content.addSubview(v) }
        wire(failCancel) { page in (page as? LibraryScreen)?.dismissFail() }
        wire(failRetry) { page in (page as? LibraryScreen)?.startToday() }
        // 回前台时重算「今天」（网页 useToday 的 visibilitychange）
        foregroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self, self.isViewLoaded, self.view.window != nil, self.stage?.isTop(self) == true else { return }
            self.reload()
        }
        for name in [UIAccessibility.voiceOverStatusDidChangeNotification, UIAccessibility.switchControlStatusDidChangeNotification] {
            accessibilityObservers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.undoLife?.assistiveChanged(NativeUndoLifetime.systemAssistive)
            })
        }
        if let v = lastView { try? render(view: v) }
    }

    // MARK: 回包

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: View.self)
        model = m
        guard isViewLoaded else { return }
        applyTitle()
        let mt = metrics
        let ax = axLayout
        // 搜索框（按钮 15、墨一；图标 18、字 17 / 墨二，AX 档字换 13）
        let placeholder = m.search.placeholder.text
        searchButton.titleLabel?.font = mt.font(15)
        searchButton.setTitleColor(color("ink1"), for: .normal)
        searchButton.backgroundColor = color("field")
        searchButton.layer.cornerRadius = mt.value("r-ctl")
        NativeType.set(searchButton.label, placeholder, font: mt.font(ax ? 13 : 17), color: color("ink2"), line: mt.line(ax ? "lh13" : "lh17s"))
        searchButton.valueLabel.isHidden = true
        searchButton.valueLabel.text = nil
        searchButton.chevronSize = CGSize(width: 18, height: 18)
        searchButton.setImage(Self.clear(CGSize(width: 18, height: 18)), for: .normal)
        searchIcon.image = Self.searchIcon(color("ink2"))
        searchButton.accessibilityLabel = placeholder
        searchButton.accessibilityTraits = [.button]
        searchButton.isAccessibilityElement = true
        // 练习范围
        configure(rangeRow, name: m.range.label.text, value: m.range.value.text, cap: nil, count: nil, zone: nil, aria: "\(m.range.label.text) \(m.range.value.text)", tappable: true)
        // 今日练习
        let sub = m.todayRow.sub?.text
        let todayAria = [m.todayRow.label.text, sub, m.todayRow.value.text].compactMap { $0 }.joined(separator: " ")
        configure(todayRow, name: m.todayRow.label.text, value: m.todayRow.value.text, cap: sub, count: nil, zone: nil, aria: todayAria, tappable: true)
        // 已练汉字 N 全部 ›
        NativeType.set(headingLabel, m.written.heading.text, font: mt.font(17, .medium), color: color("ink1"), line: mt.line("lh17s"))
        NativeType.set(countLabel, String(m.written.count), font: tabular(mt.font(15)), color: color("ink3"), line: mt.line("lh15"))
        allButton.setTitle(m.written.all.text, for: .normal)
        allButton.setTitleColor(color("ink2"), for: .normal)
        allButton.titleLabel?.font = mt.font(ax ? 11 : 15)
        allButton.titleLabel?.textAlignment = .center
        allButton.accessibilityLabel = m.written.allAria.text
        NativeType.linkTitle(allButton)
        if ax { NativeType.trackTitle(allButton) }
        // 三档与已跳过
        for (row, z) in zip(zoneRows, m.zones) { configure(row, zone: z, tone: m.sample) }
        configure(skippedRow, zone: m.skipped, tone: m.sample)
        renderFail()
        renderUndo(m)
        view.setNeedsLayout()
    }

    /// 大标题（网页 .sz-tabpage__title：宋体 28 / 500，行高 lh28，在滚动内容里，不在固定页头）。
    /// 基类在 AX 档会拿空标题重排标题标签（页头第二行，ShiziParagraph.place），本页的标题在正文里，所以每次排版后把字与字体放回去。
    private func applyTitle() {
        guard let m = model else { return }
        let mt = metrics
        NativeType.set(titleLabel, m.title.text, font: NativeType.song(size: mt.value("fs28"), weight: .medium), color: color("ink1"), line: mt.line("lh28"))
        ShiziFonts.untrack(titleLabel)
        titleLabel.accessibilityLabel = m.title.text
    }

    private func configure(_ row: Row, zone z: Zone, tone spec: View.SampleSpec) {
        let name = z.name.text
        // 读屏名（网页：名称、数、无墨迹样字的字——轮廓字形里放一份视觉隐藏的字）
        let aria = ([name, String(z.n)] + z.samples.map(\.char)).joined(separator: " ")
        configure(row, name: name, value: nil, cap: nil, count: String(z.n), zone: z, aria: aria, tappable: z.n > 0, spec: spec)
    }

    private func configure(_ row: Row, name: String, value: String?, cap: String?, count: String?, zone: Zone?, aria: String, tappable: Bool, spec: View.SampleSpec? = nil) {
        let mt = metrics
        let ax = axLayout
        row.zeroMode = !tappable
        row.button.isHidden = !tappable
        row.zero.isHidden = tappable
        row.hasCap = cap != nil && !ax
        let nameFont = mt.font(17, .medium)
        if tappable {
            let b = row.button
            b.titleLabel?.font = mt.font(15)
            b.setTitleColor(color("ink1"), for: .normal)
            // 名称（今日练习行带第二行小字：同一个标签两段，行距 1）
            if let cap, !ax {
                let out = NSMutableAttributedString()
                let p1 = NSMutableParagraphStyle()
                p1.minimumLineHeight = mt.line("lh17s"); p1.maximumLineHeight = mt.line("lh17s"); p1.paragraphSpacing = 1
                let p2 = NSMutableParagraphStyle()
                p2.minimumLineHeight = mt.line("lh13"); p2.maximumLineHeight = mt.line("lh13")
                let f1 = nameFont, f2 = mt.font(13)
                out.append(NSAttributedString(string: name + "\n", attributes: [.font: f1, .foregroundColor: color("ink1"), .paragraphStyle: p1, .kern: NativeType.cjkTrack(size: nameFont.pointSize, weight: .medium), .baselineOffset: (mt.line("lh17s") - f1.lineHeight) / 4]))
                out.append(NSAttributedString(string: cap, attributes: [.font: f2, .foregroundColor: color("ink3"), .paragraphStyle: p2, .kern: NativeType.cjkTrack(size: f2.pointSize, weight: .regular), .baselineOffset: (mt.line("lh13") - f2.lineHeight) / 4]))
                b.label.attributedText = out
            } else {
                NativeType.set(b.label, name, font: nameFont, color: color("ink1"), line: mt.line("lh17s"))
            }
            b.label.numberOfLines = 0
            if let value {
                row.role = .value
                b.valueLabel.isHidden = false
                NativeType.set(b.valueLabel, value, font: tabular(mt.font(ax ? 15 : 17)), color: color("ink2"), align: ax ? .left : .right, line: mt.line(ax ? "lh15" : "lh17s"))
            } else if let count {
                row.role = .count
                b.valueLabel.isHidden = false
                NativeType.set(b.valueLabel, count, font: tabular(mt.font(15)), color: color("ink3"), line: mt.line("lh15"))
            } else {
                row.role = .none
                b.valueLabel.isHidden = true
                b.valueLabel.text = nil
            }
            b.valueLabel.numberOfLines = 0
            b.accessibilityLabel = aria
            b.accessibilityTraits = [.button]
            b.isAccessibilityElement = true
            // chevron（网页 .sz-chev 8 × 13；按钮自身的图像位置 = ShiziRowButton.imageRect：右端、竖向居中）
            row.chevron.image = ShiziChevron.image(color("ink4"), size: CGSize(width: 8, height: 13))
            b.chevronSize = CGSize(width: 8, height: 13)
            b.setImage(Self.clear(CGSize(width: 8, height: 13)), for: .normal)
            // 样字
            row.samples.forEach { $0.removeFromSuperview() }
            row.samples = []
            if let zone, !ax, let spec {
                for s in zone.samples {
                    let box = UIView()
                    box.isUserInteractionEnabled = false
                    box.isAccessibilityElement = false
                    box.frame = CGRect(x: 0, y: 0, width: spec.side, height: spec.side)
                    let c = color("wall\(max(0, min(3, s.tone)) + 1)")
                    let strokes = NativeInkWire.rawStrokes(s.strokes?.map { $0.map { $0.map { NSNumber(value: $0) } } })
                    if !strokes.isEmpty, let ink = NativeInkPaint.view(strokes: strokes, side: spec.inkSide, color: Self.simd(c, traitCollection), widthScale: spec.inkScale) {
                        ink.frame = CGRect(x: (spec.side - spec.inkSide) / 2, y: (spec.side - spec.inkSide) / 2, width: spec.inkSide, height: spec.inkSide)
                        box.addSubview(ink)
                    } else {
                        // 轮廓字形（网页 PracticeGlyph：画的是标准字形，没有墨）
                        let g = NativeGlyphView(frame: box.bounds)
                        g.char = s.char
                        g.color = c
                        g.isUserInteractionEnabled = false
                        box.addSubview(g)
                    }
                    b.addSubview(box)
                    row.samples.append(box)
                }
            }
        } else {
            row.zero.isAccessibilityElement = false
            NativeType.set(row.zeroName, name, font: nameFont, color: color("ink3"), line: mt.line("lh17s"))
            NativeType.set(row.zeroCount, count ?? "0", font: tabular(mt.font(15)), color: color("ink3"), line: mt.line("lh15"))
            row.zeroName.numberOfLines = 0
            row.zeroName.accessibilityLabel = name
            row.zeroCount.accessibilityLabel = count ?? "0"
        }
        row.line.backgroundColor = color("line")
    }

    // MARK: 失败三段式（开组写入失败：说明 → 先不保存 → 再试一次，页面里就地）

    private func renderFail() {
        let mt = metrics
        failMarker.isHidden = !failed
        for v in [failNote, failCancel, failRetry] as [UIView] { v.isHidden = !failed }
        guard failed else { return }
        failNote.text = t("X-HOME.startFailed")
        failNote.accessibilityLabel = t("X-HOME.startFailed")
        failCancel.setTitle(t("R-H06.cancel"), for: .normal)
        failCancel.setTitleColor(color("ink2"), for: .normal)
        failCancel.titleLabel?.font = mt.font(15)
        NativeType.trackTitle(failCancel)
        failRetry.setTitle(t("R-H06.retry"), for: .normal)
        failRetry.titleLabel?.font = NativeType.compose(size: mt.value("fs17"), weight: .medium)
        failRetry.setTitleColor(color("btn-fg"), for: .normal)
        failRetry.backgroundColor = color("btn-bg")
        failRetry.layer.cornerRadius = mt.value("r-ctl")
        NativeType.trackTitle(failRetry)
    }

    private func dismissFail() {
        guard failed else { return }
        failed = false
        markStateChange()
        renderFail()
        view.setNeedsLayout()
    }

    // MARK: 离开撤销（与网页 LeaveUndoHost 共享机会，S4）

    private func renderUndo(_ m: View) {
        guard let u = m.leaveUndo else { endUndo(); return }
        if let bar = undoBar {
            if u.failed != bar.isFailed { bar.setFailed(u.failed) }
            return
        }
        guard u.remainingMs > 0 || u.failed else { return }
        let mt = metrics
        let theme: ShiziTokens.Theme = traitCollection.userInterfaceStyle == .dark ? .dark : .light
        let raw = ShiziTokens.colorStrings(theme)
        let style = NativeToastStyle(background: color("toast-bg"), foreground: color("toast-fg"), action: color("toast-act"), line: color("toast-line"),
                                     shadow: NativeInkWire.shadow(raw["toast-shadow"]), radius: mt.value("r-box"))
        let type = NativeType(ShiziTokens.lengths(mt.category)?.mapValues { NSNumber(value: Double($0)) } ?? [:])
        let bar = NativeUndoBarView(style: style, type: type)
        bar.strings = .init(text: u.text.text, undo: m.undo.undo.text, failed: m.undo.failed.text, cancel: m.undo.cancel.text, retry: m.undo.retry.text)
        bar.onUndo = { [weak self] in self?.tapUndo() }
        bar.onCancelFail = { [weak self] in
            self?.stage?.engine.raw("library.undoLeaveCancel", [:]) { _ in }
            self?.endUndo()
        }
        bar.onHold = { [weak self] in self?.undoLife?.hold() }
        bar.onRelease = { [weak self] in self?.undoLife?.release() }
        if u.failed { bar.setFailed(true) }
        view.addSubview(bar)
        undoBar = bar
        let life = NativeUndoLifetime(ms: max(1, u.remainingMs)) { [weak self] in
            guard let self, self.undoBar?.isFailed != true else { return }
            self.stage?.engine.raw("library.undoLeaveCancel", [:]) { _ in }
            self.endUndo()
        }
        undoLife = life
        if !u.failed { life.start() }
        view.setNeedsLayout()
        NativeA11y.announce(u.text.text)
    }

    private func tapUndo() {
        stage?.engine.raw("library.undoLeave", [:]) { [weak self] reply in
            guard let self else { return }
            if (reply["ok"] as? Bool) == true || ((reply["error"] as? [String: Any])?["kind"] as? String) == "stale" {
                self.endUndo()
                return
            }
            self.undoLife?.stop()
            self.undoBar?.setFailed(true)
            self.markStateChange()
            NativeA11y.announce(self.model?.undo.failed.text)
            self.view.setNeedsLayout()
        }
    }

    private func endUndo() {
        undoLife?.stop()
        undoLife = nil
        guard let bar = undoBar else { return }
        undoBar = nil
        let fade = ((ShiziTokens.motion["duration"] as? [String: Any])?["fade"] as? NSNumber)?.doubleValue ?? 0
        UIView.animate(withDuration: fade / 1000, delay: 0, options: [.curveLinear]) { bar.alpha = 0 } completion: { _ in bar.removeFromSuperview() }
    }

    // MARK: 动作

    private func go(_ route: Route?) {
        guard let route else { return }
        push(route.screen, params: route.params ?? [:])
    }

    /// 搜索框：让给网页的查字弹层（原生查字弹层 B3.6 之前）。先把本页的样子交给宿主层（stage.cover），再开弹层。
    private func openQuery() {
        guard let stage, stage.isTop(self) else { return }
        yieldThen { page in
            page.stage?.engine.raw("library.openQuery", [:]) { _ in }
        }
    }

    /// 要盖上网页页面 / 弹层的动作：截图先交给宿主层（stage.cover，解码好才回包），再做。
    private func yieldThen(_ go: @escaping (LibraryScreen) -> Void) {
        guard let engine = stage?.engine else { return }
        var args: [String: Any] = ["entryId": entryId]
        if let url = WebViewController.snapshotURL(view) { args["url"] = url }
        ShiziProbe.note("library:yield")
        engine.raw("stage.cover", args) { [weak self] _ in
            guard let self else { return }
            go(self)
        }
    }

    /// 今日练习：op library.startToday（网页字库页同一个动作）。失败就地三段式，页面不动。
    private func startToday() {
        guard let stage, stage.isTop(self), !starting else { return }
        starting = true
        // D62：从字库进写字页是普通推入（T-push），不是纸展开——把被点的这一行当来源报给网页：
        // 网页按「被点进来的、又不是从首页进来的」记成普通推入（paper-transition.js planPaper 的 PUSHED 分支），转场与网页自己点这一行时一致。
        var args: [String: Any] = [:]
        if todayRow.button.window != nil { args["source"] = source(todayRow.button) }
        stage.engine.raw("library.startToday", args) { [weak self] reply in
            guard let self else { return }
            self.starting = false
            if (reply["ok"] as? Bool) == true {
                if self.failed { self.failed = false; self.renderFail(); self.view.setNeedsLayout() }
            } else {
                self.failed = true
                self.markStateChange()
                self.renderFail()
                self.view.setNeedsLayout()
            }
        }
    }

    // MARK: 排版

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // 基类在 AX 档会用空标题重排标题标签（页头第二行）：本页的标题在正文里，排版后放回去
        applyTitle()
        let w = view.bounds.width
        guard w > 0, model != nil else { return }
        backButton.isHidden = true
        scroll.frame = view.bounds
        let bottom = layoutBody(width: w - 2 * metrics.gutter, x: metrics.gutter, top: view.safeAreaInsets.top + metrics.space(4))
        let contentH = bottom + metrics.space(axLayout ? 2 : 8) // 网页 :root[data-ax] .sz-tabpage 下内边距收到 s2
        content.frame = CGRect(x: 0, y: 0, width: w, height: contentH)
        scroll.contentSize = CGSize(width: w, height: contentH)
        screenMarker.frame = CGRect(x: 0, y: 0, width: w, height: contentH)
        if let bar = undoBar {
            let h = bar.height(for: w - 2 * metrics.gutter)
            bar.frame = CGRect(x: metrics.gutter, y: view.bounds.height - 8 - h, width: w - 2 * metrics.gutter, height: h)
        }
    }

    /// tab 根页：大标题在滚动内容里（网页 .sz-tabpage），没有固定页头——正文从安全区 + s4 开始（网页 .sz-tabpage 的上内边距）。
    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat {
        guard model != nil else { return top }
        let mt = metrics
        let ax = axLayout
        let scale = view.window?.screen.scale ?? UIScreen.main.scale
        let hair = 1 / scale // 网页 0.5px 的边框按设备像素取整 = 1 个设备像素
        // 标题
        var y = view.safeAreaInsets.top + mt.space(4)
        let titleH = NativeType.height(titleLabel, width: width, line: mt.line("lh28"))
        titleLabel.frame = CGRect(x: x, y: y, width: width, height: titleH)
        y += titleH + (ax ? 6 : 8)
        let homeTop = y
        // 搜索框
        let searchMin: CGFloat = ax ? 56 : 48
        let sFont = ax ? "lh13" : "lh17s"
        let textW = width - 32 - 18 - 10
        let sh = NativeType.height(searchButton.label, width: textW, line: mt.line(sFont))
        let searchH = max(searchMin, sh)
        searchButton.frame = CGRect(x: x, y: y, width: width, height: searchH)
        searchButton.label.frame = CGRect(x: 16 + 18 + 10, y: (searchH - sh) / 2, width: textW, height: sh)
        searchIcon.frame = CGRect(x: 16, y: (searchH - 18) / 2, width: 18, height: 18)
        for v in [searchMarker, slotMarker] { v.frame = searchButton.frame }
        y += searchH
        // 块：练习范围（离搜索 18）/ 今日练习（26）
        func blockGap(_ first: Bool = false) -> CGFloat { ax ? (first ? 8 : 10) : (first ? 18 : 26) }
        func startBlock(_ i: Int, gap: CGFloat) { y += gap; blockLines[i].frame = CGRect(x: x, y: y, width: width, height: hair); blockLines[i].backgroundColor = color("line"); y += hair }
        startBlock(0, gap: blockGap(true))
        y += layoutRow(rangeRow, x: x, y: y, width: width, minH: 56, two: false, hair: hair)
        startBlock(1, gap: blockGap())
        y += layoutRow(todayRow, x: x, y: y, width: width, minH: ax ? 56 : 64, two: true, hair: hair)
        // 失败三段式
        if failed {
            y += mt.space(3)
            let failTop = y
            let noteH = ShiziParagraph.place(failNote, t("X-HOME.startFailed"), font: mt.font(15), color: color("ink2"), line: mt.line("lh15"), x: x, y: y, width: width)
            y += noteH + mt.space(1) + mt.space(2)
            let cw = ceil(NativeType.titleWidth(failCancel)) + 8
            let ch = max(mt.hit, ax ? ceil(1.3 * mt.value("fs15")) + 12 : 0)
            failCancel.frame = CGRect(x: x - 4, y: y, width: cw, height: ch)
            y += ch + mt.space(2)
            let bh = mt.value("btn-h")
            failRetry.frame = CGRect(x: x, y: y, width: width, height: bh)
            y += bh
            failMarker.frame = CGRect(x: x, y: failTop, width: width, height: y - failTop)
        }
        // 已练汉字 N + 全部 ›
        y += ax ? 10 : 26
        let hy = y
        let ht = NativeType.height(headingLabel, width: width, line: mt.line("lh17s"))
        let hw = ceil(NativeType.width(headingLabel))
        let cw2 = ceil(NativeType.width(countLabel))
        let gap = ax ? CGFloat(2) : mt.space(2)
        let btnText = ceil(NativeType.titleWidth(allButton))
        let btnH = ax ? max(mt.hit, ceil(1.3 * mt.value("fs11")) + 12) : mt.hit
        let rowH = max(ax ? 0 : 32, btnH) + (ax ? 0 : mt.space(1))
        let inner = rowH - (ax ? 0 : mt.space(1))
        headingLabel.frame = CGRect(x: x, y: hy + (inner - ht) / 2, width: hw, height: ht)
        let lh15 = mt.line("lh15")
        countLabel.frame = CGRect(x: x + hw + gap, y: hy + (inner - lh15) / 2, width: cw2, height: lh15)
        if ax {
            // margin-left:auto 把按钮推到右缘；放不下时（AX5）紧跟在数后面，伸出页边
            allButton.frame = CGRect(x: max(x + hw + gap + cw2 + gap, x + width - btnText), y: hy, width: btnText, height: btnH)
        } else {
            let bw = btnText + 8
            allButton.frame = CGRect(x: x + width + 4 - bw, y: hy, width: bw, height: btnH)
        }
        writtenMarker.frame = CGRect(x: x, y: hy, width: width, height: rowH)
        y += rowH
        // 三档（块顶线 + 三行）
        blockLines[2].frame = CGRect(x: x, y: y, width: width, height: hair); blockLines[2].backgroundColor = color("line"); y += hair
        for row in zoneRows { y += layoutRow(row, x: x, y: y, width: width, minH: 56, two: false, hair: hair) }
        // 已跳过
        let skipTop = y + (ax ? 10 : 26)
        y = skipTop
        blockLines[3].frame = CGRect(x: x, y: y, width: width, height: hair); blockLines[3].backgroundColor = color("line"); y += hair
        y += layoutRow(skippedRow, x: x, y: y, width: width, minH: 56, two: false, hair: hair)
        skippedMarker.frame = CGRect(x: x, y: skipTop, width: width, height: y - skipTop)
        homeMarker.frame = CGRect(x: x, y: homeTop, width: width, height: y - homeTop)
        return y
    }

    /// 排一行（flex 行：名称 / 值 / 样字 / chevron，AX 档名称与值上下排）。返回行高。
    private func layoutRow(_ row: Row, x: CGFloat, y: CGFloat, width: CGFloat, minH: CGFloat, two: Bool, hair: CGFloat) -> CGFloat {
        let mt = metrics
        let ax = axLayout
        let gapX = mt.space(2)
        let lh17 = mt.line("lh17s"), lh15 = mt.line("lh15")
        // 今日练习行（名称 + 小字两行）的上移量：见 todayCapShift 的说明
        let capShift: CGFloat = row.hasCap ? Self.todayCapShift(mt) : 0
        let tappable = !row.zeroMode
        let nameL = tappable ? row.button.label : row.zeroName
        let countL: UILabel? = tappable ? (row.role == .count ? row.button.valueLabel : nil) : row.zeroCount
        let valueL: UILabel? = tappable && row.role == .value ? row.button.valueLabel : nil
        // 名称：两段（今日练习）按文字量宽高；单行取自然宽
        let nameW0 = ceil(NativeType.width(nameL))
        var rowH = minH
        let chevW: CGFloat = tappable ? 8 : 0
        if ax {
            // flex-wrap：第一行 名称（+ 数），第二行 值（整行、左对齐）；右内边距 30 给 chevron
            let avail = width - (tappable ? 30 : 0)
            let nameH = NativeType.height(nameL, width: avail, line: lh17)
            let nw = min(avail, nameW0)
            var firstH = nameH
            var cw: CGFloat = 0
            if let c = countL { cw = ceil(NativeType.width(c)); firstH = max(firstH, lh15) }
            var contentH = firstH
            var vh: CGFloat = 0
            if let v = valueL { vh = NativeType.height(v, width: avail, line: lh15); contentH += vh }
            rowH = max(minH, contentH + hair)
            let top: CGFloat = contentH + hair < minH ? (minH - hair - contentH) / 2 : 0
            nameL.frame = CGRect(x: 0, y: top + (firstH - nameH) / 2, width: nw, height: nameH)
            if let c = countL { c.frame = CGRect(x: nw + mt.space(3), y: top + (firstH - lh15) / 2, width: cw, height: lh15) }
            if let v = valueL { v.frame = CGRect(x: 0, y: top + firstH, width: avail, height: vh) }
            if tappable {
                let chevY = (rowH - hair) / 2 - 6.5
                row.chevron.frame = CGRect(x: width - 8, y: chevY, width: 8, height: 13)
            }
        } else {
            var rightEdge = width - (tappable ? chevW + gapX : 0)
            let sampleSide = (tappable && !row.samples.isEmpty) ? row.samples[0].bounds.width : 0
            if !row.samples.isEmpty {
                // 样字组：右缘 = chevron 左边 − 间距；每枚 34，间距 s1；右外边距 2
                let n = CGFloat(row.samples.count)
                let groupW = n * sampleSide + (n - 1) * mt.space(1)
                let right = rightEdge - 2
                var sx = right - groupW
                for s in row.samples {
                    s.frame = CGRect(x: sx, y: 0, width: sampleSide, height: sampleSide)
                    sx += sampleSide + mt.space(1)
                }
                rightEdge = right - groupW
            }
            // 值（右对齐）：最多占剩下的（名称让出）
            var vw: CGFloat = 0, vh: CGFloat = 0
            if let v = valueL {
                vw = min(ceil(NativeType.width(v)), max(0, rightEdge - gapX - 40))
                vh = NativeType.height(v, width: vw, line: lh17)
            }
            let nameMax = max(0, width - (tappable ? chevW + gapX : 0) - (vw > 0 ? vw + gapX : 0))
            let nw = min(nameMax, nameW0)
            let nameH = NativeType.height(nameL, width: nw, line: lh17)
            var cw: CGFloat = 0
            if let c = countL { cw = ceil(NativeType.width(c)) }
            var contentH = max(nameH, vh, sampleSide)
            if countL != nil { contentH = max(contentH, lh15) }
            if two { contentH = max(contentH, nameH) }
            rowH = max(minH, contentH + hair)
            let inner = rowH - hair
            nameL.frame = CGRect(x: 0, y: (inner - nameH) / 2 - capShift, width: nw, height: nameH)
            if let c = countL { c.frame = CGRect(x: nw + gapX, y: (inner - lh15) / 2, width: cw, height: lh15) }
            if let v = valueL { v.frame = CGRect(x: rightEdge - vw, y: (inner - vh) / 2, width: vw, height: vh) }
            for s in row.samples { s.frame.origin.y = (inner - sampleSide) / 2 }
            if tappable {
                row.chevron.frame = CGRect(x: width - 8, y: (inner - 13) / 2, width: 8, height: 13)
            }
        }
        row.button.frame = CGRect(x: x, y: y, width: width, height: rowH)
        row.zero.frame = row.button.frame
        row.line.frame = CGRect(x: x, y: y + rowH - hair, width: width, height: hair)
        return rowH
    }

    // MARK: 小东西

    /// 被点的这一行此刻在窗口里的矩形（D62：写字页进场的来源；网页据此记成普通推入，不是纸展开）。
    /// 这一行是普通行（没有实心底），所以不带字（网页那边纸来源的字只对实心来源有意义）。
    private func source(_ v: UIView) -> [String: Any] {
        let r = v.convert(v.bounds, to: nil)
        return ["rect": ["x": r.minX, "y": r.minY, "w": r.width, "h": r.height], "label": "", "radius": 0, "solid": false]
    }

    /// 今日练习行（名称 + 小字两行）整体上移的量（pt）。
    ///
    /// 网页那一块的文字框是**字体内容区**（升部 + 降部，Range.getClientRects），不是行盒：名称那行的内容区与行盒几乎同高
    /// （字阶 17 的 lh17s 就是按内容区取的），小字那行矮一截（行高 lh13 − 内容区高 = 半行距）。两行的并集因此比行盒矮，
    /// 网页那一块的中线比「行盒中线」高 (lh13 − 内容区高) / 4（两行各出一半）。
    /// 原生按行盒排（字号、行距、位置与网页一致），把这一块整体上移同样的量，两行文字并集的中线与网页一致
    /// （QA-H1 逐屏对比：字库 · 今日练习行，XXXL 档原来差 1.5pt）。
    /// 内容区高按网页的苹方 SC 量：字号 × 1.267（实测 fs13 → 16.5、fs15 → 19）。
    private static func todayCapShift(_ mt: ShiziMetrics) -> CGFloat {
        (mt.line("lh13") - mt.value("fs13") * 1.267) / 4
    }

    private func tabular(_ f: UIFont) -> UIFont {
        let d = f.fontDescriptor.addingAttributes([.featureSettings: [[UIFontDescriptor.FeatureKey.type: kNumberSpacingType, UIFontDescriptor.FeatureKey.selector: kMonospacedNumbersSelector]]])
        return UIFont(descriptor: d, size: f.pointSize)
    }

    private static func clear(_ size: CGSize) -> UIImage {
        let fmt = UIGraphicsImageRendererFormat.preferred()
        fmt.opaque = false
        return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in }.withRenderingMode(.alwaysOriginal)
    }

    /// 网页 Icons.search（22 栅格画成 18：圆 cx10 cy10 r6 + 斜线；线宽 1.5 同比缩放，圆端）。
    private static func searchIcon(_ c: UIColor) -> UIImage {
        let side: CGFloat = 18
        let k = side / 22
        let fmt = UIGraphicsImageRendererFormat.preferred()
        fmt.opaque = false
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: fmt).image { _ in
            let p = UIBezierPath(arcCenter: CGPoint(x: 10 * k, y: 10 * k), radius: 6 * k, startAngle: 0, endAngle: .pi * 2, clockwise: true)
            p.move(to: CGPoint(x: 14.5 * k, y: 14.5 * k))
            p.addLine(to: CGPoint(x: 18.5 * k, y: 18.5 * k))
            p.lineWidth = 1.5 * k
            p.lineCapStyle = .round
            p.lineJoinStyle = .round
            c.setStroke()
            p.stroke()
        }.withRenderingMode(.alwaysOriginal)
    }

    private static func simd(_ c: UIColor, _ trait: UITraitCollection) -> SIMD4<Float> {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.resolvedColor(with: trait).getRed(&r, green: &g, blue: &b, alpha: &a)
        return SIMD4(Float(r), Float(g), Float(b), Float(a))
    }

    // 根页没有返回：「‹」/ 左缘 / 两指 Z 形都不动作
    override func requestBack() {}
    override func accessibilityPerformEscape() -> Bool { false }
    override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool { false }
}
