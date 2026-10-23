import UIKit

// B3.2 试点页：关于拾字 + 三个子页（网页 src/ui/screens/mine/about.js，1:1 移植；视图模型 src/session/views/about.js，App API view.about*）。
// 屏名 ⇄ 类：about ⇄ ShiziScreen_about、about-privacy ⇄ ShiziScreen_about_privacy、about-credits ⇄ ShiziScreen_about_credits、about-letter ⇄ ShiziScreen_about_letter。
// 只读页：不写 store；版本行点按展开完整构建号、开源致谢每项「许可全文」展开 / 收起是页内状态（网页同样不进 params）。
// 版式按网页 CSS 逐项排（about.js 的 .sz-about__* 与 Page.js），数值全部取 ShiziTokens（s* / gutter / group-gap / fs* / lh* / r-*），文案取视图模型给的引用。

/// 行尾的「 ›」只是视觉箭头：行标签 / 读屏名里去掉（views/about.js stripArrow 同一规则）。
private func stripArrow(_ s: String) -> String {
    var t = s
    while let last = t.last, last == " " || last == "\u{203A}" { t.removeLast() }
    return t
}

/// 读屏名里两段的连接（网页 about.js 的中文逗号）。
private let ariaJoin = "\u{FF0C}"

// MARK: - 关于拾字

@objc(ShiziScreen_about)
final class AboutScreen: ShiziScreenViewController {
    struct View: Decodable {
        struct Version: Decodable { let line: ShiziCopyRef; let aria: ShiziCopyRef; let full: ShiziCopyRef }
        struct Row: Decodable { let key: String; let label: ShiziCopyRef; let value: ShiziCopyRef?; let to: String }
        let title: ShiziCopyRef
        let name: ShiziCopyRef
        let version: Version
        let motto: ShiziCopyRef
        let rows: [Row]
    }

    let logoView = UIImageView()
    let nameLabel = UILabel()
    let buildButton = NativeTextButton(type: .custom)
    let buildFullLabel = UILabel()
    let mottoLabel = UILabel()
    let sealView = NativeSealView()
    /// 头（.sz-about__head）与三行（.sz-about__rows）的框：透明，只给 QA 取证按语义键比位置。
    private let headMarker = UIView()
    private let rowsMarker = UIView()
    private let rowsTopLine = UIView()
    private(set) var rowButtons: [ShiziRowButton] = []
    private var rowLines: [UIView] = []
    private var model: View?
    private var buildOpen = false
    private var sealPath: [[Any]] = []

    override func viewDidLoad() {
        logoView.accessibilityIdentifier = "native-about-logo"
        logoView.isAccessibilityElement = false
        logoView.clipsToBounds = true
        if let url = Bundle.main.url(forResource: "Web", withExtension: nil)?.appendingPathComponent("icon-512.png") { logoView.image = UIImage(contentsOfFile: url.path) }
        nameLabel.accessibilityIdentifier = "native-about-name"
        buildButton.accessibilityIdentifier = "native-about-build"
        buildFullLabel.accessibilityIdentifier = "native-about-build-full"
        buildFullLabel.numberOfLines = 0
        mottoLabel.accessibilityIdentifier = "native-about-motto"
        mottoLabel.numberOfLines = 0
        sealView.accessibilityIdentifier = "native-about-seal"
        headMarker.accessibilityIdentifier = "native-about-head"
        rowsMarker.accessibilityIdentifier = "native-about-rows"
        for v in [headMarker, rowsMarker] { v.isUserInteractionEnabled = false; content.addSubview(v) }
        for v in [logoView, nameLabel, buildButton, buildFullLabel, mottoLabel, sealView, rowsTopLine] as [UIView] { content.addSubview(v) }
        wire(buildButton) { page in (page as? AboutScreen)?.toggleBuild() }
        super.viewDidLoad()
    }

    private func toggleBuild() {
        buildOpen.toggle()
        markStateChange()
        if let m = model { renderModel(m) }
        view.setNeedsLayout()
    }

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: View.self)
        model = m
        sealPath = ((raw as? [String: Any])?["seal"] as? [[Any]]) ?? []
        renderModel(m)
    }

    private func renderModel(_ m: View) {
        let mt = metrics
        setTitle(m.title.text)
        NativeType.set(nameLabel, m.name.text, font: NativeType.song(size: mt.value("fs22"), weight: .medium), color: color("ink1"), align: .center, line: mt.line("lh15"))
        ShiziFonts.untrack(nameLabel)
        // 版本行（.sz-about__build：按钮 15、ink2；字在 ltr 隔离的 span 里，数字不等宽）
        let line = m.version.line.text
        buildButton.setTitle(line, for: .normal)
        buildButton.setTitleColor(color("ink2"), for: .normal)
        buildButton.titleLabel?.font = mt.font(15)
        buildButton.titleLabel?.textAlignment = .center
        buildButton.titleLabel?.numberOfLines = 0
        buildButton.accessibilityLabel = m.version.aria.text
        buildButton.accessibilityValue = nil
        NativeType.trackTitle(buildButton)
        buildFullLabel.isHidden = !buildOpen
        NativeType.set(buildFullLabel, m.version.full.text, font: tabular(mt.font(13)), color: color("ink2"), align: .center, line: mt.line("lh13"))
        // 题句（楷 17 / lh17，两行居中；末尾跟一枚 16pt 的印，左外边 8）
        applyMotto(m, width: view.bounds.width - 2 * mt.gutter)
        sealView.configure(path: sealPath, fill: color("seal"), glyph: color("on-seal"))
        sealView.layer.cornerRadius = metrics.value("r-work")
        sealView.isHidden = sealPath.isEmpty
        renderRows(m)
    }

    /// 题句：按宽度折好（每一行 <br> 放不下时照网页 text-wrap:pretty 再折），行尾给印留位。宽度变了（排版时）重做。
    private var mottoWidth: CGFloat = -1

    private func applyMotto(_ m: View, width: CGFloat) {
        mottoWidth = width
        let mt = metrics
        let kai = ShiziFonts.kai(size: mt.value("fs17"))
        let motto = width > 0 ? mottoLines(m.motto.lines, font: kai, width: width) : m.motto.lines
        let p = NSMutableParagraphStyle()
        p.alignment = .center
        p.minimumLineHeight = mt.line("lh17")
        p.maximumLineHeight = mt.line("lh17")
        let out = NSMutableAttributedString(string: motto.joined(separator: "\n"), attributes: [.font: kai, .foregroundColor: color("ink1"), .paragraphStyle: p, .kern: 0,
                                                                                              .baselineOffset: (mt.line("lh17") - kai.lineHeight) / 4])
        if out.length > 0 { out.addAttribute(.kern, value: sealGap + sealSide, range: NSRange(location: out.length - 1, length: 1)) } // 行尾给印留位（居中时整行连印一起居中）
        mottoLabel.attributedText = out
        displayedMotto = motto
        mottoLabel.accessibilityLabel = m.motto.lines.joined()
    }

    private func renderRows(_ m: View) {
        let mt = metrics
        // 三行（「名称 …… 值 ›」；隐私行的值是字，其余行尾是 chevron）
        if rowButtons.count != m.rows.count {
            rowButtons.forEach { $0.removeFromSuperview() }
            rowLines.forEach { $0.removeFromSuperview() }
            rowButtons = m.rows.map { _ in ShiziRowButton(type: .custom) }
            rowLines = m.rows.map { _ in UIView() }
            for (b, l) in zip(rowButtons, rowLines) {
                content.addSubview(b)
                content.addSubview(l)
                wire(b) { page in (page as? AboutScreen)?.open(b) }
            }
        }
        for (i, r) in m.rows.enumerated() {
            let b = rowButtons[i]
            let label = stripArrow(r.label.text)
            let value = r.value?.text
            b.accessibilityIdentifier = "native-about-row-\(r.key)"
            b.titleLabel?.font = mt.font(15)
            b.setTitleColor(color("ink1"), for: .normal)
            NativeType.set(b.label, label, font: mt.font(17), color: color("ink1"), line: mt.line("lh17s"))
            if let value {
                b.valueLabel.isHidden = false
                NativeType.set(b.valueLabel, value, font: mt.font(15), color: color("ink3"), align: .right)
                b.chevronSize = .zero
                b.setImage(nil, for: .normal)
            } else {
                b.valueLabel.isHidden = true
                b.valueLabel.text = nil
                b.chevronSize = CGSize(width: 8, height: 13)
                b.setImage(ShiziChevron.image(color("ink4"), size: b.chevronSize), for: .normal)
            }
            b.accessibilityLabel = value.map { label + ariaJoin + stripArrow($0) } ?? label
            b.accessibilityTraits = [.button]
            b.isAccessibilityElement = true
            rowLines[i].backgroundColor = color("line")
        }
        rowsTopLine.backgroundColor = color("line")
    }

    /// 题句每一行（<br> 分开）在 AX 档放不下时还要折：照网页 text-wrap:pretty（ShiziParagraph.pretty，同一组规则）。印跟在最后一行之后，量宽时算上。
    private func mottoLines(_ lines: [String], font: UIFont, width: CGFloat) -> [String] {
        let probe = UILabel()
        return lines.enumerated().flatMap { i, line -> [String] in
            probe.attributedText = NSAttributedString(string: line, attributes: [.font: font, .kern: 0])
            let room = i == lines.count - 1 ? width - sealGap - sealSide : width
            return ShiziParagraph.pretty(line, label: probe, width: room).components(separatedBy: "\n")
        }
    }

    private var displayedMotto: [String] = []

    private func open(_ b: ShiziRowButton) {
        guard let i = rowButtons.firstIndex(of: b), let m = model, i < m.rows.count else { return }
        push(m.rows[i].to)
    }

    private var sealSide: CGFloat { 16 }
    private var sealGap: CGFloat { metrics.space(2) }

    private func tabular(_ f: UIFont) -> UIFont {
        let d = f.fontDescriptor.addingAttributes([.featureSettings: [[UIFontDescriptor.FeatureKey.type: kNumberSpacingType, UIFontDescriptor.FeatureKey.selector: kMonospacedNumbersSelector]]])
        return UIFont(descriptor: d, size: f.pointSize)
    }

    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat {
        let mt = metrics
        let w = view.bounds.width
        // 头（.sz-about__head：上内边距 s6、下 s2，竖排居中，间距 s4）
        let headTop = top
        var y = top + mt.space(6)
        let logo: CGFloat = 64
        logoView.frame = CGRect(x: (w - logo) / 2, y: y, width: logo, height: logo)
        logoView.layer.cornerRadius = mt.value("r-ctl")
        y += logo + mt.space(4)
        let nameH = mt.line("lh15")
        nameLabel.frame = CGRect(x: x, y: y, width: width, height: nameH)
        y += nameH + mt.space(4)
        // 版本行按钮：最小高 44，左右内边距 8，宽 = 字宽 + 16（不超过正文宽）
        let pad: CGFloat = 8
        let textW = min(width - 2 * pad, ceil(NativeType.titleWidth(buildButton)))
        let lh = mt.line("lh15")
        let lines = max(1, ceil(NativeType.titleWidth(buildButton) / max(1, width - 2 * pad)))
        let bh = max(mt.hit, lines * lh)
        buildButton.frame = CGRect(x: (w - textW - 2 * pad) / 2, y: y, width: textW + 2 * pad, height: bh)
        y += bh
        if buildOpen {
            y += mt.space(4) - 8 // .sz-about__buildfull 上外边距 −8
            let fh = NativeType.height(buildFullLabel, width: width, line: mt.line("lh13"))
            buildFullLabel.frame = CGRect(x: x, y: y, width: width, height: fh)
            y += fh
        }
        y += mt.space(2)
        headMarker.frame = CGRect(x: x, y: headTop, width: width, height: y - headTop)
        // 题句
        y += mt.groupGap
        if let m = model, abs(mottoWidth - width) > 0.5 { applyMotto(m, width: width) }
        let mottoH = NativeType.height(mottoLabel, width: width, line: mt.line("lh17"))
        mottoLabel.frame = CGRect(x: x, y: y, width: width, height: mottoH)
        // 印：跟在第二行末字之后（左外边 8），竖向按行中线
        if case let lines = displayedMotto, let lastLine = lines.last {
            let kai = ShiziFonts.kai(size: mt.value("fs17"))
            let lw = (lastLine as NSString).size(withAttributes: [.font: kai]).width
            let lineW = lw + sealGap + sealSide
            let lh = mt.line("lh17")
            let lineTop = y + CGFloat(max(0, lines.count - 1)) * lh
            // vertical-align: middle：印的中线对齐「基线 + 父字体 x 高的一半」；基线 = 行顶 + 半行距 + 升部
            let baseline = lineTop + (lh - (kai.ascender - kai.descender)) / 2 + kai.ascender
            sealView.frame = CGRect(x: x + (width - lineW) / 2 + lw + sealGap, y: baseline - kai.xHeight / 2 - sealSide / 2, width: sealSide, height: sealSide)
        }
        y += mottoH
        // 三行（ul 上边线 1；每行最小高 52、上下内边距 8、下边线 0.5，名称左、值 / chevron 右）
        y += mt.groupGap
        let rowsTop = y
        rowsTopLine.frame = CGRect(x: x, y: y, width: width, height: mt.value("frame-w"))
        y += mt.value("frame-w")
        let hair = mt.value("hair")
        for (i, b) in rowButtons.enumerated() {
            // 网页 flex 行：值 flex:none、最宽 60%（放不下就折行、右对齐），名称占剩下的（AX 档会折行）；行高 = max(52, 内容 + 上下内边距 8 + 下边线)
            b.valueLabel.numberOfLines = 0
            b.label.numberOfLines = 0
            var vw: CGFloat = 0, vh: CGFloat = 0
            if !b.valueLabel.isHidden {
                vw = min(floor(width * 0.6), ceil(NativeType.width(b.valueLabel)))
                vh = NativeType.height(b.valueLabel, width: vw, line: mt.line("lh15"))
            } else {
                vw = 8
            }
            let lw = width - vw - mt.space(3)
            let labelH = NativeType.height(b.label, width: lw, line: mt.line("lh17s"))
            let rowH = max(52, max(labelH, vh) + 16 + hair)
            b.frame = CGRect(x: x, y: y, width: width, height: rowH)
            let inner = rowH - hair
            if !b.valueLabel.isHidden { b.valueLabel.frame = CGRect(x: width - vw, y: (inner - vh) / 2, width: vw, height: vh) }
            b.label.frame = CGRect(x: 0, y: (inner - labelH) / 2, width: lw, height: labelH)
            rowLines[i].frame = CGRect(x: x, y: y + rowH - hair, width: width, height: hair)
            y += rowH
        }
        rowsMarker.frame = CGRect(x: x, y: rowsTop, width: width, height: y - rowsTop)
        return y
    }
}

// MARK: - 隐私

@objc(ShiziScreen_about_privacy)
final class AboutPrivacyScreen: ShiziScreenViewController {
    struct View: Decodable {
        let title: ShiziCopyRef
        let paragraphs: [ShiziCopyRef]
    }

    private(set) var paragraphLabels: [UILabel] = []

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: View.self)
        setTitle(m.title.text)
        if paragraphLabels.count != m.paragraphs.count {
            paragraphLabels.forEach { $0.removeFromSuperview() }
            paragraphLabels = m.paragraphs.map { _ in UILabel() }
            for l in paragraphLabels {
                l.numberOfLines = 0
                l.accessibilityIdentifier = "native-about-privacy-p"
                content.addSubview(l)
            }
        }
        for (l, p) in zip(paragraphLabels, m.paragraphs) {
            l.text = p.text
            l.accessibilityLabel = p.text
        }
    }

    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat {
        let mt = metrics
        var y = top
        for (i, l) in paragraphLabels.enumerated() {
            if i > 0 { y += mt.groupGap }
            y += ShiziParagraph.place(l, l.accessibilityLabel ?? l.text ?? "", font: mt.font(15), color: color("ink1"), line: mt.line("lh15"), x: x, y: y, width: width)
        }
        return y
    }
}

/// 段落（网页 p，行高钉成网页行高）：排好返回高。about.js 的这几段 WebKit 实测按贪心折行（text-wrap:pretty 没有改动这几段），原生同样贪心折行。
/// 没有中文的字（名称、许可名、网址）不走 NativeType.set（它为中文字距显式写 kern 0，会关掉 SF 的默认字距，拉丁字比网页宽 2–4pt）。
enum ShiziParagraph {
    @discardableResult
    static func place(_ l: UILabel, _ text: String, font: UIFont, color: UIColor, line: CGFloat, x: CGFloat, y: CGFloat, width: CGFloat, align: NSTextAlignment = .natural) -> CGFloat {
        l.numberOfLines = 0
        l.accessibilityLabel = text
        if NativeType.hasCJK(text) {
            NativeType.set(l, text, font: font, color: color, align: align, line: line)
            let shown = pretty(text, label: l, width: width)
            if shown != text { NativeType.set(l, shown, font: font, color: color, align: align, line: line) }
        } else {
            let p = NSMutableParagraphStyle()
            p.alignment = align
            p.lineSpacing = max(0, line - font.lineHeight)
            var attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: p]
            if line > 0, line < font.lineHeight - 0.01 {
                // 网页行高比字体自然行高小（AX 档）：行盒钉成网页行高，字在行盒里竖向居中（同 NativeType.set）
                p.minimumLineHeight = line
                p.maximumLineHeight = line
                p.lineSpacing = 0
                attrs[.baselineOffset] = (line - font.lineHeight) / 4
            }
            let shown = latinPretty(text, font: font, width: width)
            l.font = font // NativeType.height 按 label.font 的行高数行
            l.attributedText = NSAttributedString(string: shown, attributes: attrs)
        }
        let h = NativeType.height(l, width: width, line: line)
        l.frame = CGRect(x: x, y: y, width: width, height: h)
        return h
    }

    /// 没有中文的段落（网址）放不下一行时：WebKit（text-wrap:pretty + 折行机会：空格后、字母数字间的连字符后，「/」后不折）把两行排得一样长——
    /// 实测 XXXL「https://github.com/open- / spaced-repetition/ts-fsrs」。取两行宽差最小的那个折行机会；两行放不下的照 TextKit。
    static func latinPretty(_ text: String, font: UIFont, width: CGFloat) -> String {
        func w(_ s: String) -> CGFloat { ceil((s as NSString).size(withAttributes: [.font: font]).width) }
        guard width > 0, w(text) > width, !text.contains("\n") else { return text }
        let c = Array(text)
        var best: (Int, CGFloat)?
        for i in 1..<c.count {
            let ok = c[i - 1] == " " || (c[i - 1] == "-" && i >= 2 && (c[i - 2].isLetter || c[i - 2].isNumber) && (c[i].isLetter || c[i].isNumber))
            guard ok else { continue }
            let a = String(c[0..<i]).trimmingCharacters(in: .whitespaces), b = String(c[i...])
            let wa = w(a), wb = w(b)
            guard wa <= width, wb <= width else { continue }
            if best == nil || abs(wa - wb) < best!.1 { best = (i, abs(wa - wb)) }
        }
        guard let (i, _) = best else { return text }
        return String(c[0..<i]).trimmingCharacters(in: .whitespaces) + "\n" + String(c[i...])
    }

    /// WebKit text-wrap:pretty 在这几段上的实测结果（iOS 26，B3.2 逐屏取证）：两行的段落按字贪心折行后末行短于行宽 1/4 时，
    /// 改在**词**边界（中文按词典分词）折行——取能放下的最靠后的词边界、且末行不短于 1/4 行宽。例：XXXL「你写的字、笔迹和对错，只存在 / 这台手机上。」。
    /// 只处理两行的段落（更长的段落这几页没有）；返回要显示的字（可能多一个换行；读屏名用原文）。
    static func pretty(_ text: String, label l: UILabel, width: CGFloat) -> String {
        guard width > 0, !text.contains("\n") else { return text }
        let ns = text as NSString
        let attr = l.attributedText ?? NSAttributedString(string: text, attributes: [.font: l.font as Any])
        func w(_ r: NSRange) -> CGFloat { ceil(attr.attributedSubstring(from: r).boundingRect(with: CGSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude), options: [], context: nil).width) }
        let full = NSRange(location: 0, length: ns.length)
        guard w(full) > width else { return text }
        // 贪心：第一行能放下的最多字数
        var fit = 0
        for i in 1...ns.length where w(NSRange(location: 0, length: i)) <= width { fit = i }
        guard fit > 0, fit < ns.length else { return text }
        let rest = NSRange(location: fit, length: ns.length - fit)
        guard w(rest) <= width, w(rest) < width / 4 else { return text }
        // 词边界
        let tok = CFStringTokenizerCreate(nil, text as CFString, CFRange(location: 0, length: ns.length), kCFStringTokenizerUnitWordBoundary, Locale(identifier: "zh-Hans") as CFLocale)
        var tokens: [NSRange] = []
        while CFStringTokenizerAdvanceToNextToken(tok) != [] {
            let r = CFStringTokenizerGetCurrentTokenRange(tok)
            tokens.append(NSRange(location: r.location, length: r.length))
        }
        // 系统分词比 WebKit（ICU 词典）切得碎：「这|台」这类单字接单字的地方 ICU 是一个词，不在这里折
        func single(_ r: NSRange) -> Bool { r.length == 1 && NativeType.hasCJK(ns.substring(with: r)) && !NativeType.hasCJKPunctuation(ns.substring(with: r)) }
        var bounds: [Int] = []
        for (i, r) in tokens.enumerated() where i > 0 {
            if single(tokens[i - 1]), single(r) { continue }
            bounds.append(r.location)
        }
        for b in bounds.sorted(by: >) where b > 0 && b <= fit {
            let tail = NSRange(location: b, length: ns.length - b)
            if w(tail) >= width / 4, w(tail) <= width {
                return ns.substring(to: b) + "\n" + ns.substring(from: b)
            }
        }
        return text
    }
}

// MARK: - 开源致谢

@objc(ShiziScreen_about_credits)
final class AboutCreditsScreen: ShiziScreenViewController {
    struct View: Decodable {
        struct Item: Decodable { let id: String; let kind: String; let name: String; let license: String; let url: String; let text: String }
        struct Group: Decodable { let kind: String; let title: ShiziCopyRef; let items: [Item] }
        let title: ShiziCopyRef
        let intro: ShiziCopyRef
        let toggle: ShiziCopyRef
        let groups: [Group]
    }

    /// 一项的视图（.sz-about__item：名称、许可名、出处网址、「许可全文」、展开后的全文）。
    final class ItemView {
        let name = UILabel()
        let license = UILabel()
        let url = UILabel()
        let toggle = NativeTextButton(type: .custom)
        let text = UILabel()
        /// 全文的底（.sz-about__text：elev 底、内边距 s3、圆角 r-work）。
        let textBox = UIView()
        let bottomLine = UIView()
        /// 一项的框（li.sz-about__item）：透明，QA 取证用。
        let marker = UIView()
        var item: View.Item?
        var open = false
    }

    let introLabel = UILabel()
    private var groupTitles: [UILabel] = []
    private var groupTopLines: [UIView] = []
    /// 一组的框（section.sz-about__group）：透明，QA 取证用。
    private var groupMarkers: [UIView] = []
    private var items: [[ItemView]] = []
    private var model: View?

    override func viewDidLoad() {
        introLabel.accessibilityIdentifier = "native-about-credits-intro"
        content.addSubview(introLabel)
        super.viewDidLoad()
    }

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: View.self)
        model = m
        setTitle(m.title.text)
        let shape = m.groups.map { $0.items.map(\.id) }
        if shape != items.map({ $0.compactMap { $0.item?.id } }) || groupTitles.count != m.groups.count { rebuild(m) }
        restyle(m)
    }

    private func rebuild(_ m: View) {
        groupTitles.forEach { $0.removeFromSuperview() }
        groupTopLines.forEach { $0.removeFromSuperview() }
        groupMarkers.forEach { $0.removeFromSuperview() }
        for list in items { for it in list { [it.marker, it.name, it.license, it.url, it.toggle, it.textBox, it.bottomLine].forEach { $0.removeFromSuperview() } } }
        groupTitles = m.groups.map { _ in UILabel() }
        groupTopLines = m.groups.map { _ in UIView() }
        groupMarkers = m.groups.map { _ in
            let v = UIView()
            v.isUserInteractionEnabled = false
            v.accessibilityIdentifier = "native-about-credits-group"
            return v
        }
        items = m.groups.map { g in g.items.map { item in let v = ItemView(); v.item = item; return v } }
        for (gi, g) in m.groups.enumerated() {
            content.addSubview(groupMarkers[gi])
            groupTitles[gi].accessibilityTraits = [.header]
            content.addSubview(groupTitles[gi])
            content.addSubview(groupTopLines[gi])
            _ = g
            for it in items[gi] {
                it.name.numberOfLines = 0
                it.license.numberOfLines = 0
                it.url.numberOfLines = 0
                it.text.numberOfLines = 0
                it.toggle.accessibilityIdentifier = "native-about-credit-toggle"
                it.text.accessibilityIdentifier = "native-about-credit-text"
                it.name.accessibilityIdentifier = "native-about-credit-name"
                it.license.accessibilityIdentifier = "native-about-credit-license"
                it.url.accessibilityIdentifier = "native-about-credit-url"
                it.marker.accessibilityIdentifier = "native-about-credit"
                it.marker.isUserInteractionEnabled = false
                content.addSubview(it.marker)
                it.textBox.addSubview(it.text)
                [it.name, it.license, it.url, it.toggle, it.textBox, it.bottomLine].forEach { content.addSubview($0) }
                wire(it.toggle) { [weak it] page in
                    guard let it else { return }
                    it.open.toggle()
                    page.markStateChange()
                    if let s = page as? AboutCreditsScreen, let m = s.model { s.restyle(m) }
                    page.view.setNeedsLayout()
                }
            }
        }
    }

    fileprivate func restyle(_ m: View) {
        let mt = metrics
        let toggle = m.toggle.text
        introLabel.accessibilityLabel = m.intro.text
        for (gi, g) in m.groups.enumerated() where gi < groupTitles.count {
            NativeType.set(groupTitles[gi], g.title.text, font: NativeType.song(size: mt.value("fs17"), weight: .medium), color: color("ink1"), line: mt.line("lh15"))
            ShiziFonts.untrack(groupTitles[gi])
            groupTopLines[gi].backgroundColor = color("line")
            for it in items[gi] {
                guard let item = it.item else { continue }
                it.name.accessibilityLabel = item.name
                it.license.isHidden = item.license.isEmpty
                it.url.isHidden = item.url.isEmpty
                it.toggle.setTitle(toggle, for: .normal)
                it.toggle.setTitleColor(color("ink2"), for: .normal)
                it.toggle.titleLabel?.font = mt.font(13)
                NativeType.trackTitle(it.toggle)
                it.toggle.accessibilityLabel = item.name + ariaJoin + toggle
                it.textBox.isHidden = !it.open
                it.textBox.backgroundColor = color("elev")
                it.text.backgroundColor = color("elev") // 字在底里（网页 pre 元素自己带底色）
                it.bottomLine.backgroundColor = color("line")
            }
        }
    }

    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat {
        guard let m = model else { return top }
        let mt = metrics
        var y = top
        y += ShiziParagraph.place(introLabel, m.intro.text, font: mt.font(15), color: color("ink2"), line: mt.line("lh15"), x: x, y: y, width: width)
        let frameW = mt.value("frame-w")
        for (gi, _) in m.groups.enumerated() where gi < groupTitles.count {
            y += mt.groupGap
            let groupTop = y
            let gt = groupTitles[gi]
            let gh = NativeType.height(gt, width: width, line: mt.line("lh15"))
            gt.frame = CGRect(x: x, y: y, width: width, height: gh)
            y += gh + mt.space(2)
            groupTopLines[gi].frame = CGRect(x: x, y: y, width: width, height: frameW)
            y += frameW
            for it in items[gi] {
                guard let item = it.item else { continue }
                let itemTop = y
                y += mt.space(3)
                y += ShiziParagraph.place(it.name, item.name, font: mt.font(15), color: color("ink1"), line: mt.line("lh15"), x: x, y: y, width: width)
                if !item.license.isEmpty {
                    y += mt.space(1)
                    y += ShiziParagraph.place(it.license, item.license, font: mt.font(13), color: color("ink2"), line: mt.line("lh13"), x: x, y: y, width: width)
                }
                if !item.url.isEmpty {
                    y += mt.space(1)
                    y += ShiziParagraph.place(it.url, item.url, font: mt.font(13), color: color("ink2"), line: mt.line("lh13"), x: x, y: y, width: width)
                }
                y += mt.space(1)
                // 「许可全文」：最小高 44（行高继承正文 lh15，AX 档更高），左右内边距 4，左外边距 −4
                let tw = ceil(NativeType.titleWidth(it.toggle))
                let th = max(mt.hit, mt.line("lh15"))
                it.toggle.frame = CGRect(x: x - 4, y: y, width: tw + 8, height: th)
                y += th
                if it.open {
                    y += mt.space(1)
                    let pad = mt.space(3)
                    let mono = UIFont.monospacedSystemFont(ofSize: mt.value("fs11"), weight: .regular)
                    it.text.attributedText = nil
                    let p = NSMutableParagraphStyle()
                    p.minimumLineHeight = mt.line("lh11")
                    p.maximumLineHeight = mt.line("lh11")
                    p.lineBreakMode = .byWordWrapping
                    let inner = width - 2 * pad
                    let shown = ShiziMonoWrap.wrap(item.text, perLine: Int(floor(inner / max(1, ("0" as NSString).size(withAttributes: [.font: mono]).width))))
                    it.text.attributedText = NSAttributedString(string: shown, attributes: [.font: mono, .foregroundColor: color("ink2"), .paragraphStyle: p])
                    let th = ceil(it.text.attributedText?.boundingRect(with: CGSize(width: inner, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin], context: nil).height ?? 0)
                    it.textBox.frame = CGRect(x: x, y: y, width: width, height: th + 2 * pad)
                    it.textBox.layer.cornerRadius = mt.value("r-work")
                    it.text.frame = CGRect(x: pad, y: pad, width: inner, height: th)
                    y += th + 2 * pad
                }
                y += mt.space(3)
                it.bottomLine.frame = CGRect(x: x, y: y, width: width, height: frameW)
                y += frameW
                it.marker.frame = CGRect(x: x, y: itemTop, width: width, height: y - itemTop)
            }
            groupMarkers[gi].frame = CGRect(x: x, y: groupTop, width: width, height: y - groupTop)
        }
        return y
    }
}

/// 许可全文（网页 pre：white-space:pre-wrap、overflow-wrap:anywhere，等宽字）的折行，按 WebKit 的折行机会自己折好：
/// 空格之后、字母数字之间的连字符之后可以折；「/」之后不折（TextKit 会在 / 后折，WebKit 不会：chanind/hanzi-writer 整个移到下一行）；
/// 一个词比一行还长时任意处折（anywhere）；行尾的空格挂在行外不占宽。等宽字体所以按字数算。
enum ShiziMonoWrap {
    static func wrap(_ text: String, perLine: Int) -> String {
        guard perLine > 4 else { return text }
        return text.components(separatedBy: "\n").map { wrapLine(Array($0), perLine).joined(separator: "\n") }.joined(separator: "\n")
    }

    private static func alnum(_ c: Character) -> Bool { c.isLetter || c.isNumber }

    private static func wrapLine(_ line: [Character], _ n: Int) -> [String] {
        var out: [String] = []
        var rest = line[...]
        while rest.count > n {
            let r = Array(rest)
            if r[n] == " " {
                // 第 n 个字之后正好是空格：这一行放满，空格挂在行外
                var j = n
                while j < r.count, r[j] == " " { j += 1 }
                out.append(String(r[0..<j]))
                rest = rest.dropFirst(j)
                continue
            }
            var best = -1
            for i in 1...n {
                if r[i - 1] == " " { best = i }
                else if r[i - 1] == "-", i >= 2, alnum(r[i - 2]), i < r.count, alnum(r[i]) { best = i }
            }
            if best <= 0 { best = n }
            out.append(String(r[0..<best]))
            rest = rest.dropFirst(best)
        }
        out.append(String(rest))
        return out
    }
}

// MARK: - 联系我们

@objc(ShiziScreen_about_letter)
final class AboutLetterScreen: ShiziScreenViewController {
    struct View: Decodable {
        let title: ShiziCopyRef
        let address: ShiziCopyRef
    }

    let addressLabel = UILabel()
    private var address = ""

    override func viewDidLoad() {
        addressLabel.accessibilityIdentifier = "native-about-letter-address"
        content.addSubview(addressLabel)
        super.viewDidLoad()
    }

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: View.self)
        setTitle(m.title.text)
        address = m.address.text
    }

    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat {
        let mt = metrics
        return top + ShiziParagraph.place(addressLabel, address, font: mt.font(15), color: color("ink2"), line: mt.line("lh15"), x: x, y: top, width: width)
    }
}
