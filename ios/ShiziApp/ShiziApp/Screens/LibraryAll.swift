import UIKit

// B3.8 原生字库子页 · 全部字页（照网页版 1:1 移植；视图模型 allModel，
// App API view.library-all / library.all.start）。
// 屏名 ⇄ 类：library-all ⇄ ShiziScreen_library_all。推入页。
//
// 版式按网页 CSS 逐项排（.sz-all* / 墙的 Glyph / Legend / 底部弹层），数值全部取 ShiziTokens：
//   页头「已练汉字」+ 尾端文字按钮「排序 · 筛选」；正文：查字框（吸顶、命中时右侧「在 {月}」）→ 分组（组名 + 字数 + 墙格；拼音排序每格下标拼音）
//   → 收起的月份 →「看这些字 ›」；底栏：主按钮「练这些字」。
// 「排序 · 筛选」是底部弹层（网页；原生用一个呈现出来的原生控制器）。

@objc(ShiziScreen_library_all)
final class LibraryAllScreen: ShiziScreenViewController, UIScrollViewDelegate {
    struct Cell: Decodable {
        struct Rec: Decodable { let id: String }
        let char: String
        let kind: String
        let tone: Int?
        let py: String?
        let hit: Bool
        let record: Rec?
    }
    struct Group: Decodable {
        let key: String
        let head: Bool
        let name: FlexText
        let count: FlexText
        let tone: Int?
        let fold: String?
        let month: String?
        let cells: [Cell]
    }
    struct Closed: Decodable {
        let month: String
        let name: FlexText
        let count: Int
    }
    struct Sort: Decodable {
        let key: String
        let label: FlexText
        let active: Bool
    }
    struct Chip: Decodable {
        let key: String
        let label: FlexText
        let n: Int
        let active: Bool
        let disabled: Bool
    }
    struct Find: Decodable {
        let text: String
        let mode: String
        let found: Bool
        let whereText: FlexText
        let miss: FlexText
        enum CodingKeys: String, CodingKey {
            case text, mode, found, miss
            case whereText = "where"
        }
    }
    struct Go: Decodable {
        let kind: String
        let listKind: String?
        let keys: [String]?
    }
    struct View: Decodable {
        let cols: Int
        let empty: Bool
        let sort: String
        let filter: String
        let sorts: [Sort]
        let showSort: Bool
        let chips: [Chip]
        let showChips: Bool
        let showLegend: Bool
        let note: FlexText
        let find: Find
        let groups: [Group]
        let closed: [Closed]
        let go: Go?
        let total: Int
    }

    /// 收起的月份按钮（网页 .sz-all__month.sz-btn：月份名 17 / ink1 在左，字数 15 / ink2 在右，中间 space-between）。
    /// 按钮自己不给文字（原生按钮不画字，字放在子视图里），但要给整块文字（网页按钮的 innerText）。
    final class MonthButton: ShiziLineButton {
        let nameLabel = UILabel()
        let countLabel = UILabel()

        override init(frame: CGRect) {
            super.init(frame: frame)
            addSubview(nameLabel)
            addSubview(countLabel)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    }

    /// 墙上的一格：按钮（字形图 / 读屏名 / 点按；拼音标签、朱点、命中圈在按钮里）+ 墨迹小图（与按钮同级、压在按钮上面）。
    @MainActor
    final class CellSlot {
        let button = ShiziLineButton(type: .custom)
        let ink = LibraryInkView()
        let py = UILabel()
        /// 上次按哪一格（墙上的序号）、哪一次渲染（renderGeneration）配的内容；都没变时重排只重摆框。
        var index = -1
        var generation = -1
    }

    /// 一个分组（网页 .sz-all__group：组名 + 字数 + 墙格）。
    final class GroupView: UIView {        let headButton = ShiziLineButton(type: .custom) // 按月排时组名是可点的（网页 .sz-all__head.sz-btn）
        let headView = UIView() // 其余排序时组名是一行文字
        let nameLabel = UILabel()
        let countLabel = UILabel()
        let cellsMarker = UIView()

        override init(frame: CGRect) {
            super.init(frame: frame)
            isAccessibilityElement = false
            addSubview(headView)
            addSubview(headButton)
            addSubview(cellsMarker)
            headView.addSubview(nameLabel)
            headView.addSubview(countLabel)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    }

    /// 网页量出来的值（B3.8）：组头的高、说明句（pretty）的折行点、页头尾端按钮的宽、弹层排序键的折行点。
    struct WebMetrics: Decodable {
        let headHeights: [Double?]?
        let note: [Int]?
        let menuWidth: Double?
        let sortLines: [[Int]?]?
    }

    /// 墙的排版结果：每组、每格的框（纯几何，排版时一次算完全部；视图按它摆）。
    struct WallLayout {
        struct GroupBox {
            /// 组在 content 里的框（网页 .sz-all__group）。
            var frame: CGRect
            /// 组头的高（没有组头 = 0）；墙格（cellsMarker）在组里的上沿与高。
            var headH: CGFloat
            var gridTop: CGFloat
            var gridH: CGFloat
            /// 组名 / 字数在组头里的框。
            var nameFrame: CGRect
            var countFrame: CGRect
            /// 这一组第一格在 cells 里的序号、格数。
            var firstCell: Int
            var cellCount: Int
        }
        var groups: [GroupBox] = []
        /// 格宽（整面墙一样宽）。
        var cellW: CGFloat = 0
        /// 每格在所在组的墙格（cellsMarker）里的框；按组、组里按格的顺序排平。
        var cells: [CGRect] = []
        /// 每格在 content 里的框（= 组的原点 + 墙格的上沿 + 格在墙格里的框）。
        var cellsInContent: [CGRect] = []
        /// 每格属于第几组。
        var cellGroup: [Int] = []
        /// 每格的数据（排这一版时的模型）。
        var cellData: [Cell] = []
        /// 最后一组的下沿（content 坐标）。
        var bottom: CGFloat = 0
    }

    // 正文
    private let bodyMarker = UIView()
    private let findField = UIView()
    private let findIcon = UIImageView()
    private let findInput = UITextField()
    private let findPlaceholder = LibraryPlaceholderView()
    private let findWhere = UILabel()
    private let findMiss = UILabel()
    private var groupViews: [GroupView] = []
    private let closedMarker = UIView()
    private var monthButtons: [MonthButton] = []
    private let listButton = ShiziLineButton(type: .custom)
    // 底栏
    private let goButton = ShiziPrimaryButton(type: .custom)

    private var model: View?
    /// 网页量出来的值（组头的高 / 折行点 / 按钮宽）。
    private var webMetrics: WebMetrics?
    /// 回包 ink（按需解码：只解建出来的格子的记录）。
    private let inkStore = LibraryInkStore()
    /// 第几次渲染（render 一次加一）：格子的内容（拼音 / 读屏名 / 墨迹）按渲染配，框按排版配。
    private var renderGeneration = 0
    /// 此刻的 wall（格子的数据与框）是按第几次渲染的模型排出来的：layoutBody 在 setItems 之前设成 renderGeneration。
    /// 格子内容按它记（不按 renderGeneration）：渲染之后、排版之前来的滚动建格子用的还是旧 wall 的数据，不能记成新的一次渲染。
    private var wallGeneration = -1
    /// 可见框上下各多建几屏高的格子。2.5 屏：冻结的逐屏基线里最深的格子（all-pinyin XXXL：内容里 2357.5pt，可视区 768pt）
    /// 要在打开时就建出来（取证连屏外滚得到的元素一起记），需要 ≥ 2.07 屏。
    static let overscanViewports: CGFloat = 2.5
    /// 墙上的格子：只建可见框 ± overscan 里的（ShiziLazyCells）。序号 = wall.cells 的序号。
    private(set) lazy var cells = ShiziLazyCells<CellSlot>(
        make: { [unowned self] _ in self.makeCell() },
        attach: { [unowned self] s, i, following in self.attachCell(s, i, following) },
        detach: { s in
            s.button.isHighlighted = false
            s.button.removeFromSuperview()
            s.ink.removeFromSuperview()
        },
        configure: { [unowned self] s, i in self.configureCell(s, i) })
    /// 最近一次排版算出的全部组 / 格的框。
    private(set) var wall = WallLayout()
    /// 墙格的字形图（每次排版都要给每格一张；输入没变就用上次那张）。
    private let glyphCache = LibraryGlyphCache()
    private var sort: String?
    private var filter: String?
    private var fold: [String: Bool]?
    private var find: String = ""
    private var failed = false {
        didSet { view.setNeedsLayout() }
    }

    override var watchedDomains: [String]? { ["records", "sched", "ink", "settings", "custom"] }

    /// 有没有底栏（模型里没有「练这些字」就没有底栏）。
    var hasFooter: Bool { model?.go != nil }

    /// 底栏内容的高（主按钮）。
    var footContentHeight: CGFloat { metrics.value("btn-h") }

    /// 共用底座（页头右槽 + 底栏 + 三段式）。
    private let kit = LibraryScreenKit()

    /// 页头尾端「排序 · 筛选」（网页 .sz-btn--text：文字宽 + 8、左右外边距 −4）。
    var trailButtonWidth: CGFloat {
        guard let m = model, m.showSort || m.showChips else { return 44 }
        if let w = webMetrics?.menuWidth, w > 0 { return CGFloat(w) } // 网页量出来的宽（字宽 + 内边距）
        return LibraryCommon.textWidth(t("X-ALL.menuLabel"), metrics.font(15)) + 8
    }

    /// 右槽槽宽（文字按钮两侧各 −4）。
    var trailSlotWidth: CGFloat { max(44, trailButtonWidth - 8) }

    /// AX 档右槽按钮的高（网页：文字按钮 min-height = max(44px, calc(1.3em + 12px))）。
    var trailHeight: CGFloat { axLayout ? LibraryCommon.axTextButtonHeight(fontSize: metrics.value("fs15")) : 44 }

    override func viewDidLoad() {
        // 右槽的按钮要先建好：基类的 viewDidLoad 里会立刻渲染视图（那时按钮还不存在，文案就丢了）。
        kit.prepare(screen: self, trailId: "native-library-all-menu-open", onTrail: { [weak self] in self?.openMenu() },
                   failIdPrefix: "native-library-all", failText: t("X-ALL.startFailed"), failCancelText: t("X-LIST.startStay"),
                   onFailCancel: { [weak self] in self?.clearFailed() }, onFailRetry: { [weak self] in self?.retryFailed() })
        super.viewDidLoad()
        kit.attach()
        bodyMarker.isUserInteractionEnabled = false // 取证用的标记框，不吃点按
        bodyMarker.accessibilityIdentifier = "native-library-all-body"
        findField.accessibilityIdentifier = "native-library-all-find-field"
        findInput.accessibilityIdentifier = "native-library-all-find"
        findWhere.accessibilityIdentifier = "native-library-all-find-where"
        findMiss.accessibilityIdentifier = "native-library-all-find-miss"
        closedMarker.accessibilityIdentifier = "native-library-all-closed"
        listButton.accessibilityIdentifier = "native-library-all-list"
        goButton.accessibilityIdentifier = "native-library-all-go"
        content.addSubview(bodyMarker)
        content.addSubview(findField)
        findField.addSubview(findIcon)
        findField.addSubview(findInput)
        findField.addSubview(findPlaceholder)
        findField.addSubview(findWhere)
        content.addSubview(findMiss)
        content.addSubview(closedMarker)
        content.addSubview(listButton)
        kit.foot.addSubview(goButton)
        wire(listButton) { page in (page as? LibraryAllScreen)?.openList() }
        wire(goButton) { page in (page as? LibraryAllScreen)?.start() }
        findInput.addTarget(self, action: #selector(findChanged), for: .editingChanged)
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
        setTitle(t("X-LIBHOME.recordedLabel"))
        renderModel(m)
    }

    /// 重拉视图时带上本页的视图参数（网页把它们写进路由 params）。
    override func reload() {
        guard let engine = stage?.engine else { return }
        let screen = self.screen
        var args: [String: Any] = [:]
        if let sort { args["sort"] = sort }
        if let filter { args["filter"] = filter }
        if let fold { args["fold"] = fold }
        args["find"] = find
        args["width"] = Double(view.bounds.width)
        args["large"] = isLargeText
        Task { @MainActor [weak self] in
            let body = await engine.raw("view.\(screen)", args)
            self?.apply(payload: body)
        }
    }

    /// 系统大字号（网页 useWallLayout 的 compact：大字号时墙最多 6 列；口径同网页 --k ≥ policy.compactTextScale）。
    private var isLargeText: Bool { LibraryCommon.isLargeText() }

    private func renderModel(_ m: View) {
        let mt = metrics
        // 页头尾端
        if let b = kit.trail {
            b.composed = t("X-ALL.menuLabel")
            b.lineFont = mt.font(15)
            b.setTitleColor(color("ink2"), for: .normal)
            b.isHidden = !(m.showSort || m.showChips)
        }
        // 查字框
        findField.backgroundColor = color("field")
        findField.layer.cornerRadius = mt.value("r-ctl")
        if m.find.found { findField.backgroundColor = color("sheet") }
        // 网页 .sz-all__find--hit：找到了 → 面板底色 + 1pt 内描边（ink2）
        findField.layer.borderWidth = m.find.found ? 1 : 0
        findField.layer.borderColor = color("ink2").resolvedColor(with: traitCollection).cgColor
        findIcon.image = LibraryIcon.search(color("ink2"))
        findIcon.contentMode = .scaleAspectFit
        findInput.backgroundColor = .clear
        findInput.borderStyle = .none
        findInput.font = ShiziFonts.kai(size: mt.value("fs22"))
        findInput.textColor = color("ink1")
        findInput.accessibilityLabel = t("R-A03.searchAria")
        // 提示字自己画（网页的 placeholder 不是 DOM 文字节点；系统 UITextField 的占位标签会被当成文字元素）
        findPlaceholder.text = t("R-Q01.titleLookup")
        findPlaceholder.font = mt.font(17)
        findPlaceholder.ink = color("ink2")
        if findInput.text != m.find.text { findInput.text = m.find.text }
        findPlaceholder.isHidden = !(findInput.text ?? "").isEmpty
        findWhere.numberOfLines = 0
        NativeType.set(findWhere, m.find.whereText.text, font: mt.font(15), color: color("ink2"), line: mt.line("lh15"))
        findWhere.isHidden = m.find.whereText.text.isEmpty
        findMiss.numberOfLines = 0
        NativeType.set(findMiss, m.find.miss.text, font: mt.font(13), color: color("ink3"), line: mt.line("lh13"))
        findMiss.isHidden = m.find.miss.text.isEmpty
        // 分组
        syncGroups(m)
        // 收起的月份
        syncClosed(m)
        // 「看这些字 ›」
        listButton.drawsComposed = true
        listButton.composed = t("X-ALL.viewThese")
        listButton.lineFont = mt.font(15)
        listButton.setTitleColor(color("ink2"), for: .normal)
        listButton.isHidden = !(m.go?.kind == "list")
        // 底栏主按钮
        goButton.style(enabled: true, title: t("R-A02.practiceThese"), font: mt.font(17, .medium), radius: mt.value("r-ctl"),
                       bg: color("btn-bg"), fg: color("btn-fg"), disabledBg: color("field"), disabledFg: color("ink4"))
        kit.styleFail()
        view.setNeedsLayout()
    }

    private func syncGroups(_ m: View) {
        let mt = metrics
        while groupViews.count < m.groups.count {
            let gv = GroupView()
            gv.accessibilityIdentifier = "native-library-all-group"
            gv.headButton.accessibilityIdentifier = "native-library-all-group-head"
            gv.headView.accessibilityIdentifier = "native-library-all-group-head"
            gv.nameLabel.accessibilityIdentifier = "native-library-all-group-name"
            gv.countLabel.accessibilityIdentifier = "native-library-all-group-count"
            gv.cellsMarker.accessibilityIdentifier = "native-library-all-cells"
            // 墙格容器要接点按：格子按钮是它的子视图，关掉它的 isUserInteractionEnabled 会让命中测试整片跳过（真手指点格子没反应）。
            // 墨格 / 拼音各自关了点按，点按落到下面的格子按钮上。
            groupViews.append(gv)
            content.addSubview(gv)
            wire(gv.headButton) { [weak gv] page in (page as? LibraryAllScreen)?.foldGroup(gv) }
        }
        while groupViews.count > m.groups.count { groupViews.removeLast().removeFromSuperview() }
        for (gi, group) in m.groups.enumerated() {
            let gv = groupViews[gi]
            // 网页 .sz-all__group：组头有三种——没有组头（筛选出来的那一组）/ 一行文字 / 可点的月份标题
            let isHead = group.head
            let isFoldButton = isHead && group.fold == "open"
            gv.headButton.isHidden = !isFoldButton
            gv.headView.isHidden = !isHead || isFoldButton
            gv.nameLabel.isHidden = !isHead
            gv.countLabel.isHidden = !isHead
            // 组名 / 字数在按月排时画在按钮里，其余排序画在普通容器里（网页同一份文字，两个容器二选一）
            if isFoldButton {
                gv.headButton.addSubview(gv.nameLabel)
                gv.headButton.addSubview(gv.countLabel)
            } else {
                gv.headView.addSubview(gv.nameLabel)
                gv.headView.addSubview(gv.countLabel)
            }
            // 组名（网页 .sz-all__name：宋 22 / 500 / ink2；按月排时组名是按钮里的文字）
            let nameFont = NativeType.song(size: mt.value("fs22"), weight: .medium)
            NativeType.set(gv.nameLabel, group.name.text, font: nameFont, color: color("ink2"), line: mt.line("lh22"))
            ShiziFonts.untrack(gv.nameLabel)
            NativeType.set(gv.countLabel, group.count.text, font: mt.fontTabular(15), color: color("ink2"), line: mt.line("lh15"))
            gv.headButton.composed = [group.name.text, group.count.text].joined(separator: " ")
            gv.headButton.lineFont = mt.font(15)
            gv.headButton.setTitleColor(color("ink1"), for: .normal)
        }
        // 格子在排版时按框建 / 配（layoutBody → updateCells）；这一次渲染的内容要重配
        renderGeneration += 1
    }

    /// 第 i 格放进它那一组的墙格：插在 following（下一个已建好的格子）前面，同一组里按序号排（按钮、墨迹小图紧挨着）。
    /// 已经在这一组的墙格里就不动（同一组里留下来的格子之间的先后本来就按序号）。
    private func attachCell(_ s: CellSlot, _ i: Int, _ following: CellSlot?) {
        guard i < wall.cellGroup.count else { return }
        let gi = wall.cellGroup[i]
        guard gi < groupViews.count else { return }
        let marker = groupViews[gi].cellsMarker
        if s.button.superview === marker, s.ink.superview === marker { return }
        if let f = following, f.button.superview === marker {
            marker.insertSubview(s.button, belowSubview: f.button)
        } else {
            marker.addSubview(s.button)
        }
        marker.insertSubview(s.ink, aboveSubview: s.button)
    }

    /// 按第 i 格配：内容（换了格子或有新的渲染）+ 框（每次排版）。池子里拿出来的格子带着上一格的状态，内容与框里的每一样都重设。
    private func configureCell(_ s: CellSlot, _ i: Int) {
        guard i < wall.cellData.count else { return }
        let cell = wall.cellData[i]
        if s.index != i || s.generation != wallGeneration {
            configureCellContent(s, cell)
            s.index = i
            s.generation = wallGeneration
        }
        configureCellLayout(s, cell, frame: wall.cells[i], cellW: wall.cellW)
    }

    /// 按此刻的滚动位置建 / 收格子（排版后、滚动时）。外观按本页的（滚动回调里 UITraitCollection.current 不一定是本页的）。
    func updateCells() {
        cells.overscan = max(0, scroll.bounds.height) * Self.overscanViewports
        let visible = scroll.bounds
        traitCollection.performAsCurrent { cells.update(visible: visible) }
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        guard scrollView === scroll, isViewLoaded else { return }
        // 渲染过、还没排版：wall 是旧模型的，等排版（已经标了 setNeedsLayout）按新的 wall 建
        guard wallGeneration == renderGeneration else { return }
        updateCells()
        // 滚动时新建的格子的字形图也进了缓存（一轮 = 一次排版，滚动不排版）：这一轮攒到建出来的格子数的两倍（至少 256 张）就收一轮；
        // 收掉的图还在格子上显示着，只是下一次排版重配时要重画（与现画的逐字节相同）。留两倍：滚过一屏多之后再排版（查字框打字）多半还命中
        if glyphCache.count > max(256, 2 * cells.liveIndices.count) { glyphCache.endPass() }
    }

    /// 新建一格（按钮里放拼音标签；点按 → 这一格的字的详情）。
    private func makeCell() -> CellSlot {
        let s = CellSlot()
        s.button.accessibilityIdentifier = "native-library-all-cell"
        s.py.isUserInteractionEnabled = false
        s.button.addSubview(s.py)
        wire(s.button) { [weak b = s.button] page in (page as? LibraryAllScreen)?.openCell(b) }
        return s
    }

    /// 一格的内容：拼音、读屏名、墨迹（有就画墨）或标准字形的颜色。框与字形图在 configureCellLayout。
    private func configureCellContent(_ s: CellSlot, _ cell: Cell) {
        let mt = metrics
        let b = s.button, inkView = s.ink, pyLabel = s.py
        pyLabel.numberOfLines = 1
        if let py = cell.py, !py.isEmpty {
            NativeType.set(pyLabel, py, font: mt.font(11), color: color("ink2"), align: .center, line: mt.line("lh11"))
            pyLabel.isHidden = false
        } else {
            pyLabel.isHidden = true
        }
        // 有本人的笔迹就画墨，没墨才画标准字形（网页的 Glyph：墨迹有就画墨、没有就画字形）
        let inked = hasInk(cell)
        var parts: [String] = []
        if !inked { parts.append(cell.char) }
        if let py = cell.py, !py.isEmpty { parts.append(py) }
        b.composed = parts.joined(separator: " ")
        b.lineFont = mt.font(15)
        b.setTitleColor(color("ink1"), for: .normal)
        b.accessibilityLabel = cellLabel(cell)
        b.iconSize = .zero
        b.setImage(nil, for: .normal)
        // 墨迹只设一次（以前先清空再设回同一份，墨迹小图每次重拉都整张重画）
        var cellStrokes: [[LibraryInkView.Point]] = []
        if inked, let strokes = inkOf(cell), !strokes.isEmpty { cellStrokes = strokes }
        inkView.strokes = cellStrokes
        inkView.isHidden = cellStrokes.isEmpty
        if !inked {
            let tone = cell.tone ?? 3
            let glyphColor = cell.kind == "hollow" ? color("ink4") : color(wallToken(tone))
            b.setImage(LibraryGlyph.image(cell.char, size: 0, face: 0.8, color: glyphColor, hollow: cell.kind == "hollow"), for: .normal)
        } else if !cellStrokes.isEmpty {
            inkView.ink = color(wallToken(cell.tone ?? 3))
        }
    }

    /// 一格的框（墙格坐标）、字形图（按格宽）、墨迹小图的框、朱点与命中圈。
    private func configureCellLayout(_ s: CellSlot, _ cell: Cell, frame: CGRect, cellW: CGFloat) {
        let mt = metrics
        let b = s.button, inkView = s.ink
        let cx = frame.minX, cy = frame.minY
        b.frame = frame
        if !hasInk(cell) {
            b.iconSize = CGSize(width: cellW, height: cellW)
            b.iconAtLeading = true
            b.iconAtTop = true
            b.iconCentered = false
            let tone = cell.tone ?? 3
            let glyphColor = cell.kind == "hollow" ? color("ink4") : color(wallToken(tone))
            b.setImage(glyphCache.image(cell.char, size: cellW, face: 0.8, color: glyphColor, hollow: cell.kind == "hollow"), for: .normal)
        } else {
            b.iconSize = .zero
            b.iconAtTop = false
            b.setImage(nil, for: .normal)
        }
        inkView.frame = CGRect(x: cx + cellW * 0.04, y: cy + cellW * 0.04, width: cellW * 0.92, height: cellW * 0.92)
        // 写错过的朱点（网页 .sz-lib__mark：右 9% 上 9%，6pt 圆）与查找命中的圈（.sz-all__ring：内缩 1pt、2pt 内描边）
        let mark = b.viewWithTag(9001) ?? { let v = UIView(); v.tag = 9001; v.isUserInteractionEnabled = false; b.addSubview(v); return v }()
        mark.isHidden = cell.kind != "wrong"
        mark.backgroundColor = color("zhu")
        mark.layer.cornerRadius = 3
        mark.frame = CGRect(x: cellW * 0.91 - 6, y: cellW * 0.09, width: 6, height: 6)
        let ring = b.viewWithTag(9002) ?? { let v = UIView(); v.tag = 9002; v.isUserInteractionEnabled = false; b.addSubview(v); return v }()
        ring.isHidden = !cell.hit
        ring.layer.cornerRadius = mt.value("r-work")
        ring.layer.borderWidth = 2
        ring.layer.borderColor = color("ink1").resolvedColor(with: traitCollection).cgColor
        ring.frame = CGRect(x: 1, y: 1, width: cellW - 2, height: cellW - 2)
        s.py.frame = CGRect(x: 0, y: cellW - 2, width: cellW, height: mt.line("lh11"))
    }

    /// 多久没写 → 墙色（网页的 TONE_COLOR_VARS：wall1…wall4）。
    private func wallToken(_ tone: Int) -> String {
        switch tone {
        case 0: return "wall1"
        case 1: return "wall2"
        case 2: return "wall3"
        default: return "wall4"
        }
    }

    /// 这一格有没有本人的笔迹（网页的 Glyph：有墨就画墨、没墨才画标准字形）。
    private func hasInk(_ cell: Cell) -> Bool {
        guard cell.kind == "ink", cell.record?.id != nil else { return false }
        return !(inkOf(cell) ?? []).isEmpty
    }

    /// 这一格的记录的笔画（回包 ink 里没有这条记录 = nil）。
    private func inkOf(_ cell: Cell) -> [[LibraryInkView.Point]]? {
        guard let rid = cell.record?.id, inkStore.has(rid) else { return nil }
        return inkStore.strokes(rid)
    }

    /// 格子给读屏的名字（网页的 cellLabel）。
    private func cellLabel(_ cell: Cell) -> String {
        let status: String
        if cell.kind == "hollow" { status = t("R-A02.filterCustomUnwritten") }
        else if cell.kind == "wrong" { status = t("R-E04.titleWrong") }
        else { status = t(LibraryAllScreen.toneKey(cell.tone ?? 3)) }
        return t("X-LIBHOME.cellAria", ["char": cell.char, "status": status])
    }

    /// 新旧档 → 文案键（网页的 TONE_KEYS）。
    static func toneKey(_ tone: Int) -> String {
        switch tone {
        case 0: return "X-LIBHOME.tone0"
        case 1: return "X-LIBHOME.tone1"
        case 2: return "X-LIBHOME.tone2"
        default: return "R-L03.toneOldest"
        }
    }

    private func syncClosed(_ m: View) {
        while monthButtons.count < m.closed.count {
            let b = MonthButton(type: .custom)
            b.accessibilityIdentifier = "native-library-all-month"
            monthButtons.append(b)
            closedMarker.addSubview(b)
            wire(b) { [weak b] page in (page as? LibraryAllScreen)?.openMonth(b) }
        }
        while monthButtons.count > m.closed.count { monthButtons.removeLast().removeFromSuperview() }
        let mt = metrics
        for (i, month) in m.closed.enumerated() {
            let b = monthButtons[i]
            let name = month.name.text
            let count = t("X-ALL.closedCount", ["n": String(month.count)])
            b.composed = "\(name) \(count)"
            b.lineFont = mt.font(15)
            b.setTitleColor(color("ink1"), for: .normal)
            // 月份名 17 / ink1；字数 15 / ink2（网页 .sz-all__mname / .sz-all__mcount）
            NativeType.set(b.nameLabel, name, font: mt.font(17), color: color("ink1"), line: mt.line("lh15"))
            NativeType.set(b.countLabel, count, font: mt.fontTabular(15), color: color("ink2"), line: mt.line("lh15"))
        }
        closedMarker.isHidden = m.closed.isEmpty
    }

    // MARK: 动作
    /// 输入法闸门（与查询页 Query.editingChanged 同）：拼音还在组字（markedTextRange 不为空）时还不是要找的字，不重拉；
    /// 选定 / 取消组字时会再来一次 editingChanged，那时按定下的文字找。文字没变也不重拉。
    @objc private func findChanged() {
        let text = findInput.text ?? ""
        findPlaceholder.isHidden = !text.isEmpty
        guard findInput.markedTextRange == nil else { return }
        guard text != find else { return }
        markStateChange()
        find = text
        reload()
    }

    /// 点格子 → 单字详情（网页的 openDetail）。
    private func openCell(_ b: ShiziLineButton?) {
        guard let b else { return }
        var char = ""
        // 建出来的格子里找这个按钮是第几格，字取这一格配的数据（同一份 wall）
        if let i = cells.index(where: { $0.button === b }), i < wall.cellData.count { char = wall.cellData[i].char }
        guard !char.isEmpty else { return }
        Task { @MainActor [weak self] in
            guard let engine = self?.stage?.engine else { return }
            _ = await engine.raw("nav.push", ["screen": "detail", "params": ["char": char]])
        }
    }

    /// 「看这些字 ›」→ 推入对应的区清单页。
    private func openList() {
        guard let m = model, let go = m.go, go.kind == "list", let listKind = go.listKind else { return }
        Task { @MainActor [weak self] in
            guard let engine = self?.stage?.engine else { return }
            _ = await engine.raw("nav.push", ["screen": "library-list", "params": ["kind": listKind]])
        }
    }

    /// 展开 / 收起一个月份（网页的 onFold）。
    private func foldGroup(_ gv: GroupView?) {
        guard let gv, let m = model else { return }
        guard let gi = groupViews.firstIndex(where: { $0 === gv }), gi < m.groups.count else { return }
        let month = m.groups[gi].month ?? ""
        markStateChange()
        var cur = fold ?? [:]
        cur[month] = false
        fold = cur
        reload()
    }

    private func openMonth(_ b: ShiziLineButton?) {
        guard let b, let m = model else { return }
        guard let idx = monthButtons.firstIndex(where: { $0 === b }), idx < m.closed.count else { return }
        markStateChange()
        var cur = fold ?? [:]
        cur[m.closed[idx].month] = true
        fold = cur
        reload()
    }

    /// 「练这些字」（网页的 onGo → startAllGroup）。
    private func start() {
        guard let m = model, let go = m.go else { return }
        Task { @MainActor [weak self] in
            guard let self, let engine = self.stage?.engine else { return }
            var args: [String: Any] = ["kind": go.kind]
            if let listKind = go.listKind { args["listKind"] = listKind }
            if let keys = go.keys { args["keys"] = keys }
            let body = await engine.raw("library.all.start", args)
            let ok = (body["ok"] as? Bool) == true
            await MainActor.run {
                self.markStateChange()
                self.failed = !ok
                self.view.setNeedsLayout()
            }
        }
    }

    func clearFailed() {
        markStateChange()
        failed = false
        view.setNeedsLayout()
    }

    func retryFailed() { start() }

    /// 「排序 · 筛选」弹层。
    private func openMenu() {
        guard let m = model else { return }
        let sheet = LibraryAllMenuController(model: m, noteStarts: webMetrics?.note, sortLines: webMetrics?.sortLines)
        sheet.onSort = { [weak self] key in
            guard let self else { return }
            self.markStateChange()
            self.sort = key
            self.reload()
        }
        sheet.onChip = { [weak self] key in
            guard let self else { return }
            self.markStateChange()
            self.filter = (self.filter == key) ? "" : key
            self.reload()
        }
        sheet.onDone = { [weak self] in
            self?.dismiss(animated: true)
        }
        present(sheet, animated: true)
    }

    // MARK: 排版

    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat {
        let mt = metrics
        guard let m = model else { return top }
        var y = top
        // 查字框（网页 .sz-all__findbar：sticky、上内边距 s4、下内边距 s1）
        let fieldH = max(50 * scaleK, mt.line("lh22"))
        findField.frame = CGRect(x: x, y: y, width: width, height: fieldH)
        let iconSide: CGFloat = 18
        // 框里的东西按框自己的坐标摆（框是它们的父视图）
        findIcon.frame = CGRect(x: mt.space(4), y: (fieldH - iconSide) / 2, width: iconSide, height: iconSide)
        let whereW = findWhere.isHidden ? 0 : LibraryCommon.textWidth(m.find.whereText.text, mt.font(15))
        let inputX = mt.space(4) + iconSide + mt.space(3)
        let inputW = max(0, width - 2 * mt.space(4) - iconSide - mt.space(3) - (whereW > 0 ? whereW + mt.space(3) : 0))
        findInput.frame = CGRect(x: inputX, y: (fieldH - mt.line("lh22")) / 2, width: inputW, height: mt.line("lh22"))
        findPlaceholder.frame = findInput.frame
        findWhere.frame = CGRect(x: width - mt.space(4) - whereW, y: (fieldH - mt.line("lh15")) / 2, width: whereW, height: mt.line("lh15"))
        y += fieldH
        var findbarH = fieldH + mt.space(1)
        if !findMiss.isHidden {
            y += mt.space(2)
            findMiss.frame = CGRect(x: x, y: y, width: width, height: mt.line("lh13"))
            y += mt.line("lh13")
            findbarH += mt.space(2) + mt.line("lh13")
        }
        y = top + findbarH + mt.space(4) // 查字框的下沿 + .sz-all 的 gap s4
        // 分组（网页 .sz-all__group：组头 + gap s2 + 墙格；组头没有的组只有墙格）：先把全部组 / 格的框算好，再按框摆
        let wall = wallLayout(m, width: width, x: x, top: y)
        self.wall = wall
        for (gi, box) in wall.groups.enumerated() where gi < groupViews.count {
            let gv = groupViews[gi]
            gv.frame = box.frame
            gv.headView.frame = CGRect(x: 0, y: 0, width: width, height: box.headH)
            gv.headButton.frame = CGRect(x: 0, y: 0, width: width, height: box.headH)
            gv.nameLabel.frame = box.nameFrame
            gv.countLabel.frame = box.countFrame
            gv.cellsMarker.frame = CGRect(x: 0, y: box.gridTop, width: width, height: box.gridH)
        }
        // 格子：只建 / 配可见框 ± overscan 里的（滚动时 scrollViewDidScroll 再补；排版收尾时滚动区定了高再核一次）
        wallGeneration = renderGeneration
        cells.setItems(wall.cellsInContent)
        updateCells()
        y = wall.bottom
        glyphCache.endPass()
        // 收起的月份（网页 .sz-all__closed：上外边距 s2、顶边 0.5 分隔线）
        if !m.closed.isEmpty {
            let monthH = max(52, mt.line("lh15") + LibraryCommon.hair)
            y += mt.space(4) // .sz-all 的 gap s4（项与项之间才有）
            let closedTop = y + mt.space(2)
            closedMarker.frame = CGRect(x: x, y: closedTop, width: width, height: CGFloat(m.closed.count) * monthH + LibraryCommon.hair)
            // 收起月份的 ul 顶线（.sz-all__closed border-top .5px line）与每个按钮的底线（.sz-all__month border-bottom .5px line）
            let lineColor = color("line")
            let topLine = closedMarker.viewWithTag(9101) ?? { let v = UIView(); v.tag = 9101; v.isUserInteractionEnabled = false; closedMarker.addSubview(v); return v }()
            topLine.backgroundColor = lineColor
            topLine.frame = CGRect(x: 0, y: 0, width: width, height: LibraryCommon.hair)
            for (i, b) in monthButtons.enumerated() {
                let bottom = b.viewWithTag(9102) ?? { let v = UIView(); v.tag = 9102; v.isUserInteractionEnabled = false; b.addSubview(v); return v }()
                bottom.backgroundColor = lineColor
                bottom.frame = CGRect(x: 0, y: monthH - LibraryCommon.hair, width: width, height: LibraryCommon.hair)
                _ = i
            }
            for (i, b) in monthButtons.enumerated() {
                // 按钮在 ul 里（ul 自己已经贴了页边）
                b.frame = CGRect(x: 0, y: LibraryCommon.hair + CGFloat(i) * monthH, width: width, height: monthH)
                b.nameLabel.frame = CGRect(x: 0, y: (monthH - mt.line("lh15")) / 2, width: width, height: mt.line("lh15"))
                let cw = LibraryCommon.textWidth(b.countLabel.text ?? "", mt.fontTabular(15))
                b.countLabel.frame = CGRect(x: width - cw, y: (monthH - mt.line("lh15")) / 2, width: cw, height: mt.line("lh15"))
            }
            y = closedTop + CGFloat(m.closed.count) * monthH + LibraryCommon.hair
        }
        // 「看这些字 ›」（网页 .sz-all 的 gap s4 只在两项之间，最后一项之后没有）
        if m.go?.kind == "list" {
            y += mt.space(4) // .sz-all 的 gap s4（项与项之间才有）
            listButton.frame = CGRect(x: x - 4, y: y, width: LibraryCommon.textWidth(t("X-ALL.viewThese"), mt.font(15)) + 8, height: 44)
            y += 44
        }
        // 网页 .sz-all 是 .sz-page__body（flex 列）里的一个 flex 项：内容比可视区高时压到可视区高（正文里继续溢出）
        // 可视区高 = 屏高 − 页头底 − 底栏高（网页 .sz-page__body 的高度）；再减去 .sz-all 的上下内边距 s4 / s8。
        let bodyH = max(0, view.bounds.height - kit.headerBottom - (hasFooter ? kit.foot.frame.height : 0))
        let avail = bodyH - mt.space(4) - mt.space(8)
        bodyMarker.frame = CGRect(x: x, y: top, width: width, height: max(0, min(y - top, avail)))
        layoutFooter(width: width, x: x)
        return y
    }

    /// 全部组 / 格的框（网页 .sz-all__group：组的上外边距 s1、组与组之间 gap s4；组头 + gap s2 + 墙格，组头没有的组只有墙格）。
    /// 只算数，不碰视图；top = 第一组之前的 y（content 坐标），x / width = 页边与正文宽。
    func wallLayout(_ m: View, width: CGFloat, x: CGFloat, top: CGFloat) -> WallLayout {
        let mt = metrics
        var out = WallLayout()
        let cols = max(1, m.cols)
        let cellW = width / CGFloat(cols)
        out.cellW = cellW
        let total = m.groups.reduce(0) { $0 + $1.cells.count }
        out.cells.reserveCapacity(total)
        out.cellsInContent.reserveCapacity(total)
        out.cellGroup.reserveCapacity(total)
        out.cellData.reserveCapacity(total)
        // 组头里字数与组名同一条基线（网页 .sz-all__head 是 flex + align-items:baseline）：各组一样，先算好
        let nameFont = NativeType.song(size: mt.value("fs22"), weight: .medium)
        let nameBaseline = (mt.line("lh22") - (nameFont.ascender - nameFont.descender)) / 2 + nameFont.ascender
        let countFont = mt.font(15)
        let countBaseline = (mt.line("lh15") - (countFont.ascender - countFont.descender)) / 2 + countFont.ascender
        var y = top
        for (gi, group) in m.groups.enumerated() {
            if gi > 0 { y += mt.space(4) } // .sz-all 的 gap s4（组与组之间）
            let groupTop = y + mt.space(1) // 组的上外边距 s1
            let isHead = group.head
            let isFoldButton = isHead && group.fold == "open"
            let headH: CGFloat = isHead ? (webHeadHeight(gi) ?? groupHeadHeight(isButton: isFoldButton)) : 0
            let gridTop = headH > 0 ? headH + mt.space(2) : 0
            // 墙格
            let pyH = group.cells.first?.py != nil ? mt.line("lh11") : 0
            let cellH = cellW + (pyH > 0 ? pyH + mt.space(1) - 2 : 0)
            let rows = Int(ceil(Double(group.cells.count) / Double(cols)))
            let gridH = CGFloat(rows) * cellH
            let countW = LibraryCommon.textWidth(group.count.text, mt.fontTabular(15))
            let frame = CGRect(x: x, y: groupTop, width: width, height: gridTop + gridH)
            out.groups.append(WallLayout.GroupBox(
                frame: frame, headH: headH, gridTop: gridTop, gridH: gridH,
                nameFrame: CGRect(x: 0, y: 0, width: width, height: mt.line("lh22")),
                countFrame: CGRect(x: width - countW, y: nameBaseline - countBaseline, width: countW, height: mt.line("lh15")),
                firstCell: out.cells.count, cellCount: group.cells.count))
            let originX = frame.minX, originY = frame.minY + gridTop
            for (ci, cell) in group.cells.enumerated() {
                let col = ci % cols
                let row = ci / cols
                let r = CGRect(x: CGFloat(col) * cellW, y: CGFloat(row) * cellH, width: cellW, height: cellH)
                out.cells.append(r)
                out.cellsInContent.append(r.offsetBy(dx: originX, dy: originY))
                out.cellGroup.append(gi)
                out.cellData.append(cell)
            }
            y = groupTop + gridTop + gridH
        }
        out.bottom = y
        return out
    }

    /// 网页 .sz-all__head 的高：名字（宋体 fs22 / 行高 lh22）与计数（黑体 fs15）基线对齐后的行盒。
    /// 展开的月份头是按钮（最小高 44），收起的只是标题（最小高 28）。
    /// 网页这一行是 flex + align-items:baseline：行盒高 = max(名字的基线以上) + max(名字 / 计数的基线以下)。
    /// 计数段的行盒按主字体（系统字体 SF）的度量算——网页 .sz-all__count 继承的是 --hei（-apple-system），
    /// 段里虽然有中文（苹方回退），行盒仍按主字体的升降部；用苹方 UI 的降部会多算 0.7pt（AX3）。
    private func webHeadHeight(_ i: Int) -> CGFloat? {
        guard let hs = webMetrics?.headHeights, i >= 0, i < hs.count, let h = hs[i], h > 0 else { return nil }
        return CGFloat(h)
    }

    private func groupHeadHeight(isButton: Bool) -> CGFloat {
        let mt = metrics
        let nameLine = mt.line("lh22")
        let nameFont = NativeType.song(size: mt.value("fs22"), weight: .medium)
        // 行盒里的基线位置：上内边距 = (行高 − 升部 − 降部) / 2
        let halfLead = (nameLine - (nameFont.ascender - nameFont.descender)) / 2
        let nameBaseline = halfLead + nameFont.ascender
        let nameDescent = -nameFont.descender + halfLead
        // 计数字（系统字体；数字是 SF、中文是苹方回退）比名字降得深时，行盒要长出那截
        let countFont = mt.font(15)
        let countDescent = -countFont.descender
        let countAscent = countFont.ascender
        return max(isButton ? 44 : 28, max(nameBaseline, countAscent) + max(nameDescent, countDescent))
    }

    private func layoutFooter(width: CGFloat, x: CGFloat) {
        let mt = metrics
        let innerX = mt.gutter
        let innerW = view.bounds.width - 2 * mt.gutter
        if failed {
            goButton.isHidden = true
            kit.layoutFailBlock(x: innerX, width: innerW)
        } else {
            kit.failNote.isHidden = true
            kit.failCancel.isHidden = true
            kit.failRetry.isHidden = true
            goButton.isHidden = false
            goButton.frame = CGRect(x: innerX, y: mt.space(3), width: innerW, height: mt.value("btn-h"))
        }
    }

    override func viewDidLayoutSubviews() {
        kit.layoutFoot(hasFooter: hasFooter, contentHeight: footContentHeight)
        kit.trailHeight = trailHeight
        // 页头先摆：正文要按最终的正文区高度算（网页 .sz-page__body 的高度 = 屏高 − 页头底 − 底栏高）
        kit.layoutHeader(trailButtonWidth: trailButtonWidth, trailSlotWidth: trailSlotWidth)
        super.viewDidLayoutSubviews()
        // 基类按自己的页头高度重设了滚动区 → 再摆回网页的口径
        kit.layoutHeader(trailButtonWidth: trailButtonWidth, trailSlotWidth: trailSlotWidth)
        kit.adjustScroll(hasFooter: hasFooter)
        updateCells() // 滚动区的高到这里才定（底栏让出之后）
    }

    /// 系统字号档的连续倍率（网页 --k）。
    private var scaleK: CGFloat {
        let name = ShiziTokens.categoryName(UIApplication.shared.preferredContentSizeCategory)
        switch name {
        case "xS": return 0.82
        case "S": return 0.88
        case "M": return 0.94
        case "L": return 1
        case "XL": return 1.12
        case "XXL": return 1.24
        case "XXXL": return 1.35
        case "AX1": return 1.6
        case "AX2": return 1.8
        case "AX3": return 2
        case "AX4": return 2.2
        default: return 2.4
        }
    }
}

/// 「排序 · 筛选」弹层（网页版的 AllMenuSheet：标题 + 完成 / 排序三键 / 筛选项 / 图例 / 说明句）。
/// 原生这边是一个呈现出来的控制器（网页那边是遮罩栈里的一层）；控制器的根视图就是面板。
final class LibraryAllMenuController: UIViewController, UIViewControllerTransitioningDelegate, NativeSheetSizing {
    var onSort: ((String) -> Void)?
    var onChip: ((String) -> Void)?
    var onDone: (() -> Void)?

    private let scroll = UIScrollView()
    private let head = UIView()
    private let titleLabel = UILabel()
    private let doneButton = ShiziLineButton(type: .custom)
    private let sortsBox = UIView()
    private var sortButtons: [ShiziLineButton] = []
    private var sortLabels: [UILabel] = []
    private let chipsBox = UIView()
    private var chipButtons: [ShiziLineButton] = []
    private var chipLabels: [UILabel] = []
    private var chipDots: [UIView] = []
    private let legendBox = UIView()
    private var legendLabels: [UILabel] = []
    private var legendSwatches: [UIView] = []
    private let noteLabel = UILabel()

    private let sorts: [LibraryAllScreen.Sort]
    private let chips: [LibraryAllScreen.Chip]
    private let note: String
    private let showSort: Bool
    private let showChips: Bool
    private let showLegend: Bool

    /// 网页量出来的折行点（说明句 / 排序三键里的字）；没有就按原生自己的折行。
    private let noteStarts: [Int]?
    private let sortLines: [[Int]?]?

    init(model: LibraryAllScreen.View, noteStarts: [Int]? = nil, sortLines: [[Int]?]? = nil) {
        self.noteStarts = noteStarts
        self.sortLines = sortLines
        self.sorts = model.sorts
        self.chips = model.chips
        self.note = model.note.text
        self.showSort = model.showSort
        self.showChips = model.showChips
        self.showLegend = model.showLegend
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .custom
        transitioningDelegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private var metrics: ShiziMetrics { ShiziMetrics() }

    /// 弹层标题的字体（网页 .sz-sheet__title 的字体族是 --hei：系统字体按实际字号取款，字宽与网页一致）。
    /// 共用的 NativeType.compose 把光学尺寸钉在 17（苹方正文款，R9-B），20pt 以上苹方的字宽与网页差 0.9pt/字 —— 这一处按网页的取法。
    private var menuTitleFont: UIFont { metrics.font(17, .medium) }

    private func color(_ name: String) -> UIColor { ShiziTokens.dynamicColor(name) ?? .label }

    /// 文案（网页 copy 的 t）。
    private func t(_ key: String, _ vars: [String: CustomStringConvertible] = [:]) -> String { ShiziCopy.t(key, vars) }

    // MARK: 呈现

    private let spec = NativeOverlaySpec(motion: ShiziTokens.pageMotion(.write))
    private var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled || ShiziProbe.forceReduceMotion }

    func presentationController(forPresented presented: UIViewController, presenting: UIViewController?, source: UIViewController) -> UIPresentationController? {
        let p = NativeSheetPresentation(presented: presented, presenting: presenting, scrimColor: color("scrim"))
        p.onScrimTap = { [weak self] in self?.onDone?() }
        return p
    }

    func animationController(forPresented presented: UIViewController, presenting: UIViewController, source: UIViewController) -> UIViewControllerAnimatedTransitioning? {
        NativeSheetAnimator(presenting: true, spec: spec, reduce: reduceMotion)
    }

    func animationController(forDismissed dismissed: UIViewController) -> UIViewControllerAnimatedTransitioning? {
        NativeSheetAnimator(presenting: false, spec: spec, reduce: reduceMotion)
    }

    func preferredHeight(width: CGFloat, safeBottom: CGFloat) -> CGFloat { panelHeight(width: width, safeBottom: safeBottom) }


    // MARK: 视图

    override func viewDidLoad() {
        super.viewDidLoad()
        view.accessibilityIdentifier = "native-library-all-menu"
        view.backgroundColor = color("elev")
        view.layer.cornerRadius = 24
        view.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        head.accessibilityIdentifier = "native-library-all-sheet-head"
        titleLabel.accessibilityIdentifier = "native-library-all-sheet-title"
        doneButton.accessibilityIdentifier = "native-library-all-sheet-done"
        sortsBox.accessibilityIdentifier = "native-library-all-sorts"
        chipsBox.accessibilityIdentifier = "native-library-all-chips"
        legendBox.accessibilityIdentifier = "native-library-all-legend"
        noteLabel.accessibilityIdentifier = "native-library-all-note"
        // 内容比面板高（AX 档超过 88% 屏高）时在面板里滚（网页 .sz-sheet 同样可滚），原点与面板重合，坐标不变
        scroll.showsVerticalScrollIndicator = false
        scroll.showsHorizontalScrollIndicator = false
        scroll.alwaysBounceVertical = false
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.accessibilityIdentifier = "native-library-all-menu-scroll"
        view.addSubview(scroll)
        scroll.addSubview(head)
        scroll.addSubview(sortsBox)
        scroll.addSubview(chipsBox)
        scroll.addSubview(legendBox)
        scroll.addSubview(noteLabel)
        head.addSubview(titleLabel)
        head.addSubview(doneButton)
        for i in 0..<sorts.count {
            let b = ShiziLineButton(type: .custom)
            b.accessibilityIdentifier = "native-library-all-sort"
            let l = UILabel()
            l.isUserInteractionEnabled = false
            b.addSubview(l)
            sortButtons.append(b)
            sortLabels.append(l)
            sortsBox.addSubview(b)
            b.addAction(UIAction { [weak self] _ in self?.onSort?(self?.sorts[i].key ?? "") }, for: .touchUpInside)
        }
        for i in 0..<chips.count {
            let b = ShiziLineButton(type: .custom)
            b.accessibilityIdentifier = "native-library-all-chip"
            let l = UILabel()
            l.isUserInteractionEnabled = false
            b.addSubview(l)
            let dot = UIView()
            dot.isUserInteractionEnabled = false
            b.addSubview(dot)
            chipButtons.append(b)
            chipLabels.append(l)
            chipDots.append(dot)
            chipsBox.addSubview(b)
            b.addAction(UIAction { [weak self] _ in self?.onChip?(self?.chips[i].key ?? "") }, for: .touchUpInside)
        }
        for i in 0..<6 {
            let l = UILabel()
            l.isUserInteractionEnabled = false
            l.accessibilityIdentifier = i < 4 ? "native-library-all-legend-tone" : (i == 4 ? "native-library-all-legend-wrong" : "native-library-all-legend-hollow")
            legendLabels.append(l)
            legendBox.addSubview(l)
            let sw = UIView()
            sw.isUserInteractionEnabled = false
            legendSwatches.append(sw)
            legendBox.addSubview(sw)
        }
        doneButton.addAction(UIAction { [weak self] _ in self?.onDone?() }, for: .touchUpInside)
    }

    /// 面板的内容高（网页 .sz-sheet：内容 + 上下内边距；最高 88% 屏高由呈现控制器截 —— 网页 max-height:88%）。
    func panelHeight(width: CGFloat, safeBottom: CGFloat) -> CGFloat {
        sheetMetrics(width: width, safeBottom: safeBottom).content
    }

    /// 弹层各段的高（网页 .sz-sheet：上内边距 s6、段间 s4、下内边距 max(s8, 安全区)）。
    struct SheetMetrics {
        var head: CGFloat = 0
        var sorts: CGFloat = 0
        var chips: CGFloat = 0
        var legend: CGFloat = 0
        var note: CGFloat = 0
        var gap: CGFloat = 0
        var padTop: CGFloat = 0
        var padBottom: CGFloat = 0
        /// 内容总高（含上下内边距）。
        var content: CGFloat {
            var h = padTop
            var first = true
            for v in [head, sorts, chips, legend, note] where v > 0 {
                if !first { h += gap }
                h += v
                first = false
            }
            return h + padBottom
        }
    }

    /// 各段的高：网页 .sz-sheet__head（标题行高 lh17s 与「完成」文字按钮的高取大的）、
    /// 排序三键（.sz-all__sorts 内边距 3；键里的字折行后的高）、筛选项（plain 按钮：高 = max(44, 行高 lh15)）、
    /// 图例（行高 lh11、行距 s2）、说明句（行高 lh13，按网页的折行点算行数）。
    private func sheetMetrics(width: CGFloat, safeBottom: CGFloat) -> SheetMetrics {
        let mt = metrics
        let innerW = width - 2 * mt.gutter
        var m = SheetMetrics()
        m.gap = mt.space(4)
        m.padTop = mt.space(6)
        m.padBottom = max(mt.space(8), safeBottom)
        // 页头：标题（fs17 / lh17s）与「完成」（文字按钮；AX 档最小高 = max(44, 1.3em + 12)）
        let doneH = LibraryCommon.isAX ? LibraryCommon.axTextButtonHeight(fontSize: mt.value("fs15")) : mt.hit
        m.head = max(mt.line("lh17s"), doneH)
        // 排序三键：键里的字按 WebKit 口径折行（网页的字可折行），三键取最高的那个
        if showSort {
            let bw = (innerW - 6) / CGFloat(max(1, sorts.count))
            var lines = 1
            for s in sorts {
                lines = max(lines, LibraryText.webWrap(s.label.text, font: mt.font(15), width: bw).count)
            }
            m.sorts = 6 + max(mt.hit, CGFloat(lines) * mt.line("lh15"))
        }
        // 筛选项：plain 按钮（min-height 44；字一行时高 = 行高 lh15）
        if showChips {
            let rowH = max(mt.hit, mt.line("lh15"))
            m.chips = chipRows(innerW, rowH: rowH).height
        }
        // 图例
        if showLegend {
            m.legend = legendRows(innerW).height
        }
        // 说明句
        if !note.isEmpty {
            let lines = LibraryText.lineCount(note, starts: noteStarts, font: mt.font(13), width: innerW, line: mt.line("lh13"))
            m.note = CGFloat(lines) * mt.line("lh13")
        }
        return m
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        ShiziElev.apply(view, dark: traitCollection.userInterfaceStyle == .dark)
        let mt = metrics
        let w = view.bounds.width
        let gutter = mt.gutter
        let innerW = w - 2 * gutter
        let safeBottom = view.safeAreaInsets.bottom
        let m = sheetMetrics(width: w, safeBottom: safeBottom)
        scroll.frame = view.bounds
        scroll.contentSize = CGSize(width: w, height: m.content)
        // 内容（网页 .sz-sheet：上内边距 s6，段间 s4）
        var y: CGFloat = m.padTop
        let headH = m.head
        head.frame = CGRect(x: gutter, y: y, width: innerW, height: headH)
        // 标题与「完成」在页头里（网页 .sz-sheet__head：标题左、完成右）
        titleLabel.numberOfLines = 1
        NativeType.set(titleLabel, t("X-ALL.menuLabel"), font: menuTitleFont, color: color("ink1"), line: mt.line("lh17s"))
        // 标题里的间隔号「·」：网页在 20pt 以上取窄款（22.9pt 下 5.7、40pt 下 9.3、53pt 下 12.2；17pt 下与原生同为宽款），UIKit 一直取宽款；
        // 只在这一行补字距（按网页量到的三个字号拟合：宽 = 0.2139 × 字号 + 0.823）。其它带「·」的文字网页仍是宽款，不动共用的 NativeType。
        let titleFont = menuTitleFont
        if titleFont.pointSize >= 20, let attr = titleLabel.attributedText?.mutableCopy() as? NSMutableAttributedString {
            let ns = attr.string as NSString
            let r = ns.range(of: "\u{00B7}")
            if r.location != NSNotFound {
                let have = ("\u{00B7}" as NSString).size(withAttributes: [.font: titleFont]).width
                attr.addAttribute(.kern, value: 0.2139 * titleFont.pointSize + 0.823 - have, range: r)
                titleLabel.attributedText = attr
            }
        }
        titleLabel.frame = CGRect(x: 0, y: (headH - mt.line("lh17s")) / 2, width: innerW - 100, height: mt.line("lh17s"))
        let doneText = t("X-COMMON.done")
        let doneW = LibraryCommon.textWidth(doneText, mt.font(15)) + 8
        doneButton.drawsComposed = true
        doneButton.composed = doneText
        doneButton.lineFont = mt.font(15)
        doneButton.setTitleColor(color("ink2"), for: .normal)
        doneButton.frame = CGRect(x: innerW + 4 - doneW, y: 0, width: doneW, height: headH)
        y += headH + m.gap
        // 排序三键
        if showSort {
            sortsBox.backgroundColor = color("field")
            sortsBox.layer.cornerRadius = mt.value("r-ctl")
            sortsBox.frame = CGRect(x: gutter, y: y, width: innerW, height: m.sorts)
            let bw = (innerW - 6) / CGFloat(max(1, sortButtons.count))
            let sortH = m.sorts - 6
            for (i, b) in sortButtons.enumerated() {
                let s = sorts[i]
                b.composed = s.label.text
                b.lineFont = mt.font(15)
                b.setTitleColor(s.active ? color("ink1") : color("ink2"), for: .normal)
                b.backgroundColor = s.active ? color("sheet") : .clear
                b.layer.cornerRadius = mt.value("r-ctl") - 3
                b.frame = CGRect(x: 3 + CGFloat(i) * bw, y: 3, width: bw - 0.05, height: sortH) // 少 0.05pt：三键首尾相接，取证按 0.1pt 取整会量出 0.1pt 的重叠
                // 按钮里的字（原生按钮不画字，字放在子视图里）
                let l = sortLabels[i]
                // 网页的字按词折行；原生按同样的折行点换行（行数与网页一致）
                let lines = LibraryText.webWrap(s.label.text, font: mt.font(15), width: bw)
                l.numberOfLines = 0
                NativeType.set(l, lines.joined(separator: "\n"), font: mt.font(15), color: s.active ? color("ink1") : color("ink2"), align: .center, line: mt.line("lh15"))
                l.frame = b.bounds
            }
            y += m.sorts + m.gap
        } else {
            sortsBox.isHidden = true
        }
        // 筛选项（整段换行的流）
        let rowH = max(mt.hit, mt.line("lh15"))
        if showChips {
            let rows = chipRows(innerW, rowH: rowH)
            chipsBox.frame = CGRect(x: gutter, y: y, width: innerW, height: rows.height)
            var idx = 0
            var cy: CGFloat = 0
            for row in rows.rows {
                var x: CGFloat = 0
                for item in row {
                    guard idx < chipButtons.count else { break }
                    let b = chipButtons[idx]
                    let c = chips[idx]
                    b.composed = c.label.text
                    b.lineFont = mt.font(15)
                    b.setTitleColor(c.disabled ? color("ink4") : (c.active ? color("ink1") : color("ink2")), for: .normal)
                    b.isEnabled = !c.disabled
                    b.layer.cornerRadius = mt.value("r-ctl")
                    b.layer.borderWidth = c.active ? 1 : 0.5
                    b.layer.borderColor = color(c.active ? "ink1" : (c.disabled ? "line" : "ink4")).cgColor
                    b.frame = CGRect(x: x, y: cy, width: item, height: rowH)
                    // 按钮里的字与色点（网页 .sz-all__chip：圆点 + 间距 + 字）
                    let l = chipLabels[idx]
                    l.numberOfLines = 1
                    NativeType.set(l, c.label.text, font: mt.font(15), color: c.disabled ? color("ink4") : (c.active ? color("ink1") : color("ink2")), line: mt.line("lh15"))
                    // 网页的筛选项只有字（左右内边距 s4），没有色点
                    chipDots[idx].isHidden = true
                    l.lineBreakMode = .byClipping
                    let tx = mt.space(4)
                    l.frame = CGRect(x: tx, y: (rowH - mt.line("lh15")) / 2, width: max(0, item - 2 * tx), height: mt.line("lh15"))
                    x += item + mt.space(2)
                    idx += 1
                }
                cy += rowH + mt.space(2)
            }
            y += rows.height + m.gap
        } else {
            chipsBox.isHidden = true
        }
        // 图例
        if showLegend {
            let rows = legendRows(innerW)
            legendBox.frame = CGRect(x: gutter, y: y, width: innerW, height: rows.height)
            placeLegend(rows)
            y += rows.height + m.gap
        } else {
            legendBox.isHidden = true
        }
        // 说明句（网页 .sz-all__note：text-wrap:pretty，原生按同样的行数排，行长可能不同）
        if m.note > 0 {
            noteLabel.isHidden = false
            noteLabel.numberOfLines = 0
            NativeType.set(noteLabel, LibraryText.joined(note, noteStarts), font: mt.font(13), color: color("ink3"), line: mt.line("lh13"))
            noteLabel.frame = CGRect(x: gutter, y: y, width: innerW, height: m.note)
        } else {
            noteLabel.isHidden = true
            noteLabel.frame = .zero
        }
    }

    /// 筛选项的流（整段不折：每项的宽 = 字宽 + 32；行距 / 列距 s2）。
    private func chipRows(_ width: CGFloat, rowH: CGFloat) -> (rows: [[CGFloat]], height: CGFloat) {
        let mt = metrics
        var rows: [[CGFloat]] = []
        var cur: [CGFloat] = []
        var curW: CGFloat = 0
        for c in chips {
            let w = LibraryCommon.textWidth(c.label.text, mt.font(15)) + 32
            if !cur.isEmpty, curW + mt.space(2) + w > width {
                rows.append(cur)
                cur = []
                curW = 0
            }
            if !cur.isEmpty { curW += mt.space(2) }
            cur.append(w)
            curW += w
        }
        if !cur.isEmpty { rows.append(cur) }
        let height = CGFloat(rows.count) * rowH + CGFloat(max(0, rows.count - 1)) * mt.space(2)
        return (rows, height)
    }

    /// 图例的流（一行四项 + 一行两项；列距 s4、行距 s2）。
    private func legendRows(_ width: CGFloat) -> (items: [(CGFloat, CGFloat, Int)], height: CGFloat) {
        let mt = metrics
        var items: [(CGFloat, CGFloat, Int)] = [] // (整项宽, 文字宽, 种类)
        let kinds = 6
        for i in 0..<kinds {
            let text: String
            let sw: CGFloat
            switch i {
            case 0: text = t("X-LIBHOME.tone0"); sw = 20
            case 1: text = t("X-LIBHOME.tone1"); sw = 20
            case 2: text = t("X-LIBHOME.tone2"); sw = 20
            case 3: text = t("R-L03.toneOldest"); sw = 20
            case 4: text = t("R-E04.titleWrong"); sw = 6
            default: text = t("R-A02.filterCustomUnwritten"); sw = 9
            }
            let tw = LibraryCommon.textWidth(text, mt.font(11))
            items.append((sw + mt.space(2) + tw, tw, i))
        }
        var rows: [[Int]] = []
        var cur: [Int] = []
        var curW: CGFloat = 0
        for (i, item) in items.enumerated() {
            if !cur.isEmpty, curW + mt.space(4) + item.0 > width {
                rows.append(cur)
                cur = []
                curW = 0
            }
            if !cur.isEmpty { curW += mt.space(4) }
            cur.append(i)
            curW += item.0
        }
        if !cur.isEmpty { rows.append(cur) }
        let height = CGFloat(rows.count) * mt.line("lh11") + CGFloat(max(0, rows.count - 1)) * mt.space(2)
        return (items, height)
    }

    /// 图例的排版（网页 .sz-lib__legend：色块 + 间距 s2 + 字；项间距 s4、行距 s2）。
    private func placeLegend(_ rows: (items: [(CGFloat, CGFloat, Int)], height: CGFloat)) {
        let mt = metrics
        let width = view.bounds.width - 2 * mt.gutter
        // 重新按行分组
        var groups: [[Int]] = []
        var cur: [Int] = []
        var curW: CGFloat = 0
        for (i, item) in rows.items.enumerated() {
            if !cur.isEmpty, curW + mt.space(4) + item.0 > width {
                groups.append(cur)
                cur = []
                curW = 0
            }
            if !cur.isEmpty { curW += mt.space(4) }
            cur.append(i)
            curW += item.0
        }
        if !cur.isEmpty { groups.append(cur) }
        var cy: CGFloat = 0
        let lineH = mt.line("lh11")
        for g in groups {
            var cx: CGFloat = 0
            for i in g {
                let item = rows.items[i]
                let l = legendLabels[i]
                l.numberOfLines = 1
                NativeType.set(l, legendText(i), font: mt.font(11), color: color("ink2"), line: mt.line("lh11"))
                // 文字在色块之后（网页 .sz-lib__legend > li：色块 + 间距 s2 + 字）
                l.frame = CGRect(x: cx + item.0 - item.1, y: cy, width: item.1, height: lineH)
                let sw = legendSwatches[i]
                if i < 4 {
                    // 网页的 Swatch：viewBox 40×14 里的一笔横（宽 20 高 7，缩放 0.5）
                    sw.backgroundColor = .clear
                    sw.frame = CGRect(x: cx, y: cy + (lineH - 7) / 2, width: 20, height: 7)
                    let shape: CAShapeLayer
                    if let existing = sw.layer.sublayers?.first as? CAShapeLayer { shape = existing } else {
                        shape = CAShapeLayer()
                        shape.path = LibraryAllMenuController.swatchPath.cgPath
                        shape.setAffineTransform(CGAffineTransform(scaleX: 0.5, y: 0.5))
                        shape.frame = CGRect(x: 0, y: 0, width: 20, height: 7)
                        sw.layer.addSublayer(shape)
                    }
                    shape.fillColor = color(wallToken(i)).resolvedColor(with: traitCollection).cgColor
                } else if i == 4 {
                    sw.backgroundColor = color("zhu")
                    sw.frame = CGRect(x: cx, y: cy + (lineH - 6) / 2, width: 6, height: 6)
                    sw.layer.cornerRadius = 3
                } else {
                    sw.backgroundColor = .clear
                    sw.layer.borderWidth = 1
                    sw.layer.borderColor = color("ink4").cgColor
                    sw.frame = CGRect(x: cx, y: cy + (lineH - 9) / 2, width: 9, height: 9)
                }
                cx += item.0 + mt.space(4)
            }
            cy += lineH + mt.space(2)
        }
    }

    private func wallToken(_ tone: Int) -> String {
        switch tone {
        case 0: return "wall1"
        case 1: return "wall2"
        case 2: return "wall3"
        default: return "wall4"
        }
    }

    /// 网页 Swatch 的 path（viewBox 40×14）。
    static let swatchPath: UIBezierPath = {
        let p = UIBezierPath()
        p.move(to: CGPoint(x: 1.5, y: 7.6))
        p.addCurve(to: CGPoint(x: 22, y: 4.9), controlPoint1: CGPoint(x: 6, y: 5.2), controlPoint2: CGPoint(x: 13, y: 4.6))
        p.addCurve(to: CGPoint(x: 38.2, y: 6.2), controlPoint1: CGPoint(x: 28, y: 5.1), controlPoint2: CGPoint(x: 33, y: 5.4))
        p.addCurve(to: CGPoint(x: 38.2, y: 7.8), controlPoint1: CGPoint(x: 38.8, y: 6.3), controlPoint2: CGPoint(x: 38.8, y: 7.6))
        p.addCurve(to: CGPoint(x: 13, y: 9.5), controlPoint1: CGPoint(x: 32, y: 9.6), controlPoint2: CGPoint(x: 22, y: 9.3))
        p.addCurve(to: CGPoint(x: 2.2, y: 10.4), controlPoint1: CGPoint(x: 8, y: 9.6), controlPoint2: CGPoint(x: 4.4, y: 10.2))
        p.addCurve(to: CGPoint(x: 1.5, y: 7.6), controlPoint1: CGPoint(x: 0.6, y: 10.5), controlPoint2: CGPoint(x: 0.3, y: 8.3))
        p.close()
        return p
    }()

    private func legendText(_ i: Int) -> String {
        switch i {
        case 0: return t("X-LIBHOME.tone0")
        case 1: return t("X-LIBHOME.tone1")
        case 2: return t("X-LIBHOME.tone2")
        case 3: return t("R-L03.toneOldest")
        case 4: return t("R-E04.titleWrong")
        default: return t("R-A02.filterCustomUnwritten")
        }
    }
}
