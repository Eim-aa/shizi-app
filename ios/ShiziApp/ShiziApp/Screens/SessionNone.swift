import UIKit

// B3.12 原生「现在没有要写的字」页（网页 src/ui/screens/session/none.js，1:1 移植；视图模型 src/session/views/session.js noneView，App API view.session-none）。
// 屏名 ⇄ 类：session-none ⇄ ShiziScreen_session_none。
//
// 版式（网页 components/Page.js + components/EmptyState.js S2）：
//   页头「写字」+「‹」（底座 ShiziScreenViewController 画，位置与网页逐 pt 对齐）；
//   正文 = 全 App 唯一的空状态：空格子（笺面 + 1pt 外框）、标题（宋 22 / 500）、说明（15 墨二）、可选的文字按钮（「待复习 ›」），
//     竖向居中（格子下外边距 8、按钮上外边距 8、块之间 gap 8）；exhausted 时说明多一段；
//   底栏 = 主按钮（exhausted 时是「换范围」）+ 次按钮（「自己选字」），底边在屏底、下内边距 max(s6, 安全区)。
//
// 数值全部取 ShiziTokens（s* / gutter / group-gap / fs* / lh* / btn-h / r-ctl / hit / k），文案取视图模型给的引用（ShiziCopy 渲染）。

@objc(ShiziScreen_session_none)
final class SessionNoneScreen: ShiziScreenViewController {
    /// 视图模型（views/session.js noneView）。
    struct View: Decodable {
        struct Action: Decodable { let label: ShiziCopyRef; let to: String }
        struct Empty: Decodable {
            let cell: Bool
            let title: ShiziCopyRef
            let body: [ShiziCopyRef]
            let extra: [ShiziCopyRef]
            let action: Action?
        }
        struct Btn: Decodable { let label: ShiziCopyRef; let to: String }
        /// 网页量出来的折行点（每一行从第几个字开始；views/session.js noneView 的 lines）。
        struct Lines: Decodable { let title: [Int]?; let body: [Int]?; let extra: [Int]? }
        let title: ShiziCopyRef
        let empty: Empty
        let primary: Btn?
        let secondary: Btn?
        let exhausted: Bool
        let lines: Lines?
    }

    // MARK: 视图

    /// 空状态的外框（网页 .sz-empty；语义键 session-none-body-wrap）。
    private let emptyMarker = UIView()
    /// 空格子（.sz-empty__cell：笺面 + 1pt 外框）。
    private let cellView = UIView()
    private let emptyTitleLabel = UILabel()
    private let bodyLabel = UILabel()
    private let extraLabel = UILabel()
    /// 「待复习 ›」（空状态里的操作，文字按钮）。
    private let wrongButton = NativeTextButton(type: .custom)
    /// 底栏：主按钮 + 次按钮（网页 .sz-page__foot）。
    private let primaryButton = UIButton(type: .custom)
    private let secondaryButton = UIButton(type: .custom)

    private var model: View?
    /// 视图没来时（引擎不可用 / 回包缺了）照 ShiziCopy 自绘：文案键固定，入口有没有由参数给。
    private var exhausted = false
    private var hasWrong = false
    private var hasPick = false
    private var hasLibSwitch = false

    // MARK: 生命周期

    override func viewDidLoad() {
        super.viewDidLoad()
        exhausted = (params["exhausted"] as? Bool) ?? false
        emptyMarker.accessibilityIdentifier = "native-session-none-body-wrap"
        cellView.accessibilityIdentifier = "native-session-none-cell"
        // 空格子：笺面底 + 1px 外框（网页 .sz-empty__cell：background var(--sheet) + inset 0 0 0 1px var(--frame)）
        cellView.backgroundColor = color("sheet")
        cellView.layer.borderWidth = 1
        cellView.layer.borderColor = color("frame").cgColor
        emptyTitleLabel.accessibilityIdentifier = "native-session-none-title"
        bodyLabel.accessibilityIdentifier = "native-session-none-body"
        extraLabel.accessibilityIdentifier = "native-session-none-nochars"
        wrongButton.accessibilityIdentifier = "native-session-none-wrong"
        // 底栏两枚按钮的语义键由模型给（「换范围」还是「自己选字」）：applyModel / fallbackModel 里设，这里不写死。
        for l in [emptyTitleLabel, bodyLabel, extraLabel] { l.numberOfLines = 0 }
        for v in [emptyMarker, cellView, emptyTitleLabel, bodyLabel, extraLabel, wrongButton] as [UIView] {
            v.isUserInteractionEnabled = v is UIButton
            content.addSubview(v)
        }
        // 底栏在正文之外（网页 .sz-page__foot 是正文的兄弟）：挂在整页上，不随正文滚动。
        for b in [primaryButton, secondaryButton] as [UIButton] { view.addSubview(b) }
        wrongButton.titleLabel?.numberOfLines = 0
        primaryButton.titleLabel?.numberOfLines = 0
        secondaryButton.titleLabel?.numberOfLines = 0
        wire(wrongButton) { page in (page as? SessionNoneScreen)?.tapWrong() }
        wire(primaryButton) { page in (page as? SessionNoneScreen)?.tapPrimary() }
        wire(secondaryButton) { page in (page as? SessionNoneScreen)?.tapSecondary() }
    }

    /// 引擎不就绪时：正文与底栏都暂不可点（引擎重新就绪后重拉视图）。
    override func engineStatusChanged(_ s: ShiziEngineStatus) {
        super.engineStatusChanged(s)
        for b in [primaryButton, secondaryButton, wrongButton] as [UIButton] { b.isEnabled = s.isReady }
    }

    // MARK: 视图数据

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: View.self)
        model = m
        exhausted = m.exhausted
        hasWrong = m.empty.action != nil
        hasPick = m.primary?.to == "pick" || m.secondary?.to == "pick"
        hasLibSwitch = m.primary?.to == "libSwitch"
        applyModel()
    }

    /// 视图没来时（引擎不可用）：照 ShiziCopy 自绘（文案键固定，入口按参数）。
    private func fallbackModel() {
        setTitle(t("X-TABS.write"))
        let extraText = exhausted ? t("R-H11.noCharsBody") : ""
        setTitleText(emptyTitleLabel, t("R-H11.title"))
        setBodyText(bodyLabel, t("R-H11.body"))
        setBodyText(extraLabel, extraText)
        extraLabel.isHidden = extraText.isEmpty
        wrongButton.isHidden = !(exhausted && hasWrong)
        if !wrongButton.isHidden { styleTextButton(wrongButton, t("R-H11.noCharsLink")) }
        primaryButton.isHidden = !(hasPick || hasLibSwitch)
        secondaryButton.isHidden = !(exhausted && hasPick)
        if !primaryButton.isHidden {
            let text = exhausted && hasLibSwitch ? t("X-SESSION.noneLibSwitch") : t("X-SESSION.nonePick")
            stylePrimary(primaryButton, text)
            primaryButton.accessibilityIdentifier = exhausted && hasLibSwitch ? "native-session-none-libswitch" : "native-session-none-pick"
        }
        if !secondaryButton.isHidden {
            styleSecondary(secondaryButton, t("X-SESSION.nonePick"))
            secondaryButton.accessibilityIdentifier = "native-session-none-pick"
        }
    }

    private func applyModel() {
        guard let m = model else { return }
        setTitle(m.title.text)
        setTitleText(emptyTitleLabel, m.empty.title.text)
        setBodyText(bodyLabel, m.empty.body.map { $0.text }.joined(separator: "\n"))
        setBodyText(extraLabel, m.empty.extra.map { $0.text }.joined(separator: "\n"))
        extraLabel.isHidden = m.empty.extra.isEmpty
        if let a = m.empty.action {
            wrongButton.isHidden = false
            styleTextButton(wrongButton, a.label.text)
        } else {
            wrongButton.isHidden = true
        }
        if let p = m.primary {
            primaryButton.isHidden = false
            stylePrimary(primaryButton, p.label.text)
            primaryButton.accessibilityIdentifier = p.to == "libSwitch" ? "native-session-none-libswitch" : "native-session-none-pick"
        } else {
            primaryButton.isHidden = true
        }
        if let s = m.secondary {
            secondaryButton.isHidden = false
            styleSecondary(secondaryButton, s.label.text)
            secondaryButton.accessibilityIdentifier = "native-session-none-pick"
        } else {
            secondaryButton.isHidden = true
        }
    }

    // MARK: 字

    /// 标题（网页 .sz-empty__title：宋 22 / 500、居中）。
    private func setTitleText(_ l: UILabel, _ text: String) {
        let mt = metrics
        l.attributedText = ShiziPageText.song(text, size: mt.value("fs22"), weight: .medium, color: color("ink1"), align: .center, line: mt.line("lh22"))
        l.textAlignment = .center
        l.accessibilityLabel = text
    }

    /// 说明（网页 .sz-empty__body：15 墨二、居中；两段之间各是一个 p）。
    private func setBodyText(_ l: UILabel, _ text: String) {
        let mt = metrics
        l.attributedText = text.isEmpty ? nil : ShiziPageText.mixed(text, size: mt.value("fs15"), color: color("ink2"), align: .center, line: mt.line("lh15"))
        l.textAlignment = .center
        l.textColor = color("ink2")
        l.accessibilityLabel = text
    }

    // MARK: 按钮样式（网页 components/Button.js 的三种）

    /// 文字按钮（.sz-btn--text：黑体 15、ink2；点击区补到 44；AX 档字可折行、左对齐）。
    private func styleTextButton(_ b: NativeTextButton, _ text: String) {
        let mt = metrics
        b.setTitle(text, for: .normal)
        b.setTitleColor(color("ink2"), for: .normal)
        b.setTitleColor(color("ink1"), for: .highlighted)
        b.titleLabel?.font = mt.font(15)
        b.titleLabel?.textAlignment = axLayout ? .left : .center
        b.titleLabel?.numberOfLines = 0
        b.setAttributedTitle(ShiziPageText.mixed(text, size: mt.value("fs15"), color: color("ink2"), align: axLayout ? .left : .center, line: mt.line("lh15")), for: .normal)
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
        b.accessibilityLabel = text
    }

    /// 主按钮（.sz-btn--primary：btn-bg 底、btn-fg 字 17 / 500、圆角 r-ctl、最小高 btn-h）。
    private func stylePrimary(_ b: UIButton, _ text: String) {
        styleSolidButton(b, text, fg: color("btn-fg"))
    }

    /// 次按钮（.sz-btn--secondary：透明底 + 1pt ink4 内框；字 ink1 17 / 500）。
    private func styleSecondary(_ b: UIButton, _ text: String) {
        let mt = metrics
        styleSolidButton(b, text, fg: color("ink1"))
        b.backgroundColor = .clear
        b.layer.cornerRadius = mt.value("r-ctl")
        b.layer.borderWidth = 1
        b.layer.borderColor = color("ink4").cgColor
    }

    /// 主 / 次按钮共用的字与底（网页 .sz-btn--primary / --secondary）。
    private func styleSolidButton(_ b: UIButton, _ text: String, fg: UIColor) {
        let mt = metrics
        b.setTitle(text, for: .normal)
        b.setTitleColor(fg, for: .normal)
        b.titleLabel?.font = mt.font(17, .medium)
        b.titleLabel?.textAlignment = .center
        b.titleLabel?.numberOfLines = 0
        b.setAttributedTitle(ShiziPageText.mixed(text, size: mt.value("fs17"), weight: .medium, color: fg, align: .center, line: axLayout ? mt.line("lh17s") : nil), for: .normal)
        b.backgroundColor = color("btn-bg")
        b.layer.cornerRadius = mt.value("r-ctl")
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 24, bottom: 0, right: 24)
        b.accessibilityLabel = text
    }

    // MARK: 动作

    private func tapWrong() {
        yieldToWeb("session.wrongList")
    }

    private func tapPrimary() {
        guard let m = model else { return }
        let to = m.primary?.to ?? "pick"
        if to == "libSwitch" { yieldToWeb("session.libSwitch") } else { openPick() }
    }

    private func tapSecondary() {
        openPick()
    }

    /// 「自己选字」：查字弹层是原生的（B3.6，Screens/Query.swift）——网页 openPick 推入原生查字屏，盖在本页上面，本页不让开
    /// （让给网页会把原生栈连同新推入的查字屏一起收起）。
    private func openPick() {
        guard let stage, stage.isTop(self) else { return }
        stage.engine.raw("session.pick", [:]) { _ in }
    }

    /// 让给网页：先把这一页的样子交给宿主层（stage.cover），网页做它的动作（同一个 op、同一个函数对象），画好一帧后原生页让开；
    /// 网页那边的事做完、回到这一条时宿主发 open via 'return'，原生页重新盖上（B3.2 yieldToWeb 的公开版）。
    private func yieldToWeb(_ op: String) {
        stage?.yieldToWeb(op, [:], from: self)
    }

    // MARK: 排版

    /// 底栏（网页 .sz-page__foot）：上内边距 s3、按钮之间 s3、下内边距 max(s6, 安全区)。
    private var footerHeight: CGFloat {
        let mt = metrics
        let count = [primaryButton, secondaryButton].filter { !$0.isHidden }.count
        if count == 0 { return 0 }
        return mt.space(3) + CGFloat(count) * mt.value("btn-h") + CGFloat(count - 1) * mt.space(3) + max(mt.space(6), view.safeAreaInsets.bottom)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let W = view.bounds.width, H = view.bounds.height
        guard W > 0 else { return }
        // 底栏是网页正文的兄弟（flex:none）：正文区到它上沿为止。
        let foot = footerHeight
        let y = scroll.frame.minY
        let bodyH = max(0, H - foot - y)
        if abs(scroll.frame.height - bodyH) > 0.5 {
            scroll.frame = CGRect(x: 0, y: y, width: W, height: bodyH)
        }
        let mt = metrics
        let bottom = layoutBody(width: W - 2 * mt.gutter, x: mt.gutter, top: mt.space(4))
        let contentH = bottom + mt.space(8)
        content.frame = CGRect(x: 0, y: 0, width: W, height: contentH)
        scroll.contentSize = CGSize(width: W, height: contentH)
        layoutFooter(W: W, H: H)
    }

    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat {
        if model == nil { fallbackModel() }
        let mt = metrics
        let gap = mt.space(2)
        let k = scaleK()
        let cellSide = 72 * k

        // 三块字：标题（balance）、说明（pretty）、次说明（pretty）。宽度 = min(自然宽, 上限)。
        let lines = model?.lines
        let titleMax = width
        let bodyMax = min(290 * k, width)
        let titleBox = layoutText(emptyTitleLabel, maxWidth: titleMax, line: mt.line("lh22"), starts: lines?.title)
        let bodyBox = layoutText(bodyLabel, maxWidth: bodyMax, line: mt.line("lh15"), starts: lines?.body)
        let extraBox = extraLabel.isHidden ? CGSize.zero : layoutText(extraLabel, maxWidth: bodyMax, line: mt.line("lh15"), starts: lines?.extra)

        // 内容总高（格子 72×k + 下外边距 8；块之间 gap 8；操作上外边距 8）
        var contentH = cellSide + gap + gap + titleBox.height + gap + bodyBox.height
        if extraBox.height > 0 { contentH += gap + extraBox.height }
        var actionBox = CGSize.zero
        if !wrongButton.isHidden {
            actionBox = textButtonSize(wrongButton, width: width)
            contentH += gap + gap + actionBox.height
        }

        // 空状态的高 = max(正文区, 内容 + 上下内边距)；内容竖向居中
        let padTop = mt.space(8), padBottom = mt.space(6)
        let boxH = max(0, scroll.frame.height - mt.space(4) - mt.space(8))
        let stateH = max(boxH, contentH + padTop + padBottom)
        let offset = (stateH - padTop - padBottom - contentH) / 2
        var y = top + padTop + offset
        emptyMarker.frame = CGRect(x: x, y: top, width: width, height: stateH)
        // 格子
        cellView.frame = CGRect(x: x + (width - cellSide) / 2, y: y, width: cellSide, height: cellSide)
        y += cellSide + gap + gap
        // 标题
        emptyTitleLabel.frame = CGRect(x: x + (width - titleBox.width) / 2, y: y, width: titleBox.width, height: titleBox.height)
        y += titleBox.height + gap
        // 说明
        bodyLabel.frame = CGRect(x: x + (width - bodyBox.width) / 2, y: y, width: bodyBox.width, height: bodyBox.height)
        y += bodyBox.height
        if extraBox.height > 0 {
            y += gap
            extraLabel.frame = CGRect(x: x + (width - extraBox.width) / 2, y: y, width: extraBox.width, height: extraBox.height)
            y += extraBox.height
        }
        if !wrongButton.isHidden {
            y += gap + gap
            wrongButton.frame = CGRect(x: x + (width - actionBox.width) / 2, y: y, width: actionBox.width, height: actionBox.height)
            y += actionBox.height
        }
        return top + stateH
    }

    /// 底栏：主按钮在上、次按钮在下（网页 .sz-page__foot 的 flex 列，gap s3；底边 = 屏底 − max(s6, 安全区)）。
    private func layoutFooter(W: CGFloat, H: CGFloat) {
        let mt = metrics
        let btns = [primaryButton, secondaryButton].filter { !$0.isHidden }
        guard !btns.isEmpty else { return }
        let btnH = mt.value("btn-h")
        let gap = mt.space(3)
        var y = H - max(mt.space(6), view.safeAreaInsets.bottom) - CGFloat(btns.count) * btnH - CGFloat(btns.count - 1) * gap
        for b in btns {
            b.frame = CGRect(x: mt.gutter, y: y, width: W - 2 * mt.gutter, height: btnH)
            y += btnH + gap
        }
    }

    // MARK: 量

    /// 排一段居中的字：框宽 = min(自然宽, 上限)；放不下时按上限折行（网页 text-wrap: pretty / balance）。
    /// starts：网页量出来的折行点（每一行从第几个字开始）——有它就按它换行，不再自己折。
    /// 返回框的宽与高（高 = 行数 × 行高）。
    private func layoutText(_ l: UILabel, maxWidth: CGFloat, line: CGFloat, starts: [Int]?) -> CGSize {
        guard let raw = l.attributedText, raw.length > 0 else { return .zero }
        let a = ShiziPageText.source(raw)
        let chars = Array(a.string)
        let natural = ShiziPageText.naturalWidth(a)
        let box = max(0, min(natural, maxWidth))
        var lines = [0..<chars.count]
        if let starts {
            lines = ShiziPageText.ranges(fromStarts: starts, count: chars.count)
        } else if natural > maxWidth + 0.5 {
            lines = ShiziPageText.wrappedLines(a, chars, width: maxWidth)
        }
        l.attributedText = ShiziPageText.withBreaks(a, chars, lines)
        // 行数定死：原生字与网页字宽有零点几 pt 的差时，不再自己多折一行。
        l.numberOfLines = lines.count
        l.lineBreakMode = .byClipping
        return CGSize(width: box, height: CGFloat(lines.count) * line)
    }

    /// 文字按钮的框（字宽 + 左右内边距 4；AX 档字可折行）。
    private func textButtonSize(_ b: UIButton, width: CGFloat) -> CGSize {
        let mt = metrics
        let pad: CGFloat = 4
        let title = b.attributedTitle(for: .normal)?.string ?? b.title(for: .normal) ?? ""
        let font = b.titleLabel?.font ?? mt.font(15)
        let textW = min(width - 2 * pad, ceil((title as NSString).size(withAttributes: [.font: font]).width))
        let lines = max(1, Int(ceil(textW / max(1, width - 2 * pad))))
        let h = max(textButtonHeight(b), CGFloat(lines) * mt.line("lh15"))
        return CGSize(width: textW + 2 * pad, height: h)
    }

    /// 文字按钮的最小高（网页 .sz-btn--text：min-height max(44, 1.3em + 12)）。
    private func textButtonHeight(_ b: UIButton) -> CGFloat {
        let mt = metrics
        return max(mt.hit, 1.3 * mt.value("fs15") + 12)
    }

    /// 系统的字号倍率（网页 --k；空格子 72px × k）。ShiziKit 生成物里有每一档的 k。
    private func scaleK() -> CGFloat {
        let cat = ShiziTokens.categoryName(metrics.category)
        let cats = (ShiziTokens.root["type"] as? [String: Any])?["categories"] as? [String: Any]
        let k = (cats?[cat] as? [String: Any])?["k"] as? Double
        return CGFloat(k ?? 1)
    }
}
