import UIKit

// 年报（B3.9；网页 ui/screens/mine/annual.js 的原生版）。
//
// 版式（网页 .sz-ann）：卷首（「二〇二六」宋 34 / 42 → 「这一年，你拾回三十六个字。」17 / 26 → 今年第一个字（132 的格 + 「今年首字」+ 日期））
//   → 每月一段（上边一条发丝线、月名宋 22 + 右侧「{n} 字」、8 列 45 的格、无格线、墨内边 9%；点一段进那个月的字帖）
//   → 卷尾「同字两次」（两次的墨迹并排 + 各自的日期）。
// 空态：虚线格「年」+「今年还没有记录」+ 一句说明。
//
// 「调整图片 / 保存图片」在原生这边直接开原生图片预览（B3.11：NativeImagePreviewController + image.* op，与结果页同一条路）。
//
// 文案与数据来自会话层（src/session/views/mine-sub.js annualView → App API view.annual）；本页不写汉字与数值。

@objc(ShiziScreen_annual)
final class AnnualScreen: ShiziScreenViewController {
    struct View: Decodable {
        struct Cell: Decodable {
            let ch: String
            let ink: ShiziInkBox?
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
            let ink: ShiziInkBox?
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
            let cells: [Cell]
        }
        struct Side: Decodable {
            let recordId: String
            let day: String
            let ink: ShiziInkBox?
            let label: ShiziCopyRef
            let date: ShiziCopyRef
        }
        struct Twice: Decodable {
            let char: String
            let title: ShiziCopyRef
            let first: Side
            let last: Side
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
        let first: First?
        let months: [Month]
        let twice: Twice?
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

    /// 不进取证的装饰视图（格的内框、发丝线）按 tag 找，不存成员（成员名会被取证当元素）。
    private static let insetFrameTag = 9931
    private static let twiceHairTag = 9932
    private static let monthHairTag = 9933

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
    private var monthCells: [[UIView]] = []
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
    }

    override var watchedDomains: [String]? { ["records", "ink"] }

    // MARK: 视图

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: View.self)
        model = m
        if let s = (raw as? [String: Any])?["seal"] as? [[Any]] { sealPath = s }
        renderModel(m)
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
                g.padRatio = 0.06
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
                firstInk.inkColor = color("hand")
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
            monthButtons.forEach { $0.removeFromSuperview() }
            monthButtons = []
            monthCells = []
            for _ in m.months {
                let b = ShiziRowButton(frame: .zero)
                // 每段上边一条发丝线（网页 .sz-ann__month 的 border-top）：按钮里的子视图不进取证
                let hair = UIView()
                hair.tag = Self.monthHairTag
                hair.isUserInteractionEnabled = false
                b.addSubview(hair)
                content.addSubview(b)
                monthButtons.append(b)
                let key = ObjectIdentifier(b)
                wire(b) { page in
                    guard let page = page as? AnnualScreen else { return }
                    page.openMonth(page.monthKeys[key] ?? "")
                }
                monthCells.append([])
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
            // 每一段里的格子
            let cols = axLayout ? 6 : 8
            let cellSide: CGFloat = axLayout ? floor((view.bounds.width - 40) / 6) : min(45, floor((view.bounds.width - 40) / 8))
            if monthCells[i].count != sec.cells.count {
                monthCells[i].forEach { $0.removeFromSuperview() }
                monthCells[i] = sec.cells.map { c in
                    let cell = UIView()
                    cell.isAccessibilityElement = false
                    let ink = ShiziPointsInkView()
                    ink.pad = 0.09
                    ink.inkColor = color("hand")
                    cell.addSubview(ink)
                    let g = NativeGlyphView()
                    g.char = c.ch
                    g.color = color("under")
                    g.padRatio = 0.06
                    cell.addSubview(g)
                    b.addSubview(cell)
                    return cell
                }
            }
            for (j, c) in sec.cells.enumerated() {
                let cell = monthCells[i][j]
                let ink = cell.subviews.first as? ShiziPointsInkView
                let glyph = cell.subviews.last as? NativeGlyphView
                glyph?.char = c.ch
                if let box = c.ink, c.mode == "hand" {
                    ink?.isHidden = false
                    ink?.points = box.points
                    ink?.widthScale = ShiziInkScale.scale(cellSide, 1 - 2 * 0.09)
                    glyph?.isHidden = true
                } else {
                    ink?.isHidden = true
                    glyph?.isHidden = false
                }
            }
        }
        // 卷尾：同一个字，两次
        if let twice = m.twice {
            setSong(twiceTitle, twice.title.text, size: mt.value("fs22"), weight: .medium, color: color("ink1"), line: mt.line("lh22"))
            twiceTitle.accessibilityLabel = twice.title.text
            twiceFirstCell.backgroundColor = color("sheet")
            twiceLastCell.backgroundColor = color("sheet")
            twiceFirstInk.inkColor = color("hand")
            twiceLastInk.inkColor = color("hand")
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
        // 每月一段
        let cols = axLayout ? 6 : 8
        let cellSide: CGFloat = axLayout ? floor((view.bounds.width - 40) / 6) : min(45, floor((view.bounds.width - 40) / 8))
        for (i, sec) in m.months.enumerated() {
            let b = monthButtons[i]
            // 上边一条发丝线 + 上内边距 14
            let top0 = y + hairline + monthPadTop
            // 月名与字数（基线对齐的一行）
            let nameFont = NativeType.song(size: mt.value("fs22"), weight: .medium)
            let nameLine = mt.line("lh22")
            let countFont = NativeType.compose(size: mt.value("fs13"), weight: .regular)
            let countLine = mt.line("lh13")
            let na = ShiziFlex.text(nameFont, line: nameLine)
            let ca = ShiziFlex.text(countFont, line: countLine)
            let row = ShiziFlex.baselineRow([(box: nameLine, ascent: na.ascent), (box: countLine, ascent: ca.ascent)])
            let nameW = ceil(ShiziMineText.width(b.label.text ?? "", font: nameFont))
            let headHeight = row.height
            // 格网
            let gridTop = top0 + headHeight + monthHeadGap
            let rows = Int(ceil(Double(sec.cells.count) / Double(cols)))
            for (j, cell) in monthCells[i].enumerated() {
                let col = j % cols
                let row = j / cols
                // 格子在段按钮里（按钮的坐标：按钮从 (bx, y) 起）
                cell.frame = CGRect(x: CGFloat(col) * cellSide, y: gridTop - y + CGFloat(row) * cellSide, width: cellSide, height: cellSide)
                // 墨铺满格（ShiziPointsInkView 自己留 9% 内边）；衬底字画在同一个内框里（网页 paintCellContent：cellInkBox 再 paintOutline）
                cell.subviews.forEach { $0.frame = cell.bounds }
                cell.subviews.last?.frame = cell.bounds.insetBy(dx: cellSide * 0.09, dy: cellSide * 0.09)
            }
            let gridH = CGFloat(rows) * cellSide
            let h = hairline + monthPadTop + headHeight + monthHeadGap + gridH + monthGridGap
            b.frame = CGRect(x: bx, y: y, width: bw, height: h)
            b.viewWithTag(Self.monthHairTag)?.frame = CGRect(x: 0, y: 0, width: bw, height: hairline)
            // 按钮里的两段字：月名在左、字数在右，基线对齐（网页 .sz-ann__mhead：space-between + baseline）
            b.label.frame = CGRect(x: 0, y: hairline + monthPadTop + row.tops[0], width: nameW, height: nameLine)
            // 字数右对齐到版心的右缘（网页 space-between 的右端）：取证按按钮里全部文字的并集，右缘要对齐版心
            b.valueLabel.textAlignment = .right
            b.valueLabel.frame = CGRect(x: 0, y: hairline + monthPadTop + row.tops[1], width: bw, height: countLine)
            y += h
        }
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

    /// 空态（网页 components/EmptyState.js：笺面纸的空格子 + 标题 + 说明）。
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
            // AX 档：网页的页头折成两行（components/ax.js）——第一行「‹」+「调整图片 ›」，第二行页标题
            // （本页的页标题是可见的 h1：盒高 = 一行字 + 下内边距 6，字从盒顶往上溢出一点）
            let row1 = axHeaderRowHeight()
            let row1Bottom = view.safeAreaInsets.top + row1
            applyAxHeader(row1: row1, titleRow: titleLabel.frame.height + 6,
                          titleTextTop: row1Bottom - 1, titleTextX: metrics.gutter + metrics.space(2) + 8)
        }
        layoutHeaderTrail()
        layoutFooter()
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
