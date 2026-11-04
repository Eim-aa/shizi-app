import UIKit

// ShiziKit（B3.1）：按钮与线形图标（原在 NativeJudge.swift / NativeWriteLayout.swift）。

/// 子视图可以伸出自身边界接收点按（结果行「修改 ›」的 44pt 热区伸到说明位上沿以外，NP-01）。
final class NativeOverflowView: UIView {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard !isHidden, alpha > 0.01, isUserInteractionEnabled else { return nil }
        for s in subviews.reversed() {
            if let hit = s.hitTest(convert(point, to: s), with: event) { return hit }
        }
        return self.point(inside: point, with: event) ? self : nil
    }
}

/// 文字按钮：字的盒子比 44 窄时，点击区仍按 44 × 44 以盒子中心向外扩（网页 .sz-btn--text::after）。
final class NativeTextButton: UIButton {
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        let dx = max(0, 44 - bounds.width) / 2, dy = max(0, 44 - bounds.height) / 2
        return bounds.insetBy(dx: -dx, dy: -dy).contains(point)
    }
}

// MARK: 线形图标（R9-A：网页版同一组路径，线宽 1.5、圆端圆角；不随字号放大）

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
        case .close: // B2.7 结果页左上「×」（close）
            p.move(to: CGPoint(x: 5, y: 5)); p.addLine(to: CGPoint(x: 15, y: 15))
            p.move(to: CGPoint(x: 15, y: 5)); p.addLine(to: CGPoint(x: 5, y: 15))
        case .share: // B2.7 结果页右上「分享」（share）
            p.move(to: CGPoint(x: 11, y: 14)); p.addLine(to: CGPoint(x: 11, y: 3.5))
            p.move(to: CGPoint(x: 7.2, y: 7)); p.addLine(to: CGPoint(x: 11, y: 3.2)); p.addLine(to: CGPoint(x: 14.8, y: 7))
            p.move(to: CGPoint(x: 6, y: 10)); p.addLine(to: CGPoint(x: 5, y: 10)); p.addLine(to: CGPoint(x: 5, y: 18)); p.addLine(to: CGPoint(x: 17, y: 18))
            p.addLine(to: CGPoint(x: 17, y: 10)); p.addLine(to: CGPoint(x: 16, y: 10))
        case .hint: // 实心的一点起笔（SolidIcons.hint）
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
        if let a = currentAttributedTitle, a.length > 0 { return a.size().width } // 带中文字距的标题（NativeType.trackTitle）
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
        // 标签占满内容区的高（字在里面竖向居中，位置不变）：只按 SF 的行高给，苹方的字形比它高，AX 档会被系统判为「字被裁」
        return CGRect(x: x, y: r.minY, width: ceil(tw), height: r.height)
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
