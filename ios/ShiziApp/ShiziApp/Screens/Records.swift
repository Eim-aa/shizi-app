import UIKit

// 练习记录（B3.9；网页 ui/screens/mine/records.js 的原生版）。
//
// 版式照网页 .sz-rec 那一列（自上而下）：月份行（「{月}月」+ 年份；右「‹ ›」）→ 标题 + 图例 → 月历（周一开头；有记录的日子画墨点、可点）
//   → 展开的那一天写的字（5 列）→「{月}月字帖」（月字帖纸 + 落款 + 印）→ 「{今天}写的字 / 本次的图片」。
//
// AX 档（A2-03）：月历换成「有记录的每一天一行」的列表，点一行展开那天写的字；字帖格的日期角标不画。
//
// 文案与数据来自会话层（src/session/views/mine-sub.js recordsView → App API view.records）；本页不写汉字与数值。

@objc(ShiziScreen_records)
final class RecordsScreen: ShiziScreenViewController {
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
        struct CalCell: Decodable {
            let key: String
            let blank: Bool
            let day: String
            let n: Int
            let has: Bool
            let today: Bool
            let future: Bool
        }
        struct DayRow: Decodable {
            let day: String
            let n: Int
            let today: Bool
            let label: ShiziCopyRef
        }
        struct Selected: Decodable {
            let day: String
            let title: ShiziCopyRef
            let paper: Bool
            let paperNote: ShiziCopyRef
            let cells: [Cell]
        }
        struct Sheet: Decodable {
            let month: String
            let monthNum: Int
            let cells: [Cell]
            let n: Int
            let days: Int
            let under: Bool
            let kuan: String
            let cols: Int
            let folded: Bool
            let title: ShiziCopyRef
        }
        struct TodayRow: Decodable {
            let day: String
            let n: Int
            let title: ShiziCopyRef
            let note: ShiziCopyRef
        }
        /// 网页量出的折行点（每一行从第几个字开始；nil = 没有断点）。
        struct Lines: Decodable {
            let title: [Int]?
            let legend: [Int]?
            let dayRows: [[Int]?]?
            let paperday: [Int]?
            let daylistTitle: [Int]?
        }
        let today: String
        let month: String
        let year: Int
        let monthNum: Int
        let current: Bool
        let prev: String?
        let next: String?
        let monthHead: ShiziCopyRef
        let yearText: String
        let title: ShiziCopyRef
        let legend: ShiziCopyRef
        let weekdays: ShiziCopyRef
        let calendar: [CalCell]
        let recordDays: Int
        let dayList: [DayRow]
        let selected: Selected?
        let sheet: Sheet?
        let todayRow: TodayRow?
        let lines: Lines?
    }

    // 网页 .sz-rec 里的定值（不随字号的版式常量）
    private let arrowSide: CGFloat = 44
    private let arrowBgSide: CGFloat = 34
    private let arrowIconSide: CGFloat = 18
    private let numSide: CGFloat = 30
    private let dotSide: CGFloat = 5
    private let dayMinHeight: CGFloat = 44
    private let weekdayHeight: CGFloat = 26
    private let calPadTop: CGFloat = 8
    private let calPadX: CGFloat = 6
    private let calPadBottom: CGFloat = 10
    private let headGap: CGFloat = 10
    private let titleGap: CGFloat = 6
    private let listGap: CGFloat = 12
    private let sheetGap: CGFloat = 12
    private let sheetCols: Int = 5
    private let hairline: CGFloat = 1.0 / 3.0

    // 视图（成员名 / accessibilityIdentifier 是 QA 取证的语义键：keys/records.mjs）
    let bodyMarker = UIView()
    let monthLabel = UILabel()
    let yearLabel = UILabel()
    let prevButton = UIButton(type: .custom)
    let nextButton = UIButton(type: .custom)
    let titleLabel2 = UILabel()
    let legendLabel = UILabel()
    let calendarMarker = UIView()
    let dayListTitle = UILabel()
    let dayListGrid = UIView()
    let paperNoteLabel = UILabel()
    let sheetTitleLabel = UILabel()
    let sheetNoteLabel = UILabel()
    let sheetOpenButton = ShiziTrailIconButton()
    let sheetSaveButton = UIButton(type: .custom)
    let todayButton = UIButton(type: .custom)
    let todayTitleLabel = UILabel()
    let todayNoteLabel = UILabel()
    private let sheetPaper = ShiziSheetPaper()
    private let dayListMarker = UIView()
    private let sheetMarker = UIView()
    private let todayMarker = UIView()
    private let axListMarker = UIView()

    private var weekdayLabels: [UILabel] = []
    private var dayButtons: [ShiziDayButton] = []
    private var dayViews: [UIView] = []
    /// 一天一个宿主视图（有记录的是按钮，没有的是空视图），与月历的非空白格一一对应（排版按 days 的下标取）。
    private var dayHosts: [UIView] = []
    /// 一天一个日号标签（有记录的在按钮里 = 网页 .sz-rec__num 那个 span，没有的在空视图里）。
    private var dayNums: [UILabel?] = []
    /// 当前月历里每一天的构成（key + 是否有记录）；变了就重排格子的控件。
    private var daySignature: String = ""
    private var dayListCells: [ShiziDayCell] = []
    private var sheetCells: [ShiziPaperCell] = []
    private var sheetOpenAttr = NSAttributedString(string: "")
    private var axRowButtons: [ShiziPlacedTitleButton] = []
    private var model: View?
    private var sealPath: [[Any]] = []
    /// 每一枚按钮对应的那一天 / 那个字（按钮按下时按对象取，避免闭包抓住旧数据）。
    private var dayKeys: [ObjectIdentifier: String] = [:]
    private var cellChars: [ObjectIdentifier: String] = [:]

    override func viewDidLoad() {
        bodyMarker.accessibilityIdentifier = "native-records-body"
        monthLabel.accessibilityIdentifier = "native-records-month"
        yearLabel.accessibilityIdentifier = "native-records-year"
        prevButton.accessibilityIdentifier = "native-records-prev"
        nextButton.accessibilityIdentifier = "native-records-next"
        titleLabel2.accessibilityIdentifier = "native-records-title"
        legendLabel.accessibilityIdentifier = "native-records-legend"
        calendarMarker.accessibilityIdentifier = "native-records-calendar"
        dayListTitle.accessibilityIdentifier = "native-records-daylist-title"
        dayListGrid.accessibilityIdentifier = "native-records-daylist-grid"
        paperNoteLabel.accessibilityIdentifier = "native-records-daylist-paper"
        sheetTitleLabel.accessibilityIdentifier = "native-records-sheet-title"
        sheetNoteLabel.accessibilityIdentifier = "native-month-note"
        sheetOpenButton.accessibilityIdentifier = "native-records-sheet-open"
        sheetSaveButton.accessibilityIdentifier = "native-records-sheet-save"
        todayButton.accessibilityIdentifier = "native-records-today"
        sheetPaper.accessibilityIdentifier = "native-records-sheet-grid"
        // 纸里的落款行与印（网页 MonthPaper 的 .sz-month__sign / .sz-month__seal）：
        // 语义键用 keys/month.mjs 的 month-sign / month-seal（网页这两块的 testid 就是 month-sign / month-seal，
        // 练习记录页与月字帖页共用同一块 MonthBody），这里用同一套 id 才好配对。
        sheetPaper.sign.accessibilityIdentifier = "native-month-sign"
        sheetPaper.sealView.accessibilityIdentifier = "native-month-seal"
        sheetMarker.accessibilityIdentifier = "native-records-sheet"
        dayListMarker.accessibilityIdentifier = "native-records-daylist"
        todayMarker.accessibilityIdentifier = "native-records-todaylist"
        for v in [bodyMarker, calendarMarker, sheetMarker, dayListMarker, todayMarker, axListMarker] as [UIView] {
            v.isUserInteractionEnabled = false
            v.isAccessibilityElement = false
            content.addSubview(v)
        }
        // AX 档的月历换成列表（网页 .sz-rec__axlist，testid 还是 records-calendar）
        axListMarker.accessibilityIdentifier = "native-records-calendar"
        for v in [monthLabel, yearLabel, titleLabel2, legendLabel, sheetTitleLabel, sheetNoteLabel, dayListTitle, paperNoteLabel,
                  todayTitleLabel, todayNoteLabel, sheetPaper] as [UIView] { content.addSubview(v) }
        content.addSubview(prevButton)
        content.addSubview(nextButton)
        content.addSubview(sheetOpenButton)
        content.addSubview(sheetSaveButton)
        content.addSubview(dayListGrid)
        content.addSubview(todayButton)
        for l in [monthLabel, yearLabel, titleLabel2, legendLabel, sheetTitleLabel, sheetNoteLabel, dayListTitle, paperNoteLabel, todayTitleLabel, todayNoteLabel] {
            l.numberOfLines = 0
        }
        prevButton.titleLabel?.isHidden = true
        nextButton.titleLabel?.isHidden = true
        todayButton.titleLabel?.isHidden = true
        wire(prevButton) { page in (page as? RecordsScreen)?.pickMonth(-1) }
        wire(nextButton) { page in (page as? RecordsScreen)?.pickMonth(1) }
        wire(sheetOpenButton) { page in (page as? RecordsScreen)?.openSheet() }
        wire(sheetSaveButton) { page in (page as? RecordsScreen)?.openImage("month") }
        wire(todayButton) { page in (page as? RecordsScreen)?.openImage("day") }
        super.viewDidLoad()
        setTitle(t("R-M01.practiceLog"))
    }

    override var watchedDomains: [String]? { ["records", "ink"] }

    // MARK: 视图

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: View.self)
        model = m
        if let s = (raw as? [String: Any])?["seal"] as? [[Any]] { sealPath = s }
        renderModel(m)
    }

    /// 宋体的字（不补苹方的字距）。
    private func song(_ size: CGFloat, _ weight: UIFont.Weight = .regular) -> UIFont { NativeType.song(size: size, weight: weight) }

    /// 黑体的字（正文）。
    private func setHei(_ l: UILabel, _ text: String, size: CGFloat, weight: UIFont.Weight = .regular, color c: UIColor, align: NSTextAlignment = .natural, line: CGFloat? = nil) {
        NativeType.set(l, text, font: NativeType.compose(size: size, weight: weight), color: c, align: align, line: line)
    }

    /// 黑体的字（给定字体；等宽数字用这条）。
    private func setHei(_ l: UILabel, _ text: String, font: UIFont, color c: UIColor, align: NSTextAlignment = .natural, line: CGFloat? = nil) {
        NativeType.set(l, text, font: font, color: c, align: align, line: line)
    }

    /// 宋体的字（标题 / 落款）。
    private func setSong(_ l: UILabel, _ text: String, size: CGFloat, weight: UIFont.Weight = .regular, color c: UIColor, align: NSTextAlignment = .natural, line: CGFloat? = nil) {
        l.attributedText = nil
        l.font = song(size, weight)
        l.textColor = c
        l.textAlignment = align
        // 网页这些标题都是一行（.sz-rec__month 有 white-space:nowrap）：不折行，宽度不够就溢出（网页的行为）
        l.numberOfLines = 1
        l.lineBreakMode = .byClipping
        guard !text.isEmpty else { l.text = ""; return }
        let p = NSMutableParagraphStyle()
        p.alignment = align
        var attrs: [NSAttributedString.Key: Any] = [.font: l.font as Any, .foregroundColor: c, .kern: 0, .paragraphStyle: p]
        if let line, line > 0 {
            p.minimumLineHeight = line
            p.maximumLineHeight = line
            attrs[.baselineOffset] = (line - (l.font?.lineHeight ?? 0)) / 4
        }
        l.attributedText = NSAttributedString(string: text, attributes: attrs)
    }

    /// 宋体的字（按网页量出的折行点折成几行；没有断点时同 setSong）。
    private func setSongWrapped(_ l: UILabel, _ text: String, size: CGFloat, weight: UIFont.Weight = .regular, color c: UIColor, line: CGFloat? = nil) {
        setSong(l, text, size: size, weight: weight, color: c, line: line)
        if text.contains("\n") {
            l.numberOfLines = 0
            l.lineBreakMode = .byWordWrapping
        }
    }

    private func renderModel(_ m: View) {
        let mt = metrics
        setSong(monthLabel, m.monthHead.text, size: mt.value("fs28"), weight: .medium, color: color("ink1"), line: mt.line("lh28"))
        monthLabel.accessibilityLabel = m.monthHead.text
        setHei(yearLabel, m.yearText, font: ShiziFont.tabular(NativeType.compose(size: mt.value("fs13"), weight: .regular)), color: color("ink3"), line: mt.line("lh15"))
        yearLabel.accessibilityLabel = m.yearText
        // 折行点（网页量的：AX 档标题会折行，原生照网页的位置折）
        setSongWrapped(titleLabel2, ShiziMineLines.broken(m.title.text, m.lines?.title), size: mt.value("fs22"), weight: .medium, color: color("ink1"), line: mt.line("lh22"))
        titleLabel2.accessibilityLabel = m.title.text
        setHei(legendLabel, ShiziMineLines.broken(m.legend.text, m.lines?.legend), size: mt.value("fs15"), color: color("ink2"), line: mt.line("lh15"))
        legendLabel.accessibilityLabel = m.legend.text
        // 月份两端的箭头
        styleArrow(prevButton, enabled: m.prev != nil, label: t("X-MINE.prevMonth"), icon: .prev)
        styleArrow(nextButton, enabled: m.next != nil, label: t("X-MINE.nextMonth"), icon: .next)
        // 月历（AX 档换成列表）
        if axLayout {
            renderAxList(m)
        } else {
            renderCalendar(m)
        }
        // 展开的那一天
        renderDayList(m)
        // 月字帖块
        renderSheet(m)
        // 「{今天}写的字」那一行
        renderTodayRow(m)
    }

    private func styleArrow(_ b: UIButton, enabled: Bool, label: String, icon: ShiziMineIcon) {
        b.isEnabled = enabled
        b.accessibilityLabel = label
        b.setTitleColor(color(enabled ? "ink2" : "ink4"), for: .normal)
        b.titleLabel?.font = NativeType.compose(size: metrics.value("fs15"), weight: .regular)
        b.backgroundColor = .clear
        b.setImage(icon.image(color(enabled ? "ink2" : "ink4"), size: arrowIconSide), for: .normal)
    }

    // MARK: 月历（网格）

    private func renderCalendar(_ m: View) {
        let mt = metrics
        axListMarker.isHidden = true
        axRowButtons.forEach { $0.removeFromSuperview() }
        axRowButtons = []
        calendarMarker.isHidden = false
        let weekdays = m.weekdays.lines
        if weekdayLabels.count != weekdays.count {
            weekdayLabels.forEach { $0.removeFromSuperview() }
            weekdayLabels = weekdays.map { _ in UILabel() }
            for l in weekdayLabels {
                l.accessibilityIdentifier = "native-records-weekday"
                l.isAccessibilityElement = false
                content.addSubview(l)
            }
        }
        for (i, l) in weekdayLabels.enumerated() {
            // 行盒高是继承来的 lh15（网页 .sz-rec__wd 没设 line-height）
            setHei(l, weekdays[i], size: mt.value("fs11"), color: color("ink3"), align: .center, line: mt.line("lh15"))
        }
        // 一天一格（空白格也在：网页的月历按同一组格子排）
        let cells = m.calendar
        let days = cells.filter { !$0.blank }
        // 格子的构成变了就重排（换月：日子数可能相同，但哪些日子有记录不同）
        let signature = days.map { "\($0.key):\($0.has)" }.joined(separator: ",")
        if daySignature != signature {
            daySignature = signature
            dayButtons.forEach { $0.removeFromSuperview() }
            dayViews.forEach { $0.removeFromSuperview() }
            dayButtons = []
            dayViews = []
            dayHosts = []
            dayNums = []
            for cell in days {
                let host: UIView
                if cell.has {
                    // 有记录的日子是按钮（网页 .sz-rec__day.sz-btn），日号在按钮的标题里（网页 .sz-rec__num 那个 span）
                    let b = ShiziDayButton(frame: .zero)
                    b.accessibilityIdentifier = "native-records-day"
                    content.addSubview(b)
                    dayButtons.append(b)
                    let key = ObjectIdentifier(b)
                    wire(b) { page in
                        guard let page = page as? RecordsScreen else { return }
                        page.pickDay(page.dayKeys[key] ?? "")
                    }
                    host = b
                    dayNums.append(nil)
                } else {
                    // 没有记录的日子是空的 span（网页 .sz-rec__day[data-has=false]），日号是里面的一个 span
                    let v = UIView()
                    v.accessibilityIdentifier = "native-records-day"
                    v.isAccessibilityElement = false
                    content.addSubview(v)
                    dayViews.append(v)
                    host = v
                    let l = UILabel()
                    l.isAccessibilityElement = false
                    l.textAlignment = .center
                    v.addSubview(l)
                    dayNums.append(l)
                }
                dayHosts.append(host)
            }
        }
        let selected = m.selected?.day
        for (i, cell) in days.enumerated() where i < dayHosts.count {
            let weight: UIFont.Weight = cell.today ? .semibold : .regular
            let c = cell.future ? color("ink3") : color("ink1")
            // 等宽数字（网页 .sz-rec__cal 的 font-variant-numeric: tabular-nums）
            let font = ShiziFont.tabular(NativeType.compose(size: mt.value("fs15"), weight: weight))
            if i < dayNums.count, let num = dayNums[i] {
                setHei(num, String(cell.n), font: font, color: c, align: .center, line: mt.value("fs15"))
                num.accessibilityIdentifier = "native-records-day-num"
            }
            if cell.has, let b = dayHosts[i] as? ShiziDayButton {
                b.setTitle(String(cell.n), for: .normal)
                b.titleLabel?.font = font
                b.setTitleColor(color("ink1"), for: .normal)
                b.dot.backgroundColor = color("ink1")
                b.dot.isHidden = false
                b.accessibilityLabel = t("X-MINE.dayRecorded", ["date": dayText(cell.day)])
                b.accessibilityTraits = selected == cell.day ? [.button, .selected] : .button
                dayKeys[ObjectIdentifier(b)] = cell.day
            }
        }
    }

    /// 「{M}月{D}日」。
    private func dayText(_ day: String) -> String {
        let parts = day.split(separator: "-")
        guard parts.count == 3, let m = Int(parts[1]), let d = Int(parts[2]) else { return day }
        return t("R-H02.dateFormat", ["month": m, "day": d])
    }

    // MARK: AX 档的月历（列表）

    private func renderAxList(_ m: View) {
        let mt = metrics
        calendarMarker.isHidden = true
        weekdayLabels.forEach { $0.removeFromSuperview() }
        weekdayLabels = []
        dayButtons.forEach { $0.removeFromSuperview() }
        dayButtons = []
        dayViews.forEach { $0.removeFromSuperview() }
        dayViews = []
        dayHosts = []
        dayNums.forEach { $0?.removeFromSuperview() }
        dayNums = []
        daySignature = ""
        axListMarker.isHidden = false
        if axRowButtons.count != m.dayList.count {
            axRowButtons.forEach { $0.removeFromSuperview() }
            axRowButtons = []
            for _ in m.dayList {
                let b = ShiziPlacedTitleButton(type: .custom)
                b.accessibilityIdentifier = "native-records-day"
                b.contentHorizontalAlignment = .leading
                b.titleLabel?.numberOfLines = 0
                b.titleLabel?.textAlignment = .left
                b.setTitleColor(color("ink1"), for: .normal)
                content.addSubview(b)
                axRowButtons.append(b)
            }
        }
        for (i, row) in m.dayList.enumerated() {
            let text = row.label.text
            let rows = m.lines?.dayRows ?? []
            let starts: [Int]? = i < rows.count ? rows[i] : nil
            let broken = ShiziMineLines.broken(text, starts)
            let b = axRowButtons[i]
            if let tl = b.titleLabel {
                NativeType.set(tl, broken, font: NativeType.compose(size: mt.value("fs17"), weight: .regular),
                               color: color("ink1"), align: .left, line: mt.line("lh17s"))
                // 标题挂到按钮上（网页 .sz-rec__axrow 是按钮）：按钮才知道要排它的字
                b.setAttributedTitle(tl.attributedText, for: .normal)
                tl.numberOfLines = 0
                tl.textAlignment = .left
            }
            b.accessibilityLabel = text
            b.accessibilityTraits = m.selected?.day == row.day ? [.button, .selected] : .button
        }
    }

    // MARK: 展开的那一天

    private func renderDayList(_ m: View) {
        let mt = metrics
        guard let sel = m.selected else {
            dayListMarker.isHidden = true
            dayListGrid.isHidden = true
            dayListTitle.isHidden = true
            paperNoteLabel.isHidden = true
            dayListCells.forEach { $0.isHidden = true }
            return
        }
        dayListMarker.isHidden = false
        if sel.paper {
            dayListGrid.isHidden = true
            dayListTitle.isHidden = true
            paperNoteLabel.isHidden = false
            setHei(paperNoteLabel, ShiziMineLines.broken(sel.paperNote.text, m.lines?.paperday), size: mt.value("fs13"), color: color("ink3"), line: mt.line("lh13"))
            paperNoteLabel.accessibilityLabel = sel.paperNote.text
        } else {
            paperNoteLabel.isHidden = true
            dayListTitle.isHidden = false
            dayListGrid.isHidden = false
            setSongWrapped(dayListTitle, ShiziMineLines.broken(sel.title.text, m.lines?.daylistTitle), size: mt.value("fs22"), weight: .medium, color: color("ink2"), line: mt.line("lh22"))
            dayListTitle.accessibilityLabel = sel.title.text
            if dayListCells.count != sel.cells.count {
                dayListCells.forEach { $0.removeFromSuperview() }
                dayListCells = sel.cells.map { c in
                    let cell = ShiziDayCell(char: c.ch, mode: c.mode, ink: c.ink, noInkText: t("R-D07.noInkLabel"))
                    cell.accessibilityIdentifier = "native-records-daylist-cell"
                    cell.accessibilityLabel = c.label.text
                    // 格按钮自己的字与色（网页 .sz-scell：字与色继承按钮的，取证按按钮算）
                    cell.setTitleColor(color("ink1"), for: .normal)
                    cell.titleLabel?.font = NativeType.compose(size: mt.value("fs15"), weight: .regular)
                    dayListGrid.addSubview(cell)
                    let key = ObjectIdentifier(cell)
                    wire(cell) { page in
                        guard let page = page as? RecordsScreen else { return }
                        page.openDetail(page.cellChars[key] ?? "")
                    }
                    return cell
                }
            }
            for (i, c) in sel.cells.enumerated() {
                dayListCells[i].configure(char: c.ch, mode: c.mode, ink: c.ink)
                dayListCells[i].accessibilityLabel = c.label.text
                cellChars[ObjectIdentifier(dayListCells[i])] = c.ch
                dayListCells[i].style(ink: color("hand"), under: color("under"), noInk: color("ink3"),
                                      font: NativeType.compose(size: mt.value("fs13"), weight: .regular))
            }
        }
    }

    // MARK: 月字帖块

    private func renderSheet(_ m: View) {
        let mt = metrics
        guard let sheet = m.sheet, sheet.n > 0 else {
            sheetMarker.isHidden = true
            sheetPaper.isHidden = true
            sheetTitleLabel.isHidden = true
            sheetNoteLabel.isHidden = true
            sheetOpenButton.isHidden = true
            sheetSaveButton.isHidden = true
            return
        }
        sheetMarker.isHidden = false
        sheetPaper.isHidden = false
        sheetTitleLabel.isHidden = false
        // 说明句（整月有衬底字时才有；网页 .sz-rec__sheet 的 gap 12）
        sheetNoteLabel.isHidden = !sheet.under
        if sheet.under {
            setHei(sheetNoteLabel, t("X-WORK.monthUnderNote"), size: mt.value("fs13"), color: color("ink3"), line: mt.line("lh13"))
            sheetNoteLabel.accessibilityLabel = t("X-WORK.monthUnderNote")
        }
        sheetOpenButton.isHidden = false
        // 富文本标题（字距 0，与网页同宽）：先设标题色再设富文本——setTitleColor 会按按钮的标题属性重建富文本，
        // 把 .kern 丢掉（网页按原始 advance 排字，重建后数字被换成等宽变体，整段宽 2–3pt）。
        sheetOpenButton.setTitleColor(color("ink2"), for: .normal)
        sheetOpenAttr = NSAttributedString(string: sheet.title.text, attributes: [
            .font: song(mt.value("fs22"), .medium), .foregroundColor: color("ink2"), .kern: 0
        ])
        sheetOpenButton.setAttributedTitle(sheetOpenAttr, for: .normal)
        sheetOpenButton.accessibilityLabel = sheet.title.text
        sheetOpenButton.iconSize = CGSize(width: 8, height: 13)
        sheetOpenButton.setImage(ShiziChevron.image(color("ink2"), size: CGSize(width: 8, height: 13)), for: .normal)
        sheetSaveButton.setTitleColor(color("ink2"), for: .normal)
        sheetSaveButton.setAttributedTitle(NSAttributedString(string: t("R-M01.saveImage"), attributes: [
            .font: NativeType.compose(size: mt.value("fs15"), weight: .regular), .foregroundColor: color("ink2"), .kern: 0
        ]), for: .normal)
        sheetSaveButton.accessibilityLabel = t("R-M01.saveImage")
        // 字帖的纸
        if sheetCells.count != sheet.cells.count {
            sheetCells.forEach { $0.removeFromSuperview() }
            sheetCells = sheet.cells.map { c in
                let cell = ShiziPaperCell(char: c.ch, mode: c.mode, ink: c.ink)
                cell.tagLabel.accessibilityIdentifier = "native-records-sheet-cell"
                cell.accessibilityLabel = c.label.text
                sheetPaper.addSubview(cell)
                let key = ObjectIdentifier(cell)
                wire(cell) { page in
                    guard let page = page as? RecordsScreen else { return }
                    page.openDetail(page.cellChars[key] ?? "")
                }
                return cell
            }
        }
        for (i, c) in sheet.cells.enumerated() {
            sheetCells[i].configure(char: c.ch, mode: c.mode, ink: c.ink)
            sheetCells[i].tagText = c.tag
            sheetCells[i].accessibilityLabel = c.label.text
            cellChars[ObjectIdentifier(sheetCells[i])] = c.ch
            // 格按钮自己的字与色（网页 .sz-mcell：字与色继承按钮的，取证按按钮算）。
            // 顺序要紧：设 label.font 会改写它已有的富文本，所以先设字体、后画角标的富文本（11pt 等宽）。
            sheetCells[i].styleButton(font: NativeType.compose(size: mt.value("fs15"), weight: .regular), color: color("ink1"))
            sheetCells[i].style(ink: color("hand"), under: color("under"), tag: color("ink3"),
                                tagFont: ShiziFont.tabular(NativeType.compose(size: ShiziMineTag.fontSize, weight: .medium)), paper: color("sheet"))
        }
        sheetPaper.configure(kuan: sheet.kuan, sealPath: sealPath)
        sheetPaper.style(sheet: color("sheet"), frame: color("frame"), guide: color("guide"),
                         guideWidth: mt.value("guide-w"), frameWidth: mt.value("frame-w"),
                         kuanColor: color("ink2"), kuanFont: song(13), sealFill: color("seal"), sealGlyph: color("on-seal"))
    }

    // MARK: 「{今天}写的字」那一行

    private func renderTodayRow(_ m: View) {
        let mt = metrics
        guard let row = m.todayRow else {
            todayMarker.isHidden = true
            todayButton.isHidden = true
            return
        }
        todayMarker.isHidden = false
        todayButton.isHidden = false
        setHei(todayTitleLabel, row.title.text, size: mt.value("fs15"), color: color("ink1"), line: mt.line("lh15"))
        setHei(todayNoteLabel, row.note.text, size: mt.value("fs15"), color: color("ink2"), line: mt.line("lh15"))
        todayButton.accessibilityLabel = row.title.text
    }

    // MARK: 动作

    private func pickMonth(_ delta: Int) {
        guard let m = model else { return }
        let next = delta < 0 ? m.prev : m.next
        guard let next else { return }
        pushParams(month: next, day: nil)
    }

    /// 展开 / 收起某一天（网页 onPick：同一天再点一次收起）。
    private func pickDay(_ day: String) {
        guard let m = model, !day.isEmpty else { return }
        let next = (m.selected?.day == day) ? nil : day
        pushParams(month: m.month, day: next)
    }

    /// 格子 → 单字详情（网页 openDetail）。
    private func openDetail(_ char: String) {
        guard !char.isEmpty else { return }
        push("detail", params: ["char": char])
    }

    private func pushParams(month: String?, day: String?) {
        guard let engine = stage?.engine else { return }
        // 本页自己的参数也要跟着改（重拉视图用它；网页路由那边由 nav.setParams 记下，冷启动可恢复）
        var next = params
        if let month { next["month"] = month } else { next.removeValue(forKey: "month") }
        if let day { next["day"] = day } else { next.removeValue(forKey: "day") }
        update(params: next)
        Task { @MainActor [weak self] in
            _ = await engine.raw("nav.setParams", ["patch": ["month": (month as Any?) ?? NSNull(), "day": (day as Any?) ?? NSNull()]])
            self?.reload()
        }
    }

    private func openSheet() {
        guard let m = model, let sheet = m.sheet else { return }
        push("month", params: ["month": sheet.month])
    }

    private func openImage(_ kind: String) {
        guard let m = model else { return }
        var scope: [String: Any] = ["kind": kind]
        if kind == "month", let sheet = m.sheet { scope["month"] = sheet.month }
        if kind == "day", let row = m.todayRow { scope["day"] = row.day }
        presentImagePreview(scope: scope)
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
        // 月份行（.sz-rec__mhead：左「{月}月 + 年份」，右两个箭头）
        let monthFont = song(mt.value("fs28"), .medium)
        let monthLine = mt.line("lh28")
        let yearFont = ShiziFont.tabular(NativeType.compose(size: mt.value("fs13"), weight: .regular))
        let yearLine = mt.line("lh15")
        let ma = ShiziFlex.text(monthFont, line: monthLine)
        let ya = ShiziFlex.text(yearFont, line: yearLine)
        let row = ShiziFlex.baselineRow([(box: monthLine, ascent: ma.ascent), (box: yearLine, ascent: ya.ascent)])
        // 行高 = 月份字与箭头两者更高的那个（网页 align-items:center）
        let headH = max(arrowSide, row.height)
        let rowTop = y + (headH - row.height) / 2
        let monthW = ShiziMineText.width(monthLabel.attributedText ?? NSAttributedString())
        monthLabel.frame = CGRect(x: x, y: rowTop + row.tops[0], width: ceil(monthW), height: monthLine)
        let yearW = ceil((yearLabel.text as NSString?)?.size(withAttributes: [.font: yearFont]).width ?? 0)
        yearLabel.frame = CGRect(x: x + monthW + headGap, y: rowTop + row.tops[1], width: yearW, height: yearLine)
        // 箭头（网页 .sz-rec__arrows：间距 4、右边距 −8；行内居中）
        let nextX = x + width + 8 - arrowSide
        nextButton.frame = CGRect(x: nextX, y: y + (headH - arrowSide) / 2, width: arrowSide, height: arrowSide)
        prevButton.frame = CGRect(x: nextX - 4 - arrowSide, y: y + (headH - arrowSide) / 2, width: arrowSide, height: arrowSide)
        styleArrowBg(prevButton)
        styleArrowBg(nextButton)
        y += headH
        // 标题 + 图例
        y += mt.groupGap
        let titleH = NativeType.height(titleLabel2, width: width, line: mt.line("lh22"))
        titleLabel2.frame = CGRect(x: x, y: y, width: width, height: titleH)
        y += titleH + titleGap
        let legendH = NativeType.height(legendLabel, width: width, line: mt.line("lh15"))
        legendLabel.frame = CGRect(x: x, y: y, width: width, height: legendH)
        y += legendH
        // 月历（AX 档：列表）
        y += mt.groupGap
        if axLayout {
            y = layoutAxList(x: x, y: y, width: width)
        } else {
            y = layoutCalendar(x: x, y: y, width: width)
            if let sel = model?.selected {
                y += mt.groupGap
                y = layoutDayList(sel, x: x, y: y, width: width)
            }
        }
        // 月字帖块
        if let sheet = model?.sheet, sheet.n > 0 {
            y += mt.groupGap
            let sheetTop = y
            let openFont = song(mt.value("fs22"), .medium)
            let saveFont = NativeType.compose(size: mt.value("fs15"), weight: .regular)
            // 网页 .sz-rec__shead：align-items:baseline——两个按钮（min-height 44，字在里面居中）按各自第一行的基线对齐，
            // 行高 = 对齐后两者更靠下的那个的底（L 档存字钮低 4，大字号下更低）
            let openLine = mt.line("lh22")
            let saveLine = mt.line("lh15")
            let openAscent = (44 - openLine) / 2 + ShiziFlex.text(openFont, line: openLine).ascent
            let saveAscent = (44 - saveLine) / 2 + ShiziFlex.text(saveFont, line: saveLine).ascent
            let headRow = ShiziFlex.baselineRow([(box: 44, ascent: openAscent), (box: 44, ascent: saveAscent)])
            let headH2 = headRow.height
            // 标题按富文本量（字距 0，与网页一致）
            // 量自己存的富文本：按钮在设图标 / 标题色后会按标题属性重建富文本、丢掉 .kern（数字被换成等宽变体，整段宽 2–3pt）
            let openTitle = sheetOpenAttr
            sheetOpenButton.setAttributedTitle(openTitle, for: .normal)
            let titleW = ceil(ShiziMineText.width(openTitle))
            let openW = titleW + 8 + 8
            sheetOpenButton.frame = CGRect(x: x, y: y + headRow.tops[0], width: openW, height: 44)
            sheetTitleLabel.frame = CGRect(x: x, y: y + headRow.tops[0], width: openW, height: 44)
            let saveTitle = sheetSaveButton.attributedTitle(for: .normal) ?? NSAttributedString(string: "")
            let saveTextW = ceil(saveTitle.size().width)
            let saveW = saveTextW + 8
            // 网页 .sz-btn--text 的负外边距（右边 −4）：按钮的右边比版心多出 4pt
            sheetSaveButton.frame = CGRect(x: x + width - saveW + 4, y: y + headRow.tops[1], width: saveW, height: 44)
            if let tl = sheetSaveButton.titleLabel {
                let lh = saveFont.lineHeight
                tl.frame = CGRect(x: 4, y: (44 - lh) / 2, width: saveTextW, height: lh)
                tl.textAlignment = .left
            }
            y += headH2 + sheetGap
            let grid = ShiziSheetGrid(n: sheet.n, width: width)
            let paperW = grid.W
            let paperH = ShiziSheetPaper.height(for: grid)
            sheetPaper.frame = CGRect(x: x + (width - paperW) / 2, y: y, width: paperW, height: paperH)
            sheetPaper.cells = sheetCells
            sheetPaper.setGrid(grid)
            y += paperH
            // 说明句（网页 .sz-rec__sheet 的 gap 12）
            if sheet.under {
                y += sheetGap
                let noteH = NativeType.height(sheetNoteLabel, width: width, line: mt.line("lh13"))
                sheetNoteLabel.frame = CGRect(x: x, y: y, width: width, height: noteH)
                y += noteH
            }
            sheetMarker.frame = CGRect(x: x, y: sheetTop, width: width, height: y - sheetTop)
        }
        // 「{今天}写的字」那一行
        if model?.todayRow != nil {
            y += mt.groupGap
            let todayTop = y
            let rowH: CGFloat = 52
            todayButton.frame = CGRect(x: x, y: y, width: width, height: rowH)
            todayTitleLabel.frame = CGRect(x: x, y: y + 8, width: width, height: mt.line("lh15"))
            todayNoteLabel.frame = CGRect(x: x, y: y + 8 + mt.line("lh15") + 3, width: width, height: mt.line("lh15"))
            todayMarker.frame = CGRect(x: x, y: todayTop, width: width, height: rowH)
            y += rowH
        }
        bodyMarker.frame = CGRect(x: x, y: top, width: width, height: y - top)
        return y
    }

    private func layoutCalendar(x: CGFloat, y: CGFloat, width: CGFloat) -> CGFloat {
        guard let m = model else { return y }
        let calW = width
        let colW = (calW - 2 * calPadX) / 7
        let rows = Int(ceil(Double(m.calendar.count) / 7.0))
        let calH = calPadTop + weekdayHeight + CGFloat(rows) * dayMinHeight + calPadBottom
        calendarMarker.frame = CGRect(x: x, y: y, width: calW, height: calH)
        for (i, l) in weekdayLabels.enumerated() {
            // 网页 .sz-rec__wd：高 26 的网格里行盒比 26 矮就居中、比 26 高（大字号）网格轨道跟着变高、行盒贴顶
            let wdLine = metrics.line("lh15")
            l.frame = CGRect(x: x + calPadX + CGFloat(i) * colW, y: y + calPadTop + max(0, (weekdayHeight - wdLine) / 2), width: colW, height: wdLine)
        }
        let days = m.calendar.filter { !$0.blank }
        for (i, cell) in days.enumerated() where i < dayHosts.count {
            // 位置按整组格子排（网页的月历是一张 7 列的表，空白格也占位）
            let slot = m.calendar.firstIndex { $0.key == cell.key } ?? i
            let col = slot % 7
            let row = slot / 7
            let cx = x + calPadX + CGFloat(col) * colW
            let cy = y + calPadTop + weekdayHeight + CGFloat(row) * dayMinHeight
            let target = dayHosts[i]
            target.frame = CGRect(x: cx, y: cy, width: colW, height: dayMinHeight)
            // 日号在 30 × 30 的圆里（网页 .sz-rec__num）；按钮里的那个由 ShiziDayButton 自己摆
            if i < dayNums.count, let num = dayNums[i] {
                num.frame = CGRect(x: (colW - numSide) / 2, y: 0, width: numSide, height: numSide)
            }
        }
        return y + calH
    }

    /// AX 档的月历：有记录的每一天一行（网页 .sz-rec__axlist / .sz-rec__axrow）。
    /// 展开的那一天写在它那一行下面（网页把 DayList 插在 axitem 里）。
    private func layoutAxList(x: CGFloat, y: CGFloat, width: CGFloat) -> CGFloat {
        guard let m = model else { return y }
        let mt = metrics
        let rowH: CGFloat = 52
        var cursor = y + hairline
        let start = cursor
        for (i, row) in m.dayList.enumerated() {
            let b = axRowButtons[i]
            let need = ceil((b.titleLabel?.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height ?? 0))
            let h = max(rowH, need + 24 + hairline)
            // 网页 .sz-rec__axrow：上内边距 s3，文字在上（下面留热区）
            b.placedTitleFrame = CGRect(x: 0, y: 12, width: width, height: max(0, need))
            b.frame = CGRect(x: x, y: cursor, width: width, height: h)
            b.setNeedsLayout()
            cursor += h
            if let sel = m.selected, sel.day == row.day {
                cursor = layoutDayList(sel, x: x, y: cursor, width: width)
            }
        }
        axListMarker.frame = CGRect(x: x, y: y, width: width, height: cursor - start)
        return cursor
    }

    /// 「那天写的字」：标题 + 格网（网页 .sz-rec__daylist），或纸上写的一天的一句说明。
    private func layoutDayList(_ sel: View.Selected, x: CGFloat, y: CGFloat, width: CGFloat) -> CGFloat {
        let mt = metrics
        let listTop = y
        var y = y
        if sel.paper {
            let h = mt.line("lh13")
            paperNoteLabel.frame = CGRect(x: x, y: y, width: width, height: h)
            y += h
        } else {
            let h = mt.line("lh22")
            dayListTitle.frame = CGRect(x: x, y: y, width: width, height: h)
            y += h + listGap
            let gridTop = y
            let frameW = mt.value("frame-w")
            let contentW = width - frameW
            let cellW = contentW / CGFloat(sheetCols)
            let gridRows = Int(ceil(Double(sel.cells.count) / Double(sheetCols)))
            let gridH = frameW + CGFloat(gridRows) * cellW
            dayListGrid.frame = CGRect(x: x, y: gridTop, width: width, height: gridH)
            dayListGrid.backgroundColor = color("sheet")
            dayListGrid.layer.borderWidth = 0
            for (i, cell) in dayListCells.enumerated() {
                let col = i % sheetCols
                let row = i / sheetCols
                cell.frame = CGRect(x: frameW + CGFloat(col) * cellW, y: frameW + CGFloat(row) * cellW, width: cellW, height: cellW)
            }
            y += gridH
        }
        dayListMarker.frame = CGRect(x: x, y: listTop, width: width, height: y - listTop)
        return y
    }

    /// 箭头按钮里的圆底（网页 .sz-rec__arrowbg：34 × 34 的圆，底色 field；禁用时透明 + 一圈 line）。
    private func styleArrowBg(_ b: UIButton) {
        let side = arrowBgSide
        let circle = b.viewWithTag(9911) ?? UIView()
        if circle.superview == nil {
            circle.tag = 9911
            circle.isUserInteractionEnabled = false
            b.insertSubview(circle, at: 0)
        }
        circle.frame = CGRect(x: (b.bounds.width - side) / 2, y: (b.bounds.height - side) / 2, width: side, height: side)
        circle.layer.cornerRadius = side / 2
        if b.isEnabled {
            circle.backgroundColor = color("field")
            circle.layer.borderWidth = 0
        } else {
            circle.backgroundColor = .clear
            circle.layer.borderWidth = 1
            circle.layer.borderColor = color("line").cgColor
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard axLayout else { return }
        // AX 档：网页的页头折成两行（components/ax.js）——第一行只有「‹」，第二行是页标题。
        // 本页的页标题是可见的 h1（盒高 = 一行字 + 下内边距 6，字从盒顶往上溢出一点）。
        let row1 = ShiziPageHeader.height
        let row1Bottom = view.safeAreaInsets.top + row1
        applyAxHeader(row1: row1, titleRow: titleLabel.frame.height + 6,
                      titleTextTop: row1Bottom - 1, titleTextX: metrics.gutter + metrics.space(2) + 8)
    }
}
