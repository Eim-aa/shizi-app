import UIKit

// ShiziKit（B3.1）：字阶与字体。原在 NativeJudge.swift（NativeType）与 NativeWriteLayout.swift（NativeTypeScale）。

// MARK: 字阶（R9-B）

/// 网页字阶的此刻计算值（open 回包 type，pt：fs13 / lh13 / fs15 / lh15 / fs17 / lh17s / fs22 / lh22 / btn-h；页面 native-session.js typeBundle）。
/// 原生按它排字，与网页同字号同行高（系统字号连续倍率 --k 与 AX 档取值表只在 tokens.css 一处）。行高按 WebKit 的做法取整到整 pt。
/// 缺项（旧页面 / 单测）或原生页开着时系统字号变了：回包值作废，按 UIFontMetrics 近似（下一次 open 再对齐）。
/// 字体：系统字体（SF，中文落到系统的苹方 UI）——与网页 -apple-system 同一套字形与度量。例外：含全角标点（「」。，等）的句子，
/// 系统字体排版会把标点挤成半宽，网页（WebKit）不挤；这类句子直接用系统给中文的那一款（CTFontCreateForString 取到的苹方 UI），字宽与网页一致（NP-14）。
/// 行高：控件盒子按网页行高排（lines × lh，WebKit 取整到整 pt），字在盒子里竖向居中（同网页半行距）。
struct NativeType {
    private let raw: [String: CGFloat]
    private let category: UIContentSizeCategory

    /// B2.9b：网页 AX 档位（0 = 不是 AX 档；页面 typeBundle 的 ax）与逐元素取值（roles：角色 → 量到的 fs / lh / minH / padTop …，
    /// 附属元素在 r2…r5 下；native-session.js NATIVE_AX_ROLES 同一组探针）。
    let axLevel: Int
    private let roles: [String: [String: Any]]

    init(_ payload: Any? = nil) {
        var r: [String: CGFloat] = [:]
        let dict = (payload as? [String: Any]) ?? [:]
        for (k, v) in dict {
            if k == "ax" { continue }
            if let n = v as? NSNumber, n.doubleValue > 0 { r[k] = CGFloat(n.doubleValue) }
        }
        raw = r
        category = UIApplication.shared.preferredContentSizeCategory
        axLevel = (dict["ax"] as? NSNumber)?.intValue ?? 0
        roles = (dict["roles"] as? [String: [String: Any]]) ?? [:]
    }

    /// AX 档且页面给了逐元素取值（同一系统字号档位时才算数，见 value）。
    var ax: Bool { axLevel > 0 && UIApplication.shared.preferredContentSizeCategory == category }

    /// 角色的某个量（pt）；sub = "r2"… 取附属元素。没有 → nil。
    func role(_ name: String, _ key: String, sub: String? = nil) -> CGFloat? {
        guard ax, let r = roles[name] else { return nil }
        let d = sub.flatMap { r[$0] as? [String: Any] } ?? (sub == nil ? r : nil)
        guard let n = d?[key] as? NSNumber, n.doubleValue.isFinite else { return nil }
        return CGFloat(n.doubleValue)
    }

    /// 角色的字体（系统字体 + 苹方 UI 正文款，同 font(_:)）；没有 → nil。
    func roleFont(_ name: String, sub: String? = nil, weight: UIFont.Weight = .regular) -> UIFont? {
        guard let size = role(name, "fs", sub: sub) else { return nil }
        return Self.compose(size: size, weight: weight)
    }

    /// 角色的行高（取整到整 pt，同 line）。
    func roleLine(_ name: String, sub: String? = nil) -> CGFloat? { role(name, "lh", sub: sub).map { floor($0) } }

    /// AX 档主按钮的高（网页 components/ax.js：min-height var(--btn-h)、height auto、上下内边距 6，字可折行）：max(最小高, 行数 × 行高 + 上下内边距)。
    /// role / sub 指向量到的那颗按钮（minH / lh / padTop）；不在 AX 档 → nil。
    func axButtonHeight(_ role: String, sub: String? = nil, title: String?, font: UIFont?, width: CGFloat) -> CGFloat? {
        guard ax, let minH = self.role(role, "minH", sub: sub) else { return nil }
        let lh = roleLine(role, sub: sub) ?? floor(font?.lineHeight ?? 0)
        let pad = self.role(role, "padTop", sub: sub) ?? 0
        var lines: CGFloat = 1
        if let title, let font, width > 0 {
            let k = Self.cjkTrack(size: font.pointSize, weight: Self.weight(of: font))
            let tw = (title as NSString).size(withAttributes: [.font: font]).width + CGFloat(title.unicodeScalars.filter { $0.value >= 0x2E80 }.count) * k
            lines = max(1, ceil((tw - 0.5) / width))
        }
        return max(minH, lines * lh + 2 * pad)
    }

    static func compose(size: CGFloat, weight: UIFont.Weight) -> UIFont {
        let sys = UIFont.systemFont(ofSize: size, weight: weight)
        let cjk = cjkFont(size: size, weight: weight)
        let d = sys.fontDescriptor.addingAttributes([.cascadeList: [cjk.fontDescriptor]])
        return UIFont(descriptor: d, size: size)
    }

    private static let fallback: [String: (CGFloat, UIFont.TextStyle)] = [
        "fs13": (13, .footnote), "lh13": (20, .footnote), "fs15": (15, .subheadline), "lh15": (22, .subheadline),
        "fs17": (17, .body), "lh17": (26, .body), "lh17s": (22, .body), "fs28": (28, .title1), "fs22": (22, .title2), "lh22": (30, .title2), "btn-h": (54, .body),
        "r-box": (24, .body),
    ]

    func value(_ name: String) -> CGFloat {
        if name.hasPrefix("r-") { return raw[name] ?? Self.fallback[name]?.0 ?? 0 } // 圆角档（--r-box …）不随字号
        if let v = raw[name], UIApplication.shared.preferredContentSizeCategory == category { return v }
        let (base, style) = Self.fallback[name] ?? (17, .body)
        let v = UIFontMetrics(forTextStyle: style).scaledValue(for: base)
        return name == "btn-h" ? max(base, v) : v
    }

    /// 行高（WebKit 把小数行高取整到整 pt）。
    func line(_ name: String) -> CGFloat { floor(value(name)) }

    /// 系统字体，中文字形接到苹方 UI 的正文款（cascade）：系统在大字号下会给中文换成展示款（字距更紧），网页（WebKit）一直用正文款，
    /// 不接的话 XXXL 下「改为写对」这类字比网页窄 3pt。拉丁字母 / 数字 / 行高仍是 SF（与网页 -apple-system 同）。
    func font(_ name: String, weight: UIFont.Weight = .regular) -> UIFont {
        Self.compose(size: value(name), weight: weight)
    }

    static func hasCJKPunctuation(_ s: String) -> Bool {
        s.unicodeScalars.contains { (0x3000...0x303F).contains($0.value) || (0xFF00...0xFFEF).contains($0.value) }
    }

    /// 系统给中文的那一款（苹方 UI）的正文款：按 17pt 取到字体，再换成要的字号（光学尺寸钉在 17，换字号不换款）。
    static func cjkFont(size: CGFloat, weight: UIFont.Weight) -> UIFont {
        let probe = UIFont.systemFont(ofSize: 17, weight: weight)
        let text = CTFontCreateForString(probe as CTFont, "\u{6C38}" as CFString, CFRange(location: 0, length: 1))
        // 钉住光学尺寸 17：只换字号的话 CoreText 在 20pt 以上会自动换成展示款
        let d = CTFontDescriptorCreateCopyWithAttributes(CTFontCopyFontDescriptor(text), [kCTFontOpticalSizeAttribute: 17] as CFDictionary)
        return CTFontCreateWithFontDescriptor(d, size, nil) as UIFont
    }

    static func weight(of f: UIFont) -> UIFont.Weight {
        let traits = f.fontDescriptor.object(forKey: .traits) as? [UIFontDescriptor.TraitKey: Any]
        return UIFont.Weight(rawValue: CGFloat((traits?[.weight] as? NSNumber)?.doubleValue ?? 0))
    }

    /// 标签：字号、颜色、对齐；含全角标点的句子换成苹方 UI（见上），句中的拉丁字母 / 数字 / 空格按 SF 的字宽排（网页里它们是 SF），
    /// 多行时行距 = 网页行高（line，相邻两行基线相隔 line，同网页）。
    static func set(_ label: UILabel, _ text: String?, font: UIFont, color: UIColor, align: NSTextAlignment = .natural, line: CGFloat? = nil) {
        let punct = text.map(hasCJKPunctuation) ?? false
        let f = punct ? cjkFont(size: font.pointSize, weight: weight(of: font)) : font
        let track = text.map(hasCJK) == true ? cjkTrack(size: font.pointSize, weight: weight(of: font)) : 0
        label.attributedText = nil
        label.font = f
        label.textColor = color
        label.textAlignment = align
        guard let text, !text.isEmpty, punct || line != nil || track != 0 else {
            label.text = text
            return
        }
        let p = NSMutableParagraphStyle()
        p.alignment = align
        p.lineSpacing = max(0, (line ?? 0) - f.lineHeight)
        // 网页行高比字体自然行高小（AX 档苹方 1.4em、行高 1.18em）：行盒钉成网页行高，否则 n 行的字放不进 n × 行高的盒子、最后一行被截掉（B2.9b AX-01）
        var shift: CGFloat = 0
        if let line, line > 0, line < f.lineHeight - 0.01 {
            p.minimumLineHeight = line
            p.maximumLineHeight = line
            p.lineSpacing = 0
            shift = (line - f.lineHeight) / 4 // 字在行盒里竖向居中（同 NativeResultViewController.fixLineBox）
        }
        if label.numberOfLines == 1 { p.lineBreakMode = label.lineBreakMode } // 多行时保持按词折行（富文本里的截断方式会让多行标签只剩一行）
        // 字距 0 先铺满：CoreText 在带字距的文字后面接一段不带字距的文字时会给后者补默认字距（「修改 ›」的「›」宽 2.7pt），显式 0 就不会
        var attrs: [NSAttributedString.Key: Any] = [.font: f, .foregroundColor: color, .paragraphStyle: p, .kern: 0]
        if shift != 0 { attrs[.baselineOffset] = shift }
        let out = NSMutableAttributedString(string: text, attributes: attrs)
        let sf = UIFont.systemFont(ofSize: font.pointSize, weight: weight(of: font))
        var i = 0
        for ch in text {
            let n = (String(ch) as NSString).length
            let cjk = ch.unicodeScalars.contains(where: { $0.value >= 0x2E80 })
            if punct, !cjk {
                let want = (String(ch) as NSString).size(withAttributes: [.font: sf]).width
                let have = (String(ch) as NSString).size(withAttributes: [.font: f]).width
                out.addAttribute(.kern, value: want - have, range: NSRange(location: i, length: n))
            } else if cjk, track != 0 {
                out.addAttribute(.kern, value: track, range: NSRange(location: i, length: n))
            }
            i += n
        }
        label.attributedText = out
    }

    static func hasCJK(_ s: String) -> Bool { s.unicodeScalars.contains { $0.value >= 0x2E80 } }

    /// B2.9b：中文字距与网页一致。WebKit 按**实际字号**取苹方 UI 正文款 trak 表的字距；原生为保住正文款字形把光学尺寸钉在 17（cjkFont，R9-B），
    /// CoreText 于是按 17 取字距。大字号下（AX 档 22–53pt）两边每个中文字相差 0.1–0.8pt（「写好了」53pt 差 2.4pt）。
    /// 返回每个中文字形要补的字距（pt）=（trak(字号) − trak(17)）÷ upem × 字号；字号 17 时为 0。表取字体自带的，不抄数值。
    static func cjkTrack(size: CGFloat, weight: UIFont.Weight) -> CGFloat {
        let key = weight.rawValue
        if trakCache[key] == nil {
            let f = cjkFont(size: 17, weight: weight) as CTFont
            trakCache[key] = parseTrak(f).map { (upem: CGFloat(CTFontGetUnitsPerEm(f)), sizes: $0.sizes, values: $0.values) } ?? (upem: 0, sizes: [], values: [])
        }
        guard let t = trakCache[key], t.upem > 0, !t.sizes.isEmpty else { return 0 }
        func at(_ x: CGFloat) -> CGFloat {
            if x <= t.sizes[0] { return t.values[0] }
            for j in 1..<t.sizes.count where x <= t.sizes[j] {
                let u = (x - t.sizes[j - 1]) / (t.sizes[j] - t.sizes[j - 1])
                return t.values[j - 1] + (t.values[j] - t.values[j - 1]) * u
            }
            return t.values[t.values.count - 1]
        }
        let d = (at(size) - at(17)) / t.upem * size
        return abs(d) < 0.005 ? 0 : d
    }

    private static var trakCache: [CGFloat: (upem: CGFloat, sizes: [CGFloat], values: [CGFloat])] = [:]

    /// 'trak' 表（Apple 字体格式）的水平字距：取 track 值最接近 0 的那一条（苹方 UI 只有一条）。
    static func parseTrak(_ f: CTFont) -> (sizes: [CGFloat], values: [CGFloat])? {
        guard let data = CTFontCopyTable(f, CTFontTableTag(kCTFontTableTrak), []) as Data?, data.count >= 12 else { return nil }
        let b = [UInt8](data)
        func u16(_ o: Int) -> Int { o + 1 < b.count ? Int(b[o]) << 8 | Int(b[o + 1]) : 0 }
        func i16(_ o: Int) -> Int { let v = u16(o); return v >= 0x8000 ? v - 0x10000 : v }
        func fixed(_ o: Int) -> CGFloat { CGFloat(Int32(bitPattern: UInt32(u16(o)) << 16 | UInt32(u16(o + 2)))) / 65536 }
        let horiz = u16(6)
        guard horiz > 0, horiz + 8 <= b.count else { return nil }
        let nTracks = u16(horiz), nSizes = u16(horiz + 2), sizeOff = u16(horiz + 4) << 16 | u16(horiz + 6)
        guard nTracks > 0, nSizes > 0, sizeOff + 4 * nSizes <= b.count else { return nil }
        let sizes = (0..<nSizes).map { fixed(sizeOff + 4 * $0) }
        var best: (track: CGFloat, off: Int)?
        for t in 0..<nTracks {
            let e = horiz + 8 + t * 8
            let tr = fixed(e)
            if best == nil || abs(tr) < abs(best!.track) { best = (tr, u16(e + 6)) }
        }
        guard let off = best?.off, off + 2 * nSizes <= b.count else { return nil }
        return (sizes, (0..<nSizes).map { CGFloat(i16(off + 2 * $0)) })
    }

    /// 「修改 ›」这类「字 + ›」文字链（网页 ChangeLink：字与「›」是 inline-flex 的两项，间距 4）：标题里的空格按 4 排，中文字距同 cjkTrack。
    /// 按钮字体（系统字体时重新接上苹方 UI 正文款的 cascade：从 titleLabel 读回的字体不一定还带着它，富文本里不带的话中文会落到别的款）。
    static func titleFont(_ b: UIButton) -> UIFont? {
        guard let f = b.titleLabel?.font else { return nil }
        return f.fontName.hasPrefix(".SF") ? compose(size: f.pointSize, weight: weight(of: f)) : f
    }

    static func linkTitle(_ b: UIButton) {
        guard let t = b.title(for: .normal), let f = titleFont(b), t.contains(" ") else { trackTitle(b); return }
        let k = cjkTrack(size: f.pointSize, weight: weight(of: f))
        // 空格实际的宽按上下文量（紧跟中文时空格随中文那一款排，比 SF 的空格宽）
        let ns = t as NSString
        let sp = ns.range(of: " ")
        let probe = NSAttributedString(string: t, attributes: [.font: f, .kern: 0])
        let space = probe.attributedSubstring(from: NSRange(location: 0, length: sp.location + 1)).size().width
            - probe.attributedSubstring(from: NSRange(location: 0, length: sp.location)).size().width
        for st in [UIControl.State.normal, .disabled, .highlighted] {
            let out = NSMutableAttributedString(string: t, attributes: [.font: f, .foregroundColor: b.titleColor(for: st) ?? b.titleColor(for: .normal) ?? b.currentTitleColor, titleTint: true, .kern: 0])
            var i = 0
            for ch in t {
                let n = (String(ch) as NSString).length
                if ch == " " { out.addAttribute(.kern, value: 4 - space, range: NSRange(location: i, length: n)) }
                else if k != 0, ch.unicodeScalars.contains(where: { $0.value >= 0x2E80 }) { out.addAttribute(.kern, value: k, range: NSRange(location: i, length: n)) }
                i += n
            }
            b.setAttributedTitle(out, for: st)
        }
    }

    /// 按钮标题的显示宽（有富文本标题时按富文本量，含字距）。
    static func titleWidth(_ b: UIButton) -> CGFloat {
        if let a = b.attributedTitle(for: .normal), a.length > 0 { return ceil(a.size().width * 3) / 3 }
        return width(b.titleLabel ?? UILabel())
    }

    /// 按钮标题的中文字距（cjkTrack）：各状态的标题改成带字距的富文本（字体 = titleLabel.font，颜色 = 该状态的标题色）；不需要时清掉富文本。
    /// 标题 / 字体变了之后调用。富文本不写前景色：UIButton 对没有前景色的富文本按「当前状态的标题色」画，之后再 setTitleColor 也生效
    /// （QA-H3e：以前把调用当时的标题色写进富文本，先 trackTitle、后 setTitleColor 的按钮——备份页「导出备份」——在会走富文本的字号档
    /// （AX5 有字距）一直画默认的浅色字，深色下浅字落在奶油按钮上几乎看不见；dump 里的颜色是 titleColor，不反映这件事）。
    static func trackTitle(_ b: UIButton) {
        _ = installTitleColorSync
        let states: [UIControl.State] = [.normal, .disabled, .highlighted]
        guard let t = b.title(for: .normal), let f = titleFont(b), hasCJK(t) else {
            if b.attributedTitle(for: .normal) != nil { states.forEach { b.setAttributedTitle(nil, for: $0) } }
            return
        }
        let k = cjkTrack(size: f.pointSize, weight: weight(of: f))
        guard k != 0 else {
            if b.attributedTitle(for: .normal) != nil { states.forEach { b.setAttributedTitle(nil, for: $0) } }
            return
        }
        let p = NSMutableParagraphStyle()
        p.alignment = b.titleLabel?.textAlignment ?? .center
        p.lineBreakMode = b.titleLabel?.numberOfLines == 1 ? (b.titleLabel?.lineBreakMode ?? .byTruncatingMiddle) : .byWordWrapping
        for st in states {
            let out = NSMutableAttributedString(string: t, attributes: [.font: f, .paragraphStyle: p, titleTint: true, .kern: 0])
            var i = 0
            for ch in t {
                let n = (String(ch) as NSString).length
                if ch.unicodeScalars.contains(where: { $0.value >= 0x2E80 }) { out.addAttribute(.kern, value: k, range: NSRange(location: i, length: n)) }
                i += n
            }
            b.setAttributedTitle(out, for: st)
        }
        retintTitles(b)
    }

    /// 标在 trackTitle / linkTitle 写的富文本上，只有带这个标记的才会跟着标题色换色（别处自己配色的富文本不动）。
    static let titleTint = NSAttributedString.Key("shiziTitleTint")

    /// 各状态的富文本标题把前景色写成该状态的标题色（没单独设的状态跟 .normal）。
    static func retintTitles(_ b: UIButton) {
        for st in [UIControl.State.normal, .disabled, .highlighted] {
            guard let a = b.attributedTitle(for: st), a.length > 0, a.attribute(titleTint, at: 0, effectiveRange: nil) != nil else { continue }
            let color = b.titleColor(for: st) ?? b.titleColor(for: .normal) ?? .white
            let out = NSMutableAttributedString(attributedString: a)
            out.addAttribute(.foregroundColor, value: color, range: NSRange(location: 0, length: out.length))
            b.setAttributedTitle(out, for: st)
        }
    }

    /// UIButton.setTitleColor 之后，已有的富文本标题跟着换色（一次性安装，trackTitle 首次调用时装）。
    static let installTitleColorSync: Void = {
        let sel = #selector(UIButton.setTitleColor(_:for:))
        let swz = #selector(UIButton.shizi_setTitleColor(_:for:))
        guard let m1 = class_getInstanceMethod(UIButton.self, sel), let m2 = class_getInstanceMethod(UIButton.self, swz) else { return }
        method_exchangeImplementations(m1, m2)
    }()

    /// 宋（ShiziSerifSC，网页 --song；包里 Web/fonts 的 woff2，CoreText 直接读）。弹层标题这类网页用宋体的地方；读不到时退回系统字体。
    static func song(size: CGFloat, weight: UIFont.Weight) -> UIFont {
        let medium = weight.rawValue >= UIFont.Weight.medium.rawValue
        let name = medium ? "ShiziSerifSC-Medium" : "ShiziSerifSC-Regular"
        if songCache[name] == nil, let url = Bundle.main.url(forResource: "Web", withExtension: nil)?.appendingPathComponent("fonts/\(name).woff2"),
           let data = try? Data(contentsOf: url), let d = CTFontManagerCreateFontDescriptorFromData(data as CFData) {
            songCache[name] = d
        }
        guard let d = songCache[name] else { return .systemFont(ofSize: size, weight: weight) }
        return CTFontCreateWithFontDescriptor(d, size, nil) as UIFont
    }

    private static var songCache: [String: CTFontDescriptor] = [:]

    /// 标签在给定宽度下的盒高（行数 × 网页行高）。
    static func height(_ label: UILabel, width: CGFloat, line: CGFloat) -> CGFloat {
        guard !(label.text ?? "").isEmpty else { return 0 }
        let h = label.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        // 钉住了行盒（fixLineBox：最小行高）时按行盒数行，否则按字体行高
        let fixed = (label.attributedText?.length ?? 0) > 0 ? (label.attributedText?.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle)?.minimumLineHeight ?? 0 : 0
        let lines = max(1, (h / max(1, fixed > 0 ? fixed : label.font.lineHeight)).rounded())
        return lines * line
    }

    /// 网页段落 `text-wrap: pretty`（base.css p）的近似：两行的段落按贪心折行时末行太短（不到一行的 1/3），
    /// 改在第一行里最后一个句读（。，；！？）之后折行——与 WebKit 的结果相同（例：「……不写了。」/「判断过的 1 个字已经记下。」）。
    /// 返回要显示的字（可能多一个换行；读屏与比对都把空白去掉，不影响文案）。
    static func pretty(_ text: String, font: UIFont, width: CGFloat) -> String {
        func w(_ s: Substring) -> CGFloat { (String(s) as NSString).size(withAttributes: [.font: font]).width }
        let full = Substring(text)
        guard width > 0, w(full) > width, !text.contains("\n") else { return text }
        var fit = text.startIndex
        var i = text.startIndex
        while i < text.endIndex {
            let next = text.index(after: i)
            if w(full[..<next]) > width { break }
            fit = next
            i = next
        }
        let rest = full[fit...]
        guard w(rest) <= width, w(rest) < width / 3 else { return text }
        var cut: String.Index?
        var j = text.startIndex
        while j < fit {
            let next = text.index(after: j)
            if "\u{3002}\u{FF0C}\u{FF1B}\u{FF01}\u{FF1F}".contains(text[j]), next < fit { cut = next }
            j = next
        }
        guard let cut else { return text }
        return String(full[..<cut]) + "\n" + String(full[cut...]).trimmingCharacters(in: .whitespaces)
    }

    static func width(_ label: UILabel) -> CGFloat {
        label.sizeThatFits(CGSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude)).width
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


extension UIButton {
    /// 与 setTitleColor 互换（NativeType.installTitleColorSync）：调用的是原实现，随后让富文本标题的前景色跟上。
    @objc fileprivate func shizi_setTitleColor(_ color: UIColor?, for state: UIControl.State) {
        shizi_setTitleColor(color, for: state)
        if attributedTitle(for: .normal) != nil || attributedTitle(for: .disabled) != nil { NativeType.retintTitles(self) }
    }
}
