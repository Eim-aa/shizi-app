import UIKit

// B3.8 原生字库子页 · 清单页（照网页版 1:1 移植；视图模型 listModel，
// App API view.library-list / library.list.start）。
// 屏名 ⇄ 类：library-list ⇄ ShiziScreen_library_list。推入页（不是 tab 根页）。
//
// 版式按网页 CSS 逐项排（.sz-list* / .sz-lrow*），数值全部取 ShiziTokens：
//   页头：标题 + 右槽「全选 / 全不选」；正文：标题（先练这 N 个）+ 一句说明 + 逐行清单（圆圈勾选 / 标准字 / 词语 / 小字 / 笔迹小图 / ›）+ 其余折叠行 + 末尾一句；
//   底栏：一句提示 + 主按钮（≥2「练这些字」/ 1「练这个字」/ 0「先选一个字」禁用）。
// 空态：虚框装饰字 + 标题 + 一句。
// 写入（开组）一律经 library.list.start op 调网页同一个函数；失败（D07）就地三段式。

/// 一行（网页 .sz-lrow）：圆圈 + 标准字 + 词语 / 小字 + 笔迹小图 + chevron。
/// 行里的字都在按钮的子视图里（网页也是这样：取证脚本跳过按钮的子节点）。
final class LibraryListRowView: UIView {
    /// 勾选圆点（网页 .sz-lrow__dot：26 × 26、描边 1.5 ink4；选中时填 ink1 + 纸色勾）。
    let select = ShiziLineButton(type: .custom)
    /// 行本体（标准字 + 词语 + 小字 + 笔迹小图 + ›）。
    let open = ShiziLineButton(type: .custom)
    let word = UILabel()
    let meta = UILabel()
    /// 笔迹小图的方框（网页 .sz-lrow__thumb：44 × 44、frame-w 的 frame 色描边、sheet 底）。
    let thumb = UIView()
    let inkView = LibraryInkView()
    let noInk = UILabel()
    let caption = UILabel()
    /// 行尾的 ›（网页 Chevron：8 × 13，在行本体里最后一个）。
    let chevron = UIImageView()
    let dot = UIView()
    let check = UIImageView()
    /// 行底的分隔线（网页 .sz-lrow 的 border-bottom：1px line）。
    let separator = CALayer()
    /// 圆点填色（选中 = ink1；网页 .sz-lrow__dot[aria-checked="true"] 的 background）。
    var dotInk: UIColor = .label
    /// 上次按哪一行（清单的序号）、哪一版内容（页面的 contentGeneration）配的内容；都没变时重排只重摆框。
    var index = -1
    var generation = -1

    override init(frame: CGRect) {
        super.init(frame: frame)
        isAccessibilityElement = false
        addSubview(select)
        addSubview(open)
        dot.isUserInteractionEnabled = false
        check.isUserInteractionEnabled = false
        dot.layer.borderWidth = 1.5
        dot.layer.cornerRadius = 13
        select.addSubview(dot)
        check.contentMode = .scaleAspectFit
        select.addSubview(check)
        open.addSubview(word)
        open.addSubview(meta)
        thumb.isUserInteractionEnabled = false
        open.addSubview(thumb)
        open.addSubview(inkView)
        open.addSubview(noInk)
        open.addSubview(caption)
        open.addSubview(chevron)
        chevron.contentMode = .scaleAspectFit
        layer.addSublayer(separator)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// 圆点与勾的位置（圆点在按钮里居中，勾在圆点里居中）；选中时圆点填墨色、描边去掉。
    /// traits = 描边色按哪个外观解析（页面的外观：行可能还没挂进窗口，比如测试里对照用的新建行）。
    func layoutDot(selected: Bool, line: UIColor, traits: UITraitCollection) {
        // 勾是按钮自己的图（取证按按钮的图标比），要画在圆点上面
        if let iv = select.imageView { select.bringSubviewToFront(iv) }
        dot.layer.borderColor = line.resolvedColor(with: traits).cgColor
        dot.frame = CGRect(x: 9, y: 9, width: 26, height: 26)
        check.frame = CGRect(x: 9, y: 9, width: 26, height: 26)
        dot.layer.borderWidth = selected ? 0 : 1.5
        dot.backgroundColor = selected ? dotInk : .clear
    }

    /// 行底的分隔线（网页 .sz-lrow 的 border-bottom）。
    func layoutSeparator(height: CGFloat, color: UIColor) {
        separator.frame = CGRect(x: 0, y: bounds.height - height, width: bounds.width, height: height)
        separator.backgroundColor = color.cgColor
        separator.isHidden = height <= 0
    }
}

@objc(ShiziScreen_library_list)
final class LibraryListScreen: ShiziScreenViewController, UIScrollViewDelegate {
    struct View: Decodable {
        struct Word: Decodable { let pre: String; let tg: String; let post: String; let has: Bool }
        struct Row: Decodable {
            let char: String
            let cardKey: String
            let recordId: String
            let word: Word
            let meta: FlexText
            let thumbCaption: FlexText
            let noThumb: Bool
            let selectable: Bool
            let selected: Bool
            let group: String
        }
        struct Action: Decodable { let label: ShiziCopyRef; let disabled: Bool }
        let kind: String
        let view: String
        let title: ShiziCopyRef
        let empty: Bool
        let emptyGlyph: ShiziCopyRef
        let emptyTitle: ShiziCopyRef
        let emptyBody: ShiziCopyRef
        let head: ShiziCopyRef
        let top: ShiziCopyRef
        let note: ShiziCopyRef
        let hint: ShiziCopyRef
        let button: Action
        let restCount: Int
        let restLabel: FlexText
        let restHideLabel: FlexText
        let toggleAllLabel: ShiziCopyRef
        let rows: [Row]
        let selectedCount: Int
        let selectableCount: Int
        let allSelected: Bool
    }

    /// 网页量出来的值（B3.8）：说明句是 text-wrap: pretty 的段落，折行点由页面用同一组 CSS 量出。
    struct WebMetrics: Decodable {
        let top: [Int]?
        let hint: [Int]?
        let note: [Int]?
    }

    // 正文（.sz-list）
    private let bodyMarker = UIView()
    private let headLabel = UILabel()
    private let topLabel = UILabel()
    private let rowsMarker = UIView()
    /// 清单顶的分隔线（网页 .sz-list__rows 的 border-top：1px line）。
    private let rowsTopLine = UIView()
    private let noteLabel = UILabel()
    private let restButton = ShiziLineButton(type: .custom)
    // 空态
    private let emptyMarker = UIView()
    private let emptyCell = UIView()
    private let emptyGlyph = UIImageView()
    private let emptyTitle = UILabel()
    private let emptyBody = UILabel()
    // 底栏
    private let hintLabel = UILabel()
    private let goButton = ShiziPrimaryButton(type: .custom)

    private var model: View?
    /// 网页量出来的折行点（pretty 段落：说明句 / 提示句）。
    private var webMetrics: WebMetrics?
    /// 回包 ink（按需解码：只解建出来的行的记录）。
    private let inkStore = LibraryInkStore()
    /// 行首标准字的字形图（每次重拉都要给每行一张；输入没变就用上次那张）。
    private let glyphCache = LibraryGlyphCache()
    /// 建出来的行（按行的序号；= rows.liveIndices 的那几行）。取证（qaNames 按成员名 rowViews[i]）用；
    /// 打开时滚动在顶，建出来的就是从第 0 行起的那几行，名字的序号 = 行的序号。
    private var rowViews: [LibraryListRowView] = []
    /// 最近一次排版算出的全部行的框。
    private(set) var list = RowsLayout()
    /// 第几次渲染（render 一次加一；「其余」展开 / 收起也加一）。排版时交给 contentGeneration（与 list.data 一起换）。
    private var renderGeneration = 0
    /// 可见框上下各多建多少：2.5 屏与 8 行（按这一版的平均行高）取大的。
    /// 冻结的逐屏基线（list-*）里最深的屏外行（取证连屏外滚得到的元素一起记）要在打开时就建出来：
    /// 最紧的是 list-folded / list-known XXXL（行顶在可视区下沿之下 1219pt；2.5 屏 = 1572pt，余 353pt），
    /// AX 档一行就有半屏到一屏多高，按屏算只多建两三行——list-due AX5 最深的行顶在可视区下沿之下 2886pt（6.6 屏），
    /// 8 行 = 4704pt（余 1818pt）；list-due AX3 要 1274pt，8 行 = 2392pt（余 1118pt）。
    static let overscanViewports: CGFloat = 2.5
    static let overscanRows: CGFloat = 8
    /// 清单的行：只建可见框 ± overscan 里的（ShiziLazyCells）。序号 = list.frames 的序号。
    private(set) lazy var rows = ShiziLazyCells<LibraryListRowView>(
        make: { [unowned self] _ in self.makeRow() },
        attach: { [unowned self] rv, _, following in self.attachRow(rv, following) },
        detach: { rv in
            rv.select.isHighlighted = false
            rv.open.isHighlighted = false
            rv.removeFromSuperview()
        },
        configure: { [unowned self] rv, i in self.configureRow(rv, i) })
    /// 行内排版的记忆（同一行的字、同一栏宽、同一字号档 / 外观下行内排版相同；量字是排版里最贵的一步）。
    private var rowBoxMemo: [RowBoxKey: RowBox] = [:]
    private var rowBoxMemoEnv: RowBoxEnv?
    /// 勾选（nil = 默认「最该练的前 N 个」；数组 = 用户自己选的）。
    private var sel: [String]?
    /// 「其余 N 个字」展开。变了 = 显示的行变了：重拉回来之前若先排一次版，建出来的行也按新的行重配内容。
    private var restOpen = false {
        didSet { if restOpen != oldValue { renderGeneration += 1 } }
    }
    /// 开组失败（就地三段式）。
    private var failed = false {
        didSet { view.setNeedsLayout() }
    }

    required override init(screen: String, entryId: String, params: [String: Any]) {
        super.init(screen: screen, entryId: entryId, params: params)
        sel = LibraryListScreen.normalizeSel(params["sel"])
    }

    /// params.sel（数组）→ 选中的字；不是数组 = 默认（nil）。
    static func normalizeSel(_ raw: Any?) -> [String]? {
        guard let a = raw as? [Any] else { return nil }
        return a.compactMap { $0 as? String }.filter { !$0.isEmpty }
    }

    override var watchedDomains: [String]? { ["records", "sched", "ink", "settings", "custom"] }

    /// 底栏内容的高（一句提示 + 主按钮）。
    var footContentHeight: CGFloat {
        hintHeight + metrics.space(3) + metrics.value("btn-h")
    }

    /// 底栏那句提示的高（大字号时折行；网页 .sz-list__hint 的行盒 = 行数 × 行高）。
    private var hintHeight: CGFloat {
        guard let m = model else { return metrics.line("lh13") }
        let w = view.bounds.width - 2 * metrics.gutter
        let n = LibraryText.lineCount(m.hint.text, starts: webMetrics?.hint, font: metrics.font(13), width: w, line: metrics.line("lh13"))
        return CGFloat(n) * metrics.line("lh13")
    }

    /// 有没有底栏（空态没有底栏）。
    var hasFooter: Bool { !(model?.empty ?? false) }

    /// 共用底座（页头右槽 + 底栏 + 三段式）。
    private let kit = LibraryScreenKit()

    /// 页头右槽：全选 / 全不选（网页 .sz-list__toggle：plain 按钮、padding 0 4、margin-right −4、最小宽 44）。
    var trailButtonWidth: CGFloat {
        guard let m = model else { return 44 }
        return max(44, LibraryCommon.textWidth(m.toggleAllLabel.text, metrics.font(15)) + 8)
    }

    /// 右槽的槽宽（按钮的外边距盒；按钮 margin-right −4）。
    var trailSlotWidth: CGFloat { max(44, trailButtonWidth - 4) }

    /// AX 档右槽按钮的高（网页 .sz-list__toggle 是 plain 按钮：高度按内容（正文行高），最小 44；非 AX 档用页头名义高 44）。
    var trailHeight: CGFloat { axLayout ? max(44, metrics.line("lh15")) : 44 }

    override func viewDidLoad() {
        // 右槽的按钮要先建好：基类的 viewDidLoad 里会立刻渲染视图（那时按钮还不存在，文案就丢了）。
        kit.prepare(screen: self, trailId: "native-library-list-toggle-all", onTrail: { [weak self] in self?.toggleAll() },
                   failIdPrefix: "native-library-list", failText: t("X-LIST.startFailed"), failCancelText: t("X-LIST.startStay"),
                   onFailCancel: { [weak self] in self?.clearFailed() }, onFailRetry: { [weak self] in self?.retryFailed() })
        super.viewDidLoad()
        kit.attach()
        for v in [bodyMarker, rowsMarker, emptyMarker] { v.isUserInteractionEnabled = false } // 取证用的标记框，不吃点按
        bodyMarker.accessibilityIdentifier = "native-library-list-body"
        rowsMarker.accessibilityIdentifier = "native-library-list-rows"
        emptyMarker.accessibilityIdentifier = "native-library-list-empty"
        emptyCell.accessibilityIdentifier = "native-library-list-empty-glyph"
        emptyTitle.accessibilityIdentifier = "native-library-list-empty-title"
        emptyBody.accessibilityIdentifier = "native-library-list-empty-body"
        headLabel.accessibilityIdentifier = "native-library-list-head"
        topLabel.accessibilityIdentifier = "native-library-list-top"
        noteLabel.accessibilityIdentifier = "native-library-list-note"
        hintLabel.accessibilityIdentifier = "native-library-list-hint"
        restButton.accessibilityIdentifier = "native-library-list-rest"
        goButton.accessibilityIdentifier = "native-library-list-go"
        for v in [bodyMarker, rowsMarker, emptyMarker, emptyCell, headLabel, topLabel, noteLabel, restButton, emptyTitle, emptyBody] as [UIView] { content.addSubview(v) }
        rowsTopLine.isUserInteractionEnabled = false
        content.addSubview(rowsTopLine)
        emptyCell.addSubview(emptyGlyph)
        for v in [hintLabel, goButton] as [UIView] { kit.foot.addSubview(v) }
        wire(restButton) { page in (page as? LibraryListScreen)?.toggleRest() }
        wire(goButton) { page in (page as? LibraryListScreen)?.start() }
        scroll.delegate = self
    }

    // MARK: 视图

    private var lastPayload: [String: Any]?

    override func apply(payload: [String: Any]) {
        lastPayload = payload
        super.apply(payload: payload)
    }

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: View.self)
        model = m
        if let payload = lastPayload, let ink = payload["ink"] as? [String: Any] {
            inkStore.load(ink)
        }
        if let payload = lastPayload, let met = payload["metrics"] {
            webMetrics = try? ShiziDecode.value(met, as: WebMetrics.self)
        }
        setTitle(m.title.text)
        renderModel(m)
    }

    /// 重拉视图时带上本地的勾选（网页把它写进路由 params；原生这边自己记着）。
    override func reload() {
        guard let engine = stage?.engine else { return }
        let screen = self.screen
        var args: [String: Any] = ["kind": kind]
        if let sel { args["sel"] = sel }
        Task { @MainActor [weak self] in
            let body = await engine.raw("view.\(screen)", args)
            self?.apply(payload: body)
        }
    }

    private var kind: String {
        if let k = params["kind"] as? String { return k }
        return (model?.kind ?? "wrong")
    }

    private func renderModel(_ m: View) {
        let mt = metrics
        // 页头右槽：全选 / 全不选
        if let b = kit.trail {
            b.composed = m.toggleAllLabel.text
            b.lineFont = mt.font(15)
            b.setTitleColor(color("ink2"), for: .normal)
            // 空态没有可勾的行，网页不画这个按钮
            b.isHidden = m.rows.isEmpty
        }
        // 正文
        headLabel.numberOfLines = 0
        NativeType.set(headLabel, m.head.text, font: NativeType.song(size: mt.value("fs28"), weight: .medium), color: color("ink1"), line: mt.line("lh28"))
        ShiziFonts.untrack(headLabel)
        topLabel.numberOfLines = 0
        NativeType.set(topLabel, LibraryText.joined(m.top.text, webMetrics?.top), font: mt.font(15), color: color("ink2"), line: mt.line("lh15"))
        noteLabel.numberOfLines = 0
        NativeType.set(noteLabel, LibraryText.joined(m.note.text, webMetrics?.note), font: mt.font(15), color: color("ink2"), line: mt.line("lh15"))
        restButton.drawsComposed = true
        restButton.composed = (restOpen ? m.restHideLabel : m.restLabel).text
        restButton.lineFont = mt.font(15)
        restButton.setTitleColor(color("ink2"), for: .normal)
        // 空态
        NativeType.set(emptyTitle, m.emptyTitle.text, font: NativeType.song(size: mt.value("fs22"), weight: .medium), color: color("ink1"), align: .center, line: mt.line("lh22"))
        ShiziFonts.untrack(emptyTitle)
        emptyTitle.numberOfLines = 0
        emptyBody.numberOfLines = 0
        NativeType.set(emptyBody, m.emptyBody.text, font: mt.font(15), color: color("ink2"), align: .center, line: mt.line("lh15"))
        // 底栏
        NativeType.set(hintLabel, LibraryText.joined(m.hint.text, webMetrics?.hint), font: mt.font(13), color: color("ink3"), align: .center, line: mt.line("lh13"))
        hintLabel.numberOfLines = 0
        goButton.style(enabled: !m.button.disabled, title: m.button.label.text, font: mt.font(17, .medium), radius: mt.value("r-ctl"),
                       bg: color("btn-bg"), fg: color("btn-fg"), disabledBg: color("field"), disabledFg: color("ink4"))
        kit.styleFail()
        syncRows(m)
        view.setNeedsLayout()
    }

    /// 行（按视图模型的顺序；「其余」折叠时不建那几行）：行在排版时按框建 / 配（layoutBody → updateRows）；
    /// 这里只备好各行共用的图，这一次渲染的内容要重配。
    private func syncRows(_ m: View) {
        rowCheckImage = LibraryIcon.check(color("paper"))
        rowChevronImage = ShiziChevron.image(color("ink4"), size: CGSize(width: 8, height: 13))
        renderGeneration += 1
    }

    /// 新建一行（点圆圈 → 勾选；点行 → 记录）。动作按建出来的行找回是第几行（行会给别的行再用）。
    private func makeRow() -> LibraryListRowView {
        let rv = LibraryListRowView()
        rv.accessibilityIdentifier = "native-library-list-row"
        rv.select.accessibilityIdentifier = "native-library-list-row-select"
        rv.open.accessibilityIdentifier = "native-library-list-row-open"
        wire(rv.select) { [weak rv] page in (page as? LibraryListScreen)?.toggleSelect(rv) }
        wire(rv.open) { [weak rv] page in (page as? LibraryListScreen)?.openDetail(rv) }
        return rv
    }

    /// 一行放进 content：插在 following（下一个已建好的行）前面；没有就放在清单之后的第一样（bodyMarker）前面。
    /// 行在 content 里总是连成一段、按序号排、紧挨在 bodyMarker 前面（= 以前打开时第一次渲染就建好全部行的视图树顺序）。
    /// 已经在 content 里就不动（留下来的行之间的先后本来就按序号）。直接挂在 content 上（不经不吃点按的父视图），真的点按点得到。
    private func attachRow(_ rv: LibraryListRowView, _ following: LibraryListRowView?) {
        if rv.superview === content { return }
        if let f = following, f.superview === content {
            content.insertSubview(rv, belowSubview: f)
        } else if bodyMarker.superview === content {
            content.insertSubview(rv, belowSubview: bodyMarker)
        } else {
            content.addSubview(rv)
        }
    }

    /// 按第 i 行配：内容（换了行或有新的渲染）+ 框（每次排版）。池子里拿出来的行带着上一行的状态，内容与框里的每一样都重设。
    private func configureRow(_ rv: LibraryListRowView, _ i: Int) {
        guard i < list.data.count, i < list.boxes.count, i < list.frames.count else { return }
        if rv.index != i || rv.generation != contentGeneration {
            configureRowContent(rv, list.data[i])
            rv.index = i
            rv.generation = contentGeneration
        }
        configureRowLayout(rv, list.boxes[i], frame: list.frames[i])
    }

    /// 按此刻的滚动位置建 / 收行（排版后、滚动时）。外观按本页的（滚动回调里 UITraitCollection.current 不一定是本页的）。
    func updateRows() {
        let h = max(0, scroll.bounds.height)
        rows.overscan = max(h * Self.overscanViewports, Self.overscanRows * list.averageRowHeight)
        let visible = scroll.bounds
        traitCollection.performAsCurrent { rows.update(visible: visible) }
        rowViews = rows.liveIndices.compactMap { rows.slot(at: $0) }
    }

    /// 行内容的版次：排版时（换 list.data 的同时）取 renderGeneration。行记的是配内容时的这个版次。
    private(set) var contentGeneration = -1

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        guard scrollView === scroll, isViewLoaded else { return }
        updateRows()
        // 滚动时新建的行的字形图也进了缓存（滚动不渲染）：这一轮攒到建出来的行数的两倍（至少 256 张）就收一轮
        // （收掉的图还在行上显示着，下次渲染重配时重画，与现画的逐字节相同）
        if glyphCache.count > max(256, 2 * rows.liveIndices.count) { glyphCache.endPass() }
    }

    /// 行里的勾（选中时圆点里的纸色对勾）与行尾的 ›：每次渲染画一张，各行共用（按此刻的外观）。
    private var rowCheckImage: UIImage?
    private var rowChevronImage: UIImage?

    /// 一行的内容：勾选（圆点 / 勾 / 读屏名）、笔迹小图的框色与笔画、词语 / 小字 / 说明的字、整行的文字、标准字的字形图。
    /// 框在 configureRowLayout。行可能是别的行用过的：这里配的每一样都重设（不留上一行的状态）。
    private func configureRowContent(_ rv: LibraryListRowView, _ row: View.Row) {
        let mt = metrics
        let charSide = 44 * LibraryCommon.scaleK()
        rv.select.composed = ""
        rv.select.lineFont = mt.font(15)
        rv.select.setTitleColor(color("ink1"), for: .normal)
        rv.select.accessibilityLabel = t(row.selected ? "X-QUERY.unselectAria" : "X-QUERY.selectAria", ["char": row.char])
        rv.select.isEnabled = row.selectable
        rv.select.alpha = row.selectable ? 1 : 0
        rv.dotInk = color("ink1")
        rv.layoutDot(selected: row.selected, line: color("ink4"), traits: traitCollection)
        rv.thumb.backgroundColor = color("sheet")
        rv.thumb.layer.borderWidth = mt.value("frame-w")
        rv.thumb.layer.borderColor = color("frame").resolvedColor(with: traitCollection).cgColor
        // 勾（网页 .sz-lrow__dot 里的对勾：14 × 14，在 44 × 44 的圆点钮里居中）
        rv.select.iconSize = CGSize(width: 14, height: 14)
        rv.select.iconCentered = true
        rv.select.setImage(row.selected ? rowCheckImage : nil, for: .normal)
        rv.layoutDot(selected: row.selected, line: color("ink4"), traits: traitCollection)
        rv.chevron.image = rowChevronImage
        let w = row.word
        let wordText = w.has ? w.pre + w.tg + w.post : ""
        rv.word.numberOfLines = 0
        NativeType.set(rv.word, wordText, font: ShiziFonts.kai(size: mt.value("fs22")), color: color("ink2"), line: mt.line("lh22"))
        ShiziFonts.untrack(rv.word)
        rv.meta.numberOfLines = 0
        // 网页 .sz-lrow__meta 有 font-variant-numeric:tabular-nums（数字等宽；大字号下影响折行）
        NativeType.set(rv.meta, row.meta.text, font: mt.fontTabular(15), color: color("ink2"), line: mt.line("lh15"))
        rv.noInk.numberOfLines = 2
        NativeType.set(rv.noInk, t("R-D07.noInkLabel"), font: mt.font(11), color: color("ink3"), align: .center, line: mt.line("lh11"))
        rv.caption.numberOfLines = 1
        NativeType.set(rv.caption, row.thumbCaption.text, font: mt.font(11), color: color("ink3"), line: mt.line("lh11"))
        let strokes = inkStore.strokes(row.recordId) // = 整份 decodeInk 的这一条（回包里没有 = 空）
        rv.inkView.strokes = strokes
        rv.inkView.ink = color("hand")
        rv.noInk.isHidden = !strokes.isEmpty
        rv.inkView.isHidden = strokes.isEmpty
        rv.caption.isHidden = row.noThumb || row.thumbCaption.text.isEmpty
        // 整行的文字（读屏名 / 取证的文案）：字 · 词语 · 小字 · 「写错那次」
        var parts = [row.char]
        if w.has { parts.append(wordText) }
        parts.append(row.meta.text)
        if !row.thumbCaption.text.isEmpty { parts.append(row.thumbCaption.text) }
        rv.open.composed = parts.joined(separator: " ")
        rv.open.lineFont = mt.font(15)
        rv.open.setTitleColor(color("ink1"), for: .normal)
        // 标准字（网页 .sz-lrow__char 的字形 svg；按钮的图标就是它）
        rv.open.iconSize = CGSize(width: charSide, height: charSide)
        rv.open.iconAtLeading = true
        rv.open.setImage(glyphCache.image(row.char, size: charSide, face: 0.7, color: color("ink1")), for: .normal)
    }

    // MARK: 动作

    /// 点圆圈：选上 ↔ 取消（网页的 toggle）。
    private func toggleSelect(_ rv: LibraryListRowView?) {
        guard let rv, let m = model else { return }
        // 建出来的行里找这一行是第几行（行按序号配；序号 → 这一版排的那一行，「先练这些」在最前，同模型的 rows）
        guard let idx = rows.index(where: { $0 === rv }), idx < list.data.count else { return }
        let row = list.data[idx]
        guard row.selectable else { return }
        markStateChange()
        var cur = sel ?? m.rows.filter { $0.group == "top" && $0.selectable }.map { $0.char }
        if let i = cur.firstIndex(of: row.char) { cur.remove(at: i) } else { cur.append(row.char) }
        sel = cur
        writeSel()
        reload()
    }

    private func toggleAll() {
        guard let m = model else { return }
        markStateChange()
        failed = false
        if m.allSelected {
            sel = []
        } else {
            sel = m.rows.filter { $0.selectable }.map { $0.char }
            restOpen = true
        }
        writeSel()
        reload()
    }

    private func toggleRest() {
        markStateChange()
        restOpen.toggle()
        reload()
    }

    func clearFailed() {
        markStateChange()
        failed = false
        view.setNeedsLayout()
    }

    func retryFailed() { start() }

    private func writeSel() {
        var patch: [String: Any] = [:]
        if let sel { patch["sel"] = sel } else { patch["sel"] = NSNull() }
        Task { @MainActor [weak self] in
            guard let engine = self?.stage?.engine else { return }
            _ = await engine.raw("nav.setParams", ["patch": patch])
        }
    }

    /// 开组（网页的 start：startPicked(选中的字, {source:{view}})）。
    private func start() {
        guard let m = model else { return }
        let keys = m.rows.filter { $0.selected }.map { $0.cardKey }
        guard !keys.isEmpty else { return }
        Task { @MainActor [weak self] in
            guard let self, let engine = self.stage?.engine else { return }
            let body = await engine.raw("library.list.start", ["keys": keys, "view": m.view])
            let ok = (body["ok"] as? Bool) == true
            await MainActor.run {
                self.markStateChange()
                self.failed = !ok
                self.view.setNeedsLayout()
            }
        }
    }

    /// 点行看记录（网页的 detailOpener：'detail' 屏）。
    private func openDetail(_ rv: LibraryListRowView?) {
        guard let rv, model != nil else { return }
        guard let idx = rows.index(where: { $0 === rv }), idx < list.data.count else { return }
        let char = list.data[idx].char
        Task { @MainActor [weak self] in
            guard let engine = self?.stage?.engine else { return }
            _ = await engine.raw("nav.push", ["screen": "detail", "params": ["char": char]])
        }
    }

    // MARK: 排版

    /// 一行的排版（网页 .sz-lrow 的流：勾选钮 → 行本体 → 标准字 → 词语 / 小字 → 笔迹小图 → ›）。
    struct RowBox: Equatable {
        var rowHeight: CGFloat      // 行高（行本体的高 + 行底 1px 分隔线）
        var openHeight: CGFloat      // 行本体（按钮）的高
        var mainWidth: CGFloat
        var mainHeight: CGFloat
        var wordHeight: CGFloat
        var metaHeight: CGFloat
        var metaLines: [String]     // 小字折出来的每一行（网页 WebKit 口径：数字串不拆开）
        var columnWidth: CGFloat     // 笔迹小图那一栏的宽（网页 .sz-lrow__thumbcol）
        var columnHeight: CGFloat
        var hasThumb: Bool
    }

    /// 清单的排版结果：每行的框（纯几何，排版时一次算完全部行；视图按它摆）。
    struct RowsLayout {
        /// 清单（网页 .sz-list__rows）在 content 里的上沿（= 顶边 1px 分隔线的上沿）与高（含顶线）。
        var top: CGFloat = 0
        var height: CGFloat = 0
        /// 每行在 content 里的框（行本体 + 行底 1px 分隔线），按行的顺序；第一行从顶线下面开始。
        var frames: [CGRect] = []
        /// 每行行内的排版。
        var boxes: [RowBox] = []
        /// 每行的数据（排这一版时显示的行：「其余」折叠时只有「先练这些」）。
        var data: [View.Row] = []

        /// 行的平均高。
        var averageRowHeight: CGFloat { frames.isEmpty ? 0 : (height - 1) / CGFloat(frames.count) }
    }

    /// 全部行的框：只算数，不碰视图。top = 清单顶线的上沿（content 坐标），x / width = 页边与正文宽。
    func rowsLayout(_ shown: [View.Row], width: CGFloat, x: CGFloat, top: CGFloat) -> RowsLayout {
        var out = RowsLayout()
        out.top = top
        out.data = shown
        out.boxes = shown.map { cachedRowBox($0, width: width) }
        out.height = out.boxes.reduce(0) { $0 + $1.rowHeight } + 1
        out.frames.reserveCapacity(out.boxes.count)
        var y = top + 1
        for box in out.boxes {
            out.frames.append(CGRect(x: x, y: y, width: width, height: box.rowHeight))
            y += box.rowHeight
        }
        return out
    }

    /// rowBox 的输入里随行变的那几样（词语、小字、笔迹小图的说明、有没有笔迹小图）。
    struct RowBoxKey: Hashable {
        let word: String
        let meta: String
        let caption: String
        let noThumb: Bool
    }

    /// rowBox 的输入里随页面变的那几样：栏宽、字号档（rowBox 读的 metrics 的档，与 scaleK 读的系统档）、粗体文字、
    /// 此刻的外观（量字宽的缓存也按它分开）。任何一样变了整份记忆作废。
    struct RowBoxEnv: Equatable {
        let width: CGFloat
        let category: UIContentSizeCategory
        let appCategory: UIContentSizeCategory
        let bold: Bool
        let traits: UITraitCollection
    }

    /// 同 rowBox（逐项相同）：同一份输入算过就用上次的结果。几千行时每次排版（每勾一下都要重拉、重排）不再逐行量字。
    func cachedRowBox(_ row: View.Row, width: CGFloat) -> RowBox {
        let env = RowBoxEnv(width: width, category: metrics.category, appCategory: UIApplication.shared.preferredContentSizeCategory,
                            bold: UIAccessibility.isBoldTextEnabled, traits: UITraitCollection.current)
        if rowBoxMemoEnv != env || rowBoxMemo.count >= 20_000 {
            rowBoxMemo.removeAll(keepingCapacity: true)
            rowBoxMemoEnv = env
        }
        let w = row.word
        let key = RowBoxKey(word: w.has ? w.pre + w.tg + w.post : "", meta: row.meta.text, caption: row.thumbCaption.text, noThumb: row.noThumb)
        if let hit = rowBoxMemo[key] { return hit }
        let box = rowBox(row, width: width)
        rowBoxMemo[key] = box
        return box
    }

    /// 网页 .sz-lrow 的高度：行本体的内容（标准字 / 词语 + 小字 / 笔迹小图）取最高的那个，加上下内边距 20；行本体最小 84。
    /// 大字号时词语与小字折行（网页同），行随内容长高。
    func rowBox(_ row: View.Row, width: CGFloat) -> RowBox {
        let mt = metrics
        let charSide = 44 * LibraryCommon.scaleK()
        let captionW = row.noThumb ? 0 : LibraryCommon.textWidth(row.thumbCaption.text, mt.font(11))
        let columnW = row.noThumb ? 0 : max(44, captionW)
        let columnH = row.noThumb ? 0 : 44 + (row.thumbCaption.text.isEmpty ? 0 : 2 + mt.line("lh11"))
        let openW = max(0, width - 39)
        let gap: CGFloat = 12
        let chevronW: CGFloat = 8
        let mainW = max(0, openW - charSide - gap - (row.noThumb ? 0 : columnW + gap) - chevronW - gap)
        let wordText = row.word.has ? row.word.pre + row.word.tg + row.word.post : ""
        let wordH = wordText.isEmpty ? 0 : CGFloat(LibraryText.lines(wordText, font: ShiziFonts.kai(size: mt.value("fs22")), width: mainW, line: mt.line("lh22"))) * mt.line("lh22")
        // 小字（网页 .sz-lrow__meta）：每段 inline-block，段内按 WebKit 口径折行（数字串不拆开）
        let metaLines = LibraryText.webInlineBlockWrap(metaParts(row.meta.text), separator: " ", font: mt.fontTabular(15), width: mainW)
        let metaH = CGFloat(metaLines.count) * mt.line("lh15")
        let mainH = wordH + (wordH > 0 ? mt.space(1) : 0) + metaH
        let contentH = max(charSide, mainH, columnH)
        let openH = max(84, contentH + 20)
        return RowBox(rowHeight: openH + 1, openHeight: openH, mainWidth: mainW, mainHeight: mainH,
                      wordHeight: wordH, metaHeight: metaH, metaLines: metaLines,
                      columnWidth: columnW, columnHeight: columnH, hasThumb: !row.noThumb)
    }

    /// 网页 listRowMetaParts：小字按「 · 」拆成整段（每段是 inline-block，max-width:100%）。
    private func metaParts(_ text: String) -> [String] {
        let parts = text.components(separatedBy: " · ")
        if parts.count <= 1 { return parts }
        return parts.enumerated().map { i, p in i < parts.count - 1 ? "\(p) ·" : p }
    }

    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat {
        let mt = metrics
        guard let m = model else { return top }
        if m.empty {
            rowsTopLine.isHidden = true
            // 空态没有行：建出来的都收掉
            self.list = RowsLayout()
            rows.setItems([])
            updateRows()
            return layoutEmpty(m, width: width, x: x, top: top)
        }
        var y = top
        // .sz-list__intro（head + gap 8 + top）
        let headH = CGFloat(LibraryText.lines(m.head.text, font: NativeType.song(size: mt.value("fs28"), weight: .medium), width: width, line: mt.line("lh28"))) * mt.line("lh28")
        headLabel.frame = CGRect(x: x, y: y, width: width, height: headH)
        y += headH + 8
        let topH = CGFloat(LibraryText.lineCount(m.top.text, starts: webMetrics?.top, font: mt.font(15), width: width, line: mt.line("lh15"))) * mt.line("lh15")
        topLabel.frame = CGRect(x: x, y: y, width: width, height: topH)
        y += topH
        y += mt.space(6) // .sz-list 的 gap s6
        // .sz-list__rows（顶边 1px 分隔线）
        // 先把全部行的框算好（纯几何），再按框摆
        let shown = restOpen ? m.rows : m.rows.filter { $0.group == "top" }
        let rowsTop = y
        let layout = rowsLayout(shown, width: width, x: x, top: rowsTop)
        self.list = layout
        let rowsH = layout.height
        rowsMarker.frame = CGRect(x: x, y: rowsTop, width: width, height: rowsH)
        rowsTopLine.isHidden = false
        rowsTopLine.backgroundColor = color("line")
        rowsTopLine.frame = CGRect(x: x, y: rowsTop, width: width, height: 1)
        // 行：只建 / 配可见框 ± overscan 里的（滚动时 scrollViewDidScroll 再补；排版收尾时滚动区定了高再核一次）。
        // 内容的版次与行的数据（list.data）在这里一起换：渲染之后、这次排版之前若先滚了一下，那时建的行按旧数据配、记的也是旧版次，
        // 这次排版照样重配（版次若在渲染时就换，那几行会带着新版次、旧内容被跳过）。
        let newContent = contentGeneration != renderGeneration
        contentGeneration = renderGeneration
        rows.setItems(layout.frames)
        updateRows()
        // 字形图缓存一次渲染收一轮（渲染后的这次排版把建出来的行都按新内容配过了）
        if newContent { glyphCache.endPass() }
        y = rowsTop + rowsH
        if m.restCount > 0 {
            y += mt.space(6) // .sz-list 的 gap s6（「其余 N 个字」前）
            let text = (restOpen ? m.restHideLabel : m.restLabel).text
            restButton.composed = text
            restButton.frame = CGRect(x: x - 4, y: y - 12, width: max(44, LibraryCommon.textWidth(text, mt.font(15)) + 8), height: 44)
            y = y - 12 + 44
            y += mt.space(6) // .sz-list 的 gap s6（说明句前）
        } else {
            y += mt.space(6) // .sz-list 的 gap s6（说明句前）
        }
        let noteH = CGFloat(LibraryText.lineCount(m.note.text, starts: webMetrics?.note, font: mt.font(15), width: width, line: mt.line("lh15"))) * mt.line("lh15")
        noteLabel.frame = CGRect(x: x, y: y, width: width, height: noteH)
        y += noteH
        bodyMarker.frame = CGRect(x: x, y: top, width: width, height: y - top)
        layoutFooter(width: width, x: x)
        return y
    }

    /// 一行的框（网页 .sz-lrow 的流：勾选钮 → 行本体 → 标准字 → 词语 / 小字 → 笔迹小图 → ›）与按折行点排好的小字。
    /// frame = 这一行在 content 里的框（RowsLayout.frames）。要在 configureRowContent 之后（说明句的宽按它配的字量）。
    private func configureRowLayout(_ rv: LibraryListRowView, _ box: RowBox, frame: CGRect) {
        let mt = metrics
        let charSide = 44 * LibraryCommon.scaleK()
        let width = frame.width
        rv.frame = frame
        rv.select.frame = CGRect(x: -9, y: (box.openHeight - 44) / 2, width: 44, height: 44)
        rv.open.frame = CGRect(x: 39, y: 0, width: width - 39, height: box.openHeight)
        rv.layoutSeparator(height: 1, color: color("line"))
        let contentH = box.openHeight - 20
        // 词语 / 小字（网页 .sz-lrow__main：竖排两段 + s1 间隔，垂直居中）
        let mainX = charSide + 12
        let mainY = 10 + (contentH - box.mainHeight) / 2
        rv.word.frame = CGRect(x: mainX, y: mainY, width: box.mainWidth, height: box.wordHeight)
        // 小字：按网页的折行点换行（TextKit 会把「10」这样的数字串拆开，网页 WebKit 不拆）
        let metaText = box.metaLines.joined(separator: "\n")
        rv.meta.numberOfLines = 0
        NativeType.set(rv.meta, metaText, font: mt.fontTabular(15), color: color("ink2"), line: mt.line("lh15"))
        let metaW = max(box.mainWidth, box.metaLines.map { LibraryCommon.textWidth($0, mt.fontTabular(15)) }.max() ?? 0)
        rv.meta.frame = CGRect(x: mainX, y: mainY + box.wordHeight + (box.wordHeight > 0 ? mt.space(1) : 0), width: metaW, height: box.metaHeight)
        // 笔迹小图（网页 .sz-lrow__thumbcol：方图 + 说明句，竖排）
        if box.hasThumb {
            let columnX = mainX + box.mainWidth + 12
            let columnY = 10 + (contentH - box.columnHeight) / 2
            let thumbX = columnX + (box.columnWidth - 44) / 2
            rv.thumb.isHidden = false
            rv.thumb.frame = CGRect(x: thumbX, y: columnY, width: 44, height: 44)
            rv.inkView.frame = CGRect(x: thumbX, y: columnY, width: 44, height: 44)
            rv.noInk.frame = CGRect(x: thumbX + (44 - 26.4) / 2, y: columnY, width: 26.4, height: 44)
            rv.caption.frame = CGRect(x: columnX + (box.columnWidth - rv.caption.intrinsicContentSize.width) / 2, y: columnY + 44 + 2,
                                     width: rv.caption.intrinsicContentSize.width, height: mt.line("lh11"))
        } else {
            rv.thumb.isHidden = true
            rv.thumb.frame = .zero // 藏着（不画）；清掉上一行的框，用过的行与新建的行状态相同
            rv.inkView.frame = .zero
            rv.noInk.frame = .zero
            rv.caption.frame = .zero
        }
        // 行尾的 ›（网页 Chevron：8 × 13，垂直居中）
        rv.chevron.frame = CGRect(x: width - 39 - 8, y: 10 + (contentH - 13) / 2, width: 8, height: 13)
    }

    /// 系统字号档的连续倍率（网页 --k；AX 档的 --fsN 不乘 --k，但格边长乘）。
    private var scaleK: CGFloat { LibraryCommon.scaleK() }

    private func layoutEmpty(_ m: View, width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat {
        let mt = metrics
        let bodyH = max(0, scroll.bounds.height - top - mt.space(8))
        emptyMarker.frame = CGRect(x: x, y: top, width: width, height: bodyH)
        let k = scaleK
        let cellSide = 72 * k
        let titleH = mt.line("lh22")
        let bodyTextH = mt.line("lh15")
        // .sz-empty：上下内边距 s8 / s6，内容居中；内容 = 格子（自带 s2 下外边距）+ s2 间隔 + 标题 + s2 间隔 + 说明句
        let contentH = cellSide + mt.space(2) * 2 + titleH + mt.space(2) + bodyTextH
        let avail = max(0, bodyH - mt.space(8) - mt.space(6))
        let contentTop = top + mt.space(8) + max(0, (avail - contentH) / 2)
        let screenW = view.bounds.width
        emptyCell.frame = CGRect(x: (screenW - cellSide) / 2, y: contentTop, width: cellSide, height: cellSide)
        emptyCell.backgroundColor = color("sheet")
        emptyCell.layer.borderWidth = mt.value("frame-w")
        emptyCell.layer.borderColor = color("frame").cgColor
        emptyGlyph.image = LibraryGlyph.image(m.emptyGlyph.text, size: cellSide * 0.6, face: 1 / 1.1, color: color("under"))
        emptyGlyph.frame = CGRect(x: cellSide * 0.2, y: cellSide * 0.2, width: cellSide * 0.6, height: cellSide * 0.6)
        emptyTitle.frame = CGRect(x: x, y: contentTop + cellSide + mt.space(2) * 2, width: width, height: titleH)
        emptyBody.frame = CGRect(x: x, y: contentTop + cellSide + mt.space(2) * 2 + titleH + mt.space(2), width: width, height: bodyTextH)
        bodyMarker.frame = .zero
        return top + bodyH
    }

    private func layoutFooter(width: CGFloat, x: CGFloat) {
        let mt = metrics
        let innerX = mt.gutter
        let innerW = view.bounds.width - 2 * mt.gutter
        if failed {
            hintLabel.isHidden = true
            goButton.isHidden = true
            kit.layoutFailBlock(x: innerX, width: innerW)
        } else {
            kit.failNote.isHidden = true
            kit.failCancel.isHidden = true
            kit.failRetry.isHidden = true
            hintLabel.isHidden = false
            goButton.isHidden = false
            // 底栏里的东西用底栏自己的坐标
            let hintH = hintHeight
            hintLabel.frame = CGRect(x: innerX, y: mt.space(3), width: innerW, height: hintH)
            goButton.frame = CGRect(x: innerX, y: mt.space(3) + hintH + mt.space(3), width: innerW, height: mt.value("btn-h"))
        }
    }

    override func viewDidLayoutSubviews() {
        kit.layoutFoot(hasFooter: hasFooter, contentHeight: footContentHeight)
        super.viewDidLayoutSubviews()
        kit.trailHeight = trailHeight
        kit.layoutHeader(trailButtonWidth: trailButtonWidth, trailSlotWidth: trailSlotWidth)
        kit.adjustScroll(hasFooter: hasFooter)
        updateRows() // 滚动区的高到这里才定（底栏让出之后）
    }
}
