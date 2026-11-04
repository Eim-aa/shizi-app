import ShiziCore
import UIKit

// B3.5a 原生首页（照网页版 1:1 移植；视图模型 homeView，App API view.home / home.*）。
// 屏名 ⇄ 类：home ⇄ ShiziScreen_home。tab 根页：NativeStage 把它挂在原生 Tab 栏控制器（B3.5d，UITabBarController）里它那一格下面、
// 只铺到 Tab 栏上沿。
//
// 版式按网页 CSS 逐项排（.sz-home__* / .sz-first__*），数值取 ShiziTokens（fs* / lh* / btn-h / hit / s* / gutter），文案取视图模型给的引用：
//   日常五态：左上日期时段；「拾」（128）+ 竖排题记（右起两句 + 作者）一组，在页头与按钮区之间居中、组底留 8%（屏宽）；离开一周 / 特别组那天组下多一句；
//   按钮区（底边在 Tab 栏上沿上方 24）：失败三段式 / 首练说明 / 「今天的字 · 接着写」行 / 「自己选字」（+「写平常字」）/ 主按钮。
//   首次打开：框中「拾」+ 竖排题跋三列 + 一枚印，品牌时刻 ≤ 1.2s（逐字淡入 → 印落下；点任意处静帧；减少动态效果 / 测试宿主静帧）。
//   AX1–AX5：题记 / 题跋改横排，「拾」按剩余高度缩（≤128、≥64，放不下先收起题记，≥44），主按钮满宽，文字按钮上下排。
// 写入（开组 / 续写 / 顺延 / 换库 / 自己选字 / 撤销跳过）一律经 home.* op 调网页首页同一批函数；主按钮的真实矩形随 home.start 交给页面当写字页 T-paper 的来源（D62），
// 排版 / 字变了时经 home.source 报此刻的位置（写字页返回时纸缩回这里）。失败（D07）就地三段式：说明 +「先不保存」，主按钮换成「再试一次」。

/// 竖排一列字（网页 writing-mode: vertical-rl + letter-spacing）：每个字竖向占 字号 × (1 + 字距)，在列宽里居中；句读用竖排位置（右上）。
/// 比对取证按 UILabel 取文字与框（网页这些 span 只有框），所以是 UILabel 子类：量出来的字框 = 整列的框，不当作被截断的横排单行。
final class ShiziVerticalLabel: UILabel, ShiziDrawnText {
    var spacing: CGFloat = 0.2
    var glyphFont: UIFont = .systemFont(ofSize: 15)
    var glyphColor: UIColor = .label

    private static let punct: Set<Character> = ["\u{FF0C}", "\u{3002}", "\u{3001}", "\u{FF1B}", "\u{FF1A}", "\u{FF01}", "\u{FF1F}"]

    override func textRect(forBounds bounds: CGRect, limitedToNumberOfLines n: Int) -> CGRect { CGRect(origin: .zero, size: bounds.size) }

    /// 字占的那一列（宽 = 1.5 em，同网页竖排的行盒，高 = 字数 × 字号 × (1 + 字距)，横向居中、贴顶）：同网页竖排文字的文字框（Range.getClientRects 的并集）。
    var drawnTextRect: CGRect {
        guard let text, !text.isEmpty else { return bounds }
        let w = glyphFont.pointSize * 1.5 // 网页竖排一列的文字框宽 ≈ 1.5 em（行盒；可宽过标签框，同网页）
        return CGRect(x: (bounds.width - w) / 2, y: 0, width: w, height: min(bounds.height, Self.height(text, font: glyphFont, spacing: spacing)))
    }
    override func sizeThatFits(_ size: CGSize) -> CGSize { bounds.size }

    /// 一列的高（字数 × 字号 × (1 + 字距)）。
    static func height(_ text: String, font: UIFont, spacing: CGFloat) -> CGFloat { CGFloat(text.count) * font.pointSize * (1 + spacing) }

    override func drawText(in rect: CGRect) {
        guard let text, !text.isEmpty else { return }
        let fs = glyphFont.pointSize
        let step = fs * (1 + spacing)
        let attrs: [NSAttributedString.Key: Any] = [.font: glyphFont, .foregroundColor: glyphColor, .kern: 0]
        // 中文字面（1em 方块）的上沿 = 基线 − 0.88em（宋 / 苹方的表意字面）：方块顶对齐每一格的顶
        for (i, ch) in text.enumerated() {
            let s = String(ch) as NSString
            let w = s.size(withAttributes: attrs).width
            var x = (bounds.width - w) / 2
            var y = CGFloat(i) * step + 0.88 * fs - glyphFont.ascender
            if Self.punct.contains(ch) {
                // 横排句读在字面左下；竖排在右上
                x += fs * 0.5
                y -= fs * 0.6
            }
            s.draw(at: CGPoint(x: x, y: y), withAttributes: attrs)
        }
    }
}

/// 品牌「拾」矢量（网页 ShiMark：视框单位方块里的路径，填 --hand）。
final class ShiziShiMarkView: UIView {
    private let shape = CAShapeLayer()
    private var unit = UIBezierPath()

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        isAccessibilityElement = false
        layer.addSublayer(shape)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(path: [[Any]], color: UIColor) {
        let p = UIBezierPath()
        for seg in path {
            guard let cmd = seg.first as? String else { continue }
            let n = seg.dropFirst().compactMap { ($0 as? NSNumber).map { CGFloat($0.doubleValue) } }
            switch cmd {
            case "M" where n.count >= 2: p.move(to: CGPoint(x: n[0], y: n[1]))
            case "C" where n.count >= 6: p.addCurve(to: CGPoint(x: n[4], y: n[5]), controlPoint1: CGPoint(x: n[0], y: n[1]), controlPoint2: CGPoint(x: n[2], y: n[3]))
            case "Z": p.close()
            default: break
            }
        }
        unit = p
        shape.fillColor = color.cgColor
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let p = unit.copy() as! UIBezierPath // swiftlint:disable:this force_cast
        p.apply(CGAffineTransform(scaleX: bounds.width, y: bounds.height))
        shape.frame = bounds
        shape.path = p.cgPath
    }
}

@objc(ShiziScreen_home)
final class HomeScreen: ShiziScreenViewController, ShiziRootProbing {
    struct View: Decodable {
        struct Epigraph: Decodable { let index: Int; let lines: [String]; let author: String; let label: String }
        struct Cta: Decodable { let label: ShiziCopyRef; let progress: ShiziCopyRef?; let aria: ShiziCopyRef; let action: String }
        struct Note: Decodable { let kind: String; let text: ShiziCopyRef }
        struct Other: Decodable { let slot: String; let kind: String; let remaining: Int; let text: ShiziCopyRef; let aria: ShiziCopyRef }
        struct Fail: Decodable { let text: ShiziCopyRef; let cancel: ShiziCopyRef; let retry: ShiziCopyRef }
        struct Undo: Decodable { let undo: ShiziCopyRef; let failed: ShiziCopyRef; let cancel: ShiziCopyRef; let retry: ShiziCopyRef }
        struct Leave: Decodable { let slot: String; let char: String; let failed: Bool; let remainingMs: Double; let text: ShiziCopyRef }
        let view: String
        let today: String
        let period: String
        let title: ShiziCopyRef
        let date: ShiziCopyRef
        let shiLabel: ShiziCopyRef
        let epigraph: Epigraph
        let motto: [ShiziCopyRef]
        let cta: Cta
        let note: Note?
        let firstTip: ShiziCopyRef?
        let other: Other?
        let pick: ShiziCopyRef?
        let deferSpecial: ShiziCopyRef?
        let fail: Fail
        let undo: Undo
        let brand: Bool
        let leaveUndo: Leave?

        enum CodingKeys: String, CodingKey {
            case view, today, period, title, date, shiLabel, epigraph, motto, cta, note, firstTip, other, pick, fail, undo, brand, leaveUndo
            case deferSpecial = "defer"
        }
    }

    // MARK: 网页 CSS 里的定值（不随字号的版式常量）

    /// 日常态「拾」边长（SHI_SIZE）、AX 档下限（SHI_MIN / SHI_FLOOR）、「拾」与题记的间距、组底留白（屏宽 8%）、题记列宽与列距、主按钮宽。
    private let shiSize: CGFloat = 128, shiMin: CGFloat = 64, shiFloor: CGFloat = 44
    private let groupGap: CGFloat = 18, groupBottomShare: CGFloat = 0.08, noteShare: CGFloat = 0.04
    private let epiCol: CGFloat = 26, epiColGap: CGFloat = 4
    private let ctaWidth: CGFloat = 240
    /// ShiMark 视框放大 124%、外移 12%（设计稿 128pt 是 1024 母版视框；ShiMark 视框 1270）。
    private let markScale: CGFloat = 1.24
    /// 首次打开：格宽按屏宽一半夹在 [172, 216]（紧凑版 172）、格与题跋间距 20、题跋列宽 34（紧凑 30）、末列字与印间距 10、印 16、AX 档「拾」120、横排题跋与「拾」间距 16、印左外边 8。
    private let firstMin: CGFloat = 172, firstMax: CGFloat = 216, firstGap: CGFloat = 20, firstCol: CGFloat = 34, firstColCompact: CGFloat = 30
    private let sealGap: CGFloat = 10, sealSide: CGFloat = 16, firstAxShi: CGFloat = 120, firstAxGap: CGFloat = 16, sealInline: CGFloat = 8
    /// 首次打开页头留白（.sz-home__head min-height 28）、页面上内边距（12 + 安全区）。
    private let firstHead: CGFloat = 28
    /// 「今天的字」行左右内边距（--bx 12）与行尾「›」左外边 4；文字按钮左右内边距（--bx 4）；三段式宽上限 345、说明与按钮间距 10。
    private let otherPad: CGFloat = 12, textPad: CGFloat = 4, failMax: CGFloat = 345, failGap: CGFloat = 10

    // MARK: 视图（成员名 / accessibilityIdentifier 是 QA 取证的语义键：keys/home.mjs）

    let dateLabel = UILabel()
    let mainMarker = UIView()
    let footMarker = UIView()
    let groupMarker = UIView()
    let shiView = UIView()
    let shiMark = ShiziShiMarkView()
    let epigraphMarker = UIView()
    private(set) var epiColumns: [ShiziVerticalLabel] = []
    private(set) var epiLines: [UILabel] = []
    let noteLabel = UILabel()
    let firstMarker = UIView()
    let mottoMarker = UIView()
    private(set) var mottoChars: [ShiziVerticalLabel] = []
    private(set) var mottoLines: [UILabel] = []
    let sealView = NativeSealView()
    let firstTipLabel = UILabel()
    let failMarker = UIView()
    let failNote = UILabel()
    let failCancel = NativeTextButton(type: .custom)
    let otherButton = NativeTextButton(type: .custom)
    let pickButton = NativeTextButton(type: .custom)
    let deferButton = NativeTextButton(type: .custom)
    let ctaButton = UIButton(type: .custom)
    private var undoBar: NativeUndoBarView?
    private var undoLife: NativeUndoLifetime?

    private var model: View?
    private var shiPath: [[Any]] = []
    private var sealPath: [[Any]] = []
    /// 写入失败的那个动作（「再试一次」重跑它；网页 failed）。
    private var failedAction: (() -> Void)?
    private var busy = false
    /// AX 档主按钮折行时用的宽（屏宽变了重排）。
    private var ctaBreakWidth: CGFloat = 0
    private var hideEpigraph = false
    private var lastSource: String = ""
    private var lastOtherSource: String = ""
    private var lastDeferredSource: String = ""
    private var clock: Timer?
    private var foreground: NSObjectProtocol?
    private var assistiveObservers: [NSObjectProtocol] = []
    /// 品牌时刻同一次进程里只放一次（网页 brandPlayed，同一次页面加载）。
    private static var brandPlayed = false
    private var brandPlaying = false
    private var brandTap: UITapGestureRecognizer?

    // MARK: 生命周期

    override func viewDidLoad() {
        backButton.isHidden = true
        titleLabel.accessibilityIdentifier = "native-home-title"
        dateLabel.accessibilityIdentifier = "native-home-date"
        mainMarker.accessibilityIdentifier = "native-home-main"
        footMarker.accessibilityIdentifier = "native-home-foot"
        groupMarker.accessibilityIdentifier = "native-home-group"
        shiView.accessibilityIdentifier = "native-home-brand-shi"
        shiMark.accessibilityIdentifier = "native-brand-shi-mark"
        epigraphMarker.accessibilityIdentifier = "native-home-epigraph"
        firstMarker.accessibilityIdentifier = "native-home-first"
        mottoMarker.accessibilityIdentifier = "native-home-motto"
        sealView.accessibilityIdentifier = "native-home-seal"
        firstTipLabel.accessibilityIdentifier = "native-home-first-tip"
        failMarker.accessibilityIdentifier = "native-home-start-fail"
        failCancel.accessibilityIdentifier = "native-home-start-fail-cancel"
        otherButton.accessibilityIdentifier = "native-other-line"
        pickButton.accessibilityIdentifier = "native-home-pick"
        deferButton.accessibilityIdentifier = "native-home-capital-defer"
        ctaButton.accessibilityIdentifier = "native-home-start"
        for v in [mainMarker, footMarker, groupMarker, epigraphMarker, firstMarker, mottoMarker, failMarker] {
            v.isUserInteractionEnabled = false
            v.isAccessibilityElement = false
            content.addSubview(v)
        }
        shiView.isAccessibilityElement = true
        shiView.accessibilityTraits = [.image]
        shiView.addSubview(shiMark)
        shiView.clipsToBounds = false
        for l in [dateLabel, noteLabel, firstTipLabel, failNote] { l.numberOfLines = 0 }
        for v in [dateLabel, shiView, noteLabel, sealView, firstTipLabel, failNote, failCancel, otherButton, pickButton, deferButton, ctaButton] as [UIView] { content.addSubview(v) }
        for b in [failCancel, otherButton, pickButton, deferButton] { b.titleLabel?.numberOfLines = 0 }
        ctaButton.titleLabel?.numberOfLines = 0
        ctaButton.titleLabel?.textAlignment = .center
        ctaButton.layer.cornerCurve = .continuous
        wire(ctaButton) { ($0 as? HomeScreen)?.tapCta() }
        wire(otherButton) { ($0 as? HomeScreen)?.tapOther() }
        wire(pickButton) { ($0 as? HomeScreen)?.tapPick() }
        wire(deferButton) { ($0 as? HomeScreen)?.tapDefer() }
        wire(failCancel) { ($0 as? HomeScreen)?.cancelFail() }
        super.viewDidLoad()
        scroll.isScrollEnabled = false
        scroll.alwaysBounceVertical = false
        // 跨天过期（P37）与日期 / 时段：挂载、回前台、每 30 秒（网页 useHomeClock / CLOCK_TICK_MS）
        expire()
        clock = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.expire()
            self?.reload()
        }
        foreground = NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.expire()
            self?.reload()
        }
        for name in [UIAccessibility.voiceOverStatusDidChangeNotification, UIAccessibility.switchControlStatusDidChangeNotification] {
            assistiveObservers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.undoLife?.assistiveChanged(NativeUndoLifetime.systemAssistive)
            })
        }
    }

    deinit {
        clock?.invalidate()
        if let foreground { NotificationCenter.default.removeObserver(foreground) }
        assistiveObservers.forEach { NotificationCenter.default.removeObserver($0) }
        undoLife?.stop()
    }

    override func accessibilityPerformEscape() -> Bool { false } // tab 根页没有返回

    private func expire() {
        guard let engine = stage?.engine else { return }
        engine.raw("home.expire", [:]) { _ in } // 有过期的组才写入；写了会推 changed，页面重拉视图
    }

    // MARK: 视图

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: View.self)
        let dict = raw as? [String: Any]
        shiPath = (dict?["shi"] as? [[Any]]) ?? shiPath
        sealPath = (dict?["seal"] as? [[Any]]) ?? sealPath
        if dict?["boot"] == nil { Self.rememberBoot(view: m.view, shi: dict?["shi"], seal: dict?["seal"]) }
        let viewChanged = model?.view != m.view
        model = m
        if viewChanged, failedAction != nil, m.view == "first" { failedAction = nil }
        renderModel(m)
        renderUndo(m)
        if m.view == "first", m.brand, !axLayout, !Self.brandPlayed, !NativeWriteTransitions.reduceMotion { startBrand() }
    }

    private func t(_ r: ShiziCopyRef?) -> String { r?.text ?? "" }

    // MARK: 启动首帧（B3.F；计划 §3.3 段 2 第 6 条）
    //
    // 引擎就绪前先画首页的静态部分：「拾」（品牌矢量，上一次视图回包里的那份，存在 UserDefaults）+ 日期时段（真实日历日 + 时段，ShiziCore.Dates 与 JS 同一规则的
    // Swift 版）。其余（题记、主按钮的字、「今天的字」行）等引擎就绪后 view.home 补上；主按钮位置不变、就绪前不可点（ShiziScreenViewController：引擎不就绪时
    // 正文不接触摸），不显示等待（F4：< 400ms 不显示）。版式按上一次的首页样式（首次打开 / 日常），从没打开过按首次打开。

    private static let bootKey = "shizi.native.homeBoot"

    private static func rememberBoot(view: String, shi: Any?, seal: Any?) {
        var d: [String: Any] = ["view": view]
        if let shi { d["shi"] = shi }
        if let seal { d["seal"] = seal }
        let old = UserDefaults.standard.dictionary(forKey: bootKey) ?? [:]
        if (old["view"] as? String) == view, old["shi"] != nil, d["shi"] == nil || NSDictionary(dictionary: old).isEqual(to: d) { return }
        UserDefaults.standard.set(d, forKey: bootKey)
    }

    /// 启动首帧的视图回包（只有静态部分；boot 标记 = 不回写缓存）。
    static func bootPayload(now: Date = Date()) -> [String: Any] {
        let cache = UserDefaults.standard.dictionary(forKey: bootKey) ?? [:]
        let c = Calendar.current.dateComponents([.month, .day, .hour], from: now)
        let period = (try? Dates.periodOfHour(Double(c.hour ?? 0))) ?? "night"
        func ref(_ k: String, _ p: [String: Any]? = nil) -> [String: Any] { p.map { ["copy": k, "params": $0] } ?? ["copy": k] }
        var v: [String: Any] = [
            "boot": true,
            "view": cache["view"] as? String ?? "first", "today": "", "period": period,
            "title": ref("R-H01.title"),
            "date": ref("R-H02.line", ["date": ref("R-H02.dateFormat", ["month": c.month ?? 1, "day": c.day ?? 1]), "period": ref("R-H02.period.\(period)")]),
            "shiLabel": ref("X-HOME.shiLabel"),
            "epigraph": ["index": 0, "lines": [String](), "author": "", "label": ""],
            "motto": [[String: Any]](),
            "cta": ["label": ref(""), "aria": ref(""), "action": "start"],
            "fail": ["text": ref("X-HOME.startFailed"), "cancel": ref("R-H06.cancel"), "retry": ref("R-H06.retry")],
            "undo": ["undo": ref("R-W20.undo"), "failed": ref("R-W16.saveFailed"), "cancel": ref("R-W16.cancel"), "retry": ref("R-W16.retry")],
            "brand": false,
        ]
        if let shi = cache["shi"] { v["shi"] = shi }
        if let seal = cache["seal"] { v["seal"] = seal }
        return ["ok": true, "view": v]
    }

    private var compact: Bool {
        let cats = (ShiziTokens.root["type"] as? [String: Any])?["categories"] as? [String: Any]
        let k = ((cats?[ShiziTokens.categoryName(metrics.category)] as? [String: Any])?["k"] as? NSNumber)?.doubleValue ?? 1
        let limit = ((ShiziTokens.root["type"] as? [String: Any])?["compactTextScale"] as? NSNumber)?.doubleValue ?? 1.3
        return k >= limit || (view.window?.bounds.height ?? UIScreen.main.bounds.height) <= 760 // P69 紧凑屏高度上限（原 policy.compactMaxHeight 没有代码读取，已删）
    }

    private func song(_ size: CGFloat) -> UIFont { NativeType.song(size: size, weight: .regular) }

    /// 宋体的字（不补苹方的字距；行盒 = line）。
    private func setSong(_ l: UILabel, _ text: String, size: CGFloat, color c: UIColor, align: NSTextAlignment = .center, line: CGFloat? = nil) {
        let f = song(size)
        let p = NSMutableParagraphStyle()
        p.alignment = align
        var attrs: [NSAttributedString.Key: Any] = [.font: f, .foregroundColor: c, .kern: 0, .paragraphStyle: p]
        if let line {
            p.minimumLineHeight = line
            p.maximumLineHeight = line
            attrs[.baselineOffset] = (line - f.lineHeight) / 4
        }
        l.font = f
        l.attributedText = NSAttributedString(string: text, attributes: attrs)
    }

    /// 中文与拉丁混排的字（日期「10月5日 · 晚上」、「继续写字 · 2 / 5」、「你写过的 5 个字都还在。」）：中文按苹方 UI 正文款 + 实际字号的字距（NativeType.cjkTrack），
    /// 数字 / 空格 / 间隔点按系统字体**本身**排——AX 档大字号下系统字体换展示款（字宽更窄），网页 -apple-system 也是；NativeType.compose 的 cascade 字体
    /// 由描述符重建，大字号下仍按正文款排拉丁字母，AX 档会宽 1–2pt。
    private func mixed(_ text: String, size: CGFloat, weight: UIFont.Weight = .regular, color c: UIColor, align: NSTextAlignment = .natural, line: CGFloat? = nil,
                       tabular latinTabular: Bool = false, wrap: Bool = true) -> NSAttributedString {
        let cjk = NativeType.cjkFont(size: size, weight: weight)
        var latin = UIFont.systemFont(ofSize: size, weight: weight)
        if latinTabular { latin = tabular(latin) }
        let track = NativeType.cjkTrack(size: size, weight: weight)
        let p = NSMutableParagraphStyle()
        p.alignment = align
        p.lineBreakMode = wrap ? .byWordWrapping : .byClipping
        var shift: CGFloat = 0
        let base = NativeType.compose(size: size, weight: weight)
        if let line, line > 0 {
            if line < base.lineHeight - 0.01 {
                p.minimumLineHeight = line
                p.maximumLineHeight = line
                shift = (line - base.lineHeight) / 4
            } else {
                p.lineSpacing = max(0, line - base.lineHeight)
            }
        }
        let out = NSMutableAttributedString()
        for ch in text {
            let isCJK = ch.unicodeScalars.contains { $0.value >= 0x2E80 }
            var attrs: [NSAttributedString.Key: Any] = [.font: isCJK ? cjk : latin, .foregroundColor: c, .paragraphStyle: p, .kern: isCJK ? track : 0]
            if shift != 0 { attrs[.baselineOffset] = shift }
            out.append(NSAttributedString(string: String(ch), attributes: attrs))
        }
        return out
    }

    private func setMixed(_ l: UILabel, _ text: String, size: CGFloat, color c: UIColor, align: NSTextAlignment = .natural, line: CGFloat) {
        l.font = NativeType.compose(size: size, weight: .regular)
        l.textColor = c
        l.textAlignment = align
        l.attributedText = text.isEmpty ? nil : mixed(text, size: size, color: c, align: align, line: line)
        if text.isEmpty { l.text = nil }
    }

    private func renderModel(_ m: View) {
        let mt = metrics
        let first = m.view == "first"
        let ax = axLayout
        // 日期时段（13 墨三）与只给读屏的标题「今天写字」（h1，描述 = 题记全句）
        dateLabel.isHidden = first
        setMixed(dateLabel, t(m.date), size: mt.value("fs13"), color: color("ink3"), line: mt.line("lh13"))
        titleLabel.isHidden = first
        titleLabel.text = t(m.title)
        titleLabel.accessibilityLabel = t(m.title)
        titleLabel.accessibilityHint = m.epigraph.label
        titleLabel.textColor = .clear
        // 「拾」
        shiView.accessibilityLabel = t(m.shiLabel)
        shiMark.configure(path: shiPath, color: color("hand"))
        if first {
            shiView.backgroundColor = color("sheet")
            shiView.layer.borderColor = color("frame").cgColor
            shiView.layer.borderWidth = mt.value("frame-w")
        } else {
            shiView.backgroundColor = .clear
            shiView.layer.borderWidth = 0
        }
        // 题记：竖排三列（非 AX）/ 横排三行（AX）
        let epiTexts = m.epigraph.lines + [m.epigraph.author]
        if epiColumns.count != epiTexts.count {
            (epiColumns as [UIView] + epiLines).forEach { $0.removeFromSuperview() }
            epiColumns = epiTexts.map { _ in ShiziVerticalLabel() }
            epiLines = epiTexts.map { _ in UILabel() }
            for v in epiColumns as [UIView] + epiLines {
                v.isAccessibilityElement = false
                content.addSubview(v)
            }
        }
        for (i, s) in epiTexts.enumerated() {
            let author = i == epiTexts.count - 1
            let c = epiColumns[i]
            c.text = s
            c.glyphFont = song(mt.value(author ? "fs13" : "fs15"))
            c.font = c.glyphFont
            c.glyphColor = color(author ? "ink3" : "ink2")
            c.textColor = c.glyphColor
            c.spacing = author ? 0.12 : 0.2
            c.setNeedsDisplay()
            let l = epiLines[i]
            l.numberOfLines = 0
            setSong(l, s, size: mt.value("fs13"), color: color(author ? "ink3" : "ink2"), line: mt.line("lh13"))
            c.isHidden = first || ax
            l.isHidden = first || !ax
        }
        // 离开一周 / 特别组那天的一句 / 今天的进度（D83）
        if let note = m.note, !first {
            noteLabel.isHidden = false
            // capital / back / today（今天的练习 n / N）/ done（今天完成了，D83）
            noteLabel.accessibilityIdentifier = ["capital": "native-home-capital-body", "today": "native-home-today", "done": "native-home-done"][note.kind] ?? "native-home-back-note"
            setMixed(noteLabel, t(note.text), size: mt.value("fs13"), color: color("ink3"), align: .center, line: mt.line("lh13"))
        } else {
            noteLabel.isHidden = true
        }
        // 首次打开：题跋（竖排逐字 / AX 横排三行）+ 印
        let motto = m.motto.map { t($0) }
        let chars = motto.flatMap { Array($0) }.map(String.init)
        if mottoChars.count != chars.count {
            mottoChars.forEach { $0.removeFromSuperview() }
            mottoChars = chars.map { _ in ShiziVerticalLabel() }
            mottoChars.forEach { $0.isAccessibilityElement = false; content.addSubview($0) }
        }
        let mfs = compact ? mt.value("fs17") : mt.value("fs22")
        for (i, ch) in chars.enumerated() {
            let c = mottoChars[i]
            c.text = ch
            c.glyphFont = song(mfs)
            c.font = c.glyphFont
            c.glyphColor = color("ink1")
            c.textColor = c.glyphColor
            c.spacing = 0.2
            c.isHidden = !first || ax
            c.setNeedsDisplay()
        }
        if mottoLines.count != motto.count {
            mottoLines.forEach { $0.removeFromSuperview() }
            mottoLines = motto.map { _ in UILabel() }
            mottoLines.forEach { $0.isAccessibilityElement = false; content.addSubview($0) }
        }
        for (i, s) in motto.enumerated() {
            setSong(mottoLines[i], s, size: mt.value("fs13"), color: color("ink1"), line: mt.line("lh13"))
            mottoLines[i].isHidden = !first || !ax
        }
        firstMarker.isHidden = !first
        mottoMarker.isHidden = !first
        mottoMarker.isAccessibilityElement = first
        mottoMarker.accessibilityTraits = [.header]
        mottoMarker.accessibilityLabel = motto.joined()
        sealView.configure(path: sealPath, fill: color("seal"), glyph: color("on-seal"))
        sealView.layer.cornerRadius = mt.value("r-work")
        sealView.isHidden = !first || sealPath.isEmpty
        groupMarker.isHidden = first
        epigraphMarker.isHidden = first
        // 按钮区
        firstTipLabel.isHidden = m.firstTip == nil
        setMixed(firstTipLabel, t(m.firstTip), size: mt.value("fs13"), color: color("ink3"), align: .center, line: mt.line("lh13"))
        let failed = failedAction != nil
        failMarker.isHidden = !failed
        failNote.isHidden = !failed
        failCancel.isHidden = !failed
        setMixed(failNote, t(m.fail.text), size: mt.value("fs15"), color: color("ink2"), align: .center, line: mt.line("lh15"))
        styleText(failCancel, t(m.fail.cancel))
        styleText(pickButton, t(m.pick))
        pickButton.isHidden = m.pick == nil
        styleText(deferButton, t(m.deferSpecial))
        deferButton.isHidden = m.deferSpecial == nil
        if let o = m.other {
            otherButton.isHidden = false
            styleOther(t(o.text))
            otherButton.accessibilityLabel = t(o.aria)
        } else {
            otherButton.isHidden = true
        }
        styleCta(m, failed: failed)
        accessibilityOrder(m)
        view.setNeedsLayout()
    }

    /// 文字按钮（.sz-btn--text：15 / lh15、墨二、左右内边距 4；AX 档可折行、居中）。
    private func styleText(_ b: UIButton, _ title: String) {
        let mt = metrics
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = mt.font(15)
        b.titleLabel?.textAlignment = .center
        b.setTitleColor(color("ink2"), for: .normal)
        b.setTitleColor(color("ink1"), for: .highlighted)
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: textPad, bottom: 0, right: textPad)
        b.accessibilityLabel = title
        NativeType.trackTitle(b)
    }

    /// 「今天的字 · 7 / 20 ›」行（文字按钮，左右内边距 12，行尾「›」墨三、左外边 4）。
    private func styleOther(_ text: String) {
        let mt = metrics
        let b = otherButton
        let f = mt.font(15)
        let k = NativeType.cjkTrack(size: f.pointSize, weight: .regular)
        let p = NSMutableParagraphStyle()
        p.alignment = .center
        let out = NSMutableAttributedString(string: text, attributes: [.font: f, .foregroundColor: color("ink2"), .kern: 0, .paragraphStyle: p])
        var i = 0
        for ch in text {
            let n = (String(ch) as NSString).length
            if NativeType.hasCJK(String(ch)) { out.addAttribute(.kern, value: k, range: NSRange(location: i, length: n)) }
            i += n
        }
        if out.length > 0 { out.addAttribute(.kern, value: 4, range: NSRange(location: out.length - 1, length: 1)) }
        out.append(NSAttributedString(string: "\u{203A}", attributes: [.font: f, .foregroundColor: color("ink3"), .kern: 0, .paragraphStyle: p]))
        b.setTitle(text + "\u{203A}", for: .normal)
        b.setTitleColor(color("ink2"), for: .normal)
        b.setAttributedTitle(out, for: .normal)
        b.titleLabel?.font = f
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: otherPad, bottom: 0, right: otherPad)
    }

    /// 主按钮（.sz-btn--primary：btn-bg 底、btn-fg 字 17 / 500、圆角 r-ctl；进行中时字后接「 · 已写 / 总数」，同色、字重 400、等宽数字）。失败时换成「再试一次」。
    private func styleCta(_ m: View, failed: Bool) {
        let mt = metrics
        let b = ctaButton
        let label = failed ? t(m.fail.retry) : t(m.cta.label)
        let progress = failed ? nil : m.cta.progress.map { t($0) }
        let fg = color("btn-fg")
        let size = mt.value("fs17")
        var line: CGFloat? = axLayout ? mt.line("lh17s") : nil
        let make: (String, String?, CGFloat?) -> NSMutableAttributedString = { [unowned self] label, progress, line in
            let out = NSMutableAttributedString(attributedString: self.mixed(label, size: size, weight: .medium, color: fg, align: .center, line: line))
            if let progress { out.append(self.mixed(" \u{00B7} " + progress, size: size, weight: .regular, color: fg, align: .center, line: line, tabular: true)) }
            return out
        }
        var out = make(label, progress, line)
        var full = out.string
        // 字可折行：AX 档（white-space:normal，满宽）；非 AX 档 240 宽的主按钮在大字号下字也会折（XXXL「继续写自选字 · 2 / 5」，B3.6 在 S02 下面的首页上看到）——
        // 网页按钮行高 lh17s、min-height btn-h。按 WebKit 的折行机会（空格后、中文字之间）贪心折，TextKit 的按词折会把「2 / 5」整个挪下去
        ctaBreakWidth = (axLayout ? view.bounds.width - 2 * mt.gutter : min(ctaWidth, view.bounds.width - 2 * mt.gutter)) - 48
        if !axLayout, ctaBreakWidth > 0, out.size().width > ctaBreakWidth + 0.5 {
            line = mt.line("lh17s")
            out = make(label, progress, line)
            full = out.string
        }
        if ctaBreakWidth > 0, out.size().width > ctaBreakWidth + 0.5 {
            let chars = Array(full)
            var cut: Int?
            for i in 1..<chars.count {
                let prev = chars[i - 1], cur = chars[i]
                let opp = prev == " " || NativeType.hasCJK(String(prev)) || NativeType.hasCJK(String(cur))
                guard opp else { continue }
                let head = String(chars[..<i]).trimmingCharacters(in: .whitespaces)
                if out.attributedSubstring(from: NSRange(location: 0, length: (head as NSString).length)).size().width <= ctaBreakWidth + 0.5 { cut = i } else { break }
            }
            if let cut {
                let head = String(chars[..<cut]).trimmingCharacters(in: .whitespaces)
                let tail = String(chars[cut...]).trimmingCharacters(in: .whitespaces)
                let ns = out
                let headLen = (head as NSString).length
                let tailStart = (full as NSString).length - (tail as NSString).length
                out = NSMutableAttributedString(attributedString: ns.attributedSubstring(from: NSRange(location: 0, length: headLen)))
                out.append(NSAttributedString(string: "\n", attributes: ns.attributes(at: max(0, headLen - 1), effectiveRange: nil)))
                out.append(ns.attributedSubstring(from: NSRange(location: tailStart, length: (tail as NSString).length)))
                full = out.string
            }
        }
        b.setTitle(full, for: .normal)
        b.setTitleColor(fg, for: .normal)
        b.setAttributedTitle(out, for: .normal)
        b.titleLabel?.font = mt.font(17, .medium)
        b.backgroundColor = color("btn-bg")
        b.layer.cornerRadius = mt.value("r-ctl")
        b.contentEdgeInsets = UIEdgeInsets(top: axLayout ? 6 : 0, left: 24, bottom: axLayout ? 6 : 0, right: 24)
        b.accessibilityIdentifier = failed ? "native-home-start-fail-retry" : "native-home-start"
        b.accessibilityLabel = failed ? label : t(m.cta.aria)
    }

    private func tabular(_ f: UIFont) -> UIFont {
        let d = f.fontDescriptor.addingAttributes([.featureSettings: [[UIFontDescriptor.FeatureKey.type: kNumberSpacingType, UIFontDescriptor.FeatureKey.selector: kMonospacedNumbersSelector]]])
        return UIFont(descriptor: d, size: f.pointSize)
    }

    /// 读屏顺序 = 网页 DOM 顺序（标题 →「拾」→ 那一句 → 三段式 → 首练说明 →「今天的字」→ 自己选字 / 写平常字 → 主按钮 → 撤销条）。
    private func accessibilityOrder(_ m: View) {
        var els: [Any] = []
        if m.view == "first" { els += [shiView, mottoMarker] } else { els += [titleLabel, shiView] }
        for v in [noteLabel, failNote, failCancel, firstTipLabel, otherButton, pickButton, deferButton, ctaButton] as [UIView] where !v.isHidden { els.append(v) }
        if let bar = undoBar { els.append(bar) }
        content.accessibilityElements = els
    }

    // MARK: 排版

    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat { top }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let W = view.bounds.width, H = view.bounds.height
        guard W > 0, let m = model else { return }
        backButton.isHidden = true
        scroll.frame = view.bounds
        content.frame = view.bounds
        scroll.contentSize = view.bounds.size
        layoutHome(m, W: W, H: H)
        reportSource()
    }

    /// 文字在宽 w 内的行数 × 行高（NativeType.height）。
    private func textHeight(_ l: UILabel, width: CGFloat, line: CGFloat) -> CGFloat { NativeType.height(l, width: width, line: line) }

    private static let noBreakBefore: Set<Character> = ["\u{FF0C}", "\u{3002}", "\u{3001}", "\u{FF01}", "\u{FF1F}", "\u{FF1B}", "\u{FF1A}", "\u{300D}", "\u{300F}", "\u{FF09}", " "]
    private static let noBreakAfter: Set<Character> = ["\u{300C}", "\u{300E}", "\u{FF08}"]

    /// WebKit 的折行机会（UAX#14 的中文部分）：空格之后、中文字之间（句读不放行首、开引号不放行尾）。i = 断在第 i 个字之前。
    private func canBreak(_ c: [Character], _ i: Int) -> Bool {
        let a = c[i - 1], b = c[i]
        if Self.noBreakBefore.contains(b) || Self.noBreakAfter.contains(a) { return false }
        if a == " " { return true }
        return NativeType.hasCJK(String(a)) || NativeType.hasCJK(String(b))
    }

    /// 在宽 w 里按折行机会贪心折：各行（去掉行尾空格）的字符区间。
    private func greedyLines(_ a: NSAttributedString, _ c: [Character], width w: CGFloat) -> [Range<Int>] {
        let offsets = c.reduce(into: [0]) { $0.append($0.last! + (String($1) as NSString).length) }
        func width(_ r: Range<Int>) -> CGFloat {
            var e = r.upperBound
            while e > r.lowerBound, c[e - 1] == " " { e -= 1 }
            return a.attributedSubstring(from: NSRange(location: offsets[r.lowerBound], length: offsets[e] - offsets[r.lowerBound])).size().width
        }
        var lines: [Range<Int>] = []
        var start = 0
        while start < c.count {
            var end = c.count
            if width(start..<c.count) > w + 0.5 {
                var cut: Int?
                for i in (start + 1)..<c.count where canBreak(c, i) {
                    if width(start..<i) <= w + 0.5 { cut = i } else { break }
                }
                end = cut ?? c.count
            }
            lines.append(start..<end)
            start = end
            while start < c.count, c[start] == " " { start += 1 }
        }
        return lines
    }

    /// text-wrap: balance / pretty（短的居中句子）：行数不变的前提下，在各种折法里取各行最齐的那一种（最长减最短最小；一样时取窄的），按 WebKit 的折行机会自己折
    /// （TextKit 遇到「5 个字」会在空格处折）。例 AX5「你写过的 5 个 / 字都还在。」。标签换成带换行的字；返回 (宽, 高)。
    private func balanced(_ l: UILabel, width: CGFloat, line: CGFloat) -> (CGFloat, CGFloat) {
        guard let src = l.attributedText, src.length > 0 else { return (0, 0) }
        let a = NSMutableAttributedString(attributedString: src)
        a.mutableString.replaceOccurrences(of: "\n", with: "", options: [], range: NSRange(location: 0, length: a.length))
        let c = Array(a.string)
        let offsets = c.reduce(into: [0]) { $0.append($0.last! + (String($1) as NSString).length) }
        func widths(_ lines: [Range<Int>]) -> [CGFloat] {
            lines.map { r -> CGFloat in
                var e = r.upperBound
                while e > r.lowerBound, c[e - 1] == " " { e -= 1 }
                return a.attributedSubstring(from: NSRange(location: offsets[r.lowerBound], length: offsets[e] - offsets[r.lowerBound])).size().width
            }
        }
        var lines = greedyLines(a, c, width: width)
        let n = lines.count
        if n > 1 {
            var best: (range: CGFloat, w: CGFloat, lines: [Range<Int>])?
            var w = width
            while w > 1 {
                let ls = greedyLines(a, c, width: w)
                if ls.count != n { break }
                let ws = widths(ls)
                let mx = ws.max() ?? 0, range = mx - (ws.min() ?? 0)
                if mx > w + 0.5 { break } // 有一行折不开、比可用宽还宽：再窄也一样
                if best == nil || range < best!.range - 0.01 || (abs(range - best!.range) <= 0.01 && mx < best!.w) { best = (range, mx, ls) }
                w = min(w, mx) - 0.5
            }
            if let best { lines = best.lines }
        }
        // 折好的字：行与行之间换行（行尾空格去掉）
        let out = NSMutableAttributedString()
        for (i, r) in lines.enumerated() {
            var e = r.upperBound
            while e > r.lowerBound, c[e - 1] == " " { e -= 1 }
            out.append(a.attributedSubstring(from: NSRange(location: offsets[r.lowerBound], length: offsets[e] - offsets[r.lowerBound])))
            if i < lines.count - 1 { out.append(NSAttributedString(string: "\n", attributes: a.attributes(at: max(0, offsets[e] - 1), effectiveRange: nil))) }
        }
        l.attributedText = out
        let mx = widths(lines).max() ?? 0
        return (ceil(mx * 10) / 10 + 0.5, CGFloat(lines.count) * line)
    }

    /// 文字按钮的框：字宽 + 左右内边距；高 = hit（AX 档 max(44, 1.3em + 12)，折行时按行数）。maxW = 一行能用的宽。
    private func textButtonSize(_ b: UIButton, pad: CGFloat, maxW: CGFloat) -> CGSize {
        let mt = metrics
        let fs = mt.value("fs15"), lh = mt.line("lh15")
        let tw = ceil(NativeType.titleWidth(b))
        let minH = axLayout ? max(mt.hit, 1.3 * fs + 12) : mt.hit
        if tw + 2 * pad <= maxW || !axLayout { return CGSize(width: min(maxW, tw + 2 * pad), height: minH) }
        let lines = max(1, ceil((tw - 0.5) / max(1, maxW - 2 * pad)))
        return CGSize(width: maxW, height: max(minH, lines * lh))
    }

    private func layoutHome(_ m: View, W: CGFloat, H: CGFloat) {
        let mt = metrics
        let ax = axLayout
        let first = m.view == "first"
        let gutter = mt.gutter
        let innerW = W - 2 * gutter
        let top = view.safeAreaInsets.top + mt.space(3) // .sz-home 上内边距 12 + 安全区
        // 页头
        var headH = firstHead
        if !first {
            dateLabel.numberOfLines = ax ? 0 : 1
            headH = ax ? textHeight(dateLabel, width: innerW, line: mt.line("lh13")) : mt.line("lh13")
            dateLabel.frame = CGRect(x: gutter, y: top, width: innerW, height: headH)
        }
        titleLabel.frame = CGRect(x: gutter - 1, y: top - 1, width: 1, height: 1)
        let mainTop = top + headH
        // 按钮区（自下而上；底边在 Tab 栏上沿上方 24 = s6，P258 / P298）
        var y = H - mt.space(6)
        let btnH = mt.value("btn-h")
        var ctaW = ax ? innerW : min(ctaWidth, innerW)
        var ctaH = btnH
        if ax {
            if abs(ctaBreakWidth - (innerW - 48)) > 0.5 { styleCta(m, failed: failedAction != nil) }
            let lines = CGFloat((ctaButton.title(for: .normal) ?? "").components(separatedBy: "\n").count)
            ctaH = max(btnH, lines * mt.line("lh17s") + 12)
        } else {
            ctaW = min(ctaWidth, innerW)
            if abs(ctaBreakWidth - (ctaW - 48)) > 0.5 { styleCta(m, failed: failedAction != nil) }
            // 折成多行时（大字号）：网页 min-height btn-h、行高 lh17s、上下内边距 0
            let lines = CGFloat((ctaButton.title(for: .normal) ?? "").components(separatedBy: "\n").count)
            if lines > 1 { ctaH = max(btnH, lines * mt.line("lh17s")) }
        }
        y -= ctaH
        ctaButton.frame = CGRect(x: (W - ctaW) / 2, y: y, width: ctaW, height: ctaH)
        // 自己选字 / 写平常字（一行居中、间距 12、文字按钮左右外边距 −4；AX 档上下排）；每个下外边距 4
        let sides = [pickButton, deferButton].filter { !$0.isHidden }
        if !sides.isEmpty {
            if ax {
                for b in sides.reversed() {
                    let s = textButtonSize(b, pad: textPad, maxW: innerW)
                    y -= s.height + 4
                    b.frame = CGRect(x: (W - s.width) / 2, y: y, width: s.width, height: s.height)
                }
            } else {
                let sizes = sides.map { textButtonSize($0, pad: textPad, maxW: innerW) }
                let gap: CGFloat = 12 - 2 * textPad
                let total = sizes.reduce(0) { $0 + $1.width } + gap * CGFloat(sides.count - 1)
                let h = sizes.map(\.height).max() ?? mt.hit
                y -= h + 4
                var x = (W - total) / 2
                for (b, s) in zip(sides, sizes) {
                    b.frame = CGRect(x: x, y: y, width: s.width, height: s.height)
                    x += s.width + gap
                }
            }
        }
        // 「今天的字 · 接着写」行（上外边距 4）
        if !otherButton.isHidden {
            let s = textButtonSize(otherButton, pad: otherPad, maxW: innerW)
            y -= s.height
            otherButton.frame = CGRect(x: (W - s.width) / 2, y: y, width: s.width, height: s.height)
            y -= 4
        }
        // 首练说明（13 墨三，下外边距 12；AX 4）
        if !firstTipLabel.isHidden {
            let (tw, th) = balanced(firstTipLabel, width: innerW, line: mt.line("lh13"))
            y -= ax ? 4 : 12
            y -= th
            firstTipLabel.frame = CGRect(x: (W - tw) / 2, y: y, width: tw, height: th)
        }
        // 失败三段式（宽 ≤ 345：说明 15 墨二 + 间距 10 +「先不保存」；下外边距 12）
        if failedAction != nil {
            let fw = min(failMax, innerW)
            let fx = (W - fw) / 2
            let cs = textButtonSize(failCancel, pad: textPad, maxW: fw)
            let (nw, nh) = balanced(failNote, width: fw, line: mt.line("lh15"))
            y -= 12
            y -= cs.height
            failCancel.frame = CGRect(x: (W - cs.width) / 2, y: y, width: cs.width, height: cs.height)
            y -= failGap + nh
            failNote.frame = CGRect(x: (W - nw) / 2, y: y, width: nw, height: nh)
            failMarker.frame = CGRect(x: fx, y: y, width: fw, height: nh + failGap + cs.height)
        }
        footMarker.frame = CGRect(x: gutter, y: y, width: innerW, height: H - y)
        let mainH = max(0, y - mainTop)
        mainMarker.frame = CGRect(x: gutter, y: mainTop, width: innerW, height: mainH)
        if first {
            if ax { layoutFirstAx(W: W, mainTop: mainTop, mainH: mainH) } else { layoutFirst(W: W, innerW: innerW, mainTop: mainTop, mainH: mainH) }
        } else if ax {
            layoutDailyAx(m, W: W, H: H, innerW: innerW, top: top, headH: headH, footTop: y, mainTop: mainTop, mainH: mainH)
        } else {
            layoutDaily(m, W: W, innerW: innerW, mainTop: mainTop, mainH: mainH)
        }
        layoutUndo(W: W, innerW: innerW)
    }

    /// 日常态（非 AX）：「拾」128 底对齐 + 题记三列（右起），组在主区居中、组底留屏宽 8%；那一句在组下（上下外边距 ∓4% 句宽）。
    private func layoutDaily(_ m: View, W: CGFloat, innerW: CGFloat, mainTop: CGFloat, mainH: CGFloat) {
        let n = epiColumns.count
        let colHs = epiColumns.map { ShiziVerticalLabel.height($0.text ?? "", font: $0.glyphFont, spacing: $0.spacing) }
        let epiW = CGFloat(n) * epiCol + CGFloat(max(0, n - 1)) * epiColGap
        let groupH = max(shiSize, colHs.max() ?? 0)
        let groupW = shiSize + groupGap + epiW
        let mb = innerW * groupBottomShare
        var noteH: CGFloat = 0, noteW: CGFloat = 0
        if !noteLabel.isHidden {
            let r = balanced(noteLabel, width: innerW, line: metrics.line("lh13"))
            noteW = r.0
            noteH = r.1
        }
        let blockW = min(ceil(NativeType.width(noteLabel)), innerW)
        let margin = noteLabel.isHidden ? 0 : blockW * noteShare
        let contentH = groupH + mb + noteH
        let gy = mainTop + (mainH - contentH) / 2
        let gx = (W - groupW) / 2
        groupMarker.frame = CGRect(x: gx, y: gy, width: groupW, height: groupH)
        placeShi(CGRect(x: gx, y: gy + groupH - shiSize, width: shiSize, height: shiSize), mark: true)
        let ex = gx + shiSize + groupGap
        epigraphMarker.frame = CGRect(x: ex, y: gy, width: epiW, height: groupH)
        epigraphMarker.isHidden = false
        for (i, c) in epiColumns.enumerated() {
            // 右起：第一句在最右，作者在最左；列高拉齐到组高（flex stretch）
            let cx = ex + epiW - CGFloat(i + 1) * epiCol - CGFloat(i) * epiColGap
            c.frame = CGRect(x: cx, y: gy, width: epiCol, height: groupH)
            c.setNeedsDisplay()
        }
        if !noteLabel.isHidden {
            noteLabel.frame = CGRect(x: (W - noteW) / 2, y: gy + groupH + mb - margin, width: noteW, height: noteH)
        }
    }

    /// 日常态 AX：「拾」在上、题记横排在下，居中；「拾」按剩余高度缩（≤128、≥64），放不下先收起题记（≥44）。
    private func layoutDailyAx(_ m: View, W: CGFloat, H: CGFloat, innerW: CGFloat, top: CGFloat, headH: CGFloat, footTop: CGFloat, mainTop: CGFloat, mainH: CGFloat) {
        let mt = metrics
        let lh = mt.line("lh13")
        var noteH: CGFloat = 0, noteW: CGFloat = 0
        if !noteLabel.isHidden {
            let r = balanced(noteLabel, width: innerW, line: lh)
            noteW = r.0
            noteH = r.1
        }
        var lineSizes: [CGSize] = []
        for l in epiLines {
            let r = balanced(l, width: innerW, line: lh)
            lineSizes.append(CGSize(width: r.0, height: r.1))
        }
        let epiH = mt.space(2) + lineSizes.reduce(0) { $0 + $1.height }
        let epiW = lineSizes.map(\.width).max() ?? 0
        // useShiAvail：Tab 内容区高 − 上内边距 − 页头 − 按钮区 − 那一句 − 12（offsetHeight 取整）
        let base = H - top - headH - (H - footTop).rounded() - noteH.rounded() - 12
        let withEpi = floor(base - epiH)
        let size: CGFloat
        if withEpi >= shiMin {
            size = min(shiSize, withEpi)
            hideEpigraph = false
        } else {
            size = max(shiFloor, min(shiSize, floor(base)))
            hideEpigraph = true
        }
        let shownEpiH = hideEpigraph ? 0 : epiH
        let groupW = max(size, epiW)
        let groupH = size + shownEpiH
        let gy = mainTop + (mainH - groupH - noteH) / 2
        let gx = (W - groupW) / 2
        groupMarker.frame = CGRect(x: gx, y: gy, width: groupW, height: groupH)
        placeShi(CGRect(x: (W - size) / 2, y: gy, width: size, height: size), mark: true)
        epigraphMarker.frame = CGRect(x: (W - epiW) / 2, y: gy + size, width: epiW, height: shownEpiH)
        epigraphMarker.isHidden = hideEpigraph
        var ly = gy + size + mt.space(2)
        for (l, s) in zip(epiLines, lineSizes) {
            l.isHidden = hideEpigraph
            l.frame = CGRect(x: (W - s.width) / 2, y: ly, width: s.width, height: s.height)
            ly += s.height
        }
        if !noteLabel.isHidden {
            noteLabel.frame = CGRect(x: (W - noteW) / 2, y: gy + groupH, width: noteW, height: noteH)
        }
    }

    /// 「拾」与矢量：日常态矢量放大 124%、外移 12%（同网页）；首次打开矢量铺满格。
    private func placeShi(_ r: CGRect, mark daily: Bool) {
        shiView.frame = r
        let s = r.width
        shiMark.frame = daily ? CGRect(x: -s * (markScale - 1) / 2, y: -s * (markScale - 1) / 2, width: s * markScale, height: s * markScale) : CGRect(origin: .zero, size: r.size)
    }

    /// 首次打开（非 AX）：框中「拾」+ 竖排题跋三列（右起）+ 末列下的印，顶对齐，组在主区居中。
    private func layoutFirst(W: CGFloat, innerW: CGFloat, mainTop: CGFloat, mainH: CGFloat) {
        let mt = metrics
        let cell = compact ? firstMin : max(firstMin, min(firstMax, (W * 0.5).rounded()))
        let colW = compact ? firstColCompact : firstCol
        let fs = compact ? mt.value("fs17") : mt.value("fs22")
        let step = fs * 1.2
        let motto = model?.motto.map { $0.text } ?? []
        let cols = motto.count
        let colHs = motto.map { CGFloat($0.count) * step }
        let lastH = (colHs.last ?? 0) + sealGap + sealSide
        let mottoH = max(colHs.dropLast().max() ?? 0, lastH)
        let mottoW = CGFloat(cols) * colW
        let groupW = cell + firstGap + mottoW
        let groupH = max(cell, mottoH)
        let gx = (W - groupW) / 2
        let gy = mainTop + (mainH - groupH) / 2
        firstMarker.frame = CGRect(x: gx, y: gy, width: groupW, height: groupH)
        placeShi(CGRect(x: gx, y: gy, width: cell, height: cell), mark: false)
        let mx = gx + cell + firstGap
        mottoMarker.frame = CGRect(x: mx, y: gy, width: mottoW, height: mottoH)
        let glyph = song(fs)
        let box = floor(glyph.pointSize * 1.5) // 竖排字的行内框宽 = 1.5em（宋的内容区；WebKit 取整）
        var k = 0
        for (ci, line) in motto.enumerated() {
            let colX = mx + mottoW - CGFloat(ci + 1) * colW
            for (i, _) in line.enumerated() where k < mottoChars.count {
                mottoChars[k].frame = CGRect(x: colX + (colW - box) / 2, y: gy + CGFloat(i) * step, width: box, height: step)
                k += 1
            }
            if ci == cols - 1 {
                sealView.frame = CGRect(x: colX + (colW - sealSide) / 2, y: gy + colHs[ci] + sealGap, width: sealSide, height: sealSide)
            }
        }
    }

    /// 首次打开 AX：「拾」120 在上，题跋横排三行（宋 13 档、居中），印跟在末句后（左外边 8、竖向居中对齐 x 字高）。
    private func layoutFirstAx(W: CGFloat, mainTop: CGFloat, mainH: CGFloat) {
        let mt = metrics
        let lh = mt.line("lh13")
        let widths = mottoLines.map { ceil(NativeType.width($0) * 10) / 10 }
        let lastW = (widths.last ?? 0) + sealInline + sealSide
        let mottoW = max(widths.dropLast().max() ?? 0, lastW)
        let mottoH = CGFloat(mottoLines.count) * lh
        let groupW = max(firstAxShi, mottoW)
        let groupH = firstAxShi + firstAxGap + mottoH
        let gy = mainTop + (mainH - groupH) / 2
        let gx = (W - groupW) / 2
        firstMarker.frame = CGRect(x: gx, y: gy, width: groupW, height: groupH)
        placeShi(CGRect(x: (W - firstAxShi) / 2, y: gy, width: firstAxShi, height: firstAxShi), mark: false)
        let my = gy + firstAxShi + firstAxGap
        let mx = (W - mottoW) / 2
        mottoMarker.frame = CGRect(x: mx, y: my, width: mottoW, height: mottoH)
        for (i, l) in mottoLines.enumerated() {
            let last = i == mottoLines.count - 1
            let unit = last ? lastW : widths[i]
            let x = mx + (mottoW - unit) / 2
            l.frame = CGRect(x: x, y: my + CGFloat(i) * lh, width: widths[i], height: lh)
            if last {
                let f = song(mt.value("fs13"))
                let baseline = l.frame.minY + (lh - (f.ascender - f.descender)) / 2 + f.ascender
                sealView.frame = CGRect(x: x + widths[i] + sealInline, y: baseline - f.xHeight / 2 - sealSide / 2, width: sealSide, height: sealSide)
            }
        }
    }

    // MARK: 离开撤销条（S4：写字页跳过后离开，撤销机会跟到首页；网页 LeaveUndoHost 同一份状态）

    private func renderUndo(_ m: View) {
        guard let u = m.leaveUndo else {
            endUndo()
            return
        }
        if let bar = undoBar {
            if u.failed != bar.isFailed { bar.setFailed(u.failed) }
            return
        }
        guard u.remainingMs > 0 || u.failed else { return }
        let mt = metrics
        let theme: ShiziTokens.Theme = traitCollection.userInterfaceStyle == .dark ? .dark : .light
        let raw = ShiziTokens.colorStrings(theme)
        let fg = color("toast-fg")
        let style = NativeToastStyle(background: color("toast-bg"), foreground: fg, action: color("toast-act"), line: color("toast-line"),
                                     shadow: NativeInkWire.shadow(raw["toast-shadow"]), radius: mt.value("r-box"))
        let type = NativeType(ShiziTokens.lengths(mt.category)?.mapValues { NSNumber(value: Double($0)) } ?? [:])
        let bar = NativeUndoBarView(style: style, type: type)
        bar.strings = .init(text: u.text.text, undo: m.undo.undo.text, failed: m.undo.failed.text, cancel: m.undo.cancel.text, retry: m.undo.retry.text)
        bar.onUndo = { [weak self] in self?.tapUndo() }
        bar.onCancelFail = { [weak self] in
            self?.stage?.engine.raw("home.undoLeaveCancel", [:]) { _ in }
            self?.endUndo()
        }
        bar.onHold = { [weak self] in self?.undoLife?.hold() }
        bar.onRelease = { [weak self] in self?.undoLife?.release() }
        if u.failed { bar.setFailed(true) }
        view.addSubview(bar)
        undoBar = bar
        let life = NativeUndoLifetime(ms: max(1, u.remainingMs)) { [weak self] in
            guard let self, self.undoBar?.isFailed != true else { return }
            self.stage?.engine.raw("home.undoLeaveCancel", [:]) { _ in }
            self.endUndo()
        }
        undoLife = life
        if !u.failed { life.start() }
        view.setNeedsLayout()
        NativeA11y.announce(u.text.text)
    }

    private func layoutUndo(W: CGFloat, innerW: CGFloat) {
        guard let bar = undoBar else { return }
        // 撤销条不盖主按钮（S4）：底边停在主按钮上方 8
        let h = bar.height(for: innerW)
        bar.frame = CGRect(x: (W - innerW) / 2, y: ctaButton.frame.minY - 8 - h, width: innerW, height: h)
    }

    private func tapUndo() {
        guard let engine = stage?.engine else { return }
        engine.raw("home.undoLeave", [:]) { [weak self] reply in
            guard let self else { return }
            if (reply["ok"] as? Bool) == true || ((reply["error"] as? [String: Any])?["kind"] as? String) == "stale" {
                self.endUndo() // 成功：页面推入写字页回到那个字
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
        let fade = ((ShiziTokens.motion["duration"] as? [String: Any])?["fade"] as? NSNumber)?.doubleValue ?? 150
        UIView.animate(withDuration: fade / 1000, delay: 0, options: [.curveLinear]) { bar.alpha = 0 } completion: { _ in bar.removeFromSuperview() }
    }

    // MARK: 动作

    /// 主按钮此刻在窗口里的矩形与字（D62：写字页 T-paper 的来源 = 原生主按钮的真实矩形）。
    private func source(_ b: UIButton, solid: Bool) -> [String: Any] {
        let r = b.convert(b.bounds, to: nil)
        let label = solid ? (b.title(for: .normal) ?? "") : ""
        return ["rect": ["x": r.minX, "y": r.minY, "w": r.width, "h": r.height], "label": label, "radius": b.layer.cornerRadius, "solid": solid]
    }

    private func sourceKey(_ source: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: source, options: [.sortedKeys]),
              let key = String(data: data, encoding: .utf8) else { return "" }
        return key
    }

    /// 排版 / 字变了：把主按钮此刻的位置与字报给页面（写字页返回时纸缩回这里）。
    private func reportSource() {
        guard let engine = stage?.engine, ctaButton.window != nil, !view.isHidden else { return }
        let s = source(ctaButton, solid: true)
        let key = sourceKey(s)
        if key != lastSource {
            lastSource = key
            engine.raw("home.source", ["key": "home-start", "rect": s["rect"] as Any, "label": s["label"] as Any]) { _ in }
        }
        // A / B 都暂停时的次入口也可能是纸展开来源；返回时用它当前的位置，消失后清掉旧矩形。
        let other = otherButton.isHidden ? nil : source(otherButton, solid: false)
        let otherKey = other.map { sourceKey($0) } ?? "hidden"
        if otherKey != lastOtherSource {
            lastOtherSource = otherKey
            var args: [String: Any] = ["key": "other-line"]
            if let other { args["rect"] = other["rect"]; args["label"] = other["label"] }
            engine.raw("home.source", args) { _ in }
        }
        let deferred = deferButton.isHidden ? nil : source(deferButton, solid: false)
        let deferredKey = deferred.map { sourceKey($0) } ?? "hidden"
        if deferredKey != lastDeferredSource {
            lastDeferredSource = deferredKey
            var args: [String: Any] = ["key": "home-capital-defer"]
            if let deferred { args["rect"] = deferred["rect"]; args["label"] = deferred["label"] }
            engine.raw("home.source", args) { _ in }
        }
    }

    private func tapCta() {
        if let retry = failedAction {
            retry()
            return
        }
        guard let m = model else { return }
        if m.cta.action == "switchLibrary" {
            yieldThen { $0.run("home.switchLibrary", [:]) }
            return
        }
        run("home.start", ["source": source(ctaButton, solid: true)])
    }

    private func tapOther() {
        run("home.resumeOther", ["source": source(otherButton, solid: false)])
    }

    private func tapDefer() {
        run("home.deferSpecial", ["source": source(deferButton, solid: false)])
    }

    /// 「自己选字」：查字弹层是原生的（B3.6，Screens/Query.swift）——网页 openPick 推入原生查字屏，盖在本页上面，本页不让开。
    private func tapPick() {
        guard let stage, stage.isTop(self) else { return }
        stage.engine.raw("home.pick", [:]) { _ in }
    }

    /// 要盖上网页页面 / 弹层的动作：截图先交给宿主层（stage.cover，解码好才回包），再做。
    private func yieldThen(_ go: @escaping (HomeScreen) -> Void) {
        guard let engine = stage?.engine else { return }
        let args = NativeStage.coverArgs(entryId: entryId)
        ShiziProbe.note("home:yield")
        engine.raw("stage.cover", args) { [weak self] _ in
            guard let self else { return }
            go(self)
        }
    }

    /// 写入动作：回包 ok → 什么都不说（页面导航 / 推 changed）；{ok:false} → 就地三段式，「再试一次」重跑同一个动作（网页 run / failed）。
    private func run(_ op: String, _ args: [String: Any]) {
        guard !busy, let engine = stage?.engine else { return }
        busy = true
        let again: () -> Void = { [weak self] in
            guard let self else { return }
            var a = args
            if a["source"] != nil {
                let button = op == "home.resumeOther" ? self.otherButton : op == "home.deferSpecial" ? self.deferButton : self.ctaButton
                a["source"] = self.source(button, solid: button === self.ctaButton)
            }
            self.run(op, a)
        }
        ShiziProbe.note("home:\(op)")
        engine.raw(op, args) { [weak self] reply in
            guard let self else { return }
            ShiziProbe.note("home:\(op) ok=\((reply["ok"] as? Bool) == true)")
            self.busy = false
            let ok = (reply["ok"] as? Bool) == true
            let was = self.failedAction != nil
            self.failedAction = ok ? nil : again
            if !ok { NativeA11y.announce(self.model?.fail.text.text) }
            if was || !ok {
                self.markStateChange()
                if let m = self.model { self.renderModel(m) }
            }
        }
    }

    private func cancelFail() {
        failedAction = nil
        markStateChange()
        if let m = model { renderModel(m) }
    }

    // MARK: 品牌时刻（首次打开 ≤ 1.2s：题跋逐字淡入 → 印落下；主按钮与说明句不参与、第一帧起可点；点任意处立即静帧）

    private func motionMs(_ group: String, _ key: String) -> Double {
        ((ShiziTokens.motion[group] as? [String: Any])?[key] as? NSNumber)?.doubleValue ?? 0
    }

    private func startBrand() {
        Self.brandPlayed = true
        brandPlaying = true
        let total = motionMs("moment", "resultMax"), sealDrop = motionMs("moment", "sealDrop")
        let xs = motionMs("duration", "xs"), fade = motionMs("duration", "fade")
        let sealDelay = total - sealDrop
        let stagger = min(motionMs("moment", "workStagger"), floor((sealDelay - xs - fade) / 16))
        for (i, c) in mottoChars.enumerated() {
            c.alpha = 0
            UIView.animate(withDuration: fade / 1000, delay: (xs + Double(i) * stagger) / 1000, options: [.curveEaseOut, .allowUserInteraction]) { c.alpha = 1 }
        }
        sealView.alpha = 0
        let scaleFrom = ((ShiziTokens.motion["scale"] as? [String: Any])?["sealFrom"] as? NSNumber).map { CGFloat($0.doubleValue) } ?? 1.25
        sealView.transform = CGAffineTransform(scaleX: scaleFrom, y: scaleFrom)
        UIView.animateKeyframes(withDuration: sealDrop / 1000, delay: sealDelay / 1000, options: [.allowUserInteraction]) {
            UIView.addKeyframe(withRelativeStartTime: 0, relativeDuration: 0.6) {
                self.sealView.alpha = 1
                self.sealView.transform = CGAffineTransform(scaleX: 0.92, y: 0.92)
            }
            UIView.addKeyframe(withRelativeStartTime: 0.6, relativeDuration: 0.4) { self.sealView.transform = .identity }
        } completion: { [weak self] _ in self?.stopBrand() }
        let tap = UITapGestureRecognizer(target: self, action: #selector(brandTapped))
        tap.cancelsTouchesInView = false
        view.addGestureRecognizer(tap)
        brandTap = tap
    }

    @objc private func brandTapped() { stopBrand() }

    private func stopBrand() {
        guard brandPlaying else { return }
        brandPlaying = false
        for v in mottoChars as [UIView] + [sealView] {
            v.layer.removeAllAnimations()
            v.alpha = 1
            v.transform = .identity
        }
        if let tap = brandTap { view.removeGestureRecognizer(tap) }
        brandTap = nil
    }

    // MARK: QA

    var rootProbe: [String: Any] {
        let f = ctaButton.frame
        return ["view": model?.view ?? "", "cta": ctaButton.title(for: .normal) ?? "", "ctaId": ctaButton.accessibilityIdentifier ?? "",
                "ctaFrame": [f.minX, f.minY, f.width, f.height], "failed": failedAction != nil, "undoBar": undoBar != nil,
                "undoFailed": undoBar?.isFailed == true, "brand": brandPlaying, "epigraphHidden": hideEpigraph, "shi": shiView.frame.width,
                "source": lastSource]
    }
}
