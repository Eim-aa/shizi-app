import UIKit

// B3.12 / B3.13 三屏共用的文字排法（网页 .sz-empty__* / .sz-block__* / .sz-corrupt__text 的同一套规则）：
//
//   · 字距：中文按苹方 UI 正文款 + **该字号**的字距（NativeType.cjkTrack，与网页 PingFang 的 trak 表同一条）；
//     拉丁与数字按系统字体排（网页 -apple-system 里的拉丁）。宋体（标题）不补苹方的字距。
//   · 折行：网页的 p 全局 text-wrap: pretty、标题 text-wrap: balance——WebKit 在折行机会里挑一组断点，
//     使各行尽量匀（余量平方和最小）。这里按同一口径算：断点不许落在句读之前（UAX#14 的中文部分），
//     在所有合法断点组合里取余量平方和最小的那组。
//   · 宽：网页段落是 fit-content（min(字的自然宽, 上限)），上限 = 可用宽与 max-width 里小的那个。
//
// 只在 B3.12 / B3.13 的三屏里用；别的页各写各的（ShiziKit 不动）。
enum ShiziPageText {
    // MARK: 字

    /// 中文字（苹方 UI 正文款 + 该字号的字距；拉丁 / 数字按系统字体）。
    static func mixed(_ text: String, size: CGFloat, weight: UIFont.Weight = .regular, color: UIColor,
                       align: NSTextAlignment = .natural, line: CGFloat? = nil) -> NSAttributedString {
        let cjk = NativeType.cjkFont(size: size, weight: weight)
        let latin = UIFont.systemFont(ofSize: size, weight: weight)
        let track = NativeType.cjkTrack(size: size, weight: weight)
        let p = NSMutableParagraphStyle()
        p.alignment = align
        p.lineBreakMode = .byWordWrapping
        var shift: CGFloat = 0
        let base = NativeType.compose(size: size, weight: weight)
        if let line, line > 0 {
            if line < base.lineHeight - 0.01 {
                p.minimumLineHeight = line
                p.maximumLineHeight = line
                shift = (line - base.lineHeight) / 4
            } else {
                p.lineSpacing = max(0, line - base.lineHeight)
            }
        }
        let out = NSMutableAttributedString()
        for ch in text {
            let isCJK = ch.unicodeScalars.contains { $0.value >= 0x2E80 }
            var attrs: [NSAttributedString.Key: Any] = [.font: isCJK ? cjk : latin, .foregroundColor: color, .paragraphStyle: p, .kern: isCJK ? track : 0]
            if shift != 0 { attrs[.baselineOffset] = shift }
            out.append(NSAttributedString(string: String(ch), attributes: attrs))
        }
        return out
    }

    /// 宋体的字（不补苹方的字距；网页 --song）。
    static func song(_ text: String, size: CGFloat, weight: UIFont.Weight, color: UIColor,
                      align: NSTextAlignment = .natural, line: CGFloat? = nil) -> NSAttributedString {
        let f = NativeType.song(size: size, weight: weight)
        let p = NSMutableParagraphStyle()
        p.alignment = align
        var attrs: [NSAttributedString.Key: Any] = [.font: f, .foregroundColor: color, .paragraphStyle: p, .kern: 0]
        if let line, line > 0 {
            p.minimumLineHeight = line
            p.maximumLineHeight = line
            attrs[.baselineOffset] = (line - f.lineHeight) / 4
        }
        return NSAttributedString(string: text, attributes: attrs)
    }

    // MARK: 折行

    /// 句读不放开头（UAX#14 的中文部分）。
    private static let noBreakBefore: Set<Character> = ["\u{FF0C}", "\u{3002}", "\u{3001}", "\u{FF01}", "\u{FF1F}", "\u{FF1B}", "\u{FF1A}", "\u{300D}", "\u{300F}", "\u{FF09}"]
    /// 开引号不放开尾。
    private static let noBreakAfter: Set<Character> = ["\u{300C}", "\u{300E}", "\u{FF08}"]

    /// 断在第 i 个字之前行不行（i 是字的下标；i = 0 不算断点）。
    static func canBreak(_ chars: [Character], _ i: Int) -> Bool {
        guard i > 0, i < chars.count else { return false }
        let a = chars[i - 1], b = chars[i]
        if noBreakBefore.contains(b) || noBreakAfter.contains(a) { return false }
        if a == " " { return true }
        return NativeType.hasCJK(String(a)) || NativeType.hasCJK(String(b))
    }

    /// 一段字在宽 w 里的折行（字的下标区间）。
    ///
    /// 网页的 text-wrap: pretty / balance：WebKit 在折行机会里挑一组断点，使各行的余量平方和最小（各行尽量匀）。
    /// 这里按同一口径：dp[j] = 前 j 个字断成若干行的最小余量平方和；dp[j] = min(dp[i] + (w - 行宽(i..j))²)，
    /// 断点 i 合法（canBreak）且这一行放得下。同一段里余量平方和相同的断法，取断点靠后的一种（与网页实测一致）。
    static func wrappedLines(_ a: NSAttributedString, _ chars: [Character], width w: CGFloat) -> [Range<Int>] {
        let n = chars.count
        guard n > 0 else { return [] }
        let offsets = chars.reduce(into: [0]) { $0.append($0.last! + (String($1) as NSString).length) }
        func width(_ r: Range<Int>) -> CGFloat {
            a.attributedSubstring(from: NSRange(location: offsets[r.lowerBound], length: offsets[r.upperBound] - offsets[r.lowerBound])).size().width
        }
        // 前缀宽（每一行都是一段连续的子串，宽度可增量算）
        var prefix: [CGFloat] = [0]
        for i in 0..<n {
            prefix.append(prefix[i] + a.attributedSubstring(from: NSRange(location: offsets[i], length: offsets[i + 1] - offsets[i])).size().width)
        }
        let infinity = CGFloat.greatestFiniteMagnitude
        var best = [CGFloat](repeating: infinity, count: n + 1)
        var from = [Int](repeating: -1, count: n + 1)
        best[0] = 0
        for j in 1...n {
            for i in stride(from: max(0, j - 1), through: 0, by: -1) {
                guard best[i] < infinity else { continue }
                guard i == 0 || canBreak(chars, i) else { continue }
                let lineW = prefix[j] - prefix[i]
                guard lineW <= w + 0.5 else { continue }
                let cost = best[i] + (w - lineW) * (w - lineW)
                // 同样代价时取断点更靠后的（网页实测：余量相同时优先把字留在前一行）
                if cost < best[j] - 0.0001 || (cost <= best[j] + 0.0001 && i > from[j]) {
                    best[j] = cost
                    from[j] = i
                }
            }
        }
        // 断点回溯
        var cuts: [Int] = []
        var j = n
        while j > 0 {
            let i = from[j]
            if i < 0 { break }
            cuts.append(i)
            j = i
        }
        cuts.reverse()
        var lines: [Range<Int>] = []
        var start = 0
        for c in cuts { lines.append(start..<c); start = c }
        lines.append(start..<n)
        _ = width
        return lines
    }

    /// 去掉上一次折行留下的换行符（重新按新的折行点排时用；源串本身没有换行）。
    static func source(_ a: NSAttributedString) -> NSAttributedString {
        guard a.string.contains("\n") else { return a }
        let out = NSMutableAttributedString()
        let ns = a.string as NSString
        var i = 0
        while i < ns.length {
            let ch = ns.character(at: i)
            if ch == 10 { i += 1; continue }
            let len = ch > 0xFFFF ? 2 : 1
            out.append(a.attributedSubstring(from: NSRange(location: i, length: len)))
            i += len
        }
        return out
    }

    /// 把折行结果写进富文本（用换行符定住断点）。
    static func withBreaks(_ a: NSAttributedString, _ chars: [Character], _ lines: [Range<Int>]) -> NSAttributedString {
        guard lines.count > 1 else { return a }
        let offsets = chars.reduce(into: [0]) { $0.append($0.last! + (String($1) as NSString).length) }
        let out = NSMutableAttributedString()
        for (i, r) in lines.enumerated() {
            if i > 0 {
                let last = out.length - 1
                out.append(NSAttributedString(string: "\n", attributes: a.attributes(at: max(0, last), effectiveRange: nil)))
            }
            out.append(a.attributedSubstring(from: NSRange(location: offsets[r.lowerBound], length: offsets[r.upperBound] - offsets[r.lowerBound])))
        }
        return out
    }

    /// 网页量出来的折行点（每一行从第几个字开始）→ 行区间。
    static func ranges(fromStarts starts: [Int], count n: Int) -> [Range<Int>] {
        guard n > 0 else { return [] }
        let cuts = starts.filter { $0 > 0 && $0 < n }.sorted()
        var out: [Range<Int>] = []
        var start = 0
        for c in cuts {
            out.append(start..<c)
            start = c
        }
        out.append(start..<n)
        return out
    }

    // MARK: 量

    /// 字的自然宽（不折行时的宽）。
    static func naturalWidth(_ a: NSAttributedString) -> CGFloat { a.size().width }
}
