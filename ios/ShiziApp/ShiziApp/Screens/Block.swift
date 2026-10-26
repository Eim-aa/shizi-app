import UIKit

// B3.13 原生阻断页（网页 src/ui/screens/block/index.js，1:1 移植；视图模型 src/session/views/block.js blockView，App API view.block）。
// 屏名 ⇄ 类：block ⇄ ShiziScreen_block。
//
// 三种来由（blockReasonOf）：unavailable（存储探测不过）/ blocked（写失败且回滚也失败，内存状态仍在、可导出）/ migration（v1 → v2 导入失败）。
// 阻断期间只画这一页：不画 tab 与页面栈、不能返回（01 §8.1）、左缘手势关掉。
//
// **引擎不可用时也必须能画**：这一页不依赖 JS 回包——
//   文案全在 ShiziCopy（构建期生成）；来由取宿主带来的 params，没有时取 ShiziEngine.status（blocked(reason)）；
//   可导出与否取宿主带来的 params，没有时问 block.exportable op；动作走 block.retry / block.export op。
//
// 版式（网页 block/index.js 的 .sz-block）：整页（无页头）、竖向居中；上内边距 s8 + 安全区、下 s8 + 安全区、左右页边；
// 标题（宋 22 / 500）、说明逐行（15 墨二，块间 8）、按钮（主 / 次，块间 12）；块之间 group-gap。

@objc(ShiziScreen_block)
final class BlockScreen: ShiziScreenViewController {
    /// 视图模型（views/block.js blockView）。
    struct View: Decodable {
        struct ExportFail: Decodable { let text: ShiziCopyRef; let cancel: ShiziCopyRef; let retry: ShiziCopyRef }
        /// 网页量出来的折行点（每一行从第几个字开始；views/block.js blockView 的 lines）。
        struct Lines: Decodable { let body: [[Int]?]?; let migration: [Int]?; let still: [Int]? }
        let kind: String
        let title: ShiziCopyRef
        let body: ShiziCopyRef
        let migration: ShiziCopyRef?
        let still: ShiziCopyRef?
        let retry: ShiziCopyRef
        let export: ShiziCopyRef?
        let exportFail: ExportFail?
        let lines: Lines?
    }

    // MARK: 视图

    /// 整页的框（网页 .sz-block 的 section：满页、笺面底；语义键 native-block-page）。
    private let blockMarker = UIView()
    private let blockTitleLabel = UILabel()
    private let bodyMarker = UIView()
    private var lineLabels: [UILabel] = []
    private let retryButton = UIButton(type: .custom)
    private let exportButton = UIButton(type: .custom)
    // 导出没成的三段式（就地）：说明 + 「先不导出」+「再试一次」
    private let failMarker = UIView()
    private let failNote = UILabel()
    private let failCancel = NativeTextButton(type: .custom)
    private let failRetry = UIButton(type: .custom)

    private var model: View?
    /// 视图没来时（引擎不可用）照 ShiziCopy 自绘。
    private var kind = "unavailable"
    private var canExport = false
    private var still = false
    private var exportFail = false
    /// 说明的每一行（网页 .sz-block__body 的 flex 列，gap 8）。
    private var bodyLines: [String] = []
    /// 每一行的折行点（网页量；nil = 没量到，按自己的宽度折）。
    private var lineStarts: [[Int]?] = []
    /// 迁移那一句在 bodyLines 里的下标（没有 = nil）。
    private var migrationIndex: Int?
    /// 「还是存不了」那一句在 bodyLines 里的下标（没有 = nil）。
    private var stillIndex: Int?

    // MARK: 生命周期

    override func viewDidLoad() {
        super.viewDidLoad()
        blockMarker.accessibilityIdentifier = "native-block-page"
        blockMarker.backgroundColor = color("paper")
        blockTitleLabel.accessibilityIdentifier = "native-block-title"
        bodyMarker.accessibilityIdentifier = "native-block-body"
        retryButton.accessibilityIdentifier = "native-block-retry"
        exportButton.accessibilityIdentifier = "native-block-export"
        failMarker.accessibilityIdentifier = "native-block-export-fail"
        failNote.accessibilityIdentifier = "native-block-export-fail-note"
        failCancel.accessibilityIdentifier = "native-block-export-fail-cancel"
        failRetry.accessibilityIdentifier = "native-block-export-fail-retry"
        blockTitleLabel.numberOfLines = 0
        failNote.numberOfLines = 0
        for v in [blockMarker, blockTitleLabel, bodyMarker, retryButton, exportButton, failMarker, failNote, failCancel, failRetry] as [UIView] {
            v.isUserInteractionEnabled = v is UIButton
            content.addSubview(v)
        }
        wire(retryButton) { page in (page as? BlockScreen)?.tapRetry() }
        wire(exportButton) { page in (page as? BlockScreen)?.tapExport() }
        wire(failCancel) { page in (page as? BlockScreen)?.clearExportFail() }
        wire(failRetry) { page in (page as? BlockScreen)?.tapExport() }
        // 阻断页不可返回：左缘手势关掉、页头返回键不画。
        backButton.isHidden = true
        titleLabel.isHidden = true // 页头（基类）不画：阻断页没有页头
    }

    /// 阻断页的按钮在引擎不可用时也要能点（「再试一次」= 重新探测 / 整页重启）。
    override func engineStatusChanged(_ s: ShiziEngineStatus) {
        super.engineStatusChanged(s)
        content.isUserInteractionEnabled = true
        for b in [retryButton, exportButton, failCancel, failRetry] as [UIButton] { b.isEnabled = true }
    }

    // MARK: 视图数据

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: View.self)
        model = m
        kind = m.kind
        canExport = m.export != nil
        still = m.still != nil
        exportFail = m.exportFail != nil
        applyModel()
    }

    override func update(params next: [String: Any]) {
        super.update(params: next)
        if let k = next["kind"] as? String { kind = k }
        if let c = next["canExport"] as? Bool { canExport = c }
        if model == nil { fallbackModel() }
        view.setNeedsLayout()
    }

    /// 视图没来时（引擎不可用 / 回包缺了）：照 ShiziCopy 自绘（文案键固定）。
    private func fallbackModel() {
        setTitleText(t("R-B09.title"))
        bodyLines = ShiziCopy.lines("R-B09.body")
        migrationIndex = nil
        stillIndex = nil
        if kind == "migration" { migrationIndex = bodyLines.count; bodyLines.append(ShiziCopy.t("X-SYS.blockMigration")) }
        if still { stillIndex = bodyLines.count; bodyLines.append(ShiziCopy.t("X-SYS.blockStill")) }
        lineStarts = []
        setLines()
        retryButton.isHidden = false
        stylePrimary(retryButton, t("R-B09.retry"))
        exportButton.isHidden = !canExport
        if canExport { styleSecondary(exportButton, t("R-B02.export")) }
        failMarker.isHidden = !exportFail
        if exportFail {
            setNoteText(failNote, t("X-BACKUP.exportFailed"))
            styleTextButton(failCancel, t("X-BACKUP.exportStay"))
            stylePrimary(failRetry, t("R-B09.retry"))
        }
    }

    private func applyModel() {
        guard let m = model else { return }
        setTitleText(m.title.text)
        bodyLines = m.body.lines
        migrationIndex = nil
        stillIndex = nil
        if let m2 = m.migration { migrationIndex = bodyLines.count; bodyLines.append(m2.text) }
        if let s = m.still { stillIndex = bodyLines.count; bodyLines.append(s.text) }
        // 折行点（网页量）：说明的每一行一组，迁移 / 还是存不了那两句各一组。
        lineStarts = m.lines?.body ?? []
        if m.migration != nil { lineStarts.append(m.lines?.migration) }
        if m.still != nil { lineStarts.append(m.lines?.still) }
        setLines()
        retryButton.isHidden = false
        stylePrimary(retryButton, m.retry.text)
        exportButton.isHidden = m.export == nil
        if let e = m.export { styleSecondary(exportButton, e.text) }
        failMarker.isHidden = m.exportFail == nil
        if let f = m.exportFail {
            setNoteText(failNote, f.text.text)
            styleTextButton(failCancel, f.cancel.text)
            stylePrimary(failRetry, f.retry.text)
        }
    }

    // MARK: 字

    /// 标题（网页 .sz-block__title：宋 22 / 500、左对齐）。
    private func setTitleText(_ text: String) {
        let mt = metrics
        blockTitleLabel.attributedText = ShiziPageText.song(text, size: mt.value("fs22"), weight: .medium, color: color("ink1"), align: .left, line: mt.line("lh22"))
        blockTitleLabel.textAlignment = .left
        blockTitleLabel.accessibilityLabel = text
    }

    /// 说明的每一行（网页 .sz-block__line：15 墨二、左对齐、满宽）。
    /// 迁移那一句单独给一个语义键（网页 data-testid="block-migration"）。
    private func setLines() {
        if lineLabels.count != bodyLines.count {
            lineLabels.forEach { $0.removeFromSuperview() }
            lineLabels = bodyLines.map { _ in
                let l = UILabel()
                l.numberOfLines = 0
                l.accessibilityIdentifier = "native-block-line"
                content.addSubview(l)
                return l
            }
        }
        let mt = metrics
        for (i, l) in lineLabels.enumerated() {
            let text = bodyLines[i]
            l.attributedText = ShiziPageText.mixed(text, size: mt.value("fs15"), color: color("ink2"), align: .left, line: mt.line("lh15"))
            l.textAlignment = .left
            l.textColor = color("ink2")
            l.accessibilityLabel = text
            l.accessibilityIdentifier = i == stillIndex ? "native-block-still" : (i == migrationIndex ? "native-block-migration" : "native-block-line")
        }
    }

    /// 三段式的说明（网页 .sz-fail__note：15 墨二、左对齐）。
    private func setNoteText(_ l: UILabel, _ text: String) {
        let mt = metrics
        l.attributedText = ShiziPageText.mixed(text, size: mt.value("fs15"), color: color("ink2"), align: .left, line: mt.line("lh15"))
        l.textAlignment = .left
        l.textColor = color("ink2")
        l.accessibilityLabel = text
    }

    // MARK: 按钮样式

    private func stylePrimary(_ b: UIButton, _ text: String) {
        let mt = metrics
        b.setTitle(text, for: .normal)
        b.setTitleColor(color("btn-fg"), for: .normal)
        b.titleLabel?.font = mt.font(17, .medium)
        b.titleLabel?.textAlignment = .center
        b.titleLabel?.numberOfLines = 0
        b.setAttributedTitle(ShiziPageText.mixed(text, size: mt.value("fs17"), weight: .medium, color: color("btn-fg"), align: .center, line: axLayout ? mt.line("lh17s") : nil), for: .normal)
        b.backgroundColor = color("btn-bg")
        b.layer.cornerRadius = mt.value("r-ctl")
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 24, bottom: 0, right: 24)
        b.accessibilityLabel = text
    }

    private func styleSecondary(_ b: UIButton, _ text: String) {
        let mt = metrics
        b.setTitle(text, for: .normal)
        b.setTitleColor(color("ink1"), for: .normal)
        b.titleLabel?.font = mt.font(17, .medium)
        b.titleLabel?.textAlignment = .center
        b.titleLabel?.numberOfLines = 0
        b.setAttributedTitle(ShiziPageText.mixed(text, size: mt.value("fs17"), weight: .medium, color: color("ink1"), align: .center, line: axLayout ? mt.line("lh17s") : nil), for: .normal)
        b.backgroundColor = .clear
        b.layer.cornerRadius = mt.value("r-ctl")
        b.layer.borderWidth = 1
        b.layer.borderColor = color("ink4").cgColor
        b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 24, bottom: 0, right: 24)
        b.accessibilityLabel = text
    }

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

    // MARK: 动作

    /// 「再试一次」：unavailable = 重新探测（还是不行就多一句「还是存不了」）；blocked / migration = 整页重新启动。
    private func tapRetry() {
        guard let engine = stage?.engine else { return }
        markStateChange()
        engine.raw("block.retry", ["kind": kind]) { [weak self] reply in
            guard let self else { return }
            if (reply["reload"] as? Bool) == true {
                // 阻断 / 迁移：整页重新启动（网页 location.reload()；原生重载网页）
                self.stage?.host.webView.reload()
                return
            }
            if (reply["still"] as? Bool) == true {
                self.still = true
                self.model = nil
                self.fallbackModel()
                self.view.setNeedsLayout()
                NativeA11y.announce(self.t("X-SYS.blockStill"))
            }
        }
    }

    /// 「导出备份」：只打包内存状态（不写入），原生弹系统分享面板。
    private func tapExport() {
        guard let engine = stage?.engine else { return }
        markStateChange()
        exportFail = false
        engine.raw("block.export", [:]) { [weak self] reply in
            guard let self else { return }
            guard (reply["ok"] as? Bool) == true, let name = reply["name"] as? String, let text = reply["text"] as? String else {
                self.exportFail = true
                self.model = nil
                self.fallbackModel()
                self.view.setNeedsLayout()
                return
            }
            self.shareBackup(name: name, text: text)
        }
    }

    /// 系统分享面板（导出成功不提示：面板本身就是反馈，F5）。
    private func shareBackup(name: String, text: String) {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do {
            try Data(text.utf8).write(to: url, options: .atomic)
        } catch {
            exportFail = true
            model = nil
            fallbackModel()
            view.setNeedsLayout()
            return
        }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.completionWithItemsHandler = { _, _, _, _ in
            try? FileManager.default.removeItem(at: url)
        }
        if let pop = sheet.popoverPresentationController {
            pop.sourceView = exportButton
            pop.sourceRect = exportButton.bounds
        }
        present(sheet, animated: true)
    }

    private func clearExportFail() {
        exportFail = false
        model = nil
        fallbackModel()
        view.setNeedsLayout()
    }

    // MARK: 排版

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let W = view.bounds.width, H = view.bounds.height
        guard W > 0 else { return }
        // 整页：没有页头，内容在整页里竖向居中（网页 .sz-block 的 flex 列）。
        scroll.frame = view.bounds
        content.frame = view.bounds
        if model == nil { fallbackModel() }
        let mt = metrics
        let padTop = mt.space(8) + view.safeAreaInsets.top
        let padBottom = mt.space(8) + view.safeAreaInsets.bottom
        let x = mt.gutter
        let width = W - 2 * mt.gutter
        let titleH = mt.line("lh22")
        let lineH = mt.line("lh15")
        // 说明：逐行（每行一个 p，块间 gap 8）；每行按满宽折行。
        var lineHeights: [CGFloat] = []
        for (i, l) in lineLabels.enumerated() {
            let h = layoutLine(l, width: width, starts: i < lineStarts.count ? lineStarts[i] : nil)
            lineHeights.append(h)
        }
        let bodyH = lineHeights.reduce(0, +) + mt.space(2) * CGFloat(max(0, lineHeights.count - 1))
        // 动作区：主按钮 +（次按钮 | 失败三段式）
        let hasExport = !exportButton.isHidden
        let hasFail = !failMarker.isHidden
        let btnH = mt.value("btn-h")
        var actionsH: CGFloat = 0
        var actionGap: CGFloat = 0
        if hasExport && hasFail {
            actionsH = btnH + mt.space(3) + failHeight()
            actionGap = mt.space(3)
        } else if hasExport {
            actionsH = btnH * 2 + mt.space(3)
            actionGap = mt.space(3)
        } else if hasFail {
            actionsH = failHeight()
        } else {
            actionsH = btnH
        }
        let contentH = titleH + mt.groupGap + bodyH + mt.groupGap + actionsH
        let boxH = max(0, H - padTop - padBottom)
        var y = padTop + max(0, (boxH - contentH) / 2)
        blockMarker.frame = CGRect(x: 0, y: 0, width: W, height: H)
        blockTitleLabel.frame = CGRect(x: x, y: y, width: width, height: titleH)
        y += titleH + mt.groupGap
        bodyMarker.frame = CGRect(x: x, y: y, width: width, height: bodyH)
        var ly = y
        for (i, l) in lineLabels.enumerated() {
            l.frame = CGRect(x: x, y: ly, width: width, height: lineHeights[i])
            ly += lineHeights[i] + mt.space(2)
        }
        y += bodyH + mt.groupGap
        retryButton.frame = CGRect(x: x, y: y, width: width, height: btnH)
        y += btnH
        if hasExport {
            y += actionGap
            exportButton.frame = CGRect(x: x, y: y, width: width, height: btnH)
            y += btnH
        }
        if hasFail {
            if hasExport { y += actionGap }
            failMarker.frame = CGRect(x: x, y: y, width: width, height: failHeight())
            layoutFail(x: x, y: y, width: width)
            y += failHeight()
        }
        content.frame = CGRect(x: 0, y: 0, width: W, height: max(H, y + padBottom))
        scroll.contentSize = CGSize(width: W, height: content.frame.height)
    }

    /// 一行说明按满宽折行（网页 .sz-block__line 是块级 p：宽 = 满宽、text-wrap: pretty）。
    /// starts：网页量出来的折行点——有它就按它换行。
    private func layoutLine(_ l: UILabel, width: CGFloat, starts: [Int]?) -> CGFloat {
        guard let raw = l.attributedText, raw.length > 0 else { return 0 }
        let a = ShiziPageText.source(raw)
        let chars = Array(a.string)
        let natural = ShiziPageText.naturalWidth(a)
        var lines = [0..<chars.count]
        if let starts {
            lines = ShiziPageText.ranges(fromStarts: starts, count: chars.count)
        } else if natural > width + 0.5 {
            lines = ShiziPageText.wrappedLines(a, chars, width: width)
        }
        l.attributedText = ShiziPageText.withBreaks(a, chars, lines)
        l.numberOfLines = lines.count
        l.lineBreakMode = .byClipping
        return CGFloat(lines.count) * metrics.line("lh15")
    }

    /// 失败三段式的高（说明 + 文字按钮 + 主按钮；块间 gap 8，说明另有下外边距 4）。
    private func failHeight() -> CGFloat {
        let mt = metrics
        let noteH = mt.line("lh15")
        let cancelH = max(mt.hit, 1.3 * mt.value("fs15") + 12)
        return noteH + mt.space(1) + mt.space(2) + cancelH + mt.space(2) + mt.value("btn-h")
    }

    private func layoutFail(x: CGFloat, y: CGFloat, width: CGFloat) {
        let mt = metrics
        var yy = y
        let noteH = mt.line("lh15")
        failNote.frame = CGRect(x: x, y: yy, width: width, height: noteH)
        yy += noteH + mt.space(1) + mt.space(2)
        let cancelH = max(mt.hit, 1.3 * mt.value("fs15") + 12)
        let cancelW = min(width, textButtonWidth(failCancel) + 8)
        failCancel.frame = CGRect(x: x, y: yy, width: cancelW, height: cancelH)
        yy += cancelH + mt.space(2)
        failRetry.frame = CGRect(x: x, y: yy, width: width, height: mt.value("btn-h"))
    }

    /// 文字按钮的宽（字宽 + 左右内边距 4）。
    private func textButtonWidth(_ b: UIButton) -> CGFloat {
        let title = b.attributedTitle(for: .normal)?.string ?? b.title(for: .normal) ?? ""
        let font = b.titleLabel?.font ?? metrics.font(15)
        return ceil((title as NSString).size(withAttributes: [.font: font]).width)
    }
}
