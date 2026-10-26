import UIKit

// 我的子页（练习记录 / 月字帖 / 年报）共用的东西（B3.9；计划 §3.2 ShiziKit 组件 + §3.4 视图模型）。
//
//   ShiziInkBox / ShiziInkPoint  视图模型里的本人墨（点列；345 单位，与网页 core/ink-math 同一坐标系）。
//   ShiziPointsInkView           画本人墨（点列 → 三角形带 + 圆端；ShiziKit 的 WebInk 画法，与写字页同一套）。
//   ShiziPaperCell               月字帖 / 年报的一格（本人墨或衬底参考字；格内左上角的日期角标骑在上边线上）。
//   ShiziDayCell                 练习记录「那天写的字」的一格（本人墨铺满格；没墨画衬底 + 「没有笔迹」）。
//   ShiziSheetGrid / ShiziSheetPaper  字帖的格几何与纸（格线 + 外框 + 格子 + 落款 + 印）。
//   ShiziFlex                    网页 flex 排版的几件小工具（基线对齐的一行、行盒的高度、盒子的量法）。
//
// 版式数值一律取自网页（core/images/layout.js sheetGrid、components/work.js、components/marks.js），
// 颜色 / 字号取 ShiziTokens，文案取 ShiziCopy；本文件不写数值与汉字。

// MARK: - 视图模型里的墨

/// 一笔墨的一个点（网页 ink-math 的点列：x / y / 绝对笔宽 w / 时刻 t / 压力 p）。
struct ShiziInkPoint: Decodable {
    let x: Double
    let y: Double
    let w: Double?
    let t: Double?
    let p: Double?
}

/// 一格里的本人墨（几笔点列）。
struct ShiziInkBox: Decodable {
    let points: [[ShiziInkPoint]]
}

/// 笔宽下限（core/images/layout.js MIN_INK_PT）与默认笔宽（INK_BASE_WIDTH）；格宽 pt。
enum ShiziInkScale {
    static let grid: Double = 345
    static let base: Double = 11.5
    static let minPt: Double = 1.2

    /// 小格把线宽抬到最小物理线宽（网页 minInkScale）。innerRatio = 墨占方框的比例（1 = 铺满；0.76 = 作品格 12% 内边）。
    static func scale(_ boxPt: CGFloat, _ innerRatio: CGFloat = 1) -> Double {
        guard boxPt > 0 else { return 1 }
        let physical = (base * Double(boxPt) * Double(innerRatio)) / grid
        return physical >= minPt ? 1 : minPt / physical
    }
}

// MARK: - 画本人墨

/// 一块只读的墨（点列；345 单位 → 视图的方框）。几何与网页 ui/canvas/brush.js paintBrushStroke 一样：
/// 起点圆 + 每段「两点间四边形色带」；用 ShiziKit 的 WebInk 三角形（同一套算法，与写字页一致）。
final class ShiziPointsInkView: UIView {
    var points: [[ShiziInkPoint]] = [] { didSet { setNeedsDisplay() } }
    var inkColor: UIColor = .black { didSet { setNeedsDisplay() } }
    /// 线宽倍数（网页 minInkScale 的 widthScale）。
    var widthScale: Double = 1 { didSet { setNeedsDisplay() } }
    /// 墨在格内的内边比例（网页 core/images/layout.js INK_PAD：作品格 12%、年报月段 9%；0 = 铺满格，练习记录的小卡）。
    var pad: CGFloat = 0 { didSet { setNeedsDisplay() } }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        isUserInteractionEnabled = false
        isAccessibilityElement = false
        contentMode = .redraw
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func draw(_ rect: CGRect) {
        guard !points.isEmpty, bounds.width > 0 else { return }
        let ox = bounds.width * pad
        let inner = bounds.width * (1 - 2 * pad)
        guard inner > 0 else { return }
        let k = Double(inner) / ShiziInkScale.grid
        var verts: [Float] = []
        for stroke in points {
            let wp = stroke.compactMap { p -> WebInkPoint? in
                guard p.x.isFinite, p.y.isFinite else { return nil }
                let w = (p.w ?? ShiziInkScale.base) * widthScale
                return WebInkPoint(x: p.x, y: p.y, w: w, t: p.t ?? 0, p: p.p)
            }
            guard !wp.isEmpty else { continue }
            WebInk.triangles(wp, into: &verts)
        }
        guard verts.count >= 6, let ctx = UIGraphicsGetCurrentContext() else { return }
        let path = CGMutablePath()
        var i = 0
        while i + 5 < verts.count {
            let x0 = ox + CGFloat(verts[i]) * k
            let y0 = CGFloat(verts[i + 1]) * k
            let x1 = ox + CGFloat(verts[i + 2]) * k
            let y1 = CGFloat(verts[i + 3]) * k
            let x2 = ox + CGFloat(verts[i + 4]) * k
            let y2 = CGFloat(verts[i + 5]) * k
            path.move(to: CGPoint(x: x0, y: y0))
            path.addLine(to: CGPoint(x: x1, y: y1))
            path.addLine(to: CGPoint(x: x2, y: y2))
            path.closeSubpath()
            i += 6
        }
        ctx.addPath(path)
        inkColor.setFill()
        ctx.fillPath()
    }
}

// MARK: - 我的子页的线形图标

/// 网页 ui/components/icons.js 的 prev / next（18 栅格、视觉 18、线宽 1.5、圆端圆角）：
/// 带杆的日历翻页箭头（不与页头返回的「‹」同形）。
enum ShiziMineIcon {
    case prev, next

    func image(_ color: UIColor, size: CGFloat = 18) -> UIImage {
        let fmt = UIGraphicsImageRendererFormat.preferred()
        fmt.opaque = false
        return UIGraphicsImageRenderer(size: CGSize(width: size, height: size), format: fmt).image { _ in
            let p = UIBezierPath()
            switch self {
            case .prev:
                p.move(to: CGPoint(x: 14.5, y: 9)); p.addLine(to: CGPoint(x: 3.5, y: 9))
                p.move(to: CGPoint(x: 7.5, y: 5)); p.addLine(to: CGPoint(x: 3.5, y: 9)); p.addLine(to: CGPoint(x: 7.5, y: 13))
            case .next:
                p.move(to: CGPoint(x: 3.5, y: 9)); p.addLine(to: CGPoint(x: 14.5, y: 9))
                p.move(to: CGPoint(x: 10.5, y: 5)); p.addLine(to: CGPoint(x: 14.5, y: 9)); p.addLine(to: CGPoint(x: 10.5, y: 13))
            }
            p.lineWidth = 1.5
            p.lineCapStyle = .round
            p.lineJoinStyle = .round
            color.setStroke()
            p.stroke()
        }.withRenderingMode(.alwaysOriginal)
    }
}

// MARK: - AX 档的页头

extension ShiziScreenViewController {
    /// AX 档页头第一行的高（网页 components/ax.js：`.sz-btn--text{min-height:max(44px, calc(1.3em + 12px))}`）。
    /// 尾端有文字按钮的页（年报 / 月字帖的「调整图片 ›」）第一行被那个按钮撑高。
    func axHeaderRowHeight() -> CGFloat {
        max(ShiziPageHeader.height, 1.3 * metrics.value("fs15") + 12)
    }

    /// AX 档：把原生通用页头（只有一行 44）改成网页的两行版式（components/ax.js：页头折行，标题独占第二行）。
    ///
    /// 网页：页头第一行 = 「‹」+ 尾端文字按钮（行高 = 那个按钮的高），第二行 = 页标题（h1 独占一行）。
    /// 原生通用页头把标题放在第一行中间、页头固定 44，这里按网页重排：返回键在第一行里居中、
    /// 标题文字落到网页的位置、正文从网页的页头底开始。
    /// - Parameters:
    ///   - row1: 第一行的高（网页尾端文字按钮的高；没有尾端按钮 = 44）。
    ///   - titleRow: 第二行（标题行）占的高 = 网页 h1 的盒高 + 外边距。
    ///   - titleTextTop: 标题**文字**的上缘（网页 h1 的盒顶 − 1：字在行盒里偏上）。
    ///   - titleTextX: 标题文字的左缘（网页 h1 的外边距 + 内边距）。
    func applyAxHeader(row1: CGFloat, titleRow: CGFloat, titleTextTop: CGFloat, titleTextX: CGFloat) {
        guard axLayout else { return }
        let safeTop = view.safeAreaInsets.top
        // 第一行：返回键在行里居中（网页 align-items:center）
        backButton.frame.origin.y = safeTop + (row1 - ShiziPageHeader.height) / 2
        // 第二行：标题文字（原生这边文字框在标签框里居中，要按标签框高与字的内容高反推标签框的顶）
        let l = titleLabel
        let contentH = l.font.ascender - l.font.descender
        l.frame.origin.x = titleTextX
        l.frame.origin.y = titleTextTop - (l.frame.height - contentH) / 2
        // 正文从页头底开始（网页 .sz-page__body 的上内边距 s4 由 layoutBody 给）
        let headBottom = safeTop + row1 + titleRow
        let delta = headBottom - scroll.frame.minY
        scroll.frame.origin.y = headBottom
        scroll.frame.size.height = max(0, scroll.frame.height - delta)
    }
}

// MARK: - 网页量出的折行点

/// 网页的折行点（B3.9；同 B2.7 结果页的 webLineStarts 做法）：网页这几个段落是 text-wrap: pretty
/// （WebKit 按整段平衡折行），原生排版算法不同、自己折出来的行不一样（例：AX3 的图例网页在第 8 字后折行、
/// 原生在第 10 字后）。网页界面层量出每一行从第几个字开始（src/core/line-starts.js 的登记口 → 视图模型的 lines），
/// 原生按这些位置换行（字的样子仍由原生排）。
enum ShiziMineLines {
    /// 按折行点把一段字断成几行（在断点处插换行）。
    /// - Parameters:
    ///   - text: 原的字。
    ///   - starts: 网页每一行从第几个字开始（空 / nil = 没有断点，按原样）。
    static func broken(_ text: String, _ starts: [Int]?) -> String {
        guard let starts, !starts.isEmpty else { return text }
        let chars = Array(text)
        var out = ""
        var prev = 0
        for s in starts.sorted() where s > prev && s < chars.count {
            out += String(chars[prev..<s]) + "\n"
            prev = s
        }
        out += String(chars[prev...])
        return out
    }
}

// MARK: - 右端带图标的按钮

/// 量一段字的显示宽：**与网页（WebKit）同口径**。
///
/// 网页排字按字体自带的原始 advance 排（不加 GPOS 字距、也不替换 GSUB 的字形变体）。
/// 原生 Foundation 的 `NSString.size(withAttributes:)` / `NSAttributedString.size()` 走的是另一条路径：
/// 宋体（ShiziSerifSC）的数字被换成等宽变体（"10" 的 "1" 从 0.469em 变成 0.561em），整段宽 2–3pt，与网页对不上；
/// 而 UILabel 的 `textRect` 走的是原始 advance，与网页一致（QA 取证量的也是 textRect，两边同口径）。
/// **不能用 `sizeThatFits`**：它对数字会用等宽变体（"10月" 宽 102 而网页是 97.7）。
enum ShiziMineText {
    /// 一段字（给定字体）的显示宽（原始 advance 之和，与网页同口径）。
    static func width(_ s: String, font: UIFont) -> CGFloat {
        // .kern 0 与网页一致：不加字体自带的字距（宋体的数字在原生这边会被换成等宽变体）
        width(NSAttributedString(string: s, attributes: [.font: font, .kern: 0]))
    }

    /// 一段富文本的显示宽（原始 advance 之和，与网页同口径）。
    static func width(_ attr: NSAttributedString) -> CGFloat {
        guard attr.length > 0 else { return 0 }
        let l = UILabel(frame: CGRect(x: 0, y: 0, width: 100_000, height: 100_000))
        l.attributedText = attr
        l.numberOfLines = 1
        l.lineBreakMode = .byClipping
        return l.textRect(forBounds: l.bounds, limitedToNumberOfLines: 1).width
    }
}

/// 字在左、行尾一个图标（网页 .sz-rec__open：min-height 44、inline-flex、字与图标之间 8）。
final class ShiziTrailIconButton: UIButton {
    /// 图标的尺寸（网页 .sz-chev：8 × 13）。
    var iconSize: CGSize = .zero

    override func imageRect(forContentRect r: CGRect) -> CGRect {
        guard iconSize.width > 0 else { return super.imageRect(forContentRect: r) }
        return CGRect(x: r.maxX - iconSize.width, y: (r.height - iconSize.height) / 2, width: iconSize.width, height: iconSize.height)
    }

    /// 标题的字体（titleRect 里不能碰 titleLabel：取它会回调 titleRect，递归到爆栈）。
    var titleFont: UIFont = UIFont.systemFont(ofSize: 15)

    override func titleRect(forContentRect r: CGRect) -> CGRect {
        guard iconSize.width > 0 else { return super.titleRect(forContentRect: r) }
        // 只用富文本标题 / 普通标题与记下的字体，不访问 titleLabel（会重入布局）
        let a = attributedTitle(for: .normal)
        let font = (a?.attribute(.font, at: 0, effectiveRange: nil) as? UIFont) ?? titleFont
        // 富文本标题按原始 advance 量（与网页同口径）
        let w: CGFloat
        if let a, a.length > 0 {
            w = ceil(ShiziMineText.width(a))
        } else {
            w = (title(for: .normal) as NSString?)?.size(withAttributes: [.font: font]).width ?? 0
        }
        return CGRect(x: 0, y: (r.height - font.lineHeight) / 2, width: w, height: font.lineHeight)
    }
}

// MARK: - 网页 flex 排版的小工具

/// 网页 flex 的一行：基线对齐（align-items: baseline）时各项的顶与整行的高。
///
/// 网页的基线 = 行盒里的基线 = 半行距 + 字体的升部（半行距 = (行高 − 字的内容高) ÷ 2）。
/// 原生用同一套字（宋 = 包里的 ShiziSerifSC，黑 = 系统字），度量一致，所以这里量出来的位置与网页相同。
enum ShiziFlex {
    /// 一个文字项在行盒里的基线位置（相对盒顶）与盒高。
    struct Item {
        let top: CGFloat
        let height: CGFloat
        let baseline: CGFloat
    }

    /// 行盒里的文字项（行高 = 网页的 line-height；字的内容高 = 字体的升部 + 降部）。
    static func text(_ font: UIFont, line: CGFloat) -> (ascent: CGFloat, descent: CGFloat) {
        let content = font.ascender - font.descender
        let half = (line - content) / 2
        return (half + font.ascender, half - font.descender)
    }

    /// 基线对齐的一行：各项的顶（相对行顶）与整行的高。
    /// - Parameters items: 每项 = (行盒高, 基线在盒内的位置)。
    static func baselineRow(_ items: [(box: CGFloat, ascent: CGFloat)]) -> (tops: [CGFloat], height: CGFloat) {
        guard !items.isEmpty else { return ([], 0) }
        let maxAscent = items.map { $0.ascent }.max() ?? 0
        let tops = items.map { maxAscent - $0.ascent }
        var bottom: CGFloat = 0
        for (i, item) in items.enumerated() {
            bottom = max(bottom, tops[i] + item.box)
        }
        let top = tops.min() ?? 0
        return (tops, bottom - top)
    }
}

// MARK: - 等宽数字

/// 网页 .sz-mcell__tag / .sz-scell__tag 的字号（11px：固定，不随字号放大；网页 components/work.js 的 MONTH_PAPER_TAG_CSS）。
enum ShiziMineTag {
    static let fontSize: CGFloat = 11
}

/// 等宽数字（网页 font-variant-numeric: tabular-nums：年份 / 月历的日号 / 格上的日期角标 / 月段的字数）。
/// 网页的数字是等宽的（同一列的数字一样宽），原生的系统字体默认是比例数字，这里把 tnum 特性打开。
enum ShiziFont {
    static func tabular(_ font: UIFont) -> UIFont {
        let features: [[CFString: Any]] = [[
            kCTFontFeatureTypeIdentifierKey: kNumberSpacingType,
            kCTFontFeatureSelectorIdentifierKey: kMonospacedNumbersSelector
        ]]
        let desc = CTFontDescriptorCreateCopyWithAttributes(font.fontDescriptor as CTFontDescriptor,
                                                          [kCTFontFeatureSettingsAttribute: features as CFArray] as CFDictionary)
        return CTFontCreateWithFontDescriptor(desc, font.pointSize, nil) as UIFont
    }
}

// MARK: - 格子

/// 标题摆在按钮里的指定位置（网页 .sz-btn 里自己排版的行按钮：文字在上、热区更高）。
final class ShiziPlacedTitleButton: UIButton {
    /// 标题的框（按钮的坐标；原点在左上角）。
    var placedTitleFrame: CGRect = .zero
    override func titleRect(forContentRect r: CGRect) -> CGRect { placedTitleFrame }
}

/// 月字帖 / 年报的一格：本人墨（格内 12% 内边）或衬底参考字（标准字轮廓）；日期角标骑在格的上边线上。
///
/// 网页上这一格是按钮（.sz-mcell），日期角标是按钮里的一个 span（.sz-mcell__tag：11pt / 500 / ink3、
/// 骑在格的上边线上、等宽数字；网页里这一段不随字号放大）。原生把格做成 UIControl（点按与读屏都是按钮），
/// 角标用一个标签画：标签的 font 属性记按钮的字号（取证时按钮按这个算），
/// 标签里的字按角标的字号排（网页角标那一段）——两处分别对上网页。
final class ShiziPaperCell: UIControl {
    /// 日期角标（网页 .sz-mcell__tag）。
    let tagLabel = UILabel()
    let inkView = ShiziPointsInkView()
    let glyphView = NativeGlyphView()
    private var tagColor: UIColor = .label
    private var tagFont: UIFont = .systemFont(ofSize: 11)
    private var paperColor: UIColor = .clear
    /// 网页上格子的内边比例（作品格 12%；年报月段 9%）。
    var inkPad: CGFloat = 0.12 { didSet { setNeedsLayout() } }
    /// 角标的字（空 = 不画；取证时整格按按钮算）。
    var tagText: String = "" { didSet { applyTag() } }

    init(char: String, mode: String, ink: ShiziInkBox?) {
        super.init(frame: .zero)
        for v in [inkView, glyphView] as [UIView] {
            v.isUserInteractionEnabled = false
            addSubview(v)
        }
        tagLabel.isAccessibilityElement = false
        tagLabel.textAlignment = .left
        addSubview(tagLabel)
        glyphView.padRatio = 0.06
        configure(char: char, mode: mode, ink: ink)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(char: String, mode: String, ink: ShiziInkBox?) {
        if mode == "hand", let ink {
            inkView.points = ink.points
            inkView.isHidden = false
            glyphView.isHidden = true
        } else {
            inkView.points = []
            inkView.isHidden = true
            glyphView.isHidden = false
            glyphView.char = char
        }
        setNeedsLayout()
    }

    func style(ink: UIColor, under: UIColor, tag: UIColor, tagFont: UIFont, paper: UIColor) {
        inkView.inkColor = ink
        glyphView.color = under
        tagColor = tag
        self.tagFont = tagFont
        paperColor = paper
        applyTag()
        setNeedsLayout()
    }

    /// 按钮自己的字与色（网页 .sz-mcell：字与色继承按钮的，取证按按钮算）。
    func styleButton(font: UIFont, color: UIColor) {
        tagLabel.font = font
        tagLabel.textColor = color
    }

    private func applyTag() {
        let text = tagText
        guard !text.isEmpty else {
            tagLabel.attributedText = nil
            tagLabel.text = ""
            setNeedsLayout()
            return
        }
        // 行盒钉在角标这一段的行高（网页 .sz-mcell__tag 的 line-height 13px）
        let p = NSMutableParagraphStyle()
        p.minimumLineHeight = tagFont.lineHeight
        p.maximumLineHeight = tagFont.lineHeight
        tagLabel.attributedText = NSAttributedString(string: text, attributes: [
            .font: tagFont, .foregroundColor: tagColor, .kern: 0, .paragraphStyle: p
        ])
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let s = bounds.width
        let pad = s * inkPad
        let inner = s - 2 * pad
        inkView.frame = CGRect(x: pad, y: pad, width: inner, height: inner)
        inkView.widthScale = ShiziInkScale.scale(inner, 1 - 2 * inkPad)
        glyphView.frame = inkView.frame
        if tagText.isEmpty {
            // 没有角标时，整格就是取证的那一个（网页的格按钮此时没有字）
            tagLabel.frame = bounds
        } else {
            // 角标：骑在格的上边线上（网页 .sz-mcell__tag：left 3、top −7、内边 0 2）
            let size = tagLabel.attributedText?.size() ?? .zero
            tagLabel.frame = CGRect(x: 5, y: -8, width: ceil(size.width), height: ceil(size.height))
        }
        // 网页的角标没有底色（格线从它下面透出来）
        tagLabel.backgroundColor = .clear
    }
}

/// 月历里的一天（网页 .sz-rec__day）：44 高的按钮，上面的 30 × 30 圆里是日号，下面 3pt 处一个 5pt 的墨点。
///
/// 网页有记录的那天是按钮（.sz-rec__day.sz-btn）、日号是按钮里的一个 span（.sz-rec__num）；
/// 原生把日号放在按钮的标题里，标题摆在 30 × 30 的圆里（网页 .sz-rec__num 的位置）。
final class ShiziDayButton: UIButton {
    /// 墨点（网页 .sz-rec__dot：5 × 5 的圆）。
    let dot = UIView()
    /// 日号所在的 30 × 30 的圆（按钮的坐标；网页 .sz-rec__num）。
    var numBox = CGRect(x: 0, y: 0, width: 30, height: 30)

    override init(frame: CGRect) {
        super.init(frame: frame)
        dot.isUserInteractionEnabled = false
        dot.layer.cornerRadius = 2.5
        insertSubview(dot, at: 0)
        titleLabel?.textAlignment = .center
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func titleRect(forContentRect r: CGRect) -> CGRect { numBox }

    override func layoutSubviews() {
        // 日号所在的 30 × 30 的圆（网页 .sz-rec__num）：在 50 宽的格里居中
        numBox = CGRect(x: (bounds.width - 30) / 2, y: 0, width: 30, height: 30)
        dot.frame = CGRect(x: (bounds.width - 5) / 2, y: numBox.maxY + 3, width: 5, height: 5)
        super.layoutSubviews()
    }
}

/// 练习记录「那天写的字」的一格：本人墨铺满整格（网页 InkMini）；没墨画衬底参考字（格宽的 40%，中线在 42%）+「没有笔迹」。
final class ShiziDayCell: UIButton {
    let inkView = ShiziPointsInkView()
    let glyphView = NativeGlyphView()
    private let noInkLabel = UILabel()
    private var underColor: UIColor = .label
    private var inkColor: UIColor = .black
    private var noInkColor: UIColor = .label

    init(char: String, mode: String, ink: ShiziInkBox?, noInkText: String) {
        super.init(frame: .zero)
        titleLabel?.isHidden = true
        for v in [inkView, glyphView, noInkLabel] as [UIView] {
            v.isUserInteractionEnabled = false
            addSubview(v)
        }
        noInkLabel.isAccessibilityElement = false
        noInkLabel.textAlignment = .center
        noInkLabel.text = noInkText
        glyphView.padRatio = 0.06
        configure(char: char, mode: mode, ink: ink)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(char: String, mode: String, ink: ShiziInkBox?) {
        if mode == "hand", let ink {
            inkView.points = ink.points
            inkView.isHidden = false
            glyphView.isHidden = true
            noInkLabel.isHidden = true
        } else {
            inkView.points = []
            inkView.isHidden = true
            glyphView.isHidden = false
            glyphView.char = char
            noInkLabel.isHidden = false
        }
        setNeedsLayout()
    }

    func style(ink: UIColor, under: UIColor, noInk: UIColor, font: UIFont) {
        inkColor = ink
        underColor = under
        noInkColor = noInk
        inkView.inkColor = ink
        glyphView.color = under
        noInkLabel.textColor = noInk
        noInkLabel.font = font
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let s = bounds.width
        inkView.frame = bounds
        inkView.widthScale = ShiziInkScale.scale(s, 1)
        // 衬底字：格宽的 40%，水平居中、竖向中线在 42%（网页 .sz-scell__glyph）
        let side = s * 0.4
        glyphView.frame = CGRect(x: (s - side) / 2, y: s * 0.42 - side / 2, width: side, height: side)
        noInkLabel.frame = CGRect(x: 0, y: s * 0.8 - noInkLabel.font.lineHeight / 2, width: s, height: noInkLabel.font.lineHeight)
    }
}

// MARK: - 字帖的纸

/// 字帖格的几何（网页 core/images/layout.js sheetGrid：列数规则 + 格宽）。
struct ShiziSheetGrid {
    let n: Int
    let cols: Int
    let rows: Int
    let c: CGFloat
    let W: CGFloat
    let H: CGFloat
    let lastW: CGFloat
    let full: Bool
    let cells: [CGPoint]

    /// 字数 → 列数（网页 sheetColumns）。
    static func columns(_ n: Int) -> Int {
        if n < 1 { return 0 }
        if n <= 4 { return n }
        if n <= 12 { return 4 }
        if n <= 24 { return 6 }
        return 8
    }

    init(n: Int, width: CGFloat) {
        self.n = n
        let cols = ShiziSheetGrid.columns(n)
        let rows = n > 0 ? Int(ceil(Double(n) / Double(cols))) : 0
        var c: CGFloat = 0
        if n > 0 {
            c = floor(min(110, max(0, width) / CGFloat(cols)))
        }
        let lastN = n > 0 ? n - (rows - 1) * cols : 0
        self.cols = cols
        self.rows = rows
        self.c = c
        self.W = CGFloat(cols) * c
        self.H = CGFloat(rows) * c
        self.lastW = CGFloat(lastN) * c
        self.full = n > 0 && lastN == cols
        var out: [CGPoint] = []
        if n > 0 {
            for i in 0..<n {
                out.append(CGPoint(x: CGFloat(i % cols) * c, y: CGFloat(i / cols) * c))
            }
        }
        self.cells = out
    }
}

/// 字帖的纸：一层框 + 格间线 + 格子 + 落款 + 印（网页 components/work.js MonthPaper）。
/// 格子由页面持有（这里只排位置），纸与格线由本视图画。
final class ShiziSheetPaper: UIView {
    /// 落款行（网页 .sz-month__sign）。
    let sign = UIView()
    let kuanLabel = UILabel()
    let sealView = NativeSealView()
    /// 格子（页面按模型顺序给；这里只排位置）。
    var cells: [ShiziPaperCell] = [] { didSet { setNeedsLayout() } }
    private var grid = ShiziSheetGrid(n: 0, width: 0)
    private var frameColor: UIColor = .label
    private var guideColor: UIColor = .label
    private var guideWidth: CGFloat = 1
    private var frameWidth: CGFloat = 1
    private var sealPath: [[Any]] = []
    private var sealFill: UIColor = .label
    private var sealGlyph: UIColor = .label
    private var kuanFont: UIFont = .systemFont(ofSize: 13)

    override init(frame: CGRect) {
        super.init(frame: frame)
        sign.isUserInteractionEnabled = false
        addSubview(sign)
        kuanLabel.isAccessibilityElement = false
        sign.addSubview(kuanLabel)
        // 印：末行满时在落款后面，否则在末格右侧（网页 .sz-month__seal 的两种位置）
        addSubview(sealView)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(kuan: String, sealPath path: [[Any]]) {
        kuanLabel.text = kuan
        sealPath = path
        sealView.configure(path: path, fill: sealFill, glyph: sealGlyph)
        sealView.isHidden = path.isEmpty
        setNeedsLayout()
    }

    /// 格几何（格宽要等排版时才知道页面有多宽，所以排版时再给）。
    func setGrid(_ newGrid: ShiziSheetGrid) {
        guard newGrid.n != grid.n || newGrid.c != grid.c || newGrid.W != grid.W || newGrid.H != grid.H else { return }
        grid = newGrid
        setNeedsLayout()
        setNeedsDisplay()
    }

    func style(sheet: UIColor, frame: UIColor, guide: UIColor, guideWidth gw: CGFloat, frameWidth fw: CGFloat,
               kuanColor: UIColor, kuanFont: UIFont, sealFill fill: UIColor, sealGlyph glyphColor: UIColor) {
        frameColor = frame
        guideColor = guide
        guideWidth = gw
        frameWidth = fw
        self.kuanFont = kuanFont
        kuanLabel.textColor = kuanColor
        kuanLabel.font = kuanFont
        sealFill = fill
        sealGlyph = glyphColor
        sealView.configure(path: sealPath, fill: fill, glyph: glyphColor)
        setNeedsLayout()
        setNeedsDisplay()
    }

    /// 纸的高 = 格区高 + 落款行（网页 .sz-month：stage 上外边距 8 + 落款上外边距 10 + 落款行高 20）。
    static func height(for grid: ShiziSheetGrid) -> CGFloat {
        guard grid.n > 0 else { return 0 }
        return 8 + grid.H + 10 + 20
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let g = grid
        let stageTop: CGFloat = 8
        sign.frame = CGRect(x: 0, y: stageTop + g.H + 10, width: g.W, height: 20)
        // 落款右对齐；末字在最右列时印跟在落款后面
        let kuanW = ceil((kuanLabel.text as NSString?)?.size(withAttributes: [.font: kuanFont]).width ?? 0)
        let kuanX = g.full ? g.W - kuanW - 32 : g.W - kuanW
        kuanLabel.frame = CGRect(x: kuanX, y: 0, width: kuanW, height: 20)
        if g.full {
            sealView.frame = CGRect(x: kuanX + kuanW + 8, y: stageTop + g.H + 10 + (20 - 24) / 2, width: 24, height: 24)
        } else {
            sealView.frame = CGRect(x: g.lastW + 8, y: stageTop + g.H - 24, width: 24, height: 24)
        }
        for (i, c) in cells.enumerated() where i < g.cells.count {
            c.frame = CGRect(x: g.cells[i].x, y: stageTop + g.cells[i].y, width: g.c, height: g.c)
        }
    }

    override func draw(_ rect: CGRect) {
        super.draw(rect)
        let g = grid
        guard g.n > 0 else { return }
        guard let ctx = UIGraphicsGetCurrentContext() else { return }
        let stageTop: CGFloat = 8
        let cell: CGFloat = g.c
        let rows: Int = g.rows
        let cols: Int = g.cols
        // 格间线（guide）：竖线在每行内，横线在行之间
        ctx.saveGState()
        guideColor.setStroke()
        ctx.setLineWidth(guideWidth)
        for r in 0..<rows {
            let rn: Int = r < rows - 1 ? cols : (g.full ? cols : Int((g.lastW / cell).rounded()))
            let y: CGFloat = stageTop + CGFloat(r) * cell
            if rn > 1 {
                for k in 1..<rn {
                    let x: CGFloat = CGFloat(k) * cell
                    ctx.move(to: CGPoint(x: x, y: y))
                    ctx.addLine(to: CGPoint(x: x, y: y + cell))
                }
            }
        }
        if rows > 1 {
            for r in 1..<rows {
                let y: CGFloat = stageTop + CGFloat(r) * cell
                let w: CGFloat = (r == rows - 1 && !g.full) ? g.lastW : g.W
                ctx.move(to: CGPoint(x: 0, y: y))
                ctx.addLine(to: CGPoint(x: w, y: y))
            }
        }
        ctx.strokePath()
        // 外框（frame）
        frameColor.setStroke()
        ctx.setLineWidth(frameWidth)
        let half: CGFloat = frameWidth / 2
        if g.full {
            let box = CGRect(x: half, y: stageTop + half, width: g.W - frameWidth, height: g.H - frameWidth)
            ctx.stroke(box)
        } else {
            let upper = CGRect(x: half, y: stageTop + half, width: g.W - frameWidth, height: (CGFloat(rows - 1) * cell) - frameWidth)
            ctx.stroke(upper)
            let lower = CGRect(x: half, y: stageTop + CGFloat(rows - 1) * cell + half, width: g.lastW - frameWidth, height: cell - frameWidth)
            ctx.stroke(lower)
        }
        ctx.restoreGState()
    }
}
