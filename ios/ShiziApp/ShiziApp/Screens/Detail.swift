import UIKit

// B3.7：单字详情（网页 src/ui/screens/detail/index.js + records.js + actions.js，1:1 移植；视图模型 src/session/views/detail.js，App API view.detail / detail.*）。
// 屏名 ⇄ 类：detail ⇄ ShiziScreen_detail（旧记录页 detail-photo ⇄ DetailPhoto.swift；放大弹层 DetailZoom.swift）。
// 页面不持有业务状态：视图（open 回包 / changed 重拉）给文案引用 + 笔画；页内临时状态（撤销条、换词横幅、三段式失败）是本页自己的，
// 寿命到离开这一页（网页 useLeave：本页不再是最上层页面即失效；放大弹层不算离开）。
// 写入全部经 App API 的 detail.* op（现有提交函数的薄包装，D07：失败回 {ok:false, error:{kind}}，就地三段式）。
// 版式按网页 CSS 逐项排（records.js / index.js / actions.js 的 .sz-d*），数值全部取 ShiziTokens，文案取视图模型给的引用。

// MARK: - 视图（Codable）

struct DetailMaybeRef: Decodable {
    let ref: ShiziCopyRef?
    init(from decoder: Decoder) throws { ref = try? decoder.singleValueContainer().decode(ShiziCopyRef.self) }
    var text: String { ref?.text ?? "" }
}

struct DetailView: Decodable {
    struct Strokes: Decodable { let n: Int; let label: ShiziCopyRef }
    struct Tile: Decodable { let ch: String; let blank: Bool }
    struct Word: Decodable { let hasWord: Bool; let label: ShiziCopyRef; let text: String; let tiles: [Tile]; let gloss: String }
    struct HeroCell: Decodable {
        let kind: String; let title: ShiziCopyRef; let changeable: Bool; let recordId: String; let judgment: String; let wrong: Bool; let hasInk: Bool; let strokes: [[[Double]]]
        let caption: ShiziCopyRef; let aria: ShiziCopyRef
    }
    struct Hero: Decodable { let kind: String; let cells: [HeroCell] }
    struct Cell: Decodable {
        let recordId: String; let title: ShiziCopyRef; let changeable: Bool; let judgment: String; let wrong: Bool; let hasInk: Bool; let strokes: [[[Double]]]
        let date: DetailMaybeRef; let caption: ShiziCopyRef; let aria: ShiziCopyRef
    }
    struct PaperRow: Decodable { let recordId: String; let date: DetailMaybeRef; let caption: ShiziCopyRef; let tag: ShiziCopyRef; let label: ShiziCopyRef }
    struct Records: Decodable { let count: Int; let countLabel: ShiziCopyRef; let empty: ShiziCopyRef?; let cells: [Cell]; let paperRows: [PaperRow] }
    struct Source: Decodable { let label: ShiziCopyRef; let gloss: String; let from: String }
    struct To: Decodable { let screen: String }
    struct Row: Decodable {
        let key: String; let kind: String?; let state: String?; let title: ShiziCopyRef; let sub: ShiziCopyRef?; let note: ShiziCopyRef?; let to: To?
    }
    let char: String
    let title: ShiziCopyRef
    let practicable: Bool
    let practice: ShiziCopyRef
    let pinyin: String
    let strokes: Strokes?
    let word: Word?
    let originalWord: String
    let hero: Hero
    let refLabel: ShiziCopyRef
    let records: Records
    let source: Source?
    let rows: [Row]
    let custom: Bool
}

/// 桥上的紧凑笔画 → 原始点。
func detailRawStrokes(_ s: [[[Double]]]) -> [[InkRawPoint]] {
    s.map { stroke in
        stroke.compactMap { r in
            guard r.count >= 3 else { return nil }
            var q = InkRawPoint(x: r[0], y: r[1], t: r[2])
            if r.count > 3, r[3] > 0 { q.p = r[3] }
            return q
        }
    }
}

/// 网页 layout.js minInkScale：小卡的墨抬到最小物理线宽 1.2pt（345 单位格、默认笔宽 11.5）。
func detailInkScale(_ side: CGFloat) -> Double {
    guard side > 0 else { return 1 }
    let physical = 11.5 * Double(side) / 345
    return physical >= 1.2 ? 1 : 1.2 / physical
}

/// 墨色（令牌 hand）。
func detailInkColor(_ trait: UITraitCollection) -> SIMD4<Float>? {
    NativeInkWire.parseColor(ShiziTokens.colorStrings(ShiziTokens.Theme.of(nil, trait: trait))["hand"])
}

/// 楷体文字（网页 --kai：宋 / 楷的字不补苹方字距、含全角标点也不换成苹方；行盒钉成网页行高，字在行盒里居中）。
func detailKaiText(_ l: UILabel, _ text: String, font: UIFont, color: UIColor, line: CGFloat) {
    let p = NSMutableParagraphStyle()
    p.minimumLineHeight = line
    p.maximumLineHeight = line
    var attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: p, .kern: 0]
    attrs[.baselineOffset] = (line - font.lineHeight) / 4
    l.attributedText = NSAttributedString(string: text, attributes: attrs)
}

func detailTabular(_ f: UIFont) -> UIFont {
    let d = f.fontDescriptor.addingAttributes([.featureSettings: [[UIFontDescriptor.FeatureKey.type: kNumberSpacingType, UIFontDescriptor.FeatureKey.selector: kMonospacedNumbersSelector]]])
    return UIFont(descriptor: d, size: f.pointSize)
}

/// 一个设备像素的发丝线（网页 0.5pt 边在 3x 屏上落成 1 个设备像素 = 1/3pt）。
func detailHair(_ token: CGFloat) -> CGFloat {
    let s = UIScreen.main.scale
    return max(1 / s, floor(token * s) / s)
}

// MARK: - 小部件

/// 一格带框的方（网页 .sz-compare__card / .sz-dhero__sq：笺底 + 格框，里面放墨 / 衬底字 / 参考字）。
final class DetailSquare: UIView {
    var glyph: NativeGlyphView?
    var ink: UIView?
    var inkSide: CGFloat = 0
    var emptyLabel: UILabel?

    func configure(sheet: UIColor, frame frameColor: UIColor, borderWidth: CGFloat) {
        backgroundColor = sheet
        layer.borderWidth = borderWidth
        layer.borderColor = frameColor.cgColor
        clipsToBounds = true
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let inner = bounds.insetBy(dx: layer.borderWidth, dy: layer.borderWidth)
        ink?.frame = inner
        glyph?.frame = glyph.map { _ in inner } ?? .zero
    }
}

/// 圆点（网页 .sz-dhero__dot / .sz-drow__dot / .sz-dcell__cap::before：直径 6、朱色）。
final class DetailDot: UIView {
    init(color: UIColor) {
        super.init(frame: CGRect(x: 0, y: 0, width: 6, height: 6))
        backgroundColor = color
        layer.cornerRadius = 3
        isUserInteractionEnabled = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}

/// 页内撤销条（网页 UndoBar.js：两行说明 + 「撤销」；撤销后「已撤销」收起）。L4 浮条外观取令牌 toast-*。
final class DetailUndoBar: UIView {
    let line1 = UILabel()
    let line2 = UILabel()
    let undoButton = NativeTextButton(type: .custom)
    private let metrics: ShiziMetrics
    private let fg: UIColor
    var onUndo: (() -> Void)?
    private(set) var done = false

    init(metrics: ShiziMetrics, color: (String) -> UIColor) {
        self.metrics = metrics
        fg = color("toast-fg")
        super.init(frame: .zero)
        backgroundColor = color("toast-bg")
        layer.cornerRadius = metrics.value("r-box")
        layer.cornerCurve = .continuous
        layer.borderWidth = 1
        layer.borderColor = color("toast-line").cgColor
        if let sh = NativeInkWire.shadow(ShiziTokens.colorStrings(ShiziTokens.Theme.of(nil, trait: .current))["toast-shadow"]) {
            layer.shadowColor = sh.color.withAlphaComponent(1).cgColor
            layer.shadowOpacity = Float(sh.color.cgColor.alpha)
            layer.shadowOffset = CGSize(width: sh.dx, height: sh.dy)
            layer.shadowRadius = sh.blur / 2
        }
        for l in [line1, line2] { l.numberOfLines = 0; addSubview(l) }
        undoButton.titleLabel?.font = metrics.font(15, .medium)
        undoButton.setTitleColor(color("toast-act"), for: .normal)
        undoButton.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
        undoButton.addAction(UIAction { [weak self] _ in self?.onUndo?() }, for: .touchUpInside)
        addSubview(undoButton)
        accessibilityIdentifier = "native-detail-undo-bar"
        undoButton.accessibilityIdentifier = "native-detail-undo-button"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func set(text1: String, text2: String?, undo: String, done isDone: Bool) {
        done = isDone
        let mt = metrics
        NativeType.set(line1, text1, font: mt.font(15), color: fg, line: mt.line("lh15"))
        NativeType.set(line2, text2, font: mt.font(15), color: fg, line: mt.line("lh15"))
        line2.isHidden = text2 == nil
        undoButton.setTitle(undo, for: .normal)
        undoButton.isHidden = isDone
        NativeType.trackTitle(undoButton)
        accessibilityElements = [line1, line2, undoButton].filter { !$0.isHidden }
        setNeedsLayout()
    }

    private var buttonW: CGFloat { done ? 0 : NativeType.titleWidth(undoButton) + 8 }
    private var buttonH: CGFloat { max(44, metrics.value("hit")) }

    func height(for width: CGFloat) -> CGFloat {
        let mt = metrics
        let inner = max(0, width - 16 - 8 - 2)
        let tw = max(60, inner - (done ? 0 : 12 + buttonW))
        let h1 = NativeType.height(line1, width: tw, line: mt.line("lh15"))
        let h2 = line2.isHidden ? 0 : NativeType.height(line2, width: tw, line: mt.line("lh15"))
        return max(48, max(h1 + h2, done ? 0 : buttonH) + 16 + 2)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if layer.shadowOpacity > 0 { layer.shadowPath = UIBezierPath(roundedRect: bounds, cornerRadius: layer.cornerRadius).cgPath }
        let mt = metrics
        let inner = max(0, bounds.width - 16 - 8 - 2)
        let tw = max(60, inner - (done ? 0 : 12 + buttonW))
        let h1 = NativeType.height(line1, width: tw, line: mt.line("lh15"))
        let h2 = line2.isHidden ? 0 : NativeType.height(line2, width: tw, line: mt.line("lh15"))
        let textH = h1 + h2
        let top = (bounds.height - textH) / 2
        // 两行各自取最宽那行的宽（网页两个 span 在列 flex 里同宽）
        let w = min(tw, max(ceil(NativeType.width(line1)), line2.isHidden ? 0 : ceil(NativeType.width(line2))))
        line1.frame = CGRect(x: 17, y: top, width: w, height: h1)
        line2.frame = CGRect(x: 17, y: top + h1, width: w, height: h2)
        if !undoButton.isHidden {
            undoButton.frame = CGRect(x: bounds.width - 1 - 8 - buttonW, y: (bounds.height - buttonH) / 2, width: buttonW, height: buttonH)
        }
    }
}

// MARK: - 页面

@objc(ShiziScreen_detail)
final class DetailScreen: ShiziScreenViewController {
    // 页内临时状态（寿命到离开这一页）
    enum BarState { case on, failed, done }
    private var undoState: (removed: [String: Any], state: BarState)?
    private var banner: (word: String, state: BarState)?
    private var swapFailed = false, removeFailed = false, addFailed = false, practiceFailed = false
    private var busy = false

    private var model: DetailView?
    private var char: String { (params["char"] as? String) ?? "" }

    // 动态子视图（render 时重建）
    private var dynamic: [UIView] = []
    private let cardMarker = UIView(), heroMarker = UIView(), recordsMarker = UIView(), cellsMarker = UIView(), sourceMarker = UIView(), rowsMarker = UIView()
    private let wordMarker = UIView()
    private var heroButtons: [ShiziRowButton] = []
    private var heroSquares: [DetailSquare] = []
    private var heroDots: [DetailDot?] = []
    private var heroCells: [DetailView.HeroCell] = []
    private var bigRef: DetailSquare?
    private var smallRef: DetailSquare?
    private let pinyinLabel = UILabel(), strokesLabel = UILabel(), wordLabel = UILabel(), glossLabel = UILabel()
    private var tileViews: [UIView] = []
    private var tileGlyphs: [NativeGlyphView] = []
    private let countLabel = UILabel(), emptyLabel = UILabel()
    private var cellButtons: [ShiziRowButton] = []
    private var cellSquares: [DetailSquare] = []
    private var cellDots: [DetailDot?] = []
    private var cellSr: [Bool] = []
    private var paperViews: [(row: UIView, sr: UILabel, date: UILabel, cap: UILabel)] = []
    private let paperTop = UIView()
    private let sourceLabel = UILabel(), sourceText = UILabel(), sourceFrom = UILabel()
    private var rowItems: [DetailRowItem] = []
    private let rowsTopLine = UIView()
    private let live = UILabel()

    // 底栏
    private let footer = UIView()
    private let practiceButton = UIButton(type: .custom)
    private let practiceNote = UILabel()
    private let practiceCancel = NativeTextButton(type: .custom)
    private var wordBar: DetailUndoBar?
    private let bannerMarker = UIView()
    private var customBar: DetailUndoBar?
    private var footerHeight: CGFloat = 0
    private var barTimer: Timer?
    #if DEBUG
    private let qaScrollRemove = UIButton(type: .custom), qaScrollLegacy = UIButton(type: .custom), qaFlip = UIButton(type: .custom)
    #endif

    override var axLayout: Bool { false }
    private var isAX: Bool { metrics.category.isAccessibilityCategory }
    override var watchedDomains: [String]? { ["records", "ink", "sched", "custom", "wordOff", "photos", "sessions", "settings"] }

    // MARK: 生命周期

    override func viewDidLoad() {
        for (v, id) in [(cardMarker, "card"), (heroMarker, "hero"), (recordsMarker, "records"), (cellsMarker, "cells"), (sourceMarker, "source"), (rowsMarker, "rows"), (wordMarker, "word")] {
            v.accessibilityIdentifier = "native-detail-\(id)"
            v.isUserInteractionEnabled = false
            content.addSubview(v)
        }
        pinyinLabel.accessibilityIdentifier = "native-detail-pinyin"
        strokesLabel.accessibilityIdentifier = "native-detail-strokes"
        wordLabel.accessibilityIdentifier = "native-detail-word-label"
        glossLabel.accessibilityIdentifier = "native-detail-gloss"
        glossLabel.numberOfLines = 0
        countLabel.accessibilityIdentifier = "native-detail-records-count"
        emptyLabel.accessibilityIdentifier = "native-detail-records-empty"
        emptyLabel.numberOfLines = 0
        sourceLabel.accessibilityIdentifier = "native-detail-source-label"
        sourceLabel.numberOfLines = 0
        sourceText.accessibilityIdentifier = "native-detail-source-text"
        sourceText.numberOfLines = 0
        sourceFrom.accessibilityIdentifier = "native-detail-source-from"
        sourceFrom.numberOfLines = 0
        for l in [pinyinLabel, strokesLabel, wordLabel, glossLabel, countLabel, emptyLabel, sourceLabel, sourceText, sourceFrom, rowsTopLine, paperTop] as [UIView] { content.addSubview(l) }
        live.accessibilityIdentifier = "native-detail-live"
        live.isAccessibilityElement = false
        footer.accessibilityIdentifier = "native-detail-footer"
        practiceButton.accessibilityIdentifier = "native-detail-practice"
        practiceButton.layer.cornerCurve = .continuous
        practiceButton.titleLabel?.numberOfLines = 0
        practiceButton.titleLabel?.textAlignment = .center
        practiceNote.numberOfLines = 0
        practiceCancel.accessibilityIdentifier = "native-detail-practice-fail-cancel"
        footer.addSubview(practiceNote)
        footer.addSubview(practiceCancel)
        footer.addSubview(practiceButton)
        wire(practiceButton) { page in (page as? DetailScreen)?.practice() }
        wire(practiceCancel) { page in
            guard let s = page as? DetailScreen else { return }
            s.practiceFailed = false
            s.rerender()
        }
        super.viewDidLoad()
        view.addSubview(footer)
        view.addSubview(live)
        #if DEBUG
        // QA（夹具原生步骤）：网页夹具用 scrollIntoView({block:'center'}) 把某一行滚到中间；原生用同一规则的隐形按钮（DEBUG，Release 不含）
        for (b, id, key) in [(qaScrollRemove, "native-detail-qa-scroll-remove", "remove"), (qaScrollLegacy, "native-detail-qa-scroll-legacy", "legacy")] {
            b.accessibilityIdentifier = id
            b.alpha = 0
            b.addAction(UIAction { [weak self] _ in self?.qaScroll(to: key) }, for: .touchUpInside)
            view.addSubview(b)
        }
        // 放大弹层在页面视图树之外（呈现出来的控制器），QA 点按取不到它里面的按钮：页面替它点「改为…」
        qaFlip.accessibilityIdentifier = "native-detail-qa-flip"
        qaFlip.alpha = 0
        qaFlip.addAction(UIAction { [weak self] _ in (self?.presentedViewController as? DetailZoomSheet)?.apply() }, for: .touchUpInside)
        view.addSubview(qaFlip)
        #endif
    }

    #if DEBUG
    private func qaScroll(to key: String) {
        guard let item = rowItems.first(where: { $0.key == key }) else { return }
        view.layoutIfNeeded()
        let r = item.frame
        let target = r.midY - scroll.bounds.height / 2
        let maxY = max(0, scroll.contentSize.height - scroll.bounds.height)
        scroll.setContentOffset(CGPoint(x: 0, y: min(max(0, target), maxY)), animated: false)
    }
    #endif

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: DetailView.self)
        model = m
        if let k = WebInkParams((raw as? [String: Any])?["ink"]) { WebInkParams.current = k } // 画墨的参数表随视图下发（同写字页 open 的 ink）
        setTitle(m.title.text)
        titleLabel.clipsToBounds = true
        titleLabel.textColor = .clear
        rebuild(m)
    }

    private func rerender() {
        if let m = model { rebuild(m) }
        view.setNeedsLayout()
    }

    /// 离开这一页（推入别的页）：页内撤销条 / 横幅 / 失败态失效（网页 useLeave）。
    override func push(_ screen: String, params: [String: Any] = [:]) {
        clearTransient()
        super.push(screen, params: params)
    }

    private func clearTransient() {
        undoState = nil
        banner = nil
        swapFailed = false; removeFailed = false; addFailed = false; practiceFailed = false
        barTimer?.invalidate()
    }

    // MARK: 构建

    private func rebuild(_ m: DetailView) {
        dynamic.forEach { $0.removeFromSuperview() }
        dynamic = []
        heroButtons = []; heroSquares = []; heroDots = []; heroCells = m.hero.cells
        tileViews = []; tileGlyphs = []; cellButtons = []; cellSquares = []; cellDots = []; cellSr = []; paperViews = []; rowItems = []
        bigRef = nil; smallRef = nil
        let mt = metrics
        let sheet = color("sheet"), frame = color("frame"), zhu = color("zhu")
        let frameW = mt.value("frame-w")
        let ink = detailInkColor(traitCollection)
        func add<T: UIView>(_ v: T) -> T { content.addSubview(v); dynamic.append(v); return v }
        func square(_ side: CGFloat) -> DetailSquare {
            let s = add(DetailSquare())
            s.configure(sheet: sheet, frame: frame, borderWidth: frameW)
            return s
        }
        // 头图：本人墨两格 / 参考字形
        if m.hero.kind == "ink" {
            for (i, c) in m.hero.cells.enumerated() {
                let b = add(ShiziRowButton(type: .custom))
                b.accessibilityIdentifier = "native-detail-hero-cell"
                b.accessibilityLabel = c.aria.text
                b.titleLabel?.font = mt.font(15)
                b.setTitleColor(color("ink1"), for: .normal)
                let sq = add(DetailSquare())
                sq.configure(sheet: sheet, frame: frame, borderWidth: frameW)
                sq.isUserInteractionEnabled = false
                sq.accessibilityIdentifier = nil
                b.valueLabel.isHidden = true
                NativeType.set(b.label, c.caption.text, font: detailTabular(mt.font(13)), color: color("ink3"), align: .center, line: mt.line("lh13"))
                b.label.numberOfLines = 0
                if !c.hasInk {
                    let g = NativeGlyphView()
                    g.char = char
                    g.color = color("under")
                    sq.glyph = g
                    sq.addSubview(g)
                }
                heroButtons.append(b)
                heroSquares.append(sq)
                heroDots.append(c.wrong ? add(DetailDot(color: zhu)) : nil)
                _ = i
                wire(b) { page in (page as? DetailScreen)?.openZoom(cell: i) }
            }
        } else {
            let r = square(0)
            r.accessibilityIdentifier = "native-detail-ref"
            r.accessibilityLabel = m.refLabel.text
            r.isAccessibilityElement = true
            let g = NativeGlyphView()
            g.char = char
            g.color = color("ref")
            r.glyph = g
            r.addSubview(g)
            bigRef = r
        }
        // 拼音 / 笔画
        NativeType.set(pinyinLabel, m.pinyin, font: mt.font(17), color: color("ink2"), line: mt.line("lh17s"))
        pinyinLabel.isHidden = m.pinyin.isEmpty
        if let s = m.strokes {
            NativeType.set(strokesLabel, s.label.text, font: mt.font(15), color: color("ink3"), line: mt.line("lh15"))
            strokesLabel.isHidden = false
        } else { strokesLabel.isHidden = true }
        // 词语 / 释义
        wordLabel.isHidden = m.word == nil
        glossLabel.isHidden = true
        wordMarker.isHidden = true
        if let w = m.word {
            NativeType.set(wordLabel, w.label.text, font: mt.font(13), color: color("ink2"), line: mt.line("lh15"))
            if w.hasWord {
                wordMarker.isHidden = false
                wordMarker.backgroundColor = sheet
                wordMarker.layer.borderWidth = frameW
                wordMarker.layer.borderColor = frame.cgColor
                wordMarker.isAccessibilityElement = true
                wordMarker.accessibilityLabel = w.text
                wordMarker.accessibilityTraits = [.image]
                for (i, t) in w.tiles.enumerated() {
                    let tile = add(UIView())
                    tile.accessibilityIdentifier = "native-detail-word-tile"
                    tile.isUserInteractionEnabled = false
                    if t.blank {
                        tile.layer.borderWidth = mt.value("target-w")
                        tile.layer.borderColor = color("ink1").cgColor
                    }
                    let g = NativeGlyphView()
                    g.char = t.ch
                    g.color = color("ink1")
                    tile.addSubview(g)
                    tileViews.append(tile)
                    tileGlyphs.append(g)
                    _ = i
                }
            } else {
                glossLabel.isHidden = false
                detailKaiText(glossLabel, w.gloss, font: ShiziFonts.kai(size: mt.value("fs17")), color: color("ink1"), line: mt.line("lh17"))
            }
        }
        // 参考字形降为小格（写过时）
        if m.hero.kind == "ink" {
            let r = square(0)
            r.accessibilityIdentifier = "native-detail-ref"
            r.accessibilityLabel = m.refLabel.text
            r.isAccessibilityElement = true
            let g = NativeGlyphView()
            g.char = char
            g.color = color("ref")
            r.glyph = g
            r.addSubview(g)
            smallRef = r
        }
        // 记录块
        recordsMarker.isHidden = false
        NativeType.set(countLabel, m.records.countLabel.text, font: NativeType.song(size: mt.value("fs22"), weight: .medium), color: color("ink2"), line: mt.line("lh15"))
        ShiziFonts.untrack(countLabel)
        if let e = m.records.empty {
            NativeType.set(emptyLabel, e.text, font: mt.font(15), color: color("ink1"), align: .left, line: mt.line("lh15"))
            emptyLabel.isHidden = false
        } else { emptyLabel.isHidden = true }
        let heroOffset = m.hero.cells.count
        for (i, c) in m.records.cells.enumerated() {
            let b = add(ShiziRowButton(type: .custom))
            b.accessibilityIdentifier = "native-detail-cell"
            b.accessibilityLabel = c.aria.text
            b.titleLabel?.font = mt.font(15)
            b.setTitleColor(color("ink1"), for: .normal)
            b.backgroundColor = sheet
            b.layer.borderWidth = frameW
            b.layer.borderColor = frame.cgColor
            let sq = add(DetailSquare())
            sq.backgroundColor = .clear
            sq.isUserInteractionEnabled = false
            sq.layer.borderWidth = 0
            // 没有笔迹：衬底字（网页画 svg + 视觉隐藏的字：按钮的字 / 图标都带着它）
            let noInk = !c.hasInk
            cellSr.append(noInk)
            if noInk {
                let g = NativeGlyphView()
                g.char = char
                g.color = color("under")
                sq.glyph = g
                sq.addSubview(g)
                b.label.isHidden = false
                NativeType.set(b.label, char, font: UIFont.systemFont(ofSize: 1), color: .clear, line: nil)
            } else {
                b.label.isHidden = true
                b.label.text = nil
                b.chevronSize = .zero
            }
            b.valueLabel.isHidden = false
            b.valueLabel.numberOfLines = 0
            var date = c.date.text
            let cap = c.caption.text
            let text = date + "\n" + cap
            NativeType.set(b.valueLabel, text, font: detailTabular(mt.font(11)), color: color("ink2"), align: .center, line: mt.line("lh11"))
            if c.wrong, let a = b.valueLabel.attributedText {
                let mut = NSMutableAttributedString(attributedString: a)
                let at = (date as NSString).length + 1
                let f = detailTabular(mt.font(11))
                let adv = ("\u{00A0}" as NSString).size(withAttributes: [.font: f]).width
                var attrs = mut.attributes(at: at, effectiveRange: nil)
                attrs[.kern] = 14 - adv
                mut.insert(NSAttributedString(string: "\u{00A0}", attributes: attrs), at: at)
                b.valueLabel.attributedText = mut
                _ = date
                date = ""
            }
            cellButtons.append(b)
            cellSquares.append(sq)
            cellDots.append(c.wrong ? add(DetailDot(color: zhu)) : nil)
            wire(b) { page in (page as? DetailScreen)?.openZoom(cell: heroOffset + i) }
        }
        // 纸上记录行
        for p in m.records.paperRows {
            let row = add(UIView())
            row.accessibilityIdentifier = "native-detail-paper-row"
            let sr = add(UILabel()), d = add(UILabel()), cp = add(UILabel())
            NativeType.set(d, p.date.text, font: detailTabular(mt.font(15)), color: color("ink1"), line: mt.line("lh15"))
            NativeType.set(cp, p.caption.text + p.tag.text, font: mt.font(15), color: color("ink2"), line: mt.line("lh15"))
            row.isAccessibilityElement = true
            row.accessibilityLabel = p.label.text
            _ = sr
            paperViews.append((row, sr, d, cp))
        }
        paperTop.backgroundColor = color("line")
        paperTop.isHidden = m.records.paperRows.isEmpty
        // 字源
        sourceLabel.isHidden = m.source == nil
        sourceText.isHidden = m.source == nil
        sourceFrom.isHidden = m.source == nil || (m.source?.from.isEmpty ?? true)
        if let s = m.source {
            NativeType.set(sourceLabel, s.label.text, font: mt.font(13), color: color("ink3"), line: mt.line("lh15"))
            detailKaiText(sourceText, s.gloss, font: ShiziFonts.kai(size: mt.value("fs17")), color: color("ink1"), line: mt.line("lh17"))
            NativeType.set(sourceFrom, s.from, font: mt.font(13), color: color("ink3"), line: mt.line("lh15"))
        }
        // 列表行
        rowsTopLine.backgroundColor = color("line")
        rowsTopLine.isHidden = m.rows.isEmpty
        for r in m.rows {
            let item = DetailRowItem(row: r, owner: self, metrics: mt, color: { self.color($0) })
            item.views.forEach { _ = add($0) }
            rowItems.append(item)
            // 三段式失败（就地，行下方）
            if let f = failBlock(for: r.key) { item.fail = f; f.views.forEach { _ = add($0) } }
        }
        rebuildFooter()
        live.text = banner.flatMap { b in b.state == .done ? t("X-COMMON.undone") : b.state == .failed ? t("X-DETAIL.saveFailed") : t("R-D05.banner", ["word": b.word]) }
        view.setNeedsLayout()
    }

    /// 拼音（17）与「N 画」（15）按基线对齐时「N 画」比拼音低多少：WebKit 把字体升部 / 降部取整后再算半行距，按档位量自网页参考（L / XXXL / AX3 / AX5），其余档按字体度量近似。
    private static let strokesBaselineDelta: [String: CGFloat] = ["L": 1, "XXXL": 0, "AX3": 4, "AX5": 4]


    // MARK: 行动作

    func rowTapped(_ key: String, _ r: DetailView.Row) {
        switch key {
        case "list", "legacy":
            if let to = r.to { push(to.screen, params: key == "legacy" ? ["char": char] : ["kind": "due"]) }
        case "image":
            call("detail.image", ["char": char]) { _ in }
        case "swap": swap()
        case "remove": remove()
        case "add": add()
        default: break
        }
    }

    private func call(_ op: String, _ args: [String: Any], _ done: @escaping ([String: Any]) -> Void) {
        guard let engine = stage?.engine else { done(["ok": false, "error": ["kind": "unavailable"]]); return }
        Task { @MainActor in done(await engine.raw(op, args)) }
    }

    private func ok(_ r: [String: Any]) -> Bool { (r["ok"] as? Bool) == true }

    private func swap() {
        guard let m = model else { return }
        let word = m.originalWord
        call("detail.wordOff", ["char": char]) { [weak self] r in
            guard let self else { return }
            if self.ok(r) {
                self.swapFailed = false
                self.undoState = nil
                self.banner = (word, .on)
            } else {
                self.swapFailed = true
            }
            self.markStateChange()
            self.rerender()
            self.reload()
            if self.ok(r) { NativeA11y.announce(self.t("R-D05.banner", ["word": word])) }
        }
    }

    private func undoWord() {
        guard let b = banner, b.state != .done else { return }
        call("detail.wordOn", ["char": char]) { [weak self] r in
            guard let self else { return }
            self.banner = (b.word, self.ok(r) ? .done : .failed)
            self.markStateChange()
            self.rerender()
            self.reload()
            NativeA11y.announce(self.ok(r) ? self.t("X-COMMON.undone") : self.t("X-DETAIL.saveFailed"))
        }
    }

    private func remove() {
        call("detail.removeCustom", ["char": char]) { [weak self] r in
            guard let self else { return }
            if self.ok(r) {
                self.removeFailed = false
                self.banner = nil
                if let removed = r["removed"] as? [String: Any] { self.undoState = (removed, .on) }
            } else {
                self.removeFailed = true
            }
            self.markStateChange()
            self.rerender()
            self.reload()
        }
    }

    private func add() {
        call("detail.addCustom", ["char": char]) { [weak self] r in
            guard let self else { return }
            self.addFailed = !self.ok(r)
            self.markStateChange()
            self.rerender()
            self.reload()
        }
    }

    private func undoRemove() {
        guard let u = undoState, u.state != .done else { return }
        call("detail.restoreCustom", ["removed": u.removed]) { [weak self] r in
            guard let self else { return }
            self.undoState = (u.removed, self.ok(r) ? .done : .failed)
            self.markStateChange()
            self.rerender()
            self.reload()
        }
    }

    private func practice() {
        guard !busy, let engine = stage?.engine else { return }
        busy = true
        let entry = entryId
        // 写字页要盖上来：先把这一页的样子留在宿主层（回来时宿主等网页空闲请原生盖回，open via 'return'）
        let url = WebViewController.snapshotURL(view)
        let char = self.char
        Task { @MainActor [weak self] in
            var args: [String: Any] = ["entryId": entry]
            if let url { args["url"] = url }
            _ = await engine.raw("stage.cover", args)
            let r = await engine.raw("detail.practice", ["char": char])
            guard let self else { return }
            self.busy = false
            if (r["ok"] as? Bool) == true {
                self.practiceFailed = false
                if (r["opened"] as? String) == "s02" { self.stage?.yieldToWeb(from: self) {} }
                self.clearTransient()
            } else {
                _ = await engine.raw("stage.cover", ["entryId": entry])
                self.practiceFailed = true
                self.markStateChange()
                self.rerender()
                NativeA11y.announce(self.t("X-DETAIL.saveFailed"))
            }
        }
    }

    // MARK: 放大弹层

    private func openZoom(cell index: Int) {
        guard let m = model, presentedViewController == nil else { return }
        let record: (id: String, title: String, strokes: [[InkRawPoint]], judgment: String, changeable: Bool)
        if index < m.hero.cells.count {
            let c = m.hero.cells[index]
            record = (c.recordId, c.title.text, detailRawStrokes(c.strokes), c.judgment, c.changeable)
        } else {
            let c = m.records.cells[index - m.hero.cells.count]
            record = (c.recordId, c.title.text, detailRawStrokes(c.strokes), c.judgment, c.changeable)
        }
        let zoom = DetailZoomSheet(recordId: record.id, judgment: record.judgment, strokes: record.strokes, title: record.title, changeable: record.changeable, metrics: metrics, screen: self)
        zoom.modalPresentationStyle = .custom
        present(zoom, animated: true)
    }

    /// 放大弹层里改判：返回回包（成功 / stale 关弹层，失败就地三段式）。
    func correct(recordId: String, done: @escaping ([String: Any]) -> Void) {
        call("detail.correct", ["recordId": recordId]) { [weak self] r in
            done(r)
            if (r["ok"] as? Bool) == true { self?.reload() }
        }
    }

    // MARK: 失败三段式（行下方）

    private func failBlock(for key: String) -> DetailFailBlock? {
        let on: Bool
        switch key {
        case "swap": on = swapFailed
        case "remove": on = removeFailed
        case "add": on = addFailed
        default: on = false
        }
        guard on else { return nil }
        let mt = metrics
        let f = DetailFailBlock(metrics: mt, color: { self.color($0) }, note: t("X-DETAIL.saveFailed"), cancel: t("X-DETAIL.cancel"), retry: t("X-DETAIL.retry"), wrapped: true, id: "native-detail-\(key)-fail")
        wire(f.cancelButton) { page in
            guard let s = page as? DetailScreen else { return }
            switch key { case "swap": s.swapFailed = false; case "remove": s.removeFailed = false; default: s.addFailed = false }
            s.rerender()
        }
        wire(f.retryButton) { page in
            guard let s = page as? DetailScreen else { return }
            switch key { case "swap": s.swap(); case "remove": s.remove(); default: s.add() }
        }
        return f
    }

    // MARK: 底栏

    private func rebuildFooter() {
        let mt = metrics
        wordBar?.removeFromSuperview(); customBar?.removeFromSuperview(); bannerMarker.removeFromSuperview()
        wordBar = nil; customBar = nil
        if let b = banner {
            let bar = DetailUndoBar(metrics: mt, color: { self.color($0) })
            let failed = b.state == .failed
            bar.set(text1: b.state == .done ? t("X-COMMON.undone") : failed ? t("X-DETAIL.saveFailed") : t("R-D05.banner", ["word": b.word]),
                    text2: b.state == .done ? nil : failed ? t("X-DETAIL.undoFailedL2") : t("R-D06.undoL2"), undo: t("X-COMMON.undo"), done: b.state == .done)
            bar.onUndo = { [weak self] in self?.guarded { self?.undoWord() } }
            footer.addSubview(bar)
            wordBar = bar
            bannerMarker.accessibilityIdentifier = "native-detail-word-banner"
            bannerMarker.isUserInteractionEnabled = false
            footer.addSubview(bannerMarker)
            if b.state == .done { scheduleBarEnd { [weak self] in self?.banner = nil; self?.rerender() } }
        }
        if let u = undoState {
            let bar = DetailUndoBar(metrics: mt, color: { self.color($0) })
            let failed = u.state == .failed
            let ch = char
            bar.set(text1: u.state == .done ? t("X-COMMON.undone") : failed ? t("X-DETAIL.saveFailed") : t("R-D06.undoL1", ["char": ch]),
                    text2: u.state == .done ? nil : failed ? t("X-DETAIL.undoFailedL2") : t("R-D06.undoL2"), undo: t("X-COMMON.undo"), done: u.state == .done)
            bar.onUndo = { [weak self] in self?.guarded { self?.undoRemove() } }
            footer.addSubview(bar)
            customBar = bar
            if u.state == .done { scheduleBarEnd { [weak self] in self?.undoState = nil; self?.rerender() } }
        }
        // 主按钮 / 三段式
        let primaryColors: (UIColor, UIColor) = (color("btn-bg"), color("btn-fg"))
        for b in [practiceButton] {
            b.backgroundColor = primaryColors.0
            b.setTitleColor(primaryColors.1, for: .normal)
            b.setTitleColor(color("ink4"), for: .disabled)
            b.titleLabel?.font = mt.font(17, .medium)
            b.layer.cornerRadius = mt.value("r-ctl")
        }
        practiceButton.isEnabled = model?.practicable ?? false
        practiceButton.setTitle(practiceFailed ? t("X-DETAIL.retry") : (model?.practice.text ?? ""), for: .normal)
        practiceButton.accessibilityIdentifier = practiceFailed ? "native-detail-practice-fail-retry" : "native-detail-practice"
        NativeType.trackTitle(practiceButton)
        practiceNote.isHidden = !practiceFailed
        practiceCancel.isHidden = !practiceFailed
        if practiceFailed {
            NativeType.set(practiceNote, t("X-DETAIL.saveFailed"), font: mt.font(15), color: color("ink2"), align: .center, line: mt.line("lh15"))
            practiceCancel.setTitle(t("X-DETAIL.cancel"), for: .normal)
            practiceCancel.titleLabel?.font = mt.font(15)
            practiceCancel.setTitleColor(color("ink2"), for: .normal)
            NativeType.trackTitle(practiceCancel)
        }
    }

    private func guarded(_ f: () -> Void) {
        f()
    }

    private func scheduleBarEnd(_ end: @escaping () -> Void) {
        barTimer?.invalidate()
        let ms = ((ShiziTokens.motion["timing"] as? [String: Any])?["undone"] as? NSNumber)?.doubleValue ?? 2400
        barTimer = Timer.scheduledTimer(withTimeInterval: ms / 1000, repeats: false) { _ in end() }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let w = view.bounds.width, h = view.bounds.height
        guard w > 0 else { return }
        let mt = metrics
        titleLabel.frame = ShiziPageHeader.screenReaderTitleFrame(gutter: mt.gutter, top: view.safeAreaInsets.top)
        live.frame = CGRect(x: mt.gutter - 1, y: view.safeAreaInsets.top + 59, width: 1, height: 1)
        // 底栏（.sz-page__foot：上 s3、左右页边、下 max(s6, 下安全区)，子项间 s3）
        let gutter = mt.gutter
        let inner = w - 2 * gutter
        var y = mt.space(3)
        var parts: [CGFloat] = []
        for bar in [wordBar, customBar].compactMap({ $0 }) {
            let bw = inner + 16
            let bh = bar.height(for: bw)
            bar.frame = CGRect(x: gutter - 8, y: y, width: bw, height: bh)
            if bar === wordBar { bannerMarker.frame = bar.frame }
            y += bh + mt.space(3)
            parts.append(bh)
        }
        let btnH: CGFloat
        if practiceFailed {
            let nh = NativeType.height(practiceNote, width: inner, line: mt.line("lh15"))
            practiceNote.frame = CGRect(x: gutter, y: y, width: inner, height: nh)
            y += nh + mt.space(1) + mt.space(2)
            let cw = NativeType.titleWidth(practiceCancel) + 8
            let ch = max(mt.hit, 44)
            practiceCancel.frame = CGRect(x: gutter - 4, y: y, width: cw, height: ch)
            y += ch + mt.space(2)
        }
        btnH = axButtonHeight(inner)
        practiceButton.frame = CGRect(x: gutter, y: y, width: inner, height: btnH)
        y += btnH
        let bottom = max(mt.space(6), view.safeAreaInsets.bottom)
        footerHeight = y + bottom
        footer.frame = CGRect(x: 0, y: h - footerHeight, width: w, height: footerHeight)
        footer.backgroundColor = color("paper")
        scroll.frame.size.height = max(0, h - footerHeight - scroll.frame.minY)
    }

    private func axButtonHeight(_ inner: CGFloat) -> CGFloat {
        let mt = metrics
        guard isAX, let t = practiceButton.title(for: .normal), !t.isEmpty else { return mt.value("btn-h") }
        let f = practiceButton.titleLabel?.font ?? mt.font(17, .medium)
        let lines = ceil((t as NSString).size(withAttributes: [.font: f]).width / max(1, inner - 48))
        return max(mt.value("btn-h"), lines * mt.line("lh17") + 12)
    }

    // MARK: 排版

    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat {
        guard let m = model else { return top }
        let mt = metrics
        let gap = mt.groupGap
        let ax = isAX
        let hair = detailHair(mt.value("hair"))
        var y = top + (ax ? 4 : 0) // AX 档网页页头里不显示的标题也占一行（components/ax.js 把它放回文档流）
        // ---- 头部（.sz-dhead：竖排 gap s4）
        let cardTop = y
        if m.hero.kind == "ink" {
            let n = heroButtons.count
            let cwf = ax ? width : (width - 12) / 2
            let heroTop = y
            var heroBottom = heroTop
            var runY = heroTop
            for (i, b) in heroButtons.enumerated() {
                let colX: CGFloat = ax ? x : (n == 1 ? x + (width - cwf) / 2 : x + CGFloat(i) * (cwf + 12))
                let oy: CGFloat = ax ? runY : heroTop
                // 方：cwf × cwf；说明在下方 s2；写错时说明末尾跟一个点（inline-block，左外边 6 + 6 宽）
                let capLabel = b.label
                let wrong = m.hero.cells[i].wrong
                let lh = mt.line("lh13")
                let nat = ceil(NativeType.width(capLabel))
                let single = nat <= cwf
                let dotWraps = wrong && single && nat + 12 > cwf // 点放不下时折到下一行（网页同）
                let tw = single ? nat : cwf
                let textH = NativeType.height(capLabel, width: max(tw, 1), line: lh)
                let capH = textH + (dotWraps ? lh : 0)
                let cellH = cwf + mt.space(2) + capH
                b.frame = CGRect(x: colX, y: oy, width: cwf, height: cellH)
                let sq = heroSquares[i]
                sq.frame = CGRect(x: colX, y: oy, width: cwf, height: cwf)
                layoutHeroInk(i, side: cwf)
                let lineW = tw + (wrong && !dotWraps ? 12 : 0)
                let lx = max(0, (cwf - lineW) / 2)
                capLabel.frame = CGRect(x: single ? lx : 0, y: cwf + mt.space(2), width: max(tw, 1), height: textH)
                capLabel.textAlignment = .center
                if let dot = heroDots[i] {
                    if dotWraps {
                        dot.frame = CGRect(x: colX + cwf / 2, y: oy + cwf + mt.space(2) + textH + (lh - 6) / 2, width: 6, height: 6)
                    } else {
                        let lastW = single ? tw : max(1, nat - floor(nat / max(1, cwf)) * cwf)
                        let dx = single ? lx + tw + 6 : (cwf - lastW - 12) / 2 + lastW + 6
                        dot.frame = CGRect(x: colX + dx, y: oy + cwf + mt.space(2) + textH - lh + (lh - 6) / 2 + 1, width: 6, height: 6)
                    }
                }
                heroBottom = max(heroBottom, oy + cellH)
                runY = oy + cellH + 12
            }
            let heroH = heroBottom - heroTop
            heroMarker.frame = CGRect(x: x, y: heroTop, width: width, height: heroH)
            y += heroH + mt.space(4)
        } else if let r = bigRef {
            let side = floor((width - 12) / 2) == (width - 12) / 2 ? (width - 12) / 2 : (width - 12) / 2
            r.frame = CGRect(x: x, y: y, width: side, height: side)
            heroMarker.frame = .zero
            y += side + mt.space(4)
        }
        // 信息行：info（竖排 gap 12）+ 小参考格（写过时，右端 44）
        let infoTop = y
        let refSm: CGFloat = smallRef != nil ? 44 : 0
        let infoW = width - (smallRef != nil ? refSm + mt.space(4) : 0)
        var iy = infoTop
        // 拼音 + 笔画（baseline 对齐，wrap，gap s2）
        let pw = ceil(NativeType.width(pinyinLabel)), sw = strokesLabel.isHidden ? 0 : ceil(NativeType.width(strokesLabel))
        let l17 = mt.line("lh17s"), l15 = mt.line("lh15")
        let fp = mt.font(17), fs = mt.font(15)
        // baseline = 行顶 + (行高 − (升 − 降)) / 2 + 升
        let bp = (l17 - (fp.ascender - fp.descender)) / 2 + fp.ascender
        let bs = (l15 - (fs.ascender - fs.descender)) / 2 + fs.ascender
        let wraps = !strokesLabel.isHidden && pw + mt.space(2) + sw > infoW + 0.5
        pinyinLabel.frame = CGRect(x: x, y: iy, width: pw, height: l17)
        var topH = l17
        if !strokesLabel.isHidden {
            if wraps {
                strokesLabel.frame = CGRect(x: x, y: iy + l17 + 0, width: sw, height: l15)
                topH = l17 + l15
            } else {
                let off = Self.strokesBaselineDelta[ShiziTokens.categoryName(mt.category)] ?? round((bp - bs) * 64) / 64
                strokesLabel.frame = CGRect(x: x + pw + mt.space(2), y: iy + off, width: sw, height: l15)
                topH = max(l17, off + l15)
            }
        }
        iy += pinyinLabel.isHidden ? 0 : topH
        if let w = m.word {
            if !pinyinLabel.isHidden { iy += 12 }
            let lw = max(1, ceil(NativeType.width(wordLabel)))
            wordLabel.frame = CGRect(x: x, y: iy, width: infoW, height: mt.line("lh15"))
            _ = lw
            iy += mt.line("lh15") + mt.space(2)
            if w.hasWord {
                let n = CGFloat(tileViews.count)
                let bw = min(infoW, 36 * n + 2)
                wordMarker.frame = CGRect(x: x, y: iy, width: bw, height: 38)
                for (i, t) in tileViews.enumerated() {
                    t.frame = CGRect(x: x + 1 + CGFloat(i) * 36, y: iy + 1, width: 36, height: 36)
                    let gside = min(28, t.bounds.width * 0.9)
                    tileGlyphs[i].frame = CGRect(x: (36 - gside) / 2, y: (36 - gside) / 2, width: gside, height: gside)
                }
                iy += 38
            } else {
                let gh = NativeType.height(glossLabel, width: infoW, line: mt.line("lh17"))
                glossLabel.frame = CGRect(x: x, y: iy, width: infoW, height: gh)
                iy += gh
            }
        }
        if let r = smallRef {
            r.frame = CGRect(x: x + width - refSm, y: infoTop, width: refSm, height: refSm)
            iy = max(iy, infoTop + refSm)
        }
        y = iy
        cardMarker.frame = CGRect(x: x, y: cardTop, width: width, height: y - cardTop)
        // ---- 记录块
        y += gap
        let recTop = y
        let rec = m.records
        let countW = ceil(NativeType.width(countLabel))
        let countH = mt.line("lh15")
        var ry = recTop
        if rec.count == 0 {
            // 头：count + 说明（两端对齐，baseline，wrap）
            let ew = ceil(NativeType.width(emptyLabel))
            let fits = countW + 12 + ew <= width + 0.5 && !ax
            let eh = NativeType.height(emptyLabel, width: fits ? ew : width, line: mt.line("lh15"))
            countLabel.frame = CGRect(x: x, y: ry, width: countW, height: countH)
            if fits {
                let fc = NativeType.song(size: mt.value("fs22"), weight: .medium), fe = mt.font(15)
                let bc = (countH - (fc.ascender - fc.descender)) / 2 + fc.ascender
                let be = (mt.line("lh15") - (fe.ascender - fe.descender)) / 2 + fe.ascender
                emptyLabel.frame = CGRect(x: x + width - ew, y: ry + (bc - be), width: ew, height: eh)
                ry += max(countH, bc - be + eh)
            } else {
                emptyLabel.frame = CGRect(x: x, y: ry + countH + 4, width: width, height: eh)
                ry += countH + 4 + eh
            }
            cellsMarker.frame = .zero
        } else {
            countLabel.frame = CGRect(x: x, y: ry, width: countW, height: countH)
            ry += countH
            let cells = cellButtons
            if !cells.isEmpty {
                ry += 12
                let cols: CGFloat = ax ? 2 : 4
                let frameW = mt.value("frame-w")
                let track = (width - frameW) / cols
                let cw = track + frameW
                let metaMin = max(44, mt.value("hit"))
                var rowH: [CGFloat] = []
                let n = cells.count
                for r in 0..<Int(ceil(Double(n) / Double(cols))) {
                    var mh = metaMin
                    for c in 0..<Int(cols) where r * Int(cols) + c < n {
                        let b = cells[r * Int(cols) + c]
                        let textH = NativeType.height(b.valueLabel, width: cw - 8, line: mt.line("lh11"))
                        mh = max(mh, frameW + 8 + textH)
                    }
                    rowH.append(cw + mh)
                }
                let gridTop = ry
                var cy = gridTop
                for r in 0..<rowH.count {
                    let ch = rowH[r]
                    for c in 0..<Int(cols) where r * Int(cols) + c < n {
                        let i = r * Int(cols) + c
                        let b = cells[i]
                        let cx = x + CGFloat(c) * track
                        b.frame = CGRect(x: cx, y: cy, width: cw, height: ch)
                        layoutCell(i, width: cw, height: ch, side: cw)
                    }
                    cy += ch - frameW
                }
                let gridH = frameW + rowH.reduce(0) { $0 + $1 - frameW }
                cellsMarker.frame = CGRect(x: x, y: gridTop, width: width, height: gridH)
                ry = gridTop + gridH
            } else { cellsMarker.frame = .zero }
            if !paperViews.isEmpty {
                ry += 12
                paperTop.frame = CGRect(x: x, y: ry, width: width, height: hair)
                ry += hair
                for p in paperViews {
                    let rowH = max(52, mt.line("lh15") + 0 + hair)
                    p.row.frame = CGRect(x: x, y: ry, width: width, height: rowH)
                    let dw = max(64, ceil(NativeType.width(p.date)))
                    p.date.frame = CGRect(x: x, y: ry + (rowH - hair - mt.line("lh15")) / 2, width: dw, height: mt.line("lh15"))
                    p.cap.frame = CGRect(x: x + dw + 12, y: p.date.frame.minY, width: width - dw - 12, height: mt.line("lh15"))
                    ry += rowH
                }
            }
        }
        recordsMarker.frame = CGRect(x: x, y: recTop, width: width, height: ry - recTop)
        y = ry
        // ---- 字源
        if let s = m.source {
            y += gap
            let srcTop = y
            let lw: CGFloat = 44, g: CGFloat = 8
            let bodyW = width - lw - g
            let th = NativeType.height(sourceText, width: bodyW, line: mt.line("lh17"))
            sourceText.frame = CGRect(x: x + lw + g, y: srcTop, width: bodyW, height: th)
            // 标签与正文第一行 baseline 对齐
            let fl = mt.font(13), fk = ShiziFonts.kai(size: mt.value("fs17"))
            let bl = (mt.line("lh15") - (fl.ascender - fl.descender)) / 2 + fl.ascender
            let bk = (mt.line("lh17") - (fk.ascender - fk.descender)) / 2 + fk.ascender
            let slh = NativeType.height(sourceLabel, width: lw, line: mt.line("lh15"))
            sourceLabel.frame = CGRect(x: x, y: srcTop + (bk - bl), width: lw, height: slh)
            var sy = srcTop + th
            if !sourceFrom.isHidden {
                sy += 4
                let fh = NativeType.height(sourceFrom, width: bodyW, line: mt.line("lh15"))
                sourceFrom.frame = CGRect(x: x + lw + g, y: sy, width: bodyW, height: fh)
                sy += fh
            }
            _ = s
            sy = max(sy, sourceLabel.frame.maxY)
            sourceMarker.frame = CGRect(x: x, y: srcTop, width: width, height: sy - srcTop)
            y = sy
        } else { sourceMarker.frame = .zero }
        // ---- 列表行
        if !rowItems.isEmpty {
            y += gap
            let rowsTop = y
            rowsTopLine.frame = CGRect(x: x, y: y, width: width, height: hair)
            y += hair
            for item in rowItems {
                y += item.layout(x: x, y: y, width: width, hair: hair)
                if let f = item.fail { y += f.layout(x: x, y: y, width: width) }
            }
            rowsMarker.frame = CGRect(x: x, y: rowsTop, width: width, height: y - rowsTop)
        } else { rowsMarker.frame = .zero }
        return y
    }

    private func layoutHeroInk(_ i: Int, side: CGFloat) {
        let sq = heroSquares[i]
        let c = heroCells[i]
        sq.ink?.removeFromSuperview()
        sq.ink = nil
        if c.hasInk, let v = NativeInkPaint.view(strokes: detailRawStrokes(c.strokes), side: max(1, side - 2 * metrics.value("frame-w")), color: detailInkColor(traitCollection), widthScale: detailInkScale(side - 2)) {
            sq.addSubview(v)
            sq.ink = v
        }
        sq.glyph?.frame = sq.bounds.insetBy(dx: 0, dy: 0)
        if let g = sq.glyph {
            let gs = (side - 2) * 0.76
            g.frame = CGRect(x: (side - gs) / 2, y: (side - gs) / 2, width: gs, height: gs)
            g.padRatio = 0.06
        }
    }

    private func layoutCell(_ i: Int, width cw: CGFloat, height ch: CGFloat, side: CGFloat) {
        let mt = metrics
        let b = cellButtons[i]
        let sq = cellSquares[i]
        let c = model!.records.cells[i]
        let frameW = mt.value("frame-w")
        sq.frame = CGRect(x: b.frame.minX, y: b.frame.minY, width: cw, height: cw)
        sq.ink?.removeFromSuperview()
        sq.ink = nil
        if c.hasInk, let v = NativeInkPaint.view(strokes: detailRawStrokes(c.strokes), side: max(1, cw - 2 * frameW), color: detailInkColor(traitCollection), widthScale: detailInkScale(cw - 2 * frameW)) {
            sq.addSubview(v)
            sq.ink = v
            v.frame = CGRect(x: frameW, y: frameW, width: cw - 2 * frameW, height: cw - 2 * frameW)
        }
        var srY: CGFloat = 0
        if let g = sq.glyph {
            let gs = cw * 0.44
            g.frame = CGRect(x: (cw - gs) / 2, y: (cw - gs) / 2, width: gs, height: gs)
            g.padRatio = 0.06
            srY = (cw - gs) / 2 - 3.05
            // 按钮的「图标」= 网页里 svg 的框（尺寸 = 衬底字的方框；只量尺寸，位置不比）
            b.chevronSize = CGSize(width: gs, height: gs)
            b.setImage(UIGraphicsImageRenderer(size: b.chevronSize).image { _ in }.withRenderingMode(.alwaysOriginal), for: .normal)
        }
        // 说明区：上边线 1、内边距 4、竖向居中；日期与「写对 / 写错」两行
        let metaTop = cw
        let metaH = ch - cw
        let textH = NativeType.height(b.valueLabel, width: cw - 8, line: mt.line("lh11"))
        b.valueLabel.frame = CGRect(x: 4, y: metaTop + frameW + (metaH - frameW - textH) / 2 + (0), width: cw - 8, height: textH)
        if !b.label.isHidden {
            b.label.frame = CGRect(x: (cw - 1) / 2, y: srY, width: 1, height: 1)
        }
        if let dot = cellDots[i] {
            // 「● 写错」：点在说明行里、字之前（点 6 + 间 8），整体居中（说明里的占位已把字右移）
            let lh = mt.line("lh11")
            let cap = c.caption.text
            let f = detailTabular(mt.font(11))
            let capW = (cap as NSString).size(withAttributes: [.font: f]).width
            let lineW = 14 + capW
            let lineTop = b.frame.minY + b.valueLabel.frame.minY + textH - lh
            dot.frame = CGRect(x: b.frame.minX + (cw - lineW) / 2, y: lineTop + (lh - 6) / 2, width: 6, height: 6)
        }
    }
}
