import UIKit

// B3.7：字详情的小部件——三段式失败（行下方）与列表行。

// MARK: - 三段式失败（网页 page 版式：说明 → 先不 X（文字按钮，左对齐）→ 再试一次（满宽主按钮））

final class DetailFailBlock {
    let note = UILabel()
    let cancelButton = NativeTextButton(type: .custom)
    let retryButton = UIButton(type: .custom)
    let line = UIView()
    let wrap = UIView()
    let wrapped: Bool
    private let metrics: ShiziMetrics

    init(metrics: ShiziMetrics, color: (String) -> UIColor, note text: String, cancel: String, retry: String, wrapped: Bool, id: String) {
        self.metrics = metrics
        self.wrapped = wrapped
        NativeType.set(note, text, font: metrics.font(15), color: color("ink2"), line: metrics.line("lh15"))
        note.numberOfLines = 0
        note.accessibilityIdentifier = id + "-note"
        cancelButton.setTitle(cancel, for: .normal)
        cancelButton.titleLabel?.font = metrics.font(15)
        cancelButton.setTitleColor(color("ink2"), for: .normal)
        cancelButton.contentEdgeInsets = UIEdgeInsets(top: 0, left: 4, bottom: 0, right: 4)
        cancelButton.contentHorizontalAlignment = .left
        cancelButton.accessibilityIdentifier = id + "-cancel"
        NativeType.trackTitle(cancelButton)
        retryButton.setTitle(retry, for: .normal)
        retryButton.titleLabel?.font = metrics.font(17, .medium)
        retryButton.backgroundColor = color("btn-bg")
        retryButton.setTitleColor(color("btn-fg"), for: .normal)
        retryButton.layer.cornerRadius = metrics.value("r-ctl")
        retryButton.layer.cornerCurve = .continuous
        retryButton.accessibilityIdentifier = id + "-retry"
        NativeType.trackTitle(retryButton)
        line.backgroundColor = color("line")
        line.isHidden = !wrapped
        wrap.accessibilityIdentifier = id
        wrap.isUserInteractionEnabled = false
    }

    var views: [UIView] { [wrap, line, note, cancelButton, retryButton] }

    /// 排好（x, y 起）返回占高。
    func layout(x: CGFloat, y: CGFloat, width: CGFloat) -> CGFloat {
        let mt = metrics
        let pad = wrapped ? mt.space(3) : 0
        var cy = y + pad
        let nh = NativeType.height(note, width: width, line: mt.line("lh15"))
        note.frame = CGRect(x: x, y: cy, width: width, height: nh)
        cy += nh + mt.space(1) + mt.space(2)
        let cw = NativeType.titleWidth(cancelButton) + 8
        let ch = max(mt.hit, 44)
        cancelButton.frame = CGRect(x: x - 4, y: cy, width: cw, height: ch)
        cy += ch + mt.space(2)
        let bh = mt.value("btn-h")
        retryButton.frame = CGRect(x: x, y: cy, width: width, height: bh)
        cy += bh
        let total = cy + pad - y + (wrapped ? 1 : 0)
        wrap.frame = CGRect(x: x, y: y, width: width, height: total)
        line.frame = CGRect(x: x, y: y + total - 1, width: width, height: 1)
        return total
    }
}

// MARK: - 列表行（网页 Row：名称 + 说明，可带「›」/ 朱点；有去处的是按钮，其余是文字块）

final class DetailRowItem {
    let key: String
    let row: DetailView.Row
    let button: ShiziRowButton?
    let container = UIView()
    let titleLabel = UILabel()
    let subLabel = UILabel()
    let line = UIView()
    var dot: DetailDot?
    var fail: DetailFailBlock?
    private(set) var frame: CGRect = .zero
    private let metrics: ShiziMetrics
    private let tall: Bool
    private let arrow: Bool

    init(row: DetailView.Row, owner: DetailScreen, metrics: ShiziMetrics, color: (String) -> UIColor) {
        self.row = row
        self.key = row.key
        self.metrics = metrics
        let isOff = row.key == "image" && row.state != "ok"
        let clickable = !(row.key == "next" || isOff)
        tall = row.key == "list"
        arrow = row.to != nil || (row.key == "image" && row.state == "ok")
        let id = row.key == "list" ? "native-detail-list-row" : "native-detail-\(row.key)"
        let subSmall = row.key == "remove"
        let titleColor = isOff ? color("ink3") : color("ink1")
        let rowKey = row.key
        let rowCopy = row
        if clickable {
            let b = ShiziRowButton(type: .custom)
            b.accessibilityIdentifier = id
            b.titleLabel?.font = metrics.font(15)
            b.setTitleColor(color("ink1"), for: .normal)
            b.accessibilityLabel = [row.title.text, row.sub?.text].compactMap { $0 }.joined(separator: "\u{FF0C}")
            b.accessibilityTraits = [.button]
            b.isAccessibilityElement = true
            NativeType.set(b.label, row.title.text, font: metrics.font(17), color: titleColor, line: metrics.line("lh17s"))
            b.label.numberOfLines = 0
            if let sub = row.sub {
                b.valueLabel.isHidden = false
                NativeType.set(b.valueLabel, sub.text, font: metrics.font(subSmall ? 13 : 15), color: color("ink3"), align: .left, line: metrics.line(subSmall ? "lh13" : "lh15"))
                b.valueLabel.numberOfLines = 0
            } else {
                b.valueLabel.isHidden = true
                b.valueLabel.text = nil
            }
            if arrow {
                b.chevronSize = CGSize(width: 8, height: 13)
                b.setImage(ShiziChevron.image(color("ink4"), size: b.chevronSize), for: .normal)
            }
            button = b
            owner.wire(b) { page in (page as? DetailScreen)?.rowTapped(rowKey, rowCopy) }
            if row.key == "list", row.kind == "wrong" { dot = DetailDot(color: color("zhu")) }
        } else {
            button = nil
            container.accessibilityIdentifier = id
            container.isUserInteractionEnabled = false
            NativeType.set(titleLabel, row.title.text, font: metrics.font(17), color: titleColor, line: metrics.line("lh17s"))
            titleLabel.numberOfLines = 0
            if let note = row.note {
                NativeType.set(subLabel, note.text, font: metrics.font(15), color: color("ink3"), line: metrics.line("lh15"))
                subLabel.numberOfLines = 0
            }
        }
        line.backgroundColor = color("line")
    }

    var views: [UIView] {
        if let b = button { return [b, line] + (dot.map { [$0] } ?? []) }
        return [container, titleLabel, subLabel, line]
    }

    func layout(x: CGFloat, y: CGFloat, width: CGFloat, hair: CGFloat) -> CGFloat {
        let mt = metrics
        let titleX: CGFloat = dot != nil ? 14 : 0
        let tw = width - (arrow ? 8 + mt.space(3) : 0) - titleX
        let lhT = mt.line("lh17s")
        let subLabelRef: UILabel? = button != nil ? (button!.valueLabel.isHidden ? nil : button!.valueLabel) : (row.note != nil ? subLabel : nil)
        let titleL = button?.label ?? titleLabel
        if key == "next", LibraryCommon.isAX {
            // Use the same line starts measured by WebKit for the date row.
            let text = LibraryText.joined(row.title.text, row.starts)
                .components(separatedBy: "\n")
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .joined(separator: "\n") // WebKit discards hanging spaces at a soft wrap; explicit newlines must do the same.
            NativeType.set(titleLabel, text, font: mt.font(17), color: titleLabel.textColor, line: lhT)
            // Like Home's mixed dates, keep the system display face for Latin glyphs at AX sizes.
            // Rebuilding the font descriptor for the CJK cascade otherwise widens digits and spaces.
            if let value = titleLabel.attributedText {
                let value = NSMutableAttributedString(attributedString: value)
                let latin = UIFont.systemFont(ofSize: mt.value("fs17"))
                let cjk = NativeType.cjkFont(size: mt.value("fs17"), weight: .regular)
                let track = NativeType.cjkTrack(size: mt.value("fs17"), weight: .regular)
                var offset = 0
                for ch in text {
                    let count = String(ch).utf16.count
                    let isCJK = ch.unicodeScalars.contains(where: { $0.value >= 0x2E80 })
                    value.addAttributes([.font: isCJK ? cjk : latin, .kern: isCJK ? track : 0], range: NSRange(location: offset, length: count))
                    offset += count
                }
                titleLabel.attributedText = value
            }
        }
        let th = NativeType.height(titleL, width: tw, line: lhT)
        let subLine = mt.line("lh15") // 说明的字号有 13 的（移出自选），行高仍是 lh15（.sz-drow__sub 的行高）
        let sh = subLabelRef.map { NativeType.height($0, width: tw, line: subLine) } ?? 0
        let content = th + (sh > 0 ? 3 + sh : 0)
        let minH: CGFloat = tall ? 60 : 52
        let h = max(minH, content + 2 * mt.space(3) + hair)
        frame = CGRect(x: x, y: y, width: width, height: h)
        let top = (h - hair - content) / 2
        if let b = button {
            b.frame = frame
            b.label.frame = CGRect(x: titleX, y: top, width: tw, height: th)
            if sh > 0 { b.valueLabel.frame = CGRect(x: 0, y: top + th + 3, width: tw + titleX, height: sh) }
            if let d = dot { d.frame = CGRect(x: x, y: y + top + (min(th, lhT) - 6) / 2, width: 6, height: 6) }
        } else {
            container.frame = frame
            // 文字块（flex 项：宽 = 名称与说明里较宽的那一个，二者同宽）
            let fit: (UILabel) -> CGFloat = { ceil(NativeType.width($0) * 64) / 64 }
            let mainW = min(tw, max(fit(titleLabel), row.note != nil ? fit(subLabel) : 0))
            titleLabel.frame = CGRect(x: x, y: y + top, width: mainW, height: th)
            if sh > 0 { subLabel.frame = CGRect(x: x, y: y + top + th + 3, width: mainW, height: sh) }
        }
        line.frame = CGRect(x: x, y: y + h - hair, width: width, height: hair)
        return h
    }
}
