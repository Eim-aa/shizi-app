import UIKit

// B3.8 原生字库子页 · 换库页（网页 src/ui/screens/library/switch.js，1:1 移植；视图模型 src/session/views/library-switch.js libraryRows，
// App API view.library-switch / library.switch）。
// 屏名 ⇄ 类：library-switch ⇄ ShiziScreen_library_switch。推入页（「我的 › 设置 › 练习 › 练习范围」推入）。
//
// 版式按网页 CSS 逐项排（.sz-libsw__*），数值全部取 ShiziTokens：
//   页头「练习范围」；正文四行（库名 / 一句说明 / 数量行「可以练 N 个字 · 有记录 M 个」/ 右侧「正在用」或「›」）+ 底注；
//   换库失败就地三段式（网页 FailBlock layout=foot：说明 → 先不换 → 再试一次）；成功即返回（不提示）。

@objc(ShiziScreen_library_switch)
final class LibrarySwitchScreen: ShiziScreenViewController {
    struct Row: Decodable {
        let id: String
        let name: ShiziCopyRef
        let desc: ShiziCopyRef
        let total: Int
        let recorded: Int
        let current: Bool
        let countLine: ShiziCopyRef
    }

    /// 一行（网页 .sz-libsw__row）：名字 / 说明 / 数量行 / 标记。
    final class RowView: UIView {
        let button = ShiziLineButton(type: .custom)
        let name = UILabel()
        let desc = UILabel()
        let count = UILabel()
        let mark = UILabel()

        override init(frame: CGRect) {
            super.init(frame: frame)
            isAccessibilityElement = false
            for l in [name, desc, count, mark] {
                l.isUserInteractionEnabled = false
                l.isAccessibilityElement = false
                button.addSubview(l)
            }
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    }

    private let listMarker = UIView()
    private let sourceLabel = UILabel()
    private var rowViews: [RowView] = []
    /// 视图模型（网页 libraryRows 的结果：一组行）。
    private var model: [Row] = []
    /// 失败的那个库（再试一次重跑它）。
    private var failedId: String?

    override var watchedDomains: [String]? { ["settings", "records"] }

    /// 有没有底栏（换库失败才有底栏：三段式）。
    var hasFooter: Bool { failedId != nil }

    /// 底栏内容的高（三段式）。
    var footContentHeight: CGFloat {
        metrics.line("lh15") + metrics.space(1) + metrics.space(2) + metrics.value("hit") + metrics.space(2) + metrics.value("btn-h")
    }

    /// 共用底座（底栏 + 三段式；这一屏没有页头右槽）。
    private let kit = LibraryScreenKit()

    override func viewDidLoad() {
        kit.prepare(screen: self, trailId: nil, onTrail: nil,
                   failIdPrefix: "native-library-switch", failText: t("R-L06.saveFailed"), failCancelText: t("R-L06.cancel"),
                   onFailCancel: { [weak self] in self?.clearFailed() }, onFailRetry: { [weak self] in self?.retryFailed() })
        super.viewDidLoad()
        kit.attach()
        listMarker.accessibilityIdentifier = "native-library-switch-list"
        sourceLabel.accessibilityIdentifier = "native-library-switch-source"
        content.addSubview(listMarker)
        content.addSubview(sourceLabel)
    }

    override func render(view raw: Any) throws {
        let m = try ShiziDecode.value(raw, as: [Row].self)
        model = m
        setTitle(t("X-LIBSWITCH.title"))
        renderModel(m)
    }

    private func renderModel(_ m: [Row]) {
        let mt = metrics
        while rowViews.count < m.count {
            let rv = RowView()
            rv.button.accessibilityIdentifier = "native-library-switch-row-\(rowViews.count)"
            rowViews.append(rv)
            content.addSubview(rv)
            content.addSubview(rv.button)
            wire(rv.button) { [weak rv] page in (page as? LibrarySwitchScreen)?.pick(rv) }
        }
        while rowViews.count > m.count { rowViews.removeLast().removeFromSuperview() }
        for (i, row) in m.enumerated() {
            let rv = rowViews[i]
            NativeType.set(rv.name, row.name.text, font: mt.font(17, row.current ? .medium : .regular), color: color("ink1"), line: mt.line("lh17"))
            NativeType.set(rv.desc, row.desc.text, font: mt.font(13), color: color("ink2"), line: mt.line("lh13"))
            NativeType.set(rv.count, row.countLine.text, font: mt.font(15), color: color("ink2"), line: mt.line("lh15"))
            NativeType.set(rv.mark, row.current ? t("X-LIBSWITCH.current") : t("X-LIBSWITCH.more"), font: mt.font(row.current ? 13 : 15), color: row.current ? color("ink1") : color("ink3"), line: mt.line(row.current ? "lh13" : "lh15"))
            // 整行的文字（读屏名 / 取证的文案）：名字 · 说明 · 数量行 · 标记
            rv.button.composed = [row.name.text, row.desc.text, row.countLine.text, row.current ? t("X-LIBSWITCH.current") : t("X-LIBSWITCH.more")].joined(separator: " ")
            rv.button.lineFont = mt.font(15)
            rv.button.setTitleColor(color("ink1"), for: .normal)
        }
        NativeType.set(sourceLabel, t("R-L06.sourceNote"), font: mt.font(13), color: color("ink3"), line: mt.line("lh13"))
        kit.styleFail()
        view.setNeedsLayout()
    }

    // MARK: 动作

    /// 点一行：当前库 → 返回；别的库 → 直接换（网页 switch.js 的 pick）。
    private func pick(_ rv: RowView?) {
        guard let rv else { return }
        guard let idx = rowViews.firstIndex(where: { $0 === rv }), idx < model.count else { return }
        let row = model[idx]
        markStateChange()
        if row.current {
            Task { @MainActor [weak self] in
                guard let engine = self?.stage?.engine else { return }
                _ = await engine.raw("nav.back", [:])
            }
            return
        }
        choose(row.id)
    }

    /// 换库（网页 switch.js 的 choose：成功即返回，失败就地三段式）。
    private func choose(_ id: String) {
        Task { @MainActor [weak self] in
            guard let self, let engine = self.stage?.engine else { return }
            let body = await engine.raw("library.switch", ["id": id])
            let ok = (body["ok"] as? Bool) == true
            await MainActor.run {
                self.markStateChange()
                if ok {
                    self.failedId = nil
                    Task { @MainActor [weak self] in
                        guard let engine = self?.stage?.engine else { return }
                        _ = await engine.raw("nav.back", [:])
                    }
                } else {
                    self.failedId = id
                }
                self.view.setNeedsLayout()
            }
        }
    }

    func clearFailed() {
        markStateChange()
        failedId = nil
        view.setNeedsLayout()
    }

    func retryFailed() {
        guard let id = failedId else { return }
        choose(id)
    }

    // MARK: 排版

    /// 一行的排版（网页 .sz-libsw__row：内边距 10 0、内容 = 名字 lh17 + 3 + 说明 lh13 + 3 + 数量 lh15、行底 0.5 分隔线）。
    private struct RowBox {
        var height: CGFloat
        var mainWidth: CGFloat
        var nameHeight: CGFloat
        var descHeight: CGFloat
        var countHeight: CGFloat
        var markWidth: CGFloat
        var markHeight: CGFloat
    }

    private func rowBox(_ row: Row, width: CGFloat) -> RowBox {
        let mt = metrics
        let markText = row.current ? t("X-LIBSWITCH.current") : t("X-LIBSWITCH.more")
        let markFont = mt.font(row.current ? 13 : 15)
        let markW = LibraryCommon.textWidth(markText, markFont)
        let markH = mt.line(row.current ? "lh13" : "lh15")
        let mainW = max(0, width - 12 - markW)
        let nameH = CGFloat(LibraryText.lines(row.name.text, font: mt.font(17, row.current ? .medium : .regular), width: mainW, line: mt.line("lh17"))) * mt.line("lh17")
        let descH = CGFloat(LibraryText.lines(row.desc.text, font: mt.font(13), width: mainW, line: mt.line("lh13"))) * mt.line("lh13")
        // 数量行按「 · 」拆成整段（每段不折断，折行时整段换行；网页 .sz-libsw__seg）。
        let segs = row.countLine.text.components(separatedBy: " · ")
        let countH = CGFloat(LibraryText.nowrapSegmentLines(segs, separator: " · ", font: mt.font(15), width: mainW)) * mt.line("lh15")
        let mainH = nameH + 3 + descH + 3 + countH
        let h = max(62, mainH + 20)
        return RowBox(height: h, mainWidth: mainW, nameHeight: nameH, descHeight: descH, countHeight: countH, markWidth: markW, markHeight: markH)
    }

    override func layoutBody(width: CGFloat, x: CGFloat, top: CGFloat) -> CGFloat {
        let mt = metrics
        guard !model.isEmpty else { return top }
        var y = top
        var listH: CGFloat = 0
        for (i, rv) in rowViews.enumerated() {
            let isLast = i == rowViews.count - 1
            let box = rowBox(model[i], width: width)
            let h = box.height + (isLast ? 0 : LibraryCommon.hair)
            rv.frame = CGRect(x: x, y: y, width: width, height: h)
            rv.button.frame = CGRect(x: x, y: y, width: width, height: h)
            // 行底线（网页 border-bottom：只有底边，最后一行没有）
            rv.button.layer.borderWidth = 0
            let bottom = rv.button.viewWithTag(9103) ?? { let v = UIView(); v.tag = 9103; v.isUserInteractionEnabled = false; rv.button.addSubview(v); return v }()
            bottom.isHidden = isLast
            bottom.backgroundColor = color("line")
            bottom.frame = CGRect(x: 0, y: h - LibraryCommon.hair, width: width, height: LibraryCommon.hair)
            let mainW = box.mainWidth
            let contentH = box.height - 20
            let mainH = box.nameHeight + 3 + box.descHeight + 3 + box.countHeight
            let mainY = 10 + (contentH - mainH) / 2
            rv.name.frame = CGRect(x: 0, y: mainY, width: mainW, height: box.nameHeight)
            rv.desc.frame = CGRect(x: 0, y: mainY + box.nameHeight + 3, width: mainW, height: box.descHeight)
            rv.count.frame = CGRect(x: 0, y: mainY + box.nameHeight + 3 + box.descHeight + 3, width: mainW, height: box.countHeight)
            rv.mark.frame = CGRect(x: width - box.markWidth, y: 10 + (contentH - box.markHeight) / 2, width: box.markWidth, height: box.markHeight)
            y += h
            listH += h
        }
        listMarker.frame = CGRect(x: x, y: top, width: width, height: listH)
        y += mt.groupGap // .sz-page__body 的 gap group-gap
        let sourceH = CGFloat(LibraryText.lines(t("R-L06.sourceNote"), font: mt.font(13), width: width, line: mt.line("lh13"))) * mt.line("lh13")
        sourceLabel.frame = CGRect(x: x, y: y, width: width, height: sourceH)
        y += sourceH
        layoutFooter(width: width, x: x)
        return y
    }

    private func layoutFooter(width: CGFloat, x: CGFloat) {
        let innerX = metrics.gutter
        let innerW = view.bounds.width - 2 * metrics.gutter
        if failedId != nil {
            kit.layoutFailBlock(x: innerX, width: innerW)
        } else {
            kit.failNote.isHidden = true
            kit.failCancel.isHidden = true
            kit.failRetry.isHidden = true
        }
    }

    override func viewDidLayoutSubviews() {
        kit.layoutFoot(hasFooter: hasFooter, contentHeight: footContentHeight)
        super.viewDidLayoutSubviews()
        kit.layoutHeader(trailButtonWidth: 44, trailSlotWidth: 44)
        kit.adjustScroll(hasFooter: hasFooter)
    }
}
