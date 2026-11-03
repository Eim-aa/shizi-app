import UIKit

// 月字帖（B3.9；网页 ui/screens/mine/month.js 的原生版）。
//
// 版式（网页 .sz-monthpage）：标题「{n}月字帖」（宋 28 / 36）→「按第一次写的先后排」（13 / 20）→ 字帖纸（格线 + 外框 + 日期角标）
//   → 落款（宋 13 / 20，右对齐）+ 印（24pt）→ 说明句（整月有衬底字时才有）。
// 底栏：「分享」/「保存图片」（AX 档排成一列）。页头右侧「调整图片 ›」。
//
// 「调整图片 / 保存图片」在原生这边直接开原生图片预览（B3.11：NativeImagePreviewController + image.* op，与结果页同一条路）。
//
// 文案与数据来自会话层（src/session/views/mine-sub.js monthView → App API view.month）；本页不写汉字与数值。

@objc(ShiziScreen_month)
final class MonthScreen: ShiziScreenViewController {
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
        let month: String
        let monthNum: Int
        let cells: [Cell]
        let n: Int
        let days: Int
        let under: Bool
        let kuan: String
        let cols: Int
        /// 网页量出的折行点（每一行从第几个字开始；nil = 没有断点）。
        struct Lines: Decodable {
            let sub: [Int]?
        }
        let lines: Lines?
    }

    // 网页 .sz-monthpage 里的定值
    private let headGap: CGFloat = 2
    private let pageGap: CGFloat = 12
    private let sealSide: CGFloat = 24
    private let textBtnPad: CGFloat = 4

    // 视图（成员名 / accessibilityIdentifier 是 QA 取证的语义键：keys/month.mjs）
    let bodyMarker = UIView()
    let titleLabel2 = UILabel()
    let subLabel = UILabel()
    let paperView = ShiziSheetPaper()
    let noteLabel = UILabel()
    let adjustButton = UIButton(type: .custom)
    let shareButton = UIButton(type: .custom)
    let saveButton = UIButton(type: .custom)
    let saveLive = UIView()
    private let footerView = UIView()
    private var paperCells: [ShiziPaperCell] = []
    private var model: View?
    private var sealPath: [[Any]] = []
    private var month: String = ""
    /// 每一格对应哪个字（按钮按下时按对象取）。
    private var cellChars: [ObjectIdentifier: String] = [:]

    override func viewDidLoad() {
        bodyMarker.accessibilityIdentifier = "native-month-body"
        titleLabel2.accessibilityIdentifier = "native-month-title"
        subLabel.accessibilityIdentifier = "native-month-sub"
        paperView.accessibilityIdentifier = "native-month-paper"
        noteLabel.accessibilityIdentifier = "native-month-note"
        adjustButton.accessibilityIdentifier = "native-month-adjust"
        shareButton.accessibilityIdentifier = "native-month-share-btn"
        saveButton.accessibilityIdentifier = "native-month-save"
        saveLive.accessibilityIdentifier = "native-month-save-live"
        paperView.sign.accessibilityIdentifier = "native-month-sign"
        paperView.kuanLabel.accessibilityIdentifier = "native-month-kuan"
        paperView.sealView.accessibilityIdentifier = "native-month-seal"
        for v in [bodyMarker, noteLabel, saveLive] as [UIView] {
            v.isUserInteractionEnabled = false
            v.isAccessibilityElement = false
            content.addSubview(v)
        }
        content.addSubview(titleLabel2)
        content.addSubview(subLabel)
        content.addSubview(paperView)
        // 页头的「调整图片 ›」在页头里（网页 .sz-page__trail），不在正文里
        view.addSubview(adjustButton)
        view.addSubview(footerView)
        footerView.addSubview(shareButton)
        footerView.addSubview(saveButton)
        titleLabel2.numberOfLines = 0
        subLabel.numberOfLines = 0
        noteLabel.numberOfLines = 0
        adjustButton.titleLabel?.numberOfLines = 1
        shareButton.titleLabel?.numberOfLines = 1
        saveButton.titleLabel?.numberOfLines = 1
        wire(adjustButton) { page in (page as? MonthScreen)?.openImage() }
        wire(shareButton) { page in (page as? MonthScreen)?.openImage() }
        wire(saveButton) { page in (page as? MonthScreen)?.openImage() }
        super.viewDidLoad()
    }
    override var watchedDomains: [String]? { ["records", "ink"] }

    // MARK: 视图

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: View.self)
        model = m
        month = m.month
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

    private func setHei(_ l: UILabel, _ text: String, size: CGFloat, color c: UIColor, line: CGFloat? = nil) {
        NativeType.set(l, text, font: NativeType.compose(size: size, weight: .regular), color: c, line: line)
    }

    private func renderModel(_ m: View) {
        let mt = metrics
        setSong(titleLabel2, t("X-WORK.monthTitle", ["month": m.monthNum]), size: mt.value("fs28"), weight: .medium, color: color("ink1"), line: mt.line("lh28"))
        titleLabel2.accessibilityLabel = t("X-WORK.monthTitle", ["month": m.monthNum])
        setHei(subLabel, ShiziMineLines.broken(t("X-MINE.sheetOrder"), m.lines?.sub), size: mt.value("fs13"), color: color("ink3"), line: mt.line("lh13"))
        subLabel.accessibilityLabel = t("X-MINE.sheetOrder")
        // 页头的标题（网页 .sz-page__title：AX 档是页头第二行的一行字，正常档只给读屏）
        setTitle(t("X-WORK.monthTitle", ["month": m.monthNum]))
        // 页头右侧「调整图片 ›」
        adjustButton.setTitle(t("X-WORK.adjustImage"), for: .normal)
        adjustButton.setTitleColor(color("ink2"), for: .normal)
        adjustButton.titleLabel?.font = NativeType.compose(size: mt.value("fs15"), weight: .regular)
        // 中文按字体的 trak 表补字距（网页 WebKit 按实际字号取；不补整段宽 2–3pt）
        NativeType.trackTitle(adjustButton)
        adjustButton.accessibilityLabel = t("X-WORK.adjustAria")
        // 底栏
        shareButton.setTitle(t("R-B10.share"), for: .normal)
        shareButton.setTitleColor(color("ink1"), for: .normal)
        shareButton.titleLabel?.font = NativeType.compose(size: mt.value("fs17"), weight: .medium)
        NativeType.trackTitle(shareButton) // 中文按字体的 trak 表补字距（大字号下网页的字更紧）
        shareButton.accessibilityLabel = t("R-B10.share")
        saveButton.setTitle(t("R-M01.saveImage"), for: .normal)
        saveButton.setTitleColor(color("btn-fg"), for: .normal)
        saveButton.titleLabel?.font = NativeType.compose(size: mt.value("fs17"), weight: .medium)
        NativeType.trackTitle(saveButton)
        saveButton.accessibilityLabel = t("R-M01.saveImage")
        styleFooterButtons()
        // 说明句（整月有衬底字时才有）
        noteLabel.isHidden = !m.under
        if m.under {
            setHei(noteLabel, t("X-WORK.monthUnderNote"), size: mt.value("fs13"), color: color("ink3"), line: mt.line("lh13"))
            noteLabel.accessibilityLabel = t("X-WORK.monthUnderNote")
        }
        // 字帖的纸
        paperView.isHidden = m.n == 0
        if paperCells.count != m.cells.count {
            paperCells.forEach { $0.removeFromSuperview() }
            paperCells = m.cells.map { c in
                let cell = ShiziPaperCell(char: c.ch, mode: c.mode, ink: c.ink)
                cell.tagLabel.accessibilityIdentifier = "native-month-cell"
                cell.accessibilityLabel = c.label.text
                paperView.addSubview(cell)
                let key = ObjectIdentifier(cell)
                wire(cell) { page in
                    guard let page = page as? MonthScreen else { return }
                    page.openDetail(page.cellChars[key] ?? "")
                }
                return cell
            }
        }
        for (i, c) in m.cells.enumerated() {
            paperCells[i].configure(char: c.ch, mode: c.mode, ink: c.ink)
            paperCells[i].tagText = c.tag
            paperCells[i].accessibilityLabel = c.label.text
            cellChars[ObjectIdentifier(paperCells[i])] = c.ch
            // 格按钮自己的字与色（网页 .sz-mcell：字与色继承按钮的，取证按按钮算）。
            // 顺序要紧：设 label.font 会改写它已有的富文本，所以先设字体、后画角标的富文本（11pt 等宽）。
            paperCells[i].styleButton(font: NativeType.compose(size: mt.value("fs15"), weight: .regular), color: color("ink1"))
            paperCells[i].style(ink: color("hand"), under: color("under"), tag: color("ink3"),
                                tagFont: ShiziFont.tabular(NativeType.compose(size: ShiziMineTag.fontSize, weight: .medium)), paper: color("sheet"))
        }
        paperView.configure(kuan: m.kuan, sealPath: sealPath)
        paperView.style(sheet: color("sheet"), frame: color("frame"), guide: color("guide"),
                        guideWidth: mt.value("guide-w"), frameWidth: mt.value("frame-w"),
                        kuanColor: color("ink2"), kuanFont: NativeType.song(size: 13, weight: .regular),
                        sealFill: color("seal"), sealGlyph: color("on-seal"))
    }

    /// 底栏两个按钮的样子（网页 .sz-btn--secondary / .sz-btn--primary）。
    private func styleFooterButtons() {
        let mt = metrics
        let radius = mt.value("r-ctl")
        shareButton.backgroundColor = .clear
        shareButton.layer.cornerRadius = radius
        shareButton.layer.borderWidth = 1
        shareButton.layer.borderColor = color("ink4").cgColor
        saveButton.backgroundColor = color("btn-bg")
        saveButton.layer.cornerRadius = radius
        saveButton.layer.borderWidth = 0
    }

    // MARK: 动作

    /// 格子 → 单字详情（网页 openDetail）。
    private func openDetail(_ char: String) {
        guard !char.isEmpty else { return }
        push("detail", params: ["char": char])
    }

    private func openImage() {
        presentImagePreview(scope: ["kind": "month", "month": month])
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
        var y = top
        // 标题 + 副标题（网页 .sz-monthpage__head：gap 2）
        let titleH = mt.line("lh28")
        titleLabel2.frame = CGRect(x: x, y: y, width: width, height: titleH)
        y += titleH + headGap
        let subH = NativeType.height(subLabel, width: width, line: mt.line("lh13"))
        subLabel.frame = CGRect(x: x, y: y, width: width, height: subH)
        y += subH
        // 字帖的纸
        guard let m = model else { return y }
        if m.n > 0 {
            y += pageGap
            let grid = ShiziSheetGrid(n: m.n, width: width)
            let paperH = ShiziSheetPaper.height(for: grid)
            paperView.frame = CGRect(x: x + (width - grid.W) / 2, y: y, width: grid.W, height: paperH)
            paperView.cells = paperCells
            paperView.setGrid(grid)
            y += paperH
        }
        // 说明句
        if m.under {
            y += pageGap
            let h = mt.line("lh13")
            noteLabel.frame = CGRect(x: x, y: y, width: width, height: h)
            y += h
        }
        bodyMarker.frame = CGRect(x: x, y: top, width: width, height: y - top)
        return y
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if axLayout {
            // AX 档：网页的页头折成两行（components/ax.js）——第一行「‹」+「调整图片 ›」，第二行页标题。
            // 本页的页标题只给读屏（网页 hideTitle）：那个 1 × 1 的 sr-only 盒子在 AX 档变成可见的一行字，
            // 盒子只有下内边距 6、外边距 −1（行高 = 4），字从盒顶往上溢出一点。
            let row1 = axHeaderRowHeight()
            let row1Bottom = view.safeAreaInsets.top + row1
            applyAxHeader(row1: row1, titleRow: 4, titleTextTop: row1Bottom - 2, titleTextX: metrics.gutter - 1 + 8)
        } else {
            // 标题只留给读屏（网页 hideTitle：1 × 1 的 sr-only）
            titleLabel.frame = CGRect(x: 19, y: 0, width: 1, height: 1)
        }
        layoutHeaderTrail()
        layoutFooter()
    }

    /// 页头右侧的「调整图片 ›」（网页 .sz-page__trail：右缘贴页边线 + 文字按钮的 4pt 内边距）。
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
    }

    /// 底栏（网页 .sz-page__foot：上内边距 12、下边距 max(24, 下安全区)、两个按钮）。
    private func layoutFooter() {
        let mt = metrics
        let w = view.bounds.width
        let safeBottom = max(mt.space(6), view.safeAreaInsets.bottom)
        let btnH = max(mt.value("btn-h"), mt.hit)
        let stacked = axLayout
        let contentH = stacked ? btnH * 2 + pageGap : btnH
        let footerH = mt.space(3) + contentH + safeBottom
        let footerTop = view.bounds.height - footerH
        footerView.frame = CGRect(x: 0, y: footerTop, width: w, height: footerH)
        footerView.backgroundColor = color("paper")
        // 正文区到页脚上沿为止
        scroll.frame = CGRect(x: scroll.frame.minX, y: scroll.frame.minY, width: w, height: max(0, footerTop - scroll.frame.minY))
        let innerW = w - 2 * mt.gutter
        if stacked {
            shareButton.frame = CGRect(x: mt.gutter, y: mt.space(3), width: innerW, height: btnH)
            saveButton.frame = CGRect(x: mt.gutter, y: mt.space(3) + btnH + pageGap, width: innerW, height: btnH)
        } else {
            let half = (innerW - pageGap) / 2
            shareButton.frame = CGRect(x: mt.gutter, y: mt.space(3), width: half, height: btnH)
            saveButton.frame = CGRect(x: mt.gutter + half + pageGap, y: mt.space(3), width: half, height: btnH)
        }
        saveLive.frame = CGRect(x: 19, y: mt.space(3), width: 1, height: 1)
    }
}
