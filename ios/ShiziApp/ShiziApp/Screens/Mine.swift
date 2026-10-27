import UIKit

// B3.5c「我的」（tab 根）：网页 src/ui/screens/mine/index.js 的 1:1 原生版（视图模型 src/session/views/mine-page.js，App API view.mine / mine.appearance / mine.groupSize）。
// 屏名 ⇄ 类：mine ⇄ ShiziScreen_mine。tab 根页：没有页头与「‹」、没有左缘返回、不播转场；挂在原生 Tab 栏控制器（B3.5d）里它那一格下面、只铺到 Tab 栏上沿。
// 版式按网页 CSS 逐项排（index.js .sz-mine__* / Rows.js .sz-rrow / choice.js .sz-seg / Sheet.js .sz-sheet / work.js MonthPaper），数值取 ShiziTokens，文案取视图模型的引用。
// 外观 / 每组字数：标准字号行内分段（点一下即写，失败行下就地三段式，D07）；AX 档「名称 …… 当前值 ›」点开底部选择弹层（MineParts.swift）。
// 外观由 platform/appearance.js 的唯一订阅同步到 NativeStage / ShiziTheme，窗口统一跟随；零件在 MineParts.swift。

// MARK: - 视图模型

struct MineView: Decodable {
    struct Stat: Decodable { let id: String; let n: Int; let label: ShiziCopyRef; let unit: ShiziCopyRef }
    struct Empty: Decodable { let title: ShiziCopyRef; let body: ShiziCopyRef }
    struct Seal: Decodable { let size: Double; let below: Bool; let x: Double; let y: Double }
    struct Cell: Decodable {
        let ch: String; let mode: String; let tag: String; let day: String; let record: String; let label: ShiziCopyRef; let x: Double; let y: Double
    }
    struct Paper: Decodable {
        let cols: Int; let rows: Int; let c: Double; let W: Double; let H: Double; let lastW: Double; let full: Bool
        let outline: String; let inner: String; let pad: Double; let widthScale: Double; let sign: Bool
        let kuan: ShiziCopyRef?; let seal: Seal; let cells: [Cell]
    }
    struct Sheet: Decodable {
        let month: String; let monthNum: Int; let title: ShiziCopyRef; let aria: ShiziCopyRef; let total: Int; let shown: Int; let truncated: Bool
        let all: ShiziCopyRef?; let empty: ShiziCopyRef?; let note: ShiziCopyRef?; let paper: Paper?
    }
    struct Remind: Decodable { let label: ShiziCopyRef; let on: Bool; let time: String?; let off: ShiziCopyRef; let to: String }
    struct Library: Decodable { let label: ShiziCopyRef; let value: ShiziCopyRef; let to: String }
    struct Option: Decodable { let id: ChoiceID; let label: OptionLabel?; let aria: ShiziCopyRef?; let sheetLabel: ShiziCopyRef }
    struct Choice: Decodable { let title: ShiziCopyRef; let value: ChoiceID; let valueText: ShiziCopyRef; let options: [Option] }
    struct Choices: Decodable { let appearance: Choice; let groupSize: Choice }
    struct Fail: Decodable { let note: ShiziCopyRef; let cancel: ShiziCopyRef; let retry: ShiziCopyRef }
    struct Backup: Decodable { let label: ShiziCopyRef; let value: ShiziCopyRef; let to: String }
    struct Annual: Decodable { let label: ShiziCopyRef; let year: String; let to: String }
    struct About: Decodable { let label: ShiziCopyRef; let to: String }
    struct Target: Decodable { let to: String }
    struct Env: Decodable { let width: Double; let ax: Int }
    struct Lines: Decodable { let note: [Int]?; let failNote: [Int]?; let emptyBody: [Int]? }

    let title: ShiziCopyRef
    let empty: Bool
    let overview: [Stat]
    let emptyBlock: Empty?
    let sheet: Sheet?
    let remind: Remind
    let library: Library
    let appearanceOn: Bool
    let choices: Choices
    let choiceFail: Fail
    let done: ShiziCopyRef
    let backup: Backup
    let annual: Annual
    let about: About
    let records: Target
    let detail: Target
    let version: ShiziCopyRef
    let env: Env?
    let lines: Lines?
}

/// 分段里一项的字：外观是文案引用，每组字数是数字字符串。
struct OptionLabel: Decodable {
    let text: String

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { text = s; return }
        text = try c.decode(ShiziCopyRef.self).text
    }
}

/// 选项的值：外观是字符串（auto / light / dark），每组字数是整数。
enum ChoiceID: Decodable, Equatable {
    case text(String)
    case number(Int)

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let n = try? c.decode(Int.self) { self = .number(n); return }
        self = .text(try c.decode(String.self))
    }

    /// 桥上 op 的参数值。
    var json: Any {
        switch self {
        case .text(let s): return s
        case .number(let n): return n
        }
    }

    var text: String {
        switch self {
        case .text(let s): return s
        case .number(let n): return String(n)
        }
    }
}

// MARK: - 页面

@objc(ShiziScreen_mine)
final class MineScreen: ShiziScreenViewController {
    // 成员名与 accessibilityIdentifier 是 QA 取证的语义键（keys/mine.mjs）
    private let heading = UILabel()
    private let homeMarker = UIView()
    private let overviewMarker = UIView()
    private var statMarkers: [UIView] = []
    private var statNums: [UILabel] = []
    private var statUnits: [UILabel] = []
    private var statCaps: [UILabel] = []
    private var ovLines: [UIView] = []
    private let sheetMarker = UIView()
    private let sheetHead = ShiziRowButton(type: .custom)
    private let paperMarker = UIView()
    private let stageMarker = UIView()
    private var sheetRects: [UIView] = []
    private let linesMarker = UIView()
    private let frameMarker = UIView()
    private let guideLayer = CAShapeLayer()
    private let frameLayer = CAShapeLayer()
    private var cellButtons: [MineSheetCell] = []
    private let noteLabel = UILabel()
    private let kuanLabel = UILabel()
    private let sealView = NativeSealView()
    private let sheetEmptyLabel = UILabel()
    private let emptyMarker = UIView()
    private let emptyTitle = UILabel()
    private let emptyBody = UILabel()
    private var blockLines: [UIView] = []
    private var rowLines: [UIView] = []
    private let remindRow = ShiziRowButton(type: .custom)
    private let libraryRow = ShiziRowButton(type: .custom)
    private let appearanceRow = MineChoiceRow()
    private let groupRow = MineChoiceRow()
    private let backupRow = ShiziRowButton(type: .custom)
    private let annualRow = ShiziRowButton(type: .custom)
    private let aboutRow = ShiziRowButton(type: .custom)
    private let versionLabel = UILabel()
    private let versionMarker = UIView()
    private let failBox = MineFailBlock()
    private let failWrap = UIView()
    private var failTarget: (choice: String, value: ChoiceID)?

    private var model: MineView?
    private var strokes: [[[InkRawPoint]]] = []
    private var sealPath: [[Any]] = []
    private var refetched = false

    private var ax: Int {
        switch metrics.category {
        case .accessibilityMedium: return 1
        case .accessibilityLarge: return 2
        case .accessibilityExtraLarge: return 3
        case .accessibilityExtraExtraLarge: return 4
        case .accessibilityExtraExtraExtraLarge: return 5
        default: return 0
        }
    }

    // MARK: 生命周期

    override func viewDidLoad() {
        super.viewDidLoad()
        backButton.isHidden = true
        titleLabel.isHidden = true
        view.backgroundColor = .clear
        scroll.backgroundColor = color("paper")
        content.addSubview(screenMarker)
        screenMarker.accessibilityIdentifier = "native-screen-mine"
        heading.accessibilityIdentifier = "native-mine-title"
        heading.accessibilityTraits = [.header]
        heading.numberOfLines = 0
        let markers: [(UIView, String, Bool)] = [(homeMarker, "native-mine-home", false), (overviewMarker, "native-mine-overview", false), (sheetMarker, "native-mine-sheet", false),
                                                 (paperMarker, "native-mine-sheet-grid", true), (stageMarker, "native-month-stage", true), (linesMarker, "native-month-lines", false),
                                                 (frameMarker, "native-month-frame", false), (emptyMarker, "native-mine-empty", false)]
        for (v, id, interactive) in markers { v.accessibilityIdentifier = id; v.isUserInteractionEnabled = interactive; v.isAccessibilityElement = false }
        paperMarker.isAccessibilityElement = false
        paperMarker.accessibilityContainerType = .semanticGroup
        for v in [homeMarker, overviewMarker, emptyMarker, sheetMarker] { content.addSubview(v) }
        for v in [heading, sheetHead, paperMarker, noteLabel, sheetEmptyLabel, emptyTitle, emptyBody, remindRow, libraryRow, appearanceRow, groupRow, backupRow, annualRow, aboutRow, versionLabel, failWrap] as [UIView] {
            content.addSubview(v)
        }
        for i in 0..<2 {
            let r = UIView()
            r.accessibilityIdentifier = "native-month-sheet"
            r.isUserInteractionEnabled = false
            sheetRects.append(r)
            stageMarker.addSubview(r)
            _ = i
        }
        paperMarker.addSubview(stageMarker)
        stageMarker.addSubview(linesMarker)
        stageMarker.addSubview(frameMarker)
        paperMarker.addSubview(kuanLabel)
        linesMarker.layer.addSublayer(guideLayer)
        frameMarker.layer.addSublayer(frameLayer)
        guideLayer.fillColor = UIColor.clear.cgColor
        frameLayer.fillColor = UIColor.clear.cgColor
        for l in [noteLabel, emptyBody, sheetEmptyLabel, versionLabel, emptyTitle] { l.numberOfLines = 0 }
        noteLabel.accessibilityIdentifier = "native-month-note"
        emptyTitle.accessibilityIdentifier = "native-mine-empty-title"
        emptyBody.accessibilityIdentifier = "native-mine-empty-body"
        sheetEmptyLabel.accessibilityIdentifier = "native-mine-sheet-empty"
        versionLabel.accessibilityIdentifier = "native-version-text"
        versionMarker.accessibilityIdentifier = "native-mine-version"
        versionMarker.isUserInteractionEnabled = false
        content.addSubview(versionMarker)
        sheetHead.accessibilityIdentifier = "native-mine-sheet-head"
        remindRow.accessibilityIdentifier = "native-mine-remind"
        libraryRow.accessibilityIdentifier = "native-mine-library"
        backupRow.accessibilityIdentifier = "native-mine-menu-backup"
        annualRow.accessibilityIdentifier = "native-mine-menu-annual"
        aboutRow.accessibilityIdentifier = "native-mine-menu-about"
        appearanceRow.configure(id: "mine-appearance", pickable: true)
        groupRow.configure(id: "mine-group-size", pickable: true)
        appearanceRow.onPick = { [weak self] v in self?.choose("appearance", v) }
        groupRow.onPick = { [weak self] v in self?.choose("groupSize", v) }
        appearanceRow.onOpen = { [weak self] in self?.openSheet("appearance") }
        groupRow.onOpen = { [weak self] in self?.openSheet("groupSize") }
        failWrap.addSubview(failBox)
        failWrap.isHidden = true
        wire(sheetHead) { page in (page as? MineScreen)?.goRecords() }
        wire(remindRow) { page in if let s = page as? MineScreen { s.push(s.remindTo) } }
        wire(libraryRow) { page in if let s = page as? MineScreen { s.push(s.libraryTo) } }
        wire(backupRow) { page in if let s = page as? MineScreen { s.push(s.backupTo) } }
        wire(annualRow) { page in (page as? MineScreen)?.goAnnual() }
        wire(aboutRow) { page in if let s = page as? MineScreen { s.push(s.aboutTo) } }
        failBox.onCancel = { [weak self] in self?.dismissFail() }
        failBox.onRetry = { [weak self] in self?.retryFail() }
        if let v = lastView { try? render(view: v) }
    }

    private var remindTo: String { model?.remind.to ?? "remind" }
    private var libraryTo: String { model?.library.to ?? "library-switch" }
    private var backupTo: String { model?.backup.to ?? "backup" }
    private var aboutTo: String { model?.about.to ?? "about" }

    private func goRecords() {
        guard let m = model else { return }
        push(m.records.to, params: ["month": m.sheet?.month ?? ""])
    }

    private func goAnnual() {
        guard let m = model else { return }
        let y = Int(m.annual.year) ?? 0
        let cur = Calendar.current.component(.year, from: Date())
        push(m.annual.to, params: y == 0 || y == cur ? [:] : ["year": y])
    }

    private func openCell(_ i: Int) {
        guard let m = model, let paper = m.sheet?.paper, i < paper.cells.count else { return }
        push(m.detail.to, params: ["char": paper.cells[i].ch])
    }

    // MARK: 根页：没有返回、没有左缘手势、不进 nav.back

    override func requestBack() {}

    override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        if g is UIScreenEdgePanGestureRecognizer { return false }
        return super.gestureRecognizerShouldBegin(g)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        NativeA11y.screenChanged(heading)
    }

    // MARK: 数据

    /// 视图回包按页宽与 AX 档算字帖几何：重拉时带上真实值。
    override func reload() {
        guard let engine = stage?.engine else { return }
        let args = fetchArgs()
        Task { @MainActor [weak self] in
            let body = await engine.raw("view.mine", args)
            self?.apply(payload: body)
        }
    }

    private func fetchArgs() -> [String: Any] {
        ["width": Double(view.bounds.width > 0 ? view.bounds.width : UIScreen.main.bounds.width), "ax": ax]
    }

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: MineView.self)
        model = m
        let dict = raw as? [String: Any]
        let paper = (dict?["sheet"] as? [String: Any])?["paper"] as? [String: Any]
        strokes = (paper?["cells"] as? [[String: Any]] ?? []).map { NativeInkWire.rawStrokes($0["strokes"]) }
        sealPath = paper?["sealPath"] as? [[Any]] ?? []
        renderModel(m)
        // 首帧的页宽 / AX 档与真实的不同（视图是页面按它自己的值算的）：带真实值重拉一次
        if let env = m.env, view.bounds.width > 0, (abs(CGFloat(env.width) - view.bounds.width) > 0.5 || env.ax != ax), !refetched {
            refetched = true
            reload()
        }
    }

    // MARK: 渲染

    private func hair() -> CGFloat { shiziHairline(metrics.value("hair")) }

    private func styleRow(_ b: ShiziRowButton, label: String, value: String?, axOn: Bool) {
        let mt = metrics
        NativeType.set(b.label, label, font: mt.font(17, .medium), color: color("ink1"), line: mt.line("lh17s"))
        b.titleLabel?.font = mt.font(15)
        b.setTitleColor(color("ink1"), for: .normal)
        if let value {
            b.valueLabel.isHidden = false
            NativeType.set(b.valueLabel, value, font: shiziTabular(mt.font(axOn ? 15 : 17)), color: color("ink2"), align: axOn ? .left : .right, line: mt.line(axOn ? "lh15" : "lh17s"))
        } else {
            b.valueLabel.isHidden = true
            b.valueLabel.text = nil
        }
        b.chevronSize = CGSize(width: 8, height: 13)
        b.setImage(ShiziChevron.image(color("ink4"), size: b.chevronSize), for: .normal)
        b.accessibilityLabel = label
        b.accessibilityValue = value
        b.accessibilityTraits = [.button]
        b.isAccessibilityElement = true
    }

    private func renderModel(_ m: MineView) {
        let mt = metrics
        let axOn = ax > 0
        heading.attributedText = NSAttributedString(string: m.title.text, attributes: [.font: NativeType.song(size: mt.value("fs28"), weight: .medium), .foregroundColor: color("ink1")])
        NativeResultViewController.fixLineBox(heading, line: mt.line("lh28"))
        heading.accessibilityLabel = m.title.text
        // 概览三个数
        if statMarkers.count != m.overview.count {
            (statMarkers + statNums + statUnits + statCaps + ovLines as [UIView]).forEach { $0.removeFromSuperview() }
            statMarkers = []; statNums = []; statUnits = []; statCaps = []; ovLines = []
            for s in m.overview {
                let mk = UIView(), n = UILabel(), u = UILabel(), c = UILabel()
                mk.accessibilityIdentifier = "native-mine-stat-\(s.id)"
                mk.isUserInteractionEnabled = false
                n.accessibilityIdentifier = "native-mine-stat-num"
                c.accessibilityIdentifier = "native-mine-stat-label"
                for v in [mk, n, u, c] as [UIView] { content.addSubview(v) }
                statMarkers.append(mk); statNums.append(n); statUnits.append(u); statCaps.append(c)
            }
            for _ in 0..<5 { let l = UIView(); content.addSubview(l); ovLines.append(l) }
        }
        for (i, s) in m.overview.enumerated() {
            if axOn {
                NativeType.set(statNums[i], String(s.n), font: shiziTabular(mt.font(17)), color: color("ink2"), line: mt.line("lh17s"))
                NativeType.set(statUnits[i], s.unit.text, font: mt.font(17), color: color("ink2"), line: mt.line("lh17s"))
                NativeType.set(statCaps[i], s.label.text, font: mt.font(17, .medium), color: color("ink1"), line: mt.line("lh17s"))
            } else {
                NativeType.set(statNums[i], String(s.n), font: shiziTabular(mt.font(34, .medium)), color: color("ink1"), line: mt.line("lh34"))
                NativeType.set(statUnits[i], s.unit.text, font: mt.font(15), color: color("ink3"), line: mt.line("lh15"))
                NativeType.set(statCaps[i], s.label.text, font: mt.font(13), color: color("ink3"), line: mt.line("lh13"))
            }
        }
        for l in ovLines { l.backgroundColor = color("line") }
        // 字帖块
        let sheetOn = m.sheet != nil
        sheetHead.isHidden = !sheetOn
        paperMarker.isHidden = true
        noteLabel.isHidden = true
        sheetEmptyLabel.isHidden = true
        if let sheet = m.sheet {
            NativeType.set(sheetHead.label, "", font: mt.font(15), color: color("ink1"))
            sheetHead.label.attributedText = NSAttributedString(string: sheet.title.text, attributes: [.font: NativeType.song(size: mt.value("fs22"), weight: .medium), .foregroundColor: color("ink1")])
            NativeResultViewController.fixLineBox(sheetHead.label, line: mt.line("lh22"))
            sheetHead.titleLabel?.font = mt.font(15)
            sheetHead.setTitleColor(color("ink1"), for: .normal)
            if let all = sheet.all {
                sheetHead.valueLabel.isHidden = false
                NativeType.set(sheetHead.valueLabel, all.text, font: mt.font(15), color: color("ink2"), align: axOn ? .left : .right, line: mt.line("lh15"))
            } else {
                sheetHead.valueLabel.isHidden = true
                sheetHead.valueLabel.text = nil
            }
            sheetHead.chevronSize = CGSize(width: 8, height: 13)
            sheetHead.setImage(ShiziChevron.image(color("ink4"), size: sheetHead.chevronSize), for: .normal)
            sheetHead.accessibilityLabel = [sheet.title.text, sheet.all?.text].compactMap { $0 }.joined(separator: " ")
            sheetHead.accessibilityTraits = [.button]
            if let paper = sheet.paper { renderPaper(paper, sheet: sheet) } else if let empty = sheet.empty {
                sheetEmptyLabel.isHidden = false
                NativeType.set(sheetEmptyLabel, empty.text, font: mt.font(15), color: color("ink2"), line: mt.line("lh15"))
            }
            if let note = sheet.note {
                noteLabel.isHidden = false
                NativeType.set(noteLabel, shiziBreak(note.text, m.lines?.note), font: mt.font(13), color: color("ink3"), line: mt.line("lh13"))
            }
        }
        // 没有记录的空态
        emptyMarker.isHidden = m.emptyBlock == nil
        emptyTitle.isHidden = m.emptyBlock == nil
        emptyBody.isHidden = m.emptyBlock == nil
        if let e = m.emptyBlock {
            emptyTitle.attributedText = NSAttributedString(string: e.title.text, attributes: [.font: NativeType.song(size: mt.value("fs22"), weight: .medium), .foregroundColor: color("ink1")])
            NativeResultViewController.fixLineBox(emptyTitle, line: mt.line("lh22"))
            emptyBody.text = shiziBreak(e.body.text, m.lines?.emptyBody)
        }
        // 行
        let remindValue = m.remind.time ?? m.remind.off.text
        styleRow(remindRow, label: m.remind.label.text, value: remindValue, axOn: axOn)
        styleRow(libraryRow, label: m.library.label.text, value: m.library.value.text, axOn: axOn)
        styleRow(backupRow, label: m.backup.label.text, value: m.backup.value.text, axOn: axOn)
        styleRow(annualRow, label: m.annual.label.text, value: m.annual.year, axOn: axOn)
        styleRow(aboutRow, label: m.about.label.text, value: nil, axOn: axOn)
        appearanceRow.isHidden = !m.appearanceOn
        appearanceRow.update(choice: m.choices.appearance, ax: axOn, numeric: false, metrics: mt, color: color)
        groupRow.update(choice: m.choices.groupSize, ax: axOn, numeric: true, metrics: mt, color: color)
        while rowLines.count < 5 { let l = UIView(); content.addSubview(l); rowLines.append(l) }
        while blockLines.count < 2 { let l = UIView(); content.addSubview(l); blockLines.append(l) }
        for l in rowLines + blockLines { l.backgroundColor = color("line") }
        NativeType.set(versionLabel, m.version.text, font: mt.font(13), color: color("ink3"), align: .center, line: mt.line("lh13"))
        failWrap.isHidden = failTarget == nil
        if failTarget != nil { failBox.configure(fail: m.choiceFail, idPrefix: "native-mine-fail", metrics: mt, color: color, noteBreaks: m.lines?.failNote) }
        view.setNeedsLayout()
    }

    private func renderPaper(_ p: MineView.Paper, sheet: MineView.Sheet) {
        let mt = metrics
        paperMarker.isHidden = false
        paperMarker.accessibilityLabel = sheet.aria.text
        let dark = traitCollection.userInterfaceStyle == .dark
        let hand = NativeInkWire.parseColor(ShiziTokens.colorStrings(dark ? .dark : .light)["hand"]).map { SIMD4<Float>($0.x, $0.y, $0.z, 1) }
        for r in sheetRects { r.backgroundColor = color("sheet") }
        guideLayer.strokeColor = color("guide").resolvedColor(with: traitCollection).cgColor
        guideLayer.lineWidth = mt.value("guide-w")
        frameLayer.strokeColor = color("frame").resolvedColor(with: traitCollection).cgColor
        frameLayer.lineWidth = mt.value("frame-w")
        guideLayer.path = Self.path(p.inner)
        frameLayer.path = Self.path(p.outline)
        cellButtons.forEach { $0.removeFromSuperview() }
        cellButtons = []
        let look = (hand: hand, under: color("under"), ink1: color("ink1"), ink3: color("ink3"), paper: color("paper"), field: color("field"))
        for (i, c) in p.cells.enumerated() {
            let b = MineSheetCell(type: .custom)
            b.accessibilityIdentifier = "native-mine-sheet-cell"
            b.configure(cell: c, strokes: i < strokes.count ? strokes[i] : [], side: CGFloat(p.c), pad: CGFloat(p.pad), widthScale: p.widthScale, look: look)
            b.addAction(UIAction { [weak self] _ in self?.openCell(i) }, for: .touchUpInside)
            stageMarker.addSubview(b)
            cellButtons.append(b)
        }
        if p.sign, let kuan = p.kuan {
            kuanLabel.isHidden = false
            kuanLabel.font = NativeType.song(size: 13, weight: .regular)
            kuanLabel.textColor = color("ink2")
            kuanLabel.text = kuan.text
            kuanLabel.accessibilityIdentifier = "native-month-kuan"
            sealView.configure(path: sealPath, fill: color("seal"), glyph: color("on-seal"))
            sealView.isHidden = false
            sealView.accessibilityIdentifier = "native-month-seal"
            if sealView.superview == nil { paperMarker.addSubview(sealView) }
        } else {
            kuanLabel.isHidden = true
            sealView.isHidden = true
        }
    }

    /// 网页 svg path（只有 M / H / V / Z）→ CGPath。
    private static func path(_ d: String) -> CGPath {
        let p = UIBezierPath()
        var cur = CGPoint.zero
        var start = CGPoint.zero
        let scanner = Scanner(string: d)
        scanner.charactersToBeSkipped = nil
        let letters = CharacterSet(charactersIn: "MHVZ")
        while !scanner.isAtEnd {
            guard let cmd = scanner.scanCharacters(from: letters)?.first else { break }
            switch cmd {
            case "M":
                let x = scanner.scanDouble() ?? 0
                _ = scanner.scanCharacters(from: CharacterSet(charactersIn: " ,"))
                let y = scanner.scanDouble() ?? 0
                cur = CGPoint(x: x, y: y); start = cur
                p.move(to: cur)
            case "H":
                cur.x = CGFloat(scanner.scanDouble() ?? 0)
                p.addLine(to: cur)
            case "V":
                cur.y = CGFloat(scanner.scanDouble() ?? 0)
                p.addLine(to: cur)
            default:
                p.close()
                cur = start
            }
        }
        return p.cgPath
    }

    // MARK: 版式

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // 根页视图本身只铺到 Tab 栏上沿（NativeStage.rootFrame，B3.5a）：正文铺满整个视图，不再自己扣 Tab 栏
        // （R14：B3.5c 原先的根页铺满窗口、自己扣掉 49 + 下安全区并让那一条触摸穿透；并到 B3.5a 底座后成了扣两次——正文底下 49pt 一条点不到、滚不到）
        scroll.frame = view.bounds
        view.backgroundColor = .clear
        scroll.backgroundColor = color("paper")
    }

    private func rowHeight(_ b: ShiziRowButton, width: CGFloat, y: CGFloat, x: CGFloat) -> CGFloat {
        let mt = metrics
        let hr = hair()
        let axOn = ax > 0
        b.label.numberOfLines = 0
        b.valueLabel.numberOfLines = 0
        if axOn {
            let lw = width - 30
            let nh = NativeType.height(b.label, width: lw, line: mt.line("lh17s"))
            let vh = b.valueLabel.isHidden ? 0 : NativeType.height(b.valueLabel, width: lw, line: mt.line("lh15"))
            let rowH = max(56, 2 * mt.space(2) + nh + vh + hr)
            b.frame = CGRect(x: x, y: y, width: width, height: rowH)
            let top = (rowH - hr - nh - vh) / 2
            b.label.frame = CGRect(x: 0, y: top, width: lw, height: nh)
            b.valueLabel.frame = CGRect(x: 0, y: top + nh, width: lw, height: vh)
            return rowH
        }
        let lh = mt.line("lh17s")
        let rowH: CGFloat = 56
        let inner = rowH - hr
        let gap = mt.space(2)
        let avail = width - 8 - gap
        var vw: CGFloat = 0
        if !b.valueLabel.isHidden { vw = min(avail, ceil(NativeType.width(b.valueLabel))) }
        let nw = min(avail - (vw > 0 ? gap : 0), ceil(NativeType.width(b.label)))
        b.frame = CGRect(x: x, y: y, width: width, height: rowH)
        b.label.frame = CGRect(x: 0, y: (inner - lh) / 2, width: max(0, nw), height: lh)
        b.valueLabel.frame = CGRect(x: width - 8 - gap - vw, y: (inner - lh) / 2, width: vw, height: lh)
        return rowH
    }

    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat {
        guard let m = model else { return 0 }
        let mt = metrics
        let hr = hair()
        let axOn = ax > 0
        let w = view.bounds.width
        let blockGap: CGFloat = axOn ? 10 : 26
        var y = view.safeAreaInsets.top + mt.space(4)
        // 大标题（.sz-tabpage__title：宋 28 / lh28）
        let hh = max(mt.line("lh28"), NativeType.height(heading, width: width, line: mt.line("lh28")))
        heading.frame = CGRect(x: x, y: y, width: width, height: hh)
        y += hh + mt.space(2)
        let homeTop = y
        // 概览（.sz-mine__ov：上下发丝线，三栏；AX 一栏三行、标签在上）
        y += axOn ? mt.space(2) : mt.space(3)
        let ovTop = y
        ovLines.forEach { $0.frame = .zero }
        let n = statMarkers.count
        if axOn {
            var sy = ovTop + hr
            ovLines[0].frame = CGRect(x: x, y: ovTop, width: width, height: hr)
            let lh = mt.line("lh17s")
            for i in 0..<n {
                let top = sy + (i > 0 ? hr : 0)
                if i > 0 { ovLines[i].frame = CGRect(x: x, y: sy, width: width, height: hr) }
                let sh = 2 * mt.space(2) + 2 * lh
                statCaps[i].frame = CGRect(x: x, y: top + mt.space(2), width: width, height: lh)
                let nw = ceil(NativeType.width(statNums[i]))
                statNums[i].frame = CGRect(x: x, y: top + mt.space(2) + lh, width: nw, height: lh)
                let uw = ceil(NativeType.width(statUnits[i]))
                statUnits[i].frame = CGRect(x: x + nw + mt.space(1), y: top + mt.space(2) + lh, width: uw, height: lh)
                statMarkers[i].frame = CGRect(x: x, y: top, width: width, height: sh)
                sy = top + sh
            }
            ovLines[n].frame = CGRect(x: x, y: sy, width: width, height: hr)
            y = sy + hr
            overviewMarker.frame = CGRect(x: x, y: ovTop, width: width, height: y - ovTop)
        } else {
            let colW = width / CGFloat(max(1, n))
            let lh34 = mt.line("lh34"), lh15 = mt.line("lh15"), lh13 = mt.line("lh13")
            let statH = mt.space(4) + lh34 + 2 + lh13 + mt.space(3)
            let y0 = ovTop + hr
            ovLines[0].frame = CGRect(x: x, y: ovTop, width: width, height: hr)
            ovLines[1].frame = CGRect(x: x, y: y0 + statH, width: width, height: hr)
            let numFont = UIFont.systemFont(ofSize: mt.value("fs34"), weight: .medium)
            let unitFont = UIFont.systemFont(ofSize: mt.value("fs15"))
            func base(_ f: UIFont, _ box: CGFloat) -> CGFloat { (box - (f.ascender.rounded() - f.descender.rounded())) / 2 + f.ascender.rounded() }
            for i in 0..<n {
                let colX = x + CGFloat(i) * colW
                let ix = colX + (i > 0 ? hr + mt.space(3) : 0)
                if i > 0 { ovLines[1 + i].frame = CGRect(x: colX, y: y0, width: hr, height: statH) }
                statMarkers[i].frame = CGRect(x: colX, y: y0, width: colW, height: statH)
                let nw = ceil(NativeType.width(statNums[i]))
                let ny = y0 + mt.space(4)
                statNums[i].frame = CGRect(x: ix, y: ny, width: nw, height: lh34)
                let uw = ceil(NativeType.width(statUnits[i]))
                statUnits[i].frame = CGRect(x: ix + nw + mt.space(1), y: ny + base(numFont, lh34) - base(unitFont, lh15), width: uw, height: lh15)
                statCaps[i].frame = CGRect(x: ix, y: ny + lh34 + 2, width: max(0, colX + colW - ix), height: lh13)
            }
            y = ovTop + 2 * hr + statH
            overviewMarker.frame = CGRect(x: x, y: ovTop, width: width, height: y - ovTop)
        }
        // 字帖块（.sz-mine__sheetblock：标题行 / 字帖 / 说明，间距 s1）或空态
        if let sheet = m.sheet {
            y += blockGap
            let sheetTop = y
            let lh22 = mt.line("lh22"), lh15 = mt.line("lh15")
            sheetHead.label.numberOfLines = 0
            sheetHead.valueLabel.numberOfLines = 0
            var headH: CGFloat
            if axOn {
                let th = NativeType.height(sheetHead.label, width: width, line: lh22)
                let vh = sheetHead.valueLabel.isHidden ? 0 : NativeType.height(sheetHead.valueLabel, width: width, line: lh15)
                headH = 2 * mt.space(2) + th + (vh > 0 ? mt.space(3) + vh : 0)
                sheetHead.frame = CGRect(x: x, y: y, width: width, height: headH)
                sheetHead.label.frame = CGRect(x: 0, y: mt.space(2), width: min(width, ceil(NativeType.width(sheetHead.label))), height: th)
                sheetHead.valueLabel.frame = CGRect(x: 0, y: mt.space(2) + th + mt.space(3), width: min(width, ceil(NativeType.width(sheetHead.valueLabel))), height: vh)
            } else {
                headH = max(44, lh22)
                sheetHead.frame = CGRect(x: x, y: y, width: width, height: headH)
                let vw = sheetHead.valueLabel.isHidden ? 0 : min(width * 0.5, ceil(NativeType.width(sheetHead.valueLabel)))
                let avail = width - (vw > 0 ? vw + mt.space(2) : 0) - 8 - mt.space(2)
                sheetHead.label.frame = CGRect(x: 0, y: (headH - lh22) / 2, width: min(avail, ceil(NativeType.width(sheetHead.label))), height: lh22)
                sheetHead.valueLabel.frame = CGRect(x: width - 8 - mt.space(2) - vw, y: (headH - lh15) / 2, width: vw, height: lh15)
            }
            y += headH + mt.space(1)
            if let p = sheet.paper {
                let W = CGFloat(p.W), H = CGFloat(p.H), c = CGFloat(p.c)
                let signH: CGFloat = p.sign ? (p.full ? max(20, CGFloat(p.seal.size)) : 20) : 0
                let blockH = 8 + H + (p.sign ? 10 + signH : 0)
                paperMarker.frame = CGRect(x: x + (width - W) / 2, y: y, width: W, height: blockH)
                stageMarker.frame = CGRect(x: 0, y: 8, width: W, height: H)
                for r in [linesMarker, frameMarker] { r.frame = stageMarker.bounds }
                guideLayer.frame = linesMarker.bounds
                frameLayer.frame = frameMarker.bounds
                if p.full {
                    sheetRects[0].frame = CGRect(x: 0, y: 0, width: W, height: H); sheetRects[0].isHidden = false
                    sheetRects[1].isHidden = true
                } else {
                    sheetRects[0].frame = CGRect(x: 0, y: 0, width: W, height: H - c); sheetRects[0].isHidden = false
                    sheetRects[1].frame = CGRect(x: 0, y: H - c, width: CGFloat(p.lastW), height: c); sheetRects[1].isHidden = false
                }
                for (i, b) in cellButtons.enumerated() where i < p.cells.count {
                    b.frame = CGRect(x: CGFloat(p.cells[i].x), y: CGFloat(p.cells[i].y), width: c, height: c)
                }
                if p.sign {
                    let seal = CGFloat(p.seal.size)
                    kuanLabel.sizeToFit()
                    let kw = ceil(kuanLabel.bounds.width)
                    let signY = 8 + H + 10
                    if p.full {
                        sealView.frame = CGRect(x: W - seal, y: signY + (signH - seal) / 2, width: seal, height: seal)
                        kuanLabel.frame = CGRect(x: W - seal - mt.space(2) - kw, y: signY + (signH - 20) / 2, width: kw, height: 20)
                    } else {
                        sealView.frame = CGRect(x: CGFloat(p.seal.x), y: 8 + CGFloat(p.seal.y), width: seal, height: seal)
                        kuanLabel.frame = CGRect(x: W - kw, y: signY, width: kw, height: 20)
                    }
                }
                y += blockH
            } else if !sheetEmptyLabel.isHidden {
                let eh = NativeType.height(sheetEmptyLabel, width: width, line: lh15)
                sheetEmptyLabel.frame = CGRect(x: x, y: y, width: width, height: eh)
                y += eh
            }
            if !noteLabel.isHidden {
                y += mt.space(1)
                let nh = ShiziParagraph.place(noteLabel, noteLabel.text ?? "", font: mt.font(13), color: color("ink3"), line: mt.line("lh13"), x: x, y: y, width: width)
                y += nh
            }
            sheetMarker.frame = CGRect(x: x, y: sheetTop, width: width, height: y - sheetTop)
            sheetMarker.isHidden = false
        } else {
            sheetMarker.isHidden = true
            if let e = m.emptyBlock {
                y += blockGap
                let etop = y
                let th = mt.line("lh22")
                emptyTitle.frame = CGRect(x: x, y: y, width: width, height: th)
                y += th + mt.space(2)
                let bh = ShiziParagraph.place(emptyBody, e.body.text, font: mt.font(15), color: color("ink2"), line: mt.line("lh15"), x: x, y: y, width: width)
                y += bh
                emptyMarker.frame = CGRect(x: x, y: etop, width: width, height: y - etop)
            }
        }
        // 设置行一块（顶一条发丝线；块内每行底下一条）
        func block(_ rows: [UIView], line: UIView, firstLine: Int) {
            y += blockGap
            line.frame = CGRect(x: x, y: y, width: width, height: hr)
            y += hr
            var li = firstLine
            for r in rows {
                if let b = r as? ShiziRowButton {
                    let h = rowHeight(b, width: width, y: y, x: x)
                    rowLines[li].frame = CGRect(x: x, y: y + h - hr, width: width, height: hr)
                    li += 1
                    y += h
                } else if let c = r as? MineChoiceRow, !c.isHidden {
                    let h = c.layoutRow(width: width, metrics: mt, layout: true)
                    c.frame = CGRect(x: x, y: y, width: width, height: h)
                    _ = c.layoutRow(width: width, metrics: mt, layout: true)
                    y += h
                    if let t = failTarget, (t.choice == "appearance") == (c === appearanceRow), !axOn {
                        let fh = failBox.layoutBlock(width: width, metrics: mt, layout: true)
                        failWrap.frame = CGRect(x: x, y: y, width: width, height: mt.space(3) + fh)
                        failBox.frame = CGRect(x: 0, y: mt.space(3), width: width, height: fh)
                        y += mt.space(3) + fh
                    }
                }
            }
        }
        failWrap.isHidden = failTarget == nil || axOn
        block([remindRow, libraryRow, appearanceRow, groupRow], line: blockLines[0], firstLine: 0)
        block([backupRow, annualRow, aboutRow], line: blockLines[1], firstLine: 2)
        // 页底版本行（.sz-mine__ver：上外边距 26，13 / lh13 墨三居中）
        y += blockGap
        let vh = NativeType.height(versionLabel, width: width, line: mt.line("lh13"))
        versionLabel.frame = CGRect(x: x, y: y, width: width, height: vh)
        versionMarker.frame = versionLabel.frame
        y += vh
        homeMarker.frame = CGRect(x: x, y: homeTop, width: width, height: y - homeTop)
        screenMarker.frame = CGRect(x: 0, y: 0, width: w, height: y + mt.space(8))
        return y
    }

    // MARK: 选择（外观 / 每组字数）

    private func commitCall(_ which: String, _ value: ChoiceID, done: @escaping (Bool) -> Void) {
        guard let engine = stage?.engine else { done(false); return }
        let op = which == "appearance" ? "mine.appearance" : "mine.groupSize"
        Task { @MainActor [weak self] in
            let reply = await engine.raw(op, ["value": value.json])
            let ok = (reply["ok"] as? Bool) == true
            if ok {
                if let self {
                    // 拉回成功提交后的选择值；窗口样式由引擎的单一外观订阅同步，
                    // render 不写窗口，traitCollectionDidChange 不能用旧快照反切主题。
                    let body = await engine.raw("view.mine", self.fetchArgs())
                    self.apply(payload: body)
                }
            }
            done(ok)
        }
    }

    private func choose(_ which: String, _ value: ChoiceID) {
        guard let m = model else { return }
        let cur = which == "appearance" ? m.choices.appearance.value : m.choices.groupSize.value
        if value == cur { return }
        commitCall(which, value) { [weak self] ok in
            guard let self else { return }
            self.failTarget = ok ? nil : (which, value)
            self.failWrap.isHidden = ok
            if let m = self.model { self.renderModel(m) }
            if !ok { NativeA11y.announce(m.choiceFail.note.text) }
        }
    }

    private func dismissFail() {
        failTarget = nil
        failWrap.isHidden = true
        view.setNeedsLayout()
    }

    private func retryFail() {
        if let t = failTarget { choose(t.choice, t.value) }
    }

    private func openSheet(_ which: String) {
        guard let m = model, presentedViewController == nil else { return }
        let choice = which == "appearance" ? m.choices.appearance : m.choices.groupSize
        let vc = MineChoiceSheetViewController(config: .init(
            rowId: which == "appearance" ? "mine-appearance" : "mine-group-size", choice: choice, fail: m.choiceFail, done: m.done, metrics: metrics, failBreaks: m.lines?.failNote,
            commit: { [weak self] id, done in self?.commitCall(which, id, done: done) ?? done(false) }))
        present(vc, animated: true)
    }
}
