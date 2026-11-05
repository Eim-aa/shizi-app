import UIKit

// 年报（B3.9；网页的原生版）。
//
// 版式（网页 .sz-ann）：卷首（「二〇二六」宋 34 / 42 → 「这一年，你拾回三十六个字。」17 / 26 → 今年第一个字（132 的格 + 「今年首字」+ 日期））
//   → 每月一段（上边一条发丝线、月名宋 22 + 右侧「{n} 字」、8 列 45 的格、无格线、墨内边 9%；点一段进那个月的字帖）
//   → 卷尾「同字两次」（两次的墨迹并排 + 各自的日期）。
// 空态：虚线格「年」+「今年还没有记录」+ 一句说明。
//
// 「调整图片 / 保存图片」在原生这边直接开原生图片预览（B3.11：NativeImagePreviewController + image.* op，与结果页同一条路）。
//
// 文案与数据来自会话层（annualView → App API view.annual）；本页不写汉字与数值。

@objc(ShiziScreen_annual)
final class AnnualScreen: ShiziScreenViewController, UIScrollViewDelegate {
    struct View: Decodable {
        struct Cell: Decodable {
            let ch: String
            var ink: ShiziInkBox?
            let mode: String
            let tag: String
            let day: String
            let recordId: String
            let label: ShiziCopyRef
        }
        struct First: Decodable {
            let char: String
            let day: String
            let recordId: String
            var ink: ShiziInkBox?
            let label: ShiziCopyRef
            let date: ShiziCopyRef
        }
        struct Month: Decodable {
            let month: String
            let monthNum: Int
            let n: Int
            let name: ShiziCopyRef
            let count: ShiziCopyRef
            let aria: ShiziCopyRef
            var cells: [Cell]
        }
        struct Side: Decodable {
            let recordId: String
            let day: String
            var ink: ShiziInkBox?
            let label: ShiziCopyRef
            let date: ShiziCopyRef
        }
        struct Twice: Decodable {
            let char: String
            let title: ShiziCopyRef
            var first: Side
            var last: Side
        }
        let today: String
        let year: Int
        let years: [Int]
        let prevYear: Int?
        let nextYear: Int?
        let empty: Bool
        let count: Int
        let days: Int
        let coverYear: String
        let coverLine: ShiziCopyRef
        var first: First?
        var months: [Month]
        var twice: Twice?
        let emptyTitle: ShiziCopyRef
        let emptyBody: ShiziCopyRef
        let emptyGlyph: ShiziCopyRef
        let adjust: ShiziCopyRef
        let adjustAria: ShiziCopyRef
        let save: ShiziCopyRef
        /// 网页量出的折行点（每一行从第几个字开始；nil = 没有断点）。
        struct Lines: Decodable {
            let head: [Int]?
            let firstDate: [Int]?
        }
        let lines: Lines?
    }

    // 网页 .sz-ann 里的定值
    private let headGap: CGFloat = 12
    private let monthPadTop: CGFloat = 14
    private let monthHeadGap: CGFloat = 10
    private let monthGridGap: CGFloat = 28
    private let firstSide: CGFloat = 132
    private let firstGap: CGFloat = 20
    private let firstTop: CGFloat = 24
    private let firstBottom: CGFloat = 16
    private let twiceGap: CGFloat = 14
    private let twiceSide: CGFloat = 140
    private let hairline: CGFloat = 1.0 / 3.0
    private let textBtnPad: CGFloat = 4

    /// 不进取证的装饰视图（格的内框、发丝线）与月段的格网容器按 tag 找，不存成员（成员名会被取证当元素）。
    private static let insetFrameTag = 9931
    private static let twiceHairTag = 9932
    private static let monthHairTag = 9933
    private static let monthGridTag = 9934

    /// 月段格网里的一格：格（容器，不进读屏）+ 本人墨（有墨迹时）+ 衬底字（没有墨迹时，画在墨的内框里）。
    @MainActor
    final class CellSlot {
        let cell = UIView()
        let ink = ShiziPointsInkView()
        let glyph = NativeGlyphView()
        /// 上次按哪一格（grid 的序号）、哪一次渲染的数据（gridGeneration）配的内容；都没变时重排只重摆框。
        var index = -1
        var generation = -1

        init() {
            cell.isAccessibilityElement = false
            // 墨到了视口附近才画：由页面的滚动回调统一判（不是每格一个 contentOffset 的 KVO）
            ink.watchesScroll = false
            cell.addSubview(ink)
            cell.addSubview(glyph)
        }
    }

    /// 每月一段的排版结果：每段、每格的框（纯几何，排版时一次算完全部；视图按它摆）。
    struct MonthsLayout {
        struct MonthBox {
            /// 段按钮在 content 里的框（上边一条发丝线 + 上内边距 + 月名一行 + 间距 + 格网 + 下边距）。
            var frame: CGRect
            /// 月名 / 字数在按钮里的框（基线对齐的一行）。
            var nameFrame: CGRect
            var countFrame: CGRect
            /// 这一段第一格在 cells 里的序号、格数。
            var firstCell: Int
            var cellCount: Int
        }
        var months: [MonthBox] = []
        /// 列数（AX 档 6，其余 8）与格边长（整页一样）。
        var cols = 8
        var cellSide: CGFloat = 0
        /// 每格在所在段的格网容器里的框（格网容器铺满段按钮，坐标同按钮）；按段、段里按格的顺序排平。
        var cells: [CGRect] = []
        /// 每格在 content 里的框（= 段的原点 + 格在按钮里的框）。
        var cellsInContent: [CGRect] = []
        /// 每格属于第几段。
        var cellMonth: [Int] = []
        /// 每格的数据（排这一版时的模型）。
        var cellData: [View.Cell] = []
        /// 最后一段的下沿（content 坐标）。
        var bottom: CGFloat = 0
    }

    // 视图（成员名 / accessibilityIdentifier 是 QA 取证的语义键：keys/annual.mjs）
    let bodyMarker = UIView()
    let yearLabel = UILabel()
    let headLabel = UILabel()
    let prevButton = UIButton(type: .custom)
    let nextButton = UIButton(type: .custom)
    let firstCell = UIView()
    /// 网页格里的画布（CellCanvas）的位置；原生直接画墨与字形，这个框只用来对位。
    let firstCanvas = UIView()
    let firstMarker = UIView()
    let firstLabel = UILabel()
    let firstDate = UILabel()
    let emptyView = UIView()
    let emptyGlyph = UIView()
    let emptyTitle = UILabel()
    let emptyBody = UILabel()
    let adjustButton = UIButton(type: .custom)
    let saveButton = UIButton(type: .custom)
    let saveLive = UIView()
    private let footerView = UIView()
    private let firstInk = ShiziPointsInkView()
    private let firstGlyph = NativeGlyphView()
    private var monthButtons: [ShiziRowButton] = []
    /// 最近一次排版算出的全部段 / 格的框。
    private(set) var grid = MonthsLayout()
    /// 第几次渲染（renderModel 一次加一）：格子的内容按渲染配，框按排版配。
    private var renderGeneration = 0
    /// 此刻的 grid（格子的数据与框）是按第几次渲染的模型排出来的：layoutBody 在 setItems 之前设成 renderGeneration。
    /// 格子内容按它记（不按 renderGeneration）：渲染之后、排版之前建的格子用的还是旧 grid 的数据，不能记成新的一次渲染。
    private var gridGeneration = -1
    /// 可见框上下各多建几屏高（且至少几行格子）的格子。2.5 屏：冻结的逐屏基线里最深的月段格子
    /// （annual-report AX5：格的上沿在内容里 1725.3pt，可视区 534.3pt）要在打开时就建出来（取证连屏外滚得到的墨格一起记），需要 > 2.23 屏
    /// （2.5 屏 = 1335.8pt，余 144.8pt）；8 行：可视区很矮时也至少多建 8 行。
    static let overscanViewports: CGFloat = 2.5
    static let overscanRows: CGFloat = 8
    /// 月段的格子：只建可见框 ± overscan 里的（ShiziLazyCells）。序号 = grid.cells 的序号。
    private(set) lazy var cells = ShiziLazyCells<CellSlot>(
        make: { _ in CellSlot() },
        attach: { [unowned self] s, i, following in self.attachCell(s, i, following) },
        detach: { s in s.cell.removeFromSuperview() },
        configure: { [unowned self] s, i in self.configureCell(s, i) })
    /// 墨色 / 衬底字色：浅 / 深两套解析出来都没变就一直用同一个对象（color(_:) 每次新建一个动态色；
    /// 同一个对象 → 墨视图 / 衬底字不必重画）。
    private var handColor: UIColor?
    private var underColor: UIColor?
    private var twiceTitle = UILabel()
    private var twiceFirstCell = UIView()
    private var twiceLastCell = UIView()
    private var twiceFirstDate = UILabel()
    private var twiceLastDate = UILabel()
    private var twiceFirstInk = ShiziPointsInkView()
    private var twiceLastInk = ShiziPointsInkView()
    private var model: View?
    private var sealPath: [[Any]] = []
    /// 每一段对应哪个月份（按钮按下时按对象取）。
    private var monthKeys: [ObjectIdentifier: String] = [:]

    override func viewDidLoad() {
        bodyMarker.accessibilityIdentifier = "native-annual-body"
        yearLabel.accessibilityIdentifier = "native-annual-year"
        headLabel.accessibilityIdentifier = "native-annual-head"
        prevButton.accessibilityIdentifier = "native-annual-prev"
        nextButton.accessibilityIdentifier = "native-annual-next"
        firstCell.accessibilityIdentifier = "native-annual-first-cell"
        firstCanvas.accessibilityIdentifier = "native-annual-first-canvas"
        firstMarker.accessibilityIdentifier = "native-annual-first"
        firstLabel.accessibilityIdentifier = "native-annual-first-label"
        firstDate.accessibilityIdentifier = "native-annual-first-date"
        emptyView.accessibilityIdentifier = "native-annual-empty"
        emptyGlyph.accessibilityIdentifier = "native-annual-empty-glyph"
        emptyTitle.accessibilityIdentifier = "native-annual-empty-title"
        emptyBody.accessibilityIdentifier = "native-annual-empty-body"
        adjustButton.accessibilityIdentifier = "native-annual-adjust"
        saveButton.accessibilityIdentifier = "native-annual-save"
        saveLive.accessibilityIdentifier = "native-annual-save-live"
        for v in [bodyMarker, emptyView, emptyGlyph, saveLive, firstCell, firstMarker] as [UIView] {
            v.isUserInteractionEnabled = false
            v.isAccessibilityElement = false
            content.addSubview(v)
        }
        for v in [yearLabel, headLabel, firstLabel, firstDate, emptyTitle, emptyBody] as [UIView] { content.addSubview(v) }
        // 墨到了视口附近才画：页面的滚动回调统一判（scrollViewDidScroll → refreshInkNear）
        for v in [firstInk, twiceFirstInk, twiceLastInk] { v.watchesScroll = false }
        firstCell.addSubview(firstInk)
        firstCell.addSubview(firstGlyph)
        firstCell.addSubview(firstCanvas)
        // 卷尾「同一个字，两次」（网页 .sz-ann__twice）
        twiceFirstCell.accessibilityIdentifier = "native-annual-twice-first"
        twiceLastCell.accessibilityIdentifier = "native-annual-twice-last"
        twiceFirstDate.accessibilityIdentifier = "native-annual-twice-date"
        twiceLastDate.accessibilityIdentifier = "native-annual-twice-date"
        twiceTitle.accessibilityIdentifier = "native-annual-twice-title"
        for v in [twiceTitle, twiceFirstCell, twiceFirstDate, twiceLastCell, twiceLastDate] as [UIView] { content.addSubview(v) }
        twiceFirstCell.addSubview(twiceFirstInk)
        twiceLastCell.addSubview(twiceLastInk)
        for c in [twiceFirstCell, twiceLastCell] {
            c.isAccessibilityElement = true
            c.accessibilityTraits = .image
        }
        twiceTitle.accessibilityTraits = .header
        twiceFirstDate.isAccessibilityElement = true
        twiceLastDate.isAccessibilityElement = true
        // 格的内框（网页 box-shadow: inset 0 0 0 frame-w frame）：画在格里一层不进取证的视图上（box-shadow 不是边框，网页取证也不报）
        for c in [firstCell, twiceFirstCell, twiceLastCell] {
            let f = UIView()
            f.tag = Self.insetFrameTag
            f.isUserInteractionEnabled = false
            f.isAccessibilityElement = false
            f.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            c.insertSubview(f, at: 0)
        }
        // 卷尾上面的发丝线（网页 .sz-ann__twice 的 border-top）：同上，不进取证
        let hair = UIView()
        hair.tag = Self.twiceHairTag
        hair.isUserInteractionEnabled = false
        hair.isAccessibilityElement = false
        content.addSubview(hair)
        content.addSubview(prevButton)
        content.addSubview(nextButton)
        // 页头的「调整图片 ›」在页头里（网页 .sz-page__trail），不在正文里
        view.addSubview(adjustButton)
        view.addSubview(footerView)
        footerView.addSubview(saveButton)
        for l in [yearLabel, headLabel, firstLabel, firstDate, emptyTitle, emptyBody, twiceTitle, twiceFirstDate, twiceLastDate] {
            l.numberOfLines = 0
        }
        emptyGlyph.addSubview(NativeGlyphView())
        wire(adjustButton) { page in (page as? AnnualScreen)?.openImage() }
        wire(saveButton) { page in (page as? AnnualScreen)?.openImage() }
        wire(prevButton) { page in (page as? AnnualScreen)?.pickYear(-1) }
        wire(nextButton) { page in (page as? AnnualScreen)?.pickYear(1) }
        super.viewDidLoad()
        setTitle(t("X-MINE.annual"))
        scroll.delegate = self
    }

    override var watchedDomains: [String]? { ["records", "ink"] }

    // MARK: 视图

    override func render(view raw: Any) throws {
        let m = try Self.decodeView(raw)
        model = m
        if let s = (raw as? [String: Any])?["seal"] as? [[Any]] { sealPath = s }
        renderModel(m)
    }

    // MARK: 回包 view → View

    /// 回包 view → View；解不了就 throw（同以前的 ShiziDecode.value(raw, as: View.self)）。
    /// 每格墨迹 ink = {points: [笔, …]}，一笔有两种形状（ShiziCore AnnualInkWire，同字库页 LibraryInkWire）：平铺 [步长, x, y, (w), …]，
    /// 或每点一个 {x, y, w?}。任何输入解出来都 = 把平铺展开成旧形状（expandInk）再整份经 ShiziDecode.value 解出来的，逐位相同。
    /// 先走 decodeViewDirect：墨迹直接从字典 / 数组读（LibraryInkView.decodeInkDirect，不经 JSON 往返），只有去掉墨迹的 view 经 ShiziDecode.value；
    /// 它不认得的一律交回原路。
    static func decodeView(_ raw: Any) throws -> View {
        if let direct = decodeViewDirect(raw) { return direct }
        return try ShiziDecode.value(expandInk(raw), as: View.self)
    }

    /// 墨迹所在的格：今年首字 first.ink、每月一段 months[i].cells[j].ink、卷尾 twice.first / last.ink（键是本函数自己起的名）。
    /// 每格的 ink 只收 null / 缺省，或只有 points 一个键的字典、points 是数组、其中旧形状的点只有 x / y / w 三个键
    /// （ShiziInkPoint 的 t / p 由原路解；引擎现在不发），笔画交 LibraryInkView.decodeInkDirect；去掉墨迹的 view 经 ShiziDecode.value 解，
    /// 再把笔画放回各格（t / p = nil，同原路解没有 t / p 的点）。哪一步不行 → nil（调用方走原路）。
    static func decodeViewDirect(_ raw: Any) -> View? {
        guard var root = raw as? [String: Any] else { return nil }
        var ink: [String: Any] = [:]
        var ok = true
        /// 一格（含 ink 键的字典）：收下它的笔画、ink 换成 null。
        func take(_ holder: Any, _ key: String) -> Any {
            guard ok, var h = holder as? [String: Any] else { return holder }
            guard let box = h["ink"], !(box is NSNull) else { return holder }
            guard let o = box as? [String: Any], o.count == 1, let strokes = o["points"] as? [Any], onlyXYW(strokes) else {
                ok = false
                return holder
            }
            ink[key] = strokes
            h["ink"] = NSNull()
            return h
        }
        if let f = root["first"] { root["first"] = take(f, "f") }
        if let ms = root["months"] as? [Any] {
            var outMonths: [Any] = []
            outMonths.reserveCapacity(ms.count)
            for (i, mRaw) in ms.enumerated() {
                guard var mo = mRaw as? [String: Any], let cells = mo["cells"] as? [Any] else {
                    outMonths.append(mRaw)
                    continue
                }
                var outCells: [Any] = []
                outCells.reserveCapacity(cells.count)
                for (j, c) in cells.enumerated() { outCells.append(take(c, "m\(i).\(j)")) }
                mo["cells"] = outCells
                outMonths.append(mo)
            }
            root["months"] = outMonths
        }
        if var t = root["twice"] as? [String: Any] {
            if let s = t["first"] { t["first"] = take(s, "tf") }
            if let s = t["last"] { t["last"] = take(s, "tl") }
            root["twice"] = t
        }
        guard ok, let strokes = LibraryInkView.decodeInkDirect(ink), var m = try? ShiziDecode.value(root, as: View.self) else { return nil }
        func box(_ key: String) -> ShiziInkBox? {
            guard let ss = strokes[key] else { return nil }
            return ShiziInkBox(points: ss.map { s in s.map { ShiziInkPoint(x: $0.x, y: $0.y, w: $0.w, t: nil, p: nil) } })
        }
        if m.first != nil { m.first?.ink = box("f") }
        for i in m.months.indices {
            for j in m.months[i].cells.indices { m.months[i].cells[j].ink = box("m\(i).\(j)") }
        }
        if m.twice != nil {
            m.twice?.first.ink = box("tf")
            m.twice?.last.ink = box("tl")
        }
        return m
    }

    /// 旧形状的点（字典）只有 x / y / w 键；平铺的笔（头一个是数）不看（由 decodeInkDirect 认）。
    private static func onlyXYW(_ strokes: [Any]) -> Bool {
        for s in strokes {
            guard let a = s as? [Any], !(a.first is NSNumber) else { continue }
            for p in a {
                guard let o = p as? [String: Any] else { continue }
                for k in o.keys where k != "x" && k != "y" && k != "w" { return false }
            }
        }
        return true
    }

    /// 原路（ShiziDecode.value）只认旧形状：每格 ink.points 里平铺的笔展开成每点一个 {x, y, w?}（LibraryInkView.expandFlat，值原样搬）；别的原样留着。
    static func expandInk(_ raw: Any) -> Any {
        guard var root = raw as? [String: Any] else { return raw }
        if let f = root["first"] { root["first"] = expandSlot(f) }
        if let ms = root["months"] as? [Any] {
            root["months"] = ms.map { mRaw -> Any in
                guard var mo = mRaw as? [String: Any], let cells = mo["cells"] as? [Any] else { return mRaw }
                mo["cells"] = cells.map { expandSlot($0) }
                return mo
            }
        }
        if var t = root["twice"] as? [String: Any] {
            if let s = t["first"] { t["first"] = expandSlot(s) }
            if let s = t["last"] { t["last"] = expandSlot(s) }
            root["twice"] = t
        }
        return root
    }

    private static func expandSlot(_ holder: Any) -> Any {
        guard var h = holder as? [String: Any], var box = h["ink"] as? [String: Any], let pts = box["points"] else { return holder }
        box["points"] = LibraryInkView.expandFlat(["p": pts])["p"] ?? pts
        h["ink"] = box
        return h
    }

    private func setSong(_ l: UILabel, _ text: String, size: CGFloat, weight: UIFont.Weight = .regular, color c: UIColor, line: CGFloat? = nil) {
        l.attributedText = nil
        let f = NativeType.song(size: size, weight: weight)
        l.font = f
        l.textColor = c
        let p = NSMutableParagraphStyle()
        var attrs: [NSAttributedString.Key: Any] = [.font: f, .foregroundColor: c, .kern: 0, .paragraphStyle: p]
        if let line, line > 0 {
            p.minimumLineHeight = line
            p.maximumLineHeight = line
            attrs[.baselineOffset] = (line - f.lineHeight) / 4
        }
        l.attributedText = NSAttributedString(string: text, attributes: attrs)
    }

    private func setHei(_ l: UILabel, _ text: String, size: CGFloat, weight: UIFont.Weight = .regular, color c: UIColor, line: CGFloat? = nil) {
        NativeType.set(l, text, font: NativeType.compose(size: size, weight: weight), color: c, line: line)
    }

    private func renderModel(_ m: View) {
        let mt = metrics
        // 格子在排版时按框建 / 配（layoutBody → updateCells）；这一次渲染的内容要重配
        renderGeneration += 1
        let hand = Self.keep(handColor, color("hand"))
        let under = Self.keep(underColor, color("under"))
        handColor = hand
        underColor = under
        // 空态
        let isEmpty = m.empty
        bodyMarker.isHidden = false
        yearLabel.isHidden = isEmpty
        headLabel.isHidden = isEmpty
        firstCell.isHidden = isEmpty
        firstLabel.isHidden = isEmpty
        firstDate.isHidden = isEmpty
        prevButton.isHidden = isEmpty || m.years.count <= 1
        nextButton.isHidden = isEmpty || m.years.count <= 1
        emptyView.isHidden = !isEmpty
        monthButtons.forEach { $0.isHidden = isEmpty }
        twiceTitle.isHidden = isEmpty || m.twice == nil
        twiceFirstCell.isHidden = isEmpty || m.twice == nil
        twiceLastCell.isHidden = isEmpty || m.twice == nil
        twiceFirstDate.isHidden = isEmpty || m.twice == nil
        twiceLastDate.isHidden = isEmpty || m.twice == nil
        adjustButton.isHidden = isEmpty
        saveButton.isHidden = isEmpty
        footerView.isHidden = isEmpty
        if isEmpty {
            setSong(emptyTitle, m.emptyTitle.text, size: mt.value("fs22"), weight: .medium, color: color("ink1"), line: mt.line("lh22"))
            emptyTitle.accessibilityLabel = m.emptyTitle.text
            setHei(emptyBody, m.emptyBody.text, size: mt.value("fs15"), color: color("ink2"), line: mt.line("lh15"))
            emptyBody.accessibilityLabel = m.emptyBody.text
            if let g = emptyGlyph.subviews.first as? NativeGlyphView {
                g.char = m.emptyGlyph.text
                g.color = color("under")
                g.padRatio = 0
            }
            return
        }
        // 卷首
        setSong(yearLabel, m.coverYear, size: mt.value("fs34"), weight: .regular, color: color("ink1"), line: mt.line("lh34"))
        yearLabel.accessibilityLabel = m.coverYear
        setHei(headLabel, ShiziMineLines.broken(m.coverLine.text, m.lines?.head), size: mt.value("fs17"), color: color("ink2"), line: mt.line("lh17"))
        headLabel.accessibilityLabel = m.coverLine.text
        // 年份切换
        styleArrow(prevButton, enabled: m.prevYear != nil, icon: .prev)
        styleArrow(nextButton, enabled: m.nextYear != nil, icon: .next)
        // 今年第一个字
        if let first = m.first {
            firstCell.isHidden = false
            firstCell.backgroundColor = color("sheet")
            firstCell.layer.borderWidth = 0
            if let ink = first.ink {
                firstInk.isHidden = false
                firstInk.points = ink.points
                firstInk.pad = 0.12 // 网页 CellCanvas 缺省 INK_PAD
                firstInk.inkColor = hand
                firstInk.widthScale = ShiziInkScale.scale(firstSide, 1 - 2 * 0.12)
                firstGlyph.isHidden = true
            } else {
                firstInk.isHidden = true
                firstGlyph.isHidden = false
                firstGlyph.char = first.char
                firstGlyph.color = color("under")
                firstGlyph.padRatio = 0.06
            }
            firstCell.accessibilityLabel = first.label.text
            setHei(firstLabel, t("X-WORK.annualFirstLabel"), size: mt.value("fs13"), color: color("ink3"), line: mt.line("lh13"))
            firstLabel.accessibilityLabel = t("X-WORK.annualFirstLabel")
            setHei(firstDate, ShiziMineLines.broken(first.date.text, m.lines?.firstDate), size: mt.value("fs15"), color: color("ink1"), line: mt.line("lh15"))
            firstDate.accessibilityLabel = first.date.text
        } else {
            firstCell.isHidden = true
            firstLabel.isHidden = true
            firstDate.isHidden = true
        }
        // 每月一段
        if monthButtons.count != m.months.count {
            // 格子先收进池子（它们在旧按钮的格网里）；排版时按新的 grid 放进新按钮
            cells.removeAll()
            monthButtons.forEach { $0.removeFromSuperview() }
            monthButtons = []
            for _ in m.months {
                let b = ShiziRowButton(frame: .zero)
                // 每段上边一条发丝线（网页 .sz-ann__month 的 border-top）：按钮里的子视图不进取证
                let hair = UIView()
                hair.tag = Self.monthHairTag
                hair.isUserInteractionEnabled = false
                b.addSubview(hair)
                // 格网容器：铺满按钮（格子的框照旧是按钮坐标，一位不差），格子按序号放在里面；不画东西、不进读屏（按钮本身是读屏元素）。
                // 可交互照旧（同以前格子直接在按钮里：点到格子上由格子往上交给按钮）
                let gridView = UIView()
                gridView.tag = Self.monthGridTag
                gridView.isAccessibilityElement = false
                b.addSubview(gridView)
                content.addSubview(b)
                monthButtons.append(b)
                let key = ObjectIdentifier(b)
                wire(b) { page in
                    guard let page = page as? AnnualScreen else { return }
                    page.openMonth(page.monthKeys[key] ?? "")
                }
            }
        }
        for (i, sec) in m.months.enumerated() {
            let b = monthButtons[i]
            b.accessibilityLabel = sec.aria.text
            b.accessibilityIdentifier = "native-annual-month"
            monthKeys[ObjectIdentifier(b)] = sec.month
            // 月名（宋 22 / 500）与字数（黑 13）：网页这两段在按钮里，取证按按钮的字 = 两段的并集
            setSong(b.label, sec.name.text, size: mt.value("fs22"), weight: .medium, color: color("ink1"), line: mt.line("lh22"))
            // 网页 .sz-ann__mcount 是等宽数字
            NativeType.set(b.valueLabel, sec.count.text,
                           font: ShiziFont.tabular(NativeType.compose(size: mt.value("fs13"), weight: .regular)),
                           color: color("ink3"), line: mt.line("lh13"))
            b.titleLabel?.font = NativeType.compose(size: mt.value("fs15"), weight: .regular)
            // 按钮自己的字色（网页 .sz-ann__month：color:inherit = ink1）
            b.setTitleColor(color("ink1"), for: .normal)
            b.viewWithTag(Self.monthHairTag)?.backgroundColor = color("line")
            // 每一段里的格子：排版时只建 / 配可见框 ± overscan 里的（layoutBody → updateCells；内容按 gridGeneration 记）
        }
        // 卷尾：同一个字，两次
        if let twice = m.twice {
            setSong(twiceTitle, twice.title.text, size: mt.value("fs22"), weight: .medium, color: color("ink1"), line: mt.line("lh22"))
            twiceTitle.accessibilityLabel = twice.title.text
            twiceFirstCell.backgroundColor = color("sheet")
            twiceLastCell.backgroundColor = color("sheet")
            twiceFirstInk.inkColor = hand
            twiceLastInk.inkColor = hand
            twiceFirstInk.widthScale = ShiziInkScale.scale(twiceSide, 1 - 2 * 0.12)
            twiceLastInk.widthScale = ShiziInkScale.scale(twiceSide, 1 - 2 * 0.12)
            twiceFirstInk.pad = 0.12
            twiceLastInk.pad = 0.12
            twiceFirstInk.points = twice.first.ink?.points ?? []
            twiceLastInk.points = twice.last.ink?.points ?? []
            twiceFirstCell.accessibilityLabel = twice.first.label.text
            twiceLastCell.accessibilityLabel = twice.last.label.text
            setHei(twiceFirstDate, twice.first.date.text, size: mt.value("fs13"), color: color("ink3"), line: mt.line("lh13"))
            setHei(twiceLastDate, twice.last.date.text, size: mt.value("fs13"), color: color("ink3"), line: mt.line("lh13"))
            twiceFirstDate.accessibilityLabel = twice.first.date.text
            twiceLastDate.accessibilityLabel = twice.last.date.text
        }
        content.viewWithTag(Self.twiceHairTag)?.isHidden = isEmpty || m.twice == nil
        content.viewWithTag(Self.twiceHairTag)?.backgroundColor = color("line")
        for c in [firstCell, twiceFirstCell, twiceLastCell] {
            guard let f = c.viewWithTag(Self.insetFrameTag) else { continue }
            f.layer.borderColor = color("frame").cgColor
            f.layer.borderWidth = mt.value("frame-w")
        }
        // 页头与底栏
        adjustButton.setTitle(m.adjust.text, for: .normal)
        adjustButton.setTitleColor(color("ink2"), for: .normal)
        adjustButton.titleLabel?.font = NativeType.compose(size: mt.value("fs15"), weight: .regular)
        // 中文按字体的 trak 表补字距（网页 WebKit 按实际字号取；不补整段宽 2–3pt）
        NativeType.trackTitle(adjustButton)
        adjustButton.accessibilityLabel = m.adjustAria.text
        saveButton.setTitle(m.save.text, for: .normal)
        saveButton.setTitleColor(color("btn-fg"), for: .normal)
        saveButton.titleLabel?.font = NativeType.compose(size: mt.value("fs17"), weight: .medium)
        NativeType.trackTitle(saveButton)
        saveButton.accessibilityLabel = m.save.text
        saveButton.backgroundColor = color("btn-bg")
        saveButton.layer.cornerRadius = mt.value("r-ctl")
        saveButton.layer.borderWidth = 0
    }

    private func styleArrow(_ b: UIButton, enabled: Bool, icon: ShiziMineIcon) {
        b.isEnabled = enabled
        b.accessibilityLabel = icon == .prev ? t("X-ANNUAL.prevYear") : t("X-ANNUAL.nextYear")
        b.setTitleColor(color(enabled ? "ink2" : "ink4"), for: .normal)
        b.titleLabel?.font = NativeType.compose(size: metrics.value("fs15"), weight: .regular)
        b.backgroundColor = .clear
        b.setImage(icon.image(color(enabled ? "ink2" : "ink4"), size: 18), for: .normal)
    }

    /// 段按钮里的格网容器。
    private func monthGrid(_ b: UIView) -> UIView? { b.viewWithTag(Self.monthGridTag) }

    /// 颜色没变（浅 / 深两套解析出来的都是同一个颜色）就留着原来的对象。ShiziTokens.dynamicColor 的动态色只按 userInterfaceStyle 取两套之一，
    /// 两套都相同 = 在任何外观下都相同（缺令牌时的 .label 同理：两边都是它）。
    static func keep(_ old: UIColor?, _ new: UIColor) -> UIColor {
        guard let old else { return new }
        for style in [UIUserInterfaceStyle.light, .dark] {
            let t = UITraitCollection(userInterfaceStyle: style)
            if !old.resolvedColor(with: t).isEqual(new.resolvedColor(with: t)) { return new }
        }
        return old
    }

    /// 第 i 格放进它那一段的格网：插在 following（下一个已建好的格子）前面，同一段里按序号排。已经在这一段的格网里就不动
    /// （同一段里留下来的格子之间的先后本来就按序号）。
    private func attachCell(_ s: CellSlot, _ i: Int, _ following: CellSlot?) {
        guard i < grid.cellMonth.count else { return }
        let mi = grid.cellMonth[i]
        guard mi < monthButtons.count, let g = monthGrid(monthButtons[mi]) else { return }
        if s.cell.superview === g { return }
        if let f = following, f.cell.superview === g {
            g.insertSubview(s.cell, belowSubview: f.cell)
        } else {
            g.addSubview(s.cell)
        }
    }

    /// 按第 i 格配：内容（换了格子或有新的渲染）+ 框（每次排版）。池子里拿出来的格子带着上一格的状态，内容与框里的每一样都重设。
    private func configureCell(_ s: CellSlot, _ i: Int) {
        guard i < grid.cellData.count else { return }
        if s.index != i || s.generation != gridGeneration {
            // 换了一格用：墨回到「还没到视口附近」（同新建的一格；按新的位置再判，屏外的不提前画）
            if s.index != i { s.ink.resetNear() }
            configureCellContent(s, grid.cellData[i])
            s.index = i
            s.generation = gridGeneration
        }
        configureCellLayout(s, frame: grid.cells[i], side: grid.cellSide)
    }

    /// 按此刻的滚动位置建 / 收格子（排版后、滚动时），再让墨按此刻的位置判要不要画。外观按本页的。
    func updateCells() {
        cells.overscan = max(max(0, scroll.bounds.height) * Self.overscanViewports, Self.overscanRows * grid.cellSide)
        let visible = scroll.bounds
        traitCollection.performAsCurrent { cells.update(visible: visible) }
        refreshInkNear()
    }

    /// 以前每块墨各自 KVO contentOffset 做的事：到了视口附近就画（建出来的格子 + 今年首字 + 卷尾两格）。
    private func refreshInkNear() {
        for i in cells.liveIndices { cells.slot(at: i)?.ink.refreshNear() }
        firstInk.refreshNear()
        twiceFirstInk.refreshNear()
        twiceLastInk.refreshNear()
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        guard scrollView === scroll, isViewLoaded else { return }
        // 渲染过、还没排版：grid 是旧模型的，等排版（已经标了 setNeedsLayout）按新的 grid 建；墨照旧按位置判
        guard gridGeneration == renderGeneration else {
            refreshInkNear()
            return
        }
        updateCells()
    }

    /// 一格的内容：衬底字、有墨迹就画墨（网页 paintCellContent：hand 且有墨 → 墨；否则衬底字）、墨与衬底字的颜色与内边。
    /// 框与线宽在 configureCellLayout。格子可能是别的格用过的：内容的每一样都重设（与原来一模一样的值不重画）。
    private func configureCellContent(_ s: CellSlot, _ c: View.Cell) {
        let hand = handColor ?? color("hand"), under = underColor ?? color("under")
        s.ink.pad = 0.09 // 网页年报月段的 INK_PAD
        s.ink.inkColor = hand
        if s.glyph.color !== under { s.glyph.color = under }
        if s.glyph.padRatio != 0.06 { s.glyph.padRatio = 0.06 }
        s.glyph.char = c.ch
        if let box = c.ink, c.mode == "hand" {
            s.ink.isHidden = false
            s.ink.points = box.points
            s.glyph.isHidden = true
        } else {
            s.ink.isHidden = true
            s.glyph.isHidden = false
        }
    }

    /// 一格的框（格网坐标 = 按钮坐标）、墨铺满格（ShiziPointsInkView 自己留 9% 内边）、衬底字画在同一个内框里
    /// （网页 paintCellContent：cellInkBox 再 paintOutline）、线宽按格边长。
    private func configureCellLayout(_ s: CellSlot, frame: CGRect, side: CGFloat) {
        s.cell.frame = frame
        s.ink.frame = s.cell.bounds
        s.glyph.frame = s.cell.bounds.insetBy(dx: side * 0.09, dy: side * 0.09)
        s.ink.widthScale = ShiziInkScale.scale(side, 1 - 2 * 0.09)
    }

    // MARK: 动作

    /// 每月一段 → 那个月的字帖（网页 openMonth）。
    private func openMonth(_ month: String) {
        guard !month.isEmpty else { return }
        push("month", params: ["month": month])
    }

    private func pickYear(_ delta: Int) {
        guard let m = model else { return }
        let next = delta < 0 ? m.prevYear : m.nextYear
        guard let next else { return }
        pushParams(year: next)
    }

    private func pushParams(year: Int) {
        guard let engine = stage?.engine else { return }
        var next = params
        next["year"] = year
        update(params: next)
        Task { @MainActor [weak self] in
            _ = await engine.raw("nav.setParams", ["patch": ["year": year]])
            self?.reload()
        }
    }

    private func openImage() {
        guard let m = model else { return }
        presentImagePreview(scope: ["kind": "annual", "year": m.year])
    }

    /// B3.11：图片按钮 → 原生图片预览弹层（与结果页同一条路：NativeImagePreviewController + image.* op）。
    private func presentImagePreview(scope: [String: Any]) {
        guard presentedViewController == nil, let engine = stage?.engine else { return }
        Task { @MainActor [weak self] in
            guard let self else { return }
            let sheet = NativeImagePreviewController(engine: engine, scope: scope)
            guard await sheet.prepare() else { return }
            self.present(sheet, animated: true)
        }
    }

    // MARK: 排版

    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat {
        let mt = metrics
        guard let m = model else { return top }
        // 年报的正文比页边线宽 4（网页 .sz-ann{margin: 0 -4px}）
        let bx = x - 4
        let bw = width + 8
        if m.empty {
            // 空态没有月段：格子都收进池子
            grid = MonthsLayout()
            gridGeneration = renderGeneration
            cells.setItems([])
            updateCells()
            layoutEmpty(bx: bx, bw: bw, top: top)
            let bodyH = max(0, scroll.bounds.height - top - mt.space(8))
            bodyMarker.frame = CGRect(x: bx, y: top, width: bw, height: bodyH)
            return top + bodyH
        }
        var y = top
        // 卷首的年份 + 两端的箭头
        let yearH = mt.line("lh34")
        yearLabel.frame = CGRect(x: bx, y: y, width: bw, height: yearH)
        let arrowH: CGFloat = 44
        let arrowW: CGFloat = 44
        let nextX = bx + bw + 4 - arrowW
        nextButton.frame = CGRect(x: nextX, y: y + (yearH - arrowH) / 2, width: arrowW, height: arrowH)
        prevButton.frame = CGRect(x: nextX - 4 - arrowW, y: y + (yearH - arrowH) / 2, width: arrowW, height: arrowH)
        y += yearH
        // 那句话（网页 .sz-ann__line 是 p：AX 档会折行，按折行后的高排）
        y += 8
        let headH = NativeType.height(headLabel, width: bw, line: mt.line("lh17"))
        headLabel.frame = CGRect(x: bx, y: y, width: bw, height: headH)
        y += headH
        // 今年第一个字
        if m.first != nil {
            y += firstTop
            let side = firstSide
            let labelH = mt.line("lh13")
            let sideX = bx + side + firstGap
            let sideW = bw - side - firstGap
            let dateH = NativeType.height(firstDate, width: sideW, line: mt.line("lh15"))
            // 网页 .sz-ann__first：align-items:flex-end；右侧一列 = 说明 + 4 + 日期 + 内下边距 4，比格子高时整块跟着它高，格子沉到底
            let sideH = labelH + 4 + dateH + 4
            let blockH = max(side, sideH)
            firstMarker.frame = CGRect(x: bx, y: y, width: bw, height: blockH + firstBottom)
            firstCell.frame = CGRect(x: bx, y: y + blockH - side, width: side, height: side)
            firstCanvas.frame = firstCell.bounds
            firstInk.frame = firstCell.bounds
            firstGlyph.frame = firstCell.bounds.insetBy(dx: side * 0.12, dy: side * 0.12) // 衬底字在墨的内框里（网页 cellInkBox，INK_PAD 12%）
            let sideBottom = y + blockH - 4
            firstDate.frame = CGRect(x: sideX, y: sideBottom - dateH, width: sideW, height: dateH)
            firstLabel.frame = CGRect(x: sideX, y: sideBottom - dateH - 4 - labelH, width: sideW, height: labelH)
            y += blockH + firstBottom
        }
        // 每月一段：先把全部段 / 格的框算好，再按框摆
        let cols = axLayout ? 6 : 8
        let cellSide: CGFloat = axLayout ? floor((view.bounds.width - 40) / 6) : min(45, floor((view.bounds.width - 40) / 8))
        let grid = monthsLayout(m, bx: bx, bw: bw, top: y, cols: cols, cellSide: cellSide)
        self.grid = grid
        for (i, box) in grid.months.enumerated() where i < monthButtons.count {
            let b = monthButtons[i]
            b.frame = box.frame
            b.viewWithTag(Self.monthHairTag)?.frame = CGRect(x: 0, y: 0, width: bw, height: hairline)
            monthGrid(b)?.frame = b.bounds
            // 按钮里的两段字：月名在左、字数在右，基线对齐（网页 .sz-ann__mhead：space-between + baseline）
            b.label.frame = box.nameFrame
            // 字数右对齐到版心的右缘（网页 space-between 的右端）：取证按按钮里全部文字的并集，右缘要对齐版心
            b.valueLabel.textAlignment = .right
            b.valueLabel.frame = box.countFrame
        }
        // 格子：只建 / 配可见框 ± overscan 里的（滚动时 scrollViewDidScroll 再补；排版收尾时滚动区定了高再核一次）
        gridGeneration = renderGeneration
        cells.setItems(grid.cellsInContent)
        updateCells()
        y = grid.bottom
        // 卷尾：同一个字，两次
        if m.twice != nil {
            content.viewWithTag(Self.twiceHairTag)?.frame = CGRect(x: bx, y: y, width: bw, height: hairline)
            y += hairline + twiceGap
            let titleH = mt.line("lh22")
            twiceTitle.frame = CGRect(x: bx, y: y, width: bw, height: titleH)
            // 网页 .sz-ann__twice：标题与那一行之间隔 14
            y += titleH + twiceGap
            let dateH = mt.line("lh13")
            if axLayout {
                // AX 档（网页 :root[data-ax] .sz-ann__twicerow：竖排）：两项上下叠，每项的格子与日期在整宽里居中
                let cellX = bx + (bw - twiceSide) / 2
                let firstTop = y
                twiceFirstCell.frame = CGRect(x: cellX, y: firstTop, width: twiceSide, height: twiceSide)
                twiceFirstDate.frame = CGRect(x: bx, y: firstTop + twiceSide + 8, width: bw, height: dateH)
                let lastTop = firstTop + twiceSide + 8 + dateH + 12
                twiceLastCell.frame = CGRect(x: cellX, y: lastTop, width: twiceSide, height: twiceSide)
                twiceLastDate.frame = CGRect(x: bx, y: lastTop + twiceSide + 8, width: bw, height: dateH)
                twiceFirstDate.textAlignment = .center
                twiceLastDate.textAlignment = .center
                twiceFirstInk.frame = twiceFirstCell.bounds
                twiceLastInk.frame = twiceLastCell.bounds
                y = lastTop + twiceSide + 8 + dateH + 24
            } else {
                let cellTop = y
                twiceFirstCell.frame = CGRect(x: bx, y: cellTop, width: twiceSide, height: twiceSide)
                twiceLastCell.frame = CGRect(x: bx + twiceSide + 12, y: cellTop, width: twiceSide, height: twiceSide)
                twiceFirstInk.frame = twiceFirstCell.bounds
                twiceLastInk.frame = twiceLastCell.bounds
                twiceFirstDate.frame = CGRect(x: bx, y: cellTop + twiceSide + 8, width: twiceSide, height: dateH)
                twiceLastDate.frame = CGRect(x: bx + twiceSide + 12, y: cellTop + twiceSide + 8, width: twiceSide, height: dateH)
                // 网页 .sz-ann__twiceitem：justify-items:center（日期在格下居中）
                twiceFirstDate.textAlignment = .center
                twiceLastDate.textAlignment = .center
                y = cellTop + twiceSide + 8 + dateH + 24
            }
        }
        bodyMarker.frame = CGRect(x: bx, y: top, width: bw, height: y - top)
        return y
    }

    /// 全部段 / 格的框（网页 .sz-ann__month：上边一条发丝线 + 上内边距 14、月名与字数基线对齐的一行、间距 10、cols 列的格网、下边距 28）。
    /// 只算数，不碰视图；top = 第一段的上沿（content 坐标），bx / bw = 正文的左缘与宽。
    func monthsLayout(_ m: View, bx: CGFloat, bw: CGFloat, top: CGFloat, cols: Int, cellSide: CGFloat) -> MonthsLayout {
        let mt = metrics
        var out = MonthsLayout()
        out.cols = cols
        out.cellSide = cellSide
        let total = m.months.reduce(0) { $0 + $1.cells.count }
        out.cells.reserveCapacity(total)
        out.cellsInContent.reserveCapacity(total)
        out.cellMonth.reserveCapacity(total)
        out.cellData.reserveCapacity(total)
        // 月名（宋 22 / 500）与字数（黑 13）基线对齐的一行：各段一样，先算好
        let nameFont = NativeType.song(size: mt.value("fs22"), weight: .medium)
        // WebKit 的 flex 行把小数行盒向上包整（XXXL 的 40.5 → 41），否则每月累计少 1pt。
        let nameLine = ceil(mt.value("lh22"))
        let countFont = NativeType.compose(size: mt.value("fs13"), weight: .regular)
        let countLine = mt.line("lh13")
        let na = ShiziFlex.text(nameFont, line: nameLine)
        let ca = ShiziFlex.text(countFont, line: countLine)
        let row = ShiziFlex.baselineRow([(box: nameLine, ascent: na.ascent), (box: countLine, ascent: ca.ascent)])
        let headHeight = row.height
        var y = top
        for (i, sec) in m.months.enumerated() {
            // 上边一条发丝线 + 上内边距 14
            let top0 = y + hairline + monthPadTop
            // 月名的宽（按钮里的月名标签就是这段字：renderModel 按 sec.name 设）
            let nameW = ceil(ShiziMineText.width(sec.name.text, font: nameFont))
            // 格网
            let gridTop = top0 + headHeight + monthHeadGap
            let rows = Int(ceil(Double(sec.cells.count) / Double(cols)))
            let gridH = CGFloat(rows) * cellSide
            let h = hairline + monthPadTop + headHeight + monthHeadGap + gridH + monthGridGap
            out.months.append(MonthsLayout.MonthBox(
                frame: CGRect(x: bx, y: y, width: bw, height: h),
                nameFrame: CGRect(x: 0, y: hairline + monthPadTop + row.tops[0], width: nameW, height: nameLine),
                countFrame: CGRect(x: 0, y: hairline + monthPadTop + row.tops[1], width: bw, height: countLine),
                firstCell: out.cells.count, cellCount: sec.cells.count))
            for (j, c) in sec.cells.enumerated() {
                let col = j % cols
                let r = j / cols
                // 格子在段按钮里（按钮的坐标：按钮从 (bx, y) 起）
                let f = CGRect(x: CGFloat(col) * cellSide, y: gridTop - y + CGFloat(r) * cellSide, width: cellSide, height: cellSide)
                out.cells.append(f)
                out.cellsInContent.append(f.offsetBy(dx: bx, dy: y))
                out.cellMonth.append(i)
                out.cellData.append(c)
            }
            y += h
        }
        out.bottom = y
        return out
    }

    /// 空态（网页：笺面纸的空格子 + 标题 + 说明）。
    private func layoutEmpty(bx: CGFloat, bw: CGFloat, top: CGFloat) {
        let mt = metrics
        // 网页 .sz-page__body 的下内边距（s8）不算进正文
        let bodyH = max(0, scroll.bounds.height - top - mt.space(8))
        // 网页 .sz-empty：上内边距 s8、下内边距 s6，内容在中间竖向居中
        let inner = max(0, bodyH - mt.space(8) - mt.space(6))
        // 网页 .sz-empty__cell：72px × --k
        let cellSide: CGFloat = 72 * typeScale
        let titleH = mt.line("lh22")
        let bodyTextH = mt.line("lh15")
        // 格子的下外边距 s2 + 行间距 s2 + 标题 + 行间距 s2 + 说明
        let blockH = cellSide + mt.space(2) * 3 + titleH + bodyTextH
        let y = top + mt.space(8) + max(0, (inner - blockH) / 2)
        emptyView.frame = CGRect(x: bx, y: top, width: bw, height: bodyH)
        emptyGlyph.frame = CGRect(x: bx + (bw - cellSide) / 2, y: y, width: cellSide, height: cellSide)
        emptyGlyph.backgroundColor = color("sheet")
        emptyGlyph.layer.borderWidth = mt.value("frame-w")
        emptyGlyph.layer.borderColor = color("frame").cgColor
        emptyGlyph.subviews.forEach {
            $0.frame = CGRect(x: cellSide * 0.2, y: cellSide * 0.2, width: cellSide * 0.6, height: cellSide * 0.6)
        }
        let titleTop = y + cellSide + mt.space(2) * 2
        emptyTitle.frame = CGRect(x: bx, y: titleTop, width: bw, height: titleH)
        emptyTitle.textAlignment = .center
        emptyBody.frame = CGRect(x: bx, y: titleTop + titleH + mt.space(2), width: bw, height: bodyTextH)
        emptyBody.textAlignment = .center
    }

    /// 网页的字号倍率 --k（AX 档 / 大字号的乘数；空态的格子是 72px × k）。
    private var typeScale: CGFloat {
        let cats = (ShiziTokens.root["type"] as? [String: Any])?["categories"] as? [String: Any]
        let row = cats?[ShiziTokens.categoryName(metrics.category)] as? [String: Any]
        return ((row?["k"] as? NSNumber)?.doubleValue).map { CGFloat($0) } ?? 1
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if axLayout {
            // AX 档：网页的页头折成两行——第一行「‹」+「调整图片 ›」，第二行页标题
            // （本页的页标题是可见的 h1：盒高 = 一行字 + 下内边距 6，字从盒顶往上溢出一点）
            let row1 = axHeaderRowHeight()
            let row1Bottom = view.safeAreaInsets.top + row1
            applyAxHeader(row1: row1, titleRow: titleLabel.frame.height + 6,
                          titleTextTop: row1Bottom - 1, titleTextX: metrics.gutter + metrics.space(2) + 8)
        }
        layoutHeaderTrail()
        layoutFooter()
        updateCells() // 滚动区的高到这里才定（底栏让出之后）
    }

    private func layoutHeaderTrail() {
        let mt = metrics
        let w = view.bounds.width
        let font = NativeType.compose(size: mt.value("fs15"), weight: .regular)
        // 文字宽按网页口径量（UILabel 的 textRect；不用 Foundation 的 size：数字与字距都不同）
        let title = adjustButton.attributedTitle(for: .normal)
        let textW = ceil(ShiziMineText.width(title ?? NSAttributedString()))
        let boxW = textW + 2 * textBtnPad
        let right = w - mt.gutter + textBtnPad
        // AX 档：按钮的高 = 网页 .sz-btn--text 的 min-height（第一行因此变高）
        let h = axLayout ? axHeaderRowHeight() : max(mt.hit, font.ascender - font.descender)
        adjustButton.frame = CGRect(x: right - boxW, y: view.safeAreaInsets.top, width: boxW, height: h)
        if let tl = adjustButton.titleLabel {
            tl.frame = CGRect(x: textBtnPad, y: (h - tl.font.lineHeight) / 2, width: textW, height: tl.font.lineHeight)
            tl.textAlignment = .left
        }
        // 页标题在两端槽之间居中（网页 .sz-page__title：flex 1，两侧各让 s2；尾端槽的宽 = 按钮去掉负外边距后的宽）
        if !axLayout {
            let left = ShiziPageHeader.centerLeft(gutter: mt.gutter)
            // 空态没有尾端按钮（网页的 trailing 为空）：标题回到默认的整段宽
            let titleW = adjustButton.isHidden
                ? max(0, w - 2 * left)
                : max(0, w - mt.gutter - max(44, boxW - 2 * textBtnPad) - mt.space(2) - left)
            if titleLabel.frame.width != titleW {
                titleLabel.frame = CGRect(x: left, y: titleLabel.frame.minY, width: titleW, height: titleLabel.frame.height)
            }
        }
    }

    private func layoutFooter() {
        let mt = metrics
        let w = view.bounds.width
        let safeBottom = max(mt.space(6), view.safeAreaInsets.bottom)
        let btnH = max(mt.value("btn-h"), mt.hit)
        let footerH = mt.space(3) + btnH + safeBottom
        let footerTop = view.bounds.height - footerH
        footerView.frame = CGRect(x: 0, y: footerTop, width: w, height: footerH)
        footerView.backgroundColor = color("paper")
        scroll.frame = CGRect(x: scroll.frame.minX, y: scroll.frame.minY, width: w, height: max(0, footerTop - scroll.frame.minY))
        saveButton.frame = CGRect(x: mt.gutter, y: mt.space(3), width: w - 2 * mt.gutter, height: btnH)
        saveLive.frame = CGRect(x: 19, y: mt.space(3), width: 1, height: 1)
    }
}
