import UIKit

// B3.13 原生坏值提示浮条（L4 顶部浮条；照网页版 1:1 移植；样式按 D71 ③）。
//
// 启动逐键形状校验时隔离了坏值 → 顶部浮出一次：一句说明 + 右上角的关闭键；点掉就没了（不写入任何数据）。
// 原生壳里由原生画这一条（网页那边只发「显示 / 收起」消息）：浮条挂在当前原生根页上（原生根页在网页之上，浮条又在根页之上）。
//
// 版式（网页 .sz-corrupt）：绝对定位在顶部（left / right = 页边、top = 8 + 安全区）、圆角 r-box、1px toast-line 细边、
// 浅面 toast-bg、字 toast-fg、toast-shadow 投影；内边距 10 6 10 16；说明（15 / lh15，padding-top 2）与关闭键之间 gap 8；
// 关闭键 44 × 44、图标 18（网页的 close）。

/// 坏值提示浮条（原生层上的一个视图；由 NativeStage 挂起）。
final class ShiziCorruptNoticeView: UIView {
    private let textLabel = UILabel()
    private let closeButton = UIButton(type: .custom)
    /// 点关闭。
    var onClose: (() -> Void)?

    /// 网页 .sz-corrupt 的内边距与间距（px = pt）。
    private static let padL: CGFloat = 16, padR: CGFloat = 6, padT: CGFloat = 10, padB: CGFloat = 10
    private static let gap: CGFloat = 8
    private static let border: CGFloat = 1
    /// 说明文字上方的 2px（网页 .sz-corrupt__text 的 padding-top）。
    private static let textPadTop: CGFloat = 2

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = true
        backgroundColor = .clear
        accessibilityIdentifier = "native-corrupt-notice"
        textLabel.accessibilityIdentifier = "native-corrupt-notice-text"
        textLabel.numberOfLines = 0
        textLabel.isAccessibilityElement = true
        closeButton.accessibilityIdentifier = "native-corrupt-notice-close"
        closeButton.addAction(UIAction { [weak self] _ in self?.onClose?() }, for: .touchUpInside)
        addSubview(textLabel)
        addSubview(closeButton)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// 文案与外观（ShiziCopy 的构建期文案；颜色 / 尺寸取 ShiziTokens）。
    /// lines：网页量出来的折行点（每一行从第几个字开始）——有它就按它换行。
    func configure(text: String, lines: [Int]?, metrics: ShiziMetrics) {
        textLabel.text = text
        textLabel.accessibilityLabel = text
        textLabel.attributedText = ShiziPageText.mixed(text, size: metrics.value("fs15"), color: ShiziTokens.dynamicColor("toast-fg") ?? .label, align: .left, line: metrics.line("lh15"))
        textLabel.textAlignment = .left
        textLabel.textColor = ShiziTokens.dynamicColor("toast-fg") ?? .label
        let fg = ShiziTokens.dynamicColor("toast-fg") ?? .label
        closeButton.setImage(NativeWriteIcon.close.image(fg, size: 18), for: .normal)
        // 网页 .sz-corrupt .sz-btn{color:inherit}：关闭键的字色 = 浮条字色；字号继承正文（网页量到的就是正文那一档）
        closeButton.setTitleColor(fg, for: .normal)
        closeButton.setTitleColor(fg, for: .highlighted)
        closeButton.titleLabel?.font = metrics.font(15)
        closeButton.accessibilityLabel = ShiziCopy.t("X-COMMON.close")
        backgroundColor = ShiziTokens.dynamicColor("toast-bg") ?? .secondarySystemBackground
        layer.cornerRadius = metrics.value("r-box")
        layer.borderWidth = Self.border
        layer.borderColor = (ShiziTokens.dynamicColor("toast-line") ?? .separator).cgColor
        applyShadow()
        webStarts = lines
    }

    /// 网页量出来的折行点（nil = 没量到，按自己的宽度折）。
    private var webStarts: [Int]?

    /// 网页的 --toast-shadow（"0px 4px 16px rgba(38,33,29,.12)"）：原生的阴影（offset / 模糊 / 透明度 / 颜色）。
    private func applyShadow() {
        let css = ((ShiziTokens.root["colors"] as? [String: Any])?["light"] as? [String: Any])?["toast-shadow"] as? String
            ?? ((ShiziTokens.root["colors"] as? [String: Any])?["dark"] as? [String: Any])?["toast-shadow"] as? String
            ?? ""
        let parts = css.split(separator: " ").map(String.init)
        guard parts.count >= 4 else { return }
        let num: (String) -> CGFloat = { (Double($0.replacingOccurrences(of: "px", with: "")) ?? 0) }
        let ox = num(parts[0]), oy = num(parts[1]), blur = num(parts[2])
        let rgba = parts[3...].joined(separator: " ")
        guard let (r, g, b, a) = Self.rgba(rgba) else { return }
        layer.shadowOffset = CGSize(width: ox, height: oy)
        layer.shadowRadius = blur / 2
        layer.shadowOpacity = Float(a)
        layer.shadowColor = UIColor(red: r, green: g, blue: b, alpha: 1).cgColor
    }

    /// "rgba(38,33,29,.12)" → 分量。
    private static func rgba(_ s: String) -> (CGFloat, CGFloat, CGFloat, CGFloat)? {
        let inner = s.replacingOccurrences(of: "rgba(", with: "").replacingOccurrences(of: ")", with: "")
        let parts = inner.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        guard parts.count >= 4, let r = Double(parts[0]), let g = Double(parts[1]), let b = Double(parts[2]), let a = Double(parts[3]) else { return nil }
        return (CGFloat(r) / 255, CGFloat(g) / 255, CGFloat(b) / 255, CGFloat(a))
    }

    /// 排版（浮条在窗口里：left / right = 页边、top = 8 + 安全区）。
    func layout(in width: CGFloat, safeTop: CGFloat, metrics: ShiziMetrics) {
        let gutter = metrics.gutter
        let hit = metrics.hit
        let w = width - 2 * gutter
        let textW = w - 2 * Self.border - Self.padL - Self.padR - Self.gap - hit
        let line = metrics.line("lh15")
        // 说明按网页的折行（text-wrap: pretty）折；行数 × 行高 + 上内边距 2。
        var lines = 1
        if let a = textLabel.attributedText, a.length > 0 {
            let src = ShiziPageText.source(a)
            let chars = Array(src.string)
            let breaks: [Range<Int>]
            if let starts = webStarts {
                breaks = ShiziPageText.ranges(fromStarts: starts, count: chars.count)
            } else {
                breaks = ShiziPageText.wrappedLines(src, chars, width: textW)
            }
            lines = breaks.count
            textLabel.attributedText = ShiziPageText.withBreaks(src, chars, breaks)
            textLabel.numberOfLines = lines
            textLabel.lineBreakMode = .byClipping
        }
        // 网页 .sz-corrupt__text：padding-top 2 + 内容盒（行数 × 行高）。原生照抄：2px 在框外，标签框就是内容盒。
        let contentH = CGFloat(lines) * line
        let h = Self.padT + Self.textPadTop + contentH + Self.padB + 2 * Self.border
        frame = CGRect(x: gutter, y: safeTop + 8, width: w, height: h)
        textLabel.frame = CGRect(x: Self.border + Self.padL, y: Self.border + Self.padT + Self.textPadTop, width: textW, height: contentH)
        closeButton.frame = CGRect(x: w - Self.border - Self.padR - hit, y: Self.border + Self.padT, width: hit, height: hit)
    }
}
