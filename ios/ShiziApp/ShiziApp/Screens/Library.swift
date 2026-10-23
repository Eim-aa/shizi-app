import UIKit

// B3.5b 字库 tab 根页（网页 src/ui/screens/library/index.js「字库方向四」，1:1 移植；视图模型 src/session/views/library.js libraryPageView，App API view.library）。
// 屏名 ⇄ 类：library ⇄ ShiziScreen_library。tab 根页：没有「‹」，大标题「字库」（网页 TabPage），内容竖向滚动；整页压在窗口最上层（Tab 栏由 B3.5d 的原生 Tab 栏接手）。
// 只读页：不写 store。「今日练习」= op library.startToday（首页主按钮同一动作，D07 失败就地三段式）；搜索框 = 让给网页的查字弹层（原生查字弹层 B3.6 之前）；
// 其余行（练习范围 / 全部 / 三档 / 已跳过）= nav.push（目标屏还是网页屏：NativeStage 先把本页的样子交给宿主层再让开，回来时按原样盖回）。
// root-pending（rootPending = true）：Swift 一侧不把 'library' 放进注入网页的原生屏清单，网页照旧画自己的字库；B3.5d 三个根页同开时去掉。
// 版式按网页 CSS 逐项排（library/index.js 的 .sz-libr__* / .sz-libq / Page.js .sz-tabpage），数值取 ShiziTokens，文案取视图模型给的引用。

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
final class LibraryScreen: ShiziScreenViewController {
    struct Route: Decodable { let screen: String; let params: [String: String]? }
    struct Sample: Decodable { let char: String; let tone: Int; let strokes: [[[Double]]]? }
    struct Zone: Decodable { let kind: String; let name: ShiziCopyRef; let n: Int; let to: Route?; let samples: [Sample] }
    struct View: Decodable {
        struct Search: Decodable { let placeholder: ShiziCopyRef }
        struct Range: Decodable { let label: ShiziCopyRef; let value: ShiziCopyRef; let to: Route }
        struct Today: Decodable { let label: ShiziCopyRef; let phase: String; let n: Int; let value: ShiziCopyRef; let sub: ShiziCopyRef? }
        struct Written: Decodable { let heading: ShiziCopyRef; let count: Int; let all: ShiziCopyRef; let allAria: ShiziCopyRef; let to: Route }
        struct SampleSpec: Decodable { let side: Double; let inkSide: Double; let inkScale: Double }
        let state: String
        let title: ShiziCopyRef
        let search: Search
        let range: Range
        let todayRow: Today
        let written: Written
        let zones: [Zone]
        let skipped: Zone
        let sample: SampleSpec
    }

    override class var rootPending: Bool { true }

    // 行：可点（按钮）与 0 个字（不可点，只写名称与 0）两种样子共用一个对象
    final class Row {
        let button = ShiziRowButton(type: .custom)
        let zero = UIView()
        let zeroName = UILabel()
        let zeroCount = UILabel()
        let line = UIView()
        let chevron = UIImageView()
        var samples: [UIView] = []
        var zeroMode = false
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

    private var foregroundObserver: NSObjectProtocol?

    deinit {
        if let foregroundObserver { NotificationCenter.default.removeObserver(foregroundObserver) }
    }

    // MARK: 构建

    override func viewDidLoad() {
        super.viewDidLoad()
        backButton.isHidden = true
        // 大标题在滚动内容里（网页 .sz-tabpage__title），不是固定页头
        titleLabel.removeFromSuperview()
        titleLabel.accessibilityIdentifier = "native-page-title"
        titleLabel.numberOfLines = 0
        content.addSubview(titleLabel)
        let ids: [(UIView, String)] = [
            (homeMarker, "native-library-home"), (searchMarker, "native-library-search"), (slotMarker, "native-library-query-slot"),
            (writtenMarker, "native-library-written"), (skippedMarker, "native-library-skipped-block"), (failMarker, "native-library-today-fail"),
        ]
        for (v, id) in ids {
            v.accessibilityIdentifier = id
            v.isUserInteractionEnabled = false
            content.addSubview(v)
        }
        blockLines.forEach { content.addSubview($0) }
        searchButton.accessibilityIdentifier = "native-library-query-open"
        content.addSubview(searchButton)
        wire(searchButton) { page in (page as? LibraryScreen)?.openQuery() }
        LibPress.attach(searchButton)
        let rowIds = ["native-library-range", "native-library-today", "native-library-zone", "native-library-zone", "native-library-zone", "native-library-skipped"]
        for (row, id) in zip(allRows, rowIds) {
            row.button.accessibilityIdentifier = id
            row.zero.accessibilityIdentifier = id
            let base = id.replacingOccurrences(of: "native-library-", with: "")
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
        renderNow2()
    }

    private func renderNow2() { if let v = lastView { try? render(view: v) } }

    // MARK: 回包

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: View.self)
        model = m
        // 样字墨迹的参数表（库首页不经写字会话，随视图带来；WebInkParams.current 是画墨接口的参数来源）
        if let k = WebInkParams((raw as? [String: Any])?["ink"]) { WebInkParams.current = k }
        guard isViewLoaded else { return }
        let mt = metrics
        let ax = axLayout
        // 大标题（宋 28 / 500，行高 lh28）
        NativeType.set(titleLabel, m.title.text, font: NativeType.song(size: mt.value("fs28"), weight: .medium), color: color("ink1"), line: mt.line("lh28"))
        ShiziFonts.untrack(titleLabel)
        titleLabel.accessibilityLabel = m.title.text
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
        searchButton.setImage(Self.searchIcon(color("ink2")), for: .normal)
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
        // 三档与已跳过
        for (row, z) in zip(zoneRows, m.zones) { configure(row, zone: z, tone: m.sample) }
        configure(skippedRow, zone: m.skipped, tone: m.sample)
        renderFail()
        view.setNeedsLayout()
    }

    private func configure(_ row: Row, zone z: Zone, tone spec: View.SampleSpec) {
        let name = z.name.text
        let glyphChars = z.samples.filter { ($0.strokes ?? []).isEmpty }.map(\.char)
        // 读屏名（网页：名称、数、无墨迹样字的字——轮廓字形里放一份视觉隐藏的字）
        let aria = ([name, String(z.n)] + (z.n > 0 ? glyphChars : [])).joined(separator: " ")
        configure(row, name: name, value: nil, cap: nil, count: String(z.n), zone: z, aria: aria, tappable: z.n > 0, spec: spec)
    }

    private func configure(_ row: Row, name: String, value: String?, cap: String?, count: String?, zone: Zone?, aria: String, tappable: Bool, spec: View.SampleSpec? = nil) {
        let mt = metrics
        let ax = axLayout
        row.zeroMode = !tappable
        row.button.isHidden = !tappable
        row.zero.isHidden = tappable
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
            // chevron（单画；按钮的图像只用来报「图标」框，位置在 layout 里定）
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
                        let g = NativeGlyphView(frame: box.bounds)
                        g.char = s.char
                        g.color = c
                        g.isUserInteractionEnabled = false
                        box.addSubview(g)
                        box.tag = 1 // 轮廓字形样字（网页是 svg：按钮的「图标」取第一枚 svg）
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

    // MARK: 动作

    private func go(_ route: Route?) {
        guard let route else { return }
        push(route.screen, params: route.params ?? [:])
    }

    /// 搜索框：让给网页的查字弹层（原生查字弹层 B3.6 之前）。
    private func openQuery() {
        guard let stage, stage.isTop(self) else { return }
        stage.yieldToWeb(from: self) { [weak stage] in
            stage?.engine.raw("library.openQuery", [:]) { _ in }
        }
    }

    /// 今日练习：op library.startToday（网页路由开写字页 / 没字页）。失败就地三段式，页面不动；成功后写字页盖上来，本页让开（回来时按原样盖回）。
    private func startToday() {
        guard let stage, stage.isTop(self), !starting else { return }
        starting = true
        stage.engine.raw("library.startToday", [:]) { [weak self, weak stage] reply in
            guard let self, let stage else { return }
            self.starting = false
            if (reply["ok"] as? Bool) == true {
                if self.failed { self.failed = false; self.renderFail(); self.view.setNeedsLayout() }
                if stage.isTop(self) { stage.yieldToWeb(from: self) {} }
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
        let w = view.bounds.width
        guard w > 0 else { return }
        let m = metrics
        backButton.isHidden = true
        scroll.frame = view.bounds
        let bottom = layoutBody(width: w - 2 * m.gutter, x: m.gutter, top: view.safeAreaInsets.top + m.space(4))
        let contentH = bottom + m.space(axLayout ? 2 : 8) // 网页 :root[data-ax] .sz-tabpage 下内边距收到 s2
        content.frame = CGRect(x: 0, y: 0, width: w, height: contentH)
        scroll.contentSize = CGSize(width: w, height: contentH)
        screenMarker.frame = CGRect(x: 0, y: 0, width: w, height: contentH)
    }

    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat {
        guard model != nil else { return top }
        let mt = metrics
        let ax = axLayout
        let scale = view.window?.screen.scale ?? UIScreen.main.scale
        let hair = 1 / scale // 网页 0.5px 的边框按设备像素取整 = 1 个设备像素
        // 标题
        let titleH = NativeType.height(titleLabel, width: width, line: mt.line("lh28"))
        titleLabel.frame = CGRect(x: x, y: top, width: width, height: titleH)
        var y = top + titleH + (ax ? 6 : 8)
        let homeTop = y
        // 搜索框
        let searchMin: CGFloat = ax ? 56 : 48
        let sFont = ax ? "lh13" : "lh17s"
        let textW = width - 32 - 18 - 10
        let sh = NativeType.height(searchButton.label, width: textW, line: mt.line(sFont))
        let searchH = max(searchMin, sh)
        searchButton.frame = CGRect(x: x, y: y, width: width, height: searchH)
        searchButton.label.frame = CGRect(x: 16 + 18 + 10, y: (searchH - sh) / 2, width: textW, height: sh)
        searchButton.iconFrame = CGRect(x: 16, y: (searchH - 18) / 2, width: 18, height: 18)
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
                row.button.iconFrame = row.chevron.frame
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
            nameL.frame = CGRect(x: 0, y: (inner - nameH) / 2, width: nw, height: nameH)
            if let c = countL { c.frame = CGRect(x: nw + gapX, y: (inner - lh15) / 2, width: cw, height: lh15) }
            if let v = valueL { v.frame = CGRect(x: rightEdge - vw, y: (inner - vh) / 2, width: vw, height: vh) }
            for s in row.samples { s.frame.origin.y = (inner - sampleSide) / 2 }
            if tappable {
                row.chevron.frame = CGRect(x: width - 8, y: (inner - 13) / 2, width: 8, height: 13)
                // 网页：按钮的「图标」取第一枚 svg——样字是轮廓字形（svg）时是第一枚样字，否则是 chevron
                if let first = row.samples.first, first.tag == 1 { row.button.iconFrame = first.frame } else { row.button.iconFrame = row.chevron.frame }
            }
        }
        row.button.frame = CGRect(x: x, y: y, width: width, height: rowH)
        row.zero.frame = row.button.frame
        row.line.frame = CGRect(x: x, y: y + rowH - hair, width: width, height: hair)
        return rowH
    }

    // MARK: 小东西

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
