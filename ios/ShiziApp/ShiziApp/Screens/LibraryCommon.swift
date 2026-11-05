import CoreText
import UIKit

// B3.8 字库子页（原生）的共用件。
// 标准答案是原先的网页字库子页。
//
// 取证口径（App 内 NativeQAHarness）：
//   网页的行 / 格子是 <button>，取证脚本跳过按钮的子节点；原生这边同样把字放在按钮的子视图里（不单独成可取证元素），
//   按钮自己给「整块文字」（currentTitle）、颜色、字号、可点状态与图标框。
//   原生按钮不画文字（titleLabel 留空），所以原生没有文字框 → 对比按按钮外框比（网页那一侧有文字框时也落到按钮外框）。

/// 文案引用（{copy, params}）或纯字符串。
/// 网页的视图模型里两者都有：组名是文案引用，拼音组的组名是纯字母；「其余 N 个字」这类在没内容时是空串（网页 tRef 直接给空串）。
struct FlexText: Decodable {
    let text: String
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let r = try? c.decode(ShiziCopyRef.self) { text = r.text; return }
        text = try c.decode(String.self)
    }
}

/// 文字按钮（网页的 <button>：字在按钮的子节点里）。
/// composed = 这一块的全部文字（网页按钮的 innerText）；lineFont = 按钮自身的字号（网页按钮继承来的那一份）。
class ShiziLineButton: UIButton {
    /// 这一块的全部文字（网页按钮的 innerText）。
    var composed: String = "" {
        didSet {
            if accessibilityLabel != composed { accessibilityLabel = composed }
            setNeedsLayout()
        }
    }
    /// 按钮自身的字体（网页按钮元素继承来的字号 / 字重；取证按 titleLabel 的字号量）。
    var lineFont: UIFont?
    /// 图标尺寸（贴在哪一边由 imageRect 决定）。
    var iconSize: CGSize = .zero
    /// 图标贴左（清单行的标准字在左；墙格也是整格）。
    var iconAtLeading: Bool = false
    /// 图标贴顶（墙格：字形方块在格子上沿，拼音在下）。
    var iconAtTop: Bool = false
    /// 图标居中（清单行的勾：网页 .sz-lrow__dot 里 place-items:center）。
    var iconCentered: Bool = false

    override var currentTitle: String? { composed.isEmpty ? super.currentTitle : composed }

    /// 把 composed 画在按钮里（页头右槽 / 弹层「完成」/ 主按钮这类整块只有一段字的按钮）。
    /// 字画在一个不进取证的子标签里（取证不进按钮的子节点），按钮自己仍按 composed / lineFont 给文字与字号。
    var drawsComposed = false
    private let drawnLabel = UILabel()

    override func layoutSubviews() {
        super.layoutSubviews()
        if let f = lineFont { titleLabel?.font = f }
        guard drawsComposed else { drawnLabel.isHidden = true; return }
        if drawnLabel.superview == nil {
            drawnLabel.isUserInteractionEnabled = false
            drawnLabel.isAccessibilityElement = false
            drawnLabel.textAlignment = .center
            drawnLabel.numberOfLines = 0
            addSubview(drawnLabel)
        }
        drawnLabel.isHidden = false
        drawnLabel.text = composed
        drawnLabel.font = lineFont ?? titleLabel?.font ?? .systemFont(ofSize: 17)
        drawnLabel.textColor = titleColor(for: isEnabled ? .normal : .disabled) ?? titleColor(for: .normal)
        drawnLabel.frame = bounds
    }

    override func imageRect(forContentRect r: CGRect) -> CGRect {
        guard iconSize.width > 0 else { return .zero }
        if iconCentered {
            return CGRect(x: r.minX + (r.width - iconSize.width) / 2, y: r.minY + (r.height - iconSize.height) / 2,
                          width: iconSize.width, height: iconSize.height)
        }
        let x = iconAtLeading ? r.minX : r.maxX - iconSize.width
        let y = iconAtTop ? r.minY : (r.height - iconSize.height) / 2
        return CGRect(x: x, y: y, width: iconSize.width, height: iconSize.height)
    }
}

/// 主按钮（网页 .sz-btn--primary：btn-bg 底、btn-fg 字 17 / 500、圆角 r-ctl、满宽、最小高 btn-h）。
/// 禁用态（网页 .sz-btn--primary[disabled]）：field 底、ink4 字。
final class ShiziPrimaryButton: ShiziLineButton {
    override init(frame: CGRect) { super.init(frame: frame); drawsComposed = true }
    required init?(coder: NSCoder) { super.init(coder: coder); drawsComposed = true }

    func style(enabled: Bool, title: String, font: UIFont, radius: CGFloat, bg: UIColor, fg: UIColor, disabledBg: UIColor, disabledFg: UIColor) {
        composed = title
        lineFont = font
        setTitle("", for: .normal)
        setTitleColor(enabled ? fg : disabledFg, for: .normal)
        backgroundColor = enabled ? bg : disabledBg
        layer.cornerRadius = radius
        isEnabled = enabled
        accessibilityLabel = title
    }
}

/// 练习字字形（网页：hanzi-writer 轮廓，每笔一条路径，1024 单位、基线 900）。
/// face = 字面占格比例（墙 0.8 / 清单行 0.7 / 占满 1/1.1）；hollow = 双钩（描边不填，自选未写）。
/// 几何与网页同一个仿射：1024 方框占格 face × 1.1，居中。
enum LibraryGlyph {
    /// 一个字的轮廓图（网页 PracticeGlyph 的同一份数据；hollow = 只描边）。
    static func image(_ char: String, size: CGFloat, face: CGFloat, color: UIColor, hollow: Bool = false) -> UIImage? {
        guard size > 0, let glyph = NativeGlyphData.load(char) else { return nil }
        let fmt = UIGraphicsImageRendererFormat.preferred()
        fmt.opaque = false
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size), format: fmt)
        return renderer.image { ctx in
            let c = ctx.cgContext
            var t = NativeGlyphData.transform(size: size, padRatio: LibraryGlyph.padRatio(face))
            if hollow {
                c.setStrokeColor(color.cgColor)
                c.setLineWidth(1) // 网页 vector-effect: non-scaling-stroke（恒 1px）
                c.setLineJoin(.round)
                c.setLineCap(.round)
                for s in glyph.strokes { if let moved = s.copy(using: &t) { c.addPath(moved) } }
                c.strokePath()
            } else {
                c.setFillColor(color.cgColor)
                for s in glyph.strokes { if let moved = s.copy(using: &t) { c.addPath(moved) } }
                c.fillPath(using: .winding)
            }
        }.withRenderingMode(.alwaysOriginal)
    }

    /// 字面占格比例 → 内边比例（网页 glyphViewBox 的同一口径）。
    static func padRatio(_ face: CGFloat) -> CGFloat {
        let box = min(1.5, max(0.1, face * 1.1))
        return (1 - box) / 2
    }
}

/// 本人笔迹小图（网页的 InkMini：把本人的笔画画在一张方卡里）。
/// 点是书写格 345 单位空间里的 {x, y, w}（API 给的墨迹），按卡宽等比缩放。
final class LibraryInkView: UIView {
    struct Point: Decodable, Equatable { let x: Double; let y: Double; let w: Double? }

    /// 笔画或墨色真的变了才重画（draw 只读 strokes / ink / bounds；bounds 变由 contentMode = .redraw 重画，浅 / 深切换见 traitCollectionDidChange）。
    /// 同一份笔画再设一次（重拉视图、查字框打一个字）不再把每格墨迹整张重画；点的 == 按 Double 逐字段比（NaN 不等 → 照旧重画）。
    var strokes: [[Point]] = [] { didSet { if strokes != oldValue { setNeedsDisplay() } } }
    /// 墨色按对象同一比（动态色的 isEqual 不保证同一个提供者；同一个对象画出来必定相同）。
    var ink: UIColor = .label { didSet { if ink !== oldValue { setNeedsDisplay() } } }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        contentMode = .redraw
        isAccessibilityElement = false
        isUserInteractionEnabled = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// 浅 / 深等颜色外观变了：墨色（动态色）要按新外观重新解析。以前页面在外观变化时重设 strokes 就会重画；
    /// strokes 没变不再重画之后，这里自己补上（UIKit 本身也会给实现了 draw 的视图重画，多标一次无妨）。
    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        if traitCollection.hasDifferentColorAppearance(comparedTo: previous) { setNeedsDisplay() }
    }

    override func draw(_ rect: CGRect) {
        guard !strokes.isEmpty, let ctx = UIGraphicsGetCurrentContext() else { return }
        let side = min(bounds.width, bounds.height)
        let k = side / 345.0 // 网页 prepareCanvas：按书写格内部 345 单位画
        ctx.setStrokeColor(ink.cgColor)
        ctx.setLineCap(.round)
        ctx.setLineJoin(.round)
        for s in strokes where s.count > 1 {
            let w = s.compactMap { $0.w }.reduce(0, +) / Double(s.count)
            ctx.setLineWidth(max(0.5, CGFloat(w) * k))
            for (i, p) in s.enumerated() {
                let pt = CGPoint(x: CGFloat(p.x) * k, y: CGFloat(p.y) * k)
                if i == 0 { ctx.move(to: pt) } else { ctx.addLine(to: pt) }
            }
            ctx.strokePath()
        }
    }
}

/// 网页的线形图标（线宽 1.5、圆端圆角；本卡只用到勾与查找）。
enum LibraryIcon {
    /// 勾（14 栅格；清单选中圆里，纸色）。
    static func check(_ color: UIColor, size: CGFloat = 14) -> UIImage {
        stroke(color, size: size) { p in
            p.move(to: CGPoint(x: 3, y: 7.2))
            p.addLine(to: CGPoint(x: 5.6, y: 9.8))
            p.addLine(to: CGPoint(x: 11, y: 4.4))
        }
    }

    /// 查找（22 栅格，视觉 18；网页 search）。
    static func search(_ color: UIColor, size: CGFloat = 18) -> UIImage {
        let fmt = UIGraphicsImageRendererFormat.preferred()
        fmt.opaque = false
        return UIGraphicsImageRenderer(size: CGSize(width: size, height: size), format: fmt).image { _ in
            let k = size / 22
            let p = UIBezierPath()
            p.append(UIBezierPath(ovalIn: CGRect(x: 4 * k, y: 4 * k, width: 12 * k, height: 12 * k)))
            p.move(to: CGPoint(x: 14.5 * k, y: 14.5 * k))
            p.addLine(to: CGPoint(x: 18.5 * k, y: 18.5 * k))
            p.lineWidth = 1.5
            p.lineCapStyle = .round
            p.lineJoinStyle = .round
            color.setStroke()
            p.stroke()
        }.withRenderingMode(.alwaysOriginal)
    }

    private static func stroke(_ color: UIColor, size: CGFloat, _ body: (UIBezierPath) -> Void) -> UIImage {
        let fmt = UIGraphicsImageRendererFormat.preferred()
        fmt.opaque = false
        return UIGraphicsImageRenderer(size: CGSize(width: size, height: size), format: fmt).image { _ in
            let p = UIBezierPath()
            body(p)
            p.lineWidth = 1.5
            p.lineCapStyle = .round
            p.lineJoinStyle = .round
            color.setStroke()
            p.stroke()
        }.withRenderingMode(.alwaysOriginal)
    }
}

/// 查字框的提示字（网页 input 的 placeholder：网页那边不是独立的文字节点，原生这边也不做成 UILabel，取证时两边一致）。
final class LibraryPlaceholderView: UIView {
    var text: String = "" { didSet { setNeedsDisplay() } }
    var font: UIFont = .systemFont(ofSize: 17) { didSet { setNeedsDisplay() } }
    var ink: UIColor = .label { didSet { setNeedsDisplay() } }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        isUserInteractionEnabled = false
        contentMode = .redraw
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func draw(_ rect: CGRect) {
        guard !text.isEmpty else { return }
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: ink]
        let size = (text as NSString).size(withAttributes: attrs)
        (text as NSString).draw(at: CGPoint(x: 0, y: max(0, (rect.height - size.height) / 2)), withAttributes: attrs)
    }
}

/// 字库子页的共用底座：页头右槽（文字按钮）+ 底栏（网页的 .sz-page__foot）+ 三段式。
/// 三个子页各自直接继承 ShiziScreenViewController（原生屏与 Swift 类一一对应是全 App 的约定），共用的东西放这里、由屏幕持有。
/// 标题的横向位置随右槽宽度变（网页 .sz-page__title 在两端槽之间居中，右槽比 44 宽时标题跟着左移）。
final class LibraryScreenKit {
    /// 页头右槽的按钮（没有右槽的屏是 nil）。
    private(set) var trail: ShiziLineButton?
    /// AX 档右槽按钮的高（网页的 min-height；非 AX 档用页头名义高 44）。
    var trailHeight: CGFloat = 44
    /// 页头底（正文区上沿；AX 档页头折成两行，正文从第二行下面开始）。
    /// 正文按它算可用高（网页 .sz-page__body 的高度 = 屏高 − 页头高 − 底栏高）。
    private(set) var headerBottom: CGFloat = 0
    /// 底栏（网页 .sz-page__foot）。
    let foot = UIView()
    /// 三段式（网页 FailBlock layout=foot：说明（居中）→ 先不 X（文字按钮，左）→ 再试一次（满宽主键））。
    let failBox = UIView()
    let failNote = UILabel()
    let failCancel = ShiziLineButton(type: .custom)
    let failRetry = ShiziPrimaryButton(type: .custom)

    private weak var screen: ShiziScreenViewController?
    private var failText = ""
    private var failCancelText = ""

    // MARK: 装

    /// 建页头右槽的按钮：要在 super.viewDidLoad() 之前（基类在那时渲染视图，按钮还不存在文案就丢了）。
    func prepare(screen: ShiziScreenViewController, trailId: String?, onTrail: (() -> Void)?,
                 failIdPrefix: String, failText: String, failCancelText: String,
                 onFailCancel: @escaping () -> Void, onFailRetry: @escaping () -> Void) {
        self.screen = screen
        self.failText = failText
        self.failCancelText = failCancelText
        if let trailId {
            let b = ShiziLineButton(type: .custom)
            b.drawsComposed = true
            b.accessibilityIdentifier = trailId
            trail = b
            screen.wire(b) { _ in onTrail?() }
        }
        failCancel.drawsComposed = true
        failBox.accessibilityIdentifier = "\(failIdPrefix)-fail"
        failNote.accessibilityIdentifier = "\(failIdPrefix)-fail-note"
        failCancel.accessibilityIdentifier = "\(failIdPrefix)-fail-cancel"
        failRetry.accessibilityIdentifier = "\(failIdPrefix)-fail-retry"
        screen.wire(failCancel) { _ in onFailCancel() }
        screen.wire(failRetry) { _ in onFailRetry() }
    }

    /// 把底栏与右槽按钮加进视图树（在 super.viewDidLoad() 之后：底栏压在正文上）。
    func attach() {
        guard let screen else { return }
        if let trail { screen.view.addSubview(trail) }
        screen.view.addSubview(foot)
        foot.addSubview(failBox)
        for v in [failNote, failCancel, failRetry] as [UIView] { failBox.addSubview(v) }
    }

    // MARK: 三段式

    /// 三段式的样式（各屏文案不同）。
    func styleFail() {
        guard let screen else { return }
        let mt = screen.metrics
        failNote.numberOfLines = 0
        NativeType.set(failNote, failText, font: mt.font(15), color: screen.color("ink2"), align: .center, line: mt.line("lh15"))
        failCancel.composed = failCancelText
        failCancel.lineFont = mt.font(15)
        failCancel.setTitleColor(screen.color("ink2"), for: .normal)
        failRetry.style(enabled: true, title: screen.t("R-W16.retry"), font: mt.font(17, .medium), radius: mt.value("r-ctl"),
                        bg: screen.color("btn-bg"), fg: screen.color("btn-fg"), disabledBg: screen.color("field"), disabledFg: screen.color("ink4"))
    }

    /// 三段式在底栏里的排版（网页 FailBlock：说明 → 先不 X → 再试一次）。
    /// 底栏里的东西都用底栏自己的坐标（底栏贴在页面下沿，坐标都是相对底栏顶边）。
    @discardableResult
    func layoutFailBlock(x: CGFloat, width: CGFloat) -> CGFloat {
        guard let screen else { return 0 }
        let mt = screen.metrics
        let noteH = mt.line("lh15")
        let hit = mt.value("hit")
        let btnH = mt.value("btn-h")
        let top = mt.space(3) // 底栏的上内边距（网页 .sz-page__foot 的 padding s3）
        let cancelY = noteH + mt.space(1) + mt.space(2)
        let cw = max(0, LibraryCommon.textWidth(failCancelText, mt.font(15)) + 8)
        failNote.isHidden = false
        failCancel.isHidden = false
        failRetry.isHidden = false
        failBox.frame = CGRect(x: x, y: top, width: width, height: noteH + mt.space(1) + mt.space(2) + hit + mt.space(2) + btnH)
        failNote.frame = CGRect(x: 0, y: 0, width: width, height: noteH)
        failCancel.frame = CGRect(x: -4, y: cancelY, width: cw, height: hit)
        failRetry.frame = CGRect(x: 0, y: cancelY + hit + mt.space(2), width: width, height: btnH)
        return failBox.frame.height
    }

    // MARK: 排版

    /// 摆底栏（正文排版要用它的位置；网页 .sz-page__foot 贴在页面下沿）。
    func layoutFoot(hasFooter: Bool, contentHeight: CGFloat) {
        guard let screen else { return }
        let w = screen.view.bounds.width, h = screen.view.bounds.height
        let m = screen.metrics
        if hasFooter {
            let bottom = max(m.space(6), screen.view.safeAreaInsets.bottom)
            let fh = m.space(3) + contentHeight + bottom
            foot.frame = CGRect(x: 0, y: h - fh, width: w, height: fh)
            foot.backgroundColor = screen.color("paper")
            foot.isHidden = false
        } else {
            foot.frame = .zero
            foot.isHidden = true
        }
    }

    /// 页头：标题在两端槽之间居中（网页 .sz-page__title 的流：右槽宽 → 标题的可用区间跟着变）+ 右槽按钮的位置。
    /// AX 档：页头折成两行——第一行左槽（返回）与右槽（文字按钮，min-height = max(44, 1.3em + 12)），
    /// 第二行是标题（可折行、左对齐、行高 lh17、下内边距 6）。左槽在这行里竖向居中。
    func layoutHeader(trailButtonWidth: CGFloat, trailSlotWidth: CGFloat) {
        guard let screen else { return }
        let w = screen.view.bounds.width
        let m = screen.metrics
        let safeTop = screen.view.safeAreaInsets.top
        if !screen.axLayout {
            let left = ShiziPageHeader.centerLeft(gutter: m.gutter)
            let right = w - m.gutter - trailSlotWidth - ShiziPageHeader.centerGap
            let lh = m.line("lh15")
            screen.titleLabel.frame = CGRect(x: left, y: safeTop + (ShiziPageHeader.height - lh) / 2, width: max(0, right - left), height: lh)
            headerBottom = safeTop + ShiziPageHeader.height
        } else {
            // 第一行：左槽 + 右槽（行高 = 最高的那一个）
            let rowH = max(ShiziPageHeader.height, trailHeight)
            screen.backButton.frame = ShiziPageHeader.leadFrame(.back, gutter: m.gutter, y: safeTop + (rowH - ShiziPageHeader.height) / 2)
            // 第二行：标题（外边距 s2 + 内边距 8、下内边距 6；网页 text-wrap:pretty）
            let inset = m.space(2) + 8
            let tw = max(0, w - 2 * m.gutter - 2 * inset)
            let th = ShiziParagraph.place(screen.titleLabel, screen.titleLabel.text ?? "", font: m.font(17, .medium), color: screen.color("ink1"), line: m.line("lh17"), x: m.gutter + inset, y: safeTop + rowH, width: tw)
            // 正文从页头底开始（第一行 + 第二行 + 标题下内边距 6）
            let top = safeTop + rowH + th + 6
            headerBottom = top
            screen.scroll.frame = CGRect(x: screen.scroll.frame.minX, y: top, width: screen.scroll.frame.width, height: max(0, screen.view.bounds.height - top))
        }
        if let b = trail {
            let h = screen.axLayout ? trailHeight : ShiziPageHeader.height
            b.frame = CGRect(x: w - m.gutter + 4 - trailButtonWidth, y: safeTop, width: trailButtonWidth, height: h)
        }
    }

    /// 有底栏时，正文（滚动区）让出底栏的高（网页 .sz-page__body 的 flex 流）。
    func adjustScroll(hasFooter: Bool) {
        guard hasFooter, let screen else { return }
        let fh = foot.frame.height
        screen.scroll.frame = CGRect(x: screen.scroll.frame.minX, y: screen.scroll.frame.minY, width: screen.scroll.frame.width, height: max(0, screen.scroll.frame.height - fh))
    }
}

/// 量一段文字的宽（网页按钮的宽 = 字宽 + 左右内边距）。
enum LibraryCommon {
    /// 分隔线的宽（网页 .5px 描边：浏览器按设备像素取整 → DPR 3 上是 1 个设备像素 = 1/3 pt；原生照这个取整，行高才和网页一样）。
    static let hair: CGFloat = 1.0 / 3.0

    static func textWidth(_ text: String, _ font: UIFont) -> CGFloat {
        guard !text.isEmpty else { return 0 }
        let l = UILabel()
        NativeType.set(l, text, font: font, color: .label)
        return NativeType.width(l)
    }

    /// 系统字号档的连续倍率（网页 --k；AX 档的字阶不乘 --k，但格边长乘 —— 网页 .sz-lrow__char 的 calc(44px * var(--k))）。
    static func scaleK(_ category: UIContentSizeCategory = UIApplication.shared.preferredContentSizeCategory) -> CGFloat {
        let cats = (ShiziTokens.root["type"] as? [String: Any])?["categories"] as? [String: Any]
        let name = ShiziTokens.categoryName(category)
        let k = ((cats?[name] as? [String: Any])?["k"] as? NSNumber)?.doubleValue ?? 1
        return CGFloat(k)
    }

    /// 系统大字号（网页 :root[data-text-large]：--k ≥ policy.compactTextScale；墙的列数据此从 8 列变 6 列）。
    static func isLargeText(_ category: UIContentSizeCategory = UIApplication.shared.preferredContentSizeCategory) -> Bool {
        let limit = ((ShiziTokens.root["type"] as? [String: Any])?["compactTextScale"] as? NSNumber)?.doubleValue ?? 1.3
        return Double(scaleK(category)) >= limit
    }

    /// AX 档文字按钮的最小高（网页：min-height: max(44px, calc(1.3em + 12px))，em = 按钮自己的字号）。
    static func axTextButtonHeight(fontSize: CGFloat) -> CGFloat { max(44, 1.3 * fontSize + 12) }

    /// 网页的 AX 档位（0 = 不是 AX 档；1–5 = AX1–AX5）。网页版给 <html> 写 data-ax，
    /// 样式表按档覆盖 --fsN / --lhN / --btn-h；原生这边同一张表（ShiziKitTokens.json 的 type.categories[*].ax）。
    static var axLevel: Int {
        let cats = (ShiziTokens.root["type"] as? [String: Any])?["categories"] as? [String: Any]
        let name = ShiziTokens.categoryName(UIApplication.shared.preferredContentSizeCategory)
        return ((cats?[name] as? [String: Any])?["ax"] as? NSNumber)?.intValue ?? 0
    }

    /// 在 AX 档（网页 :root[data-ax]）。
    static var isAX: Bool { axLevel > 0 }
}

/// 网页的折行与行盒（CoreText 量，同 WebKit 的行断）。
/// 网页的行高是固定的（--lhN），行盒高 = 行数 × 行高；WebKit 把行高取整到整 pt（原生 ShiziMetrics.line 同口径）。
enum LibraryText {
    /// 一段文字在给定宽下的行数（网页的贪心折行：中文任意处断行、拉丁按词断）。
    static func lines(_ text: String, font: UIFont, width: CGFloat, line: CGFloat) -> Int {
        guard !text.isEmpty, width > 0 else { return 0 }
        let l = UILabel()
        l.numberOfLines = 0
        NativeType.set(l, text, font: font, color: .label, line: line)
        let h = l.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        let style = (l.attributedText?.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle)
        let unit = (style?.minimumLineHeight ?? 0) > 0 ? (style?.minimumLineHeight ?? 0) : max(1, l.font.lineHeight)
        return max(1, Int((h / unit).rounded()))
    }

    /// 网页 white-space:nowrap 的整段排法（网页 .sz-libsw__seg）：整段不折行；一行放不下就整段换行。
    /// 分隔文字（网页模板里的「 · 」）不是原子的：里面的空格是断点（行末挂住），所以段放不下时
    /// 分隔号自己会占一行、段再落到下一行（网页 .sz-libsw__count 的实际排法）。
    /// 返回折出来的每一行。
    static func nowrapSegments(_ segments: [String], separator: String, font: UIFont, width: CGFloat) -> [String] {
        guard !segments.isEmpty else { return [] }
        guard width > 0 else { return segments }
        var lines: [String] = []
        var cur = ""
        var curW: CGFloat = 0
        var hang = ""      // 行末挂住的空格（断点）
        var hangW: CGFloat = 0
        func place(_ text: String, _ w: CGFloat) {
            // 折行判断要算上行末挂着的空格（网页：连同前面的空格放不下就断在这里，空格挂在行末）
            if !cur.isEmpty && curW + hangW + w > width {
                lines.append(cur + hang)
                cur = ""
                curW = 0
                hang = ""
                hangW = 0
            }
            cur += hang + text
            curW += hangW + w
            hang = ""
            hangW = 0
        }
        for (i, seg) in segments.enumerated() {
            if i > 0 {
                // 分隔文字拆成「空格 / 非空格」：空格是断点（挂行末），非空格（间隔号）是普通字符。
                for ch in separator {
                    let s = String(ch)
                    let w = LibraryCommon.textWidth(s, font)
                    if s == " " || s == "\u{3000}" {
                        hang += s
                        hangW += w
                    } else {
                        place(s, w)
                    }
                }
            }
            place(seg, LibraryCommon.textWidth(seg, font))
        }
        lines.append(cur + hang)
        return lines
    }

    /// 网页 white-space:nowrap 的整段排法的行数（nowrapSegments 的行数）。
    static func nowrapSegmentLines(_ segments: [String], separator: String, font: UIFont, width: CGFloat) -> Int {
        nowrapSegments(segments, separator: separator, font: font, width: width).count
    }

    // MARK: WebKit 口径的折行（UAX #14）

    /// 不能出现在行首的字（网页 line-break 默认：行首不许是收尾标点）。
    private static let noStart = Set("\u{3002}\u{FF0C}\u{3001}\u{FF1B}\u{FF1A}\u{FF01}\u{FF1F}\u{FF09}\u{3011}\u{300B}\u{300D}\u{300F}\u{3009}\u{201D}\u{2019}%,.;:!?)]}")
    /// 不能出现在行尾的字（开引号、开括号等）。
    private static let noEnd = Set("\u{FF08}\u{3010}\u{300A}\u{300C}\u{300E}\u{3008}\u{201C}\u{2018}([{")

    /// 一个折行单元（不可再断的一段）。
    private struct Unit {
        let text: String
        let width: CGFloat
        let space: Bool
    }

    /// 把一段文字切成折行单元：连续的中西文与数字算一段（数字串不拆开：UAX #14 LB25 NU × NU），
    /// 中文逐字一段，行末标点跟着前一段，开引号跟着后一段；空格单独一段（是断点）。
    private static func units(_ text: String, font: UIFont) -> [Unit] {
        var out: [Unit] = []
        var buf = ""          // 正在攒的单元（中西文 / 数字串）
        var pendingOpen = ""  // 行尾禁则：开引号等，跟着下一段走
        func width(_ s: String) -> CGFloat { LibraryCommon.textWidth(s, font) }
        func flush() {
            guard !buf.isEmpty else { return }
            let t = pendingOpen + buf
            pendingOpen = ""
            buf = ""
            out.append(Unit(text: t, width: width(t), space: false))
        }
        for ch in text {
            let v = ch.unicodeScalars.first?.value ?? 0
            if ch == " " || ch == "\u{3000}" {
                flush()
                let s = String(ch)
                if var last = out.last, last.space {
                    out[out.count - 1] = Unit(text: last.text + s, width: last.width + width(s), space: true)
                } else {
                    out.append(Unit(text: s, width: width(s), space: true))
                }
                continue
            }
            if noStart.contains(ch) {
                // 行首禁则：跟在前一段末尾
                if !buf.isEmpty {
                    buf.append(ch)
                } else if var last = out.last, !last.space {
                    out[out.count - 1] = Unit(text: last.text + String(ch), width: last.width + width(String(ch)), space: false)
                } else if var last = out.last, last.space {
                    // 空格 + 收尾标点：合成一段（标点不能落在行首，空格也不再是断点）
                    out[out.count - 1] = Unit(text: last.text + String(ch), width: last.width + width(String(ch)), space: false)
                } else {
                    buf = String(ch)
                }
                continue
            }
            if noEnd.contains(ch) {
                pendingOpen.append(ch)
                continue
            }
            if v >= 0x2E80 {
                // 中文字：单独一段（前面的开引号跟着它；攒着的数字 / 西文先吐出来）
                flush()
                let t = pendingOpen + String(ch)
                pendingOpen = ""
                out.append(Unit(text: t, width: width(t), space: false))
                continue
            }
            // 中西文与数字：连成一段（数字串不拆开）
            buf.append(ch)
        }
        flush()
        return out
    }

    /// 网页（WebKit / UAX #14）的贪心折行：数字串不拆开、中文逐字可断、行末的空格挂在行外（不算宽）。
    /// 返回折出来的每一行（行末挂的空格留在行尾；渲染时行末空格不显影，与网页一致）。
    static func webWrap(_ text: String, font: UIFont, width: CGFloat) -> [String] {
        guard !text.isEmpty else { return [] }
        guard width > 0 else { return [text] }
        var lines: [String] = []
        var cur = ""
        var curW: CGFloat = 0
        var hang = ""
        var hangW: CGFloat = 0
        for u in units(text, font: font) {
            if u.space {
                hang += u.text
                hangW += u.width
                continue
            }
            // 折行判断要算上行末挂着的空格（网页：这一段连同前面的空格放不下就断在这里，空格挂在行末）
            if !cur.isEmpty && curW + hangW + u.width > width {
                lines.append(cur + hang)
                cur = u.text
                curW = u.width
                hang = ""
                hangW = 0
                continue
            }
            cur += hang + u.text
            curW += hangW + u.width
            hang = ""
            hangW = 0
        }
        lines.append(cur + hang)
        return lines
    }

    /// 网页 .sz-lrow__meta 的排法（inline-block 段 + 段间空格）与 WebKit 口径的折行：返回每一行的文字。
    /// 段本身在栏宽内折行；段与段之间一个空格，段放不下就整段换行（空格挂在上一行行末）。
    static func webInlineBlockWrap(_ parts: [String], separator: String, font: UIFont, width: CGFloat) -> [String] {
        guard !parts.isEmpty else { return [] }
        var lines: [String] = []
        var x: CGFloat = 0
        var cur = ""
        var curW: CGFloat = 0
        let sepW = LibraryCommon.textWidth(separator, font)
        for (i, part) in parts.enumerated() {
            let natural = LibraryCommon.textWidth(part, font)
            let partW = min(natural, width)
            if i > 0 {
                if x + sepW + partW > width {
                    lines.append(cur)
                    cur = ""
                    curW = 0
                    x = 0
                } else {
                    x += sepW
                    cur += separator
                    curW += sepW
                }
            }
            let wrapped = partW < natural ? webWrap(part, font: font, width: partW) : [part]
            if let first = wrapped.first {
                cur += first
                curW += LibraryCommon.textWidth(first, font)
            }
            for extra in wrapped.dropFirst() {
                lines.append(cur)
                cur = extra
                curW = LibraryCommon.textWidth(extra, font)
            }
            x += partW
        }
        lines.append(cur)
        return lines
    }

    /// 按网页量出来的折行点把一段文字接成多行（行之间显式换行）。
    /// 网页的 text-wrap: pretty 段落（WebKit 按整段均衡各行长度）折行点由页面用同一组 CSS 量出
    /// 折行点，原生按这些折行点排：行数与每行的字与网页一致。
    /// 没有折行点（页面外 / 没量到）→ 原样返回，原生按自己的宽度折行。
    static func joined(_ text: String, _ starts: [Int]?) -> String {
        guard let starts, !starts.isEmpty, !text.isEmpty else { return text }
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

    /// 网页量出来的折行点 → 行数（没有折行点时按自己的宽度折行）。
    static func lineCount(_ text: String, starts: [Int]?, font: UIFont, width: CGFloat, line: CGFloat) -> Int {
        if let starts, !starts.isEmpty { return starts.count + 1 }
        return lines(text, font: font, width: width, line: line)
    }
}

extension ShiziMetrics {
    /// 等宽数字（网页 font-variant-numeric: tabular-nums → OpenType 的 'tnum' 特性；网页「N 个字」里的数字就是等宽的）。
    func fontTabular(_ base: Int, _ weight: UIFont.Weight = .regular) -> UIFont {
        let f = font(base, weight)
        let d = f.fontDescriptor.addingAttributes([
            .featureSettings: [[UIFontDescriptor.FeatureKey.type: kNumberSpacingType,
                                 UIFontDescriptor.FeatureKey.selector: kMonospacedNumbersSelector]],
        ])
        return UIFont(descriptor: d, size: f.pointSize)
    }
}
