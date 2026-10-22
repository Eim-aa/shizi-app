#if DEBUG
import UIKit

// 原生写字页的版式（B2.2；01 §6.1、A7 / D57、P118 / P195 / P257 / P299）。与网页 src/ui/screens/write/layout.js 同一组公式（纯函数，逐条对照），
// 常量由页面随 open 回包给出（src/session/write-api.js writeLayoutConstants，单一来源 policy.writeGrid），原生不另存数值。
//
//   名义主区高 H = 页面高 − (名义页头 44 + 上安全区) − (名义按钮行 134 + max(24, 下安全区))     与系统字号无关（D29 / D36 / P195）
//   书写格 g   = clamp(258, min(屏宽 − 40, 400, H − 80 − 16 − 88 − 16), 400)；名义版式里 258 仍放不下 → 取剩下的高度，最小 180（P299）
//   组顶      = max(12, round((H − 组高) × 0.4)) − 页头多出名义的部分；组高 = P + 16 + g + 88（P = 这张卡量到的题面高）
//   书写格顶边在同一张卡的所有阶段固定（D53 ②，P257）；判断页上下两格 S = min(屏宽 − 40, ⌊(主区高 − 书写格顶 − 16) ÷ 2⌋)，下限 120。
// AX 档的专门排法（axWriteLayout、并排判断页）在 B2.9；本卡的版式全部按量到的字体行高排，大字号下只会把组往上挤，不会重叠。

struct NativeWriteLayoutConstants {
    var min: CGFloat = 258
    var max: CGFloat = 400
    var sideMargin: CGFloat = 20
    var promptGap: CGFloat = 16
    var noteHeight: CGFloat = 40
    var toolRowHeight: CGFloat = 48
    var axMin: CGFloat = 220
    var axNoteHeight: CGFloat = 56
    var fitGridMin: CGFloat = 180
    var bottomGap: CGFloat = 16
    var topShare: CGFloat = 0.4
    var topMin: CGFloat = 12
    var nominalHead: CGFloat = 44
    var nominalFoot: CGFloat = 134
    var footBottomMin: CGFloat = 24
    var nominalPrompt: CGFloat = 80
    var hintMatchMaxDist: Double = 40

    /// 格下总高（撤销 / 清空行 + 说明位，A7）。
    var toolsHeight: CGFloat { toolRowHeight + noteHeight }

    /// 页面 open 回包的 layout（缺项保留缺省，缺省只为页面没给时不崩；值以页面为准）。
    init(_ raw: [String: Any]? = nil) {
        func v(_ k: String) -> CGFloat? { (raw?[k] as? NSNumber).map { CGFloat($0.doubleValue) } }
        if let x = v("min") { min = x }
        if let x = v("max") { max = x }
        if let x = v("sideMargin") { sideMargin = x }
        if let x = v("promptGap") { promptGap = x }
        if let x = v("noteHeight") { noteHeight = x }
        if let x = v("toolRowHeight") { toolRowHeight = x }
        if let x = v("axMin") { axMin = x }
        if let x = v("axNoteHeight") { axNoteHeight = x }
        if let x = v("fitGridMin") { fitGridMin = x }
        if let x = v("bottomGap") { bottomGap = x }
        if let x = v("topShare") { topShare = x }
        if let x = v("topMin") { topMin = x }
        if let x = v("nominalHead") { nominalHead = x }
        if let x = v("nominalFoot") { nominalFoot = x }
        if let x = v("footBottomMin") { footBottomMin = x }
        if let x = v("nominalPrompt") { nominalPrompt = x }
        if let x = raw?["hintMatchMaxDist"] as? NSNumber { hintMatchMaxDist = x.doubleValue }
    }
}

enum NativeWriteLayout {
    typealias K = NativeWriteLayoutConstants

    static func contentWidth(_ width: CGFloat, _ k: K) -> CGFloat { width > 0 ? width - 2 * k.sideMargin : .infinity }

    /// layout.js writeGridSize。
    static func gridSize(width: CGFloat, mainHeight: CGFloat, promptHeight: CGFloat, toolsHeight: CGFloat, _ k: K) -> CGFloat {
        let w = contentWidth(width, k)
        let h = mainHeight > 0 ? mainHeight - promptHeight - k.promptGap - toolsHeight - k.bottomGap : .infinity
        return Swift.max(k.min, Swift.min(k.max, floor(Swift.min(w, k.max, h))))
    }

    /// layout.js groupTop：空余 40% 在上，至少 12；空余不足 12 时取空余本身（≥ 0）。
    static func groupTop(mainHeight: CGFloat, groupHeight: CGFloat, _ k: K) -> CGFloat {
        let spare = mainHeight - groupHeight
        let ideal = (spare * k.topShare).rounded()
        if ideal >= k.topMin { return ideal }
        return Swift.max(0, Swift.min(k.topMin, floor(spare)))
    }

    /// layout.js nominalMainHeight（正文区上下内边距 0）。
    static func nominalMainHeight(pageHeight: CGFloat, safeTop: CGFloat, footBottom: CGFloat, _ k: K) -> CGFloat {
        pageHeight - (k.nominalHead + safeTop) - (k.nominalFoot + footBottom)
    }

    /// layout.js fitGroup（scaleMin = 1：非 AX 档只有格子让步这一步）。
    static func fitGrid(width: CGFloat, mainHeight: CGFloat, promptHeight: CGFloat, below: CGFloat, gFloor: CGFloat, _ k: K) -> CGFloat {
        let w = contentWidth(width, k)
        let room = mainHeight - k.promptGap - below - k.bottomGap
        let free = room - promptHeight
        if free >= gFloor || free >= k.fitGridMin { return floor(Swift.min(w, k.max, free)) }
        return Swift.max(k.fitGridMin, floor(Swift.min(w, k.max, room - promptHeight)))
    }

    /// layout.js writeLayout：{g, top, gridTop}（top / gridTop 是主区内的偏移；主区从页头底算起）。
    static func write(width: CGFloat, nominalHeight: CGFloat, promptHeight: CGFloat, headExtra: CGFloat, _ k: K) -> (g: CGFloat, top: CGFloat, gridTop: CGFloat) {
        var g = gridSize(width: width, mainHeight: nominalHeight, promptHeight: k.nominalPrompt, toolsHeight: k.toolsHeight, k)
        if nominalHeight > 0 {
            g = Swift.min(g, fitGrid(width: width, mainHeight: nominalHeight, promptHeight: k.nominalPrompt, below: k.toolsHeight, gFloor: g, k))
        }
        let extra = Swift.max(0, headExtra)
        let top = Swift.max(0, groupTop(mainHeight: nominalHeight, groupHeight: promptHeight + k.promptGap + g + k.toolsHeight, k) - extra)
        return (g, top, top + promptHeight + k.promptGap)
    }

    /// layout.js judgePairSize：判断页上下两格的边长（下限 120）。
    static func judgePair(width: CGFloat, mainHeight: CGFloat, gridTop: CGFloat, _ k: K) -> CGFloat {
        let w = contentWidth(width, k)
        let h = mainHeight > 0 ? floor((mainHeight - gridTop - k.bottomGap) / 2) : .infinity
        let s = floor(Swift.min(w, h))
        return s.isFinite ? Swift.max(120, s) : 234
    }
}

// MARK: 字阶（R9-A：写字页页头 / 写字区按字阶取字号与行高；值来自页面 open 回包 type（R9-B NativeType，= 网页 --fsN / --lhN 此刻的计算值））

struct NativeTypeScale {
    let type: NativeType
    let ax: Bool

    /// 字号 fsN（pt）。
    func size(_ base: Int) -> CGFloat { type.value("fs\(base)") }
    /// 行高 lhN（网页把小数行高取整）。
    func lineHeight(_ base: Int) -> CGFloat { type.line("lh\(base)") }
    /// 单行行高 lh17s（按钮、页头标题）。
    var lh17s: CGFloat { type.line("lh17s") }
    /// 主按钮高 --btn-h。
    var buttonHeight: CGFloat { type.value("btn-h") }

    /// 系统字体（中文接苹方 UI 正文款，NativeType.font）；tabular：等宽数字（网页 font-variant-numeric:tabular-nums）。
    func font(_ base: Int, _ weight: UIFont.Weight = .regular, tabular: Bool = false) -> UIFont {
        let f = type.font("fs\(base)", weight: weight)
        guard tabular else { return f }
        let d = f.fontDescriptor.addingAttributes([.featureSettings: [[UIFontDescriptor.FeatureKey.type: kNumberSpacingType, UIFontDescriptor.FeatureKey.selector: kMonospacedNumbersSelector]]])
        return UIFont(descriptor: d, size: f.pointSize)
    }
}

// MARK: 线形图标（R9-A：网页 src/ui/components/icons.js 同一组路径，线宽 1.5、圆端圆角；不随字号放大）

enum NativeWriteIcon {
    case back, undo, clear, answer, hint, close, share

    /// 网页的栅格（viewBox 边长）与视觉尺寸。
    var box: CGFloat { self == .back || self == .share ? 22 : 20 }
    var size: CGFloat {
        switch self {
        case .back, .share: return 22
        case .close: return 20
        case .undo, .clear: return 20
        case .answer, .hint: return 18
        }
    }

    private func path() -> UIBezierPath {
        let p = UIBezierPath()
        switch self {
        case .back:
            p.move(to: CGPoint(x: 13.5, y: 5)); p.addLine(to: CGPoint(x: 7.5, y: 11)); p.addLine(to: CGPoint(x: 13.5, y: 17))
        case .undo:
            p.move(to: CGPoint(x: 7, y: 5)); p.addLine(to: CGPoint(x: 3.5, y: 8.5)); p.addLine(to: CGPoint(x: 7, y: 12))
            p.move(to: CGPoint(x: 4, y: 8.5)); p.addLine(to: CGPoint(x: 12, y: 8.5))
            p.addArc(withCenter: CGPoint(x: 12, y: 13), radius: 4.5, startAngle: -.pi / 2, endAngle: .pi / 2, clockwise: true)
            p.addLine(to: CGPoint(x: 9, y: 17.5))
        case .clear:
            p.move(to: CGPoint(x: 4, y: 6)); p.addLine(to: CGPoint(x: 16, y: 6))
            p.move(to: CGPoint(x: 8, y: 6)); p.addLine(to: CGPoint(x: 8, y: 4)); p.addLine(to: CGPoint(x: 12, y: 4)); p.addLine(to: CGPoint(x: 12, y: 6))
            p.move(to: CGPoint(x: 6, y: 6)); p.addLine(to: CGPoint(x: 6.8, y: 16)); p.addLine(to: CGPoint(x: 13.2, y: 16)); p.addLine(to: CGPoint(x: 14, y: 6))
        case .answer:
            p.append(UIBezierPath(rect: CGRect(x: 2.75, y: 2.75, width: 14.5, height: 14.5)))
            p.move(to: CGPoint(x: 6.5, y: 8.2)); p.addLine(to: CGPoint(x: 13.5, y: 8.2))
            p.move(to: CGPoint(x: 10, y: 5.6)); p.addLine(to: CGPoint(x: 10, y: 14.6))
            p.move(to: CGPoint(x: 6.6, y: 14.2)); p.addLine(to: CGPoint(x: 13.2, y: 12.9))
        case .close: // B2.7 结果页左上「×」（icons.js close）
            p.move(to: CGPoint(x: 5, y: 5)); p.addLine(to: CGPoint(x: 15, y: 15))
            p.move(to: CGPoint(x: 15, y: 5)); p.addLine(to: CGPoint(x: 5, y: 15))
        case .share: // B2.7 结果页右上「分享」（icons.js share）
            p.move(to: CGPoint(x: 11, y: 14)); p.addLine(to: CGPoint(x: 11, y: 3.5))
            p.move(to: CGPoint(x: 7.2, y: 7)); p.addLine(to: CGPoint(x: 11, y: 3.2)); p.addLine(to: CGPoint(x: 14.8, y: 7))
            p.move(to: CGPoint(x: 6, y: 10)); p.addLine(to: CGPoint(x: 5, y: 10)); p.addLine(to: CGPoint(x: 5, y: 18)); p.addLine(to: CGPoint(x: 17, y: 18))
            p.addLine(to: CGPoint(x: 17, y: 10)); p.addLine(to: CGPoint(x: 16, y: 10))
        case .hint: // 实心的一点起笔（icons.js SolidIcons.hint）
            p.move(to: CGPoint(x: 6.2, y: 3.6))
            p.addCurve(to: CGPoint(x: 14.6, y: 12.6), controlPoint1: CGPoint(x: 9.8, y: 4.8), controlPoint2: CGPoint(x: 13.4, y: 8.1))
            p.addCurve(to: CGPoint(x: 12.3, y: 14.4), controlPoint1: CGPoint(x: 15.0, y: 14.2), controlPoint2: CGPoint(x: 13.7, y: 15.2))
            p.addCurve(to: CGPoint(x: 5.4, y: 5.4), controlPoint1: CGPoint(x: 9.6, y: 12.8), controlPoint2: CGPoint(x: 7.6, y: 9.4))
            p.addCurve(to: CGPoint(x: 6.2, y: 3.6), controlPoint1: CGPoint(x: 4.9, y: 4.3), controlPoint2: CGPoint(x: 5.3, y: 3.3))
            p.close()
        }
        return p
    }

    /// 画好颜色的图（alwaysOriginal：禁用态另给一张 ink4 的，与网页 currentColor 一致）。size：AX 档放大时传入（撤销 / 清空 24、求助 22）。
    func image(_ color: UIColor, size: CGFloat? = nil) -> UIImage {
        let s = size ?? self.size
        let fmt = UIGraphicsImageRendererFormat.preferred()
        fmt.opaque = false
        return UIGraphicsImageRenderer(size: CGSize(width: s, height: s), format: fmt).image { _ in
            let p = path()
            p.apply(CGAffineTransform(scaleX: s / box, y: s / box))
            color.set()
            if self == .hint {
                p.fill()
            } else {
                p.lineWidth = 1.5 * s / box
                p.lineCapStyle = .round
                p.lineJoinStyle = .round
                p.stroke()
            }
        }.withRenderingMode(.alwaysOriginal)
    }
}

/// 图标 + 文字的按钮（R9-A：网页 inline-flex 的同一种排法——图标固定尺寸、与字间距固定，整体按 contentHorizontalAlignment 靠左 / 居中 / 靠右；
/// 点击区不足 44 时向外补到 44，网页 .sz-btn--text::after）。
final class NativeIconTextButton: UIButton {
    var iconSize: CGFloat = 0
    var spacing: CGFloat = 6
    /// 这枚按钮的图标（尺寸与颜色由页面按字号档位画，见 NativeWriteViewController.setIcon）。
    var toolIcon: NativeWriteIcon?
    var minHit: CGFloat = 44

    /// titleLabel 第一次被取时 UIKit 会回调 titleRect：量字宽期间回调走父类（不递归）。
    private var measuring = false

    private var titleWidth: CGFloat {
        guard !measuring, let t = currentTitle, !t.isEmpty else { return 0 }
        measuring = true
        defer { measuring = false }
        guard let l = titleLabel else { return 0 }
        return (t as NSString).size(withAttributes: [.font: l.font as Any]).width
    }

    private func contentStart(_ r: CGRect, total: CGFloat) -> CGFloat {
        switch effectiveContentHorizontalAlignment {
        case .left, .leading: return r.minX
        case .right, .trailing: return r.maxX - total
        default: return r.midX - total / 2
        }
    }

    private var hasIcon: Bool { !measuring && iconSize > 0 && currentImage != nil }

    override func imageRect(forContentRect r: CGRect) -> CGRect {
        guard hasIcon else { return super.imageRect(forContentRect: r) }
        let tw = min(titleWidth, max(0, r.width - iconSize - spacing))
        let x = contentStart(r, total: iconSize + (tw > 0 ? spacing + tw : 0))
        return CGRect(x: x, y: r.midY - iconSize / 2, width: iconSize, height: iconSize)
    }

    override func titleRect(forContentRect r: CGRect) -> CGRect {
        guard hasIcon else { return super.titleRect(forContentRect: r) }
        let tw = min(titleWidth, max(0, r.width - iconSize - spacing))
        let x = contentStart(r, total: iconSize + spacing + tw) + iconSize + spacing
        let th = min(r.height, ceil(super.titleRect(forContentRect: r).height))
        return CGRect(x: x, y: r.midY - th / 2, width: ceil(tw), height: th)
    }

    override func sizeThatFits(_ size: CGSize) -> CGSize {
        guard hasIcon else { return super.sizeThatFits(size) }
        let s = super.sizeThatFits(size)
        return CGSize(width: iconSize + spacing + titleWidth, height: s.height)
    }

    /// 文字宽（不含图标；页头文字按钮按它排位置）。
    var textWidth: CGFloat { titleWidth }

    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        let dx = max(0, (minHit - bounds.width) / 2), dy = max(0, (minHit - bounds.height) / 2)
        return bounds.insetBy(dx: -dx, dy: -dy).contains(point)
    }
}
#endif
