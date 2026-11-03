import UIKit

// 原生练习字字形（B2.0）：与网页同一份数据 data/<字>.json（hanzi-writer 格式，01 §8.7「练习字字形单一来源」），
// 每笔一条 SVG 路径（1024 单位、y 向上、基线 900）→ CGPath。几何与 src/ui/canvas/glyph.js glyphTransform 同一个仿射：
//   pad = size × padRatio，k = (size − 2·pad) / 1024，x' = pad + x·k，y' = pad + (900 − y)·k。
// 包里的 Web/data 由 sync-web-assets.sh 按壳清单复制，所以原生与网页读的是同一批文件。

struct NativeGlyphData {
    let strokes: [CGPath] // 1024 单位、已翻成 y 向下（y' = 900 − y）
    let medians: [[CGPoint]]

    static let units: CGFloat = 1024
    static let baseline: CGFloat = 900

    private static var cache: [String: NativeGlyphData] = [:]
    private static var missing: Set<String> = []

    static var dataDirectory: URL? {
        Bundle.main.url(forResource: "Web", withExtension: nil)?.appendingPathComponent("data", isDirectory: true)
    }

    /// 取一个字的字形（主线程用；缓存成功与「确无数据」）。
    static func load(_ char: String) -> NativeGlyphData? {
        if let hit = cache[char] { return hit }
        if missing.contains(char) { return nil }
        guard let dir = dataDirectory,
              let data = try? Data(contentsOf: dir.appendingPathComponent("\(char).json")),
              let glyph = parse(json: data) else {
            missing.insert(char)
            return nil
        }
        if cache.count > 256 { cache.removeAll() }
        cache[char] = glyph
        return glyph
    }

    static func parse(json: Data) -> NativeGlyphData? {
        guard let obj = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
              let strokes = obj["strokes"] as? [String], !strokes.isEmpty else { return nil }
        let paths = strokes.compactMap { path(svg: $0) }
        guard paths.count == strokes.count else { return nil }
        let medians = (obj["medians"] as? [[[Double]]] ?? []).map { stroke in
            stroke.compactMap { p in p.count >= 2 ? CGPoint(x: p[0], y: baseline - p[1]) : nil }
        }
        return NativeGlyphData(strokes: paths, medians: medians)
    }

    /// 最小 SVG 路径解析：hanzi-writer 数据只用绝对 M / L / Q / C / Z（数与命令以空格分隔）。坐标同时翻成 y 向下。
    static func path(svg: String) -> CGPath? {
        let tokens = svg.split(whereSeparator: { $0 == " " || $0 == "," || $0 == "\n" || $0 == "\t" })
        let p = CGMutablePath()
        var i = 0
        var cmd: Character = "M"
        func num() -> CGFloat? {
            guard i < tokens.count, let v = Double(tokens[i]) else { return nil }
            i += 1
            return CGFloat(v)
        }
        func pt() -> CGPoint? {
            guard let x = num(), let y = num() else { return nil }
            return CGPoint(x: x, y: baseline - y)
        }
        while i < tokens.count {
            if let c = tokens[i].first, tokens[i].count == 1, c.isLetter {
                cmd = c
                i += 1
                if c == "Z" || c == "z" { p.closeSubpath(); continue }
            }
            switch cmd {
            case "M": guard let a = pt() else { return nil }; p.move(to: a); cmd = "L"
            case "L": guard let a = pt() else { return nil }; p.addLine(to: a)
            case "Q": guard let c1 = pt(), let a = pt() else { return nil }; p.addQuadCurve(to: a, control: c1)
            case "C": guard let c1 = pt(), let c2 = pt(), let a = pt() else { return nil }; p.addCurve(to: a, control1: c1, control2: c2)
            default: return nil
            }
        }
        return p
    }

    /// 1024 单位 → 边长 size 的格子（padRatio 与 glyph.js GLYPH_PAD_RATIO 同义；题面字 FACE_FULL 时为 0）。
    static func transform(size: CGFloat, padRatio: CGFloat) -> CGAffineTransform {
        let pad = size * padRatio
        let k = (size - 2 * pad) / units
        return CGAffineTransform(translationX: pad, y: pad).scaledBy(x: k, y: k)
    }
}

/// 画一个练习字（整字实填，颜色由调用方给令牌色）。没有数据时退回系统字体整字（10.13 语义）。
final class NativeGlyphView: UIView {
    var char: String = "" { didSet { if char != oldValue { setNeedsDisplay() } } }
    var color: UIColor = .label { didSet { setNeedsDisplay() } }
    var padRatio: CGFloat = 0.06 { didSet { setNeedsDisplay() } }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        contentMode = .redraw
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func draw(_ rect: CGRect) {
        guard !char.isEmpty, let ctx = UIGraphicsGetCurrentContext() else { return }
        let side = min(bounds.width, bounds.height)
        let ox = (bounds.width - side) / 2, oy = (bounds.height - side) / 2
        if let glyph = NativeGlyphData.load(char) {
            var t = NativeGlyphData.transform(size: side, padRatio: padRatio).concatenating(CGAffineTransform(translationX: ox, y: oy))
            ctx.setFillColor(color.cgColor)
            for s in glyph.strokes {
                if let moved = s.copy(using: &t) { ctx.addPath(moved) }
            }
            ctx.fillPath(using: .winding)
        } else {
            let font = UIFont.systemFont(ofSize: side * (1 - 2 * padRatio) * 0.9)
            let str = NSAttributedString(string: char, attributes: [.font: font, .foregroundColor: color])
            let sz = str.size()
            str.draw(at: CGPoint(x: ox + (side - sz.width) / 2, y: oy + (side - sz.height) / 2))
        }
    }
}
